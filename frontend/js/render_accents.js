// === Accent 装饰绘制层（TA-01，docs/plan/tech/07-terrain-art.md §6.7）===
// Tree / Boulder / Bush 单实体绘制入口，v1.50.23 从 render_terrain.js 原位迁出。
// drawAccentEntity 由 render_world.js::drawWorldEntities() 的统一相机深度队列调度
// （DEPTH_ACCENT，远 → 近），**严禁**在 render() 里恢复「整层先画装饰」的调用
// （v1.50.2 历史教训，见 frontend/AGENTS.md §5.9）。
//
// 职责分工（§6.7）：
// - accent-season.js：季相与物种曲线（window.SimTreeTint 唯一生产者）
// - accent-model.js：稳定形态派生 + 个体模型缓存（vSeed / 叶簇散点 / extent）
// - 本文件：模型投影、受光与色板、视口剔除、绘制入口；后续 TA-04 在此接入世界光向受光
//
// 依赖全局: ctx, camera, sim, w, h, MAP_Z_LIFT（render_world.js 定义，渲染期可用）、
//   lightShadowOffset（render_world.js）、window.SimTreeTint（accent-season.js）、
//   window.AccentModel（accent-model.js，须先于本文件加载）。

// ★ v1.50.2 D-A：Accent 装饰（Tree/Boulder/Bush）单实体绘制入口
// 旧实现 drawAccents() 在 drawTerrain() 内按「种类分组（Bush→Boulder→Tree）→ 数组原序」整层落笔，
// 本质是**按生成顺序而非距离**绘制：远树会压住近树，且乔木永远被后画的道路/族人覆盖。
// 现统一并入 render_world.js::drawWorldEntities() 的相机深度队列（远 → 近），与 POI 标记 / 私产宅舍 /
// 部落民同队列排序，近处乔木可正确遮挡远处道路与小人，远处乔木也被近处实体正确遮挡。
function drawAccentEntity(accent) {
  if (accent.kind !== 'Tree' && accent.kind !== 'Boulder' && accent.kind !== 'Bush') return;

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

  // 视口粗剔除：树冠/树干向上延伸（最大约 36×zoom），上方按缩放留足余量避免边缘弹跳
  const upMargin = 20 + 40 * scale;
  if (sx < -20 || sx > w + 20 || sy < -upMargin || sy > h + 20) return;

  // ★ 2026-09-12 Tree 季节叶色：唯一生产者 SimTreeTint（accent-season.js）。
  //   历史教训：v1.48.0~2026-09-12 期间此处写作 `if (window.SimTreeTint && sim.treeTintEnabled !== false)`，
  //   但 SimTreeTint 全仓无定义点（死分支），且判据用的 sim.treeTintEnabled 来源字段
  //   terrainTreeSeasonTint 已于 v1.50.18 随空转配置清理删除 → 恒 undefined，条件恒假。
  //   净效果是树木叶色恒为 accent.tint（Rust 恒写 0），四季同色。**勿再引入无生产者的全局判据。**
  //   （v1.50.23 迁出时顺带移除了同类的 `window.AccentRenderer` 死分支——全仓无定义点。）
  const seasonTint = (accent.kind === 'Tree' && window.SimTreeTint)
    ? window.SimTreeTint.tint(accent, sim)
    : (accent.tint || 0);

  const scaled = accent.scale * scale;
  if (accent.kind === 'Tree') {
    drawAccentTree(accent, sx, sy, scaled, seasonTint);
  } else if (accent.kind === 'Boulder') {
    drawAccentBoulder(sx, sy, scaled, accent.rotation || 0, cosZ, sinZ);
  } else {
    drawAccentBush(accent, sx, sy, scaled);
  }
}

