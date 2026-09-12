# M19.0 / M19.1 基线与验收记录

> 冻结对象：应用 v1.46.7，源码基于 `779e941945cd60197e5485cc308b5be253db6ab0`，相对该提交的运行时变更仅为此前统一升版。M19.1 不接管任何行为链。
>
> 当前 API 说明见 [../current/tech/32-m19-architecture.md](../current/tech/32-m19-architecture.md)；未来控制契约见 [M19 技术规格](../current/tech/32-m19-architecture.md)。本页保存审计时的事实，未来新增写入点应重新审计。

## 1. 可复现基线

旧 WASM SHA-256：`40d2f4d6d12ecfb828a03c3f39d931843e1e32953774aad770c9a4ab96719d24`。

本地保留 `target/m19-baseline/v1.46.7.wasm`、`config-v1.46.7.json` 与 `full-save-v1.46.7.json`；target 为构建缓存，不作为必须提交的二进制历史。可在独立目录检出上述提交，用统一升版器设置应用 1.46.7，然后按标准工具链 release 编译重建基线。工具链、完整合并配置、源文件摘要、样本摘要、布局和性能结果保存在 [机器可读报告](../../tools/baseline-m19-observation.json)。重建二进制摘要受工具链影响，行为比较须使用相同工具链。

默认配置由 config.js + config.decision-order.js + config.house-upgrade-cost.js 合并，固定 grid=60、world_size=764、seed 和 tick 记录。满载基线使用既有 `profile-benchmark.js` 的 max-yield 预设语义（各 POI 单 tick 回满，采收/卸货单 tick 满一袋），seed=42 推进 800,000 tick 后保存；实际 516 个 Agent 记录、504 名在世非胎儿。它是明确记录的高负载样本，不代表所有配置的理论人口上限。

差分使用两个独立 WASM 实例和独立 FABS 解码器，同时对比完整存档领域状态（包括 RNG、路线、私有触发器、冷却和账本流水）与解码快照。只从存档中去除 `app_version`，不忽略其余字段。各自读回自己的同版本存档；跨版本夹具导入仅在临时验证中替换版本元信息，不改生产加载门禁。

## 2. 已核实的时序与状态所有权

`world_tick.rs::tick()` 和 `tick_subphase()` 均为：计数/四季/POI → 代谢与育儿 → POI 交互 → 房屋 → 道路衰减 → 运动 → 决策及其提交消费 → 账本 → 清理。旧全局指南/决策文档把决策写在运动前的概括已修正；执行代码不变。

`tick_decisions` 为每 tick 世界入口，只对命中配置相位的在世非胎儿 Agent 先观察 POI，再由 decide 刷新家户锁存、执行瞬发遍历和当前状态分支。常规全分支评估主要位于 RestingAtCamp；有私宅且尚有卸货时提前返回，不能中途派走。返航/施工/修缮等状态并不每相位重新全局仲裁。

### 2.1 写入者登记

