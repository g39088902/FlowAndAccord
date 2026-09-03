# decisions · 部落民决策状态机 (AGENTS.md)

> 本目录局部操作指南。全局规则以根目录 `AGENTS.md` 为准（§4.2 寻路重路由 / §4.3 决策节拍 / §4.11 自主决策原则），本文件只收录本目录的职责边界、文件清单与局部易踩坑。

---

## 1. 📂 目录职责

单名族人的**马斯洛需求决策状态机**：从"生理自救 → 安全备货 → 归属成家 → 尊重建材 → 自我实现淘金"逐层评估需求，并以 `PrimitiveActionState` 状态机驱动寻路、途中重路由、现场采收等动作。本目录**只产出"做什么/去哪"的决策**，不负责数值结算（代谢/装卸/施工/修缮的结算分别在 `ecology.rs` 与 `housing_system/`）。

## 2. 📁 文件清单（9 个文件）

| 文件 | 职责 |
| :--- | :--- |
| `mod.rs` | 模块声明与重导出（对外暴露 `needs::*`、`branches::*` 与 `evaluate::*` 的类型） |
| `branches.rs` | 16 条分支注册表：`BranchId` 枚举（↔ 字符串 ID `"b1".."b16"`）、`ALL` 中性声明序、自包含条件函数 `evaluate`、`resolve_order` 解析、`level_override_for` 层级覆盖 |
| `needs.rs` | 需求领域模型：`MaslowLevel`/`NeedKind`/`Need`/`NodePool`/`DecisionContext`/`ResourceNode`，以及家宅缺料查询与前端需求标签（标签亦应用层级覆盖） |
| `evaluate.rs` | `Decisioner` 结构体 + 核心调度 `decide` + **数据驱动**评估 `evaluate_needs`（按 `branch_order` 迭代注册表）+ 需求落地 `fulfill_resting_need`（含立宅自主选址） |
| `routing.rs` | 导航层：寻路派发、`turn_around_and_route_to`（原地掉头）、`return_home`、POI 私有触发器查询 |
| `seeking.rs` | 途中熔断与平滑重路由：`decide_seeking_material`/`decide_seeking_survival`（根 AGENTS.md §4.2 核心）+ `decide_seeking_throne`（★ M4 夺位远征途中状态机）+ `decide_seeking_courtship`（★ 求偶途中状态机） |
| `market.rs` | 外部商贸决策子模块：`evaluate_market_trade`（B15 需求判定）+ `decide_seeking_market` / `decide_buying_market` |
| `harvest.rs` | 现场采收完成判定：饮水/采食/伐木/采石/淘金 + 仓储满额查询 |
| `scheduler.rs` | World 级调度：`tick_decisions`（错峰决策 + POI 观测推送）、`execute_pending_coronations`（★ M4 登基物理执行器）、`execute_pending_courtships`（★ 求偶成婚物理执行器）与 `build_decision_context`（收集全图资源节点与单身女性候选） |

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

### 4.7 🔴 评估顺序的真相源在前端配置文件（Rust 无顺序）

- `evaluate_needs` **不写死优先级**：按 `Decisioner.branch_order`（由 `scheduler.rs` 每拍调 `resolve_order(&config.decision_eval_order)` 解析、热路径零分配）迭代 `branches.rs` 注册表。
- **严禁**在本目录写死任何策展优先级常量（如 `[b1,b2,b3,b12,…]`）：`BranchId::ALL` 只是配置空/非法时的中性兜底序。
  策展顺序的唯一真相源是 `frontend/js/config.decision-order.js`，经 `SIM_CONFIG` 注入。
- 新增/修改分支时必须保持条件函数**自包含**：无家守卫、`b13` 的 4 级庄园门禁、`b5/b6/b7` 的 `family_level` 动态默认
  全部写在分支内部——否则重排顺序会破坏语义。
- 层级覆盖（`decision_eval_levels`，与顺序下标并行，按分支 ID 查位）：`0`/缺失 = 保留分支动态默认，
  `1-5` = 强制马斯洛层级；评估结论与 `state_need_label_with_agent` 标签共用 `level_override_for`，改一处须保持一致。

### 4.8 ★ M4 夺位远征（决策引擎驱动 · 生理层最高档）

v1.9.0 起远征不再由世界系统前置扫描触发，改为**马斯洛决策引擎的第 14 条分支 `B14SeekThrone`**（`NeedKind::SeekThrone`，`MaslowLevel::Physiological`，策展序/兜底序均置首 b14）：
- **触发（守卫全内联在分支内）**：在世成年男性、非现任国王、且 `Decisioner.eligible_leaderless_camp` 找到空缺王位营地——有房（含 0 级）者只能夺**自家房屋所在营地**的空缺王位，无房可夺**任意**空缺王位营地（Task6 语义）；
- **选点写字段**：`fulfill_resting_need` 将选定营地写入 `agent.expedition_target_camp` 并 `dispatch` 为 `PrimitiveActionState::SeekingThrone`，`current_need = "Physiological·SeekThrone"`；
- **途中状态机 `decide_seeking_throne`**（seeking.rs，寻路+运动系统，坐标连续不闪现）：体力告警 → 折返；抵达目标营地交互半径且王位仍空缺 → 写 `coronation_pending` 待世界登基；途中目标已易主 → 原地掉头重定向到新的空缺王位营地；无可夺位营地 → 放弃远征恢复常规决策；
- **登基物理执行**：世界 `scheduler.rs::execute_pending_coronations` 每拍决策后扫描 `coronation_pending`，校验王位仍空缺才 `coronate_king`（迁籍入地区、`set_king` 入历史、`set_leader`、回 `RestingAtCamp`）——系统只当物理规则执行者，与 `materialize_founded_houses` 同模式；
- 状态以 `agent.state == SeekingThrone` 与 `agent.expedition_target_camp` 记录（`activeExpeditionAgents` 由快照按状态+目标营地过滤派生）；
- 确定性：分支评估不消耗 `WorldRng`；`eligible_leaderless_camp` 选最近营地并列取 id 小者。
