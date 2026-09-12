# decisions · 部落民决策状态机 (AGENTS.md)

> 本目录局部操作指南。全局规则以根目录 `AGENTS.md` 为准（§4.2 寻路重路由 / §4.3 决策节拍 / §4.11 自主决策原则），本文件只收录本目录的职责边界、文件清单与局部易踩坑。

---

## 1. 📂 目录职责

单名族人的**马斯洛需求决策状态机**：从"生理自救 → 安全备货 → 归属成家 → 尊重建材 → 自我实现淘金"逐层评估需求，并以 `PrimitiveActionState` 状态机驱动寻路、途中重路由、现场采收等动作。本目录**只产出"做什么/去哪"的决策**，不负责数值结算（代谢/装卸/施工/修缮的结算分别在 `ecology/` 与 `housing_system/`）。

## 2. 📁 文件清单（15 个 Rust 文件）

| 文件 | 职责 |
| :--- | :--- |
| `intent.rs` | M19 意图与完成条件类型：`AgentIntent`、`IntentKind`、`CompletionPolicy`，`Need::observe_intent` 纯只读转换 |
| `strategy.rs` | M19 策略与阶段类型：`ActiveTask`、`ExecutionStrategy`、`ResourceStage`、`CommitStage`、`HomeStage`、`ReturnStage` |
| `primitive.rs` | M19 动作原语描述类型：`ActionPrimitive`、`ArrivalKind`、`HoldKind`，配合运动与驻留 |
| `projection.rs` | M19.2 执行状态纯视图：`compatible_legacy_state` 将 `ActiveTask` 无损映射到兼容的 `PrimitiveActionState` |
| `transition.rs` | M19.2/M19.3 统一任务生命周期转换器：`install_task`、`advance_stage`、`on_navigation_arrived`、`on_offroad_detour`、`finish_task`、`cancel_task`、`on_agent_death` |
| `observation.rs` | Agent3D::observe_execution 不可变借用事实；21 状态穷尽无损视图，pending 与持续活动分开 |
| `mod.rs` | 模块声明与重导出（对外暴露 `needs::*`、`branches::*` 与 `evaluate::*` 的类型） |
| `branches.rs` | 16 条活动分支注册表：b11 合并入 b8「改善住宅」，b15 下沉为资源意图的采购策略；包含 `BranchId`、中性声明序、自包含条件与层级覆盖 |
| `needs.rs` | 需求领域模型：`MaslowLevel`/`NeedKind`/`Need`/`NodePool`/`DecisionContext`/`ResourceNode`，以及家宅缺料查询与前端需求标签（标签亦应用层级覆盖） |
| `evaluate.rs` | `Decisioner` 结构体 + 核心调度 `decide` + ★ L1 持续仲裁 `arbitrate_sustained_task` + ★ L1 瞬发通道 `arbitrate_instant_needs` + ★ L2 策略派发 `dispatch_task` 与节拍推进 `step_in_progress_task` |
| `routing.rs` | 导航层：寻路派发、`turn_around_and_route_to`（原地掉头）、`return_home`、POI 私有触发器查询，任务归家同步 `sync_return_home_task` |
| `seeking.rs` | 途中熔断与平滑重路由：`decide_seeking_material`/`decide_seeking_survival`（根 AGENTS.md §4.2 核心）+ `decide_seeking_throne`（★ M4 夺位远征途中状态机）+ `decide_seeking_courtship`（★ 求偶途中状态机）+ ★ v1.27.0 / v1.36.0 `try_route_to_market`（水/粮/木断流时户主直接改道榷场，家户账本+随身黄金协同远程结算） |
| `market.rs` | 采购策略子模块：`can_procure_resource` / `should_buy_resource` 在水粮木意图下选择野外采集或市场采购；支持家户账本+随身黄金协同支付；负责市场途中及现场基于实时牌价与可执行性的退出判定（无力支付或无成交项即刻返家，杜绝卡死） |
| `harvest.rs` | 现场采收完成判定：饮水/采食/伐木/采石/淘金 + 仓储满额查询；★ L1 连续采收候选仲裁 `arbitrate_continuous_harvest_candidate`；★ v1.35.0 单趟多品类连续采收 `try_continue_harvesting`；★ M19.4d 多品类预排行程规划器 `plan_harvest_itinerary`（最近邻贪心 TSP，定长 4 站灌入 `Agent3D::harvest_queue`）；★ v1.27.0 / v1.36.0 水/粮/木目标关闭时优先转 `try_route_to_market` 再折返 |
| `scheduler.rs` | World 级调度：`tick_decisions`（错峰决策 + POI 观测推送）、`execute_pending_coronations`（★ M4 登基物理执行器）、`execute_pending_courtships`（★ 求偶成婚物理执行器）、`execute_pending_bids`（★ v1.26.0 竞拍出价物理执行器）与 `build_decision_context`（收集全图资源节点与单身女性候选） |

