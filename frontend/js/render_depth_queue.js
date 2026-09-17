// === 世界统一深度队列层（★ TA-04-6 前置自 render_world.js 拆分，单一职责模块）===
// 职责（07 号 §6.5 末段「入队和分发归队列层」）：深度项对象池、贴面/足迹感知深度帮助函数、
// 精灵锚点抬升（MAP_Z_LIFT / projectLifted）、drawWorldEntities() 收集（地形格 / 侧壁 / 水系 /
// 游鱼 / 波光 / 道路 / 辖区连线 / POI 底座与标记 / 房屋 / 地表装饰 / ★ 树灌木贴地投影 / 族人）
// 与按相机深度远 → 近的分发落笔。**各图元的绘制逻辑不在本文件**（地形壳层 render_terrain.js、
// 装饰 render_accents.js / render_grass.js / render_shadows.js、★ S4-02 景观 render_landscapes.js、
// 房屋与 POI render_world.js、族人 render_agents.js）——本文件只做入队、排序与分发，扩展队列项时勿把绘制搬进来。
//
// ★ v1.50.11 世界统一深度队列：Canvas 2D 无深度缓冲，全部图元按 project3D().depth =
//   ry·sinX + z·cosX 升序（远 → 近）落笔，同深度保持收集原序（Array.sort 稳定）——
//   近处山地格、近处河道、近处乔木都会正确遮挡更远的图标；渲染确定性不变。
//   大气色洗不再整屏 fillRect（会把交错落笔的实体一起洗灰），已烘焙进 relightTerrain 的地形色。
// 依赖全局: ctx, camera, sim, w, h, project3D, mousePos, isDragging, hoveredLane, SimLighting,
//   terrainProjX, terrainProjY, BOUNDARY_WALLS（render_terrain.js）、drawTerrainCell / drawFeatureItem /
//   drawBoundaryWallSeg（render_terrain.js）、drawPoiGroundBase / drawPoiMarker / drawHouse /
//   drawLaneSegment / drawCampHouseLink（render_world.js）、drawAccentEntity（render_accents.js）、
//   drawAccentShadowGround（render_shadows.js）、collectLandscapes / drawLandscapeChild /
//   drawLandscapeShadowGround（render_landscapes.js，S4-02）、drawAgent（render_agents.js）、RiverLife / window.RiverLife

// ★ v1.50.15 渲染表现层参数（视觉抬升 / 足迹深度半径），来源 config.render.js
//   （前端独立配置，不进 SIM_CONFIG——config.js 与 Rust SimConfig 严格互检）。
//   本文件在 index.html 中晚于 config.render.js 加载，顶层读取安全。
const RC = window.RENDER_CONFIG || {};

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
const DEPTH_ACCENT_SHADOW = 12; // ★ TA-04-6 树/灌木贴地投影（地面图元，a = accent；深度 = 基点/影梢足迹深度取大）
const DEPTH_LANDSCAPE = 13;        // ★ S4-02 资源景观立体子图元（a = LandscapeChild，landscape-model.js 派生）
const DEPTH_LANDSCAPE_SHADOW = 14; // ★ S4-02 景观树/灌木子图元贴地投影（a = LandscapeChild；深度口径同 ACCENT_SHADOW）

const _depthPool = [];     // 持久深度项对象池（零每帧 GC）
const _depthList = [];     // 每帧重建的引用列表（仅含本帧使用的项）
let _depthPoolUsed = 0;

