# 部落民 AI 决策架构重构技术规格（M19）

> **状态**：**全阶段落地完成**（M19.0～M19.3 基础解耦与 M19.4a～M19.4d 独立增强已全量落地）。
>
> **源码与落地版本**：v1.46.10；范围与里程碑见[总体规划](./19-plan-agent-intent-strategy-decoupling.md)。本文是类型、控制协议、分支映射、时序及验收的详细权威定义。
>
> **落地概况**：三层解耦与 `ActiveTask` 控制器已成为持续任务单一真相源；Inspector 三栏看板、分级抢占矩阵、禀赋家资个性化选策、多品类预排队列与行程优化已全量上线并通过测试矩阵验收。

## 1. 模块组织与依赖边界

预期组织如下；不预先承诺文件数量、350 行上限或总行数。遵守项目单文件 800 行规范，按实际职责拆分，并为新增复杂目录维护局部 AGENTS。

```text
crates/sim_core/src/spatial/decisions/
├── mod.rs
├── AGENTS.md
├── context.rs              # 借用世界数据、资格事实查询；不复制完整世界
├── scheduler.rs            # 保留既有错峰与 pending 消费顺序
├── transition.rs           # 统一安装/结束任务及物理事件同步
├── projection.rs           # 执行状态到旧枚举/标签的纯视图
├── intent/
│   ├── mod.rs
│   ├── kinds.rs            # Intent、完成条件、来源分支
│   ├── branches.rs         # b1～b18 稳定注册表与自包含守卫
│   ├── evaluator.rs        # 持续仲裁、保持/取消/抢占政策
│   └── instantaneous.rs    # 多次瞬发，不占持续任务槽位
├── strategy/
│   ├── mod.rs
│   ├── kinds.rs            # 策略阶段、可行性与结果
│   ├── selector.rs         # 只读探测，选中后才允许规划副作用
│   ├── resource.rs         # 采收/交易/卸货；向 L1 请求连续采收仲裁
│   ├── social.rs           # 求偶/夺位的合法目标和重选
│   ├── housing.rs          # 立宅/升级/修缮的执行计划
│   └── fallback.rs         # 同意图内替代手段；失败交回 L1
└── primitive/
    ├── mod.rs
    ├── kinds.rs            # 导航、驻留、提交描述与物理结果
    ├── navigation.rs       # 复用 dispatch/车道连续重路由
    └── adapter.rs          # 接入既有交互与 pending，不实现第二套结算
```

`ecology/`、`housing_system/`、`world_tick.rs` 和账本系统继续拥有物理结算。`primitive/adapter.rs` 只安装或解释执行意图，不新增 `tick_onsite()` 再次装袋、扣账、施工。类型提取先于目录搬迁；一次迁移一条行为链，避免纯搬文件与行为变化混在一起。

## 2. 领域类型与数据所有权

以下为结构草案，省略导入和 serde 派生。正式实现必须使用实际 ID 类型，并为持久化字段实现序列化。含 `f32/Vec3` 的类型只派生可用的 `PartialEq`，不能盲目派生 `Eq`；不得将草案的内存大小作为 ABI 保证。

### 2.1 持续意图

```rust
pub struct AgentIntent {
    pub source_branch: BranchId,
    pub level: MaslowLevel,
    pub kind: IntentKind,
    pub completion: CompletionPolicy,
}

pub enum SurvivalResource { Water, Food }
pub enum GoldPurpose { BuildingReserve, Wealth }

pub enum IntentKind {
    SatisfySurvival(SurvivalResource),
    StockHousehold(ResourceKind),       // 水/粮/木/石，金由下列用途区分
    AcquireGold(GoldPurpose),
    EmergencySupply,                   // b15：水/粮/木急迫补给，非新资源种类
    RestAndRecover,
    RepairHome,
    UpgradeHome { target_tier: HouseTier },
    FoundNewHome,
    SeekCourtship,
    ClaimThrone,
    RaiseChild,
}

pub enum CompletionPolicy {
    SurvivalSatisfied(SurvivalResource),
    HouseholdStockSatisfied(ResourceKind),
    GoldTripFinished(GoldPurpose),
    EmergencySupplyFinished,
    RecoveryFinished,
    HomeRepaired,
    HomeAtTier(HouseTier),
    HomeFounded,
    MarriageRegistered,
    CoronationRegistered,
    ChildcareSettled,
}
```

