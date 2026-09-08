# 📋 部落民 AI 决策架构重构：预期拆分结果清单与技术规格书 (M19 Spec)

> **文档定位**：本文档为 [19-plan-agent-intent-strategy-decoupling.md](./19-plan-agent-intent-strategy-decoupling.md) 的具体落地技术规格书，明确列出重构完成后**代码目录结构、枚举与类型定义、18 条决策分支映射表、消除的脏代码清单以及全链路对外契约**的最终预期结果。
>
> **版本基准**：v1.46.5 · **目标实施模块**：`crates/sim_core/src/spatial/decisions/`、`crates/sim_core/src/spatial/agent.rs`

---

## 1. 代码目录与文件级预期拆分结果

当前 `crates/sim_core/src/spatial/decisions/` 共 9 个平铺散文件，职责边界高度粘连（`seeking.rs` 与 `harvest.rs` 充斥着业务判断与寻路跳转）。重构后将重组为**三层单一职责子目录 + 2 个胶水文件**，彻底杜绝代码膨胀。

### 1.1 目录结构重构前后对比

```
【重构前目录 (9 个散文件)】                【重构后预期目录 (模块化分层，12 个文件)】
crates/sim_core/src/spatial/decisions/       crates/sim_core/src/spatial/decisions/
├── AGENTS.md                                ├── AGENTS.md (更新局部操作守则)
├── mod.rs                                   ├── mod.rs (模块声明与重导出)
├── needs.rs (领域模型与家宅查询)               ├── context.rs (只读环境快照 DecisionContext，原 needs.rs 提纯)
├── branches.rs (18条自包含分支注册表)         ├── projection.rs (策略/原语 ➔ PrimitiveActionState 投影适配)
├── evaluate.rs (主调度与落地)                 ├── scheduler.rs (错峰调度与 World 物理执行器接入)
├── routing.rs (寻路与掉头)                   │
├── seeking.rs (途中熔断与重路由) ──┐ 拆分收敛 ├── intent/ (Layer 1: 意图仲裁层)
├── harvest.rs (现场采收判定)    ──┼────────>│   ├── mod.rs
└── market.rs (榷场商贸逻辑)     ──┘          │   ├── kinds.rs (纯意图类型 AgentIntent / IntentKind)
                                             │   └── evaluator.rs (18 分支纯意图裁决，只产出 Intent)
                                             │
                                             ├── strategy/ (Layer 2: 策略规划层)
                                             │   ├── mod.rs
                                             │   ├── kinds.rs (ExecutionStrategy / StrategyStatus)
                                             │   ├── selector.rs (根据 Intent 与环境评估最优策略)
                                             │   ├── pipeline.rs (单趟多采收流水线与状态步进)
                                             │   └── fallback.rs (野外断流转榷场等降级矩阵)
                                             │
                                             └── primitive/ (Layer 3: 原语执行层)
                                                 ├── mod.rs
                                                 ├── kinds.rs (ActionPrimitive / PendingCommitKind)
                                                 ├── navigation.rs (A*寻路/APSP查表/原地平滑掉头 UturnTo)
                                                 └── interaction.rs (现场采收/施工/修缮物理步进)
```

### 1.2 重构后各文件预期职责与单文件行数预期

