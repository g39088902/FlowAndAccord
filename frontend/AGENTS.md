# frontend 模块 · 局部操作指南

> 本目录是原生静态前端：15 个 JS 文件 + index.html + style.css + server.js，无构建工具，纯静态文件。
> 改本目录代码前：先读根 AGENTS.md §4（尤其 §4.1 双副本、§4.5 快照三处同步、§4.14 决策顺序），再读本文件。
> 全局规则以根 AGENTS.md 为准，冲突时以根文档为准。

---

## 一、文件清单与职责边界

### 1.1 基础层（零业务依赖，最先加载）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/math.js` | ~75 | 3D 向量与投影变换（Vec3 / 世界坐标→屏幕坐标 / 倾斜投影） | 任何业务逻辑 |
| `js/config.js` | ~215 | `window.SIM_CONFIG` 全局数值配置（148 字段，M8 起不含升级成本矩阵），按功能分区注释 | 默认值真相源在 Rust `config.rs`，本文件是前端镜像 |
| `js/config.decision-order.js` | ~30 | `window.SIM_DECISION_ORDER`：决策分支顺序 + 层级覆盖（13 条 b1~b13）。**唯一真相源**，由 server.js 原子写盘 | Rust 侧默认为空 Vec，不写死顺序（根 AGENTS.md §4.12 例外） |
| `js/config.house-upgrade-cost.js` | ~50 | `window.SIM_HOUSE_UPGRADE_COST`：房屋升级材料成本矩阵 **20 字段**（M8 拆分文件，独立语义避免主配置臃肿），rustworld.js applyConfig 时 Object.assign 合并 | 值须与 Rust `config.rs` 的 house_upgrade_cost_tier* 默认一致（config-check 校验） |

### 1.2 决策引擎视图层（三件套，必须在 rustworld.js 之前加载）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/decision-viz-data.js` | ~75 | `D.BRANCH_MAP`：13 条分支的元数据（中文名/条件文案/默认层级/图标/FSM 状态映射 `FSM_STATE_ZH`） | DOM 操作、拖动逻辑 |
| `js/decision-viz-view.js` | ~438 | 决策引擎覆层的 DOM 渲染：分支卡片/分界线/层级图例/检查器/拖动事件绑定 | 数据来源、配置合并 |
| `js/decision-viz.js` | ~207 | 集成层：`mergeIntoSimConfig()` 把顺序合并进 SIM_CONFIG / 拖动松手→`applyConfig()` 热注入→`POST /save-decision-order` 写盘 / localStorage 降级 | 具体渲染（委托给 view）、具体元数据（委托给 data） |

**加载约束**：三件套必须在 `rustworld.js` 之前加载——`rustworld.js` 构造时会读取 `window.SIM_CONFIG`（已包含合并后的决策顺序）并调用 `applyConfig`。

### 1.3 核心桥接与渲染层

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/rustworld.js` | ~507 | `RustWorld` 类：加载 wasm / `world_create` / `tick()` 步进 / `_pullSnapshot()` 拉取 / `_applySnapshot()` 映射为 JS 对象 / `applyConfig()` 热注入 / agentArchive 全量档案库 | Canvas 渲染、DOM 事件 |
| `js/render.js` | ~2130 | **Canvas 主渲染**：`render(now)` 主循环（地形/路网/POI/房屋/族人/选中高亮/轨迹）/ 顶栏统计 `updateTopBarStats` / 调试监视器 `updateDebugHud` / Inspector 面板（族人/房屋/POI）/ 全局均值大盘 `updateGlobalAverages` / 账本面板 `updateLedgerPanel` / 马斯洛需求解析 `parseMaslowNeed` | 事件绑定（在 main.js）、制度大盘 UI（在 ledger-ui.js）、族谱（在 dag-*.js） |
| `js/main.js` | ~574 | 全局初始化 / 相机控制（缩放/平移/跟随）/ 事件绑定（点击拾取/快捷键 Space/Esc/重置按钮/倍速切换）/ 控制台日志 / 无头模式切换 | Canvas 绘制（在 render.js）、wasm 交互（在 rustworld.js） |

### 1.4 族谱系统（四件套，独立标签页）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/dag-layout.js` | ~362 | 族谱时间轴布局数学（**纯函数，零 DOM**）：Y=出生 tick 线性映射 / X 冲突横向扩展 / 视口虚拟化 LOD / 时间刻度尺计算 | Canvas 渲染、数据构建 |
| `js/dag-view.js` | ~458 | 族谱 Canvas 虚拟化渲染 + pan/zoom + LOD + 刻度尺绘制 + 节点点击 | 布局计算（委托给 layout）、数据来源 |
| `js/dag-standalone.js` | ~284 | 族谱独立新标签页的 HTML 模板生成 + `window.open` 编排 | 主页面内的族谱模态 |
| `js/dag.js` | ~306 | 族谱数据构建（从 rustworld.agentArchive 生成血脉图）+ 模态框编排 + Inspector 联动 + 先祖档案库穿梭 | 布局数学（layout）、渲染（view） |

