# Flow & Accord · 全局智能体开发指南

> **改代码前必读。** 本文件只定义跨目录适用的规则：任务路由、架构边界、跨模块不变量、验证门禁和文档分层。模块实现、游戏机制、文件清单与局部易踩坑写在最近的子目录 `AGENTS.md` 或 `docs/current/`；规则冲突时本文件优先。

## 1. 任务路由与权威入口

先读改动范围对应的最小指南，再读目标模块的权威技术文档：

| 范围 | 局部指南 | 权威文档 |
|---|---|---|
| `crates/sim_core/` | `crates/sim_core/AGENTS.md` | `docs/current/tech/01-engine-architecture.md` |
| `crates/sim_core/src/spatial/` | `spatial/AGENTS.md`，必要时再读其子目录指南 | `docs/current/tech/11-decision-engine.md`、`13-housing-system.md`、`08-ecology-and-poi.md` |
| `crates/sim_core/src/geo/` | `geo/AGENTS.md` | `docs/current/tech/14-terrain-and-network.md` |
| `crates/sim_wasm/` | `crates/sim_wasm/AGENTS.md` | `docs/current/tech/06-snapshot-and-save.md` |
| `frontend/` | `frontend/AGENTS.md` | `docs/current/tech/19-ui-implementation.md`、`21-frontend-dev-guide.md` |
| 跨模块、发布或存档 | 本文件、相关局部指南 | `docs/current/tech/30-workflow.md`、`28-invariants.md`、`29-impact-matrix.md` |

局部指南清单：`sim_core`、`sim_core/src/{geo,spatial}`、`spatial/{decisions,ecology,housing_system,ledger}`、`sim_wasm`、`frontend`。文档总入口是 [`docs/README.md`](docs/README.md)，现状索引是 [`docs/current/README.md`](docs/current/README.md)。

## 2. 架构边界

```text
sim_core → sim_wasm → frontend/rust/sim_wasm.wasm
                    → frontend/sim_wasm.wasm → sim_worker.js → rustworld.js → WebGL/Canvas 过渡层
```

- `sim_core` 是确定性模拟内核；`sim_wasm` 只做桥接、tick、配置注入、快照和存档；`frontend` 负责 Worker、快照解码、配置 UI 与渲染（浏览器 UI (版本: v1.63.0)）。
- 内核状态与表现层解耦：前端渲染不得改模拟状态或改变 `WorldRng` 消费顺序。
- 修改渲染前必须读 `frontend/AGENTS.md` 与 [`31-canvas-to-webgl-migration.md`](docs/plan/tech/31-canvas-to-webgl-migration.md)。

## 3. 跨模块不变量

- **确定性与 tick：** `simulationDt` 固定为 `1/60`；倍速只能通过多步 tick。tick 顺序和业务机制以 `spatial/AGENTS.md` 及其子指南为准。
- **WASM 双副本：** Rust 发布构建后必须同时更新 `frontend/rust/sim_wasm.wasm` 与 `frontend/sim_wasm.wasm`；`dev-wasm` 产物不得复制或提交。
- **FABS 快照：** 新增 `agent`、`house`、`poi` 字段必须同步 Rust 定义、快照生成、二进制编码/字典、前端解码/映射；详见 `spatial/AGENTS.md` §3.3 与 `docs/current/tech/06-snapshot-and-save.md` §7.1。
- **跨世界缓存：** `STR_TAB` 仅以 `start_index == 0` 判定新世界；`world_load` / `world_create` 后清理工具侧缓存。
- **配置：** 默认值以 `frontend` 配置为真相源，经 `rustworld.js::applyConfig` 注入 Rust；新增字段必须同步 Rust、前端、示例与 `config-check.js`，且必须有真实读取点。
- **版本与存档：** 版本号使用 `node tools/bump-version.js`；兼容规则和 `SAVE_*_VERSION` 见 `docs/current/tech/22-build-and-run.md`。
- **文件与换行：** 单文件原则上不超过 800 行；功能增长应拆分模块并补局部指南。全仓使用 LF，提交前运行 `git diff --check`。
- **浏览器验证：** 真实存档使用 Chrome/Edge 的 File System Access API；内置浏览器 `?nogate=1` 只验证非存档链路。

游戏业务规则不在此重复：决策与寻路见 `spatial/decisions/AGENTS.md`，生态与搬运见 `spatial/ecology/AGENTS.md`，房屋见 `spatial/housing_system/AGENTS.md`，账本见 `spatial/ledger/AGENTS.md`，地形见 `geo/AGENTS.md`，生命周期见 `docs/current/tech/10-agent-life-cycle.md`，POI 见 `docs/current/tech/08-ecology-and-poi.md`。

## 4. 构建、运行与门禁

发布 WASM（仅发布构建）：

```text
cargo build -p sim_wasm --target wasm32-unknown-unknown --release
# 将 target/wasm32-unknown-unknown/release/sim_wasm.wasm 复制到上述两个 frontend 路径
```

常用运行命令：`node frontend/server.js`（默认 `http://localhost:3000`）。每次重编译 WASM 后强制刷新；页面顶部标题栏显示版本徽章 **`v1.63.0`**，版本升版统一使用 `node tools/bump-version.js`。

长期门禁按改动类型选择 [`30-workflow.md`](docs/current/tech/30-workflow.md)：`test-wasm.js`、`test-determinism.js`、`config-check.js`、`frontend-check.js`、`snapshot-check.js`、`doc-link-check.js`、`cross-doc-check.js`、`code-map-check.js`、`doc-maintenance-check.js`、`bump-version.js --check`。纯文档改动至少运行工作区检查、文档维护、跨文档一致性和版本检查；不要为文档改动运行无关的 Rust 发布构建。

提交前核对：是否读了受影响目录指南，是否完成快照/配置/WASM 双副本同步，是否更新必要技术文档与变更记录，是否只提交自己的改动。多 Agent 并行登记规则见 [`WORKBOARD.md`](WORKBOARD.md)；开工登记，收工清理。

## 5. 文档分层

- **根指南：** 只放跨目录规则和入口，不放具体游戏数值、行动状态、tick 子步骤或 UI 组件实现。
- **模块指南：** 放职责、调用链、数据结构、机制契约和模块级验证。
- **技术文档：** 放稳定的现状设计、兼容约束与跨模块影响。
- **代码注释：** 只解释函数级实现原因和短期技巧。

同一事实只保留一个权威位置；机制变更同步对应 `docs/current/` 文档和 `docs/current/01-changelog.md`，并运行文档维护、跨文档一致性与链接检查。
