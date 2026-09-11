// === 世界元素绘制 (从 render.js 拆分) ===
// ★ v1.50.11 世界统一深度队列：地形格 + 水系 + 游鱼/波光 + 道路分段 + 营地连线 +
//   POI 底座 + POI 标记 + 私产宅舍 + 地表装饰 + 族人，全部按相机深度远 → 近落笔
// 地形壳层（投影/沙盘侧壁）与单格/单特征绘制入口在 render_terrain.js
// 依赖全局: ctx, camera, sim, project3D, getElevationColor, mousePos, isDragging, hoveredLane, SimLighting, terrainProjX, terrainProjY

// ★ v1.50.15 渲染表现层参数（视觉抬升 / 足迹深度半径），来源 config.render.js
//   （前端独立配置，不进 SIM_CONFIG——config.js 与 Rust SimConfig 严格互检）。
//   本文件在 index.html 中晚于 config.render.js 加载，顶层读取安全。
const RC = window.RENDER_CONFIG || {};

// ★ 动态季节光照：贴地阴影偏移 = 世界空间光向 → 屏幕投影（随相机旋转）
//   关闭动态光照时回退 v1.47.11 的固定屏幕偏移，保证 A/B 对照
function lightShadowOffset(legacyX, legacyY, height) {
  const L = window.SimLighting;
  if (L && L.enabled()) {
    const o = L.shadowOffset(height);
    return { x: o.dx, y: o.dy, alphaScale: Math.max(0.75, Math.min(1.5, L.shadowAlpha() / 0.24)) };
  }
  return { x: legacyX * camera.zoom, y: legacyY * camera.zoom, alphaScale: 1 };
}

// ★ 动态季节光照：立体面受光（法线 → 色值），关闭时原样返回基色
function shadeHex(baseHex, nx, ny, nz) {
  const L = window.SimLighting;
  return (L && L.enabled()) ? L.shadeFace(baseHex, nx, ny, nz) : baseHex;
}

