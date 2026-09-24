// === 地形壳层投影 / 地形网格线（调试）/ 水系特征绘制（v1.48.0 从 render_world.js 拆出） ===
// ★ 全量 WebGL（Canvas 备用通道删除）：地形格/沙盘基底/侧壁/天空全部由
//   webgl/layers/terrain/terrain-renderer.js 承担；本文件只保留——
//   ① drawTerrainShell 全网格顶点投影（水系、路网、实体拾取复用）；
//   ② drawTerrainGrid 'G' 键调试网格线（2D 叠层）；
//   ③ 水系特征绘制（drawFeatureItem/drawRiverBand/drawWaterBodyTile——水面在 GL 模式
//     下仍由 2D 统一深度队列绘制，见 render_depth_queue.js DEPTH_FEATURE 段）。
// 依赖全局: ctx, camera, sim, w, h, terrainProjX, terrainProjY
// 另消费 window.RENDER_CONFIG（config.render.js，须先加载）。

// 预分配水系与特征顶点投影缓冲数组 (消除每帧 GC 垃圾回收与对象分配)
let _featProjX = new Float32Array(512);
let _featProjY = new Float32Array(512);
function _ensureFeatProjCapacity(needed) {
  if (_featProjX.length < needed) {
    _featProjX = new Float32Array(needed + 64);
    _featProjY = new Float32Array(needed + 64);
  }
}
function _projectFeatureVertices(vertices, count, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
  _ensureFeatProjCapacity(count);
  for (let i = 0; i < count; i++) {
    const v = vertices[i];
    const rx = v.x * cosZ - v.y * sinZ;
    const ry = v.x * sinZ + v.y * cosZ;
    const y2 = ry * cosX - (v.z || 0) * sinX;
    _featProjX[i] = cx + rx * scale;
    _featProjY[i] = cy + y2 * scale;
  }
}

// 地形壳层：全网格顶点投影（供水系/路网/实体绘制与拾取复用）。
// 地形面片/侧壁/天空已由 WebGL 地形渲染器承担，此处不再落笔。
function drawTerrainShell() {
  if (sim.showTerrain && sim.terrain && sim.terrain.cells && sim.terrain.cells.length >= sim.terrain.gridSize * sim.terrain.gridSize) {
    const gSize = sim.terrain.gridSize;
    const totalVertices = gSize * gSize;
    if (terrainProjX.length !== totalVertices) {
      terrainProjX = new Float32Array(totalVertices);
      terrainProjY = new Float32Array(totalVertices);
    }

    const cx = w / 2 + camera.panX;
    const cy = h / 2 + camera.panY;
    const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
    const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
    const scale = camera.zoom;

    // 单次全网格顶点投影 (3600 次 vs 原 13924 次)
    for (let i = 0; i < totalVertices; i++) {
      const c = sim.terrain.cells[i];
      const rx = c.wx * cosZ - c.wy * sinZ;
      const ry = c.wx * sinZ + c.wy * cosZ;
      const y2 = ry * cosX - c.elev * sinX;
      terrainProjX[i] = cx + rx * scale;
      terrainProjY[i] = cy + y2 * scale;
    }
  }
}

// 地形网格线（调试叠加，'G' 键切换）：0.04 极低透明度的调试线条，
// 置于统一深度队列之后绘制，叠加在实体上不可感知。GL 模式下作为 2D 叠层继续可用。
function drawTerrainGrid() {
  if (!sim.showTerrain || !sim.showGrid || !sim.terrain || !sim.terrain.cells) return;
  const gSize = sim.terrain.gridSize;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  for (let gy = 0; gy < gSize; gy++) {
    const rowOffset = gy * gSize;
    ctx.moveTo(terrainProjX[rowOffset], terrainProjY[rowOffset]);
    for (let gx = 1; gx < gSize; gx++) {
      ctx.lineTo(terrainProjX[rowOffset + gx], terrainProjY[rowOffset + gx]);
    }
  }
  for (let gx = 0; gx < gSize; gx++) {
    ctx.moveTo(terrainProjX[gx], terrainProjY[gx]);
    for (let gy = 1; gy < gSize; gy++) {
      ctx.lineTo(terrainProjX[gy * gSize + gx], terrainProjY[gy * gSize + gx]);
    }
  }
  ctx.stroke();
}

