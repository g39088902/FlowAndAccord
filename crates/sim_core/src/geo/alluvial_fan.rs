//! alluvial_fan.rs · TB-03 山前冲积扇静态几何与高程规划。
//!
//! 负责独立静态模板 `alluvial_fan_v1` 的物理高程骨架（TB-03-IMPLEMENTATION-PLAN §5；
//! ★ v1.50.68 辨识度改善第一批；后续批次规划 10 号专项文档待建）：
//! 1. 山口锚点 O → 扇缘的连续缓坡扇面：`z_fan = A × radial(r/L) × angular(θ/α)`，
//!    radial 改为**双段凸形剖面**（扇头 0~0.2L 陡段形成可读「山口堆」+ 其后缓段，
//!    两段 smoothstep C1 衔接，端点语义 radial(0)=1/radial(1)=0 不变），angular 在扇侧
//!    平滑归零；山口中心用固定半径圆滑帽规避 atan2 原点奇异，帽区内叠加小幅高程帽
//!    强化山口堆意象；扇外恢复基底。
//! 2. 3~4 条干浅沟（★ 原为 1~2 条）：左右交替、同侧分层均匀+抖动铺开成放射系；
//!    沿 r 平滑偏移的角度函数（确定性低频正弦），点到中心线距离的
//!    紧支撑浅凹，沟深在头尾平滑归零；实际宽度跨越多个格子；沟内定稿
//!    `DryGround|NO_BUILD`（★ 原为 SoftGround——色差带，可慢行禁建语义不变）、
//!    `water_body_id=None`——不建任何水体/取水点。
//! 3. 扇头与扇缘资源候选锚点（清泉 POI 落点）与扇面房屋候选（≥3 处）。
//!
//! 纯确定性：几何由创世 `GenesisScratch` 共享，不进快照/存档；参数抽样走
//! `relief_rng` 专属局部流（消费序固定：山口横移 → 轴向旋转 → 干沟条数 →
//! 各干沟 [θ₀ → 蜿蜒相位]）。

use crate::config::SimConfig;
use crate::rng::WorldRng;

/// 山口高程帽高度 (m)：扇头圆滑帽区内的平滑鼓包，强化「山口堆」意象。
/// 帽顶径向梯度 ≈ 1.5×帽高/cap_radius ≈ 12° < 20° 软地阈值（不产生禁建带）。
const FAN_CAP_HEIGHT_M: f32 = 5.0;

/// 单条干浅沟规格（局部扇坐标：中心线角 θ_g(r) = θ₀ + amp·sin(r·freq + phase)）。
#[derive(Debug, Clone)]
pub struct FanGully {
    /// 扇头处中心线角（弧度，扇轴对称系）
    pub theta0: f32,
    /// 角向蜿蜒幅度（弧度）
    pub meander_amp: f32,
    /// 蜿蜒空间频率（1/米，确定性低频）
    pub meander_freq: f32,
    /// 蜿蜒相位（弧度）
    pub phase: f32,
    /// 沟深（米，中心线处最大下凹）
    pub depth: f32,
    /// 沟全宽（米）
    pub width: f32,
}

/// 山前冲积扇静态几何（创世 scratch 专用，不进快照/存档）。
#[derive(Debug, Clone)]
pub struct FanGeometry {
    /// 山口锚点（世界坐标，扇头圆滑帽圆心）
    pub mouth_x: f32,
    pub mouth_y: f32,
    /// 扇轴方向单位向量（山口 → 图内）
    pub dir_x: f32,
    pub dir_y: f32,
    /// 扇半角（弧度）
    pub half_angle: f32,
    /// 扇长（米，山口 → 扇缘）
    pub length: f32,
    /// 山口到扇缘总高差（米）
    pub amplitude: f32,
    /// 山口圆滑帽半径（米）：r < 本值时角向窗口全开（规避 atan2 原点奇异）
    pub cap_radius: f32,
    /// 干浅沟（3~4 条放射系）
    pub gullies: Vec<FanGully>,
    /// 扇体噪声阻尼增益（扇内）/ 扇外恢复基准权重
    pub noise_gain: f32,
    /// ★ v1.50.68 粒度分带（第 6 步地表派生消费；plan 从 SimConfig 读入）：
    /// 扇顶砾石带外缘（t = r/L）与扇缘沃土带内缘，扇顶肥力折减系数。
    pub top_band_ratio: f32,
    pub edge_band_ratio: f32,
    pub top_fertility_scale: f32,
    // ── 关键地理锚点（世界坐标）──
    /// 山口锚点（同 mouth，供路网/门禁显式消费）
    pub mouth_anchor: (f32, f32),
    /// 扇缘锚点（扇轴末端，门禁全宽走廊检测终点）
    pub edge_anchor: (f32, f32),
    /// 扇缘清泉候选锚点（2 处，避开浅沟中心线；对应 SpringValley #30/#31）
    pub spring_anchors: Vec<(f32, f32)>,
}

