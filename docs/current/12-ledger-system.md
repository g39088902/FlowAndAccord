# 12. 📒 账本与社会经济制度系统 (`ledger` + `bookkeeping`)

> **模块索引**：[← 返回 CURRENT.md 全景索引](../CURRENT.md) · 主要源码：`crates/sim_core/src/spatial/ledger/`（7 子模块）+ `crates/sim_core/src/spatial/bookkeeping.rs`
> **里程碑状态**：M1~M4 已完整落地（M1 v1.0.0 / M2 v1.1.0 / M3 v1.2.0 / M4 v1.3.0），前端配套 4 标签页「社会与经济制度大盘」(`ledger-ui.js`)。

> ⚡ **M6（v1.4.0）语义升级：家户账本从「权责镜像」成为「家庭物资唯一真相源」**。房屋仓库已删除，卸货（Deposit）/在家吃喝（Consume）/冬季烧柴（Heating）在生态与维护层**真实收付**家户账本，`bookkeeping.rs` 仅保留继承清算（Inheritance）与分家抽资（Split）；决策层改读账本余额；账本无容量上限。
>
> ⚡ **M7（v1.5.0）追加**：去采货触发改由**家庭库存施密特触发器**驱动（余额 <100 触发、≥200 停，五类统一，有房即可采）；升级就绪改按一次性材料成本（`needs::upgrade_material_cost`）。
>
> ⚡ **M8（v1.6.0）追加**：升级材料成本改**4×5 固定矩阵**（20 超参，`config.house-upgrade-cost.js` 权威值，Rust `config.rs` 平铺三处同步）；升 1 级水粮各 50、2 级木粮水各 75、3 级石木粮水各 100、4 级金石木粮水各 125，升级时从家户账本**一次性扣账**（Construction 流水）。本文件以下 M2~M4 记账机制描述中涉及「旁路观测/与物理仓库分离/等级备货目标/容量上限」的表述已过时，请以代码注释与 11-changelog v1.6.0 条目为准。

---

## 模块定位

独立经济账本子系统，与房屋物理仓库（`house.rs` pantry_*）和 Agent 随身行囊（`agent.rs` carried_*）完全分离。账本只记录"归谁、谁付谁收"的权责关系，不干预物理资源的装卸与搬运。同时承载婚姻登记簿、家户体系、宗族体系与地区王国政体，是社会经济结构的权责底座。

## 核心数据结构

### ResourceKind
资源品类枚举，与物理仓库一致：水 / 粮 / 木 / 石 / 金。

### Ledger（账本内核）
- **分品类存量**：按 `ResourceKind` 维护 5 个品类的账面余额。
- **环形流水**：每本账本维护一个环形缓冲区（`journal`），容量由 `ledger_journal_capacity`（默认 64）控制，超容量淘汰最旧流水，防长程运行内存膨胀。
- **transfer() 双向记账总线**：所有资源转移通过统一入口，自动在付款方与收款方分别记录流水。
- **record_consumption()**：单边消耗记账（debit + `to: Void` 流水），用于 `Consume`（生活吃喝）、`Heating`（冬季烧柴）等资源灭失场景。

### TransferRecord / TransferReason
- `TransferRecord`：单次转账记录（品类、数量、对手方、原因、时间戳）。
- `TransferReason`：转账原因枚举，已落地 `Deposit` / `Consume` / `Heating` / `Construction` / `Maintenance` / `Inheritance` / `Split` / `Tax` / `Tribute` / `MutualAid` / `Relief` / `Membership` 等。

### LedgerRef（账本主体引用）
五级产权账本实例化：`Personal`（个人行囊）/ `Family`（家户）/ `Clan(String)`（宗族）/ `Region(u32)`（地区公仓）/ `PublicGranary`（公仓兜底）+ `Void`（消耗灭失）。

### Group（团体基类）
- 三要素：`leader`（领导）+ `members`（成员列表，含领导，`BTreeSet` 保序）+ `ledger`（团体账本）。
- 成员/领导变动走 `add_member` / `remove_member` / `set_leader` 单点入口并留审计事件。
- `GroupKind`：`Family(HouseholdId)` / `Clan(String)` / `Region(u32)`。
- 是家户（Household）、宗族（Clan）、地区（Region）三种团体的共同基类。

### MarriageRegistry（婚姻登记簿）
- **终身多段婚姻全留痕**：一人一生所有婚姻段（初婚 / 丧偶 `Bereaved` 封账 / 改嫁开新账）全部保留，不删除历史。
- **存续唯一性**：同一人同时只能有一段存续婚姻，单点校验。
- **与房屋解耦**：婚姻记录不持有 `house_id`，婚姻状态与房产所有权独立。
- **确定性发号**：`next_id` 顺序发号，不消耗 `WorldRng`。
- `Agent3D.spouse_id` 降级为缓存字段，真实婚姻来源为登记簿。