| 文件相对路径 | 核心职责 | 预期代码行数 | 对外公开接口/类型 |
| :--- | :--- | :--- | :--- |
| `decisions/context.rs` | 收集全图资源点、营地、候选女性等只读快照 | ~160 行 | `DecisionContext`, `ResourceNode`, `EligibleFemale` |
| `decisions/projection.rs` | **兼容桥梁**：将内部策略与原语映射为 `PrimitiveActionState` | ~120 行 | `project_to_action_state()` |
| `decisions/scheduler.rs` | 错峰 120 Tick 步进驱动，调用登基/求偶等 World 物理执行器 | ~220 行 | `World3DEngine::tick_decisions()` |
| `intent/kinds.rs` | 定义抽象意图、马斯洛层级与完成/放弃判定阈值 | ~110 行 | `AgentIntent`, `IntentKind`, `SurvivalResource` |
| `intent/evaluator.rs` | 数据驱动迭代 18 条分支注册表，求出当前主导意图 | ~320 行 | `IntentEvaluator::evaluate()` |
| `strategy/kinds.rs` | 定义执行策略形态、流水线阶段与失败原因诊断 | ~140 行 | `ExecutionStrategy`, `HarvestStage`, `StrategyFailureReason` |
| `strategy/selector.rs` | 为意图挑选首选策略（含基于智力/贫富的特质分流） | ~240 行 | `StrategySelector::select_best_strategy()` |
| `strategy/pipeline.rs` | 驱动多品类连续采收流水线、采收完成推进 | ~260 行 | `HarvestPipeline::step()` |
| `strategy/fallback.rs` | **集中化降级**：野外断流转榷场、目标占用重定向等 | ~180 行 | `FallbackRouter::handle_failure()` |
| `primitive/kinds.rs` | 最小原子动作原语与待决标记定义 | ~90 行 | `ActionPrimitive`, `PendingCommitKind` |
| `primitive/navigation.rs` | 纯净导航层：A*寻路、APSP查表、平滑掉头回走 | ~210 行 | `Navigator::dispatch()`, `Navigator::uturn_to()` |
| `primitive/interaction.rs`| 现场作业、装袋、修缮与建造步进驱动 | ~190 行 | `InteractionDriver::tick_onsite()` |

> **规范符合性**：所有单文件严格控制在 **350 行以内**（远低于项目规范上限 800 行），模块高内聚、低耦合。

---

## 2. 18 条决策分支拆分映射对照全集

本表列出既有 18 条分支（`b1` ~ `b18`）在拆分后的对应关系。**彻底消灭原分支中直接硬编码的物理状态与途中降级逻辑**：

