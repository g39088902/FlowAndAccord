# 账本与仓库重构 · 开发计划 (Ledger · Group · Marriage Registry Refactor Plan)

> **依据**：[docs/PLAN.md](./PLAN.md) §3.4「多级产权账本经济（Property Ledger Economy）」
> **现状基线**：**v1.0.0**（M1 已完成：确定性内核 + 团体基类 + 婚姻登记簿 + 家户体系 + 前端UI展示）
> **核心理念**：账本即权力，资产负债表即社会结构快照 —— 资产归属于有管理者的账本主体，任何资源流动都是主体间的显式 Transfer（可审计、可追溯）。

> **版本号策略（v1.0.0 起生效）**：
> - **主版本号（major）**：架构级重构或经济系统范式切换（如 1.x → 2.0.0）；
> - **次版本号（minor）**：**中等功能更新**——每个 M 里程碑核心特性落地即 +1（M2→1.1.0、M3→1.2.0、M4→1.3.0、M5收尾→1.4.0）；
> - **修订号（patch）**：Bug 修复、样式调整、文档更新等小改动 +1（如 1.0.1、1.0.2）；
> - 版本号同步位置：`index.html` 徽章 + `AGENTS.md` 两处 + `docs/current/11-changelog.md` 追加条目（根 AGENTS.md §4.9）。

> **本计划修订原则（v5）**：
> 1. **新经济系统与现有房屋/仓库系统完全分离**——`House.pantry_*`、`Agent3D.carried_*`、`ecology.rs::tick_poi_interactions` 等既有物理仓储逻辑**一律不动、不做兼容层、不做行为等价迁移**；新账本体系作为独立子系统并行建设，通过旁路记账观测物理事件。
> 2. **统一团体抽象（Group）**：家庭、宗族、地区居民本质都是**团体**——基类持有三要素：**领导（leader）、成员列表（含领导）、账本（仓库）**；各具体团体只是基类的不同实例化。
> 3. **族长规则**：每个**姓氏**中年龄最大的在世男性即为族长，死亡自动顺位。
> 4. **婚姻登记系统**：终身多段婚姻全留痕（初婚/丧偶/改嫁）；"有房才能结婚"的玩法门槛不变，但**婚姻与房屋在数据上解耦**。
> 5. **地区团体独有"政体 + 换届"**：目前仅设**国王**与**长子继承制**——默认第一个到达营地的男人为国王；国王传位遵循长子继承制；国王绝嗣则由下一个**最先到达营地**的男人接任。
> 6. **★ 家族规则（v4 新增，取代 v3 的"家庭账本挂婚姻"）**：
>    - **家庭跟着男人走，而不是跟着婚姻走**：家庭（家户）以**男性户主**为锚，婚姻只是两性关系记录，不承载家庭账本；
>    - **分家**：男人**成年**或**失去父亲**时，即成立自己的新家庭，并从旧家庭按权重分走各类资源；
>    - **分家权重**：旧家庭中**父亲权重 = 2**，其他**子一代（含母亲腹中未出生的孩子）各权重 = 1**；刚成年/丧父的男子按自身权重（1）从旧家庭总权重（2 + n）中分得相应份额的每一类资源；
>    - **父亲死亡继承**：家庭全部资源**平分给在世的子一代（不包括妈妈）**；无在世子一代则**全部交入公仓**；
>    - **未出生的孩子也分配 ID**：受孕即分配 `AgentId`（胎儿先占号，出生时复用），使其能参与分家权重与继承分配。

---

## 一、现状诊断（为什么要重构）

### 1.1 当前实现的"魔法经济"问题

| 现状 | 位置 | 问题 |
| :--- | :--- | :--- |
| 房屋仓储为 5 对散落字段 `pantry_water/food/wood/stone/gold` + 各自 `max_*` | `house.rs:28-37` | 仓库"锁死"在建筑内，无归属主体、无流水 |
| 婚姻仅是 `Agent3D.spouse_id: Option<AgentId>` 单字段 | `agent.rs:122` | **婚姻无实体、无历史**：丧偶即抹除，改嫁不留痕；与房屋数据强耦合 |
| 家庭/宗族/地区无任何组织实体 | — | 团体三要素（领导、成员、账本）全部缺位，社会结构不可见 |
| 金币继承直接改字段 | `world.rs::settle_gold_inheritance` (430-457) | 继承是无流水的资产转移 |
| 全仓库搜索 `ledger/wallet/transaction/Transfer` | 0 结果 | 账本体系完全缺位 |

