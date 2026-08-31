# 9. 📂 核心代码目录与模块映射

> **模块索引**：[← 返回 CURRENT.md 全景索引](../../CURRENT.md)

---

```text
FlowAndAccord/
├── crates/
│   ├── sim_core/                         # 纯 Rust 确定性模拟内核
│   │   └── src/
│   │       ├── config.rs                 # ⚙️ 仿真超参数集中配置文件 (SimConfig 结构体与默认常量)
│   │       ├── spatial/
│   │       │   ├── vec3.rs               # 3D 向量数学库
│   │       │   ├── graph.rs              # 3D 贝塞尔曲线拓扑路网与 A* 寻路
│   │       │   ├── poi.rs                # 23处 POI 实体定义 (营地5/泉6/果6/木3/石2/金1)
│   │       │   ├── house.rs              # 5阶房屋模型、独立仓储与升级逻辑
│   │       │   ├── housing_system/       # 房屋维护、建造施工、修缮折旧与代际继承 (5 子模块)
│   │       │   │   ├── mod.rs            # 房屋系统 tick 管线入口
│   │       │   │   ├── maintenance.rs    # 冬季供暖与耐久修缮
│   │       │   │   ├── construction.rs   # 施工计时与多级升级
│   │       │   │   ├── marriage.rs       # 自动成婚与丧偶改嫁
│   │       │   │   ├── settlement.rs     # 仓库选址与路网接入
│   │       │   │   └── inheritance.rs    # 父系继承与绝嗣废墟
│   │       │   ├── agent.rs              # 部落民实体、生理代谢、随身行囊搬运与状态机
│   │       │   ├── ecology.rs            # 生态初始化、资源采收装载与在家卸货入库
│   │       │   ├── decisions/            # 马斯洛层次动机决策子系统 (已模块化拆分)
│   │       │   │   ├── mod.rs            # 决策子模块入口与重新导出
│   │       │   │   ├── needs.rs          # 需求定义、节点池与家宅缺口计算
│   │       │   │   └── evaluator.rs      # 决策评估执行器（读取 Agent 私有 POI 触发器）
│   │       │   ├── world.rs              # 世界生态调度、四季温度、快照生成与动态配置注入
│   │       │   └── mod.rs                # 空间模块集成
│   │       └── lib.rs
│   └── sim_wasm/                         # WASM 零依赖 FFI 导出层
├── frontend/
│   ├── js/
│   │   ├── config.js                     # ⚙️ 全局动态数值配置 (window.SIM_CONFIG，免重编译调参)
│   │   ├── math.js                       # 3D 向量与投影变换
│   │   ├── rustworld.js                  # WASM 桥接层与 Config 注入驱动
│   │   ├── render.js                     # Canvas 3D 渲染与 Inspector
│   │   └── main.js                       # 页面交互与控制
│   ├── server.js                         # 静态文件开发服务器
│   └── index.html                        # 完整单页可视化仿真系统
├── BUILD_GUIDE.md                        # 跨平台 (macOS/Linux/Windows) 编译运行与调参指南
├── ARCHITECTURE.md                       # 系统技术架构设计说明书
├── PLAN.md                               # 项目总体愿景与宏观政治/经济规划书
└── docs/current/                         # [当前目录] 已实现功能按模块拆分文档 (根 CURRENT.md 为索引)
```
