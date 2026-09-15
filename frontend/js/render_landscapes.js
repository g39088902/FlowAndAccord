// === 资源景观绘制接入层（★ S4-02，STAGE-04-TODO §3.1/§3.4）===
// LandscapeModel 派生组（landscape-model.js）→ 统一深度队列的接入层：
// - collectLandscapes(...)：由 render_depth_queue.js::drawWorldEntities() 在装饰阴影段之后
//   调用——先 LandscapeModel.sync(sim)（静态签名变化才重建几何；遮罩层已在装饰段前同步过，
//   此处幂等兜底），再把每个子图元与树/灌木贴地投影分别入队（DEPTH_LANDSCAPE /
//   DEPTH_LANDSCAPE_SHADOW，深度口径与装饰一致走 _decalDepth 足迹感知深度）。
//   **本层不做绘制逻辑，也严禁把配方/索引/遮罩搬进队列层**；保护区遮蔽判定委托
//   landscape-mask.js::childHidden（S4-03），被遮蔽子图元连同投影不入队。
// - drawLandscapeChild / drawLandscapeShadowGround：深度队列分发入口——立体树石草复用
//   render_accents.js / render_grass.js 既有图元（drawAccentTree/Boulder/Bush/RockCluster/
//   GrassTuft），阴影复用 render_shadows.js::drawAccentShadowFor（模型参数化主体），
//   季相复用 window.SimTreeTint，光照经图元内部 accentLitFill 单一入口——**不复制光照公式**。
//   ★ S4-04：GroundPatch 贴地色差片（Water 湿润土 / Wood 林下暗部）为本地两遍式椭圆图元
//   （无 AccentModel 模型、无受光法线）；可采细节子图元（stockRole 'detail'）由
//   LandscapeModel.childActive 按 q ≥ qThreshold 过滤显隐——骨架零影响。
//   ★ S4-05：新增 berry（果实点簇）/ gold（矿脉斑点）/ quarry（可采面明暗）三种 detail
//   贴地片——点簇几何构建期预计算（child.dots），q 只驱动绘制期可见点数（round(n×q)）
//   与 quarry 的 globalAlpha 强度（连续单调）；点色恒为常量 + globalAlpha，零字符串分配；
//   gold 哑光**严禁发光**（无 shadowBlur/亮晕），collect 时组 q 镜像到 child._q。
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
  // ★ TA-07：入队前剔除总开关（accentLODCullEnabled；关态完整回退「不剔除 + 绘制端自算」路径）
  const AL0 = window.AccentLOD;
  const cullOn = !!(AL0 && AL0.cfg().cullOn);
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
      // ★ S4-03 保护区遮蔽：道路/房屋/POI 命中的子图元整体隐藏（阴影随同不入队），
      //   判定已在占据网格重建时预判（child._masked），此处零距离计算
      const LM = window.LandscapeMask;
      if (LM && LM.childHidden(child)) continue;
      // ★ S4-04 可采细节（stockRole 'detail'）：q ≥ qThreshold 才显示——骨架恒可见，
      //   库存 0/中间/满只改变 detail 显隐数量（单调），不影响入队几何
      if (!window.LandscapeModel.childActive(groups[gi], child)) continue;
      // ★ S4-05 detail 贴地片绘制期消费的组丰度镜像（表现缓存；q 有效由 childActive 保证）
      if (child.stockRole === 'detail') child._q = groups[gi].q;
      // ★ TA-07 视口剔除（AccentLOD 解析式 AABB 取代旧「与装饰同款」44/14 启发余量）：
      // 屏外子图元不入队、不占预算；GroundPatch 无模型，直接用自身半径拼装包围体。
      const rx = child.x * cosZ - child.y * sinZ;
      const ry = child.x * sinZ + child.y * cosZ;
      const az = (child.z || 0) + MAP_Z_LIFT;
      const sx = cx + rx * scale;
      const sy = cy + (ry * cosX - az * sinX) * scale;
      const AL = window.AccentLOD;
      if (cullOn) {
        const isPatch = child.modelKind === 'GroundPatch';
        const b = isPatch ? AL.boundsScratch(child.radius, 0, 0, 0) : AL.kindBounds(child.modelKind);
        const a = AL.aabbOf(sx, sy, b, AL.SHEAR_MAX,
          isPatch ? scale : (child.scale || 1) * scale, cosX, sinX, AL.aabb);
        if (!AL.visible(a)) continue;
      }

      if (used >= budget) return; // 有界截断（固定遍历序）
      const dd = _decalDepth(child.x, child.y, child.footprint, cosZ, sinZ, cosX, sinX);
      const lit = _depthItem(DEPTH_LANDSCAPE, child, 0,
        dd != null ? dd : _surfaceDepth(child.x, child.y, child.z, cosZ, sinZ, cosX, sinX));
      // ★ TA-07：屏幕 AABB（s1x/s1y = 左下、s2x/s2y = 右上）与锚点屏幕坐标（ex/ey）随深度项
      // 传递，绘制端零重投影、零重剔除（入队端与绘制端消费**同一个** AABB，§3.5 红线）。
      lit.ex = sx; lit.ey = sy;
      if (cullOn) {
        // lod=1 ⇒ 绘制端不再重剔（消费**同一个** AABB）；剔除关态时绘制端按现状自算自剔
        lit.lod = 1;
        lit.s1x = AL.aabb.x0; lit.s1y = AL.aabb.y0; lit.s2x = AL.aabb.x1; lit.s2y = AL.aabb.y1;
      }
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
      const fp = (skel.footprintR || (kind === 'Tree' ? 10.5 : 8)) * child.scale; // ★ TA-06-8 冠幅足迹读模型
      const dBase = _decalDepth(child.x, child.y, fp, cosZ, sinZ, cosX, sinX);
      const dTip = _decalDepth(tipX, tipY, fp, cosZ, sinZ, cosX, sinX);
      let d = dBase != null && (dTip == null || dBase > dTip) ? dBase : dTip;
      if (d == null) d = _surfaceDepth(child.x, child.y, child.z, cosZ, sinZ, cosX, sinX);
      const sit = _depthItem(DEPTH_LANDSCAPE_SHADOW, child, 0, d);
      // 锚点屏幕坐标随深度项传递（阴影绘制端零重投影）
      if (window.AccentLOD) { sit.ex = sx; sit.ey = sy; }
      used++;
    }
  }
}

