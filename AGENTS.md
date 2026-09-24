# Flow & Accord · 全局智能体开发指南

> **改代码前必读。** 本文件只保留全局不变量、跨模块契约、任务路由和门禁；模块实现细节、文件清单与局部易踩坑放在对应目录的 `AGENTS.md` 和 `docs/current/` 中。规则冲突时，本文件优先。

## 0. 任务路由与文档入口

先按改动范围选择最小上下文：

| 改动范围 | 先读的局部指南 | 权威技术文档 |
|---|---|---|
| `crates/sim_core/` | `crates/sim_core/AGENTS.md` | `docs/current/tech/01-engine-architecture.md` |
| `crates/sim_core/src/spatial/` | `spatial/AGENTS.md`，再读目标子目录指南 | `docs/current/tech/11-decision-engine.md`、`13-housing-system.md`、`08-ecology-and-poi.md` |
| `crates/sim_core/src/geo/` | `geo/AGENTS.md` | `docs/current/tech/14-terrain-and-network.md` |
| `crates/sim_wasm/` | `crates/sim_wasm/AGENTS.md` | `docs/current/tech/06-snapshot-and-save.md` |
| `frontend/` | `frontend/AGENTS.md` | `docs/current/tech/19-ui-implementation.md`、`21-frontend-dev-guide.md` |
| 跨模块 / 发布 / 存档 | 本文件 + `docs/current/tech/30-workflow.md` | `docs/current/tech/28-invariants.md`、`29-impact-matrix.md` |

### 0.1 局部 `AGENTS.md` 清单

- `crates/sim_core/AGENTS.md`：内核 crate、`SimConfig`、`WorldRng`、验证方式。
- `crates/sim_core/src/geo/AGENTS.md`：地形生成、RNG 隔离、地形存档约束。
- `crates/sim_core/src/spatial/AGENTS.md`：tick 顺序、实体接口、快照映射、运动契约。
- `crates/sim_core/src/spatial/decisions/AGENTS.md`：马斯洛决策、节拍、路由、立宅和 M19。
- `crates/sim_core/src/spatial/ecology/AGENTS.md`：播撒、采收、装卸、榷场结算和 RNG 顺序。
- `crates/sim_core/src/spatial/housing_system/AGENTS.md`：房屋结算、升级、修缮、空置房和拍卖。
- `crates/sim_core/src/spatial/ledger/AGENTS.md`：账本、家户、宗族、地区和帝国制度。
- `crates/sim_wasm/AGENTS.md`：导出函数、线性内存、错误码和 WASM 约定。
- `frontend/AGENTS.md`：脚本加载、快照映射、渲染管线、DOM 契约和浏览器约束。

`docs/README.md` 是文档总入口；`docs/current/README.md` 是现状模块索引；`docs/plan/README.md` 是未落地方案索引；`TODO.md` 是待办清单。

## 1. 架构边界

```text
crates/sim_core  →  crates/sim_wasm  →  frontend/rust/sim_wasm.wasm
                                      →  frontend/sim_wasm.wasm
                                      →  sim_worker.js → rustworld.js → WebGL/Canvas 过渡渲染
```

- `sim_core`：确定性模拟内核、决策、生态、房屋、账本、地形与路网。
- `sim_wasm`：无依赖 WASM 桥接、tick、配置注入、FABS 二进制快照和存档导出。
- `frontend`：Worker 代理、快照解码、配置 UI、WebGL 地形层和过渡期 Canvas 2D 实体层。浏览器 UI (版本: v1.60.1)。
- 改动必须保持内核与表现层解耦；前端渲染不得改变模拟状态或 `WorldRng` 消费顺序。

渲染目标是全量 WebGL。★ v1.60.1 起地形/光照/装饰/阴影的 Canvas 备用通道已删除（WebGL 不可用为启动硬门槛）；水系/实体/标签仍在 2D 覆盖层，阶段三~五迁移完成前不得删除该覆盖层。改渲染代码前必须阅读 [31 号迁移方案](./docs/plan/tech/31-canvas-to-webgl-migration.md) 与 `frontend/AGENTS.md`。

