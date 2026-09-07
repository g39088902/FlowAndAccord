# 🗂️ TODO.md · 待办事项清单

## 🔴 高优先级技术债（★ M4 v1.45.3 登记）

- [ ] **移除 JSON 快照通道 `world_snapshot_ptr/len`**（判定条件：M4 FABS 二进制快照已稳定运行数版本）：将 `tools/test-wasm.js` / `tools/test-determinism.js` / `tools/diagnose.js` / `tools/profile-benchmark.js` / `tools/gen-dag-testdata.js` / `tools/gold_mining_analysis.js` 六个工具的取值从 JSON 改造为二进制（或二进制↔JSON 通用读取），随后删除 `crates/sim_wasm/src/lib.rs` 的 `world_snapshot_ptr` / `world_snapshot_len` 与 `SNAPSHOT_BUF`（代码已标 `DEPRECATED(M4)` 注释），并同步 `sim_worker.js` 的 JSON 回退分支。设计详见 `docs/16-plan-performance-optimization.md` M4 与技术债说明。

## 📋 常规待办

- [ ] 落地荒地开垦农田与农业税经济系统：农田资产、资本投资、农业产出、农业税与 B19 自主投资决策（设计稿：docs/17-plan-farmland-agriculture.md）
- [ ] 整理相关代码逻辑，告诉我目前是怎么实现时光倒流的
