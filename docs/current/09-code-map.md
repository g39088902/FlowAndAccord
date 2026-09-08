# 9. 📂 核心代码目录与模块映射

> **模块索引**：[← 返回 01-current.md 全景索引](../01-current.md)
> 本文件源码树与实际仓库 100% 对应（最后核验：v1.5.1，由 `tools/code-map-check.js` 自动校验）。

---

```text
FlowAndAccord/
├── crates/
│   ├── sim_core/                           # 纯 Rust 确定性模拟内核
│   │   └── src/
│   │       ├── config.rs                   # ⚙️ SimConfig 结构体 (211 字段，纯净 derive(Default)，JS 唯一真相源)
│   │       ├── lib.rs                      # crate 入口与模块导出
│   │       ├── rng.rs                      # WorldRng 全局共享确定性随机数
│   │       ├── geo/                        # 🌍 地形与生物群系
│   │       │   ├── mod.rs                  # geo 模块入口
│   │       │   ├── terrain.rs              # 连续 3D 地形高程采样
│   │       │   └── biome.rs                # 生物群系定义
│   │       └── spatial/                    # 🗺️ 空间模拟核心
│   │           ├── mod.rs                  # spatial 模块集成入口
│   │           ├── vec3.rs                 # 3D 向量数学库
│   │           ├── curve.rs                # 三次贝塞尔曲线定义与采样
│   │           ├── graph.rs                # LaneGraph3D 拓扑路网 + A* 寻路 + 踩踏衰减
│   │           ├── poi.rs                  # 23 处 POI 实体定义 (营地4/泉6/果6/木3/石2/金1/榷场互市1)
│   │           ├── house.rs                # 5 阶房屋模型、耐久度与户主绑定 (M6 起无仓储，家户账本为唯一真相源)
│   │           ├── agent.rs                # 部落民实体、生理代谢、随身行囊、运动与状态机
│   │           ├── ecology.rs              # 生态初始化、POI 采收装载、回家卸货入账、榷场交易结算
│   │           ├── birth.rs                # 妊娠结算、分娩、新生儿属性遗传
│   │           ├── bookkeeping.rs          # ★ M2 家庭生命周期结算 (继承清算 + 分家抽资；M6 起日常收付改由生态/维护层真实记账)
│   │           ├── world.rs                # World3DEngine 结构体定义与生命周期
│   │           ├── world_config.rs         # 动态配置注入与 JSON 反序列化
│   │           ├── world_save.rs           # 确定性存读档序列化与反序列化
│   │           ├── world_season.rs         # 四季与宏观温度时变计算
│   │           ├── world_snapshot.rs       # generate_snapshot 快照数据组装
│   │           ├── world_tick.rs           # tick 管线调度（§4.3 固定顺序）+ 胎儿对账 + 金币继承
│   │           ├── snapshot.rs             # 快照结构体定义 (Agent/House/POI/Household/Marriage/Clan/Region/Ledger)
│   │           ├── decisions/              # 🧠 马斯洛决策子系统 (15 文件, M19 意图-策略-原语解耦)
│   │           │   ├── mod.rs              # 决策子模块入口与重新导出
│   │           │   ├── intent.rs           # M19 意图与完成条件类型 (AgentIntent / IntentKind / CompletionPolicy)
│   │           │   ├── strategy.rs         # M19 策略与阶段类型 (ActiveTask / ExecutionStrategy / ResourceStage / CommitStage)
│   │           │   ├── primitive.rs        # M19 动作原语描述类型 (ActionPrimitive / ArrivalKind / HoldKind)
│   │           │   ├── projection.rs       # M19.2 兼容视图纯投影 (compatible_legacy_state)
│   │           │   ├── transition.rs       # M19.2/M19.3 统一生命周期转换器 (install_task / advance_stage / on_navigation_arrived / finish_task)
│   │           │   ├── observation.rs      # 不可变执行观察与旧枚举无损视图 (observe_execution)
│   │           │   ├── branches.rs         # ★ 18 条分支注册表 (BranchId ↔ b1~b18，自包含条件函数，Rust 侧无顺序)
│   │           │   ├── needs.rs            # NeedKind 需求定义、升级材料成本 (upgrade_material_cost)、家户缺口计算
│   │           │   ├── evaluate.rs         # Decisioner 结构体 + L1 持续仲裁 / 瞬发通道 + L2 策略派发 / 节拍推进
│   │           │   ├── routing.rs          # 导航/寻路/原地掉头/返家/POI 触发器可用性 / 归家任务同步
│   │           │   ├── harvest.rs          # 现场采收判定 + 行囊满额查询 + L1 连续采收候选仲裁 + 单趟多品类连续采收
│   │           │   ├── seeking.rs          # 途中熔断与平滑重路由 (★v1.27.0 try_route_to_market 断流直达榷场)
│   │           │   ├── market.rs           # 外部商贸决策子模块 (evaluate_market_trade / 途中可用性 / 现场交易完成返家)
│   │           │   └── scheduler.rs        # tick_decisions + execute_pending_coronations(★M4登基) + build_decision_context
│   │           ├── housing_system/         # 🏡 房屋全生命周期子系统 (7 文件)
│   │           │   ├── mod.rs              # 房屋系统 tick 管线入口
│   │           │   ├── auction.rs          # 营地麦穗 37% 拍卖机制与出价受理
│   │           │   ├── maintenance.rs      # 冬季供暖与耐久修缮结算
│   │           │   ├── construction.rs     # 升级瞬时竣工 (M6 起一次性扣账无工时) + 材料成本校验
│   │           │   ├── marriage.rs         # 自动成婚与丧偶改嫁匹配 (M6 起遍历家户户主)
│   │           │   ├── settlement.rs       # 立宅选址校验、路网接入、空置节点复用
│   │           │   └── inheritance.rs      # 空置房登记（户主亡故→无主→营地列表+受益人）
│   │           └── ledger/                  # 📒 账本与社会经济制度子系统 (8 文件, M1~M5)
│   │               ├── mod.rs              # ledger 模块入口与重新导出
│   │               ├── journal.rs          # 账本内核 (ResourceKind/Ledger/TransferRecord/TransferReason/LedgerRef)
│   │               ├── group.rs            # 团体基类 (leader + members + ledger, GroupKind: Family/Clan/Region)
│   │               ├── marriage.rs         # 婚姻登记簿 (终身多段婚姻全留痕、存续唯一性)
│   │               ├── family.rs           # 家户体系 (家庭跟着男人走、户主男性锚定、改嫁先移后加)
│   │               ├── clan.rs             # ★ M3 宗族系统 (ClanRegistry/族长顺位/族税/互助)
│   │               ├── region.rs           # ★ M4 地区与王国系统 (RegionRegistry/初王/继承/公仓税/救济)
│   │               └── empire.rs           # ★ M5 帝国与联邦系统 (EmpireRegistry/上层政体)
│   └── sim_wasm/                           # 🔌 WASM 零依赖 FFI 导出层
│       └── src/
│           └── lib.rs                      # 导出函数、静态缓冲区、错误码、指针约定、双副本同步
├── frontend/
│   ├── js/
│   │   ├── config.js                       # ⚙️ 主配置 (window.SIM_CONFIG, 149 字段)
│   │   ├── config.decision-order.js        # ★ 决策分支顺序唯一真相源 (18 条 b1~b18 + 层级覆盖，b14 夺位置首，§4.12 文档化例外)
│   │   ├── config.house-upgrade-cost.js    # ★ M8 房屋升级材料成本矩阵 (20 字段 = 4级×5资源，Object.assign 合并进 SIM_CONFIG)
│   │   ├── math.js                         # 3D 向量与投影变换
│   │   ├── decision-viz-data.js            # 决策分支元数据 (BRANCH_MAP 条件文案/层级/图标 + FSM_STATE_ZH 中文映射)
│   │   ├── decision-viz-view.js            # 决策引擎覆层 DOM 渲染 (Branch 分支卡/分界线/检查器/拖动)
│   │   ├── decision-viz.js                 # 决策可视化窗口控制器与状态桥接
│   │   ├── auction-ui.js                   # 房屋麦穗拍卖交易所大盘与竞价面板
│   │   ├── entity-link.js                  # 跨面板族人/房屋/POI/团体实体下钻跳转交互
│   │   ├── sim_worker.js                   # ★ v1.38.0 仿真内核专用 Web Worker (后台独立线程加载 WASM、自主步进与快照背压推送)
│   │   ├── rustworld.js                    # ★ v1.38.0 主线程仿真代理层、快照映射、Worker 生命周期管理、agentArchive 全量档案库
│   │   ├── dag-layout.js                   # 族谱时间轴布局数学 (纯函数, 零 DOM)
│   │   ├── dag-view.js                     # 族谱虚拟化渲染 + LOD + pan/zoom + 刻度尺
│   │   ├── dag-standalone.js               # 族谱独立新标签页 HTML 模板
│   │   ├── dag.js                          # 族谱数据构建 + 模态编排 + Inspector
│   │   ├── main.js                         # 页面交互、控制台、事件绑定、相机控制
│   │   ├── ledger-ui.js                    # ★ 社会与经济制度大盘 4 标签页 (家户/婚姻/宗族/王国)
│   │   ├── save-ui.js                      # ★ 读档/存档系统 UI (三槽位 localStorage + v1.11.0 本地文件直写 File System Access API)
│   │   ├── render_canvas.js                # Canvas 渲染主循环、帧率控制与共享状态 (30 FPS)
│   │   ├── render_world.js                 # 地形高程网格、车道贝塞尔曲线、POI 与私宅绘制
│   │   ├── render_agents.js                # 族人粒子、马斯洛气泡、行囊搬运与登基礼花特效
│   │   ├── render_inspector.js             # 拾取光标、族人/房屋/地标检查器面板渲染
│   │   └── render_hud.js                   # 顶部 HUD 数据栏、四季指针与系统控制状态
│   ├── rust/
│   │   └── sim_wasm.wasm                   # WASM 编译产物主副本 (rustworld.js 实际 fetch 路径)
│   ├── sim_wasm.wasm                       # WASM 编译产物根目录备用副本
│   ├── server.js                           # 静态文件开发服务器 (内置 .wasm MIME + POST /save-decision-order, 默认 3000 端口)
│   ├── index.html                          # 完整单页可视化仿真系统 (14 script 按序加载)
│   └── style.css                           # 全局样式
├── tools/
│   ├── bump-version.js                     # 版本号统一升版器 (真相源对齐与 8+ 处定义点同步)
│   ├── code-map-check.js                   # ★ 代码地图一致性校验 (实际文件 vs 09-code-map.md 登记 + 描述漂移检测)
│   ├── config-check.js                     # 前后端配置一致性校验 (含 config.house-upgrade-cost.js) + 06-config-reference.md 自动生成
│   ├── dag-shot.js                         # 族谱多档位无头截图验证 (Node 加载 FlowDag + Chrome headless)
│   ├── diagnose.js                         # 确定性无头内核诊断与 Bug 嗅探工具 (指定 seed/tick 极速排障)
│   ├── doc-maintenance-check.js            # 文档维护体检器 (新鲜度、复核周期与维护清单扫描)
│   ├── frontend-check.js                   # 前端静态一致性与 JS 语法校验门禁 (含 getElementById DOM ID 存在性检查)
│   ├── gen-dag-testdata.js                 # 族谱布局参数拟合测试数据生成 (驱动 sim_wasm 跑满 50 万 tick)
│   ├── gold_mining_analysis.js             # 淘金与货币经济行为专项分析脚本
│   ├── profile-benchmark.js                # 性能 Profiling 基准测试与微秒级子阶段剖析器
│   ├── rust-download.js                    # Rust 工具链下载器 (Node OpenSSL TLS 绕过系统证书异常)
│   ├── snapshot-check.js                   # ★ 快照同步静态校验 (snapshot.rs定义 vs world_snapshot.rs赋值 vs rustworld.js映射)
│   ├── snapshot-reader.js                  # ★ T1(v1.46.0) FABS 统一快照读取器：tools/ 全部工具唯一取值入口（FABS 优先、JSON 仅调试回退）
│   ├── test-determinism.js                 # 增强型确定性矩阵测试套件 (6 大数学不变量定理验证)
│   ├── test-snapshot-bin.js                # ★ M4 四处同步防漂移门禁：FABS 二进制帧 vs JSON 真值逐字段深比较（4 场景，含跨世界驻留表）
│   ├── test-wasm.js                        # WASM 回归测试 (确定性/防越界/防 NaN/长程稳定)
│   └── vendor-deps.js                      # 依赖图 BFS vendor 解析器 (crates.io API 发现并下载全部依赖到 .vendor/)
├── .github/
│   └── workflows/
│       └── deploy.yml                      # CI/CD 自动部署 (GitHub Actions → 腾讯云 COS)
├── AGENTS.md                                # 📖 智能体操作指南 (唯一保留在根目录的文档)
├── TODO.md                                  # 待办事项清单
└── docs/                                    # 📚 全部项目文档
    ├── README.md                              # 文档导航与归档规则
    ├── 01-current.md                           # 已实现功能「索引入口」(模块导航表)
    ├── 02-build-guide.md                       # 编译与运行深度指南
    ├── 03-browser-guide.md                     # 浏览器自动化使用指南 (playwright-cli)
    ├── 04-cicd-guide.md                        # CI/CD 自动部署指南
    ├── 05-headless-diagnostics-guide.md        # 确定性无头诊断指南 (diagnose.js SOP)
    ├── 06-config-reference.md                  # 参数速查表 (由 config-check.js 自动生成, 勿手改)
    ├── 07-agent-ai-analysis.md                 # 部落民 AI 决策系统深度拆解
    ├── 11-plan.md                              # 项目长期规划书
    ├── 15-profiling-and-benchmarking-guide.md  # 性能 Profiling 基准与确定性矩阵操作指南
    ├── 16-plan-performance-optimization.md     # 仿真内核与全链路性能优化规划书 (M1~M4 已归档 / T1+M5 待办)
    ├── 17-plan-farmland-agriculture.md         # 农田生产与农业税规划书
    ├── 18-plan-conflict-hunting-defense.md     # 生态狩猎、流寇危机与武力公约规划书
    ├── decision-viz-prototype.html          # 决策可视化交互原型
    ├── decision-viz-live-tab.png            # 决策可视化实时监控页截图
    ├── decision-viz-logic-tab.png           # 决策可视化逻辑引擎页截图
    ├── doc-maintenance.json                 # 文档维护清单契约配置文件
    ├── archive/                              # 已完成或被替代的历史设计稿
    │   ├── README.md
    │   ├── 08-decision-viz-design.md
    │   ├── 10-architecture.md
    │   ├── 12-plan-ledger-refactor.md
    │   ├── 13-plan-house-upgrade-auction.md
    │   └── 14-plan-todo-followup-v1.27.md
    └── current/                             # 已实现功能按模块拆分文档
        ├── 01-spatial-network.md
        ├── 02-ecology-poi.md
        ├── 03-seasons-climate.md
        ├── 04-agent-life.md
        ├── 05-house-system.md
        ├── 06-motivation-ai.md
        ├── 07-frontend-ui.md
        ├── 08-config-system.md
        ├── 09-code-map.md
        ├── 10-quickstart.md
        ├── 11-changelog.md
        ├── 12-ledger-system.md
        ├── 13-impact-matrix.md             # ★ 跨模块影响矩阵 (改 X 牵动哪些文件 + tick 顺序 + 数据流 + 自检清单)
        ├── 14-invariants.md                # ★ 核心不变量集中清单
        ├── 15-save-load.md                 # 读档 / 存档系统全量契约
        ├── 16-market-pricing.md            # 🏪 外部市场与动态价格系统
        ├── 17-frontend-window-navigation.md # 前端窗口结构与跳转关系指南
        ├── 18-doc-maintenance.md           # 文档维护发现机制
        ├── 19-commit-checklist.md          # Commit 前检查单
        ├── 20-tools-guide.md               # 🛠️ 仿真内核与工程工具箱操作指南 (15 工具全貌)
        ├── 21-ui-page-overview.md          # 🖥️ UI 页面全景剖析
        ├── 22-society-ledger-ui.md         # 🏛️ 制度大盘 UI 实现 (M1~M4)
        └── 23-ui-dev-guide.md              # 🛠️ 前端开发实施指南
```

## 目录级 AGENTS.md
复杂代码目录内维护局部 AGENTS.md，改对应目录代码前先读：
- `crates/sim_core/AGENTS.md`
- `crates/sim_wasm/AGENTS.md`
- `crates/sim_core/src/spatial/AGENTS.md`
- `crates/sim_core/src/spatial/decisions/AGENTS.md`
- `crates/sim_core/src/spatial/housing_system/AGENTS.md`
- `crates/sim_core/src/spatial/ledger/AGENTS.md`
- `frontend/AGENTS.md`

## 自动校验
本文件由 `node tools/code-map-check.js` 校验，捕获：文档缺失 / 文档过时 / 描述关键词漂移 / 嵌套 AGENTS.md 缺失。CI 可纳入此校验。

## M19.1 类型与只读观察入口

`decisions/intent.rs` 定义意图并转换已知来源的 Need；`strategy.rs` / `primitive.rs` 定义计划词汇；`observation.rs` 为 Agent 提供借用式执行事实与旧状态无损视图。旧 evaluate/routing/scheduler 继续执行，不存在第二个调度器。API 与存储边界见 [26-intent-observation.md](./26-intent-observation.md)。