## 2. 编译、验证与运行

详细环境说明见 [`docs/current/tech/22-build-and-run.md`](./docs/current/tech/22-build-and-run.md) 和 [`docs/current/tech/30-workflow.md`](./docs/current/tech/30-workflow.md)。

### 步骤一：发布 WASM

```powershell
$env:PATH = "$PWD\.toolchain\cargo\bin;$PWD\.toolchain\rustc\bin;$env:PATH"
$env:CARGO_HOME = "$PWD\.cargo-home"
cargo build -p sim_wasm --target wasm32-unknown-unknown --release
Copy-Item "target\wasm32-unknown-unknown\release\sim_wasm.wasm" -Destination "frontend\rust\sim_wasm.wasm" -Force
Copy-Item "target\wasm32-unknown-unknown\release\sim_wasm.wasm" -Destination "frontend\sim_wasm.wasm" -Force
```

改 Rust 时可先用 `cargo check --lib` 或 `--profile dev-wasm` 做本地反馈；`dev-wasm` 产物严禁复制、提交或部署。发布口径只能是 `--release`，并且两个前端副本必须同时更新。

### 步骤二：长期门禁

```text
node tools/test-wasm.js
node tools/test-determinism.js
node tools/config-check.js
node tools/frontend-check.js
node tools/snapshot-check.js
node tools/doc-link-check.js
node tools/cross-doc-check.js
node tools/code-map-check.js
node tools/doc-maintenance-check.js
node tools/bump-version.js --check
```

按改动类型选择 `docs/current/tech/30-workflow.md` 的专项门禁；不要为了文档小改动运行无关的 Rust 发布构建。

### 步骤三：前端运行

```text
node frontend/server.js
```

默认地址为 `http://localhost:3000`。端口已有服务时直接复用，不要重复启动。存档链路使用 Chrome 或 Edge；受限环境只能用内置浏览器加 `?nogate=1` 验证非存档链路，不能据此证明真实存档读写。每次重编译 WASM 后强制刷新；页面顶部标题栏右侧显示版本徽章 **`v1.60.1`**。

## 3. 玩家交互速查

`Space` 暂停/继续；左键点击族人、房屋或地标查看 Inspector；滚轮缩放、右键拖拽平移；顶部重置重新播撒初始族人。详细 UI 规则见 `frontend/AGENTS.md` 和 `docs/current/tech/05-observation-ux.md`。

## 4. 全局硬约束与易踩坑索引

本节只保留跨模块结论。机制细节和调用链必须写在局部指南或现状技术文档中，避免多处复制。

浏览器验证：真实存档依赖 Chrome/Edge 的 File System Access API；`?nogate=1` 只用于内存演算和视觉、性能、镜头等非存档验证。

### 4.0 改动前快速自检

```text
□ 版本号是否应由 node tools/bump-version.js 提升？
□ Rust WASM 是否 release 编译并同步 frontend/rust/ 与 frontend/ 两个副本？
□ 快照字段是否同步 snapshot.rs → world_snapshot.rs → snapshot_bin/encode.rs → snapshot-bin.js/rustworld.js？
□ 是否保持 STR_TAB.start_index == 0 的跨世界缓存失效判据？
□ 新配置是否同步 config.rs、frontend/js/config.js、examples/config.json、config-check.js？
□ 是否阅读受影响目录的局部 AGENTS.md 并更新对应技术文档？
□ 是否按 30-workflow.md 选择了必要门禁？
□ 文档、代码和脚本是否统一 LF？
```

### 4.0.1 Commit 前检查单

完整清单在 [`docs/current/tech/30-workflow.md`](./docs/current/tech/30-workflow.md) 附篇一。纯文档变更只需工作区检查、`doc-maintenance-check.js`、`cross-doc-check.js` 和 `bump-version.js --check`；Rust、前端、配置或存档变更按专项清单执行。

### 4.1 WASM 双副本

