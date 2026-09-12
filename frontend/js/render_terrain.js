// === 地形与天空氛围绘制（v1.48.0 从 render_world.js 拆出；★ v1.50.11 深度队列化改造） ===
// 地形壳层（投影 + 沙盘基底/侧壁）/ 单格填充 / 单水系特征 / 天空背景 / 地形网格线
// 依赖全局: ctx, camera, sim, project3D, getElevationColor, w, h, terrainProjX, terrainProjY, SimLighting
//
// ★ 动态季节光照（docs/current/tech/51-seasonal-lighting.md）：
//   地形颜色本身由 SimLighting.relightTerrain() 每光档写回 cell.color（大气色洗亦烘焙于此），本文件只负责绘制。
//
// ★ v1.50.11 图层契约变更：drawTerrainCell / drawFeatureItem 是**单实体绘制入口**，
//   由 render_world.js::drawWorldEntities() 的统一相机深度队列调度（远 → 近），
//   使近处山地格与河道能正确遮挡远处图标。**严禁**在 render() 里恢复「整层先画地形」的调用，
//   那会退回「图标透过山体可见」的旧 bug（与 v1.47.8 房屋、v1.50.2 装饰两次历史教训同类）。

// ★ v1.48.1 地形格间抗锯齿缝隙补偿量（屏幕像素）：相邻格共享边各只覆盖约半像素，
//   不补偿会露出背景色 1px 网格线。0.75px 经像素采样验证可把缝隙残差压到 1/255 以内。
const TERRAIN_SEAM_PX = 0.75;

// ★ v1.48.2 边界墙（沙盘侧壁）深度排序 → ★ v1.50.14 并入统一深度队列：
//   v1.48.2 曾按整墙中点 ry 在壳层排序绘制；但 v1.50.11 地形格并入深度队列后，
//   侧壁仍整墙先行栅格化 → 侧壁永远画在所有队列元素之前，盖不住任何贴边实体
//   （用户可见症状：「贴边 POI/房屋的底座与图标盖在南侧壁之上，未被遮挡」）。
//   v1.50.14 起侧壁按**边界格分段**入队（drawBoundaryWallSeg），每段深度 = 该段
//   上沿两端顶点深度的较大值（较近端）——侧壁是地图边界上最靠近相机的几何，
//   贴边实体的底座/圆环伸过边界线的部分会被正确盖住；远离边界的实体与侧壁
//   屏幕区域不相交，不受影响。
const BOUNDARY_WALL_BASE = '#5A5043'; // 基准色 = v1.47.11 北侧壁色（关闭动态光照时的观感基准）
const BOUNDARY_WALLS = [
  { nx: 0, ny: -1, nz: 0, first: 0, step: 1, ry: 0 }, // 北（世界 -y，受光面）
  { nx: -1, ny: 0, nz: 0, first: 0, step: 1, ry: 0 }, // 西（世界 -x）
  { nx: 0, ny: 1, nz: 0, first: 0, step: 1, ry: 0 },  // 南（世界 +y，背阴）
  { nx: 1, ny: 0, nz: 0, first: 0, step: 1, ry: 0 },  // 东（世界 +x）
];

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

