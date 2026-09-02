# 💾 读档 / 存档系统 (v1.8.0)

> **模块索引**：[← 返回 CURRENT.md 全景索引](../CURRENT.md)
> **主要源码**：`crates/sim_core/src/spatial/world_save.rs` + `crates/sim_wasm/src/lib.rs` + `frontend/js/save-ui.js`
> 相关文档：[13-impact-matrix.md](./13-impact-matrix.md)（跨模块影响）· [14-invariants.md](./14-invariants.md)（确定性硬约束）· `crates/sim_core/src/spatial/AGENTS.md` · `frontend/AGENTS.md`

---

## 一、定位与设计红线

存档系统把「内核全量世界状态」序列化为 JSON，浏览器落 `localStorage`，支持三槽位与文件导入导出。

**三条设计红线**：

1. **强确定性**：读档后继续 tick 的演化，必须与「从不中断连续跑到同一 tick」**逐字节一致**。由 `tools/test-wasm.js` 的 Test 3 长期守卫。
2. **可重建字段不入库**：`terrain` 按种子重建、`agent_index` 读档重建，省体积且不引入冗余真相源。
3. **版本不兼容即拒绝**：`format_version` 不符时返回错误并**保持原世界不变**，绝不静默降级加载（Test 4 守卫）。

---

## 二、内核层：存档契约 `WorldSave`

文件：`crates/sim_core/src/spatial/world_save.rs`（~200 行）

```
World3DEngine
  ├─ to_save()                  逐字段填充 WorldSave（clone 语义，不移动所有权）
  ├─ serialize_save(&world)     → Result<String>   JSON
  └─ deserialize_save(&str)     → Result<World3DEngine>
                                  ① 校验 format_version
                                  ② 校验 grid_res / world_size
                                  ③ 校验 agent id 唯一（防脏档让 agent_index 错乱）
                                  ④ TerrainMap::new + generate_natural_landscape(seed) 重建地形
                                  ⑤ rebuild_agent_index() 重建派生索引
```

### 2.1 入库字段清单

| 分组 | 字段 |
| :--- | :--- |
| 元信息 | `format_version` / `app_version` |
| 重建参数 | `seed` / `grid_res` / `world_size` |
| 基础实体 | `network` / `pois` / `houses` / `agents` |
| 发号器 | `next_agent_id` / `next_house_id`（各登记簿的 `next_id` 内嵌在自身结构里） |
| 计数器 | `total_births` / `total_deaths` / `total_deaths_natural` / `total_deaths_unnatural` / `total_miscarriages` |
| 环境 | `season_timer` / `current_season` / `temperature` |
| **确定性核心** | `rng`（`WorldRng` 内部 `state: u64`） |
| 生态倍率 | `water/berry/wood/stone/gold_regen_multiplier` |
| 时钟 | `tick_counter` / `last_event` |
| 配置 | `config`（`SimConfig` 全量，**读档沿用存档时的配置**） |
| 社会制度 | `marriage_registry` / `household_registry` / `clan_registry` / `region_registry` / `public_granary` |
| 冷却表 | `mutual_aid_cooldown` / `expedition_targets` / `relief_cooldown`（均 BTreeMap 保序） |

每名 agent 的私有状态（`poi_seekability` 施密特触发器 / `family_stock_active` / `gold_mining_cooldown` / `miscarriage_cooldown_timer` / `route` 等）随 `Agent3D` 整体序列化，**无需单独处理**。

### 2.2 显式排除的字段

| 字段 | 排除理由 | 恢复方式 |
| :--- | :--- | :--- |
| `terrain` | 3600 栅格完全由 `seed` 确定性生成，入库约百 KB 纯冗余 | `TerrainMap::generate_natural_landscape(seed)` |
| `agent_index` | `AgentId → Vec 下标` 的派生索引，入库即冗余真相源 | `rebuild_agent_index()` |

### 2.3 序列化能力补齐

| 类型 | 处理 |
| :--- | :--- |
| `WorldRng` | 补 `Serialize/Deserialize`（仅一个私有 `state: u64`） |
| `LaneGraph3D` | **手写** serde：只持久化「按插入顺序的节点/车道扁平列表 + 两个发号器」，反序列化按同序重建 `graph`/`node_map`/`edge_map`。正确性前提是路网从不删除节点/车道（`housing_system/AGENTS.md` §4.2），因此邻接表边序与原图逐条一致，A* 结果保持确定性 |
| `PrimitivePoi` 的 `current_stock` / `max_stock` / `regen_rate` | 走 `finite_f32` 助手：非有限值用字符串哨兵（`Infinity` / `-Infinity` / `NaN`）编码。**营地储量恒为 `INFINITY`**，若按 serde_json 默认的 `null` 编码，反序列化 f32 会直接报错导致「能存不能读」 |

