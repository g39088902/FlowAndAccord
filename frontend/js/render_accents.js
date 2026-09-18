// === Accent 装饰绘制层（TA-01 + TA-03，docs/plan/tech/07-terrain-art.md §6.2/§6.4）===
// Tree / Boulder / Bush 单实体绘制入口，v1.50.23 从 render_terrain.js 原位迁出。
// drawAccentEntity 由 render_world.js::drawWorldEntities() 的统一相机深度队列调度
// （DEPTH_ACCENT，远 → 近），**严禁**在 render() 里恢复「整层先画装饰」的调用
// （v1.50.2 历史教训，见 frontend/AGENTS.md §5.9）。
//
// ★ TA-03（v1.50.25）局部三维枝干骨架 + 椭球叶簇 + 稳定脱落次序：
// - 模型：accent-model.js 提供局部三维骨架（主干/主枝/二级枝/细茎 + 叶簇附着点 + shed 次序），
//   全部为 accent.id 的纯函数，暂停/读档/回溯后逐位重建。
// - 投影：局部三维坐标（x/y 水平、z 向上）走与锚点同一套相机变换，相机旋转时树形有空间感；
//   倾干以世界 x 剪切施加（随 accent.rotation 稳定）。
// - 落叶：叶簇按 season.leafDensity 与各自 shed 次序收缩并隐藏（短过渡带淡出），
//   **严禁整冠透明度**（§6.4 红线）；枝条全年保留——冬季裸枝清晰（落叶树余 0~5% 叶量）。
// - 细节分级：★ TA-07 起由 **accent-lod.js 唯一入口**判档（特征尺度 = 主体特征世界尺寸 ×
//   accent.scale × camera.zoom，CSS px；阈值 7/15 带 12% 滞回死区，消除缩放临界闪烁）。
//   远景（far）只保留树形与叶量（簇子集 + 石体两笔），中景（mid）画主枝（segTier 0），
//   近景（near）加二级枝（segTier 1）、簇亮部与春芽；档位只增删图元，不改颜色/几何/画序。
// - 受光：★ TA-04-2（v1.50.33）法线点积管线接入——叶簇/岩面颜色固定走
//   「季节基础色 → SimLighting 漫反射+环境光（法线点积，公式单一来源 shadeRgbInto）→
//   intensity/tint 色温」；冠内体积/AO 分档只保留与视角无关的 tZ 档，投影深度 tD
//   不再参与明暗（同一世界表面转相机不变色）。★ TA-04-3（v1.50.39）枝干圆柱侧面明暗接入——
//   主干三色（朝屏体色 + 迎光带 + 背光带，带位由世界光向屏幕投影驱动）替代旧固定
//   「屏幕左上」树皮亮线；枝条/灌木茎逐段按朝屏法线受光 + 近景迎光侧细高光。
//   ★ TA-04-4（v1.50.40）叶簇宽而弱亮部接入——近景簇亮部中心沿屏幕光向偏移
//   （lighting.js::sunScreenDirFullInto，光近视线时平滑回冠心），颜色经受光管线随簇法线
//   迎光程度衰减，取代 v1.50.27「屏幕固定位置白椭圆」；旧叶簇渐变色板（hi/dapLite/dapDark，
//   v1.50.27 两遍式树冠重构后已无引用）随之移除。
//   ★ TA-04-5（v1.50.45）岩石立体受光几何接入——Boulder 与 RockCluster 子石共用
//   drawStoneBody：相机投影棱柱轮廓（billboard 移除，随相机旋转）+ 带法线顶面/侧面
//   （经 accentLitFill 世界光向点积受光，不固定「顶亮侧暗」）；GrassTuft 不在本任务
//   受光范围（§6.5：保留季相短草线，不新增立体法线）。
//   ★ TA-04-6（v1.50.46）树/灌木贴地投影迁出为地面图元——实体的旧阴影块删除，
//   绘制在 render_shadows.js::drawAccentShadowGround、入队/分发在 render_depth_queue.js
//   （实高驱动影长 + 叶量调制，深度 = 基点/影梢足迹深度取大，不沿用树根/树冠深度）。
// - ★ v1.50.27 漫画风两遍式树冠：叶簇不再逐簇画深色 rim 轮廓（相邻簇叠压处
//   rim 压在邻簇本体上，冠内布满深色分界线，观感像一堆描边气泡），改为
//   Pass A 全簇统一冠影色铺合并剪影 + Pass B 逐簇体积明暗（下暗上亮、远暗近亮）。
//
// ★ TA-11-6（07 号 §6.7/§10.2）渲染热路径零 GC：模块级持久刮擦缓冲（碎石池 /
//   冠簇池 Tree·Bush 共用；★ v1.50.39 起草叶池随 GrassTuft 绘制迁往 render_grass.js）
//   + projTo 复用点投影 + shearNormalInto / lightShadowOffset(out)
//   零分配法线与阴影偏移 + 稳定性插入排序替代 items.sort()——装饰绘制循环稳态零逐帧堆分配
//   （池条目只在容量不足时创建，字段每帧整体覆写；刮擦对象严禁跨绘制调用持有）。
//
// 职责分工（§6.7）：
// - accent-season.js：季相与物种曲线（window.SimTreeTint 唯一生产者）
// - accent-model.js：稳定形态派生（★ TA-06 三乔木轮廓 + 三灌木变体 + 花位）+ 个体模型缓存
// - 本文件：模型投影、色板与色差、细节分级（判档走 AccentLOD）、Tree/Boulder/RockCluster 绘制入口
// - ★ render_bush.js（TA-06-5 自本文件迁出）：灌木（Bush）绘制与花朵图元；复用本文件的
//   模块级共享刮擦与受光工具，必须晚于本文件加载（index.html 已按序注册）
//
// ★ TA-06（07 号 §6.3）三乔木轮廓接入：drawAccentTree 按 model.species.silhouette 落笔，
//   但**画序不分支**——阔冠（宽扁冠）/疏冠（簇少而分散，冠内自然出空隙）/锥形常绿（轮生层
//   枝序 + 扁椭簇 + 收敛倾干）的差异全部来自 accent-model.js 输出的骨架几何；冠幅/干高/
//   扁压/倾干幅度一律读模型（§3.8 单一几何真相源，连带修正旧三处硬编码漂移）。
//
// ★ D-B1-6（06 号文 §5.5 / §5.7 Canvas 行）：新增 RockCluster / GrassTuft 两分支——
// RockCluster 由 anchor 按 accent.id 前端派生 2–5 颗子石（不建实体、不改碰撞/路面）；
// GrassTuft 3–6 根短草线（★ v1.50.39 起绘制与季相色派生在 render_grass.js，本文件
// drawAccentEntity 只做分发），颜色由前端按当前季节派生（同 Tree，不读存档 tint，14 号 §7.4）。
// 未知 kind 直接跳过并计数，开发模式（🐞 调试开关）下限频报警，**严禁错画成 Bush**。
//
// 依赖全局: ctx, camera, sim, w, h, MAP_Z_LIFT（render_world.js 定义，渲染期可用）、
//   lightShadowOffset（render_world.js）、window.SimTreeTint（accent-season.js）、
//   window.AccentModel（accent-model.js，须先于本文件加载）、
//   window.AccentLOD（accent-lod.js，★ TA-07 判档/包围体唯一入口，24b 位须早于本文件）、
//   window.RENDER_CONFIG。

// ★ v1.50.2 D-A：Accent 装饰（Tree/Boulder/Bush）单实体绘制入口
// 现统一并入 render_world.js::drawWorldEntities() 的相机深度队列（远 → 近），
// 与 POI 标记 / 私产宅舍 / 部落民同队列排序，近处乔木可正确遮挡远处道路与小人。

