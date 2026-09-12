# sim_wasm · WASM 桥接导出层 (AGENTS.md)

> 本目录局部操作指南。全局规则以根目录 `AGENTS.md` 为准，本文件只收录本目录的职责边界、导出函数清单与局部易踩坑。

---

## 0. Agent 交互契约

- 输入：前端传入的 Config JSON、seed 和 tick 参数；输出：错误码、WASM 线性内存中的快照/版本数据。
- 指针协议固定为 `ptr → len → Uint8Array 拷贝`；不得返回 wasm 内存外指针或改变既有错误码语义。
- 快照只有 FABS 二进制一条通道（JSON 通道已于 v1.50.33 移除）；导出变更必须同步 `rustworld.js`、Worker 与工具调用方。
- 修改本层后必须重编译并同步 `frontend/rust/sim_wasm.wasm` 与 `frontend/sim_wasm.wasm`，再运行 `node tools/test-wasm.js`。

## 1. 📂 目录职责

将 `sim_core` 编译为 **`wasm32-unknown-unknown` 的零依赖桥接模块**：前端通过 `WebAssembly.instantiate` 加载 `.wasm` 后，直接调用 `extern "C"` 导出函数推进确定性仿真，并从 wasm 线性内存读取 **FABS 二进制快照**（JSON 快照通道已于 v1.50.33 彻底移除）。**不依赖 wasm-bindgen**，全部导出 AOT 可解析。

## 2. 📁 文件清单

| 文件 | 职责 |
| :--- | :--- |
| `Cargo.toml` | `crate-type = ["cdylib"]`（wasm 二进制），依赖 `sim_core` + `serde_json` |
| `src/lib.rs` | 全部导出函数与 5 个静态缓冲区（`WORLD`/`SNAPSHOT_BIN_BUF`(★ M4 FABS)/`ENUM_TABLE_BUF`(M4)/`CONFIG_BUF`/`SAVE_BUF`/`ERROR_BUF`） |

## 3. 🧭 导出函数清单

前端 `rustworld.js` 一一对应调用：

| 导出 | 签名 | 作用 |
| :--- | :--- | :--- |
| `world_create` | `(grid_res: u32, world_size: f32, seed: f64, agent_count: u32, camp_count: u32) -> i32` | 建世界 + 播撒生态；seed 保证可复现；camp_count 在播种前注入（否则前端 countCamps 不生效，见根 AGENTS.md §4.7）。**★ v1.50.19：`grid_res` 传 0 = 按 `SimConfig::terrain_grid_res`（分辨率单一真相源），非 0 值仅测试参数化使用** |
| `world_create_map` | `(grid_res: u32, world_size: f32, seed: f64) -> i32` | 仅建正式同源 TerrainMap，不播撒生态、Agent、房屋或路网；仅供地图图鉴的只读预览。`grid_res` 语义同 `world_create` |
| `world_config_buf_ptr` | `(len: u32) -> u32` | 准备 Config JSON 内部缓冲区，返回起始指针 |
| `world_apply_config_buf` | `(len: u32) -> i32` | 解析并应用缓冲区 JSON；0 成功，-1 长度越界，-2 JSON 解析失败，-3 UTF-8 非法，-4 世界未创建 |
| `world_tick` | `(dt: f32)` | 推进一个确定性仿真步 |
| `world_tick_steps` | `(steps: u32, dt: f32)` | 推进 N 步（对应前端 speedMult）；内部循环调 `world_tick` |
| `world_set_regen_multiplier` | `(which: i32, mult: f32)` | 设置某类 POI 再生倍率（0=水 1=果 2=木 3=石 4=金） |
| `world_snapshot_bin_ptr` | `() -> u32` | ★ M4 编码 FABS 二进制帧到 `SNAPSHOT_BIN_BUF`，返回起始指针（含增量判定：地形/路网几何仅在脏位/签名变化时输出） |
| `world_snapshot_bin_len` | `() -> u32` | ★ M4 二进制帧字节长度 |
| `world_enum_table_ptr` | `() -> u32` | ★ M4 枚举名称表 JSON 起始指针（懒生成缓存；前端 INIT 取一次，杜绝前后端枚举漂移） |
| `world_enum_table_len` | `() -> u32` | ★ M4 枚举名称表 JSON 字节长度 |
| `world_app_version_ptr` | `() -> u32` | 内核应用版本号字符串指针（UTF-8，见 SAVE_APP_VERSION） |
| `world_app_version_len` | `() -> u32` | 内核应用版本号字符串字节长度 |

## 4. ⚠️ 本目录易踩坑

- **静态可变缓冲区是 unsafe 根源**：`WORLD`/`SNAPSHOT_BIN_BUF`/`CONFIG_BUF` 等为 `static mut`，编译期产生 `static_mut_refs` 警告（既有、可接受）。新增共享状态仍须走静态缓冲区 + 指针传递，**禁止**引入运行时全局锁或线程（wasm32 单线程）。
- **★ `terrain_dirty` 脏位消费即清零**：地形 section 只在脏位为 true 时输出（`Cell<bool>`，被取帧后清零）。`world_require_terrain()` 现调用 `World3DEngine::require_full_geometry()`，同时复位地形脏位与路网几何签名（`last_geom_sig`），保证二进制下帧重发 `LANE_GEO`/`NODE`。
- **指针约定**：所有跨边界数据都是"先调 `*_ptr`/`*_buf_ptr` 拿指针 + 对应 len"，前端用 `Uint8Array` 拷贝。**不要在 wasm 内存外返回指针**。
- **★ v1.50.33 JSON 快照通道彻底移除**：T1（v1.46.0）时 JSON 曾收敛为 test-only 真值源（`world_snapshot_json_debug_ptr/len`）供 `test-snapshot-bin.js` 对拍；现该导出、`SNAPSHOT_JSON_DEBUG_BUF` 与门禁脚本 `tools/test-snapshot-bin.js` 均已删除，快照仅剩 FABS 一条通道，tools/ 统一走 `tools/snapshot-reader.js`。
- **错误码语义**：`world_apply_config_buf` 的返回码（0/-1/-2/-3/-4）已被前端依赖，**新增失败分支只能向后追加新负数**，不得改动既有语义。
  （原 `world_set_config(ptr,len)` 与 `world_apply_config_buf` 功能完全重复且全项目零调用，已于 v1.50.18 删除；配置注入现只有 `world_config_buf_ptr` + `world_apply_config_buf` 一条路径。）
- **`dt` 语义**：`world_tick` 接收 dt；前端固定 1/60，倍速用 `world_tick_steps`，**严禁改动内核 dt=1/60**（根 AGENTS.md §4.3）。
- **确定性**：`world_create` 的 seed 是复现入口；`tools/test-wasm.js` 的同种子逐字节校验覆盖本层，改动导出或序列化格式前先跑回归。
- **改本目录代码后必须重编并同步双副本**（根 AGENTS.md §4.1），不要用字节数判断是否更新，以 `test-wasm.js` 输出为准。