// ★ v1.50.14 单段边界墙（由 render_world.js 统一深度队列调度）：
// 画出第 k 段——上沿顶点 k → k+1，折返下垂底沿后闭合填充。下垂参数由
// drawTerrainShell 每帧暂存（模块级），外法线参与季节光照。
let _wallSkirtElev = 0;
let _wallElevDrop = 0;
function drawBoundaryWallSeg(wd, k) {
  const cells = sim.terrain.cells;
  const i0 = wd.first + k * wd.step;
  const i1 = i0 + wd.step;
  const drop0 = (cells[i0].elev - _wallSkirtElev) * _wallElevDrop;
  const drop1 = (cells[i1].elev - _wallSkirtElev) * _wallElevDrop;
  const L = window.SimLighting;
  ctx.fillStyle = (L && L.enabled()) ? L.shadeFace(BOUNDARY_WALL_BASE, wd.nx, wd.ny, wd.nz) : BOUNDARY_WALL_BASE;
  ctx.beginPath();
  ctx.moveTo(terrainProjX[i0], terrainProjY[i0]);
  ctx.lineTo(terrainProjX[i1], terrainProjY[i1]);
  ctx.lineTo(terrainProjX[i1], terrainProjY[i1] + drop1);
  ctx.lineTo(terrainProjX[i0], terrainProjY[i0] + drop0);
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

// ★ v1.50.11 大气色洗已烘焙进 lighting.js::relightTerrain() 的地形色：
//   色洗原本是「贴地图元之后、立体实体之前」的整屏 fillRect，但地形格并入统一深度队列后
//   实体与地形格交错落笔，整屏矩形会把实体一起洗灰（渲染顺序见 render_world.js::drawWorldEntities）。
//   烘焙进 cell.color 后观感不变，且省去每帧一次全屏合成。

function drawTerrainShell() {
// ★ v1.50.11 拆分：本函数只保留「全网格顶点投影 + 沙盘基底/侧壁」壳层；
//   地形格四边形填充迁入 render_world.js 统一深度队列（drawTerrainCell），
//   使近处山地格能正确遮挡站在山后的远处图标/道路/水系。
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

  // ★ v1.50.14 四周边沿垂直剖面侧壁已并入 render_world.js 统一深度队列
  //    （按边界格分段 drawBoundaryWallSeg，见该文件 DEPTH_WALL 收集段）。
  //    此处只暂存下垂参数供单段绘制消费。
  _wallSkirtElev = skirtElev;
  _wallElevDrop = elevDropFactor;
  BOUNDARY_WALLS[0].first = 0;          BOUNDARY_WALLS[0].step = 1;     // 北
  BOUNDARY_WALLS[1].first = 0;          BOUNDARY_WALLS[1].step = gSize; // 西
  BOUNDARY_WALLS[2].first = (gSize - 1) * gSize; BOUNDARY_WALLS[2].step = 1;     // 南
  BOUNDARY_WALLS[3].first = gSize - 1;  BOUNDARY_WALLS[3].step = gSize; // 东
}
}

// ★ v1.50.11 单个地形格四边形填充（由 render_world.js 统一深度队列调度）。
// 原 drawTerrain 的「视口裁剪 + 逐格填充」整层循环迁出为单格入口：
// 地形格与 POI 标记/房屋/族人/装饰同队列按相机深度远 → 近落笔，
// 近处山地格后落笔即可遮挡站在山后的远处图标（旧整层先画导致图标透山可见）。
// 视口粗剔除在队列收集阶段完成（同一 20px 余量）。
function drawTerrainCell(i00, i10, i11, i01) {
  const p00x = terrainProjX[i00], p00y = terrainProjY[i00];
  const p10x = terrainProjX[i10], p10y = terrainProjY[i10];
  const p11x = terrainProjX[i11], p11y = terrainProjY[i11];
  const p01x = terrainProjX[i01], p01y = terrainProjY[i01];

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

// ★ v1.50.11 地形网格线（调试叠加，'G' 键切换）：从 drawTerrain 拆出独立整层。
//   0.04 极低透明度的调试线条，置于统一深度队列之后绘制，叠加在实体上不可感知。
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

// ★ v1.50.11 单个水系地貌特征绘制（由 render_world.js 统一深度队列调度）。
// ★ v1.50.20 河流分段绘制：River / RiverBank 的 idx 为段号（整条以「全顶点最大深度」入队
// 会盖住所有更远的实体，见 render_world.js 收集段注释）；ShallowFord / 其余短特征仍整条绘制。
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

  // ★ v1.48.0 D-A：Tree 季节色调
  let seasonTint = accent.tint || 0;
  if (window.SimTreeTint && sim.treeTintEnabled !== false) {
    seasonTint = window.SimTreeTint.tint(accent, sim);
  }

  const scaled = accent.scale * scale;
  if (accent.kind === 'Tree') {
    drawAccentTree(accent, sx, sy, scaled, seasonTint);
  } else if (accent.kind === 'Boulder') {
    drawAccentBoulder(sx, sy, scaled, accent.rotation || 0, cosZ, sinZ);
  } else {
    drawAccentBush(accent, sx, sy, scaled);
  }
}

