# 账本与仓库重构 · 开发计划 (Ledger Refactor Plan)

> ⚠️ 本文档为**账本重构计划**：M1~M4 已全部落地（v1.3.0），M5 为收尾/验收。当前已实现的账本代码结构见 [`crates/sim_core/src/spatial/ledger/AGENTS.md`](../../crates/sim_core/src/spatial/ledger/AGENTS.md) 与 [`docs/current/12-ledger-system.md`](./current/12-ledger-system.md)。
>
> **依据**：[docs/PLAN.md](./PLAN.md) §3.4「多级产权账本经济」
> **版本**：v1.3.2 · **当前进度**：M1 ✅（v1.0.0）/ M2 ✅（v1.1.0）/ M3 ✅（v1.2.0）/ M4 ✅（v1.3.0）/ M5 收尾 ✅

---

## 1. 核心理念

**账本即权力，资产负债表即社会结构快照。** 资产归属于有管理者的账本主体，任何资源流动都是主体间的显式 Transfer（可审计、可追溯）。

**新旧完全分离**：新账本体系与现有房屋/仓库/行囊物理逻辑完全分离——物理仓储层（`house.rs` pantry_* / `agent.rs` carried_* / `ecology.rs` 装卸）继续作为"货在哪"的物理事实；制度账本层记录"归谁、谁付的、谁收的"，对物理事件做**旁路记账**，账本流水与物理库存不强制相等。

---

## 2. ✅ M1 · 团体基类 + 婚姻登记 + 家户体系（已完成，v1.0.0）

| 交付项 | 状态 | 说明 |
| :--- | :--- | :--- |
| 账本内核 `Ledger` + `transfer()` 双向记账总线 | ✅ | `journal.rs`：分品类存量 + 环形流水 + `TransferRecord`/`TransferReason` |
| 团体基类 `Group` | ✅ | `group.rs`：leader / members（含领导）/ ledger 三要素 + 单点入口 |
| 婚姻登记簿 `MarriageRegistry` | ✅ | `marriage.rs`：多段婚姻留痕、存续唯一性、确定性发号；**只记两性关系，不承载账本** |
| 家户体系 `HouseholdRegistry` | ✅ | `family.rs`：以男性户主为锚（家庭跟着男人走）、`by_agent` 唯一归属、`parent_household` 血缘链 |
| 胎儿 Agent 身份 | ✅ | 受孕即建实体（`is_fetus=true`）、随父入家户、计入分家权重与继承，出生原位复用 ID 替换为新生儿（v1.3.5） |
| 快照扩展 + 前端 UI | ✅ | 顶栏统计、Agent Inspector 家户/婚姻卡片、家户账本大盘面板 |

---

## 3. ✅ M2 · 家庭账本旁路记账 + 分家与继承清算（已完成，v1.1.0）

**目标达成**：废除"魔法经济"，家庭收支逐笔留痕，落实分家抽资与父亲死亡继承。

### 3.1 旁路记账（不动物理库存）

`world.tick()` 尾段新增 `bookkeeping.rs::tick_bookkeeping()`，只读观测物理事件并追加账本流水：

| 物理事件 | 账本流水 | 方向 |
| :--- | :--- | :--- |
| 成员回家卸货 | `Deposit` | Personal → Family（户主家户） |
| 家庭生活消耗 | `Consume` | Family → Void（`record_consumption` 单边记账） |
| 冬季供暖烧柴 | `Heating` | Family → Void |
| 工程/修缮开工 | `Construction` / `Maintenance` | Family →（扣款，只记账不扣物理库存） |
| 成员死亡遗留 | `Inheritance` | 按继承规则分配 |
| 成年/丧父分家 | `Split` | 按权重抽资立新户 |

### 3.2 ★ 分家抽资（核心规则）

**触发条件**：男人满足下列任一即自立门户：
1. **成年**：`age >= config.agent_adult_age`；
2. **失去父亲**：父亲死亡（无论是否成年）。

