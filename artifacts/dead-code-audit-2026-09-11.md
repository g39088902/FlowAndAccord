# Flow & Accord 死代码 / 空转机制审计

审计日期：2026-09-11
方法：`cargo build` 告警 + 全仓交叉引用扫描（Rust pub 项 / WASM 导出 / JS 顶层函数 / SimConfig 字段 / 枚举变体 / 模块挂载）
范围：`crates/` 73 个 .rs（20,668 行）、`frontend/` 32 个 .js（13,871 行）、`tools/` 24 个 .js

---

## 结论速览

| 类别 | 数量 | 风险 | 建议 |
| :--- | :--- | :--- | :--- |
| Rust 死代码（零引用 pub 项 / 死枚举变体 / 死导出） | 1 + 15 + 15 | 低（可安全删） | 直接删 |
| 空转配置参数（下发但内核从不读取） | 11 | 中（误导调参） | 删或接线，并补门禁 |
| 前端 / 工具死函数 | 3 | 低 | 直接删 |
| 结构性提示（门禁盲区、兼容别名簇） | 2 | — | 见 §4 |

> ⚠️ 说明：`config.js` 的 222 个 camelCase 键**全部是"活"的**——它作为 `window.SIM_CONFIG` 整体序列化下发，
> 所以"键名在前端零引用"是误报。真正的空转判据只有一个：**Rust 侧是否读取该字段**。

---

## §1 编译期可证实的死代码（可安全清理）

### 1.1 WASM 导出层（24 导出 → 1 死）

| 位置 | 项 | 说明 |
| :--- | :--- | :--- |
| `crates/sim_wasm/src/lib.rs:117` | `world_set_config(ptr,len)` | 与 `world_apply_config_buf(len)` **功能完全重复**，全项目 0 调用。删除时需同步改 `crates/sim_wasm/AGENTS.md:35,54`（该文档仍把它列为导出+错误码契约） |

### 1.2 Rust 零引用 pub 项（554 项 → 15 死）

| 位置 | 项 | 说明 |
| :--- | :--- | :--- |
| `decisions/strategy.rs:90-100` | `StrategyFailureReason`（**全 9 个变体**） | 整套"策略失败原因"汇报机制从未接线 |
| `decisions/strategy.rs:102-106` | `StrategyFeasibility`（**全 3 个变体**） | 同上，`Applicable/NotApplicable/Blocked` 无一构造 |
| `decisions/strategy.rs:76` | `CommitStage::AwaitingSettlement` | 该阶段从不构造（实际只用 Travelling/Ready） |
| `decisions/evaluate.rs:459` | `evaluate_needs_with_branch` | 自称"向后兼容别名"，0 调用 |
| `geo/query.rs:5` | `TERRAIN_SURFACE_MASK_DRY` | 常量零引用 |
| `geo/query.rs:8` | `LandUseKind::Farm` / `LandUseKind::Defense` | 两变体从不构造（只用 Road / House） |
| `spatial/graph.rs:172` | `invalidate_paths_containing_lane` | **M3 增量失效优化从未启用**——路网变更时走的仍是全量失效，性能上可能仍有空间 |
| `spatial/graph.rs:371` | `find_path_3d` | 纯包装器；实际调用点统一走 `find_path_3d_with_preference` |
| `ledger/empire.rs:82,93` | `empire_of_camp` / `all_empires` | 查询辅助，零引用 |
| `ledger/group.rs:100` | `has_member` | 查询辅助，零引用 |
| `ledger/region.rs:142` | `insert_arrival` | 零引用，且内部仍是半成品（`let _pos = ...` 未使用） |
| `ledger/region.rs:215,221` | `get_region_of_agent` / `all_regions` | 查询辅助，零引用 |
| `snapshot_bin/layout.rs:103` | `RESOURCE_ORDER_LEN` | 常量零引用（同文件注释已描述顺序，无需该常量） |
| `spatial/vec3.rs:26,30,43` | `distance_squared_to` / `horizontal_distance_to` / `normalize` | 3 个工具函数零引用 |
| `decisions/harvest.rs:115` | `CandidateStop.pool` 字段 | **编译器唯一告警**：字段从不读取 |

