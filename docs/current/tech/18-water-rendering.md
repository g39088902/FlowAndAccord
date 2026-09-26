# 18. 静态湖泊水面渲染 (Static Lake Water Rendering)

> **状态**：★ **已实现（v1.62.0 收敛为静湖专章）**——地图上唯一的水面是模板专有的**静态湖泊**（`WaterBody`），由 2D 统一相机深度队列绘制；湖面覆盖率与水位来自内核每帧下发的 `WATER_DYNAMICS` 动态 section。湖泊几何由创世种子确定性生成，仅作表现、不改变寻路阻挡判定。
> **范围**：静湖水面分块绘制、动态水位/覆盖率表现、浅滩涉渡与河谷峭壁等短特征描边、水格底色；**不含**任何河流/支流/漫滩矢量水面、粒子水面与游鱼。"静态湖泊 + 生存取水链"是唯一保留的地图水系统。
> **入口**：[文档导航](../../README.md) · [地形美术规划](../../plan/tech/07-terrain-art.md) · [地形专项方案](../../plan/tech/06-terrain-templates.md) · [前端渲染现状](./16-frontend-overview.md)。

---

## 状态机

静湖渲染元素按 `render_depth_queue.js::drawWorldEntities()` 统一相机深度队列的 `depth = ry·sinX + z·cosX` **升序（远 → 近）落笔**调度；水相关深度档位如下（其间穿插道路 / 营地连线 / POI / 房屋 / 族人等档位）：

| 深度档 | 渲染元素 | 绘制函数（`frontend/js`） | 说明 |
| :--- | :--- | :--- | :--- |
| 1 · `DEPTH_FEATURE` | 静态湖泊水面分块（`WaterBody`）/ 浅滩涉渡（`ShallowFord`）/ 河谷峭壁（`Cliff`）/ 泉谷（`SpringValley`） | `render_terrain.js::drawFeatureItem` / `drawWaterBodyTile` | 静湖按 **32m 分块入队**（`idx` = 块号 + 1），近岸人物/房屋不被整湖一项盖住；其余短特征整条绘制 |

> ★ **v1.62.0 删减**：地图河流水系统（River 蓄水/支流/汇流）、`RiverBank` 矢量漫滩、`water_particles.js` 粒子水面与 `river_life.js` 游鱼整条链路已删除，`DEPTH_FISH` 档位与 `drawRiverBand` 一并移除。★ **v1.60.1 深度档删减**：`DEPTH_CELL`（地形格）与 `DEPTH_WALL`（边界侧壁）随 Canvas 地形/侧壁通道删除——地形与侧壁改由 WebGL 地形层直绘并参与 GPU 深度测试。

**不变量**（违反即出 bug）：
- **严禁全局细分网格（Zero Grid Subdivisions）**：在固定物理网格上用分层矢量覆盖解决锯齿，不得提升网格分辨率（现网 `SIM_CONFIG.terrainGridRes = 256×256`，步长 ≈2.996m）。
- **零运行时 GC 分配**：投影顶点缓冲静态预分配（`Float32Array`）+ 深度项对象池，`render()` 循环内禁止对象分配。
- **表现不动物理**：湖面绘制不改变 `biome.rs` 中 `SurfaceKind::DeepWater`/`ShallowWater` 对部落民移动的阻挡判定，也不进存档。

## 1. 当前渲染机制

### 1.1 水格底色（`math.js::computeTerrainAlbedo`）

水格底模色为蓝色系——湖泊由 Field Compiler 只产出 `DeepWater` 语义格，若底色用土色会因缺少旧特征多边形而退化成棕色土格：

| 地表类型 | 当前底色 |
| :--- | :--- |
| `ShallowWater` | `rgb(70, 145, 178)` |
| `DeepWater` | `rgb(34, 102, 146)` |
| `RiverBank` | `rgb(148, 138, 114)`（枚举保留；地图河流水系统已不再生成该格） |

### 1.2 静湖水面分块（`render_terrain.js::drawWaterBodyTile`）

- 内核 `static_water.rs::apply_static_water` 把含水模板（`volcanic_lake_v1` / `mountain_pass_v1` / `basin_oasis_v1` / `plateau_v1`）的轮廓涂写为 `DeepWater` 格并登记 `WaterBody` 特征（闭合扰动椭圆，末点 = 首点）+ 水体归属 + 取水岸点。
- 前端由 `render_depth_queue.js` 收集段按顶点 AABB 推导 32m 分块网格（`WB_TILE_STEP`），每块以 `DEPTH_FEATURE` 入队，`idx` = 块号 + 1。
- `drawWaterBodyTile` 逐块 `clip` 到该块世界矩形内，再对整闭合多边形**两遍填充**（深水基底 `rgba(28, 82, 116, 0.25)` + 主水体 `rgba(54, 158, 202, 0.62)`）；硬 `clip` 保证逐像素归属唯一一块，无接缝、无半透明叠 blend。
- 分块参与统一深度排序 ⇒ 近岸人物与房屋不会被整湖一项盖住。

### 1.3 动态水位与覆盖率

