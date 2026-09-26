# 18. 水系河岸平滑化与写意微缩沙盘水体改造方案 (River & Shoreline Refinement Plan)

> **状态**：★ **已实现**——水面由 **Rust 内核的粒子流体求解器（PBF，深度平均域）**推进，粒子位置随每帧 FABS `Fluid` section 下发；前端只按既有画风渲染内核粒子（见 §1.3、[33 号文](./33-runtime-fluid.md)）。统一相机深度队列仍负责粒子、岸线和实体排序。零网格细分、确定性门禁全通。
> **范围**：消除河岸 13 米级网格阶梯锯齿、连续矢量水面、湿砂漫滩过渡带、涉渡卵石踏道、水底游鱼生态层、地形格间抗锯齿缝隙补偿、边界侧壁深度排序；加入由降雨补给驱动的水面覆盖率与水位表现；**不改动**寻路阻挡判定、不增加全局网格细分，保持确定性。（★ v1.50.86 迎光面太阳波光已删除、游鱼迁 WebGL——见 §1.4。）
> **入口**：[文档导航](../../README.md) · [地形美术规划](../../plan/tech/07-terrain-art.md) · [地形专项方案](../../plan/tech/06-terrain-templates.md) · [前端渲染现状](./16-frontend-overview.md)。

---

## 状态机

水系渲染元素不再按固定 Pass 先后硬编码，而是由 `render_world.js` 统一相机深度队列按 `project3D().depth = ry·sinX + z·cosX` **升序（远 → 近）落笔**调度；水系相关的深度档位如下（其间穿插道路 / 营地连线 / POI / 房屋 / 族人等档位）：

| 深度档 | 渲染元素 | 绘制函数（`frontend/js`） | 说明 |
| :--- | :--- | :--- | :--- |
| 1 · `DEPTH_FEATURE` | **非水面**水系特征：RiverBank 漫滩 / ShallowFord 涉渡 / Cliff 峭壁 / 泉谷 | `render_terrain.js::drawFeatureItem` | RiverBank **按段入队**（v1.50.20）；ShallowFord 等短特征整条绘制；★ v1.61.4 起 River / WaterBody 水面**不再入队**（水面 = 粒子层，§1.3） |
| 2 · `DEPTH_FISH` | 游鱼（水中层） | `river_life.js::drawFishSingle` 逐条入队 | 鱼 z 在水面下（水中层），按深度先于水面粒子落笔，透过水面可见；★ v1.50.86 起 GL sink 分发进 `WebGLAccentLayer`（★ v1.60.1 sink 硬门槛：GL 未就绪帧整只跳过；粒子水面仍盖绘其上，透水观感不变） |

> ★ **v1.60.1 深度档删减**：`DEPTH_CELL`（地形格）与 `DEPTH_WALL`（边界侧壁）随 Canvas 地形/侧壁通道删除——地形与侧壁改由 WebGL 地形层直绘并参与 GPU 深度测试，水系/游鱼深度档照旧。

**不变量**（违反即出 bug）：
- **严禁全局细分网格（Zero Grid Subdivisions）**：在固定物理网格上用分层矢量覆盖解决锯齿，不得提升网格分辨率（现网 `SIM_CONFIG.terrainGridRes = 256×256`，步长 ≈2.996m；v1.50.70 由 160×160 提升）。
- **零运行时 GC 分配**：投影顶点缓冲静态预分配（`Float32Array`）+ `render_world.js` 深度项对象池，`render()` 循环内禁止对象分配，帧耗时增量 ≤ 0.08ms。
- **观感降噪铁律**：凡「沿中心线/岸线走线、笔宽/间距与河宽成比例」的元素在窄河道退化成车道线，只有面状（水面填充/地表格色）与点状/小尺度（游鱼）元素才能稳定成立。
- **水面无平面拟合（No Fitted Water Plane，★ v1.61.4）**：水面**只有粒子层一个来源**——地表水格不得承载水色（只作河床湿润度）、不得有多边形/矢量填充或地表乘色拟合；`drawRiverBand` / `drawWaterBodyTile` / `terrain-style` 水格乘色已删除，**勿复活**。

## 1. 当前渲染机制

### 1.1 网格底模（`math.js::computeTerrainAlbedo`）

水格底色用**暖棕河床土色**（非亮蓝），透过半透明水面呈现湿润泥土暖调，消除亮色直角阶梯：

| 地表类型 | 当前色值 |
| :--- | :--- |
| `ShallowWater` | `rgb(142, 122, 96)` |
| `DeepWater` | `rgb(120, 100, 76)` |
| `RiverBank` | `rgb(148, 138, 114)` |

