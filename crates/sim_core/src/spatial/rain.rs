//! Rust-owned precipitation contract.
//!
//! 粒子物理在 `world_tick` 中确定性推进（本文件 `tick_rain_particles`），状态经
//! 快照下发前端；Rust 拥有物理、确定性种子、快照类型与存档结构，导出给浏览器的
//! WGSL 只做渲染（投影 + 条带绘制），不再包含 compute 入口。
use serde::{Deserialize, Serialize};

pub const RAIN_GPU_WGSL: &str = include_str!("rain.wgsl");
/// 粒子数量上限的安全钳制上界（防止前端误填超大值撑爆内存）。
pub const RAIN_PARTICLE_MAX_LIMIT: usize = 20_000;
const RAIN_RNG_SALT: u64 = 0x5241_494E_5041_5254;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RainParticle {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub prev_x: f32,
    pub prev_y: f32,
    pub prev_z: f32,
    pub vx: f32,
    pub vy: f32,
    pub age: f32,
    pub max_age: f32,
    pub falling: bool,
}

/// ── 降水粒子物理常数（与旧 GPU compute shader 的取值为同一口径）──
/// 生成速率（个/秒，乘以降雨倍率）；已按需求在 1x 基准上提升 3 倍。
const RAIN_SPAWN_RATE_PER_S: f32 = 51.0;
const RAIN_GRAVITY: f32 = 72.0;
/// 生成高度：地表以上基准 + 随机附加（m）。
const RAIN_SPAWN_HEIGHT_BASE: f32 = 38.0;
const RAIN_SPAWN_HEIGHT_RAND: f32 = 28.0;
/// 生成初始水平速度幅度（m/s，取对称区间的一半）。
const RAIN_SPAWN_SPEED: f32 = 1.2;
/// 生命周期（秒）：基准 + 随机附加；已按需求延长到原时长的 8 倍。
const RAIN_MAX_AGE_BASE: f32 = 112.0;
const RAIN_MAX_AGE_RAND: f32 = 72.0;
/// 下落阶段的空气阻尼底数（按 dt*60 次方施加）与落地触发净空（m）。
const RAIN_FALL_DAMP: f32 = 0.995;
const RAIN_LAND_CLEARANCE: f32 = 0.22;
/// 落地后静置高度（m，贴地抬升）。
const RAIN_GROUND_REST_LIFT: f32 = 0.12;
const RAIN_FLOW_REST_LIFT: f32 = 0.10;
/// 落地后沿地形梯度的下坡加速度 (m/s²)。
const RAIN_FLOW_ACCEL: f32 = 21.0;
/// ★ 落地粒子间的引力与斥力（作用半径与力度系数）改由 SimConfig 注入，可在调试页实时调整：
///   斥力 `rain_repel_radius` / `rain_repel_strength`（近距推开，防重叠）；
///   引力 `rain_attract_radius` / `rain_attract_strength`（远距拉拢，凝聚成水体）。
/// 落地流动速度上限（m/s）与流动阻尼底数（按 dt 次方施加）。
const RAIN_FLOW_SPEED_MAX: f32 = 16.0;
const RAIN_FLOW_DAMP: f32 = 0.82;
/// 地形梯度采样步长的下限（m）。
const RAIN_GRADIENT_MIN_STEP: f32 = 0.35;

/// 确定性 LCG（与旧 GPU spawn shader 同口径）：返回 [0,1)。
#[inline]
fn rain_rand(state: &mut u64) -> f32 {
    *state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    ((*state as u32) as f32) / 4_294_967_296.0
}

impl crate::spatial::world::World3DEngine {
    /// Private deterministic seed for the spawn stream. It is kept separate
    /// from WorldRng so particle physics cannot perturb simulation order.
    pub(crate) fn rain_seed(seed: u64) -> u64 {
        seed ^ RAIN_RNG_SALT
    }

