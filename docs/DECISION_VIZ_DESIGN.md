# 🧠 马斯洛决策引擎可视化 · 设计方案 (Decision Engine Visualization Design)

> **版本**：v0.1-draft · **定位**：把 `crates/sim_core/src/spatial/decisions/` 的马斯洛需求任务决策代码，可视化为可交互网页的设计方案
> **关联代码**：`decisions/`（7 子模块）+ `agent.rs`（施密特触发器 / PrimitiveActionState）· 深度拆解见 [`docs/AGENT_AI_ANALYSIS.md`](./AGENT_AI_ANALYSIS.md) 与 [`docs/current/06-motivation-ai.md`](./current/06-motivation-ai.md)
> **可复用前端基建**：`frontend/js/dag-layout.js` / `dag-view.js` / `dag-standalone.js`（确定性布局 + 视口虚拟化 + 缩放/平移/拖动 + LOD + 独立标签页）
> **配套原型**：`docs/decision-viz-prototype.html`（可交互演示，含节点拖动）

---

## 1. 背景与目标

### 1.1 需求

把 `decisions/` 目录下这套"马斯洛需求层级 → 决策树 → 行动状态机"的确定性规则代码，**可视化成一页可交互的网页**，并**预留交互能力**（节点拖动、画布缩放平移、悬停/点击下钻、布局持久化等）。

### 1.2 为什么值得做

| 痛点 | 现状 | 可视化后 |
| :--- | :--- | :--- |
| 决策逻辑不直观 | 5 层马斯洛 × 13 种需求 × 15 个行动状态 × 施密特触发器，散落在 7 个 Rust 文件 | 一图看懂"什么条件下小人去做什么" |
| 调参难感知 | `config.js` 里 15+ 个 `decision*` 阈值，改了不知道影响哪条分支 | 阈值直接标注在分支上，可滑动预览 |
| 行为不可复盘 | 只能看到单个小人当前的 `current_need` 标签 | 决策原因链 + 实时监控视图可复盘"为什么" |
| 代码即文档割裂 | 文档（06/AGENT_AI_ANALYSIS）与代码漂移 | 每个图元带**源码锚点**（file::fn::line），图上可直接跳转源码 |

### 1.3 设计原则（硬约束）

1. **零侵入内核**：Rust 决策逻辑一行不改，本方案全部落在前端展示层。实时数据只用现有快照字段（`current_need` / `state` / 生理值），**零改内核即可获得实时视图**；可选地新增 `decision_trace` 字段（见 §7.3）。
2. **逻辑图与代码一一对应**：每个图元必须可追溯到 `decisions/` 中的具体文件、函数、行号与 config 键，禁止凭空示意。
3. **确定性布局，禁用力导向**：沿用族谱 DAG 的确定性布局经验（Y 轴语义映射、X 轴冲突消解），保证同图永远同位置，避免力导向的不可复现抖动。
4. **复用现有前端基建**：`dag-view.js` 的视口虚拟化/缩放/平移/拖动/LOD 是现成的，逻辑图与实时图直接复用同一套视口层。
5. **预留交互能力**：M1 先落静态可读，M2 落拖动与布局持久化，M3 落实时联动——接口从一开始就按"可拖动"设计（图元可写 `x/y` 坐标，布局可序列化/反序列化）。

---

## 2. 现状盘点（可复用资产）

### 2.1 决策代码面：`crates/sim_core/src/spatial/decisions/`（7 文件）

| 文件 | 职责 | 可视化贡献 |
| :--- | :--- | :--- |
| `needs.rs` | `MaslowLevel`(5层) / `NeedKind`(13种) / `Need` / `NodePool` / `HouseStockNeeds` / `state_need_label_with_agent` | **层级塔** + **需求→层级映射表** 的数据源 |
| `evaluate.rs` | `Decisioner` / `decide`(状态机调度) / `evaluate_needs`(逐层评估) / `fulfill_resting_need`(需求落地) | **决策树** + **落地链路** 的核心 |
| `routing.rs` | `dispatch` / `turn_around_and_route_to`(原地掉头) / `return_home` / POI 触发器可用性 | 执行层的"导航"节点 |
| `seeking.rs` | `decide_seeking_material/survival` 途中熔断与平滑重路由 | **重路由分支** 图元 |
| `harvest.rs` | 饮水/采食/伐木/采石/淘金完成判定 + 仓储满额查询 | **现场采收** 图元 |
| `scheduler.rs` | `tick_decisions`(错峰) / `build_decision_context` | **调度节拍** 图元 |
| `agent.rs`(外部) | `PrimitiveActionState`(15态) / `observe_poi_stock_with_config` / `poi_is_seekable`(施密特触发器) | **状态机状态集** + **触发器** 图元 |

