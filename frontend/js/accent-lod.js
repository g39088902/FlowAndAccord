// === Accent 细节分级 LOD 集中解析层（★ TA-07，docs/plan/tech/07-terrain-art.md §6.7/§10.2）===
// 单一口径：把「特征尺度（世界 → CSS px）→ 三档判档（阈值带滞回）→ 完整投影包围体
// （解析式屏幕 AABB）」三件事集中在唯一实现里，供装饰（render_accents.js）/ 灌木
// （render_bush.js）/ 草丛（render_grass.js）/ 阴影（render_shadows.js）/ 景观
// （render_landscapes.js）/ 队列（render_depth_queue.js）六处消费——**严禁**各处再留一份
// 余量公式或阈值字面量（07 号 §2.3「口径漂移」即为反例；旧 render_accents.js 的 44/14
// 启发余量、render_shadows.js 的 crownR×1.8 均属此类，本任务一并收口）。
//
// 设计要点（TA-07-TODO §3）：
// - 特征尺度口径 = **CSS px**（main.js 的 ctx.setTransform(dpr,…) 已承担 DPR ⇒ 档位天然
//   DPR 无关，与 terrain-texture.js::detailFadePx 同源）；LOD 层**严禁**读 devicePixelRatio /
//   canvas.width / 季节 / 光向 / 模拟状态——档位是 (个体几何, camera.zoom) 的函数。
// - 滞回是**有界历史依赖**：只影响「画哪些图元」，不影响几何、颜色、深度与排序；收敛后
//   （相机静止 ≥1 帧）同 (个体, zoom) 判档唯一、截图可复现。状态挂个体对象瞬态字段
//   `_lodT`（随世界事件 terrain.accents 整组替换而自然失效），**严禁**模块级 Map 存滞回。
// - 屏幕 AABB 取**解析解**（不枚举 8 角）：水平圆盘经 rotZ 仍是圆盘、经 rotX 压成 cosX
//   系数 ⇒ 4 次乘加即得；恒为保守上界（宁多画不漏画）。
//
// 零 GC（TA-11-6 纪律）：配置读取与 AABB 计算全部写入模块级复用对象，稳态零逐帧堆分配。
//
// 依赖（**运行时**解析，加载期不触碰）：window.RENDER_CONFIG（config.render.js，7 位已加载）、
//   window.AccentModel（accent-model.js，24 位；只在其函数体内解析）、渲染期全局 w / h / camera。
// 加载顺序（index.html 24b）：晚于 accent-model.js、早于 render_accents.js 等全部消费点。

