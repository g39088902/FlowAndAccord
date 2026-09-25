//! volcanic_lake.rs · TB-03 火山湖静态几何与高程规划。
//!
//! 负责独立静态模板 `volcanic_lake_v1` 的物理高程骨架（TB-03-IMPLEMENTATION-PLAN §6）：
//! 1. 中心静水湖：椭圆边界 + 有限低频径向扰动（限制半径正值与凹度，无岛屿），
//!    半轴按配置随机抽样后收缩至约 0.08~0.13×world；湖心随机偏移在平原中形成天池式火山口湖；
//! 2. 分带高程（q = 归一化椭圆半径）：
//!    q<1 湖床（水下格由静水涂写强制下凹）→ 1≤q<1.42 干岸平台（平坦、可建、
//!    岸线安全退距 NO_BUILD）→ 1.42≤q<3.25 环形火山锥体（出口走廊压低为双缓坡）→
//!    q≥3.25 平原或轻微起伏外缘。湖心近域使用平坦基准（局部倾斜会破坏水平水面与环岸平台），
//!    过渡带平滑回归局部倾斜；
//! 3. 两个分离陆路出口：外坡角向窗口归零（间隔 ≥126°，不共用咽喉），
//!    连接环湖生活带与外缘资源区；至少一条完整环湖陆路（干岸平台连续）；
//! 4. 静水由 `static_water.rs` 施加（水体 id=1 ↔ 池 id=1，可采淡水），首版两个
//!    分离湖岸取水点共享同一淡水池（总预算 = `stockMaxWater×countWater`）。
//!
//! 与不可采的局部 FootLake/OxbowLake 区分；不模拟补给河/出流河/季节水位。
//!
//! 纯确定性：几何由创世 `GenesisScratch` 共享，不进快照/存档；参数抽样走
//! `relief_rng` 专属局部流（消费序固定：湖心横移 ×2 → 旋转 → 长轴比 → 短轴比 →
//! 轮廓谐波相位 ×2 → 出口 1 方向 → 出口 2 间隔 → 取水点角偏移）。

use super::static_water::{build_closed_ellipse_outline, StaticWaterPlan};
use crate::config::SimConfig;
use crate::rng::WorldRng;

/// 火山湖静态几何（创世 scratch 专用，不进快照/存档）。
#[derive(Debug, Clone)]
pub struct VolcanicLakeGeometry {
    /// 湖心世界坐标
    pub center_x: f32,
    pub center_y: f32,
    /// 局部旋转角（弧度）与三角常数
    pub rotation_rad: f32,
    pub cos_rot: f32,
    pub sin_rot: f32,
    /// 湖半轴（米）：a 沿局部 u 轴、b 沿局部 v 轴（配置随机抽样后缩放至约 0.08~0.13×world）
    pub semi_a: f32,
    pub semi_b: f32,
    /// 湖床最大深度（米）
    pub depth_m: f32,
    /// 水岸安全退距（米，岸线外 NO_BUILD 缓冲）
    pub shore_setback_m: f32,
    /// 火山坡面噪声阻尼增益
    pub noise_gain: f32,
    /// 火山锥体环壁总抬升（米）
    pub outer_rise_m: f32,
    /// 轮廓低频扰动：相对幅度与相位（2 谐波；|w1|+|w2| ≤ 0.12 保证半径恒正）
    pub warp1: f32,
    pub warp2: f32,
    pub phase1: f32,
    pub phase2: f32,
    /// 两个陆路出口方向角（世界系弧度；间隔 ≥126°）
    pub exit_thetas: [f32; 2],
    pub exit_half_rad: f32,
    /// 干岸平台平坦基准高程（米，解析计算：湖心处局部倾斜，不含噪声）
    pub shore_datum: f32,
    /// 静水计划（第 2 步末尾构建；第 3 步消费）
    pub water: Option<StaticWaterPlan>,
}

