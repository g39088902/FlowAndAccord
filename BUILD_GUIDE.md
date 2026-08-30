# FlowAndAccord 项目编译与运行指南 (For AI Agents & Developers)

本文档专为接手本项目的 **AI Coding Agent** 与开发者编写，记录了项目的工程架构、工具链配置、WASM 编译命令、测试验证流程与核心开发规范。

---

## 1. 项目架构总览

本项目为 **Rust + WebAssembly + Canvas 2D/3D** 的确定性高拟真原始生态演化仿真器。

```text
FlowAndAccord/
├── .cargo/                 # Cargo 镜像源与环境配置
├── .cargo-home/            # 本地离线依赖包缓存目录
├── .toolchain/             # 本地便携式 Rust 工具链 (rustc, cargo)
├── crates/
│   ├── sim_core/           # 纯 Rust 确定性生态物理与社会演化引擎 (唯一仿真真实源)
│   │   └── src/spatial/    # 3D 拓扑路网、小人状态机、房屋建造、有限生态调度
│   └── sim_wasm/           # WASM 零依赖 FFI 导出层 (world_tick, snapshot)
├── frontend/               # 前端展示层 (纯表现与交互，无独立 JS 仿真内核)
│   ├── js/
│   │   ├── math.js         # 3D 向量与投影变换
│   │   ├── rustworld.js    # WASM 运行时驱动与快照拉取
│   │   ├── render.js       # Canvas 3D 渲染与 Inspector 监控
│   │   └── main.js         # UI 交互、倍速记忆与相机
│   ├── rust/
│   │   └── sim_wasm.wasm   # 编译生成的 WASM 核心二进制文件
│   ├── server.js           # 静态文件开发服务器 (内置 .wasm MIME 支持)
│   ├── style.css           # 现代玻璃拟态样式与无衬线字体族
│   └── index.html          # 前端入口
└── tools/
    └── test-wasm.js        # Node.js WASM 自动化回归测试套件
```

> ⚠️ **架构重要提醒**：`crates/sim_core` 是唯一的确定性物理与社会模拟核心（经 `sim_wasm` 导出至浏览器运行）；`frontend/js/` 下仅包含渲染与交互代码，**不存在 `agent.js` / `simulation.js` 等 JS 移植版代码**。

---

## 2. 工具链环境变量配置 (重要)

为避免全局环境依赖冲突，本项目在根目录 `.toolchain/` 下内置了便携式 Rust 工具链，并在 `.cargo-home/` 中缓存了离线依赖。

在 Windows PowerShell 下执行任何 `cargo` 命令前，**必须先注入以下环境变量**：

```powershell
$env:PATH = "$PWD\.toolchain\cargo\bin;$PWD\.toolchain\rustc\bin;$env:PATH"
$env:CARGO_HOME = "$PWD\.cargo-home"
```

> **提示**：如果使用标准全局 Rust 环境（已安装 `rustc`, `cargo` 和 `wasm32-unknown-unknown` target），可直接运行 `cargo` 命令。

---

## 3. 常用开发与编译命令

### 3.1 运行 Rust 核心单元测试
```powershell
$env:PATH = "$PWD\.toolchain\cargo\bin;$PWD\.toolchain\rustc\bin;$env:PATH"; $env:CARGO_HOME = "$PWD\.cargo-home"; cargo test --lib
```

### 3.2 编译 Release 级 WebAssembly 并同步到前端
```powershell
# 1. 编译 wasm
$env:PATH = "$PWD\.toolchain\cargo\bin;$PWD\.toolchain\rustc\bin;$env:PATH"; $env:CARGO_HOME = "$PWD\.cargo-home"; cargo build -p sim_wasm --target wasm32-unknown-unknown --release

# 2. 复制二进制产物到前端目录 (必须同步两个路径)
Copy-Item "target\wasm32-unknown-unknown\release\sim_wasm.wasm" -Destination "frontend\rust\sim_wasm.wasm" -Force
Copy-Item "target\wasm32-unknown-unknown\release\sim_wasm.wasm" -Destination "frontend\sim_wasm.wasm" -Force
```

### 3.3 运行 Node.js WASM 自动化回归测试
用于在不启动浏览器的情况下，快速验证 WASM 导出、确定性、长程繁殖与数值稳定性：
```powershell
node tools/test-wasm.js
```
* 预期输出：`ALL_TESTS_DONE`（无 NaN、无越界、确定性测试通过）。

### 3.4 启动前端本地开发服务器
```powershell
node frontend/server.js
```
* 默认监听：`http://localhost:3000`（若端口被占用会自动递增至 `3001`、`3002` 等）。

---

## 4. 关键规范与注意事项 (Agent 必读)

1. **代码行数上限**：
   * 所有 Rust 源码单个文件行数必须**严格控制在 800 行以内**（目前所有文件均在 560 行以下）。若扩展功能导致某文件接近 800 行，请及时按领域拆分。
2. **确定性与时间步长**：
   * 内核物理步长固定为 `dt = 1.0 / 30.0`（30 tick = 1 模拟秒）。倍速演化通过 `world_tick_steps(N, dt)` 连续步进实现，**严禁修改 `dt` 大小**以防数值发散。
   * 错峰决策：每个 tick 调度 `tick_decisions()`，每个 agent 仅在 `(tick_counter + agent.id) % 15 == 0` 的相位上决策。
3. **随身搬运机制**：
   * 💧水 / 🍒食 / 🌲木 / 🪨石：在资源点装入随身行囊（各 50.0 独立容量，互不共享），返回私宅休整时按 10.0/s 卸货存入仓库；
   * 🪙金：随身行囊容量无限，单趟装满 20.0 回宅入库（5.0/s）。
4. **有限生态资源配置 (共 21 处 POI)**：
   * 避风营地 5 处（ID 1-5）
   * 天然清泉 5 处（ID 10-14，储量 60.0，产速 2.0/s）
   * 缓坡浆果 5 处（ID 20-24，储量 60.0，产速 2.0/s）
   * 茂密林木 3 处（ID 30-32，储量 60.0，产速 2.0/s）
   * 嶙峋石矿 2 处（ID 40-41，储量 60.0，产速 1.5/s）
   * 璀璨金矿 1 处（ID 50，储量 60.0，产速 1.2/s）
5. **房屋进阶阶梯**：
   * `Tier0Warehouse` (0级仓库) $\rightarrow$ 需水18, 粮18 $\rightarrow$ `Tier1ThatchedHut` (1级茅草房)
   * `Tier1ThatchedHut` $\rightarrow$ 需木材85% (34.0), 水粮充足 $\rightarrow$ `Tier2LeanTo` (2级私宅)
   * `Tier2LeanTo` $\rightarrow$ 需石料85% (68.0), 水粮木充足 $\rightarrow$ `Tier3Homestead` (3级木石庄舍)
   * `Tier3Homestead` $\rightarrow$ 需黄金85% (102.0), 石料85% (102.0) $\rightarrow$ `Tier4Manor` (4级氏族大庄园)