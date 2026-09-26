# 18. 水系河岸平滑化与写意微缩沙盘水体改造方案 (River & Shoreline Refinement Plan)

> **状态**：★ **已实现**——Rust 内核水体边界与水池状态打通，前端由确定性粒子水面渲染；静态矢量轮廓仅用于粒子初始化。v1.50.x 的统一相机深度队列仍负责粒子、岸线和实体排序。零网格细分、确定性门禁全通。
> **范围**：消除河岸 13 米级网格阶梯锯齿、连续矢量水面、湿砂漫滩过渡带、涉渡卵石踏道、水底游鱼生态层、地形格间抗锯齿缝隙补偿、边界侧壁深度排序；加入由降雨补给驱动的水面覆盖率与水位表现；**不改动**寻路阻挡判定、不增加全局网格细分，保持确定性。（★ v1.50.86 迎光面太阳波光已删除、游鱼迁 WebGL——见 §1.4。）
> **入口**：[文档导航](../../README.md) · [地形美术规划](../../plan/tech/07-terrain-art.md) · [地形专项方案](../../plan/tech/06-terrain-templates.md) · [前端渲染现状](./16-frontend-overview.md)。

---

## 状态机

水系渲染元素不再按固定 Pass 先后硬编码，而是由 `render_world.js` 统一相机深度队列按 `project3D().depth = ry·sinX + z·cosX` **升序（远 → 近）落笔**调度；水系相关的深度档位如下（其间穿插道路 / 营地连线 / POI / 房屋 / 族人等档位）：

| 深度档 | 渲染元素 | 绘制函数（`frontend/js`） | 说明 |
| :--- | :--- | :--- | :--- |
| 1 · `DEPTH_FEATURE` | 水系特征：River 水面 / RiverBank 漫滩 / ShallowFord 涉渡 / 泉谷 | `render_terrain.js::drawFeatureItem` / `drawRiverBand` | River / RiverBank **按段入队**（v1.50.20）；ShallowFord 等短特征整条绘制 |
| 2 · `DEPTH_FISH` | 游鱼（水中层） | `river_life.js::drawFishSingle` 逐条入队 | 鱼 z 在水面下（水中层），按深度先于半透明水面填充，透过水面可见；★ v1.50.86 起 GL sink 分发进 `WebGLAccentLayer`（★ v1.60.1 sink 硬门槛：GL 未就绪帧整只跳过；2D 水面仍盖绘其上，透水观感不变） |

> ★ **v1.60.1 深度档删减**：`DEPTH_CELL`（地形格）与 `DEPTH_WALL`（边界侧壁）随 Canvas 地形/侧壁通道删除——地形与侧壁改由 WebGL 地形层直绘并参与 GPU 深度测试，水系/游鱼深度档照旧。

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

### 1.3 粒子水面（`water_particles.js`，替代固定矢量填充）

- 内核 `hydrology.rs::generate_river` 生成的闭合轮廓只作为粒子边界和河流中心线采样源，不再直接填充固定水面。
- `water_particles.js` 为每条河生成确定性粒子：粒子沿中心线推进，在法向按河宽分布；湖泊粒子在闭合水体内漂移并在边界反弹。
- `coverage` 控制活跃粒子数量与横向扩散，`flow_strength` 控制漂移速度，`level` 控制粒子高度。粒子进入统一深度队列，并通过 `WebGLAccentLayer` 的 GPU 图元绘制。
- 粒子数量有每水体和全图上限，初始化使用独立确定性 PRNG，不消耗 `WorldRng`；运行时使用固定 `1/60` 步长。

### 1.4 水底生态层（`river_life.js`，纯表现层）

