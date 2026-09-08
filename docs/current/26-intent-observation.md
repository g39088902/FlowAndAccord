# 26. 意图类型与只读执行观察（M19.1）

> [返回现状索引](../01-current.md) · 源码：`crates/sim_core/src/spatial/decisions/{intent,strategy,primitive,observation}.rs`
>
> 本模块只提供领域类型与观察 API。行动仍由既有 `Decisioner`、运动和世界结算执行，尚未启用新的任务控制器。

## 1. 两个观察入口

| API | 输入 | 输出 | 不做什么 |
|---|---|---|---|
| `Need::observe_intent(source_branch, home_tier)` | 已产生并应用层级覆盖的 Need、实际来源分支、该次评估时的私宅等级 | `Result<IntentObservation, IntentObservationError>` | 不重新 evaluate、不读路网/账本、不掷点、不推测来源 |
| `Agent3D::observe_execution()` | 当前 Agent 的不可变借用 | `ExecutionObservation<'_>` | 不改变 state、路线、pending、标签、RNG 或触发器；不缓存、不分配 |

前者是分支结果适配，后者是执行事实观察。旧 `state/current_need` 未可靠保存原始意图：水粮状态可由求生或补货触发，市场可能是途中兜底，返航也丢失前一策略。因此执行观察不伪造 `AgentIntent/ActiveTask`，不把标签作为 source_branch。

### 分支结果

`IntentObservation::Sustained(AgentIntent)` 保存实际分支、有效层级、意图和类型化完成策略。`Submission` 单独表达求偶、竞拍、育儿提交，不占持续任务槽位；b17 即使被层级覆盖降为常规仍为 Submission。b16/b18 根据**已经应用覆盖的 Need.level**区分提交与持续目标，观察器不重新判断距离。

升级转换必须提供当前家宅等级：b8 只接受 0 级；b11 接受 0～3 级（原 b11 同样可能触发 0→1）；4 级、缺失等级、来源分支与 NeedKind 不匹配、非瞬发分支产出瞬发层均明确返回错误。错误只供调用方诊断，不驱动返家或其他行动。

完成策略仅是判据类型，尚未实现新的目标完成评估器。阈值仍归现有 SimConfig 与原决策守卫；备金和娱乐淘金以 `GoldPurpose` 区分。

### 执行事实

`ExecutionObservation` 包含生命周期、动作类别、运动事实、全部 pending、家宅/目标 ID 和借用的标签。竞拍候选与路线使用借用切片，数量不截断。生命周期与原运动字段分别保留：死亡/胎儿不能因残留车道被观察器描述成可自主行动，也不会为整理观察结果而清掉真实字段。

`ActivityObservation::from_legacy` / `legacy_state` 对全部 21 个旧枚举穷尽匹配、无休息兜底。资源动作区分前往与现场，返航独立表示；`RestingAtCamp` 只表示旧动作值，不能据此断言已卸完或正站在家门。立宅沿路移动时也可能保持该值，必须同时读取 `motion.lane` 与 pending。

## 2. 领域词汇与存储边界

- `intent.rs`：AgentIntent、IntentKind、CompletionPolicy、GoldPurpose、SubmissionKind 及结果适配。
- `strategy.rs`：ActiveTask、ExecutionStrategy、阶段、可行性和失败原因；只有数据类型，没有 Selector/Planner。
- `primitive.rs`：ActionPrimitive、ArrivalKind、HoldKind；只有描述，没有第二套物理执行器。
- `observation.rs`：不可变执行观察与旧枚举的无损视图。

M19.1 阶段按需读取，不在 tick 中反复影子规划。M19.2/M19.3 已正式将 `ActiveTask` 控制器挂载至 `Agent3D`，作为进行中持续任务单一真相源，并通过 `transition.rs` 统一管理生命周期与兼容视图同步；存档格式版本 `SAVE_FORMAT_VERSION` 升至 5，完整持久化持续任务，读档零重新规划、零重新掷点。

当前决策系统平铺于 `crates/sim_core/src/spatial/decisions/`（共 15 个 Rust 文件），L1 持续仲裁、瞬发通道与连续采收候选仲裁完成解耦，L2 策略与 L3 原语派发收口。

## 3. 使用与验证边界

调用方有原 Need 和 source_branch 时可观察意图；只有 Agent 时调用执行观察，不能补造缺失来源。活动控制器已接管全部持续任务，`agent.state` 为纯兼容视图。各阶段事件（到达、断流重路由、离路绕行、死亡、完成、取消）均通过 `transition.rs` 统一同步。

新增旧枚举时同步 ActivityObservation 的两个穷尽匹配；新增 NeedKind/BranchId 时同步分支结果适配。调整真实执行行为时仍必须检查原状态写入者，而不是只更新观察映射。

冻结基线、18 分支守卫、写入者清单和本阶段验证证据见 [M19.0/M19.1 审计记录](../archive/19-m19-baseline-audit.md)，机器可读结果见 [基线报告](../../tools/baseline-m19-observation.json)。临时验证脚本按项目规定删除；既有 WASM、确定性、快照、配置及前端门禁继续使用。
