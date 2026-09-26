// === 地形壳层投影 / 地形网格线（调试）/ 水系特征绘制（v1.48.0 从 render_world.js 拆出） ===
// ★ 全量 WebGL（Canvas 备用通道删除）：地形格/沙盘基底/侧壁/天空全部由
//   webgl/layers/terrain/terrain-renderer.js 承担；本文件只保留——
//   ① drawTerrainShell 全网格顶点投影（水系、路网、实体拾取复用）；
//   ② drawTerrainGrid 'G' 键调试网格线（2D 叠层）；
//   ③ 水系**非水面**特征绘制（RiverBank 岸线 / ShallowFord 涉渡 / Cliff 峭壁 / 泉谷等，
//      经 render_depth_queue.js DEPTH_FEATURE 段调度）。
//   ★ v1.61.4：River / WaterBody 水面**不存在任何多边形拟合填充**——水面完全由
//   water_particles.js 的粒子承担（drawRiverBand / drawWaterBodyTile 已删除，勿复活）。
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
// ★ v1.61.4：River / WaterBody 水面**不绘制任何多边形填充**——水面 = 粒子层
// （water_particles.js），静态轮廓只作为粒子场源，此处直接跳过；
// RiverBank 的 idx 为段号（逐段描边），其余特征（ShallowFord / Cliff / 泉谷）整条绘制。
function drawFeatureItem(feature, idx) {
  if (!feature.vertices || feature.vertices.length < 2) return;
  if (feature.kind === 'River' || feature.kind === 'WaterBody') return;

  const cx = w / 2 + camera.panX;
  const cy = h / 2 + camera.panY;
  const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
  const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
  const scale = camera.zoom;

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

// ★ v1.61.4：drawRiverBand / drawWaterBodyTile / _wbTileGrid / WB_TILE_STEP 已删除——
//   River / WaterBody 的水面不存在任何多边形拟合填充，水面完全由 water_particles.js
//   粒子层承担（禁止在本文件复活任何水面 fill/clip 绘制）。
