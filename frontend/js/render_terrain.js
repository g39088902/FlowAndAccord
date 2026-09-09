// === 地形与天空氛围绘制（v1.48.0 从 render_world.js 拆出） ===
// 地形网格 / 水系地貌特征 / 天空背景与大气色洗
// 依赖全局: ctx, camera, sim, project3D, getElevationColor, w, h, terrainProjX, terrainProjY, SimLighting
//
// ★ 动态季节光照（docs/27-plan-seasonal-lighting.md）：
//   地形颜色本身由 SimLighting.relightTerrain() 每光档写回 cell.color，本文件只负责绘制；
//   天空背景与大气色洗是两个固定的氛围插入点，不得在此新增整层立体实体绘制。

// 天空/地平渐变 + 逆光光晕（光源对侧偏亮，光晕随四季方位绕地平线移动）
function drawSkyBackdrop() {
  const L = window.SimLighting;
  if (!L || !L.enabled()) return;
  const c = L.cfg();
  const tint = L.tint();
  const lightTheme = !!(c.respectLightTheme && document.body && document.body.classList.contains('theme-light'));
  const mix = lightTheme ? 0.42 : 0;

  const mixCh = (r, g, b) => [
    Math.round(r * (1 - mix) + 226 * mix),
    Math.round(g * (1 - mix) + 232 * mix),
    Math.round(b * (1 - mix) + 240 * mix),
  ];
  const [tr, tg, tb] = mixCh(5 * tint[0], 10 * tint[1], 18 * tint[2]);
  const [hr, hg, hb] = mixCh(30 * tint[0], 37 * tint[1], 50 * tint[2]);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `rgb(${Math.round(tr)}, ${Math.round(tg)}, ${Math.round(tb)})`);
  grad.addColorStop(1, `rgb(${Math.round(hr)}, ${Math.round(hg)}, ${Math.round(hb)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 逆光光晕：低日头（隆冬/晨昏）更浓，盛夏更淡
  const dir = L.sunScreenDir();
  const gx = w * 0.5 + dir.x * w * 0.55;
  const gy = h * 0.5 + dir.y * h * 0.55;
  const rad = Math.max(w, h) * 0.55;
  const glow = (0.09 + 0.11 * (1 - Math.sin(L.elevationDeg() * Math.PI / 180))) * (1 - mix * 0.6);
  const gr = Math.round(Math.min(255, 255 * Math.min(1.12, tint[0])));
  const gg = Math.round(Math.min(255, 214 * Math.min(1.12, tint[1])));
  const gb = Math.round(Math.min(255, 168 * Math.min(1.12, tint[2])));
  const glowGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, rad);
  glowGrad.addColorStop(0, `rgba(${gr}, ${gg}, ${gb}, ${glow.toFixed(3)})`);
  glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, w, h);
}

// 大气色洗：统一当季色调（落在贴地图元之后、立体实体之前，保证建筑与文字不被洗灰）
function drawAtmosphereWash() {
  const L = window.SimLighting;
  if (!L || !L.enabled()) return;
  const c = L.cfg();
  const tint = L.tint();
  const lightTheme = !!(c.respectLightTheme && document.body && document.body.classList.contains('theme-light'));
  const alpha = c.skyWash * (lightTheme ? 0.55 : 1);
  const r = Math.round(Math.min(255, 140 * tint[0]));
  const g = Math.round(Math.min(255, 150 * tint[1]));
  const b = Math.round(Math.min(255, 172 * tint[2]));
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);
}

function drawTerrain() {
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

  // 1. 微缩沙盘地景投影与四周厚度剖面 (Diorama Skirt)
  const minZ = sim.terrain.minZ != null ? sim.terrain.minZ : 0;
  const skirtElev = minZ - 16;
  const dropOffset = 8 * scale;
  const elevDropFactor = sinX * scale;

  // 1.1 沙盘基底下方的柔和地底投影
  const idxNW = 0;
  const idxNE = gSize - 1;
  const idxSE = totalVertices - 1;
  const idxSW = (gSize - 1) * gSize;
  const bNW_Y = terrainProjY[idxNW] + (sim.terrain.cells[idxNW].elev - skirtElev) * elevDropFactor + dropOffset;
  const bNE_Y = terrainProjY[idxNE] + (sim.terrain.cells[idxNE].elev - skirtElev) * elevDropFactor + dropOffset;
  const bSE_Y = terrainProjY[idxSE] + (sim.terrain.cells[idxSE].elev - skirtElev) * elevDropFactor + dropOffset;
  const bSW_Y = terrainProjY[idxSW] + (sim.terrain.cells[idxSW].elev - skirtElev) * elevDropFactor + dropOffset;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
  ctx.beginPath();
  ctx.moveTo(terrainProjX[idxNW], bNW_Y);
  ctx.lineTo(terrainProjX[idxNE], bNE_Y);
  ctx.lineTo(terrainProjX[idxSE], bSE_Y);
  ctx.lineTo(terrainProjX[idxSW], bSW_Y);
  ctx.closePath();
  ctx.fill();

  // 1.2 四周边沿垂直剖面侧壁：外法线参与季节光照，明暗随光向旋转
  //     基准色取 v1.47.11 北侧壁色，相对旧固定光归一化 ⇒ 关闭动态光照时观感与原版一致
  const L = window.SimLighting;
  const wallBase = '#5A5043';
  const wallColor = (nx, ny, nz) => (L && L.enabled()) ? L.shadeFace(wallBase, nx, ny, nz) : wallBase;

  // 北侧壁 (世界 -y，受光面)
  ctx.fillStyle = wallColor(0, -1, 0);
  ctx.beginPath();
  ctx.moveTo(terrainProjX[0], terrainProjY[0]);
  for (let gx = 1; gx < gSize; gx++) ctx.lineTo(terrainProjX[gx], terrainProjY[gx]);
  for (let gx = gSize - 1; gx >= 0; gx--) {
    ctx.lineTo(terrainProjX[gx], terrainProjY[gx] + (sim.terrain.cells[gx].elev - skirtElev) * elevDropFactor);
  }
  ctx.closePath();
  ctx.fill();

  // 西侧壁 (世界 -x)
  ctx.fillStyle = wallColor(-1, 0, 0);
  ctx.beginPath();
  ctx.moveTo(terrainProjX[0], terrainProjY[0]);
  for (let gy = 1; gy < gSize; gy++) {
    const idx = gy * gSize;
    ctx.lineTo(terrainProjX[idx], terrainProjY[idx]);
  }
  for (let gy = gSize - 1; gy >= 0; gy--) {
    const idx = gy * gSize;
    ctx.lineTo(terrainProjX[idx], terrainProjY[idx] + (sim.terrain.cells[idx].elev - skirtElev) * elevDropFactor);
  }
  ctx.closePath();
  ctx.fill();

  // 南侧壁 (世界 +y，背阴)
  ctx.fillStyle = wallColor(0, 1, 0);
  ctx.beginPath();
  const rowOffsetS = (gSize - 1) * gSize;
  ctx.moveTo(terrainProjX[rowOffsetS], terrainProjY[rowOffsetS]);
  for (let gx = 1; gx < gSize; gx++) ctx.lineTo(terrainProjX[rowOffsetS + gx], terrainProjY[rowOffsetS + gx]);
  for (let gx = gSize - 1; gx >= 0; gx--) {
    const idx = rowOffsetS + gx;
    ctx.lineTo(terrainProjX[idx], terrainProjY[idx] + (sim.terrain.cells[idx].elev - skirtElev) * elevDropFactor);
  }
  ctx.closePath();
  ctx.fill();

  // 东侧壁 (世界 +x)
  ctx.fillStyle = wallColor(1, 0, 0);
  ctx.beginPath();
  ctx.moveTo(terrainProjX[gSize - 1], terrainProjY[gSize - 1]);
  for (let gy = 1; gy < gSize; gy++) {
    const idx = gy * gSize + (gSize - 1);
    ctx.lineTo(terrainProjX[idx], terrainProjY[idx]);
  }
  for (let gy = gSize - 1; gy >= 0; gy--) {
    const idx = gy * gSize + (gSize - 1);
    ctx.lineTo(terrainProjX[idx], terrainProjY[idx] + (sim.terrain.cells[idx].elev - skirtElev) * elevDropFactor);
  }
  ctx.closePath();
  ctx.fill();

  // 2. 视口裁剪绘制地形四边形
  for (let gy = 0; gy < gSize - 1; gy++) {
    const rowOffset0 = gy * gSize;
    const rowOffset1 = (gy + 1) * gSize;
    for (let gx = 0; gx < gSize - 1; gx++) {
      const i00 = rowOffset0 + gx;
      const i10 = rowOffset0 + (gx + 1);
      const i11 = rowOffset1 + (gx + 1);
      const i01 = rowOffset1 + gx;

      const p00x = terrainProjX[i00], p00y = terrainProjY[i00];
      const p10x = terrainProjX[i10], p10y = terrainProjY[i10];
      const p11x = terrainProjX[i11], p11y = terrainProjY[i11];
      const p01x = terrainProjX[i01], p01y = terrainProjY[i01];

      // 视口边界快速剔除
      const minX = Math.min(p00x, p10x, p11x, p01x);
      const maxX = Math.max(p00x, p10x, p11x, p01x);
      const minY = Math.min(p00y, p10y, p11y, p01y);
      const maxY = Math.max(p00y, p10y, p11y, p01y);

      if (maxX < -20 || minX > w + 20 || maxY < -20 || minY > h + 20) {
        continue;
      }

      const c00 = sim.terrain.cells[i00];
      ctx.fillStyle = c00.color || getElevationColor(c00, sim.terrain.minZ, sim.terrain.maxZ);
      ctx.beginPath();
      ctx.moveTo(p00x, p00y);
      ctx.lineTo(p10x, p10y);
      ctx.lineTo(p11x, p11y);
      ctx.lineTo(p01x, p01y);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawTerrainFeatures();

  // 3. 批处理绘制地形网格线 (仅在 sim.showGrid 为 true 时绘制，默认隐藏以呈现自然地貌，按 'G' 键切换)
  if (sim.showGrid) {
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
}
}

function drawTerrainFeatures() {
  const features = (sim.terrain && sim.terrain.features) || [];
  if (!features.length) return;
  for (const feature of features) {
    if (!feature.vertices || !feature.vertices.length) continue;
    const points = feature.vertices.map(project3D);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (feature.kind === 'River') {
      // 1. 底层深潭幽蓝 (基底深度阴影)
      ctx.strokeStyle = 'rgba(32, 86, 122, 0.45)';
      ctx.lineWidth = Math.max(12, feature.width * camera.zoom * 0.36);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();

      // 2. 主流水体：清透碧蓝山泉流
      ctx.strokeStyle = 'rgba(56, 158, 202, 0.82)';
      ctx.lineWidth = Math.max(8, feature.width * camera.zoom * 0.28);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();

      // 3. 水面阳光折射波光线 (中心浅蓝白反射细线)
      ctx.strokeStyle = 'rgba(235, 248, 255, 0.65)';
      ctx.lineWidth = Math.max(1.2, feature.width * camera.zoom * 0.06);
      ctx.setLineDash([14 * camera.zoom, 10 * camera.zoom]);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (feature.kind === 'RiverBank') {
      // 湿润河岸：柔和浅金砂漫滩过渡
      ctx.strokeStyle = 'rgba(188, 160, 120, 0.48)';
      ctx.lineWidth = Math.max(3, feature.width * camera.zoom * 0.12);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    } else if (feature.kind === 'ShallowFord') {
      // 浅滩涉渡：卵石踏道质感
      ctx.strokeStyle = 'rgba(215, 196, 142, 0.90)';
      ctx.lineWidth = Math.max(5, feature.width * camera.zoom * 0.20);
      ctx.setLineDash([6 * camera.zoom, 4 * camera.zoom]);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
      // 浅水反光微斑
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = Math.max(1.5, feature.width * camera.zoom * 0.08);
      ctx.setLineDash([2 * camera.zoom, 8 * camera.zoom]);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // 其余特征（含 SpringValley 泉谷浅沟）：柔和土褐细带
      // v1.47.7：Ridge/Saddle/Terrace 台地轮廓绘制已随特征整体删除
      ctx.strokeStyle = 'rgba(174, 137, 78, 0.24)';
      ctx.lineWidth = Math.max(2, feature.width * camera.zoom * 0.06);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
