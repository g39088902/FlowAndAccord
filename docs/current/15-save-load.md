# 💾 读档 / 存档系统 (v1.11.0)

> **模块索引**：[← 返回 current.md 全景索引](../current.md)
> **主要源码**：`crates/sim_core/src/spatial/world_save.rs` + `crates/sim_wasm/src/lib.rs` + `frontend/js/save-ui.js`
> 相关文档：[13-impact-matrix.md](./13-impact-matrix.md)（跨模块影响）· [14-invariants.md](./14-invariants.md)（确定性硬约束）· `crates/sim_core/src/spatial/AGENTS.md` · `frontend/AGENTS.md`

---

## 一、定位与设计红线

存档系统把「内核全量世界状态」序列化为 JSON，支持两种持久化后端：
1. **浏览器槽位**：三槽位落 `localStorage`，适合中小存档；
2. **本地文件直写**（v1.11.0）：用户通过 File System Access API 连接一个本地 `.json` 文件后，存档直写用户磁盘，**不受浏览器存储配额限制**，适合长时间运行后的大存档。

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
| 计数器 | `total_births` / `total_deaths` / `total_deaths_natural` / `total_deaths_unnatural` / `total_miscarriages` / `auction_started` / `auction_sold` / `auction_flopped` |
| 环境 | `season_timer` / `current_season` / `temperature` |
| **确定性核心** | `rng`（`WorldRng` 内部 `state: u64`） |
| 生态倍率 | `water/berry/wood/stone/gold_regen_multiplier` |
| 时钟 | `tick_counter` / `last_event` / `last_royal_payout_tick` |
| 配置 | `config`（`SimConfig` 全量，**读档沿用存档时的配置**） |
| 社会制度 | `marriage_registry` / `household_registry` / `clan_registry` / `region_registry` / `public_granary` |
| 冷却表 | `mutual_aid_cooldown` / `relief_cooldown`（均 BTreeMap 保序） |

每名 agent 的私有状态（`poi_seekability` 施密特触发器 / `family_stock_active` / `gold_mining_cooldown` / `miscarriage_cooldown_timer` / `postpartum_cooldown_timer` / `route` 等）随 `Agent3D` 整体序列化，**无需单独处理**。夺位远征目标（`expedition_target_camp` / `coronation_pending`）为瞬态不落档，读档后重置为空，下一决策相位重新评估（v1.9.0）。

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

### 4.2 UI 层 `save-ui.js`（~620 行）

- **三槽位**：自动槽（每 60 秒覆盖，世界未推进则跳过）/ 手动槽 1 / 手动槽 2。
- **存储键**：正文 `flowaccord.save.v1.<slotId>`，元信息统一放索引键 `flowaccord.save.v1.__index`（避免正文重复占用配额）。
- **元信息**：`tick` / 存活人口 / 存续家户数 / 保存时间 / 种子 / 体积 / `app_version`，仅在保存或导入时解析一次。
- **面板**：顶栏「💾 存档」「📂 读档」两个按钮打开同一面板，切换保存/读取标签；槽位卡片支持覆盖保存、读取、导出、删除（二次确认）；底部支持导入 `.json` 文件（校验 `format_version` 后直接载入）。
- **读档后自动暂停**并同步顶栏暂停按钮文案，便于核对世界状态。
- **Esc 关闭**走捕获阶段拦截，避免同时触发 Inspector 关闭逻辑。

#### 4.2.1 本地文件存档（v1.11.0，File System Access API）

- **连接**：`connectLocalFile()` 调 `showSaveFilePicker()` 让用户选择/新建一个 `.json` 文件，获得 `FileSystemFileHandle` 后存入 `localFileHandle`。
- **写入**：`saveToLocalFile()` 经 `handle.createWritable()` → `write(json)` → `close()` 直写磁盘，无需重复弹窗。
- **读取**：`loadFromLocalFile()` 从已连接文件读取；`loadFromLocalFilePicker()` 支持不先连接、直接 `showOpenFilePicker()` 打开任意存档文件。
- **自动保存切换**：已连接本地文件时，`tickAutoSave()` 每 60 秒直写本地文件而非 localStorage，彻底规避大存档的 `QuotaExceededError`。
- **兼容性降级**：`supportsLocalFileAPI()` 检测 `showSaveFilePicker`/`showOpenFilePicker`；不支持时（Firefox 等）隐藏连接按钮，读取标签下的「选择存档文件」降级到传统 `input[type=file]`，底部提示引导使用 Chrome/Edge。
- **权限失效**：写入/读取捕获 `NotAllowedError`，自动 `disconnectLocalFile()` 并提示重新连接。
- **句柄不持久化**：页面刷新后 `localFileHandle` 失效（浏览器安全策略），需用户重新连接。

