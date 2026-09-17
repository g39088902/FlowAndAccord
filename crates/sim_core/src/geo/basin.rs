//! basin.rs · 盆地静态几何与高程规划。
//!
//! 负责独立静态模板 `basin_oasis_v1` 的物理高程骨架：
//! 1. 广袤平坦盆底生活带：中心平缓开阔，提供大面积无障碍平地（q <= 0.82）；
//! 2. 环抱雄峻高山 (0.82 < q <= 1.05)：自盆底向外陡峭攀升至 +rim_height_m（42m），
//!    峰值坡度稳定在 38°~45°，自然派生 RockFace 与 NO_WALK 连续高山硬屏障；
//! 3. 陆路出口走廊：出口方向角向窗口内山壁梯度阻尼，保持平缓垭口（< 19°）连通外缘；
//! 4. 外围崇山峻岭 (q > 1.05)：维持高山基底与连绵峰峦。

use crate::config::SimConfig;
use crate::rng::WorldRng;

/// 盆地静态几何（创世 scratch 专用，不进快照/存档）。
#[derive(Debug, Clone)]
pub struct BasinGeometry {
    /// 盆心世界坐标
    pub center_x: f32,
    pub center_y: f32,
    /// 局部旋转角（弧度）与三角常数
    pub rotation_rad: f32,
    pub cos_rot: f32,
    pub sin_rot: f32,
    /// 盆地半轴（米）：a 沿局部 u 轴、b 沿局部 v 轴（b = a × b_ratio）
    pub semi_a: f32,
    pub semi_b: f32,
    /// 径向山峦低频扭曲相位（弧度）
    pub warp_phase1: f32,
    pub warp_phase2: f32,
    /// 盆深（米，中心相对盆底起伏基准下凹总量）
    pub depth_m: f32,
    /// 外缘高耸山体基底高度（米）
    pub rim_height_m: f32,
    /// 陆路出口方向角（世界系弧度）与角向半宽（弧度）
    pub exit_theta: f32,
    pub exit_half_rad: f32,
    /// 盆底噪声阻尼增益
    pub noise_gain: f32,
}