#[inline]
fn smoothstep(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

impl VolcanicLakeGeometry {
    /// 从 `relief_rng` 专属流抽取参数构建平原中的火山口湖与环形火山体。
    ///
    /// `tilt_at`：基础倾斜平面（世界坐标 → 高程米），供干岸平台平坦基准解析计算。
    pub fn plan<T: Fn(f32, f32) -> f32>(
        relief_rng: &mut WorldRng,
        world_size: f32,
        config: &SimConfig,
        tilt_at: T,
    ) -> Self {
        let cx = relief_rng.gen_range(-0.08, 0.08) * world_size;
        let cy = relief_rng.gen_range(-0.08, 0.08) * world_size;
        let rotation_rad = relief_rng.gen_range(0.0, std::f32::consts::TAU);
        let (sin_rot, cos_rot) = rotation_rad.sin_cos();
        let a_min = config.terrain_lake_semi_axis_ratio_min.clamp(0.06, 0.24);
        let a_max = config
            .terrain_lake_semi_axis_ratio_max
            .clamp(a_min + 0.01, 0.26);
        // 天池的湖面只占火山体的一小部分：保留配置的随机性，但把湖面收进
        // 更宽的环形山口，避免画面退化成一块孤立的蓝色椭圆。
        let lake_scale = 0.80;
        let semi_a = relief_rng.gen_range(a_min, a_max) * world_size * lake_scale;
        let semi_b = relief_rng.gen_range(a_min, a_max) * world_size * lake_scale;
        let depth_m = config.terrain_lake_depth_m.max(1.0);
        let shore_setback_m = config.terrain_lake_shore_setback_m.max(2.0);
        let noise_gain = config.terrain_lake_noise_gain.clamp(0.0, 1.0);
        // 轮廓扰动：相对幅度 ≤0.07/谐波（合计 ≤0.12，半径恒正、无凹颈岛屿）
        let warp_amp = (config.terrain_lake_outline_warp_m / semi_b.max(1.0)).clamp(0.02, 0.07);
        let phase1 = relief_rng.gen_range(0.0, std::f32::consts::TAU);
        let phase2 = relief_rng.gen_range(0.0, std::f32::consts::TAU);
        let warp1 = warp_amp;
        let warp2 = warp_amp * 0.6;
        // 两个分离出口：θ1 均匀抽样、θ2 = θ1 + [2.2, 4.0] rad（间隔 ≥126°）
        let exit1 = relief_rng.gen_range(0.0, std::f32::consts::TAU);
        let exit2 = exit1 + relief_rng.gen_range(2.2, 4.0);
        let exit_half_rad = 0.46; // 两条窄缓坡出山口，保留完整环形火山口轮廓
                                  // 天池式火山体：湖面位于平原中部，外圈形成宽缓但明显的火山锥体。
                                  // 高度随地图尺度缩放，使不同世界尺寸仍保持远景可辨。
        let outer_rise_m = (world_size * 0.060).clamp(40.0, 72.0);

        let mut geom = Self {
            center_x: cx,
            center_y: cy,
            rotation_rad,
            cos_rot,
            sin_rot,
            semi_a,
            semi_b,
            depth_m,
            shore_setback_m,
            noise_gain,
            outer_rise_m,
            warp1,
            warp2,
            phase1,
            phase2,
            exit_thetas: [exit1, exit2],
            exit_half_rad,
            shore_datum: 0.0,
            water: None,
        };

        // 干岸平台平坦基准 = 湖心处局部倾斜（解析、不含噪声）
        geom.shore_datum = tilt_at(cx, cy);

        // 静水计划：闭合扰动椭圆轮廓 + 水位（datum − 1.2）+ 两个分离湖岸取水点
        //（岸线外 6m 真实干地；分居两出口邻域，间距 ≥2×semi_b×sin(Δθ/2) ≫ 70m）。
        let level = geom.shore_datum - 1.2;
        let outline = build_closed_ellipse_outline(
            cx,
            cy,
            semi_a,
            semi_b,
            rotation_rad,
            geom.warp1,
            geom.warp2,
            phase1,
            phase2,
            44,
        );
        let mut access_points = Vec::with_capacity(2);
        for (i, &e) in geom.exit_thetas.iter().enumerate() {
            // 取水点方向：出口方向 ±0.45 rad 偏转（i=0 顺时针、i=1 逆时针，确定性错开）。
            // ⚠️ outline_radius_at 消费局部角，世界角需先减 rotation（TB-03-08 实测踩坑）。
            let a_world = e + if i == 0 { -0.45 } else { 0.45 };
            let (r_out_a, _) = geom.outline_radius_at(a_world - rotation_rad);
            // 岸线外 12m（退距外缘）：既保证道路走廊半径（~5.7m）不扫到紧贴
            // 水线的深水格，又落在可建干岸带内；距水线 12m < 交互半径 22m。
            access_points.push((
                cx + a_world.cos() * (r_out_a + 12.0),
                cy + a_world.sin() * (r_out_a + 12.0),
            ));
        }
        geom.water = Some(StaticWaterPlan {
            water_body_id: 1,
            level,
            outline,
            center_x: cx,
            center_y: cy,
            shore_ring_m: shore_setback_m,
            access_points,
        });
        geom
    }

    /// 世界坐标 → 湖局部椭圆坐标 (u, v)。
    #[inline]
    fn local_uv(&self, wx: f32, wy: f32) -> (f32, f32) {
        let dx = wx - self.center_x;
        let dy = wy - self.center_y;
        (
            dx * self.cos_rot + dy * self.sin_rot,
            -dx * self.sin_rot + dy * self.cos_rot,
        )
    }
    /// 局部角 θ 处的扰动轮廓半径（米）与标称椭圆半径（米）。
    /// 轮廓半径 = 椭圆半径(θ) × (1 + warp(θ))。
    pub fn outline_radius_at(&self, theta: f32) -> (f32, f32) {
        let ell = 1.0
            / ((theta.cos() / self.semi_a).powi(2) + (theta.sin() / self.semi_b).powi(2))
                .sqrt()
                .max(1e-6);
        let warp = 1.0
            + self.warp1 * (2.0 * theta + self.phase1).sin()
            + self.warp2 * (3.0 * theta + self.phase2).sin();
        (ell * warp, ell)
    }

    /// 出口掩码：两出口窗口取最大（1 在窗口内、0 窗外）。
    pub fn exit_mask(&self, theta: f32) -> f32 {
        let blend = self.exit_half_rad * 0.8;
        let mut m = 0.0f32;
        for &e in &self.exit_thetas {
            let exit_local = e - self.rotation_rad;
            let mut d = (theta - exit_local).abs() % std::f32::consts::TAU;
            if d > std::f32::consts::PI {
                d = std::f32::consts::TAU - d;
            }
            m = m.max(1.0 - smoothstep((d - self.exit_half_rad) / blend.max(1e-3)));
        }
        m
    }

    /// 分带高程增量（米）与噪声权重。返回 (dz, noise_weight, datum_blend)。
    ///
    /// * q<1：火山口湖湖床下凹（与第 3 步水下格涂写同源：`level − bed_offset`，
    ///   level = shore_datum − 1.2）；
    /// * 1≤q<1.42：火山口内的干岸平台（dz=0、平坦基准 datum_blend=1、噪声强阻尼）；
    /// * 1.42≤q<3.25：环形火山锥体（出口走廊保留为低坡谷地），基准平滑回归局部倾斜；
    /// * q≥3.25：平原或轻微起伏的外部地表（dz=0、正常倾斜与噪声）。
    pub fn elevation_offset(&self, wx: f32, wy: f32) -> (f32, f32, f32) {
        let (u, v) = self.local_uv(wx, wy);
        let theta = v.atan2(u);
        let (r_out, _ell) = self.outline_radius_at(theta);
        // 扰动轮廓下的归一化半径（u_n = 椭圆半径 / 扰动轮廓半径）
        let ell = (u * u + v * v).sqrt();
        let u_n = if ell > 1e-6 { ell / r_out } else { 0.0 };
        let em = self.exit_mask(theta);
        if u_n < 1.0 {
            // 湖床：与静水 bed 剖面同源（水位 = datum − 1.2，边缘床深 0.4m）
            let bed = 0.4 + (self.depth_m - 0.4) * (1.0 - u_n * u_n);
            (-1.2 - bed, 0.08, 1.0)
        } else if u_n < 1.42 {
            // 干岸平台：平坦可建（安全退距 NO_BUILD 由第 6 步覆盖意图施加；
            // 带宽 0.45×r_out ≈ 40~55m，扣除岸线扰动与退距后仍容一排完整房屋）
            (0.0, 0.15, 1.0)
        } else if u_n < 3.25 {
            // 火山锥体：湖岸外先抬到连续的环形火山口，再向平原宽缓回落。
            // 非对称 sin² 让内侧肩部更醒目，出口只切出窄谷，不再留下两座孤立土丘。
            let t = (u_n - 1.42) / 1.83;
            let s = (std::f32::consts::PI * t.clamp(0.0, 1.0)).sin();
            let rise = self.outer_rise_m * s * s * (1.0 - 0.30 * t) * (1.0 - 0.55 * em);
            // 火山坡脚平滑回归平原基准，返回 datum_blend 供调用方混合。
            // 按 (1−blend)/blend 混合（跨岭带平滑回归局部倾斜，回归梯度 ≤5°）
            let datum_blend = 1.0 - smoothstep((u_n - 1.42) / 0.48);
            (rise, self.noise_gain, datum_blend)
        } else {
            // 外缘平地：中等噪声（接近通用平原权重，避免满幅噪声推高坡度方差）
            (0.0, 0.5, 0.0)
        }
    }

    /// 点到湖水线的有向距离（米）：负值在水内。
    /// 近似：归一化椭圆半径差 × 局部椭圆半径（扰动脉冲受限，判据留有余量）。
    pub fn shore_distance(&self, wx: f32, wy: f32) -> f32 {
        let (u, v) = self.local_uv(wx, wy);
        let q = ((u / self.semi_a).powi(2) + (v / self.semi_b).powi(2)).sqrt();
        let theta = v.atan2(u);
        let (r_out, ell) = self.outline_radius_at(theta);
        let d = q * ell; // 点的极径（米）
        d - r_out
    }

    /// 是否落在湖岸安全退距（水线外 0~setback 米；NO_BUILD 禁建缓冲）。
    pub fn on_shore_ring(&self, wx: f32, wy: f32) -> bool {
        let d = self.shore_distance(wx, wy);
        d > 0.0 && d <= self.shore_setback_m
    }

    /// 湖水下格高程剖面（第 3 步 `apply_static_water` 消费；与第 2 步湖床同源）。
    pub fn lake_bed_elevation(&self, wx: f32, wy: f32) -> f32 {
        let (u, v) = self.local_uv(wx, wy);
        let q = ((u / self.semi_a).powi(2) + (v / self.semi_b).powi(2)).sqrt();
        let theta = v.atan2(u);
        let (r_out, ell) = self.outline_radius_at(theta);
        let d = q * ell;
        let u_n = (d / r_out.max(1.0)).min(1.0);
        let bed = 0.4 + (self.depth_m - 0.4) * (1.0 - u_n * u_n);
        (self.shore_datum - 1.2) - bed
    }
}
