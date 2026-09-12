//! snapshot_bin · M4 快照零拷贝扁平二进制缓冲（FABS 帧）
//!
//! 隶属「性能优化规划书」里程碑 M4（`docs/plan/tech/08-performance.md`）。
//!
//! # 为什么需要它
//! 实测（v1.44.10，`node tools/profile-benchmark.js`）单次快照代价 **3,973 µs**：
//! - Rust `serde_json::to_string` 2,175 µs
//! - JS `JSON.parse` 1,798 µs
//! 等价于连续推进 **288 个纯内核 Tick**。稳态快照 333 KB 中 `lanes` 独占 76%。
//!
//! # 三层对策
//! 1. **静态/动态分层**：路网几何（`LANE_GEO`/`NODE`）与地形（`TERRAIN`）按版本号增量下发，
//!    每帧只传 `LANE_WEAR`（812×f32 ≈ 3.2 KB）；
//! 2. **扁平二进制**：全部实体顺序流编码，前端 `DataView` 单趟前向读取；
//! 3. **字符串驻留**：自由文本走 append-only 驻留表，跨帧稳定 id，前端永久缓存解码结果。
//!
//! # 子模块
//! | 文件 | 职责 |
//! | :--- | :--- |
//! | `layout.rs` | 格式常量、Section 种类、小端写入器 `BinWriter` |
//! | `dict.rs` | 枚举「码位 ↔ 名称」字典与 `enum_table_json()` |
//! | `strtab.rs` | 持久化字符串驻留表 `StrTab` |
//! | `encode.rs` | `World3DEngine::write_snapshot_binary()` 帧编码 |
//!
//! # ⚠️ 四处同步铁律（新增/修改快照字段必读）
//! 1. `snapshot.rs` — JSON 快照结构体定义
//! 2. `world_snapshot.rs` — JSON 快照赋值
//! 3. `snapshot_bin/encode.rs` — **本模块**二进制编码
//! 4. `frontend/js/snapshot-bin.js` — 二进制解码
//!
//! 漏改任何一处都会让前端读到 `undefined` 或旧值；
//! `tools/test-wasm.js` 的「二进制 ≡ JSON 深比较」断言是唯一的自动保障网。
//!
//! # 确定性
//! 本模块全程只读内核状态，**不消耗 `WorldRng`、不参与任何演化计算**，
//! 因此 M4 的确定性风险为 0（快照层完全只读）。

pub mod dict;
pub mod encode;
pub mod layout;
pub mod strtab;

pub use dict::enum_table_json;
pub use layout::{BinWriter, SectionKind, FORMAT_VERSION, HEADER_LEN, MAGIC};
pub use strtab::StrTab;