### 2.2 实时数据（快照已具备，零改内核）

`crates/sim_core/src/spatial/snapshot.rs::AgentSnapshot` 现成字段：

```rust
pub state: String,                    // 15 个 PrimitiveActionState
pub current_need: Option<String>,     // 马斯洛标签，如 "Physiological·QuenchThirst"
pub hunger/thirst/stamina/health,     // 生理值 → 决策树分支的"实况"
pub home_house_id / spouse_id / children_ids,
```

→ 实时视图的**全部数据**都已随 `sim.tick()` 每帧返回，前端 `_applySnapshot()` 已映射，无需改内核。

### 2.3 前端基建（直接复用）

| 资产 | 文件 | 可复用点 |
| :--- | :--- | :--- |
| 确定性布局引擎 | `dag-layout.js` | Y 语义映射、X 冲突消解、布局可复用为"逻辑图"基础 |
| 视口渲染层 | `dag-view.js` | 拖拽平移、滚轮缩放、LOD 分级、hover 高亮、`transform: translate+scale` 虚拟化 |
| 独立标签页 | `dag-standalone.js` | 决策图独立新开 Tab，与主地图双屏联动 |
| 设计系统 | `style.css` + `UI_SPEC_AND_LEDGER_DESIGN.md` §3.3 | 暗黑玻璃拟态、`.lineage-chip`、语义色板 |
| 检查器模式 | `render.js` Inspector | 右侧浮动检查器、Esc 关闭、事件驱动刷新 |

### 2.4 关键阈值（真实 config，直接标注在图元上）

来源：`frontend/js/config.js` 第 5 分区（与 `config.rs` 同源，经 `tools/config-check.js` 交叉校验）：

| config 键 | 值 | 语义 |
| :--- | :--- | :--- |
| `decisionCriticalThirst` | 25.0 | 临界口渴 → 触发寻水（生理） |
| `decisionCriticalHunger` | 25.0 | 临界饥饿 → 触发觅食（生理） |
| `decisionRestStaminaTarget` | 100.0 | 归巢休息目标体力 |
| `decisionWorkStaminaThreshold` | 50.0 | 劳作最低体力（低于则返家休息） |
| `decisionPoiSeekMinStockRatio` | 0.30 | 施密特触发器**开启**阈值 |
| `decisionPoiAbandonStockRatio` | 0.10 | 施密特触发器**关闭**阈值 |
| `decisionHouseRepairNeedThreshold` | 50.0 | 耐久 <50% 触发修缮 |
| `decisionStockGoldCooldown` | 45.0 | 盖房备料淘金冷却(s) |
| `decisionGoldWealthCooldown` | 180.0 | 娱乐淘金冷却(s) |
| `decisionFoundHomeHungerMin` | 20.0 | 立宅最低饱食 |
| `decisionFoundHomeThirstMin` | 20.0 | 立宅最低水分 |
| `decisionFoundHomeStaminaMin` | 60.0 | 立宅最低体力 |
| `decisionFoundHomeCandidates` | 12 | 立宅候选点掷点数 |
| `agentDecisionIntervalTicks` | 30 | 错峰决策间隔(tick)=1s |

---

## 3. 可视化对象分解（代码 → 图元映射）

核心思路：**把决策代码翻译成 9 类图元**，每类图元一张卡，卡上字段全部来自代码。