完成策略是类型化判据，不保存一个通用 `satisfy_threshold`：

| 判据 | 权威输入与含义 |
|---|---|
| SurvivalSatisfied | 当前饥渴值与 `agent_self_satisfied_threshold`；不代表同行补货也完成 |
| HouseholdStockSatisfied | 当前有效私宅、家户关系与家户补货触发器；保留 ON/OFF 滞回，不改成只比较一次余额 |
| GoldTripFinished | 用途对应的既有单趟目标、结束守卫与冷却；备金和娱乐不可合并 |
| EmergencySupplyFinished | 既有市场多品类完成规则；资金见底是执行结束原因，不伪称已满足需求 |
| RecoveryFinished / HomeRepaired | 使用现有休息退出/修缮退出守卫，不引入“必须恢复到 100% 才允许其他需求” |
| HomeAtTier / HomeFounded | 校验绑定的房屋 ID、归属和结算结果，不能只看某栋房屋达到等级 |
| MarriageRegistered / CoronationRegistered / ChildcareSettled | 世界执行器的结果及关系事实；pending 写入不算成功 |

数值从当前 SimConfig 读取，沿用配置热注入语义，不把 45、100 或 200 写进新层。`source_branch` 用于稳定配置映射、标签、资格重验和用途冷却。`level` 不是单独的排序算法，不能取代配置顺序或现有动态层级覆盖。

目标满足、策略结束和本次任务关闭分别记录：返家卸完一袋可能只结束一次补货行程，L1 可以重新仲裁，不能把余额不足误报为目标满足，也不能锁定多趟补货阻塞其他需求。

### 2.2 持续策略与原语

```rust
pub struct ActiveTask {
    pub intent: AgentIntent,
    pub strategy: ExecutionStrategy,
    pub primitive: ActionPrimitive,
}

pub enum ExecutionStrategy {
    WildHarvest { pool: NodePool, poi: Option<PoiId>, stage: ResourceStage },
    MarketTrade { market: PoiId, stage: ResourceStage },
    ReturnToResidence { destination: ResidenceTarget, stage: ReturnStage },
    Courtship { female: AgentId, stage: CommitStage },
    ClaimThrone { camp: u32, stage: CommitStage },
    Childcare { house: u32, stage: CommitStage },
    FoundHome { site: Vec3, route_target: NodeId, stage: CommitStage },
    UpgradeHome { house: u32, target_tier: HouseTier, stage: HomeStage },
    RepairHome { house: u32, stage: HomeStage },
}

pub enum ResourceStage { Outbound, OnSite, Returning, Unloading }
pub enum ReturnStage { Travelling, Recovering }
pub enum CommitStage { Travelling, Ready, AwaitingSettlement }
pub enum HomeStage { Returning, Working }
pub enum ResidenceTarget { House(u32), Camp(NodeId) }

pub enum ActionPrimitive {
    Navigate { target: NodeId, arrival: ArrivalKind },
    Hold(HoldKind),
    AwaitSettlement,
}
pub enum ArrivalKind { ResourceSite, Residence, SocialTarget, FoundSite }
pub enum HoldKind { ResourceSite(PoiId), Residence, Repair, Upgrade, OffRoad }
```

`MarketTrade` 保留当前一次交易可购买水/粮/木的行为，不因触发的是水需求就偷偷改成单品采购。基础阶段不新增 `HomeDirectConsume` 策略；在宅吃喝继续由生态结算，L1 读取其已更新结果。修缮/升级的目标有效性、到宅要求依照现有执行入口，不擅自新增移动或等待。

策略中的目标实体 ID 是真相源，节点是规划解析结果；目标移动/换主/消失时重新验证，不能只保存节点。无私宅返航可以指向营地。立宅候选点和路网目标必须分开，不能把候选点替换为最近节点坐标。

`ActiveTask` 打包三层控制字段，避免 `intent=None` 而 `strategy=Some` 等独立 Option 组合。阶段与原语仍须遵守 §6 的合法组合表，仅 `transition.rs` 可修改；路线和位置不在任务中重复保存。

### 2.3 瞬发和既有 pending