    /// 地形高程双线性采样（口径与旧 WGSL `terrainHeight` 一致）：世界坐标 →
    /// 归一化网格坐标 → 四邻插值。越界坐标被钳制到网格边缘。
    fn rain_ground_height(&self, wx: f32, wy: f32) -> f32 {
        let t = &self.terrain;
        let gw = t.grid_width.max(1);
        let gh = t.grid_height.max(1);
        let world = if t.world_size > 0.0 { t.world_size } else { 1.0 };
        let half = world * 0.5;
        let gx = ((wx + half) / world * (gw - 1) as f32).clamp(0.0, (gw - 1) as f32);
        let gy = ((wy + half) / world * (gh - 1) as f32).clamp(0.0, (gh - 1) as f32);
        let ix = gx.floor() as usize;
        let iy = gy.floor() as usize;
        let jx = (ix + 1).min(gw - 1);
        let jy = (iy + 1).min(gh - 1);
        let tx = gx - ix as f32;
        let ty = gy - iy as f32;
        let idx = |x: usize, y: usize| (y * gw + x).min(t.cells.len().saturating_sub(1));
        let a = t.cells[idx(ix, iy)].elevation * (1.0 - tx) + t.cells[idx(jx, iy)].elevation * tx;
        let b = t.cells[idx(ix, jy)].elevation * (1.0 - tx) + t.cells[idx(jx, jy)].elevation * tx;
        a * (1.0 - ty) + b * ty
    }