## 3. 🧱 关键结构

- **`Decisioner<'a>`**：单 Agent 决策器，持有全部只读上下文（`ctx`/`network`/`houses`/`rng`/`config`）；多个 `impl` 块分布在 routing / evaluate / harvest / seeking 四个文件中，方法全 `pub`，跨文件互调零障碍。
- **`DecisionContext`**：每 tick 由 `build_decision_context` 重建的全图资源节点集合；**是否可用由每个 Agent 的私有触发器过滤**，`needs.rs` 不判断可用性。
- **`Need { level, kind, target_state }`**：一条需求判定结论，`arbitrate_sustained_task` 返回、`dispatch_task` 落地。

## 4. ⚠️ 本目录局部易踩坑

> 全局约束（决策节拍、施密特触发器阈值、闪现禁令、RNG 确定性、自主决策原则）见根 AGENTS.md §4.2/§4.3/§4.11，此处不重复。

### 4.1 POI 触发器只读取结论

选点与重路由**只读取** `agent.poi_is_seekable(poi_id)` 的锁存结论，**绝不**在此目录内直接读 `poi.current_stock` 判断可用性。`is_target_poi_unavailable` 在目标 POI 被关闭或自身无任何同类可用点时返回 true。

### 4.2 RNG 消费点

`Decisioner.rng` 指向全局 `WorldRng`，按 agents 顺序消费。当前本目录实际 RNG 调用只有 `evaluate.rs::dispatch_task` 的立宅候选 angle/dist；竞拍候选按 ID 升序全集枚举，资源/市场选最近点均不耗 RNG。资源/市场并列沿用输入遍历顺序；夺位只在距离严格更小时替换候选，保留先遇到的营地。只读观察模块不得重新调用评估、选址或派发。

### 4.3  dispatch 成功才改写状态

`dispatch` 寻路成功后才改写 `agent.state`/`route`/`current_lane_id` 等字段；中途掉头走 `turn_around_and_route_to` 在当前车道反向平滑回走，`return_home` 同样优先掉头而非重新派发。

### 4.4 立宅选址掷点

`FoundHome` 在 `dispatch_task` 内由 agent 自己掷 `decision_found_home_candidates`(12) 个候选点、按 `house_min_spacing` 自检，存 `pending_house_pos`（★ v1.29.1 起存**候选点本身**，而非离候选点最近的路网节点——后者可能是别人家门节点，会导致实体化校验失败）；系统仅由 `housing_system/settlement.rs::materialize_founded_houses` 实体化，到达判定 = 走完派发路线（`current_lane_id` 清空）即视为抵达。`B12FoundHome` 分支含 `pending_house_pos.is_none()` 守卫，已选定宅址则不重掷。选址掷点消耗共享 RNG，改动候选数/距离/间距必须走 `SimConfig`（`decision_found_home_*`）。

### 4.5 淘金冷却三处联动

`GoldWealth`（积累财富意图，当前采用淘金策略）冷却 180s，`StockGold`（储备资金）冷却 45s；各处按活动任务真实来源区分，禁止按住宅等级反推。

### 4.6 无家宅 Agent

`home_house_id.is_none()` 的 agent 不装载行囊、只在现场自饮自食；`wood/stone_fully_stocked` 等仓储查询在无家宅时返回 true（视为已满足）。

### 4.7 🔴 评估顺序的真相源在前端配置文件（Rust 无顺序）