// ★ v1.47.9 POI 拆为「贴地底座（地面层）」与「标记（立体实体层）」两段：
// 底座/营地暖光是贴地绘制物，深度略远于自身标记（−0.01 epsilon），保证垫在自己图标之下。
// ★ v1.50.11 起底座不再整层先画，而是逐 POI 入统一深度队列（drawWorldEntities 收集阶段）。
function drawPoiGroundBase(poi) {
  const z = camera.zoom;
  const p2D = project3D(poi.pos);
  const x = p2D.x, y = p2D.y;

  if (poi.type === 'Camp') {
    const campR = (16 + (poi.level || 0) * 3) * z;
    // 1. 营地地面阴影（方向与长度随季节光位）
    const campShadow = lightShadowOffset(1.5, 3.0, (window.SimLighting && window.SimLighting.cfg().campShadowHeight) || 1.2);
    ctx.fillStyle = `rgba(20, 15, 10, ${(0.22 * campShadow.alphaScale).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x + campShadow.x, y + campShadow.y, campR * 1.1, campR * 0.55, -0.1, 0, Math.PI * 2);
    ctx.fill();

    // 2. 营地篝火与暖石基地 (温润暖赭底座，告别刺眼红黄色斑)
    const grad = ctx.createRadialGradient(x, y, 1, x, y, campR);
    grad.addColorStop(0, 'rgba(217, 119, 6, 0.75)');
    grad.addColorStop(0.65, 'rgba(180, 83, 9, 0.35)');
    grad.addColorStop(1, 'rgba(180, 83, 9, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, campR, 0, Math.PI * 2); ctx.fill();
    return;
  }

  // 自然资源与市场 POI (统一温润水墨/沙盘手办基座，彻底消除大光圈污染)
  const baseR = 12 * z;
  const poiShadow = lightShadowOffset(1.2, 2.5, (window.SimLighting && window.SimLighting.cfg().poiShadowHeight) || 0.9);
  ctx.fillStyle = `rgba(20, 15, 10, ${(0.20 * poiShadow.alphaScale).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(x + poiShadow.x, y + poiShadow.y, baseR * 1.1, baseR * 0.55, -0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = poiTintColor(poi);
  ctx.beginPath(); ctx.arc(x, y, baseR, 0, Math.PI * 2); ctx.fill();
}

// POI 底色（地面底座与图标共用，避免两段绘制各写一套色值）
function poiTintColor(poi) {
  if (poi.type === 'Water') return 'rgba(2, 132, 199, 0.28)';
  if (poi.type === 'Berry') return 'rgba(21, 128, 61, 0.28)';
  if (poi.type === 'Wood') return 'rgba(180, 83, 9, 0.28)';
  if (poi.type === 'Stone') return 'rgba(100, 116, 139, 0.28)';
  if (poi.type === 'Gold') return 'rgba(217, 119, 6, 0.28)';
  if (poi.type === 'Market') return 'rgba(217, 119, 6, 0.32)';
  return 'rgba(2, 132, 199, 0.25)';
}

// POI 标记（图标 / 门牌 / 储量环 / 选中环）：参与统一深度排序，被近处实体正常遮挡。
function drawPoiMarker(poi) {
  const z = camera.zoom;
  const showDetailRings = z >= 0.70;
  const p2D = projectLifted(poi.pos); // ★ v1.50.12 精灵锚点略抬于地表（贴地底座仍用 project3D）
  const isSelected = sim.selectionType === 'poi' && sim.selectedPoiId === poi.id;
  const x = p2D.x, y = p2D.y;

  if (poi.type === 'Camp') {
    const campIcon = (poi.level || 0) >= 4 ? '🏛️' : ((poi.level || 0) >= 2 ? '🏘️' : '🏕️');
    ctx.font = `${Math.floor((13 + (poi.level || 0) * 2) * z)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#d97706';
    ctx.fillText(campIcon, x, y + 4 * z);

    if (z > 0.50) {
      ctx.font = `bold ${Math.max(9, Math.floor(10 * z))}px sans-serif`;
      ctx.fillStyle = '#fef08a';
      ctx.fillText(poi.campTitle || poi.name, x, y - (11 + (poi.level || 0) * 2) * z);
      if (poi.boundHouses > 0) {
        ctx.font = `${Math.max(8, Math.floor(9 * z))}px sans-serif`;
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(`${poi.boundHouses}舍`, x, y + (14 + (poi.level || 0) * 2) * z);
      }
    }
  } else {
    let poiIcon = '💧', borderCol = '#0284c7';
    const ratio = isFinite(poi.maxStock) && poi.maxStock > 0 ? (poi.currentStock / poi.maxStock) : 1.0;

    if (poi.type === 'Water') { poiIcon = '💧'; borderCol = '#0284c7'; }
    else if (poi.type === 'Berry') { poiIcon = '🍒'; borderCol = '#15803d'; }
    else if (poi.type === 'Wood') { poiIcon = '🌲'; borderCol = '#b45309'; }
    else if (poi.type === 'Stone') { poiIcon = '🪨'; borderCol = '#64748b'; }
    else if (poi.type === 'Gold') { poiIcon = '🪙'; borderCol = '#d97706'; }
    else if (poi.type === 'Market') { poiIcon = '🏪'; borderCol = '#d97706'; }

    // 图标
    ctx.font = `${Math.floor(12 * z)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = poiTintColor(poi);
    ctx.fillText(poiIcon, x, y + 4 * z);

    // 仅在局部放大或选中时才展示细线库存环，全景视口保持整洁
    if ((showDetailRings || isSelected) && poi.type !== 'Market') {
      const baseR = 12 * z;
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.arc(x, y, baseR + 2 * z, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
      ctx.stroke();
    }
  }

  if (isSelected) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 3.5 * z;
    ctx.beginPath(); ctx.arc(x, y, 18 * z, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6 * z;
    ctx.beginPath(); ctx.arc(x, y, 18 * z, 0, Math.PI * 2); ctx.stroke();
  }
}

// ==========================================
// ★ v1.50.11 世界统一深度绘制（地形格 + 水系 + 道路 + 底座 + 立体实体）
// ==========================================
// Canvas 2D 无深度缓冲。v1.47.9 只把立体实体收进深度队列，地形格仍整层先画——
// 结果实体之间的遮挡正确了，但**近处山地无法遮挡远处图标**（图标永远后画、透山可见）。
// 现将地形格 / 水系特征 / 游鱼 / 波光 / 道路分段 / 营地连线 / POI 底座 /
// POI 标记 / 房屋 / 地表装饰 / 族人全部收进**同一个相机深度队列**，
// 按 project3D().depth = ry·sinX + z·cosX 升序（远 → 近）落笔：
// 近处山地格、近处河道、近处乔木都会正确遮挡更远的图标。
// 同深度保持收集原序（Array.sort 稳定），渲染确定性不变。
// 大气色洗不再整屏 fillRect（会把交错落笔的实体一起洗灰），已烘焙进 relightTerrain 的地形色。
const DEPTH_CELL = 0;      // 地形格（a/b/c/d = i00/i10/i11/i01 顶点索引）
const DEPTH_FEATURE = 1;   // 水系特征（a = feature，River 水面 / ShallowFord / 泉谷）
const DEPTH_FISH = 2;      // 游鱼（a = fish，水中层，深度低于水面填充）
const DEPTH_GLINT = 3;     // 太阳波光（a = 中心线采样点，深度 = 河道最近岸 + ε，保持盖在水面之上）
const DEPTH_LANE = 4;      // 道路分段（a = lane，b = 段序号，s1/s2 = 屏幕端点，dash = 弧长相位）
const DEPTH_LINK = 5;      // 选中营地辖区连线（a = house）
const DEPTH_POI_BASE = 6;  // POI 贴地底座（a = poi）
const DEPTH_POI = 7;       // POI 标记（a = poi）
const DEPTH_HOUSE = 8;     // 房屋（a = house）
const DEPTH_ACCENT = 9;    // 地表装饰（a = accent）
const DEPTH_AGENT = 10;    // 族人（a = agent）
const DEPTH_WALL = 11;     // ★ v1.50.14 边界侧壁分段（a = 墙定义，b = 段序号；深度 = 段上沿较近端顶点）

const _depthPool = [];     // 持久深度项对象池（零每帧 GC）
const _depthList = [];     // 每帧重建的引用列表（仅含本帧使用的项）
let _depthPoolUsed = 0;

function _depthItem(kind, a, b, depth) {
  let it = _depthPool[_depthPoolUsed];
  if (it === undefined) {
    it = { kind: 0, a: null, b: 0, c: 0, d: 0, depth: 0, s1x: 0, s1y: 0, s2x: 0, s2y: 0, dash: 0 };
    _depthPool.push(it);
  }
  _depthPoolUsed++;
  it.kind = kind; it.a = a; it.b = b; it.depth = depth;
  _depthList.push(it);
  return it;
}

// 道路分段持久投影缓冲（消除每帧分配）
let _lanePX = null, _lanePY = null, _laneWX = null, _laneWY = null, _laneWZ = null, _laneCum = null;
function _ensureLaneBuf(n) {
  if (!_lanePX || _lanePX.length < n) {
    _lanePX = new Float32Array(n + 16); _lanePY = new Float32Array(n + 16);
    _laneWX = new Float64Array(n + 16); _laneWY = new Float64Array(n + 16);
    _laneWZ = new Float64Array(n + 16); _laneCum = new Float32Array(n + 16);
  }
}

// ★ v1.50.12 贴面防埋修正（「图标/道路半截被自己的地形格盖住」）：
// 地形格深度取格心（四角均值），实体/道路锚点落在格子远半侧时格心深度 > 锚点深度，
// 脚下的格子反而后画、盖掉下半截。修正：所有非地形元素的排序深度一律
// 抬到「所在格格心深度 + SURFACE_EPS」之上——自己的格子永远先画；
// 深度对更远的格子仍是真值，近山遮挡远图标的正确性不受影响。
const SURFACE_EPS = 0.05;

// ★ v1.50.12 立体精灵视觉抬升（世界单位，config.render.js::mapZLift）：
// POI 图标 / 房屋 / 装饰 / 族人的绘制锚点略高于地表，站在坡面上不再「陷进」地面。
// 仅作用于精灵锚点（道路/底座等贴地元素不抬）。
const MAP_Z_LIFT = RC.mapZLift || 0;

function projectLifted(v3) {
  return project3D({ x: v3.x, y: v3.y, z: (v3.z || 0) + MAP_Z_LIFT });
}

// (px,py) 所在地形格的格心相机深度；地形不可用时返回 null
function _ownCellCenterDepth(px, py, cosZ, sinZ, cosX, sinX) {
  const terrain = sim.terrain;
  if (!terrain || !terrain.cells || terrain.cells.length < terrain.gridSize * terrain.gridSize) return null;
  const gSize = terrain.gridSize;
  const half = terrain.cells[gSize * gSize - 1].wx; // 顶点阵末列 wx = +worldSize/2
  if (!(half > 0)) return null;
  const gx = Math.max(0, Math.min(gSize - 2, Math.floor(((px + half) / (2 * half)) * (gSize - 1))));
  const gy = Math.max(0, Math.min(gSize - 2, Math.floor(((py + half) / (2 * half)) * (gSize - 1))));
  const i00 = gy * gSize + gx;
  const c00 = terrain.cells[i00], c10 = terrain.cells[i00 + 1];
  const c01 = terrain.cells[i00 + gSize], c11 = terrain.cells[i00 + gSize + 1];
  // 深度公式对坐标线性：格心深度 = 四角深度均值 = 均值坐标代入公式
  return ((c00.wx + c10.wx + c11.wx + c01.wx) * 0.25 * sinZ +
    (c00.wy + c10.wy + c11.wy + c01.wy) * 0.25 * cosZ) * sinX +
    (c00.elev + c10.elev + c11.elev + c01.elev) * 0.25 * cosX;
}

// 贴地元素排序深度：真值深度与「所在格格心 + ε」取大（防自己的格子盖住自己）
function _surfaceDepth(px, py, pz, cosZ, sinZ, cosX, sinX) {
  const d = (px * sinZ + py * cosZ) * sinX + (pz || 0) * cosX;
  const cd = _ownCellCenterDepth(px, py, cosZ, sinZ, cosX, sinX);
  return cd == null ? d : (d > cd + SURFACE_EPS ? d : cd + SURFACE_EPS);
}

// ★ v1.50.13 贴地圆片/线段的足迹感知深度：
// 底座圆、储量环、路面等贴地图元的下半部分会延伸进**相邻更近格**的 territory——
// 只抬到「所在格心 + ε」仍会被邻格后画盖掉（POI 底座/道路「半截入土」的残余根因）。
// 取「圆心 + 朝向相机方向的圆缘采样点」所在格心的最大值 + ε：
// 圆片触及的格子全部先画；对足迹之外的更近格子（如真山体）仍是真值，不破坏远山遮挡。
function _decalDepth(px, py, rWorld, cosZ, sinZ, cosX, sinX) {
  let dMax = _ownCellCenterDepth(px, py, cosZ, sinZ, cosX, sinX);
  const nx = sinZ, ny = cosZ; // 深度增速最大的世界方向（单位向量：depth = wx·sinZ + wy·cosZ）
  for (let t = 0.5; t <= 1.001; t += 0.5) {
    const cd = _ownCellCenterDepth(px + nx * rWorld * t, py + ny * rWorld * t, cosZ, sinZ, cosX, sinX);
    if (cd != null && (dMax == null || cd > dMax)) dMax = cd;
  }
  return dMax == null ? null : dMax + SURFACE_EPS;
}

// 选中营地辖区连线暂存（收集阶段定位，绘制阶段消费）
let _selLinkCamp = null;

function drawWorldEntities() {
  const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
  const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
  const scale = camera.zoom;
  const cx = w / 2 + camera.panX, cy = h / 2 + camera.panY;
  const list = _depthList;
  list.length = 0;
  _depthPoolUsed = 0;

  // 道路悬浮检测 + Tooltip（先于收集，isHovered 供分段高亮样式使用）
  updateLaneHover();

  const depthOf = (px, py, pz) => (px * sinZ + py * cosZ) * sinX + (pz || 0) * cosX;

  const terrain = sim.terrain;
  const hasTerrain = !!(sim.showTerrain && terrain && terrain.cells &&
    terrain.cells.length >= terrain.gridSize * terrain.gridSize);

  // ── 1. 地形格入队（★ 本修复核心）──
  //    深度取四角 world 坐标均值（深度公式对 wx/wy/elev 线性，均值即格心深度）；
  //    与立体实体同队列排序后，近处山地格后落笔即遮挡山后图标。
  if (hasTerrain) {
    const cells = terrain.cells;
    const gSize = terrain.gridSize;
    for (let gy = 0; gy < gSize - 1; gy++) {
      const rowOffset0 = gy * gSize;
      const rowOffset1 = rowOffset0 + gSize;
      for (let gx = 0; gx < gSize - 1; gx++) {
        const i00 = rowOffset0 + gx;
        const i10 = i00 + 1;
        const i11 = rowOffset1 + gx + 1;
        const i01 = rowOffset1 + gx;

        // 视口边界快速剔除（与旧 drawTerrain 相同的 20px 余量）
        const minX = Math.min(terrainProjX[i00], terrainProjX[i10], terrainProjX[i11], terrainProjX[i01]);
        const maxX = Math.max(terrainProjX[i00], terrainProjX[i10], terrainProjX[i11], terrainProjX[i01]);
        const minY = Math.min(terrainProjY[i00], terrainProjY[i10], terrainProjY[i11], terrainProjY[i01]);
        const maxY = Math.max(terrainProjY[i00], terrainProjY[i10], terrainProjY[i11], terrainProjY[i01]);
        if (maxX < -20 || minX > w + 20 || maxY < -20 || minY > h + 20) continue;

        const c00 = cells[i00], c10 = cells[i10], c11 = cells[i11], c01 = cells[i01];
        const it = _depthItem(DEPTH_CELL, i00, i10, depthOf(
          (c00.wx + c10.wx + c11.wx + c01.wx) * 0.25,
          (c00.wy + c10.wy + c11.wy + c01.wy) * 0.25,
          (c00.elev + c10.elev + c11.elev + c01.elev) * 0.25));
        it.c = i11; it.d = i01;
      }
    }

    // ── 1.5 边界侧壁分段入队（★ v1.50.14）──
    //    侧壁是地图边界处最靠近相机的几何：贴边实体的底座/圆环伸过边界线的部分
    //    必须被侧壁盖住。旧实现整墙在壳层先行栅格化，永远盖不住队列元素
    //    （用户可见症状：「贴边 POI/房屋未被地形墙遮挡」）。分段深度取该段上沿
    //    两端顶点深度的较大值（较近端），墙面垂直下垂不改变 ry、只减 z ⇒ 段内
    //    越往下深度越小，用上沿较近端代表整段是「遮挡从严」的安全近似。
    if (hasTerrain) {
      const gSize = terrain.gridSize;
      const walls = BOUNDARY_WALLS;
      const cellsW = terrain.cells;
      for (let wi = 0; wi < 4; wi++) {
        const wd = walls[wi];
        for (let k = 0; k < gSize - 1; k++) {
          const c0 = cellsW[wd.first + k * wd.step];
          const c1 = cellsW[wd.first + (k + 1) * wd.step];
          const d0 = depthOf(c0.wx, c0.wy, c0.elev);
          const d1 = depthOf(c1.wx, c1.wy, c1.elev);
          _depthItem(DEPTH_WALL, wd, k, d0 > d1 ? d0 : d1);
        }
      }
    }

    // ── 2. 水系特征 / 游鱼 / 波光 ──
    // ★ v1.50.20 河流分段入队：整条河多边形若以「全顶点最大深度」入队（v1.50.11 做法），
    //   只要任一岸段靠近相机，整条河就后画、盖住所有更远的树/房/POI/族人（用户可见症状：
    //   「河流叠加在树和房子、POI、NPC 上」）。现在：
    //   River 水面按剖分区间逐段入队（b = 段号，深度 = 段四角最大相机深度）；
    //   RiverBank 逐段描边；ShallowFord / 波光挂所在段深度 + ε（恒在所在段水面之后）。
    const features = terrain.features || [];
    if (features.length && window.RiverLife) window.RiverLife.update(performance.now());
    const rivers = [];
    for (let fi = 0; fi < features.length; fi++) {
      const f = features[fi];
      if (f.kind === 'River' && f.vertices && f.vertices.length >= 4) rivers.push(f);
    }
    // 河轴剖分 y → 所在段的最大深度（左右岸顶点 y 单调；段深度 = 4 角相机深度最大值）
    const riverBandDepth = (river, y) => {
      const v = river.vertices, half = v.length >> 1;
      const asc = v[0].y <= v[half - 1].y;
      if (asc ? (y < v[0].y || y > v[half - 1].y) : (y > v[0].y || y < v[half - 1].y)) return null;
      let lo = 0, hi = half - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (asc ? v[mid].y <= y : v[mid].y >= y) lo = mid; else hi = mid - 1;
      }
      const j = v.length - 1 - lo;
      return Math.max(
        depthOf(v[lo].x, v[lo].y, v[lo].z),
        depthOf(v[lo + 1].x, v[lo + 1].y, v[lo + 1].z),
        depthOf(v[j].x, v[j].y, v[j].z),
        depthOf(v[j - 1].x, v[j - 1].y, v[j - 1].z));
    };
    for (let fi = 0; fi < features.length; fi++) {
      const f = features[fi];
      if (!f.vertices || f.vertices.length < 2) continue;
      const vs = f.vertices;
      if (f.kind === 'River') {
        const half = vs.length >> 1;
        for (let b = 0; b < half - 1; b++) {
          const j = vs.length - 1 - b;
          _depthItem(DEPTH_FEATURE, f, b, Math.max(
            depthOf(vs[b].x, vs[b].y, vs[b].z),
            depthOf(vs[b + 1].x, vs[b + 1].y, vs[b + 1].z),
            depthOf(vs[j].x, vs[j].y, vs[j].z),
            depthOf(vs[j - 1].x, vs[j - 1].y, vs[j - 1].z)));
        }
      } else if (f.kind === 'RiverBank') {
        // 岸线带逐段入队（整条以最大顶点深度入队会同样盖住更远实体）
        for (let s = 0; s < vs.length - 1; s++) {
          const d0 = depthOf(vs[s].x, vs[s].y, vs[s].z);
          const d1 = depthOf(vs[s + 1].x, vs[s + 1].y, vs[s + 1].z);
          _depthItem(DEPTH_FEATURE, f, s, d0 > d1 ? d0 : d1);
        }
      } else if (f.kind === 'ShallowFord') {
        // 涉渡横跨河道（两端 y 相同）：挂所在段深度 + ε ⇒ 恒在该段水面之后
        let d = null;
        const yMid = (vs[0].y + vs[1].y) * 0.5;
        for (let ri = 0; ri < rivers.length && d == null; ri++) d = riverBandDepth(rivers[ri], yMid);
        if (d == null) {
          const d0 = depthOf(vs[0].x, vs[0].y, vs[0].z);
          const d1 = depthOf(vs[1].x, vs[1].y, vs[1].z);
          d = d0 > d1 ? d0 : d1;
        }
        _depthItem(DEPTH_FEATURE, f, 0, d + 0.05);
      } else {
        let dmax = -Infinity;
        for (let vi = 0; vi < vs.length; vi++) {
          const d = depthOf(vs[vi].x, vs[vi].y, vs[vi].z);
          if (d > dmax) dmax = d;
        }
        _depthItem(DEPTH_FEATURE, f, 0, dmax);
      }
    }
    // 游鱼逐条入队：深度 = 鱼体世界坐标（所在段水面的段内位置深度 < 段 4 角最大 ⇒ 落在水面填充之前）
    const fishList = window.RiverLife ? window.RiverLife.fishList() : null;
    if (fishList) {
      for (let i = 0; i < fishList.length; i++) {
        const f = fishList[i];
        _depthItem(DEPTH_FISH, f, 0, depthOf(f.x, f.y, f.z));
      }
    }
    // 波光逐段入队：深度挂所在河段最大深度 + ε ⇒ 恒在所在段水面之后、任何更近实体之前
    const cps = window.RiverLife ? window.RiverLife.centerPoints() : null;
    if (cps && rivers.length) {
      for (let i = 4; i < cps.length - 6; i += 7) {
        const cp = cps[i];
        const bd = riverBandDepth(rivers[0], cp.y);
        if (bd != null) _depthItem(DEPTH_GLINT, cp, i, bd + 0.06);
      }
    }
  }

  // ── 3. 道路（每段一个深度项；投影 17 个采样点，虚线相位按累计弧长跨段连续）──
  if (sim.showLanes && sim.network && sim.network.lanes) {
    const segs = 16;
    for (const lane of sim.network.lanes.values()) {
      const wear = lane.wear || 0.0;
      if (wear < 0.3) continue;

      _ensureLaneBuf(segs + 1);
      let cum = 0;
      let prevX = 0, prevY = 0;
      for (let i = 0; i <= segs; i++) {
        const pt3D = lane.curve.evalPos(i / segs);
        _laneWX[i] = pt3D.x; _laneWY[i] = pt3D.y; _laneWZ[i] = pt3D.z || 0;
        const rx = pt3D.x * cosZ - pt3D.y * sinZ;
        const ry = pt3D.x * sinZ + pt3D.y * cosZ;
        const y2 = ry * cosX - (pt3D.z || 0) * sinX;
        _lanePX[i] = cx + rx * scale;
        _lanePY[i] = cy + y2 * scale;
        if (i > 0) cum += Math.hypot(_lanePX[i] - prevX, _lanePY[i] - prevY);
        prevX = _lanePX[i]; prevY = _lanePY[i];
        _laneCum[i] = cum;
      }

      cacheLaneStyle(lane, wear);

      for (let k = 0; k < segs; k++) {
        // ★ v1.50.15 足迹感知深度强化：分段 5 采样（原 3）× _decalDepth(R)——
        //   v1.50.13 的「两端+中点三采样 _surfaceDepth」有两个缺口：① _surfaceDepth
        //   只抬到所在格心，路拱半宽（热力图外光晕 ~2.9px）朝相机侧伸入**下一格**
        //   的 territory 未被覆盖；② 整条赛道仅 16 分段，长路段会跨越 3+ 格，
        //   3 采样漏掉中段跨入的更近格——两处均表现为路面被后画格「半截入土」。
        let segDepth = -Infinity;
        for (let s = 0; s <= 4; s++) {
          const f = s * 0.25;
          const wx = _laneWX[k] + (_laneWX[k + 1] - _laneWX[k]) * f;
          const wy = _laneWY[k] + (_laneWY[k + 1] - _laneWY[k]) * f;
          const wz = _laneWZ[k] + (_laneWZ[k + 1] - _laneWZ[k]) * f;
          const dd = _decalDepth(wx, wy, RC.laneFootprintR || 6, cosZ, sinZ, cosX, sinX);
          const d = dd != null ? dd : _surfaceDepth(wx, wy, wz, cosZ, sinZ, cosX, sinX);
          if (d > segDepth) segDepth = d;
        }
        const it = _depthItem(DEPTH_LANE, lane, k, segDepth);
        it.s1x = _lanePX[k]; it.s1y = _lanePY[k];
        it.s2x = _lanePX[k + 1]; it.s2y = _lanePY[k + 1];
        it.dash = _laneCum[k];
      }
    }
  }

  // ── 4. 选中营地的辖区连线（中点近似深度；选择辅助线，允许穿越山地的小误差）──
  collectCampHouseLinks(cosZ, sinZ, cosX, sinX);

  // ── 5. POI 贴地底座（足迹感知深度取「底座触及格」最大值，再 −0.01 垫在自己标记之下）──
  //   底座圆半径与 Camp 等级/类型相关（与 drawPoiGroundBase 的屏幕半径 ÷ zoom 同源）
  for (const poi of sim.pois || []) {
    const rWorld = poi.type === 'Camp'
      ? (RC.poiBaseCampR || 16) + (poi.level || 0) * (RC.poiBaseCampRPerLevel != null ? RC.poiBaseCampRPerLevel : 3)
      : (RC.poiBaseResourceR || 12);
    const dd = _decalDepth(poi.pos.x, poi.pos.y, rWorld, cosZ, sinZ, cosX, sinX);
    const d = (dd != null ? dd : _surfaceDepth(poi.pos.x, poi.pos.y, poi.pos.z, cosZ, sinZ, cosX, sinX)) - 0.01;
    _depthItem(DEPTH_POI_BASE, poi, 0, d);
  }

  // ── 6. 立体实体（原 v1.47.9 队列，收集顺序 = 同深度 tie-break 次序）──
  // POI 标记：图标/储量环/门牌以锚点为中心半径 ~14-22 世界单位，同样走足迹感知深度
  for (const poi of sim.pois || []) {
    const dd = _decalDepth(poi.pos.x, poi.pos.y, RC.poiMarkerFootprintR || 20, cosZ, sinZ, cosX, sinX);
    _depthItem(DEPTH_POI, poi, 0, dd != null ? dd : _surfaceDepth(poi.pos.x, poi.pos.y, poi.pos.z, cosZ, sinZ, cosX, sinX));
  }
  for (const house of sim.houses || []) {
    _depthItem(DEPTH_HOUSE, house, 0, _surfaceDepth(house.pos.x, house.pos.y, house.pos.z, cosZ, sinZ, cosX, sinX));
  }
  const terrainAccents = (terrain && terrain.accents) || [];
  for (const accent of terrainAccents) {
    // ★ v1.50.13 石头/灌木宽约 6 世界单位，走足迹感知深度消除底边残缝
    const dd = _decalDepth(accent.x, accent.y, RC.accentFootprintR || 8, cosZ, sinZ, cosX, sinX);
    _depthItem(DEPTH_ACCENT, accent, 0, dd != null ? dd : _surfaceDepth(accent.x, accent.y, accent.z, cosZ, sinZ, cosX, sinX));
  }
  if (sim.showAgents) {
    for (const agent of sim.agents || []) {
      if (agent.isFetus) continue; // ★ M1.7 胎儿无地图实体，不参与渲染
      // ★ v1.50.15 族人改走足迹感知深度：人偶/受孕环/施工环/选中环全部**以锚点为中心**，
      //   下方笔迹最大 ~9px（rotX 默认 1.05 时 ≈ 朝相机方向 18 世界单位）——
      //   v1.50.12 的 _surfaceDepth 只保证所在格先画，站在格子远半侧时下半身
      //   伸进的更近格后画，把小人的腿脚盖掉（「半截入土」）。
      const dd = _decalDepth(agent.pos.x, agent.pos.y, RC.agentFootprintR || 18, cosZ, sinZ, cosX, sinX);
      _depthItem(DEPTH_AGENT, agent, 0, dd != null ? dd : _surfaceDepth(agent.pos.x, agent.pos.y, agent.pos.z, cosZ, sinZ, cosX, sinX));
    }
  }

  list.sort((a, b) => a.depth - b.depth);

  const RL = window.RiverLife;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    switch (it.kind) {
      case DEPTH_CELL: drawTerrainCell(it.a, it.b, it.c, it.d); break;
      case DEPTH_WALL: drawBoundaryWallSeg(it.a, it.b); break;
      case DEPTH_FEATURE: drawFeatureItem(it.a, it.b); break;
      case DEPTH_FISH: RL.drawFishSingle(ctx, it.a, cx, cy, cosZ, sinZ, cosX, sinX, scale); break;
      case DEPTH_GLINT: RL.drawGlintAt(ctx, it.a, cx, cy, cosZ, sinZ, cosX, sinX, scale); break;
      case DEPTH_LANE: drawLaneSegment(it); break;
      case DEPTH_LINK: drawCampHouseLink(it); break;
      case DEPTH_POI_BASE: drawPoiGroundBase(it.a); break;
      case DEPTH_POI: drawPoiMarker(it.a); break;
      case DEPTH_HOUSE: drawHouse(it.a); break;
      case DEPTH_ACCENT: drawAccentEntity(it.a); break;
      default: drawAgent(it.a);
    }
  }
}

function drawHouse(house) {
  const z = camera.zoom;
  const showLabels = z > 1.05;

  const p2D = projectLifted(house.pos); // ★ v1.50.12 精灵锚点略抬于地表
  const isSelected = sim.selectionType === 'house' && sim.selectedHouseId === house.id;
  const isWarehouse = house.tier === 'Tier0Warehouse';
  const isVacant = house.ownerId == null;
  const isAuction = isVacant && house.auctionPhase != null;
  const x = p2D.x, y = p2D.y;

  // 1. 地面柔和接触阴影 (Drop Shadow) - 按 70% 等比微缩，方向/长度随季节光位
  const sW = (house.tier === 'Tier4Manor' ? 10 : (house.tier === 'Tier3Homestead' ? 8.5 : 6.5)) * z;
  const sH = sW * 0.52;
  const hShadow = lightShadowOffset(1.4, 2.1, (window.SimLighting && window.SimLighting.cfg().houseShadowHeight) || 3.0);
  ctx.fillStyle = `rgba(22, 18, 14, ${(0.26 * hShadow.alphaScale).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(x + hShadow.x, y + hShadow.y, sW, sH, -0.12, 0, Math.PI * 2);
  ctx.fill();

  // 2. 2.5D 微缩建筑模型体块 (宽高缩小至原来的 70%)
  const hw = (isWarehouse ? 5.25 : (house.tier === 'Tier4Manor' ? 8.4 : (house.tier === 'Tier3Homestead' ? 6.65 : 5.25))) * z;
  const hh = (isWarehouse ? 4.55 : (house.tier === 'Tier4Manor' ? 9.1 : (house.tier === 'Tier3Homestead' ? 6.65 : 5.25))) * z;

  // 墙体配色：空置房为古朴风化灰，有主房为温润奶油白/木质暖色
  const wallFront = isVacant ? '#d1c7b7' : (isWarehouse ? '#b8966c' : '#ede3d1');
  const wallSide = isVacant ? '#a89e8f' : (isWarehouse ? '#8c6f4b' : '#c4b8a3');

  // 屋顶配色 (层级分明)
  let roofFront, roofSide;
  if (isWarehouse) { roofFront = '#825f38'; roofSide = '#5c4122'; }
  else if (house.tier === 'Tier1ThatchedHut') { roofFront = '#c9a654'; roofSide = '#9e8038'; } // 茅草顶
  else if (house.tier === 'Tier2LeanTo') { roofFront = '#bf5737'; roofSide = '#8c3b22'; } // 暖陶瓦红
  else if (house.tier === 'Tier3Homestead') { roofFront = '#475569'; roofSide = '#334155'; } // 青石黛瓦庄院
  else { roofFront = '#334155'; roofSide = '#1e293b'; } // 城堡深石板青

  // 墙体受光面 (南/东) 与 背光面 (西)
  // ★ 动态季节光照：面法线参与光向计算（左墙 = 西、右墙 = 南、左坡 = 西向上、右坡 = 南向上）；
  //   相对旧固定光归一化 ⇒ 关闭动态光照或光位回到西北 41° 时与 v1.47.11 配色一致。
  ctx.fillStyle = shadeHex(wallSide, -1, 0, 0);
  ctx.beginPath();
  ctx.moveTo(x - hw, y);
  ctx.lineTo(x, y + hh * 0.4);
  ctx.lineTo(x, y - hh * 0.5);
  ctx.lineTo(x - hw, y - hh * 0.9);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = shadeHex(wallFront, 0, 1, 0);
  ctx.beginPath();
  ctx.moveTo(x, y + hh * 0.4);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x + hw, y - hh * 0.9);
  ctx.lineTo(x, y - hh * 0.5);
  ctx.closePath();
  ctx.fill();

  // 门洞微缩细节
  ctx.fillStyle = '#4a3828';
  ctx.beginPath();
  ctx.moveTo(x + hw * 0.2, y + hh * 0.15);
  ctx.lineTo(x + hw * 0.6, y - hh * 0.05);
  ctx.lineTo(x + hw * 0.6, y - hh * 0.5);
  ctx.lineTo(x + hw * 0.2, y - hh * 0.3);
  ctx.closePath();
  ctx.fill();

  // 双坡/四阿微缩屋顶 (具有太阳漫反射明暗)
  ctx.fillStyle = shadeHex(roofSide, -0.45, 0, 0.89);
  ctx.beginPath();
  ctx.moveTo(x - hw * 1.15, y - hh * 0.85);
  ctx.lineTo(x, y - hh * 0.45);
  ctx.lineTo(x, y - hh * 1.35);
  ctx.lineTo(x - hw * 0.8, y - hh * 1.6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = shadeHex(roofFront, 0, 0.45, 0.89);
  ctx.beginPath();
  ctx.moveTo(x, y - hh * 0.45);
  ctx.lineTo(x + hw * 1.15, y - hh * 0.85);
  ctx.lineTo(x + hw * 0.8, y - hh * 1.6);
  ctx.lineTo(x, y - hh * 1.35);
  ctx.closePath();
  ctx.fill();

  // 庄院飞檐或城堡塔楼细节
  if (house.tier === 'Tier3Homestead' || house.tier === 'Tier4Manor') {
    ctx.strokeStyle = roofSide;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(x - hw * 1.25, y - hh * 0.95);
    ctx.lineTo(x, y - hh * 0.42);
    ctx.lineTo(x + hw * 1.25, y - hh * 0.95);
    ctx.stroke();
  }

  // 3. 悬浮拍卖标牌或修缮标识 (全景降噪，仅在近景/选中或关键状态展示)
  if (isAuction) {
    const plaqueLabel = house.highestBid > 0 ? `🔨 ${house.auctionPhase || '竞价'} · ${house.highestBid.toFixed(0)}G` : `🔨 ${house.auctionPhase || '招租'}`;
    ctx.font = 'bold 8px sans-serif';
    ctx.fillStyle = '#f59e0b';
    ctx.textAlign = 'center';
    ctx.fillText(plaqueLabel, x, y - hh * 1.7);
  } else if (house.isRepairing) {
    ctx.font = '8px sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.textAlign = 'center';
    ctx.fillText(`🔧修缮 (${Math.round(house.durability)}%)`, x, y - hh * 1.6);
  } else if (showLabels || isSelected) {
    const tierLabel = isWarehouse ? '仓' : (house.tier === 'Tier1ThatchedHut' ? '茅' : (house.tier === 'Tier2LeanTo' ? '宅' : (house.tier === 'Tier3Homestead' ? '庄' : '堡')));
    ctx.font = '8px sans-serif';
    ctx.fillStyle = isVacant ? '#94a3b8' : '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(`#${house.id}${tierLabel}`, x, y + hh * 0.8);
  }

  if (isSelected) {
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
    ctx.lineWidth = 3.5 * z;
    ctx.beginPath(); ctx.arc(x, y, sW * 1.1, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6 * z;
    ctx.beginPath(); ctx.arc(x, y, sW * 1.1, 0, Math.PI * 2); ctx.stroke();
  }
}

// 选中营地时，用特殊虚线把辖区内的全部房屋连回营地；线段置于房屋图标下方避免遮挡信息。
// ★ v1.50.11：不再整层先画，逐条入统一深度队列（中点近似深度——选择辅助线，允许穿越山地的小误差）。
function collectCampHouseLinks(cosZ, sinZ, cosX, sinX) {
  _selLinkCamp = null;
  if (sim.selectionType !== 'poi' || sim.selectedPoiId == null) return;
  const camp = sim.pois.find(p => p.id === sim.selectedPoiId && p.type === 'Camp');
  if (!camp) return;
  const houses = sim.houses.filter(h => h.campId === camp.id);
  if (houses.length === 0) return;
  _selLinkCamp = camp;
  for (const house of houses) {
    _depthItem(DEPTH_LINK, house, 0, _surfaceDepth(
      (camp.pos.x + house.pos.x) * 0.5,
      (camp.pos.y + house.pos.y) * 0.5,
      ((camp.pos.z || 0) + (house.pos.z || 0)) * 0.5, cosZ, sinZ, cosX, sinX));
  }
}

function drawCampHouseLink(it) {
  const house = it.a;
  const camp = _selLinkCamp;
  if (!camp) return;
  const camp2D = project3D(camp.pos);
  const house2D = project3D(house.pos);
  const vacant = house.ownerId == null;
  const color = vacant ? '#f59e0b' : '#38bdf8';
  ctx.save();
  ctx.lineWidth = Math.max(1.2, 2.0 * camera.zoom);
  ctx.setLineDash([Math.max(4, 8 * camera.zoom), Math.max(3, 5 * camera.zoom)]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 7 * camera.zoom;
  ctx.globalAlpha = 0.72;
  ctx.beginPath();
  ctx.moveTo(camp2D.x, camp2D.y);
  ctx.lineTo(house2D.x, house2D.y);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(house2D.x, house2D.y, Math.max(1.5, 2.5 * camera.zoom), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ★ v1.50.11：drawLanes 拆分——
//   ① updateLaneHover：悬浮检测 + Tooltip DOM 更新（原 drawLanes 前半段，逐帧整层无关深度）；
//   ② cacheLaneStyle + drawLaneSegment：道路样式计算与单段描边（由统一深度队列逐段调度）。
function updateLaneHover() {
hoveredLane = null;
let minHoverDist = 14;

if (sim.showLanes && sim.network && sim.network.lanes) {
  // 先进行鼠标悬浮检测 (仅对可见道路 wear >= 0.3)
  if (!isDragging && mousePos.x >= 0 && mousePos.y >= 0) {
    for (const lane of sim.network.lanes.values()) {
      const wear = lane.wear || 0.0;
      if (wear < 0.3) continue;

      const segs = 12;
      let prev2D = null;
      for (let i = 0; i <= segs; i++) {
        const pt3D = lane.curve.evalPos(i / segs);
        const p2D = project3D(pt3D);
        if (prev2D) {
          const d = distToSegment(mousePos.x, mousePos.y, prev2D.x, prev2D.y, p2D.x, p2D.y);
          if (d < minHoverDist) {
            minHoverDist = d;
            hoveredLane = lane;
          }
        }
        prev2D = p2D;
      }
    }
  }

  // 更新悬浮 Tooltip 提示
  const roadTooltip = document.getElementById('road-hover-tooltip');
  const cfg = window.SIM_CONFIG || {};
  if (roadTooltip) {
    if (hoveredLane) {
      const maxWear = cfg.roadMaxWear || 10.0;
      const benefitMax = cfg.roadBenefitMaxWear || 5.0;
      const rawWear = hoveredLane.wear || 0.0;
      const wear = Math.min(maxWear, rawWear);
      const effectiveWear = Math.min(benefitMax, wear);
      let levelName = '1级 踩踏细径 (泥土小道)';
      let levelColor = '#b45309';
      let barColor = '#f59e0b';
      let badgeText = '1级 初见成型';

      if (wear >= 4.0) {
        levelName = wear > benefitMax ? `5级 极品帝国大道 (溢出储备 ${(wear - benefitMax).toFixed(2)})` : '5级 极品帝国大道 (顶级通衢)';
        levelColor = '#f59e0b';
        barColor = 'linear-gradient(90deg, #f59e0b, #ec4899)';
        badgeText = wear > benefitMax ? '5级 满额溢出' : '5级 极品通衢';
      } else if (wear >= 3.0) {
        levelName = '4级 精修石板通衢 (坚固大道)';
        levelColor = '#38bdf8';
        barColor = '#38bdf8';
        badgeText = '4级 精修石板';
      } else if (wear >= 2.0) {
        levelName = '3级 平整石道 (硬化主路)';
        levelColor = '#facc15';
        barColor = '#facc15';
        badgeText = '3级 平整石道';
      } else if (wear >= 1.0) {
        levelName = '2级 夯土土路 (常行小道)';
        levelColor = '#fb923c';
        barColor = '#fb923c';
        badgeText = '2级 夯土土路';
      }

      const speedFactor = Math.min(
        cfg.roadLevelFactorMax || 2.20,
        Math.max(
          cfg.roadLevelFactorMin || 0.50,
          (cfg.roadLevelFactorBase || 0.50) + (cfg.roadLevelFactorWearCoef || 0.333) * effectiveWear
        )
      );
      const speedBonusPct = Math.round((speedFactor - 1.0) * 100);
      const speedText = speedBonusPct >= 0 ? `+${speedBonusPct}%` : `${speedBonusPct}%`;
      const wearPct = Math.round((wear / maxWear) * 100);
      const isOverflow = wear > benefitMax;

      roadTooltip.innerHTML = `
        <div class="road-tooltip-title">
          <span style="color:${levelColor}; font-weight:700;">🛣️ ${levelName}</span>
          <span style="color:${levelColor}; font-size:10px; background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px;">${badgeText}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:2px;">
          <span style="color:#94a3b8;">耐久度 / 踩踏值:</span>
          <span style="color:#f8fafc; font-weight:700; font-family:monospace;">${wear.toFixed(2)} / ${maxWear.toFixed(2)} (${wearPct}%)${isOverflow ? ` <span style="color:#a78bfa; font-size:10px;">(溢出 +${(wear - benefitMax).toFixed(2)})</span>` : ''}</span>
        </div>
        <div class="road-tooltip-bar-bg">
          <div class="road-tooltip-bar-fill" style="width:${wearPct}%; background:${isOverflow ? 'linear-gradient(90deg, #f59e0b, #ec4899, #a78bfa)' : barColor};"></div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:3px;">
          <span style="color:#94a3b8;">移动速度加成:</span>
          <span style="color:#38bdf8; font-weight:700; font-family:monospace;">${speedFactor.toFixed(2)}x (${speedText}${isOverflow ? ' · 满额无额外增益' : ''})</span>
        </div>
        <div style="font-size:10px; color:#64748b; margin-top:3px; border-top:1px solid rgba(255,255,255,0.06); padding-top:4px;">
          👟 步行通行: <span style="color:#10b981;">+${cfg.roadWearStepInc || 0.1}/次</span> · 闲置自然衰减: <span style="color:#f87171;">-${(wear * (cfg.roadWearDecayRate || 0.005)).toFixed(4)}/h (${((cfg.roadWearDecayRate || 0.005) * 100).toFixed(2)}%/h)</span>
        </div>
      `;

      roadTooltip.style.display = 'flex';
      roadTooltip.style.borderColor = levelColor;

      const tw = 250, th = 130;
      let tx = mousePos.x + 16;
      let ty = mousePos.y + 16;
      if (tx + tw > window.innerWidth - 10) tx = mousePos.x - tw - 12;
      if (ty + th > window.innerHeight - 10) ty = mousePos.y - th - 12;
      roadTooltip.style.left = `${tx}px`;
      roadTooltip.style.top = `${ty}px`;
    } else {
      roadTooltip.style.display = 'none';
    }
  }
} else {
  const roadTooltip = document.getElementById('road-hover-tooltip');
  if (roadTooltip) roadTooltip.style.display = 'none';
}
}

// 道路分段样式（每帧每路计算一次，字符串缓存到 lane 对象上，避免逐段分配 rgba 字符串）
// 样式规则与旧 drawLanes 完全一致：热力图模式（R 键）高饱和五档 / 自然模式低饱和泥土-夯土-石板五档。
function cacheLaneStyle(lane, wear) {
  const isHovered = hoveredLane && (lane.id === hoveredLane.id || (hoveredLane.reverseId && lane.id === hoveredLane.reverseId));
  let st = lane._rdStyle;
  if (!st) {
    st = { wear: -1, isHovered: false, heatmap: null, strokeColor: '', lineWidth: 0, lineDash: null };
    lane._rdStyle = st;
  }
  if (st.wear === wear && st.isHovered === isHovered && st.heatmap === sim.showRoadHeatmap) return;
  st.wear = wear; st.isHovered = isHovered; st.heatmap = sim.showRoadHeatmap;

  let lineWidth = 2.0 * camera.zoom;
  let strokeColor, lineDash;
  if (sim.showRoadHeatmap) {
    // 道路等级分析热力图模式 (按 R 键切换开启): 高饱和色彩与外圈分析光晕
    if (wear < 1.0) { strokeColor = `rgba(180, 83, 9, ${Math.min(0.75, 0.20 + (wear - 0.3) * 0.64)})`; lineDash = [3, 4]; }
    else if (wear < 2.0) { strokeColor = `rgba(245, 158, 11, ${Math.min(0.85, 0.45 + (wear - 1.0) * 0.35)})`; lineDash = []; }
    else if (wear < 3.0) { strokeColor = 'rgba(250, 204, 21, 0.95)'; lineDash = []; }
    else if (wear < 4.0) { strokeColor = 'rgba(56, 189, 248, 0.95)'; lineDash = []; }
    else { strokeColor = 'rgba(217, 70, 239, 1.0)'; lineDash = []; }
  } else {
    // 自然地表踩踏小径模式 (普通观察默认): 低饱和自然泥土、夯土与石板，消除高光割裂
    if (wear < 1.0) {
      lineWidth = 1.2 * camera.zoom;
      strokeColor = `rgba(142, 115, 84, ${Math.min(0.55, 0.12 + (wear - 0.3) * 0.50)})`;
      lineDash = [3, 4];
    } else if (wear < 2.0) {
      lineWidth = 1.6 * camera.zoom;
      strokeColor = `rgba(122, 98, 72, ${Math.min(0.75, 0.35 + (wear - 1.0) * 0.30)})`;
      lineDash = [];
    } else if (wear < 3.0) {
      lineWidth = 2.0 * camera.zoom;
      strokeColor = 'rgba(108, 95, 80, 0.85)';
      lineDash = [];
    } else if (wear < 4.0) {
      lineWidth = 2.4 * camera.zoom;
      strokeColor = 'rgba(132, 128, 120, 0.90)';
      lineDash = [];
    } else {
      lineWidth = 2.8 * camera.zoom;
      strokeColor = 'rgba(158, 154, 144, 0.95)';
      lineDash = [];
    }
  }
  st.strokeColor = strokeColor;
  st.lineWidth = lineWidth;
  st.lineDash = lineDash;
}

// 单段道路描边（统一深度队列调度）。悬浮高亮光晕与热力图外圈微光逐段先行落笔，
// 效果与旧整路两遍描边等价；lineDashOffset 按段首累计弧长推进，虚线相位跨段连续。
function drawLaneSegment(it) {
  const st = it.a._rdStyle;
  if (!st) return;

  if (st.isHovered) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = st.lineWidth + 3.0 * camera.zoom;
    ctx.beginPath();
    ctx.moveTo(it.s1x, it.s1y);
    ctx.lineTo(it.s2x, it.s2y);
    ctx.stroke();
  }

  // 高等级大道外圈微光 (仅在热力图模式下显示，自然模式保持地表克制)
  if (st.heatmap && st.wear >= 4.0) {
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.25)';
    ctx.lineWidth = st.lineWidth + 3.0 * camera.zoom;
    ctx.beginPath();
    ctx.moveTo(it.s1x, it.s1y);
    ctx.lineTo(it.s2x, it.s2y);
    ctx.stroke();
  }

  ctx.strokeStyle = st.strokeColor;
  ctx.lineWidth = st.lineWidth;
  ctx.setLineDash(st.lineDash);
  ctx.lineDashOffset = it.dash;
  ctx.beginPath();
  ctx.moveTo(it.s1x, it.s1y);
  ctx.lineTo(it.s2x, it.s2y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}
