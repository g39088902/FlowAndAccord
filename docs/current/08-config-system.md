# 8. ⚙️ JavaScript 动态数值配置系统 (`config.js`)

> **模块索引**：[← 返回 CURRENT.md 全景索引](../CURRENT.md) · 主要源码：`frontend/js/config.js`、`frontend/js/rustworld.js`、`crates/sim_core/src/config.rs`

---

## 模块定位

全部仿真超参数的统一配置入口。153 个 `SimConfig` 字段由 `frontend/js/config.js` 驱动，经 `rustworld.js::applyConfig` 反序列化注入 Rust WASM 内存，实现免重新编译的热调优。Rust 逻辑层一律通过 `self.config.<字段>` 引用，禁止散落字面量。

## 核心机制

### 全量超参数抽取
- `SimConfig` 共 **153 个字段**，按 10 个分区组织：
  1. 引擎节拍与时间基准（3 字段）
  2. 部落民生理、代谢与生命周期（46 字段）
  3. 先天禀赋与遗传演化（5 字段）
  4. 生态地标与 POI 采收交互（31 字段）
  5. 马斯洛需求与决策门槛（15 字段）
  6. 私宅营造、代际传承与升级（27 字段）
  7. 四季更迭与宏观气候（3 字段）
  8. 空间路网、限速与踩踏演化（12 字段）
  9. 动力学移动与寻路权重（10 字段）
  10. 账本与婚姻登记子系统（1 字段）

### 免编译热调优
- 前端 `rustworld.js` 在加载 WASM 及重置模拟时，通过 `world_set_config` / `world_apply_config_buf` 将 `window.SIM_CONFIG` 动态序列化注入 Rust WASM 内存。
- 开发者直接编辑 `frontend/js/config.js` 并刷新浏览器（Ctrl+F5），即可即时生效，无需重编 WASM。
- `config.js` 每个字段均带中文行内说明。

### 新增超参三处同步
在 `crates/sim_core/src/config.rs` 中必须同时出现：
1. **命名 `const`**（默认值唯一真相源，如 `pub const FOO: f32 = 1.0;`）
2. **`SimConfig` 字段**（如 `pub foo: f32,`）
3. **`Default` 映射**（如 `foo: FOO,`）

前端 `config.js` 同步添加对应 camelCase 字段与中文注释。

### 配置校验工具 `tools/config-check.js`
零依赖纯 Node 脚本，交叉解析 `config.js` 与 `config.rs`，捕获四类问题并以退出码报错：
1. **孤儿字段**：前端有 / Rust 无
2. **缺失字段**：Rust 有 / 前端无
3. **类型错配**：`usize/u64` 与浮点
4. **数值漂移**：默认值不一致

任一报错即说明前后端已失同步，须先修复再发布。改参后必跑。

### 参数速查表 `docs/config-reference.md`
- 由 `config-check.js` 自动生成，按分区罗列每个字段的 camelCase 名、类型、默认值与中文说明。
- 是用户检索/核对参数的唯一权威入口，**不要手工维护**。
- 改 `config.rs` 后重跑 `node tools/config-check.js` 即可刷新。

## 关键不变量
- `SimConfig` 字段数为 153（非 161，v0.9.65 清理废弃超参后降至 154，v0.9.72 新增账本字段后为 153——以实际 `config.rs` 为准）。
- 严禁在 Rust 逻辑层散落字面量或直引 `const`，一律通过 `self.config.<字段>` 引用。
- `config.js` 字段集/类型/默认值必须与 `config.rs` 完全一致。
- `node tools/config-check.js` 与 `node tools/test-wasm.js` 双绿方为可发布状态。

## 与其他模块接口
- `rustworld.js`：`applyConfig` 将 JSON 序列化注入 WASM 内存。
- `sim_wasm`：导出 `world_set_config` / `world_apply_config_buf` 函数接收配置。
- 所有 Rust 逻辑模块：通过 `self.config` 读取参数。
- `tools/config-check.js`：校验前后端一致性并生成速查表。

## 调参入口
所有参数均在 `frontend/js/config.js` 中，字段说明见 [config-reference.md](../config-reference.md)。
