# frontend 模块 · 局部操作指南

> 本目录是原生静态前端：34 个 JS 文件（含 ★ M4 `snapshot-bin.js` 二进制解码器与 ★ v1.50.23 TA-01 装饰三件套 `accent-season.js` / `accent-model.js` / `render_accents.js`）+ index.html + map.html + style.css + map.css + server.js，无构建工具，纯静态文件。
> 改本目录代码前：先读根 AGENTS.md §4（尤其 §4.1 双副本、§4.5 快照四处同步[M4]、§4.14 决策顺序），再读本文件。
> 全局规则以根 AGENTS.md 为准，冲突时以根文档为准。

---

## 0. Agent 交互契约

- 输入：`rustworld.js` 提供的同构快照对象；输出：Canvas、Inspector、制度大盘和决策视图。
- `rustworld.js` 是唯一快照适配层；UI 模块不得直接读取 WASM 或自行解释原始二进制帧。
- 新增 DOM ID、快照字段、枚举标签或交互芯片时，必须同步所有消费者并通过 `node tools/frontend-check.js`。
- 高频 DOM 容器必须使用内容快照缓存；排序展示必须保持与 Rust 相同的稳定顺序。

## 一、文件清单与职责边界

### 1.1 基础层（零业务依赖，最先加载）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/math.js` | ~75 | 3D 向量与投影变换（Vec3 / 世界坐标→屏幕坐标 / 倾斜投影） | 任何业务逻辑 |
| `js/config.js` | ~215 | `window.SIM_CONFIG` 全局数值配置（232 字段，含拆分配置合计），按功能分区注释 | 前端配置文件是数值权威，Rust 负责接收契约 |
| `js/config.poi-rates.js` | ~45 | POI 再生产速倍率的浏览器偏好（键 `flowaccord.poi-regen-rates.v1`）；在 Worker 创世前读取并随 INIT/RESET 传入 | 存档覆盖的既有世界倍率 |
| `js/config.decision-order.js` | ~30 | `window.SIM_DECISION_ORDER`：16 条活动分支顺序 + 层级覆盖。用户调整保存到 `flowaccord.decision-order.v3`；启动时迁移 v2（b11→b8、移除 b15） | Rust 侧默认为空 Vec，不写死顺序（根 AGENTS.md §4.12 例外） |
| `js/config.house-upgrade-cost.js` | ~50 | `window.SIM_HOUSE_UPGRADE_COST`：房屋升级材料成本矩阵 **20 字段**（M8 拆分文件，独立语义避免主配置臃肿），rustworld.js applyConfig 时 Object.assign 合并 | 值须与 Rust `config.rs` 的 house_upgrade_cost_tier* 默认一致（config-check 校验） |
| `js/config.lighting.js` | ~56 | ★ v1.48.0 `window.SIM_LIGHTING`：动态季节光照纯表现层配置（光位/强度/色温/阴影/量化档/限速）。**不并入 SIM_CONFIG**（并入会与 SimConfig 字段集比对冲突），不注入 WASM | 任何模拟行为参数（那些走 SimConfig） |
| `js/config.render.js` | ~28 | ★ v1.50.15 `window.RENDER_CONFIG`：渲染表现层参数（mapZLift 视觉抬升 / 足迹感知深度半径 agentFootprintR·laneFootprintR·poiBase*·poiMarkerFootprintR·accentFootprintR）。**不并入 SIM_CONFIG**（同上互检冲突），不注入 WASM；render_world.js 顶层 `const RC` 消费，须早于其加载 | 渲染深度队列（render_world.js） |
| `js/lighting.js` | ~330 | ★ v1.48.0 `window.SimLighting`：年周期光弧引擎——年度相位推导、视觉限速器、地形整片重着色、面光照、世界空间阴影、天空氛围。**必须在 rustworld.js 与渲染六件套之前加载** | DOM 操作、模拟状态写入、RNG 消费 |

### 1.2 决策引擎视图层（三件套，必须在 rustworld.js 之前加载）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/decision-viz-data.js` | ~75 | `D.BRANCH_MAP`：16 条活动分支的统一中文名、条件文案、默认层级与状态映射；决策卡和 Inspector 共用 | DOM 操作、拖动逻辑 |
| `js/decision-viz-view.js` | ~350 | 决策引擎覆层的 DOM 渲染：Branch 分支卡（含 ID 展示）/分界线/检查器/拖动事件绑定 | 数据来源、配置合并 |
| `js/decision-viz.js` | ~207 | 集成层：`mergeIntoSimConfig()` 把顺序合并进 SIM_CONFIG / 拖动松手→`applyConfig()` 热注入→★ v1.27.0 保存到浏览器 localStorage（schema 1 版本化，含 `savedAt`；非法/版本不符回退默认） | 具体渲染（委托给 view）、具体元数据（委托给 data） |

**加载约束**：三件套必须在 `rustworld.js` 之前加载——`rustworld.js` 构造时会读取 `window.SIM_CONFIG`（已包含合并后的决策顺序）并调用 `applyConfig`。