- `arbitrate_sustained_task` **不写死优先级**：按 `Decisioner.branch_order`（由 `scheduler.rs` 每拍调 `resolve_order(&config.decision_eval_order)` 解析、热路径零分配）迭代 `branches.rs` 注册表。
- **严禁**在本目录写死任何策展优先级常量（如 `[b1,b2,b3,b12,…]`）：`BranchId::ALL` 只是配置空/非法时的中性兜底序。
  策展顺序的唯一真相源是 `frontend/js/config.decision-order.js`，经 `SIM_CONFIG` 注入。
- 新增/修改分支时必须保持条件函数**自包含**：无家守卫、`b13` 的 4 级庄园门禁、`b5/b6/b7` 的 `family_level` 动态默认
  全部写在分支内部——否则重排顺序会破坏语义。
- 层级覆盖（`decision_eval_levels`，与顺序下标并行，按分支 ID 查位）：★ v1.29.0 编码 `0`=⓪瞬间行为 /
  `1-5`=①..⑤马斯洛层级 / `6`、缺失、非法 = 保留分支动态默认；评估结论与 `state_need_label_with_agent` 标签共用 `level_override_for`，改一处须保持一致。非瞬发分支（`is_instant()` 为 false）被覆盖为 0 时钳制回代码默认层级。

### 4.8 ★ M4 夺位远征（决策引擎驱动 · 生理层最高档）

v1.9.0 起远征不再由世界系统前置扫描触发，改为**马斯洛决策引擎的第 14 条分支 `B14SeekThrone`**（`NeedKind::SeekThrone`，`MaslowLevel::Physiological`，策展序/兜底序均置首 b14）：
- **触发（守卫全内联在分支内）**：在世成年男性、非现任国王、且 `Decisioner.eligible_leaderless_camp` 找到空缺王位营地——有房（含 0 级）者只能夺**自家房屋所在营地**的空缺王位，无房可夺**任意**空缺王位营地（Task6 语义）；
- **选点写字段**：`dispatch_task` 将选定营地写入 `agent.expedition_target_camp` 并 `dispatch` 为 `PrimitiveActionState::SeekingThrone`，`current_need = "Physiological·SeekThrone"`；
- **途中状态机 `decide_seeking_throne`**（seeking.rs，寻路+运动系统，坐标连续不闪现）：体力告警 → 折返；抵达目标营地交互半径且王位仍空缺 → 写 `coronation_pending` 待世界登基；途中目标已易主 → 原地掉头重定向到新的空缺王位营地；无可夺位营地 → 放弃远征恢复常规决策；
- **登基物理执行**：世界 `scheduler.rs::execute_pending_coronations` 每拍决策后扫描 `coronation_pending`，校验王位仍空缺才 `coronate_king`（迁籍入地区、`set_king` 入历史、`set_leader`、回 `RestingAtCamp`）——系统只当物理规则执行者，与 `materialize_founded_houses` 同模式；★ v1.45.2 登基时若族人已有私宅，严禁覆盖 `home_camp_node` 为营地中心 POI 节点，保留私宅大门连接以杜绝与配偶分居、无法育儿；
- 状态以 `agent.state == SeekingThrone` 与 `agent.expedition_target_camp` 记录（`activeExpeditionAgents` 由快照按状态+目标营地过滤派生）；
- 确定性：分支评估不消耗 `WorldRng`；`eligible_leaderless_camp` 选最近营地，距离相同保留输入列表先遇到的候选。
- ★ v1.32.0 孤儿营地补王：`eligible_leaderless_camp` 遍历完整营地列表（`ctx.camp_pois`）而非 `regions`，无 Region 实体（有房无王）的营地一并视为空缺王位；`decide_seeking_throne` 与 `execute_pending_coronations` 的「无 region」校验由 `unwrap_or(false)` 修正为 `unwrap_or(true)`，修复房屋辖区与地区成员登记簿脱节导致的孤儿营地永无国王。

### 4.9 🔴 决策层非移动态切换必须走 `enter_stationary_state()` · 移动态由 dispatch 自动驱动（v1.25.0 起）

**移动态**：分支命中返回的 `Need.target_state` 若是需要物理移动的状态（`Seeking*` 等），`dispatch_task` → `dispatch()` 会自动写入 `state / route / current_lane_id`，运动系统读到 `current_lane_id.is_some()` 即开始移动。**无需维护任何白名单**，新增移动态分支零额外成本。

