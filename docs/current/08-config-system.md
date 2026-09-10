# 8. ⚙️ JavaScript 动态数值配置系统 (`config.js`)

> **模块索引**：[← 返回 01-current.md 全景索引](../01-current.md) · 主要源码：`frontend/js/config.js`、`frontend/js/rustworld.js`、`crates/sim_core/src/config.rs`

---

## 模块定位

全部仿真超参数的统一配置入口。**240 个** `SimConfig` 字段由 `frontend/js/config.js` 及拆分配置（`config.house-upgrade-cost.js` / `config.decision-order.js`）驱动，经 `rustworld.js::applyConfig` 反序列化注入 Rust WASM 内存，实现免重新编译的热调优。Rust 逻辑层一律通过 `self.config.<字段>` 引用，禁止散落字面量。

## 核心机制

### 全量超参数抽取
- `SimConfig` 共 **240 个字段**，按 14 个分区组织（分区与字段数以 `crates/sim_core/src/config.rs` 注释及 [06-config-reference.md](../06-config-reference.md) 自动速查表为准）：
  1. 引擎节拍与时间基准（3 字段）
  2. 部落民生理、代谢与生命周期（46 字段）
  3. 先天禀赋与遗传演化（9 字段）
  4. 生态地标与 POI 采收交互（32 字段）
  5. 马斯洛需求与决策门槛（20 字段）
  6. 私宅营造、代际传承与升级（34 字段）
  7. 地形生成、地表查询与山口 profile（6 字段）
  8. 四季更迭与宏观气候（9 字段）
  9. 空间路网、限速与踩踏演化（14 字段）
  10. 动力学移动与寻路权重（10 字段）
  11. 账本与婚姻登记子系统（1 字段）
  12. 宗族系统 (M3)（6 字段）
  13. 地区与王国系统 (M4)（10 字段）
  14. 外部市场（榷场互市）与幂律动态定价（16 字段）
  15. 二手房屋市场、营地中介拍卖与麦穗竞价（9 字段）

### 免编译热调优
- 前端 `rustworld.js` 在加载 WASM 及重置模拟时，通过 `world_set_config` / `world_apply_config_buf` 将 `window.SIM_CONFIG` 动态序列化注入 Rust WASM 内存。
- 开发者直接编辑 `frontend/js/config.js` 并刷新浏览器（Ctrl+F5），即可即时生效，无需重编 WASM。
- `config.js` 每个字段均带中文行内说明。

### POI 产速的本地创世偏好（v1.46.2）
- `frontend/js/config.poi-rates.js` 在 `rustworld.js` 前运行，读取版本化键 `flowaccord.poi-regen-rates.v1`（schema 1；水/果/木/石/金各 0~5 倍）。
- 滑块修改会立即写入当前世界，也会持久化此偏好；后续新开/重演世界在 `world_create` 前已携带该组值，并在第 0 帧快照、第一 tick 前写入内核。
- 这不是存档配置替换：读档必须继续尊重档内已保存的倍率，确保存档续演不被浏览器偏好篡改。

### 唯一数值真相源（v1.44.9 起）
- **前端 JS (`frontend/js/config.js`) 为仿真超参数的唯一数值真相源**。
- Rust 内核 `crates/sim_core/src/config.rs` 中的 200 余个 `pub const` 默认数值常量与手写 `impl Default` 已彻底废弃删除，`SimConfig` 纯净派生 `#[derive(Default)]`（零值中性兜底）。
- WASM 初始化与世界创建前通过持久全局缓冲注入前端 `SimConfig`，仿真行为 100% 由前端 JS 传入的数值驱动。

### 地形配置分区
T0/T1 已接入 6 个配置字段：

