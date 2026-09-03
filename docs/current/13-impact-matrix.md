# 13. 🔗 跨模块影响矩阵

> **模块索引**：[← 返回 CURRENT.md 全景索引](../CURRENT.md)
> 本文档是 agent 设计方案时的最高价值单页参考：**改 X 会牵动哪些文件**。按"最常改动 → 最隐蔽联动"排序。
> 最后核验：v1.5.1。

---

## 一、核心机制改动影响面

### 1.1 随身行囊 / 搬运机制

| 改动对象 | 必须同步改动 | 原因 |
|---|---|---|
| `agent.rs` 行囊容量 (`carryCapacityResource`) | `ecology.rs` 装载逻辑 / `decisions/harvest.rs` 满额判定 / `decisions/branches.rs` 返家条件 / `snapshot.rs` AgentSnapshot / `rustworld.js` `_applySnapshot` / `render.js` Inspector 行囊展示 | §4.4 全链条联动：容量决定何时满、何时返、展示什么 |
| `ecology.rs` 装卸货速率 (`poiUnloadRateResource`) | `agent.rs` 行囊状态机 / `decisions/` 停留时长 / `ledger/journal.rs` Deposit 流水速率 / `render.js` 进度动画 | 卸货速率决定在家停留时长和账本入账节奏 |
| 新增资源类型 (第六类) | `agent.rs` 行囊字段 / `ecology.rs` 装载/卸货 / `poi.rs` PoiType / `decisions/` 全套分支 / `ledger/journal.rs` ResourceKind / `snapshot.rs` / `rustworld.js` / `render.js` / `config.rs`+`config.js` 超参 / `bookkeeping.rs` RESOURCE_ORDER | 资源类型是全系统横切概念，每一层都有枚举匹配 |

### 1.2 快照与前端字段同步

| 改动对象 | 必须同步改动 | 原因 |
|---|---|---|
| `snapshot.rs` 新增 AgentSnapshot 字段 | `world.rs` `generate_snapshot()` 赋值 / `rustworld.js` `_applySnapshot()` 映射 / `render.js` 或 `main.js` 消费端 | §4.5 三处同步：缺一处就是运行时 undefined |
| `snapshot.rs` 新增 HouseSnapshot 字段 | `world.rs` `generate_snapshot()` / `rustworld.js` / `render.js` 房屋 Inspector / `ledger-ui.js` 如涉及家户关联 | 房屋快照同时被渲染层和制度大盘消费 |
| `snapshot.rs` 新增 PoiSnapshot 字段 | `world.rs` / `rustworld.js` / `render.js` POI 弹窗 / `main.js` 点击拾取 | POI 快照被顶栏统计和弹窗双重消费 |
| 前端 DOM ID 变更 | `render.js` `getElementById` / `main.js` 事件绑定 / `ledger-ui.js` / `decision-viz-view.js` / `style.css` 选择器 | §4.5 末尾：DOM ID 是多文件共享契约 |

### 1.3 决策系统

| 改动对象 | 必须同步改动 | 原因 |
|---|---|---|
| `decisions/branches.rs` 新增分支 (b14+) | `needs.rs` NeedKind 枚举 / `config.decision-order.js` 排序注册 / `decision-viz-data.js` 分支元数据(条件文案/层级/图标) / `render.js` NEED_KIND_REASON 状态标签 / `decisions/AGENTS.md` | §4.14 分支自包含铁律 + 决策顺序可编排：新分支必须在前端注册才能被拖动排序和可视化 |
| `decisions/needs.rs` 新增 NeedKind | `branches.rs` 命中返回 / `evaluate.rs` 状态切换 / `scheduler.rs` 执行分发 / `agent.rs` PrimitiveActionState 如涉及新行为 / `render.js` 状态标签 / `decision-viz-data.js` | NeedKind 是决策→行为→渲染的贯通标识 |
| `decisions/scheduler.rs` 决策节拍变更 | `agent.rs` 相位计算 / `world.rs` tick 调用位置 / `config.rs` `agentDecisionIntervalTicks` / 文档 §4.3 | §4.3 决策节拍语义是行为核心，勿随意改 |
| 决策分支条件读取家户账本 | `evaluate.rs` Decisioner 注入 HouseholdRegistry / `scheduler.rs` build_decision_context / `world.rs` tick_decisions 传参 | M6 起决策读账本，Decisioner 需持有账本引用 |

