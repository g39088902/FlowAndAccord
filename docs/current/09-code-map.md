# 9. 📂 核心代码目录与模块映射

> **模块索引**：[← 返回 CURRENT.md 全景索引](../CURRENT.md)
> 本文件源码树与实际仓库 100% 对应（最后核验：v1.0.1）。

---

```text
FlowAndAccord/
├── crates/
│   ├── sim_core/                           # 纯 Rust 确定性模拟内核
│   │   └── src/
│   │       ├── config.rs                   # ⚙️ SimConfig 结构体 (153 字段) + 默认常量
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
│   │           ├── house.rs                # 5 阶房屋模型、独立仓储与升级判定
│   │           ├── agent.rs                # 部落民实体、生理代谢、随身行囊、运动与状态机
│   │           ├── ecology.rs              # 生态初始化、POI 采收装载、回家卸货入库
│   │           ├── birth.rs                # 妊娠结算、分娩、新生儿属性遗传
│   │           ├── world.rs                # World3DEngine 世界调度、四季温度、快照生成、配置注入
│   │           ├── snapshot.rs             # 快照结构体定义 (Agent/House/POI/Household/Marriage/Ledger)
│   │           ├── decisions/              # 🧠 马斯洛决策子系统 (7 文件)
│   │           │   ├── mod.rs              # 决策子模块入口与重新导出
│   │           │   ├── needs.rs            # NeedKind 需求定义、节点池、家宅缺口计算
│   │           │   ├── evaluate.rs         # Decisioner 结构体 + decide/evaluate_needs
│   │           │   ├── routing.rs          # 导航/寻路/原地掉头/返家/POI 触发器可用性
│   │           │   ├── harvest.rs          # 现场采收判定 + 仓储满额查询
│   │           │   ├── seeking.rs          # 途中熔断与平滑重路由
│   │           │   └── scheduler.rs        # tick_decisions 调度 + build_decision_context
│   │           ├── housing_system/         # 🏡 房屋全生命周期子系统 (6 文件)
│   │           │   ├── mod.rs              # 房屋系统 tick 管线入口
│   │           │   ├── maintenance.rs      # 冬季供暖与耐久修缮结算
│   │           │   ├── construction.rs     # 施工计时与多级升级竣工
│   │           │   ├── marriage.rs         # 自动成婚与丧偶改嫁匹配
│   │           │   ├── settlement.rs       # 立宅选址校验、路网接入、空置节点复用
│   │           │   └── inheritance.rs      # 父系继承与绝嗣废墟处理
│   │           └── ledger/                  # 📒 账本与婚姻登记子系统 (5 文件, M1)
│   │               ├── mod.rs              # ledger 模块入口与重新导出
│   │               ├── journal.rs          # 账本内核 (ResourceKind/Ledger/TransferRecord/TransferReason)
│   │               ├── group.rs            # 团体基类 (leader + members + ledger)
│   │               ├── marriage.rs         # 婚姻登记簿 (终身多段婚姻全留痕、存续唯一性)
│   │               └── family.rs           # 家户体系 (家庭跟着男人走、户主男性锚定、改嫁先移后加)
│   └── sim_wasm/                           # 🔌 WASM 零依赖 FFI 导出层
│       └── src/
│           └── lib.rs                      # 导出函数、静态缓冲区、错误码、指针约定、双副本同步
├── frontend/
│   ├── js/
│   │   ├── config.js                       # ⚙️ 全局动态数值配置 (window.SIM_CONFIG, 153 字段)
│   │   ├── math.js                         # 3D 向量与投影变换
│   │   ├── rustworld.js                    # WASM 桥接层、快照映射、Config 注入驱动
│   │   ├── render.js                       # Canvas 渲染、Inspector、顶栏、大盘、调试监视器
│   │   ├── main.js                         # 页面交互、控制台、事件绑定
│   │   ├── dag.js                          # 族谱数据构建 + 模态编排 + Inspector
│   │   ├── dag-layout.js                   # 族谱时间轴布局数学 (纯函数, 零 DOM)
│   │   ├── dag-view.js                     # 族谱虚拟化渲染 + LOD + pan/zoom + 刻度尺
│   │   └── dag-standalone.js               # 族谱独立新标签页 HTML 模板
│   ├── rust/
│   │   └── sim_wasm.wasm                   # WASM 编译产物主副本 (rustworld.js 实际 fetch 路径)
│   ├── sim_wasm.wasm                       # WASM 编译产物根目录备用副本
│   ├── server.js                           # 静态文件开发服务器 (内置 .wasm MIME 支持, 默认 3000 端口)
│   ├── index.html                          # 完整单页可视化仿真系统
│   └── style.css                           # 全局样式
├── tools/
│   ├── test-wasm.js                        # WASM 回归测试 (确定性/防越界/防 NaN/长程稳定)
│   ├── config-check.js                     # 前后端配置一致性校验 + config-reference.md 自动生成
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
    ├── PLAN_LEDGER_REFACTOR.md              # 账本系统重构规划
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
        └── 12-ledger-system.md
```

## 目录级 AGENTS.md
复杂 Rust 代码目录内维护局部 AGENTS.md，改对应目录代码前先读：
- `crates/sim_core/AGENTS.md`
- `crates/sim_wasm/AGENTS.md`
- `crates/sim_core/src/spatial/decisions/AGENTS.md`
- `crates/sim_core/src/spatial/housing_system/AGENTS.md`
- `crates/sim_core/src/spatial/ledger/AGENTS.md`
