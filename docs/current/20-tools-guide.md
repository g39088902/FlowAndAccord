# 20. 🛠️ 仿真内核与工程工具箱操作指南 (tools/)

> **模块索引**：[← 返回 01-current.md 全景索引](../01-current.md)
> **工具定位**：`tools/` 目录下的 15 个工具脚本均为基于 Node.js 原生模块的**零依赖工具**，覆盖契约门禁、内核确定性测试、微秒级性能基准、无头仿真诊断、世系族谱数据生成与版本自动化治理。

---

## 1. 📂 工具全景速查总表

| 序号 | 脚本文件 | 分类 | 核心定位与职责 | 典型运行命令 | 退出码契约 |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | **`config-check.js`** | 契约门禁 | 交叉校验 `config.js` 与 Rust `SimConfig` 字段/类型/默认值，自动生成速查表 | `node tools/config-check.js` | 0=通过, 1=字段/数值漂移 |
| 2 | **`snapshot-check.js`** | 契约门禁 | 校验快照在 `snapshot.rs`、`world_snapshot.rs` 与 `rustworld.js` 三处一致性 | `node tools/snapshot-check.js` | 0=通过, 1=三处不匹配 |
| 3 | **`frontend-check.js`** | 契约门禁 | 前端全部 JS 语法检查 + `getElementById` DOM ID 存在性双向校验 | `node tools/frontend-check.js` | 0=通过, 1=语法/ID缺失 |
| 4 | **`code-map-check.js`** | 契约门禁 | 实际文件树 vs `09-code-map.md` 登记清单交叉比对，捕获文档与代码漂移 | `node tools/code-map-check.js` | 0=通过, 1=未登记/无效登记 |
| 5 | **`doc-maintenance-check.js`** | 契约门禁 | 依据 `docs/doc-maintenance.json` 检查各模块文档的新鲜度与复核周期 | `node tools/doc-maintenance-check.js` | 0=体检完成 (追加 `--strict` 时漂移报 1) |
| 6 | **`test-wasm.js`** | 内核测试 | Node 无头运行 WASM，验证确定性、长程稳定（防越界/防NaN）、存读档状态一致 | `node tools/test-wasm.js` | 0=通过, 1=失败抛出 |
| 7 | **`test-determinism.js`** | 内核测试 | **最高级确定性门禁**：验证 6 大数学定理（多种子/分批独立/快照只读/重放一致等） | `node tools/test-determinism.js` | 0=矩阵全通, 1=确定性分叉 |
| 8 | **`profile-benchmark.js`** | 性能分析 | 测算仿真吞吐量（TPS）、内核 8 大子阶段耗时占比，支持优化前后加速比对比 | `node tools/profile-benchmark.js` | 0=完成采样 |
| 9 | **`diagnose.js`** | 诊断排障 | 确定性无头诊断，指定种子与 Tick 极速复现并嗅探死因、贫困、行为卡死 | `node tools/diagnose.js -s 42 -t 3000` | 0=完成诊断 |
| 10 | **`gold_mining_analysis.js`** | 专项分析 | 专门用于深入排查和追踪族人“为何不淘金/采金”的家户物资与马斯洛行为链路 | `node tools/gold_mining_analysis.js` | 0=完成分析 |
| 11 | **`gen-dag-testdata.js`** | 族谱工具 | 驱动内核跑满数十万 Tick 累积族人档案库，裁剪直系血脉生成 DAG 测试集 | `node tools/gen-dag-testdata.js` | 0=生成完成 |
| 12 | **`dag-shot.js`** | 族谱工具 | 加载前端真实的 `FlowDag` 算法，驱动无头 Chrome 多视角自动截取族谱图 | `node tools/dag-shot.js` | 0=完成截图 |
| 13 | **`bump-version.js`** | 版本治理 | 版本号升版与一致性对齐，同步更新 `index.html` 徽章与全部 8+ 处定义点 | `node tools/bump-version.js --patch` | 0=同步成功, 1=校验漂移 |
| 14 | **`rust-download.js`** | 环境构建 | 使用 Node 内置 OpenSSL TLS 下载便携 Rust 工具链（绕过系统证书异常） | `node tools/rust-download.js` | 0=下载完成 |
| 15 | **`vendor-deps.js`** | 环境构建 | 基于 crates.io API BFS 遍历根依赖与传递依赖，离线下载至 `.vendor/` | `node tools/vendor-deps.js` | 0=完成打包 |

---

## 2. 静态契约与一致性门禁工具

### 2.1 `config-check.js` · 前后端配置一致性校验
- **目标**：杜绝前端调参 `config.js` 与 Rust 确定性内核 `config.rs` 发生字段拼写漂移或数值错位。
- **工作机制**：
  1. 解析 `frontend/js/config.js`、`config.decision-order.js` 与 `config.house-upgrade-cost.js`；
  2. 正则解析 Rust `crates/sim_core/src/config.rs` 中的 `pub struct SimConfig` 字段与 `impl Default`；
  3. 逐项比对两端的字段名（camelCase ↔ snake_case）、数据类型（Number/Boolean/String）与默认初始值；
  4. 自动生成并覆写 `docs/06-config-reference.md` 权威参数速查表。
