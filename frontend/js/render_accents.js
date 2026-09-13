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
// - 细节分级：按冠部投影像素尺寸分近/中/远三档（accentDetailNearPx/MidPx），
//   远景只保留树形与叶量，中景画主枝，近景加二级枝、簇高光与春芽（TA-07 再做滞回）。
// - 受光：★ TA-04-2（v1.50.33）法线点积管线接入——叶簇/岩面颜色固定走
//   「季节基础色 → SimLighting 漫反射+环境光（法线点积，公式单一来源 shadeRgbInto）→
//   intensity/tint 色温」；冠内体积/AO 分档只保留与视角无关的 tZ 档，投影深度 tD
//   不再参与明暗（同一世界表面转相机不变色）。枝干侧面明暗（TA-04-3）、叶簇渐变亮部
//   与固定白斑移除（TA-04-4）、岩石 billboard 几何随相机细化（TA-04-5）后续接入；
//   GrassTuft 不在本任务受光范围（§6.5：保留季相短草线，不新增立体法线）。
// - ★ v1.50.27 漫画风两遍式树冠：叶簇不再逐簇画深色 rim 轮廓（相邻簇叠压处
//   rim 压在邻簇本体上，冠内布满深色分界线，观感像一堆描边气泡），改为
//   Pass A 全簇统一冠影色铺合并剪影 + Pass B 逐簇体积明暗（下暗上亮、远暗近亮）。
//
// 职责分工（§6.7）：
// - accent-season.js：季相与物种曲线（window.SimTreeTint 唯一生产者）
// - accent-model.js：稳定形态派生 + 个体模型缓存（骨架 / 叶簇次序 / extent）
// - 本文件：模型投影、色板与色差、细节分级、视口剔除、绘制入口
//
// ★ D-B1-6（06 号文 §5.5 / §5.7 Canvas 行）：新增 RockCluster / GrassTuft 两分支——
// RockCluster 由 anchor 按 accent.id 前端派生 2–5 颗子石（不建实体、不改碰撞/路面）；
// GrassTuft 3–6 根短草线，颜色由前端按当前季节派生（同 Tree，不读存档 tint，14 号 §7.4）。
// 未知 kind 直接跳过并计数，开发模式（🐞 调试开关）下限频报警，**严禁错画成 Bush**。
//
// 依赖全局: ctx, camera, sim, w, h, MAP_Z_LIFT（render_world.js 定义，渲染期可用）、
//   lightShadowOffset（render_world.js）、window.SimTreeTint（accent-season.js）、
//   window.AccentModel（accent-model.js，须先于本文件加载）、window.RENDER_CONFIG。

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
var _litBase = [0, 0, 0];
var _litOut = [0, 0, 0];
function accentLitFill(baseR, baseG, baseB, nx, ny, nz, kAo) {
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
  return 'rgb(' + r + ', ' + g + ', ' + b + ')';
}

function drawAccentEntity(accent) {
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

  // 投影（与地形/世界实体同一套 3D → 屏幕变换）
  const rx = accent.x * cosZ - accent.y * sinZ;
  const ry = accent.x * sinZ + accent.y * cosZ;
  const az = (accent.z || 0) + MAP_Z_LIFT; // ★ v1.50.12 精灵锚点略抬于地表（render_world.js 定义）
  const y2 = ry * cosX - az * sinX;
  const sx = w / 2 + camera.panX + rx * scale;
  const sy = h / 2 + camera.panY + y2 * scale;

  // 视口粗剔除：树冠/枝梢向上与横向延伸，按缩放留足余量避免边缘弹跳
  // （★ TA-03 骨架横向 reach ≈ crownR，边距随缩放走；上方余量覆盖干高 + 冠顶）
  const upMargin = 24 + 44 * scale;
  const xMargin = 24 + 14 * scale;
  if (sx < -xMargin || sx > w + xMargin || sy < -upMargin || sy > h + 20) return;

  // Tree/Bush/GrassTuft 共用连续季相（TA-02/D-B1-6；GrassTuft 同 Tree 逻辑，颜色按当前
  // 季节派生，不读存档 tint）；常绿变体走 evergreen profile（叶量全年 ≥94%）
  const model = window.AccentModel.get(accent);
  const season = (kind === 'Boulder' || kind === 'RockCluster') ? null
    : window.SimTreeTint.sample(accent, sim, model.evergreen ? 'evergreen' : undefined);

  const scaled = accent.scale * scale;
  if (kind === 'Tree') {
    drawAccentTree(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX);
  } else if (kind === 'Boulder') {
    drawAccentBoulder(sx, sy, scaled, accent.rotation || 0, cosZ, sinZ);
  } else if (kind === 'Bush') {
    drawAccentBush(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX);
  } else if (kind === 'RockCluster') {
    drawAccentRockCluster(accent, sx, sy, scaled, model, cosZ, sinZ, cosX, sinX);
  } else {
    drawAccentGrassTuft(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX);
  }
}