| 分支 ID | 分支名称 | 【旧架构】产出与缺陷 | 【新架构】意图 (Layer 1) | 【新架构】策略集 (Layer 2) | 【新架构】动作原语序列 (Layer 3) | 外部兼容投影 (`state`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`b1`** | 口渴求生 | 产出 `SeekingWater`<br/>*缺陷：野外断流在 seeking 打补丁* | `SatisfySurvival(Water)`<br/>目标: 渴度 ≥ 45.0 | **Primary**: `WildHarvest(Water)`<br/>**Fallback**: `MarketTrade(Water)` | `NavigateTo(Water)` ➔ `Interact(Drink)` ➔ `NavigateTo(Home)` | `SeekingWater`<br/>➔ `DrinkingAtWater`<br/>➔ `ReturningToCamp` |
| **`b2`** | 饥饿觅食 | 产出 `SeekingFood`<br/>*缺陷：野外断流在 seeking 打补丁* | `SatisfySurvival(Food)`<br/>目标: 饱腹 ≥ 45.0 | **Primary**: `WildHarvest(Food)`<br/>**Fallback**: `MarketTrade(Food)` | `NavigateTo(Berry)` ➔ `Interact(Eat)` ➔ `NavigateTo(Home)` | `SeekingFood`<br/>➔ `ForagingFood`<br/>➔ `ReturningToCamp` |
| **`b3`** | 体力休息 | 产出 `RestingAtCamp` | `RestAndRecover`<br/>目标: 体力 = 100% | `ReturnHome` ➔ `StationaryRest` | `NavigateTo(Home)` ➔ `StationaryHold` | `ReturningToCamp`<br/>➔ `RestingAtCamp` |
| **`b4`** | 房屋修缮 | 产出 `RepairingHouse` | `RepairHome`<br/>目标: 耐久 = 100% | `StationaryWork(Repair)` | `StationaryHold` | `RepairingHouse` |
| **`b5`** | 家宅储水 | 产出 `SeekingWater`<br/>*缺陷：背包满额由现场强转* | `StockHousehold(Water)`<br/>目标: 补满账本水额 | **Primary**: `WildHarvest(Water)`<br/>**Fallback**: `MarketTrade(Water)` | `NavigateTo(Water)` ➔ `Interact(Pack)` ➔ `NavigateTo(Home)` | `SeekingWater`<br/>➔ `DrinkingAtWater`<br/>➔ `ReturningToCamp` |
| **`b6`** | 家宅储粮 | 产出 `SeekingFood`<br/>*同上* | `StockHousehold(Food)`<br/>目标: 补满账本粮额 | **Primary**: `WildHarvest(Food)`<br/>**Fallback**: `MarketTrade(Food)` | `NavigateTo(Berry)` ➔ `Interact(Pack)` ➔ `NavigateTo(Home)` | `SeekingFood`<br/>➔ `ForagingFood`<br/>➔ `ReturningToCamp` |
| **`b7`** | 过冬木柴 | 产出 `SeekingWood`<br/>*同上* | `StockHousehold(Wood)`<br/>目标: 补满账本木额 | **Primary**: `WildHarvest(Wood)`<br/>**Fallback**: `MarketTrade(Wood)` | `NavigateTo(Forest)` ➔ `Interact(Chop)` ➔ `NavigateTo(Home)` | `SeekingWood`<br/>➔ `GatheringWood`<br/>➔ `ReturningToCamp` |
| **`b8`** | 0级仓库升1级 | 产出 `ConstructingHouse` | `UpgradeHome(Tier1)` | `StationaryWork(Construct)` | `StationaryHold` | `ConstructingHouse` |
| **`b9`** | 采石建材 | 产出 `SeekingStone` | `StockHousehold(Stone)`<br/>目标: 补满账本石料 | `WildHarvest(Stone)` | `NavigateTo(Quarry)` ➔ `Interact(Mine)` ➔ `NavigateTo(Home)` | `SeekingStone`<br/>➔ `MiningStone`<br/>➔ `ReturningToCamp` |
| **`b10`**| 升级备金 | 产出 `SeekingGold` | `StockHousehold(Gold)`<br/>目标: 备齐升级黄金 | `WildHarvest(Gold)` | `NavigateTo(Gold)` ➔ `Interact(Mine)` ➔ `NavigateTo(Home)` | `SeekingGold`<br/>➔ `MiningGold`<br/>➔ `ReturningToCamp` |
| **`b11`**| 房屋持续升级 | 产出 `ConstructingHouse` | `UpgradeHome(NextTier)` | `StationaryWork(Construct)` | `StationaryHold` | `ConstructingHouse` |
| **`b12`**| 自立门户立宅 | 产出 `RestingAtCamp`<br/>*缺陷：分支内直接消耗 RNG 掷点* | `FoundNewHome`<br/>目标: 建立 0 级仓库 | `SurveyAndSettle` (选址策略) | `NavigateTo(SiteNode)` ➔ `CommitPending(FoundHome)` | `RestingAtCamp` (等待实体化) |
| **`b13`**| 庄园娱乐淘金 | 产出 `SeekingGold` | `StockHousehold(LuxuryGold)` | `WildHarvest(Gold)` | `NavigateTo(Gold)` ➔ `Interact(Mine)` ➔ `NavigateTo(Home)` | `SeekingGold`<br/>➔ `MiningGold`<br/>➔ `ReturningToCamp` |
| **`b14`**| 夺位远征 | 产出 `SeekingThrone`<br/>*缺陷：远征途中重定向写死在 seeking* | `ClaimThrone`<br/>目标: 登基为王 | `ExpeditionCommit(Coronation)`<br/>**Fallback**: 重选空营/放弃 | `NavigateTo(CampNode)` ➔ `CommitPending(Coronation)` | `SeekingThrone`<br/>➔ `RestingAtCamp` (结算) |
| **`b15`**| 榷场主动商贸 | 产出 `SeekingMarket` | `StockHousehold(Emergency)` | `MarketTrade` | `NavigateTo(MarketNode)` ➔ `Interact(Trade)` ➔ `NavigateTo(Home)` | `SeekingMarket`<br/>➔ `BuyingAtMarket`<br/>➔ `ReturningToCamp` |
| **`b16`**| 男性求偶成婚 | 瞬发写 pending / 远距 `SeekingCourtship` | `SeekCourtship`<br/>目标: 与最优女性完婚 | **近距**: `InstantCommit(Courtship)`<br/>**远距**: `ExpeditionCommit(Courtship)` | **近距**: `CommitPending(Courtship)`<br/>**远距**: `NavigateTo(FemaleNode)` ➔ `CommitPending` | `RestingAtCamp` (瞬发)<br/>`SeekingCourtship` (奔赴) |
| **`b17`**| 竞购二手房 | 归入 ⓪ 层瞬发，写 `pending_bid_house_ids` | `BidAuctionHouse`<br/>目标: 竞购在售更高房产 | `InstantCommit(AuctionBids)` | `CommitPending(AuctionBids)` | `RestingAtCamp` |
| **`b18`**| 在宅养育后代 | 归入 ⓪ 层瞬发，写 `raise_child_pending` | `RaiseChild`<br/>目标: 促成妻子受孕 | **在家**: `InstantCommit(RaiseChild)`<br/>**在外**: `ReturnHome` ➔ `Commit` | **在家**: `CommitPending(RaiseChild)`<br/>**在外**: `NavigateTo(HomeDoor)` ➔ `CommitPending` | `RestingAtCamp` (瞬发)<br/>`RaiseChild` (奔赴回家) |

---

## 3. 核心数据结构拆分定义与内存布局

### 3.1 意图层定义 (`intent/kinds.rs`)

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentKind {
    SatisfySurvival(SurvivalResource),
    StockHousehold(ResourceKind),
    UpgradeHome { target_tier: HouseTier },
    RepairHome,
    FoundNewHome,
    SeekCourtship,
    RaiseChild,
    BidAuctionHouse,
    ClaimThrone,
    RestAndRecover,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AgentIntent {
    pub kind: IntentKind,
    pub level: MaslowLevel,
    pub satisfy_threshold: f32,
    pub critical_abort_stamina: f32,
}
```

### 3.2 策略层定义 (`strategy/kinds.rs`)

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ExecutionStrategy {
    WildHarvest {
        pool: NodePool,
        target_poi_id: Option<PoiId>,
        stage: HarvestStage,
    },
    MarketTrade {
        resource: ResourceKind,
        target_market_node: NodeId,
        stage: TradeStage,
    },
    HomeDirectConsume {
        resource: SurvivalResource,
    },
    ExpeditionCommit {
        target_node: NodeId,
        commit_type: PendingCommitKind,
    },
    SurveyAndSettle {
        candidate_pos: Vec3,
        target_node: NodeId,
    },
    StationaryWork {
        work_type: StationaryWorkKind,
    },
    ReturnHome {
        target_door_node: NodeId,
    },
    InstantCommit {
        commit_type: PendingCommitKind,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HarvestStage {
    NavigatingToPoi,
    HarvestingOnSite,
    ReturningHomeToUnload,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrategyFailureReason {
    TargetPoiDepleted,
    AllPoiExhausted,
    InsufficientFunds,
    TargetUnavailable,
    StaminaExhausted,
}
```

### 3.3 原语层定义 (`primitive/kinds.rs`)

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ActionPrimitive {
    NavigateTo {
        target_node: NodeId,
        arrival_radius: f32,
    },
    UturnTo {
        target_node: NodeId,
    },
    InteractOnSite {
        poi_id: PoiId,
    },
    StationaryHold,
    CommitPending(PendingCommitKind),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PendingCommitKind {
    Coronation { camp_id: u32 },
    Courtship { target_female_id: AgentId },
    RaiseChild,
    AuctionBids,
    FoundHomeSite { site_pos: Vec3 },
}
```

### 3.4 `Agent3D` 字段变更与内存开销分析

```rust
pub struct Agent3D {
    // ... 原有生理指标、家庭血缘、动力学字段均保持不变 ...

    // ===== 新增解耦控制字段 (定长栈内存，零堆分配) =====
    pub current_intent: Option<AgentIntent>,       // 16 字节
    pub current_strategy: Option<ExecutionStrategy>, // 32 字节 (包含最大变体)
    pub active_primitive: ActionPrimitive,         // 16 字节

    // ===== 保留字段 (对外向下兼容投影) =====
    pub state: PrimitiveActionState,               // 1 字节 (每 tick 自动派生)
}
```

* **内存开销增量**：单 Agent 实体仅增加约 **64 字节**。
* **满载影响**：在 400 人满载场景下，仅增加 $400 \times 64\text{B} = 25.6\text{KB}$ 内存，完全驻留在 CPU L2/L3 高速缓存中，对内存带宽与 TPS 几乎零影响。

---

## 4. 关键控制流重组与消除的脏代码清单

重构将彻底根除以下历次迭代沉淀的“胶水坏味道”：

### 4.1 彻底消除 `seeking.rs` 中的模板化循环
* **现状**：`decide_seeking_material` 与 `decide_seeking_survival` 重复编写“检查目标 triggers ➔ 若全关调 `try_route_to_market` ➔ 若失败找 `nearest_of` ➔ 原地掉头 ➔ 失败返家”逻辑。
* **拆分后**：统一收敛至 `strategy/fallback.rs::handle_target_failure()`。原语层只上报 `TargetPoiDepleted`，由策略选择器查表决断是否掉头改道或前往榷场。

### 4.2 拔除 `try_route_to_market` 侵入式跳转
* **现状**：`try_route_to_market` 既要查家户金币、又要查市场节点、还要强改 `state = SeekingMarket`、还要立即调 `dispatch`。
* **拆分后**：该函数被拆解为两部分：
  1. `strategy/fallback.rs` 内的条件准入检查（纯判定）；
  2. 满足准入时生成 `ExecutionStrategy::MarketTrade` 策略交由步进器处理，不再越权直接改写底层运动与状态。

### 4.3 规范单趟多采收为流水线 (`strategy/pipeline.rs`)
* **现状**：`try_continue_harvesting` 在采水/采果现场直接借用外部分支注册表 `branch.evaluate()` 再次试探，破坏了状态机的局部性。
* **拆分后**：意图层允许派发 `StockHouseholdBatch([Wood, Food])`；策略层维护 `PipelineQueue`，采收完成后自动进阶到下一阶段，无需跨层回溯。

### 4.4 ⓪ 瞬间行为层统一模型
* **现状**：`evaluate.rs` 开头必须人工维护 `evaluate_instant_needs`，手工对三种分支特判。
* **拆分后**：分支评估只要判定满足近距离条件，直接输出对应的策略为 `InstantCommit`；步进器在同一个 Tick 立即执行 `ActionPrimitive::CommitPending`，天然完成“零耗时即刻落地”，消除双重评估代码。

---

## 5. 对外契约与全链路影响面说明

| 关联子系统 | 是否破坏现有接口 | 适配策略与验证方案 |
| :--- | :---: | :--- |
| **`crates/sim_wasm`** | **否** | WASM 导出函数（`world_tick`、`world_snapshot_bin` 等）签名 100% 保持原样。 |
| **FABS 二进制快照 (`snapshot_bin`)** | **否** | `snapshot_bin/encode.rs` 读取的 `agent.state` 是经过 `projection.rs` 映射后的确定性枚举，码位与字节流逐位一致。门禁：`test-snapshot-bin.js`。 |
| **Canvas 渲染器 (`render_canvas.js`)** | **否** | 渲染管线继续读取 `agent.state` 渲染动作小人与状态气泡，无需任何改动。 |
| **前端决策配置 (`config.decision-order.js`)** | **否** | 18 条分支的稳定 ID (`"b1"` ~ `"b18"`) 与顺序注入逻辑完全保留，意图层继续沿用该顺序做优先级决策。 |
| **前端 Inspector 面板** | **平滑增强** | 短期内 `current_need` 字符串格式保持不变；后续无缝扩展三栏显示：意图、策略、动作。 |
| **存读档系统 (`world_save.rs`)** | **平滑兼容** | 新增的 `current_intent` 与 `current_strategy` 支持 `#[serde(default)]`，旧档载入时自动推导初始化，杜绝坏档。 |

---

## 6. 核心不变量与验收基准

重构落地必须通过以下硬性门禁：

1. **确定性不变**：
   - 必须通过 `node tools/test-determinism.js`（6/6 套件全绿，同种子同 Tick 逐字节严格对齐）。
2. **性能不降**：
   - 运行 `node tools/profile-benchmark.js`，Phase 6（马斯洛决策与寻路）单拍耗时不得增加超过 **1.5 µs**，全内核吞吐保持在 **95,000 TPS** 以上。
3. **坐标连续性绝不妥协**：
   - 任何策略切换引发的航向改变，必须调用 `Navigator::uturn_to`（原地车道平滑回走），`node tools/diagnose.js --check all` 不得报任何闪现或停滞异常。
