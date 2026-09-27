//! Rust-owned precipitation contract.
//!
//! ★ v1.64.0：粒子物理（生成 / 下落 / 下坡流动 / 邻域力 / 蒸发）已**迁出内核**，
//! 改由 WebGPU compute 在 GPU 上以 3D 固定网格空间哈希推进（见 `rain_*.wgsl`）；
//! 粒子状态为**纯表现层**，不再进快照与存档（`RAIN_PARTICLES` section 保留为惰性空段）。
//!
//! 本文件只保留三件事：
//! 1. WGSL 源码导出（compute + render 单模块，经 `world_rain_gpu_shader_ptr/len` 下发）；
//! 2. 交互力零点求解 `rain_force_roots`（唯一权威，GPU 端不再做三次求根）；
//! 3. 仿真配置 → GPU 参数契约 `RainGpuUniforms`（`World3DEngine::rain_gpu_uniforms`），
//!    使 `rain_attract_strength` / `rain_repel_strength` / `rain_force_scale` /
//!    `rain_particle_max` 仍由内核校验下发，物理常数保持单一真相源。
use serde::{Deserialize, Serialize};

pub const RAIN_GPU_WGSL: &str = concat!(
    include_str!("rain_common.wgsl"),
    include_str!("rain_compute.wgsl"),
    include_str!("rain_render.wgsl"),
);
/// 粒子数量上限的安全钳制上界（防止前端误填超大值撑爆 GPU 缓冲）。
pub const RAIN_PARTICLE_MAX_LIMIT: usize = 65_536;

/// ── 降水粒子物理常数（GPU compute 的唯一取值来源，随 uniform 下发前端）──
/// 生成速率（个/秒，乘以降雨倍率）。
const RAIN_SPAWN_RATE_PER_S: f32 = 51.0;
const RAIN_GRAVITY: f32 = 72.0;
/// 生成高度：地表以上基准 + 随机附加（m）。
const RAIN_SPAWN_HEIGHT_BASE: f32 = 38.0;
const RAIN_SPAWN_HEIGHT_RAND: f32 = 28.0;
/// 生成初始水平速度幅度（m/s，取对称区间的一半）。
const RAIN_SPAWN_SPEED: f32 = 1.2;
/// 生命周期（秒）：基准 + 随机附加。当前基准 0、随机附加 256 ⇒ 均匀落在 [0, 256)。
const RAIN_MAX_AGE_BASE: f32 = 0.0;
const RAIN_MAX_AGE_RAND: f32 = 256.0;
/// 下落阶段的空气阻尼底数（按 dt*60 次方施加）与落地触发净空（m）。
const RAIN_FALL_DAMP: f32 = 0.995;
const RAIN_LAND_CLEARANCE: f32 = 0.22;
/// 落地后静置高度（m，贴地抬升）。
const RAIN_GROUND_REST_LIFT: f32 = 0.12;
const RAIN_FLOW_REST_LIFT: f32 = 0.10;
/// 落地后沿地形梯度的下坡加速度 (m/s²)。
const RAIN_FLOW_ACCEL: f32 = 21.0;
/// 落地流动速度上限（m/s）与流动阻尼底数（按 dt 次方施加）。
const RAIN_FLOW_SPEED_MAX: f32 = 16.0;
const RAIN_FLOW_DAMP: f32 = 0.82;
/// 地形梯度采样步长的下限（m）。
const RAIN_GRADIENT_MIN_STEP: f32 = 0.35;

/// 下发给 GPU 的降水参数契约（序列化为 JSON，经 `world_rain_uniforms_ptr/len` 送到前端）。
///
/// 交互力 `f(d) = attract − √d − repel / d`：仅当 `force_valid == 1`（恰有两个正零点）时有效，
/// 交互范围为 `d < reach_far`，以 `reach_far` 为终止界限。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RainGpuUniforms {
    pub attract: f32,
    pub repel: f32,
    pub force_scale: f32,
    pub max_particles: u32,
    /// 1 = f(d) 恰有两个正零点（交互力有效）；0 = 无效（不施力）。
    pub force_valid: u32,
    /// 交互近界限（米，f(d) 的较近正零点）。
    pub reach_near: f32,
    /// 交互终止界限（米，f(d) 的较远正零点）。
    pub reach_far: f32,
    /// 生成速率（个/秒，乘以降雨倍率）。
    pub spawn_rate_per_s: f32,
    pub gravity: f32,
    pub spawn_height_base: f32,
    pub spawn_height_rand: f32,
    pub spawn_speed: f32,
    pub max_age_base: f32,
    pub max_age_rand: f32,
    pub fall_damp: f32,
    pub land_clearance: f32,
    pub ground_rest_lift: f32,
    pub flow_rest_lift: f32,
    pub flow_accel: f32,
    pub flow_speed_max: f32,
    pub flow_damp: f32,
    pub gradient_min_step: f32,
}

