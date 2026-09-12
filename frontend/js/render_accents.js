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
// - 受光：本任务沿用既有左上柔光亮部；世界光向动态受光（法线点积）属 TA-04。
// - ★ v1.50.27 漫画风两遍式树冠：叶簇不再逐簇画深色 rim 轮廓（相邻簇叠压处
//   rim 压在邻簇本体上，冠内布满深色分界线，观感像一堆描边气泡），改为
//   Pass A 全簇统一冠影色铺合并剪影 + Pass B 逐簇体积明暗（下暗上亮、远暗近亮）。
//
// 职责分工（§6.7）：
// - accent-season.js：季相与物种曲线（window.SimTreeTint 唯一生产者）
// - accent-model.js：稳定形态派生 + 个体模型缓存（骨架 / 叶簇次序 / extent）
// - 本文件：模型投影、色板与色差、细节分级、视口剔除、绘制入口
//
// 依赖全局: ctx, camera, sim, w, h, MAP_Z_LIFT（render_world.js 定义，渲染期可用）、
//   lightShadowOffset（render_world.js）、window.SimTreeTint（accent-season.js）、
//   window.AccentModel（accent-model.js，须先于本文件加载）、window.RENDER_CONFIG。

// ★ v1.50.2 D-A：Accent 装饰（Tree/Boulder/Bush）单实体绘制入口
// 现统一并入 render_world.js::drawWorldEntities() 的相机深度队列（远 → 近），
// 与 POI 标记 / 私产宅舍 / 部落民同队列排序，近处乔木可正确遮挡远处道路与小人。
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

  // 视口粗剔除：树冠/枝梢向上与横向延伸，按缩放留足余量避免边缘弹跳
  // （★ TA-03 骨架横向 reach ≈ crownR，边距随缩放走；上方余量覆盖干高 + 冠顶）
  const upMargin = 24 + 44 * scale;
  const xMargin = 24 + 14 * scale;
  if (sx < -xMargin || sx > w + xMargin || sy < -upMargin || sy > h + 20) return;

  // Tree/Bush 共用连续季相（TA-02）；常绿变体走 evergreen profile（叶量全年 ≥94%）
  const model = window.AccentModel.get(accent);
  const season = accent.kind === 'Boulder' ? null
    : window.SimTreeTint.sample(accent, sim, model.evergreen ? 'evergreen' : undefined);

  const scaled = accent.scale * scale;
  if (accent.kind === 'Tree') {
    drawAccentTree(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX);
  } else if (accent.kind === 'Boulder') {
    drawAccentBoulder(sx, sy, scaled, accent.rotation || 0, cosZ, sinZ);
  } else {
    drawAccentBush(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX);
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

  // 冠内体积明暗基准：对整副骨架（非当帧可见簇）求 z / 投影深度范围——
  // 秋季掉叶时幸存簇的明暗不随可见集跳变；纯 id 派生，读档/回溯逐位一致
  let zLo = Infinity, zHi = -Infinity, dLo = Infinity, dHi = -Infinity;
  for (let i = 0; i < sk.clusters.length; i++) {
    const c = sk.clusters[i];
    if (c.z < zLo) zLo = c.z;
    if (c.z > zHi) zHi = c.z;
    const pd = proj(c.x, c.y, c.z).d;
    if (pd < dLo) dLo = pd;
    if (pd > dHi) dHi = pd;
  }
  const zSpan = Math.max(0.001, zHi - zLo);
  const dSpan = Math.max(0.001, dHi - dLo);

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

  // Pass B：簇本体（基色 + lite 色差，再乘冠内体积明暗）
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const j = (it.c.lite - 0.5) * 2 * jitterAmp;
    const tZ = (it.c.z - zLo) / zSpan;   // 冠内高度 0 底 → 1 顶
    const tD = (it.p.d - dLo) / dSpan;   // 投影深度 0 远 → 1 近
    const k = (0.80 + 0.20 * tZ) * (0.90 + 0.10 * tD);
    ctx.fillStyle = 'rgb(' +
      Math.round(Math.max(0, Math.min(255, (season.leafColor[0] + j) * k))) + ',' +
      Math.round(Math.max(0, Math.min(255, (season.leafColor[1] + j) * k))) + ',' +
      Math.round(Math.max(0, Math.min(255, (season.leafColor[2] + j) * k))) + ')';
    ctx.beginPath();
    ctx.ellipse(it.p.x, it.p.y, it.rr, it.rr * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
    // 近景高光：只给冠层上半部（阳光自上而来）。旧版 `0.20 * it.v` 的 it.v
    // 未入 items 恒为 NaN → fillStyle 赋值被忽略、高光实际从未生效，本版顺带修复
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

  // 冠内体积明暗基准（同 Tree：整副骨架求范围，秋季幸存簇明暗不随可见集跳变）
  let zLo = Infinity, zHi = -Infinity, dLo = Infinity, dHi = -Infinity;
  for (let i = 0; i < sk.clusters.length; i++) {
    const c = sk.clusters[i];
    if (c.z < zLo) zLo = c.z;
    if (c.z > zHi) zHi = c.z;
    const pd = proj(c.x, c.y, c.z).d;
    if (pd < dLo) dLo = pd;
    if (pd > dHi) dHi = pd;
  }
  const zSpan = Math.max(0.001, zHi - zLo);
  const dSpan = Math.max(0.001, dHi - dLo);

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

  // Pass B：簇本体 + 冠内体积明暗
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const j = (it.c.lite - 0.5) * 2 * jitterAmp;
    const tZ = (it.c.z - zLo) / zSpan;
    const tD = (it.p.d - dLo) / dSpan;
    const k = (0.80 + 0.20 * tZ) * (0.90 + 0.10 * tD);
    ctx.fillStyle = 'rgb(' +
      Math.round(Math.max(0, Math.min(255, (season.leafColor[0] + j) * k))) + ',' +
      Math.round(Math.max(0, Math.min(255, (season.leafColor[1] + j) * k))) + ',' +
      Math.round(Math.max(0, Math.min(255, (season.leafColor[2] + j) * k))) + ')';
    ctx.beginPath();
    ctx.ellipse(it.p.x, it.p.y, it.rr, it.rr * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    if (detailNear && it.rr > 2.0 && tZ > 0.30) {
      ctx.fillStyle = 'rgba(255, 252, 218, ' + (0.18 * it.v * (0.35 + 0.65 * tZ)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(it.p.x - it.rr * 0.28, it.p.y - it.rr * 0.40, it.rr * 0.40, it.rr * 0.28, -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
