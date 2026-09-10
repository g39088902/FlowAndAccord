// === 地形与天空氛围绘制（v1.48.0 从 render_world.js 拆出） ===
// 地形网格 / 水系地貌特征 / 天空背景与大气色洗
// 依赖全局: ctx, camera, sim, project3D, getElevationColor, w, h, terrainProjX, terrainProjY, SimLighting
//
// ★ 动态季节光照（docs/27-plan-seasonal-lighting.md）：
//   地形颜色本身由 SimLighting.relightTerrain() 每光档写回 cell.color，本文件只负责绘制；
//   天空背景与大气色洗是两个固定的氛围插入点，不得在此新增整层立体实体绘制。

// ★ v1.48.1 地形格间抗锯齿缝隙补偿量（屏幕像素）：相邻格共享边各只覆盖约半像素，
//   不补偿会露出背景色 1px 网格线。0.75px 经像素采样验证可把缝隙残差压到 1/255 以内。
const TERRAIN_SEAM_PX = 0.75;

// ★ v1.48.2 边界墙（沙盘侧壁）深度排序：
//   四面墙都是沿世界 z 轴垂直下垂的幕布，下垂只改变 z（屏幕 y 与相机深度），不改变旋转后的 ry。
//   同一屏幕点上的两面墙，深度差 = (ry_a − ry_b) / sinX ⇒「谁在前面」只由 ry = wx·sinZ + wy·cosZ
//   决定，与墙高无关。故按各墙边界中点的 ry 升序（远 → 近）落笔，取代旧的固定 N/W/S/E 顺序。
const BOUNDARY_WALL_BASE = '#5A5043'; // 基准色 = v1.47.11 北侧壁色（关闭动态光照时的观感基准）
const BOUNDARY_WALLS = [
  { nx: 0, ny: -1, nz: 0, first: 0, step: 1, ry: 0 }, // 北（世界 -y，受光面）
  { nx: -1, ny: 0, nz: 0, first: 0, step: 1, ry: 0 }, // 西（世界 -x）
  { nx: 0, ny: 1, nz: 0, first: 0, step: 1, ry: 0 },  // 南（世界 +y，背阴）
  { nx: 1, ny: 0, nz: 0, first: 0, step: 1, ry: 0 },  // 东（世界 +x）
];
const _wallDrawOrder = [0, 1, 2, 3]; // 每帧按 ry 重排（持久数组，零分配）

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