瞬发提交采用独立接口 `submit_instant(branch, request)`，不作为 `ExecutionStrategy::InstantCommit`，不覆盖 `ActiveTask`。请求类型沿用三类事实：求偶目标 ID、竞拍候选、育儿意图。竞拍候选继续使用既有集合及稳定顺序，不用一个固定三元素队列截断房屋候选。

保留 `courtship_pending`、`pending_bid_house_ids`、`raise_child_pending` 等既有字段作为待结算真相源，禁止再复制到第二个待决队列。持续求偶/夺位/育儿等也向对应既有 pending 提交；需要等结算的持续任务进入 `AwaitingSettlement`。相同任务不得重复提交，提交前沿用 pending 与冷却幂等守卫。

每个请求的成功/拒绝结果必须关联原目标与原请求；基础迁移可由既有 pending 消费分支直接通知转换接口，无需新增全局事件总线。如果未来使用缓冲结果，必须保存关联标识，定义覆盖/消费规则并入档，不能用一个“最后结果”覆盖多个瞬发结果。

### 2.4 单一真相源

| 数据 | 所有者 | 其他模块如何使用 |
|---|---|---|
| 持续任务与意图 | 完成迁移后的控制器；迁移前见 §6 | 通过转换接口修改，其他模块只读 |
| 位置、车道、路线与进度 | 既有运动系统 | 规划器发命令，不复制第二条路线 |
| 资源、健康、家庭关系和私宅 | 生态/代谢/账本/房屋系统 | L1/L2 只读事实，执行器按原规则结算 |
| pending | 原字段及原物理执行器 | 提交接口幂等写入，消费时反馈 |
| POI/家户触发器 | Agent 原锁存状态 | 原时点刷新，策略只读结论 |
| `state`、`current_need` | 完成迁移后的执行兼容视图 | 保留旧枚举和标签语义，禁止其他模块自由覆写 |

## 3. 仲裁、失败与取消协议

### 3.1 可行性与有界仲裁

只读候选探测返回：

- `Applicable`：存在合法实现机会；选中后才进入实际规划和派发。
- `NotApplicable`：分支或目标资格不成立。
- `Blocked(reason)`：需求成立，但本回合缺少可用手段。

失败原因至少区分目标 POI 关闭、无同类可用点、无合法社会目标、路径不可达、资金不足、体力限制、私宅/家户资格失效、提交被拒绝。POI 库存关闭与路径不可达不能混为一谈。

每次仲裁用本地定长分支位图限制已尝试集合，最多尝试注册表长度次；同一策略替代链每种候选手段最多尝试一次。不能把失败立即递归送回同一分支。跨相位默认不新增持久化“禁选”标志或退避冷却，保持原行为。

基础重构保留现有状态对应的仲裁域：休息时常规分支遍历；寻路时原途中处理；采收结束时原连续采收允许集合。不能扩大成“任何状态每相位都选全局最高需求”。`Blocked` 继续、等待或关闭任务的处理要对照旧入口逐项迁移，差分不一致须解释并移出等价重构。

只读探测不得调用共享 RNG 或改变缓存语义；已有随机选点在最终选中策略的原调用时点执行。探测不等于保证 dispatch 成功，派发失败仍走原入口失败路径，不能提前安装新状态。

### 3.2 瞬发遍历

1. 只对在世非胎儿、命中错峰相位的 Agent 执行，先刷新原有观测/锁存，再按现有瞬发入口遍历。
2. 沿用 `is_instant()` 白名单、分支自包含近距/在宅守卫及 `level_override_for`。非瞬发分支不能被配置强制为瞬发。
3. 每次命中仅写既有 pending 并继续；不得移动、扣账、改持续任务或消费 RNG。
4. 随后处理持续任务；常规评估遇已处理瞬发结论跳过，不重复提交。层级覆盖降为常规的 b17 仍复用提交接口，不制造持续竞拍占位任务。
5. 标签遵守旧逻辑：有常规标签则覆盖瞬发标签，无常规标签时保留本拍瞬发标签。

### 3.3 保持、抢占、取消与失败替代

