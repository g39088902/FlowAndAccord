# FlowAndAccord 项目编译与运行指南 (For AI Agents & Developers)

本文档专为接手本项目的 **AI Coding Agent** 与跨平台（macOS / Linux / Windows）开发者编写，记录了项目的工程架构、工具链配置、WASM 编译命令、测试验证流程、JS 动态数值调优指南与核心开发规范。

---

## 1. 项目架构总览

本项目为 **Rust + WebAssembly + Canvas 2D/3D** 的确定性高拟真原始生态演化仿真器。

```text
FlowAndAccord/
├── .cargo/                 # Cargo 镜像源与环境配置
├── .cargo-home/            # 本地离线依赖包缓存目录 (Windows 便携环境)
├── .toolchain/             # 本地便携式 Rust 工具链 (Windows 便携环境)
├── crates/
│   ├── sim_core/           # 纯 Rust 确定性生态物理与社会演化引擎 (唯一仿真真实源)
│   │   ├── src/config.rs   # 核心数值配置映射结构体 (SimConfig)
│   │   └── src/spatial/    # 3D 拓扑路网、小人状态机、房屋建造、有限生态调度
│   └── sim_wasm/           # WASM 零依赖 FFI 导出层 (world_tick, snapshot, config 桥接)
├── frontend/               # 前端展示层 (纯表现与交互，无独立 JS 仿真内核)
│   ├── js/
│   │   ├── config.js       # ⭐ 统一数值配置文件 (window.SIM_CONFIG，改数值无需重新编译 WASM)
│   │   ├── math.js         # 3D 向量与投影变换
│   │   ├── rustworld.js    # WASM 运行时驱动与快照拉取，自动同步 JS Config 到 WASM
│   │   ├── render.js       # Canvas 3D 渲染与 Inspector 监控
│   │   └── main.js         # UI 交互、倍速记忆与相机
│   ├── rust/
│   │   └── sim_wasm.wasm   # 编译生成的 WASM 核心二进制文件
│   ├── server.js           # 静态文件开发服务器 (内置 .wasm MIME 支持)
│   ├── style.css           # 现代玻璃拟态样式与无衬线字体族
│   └── index.html          # 前端入口 (引入 config.js)
├── AGENTS.md                # 智能体操作指南 (唯一保留在根目录的文档)
├── docs/                    # 📚 全部项目文档
│   ├── CURRENT.md           # 已实现功能「索引入口」(模块导航表)
│   ├── BUILD_GUIDE.md       # [本文档] 编译与运行深度指南
│   ├── AGENT_AI_ANALYSIS.md # 部落民 AI 决策系统深度拆解
│   ├── ARCHITECTURE.md      # 宏观技术架构设计愿景书
│   ├── PLAN.md              # 项目长期规划书
│   ├── TODO.md              # 待办事项清单
│   └── current/             # 已实现功能分模块文档 (01~11)
└── tools/
    └── test-wasm.js        # Node.js WASM 自动化回归测试套件
```

> ⚠️ **架构重要提醒**：`crates/sim_core` 是唯一的确定性物理与社会模拟核心（经 `sim_wasm` 导出至浏览器运行）；`frontend/js/` 下仅包含渲染与交互代码，**不存在 `agent.js` / `simulation.js` 等 JS 移植版代码**。

---

## 2. 跨平台工具链与编译运行指南

### 2.1 macOS (Apple Silicon / Intel) & Linux 环境 (zsh / bash)

#### 🍎 步骤一：安装 Rust 与 WASM 目标环境（首次配置）
若您的 Mac 尚未安装 Rust 工具链，请在终端执行标准安装：
```bash
# 1. 安装 Rustup (若已安装可跳过)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# 2. 添加 wasm32-unknown-unknown 编译目标
rustup target add wasm32-unknown-unknown
```

#### 🍎 步骤二：运行 Rust 原生内核编译与测试
```bash
cargo test --lib
```
> 注：当前源码未内置单元测试用例，命令通过即代表编译无误（自动化行为验证以步骤四的 WASM 回归为准）。

#### 🍎 步骤三：编译 Release 级 WebAssembly 并同步至前端双目录
```bash
# 1. 编译 WASM
cargo build -p sim_wasm --target wasm32-unknown-unknown --release

# 2. 同步二进制产物至前端两个路径 (必须保持双副本一致)
cp target/wasm32-unknown-unknown/release/sim_wasm.wasm frontend/rust/sim_wasm.wasm
cp target/wasm32-unknown-unknown/release/sim_wasm.wasm frontend/sim_wasm.wasm
```

#### 🍎 步骤四：运行 Node.js 自动化回归测试 (无需浏览器)
```bash
node tools/test-wasm.js
```
> 输出 `ALL_TESTS_DONE` 即代表确定性测试、坐标防越界、数值防 NaN、JS 动态配置注入校验 100% 通过。

#### 🍎 步骤五：启动前端本地开发服务器
```bash
node frontend/server.js
```
* 服务默认监听：**`http://localhost:3000`**（若 3000 端口被占用会自动递增至 `3001`、`3002` 等）。
* 浏览器打开 `http://localhost:3000` 即可体验。每次更新后在浏览器中按 `Cmd + Shift + R` 强制刷新。

---

### 2.2 Windows 便携环境 (PowerShell)

本项目在根目录 `.toolchain/` 下内置了便携式 Rust 工具链，并在 `.cargo-home/` 中缓存了离线依赖。

