# sim_core · 确定性仿真内核 (AGENTS.md)

> 本目录局部操作指南。全局规则以根目录 `AGENTS.md` 为准，本文件只收录本 crate 的模块布局、关键类型与局部不变量。
> 子目录专项指南：`src/spatial/decisions/AGENTS.md`、`src/spatial/housing_system/AGENTS.md`、`src/spatial/ledger/AGENTS.md`。

---

## 1. 📂 目录职责

Flow & Accord 的**确定性仿真核心库**（edition 2021，零运行时依赖，仅 `petgraph`/`serde`/`serde_json`）。对外提供：统一动态超参配置（`SimConfig`）、零依赖确定性 PRNG（`WorldRng`）、地形与生物地理（`geo`）、空间仿真主体（`spatial`：世界推进 / 路网 / Agent / POI / 房屋 / 快照 / 决策 / 房屋系统 / 经济账本）。`sim_wasm` 桥接层直接消费本 crate 的 `World3DEngine` 与快照类型。

## 2. 📁 模块布局

| 路径 | 职责 |
| :--- | :--- |
| `Cargo.toml` | 依赖：`petgraph 0.6`、`serde 1.0 (derive)`、`serde_json 1.0` |
| `src/lib.rs` | crate 根，声明 `config`/`rng`/`geo`/`spatial` 并集中 re-export 对外类型 |
| `src/config.rs` | **全部超参的单一归档点**：模块级 `pub const` + `SimConfig` 结构体 + `Default` 映射 |
| `src/rng.rs` | `WorldRng`：xorshift64* 确定性 PRNG（无 rand 依赖，wasm32 安全） |
| `src/geo/mod.rs` | geo 模块声明，`GeoCell`（高程+坡度栅格单元） |
| `src/geo/terrain.rs` | `TerrainMap`：自然地形生成 + 世界坐标高程采样 |
| `src/geo/biome.rs` | 生物群系判定（基于高程/坡度/温度的生态分区） |
| `src/spatial/` | 世界主体（详见 §3） |

## 3. 🗺️ spatial 模块地图

| 文件/子目录 | 职责 |
| :--- | :--- |
| `world.rs` | `World3DEngine` 主结构；`tick()` 全序推进；`generate_snapshot()` 快照导出；确定性构建；季节/温度；金币遗产继承 |
| `agent.rs` | `Agent3D` 字段、`PrimitiveActionState` 状态机、代谢/运动、施密特触发器 |
| `ecology.rs` | 生态初始播撒（POI + 路网 + 20 名始祖）、POI 交互（装载/卸货/吃喝/淘金/分娩委托） |
| `graph.rs` | 路网数据与加权 A* 寻路、道路衰减 |
| `poi.rs` | `PrimitivePoi`（储量/再生/提取/营地行政级别） |
| `house.rs` | `House`/`HouseTier`（容量/耐久/`is_pantry_full` 升级门槛） |
| `birth.rs` | 妊娠/分娩/代际结算 |
| `bookkeeping.rs` | ★ M2 旁路记账与家户经济规则（`tick_bookkeeping`：Deposit/Consume/Heating 观测 + Inheritance 继承清算 + Split 分家抽资，只追加账本流水不动物理库存） |
| `snapshot.rs` | `WorldSnapshot3D` 全部快照结构体（前端字段三处同步之一） |
| `vec3.rs` / `curve.rs` | 几何基础（`Vec3` / Bezier `Curve3D`） |
| `mod.rs` | spatial 模块声明与 re-export |
| `decisions/` | 马斯洛决策状态机 → **见 `decisions/AGENTS.md`** |
| `housing_system/` | 私宅全生命周期 → **见 `housing_system/AGENTS.md`** |
| `ledger/` | 独立经济账本 → **见 `ledger/AGENTS.md`** |

## 4. 🧱 关键类型不变量

- **`WorldRng`**：xorshift64*，状态仅一个 u64。seed 0 被静默替换为黄金比例常数；`gen_normal`（Box-Muller）恰好消耗 2 个均匀数；`gen_range_usize` 在 `high <= low` 时返回 `low`（不 panic）。
- **`SimConfig`**：163 个字段，前端 `config.js` 按 camelCase 键注入，缺省回落默认值。`config.rs` 是数值唯一真相源（见根 AGENTS.md §4.12）。
- **`TerrainMap`**：`sample_elevation` 为最近邻采样（无插值），归一化坐标 clamp 到 [0.0, 0.999]。
- **`World3DEngine`**：世界总管理器，一切世界级系统方法以 `impl World3DEngine` 分散挂载。
- **`Agent3D`**：部落民实体（生理/行囊/血缘/禀赋/`poi_seekability` 私有触发器表）。
- **`LaneGraph3D`**：`DiGraph<NodeData, LaneEdge3D>` 有向路网，加权 A* 寻路。**从不删除节点/车道**（无 `remove_node`），空置节点靠复用来遏制膨胀。

## 5. ⚠️ 本 crate 局部易踩坑

> 全局硬约束（决策节拍、随身搬运、快照同步、超参集中化等）见根 AGENTS.md §4，此处不重复。

### 5.1 tick 全序的子步骤细节

根 AGENTS.md §4.3 给出了大顺序。本 crate 内需注意：金币遗产继承（`settle_gold_inheritance`）在代谢/繁衍之后、POI 交互之前执行；POI 交互中的分娩委托会 push 新 agent，**push 后必须 `rebuild_agent_index()`**。

### 5.2 RNG 消费者的确定性分布

`WorldRng` 全局共享，但不同子系统的消费顺序必须固定：
- **生态播撒**：按固定顺序 roll（营地名 → 各 POI → 过渡节点 → 属性）；
- **决策**：立宅掷点 / 随机挑 POI，按 agents 顺序消费；
- **`birth.rs::resolve_newborns`**：先 `gen_bool(0.5)` 定性别、再逐性状 `gen_range`，顺序敏感；
- **地形生成**：使用**局部** RNG（消费顺序固定：角度 → 幅度 → 4 相位），不污染全局 RNG。

新增任何随机消耗必须保持上述固定调用顺序，否则同种子逐字节校验失败。

### 5.3 尸骸清理与索引重建

`retain(is_alive || death_decay_timer > 0)` 清理尸体后**必须**调用 `rebuild_agent_index()`；push 新 agent（分娩）后同样需要。遗漏会导致按 ID 查找失效。

### 5.4 死亡判定

三种死亡方式均清空怀孕并重置尸骸倒计时：饥饿 ≤ 0 饥荒 / 口渴 ≤ 0 脱水 / 健康 ≤ 0 寿终。

### 5.5 修改后验证

以 `node tools/test-wasm.js` 回归为准（确定性/防越界/防 NaN）；临时单元测试验证后必须删除（根 AGENTS.md §4.10）。