/// smoothstep（3t²−2t³），两端导数为零。
#[inline]
fn smoothstep(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

impl FanGeometry {
    /// 从 `relief_rng` 专属流抽取参数构建冲积扇静态几何。
    /// 消费序固定：山口横移 → 轴向旋转 → 浅沟存在性（第 2 条，上限 ≥2 时）→
    /// 各浅沟 [θ₀ → 蜿蜒相位]。
    pub fn plan(relief_rng: &mut WorldRng, world_size: f32, config: &SimConfig) -> Self {
        // 山口锚在图缘线上（y = −half；微幅横移）。⚠️ 山口不能收进图内：扇心
        // 在图内时南侧（图缘方向）扇体高度骤降 0，会在山口线形成 60°+ 陡墙
        // 并横贯扇面阻断走廊（TB-03-03 实测踩坑）；锚在图缘线上，扇体只向
        // 图内展开，图缘行单侧差分不产生南墙。
        let half = world_size * 0.5;
        let mouth_x = relief_rng.gen_range(-0.10, 0.10) * world_size;
        let mouth_y = -half;
        // 轴向：正北 ± 8° 微旋（扇形仍从山口伸入图内）
        let rot = relief_rng.gen_range(-0.14, 0.14);
        let dir_x = -rot.sin();
        let dir_y = rot.cos();

        let half_angle = config.terrain_fan_half_angle_deg.max(8.0).to_radians();
        let length = (config.terrain_fan_length_ratio.max(0.15) * world_size).min(half * 1.9);
        let amplitude = config.terrain_fan_amplitude.max(4.0);
        let cap_radius = 0.055 * length;

        // 干浅沟 3~4 条（★ v1.50.68 辨识度改善：放射沟系密度提升，原 1~2 条）：
        // 左右交替布沟，同侧分层均匀 + 抖动——同侧相邻沟中心角距
        // ≥ 0.70α×0.30 = 0.21α（r=0.5L 处弧距 ≈31m > 沟宽 22m，互不粘连），
        // 沟带占扇中横向弧宽 ≤38%，干地走廊 ≥55%（06 号 §5.6 规格红线）。
        // θ₀ ∈ [0.10α, 0.70α]：上限加蜿蜒幅度后 ≤0.88α，不越出扇面角窗；
        // 扇缘清泉锚点（±0.62α, 0.93L）低概率与沟带尾部重叠——沟在泉点仅
        // 局部 ≈2m 下凹 + DryGround，取水功能不受影响（设计接受）。
        let gully_count_max = config.terrain_fan_gully_count_max.clamp(3, 4) as usize;
        let mut gullies = Vec::with_capacity(gully_count_max);
        // WorldRng::gen_range 仅实现 f32；均匀掷 3~gully_count_max 后取整。
        let count = relief_rng.gen_range(3.0, gully_count_max as f32 + 0.999) as usize;
        let depth = config.terrain_fan_gully_depth_m.max(0.5);
        let width = config.terrain_fan_gully_width_m.max(8.0);
        let meander_amp = config.terrain_fan_gully_meander_amp_rad.max(0.0);
        let meander_freq = std::f32::consts::TAU * 1.6 / length.max(1.0);
        let per_side = ((count + 1) / 2).max(1) as f32;
        for i in 0..count {
            // 左右交替（i 偶数偏西 θ₀<0、奇数偏东 θ₀>0）；同侧第 k 条在
            // 第 (k+u)/per_side 分层内取样（u∈[0.3,0.7] 抖动），跨扇面
            // [0.10α, 0.70α] 铺开成放射系。
            let side = if i % 2 == 0 { -1.0 } else { 1.0 };
            let k = (i / 2) as f32;
            let u = relief_rng.gen_range(0.3, 0.7);
            let theta0 = side * (0.10 + 0.70 * (k + u) / per_side) * half_angle;
            let phase = relief_rng.gen_range(0.0, std::f32::consts::TAU);
            gullies.push(FanGully {
                theta0,
                meander_amp,
                meander_freq,
                phase,
                depth,
                width,
            });
        }

        let mut geom = Self {
            mouth_x,
            mouth_y,
            dir_x,
            dir_y,
            half_angle,
            length,
            amplitude,
            cap_radius,
            gullies,
            noise_gain: 0.35,
            top_band_ratio: config.terrain_fan_top_band_ratio.clamp(0.1, 0.5),
            edge_band_ratio: config.terrain_fan_edge_band_ratio.clamp(0.5, 0.9),
            top_fertility_scale: config.terrain_fan_top_fertility_scale.clamp(0.3, 1.0),
            mouth_anchor: (mouth_x, mouth_y),
            edge_anchor: (mouth_x + dir_x * length, mouth_y + dir_y * length),
            spring_anchors: Vec::with_capacity(2),
        };

        // 扇缘清泉候选锚点：2 处对置（θ = ±0.62α，r = 0.93L），天然远离浅沟带
        //（浅沟 θ₀ ∈ ±[0.12α,0.45α] 且头尾归零）；换算世界坐标。
        for &s in &[-0.62f32, 0.62] {
            let (px, py) = geom.fan_to_world(0.93 * geom.length, s * geom.half_angle);
            geom.spring_anchors.push((px, py));
        }

        geom
    }

    /// 扇局部坐标 (r, θ) → 世界坐标（真极坐标，与 `world_to_fan` 严格互逆）。
    #[inline]
    pub fn fan_to_world(&self, r: f32, theta: f32) -> (f32, f32) {
        // 扇轴系：沿轴 dir，横向为 dir 左旋 90°
        let (sin_t, cos_t) = theta.sin_cos();
        let along = r * cos_t;
        let lateral = r * sin_t;
        let px = self.mouth_x + self.dir_x * along - self.dir_y * lateral;
        let py = self.mouth_y + self.dir_y * along + self.dir_x * lateral;
        (px, py)
    }

    /// 世界坐标 → 扇局部坐标 (r, θ)（θ 为相对扇轴的偏角，恒有 |θ| ≤ π）。
    #[inline]
    pub fn world_to_fan(&self, wx: f32, wy: f32) -> (f32, f32) {
        let dx = wx - self.mouth_x;
        let dy = wy - self.mouth_y;
        let along = dx * self.dir_x + dy * self.dir_y;
        let lateral = -dx * self.dir_y + dy * self.dir_x;
        let r = (along * along + lateral * lateral).sqrt();
        let theta = lateral.atan2(along);
        (r, theta)
    }

    /// 干浅沟横向距离与纵向包络：给定点 (r, θ)，返回到沟中心线的弧距（米）
    /// 与沟深纵向包络（扇头/扇缘平滑归零）。包络 ≤ 0 表示不在沟的有效区段。
    #[inline]
    pub fn gully_cross_distance(&self, r: f32, theta: f32, g: &FanGully) -> (f32, f32) {
        let t = r / self.length.max(1.0);
        if !(0.0..=1.0).contains(&t) {
            return (f32::MAX, 0.0);
        }
        // 纵向包络：头部 0~0.14L 爬升、尾部 0.86L~1.0L 收敛（沟深头尾归零）
        let env = smoothstep(t / 0.14) * smoothstep((1.0 - t) / 0.14);
        if env <= 0.0 {
            return (f32::MAX, 0.0);
        }
        let theta_g = g.theta0 + g.meander_amp * (r * g.meander_freq + g.phase).sin();
        // 小角弧距（扇坐标 θ 与 r 的乘积即弧长；θ 差已限在 ±π）
        let d_theta = (theta - theta_g).abs();
        let d = d_theta * r.max(1.0);
        (d, env)
    }

    /// 该点干浅沟总下凹深度（米）与是否落入沟带（覆盖意图判据）。
    /// 返回 (depth_total, in_gully)；in_gully = 存在浅沟使 |d| < 半宽 且 env > 0.05。
    pub fn gully_depth_at(&self, wx: f32, wy: f32) -> (f32, bool) {
        let (r, theta) = self.world_to_fan(wx, wy);
        if r > self.length {
            return (0.0, false);
        }
        let mut total = 0.0f32;
        let mut in_gully = false;
        for g in &self.gullies {
            let (d, env) = self.gully_cross_distance(r, theta, g);
            if env <= 0.0 {
                continue;
            }
            let half = g.width * 0.5;
            if d < half {
                // 紧支撑浅凹横截面：(1−u²)²，边缘导数为零、与扇面 C1 衔接
                let u = d / half;
                total += g.depth * env * (1.0 - u * u) * (1.0 - u * u);
                in_gully = true;
            }
        }
        (total, in_gully)
    }

    /// 高程贡献：返回 (z_fan, noise_weight)——扇体高程增量与该点噪声阻尼权重
    /// （扇内阻尼、扇外 0.25 平原基准；调用方叠加 fbm）。
    ///
    /// 角向窗口用「横向弧距」而非纯角度：扇头附近限制最小过渡弧宽
    /// `MIN_ANG_EDGE_M`（否则扇头在 ±α 弧宽只有十几米的侧缘上会产生
    /// 60°+ 侧壁，TB-03-03 实测踩坑；★ v1.50.68 高差提升至 52m 后按
    /// A/tan(19°) 联动放大至 150m）；扇中/扇缘与 nominal ±α 锥一致。
    pub fn elevation_at(&self, wx: f32, wy: f32) -> (f32, f32) {
        // 扇头最小过渡弧宽：保证满幅扇头（A=52m）的侧缘梯度 ≤ tan(19°)——
        // 110m 时侧缘会随高差提升重新逼近硬禁行阈值（TB-03-03 同款踩坑）。
        const MIN_ANG_EDGE_M: f32 = 150.0;
        let (r, theta) = self.world_to_fan(wx, wy);
        if r >= self.length {
            return (0.0, 0.25);
        }
        // 角向窗口：横向弧距 = r·|θ|；扇头圆滑帽内全开（atan2 原点已由 cap 规避）
        let d_lat = if r < self.cap_radius {
            0.0
        } else {
            r * theta.abs()
        };
        let edge = (r * self.half_angle).max(MIN_ANG_EDGE_M);
        let ang = 1.0 - smoothstep(d_lat / edge);
        if ang <= 0.0 {
            return (0.0, 0.25);
        }
        // 径向剖面（★ v1.50.68 双段凸形）：扇头 0~0.2L 陡段（平均坡度 ≈10°，
        // 形成可读的「山口堆」）+ 其后缓段（≤6°，扇面开阔可建）；两段
        // smoothstep 端点导数为零、C1 衔接；radial(0)=1 / radial(1)=0 端点
        // 语义不变。
        let t = r / self.length;
        let s = if t < 0.2 {
            0.32 * smoothstep(t / 0.2)
        } else {
            0.32 + 0.68 * smoothstep((t - 0.2) / 0.8)
        };
        let radial = 1.0 - s;
        // 山口高程帽：扇头圆滑帽区内 +5m 平滑鼓包（等轴视角下强化「山口堆」；
        // 帽顶径向梯度 ≈ 12°（smoothstep 峰值 1.5×）< 20° 软地阈值；随角向
        // 窗口收敛，不产生侧壁）。
        let cap_bump = FAN_CAP_HEIGHT_M * (1.0 - smoothstep(r / self.cap_radius.max(1.0)));
        let z_fan = self.amplitude * radial * ang + cap_bump * ang;
        // 扇体噪声阻尼：随角向/径向包络渐变出扇（扇缘与扇侧平滑过渡到平原权重）
        let weight = 0.25 + (self.noise_gain - 0.25) * ang * radial;
        (z_fan, weight)
    }
}
