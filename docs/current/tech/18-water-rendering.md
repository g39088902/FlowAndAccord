# 18. 水系河岸平滑化与写意微缩沙盘水体改造方案 (River & Shoreline Refinement Plan)

> **状态**：★ **已实现**——Rust 内核水体矢量多边形打通、前端水景渲染落地（v1.49.0），v1.50.x 演进为**统一相机深度队列 + 特征逐段绘制**（v1.50.11 / v1.50.14 / v1.50.20）。零网格细分、零 GC、确定性门禁全通。
> **范围**：消除河岸 13 米级网格阶梯锯齿、连续矢量水面、湿砂漫滩过渡带、涉渡卵石踏道、水底游鱼生态层、地形格间抗锯齿缝隙补偿、边界侧壁深度排序；**不改动**宏观水库逻辑、不改动寻路阻挡判定、不增加全局网格细分，保持零 GC 与确定性。（★ v1.50.86 迎光面太阳波光已删除、游鱼迁 WebGL——见 §1.4。）
> **入口**：[文档导航](../../README.md) · [地形美术规划](../../plan/tech/07-terrain-art.md) · [地形专项方案](../../plan/tech/06-terrain-templates.md) · [前端渲染现状](./16-frontend-overview.md)。

---

## 状态机

水系渲染元素不再按固定 Pass 先后硬编码，而是由 `render_world.js` 统一相机深度队列按 `project3D().depth = ry·sinX + z·cosX` **升序（远 → 近）落笔**调度；水系相关的深度档位如下（其间穿插道路 / 营地连线 / POI / 房屋 / 族人等档位）：

| 深度档 | 渲染元素 | 绘制函数（`frontend/js`） | 说明 |
| :--- | :--- | :--- | :--- |
| 0 · `DEPTH_CELL` | 地形格（含水下底模色） | `render_terrain.js` 地形格绘制 | 四边外法线平移 `TERRAIN_SEAM_PX=0.75` 补偿缝隙 |
| 1 · `DEPTH_FEATURE` | 水系特征：River 水面 / RiverBank 漫滩 / ShallowFord 涉渡 / 泉谷 | `render_terrain.js::drawFeatureItem` / `drawRiverBand` | River / RiverBank **按段入队**（v1.50.20）；ShallowFord 等短特征整条绘制 |
| 2 · `DEPTH_FISH` | 游鱼（水中层） | `river_life.js::drawFishSingle` 逐条入队 | 鱼 z 在水面下（水中层），按深度先于半透明水面填充，透过水面可见；★ v1.50.86 起 GL 地形活动时经 sink 分发进 `WebGLAccentLayer`（2D 水面仍盖绘其上，透水观感不变） |
| 11 · `DEPTH_WALL` | 边界侧壁分段 | `render_terrain.js::drawBoundaryWallSeg` | 每段深度 = 段上沿两端顶点深度的较大值（较近端），贴边实体底座会被正确盖住 |

**不变量**（违反即出 bug）：
- **严禁全局细分网格（Zero Grid Subdivisions）**：在固定物理网格上用分层矢量覆盖解决锯齿，不得提升网格分辨率（现网 `SIM_CONFIG.terrainGridRes = 256×256`，步长 ≈2.996m；v1.50.70 由 160×160 提升）。
- **零运行时 GC 分配**：投影顶点缓冲静态预分配（`Float32Array`）+ `render_world.js` 深度项对象池，`render()` 循环内禁止对象分配，帧耗时增量 ≤ 0.08ms。
- **观感降噪铁律**：凡「沿中心线/岸线走线、笔宽/间距与河宽成比例」的元素在窄河道退化成车道线，只有面状（水面填充/地表格色）与点状/小尺度（游鱼）元素才能稳定成立。

## 1. 当前渲染机制

### 1.1 网格底模（`math.js::computeTerrainAlbedo`）

水格底色用**暖棕河床土色**（非亮蓝），透过半透明水面呈现湿润泥土暖调，消除亮色直角阶梯：

| 地表类型 | 当前色值 |
| :--- | :--- |
| `ShallowWater` | `rgb(142, 122, 96)` |
| `DeepWater` | `rgb(120, 100, 76)` |
| `RiverBank` | `rgb(148, 138, 114)` |

**选色经验**：水下格亮度应向 `RiverBank` 湿砂色靠拢而不是向「幽深」靠拢——**色阶反差才是锯齿的来源**；纵深对比交给深浅两档水格之间的差异。

### 1.2 湿砂漫滩带（`RiverBank`，`render_terrain.js::drawFeatureItem`）