> 死枚举变体合计 15 个：`StrategyFailureReason` 9 + `StrategyFeasibility` 3 + `CommitStage::AwaitingSettlement` 1 + `LandUseKind` 2。

---

## §2 空转配置参数（11 项，下发但内核从不读取）

以下字段在 `config.rs` 中声明、在 `config.js` 中下发，但全仓**无任何读取点**——调它不会产生任何效果：

| 字段 | 备注 |
| :--- | :--- |
| `ticks_per_second` | 真实节拍由 `simulation_dt` 驱动 |
| `house_repair_trigger_threshold` | **与 `decision_house_repair_need_threshold` 概念重复**，后者才是生效的那个 |
| `road_connect_near_dist` | 遗留路网连接参数 |
| `road_connect_far_dist` | 同上 |
| `road_grade_pave_threshold` | 同上 |
| `road_astar_heuristic_divisor` | 遗留 A* 启发式参数 |
| `terrain_ridge_width` | 仅 `terrain_ridge_amplitude` 生效 |
| `terrain_generation_max_retries` | 重试机制已移除后的残留 |
| `terrain_accent_sub_features` | 地貌点缀子特征未接线 |
| `terrain_tree_season_tint` | 树木季节染色未接线 |
| `market_price_base_stone` | 水/木/金均有对应字段且生效，唯石材缺失 |

**门禁盲区（重要）**：`tools/config-check.js` 只校验"JS 多写的孤儿键"和"缺失键"，
**检测不出"两端口径一致、但内核从不读取"**。建议在 config-check.js 增加一条规则：
扫描 `config.rs` 的每个字段，若在 `crates/sim_core` 内除 `config.rs` 本身外零次 `.field` 读取即报错。

---

## §3 前端 / 工具死函数（3 个）

| 位置 | 函数 | 说明 |
| :--- | :--- | :--- |
| `frontend/js/render_hud.js:517` | `updateLedgerPanel()` | 零调用；功能已被 `ledger-ui.js`（M2/M3/M4 制度大盘）取代。`frontend/AGENTS.md:162` 仍在文档中记载它 → 文档漂移 |
| `frontend/js/sim_worker.js:351` | `stopLoop()` | 零调用（Worker 无主动停止路径） |
| `tools/code-map-check.js:80` | `parseCodeMapFiles(text)` | 零调用，工具内部失效函数 |

> 前端 **31 个 JS 文件全部在 `index.html` 中挂载，无孤儿文件**；`tools/` 24 个脚本均在 `docs/` 有登记，无孤儿脚本。

---

## §4 结构性提示

**1）"向后兼容别名"正在累积。**
`decisions/evaluate.rs` 存在 3 个别名转发到 2 个真实实现：

```
arbitrate_sustained_task   ← 真实实现
├─ evaluate_needs_with_branch  (别名, 已死 ✗)
├─ evaluate_needs              (别名, 在用)
dispatch_task              ← 真实实现
└─ fulfill_resting_need        (别名, 在用)
```

建议收敛到直呼真实实现，别名层无独立价值。

**2）`ledger/` 的只读查询辅助成规模未接线。**
`empire_of_camp` / `all_empires` / `has_member` / `all_regions` / `get_region_of_agent` 五个查询方法
（M3 宗族、M4 帝国/地区）全部零引用。它们不像"残留"，更像**为 UI 或诊断预留但从未接入的 API**。
需人工判断：要么接进制度大盘/诊断工具，要么删除——留着会持续误导读者以为已有消费方。

---

## §5 预计清理规模

- Rust：约 **130 行**（含 `strategy.rs` 的 2 个整枚举、`world_set_config` 20 行、5 个 ledger 查询方法）
- 配置：**11 个字段** × (config.rs + config.js + 文档) 三处同步
- 前端/工具：约 **90 行**
- 文档同步：`crates/sim_wasm/AGENTS.md`、`frontend/AGENTS.md`、`docs/current/08-config*.md`

**清理顺序建议**：先删 §1 编译期可证死代码（零风险，`cargo test --lib` 即可验证）
→ 再处理 §2 空转配置（需同步 config-check 门禁）
→ 最后评估 §4 的 ledger 查询 API 是接线还是删除。
