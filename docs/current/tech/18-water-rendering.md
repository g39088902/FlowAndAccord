# 18. 地图水面渲染（已删除）(Map Water Rendering)

> **状态**：★ **已删除（v1.62.1）**——地图不再渲染任何程序生成水面。v1.62.0 删除了地图河流水系统（河流/支流/漫滩）与粒子流体，保留了模板专有静态湖泊；v1.62.1 进一步删除了全部程序生成水面（水位求解、静态湖泊几何、水面语义投影），前端不再有水面分块绘制（`drawWaterBodyTile`）与动态水覆盖（`WaterBody`/`WATER_DYNAMICS` 表现）。地图上不再出现任何湖泊、水塘或水面格。
> **范围**：本文只记录「地图水渲染已移除」这一现状，以及世界中唯一保留的水语义（抽象的清泉 POI + 共享水池，按普通资源 POI 渲染）。**不含**任何水面几何、分块绘制、粒子水面或游鱼——这些均已删除。
> **入口**：[文档导航](../../README.md) · [前端渲染现状](./16-frontend-overview.md) · [地形与路网](./14-terrain-and-network.md) · [地形美术规划](../../plan/tech/07-terrain-art.md)。

---

## 状态机

地图深度队列（`render_depth_queue.js::drawWorldEntities()`）仍按 `depth = ry·sinX + z·cosX` **升序（远 → 近）**调度道路 / 营地连线 / POI / 房屋 / 族人 / 装饰等图元，但**不再有水体档位**：v1.62.0 删除了 `DEPTH_FISH`，v1.62.1 删除了 `WaterBody` 分块（`drawWaterBodyTile`）与 `WaterBody`/`ShallowFord` 特征分支。`DEPTH_FEATURE` 段仅剩少数短特征折线（`Cliff` 河谷峭壁、`SpringValley` 泉谷浅沟）由 `render_terrain.js::drawFeatureItem` 绘制。

**不变量**（违反即出 bug）：
- **严禁全局细分网格（Zero Grid Subdivisions）**：在固定物理网格上用分层矢量覆盖解决锯齿，不得提升网格分辨率（现网 `SIM_CONFIG.terrainGridRes = 256×256`，步长 ≈2.996m）。
- **零运行时 GC 分配**：投影顶点缓冲静态预分配（`Float32Array`）+ 深度项对象池，`render()` 循环内禁止对象分配。
- **表现不动物理**：渲染层不得改模拟状态、不得改变 `WorldRng` 消费顺序，也不进存档。

## 1. 现状：地图无水渲染

### 1.1 已删除的水渲染链路（勿复活）

| 元素 | 处理 |
| :--- | :--- |
| 静态湖泊水面分块（`WaterBody`） | ❌ v1.62.1 删除：`render_terrain.js::drawWaterBodyTile` 移除，`render_depth_queue.js` 不再收集/入队水体分块 |
| `WaterBody` / `ShallowFord` 特征分支 | ❌ v1.62.1 删除（`drawFeatureItem` 现仅处理 `Cliff` 与其余短特征） |
| 动态水覆盖（`waterBodyDynamics` / `_applyDynamicWaterCoverage` / `dynamicWaterRevision`） | ❌ v1.62.1 删除：`rustworld.js` 不再解码/维护水体动态状态，albedo 平滑改传全零水面掩码 |
| 河道/支流/漫滩矢量水面（`drawRiverBand`）、粒子水面、游鱼 | ❌ v1.62.0 删除（地图河流水系统 + `water_particles.js` + `river_life.js`） |

- 内核侧（v1.62.1）：水位求解（`water_level_solve`/`WaterBodyField`/`FloodNode`）、`geo/static_water.rs`、`geo/hydrology.rs::apply_profile_static_hydrology`、`geo/adapters/terrain_map.rs` 的水面投影全部删除；`procedural/hydrology.rs` 只剩 `project_semantics`（水体重置为空/零）。
- **词表惰性保留**：`SurfaceKind::{DeepWater,ShallowWater,RiverBank}`、`TerrainFeatureKind::WaterBody`、`GeoCell.water_body_id`、快照 `water_bodies` section 与 `terrain_cells[].water_body_id` 继续编码但**恒空**（FABS/存档结构不变，`snapshot-bin.js` 解码保留）。
- 水格底色（`math.js::computeTerrainAlbedo` 的 `ShallowWater`/`DeepWater` 蓝色）保留为惰性色，但创世不再产出水格，实际不再触发。

