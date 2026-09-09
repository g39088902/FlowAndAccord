# Agent 开发快速入口

> 本页是修改代码前的最小入口。若与根 `AGENTS.md` 或目录级 `AGENTS.md` 冲突，以根文档为准。

## 1. 先判定任务类型

先读根 `AGENTS.md` §4。快照主链路已采用 M4 二进制：字段变更还必须检查 `snapshot_bin/encode.rs`、`snapshot-bin.js` 并运行 `node tools/test-snapshot-bin.js`。JSON 赋值实际位于 `world_snapshot.rs`。

| 任务关键词 | 首先阅读 | 最小门禁 |
|---|---|---|
| 快照 / Agent / House / POI 字段 | `docs/current/13-impact-matrix.md`、`crates/sim_core/src/spatial/AGENTS.md` | `node tools/snapshot-check.js`、`node tools/frontend-check.js` |
| 决策 / NeedKind / 路由 | `crates/sim_core/src/spatial/decisions/AGENTS.md`、影响矩阵 §1.3 | `cargo test --lib`、`node tools/test-wasm.js` |
| 账本 / 家户 / 宗族 / 王国 | `crates/sim_core/src/spatial/ledger/AGENTS.md`、`docs/current/12-ledger-system.md` | `cargo test --lib`、`node tools/test-wasm.js` |
| 配置 / 超参 | `docs/current/08-config-system.md`、影响矩阵 §1.8 | `node tools/config-check.js` |
| 前端 / DOM / UI | `frontend/AGENTS.md`、`docs/current/23-ui-dev-guide.md` | `node tools/frontend-check.js` |
| WASM / 导出 / 存档 | `crates/sim_wasm/AGENTS.md`、`docs/current/15-save-load.md` | WASM 双副本、`node tools/test-wasm.js` |
| 仅文档 / AGENTS.md 内容 | 根 `AGENTS.md` §4.0.1、`docs/current/19-commit-checklist.md` §G | `node tools/doc-maintenance-check.js`（不升版、不跑测试） |

## 2. 修改前四问

1. 谁是该数据或行为的唯一真相源？
2. 哪些模块生产、适配、消费它？是否需要更新影响矩阵？
3. 它属于哪个 tick 阶段，读写边界是否改变？
4. 是否涉及版本、快照、配置、存档或确定性契约？

## 3. 完成定义

- 代码、WASM 双副本（如适用）和文档已同步；
- 运行与改动类型匹配的专项门禁；
- 运行 `node tools/doc-maintenance-check.js`；发布追加 `--strict`，提交按 `19-commit-checklist.md` 执行；
- 使用 `node tools/bump-version.js --patch` 统一升版，并用 `--check` 验证零漂移（**仅代码/配置/契约变化时**；纯文档变更跳过升版与测试，按 `19-commit-checklist.md` §G 执行）；
- 在 `docs/current/11-changelog.md` 记录行为或契约变化。

## 4. 交互遗漏排查顺序

`唯一真相源 → Rust 生产者 → WASM/快照适配器 → 前端消费者 → 存档/恢复 → 门禁与文档`。

遇到“无动作”或 `undefined` 时，优先检查这条链，而不是先修改调用方的兜底逻辑。