---

## 三、WASM 桥接层

文件：`crates/sim_wasm/src/lib.rs`。沿用现有「线性内存 JSON 缓冲区」约定，新增静态 `SAVE_BUF` 与 `ERROR_BUF`。

| 导出 | 语义 |
| :--- | :--- |
| `world_save_ptr()` / `world_save_len()` | 导出当前世界存档 JSON；失败时缓冲清空（len=0） |
| `world_save_buf_ptr(len)` | 准备可写缓冲，返回指针 |
| `world_load(len) -> i32` | 载入缓冲中的存档并覆盖世界：`0` 成功 / `-1` 长度越界 / `-2` 非 UTF-8 / `-3` 解析或校验失败（含版本不兼容） |
| `world_last_error_ptr()` / `world_last_error_len()` | 最近一次失败原因文本（成功时长度 0） |

---

## 四、前端层

### 4.1 适配层 `rustworld.js`

| 方法 | 说明 |
| :--- | :--- |
| `saveWorld()` | 调 `world_save_ptr/len` 取回存档 JSON 字符串，失败返回 `null` |
| `loadWorld(jsonStr, meta?)` | 编码 → `world_save_buf_ptr` → 写入 → `world_load`；成功后清空 `_trails` / `agentArchive` / `_lastEvent` / `_terrainCached`、`deselect()`，再 `_pullSnapshot(true)` 强制重建地形快照 |
| `readSaveError()` | 读取内核错误文本 |

**读档后不重新注入 `window.SIM_CONFIG`**——存档自带 `SimConfig`，重注入会让前端热调参覆盖存档时的运行参数、破坏续演语义。

### 4.2 UI 层 `save-ui.js`（新文件，~330 行）

- **三槽位**：自动槽（每 60 秒覆盖，世界未推进则跳过）/ 手动槽 1 / 手动槽 2。
- **存储键**：正文 `flowaccord.save.v1.<slotId>`，元信息统一放索引键 `flowaccord.save.v1.__index`（避免正文重复占用配额）。
- **元信息**：`tick` / 存活人口 / 存续家户数 / 保存时间 / 种子 / 体积 / `app_version`，仅在保存或导入时解析一次。
- **面板**：顶栏「💾 存档」「📂 读档」两个按钮打开同一面板，切换保存/读取标签；槽位卡片支持覆盖保存、读取、导出、删除（二次确认）；底部支持导入 `.json` 文件（校验 `format_version` 后直接载入）。
- **读档后自动暂停**并同步顶栏暂停按钮文案，便于核对世界状态。
- **Esc 关闭**走捕获阶段拦截，避免同时触发 Inspector 关闭逻辑。

---

## 五、验证

`tools/test-wasm.js`（长期唯一自动化验证）：

| 用例 | 断言 |
| :--- | :--- |
| Test 3 存档读档确定性 | 同种子跑到存档点 → 存档 → 续演；对照组新建同种子世界跑到存档点 → 读档 → 续演同一步数，两组快照 JSON **逐字符串相等**；且读档后 `tick` 与存档时刻一致 |
| Test 4 版本门禁 | 篡改 `format_version` 后 `world_load` 返回 `-3`，且**当前世界快照不变**（失败不污染内存） |

当前实测：存档体积 **约 392 KB**（世界 60×60、30 名族人、10 座房屋），三槽位合计约 1.2 MB，在 localStorage 5 MB 配额内。

---

## 六、易踩坑

1. **新增引擎字段必须同步 `WorldSave`**：`World3DEngine` 加字段后若忘记加进契约，读档会静默丢状态（编译器不会报错，因为 `deserialize_save` 是逐字段构造）。Test 3 的确定性对比能捕获大部分漏存，但不是全部——**加字段时同步改 `world_save.rs` 的三个位置**：结构体字段、`to_save()` 填充、`deserialize_save()` 构造。
2. **非有限浮点必须走 `finite_f32`**：任何可能为 `INFINITY`/`NaN` 的入库 f32 字段都要加 `#[serde(with = "finite_f32")]`，否则存得进、读不回。
3. **读档必须重建 `agent_index`**：遗漏会导致 `agent_by_id()` 返回错误下标或 panic。
4. **读档必须强制重建地形快照**：不同种子的档地形不同，`_terrainCached` 不清会沿用旧地形。
5. **`format_version` 与 `SAVE_FORMAT_VERSION` 必须同改**：Rust 常量在 `world_save.rs`，前端常量在 `save-ui.js`，二者一致才能正确提示版本不兼容。
