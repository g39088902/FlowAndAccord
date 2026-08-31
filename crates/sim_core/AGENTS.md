# sim_core · 确定性仿真内核 (AGENTS.md)

> 本文件是 `crates/sim_core/` 目录的局部操作指南，供智能体/开发者改此 crate 代码前阅读。
> 全局规则以根目录 `AGENTS.md` 为准，本文件只收录本 crate 的模块布局、关键类型与确定性不变量。
> 子目录专项指南：`src/spatial/decisions/AGENTS.md`（决策状态机）、`src/spatial/housing_system/AGENTS.md`（房屋系统）。

---

## 1. 📂 目录职责

Flow & Accord 的**确定性仿真核心库**（edition 2021，零运行时依赖，仅 `petgraph`/`serde`/`serde_json`）。对外提供：统一动态超参数配置（`SimConfig`，前端 JSON 可热更新）、零依赖确定性 PRNG（`WorldRng`）、栅格地形与生物地理（`geo`）、以及空间仿真主体（`spatial`：世界推进 / 路网 / Agent / POI / 房屋 / 快照 / 决策 / 房屋系统）。`sim_wasm` 桥接层直接消费本 crate 的 `World3DEngine` 与快照类型。

## 2. 📁 模块布局

| 路径 | 职责 |
| :--- | :--- |
| `Cargo.toml` | 依赖：`petgraph 0.6`、`serde 1.0 (derive)`、`serde_json 1.0` |
| `src/lib.rs` | crate 根，声明 `config`/`rng`/`geo`/`spatial` 并集中 re-export 对外类型（`World3DEngine`、`Agent3D`、`LaneGraph3D`、`WorldSnapshot3D` 等） |
| `src/config.rs` | **全部超参数的单一归档点**：模块级 `pub const` + `SimConfig` 结构体，`Default` 逐一映射同名常量，`#[serde(default, rename_all = "camelCase")]` 支持前端 JSON 热更新 |
| `src/rng.rs` | `WorldRng`：xorshift64* 确定性 PRNG（无 rand 依赖，wasm32 安全），同种子完全可复现 |
| `src/geo/` | `GeoCell`（高程+坡度栅格单元）/ `TerrainMap`（自然地形生成 + 世界坐标高程采样） |
| `src/spatial/` | 世界主体（详见 §4） |

## 3. 🧱 关键类型

- **`WorldRng`**：xorshift64*，状态仅一个 u64；`new(seed)`（⚠️seed 0 被静默替换为黄金比例常数 `0x9E37_79B9_7F4A_7C15`）；`gen_f32` 用 `next_u64() >> 40` 高 24 位；`gen_normal`（Box-Muller）**恰好消耗 2 个均匀数**且 `u1` 钳制 1e-7 防 `ln(0)`；`gen_range_usize` 在 `high <= low` 时返回 `low`（不 panic）。
- **`SimConfig`**：全部动力学/代谢/生态/房屋/决策/季节/路网超参数；前端 `config.js` 按 camelCase 键注入，缺省回落默认值。
- **`TerrainMap`**：`generate_natural_landscape(seed)` 生成全局倾斜大势（±27~33m）+ 大小双尺度谐波 + 中心差分坡度；`sample_elevation` 为**最近邻采样**（无插值），归一化坐标 clamp 到 [0.0, 0.999]。
- **`World3DEngine`**：世界总管理器（terrain/network/pois/houses/agents/共享 rng/tick_counter/config/agent_index），一切世界级系统方法均以 `impl World3DEngine` 分散挂载。
- **`Agent3D`**：部落民实体（生理/行囊/血缘/禀赋/`poi_seekability` 私有触发器表）。
- **`LaneGraph3D`**：`DiGraph<NodeData, LaneEdge3D>` 有向路网 + node_map/edge_map，加权 A* 寻路。

## 4. 🗺️ spatial 模块地图