// ★ D-B1-6：未知 kind 计数报警（06 号 §5.5 末段：未知 kind 直接跳过并在开发模式
// 计数报警，不能默默按 Bush 绘制）。计数全量累计；日志在开发模式（sim.debugMode，
// 与主界面 🐞 调试开关同源）下按 3s 限频汇总输出，避免每帧刷屏。
var _unknownAccentKinds = Object.create(null);
var _unknownAccentWarnAt = 0;
function _reportUnknownAccent(kind) {
  _unknownAccentKinds[kind] = (_unknownAccentKinds[kind] || 0) + 1;
  if (sim && sim.debugMode) {
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - _unknownAccentWarnAt > 3000) {
      _unknownAccentWarnAt = now;
      var parts = Object.keys(_unknownAccentKinds).map(function (k) { return k + '×' + _unknownAccentKinds[k]; });
      console.warn('[render_accents] 未注册装饰种类（已跳过，不按既有类型错画）:', parts.join(', '));
    }
  }
}

// ★ TA-04-2 世界光向受光唯一入口（公式单一来源 = lighting.js::shadeRgbInto，本层不复制光照公式）：
// 基础色 → 漫反射+环境光（法线点积）→ intensity/tint 色温，再乘与视角无关的体积/AO 系数 kAo
// 出 fill 色。基色/out 数组模块级复用（逐簇高频路径零分配）；SimLighting 缺席时退回基色
// （加载顺序已保证，仅防御）。法线须经模型变换（含剪切逆转置）转到世界空间后传入，内部再归一化。
// ★ TA-04-3 可选第 8 参 alpha：传了出 rgba()（枝干明暗带以透明度叠在体色上混圆柱侧面渐变）。
// ★ WebGL 石体迁移：_litFinal 记录最终舍入数值色（与 fillStyle 串同源），WebGLStoneLayer
//   sink 路径消费——GL 侧不重复受光公式，保证画风逐位一致。
var _litBase = [0, 0, 0];
var _litOut = [0, 0, 0];
var _litFinal = [0, 0, 0];
function accentLitFill(baseR, baseG, baseB, nx, ny, nz, kAo, alpha) {
  const SL = window.SimLighting;
  if (SL && SL.shadeRgbInto) {
    _litBase[0] = baseR; _litBase[1] = baseG; _litBase[2] = baseB;
    SL.shadeRgbInto(_litBase, nx, ny, nz, _litOut);
  } else {
    _litOut[0] = baseR; _litOut[1] = baseG; _litOut[2] = baseB;
  }
  const r = Math.max(0, Math.min(255, Math.round(_litOut[0] * kAo)));
  const g = Math.max(0, Math.min(255, Math.round(_litOut[1] * kAo)));
  const b = Math.max(0, Math.min(255, Math.round(_litOut[2] * kAo)));
  _litFinal[0] = r / 255; _litFinal[1] = g / 255; _litFinal[2] = b / 255;
  if (alpha === undefined) return 'rgb(' + r + ', ' + g + ', ' + b + ')';
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha.toFixed(3) + ')';
}

// ★ TA-04-3 枝干圆柱侧面明暗几何（07 号 §6.5 第 2 段「枝干用少量侧面明暗表达圆柱体，
// 不以相机正面定义迎光面」）：主干 / 枝条 / 灌木茎共用，本函数只做几何、不含光照公式
// （颜色由调用方经 accentLitFill 单一入口求）。约定：
// - 输入为**模型空间**量：单位轴向 (ax,ay,az)、模型空间光向/视向（调用方已做倾干剪切
//   逆变换 x' = x − s·z，剪切依赖 accent.rotation 故不入模型缓存）；
// - 输出三支**世界空间**代表法线（写入模块级刮擦）：_cylLit 迎光（光向垂直轴向分量）、
//   _cylDark 背光（其反向）、_cylFront 朝屏（视向垂直轴向分量 = 圆柱可见面平均朝向），
//   世界化走 AccentModel.shearNormalInto（剪切逆转置 n' = (nx, ny, nz − s·nx)）；
// - _cylScr = 迎光侧的**屏幕偏移单位方向**（模型分量走方向剪切 + 相机投影，与几何同一套
//   变换）：ok=false 表示退化（光向与轴向平行，或投影长度 ≈ 0），调用方跳过明暗带。
var _ld = { x: 0, y: 0, z: 0 };              // 世界光向刮擦（drawAccentEntity 每实体经 lightDirInto 刷新）
var _sunScr = { x: 0, y: 0, len: 0, valid: false }; // 屏幕光向刮擦（TA-04-4 叶簇亮部偏移方向，每实体经 sunScreenDirFullInto 刷新）
var _cylLit = { x: 0, y: 0, z: 0 };
var _cylDark = { x: 0, y: 0, z: 0 };
var _cylFront = { x: 0, y: 0, z: 0 };
var _cylScr = { x: 0, y: 0, ok: false };
function cylinderShade(ax, ay, az, shear, lmx, lmy, lmz, vmx, vmy, vmz, cosZ, sinZ, cosX, sinX) {
  const dL = lmx * ax + lmy * ay + lmz * az;
  let nx = lmx - dL * ax, ny = lmy - dL * ay, nz = lmz - dL * az;
  const nl = Math.hypot(nx, ny, nz);
  if (nl > 1e-4) { nx /= nl; ny /= nl; nz /= nl; }
  else { nx = 0; ny = 0; nz = 1; }            // 光向 ∥ 轴向：各侧同色，_cylScr.ok 仍按投影判定
  window.AccentModel.shearNormalInto(nx, ny, nz, shear, _cylLit);
  window.AccentModel.shearNormalInto(-nx, -ny, -nz, shear, _cylDark);
  const dV = vmx * ax + vmy * ay + vmz * az;
  let fx = vmx - dV * ax, fy = vmy - dV * ay, fz = vmz - dV * az;
  const fl = Math.hypot(fx, fy, fz);
  if (fl > 1e-4) { fx /= fl; fy /= fl; fz /= fl; }
  else { fx = nx; fy = ny; fz = nz; }         // 轴向正对相机：朝屏面退化，取迎光法线兜底
  window.AccentModel.shearNormalInto(fx, fy, fz, shear, _cylFront);
  const wx = nx + shear * nz;
  const ex = wx * cosZ - ny * sinZ;
  const ey = (wx * sinZ + ny * cosZ) * cosX - nz * sinX;
  const sl = Math.hypot(ex, ey);
  if (sl > 1e-4) { _cylScr.x = ex / sl; _cylScr.y = ey / sl; _cylScr.ok = true; }
  else { _cylScr.x = 0; _cylScr.y = 0; _cylScr.ok = false; }
}

// ★ TA-04-3 明暗带参数读取（config.render.js；缺省回退与集中值一致；★ TA-11-6 零 GC
// 写入模块级复用对象，每装饰每帧 1 次）
var _barkCfg = { offK: 0.38, wK: 0.5, litA: 0.55, darkA: 0.4, minPx: 2 };
function barkBandCfg() {
  const RC = window.RENDER_CONFIG || {};
  const v = RC.accentBarkBandOffset; if (Number.isFinite(v)) _barkCfg.offK = v;
  const w = RC.accentBarkBandWidthK; if (Number.isFinite(w)) _barkCfg.wK = w;
  const la = RC.accentBarkBandLitAlpha; if (Number.isFinite(la)) _barkCfg.litA = la;
  const da = RC.accentBarkBandDarkAlpha; if (Number.isFinite(da)) _barkCfg.darkA = da;
  const mp = RC.accentBarkBandMinWidthPx; if (Number.isFinite(mp)) _barkCfg.minPx = mp;
  return _barkCfg;
}

// ★ TA-04-4 叶簇亮部参数读取（config.render.js；缺省回退与集中值一致；零 GC 写入复用对象）
var _crownCfg = { offK: 0.45, rxK: 0.55, ryK: 0.42, alpha: 0.16, minPx: 2.2 };
function crownLitCfg() {
  const RC = window.RENDER_CONFIG || {};
  const o = RC.accentCrownLitOffset; if (Number.isFinite(o)) _crownCfg.offK = o;
  const rx = RC.accentCrownLitRxK; if (Number.isFinite(rx)) _crownCfg.rxK = rx;
  const ry = RC.accentCrownLitRyK; if (Number.isFinite(ry)) _crownCfg.ryK = ry;
  const a = RC.accentCrownLitAlpha; if (Number.isFinite(a)) _crownCfg.alpha = a;
  const mp = RC.accentCrownLitMinPx; if (Number.isFinite(mp)) _crownCfg.minPx = mp;
  return _crownCfg;
}