### 1.2 团体抽象对现有实体的收编

| 团体类型 | 现状载体 | 领导（现缺位） | 成员 | 账本（现缺位） |
| :--- | :--- | :--- | :--- | :--- |
| 🏠 家庭 Family | `spouse_id` + `home_house_id` 隐式 | 无 | 夫妻 + 未分家子女 | 无 |
| ⛩️ 宗族 Clan | 仅 `surname` 字符串 | 无 | 无 | 无 |
| 🏛️ 地区 Region | `PoiType::Camp`（无限储量 POI） | 无（行政区仅按房数升头衔） | 绑定房屋的居民 | 无 |

---

## 二、目标架构

### 2.1 模块布局：新旧完全分离

```
crates/sim_core/src/spatial/
├── ledger/            ← 【M1 已完成】独立经济与组织子系统（不 import 房屋仓储内部字段）
│   ├── mod.rs            LedgerKind / Ledger / transfer() 总线 ✅
│   ├── group.rs          ★ 团体基类 Group（领导 / 成员列表 / 账本）✅
│   ├── marriage.rs       Marriage 实体 + 婚姻登记簿 MarriageRegistry（仅两性关系 + 历史）✅
│   ├── family.rs         ★ 家户 Household（挂户主男性）+ 分家/继承规则 + HouseholdRegistry ✅
│   ├── clan.rs           宗族团体 + 族长顺位（M3）
│   ├── region.rs         地区团体 + 政体 + 换届（国王 / 长子继承制）（M4）
│   └── journal.rs        TransferRecord / TransferReason / 流水环形缓冲 ✅
├── house.rs           ← 不动（物理仓储继续按原逻辑运转）
├── agent.rs           ← 仅追加：arrival_tick / 家庭与婚姻只读接口
├── birth.rs           ← ★ 唯一例外：受孕时为胎儿预分配 AgentId（分家/继承需要）✅
├── ecology.rs         ← 不动
└── housing_system/    ← 不动（marriage.rs 成婚资格校验改为查询登记簿）
```

**分层语义（关键设计）**：
- **物理仓储层（旧，不动）**：房屋 `pantry_*` / 行囊 `carried_*` / POI `current_stock` 继续作为"货在哪"的物理事实；
- **制度账本层（新）**：团体的 `ledger` 记录"**归谁、谁付的、谁收的**"——对物理层变动做**旁路记账**，账本流水与物理库存不强制相等。

### 2.2 团体基类（Group）

```rust
// ledger/group.rs —— 家庭 / 宗族 / 地区 的统一基类

/// 团体三要素：领导、成员列表（含领导）、账本（仓库）
pub struct Group {
    pub kind: GroupKind,
    pub leader: Option<AgentId>,               // 领导
    pub members: BTreeSet<AgentId>,            // 成员列表（含领导，BTree 保确定性遍历）
    pub ledger: Ledger,                        // 账本（仓库）
}

pub enum GroupKind {
    Family(HouseholdId),  // ★ 家庭：领导者=男性户主（家庭跟着男人走）
    Clan(SurnameId),      // 宗族：领导者=族长（同姓最年长在世男性）
    Region(CampId),       // 地区：领导者=国王（首个到达营地的男人）★独有政体与换届
    // Corporate(CompanyId) —— 预留：商号/公司
}
```

**基类约定**：
- `leader` 必然同时出现在 `members` 中（成员列表包含领导）；
- 领导是账本的**管理者**（签名Transfer流水、签发互助/救济）；
- 所有成员增删、领导更替必须走 `Group::add_member / remove_member / set_leader` 单点入口，保证流水可审计（`Membership` / `Succession` 事件流水）。

### 2.3 核心数据模型