**选色经验**：水下格亮度应向 `RiverBank` 湿砂色靠拢而不是向「幽深」靠拢——**色阶反差才是锯齿的来源**；纵深对比交给深浅两档水格之间的差异。

★ **v1.61.4 语义收敛**：水格不再承载水色（不拟合平面水）——覆盖率只在**湿河床**（上表湿土色）与**干河床**（砂色 `rgb(148, 138, 114)`，terrain-renderer 的 dry 端点）之间过渡；水面本身完全由粒子层表现（§1.3）。

### 1.2 湿砂漫滩带（`RiverBank`，`render_terrain.js::drawFeatureItem`）

- Rust 侧生成左右岸线特征（`hydrology.rs` id:20+i，`width` = 内核 `bank` 参数），前端以半透明土褐细带沿岸线描边（`rgba(174, 137, 78, 0.24)`，线宽 `max(2, feature.width * scale * 0.06)`），盖住陆水交界处的方块锯齿。
- v1.50.20 起 RiverBank 同 River 按段入深度队列（`idx` = 段号）。

### 1.3 内核粒子流体（求解在 Rust，渲染在前端）

★ **v1.62.0 起运动学来源变更**：水面**不再由前端求解**。求解器是 Rust 内核的
[`spatial/fluid/`](../../../crates/sim_core/src/spatial/fluid/mod.rs)（Position Based Fluids，
深度平均域），完整设计见 [33 号文](./33-runtime-fluid.md)。本节只描述**渲染侧**契约：

- **数据来源**：`snap.fluid_particles`（`Float32Array`，扁平 `[x,y,z,…]`）+ `fluid_fill_radius`
  / `fluid_tone_radius`；由 `rustworld.js::_applySnapshot` 映射到 `rustWorldSim.fluidParticles`。
  section 缺席 = 本帧无水体 ⇒ 前端清空粒子视图。
  ★ **粒子数逐帧可变**（内核补源/出流/下渗，见 33 号文 §2.3/§2.4）：前端按 `count` 伸缩绘制视图，
  内核用 `swap_remove` 保证每次删减只扰动一个粒子的抖动身份；粒径由内核按静态 `spacing_eff` 下发，
  不随粒子数漂移（目标间距已由 2.6m 提升 70% ⇒ 单粒子粒径 ×1.7、投影面积 ×2.89 的颗粒读感）。
- ★ **本层不再以「静态水系特征非空」为启用门槛**（v1.63.0）：`WaterParticles.init` 恒启用、
  `render_depth_queue.js` 无条件调用 `WaterParticles.update`——水是**开放循环**，全图降雨/泉眼会在
  完全没有水系特征的地形（山口 / 冲积扇 / 半坡 / `flat_baseline`）上造出水体；
  「有没有水」唯一由内核快照的 `Fluid` section 决定（缺席即清空视图）。`RiverLife`（游鱼）仍按
  `features.length` 启停——它只服务河道。
- **`water_particles.js`（渲染层，约 190 行）**：内核粒子 → 绘制视图一一映射。逐粒子**视觉抖动**
  （尺寸 `sizeK`、旋转 `rotC/rotS`、透明度 `aK`、相位 `phase/phase2`）由**粒子下标 + 世界种子的稳定哈希**
  派生，只在粒子下标首次出现时计算一次 ⇒ 稳态不闪、零堆分配；亮点抽样 `i % 5 === 0`；
  竖向弱起伏与波光闪烁走墙钟（纯表现层，不参与物理）。
- **不再存在**：前端流场构建（河流断面表 / 湖泊到岸距离场）、渠坐标系积分、覆盖率折叠选活、
  墙钟累加器固定步长推进——这些**全部上移到内核**。`WATER_DYNAMICS`（`coverage` / `level` /
  `flow_strength`）仍每帧下发，但只服务**地形水下材质**（湿河床 ↔ 干河床插值）与前端透明度调制，
  不再驱动粒子数量或位置。
- **渲染走统一深度队列**逐条入队（`DEPTH_WATER_PARTICLE`），入队端按屏幕 AABB（粒径外扩）**先剔屏外粒子**；
  绘制向 `WebGLAccentLayer` sink 分发压扁菱形（硬门槛：GL 未就绪帧整帧跳过，无 Canvas 备用通道）。粒子的集合即水面。
- ★ **v1.61.4 纯粒子水面（不变）**：水面**没有任何平面拟合来源**——地表水格只作河床湿润度、
  `terrain-style.js` 水格乘色已删除、2D 多边形水面填充（`drawRiverBand` / `drawWaterBodyTile`）与
  深度队列的 River / WaterBody 入队一并删除；水面唯一来源是粒子层（粒径系数 1.30、基础透明度 0.26）。