- **常用命令**：
  ```bash
  node tools/config-check.js
  ```

### 2.2 `snapshot-check.js` · 快照三处同步校验
- **目标**：保障快照三处同步不变量（`AGENTS.md` §4.5）：
  1. `crates/sim_core/src/spatial/snapshot.rs`（结构体定义）
  2. `crates/sim_core/src/spatial/world_snapshot.rs`（Rust 数据赋值）
  3. `frontend/js/rustworld.js`（前端接收与映射）
- **常用命令**：
  ```bash
  node tools/snapshot-check.js
  ```

### 2.3 `frontend-check.js` · 前端语法与 DOM 健全性门禁
- **目标**：在无需启动浏览器或加载界面的情况下，100% 静态验证前端脚本语法和 DOM 元素绑定安全。
- **检查内容**：
  1. 调用 `node --check` 严格解析 `frontend/js/` 下全部脚本语法；
  2. 提取 JS 中所有 `document.getElementById('xyz')`，并在 `frontend/index.html` 和 `dag.html` 中核验是否存在对应 ID 的元素。
- **常用命令**：
  ```bash
  node tools/frontend-check.js
  ```

### 2.4 `code-map-check.js` · 代码地图与文件树校验
- **目标**：防止项目不断迭代中新增或重构的文件未及时在文档中建立索引。
- **工作机制**：
  - 扫描项目全部实际源码与文档文件，比对 [`docs/current/09-code-map.md`](./09-code-map.md) 的登记清单，捕获“文件未登记”、“登记但已删除”以及 SimConfig 字段数关键词漂移。
- **常用命令**：
  ```bash
  node tools/code-map-check.js
  ```

### 2.5 `doc-maintenance-check.js` · 文档维护体检器
- **目标**：保障全库文档的时效性与责任边界。
- **常用命令**：
  ```bash
  node tools/doc-maintenance-check.js           # 日常只读体检
  node tools/doc-maintenance-check.js --strict  # CI/发版严格模式（源码领先或超期阻断）
  ```

---

## 3. 内核仿真测试与性能基准工具

### 3.1 `test-wasm.js` · 基础回归与长程稳定性
- **目标**：轻量级快速回归，验证 WASM 二进制的基本运行质量。
- **核心断言**：
  - 种子一致性：同种子下推进 1000 步生成的快照逐字节相等；
  - 状态合法性：无 NaN、无无穷大、坐标防越界；
  - 存档重放一致性：`world_save` 导出后重新 `world_load` 继续推进，状态与不中断连续推进严格一致；
  - 版本门禁：篡改存档版本号后必须被拒绝加载并输出错误码。
- **常用命令**：
  ```bash
  node tools/test-wasm.js
  ```

### 3.2 `test-determinism.js` · 增强型确定性矩阵测试套件
- **目标**：项目的“终极大闸”。任何涉及算法、调度、数据结构改动必须全部通过。
- **六大定理门禁**：
  - **Suite 1 多种子基准**：Seed 42/1024/99999 分别推演，状态重放 100% 一致；
  - **Suite 2 分批独立性**：单步 1 tick 推进 600 拍 vs 批次 100 tick 推进 6 次，逐字节严格相等；
  - **Suite 3 子阶段等价性**：直接 `world_tick` 与逐个调用 8 个 `tick_subphase` 执行轨迹逐字节一致；
  - **Suite 4 快照无副作用**：频繁读取快照不污染内核后续演算；
  - **Suite 5 存读档重放**：中途导出存档并重新加载，推演轨迹完全重合；
  - **Suite 6 多人口长程压力**：高密度人口与数千 Tick 长程演化无漂移。
- **常用命令**：
  ```bash
  node tools/test-determinism.js
  ```

### 3.3 `profile-benchmark.js` · 性能 Profiling 与子阶段耗时剖析
- **目标**：微秒级精度度量内核性能，为优化提供量化基准。
- **核心功能**：
  - 测算总体 TPS 与单 Tick 耗时（µs）；
  - 输出 8 大子阶段（Phase 0~8）的单拍物理耗时与百分比条形图；
  - 测试 1x ~ 1024x 步长推进与 20/50/100 人口规模扩展性；
  - 支持导出基准 JSON，并通过 `--compare` 生成优化前后的加速比对比表。
- **常用命令**：
  ```bash
  node tools/profile-benchmark.js                              # 默认基准
  node tools/profile-benchmark.js --ticks 6000 --breakdown     # 打印子阶段 ASCII 耗时条形图
  node tools/profile-benchmark.js --ticks 3000 --json base.json # 固化优化前基准
  node tools/profile-benchmark.js --ticks 3000 --compare base.json # 输出优化加速比
  ```

---

## 4. 无头仿真诊断与专项分析工具

