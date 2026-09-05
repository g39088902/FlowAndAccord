# frontend 模块 · 局部操作指南

> 本目录是原生静态前端：21 个 JS 文件 + index.html + style.css + server.js，无构建工具，纯静态文件。
> 改本目录代码前：先读根 AGENTS.md §4（尤其 §4.1 双副本、§4.5 快照三处同步、§4.14 决策顺序），再读本文件。
> 全局规则以根 AGENTS.md 为准，冲突时以根文档为准。

---

## 一、文件清单与职责边界

### 1.1 基础层（零业务依赖，最先加载）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/math.js` | ~75 | 3D 向量与投影变换（Vec3 / 世界坐标→屏幕坐标 / 倾斜投影） | 任何业务逻辑 |
| `js/config.js` | ~215 | `window.SIM_CONFIG` 全局数值配置（175 字段，M8 起不含升级成本矩阵），按功能分区注释 | 默认值真相源在 Rust `config.rs`，本文件是前端镜像 |
| `js/config.decision-order.js` | ~30 | `window.SIM_DECISION_ORDER`：决策分支顺序 + 层级覆盖（18 条 b1~b18，b14 夺位置首，b15 榷场商贸）。**启动注入权威默认值**；★ v1.27.0 起用户运行时调整保存到浏览器 localStorage（`flowaccord.decision-order.v1`，schema 1），不再写回本文件 | Rust 侧默认为空 Vec，不写死顺序（根 AGENTS.md §4.12 例外） |
| `js/config.house-upgrade-cost.js` | ~50 | `window.SIM_HOUSE_UPGRADE_COST`：房屋升级材料成本矩阵 **20 字段**（M8 拆分文件，独立语义避免主配置臃肿），rustworld.js applyConfig 时 Object.assign 合并 | 值须与 Rust `config.rs` 的 house_upgrade_cost_tier* 默认一致（config-check 校验） |

### 1.2 决策引擎视图层（三件套，必须在 rustworld.js 之前加载）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/decision-viz-data.js` | ~75 | `D.BRANCH_MAP`：18 条分支的元数据（中文名/条件文案/默认层级/图标/FSM 状态映射 `FSM_STATE_ZH`，含 b14 夺位与 b15 榷场商贸） | DOM 操作、拖动逻辑 |
| `js/decision-viz-view.js` | ~350 | 决策引擎覆层的 DOM 渲染：Branch 分支卡（含 ID 展示）/分界线/检查器/拖动事件绑定 | 数据来源、配置合并 |
| `js/decision-viz.js` | ~207 | 集成层：`mergeIntoSimConfig()` 把顺序合并进 SIM_CONFIG / 拖动松手→`applyConfig()` 热注入→★ v1.27.0 保存到浏览器 localStorage（schema 1 版本化，含 `savedAt`；非法/版本不符回退默认） | 具体渲染（委托给 view）、具体元数据（委托给 data） |

**加载约束**：三件套必须在 `rustworld.js` 之前加载——`rustworld.js` 构造时会读取 `window.SIM_CONFIG`（已包含合并后的决策顺序）并调用 `applyConfig`。