### 1.4 账本与社会制度

| 改动对象 | 必须同步改动 | 原因 |
|---|---|---|
| `ledger/journal.rs` ResourceKind 变更 | `bookkeeping.rs` RESOURCE_ORDER / `ecology.rs` 收付映射 / `housing_system/maintenance.rs` 烧柴 / `decisions/` 余额读取 / `snapshot.rs` LedgerBalanceSnapshot / `rustworld.js` / `render.js` / `ledger-ui.js` 五类余额展示 | ResourceKind 是账本系统的基础枚举，全系统横切 |
| `ledger/family.rs` 家户锚定规则变更 | `housing_system/marriage.rs` 成婚入家户 / `housing_system/inheritance.rs` 房产继承 / `bookkeeping.rs` 分家/继承 / `birth.rs` 新生儿入家户 / `decisions/` 家户守卫 / `ledger-ui.js` 家户页 | "家庭跟着男人走"是 M1 核心不变量，改动影响所有家庭相关逻辑 |
| `ledger/clan.rs` 宗族规则变更 | `world.rs` tick_clan 调用 / `birth.rs` 新生儿入族 / `ecology.rs` 始祖入族 / `snapshot.rs` ClanSnapshot / `rustworld.js` / `ledger-ui.js` 宗族页 / `config.rs` 族税/互助超参 | M3 宗族是按姓氏聚合的团体，与家户、地区并列 |
| `ledger/region.rs` 地区王国规则变更 | `world.rs` tick_region / `decisions/branches.rs` B14SeekThrone 夺位分支 + `decisions/evaluate.rs` 目标选定 + `decisions/scheduler.rs` execute_pending_coronations 登基 / `agent.rs` is_on_expedition + expedition_target_camp + coronation_pending / `snapshot.rs` RegionSnapshot(history_kings/member_ids/governed_households) + AgentSnapshot(expedition_target_camp/coronation_pending) / `rustworld.js` / `ledger-ui.js` 王国页 / `config.rs` 公仓税/救济超参 | M4 地区与王国涉及夺位远征(决策层)和继承(agent层) |
| `bookkeeping.rs` 继承/分家规则变更 | `ledger/family.rs` 家户解散/立户 / `ledger/journal.rs` Inheritance/Split 流水 / `housing_system/inheritance.rs` 房产继承 / `agent.rs` 金币遗产 / `world.rs` tick 顺序 | M2 家庭生命周期结算是账本制度的最后一步前序 |

### 1.5 房屋系统

| 改动对象 | 必须同步改动 | 原因 |
|---|---|---|
| `housing_system/construction.rs` 升级材料成本 | `decisions/needs.rs` `upgrade_material_cost` (单一真相源) / `decisions/branches.rs` b8/b11 就绪判定 / `ledger/journal.rs` Construction 流水 / `config.rs` + `config.house-upgrade-cost.js`（20 超参矩阵三处同步）/ `render.js` 升级按钮状态 / `decision-viz-data.js` b8/b11 文案 | §4.8 M8：升级成本 = 4×5 固定矩阵（升1级水粮50/2级木粮水75/3级石木粮水100/4级金石木粮水125），`needs::upgrade_material_cost` 是唯一真相源 |
| `housing_system/maintenance.rs` 冬季供暖规则 | `agent.rs` 在家消耗 / `ledger/journal.rs` Heating 流水 / `decisions/branches.rs` 木材补货触发 / `config.rs` `houseWinterColdTemp`/`houseWinterWoodBurnRate` / `render.js` 房屋状态 | 冬季烧柴从家户账本真实扣减，影响决策补货和账本流水 |
| `housing_system/settlement.rs` 立宅选址规则 | `decisions/branches.rs` FoundHome 触发 / `graph.rs` 路网节点接入 / `world.rs` 房屋实体化 / `render.js` 新房屋渲染 | §4.11 立宅是 agent 自主决策，系统仅做放置校验 |
| `house.rs` 房屋等级/耐久模型 | `housing_system/` 全套 / `decisions/needs.rs` 等级目标 / `snapshot.rs` HouseSnapshot / `render.js` 房屋图标/Inspector / `ledger-ui.js` 家户住所展示 | 房屋模型是 housing_system 的数据基础 |

