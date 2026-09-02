# 9. 📂 核心代码目录与模块映射

> **模块索引**：[← 返回 CURRENT.md 全景索引](../CURRENT.md)
> 本文件源码树与实际仓库 100% 对应（最后核验：v1.5.1，由 `tools/code-map-check.js` 自动校验）。

---

```text
FlowAndAccord/
├── crates/
│   ├── sim_core/                           # 纯 Rust 确定性模拟内核
│   │   └── src/
│   │       ├── config.rs                   # ⚙️ SimConfig 结构体 (169 字段) + 默认常量
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
│   │           ├── poi.rs                  # 23 处 POI 实体定义 (营地5/泉6/果6/木3/石2/金1)
│   │           ├── house.rs                # 5 阶房屋模型、耐久度与户主绑定 (M6 起无仓储，家户账本为唯一真相源)
│   │           ├── agent.rs                # 部落民实体、生理代谢、随身行囊、运动与状态机
│   │           ├── ecology.rs              # 生态初始化、POI 采收装载、回家卸货入账
│   │           ├── birth.rs                # 妊娠结算、分娩、新生儿属性遗传
│   │           ├── bookkeeping.rs          # ★ M2 家庭生命周期结算 (继承清算 + 分家抽资；M6 起日常收付改由生态/维护层真实记账)
│   │           ├── world.rs                # World3DEngine 世界调度、四季温度、快照生成、配置注入
│   │           ├── snapshot.rs             # 快照结构体定义 (Agent/House/POI/Household/Marriage/Clan/Region/Ledger)
│   │           ├── decisions/              # 🧠 马斯洛决策子系统 (8 文件)
│   │           │   ├── mod.rs              # 决策子模块入口与重新导出
│   │           │   ├── branches.rs         # ★ 13 条分支注册表 (BranchId ↔ b1~b13，自包含条件函数，Rust 侧无顺序)
│   │           │   ├── needs.rs            # NeedKind 需求定义、升级材料成本 (upgrade_material_cost)、家户缺口计算
│   │           │   ├── evaluate.rs         # Decisioner 结构体 + decide/evaluate_needs (按配置顺序迭代分支)
│   │           │   ├── routing.rs          # 导航/寻路/原地掉头/返家/POI 触发器可用性
│   │           │   ├── harvest.rs          # 现场采收判定 + 行囊满额查询 (M7 起读 family_stock_active)
│   │           │   ├── seeking.rs          # 途中熔断与平滑重路由
│   │           │   └── scheduler.rs        # tick_decisions + tick_conquest_expedition(★M4夺位) + build_decision_context
│   │           ├── housing_system/         # 🏡 房屋全生命周期子系统 (7 文件)
│   │           │   ├── mod.rs              # 房屋系统 tick 管线入口
│   │           │   ├── maintenance.rs      # 冬季供暖与耐久修缮结算
│   │           │   ├── construction.rs     # 升级瞬时竣工 (M6 起一次性扣账无工时) + 材料成本校验
│   │           │   ├── marriage.rs         # 自动成婚与丧偶改嫁匹配 (M6 起遍历家户户主)
│   │           │   ├── settlement.rs       # 立宅选址校验、路网接入、空置节点复用
│   │           │   └── inheritance.rs      # 父系继承与绝嗣废墟处理
│   │           └── ledger/                  # 📒 账本与社会经济制度子系统 (7 文件, M1~M4)
│   │               ├── mod.rs              # ledger 模块入口与重新导出
│   │               ├── journal.rs          # 账本内核 (ResourceKind/Ledger/TransferRecord/TransferReason/LedgerRef)
│   │               ├── group.rs            # 团体基类 (leader + members + ledger, GroupKind: Family/Clan/Region)
│   │               ├── marriage.rs         # 婚姻登记簿 (终身多段婚姻全留痕、存续唯一性)
│   │               ├── family.rs           # 家户体系 (家庭跟着男人走、户主男性锚定、改嫁先移后加)
│   │               ├── clan.rs             # ★ M3 宗族系统 (ClanRegistry/族长顺位/族税/互助)
│   │               └── region.rs           # ★ M4 地区与王国系统 (RegionRegistry/初王/继承/公仓税/救济)
│   └── sim_wasm/                           # 🔌 WASM 零依赖 FFI 导出层
│       └── src/
│           └── lib.rs                      # 导出函数、静态缓冲区、错误码、指针约定、双副本同步
├── frontend/
│   ├── js/
│   │   ├── config.js                       # ⚙️ 主配置 (window.SIM_CONFIG, 149 字段)
│   │   ├── config.decision-order.js        # ★ 决策分支顺序唯一真相源 (13 条 b1~b13 + 层级覆盖，§4.12 文档化例外)
│   │   ├── config.house-upgrade-cost.js    # ★ M8 房屋升级材料成本矩阵 (20 字段 = 4级×5资源，Object.assign 合并进 SIM_CONFIG)
│   │   ├── math.js                         # 3D 向量与投影变换
│   │   ├── decision-viz-data.js            # 决策分支元数据 (BRANCH_MAP 条件文案/层级/图标 + FSM_STATE_ZH 中文映射)
│   │   ├── decision-viz-view.js            # 决策引擎覆层 DOM 渲染 (分支卡/分界线/层级图例/检查器/拖动)
│   │   ├── decision-viz.js                 # 决策引擎集成层 (合并配置进 SIM_CONFIG / 拖动热注入 / POST 写盘 / localStorage 降级)
│   │   ├── rustworld.js                    # WASM 桥接层、快照映射、Config 注入驱动、agentArchive 全量档案库
│   │   ├── dag-layout.js                   # 族谱时间轴布局数学 (纯函数, 零 DOM)
│   │   ├── dag-view.js                     # 族谱虚拟化渲染 + LOD + pan/zoom + 刻度尺
│   │   ├── dag-standalone.js               # 族谱独立新标签页 HTML 模板
│   │   ├── dag.js                          # 族谱数据构建 + 模态编排 + Inspector
│   │   ├── main.js                         # 页面交互、控制台、事件绑定、相机控制
│   │   ├── ledger-ui.js                    # ★ 社会与经济制度大盘 4 标签页 (家户/婚姻/宗族/王国)
│   │   └── render.js                       # Canvas 渲染、Inspector、顶栏、大盘、调试监视器 (2130行，待拆分)
│   ├── rust/
│   │   └── sim_wasm.wasm                   # WASM 编译产物主副本 (rustworld.js 实际 fetch 路径)
│   ├── sim_wasm.wasm                       # WASM 编译产物根目录备用副本
│   ├── server.js                           # 静态文件开发服务器 (内置 .wasm MIME + POST /save-decision-order, 默认 3000 端口)
│   ├── index.html                          # 完整单页可视化仿真系统 (14 script 按序加载)
│   └── style.css                           # 全局样式
├── tools/
│   ├── test-wasm.js                        # WASM 回归测试 (确定性/防越界/防 NaN/长程稳定)
│   ├── config-check.js                     # 前后端配置一致性校验 (含 config.house-upgrade-cost.js) + config-reference.md 自动生成
│   ├── code-map-check.js                   # ★ 代码地图一致性校验 (实际文件 vs 09-code-map.md 登记 + 描述漂移检测 + 嵌套 AGENTS.md 覆盖)
│   ├── snapshot-check.js                   # ★ 快照三处同步校验 (snapshot.rs定义 vs world.rs赋值 vs rustworld.js映射)
│   ├── gen-dag-testdata.js                 # 族谱布局参数拟合测试数据生成 (驱动 sim_wasm 跑满 50 万 tick)
│   ├── dag-shot.js                         # 族谱多档位截图验证 (Node 中 eval 加载 dag 模块 + Chrome headless)
│   ├── rust-download.js                    # Rust 工具链下载器 (Node OpenSSL TLS, 下载 rustc/cargo/rust-std windows+wasm32)
│   └── vendor-deps.js                      # 依赖图 BFS vendor 解析器 (crates.io API 发现并下载全部依赖到 .vendor/)
├── .github/
│   └── workflows/
│       └── deploy.yml                      # CI/CD 自动部署 (GitHub Actions → 腾讯云 COS)
├── AGENTS.md                                # 📖 智能体操作指南 (唯一保留在根目录的文档)
├── TODO.md                                  # 待办事项清单
└── docs/                                    # 📚 全部项目文档
    ├── CURRENT.md                           # 已实现功能「索引入口」(模块导航表)
    ├── BUILD_GUIDE.md                       # 编译与运行深度指南
    ├── browser-guide.md                     # 浏览器自动化使用指南 (playwright-cli)
    ├── cicd-guide.md                        # CI/CD 自动部署指南
    ├── AGENT_AI_ANALYSIS.md                 # 部落民 AI 决策系统深度拆解
    ├── ARCHITECTURE.md                      # 系统技术架构设计愿景书
    ├── PLAN.md                              # 项目长期规划书
    ├── PLAN_LEDGER_REFACTOR.md              # 账本系统重构规划 (M1~M4 已完成)
    ├── UI_SPEC_AND_LEDGER_DESIGN.md         # UI 全景剖析 + 制度大盘实现指南
    ├── DECISION_VIZ_DESIGN.md               # 马斯洛决策引擎可视化设计方案
    ├── decision-viz-prototype.html          # 决策可视化交互原型
    ├── decision-viz-live-tab.png            # 决策可视化实时监控页截图
    ├── decision-viz-logic-tab.png           # 决策可视化逻辑引擎页截图
    ├── config-reference.md                  # 参数速查表 (由 config-check.js 自动生成, 勿手改)
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
        └── 13-impact-matrix.md             # ★ 跨模块影响矩阵 (改 X 牵动哪些文件 + tick 顺序 + 数据流 + 自检清单)
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