### 1.3 核心桥接与渲染层

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/snapshot-bin.js` | ~520 | **★ M4 (v1.45.3) FABS 二进制快照解码器**：`window.SnapshotBin.decode(Uint8Array) → 与 JSON 快照逐字段同构的 JS 对象`；维护持久化字符串驻留缓存与枚举名称表（`setEnumTables`/`resetCaches`）。**必须在 rustworld.js 之前加载** | 任何 DOM 操作、Canvas 绘制 |
| `js/sim_worker.js` | ~300 | **仿真内核专用 Web Worker**（★ v1.38.0 Phase 1 解耦）：在独立 Worker 线程加载 WASM 引擎、自适应计时循环驱动 `world_tick_steps`、背压限频下发快照（**★ M4 优先二进制 FABS 帧 `.slice()` 后 `postMessage(transfer)` 转移**，wasm 无导出自动回退 JSON）、管理历史检查点与时光倒流 | 任何 DOM 操作、Canvas 绘制 |
| `js/rustworld.js` | ~600 | **主线程仿真代理层**（★ v1.38.0 改造）：管理 Worker 生命周期、将快照映射为 JS 视图对象（`_applySnapshot`，**★ M4 支持 ArrayBuffer/Uint8Array 入参经 SnapshotBin 解码**）、向 Worker 发送控制指令（暂停/倍速/调参/存读档）、提供同构实体查询接口与档案库 | WASM 底层直接执行（委托给 sim_worker.js） |
| `js/render_canvas.js` | ~232 | **Canvas 主循环调度**（v1.7.1 从 render.js 拆分）：共享变量声明（frameCount/camera 引用/dbg 变量/coronationEffects）/ 马斯洛需求元数据 MASLOW_STYLE / parseMaslowNeed / `render(now)` 主循环骨架（★ v1.48.0 调用顺序：`SimLighting.update` → 天空 → 地形 → 路网 → 贴地图元 → 大气色洗 → `drawWorldEntities()` 统一深度实体 → 礼花）/ requestAnimationFrame 启动 | 具体绘制（委托给 render_world/render_agents/render_inspector/render_hud） |
| `js/render_hud.js` | ~600 | **HUD 与大盘辅助函数**（v1.7.1 拆分）：dbgEl/fmtMB/dbgSetText 调试工具 / updateDebugHud 调试监视器 / updateTopBarStats 顶栏统计 / drawResourceDashboard 全地图资源大盘 / updateGlobalAverages 全局均值大盘 / updateLedgerPanel 家户账本面板 / tickToSec/formatDuration 格式化工具 / updateAgentLedgerInfo 族人家户账本信息 / **★ v1.46.15 未来 49 年气候预测折线图浮窗（Canvas 渲染 + 悬停交互）** | Canvas 绘制（在 render_canvas/render_world/render_agents） |
| `js/render_terrain.js` | ~365 | ★ v1.48.0 从 render_world.js 拆出；★ v1.50.11 深度队列化改造：`drawTerrainShell`（全网格顶点投影 + 沙盘基底 + ★ v1.48.2 按相机距离排序的沙盘侧壁 + ★ v1.48.1 格间抗锯齿缝隙补偿 `TERRAIN_SEAM_PX`）/ `drawTerrainCell`（单格填充，由统一深度队列调度，近处山地格可遮挡远处图标）/ `drawTerrainGrid`（'G' 键调试网格线）/ `drawFeatureItem`（单水系特征：★ v1.50.20 River 走 `drawRiverBand` 单段 clip 填充、RiverBank 单段描边、ShallowFord 浅滩踏石）/ `drawSkyBackdrop`（天空渐变与逆光光晕）/ ★ v1.50.23 TA-01 装饰代码已迁出为 accent 三件套（下方三行） | 立体实体、绘制调度（在 render_world）、HUD、共享状态 |
| `js/accent-season.js` | ~75 | ★ v1.50.23 TA-01（docs/plan/tech/07-terrain-art.md §6.7）：**`window.SimTreeTint` 季相层**——装饰树木季节叶色的唯一生产者（`yearPhase`/`sample`/兼容 `brownness`/`tint`，消费 `RENDER_CONFIG.accentSeason*`）；TA-02 已提供连续叶色/叶量/芽/花/地被曲线。**新增消费方只能读它，不得另建季节色逻辑** | 模型几何（accent-model）、绘制（render_accents） |
| `js/accent-model.js` | ~230 | ★ v1.50.23 TA-01：**`window.AccentModel` 模型层**——稳定形态派生 + 个体模型缓存（全局 `_accentHash` 哈希 / 个体种子 `vSeed` / `extent` 包围体预留）。★ v1.50.25 TA-03：局部三维骨架——Tree = 锥形主干 + 主枝/二级枝（segments 线段）+ 枝端/冠顶/包络叶簇；Bush = 基生细茎 + 叶簇；叶簇带稳定脱落次序 `shed` 与色差通道 `lite`（accent.id 纯函数）；缓存键 `v{accentModelStyleVersion}#kind#id`、上限 2048 条超限清空；`evergreen` 稳定哈希常绿变体（TA-06 前过渡）。`resetCache()` 由 rustworld.js 在 READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 四处调用（换世界不残留旧模型） | 季相曲线（accent-season）、绘制（render_accents） |
| `js/render_accents.js` | ~350 | ★ v1.50.23 TA-01：**装饰绘制层**——`drawAccentEntity` / `drawAccentTree` / `drawAccentBoulder` / `drawAccentBush`，仍由 render_world.js 深度队列以 DEPTH_ACCENT 调度。★ v1.50.25 TA-03：局部三维坐标走与锚点同一套相机投影（含倾干剪切），枝干全年保留，叶簇按 `leafDensity`×`shed` 次序收缩隐藏（禁整冠透明度），簇间画家排序；细节分级近/中/远三档（config.render.js accentDetail*Px）；贴地投影随叶量调制；春芽按 budAmount 绘制。TA-04 世界光向受光将在此接入 | 深度队列调度（render_world）、季相（accent-season） |
| `js/river_life.js` | ~300 | **★ v1.49.0 水系微观生态纯表现层**：`window.RiverLife`——`init(features, seed)`（世界重置/读档时由 rustworld.js 以 `_engineSeed` 重建，4 群 22 条游鱼沿河道中心线巡航）/ `update`（墙钟驱动，暂停时继续流动属设计决策）/ `drawFish` / `drawSunGlint`（迎光波光，强度按河道切线与光向夹角调制）；★ v1.50.3 移除水面微波虚线、★ v1.50.4 移除水底卵石层（`drawRiverbed` 及卵石数据已删除——深色扁圆石透水面观感呈"一堆深蓝色圆圈"）；在 render_terrain.js 之前加载 | 仿真状态读写、WorldRng 消耗、快照契约 |
| `js/render_world.js` | ~700 | **世界元素绘制**（v1.7.1 拆分）：**★ v1.50.11 `drawWorldEntities()` 世界统一深度队列**（地形格 + 水系特征 + 游鱼/波光 + 道路 16 分段（`lineDashOffset` 虚线相位跨段连续）+ 营地辖区连线 + POI 底座 + POI 标记 + 房屋 + 族人 + 地表装饰，全部按 `depth = ry·sinX + z·cosX` 升序远 → 近落笔，深度项走持久对象池 `_depthPool` 零每帧 GC）/ `updateLaneHover`（道路悬浮检测 + Tooltip）/ `cacheLaneStyle` + `drawLaneSegment`（道路样式缓存与单段描边）/ drawPoiMarker（POI 图标/门牌/储量环）/ drawHouse（私宅 2.5D 微缩模型，★ v1.48.0 面法线受光 + 世界空间阴影） | 共享状态（在 render_canvas）、HUD（在 render_hud） |
| `js/render_agents.js` | ~217 | **族人与特效绘制**（v1.7.1 拆分）：**★ v1.47.9 drawAgent（单实体绘制入口，由 `drawWorldEntities` 统一深度调度）** + 选中高亮 + 状态气泡 + 墓石 / drawCoronationEffects（登基礼花粒子特效） | 共享状态（在 render_canvas）、绘制调度（在 render_world 的 drawWorldEntities） |
| `js/render_inspector.js` | ~790 | **Inspector 面板与点击拾取**（v1.7.1 拆分）：updateInspector（族人/房屋/POI Inspector 面板 DOM 更新）/ 智能点击拾取事件监听器（排除拖拽平移，多元素重叠循环切换） | Canvas 绘制（在 render_*）、wasm 交互（在 rustworld.js） |
| `js/main.js` | ~574 | 全局初始化 / 相机控制（缩放/平移/跟随）/ 事件绑定（点击拾取/快捷键 Space/Esc/重置按钮/倍速切换）/ 控制台日志 / 无头模式切换 / **★ v1.27.0 启动即暂停**（`sim.isPaused=true`，由 save-ui.js 完成存档连接后解除） | Canvas 绘制（在 render.js）、wasm 交互（在 rustworld.js） |
| `js/entity-link.js` | — | **统一 Agent/房屋实体跳转**：生成实体链接并以唯一捕获阶段委托路由到世界 Inspector | 业务卡片数据、Canvas 绘制 |
| `js/save-ui.js` | ~630 | **读档/存档系统 UI**（v1.11.0）：三槽位（自动槽每 60s 覆盖 + 手动槽 1/2）localStorage 读写、槽位元信息索引、顶栏「💾 存档/📂 读档」面板（保存/读取双标签）、导出 Blob 下载 / 导入 FileReader 校验、读档后自动暂停；**v1.11.0 新增本地文件存档**（File System Access API）：用户连接本地 .json 文件后存档直写磁盘、自动保存同步切换本地模式、不支持浏览器降级到传统导入导出；**★ v1.27.0 启动存档文件门禁**（`bootstrapStartupGate`）：启动层必须先建立/连接可写 `.json` 存档文件（格式版本匹配）才解除模拟暂停，Firefox 等不兼容浏览器保持阻断；**★ v1.28.0 启动自动读档**：已连接自动槽（默认目录 + 默认文件名 `flowaccord-save1.json`，句柄经 IndexedDB 恢复）时打开游戏直接读取其内容续演，读取失败回退手动连接；**★ v1.28.1 权限重授加固**：句柄权限未持久化时不再自动断开/删除 IndexedDB 记录——启动门禁先静默重授（授权已持久化立即成功），失败提供「授权并读取上次存档」按钮（用户手势内 requestPermission），保存/读取遇 NotAllowedError 就地重授重试；**★ v1.50.8 `?nogate=1` 门禁旁路**：URL 携带 `nogate` query 参数（任意值）时直接隐藏门禁并解除暂停，不连接存档（自动保存对空句柄 no-op，仅内存演算，供截图/演示/自动化场景） | 存档正文序列化（在 rustworld.js + 内核 `world_save.rs`） |
| `js/auction-ui.js` | ~380 | **房屋拍卖交易所与竞价大盘 UI**（v1.15.0）：`#house-auction-modal` 视窗交互 / `_auctionUiTick` 每帧高频驱动 / 麦穗 37% 动态时间轴标尺与当前耐久指针 / 辖区意向买家池扫描 / 实时竞价信息流与裁决 / 历史成交档案 / 视口与族人定位聚焦 / ★ v1.27.0 状态徽章流拍率统计 + 在售房源条固定节点增量更新（内容快照缓存，高倍速点击稳定） | Canvas 绘制（在 render_world） |

