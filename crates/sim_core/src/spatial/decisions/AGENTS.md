# decisions · 部落民决策状态机 (AGENTS.md)

> 本文件是 `crates/sim_core/src/spatial/decisions/` 目录的局部操作指南，供智能体/开发者改此目录代码前阅读。
> 全局规则以根目录 `AGENTS.md` 为准，本文件只收录本目录的职责边界与局部易踩坑。

---

## 1. 📂 目录职责

单名族人的**马斯洛需求决策状态机**：从"生理自救 → 安全备货 → 归属成家 → 尊重建材 → 自我实现淘金"逐层评估需求（`evaluate.rs`），并以 `PrimitiveActionState` 状态机驱动寻路（`routing.rs`）、途中重路由（`seeking.rs`）、现场采收（`harvest.rs`）等动作。本目录**只产出"做什么/去哪"的决策**，不负责数值结算（代谢/装卸/施工/修缮的结算分别在 `ecology.rs` 与 `housing_system/`）。

## 2. 📁 文件清单

| 文件 | 职责 |
| :--- | :--- |
| `needs.rs` | 需求领域模型：`MaslowLevel`/`NeedKind`/`Need`/`NodePool`/`DecisionContext`/`ResourceNode`，以及 `house_stock_needs`（家宅缺什么）与 `state_need_label_with_agent`（前端需求标签） |
| `evaluate.rs` | `Decisioner` 结构体定义 + 核心调度 `decide` + 马斯洛逐层评估 `evaluate_needs` + 需求落地 `fulfill_resting_need`（含立宅自主选址） |
| `routing.rs` | 导航层：`dispatch`（寻路派发）、`turn_around_and_route_to`（原地掉头）、`return_home`、`nearest_of`/`has_available_node`/`is_target_poi_unavailable`（POI 私有触发器查询） |
| `seeking.rs` | 途中熔断与平滑重路由：`decide_seeking_material`/`decide_seeking_survival`（§4.2 核心） |
| `harvest.rs` | 现场采收完成判定：`decide_drinking`/`decide_foraging`/`decide_harvest`/`decide_mining_gold` + 仓储满额查询 `wood/stone_fully_stocked` |
| `scheduler.rs` | World 级调度：`World3DEngine::tick_decisions`（错峰决策 + POI 观测推送）与 `build_decision_context`（收集全图资源节点） |
| `mod.rs` | 模块声明与重导出（对外仅暴露 `needs::*` 与 `evaluate::*` 的类型） |

## 3. 🧱 关键结构

- **`Decisioner<'a>`**：单 Agent 决策器，持有全部只读上下文（`ctx`/`network`/`houses`/`rng`/`config`）；多个 `impl` 块分布在 routing / evaluate / harvest / seeking 四个文件中（方法全 `pub`，跨文件互调零障碍）。
- **`NodePool`**：资源供给类型枚举，`nodes(ctx)` 返回对应资源节点表。
- **`DecisionContext`**：每 tick 由 `build_decision_context` 重建的全图资源节点集合；**是否可用由每个 Agent 的私有触发器过滤**，`needs.rs` 不判断可用性。
- **`Need { level, kind, target_state }`**：一条需求判定结论，`evaluate_needs` 返回、`fulfill_resting_need` 落地。

## 4. ⚠️ 本目录易踩坑

### 4.1 决策节拍语义（勿改）
- 每 tick 调用一次 `tick_decisions`；agent 仅在 `(tick_counter + id) % agent_decision_interval_ticks == 0` 相位决策（默认 30 tick = 1 模拟秒一次）。
- 临时测试直接调 `tick_decisions` 前必须先拨 `world.tick_counter = 29`，否则目标 agent 不在相位上。
- 卸货（POI 交互）发生在决策**之前**：决策看到的是卸货后的仓库状态。

### 4.2 共享 RNG 确定性
- `Decisioner.rng` 指向全局 `WorldRng`，按 agents 顺序依次消费（`scheduler.rs` 中按 `self.agents` 顺序循环）。**新增任何随机消耗（`gen_range`/`gen_range_usize`）必须保持确定性**，否则 `tools/test-wasm.js` 同种子逐字节校验失败。RNG 消费只在 `evaluate.rs`（立宅掷点）与 `harvest.rs`（随机挑同类 POI）中发生。

### 4.3 POI 私有施密特触发器（只读结论）
- 选点与重路由**只读取** `agent.poi_is_seekable(poi_id)` 的锁存结论（开启 ≥30% / 关闭 <10% / 中间带保持前态），**绝不**在此目录内直接读 `poi.current_stock` 判断可用性。
- `is_target_poi_unavailable`：目标 POI 被关闭或自身无任何同类可用点时返回 true。

### 4.4 严禁闪现瞬移
- 中途掉头必须走 `turn_around_and_route_to`：在当前车道反向（`rev_len - distance_along_curve`）平滑回走，保持坐标连续性；`return_home` 同样优先掉头而非重新派发。
- 恢复现场：`dispatch` 成功才改写 `agent.state`/`route`/`current_lane_id` 等字段。

### 4.5 立宅自主选址（严禁系统指挥）
- `FoundHome` 在 `fulfill_resting_need` 内由 agent 自己掷 `decision_found_home_candidates`(12) 个候选点、按 `house_min_spacing`自检，存 `pending_house_pos`；系统仅由 `settlement.rs::materialize_founded_houses` 实体化（放置校验/路网接入/绑定）。
- 选址掷点消耗共享 RNG，改动候选数/距离/间距必须走 `SimConfig`（`decision_found_home_*`），前端 `config.js` 可调。

### 4.6 淘金纪律与冷却
- `GoldWealth`（娱乐淘金）冷却 `decision_gold_wealth_cooldown`(180s)，`StockGold`（备料）冷却 `decision_stock_gold_cooldown`(45s)；`fulfill_resting_need` 与 `seeking.rs`/`harvest.rs` 三处按 `is_building_stock` 区分设置冷却，改动时三处联动。

### 4.7 无家宅 Agent
- `home_house_id.is_none()` 的 agent 不装载行囊、只在现场自饮自食；`wood/stone_fully_stocked` 等仓储查询在无家宅时返回 true（视为已满足）。

### 4.8 修改后验证
- 以 `node tools/test-wasm.js` 回归为准（确定性/防越界/防 NaN）；临时单元测试验证后必须删除（见根 AGENTS.md §4.10），涉及触发器需覆盖 `test_poi_seekability_is_private_to_each_agent`、`test_abandon_seeking_when_target_poi_below_10_percent`、`test_reroute_to_next_poi_when_target_depleted` 等场景。