window.AccentLOD = (function () {
  var FAR = 0, MID = 1, NEAR = 2;

  // 倾干剪切系数上界：render_accents.js 的 leanShear = cos(rotation) × 0.22 × leanShearK
  // （leanShearK ≤ 1.0）。一级粗剔无模型可查 rotation，只能取该上界——粗剔必须 ≥ 精剔。
  var SHEAR_MAX = 0.22;
  // Boulder 石半径（drawAccentBoulder 入参 6 × scaled；特征尺度与包围体的石体基准）
  var BOULDER_R = 6;

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function bool(v, d) { return (typeof v === 'boolean') ? v : d; }

  // ── 配置键读取（§3.7；逐键缺省回退与 config.render.js 集中值一致；零 GC 写入复用对象）──
  var _cfg = {
    mid: 7, near: 15, hys: 0.12, hysOn: true, cullOn: true, pad: 2,
    farMax: 8, stoneFar: true, plumeMin: 2, gpMin: 1, shadowReachK: 2.5,
    grassHBase: 2.4, grassTuftMin: 1.4, rockMinR: 0.6,
  };
  function cfg() {
    var RC = window.RENDER_CONFIG || {};
    _cfg.mid = num(RC.accentDetailMidPx, 7);
    _cfg.near = num(RC.accentDetailNearPx, 15);
    _cfg.hys = num(RC.accentLODHysteresis, 0.12);
    _cfg.hysOn = bool(RC.accentLODHysteresisEnabled, true);
    _cfg.cullOn = bool(RC.accentLODCullEnabled, true);
    _cfg.pad = num(RC.accentLODCullPadPx, 2);
    _cfg.farMax = num(RC.accentLODFarMaxClusters, 8);
    _cfg.stoneFar = bool(RC.accentLODStoneFarSides, true);
    _cfg.plumeMin = num(RC.accentLODPlumeMinPx, 2);
    _cfg.gpMin = num(RC.accentLODGroundPatchMinPx, 1);
    _cfg.shadowReachK = num(RC.accentLODShadowReachK, 2.5);
    _cfg.grassHBase = num(RC.accentGrassTuftHeightBase, 2.4);
    _cfg.grassTuftMin = num(RC.accentGrassTuftLODMinPx, 1.4);
    _cfg.rockMinR = num(RC.accentRockClusterLODMinRadius, 0.6);
    return _cfg;
  }

  // ── 一级粗剔保守常数表（§3.5；世界单位，须 ≥ 各 kind 真值上界，宁多画不漏画）──
  // 缺省回退与 config.render.js::accentKindBounds 建议值一致；配置缺席/非法不致命。
  // yUp = 屏幕竖直额外上界（世界单位 × cosX）：石体底环按 v1.50.13「底边贴落地点」契约
  //       整体落在锚点上方（非以锚点为心对称），须显式登记，否则远景石体顶部会被剔掉。
  var _KB_FALLBACK = {
    Tree:        { rH: 13.5, zMin: 0,    zMax: 18,  yUp: 0,  rS: 4 },
    Bush:        { rH: 6.5,  zMin: -1.5, zMax: 8.5, yUp: 0,  rS: 3 },
    Boulder:     { rH: 7.2,  zMin: 0,    zMax: 1.8, yUp: 7.2, rS: 0 },
    RockCluster: { rH: 11,   zMin: 0,    zMax: 3,   yUp: 11, rS: 4.5 },
    GrassTuft:   { rH: 5.5,  zMin: 0,    zMax: 7.5, yUp: 0,  rS: 1.5 },
    GroundPatch: { rH: 12,   zMin: 0,    zMax: 0,   yUp: 0,  rS: 0 },
  };
  var _kb = { rH: 8, zMin: 0, zMax: 8, yUp: 0, rS: 0 };
  function kindBounds(kind) {
    var t = (window.RENDER_CONFIG || {}).accentKindBounds || {};
    var b = t[kind] || _KB_FALLBACK[kind] || _KB_FALLBACK.Tree;
    _kb.rH = num(b.rH, 8);
    _kb.zMin = num(b.zMin, 0);
    _kb.zMax = num(b.zMax, 8);
    _kb.yUp = num(b.yUp, 0);
    _kb.rS = num(b.rS, 0);
    return _kb;
  }
  // 真值包围体优先（模型层 ★ TA-07-3 由骨架几何求值）；模型缺席退化为 kind 级保守常数
  function modelBounds(model, kind) {
    var b = model && model.bounds;
    return b ? b : kindBounds(kind);
  }

  // ── 特征尺度（§3.1）：主体特征世界尺寸 × accent.scale × camera.zoom = CSS px ──
  // 判档**只**用它；子图元级阈值（明暗带干宽 / 簇亮部簇半径 / 子石半径 / 穗长 / 贴片半径）
  // 保留各自 px 判据，但键名与缺省值统一收进 RENDER_CONFIG 的 accentLOD 键组。
  function featureWorld(kind, model) {
    if (kind === 'Tree' || kind === 'Bush') {
      var sk = model && model.skeleton;
      if (sk && typeof sk.crownR === 'number') return sk.crownR;
      return kind === 'Tree' ? 8.5 : 6.5;
    }
    if (kind === 'GrassTuft') return cfg().grassHBase; // 现状 render_grass.js 口径（株高基准）
    if (kind === 'Boulder') return BOULDER_R;
    var b = model && model.bounds;
    return b ? b.rH : 8;
  }
  function featurePx(kind, model, scaled) { return featureWorld(kind, model) * scaled; }

  // ── 三档判档 + 阈值带滞回（§3.3；纯函数，便于断言与 A/B）──
  // 升档用裸阈值 T（T(1)=mid, T(2)=near）；降档用 T×(1−h) 死区 ⇒ featurePx 落在
  // [T×(1−h), T) 内时档位保持不变，滚轮微调与临界缩放不再让枝条/亮部反复开关。
  // prev = -1（首帧 / 滞回关态）走裸判档上行路径。
  function tierOf(f, prev, c) {
    c = c || cfg();
    var t = (prev === FAR || prev === MID || prev === NEAR) ? prev : -1;
    if (!c.hysOn) t = -1;
    if (t < 0) return f >= c.near ? NEAR : (f >= c.mid ? MID : FAR);
    var h = c.hys < 0 ? 0 : (c.hys > 0.9 ? 0.9 : c.hys);
    while (t < NEAR && f >= (t + 1 === MID ? c.mid : c.near)) t++;
    while (t > FAR && f < ((t === NEAR ? c.near : c.mid) * (1 - h))) t--;
    return t;
  }
  // 逐个体档位入口：滞回状态写 owner._lodT（accent / 景观子图元 child；瞬态字段随对象
  // 生命周期自然失效——READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 后整组换新对象 ⇒ 首帧裸判档）
  function tierFor(owner, kind, model, scaled) {
    var t = tierOf(featurePx(kind, model, scaled), owner ? owner._lodT : -1);
    if (owner) owner._lodT = t;
    return t;
  }

  // ── 倾干剪切系数（单一来源；绘制层与包围体共用，杜绝两处各写一份）──
  function leanShear(owner, model) {
    var k = 1;
    var sk = model && model.skeleton;
    if (sk && typeof sk.leanShearK === 'number') k = sk.leanShearK;
    return Math.cos((owner && owner.rotation) || 0) * 0.22 * k;
  }

  // 包围体刮擦：仅供无模型消费方（如 GroundPatch 直接给半径）拼装临时 bounds，零分配
  var _bnd = { rH: 8, zMin: 0, zMax: 8, yUp: 0, rS: 0 };
  function boundsScratch(rH, zMin, zMax, yUp, rS) {
    _bnd.rH = rH; _bnd.zMin = zMin || 0; _bnd.zMax = zMax || 0;
    _bnd.yUp = yUp || 0; _bnd.rS = rS || 0;
    return _bnd;
  }

  // ── 完整投影包围体：解析式屏幕 AABB（§3.4；非 8 角枚举）──
  // b.rS（「球体半径」上界）**不乘 cosX**：叶簇/子石是屏幕空间球，竖直方向按全半径外扩
  //   （水平已由 rH 计入）；漏掉它会让低俯角（cosX→0）下的冠顶被误剔。
  // 局部包围体 b = { rH, zMin, zMax, yUp }（世界单位，未乘 accent.scale / zoom）：
  //   R  = (rH + |s|·zMax) × scaled        // 剪切补偿后的水平屏幕半径
  //   zx = −z·sinX × scaled                // 竖直范围（符号安全：不假设 sinX > 0）
  //   yLo = sy + min(zxMin, zxMax) − R·cosX − yUp·cosX×scaled
  //   yHi = sy + max(zxMin, zxMax) + R·cosX
  //   AABB = [sx − R, sx + R] × [yLo, yHi]，另加 cullPadPx 覆盖描边线宽与抗锯齿。
  var _aabb = { x0: 0, y0: 0, x1: 0, y1: 0 };
  function aabbOf(sx, sy, b, shear, scaled, cosX, sinX, out) {
    out = out || _aabb;
    var pad = cfg().pad;
    var aX = cosX < 0 ? -cosX : cosX;
    var zM = b.zMax > 0 ? b.zMax : 0;
    var R = (b.rH + (shear < 0 ? -shear : shear) * zM) * scaled;
    var za = -b.zMin * sinX * scaled;
    var zb = -zM * sinX * scaled;
    var lo = za < zb ? za : zb;
    var hi = za > zb ? za : zb;
    var rS = (b.rS || 0) * scaled;
    out.x0 = sx - R - rS - pad; out.x1 = sx + R + rS + pad;
    out.y0 = sy + lo - R * aX - b.yUp * aX * scaled - rS - pad;
    out.y1 = sy + hi + R * aX + rS + pad;
    return out;
  }
  // 贴地投影 AABB（§3.4）：以锚点与影梢为两心、半径 = 冠影长半轴（crowW×shadowK×1.12）
  // 的两圆之并集 —— 覆盖接地弱影、枝影与冠影三段（render_shadows.js:101 现值口径）。
  function shadowAabb(sx, sy, crowW, shadowK, soX, soY, out) {
    out = out || _aabb;
    var rad = (crowW * shadowK * 1.12) + cfg().pad;
    var tx = sx + soX, ty = sy + soY;
    out.x0 = (sx < tx ? sx : tx) - rad; out.x1 = (sx > tx ? sx : tx) + rad;
    out.y0 = (sy < ty ? sy : ty) - rad; out.y1 = (sy > ty ? sy : ty) + rad;
    return out;
  }
  // 视口可见判定（渲染期全局 w / h，CSS px）
  function visible(a) {
    return !(a.x1 < 0 || a.x0 > w || a.y1 < 0 || a.y0 > h);
  }

  // ── dev 计数器（TA-07-1；只累加数值，不建字符串；TA-07-10 性能 A/B 后随临时钩子一并删除）──
  var _stats = { cullCoarse: 0, cullFine: 0, enqueued: 0, tierFar: 0, tierMid: 0, tierNear: 0 };
  function stats() { return _stats; }
  function resetStats() {
    _stats.cullCoarse = 0; _stats.cullFine = 0; _stats.enqueued = 0;
    _stats.tierFar = 0; _stats.tierMid = 0; _stats.tierNear = 0;
  }

  return {
    FAR: FAR, MID: MID, NEAR: NEAR,
    SHEAR_MAX: SHEAR_MAX, BOULDER_R: BOULDER_R,
    cfg: cfg,
    kindBounds: kindBounds, modelBounds: modelBounds, boundsScratch: boundsScratch,
    featureWorld: featureWorld, featurePx: featurePx,
    tierOf: tierOf, tierFor: tierFor,
    leanShear: leanShear,
    aabb: _aabb, aabbOf: aabbOf, shadowAabb: shadowAabb, visible: visible,
    stats: stats, resetStats: resetStats,
  };
})();