- FABS `WATER_DYNAMICS`（Section 23）每帧下发共享水池的 `coverage`、`level`；`render_terrain.js::_projectDynamicWaterVertices` 用 `sqrt(coverage)` 缩放水面轮廓、`level - elevation` 抬升顶点，并把透明度按 `0.35 + coverage * 0.65` 调制。
- 静湖水位 = 干岸基准 − 1.2m（几何不随库存变化）；水量由 World 共享池维护，表现随库存升降而涨落。
- 缓存：分块网格缓存在特征对象上（`feature._wbTiles`），特征快照在网格重建/静态替换时整体换新对象，故缓存安全。

### 1.4 短特征描边（`render_terrain.js::drawFeatureItem`）

| kind | 处理 |
| :--- | :--- |
| `ShallowFord` | 浅滩涉渡：暖砂色基底宽线 `rgba(196, 178, 136, 0.88)` + 稀疏虚线踏石微光 `rgba(255, 252, 240, 0.90)`（`lineDash` 随 scale 缩放） |
| `Cliff` | 河谷峭壁（id=224）：崖顶折线 → 岩体阴影带 `rgba(96, 88, 80, 0.38)` + 崖缘暗线 `rgba(58, 52, 48, 0.55)`，仅可视化；禁行事实在内核 cells（`RockFace\|NO_WALK`） |
| `WaterBody` | 走 §1.2 分块绘制 |
| 其余（含 `SpringValley` 泉谷浅沟） | 柔和土褐细带 `rgba(174, 137, 78, 0.24)` |

> ⚠️ **已删除、勿复活**：River/RiverBank 矢量水面与 `drawRiverBand` 分段绘制、`water_particles.js` 粒子水面、`river_life.js` 游鱼、水底卵石层与河床基底、中心微波虚线、深浅水色纵深带、岸线微沫、迎光面太阳波光。整条地图河流水系统与地表湿润/地下水链一并移除（v1.62.0）。

---

## 2. 硬约束与设计原则

1. **严禁全局细分网格（Zero Grid Subdivisions）**：网格分辨率由 `SIM_CONFIG.terrainGridRes` 配置（现网 256×256），任何锯齿修复必须在固定网格上用分层矢量覆盖解决，不得提升网格分辨率。
2. **零运行时 GC 分配（Zero-GC Frame Budget）**：前端投影顶点缓冲静态预分配、深度项对象池复用，禁止在 `render()` 循环内产生对象分配或多余闭包。
3. **确定性与存档绝对一致（Deterministic & Save-Safe）**：湖泊几何由创世种子生成；水位与共享水池状态由内核确定性演化，并经每帧 `WATER_DYNAMICS` 投影到渲染层。视觉变化**不改变** `SurfaceKind::DeepWater` 对部落民移动的物理阻挡判定；湖面表现不进存档，随世界重建，不影响确定性。

---

## 3. 代码地图（改代码入口）

| 层 | 文件 | 关键点 | 职责 |
| :--- | :--- | :--- | :--- |
| Rust 内核 | [`geo/static_water.rs`](../../../crates/sim_core/src/geo/static_water.rs) | `StaticWaterPlan` / `apply_static_water` | 闭合扰动椭圆轮廓、cells 涂写 `DeepWater` + 水体归属 + 禁行禁建、`WaterBody` 特征/水体 #1 双副本登记、取水岸点 |
| Rust 内核 | [`geo/hydrology.rs`](../../../crates/sim_core/src/geo/hydrology.rs) | `WaterBody` / `WaterAccessPoint` | 静态湖泊几何与取水点（河网管线已删除） |
| Rust 内核 | [`geo/terrain.rs`](../../../crates/sim_core/src/geo/terrain.rs) | `TerrainFeatureKind` | 特征枚举（`WaterBody`/`ShallowFord`/`Cliff`/`SpringValley` 等）；`TERRAIN_GENERATOR_VERSION` 与特征生成流水线 |
| 前端 | [`js/render_depth_queue.js`](../../../frontend/js/render_depth_queue.js) | `drawWorldEntities()`（`DEPTH_FEATURE` 段） | 统一按 `project3D().depth` 升序落笔；静湖分块收集与入队；深度项对象池零 GC |
| 前端 | [`js/render_terrain.js`](../../../frontend/js/render_terrain.js) | `drawFeatureItem` / `drawWaterBodyTile` | 静湖水面分块绘制与短特征描边 |
| 前端 | [`js/rustworld.js`](../../../frontend/js/rustworld.js) | 地形重建钩子 / `WATER_DYNAMICS` 解码 | 世界重置/读档后重建静态地形与水池动态状态 |
| 前端 | [`js/math.js`](../../../frontend/js/math.js) | `computeTerrainAlbedo` | 水格蓝底模色（§1.1 色值），避免水体退化成棕土格 |

---

## 4. 性能约束

- 基础地形网格顶点投影为基准成本；静湖水面只增加 Canvas 2D 填充（分块 clip + 整多边形两遍填充）与短特征描边，单帧耗时增量 **+0.05ms ~ +0.12ms** 量级，完全在 30~60 FPS 渲染预算内。
- **每帧堆内存 GC 分配 = 0 字节**：投影点全量复用模块顶层 `TypedArray`，深度队列走对象池，无垃圾回收。
- 回归门禁：`node tools/test-wasm.js`（同种子确定性 + 存读档）、`node tools/frontend-check.js`（脚本语法与 DOM 完整性）、`node tools/profile-benchmark.js`（帧率无衰退）。