#### 🪟 步骤一：注入便携工具链环境变量并运行原生编译测试（当前源码未内置单元测试用例，通过即代表编译无误）
```powershell
$env:PATH = "$PWD\.toolchain\cargo\bin;$PWD\.toolchain\rustc\bin;$env:PATH"
$env:CARGO_HOME = "$PWD\.cargo-home"
cargo test --lib
```

#### 🪟 步骤二：编译 WASM 并复制到前端双目录
```powershell
# 1. 编译 WASM
$env:PATH = "$PWD\.toolchain\cargo\bin;$PWD\.toolchain\rustc\bin;$env:PATH"
$env:CARGO_HOME = "$PWD\.cargo-home"
cargo build -p sim_wasm --target wasm32-unknown-unknown --release

# 2. 复制二进制产物到前端双目录
Copy-Item "target\wasm32-unknown-unknown\release\sim_wasm.wasm" -Destination "frontend\rust\sim_wasm.wasm" -Force
Copy-Item "target\wasm32-unknown-unknown\release\sim_wasm.wasm" -Destination "frontend\sim_wasm.wasm" -Force
```

#### 🪟 步骤三：运行 Node.js 端到端测试与启动开发服务器
```powershell
# 运行回归测试
node tools/test-wasm.js

# 启动服务器
node frontend/server.js
```

---

## 3. ⭐ 数值参数免重新编译动态调优指南 (`config.js`)

以往调整小人生理消耗、四季气温、房屋升级门槛或 POI 产速等数值时，需要修改 Rust 代码并重新编译 WASM。

**现在所有数值参数已完全抽取至 `frontend/js/config.js` (`window.SIM_CONFIG`)**：

### 3.1 如何调整参数
直接打开 **`frontend/js/config.js`**，修改相应字段数值后**直接保存并在浏览器中按 `Cmd + R` / `Ctrl + F5` 刷新页面**即可立即生效，**完全不需要重新编译 WASM**！

```javascript
// frontend/js/config.js 示例片段
window.SIM_CONFIG = {
  // === 生理与生命周期 ===
  agentAdultAge: 180.0,              // 成年年龄 (秒)
  agentHealthDecayPerSec: 0.02,       // 健康值每秒自然衰减速率
  carryCapacityResource: 50.0,        // 随身行囊单项资源负重上限

  // === POI 生态与产速 ===
  countWaterSources: 6,               // 清泉数量
  countBerryBushes: 6,                // 浆果数量
  regenBaseWater: 2.0,                // 水泉基准产速 (单位/秒)

  // === 四季气候与取暖 ===
  seasonYearLength: 240.0,            // 一年总时长 (秒)
  tempBaseMid: 14.0,                  // 年基准中值气温 (°C)
  houseWinterWoodBurnRate: 0.12,      // 冬季房屋每秒烧木取暖速率
  // ... 更多参数详见 config.js
};
```

### 3.2 技术实现原理
1. `frontend/js/config.js` 定义了包含 50+ 个仿真超参数的全局对象 `window.SIM_CONFIG`；
2. `frontend/js/rustworld.js` 在 WASM 实例化及每次重置生态时，自动将 `window.SIM_CONFIG` 序列化为 JSON 字节并通过 `world_set_config` / `world_apply_config_buf` 写入 WASM 线性内存；
3. `crates/sim_core` 内部的 `SimConfig` 结构体支持 Serde 反序列化，接收到前端参数后自动覆盖内核默认常量，实现零编译热调优。

---

## 4. 关键规范与注意事项 (Agent 必读)

1. **代码行数上限**：
   * 所有 Rust 源码单个文件行数必须**严格控制在 800 行以内**。若扩展功能导致某文件接近 800 行，请及时按领域拆分（如 `decisions/` 模块拆分实践）。
2. **确定性与时间步长**：
   * 内核物理步长固定为 `dt = 1.0 / 30.0`（30 tick = 1 模拟秒）。倍速演化通过 `world_tick_steps(N, dt)` 连续步进实现，**严禁修改 `dt` 大小**以防数值积分发散。
   * 错峰决策：每个 tick 调度 `tick_decisions()`，每个 agent 仅在 `(tick_counter + agent.id) % agent_decision_interval_ticks == 0` 的相位上错峰决策。
3. **随身搬运机制**：
   * 💧水 / 🍒食 / 🌲木 / 🪨石：在资源点装入随身行囊（各 50.0 独立容量，互不共享），返回私宅休整时按 10.0/s 卸货存入仓库；
   * 🪙金：随身行囊容量无限，单趟装满 20.0 回宅入库（5.0/s）。
4. **有限生态资源配置 (共 23 处 POI)**：
   * 避风营地 5 处（ID 1-5）
   * 天然清泉 6 处（ID 10-15，储量 60.0，产速 2.0/s）
   * 缓坡浆果 6 处（ID 20-25，储量 60.0，产速 2.0/s）
   * 茂密林木 3 处（ID 30-32，储量 60.0，产速 2.0/s）
   * 嶙峋石矿 2 处（ID 40-41，储量 60.0，产速 1.5/s）
   * 璀璨金矿 1 处（ID 50，储量 60.0，产速 1.2/s）
5. **版本号规范**：
   * 每次 AI 修改代码后必须自增版本号（当前版本：`v0.9.56`），在 `index.html`、`AGENTS.md` 与 `docs/CURRENT.md` 索引入口同步更新，并在 [`current/11-changelog.md`](./current/11-changelog.md) 追加版本演进条目。