### 1.3 核心桥接与渲染层

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/rustworld.js` | ~576 | `RustWorld` 类：加载 wasm / `world_create` / `tick()` 步进 / `_pullSnapshot()` 拉取 / `_applySnapshot()` 映射为 JS 对象 / `applyConfig()` 热注入 / agentArchive 全量档案库 / **存档桥接 `saveWorld()` · `loadWorld()` · `readSaveError()`**（v1.8.0） | Canvas 渲染、DOM 事件 |
| `js/render_canvas.js` | ~226 | **Canvas 主循环调度**（v1.7.1 从 render.js 拆分）：共享变量声明（frameCount/camera 引用/dbg 变量/coronationEffects）/ 马斯洛需求元数据 MASLOW_STYLE / parseMaslowNeed / `render(now)` 主循环骨架（调用各子模块绘制函数）/ requestAnimationFrame 启动 | 具体绘制（委托给 render_world/render_agents/render_inspector/render_hud） |
| `js/render_hud.js` | ~490 | **HUD 与大盘辅助函数**（v1.7.1 拆分）：dbgEl/fmtMB/dbgSetText 调试工具 / updateDebugHud 调试监视器 / updateTopBarStats 顶栏统计 / drawResourceDashboard 全地图资源大盘 / updateGlobalAverages 全局均值大盘 / updateLedgerPanel 家户账本面板 / tickToSec/formatDuration 格式化工具 / updateAgentLedgerInfo 族人家户账本信息 | Canvas 绘制（在 render_canvas/render_world/render_agents） |
| `js/render_world.js` | ~480 | **世界元素绘制**（v1.7.1 拆分）：drawTerrain（3D 地形网格）/ drawPois（POI 渲染与储量指示环）/ drawHouses（私宅渲染）/ drawLanes（动态踩踏道路网络渲染与悬浮 Tooltip） | 共享状态（在 render_canvas）、HUD（在 render_hud） |
| `js/render_agents.js` | ~210 | **族人与特效绘制**（v1.7.1 拆分）：drawAgents（部落民 Agent 渲染 + 选中高亮 + 状态气泡 + 死亡骷髅）/ drawCoronationEffects（登基礼花粒子特效） | 共享状态（在 render_canvas） |
| `js/render_inspector.js` | ~790 | **Inspector 面板与点击拾取**（v1.7.1 拆分）：updateInspector（族人/房屋/POI Inspector 面板 DOM 更新）/ 智能点击拾取事件监听器（排除拖拽平移，多元素重叠循环切换） | Canvas 绘制（在 render_*）、wasm 交互（在 rustworld.js） |
| `js/main.js` | ~574 | 全局初始化 / 相机控制（缩放/平移/跟随）/ 事件绑定（点击拾取/快捷键 Space/Esc/重置按钮/倍速切换）/ 控制台日志 / 无头模式切换 / **★ v1.27.0 启动即暂停**（`sim.isPaused=true`，由 save-ui.js 完成存档连接后解除） | Canvas 绘制（在 render.js）、wasm 交互（在 rustworld.js） |
| `js/entity-link.js` | — | **统一 Agent/房屋实体跳转**：生成实体链接并以唯一捕获阶段委托路由到世界 Inspector | 业务卡片数据、Canvas 绘制 |
| `js/save-ui.js` | ~630 | **读档/存档系统 UI**（v1.11.0）：三槽位（自动槽每 60s 覆盖 + 手动槽 1/2）localStorage 读写、槽位元信息索引、顶栏「💾 存档/📂 读档」面板（保存/读取双标签）、导出 Blob 下载 / 导入 FileReader 校验、读档后自动暂停；**v1.11.0 新增本地文件存档**（File System Access API）：用户连接本地 .json 文件后存档直写磁盘、自动保存同步切换本地模式、不支持浏览器降级到传统导入导出；**★ v1.27.0 启动存档文件门禁**（`bootstrapStartupGate`）：启动层必须先建立/连接可写 `.json` 存档文件（格式版本匹配）才解除模拟暂停，Firefox 等不兼容浏览器保持阻断；**★ v1.28.0 启动自动读档**：已连接自动槽（默认目录 + 默认文件名 `flowaccord-save1.json`，句柄经 IndexedDB 恢复）时打开游戏直接读取其内容续演，读取失败回退手动连接；**★ v1.28.1 权限重授加固**：句柄权限未持久化时不再自动断开/删除 IndexedDB 记录——启动门禁先静默重授（授权已持久化立即成功），失败提供「授权并读取上次存档」按钮（用户手势内 requestPermission），保存/读取遇 NotAllowedError 就地重授重试 | 存档正文序列化（在 rustworld.js + 内核 `world_save.rs`） |
| `js/auction-ui.js` | ~380 | **房屋拍卖交易所与竞价大盘 UI**（v1.15.0）：`#house-auction-modal` 视窗交互 / `_auctionUiTick` 每帧高频驱动 / 麦穗 37% 动态时间轴标尺与当前耐久指针 / 辖区意向买家池扫描 / 实时竞价信息流与裁决 / 历史成交档案 / 视口与族人定位聚焦 / ★ v1.27.0 状态徽章流拍率统计 + 在售房源条固定节点增量更新（内容快照缓存，高倍速点击稳定） | Canvas 绘制（在 render_world） |

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
| `server.js` | ~122 | 静态文件开发服务器（内置 `.wasm` MIME = application/wasm）/ `POST /save-decision-order` 端点（★ v1.27.0 起仅保留兼容迁移，决策顺序保存主路径已迁至浏览器 localStorage）/ 默认 3000 端口 |
| `index.html` | ~895 行 | 单页应用骨架：Canvas 容器 / 顶栏（含存档按钮） / Inspector / 制度大盘 / 决策引擎覆层 / 存档面板 / 族谱模态 / **★ v1.27.0 启动存档门禁层 `#startup-save-gate`**（v1.28.0 起已连接默认存档时自动读档续演；v1.28.1 起权限未持久化不删记录、提供授权按钮重授）/ 21 个 script 标签按序加载 |
| `style.css` | — | 全局样式（顶栏/Inspector/大盘/决策视图/族谱/调试器） |
| `rust/sim_wasm.wasm` | — | WASM 编译产物**主副本**（rustworld.js 实际 fetch 的路径） |
| `sim_wasm.wasm` | — | WASM 编译产物**根目录备用副本** |