| 类别 | 文件与函数 | 写入/反馈事实 |
|---|---|---|
| 初始化、死亡、静止入口 | agent.rs：new_with_config、tick_metabolism、enter_stationary_state | 初始化休息；三种死亡分支写 Dead；静止入口清车道/速度/路线进度 |
| 运动、到达与离路 | agent.rs：tick_movement、advance_to_next_lane | 路线失效为 OffRoadDetour；资源/市场/返航到达改现场/休息；社会目标等只清车道保留状态 |
| 路线派发/掉头/返航 | decisions/routing.rs：dispatch、turn_around_and_route_to、return_home | 同时写 state、target_poi_node、route、lane 和进度；返航更新 home_camp_node |
| 决策落地 | decisions/evaluate.rs：decide、fulfill_resting_need | 原静止动作、升级/育儿返宅、立宅 pending、市场现场转换及标签 |
| 途中取消 | decisions/seeking.rs：decide_seeking_throne、decide_seeking_courtship | 清目标/pending、改静止/返家；资源链通过 routing 修改状态 |
| 采收与交易退出 | decisions/harvest.rs、market.rs | 调用 routing 续采/返航，设置用途冷却与标签 |
| 登基/成婚结算 | decisions/scheduler.rs：coronate_king、execute_pending_courtships | 清 pending/目标，按原规则静止；更新家户/婚姻/政体和部分归宿字段 |
| 房屋作业 | housing_system/construction.rs、maintenance.rs | 升级成功或失败退出 ConstructingHouse；修缮完成/材料不足退出 RepairingHouse |
| 政体继承 | ledger/region.rs 的继位处理 | 调用 enter_stationary_state，变更政治身份；不是新派发远征 |
| 房屋/家庭身份 | housing_system/{settlement,inheritance,auction}.rs、housing_system/marriage.rs、bookkeeping.rs、ledger/family.rs | 改 home_house_id/home_camp_node/spouse/家户归属、竞拍消费；旧目标可能因此失效 |
| 出生、胎儿和读档 | birth.rs、world_tick.rs、world_save.rs | 新建/替换 Agent、改生命周期、整体恢复原字段；不是逐动作 state 赋值也必须纳入接管影响面 |
| 只读消费者 | ecology.rs、agent.rs 代谢/体力、房屋系统、world_snapshot.rs、snapshot_bin/encode.rs | 读取 state 驱动物理消耗/作业，或派生远征统计与快照；state 尚非纯 UI 值 |

机器报告保留 Rust 文件摘要与搜索命中的具体行。搜索入口为 `.state =`、`enter_stationary_state`、`target_state`、pending 写入/清空/take，以及目标/家宅关系字段；仅搜索直接 state 赋值不足以覆盖 whole-Agent 构造/反序列化。

### 2.2 Pending 生命周期

| 字段 | 生产者 | 消费/清理 |
|---|---|---|
| coronation_pending | seeking.rs 到达原目标营地的决策 | scheduler.rs 决策后登基/抢先占用拒绝；途中取消也清理 |
| courtship_pending | evaluate.rs 近距提交/落地；seeking.rs 追逐近距命中 | scheduler.rs 决策后成婚/拒绝；途中资格失效清理 |
| pending_bid_house_ids / pending_bid_upgrade | evaluate.rs::write_bid_pending | housing_system/auction.rs 的出价消费，保留全部候选、冷却和竞拍次序 |
| pending_house_pos | evaluate.rs 选址派发成功写入、失败清理 | settlement.rs 在路线完成后消费候选点；实体化可拒绝，不重新 RNG 选址 |
| raise_child_pending | evaluate.rs 在宅瞬发或远距育儿入口 | world_tick.rs 子阶段 1；未到宅继续保留，不合格清理，成功受孕清理；新写 pending 不在同 tick 提前消费 |

决策后消费保持：登基 → 求偶 → 竞拍标杆衰减 → 出价 → 立宅实体化。升级不依靠新 pending；原房屋阶段读取 ConstructingHouse，符合到宅门槛后瞬时结算，成败均离开施工状态。

### 2.3 RNG、并列规则与已知非理想边界

- 当前 decisions 内实际 RNG 消费仅在 `fulfill_resting_need` 立宅候选的 angle/dist 两次 gen_range，按尝试次数和 Agent 遍历序消费。旧局部指南关于竞拍随机抽房、harvest 随机选 POI 的说法已修正；竞拍为升序候选全集，资源为最近点。
- 求偶按 libido 降序、距离升序、ID 升序。资源/市场最近点保留输入集合遍历顺序的并列选择；夺位 `dist < best` 保留先遇到的营地，不能替换为显式 ID 排序并宣称等价。
- dispatch 对空路径也返回 false；return_home 在派发失败时仍写 ReturningToCamp。掉头在后续路线不可达时可能只装入反向车道并返回成功。M19.1 原样观察这些状态，不修复或“规范化”它们；M19.2 必须单独对照失败出口。
- 当前标签会被阶段和瞬发覆盖，返家也没有保存前一任务用途。旧字段不足以无损反推 ActiveTask，这正是本阶段采用“已知分支结果转换 + 任意时点执行事实观察”的原因。
- b11 守卫不排除 0 级，重排时可能承担 0→1；b16/b18 的有效层级来自覆盖后的 Need，不能由观察器重做几何资格判断。已在类型转换夹具中覆盖。

