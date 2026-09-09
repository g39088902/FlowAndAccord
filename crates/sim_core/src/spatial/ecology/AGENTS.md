# ecology 模块 · 局部操作指南

> 本目录是 spatial 层的**生态子模块**，由原 `spatial/ecology.rs`（1107 行，超根 AGENTS.md §4.6 的 800 行规范）按职责拆分而来（★ v1.46.22，**纯代码搬运，行为与 RNG 消费顺序零变更**）。
> 改本目录代码前：先读根 AGENTS.md §4 → `spatial/AGENTS.md` → 本文件。
> 全局规则以根 AGENTS.md 为准，冲突时以根文档为准。

---

## 0. Agent 交互契约

- 输入：Agent、POI、路网、家户账本、配置；输出：POI 储量扣减、行囊装载、账本流水（Deposit / Consume / Market）、新 agent（分娩）。
- **只做物理结算**：本目录不派发任务、不写 `agent.state`（除 `rest_at_camp` 的既有语义外无状态改写），需求分派一律在 `decisions/`（根 AGENTS.md §4.11.1）。
- 装载/卸货契约的**权威描述在 `spatial/AGENTS.md` §3.1**，本文件不复制，只登记实现位置。
- 任何改动后必跑：`cargo test --lib` + `node tools/test-wasm.js`（同种子逐字节一致性是硬门禁）。

## 一、文件清单与职责边界

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `mod.rs` | ~20 | 子模块声明与拆分说明 | 任何逻辑 |
| `seed.rs` | ~80 | `seed_primitive_ecology()` 世界重置入口 + 播撒步骤编排 + 收尾（事件文案/索引重建/脏标记/APSP） | 具体落位（在 `spawn.rs`）、始祖生成（在 `founder.rs`） |
| `spawn.rs` | ~340 | POI 播撒（营地/泉/果/木/石/金/榷场）、地形过渡节点、全图路网连接、始祖出生地兜底节点（`make_far_spawn_node` / `connect_spawn_node`）、`SeedLayout` 共享布局状态 | agent 生成、制度登记 |
| `founder.rs` | ~200 | 始祖 Agent 生成（出生地抽选/属性掷点/姓名）+ 家户/宗族/地区/帝国制度登记 | POI 播撒、路网构建 |
| `tick.rs` | ~115 | `tick_poi_interactions(dt)` 调度壳：遍历/死者与胎儿跳过/分娩委托收集/按状态分派/出生结算/尸骸清理 | 各状态的物理结算（在 `harvest.rs` / `home.rs`） |
| `harvest.rs` | ~400 | 现场采收（水/粮/木/石/金）与榷场采购结算（自救缓冲 → 装袋购入 → 家户黄金记账扣减） | 卸货入账、在家吃喝（在 `home.rs`） |
| `home.rs` | ~165 | `RestingAtCamp` 卸货入账（水/粮/木/石/金，Deposit 流水）+ 从家户账本吃喝（Consume 流水） | 采收、市场交易 |

## 二、两个对外入口

```
seed.rs::seed_primitive_ecology(agent_count)   ← sim_wasm::world_create / examples 调用
tick.rs::tick_poi_interactions(dt)             ← world_tick.rs 管线步骤 3（必须早于决策）
```

**步骤 3 的位置是硬不变量**：卸货入账在决策之前，决策读到的是卸货后的**家户账本**余额（M6 起）。详见 `spatial/AGENTS.md` §二。

## 三、🔴 RNG 消费顺序（本目录最易踩）

`World3DEngine.rng` 全局共享，本目录的消费顺序**逐字节决定同种子一致性**：

1. **播撒顺序固定**（`seed.rs` 编排，勿重排）：营地 → 清泉 → 浆果 → 林木 → 石矿 → 金矿 → 榷场互市 → 地形过渡节点 → 始祖逐人属性。
2. **`find_spaced_poi_pos` 每轮恰好 2 个均匀数**：100 次严格间距 → 50 次放宽间距 → 1 次无条件兜底。改循环次数即改随机序列。
3. **始祖属性掷点顺序**（`founder.rs`）：性别不掷 → 饥渴体力 3 次抖动 → 六项禀赋各 1 次 `gen_normal`（各消耗 2 个均匀数）→ 姓氏 1 次。
4. **`make_far_spawn_node` 仅在 `valid_spawn_nodes` 为空时调用**（极端回退），但它消耗 RNG——挪动调用时机同样会改变序列。

> 门禁：`node tools/test-wasm.js` 的「determinism (same seed)」与 `node tools/test-determinism.js` 六套件。重构本目录后建议额外做存档哈希逐字节比对（见 changelog v1.46.22 方法论）。

## 四、局部易踩坑

### 4.1 世界重置必须全量清空

`seed.rs::reset_world_state()` 是唯一清空入口，清单见 `spatial/AGENTS.md` §4.5。遗漏任一项 → 重置后残留旧状态（"重置后族人仍显示旧家户"）。

### 4.2 胎儿跳过

`tick.rs` 中 `is_fetus` 的 agent **必须跳过**（无地图实体、无装卸/进食饮水）。胎儿仍参与家户计数、继承、宗族与族谱。

### 4.3 无房不装袋

`harvest.rs` 各采收函数与 `home.rs::rest_at_camp` 均以 `agent.home_house_id.is_some()` 为装袋/入账前提；无家宅者只在现场就地自饮自食，**不得"隔空入账"**。

### 4.4 索引重建

`tick.rs` 末尾 `retain` 清理尸骸后，**仅在长度变化时** `rebuild_agent_index()`；分娩 push 由 `birth.rs::resolve_newborns` 内部增量维护。详见 `crates/sim_core/AGENTS.md` §5.3。

### 4.5 榷场资金支付顺序

`harvest.rs::buy_at_market` 的支付为「先扣家户账本黄金，不足由随身黄金补足」，黄金流向 `LedgerRef::Void`（通缩闭环）。`current_hh_gold` / `current_carried_gold` / `total_hh_gold_paid` 是跨块共享可变状态，**调整结算顺序会改变资金结果**（v1.46.13 曾修此处资金停滞 Bug）。

---

## 五、后续拆分（阶段二，未做）

当前为**阶段一纯搬运**：重复代码**原样保留**。已知待去重项（改动需重跑确定性门禁）：

- `spawn.rs` 6 个 POI 播撒循环结构几乎相同（仅类型/ID 段位/名称/储量字段不同）→ 可表驱动；
- `harvest.rs` 5 个采收 arm 结构相同 → 可表驱动（注意 `rate_heavy` 力量加成仅木/石有）；
- `harvest.rs::buy_at_market` 5 个 `MarketTradeRecord` + 支付拆分块、`home.rs` 5 个卸货块 → 可抽 helper（注意 §4.5 的共享可变状态）。