```rust
// ledger/mod.rs
pub enum ResourceKind { Water, Food, Wood, Stone, Gold }

pub struct Ledger {
    pub balances: BTreeMap<ResourceKind, f32>,
    pub journal: VecDeque<TransferRecord>,     // 环形流水，容量入 config
}

pub struct TransferRecord {
    pub tick: u64,
    pub from: LedgerRef,                       // 团体/个人引用
    pub to: LedgerRef,
    pub resource: ResourceKind,
    pub amount: f32,
    pub reason: TransferReason, // Deposit/Consume/Tax/Tribute/Relief/MutualAid/
                                // Heating/Inheritance/Dowry/Construction/
                                // Membership/Succession/...
}

// ledger/marriage.rs —— 婚姻登记系统（与房屋解耦；★ 不承载家庭账本，只记两性关系）
pub struct Marriage {
    pub id: MarriageId,
    pub husband_id: AgentId,
    pub wife_id: AgentId,
    pub start_tick: u64,
    pub end_tick: Option<u64>,
    pub end_reason: Option<MarriageEndReason>, // Bereaved / ...
}

pub struct MarriageRegistry {
    pub marriages: BTreeMap<MarriageId, Marriage>,
    pub by_agent: BTreeMap<AgentId, Vec<MarriageId>>,  // 一人终生多段婚姻
    pub next_id: MarriageId,                            // 确定性发号
}

// ledger/family.rs —— ★ 家户：家庭跟着【男人】走（v4 核心）
pub struct Household {
    pub id: HouseholdId,
    pub head: AgentId,                 // 户主（必然是男性）
    pub group: Group,                  // 家庭团体：leader=户主，成员=户主+妻子+未成年子女+胎儿
    pub parent_household: Option<HouseholdId>, // 分家来源（分家时按权重抽资）
    pub founded_tick: u64,
    pub is_dissolved: bool,            // 户主绝嗣/解散标记
}

pub struct HouseholdRegistry {
    pub households: BTreeMap<HouseholdId, Household>,
    pub by_agent: BTreeMap<AgentId, HouseholdId>,  // 每人当前所属家户
    pub next_id: HouseholdId,                       // 确定性发号
}

// ledger/region.rs —— 地区团体：政体与换届（v3 新增）
pub enum RegimeKind { Kingdom }                 // 目前仅国王制，预留扩展
pub enum SuccessionRule { Primogeniture }       // 长子继承制，预留扩展

pub struct Region {
    pub group: Group,                          // leader = 国王
    pub regime: RegimeKind,                    // 政体
    pub succession: SuccessionRule,            // 换届规则
    pub arrival_order: BTreeMap<(u64, AgentId), ()>, // 按到达营地时序索引（确定性）
}
```

**婚姻与房屋的解耦规则**：
- 结婚仍要求男方拥有 ≥1 级私宅（资格校验），但婚姻实体成立后**不引用、不跟随**房屋；房屋坍塌/搬迁不影响婚姻存续；
- 丧偶：婚姻封账（`end_reason = Bereaved`），流水只读归档；改嫁：封旧账 + 开新账，多段历史全留痕；
- 任何 agent 至多一段存续婚姻，由登记簿单点校验；旧 `Agent3D.spouse_id` 降级为缓存。

### 2.4 ★ 家族规则：家庭跟着男人走（v4 核心）

**① 家庭归属**：家庭（家户 `Household`）以**男性户主**为锚——户主在，家庭在；婚姻只是两性关系记录，**家庭的账本与成员全部挂在户主名下的家户实体上**：
- 已婚女性：随丈夫归入丈夫的家户；丈夫亡故改嫁 → 随新丈夫转入新家户（原家户成员移除）；
- 未成年子女（含母亲腹中胎儿）：归属**父亲的**家户；
- 户主死亡 → 家户按继承规则清算后解散（无在世子一代则资源全部交入公仓）。

**② 分家（成立新家庭）触发条件**——男人满足下列任一条件即自立门户：
1. **成年**：`age >= config.agent_adult_age`；
2. **失去父亲**：父亲死亡（此时无论是否成年均分家）。

**③ 分家资源分割（按权重抽资）**：
- 旧家户内权重：**父亲 = 2**，其余**子一代各 = 1**（**包含母亲腹中未出生的孩子**）；
- 总权重 $W = 2 + n$（$n$ = 父亲的子一代总数，含胎儿）；
- 分家男子（权重 1）从旧家户**每一类资源**中分得 $1/W$ 份额，转入其新建家户账本，记 `TransferReason::Split`（分家）流水；
- 分家后：该男子及其妻、子女（如有）从旧家户成员列表移除，加入新家户；新家户 `parent_household = 旧家户 ID`。