- Rust 侧生成左右岸线特征（`hydrology.rs` id:20+i，`width` = 内核 `bank` 参数），前端以半透明土褐细带沿岸线描边（`rgba(174, 137, 78, 0.24)`，线宽 `max(2, feature.width * scale * 0.06)`），盖住陆水交界处的方块锯齿。
- v1.50.20 起 RiverBank 同 River 按段入深度队列（`idx` = 段号）。

### 1.3 矢量水面（`River`，`render_terrain.js::drawRiverBand`）

- 内核 `hydrology.rs::generate_river` 以 97 点左岸线 + 97 点右岸线逆序闭合生成 **194 顶点** `TerrainFeatureKind::River` 轮廓（顶点 `i` 与 `vLen-1-i` 为同一剖分断面的左右岸点），作为静态地貌特征随地形快照第 0 帧下发一次，后续 Tick 零通信。
- 前端两遍填充：底层深潭 `rgba(28, 82, 116, 0.25)`（水深纵深感）+ 主流水体 `rgba(54, 158, 202, 0.62)`（清澈透亮的碧蓝，水底游鱼清晰可辨）。
- **★ v1.50.20 分段绘制**：整条河以「全顶点最大深度」入队会盖住所有更远的实体，故 River / RiverBank 按段入队。段 b 的四边形 = `(v[b], v[b+1], v[vLen-2-b], v[vLen-1-b])`；绘制时 **clip 到该段四边形内、再整多边形两遍填充**——硬 clip 使逐像素唯一归属一段，相邻段无接缝、无半透明叠 blend，观感与整河单次填充一致；段外的更近地形/实体照常遮挡该段。

### 1.4 水底生态层（`river_life.js`，纯表现层）

- **游鱼**：≤24 条（4 色盘：锦鲤赤金/金鲤明黄/青黑溪斑/白练银鱼），沿河道中心线插值巡航（基于左右岸顶点序列中点切线推进），正弦摆尾扰动，大部分顺流、少部分逆流；**走墙钟**（模拟暂停仍游动，属写意微缩沙盘环境生命感设计，与水面动画一致）。v1.50.11 起逐条入深度队列（`drawFishSingle`），深度低于水面。
- **★ v1.50.86 游鱼迁 WebGL（31 号阶段三切片）**：GL 地形活动时 `drawFishSingle` 把四笔图元（水底影子 / 鱼身梭形 / 背光高线 / 两瓣尾鳍）按 Canvas 同序同配色经 sink 分发进 `WebGLAccentLayer`——鱼身在底层 GL 画布、2D 半透明水面随后盖绘，透水观感与 Canvas 回退路径一致；配色单一数值源 `FISH_PALETTES`（Canvas rgba 串与 GL 数值通道同源派生）；`?accentgl=0` 完整回退 Canvas 现状笔迹。
- **确定性**：世界重置/读档随 `_engineSeed` 重建（`rustworld.js` 地形重建钩子 `RiverLife.init(nextFeatures, this._engineSeed)`），不进存档、不消耗 WorldRng、不写模拟状态。
- ⚠️ **已按观感降噪原则移除、勿复活**：水底卵石层与河床基底（v1.50.4 / v1.50.5）、中心微波虚线（v1.50.3）、深浅水色纵深带（v1.50.6）、岸线微沫与顺流碎沫段（v1.50.3 / v1.50.4）、**迎光面太阳波光（v1.50.86，用户决策删除）**。

### 1.5 涉渡点（`ShallowFord`，`render_terrain.js::drawFeatureItem`）

水下卵石踏道：先铺暖砂色基底宽线（`rgba(196, 178, 136, 0.88)`，线宽 `max(6, feature.width * scale * 0.22)`），再叠加稀疏虚线踏石微光（`rgba(255, 252, 240, 0.90)`，`lineDash` 随 scale 缩放）。

### 1.6 地形格间抗锯齿缝隙补偿（`render_terrain.js`）

相邻 Quad 共享边在 Canvas2D 抗锯齿下各自只覆盖约一半像素，叠加后留约 25% 透光率，深色背景会从缝隙透出 1px 网格线。方案：四条边各自沿外法线平移 `TERRAIN_SEAM_PX = 0.75` 像素使相邻格互相重叠；法线方向由固定旋向 `(ey, -ex)/l` 确定，用质心方向判定指向「外」侧，沿边方向的分量只让边滑动、不改变覆盖宽度。

### 1.7 边界侧壁深度排序（`render_terrain.js::drawBoundaryWallSeg`）