---

## 二、脚本加载顺序（index.html，勿打乱）

```
1. math.js                    零依赖基础
2. config.js                  SIM_CONFIG (175 字段，主镜像)
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
14. entity-link.js            统一实体跳转（依赖 main.js）
15. ledger-ui.js              制度大盘
15. save-ui.js                读档/存档系统（v1.8.0）← 依赖 main.js 暴露的 window.rustWorldSim
16. render_canvas.js           Canvas 主循环调度（v1.7.1 拆分）
17. render_hud.js              HUD/大盘辅助函数（v1.7.1 拆分）
18. render_world.js            地形/路网/POI/房屋绘制（v1.7.1 拆分）
19. render_agents.js           族人/特效绘制（v1.7.1 拆分）
20. render_inspector.js        Inspector 面板/点击拾取（v1.7.1 拆分）
21. auction-ui.js              拍卖大盘（最后加载，独立模态）
```

**关键约束**：
- 三个拆分配置/视图文件（3-7：config.decision-order.js、config.house-upgrade-cost.js + 决策三件套）必须在 `rustworld.js`（8）之前——否则 wasm 注入的是不含决策顺序/不含升级成本矩阵的不完整配置
- 改拆分配置 JS（新增全局对象）必须同步：`rustworld.js::applyConfig` 合并逻辑、`tools/config-check.js` 前端字段集、`tools/test-wasm.js` 注入
- **`save-ui.js`（15）必须在 `main.js`（13）之后**——它读取 `window.rustWorldSim`（main.js 第 5 行挂载）调用 `saveWorld()/loadWorld()`
- **render 五件套（16-20）最后加载**，`render_canvas.js` 的 `render(now)` 主循环依赖 `window.rustWorld`、`window.dag`、`window.ledgerUI` 等全局对象；五文件共享全局作用域，函数声明可提升，加载顺序为 canvas→hud→world→agents→inspector

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
| `debug-*` | render_hud.js / main.js | 调试监视器字段 |
| `save-*` / `.save-slot-*` / `.save-tab-btn` | save-ui.js / index.html / style.css | 存档面板与槽位卡片（v1.8.0） |
| `btn-pause` | main.js / save-ui.js | 暂停按钮（`togglePause()` 改文案，save-ui 读档后同步置为「▶️ 继续模拟」） |
| `version-tag` | index.html | 版本徽章（每次发版须更新） |

