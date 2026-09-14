//! plateau.rs · TB-02 台地聚落静态几何与高程规划。
//!
//! 负责独立静态模板 `plateau_settlement_v1` 的物理高程骨架：
//! 1. 平缓且可建的台面（圆角矩形 SDF $d \le 0$）；
//! 2. 真实阻路的陡峭台缘（$B = \text{edge\_band} = 0.6H \implies$ 峰坡 $\ge 34^\circ \implies \text{RockFace} + \text{NO\_WALK}$）；
//! 3. 两个可以通过生产道路走廊的缓坡入口（$B = \text{ramp\_band} = 4.0H \implies$ 峰坡 $\le 30^\circ$、核心宽度 $\ge 32\text{m}$、肩部平滑过渡）；
//! 4. 坡脚水源候选锚点（对置 2 处，对应 ID 30/31 的 `SpringValley` 特征）与台面 $\ge 3$ 个房屋候选。
//!
//! 纯函数计算，不消费共享 `WorldRng`；几何由创世 `GenesisScratch` 共享，不进快照/存档。

use crate::config::SimConfig;
use crate::rng::WorldRng;

/// 台地聚落静态几何（创世 scratch 专用，不进快照/存档）。
#[derive(Debug, Clone)]
pub struct PlateauGeometry {
    /// 台心世界坐标 (wx, wy)
    pub center_x: f32,
    pub center_y: f32,
    /// 主轴局部旋转角（弧度）与三角常数
    pub rotation_rad: f32,
    pub cos_rot: f32,
    pub sin_rot: f32,
    /// 台面半尺寸（米）：half_width 沿局部 u 轴（入口轴向），half_depth 沿局部 v 轴
    pub half_width: f32,
    pub half_depth: f32,
    /// 圆角半径（米）
    pub corner_radius: f32,
    /// 台面抬升总高度 H (米)
    pub height: f32,
    /// 普通台缘过渡带宽度（米）：B_edge = 0.6H
    pub edge_band: f32,
    /// 入口缓坡过渡带宽度（米）：B_ramp = 4.0H
    pub ramp_band: f32,
    /// 缓坡核心区横向全宽（米，$\ge 32\text{m}$）
    pub ramp_core_width: f32,
    /// 缓坡肩部横向过渡宽度（米）
    pub ramp_shoulder_width: f32,
    /// 台面噪声阻尼增益
    pub top_noise_gain: f32,
    /// 缓坡噪声阻尼增益
    pub ramp_noise_gain: f32,
    /// 台缘低频轮廓扰动幅度（米）
    pub outline_warp: f32,

    // ── 关键地理锚点（世界坐标）──
    /// 台面中心公共节点锚点
    pub center_anchor: (f32, f32),
    /// 入口 A（西侧，u < 0）坡顶锚点（台面边缘内侧）
    pub ramp_a_top: (f32, f32),
    /// 入口 A（西侧，u < 0）坡脚锚点（平原上）
    pub ramp_a_bottom: (f32, f32),
    /// 入口 B（东侧，u > 0）坡顶锚点（台面边缘内侧）
    pub ramp_b_top: (f32, f32),
    /// 入口 B（东侧，u > 0）坡脚锚点（平原上）
    pub ramp_b_bottom: (f32, f32),
    /// 坡脚生活水源候选锚点（2 处，对应 SpringValley #30/#31）
    pub spring_anchors: Vec<(f32, f32)>,
    /// 台面房屋候选锚点（$\ge 3$ 处互不重叠）
    pub build_candidates: Vec<(f32, f32)>,
}