**非移动态**：若 `Need.target_state` 是静止态（`RepairingHouse` / `ConstructingHouse` / `RestingAtCamp` 等），或决策途中从移动态切回静止态（放弃远征/求偶资格失败/成婚结算/登基/封王等），**必须调用 `agent.enter_stationary_state(state)`**，禁止直接 `agent.state = X`——该方法统一清空 `current_lane_id` / `current_velocity` / `route_index`，确保运动系统读到无车道即静止。直接赋值不清车道会导致"人在家但坐标在跑"。

配套契约：
- 若该状态**走完路线后不自动转换**（如 `SeekingCourtship` 保持原态等待决策器结算），则途中状态机（`seeking.rs::decide_seeking_*`）的"重补路/是否在移动"判定必须用 `current_lane_id.is_none()`，**严禁**用 `route.is_empty()`（`advance_to_next_lane` 走完后 `route` Vec 未清空，条件永不成立 → 到点站死）。
- 新增/改动分支后，用 `node tools/diagnose.js --check all` 复现：Rule 5 移动停滞嗅探（`Seeking*` 连续 60 tick 位移 < 0.05m）是回归门禁之一。

详见根 AGENTS.md §4.16 与 `spatial/AGENTS.md` §4.6。

### 4.10 🔴 ⓪ 瞬间行为层（v1.29.0 起 · 优先级高于生理需求）

- **语义**：`MaslowLevel::Instantaneous` 为 `MaslowLevel` 声明序**首位**变体（`Ord` 最小 = 优先级最高），编码 `0`；原「0=保留代码动态默认」迁移到哨兵 `6`。
- **评估时机与续评估**：`decide()` 顶部 `arbitrate_instant_needs` 全状态、每拍最先执行，只遍历 b8 在宅改善 / b16 近距求偶 / b17 竞购住宅 / b18 在宅生育。b8 安装可结算的升级任务，其余写 pending；异地变体仍交给持续任务仲裁。
- **白名单与钳制**：只有 `is_instant()` 为 true 的分支可产出瞬间层结论；`level_override_for` 对「非瞬发分支被强制覆盖为 0」返回 None（回退代码默认层级），防止玩家在决策引擎 UI 把移动型分支（如 b1 解渴）拖进瞬间层破坏语义。
- **瞬发变体写在分支内部（分支自包含铁律）**：b8 本人静止在宅门、b16 目标在交互半径、b18 夫妻同在宅门时返回 `Instantaneous`；异地仍生成持续任务。b17 竞购住宅整体归入瞬发通道。
- **幂等守卫**：b16 加 `courtship_pending.is_none()`、b18 加 `!raise_child_pending`、b17 加 `pending_bid_house_ids.is_empty()` + 冷却，避免每拍重复写。
- **确定性**：瞬发链路不消耗 `WorldRng`（b17 用 `all_bid_candidates` 升序确定性枚举全部更高等级在售房，b16 用 `best_courtship_target` 的 `min_by`）。
- **标签**：瞬发命中写 `"Instantaneous·BidHouse/Courtship/RaiseChild"`；本拍无常规需求时保留瞬间标签，否则被常规标签覆盖。

### 4.11 M19.1 观察边界

意图/策略/原语为非持久化词汇；旧 Agent 状态和 pending 继续权威。`Need::observe_intent` 要求实际来源分支及评估时家宅等级，`Agent3D::observe_execution` 不根据标签反推来源，不构造 ActiveTask。观察借用路线/候选/标签，不写 state、不耗 RNG、不分配。完整 API 契约见 [../../../../../docs/current/tech/32-m19-architecture.md](../../../../../docs/current/tech/32-m19-architecture.md)。

### 4.12 M19.2/M19.3 意图-策略-原语三层架构与生命周期收口

- **持续任务单一真相源**：`agent.active_task: Option<ActiveTask>` 成为进行中持续任务的唯一控制实体，`agent.state` 仅作为兼容视图由 `transition.rs` 同步。
- **生命周期统一转换器 (`transition.rs`)**：
  - 任务安装：`transition::install_task(agent, task)`；
  - 内部阶段推进：`transition::advance_stage(agent, update_fn)`；
  - 导航到达物理事件：`transition::on_navigation_arrived(agent)` 将阶段推入 `OnSite`/`Unloading`/`Ready`/`Working`；
  - 路线失效/绕行：`transition::on_offroad_detour(agent)`；
  - 任务完成与取消：`transition::finish_task(agent)` / `transition::cancel_task(agent)` 清空任务并置回 `RestingAtCamp`；
  - 死亡终态：`transition::on_agent_death(agent)` 清空任务并置 `Dead`。