// ── 分发：立体子图元绘制（复用装饰图元，禁复制光照/季相公式）──
// ★ TA-07-6：第二参 it = 深度队列项（可选）——入队端已把 AABB 与锚点屏幕坐标写入，
//   绘制端直接消费（口径唯一）；缺省时按 AccentLOD 自算（保持独立可调用与可测性）。
function drawLandscapeChild(child, it) {
  const kind = child.modelKind;
  if (kind === 'GroundPatch') { drawLandscapeGroundPatch(child, it); return; } // ★ S4-04 贴地色差片（无 AccentModel 模型）
  if (kind !== 'Tree' && kind !== 'Boulder' && kind !== 'Bush' &&
      kind !== 'RockCluster' && kind !== 'GrassTuft') {
    _reportUnknownLandscapeKind(String(kind));
    return;
  }
  const model = landscapeChildModel(child);
  const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
  const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
  const scale = camera.zoom;

  let sx, sy;
  if (it) {
    sx = it.ex; sy = it.ey;
  } else {
    const rx = child.x * cosZ - child.y * sinZ;
    const ry = child.x * sinZ + child.y * cosZ;
    const az = (child.z || 0) + MAP_Z_LIFT;
    sx = w / 2 + camera.panX + rx * scale;
    sy = h / 2 + camera.panY + (ry * cosX - az * sinX) * scale;
    const AL0 = window.AccentLOD;
    // 入队端已剔除（it.lod===1）时不再重剔；独立调用或剔除关态时按 AccentLOD 自算自剔
    if (!it || it.lod !== 1) {
      if (AL0 && AL0.cfg().cullOn) {
        const a0 = AL0.aabbOf(sx, sy, AL0.kindBounds(kind), AL0.SHEAR_MAX,
          (child.scale || 1) * scale, cosX, sinX, AL0.aabb);
        if (!AL0.visible(a0)) return;
      }
    }
  }

  const view = landscapeChildView(child);
  const scaled = child.scale * scale;
  // ★ TA-06-2：profile 走模型单一入口（树木三轮廓 / 灌木三变体自动作用于景观子图元；
  // GrassTuft 为 undefined 回退 deciduousTree，芦草穗量不受 floweringBush 曲线影响）。
  if (kind === 'Tree') {
    const season = window.SimTreeTint.sample(view, sim, model.profile);
    drawAccentTree(view, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX);
  } else if (kind === 'Boulder') {
    drawAccentBoulder(view, sx, sy, scaled, model, cosZ, sinZ, cosX, sinX);
  } else if (kind === 'Bush') {
    const season = window.SimTreeTint.sample(view, sim, model.profile);
    drawAccentBush(view, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX);
  } else if (kind === 'RockCluster') {
    drawAccentRockCluster(view, sx, sy, scaled, model, cosZ, sinZ, cosX, sinX);
  } else {
    const season = window.SimTreeTint.sample(view, sim, model.profile);
    drawAccentGrassTuft(view, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX); // render_grass.js
  }
}