**④ 父亲死亡继承**：
- 家户全部资源**平分给在世的子一代**（`children_ids` 中 `is_alive` 者，**不包括妈妈/配偶**），各方等额，记 `Inheritance` 流水；
- **无在世子一代** → 家户全部资源**交入公仓**（`PublicStore(所属营地)`，M4 地区团体落地；M2 阶段先落"无主公仓兜底账本"，预留 `Region` 令牌）；
- 清算后家户 `is_dissolved = true`，成员按既有继承规则（父系继承、绝嗣废墟）由旧逻辑处理。

**⑤ 胎儿预分配 ID（配套改造）**：
- **受孕瞬间**即为胎儿分配 `AgentId`（占用 `world.next_agent_id` 发号位），写入母亲 `pregnancy_child_id`；出生时复用该 ID 构造实体，保证 ID 稳定可追溯；
- 目的：分家权重计算（含未出生孩子）与继承分配需要稳定的胎儿身份；
- 影响面：`birth.rs`（受孕/分娩）、`world.rs::next_agent_id 发号`、`ecology.rs` 播撒（不变）、确定性（发号顺序变更 → 需重跑 `test-wasm.js`，因 ID 序列变化，快照逐字节基准会变化，属预期内的一次性基线更新）。

**国王与换届规则（Region 专属）**：
1. **初王**：世界初始化/营地落成后，**第一个到达该营地的男人**即为国王（`arrival_tick` 最小者，并列按 id 取小，保证确定性）；
2. **夺位（决策树最高优先级）**：凡男人、当前不是国王、且存在无国王的营地，则立即放下一切事务冲往最近的无主营地抢夺王位（多个营地无国王时取最近者，距离并列按 id 取小）；详见 M4.4；
3. **长子继承制**：国王死亡时，王位传给其**在世最年长的直系男性后代**（长子优先，顺位 = 按 age 降序的男性子女；孙辈隔代承继：先查在世子女，无子女则查各亡故男性子女的后代中 age 最大者）；
4. **绝嗣换届**：国王无任何在世直系后代时，由**下一个最先到达营地**的男人接任（`arrival_order` 中取国王之后到达次序最早的在世男性）；
5. 每次换届/夺位产出 `Succession` 流水（旧王/无主 → 新王，reason = Succession），并向前端播报。

### 2.5 不变式（重构红线）

1. **新旧隔离**：不修改 `house.rs` 仓储字段、`agent.rs` 行囊字段、`ecology.rs` 装卸逻辑、`housing_system/` 物理结算逻辑；新系统只读观测 + 追加自己的实体。（**唯一例外**：`birth.rs` 受孕预分配 `AgentId`，为分家/继承必需，见 §2.4 ⑤）
2. **一切账本变动经 `Ledger::transfer()`**；团体成员/领导变动必须走 `Group` 单点入口并留 `Membership/Succession` 流水。
3. **确定性不破坏**：记账/换届钩子不消耗 `WorldRng`、不新增决策相位；作为 **tick 尾段独立追加**（运动之后），`tools/test-wasm.js` 同种子逐字节一致性必须继续通过；`arrival_order` / 族长 / 国王判定一律"排序并列取 id 小者"。
4. **快照三处同步**（根 AGENTS.md §4.5）：`snapshot.rs` → `world.rs::generate_snapshot()` → `rustworld.js::_applySnapshot()`。

---

## 三、分阶段里程碑

### ✅ M1 · 团体基类 + 婚姻登记 + 家户体系 + 前端UI（已完成，v1.0.0）
> 已交付：`Group` 基类、`MarriageRegistry`（两性关系记录）、`HouseholdRegistry`（家庭跟着男人走）、胎儿预分配 ID、家户初始化回填、超参联动、快照扩展、前端顶栏统计、Agent Inspector 家户/婚姻卡片、家户账本大盘面板。
>
> 验收：`cargo build` + `node tools/test-wasm.js` 全绿（确定性逐字节一致 / 0 越界 / 0 NaN）；`config-check.js` 153/153 通过；浏览器实测 0 控制台错误。

### M2 · 家庭账本旁路记账 + 分家与继承清算（废除隐形经济）→ **v1.1.0**
> 目标：家庭收支逐笔留痕，并按 §2.4 落实**分家抽资**与**父亲死亡继承**。

