# 33. 运行时水体求解器（Runtime Fluid / GPU）

> ★★ **2026-09-26（v1.66.0）权威路径已变更**：水体粒子的运动学**迁移到前端 WebGPU compute**
> （`frontend/js/water_gpu.js`），**放弃确定性**（拟真优先）。内核 `FluidSim` / `Erosion`
> **保留但休眠**（不播种、不推进），FABS `Fluid` / `TerrainDelta` section 恒缺席，
> `fluid_state` 恒空。**当前权威说明见 [§8](#8--水系迁移到前端-webgpu2026-09-26v1660)**；
> 下方 §1~§7 为**已退役**的内核实现（保留作参考与算法口径来源，勿据以判断现状）。

> **状态（历史，v1.64.0 及以前）**：★ **已实现**——水面由 **Rust 内核的粒子流体求解器**（Position Based Fluids，深度平均域）推进，粒子位置随每帧 FABS 快照的 `Fluid` section 下发；前端只按既有画风渲染内核粒子（[18 号文](./18-water-rendering.md) §1.3）。**水力侵蚀 / 沉积**（§7）已落地：流速场回灌河床，高程改动随 `TerrainDelta` section 增量下发。
> **开放水循环**（§2.3）：边界不再硬夹紧（水从地图边缘流出），并由**降雨**（全图落点）与**泉眼**（`WaterSource` POI）补源，坡面漫流粒子有下渗寿命 ⇒ 粒子总数是模拟期动态量。
> **范围**：水体粒子播种、PBF 约束求解、地形坡度重力与 Manning 摩阻、开放边界出流、降雨/泉涌补源与寿命淘汰、快照协议、存档位精确持久化、侵蚀/沉积地形反馈。
> ★ **v1.64.0 创世删除预设水系**：Field Compiler 不再投影水域格 / 水体 / 岸点（[14 号文](./14-terrain-and-network.md)），全部地图以**全干**状态发布 ⇒ **播种恒空**（§2 播种预算恒为 0），粒子的唯一来源是 §2.3 的降雨 + 泉眼补源；侵蚀（§7）因准入要求 `water_body_id.is_some()` 而**当前恒不触发**（实现原样保留，待自然水/侵蚀阶段启用）。
> **入口**：[文档导航](../../README.md) · [水体渲染](./18-water-rendering.md) · [地形与路网](./14-terrain-and-network.md) · [确定性](./03-determinism.md)。

---

## 1. 定位与边界

| 维度 | 事实 |
| :--- | :--- |
| 归属 | **内核**（`crates/sim_core/src/spatial/fluid/`）。水面运动学与侵蚀地形反馈不再由前端计算 |
| 推进 | 由 tick 驱动：`tick_counter % FLUID_STEP_TICKS == 0` 时推进一步（默认 6 拍 = 10Hz 模拟时间）；侵蚀挂在**流体步计数**上（每 `EROSION_EVERY_FLUID_STEPS` 步 ≈ 1 秒模拟时间一次） |
| 补源 | 降雨（落点全图均匀，速率 ∝ `rainfall_intensity()`）+ 泉眼（`WaterSource` POI，速率恒定）。见 §2.3 |
| 出流 | 粒子越过世界 AABB 即被移除；坡面漫流粒子另有 `SHEET_FLOW_LIFETIME` 下渗寿命。见 §2.4 |
| 消费 | 前端 `water_particles.js` 只渲染；地形水下材质仍走 `WATER_DYNAMICS`（池库存 / 降雨派生，与本求解器**并存但不互馈**） |
| 写回 | 侵蚀**只改水体格**（`water_body_id.is_some()`）的高程 / 坡度，并同步 `VoxelBackend` 权威高度场；陆地格一律不动 |
| 不消耗 | `WorldRng`、不写其他模拟系统状态、不改变寻路/建造/生态判定（水体格的 `surface_kind`/`water_body_id`/`feature_flags` 均不变） |
| 必须持久化 | 是。`WorldSave.fluid_state`（位精确十六进制）——否则读档续演无法与不中断运行逐字节一致；侵蚀结果随 `terrain_state` 持久化，累计量由高程差还原 |

**为什么不是三维 SPH**：本项目地形格距 ≈3m、河道水深 1~3m，竖直方向**不足一个粒子层**。三维核在薄层里退化为面密度（代价高、数值脆），而深度平均后「面内不可压缩」恰好等价于「水柱厚度守恒」，并仍给出侵蚀所需的流速场。将来若要三维水体（瀑布等），只需替换 [`pbf.rs`](../../../crates/sim_core/src/spatial/fluid/pbf.rs) 的核与 [`grid.rs`](../../../crates/sim_core/src/spatial/fluid/grid.rs) 的分桶维度，`FluidSim` 对接口径不变。

---

## 2. 状态与播种

- **粒子 = 一根水柱**：质量 `spacing²`（`spacing = 6.63m`），水平占位在求解中守恒。
  ★ 目标间距由 2.6m **提升 70%**（`×1.7` → 4.42m，v1.63.0），其后 **再提升 50%**（`×1.5` → 6.63m，2026-09-26）
  ⇒ 单粒子代表的水体面积 `spacing²` 相对 2.6m 变为 `(6.63/2.6)² ≈ 6.5` 倍（同水量所需粒子数同比下降）。
  ⚠️ **显示粒径与求解间距解耦**（`RENDER_SPACING_BASE = 4.42m`）：`render_radii` 以该基准（·`RENDER_FILL_K = 1.30`
  / ·`RENDER_TONE_K = 0.52`）派生，**不随 `FLUID_SPACING` 变化** ⇒ 抬升间距只让粒子在平面上铺得更开，
  **不改单颗粒子的显示大小**。
- **播种源** = 地形水体格（`GeoCell.water_body_id.is_some()`，按行主序收集）。★ v1.64.0 起创世不再产生水体格 ⇒ **播种恒空**（`seed_from_terrain` 早退、`enabled=false`），这套机制保留给未来由自然水/侵蚀涌现的水体。水体格 < 4 且无泉眼时整体禁用（地图页 / 无水体且无泉眼 profile 不下发 section）。
- **预算**：`min(FLUID_SEED_BUDGET=1040, 水体格数 × MAX_PER_CELL=1)`；每个粒子按下标比例均匀铺到水体格上，格内抖动由 `seed ^ SEED_SALT` 的**局部** `WorldRng` 给出 ⇒ 确定性且不污染全局 RNG 消费序。余量（上限 `FLUID_MAX_PARTICLES=4096`）留给补源的瞬态粒子。当前无水体格 ⇒ 预算恒 0。
- **水柱深度** = `clamp(水体水位 − 河床, 0.35, 3.0)`，**按粒子当前位置**取格（不是播种格）；非水体格取 `MIN_DEPTH` ⇒ 无水体格时全部粒子都是 0.35m 的坡面漫流薄层。位置随存档位精确恢复 ⇒ 深度无需入档，且雨滴/泉水汇入水体后立刻取到该水体的厚度。渲染面因此恒等于 `z_bed + clamp(水位 − z_bed, MIN, MAX)`，与 §1 的模型同式。
- **静止密度** `ρ0` = 播种构型下的**平均密度**（实测而非硬编码）⇒ 初始构型无压力爆炸；PBF 只约束压缩（`C > 0`），自由表面粒子不被拉回内部。无播种构型（当前常态）改用 `FluidSim::new` 里 5×5 六方点阵测得的**理想堆积密度**兜底。
- **实际间距** `spacing_eff = √(水体格总面积 / 播种预算)`：预算不足时大于 `spacing`（水更稀）。⚠️ 它是**静态**量（只依赖水体面积与预算，不随动态粒子数漂移）；无播种时回路默认 `FLUID_SPACING`。显示粒径按 `max(1, spacing_eff / spacing) × RENDER_SPACING_BASE` 派生 ⇒ 目标间距下恒为基准（与求解间距解耦、不随其抬升而变），只有水更稀时才等比放大以维持「粒子即水面」读感。

### 2.3 补源（降雨 + 泉涌）

```text
每流体步（dt = 0.1s 模拟时间）：
  降雨  速率 = RAIN_SPAWN_RATE(1.2/s) × rainfall_intensity()     落点 = 全图均匀随机
  泉眼  速率 = SPRING_SPAWN_RATE(0.3/s) × 泉眼数                   落点 = POI 坐标 ± SPRING_JITTER
  信用  credit += 速率 × dt；够 1 个才生成，credit ≤ SPAWN_CREDIT_MAX(4) 封顶
```

- **降雨落点覆盖全图**（不只是水面）：雨滴落在陆地即成为**坡面漫流**粒子，顺坡流动；这也是「降雨把水带入地图」的表现层含义。当前创世无水体可汇入，故漫流粒子只靠寿命淘汰。
- **泉眼** = `PoiType::WaterSource`（低洼清泉 POI）坐标，由 `World3DEngine::tick_phase_fluid` 每 tick 用 `FluidSim::refresh_springs` 刷新（**容量复用 ⇒ 稳态零分配**）。泉眼为地下水补给，**不随降雨强度变化**；★ v1.64.0 起全部 profile 创世无水体格 ⇒ 降雨 + 泉眼是**唯一水源**，求解器由泉眼而非 `enabled` 单独驱动（`enabled` 在首批补源粒子生成后自动置真）。
- **确定性**：落点走 `seed ^ SPAWN_SALT ^ tick_counter` 的局部 PRNG，**不消耗 `WorldRng`**；同一 tick 的落点逐位相同，`credit` 随存档携带 ⇒ 读档后补源序列完全对齐。
- **前端启用门槛**：因为水可能出现在**没有任何水系特征**的地形上，`WaterParticles.init` 恒启用、`render_depth_queue.js` 无条件调用 `update`——「有没有水」唯一由本 section 决定（缺席即清空）。⚠️ 曾以 `terrain.features.length` 作门槛，导致这类地形上内核有粒子而画面全干（见 [18 号文](./18-water-rendering.md) §1.3）。

### 2.4 出流与下渗（耗散）

- **边界开放**：③ 段不再把位置夹紧到世界 AABB；粒子越出 `±world_size/2` 即在下一次 `despawn` 中被移除（水从地图边缘流出）。
- **坡面漫流寿命**：粒子的 `age` 每步累加 `dt`，**落在水体格上立刻清零**（正式并入水体）；非水体格上超过 `SHEET_FLOW_LIFETIME(512s)` 即下渗消失。这是「全图降雨」不淤积的必要闸门——否则陆地薄水粒子会永久占满粒子上限。★ v1.64.0 起不存在水体格 ⇒ **所有粒子都走 512s 下渗**（稳态粒子数只由补源速率与寿命决定，寿命由 30s→120s→512s 逐步延长以让雨水有更长时间顺坡汇流/低处滞留）。
- 移除用**末尾粒子顶替**（`swap_remove`）⇒ 每次只扰动一个粒子的绘制下标（前端视觉抖动按粒子下标哈希派生，整体左移会造成大片纹理跳变）。
- **稳态水量**：实测出流速率 ≈ 0.3%/秒 × 粒子数，`RAIN_SPAWN_RATE` 取 1.2/s（≠0 的常态降雨）与泉眼一起构成补源。无水体格、`SHEET_FLOW_LIFETIME=512s` 下的平台期（≈444s 填满）：常态降雨实测 **≈1300~1440 个坡面漫流粒子**（受出流限制、未顶满 `FLUID_MAX_PARTICLES=4096`）；暴雨更高、断雨（倍率 0）只剩泉眼补给，上限仍由 `FLUID_MAX_PARTICLES` 封顶。⚠️ 计数口径：快照 `Fluid` section 的 `count` 是粒子数，**前端解码出的 `snap.fluid_particles` 是 `count × 3` 的扁平 `Float32Array`**（x/y/z 交错），比对粒子数时必须除以 3。

---

## 3. 求解（每步）

```text
⓪ 补源    降雨 / 泉眼按信用生成粒子（§2.3；满员或信用不足则跳过）
① 每步一次：河床剖面 bed_profile(x,y) → (高程 z, 坡度 ∇z_bed)
   水柱深度 h = depth_at(x,y,z)（按当前位置取格）⇒ 渲染水位 = z + h；同步预算摩阻 f
   寿命     落在水体格 → age = 0；否则 age += dt
② 子步（SUBSTEPS 个）：
   受力   a = −g·∇z_bed − f·|v|·v        （Manning 摩阻 f = g·n²/h^{4/3}，预算化）
   预测   p = x + v·dt
   邻域   平面均匀桶索引（桶边长 = 支撑域半径）重建
   密度   ρ_i = Σ_j m·W_poly6(|p_i − p_j|)            （2D 核）
   λ      λ_i = −C_i / (Σ|∇C|² + ε)，仅 C > 0
   Δp     Δp_i = (1/ρ0) Σ_j (λ_i + λ_j + s_corr) ∇W_spiky
   施加   p += clamp(Δp, |Δp| ≤ 0.25·spacing) → v = (p_new − x)/dt   ← 边界**不夹紧**
   粘性   XSPH：v_i += c Σ_j (v_j − v_i) W / ρ0（双缓冲）
③ 淘汰    越出世界 AABB（出流）或 age > SHEET_FLOW_LIFETIME（下渗）→ swap_remove（§2.4）
```

**关键实现约束**（改代码前必读）：

- **`s_corr` 禁止用 `powf`**：`n` 恒为小整数，用乘法连乘（`(W/W(Δq))⁴` = `r2·r2`）。实测 `powf` 占单子步开销一半以上，替换后摊薄成本从 1.58ms/tick 降到 0.72ms/tick。
- **Manning 摩阻系数预算化**：只依赖水柱深度 ⇒ 存 `fric[i]`，禁止每个子步对每个粒子调 `powf(4/3)`。深度在 ① 段整批重算（同一公式、同一顺序）⇒ 侵蚀改河床后无需额外刷新调用。
- **桶边长恒等于支撑域半径** ⇒ 邻域查询固定 3×3 桶；插入序为粒子下标升序 ⇒ 邻域遍历顺序逐位可复现。
- **稳态零堆分配**：全部 SoA 缓冲（`x/y/z/vx/vy/px/py/dx/dy/dens/lambda/svx/svy/depth/age/fric/gx/gy`）构造期预分配；`refresh_springs` 的泉眼列表复用容量。

---

## 4. 快照协议（FABS `Fluid = 24` / `TerrainDelta = 25`）

`FORMAT_VERSION` 6 → 7（`Fluid`）→ **8**（`TerrainDelta`；★ 前后端必须同步，否则解码器整帧拒绝）。

```text
u32  count
u32  revision（求解器步数低位）
f32  origin.x / origin.y / origin.z     ← x/y 用世界 AABB，z 用逐帧粒子 z 区间紧凑化
f32  scale.x  / scale.y  / scale.z
f32  fill_radius / tone_radius           ← 前端粒径（世界单位）
count × (u16 qx, u16 qy, u16 qz)         ← 6B/粒子；世界坐标 = origin + q × scale
```

- 量化精度：x/y ≈ 0.012m（世界边长/65535），z 按逐帧区间自适应。
- **`count` 动态可变**（补源/出流/下渗），section 布局不变；前端按 `count` 伸缩绘制视图，`swap_remove` 保证每次只扰动一个粒子的视觉抖动身份。
- **编码红线**：`quantize_u16` 的入参是**归一化到 [0,1]** 的比例（内部再乘 65535）。曾因传入「已乘 65535 的值」导致全部粒子钳到顶值、世界坐标退化为 `+world/2`——这是本模块最容易复现的坑。
- section **缺席** = 本帧无水体（前端据此清空粒子视图）。
- 四处同步：`snapshot.rs`（结构体定义 + test-only 真值通道）/ `world_snapshot.rs`（赋值）/ `snapshot_bin/{layout,encode}.rs`（编码）/ `frontend/js/{snapshot-bin,rustworld}.js`（解码与映射）。

**侵蚀地形增量 `TerrainDelta = 25`**（仅脏格，非每帧）：

```text
u32  count
count × (u32 格下标, f32 高程, f32 坡度角, u16 flags)
```

- 格下标 = `TerrainMap` 行主序；`surface_kind` / `water_body_id` / `natural_fertility` 不随侵蚀变化，故不下发。
- **与全量 `TERRAIN` 帧互斥**：`terrain_dirty` 为真时全量 `cells` 已含最新高程，编码器直接丢弃待发增量（否则「不推进仿真连取两帧」会得到不同帧，`test-wasm.js` 的「读档失败不得改动世界」断言正是此口径）。
- 前端 `rustworld.js::_applyTerrainDelta` 就地打补丁：改高程/坡度/flags，重算受影响格及其 4 邻域的法线 / AO / 反照率，bump `dynamicWaterRevision` 触发 GL 几何重传。**故意不动 `minZ`/`maxZ`**：反照率归一化基准必须与全图其余格一致。

---

## 5. 存档

- `WorldSave.fluid_state: Option<FluidSaveState>`（`serde(default)`，旧档缺字段/载荷口径不符 → 读档按地形重新播种）。
- 载荷 = `count` 组 `[x, y, vx, vy, age]` 的 f32 小端字节的**十六进制串**（`PARTICLE_STRIDE = 20` 字节/粒子）：十六进制往返不丢精度 ⇒ 读档续演与不中断运行**逐字节一致**（`test-wasm.js` 硬门禁）。粒子数动态 ⇒ `age`（下渗寿命）与两个补源信用 `rain_credit` / `spring_credit` 必须入档。
- 深度/摩阻派生量不入档（按位置与地形重算，见 §2）；`rest_density` / `revision` 随档携带。
- 体积代价：1600 粒子 ≈ 32KB 原始字节 ≈ 64KB 十六进制文本。
- **侵蚀结果随 `terrain_state`**（完整 `TerrainMap`）持久化；`Erosion` 的逐格**累计量不入档**，读档时由 `World3DEngine::sync_voxel_surface_from_terrain` 以「`terrain.cells[].elevation` − 按种子重建的原始高度场」精确还原，并把侵蚀后的高程回灌到 `VoxelBackend` 权威高度场（否则 `sample_elevation` 与渲染/流体读到的地形分裂）。

---

## 6. 性能与成本

> ★ **成本口径变化**：下表是「创世有预设水体」时代的基线（v1.63.0，播种 ≈1040）。当前全部地图创世无水体格、稳态约 **1300~1440 个坡面漫流粒子**（§2.4，`SHEET_FLOW_LIFETIME=512s`）⇒ Phase 5 按单粒子成本 ≈0.17 µs/tick 线性折算约 **0.22~0.25 ms/tick**，高倍速下重新成为吞吐瓶颈。旧口径保留供对照与回归。

单阶段口径（`world_tick_subphase(5)`，Node / wasm release，seed 4242，常态降雨，含出流/补源/侵蚀）：

| profile / 稳态粒子 | Phase 5 水体求解 | 其余 9 阶段合计 | 整拍合计 |
| :--- | ---: | ---: | ---: |
| `river_valley_v1`（≈1090） | **179.7 µs/tick** | 16.6 µs/tick | ≈196 µs/tick |
| `basin_oasis_v1`（≈1160） | 158.2 µs/tick | 14.0 µs/tick | ≈172 µs/tick |
| `mountain_pass_v1`（仅泉眼，≈90） | 9.8 µs/tick | 12.4 µs/tick | ≈22 µs/tick |

- **单粒子成本 ≈0.17 µs/tick**（≈1.0 µs / 粒子 / 流体步），近似线性 ⇒ 成本几乎全部来自 PBF 子步本身。侵蚀的**固定**开销仅 ≈1~2 µs/tick（逐格循环对无粒子格快速跳过）。
- 折算 1× 实时（60 tick/s）：`river_valley_v1` ≈12 ms / 秒模拟时间（≈1.2% 单核）。
- **倍速上限由粒子数决定**：`river_valley_v1`（≈1090 粒子）约 **84× 实时**；纯泉眼地图（≈90 粒子）远超 128×。⚠️ 高倍速（≥128×）下有水体世界会因本求解器而跟不上实时——这是当前吞吐的主要瓶颈（与 [25 号文](./25-benchmarking.md) 的 Phase 5 口径一致）。
- 前代文档（v1.62.0）记「3000 粒子 0.372 ms/tick」，其世界并非 `river_valley_v1`（该批次的实测世界水体粒子远少于 3000），不可与上表直接相减。

**成本旋钮**（按影响排序）：`FLUID_STEP_TICKS`（推进频率，线性）→ `SUBSTEPS`（子步数，线性）→ 粒子数（近似线性；上限由 `FLUID_MAX_PARTICLES` 封顶，常态由补源 ≈ 出流自动稳定）。

**稳态粒子数**（决定了常态成本，供调参参考；★ 下表为 v1.63.0 有播种时代的口径，v1.64.0 起全部 profile 播种恒 0、常态 ≈1300~1440 漫流粒子，实测见 §2.4）：

| profile | 播种 | 断雨（倍率 0） | 常态（倍率 1） | 暴雨（倍率 5） |
| :--- | ---: | ---: | ---: | ---: |
| `river_valley_v1` | 1040 | ≈1006 | ≈1125 | 1571（上限 1600） |
| `basin_oasis_v1`（内流盆地·无出口） | 1040 | ≈1100 | ≈1271 | 1600（上限，湖持续蓄水） |
| `volcanic_lake_v1` | 1040 | — | ≈1150 | — |
| `mountain_pass_v1` / `alluvial_fan_v1`（无静态水体，仅泉眼） | 0 | — | 94 ~ 283 | 269 |

**物理健康度验收口径**（无对应单测，用一次性探针核对，见 §7）：粒子到最近水体格的平均平面距离应 ≈1.2m、距离分布不随 tick 漂移（水不排空、不上岸）；越界粒子（`|x| > world/2`）与 NaN 必须恒为 0。★ v1.64.0 起无水体格 ⇒ 前两条口径只适用于未来涌现的水体；当前以「越界 = 0 / NaN = 0 / 创世水格 = 0 / 计数值有限」为准（实测见 §2.4）。

---

## 7. 水力侵蚀 / 沉积（`spatial/fluid/erosion.rs`）

> ★ **v1.64.0 现状**：创世不再产生水体格 ⇒ 准入第 1 条恒不满足，**侵蚀当前不产生任何地形改动**（`TerrainDelta` 恒空），本节模型与实现原样保留，待「自然水 + 侵蚀」阶段启用（届时需重新审视准入是否仍限定水体格）。

**定位**：把求解器解出的**流速场**回灌河床——高速水流下切（侵蚀）、缓流区淤积（沉积）。这是水改造地形的唯一写入口。

### 7.1 模型（写意口径）

```text
① 栅格化   每个粒子把 (水柱深度, vx, vy) 累加到所在地形格 → 逐格平均 h 与 v
② 剪应力   τ = ρ g n² |v|² / h^{1/3}      （Manning 口径；ρ=1000、n 与求解器同一常数）
③ 侵蚀/沉积 τ > τ_c  → Δz = −K_e·(τ−τ_c)·dt
            τ < τ_c  → Δz = +K_d·(τ_c−τ)·dt
④ 限幅     单次 |Δz| ≤ DZ_MAX；逐格累计下切 ≤ MAX_INCISION、累计淤积 ≤ MAX_AGGRADE
⑤ 坡度保护 写入后该格坡度必须 ≤ max(当前坡度, 可行走坡度上限 − 余量)，否则 Δz 折半重试
            （最多 8 次；仍不合格则放弃该格）
⑥ 写回     TerrainMap.cells[idx].elevation + slope_angle_deg（同步 VoxelBackend 高度场）
```

**准入（两道格级闸门，先于 ③）**：

1. **只改水体格**：`water_body_id.is_none()` 直接跳过。
2. **深水保护**：`level − bed ≥ MAX_DEPTH(3.0m)` 直接跳过（见 §7.2）。

**节拍**：每 `EROSION_EVERY_FLUID_STEPS`（默认 10）个**流体步**一次，即 ≈ 1 秒模拟时间；`dt` = 对应累计时长。挂在 `tick_counter / FLUID_STEP_TICKS` 的模上（无新增计数器）⇒ 读档后自动对齐。

**为什么只改水体格**：

- 陆地格的高程 / 坡度 / flags 一律不动 ⇒ `corridor::validate_curve`（车道几何校验读 `TerrainMap.cells`）不受影响，既有车道**不会因侵蚀而失配**（读档时的 `validate_terrain_world` 仍必过）。
- 水体格的 `surface_kind` / `water_body_id` / `feature_flags` 也**不变**；只重算坡度。第 ⑤ 步的坡度上限保证不会把可行走浅水格（河谷模板）顶过 `terrain_max_walk_slope` ⇒ 车道可达性语义不变。
- 代价：紧邻河岸的陆地格坡度会略微「过期」（其邻格高程已变），属可接受的增量口径——**渲染侧不受影响**（前端由高程重算法线）。

### 7.2 深水保护（水位—河床解耦的硬边界）

渲染水面是 `z = bed + clamp(level − bed, MIN, MAX_DEPTH)`。**水柱深度一旦被 `MAX_DEPTH` 封顶，任何床面变化都只会平移水面而不再改变水深**：

- 下切 ⇒ 水面随河床一起下沉 ⇒ 视觉上是「湖被抽干 / 露滩」，而不是「河被刷深」；
- 淤积 ⇒ 水面凭空上抬 ⇒ 视觉上是「凭空涨水」。

深水（湖泊）本身也是低能环境，故侵蚀对 `level − bed ≥ MAX_DEPTH` 的格**整体跳过**（侵蚀与沉积都不做）。效果是在**下切仍能加深水体**的河段与浅水边缘照常刷深，而深湖床保持稳定。实测（`basin_oasis_v1`，seed 1790425000007，60 秒模拟）：加闸门前 17584/26537 水体格被改动（最大下切 2.51m，湖面明显收缩）；加闸门后 **460/26537（1.7%）、最大变化 0.91m**，深湖床不再下沉。

### 7.3 深度反馈

水柱深度按粒子**当前位置**逐流体步派生（§2、§3 ①），河床被改写后**下一步自动生效**，无需额外的刷新调用：

- 河道下切 ⇒ 水深增大（至 `MAX_DEPTH=3.0` 封顶）⇒ 水面仍停在水位上，视觉上「河变深」而非「河下沉」；
- 水深增大 ⇒ 摩阻下降、流速上升 ⇒ 侵蚀增强，这条**正反馈**由累计限幅、深水保护与坡度保护共同封顶。

### 7.4 确定性与可复现

- 不消耗 `WorldRng`；累加按粒子下标序，逐格处理按行主序；限幅与坡度保护都是固定迭代次数的纯算术。
- 累计量不入档（§5），由高程差还原 ⇒ 读档续演与不中断运行逐字节一致（`test-wasm.js` 硬门禁）。
- 增量下发是**边沿触发**的（取走即清空）⇒ 与全量地形帧必须互斥（§4）。

### 7.5 实测（Node / wasm release，seed 4242，60 秒模拟时间，含降雨补源与深水保护）

> ★ 本节为 **v1.63.0 口径**（当时创世仍有预设水体）。v1.64.0 起 `water_body_id` 恒为 `None` ⇒ 该表全部计数归零、侵蚀不触发；数据保留供未来「自然水 + 侵蚀」阶段对照。

| profile | 水体格 | 被改动格 | 最大下切 | 最大淤积 | 改动格平均 \|Δz\| | 陆地格改动 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `river_valley_v1` | 4869 | 1708（35%） | 0.92 m | 0.15 m | 0.13 m | 0 |
| `basin_oasis_v1` | 26407 | 566（2%） | 0.96 m | 0.08 m | 0.13 m | 0 |
| `mountain_pass_v1` / `alluvial_fan_v1` | 0 | 0 | — | — | — | 0 |

- 全部用例：**陆地格改动恒为 0**、无 NaN、**无水体格越过可行走坡度上限**。数值较 v1.62.0（2346 格 / 1.14 m / 0.20 m）略小，因为降雨补源改变了稳态粒子的分布与流速场。
- `mountain_pass_v1` / `alluvial_fan_v1` 的静态地形不含水体格（水源为清泉 POI）⇒ **泉眼会造出坡面漫流粒子，但陆地格仍不受侵蚀**（侵蚀准入要求 `water_body_id.is_some()`），故两地形的侵蚀量恒为 0。
- 浏览器端到端（`?nogate=1`，真实 FABS 帧）：解码 `TerrainDelta` 后 `terrain.cells` **就地变更**（数组与格对象引用不变 ⇒ 无 65536 格全量重发），无控制台错误。

### 7.6 明确未做

- **局部水深未横向涌现**：PBF 的不可压缩性强制水柱厚度守恒，`depth` 只随河床变化（§7.3），**不随空间**由流动本身涌现（无深潭/浅滩的横向分布）。若要，需换成 SWE-SPH（浅水 SPH：粒子携带深度、连续方程 + 对称压力梯度）。
- **深湖床不参与侵蚀/沉积**（§7.2 的闸门）：这是本模型「水面 = 河床 + 封顶水深」口径下的必然取舍，不是物理上的「湖床不侵蚀」。
- **降雨只补给粒子，不改水位**：`rainfall_intensity()` 现在驱动补源速率（§2.3），但**不改 `WaterBody.level`**——水位仍由创世期几何固定，故「水面」不会随降雨抬升，只表现为粒子密度变化。前端透明度仍独立读 `rainfallIntensity`。
- **补源速率未按水体面积标定**：`RAIN_SPAWN_RATE` / `SPRING_SPAWN_RATE` 是全局常数，大水体（`basin_oasis_v1` 26407 格）与窄河道用同一产率，故「等量降雨的相对涨落」在大水体上更不明显。
- **泉眼不改变 POI 库存语义**：泉眼粒子是纯流体层补给，与 `PrimitivePoi.current_stock`（取水玩法读的储量）**不互馈**。
- **横向展宽 / 岸线迁移**：侵蚀只改水体格的竖向高程，不改变水体格集合（`water_body_id` 恒定）⇒ 河道不会自行改道或展宽；补源粒子也不会把陆地格变成水体格。
- **沉积物输运**：无挟沙浓度场，沉积按本地剪应力亏欠近似（不守恒质量）。
- **取水点/岸线锚点不随侵蚀更新**：`WaterAccessPoint.pos` 与岸线装饰在创世期算定，河床下切后水面可能低于取水点（纯表现层落差，取水逻辑走 POI 库存与距离判定，不受影响）。

---

## 8. ★ 水系迁移到前端 WebGPU（2026-09-26，v1.66.0）

> **本阶段状态**：水体粒子的运动学**已整体迁移到前端 WebGPU compute**（`frontend/js/water_gpu.js`）。
> 内核 `FluidSim` / `Erosion` **保留但休眠**（不播种、不推进），FABS `Fluid` / `TerrainDelta`
> section 恒缺席，存档 `fluid_state` 恒空 ⇒ **§1~§7 描述的是已退役的内核实现，保留作参考**。
> 当前权威路径见本节；渲染侧契约不变（[18 号文](./18-water-rendering.md) §1.3）。

### 8.1 定位与边界

| 维度 | 事实 |
| :--- | :--- |
| 归属 | **前端表现层**（`frontend/js/water_gpu.js`）：`window.WaterGPU` |
| 定位 | **放弃确定性**（用户决策：以拟真优先、允许小幅差异）——跨显卡 / 跨运行不保证逐位一致 |
| 进快照/存档 | **否**。内核侧专供水粒子的 `Fluid` section 与 `fluid_state` 已无生产点（恒缺席 / 恒 count=0） |
| 进游戏逻辑 | **否**。agent / house / POI / 账本 / 寻路一律不读水（与迁移前一致，见 §2 的消费方穷举） |
| 硬件门槛 | **WebGPU 与 WebGL 同级硬门槛**：`navigator.gpu` / `requestAdapter` 失败由 `main.js` 显示错误覆盖层并保持暂停（**无 CPU 回退路径**；`?watergpu=0` 仅作开发者 A/B 逃生门） |
| 数据输入 | `sim.terrain.cells`（`elev` / `dzdx` / `dzdy` ⇒ 地表高程与坡度，供地面接触）、`sim.rainfallIntensity`、`sim.tickCount`（★ 2026-09-27 **不再读 `sim.pois`**：清泉涌水已删） |
| 数据输出 | `rustWorldSim.fluidParticles`（扁平 `[x,y,z,…]`）、`fluidParticleIds`（**槽位号**，供渲染层抖动哈希）、`fluidFillRadius` / `fluidToneRadius` / `fluidRevision` |

### 8.2 求解结构（WGSL compute）

> **★ 2026-09-27：整体改为真三维（3D PBF）。** 此前阶段（原 2D 深度平均 + 动态水深场 + 渲染端竖直水壁）
> 被判定为「在二维平面上做三维视觉投影」，已**整体删除**。现状是粒子 `z` 为真实自由度的三维求解：
> 3D 核函数、3D 空间哈希、重力沿 −z、地面接触按地形法向投影重力。下文即三维版契约。

同一 shader 模块内 14 个入口，均 `@group(0)` 共享 1 uniform + 3 storage buffer
（vec4 数据 / 原子 u32 / 普通 u32，规避 `maxStorageBuffersPerShaderStage` 默认上限）：

| pass | 内容 |
| :--- | :--- |
| `emit` | 重置存活计数；按降雨信用生成粒子（单 invocation，顺序找空槽）；落地高度取 `bedSample(x,y).x + clearance`。★ 2026-09-27 **删除清泉（`Water` POI）涌水**——粒子唯一水源是降雨 |
| `zeroGrid` | 清零 3D 网格 `cellCount` / `cellCursor` |
| `forcePredict` | 采样地表（`bedSample` ⇒ 高程 + `dzdx/dzdy`）⇒ **贴地时只施加切向重力 `g−(g·n)n`**（n = 地形法向）+ 阻尼 / 触底摩擦 ⇒ 预测位置；顺坡下泄、遇坎跌落全靠此式涌现 |
| `gridCount` / `gridScanA` / `gridScanB` / `gridScanC` / `gridScatter` | 3D 网格空间哈希：原子计数 → **分层前缀和**（块内 256 线程 Hillis-Steele，块数 ≤ 256）→ 散射为有序 id 表 |
| `neighbors` | **3×3×3 = 27 格**收集 `r<h` 的邻居（邻表容量 `waterGpuNeighborCap`，溢出计入 `stats().overflow`） |
| `densityLambda` | 3D poly6 密度 → 仅压缩（`C>0`）求 λ |
| `deltaP` | `(λi+λj+s_corr)∇W_spiky`（3D），限幅 `0.25·spacing`，回写位置 / 速度，并做地面约束 `z ≥ bed+clearance` |
| `viscosity` | XSPH 粘性（3D） |
| `despawn` | 越界（x/y AABB 或 `z > zMax`）/ 超 `LIFETIME` ⇒ 归还槽位；存活粒子写 `outIds`。★ 2026-09-27 **蒸发机制**：age 累积速率按「被水环绕程度」插值（见下） |
| `packOut` | 按存活序连续打包（供回读） |

- **3D 核函数**（`h = 1.9 × spacing`）：poly6 `315/(64π h⁹)(h²−r²)³`、自贡献 `315/(64π h³)`、
  spiky 梯度 `−45/(π h⁶)(h−r)²/r · r⃗`；`mass = spacing³`（体积口径）。
  **静止密度 ρ0** = 简单立方点阵（单位间距、覆盖 `r<h` 的 27 点）的 3D poly6 求和 ≈ 0.998，
  对间距尺度不变 ⇒ 纯常数，与 `mass = spacing³` 口径自洽（孤立粒子 ρ=0.23 ≪ ρ0 ⇒ 不产生虚压力）。
- **3D 网格规划**：格边长基准取 `h`（`±1` 邻域即覆盖支撑域），`cellsX=cellsY=ceil(worldSize/h)`，
  `cellsZ` 由地形高程极值 + `Z_PAD=32m` 余量决定；格数超 `MAX_CELLS` 时按 `cbrt` 放宽格边长重规划
  （保证 `cellIdx ∈ [0, cellsX·cellsY·cellsZ)`）。实测默认世界（`spacing=7.45875`、`cellsX=cellsY=54`）
  **≈ 2.04 万格**（`cellsZ 7`）、`scanBlocks 80`；`spacing=4.9725` 时为 ≈7.2 万格 / `cellsZ 11` / `scanBlocks 141`，
  `spacing=3.315` 时为 ≈22 万格 / `cellsZ 15` / `scanBlocks 219`。
- **常量**：`spacing=7.45875`（★ 2026-09-27 由 3.315 **放大 +50% 至 4.9725，再 ×1.5 至 7.45875**）、
  `h=1.9×spacing≈14.17m`、`g=9.81`、`MAX_SPEED=12`、`DAMPING=0.10/s`、`VISCOSITY_C=0.06`、
  `s_corr k/n=0.06/4`、`CONTACT_FRICTION=0.04/步`、`clearance=0.35×spacing≈2.61m`、`dt=0.1s`（每 6 sim tick 一步）。
  原 2D 口径的 `MANNING_N` / `MIN/MAX_DEPTH` 已随水深场删除；原 `SPRING_VZ` 已随清泉涌水一并删除。
- **补源速率（2026-09-27 起仅降雨）**：★ **删除清泉（`Water` POI）涌水**，粒子唯一水源是**降雨**。
  **降雨 `RAIN_RATE = 40/s`（强度 1.0，以 764m 基准地图标定，并按 `(worldSize/764)²` 随地图面积等比缩放；
  ★ 2026-09-27 由 20/s **翻倍**，补偿蒸发机制的耗散）**、信用上限 32；滑块对粒子数有清晰、单调、可见的驱动。
- **★ 蒸发机制（2026-09-27）**：粒子的 `age` 累积速率随「被水环绕程度」线性插值——
  `t = clamp(邻居数 / EVAP_FULL, 0, 1)`、`rate = mix(EVAP_EXPOSED, EVAP_SURROUNDED, t)`、`age += dt × rate`。
  邻居数取本步 `neighbors` pass 写入的 `offNeighCount`（3D 支撑域内静止 ≈26、薄水膜 ≈11、孤立 = 0）。
  常量：`EVAP_EXPOSED = 16`（完全孤立 ⇒ 寿命 ≈ 32s）、`EVAP_SURROUNDED = 1`（被环绕 ⇒ 寿命 = `LIFETIME` = 512s）、
  `EVAP_FULL = 20`（视为「被完全环绕」的邻居数阈值）⇒ 深水体/水团中心几乎不蒸发、孤立雨滴与薄水膜快速蒸发。
- **★ 三维行为（2026-09-27，修「平面水」）**：`z` 不再是「河床 + 常量/查表水深」，而是粒子真实自由度。
  雨水落地即沿坡面下泄（切向重力），在洼地/沟谷聚成**有纵深的水体**（PBF 不可压缩 ⇒ 逐层堆叠、水面抬升），
  落差处可直接跌落。**实测**（默认世界、降雨 5（上限）、8m 水平分桶）：`spacing=7.45875` 下
  共 5589 个桶、其中 ≥2 粒的 4326 个，逐桶 z 跨度均值 3.87m、最大 20.27m，跨度 >3m 的桶 2003 个
  （`spacing=4.9725` 时为 ≈4200 列 / 1.75m / 11.9m / 885 个，`spacing=3.315` 时为 3702 列 / 0.83m / 7.07m / 368 个）；
  各间距档都远优于「铺满全图 ≈1.05 万列的一粒子厚薄片」。
- **⚠️ rest spacing 是「目标」而非「硬下限」**：PBF 密度约束**只在压缩（`C>0`）时产生压力**、不约束拉伸，
  密集水柱/汇流团内部粒子可以挤得比 `spacing` 更近；`r≈0` 时 `spikyGrad` 退化为 0（重合粒子无法被推开）。
  实测「逐粒子最近邻距离均值」≈2.2m（`spacing=4.9725`）低于 `spacing` 即源于此，属**既知性质**，
  不是间距参数失效（网格规划与活动半径均已按 `h` 正确缩放）；若需硬下限，须引入拉伸约束或做 `r→0` 正则化。
- **诊断字段语义**：`readbackMs` 是「提交 → 回读数据被消费」的**往返延迟**（至少含 1 帧调度，非纯 GPU 耗时）；
  `dispatchMs` 只是 JS 侧编码/提交耗时（GPU 时长未测）。`overflow` = 邻表容量溢出计数（稳态应为 0；
  汇流水团 / 冲击瞬态会短暂升高）。⚠️ **降雨顶格（强度 5、`alive` 逼近 2 万上限）时密集团块可让单粒子邻居数超
  `waterGpuNeighborCap=64`**，实测 `overflow` 达 ≈2.4 万（超容量邻居被丢弃、计入该累计计数，不影响守恒等式）；
  常规强度（默认 1.0，`alive≈3800`）下 `overflow=0`。`stats()` 另报 `cells` / `cellsZ` / `scanBlocks` 便于核对网格规划。
- **诊断**：`counters` 记录 `alive / 邻表溢出 / 累计生成 / 出流销毁 / 寿命销毁`，随每帧回读暴露在
  `window.WaterGPU.stats()`；URL 加 `wgdebug` 时每 40 帧打印一行，便于无浏览器环境下取证。
  质量守恒口径：`spawnTotal = alive + outflow + expire`（实测逐位对平）。
- **显示粒径与求解间距解耦**（基准 `RENDER_SPACING_BASE = 4.42m`）⇒ 抬升 `spacing` 不改单粒子显示大小。
- **步进**：物理 dt 恒 0.1s，由 `tickCount` 差驱动 `floor(Δ/6)` 步并封顶
  `waterGpuMaxStepsPerFrame`（默认 6，高倍速下水允许滞后）；暂停时不步进。
- **⚠️ 缓冲用途（踩坑）**：三个 storage buffer（vec4 / 原子 u32 / 普通 u32）**必须同时带
  `COPY_DST`**——地形高程/槽位置空都走 `queue.writeBuffer`；缺 `COPY_DST` 时 WebGPU 报
  「usage doesn't include CopyDst」并**静默丢弃整次写入**，现象是「求解器 step 在涨但 alive/spawnTotal 恒 0」。

### 8.3 回读与生命周期

- 3 个 staging buffer 轮转 + `mapAsync(READ)`；**不在同帧 await**，成功后写 ping-pong
  `Float32Array`（`fluidParticles` 每帧换引用触发渲染层重建视图）。
- 回读**每帧一次**（只在当帧最后一个流体步之后打包），布局 = `counters(40B，含 want 诊断) + 填充 + pos(N×16B) + ids(N×4B)`。
- **世代号守卫**：`restartWorld()`（由 `rustworld.js::_invalidateWorldStaticCaches` 在
  READY / LOAD_RESULT / REWIND_RESULT / RESET_DONE 调用）递增 `_gen` 并置空缓冲；
  在途回读若 `gen !== _gen` 直接丢弃，杜绝上一世界位置写回。
- **槽位号稳定**：死槽原地归还、由补源复用 ⇒ `fluidParticleIds` 帧间稳定，
  渲染层抖动哈希改用它（无 ids 时回退渲染下标），避免压缩造成纹理跳变。

### 8.4 渲染端扩容安全阀

- 求解上限 `waterGpuMaxParticles = 20000`；渲染端另有 `waterRenderMaxParticles = 8000`
  步进抽样（模拟仍全量，只限制每帧入队/绘制规模），避免逐粒子 CPU 三角化成为新瓶颈。
- 渲染仍走 `water_particles.js → render_depth_queue.js → WebGLAccentLayer` sink 与
  `DEPTH_WATER_PARTICLE` 深度队列 + GL 深度测试；**不得**为水新增独立画布 / 整层绘制。

### 8.5 明确未做 / 已知代价

- **侵蚀退役**：水不再在内核 ⇒ 水力侵蚀（原 §7）失去输入，有水体格的模板不再被水流改造地形。
- **水不进存档**：读档 / 回溯 / 重置后水面从降雨重新生长（符合「放弃确定性」的约定）。
- **水源仅降雨**：★ 2026-09-27 删除清泉（`Water` POI）涌水 ⇒ 断雨（降雨倍率 0）时不再有稳定的泉眼基流，
  地图水量完全由降雨滑块驱动；POI 泉眼的**储量/取水玩法**（`PrimitivePoi.current_stock`）不受影响。
- **无 WebGPU 即无游戏**：这是刻意选择（硬门槛），不是降级。
- **渲染仍是写意扁平菱形**：粒子 `z` 已三维化，但逐粒子落笔仍是压扁菱形（沿用旧观感），
  不按太阳方向做球体着色/高光；「读不出立体」是**表现层取舍**，不是求解问题——若需更强立体感，
  须在 sink 通道内改图元（**不得**另起画布）。
- **渲染瓶颈**：2 万粒子的 instanced 绘制通道尚未实现（当前用抽样安全阀兜底）；实测不足时应补 instanced 提交。
- **`FLUID_STEP_TICKS` / `SHEET_FLOW_LIFETIME` 等内核常量已不生效**（休眠代码保留原值）。
