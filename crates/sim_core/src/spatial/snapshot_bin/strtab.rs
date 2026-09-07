//! strtab.rs · 快照二进制帧的持久化字符串驻留表
//!
//! 快照中的**自由文本**（姓氏、地名、需求标签、死因、账本事件 note、流水主体 `LedgerRef`
//! 的 Debug 文本等）数量大且跨帧高度重复：稳态每帧约 350 处，若每帧逐条 UTF-8 解码，
//! 主线程将新增 0.3~1.5 ms 开销，反而抹平 M4 的收益。
//!
//! 解决方案：**append-only 驻留表**——每个不同字符串只分配一次稳定 id，
//! 帧内只传「新增条目」，前端按 id 永久缓存解码结果，重复字符串零解码。
//!
//! # 容量与重置
//! 动态文本（如含 id 的事件 note）会随时间增长，故设上限：
//! - 条目数 > `MAX_ENTRIES`(8192) 或总字节 > `MAX_BYTES`(256 KB) 时整体清空并 `epoch += 1`；
//! - 前端见 `epoch` 变化即清空本地缓存，保证 id 语义始终一致。
//!
//! # 跨世界缓存失效（★ T1 缺陷修复，v1.46.0）
//! 本表按世界持有，新世界 / 读档重建一律从 `epoch = 0`、`items` 为空起步。因此
//! 「换世界」不能靠 epoch 判定——否则 epoch 恒为 0，前端解码器会**继续复用上一个
//! 世界的驻留表缓存**，导致 id→字符串全部串味（实测表现为地名/姓氏显示成上个世界的
//! 「穆 / 朱」，`tools/test-wasm.js` 存读档确定性 `SAVE_LOAD_DETERMINISM_FAILED`）。
//! 前端改用 **STR_TAB 段的 `start_index == 0`** 作为「这是一张全新驻留表」的判据
//! （新世界首帧、以及容量超限 `reset()` 后首帧都必然为 0），见 `snapshot-bin.js`。
//!
//! # 确定性
//! 本表**只服务快照输出**，不参与任何内核状态演化、不消耗 `WorldRng`，
//! 因此不影响 `tools/test-determinism.js` 的逐字节一致性。

use std::collections::HashMap;

/// 条目数上限，超过即重置（配合 `epoch` 通知前端）
pub const MAX_ENTRIES: usize = 8192;
/// 累计字节上限，超过即重置
pub const MAX_BYTES: usize = 256 * 1024;

/// 持久化字符串驻留表（挂在 `World3DEngine` 上，`#[serde(skip)]` 不进存档）
pub struct StrTab {
    /// id → 字符串（下标即 id）
    items: Vec<String>,
    /// 字符串 → id（去重索引）
    index: HashMap<String, u32>,
    /// 累计字节数（用于容量判定）
    bytes: usize,
    /// 世代号：每次重置 +1，前端据此清缓存
    epoch: u32,
    /// 前端已同步到的游标（= 已下发的条目数）
    sent: u32,
}

impl Default for StrTab {
    fn default() -> Self {
        Self::new()
    }
}

impl StrTab {
    pub fn new() -> Self {
        Self {
            items: Vec::new(),
            index: HashMap::new(),
            bytes: 0,
            epoch: 0,
            sent: 0,
        }
    }

    /// 当前世代号（重置后递增）
    #[inline]
    pub fn epoch(&self) -> u32 {
        self.epoch
    }

    /// 前端已同步的游标（本次帧应从该下标开始下发增量）
    #[inline]
    pub fn sent_cursor(&self) -> u32 {
        self.sent
    }

    /// 标记已下发到 `cursor`（调用方在成功写入帧后调用）
    #[inline]
    pub fn mark_sent(&mut self, cursor: u32) {
        self.sent = cursor;
    }

    /// 驻留一个字符串，返回稳定 id。
    ///
    /// 容量超限时先整体重置（epoch+1），再插入——保证调用方拿到的 id 在本世代内有效。
    pub fn intern(&mut self, s: &str) -> u32 {
        if let Some(&id) = self.index.get(s) {
            return id;
        }
        if self.items.len() >= MAX_ENTRIES || self.bytes + s.len() > MAX_BYTES {
            self.reset();
        }
        let id = self.items.len() as u32;
        self.index.insert(s.to_string(), id);
        self.bytes += s.len();
        self.items.push(s.to_string());
        id
    }

    /// 驻留 `Option<String>`：`None` 返回 `NONE_U32`
    pub fn intern_opt(&mut self, s: &Option<String>) -> u32 {
        match s {
            Some(v) => self.intern(v.as_str()),
            None => super::layout::NONE_U32,
        }
    }

    /// 整体重置并递增世代号（读档 / 换世界 / 容量超限时调用）
    pub fn reset(&mut self) {
        self.items.clear();
        self.index.clear();
        self.bytes = 0;
        self.sent = 0;
        self.epoch = self.epoch.wrapping_add(1);
    }

    /// 取出 `[from, items.len())` 区间的增量条目，供本帧 STR_TAB section 下发
    #[inline]
    pub fn delta_since(&self, from: u32) -> &[String] {
        let start = (from as usize).min(self.items.len());
        &self.items[start..]
    }

    /// 当前条目总数
    #[inline]
    pub fn len(&self) -> usize {
        self.items.len()
    }
}