// 单个水系地貌特征绘制（由 render_depth_queue.js 统一深度队列调度）。
// ★ v1.50.20 河流分段绘制：River / RiverBank 的 idx 为段号（整条以「全顶点最大深度」入队
// 会盖住所有更远的实体，见 render_depth_queue.js 收集段注释）；ShallowFord / 其余短特征仍整条绘制。
function drawFeatureItem(feature, idx) {
  if (!feature.vertices || feature.vertices.length < 2) return;

  const cx = w / 2 + camera.panX;
  const cy = h / 2 + camera.panY;
  const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
  const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
  const scale = camera.zoom;

  if (feature.kind === 'River') {
    drawRiverBand(feature, idx | 0, cx, cy, cosZ, sinZ, cosX, sinX, scale);
    return;
  }

  // ★ TB-03 静水闭合水体（盆地泉池 / 湖畔大湖）：分块绘制（idx = 块号 + 1），
  //   不套 River 的成对岸线条带协议；水色与河面共用，不启用 RiverLife 流纹。
  if (feature.kind === 'WaterBody') {
    drawWaterBodyTile(feature, idx | 0, cx, cy, cosZ, sinZ, cosX, sinX, scale);
    return;
  }

  const vLen = feature.vertices.length;
  _projectFeatureVertices(feature.vertices, vLen, cx, cy, cosZ, sinZ, cosX, sinX, scale);

  if (feature.kind === 'RiverBank') {
    // 岸线带单段描边（idx = 段号）
    const s = idx | 0;
    if (s < 0 || s >= vLen - 1) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(174, 137, 78, 0.24)';
    ctx.lineWidth = Math.max(2, feature.width * scale * 0.06);
    ctx.beginPath();
    ctx.moveTo(_featProjX[s], _featProjY[s]);
    ctx.lineTo(_featProjX[s + 1], _featProjY[s + 1]);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // ── 浅滩涉渡（ShallowFord）与其余地貌特征 ──
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (feature.kind === 'ShallowFord') {
    ctx.strokeStyle = 'rgba(196, 178, 136, 0.88)';
    ctx.lineWidth = Math.max(6, feature.width * scale * 0.22);
    ctx.beginPath();
    ctx.moveTo(_featProjX[0], _featProjY[0]);
    for (let i = 1; i < vLen; i++) ctx.lineTo(_featProjX[i], _featProjY[i]);
    ctx.stroke();

    // 踏石微光
    ctx.strokeStyle = 'rgba(255, 252, 240, 0.90)';
    ctx.lineWidth = Math.max(2.5, feature.width * scale * 0.10);
    ctx.setLineDash([4 * scale, 5 * scale]);
    ctx.beginPath();
    ctx.moveTo(_featProjX[0], _featProjY[0]);
    for (let i = 1; i < vLen; i++) ctx.lineTo(_featProjX[i], _featProjY[i]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (feature.kind === 'Cliff') {
    // ★ 阶段三 D-B2 河谷峭壁（Cliff，id=224）：崖顶折线 → 岩体阴影带 + 崖缘暗线。
    //   仅可视化；禁行事实在内核 cells（RockFace|NO_WALK），与 T1 台缘同语义。
    const _strokeCliffPath = () => {
      ctx.beginPath();
      ctx.moveTo(_featProjX[0], _featProjY[0]);
      for (let i = 1; i < vLen; i++) ctx.lineTo(_featProjX[i], _featProjY[i]);
      ctx.stroke();
    };
    // 岩体阴影带（崖顶中线向外的宽描边，色相近 RockFace）
    ctx.strokeStyle = 'rgba(96, 88, 80, 0.38)';
    ctx.lineWidth = Math.max(5, feature.width * scale * 0.30);
    _strokeCliffPath();
    // 崖缘暗线（勾勒崖顶走向）
    ctx.strokeStyle = 'rgba(58, 52, 48, 0.55)';
    ctx.lineWidth = Math.max(2, feature.width * scale * 0.10);
    _strokeCliffPath();
  } else {
    // 其余特征（含 SpringValley 泉谷浅沟）：柔和土褐细带
    ctx.strokeStyle = 'rgba(174, 137, 78, 0.24)';
    ctx.lineWidth = Math.max(2, feature.width * scale * 0.06);
    ctx.beginPath();
    ctx.moveTo(_featProjX[0], _featProjY[0]);
    for (let i = 1; i < vLen; i++) ctx.lineTo(_featProjX[i], _featProjY[i]);
    ctx.stroke();
  }
  ctx.restore();
}

// ★ v1.50.20 河面单段绘制（idx = 剖分区间号）：
//   河道 outline 是「左岸 N 点顺去 + 右岸 N 点逆回」的闭合带（hydrology.rs），
//   顶点 i 与顶点 vLen-1-i 同为第 i 剖分断面的左右岸点。段 b 的四边形 =
//   (v[b], v[b+1], v[vLen-2-b], v[vLen-1-b])。
//   绘制时 **clip 到该段四边形内、再整多边形两遍填充**（深水基底 + 主水体）：
//   硬 clip 逐像素归属唯一一段 ⇒ 相邻段无接缝、无半透明叠 blend，
//   观感与整河单次填充完全一致；段外的更近地形/实体照常遮挡该段。
function drawRiverBand(feature, band, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
  const v = feature.vertices, vLen = v.length, half = vLen >> 1;
  if (band < 0 || band >= half - 1) return;
  const j = vLen - 1 - band;
  _projectFeatureVertices(v, vLen, cx, cy, cosZ, sinZ, cosX, sinX, scale);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(_featProjX[band], _featProjY[band]);
  ctx.lineTo(_featProjX[band + 1], _featProjY[band + 1]);
  ctx.lineTo(_featProjX[j - 1], _featProjY[j - 1]);
  ctx.lineTo(_featProjX[j], _featProjY[j]);
  ctx.closePath();
  ctx.clip();

  // 整多边形填充（clip 限定只落本段）：底层深水基底 + 主流水体，与旧整河填充同色同透明度
  ctx.beginPath();
  ctx.moveTo(_featProjX[0], _featProjY[0]);
  for (let i = 1; i < vLen; i++) ctx.lineTo(_featProjX[i], _featProjY[i]);
  ctx.closePath();
  ctx.fillStyle = 'rgba(28, 82, 116, 0.25)';
  ctx.fill();
  ctx.fillStyle = 'rgba(54, 158, 202, 0.62)';
  ctx.fill();
  ctx.restore();
}

// ★ TB-03 静水分块网格（由顶点 AABB 推导；与 render_depth_queue.js 收集段同式。
//   特征快照在网格重建/静态替换时整体换新对象，块网格缓存在特征对象上安全）。
const WB_TILE_STEP = 32;
function _wbTileGrid(feature) {
  if (feature._wbTiles) return feature._wbTiles;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const v = feature.vertices;
  for (let i = 0; i < v.length; i++) {
    if (v[i].x < minX) minX = v[i].x;
    if (v[i].x > maxX) maxX = v[i].x;
    if (v[i].y < minY) minY = v[i].y;
    if (v[i].y > maxY) maxY = v[i].y;
  }
  const nx = Math.max(1, Math.ceil((maxX - minX) / WB_TILE_STEP));
  const ny = Math.max(1, Math.ceil((maxY - minY) / WB_TILE_STEP));
  feature._wbTiles = { minX, minY, nx, ny };
  return feature._wbTiles;
}

// ★ TB-03 静水单块绘制（idx = 块号 + 1）：clip 到该块世界矩形内、再整闭合多边形
//   两遍填充（深水基底 + 主水体，与河面同色同透明度）。分块参与统一深度排序，
//   近岸人物与房屋不被整湖一项盖住（TB-03-IMPLEMENTATION-PLAN §7.3）。
function drawWaterBodyTile(feature, idx, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
  const g = _wbTileGrid(feature);
  const t = idx - 1;
  if (t < 0 || t >= g.nx * g.ny) return;
  const tx = t % g.nx, ty = (t / g.nx) | 0;
  const x0 = g.minX + tx * WB_TILE_STEP;
  const y0 = g.minY + ty * WB_TILE_STEP;
  const x1 = x0 + WB_TILE_STEP;
  const y1 = y0 + WB_TILE_STEP;

  // 投影块四角（世界 → 屏幕，与 _projectFeatureVertices 同式）
  const proj = (wx, wy) => {
    const rx = wx * cosZ - wy * sinZ;
    const ry = wx * sinZ + wy * cosZ;
    const y2 = ry * cosX - (feature.elevation || 0) * sinX;
    return [cx + rx * scale, cy + y2 * scale];
  };
  const c0 = proj(x0, y0), c1 = proj(x1, y0), c2 = proj(x1, y1), c3 = proj(x0, y1);

  const v = feature.vertices, vLen = v.length;
  _projectFeatureVertices(v, vLen, cx, cy, cosZ, sinZ, cosX, sinX, scale);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(c0[0], c0[1]);
  ctx.lineTo(c1[0], c1[1]);
  ctx.lineTo(c2[0], c2[1]);
  ctx.lineTo(c3[0], c3[1]);
  ctx.closePath();
  ctx.clip();

  // 整多边形填充（clip 限定只落本块）：与 drawRiverBand 同色的双层水面
  ctx.beginPath();
  ctx.moveTo(_featProjX[0], _featProjY[0]);
  for (let i = 1; i < vLen; i++) ctx.lineTo(_featProjX[i], _featProjY[i]);
  ctx.closePath();
  ctx.fillStyle = 'rgba(28, 82, 116, 0.25)';
  ctx.fill();
  ctx.fillStyle = 'rgba(54, 158, 202, 0.62)';
  ctx.fill();
  ctx.restore();
}