| 文件/子目录 | 职责 |
| :--- | :--- |
| `world.rs` | `World3DEngine` 主结构；`tick()` 全序推进；`generate_snapshot()` 快照导出；`new_seeded*` 确定性构建；季节/温度；`settle_gold_inheritance`；`find_nearest_node`/`find_nearest_camp_node` |
| `agent.rs` | Agent3D 字段、`PrimitiveActionState` 16 态状态机、`tick_metabolism`/`tick_movement`、施密特触发器（`observe_poi_stock_with_config`/`poi_is_seekable`） |
| `ecology.rs` | 生态初始播撒（POI + 路网 + 20 名始祖 10男10女）、`tick_poi_interactions`（装载/卸货/吃喝/淘金/分娩委托） |
| `graph.rs` | 路网数据与 `find_path_3d_with_preference`（A* 加权）、`tick_wear_decay` 道路衰减 |
| `poi.rs` | `PrimitivePoi`（储量/再生/提取/营地行政级别） |
| `house.rs` | `House`/`HouseTier`（容量/耐久/`is_pantry_full` 升级门槛） |
| `birth.rs` | 妊娠/分娩/代际结算 |
| `snapshot.rs` | `WorldSnapshot3D` 全部快照结构体（**前端字段三处同步之一**） |
| `vec3.rs` / `curve.rs` | 几何基础（`Vec3` / Bezier `Curve3D`） |
| `decisions/` | 马斯洛决策状态机 → **见 `decisions/AGENTS.md`** |
| `housing_system/` | 私宅全生命周期 → **见 `housing_system/AGENTS.md`** |

## 5. ⚠️ 本 crate 易踩坑与不变量

### 5.1 tick 全序不可打乱（`world.rs`）
`tick(dt)` 内部顺序：季节/温度 → POI 再生 → 代谢/繁衍 → 金币遗产继承 → POI 交互(装载/卸货/分娩) → 房屋系统(`tick_housing`) → 决策(`tick_decisions`) → 道路衰减 → 运动。**卸货发生在决策之前**，决策看到的是卸货后的仓库状态。

### 5.2 共享 RNG 确定性
`WorldRng` 全局共享，按 agents 顺序消费；生态生成按固定顺序 roll（营地名→各 POI→过渡节点→属性）。**新增任何随机消耗必须保持固定调用顺序**，否则 `tools/test-wasm.js` 同种子逐字节校验失败。RNG 消费者除生态播撒与决策（立宅掷点/随机挑 POI）外，还有 `birth.rs::resolve_newborns`（先 `gen_bool(0.5)` 定性别、再逐性状 `gen_range`，顺序敏感）。地形生成用**局部** RNG（消费顺序固定：角度→幅度→4 相位）。

### 5.3 快照三处同步（改字段必做）
新增 agent/house/poi 字段：① `snapshot.rs` 结构体定义；② `world.rs::generate_snapshot()` 赋值；③ 前端 `rustworld.js::_applySnapshot()` 映射。三处缺一不可。

### 5.4 常量双轨制
每个 `SimConfig` 字段必须与同名模块级 const 值一致（`Default` 是唯一接线点）；改常量须同步改 `Default`。**config.rs 是本 crate 数值的唯一真相源**，根文档/CURRENT.md 中的旧数值可能滞后（如 POI 储量上限 config 为 100、ecology 播撒时以 `stock_max_*` 覆盖为 100 且初始 75）。

### 5.5 行为硬约束速查（详见根 AGENTS.md §4.8）
- `SIMULATION_DT = 1/30` 严禁修改；倍速走 `world_tick_steps`。
- 行囊：水/粮/木/石每类独立 50.0 互不共享，仅 `home_house_id.is_some()` 才装载；金容量无限单趟 20。
- 0 级仓库不扣生活水粮（`tier != Tier0Warehouse` 才允许仓库吃喝）。
- 施密特触发器：开启 ≥30% / 关闭 <10% / 中间带保持前态；未观察 POI 默认不可派遣；构造断言关闭阈值 ≤ 开启阈值。
- 尸骸清理：`retain(is_alive || death_decay_timer > 0)` 后**必须** `rebuild_agent_index()`；push 新 agent 后同样需要。
- POI ID 段位：营地 1~5、清泉 10~15、浆果 20~25、林木 30~32、石矿 40~41、金矿 50；空间排斥 ≥70m。
- 死亡判定：饥饿 ≤0 饥荒 / 口渴 ≤0 脱水 / 健康 ≤0 寿终；三种均清空怀孕并重置尸骸倒计时。

### 5.6 修改后验证
以 `node tools/test-wasm.js` 回归为准（确定性/防越界/防 NaN）；临时单元测试验证后必须删除（根 AGENTS.md §4.10）。