| 结果 | 持续任务处理 |
|---|---|
| 正常进行 | 保留当前目标和已选路线，不每相位重新挑最近点 |
| 原语到达 | 在原物理时点推进执行阶段，需求是否完成仍按原决策时点判断 |
| 同意图手段失败 | 在原允许的时点重选合法目标/市场；不改变来源分支与意图用途 |
| 无可行手段 | L2 报告，L1 按兼容政策决定等待、结束或返家；L2 不越权创建新意图 |
| 普通疲劳 | 继续使用原临界饥渴保护，不通过通用阈值强行中断求生 |
| 资格失效或既有允许的抢占 | L1 取消任务；清理任务自己的目标/未提交控制状态；不删除行囊或其他瞬发 pending |
| 世界结算成功/拒绝 | 保留原消费时点与顺序，反馈对应任务；不在反馈回调里启动额外一轮需求评估 |
| 死亡/胎儿状态 | 生命周期优先，停止行动并同步兼容视图；旧控制记录不能投影回存活动作 |

已经提交的 pending 不凭任务切换任意撤销，保留原执行器的资格重验与清理规则；已结算效果不可回滚。无私宅/家宅换主的返航目标须重验，不能继续卸入旧家户。基础阶段不保存暂停任务栈；重新选择时读取当前资格。

## 4. b1～b18 映射与语义保留

本表不替代现有分支的全部条件函数；M19.0 必须逐分支登记原条件、失败出口及配置覆盖行为，不能按表中摘要重写守卫。表中状态表示兼容状态，不意味着所有状态都物理静止。

| ID | 持续意图或瞬发提交 | 策略/执行方式 | 必须保留的语义 |
|---|---|---|---|
| b1 | SatisfySurvival(Water) | WildHarvest，既有断流资格下 MarketTrade | 自饮与同程补货可并存；临界口渴保护；无房不装袋 |
| b2 | SatisfySurvival(Food) | WildHarvest，既有断流资格下 MarketTrade | 同上，按饥饿守卫；在宅吃喝仍归生态系统 |
| b3 | RestAndRecover | 原休息/返航执行语义 | 不引入必须满体力退出或强制多走一趟返家 |
| b4 | RepairHome | RepairHome，原修缮执行器 | 原触发/停止门槛、资格与地点条件，不复制结算 |
| b5 | StockHousehold(Water) | WildHarvest / 既有市场兜底 | 家户触发器、独立水行囊与卸货速率 |
| b6 | StockHousehold(Food) | WildHarvest / 既有市场兜底 | 家户触发器、独立粮行囊与卸货速率 |
| b7 | StockHousehold(Wood) | WildHarvest / 既有市场兜底 | 水粮木才有断流市场资格；无房守卫 |
| b8 | UpgradeHome(Tier1) | UpgradeHome：原返宅/Working | 水粮材料门槛；到宅后原房屋系统瞬时扣账晋级，无新增工时 |
| b9 | StockHousehold(Stone) | WildHarvest | 不新增石料市场兜底 |
| b10 | AcquireGold(BuildingReserve) | WildHarvest(Gold) | 备金资格、家户触发器、单趟目标及备金冷却 |
| b11 | UpgradeHome(NextTier) | UpgradeHome：原返宅/Working | 原固定成本矩阵、归属、到宅门槛、瞬时结算与威望 |
| b12 | FoundNewHome | FoundHome：选址、导航、原实体化 | 选定后才按原序消费 RNG；保留 pending 候选点、路线完成守卫及既有实体化定位例外 |
| b13 | AcquireGold(Wealth) | WildHarvest(Gold) | 4 级庄园资格、娱乐用途及独立冷却；不造 LuxuryGold 资源 |
| b14 | ClaimThrone | ClaimThrone：导航、登基提交 | 有房仅自家营地，无房合法营地集合；保留原并列选择与重定向规则 |
| b15 | EmergencySupply | MarketTrade | 户主/金币/体力/短缺条件，既有多品类采购；不造 Emergency 资源 |
| b16 | SeekCourtship 或瞬发求偶 | Courtship 或独立 pending 提交 | 原合法女性筛选/择偶排序；近距瞬发、远距持续；不抢占其他瞬发 |
| b17 | 独立竞拍提交 | 原候选集合与出价执行器 | 多房候选、冷却、无 RNG；层级覆盖不能变成持久占位任务 |
| b18 | RaiseChild 或瞬发育儿 | Childcare 或独立 pending 提交 | 自宅等级、夫妻位置、身体和冷却；远距路径保留原提前写 pending 的时点 |