- v1.50.14 起侧壁按**边界格分段**入统一深度队列（`DEPTH_WALL=11`），每段深度 = 该段上沿两端顶点深度的**较大值**（较近端）——侧壁是地图边界上最靠近相机的几何，贴边实体底座/圆环伸过边界线的部分会被正确盖住；远离边界的实体与侧壁屏幕区域不相交，不受影响。
- 基准色 `BOUNDARY_WALL_BASE = '#5A5043'`，外法线参与季节光照（`SimLighting.shadeFace`）。
- 历史教训（勿回退）：v1.48.2 曾按整墙中点 `ry` 在壳层排序，但侧壁仍整墙先行栅格化，永远盖不住任何贴边实体。

---

## 2. 硬约束与设计原则

1. **严禁全局细分网格（Zero Grid Subdivisions）**：网格分辨率由 `SIM_CONFIG.terrainGridRes` 配置（现网 256×256，v1.50.70 由 160×160 提升），任何锯齿修复必须在固定网格上用分层矢量覆盖解决，不得提升网格分辨率（顶点投影与 Quad 遍历开销随分辨率平方增长）。
2. **零运行时 GC 分配（Zero-GC Frame Budget）**：前端投影顶点缓冲静态预分配、深度项对象池复用，禁止在 `render()` 循环内产生对象分配或多余闭包。
3. **确定性与存档绝对一致（Deterministic & Save-Safe）**：水体与岸线矢量几何属于静态地貌特征，由创世种子纯函数生成，仅在第 0 帧随地形下发一次；视觉平滑化改造只属于渲染呈现层，**不改变** `biome.rs` 中 `SurfaceKind::DeepWater` 对部落民移动的物理阻挡判定；RiverLife 纯表现层不进存档，随 `_engineSeed` 重建，不影响确定性。

---

## 3. 代码地图（改代码入口）

| 层 | 文件 | 关键点 | 职责 |
| :--- | :--- | :--- | :--- |
| Rust 内核 | [`geo/hydrology.rs`](../../../crates/sim_core/src/geo/hydrology.rs) | `generate_river` | 生成 `TerrainFeatureKind::River`（194 顶点闭合 outline）/ `RiverBank`（左右岸线，id:20+i）/ `ShallowFord`（id:10+i）/ `SpringValley`（id:30）并压入 `self.features` |
| Rust 内核 | [`spatial/snapshot_bin/dict.rs`](../../../crates/sim_core/src/spatial/snapshot_bin/dict.rs) | `feature_kind_code` | `TerrainFeatureKind::River` 枚举码位与 FABS 表格一一对应（防漂移）；新增枚举变体须同步 `*_code()` / `*_table()` |
| 前端 | [`js/render_world.js`](../../../frontend/js/render_world.js) | 深度队列（`DEPTH_CELL/FEATURE/FISH/…/WALL`，在 render_depth_queue.js） | 统一按 `project3D().depth` 升序落笔；深度项对象池零 GC；收集阶段决定各元素入队深度 |
| 前端 | [`js/render_terrain.js`](../../../frontend/js/render_terrain.js) | `drawFeatureItem` / `drawRiverBand` / `drawBoundaryWallSeg` / `TERRAIN_SEAM_PX` | 水系特征分段绘制、地形格缝隙补偿、边界侧壁分段绘制 |
| 前端 | [`js/river_life.js`](../../../frontend/js/river_life.js) | `RiverLife.init` / `drawFishSingle`（Canvas + WebGL sink 双路） | 游鱼（纯表现层，走墙钟，`_engineSeed` 确定性重建） |
| 前端 | [`js/rustworld.js`](../../../frontend/js/rustworld.js) | 地形重建钩子 | 地形重建时以 `_engineSeed` 初始化 `RiverLife`（世界重置/读档后卵石鱼群分布确定性一致） |
| 前端 | [`js/math.js`](../../../frontend/js/math.js) | `computeTerrainAlbedo` | 水格暖棕底模色（§1.1 色值），避免缝隙渗色与亮蓝阶梯 |
| 前端 | [`index.html`](../../../frontend/index.html) | 脚本登记 | `river_life.js` 须早于 `render_world.js` 加载 |

---

## 4. 性能约束

- 基础地形网格（120×120）顶点投影与 Quad 绘制为基准成本；水系装饰层只增加 Canvas 2D 填充/描边（矢量水面两遍填充 + 漫滩带 + 游鱼逐条），单帧耗时增量 **+0.05ms ~ +0.12ms** 量级，完全在 30~60 FPS 渲染预算内。
- **每帧堆内存 GC 分配 = 0 字节**：投影点全量复用模块顶层 `TypedArray`，RiverLife 静态对象零分配，深度队列走对象池，无垃圾回收。
- 回归门禁：`node tools/test-wasm.js`（同种子确定性 + 存读档）、`node tools/frontend-check.js`（脚本语法与 DOM 完整性）、`node tools/profile-benchmark.js`（帧率无衰退）。
