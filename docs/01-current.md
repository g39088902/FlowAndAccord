# 📋 Flow & Accord（流动公约）已实现功能全景清单

开发任务入口：[Agent 快速入口](./current/00-agent-start.md)，按改动类型选择指南、上下游同步链与验证命令。

> **文档定位**：本文件为「已实现功能」的索引入口。详细内容按功能模块拆分至 [`docs/current/`](./current/) 目录，本文仅保留全局架构速览与模块导航。
> **版本**：v1.46.10（版本演进记录见 [docs/current/11-changelog.md](./current/11-changelog.md)）
> **超参配置**：全部可调超参（205 个）统一由 `frontend/js/config.js` 及拆分配置（`config.house-upgrade-cost.js` 升级成本矩阵 20 字段 / `config.decision-order.js` 决策顺序）驱动，**前端 JS 为唯一数值真相源**（v1.44.9 起内核常量已清零）；字段/类型/默认值/中文说明见 [docs/06-config-reference.md](./06-config-reference.md)，Rust↔JS 字段契约由 `node tools/config-check.js` 校验。

---

## 🌟 核心系统架构一览

```
                       ┌──────────────────────────────┐
                       │     四季更替与热力学气温     │
                       │  (240s年轮 / -3~31℃ / 冬季供暖) │
                       └──────────────┬───────────────┘
                                      ▼
                       ┌──────────────────────────────┐
                       │   有限生态地标 (23处 POI)    │
                       │ (营地4/清泉6/浆果6/林木3/石2/金1/市1)│
                       └──────────────┬───────────────┘
                                      ▼
                       ┌──────────────────────────────┐
                       │   部落民 AI 层次化动机引擎   │
                       │ (生理自救/建仓备货/榷场/淘金/成家) │
                       └──────────────┬───────────────┘
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  3D 拓扑路网导航 │   │  多级私产房屋进阶 │   │ 家族血脉与世系继承│
│ (A*寻路/踏路成道 │   │ (0级仓库→4级庄园 │   │ (结发夫妻/族谱   │
│  5阶恒宽色彩)    │   │  水粮木石金全要素)│   │  时间轴布局)     │
└──────────────────┘   └──────────────────┘   └──────────────────┘
                                      │
                                      ▼
                       ┌──────────────────────────────────────────────┐
                       │  📒 账本与社会经济制度系统 (M1~M5 已落地)    │
                       │ (家户/婚姻/宗族/王国/帝国 · 旁路记账/分家继承/│
                       │  族税互助/公仓赋税救济/夺位远征/榷场商贸)     │
                       └──────────────────────────────────────────────┘
```

---

## 📑 模块导航（详细内容见 `docs/current/`）

