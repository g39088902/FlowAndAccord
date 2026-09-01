# 12. 📒 账本与婚姻登记系统 (`ledger`)

> **模块索引**：[← 返回 CURRENT.md 全景索引](../CURRENT.md) · 主要源码：`crates/sim_core/src/spatial/ledger/`（5 子模块）
> **里程碑状态**：M1 已完整落地（v1.0.0），M2 为规划态。

---

## 模块定位

独立经济账本子系统，与房屋物理仓库（`house.rs` pantry_*）和 Agent 随身行囊（`agent.rs` carried_*）完全分离。账本只记录"归谁、谁付谁收"的权责关系，不干预物理资源的装卸与搬运。同时承载婚姻登记簿与家户体系，是社会经济结构的权责底座。

## 核心数据结构

### ResourceKind
资源品类枚举，与物理仓库一致：水 / 粮 / 木 / 石 / 金。

### Ledger（账本内核）
- **分品类存量**：按 `ResourceKind` 维护 5 个品类的账面余额。
- **双环形流水**：每本账本维护两个环形缓冲区（收入流 / 支出流），容量由 `ledger_journal_capacity`（默认 64）控制，超容量淘汰最旧流水，防长程运行内存膨胀。
- **transfer() 双向记账总线**：所有资源转移通过统一入口，自动在付款方与收款方分别记录支出/收入流水。

### TransferRecord / TransferReason
- `TransferRecord`：单次转账记录（品类、数量、对手方、原因、时间戳）。
- `TransferReason`：转账原因枚举，包含 `Split`（分家）等预留原因，为 M2 分家机制做准备。

### Group（团体基类）
- 三要素：`leader`（领导）+ `members`（成员列表，含领导，`BTreeSet` 保序）+ `ledger`（团体账本）。
- 成员/领导变动走 `add_member` / `remove_member` / `set_leader` 单点入口并留审计事件。
- 是家户（Household）与未来其他团体组织的基类。

### MarriageRegistry（婚姻登记簿）
- **终身多段婚姻全留痕**：一人一生所有婚姻段（初婚 / 丧偶 `Bereaved` 封账 / 改嫁开新账）全部保留，不删除历史。
- **存续唯一性**：同一人同时只能有一段存续婚姻，单点校验。
- **与房屋解耦**：婚姻记录不持有 `house_id`，婚姻状态与房产所有权独立。
- **确定性发号**：`next_id` 顺序发号，不消耗 `WorldRng`。
- `Agent3D.spouse_id` 降级为缓存字段，真实婚姻来源为登记簿。

### HouseholdRegistry（家户体系）
- **家庭跟着男人走**：家户以男性户主为锚定，`by_agent` 唯一归属索引确保一人同时只属于一个家户。
- **改嫁先移后加**：女性改嫁时，先从原夫家家户移除，再加入新夫家家户，避免短暂双重归属。
- 已婚女性随夫入家户；未成年子女随父入家户。
- 为 M2 分家预留 `parent_household` 血缘链字段。

### 胎儿预分配 ID
- 受孕瞬间（`agent.rs::tick_metabolism`）即为腹中胎儿占用 `AgentId`（`pregnancy_child_id`），分娩（`birth.rs`）时复用该 ID。
- 未出生孩子可计入 M2 分家权重与继承分配。
- 发号不消耗 `WorldRng`，确定性可复现。

## ledger 子模块（5 个）

| 文件 | 职责 |
| :--- | :--- |
| `mod.rs` | ledger 模块入口与重新导出 |
| `journal.rs` | 账本内核：ResourceKind / Ledger / TransferRecord / TransferReason / transfer() |
| `group.rs` | 团体基类：leader + members(BTreeSet) + ledger，成员变动单点入口 |
| `marriage.rs` | 婚姻登记簿：终身多段留痕、存续唯一性、确定性发号 |
| `family.rs` | 家户体系：家庭跟着男人走、户主锚定、改嫁先移后加 |

## 关键不变量
- 账本与物理仓库完全分离：改账本不影响 `house.rs` pantry_* / `agent.rs` carried_* / `ecology.rs` 装卸逻辑。
- 一人同时只属于一个家户（`by_agent` 唯一索引）。
- 一人同时只能有一段存续婚姻（存续唯一性校验）。
- 婚姻记录不持有 `house_id`，与房产所有权解耦。
- 胎儿在受孕时即预分配 AgentId，分娩复用，不消耗 RNG。
- 账本流水环形缓冲容量固定（默认 64），超容量淘汰最旧记录。

## 与其他模块接口

| 模块 | 接口 |
| :--- | :--- |
| `housing_system/marriage.rs` | 成婚 → 登记簿注册 + 女方转入夫家家户；丧偶 → 封账归档 |
| `agent.rs` | 受孕 → 预分配胎儿 AgentId；`spouse_id` 作为缓存从登记簿同步 |
| `birth.rs` | 分娩 → 复用预分配 ID，新生儿随父入家户 |
| `world.rs` | 世界重置 → 清空两登记簿；seed 阶段为每位始祖男性建户；`generate_snapshot()` 序列化家户/婚姻/账本余额 |
| `snapshot.rs` | `HouseholdSnapshot` / `MarriageSnapshot` / `LedgerBalanceSnapshot` 三类快照结构 |
| `rustworld.js` | 映射 `sim.households` / `sim.marriages`，提供 `getHouseholdOfAgent()` / `getActiveMarriageOf()` / `getAllMarriagesOf()` 查询辅助 |

## 快照字段

- **HouseholdSnapshot**：家户 ID、户主 ID、成员列表、账面 5 资源余额、最近团体事件。
- **MarriageSnapshot**：婚姻 ID、夫妻双方 ID、婚龄、存续/封账状态、历史婚姻段。
- **LedgerBalanceSnapshot**：团体账面对应的 5 资源余额。

## 前端展示

- **顶栏统计**：存续家户数 🏠 / 存续婚姻对数 💍。
- **Agent Inspector**：
  - 「🏠 家户归属」卡片：家户 ID/户主姓氏/成员数/角色徽章（👑户主·💍配偶·👶子女）/账面 5 资源/家户大事记。
  - 「💍 婚姻登记」卡片：存续中·丧偶离异·未婚三态、婚龄、历史婚姻段列表。
- **家户与账本大盘面板**：右侧可折叠面板，含概览统计行（存续/已解散家户、存续/累计婚姻）+ 家户列表（户主姓氏·成员数·账面资源·点击追踪户主视角）+ 婚姻登记簿列表（夫妻·婚龄·存续状态）。

## M2 规划（未实现）

> 以下为规划态，尚未落地，标注于此以备追溯。

- **分家（Split）**：男性继承人成年后可从父家户分出独立家户。分家权重：父权重 2 / 子一代各 1（父占双份，诸子平分剩余）。`TransferReason::Split` 已预留。
- **丧父继承**：户主离世后，房产与家户账本余额平分给在世子女（含未出生胎儿，按预分配 ID 计入）；绝嗣（无在世子女）则家户账本余额入公仓。
- **parent_household 血缘链**：`HouseholdRegistry` 已预留该字段，用于 M2 分家时追溯原家户与新家户的血缘关系。

## 调参入口

账本流水环形缓冲容量 `ledger_journal_capacity`（默认 64）见 [config-reference.md](../config-reference.md) 第 10 分区。