### 1.4 族谱系统（四件套，独立标签页）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/dag-layout.js` | ~362 | 族谱时间轴布局数学（**纯函数，零 DOM**）：Y=出生 tick 线性映射（亲子最小间距约束密度下限）/ X 冲突横向扩展 / 视口虚拟化 LOD / 时间刻度尺计算 | Canvas 渲染、数据构建 |
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
| `index.html` | ~895 行 | 单页应用骨架：Canvas 容器 / 顶栏（含存档按钮） / Inspector / 制度大盘 / 决策引擎覆层 / 存档面板 / 族谱模态 / **★ v1.27.0 启动存档门禁层 `#startup-save-gate`**（v1.28.0 起已连接默认存档时自动读档续演；v1.28.1 起权限未持久化不删记录、提供授权按钮重授）/ 30 个 script 标签按序加载（★ M4 含 `js/snapshot-bin.js`） |
| `style.css` | — | 全局样式（顶栏/Inspector/大盘/决策视图/族谱/调试器） |
| `rust/sim_wasm.wasm` | — | WASM 编译产物**主副本**（rustworld.js 实际 fetch 的路径） |
| `sim_wasm.wasm` | — | WASM 编译产物**根目录备用副本** |

### 1.7 独立页面（地图图鉴，★ v1.50.0）