### 1.2 唯一保留的水语义：清泉 POI + 共享水池

世界中唯一的水是**抽象资源**，不渲染为任何水面几何：

- 每个模板的清泉 `WaterSource` POI 统一绑定共享 `WaterPool #1`（预算 `countWaterSources`；无湖模板命名「低洼清泉 #{id}」，模板专有名称保留）。
- 清泉 POI 按**普通资源 POI** 走既有渲染链（POI 底座 / 标记 / 储量环，`render_world.js::drawPoiGroundBase`/`drawPoiMarker`），与其他资源点无异。
- 储量/再生/取水的数据链与快照下发不受本次删除影响（见 [14 号文](./14-terrain-and-network.md) §12）。

### 1.3 唯一的粒子表现层：WebGPU 降水粒子（★ v1.64.0）

世界另有一层**纯表现**的降水/水流粒子（天空降雨落到地表后沿地形下坡流动）：

- 物理（生成 / 下落 / **3D 下坡流动** / 邻域力 `f(d)=A−√d−R/d` / 蒸发）在 **WebGPU compute** 上以 3D 固定网格空间哈希（3×3×3 + 单线程前缀和）推进；`frontend/js/webgpu/rain-particles.js` 负责设备与子步编码。
- **★ v1.64.7 邻域力距离口径修正**：`flowIntegrate` 的落地粒子邻域力此前误用**三维**距离（含 z）比阈值并施力到 `vz`，而 `f(d)=A−√d−R/d` 的零点 `reach_near`/`reach_far`（`rain.rs::rain_force_roots`）是按**水平**间距求出的——地形起伏会抬高三维 `d`，使同一水平间距落入不同（含被 `d ≥ reach_far` 跳过）区间，令 `d₂` 终止界限失真、力不再正确归零。现改回**水平距离**（仅 x/y）比阈值且只施力到 `vx`/`vy`，与旧 CPU 实现逐式一致（`vz` 本就会被 `pz = groundHeight(...)` 覆盖，不应受力）。调试监视器的力函数图像也同步改为 `d ≥ d₂` 段画 0（与真实施加口径一致，避免误导成「超出 d₂ 仍有斥力」）。
- **★ v1.64.3 渲染迁至 WebGL**：粒子原由 WebGPU 绘制在一张独立的 `#sim-canvas-rain` 画布上（夹在 GL 地形与 2D 覆盖层之间，**无深度缓冲**），地形与 GL 装饰完全挡不住粒子。现渲染由 [`webgl/layers/rain/rain-renderer.js`](../../../frontend/js/webgl/layers/rain/rain-renderer.js) 承担：WebGPU 层每帧回读存活粒子实例（`x,y,z,age,falling`，`pullInstances()`），GL 层用与地形**同一套斜二测矩阵**（`projection-utils.js`，`sz=-0.0005`）实例化绘制立方体。
  - **遮挡关系（本层唯一目的）**：① 与 GL 地形共享深度缓冲 ⇒ 地形**逐像素**正确遮挡（山前可见 / 山后消失）；② 本层绘制在**地形之后、装饰之前** ⇒ 树木 / 岩石等 GL 装饰按画家序覆盖粒子；③ 2D 覆盖层（道路 / POI / 房屋 / 族人）在其上层 ⇒ 天然覆盖粒子。
  - 深度**只测不写**（与装饰层同构）：装饰在其后绘制时不被粒子反遮，粒子间仍按实例序混合。
  - 独立 `#sim-canvas-rain` 画布与 WebGPU 渲染管线已删除；`rain_render.wgsl` 的 render 入口保留于同模块但无消费方（不额外重编译 WASM）。