### 1.6 生态与 POI

| 改动对象 | 必须同步改动 | 原因 |
|---|---|---|
| POI 数量变更 (countCamps 等) | `ecology.rs` 初始化 / `poi.rs` ID 段位 / `index.html` 顶栏面板文案 / `docs/current/02-ecology-poi.md` / `config.rs`+`config.js` / `render.js` POI 列表 | §4.7 POI 数量须同步多处 |
| `poi.rs` 新增 POI 类型 | `ecology.rs` 初始化/采收 / `decisions/` 寻路/采收分支 / `agent.rs` PrimitiveActionState / `graph.rs` 节点类型 / `snapshot.rs` / `rustworld.js` / `render.js` 图标/弹窗 / `config.rs` 产速/储量超参 | POI 类型是全系统横切概念 |
| `ecology.rs` POI 再生规则 | `poi.rs` tick_regenerate / `world.rs` tick POI 再生段 / `config.rs` regen_base_* / `render.js` 储量条动画 | POI 再生在 tick 最前端执行，影响后续所有采收决策 |
| `graph.rs` 路网/寻路规则 | `decisions/routing.rs` 路径规划 / `decisions/seeking.rs` 重路由 / `agent.rs` tick_movement / `housing_system/settlement.rs` 立宅接入 / `world.rs` 道路衰减 / `render.js` 路网渲染 / `config.rs` 衰减超参 | 路网是空间模拟的基础设施，所有移动都依赖它 |

### 1.7 Agent 生理与生命周期

| 改动对象 | 必须同步改动 | 原因 |
|---|---|---|
| `agent.rs` 代谢规则 (饱食/水分/体力衰减) | `world.rs` tick 代谢段 / `decisions/branches.rs` 需求阈值 / `ecology.rs` 在家吃喝 / `config.rs` 代谢超参 / `render.js` 状态条 / `birth.rs` 如涉及孕期 | 代谢是 agent 生存的基础，决定所有需求触发 |
| `agent.rs` 新增属性字段 | `snapshot.rs` AgentSnapshot / `world.rs` generate_snapshot / `rustworld.js` / `render.js` Inspector / `birth.rs` 遗传如涉及 / `decisions/` 如决策读取 | §4.5 快照三处同步 |
| `birth.rs` 生育/遗传规则 | `agent.rs` 受孕/妊娠 / `world.rs` tick_fetus_reconcile / `ledger/family.rs` 新生儿入家户 / `ledger/clan.rs` 新生儿入族 / `bookkeeping.rs` 分家权重 / `snapshot.rs` / `render.js` 母亲卡片 | §4.8 生育去房屋化：受孕只依赖身体指标，胎儿即建 agent 身份 |
| 死亡规则变更 | `agent.rs` 死亡判定 / `world.rs` 死亡计数 / `bookkeeping.rs` 继承清算 / `housing_system/inheritance.rs` 房产继承 / `ledger/family.rs` 家户解散 / `ledger/clan.rs` 族长顺位 / `ledger/region.rs` 王位继承 / `render.js` 死亡动画 | 死亡触发全系统继承链：账本→房产→宗族→王位 |

### 1.8 配置系统

| 改动对象 | 必须同步改动 | 原因 |
|---|---|---|
| `config.rs` 新增超参 | 命名 `const` 默认值 / `SimConfig` 字段 / `Default` 映射 (三处同文件) / `config.js` 对应字段 / `config-check.js` 自动覆盖 / `docs/config-reference.md` (自动生成) | §4.12 超参集中化：Rust 侧三处 + 前端一处 |
| `config.js` 数值调整 | 浏览器 Ctrl+F5 即生效 / `node tools/config-check.js` 校验 / 如影响机制须更新文档 | 调参不需重编译，但须通过一致性校验 |
| `config.decision-order.js` 分支顺序变更 | `decision-viz.js` 合并进 SIM_CONFIG / `rustworld.js` applyConfig 热注入 / `server.js` POST save-decision-order 写盘 | §4.14 决策顺序真相源在文件，拖动即热注入 |