| 文件 | 行数 | 职责 |
|---|---|---|
| `map.html` / `map.css` | ~65 / ~90 | **独立只读地图页**：将正式游戏的 Canvas 视图嵌入 `?mapOnly=1&nogate=1` 模式；地图页自身不创建实体、不读写存档，叠加种子控件与说明。 |
| `js/map-view.js` | ~45 | 地图图鉴编排脚本：把种子更新为 `index.html?seed=<n>&mapOnly=1&nogate=1` 内嵌页，随机换种子并同步「在正式游戏中使用此种子」链接。 |

**同种子契约**：`mapOnly=1` 经 `rustworld.js → sim_worker.js → sim_wasm::world_create_map` 调用与正式游戏相同的 `World3DEngine::new_seeded_with_config` / `TerrainMap::generate_with_config`；但不调用 `seed_primitive_ecology`，故地图页只含地形、水系和自然装饰，绝不能自行实现哈希噪声或模板绘制。

---

## 二、脚本加载顺序（index.html，勿打乱）

```
1. math.js                    零依赖基础（含 computeTerrainAlbedo 反照率/光照分解）
2. config.js                  SIM_CONFIG (232 字段，含拆分配置合计)
3. config.poi-rates.js        localStorage POI 产速偏好（创世前读取）
4. config.decision-order.js   SIM_DECISION_ORDER (合并进 SIM_CONFIG)
5. config.house-upgrade-cost.js SIM_HOUSE_UPGRADE_COST (M8 升级成本矩阵 20 字段，applyConfig 时合并)
6. config.lighting.js         ★ v1.48.0 SIM_LIGHTING 动态季节光照前端配置（纯表现层，不注入 WASM）
7. config.render.js           ★ v1.50.15 RENDER_CONFIG 渲染表现层参数（视觉抬升/足迹深度半径，须早于 render_world.js）
8. lighting.js                ★ v1.48.0 年周期光弧引擎 SimLighting（须早于 rustworld.js 与渲染六件套）
8. decision-viz-data.js       分支元数据
9. decision-viz-view.js       决策视图 DOM 渲染
10. decision-viz.js           集成层: mergeIntoSimConfig() ← 此时 SIM_CONFIG 才完整
11. snapshot-bin.js           ★ M4 FABS 二进制快照解码器（必须在 rustworld.js 之前）
12. rustworld.js              构造时读取 SIM_CONFIG 并 applyConfig ← 必须在配置、决策三件套及 snapshot-bin 之后
13. dag-layout.js             族谱布局数学
14. dag-view.js               族谱渲染
15. dag-standalone.js         族谱独立页模板
16. dag.js                    族谱数据构建+编排
17. main.js                   事件绑定+初始化
18. entity-link.js            统一实体跳转（依赖 main.js）
19. ledger-ui.js              制度大盘
20. save-ui.js                读档/存档系统（v1.8.0）← 依赖 main.js 暴露的 window.rustWorldSim
21. render_canvas.js          Canvas 主循环调度（v1.7.1 拆分）
22. river_life.js             水系微观生态纯表现层（★ v1.49.0，须早于 render_terrain.js）
23. accent-season.js          ★ v1.50.23 TA-01 装饰季相层（window.SimTreeTint 唯一生产者）
24. accent-model.js           ★ v1.50.23 TA-01 装饰模型层（window.AccentModel 缓存，须早于 render_accents.js）
25. render_terrain.js         地形网格/水系特征/天空氛围（★ v1.48.0 从 render_world.js 拆出）
26. render_accents.js         ★ v1.50.23 TA-01 装饰绘制层（drawAccentEntity 等，早于 render_world.js）
27. render_hud.js             HUD/大盘辅助函数（v1.7.1 拆分）
28. render_world.js           路网/POI/房屋/世界实体统一深度队列（v1.7.1 拆分）
29. render_agents.js          族人/特效绘制（v1.7.1 拆分）
30. render_inspector.js       Inspector 面板/点击拾取（v1.7.1 拆分）
31. auction-ui.js             拍卖大盘（最后加载，独立模态）
```

**关键约束**：
- 配置/视图准备文件（3-10：config.poi-rates.js、config.decision-order.js、config.house-upgrade-cost.js、config.lighting.js、lighting.js + 决策三件套）必须在 `rustworld.js`（12）之前——否则创世没有持久 POI 产速，或 WASM 注入的是不含决策顺序/升级成本矩阵的不完整配置
- ★ M4 `snapshot-bin.js`（11）必须在 `rustworld.js`（12）之前——否则 READY 首个二进制快照无法解码
- ★ v1.48.0 `config.lighting.js`（6）与 `lighting.js`（7）必须早于 `rustworld.js`——`_applySnapshot` 建地形缓存时会调用 `SimLighting.markDirty()`，缺失则首帧不重着色
- 改拆分配置 JS（新增全局对象）必须同步：`rustworld.js::applyConfig` 合并逻辑、`tools/config-check.js` 前端字段集、`tools/test-wasm.js` 注入
- **`save-ui.js`（18）必须在 `main.js`（15）之后**——它读取 `window.rustWorldSim`（main.js 第 5 行挂载）调用 `saveWorld()/loadWorld()`
- **渲染系列（21-30）最后加载**，`render_canvas.js` 的 `render(now)` 主循环依赖 `window.rustWorld`、`window.dag`、`window.ledgerUI` 等全局对象；共享全局作用域，函数声明可提升，加载顺序为 canvas→river_life→accent-season→accent-model→terrain→accents→hud→world→agents→inspector