### 1.5 制度大盘层

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/ledger-ui.js` | ~818 | 社会与经济制度大盘：**四标签页**（家户 household / 婚姻 marriage / 宗族 clan / 王国 region）/ 标签切换 `switchTab` / 每家户账本余额展示 / 流水穿透抽屉 / 族长/国王顺位展示 / 公仓/族库余额 / 格式化工具函数（tickToSec / agentName / balTotal） | Canvas 渲染、wasm 交互、族人 Inspector |

### 1.6 基础设施

| 文件 | 行数 | 职责 |
|---|---|---|
| `server.js` | ~122 | 静态文件开发服务器（内置 `.wasm` MIME = application/wasm）/ `POST /save-decision-order` 端点（校验后原子写盘 config.decision-order.js）/ 默认 3000 端口 |
| `index.html` | ~860 行 | 单页应用骨架：Canvas 容器 / 顶栏 / Inspector / 制度大盘 / 决策引擎覆层 / 族谱模态 / 15 个 script 标签按序加载 |
| `style.css` | — | 全局样式（顶栏/Inspector/大盘/决策视图/族谱/调试器） |
| `rust/sim_wasm.wasm` | — | WASM 编译产物**主副本**（rustworld.js 实际 fetch 的路径） |
| `sim_wasm.wasm` | — | WASM 编译产物**根目录备用副本** |

---

## 二、脚本加载顺序（index.html，勿打乱）

```
1. math.js                    零依赖基础
2. config.js                  SIM_CONFIG (148 字段，主镜像)
3. config.decision-order.js   SIM_DECISION_ORDER (合并进 SIM_CONFIG)
4. config.house-upgrade-cost.js SIM_HOUSE_UPGRADE_COST (M8 升级成本矩阵 20 字段，applyConfig 时合并)
5. decision-viz-data.js       分支元数据
6. decision-viz-view.js       决策视图 DOM 渲染
7. decision-viz.js            集成层: mergeIntoSimConfig() ← 此时 SIM_CONFIG 才完整
8. rustworld.js               构造时读取 SIM_CONFIG 并 applyConfig ← 必须在 3/4 及决策三件套之后
9. dag-layout.js              族谱布局数学
10. dag-view.js               族谱渲染
11. dag-standalone.js         族谱独立页模板
12. dag.js                    族谱数据构建+编排
13. main.js                   事件绑定+初始化
14. ledger-ui.js              制度大盘
15. render.js                 Canvas 主渲染 ← 最后加载，依赖以上全部全局对象
```

**关键约束**：
- 三个拆分配置/视图文件（3-7：config.decision-order.js、config.house-upgrade-cost.js + 决策三件套）必须在 `rustworld.js`（8）之前——否则 wasm 注入的是不含决策顺序/不含升级成本矩阵的不完整配置
- 改拆分配置 JS（新增全局对象）必须同步：`rustworld.js::applyConfig` 合并逻辑、`tools/config-check.js` 前端字段集、`tools/test-wasm.js` 注入
- `render.js`（15）最后加载，其 `render(now)` 主循环依赖 `window.rustWorld`、`window.dag`、`window.ledgerUI` 等全局对象

---

## 三、数据流与渲染管线

```
WASM 内核 (sim_wasm.wasm)
    │  world_tick(dt) 每帧调用
    ▼