- **游鱼**：≤24 条（4 色盘：锦鲤赤金/金鲤明黄/青黑溪斑/白练银鱼），沿河道中心线插值巡航（基于左右岸顶点序列中点切线推进），正弦摆尾扰动，大部分顺流、少部分逆流；**走墙钟**（模拟暂停仍游动，属写意微缩沙盘环境生命感设计，与水面动画一致）。v1.50.11 起逐条入深度队列（`drawFishSingle`），深度低于水面。
- **★ v1.50.86 游鱼迁 WebGL（31 号阶段三切片）**：`drawFishSingle` 把四笔图元（水底影子 / 鱼身梭形 / 背光高线 / 两瓣尾鳍）按 Canvas 同序同配色经 sink 分发进 `WebGLAccentLayer`——鱼身在底层 GL 画布、2D 半透明水面随后盖绘，透水观感不变；配色单一数值源 `FISH_PALETTES`（Canvas rgba 串与 GL 数值通道同源派生）；★ v1.60.1 起 **sink 硬门槛**：GL 层未就绪的帧整只跳过绘制（Canvas 备用通道已删）。
- **确定性**：世界重置/读档随 `_engineSeed` 重建（`rustworld.js` 地形重建钩子 `RiverLife.init(nextFeatures, this._engineSeed)`），不进存档、不消耗 WorldRng、不写模拟状态。
- **动态水面**：FABS `WATER_DYNAMICS`（Section 23）每帧下发共享水池的 `coverage`、`level` 与 `flow_strength`。`render_terrain.js` 用覆盖率缩放水面轮廓并调节透明度，WebGL 地表材质把 `water_body_id` 格从水色渐变到河床色；静态地形格的通行和建造语义保持不变。
- ⚠️ **已按观感降噪原则移除、勿复活**：水底卵石层与河床基底（v1.50.4 / v1.50.5）、中心微波虚线（v1.50.3）、深浅水色纵深带（v1.50.6）、岸线微沫与顺流碎沫段（v1.50.3 / v1.50.4）、**迎光面太阳波光（v1.50.86，用户决策删除）**。

### 1.5 涉渡点（`ShallowFord`，`render_terrain.js::drawFeatureItem`）

水下卵石踏道：先铺暖砂色基底宽线（`rgba(196, 178, 136, 0.88)`，线宽 `max(6, feature.width * scale * 0.22)`），再叠加稀疏虚线踏石微光（`rgba(255, 252, 240, 0.90)`，`lineDash` 随 scale 缩放）。

### 1.6 地形格间抗锯齿缝隙补偿（历史注记）

相邻 Quad 共享边在 Canvas2D 抗锯齿下各自只覆盖约一半像素，叠加后留约 25% 透光率，深色背景会从缝隙透出 1px 网格线。方案：四条边各自沿外法线平移 `TERRAIN_SEAM_PX = 0.75` 像素使相邻格互相重叠；法线方向由固定旋向 `(ey, -ex)/l` 确定，用质心方向判定指向「外」侧，沿边方向的分量只让边滑动、不改变覆盖宽度。★ **v1.60.1 失效**：Canvas 逐格填充随 WebGL 地形层删除，GL 栅格化无此问题，勿在 2D 侧复活。

### 1.7 边界侧壁深度排序（★ v1.60.1 历史化）

- v1.50.14~v1.60.0 侧壁曾按**边界格分段**入统一深度队列（`DEPTH_WALL=11`，`render_terrain.js::drawBoundaryWallSeg`），每段深度 = 该段上沿两端顶点深度的**较大值**（较近端）。★ v1.60.1 起侧壁由 WebGL 地形层顶点绘制并参与 GPU 深度测试，`DEPTH_WALL` 与 `drawBoundaryWallSeg` 已删除，「侧壁盖住贴边笔迹」由深度缓冲天然保证。
- 基准色 `BOUNDARY_WALL_BASE = '#5A5043'`，外法线参与季节光照（`SimLighting.shadeFace`）。
- 历史教训（勿回退）：v1.48.2 曾按整墙中点 `ry` 在壳层排序，但侧壁仍整墙先行栅格化，永远盖不住任何贴边实体。

---

## 2. 硬约束与设计原则