### 1.9 构建与部署

| 改动对象 | 必须同步改动 | 原因 |
|---|---|---|
| Rust 内核代码变更 | `cargo build --target wasm32-unknown-unknown --release` / 双副本复制到 `frontend/rust/` + `frontend/` / `node tools/test-wasm.js` 门禁 / 版本号自增 | §4.1 双副本同步：缺一不可 |
| 前端 JS/CSS/HTML 变更 | 浏览器 Ctrl+F5 刷新 / 版本号自增 / 如涉及快照字段须三处同步 | 前端纯静态，改完即生效 |
| `.github/workflows/deploy.yml` 变更 | 4 个 Secrets 配置 / COS MIME 覆写 / 门禁顺序 / `docs/cicd-guide.md` | §4.13 CI/CD 使用标准 rustup，非便携工具链 |

### 1.10 外部市场与动态价格系统 (v1.13.0)

| 改动对象 | 必须同步改动 | 原因 |
|---|---|---|
| 外部市场 POI 实体 (`poi.rs`) | `ecology.rs` 播撒与双库存再生 / `snapshot.rs` secondary_* / `world_snapshot.rs` / `rustworld.js` / `render_world.js` 绘制 / `render_inspector.js` 弹窗 | 市场是双库存且动态计价的特殊 POI，独立于 NodePool |
| 动态定价算法 (`market_unit_price`) | `world_snapshot.rs` 快照单价计算 / `ecology.rs` 现场交易计费 / `decisions/market.rs` / `config.rs` + `config.js` 超参 / 16-market-pricing.md | 幂律定价纯函数，全链条调用须一致 |
| 外部商贸决策分支 (`decisions/market.rs`) | `branches.rs` (定长数组 15 / ALL / resolve_order / seen) / `evaluate.rs` / `server.js` VALID_BRANCH_ID / `config.decision-order.js` / `decision-viz-data.js` / `config-check.js` | 决策分支定长数组严格全链条联动 |
| 外部商贸资金流失记账 | `ledger/journal.rs` TransferReason::Market / `ecology.rs` debit 家户黄金转至 Void / `12-ledger-system.md` | 黄金单向流失沉淀，形成通缩调节机制 |

---

## 二、tick 内部调用顺序（勿打乱）

> 以下为 `world.rs::tick()` 的**实际执行顺序**，任何调整都可能破坏确定性或行为语义。

```
0. tick_season(dt)                          四季更迭与温度演化
1. POI 自然恢复 (for poi in pois)           按类型应用产速倍率
2. 代谢与繁衍 (for agent in agents)          agent.tick_metabolism (胎儿跳过)
   2.3 tick_fetus_reconcile()                受孕建胎儿/流产移除/位置跟随
   2.5 settle_gold_inheritance()              死者金币平分给在世子一代
3. tick_poi_interactions(dt)                 POI 实际提取、装载、卸货入账、分娩
4. tick_housing(dt)                           房屋折旧、冬季供暖、空置房登记
5. network.tick_wear_decay(dt)               道路自然衰减
6. 运动 (for agent in agents)                 agent.tick_movement (胎儿跳过)
   tick_decisions()                           错峰决策 ((tick + id) % 30 == 0)
7. tick_bookkeeping()                         M2 继承清算 + 分家抽资
8. tick_clan(dt)                              M3 族长顺位 → 族税 → 族内互助
9. tick_region(dt)                            M4 初王顺位 → 长子继承 → 公仓税 → 救济
```