**资源分割（按权重抽资）**：
- 旧家户内权重：**父亲 = 2**，其余**子一代各 = 1**（含母亲腹中未出生胎儿——v1.3.5 起胎儿已是 agent 实体并加入父亲 `children_ids`，`n = children_ids.len()` 天然包含）；
- 总权重 $W = 2 + n$（$n$ = 父亲的子一代总数，含胎儿）——**仅当父亲在世时计入父亲的权重 2**；
- **丧父分家**（触发条件 2）：亡父不占权重，$W = n$，家户资源在子一代间平分（与继承清算语义一致）；
- 分家男子（权重 1）从旧家户**每一类资源**中分得 $1/W$ 份额，转入新建家户账本，记 `TransferReason::Split`；
- 分家后：该男子及其妻、子女从旧家户移除，加入新家户；新家户 `parent_household = 旧家户 ID`。

**幂等保障**：以 `by_agent` 索引判定——已拥有自己家户的男人不再重复分家。

### 3.3 ★ 父亲死亡继承（核心规则）

- 家户全部资源**平分给在世的子一代**（`children_ids` 中 `is_alive` 者，**不包括妈妈/配偶**），各方等额，记 `Inheritance` 流水；
- **无在世子一代** → 家户全部资源**交入公仓**（`public_granary` 兜底账本，预留 M4 Region 对接）；
- 清算后家户 `is_dissolved = true`。

### 3.4 成员进出与流水 UI

- 出生 → 加入**父亲**家户；成婚 → 女方转入夫家；改嫁 → 女方先移出旧夫家、再加入新夫家（先移后加，保证唯一归属）；配 `Membership` 事件流水。
- 快照三处同步：`TransferRecordSnapshot` / `recent_journal` / `household_id` / `household_role` / `marriage_history_count` / `public_granary_balances`；前端 Inspector 展示婚姻履历 + 所属家户 + 家庭账本流水。

---

## 4. ✅ M3 · 宗族团体 + 族长制（已完成，v1.2.0）

宗族作为 `GroupKind::Clan(String)` 实例落地，族长 = 同姓最年长在世男性。

- 按 `surname` 自动聚合（不要求同营地），每族一册 `Group { leader, members, ledger }`（`ledger/clan.rs::ClanRegistry`）；
- **族长顺位**：age 降序、男性、在世，并列按 id 取小；无在世男性 → 宗族无主、账本冻结；
- **族税**：每 `clan_tribute_interval_ticks`(1800) 全局统一征收，存续家户按账面余额 × `clan_tribute_rate`(5%) 向族库缴纳（`Family → Clan` 的 `Tribute`，记账不扣物理库存，有族长才征）；
- **族内互助**：族库总余额 > `clan_mutual_aid_min_balance`(50) 且家户水+粮 < `clan_mutual_aid_family_threshold`(10) 时，族长签发 `Clan → Family` 的 `MutualAid`（`min(族库×20%, 缺口×2)`，每家户 900 tick 冷却保确定性）；
- 前端宗族面板（`ledger-ui.js` 宗族页）：姓氏、族长、成员户数、族库余额、近期流水。

---

## 5. ✅ M4 · 地区团体 + 国王政体 + 夺位与换届（已完成，v1.3.0）

地区居民成为 `GroupKind::Region(u32)` 团体，落地"政体 + 换届"第一版（国王 / 长子继承制）。