1. **严禁全局细分网格（Zero Grid Subdivisions）**：网格分辨率由 `SIM_CONFIG.terrainGridRes` 配置（现网 256×256，v1.50.70 由 160×160 提升），任何锯齿修复必须在固定网格上用分层矢量覆盖解决，不得提升网格分辨率（顶点投影与 Quad 遍历开销随分辨率平方增长）。
2. **零运行时 GC 分配（Zero-GC Frame Budget）**：前端投影顶点缓冲静态预分配、深度项对象池复用，禁止在 `render()` 循环内产生对象分配或多余闭包。
3. **确定性与存档绝对一致（Deterministic & Save-Safe）**：水体边界由创世种子生成；粒子初始化使用 `_engineSeed` 和独立 PRNG，更新使用固定步长；降雨和共享水池状态由内核确定性演化，并通过每帧动态 section 投影到渲染层。视觉变化**不改变** `biome.rs` 中 `SurfaceKind::DeepWater` 对部落民移动的物理阻挡判定；粒子表现层不进存档，随世界重建，不影响确定性。

---

## 3. 代码地图（改代码入口）

| 层 | 文件 | 关键点 | 职责 |
| :--- | :--- | :--- | :--- |
| Rust 内核 | [`geo/hydrology.rs`](../../../crates/sim_core/src/geo/hydrology.rs) | `generate_river` | 生成 `TerrainFeatureKind::River`（194 顶点闭合 outline）/ `RiverBank`（左右岸线，id:20+i）/ `ShallowFord`（id:10+i）/ `SpringValley`（id:30）并压入 `self.features` |
| Rust 内核 | [`spatial/snapshot_bin/dict.rs`](../../../crates/sim_core/src/spatial/snapshot_bin/dict.rs) | `feature_kind_code` | `TerrainFeatureKind::River` 枚举码位与 FABS 表格一一对应（防漂移）；新增枚举变体须同步 `*_code()` / `*_table()` |
| 前端 | [`js/render_world.js`](../../../frontend/js/render_world.js) | 深度队列（`DEPTH_FEATURE/FISH/…`，在 render_depth_queue.js；★ v1.60.1 起 DEPTH_CELL/DEPTH_WALL 已删） | 统一按 `project3D().depth` 升序落笔；深度项对象池零 GC；收集阶段决定各元素入队深度 |
| 前端 | [`js/render_terrain.js`](../../../frontend/js/render_terrain.js) | `drawFeatureItem` / `drawRiverBand`（★ v1.60.1 起 `drawBoundaryWallSeg`/`TERRAIN_SEAM_PX` 已删） | 水系特征分段绘制（地形格/侧壁已迁 GL 层） |
| 前端 | [`js/water_particles.js`](../../../frontend/js/water_particles.js) | `WaterParticles.init` / `update` / `drawParticle` | 河流与湖泊粒子初始化、固定步长推进和 GPU/Canvas 绘制 |
| 前端 | [`js/river_life.js`](../../../frontend/js/river_life.js) | `RiverLife.init` / `drawFishSingle`（GL sink 硬门槛） | 游鱼（纯表现层，走墙钟，`_engineSeed` 确定性重建） |
| 前端 | [`js/rustworld.js`](../../../frontend/js/rustworld.js) | 地形重建钩子 | 地形重建时以 `_engineSeed` 初始化 `RiverLife`（世界重置/读档后卵石鱼群分布确定性一致） |
| 前端 | [`js/math.js`](../../../frontend/js/math.js) | `computeTerrainAlbedo` | 水格暖棕底模色（§1.1 色值），避免缝隙渗色与亮蓝阶梯 |
| 前端 | [`index.html`](../../../frontend/index.html) | 脚本登记 | `river_life.js` 须早于 `render_world.js` 加载 |

---

## 4. 性能约束

- 基础地形网格（120×120）顶点投影与 Quad 绘制为基准成本；水系装饰层只增加 Canvas 2D 填充/描边（矢量水面两遍填充 + 漫滩带 + 游鱼逐条），单帧耗时增量 **+0.05ms ~ +0.12ms** 量级，完全在 30~60 FPS 渲染预算内。
- **每帧堆内存 GC 分配 = 0 字节**：投影点全量复用模块顶层 `TypedArray`，RiverLife 静态对象零分配，深度队列走对象池，无垃圾回收。
- 回归门禁：`node tools/test-wasm.js`（同种子确定性 + 存读档）、`node tools/frontend-check.js`（脚本语法与 DOM 完整性）、`node tools/profile-benchmark.js`（帧率无衰退）。
