//! basin.rs · TB-03 盆地绿洲静态几何与高程规划。
//!
//! 负责独立静态模板 `basin_oasis_v1` 的物理高程骨架（TB-03-IMPLEMENTATION-PLAN §4）：
//! 1. 连续椭圆盆地：`z(p) = base(p) − D·F(q) + rim(p) + protected_noise(p)`，
//!    `F(q) = (1−q²)²`（q<1；中心和外界一阶导数为零，无生硬接缝）；
//!    `rim` 为有限支撑外缘低脊（sin² 剖面，两端导数为零），出口方向归零；
//! 2. 至少一个明确陆路出口：角向窗口内盆壁梯度阻尼 + 低脊归零 + 噪声强抑制，
//!    出口、盆底生活带连通外缘；不靠临时提高居民体力预算补救；
//! 3. 中心小泉池：半径 10~14m（06 号 §5.6 初值），池区局部平坦化（水位与池床/
//!    岸环关系由几何保证），静水由 `static_water.rs` 施加（水体 id=1 ↔ 池 id=1），
//!    紧邻 NO_BUILD 干燥岸环（可步行、禁建），可建生活带在岸环外盆底。
//!
//! 首版单实际取水岸点（`water_source_poi_count`）；池总预算 = `stockMaxWater×countWater`，
//! 不按岸点乘算（`prepare_terrain_layout` 静水路径）。
//!
//! 纯确定性：几何由创世 `GenesisScratch` 共享，不进快照/存档；参数抽样走
//! `relief_rng` 专属局部流（消费序固定：盆心横移 ×2 → 旋转 → 短半轴比 →
//! 出口方向 → 池偏移方向 → 池偏移距离 → 池半径）。

use crate::config::SimConfig;
use crate::rng::WorldRng;
use super::static_water::{build_closed_ellipse_outline, StaticWaterPlan};

/// 盆地绿洲静态几何（创世 scratch 专用，不进快照/存档）。
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
    /// 盆深（米，中心相对盆缘下凹总量）
    pub depth_m: f32,
    /// 外缘低脊高度（米）
    pub rim_height_m: f32,
    /// 陆路出口方向角（世界系弧度）与角向半宽（弧度）
    pub exit_theta: f32,
    pub exit_half_rad: f32,
    /// 泉池中心（世界坐标）与半径（米）
    pub pool_cx: f32,
    pub pool_cy: f32,
    pub pool_radius: f32,
    /// 泉池床最大深度（米）
    pub pool_depth_m: f32,
    /// 泉池外干燥岸环宽（米，NO_BUILD 禁建安全环）
    pub bank_ring_m: f32,
    /// 盆底噪声阻尼增益
    pub noise_gain: f32,
    /// 泉池区平坦基准高程（米，第 2 步解析计算：局部倾斜 + 盆地下凹，不含噪声）
    pub pool_datum: f32,
    /// 静水计划（第 2 步末尾构建；第 3 步消费）
    pub water: Option<StaticWaterPlan>,
}

/// sin² 剖面（两端导数为零的低脊/包络基元）。
#[inline]
fn sin2_profile(u: f32) -> f32 {
    let u = u.clamp(0.0, 1.0);
    let s = (std::f32::consts::PI * u).sin();
    s * s
}