// ── 贴地色差片绘制（★ S4-04：Water 湿润土 'wet' / Wood 林下暗部 'shade'）──
// 地面圆经 rotX 俯仰投影为椭圆（短轴 = r·cosX；rotZ 旋转不改变圆形投影形状）；
// 候选格心+四缘坡度超限已在模型层拒绝（§3.4），首版不做片内分段贴坡。
// 两遍式柔和色差：外圈弱 alpha + 内圈略深（内圈中心按子图元稳定 rot 微偏，避免同心呆板）。
// 固定贴地色差（湿润土/林下暗部），**不走** accentLitFill 光照公式（贴地片无受光法线）；
// 冬季按 landscapeGroundWinterAlphaRatio 减弱（积雪覆盖湿润/阴影观感）。
// 填充样式串按 tone×季节预建常量（渲染热路径零字符串分配，同 render_accents 零 GC 先例）。
var _gpStyleCache = { Spring: null, Summer: null, Autumn: null, Winter: null };
function _gpStyles(season) {
  let s = _gpStyleCache[season];
  if (s) return s;
  let k = 1;
  if (season === 'Winter') {
    const v = (window.RENDER_CONFIG || {}).landscapeGroundWinterAlphaRatio;
    k = Number.isFinite(v) ? v : 0.6;
  }
  const mk = function (col, a) { return 'rgba(' + col + ',' + (a * k).toFixed(3) + ')'; };
  s = {
    wetOuter: mk('74,62,46', 0.28), wetInner: mk('74,62,46', 0.22),
    shadeOuter: mk('26,34,22', 0.15), shadeInner: mk('26,34,22', 0.13),
    // ★ S4-05：berry 繁茂浅绿基底 / gold 岩屑暗基底（点簇 detail 的底层贴地色差）
    berryOuter: mk('113,137,66', 0.12), berryInner: mk('113,137,66', 0.10),
    goldOuter: mk('96,88,72', 0.14), goldInner: mk('96,88,72', 0.11),
  };
  _gpStyleCache[season] = s;
  return s;
}
// 点簇/可采面 detail 的点与颜色常量（绘制期 q 只改可见点数与 globalAlpha——零字符串分配）
var _gpDot = {
  berry: { col: 'rgb(146,52,70)', n: 10, rK: 0.16, minR: 1.5 },   // 深浆果红，哑光
  gold: { col: 'rgb(191,155,74)', n: 10, rK: 0.14, minR: 1.2 },   // 哑光金矿脉斑，禁发光（无 shadowBlur/亮晕）
};
function drawLandscapeGroundPatch(child, it) {
  const scale = camera.zoom;
  const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
  const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
  let sx, sy;
  if (it) {
    sx = it.ex; sy = it.ey;
  } else {
    const rx = child.x * cosZ - child.y * sinZ;
    const ry = child.x * sinZ + child.y * cosZ;
    const az = (child.z || 0) + MAP_Z_LIFT;
    sx = w / 2 + camera.panX + rx * scale;
    sy = h / 2 + camera.panY + (ry * cosX - az * sinX) * scale;
  }
  const r = child.radius * scale;
  // ★ TA-07：硬编码 1px 收编为 RENDER_CONFIG.accentLODGroundPatchMinPx（缺省 1.0，行为不变）
  const AL = window.AccentLOD;
  if (r < (AL ? AL.cfg().gpMin : 1)) return;
  const st = _gpStyles(sim.currentSeason);
  const wet = child.tone === 'wet';
  const ryEll = r * cosX;
  const offR = r * 0.18;
  const ix = sx + Math.cos(child.rot) * offR;
  const iy = sy + Math.sin(child.rot) * offR * cosX;
  const isBerry = child.tone === 'berry', isGold = child.tone === 'gold', isQuarry = child.tone === 'quarry';
  // 基底（berry/gold/quarry 为 detail：α 随 q 的部分走 globalAlpha，样式串恒为预建常量）
  if (isQuarry) {
    // 可采面明暗：整体 α 随 q 线性增强（0 时近乎无痕，满时明显采挖痕）
    const q = child._q || 0;
    ctx.globalAlpha = 0.06 + 0.16 * q;
    ctx.fillStyle = 'rgb(120,114,104)';
    ctx.beginPath(); ctx.ellipse(sx, sy, r, ryEll, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.05 + 0.13 * q;
    ctx.beginPath(); ctx.ellipse(ix, iy, r * 0.62, ryEll * 0.62, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  ctx.fillStyle = wet ? st.wetOuter : isBerry ? st.berryOuter : isGold ? st.goldOuter : st.shadeOuter;
  ctx.beginPath(); ctx.ellipse(sx, sy, r, ryEll, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = wet ? st.wetInner : isBerry ? st.berryInner : isGold ? st.goldInner : st.shadeInner;
  ctx.beginPath(); ctx.ellipse(ix, iy, r * 0.62, ryEll * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  // ★ S4-05 点簇 detail：可见点数 = round(n × q)（连续强度单调，§3.2）；冬季 α 减弱
  if (isBerry || isGold) {
    const dot = _gpDot[isBerry ? 'berry' : 'gold'];
    const q = child._q || 0;
    const n = Math.min(dot.n, Math.round(dot.n * q));
    if (n <= 0) return;
    const dr = Math.max(dot.minR, r * dot.rK);
    let alpha = 0.92;
    if (sim.currentSeason === 'Winter') {
      const k = Number.isFinite((window.RENDER_CONFIG || {}).landscapeGroundWinterAlphaRatio)
        ? (window.RENDER_CONFIG || {}).landscapeGroundWinterAlphaRatio : 0.6;
      alpha *= k;
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = dot.col;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const ox = child.dots[i * 2] * r, oy = child.dots[i * 2 + 1] * r * cosX;
      ctx.moveTo(sx + ox + dr, sy + oy);
      ctx.arc(sx + ox, sy + oy, dr, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ── 分发：树/灌木子图元贴地投影（复用 render_shadows.js 模型参数化主体）──
function drawLandscapeShadowGround(child, it) {
  const kind = child.modelKind;
  if (kind !== 'Tree' && kind !== 'Bush') return; // 入队已过滤，防御再判
  drawAccentShadowFor(landscapeChildView(child), landscapeChildModel(child), it);
}
