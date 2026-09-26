# 33. 运行时水体求解器（Runtime Fluid / PBF）

> **状态**：★ **已实现**——水面由 **Rust 内核的粒子流体求解器**（Position Based Fluids，深度平均域）推进，粒子位置随每帧 FABS 快照的 `Fluid` section 下发；前端只按既有画风渲染内核粒子（[18 号文](./18-water-rendering.md) §1.3）。**水力侵蚀 / 沉积**（§7）已落地：流速场回灌河床，高程改动随 `TerrainDelta` section 增量下发。
> **开放水循环**（§2.3）：边界不再硬夹紧（水从地图边缘流出），并由**降雨**（全图落点）与**泉眼**（`WaterSource` POI）补源，坡面漫流粒子有下渗寿命 ⇒ 粒子总数是模拟期动态量。
> **范围**：水体粒子播种、PBF 约束求解、地形坡度重力与 Manning 摩阻、开放边界出流、降雨/泉涌补源与寿命淘汰、快照协议、存档位精确持久化、侵蚀/沉积地形反馈。
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

- **粒子 = 一根水柱**：质量 `spacing²`（`spacing = 4.42m`），水平占位在求解中守恒。
  ★ 目标间距由 2.6m **提升 70%**（`×1.7`）⇒ 单粒子代表的水体面积 `spacing²` 变为 2.89 倍；
  同一水体铺满所需粒子数按 `1/1.7²` 下降（播种预算 3000 → 1040 与之一致）。
- **播种源** = 地形水体格（`GeoCell.water_body_id.is_some()`，按行主序收集）。水体格 < 4 且无泉眼时整体禁用（地图页 / 无水体且无泉眼 profile 不下发 section）。
- **预算**：`min(FLUID_SEED_BUDGET=1040, 水体格数 × MAX_PER_CELL=1)`；每个粒子按下标比例均匀铺到水体格上，格内抖动由 `seed ^ SEED_SALT` 的**局部** `WorldRng` 给出 ⇒ 确定性且不污染全局 RNG 消费序。余量（上限 `FLUID_MAX_PARTICLES=1600`）留给补源的瞬态粒子。
- **水柱深度** = `clamp(水体水位 − 河床, 0.35, 3.0)`，**按粒子当前位置**取格（不是播种格）；陆地处取 `MIN_DEPTH`。位置随存档位精确恢复 ⇒ 深度无需入档，且雨滴/泉水汇入河道后立刻取到该水体的厚度。渲染面因此恒等于 `z_bed + clamp(水位 − z_bed, MIN, MAX)`，与 §1 的模型同式。
- **静止密度** `ρ0` = 播种构型下的**平均密度**（实测而非硬编码）⇒ 初始构型无压力爆炸；PBF 只约束压缩（`C > 0`），自由表面粒子不被拉回内部。泉眼地图（无静态水体、无播种构型）改用 `FluidSim::new` 里 5×5 六方点阵测得的**理想堆积密度**兜底。
- **实际间距** `spacing_eff = √(水体格总面积 / 播种预算)`：预算不足时大于 `spacing`（水更稀），前端据此反推粒径维持「粒子即水面」读感。⚠️ 它是**静态**量（只依赖水体面积与预算，不随动态粒子数漂移）。

### 2.3 补源（降雨 + 泉涌）

```text
每流体步（dt = 0.1s 模拟时间）：
  降雨  速率 = RAIN_SPAWN_RATE(1.2/s) × rainfall_intensity()     落点 = 全图均匀随机
  泉眼  速率 = SPRING_SPAWN_RATE(0.3/s) × 泉眼数                   落点 = POI 坐标 ± SPRING_JITTER
  信用  credit += 速率 × dt；够 1 个才生成，credit ≤ SPAWN_CREDIT_MAX(4) 封顶
```

- **降雨落点覆盖全图**（不只是水面）：雨滴落在陆地即成为**坡面漫流**粒子，顺坡汇入河道；这也是「降雨把水带入地图」的表现层含义。
- **泉眼** = `PoiType::WaterSource`（低洼清泉 POI）坐标，由 `World3DEngine::tick_phase_fluid` 每 tick 用 `FluidSim::refresh_springs` 刷新（**容量复用 ⇒ 稳态零分配**）。泉眼为地下水补给，**不随降雨强度变化**，因此是山口 / 冲积扇等**无静态水体**地图的唯一水源——这类地图的流体求解器由泉眼而非 `enabled` 单独驱动。
- **确定性**：落点走 `seed ^ SPAWN_SALT ^ tick_counter` 的局部 PRNG，**不消耗 `WorldRng`**；同一 tick 的落点逐位相同，`credit` 随存档携带 ⇒ 读档后补源序列完全对齐。
- **前端启用门槛**：因为水可能出现在**没有任何水系特征**的地形上，`WaterParticles.init` 恒启用、`render_depth_queue.js` 无条件调用 `update`——「有没有水」唯一由本 section 决定（缺席即清空）。⚠️ 曾以 `terrain.features.length` 作门槛，导致这类地形上内核有粒子而画面全干（见 [18 号文](./18-water-rendering.md) §1.3）。

### 2.4 出流与下渗（耗散）

- **边界开放**：③ 段不再把位置夹紧到世界 AABB；粒子越出 `±world_size/2` 即在下一次 `despawn` 中被移除（水从地图边缘流出）。河道两端本就触达地图边界，故出海口是天然的汇。
- **坡面漫流寿命**：粒子的 `age` 每步累加 `dt`，**落在水体格上立刻清零**（正式并入水体）；非水体格上超过 `SHEET_FLOW_LIFETIME(30s)` 即下渗消失。这是「全图降雨」不淤积的必要闸门——否则陆地薄水粒子会永久占满粒子上限。
- 移除用**末尾粒子顶替**（`swap_remove`）⇒ 每次只扰动一个粒子的绘制下标（前端视觉抖动按粒子下标哈希派生，整体左移会造成大片纹理跳变）。
- **稳态水量**：实测出流速率 ≈ 0.3%/秒 × 粒子数，故 `RAIN_SPAWN_RATE` 取 1.2/s（≠0 的常态降雨）时**补源 ≈ 出流**，河道稳定在播种水位附近；暴雨（倍率 5 ⇒ 强度 ≈6）才顶到 `FLUID_MAX_PARTICLES`，断雨（倍率 0）只剩泉眼补给、河道缓慢回落。

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

**稳态粒子数**（决定了常态成本，供调参参考）：

| profile | 播种 | 断雨（倍率 0） | 常态（倍率 1） | 暴雨（倍率 5） |
| :--- | ---: | ---: | ---: | ---: |
| `river_valley_v1` | 1040 | ≈1006 | ≈1125 | 1571（上限 1600） |
| `basin_oasis_v1`（内流盆地·无出口） | 1040 | ≈1100 | ≈1271 | 1600（上限，湖持续蓄水） |
| `volcanic_lake_v1` | 1040 | — | ≈1150 | — |
| `mountain_pass_v1` / `alluvial_fan_v1`（无静态水体，仅泉眼） | 0 | — | 94 ~ 283 | 269 |

**物理健康度验收口径**（无对应单测，用一次性探针核对，见 §7）：粒子到最近水体格的平均平面距离应 ≈1.2m、距离分布不随 tick 漂移（水不排空、不上岸）；越界粒子（`|x| > world/2`）与 NaN 必须恒为 0。

---

## 7. 水力侵蚀 / 沉积（`spatial/fluid/erosion.rs`）

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