- **三层解耦职责划分**：
  - **L1 意图仲裁**：`arbitrate_instant_needs`（瞬发通道）+ `arbitrate_sustained_task`（持续任务仲裁）+ `arbitrate_continuous_harvest_candidate`（连续采收候选分支仲裁）；
  - **L2 策略规划**：`dispatch_task`（将成立意图转化为执行策略并计算路线/目标）+ `step_in_progress_task`（进行中任务的途中断流重路由与现场策略驱动）；
  - **L3 原语适配**：`routing.rs`（导航与原语派发）+ `projection.rs`（兼容状态映射）+ `transition.rs`（状态同步）。
- **存档持久化升级**：`SAVE_FORMAT_VERSION = 5`，完整持久化 `ActiveTask`，读档零重新掷点、零重新寻路。

### 4.13 ★ M19.4 独立增强三件套（抢占矩阵 / 禀赋个性化 / 预排行程）

- **M19.4b 分级抢占（`preemption.rs`）**：`preemption.rs` 提供抢占矩阵与 `preempt_task`，按「当前任务性质 × 抢占意图」裁决是否中断；
  中断一律沿原车道连续掉头平滑重路由（`turn_around_and_route_to`），**严禁瞬移**，随身行囊完整保全，禁止清空已采物资。
- **M19.4c 禀赋与家资个性化（`branches.rs` / `market.rs`）**：力量驱动重体力装载速率与轻体力偏好、智力驱动「路途耗时 vs 榷场现货牌价」权衡、
  家户金币 ≥ `market_wealthy_family_gold` 的户主按 80% 几率免于亲自伐木采石（赴市现货采买）。个性化**只影响选策，不得破坏确定性**——
  所有概率判定一律走 `gentry_labor_exemption_check(agent_id, tick, interval)` 这类**纯函数 + 共享 RNG 顺序**的确定性掷点，禁止引入墙钟时间或哈希顺序依赖。
- **M19.4d 预排采收行程（`harvest.rs` + `agent.rs`）**：
  - `Agent3D::harvest_queue: [Option<BranchId>; 4]` 为**定长 4 站**预排队列（零堆分配、`#[serde(default)]` 向后兼容读旧档）；
    配套 `pop_harvest_queue()`（FIFO 平移，末尾补 `None`）与 `clear_harvest_queue()`。
  - `plan_harvest_itinerary(&self, agent) -> [Option<BranchId>; 4]`：仅遍历 5 条备料分支（b5/b6/b7/b9/b10），
    逐条 `arbitrate_continuous_harvest_candidate` 验资格 + `nearest_of` 定位最近 POI，再按**最近邻贪心（TSP 启发式）**从当前位置串成总路程最短链路。
  - `try_continue_harvesting` 消费顺序：**预排队列优先 → 逐站重验资格（失效即跳过）→ 队列耗尽回退 `branch_order` 兜底 → 全失败才 `return_home`**。
  - 队列生命周期：出发时由 `evaluate.rs` 在 `dispatch` 成功后灌入（**剔除当前分支自身**）；体力低于 `decision_work_stamina_threshold`、
    无家宅、抢占/取消/回宅卸货时必须 `clear_harvest_queue()` 安全清空，杜绝跨任务串味。
  - 可观测性：`ActiveTaskSnapshot::itinerary` 字符串（如 `💧备水 → 🌲备木 → 🍒备粮`，少于 2 站时为 `--`），
    已纳入**四处同步**（`snapshot.rs` / `world_snapshot.rs` / `snapshot_bin/encode.rs` / `snapshot-bin.js`），Inspector 元素 `insp-task-itinerary`。

### 4.14 🔴 ★ v1.47.0 / v1.47.1 衰弱（风烛残年）守卫：储备分支与在宅进食

健康值 `agent.health < cfg.agent_frail_health_threshold`（前端 `agentFrailHealthThreshold`，默认 **2.0**）即判定为**衰弱**——
健康值随 `agent_health_decay_per_sec` 单调递减、永不回复，故该区间是生命的最后一段（默认配置下约最后 200 模拟秒）。