### HouseholdRegistry（家户体系）
- **家庭跟着男人走**：家户以男性户主为锚定，`by_agent` 唯一归属索引确保一人同时只属于一个家户。
- **改嫁先移后加**：女性改嫁时，先从原夫家家户移除，再加入新夫家家户，避免短暂双重归属。
- 已婚女性随夫入家户；未成年子女随父入家户；新生儿出生即入父亲家户。
- `parent_household` 血缘链字段用于追溯分家/继承的血缘关系。

### ClanRegistry（宗族体系 M3）
- **按姓氏聚合**：同姓 agent 自动归入同一宗族（不要求同营地）；始祖播撒即入族，新生儿随父姓入族。
- **★ v1.9.1 宗族与女性无关（Task10/11）**：宗族 = 纯父系男性团体——女性一律不入族（`add_member` 对女性直接拒绝）；始祖仅男性入族，新生儿随父姓入族仅限男性子嗣。
- **族长顺位**：族长 = 同姓在世最年长男性，并列按 id 取小；无在世男性则宗族无主（`leader=None`），账本冻结（不主动支出，可接收 Tribute）。
- **★ v1.9.0 绝嗣（Task11）**：宗族无在世男性（`mark_clan_extinct`）→ 标记 `extinct`，族产平分给其他存续宗族（无存续宗族则入 `public_granary` 兜底，`TransferReason::Legacy` 流水事由）；前端宗族页红色「⛩️ 绝嗣 · 无在世男性」标签（v1.9.1 起宗族仅含男性、不统计在世女性）。
- **族税 Tribute**：每 `clan_tribute_interval_ticks`(1800=60s) 全局统一征收，存续家户按账面余额 × `clan_tribute_rate`(5%) 向族库缴纳（只记账不扣物理库存）。
- **族内互助 MutualAid**：族库总余额 > `clan_mutual_aid_min_balance`(50) 时，对水+粮 < `clan_mutual_aid_family_threshold`(10) 的极贫家户拨付 `min(族库×20%, 缺口×2)`，每家户每 `clan_mutual_aid_cooldown_ticks`(900=30s) 最多一次，族长签字。

### RegionRegistry（地区与王国体系 M4）
- **按营地聚合**：每营地（camp_id 1-5）一册 Region 团体，政体=`Kingdom`，继承制=`Primogeniture`；始祖播撒时加入最近营地，新生儿随父加入父亲所在地区。
- **到达时序**：`arrival_tick`（始祖=0，新生儿=出生 tick），`arrival_order` 按 `(arrival_tick, agent_id)` 升序。
- **初王顺位**：初王 = arrival_order 最早到达的在世男性；无在世男性则王位空悬，账本冻结。
- **★ v1.12.0 历史国王（含在位时长与死因）**：`Region.history_kings` 为 `Vec<HistoryKing>{agent_id, reign_start_tick, reign_end_tick, death_cause}`，`Region.current_reign_start` 追踪现任国王登基 tick；`set_king(agent, tick, note, prev_death_cause)` 在更替时将前任国王入档（死因从 `agent.death_cause` 读取，被废黜则为 None）；营地详情模态框展示历史国王列表及在位时长/死因。
- **夺位远征（v1.9.0 起决策引擎驱动，见 [06-motivation-ai.md](./06-motivation-ai.md)）**：决策分支 `B14SeekThrone`（生理层最高档）自主触发——在世成年男性非国王且存在空缺王位营地（有房者仅夺自家房屋所在营地、无房/废墟可夺任意）时，选定最近可夺位营地写入 `agent.expedition_target_camp` 并冲向目标（走现有寻路+运动系统坐标连续不闪现，施工进度冻结不回滚）；抵达且王位仍空缺写 `coronation_pending`，由世界 `execute_pending_coronations` 校验后 `set_king` 登基。
- **长子继承制**：国王死亡 → 在世最年长儿子 → 孙子 → arrival_order 下一男性 → 绝嗣空悬账本冻结（胎儿不计入继承）。
- **公仓税 Tax**：每 `ledger_tax_interval_ticks`(2400=80s) 全局统一征收，存续家户按账面余额 × `ledger_tax_rate`(3%) 向地区公仓缴纳（只记账不扣物理库存，有国王地区才征收）。
- **救济 Relief**：公仓总余额 > `ledger_relief_min_balance`(30) 时，对水+粮 < `ledger_relief_family_threshold`(8) 的极贫家户拨付 `min(公仓×15%, 缺口×2)`，每家户每 `ledger_relief_cooldown_ticks`(1200=40s) 最多一次，国王签字。

