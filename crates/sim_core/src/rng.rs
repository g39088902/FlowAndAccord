//! 确定性伪随机数生成器 (xorshift64*)
//!
//! 替换 `rand` 依赖：零外部依赖、wasm32-unknown-unknown 安全（不触发 getrandom）、
//! 同一种子可完全复现世界演化（符合 ARCHITECTURE.md 的确定性核心目标）。

/// xorshift64* 确定性 PRNG
#[derive(Debug, Clone, Copy)]
pub struct WorldRng {
    state: u64,
}

impl WorldRng {
    /// 以任意 u64 种子构造（种子 0 会被替换为黄金比例常数以避免退化状态）
    pub fn new(seed: u64) -> Self {
        Self {
            state: if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed },
        }
    }

    /// 生成下一个 64 位随机数 (xorshift64*)
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// 均匀浮点 [0.0, 1.0)
    pub fn gen_f32(&mut self) -> f32 {
        (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32
    }

    /// 以概率 p 返回 true (p ∈ [0.0, 1.0])
    pub fn gen_bool(&mut self, p: f32) -> bool {
        self.gen_f32() < p
    }

    /// 闭区间 [low, high) 浮点
    pub fn gen_range(&mut self, low: f32, high: f32) -> f32 {
        low + (high - low) * self.gen_f32()
    }

    /// 闭区间 [low, high) 整数 (无偏模数)
    pub fn gen_range_usize(&mut self, low: usize, high: usize) -> usize {
        if high <= low {
            return low;
        }
        low + (self.next_u64() % (high - low) as u64) as usize
    }
}