两条硬规则（改动前必读）：

1. **不响应储备需求**：`branches.rs::BranchId::evaluate` 在函数最顶部（**任何 RNG / 散列消费之前**）对
   `b5 储水 / b6 储粮 / b7 储木 / b9 储石 / b10 储金 / b13 积累财富` 六条分支直接 `return None`
   （★ v1.47.1 起 b13 `GoldWealth` 淘金也纳入守卫，避免濒死老人仍被派去淘金）。
   - 守卫位置不可下移：b9 内部有 `gentry_labor_exemption_check` 等确定性散列调用，
     若把守卫放在其后，衰弱与否会改变求值路径（虽不耗 RNG，但破坏「守卫前置」这一可审计约定）。
   - 由于 `plan_harvest_itinerary` / `try_continue_harvesting` 均经 `arbitrate_continuous_harvest_candidate`
     → `branch.evaluate`，衰弱者自然拿到空队列 → 采收完毕即返家，**无需额外特判**。
   - ⚠️ 存量 `current_need` 仍可能显示 `Safety·StockWood` 之类标签：那是 `step_in_progress_task`
     按**状态**（`SeekingWood`…）贴的兼容标签，代表「切换前已出发的旧任务正在收尾」，不是新起的储备需求。
2. **饮食优先在家解决**：`evaluate.rs::dispatch_task` 在 `NeedKind::Rest` 早退之后插入衰弱判定，
   若 `meal_resource(need.kind)`（b1→水 / b2→粮）非空且 `can_home_meal()` 成立
   （有私宅 **且** 家户账本该品类余额 ≥ `decision_home_meal_min_stock`，默认 **1.0**），
   则写 `current_need = "Physiological·HomeMeal"` 并 `return_home()`，不再派发野外水源/果丛。
   - 抢占链路同样生效：`preemption.rs::preempt_critical_survival` 在查询 POI 可用性之前先判衰弱，
     命中则 `preempt_task()` + `return_home()`（平滑掉头，绝不瞬移）。
   - ★ v1.47.1 触发缺口修复：`B1QuenchThirst` / `B2SateHunger` 的分支条件对衰弱者追加
     `is_frail && can_home_meal` **或条件**（见 `branches.rs::evaluate`）——原实现因 `can_procure_resource`
     前置（野外可用节点或市场可购）在**野外断流且市场不可购**时 B1/B2 不命中，`dispatch_task` 的
     HomeMeal 分支永远不可达，衰弱者即使家户水粮充足也可能在静止/施工/远征中渴死饿死；
     修复后「家户账本余额 ≥ 阈值」本身即成为需求命中依据，断流场景同样触发返家。
     非衰弱者不受影响（`is_frail=false` 时或条件短路）。
   - 到家后由 `ecology/home.rs::rest_at_camp` 从家户账本吃喝（`Consume` 流水），与既有在宅进食链路完全复用。
   - 余额不足（< 阈值）时自动回落原逻辑外出就源，不会把衰弱者困死在家中。

调试/验证提示：默认 `campHomeConsumeRate = 3.0`（每秒），在宅者会被持续顶到满值，
因此「衰弱 + 饥饿」很难自然同时出现，`HomeMeal` 观测样本天然稀少。
要复现该分支，可临时把 `campHomeConsumeRate` 调到 0.05 并热注入 `agentFrailHealthThreshold`。

### 4.15 🔴 验证「行囊已装满」必须用配置容量，禁止硬编码常量

`carry_capacity_resource`（前端 `carryCapacityResource`）当前为 **100.0**，是判定 `carry_full` 的唯一权威阈值。
构造「某品类已装满 → 现场转站」的测试或诊断场景时，必须从 `SIM_CONFIG.carryCapacityResource` 取值而非写死旧值常量：
若行囊未满且家户该品类仍短缺，`decide_drinking`/`decide_foraging` 的 `finished` 判据不成立，Agent 会在资源点**原地持续采集**，
根本不会进入 `try_continue_harvesting`，表现为「预排队列不生效 / 行程不推进」的**假故障**。
同类坑亦见于「家宅已备满」类场景——须同时把 `family_stock_active` 置位或直接给足账本余额。