| # | 图元 | 来源 | 画法 |
| :--- | :--- | :--- | :--- |
| G1 | **马斯洛层级塔** | `needs.rs::MaslowLevel` | 5 层金字塔，自下而上：生理→安全→归属→尊重→自我实现 |
| G2 | **需求种类映射** | `needs.rs::NeedKind`(13) | 每层塔上挂 1~4 个 `NeedKind` 徽章，附目标状态 |
| G3 | **决策树** | `evaluate.rs::evaluate_needs` | 严格优先级决策树：根=开始评估，逐分支标注**条件+阈值**，叶子=`Need{level,kind,target_state}` |
| G4 | **行动状态机** | `evaluate.rs::decide` + `agent.rs::PrimitiveActionState` | 15 状态节点 + `decide` 分发边（Resting→评估 / Seeking→重路由 / Harvest→判定…） |
| G5 | **需求落地** | `evaluate.rs::fulfill_resting_need` | 从 `Need` 到具体动作：寻路 dispatch / FoundHome 掷点 / 冷却设置 |
| G6 | **途中重路由** | `seeking.rs` + `routing.rs` | 条件分支：目标被触发器关闭→原地掉头→就近同类；体力告警→返家 |
| G7 | **现场采收判定** | `harvest.rs` | 完成条件：自足且仓满 / 行囊满 / 目标不可用→返家或转同类 |
| G8 | **错峰调度** | `scheduler.rs::tick_decisions` | 节拍示意：`(tick+id)%30==0`，每拍先观察 POI 再决策 |
| G9 | **施密特触发器** | `agent.rs::observe_poi_stock_with_config` | 触发曲线：开 ≥30% / 关 <10% / 中间带保持前态（可滑动预览） |

**图元卡片标准字段**（每个节点/卡统一）：

```
┌─ 图元名称 ─────────────────────────────┐
│ 类型徽章 [层级·NeedKind]  [目标状态]      │
│ 触发条件:  <真实条件表达式 + config 阈值>   │
│ 源码锚点:  evaluate.rs::evaluate_needs:102│
│ [config 键列表]  [关联子图 ↗]             │
└───────────────────────────────────────┘
```

---

## 4. 总体方案：双视图 + 三面板

### 4.1 视图划分

| 视图 | 内容 | 数据 | 节奏 |
| :--- | :--- | :--- | :--- |
| **视图 A · 逻辑引擎图**（核心） | G1~G9 全套决策逻辑图解：金字塔 + 决策树 + 状态机 + 执行链路 | 静态逻辑描述（JSON） | 手动导航 |
| **视图 B · 实时决策监控**（增强） | 全图/单人在线状态：当前 `current_need`、状态、生理值、施密特触发器开合、决策历史时间轴 | 快照 `current_need`/`state`/生理值 | 10FPS 节流刷新（遵循 §3.4 硬约束） |

两者用**同一套视口层**（复用 `dag-view.js`），同一画布可切换"逻辑态/实况态"。

### 4.2 页面布局（三面板，沿用现有暗黑玻璃拟态）

```text
+--------------------------------------------------------------------------+
| 🧠 马斯洛决策引擎              [逻辑图|实时监控]   [适应窗口][100%][新标签↗][✕] |
+--------------------------------------------------------------------------+
| 左侧 · 层级导航         | 中央 · 决策图视口                    | 右侧 · 检查器  |
| ▣ ⑤ 自我实现(1)        |  (可拖动节点 / 滚轮缩放 / 拖拽平移)   | 选中图元详情:   |
| ▣ ④ 尊重(4)            |  ┌──────┐                           | - 触发条件     |
| ▣ ③ 归属(2)            |  │ 决策树 │──▶┌──────┐               | - 源码锚点     |
| ▣ ② 安全(4)            |  └──────┘   │状态机│               | - config 键    |
| ▣ ① 生理(3)            |             └──────┘               | - 关联子图     |
| ─────────────          |  [G9 触发器曲线]                    | 跳转源码按钮   |
| 图例 / 阈值速查         |                                     |                |
+--------------------------------------------------------------------------+
| 底部 · 实时决策监控条: [Agent #3 ▸ Physiological·QuenchThirst] [tick 5041] |
+--------------------------------------------------------------------------+
```