#### 4.2.2 启动存档文件门禁（v1.27.0）

- **启动即暂停**：`main.js` 构造世界后立即置 `sim.isPaused = true`，页面叠加阻塞式启动层（`#startup-save-gate`），模拟画布不可操作。
- **必须先建档**：点击「建立存档文件」调用 `showSaveFilePicker()` 创建/连接 `.json` 文件，写入最小合法存档（`format_version` 匹配 `SAVE_FORMAT_VERSION`）后才解除门禁恢复模拟；成功连接旧档（元信息格式版本匹配）则直接放行。
- **取消/失败即阻断**：用户取消、权限拒绝、写入失败或格式版本不符时保持暂停，提示原因并允许重试——**绝不静默降级**到不落盘的运行态。
- **浏览器兼容**：仅支持 File System Access API（Chrome/Edge）；Firefox 等不兼容浏览器显示阻断提示，不提供 localStorage 降级启动，也不创建世界。
- **`app_version` 标记**：`world_save.rs` 的 `SAVE_APP_VERSION` 随版本发步更新（当前 **1.27.0**），仅供前端提示与人工排查，不作为加载门禁。

---

## 五、验证

`tools/test-wasm.js`（长期唯一自动化验证）：

| 用例 | 断言 |
| :--- | :--- |
| Test 3 存档读档确定性 | 同种子跑到存档点 → 存档 → 续演；对照组新建同种子世界跑到存档点 → 读档 → 续演同一步数，两组快照 JSON **逐字符串相等**；且读档后 `tick` 与存档时刻一致 |
| Test 4 版本门禁 | 篡改 `format_version` 后 `world_load` 返回 `-3`，且**当前世界快照不变**（失败不污染内存） |

当前实测：初始世界（60×60、20 名族人、无房屋）存档体积 **约 392 KB**；长时间运行后人口增长、账本流水累积，存档可达数 MB 甚至更大，可能超出 localStorage 5 MB 配额。**大存档请使用本地文件直写模式**（v1.11.0），存档直接写入用户磁盘，无配额限制。

---

## 六、易踩坑

1. **新增引擎字段必须同步 `WorldSave`**：`World3DEngine` 加字段后若忘记加进契约，读档会静默丢状态（编译器不会报错，因为 `deserialize_save` 是逐字段构造）。Test 3 的确定性对比能捕获大部分漏存，但不是全部——**加字段时同步改 `world_save.rs` 的三个位置**：结构体字段、`to_save()` 填充、`deserialize_save()` 构造。
2. **非有限浮点必须走 `finite_f32`**：任何可能为 `INFINITY`/`NaN` 的入库 f32 字段都要加 `#[serde(with = "finite_f32")]`，否则存得进、读不回。
3. **读档必须重建 `agent_index`**：遗漏会导致 `agent_by_id()` 返回错误下标或 panic。
4. **读档必须强制重建地形快照**：不同种子的档地形不同，`_terrainCached` 不清会沿用旧地形。
5. **`format_version` 与 `SAVE_FORMAT_VERSION` 必须同改**：Rust 常量在 `world_save.rs`，前端常量在 `save-ui.js`，二者一致才能正确提示版本不兼容。
6. **本地文件句柄不跨页面刷新持久化**（v1.11.0）：`FileSystemFileHandle` 仅在当前页面生命周期内有效，刷新后必须重新连接；不可假设句柄持久化，也不要尝试把句柄存入 localStorage（它不可序列化）。
7. **`showSaveFilePicker`/`showOpenFilePicker` 必须在用户手势中调用**：不能在 `setInterval` 或异步回调中间接触发，否则浏览器会报 `SecurityError`。`connectLocalFile()` 和 `loadFromLocalFilePicker()` 均由按钮点击直接触发。
8. **自动保存切换本地文件后不再写 localStorage**：已连接本地文件时 `tickAutoSave()` 直写磁盘，localStorage 自动槽不再更新——这是有意行为（避免双倍写入且大存档会撑爆 localStorage），断开连接后自动恢复 localStorage 模式。
