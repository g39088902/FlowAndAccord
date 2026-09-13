// === 资源景观绘制接入层（★ S4-02，STAGE-04-TODO §3.1/§3.4）===
// LandscapeModel 派生组（landscape-model.js）→ 统一深度队列的接入层：
// - collectLandscapes(...)：由 render_depth_queue.js::drawWorldEntities() 在装饰阴影段之后
//   调用——先 LandscapeModel.sync(sim)（静态签名变化才重建几何），再把每个子图元与
//   树/灌木贴地投影分别入队（DEPTH_LANDSCAPE / DEPTH_LANDSCAPE_SHADOW，深度口径与
//   装饰一致走 _decalDepth 足迹感知深度）。**本层不做绘制逻辑，也严禁把配方/索引搬进队列层**。
// - drawLandscapeChild / drawLandscapeShadowGround：深度队列分发入口——立体树石草复用
//   render_accents.js / render_grass.js 既有图元（drawAccentTree/Boulder/Bush/RockCluster/
//   GrassTuft），阴影复用 render_shadows.js::drawAccentShadowFor（模型参数化主体），
//   季相复用 window.SimTreeTint，光照经图元内部 accentLitFill 单一入口——**不复制光照公式**。
// - 模型命名空间：子图元模型经 AccentModel.getByKey（完整 key 通道，'L#' 前缀）解析，
//   与 accent.id 缓存键隔离；模型内容 = (modelKind, visualSeed) 纯函数。
// - 配置关态（RENDER_CONFIG.landscapeEnabled=false）：collect 直接返回，零入队零同步，
//   完整保留原画面路径；开关是纯前端渲染开关，**严禁**经 applyConfig() 写模拟配置。
// - 失败处理（STAGE-04-TODO §4.2）：未知 modelKind 跳过该子图元并计数（开发模式限频报警）；
//   单组无子图元即自然回落基础 POI 标记，不阻断其他组。
//
// 零 GC：子图元视图对象（_view，供 SimTreeTint/阴影层读取的 accent 同构视图）在 child 上
// 惰性缓存一次；无逐帧堆分配。加载顺序：accent-model.js → landscape-model.js →
// render_shadows.js → 本文件 → render_depth_queue.js（index.html 已按序注册）。
//
// 复用深度队列层共享工具（全局函数，同装饰族共享先例）：_depthItem / _decalDepth /
// _surfaceDepth / MAP_Z_LIFT（render_depth_queue.js）。
// 依赖全局: ctx, camera, sim, w, h（render_canvas.js/main.js）、window.LandscapeModel、
//   window.AccentModel、window.SimTreeTint、window.RENDER_CONFIG、DEPTH_LANDSCAPE(_SHADOW)。

var _unknownLandscapeKinds = Object.create(null);
var _unknownLandscapeWarnAt = 0;
function _reportUnknownLandscapeKind(kind) {
  _unknownLandscapeKinds[kind] = (_unknownLandscapeKinds[kind] || 0) + 1;
  if (sim && sim.debugMode) {
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - _unknownLandscapeWarnAt > 3000) {
      _unknownLandscapeWarnAt = now;
      var parts = Object.keys(_unknownLandscapeKinds).map(function (k) { return k + '×' + _unknownLandscapeKinds[k]; });
      console.warn('[render_landscapes] 未注册景观子图元种类（已跳过）:', parts.join(', '));
    }
  }
}

// 子图元模型解析：完整 key 通道（'L#' 命名空间 + 风格版本），与 accent.id 键隔离。
function landscapeChildModel(child) {
  const ver = (window.RENDER_CONFIG && window.RENDER_CONFIG.landscapeStyleVersion) || 1;
  return window.AccentModel.getByKey(child.modelKind, child.visualSeed,
    'L#v' + ver + '#' + child.modelKind + '#' + child.visualSeed);
}

// 子图元的 accent 同构视图（惰性缓存；SimTreeTint 个体抖动 / 阴影层 / 图元 rotation 消费）。
// 视图 id = visualSeed（模型层种子命名空间），kind = modelKind——不是 POI id，不与 accent.id 混用。
function landscapeChildView(child) {
  let v = child._view;
  if (!v) {
    v = child._view = {
      id: child.visualSeed, kind: child.modelKind, rotation: child.rot, scale: child.scale,
      x: child.x, y: child.y, z: child.z,
    };
  }
  return v;
}