// 浮点 RGB 直接交给 Canvas，避免季相按整数/色档量化。
function accentLeafPalette(color, vSeed) {
  const vary = (vSeed - 0.5) * 14;
  const rgb = (factor, lift) => color.map(c => Math.max(0, Math.min(255, c * factor + lift)));
  return {
    base: rgb(1, vary), hi: rgb(0.85, 62),
    rim: 'rgb(' + rgb(0.53, 0).join(',') + ')',
    dapDark: 'rgba(' + rgb(0.66, 0).join(',') + ',0.28)',
    dapLite: 'rgba(' + rgb(0.85, 90).join(',') + ',0.32)',
  };
}

// 局部三维细节分级阈值（config.render.js；远景 < mid ≤ 中景 < near ≤ 近景）
function accentDetailLevels() {
  const RC = window.RENDER_CONFIG || {};
  return {
    mid: Number.isFinite(RC.accentDetailMidPx) ? RC.accentDetailMidPx : 7,
    near: Number.isFinite(RC.accentDetailNearPx) ? RC.accentDetailNearPx : 15,
  };
}

// 叶簇脱落可见度（§6.4：先变色后减叶，短过渡带收缩淡出，禁止整冠透明度）。
// leaf: season.leafDensity(0..1)；shed: 簇稳定脱落次序(0 先落 → 1 后落)；fade: 过渡带宽度。
// v=1 全尺寸；v 随 leaf 下降按次序收缩到 0（春季萌芽自动按同一批位置恢复）。
function accentClusterVisibility(leaf, shed, fade) {
  const t = (leaf * (1 + fade) - shed) / fade;
  return t <= 0 ? 0 : (t >= 1 ? 1 : t);
}