- ★ **v1.62.0 侵蚀联动（渲染侧）**：内核水力侵蚀会改写水体格高程并随 FABS `TerrainDelta` section
  增量下发（见 [33 号文](./33-runtime-fluid.md) §7）。前端 `rustworld.js::_applyTerrainDelta` 就地
  更新 `cells[].elev` / `slopeAngle` 并重算受影响格的法线 / AO / 反照率，bump `dynamicWaterRevision`
  让 GL 地形几何重传；**粒子的 z 由内核 `bed + 深度` 给出**，故水面位置自动跟随新河床，渲染层无需
  额外适配。

> ⚠️ **观感常量仍以前端为准**：配色（`rgba(46,145,198)` / `rgba(122,214,235)`）、透明度（0.26 / 0.34）、
> 亮点抽样（每 5 个）与抖动区间都在 `water_particles.js`；内核只下发粒径。**改观感改前端，改物理改内核**。

### 1.4 水底生态层（`river_life.js`，纯表现层）

- **游鱼**：≤24 条（4 色盘：锦鲤赤金/金鲤明黄/青黑溪斑/白练银鱼），沿河道中心线插值巡航（基于左右岸顶点序列中点切线推进），正弦摆尾扰动，大部分顺流、少部分逆流；**走墙钟**（模拟暂停仍游动，属写意微缩沙盘环境生命感设计，与水面动画一致）。v1.50.11 起逐条入深度队列（`drawFishSingle`），深度低于水面。
- **★ v1.50.86 游鱼迁 WebGL（31 号阶段三切片）**：`drawFishSingle` 把四笔图元（水底影子 / 鱼身梭形 / 背光高线 / 两瓣尾鳍）按 Canvas 同序同配色经 sink 分发进 `WebGLAccentLayer`——鱼身在底层 GL 画布、2D 半透明水面随后盖绘，透水观感不变；配色单一数值源 `FISH_PALETTES`（Canvas rgba 串与 GL 数值通道同源派生）；★ v1.60.1 起 **sink 硬门槛**：GL 层未就绪的帧整只跳过绘制（Canvas 备用通道已删）。
- **确定性**：世界重置/读档随 `_engineSeed` 重建（`rustworld.js` 地形重建钩子 `RiverLife.init(nextFeatures, this._engineSeed)`），不进存档、不消耗 WorldRng、不写模拟状态。
- **动态水面**：FABS `WATER_DYNAMICS`（Section 23）每帧下发共享水池的 `coverage`、`level` 与 `flow_strength`。★ v1.61.4 起它**只服务地形水下材质**（WebGL 地表把 `water_body_id` 格在「湿河床 ↔ 干河床砂色」之间插值），不再缩放任何水面轮廓；★ v1.62.0 起水面位置由内核粒子流体决定（§1.3）。静态地形格的通行和建造语义保持不变。
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
3. **确定性与存档绝对一致（Deterministic & Save-Safe）**：水体边界由创世种子生成；★ v1.62.0 起粒子由**内核**推进——播种用 `seed ^ SEED_SALT` 的局部 PRNG、推进由 `tick_counter % FLUID_STEP_TICKS` 驱动（无墙钟、无浮点累加器）、不消耗 `WorldRng`，状态随存档**位精确**持久化（[33 号文](./33-runtime-fluid.md) §5）。降雨和共享水池状态仍由内核确定性演化并通过每帧动态 section 投影到渲染层。视觉变化**不改变** `biome.rs` 中 `SurfaceKind::DeepWater` 对部落民移动的物理阻挡判定；粒子层不写其他模拟系统状态。

---

## 3. 代码地图（改代码入口）