**搜索方法**：改 ID 前用 `grep -r "旧ID" frontend/` 确认所有引用点。

---

## 五、局部易踩坑

### 5.1 render.js 已拆分为 5 个文件（v1.7.1）

render.js 原 2128 行（800 行规范的 2.6 倍），v1.7.1 拆分为 5 个文件，单文件均 <800 行：
- `render_canvas.js`（~226 行）：共享状态 + 主循环调度骨架
- `render_hud.js`（~490 行）：HUD/调试/资源大盘/均值大盘/账本面板
- `render_world.js`（~480 行）：地形/路网/POI/房屋绘制
- `render_agents.js`（~210 行）：族人绘制 + 登基礼花
- `render_inspector.js`（~790 行）：Inspector 面板 + 点击拾取

**拆分方法**：所有内容在全局作用域，函数声明可提升，多 script 标签共享全局作用域。`render(now)` 主循环保留在 `render_canvas.js` 作为调度骨架，调用其他文件中的绘制函数。

**改"族人渲染"只需读 `render_agents.js`**，改"地形/路网"只需读 `render_world.js`，不用在 2100 行里翻。原 render.js 备份为 `render.js.bak`。

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
2. **决策顺序变更**须先改 `SIM_CONFIG.decisionEvalOrder` / `decisionEvalLevels`，再调 `applyConfig`，最后保存到浏览器 localStorage（★ v1.27.0 起；decision-viz.js 已封装此链路，键 `flowaccord.decision-order.v1`）

直接改 `rustWorld.config` 无效——配置只通过 `applyConfig` 序列化注入 wasm。

### 5.4 agentArchive 全量档案库

`rustWorld.agentArchive: Map<agentId, AgentSnapshot>` 保存**所有出生过的族人**（含已故先祖），用于：
- 族谱系统（dag.js）构建血脉图，不依赖当前存活 agents
- 断代/绝嗣穿梭时不跳帧
- 死亡族人的 Inspector 回溯

**新增 agent 字段时**，除了快照三处同步，还须确认 `agentArchive` 的写入逻辑（在 `_applySnapshot` 中）是否正确归档新字段。

**v1.8.7 墓碑补记**：`_applySnapshot` 消费 `snap.recent_deaths`（死亡/流产墓碑，`_consumedDeathIds` 幂等去重，`initEcology`/`loadWorld` 时清空）——①对档案库滞留"存活"的陈旧副本（高倍速 ≥512x 跨过衰减窗口所致）强制补记 `isAlive=false` + `deathCause`；②流产/随母亡故胎儿以"已故子嗣"身份入档（`isFetus=false`，血缘 `fatherId`/`motherId` 由墓碑携带——高倍速下胎儿整个生命周期可在单帧内，`prevAgents` 取不到，必须靠墓碑保血缘），族谱据此可画"💀 死因: 流产"节点。

### 5.5 镜头跟随与 Inspector 联动

根 AGENTS.md §4.8：选中小人后 `isCameraFollow` 开启，**关闭 Inspector（✕ 或 Esc）时必须同时关闭跟随**。此逻辑在 main.js 的 Esc 键绑定和 Inspector 关闭按钮中。

新增 Inspector 关闭方式（如点击其他 UI 区域）时，须同步调用 `rustWorld.isCameraFollow = false`，否则镜头会持续跟随已取消选中的族人。

### 5.6 决策顺序保存（v1.27.0 起 localStorage 为主）

★ v1.27.0 起决策顺序保存主路径改为浏览器 `localStorage`（键 `flowaccord.decision-order.v1`，schema 1，含 `savedAt`）：静态 COS 与本地开发行为一致，无需写文件；非法/版本不符的覆盖值在启动时丢弃并回退内置默认。`server.js` 的 `POST /save-decision-order` 端点**保留仅作兼容迁移/清理**，不再是正常保存路径。

**不要新增其他写文件端点**——前端定位是纯静态，本地文件写入仅限存档系统（File System Access API 用户手势直写）这一个文档化例外。

