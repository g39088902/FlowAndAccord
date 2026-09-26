// === 世界统一深度队列层（★ TA-04-6 前置自 render_world.js 拆分，单一职责模块）===
// 职责（07 号 §6.5 末段「入队和分发归队列层」）：深度项对象池、贴面/足迹感知深度帮助函数、
// 精灵锚点抬升（MAP_Z_LIFT / projectLifted）、drawWorldEntities() 收集（水系 / 游鱼 / 道路 /
// 辖区连线 / POI 底座与标记 / 房屋 / 地表装饰 / 族人）与按相机深度远 → 近的分发落笔。
// ★ 全量 WebGL（Canvas 备用通道删除）：地形格 / 侧壁 / 贴地投影已删除——地形与侧壁由
//   webgl/layers/terrain/terrain-renderer.js 承担，落底阴影由 webgl/layers/accents/shadow-pass.js
//   光向深度图承担。**各图元的绘制逻辑不在本文件**（水系 render_terrain.js、
//   装饰 render_accents.js / render_grass.js、★ S4-02 景观 render_landscapes.js、
//   房屋与 POI render_world.js、族人 render_agents.js）——本文件只做入队、排序与分发。
//
// ★ v1.50.11 世界统一深度队列：Canvas 2D 无深度缓冲，全部图元按 project3D().depth =
//   ry·sinX + z·cosX 升序（远 → 近）落笔，同深度保持收集原序（Array.sort 稳定）——
//   近处河道、近处乔木都会正确遮挡更远的图标；渲染确定性不变。
// 依赖全局: ctx, camera, sim, w, h, project3D, mousePos, isDragging, hoveredLane, SimLighting,
//   drawFeatureItem（render_terrain.js）、drawPoiGroundBase / drawPoiMarker / drawHouse /
//   drawLaneSegment / drawCampHouseLink（render_world.js）、drawAccentEntity（render_accents.js）、
//   collectLandscapes / drawLandscapeChild（render_landscapes.js，S4-02）、drawAgent（render_agents.js）、RiverLife / window.RiverLife

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
// 大气色洗不再整屏 fillRect（会把交错落笔的实体一起洗灰），地形受光由 GL shader 承担。
const DEPTH_FEATURE = 1;   // 水系特征（a = feature，River 水面 / ShallowFord / 泉谷）
const DEPTH_FISH = 2;      // 游鱼（a = fish，水中层，深度低于水面填充）
const DEPTH_WATER_PARTICLE = 3; // 动态水粒子（a = particle）
const DEPTH_LANE = 4;      // 道路分段（a = lane，b = 段序号，s1/s2 = 屏幕端点，dash = 弧长相位）
const DEPTH_LINK = 5;      // 选中营地辖区连线（a = house）
const DEPTH_POI_BASE = 6;  // POI 贴地底座（a = poi）
const DEPTH_POI = 7;       // POI 标记（a = poi）
const DEPTH_HOUSE = 8;     // 房屋（a = house）
const DEPTH_ACCENT = 9;    // 地表装饰（a = accent）
const DEPTH_AGENT = 10;    // 族人（a = agent）
const DEPTH_LANDSCAPE = 13;        // ★ S4-02 资源景观立体子图元（a = LandscapeChild，landscape-model.js 派生）

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
let _lanePX = null, _lanePY = null, _laneCum = null;
function _ensureLaneBuf(n) {
  if (!_lanePX || _lanePX.length < n) {
    _lanePX = new Float32Array(n + 16); _lanePY = new Float32Array(n + 16);
    _laneCum = new Float32Array(n + 16);
  }
}