#[inline]
fn smoothstep(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

impl BasinGeometry {
    /// 从 `relief_rng` 专属流抽取参数构建盆地静态几何。
    ///
    /// `tilt_at`：基础倾斜平面（世界坐标 → 高程米），供泉池平坦基准解析计算
    ///（与 `generate_base_relief` 的 `base_tilt` 同式，保证第 2 步逐位一致）。
    pub fn plan<T: Fn(f32, f32) -> f32>(
        relief_rng: &mut WorldRng,
        world_size: f32,
        config: &SimConfig,
        tilt_at: T,
    ) -> Self {
        let cx = relief_rng.gen_range(-0.04, 0.04) * world_size;
        let cy = relief_rng.gen_range(-0.04, 0.04) * world_size;
        let rotation_rad = relief_rng.gen_range(-0.30, 0.30);
        let (sin_rot, cos_rot) = rotation_rad.sin_cos();
        let semi_a = config.terrain_basin_semi_axis_ratio.clamp(0.20, 0.42) * world_size;
        let semi_b = semi_a * relief_rng.gen_range(0.80, 0.95);
        let depth_m = config.terrain_basin_depth_m.max(6.0);
        let rim_height_m = config.terrain_basin_rim_height_m.max(0.0);
        let exit_theta = relief_rng.gen_range(0.0, std::f32::consts::TAU);
        let exit_half_rad = config.terrain_basin_exit_width_deg.max(12.0).to_radians() * 0.5;
        let pool_dir = relief_rng.gen_range(0.0, std::f32::consts::TAU);
        let pool_dist = relief_rng.gen_range(0.0, 0.10) * semi_b;
        let pool_cx = cx + pool_dir.cos() * pool_dist;
        let pool_cy = cy + pool_dir.sin() * pool_dist;
        // 池半径：[min, max] 单次抽样（区间无效时钳制为单点）
        let r_min = config.terrain_basin_pool_radius_min_m.max(4.0);
        let r_max = config.terrain_basin_pool_radius_max_m.max(r_min + 0.1);
        let pool_radius = relief_rng.gen_range(r_min, r_max);
        let pool_depth_m = config.terrain_basin_pool_depth_m.max(0.5);
        let bank_ring_m = config.terrain_basin_bank_ring_m.max(4.0);
        let noise_gain = config.terrain_basin_noise_gain.clamp(0.0, 1.0);

        let mut geom = Self {
            center_x: cx,
            center_y: cy,
            rotation_rad,
            cos_rot,
            sin_rot,
            semi_a,
            semi_b,
            depth_m,
            rim_height_m,
            exit_theta,
            exit_half_rad,
            pool_cx,
            pool_cy,
            pool_radius,
            pool_depth_m,
            bank_ring_m,
            noise_gain,
            pool_datum: 0.0,
            water: None,
        };

        // 泉池基准：局部倾斜 + 盆地下凹（不含噪声）。静水水位 = datum − 2.0m；
        // 岸环地面 = 基准 ±（池邻倾斜 ~1m + 阻尼噪声 ~0.25m）恒高于水位
        //（≥0.75m 余量），池床最低 = datum − 2.0 − pool_depth < 水位——
        // 「水面位于池床之上、岸环最低地表之下」由几何保证。
        // ⚠️ 不做整片平坦化：盆底曲率 F(q) 在 40~120m 内变化 ~10m，混合环会产生
        // 33°+ 陡坡环阻断出口（TB-03-06 实测踩坑），改为池邻噪声强抑制。
        let (q, theta_pc) = geom.q_at(pool_cx, pool_cy);
        geom.pool_datum = tilt_at(pool_cx, pool_cy) + geom.basin_dz(q, theta_pc, pool_cx, pool_cy).0;

        // 静水计划：泉池闭合轮廓（微小扰动，半径恒正）+ 水位 + 单取水岸点
        //（位于出口方向岸环内，真实干地；id=1 按槽位分配）。
        let level = geom.pool_datum - 2.0;
        let outline = build_closed_ellipse_outline(
            geom.pool_cx,
            geom.pool_cy,
            geom.pool_radius,
            geom.pool_radius,
            0.0,
            0.04,
            0.0,
            0.0,
            0.0,
            20,
        );
        let ap_r = geom.pool_radius + 9.0;
        let access_points = vec![(
            geom.pool_cx + geom.exit_theta.cos() * ap_r,
            geom.pool_cy + geom.exit_theta.sin() * ap_r,
        )];
        geom.water = Some(StaticWaterPlan {
            water_body_id: 1,
            level,
            outline,
            center_x: geom.pool_cx,
            center_y: geom.pool_cy,
            shore_ring_m: bank_ring_m,
            access_points,
        });
        geom
    }

    /// 世界坐标 → 盆地局部椭圆坐标 (q, θ)。
    #[inline]
    pub fn q_at(&self, wx: f32, wy: f32) -> (f32, f32) {
        let dx = wx - self.center_x;
        let dy = wy - self.center_y;
        let u = dx * self.cos_rot + dy * self.sin_rot;
        let v = -dx * self.sin_rot + dy * self.cos_rot;
        let q = ((u / self.semi_a).powi(2) + (v / self.semi_b).powi(2)).sqrt();
        (q, v.atan2(u))
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

    /// 盆地下凹 + 低脊高程增量（米）与噪声权重。
    /// 返回 (dz, noise_weight)；`F(q) = (1−q²)²` 在 q=0/1 处一阶导数为零。
    /// 噪声权重在出口走廊内强抑制，并在泉池邻域（半径 + 岸环 + 15m）进一步
    /// 压到 ~15%（岸环地面方差控制，服务水位/池床关系）。
    pub fn basin_dz(&self, q: f32, theta: f32, wx: f32, wy: f32) -> (f32, f32) {
        let em = self.exit_mask(theta);
        let f = if q < 1.0 {
            let c = 1.0 - q * q;
            c * c
        } else {
            0.0
        };
        // 出口走廊：盆壁梯度阻尼 60%（wall_band 只作用于盆壁段），低脊归零
        let wall_band = smoothstep((q - 0.55) / 0.25);
        let dz = -self.depth_m * f * (1.0 - 0.6 * em * wall_band)
            + self.rim_height_m * sin2_profile((q - 1.0) / 0.14) * (1.0 - em);
        // 噪声权重：盆底阻尼；出口走廊再抑制；泉池邻域强抑制
        let d_pool = (wx - self.pool_cx).hypot(wy - self.pool_cy);
        let pool_prox = 1.0 - smoothstep((d_pool - self.pool_radius - self.bank_ring_m - 5.0) / 20.0);
        let mut weight = self.noise_gain * (1.0 - 0.7 * em);
        weight *= 1.0 - 0.85 * pool_prox;
        (dz, weight)
    }

    /// 点到泉池水线的有向距离（米）：负值在水内。轮廓为近圆（扰动 ±4%），
    /// 用「到池心距离 − 局部轮廓半径」近似（误差 < 扰动脉冲，岸环判据已留余量）。
    #[inline]
    pub fn shore_distance(&self, wx: f32, wy: f32) -> f32 {
        let d = (wx - self.pool_cx).hypot(wy - self.pool_cy);
        d - self.pool_radius * 1.02
    }

    /// 是否落在泉池干燥岸环（水线外 0~bank_ring 米；NO_BUILD 禁建安全环）。
    pub fn on_shore_ring(&self, wx: f32, wy: f32) -> bool {
        let d = self.shore_distance(wx, wy);
        d > 0.0 && d <= self.bank_ring_m
    }

    /// 泉池水下格高程剖面（第 3 步 `apply_static_water` 消费；与平坦基准同源）。
    pub fn pool_bed_elevation(&self, wx: f32, wy: f32) -> f32 {
        let d = (wx - self.pool_cx).hypot(wy - self.pool_cy);
        let u = (d / self.pool_radius.max(1.0)).min(1.0);
        let depth = 0.35 + (self.pool_depth_m - 0.35) * (1.0 - u * u);
        let level = self.pool_datum - 2.0;
        level - depth
    }
}