| 字段 | 当前默认值 | 作用 |
| :--- | :--- | :--- |
| `terrainProfile` | `mountain_pass_v1` | 地形生成 profile 与存档重建口径 |
| `terrainMaxWalkSlope` | `30.0` | 道路/走廊的最大允许坡度 |
| `terrainMaxBuildSlope` | `16.0` | 房屋完整占地的最大允许坡度 |
| `terrainFootprintHalfExtent` | `7.0` | 房屋基础占地半尺寸 |
| `terrainRoadCorridorWidth` | `5.0` | T0 曲线走廊校验宽度 |
| `terrainGenerationMaxRetries` | `8` | 地形布局校验的有界重试上限 |

`terrainProfile` 影响 seed 重建与存档门禁；其余字段经 `config.js` 热注入。改变影响行为的字段后必须重新运行 `config-check.js` 和确定性门禁。

## 免编译热调优
- 前端 `rustworld.js` / `sim_worker.js` 在加载 WASM 及创建/重置模拟时，通过 `world_set_config` / `world_apply_config_buf` 将 `window.SIM_CONFIG` 动态序列化注入 Rust WASM 内存。
- 开发者直接编辑 `frontend/js/config.js` 并刷新浏览器（Ctrl+F5），即可即时生效，无需重编 WASM。
- `config.js` 每个字段均带中文行内说明。

### 新增超参规范
在新增仿真超参数时：
1. **Rust 端**：在 `crates/sim_core/src/config.rs` 的 `SimConfig` 结构体中添加对应类型的 `pub` 字段（如 `pub foo: f32,`）。
2. **前端**：在 `frontend/js/config.js` 对应模块中定义 camelCase 字段及权威数值，并配齐中文行内注释。

### 数组类型字段与「Rust 无顺序」例外（v1.3.6 起）
- `decisionEvalOrder: Vec<String>` / `decisionEvalLevels: Vec<u8>` 支持数组类型：策展顺序的权威值存在于前端 `frontend/js/config.decision-order.js`（启动时合并进 `SIM_CONFIG`）。
- 决策引擎视图拖动后经 `POST /save-decision-order`（`frontend/server.js` 端点，校验 + 原子写）重写该文件；静态部署无写文件能力时降级暂存 localStorage。

### 配置校验工具 `tools/config-check.js`
零依赖纯 Node 脚本，作为**纯契约门禁**校验 `config.js` 与 `config.rs`：
1. **孤儿字段**：前端有 / Rust 无
2. **缺失字段**：Rust 有 / 前端无
3. **类型错配**：`usize/u64`、浮点、布尔与 `Vec<String>`/`Vec<u8>` 数组类型严格一致
4. **速查表生成**：数值 100% 提取自 `config.js` 唯一真相源，自动更新生成 `docs/06-config-reference.md`。

任一报错即说明前后端契约未同步，须先修复再发布。改参或字段后必跑。

### 参数速查表 `docs/06-config-reference.md`
- 由 `config-check.js` 自动生成，按分区罗列每个字段的 camelCase 名、类型、默认值（取自 JS）、**影响模块**与中文说明。
- 是用户检索/核对参数的权威速查表，**不要手工维护**。
- 改字段后重跑 `node tools/config-check.js` 即可刷新。

## 关键不变量
- `SimConfig` 当前有效字段数为 **221 个**。
- 前端 JS 为仿真超参数的唯一数值真相源，Rust 内核不保留数值字面量常量。
- `config.js` 字段集与类型必须与 `config.rs` 契约严格 100% 吻合。
- `node tools/config-check.js` 与 `node tools/test-wasm.js` 双绿方为可发布状态。

## 与其他模块接口
- `rustworld.js`：`applyConfig` 将 JSON 序列化注入 WASM 内存。
- `sim_wasm`：导出 `world_set_config` / `world_apply_config_buf` 函数接收配置。
- 所有 Rust 逻辑模块：通过 `self.config` 读取参数。
- `tools/config-check.js`：校验前后端一致性并生成速查表。

## 调参入口
所有参数均在 `frontend/js/config.js` 中，字段说明见 [06-config-reference.md](../06-config-reference.md)。
