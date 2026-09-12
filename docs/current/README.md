# 现状 · 已实现功能全景

> 本目录描述**当前代码中真实存在的行为**。未实现的设计一律在 [`../plan/`](../plan/)。
> **版本**：v1.50.20（演进记录见 [./11-changelog.md](./11-changelog.md)）。
> 修改代码前的快速入口见 [`tech/68-workflow.md`](tech/68-workflow.md)。

---

## 两条入口

| 我想… | 去这里 |
| :--- | :--- |
| 理解玩法、规则与体验 | [`design/`](./design/) · 产品设计 |
| 改代码、查状态机与契约 | [`tech/`](./tech/) · 技术方案 |

---

## 产品设计 `design/`（玩家视角：看到什么、规则是什么）

| # | 文档 | 内容 |
| :---: | :--- | :--- |
| 10 | [产品总览](design/10-product-overview.md) | 定位、三条设计哲学、核心循环、八大看点、首局十个瞬间、玩家边界 |
| 11 | [世界与地图规则](design/11-world-rules.md) | 地图模板、八类地形、道路涌现、四季与气候、有效世界保障 |
| 12 | [族人、家庭与社会规则](design/12-life-and-society.md) | 马斯洛六层、生命周期与禀赋、房屋五级与拍卖、家户/宗族/王国/帝国 |
| 13 | [经济与资源规则](design/13-economy.md) | 23 处有限生态、真实搬运、家户账本唯一真相源、榷场幂律定价、族税与救济 |
| 14 | [观察与交互设计](design/14-observation-ux.md) | 窗口模型、观察工具、操作一览、视觉与信息层级 |

---

## 技术方案 `tech/`（实现视角：状态机、数据流、契约）

编号的**十位数字表示层**，由总体 → 上层 → 中层 → 下层 → 表现 → 工程。

### 1x · 总体与基座

| # | 文档 | 内容 |
| :---: | :--- | :--- |
| 10 | [引擎总体架构](tech/10-engine-architecture.md) | 三层解耦、文档地图、tick 内部顺序、数据流、配置注入 |
| 11 | [核心系统状态机全景](tech/11-core-systems-fsm.md) | 马斯洛动机、私产房屋与归宿、王国与帝国政体三大 FSM |
| 12 | [确定性](tech/12-determinism.md) | 确定性即玩法、RNG 分域、节拍、分批等价、门禁矩阵 |
| 13 | [配置系统](tech/13-config-system.md) | `SIM_CONFIG` 全量抽取、免编译热调优、config-check |
| 14 | [配置速查](tech/14-config-reference.md) | 全部可调超参字段/类型/默认值/中文说明（自动生成） |
| 15 | [快照与存档](tech/15-snapshot-and-save.md) | FABS 二进制帧、四处同步链、三槽位与本地文件直写、错误码 |

### 2x · 上层：社会与经济

| # | 文档 | 内容 |
| :---: | :--- | :--- |
| 20 | [账本与政体](tech/20-ledger-and-polity.md) | 团体账本内核、婚姻登记簿、家户、宗族、王国、帝国、胎儿身份 |
| 21 | [生态与 POI](tech/21-ecology-and-poi.md) | 23 处有限生态、储量再生、私有施密特触发器、采收与卸货 |
| 22 | [市场与定价](tech/22-market-pricing.md) | 榷场互市、幂律动态定价、断流兜底、黄金流出闭环 |

### 3x · 中层：个体与行为

| # | 文档 | 内容 |
| :---: | :--- | :--- |
| 30 | [生命周期](tech/30-agent-life-cycle.md) | 生理代谢、年龄两性分化、婚姻改嫁繁衍、禀赋遗传、尸体风化 |
| 31 | [决策引擎](tech/31-decision-engine.md) | 马斯洛六层、18 条分支、私有触发器、错峰节拍（附设计思路篇） |
| 32 | [M19 决策架构](tech/32-m19-architecture.md) | 意图—策略—原语三层解耦、ActiveTask 单一真相源、技术规格 |
| 33 | [房屋系统](tech/33-housing-system.md) | 五级形态、瞬时升级、折旧修缮、空置房登记与拍卖 |

### 4x · 下层：世界与物理

| # | 文档 | 内容 |
| :---: | :--- | :--- |
| 40 | [地形与路网](tech/40-terrain-and-network.md) | 地表单元、地貌特征、水体与资源池、装饰、地表查询、生成器、路网与通行 |
| 41 | [四季与气候](tech/41-seasons-climate.md) | 240s 年轮、气温演化、冬季供暖、低温受孕红线 |

### 5x · 表现层

| # | 文档 | 内容 |
| :---: | :--- | :--- |
| 50 | [前端总览](tech/50-frontend-overview.md) | 渲染管线、深度队列铁律、Inspector、族谱、调试监视器 |
| 51 | [季节光照](tech/51-seasonal-lighting.md) | 年周期光弧、地形重着色、立体面光照、世界空间阴影 |
| 52 | [水体渲染](tech/52-water-rendering.md) | 矢量河面、平滑漫滩、岸线微沫、游鱼与波光 |
| 53 | [UI 实现](tech/53-ui-implementation.md) | 页面全景剖析 + 窗口结构与跳转关系 |
| 54 | [制度大盘 UI](tech/54-society-ledger-ui.md) | 家户/婚姻/宗族/王国四标签页枢纽 |
| 55 | [前端开发指南](tech/55-frontend-dev-guide.md) | 模块化分工、快照四处同步、CSS 设计系统、性能节流 |

### 6x · 工程层

| # | 文档 | 内容 |
| :---: | :--- | :--- |
| 60 | [构建与运行](tech/60-build-and-run.md) | 工具链、WASM 编译与双副本、故障排查、快速启动 |
| 61 | [工具箱](tech/61-tools-guide.md) | `tools/` 全部工具速查 |
| 62 | [无头诊断](tech/62-diagnostics.md) | `diagnose.js` 指定 seed/tick 复现与八大嗅探规则 |
| 63 | [性能基准](tech/63-benchmarking.md) | `profile-benchmark.js` 吞吐与子阶段拆解、确定性矩阵 |
| 64 | [CI/CD](tech/64-cicd.md) | GitHub Actions → 腾讯云 COS |
| 65 | [浏览器自动化](tech/65-browser-automation.md) | 打开页面、渲染校验、截图、自动化交互 |
| 66 | [不变量](tech/66-invariants.md) | 六类硬约束集中清单（每条标注来源与违反后果） |
| 67 | [影响矩阵](tech/67-impact-matrix.md) | 改 X 牵动哪些文件、tick 顺序、数据流、脚本加载顺序 |
| 68 | [工作流](tech/68-workflow.md) | Agent 快速入口 + Commit 检查单 + 文档维护机制 |

### 9x · 附录

| # | 文档 | 内容 |
| :---: | :--- | :--- |
| 90 | [代码地图](tech/90-code-map.md) | `crates/` 与 `frontend/` 源码树（由 `code-map-check.js` 校验） |

---

## 维护约定

- 改动某项机制后，更新对应的 `tech/` 或 `design/` 文档，并在 [./11-changelog.md](./11-changelog.md) 追加版本条目。
- 日常运行 `node tools/doc-maintenance-check.js`；发布前追加 `--strict`。
- 版本号定义点由 `node tools/bump-version.js --patch` 统一同步（纯文档变更不升版）。