| 层 | 文件 | 关键点 | 职责 |
| :--- | :--- | :--- | :--- |
| Rust 内核 | [`geo/hydrology.rs`](../../../crates/sim_core/src/geo/hydrology.rs) | `generate_river` | 生成 `TerrainFeatureKind::River`（194 顶点闭合 outline）/ `RiverBank`（左右岸线，id:20+i）/ `ShallowFord`（id:10+i）/ `SpringValley`（id:30）并压入 `self.features` |
| Rust 内核 | [`spatial/snapshot_bin/dict.rs`](../../../crates/sim_core/src/spatial/snapshot_bin/dict.rs) | `feature_kind_code` | `TerrainFeatureKind::River` 枚举码位与 FABS 表格一一对应（防漂移）；新增枚举变体须同步 `*_code()` / `*_table()` |
| 前端 | [`js/render_world.js`](../../../frontend/js/render_world.js) | 深度队列（`DEPTH_FEATURE/FISH/…`，在 render_depth_queue.js；★ v1.60.1 起 DEPTH_CELL/DEPTH_WALL 已删；★ v1.61.4 起 River/WaterBody 水面不入队） | 统一按 `project3D().depth` 升序落笔；深度项对象池零 GC；收集阶段决定各元素入队深度 |
| 前端 | [`js/render_terrain.js`](../../../frontend/js/render_terrain.js) | `drawTerrainShell` / `drawTerrainGrid` / `drawFeatureItem`（★ v1.61.4 起 `drawRiverBand`/`drawWaterBodyTile`/`_wbTileGrid` 已删） | 非水面水系特征绘制（RiverBank 逐段 / ShallowFord / Cliff / 泉谷）；水面 = 粒子层 |
| Rust 内核 | [`spatial/fluid/mod.rs`](../../../crates/sim_core/src/spatial/fluid/mod.rs) | `FluidSim::{seed_from_terrain, refresh_springs, step, spawn, despawn, substep, export_state, restore_state}` | ★ v1.62.0 水体求解器：播种、每步河床剖面、子步受力与 PBF 约束投影、位精确存档状态；★ v1.63.0 增补源（降雨/泉涌）、开放边界出流与坡面下渗寿命。详见 [33 号文](./33-runtime-fluid.md) |
| Rust 内核 | [`spatial/fluid/pbf.rs`](../../../crates/sim_core/src/spatial/fluid/pbf.rs) · [`grid.rs`](../../../crates/sim_core/src/spatial/fluid/grid.rs) | 二维核 / 密度 / λ / Δp / XSPH；平面桶索引 | PBF 求解核函数与邻域索引（⚠️ `s_corr` 禁止 `powf`） |
| 前端 | [`js/water_particles.js`](../../../frontend/js/water_particles.js) | `WaterParticles.init` / `update` / `particles` / `drawParticle` / `stats` | ★ v1.62.0 **渲染层**（不再自带求解）：内核粒子 → 绘制视图映射（下标哈希视觉抖动）、sink 分发压扁菱形 |
| 前端 | [`js/river_life.js`](../../../frontend/js/river_life.js) | `RiverLife.init` / `drawFishSingle`（GL sink 硬门槛） | 游鱼（纯表现层，走墙钟，`_engineSeed` 确定性重建） |
| 前端 | [`js/rustworld.js`](../../../frontend/js/rustworld.js) | 地形重建钩子 | 地形重建时以 `_engineSeed` 初始化 `RiverLife`（世界重置/读档后卵石鱼群分布确定性一致） |
| 前端 | [`js/math.js`](../../../frontend/js/math.js) | `computeTerrainAlbedo` | 水格 = 河床土色底模（§1.1 色值；★ v1.61.4 起不承载水色），水面由粒子层承担 |
| 前端 | [`index.html`](../../../frontend/index.html) | 脚本登记 | `river_life.js` 须早于 `render_world.js` 加载 |

---

## 4. 性能约束

- 基础地形网格（120×120）顶点投影与 Quad 绘制为基准成本；水系装饰层为粒子逐条 sink 绘制 + 漫滩带 + 游鱼逐条，**全图粒子上限 1600**（内核求解器上限，含降雨/泉涌补源；常态稳态 ≈1100，见 [33 号文](./33-runtime-fluid.md) §2/§6），入队端先剔屏外粒子（排序与绘制规模只与可见粒子相关）。
- **求解成本（内核侧，★ v1.62.0）**：`river_valley_v1` 稳态 ≈1090 粒子时 Phase 5 摊薄 **≈0.18 ms/tick**（整拍 ≈0.20 ms/tick，含每 6 拍一次的 PBF 求解 + 每 10 步一次的侵蚀），折算 1× 实时 ≈12 ms / 秒模拟时间。⚠️ 高倍速（≥128×）下求解器是模拟吞吐主要瓶颈（该世界约 84× 实时到顶）；成本旋钮 = `FLUID_STEP_TICKS` / `SUBSTEPS` / 粒子数（≈0.17 µs/tick / 粒子）。
- **每帧堆内存 GC 分配 = 0 字节**：内核求解器全部 SoA 缓冲放置期预分配、运行时只写数值字段；前端粒子视图按需扩展后原地复用、视觉抖动由下标哈希派生（只算一次），深度队列走对象池，无垃圾回收。
- 回归门禁：`node tools/test-wasm.js`（同种子确定性 + 存读档逐字节一致）、`node tools/test-determinism.js`（六套件矩阵）、`node tools/frontend-check.js`（脚本语法与 DOM 完整性）、`node tools/profile-benchmark.js`（吞吐与子阶段拆解）。