// ★ v1.49.3：Accent 个体确定性哈希（用于叶片纹理散点等纯视觉细节，不参与模拟）
function _accentHash(id, i) {
  let h = (((id | 0) * 374761393 + (i | 0) * 668265263) >>> 0);
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Tree：写意微缩乔木 —— 锥形微弯树干 + 四瓣层叠树冠 + 贴地投影（与 POI/房屋同一光照源）
// tint=0 鲜绿(春夏) / 1 黄绿(秋) / 2 红褐(深秋)；scaled = accent.scale(0.7~1.4) × camera.zoom
function drawAccentTree(accent, sx, sy, scaled, tint) {
  // 由 id 派生的确定性个体差异：干高 / 冠形 / 色相微调，避免成片树完全同构
  const vSeed = (((accent.id || 0) * 2654435761) >>> 0) % 997 / 997;
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
  // 给树冠注入叶面质感（替代原先纯渐变的“塑料感”）
  const DAPPLES = 10;
  for (let i = 0; i < DAPPLES; i++) {
    const t1 = _accentHash(accent.id || 0, i + 1);
    const t2 = _accentHash(accent.id || 0, i + 31);
    const t3 = _accentHash(accent.id || 0, i + 67);
    // 分布域：主冠椭圆内（中上偏密），乘 squash 保持冠形透视
    const ang = t1 * Math.PI * 2;
    const rad = (0.16 + t2 * 0.60) * crownR;
    const px = ccX + Math.cos(ang) * rad * 0.88 + (i - DAPPLES / 2) * 0.4;
    const py = ccY + Math.sin(ang) * rad * squash - crownR * 0.04;
    const dr = (0.09 + t3 * 0.12) * crownR;
    ctx.fillStyle = (i & 1) === 0 ? dapDark : dapLite;
    ctx.beginPath();
    ctx.ellipse(px, py, dr, dr * 0.72, ang * 0.5, 0, Math.PI * 2);
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
function drawAccentBush(accent, sx, sy, scaled) {
  const vSeed = (((accent.id || 0) * 2654435761) >>> 0) % 997 / 997;
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
  const B_DAP = 7;
  for (let i = 0; i < B_DAP; i++) {
    const t1 = _accentHash(accent.id || 0, i + 101);
    const t2 = _accentHash(accent.id || 0, i + 131);
    const t3 = _accentHash(accent.id || 0, i + 167);
    const ang = t1 * Math.PI * 2;
    const rad = (0.15 + t2 * 0.55) * r;
    const px = sx + Math.cos(ang) * rad * 0.9;
    const py = cy + Math.sin(ang) * rad * squash - r * 0.02;
    const dr = (0.10 + t3 * 0.12) * r;
    ctx.fillStyle = (i & 1) === 0 ? 'rgba(38, 66, 30, 0.26)' : 'rgba(150, 192, 118, 0.30)';
    ctx.beginPath();
    ctx.ellipse(px, py, dr, dr * 0.70, ang * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pass C：顶瓣受光点
  ctx.fillStyle = 'rgba(255, 252, 218, 0.20)';
  ctx.beginPath();
  ctx.ellipse(sx - r * 0.18, cy - r * 0.52, r * 0.26, r * 0.18, -0.4, 0, Math.PI * 2);
  ctx.fill();
}