    /// 确定性降水粒子推进（tick 步骤 0，环境子阶段末尾调用）。
    ///
    /// 粒子状态完全由本函数按仿真 dt 推进，使用独立的 `rain_rng_state`
    /// （不消费 WorldRng），因此暂停即冻结、倍速即加速、同种子跨设备可复现，
    /// 并随 `WorldSave` 存档续演。旧实现把物理放在 WebGPU compute 里、按墙钟
    /// 每渲染帧推进，无法跟随 tick。
    pub fn tick_rain_particles(&mut self, dt: f32) {
        if !dt.is_finite() || dt <= 0.0 {
            return;
        }
        let world_size = self.terrain.world_size;
        if !world_size.is_finite() || world_size <= 0.0 {
            return;
        }

        // ── 读取本帧生效的粒子间力参数与数量上限（配置可经调试页热注入）──
        let max_particles = self.config.rain_particle_max.min(RAIN_PARTICLE_MAX_LIMIT);
        let repel_radius = self.config.rain_repel_radius.max(0.0);
        let repel_radius2 = repel_radius * repel_radius;
        let repel_strength = self.config.rain_repel_strength.max(0.0);
        let attract_radius = self.config.rain_attract_radius.max(0.0);
        let attract_radius2 = attract_radius * attract_radius;
        let attract_strength = self.config.rain_attract_strength.max(0.0);

        // ── 生成（降雨倍率 0 时不产出新粒子，但既有粒子继续流动/蒸发）──
        if self.rainfall_multiplier <= 0.0 {
            self.rain_spawn_carry = 0.0;
        } else {
            let rate = RAIN_SPAWN_RATE_PER_S * self.rainfall_multiplier.clamp(0.0, 5.0);
            self.rain_spawn_carry += dt * rate;
            let mut count = self.rain_spawn_carry.floor();
            self.rain_spawn_carry -= count;
            while count >= 1.0 && self.rain_particles.len() < max_particles {
                let x = (rain_rand(&mut self.rain_rng_state) * 2.0 - 1.0) * world_size * 0.5;
                let y = (rain_rand(&mut self.rain_rng_state) * 2.0 - 1.0) * world_size * 0.5;
                let ground = self.rain_ground_height(x, y);
                let z = ground + RAIN_SPAWN_HEIGHT_BASE
                    + rain_rand(&mut self.rain_rng_state) * RAIN_SPAWN_HEIGHT_RAND;
                let vx = (rain_rand(&mut self.rain_rng_state) - 0.5) * RAIN_SPAWN_SPEED;
                let vy = (rain_rand(&mut self.rain_rng_state) - 0.5) * RAIN_SPAWN_SPEED;
                let max_age =
                    RAIN_MAX_AGE_BASE + rain_rand(&mut self.rain_rng_state) * RAIN_MAX_AGE_RAND;
                self.rain_particles.push(RainParticle {
                    x,
                    y,
                    z,
                    prev_x: x,
                    prev_y: y,
                    prev_z: z,
                    vx,
                    vy,
                    age: 0.0,
                    max_age,
                    falling: true,
                });
                count -= 1.0;
            }
        }

        // ── 推进（以步进前的位形为确定性基准，避免相邻粒子互相依赖处理次序）──
        if self.rain_particles.is_empty() {
            return;
        }
        let old = self.rain_particles.clone();
        // 落地粒子索引表：斥力只在「已落地」粒子间结算，省去大量下落粒子的空配对。
        let ground_idx: Vec<usize> = (0..old.len()).filter(|&i| !old[i].falling).collect();
        let grad_step = (world_size / (self.terrain.grid_width.max(2) - 1) as f32)
            .max(RAIN_GRADIENT_MIN_STEP);

        let mut updated: Vec<RainParticle> = Vec::with_capacity(old.len());
        for i in 0..old.len() {
            let p = &old[i];
            let (mut px, mut py, mut pz) = (p.x, p.y, p.z);
            let (mut vx, mut vy) = (p.vx, p.vy);
            let mut falling = p.falling;
            let ground = self.rain_ground_height(px, py);

            if falling {
                let damp = RAIN_FALL_DAMP.powf(dt * 60.0);
                vx *= damp;
                vy *= damp;
                pz -= RAIN_GRAVITY * dt;
                px += vx * dt;
                py += vy * dt;
                if pz <= ground + RAIN_LAND_CLEARANCE {
                    pz = ground + RAIN_GROUND_REST_LIFT;
                    falling = false;
                    vx *= 0.35;
                    vy *= 0.35;
                }
            } else {
                let hx = (self.rain_ground_height(px + grad_step, py)
                    - self.rain_ground_height(px - grad_step, py))
                    / (2.0 * grad_step);
                let hy = (self.rain_ground_height(px, py + grad_step)
                    - self.rain_ground_height(px, py - grad_step))
                    / (2.0 * grad_step);
                vx -= hx * RAIN_FLOW_ACCEL * dt;
                vy -= hy * RAIN_FLOW_ACCEL * dt;
                for &j in &ground_idx {
                    if j == i {
                        continue;
                    }
                    let q = &old[j];
                    let dx = q.x - px;
                    let dy = q.y - py;
                    let d2 = dx * dx + dy * dy;
                    if d2 <= 0.0 {
                        continue;
                    }
                    let dlen = d2.sqrt();
                    // 斥力：近距相互推开，避免粒子重叠堆积。
                    if repel_radius2 > 0.0 && d2 < repel_radius2 {
                        let f = (repel_radius - dlen) * repel_strength / dlen;
                        vx -= dx * f;
                        vy -= dy * f;
                    }
                    // 引力：作用半径内相互拉拢，使零散水珠凝聚成连续水体。
                    if attract_radius2 > 0.0 && d2 < attract_radius2 {
                        let f = (attract_radius - dlen) * attract_strength / dlen;
                        vx += dx * f;
                        vy += dy * f;
                    }
                }
                let speed = (vx * vx + vy * vy).sqrt();
                if speed > RAIN_FLOW_SPEED_MAX {
                    vx *= RAIN_FLOW_SPEED_MAX / speed;
                    vy *= RAIN_FLOW_SPEED_MAX / speed;
                }
                let damp = RAIN_FLOW_DAMP.powf(dt);
                vx *= damp;
                vy *= damp;
                px += vx * dt;
                py += vy * dt;
                pz = self.rain_ground_height(px, py) + RAIN_FLOW_REST_LIFT;
            }

            let age = p.age + dt;
            // 出界即销毁：地图范围为 ±world_size/2，离开即移除（此前误用整幅 world_size 作阈值）。
            let half = world_size * 0.5;
            let alive = age <= p.max_age && px.abs() <= half && py.abs() <= half;
            if alive {
                updated.push(RainParticle {
                    x: px,
                    y: py,
                    z: pz,
                    prev_x: p.x,
                    prev_y: p.y,
                    prev_z: p.z,
                    vx,
                    vy,
                    age,
                    max_age: p.max_age,
                    falling,
                });
            }
        }
        self.rain_particles = updated;
    }
}