WorldSnapshot3D (JSON, 线性内存)
    │  rustworld.js::_pullSnapshot()
    ▼
rustworld.js::_applySnapshot(snap)
    │  映射为 JS 对象
    ├─→ this.agents[] / this.houses[] / this.pois[]
    ├─→ this.households[] / this.marriages[] / this.clans[] / this.regions[]
    ├─→ this.network { lanes: Map, nodes: Map }
    ├─→ this.terrain { cells: [] }
    └─→ this.agentArchive (Map, 全量生命周期档案含已故先祖)
         │
         ├─→ render.js::render(now)     Canvas 绘制（地形/路网/POI/房屋/族人/轨迹）
         ├─→ render.js::updateTopBarStats()  顶栏统计（人口/出生/死亡/季节/温度）
         ├─→ render.js::updateDebugHud()     调试监视器（Tick/FPS/CPU/内存/WASM内存）
         ├─→ render.js::Inspector            选中族人/房屋/POI 的详情面板
         ├─→ render.js::updateGlobalAverages()  全局均值大盘（饱食/水分/体力/行囊）
         ├─→ render.js::updateLedgerPanel()      家户账本面板
         ├─→ ledger-ui.js::switchTab/render      制度大盘四标签页
         ├─→ decision-viz-view.js                 决策引擎覆层（实时监控选中 agent 的决策链）
         └─→ dag.js / dag-view.js                 族谱时间轴（从 agentArchive 构建）

main.js::事件绑定
    ├─ 鼠标点击 → 拾取族人/房屋/POI → 更新选中态 → render.js 重绘 Inspector
    ├─ 滚轮/右键拖拽 → 相机缩放/平移 → render.js 下帧生效
    ├─ Space → 暂停/继续 → rustWorld.isPaused
    ├─ Esc → 关闭 Inspector → 同时关闭镜头跟随 (根 AGENTS.md §4.8)
    └─ 重置按钮 → rustWorld.reset() → 重新播撒 20 名族人