| # | 功能模块 | 文档路径 | 主要内容 |
| :--- | :--- | :--- | :--- |
| 1 | 🗺️ 3D 空间拓扑与路网涌现系统 (`spatial`) | [01-spatial-network.md](./current/01-spatial-network.md) | 连续 3D 地形、贝塞尔路网、A\* 寻路、踏路成道、5 阶恒宽色彩 |
| 2 | 🌲 全局有限生态与 POI 资源体系 (`poi`) | [02-ecology-poi.md](./current/02-ecology-poi.md) | 23 处有限生态地标、储量/再生、Agent 私有施密特触发器、营地下行政升级 |
| 3 | ❄️ 四季更替与热力学供暖系统 (`seasons`) | [03-seasons-climate.md](./current/03-seasons-climate.md) | 240s 四季年轮模型、冬季供暖消耗、低温受孕安全红线 |
| 4 | 🧬 部落民生理代谢、繁衍与寿命 (`agent`) | [04-agent-life.md](./current/04-agent-life.md) | 生理指标、年龄两性分化、婚姻改嫁繁衍、先天禀赋、尸体风化 |
| 5 | 🏡 多级私产房屋与建材升级体系 (`house`) | [05-house-system.md](./current/05-house-system.md) | 5 级建筑形态、自然折旧修缮、空置房登记、二手房屋市场与营地麦穗 37% 拍卖系统 |
| 6 | 🧠 马斯洛需求层次与行动状态机 (Motivation AI) | [06-motivation-ai.md](./current/06-motivation-ai.md) | 6 层需求（⓪ 瞬间行为）、私有触发器、连续采收与平滑重路由、错峰决策节拍 |
| 6.2 | 意图类型与只读执行观察（M19.1） | [26-intent-observation.md](./current/26-intent-observation.md) | 已知分支转换、执行事实借用；原调度仍权威，无持久化字段 |
| 6.1 | 🔄 三大核心系统状态机架构全景 | [24-three-core-systems-fsm.md](./current/24-three-core-systems-fsm.md) | 马斯洛需求与动作、私产房屋与归宿拓扑、王国与帝国政体演化三大 FSM 图解与契约 |
| 7 | 🎨 交互式表现层与控制台 (`frontend`) | [07-frontend-ui.md](./current/07-frontend-ui.md) | Canvas 渲染管线、在售呼吸图标、Inspector、族谱时间轴、账本大盘、房屋拍卖交易所大盘、调试监视器 |
| 7.1 | 🧭 前端窗口结构与跳转关系 | [17-frontend-window-navigation.md](./current/17-frontend-window-navigation.md) | 主世界布局、常驻面板、模态窗口、独立族谱页、入口/返回/跨窗口跳转、设计契约 |
| 7.2 | 🧭 文档维护发现机制 | [18-doc-maintenance.md](./current/18-doc-maintenance.md) | 维护清单、源码/文档新鲜度检测、复核周期、CI 严格模式与人工确认流程 |
| 7.3 | ✅ Commit 前检查单 | [19-commit-checklist.md](./current/19-commit-checklist.md) | 提交前基础检查、Rust/WASM、前端、配置、诊断与最终 diff 审阅 |
| 7.4 | 🖥️ UI 页面全景剖析 | [21-ui-page-overview.md](./current/21-ui-page-overview.md) | Canvas 视口、顶栏状态栏、生态大盘、观察堆栈、控制台、模态弹窗、存档面板 |
| 7.5 | 🏛️ 制度大盘 UI 实现 (M1~M4) | [22-society-ledger-ui.md](./current/22-society-ledger-ui.md) | 4 标签页枢纽、M2 旁路记账/分家继承、M3 宗族公库、M4 王国政体、ASCII 线框原型 |
| 7.6 | 🛠️ 前端开发实施指南 | [23-ui-dev-guide.md](./current/23-ui-dev-guide.md) | 模块化分工、快照四处同步（★ M4）、CSS 设计系统、性能节流、验收门禁 |
| 8 | ⚙️ JavaScript 动态数值配置系统 (`config.js`) | [08-config-system.md](./current/08-config-system.md) | `window.SIM_CONFIG` 全量抽取、免编译热调优、config-check 校验 |
| 9 | 📂 核心代码目录与模块映射 | [09-code-map.md](./current/09-code-map.md) | `crates/` 与 `frontend/` 源码树结构 |
| 10 | 🚀 快速启动与体验 | [10-quickstart.md](./current/10-quickstart.md) | 浏览器 / Node 回归 / Rust 编译三种启动方式 |
| 12 | 📒 账本与社会经济制度系统 (`ledger`) | [12-ledger-system.md](./current/12-ledger-system.md) | 团体账本内核、婚姻登记簿、家户体系、宗族体系、地区王国政体、帝国上层政体 (M5)、胎儿 Agent 身份 |
| 13 | 🔗 跨模块影响矩阵 | [13-impact-matrix.md](./current/13-impact-matrix.md) | 改 X 牵动哪些文件的速查表、tick 内部调用顺序、数据流向图、脚本加载顺序、改动前自检清单 |
| 14 | 🔒 核心不变量集中清单 | [14-invariants.md](./current/14-invariants.md) | 确定性/数据一致性/行为语义/构建部署/代码组织/前端 DOM 六大类硬约束，每条标注来源与违反后果，末尾附 10 秒快速自检清单 |
| 15 | 💾 读档 / 存档系统 | [15-save-load.md](./current/15-save-load.md) | `WorldSave` 全量状态契约、排除字段与重建方式、WASM 导出与错误码、三槽位 localStorage 与导入导出、确定性验证与易踩坑 |
| 16 | 🏪 外部市场与动态价格系统 (`market`) | [16-market-pricing.md](./current/16-market-pricing.md) | 榷场互市 POI、次级库存、幂律动态定价、B15 榷场商贸决策、黄金流出虚空闭环 |
| 17 | 🌾 荒地开垦农田与农业税（设计稿） | [17-plan-farmland-agriculture.md](./17-plan-farmland-agriculture.md) | 农田生产资产、资本投资、农业税基、B19 自主投资分支与分阶段落地方案 |
| 18 | 🏹 打猎生态、防御流寇与武力公约（设计稿） | [18-plan-conflict-hunting-defense.md](./18-plan-conflict-hunting-defense.md) | 动态兽群狩猎、流民与外来流寇劫掠、民兵动员与公仓防御契约、生命力解耦与分阶段落地方案 |
| 19 | 🧠 决策架构重构：意图与执行策略解耦（M19 落地规划与技术规格） | [19-plan-agent-intent-strategy-decoupling.md](./19-plan-agent-intent-strategy-decoupling.md)<br/>[19-1-spec-intent-strategy-split-result.md](./19-1-spec-intent-strategy-split-result.md) | 意图仲裁-策略规划-原语执行三层解耦、ActiveTask 单一真相源、分级抢占、禀赋家资个性化、多品类预排队列与行程优化全落地 |
| 15+ | ⏱️ 性能 Profiling 基准与确定性矩阵 | [15-profiling-and-benchmarking-guide.md](./15-profiling-and-benchmarking-guide.md) | `profile-benchmark.js` 吞吐量/8大子阶段耗时拆解/快照序列化开销、`test-determinism.js` 6大确定性定理测试 |
| 16+ | 🚀 仿真内核与全链路性能优化规划书 | [16-plan-performance-optimization.md](./16-plan-performance-optimization.md) | 仅保留未完成计划：M5-1 消除超线性（P2）、M5-2 多线程 Fork-Join（条件触发） |
| 20 | 🛠️ 仿真内核与工程工具箱操作指南 | [20-tools-guide.md](./current/20-tools-guide.md) | `tools/` 全部 15 个工具（契约门禁/确定性测试/性能基准/无头诊断/族谱/版本治理）速查手册 |
| 25 | 🧭 竞品与同类项目分析 | [25-competitor-analysis.md](./current/25-competitor-analysis.md) | GitHub 同类项目横向比较、完成度判断、竞争位置与可借鉴研发方向 |
| — | 📜 版本演进记录 (Changelog) | [11-changelog.md](./current/11-changelog.md) | v0.9.24 ~ v1.46.0 各版本核心机制改动 |

---

## 🛠️ 维护指引

- **改动某项机制后**：在对应模块文件（`docs/current/0X-*.md`）中更新功能描述；若构成新版本，必须在 [11-changelog.md](./current/11-changelog.md) 追加版本条目，并按 [AGENTS.md §4.9](../AGENTS.md) 自增版本号。
- **文档维护体检**：日常运行 `node tools/doc-maintenance-check.js`；发布前运行 `node tools/doc-maintenance-check.js --strict`，处理源码领先、复核过期、缺失来源和未登记文档。
- **版本号四处同步**：① `frontend/index.html` 版本徽章 ② `AGENTS.md` §1 Mermaid 节点 ③ `AGENTS.md` §2 步骤四 ④ 本索引顶部「版本」与 Changelog 顶部。
- **新增功能模块**：在 `docs/current/` 下新建 `NN-*.md`（序号顺延），并在上方导航表登记。
