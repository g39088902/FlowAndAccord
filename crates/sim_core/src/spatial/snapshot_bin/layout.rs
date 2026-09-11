//! layout.rs · FABS 二进制快照帧的格式常量与写入器
//!
//! 隶属「性能优化规划书」里程碑 M4（`docs/16-plan-performance-optimization.md`）。
//! 本文件**只定义格式，不含任何业务字段编码**（业务编码见 `encode.rs`）。
//!
//! # 帧总体结构（小端）
//! ```text
//! [ Header 32B ][ SectionDir 16B × N ][ Section 0 ][ Section 1 ] ... [ Section N-1 ]
//! ```
//! - Header 定长 32 字节，含魔数、格式版本、帧旗标、帧长、tick、几何版本、字符串表世代号。
//! - SectionDir 每项 16 字节：`(kind u16, _pad u16, offset u32, count u32, byte_len u32)`。
//!   未知 kind 可被安全跳过（因为记录了 byte_len）——保证前向兼容。
//! - 各 Section 内部为**顺序流**（非定长 stride）：定长字段后紧跟变长列表与字符串 id。
//!   解码端单趟前向读取即可，无需随机访问。
//!
//! # ⚠️ 四处同步铁律
//! 修改任何字段编码必须同步四处，否则前端读到 `undefined` 或类型错误：
//! 1. `snapshot.rs`（JSON 快照结构体定义）
//! 2. `world_snapshot.rs`（JSON 快照赋值）
//! 3. `snapshot_bin/encode.rs`（**本模块**二进制编码）
//! 4. `frontend/js/snapshot-bin.js`（二进制解码）
//!
//! `tools/test-wasm.js` 的「二进制 ≡ JSON 深比较」断言是这四处同步的唯一自动保障网。

/// 帧魔数 `"FABS"`（Flow & Accord Binary Snapshot），小端存储为 `46 41 42 53`
pub const MAGIC: [u8; 4] = *b"FABS";

/// 帧格式版本。**结构性**变更（增删 section 或改字段编码）时必须 +1；
/// 前端 `snapshot-bin.js` 校验不匹配即回退 JSON 通道。
pub const FORMAT_VERSION: u16 = 2;

/// Header 定长（字节）
///
/// 布局（小端）：
/// ```text
///  0  magic         u32   "FABS"
///  4  version       u16
///  6  flags         u16
///  8  frame_len     u32   整帧字节数（含 Header 与 SectionDir）
/// 12  tick          u64
/// 20  geom_sig      u64   路网拓扑签名 = (node_count << 32) | lane_count
/// 28  strtab_epoch  u32
/// 32  section_count u16
/// 34  reserved      u16
/// 36  reserved2     u32
/// ```
pub const HEADER_LEN: usize = 40;
/// SectionDir 单项定长（字节）
pub const DIR_ENTRY_LEN: usize = 16;

/// 帧旗标：指示本帧包含哪些「可选 / 增量」section
pub mod flag {
    /// 含 TERRAIN（地形脏帧才输出）
    pub const HAS_TERRAIN: u16 = 1 << 0;
    /// 含 LANE_GEO + NODE（路网拓扑变化才输出）
    pub const HAS_LANE_GEO: u16 = 1 << 1;
    /// 含 STR_TAB 增量字符串条目
    pub const HAS_STR_TAB: u16 = 1 << 2;
}

/// Section 种类。值一旦发布**不得复用**（只能追加），保证旧前端能跳过未知 section。
#[repr(u16)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SectionKind {
    Global = 1,
    Agent = 2,
    Poi = 3,
    House = 4,
    LaneGeo = 5,
    LaneWear = 6,
    Node = 7,
    Terrain = 8,
    Household = 9,
    Marriage = 10,
    Clan = 11,
    Region = 12,
    Empire = 13,
    Granary = 14,
    Death = 15,
    AuctionHist = 16,
    StrTab = 17,
    TerrainFeatures = 18,
    /// ★ v1.48.0 D-A：地表装饰（id u32 + kind u8 + x f32 + y f32 + z f32
    ///   + scale f32 + rotation f32 + tint u8 + align4，约 24B/个，脏帧输出）
    TerrainAccents = 21,
}

impl SectionKind {
    pub const fn raw(self) -> u16 {
        self as u16
    }
}

/// `Option<u32>` 的空值哨兵（真实 id 远小于此）
pub const NONE_U32: u32 = 0xFFFF_FFFF;
/// `Option<u64>` 的空值哨兵
pub const NONE_U64: u64 = u64::MAX;
/// `Option<f32>` 的空值哨兵（IEEE-754 NaN；内核不会产出 NaN，见 `test-wasm.js` 防 NaN 门禁）
pub const NONE_F32: f32 = f32::NAN;

/// 顺序流二进制写入器（小端，零依赖手写，不引入 bincode 等新 crate）
pub struct BinWriter {
    buf: Vec<u8>,
}

impl BinWriter {
    pub fn with_capacity(cap: usize) -> Self {
        Self {
            buf: Vec::with_capacity(cap),
        }
    }

    pub fn into_inner(self) -> Vec<u8> {
        self.buf
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.buf.len()
    }

    #[inline]
    pub fn u8(&mut self, v: u8) {
        self.buf.push(v);
    }

    #[inline]
    pub fn u16(&mut self, v: u16) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    #[inline]
    pub fn u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    #[inline]
    pub fn u64(&mut self, v: u64) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    #[inline]
    pub fn f32(&mut self, v: f32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }

    #[inline]
    pub fn bytes(&mut self, v: &[u8]) {
        self.buf.extend_from_slice(v);
    }

    /// `Option<u32>`：`NONE_U32` 表示 None
    #[inline]
    pub fn opt_u32(&mut self, v: Option<u32>) {
        self.u32(v.unwrap_or(NONE_U32));
    }

    /// `Option<u64>`：`NONE_U64` 表示 None
    #[inline]
    pub fn opt_u64(&mut self, v: Option<u64>) {
        self.u64(v.unwrap_or(NONE_U64));
    }

    /// `Option<f32>`：`NONE_F32`（NaN）表示 None
    #[inline]
    pub fn opt_f32(&mut self, v: Option<f32>) {
        self.f32(v.unwrap_or(NONE_F32));
    }

    /// 变长 id 列表：先写 `u16` 数量再写元素（列表长度上限 65535，远超业务实际）
    #[inline]
    pub fn u32_list(&mut self, items: &[u32]) {
        self.u16(items.len() as u16);
        for &v in items {
            self.u32(v);
        }
    }

    /// 变长 u64 列表
    #[inline]
    pub fn u64_list(&mut self, items: &[u64]) {
        self.u16(items.len() as u16);
        for &v in items {
            self.u64(v);
        }
    }

    /// 4 字节对齐填充（保证后续 section 可用对齐读取）
    #[inline]
    pub fn align4(&mut self) {
        while self.buf.len() % 4 != 0 {
            self.buf.push(0);
        }
    }
}