### 5.7 WASM 双副本（根 AGENTS.md §4.1）

改 Rust 内核后必须重编译并复制到两个位置：
- `frontend/rust/sim_wasm.wasm`（rustworld.js 实际 fetch 的主路径）
- `frontend/sim_wasm.wasm`（根目录静态备用）

只改前端 JS/CSS/HTML 时**不需要重编译 wasm**，浏览器 Ctrl+F5 即生效。

### 5.8 存档系统的存储配额与读档副作用（v1.11.0）

- 存档正文存在 `localStorage` 的 `flowaccord.save.v1.<slotId>`（3 槽位），**槽位元信息统一放索引键** `flowaccord.save.v1.__index`——元信息若随正文各存一份会双倍占用配额。
- 单份存档约 392 KB（人口增长/账本流水累积后可达数 MB），三槽位约 1.2 MB+；localStorage 单域约 5 MB，`setItem` 抛 `QuotaExceededError` 时必须捕获并提示用户删除旧档或导出备份。
- **v1.11.0 本地文件存档（File System Access API）**：用户通过 `showSaveFilePicker` 连接一个本地 .json 文件后获得 `FileSystemFileHandle`，存档经 `createWritable()` 直写用户磁盘，不受浏览器存储配额限制；已连接本地文件时 `tickAutoSave()` 自动切换为写本地文件而非 localStorage。
- **本地文件句柄不持久化**：页面刷新后 `localFileHandle` 失效（浏览器安全策略），需用户重新连接；状态条和底部提示必须明确告知这一点。
- **权限失效处理**：写入/读取时捕获 `NotAllowedError`，自动 `disconnectLocalFile()` 并提示重新连接，不可静默失败。
- **兼容性降级**：`supportsLocalFileAPI()` 检测 `showSaveFilePicker`/`showOpenFilePicker`，不支持时（Firefox 等）隐藏连接按钮，读取标签下的「选择存档文件」降级到传统 `input[type=file]`，底部提示引导使用 Chrome/Edge。
- `loadWorld()` 成功后会清空 `_trails` / `agentArchive` / `_lastEvent` / `_terrainCached` 并 `deselect()`，**任何新增的派生缓存都必须同步清空**，否则读档后残留旧世界的可视化状态。
- 读档后**不重新注入 `window.SIM_CONFIG`**：存档自带 `SimConfig`，重注入会让前端热调参覆盖存档时的运行参数。
- 自动槽每 60 秒覆盖一次，世界 tick 未推进时跳过（`lastAutoTick` 守卫），暂停时不会空写。

---

## 六、与 Rust 内核的接口对照

| 前端调用 | WASM 导出 | 用途 |
|---|---|---|
| `rustWorld._loadWasm()` | `world_create(grid, size, seed, agentCount, campCount)` | 创建世界实例（campCount 播种前注入，见根 AGENTS.md §4.7） |
| `rustWorld.tick()` / 倍速多步 | `world_tick(dt)` | 推进模拟 |
| `rustWorld.applyConfig(cfg)` | `world_apply_config(jsonPtr, len)` | 热注入配置 |
| `rustWorld._pullSnapshot()` | `world_snapshot()` → 线性内存 JSON | 拉取快照 |
| `rustWorld.saveWorld()` | `world_save_ptr()` + `world_save_len()` | 导出全量存档 JSON（v1.8.0） |
| `rustWorld.loadWorld(json)` | `world_save_buf_ptr(len)` + `world_load(len)` | 载入存档覆盖世界（0 成功 / -1 越界 / -2 非 UTF-8 / -3 解析或校验失败） |
| `rustWorld.readSaveError()` | `world_last_error_ptr()` + `world_last_error_len()` | 读取最近一次存档/读档失败原因 |
| `rustWorld.reset()` | `world_reset(seed)` | 重置世界 |
| 决策顺序写盘 | （无 wasm 接口，纯前端文件） | server.js 原子写 |

wasm 导出函数的完整清单见 `crates/sim_wasm/AGENTS.md`。