---

## 三、数据流与渲染管线

```
WASM 内核 (sim_wasm.wasm)
    │  world_tick(dt) 每帧调用
    ▼
★ M4 FABS 二进制帧（sim_worker.js slice + transfer；wasm 无导出则回退 JSON）
    │  SnapshotBin.decode()（snapshot-bin.js）
    ▼
rustworld.js::_applySnapshot(snap)
    │  映射为 JS 对象（车道/节点按 geom_version 缓存，仅覆写 wear）
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
         ├─→ ledger-ui.js::switchTab/render      制度大盘四标签页（家户账本面板亦由此处接管）
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
| `chk-dynamic-light` | main.js / index.html / style.css | ★ v1.48.0 动态季节光照开关（`L` 键同源触发，`change` 事件热切换） |
| `stat-sun` | render_hud.js / index.html | ★ v1.48.0 当前光位读数（方位 + 高度角） |
| `dbg-light-ms` / `dbg-light-phase` | render_hud.js / index.html | ★ v1.48.0 光照重着色耗时与光相/光档调试读数 |
| `version-tag` | index.html | 版本徽章 · **版本号唯一真相源**（由 `node tools/bump-version.js --patch` 自动同步至 SAVE_APP_VERSION 等全部定义点，勿手工改） |

**搜索方法**：改 ID 前用 `grep -r "旧ID" frontend/` 确认所有引用点。

---

## 五、局部易踩坑

### 5.1 render.js 已拆分为 5 个文件（v1.7.1）· v1.48.0 再拆出 render_terrain.js

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

### 5.2 快照四处同步（★ M4 起；根 AGENTS.md §4.5）

给 agent/house/poi 新增快照字段时，必须 **★ M4 起四处同步**：
1. `crates/sim_core/src/spatial/snapshot.rs` — 结构体定义
2. `crates/sim_core/src/spatial/world.rs` — `generate_snapshot()` 赋值（JSON 通道）
3. `crates/sim_core/src/spatial/snapshot_bin/encode.rs` — `write_snapshot_binary()`（M4 FABS 二进制编码，字段顺序/码位须与 1、2 等价）
4. `frontend/js/snapshot-bin.js`（解码）+ `frontend/js/rustworld.js`（`_applySnapshot()` 映射）

**前端消费方**可能还包括 render.js / ledger-ui.js / decision-viz-view.js / dag.js，需同步更新读取逻辑。

遗漏任何一处都会导致前端 `undefined` 或展示旧值；防漂移自动网 = `node tools/test-snapshot-bin.js`（二进制 ≡ JSON 逐字段深比较）。

> ★ M4 相关派生缓存：`snapshot-bin.js` 维护跨帧字符串驻留缓存（引擎重建/读档/重置时必须调用 `SnapshotBin.resetCaches()`，rustworld 已在 READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 处理器调用）；**★ v1.46.0 起解码器自身也用 `STR_TAB.start_index == 0` 判「全新驻留表」自动清缓存**——判据**不能**用 `strtab_epoch`（新世界恒为 0，会导致换世界后 id→字符串串味，见根 AGENTS.md §4.5.1）；`rustworld.js` 维护车道/节点几何缓存（`_laneCache`/`_geomVersion`），增量帧（`snap.lanes===null`）只覆写 `wear`。

### 5.3 配置热注入的时序

`rustWorld.applyConfig(cfg)` 支持运行中热注入，但有两个约束：
1. **必须在 wasm 加载完成后**（`this._ready === true`），否则静默返回 false
2. **决策顺序变更**须先改 `SIM_CONFIG.decisionEvalOrder` / `decisionEvalLevels`，再调 `applyConfig`，最后保存到浏览器 localStorage（★ v1.27.0 起；decision-viz.js 已封装此链路，★ v1.29.0 起键 `flowaccord.decision-order.v2`）

直接改 `rustWorld.config` 无效——配置只通过 `applyConfig` 序列化注入 wasm。

### 5.4 agentArchive 全量档案库

`rustWorld.agentArchive: Map<agentId, AgentSnapshot>` 保存**所有出生过的族人**（含已故先祖），用于：
- 族谱系统（dag.js）构建血脉图，不依赖当前存活 agents
- 断代/绝嗣穿梭时不跳帧
- 死亡族人的 Inspector 回溯

**新增 agent 字段时**，除了快照四处同步，还须确认 `agentArchive` 的写入逻辑（在 `_applySnapshot` 中）是否正确归档新字段。

**v1.8.7 墓碑补记**：`_applySnapshot` 消费 `snap.recent_deaths`（死亡/流产墓碑，`_consumedDeathIds` 幂等去重，`initEcology`/`loadWorld` 时清空）——①对档案库滞留"存活"的陈旧副本（高倍速 ≥512x 跨过衰减窗口所致）强制补记 `isAlive=false` + `deathCause`；②流产/随母亡故胎儿以"已故子嗣"身份入档（`isFetus=false`，血缘 `fatherId`/`motherId` 由墓碑携带——高倍速下胎儿整个生命周期可在单帧内，`prevAgents` 取不到，必须靠墓碑保血缘），族谱据此可画"💀 死因: 流产"节点。

### 5.5 镜头跟随与 Inspector 联动

根 AGENTS.md §4.8：选中小人后 `isCameraFollow` 开启，**关闭 Inspector（✕ 或 Esc）时必须同时关闭跟随**。此逻辑在 main.js 的 Esc 键绑定和 Inspector 关闭按钮中。

新增 Inspector 关闭方式（如点击其他 UI 区域）时，须同步调用 `rustWorld.isCameraFollow = false`，否则镜头会持续跟随已取消选中的族人。

### 5.6 决策顺序保存（v1.27.0 起 localStorage 为主）

★ v1.27.0 起决策顺序保存主路径改为浏览器 `localStorage`（★ v1.29.0 起键 `flowaccord.decision-order.v2`，schema 1，含 `savedAt`；启动时自动迁移旧键 v1 的 0→6 编码）：静态 COS 与本地开发行为一致，无需写文件；非法/版本不符的覆盖值在启动时丢弃并回退内置默认。`server.js` 的 `POST /save-decision-order` 端点**保留仅作兼容迁移/清理**，不再是正常保存路径。

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

### 5.9 世界图层顺序与统一相机深度绘制（★ v1.47.9 建立 / ★ v1.50.11 地形格并入）

- **固定图层顺序**（`render_canvas.js::render`，★ v1.50.11 起收敛为四步）：`SimLighting.update()` → `drawSkyBackdrop` → `drawTerrainShell`（全网格顶点投影 + 沙盘基底/侧壁）→ **`drawWorldEntities`（世界统一深度队列，内含道路悬浮检测与 Tooltip）** → `drawTerrainGrid`（'G' 键调试网格线，0.04 透明度叠加层）→ `drawCoronationEffects`。旧管线中独立的「地形格整层 / 路网 / POI 底座 / 大气色洗」四个 pass 全部并入统一深度队列或烘焙进地形色——**严禁恢复任何「整层先画」调用**（已有三次历史教训：v1.47.8 房屋、v1.50.2 装饰、v1.50.11 之前图标透山）。
- **★ v1.50.11 世界统一深度队列（核心契约）**：Canvas 2D 无深度缓冲，`render_world.js::drawWorldEntities()` 每帧把**地形格（`drawTerrainCell`，深度 = 四角 world 坐标均值）、水系特征（★ v1.50.20 河面按剖分区间逐段入队，段深度 = 段四角最大相机深度；RiverBank 逐段描边；ShallowFord/波光挂所在段深度 + ε）、游鱼（逐条）、道路（16 分段，`lineDashOffset` 按累计弧长保持虚线相位跨段连续）、营地辖区连线（中点近似深度）、POI 底座（−0.01 ε 垫在自己标记下）、POI 标记 / 房屋 / 族人（`render_agents.js::drawAgent`）/ 地表装饰（`render_accents.js::drawAccentEntity`）** 全部收进同一个列表，按 `depth = ry·sinX + z·cosX`（数值越大越靠近视点）**升序**绘制（远 → 近）；同深度保持收集原序（`Array.sort` 稳定）维持渲染确定性。深度项走持久对象池 `_depthPool`（零每帧 GC）。地形格与实体同队列后，**近处山地格与河道才能正确遮挡更远的图标**（v1.50.11 修复「图标透过山体可见」），同时修正了相机旋转下地形格行主序绘制导致的自遮挡隐患。
- **★ v1.50.20 河面必须分段入队（勿回退）**：River 水面整条多边形若以「全顶点最大相机深度」单坑入队（v1.50.11 做法），河道任一岸段靠近相机时整条河就排到队尾、盖住所有更远的树/房/POI/族人（用户可见症状：「河流叠加在树和房子上」）。现在水面按剖分区间逐段入队（河道 outline 是「左岸 N 点顺去 + 右岸 N 点逆回」闭合带，顶点 `i` 与 `vLen−1−i` 同为第 `i` 断面；段四角 = `v[b]/v[b+1]/v[vLen−2−b]/v[vLen−1−b]`），绘制走 `render_terrain.js::drawRiverBand`：**clip 到段四边形内、再整多边形两遍填充**——硬 clip 逐像素归属唯一一段 ⇒ 无接缝、无半透明叠 blend，观感与整河填充一致；RiverBank 同理逐段描边；涉渡/波光挂所在段深度 + ε（二分左岸单调 y 定位段）。新增「沿河长条状贴地特征」时一律沿用此分段模式。
- **新增世界实体/贴地图元必须挂进同一队列**：在 `drawWorldEntities()` 收集阶段登记种类 + 提供单实体绘制函数即可，**严禁**在 `render()` 里新增独立的整层绘制调用。注意深度键约定：立体实体用锚点（`pos`/裸 `x/y/z`）深度；跨大深度区间的面状元素（河道等）用「顶点最大深度」近似；贴地装饰性线条（辖区连线）允许中点近似。
- **★ v1.50.11 大气色洗已烘焙进地形色**：色洗原先是「贴地图元之后、立体实体之前」的整屏 `fillRect`，实体与地形格交错落笔后会把实体一起洗灰——现按同一公式（当季 tint × `skyWash` × 浅色主题 0.55 系数）在 `lighting.js::relightTerrain()` 写回 `cell.color` 时混入，观感不变且零每帧成本；旧固定光对照路径（`enabled=false`）无色洗。`drawAtmosphereWash()` 函数已删除，勿在文档外恢复。
- **★ v1.48.1 地形格间抗锯齿缝隙（勿回退）**：Canvas2D 逐格填充时，相邻格共享边各自只覆盖约一半像素，叠加后仍有约 25% 透光率，深色天空背景会从缝隙透出、整片地形浮现 1px 深色网格（用户可见症状：「地形漏出后面的边界线条」）。`drawTerrainCell` 因此对每格的四条边沿**各自外法线**外扩 `TERRAIN_SEAM_PX`(0.75px) 后再填充——外法线由边向量归一化 + 质心方向定向外，**必须逐格计算**（地形起伏会改变屏幕空间边方向，用全图固定法线会在陡坡处漏缝）。删掉该补偿即复现网格线。
- **★ v1.50.12/v1.50.13 贴面防埋修正（勿回退）**：格深度取**格心**（四角均值），实体/道路锚点落在所在格**远半侧**时格心深度 > 锚点深度，脚下的格子反而后画、把 POI/装饰/族人/房屋/道路的下半截盖住（格间距 ≈12.9 世界单位，远半侧深度差可达 ~6）。修正分两层：① **深度层**——`_surfaceDepth()` 把七类非地形项（道路分段/营地连线/POI 底座〔再减 0.01 垫标记下〕/POI 标记/房屋/装饰/族人）的排序深度抬到「所在格心 + `SURFACE_EPS`(0.05)」之上（`_ownCellCenterDepth()` 由世界坐标反查所在格），自己的格子永远先画；★ v1.50.13 起贴地**面状/线状**图元（POI 底座 r=Camp 16+3·level/资源 12、POI 标记 r=20、装饰 r=8、道路分段两端+中点三采样）进一步走 **`_decalDepth()` 足迹感知深度**——`_surfaceDepth` 只保证所在格先画，而底座圆/储量环/路面会**触及相邻更近格**，触及格的后画仍盖掉下半（「POI 底座/道路半截入土」残余根因）；足迹感知对足迹外的真山体深度仍是真值，**近山遮挡远图标不受影响**；② **视觉层**——立体精灵（POI 标记/房屋/族人/装饰）绘制锚点经 `projectLifted()` / `MAP_Z_LIFT`(4.0 世界单位) 略抬于地表；★ v1.50.13 锚点几何修正：**精灵必须「底边贴锚点」向上画**——`drawAccentBoulder` 七边形原以锚点为中心（下半沉入 1.04r）、已整体上移 r；`drawAccentBush` 瓣簇已上移 0.55r（贴地微投影留地表）；新增精灵图形时落笔范围必须在锚点之上，中心对称图形先平移再画。**贴地元素（道路/底座/水面/足迹线/目标指示环）禁止抬升**，否则路面与底座会在坡面上悬空。新增入队元素时：排序深度按「点状 → `_surfaceDepth`；面状/线状 → `_decalDepth`」判定。
- **★ v1.50.15 族人/道路足迹深度强化 + config.render.js（勿回退）**：① **族人**——`drawAgent` 的人偶圆/受孕环/施工环/选中环**以锚点为中心**（下方笔迹最大 ~9px），且装饰环多不适合逐个改几何，故排序深度直接走 `_decalDepth(r=18)`（rotX 默认 1.05 即 cosX≈0.5，地面屏幕压缩近半 ⇒ 锚点下方 N px ≈ 朝相机 2N 世界单位）；② **道路分段**——深度改 **5 采样 × `_decalDepth(r=6)`** 取最大（v1.50.13 的 3 采样 `_surfaceDepth` 两缺口：路拱半宽朝相机侧伸入的**下一格**未覆盖；整赛道仅 16 分段、长路段跨 3+ 格时中段触格漏采）；③ **渲染参数独立配置**——`config.render.js` / `window.RENDER_CONFIG`（mapZLift、agentFootprintR、laneFootprintR、poiBaseCampR(+PerLevel)、poiBaseResourceR、poiMarkerFootprintR、accentFootprintR），**严禁把渲染参数写进 config.js**（与 Rust SimConfig 严格互检、孤儿键报错），须在 render_world.js 之前加载；render_world.js 顶层 `const RC = window.RENDER_CONFIG || {}` 消费，全部读点带缺省回退。
- **★ v1.50.14 边界侧壁并入统一深度队列（勿回退）**：四面沙盘侧壁（`BOUNDARY_WALLS`）是地图边界处**最靠近相机的几何**——贴边实体（POI 底座/储量环/图标、房屋、道路）伸过边界线的部分必须被侧壁盖住。v1.50.11 把地形格并入深度队列时侧壁曾留在壳层先行栅格化，导致「贴边 POI/房屋盖在侧壁之上」（用户可见症状）。现侧壁按**边界格分段**经 `DEPTH_WALL`(11) 入队：单段入口 `render_terrain.js::drawBoundaryWallSeg(wd, k)`（整墙 `drawBoundaryWall` 与壳层 `_wallDrawOrder` 排序已移除；下垂参数 `_wallSkirtElev/_wallElevDrop` 由 `drawTerrainShell` 每帧暂存），段深度 = 上沿两端顶点深度的**较大值**（较近端）——墙面垂直下垂只减 z 不改 ry，用上沿较近端代表整段是「遮挡从严」的安全近似。侧壁分段与地形格/实体同队列排序后，北墙段深度最小最先画（北侧远树仍后画不被盖，无回退），南墙段深度最大最后画（盖住一切贴南边界的越界笔迹）。严禁把侧壁画回壳层。

### 5.10 动态季节光照契约（★ v1.48.0）

- **光相唯一来源 = 快照**：`SimLighting.phaseFromSnapshot()` 只消费 `sim.currentSeason` + `sim.seasonProgress`（缺字段回退 `seasonTimer / seasonYearLength`）。**严禁**前端另建计时器或按 `Date.now()` 推季节——那会与内核的气温、供暖、浆果霜冻形成两套季节事实。
- **一年一圈**：年度相位 `u = (seasonIdx - 0.5 + seasonProgress) / 4`；方位 `β = 360°u + 90°`（春=东 / 夏=南 / 秋=西 / 冬=北，季分箱中心恰为正方向），高度角 `e = 47° + 25°·sin(2πu)`（盛夏 72°、隆冬 22°）。
- **地形重着色必须走光档量化**：`rustworld.js::_applySnapshot` 建地形缓存时预存 `nx/ny/nz`（单位法线）+ `albR/G/B`（无光反照率）+ `ao`，`SimLighting.relightTerrain()` 仅在光档（`lightStepsPerYear`，默认 144 档/年）变化时整片重算并**原地写回 `cell.color`**；`drawTerrain` 不感知光照，禁止在绘制循环里逐格生成颜色字符串。
- **视觉限速器**：仿真角速度超过 `rateCapDegPerSec`（默认 90°/s，最快 4 秒一圈）时按限速跟随，相位误差超过半圈直接对齐——高倍速下不得出现频闪。
- **时间跳变必须 `resync()`**：`rustworld.js` 在 `READY / LOAD_RESULT / REWIND_RESULT / RESET_DONE` 四处已调用；新增任何重建世界的入口都要补上，否则光相会从上一世界缓慢爬回来。
- **阴影用世界空间**：`lightShadowOffset()`（render_world.js）与 `SimLighting.shadowOffset()` 把世界光向投影到屏幕（随相机 `rotZ/rotX` 旋转）；**禁止**再写死屏幕偏移。
- **纯表现层边界**：不消耗 `WorldRng`、不写模拟状态、不进存档、不参与逐字节确定性承诺；`enabled=false` 必须退回 v1.47.11 的固定光（西北 41°）以便 A/B 对照。
- 详细设计与验收见 [../docs/current/tech/17-seasonal-lighting.md](../docs/current/tech/17-seasonal-lighting.md)。

### 5.11 装饰树季节叶色契约（★ 2026-09-12 落地，修复长期死分支）

- **背景（勿重犯）**：v1.48.0~2026-09-12 期间 `drawAccentEntity` 一直写作
  `if (window.SimTreeTint && sim.treeTintEnabled !== false) { … }`，但 **`window.SimTreeTint` 全仓没有任何赋值点**，
  判断用的 `sim.treeTintEnabled` 来源字段 `terrainTreeSeasonTint` 又在 v1.50.18 被清理
  → 条件恒假、分支永不进入，树木叶色恒等于 `accent.tint`，而 Rust `geo/accents.rs` 恒写 `tint: 0`
  → **四季渲染完全相同**（文档却一直声称"按当前季节实时派生"）。
- **唯一生产者 = `window.SimTreeTint`**（`accent-season.js`）：`sample(accent, sim, profile?)` 输出连续季相，绘制树木与灌木都只读它；`tint()`/`brownness()` 为同一套曲线的兼容接口，不另建年历。
- **真相源 = 原始快照**：`currentSeason` + `seasonProgress`，缺字段回退 `seasonTimer / seasonYearLength`；春中心为 0，初春为 0.875。不能用经限速的 `SimLighting.phase()` 决定叶量，更不能用墙钟。
- **周期曲线**：参数集中在 `config.render.js` 的 `accentSeasonProfiles` / `accentFlowerCycle`；跨年 smoothstep 插值，输出浮点 RGB 反照率及 0–1 叶量/芽量/花量/地被量。默认 Tree/Bush 分别使用落叶乔木/灌木曲线；`evergreen` 与 `floweringBush` 为显式 profile 接口，物种自动分配留给 TA-06。
- **有界个体偏移**：kind/id 独立哈希通道 997/998，`accentSeasonJitterTurns` 默认 ±0.025 年、硬限幅 ±0.04；共同盛夏满叶、隆冬落叶 3–4% 平台避免错季。常绿曲线全年保留至少 94% 叶量。
- **消费边界**：现有二维树冠与灌木已消费连续叶色；★ v1.50.25 TA-03 起叶量由几何消费——叶簇按 `leafDensity`×稳定 `shed` 次序收缩隐藏（枝干全年保留，冬季落叶树余 0~5% 叶量，禁整冠透明度），芽量绘制为枝端芽点；花量/地被落叶待 TA-06/15，暂无开花、落叶地被或飘叶绘制。禁止把整冠透明度当作落叶。
- **缓存与恢复**：季相按输入直接求值，不保存历史结果；几何缓存不含季相，恢复/读档/回溯自动按新快照重建颜色。暂停时输入不变，输出不漂移。
- **纯表现层**：不消耗 WorldRng，不写模拟/快照/存档；Boulder 保持原配色，Rust `TerrainAccent.tint` 仍是恒 0 的预留字段，植被不读它。

---

## 六、与 Rust 内核的接口对照

| 前端调用 | WASM 导出 | 用途 |
|---|---|---|
| `rustWorld._loadWasm()` | `world_create(grid, size, seed, agentCount, campCount)` | 创建世界实例（campCount 播种前注入，见根 AGENTS.md §4.7） |
| `rustWorld.tick()` / 倍速多步 | `world_tick(dt)` | 推进模拟 |
| `rustWorld.applyConfig(cfg)` | `world_apply_config(jsonPtr, len)` | 热注入配置 |
| `sim_worker.pullSnapshot()` | ★ T1/M5 `world_snapshot_bin_ptr/len` → 唯一 FABS 二进制帧（`.slice()` 拷出 + `postMessage(transfer)`）；不再存在生产 JSON 回退 | 拉取快照 |
| `SnapshotBin.setEnumTables()` | `world_enum_table_ptr/len` → 枚举名称表 JSON | M4 解码枚举码位（单一真相源，杜绝前后端漂移） |
| `rustWorld.saveWorld()` | `world_save_ptr()` + `world_save_len()` | 导出全量存档 JSON（v1.8.0） |
| `rustWorld.loadWorld(json)` | `world_save_buf_ptr(len)` + `world_load(len)` | 载入存档覆盖世界（0 成功 / -1 越界 / -2 非 UTF-8 / -3 解析或校验失败） |
| `rustWorld.readSaveError()` | `world_last_error_ptr()` + `world_last_error_len()` | 读取最近一次存档/读档失败原因 |
| `rustWorld.reset()` | `world_reset(seed)` | 重置世界 |
| 决策顺序写盘 | （无 wasm 接口，纯前端文件） | server.js 原子写 |

wasm 导出函数的完整清单见 `crates/sim_wasm/AGENTS.md`。