Rust 变更必须重编译并复制到 `frontend/rust/sim_wasm.wasm` 和 `frontend/sim_wasm.wasm`。不要用文件大小判断是否更新，以 `test-wasm.js` 结果为准。详见 `docs/current/tech/22-build-and-run.md` §2。

### 4.2 决策与寻路

POI 施密特触发器、连续采收、中途原地重路由和榷场兜底都属于 `decisions/` 的决策语义；系统层不得旁路派发任务。详见 `decisions/AGENTS.md` 与 `docs/current/tech/11-decision-engine.md`。

### 4.3 Tick 顺序与确定性

必须保持“季节/再生 → 代谢繁衍 → POI 交互与卸货 → 房屋 → 道路衰减 → 运动与决策 → 账本制度 → 清理”的顺序；卸货在决策前，道路衰减在运动前。每 tick 使用 `simulationDt = 1/60`，倍速只能用多步 tick。详见 `spatial/AGENTS.md` §二。

### 4.4 随身搬运

水、粮、木、石各自独立容量，资源点只装入行囊，回家按速率卸入家户账本；无家宅者不装袋，只现场进食饮水；金容量无限。改容量或装卸速率必须沿 `agent → ecology → decisions → snapshot → frontend` 全链路同步。

### 4.5 FABS 快照四处同步

新增 `agent`、`house`、`poi` 快照字段时必须同步：

1. `snapshot.rs` 定义；
2. `world_snapshot.rs::generate_snapshot()` 赋值；
3. `snapshot_bin/encode.rs` 编码及 `dict.rs` 枚举码表；
4. `frontend/js/snapshot-bin.js` 解码与 `rustworld.js::_applySnapshot()` 映射。

同步核对使用 `tools/snapshot-check.js`、`test-wasm.js` 和 `test-determinism.js`。

### 4.5.1 跨世界驻留表缓存

FABS `STR_TAB` 的新世界判据唯一是 `start_index == 0`；禁止改用 `epoch` 或全局单调计数。 `world_load` / `world_create` 后必须清理工具侧缓存。详见 `docs/current/tech/06-snapshot-and-save.md` §7.2 和 `frontend/AGENTS.md` §5.2。

### 4.6 文件粒度

单文件控制在 800 行以内；功能增长时拆成职责单一的子模块，并补充局部 `AGENTS.md` 和代码地图。

### 4.7 POI 与 ID

全图默认 23 处 POI，ID 段位、资源类型和营地行政区升级门槛由 `docs/current/tech/08-ecology-and-poi.md` 维护；不要在调用方复制数量或段位常量。

### 4.8 行为与生理规则归属

| 主题 | 权威位置 |
|---|---|
| 冬季供暖、木材禁孕、家庭储备、升级成本 | `docs/current/tech/13-housing-system.md`、`housing_system/AGENTS.md` |
| 生育住宅门槛、流产和产后冷却 | `docs/current/tech/10-agent-life-cycle.md` |
| 金币采集冷却、庄园门禁、POI 触发器 | `docs/current/tech/11-decision-engine.md`、`decisions/AGENTS.md` |
| Inspector 与镜头跟随 | `frontend/AGENTS.md` |

### 4.9 版本号与存档兼容线

版本号一律由 `node tools/bump-version.js` 修改。patch 只影响表现层并保留旧档；minor/major 影响兼容线并废弃旧档；`SAVE_APP_VERSION` 只存 `major.minor`，`SAVE_FORMAT_VERSION` 只在存档结构不兼容时手工递增。版本字符串比较前先规范化，详见 `docs/current/tech/22-build-and-run.md` 附篇 §5。

### 4.10 测试策略

项目是确定性内核驱动的长期涌现系统。临时断言验证后删除；长期门禁是 `test-wasm.js` 和 `test-determinism.js`。不把 `cargo test --lib` 当作行为测试。

### 4.10.1 `dev-wasm` 仅供本地迭代

`--profile dev-wasm` 只用于快速反馈；严禁复制到前端、提交或部署。发布必须重新执行 `--release` 并同步双副本。

### 4.10.2 `target/` 治理