连续采收请求沿用当前 `try_continue_harvesting` 的允许集合 b1/b2/b5/b6/b7/b9/b10，按配置顺序动态检查，且保留其私宅和体力前置条件。资源阶段结束后不直接从队列派新任务；由 L1 输出下一个意图，再由 L2 规划。黄金的途中和现场冷却设置也必须一起迁移。

## 5. Tick 时序与提交消费

### 5.1 基准源码时序

以下记录 `world_tick.rs::tick()` / `tick_subphase()` 的实际调用顺序。根 AGENTS §4.3 的概括顺序存在漂移，按总体规划 M19.0 先核实并修正文档；本方案不授权改动管线。

| 子阶段 | 当前职责 | M19 的接入点 |
|---|---|---|
| 0 | tick 计数、四季/POI 再生 | 不变 |
| 1 | 代谢、繁衍、育儿 pending 消费、胎儿协调/继承 | 生命周期与提交结果同步；不调度新的 L1/L2 |
| 2 | POI 交互、自饮、采收、交易、回家卸货 | 原速率原顺序；记录执行事实，不额外选任务 |
| 3 | 房屋系统、升级/修缮等结算 | 只消费已表达的行动，保持瞬时升级 |
| 4 | 道路衰减 | 不变 |
| 5 | 运动与到达 | 在原到达时点更新原语/阶段/兼容状态 |
| 6 | POI 观测、错峰决策、决策后的物理提交结算 | 瞬发旁路 → 原状态对应的持续仲裁/策略步骤；保持 Agent 遍历序 |
| 7 | 家户/宗族/政体等账本 | 既有实体变化通过转换接口失效任务事实，不指派行动 |
| 8 | 清理 | 生命周期清理，不启动新任务 |

只有命中 `(tick + id) % config.agent_decision_interval_ticks == 0` 的在世非胎儿 Agent 运行决策，当前默认间隔 120。原语执行对应的运动/物理结算每 tick 继续运行。不能将到达投影拖到下一决策相位，也不能在到达回调多运行一次仲裁。

### 5.2 Pending 与结算时点

| 意图/行动 | 提交时点 | 消费时点与结果 |
|---|---|---|
| 登基、求偶、竞拍 | 原瞬发或持续任务决策入口 | 子阶段 6 决策后；维持登基 → 求偶 → 竞拍标杆衰减 → 竞拍 → 立宅实体化的现有次序 |
| 立宅 | 选址和派发成功时写原候选点 | 子阶段 6 的实体化入口，沿用原路线完成等条件；不是选址后立即成功 |
| 育儿 | 原近距/在宅瞬发入口或远距育儿入口 | 子阶段 1 消费，因此子阶段 6 新写 pending 最早在后续 tick 消费；保留当前未到宅时的等待/清理规则 |
| 升级/修缮 | 原任务派发或驻留转换 | 原房屋阶段读取执行状态结算；不新增第二份 pending 或人工延迟 |

执行器在消费时重新校验目标、资格、资源和冲突，沿用既有仲裁顺序。提交失败/目标已被抢先占用不能伪造成功；结果只反馈原任务，常规需求重新选择仍发生在原调度入口。

## 6. 状态迁移、投影与导航契约

### 6.1 写入权移交

M19.0 搜索并分类所有 `state` 写入、`enter_stationary_state`、路线到达、死亡、房产/婚姻/政体变化和 pending 消费点，范围包括 `agent.rs`、`decisions/`、`ecology/`、`housing_system/`、`world_tick.rs`、`ledger/`、初始化/出生及存档。不能只改 `decisions/`。

- M19.1：旧字段权威，新记录为只读观察；不得每 tick 用观察值覆盖旧状态，不影子运行会消费 RNG 的选址或派发。
- M19.2：按行为链启用新控制，迁移开关仅作临时开发机制；一次安装新任务成功后该链不再经过旧状态机驱动。所有物理结果入口同步新控制记录。
- M19.3：删除临时开关/双模型。任务修改只走 `transition.rs`；兼容 `state` 在动作安装、到达、提交消费和生命周期事件时立即同步，快照读取无副作用。

### 6.2 合法组合与兼容视图

