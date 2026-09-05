# Flow & Accord · UI 页面全景剖析、制度大盘界面实现与开发指南

> **版本**：v1.15.0 · **定位**：前端 UI 全景解剖说明书 + 制度经济学界面实现说明（M1~M4 全部落地）+ 模块开发落地指南  
> **关联规划**：[`docs/12-plan-ledger-refactor.md`](./12-plan-ledger-refactor.md) · [`docs/current/07-frontend-ui.md`](./current/07-frontend-ui.md) · [`docs/current/12-ledger-system.md`](./current/12-ledger-system.md)

---

## 目录 (Table of Contents)

1. [📖 第一篇：当前 UI 页面全景剖析（现状拆解）](#1-第一篇当前-ui-页面全景剖析现状拆解)
   - 1.1 [画布视口与 3D 渲染层 (Canvas Viewport)](#11-画布视口与-3d-渲染层-canvas-viewport)
   - 1.2 [顶部玻璃拟态状态栏 (.top-bar)](#12-顶部玻璃拟态状态栏-top-bar)
   - 1.3 [左侧全局生态大盘与产速控制台 (.global-resource-panel)](#13-左侧全局生态大盘与产速控制台-global-resource-panel)
   - 1.4 [右侧动态观察堆栈 (.right-panel-stack)](#14-右侧动态观察堆栈-right-panel-stack)
   - 1.5 [底部生态时钟、控制台与调试监视器 (.control-panel & .debug-hud)](#15-底部生态时钟控制台与调试监视器-control-panel--debug-hud)
   - 1.6 [右下角重大历史事件滚动日志 (.event-log)](#16-右下角重大历史事件滚动日志-event-log)
   - 1.7 [模态弹窗系统 (Modal System)](#17-模态弹窗系统-modal-system)
   - 1.8 [存档管理面板 (Save Panel，v1.12.0 重构)](#18-存档管理面板-save-panelv1120-重构)
2. [🎨 第二篇：制度大盘 UI 实现（M1~M4 全落地）](#2-第二篇制度大盘-ui-实现m1m4-全落地)
   - 2.1 [多标签页制度枢纽（Tabbed Society & Ledger Hub）](#21-多标签页制度枢纽-tabbed-society--ledger-hub)
   - 2.2 [M2 界面实现：家庭旁路记账 + 分家抽资 + 丧父继承清算](#22-m2-界面实现家庭旁路记账--分家抽资--丧父继承清算)
   - 2.3 [M3 界面实现：宗族公库 + 族长制 + 族税互助](#23-m3-界面实现宗族公库--族长制--族税互助)
   - 2.4 [M4 界面实现：地区政体 + 国王尊号 + 夺位远征 + 长子继承](#24-m4-界面实现地区政体--国王尊号--夺位远征--长子继承)
   - 2.5 [高保真 ASCII Wireframe 与视觉原型图](#25-高保真-ascii-wireframe-与视觉原型图)
3. [🛠️ 第三篇：新功能 UI 开发实施指南（开发落地指引）](#3-第三篇新功能-ui-开发实施指南开发落地指引)
   - 3.1 [前端架构扩展与模块化分工 (frontend/js/ledger-ui.js)](#31-前端架构扩展与模块化分工-frontendjsledger-uijs)
   - 3.2 [快照三处同步规范清单 (Rust -> Snapshot -> JS -> UI)](#32-快照三处同步规范清单-rust---snapshot---js---ui)
   - 3.3 [CSS 设计系统与组件库规范](#33-css-设计系统与组件库规范)
   - 3.4 [性能与渲染节流硬约束](#34-性能与渲染节流硬约束)
   - 3.5 [阶段性实施路线图与验收门禁](#35-阶段性实施路线图与验收门禁)

---

# 1. 第一篇：当前 UI 页面全景剖析（现状拆解）

当前系统基于纯原生 HTML5 Canvas 2D + DOM 玻璃拟态（Glassmorphism）构建，无任何打包工具（无 Webpack/Vite），采用暗黑赛博生态风格（`#050a12` 背景），兼顾 30FPS 实时渲染与高密度信息透出。

```mermaid
graph TD
    UI["Flow & Accord 页面容器 (#canvas-container + DOM Overlay)"]
    UI --> TOP["顶栏状态栏 (.top-bar)"]
    UI --> LEFT["左侧生态大盘与产速调控 (.global-resource-panel)"]
    UI --> CANVAS["底层 Canvas 视口 (#sim-canvas)"]
    UI --> RIGHT["右侧动态堆栈 (.right-panel-stack)"]
    UI --> BOT_LEFT["左下控制台与调试 HUD (.control-panel / .debug-hud)"]
    UI --> BOT_RIGHT["右下大事记日志 (.event-log)"]
    UI --> MODALS["模态弹窗系统 (世系弹窗 & 时间轴 DAG 族谱)"]

    RIGHT --> AVG["全局族人均值大盘 (#global-averages-card)"]
    RIGHT --> LEGEND["图例与规则窗口 (#ecology-legend)"]
    RIGHT --> LEDGER_M1["家户与账本大盘 (#ledger-panel · M1)"]
    RIGHT --> INSP["动态 Inspector 检查器 (#inspector-card)"]
```

---

## 1.1 画布视口与 3D 渲染层 (Canvas Viewport)

- **容器与元素**：`<div id="canvas-container"><canvas id="sim-canvas"></canvas></div>`
- **坐标映射与投影管线**（`frontend/js/math.js` & `render_world.js`）：
  - 维持 3D 等轴斜视投影：RotX = 58°，RotZ = 45°；
  - 鼠标滚轮缩放（Zoom 0.25x ~ 3.5x）、右键拖拽或左键平移（PanX, PanY）；
  - **性能优化**：单次全网格顶点投影（`terrainProjX`/`terrainProjY` 预分配缓冲，3600 次投影），视口边界剔除裁剪，单次 `ctx.stroke()` 批处理绘制 60×60 地形网格线。
- **图层渲染顺序**：
  1. **等高线地形图**：低洼谷地（深蓝绿 `#064e3b`）、平缓原野（墨绿 `#065f46`）、高台峻岭（岩灰与山巅白）；
  2. **5 阶贝塞尔路网**：1 阶野径（土灰）、2 阶泥路（琥珀褐）、3 阶石子路（深石青）、4 阶夯土道（青蓝）、5 阶主干道（亮金蓝），恒定屏幕像素宽度，支持鼠标悬浮 Tooltip（`#road-hover-tooltip`）；
  3. **23 处 POI 生态地标**：避风营地（🏕️）、清泉（💧）、浆果丛（🍒）、茂林（🌲）、石矿（🪨）、金矿（🪙）。带外圈脉冲光晕与储量进度弧；
  4. **部落民族人（Agents）**：
     - 男性蓝色边框、女性粉色边框；
     - 状态色彩编码（静坐休养、运水、采果、伐木、采石、淘金、施工建房、修缮）；
     - 特效层：孕妇粉色粒子呼吸光环、分娩彩屑迸发、建房升级施工环进度、运动位移 4 节拖尾；
  5. **私产宅舍（Houses）**：0 级仓库（📦）、1 级茅草房（🛖）、2 级私宅（🏡）、3 级木石庄舍（🏯）、4 级家族大庄园（🏰）；无主空置房半透明 +「空」标签（v1.10.0 起 `is_ruin` 废墟状态已删除，无主房屋统一正常风化）。

---

## 1.2 顶部玻璃拟态状态栏 (`.top-bar`)

位于页面顶部，悬浮横贯，两端对齐，`pointer-events: none`（内部卡片 `pointer-events: auto`）。

### 1. 品牌与版本卡片 (`.brand-card`)
- 标题：`🍼 Flow & Accord · 流动公约` + 动态版本徽章 `<span class="version-tag">v1.12.0</span>`；
- 副标题：`确定性生态演算 · 马斯洛需求层级驱动 · 族群代际繁衍与社会演化`。

### 2. 全局实时态势仪表 (`.stats-card`)
以 10FPS 降频节流更新，在无头模式下依然常驻刷新：
- 活体人口 (`#stat-pop`)：存活部落民总数；
- 🏡 私产宅舍 (`#stat-houses`)：有效房屋总数；
- 生态地标 (`#stat-pois`)：全图 POI 节点数（固定 23 处）；
- 🏠 存续家户 (`#stat-households`)：M1 账本系统存续家户数（以男性户主为锚）；
- 💍 存续婚姻 (`#stat-marriages`)：M1 婚姻登记簿当前存续中的夫妻对数；
- 🤰 孕妇数 (`#stat-pregnant`)：正在妊娠期的女性数量；
- 🌸 四季与气温 (`#stat-season` & `#stat-temp`)：春夏秋冬 240s 周期与实时摄氏度；
- 👶 累计出生 (`#stat-births`)；
- 💀 累计死亡 (`#stat-deaths`)：带自然老死（☘️ `#stat-deaths-natural`）与饥渴非自然死亡（⚡ `#stat-deaths-unnatural`）分列；
- 🥀 累计流产 (`#stat-miscarriages`)。

---

## 1.3 左侧全局生态大盘与产速控制台 (`.global-resource-panel`)

与顶部品牌卡片等宽（385px）对齐，位于左侧 `top: 88px`：
1. **全图生态健康指示器** (`#global-eco-health`)：实时计算全图可用资源比例，展示「🌿 资源丰盛」、「⚡ 储量紧俏」、「⚠️ 资源枯竭危机」；
2. **5 类生态总余量进度条**：
   - 💧 全图清泉总水量（6 处，上限 1200.0）；
   - 🍒 全图成熟浆果量（6 处，上限 1200.0）；
   - 🌲 全图林木木材量（3 处，上限 600.0）；
   - 🪨 全图石矿石料量（2 处，上限 400.0）；
   - 🪙 全图金矿黄金量（1 处，上限 200.0）；
3. **5 组玩家产速动态调控滑块**（0.0x ~ 5.0x 步进 0.1）：支持免重编译热更新 WASM 资源再生速率，带「🔄 重置为默认产速」按钮。

---

## 1.4 右侧动态观察堆栈 (`.right-panel-stack`)

右侧垂直流式排列，支持独立折叠/展开与联动追踪：

### 1. 全局族人均值大盘 (`#global-averages-card`)
- 默认折叠，展开后展示：
  - ❤️健康、🍖饱食、💧水分、⚡体力 4 项全图存活均值进度条；
  - ⏳平均年龄、🏃平均移速、👥性别比、🏡有房率、💘成年单身、💑结发夫妻对数；
  - 🎒 随身行囊均值（水、食、木、石、金 5 项）；
  - 🧬 先天禀赋六维均值（智力、力量、魅力、消化、睡眠、寿命，基准 100）。

### 2. 图例与规则窗口 (`#ecology-legend`)
- 默认折叠，展示 23 处 POI 职能、1~5 阶道路等级、冬季供暖柴火门槛（<10 木禁孕）、房屋 0~4 级升级建材要求。

### 3. 家户与账本大盘 (`#ledger-panel`，M1 已落地)
- 默认折叠，徽章实时显示存续家户数（`X户`）；
- 展开后展示：
  - **概览统计行**：存续家户、已解散家户、存续婚姻、累计登记婚姻；
  - **🏠 家户列表**：家户 ID、户主姓名（【姓氏】👑）、成员数、账面总财富、分项 5 资源余额（💧🍒🌲🪨🪙），点击户主名字直接传送并选中对应族人；
  - **💍 婚姻登记簿**：婚姻 ID、丈夫与妻子芯片、婚龄、存续状态（💍存续 / 🕊️丧偶离异）。

### 4. 动态 Inspector 检查器 (`#inspector-card`)
选中目标（族人 / 房屋 / POI）时弹出，支持 `Esc` 或右上角 `✕` 关闭并停止镜头跟随：
- **族人视图 (`#insp-agent-view`)**：
  - **马斯洛需求意图卡片**：展示当前处于 ①生理需求 / ②安全需求 / ③归属与爱 / ④尊重需求 / ⑤自我实现，以及底层具体决策动因文案；
  - **2×2 生存健康指标网格**：❤️健康、⚡体力、🍖饱食、💧水分；
  - **🎒 随身 5 格行囊胶囊**：水(50)、食(50)、木(50)、石(50)、金(无限)，以及实时搬运物流动向（如 `🚚 动向: 前往 🏡 #3 卸货入库`）；
  - **🏠 家户归属卡片**：显示家户 ID、户主、角色（👑户主 / 💍配偶 / 👶子女）、分家来源（分家自 #X）、账面 5 资源余额、最近 5 条家户大事记；
  - **💍 婚姻登记卡片**：存续状态、丈夫/妻子、婚龄、历史多段婚姻列表；
  - **生理状态条**：🤰 妊娠进度条（200s 孕期百分比）、🥀 流产调养倒计时；
  - **底部动作栏**：🎥 镜头跟随开关、🏠 定位私宅、📜 详情 ↗（唤起世系族谱弹窗）。
- **房屋视图 (`#insp-house-view`)**：
  - 🏛️ 房屋耐久度进度条与风化/修缮状态；
  - 🧱 修建/升级者历史确权（修建者 Agent ID + 最近升级者 ID，不随继承改变）；
  - 👑 户主确权芯片（点击直接跳转户主，无主房显示「🏚️ 无主空置房」灰色标签 + 受益人登记提示）、所属聚落、建筑形态等级；
  - 家庭储备以**家户账本**为唯一真相源（M6 起房屋仓库已删除），吃喝/冬季烧柴从账本真实扣减；
  - 👶 生育激活状态：★ v1.28.0 起需男方（户主）名下住宅 ≥1 级（0 级仓库不生育），且女方身体指标达标、流产/产后冷却结束。
- **地标视图 (`#insp-poi-view`)**：
  - 非营地 POI（清泉/果丛/森林/石矿/金矿）：储量余量进度条与产出速率、地形与辖区描述文本；
  - **营地专属（v1.12.0 重构）**：一级卡片精简为三要素——
    1. **👑 现任国王**：国王芯片（点击跳转），王位空悬时显示灰色「王位空悬」；
    2. **辖区晋升进度条**：标题行整合等级名称（原始营地/村落/乡集/集镇/县邑）+ 辖房数 + 空置数，进度条展示距下一级所需房屋数（0→6→12→18→24）；
    3. **📜 查看辖区详情** 按钮：点击弹出营地详情模态框（见 §1.7.3）；
  - 营地已移除：标题右侧 state-badge、底部 poi-info-badge（产出速率/地形/辖区标签）、描述文本（仅对营地生效，非营地 POI 保留）。

---

## 1.5 底部生态时钟、控制台与调试监视器 (`.control-panel` & `.debug-hud`)

- **控制台面板**（左下角）：
  - ⏸️ 暂停/继续模拟（空格键快捷触发，带焦点隔离保护）；
  - 🏕️ 重演生态（重新播撒 20 位始祖族人）；
  - 🧠 **无头模式 (Headless Mode)**：只推进 Rust 内核模拟与顶栏数据，跳过全部画布渲染，供长程快速演化；
  - 视图开关：👤 隐藏部落民、🛣️ 隐藏路网、🐞 调试监视器；
  - ⚡ 模拟演化倍速下拉选框（1x ~ 1024x 八档，WASM 同帧多步步进）。
- **🐞 调试监视器 HUD (`#debug-hud`)**：
  - 模拟 Tick、每秒真实 Tick 推进速率（含倍速加成）、渲染 FPS；
  - 内核步进耗时（`tickMs`）、快照解析耗时（`snapMs`）、渲染耗时（`renderMs`）、整帧耗时与 CPU 占用率；
  - JS 堆内存占用与 WASM 线性内存大小。

---

## 1.6 右下角重大历史事件滚动日志 (`.event-log`)

实时滚动播报部落重大演化历史（定居立宅、结发成婚、怀胎受孕、瓜熟分娩、房屋扩建升级、冻馁丧生、老病仙逝等），最多保留 8 条，带色彩标签（`camp`/`house`/`death` 等）。

---

## 1.7 模态弹窗系统 (Modal System)

### 1. 部落民世系详情弹窗 (`#lineage-modal`)
- 族人核心档案、马斯洛状态徽章；
- 🧬 先天六维禀赋雷达数据网格；
- 关系网四宫格：👴 父亲、👩 母亲、💍 配偶、🏠 私宅，以及 👶 全部后代子嗣列表（点击亲眷芯片可无缝切换视角）。

### 2. 直系血脉确定性时间轴 DAG 族谱 (`#full-dag-modal` & `dag-standalone.js`)
自 v0.9.64 起采用**确定性时间轴布局**，彻底废除不可控的力导向算法：
- **Y 严格线性映射出生时刻**：`Y = (birthTick - tickMin) * PX_PER_TICK`，先辈必在上，后代必在下；
- **X 坐标横向拓扑冲突消解**：父系主脉居中，核心家庭分组居中，整数列探测与两轮局部松弛；
- **视口虚拟化 + 3 档 LOD 分级渲染**：仅挂载可视区域卡片，缩放 <0.45 纯色块、0.45~0.75 简档、>0.75 全功能卡片；
- **左侧自适应时间刻度尺**：季/年/5/10/25/50/100 年自适应切换；
- **直系血脉单图**：仅展示焦点族人的递归祖先链与递归后代链，杜绝千人全图节点爆炸；
- **新标签页独立打开**：支持将族谱单独在新浏览器 Tab 渲染，与主地图主副双屏联动。

### 3. 营地辖区详情模态框 (`#camp-detail-backdrop`，v1.12.0 新增)
点击营地一级卡片的「📜 查看辖区详情」按钮弹出，遮罩半透明背景，支持 Esc / 点击遮罩 / 右上角 ✕ 三种关闭方式。模态框每帧实时刷新（`window._campDetailTick` 挂入主循环），包含 6 个分区：

| 分区 | DOM ID | 展示内容 |
| :--- | :--- | :--- |
| 👑 现任国王 | `#camp-detail-king` | 国王芯片 + 登基时刻 + 在位时长（tick/30 换算模拟秒） |
| 👤 继承人 | `#camp-detail-heir` | 顺位前 3 继承人芯片（长子→长孙→幼子→元老） |
| 📜 历史国王 | `#camp-detail-hist-kings` | 历任国王列表，含在位起止时长与死因（寿终正寝/饿死/渴死等） |
| 🏠 管辖家庭 | `#camp-detail-governed` | 紧凑格式 `🏠#id(N人·户主#X)`，点击跳转房屋 |
| 🏚️ 空置房屋 | `#camp-detail-vacant` | 无主房屋列表 + 受益人芯片（子女+配偶） |
| 💰 王国公仓账本 | `#camp-detail-ledger-*` | 5 类资源余额（水/粮/木/石/金）+ 最近 6 笔流水 |

- **在位时长换算**：30 tick = 1 模拟秒（`config.simulationDt=1/30`，`agentDecisionIntervalTicks=30`）；
- **死因来源**：内核 `HistoryKing.death_cause`，被废黜/夺位则为 None（显示「退位」）；
- **样式族**：`.camp-detail-backdrop` / `.camp-detail-modal` / `.camp-detail-section` / `.camp-detail-king-row` 等，皇家金 `#fbbf24` 主题色。

### 4. 存档管理面板 (`#save-modal`，v1.12.0 重构)
顶栏「💾 存档」按钮打开，详见 §1.8。

### 5. 房屋拍卖交易所与实时竞价大盘 (`#house-auction-backdrop` / `#house-auction-modal`，v1.15.0 新增)
专用于二手房屋市场挂牌流转、麦穗 37% 最优停止博弈全过程透视与买方报价竞逐的全景大盘。由 `frontend/js/auction-ui.js` 驱动，渲染循环每帧调用 `window._auctionUiTick` 保证数据毫秒级同步。

#### 呼出方式（三入口）
1. **顶栏常驻徽章按钮**：`.top-bar .save-bar-card #btn-open-auction-modal`（显示当前挂牌在售房屋总数，有在售房产时激活金色呼吸脉冲光晕）；
2. **房屋 Inspector 专属按钮**：选中在售房屋时，Inspector 卡片内显示 `🔨 查看实时竞价与麦穗博弈大盘 ↗`；
3. **主画布双击**：双击游戏视口中带有悬浮拍卖标牌与金色光晕的在售房屋，直接展开对应房产大盘。

#### 核心面板布局与视觉图元
- **资产基本面卡片 (Hero Card)**：建筑等级图标（🛖/🏡/🏯/🏰）、所属营地、修建者 Agent、修缮耐久度、房龄与按榷场物化成本折算的当前市场估价，动态高亮营地闲置土地状态（土地充盈则估价为自建成本上限；土地告罄则显示稀缺供需溢价）；
- **🌾 麦穗 37% 最优停止博弈标尺 (核心可视化)**：
  - 双色渐变分段轴：以房屋起拍耐久度至 10% 出清线为全博弈区间，前 37% 为**🌾 观察摸底期**（只树立最高出价标杆不出售），后 63% 为**🎯 决策窗口期**（买方出价超过标杆即成交），$\le 10\%$ 为**⚠️ 强制出清线**（选历史最高报价强制交割防风化坍塌）；
  - 动态走动指针：白色高亮指针与气泡标签随房屋风化损耗（$-0.04\%/\text{s}$）实时向左游走，直观呈现博弈推进；
- **👥 辖区意向买家池**：实时扫描辖区内符合出价条件的单身/无房成年男性户主，呈现家庭黄金储备与意向标签（资金充裕/尽力出资/微薄无金），附带「定位 🔍」一键追踪族人；
- **⚡ 实时竞价流水**：展示每 3 秒一轮的买方族人报价卡片（出价人、金额、阶段），附带营地中介仲裁判定（确立新标杆/击中更优麦穗成交/低于标杆等）；
- **📜 历史成交档案库**：Tab 切换浏览全图已交割房屋公证书档案与资金划转凭证。

---

## 1.8 存档管理面板 (Save Panel，v1.12.0 重构)

> v1.12.0 彻底删除 localStorage 三槽位体系，改为 **3 个固定文件槽位 + IndexedDB 持久化句柄**架构。仅支持 Chrome / Edge（File System Access API）。

### 架构概览

```mermaid
graph TD
    A["用户点击 💾 存档"] --> B["存档面板 (#save-modal)"]
    B --> C["3 固定槽位 SLOTS"]
    C --> C1["槽位 1: flowaccord-save1.json 🤖 自动保存"]
    C --> C2["槽位 2: flowaccord-save2.json"]
    C --> C3["槽位 3: flowaccord-save3.json"]
    C1 --> D["FileSystemFileHandle"]
    C2 --> D
    C3 --> D
    D --> E["IndexedDB: flowaccord-save-handles"]
    E -->|页面刷新自动恢复| F["connectSlot() 重建连接"]
    D --> G["createWritable() 直写磁盘"]
    H["tickAutoSave() 每60s"] -->|写入槽位1| C1
```

### 槽位卡片三态

| 状态 | 渲染 | 交互 |
| :--- | :--- | :--- |
| **未连接** | 灰色卡片 + 「🔗 连接文件」按钮 | 点击弹出 `showSaveFilePicker`，默认文件名 `flowaccord-saveN.json` |
| **已连接** | 文件名 + 最后保存时间 + Tick/人口/体积元信息 + 「💾 保存」「📂 读取」「🔌 断开」按钮 | 保存直写磁盘无需重复弹窗；读取校验 `format_version` |
| **不兼容** | 红色卡片 + 「⚠️ 浏览器不支持 File System Access API，请使用 Chrome / Edge」 | 全部操作禁用 |

### 关键机制

1. **IndexedDB 持久化句柄**：数据库 `flowaccord-save-handles` / objectStore `handles` / keyPath `slotId`，存储 `{slotId, handle, fileName, savedAt}`。页面刷新后初始化时从 IDB 恢复全部槽位句柄并异步从文件头读取元信息。
2. **自动保存**：`tickAutoSave()` 每 60 秒写入槽位 1（未连接则跳过），UI 标注「🤖 自动保存」徽章。
3. **元信息缓存**：已连接槽位的元信息（Tick/人口/体积/保存时间）缓存在内存，刷新时从文件头提取，无需全量读取。
4. **存档格式版本**：`SAVE_FORMAT_VERSION = 3`（v1.12.0 因 `history_kings` 结构变更从 2 升级），读档时版本不兼容即拒绝加载且不污染当前世界。
5. **权限失效处理**：写入/读取捕获 `NotAllowedError`，自动断开连接并提示重新授权。
6. **旧导入按钮已隐藏**：`input[type=file]` 导入入口移除，统一走文件槽位体系。

### 实现文件
- `frontend/js/save-ui.js`（完整重写，约 450 行）
- `frontend/index.html`（存档面板 DOM）
- `frontend/style.css`（`.save-slot-*` 样式族）

---

# 2. 第二篇：制度大盘 UI 实现（M1~M4 全落地）

在 [`docs/12-plan-ledger-refactor.md`](./12-plan-ledger-refactor.md) 中，M1~M4 已全部完成（M1 团体基类/婚姻登记/家户体系/胎儿 Agent 身份 → M4 地区王国）。本篇对 **M2（旁路记账与分家继承）、M3（宗族与族长制）、M4（地区团体与国王政体）** 的 UI/UX 实现架构与视觉交互进行完整说明——以下界面均已落地于 `frontend/js/ledger-ui.js`。

```mermaid
graph LR
    subgraph "M1 (已落地)"
        M1_H["家户登记簿 (以父为锚)"]
        M1_M["婚姻登记簿 (终身留痕)"]
    end

    subgraph "M2 (已落地 · v1.1.0)"
        M2_J["旁路流水双环穿透 (Deposit/Consume/Heating)"]
        M2_S["分家抽资可视化 (W=2+n)"]
        M2_I["丧父继承清算与入公仓"]
    end

    subgraph "M3 (已落地 · v1.2.0)"
        M3_C["宗族聚合看板 (姓氏/族长)"]
        M3_T["族税缴纳与互助救济流水"]
    end

    subgraph "M4 (已落地 · v1.3.0)"
        M4_K["王国与领地面板 (国王/长子顺位)"]
        M4_E["夺位远征视口态势标牌"]
        M4_G["公仓赋税与赈灾大盘"]
    end

    M1_H --> M2_J
    M1_H --> M2_S
    M1_H --> M2_I
    M2_J --> M3_C
    M3_C --> M3_T
    M3_T --> M4_K
    M4_K --> M4_E
    M4_K --> M4_G
```

---

## 2.1 多标签页制度枢纽 (Tabbed Society & Ledger Hub)

### 为什么是多标签页？
右侧面板容器在 M1 只有一个折叠式的 `ledger-panel`，仅能罗列家户与婚姻两条简单列表。演进至 M2~M4 后：
1. **信息维度剧增**：新增了宗族（Clan）、行政领地/王国（Region）、公仓金库、王位顺位链、分家世系；
2. **纵向滚动失控**：如果在单一面板内垂直无限堆叠列表，会导致用户频繁上下拖动，交互体验崩溃；
3. **职责隔离清晰**：家户（私有血缘家庭）、婚姻（两性契约）、宗族（同姓父系联盟）、地区（地缘政体与公权力）属于四个不同层级的社会制度。

### 实现方案：4 标签页「🏛️ 社会与经济制度大盘」
将 `ledger-panel` 重构为带有分段选项卡（Tab Switcher）的制度大盘容器（已落地于 `ledger-ui.js`）：

| 标签页 ID | 名称 | 图标 | 主题色彩 | 核心展示内容 | 对应里程碑 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `tab-household` | **家户** | 🏠 | 琥珀金 `#f59e0b` | 存续/已解散家户、分家支系树、账面余额、流水穿透抽屉 | M1 / M2 |
| `tab-marriage` | **婚姻** | 💍 | 浪漫粉 `#ec4899` | 存续中婚姻、终身多段历史留痕、平均婚龄、离异/丧偶率 | M1 |
| `tab-clan` | **宗族** | 🛡️ | 翡翠青 `#10b981` | 同姓宗族聚合、世袭族长、族库金库、族税征缴、互助基金 | M3 (v1.2.0) |
| `tab-region` | **王国** | 👑 | 皇家金 `#fbbf24` | 5 大营地王国、当朝国王、长子顺位链、夺位远征中族人、公仓与赋税救济 | M4 (v1.3.0) |

---

## 2.2 M2 界面实现：家庭旁路记账 + 分家抽资 + 丧父继承清算

### 1. 旁路双环记账流水穿透抽屉 (Double-Entry Journal Viewer)
- **触发位置**：点击任一家户卡片或 Agent Inspector 的「📒 账面余额」区域；
- **展示形态**：向下滑出抽屉式流水列表（从环形缓冲区拉取最近 32 笔）：
  - `Deposit`（📥 成员运货回填）：`[Tick 1420] 成员 #3 存入 💧+15.0 (运水回宅)`
  - `Consume`（🍽️ 生活消耗）：`[Tick 1500] 成员 #1 消耗 🍒-2.5 (就餐)`
  - `Heating`（🔥 冬季采暖）：`[Tick 1800] 冬季供暖消耗 🌲-0.12/s`
  - `Construction` / `Maintenance`（🔨 营建修缮）：`[Tick 2100] 茅草房升级私宅 🌲-25.0`
  - `Split`（✂️ 分家出资）：`[Tick 3200] 子代 #5 成年分家 支出份额 [💧-4.2, 🍒-6.0, 🌲-3.1]`
  - `Inheritance`（⚰️ 丧父清算）：`[Tick 4500] 户主 #1 离世，家产平分予 3 位子女各 1/3`

### 2. 分家抽资（$W = 2 + n$）可视化弹窗/卡片
- 当男性族人满足 `age >= 1800`（成年）或父亲亡故触发自主分家时，产生分家事件。
- **UI 交互表现**：
  - 在家户大事记与事件播报中高亮提示：`✂️ 部落民 #5 自立门户（新家户 #8），分得原家户 #2 资产的 1/4（权重比 2:1:1:1）`；
  - 鼠标悬浮分家标记时弹出公式气泡：
    $$\text{总权重 } W = 2(\text{父}) + 1(\text{长子}) + 1(\text{次子}) + 1(\text{胎儿}) = 5 \implies \text{抽资比例 } 20\%$$
  - 在族谱 DAG 图上，分家节点旁出现分支图标 `🌱`，点击可直接展开新家户档案。

### 3. 丧父继承清算与入公仓档案
- 户主去世时：
  - **有在世子一代**：家产等额平分流水明细，家户状态打上 `[已解散 · 遗赠分配完毕]` 灰色标签；
  - **绝嗣（无在世子女）**：家产全额并入公仓流水：`🏛️ 绝嗣清算：家户 #4 剩余资产全部充入 【桃源营地】公仓`。

---

## 2.3 M3 界面实现：宗族公库 + 族长制 + 族税互助

### 1. 宗族聚合看板 (`tab-clan`)
- **宗族卡片**：
  - 族徽与宗族名号：如 `🛡️「姬」氏宗族`、`🛡️「姜」氏宗族`；
  - **👑 族长尊号**：显示同姓在世最年长男性头像与 ID（如 `族长: Agent #3 (72岁/始祖)`）；
  - **宗族规模**：涵盖家户数（`8 户`）、族人总数（`24 人`）；
  - **宗族公库储备仪表**：💧水 / 🍒食 / 🌲木 / 🪨石 / 🪙金 5 类资源族库总额；
  - **族长顺位列表**：展开查看排名前 3 的顺位继承人（按年龄降序、男性、健在、并列取 ID 小者）。

### 2. 族税与互助流水监控
- **族税征收进度条**：各家庭按 `config.clan_tribute_rate` 向宗族公库上缴比例；
- **互助救济动态气泡**：当某成员家庭粮食/木材枯竭时，族长自动签发 `MutualAid` 救济，界面跳出绿色救济流向动画：`🛡️ 宗族救济: 「姬」氏族库拨付 🍒+15.0 -> 极贫家户 #6`。

---

## 2.4 M4 界面实现：地区政体 + 国王尊号 + 夺位远征 + 长子继承

### 1. 地区/王国政体面板 (`tab-region`)
- **5 大行政区卡片**（对应 5 处营地）：
  - 行政等级徽章：🏕️ 原始营地 → 🏘️ 村落 → 🏬 乡集 → 🏙️ 集镇 → 🏛️ 县邑/王国；
  - **👑 国王/领主头像卡片**：展示国王名号、登基时刻、在位年限；
  - **到达时序表 (Arrival Order)**：始祖播撒序与新生儿出生序列；
  - **长子继承顺位树**：国王直系长子 → 长孙 → 幼子 → 元老到达顺位；
  - **地区公仓储备**：大宗公仓物资及周期性税收流水（`Tax`）与赈灾拨付（`Relief`）。

### 2. 历史国王档案（v1.12.0 内核扩展）
- **内核结构**：`Region.history_kings` 从 `Vec<AgentId>` 升级为 `Vec<HistoryKing>{agent_id, reign_start_tick, reign_end_tick, death_cause}`，新增 `Region.current_reign_start` 追踪现任国王登基 tick；
- **`set_king` 签名**：增加 `prev_death_cause: Option<String>` 参数，4 个调用点（初王登基/国王更替/长子继承/夺位远征）同步传入前任国王死因（从 `agent.death_cause` 读取，被废黜/夺位则为 None）；
- **快照三处同步**：`snapshot.rs` 新增 `HistoryKingSnapshot` + `RegionSnapshot.current_reign_start`；`world_snapshot.rs` 映射；`rustworld.js` 适配对象数组并兼容旧档数字数组回退；
- **存档格式**：`SAVE_FORMAT_VERSION` 2→3（`history_kings` 结构不兼容旧档，按设计红线干净拦截）；
- **UI 展示**：营地详情模态框「📜 历史国王」分区，每位国王展示在位时长（`(reign_end - reign_start)/30` 模拟秒）与死因。

### 3. 营地详情模态框（v1.12.0 UI 重构）
营地一级卡片精简为「国王 + 晋升条 + 查看详情按钮」，完整辖区信息移入模态框（见 §1.7.3），包含：
- 现任国王（登基时刻 + 在位时长）
- 继承人顺位前 3
- 历史国王列表（在位时长 + 死因）
- 管辖家庭（紧凑格式 `🏠#id(N人·户主#X)`）
- 空置房屋（房屋 ID + 受益人芯片）
- 王国公仓账本（5 类余额 + 最近 6 笔流水）

### 4. ⚔️ 夺位远征视口地图动态标牌
- 当王位空悬（无主营地）时，由决策分支 `B14SeekThrone`（生理层最高档）驱动：在世成年男性非国王且存在空缺王位营地（有房者仅夺自家房屋所在营地、无房可夺任意）时，决策器选定最近可夺位营地发起夺位远征；
- **地图视口动态效果**：
  - 夺位者头顶浮现金色战盔标牌：`⚔️ 冲刺夺位中 -> 桃源营地`；
  - 画布上自夺位者脚下向目标营地绘制金色虚线光束；
  - 率先抵达者登基瞬间，视口炸开金色礼花，全图播报：`👑 胜者为王：部落民 #8 率先抵达，登基为【桃源王国】第一任国王！`。

---

## 2.5 高保真 ASCII Wireframe 与视觉原型图

### 1. 制度枢纽 4 标签页大盘布局 (Society & Ledger Hub)

```text
+-------------------------------------------------------------------+
| 🏛️ 社会与经济制度大盘 (Society & Ledger Hub)              [ - ] [ X ] |
+-------------------------------------------------------------------+
| [ 🏠 家户(12) ]  [ 💍 婚姻(8) ]  [ 🛡️ 宗族(3) ]  [ 👑 王国(5) ]    |  <-- Tab Switcher
+-------------------------------------------------------------------+
| 📌 宗族大盘视图 (TAB: 🛡️ 宗族)                                      |
| +---------------------------------------------------------------+ |
| | 🛡️「姬」氏宗族                      👑 族长: Agent #3 (68岁)   | |
| | 👥 辖属 6 户 (18人)                 💰 族库总额: 186.5 单位    | |
| | ------------------------------------------------------------- | |
| | 💧 45.0  | 🍒 62.0  | 🌲 50.0  | 🪨 20.0  | 🪙 9.5           | |
| | [ 族内互助基金: 充足 🟢 ]            [ 族税征缴率: 5% / 季 ]     | |
| | 📜 近期流向:                                                   | |
| |  · [Tick 3200] 互助救济 -> 家户 #4 (🍒+15.0 过冬度荒)           | |
| |  · [Tick 2900] 族税上缴 <- 家户 #2 (🪙+2.0 贡金)               | |
| +---------------------------------------------------------------+ |
| +---------------------------------------------------------------+ |
| | 🛡️「姜」氏宗族                      👑 族长: Agent #7 (54岁)   | |
| | 👥 辖属 4 户 (11人)                 💰 族库总额: 94.0 单位     | |
| | 💧 20.0  | 🍒 35.0  | 🌲 25.0  | 🪨 10.0  | 🪙 4.0           | |
| +---------------------------------------------------------------+ |
+-------------------------------------------------------------------+
```

### 2. 地区与王权面板布局 (TAB: 👑 王国)

```text
+-------------------------------------------------------------------+
| 🏛️ 桃源王国 (5阶 县邑/王国)              🏛️ 辖区私宅: 26 间       |
+-------------------------------------------------------------------+
| 👑 当朝国王: 部落民 #1【姬】(在位 12年)  ⚔️ 王权状态: 稳固统治    |
| 📜 王位顺位: ① 长子 #9  ② 长孙 #21  ③ 幼子 #14  ④ 元老 #2(按序)    |
+-------------------------------------------------------------------+
| 🏛️ 国库公仓总储量 (公共赈灾与修路基金)                             |
| 💧 120.0     🍒 150.0     🌲 85.0      🪨 60.0      🪙 32.0       |
+-------------------------------------------------------------------+
| 📜 王权政令与大宗流水:                                            |
|  · [Tick 4100] 普发冬赈: 公仓拨付 🌲-20.0 救济受冻贫民家户        |
|  · [Tick 3800] 征收公仓税: 全境 26 户共计纳粮 🍒+26.0             |
|  · [Tick 3100] 先王仙逝，长子 #1 依长子继承制登基为王             |
+-------------------------------------------------------------------+
```

---

# 3. 第三篇：制度大盘 UI 开发实施总结（开发落地指引）

本篇章记录了 M1~M4 制度大盘前端界面的落地过程与规范，为后续新增社会制度 UI（M5+ 专利经济、M6 六维政体等）提供可复用的模块化分工、快照同步清单与性能硬约束。

---

## 3.1 前端架构扩展与模块化分工

根据 **AGENTS.md §4.6「单文件严控在 800 行以内」** 的规范，前端已完成两轮拆分：

### 第一轮：render.js 五文件拆分（v1.7.1）
原 `render.js`（2128 行）拆分为：
- `render_canvas.js`：共享状态 + 主循环调度
- `render_hud.js`：顶栏/调试/资源大盘/均值大盘/账本面板
- `render_world.js`：地形/路网/POI/房屋绘制
- `render_agents.js`：族人绘制 + 登基礼花
- `render_inspector.js`：Inspector 面板 + 点击拾取 + 营地详情模态框

### 第二轮：制度大盘抽离 ledger-ui.js（v1.3.0）
新建 `frontend/js/ledger-ui.js`，将社会制度与账本大盘 UI 从渲染层抽离：

```mermaid
graph TD
    A["rustworld.js (快照映射)"] --> B["render_canvas.js (主循环调度)"]
    B --> C["render_inspector.js (Inspector + 营地详情模态框)"]
    B --> D["render_hud.js (顶栏/大盘/账本面板)"]
    B --> E["render_world.js (地形/路网/POI/房屋)"]
    B --> F["render_agents.js (族人绘制)"]
    A --> G["ledger-ui.js (社会与制度大盘枢纽)"]
    G --> T1["renderHouseholdTab() (M1/M2)"]
    G --> T2["renderMarriageTab() (M1)"]
    G --> T3["renderClanTab() (M3)"]
    G --> T4["renderRegionTab() (M4)"]
    H["save-ui.js (存档面板 v1.12.0)"] --> I["3 文件槽位 + IndexedDB"]
```

- **`frontend/js/ledger-ui.js` 职责**：管理 4 标签页切换、渲染家户/婚姻/宗族/王国面板、流水穿透抽屉、地图夺位特效；
- **`frontend/js/save-ui.js` 职责（v1.12.0 重写）**：3 固定文件槽位管理、IndexedDB 句柄持久化、自动保存、浏览器兼容性检测；
- **`index.html`** 按依赖顺序加载全部脚本（决策三件套须早于 rustworld.js）；**`style.css`** 扩展暗黑赛博玻璃拟态样式。

---

## 3.2 快照三处同步规范清单 (Rust -> Snapshot -> JS -> UI)

新增任何账本、宗族或政体字段时，**必须且只能严格按照三处同步规范**（根 AGENTS.md §4.5）：

```mermaid
sequenceDiagram
    participant Rust as 1. crates/sim_core/src/spatial/snapshot.rs
    participant Gen as 2. crates/sim_core/src/spatial/world.rs
    participant Adapt as 3. frontend/js/rustworld.js
    participant UI as 4. frontend/js/ledger-ui.js & render_inspector.js

    Rust->>Gen: 声明快照 Struct (如 ClanSnapshot / RegionSnapshot)
    Gen->>Adapt: generate_snapshot() 序列化输出 JSON
    Adapt->>UI: _applySnapshot() 反序列化为 JS 对象数组
    UI->>UI: DOM 绑定与 Canvas 矢量高亮
```

### M2~M4 快照结构体（已落地，与 `snapshot.rs` 实际定义一致）

> 以下为当前实际落地的快照结构（注意：`TransferRecordSnapshot.from/to` 为字符串化主体标识，非整数；`ClanSnapshot` 用 `member_ids` 而非家户 ID 列表；`RegionSnapshot.history_kings` 自 v1.12.0 起为 `HistoryKingSnapshot` 对象数组）。完整字段见 [`docs/current/12-ledger-system.md`](./current/12-ledger-system.md)。

#### 1. M2 账本流水快照 (`TransferRecordSnapshot`)
```rust
// snapshot.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRecordSnapshot {
    pub tick: u64,
    pub resource: String,   // "Water" / "Food" / "Wood" / "Stone" / "Gold"
    pub amount: f32,
    pub from: String,       // 付出方主体（字符串化，如 Personal(3) / Family(2) / Clan("姬") / Region(1)）
    pub to: String,         // 接收方主体（字符串化）
    pub reason: String,     // "Deposit" / "Consume" / "Split" / "Inheritance" 等
}
```

#### 2. M3 宗族快照 (`ClanSnapshot`)
```rust
// snapshot.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClanSnapshot {
    pub surname: String,
    pub leader_id: Option<AgentId>,  // None = 无主账本冻结
    pub member_count: u32,
    pub member_ids: Vec<AgentId>,
    pub balances: Vec<LedgerBalanceSnapshot>,
    pub recent_journal: Vec<TransferRecordSnapshot>,
    pub recent_events: Vec<String>,
}
```

#### 3. M4 地区/政体快照 (`RegionSnapshot`，v1.12.0 更新)
```rust
// snapshot.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionSnapshot {
    pub camp_id: u32,
    pub camp_name: String,
    pub king_id: Option<AgentId>,
    pub regime: String,            // "Kingdom"
    pub succession: String,        // "Primogeniture"
    pub member_count: u32,
    pub member_ids: Vec<AgentId>,         // v1.9.0 成员列表
    pub arrival_order: Vec<AgentId>,       // 到达时序前10
    pub heir_candidates: Vec<AgentId>,     // 顺位前3继承人
    pub governed_households: Vec<u32>,     // v1.9.0 管辖家户 ID 列表
    pub history_kings: Vec<HistoryKingSnapshot>, // v1.12.0 历史国王（含在位时长+死因）
    pub current_reign_start: Option<u64>,  // v1.12.0 现任国王登基 tick
    pub balances: Vec<LedgerBalanceSnapshot>,
    pub recent_journal: Vec<TransferRecordSnapshot>,
    pub recent_events: Vec<String>,
    pub active_expedition_agents: Vec<AgentId>, // 正在冲向该营地夺位的族人
}

/// v1.12.0 历史国王快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryKingSnapshot {
    pub agent_id: AgentId,
    pub reign_start_tick: u64,
    pub reign_end_tick: u64,
    pub death_cause: Option<String>,  // None = 退位/被废黜
}
```

---

## 3.3 CSS 设计系统与组件库规范

所有新 UI 组件必须使用项目现有的暗黑赛博玻璃拟态（Dark Glassmorphism）设计语言，严禁引入未经定义的亮色大底色。

### 1. 配色规范
- **背景底色**：`rgba(10, 18, 30, 0.96)`；
- **边框与阴影**：`border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);`；
- **业务语义色彩**：
  - 🏠 家户主题：琥珀金 `#f59e0b` / `rgba(245, 158, 11, 0.2)`
  - 💍 婚姻主题：浪漫粉 `#ec4899` / `rgba(236, 72, 153, 0.2)`
  - 🛡️ 宗族主题：翡翠绿 `#10b981` / `rgba(16, 185, 129, 0.2)`
  - 👑 王权主题：皇家金 `#fbbf24` / `rgba(251, 191, 36, 0.2)`
  - 💧 水资源：`#38bdf8`
  - 🍒 粮食资源：`#10b981`
  - 🌲 木材资源：`#d97706`
  - 🪨 石料资源：`#94a3b8`
  - 🪙 黄金资源：`#fbbf24`

### 2. 交互芯片 (`.lineage-chip` 体系)
任何出现族人 ID 的位置，必须包装为 `.lineage-chip`，绑定 `data-agent-id`：
- 支持鼠标悬浮高亮；
- 支持点击直接将主地图视口平移并选中该族人；
- 死亡族人自动附加 `.dead` 类，显示为灰暗删除线风格。

---

## 3.4 性能与渲染节流硬约束

1. **DOM 更新必须降频节流**：
   - 制度大盘（Households/Clans/Regions）与顶栏一样，必须在 `render_canvas.js` 主循环中以 **10FPS（每 100ms 一次）** 节流更新，严禁随 30FPS Canvas 每帧操作 DOM。
2. **面板折叠状态跳过渲染**：
   - 当 `.ledger-panel` 处于 `.minimized` 折叠态时，除了更新标题栏的简单计数徽章外，**必须直接 return**，跳过内部复杂的 DOM 拼接与 Diff。
3. **列表虚拟化与截断保护**：
   - 超过 20 条的列表必须进行截断显示（如 `... 另有 X 户未展示`），或采用轻量级虚拟列表，避免几百代演化后 DOM 节点数突破数千导致浏览器掉帧卡死。
4. **确定性与零额外 RNG**：
   - 前端所有排序展示（如族长顺位、继承人顺位）必须与 Rust 内核确定性算法保持一致（如并列时按 ID 从小到大排序），禁止在 JS 端使用非稳定排序。

---

## 3.5 阶段性实施路线图与验收门禁

```mermaid
gantt
    title Flow & Accord · 制度大盘 UI 演进路线（M1~M4 全部完成）
    dateFormat  YYYY-MM-DD
    section M1 现状
    家户与婚姻大盘(已完成)         :done, m1, 2026-08-01, 2026-08-15
    section M2 演进 (v1.1.0 已完成)
    旁路记账流水穿透抽屉           :done, m2_1, 2026-09-05, 5d
    分家抽资与继承清算卡片         :done, m2_2, after m2_1, 5d
    section M3 演进 (v1.2.0 已完成)
    4标签页枢纽容器升级            :done, m3_1, 2026-09-20, 4d
    宗族聚合与族长公库面板         :done, m3_2, after m3_1, 6d
    section M4 演进 (v1.3.0 已完成)
    地区政体与国王/顺位面板        :done, m4_1, 2026-10-05, 6d
    夺位远征地图光环与全图战报     :done, m4_2, after m4_1, 5d
```

### 交付门禁（每次代码提交前必检）
1. **配置一致性校验**：`node tools/config-check.js` 必须 170/170 字段完全匹配；
2. **WASM 与引擎确定性测试**：`node tools/test-wasm.js` 必须输出 `ALL_TESTS_DONE`（0 越界、0 NaN、同种子逐字节一致、存档读档确定性、版本不兼容拒绝）；
3. **WASM 双副本同步**：`frontend/rust/sim_wasm.wasm` 与 `frontend/sim_wasm.wasm` 必须同步更新；
4. **版本号自增与文档同步**：同步更新 `index.html`、`AGENTS.md`、`docs/current/11-changelog.md`、受影响的 `docs/current/0X-*.md`。

> ✅ M1~M4 界面已全部按此路线落地（`ledger-ui.js` 4 标签页枢纽 + Canvas 夺位特效），上述 gantt 中的任务均已 `done`。
