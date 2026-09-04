# 🤖 Agent AI 决策系统设计思路深度解析

> **分析对象**：`FlowAndAccord` 中部落民 (Agent) 的全部 AI 决策逻辑
> **源码位置**：`crates/sim_core/src/spatial/decisions/`（7 个文件：`mod.rs` + 6 子模块 `needs` / `evaluate` / `routing` / `harvest` / `seeking` / `scheduler`）
> **本文定位**：**设计思路深度解析（为什么这么设计）**，与 [`docs/current/06-motivation-ai.md`](./current/06-motivation-ai.md) 形成互补——06 讲"机制是什么"，本文讲"为什么这么设计"。
> **版本**：v1.3.2

---

## 1. 核心结论

当前 Agent 的"AI"是**纯确定性规则系统**——层次化动机有限状态机 (FSM) + 加权 A* 寻路 + 踩踏拓路涌现 (Stigmergy) + 生理/家庭/房屋生命周期闭环。**不包含任何 LLM / 神经网络 / 学习成分**（[architecture.md](./architecture.md) 中规划的 LLM 认知层为愿景设计）。

Rust 内核 `crates/sim_core` 是唯一真实仿真实现，通过 `node tools/test-wasm.js` 同种子逐字节一致性验证；前端 `frontend/js/` 仅为表现与交互层，不存在独立 JS 移植版仿真逻辑。

---

## 2. 为什么是马斯洛层次化 FSM，而非效用最大化或行为树

### 2.1 设计选择：严格优先级的 5 层马斯洛

`needs.rs` 定义了 `MaslowLevel`（5 层，低→高绝对优先）与 13 种 `NeedKind`：

| 层级 | 需求种类 | 设计意图 |
| :--- | :--- | :--- |
| ① 生理 | `QuenchThirst` / `SateHunger` / `Rest` / `FoundHome` | 生存底线——饥渴/体力告急时压倒一切；末档为无家男性自立门户 |
| ② 安全 | `RepairHouse` / `StockWater` / `StockFood` / `StockWood` | 家宅储备——仓库填满优先于盖房升级 |
| ③ 归属 | `BuildHouse`(0级) | 成家立业——0级仓库仓满后施工升级成家 |
| ④ 尊重 | `BuildHouse`(1-4级) / `StockStone` / `StockGold`(45s冷却) | 建材储备与房屋升级 |
| ⑤ 自我实现 | `GoldWealth`(180s冷却) | 4 级大庄园竣工后的娱乐淘金 |

> ⚔️ **★ M4 夺位远征（v1.9.0 起决策引擎驱动，生理层最高档）**：第 14 条决策分支 `B14SeekThrone` 在马斯洛引擎内评估——在世成年男性、非现任国王、且存在空缺王位营地（有房者仅夺自家房屋所在营地、无房可夺任意）时，决策器自主选定最近可夺位营地写入 `expedition_target_camp` 并 `dispatch` 为 `SeekingThrone` 冲向目标；抵达且王位仍空缺写 `coronation_pending`，由世界 `execute_pending_coronations` 校验后登基。设计理由：王位空悬属社会结构级事件，夺位作为生理层最高档需求压倒解渴/觅食/休息（看结果不看开头——王位=资源分配权=生存）（见 [12-ledger-system.md](./current/12-ledger-system.md) §M4）。

### 2.2 为什么不用效用最大化或行为树

**效用最大化（Utility Maximization）** 需要为每个需求计算数值分数并比较，三个问题使其不适合本项目：
1. **参数脆弱**：效用权重微调可能导致全局行为剧变，难以调参；
2. **生存风险**：当"盖房"效用略高于"喝水"时，agent 可能渴死在工地——数值比较无法表达"生存底线不可逾越"；
3. **不可解释**：效用分数是黑箱，玩家难以理解"这个小人为什么在做这件事"。

**行为树（Behavior Tree）** 适合预设复杂条件分支，但本项目核心体验是**涌现**——agent 行为应由生理+环境+家宅状况的组合自然驱动，而非硬编码 if-else。马斯洛 FSM 让每个 agent 每拍只回答"我当前最迫切的需求是什么？"，执行层自动完成寻路→采收→返家闭环。

马斯洛严格优先级用**序数而非基数**解决了这些问题：低层未满足时高层完全不被考虑，语义清晰、调参简单、行为可解释（Inspector 直接展示主导需求+决策原因）。

---

## 3. 为什么是错峰决策，而非全员同拍

`scheduler.rs::tick_decisions()` 每 tick 被调用，但每个 agent 仅在 `(tick_counter + agent.id) % 30 == 0` 相位上决策（30 tick = 1.0 模拟秒）。三个理由：
1. **性能均摊**：20+ agent 同时决策会导致单 tick 耗时尖峰（A* 寻路是主要开销）；错峰后每 tick 仅约 1/30 agent 决策，帧率稳定；
2. **避免共振**：全员同拍会导致"同步出发→同步到达→同步争抢同一 POI"；错峰让行为自然分散；
3. **确定性保持**：相位由 `(tick_counter + agent.id) % 30` 确定性计算，不消耗 `WorldRng`。

---

## 4. 为什么是 Agent 私有 POI 施密特触发器，而非全局共享阈值

### 4.1 设计选择：每个 agent 维护自己的 `poi_seekability`

`agent.rs::observe_poi_stock_with_config()` 在每个 agent 的决策相位更新私有触发器：
- **开启**：POI 库存升至 ≥ `config.decisionPoiSeekMinStockRatio`（0.50）；
- **关闭**：已开放点仅在跌破 < `config.decisionPoiAbandonStockRatio`（0.10）时关闭；
- **中间带**（10%~50%）：保持该 agent 的前态。

