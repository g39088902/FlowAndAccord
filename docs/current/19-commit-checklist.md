# Commit 前检查单

> 本清单是 `AGENTS.md §4.0.1` 的详细执行版。它只约束准备提交的改动；未涉及的模块跳过对应专项项。

## A. 所有提交必做

```bash
git status --short
git diff --check
node tools/doc-maintenance-check.js
```

- [ ] 工作区只有本次任务相关文件；没有构建产物、临时截图、调试输出、`.playwright-cli/` 或临时测试脚本。
- [ ] `git diff --check` 无空白错误，新增/删除/重命名文件和引用路径已核对。
- [ ] 文档维护检查没有未处理的 `MISSING_DOC`、`MISSING_SOURCE` 或 `UNTRACKED_DOC`；源码产生的 `NEEDS_REVIEW` 已复核。
- [ ] 版本号、对应 `docs/current/` 文档、`11-changelog.md` 已按项目规范同步。

## B. Rust、WASM 或快照改动

```bash
cargo build -p sim_wasm --target wasm32-unknown-unknown --release
# 复制 release wasm 到 frontend/rust/sim_wasm.wasm 与 frontend/sim_wasm.wasm
cargo test --lib
node tools/test-wasm.js
```

- [ ] WASM 双副本已同步。
- [ ] 快照字段已同步 `snapshot.rs` / `world.rs`（或 `world_snapshot.rs`）/ `frontend/js/rustworld.js`。
- [ ] 同种子确定性、无 NaN、无越界、长程稳定性通过。
- [ ] 若涉及配置，额外运行 `node tools/config-check.js`。

## C. 前端 HTML / CSS / JS 改动

- [ ] 新增或修改的 DOM ID 已搜索全部引用，事件委托和脚本加载顺序正确。
- [ ] 高频刷新区域没有因 `innerHTML` 重建破坏点击、悬停或拖拽；必要时使用内容快照缓存。
- [ ] Inspector 关闭、`Esc`、遮罩点击、模态返回和镜头跟随状态已检查。
- [ ] 窗口结构或跳转关系变化已同步 [17-frontend-window-navigation.md](17-frontend-window-navigation.md)。
- [ ] 受影响的地图拾取、账本 chip、族谱、存档、拍卖路径已在浏览器手测。

## D. 配置、决策顺序或拆分配置改动

```bash
node tools/config-check.js
```

- [ ] Rust `const` / `SimConfig` / `Default`、前端配置和拆分配置三方一致。
- [ ] `config.decision-order.js`、`config.house-upgrade-cost.js` 仍早于 `rustworld.js` 加载。
- [ ] `tools/test-wasm.js` 的注入配置与浏览器一致。

## E. 诊断规则或行为机制改动

```bash
node tools/diagnose.js --check all
```

- [ ] 使用固定 Seed/Tick 复现并记录结果，相关规则（尤其 Rule 5）无新增异常。
- [ ] 临时 `#[cfg(test)]`、`tests.rs`、调试断言和实验脚本已删除。

## F. 最终 diff 审阅

执行 `git diff --stat` 和 `git diff --name-only`，逐文件确认：

- [ ] diff 都属于本次任务，删除操作、版本号、文档链接和配置字段无误。
- [ ] 对外文案、错误提示和空态与当前机制一致。
- [ ] 提交说明包含“改了什么 / 为什么改 / 如何验证”；未执行的门禁已说明原因。

## 允许提交的最低标准

A 必须全部通过；命中 B/C/D/E 时，对应专项项必须通过。`--strict` 主要用于发布或 CI；本地小改动可以暂不阻塞，但报告中的问题必须有明确归属和处理计划。