// ★ TA-11-6 渲染热路径零 GC（07 号 §6.7/§10.2）：模块级持久刮擦缓冲，跨帧复用，
// 稳态零逐帧堆分配。纪律：① 池条目只在容量不足时创建，字段每帧整体覆写；
// ② 投影/法线/阴影偏移写入复用点对象（projTo / shearNormalInto / _shadowOffset），
// 严禁返回字面量对象；③ 排序用稳定性插入排序 _sortScratch（n ≤ 16，无 sort() 闭包
// 与临时包装分配，等深度次序与 Array.prototype.sort 一致）；④ 刮擦对象严禁跨绘制
// 调用持有（同帧顺序复用，无重入）。
var _ptA = { x: 0, y: 0, d: 0 }; // 共享投影点刮擦（各绘制函数内即取即用）
var _ptB = { x: 0, y: 0, d: 0 };
var _ptC = { x: 0, y: 0, d: 0 };
var _ptD = { x: 0, y: 0, d: 0 };
var _nrm = { x: 0, y: 0, z: 0 };         // 倾干剪切法线刮擦（shearNormalInto 消费）
var _so = { x: 0, y: 0, alphaScale: 1 }; // 贴地阴影偏移刮擦（lightShadowOffset out 参数消费）

// 碎石池条目 { st, g:{x,y,d} }；冠簇池条目（Tree/Bush 共用）{ c, px, py, pd, rr, v }；
// （草叶池 { b, bx, by, tx, ty, h, d } 已随 GrassTuft 绘制迁往 render_grass.js）。
var _rockScratchPool = [];
var _crownScratchPool = [];
function _rockScratch(i) {
  const p = _rockScratchPool;
  while (p.length <= i) p.push({ st: null, g: { x: 0, y: 0, d: 0 }, d: 0 }); // d 镜像 g.d（扁平排序键）
  return p[i];
}
function _crownScratch(i) {
  const p = _crownScratchPool;
  while (p.length <= i) p.push({ c: null, px: 0, py: 0, pd: 0, rr: 0, v: 0 });
  return p[i];
}

// 稳定性插入排序（升序，按条目 key 字段）：n 小（叶 ≤ 6 / 簇 ≤ 24 / 石 ≤ 5），零分配。
function _sortScratch(pool, n, key) {
  for (let i = 1; i < n; i++) {
    const it = pool[i];
    const k = it[key];
    let j = i - 1;
    while (j >= 0 && pool[j][key] > k) { pool[j + 1] = pool[j]; j--; }
    pool[j + 1] = it;
  }
}

// ★ v1.50.84 WebGL 装饰层 sink 分发辅助：二次贝塞尔展平（写 _flatX/_flatY 自 off 起，返回新点数）。
// 供树干轮廓 / 明暗带 / 枝条 / 灌木茎 / 草叶在 GL 路径下的折线化（Canvas 曲线 → GL 折线，
// 8 段展平在 AA 下与 Canvas 曲线不可辨）。渲染热路径零分配（模块级刮擦，无重入）。
var _flatX = new Float64Array(24);
var _flatY = new Float64Array(24);
function _flattenQuad(off, x0, y0, cx, cy, x1, y1) {
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n, mt = 1 - t;
    _flatX[off + i] = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    _flatY[off + i] = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
  }
  return off + n + 1;
}

// 贴地阴影偏移零分配包装（render_world.js::lightShadowOffset 的 out 参数消费）
function _shadowOffset(legacyX, legacyY, height) {
  if (typeof lightShadowOffset === 'function') return lightShadowOffset(legacyX, legacyY, height, _so);
  _so.x = legacyX * camera.zoom;
  _so.y = legacyY * camera.zoom;
  _so.alphaScale = 1;
  return _so;
}

// ★ TA-07-6：第二参 it = 统一深度队列项（可选）。入队端已完成两级剔除并把屏幕 AABB
//   （s1x/s1y = 左下、s2x/s2y = 右上）与锚点屏幕坐标（ex/ey）写入深度项，绘制端直接消费
//   ——**入队端与绘制端共用同一个 AABB**（§3.5 口径唯一红线，杜绝「入队却被绘制端剔掉」
//   或「没入队但本会画」的漏画）。缺省（独立调用/剔除关态）时内部按 AccentLOD 自算。
function drawAccentEntity(accent, it) {
  const kind = accent.kind;
  // ★ D-B1-6：只放行已实现分支；未知 kind（含未来新增未绘制类型）跳过 + 计数报警
  if (kind !== 'Tree' && kind !== 'Boulder' && kind !== 'Bush' &&
      kind !== 'RockCluster' && kind !== 'GrassTuft') {
    _reportUnknownAccent(String(kind));
    return;
  }

  const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
  const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
  const scale = camera.zoom;
  let sx, sy;
  if (it) {
    sx = it.ex; sy = it.ey;           // 零重投影：直接消费入队端锚点屏幕坐标
  } else {
    // 独立调用（无深度项）：自行投影（与地形/世界实体同一套 3D → 屏幕变换）
    const rx0 = accent.x * cosZ - accent.y * sinZ;
    const ry0 = accent.x * sinZ + accent.y * cosZ;
    const az0 = (accent.z || 0) + MAP_Z_LIFT; // ★ v1.50.12 精灵锚点略抬于地表（render_world.js 定义）
    sx = w / 2 + camera.panX + rx0 * scale;
    sy = h / 2 + camera.panY + (ry0 * cosX - az0 * sinX) * scale;
  }
  // 剔除：入队端已剔除（it.lod===1）时不再重剔；独立调用或剔除关态时按 AccentLOD 自算
  // （一级 kind 级保守常数 AABB）——旧「24 + 44×zoom / 24 + 14×zoom」启发余量已删除（§2.3-2）。
  if (!it || it.lod !== 1) {
    const AL = window.AccentLOD;
    if (AL && AL.cfg().cullOn) {
      const kb = AL.kindBounds(kind);
      const a0 = AL.aabbOf(sx, sy, kb, AL.SHEAR_MAX, accent.scale * scale, cosX, sinX, AL.aabb);
      if (!AL.visible(a0)) return;
    }
  }

  // ★ TA-04-3 世界光向刷新（零分配 Into 变体；主干/枝条/茎圆柱侧面明暗共用；
  // SimLighting 缺席时置零——cylinderShade 各向退化，各侧同色安全兜底）
  const SL = window.SimLighting;
  if (SL && SL.lightDirInto) SL.lightDirInto(_ld);
  else { _ld.x = 0; _ld.y = 0; _ld.z = 0; }
  // ★ TA-04-4 屏幕光向刷新（世界光向完整屏幕投影，叶簇亮部偏移方向共用；缺席时置零回冠心）
  if (SL && SL.sunScreenDirFullInto) SL.sunScreenDirFullInto(_sunScr);
  else { _sunScr.x = 0; _sunScr.y = 0; _sunScr.len = 0; _sunScr.valid = false; }

  // Tree/Bush/GrassTuft 共用连续季相（TA-02/D-B1-6；GrassTuft 同 Tree 逻辑，颜色按当前
  // 季节派生，不读存档 tint）。★ TA-06-2：profile 走**单一入口 model.profile**
  // （speciesOf 由 (kind,id) 纯函数派生：阔冠/疏冠 → deciduousTree、锥形常绿 → evergreen、
  // 落叶多茎 → deciduousBush、花灌木 → floweringBush、低矮常绿 → evergreen；非 Tree/Bush
  // 为 undefined，GrassTuft 仍回退 deciduousTree——非植被零影响）。
  const model = window.AccentModel.get(accent);
  const season = (kind === 'Boulder' || kind === 'RockCluster') ? null
    : window.SimTreeTint.sample(accent, sim, model.profile);

  const scaled = accent.scale * scale;
  if (kind === 'Tree') {
    drawAccentTree(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX);
  } else if (kind === 'Boulder') {
    drawAccentBoulder(accent, sx, sy, scaled, model, cosZ, sinZ, cosX, sinX);
  } else if (kind === 'Bush') {
    drawAccentBush(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX);
  } else if (kind === 'RockCluster') {
    drawAccentRockCluster(accent, sx, sy, scaled, model, cosZ, sinZ, cosX, sinX);
  } else {
    drawAccentGrassTuft(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX); // render_grass.js（v1.50.39 迁出）
  }
}

