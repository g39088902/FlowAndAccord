# decisions · 部落民决策状态机 (AGENTS.md)

> 本目录局部操作指南。全局规则以根目录 `AGENTS.md` 为准（§4.2 寻路重路由 / §4.3 决策节拍 / §4.11 自主决策原则），本文件只收录本目录的职责边界、文件清单与局部易踩坑。

---

## 1. 📂 目录职责

单名族人的**马斯洛需求决策状态机**：从"生理自救 → 安全备货 → 归属成家 → 尊重建材 → 自我实现淘金"逐层评估需求，并以 `PrimitiveActionState` 状态机驱动寻路、途中重路由、现场采收等动作。本目录**只产出"做什么/去哪"的决策**，不负责数值结算（代谢/装卸/施工/修缮的结算分别在 `ecology.rs` 与 `housing_system/`）。

## 2. 📁 文件清单（7 个文件）

| 文件 | 职责 |
| :--- | :--- |
| `mod.rs` | 模块声明与重导出（对外仅暴露 `needs::*` 与 `evaluate::*` 的类型） |
| `needs.rs` | 需求领域模型：`MaslowLevel`/`NeedKind`/`Need`/`NodePool`/`DecisionContext`/`ResourceNode`，以及家宅缺料查询与前端需求标签 |
| `evaluate.rs` | `Decisioner` 结构体 + 核心调度 `decide` + 马斯洛逐层评估 `evaluate_needs` + 需求落地 `fulfill_resting_need`（含立宅自主选址） |
| `routing.rs` | 导航层：寻路派发、`turn_around_and_route_to`（原地掉头）、`return_home`、POI 私有触发器查询 |
| `seeking.rs` | 途中熔断与平滑重路由：`decide_seeking_material`/`decide_seeking_survival`（根 AGENTS.md §4.2 核心） |
| `harvest.rs` | 现场采收完成判定：饮水/采食/伐木/采石/淘金 + 仓储满额查询 |
| `scheduler.rs` | World 级调度：`tick_decisions`（错峰决策 + POI 观测推送）与 `build_decision_context`（收集全图资源节点） |

## 3. 🧱 关键结构

- **`Decisioner<'a>`**：单 Agent 决策器，持有全部只读上下文（`ctx`/`network`/`houses`/`rng`/`config`）；多个 `impl` 块分布在 routing / evaluate / harvest / seeking 四个文件中，方法全 `pub`，跨文件互调零障碍。
- **`DecisionContext`**：每 tick 由 `build_decision_context` 重建的全图资源节点集合；**是否可用由每个 Agent 的私有触发器过滤**，`needs.rs` 不判断可用性。
- **`Need { level, kind, target_state }`**：一条需求判定结论，`evaluate_needs` 返回、`fulfill_resting_need` 落地。

## 4. ⚠️ 本目录局部易踩坑

> 全局约束（决策节拍、施密特触发器阈值、闪现禁令、RNG 确定性、自主决策原则）见根 AGENTS.md §4.2/§4.3/§4.11，此处不重复。

### 4.1 POI 触发器只读取结论

选点与重路由**只读取** `agent.poi_is_seekable(poi_id)` 的锁存结论，**绝不**在此目录内直接读 `poi.current_stock` 判断可用性。`is_target_poi_unavailable` 在目标 POI 被关闭或自身无任何同类可用点时返回 true。

### 4.2 RNG 消费点

`Decisioner.rng` 指向全局 `WorldRng`，按 agents 顺序依次消费。本目录内 RNG 消费只在两处：`evaluate.rs`（立宅掷点）与 `harvest.rs`（随机挑同类 POI）。新增随机消耗必须保持确定性顺序。

### 4.3  dispatch 成功才改写状态

`dispatch` 寻路成功后才改写 `agent.state`/`route`/`current_lane_id` 等字段；中途掉头走 `turn_around_and_route_to` 在当前车道反向平滑回走，`return_home` 同样优先掉头而非重新派发。

### 4.4 立宅选址掷点

`FoundHome` 在 `fulfill_resting_need` 内由 agent 自己掷 `decision_found_home_candidates`(12) 个候选点、按 `house_min_spacing` 自检，存 `pending_house_pos`；系统仅由 `housing_system/settlement.rs::materialize_founded_houses` 实体化。选址掷点消耗共享 RNG，改动候选数/距离/间距必须走 `SimConfig`（`decision_found_home_*`）。

### 4.5 淘金冷却三处联动

`GoldWealth`（娱乐淘金）冷却 180s，`StockGold`（备料）冷却 45s；`fulfill_resting_need` 与 `seeking.rs`/`harvest.rs` 三处按 `is_building_stock` 区分设置冷却，改动时三处联动。

### 4.6 无家宅 Agent

`home_house_id.is_none()` 的 agent 不装载行囊、只在现场自饮自食；`wood/stone_fully_stocked` 等仓储查询在无家宅时返回 true（视为已满足）。