// ── 入队：每帧由 drawWorldEntities 调用（关态零开销）──
// 预算：RENDER_CONFIG.landscapeFrameChildBudget 为每帧入队子图元（含阴影）硬上限，
// 超限按固定遍历序（组 key → role/slot 序）截断——确定性不依赖集合遍历顺序。
var _lsShDir = { x: 0, y: 0, len: 1 }; // 世界阴影方向刮擦（每帧刷新 1 次）
function collectLandscapes(cosZ, sinZ, cosX, sinX) {
  const RC = window.RENDER_CONFIG || {};
  if (RC.landscapeEnabled === false) return; // 配置关态：零开销回退原画面路径

  window.LandscapeModel.sync(sim);
  const groups = window.LandscapeModel.groups();
  if (!groups.length) return;

  const budget = Number.isFinite(RC.landscapeFrameChildBudget) ? RC.landscapeFrameChildBudget : 420;
  const scale = camera.zoom;
  const cx = w / 2 + camera.panX, cy = h / 2 + camera.panY;
  let used = 0;
  // 世界阴影方向每帧刷新一次（SimLighting 缺席防御：旧固定光（西北 41°）方向）
  const SL = window.SimLighting;
  if (SL && SL.shadowDirInto) SL.shadowDirInto(_lsShDir);
  else { _lsShDir.x = 0.6; _lsShDir.y = 0.8; _lsShDir.len = 1.146; }

  for (let gi = 0; gi < groups.length; gi++) {
    const children = groups[gi].children;
    for (let ci = 0; ci < children.length; ci++) {
      const child = children[ci];
      // 视口粗剔除（与装饰同余量口径）：屏外子图元不入队、不占预算
      const rx = child.x * cosZ - child.y * sinZ;
      const ry = child.x * sinZ + child.y * cosZ;
      const az = (child.z || 0) + MAP_Z_LIFT;
      const sx = cx + rx * scale;
      const sy = cy + (ry * cosX - az * sinX) * scale;
      const upMargin = 24 + 44 * scale;
      const xMargin = 24 + 14 * scale;
      if (sx < -xMargin || sx > w + xMargin || sy < -upMargin || sy > h + 20) continue;

      if (used >= budget) return; // 有界截断（固定遍历序）
      const dd = _decalDepth(child.x, child.y, child.footprint, cosZ, sinZ, cosX, sinX);
      _depthItem(DEPTH_LANDSCAPE, child, 0,
        dd != null ? dd : _surfaceDepth(child.x, child.y, child.z, cosZ, sinZ, cosX, sinX));
      used++;

      // 树/灌木子图元的贴地投影独立入队（同装饰 TA-04-6 口径：基点/影梢足迹深度取大，
      // 影梢 = 锚点 + 世界阴影方向 × 影长 × 模型实高，实高不含 zoom）
      const kind = child.modelKind;
      if (kind !== 'Tree' && kind !== 'Bush') continue;
      if (used >= budget) return;
      const skel = landscapeChildModel(child).skeleton;
      if (!skel) continue;
      const hWorld = skel.trunkH * child.scale;
      const tipX = child.x + _lsShDir.x * _lsShDir.len * hWorld;
      const tipY = child.y + _lsShDir.y * _lsShDir.len * hWorld;
      const fp = (kind === 'Tree' ? 10.5 : 8) * child.scale;
      const dBase = _decalDepth(child.x, child.y, fp, cosZ, sinZ, cosX, sinX);
      const dTip = _decalDepth(tipX, tipY, fp, cosZ, sinZ, cosX, sinX);
      let d = dBase != null && (dTip == null || dBase > dTip) ? dBase : dTip;
      if (d == null) d = _surfaceDepth(child.x, child.y, child.z, cosZ, sinZ, cosX, sinX);
      _depthItem(DEPTH_LANDSCAPE_SHADOW, child, 0, d);
      used++;
    }
  }
}

// ── 分发：立体子图元绘制（复用装饰图元，禁复制光照/季相公式）──
function drawLandscapeChild(child) {
  const kind = child.modelKind;
  if (kind !== 'Tree' && kind !== 'Boulder' && kind !== 'Bush' &&
      kind !== 'RockCluster' && kind !== 'GrassTuft') {
    _reportUnknownLandscapeKind(String(kind));
    return;
  }
  const model = landscapeChildModel(child);
  const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
  const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
  const scale = camera.zoom;

  const rx = child.x * cosZ - child.y * sinZ;
  const ry = child.x * sinZ + child.y * cosZ;
  const az = (child.z || 0) + MAP_Z_LIFT;
  const sx = w / 2 + camera.panX + rx * scale;
  const sy = h / 2 + camera.panY + (ry * cosX - az * sinX) * scale;

  const upMargin = 24 + 44 * scale;
  const xMargin = 24 + 14 * scale;
  if (sx < -xMargin || sx > w + xMargin || sy < -upMargin || sy > h + 20) return;

  const view = landscapeChildView(child);
  const scaled = child.scale * scale;
  if (kind === 'Tree') {
    const season = window.SimTreeTint.sample(view, sim, model.evergreen ? 'evergreen' : undefined);
    drawAccentTree(view, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX);
  } else if (kind === 'Boulder') {
    drawAccentBoulder(sx, sy, scaled, child.rot, cosZ, sinZ, cosX, sinX);
  } else if (kind === 'Bush') {
    const season = window.SimTreeTint.sample(view, sim, model.evergreen ? 'evergreen' : undefined);
    drawAccentBush(view, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX);
  } else if (kind === 'RockCluster') {
    drawAccentRockCluster(view, sx, sy, scaled, model, cosZ, sinZ, cosX, sinX);
  } else {
    const season = window.SimTreeTint.sample(view, sim, model.evergreen ? 'evergreen' : undefined);
    drawAccentGrassTuft(view, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX); // render_grass.js
  }
}

// ── 分发：树/灌木子图元贴地投影（复用 render_shadows.js 模型参数化主体）──
function drawLandscapeShadowGround(child) {
  const kind = child.modelKind;
  if (kind !== 'Tree' && kind !== 'Bush') return; // 入队已过滤，防御再判
  drawAccentShadowFor(landscapeChildView(child), landscapeChildModel(child));
}