- 左侧：5 层马斯洛导航，点击高亮该层全部图元；下方图例与阈值速查。
- 中央：决策图视口（复用 `dag-view.js` 虚拟化），支持节点拖动。
- 右侧：检查器（复用 Inspector 交互范式，`Esc`/✕ 关闭）。
- 底部：实时决策监控条（视图 B），滚动播报每个在决策相位上的小人的需求标签。

### 4.3 接入方式（二选一，推荐 A）

| 方案 | 做法 | 取舍 |
| :--- | :--- | :--- |
| **A. 独立标签页（推荐）** | 参照 `dag-standalone.js`，决策图作为**新 Tab 独立页面**，与主地图双屏联动，点小人 ↔ 主图选中小人 | 不挤占主 UI、复用成熟范式、手机端友好 |
| B. 内嵌 Modal | 参照 `#full-dag-modal`，在主页面弹窗内打开 | 省一次页面，但画布空间小 |

---

## 5. 视觉与配色

- 底色沿用 `#050a12` 暗黑赛博 + 玻璃拟态（`rgba(255,255,255,0.12)` 边框）。
- **5 层语义色**（贯穿所有图元，同一层级同色）：

| 层级 | 语义色 | 用例 |
| :--- | :--- | :--- |
| ① 生理 | 红 `#ef4444` | QuenchThirst / SateHunger / Rest |
| ② 安全 | 蓝 `#38bdf8` | StockWater/Food/Wood / RepairHouse |
| ③ 归属 | 绿 `#10b981` | FoundHome / BuildHouse(0级) |
| ④ 尊重 | 金 `#f59e0b` | BuildHouse(1-4级) / StockStone / StockGold |
| ⑤ 自我实现 | 紫 `#a78bfa` | GoldWealth |

- 图元形状编码：**菱形=评估判断**（决策树分支）、**圆角矩形=状态/动作**、**六边形=调度/触发器**（不只靠颜色区分）。
- 连线：**实线=状态迁移**、**虚线=需求→目标映射**、**点线=源码锚点引用**。

---

## 6. 交互设计（预留交互能力清单）

> 交互能力分三级落地：**M1 静态可读 → M2 拖动与持久化 → M3 实时联动**。接口从 M1 就按"可拖动"设计。

### 6.1 视图操作（M1 即具备，复用 dag-view）

| 交互 | 实现 | 说明 |
| :--- | :--- | :--- |
| 画布平移 | 拖拽空白处 / 右键 | 复用 `dag-view.js` 拖拽平移 |
| 缩放 | 滚轮（0.25x~4x） | 复用 `zoomBy()`，LOD 分级 |
| 悬停高亮 | hover 节点 | 高亮其入边/出边与相邻节点，显示摘要 tooltip |
| 点击下钻 | click 节点 | 打开右侧检查器显示完整字段 + 源码锚点 |

### 6.2 节点拖动（M2，本次"预留"的核心）

| 交互 | 方案 |
| :--- | :--- |
| **拖动节点重排** | 节点卡片 `pointerdown` 捕获 → 跟随指针移动 → 更新 `node.x/y`；SVG 边实时重算；松开落定 |
| **布局持久化** | 每次落定写 `localStorage['decisionViz.layout.v1']`（`{nodeId:x,y,scale,pan}`）；"重置布局"回默认确定性布局 |
| **吸附/对齐辅助** | 拖动时显示参考线（与相邻节点中心对齐提示），避免随手拖乱 |
| **锁定/解锁** | 关键主干节点可锁定（🔒），只允许重排枝叶，防止主干被拖散 |
| **分组折叠** | `evaluate_needs` 决策树按 5 层折叠/展开，控制节点密度 |

### 6.3 语义交互（M3）

| 交互 | 方案 |
| :--- | :--- |
| **阈值滑块演示（G9）** | 拖动 `decisionPoiSeekMinStockRatio` / `AbandonStockRatio` 滑块，触发器曲线与滞回带实时变化，并标注"改此值影响哪些决策分支" |
| **实时状态叠加（视图 B）** | 逻辑图上叠加 20 个 agent 的实况点：小人在哪个状态节点、主导需求高亮；连线粗细=正在走该分支的人数 |
| **决策原因链下钻** | 选中某 agent → 展示其最近 N 次决策的原因链（`evaluate_needs` 走到哪条分支、为什么） |
| **代码锚点跳转** | 检查器"源码"按钮 → 打开对应 Rust 文件定位行（编辑器插件 / 纯展示拷贝路径） |
| **模拟步进/播放** | 决策树可逐步执行：喂入虚拟生理值（thirst/hunger/stamina），逐步高亮走到的分支，输出 `Need` 结论 |