- **寿命**：生成时按 `RAIN_MAX_AGE_BASE + rand01 × RAIN_MAX_AGE_RAND` 抽定每个粒子的 `max_age`（`rain.rs`，随 `maxAgeBase`/`maxAgeRand` uniform 下发），当前为 **[1, 64) 秒均匀分布**（v1.64.6 起；此前为 [0, 256) 秒）；`age > max_age` 或出界即销毁回收槽位。
- **运动能量衰减**：`flowIntegrate` 按年龄归一化求出能量 `energy = clamp(1 − age / max_age, 0, 1)`（生成时 1 → 寿命终点 0），用于缩放**下坡加速度**与**流速上限** —— 老粒子动能上限下降、越走越慢，最终趋于静止。
- **★ v1.64.4 蒸发邻域增益**：每个粒子的**蒸发速度**（年龄推进速率）随「三维直线距离 `rainEvapNeighborRadius`（默认 32m）内的存活粒子数 `n`」线性降低：
  `rate = max(rainEvapMinFactor, 1 − rainEvapSlowPerNeighbor × min(n, rainEvapGainCap))`（单位 1/s）。
  默认 `slowPerNeighbor = 0.02`、`gainCap = 50` ⇒ 无邻居时 `rate = 1`（寿命 = `max_age` 秒），10 个邻居时 `rate = 0.8`（64s 寿命 → 实际存活 80s），邻居数封顶 50（速率下限 0.05）。同伴越多越耐蒸发（水洼抱团存水）。
  实现：`rain_compute.wgsl::evapGain`（子步顺序 B2，紧跟 `flowIntegrate`、早于 `evict`）复用同一 3D 网格统计邻域粒数写入 `misc.z`（集齐上限即提前退出），`evict` 据此按 `dt × rate` 推进年龄；统计口径为**当前位形**的三维直线距离，下落中的粒子同样计入。三个键都在 `RENDER_CONFIG`（纯表现层，浮窗「蒸发邻域半径」改值即热生效、无需重编译）；⚠️ 半径必须 ≤ 3D 哈希单元边长，否则 3×3×3 邻域会漏算。
- **★ v1.64.5 蒸发速率调试着色**：`RENDER_CONFIG.rainDebugEvap`（浮窗「水粒子物理」勾选框「蒸发速率着色（红快绿慢）」，勾选即热生效）开启后，GL 粒子层按**蒸发速率**给立方体上色：`t = (rate − evapMinFactor) / (1 − evapMinFactor)`，`t=0` 绿（最慢，邻居已封顶）→ `t=1` 红（最快，无邻居）；同时统一提到 `alpha = 0.85`（常规态静止老粒子 alpha 低至 0.05，色相不可辨）。速率为**内核唯一计算点**（`evapGain` 写 `misc.w`），随渲染实例一并回读（6 float/粒子：`x,y,z,age,falling,rate`），GL 侧只做色相映射；关闭时渲染与原样式逐位一致。
- 它是**纯表现层**：不进 FABS 快照与存档（`RAIN_PARTICLES` 段惰性空段）、不消费 `WorldRng`、不写任何模拟状态；内核只保留参数契约（`rain.rs::rain_gpu_uniforms` + `world_rain_uniforms_ptr/len`）与 WGSL 导出（`rain_common/rain_compute/rain_render.wgsl`）。
- 驱动**跟随仿真 tick**：主线程按快照 `tickCount` 增量推 dt（暂停冻结 / 倍速加速），`rainMaxSubsteps` / `rainDtClamp` / `rainNeighborCap` 为纯渲染配置（`RENDER_CONFIG`）。
- **★ v1.64.9 重力大小可调**：`RENDER_CONFIG.rainGravity`（浮窗「水粒子物理」输入框「重力大小 (m/s²)」，默认 72）由前端逐子步覆盖内核契约 `RainGpuUniforms.gravity`（内核默认 `rain.rs::RAIN_GRAVITY = 72`，缺失时回落该值），改值即热生效、无需重编译 WASM。下落态为完整竖直重力；落地态投影到地形切面（见上）。
- 约束见 [28 号文](./28-invariants.md) B17；渲染样式（立方体 36 顶点、逐面明暗、颜色、淡出）自 v1.63.4 起未变（GL 移植逐式复刻原 WGSL，唯一差异是 NDC z 由恒定 0 改为真实投影深度）。