- [ ] **M2.1** `world.tick()` 尾段新增 `ledger::tick_bookkeeping()` 旁路登记：成员卸货 → `Personal → Family(户主家户)` 的 `Deposit`；家庭生活消耗/供暖 → `Consume/Heating`；成员死亡遗留 → `Inheritance`。
- [ ] **M2.2** 家庭成员进出：出生 → 加入**父亲**家户；成婚 → 女方转入夫家；改嫁 → 女方转出新夫家；配 `Membership` 事件流水。
- [ ] **M2.3** 工程/修缮走账：`ConstructingHouse` / `RepairingHouse` 开工记 `Family → Construction/Maintenance` 扣款流水（只记账不扣物理库存，物理消耗仍由旧逻辑结算）。
- [ ] **M2.4** ★ **分家抽资**（§2.4 ③）：男人成年/丧父时建新家户，按"父亲权重 2、子一代（含胎儿）各权重 1"从旧家户每一类资源中分走 $1/(2+n)$，记 `Split` 流水。
- [ ] **M2.5** ★ **父亲死亡继承**（§2.4 ④）：家户资源平分给在世子一代（不含配偶）；无在世子一代 → 全部交入公仓（M2 先落兜底公仓账本，M4 对接 `Region` 令牌）。
- [ ] **M2.6** 流水落快照三处同步：`marriage_journal` + `household_journal` + `agent_marriage_history`；前端小人 Inspector 展示"婚姻履历 + 所属家户 + 家庭账本流水"。
- [ ] **M2.7** 验收：test-wasm.js 全绿；前端可见多段婚姻时间线、家户成员与逐笔收支；临时单测覆盖"分家权重分割 / 丧父继承平分 / 绝嗣入公仓"三场景后删除（§4.10）。

### M3 · 宗族团体 + 族长制（按姓氏聚合）→ **v1.2.0**
> 目标：宗族作为 `GroupKind::Clan` 实例，族长 = 同姓最年长在世男性。

- [ ] **M3.1** `ledger/clan.rs`：按 `Agent3D.surname` 自动聚合（不要求同营地，姓氏即宗族）；每族一册 `Group { leader, members, ledger }`。
- [ ] **M3.2** **族长规则**：族长 = 族内年龄最大的在世男性；死亡按同规则顺位（age 降序、男性、在世，并列按 id 取小）；无在世男性 → 宗族无主、账本冻结（流水只读）。
- [ ] **M3.3** **族税**：存续家庭按 `config.clan_tribute_rate` 周期向族库缴纳（`Family → Clan` 的 `Tribute` 流水，记账不扣物理库存）。
- [ ] **M3.4** **族内互助**：族库充足且成员家庭触发救济/彩礼条件时，由族长签发 `Clan → Family` 的 `MutualAid` 流水（`clan_aid_cooldown` 冷却保确定性）。
- [ ] **M3.5** 快照与前端：宗族面板（姓氏、族长、成员户数、族库余额、近期流水）。
- [ ] **M3.6** 验收：test-wasm.js 全绿；临时单测验证族长顺位确定性后删除。

### M4 · 地区团体 + 国王政体 + 夺位与换届 → **v1.3.0**
> 目标：地区居民成为 `GroupKind::Region` 团体，落地"政体 + 换届"第一版（国王 / 长子继承制），并实现**决策树最高优先级的夺位远征**。