---

## 7. 数据来源与接口

### 7.1 逻辑图数据（视图 A）

- 新文件 `frontend/js/decision-viz-data.js`：一份**确定性 JSON 描述**（节点、边、层级、条件表达式、config 键、源码锚点），手写维护，与代码注释交叉引用。
- 推荐**由代码生成骨架**：`tools/gen-decision-viz.js` 扫描 `decisions/` 源码，抽取 `NeedKind`/`MaslowLevel`/`PrimitiveActionState`/条件字面量，产出 JSON 骨架（人工校对补说明），避免手抄漂移。

### 7.2 实时数据（视图 B，零改内核）

```js
// rustworld.js 已有映射，直接消费
sim.agents[i].currentNeed   // "Physiological·QuenchThirst"
sim.agents[i].state         // "SeekingWater"
sim.agents[i].hunger/thirst/stamina
```

### 7.3 可选增强：新增 `decision_trace` 快照字段（需三处同步）

若要做"决策原因链"（为什么走到这条分支），建议内核在决策相位记录最近一条 `Need` 的**命中分支索引**：

1. `crates/sim_core/src/spatial/snapshot.rs` 加 `pub decision_trace: Option<String>`
2. `world.rs::generate_snapshot()` 赋值 `agent.current_decision_trace`
3. `frontend/js/rustworld.js::_applySnapshot()` 映射 `decisionTrace`

> ⚠️ 遵循根 AGENTS.md §4.5 三处同步；§4.3 决策节拍与 RNG 确定性不受影响（记录只读，不消耗 RNG）。

---

## 8. 技术实现方案（文件规划）

> 严格遵循 AGENTS.md：单文件 ≤800 行（§4.6）、三处同步（§4.5）、版本自增（§4.9）、超参集中（§4.12）、双门禁（§4.12/§4.13）。

### 8.1 新增文件（全部为前端展示层，不动 Rust 决策逻辑）

| 文件 | 职责 | 预估行数 |
| :--- | :--- | :--- |
| `frontend/js/decision-viz-data.js` | 逻辑图 JSON 描述（G1~G9） | ~400 |
| `frontend/js/decision-viz-layout.js` | 确定性布局（复用 dag-layout 思路） | ~250 |
| `frontend/js/decision-viz-view.js` | 视口渲染 + 拖动 + 缩放 + hover + 检查器联动 | ~500 |
| `frontend/js/decision-viz-live.js` | 视图 B 实时监控（10FPS 节流） | ~250 |
| `frontend/js/decision-viz-standalone.js` | 独立标签页入口 | ~120 |
| `docs/decision-viz-prototype.html` | 交互原型（本文档配套，已交付） | — |

### 8.2 修改既有文件（实现期）

| 文件 | 改动 |
| :--- | :--- |
| `frontend/index.html` | 增加决策图入口按钮 + 新标签页/Modal 容器 + script 标签 + **版本徽章自增** |
| `frontend/style.css` | 决策图专属样式（层级色板、图元形状、参考线、检查器） |
| `docs/current/07-frontend-ui.md` / `11-changelog.md` | 功能描述 + 版本条目 |
| `AGENTS.md` §0 | 文档地图登记本设计文档 |

### 8.3 实现顺序

```mermaid
graph LR
    M1["M1 静态逻辑图<br/>金字塔+决策树+状态机<br/>(数据JSON+布局+视口)"]
    M2["M2 交互能力<br/>节点拖动+布局持久化<br/>+缩放平移+检查器"]
    M3["M3 实时联动<br/>快照实况叠加<br/>+触发器滑块+原因链"]
    M1 --> M2 --> M3
```

---

## 9. 里程碑与验收门禁

