# ledger · 独立经济账本子系统 (AGENTS.md)

> 本目录局部操作指南。全局规则以根目录 `AGENTS.md` 为准（§4.3 确定性节拍 / §4.10 测试禁令 / §4.12 超参集中化），本文件只收录本目录的职责边界、文件清单与局部易踩坑。
> 完整机制与里程碑见 `docs/PLAN_LEDGER_REFACTOR.md`（账本与仓库重构计划，M1~M4 已完成，M5 收尾规划中）。

---

## 1. 📂 目录职责

独立经济**账本层**（制度账本：记录"归谁、谁付的、谁收的"），与物理仓储层（`house.rs` pantry_* / `agent.rs` carried_* / `ecology.rs` 装卸）**完全分离**：
- 账本记权责流水，物理库存记存量，二者**不强制相等**（前端分别标注"账面"与"库存"）；
- **M1~M4 已完整落地**：
  - M1（v0.9.72~v1.0.0）：账本内核 + 团体基类 + 婚姻登记簿 + 家户体系（家庭跟着男人走）+ 胎儿 Agent 身份（v1.3.5 起受孕即建实体）；
  - M2（v1.1.0）：旁路记账 `bookkeeping.rs` + 分家抽资 + 丧父继承清算 + 公仓兜底账本；
  - M3（v1.2.0）：宗族 `clan.rs`（按姓氏聚合、族长顺位、族税、族内互助）；
  - M4（v1.3.0）：地区与王国 `region.rs`（按营地聚合、初王、夺位远征、长子继承、公仓税、救济）。

## 2. 📁 文件清单（7 个文件）

| 文件 | 职责 |
| :--- | :--- |
| `mod.rs` | 模块声明与 re-export（`Household` / `Marriage` / `Group` / `Ledger` / `ClanRegistry` / `Region` 等核心类型） |
| `journal.rs` | 账本内核：`ResourceKind` / `Ledger`（分品类存量 + 环形流水）/ `TransferRecord` / `TransferReason` / `transfer()` 双向记账总线 + `record_consumption` 单边消耗记账 |
| `group.rs` | 团体基类 `Group`（leader / members 含领导 / ledger）+ `add_member` / `remove_member` / `set_leader` 单点入口；`GroupKind` 含 `Family` / `Clan(String)` / `Region(u32)` |
| `marriage.rs` | 婚姻登记簿 `MarriageRegistry`（多段婚姻留痕、存续唯一性、确定性发号）——**只记两性关系，不承载账本** |
| `family.rs` | ★ 家户体系 `HouseholdRegistry`（以男性户主为锚、`by_agent` 唯一归属、`parent_household` 血缘链） |
| `clan.rs` | ★ M3 宗族系统 `ClanRegistry`（按姓氏聚合、族长顺位、族税 `Tribute`、族内互助 `MutualAid`） |
| `region.rs` | ★ M4 地区与王国系统 `RegionRegistry`（按营地聚合、初王顺位、长子继承、公仓税 `Tax`、救济 `Relief`；夺位远征调度在 `decisions/scheduler.rs`） |

## 3. ⚙️ 核心规则与不变式

- **家庭跟着男人走**：家庭账本与成员归属都在**男性户主**的 `Household` 下；婚姻只是关系记录；已婚女性随夫入家户，改嫁先移后加（`transfer_member`）。
- **婚姻与房屋解耦**：`Marriage` 不持有任何 house_id；`Agent3D.spouse_id` 是缓存，真实来源是 `MarriageRegistry`（成婚/丧偶/改嫁事件必须先过登记簿，见 `housing_system/marriage.rs` 钩子）。
- **胎儿 Agent 身份（M1.7 受孕即建实体）**：受孕瞬间由 `world.tick_fetus_reconcile` 为腹中胎儿创建完整 agent 实体（`is_fetus=true`），加入父母 `children_ids`、随父入家户——未出生孩子计入分家权重与**继承分配**（父亡清算不再误判"仅有胎儿"绝嗣入公仓）；胎儿无需求消耗/无地图实体/跳过决策，出生时 `resolve_newborns` 原位复用 ID 替换为新生儿。
- **流水环形缓冲**：容量由 `config.ledger_journal_capacity`（默认 64）控制，超容量淘汰最旧。
- **M2 分家权重**：父亲在世时 `W = 2(父) + n(子一代)`，分家男子抽走各类资源 `1/W`；**丧父分家时亡父不占权重，`W = n`**（子一代间平分）；`n = 父亲 children_ids.len()`（胎儿已在其中，v1.3.5 起不再单独 +1）；份额按**每类资源独立计算**，只记账本余额不动物理库存。
- **M2 继承**：户主死亡 → 家户资源平分在世子一代（不含配偶）；绝嗣 → 全部转入 `public_granary` 公仓兜底账本；清算后 `dissolve`。
- **M3 宗族**：按 `surname` 自动聚合（始祖播撒即入族、新生儿随父姓入族）；族长 = 同姓在世最年长男性（并列 id 小者），无在世男性则无主账本冻结；族税每 `clan_tribute_interval_ticks` 全局统一征收（账面余额 × `clan_tribute_rate`），族内互助有族库门槛与冷却。
- **M4 地区**：每营地一册 `Region`（政体 `Kingdom`、继承制 `Primogeniture`）；初王 = `arrival_order` 最早到达在世男性；国王死亡按 长子→长孙→arrival_order 下一男性 继承，绝嗣王位空悬账本冻结；公仓税每 `ledger_tax_interval_ticks` 征收（账面余额 × `ledger_tax_rate`，有国王才征），救济有公仓门槛与冷却。

## 4. ⚠️ 本目录局部易踩坑

### 4.1 新旧分离红线

本目录**不得** import `house.rs` 仓储字段或读取 `carried_*`/`pantry_*` 物理库存来改变账本；对物理事件的记账采用"旁路观测"（`bookkeeping.rs`），只读 + 只追加流水。

### 4.2 确定性红线

一切集合用 `BTreeMap/BTreeSet` 保序；`next_id` 顺序发号不回退；钩子不消耗 `WorldRng`、不新增决策相位、不重排 `world.tick()` 内部顺序；排序并列取 id 小者。M3 族税 / M4 公仓税均为**全局统一时点**征收（tick 对齐 `% interval == 0`），保证确定性。

### 4.3 唯一归属

`by_agent` 保证每人任一时刻至多属于一个家户/宗族/地区；`remove_member` 拒绝移除领导（户主亡故走 `dissolve` 清算；族长/国王自然更替走 `set_leader` 顺位继承）。

### 4.4 分家/继承

分家权重分母 `2 + n` 中 `n = 父亲 children_ids.len()`（胎儿已作为 agent 实体计入，v1.3.5 起不再单独 +1），且**仅在父亲在世时计入父亲的权重 2**（丧父分家 `W = n`）；分家/继承只记账本余额，不动物理库存；`Inheritance` 先于 `Split` 执行（丧父之子由继承直接立户，Split 幂等跳过已立户者）。

### 4.5 公仓兜底与冻结语义

`public_granary` 为无管理者的兜底账本（绝嗣资产归集，预留 M4 Region 对接）；宗族/地区无主（leader=None）时**账本冻结**——不主动支出，但可接收 `Tribute`/`Tax` 流入。

### 4.6 测试禁令

本目录不得持久化 `#[cfg(test)]`；临时单测验证后删除，长期验证只依赖 `node tools/test-wasm.js`（根 AGENTS.md §4.10）。