// Tree：写意微缩乔木 —— 锥形微弯树干 + 四瓣层叠树冠 + 贴地投影（与 POI/房屋同一光照源）
// tint=0 鲜绿(春夏) / 1 黄绿(秋) / 2 红褐(深秋)；scaled = accent.scale(0.7~1.4) × camera.zoom
// ★ TA-01：个体差异（vSeed）与叶簇散点改读 accent-model.js 的稳定模型缓存，
//   数值与原「逐帧哈希现算」逐位一致；迁移零行为变更。
function drawAccentTree(accent, sx, sy, scaled, tint) {
  const model = window.AccentModel.get(accent);
  const vSeed = model.vSeed;
  const crownR = 8.5 * scaled;
  const trunkH = (6.5 + vSeed * 2.5) * scaled;

  // 贴地投影：跟随动态季节光照方向（关闭光照时退化为右下固定影）
  const so = (typeof lightShadowOffset === 'function')
    ? lightShadowOffset(1.2, 2.5, 2.0)
    : { x: 1.2 * camera.zoom, y: 2.5 * camera.zoom, alphaScale: 1 };
  ctx.fillStyle = 'rgba(20, 15, 10, ' + (0.17 * so.alphaScale).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(sx + so.x * 0.7, sy + so.y * 0.4, crownR * (0.85 + vSeed * 0.15), crownR * 0.40, 0, 0, Math.PI * 2);
  ctx.fill();

  // 树干：底粗顶细的锥形曲干，随个体 rotation 微倾
  const leanDx = Math.cos(accent.rotation || 0) * trunkH * 0.22;
  const topX = sx + leanDx, topY = sy - trunkH;
  const bw = Math.max(1.2, crownR * 0.17);
  const tw = Math.max(0.6, bw * 0.45);
  ctx.fillStyle = 'rgb(86, 62, 42)';
  // ★ v1.49.3 描边减重：暗边改为半透明细线，只用于收拢形体不再框死轮廓
  ctx.strokeStyle = 'rgba(40, 28, 18, 0.38)';
  ctx.lineWidth = Math.max(0.4, 0.45 * scaled);
  ctx.beginPath();
  ctx.moveTo(sx - bw, sy);
  ctx.quadraticCurveTo(sx - bw * 0.45, sy - trunkH * 0.55, topX - tw, topY);
  ctx.lineTo(topX + tw, topY);
  ctx.quadraticCurveTo(sx + bw * 0.45, sy - trunkH * 0.55, sx + bw, sy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 树皮受光面：沿左侧一条浅色细干，替代厚重描边提供的立体感
  ctx.strokeStyle = 'rgba(158, 124, 92, 0.5)';
  ctx.lineWidth = Math.max(0.4, 0.32 * scaled);
  ctx.beginPath();
  ctx.moveTo(sx - bw * 0.45, sy - trunkH * 0.06);
  ctx.quadraticCurveTo(sx - bw * 0.15, sy - trunkH * 0.55, topX - tw * 0.4, topY + trunkH * 0.04);
  ctx.stroke();

  // 树冠配色：暗轮廓 / 底色 / 亮部（个体色相 ±7 微调）
  let rim, base, hi;
  if (tint === 1) {
    rim = 'rgb(96, 82, 34)'; base = [160, 142, 72]; hi = [208, 188, 122];
  } else if (tint === 2) {
    rim = 'rgb(88, 44, 22)'; base = [162, 94, 52]; hi = [214, 142, 86];
  } else {
    rim = 'rgb(34, 62, 26)'; base = [66, 108, 50]; hi = [142, 184, 110];
  }
  const vary = Math.round((vSeed - 0.5) * 14);
  base = [base[0] + vary, base[1] + vary, base[2] + vary];

  const ccX = topX, ccY = topY - crownR * 0.30;
  const squash = 0.88;
  // ★ v1.49.3 描边减重：暗轮廓宽度减半，只留一圈细线分离背景
  const lw = Math.max(0.4, 0.5 * scaled);
  // ★ v1.49.3 叶面纹理配色：暗叶簇/亮叶簇按季节色调取色（半透明叠加不遮底色渐变）
  let dapDark, dapLite;
  if (tint === 1) {
    dapDark = 'rgba(122, 104, 44, 0.28)'; dapLite = 'rgba(228, 208, 146, 0.32)';
  } else if (tint === 2) {
    dapDark = 'rgba(122, 62, 32, 0.28)'; dapLite = 'rgba(236, 170, 116, 0.32)';
  } else {
    dapDark = 'rgba(40, 72, 32, 0.28)'; dapLite = 'rgba(178, 212, 140, 0.32)';
  }
  // 四瓣层叠：左右托底瓣 + 主瓣 + 顶瓣
  const lobes = [
    { dx: -0.52, dy: 0.20, r: 0.58 },
    { dx: 0.54, dy: 0.18, r: 0.62 },
    { dx: 0.02, dy: -0.02, r: 0.86 },
    { dx: -0.10 + vSeed * 0.16, dy: -0.50, r: 0.52 },
  ];

  // Pass A：暗轮廓 —— 整组放大一圈填充，瓣间接缝处只留一圈外轮廓
  ctx.fillStyle = rim;
  for (let i = 0; i < lobes.length; i++) {
    const L = lobes[i];
    ctx.beginPath();
    ctx.ellipse(ccX + L.dx * crownR, ccY + L.dy * crownR, L.r * crownR + lw, L.r * crownR * squash + lw, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pass B：主体 —— 共用同一径向渐变（光心在冠顶偏左上），瓣间无缝且整体自上而下变暗
  const grad = ctx.createRadialGradient(
    ccX - crownR * 0.35, ccY - crownR * 0.75, crownR * 0.12,
    ccX, ccY, crownR * 1.28
  );
  grad.addColorStop(0, 'rgb(' + hi[0] + ',' + hi[1] + ',' + hi[2] + ')');
  grad.addColorStop(1, 'rgb(' + base[0] + ',' + base[1] + ',' + base[2] + ')');
  ctx.fillStyle = grad;
  for (let i = 0; i < lobes.length; i++) {
    const L = lobes[i];
    ctx.beginPath();
    ctx.ellipse(ccX + L.dx * crownR, ccY + L.dy * crownR, L.r * crownR, L.r * crownR * squash, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ★ v1.49.3 Pass B2：叶片斑驳纹理 —— 由 id 确定性散布的暗/亮叶簇小点，
  // 给树冠注入叶面质感（替代原先纯渐变的“塑料感”）。散点几何读模型缓存（单位空间还原）。
  const daps = model.treeDapples;
  for (let i = 0; i < daps.length; i++) {
    const d = daps[i];
    const px = ccX + Math.cos(d.ang) * d.radK * crownR * 0.88 + d.shift;
    const py = ccY + Math.sin(d.ang) * d.radK * squash - crownR * 0.04;
    const dr = d.drK * crownR;
    ctx.fillStyle = d.lite ? dapLite : dapDark;
    ctx.beginPath();
    ctx.ellipse(px, py, dr, dr * 0.72, d.ang * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pass C：顶瓣受光点（柔和高光，让冠顶从渐变里再亮一档）
  ctx.fillStyle = 'rgba(255, 252, 218, 0.24)';
  ctx.beginPath();
  ctx.ellipse(ccX - crownR * 0.26, ccY - crownR * 0.62, crownR * 0.30, crownR * 0.22, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

// Boulder：不规则多边形岩石（灰白顶+深灰底+暗边）
function drawAccentBoulder(sx, sy, scaled, rot, cosZ, sinZ) {
  const r = 6 * scaled;
  const sides = 7;
  // ★ v1.50.13 锚点修正：七边形原以 (sx,sy) 为中心，下半岩体沉入地表之下被近处格子盖掉
  //   （「石头半截入土」）。改为底边贴锚点：整体上移 r（多边形最大下探 0.72rVar+0.18r ≈ 1.04r）。
  const cy = sy - r;
  // 阴影底层（深灰，略偏右下）
  ctx.fillStyle = 'rgb(78, 74, 68)';
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
  ctx.fillStyle = 'rgb(152, 146, 138)';
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

// Bush：低矮灌木簇 —— 三瓣层叠圆簇 + 微投影（同 Tree 的暗轮廓二遍填充技法，体量更扁更碎）
// ★ TA-01：枝叶散点改读 accent-model.js 的稳定模型缓存（数值与原逐帧哈希现算逐位一致）。
function drawAccentBush(accent, sx, sy, scaled) {
  const model = window.AccentModel.get(accent);
  const vSeed = model.vSeed;
  const r = (5.5 + vSeed * 1.2) * scaled;

  // 贴地微投影
  const so = (typeof lightShadowOffset === 'function')
    ? lightShadowOffset(1.2, 2.5, 0.7)
    : { x: 1.2 * camera.zoom, y: 2.5 * camera.zoom, alphaScale: 1 };
  ctx.fillStyle = 'rgba(20, 15, 10, ' + (0.15 * so.alphaScale).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(sx + so.x * 0.5, sy + so.y * 0.35, r * 0.95, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // 三瓣簇：左右托瓣 + 顶主瓣（扁压 squash 让簇丛贴地）
  const squash = 0.70;
  // ★ v1.50.13 锚点修正：瓣簇中心原在锚点附近，侧瓣底部下探 ~0.54r 沉入地表被近格盖住。
  //   瓣簇整体上移 0.55r 使底边贴锚点；贴地微投影仍留在地表 sy。
  const cy = sy - r * 0.55;
  // ★ v1.49.3 描边减重：暗轮廓宽度减半
  const lw = Math.max(0.4, 0.45 * scaled);
  const lobes = [
    { dx: -0.48 + vSeed * 0.10, dy: 0.10, r: 0.60 },
    { dx: 0.50 - vSeed * 0.08, dy: 0.12, r: 0.56 },
    { dx: 0.02, dy: -0.20, r: 0.72 },
  ];

  // Pass A：暗轮廓
  ctx.fillStyle = 'rgb(26, 50, 22)';
  for (let i = 0; i < lobes.length; i++) {
    const L = lobes[i];
    ctx.beginPath();
    ctx.ellipse(sx + L.dx * r, cy + L.dy * r, L.r * r + lw, L.r * r * squash + lw, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pass B：主体（径向渐变，光心偏左上）
  const grad = ctx.createRadialGradient(
    sx - r * 0.30, cy - r * 0.65, r * 0.10,
    sx, cy - r * 0.1, r * 1.15
  );
  grad.addColorStop(0, 'rgb(112, 154, 88)');
  grad.addColorStop(1, 'rgb(60, 96, 46)');
  ctx.fillStyle = grad;
  for (let i = 0; i < lobes.length; i++) {
    const L = lobes[i];
    ctx.beginPath();
    ctx.ellipse(sx + L.dx * r, cy + L.dy * r, L.r * r, L.r * r * squash, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ★ v1.49.3 Pass B2：枝叶斑驳纹理 —— 确定性暗/亮小叶点（同 Tree 技法，簇径更小）
  const daps = model.bushDapples;
  for (let i = 0; i < daps.length; i++) {
    const d = daps[i];
    const px = sx + Math.cos(d.ang) * d.radK * r * 0.9;
    const py = cy + Math.sin(d.ang) * d.radK * squash - r * 0.02;
    const dr = d.drK * r;
    ctx.fillStyle = d.lite ? 'rgba(150, 192, 118, 0.30)' : 'rgba(38, 66, 30, 0.26)';
    ctx.beginPath();
    ctx.ellipse(px, py, dr, dr * 0.70, d.ang * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pass C：顶瓣受光点
  ctx.fillStyle = 'rgba(255, 252, 218, 0.20)';
  ctx.beginPath();
  ctx.ellipse(sx - r * 0.18, cy - r * 0.52, r * 0.26, r * 0.18, -0.4, 0, Math.PI * 2);
  ctx.fill();
}