#[inline]
fn smoothstep(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

impl BasinGeometry {
    /// 从 `relief_rng` 专属流抽取参数构建盆地静态几何。
    pub fn plan<T: Fn(f32, f32) -> f32>(
        relief_rng: &mut WorldRng,
        world_size: f32,
        config: &SimConfig,
        _tilt_at: T,
    ) -> Self {
        let cx = relief_rng.gen_range(-0.04, 0.04) * world_size;
        let cy = relief_rng.gen_range(-0.04, 0.04) * world_size;
        let rotation_rad = relief_rng.gen_range(-0.30, 0.30);
        let (sin_rot, cos_rot) = rotation_rad.sin_cos();
        let semi_a = config.terrain_basin_semi_axis_ratio.clamp(0.20, 0.48) * world_size;
        let semi_b = semi_a * relief_rng.gen_range(0.75, 0.92);
        let exit_theta = relief_rng.gen_range(0.0, std::f32::consts::TAU);
        let exit_half_rad = config.terrain_basin_exit_width_deg.max(12.0).to_radians() * 0.5;
        let warp_phase1 = relief_rng.gen_range(0.0, std::f32::consts::TAU);
        let warp_phase2 = relief_rng.gen_range(0.0, std::f32::consts::TAU);
        let depth_m = config.terrain_basin_depth_m.max(6.0);
        let rim_height_m = config.terrain_basin_rim_height_m.max(0.0);
        let noise_gain = config.terrain_basin_noise_gain.clamp(0.0, 1.0);

        Self {
            center_x: cx,
            center_y: cy,
            rotation_rad,
            cos_rot,
            sin_rot,
            semi_a,
            semi_b,
            warp_phase1,
            warp_phase2,
            depth_m,
            rim_height_m,
            exit_theta,
            exit_half_rad,
            noise_gain,
        }
    }

    /// 世界坐标 → 盆地局部椭圆坐标 (q, θ)。
    /// 引入低频角向径向扰动（3θ + 5θ），打破正圆/纯椭圆机械感，形成山峦山岬与凹湾。
    #[inline]
    pub fn q_at(&self, wx: f32, wy: f32) -> (f32, f32) {
        let dx = wx - self.center_x;
        let dy = wy - self.center_y;
        let u = dx * self.cos_rot + dy * self.sin_rot;
        let v = -dx * self.sin_rot + dy * self.cos_rot;
        let q_base = ((u / self.semi_a).powi(2) + (v / self.semi_b).powi(2)).sqrt();
        let theta = v.atan2(u);
        let warp = 1.0 + 0.12 * (3.0 * theta + self.warp_phase1).sin()
            + 0.07 * (5.0 * theta + self.warp_phase2).cos();
        let q = q_base / warp.max(0.6);
        (q, theta)
    }

    /// 角向出口掩码：1 在出口窗口内、0 窗外（肩部 smooth 过渡）。
    /// `exit_theta` 存储为世界系角；`q_at` 返回局部系 θ，此处就地换算。
    #[inline]
    pub fn exit_mask(&self, theta: f32) -> f32 {
        let exit_local = self.exit_theta - self.rotation_rad;
        let mut d = (theta - exit_local).abs() % std::f32::consts::TAU;
        if d > std::f32::consts::PI {
            d = std::f32::consts::TAU - d;
        }
        let blend = self.exit_half_rad * 0.8;
        1.0 - smoothstep((d - self.exit_half_rad) / blend.max(1e-3))
    }

    /// ★ v1.50.78 角向谷地掩码：出口 + 3 条 90° 等间隔径向谷地（共 4 条，均匀十字布设）。
    /// 角度全部由 exit_theta 派生——**零新增 RNG 消费**，其他 profile 逐位不变；
    /// 角向半宽与肩部过渡与出口同款。
    ///
    /// 修复动机：外围崇山带（q > 1.05）由高频噪声（权重 0.65）雕琢，噪声山脊会把
    /// 外围可走区切成孤岛——v1.50.77 探针实测 seed=56 `components=2`（死区 20,689 格，
    /// 占全图 31.6%），单条出口走廊接不到外围主块。4 条径向谷地（含穿壁段）把外围带
    /// 切成 90° 窄扇区，每扇区都以两条「盆心直通图缘」的谷地为界，孤岛概率大幅收敛。
    #[inline]
    pub fn valley_mask(&self, theta: f32) -> f32 {
        let exit_local = self.exit_theta - self.rotation_rad;
        let mut m = 0.0f32;
        for k in 0..4u32 {
            let ang = exit_local + k as f32 * std::f32::consts::FRAC_PI_2;
            let mut d = (theta - ang).abs() % std::f32::consts::TAU;
            if d > std::f32::consts::PI {
                d = std::f32::consts::TAU - d;
            }
            let blend = self.exit_half_rad * 0.8;
            m = m.max(1.0 - smoothstep((d - self.exit_half_rad) / blend.max(1e-3)));
        }
        m
    }

    /// 盆地下凹 + 环抱高山高程增量（米）与噪声权重。
    /// 返回 (dz, noise_weight)。
    ///
    /// 分区剖面：
    /// 1. 盆底广袤平坦生活带 (q <= 0.82)：中心平缓下凹 -depth_m，平地超大面积延展，
    ///    边缘平缓过渡到 -0.80*depth_m（保证生活与营建面积最大化）；
    /// 2. 环抱高山山壁 (0.82 < q <= 1.05)：自盆底向外雄峻攀升至 +rim_height_m（总高差 55~65m），
    ///    峰值坡度稳定在 38°~45°，自动派生 RockFace 与 NO_WALK 环状硬屏障；
    ///    ★ v1.50.78 起谷地窗口内（vm 趋近 1，出口 + 3 条 90° 径向谷地）攀升幅度受控抑制
    ///    （4 条 < 19° 垭口通道，盆心直通图缘，保外围连通）；
    /// 3. 外围崇山峻岭 (q > 1.05)：基底恒定于 +rim_height_m，由高频 fBm 噪声雕琢出连绵山岳，
    ///    谷地方向延续为通畅山谷（孤岛死区修复，见 valley_mask 注释）；
    /// 4. 噪声权重在生活区/谷地受控阻尼，而在外围山地维持高粗糙度。
    pub fn basin_dz(&self, q: f32, theta: f32, _wx: f32, _wy: f32) -> (f32, f32) {
        // ★ v1.50.78：em（单出口）→ vm（出口 + 3 条 90° 径向谷地），damping 全线换用 vm
        let vm = self.valley_mask(theta);

        let dz = if q <= 0.82 {
            let t_floor = smoothstep(q / 0.82);
            -self.depth_m * (1.0 - 0.20 * t_floor)
        } else if q <= 1.05 {
            let t_wall = (q - 0.82) / 0.23;
            let s = smoothstep(t_wall);
            let z_start = -self.depth_m * 0.80;
            let z_rim = self.rim_height_m * (1.0 - 0.85 * vm);
            z_start + (z_rim - z_start) * s
        } else {
            self.rim_height_m * (1.0 - 0.85 * vm)
        };

        // 噪声权重：山壁段保持低噪（0.18）避免单调陡坡出现死区微台阶；
        // 外缘群山充分起伏（0.65）；出口走廊强抑制（-70%）。
        let wall_weight = 0.18;
        let upland_weight = 0.65;
        let base_weight = if q <= 0.82 {
            self.noise_gain
        } else if q <= 1.05 {
            let t = (q - 0.82) / 0.23;
            self.noise_gain + (wall_weight - self.noise_gain) * t
        } else {
            let t = ((q - 1.05) / 0.30).clamp(0.0, 1.0);
            wall_weight + (upland_weight - wall_weight) * smoothstep(t)
        };

        let weight = base_weight * (1.0 - 0.70 * vm);
        (dz, weight)
    }
}