// 单面边界墙：沿边界顶点序列走上沿，再折返走下沿（按各格高程下垂）后闭合填充
// first/step 定位该墙在 terrainProjX/Y 中的顶点序列；外法线参与季节光照
function drawBoundaryWall(first, step, count, nx, ny, nz, skirtElev, elevDropFactor) {
  const cells = sim.terrain.cells;
  const L = window.SimLighting;
  ctx.fillStyle = (L && L.enabled()) ? L.shadeFace(BOUNDARY_WALL_BASE, nx, ny, nz) : BOUNDARY_WALL_BASE;
  ctx.beginPath();
  ctx.moveTo(terrainProjX[first], terrainProjY[first]);
  for (let k = 1; k < count; k++) {
    const idx = first + k * step;
    ctx.lineTo(terrainProjX[idx], terrainProjY[idx]);
  }
  for (let k = count - 1; k >= 0; k--) {
    const idx = first + k * step;
    ctx.lineTo(terrainProjX[idx], terrainProjY[idx] + (cells[idx].elev - skirtElev) * elevDropFactor);
  }
  ctx.closePath();
  ctx.fill();
}

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
  //     ★ v1.48.2 按相机距离排序（远 → 近）绘制，取代旧的固定 N/W/S/E 顺序，
  //       使较近的边界墙遮盖较远的边界墙（判据推导见文件头 BOUNDARY_WALLS 注释）。
  const cells = sim.terrain.cells;
  const lastIdx = gSize - 1;
  const rowOffsetS = lastIdx * gSize;
  BOUNDARY_WALLS[0].first = 0;          BOUNDARY_WALLS[0].step = 1;     // 北
  BOUNDARY_WALLS[1].first = 0;          BOUNDARY_WALLS[1].step = gSize; // 西
  BOUNDARY_WALLS[2].first = rowOffsetS; BOUNDARY_WALLS[2].step = 1;     // 南
  BOUNDARY_WALLS[3].first = lastIdx;    BOUNDARY_WALLS[3].step = gSize; // 东
  for (let wi = 0; wi < 4; wi++) {
    const wd = BOUNDARY_WALLS[wi];
    const ca = cells[wd.first], cb = cells[wd.first + lastIdx * wd.step];
    wd.ry = (ca.wx + cb.wx) * 0.5 * sinZ + (ca.wy + cb.wy) * 0.5 * cosZ;
  }
  // 稳定排序：ry 相同（墙在屏幕上退化为零面积）时保持 N/W/S/E 原序，渲染确定性不变
  _wallDrawOrder.sort((a, b) => (BOUNDARY_WALLS[a].ry - BOUNDARY_WALLS[b].ry) || (a - b));
  for (let oi = 0; oi < 4; oi++) {
    const wd = BOUNDARY_WALLS[_wallDrawOrder[oi]];
    drawBoundaryWall(wd.first, wd.step, gSize, wd.nx, wd.ny, wd.nz, skirtElev, elevDropFactor);
  }

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

      // ★ v1.48.1 无缝拼接：相邻格共享边在 Canvas2D 抗锯齿下各自只覆盖约一半像素，
      //   两者叠加后仍留约 25% 的透光率，深色天空背景便从缝隙里透出 1px 网格线
      //   （表现为「地形漏出后面的边界线条」）。把四条边各自沿外法线平移 TERRAIN_SEAM_PX，
      //   使相邻格互相重叠盖住缝隙；沿边方向的分量只让边滑动，不改变覆盖宽度。
      const mx = (p00x + p10x + p11x + p01x) * 0.25;
      const my = (p00y + p10y + p11y + p01y) * 0.25;
      const e0x = p10x - p00x, e0y = p10y - p00y;
      const e1x = p11x - p10x, e1y = p11y - p10y;
      const e2x = p01x - p11x, e2y = p01y - p11y;
      const e3x = p00x - p01x, e3y = p00y - p01y;
      const l0 = Math.sqrt(e0x * e0x + e0y * e0y) || 1;
      const l1 = Math.sqrt(e1x * e1x + e1y * e1y) || 1;
      const l2 = Math.sqrt(e2x * e2x + e2y * e2y) || 1;
      const l3 = Math.sqrt(e3x * e3x + e3y * e3y) || 1;
      // 固定旋向法线 (ey, -ex)/l，再用质心方向确定指向"外"侧
      const sgn = (e0y * ((p00x + p10x) * 0.5 - mx) - e0x * ((p00y + p10y) * 0.5 - my)) > 0 ? 1 : -1;
      const n0x = sgn * e0y / l0, n0y = -sgn * e0x / l0;
      const n1x = sgn * e1y / l1, n1y = -sgn * e1x / l1;
      const n2x = sgn * e2y / l2, n2y = -sgn * e2x / l2;
      const n3x = sgn * e3y / l3, n3y = -sgn * e3x / l3;
      ctx.beginPath();
      ctx.moveTo(p00x + (n3x + n0x) * TERRAIN_SEAM_PX, p00y + (n3y + n0y) * TERRAIN_SEAM_PX);
      ctx.lineTo(p10x + (n0x + n1x) * TERRAIN_SEAM_PX, p10y + (n0y + n1y) * TERRAIN_SEAM_PX);
      ctx.lineTo(p11x + (n1x + n2x) * TERRAIN_SEAM_PX, p11y + (n1y + n2y) * TERRAIN_SEAM_PX);
      ctx.lineTo(p01x + (n2x + n3x) * TERRAIN_SEAM_PX, p01y + (n2y + n3y) * TERRAIN_SEAM_PX);
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

  const cx = w / 2 + camera.panX;
  const cy = h / 2 + camera.panY;
  const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
  const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
  const scale = camera.zoom;

  // ── Pass 1: 河岸平滑湿砂漫滩带（RiverBank Sand Ribbon） ──
  // 沿左右两岸平滑曲线先绘制加宽温润细砂带，遮蔽底层 13m 栅格方块阶梯
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let fi = 0; fi < features.length; fi++) {
    const feature = features[fi];
    if (feature.kind !== 'RiverBank' || !feature.vertices || !feature.vertices.length) continue;
    const vLen = feature.vertices.length;
    _projectFeatureVertices(feature.vertices, vLen, cx, cy, cosZ, sinZ, cosX, sinX, scale);

    // 外层漫滩羽化过渡
    ctx.strokeStyle = 'rgba(168, 148, 116, 0.40)';
    ctx.lineWidth = Math.max(14, feature.width * scale * 2.1);
    ctx.beginPath();
    ctx.moveTo(_featProjX[0], _featProjY[0]);
    for (let i = 1; i < vLen; i++) ctx.lineTo(_featProjX[i], _featProjY[i]);
    ctx.stroke();

    // 内层温润湿润金砂
    ctx.strokeStyle = 'rgba(186, 166, 132, 0.78)';
    ctx.lineWidth = Math.max(10, feature.width * scale * 1.4);
    ctx.beginPath();
    ctx.moveTo(_featProjX[0], _featProjY[0]);
    for (let i = 1; i < vLen; i++) ctx.lineTo(_featProjX[i], _featProjY[i]);
    ctx.stroke();
  }
  ctx.restore();

  // ── Pass 2: 连续矢量水面闭合多边形（Vector Water Surface） ──
  // 以 194 顶点闭合矢量填充整片水面，完全盖过水底网格方块
  for (let fi = 0; fi < features.length; fi++) {
    const feature = features[fi];
    if (feature.kind !== 'River' || !feature.vertices || !feature.vertices.length) continue;
    const vLen = feature.vertices.length;
    _projectFeatureVertices(feature.vertices, vLen, cx, cy, cosZ, sinZ, cosX, sinX, scale);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(_featProjX[0], _featProjY[0]);
    for (let i = 1; i < vLen; i++) ctx.lineTo(_featProjX[i], _featProjY[i]);
    ctx.closePath();

    // 底层深水基底（深潭幽蓝，奠定水深纵深感）
    ctx.fillStyle = 'rgba(28, 82, 116, 0.55)';
    ctx.fill();

    // 主流水体：清透碧蓝山泉流
    ctx.fillStyle = 'rgba(54, 158, 202, 0.85)';
    ctx.fill();
    ctx.restore();

    // 水面中心潺潺流动微波细线
    if (vLen >= 194) {
      const halfCount = Math.floor(vLen / 2);
      ctx.save();
      ctx.strokeStyle = 'rgba(240, 252, 255, 0.40)';
      ctx.lineWidth = Math.max(1.0, 1.8 * scale);
      ctx.setLineDash([16 * scale, 12 * scale]);
      ctx.lineDashOffset = -((performance.now() * 0.02) % (28 * scale));
      ctx.beginPath();
      for (let i = 0; i < halfCount; i++) {
        const j = vLen - 1 - i;
        const mx = (_featProjX[i] + _featProjX[j]) * 0.5;
        const my = (_featProjY[i] + _featProjY[j]) * 0.5;
        if (i === 0) ctx.moveTo(mx, my);
        else ctx.lineTo(mx, my);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Pass 3: 水陆交界表面张力微沫高光（Shoreline Foam Highlight） ──
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let fi = 0; fi < features.length; fi++) {
    const feature = features[fi];
    if (feature.kind !== 'RiverBank' || !feature.vertices || !feature.vertices.length) continue;
    const vLen = feature.vertices.length;
    _projectFeatureVertices(feature.vertices, vLen, cx, cy, cosZ, sinZ, cosX, sinX, scale);

    ctx.strokeStyle = 'rgba(238, 248, 255, 0.62)';
    ctx.lineWidth = Math.max(1.2, 1.8 * scale);
    ctx.beginPath();
    ctx.moveTo(_featProjX[0], _featProjY[0]);
    for (let i = 1; i < vLen; i++) ctx.lineTo(_featProjX[i], _featProjY[i]);
    ctx.stroke();
  }
  ctx.restore();

  // ── Pass 4: 浅滩涉渡（ShallowFord）与其余地貌特征 ──
  for (let fi = 0; fi < features.length; fi++) {
    const feature = features[fi];
    if (!feature.vertices || !feature.vertices.length) continue;
    if (feature.kind === 'River' || feature.kind === 'RiverBank') continue;

    const vLen = feature.vertices.length;
    _projectFeatureVertices(feature.vertices, vLen, cx, cy, cosZ, sinZ, cosX, sinX, scale);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (feature.kind === 'ShallowFord') {
      // 浅滩涉渡：卵石踏道基底
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
}