## 3. 18 条分支的冻结守卫与出口

共同规则：分支 `evaluate` 本身返回代码默认层级，调用方通过 `level_override_for` 套覆盖；常规入口跳过瞬发，瞬发白名单入口逐一提交并继续。非瞬发分支的 0 覆盖被钳回；无命中返回 None。下面用配置字段名记录条件，不重复写一套数值默认值。

| ID | 命中条件摘要（branches.rs，b15 委托 market.rs） | 落地/受阻出口 |
|---|---|---|
| b1 | thirst < decision_critical_thirst 且本人存在开放水点 | 最近水点派发；途中临界口渴保护，断流按原市场准入或返航 |
| b2 | hunger < decision_critical_hunger 且本人存在开放粮点 | 同上，饥饿保护 |
| b3 | stamina < decision_rest_stamina_target | Rest 的 fulfill 直接返回，不新派路线；原休息循环继续 |
| b4 | 有效 home_house、耐久低于修缮阈值、本人为户主或配偶 | 进入 RepairingHouse；维护阶段处理完成/材料失败 |
| b5 | 有效家宅、水袋余量、家户水触发 ON、水点开放 | 派发水点；现场自饮/装袋及连续采收；家户动态默认层级 |
| b6 | 同 b5，资源为粮 | 同上 |
| b7 | 同 b5，资源为木 | 断流可按原资格赴市场；现场完成/体力告警续采或返航 |
| b8 | 家宅 Tier0、完整成本矩阵就绪、本人为成员且成年男性 | 到宅再由房屋系统扣账晋级；派发/材料失败保持原处理 |
| b9 | 有效家宅、石袋余量、家户石触发 ON、石点开放 | 石料链无市场兜底；动态默认层级同家庭分支 |
| b10 | 有效家宅、carried_gold < agent_gold_load_full-0.01、金触发 ON、金点开放、冷却结束 | 备金用途冷却；途中/现场终止守卫保留，不锁多趟 |
| b11 | 家宅未达 Tier4、成本就绪、成员且成年男性（允许 Tier0） | 原升级返宅/瞬时结算，不能按分支名字排除 Tier0 |
| b12 | 无有效家宅、无 pending 宅址、成年男性、饥渴/体力达立宅门槛、存在未满营地 | 选址尝试可失败；成功保存候选点再导航、实体化；保持 RNG 顺序 |
| b13 | Tier4、无需修缮、五类家户触发全 OFF、金袋未达单趟目标、有金点、冷却结束 | 娱乐淘金用途/冷却，不能合并 b10 |
| b14 | 在世成年男性、非王、存在合法无主营地；有房限本宅营地 | 目标易主重选；无目标或失败按原路径静止/返航，不全局重仲裁 |
| b15 | 在世成年男性户主、stamina ≥ market_min_dispatch_stamina、家户 gold ≥ market_min_family_gold；水/粮/木至少一类紧缺或触发 ON 且该类野外全关；市场节点存在 | 既有多品类采购；途中低体力/金币不足、现场任一袋装不下一交易步长或金尽则返航 |
| b16 | 在世非胎儿成年单身男性、无求偶 pending、家户金 > 求偶门槛、有合法女性候选 | 近距默认瞬发，否则追逐；途中生理/资格/目标变化按原处理 |
| b17 | 在世非胎儿成年男性、无出价 pending、冷却结束、有合法在售候选；有房只买更高等级 | 默认瞬发；常规覆盖仍只写全部候选；消费后处理报价与冷却 |
| b18 | 在世非胎儿成年男性、配偶在受孕就绪集合、本人名下至少一栋非 Tier0 房屋、无育儿 pending | 夫妻在宅默认瞬发；否则写 pending 并返宅，子阶段 1 等待/拒绝/成功 |