- 每营地一册 `Region { group, regime: Kingdom, succession: Primogeniture, arrival_order }`（`ledger/region.rs::RegionRegistry`）；
- **到达时序**：`Agent3D.arrival_tick`（始祖=0，新生儿出生 tick 登记）；`arrival_order` 按 `(arrival_tick, agent_id)` 排序；
- **初王**：`arrival_order` 中最早到达的在世男性；
- **★ 夺位远征（决策树最高优先级，`decisions/scheduler.rs::tick_conquest_expedition`）**：凡男性、非国王、且存在无主营地，立即放下一切（可中断施工/修缮，进度冻结不回滚）冲往最近无主营地；抵达后登基 + `Succession` 流水；途中目标易主则下一决策相位重评估（重定向/放弃）；
- **长子继承制**：国王死亡 → 在世最年长直系男性后代（无子女则孙辈隔代承继）；绝嗣 → `arrival_order` 中下一个最先到达的在世男性；全营地无男性则王位空悬、账本冻结；
- **公仓税与救济**：每 `ledger_tax_interval_ticks`(2400) 全局统一征收，存续家户按账面余额 × `ledger_tax_rate`(3%) 缴 `Tax`（有国王才征）；公仓总余额 > `ledger_relief_min_balance`(30) 且家户水+粮 < `ledger_relief_family_threshold`(8) 时由国王签发 `Relief`（每家户 1200 tick 冷却）；
- 前端营地面板升级为"地区面板"（`ledger-ui.js` 王国页）：国王名号、政体/换届规则、成员户数、地区账本收支、换届历史 + Canvas 夺位特效。

---

## 6. ✅ M5 · 收尾与文档（已完成）

- 各阶段完成即自增版本号（`index.html` 徽章 + `AGENTS.md` 两处 + `docs/current/11-changelog.md` 追加条目）；
- 更新 `docs/current/04-*.md` / `05-*.md` / `06-*.md` / `12-*.md` 模块文档 + 嵌套 `ledger/AGENTS.md`；
- 最终验收门禁：`node tools/config-check.js` + `node tools/test-wasm.js` 双绿。

---

## 7. 关键设计决策与理由

| 决策 | 理由 |
| :--- | :--- |
| **家庭跟着男人走** | 婚姻只是两性关系记录，不应承载家庭账本；以男性户主为锚，改嫁/丧偶时归属清晰，避免"婚姻封账后资产归属争议" |
| **新旧完全分离，旁路记账** | 物理仓储逻辑已稳定，直接改造风险高且破坏确定性；旁路记账让账本独立演进，前端分别标注"库存"与"账面" |
| **胎儿 Agent 身份（受孕即建实体）** | 分家权重与继承需要稳定的胎儿身份；v1.3.5 起受孕即建 agent 实体（`is_fetus=true`、随父入家户、`children_ids` 包含），继承可追溯、不再绝嗣误判；出生原位替换复用 ID |
| **分家权重父=2、子一代各=1（含胎儿）** | 体现家长主导地位同时保证未出生孩子权益；`n` 取自父亲 `children_ids.len()`（胎儿已含），权重分母集中单一函数计算，逐类资源独立计算避免浮点误差累积 |
| **夺位为决策树最高优先级** | 王位空悬是社会结构重大事件，应压倒一切个人需求；中断施工/修缮时冻结进度不回滚，登基或失败后可恢复 |
| **一切排序"并列取 id 小者"** | 保证确定性——同种子下无论并发顺序如何，结果逐字节一致 |

---

## 8. 风险与应对

| 风险 | 应对 |
| :--- | :--- |
| 记账/换届钩子破坏确定性 | 钩子纯观测、不消耗 RNG；tick 尾段独立追加；排序并列取 id 小者 |
| 胎儿 Agent 身份改变发号/实体序列 | 预期内一次性基线更新，改造后重跑 `test-wasm.js` 重建基准；禁止同提交并行改动其他发号逻辑 |
| 分家/继承权重算错（含胎儿） | 权重与份额集中 `ledger/family.rs` 单一函数；逐类资源独立计算；临时单测覆盖 n=0/1/3 含胎儿后删除 |
| 改嫁女性家户归属错乱 | 改嫁 = 婚姻封旧开新 + 女方 `by_agent` 先移后加，保证任一时刻唯一归属 |
| 夺位中断施工导致烂尾 | 中断时施工/修缮进度原状冻结（不回滚），登基或失败后可在下个决策相位恢复 |
| 新旧双轨数字"对不上" | 账本记权责流水（归谁），物理仓储记存量（在哪）；前端分别标注"账面"与"库存" |
