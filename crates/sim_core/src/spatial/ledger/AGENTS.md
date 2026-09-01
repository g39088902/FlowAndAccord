# ledger · 独立经济账本子系统 (AGENTS.md)

> 本文件是 `crates/sim_core/src/spatial/ledger/` 目录的局部操作指南，供智能体/开发者改此目录代码前阅读。
> 全局规则以根目录 `AGENTS.md` 为准（§4.3 确定性节拍 / §4.10 测试禁令 / §4.12 超参集中化），本文件只收录本目录的职责边界与局部易踩坑。
> 完整机制与里程碑见 [`docs/PLAN_LEDGER_REFACTOR.md`](../../../../docs/PLAN_LEDGER_REFACTOR.md)（账本与仓库重构计划，当前进度 M1）。

---

## 1. 📂 目录职责

独立经济**账本层**（制度账本：记录"归谁、谁付的、谁收的"），与物理仓储层（`house.rs` pantry_* / `agent.rs` carried_* / `ecology.rs` 装卸）**完全分离**：
- 账本记权责流水，物理库存记存量，二者**不强制相等**（前端分别标注"账面"与"库存"）；
- M1 已落地：账本内核 + 团体基类 + 婚姻登记簿 + 家户体系（家庭跟着男人走）；
- M2-M4 预留：分家抽资（父权重2/子一代各1含胎儿）、丧父继承（平分在世子女/绝嗣入公仓）、旁路记账、宗族/族长、地区团体/国王/夺位。

## 2. 📁 文件清单（4 个单一职责子模块）

| 文件 | 职责 |
| :--- | :--- |
| `mod.rs` | 模块声明与 re-export（`Household` / `Marriage` / `Group` / `Ledger` 等核心类型） |
| `journal.rs` | 账本内核：`ResourceKind` / `Ledger`（分品类存量 + 双环形流水）/ `TransferRecord` / `TransferReason` / `transfer()` 双向记账总线 |
| `group.rs` | 团体基类 `Group`（leader / members 含领导 / ledger）+ `add_member / remove_member / set_leader` 单点入口 |
| `marriage.rs` | 婚姻登记簿 `MarriageRegistry`（多段婚姻留痕、存续唯一性、确定性发号）——**只记两性关系，不承载账本** |
| `family.rs` | ★ 家户体系 `HouseholdRegistry`（以男性户主为锚、`by_agent` 唯一归属、`parent_household` 血缘链） |

## 3. ⚙️ 核心规则与不变式

- **家庭跟着男人走**：家庭账本与成员归属都在**男性户主**的 `Household` 下；婚姻只是关系记录；已婚女性随夫入家户，改嫁先移后加（`transfer_member`）。
- **婚姻与房屋解耦**：`Marriage` 不持有任何 house_id；`Agent3D.spouse_id` 是缓存，真实来源是 `MarriageRegistry`（成婚/丧偶/改嫁事件必须先过登记簿，见 `housing_system/marriage.rs` 钩子）。
- **胎儿预分配 ID**：受孕瞬间由 `world.next_agent_id` 占号写入 `pregnancy_child_id`，出生复用——未出生孩子计入分家权重与继承。
- **流水环形缓冲**：容量由 `config.ledger_journal_capacity`（默认 64）控制，超容量淘汰最旧。

## 4. ⚠️ 本目录易踩坑

- **新旧分离红线**：本目录**不得** import `house.rs` 仓储字段或读取 `carried_*`/`pantry_*` 物理库存来改变账本；对物理事件的记账采用"旁路观测"（M2），只读 + 只追加流水。
- **确定性红线**：一切集合用 `BTreeMap/BTreeSet` 保序；`next_id` 顺序发号不回退；钩子不消耗 `WorldRng`、不新增决策相位、不重排 `world.tick()` 内部顺序；排序并列取 id 小者。
- **唯一归属**：`by_agent` 保证每人任一时刻至多属于一个家户；家户 `remove_member` 拒绝移除户主（户主亡故走 `dissolve` 清算）。
- **分家/继承（M2）**：权重分母 = 2(父) + n(子一代，含 `pregnancy_child_id` 胎儿)；份额按**每类资源独立计算**；分家/继承只记账本余额，不动物理库存。
- **测试禁令（§4.10）**：本目录不得持久化 `#[cfg(test)]`；临时单测验证后删除，长期验证只依赖 `node tools/test-wasm.js`。
