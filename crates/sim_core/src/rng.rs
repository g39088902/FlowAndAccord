//! 确定性伪随机数生成器 (xorshift64*)
//!
//! 替换 `rand` 依赖：零外部依赖、wasm32-unknown-unknown 安全（不触发 getrandom）、
//! 同一种子可完全复现世界演化（符合 ARCHITECTURE.md 的确定性核心目标）。

use serde::{Deserialize, Serialize};

/// xorshift64* 确定性 PRNG
///
/// ★ 存档系统：整个世界的随机演化完全由 `state` 这一个 u64 决定，
/// 读档必须原样恢复该内部状态，否则后续所有随机数漂移、确定性校验失败。
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
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

    /// 标准正态分布随机数 (Box-Muller 变换，均值 0、标准差 1)，每次消耗 2 个均匀随机数
    ///
    /// 用于生成族人的先天禀赋属性: 属性值 = 100 + 20 * gen_normal() 即 N(100, 20)，
    /// 保证约 95% 族人落在 60 ~ 140 区间 (均值 100 ± 1.96×20)。
    pub fn gen_normal(&mut self) -> f32 {
        let u1 = self.gen_f32().max(1e-7); // 避免 ln(0) 产生 -inf
        let u2 = self.gen_f32();
        (-2.0 * u1.ln()).sqrt() * (std::f32::consts::TAU * u2).cos()
    }
}