使用 `node tools/clean-target.js` 清理宿主 debug 产物；脚本保护 `target/wasm32-unknown-unknown/release`，不要手工删除发布缓存。

### 4.11 房屋系统只结算，不指挥

立宅、升级和修缮必须来自 Agent 决策；房屋系统只执行放置、施工、耐久、空置登记和拍卖等物理结算。禁止恢复旧的全图扫描派工逻辑。详见 `housing_system/AGENTS.md`。

### 4.11.1 马斯洛引擎是唯一任务入口

任何“去哪里 / 做什么”必须由 `Decisioner::arbitrate_sustained_task → dispatch_task` 产生；系统 tick、生态、房屋和账本层不得直接改写 `Seeking*`、`ReturningToCamp`、`ConstructingHouse` 等行动状态。物理层只结算已经写下的 pending 意图。

### 4.12 配置集中化

数值配置的默认真相源是前端配置，经 `rustworld.js::applyConfig` 注入 Rust。新增字段必须同步 Rust、前端、示例配置和 `config-check.js`，并且必须有真实读取点；`decisionEvalOrder` / `decisionEvalLevels` 由前端维护，Rust 不写死顺序。详见 `docs/current/tech/04-config-system.md`。

### 4.13 CI/CD

CI 使用标准 rustup，依次完成 WASM 编译、双副本同步、确定性/文档门禁后才部署；密钥只来自 GitHub Secrets，WASM MIME 必须为 `application/wasm`。详见 `docs/current/tech/26-cicd.md`。

### 4.14 决策顺序可编排

决策分支条件必须自包含；顺序由前端配置拖动、热注入并写入 localStorage，Rust 不保存一份相互竞争的固定顺序。详见 `decisions/AGENTS.md` §4.7 和 `frontend/AGENTS.md` §5.6。

### 4.15 高频 DOM 重建

高频更新容器必须使用内容快照缓存；HTML 未变化时不得重新赋值 `innerHTML`，否则会在一次点击期间替换节点并丢失交互。详见 `docs/current/tech/21-frontend-dev-guide.md` §4.5。

### 4.16 运动状态

是否移动只由 `current_lane_id.is_some()` 决定。移动态转非移动态必须调用 `enter_stationary_state()`，不得直接写 `agent.state`；到达判定使用 `current_lane_id.is_none()`，不要使用永不清空的 `route.is_empty()`。详见 `spatial/AGENTS.md` §4.6 和 `decisions/AGENTS.md` §4.9。

### 4.17 换行符

全仓统一 LF (`\n`)；提交前执行 `git diff --check`。Windows Git 建议 `core.autocrlf input` 或 `false`。

### 4.18 渲染迁移

目标是全量 WebGL 和共享深度缓冲：不要在 Canvas 2D 侧新增遮挡优化；几何、LOD、季相和遮罩逻辑留在 CPU 模型层；过渡期实体仍进入 `drawWorldEntities()` 统一队列。详见 [31 号迁移方案](./docs/plan/tech/31-canvas-to-webgl-migration.md) 和 `frontend/AGENTS.md`。

### 4.19 多 Agent 并行与写字板

本仓库有时会有多个 Agent 同时工作。开工前在根目录写字板 `WORKBOARD.md` 登记影响范围与预计起止时间，收工后删除自己的条目（文件保留复用）；提交前结合写字板只提交自己登记的改动。详见 `docs/current/tech/30-workflow.md` §5。

## 5. 文档分层

| 层级 | 载体 | 内容 |
|---|---|---|
| 全局 | 根 `AGENTS.md` | 不变量、跨模块契约、任务路由、门禁 |
| 模块 | 局部 `AGENTS.md`、`docs/current/` | 文件职责、数据结构、调用链、算法和模块易踩坑 |
| 局部实现 | 代码注释 | 函数级实现原因和短期技巧 |

同一事实只有一个权威位置，其他地方只保留链接。新增复杂目录时必须补局部指南；修改机制时同步更新对应现状文档和 `docs/current/01-changelog.md`。提交前运行文档维护、跨文档一致性和链接检查。