impl PlateauGeometry {
    /// 从 `relief_rng` 专属流抽取参数构建台地静态几何。
    pub fn plan(
        relief_rng: &mut WorldRng,
        world_size: f32,
        config: &SimConfig,
    ) -> Self {
        let h_min = config.terrain_plateau_height_min.max(10.0);
        let h_max = config.terrain_plateau_height_max.max(h_min + 0.1);
        let height = relief_rng.gen_range(h_min, h_max);

        // 台心微幅离散（在中心 $\pm 0.03 \times \text{world\_size}$ 内，保持两端有足够边距容纳坡脚水源）
        let cx = relief_rng.gen_range(-0.03, 0.03) * world_size;
        let cy = relief_rng.gen_range(-0.03, 0.03) * world_size;

        // 局部轴向微幅旋转（$\pm 0.20$ 弧度 $\approx \pm 11.5^\circ$）
        let rotation_rad = relief_rng.gen_range(-0.20, 0.20);
        let (sin_rot, cos_rot) = rotation_rad.sin_cos();

        // 半尺寸：u 轴（入口方向）半宽 0.21~0.23，v 轴半深 0.17~0.19
        let hw_ratio = config.terrain_plateau_half_width_ratio.clamp(0.15, 0.30);
        let hd_ratio = config.terrain_plateau_half_depth_ratio.clamp(0.12, 0.25);
        let half_width = hw_ratio * world_size;
        let half_depth = hd_ratio * world_size;

        let cr_ratio = config.terrain_plateau_corner_radius_ratio.clamp(0.15, 0.50);
        let corner_radius = cr_ratio * half_depth.min(half_width);

        let eb_ratio = config.terrain_plateau_edge_band_ratio.clamp(0.3, 1.2);
        let rb_ratio = config.terrain_plateau_ramp_band_ratio.clamp(2.5, 6.0);
        let edge_band = eb_ratio * height;
        let ramp_band = rb_ratio * height;

        let ramp_core_width = config.terrain_plateau_ramp_width.max(32.0);
        let ramp_shoulder_width = config.terrain_plateau_ramp_shoulder_width.max(12.0);

        let top_noise_gain = config.terrain_plateau_top_noise_gain.clamp(0.05, 0.50);
        let ramp_noise_gain = config.terrain_plateau_ramp_noise_gain.clamp(0.02, 0.30);
        let outline_warp = config.terrain_plateau_outline_warp.max(0.0);

        let mut geom = Self {
            center_x: cx,
            center_y: cy,
            rotation_rad,
            cos_rot,
            sin_rot,
            half_width,
            half_depth,
            corner_radius,
            height,
            edge_band,
            ramp_band,
            ramp_core_width,
            ramp_shoulder_width,
            top_noise_gain,
            ramp_noise_gain,
            outline_warp,
            center_anchor: (cx, cy),
            ramp_a_top: (0.0, 0.0),
            ramp_a_bottom: (0.0, 0.0),
            ramp_b_top: (0.0, 0.0),
            ramp_b_bottom: (0.0, 0.0),
            spring_anchors: Vec::with_capacity(2),
            build_candidates: Vec::with_capacity(6),
        };

        // 锚点设置：
        // 坡顶锚点位于台面内侧 14m（平缓安全区）
        // 坡脚锚点位于坡底外侧 16m（平原上）
        geom.ramp_a_top = geom.local_to_world(-half_width + 14.0, 0.0);
        geom.ramp_a_bottom = geom.local_to_world(-half_width - ramp_band - 16.0, 0.0);

        geom.ramp_b_top = geom.local_to_world(half_width - 14.0, 0.0);
        geom.ramp_b_bottom = geom.local_to_world(half_width + ramp_band + 16.0, 0.0);

        // 坡脚泉眼候选锚点：两处，分别位于 Ramp A 与 Ramp B 坡脚平原侧向
        let s0_u = -half_width - ramp_band - 32.0;
        let s0_v = -42.0;
        let s1_u = half_width + ramp_band + 32.0;
        let s1_v = 42.0;
        geom.spring_anchors.push(geom.local_to_world(s0_u, s0_v));
        geom.spring_anchors.push(geom.local_to_world(s1_u, s1_v));

        // 台面可建房屋候选区（6 处互不重叠锚点）
        let offsets = [
            (0.0, 0.0),
            (-half_width * 0.45, -half_depth * 0.35),
            (-half_width * 0.45, half_depth * 0.35),
            (half_width * 0.45, -half_depth * 0.35),
            (half_width * 0.45, half_depth * 0.35),
            (0.0, half_depth * 0.42),
        ];
        for &(ou, ov) in &offsets {
            geom.build_candidates.push(geom.local_to_world(ou, ov));
        }

        geom
    }