**关键不变量**：
- **卸货入账在决策之前**（步骤 3 在决策之前）：决策读到的是卸货后的家户账本余额
- **道路衰减在运动之前**（步骤 5 在 6 之前）：运动踩踏的是衰减后的路网
- **决策在运动之后**：决策基于本 tick 运动后的位置和状态
- **bookkeeping/clan/region 在决策之后**：制度结算使用决策后的最终状态
- **胎儿跳过**：代谢、运动、决策均跳过 `is_fetus` 的 agent

---

## 三、数据流向图（Rust → 前端）

```
SimConfig (config.rs + config.house-upgrade-cost.js，共 168 字段)
    │  序列化
    ▼
sim_wasm.wasm (world_create / world_tick / world_apply_config)
    │  线性内存 JSON
    ▼
WorldSnapshot3D (snapshot.rs)
    │  generate_snapshot()
    ▼
rustworld.js::_applySnapshot()
    │  映射为 JS 对象
    ├─→ this.agents / houses / pois / households / marriages / clans / regions
    ├─→ this.network (lanes / nodes)
    └─→ this.terrain (cells)
         │
         ├─→ render.js (Canvas 渲染: 地形/路网/POI/房屋/族人/Inspector/顶栏)
         ├─→ main.js (事件绑定: 点击拾取/快捷键/控制台/重置)
         ├─→ ledger-ui.js (制度大盘: 家户/婚姻/宗族/王国 四标签页)
         ├─→ decision-viz-view.js (决策引擎视图: 分支排序/层级/实时监控)
         └─→ dag-view.js (族谱时间轴: 血脉可视化/独立标签页)
```

---

## 四、脚本加载顺序（index.html，勿打乱）

```
1. math.js                    3D 向量与投影变换 (零依赖)
2. config.js                  SIM_CONFIG 全局数值配置 (148 字段，主镜像)
3. config.decision-order.js   决策分支顺序 (合并进 SIM_CONFIG，§4.14 例外)
4. config.house-upgrade-cost.js SIM_HOUSE_UPGRADE_COST (M8 升级成本矩阵 20 字段)
5. decision-viz-data.js       决策分支元数据 (条件文案/层级/图标)
6. decision-viz-view.js       决策引擎视图渲染 (DOM 操作)
7. decision-viz.js            决策引擎集成层 (合并配置/拖动/热注入/写盘)
8. rustworld.js               WASM 桥接层 (加载 wasm/快照映射/applyConfig/合并拆分配置)
9. dag-layout.js              族谱布局数学 (纯函数，零 DOM)
10. dag-view.js               族谱虚拟化渲染 (Canvas/pan/zoom)
11. dag-standalone.js         族谱独立标签页 HTML 模板
12. dag.js                    族谱数据构建 + 模态编排 + Inspector
13. main.js                   页面交互 (事件绑定/控制台/重置模拟)
14. ledger-ui.js              制度大盘 (四标签页 UI)
15. render.js                 Canvas 主渲染 (最后加载，依赖以上全部)
```

**关键约束**：
- 拆分配置（3-4：config.decision-order.js、config.house-upgrade-cost.js）必须在 `rustworld.js`（8）之前加载（必早于首次 applyConfig）；新增拆分配置须同步 config-check.js/test-wasm.js
- `decision-viz.js` 三件套必须在 `rustworld.js` 之前（合并配置后才注入）
- `render.js` 最后加载，依赖所有前置模块的全局对象

---

## 五、快速自检清单（改代码前对照）

```
□ 版本号：index.html 徽章 + AGENTS.md §1/§2 已自增
□ 双副本：sim_wasm.wasm 已复制到 frontend/rust/ 和 frontend/ (仅 Rust 变更)
□ 三处同步：snapshot.rs / world.rs / rustworld.js 字段一致 (仅快照变更)
□ 配置联动：config.rs 三处(const/字段/Default) + config.js + config-check.js 通过
□ 测试门禁：cargo build + test-wasm.js + config-check.js 全绿
□ 文档更新：对应 docs/current/0X-*.md + 11-changelog.md 已追加
□ 局部 AGENTS.md：改了哪个目录，其局部 AGENTS.md 的类型/方法名是否需同步
□ 影响矩阵：本文档对应行是否需要更新 (新增机制/文件/枚举时)
```