`routing.rs::available_nodes()` 和 `seeking.rs` 的路由/重路由只读取 agent 私有触发器结论，相同 POI 可被不同 agent 判为不同可用性。

### 4.2 为什么不用全局阈值

全局共享阈值会导致**雷鸣群集（Thundering Herd）**：POI 库存刚回到 30%，所有 agent 同时判定"可用"一窝蜂涌向同一点；到达后迅速采空，所有人同时放弃，形成"去→采空→走→再生→去"的振荡循环。

私有施密特触发器让每个 agent 有自己的"开放/关闭"记忆：agent A 在 35% 时开放了某 POI，即使回落到 20%（中间带）仍认为可用继续前往；agent B 从未开放过该 POI，在 20% 时仍认为不可用而选择其他点。结果是 agent 自然分散到不同 POI，避免共振，且每个 agent 的行为具有**时间一致性**（不因库存微小波动反复切换目标）。

### 4.3 中途熔断与平滑掉头

`seeking.rs` 在赶往 POI 途中检测自身对目标的触发器关闭（跌破 <10%）时：若自身仍有其他已开放同类 POI → 通过 `turn_around_and_route_to` **原地掉头**（反向进度 `rev_len - distance_along_curve`）平滑重规划赶往就近可用 POI；仅在自身无可用品或体力告警时才折返回家。

**原地掉头而非直接设新路径**：直接设新路径会导致 agent 从当前坐标"闪现"到新车道起点，破坏坐标连续性。原地掉头在当前车道反向推进，位置连续无瞬移。

---

## 5. 为什么是加权 A*，而非 Dijkstra 或贪心

### 5.1 设计选择：`graph.rs::find_path_3d_with_preference()`

```
边代价 = (curve.length / effective_speed) + grade_penalty × hidden_modifier
```

- `effective_speed = speed_limit × (0.50 + 0.333 × wear)`——道路踩踏度直接进入代价，形成"走好路"的涌现偏好；
- `grade_penalty = Δz × 1.5`（上坡惩罚）；
- `hidden_modifier`：潜行偏好暗道 ×0.4 / 普通市民避暗道 ×2.5；
- 启发式：欧氏距离 / 80（admissible，保证最短路性质）。

### 5.2 为什么 A* 而非 Dijkstra，以及踩踏度为何进入代价

Dijkstra 不使用启发式，会探索大量无关节点；A* 的欧氏距离启发式（admissible，不高估实际代价）将搜索聚焦在目标方向附近，数百节点路网中毫秒级返回最优路径。

踩踏度进入代价是**踏路成道（Stigmergy）正反馈**的关键：agent 走路 → `wear += 0.05` → 道路速度提升 → 寻路代价下降 → 更多 agent 选择这条路 → wear 进一步提升；闲置道路则自然衰减。结果是路网中自然形成"主干道"和"偏僻小径"，无需系统手动规划道路等级。

---

## 6. 为什么是 Agent 自主决策，而非系统扫描指挥

根 AGENTS.md §4.11 明确：系统只当"物理规则执行者"，一切"盖不盖、何时盖、在哪盖"来自 agent 自己的 `evaluate_needs` 输出。三条自主触发链路（立宅/升级/修缮）均为确定性触发，详细门槛见 [06-motivation-ai.md](./current/06-motivation-ai.md)。

**禁止系统扫描指挥的三个理由**：
1. **涌现性**：系统扫描会强制所有 agent 同步行为（如"所有仓满的房子同时升级"），破坏个体差异和时间分散；
2. **可解释性**：agent 自主决策时 Inspector 可追溯个体动机；系统指挥则无法解释"为什么这个小人在做这件事"；
3. **扩展性**：未来引入六维政治资本、LLM 认知层时，agent 需求评估是自然扩展点；系统扫描则需不断新增扫描器，代码膨胀。

---

## 7. 生命周期闭环：从求生到传承

```
个体求生（饥渴→就近POI→采收→行囊→回家卸货）
  → 随身搬运（真实背包，非瞬移，容量约束）
    → 筑巢成家（成年男性→FoundHome→自主选址→0级仓库→升级→成婚）
      → 代际传承（受孕→胎儿 agent 入世(v1.3.5)→出生→继承父亲家户→成年分家→下一代立宅）
        → 踏路成道（行走→wear→道路升级→更多人走→主干道涌现）
```

闭环中没有任何"系统目标"或"胜利条件"——每个 agent 只追求自己的马斯洛需求满足，但群体层面涌现出道路网络、聚落分布、代际家族树和资源流动模式。这正是**混沌系统**的核心体验：确定性规则驱动不可预测的长期演化。

---

## 8. 与愿景的差距

| 维度 | 当前实现 | 愿景（[plan.md](./plan.md) M6/M7/M8） |
| :--- | :--- | :--- |
| 决策架构 | 马斯洛 5 层 FSM + 错峰调度 | 六维政治资本仲裁 + 异步 LLM 认知总线 |
| 寻路 | 加权 A*（坡度/隐秘/踩踏度） | 欲望线热度场 + 时空冲突预约 FIFO |
| 内核 | Rust 结构体数组（`Vec<Agent3D>`） | ECS（hecs/bevy_ecs）+ 确定性 Command Queue |
| 快照 | JSON 序列化 | 零拷贝双缓冲共享内存 + Hermite 插值 |
| 社会 | 婚姻/家户/分家继承 + **宗族/地区政体/国王夺位**（账本 M1~M4 已落地） | 专利经济/混合政体/LLM 认知层 |