| 阶段 | 内容 | 验收 |
| :--- | :--- | :--- |
| **M1** | 视图 A 静态逻辑图（G1~G9 全图元 + 源码锚点 + 阈值标注） | 打开决策图页，无交互即可读懂"什么条件做什么"；图元字段与代码一致 |
| **M2** | 节点拖动 / 布局持久化 / 缩放平移 / 检查器 / 分组折叠 | 拖动后刷新布局不丢；localStorage 保存恢复；主干锁定有效 |
| **M3** | 视图 B 实时监控 / 触发器滑块 / 决策原因链（可选 decision_trace） | 暂停模拟下实况数据与内核一致；10FPS 节流无卡顿 |

**每次提交前必检（对齐根 AGENTS.md §4.12/§4.13）**：
1. `node tools/config-check.js` 153/153 全绿（若引入新阈值必须三处同步）；
2. `node tools/test-wasm.js` 输出 `ALL_TESTS_DONE`（内核未动也必须跑，防回归）；
3. WASM 双副本同步（本方案不改内核，无需重编译，但改动任何 Rust 后必须同步）；
4. 版本号自增（`index.html` / `AGENTS.md` / `11-changelog.md` 三处）。

---

## 10. 风险与边界

| 风险 | 影响 | 对策 |
| :--- | :--- | :--- |
| 节点数量爆炸 | 决策树 + 状态机 + 执行层全画出来可能 60+ 节点 | 5 层分组折叠默认只开 G1~G5 主干；按层级/子图渐进展开 |
| 实时视图 20 agent 高频闪烁 | DOM 抖动、掉帧 | 10FPS 节流 + 状态变化才重绘 + 画布 DOM 虚拟化（复用 dag-view） |
| 逻辑图与代码漂移 | 改决策代码后图过时 | 建议 `tools/gen-decision-viz.js` 抽骨架 + 图上源码锚点可复核 |
| 布局持久化数据污染 | localStorage 旧版本布局异常 | 布局带版本号 `v1`，不匹配自动回退默认确定性布局 |
| 与既有族谱 DAG 功能混淆 | 两套 DAG 语义不同 | 决策图独立入口/独立文件/独立检查器，不并入 `dag.js` |

---

## 附录 A：视图 A 首屏内容清单（G1~G9 全图元预览）

```
⑤ 自我实现  ── GoldWealth (SeekingGold, 冷却180s)
④ 尊重      ── BuildHouse(1-4级) · StockStone · StockGold(冷却45s)
③ 归属      ── FoundHome · BuildHouse(0级)
② 安全      ── RepairHouse · StockWater · StockFood · StockWood
① 生理      ── QuenchThirst · SateHunger · Rest
    │
    ▼ (evaluate_needs 严格优先级)
[口渴<25 且有可用水] ─▶ Need{生理, QuenchThirst}
[饥饿<25 且有可用粮] ─▶ Need{生理, SateHunger}
[体力<100]          ─▶ Need{生理, Rest}
[家有屋: 耐久<50% 且是成员] ─▶ Need{安全, RepairHouse}
[家缺 水/粮/木 (按有无家人定安全/归属)] ─▶ Need{Stock*}
[0级仓库仓满+成年男] ─▶ Need{归属, BuildHouse}
[缺石]             ─▶ Need{尊重, StockStone}
[缺金 且冷却≤0]     ─▶ Need{尊重, StockGold}
[仓满+非庄园+成年男] ─▶ Need{尊重, BuildHouse}
[无家+成年男+饥渴体力达标] ─▶ Need{归属, FoundHome}
[有金 且冷却≤0]     ─▶ Need{自我实现, GoldWealth}
    │
    ▼ (decide 状态机 → fulfill → dispatch/seeking/harvest)
RestingAtCamp → 评估 → dispatch(寻路) → Seeking* → 现场 Harvest* → 返家/续采
途中: 目标被施密特触发器关闭 → turn_around_and_route_to 原地掉头 → 就近同类
```

---

*本设计为方案稿，配套可交互原型见 `docs/decision-viz-prototype.html`；原型中的拖动/缩放/检查器为交互能力的可行性验证，正式实现按 §8 落地。*