受孕就绪集合还检查妻子在世、非胎儿、成年、已婚未孕、两种冷却结束以及饥渴/体力门槛。连续采收入口先检查私宅与工作体力，再按配置顺序只遍历 b1/b2/b5/b6/b7/b9/b10；不预排跨品类队列。

## 4. M19.1 实施与验证范围

实现仅新增 intent/strategy/primitive/observation 四个平铺模块和模块声明，未改变 Agent 字段、原分支、调度或物理结算。新类型不入档，存档结构保持 4。没有后台缓存或每 tick 影子选择；观察 API 按需借用当前事实。

临时 native/wasm32 夹具验证全部旧状态 × 有无车道 × 在世/胎儿/死亡，以及多项 pending 同时存在、100 项竞拍候选不截断、路线与候选切片借用、已知分支结果的全部 18 分支/近远距/层级变体和升级错误输入。观察期间以分配计数器验证不新增分配，并比较观察前后序列化状态/RNG。

最终测量值、差分样本与门禁结果由机器报告和本页后续验收数据记录；上述覆盖不声称未来 M19.2 已迁移的行为正确，未来接管仍须逐链新增执行场景差分。

## 5. M19.0 / M19.1 实测数据与验收记录

### 5.1 内存布局实测（Windows x64 MSVC 原生）

| 类型 | 大小 (字节) | 对齐 (字节) | 预算与说明 |
|---|---|---|---|
| `Agent3D` | 520 | 8 | 包含 205 配置衍生与生理/亲属/账本状态 |
| `AgentIntent` | 6 | 1 | 来源分支、层级、意图、完成策略紧凑枚举 |
| `ExecutionStrategy` | 20 | 4 | 目标实体、阶段与变体紧凑枚举 |
| `ActionPrimitive` | 12 | 4 | 目标节点与原语到达/驻留变体 |
| `ActiveTask` | 40 | 4 | 三元组打包，严控在 64B 预算内 |
| `Option<ActiveTask>` | 40 | 4 | Rust enum niche 优化，无额外内存开销 |
| `ExecutionObservation` | 168 | 8 | 纯借用切片视图，生命周期/动作/运动/pending |

### 5.2 探针全分支无副作用验证

- **探针入口**：`crates/sim_core/examples/m19_probe.rs`；
- **覆盖断言数**：**239 项**全部通过；
- **全状态穷举**：21 个 `PrimitiveActionState` × 车道 (None/Some) × 生命周期 (Alive/Fetus/Dead) 无损映射；
- **全分支穷举**：18 个分支（b1～b18）× 瞬发与持续变体 × 层级覆盖转换；
- **零分配保证**：全局计数分配器实测观察前后 `allocs_diff == 0`；
- **零 RNG 消费**：观察前后 `WorldRng` 状态序列化逐字节恒等。

### 5.3 行为等价与确定性基线（seed=42, ticks=3600）

- **Tick 1800 存档**：485,671 字节，SHA-256 为 `cc3454d71a0e1051aca3369dc2a73ee7d19af147232a059886445305cce19d55`；
- **Tick 3600 存档**：487,898 字节，SHA-256 为 `440f2cfb518e87dcc2c08e4f5465cc73c4be7ebcdc05dee66b9341b402acbeef`；
- **Tick 3600 快照**：106,000 字节，SHA-256 为 `c941e00419942116e51ba8eb8b1145c9bd5cdc96a4c2962662499988d305c5e8`；
- **性能基准**：吞吐量 **87,631 TPS**，单 Tick 均值 **11.41 µs**，Phase 6 决策耗时 **2.75 µs/tick** (30.9%)；FABS 二进制帧 **12.9 KB**（Rust 编码 57.53 µs，JS 解码 175.41 µs）；
- **自动化门禁**：`node tools/test-m19-differential.js` 执行 5 大验证项 100% PASS。