- [ ] **M4.1** `ledger/region.rs`：每营地一册地区团体 `Region { group, regime: Kingdom, succession: Primogeniture, arrival_order }`；成员 = 归属该营地（`home_camp_node` / 房屋 `camp_id`）的全部在世居民（含国王）。
- [ ] **M4.2** **到达时序登记**：`Agent3D` 追加 `arrival_tick`——始祖按 seed 播撒顺序登记（不加 RNG，沿用初始化确定性序），新生儿在出生 tick 登记；`arrival_order` 索引按 `(arrival_tick, agent_id)` 排序，保证并列确定性。
- [ ] **M4.3** **初王判定**：营地建册时，`arrival_order` 中最早到达的**在世男性**为国王（`Group::set_leader`，产出 `Succession` 流水）。
- [ ] **M4.4** **决策树最高优先级任务：夺位远征（SeizeThrone）**：
  - **触发条件（在 `decisions/evaluate.rs` 马斯洛评估中置于最高优先级，高于生存/社交/营建一切需求）**：`agent 性别 == Male` **且** `agent 不是任何地区的国王` **且** `存在至少一个无国王的在册地区`；
  - **目标选择**：多个营地无国王时，取**与自身当前位置最近**的无主营地（2D 距离并列按 `CampId` 取小，保证确定性）；
  - **行为状态**：新增 `PrimitiveActionState::SeizingThrone`——中断当前状态（采收/休整/施工均可被打断），复用既有寻路 `decisions/routing.rs` 平滑赶路，**严禁闪现瞬移**（与 §4.2 掉头重路由同规范）；
  - **登基结算**：抵达无主营地（进入 `poi_interaction_radius`）→ `Group::set_leader(agent)` 登基 + `arrival_tick` 登记入 `arrival_order` + 产出 `Succession` 流水（无主 → 新王）+ 前端播报；
  - **防抖与确定性**：夺位判定走各 agent 既有决策相位（`(tick_counter + agent.id) % 30`，§4.3），不新增节拍、不消耗 `WorldRng`；"无国王营地"集合在决策时即时计算，两个 agent 同相位争抢时按触发先后（tick 序 + agent id 序）落定，后者抵达时营地已有王则自动放弃转入普通需求；
  - **中途营地易主**：赶路途中目标营地出现新国王时，在下一次决策相位重新评估（可能改道最近的其他无主营地或放弃）。
- [ ] **M4.5** **长子继承制换届**：国王死亡 → 顺位查找：
  1. 在世最年长直系男性后代（子女按 age 降序；无子女则孙辈隔代承继：各亡故男性子女的后代中 age 最大者）；
  2. **绝嗣**（无任何在世直系后代）→ `arrival_order` 中**下一个最先到达营地**的在世男性接任；
  3. 全营地无在世男性 → 王位空悬、地区账本冻结（流水只读）。
- [ ] **M4.6** **公仓税与救济（地区账本职能）**：家庭按 `config.ledger_tax_rate` 周期向地区账本缴纳 `Tax`；家庭入不敷出且成员生理告警时由国王签发 `Relief`（`PublicStore` 语义由地区团体账本承载）。
- [ ] **M4.7** 快照与前端：营地 Inspector 升级为"地区面板"——国王名号、政体/换届规则标签、成员户数、地区账本收支汇总（税/救济/净流入）、换届历史流水；小人状态展示"夺取王位中（目标：XX 营地）"。
- [ ] **M4.8** 验收：test-wasm.js 全绿（确定性红线：换届/夺位判定不消耗 RNG）；临时单测覆盖"初王=最早到达男性 / 夺位最高优先级与最近无主营地选择 / 长子继承 / 绝嗣回落到先到者 / 无男空悬 / 争抢时先触发者登基"六场景后删除。
- [ ] **M4.9** Corporate 预留：`GroupKind` 注释位 + `TransferReason` 预留 `Wage/Dividend/Investment`，不实现逻辑。

### M5 · 收尾与文档（与各 M 并行滚动）→ **v1.4.0**
- [ ] 各阶段完成即：自增版本号（index.html 徽章 + AGENTS.md 两处，§4.9）；更新 `docs/current/04-*.md` / `05-*.md` / `06-*.md` 与 `docs/current/11-changelog.md`。
- [ ] 新目录补局部 `ledger/AGENTS.md`（重点：新旧分离、旁路记账、团体三要素、婚姻-房屋解耦、国王换届规则）并登记到根 AGENTS.md §0.1 表。
- [ ] 最终验收门禁：`node tools/config-check.js` + `node tools/test-wasm.js` 双绿。

---

## 四、排期建议（按周）

| 周 | 内容 | 交付物 | 版本 |
| :--- | :--- | :--- | :--- |
| ~~W1~~ | ~~M1.1–M1.4（Group 基类 + Marriage 实体 + 家户 Household）~~ | ✅ 团体/婚姻/家户数据模型上线 | ~~v0.9.72~~ |
| ~~W2~~ | ~~M1.5–M1.9（婚姻登记簿迁移 + 胎儿预分配 ID + 家户种子回填 + 前端UI）~~ | ✅ 婚姻登记系统 + 家户归属 + 前端展示 | ~~v1.0.0~~ |
| W3 | M2.1–M2.3（旁路记账 + 成员进出 + 工程走账） | 家庭流水全留痕 | v1.1.0-dev |
| W4 | M2.4–M2.5（分家权重抽资 + 丧父继承/绝嗣入公仓） | 家族资源流转闭环 | v1.1.0 |
| W5 | M2.6–M2.7 + M3.1–M3.2（家户/婚姻流水UI + 宗族聚合/族长） | 家户账本流水UI + 族长制 | v1.2.0-dev |
| W6 | M3.3–M3.6 + M4.1–M4.3（族税互助 + 地区团体/时序/初王） | 宗族闭环 + 国王登基 | v1.2.0 |
| W7 | M4.4–M4.9（夺位远征 + 长子继承换届 + 公仓税/救济 + 地区面板）+ M5 收尾 | 政体与夺位闭环 | v1.3.0 → v1.4.0 |