    /// 局部坐标 (u, v) 转世界坐标 (wx, wy)
    #[inline]
    pub fn local_to_world(&self, u: f32, v: f32) -> (f32, f32) {
        let wx = self.center_x + u * self.cos_rot - v * self.sin_rot;
        let wy = self.center_y + u * self.sin_rot + v * self.cos_rot;
        (wx, wy)
    }

    /// 世界坐标 (wx, wy) 转局部坐标 (u, v)
    #[inline]
    pub fn world_to_local(&self, wx: f32, wy: f32) -> (f32, f32) {
        let dx = wx - self.center_x;
        let dy = wy - self.center_y;
        let u = dx * self.cos_rot + dy * self.sin_rot;
        let v = -dx * self.sin_rot + dy * self.cos_rot;
        (u, v)
    }

    /// 计算指定世界坐标处的高程
    pub fn elevation_at(
        &self,
        wx: f32,
        wy: f32,
        base_tilt: f32,
        fbm_raw: f32,
        warp_raw: f32,
    ) -> f32 {
        let (u, v) = self.world_to_local(wx, wy);

        // 1. 圆角矩形 SDF
        let qx = u.abs() - (self.half_width - self.corner_radius);
        let qy = v.abs() - (self.half_depth - self.corner_radius);
        let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt();
        let inside = qx.max(qy).min(0.0);
        let d_sdf = outside + inside - self.corner_radius;

        // 2. 入口横向范围判定
        let half_core = self.ramp_core_width * 0.5;
        let shoulder_end = half_core + self.ramp_shoulder_width;
        let abs_v = v.abs();

        // 3. 入口保护带与轮廓扰动
        // 核心区内轮廓扭曲归零，肩部平滑恢复到 1.0；台面深处 (d < -8m) 也抑制扰动
        let warp_mask_v = if abs_v <= half_core {
            0.0
        } else if abs_v < shoulder_end {
            let t = (abs_v - half_core) / self.ramp_shoulder_width;
            t * t * (3.0 - 2.0 * t)
        } else {
            1.0
        };
        let warp_mask_d = ((d_sdf + 8.0) / 8.0).clamp(0.0, 1.0);
        let d_eff = d_sdf + warp_raw * self.outline_warp * warp_mask_v * warp_mask_d;

        // 4. 局部过渡带宽度 B(p)
        // 入口仅在局部横向 |v| < shoulder_end 处生效；超出范围严格为普通台缘
        let band = if abs_v <= half_core {
            self.ramp_band
        } else if abs_v < shoulder_end {
            let t = (abs_v - half_core) / self.ramp_shoulder_width;
            let s = t * t * (3.0 - 2.0 * t);
            self.ramp_band * (1.0 - s) + self.edge_band * s
        } else {
            self.edge_band
        };

        // 5. smoothstep 高程抬升：d_eff <= 0 为台面 (+H)，d_eff >= band 为平原 (+0)
        let t_band = (d_eff / band).clamp(0.0, 1.0);
        let smooth = t_band * t_band * (3.0 - 2.0 * t_band);
        let z_plateau = self.height * (1.0 - smooth);

        // 6. 噪声阻尼与混合
        // 台面内部 (d_eff <= 0) 阻尼保可建；缓坡入口 (|v| <= half_core) 阻尼保走廊可走；
        // 普通陡缘低噪声保断崖连续；外部平原恢复常规平原噪声
        let noise_weight = if d_eff <= 0.0 {
            self.top_noise_gain
        } else if abs_v <= half_core && d_eff < self.ramp_band {
            self.ramp_noise_gain
        } else if d_eff < self.edge_band {
            0.08
        } else {
            let t_ext = ((d_eff - self.edge_band) / 20.0).clamp(0.0, 1.0);
            0.08 + (0.35 - 0.08) * (t_ext * t_ext * (3.0 - 2.0 * t_ext))
        };

        base_tilt + z_plateau + fbm_raw * noise_weight
    }
}