---

## 2. 硬约束与设计原则

1. **严禁全局细分网格（Zero Grid Subdivisions）**：网格分辨率由 `SIM_CONFIG.terrainGridRes` 配置（现网 256×256），任何锯齿修复必须在固定网格上用分层矢量覆盖解决。
2. **零运行时 GC 分配（Zero-GC Frame Budget）**：前端投影顶点缓冲静态预分配、深度项对象池复用，禁止在 `render()` 循环内产生对象分配或多余闭包。
3. **确定性与存档绝对一致（Deterministic & Save-Safe）**：渲染层不消费模拟 RNG、不写模拟状态、不进存档；地形与资源事实完全由内核确定性生成并经快照下发。

---

## 3. 代码地图（改代码入口）

| 层 | 文件 | 关键点 | 职责 |
| :--- | :--- | :--- | :--- |
| Rust 内核 | [`geo/hydrology.rs`](../../../crates/sim_core/src/geo/hydrology.rs) | `WaterBody` / `WaterAccessPoint` / `WaterPool` / `TerrainConnection` | 仍被生存水源、快照与存档消费的数据结构（**不再生产水面几何**） |
| Rust 内核 | [`geo/procedural/hydrology.rs`](../../../crates/sim_core/src/geo/procedural/hydrology.rs) | `project_semantics(&mut SemanticGrid)` | 水体重置为空/零，按 flags 派生通行/建造掩码 |
| Rust 内核 | [`geo/terrain.rs`](../../../crates/sim_core/src/geo/terrain.rs) | `TerrainFeatureKind` / `TERRAIN_GENERATOR_VERSION` | 特征枚举（`WaterBody` 等惰性保留）；生成器版本 37 |
| Rust 内核 | [`spatial/terrain_network.rs`](../../../crates/sim_core/src/spatial/terrain_network.rs) | `prepare_terrain_layout` / `sync_water_pois` | 清泉 POI 绑定共享 `WaterPool #1` 与储量同步 |
| 前端 | [`js/webgpu/rain-particles.js`](../../../frontend/js/webgpu/rain-particles.js) | `init` / `step` / `pullInstances` | 降水粒子 compute 设备与子步编码（★ v1.64.3 起不再渲染，改为回读存活实例） |
| 前端 | [`js/webgl/layers/rain/rain-renderer.js`](../../../frontend/js/webgl/layers/rain/rain-renderer.js) | `WebGLRainRenderer.render` | ★ v1.64.3 降水粒子 GL 渲染层（实例化立方体，共享地形深度缓冲 ⇒ 地形遮挡 + 装饰画家序覆盖） |
| 前端 | [`js/render_depth_queue.js`](../../../frontend/js/render_depth_queue.js) | `drawWorldEntities()`（`DEPTH_FEATURE` 段） | 统一按 `project3D().depth` 升序落笔；**已无水体系列入队** |
| 前端 | [`js/render_terrain.js`](../../../frontend/js/render_terrain.js) | `drawFeatureItem` | 短特征折线（`Cliff`/`SpringValley`）绘制；`drawWaterBodyTile` 已删 |
| 前端 | [`js/rustworld.js`](../../../frontend/js/rustworld.js) | 地形重建钩子 | 世界重置/读档后重建静态地形；**已无水体动态状态** |
| 前端 | [`js/snapshot-bin.js`](../../../frontend/js/snapshot-bin.js) | FABS 解码 | `water_bodies` / `WATER_DYNAMICS` section 解码保留（Rust 仍编码空段） |

---

## 4. 性能约束

- 删除水面渲染后，地图深度队列只承担道路 / POI / 房屋 / 族人 / 装饰与少量短特征折线，单帧 Canvas 2D 填充成本进一步下降。
- **每帧堆内存 GC 分配 = 0 字节**：投影点全量复用模块顶层 `TypedArray`，深度队列走对象池，无垃圾回收。
- 回归门禁：`node tools/test-wasm.js`（同种子确定性 + 存读档）、`node tools/frontend-check.js`（脚本语法与 DOM 完整性）、`node tools/profile-benchmark.js`（帧率无衰退）。