// ★ TA-07：三档阈值读取与判档**全部**迁往 accent-lod.js（口径唯一，§2.3-1 漂移收口）——
// 本文件不再保留 accentDetailLevels 本地实现，一律走 window.AccentLOD.tierFor(...)。

// 叶簇脱落可见度（§6.4：先变色后减叶，短过渡带收缩淡出，禁止整冠透明度）。
// leaf: season.leafDensity(0..1)；shed: 簇稳定脱落次序(0 先落 → 1 后落)；fade: 过渡带宽度。
// v=1 全尺寸；v 随 leaf 下降按次序收缩到 0（春季萌芽自动按同一批位置恢复）。
function accentClusterVisibility(leaf, shed, fade) {
  const t = (leaf * (1 + fade) - shed) / fade;
  return t <= 0 ? 0 : (t >= 1 ? 1 : t);
}

// Tree：局部三维骨架乔木 —— 锥形倾干 + 主枝/二级枝 + 枝端椭球叶簇（贴地投影归 render_shadows.js）
// scaled = accent.scale(0.7~1.4) × camera.zoom；season 为 TA-02 连续季相输出。
// ★ TA-06-6 三轮廓接入：冠幅/干高/扁压/倾干幅度全部读模型（sk.crownR / sk.trunkH /
//   sk.crownSquash / sk.leanShearK，§3.8 单一几何真相源）；锥形常绿走轮生层枝序 + 扁椭簇 +
//   收敛倾干（针叶树挺直读感）；疏冠簇少而分散（靠簇数与半径自然出冠内空隙），两遍式树冠画序
//   对所有轮廓一致——绘制层不按轮廓改画序，差异全部来自模型几何。
// ★ TA-11-6 零 GC：投影走 projTo 复用点（top=_ptA / 枝 a=_ptB / 枝 b=_ptC / 簇·芽=_ptD），
// 叶簇收集走 _crownScratchPool 冠簇池，簇间排序走稳定性插入排序（原 items.sort 闭包移除）。
function drawAccentTree(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX) {
  const sk = model.skeleton;
  const squash = sk.crownSquash || 0.78;   // ★ TA-06：冠簇扁压系数（锥形常绿更扁）
  const crownR = (sk.crownR || 8.5) * scaled;
  const trunkH = sk.trunkH * scaled;
  const leaf = season.leafDensity;
  const brown = season.brownness;
  // ★ TA-07 三档判档（AccentLOD 唯一入口；featurePx = 模型冠幅 × accent.scale × zoom，
  //   阈值 7/15 带滞回 ⇒ 缩放穿越阈值不闪烁）。detailMid = tier ≥ 中景，detailNear = tier ≥ 近景。
  const tier = window.AccentLOD.tierFor(accent, 'Tree', model, scaled);
  const detailMid = tier >= window.AccentLOD.MID;
  const detailNear = tier >= window.AccentLOD.NEAR;
  // ★ v1.50.84 WebGL 装饰层：GL 模式登记本株深度（画家序不变，深度对齐地形），后续图元
  //   经 sink 分发（几何/配色与 Canvas 单一同源）；sinkOn=false 走 Canvas 现状路径。
  var sink = (window.WebGLAccentLayer && window.WebGLAccentLayer.sinkOn) ? window.WebGLAccentLayer : null;
  if (sink !== null) sink.beginAccent(accent.x, accent.y, accent.z);

  // 贴地投影已迁出为地面图元（★ TA-04-6：入队/分发归 render_depth_queue.js，绘制归
  // render_shadows.js::drawAccentShadowGround——实高驱动影长 + 叶量调制，**严禁**在实体内恢复旧阴影）

  // 倾干剪切（世界 x，随个体 rotation 稳定；★ TA-06：幅度按轮廓收敛，锥形常绿挺直）
  // ★ TA-07：单一来源迁往 AccentLOD.leanShear（包围体与绘制共用同一公式，杜绝漂移）
  const leanShear = window.AccentLOD.leanShear(accent, model);

  // 局部三维 → 屏幕：与锚点同一套相机变换（★ TA-11-6 写入复用点，零分配）；
  // d 越大越靠近视点（同深度队列公式）
  function projTo(dx, dy, dz, out) {
    const wx = dx + leanShear * dz;
    const rx = wx * cosZ - dy * sinZ;
    const ry = wx * sinZ + dy * cosZ;
    out.x = sx + rx * scaled;
    out.y = sy + (ry * cosX - dz * sinX) * scaled;
    out.d = ry * sinX + dz * cosX;
  }

  // 主干：底粗顶细的锥形曲干（沿用 v1.49.3 形状，顶点改由三维投影得出）
  const top = _ptA;
  projTo(0, 0, sk.trunkH, top);
  const bw = Math.max(1.2, crownR * 0.17);
  const tw = Math.max(0.6, bw * 0.45);

  // ★ TA-04-3 枝干受光（§6.5「枝干用少量侧面明暗表达圆柱体」）：模型空间光向/视向
  // （倾干剪切逆变换 x' = x − s·z）；主干轴向随剪切倾斜，三色 = 朝屏体色 / 迎光带 / 背光带，
  // 全部经 accentLitFill 单一入口——转相机或改光向，迎光面始终朝向世界光源。
  const lmx = _ld.x - leanShear * _ld.z, lmy = _ld.y, lmz = _ld.z;
  const wvx = sinZ * sinX, wvy = cosZ * sinX, wvz = cosX; // 世界视向（投影深度增方向）
  const vmx = wvx - leanShear * wvz, vmy = wvy, vmz = wvz;
  cylinderShade(0, 0, 1, leanShear, // 模型存直立骨架：模型轴 = (0,0,1)，剪切由本层施加
    lmx, lmy, lmz, vmx, vmy, vmz, cosZ, sinZ, cosX, sinX);
  const barkR = 86, barkG = 62, barkB = 42;

  const bodyFill = accentLitFill(barkR, barkG, barkB, _cylFront.x, _cylFront.y, _cylFront.z, 1);
  const outlineW = Math.max(0.4, 0.45 * scaled);
  if (sink !== null) {
    // 主体：左右两条二次曲线边之间的条带（与 Canvas 同一 path 闭合多边形精确三角化）
    sink.ribbonQuad(sx - bw, sy, sx - bw * 0.45, sy - trunkH * 0.55, top.x - tw, top.y,
      sx + bw, sy, sx + bw * 0.45, sy - trunkH * 0.55, top.x + tw, top.y,
      _litFinal[0], _litFinal[1], _litFinal[2], 1);
    // 轮廓描边（闭环 18 点：左曲线 L0..L8 → 右曲线 R8..R0，闭合边即底边；miter join 同 Canvas）
    let np = _flattenQuad(0, sx - bw, sy, sx - bw * 0.45, sy - trunkH * 0.55, top.x - tw, top.y);
    np = _flattenQuad(np, top.x + tw, top.y, sx + bw * 0.45, sy - trunkH * 0.55, sx + bw, sy);
    sink.polyStroke(_flatX, _flatY, np, true, outlineW, 40 / 255, 28 / 255, 18 / 255, 0.38, false);
  } else {
    ctx.fillStyle = bodyFill;
    ctx.strokeStyle = 'rgba(40, 28, 18, 0.38)';
    ctx.lineWidth = outlineW;
    ctx.beginPath();
    ctx.moveTo(sx - bw, sy);
    ctx.quadraticCurveTo(sx - bw * 0.45, sy - trunkH * 0.55, top.x - tw, top.y);
    ctx.lineTo(top.x + tw, top.y);
    ctx.quadraticCurveTo(sx + bw * 0.45, sy - trunkH * 0.55, sx + bw, sy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // ★ TA-04-3 侧面明暗带（替代旧「固定屏幕左上」树皮亮线 v1.49.3 遗留）：带位由世界光向
  //   的屏幕投影决定，clip 进干轮廓防溢出；远景干宽不足 minWidthPx 时省略（亚像素噪声）。
  const bb = barkBandCfg();
  if (bw >= bb.minPx && _cylScr.ok) {
    const ob = bw * bb.offK, ot = tw * bb.offK, om = (ob + ot) * 0.5;
    const bandW = Math.max(0.4, bw * bb.wK);
    const litBand = accentLitFill(barkR, barkG, barkB, _cylLit.x, _cylLit.y, _cylLit.z, 1, bb.litA);
    const darkBand = accentLitFill(barkR, barkG, barkB, _cylDark.x, _cylDark.y, _cylDark.z, 1, bb.darkA);
    if (sink !== null) {
      // 明暗带：两条开折线描边（平头，同 Canvas 默认 lineCap）。
      // Canvas 的 clip 防溢出在 GL 侧省略——带外缘与干轮廓间隙恒 ≥ 0（带偏移系数推导，
      // 残余溢出 ≤ 0.04×干宽，亚像素级），详见 changelog v1.50.84。
      let np = _flattenQuad(0,
        sx + _cylScr.x * ob, sy + _cylScr.y * ob,
        sx + _cylScr.x * om, sy - trunkH * 0.55 + _cylScr.y * om,
        top.x + _cylScr.x * ot, top.y + _cylScr.y * ot);
      sink.polyStroke(_flatX, _flatY, np, false, bandW, _litFinal[0], _litFinal[1], _litFinal[2], bb.litA, false);
      // 暗带（_litFinal 已被 darkBand 调用覆写为暗带色）
      np = _flattenQuad(0,
        sx - _cylScr.x * ob, sy - _cylScr.y * ob,
        sx - _cylScr.x * om, sy - trunkH * 0.55 - _cylScr.y * om,
        top.x - _cylScr.x * ot, top.y - _cylScr.y * ot);
      sink.polyStroke(_flatX, _flatY, np, false, bandW, _litFinal[0], _litFinal[1], _litFinal[2], bb.darkA, false);
    } else {
      ctx.save();
      ctx.beginPath(); // 重建干轮廓作 clip（明暗带严格留在圆柱投影内）
      ctx.moveTo(sx - bw, sy);
      ctx.quadraticCurveTo(sx - bw * 0.45, sy - trunkH * 0.55, top.x - tw, top.y);
      ctx.lineTo(top.x + tw, top.y);
      ctx.quadraticCurveTo(sx + bw * 0.45, sy - trunkH * 0.55, sx + bw, sy);
      ctx.closePath();
      ctx.clip();
      ctx.lineWidth = bandW;
      ctx.strokeStyle = litBand;
      ctx.beginPath();
      ctx.moveTo(sx + _cylScr.x * ob, sy + _cylScr.y * ob);
      ctx.quadraticCurveTo(sx + _cylScr.x * om, sy - trunkH * 0.55 + _cylScr.y * om,
        top.x + _cylScr.x * ot, top.y + _cylScr.y * ot);
      ctx.stroke();
      ctx.strokeStyle = darkBand;
      ctx.beginPath();
      ctx.moveTo(sx - _cylScr.x * ob, sy - _cylScr.y * ob);
      ctx.quadraticCurveTo(sx - _cylScr.x * om, sy - trunkH * 0.55 - _cylScr.y * om,
        top.x - _cylScr.x * ot, top.y - _cylScr.y * ot);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 枝条骨架（全年保留——冬季裸枝的主体，§6.4）
  // ★ TA-04-3：枝条走同一受光管线——基色按「朝屏法线」（视向垂直段轴向分量）受光，
  //   转相机/光向明暗随动；段宽可辨时沿迎光侧补一条细高光（少量侧面明暗，不逐段贴图）。
  if (detailMid) {
    ctx.lineCap = 'round';
    // ★ TA-07 分级：中景只画主枝（segTier 0），二级枝（segTier 1）移入近景——与 07 号
    //   §6.7「中景绘制主要枝簇、近景增加细枝」口径一致（旧实现把两者混在同一数组全画）。
    const segTier = sk.segTier;
    const segN = sk.segments.length;
    for (let i = 0; i < segN; i++) {
      if (!detailNear && segTier && segTier[i] === 1) continue;
      const seg = sk.segments[i];
      const a = _ptB, b = _ptC;
      projTo(seg.x1, seg.y1, seg.z1, a);
      projTo(seg.x2, seg.y2, seg.z2, b);
      const lwSeg = Math.max(0.5, bw * seg.wK);
      const dxs = seg.x2 - seg.x1, dys = seg.y2 - seg.y1, dzs = seg.z2 - seg.z1;
      const segLen = Math.hypot(dxs, dys, dzs) || 1;
      cylinderShade(dxs / segLen, dys / segLen, dzs / segLen, leanShear,
        lmx, lmy, lmz, vmx, vmy, vmz, cosZ, sinZ, cosX, sinX);
      const branchFill = accentLitFill(96, 70, 48, _cylFront.x, _cylFront.y, _cylFront.z, 1);
      if (sink !== null) {
        // 枝条：开折线描边 + 圆头（同 Canvas lineCap='round' 逐段 stroke 语义）
        // ★ v1.50.89 图元级视深：枝条按近端 3D 视深（两端 projTo().d 取大）测试地形，
        //   陡视角下不再被锚点下前方更近地面裁掉（高光带同段复用同一深度）
        sink.setViewDepth(Math.max(a.d, b.d));
        const np = _flattenQuad(0, a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2 + bw * 0.35, b.x, b.y);
        sink.polyStroke(_flatX, _flatY, np, false, lwSeg, _litFinal[0], _litFinal[1], _litFinal[2], 1, true);
      } else {
        ctx.strokeStyle = branchFill;
        ctx.lineWidth = lwSeg;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        // 控制点取中点略下垂，枝条微弯不僵硬
        ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + bw * 0.35, b.x, b.y);
        ctx.stroke();
      }
      // 迎光侧细高光（段宽可辨且屏幕迎光方向非退化才画）
      if (lwSeg >= bb.minPx && _cylScr.ok) {
        const o = lwSeg * bb.offK;
        const hiFill = accentLitFill(96, 70, 48, _cylLit.x, _cylLit.y, _cylLit.z, 1, bb.litA);
        if (sink !== null) {
          const np = _flattenQuad(0,
            a.x + _cylScr.x * o, a.y + _cylScr.y * o,
            (a.x + b.x) / 2 + _cylScr.x * o, (a.y + b.y) / 2 + bw * 0.35 + _cylScr.y * o,
            b.x + _cylScr.x * o, b.y + _cylScr.y * o);
          sink.polyStroke(_flatX, _flatY, np, false, lwSeg * bb.wK, _litFinal[0], _litFinal[1], _litFinal[2], bb.litA, true);
        } else {
          ctx.strokeStyle = hiFill;
          ctx.lineWidth = lwSeg * bb.wK;
          ctx.beginPath();
          ctx.moveTo(a.x + _cylScr.x * o, a.y + _cylScr.y * o);
          ctx.quadraticCurveTo((a.x + b.x) / 2 + _cylScr.x * o,
            (a.y + b.y) / 2 + bw * 0.35 + _cylScr.y * o, b.x + _cylScr.x * o, b.y + _cylScr.y * o);
          ctx.stroke();
        }
      }
    }
    ctx.lineCap = 'butt';
  }

  // 叶簇：按 leafDensity × shed 次序收缩隐藏（§6.4）；色差随 brownness 加深（秋色簇间先后）
  // ★ v1.50.27 漫画风两遍式树冠：Pass A 全簇统一冠影色铺合并剪影 + Pass B 逐簇体积明暗。
  //   ★ TA-11-6 零 GC：可见簇收集进冠簇池（字段覆写，稳态零分配）。
  const lw = Math.max(0.4, 0.5 * scaled);
  const fade = 0.09;
  const jitterAmp = 6 + 26 * brown;
  // ★ TA-07 远景档取**簇子集**（模型层按簇半径降序预生成的索引表，id 纯函数入缓存）；
  //   子集内簇仍走 Pass A 单 path 并集剪影（v1.50.27 纪律：否则远景树冠退化成离散气泡）。
  const farIdx = (tier === window.AccentLOD.FAR) ? model.farClusters : null;
  const clN = farIdx ? farIdx.length : sk.clusters.length;
  let nItems = 0;
  for (let k = 0; k < clN; k++) {
    const c = farIdx ? sk.clusters[farIdx[k]] : sk.clusters[k];
    const v = accentClusterVisibility(leaf, c.shed, fade);
    if (v < 0.06) continue;
    const p = _ptD;
    projTo(c.x, c.y, c.z, p);
    // 簇级视口剔除（二级兜底；★ TA-07 补 x 判据——旧实现只判 y，横向越界簇仍进池）
    if (p.y < -40 || p.y > h + 40 || p.x < -40 || p.x > w + 40) continue;
    const rr = c.r * scaled * v;
    if (rr < 0.5) continue;
    const it = _crownScratch(nItems++);
    it.c = c; it.px = p.x; it.py = p.y; it.pd = p.d; it.rr = rr; it.v = v;
  }
  _sortScratch(_crownScratchPool, nItems, 'pd'); // 簇间画家排序：远 → 近（稳定）

  // 冠内体积/AO 分档基准：对整副骨架（非当帧可见簇）求 z 范围——
  // 秋季掉叶时幸存簇的明暗不随可见集跳变；纯 id 派生，读档/回溯逐位一致。
  // ★ TA-04-2：投影深度 tD 不再参与明暗（同一世界表面转相机不变色），只留与视角无关的 tZ 档
  let zLo = Infinity, zHi = -Infinity;
  for (let i = 0; i < sk.clusters.length; i++) {
    const c = sk.clusters[i];
    if (c.z < zLo) zLo = c.z;
    if (c.z > zHi) zHi = c.z;
  }
  const zSpan = Math.max(0.001, zHi - zLo);

  // Pass A：树冠剪影——单 path 全簇一次填充（重叠即并集，零簇间分界线）；
  // 扩边随簇半径（外缘云边厚度均匀，小簇空隙也被填满）；冠影色 = 叶色压暗偏冷
  // ★ GL 路径：逐簇发不透明椭圆——并集观感与单 path 填充一致（不透明叠涂无接缝）
  const paR = Math.min(255, Math.round(season.leafColor[0] * 0.50 + 4));
  const paG = Math.min(255, Math.round(season.leafColor[1] * 0.58 + 8));
  const paB = Math.min(255, Math.round(season.leafColor[2] * 0.62 + 14));
  if (sink !== null) {
    const ar = paR / 255, ag = paG / 255, ab = paB / 255;
    for (let i = 0; i < nItems; i++) {
      const it = _crownScratchPool[i];
      const sw = lw + it.rr * 0.16;
      // ★ v1.50.89 图元级视深：叶簇椭圆按簇心 3D 视深 + 簇世界半径（billboard 近端补偿）——
      //   俯视时叶簇下部不再被锚点下前方更近地面整片裁切（Pass B/亮部同簇同深度）
      sink.setViewDepth(it.pd + it.c.r * (accent.scale || 1));
      sink.ellipseRGBA(it.px, it.py, it.rr + sw, it.rr * squash + sw, ar, ag, ab, 1);
    }
  } else {
    ctx.fillStyle = 'rgb(' + paR + ',' + paG + ',' + paB + ')';
    ctx.beginPath();
    for (let i = 0; i < nItems; i++) {
      const it = _crownScratchPool[i];
      const sw = lw + it.rr * 0.16;
      ctx.moveTo(it.px + it.rr + sw, it.py);
      ctx.ellipse(it.px, it.py, it.rr + sw, it.rr * squash + sw, 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // Pass B：簇本体（基色 + lite 色差，再乘冠内体积/AO 分档 × 世界光向受光）
  // ★ TA-04-2 颜色管线：季节基础色 → 漫反射+环境光（簇法线点积，accentLitFill 单一入口）
  //   → intensity/tint 色温；体积分档只留与视角无关的 tZ（tD 已移除，转相机不变色）
  const cc = crownLitCfg();
  for (let i = 0; i < nItems; i++) {
    const it = _crownScratchPool[i];
    const c = it.c;
    const j = (c.lite - 0.5) * 2 * jitterAmp;
    const tZ = (c.z - zLo) / zSpan;      // 冠内高度 0 底 → 1 顶（体积/AO 档）
    const kZ = 0.80 + 0.20 * tZ;
    // 簇法线（模型层冠包络外向法线）经倾干剪切逆转置补偿转到世界空间（★ 零 GC Into 变体）
    const wn = window.AccentModel.shearNormalInto(c.nx, c.ny, c.nz, leanShear, _nrm);
    const clusterFill = accentLitFill(season.leafColor[0] + j, season.leafColor[1] + j, season.leafColor[2] + j, wn.x, wn.y, wn.z, kZ);
    if (sink !== null) {
      sink.setViewDepth(it.pd + it.c.r * (accent.scale || 1)); // ★ v1.50.89 同簇同深度（Pass A 口径一致）
      sink.ellipseRGBA(it.px, it.py, it.rr, it.rr * squash, _litFinal[0], _litFinal[1], _litFinal[2], 1);
    } else {
      ctx.fillStyle = clusterFill;
      ctx.beginPath();
      ctx.ellipse(it.px, it.py, it.rr, it.rr * squash, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 近景簇亮部：★ TA-04-4 世界光向投影驱动（v1.50.27 屏幕固定白斑移除）——亮部中心沿
    // 屏幕光向偏移（光近视线经 sunScreenDirFull 平滑回冠心），亮色走受光管线随簇法线
    // 迎光程度自然衰减（取代旧「只给上半冠」tZ 启发式）；宽而弱，避免塑料反光
    if (detailNear && it.rr > cc.minPx) {
      const hiCol = accentLitFill(255, 252, 218, wn.x, wn.y, wn.z, 1, cc.alpha * it.v);
      if (sink !== null) {
        sink.ellipseRGBA(it.px + _sunScr.x * it.rr * cc.offK, it.py + _sunScr.y * it.rr * cc.offK,
          it.rr * cc.rxK, it.rr * cc.ryK, _litFinal[0], _litFinal[1], _litFinal[2], cc.alpha * it.v);
      } else {
        ctx.fillStyle = hiCol;
        ctx.beginPath();
        ctx.ellipse(it.px + _sunScr.x * it.rr * cc.offK, it.py + _sunScr.y * it.rr * cc.offK,
          it.rr * cc.rxK, it.rr * cc.ryK, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 春芽（§6.3/§11.4）：初春叶量未恢复时，主枝端先显芽点；近中景才画
  if (detailMid && season.budAmount > 0.12) {
    const budA = 0.55 * season.budAmount;
    const br = Math.max(0.7, crownR * 0.055);
    if (sink !== null) {
      for (let i = 0; i < sk.branchTips.length; i++) {
        const t = sk.branchTips[i];
        const p = _ptD;
        projTo(t.x, t.y, t.z + 0.3, p);
        sink.setViewDepth(p.d); // ★ v1.50.89 芽点按自身 3D 视深
        sink.ellipseRGBA(p.x, p.y, br, br * 1.3, 198 / 255, 216 / 255, 130 / 255, budA);
      }
    } else {
      ctx.fillStyle = 'rgba(198, 216, 130, ' + budA.toFixed(3) + ')';
      for (let i = 0; i < sk.branchTips.length; i++) {
        const t = sk.branchTips[i];
        const p = _ptD;
        projTo(t.x, t.y, t.z + 0.3, p);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, br, br * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// ── ★ TA-04-5 石体立体受光几何（Boulder 与 RockCluster 子石共用，07 号 §6.5 第 2 段）──
// billboard 移除：底环（z=0 落地）与顶环（抬 h = accentStoneHeightK×r）的世界方位角顶点
// 经相机 rotZ/cosX 投影——轮廓与侧面片随相机旋转，与树/灌木同一套投影约定；
// 侧面逐面片法线 = 面片中点世界水平方向（直立壁 nz=0），顶面法线取地表法线（倾斜面受光
// 随坡度自然变化），亮暗全部由 accentLitFill（世界光向点积）决定。
// ★ v1.50.72 贴合地形：底环/顶环各顶点沿局部地形坡度 (dzdx,dzdy) 偏移 dz = dx·dzdx + dy·dzdy，
// 石体随坡面倾斜、不再水平悬浮；平地 dzdx=dzdy=0 时退化为原始行为。
// 画序：侧面片（方位角序，远侧片随后被顶面覆盖）→ 顶面 → 剪影描边（远侧取顶环 / 近侧取
// 底环，ry 符号判别；两端极端点处竖直过渡即真实剪影竖切线）。底边贴落地点（v1.50.13
// 锚点契约的几何化重述）：cy = gy − max(bot_i)，石体整体落在锚点上方。
// 零 GC：顶点坐标写入模块级 Float64Array 刮擦（sides ≤ 7）；lite 为岩面个体色差通道。
var _stPx = new Float64Array(8);
var _stRy = new Float64Array(8);
var _stGy = new Float64Array(8);
var _stDzS = new Float64Array(8); // 逐顶点地形坡度屏幕 Y 偏移（v1.50.72 贴合地形）
// 地形坡度刮擦（零 GC）：_terrainSlopeAt 写入、drawAccentBoulder / drawAccentRockCluster 消费
var _slope = { dzdx: 0, dzdy: 0 };
function _terrainSlopeAt(wx, wy) {
  var t = sim.terrain;
  if (!t || !t.cells) { _slope.dzdx = 0; _slope.dzdy = 0; return _slope; }
  var gSize = t.gridSize, cells = t.cells;
  var half = cells[gSize * gSize - 1].wx;
  if (!(half > 0)) { _slope.dzdx = 0; _slope.dzdy = 0; return _slope; }
  var gx = Math.max(0, Math.min(gSize - 1, Math.round(((wx + half) / (2 * half)) * (gSize - 1))));
  var gy = Math.max(0, Math.min(gSize - 1, Math.round(((wy + half) / (2 * half)) * (gSize - 1))));
  var cell = cells[gy * gSize + gx];
  _slope.dzdx = cell.dzdx || 0;
  _slope.dzdy = cell.dzdy || 0;
  return _slope;
}
var _BOULDER_SHAPE = (function () {
  const s = [];
  for (let i = 0; i < 7; i++) s.push(0.82 + 0.38 * (((i * 37 + 13) % 7) / 7));
  return s;
})();
if (typeof window !== 'undefined') window._BOULDER_SHAPE = _BOULDER_SHAPE;
function rockHeightK() {
  const v = window.RENDER_CONFIG && window.RENDER_CONFIG.accentStoneHeightK;
  return Number.isFinite(v) ? v : 0.3;
}
function drawStoneBody(gx, gy, r, rot, sides, shape, lite, cosZ, sinZ, cosX, sinX, strokeW, farSimplified, dzdx, dzdy) {
  // ★ v1.50.72 贴合地形：dzdx/dzdy 为落点局部地形坡度（世界单位高程/水平距离），
  // 缺省 0 = 平地，退化为原始水平石体。逐顶点 dz = dx·dzdx + dy·dzdy 偏移底环/顶环，
  // 石体盘面随坡面倾斜；顶面法线取地表法线 (-dzdx,-dzdy,1)/|n|。
  var sDzdx = dzdx || 0, sDzdy = dzdy || 0;
  let maxBot = -Infinity;
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const rv = r * shape[i];
    const ca = Math.cos(a), sa = Math.sin(a);
    _stPx[i] = gx + rv * (ca * cosZ - sa * sinZ);
    _stRy[i] = rv * (ca * sinZ + sa * cosZ);
    // 世界偏移 (dx,dy) = (rv_world·ca, rv_world·sa)；rv 已含 zoom，dz 投影 = rv·(ca·dzdx+sa·dzdy)·sinX
    _stDzS[i] = rv * (ca * sDzdx + sa * sDzdy) * sinX;
    const bot = _stRy[i] * cosX - _stDzS[i];
    if (bot > maxBot) maxBot = bot;
  }
  const cy = gy - maxBot;
  for (let i = 0; i < sides; i++) _stGy[i] = cy + _stRy[i] * cosX - _stDzS[i];
  const hS = r * rockHeightK() * sinX;
  const kL = (lite - 0.5) * 20;
  // ★ WebGL 装饰层：sinkOn 期间图元按 Canvas 同序分发给 WebGLAccentLayer（几何/配色
  //   单一同源，GL 侧零重复公式）；sinkOn=false 走 Canvas 现状路径（笔迹逐位不变）。
  var sink = (window.WebGLAccentLayer && window.WebGLAccentLayer.sinkOn) ? window.WebGLAccentLayer : null;
  // ★ TA-07 远景两笔简化（§3.2/§0.3-3①）：省掉 sides 次侧面片受光（7 次 accentLitFill +
  // 7 次 path），只留顶面 + 剪影描边——轮廓与受光顶面仍在，远景不可辨的侧面明暗不画。
  // 画序（侧面 → 顶面 → 描边）与颜色公式**零改动**，只做图元增删（TA-04 受光红线）。
  for (let k = 0; !farSimplified && k < sides; k++) {
    const k2 = (k + 1) % sides;
    const aM = rot + ((k + 0.5) / sides) * Math.PI * 2;
    const fill = accentLitFill(78 + kL, 74 + kL, 68 + kL, Math.cos(aM), Math.sin(aM), 0, 1);
    if (sink !== null) {
      sink.quad(_stPx[k], _stGy[k], _stPx[k2], _stGy[k2],
        _stPx[k2], _stGy[k2] - hS, _stPx[k], _stGy[k] - hS,
        _litFinal[0], _litFinal[1], _litFinal[2], 1);
    } else {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(_stPx[k], _stGy[k]);
      ctx.lineTo(_stPx[k2], _stGy[k2]);
      ctx.lineTo(_stPx[k2], _stGy[k2] - hS);
      ctx.lineTo(_stPx[k], _stGy[k] - hS);
      ctx.closePath();
      ctx.fill();
    }
  }
  // 顶面法线 = 地表法线（平地退化为 (0,0,1)）
  var nLen = Math.hypot(sDzdx, sDzdy, 1);
  const topFill = accentLitFill(152 + kL, 146 + kL, 138 + kL, -sDzdx / nLen, -sDzdy / nLen, 1 / nLen, 1);
  if (sink !== null) {
    sink.polyRing(_stPx, _stGy, sides, -hS, _litFinal[0], _litFinal[1], _litFinal[2], 1);
  } else {
    ctx.fillStyle = topFill;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      if (i === 0) ctx.moveTo(_stPx[i], _stGy[i] - hS); else ctx.lineTo(_stPx[i], _stGy[i] - hS);
    }
    ctx.closePath();
    ctx.fill();
  }
  if (sink !== null) {
    sink.profileStroke(_stPx, _stRy, _stGy, sides, -hS, strokeW);
  } else {
    ctx.strokeStyle = 'rgba(40, 36, 30, 0.75)';
    ctx.lineWidth = strokeW;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const py = _stRy[i] < 0 ? _stGy[i] - hS : _stGy[i];
      if (i === 0) ctx.moveTo(_stPx[i], py); else ctx.lineTo(_stPx[i], py);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

// Boulder：单石，走与 RockCluster 子石同一套受光几何（drawStoneBody 共用；lite=0.5 即
// 基础色板零偏移，七边形变径沿用 v1.50.13 旧公式逐位一致）。
// ★ TA-07：远景档（AccentLOD 判档，特征尺度 = 石半径 6 × accent.scale × zoom）走两笔简化。
function drawAccentBoulder(owner, sx, sy, scaled, model, cosZ, sinZ, cosX, sinX) {
  const AL = window.AccentLOD;
  const far = AL && AL.cfg().stoneFar && AL.tierFor(owner, 'Boulder', model, scaled) === AL.FAR;
  const sl = _terrainSlopeAt(owner.x, owner.y);
  // ★ WebGL 装饰层：GL 模式登记石体深度（画家序不变，深度对齐地形），石体几何经
  //   drawStoneBody sink 分发；落底阴影由阴影图（WebGLShadowPass）承担，不再手绘。
  const WSL = window.WebGLAccentLayer;
  if (WSL && WSL.sinkOn) {
    WSL.beginAccent(owner.x, owner.y, owner.z);
  } else if (typeof ctx !== 'undefined' && ctx) {
    // 2D 模式手绘接地接触阴影（与 RockCluster 同向、同色板、沿世界光向）
    const RC = window.RENDER_CONFIG || {};
    const stoneShadowAlpha = Number.isFinite(RC.accentRockClusterStoneShadowAlpha) ? RC.accentRockClusterStoneShadowAlpha : 0.10;
    const so = (typeof _shadowOffset === 'function') ? _shadowOffset(0.6, 1.2, 2.0 * (owner.scale || 1)) : { x: 2, y: 1.5, alphaScale: 1 };
    ctx.fillStyle = 'rgba(25, 20, 15, ' + ((stoneShadowAlpha + 0.04) * (so.alphaScale || 1)).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(sx + so.x * 0.4, sy + so.y * 0.3, 6 * scaled * 1.12, 6 * scaled * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  drawStoneBody(sx, sy, 6 * scaled, (owner && owner.rotation) || 0, 7, _BOULDER_SHAPE, 0.5,
    cosZ, sinZ, cosX, sinX, Math.max(0.6, 0.9 * scaled), far, sl.dzdx, sl.dzdy);
}

// RockCluster：anchor 派生 2–5 颗子石（D-B1-6，06 号 §5.5：不为子石建实体、不改碰撞/路面）。
// ★ TA-11-5 地貌表现升级（07 号 §6.6/§4.1）：
// - 微接触落底阴影：簇群整片弱椭圆 + 逐石接触椭圆（lightShadowOffset(0.6,1.2,0.4)，
//   极淡 rgba(25,20,15,0.14)，偏移随缩放与相机光向协调），消除河滩/斜坡上的漂浮感；
//   阴影先于全部石体绘制，只落地表、不压邻石顶面。
// - 岩面分层：主石 6~7 边 / 辅石 5~6 边非对称变径多边形（模型层 TA-11-5）；
//   ★ TA-04-5 起子石统一走 drawStoneBody 立体受光几何（相机投影棱柱 + 带法线顶面/
//   侧面 + 世界光向点积受光），逐面片明暗差即「岩面分层」：棱角处自然出现受光/背光面过渡。
// 子石按投影深度画家排序（远 → 近），accent.rotation 只旋转水平偏移；远景微碎石按 LOD 阈值省略。
function drawAccentRockCluster(accent, sx, sy, scaled, model, cosZ, sinZ, cosX, sinX) {
  const sk = model.skeleton;
  const rot = accent.rotation || 0;
  const cR = Math.cos(rot), sR = Math.sin(rot);
  // 远景微碎石省略阈值（config.render.js，TA-11-3；屏幕半径 px）
  const RC = window.RENDER_CONFIG || {};
  const lodMinR = Number.isFinite(RC.accentRockClusterLODMinRadius) ? RC.accentRockClusterLODMinRadius : 0.6;
  // ★ TA-07 远景档：只画主石（model.stoneMain）且走两笔简化，伴生碎石全略（§3.2）
  const AL = window.AccentLOD;
  const far = AL && AL.tierFor(accent, 'RockCluster', model, scaled) === AL.FAR;
  const farSimplified = !!(far && AL.cfg().stoneFar);
  // 微接触阴影透明度（config.render.js，TA-11-5；缺省回退与集中值一致）
  const shadowAlpha = Number.isFinite(RC.accentRockClusterShadowAlpha) ? RC.accentRockClusterShadowAlpha : 0.14;
  const stoneShadowAlpha = Number.isFinite(RC.accentRockClusterStoneShadowAlpha) ? RC.accentRockClusterStoneShadowAlpha : 0.10;
  // ★ v1.50.72 贴合地形：簇群锚点坡度用于全部子石（子石间距远小于地形格，同一坡度足够准确）
  const sl = _terrainSlopeAt(accent.x, accent.y);
  const clDzdx = sl.dzdx, clDzdy = sl.dzdy;
  // ★ WebGL 装饰层：GL 地形活动时整簇子石按 Canvas 同序分发给 WebGLAccentLayer；
  //   整簇登记一次深度（簇内仍按画家序叠放，深度写入关闭）。
  var sink = (window.WebGLAccentLayer && window.WebGLAccentLayer.sinkOn) ? window.WebGLAccentLayer : null;
  if (sink !== null) sink.beginAccent(accent.x, accent.y, accent.z);

  // 局部三维 → 屏幕（★ TA-11-6 写入复用点对象，零分配）
  function projTo(dx, dy, dz, out) {
    const rx = dx * cosZ - dy * sinZ;
    const ry = dx * sinZ + dy * cosZ;
    out.x = sx + rx * scaled;
    out.y = sy + (ry * cosX - dz * sinX) * scaled;
    out.d = ry * sinX + dz * cosX;
  }

  // 子石收集 + 深度画家排序（远 → 近；★ TA-11-6 碎石池 + 稳定性插入排序，零分配）
  let nItems = 0;
  for (let i = 0; i < sk.stones.length; i++) {
    const st = sk.stones[i];
    const gx = st.x * cR - st.y * sR;
    const gy = st.x * sR + st.y * cR;
    const it = _rockScratch(nItems++);
    it.st = st;
    projTo(gx, gy, 0, it.g);
    it.d = it.g.d;
  }
  _sortScratch(_rockScratchPool, nItems, 'd');

  // 微接触落底阴影（先画，被子石压住）：簇群整片 + 逐石接触椭圆（主石略强）
  // ★ v1.50.84：GL 模式不再手绘接触影——落底阴影统一由阴影图（WebGLShadowPass）承担
  const so = _shadowOffset(0.6, 1.2, 0.4);
  if (sink === null) {
    ctx.fillStyle = 'rgba(25, 20, 15, ' + (shadowAlpha * so.alphaScale).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(sx + so.x * 0.5, sy + so.y * 0.35, sk.spread * scaled * 1.05, sk.spread * scaled * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < nItems; i++) {
      const it = _rockScratchPool[i];
      const r = it.st.r * scaled;
      if (r < lodMinR) continue;
      if (far && it.st !== sk.stones[(model && model.stoneMain) || 0]) continue; // 远景碎石影随同略去
      ctx.fillStyle = 'rgba(25, 20, 15, ' + ((it.st === sk.stones[0] ? stoneShadowAlpha + 0.02 : stoneShadowAlpha) * so.alphaScale).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(it.g.x + so.x * 0.4, it.g.y + so.y * 0.3, r * 1.08, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (let i = 0; i < nItems; i++) {
    const it = _rockScratchPool[i];
    const st = it.st;
    const r = st.r * scaled;
    if (r < lodMinR) continue; // 微碎石在远景不可辨，直接省略
    if (far && st !== sk.stones[(model && model.stoneMain) || 0]) continue; // 远景只留主石
    // ★ TA-04-5：子石走与 Boulder 共用的 drawStoneBody——相机投影棱柱轮廓 + 带法线
    //   顶面/侧面 + 世界光向点积受光（底边贴自身落地点，v1.50.13 锚点契约几何化重述）
    drawStoneBody(it.g.x, it.g.y, r, st.rot, st.sides, st.shape, st.lite,
      cosZ, sinZ, cosX, sinX, Math.max(0.5, Math.min(0.8, 0.8 * scaled)), farSimplified, clDzdx, clDzdy);
  }
}