| 执行事实 | 允许的阶段/原语 | 兼容 `PrimitiveActionState` |
|---|---|---|
| 死亡 | 无可行动任务，生命周期终态 | Dead，任何投影都不能覆盖 |
| 胎儿 | 无自主任务 | 保留既有胎儿序列化/展示约定 |
| 野外前往资源点 | Outbound + Navigate | 按资源 SeekingWater/Food/Wood/Stone/Gold |
| 野外已到资源点 | OnSite + Hold(ResourceSite) | DrinkingAtWater/ForagingFood/GatheringWood/MiningStone/MiningGold |
| 市场前往/交易 | Outbound + Navigate / OnSite + Hold(ResourceSite) | SeekingMarket / BuyingAtMarket |
| 采收或市场返航 | Returning + Navigate | ReturningToCamp，不再按采收资源映射 Seeking* |
| 到宅卸货 | Unloading + Hold(Residence) | RestingAtCamp；尚未把“抵达”当“卸完” |
| 普通返航/驻留休息 | Travelling + Navigate / Recovering + Hold(Residence) | ReturningToCamp / RestingAtCamp |
| 求偶/夺位 | 原导航、已到达待决策、待结算阶段 | 保留 SeekingCourtship/SeekingThrone 到原结算转换时点 |
| 育儿 | 原返宅或驻留待结算阶段 | 保留 RaiseChild 的原投影，不能默认休息 |
| 升级 | Returning + Navigate / Working + Hold(Upgrade) | 两者沿用原 ConstructingHouse；是否移动由车道决定 |
| 修缮 | 原合法驻留作业状态 | RepairingHouse |
| 立宅 | 原立宅导航/候选实体化等待 | 保留原 RestingAtCamp 兼容值，不能据该值擅自停止导航 |
| 路线失效 | Hold(OffRoad)，保留任务失败上下文 | OffRoadDetour；按原决策入口恢复 |
| 仅瞬发提交 | 原持续任务/原语保持 | 不改变行动视图；实际消费的状态变化另同步 |

映射必须穷尽现有枚举和合法组合，不允许 `_ => RestingAtCamp` 掩盖遗漏。实施时按基线逐状态验证；合法但不常见的移动/状态组合不能被“清理”掉。

### 6.3 导航的提交与失败

- 新路线成功后才安装相应任务/阶段/状态；失败不得留下新策略配旧路线的半更新状态。原有失败副作用如需保留，应显式列入兼容政策。
- 在车道上重定向，复用原车道连续掉头/重路由逻辑；已在节点或现场、没有活动车道时正常 dispatch，不要求所有切换无条件 U-turn。
- 导航方向调整属于 L3 的实现细节，不作为可独立长期保存的 `UturnTo` 任务类型；存档保留实际车道方向和路线进度。
- 进入真正静止执行态走 `enter_stationary_state()` 清车道、速度与路线进度；纯投影不能执行该动作。
- 到达判定沿用 `current_lane_id.is_none()` 及原地点条件，不用 `route.is_empty()`。
- 不新增瞬移。立宅实体化设置候选点位置是根 AGENTS §4.16 已有例外，基线须单独标记，不能借重构扩大适用范围。

## 7. 快照、存档与性能

### 7.1 外部契约

基础重构保留 WASM 签名、FABS 布局/码位、现有 `current_need`、目标字段和派生统计。`state` 相同不代表远征统计、需求标签等其他字段也相同，须完整比较。三栏 UI 延后；若新增字段，同步 `snapshot.rs`、`world_snapshot.rs`、`snapshot_bin/encode.rs`、`snapshot-bin.js`、`rustworld.js` 及消费方。JSON 调试真值接口仍仅供既有快照对照测试使用。

### 7.2 持久化与恢复

当前源码格式版本为 4。首次将新的必要任务字段纳入存档时，按项目规则提升 `SAVE_FORMAT_VERSION` 并同步前端；版本号以实施时源码为准，不预先在文档写死目标版本。应用版本按统一升版器更新并同步 WASM 双副本，旧应用版本存档仍拒绝加载。

必须保存：ActiveTask（含用途、目标、阶段、原语）、所有无法从世界事实唯一重建且会影响下一步的结果、既有 pending、路线/车道进度、RNG、私有触发器和冷却。派生兼容视图可以重建，但只能从完整控制状态纯计算，不能重新选目标、重新消费 RNG、重复出价或重放已结算提交。

恢复时校验控制字段组合、目标关联与 pending 一致性。目标因世界演化已失效是合法待处理状态，保留到原决策相位处理；结构损坏、非法枚举组合或关联不一致明确报错。不得用 `serde(default)` 把未知途中状态静默变成空闲。同版本中途恢复必须与不中断运行连续一致。