```

---

## 四、DOM ID 共享契约

以下 DOM ID 被多个 JS 文件共享，**改 ID 必须全量搜索替换**：

| DOM ID 前缀 | 消费方 | 用途 |
|---|---|---|
| `agent-inspector-*` | render.js / main.js | 族人 Inspector 面板各字段 |
| `house-inspector-*` | render.js / main.js | 房屋 Inspector 面板 |
| `poi-inspector-*` | render.js / main.js | POI 弹窗面板 |
| `tab-*-content` | ledger-ui.js | 制度大盘四标签页内容容器（household/marriage/clan/region） |
| `.ledger-tab-btn` | ledger-ui.js / style.css | 标签页切换按钮 |
| `dv-*` / `.dviz-*` | decision-viz-view.js / decision-viz.js / style.css | 决策引擎覆层元素 |
| `dag-*` | dag.js / dag-view.js / dag-standalone.js / style.css | 族谱模态与独立页 |
| `debug-*` | render.js / main.js | 调试监视器字段 |
| `version-tag` | index.html / render.js | 版本徽章（每次发版须更新） |

**搜索方法**：改 ID 前用 `grep -r "旧ID" frontend/` 确认所有引用点。

---

## 五、局部易踩坑

### 5.1 render.js 严重超标（2130 行）

render.js 当前 2130 行，是 800 行规范的 2.6 倍，其中 `render(now)` 函数 alone 占 ~1600 行（第 200~1800 行）。新增渲染功能时**优先考虑抽离为新文件**：

可拆分候选：
- `render_canvas.js`：Canvas 上下文管理 + `render(now)` 主循环骨架 + 视口变换
- `render_world.js`：地形/路网/POI/房屋绘制
- `render_agents.js`：族人绘制 + 选中高亮 + 轨迹 + 状态气泡
- `render_inspector.js`：Inspector 面板 DOM 更新（族人/房屋/POI）
- `render_hud.js`：顶栏统计 + 调试监视器 + 全局均值大盘 + 账本面板

拆分时保持 `render(now)` 作为入口函数，内部调用各子模块的绘制函数。全局对象 `window.render` 或直接函数挂载需保持兼容。

### 5.2 快照三处同步（根 AGENTS.md §4.5）

给 agent/house/poi 新增快照字段时，必须三处同步：
1. `crates/sim_core/src/spatial/snapshot.rs` — 结构体定义
2. `crates/sim_core/src/spatial/world.rs` — `generate_snapshot()` 赋值
3. `frontend/js/rustworld.js` — `_applySnapshot()` 映射为 JS 对象

**前端消费方**可能还包括 render.js / ledger-ui.js / decision-viz-view.js / dag.js，需同步更新读取逻辑。

遗漏任何一处都会导致前端 `undefined` 或展示旧值。

### 5.3 配置热注入的时序

`rustWorld.applyConfig(cfg)` 支持运行中热注入，但有两个约束：
1. **必须在 wasm 加载完成后**（`this._ready === true`），否则静默返回 false
2. **决策顺序变更**须先改 `SIM_CONFIG.decisionEvalOrder` / `decisionEvalLevels`，再调 `applyConfig`，最后 `POST /save-decision-order` 写盘（decision-viz.js 已封装此链路）

直接改 `rustWorld.config` 无效——配置只通过 `applyConfig` 序列化注入 wasm。

### 5.4 agentArchive 全量档案库

`rustWorld.agentArchive: Map<agentId, AgentSnapshot>` 保存**所有出生过的族人**（含已故先祖），用于：
- 族谱系统（dag.js）构建血脉图，不依赖当前存活 agents
- 断代/绝嗣穿梭时不跳帧
- 死亡族人的 Inspector 回溯

**新增 agent 字段时**，除了快照三处同步，还须确认 `agentArchive` 的写入逻辑（在 `_applySnapshot` 中）是否正确归档新字段。

### 5.5 镜头跟随与 Inspector 联动

根 AGENTS.md §4.8：选中小人后 `isCameraFollow` 开启，**关闭 Inspector（✕ 或 Esc）时必须同时关闭跟随**。此逻辑在 main.js 的 Esc 键绑定和 Inspector 关闭按钮中。

新增 Inspector 关闭方式（如点击其他 UI 区域）时，须同步调用 `rustWorld.isCameraFollow = false`，否则镜头会持续跟随已取消选中的族人。

### 5.6 server.js 的写盘端点

`POST /save-decision-order` 是前端唯一的写文件端点（决策顺序落盘），由 server.js 校验后**原子写** `config.decision-order.js`。

- 静态 COS 部署无写能力时，decision-viz.js 降级为 localStorage 并提示用户
- 本地开发时，写盘后浏览器需刷新才能加载新的 config.decision-order.js（但热注入已即时生效，刷新是为了持久化值与内存一致）

**不要新增其他写文件端点**——前端定位是纯静态，写盘仅限决策顺序这一个文档化例外。

### 5.7 WASM 双副本（根 AGENTS.md §4.1）

改 Rust 内核后必须重编译并复制到两个位置：
- `frontend/rust/sim_wasm.wasm`（rustworld.js 实际 fetch 的主路径）
- `frontend/sim_wasm.wasm`（根目录静态备用）

只改前端 JS/CSS/HTML 时**不需要重编译 wasm**，浏览器 Ctrl+F5 即生效。

---

## 六、与 Rust 内核的接口对照

| 前端调用 | WASM 导出 | 用途 |
|---|---|---|
| `rustWorld._loadWasm()` | `world_create(grid, size, seed, agentCount)` | 创建世界实例 |
| `rustWorld.tick()` / 倍速多步 | `world_tick(dt)` | 推进模拟 |
| `rustWorld.applyConfig(cfg)` | `world_apply_config(jsonPtr, len)` | 热注入配置 |
| `rustWorld._pullSnapshot()` | `world_snapshot()` → 线性内存 JSON | 拉取快照 |
| `rustWorld.reset()` | `world_reset(seed)` | 重置世界 |
| 决策顺序写盘 | （无 wasm 接口，纯前端文件） | server.js 原子写 |

wasm 导出函数的完整清单见 `crates/sim_wasm/AGENTS.md`。