---

## 五、风险与踩坑联动清单

| 风险 | 联动的既有坑 | 对策 |
| :--- | :--- | :--- |
| 记账/换届钩子破坏确定性 | §4.3 共享 RNG / tick 顺序 | 钩子纯观测、不消耗 RNG；tick 尾段独立追加，既有环节顺序零改动；一切排序"并列取 id 小者" |
| ★ 胎儿预分配 ID 改变发号序列，快照基准漂移 | §4.10 / test-wasm.js 逐字节一致性 | 受孕即占号会插入 ID，属**预期内一次性基线更新**：改造后重跑 `test-wasm.js` 重建基准；禁止在同一次提交中并行改动其他发号逻辑 |
| ★ 分家/继承权重算错（含胎儿计数） | §2.4 ③ → 父亲权重 2，子一代（含胎儿）各 1 | 权重与份额计算集中在 `ledger/family.rs` 单一函数，临时单测覆盖"n=0/1/3 且含胎儿"三种分母；份额用**逐类资源独立计算**，避免浮点误差累积 |
| ★ 分家触发条件"（成年 或 失去父亲）"重复触发 | 成年判定每 tick 为真 | 家户归属以 `by_agent` 索引幂等判定：已拥有自己家户的男人不再重复分家；分家事件记 `Split` 流水后可审计去重 |
| 改嫁女性家户归属错乱 | `marriage.rs` 改嫁链路 | 改嫁 = 婚姻封旧开新 + 女方 `by_agent` 从旧夫家户移除并加入新夫家户，先移后加，保证任一时刻唯一归属 |
| 换届判定需要完整亲缘+到达信息 | `birth.rs` 亲缘字段齐全 | 复用 `mother_id/father_id/children_ids/age` 做顺位遍历；`arrival_tick` 一次性登记后只读 |
| 夺位最高优先级打断施工/修缮导致烂尾 | §4.11 施工/修缮只结算 agent 自主进入的状态 | `SeizingThrone` 中断时置 `house.is_repairing/construction_progress` 原状冻结（不回滚），agent 登基或夺位失败后可在下个决策相位恢复原需求；`ConstructingHouse` 中断者重新触发走既有自主决策链 |
| 夺位远征途中饿死/脱水 | §4.2 途中重路由与体力告警 | 夺位状态保留生理代谢；饥渴低于告警线时降级为次优先级，先就近求生、存活后再重新触发夺位（决策相位自动重评估） |
| 新旧双轨数字"对不上"引起困惑 | — | 明确定位：账本记权责流水（归谁），物理仓储记存量（在哪）；前端 UI 分别标注"账面"与"库存" |
| 婚姻解耦后与旧 `spouse_id` 失同步 | `marriage.rs` 三条链路 | 登记簿单点维护：婚姻事件先过 `MarriageRegistry`，由其回写 `spouse_id` 缓存 |
| 国王绝嗣遍历亲缘树成本/死循环 | — | 顺位遍历限定代数上限（config，如 5 代）+ 已访问集合防环；超限即视为绝嗣 |
| 改嫁/丧偶时家庭账本归属争议 | §4.11 自主决策原则 | 账本随婚姻封存，前段资产不向后段转移（除族长/国王签发的流水）；物理库存仍在原房屋 |
| 团体成员列表膨胀 | §4.5 快照三处同步 | 成员列表存 ID 集合不落快照全量，快照仅传团体摘要（领导/人数/余额/最近 N 条流水） |
| 调参入口失同步 | §4.12 超参集中化 | 新超参只走 `config.rs` 三处 + `config.js`，改完必跑 `config-check.js` |
| 测试污染仓库 | §4.10 持久化测试禁令 | 临时单测验证后删除，长期只依赖 `test-wasm.js` |
