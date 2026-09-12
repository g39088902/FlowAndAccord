# 🗂️ TODO.md · 待办事项清单

## ✅ 已清偿技术债

- [x] **移除 JSON 快照通道 `world_snapshot_ptr/len`**（★ T1，v1.46.0 完成）：
  - 新增 `tools/snapshot-reader.js` 作为**唯一**快照取值入口（FABS 二进制优先，JSON 仅调试回退），
    6 个工具（`test-wasm` / `test-determinism` / `diagnose` / `profile-benchmark` / `gen-dag-testdata` / `gold_mining_analysis`）全部改调它；
  - `crates/sim_wasm/src/lib.rs` 的 `world_snapshot_ptr` / `world_snapshot_len` / `SNAPSHOT_BUF` 已删除，
    取而代之的是 **test-only** 的 `world_snapshot_json_debug_ptr/len` —— 它是 `tools/test-snapshot-bin.js`
    「四处同步防漂移」门禁的**唯一真值源**，除该门禁外禁止任何代码调用；
  - `sim_worker.js` 的 JSON 回退分支已删除，快照链路收敛为单一 FABS 二进制通道。
  - 详见 `./docs/plan/tech/08-performance.md` §5.1。
- [x] **M5-0 快照桥接收尾**（★ v1.46.0 完成）：解码热路径去 BigInt、驻留表缓存改数组、清理对象池死代码、
  `sim_worker.js` 按人口自适应降频（30/25/20/15Hz）。FABS 单帧 **4,607.5 → 1,837.9 µs（2.51x）**，
  满载 442 人 30Hz 占用 **13.8% → 5.5%**（叠降频后 3.7%，< 5% 验收线）。详见 `./docs/plan/tech/08-performance.md` §5.2。
  - 顺带修复**跨世界驻留表串味**缺陷（`STR_TAB.start_index == 0` 判据 + `test-snapshot-bin.js` [4/4] 门禁）。

- [x] **时光倒流机制整理归档**（2026-09-12 完成）：机制早已落地（v1.33.0 引入、v1.42.0 补现实时间守卫与分块重演、v1.46.1 修复为可审计分支语义），但一直只散落在 changelog 里、没有成文描述。现已补 `./docs/current/tech/06-snapshot-and-save.md` **附篇《时光倒流（Checkpoint + Replay）》**：检查点记录策略（30 tick / 150ms / 160 份近密远疏）、命令日志按序重注入、十步回滚算法、前端消息协议与 UI、7 条不变量、4 项已知限制。

## 📋 常规待办

- [ ] 落地荒地开垦农田与农业税经济系统：农田资产、自主投资运料、真实劳作与收获搬运、卸货产出税与库存税并存（设计稿：[农业方案](./docs/plan/tech/04-farmland-agriculture.md)；共享前置：[融合设计](./docs/plan/tech/01-integration-contracts.md)）
- [ ] 落地生态狩猎、流寇危机与武力公约系统：动态漫游兽群、流民落草与外部掠夺、民兵动员与公仓防御契约、生命力(Vitality)解耦（设计稿：[狩猎防御](./docs/plan/tech/05-hunting-defense.md)；物资/身体及土地通行前置见[融合设计](./docs/plan/tech/01-integration-contracts.md)）