### 7.3 内存与性能预算

新增控制对象采用定长结构/枚举，不引入 `Box<dyn Strategy>`、按 Agent 每相位分配的策略列表或不受限队列。既有上下文、路径和竞拍集合存在分配，不能把“新控制对象不分配”写成全引擎零分配。

M19.0 在 native 和 wasm32 分别记录 `size_of`、`align_of`、`Option<ActiveTask>` 及 Agent 总大小，用实测增量乘以人口计算内存；不预写 16/32/64 字节，也不凭总大小承诺缓存驻留或零带宽影响。

性能验收统一采用配对相对基线：同机器、同工具链、release、同 seed/config/tick/快照频率，预热后至少 3 次，比较中位数；Phase 6 决策耗时与全内核每 tick 耗时增长均不超过 **5%**。若噪声跨越阈值，增加配对样本并调查，不以单次测量放行。记录初始规模和满载存档场景；TPS 作为报告指标，不设跨机器 95,000 TPS 门槛。候选探测引入的重复扫描也计入成本。

## 8. 验收矩阵

| 验证维度 | 方法与必须覆盖的场景 | 判定 |
|---|---|---|
| 同版本确定性 | `node tools/test-determinism.js`；多种子、分批/子阶段、快照无副作用、存读档、人口规模 | 现有矩阵全部通过 |
| 长程稳定 | `node tools/test-wasm.js` | 无越界/NaN，确定性与长程检查通过 |
| 新旧行为等价 | M19.0 保存旧 WASM 与配置；临时驱动新旧独立实例，逐检查点比较解码快照与共享领域状态、账本流水、RNG 状态 | 只归一化显式版本元信息及新增内部表示；禁止忽略位置、标签、资源、冷却和 RNG 差异；首个差异即定位 |
| 快照同构 | `node tools/test-snapshot-bin.js` | 当前构建 FABS 与调试真值等价，含增量/换世界；不冒称证明新旧版本等价 |
| 瞬发并行 | 寻水途中出价；同相位多个瞬发；b16/b18 近距与远距；b17 层级覆盖 | 提交不替换行动；全部合法 pending 可产生，消费顺序保持 |
| 生存与可行性 | 临界饥渴且低体力；高优先级无合法目标；无路可达；单点/全图断流；市场不准入 | 保留临界求生守卫；仲裁有界；按原入口处理失败 |
| 多品类与搬运 | 配偶途中补足库存；采收时新生存需求；各袋独立满载；金币用途冷却；途中失宅 | 动态仲裁、真实卸货、无多买/多采/冷却串用 |
| 社会/房屋 | 求偶目标变动、王位抢先占用、有房营地限制、近宅升级材料不足、立宅选址 RNG | 资格与结算时点保持，提交拒绝可反馈，无系统派任务 |
| 状态同步与导航 | 车道中改道、节点派发、返家到达、离路、死亡、立宅定位例外 | 状态/路线/任务组合合法，原到达时点同步；使用 `node tools/diagnose.js --check all` 辅助诊断 |
| 同版本中途存读档 | 去 POI、在现场、返家、部分卸货、立宅途中、育儿/登基等待结算、目标已失效 | 读档后与连续运行一致，不重新规划或重复提交 |
| 顺序/覆盖/热配置 | b1～b18 重排、合法/非法层级覆盖、途中热注入 | 守卫自包含，使用现有生效时点，不新增固定优先级 |
| 性能/内存 | §7.3 配对基线和布局测量 | 记录实测，满足相对预算，新增控制分配受控 |
| 工程一致性 | `cargo test --lib`、release WASM 构建及双副本、版本/配置/前端/文档门禁 | 对应工具通过，更新影响矩阵与已落地机制文档 |

差分样本与特殊状态可通过临时脚本/调试断言构造；按根 AGENTS §4.10 验证后删除，不提交持久化单元测试。既有六套确定性矩阵只证明当前实现自洽，新旧对照必须保留独立基线，不能拿同一新 WASM 跑两次代替。

基础重构不要求新旧存档互相加载，也不因应用版本变化把行为差分全跳过。只有上述契约与已迁移链路的门禁通过后才移交下一条链路；目录重组完成本身不构成验收。