### 胎儿 Agent 身份（M1.7 受孕即建实体）
- **受孕瞬间（`agent.rs::tick_metabolism`）即为腹中胎儿创建完整 Agent 实体**（`is_fetus=true`），而非仅预分配 ID：胎儿加入父母 `children_ids`、随父入父亲家户（`world.rs::tick_fetus_reconcile` 每 tick 对账）。
- 未出生孩子计入 M2 分家权重（`W=2+n` 的 n）与**继承分配**（父亡清算不再把"仅有胎儿"误判绝嗣入公仓，而是为胎儿立户并转其份额）。
- 胎儿**无需求消耗**（跳过代谢/年龄/死亡判定）、**无地图实体**（跳过运动/POI/渲染/点击拾取）、**跳过行动决策**；性别占位 Female，不被分家/婚姻/房产/王位继承当作男性处理。
- 分娩（`birth.rs::resolve_newborns`）**原位复用胎儿 ID** 替换为新生儿（随身黄金随行转移）；流产/母亡时 `tick_fetus_reconcile` 移除胎儿实体并清理 `children_ids`/家户成员。
- 发号不消耗 `WorldRng`，确定性可复现。

## 源码分布（ledger 7 子模块 + bookkeeping）

| 文件 | 职责 |
| :--- | :--- |
| `ledger/mod.rs` | ledger 模块入口与重新导出 |
| `ledger/journal.rs` | 账本内核：ResourceKind / Ledger / TransferRecord / TransferReason / LedgerRef / transfer() / record_consumption() |
| `ledger/group.rs` | 团体基类：leader + members(BTreeSet) + ledger + GroupKind |
| `ledger/marriage.rs` | 婚姻登记簿：终身多段留痕、存续唯一性、确定性发号 |
| `ledger/family.rs` | 家户体系：家庭跟着男人走、户主锚定、改嫁先移后加、分家/继承血缘链 |
| `ledger/clan.rs` | ★ M3 宗族：ClanRegistry、族长顺位、族税 Tribute、族内互助 MutualAid |
| `ledger/region.rs` | ★ M4 地区与王国：RegionRegistry、初王顺位、长子继承、公仓税 Tax、救济 Relief |
| `bookkeeping.rs` | ★ M2 旁路记账：`tick_bookkeeping`（Deposit/Consume/Heating 观测 → Inheritance 继承清算 → Split 分家抽资），`transfer_household_resource` 家户间转移辅助 |

## 世界 tick 挂载点

`world.tick()` 在**错峰决策之后**依次追加（勿打乱）：
1. `tick_bookkeeping(dt)` — M2 旁路记账（Deposit/Consume/Heating + Inheritance + Split）；
2. `tick_clan(dt)` — M3 宗族（族长顺位 → 族税 → 族内互助）；
3. `tick_region(dt)` — M4 地区与王国（arrival_order 重排 → 初王/国王更替 → 国王死亡继承 → 公仓税 → 救济）。

## 关键不变量
- 账本与物理仓库完全分离：改账本不影响 `house.rs` pantry_* / `agent.rs` carried_* / `ecology.rs` 装卸逻辑。
- 一人同时只属于一个家户（`by_agent` 唯一索引）。
- 一人同时只能有一段存续婚姻（存续唯一性校验）。
- 婚姻记录不持有 `house_id`，与房产所有权解耦。
- 胎儿在受孕时即建 agent 实体（`is_fetus=true`），分娩原位替换复用 ID，不消耗 RNG。
- 账本流水环形缓冲容量固定（默认 64），超容量淘汰最旧记录。
- 宗族/地区无主时账本冻结（只进不出）；族税/公仓税全局统一时点征收，保证确定性。
- 分家/继承只记账本余额，不动物理库存；`Inheritance` 先于 `Split` 执行（Split 幂等跳过已立户者）。
- 分家权重：父亲在世时 `W = 2 + n`（n 含胎儿）；**丧父分家时亡父不占权重，`W = n`**（子一代间平分）。

## 与其他模块接口