function _depthItem(kind, a, b, depth) {
  let it = _depthPool[_depthPoolUsed];
  if (it === undefined) {
    // ★ TA-07：ex/ey = 锚点屏幕坐标（装饰/景观/阴影项；绘制端零重投影）
    //   lod = 本项是否已由入队端剔除并写入屏幕 AABB（1 = 绘制端无需再剔；每次复用清零）
    it = { kind: 0, a: null, b: 0, c: 0, d: 0, depth: 0, s1x: 0, s1y: 0, s2x: 0, s2y: 0, dash: 0, ex: 0, ey: 0, lod: 0 };
    _depthPool.push(it);
  }
  _depthPoolUsed++;
  it.kind = kind; it.a = a; it.b = b; it.depth = depth; it.lod = 0;
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

// ★ TA-04-6 世界阴影方向刮擦（SimLighting.shadowDirInto 消费，收集阶段逐树刷新）
var _qShDir = { x: 0, y: 0, len: 1 };

// 选中营地辖区连线暂存（收集阶段定位，绘制阶段消费）
let _selLinkCamp = null;

// ★ S4-07 实体悬浮检测（同步 sim.hoveredEntity，供标签兜底与高亮使用）
function updateEntityHover() {
  if (typeof mousePos === 'undefined' || mousePos.x < 0 || mousePos.y < 0 || (typeof isDragging !== 'undefined' && isDragging)) {
    if (sim) sim.hoveredEntity = null;
    return;
  }
  const hx = mousePos.x, hy = mousePos.y;
  const _LL = window.LabelLayout;
  if (_LL && _LL.active()) {
    if (typeof _LL.isPointInUi === 'function' && _LL.isPointInUi(hx, hy)) {
      if (sim) sim.hoveredEntity = null;
      return;
    }
    const hit = _LL.hitTest(hx, hy);
    if (hit && !hit.isCluster && hit.ownerType && hit.ownerId != null) {
      if (sim) sim.hoveredEntity = { type: hit.ownerType, id: hit.ownerId };
      return;
    }
  }
  let best = null;
  let minD = 25;
  if (sim && sim.showAgents && sim.agents) {
    for (let i = 0; i < sim.agents.length; i++) {
      const a = sim.agents[i];
      if (a.isFetus) continue;
      const p = project3D(a.pos);
      const d = Math.hypot(hx - p.x, hy - p.y);
      if (d <= minD) { minD = d; best = { type: 'agent', id: a.id }; }
    }
  }
  if (sim && sim.houses) {
    for (let i = 0; i < sim.houses.length; i++) {
      const h = sim.houses[i];
      const p = project3D(h.pos);
      const d = Math.hypot(hx - p.x, hy - p.y);
      if (d <= Math.min(minD, 24)) { minD = d; best = { type: 'house', id: h.id }; }
    }
  }
  if (sim && sim.pois) {
    for (let i = 0; i < sim.pois.length; i++) {
      const poi = sim.pois[i];
      const p = project3D(poi.pos);
      const d = Math.hypot(hx - p.x, hy - p.y);
      if (d <= Math.min(minD, 26)) { minD = d; best = { type: 'poi', id: poi.id }; }
    }
  }
  if (sim) sim.hoveredEntity = best;
}

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
  // ★ S4-07 实体悬浮检测（同步 sim.hoveredEntity）
  updateEntityHover();

  // ★ S4-06 标签布局层：帧起点重置提案池/冲突网格/UI 禁入矩形
  const _LL = window.LabelLayout;
  if (_LL) _LL.beginFrame(w, h);

  const depthOf = (px, py, pz) => (px * sinZ + py * cosZ) * sinX + (pz || 0) * cosX;

  const terrain = sim.terrain;
  const hasTerrain = !!(sim.showTerrain && terrain && terrain.cells &&
    terrain.cells.length >= terrain.gridSize * terrain.gridSize);

  // ── 1. 地形格入队（★ 本修复核心）──
  //    深度取四角 world 坐标均值（深度公式对 wx/wy/elev 线性，均值即格心深度）；
  //    与立体实体同队列排序后，近处山地格后落笔即遮挡山后图标。
  let renderedTerrainCells = 0;
  dbgTerrainRenderedCells = 0;
  if (hasTerrain && !window.webglTerrainActive) {
    // ★ TA-12-3 世界纹样模型每帧一次分批准备（幂等；buildBudgetMs 预算内推进桶构建，
    //   未就绪帧 TerrainTexture.drawCell 自动跳过、只画原基底）。参数取 RENDER_CONFIG
    //   （纯渲染配置，不经 applyConfig 注入 WASM）；世界级失效已由 _invalidateWorldStaticCaches 钩住。
    if (window.TerrainTexture) window.TerrainTexture.prepare(terrain, RC);
    const cells = terrain.cells;
    const gSize = terrain.gridSize;
    const meshMergeCfg = RC && RC.terrainMeshMerge;
    const mergedMesh = (window.TerrainMeshMerge && (!meshMergeCfg || meshMergeCfg.enabled !== false))
      ? window.TerrainMeshMerge.build(terrain, meshMergeCfg)
      : null;

    if (mergedMesh && mergedMesh.quads) {
      const quads = mergedMesh.quads;
      const qLen = quads.length;
      for (let qi = 0; qi < qLen; qi++) {
        const q = quads[qi];
        const i00 = q.i00, i10 = q.i10, i11 = q.i11, i01 = q.i01;

        // 视口边界快速剔除（20px 余量）
        const minX = Math.min(terrainProjX[i00], terrainProjX[i10], terrainProjX[i11], terrainProjX[i01]);
        const maxX = Math.max(terrainProjX[i00], terrainProjX[i10], terrainProjX[i11], terrainProjX[i01]);
        const minY = Math.min(terrainProjY[i00], terrainProjY[i10], terrainProjY[i11], terrainProjY[i01]);
        const maxY = Math.max(terrainProjY[i00], terrainProjY[i10], terrainProjY[i11], terrainProjY[i01]);
        if (maxX < -20 || minX > w + 20 || maxY < -20 || minY > h + 20) continue;

        renderedTerrainCells++;
        const it = _depthItem(DEPTH_CELL, i00, i10, depthOf(q.cx, q.cy, q.cz));
        it.c = i11; it.d = i01;
      }
    } else {
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

          renderedTerrainCells++;
          const c00 = cells[i00], c10 = cells[i10], c11 = cells[i11], c01 = cells[i01];
          const it = _depthItem(DEPTH_CELL, i00, i10, depthOf(
            (c00.wx + c10.wx + c11.wx + c01.wx) * 0.25,
            (c00.wy + c10.wy + c11.wy + c01.wy) * 0.25,
            (c00.elev + c10.elev + c11.elev + c01.elev) * 0.25));
          it.c = i11; it.d = i01;
        }
      }
    }
    dbgTerrainRenderedCells = renderedTerrainCells;

    // ── 1.5 边界侧壁分段入队（★ v1.50.14）──
    //    侧壁是地图边界处最靠近相机的几何：贴边实体的底座/圆环伸过边界线的部分
    //    必须被侧壁盖住。旧实现整墙在壳层先行栅格化，永远盖不住队列元素
    //    （用户可见症状：「贴边 POI/房屋未被地形墙遮挡」）。分段深度取该段上沿
    //    两端顶点深度的较大值（较近端），墙面垂直下垂不改变 ry、只减 z ⇒ 段内
    //    越往下深度越小，用上沿较近端代表整段是「遮挡从严」的安全近似。
    if (hasTerrain && !window.webglTerrainActive) {
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
      } else if (f.kind === 'WaterBody') {
        // ★ TB-03 静水闭合水体：按 32m 世界块分块入队（整湖以最大顶点深度入队
        // 会盖住近岸人物与房屋，TB-03-IMPLEMENTATION-PLAN §7.3）。块网格与
        // render_terrain.js::_wbTileGrid 同式；块深度 = 块四角在水面高程下的
        // 最大深度。idx = 块号 + 1（0 保留给整条绘制项）。
        const STEP = 32;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let vi = 0; vi < vs.length; vi++) {
          if (vs[vi].x < minX) minX = vs[vi].x;
          if (vs[vi].x > maxX) maxX = vs[vi].x;
          if (vs[vi].y < minY) minY = vs[vi].y;
          if (vs[vi].y > maxY) maxY = vs[vi].y;
        }
        const nx = Math.max(1, Math.ceil((maxX - minX) / STEP));
        const ny = Math.max(1, Math.ceil((maxY - minY) / STEP));
        const lvl = f.elevation || 0;
        for (let ty = 0; ty < ny; ty++) {
          for (let tx = 0; tx < nx; tx++) {
            const x0 = minX + tx * STEP, y0 = minY + ty * STEP;
            const x1 = x0 + STEP, y1 = y0 + STEP;
            // 块四角任一在水面高程下的深度取最大（空块照常入队，绘制端 clip 兜底）
            const d = Math.max(
              depthOf(x0, y0, lvl), depthOf(x1, y0, lvl),
              depthOf(x1, y1, lvl), depthOf(x0, y1, lvl));
            _depthItem(DEPTH_FEATURE, f, ty * nx + tx + 1, d);
          }
        }
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
  // ★ S4-03 遮罩同步（幂等；内部先 LandscapeModel.sync 再按签名更新保护区脏桶），
  //   须先于装饰收集执行——装饰遮蔽判定（保护区命中 ∨ 景观重叠去重）按修订号缓存。
  const _mask = window.LandscapeMask;
  if (_mask) _mask.sync(sim);
  // POI 标记：图标/储量环/门牌以锚点为中心半径 ~14-22 世界单位，同样走足迹感知深度
  for (const poi of sim.pois || []) {
    const dd = _decalDepth(poi.pos.x, poi.pos.y, RC.poiMarkerFootprintR || 20, cosZ, sinZ, cosX, sinX);
    _depthItem(DEPTH_POI, poi, 0, dd != null ? dd : _surfaceDepth(poi.pos.x, poi.pos.y, poi.pos.z, cosZ, sinZ, cosX, sinX));
    if (_LL) proposePoiLabels(poi); // ★ S4-06 POI 标签提案（与标记同循环，条件含 LOD 阈值）
  }
  for (const house of sim.houses || []) {
    _depthItem(DEPTH_HOUSE, house, 0, _surfaceDepth(house.pos.x, house.pos.y, house.pos.z, cosZ, sinZ, cosX, sinX));
    if (_LL) proposeHouseLabels(house); // ★ S4-06 房屋标签提案
  }
  const terrainAccents = (terrain && terrain.accents) || [];
  // ★ TA-07-6 入队前两级剔除（§3.5）：一级 kind 级保守常数（**零模型访问** ⇒ 屏外个体不付
  //   AccentModel.get()，冷缓存/相机跳变时不构建屏外骨架）→ 二级模型真值 bounds 精剔；
  //   屏外个体还不付 _decalDepth（3 次 _ownCellCenterDepth）、不进 list.sort()、不进分发循环。
  //   遮罩判定（LandscapeMask.accentHidden）保持在剔除**之前**——被遮罩个体不付剔除成本。
  const AL = window.AccentLOD;
  const cullOn = !!(AL && AL.cfg().cullOn);
  for (const accent of terrainAccents) {
    // ★ S4-03：落入保护区（道路/房屋/POI）或与可见景观子图元重叠的基础装饰整体隐藏，
    //   源数组保持不变（避让只隐藏表现；贴地投影随同不入队）
    if (_mask && _mask.accentHidden(accent)) continue;
    const rxA = accent.x * cosZ - accent.y * sinZ;
    const ryA = accent.x * sinZ + accent.y * cosZ;
    const azA = (accent.z || 0) + MAP_Z_LIFT;
    const sxA = cx + rxA * scale;
    const syA = cy + (ryA * cosX - azA * sinX) * scale;
    if (cullOn) {
      const scA = (accent.scale || 1) * scale;
      const kbA = AL.kindBounds(accent.kind);
      if (!AL.visible(AL.aabbOf(sxA, syA, kbA, AL.SHEAR_MAX, scA, cosX, sinX, AL.aabb))) {
        AL.stats().cullCoarse++; continue;
      }
      const mA = window.AccentModel.get(accent);
      const bA = AL.modelBounds(mA, accent.kind);
      if (!AL.visible(AL.aabbOf(sxA, syA, bA, AL.leanShear(accent, mA), scA, cosX, sinX, AL.aabb))) {
        AL.stats().cullFine++; continue;
      }
    }
    // ★ v1.50.13 石头/灌木宽约 6 世界单位，走足迹感知深度消除底边残缝
    const dd = _decalDepth(accent.x, accent.y, RC.accentFootprintR || 8, cosZ, sinZ, cosX, sinX);
    const itA = _depthItem(DEPTH_ACCENT, accent, 0, dd != null ? dd : _surfaceDepth(accent.x, accent.y, accent.z, cosZ, sinZ, cosX, sinX));
    // ★ TA-07：屏幕 AABB（s1x/s1y = 左下、s2x/s2y = 右上）与锚点屏幕坐标（ex/ey）随深度项
    //   传递 ⇒ 绘制端零重投影、零重剔除，且与入队端共享**同一个** AABB（§3.5 口径唯一红线）
    itA.ex = sxA; itA.ey = syA;
    if (cullOn) {
      // lod=1 ⇒ 绘制端不再重剔（消费**同一个** AABB）；剔除关态时绘制端按现状自算自剔
      itA.lod = 1;
      itA.s1x = AL.aabb.x0; itA.s1y = AL.aabb.y0; itA.s2x = AL.aabb.x1; itA.s2y = AL.aabb.y1;
      AL.stats().enqueued++;
    }
  }
  // ── 6.5 树/灌木贴地投影（★ TA-04-6 地面图元独立入队，绘制归 render_shadows.js 装饰层）──
  //   深度由世界落点（基点 + 影梢）的足迹深度取大——不沿用树根/树冠深度；
  //   影梢 = 锚点 + 世界阴影方向 × 影长 × 模型实高（hWorld = trunkH × accent.scale，不含 camera.zoom，
  //   zoom 只在 lightShadowOffset → SimLighting.shadowOffset 内乘一次，杜绝重复缩放）。
  //   影梢取大深度：影覆盖范围内（含朝相机侧）的地表格恒先画，阴影不被近格后画盖掉；
  //   站进影内的实体被半透明影色罩到属「处于影中」的正常读感，比影更近的实体深度更大、
  //   仍后画不受影响（07 号 §6.5 末段「不承诺逐像素投影正确」的样板口径）。
  {
    const SL = window.SimLighting;
    for (const accent of terrainAccents) {
      const kind = accent.kind;
      if (kind !== 'Tree' && kind !== 'Bush') continue;
      if (_mask && _mask.accentHidden(accent)) continue; // ★ S4-03：被遮蔽装饰的投影随同隐藏
      const rxS = accent.x * cosZ - accent.y * sinZ;
      const ryS = accent.x * sinZ + accent.y * cosZ;
      const azS = (accent.z || 0) + MAP_Z_LIFT;
      const sxS = cx + rxS * scale;
      const syS = cy + (ryS * cosX - azS * sinX) * scale;
      // ★ TA-07 一级粗剔：影长可达「实高 × shadowReachK」（shadowLenMax 2.40，见
      //   config.lighting.js），须按该上界外扩后再判，否则会剔掉「树在屏外、影在屏内」的个体。
      if (cullOn) {
        const scS = (accent.scale || 1) * scale;
        const kbS = AL.kindBounds(kind);
        const aS = AL.aabbOf(sxS, syS, kbS, AL.SHEAR_MAX, scS, cosX, sinX, AL.aabb);
        const reach = kbS.zMax * AL.cfg().shadowReachK * scS; // 影长上界（任意方向）：AABB 各向同扩
        aS.x0 -= reach; aS.x1 += reach; aS.y0 -= reach; aS.y1 += reach;
        if (!AL.visible(aS)) { AL.stats().cullCoarse++; continue; }
      }
      const skel = window.AccentModel.get(accent).skeleton;
      if (!skel) continue;
      const hWorld = skel.trunkH * accent.scale;
      let sxw = 0.6, syw = 0.8, slen = 1.146; // SimLighting 缺席防御：旧固定光（西北 41°）的阴影方向
      if (SL && SL.shadowDirInto) {
        SL.shadowDirInto(_qShDir);
        sxw = _qShDir.x; syw = _qShDir.y; slen = _qShDir.len;
      }
      const tipX = accent.x + sxw * slen * hWorld;
      const tipY = accent.y + syw * slen * hWorld;
      const soX = ((tipX - accent.x) * cosZ - (tipY - accent.y) * sinZ) * scale;
      const soY = ((tipX - accent.x) * sinZ + (tipY - accent.y) * cosZ) * cosX * scale;
      // ★ TA-07 二级精剔：冠影 + 影梢两圆并集（保守：冠幅取模型 crownR 全幅、shadowK 取 1）
      if (cullOn) {
        const crownRS = (skel.crownR || (kind === 'Tree' ? 8.5 : 6.5)) * (accent.scale || 1) * scale;
        if (!AL.visible(AL.shadowAabb(sxS, syS, crownRS, 1, soX, soY, AL.aabb))) {
          AL.stats().cullFine++; continue;
        }
      }
      const fp = (skel.footprintR || (kind === 'Tree' ? 10.5 : 8)) * accent.scale; // ★ TA-06-8 冠幅足迹读模型（世界单位）
      const dBase = _decalDepth(accent.x, accent.y, fp, cosZ, sinZ, cosX, sinX);
      const dTip = _decalDepth(tipX, tipY, fp, cosZ, sinZ, cosX, sinX);
      let d = dBase != null && (dTip == null || dBase > dTip) ? dBase : dTip;
      if (d == null) d = _surfaceDepth(accent.x, accent.y, accent.z, cosZ, sinZ, cosX, sinX);
      const itS = _depthItem(DEPTH_ACCENT_SHADOW, accent, 0, d);
      itS.ex = sxS; itS.ey = syS; // ★ TA-07 锚点屏幕坐标随深度项传递（阴影绘制端零重投影）
      if (cullOn) {
        itS.lod = 1; // 绘制端不再重剔（关态时绘制端按现状自算自剔，见 render_shadows.js）
        itS.s1x = AL.aabb.x0; itS.s1y = AL.aabb.y0; itS.s2x = AL.aabb.x1; itS.s2y = AL.aabb.y1;
        AL.stats().enqueued++;
      }
    }
  }

  // ── 6.6 资源景观（★ S4-02：LandscapeModel 派生组 → render_landscapes.js 入队）──
  //   配方/缓存归 landscape-model.js、子图元绘制复用装饰图元归 render_landscapes.js；
  //   配置关态（landscapeEnabled=false）collect 直接返回，零开销回退原画面路径。
  collectLandscapes(cosZ, sinZ, cosX, sinX);

  if (sim.showAgents) {
    for (const agent of sim.agents || []) {
      if (agent.isFetus) continue; // ★ M1.7 胎儿无地图实体，不参与渲染
      // ★ v1.50.15 族人改走足迹感知深度：人偶/受孕环/施工环/选中环全部**以锚点为中心**，
      //   下方笔迹最大 ~9px（rotX 默认 1.05 时 ≈ 朝相机方向 18 世界单位）——
      //   v1.50.12 的 _surfaceDepth 只保证所在格先画，站在格子远半侧时下半身
      //   伸进的更近格后画，把小人的腿脚盖掉（「半截入土」）。
      const dd = _decalDepth(agent.pos.x, agent.pos.y, RC.agentFootprintR || 18, cosZ, sinZ, cosX, sinX);
      _depthItem(DEPTH_AGENT, agent, 0, dd != null ? dd : _surfaceDepth(agent.pos.x, agent.pos.y, agent.pos.z, cosZ, sinZ, cosX, sinX));
      if (_LL) proposeAgentLabels(agent); // ★ S4-06 族人角标提案（含选中目标捕获）
    }
  }

  // ★ S4-06 标签布局安置：分发循环前按 (优先级, 收集序) 稳定排序逐个安置——
  //   pinned 恒接受占格，ordinary 依次尝试 [首选/镜像/右/左] 四个固定备选位，
  //   屏幕网格冲突检测 + UI 禁入矩形，全部失败即省略（失败处理见 STAGE-04-TODO §4.6）。
  if (_LL) _LL.resolve();

  list.sort((a, b) => a.depth - b.depth);

  const RL = window.RiverLife;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (it.kind !== DEPTH_CELL && window.flushTerrainBatch) {
      window.flushTerrainBatch();
    }
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
      // ★ TA-07-6：装饰/阴影/景观四项把深度项整体传给绘制端（消费入队端 AABB 与锚点屏幕坐标）
      case DEPTH_ACCENT: drawAccentEntity(it.a, it); break;
      case DEPTH_ACCENT_SHADOW: drawAccentShadowGround(it.a, it); break;
      case DEPTH_LANDSCAPE: drawLandscapeChild(it.a, it); break;
      case DEPTH_LANDSCAPE_SHADOW: drawLandscapeShadowGround(it.a, it); break;
      default: drawAgent(it.a);
    }
  }
  if (window.flushTerrainBatch) window.flushTerrainBatch();

  // ★ S4-06 交互覆盖标签：选中族人需求气泡在世界层之上强制安置（不参与地形遮挡）；
  //   挂在队列分发循环结束后——§6.3「分发循环结束点即标签层的天然挂载位」。
  drawSelectedNeedBubbleOverlay();

  // ★ S4-07 聚合徽标、边缘引线与停靠区 DOM 状态同步
  if (_LL) {
    _LL.drawClusters(ctx);
    _LL.drawLeaderLines(ctx);
    _LL.syncFallbackDockDOM();
  }
}

// ★ v1.50.11：选中营地辖区连线逐条入统一深度队列（中点近似深度——选择辅助线，允许穿越山地的小误差）。
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