### 4.1 `diagnose.js` · 确定性无头内核诊断与 Bug 嗅探
- **目标**：脱离前端界面与渲染，通过 Node.js 极速定位长程演化中的疑难 Bug。
- **常用参数**：
  - `--seed <N>`：随机种子（默认 42）；
  - `--tick <N>`：推进的目标 Tick 计数；
  - `--check <type>`：嗅探类型（`all` / `anomalies` / `starvation` / `deaths`）；
  - `--agent <id>`：针对特定族人追踪其近期行为与生理轨迹；
  - `--house <id>`：针对特定私宅追踪其耐久、仓储与出价记录；
  - `--trace-window <N>`：截止点前的高频轨迹采样窗口（默认 150 拍）；
  - `--export-json <file>` / `--export-report <file>`：导出数据或 Markdown 诊断报告。
- **常用示例**：
  ```bash
  node tools/diagnose.js --seed 42 --tick 3000 --check all
  node tools/diagnose.js --seed 1024 --tick 4500 --agent 5 --trace-window 200
  ```

### 4.2 `gold_mining_analysis.js` · 淘金与经济行为专项分析
- **目标**：专项诊断复杂社会经济模拟中的堵点（如“为什么族人不挖金矿/不盖高阶房屋”）。
- **分析内容**：
  - 逐户监控水/粮/木/石/金五类家户账本储备；
  - 检查家户补货施密特触发器（100 开启 / 200 关闭）的状态锁定；
  - 检查各族人当前马斯洛主导需求及决策顺序阻断情况。
- **常用命令**：
  ```bash
  node tools/gold_mining_analysis.js
  ```

---

## 5. 世系族谱与复杂图形调试工具

### 5.1 `gen-dag-testdata.js` · 族谱布局长程数据集生成器
- **目标**：族谱时间轴分层算法需要覆盖数千人、多代宗族的极端长程血缘关系。
- **工作机制**：
  - 驱动 WASM 内核运行数十万 Tick（默认 500,000 Tick）；
  - 周期性抓取快照并累积全部出生与死亡族人档案库；
  - 提取指定焦点人物的血脉子图并导出为 JSON，供前端布局参数拟合。
- **常用命令**：
  ```bash
  node tools/gen-dag-testdata.js --ticks=500000 --seed=2026 --out=/tmp/dag-lab
  ```

### 5.2 `dag-shot.js` · 族谱无头多视角批量截图工具
- **目标**：在不启动开发服务器的情况下，通过无头 Chrome 批量校验族谱 DAG 在不同缩放模式下的渲染效果。
- **常用命令**：
  ```bash
  node tools/dag-shot.js --foci=2,311 --modes=fit,focus,detail --size=1600x1000
  ```

---

## 6. 版本治理与离线环境工具

### 6.1 `bump-version.js` · 版本号统一升版器
- **目标**：消灭版本号多处定义导致的不一致（唯一真相源为 `frontend/index.html` 徽章）。
- **自动同步站点**：
  1. `frontend/index.html` 徽章；
  2. `crates/sim_core/src/spatial/world_save.rs` 内的 `SAVE_APP_VERSION`（编译进 WASM 存档门禁）；
  3. `frontend/js/save-ui.js` 的 `DEFAULT_APP_VERSION`；
  4. `frontend/js/rustworld.js` 引擎版本兜底串；
  5. `frontend/js/sim_worker.js` Worker 版本兜底串；
  6. `AGENTS.md` 架构图与步骤；
  7. `docs/01-current.md` 与 `docs/current/11-changelog.md` 表头；
  8. `README.md` 对外徽章。
- **常用命令**：
  ```bash
  node tools/bump-version.js --check       # 门禁检查（有漂移返回 exit 1）
  node tools/bump-version.js --patch       # 自增补丁版本（如 1.44.7 → 1.44.8）
  node tools/bump-version.js --minor       # 自增次版本号（如 1.44.7 → 1.45.0）
  node tools/bump-version.js 1.45.0        # 指定目标版本
  ```

### 6.2 `rust-download.js` · 便携 Rust 工具链下载器
- **目标**：解决部分环境（如 Windows schannel TLS 证书受限）下 `rustup` 无法拉取工具链的问题，使用 Node 原生 TLS 稳定拉取官方工具链压缩包。

### 6.3 `vendor-deps.js` · Cargo 依赖离线打包工具
- **目标**：通过 crates.io REST API 执行广度优先搜索（BFS），解析并下载 `crates/sim_core` 与 `crates/sim_wasm` 所需的全部依赖 `.crate` 包至本地 `.vendor`，供纯内网或断网环境下离线编译。

---

## 7. 典型开发流组合速查

```bash
# 1. 改动前端 JS/CSS 后的快速自检：
node tools/frontend-check.js

# 2. 改动数值配置后的一致性检查：
node tools/config-check.js

# 3. 改动 Rust 内核后的完整回归门禁：
node tools/test-wasm.js
node tools/test-determinism.js

# 4. 代码提交前统一门禁：
node tools/bump-version.js --check
node tools/code-map-check.js
node tools/doc-maintenance-check.js
```