// Tree：局部三维骨架乔木 —— 锥形倾干 + 主枝/二级枝 + 枝端椭球叶簇 + 贴地投影
// scaled = accent.scale(0.7~1.4) × camera.zoom；season 为 TA-02 连续季相输出。
function drawAccentTree(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX) {
  const sk = model.skeleton;
  const vSeed = model.vSeed;
  const crownR = 8.5 * scaled;
  const trunkH = sk.trunkH * scaled;
  const leaf = season.leafDensity;
  const brown = season.brownness;
  const lv = accentDetailLevels();
  const detailMid = crownR >= lv.mid;   // 中景：主枝 + 叶簇
  const detailNear = crownR >= lv.near; // 近景：二级枝 + 簇高光 + 春芽

  // 贴地投影：叶量调制（夏季完整冠影 → 冬季稀疏枝影 + 弱接地影，§6.5 过渡做法）
  const so = (typeof lightShadowOffset === 'function')
    ? lightShadowOffset(1.2, 2.5, 2.0)
    : { x: 1.2 * camera.zoom, y: 2.5 * camera.zoom, alphaScale: 1 };
  const shadowK = 0.55 + 0.45 * leaf;
  ctx.fillStyle = 'rgba(20, 15, 10, ' + (0.17 * so.alphaScale * (0.72 + 0.28 * leaf)).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(sx + so.x * 0.7, sy + so.y * 0.4, crownR * (0.85 + vSeed * 0.15) * shadowK, crownR * 0.40, 0, 0, Math.PI * 2);
  ctx.fill();

  // 倾干剪切（世界 x，随个体 rotation 稳定；模型只存直立骨架）
  const leanShear = Math.cos(accent.rotation || 0) * 0.22;

  // 局部三维 → 屏幕：与锚点同一套相机变换；d 越大越靠近视点（同深度队列公式）
  function proj(dx, dy, dz) {
    const wx = dx + leanShear * dz;
    const rx = wx * cosZ - dy * sinZ;
    const ry = wx * sinZ + dy * cosZ;
    return {
      x: sx + rx * scaled,
      y: sy + (ry * cosX - dz * sinX) * scaled,
      d: ry * sinX + dz * cosX,
    };
  }

  // 主干：底粗顶细的锥形曲干（沿用 v1.49.3 形状与配色，顶点改由三维投影得出）
  const top = proj(0, 0, sk.trunkH);
  const bw = Math.max(1.2, crownR * 0.17);
  const tw = Math.max(0.6, bw * 0.45);
  ctx.fillStyle = 'rgb(86, 62, 42)';
  ctx.strokeStyle = 'rgba(40, 28, 18, 0.38)';
  ctx.lineWidth = Math.max(0.4, 0.45 * scaled);
  ctx.beginPath();
  ctx.moveTo(sx - bw, sy);
  ctx.quadraticCurveTo(sx - bw * 0.45, sy - trunkH * 0.55, top.x - tw, top.y);
  ctx.lineTo(top.x + tw, top.y);
  ctx.quadraticCurveTo(sx + bw * 0.45, sy - trunkH * 0.55, sx + bw, sy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 树皮受光面：沿左侧一条浅色细干，替代厚重描边提供的立体感
  ctx.strokeStyle = 'rgba(158, 124, 92, 0.5)';
  ctx.lineWidth = Math.max(0.4, 0.32 * scaled);
  ctx.beginPath();
  ctx.moveTo(sx - bw * 0.45, sy - trunkH * 0.06);
  ctx.quadraticCurveTo(sx - bw * 0.15, sy - trunkH * 0.55, top.x - tw * 0.4, top.y + trunkH * 0.04);
  ctx.stroke();

  // 枝条骨架（全年保留——冬季裸枝的主体，§6.4）
  if (detailMid) {
    ctx.strokeStyle = 'rgb(96, 70, 48)';
    ctx.lineCap = 'round';
    for (let i = 0; i < sk.segments.length; i++) {
      const seg = sk.segments[i];
      const a = proj(seg.x1, seg.y1, seg.z1);
      const b = proj(seg.x2, seg.y2, seg.z2);
      ctx.lineWidth = Math.max(0.5, bw * seg.wK);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      // 控制点取中点略下垂，枝条微弯不僵硬
      ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + bw * 0.35, b.x, b.y);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // 叶簇：按 leafDensity × shed 次序收缩隐藏（§6.4）；色差随 brownness 加深（秋色簇间先后）
  // ★ v1.50.27 漫画风两遍式树冠（用户反馈「内部簇间深描边太重」）：
  //   旧画法逐簇「深色 rim 椭圆 + 本体椭圆」，相邻簇叠压处 rim 压在邻簇本体上，
  //   冠内全是深色分界线，整冠读作一堆描边气泡。新画法：
  //   Pass A 树冠剪影——全部可见簇先用同一「冠影色」（叶色压暗偏冷）扩边铺底，
  //   重叠合并成一整块剪影，深色只留在整冠外缘一圈与簇间空隙（读作冠内阴影）；
  //   Pass B 逐簇本体——基色 + lite 色差，再乘冠内体积明暗（下暗上亮、远暗近亮），
  //   用体积分档替代描边提供立体感；近景高光只给冠层上半部。
  const lw = Math.max(0.4, 0.5 * scaled);
  const fade = 0.09;
  const jitterAmp = 6 + 26 * brown;
  const items = [];
  for (let i = 0; i < sk.clusters.length; i++) {
    const c = sk.clusters[i];
    const v = accentClusterVisibility(leaf, c.shed, fade);
    if (v < 0.06) continue;
    const p = proj(c.x, c.y, c.z);
    if (p.y < -40 || p.y > h + 40) continue; // 簇级视口剔除
    const rr = c.r * scaled * v;
    if (rr < 0.5) continue;
    items.push({ p: p, c: c, rr: rr, v: v });
  }
  items.sort(function (a, b) { return a.p.d - b.p.d; }); // 簇间画家排序：远 → 近

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
  ctx.fillStyle = 'rgb(' +
    Math.min(255, Math.round(season.leafColor[0] * 0.50 + 4)) + ',' +
    Math.min(255, Math.round(season.leafColor[1] * 0.58 + 8)) + ',' +
    Math.min(255, Math.round(season.leafColor[2] * 0.62 + 14)) + ')';
  ctx.beginPath();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const sw = lw + it.rr * 0.16;
    ctx.moveTo(it.p.x + it.rr + sw, it.p.y);
    ctx.ellipse(it.p.x, it.p.y, it.rr + sw, it.rr * 0.78 + sw, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  // Pass B：簇本体（基色 + lite 色差，再乘冠内体积/AO 分档 × 世界光向受光）
  // ★ TA-04-2 颜色管线：季节基础色 → 漫反射+环境光（簇法线点积，accentLitFill 单一入口）
  //   → intensity/tint 色温；体积分档只留与视角无关的 tZ（tD 已移除，转相机不变色）
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const j = (it.c.lite - 0.5) * 2 * jitterAmp;
    const tZ = (it.c.z - zLo) / zSpan;   // 冠内高度 0 底 → 1 顶（体积/AO 档）
    const kZ = 0.80 + 0.20 * tZ;
    // 簇法线（模型层冠包络外向法线）经倾干剪切逆转置补偿转到世界空间
    const wn = window.AccentModel.shearNormal(it.c.nx, it.c.ny, it.c.nz, leanShear);
    ctx.fillStyle = accentLitFill(season.leafColor[0] + j, season.leafColor[1] + j, season.leafColor[2] + j, wn.x, wn.y, wn.z, kZ);
    ctx.beginPath();
    ctx.ellipse(it.p.x, it.p.y, it.rr, it.rr * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
    // 近景高光：只给冠层上半部（阳光自上而来）。★ 属屏幕固定位置，TA-04-4 改由世界光向投影驱动
    if (detailNear && it.rr > 2.2 && tZ > 0.30) {
      ctx.fillStyle = 'rgba(255, 252, 218, ' + (0.20 * it.v * (0.35 + 0.65 * tZ)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(it.p.x - it.rr * 0.28, it.p.y - it.rr * 0.42, it.rr * 0.42, it.rr * 0.30, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 春芽（§6.3/§11.4）：初春叶量未恢复时，主枝端先显芽点；近中景才画
  if (detailMid && season.budAmount > 0.12) {
    ctx.fillStyle = 'rgba(198, 216, 130, ' + (0.55 * season.budAmount).toFixed(3) + ')';
    const br = Math.max(0.7, crownR * 0.055);
    for (let i = 0; i < sk.branchTips.length; i++) {
      const t = sk.branchTips[i];
      const p = proj(t.x, t.y, t.z + 0.3);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, br, br * 1.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Boulder：不规则多边形岩石（灰白顶+深灰底+暗边）
function drawAccentBoulder(sx, sy, scaled, rot, cosZ, sinZ) {
  const r = 6 * scaled;
  const sides = 7;
  // ★ v1.50.13 锚点修正：七边形原以 (sx,sy) 为中心，下半岩体沉入地表之下被近处格子盖掉
  //   （「石头半截入土」）。改为底边贴锚点：整体上移 r（多边形最大下探 0.72rVar+0.18r ≈ 1.04r）。
  const cy = sy - r;
  // ★ TA-04-2：两笔石面改走世界光向受光管线——顶面法线朝上，侧面取个体稳定世界方向
  //   （accent.rotation 水平角 + 下倾 0.45），亮暗随光向/色温变化，不再固定顶亮侧暗；
  //   屏幕 billboard 几何与随相机的法线细化归 TA-04-5（§6.5：亮暗由面朝向与光向决定）。
  const snx = Math.cos(rot), sny = Math.sin(rot);
  // 阴影底层（深灰，略偏右下）
  ctx.fillStyle = accentLitFill(78, 74, 68, snx, sny, -0.45, 1);
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rot + (i / sides) * Math.PI * 2;
    const rVar = r * (0.82 + 0.38 * (((i * 37 + 13) % 7) / 7));
    const px = sx + Math.cos(angle) * rVar + r * 0.18;
    const py = cy + Math.sin(angle) * rVar * 0.72 + r * 0.18;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  // 顶面（浅灰白色）
  ctx.fillStyle = accentLitFill(152, 146, 138, 0, 0, 1, 1);
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rot + (i / sides) * Math.PI * 2;
    const rVar = r * (0.82 + 0.38 * (((i * 37 + 13) % 7) / 7));
    const px = sx + Math.cos(angle) * rVar;
    const py = cy + Math.sin(angle) * rVar * 0.72;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  // 暗边轮廓让岩石从地形中分离
  ctx.strokeStyle = 'rgba(40, 36, 30, 0.75)';
  ctx.lineWidth = Math.max(0.6, 0.9 * scaled);
  ctx.stroke();
}

// Bush：局部三维细茎灌木 —— 基生多茎 + 茎端椭球叶簇 + 微投影（§6.4：不缩小乔木冒充灌木）
function drawAccentBush(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX) {
  const sk = model.skeleton;
  const vSeed = model.vSeed;
  const r = (5.5 + vSeed * 1.2) * scaled;
  const leaf = season.leafDensity;
  const brown = season.brownness;
  const lv = accentDetailLevels();
  const detailNear = r >= lv.near;

  // 贴地微投影（叶量调制）
  const so = (typeof lightShadowOffset === 'function')
    ? lightShadowOffset(1.2, 2.5, 0.7)
    : { x: 1.2 * camera.zoom, y: 2.5 * camera.zoom, alphaScale: 1 };
  const shadowK = 0.60 + 0.40 * leaf;
  ctx.fillStyle = 'rgba(20, 15, 10, ' + (0.15 * so.alphaScale * (0.75 + 0.25 * leaf)).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(sx + so.x * 0.5, sy + so.y * 0.35, r * 0.95 * shadowK, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // 局部三维 → 屏幕（灌木无倾干）
  function proj(dx, dy, dz) {
    const rx = dx * cosZ - dy * sinZ;
    const ry = dx * sinZ + dy * cosZ;
    return {
      x: sx + rx * scaled,
      y: sy + (ry * cosX - dz * sinX) * scaled,
      d: ry * sinX + dz * cosX,
    };
  }

  // 细茎（全年保留；冬季枯枝为主）
  if (r >= lv.mid) {
    ctx.strokeStyle = 'rgb(104, 78, 54)';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.5, 0.9 * scaled);
    for (let i = 0; i < sk.segments.length; i++) {
      const seg = sk.segments[i];
      const a = proj(seg.x1, seg.y1, seg.z1);
      const b = proj(seg.x2, seg.y2, seg.z2);
      // 控制点取 40% 高度处、水平位置取 55% 外倾 —— 茎先直立后外弯
      const c = proj(seg.x2 * 0.55, seg.y2 * 0.55, seg.z2 * 0.40);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // 叶簇：同 Tree 的脱落/色差/排序规则，扁压 squash 让簇丛贴地
  // ★ v1.50.27 与 Tree 同步改两遍式剪影 + 体积明暗（去逐簇深描边），并修复
  //   旧版高光 `0.18 * it.v` 的 it.v 未入 items 恒 NaN、高光从未生效的问题
  const lw = Math.max(0.4, 0.45 * scaled);
  const fade = 0.09;
  const jitterAmp = 6 + 26 * brown;
  const items = [];
  for (let i = 0; i < sk.clusters.length; i++) {
    const c = sk.clusters[i];
    const v = accentClusterVisibility(leaf, c.shed, fade);
    if (v < 0.06) continue;
    const p = proj(c.x, c.y, c.z);
    const rr = c.r * scaled * v;
    if (rr < 0.5) continue;
    items.push({ p: p, c: c, rr: rr, v: v });
  }
  items.sort(function (a, b) { return a.p.d - b.p.d; });

  // 冠内体积/AO 分档基准（同 Tree：整副骨架求范围，秋季幸存簇明暗不随可见集跳变；
  // ★ TA-04-2 起投影深度 tD 不参与明暗，只留与视角无关的 tZ 档）
  let zLo = Infinity, zHi = -Infinity;
  for (let i = 0; i < sk.clusters.length; i++) {
    const c = sk.clusters[i];
    if (c.z < zLo) zLo = c.z;
    if (c.z > zHi) zHi = c.z;
  }
  const zSpan = Math.max(0.001, zHi - zLo);

  // Pass A：统一冠影色剪影（重叠即并集）
  ctx.fillStyle = 'rgb(' +
    Math.min(255, Math.round(season.leafColor[0] * 0.50 + 4)) + ',' +
    Math.min(255, Math.round(season.leafColor[1] * 0.58 + 8)) + ',' +
    Math.min(255, Math.round(season.leafColor[2] * 0.62 + 14)) + ')';
  ctx.beginPath();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const sw = lw + it.rr * 0.16;
    ctx.moveTo(it.p.x + it.rr + sw, it.p.y);
    ctx.ellipse(it.p.x, it.p.y, it.rr + sw, it.rr * 0.72 + sw, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  // Pass B：簇本体 + 冠内体积/AO 分档 × 世界光向受光（★ TA-04-2，同 Tree 管线；灌木无倾干）
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const j = (it.c.lite - 0.5) * 2 * jitterAmp;
    const tZ = (it.c.z - zLo) / zSpan;
    const kZ = 0.80 + 0.20 * tZ;
    ctx.fillStyle = accentLitFill(season.leafColor[0] + j, season.leafColor[1] + j, season.leafColor[2] + j, it.c.nx, it.c.ny, it.c.nz, kZ);
    ctx.beginPath();
    ctx.ellipse(it.p.x, it.p.y, it.rr, it.rr * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    // 近景高光属屏幕固定位置，TA-04-4 改由世界光向投影驱动
    if (detailNear && it.rr > 2.0 && tZ > 0.30) {
      ctx.fillStyle = 'rgba(255, 252, 218, ' + (0.18 * it.v * (0.35 + 0.65 * tZ)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(it.p.x - it.rr * 0.28, it.p.y - it.rr * 0.40, it.rr * 0.40, it.rr * 0.28, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// RockCluster：anchor 派生 2–5 颗子石（D-B1-6，06 号 §5.5：不为子石建实体、不改碰撞/路面）。
// ★ TA-11-5 地貌表现升级（07 号 §6.6/§4.1）：
// - 微接触落底阴影：簇群整片弱椭圆 + 逐石接触椭圆（lightShadowOffset(0.6,1.2,0.4)，
//   极淡 rgba(25,20,15,0.14)，偏移随缩放与相机光向协调），消除河滩/斜坡上的漂浮感；
//   阴影先于全部石体绘制，只落地表、不压邻石顶面。
// - 岩面分层：主石 6~7 边 / 辅石 5~6 边非对称变径多边形（模型层 TA-11-5），底层改为
//   逐面片扇形填充——每面片在几何端点就地导出倾斜侧面法线（方位角水平分量 + 下倾 0.45），
//   顶面法线近似 (0,0,1)：TA-04-5 世界光向细化接入时只换光源参数、无需重构绘制循环。
// - 暗边轮廓 0.5~0.8px 低饱和（近景清晰分离、不随缩放无限增粗）。
// 子石按投影深度画家排序（远 → 近），每颗底边贴自身落地点（v1.50.13 锚点契约），
// accent.rotation 只旋转水平偏移；远景微碎石按 LOD 阈值省略。
function drawAccentRockCluster(accent, sx, sy, scaled, model, cosZ, sinZ, cosX, sinX) {
  const sk = model.skeleton;
  const rot = accent.rotation || 0;
  const cR = Math.cos(rot), sR = Math.sin(rot);
  // 远景微碎石省略阈值（config.render.js，TA-11-3；屏幕半径 px）
  const RC = window.RENDER_CONFIG || {};
  const lodMinR = Number.isFinite(RC.accentRockClusterLODMinRadius) ? RC.accentRockClusterLODMinRadius : 0.6;
  // 微接触阴影透明度（config.render.js，TA-11-5；缺省回退与集中值一致）
  const shadowAlpha = Number.isFinite(RC.accentRockClusterShadowAlpha) ? RC.accentRockClusterShadowAlpha : 0.14;
  const stoneShadowAlpha = Number.isFinite(RC.accentRockClusterStoneShadowAlpha) ? RC.accentRockClusterStoneShadowAlpha : 0.10;

  function proj(dx, dy, dz) {
    const rx = dx * cosZ - dy * sinZ;
    const ry = dx * sinZ + dy * cosZ;
    return {
      x: sx + rx * scaled,
      y: sy + (ry * cosX - dz * sinX) * scaled,
      d: ry * sinX + dz * cosX,
    };
  }

  // 岩面个体色差：lite 通道小幅整体明暗（±10），保持 Boulder 低饱和灰岩色板（§4.1）。
  // ★ TA-04-2 起底色只承载个体色差（基础色），受光统一经 accentLitFill 走世界光向管线
  function stoneBase(lite, base) {
    const k = (lite - 0.5) * 20;
    return [
      Math.max(0, Math.min(255, base[0] + k)),
      Math.max(0, Math.min(255, base[1] + k)),
      Math.max(0, Math.min(255, base[2] + k)),
    ];
  }

  // 子石收集 + 深度画家排序（远 → 近）
  const items = [];
  for (let i = 0; i < sk.stones.length; i++) {
    const st = sk.stones[i];
    const gx = st.x * cR - st.y * sR;
    const gy = st.x * sR + st.y * cR;
    items.push({ st: st, g: proj(gx, gy, 0) });
  }
  items.sort(function (a, b) { return a.g.d - b.g.d; });

  // 微接触落底阴影（先画，被子石压住）：簇群整片 + 逐石接触椭圆（主石略强）
  const so = (typeof lightShadowOffset === 'function')
    ? lightShadowOffset(0.6, 1.2, 0.4)
    : { x: 0.6 * camera.zoom, y: 1.2 * camera.zoom, alphaScale: 1 };
  ctx.fillStyle = 'rgba(25, 20, 15, ' + (shadowAlpha * so.alphaScale).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(sx + so.x * 0.5, sy + so.y * 0.35, sk.spread * scaled * 1.05, sk.spread * scaled * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const r = it.st.r * scaled;
    if (r < lodMinR) continue;
    ctx.fillStyle = 'rgba(25, 20, 15, ' + ((it.st === sk.stones[0] ? stoneShadowAlpha + 0.02 : stoneShadowAlpha) * so.alphaScale).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(it.g.x + so.x * 0.4, it.g.y + so.y * 0.3, r * 1.08, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const st = it.st;
    const r = st.r * scaled;
    if (r < lodMinR) continue; // 微碎石在远景不可辨，直接省略
    // 底边贴落地点：中心上抬 0.72r（同 Boulder 屏幕纵压比），再压暗底色
    const cy = it.g.y - r * 0.72;
    const sb = stoneBase(st.lite, [78, 74, 68]);
    const sTop = stoneBase(st.lite, [152, 146, 138]);
    // Pass 1 底层：逐面片扇形填充（深灰背光侧）。每面片法线在几何端点就地导出——
    //   取相邻顶点方位角中点的水平分量 + 下倾 0.45（TA-04-5 分面契约预留）。
    //   逐面片明暗差即「岩面分层」：棱角处自然出现受光/背光面过渡，无重叠频闪。
    for (let k = 0; k < st.sides; k++) {
      const k2 = (k + 1) % st.sides;
      const aA = st.rot + (k / st.sides) * Math.PI * 2;
      const aB = st.rot + (k2 / st.sides) * Math.PI * 2;
      const rA = r * st.shape[k], rB = r * st.shape[k2];
      const midA = st.rot + ((k + 0.5) / st.sides) * Math.PI * 2;
      ctx.fillStyle = accentLitFill(sb[0], sb[1], sb[2], Math.cos(midA), Math.sin(midA), -0.45, 1);
      ctx.beginPath();
      ctx.moveTo(it.g.x + r * 0.18, cy + r * 0.18);
      ctx.lineTo(it.g.x + Math.cos(aA) * rA + r * 0.18, cy + Math.sin(aA) * rA * 0.72 + r * 0.18);
      ctx.lineTo(it.g.x + Math.cos(aB) * rB + r * 0.18, cy + Math.sin(aB) * rB * 0.72 + r * 0.18);
      ctx.closePath();
      ctx.fill();
    }
    // Pass 2 顶面（浅灰白迎光侧，法线近似朝上；亮暗随光向变化）
    ctx.fillStyle = accentLitFill(sTop[0], sTop[1], sTop[2], 0, 0, 1, 1);
    ctx.beginPath();
    for (let k = 0; k < st.sides; k++) {
      const angle = st.rot + (k / st.sides) * Math.PI * 2;
      const rVar = r * st.shape[k];
      const px = it.g.x + Math.cos(angle) * rVar;
      const py = cy + Math.sin(angle) * rVar * 0.72;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    // 暗边轮廓让碎石从地形中分离（0.5~0.8px 低饱和，近景不无限增粗）
    ctx.strokeStyle = 'rgba(40, 36, 30, 0.75)';
    ctx.lineWidth = Math.max(0.5, Math.min(0.8, 0.8 * scaled));
    ctx.stroke();
  }
}

// ★ TA-11-4 草丛季相色派生（纯函数，只依赖 SimTreeTint 季节样本输出；07 号 §6.3/§6.6）：
// 春嫩绿萌发（budAmount 向芽色提亮）→ 夏深绿繁茂（叶色直出）→ 秋金黄枯赭（叶色直出 +
// 枯萎混合启动）→ 冬灰枯褐（枯萎深度 = brownness×(1−叶量)，隆冬收敛至 rgb(95,88,70)，
// 草叶不脱落）。芦草穗（plume）量随秋枯升起（brownness 0.35→0.8 渐升，flowerAmount
// 叠加为配置预留通道），秋季淡黄白高光 → 隆冬按 litterAmount 转干灰，残穗挺立不消失。
// 暂停/回溯/读档零抖动：颜色是季节样本的连续函数，无逐帧累积状态。
function grassSeasonColor(season) {
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const lc = season.leafColor;
  // 草色：季相连续叶色向草绿微偏（草比树叶更黄绿），浮点直出不做色档量化
  let r = lc[0] * 0.96 + 10;
  let g = lc[1] * 1.02 + 4;
  let b = lc[2] * 0.88;
  // 春季芽苞（§6.3）：budAmount 向嫩芽绿 (198,216,130) 提亮，隐现不抢眼
  const budK = clamp01(season.budAmount) * 0.35;
  r += (198 - r) * budK;
  g += (216 - g) * budK;
  b += (130 - b) * budK;
  // 秋冬枯萎（§6.6「冬季低矮枯草」）：枯萎深度 = brownness×(1−叶量)×1.35（增益保证
  // 隆冬叶量 ~0.03 时枯萎深度达 1，精确收敛枯褐色 rgb(95,88,70)；秋季仅尾部轻度混入）
  const witherK = clamp01(clamp01(season.brownness) * (1 - clamp01(season.leafDensity)) * 1.35);
  r += (95 - r) * witherK;
  g += (88 - g) * witherK;
  b += (70 - b) * witherK;
  // 芦花穗量：秋枯进程驱动（brownness 0.35 起显 → 0.8 全开），flowerAmount 叠加预留
  const plumeV = Math.max(season.flowerAmount || 0, clamp01((season.brownness - 0.35) / 0.45));
  // 穗色：秋季淡黄白高光 (240,233,200) → 隆冬干灰白 (190,182,158)，litterAmount 渐变
  const litterK = clamp01(season.litterAmount);
  return {
    r: r, g: g, b: b,
    plumeV: clamp01(plumeV),
    plumeR: 240 + (190 - 240) * litterK,
    plumeG: 233 + (182 - 233) * litterK,
    plumeB: 200 + (158 - 200) * litterK,
  };
}

// GrassTuft：3–6 根短草线（D-B1-6，06 号 §5.5）；★ TA-11-4 芦草变体与季相深化。
// 颜色由前端按当前季节派生（同 Tree：SimTreeTint 连续季相，不读存档 tint，14 号 §7.4），
// 季相公式单一来源 = grassSeasonColor（本文件上方，07 号 §6.3/§6.6）；
// 草叶不脱落——冬季以「低矮 + 枯色」表达（hK 隆冬收缩系数，config.render.js TA-11-3），
// 隆冬枯草与芦秆仍在场，严禁整丛消失或纯透明。
// 芦草（模型层 skeleton.isReed）：挺拔株形 + 顶端穗状芦花——穗量/穗色由 grassSeasonColor
// 给出，穗几何沿叶曲线末端方向延伸（屏幕空间，画家排序与所在草叶一致）。
function drawAccentGrassTuft(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX) {
  const sk = model.skeleton;
  const rot = accent.rotation || 0;
  const cR = Math.cos(rot), sR = Math.sin(rot);
  // 隆冬低矮萎缩保底高度系数（config.render.js，TA-11-3）：hK = ratio + (1-ratio)×叶量
  const RC = window.RENDER_CONFIG || {};
  const winterK = Number.isFinite(RC.accentGrassTuftWinterHeightRatio)
    ? RC.accentGrassTuftWinterHeightRatio : 0.62;
  const hK = winterK + (1 - winterK) * season.leafDensity;

  function proj(dx, dy, dz) {
    const rx = dx * cosZ - dy * sinZ;
    const ry = dx * sinZ + dy * cosZ;
    return {
      x: sx + rx * scaled,
      y: sy + (ry * cosX - dz * sinX) * scaled,
      d: ry * sinX + dz * cosX,
    };
  }

  // 草色 + 芦花穗量/穗色：季相派生单一入口 grassSeasonColor（TA-11-4，见本文件上方）
  const sc = grassSeasonColor(season);

  // 贴地接触投影（弱于灌木）
  const so = (typeof lightShadowOffset === 'function')
    ? lightShadowOffset(0.8, 1.6, 0.5)
    : { x: 0.8 * camera.zoom, y: 1.6 * camera.zoom, alphaScale: 1 };
  ctx.fillStyle = 'rgba(20, 15, 10, ' + (0.10 * so.alphaScale).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(sx + so.x * 0.5, sy + so.y * 0.35, 2.6 * scaled, 1.1 * scaled, 0, 0, Math.PI * 2);
  ctx.fill();

  // 草叶收集 + 深度画家排序（叶尖投影深度，远 → 近）
  const items = [];
  for (let i = 0; i < sk.blades.length; i++) {
    const b = sk.blades[i];
    const bx = b.bx * cR - b.by * sR;
    const by = b.bx * sR + b.by * cR;
    const tx = b.tx * cR - b.ty * sR;
    const ty = b.tx * sR + b.ty * cR;
    items.push({ b: b, bx: bx, by: by, tx: tx, ty: ty, h: b.h * hK, d: proj(tx, ty, b.h * hK).d });
  }
  items.sort(function (a, b2) { return a.d - b2.d; });

  ctx.lineCap = 'round';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const p0 = proj(it.bx, it.by, 0);
    const p1 = proj(it.tx, it.ty, it.h);
    // 控制点：半高、外倾 25% —— 叶先立后弯不僵硬
    const c = proj(it.bx + (it.tx - it.bx) * 0.25, it.by + (it.ty - it.by) * 0.25, it.h * 0.5);
    const k = 0.86 + 0.28 * it.b.lite; // 个体色差（同 Tree/Bush lite 通道语义）
    ctx.strokeStyle = 'rgb(' +
      Math.round(Math.max(0, Math.min(255, sc.r * k))) + ',' +
      Math.round(Math.max(0, Math.min(255, sc.g * k))) + ',' +
      Math.round(Math.max(0, Math.min(255, sc.b * k))) + ')';
    // 芦秆略细挺（0.52 vs 0.62），与普通短草区分茎秆质感
    ctx.lineWidth = Math.max(0.5, (it.b.plume > 0 ? 0.52 : 0.62) * scaled);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.quadraticCurveTo(c.x, c.y, p1.x, p1.y);
    ctx.stroke();
    // ★ TA-11-4 穗状芦花：沿叶曲线末端方向的三笔花序线段（主穗顺叶弯挺出 + 两侧短穗）。
    //   穗量 plumeV 秋枯升起、隆冬存留（干灰色），几何随隆冬 hK 收缩；
    //   远景穗屏长 < 2px 不可辨直接省略；画家排序与所在草叶一致（叶压穗/穗压叶自然）。
    if (it.b.plume > 0 && sc.plumeV > 0.02) {
      const pl = it.b.plume * hK * scaled;
      if (pl >= 2) {
        const dx0 = p1.x - c.x, dy0 = p1.y - c.y;
        const dl = Math.hypot(dx0, dy0) || 1;
        const pa = Math.atan2(dy0 / dl, dx0 / dl);
        ctx.strokeStyle = 'rgba(' +
          Math.round(Math.max(0, Math.min(255, sc.plumeR))) + ',' +
          Math.round(Math.max(0, Math.min(255, sc.plumeG))) + ',' +
          Math.round(Math.max(0, Math.min(255, sc.plumeB))) + ',' +
          (0.8 * sc.plumeV).toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.5, 0.9 * scaled);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p1.x + Math.cos(pa) * pl, p1.y + Math.sin(pa) * pl);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p1.x + Math.cos(pa + 0.45) * pl * 0.6, p1.y + Math.sin(pa + 0.45) * pl * 0.6);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p1.x + Math.cos(pa - 0.5) * pl * 0.5, p1.y + Math.sin(pa - 0.5) * pl * 0.5);
        ctx.stroke();
      }
    }
  }
  ctx.lineCap = 'butt';
}