/// 二分求 `g(u) = u³ − A·u² + R` 在区间 [lo, hi] 内的唯一零点
/// （f64，固定 60 次迭代 → 确定性；靠 `g(lo)` 的符号自适应，不假设哪端为正）。
#[inline]
fn rain_bisect(a: f64, r: f64, lo0: f64, hi0: f64) -> f64 {
    let g = |u: f64| u * u * u - a * u * u + r;
    let lo_pos = g(lo0) > 0.0;
    let (mut lo, mut hi) = (lo0, hi0);
    for _ in 0..60 {
        let mid = 0.5 * (lo + hi);
        if (g(mid) > 0.0) == lo_pos {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}

/// 求交互函数 `f(d) = A − √d − R/d` 的两个正零点对应的**距离**（d = u²，令 u = √d）。
///
/// 令 u = √d：f=0 ⇔ `u³ − A·u² + R = 0`。该三次函数 h(0)=R>0、唯一极小在 u* = 2A/3、
/// h(u*) = R − 4A³/27。故**恰有两个正根** ⇔ `R < 4A³/27`（A、R 均 > 0）。
/// 返回 `(near, far)`（距离，米；near < far）；不满足两个正根时返回 `None`（该参数下不施加作用力）。
pub fn rain_force_roots(a: f32, r: f32) -> Option<(f32, f32)> {
    if !a.is_finite() || !r.is_finite() || a <= 0.0 || r <= 0.0 {
        return None;
    }
    let (a, r) = (a as f64, r as f64);
    let u_star = 2.0 * a / 3.0;
    let h_min = r - 4.0 * a * a * a / 27.0;
    if h_min >= 0.0 {
        return None; // 无两个正根（含相切单根）
    }
    // h(0)=R>0、h(u*)<0 ⇒ 小根在 (0, u*)；h(2A)=4A³+R>0 ⇒ 大根在 (u*, 2A)。
    let u1 = rain_bisect(a, r, 0.0, u_star);
    let u2 = rain_bisect(a, r, u_star, 2.0 * a);
    Some(((u1 * u1) as f32, (u2 * u2) as f32))
}

impl crate::spatial::world::World3DEngine {
    /// 生成当前配置下的 GPU 降水参数（唯一读取 `rain_*` 配置与物理常数的出口）。
    pub fn rain_gpu_uniforms(&self) -> RainGpuUniforms {
        let attract = self.config.rain_attract_strength;
        let repel = self.config.rain_repel_strength;
        let force_scale = if self.config.rain_force_scale.is_finite() {
            self.config.rain_force_scale.max(0.0)
        } else {
            1.0
        };
        let max_particles = self.config.rain_particle_max.min(RAIN_PARTICLE_MAX_LIMIT) as u32;
        let (force_valid, reach_near, reach_far) = match rain_force_roots(attract, repel) {
            Some((near, far)) => (1u32, near, far),
            None => (0u32, 0.0, 0.0),
        };
        RainGpuUniforms {
            attract,
            repel,
            force_scale,
            max_particles,
            force_valid,
            reach_near,
            reach_far,
            spawn_rate_per_s: RAIN_SPAWN_RATE_PER_S,
            gravity: RAIN_GRAVITY,
            spawn_height_base: RAIN_SPAWN_HEIGHT_BASE,
            spawn_height_rand: RAIN_SPAWN_HEIGHT_RAND,
            spawn_speed: RAIN_SPAWN_SPEED,
            max_age_base: RAIN_MAX_AGE_BASE,
            max_age_rand: RAIN_MAX_AGE_RAND,
            fall_damp: RAIN_FALL_DAMP,
            land_clearance: RAIN_LAND_CLEARANCE,
            ground_rest_lift: RAIN_GROUND_REST_LIFT,
            flow_rest_lift: RAIN_FLOW_REST_LIFT,
            flow_accel: RAIN_FLOW_ACCEL,
            flow_speed_max: RAIN_FLOW_SPEED_MAX,
            flow_damp: RAIN_FLOW_DAMP,
            gradient_min_step: RAIN_GRADIENT_MIN_STEP,
        }
    }
}