| 模块 | 接口 |
| :--- | :--- |
| `housing_system/marriage.rs` | 成婚 → 登记簿注册 + 女方转入夫家家户；丧偶 → 封账归档 |
| `housing_system/construction.rs` | ★ M2 升级竣工 → 按升级前等级从户主家户账本 `record_consumption` 扣建材（Construction 流水） |
| `housing_system/maintenance.rs` | ★ M2 修缮完工 → 家户团体事件记录（纯审计） |
| `agent.rs` | 受孕 → 预分配胎儿 ID 并标记 `is_fetus` 身份；`spouse_id` 作为缓存从登记簿同步；`arrival_tick` 记录到达时刻 |
| `world.rs` | `tick_fetus_reconcile` 受孕即建胎儿实体 / 流产移除 / 位置随母；`generate_snapshot()` 序列化家户/婚姻/宗族/地区/公仓余额 |
| `birth.rs` | 分娩 → 原位复用胎儿 ID 替换为新生儿；新生儿入父亲家户（M2）/随父姓入宗族（M3）/入父亲地区（M4） |
| `decisions/scheduler.rs` | ★ M4 登基物理执行器 `execute_pending_coronations`（扫描 `coronation_pending` 校验王位仍空缺后 `coronate_king`）；`decisions/evaluate.rs` 决策器选定远征目标写入 `agent.expedition_target_camp` |
| `ecology.rs` | 始祖播撒 → 入宗族（M3）+ 入最近营地地区（M4）+ `arrival_tick=0` |
| `world.rs` | 世界重置 → 清空各登记簿/缓存；`generate_snapshot()` 序列化家户/婚姻/宗族/地区/公仓余额 |
| `snapshot.rs` | `HouseholdSnapshot` / `MarriageSnapshot` / `ClanSnapshot` / `RegionSnapshot` / `TransferRecordSnapshot` / `LedgerBalanceSnapshot` 快照结构 |
| `rustworld.js` | 映射 `sim.households` / `sim.marriages` / `sim.clans` / `sim.regions` / `sim.publicGranaryBalances` |
| `ledger-ui.js` | ★ 4 标签页「社会与经济制度大盘」：家户 / 婚姻 / 宗族 / 王国 |

## 快照字段

- **HouseholdSnapshot**：家户 ID、户主 ID、成员列表、账面 5 资源余额、最近团体事件、最近 8 笔资源流水（`recent_journal`）。
- **MarriageSnapshot**：婚姻 ID、夫妻双方 ID、婚龄、存续/封账状态、历史婚姻段。
- **ClanSnapshot**（M3）：姓氏、族长 ID、族人数量与列表、族库 5 资源余额、最近流水与事件；v1.9.0 新增 `is_extinct`（绝嗣标记；v1.9.1 起宗族仅含男性成员）。
- **RegionSnapshot**（M4）：营地 ID/名称、国王 ID、政体/继承制、成员数、到达时序前 10、顺位前 3 继承人、公仓 5 资源余额、最近流水与事件、夺位远征中族人列表；v1.9.0 新增 `history_kings`（历史国王档案）/ `member_ids`（成员列表）/ `governed_households`（管辖家户）；v1.12.0 `history_kings` 改为 `Vec<HistoryKingSnapshot>`（含在位起止 tick 与死因），新增 `current_reign_start`（现任国王登基 tick）。
- **AgentSnapshot 新增**（M2/M4）：`marriage_history_count` / `household_id` / `household_role`（Head/Spouse/Child/None）/ `arrival_tick` / `is_on_expedition`；v1.9.0 新增 `expedition_target_camp`（远征目标营地）/ `coronation_pending`（待登基营地）。
- **LedgerBalanceSnapshot**：团体账面对应的 5 资源余额；`public_granary_balances` 为公仓兜底账本余额。

## 前端展示

- **顶栏统计**：存续家户数 🏠 / 存续婚姻对数 💍。
- **4 标签页「社会与经济制度大盘」（`ledger-ui.js`）**：
  - 🏠 **家户页**：分家公式气泡（W=2+n）、流水穿透抽屉、继承清算档案、公仓余额；
  - 💍 **婚姻页**：存续婚姻、终身多段历史留痕；
  - 🛡️ **宗族页**：宗族看板、族长顺位、族库仪表、族税进度、互助救济气泡；v1.9.0 绝嗣宗族红色卡片（`⛩️ 绝嗣 · 无在世男性`）；
  - 👑 **王国页**：5 大营地王国、国王尊号、长子顺位链、到达时序、公仓赋税。
- **Canvas 夺位特效**：金色战盔标牌 + 虚线光束 + 登基礼花粒子。
- **Agent Inspector**：
  - 「🏠 家户归属」卡片：家户 ID/户主姓氏/成员数/角色徽章（👑户主·💍配偶·👶子女）/账面 5 资源/家户大事记/最近流水；
  - 「💍 婚姻登记」卡片：存续中·丧偶离异·未婚三态、婚龄、历史婚姻段列表；
  - 「⛩️ 宗族」与「👑 王国」归属展示。

## 调参入口

账本与婚姻登记子系统（`ledger_journal_capacity`）、宗族系统 M3（`clan_tribute_*` / `clan_mutual_aid_*`）、地区与王国系统 M4（`ledger_tax_*` / `ledger_relief_*`）见 [config-reference.md](../config-reference.md) 第 10/11/12 分区。
