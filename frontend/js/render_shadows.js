// === 装饰贴地投影绘制层（★ TA-04-6，docs/plan/tech/07-terrain-art.md §6.5 末段）===
// 树/灌木的贴地投影自 drawAccentTree / drawAccentBush 实体内迁出，作为**地面图元**独立
// 加入统一深度队列——绘制逻辑归本文件（装饰层），入队和分发归 render_depth_queue.js
// （队列层）；深度由世界落点（基点 + 影梢）足迹深度取大，不沿用树根/树冠深度。
//
// 影长复用世界光向 shadowOffset(hWorld)：hWorld = 模型实高 × accent.scale（**不含 camera.zoom**，
// zoom 只在 SimLighting.shadowOffset 内乘一次，杜绝重复缩放）——高树比矮树影长；
// 屏幕偏移直接沿影向量落位，**移除旧版对屏幕 x/y 分别乘 0.7/0.4 的轴向缩放**（方向偏差消除，
// 影向 = 世界阴影方向经相机投影，与枝干明暗带/叶簇亮部同一套约定）。
// 叶量调制覆盖与强度（§6.5）：夏季冠影完整（宽椭圆 + 高不透明度），冬季以稀疏枝影
// 与弱接地影为主（冠影收缩淡出 + 两条沿影向细长枝影，α ∝ 1−leaf）。
// 阴影为半透明地面图元：不参与拾取、不遮挡选中信息（§11.2 最小遮挡口径）；
// 站进影内的实体被影色罩到属「处于影中」的正常读感（07 号 §6.5「不承诺逐像素投影正确」样板口径）。
//
// 零 GC（TA-11-6 纪律）：参数读取写模块级复用对象，阴影偏移走 render_accents.js::_shadowOffset
// （out 参数消费）；GrassTuft 贴地弱投影与 RockCluster 微接触阴影不在本文件（各自原文件保留）。
//
// 依赖全局: ctx, camera, sim, w, h, MAP_Z_LIFT（render_depth_queue.js）、lightShadowOffset
//   （render_world.js）、_shadowOffset（render_accents.js 共享刮擦）、window.AccentModel、
//   window.SimTreeTint、window.RENDER_CONFIG。

// ★ TA-04-6 投影参数读取（config.render.js；缺省回退与集中值一致；零 GC 写入复用对象）
var _shCfg = { alpha: 0.17, groundAlpha: 0.12, branchAlpha: 0.1, minPx: 2.5 };
function accentShadowCfg() {
  const RC = window.RENDER_CONFIG || {};
  const a = RC.accentShadowAlpha; if (Number.isFinite(a)) _shCfg.alpha = a;
  const g = RC.accentShadowGroundAlpha; if (Number.isFinite(g)) _shCfg.groundAlpha = g;
  const b = RC.accentShadowBranchAlpha; if (Number.isFinite(b)) _shCfg.branchAlpha = b;
  const m = RC.accentShadowMinPx; if (Number.isFinite(m)) _shCfg.minPx = m;
  return _shCfg;
}

// Tree/Bush：贴地投影地面图元（统一深度队列 DEPTH_ACCENT_SHADOW 分发入口）
function drawAccentShadowGround(accent) {
  const kind = accent.kind;
  if (kind !== 'Tree' && kind !== 'Bush') return; // 入队已过滤，防御再判
  const model = window.AccentModel.get(accent);
  const skel = model.skeleton;
  if (!skel) return;
  const season = window.SimTreeTint.sample(accent, sim, model.evergreen ? 'evergreen' : undefined);
  const leaf = season.leafDensity;
  const vSeed = model.vSeed;
  const scale = camera.zoom;
  const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
  const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);

  // 锚点投影（与 drawAccentEntity 同一套相机变换）
  const rx = accent.x * cosZ - accent.y * sinZ;
  const ry = accent.x * sinZ + accent.y * cosZ;
  const az = (accent.z || 0) + MAP_Z_LIFT;
  const sx = w / 2 + camera.panX + rx * scale;
  const sy = h / 2 + camera.panY + (ry * cosX - az * sinX) * scale;

  // LOD：冠屏半径过小整组省略（远景亚像素噪声）
  const crownR = (kind === 'Tree' ? 8.5 : (5.5 + vSeed * 1.2)) * accent.scale * scale;
  const cfg = accentShadowCfg();
  if (crownR < cfg.minPx) return;

  // 影向量：世界光向阴影方向 × 影长 × 模型实高（世界单位）→ 屏幕投影（含一次 zoom）
  const hWorld = skel.trunkH * accent.scale;
  const so = _shadowOffset(kind === 'Tree' ? 1.2 : 1.0, kind === 'Tree' ? 2.5 : 2.0, hWorld);

  // 视口剔除（覆盖 = 锚点 ± 冠幅与影梢的包络）
  const ext = crownR * 1.8 + Math.abs(so.x) + Math.abs(so.y);
  if (sx + ext < 0 || sx - ext > w || sy + ext < 0 || sy - ext > h) return;

  const shadowK = 0.55 + 0.45 * leaf;           // 叶量 → 覆盖缩放（沿用旧口径）
  const kA = so.alphaScale;                     // 季节光照不透明度调制（lightShadowOffset）
  const crowW = crownR * (0.85 + vSeed * 0.15); // 冠幅（px，含个体变径）
  const ang = Math.atan2(so.y, so.x);           // 影向 = 世界阴影方向的屏幕投影（方向无轴向偏差）

  // 1) 接地弱影（贴树根，冬季仍存——「弱接地影」）
  ctx.fillStyle = 'rgba(20, 15, 10, ' + (cfg.groundAlpha * kA * (0.55 + 0.45 * leaf)).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(sx, sy, crowW * 0.52 * (0.55 + 0.45 * leaf), crowW * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // 2) 稀疏枝影（冬季为主：两条沿影向细长椭圆，α ∝ 1−leaf；夏季被冠影覆盖无感知）
  if (leaf < 0.95) {
    ctx.fillStyle = 'rgba(20, 15, 10, ' + (cfg.branchAlpha * kA * (1 - leaf)).toFixed(3) + ')';
    for (let i = 0; i < 2; i++) {
      const t = 0.45 + i * 0.33 + (vSeed - 0.5) * 0.12; // 影向 45%/78% 处 + 个体稳定抖动
      ctx.beginPath();
      ctx.ellipse(sx + so.x * t, sy + so.y * t, crowW * 0.34, crowW * 0.1, ang, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3) 冠影（夏季完整：沿影向拉长的宽椭圆，随叶量收缩淡出；中心 = 冠心世界落点 ≈ 锚点 + 85% 影向量）
  ctx.fillStyle = 'rgba(20, 15, 10, ' + (cfg.alpha * kA * (0.30 + 0.70 * leaf)).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(sx + so.x * 0.85, sy + so.y * 0.85,
    crowW * shadowK * 1.12, crowW * 0.42 * shadowK, ang, 0, Math.PI * 2);
  ctx.fill();
}
