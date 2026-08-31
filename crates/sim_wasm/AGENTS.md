# sim_wasm · WASM 桥接导出层 (AGENTS.md)

> 本文件是 `crates/sim_wasm/` 目录的局部操作指南，供智能体/开发者改此目录代码前阅读。
> 全局规则以根目录 `AGENTS.md` 为准，本文件只收录本目录的职责边界与局部易踩坑。

---

## 1. 📂 目录职责

将 `sim_core` 编译为 **`wasm32-unknown-unknown` 的零依赖桥接模块**：前端通过 `WebAssembly.instantiate` 加载 `.wasm` 后，直接调用 `extern "C"` 导出函数推进确定性仿真，并从 wasm 线性内存读取 JSON 快照。**不依赖 wasm-bindgen**，全部导出 AOT 可解析。

## 2. 📁 文件清单

| 文件 | 职责 |
| :--- | :--- |
| `Cargo.toml` | `crate-type = ["cdylib"]`（wasm 二进制），依赖 `sim_core` + `serde_json` |
| `src/lib.rs` | 全部导出函数与 3 个静态缓冲区（`WORLD`/`SNAPSHOT_BUF`/`CONFIG_BUF`） |

## 3. 🧭 导出函数清单（前端 rustworld.js 一一对应）

| 导出 | 签名 | 作用与返回值 |
| :--- | :--- | :--- |
| `world_create` | `(grid_res: u32, world_size: f32, seed: f64, agent_count: u32) -> i32` | 建世界 + `seed_primitive_ecology`；seed 保证可复现 |
| `world_config_buf_ptr` | `(len: u32) -> u32` | 准备 Config JSON 内部缓冲区，返回起始指针 |
| `world_apply_config_buf` | `(len: u32) -> i32` | 解析并应用缓冲区 JSON；0 成功，-1 长度越界，-2 JSON 解析失败，-3 UTF-8 非法，-4 世界未创建 |
| `world_set_config` | `(ptr: u32, len: u32) -> i32` | 直接从线性内存指针应用 Config JSON；返回码同上 |
| `world_tick` | `(dt: f32)` | 推进一个确定性仿真步 |
| `world_tick_steps` | `(steps: u32, dt: f32)` | 推进 N 步（对应前端 speedMult）；内部循环调 `world_tick` |
| `world_set_regen_multiplier` | `(which: i32, mult: f32)` | 设置某类 POI 再生倍率（0=水 1=果 2=木 3=石 4=金） |
| `world_snapshot_ptr` | `() -> u32` | 序列化当前快照到 `SNAPSHOT_BUF`，返回起始指针（配合 `world_snapshot_len` 读取） |
| `world_snapshot_len` | `() -> u32` | 快照 JSON 字节长度 |

## 4. ⚠️ 本目录易踩坑

- **静态可变缓冲区是 unsafe 根源**：`WORLD`/`SNAPSHOT_BUF`/`CONFIG_BUF` 为 `static mut`，编译期会产生 `static_mut_refs` 警告（既有、可接受）；**新增任何共享状态仍须走静态缓冲区 + 指针传递**，禁止引入运行时全局锁或线程（wasm32 单线程）。
- **指针约定**：所有跨边界数据（Config 输入、快照输出）都是"先调 `*_ptr`/`*_buf_ptr` 拿指针 + 对应 len"，前端用 `Uint8Array` 拷贝；**不要在 wasm 内存外返回指针**，也不要假设缓冲区在多次调用间保留（`world_snapshot_ptr` 每次调用重新序列化；⚠️序列化失败时 `SNAPSHOT_BUF` 保持旧内容、指针仍指向旧数据，前端须先读 `world_snapshot_len` 再按长度取 `world_snapshot_ptr`）。
- **错误码语义**：`world_apply_config_buf` 与 `world_set_config` 的返回码（0/-1/-2/-3/-4）已被前端 `rustworld.js` 依赖，**新增失败分支只能向后追加新负数**，不得改动既有语义。
- **`dt` 语义**：`world_tick` 接收 dt 秒；前端固定 1/30，倍速用 `world_tick_steps`，**严禁改动内核 dt=1/30**（见根 AGENTS.md §4.3）。
- **确定性**：`world_create` 的 seed 是复现入口；`tools/test-wasm.js` 的同种子逐字节校验覆盖本层，改动导出或序列化格式前先跑回归。
- **改本目录代码后必须重编并同步双副本**（根 AGENTS.md §4.1）：
  `cargo build -p sim_wasm --target wasm32-unknown-unknown --release` 后复制到 `frontend/rust/sim_wasm.wasm` 与 `frontend/sim_wasm.wasm`；**不要用字节数判断是否更新**，以 `node tools/test-wasm.js` 输出为准。
