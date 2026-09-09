# 9. 📂 核心代码目录与模块映射

> **模块索引**：[← 返回 01-current.md 全景索引](../01-current.md)
> 本文件源码树与实际仓库 100% 对应（最后核验：v1.46.21，由 `tools/code-map-check.js` 自动校验）。

---

```text
FlowAndAccord/
├── crates/
│   ├── sim_core/                           # 纯 Rust 确定性模拟内核
│   │   ├── examples/                       # 示例程序与探针
│   │   │   ├── config.json                 # 示例配置（M19 探针用）
│   │   │   └── m19_probe.rs                # M19 行为探针示例
│   │   └── src/
│   │       ├── config.rs                   # ⚙️ SimConfig 结构体 (227 字段，纯净 derive(Default)，JS 唯一真相源)
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
│   │           ├── ecology/                # 🌲 生态子模块 (7 文件)：播撒 + POI 采收装载 + 卸货入账 + 榷场结算
│   │           │   ├── mod.rs              # 生态子模块入口与拆分说明
│   │           │   ├── seed.rs             # 世界重置入口 + 播撒步骤编排 + 收尾 (索引/脏标记/APSP)
│   │           │   ├── spawn.rs            # POI 播撒/地形过渡节点/全图路网连接/始祖出生地兜底节点
│   │           │   ├── founder.rs          # 始祖生成 + 家户/宗族/地区/帝国制度登记
│   │           │   ├── tick.rs             # tick_poi_interactions 调度壳 (遍历/胎儿跳过/分娩委托/尸骸清理)
│   │           │   ├── harvest.rs          # 现场采收 (水/粮/木/石/金) 与榷场采购结算
│   │           │   └── home.rs             # 回家卸货入账 (Deposit) 与在家吃喝 (Consume)
│   │           ├── birth.rs                # 妊娠结算、分娩、新生儿属性遗传
│   │           ├── bookkeeping.rs          # ★ M2 家庭生命周期结算 (继承清算 + 分家抽资；M6 起日常收付改由生态/维护层真实记账)
│   │           ├── world.rs                # World3DEngine 结构体定义与生命周期
│   │           ├── world_config.rs         # 动态配置注入与 JSON 反序列化
│   │           ├── world_save.rs           # 确定性存读档序列化与反序列化
│   │           ├── world_season.rs         # 四季与宏观温度时变计算
│   │           ├── world_snapshot.rs       # generate_snapshot 快照数据组装
│   │           ├── world_tick.rs           # tick 管线调度（§4.3 固定顺序）+ 胎儿对账 + 金币继承
│   │           ├── snapshot.rs             # 快照结构体定义 (Agent/House/POI/Household/Marriage/Clan/Region/Ledger)
│   │           ├── snapshot_bin/           # ★ M4 FABS 二进制快照编码层（四处同步第 3 处，与 snapshot.rs 等价）
│   │           │   ├── mod.rs              # snapshot_bin 模块入口
│   │           │   ├── layout.rs           # 二进制帧布局与字段偏移
│   │           │   ├── encode.rs           # FABS 帧编码 (枚举码位/驻留表/字段顺序)
│   │           │   ├── strtab.rs           # 字符串驻留表 (StrTab, start_index==0 判全新表)
│   │           │   └── dict.rs             # 枚举名称表 (*_code() / *_table())
│   │           ├── decisions/              # 🧠 马斯洛决策子系统 (16 文件, M19 意图-策略-原语解耦)
│   │           │   ├── mod.rs              # 决策子模块入口与重新导出
│   │           │   ├── intent.rs           # M19 意图与完成条件类型 (AgentIntent / IntentKind / CompletionPolicy)
│   │           │   ├── strategy.rs         # M19 策略与阶段类型 (ActiveTask / ExecutionStrategy / ResourceStage / CommitStage)
│   │           │   ├── primitive.rs        # M19 动作原语描述类型 (ActionPrimitive / ArrivalKind / HoldKind)
│   │           │   ├── projection.rs       # M19.2 兼容视图纯投影 (compatible_legacy_state)
│   │           │   ├── transition.rs       # M19.2/M19.3 统一生命周期转换器 (install_task / advance_stage / on_navigation_arrived / finish_task)
│   │           │   ├── observation.rs      # 不可变执行观察与旧枚举无损视图 (observe_execution)
│   │           │   ├── branches.rs         # ★ 16 条活跃分支注册表（稳定 ID 保留 b11/b15 空位，自包含条件函数，Rust 侧无顺序）
│   │           │   ├── needs.rs            # NeedKind 需求定义、升级材料成本 (upgrade_material_cost)、家户缺口计算
│   │           │   ├── evaluate.rs         # Decisioner 结构体 + L1 持续仲裁 / 瞬发通道 + L2 策略派发 / 节拍推进
│   │           │   ├── routing.rs          # 导航/寻路/原地掉头/返家/POI 触发器可用性 / 归家任务同步
│   │           │   ├── harvest.rs          # 现场采收判定 + 行囊满额查询 + L1 连续采收候选仲裁 + 单趟多品类连续采收
│   │           │   ├── seeking.rs          # 途中熔断与平滑重路由 (★v1.27.0 try_route_to_market 断流直达榷场)
│   │           │   ├── market.rs           # 外部商贸决策子模块 (evaluate_market_trade / 途中可用性 / 现场交易完成返家)
│   │           │   ├── preemption.rs       # ★ M19.4b 分级任务抢占 (危机抢占/平滑中断/行囊保全)
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
│   │   ├── config.js                       # ⚙️ 主配置 (window.SIM_CONFIG, 199 字段)
│   │   ├── config.decision-order.js        # ★ 决策分支顺序唯一真相源（16 条活跃分支 + 层级覆盖，§4.12 文档化例外）
│   │   ├── config.house-upgrade-cost.js    # ★ M8 房屋升级材料成本矩阵 (20 字段 = 4级×5资源，Object.assign 合并进 SIM_CONFIG)
│   │   ├── config.poi-rates.js             # POI 产速本地偏好 (localStorage 倍率，world_create 前读取，可复现演化)
│   │   ├── math.js                         # 3D 向量与投影变换
│   │   ├── decision-viz-data.js            # 决策分支元数据 (BRANCH_MAP 条件文案/层级/图标 + FSM_STATE_ZH 中文映射)
│   │   ├── decision-viz-view.js            # 决策引擎覆层 DOM 渲染 (Branch 分支卡/分界线/检查器/拖动)
│   │   ├── decision-viz.js                 # 决策可视化窗口控制器与状态桥接
│   │   ├── auction-ui.js                   # 房屋麦穗拍卖交易所大盘与竞价面板
│   │   ├── entity-link.js                  # 跨面板族人/房屋/POI/团体实体下钻跳转交互
│   │   ├── sim_worker.js                   # ★ v1.38.0 仿真内核专用 Web Worker (后台独立线程加载 WASM、自主步进与快照背压推送)
│   │   ├── snapshot-bin.js                 # ★ M4 FABS 二进制帧解码器 (strCache 驻留表缓存, start_index==0 判全新表, 四处同步第 4 处)
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
# frontend/public/ = 对象存储借用测试页目录（elder.html 等），非本项目产物，code-map 扫描已屏蔽
├── tools/
│   ├── baseline-default-800k.json          # 默认配置 80 万 tick 性能基准数据
│   ├── baseline-m19-observation.json       # ★ M19.0 冻结观察基线 (gen-m19-baseline.js 产出，差分回归真值)
│   ├── baseline-maxyield-800k.json         # B2 满载 80 万 tick 基准数据 (profile-benchmark --json 产物)
│   ├── baseline-maxyield-800k-m5.json      # B2 满载 800k tick 复测入库 (v1.46.0 T1 门禁产物)
│   ├── bump-version.js                     # 版本号统一升版器 (真相源对齐与 8+ 处定义点同步)
│   ├── code-map-check.js                   # ★ 代码地图一致性校验 (实际文件 vs 09-code-map.md 登记 + 描述漂移检测)
│   ├── config-check.js                     # 前后端配置一致性校验 (含 config.house-upgrade-cost.js) + 06-config-reference.md 自动生成
│   ├── cross-doc-check.js                  # ★ 跨文档事实指纹一致性检查 (同指纹多文档值不同即冲突，配置值另与权威比对)
│   ├── dag-shot.js                         # 族谱多档位无头截图验证 (Node 加载 FlowDag + Chrome headless)
│   ├── diagnose.js                         # 确定性无头内核诊断与 Bug 嗅探工具 (指定 seed/tick 极速排障)
│   ├── doc-maintenance-check.js            # 文档维护体检器 (新鲜度、复核周期与维护清单扫描)
│   ├── frontend-check.js                   # 前端静态一致性与 JS 语法校验门禁 (含 getElementById DOM ID 存在性检查)
│   ├── gen-dag-testdata.js                 # 族谱布局参数拟合测试数据生成 (驱动 sim_wasm 跑满 50 万 tick)
│   ├── gen-m19-baseline.js                 # ★ M19.0 冻结基线生成 (长程演化导出观察基线 JSON)
│   ├── gold_mining_analysis.js             # 淘金与货币经济行为专项分析脚本
│   ├── profile-benchmark.js                # 性能 Profiling 基准测试与微秒级子阶段剖析器
│   ├── rust-download.js                    # Rust 工具链下载器 (Node OpenSSL TLS 绕过系统证书异常)
│   ├── snapshot-check.js                   # ★ 快照同步静态校验 (snapshot.rs定义 vs world_snapshot.rs赋值 vs rustworld.js映射)
│   ├── snapshot-reader.js                  # ★ T1(v1.46.0) FABS 统一快照读取器：tools/ 全部工具唯一取值入口（FABS 优先、JSON 仅调试回退）
│   ├── test-determinism.js                 # 增强型确定性矩阵测试套件 (6 大数学不变量定理验证)
│   ├── test-itinerary.js                   # ★ M19.4d 多品类预排采收行程验证 (链路/TSP 排序/多站推进/长程确定性)
│   ├── test-m19-differential.js            # ★ M19 差分回归 (3600 tick 存档与快照哈希逐字节一致性)
│   ├── test-personalization.js             # ★ M19.4c 禀赋与家资个性化选策验证
│   ├── test-preemption.js                  # ★ M19.4b 分级任务抢占验证 (危机抢占/平滑中断/行囊保全)
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
    ├── 19-1-spec-intent-strategy-split-result.md  # M19 意图-策略拆分结果规格
    ├── 19-plan-agent-intent-strategy-decoupling.md # 决策意图-策略解耦规划书 (M19)
    ├── 20-plan-everyday-life.md               # 日常生活演化规划书
    ├── 21-plan-terrain-art.md                 # 地形美术规划书
    ├── 22-plan-terrain-features.md            # 地形特征规划书
    ├── 23-plan-memory-system.md               # 记忆系统规划书
    ├── 24-plan-internal-market.md             # 内部市场规划书
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
    │   ├── 14-plan-todo-followup-v1.27.md
    │   └── 19-m19-baseline-audit.md        # M19 基线审计归档
    └── current/                             # 已实现功能按模块拆分文档
        ├── 00-agent-start.md                # Agent 快速入口 (改动类型→局部指南+门禁)
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
        ├── 23-ui-dev-guide.md              # 🛠️ 前端开发实施指南
        ├── 24-three-core-systems-fsm.md    # ★ 三大核心系统状态机全景 (马斯洛/私宅/王国政体)
        ├── 25-competitor-analysis.md       # 竞品与同类作品分析
        └── 26-intent-observation.md        # M19.1 意图类型与只读执行观察
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