// ★ v1.50.88 车道静态几何缓存（lane → { wx/wy/wz:17 点世界采样, depth:16 段足迹深度,
//   kz/kz2/kx/kx2: 深度旋转键 }）：lane.curve 与世界几何静态（增量快照只覆写 wear），
//   WeakMap 按 lane 对象弱引用——rustworld geom_version 变更时重建 lane 对象 → 自然失效。
//   段深度只依赖世界坐标 + 相机旋转（与 pan/zoom 无关）。消费方：本文件道路收集、
//   render_world.js::updateLaneHover（悬浮检测复用同缓存世界采样，window.LaneGeoCache 暴露）。
const _laneGeoCache = new WeakMap();
window.LaneGeoCache = _laneGeoCache;

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

  // ★ 全量 WebGL：地形格与边界侧壁不再入队（terrain-renderer.js GL 层承担，
  //   含沙盘侧壁 skirt 与天幕 clear 背景）。地形壳层投影由 drawTerrainShell 提供。

  // ── 2. 水系特征 / 水粒子 / 游鱼 ──
  //   ★ v1.61.4：River / WaterBody 水面**不入队、不绘制**——水面唯一来源是
  //   water_particles.js 的粒子层（紧随下方逐条入队）；本段只收集非水面特征：
  //   RiverBank 岸线逐段描边、ShallowFord 涉渡挂所在河段深度 + ε、泉谷等整条入队。
  if (hasTerrain) {
    const features = terrain.features || [];
    const nowMs = performance.now();
    if (features.length && window.RiverLife) window.RiverLife.update(nowMs);
    if (features.length && window.WaterParticles) window.WaterParticles.update(nowMs);
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
      // ★ v1.61.4：River / WaterBody 无任何多边形水面 ⇒ 恒不入队（水面 = 粒子层）
      if (f.kind === 'River' || f.kind === 'WaterBody') continue;
      if (f.kind === 'RiverBank') {
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
    // 动态水粒子逐条入队：使用粒子自身的水位深度，保持近岸实体的遮挡关系。
    // ★ v1.62.0：粒子位置来自**内核 PBF 求解器**（快照 Fluid section），前端只渲染；
    //   入队端按屏幕 AABB（粒径外扩）先剔屏外粒子——排序与绘制的规模只与可见粒子相关。
    if (window.WaterParticles) {
      const particles = window.WaterParticles.particles();
      if (particles) {
        for (let pi = 0; pi < particles.length; pi++) {
          const p = particles[pi];
          if (!p.active) continue;
          const prx = p.x * cosZ - p.y * sinZ;
          const pry = (p.x * sinZ + p.y * cosZ) * cosX - p.z * sinX;
          const spx = cx + prx * scale;
          const spy = cy + pry * scale;
          const rpx = (p.rWorld || 3) * scale + 24;
          if (spx < -rpx || spx > w + rpx || spy < -rpx || spy > h + rpx) continue;
          _depthItem(DEPTH_WATER_PARTICLE, p, 0, depthOf(p.x, p.y, p.z));
        }
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
  }

  // ── 3. 道路（每段一个深度项；虚线相位按累计弧长跨段连续）──
  // ★ v1.50.88 车道绘制性能修复（128x 倍速 10fps 根因）：踩踏路网车道数随模拟时间单调
  //   增长（128x 下数分钟即 600+ 条），旧实现每帧对每条车道全量执行 17 次 curve.evalPos
  //   + 80 次 _decalDepth（600 条 = 每帧 4.8 万次深度查询）→ wqe 26ms+ 且持续恶化。
  //   三层解耦（画面笔迹逐位不变）：
  //   ① 世界采样点缓存——lane.curve 与世界几何静态（增量快照只覆写 wear，rustworld
  //     geom_version 变更时重建 lane 对象），17 点按 lane 对象 WeakMap 弱缓存自然失效；
  //   ② 段深度缓存——_decalDepth 只依赖世界坐标 + 相机旋转（与 pan/zoom 无关），
  //     每段 5 采样取大结果按旋转键缓存，平移/缩放零重算；
  //   ③ 屏幕投影逐帧由缓存世界点廉价线性变换 + 屏幕 AABB 粗剔——屏外车道零成本；
  //   ④ 自适应分段：屏幕弧长短的车道 8 段（偶数采样点合并，段深取双子段较大值）。
  if (sim.showLanes && sim.network && sim.network.lanes) {
    const cullPad = RC.laneCullPadPx !== undefined ? RC.laneCullPadPx : 16;
    const shortSegPx = RC.laneAdaptiveSegPx !== undefined ? RC.laneAdaptiveSegPx : 140;
    for (const lane of sim.network.lanes.values()) {
      const wear = lane.wear || 0.0;
      if (wear < 0.3) continue;

      // ①/② 静态几何采样 + 旋转相关段深度（WeakMap：geom_version 变更重建 lane 对象 → 自然失效）
      let geo = _laneGeoCache.get(lane);
      if (!geo) {
        geo = { wx: new Float64Array(17), wy: new Float64Array(17), wz: new Float64Array(17),
                depth: new Float64Array(16), kz: 0, kz2: 0, kx: 0, kx2: 0 };
        for (let i = 0; i <= 16; i++) {
          const pt3D = lane.curve.evalPos(i / 16);
          geo.wx[i] = pt3D.x; geo.wy[i] = pt3D.y; geo.wz[i] = pt3D.z || 0;
        }
        _laneGeoCache.set(lane, geo);
      }
      if (geo.kz !== cosZ || geo.kz2 !== sinZ || geo.kx !== cosX || geo.kx2 !== sinX) {
        for (let k = 0; k < 16; k++) {
          let segDepth = -Infinity;
          for (let s = 0; s <= 4; s++) {
            const f = s * 0.25;
            const wx = geo.wx[k] + (geo.wx[k + 1] - geo.wx[k]) * f;
            const wy = geo.wy[k] + (geo.wy[k + 1] - geo.wy[k]) * f;
            const wz = geo.wz[k] + (geo.wz[k + 1] - geo.wz[k]) * f;
            const dd = _decalDepth(wx, wy, RC.laneFootprintR || 6, cosZ, sinZ, cosX, sinX);
            const d = dd != null ? dd : _surfaceDepth(wx, wy, wz, cosZ, sinZ, cosX, sinX);
            if (d > segDepth) segDepth = d;
          }
          geo.depth[k] = segDepth;
        }
        geo.kz = cosZ; geo.kz2 = sinZ; geo.kx = cosX; geo.kx2 = sinX;
      }

      // ③ 逐帧投影（廉价线性变换）+ 屏幕 AABB 粗剔（屏外车道跳过样式/入队，零绘制成本）
      _ensureLaneBuf(17);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i <= 16; i++) {
        const rx = geo.wx[i] * cosZ - geo.wy[i] * sinZ;
        const ry = geo.wx[i] * sinZ + geo.wy[i] * cosZ;
        const y2 = ry * cosX - geo.wz[i] * sinX;
        const px = cx + rx * scale, py = cy + y2 * scale;
        _lanePX[i] = px; _lanePY[i] = py;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      if (maxX < -cullPad || minX > w + cullPad || maxY < -cullPad || minY > h + cullPad) continue;

      // 屏幕累计弧长（虚线相位；由投影自然覆盖旋转/缩放变化）
      let cum = 0, prevX = _lanePX[0], prevY = _lanePY[0];
      for (let i = 1; i <= 16; i++) {
        cum += Math.hypot(_lanePX[i] - prevX, _lanePY[i] - prevY);
        prevX = _lanePX[i]; prevY = _lanePY[i];
        _laneCum[i] = cum;
      }

      cacheLaneStyle(lane, wear);

      // ④ 自适应分段：屏幕弧长短的车道 8 段（偶数采样点），段深取双子段缓存值较大者
      const short = shortSegPx > 0 && cum < shortSegPx;
      const segs = short ? 8 : 16;
      const step = short ? 2 : 1;
      for (let k = 0; k < segs; k++) {
        const i0 = k * step, i1 = i0 + step;
        let segDepth;
        if (short) {
          const dA = geo.depth[i0], dB = geo.depth[i1];
          segDepth = dA > dB ? dA : dB;
        } else {
          segDepth = geo.depth[k];
        }
        const it = _depthItem(DEPTH_LANE, lane, k, segDepth);
        it.s1x = _lanePX[i0]; it.s1y = _lanePY[i0];
        it.s2x = _lanePX[i1]; it.s2y = _lanePY[i1];
        it.dash = _laneCum[i0];
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
  // ── 6.5 树/灌木贴地投影：已删除（★ 全量 WebGL）──
  //   落底阴影由 webgl/layers/accents/shadow-pass.js 世界空间代理几何 + 光向深度图承担，
  //   terrain-renderer.js 片元采样变暗；2D 手绘阴影通道（原 render_shadows.js）已移除。

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
    switch (it.kind) {
      case DEPTH_FEATURE: drawFeatureItem(it.a, it.b); break;
      case DEPTH_WATER_PARTICLE:
        window.WaterParticles.drawParticle(ctx, it.a, cx, cy, cosZ, sinZ, cosX, sinX, scale);
        break;
      case DEPTH_FISH: RL.drawFishSingle(ctx, it.a, cx, cy, cosZ, sinZ, cosX, sinX, scale); break;
      case DEPTH_LANE: drawLaneSegment(it); break;
      case DEPTH_LINK: drawCampHouseLink(it); break;
      case DEPTH_POI_BASE: drawPoiGroundBase(it.a); break;
      case DEPTH_POI: drawPoiMarker(it.a); break;
      case DEPTH_HOUSE: drawHouse(it.a); break;
      // ★ TA-07-6：装饰/景观把深度项整体传给绘制端（消费入队端 AABB 与锚点屏幕坐标）
      case DEPTH_ACCENT: drawAccentEntity(it.a, it); break;
      case DEPTH_LANDSCAPE: drawLandscapeChild(it.a, it); break;
      default: drawAgent(it.a);
    }
  }

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
