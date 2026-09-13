use super::biome::{GeoCell, SurfaceKind, TERRAIN_FLAG_NO_BUILD, TERRAIN_FLAG_NO_WALK};
use super::accents::TerrainAccent;
use crate::config::SimConfig;
use crate::rng::WorldRng;
use crate::spatial::curve::Curve3D;
use crate::spatial::vec3::Vec3;
use serde::{Deserialize, Serialize};

/// 静态地貌特征。只描述几何，不携带资源、税收或行为语义。
/// v1.47.7：删除 T1 的 Ridge/Saddle/Terrace 三特征（含台地压平），仅保留水系地貌特征。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TerrainFeatureKind {
    River,
    RiverBank,
    ShallowFord,
    SpringValley,
}

impl TerrainFeatureKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::River => "River",
            Self::RiverBank => "RiverBank",
            Self::ShallowFord => "ShallowFord",
            Self::SpringValley => "SpringValley",
        }
    }
}

/// 地图模板子特征种类（06 号 §5.2 数据模型，D-B1-2 新增）。
/// 编号即 `TerrainSubFeatureKind as u32`，是稳定 ID 分区
/// `1000 + kind` 的组成部分；与 `TerrainFeatureKind`（0–6）是**两套编号空间**，
/// 混用会直接算错 ID。本阶段仅落地模型，容器恒为空数组，注入自阶段二起。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TerrainSubFeatureKind {
    FootLake = 0,
    RidgeWaterfall = 1,
    ForestedSlope = 2,
    RockyOutcrop = 3,
    OxbowLake = 4,
    RiverCliff = 5,
    RiversideForest = 6,
    GravelBeach = 7,
}

impl TerrainSubFeatureKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::FootLake => "FootLake",
            Self::RidgeWaterfall => "RidgeWaterfall",
            Self::ForestedSlope => "ForestedSlope",
            Self::RockyOutcrop => "RockyOutcrop",
            Self::OxbowLake => "OxbowLake",
            Self::RiverCliff => "RiverCliff",
            Self::RiversideForest => "RiversideForest",
            Self::GravelBeach => "GravelBeach",
        }
    }

    /// 反查枚举值。§5.3 的互斥裁决要求「按 `TerrainSubFeatureKind` 升序」逐个判定，
    /// 故选择器按 `as u32` 从 0 递增扫描，而不是依赖任何表/数组的书写顺序。
    pub const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::FootLake),
            1 => Some(Self::RidgeWaterfall),
            2 => Some(Self::ForestedSlope),
            3 => Some(Self::RockyOutcrop),
            4 => Some(Self::OxbowLake),
            5 => Some(Self::RiverCliff),
            6 => Some(Self::RiversideForest),
            7 => Some(Self::GravelBeach),
            _ => None,
        }
    }

    /// 结构型（改变高程/水体/通行）vs 视觉型（只追加装饰）。
    /// 互斥裁决在同一类内部进行：每类至多取一个，两类可各取一个 ⇒ 每张图最多两个子特征。
    pub const fn is_structural(self) -> bool {
        matches!(
            self,
            Self::FootLake | Self::RidgeWaterfall | Self::OxbowLake | Self::RiverCliff
        )
    }
}

/// 子特征候选：固定盐值 + 首版命中概率（§5.3 表）。
///
/// 概率单位是**基点**（1/10000），不是百分比——避免浮点参与判定。
/// ⚠️ 概率是「该候选自身是否命中」的独立概率，**不是**「该类最终选中它」的概率：
/// 命中后还要按 kind 升序做「首个命中即停」的互斥裁决。
struct SubFeatureCandidate {
    salt: u64,
    prob_bp: u16,
}

/// `TerrainSubFeatureKind` 的变体总数。选择器按 `0..COUNT` 扫描枚举编号，
/// 新增变体时必须同步递增（否则新 kind 永不参与判定）。
const SUB_FEATURE_KIND_COUNT: u32 = 8;

/// 每种 kind 的固定盐值（8 个 ASCII 字符打包为 u64，与 `ACCENT_RNG_SALT` 同一风格）。
/// 一经落地**永不更改**——改盐值等于换图（同种子不再复现旧世界）。
const SALT_FOOT_LAKE: u64 = 0x5342_4646_4F4F_544C; // "SBFFOOTL"
const SALT_RIDGE_WATERFALL: u64 = 0x5342_4652_4447_5746; // "SBFRDGWF"
const SALT_FORESTED_SLOPE: u64 = 0x5342_4646_4F52_534C; // "SBFFORSL"
const SALT_ROCKY_OUTCROP: u64 = 0x5342_4652_4F43_4B4F; // "SBFROCKO"
const SALT_OXBOW_LAKE: u64 = 0x5342_464F_5842_4C4B; // "SBFOXBLK"
const SALT_RIVER_CLIFF: u64 = 0x5342_4652_5643_4C46; // "SBFRVCLF"
const SALT_RIVERSIDE_FOREST: u64 = 0x5342_4652_5646_4F52; // "SBFRVFOR"
const SALT_GRAVEL_BEACH: u64 = 0x5342_4647_5256_4243; // "SBFGRVBC"

/// 取某个 profile 下某个 kind 的候选参数；该组合不在候选池内则返回 `None`。
/// 用穷举 match 而非查表数组，使「是否存在该候选」与代码书写顺序无关。
fn sub_feature_candidate(
    profile: &str,
    kind: TerrainSubFeatureKind,
) -> Option<SubFeatureCandidate> {
    match (profile, kind) {
        // —— T1 山口聚落 ——
        (TERRAIN_PROFILE_MOUNTAIN_PASS, TerrainSubFeatureKind::FootLake) => {
            Some(SubFeatureCandidate { salt: SALT_FOOT_LAKE, prob_bp: 3000 }) // 30%
        }
        (TERRAIN_PROFILE_MOUNTAIN_PASS, TerrainSubFeatureKind::RidgeWaterfall) => {
            Some(SubFeatureCandidate { salt: SALT_RIDGE_WATERFALL, prob_bp: 2500 }) // 25%
        }
        (TERRAIN_PROFILE_MOUNTAIN_PASS, TerrainSubFeatureKind::ForestedSlope) => {
            Some(SubFeatureCandidate { salt: SALT_FORESTED_SLOPE, prob_bp: 4000 }) // 40%
        }
        (TERRAIN_PROFILE_MOUNTAIN_PASS, TerrainSubFeatureKind::RockyOutcrop) => {
            Some(SubFeatureCandidate { salt: SALT_ROCKY_OUTCROP, prob_bp: 3500 }) // 35%
        }
        // —— T2 两岸河谷 ——
        (TERRAIN_PROFILE_RIVER_VALLEY, TerrainSubFeatureKind::OxbowLake) => {
            Some(SubFeatureCandidate { salt: SALT_OXBOW_LAKE, prob_bp: 2000 }) // 20%
        }
        (TERRAIN_PROFILE_RIVER_VALLEY, TerrainSubFeatureKind::RiverCliff) => {
            Some(SubFeatureCandidate { salt: SALT_RIVER_CLIFF, prob_bp: 2500 }) // 25%
        }
        (TERRAIN_PROFILE_RIVER_VALLEY, TerrainSubFeatureKind::RiversideForest) => {
            Some(SubFeatureCandidate { salt: SALT_RIVERSIDE_FOREST, prob_bp: 5000 }) // 50%
        }
        (TERRAIN_PROFILE_RIVER_VALLEY, TerrainSubFeatureKind::GravelBeach) => {
            Some(SubFeatureCandidate { salt: SALT_GRAVEL_BEACH, prob_bp: 4000 }) // 40%
        }
        _ => None,
    }
}

/// 无状态 64 位整数混合（SplitMix64 finalizer）。
///
/// ★ 子特征判定**禁止**使用 `DefaultHasher`、浮点哈希或系统时间——它们在不同
/// 编译目标/标准库版本下不保证结果一致，会直接击穿确定性。本函数只依赖
/// 整数运算与 `wrapping_mul`，跨平台逐位稳定。
fn mix64(mut x: u64) -> u64 {
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

/// 掷 [0, 10000) 的确定性骰子。`salt` 为该 kind 的固定盐值。
fn roll_10000(seed: u64, salt: u64) -> u16 {
    (mix64(seed ^ salt) % 10_000) as u16
}

// ─────────────────────────────────────────────────────────────────────────────
// ★ TB-01-1/TB-01-2 多尺度噪声内核：确定性 2D 梯度噪声 + 3 倍频 fBm。
//
// 只依赖整数运算（`mix64`）与 IEEE-754 精确定义的四则/取整——无 sin/cos/exp、
// 无 `DefaultHasher`、无系统时间、无 fast-math 收缩（Rust 保证浮点不融合），
// x86_64 / ARM64 / wasm32 下同入参逐位一致。
//
// ★ TB-01-2 起由 `generate_with_profile` 消费：fBm 经「高度调制掩码 × 鞍部
// 保护带」叠加进基础高程（严禁绕过掩码全图均匀加噪，根 AGENTS.md §4 坑 #3），
// 主脊 `across` 经 SALT_RIDGE_WARP 低频 1D 噪声域扭曲成蛇形。
// ─────────────────────────────────────────────────────────────────────────────
mod terrain_noise {
    /// 多尺度噪声固定盐值 "TERRNS01"（8 个 ASCII 字符打包 u64，风格同
    /// `ACCENT_RNG_SALT`）。一经落地永不更改——改盐值等于换图（同种子不再复现旧世界）。
    pub(crate) const SALT_TERRAIN_NOISE: u64 = 0x5445_5252_4E53_3031;

    /// 主脊域扭曲固定盐值 "RIDGEWRP"。一经落地永不更改（改盐值等于换图）。
    pub(crate) const SALT_RIDGE_WARP: u64 = 0x5249_4447_4557_5250;

    /// fBm 基准振幅/基准波长（TB-01-5 起为配置的**归一化分母**）：
    /// `generate_with_profile` 按 `配置振幅 / AMPLITUDE_M` 与
    /// `SCALE_BASE_M / 配置波长` 换算增益/频率缩放，默认值 6.0/300.0 时两系数
    /// 恒为 1.0（乘 1.0 逐位精确），输出与常数版完全一致、零漂移。
    pub(crate) const AMPLITUDE_M: f32 = 6.0;
    pub(crate) const SCALE_BASE_M: f32 = 300.0;
    /// 各倍频相对基准的比例：λ → 300 / 108 / 37.5 m，A → 6.0 / 2.58 / 0.87 m，
    /// 均落在 07 号 §7.2 TB-01-1 规格区间（λ 280~360 / 90~130 / 30~45，
    /// A 6~8 / 2.5~3.5 / 0.8~1.2）。
    const WAVELENGTH_RATIOS: [f32; 3] = [1.0, 0.36, 0.125];
    const AMPLITUDE_RATIOS: [f32; 3] = [1.0, 0.43, 0.145];

    /// 8 个离散单位梯度向量（(±1,0)/(0,±1)/(±√2/2,±√2/2)）。
    /// 用编译期常数表替代运行时三角函数：cos/sin 跨平台不保证逐位一致，
    /// 常数表由编译期精确固化且查表零开销；`FRAC_1_SQRT_2` 为精确舍入常数。
    const GRADIENTS_8: [[f32; 2]; 8] = [
        [1.0, 0.0],
        [-1.0, 0.0],
        [0.0, 1.0],
        [0.0, -1.0],
        [std::f32::consts::FRAC_1_SQRT_2, std::f32::consts::FRAC_1_SQRT_2],
        [-std::f32::consts::FRAC_1_SQRT_2, std::f32::consts::FRAC_1_SQRT_2],
        [std::f32::consts::FRAC_1_SQRT_2, -std::f32::consts::FRAC_1_SQRT_2],
        [-std::f32::consts::FRAC_1_SQRT_2, -std::f32::consts::FRAC_1_SQRT_2],
    ];

    /// 梯度选择哈希：格网整数坐标 + 世界种子 + 特征盐值 → [0, 8) 梯度索引。
    /// 负坐标经 `as u64` 符号扩展后参与混合，同样逐位确定。
    #[inline]
    fn hash_gradient2d(ix: i32, iy: i32, seed: u64, salt: u64) -> usize {
        let mixed = super::mix64(
            (ix as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
                ^ (iy as u64).wrapping_mul(0xC6A4_A793_5BD1_E995)
                ^ seed
                ^ salt,
        );
        (mixed & 7) as usize
    }

    /// 单倍频 2D 梯度噪声（Perlin 风格）。输出约 [-1, 1]；格网整点处恒为 0。
    #[inline]
    pub(crate) fn gradient_noise_2d(x: f32, y: f32, seed: u64, salt: u64) -> f32 {
        let x0 = x.floor();
        let y0 = y.floor();
        let fx = x - x0;
        let fy = y - y0;
        // 五次 Hermite 平滑样条 6t^5-15t^4+10t^3：二阶导连续，杜绝格网十字接缝
        //（后续四邻域差分坡度不会在格网边界出现锯齿突变）。
        let sx = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
        let sy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);
        let ix = x0 as i32;
        let iy = y0 as i32;
        let corner = |cx: i32, cy: i32, dx: f32, dy: f32| -> f32 {
            let g = GRADIENTS_8[hash_gradient2d(cx, cy, seed, salt)];
            g[0] * dx + g[1] * dy
        };
        let n00 = corner(ix, iy, fx, fy);
        let n10 = corner(ix + 1, iy, fx - 1.0, fy);
        let n01 = corner(ix, iy + 1, fx, fy - 1.0);
        let n11 = corner(ix + 1, iy + 1, fx - 1.0, fy - 1.0);
        let a = n00 + (n10 - n00) * sx;
        let b = n01 + (n11 - n01) * sx;
        a + (b - a) * sy
    }

    /// 3 倍频分形布朗运动（fBm）：Octave 0 宏观次级丘陵（λ≈300m，A≈6m）+
    /// Octave 1 中观坡面褶皱（λ≈108m，A≈2.6m）+ Octave 2 微观地表细部（λ≈37.5m，A≈0.87m）。
    /// 输出为高程增量（米），纯函数无状态，不消费任何 `WorldRng` 流。
    #[inline]
    pub(crate) fn fbm_terrain_3octaves(x: f32, y: f32, seed: u64) -> f32 {
        let mut sum = 0.0f32;
        for i in 0..3 {
            sum += gradient_noise_2d(
                x / (SCALE_BASE_M * WAVELENGTH_RATIOS[i]),
                y / (SCALE_BASE_M * WAVELENGTH_RATIOS[i]),
                seed,
                SALT_TERRAIN_NOISE,
            ) * (AMPLITUDE_M * AMPLITUDE_RATIOS[i]);
        }
        sum
    }
}

/// ★ TB-01-2 主脊域扭曲与噪声掩码物理常数（07 号 §7.2）。TB-01-5 未把它们
/// 收敛为 `SimConfig` 项，故保持命名常数——改值等于换图，须随
/// `TERRAIN_GENERATOR_VERSION` 递增（TB-01-6）。
/// 主脊域扭曲——双分量蛇形（初版单分量 12m 实测脊线横移仅 ~2.5m，蛇形不可见，
/// 按用户反馈加强）：主弯 λ≈420m 打出整幅 S 弯 + 次摆 λ≈170m 叠加自然摆动。
/// 振幅仅决定两分量的**形状权重**；绝对幅度由 `ridge_warp_peak_scale` 峰值
/// 归一化兜底——梯度噪声典型输出仅 ±0.3 且随种子波动大（实测同参数下
/// 采样峰值 20m~48m 不等），直乘振幅无法保证每个种子都得到满量级蛇形。
/// `across += env × warp_scale × (amp_main·n₁(along·f_main) + amp_sub·n₂(along·f_sub))`。
const RIDGE_WARP_AMP_MAIN_M: f32 = 55.0;
/// 主弯频率（1/米）：0.0024 ↔ 波长 ~420m，全图（764m）恰好呈现一个完整 S 蛇形。
const RIDGE_WARP_FREQ_MAIN: f32 = 0.0024;
/// 次级摆动幅度（米）：中频小摆让蛇形不那么「规整圆弧」。
const RIDGE_WARP_AMP_SUB_M: f32 = 18.0;
/// 次摆频率（1/米）：0.0059 ↔ 波长 ~170m。
const RIDGE_WARP_FREQ_SUB: f32 = 0.0059;
/// 峰值归一化目标：归一化后脊线横向偏移的采样峰值 ≈ 45m（> 0.7× 脊半宽 62m），
/// 蛇形肉眼明确可辨；各种子间只差形状（相位/S 形走势），不差量级。
const RIDGE_WARP_PEAK_TARGET_M: f32 = 45.0;
/// 峰值预采样数：along ∈ ±0.62×world（主脊出图典型跨度）均匀 160 点（≈5.4m 步距）。
const RIDGE_WARP_PEAK_SAMPLES: usize = 160;
/// 扭曲包络参考跨度（× world_size）：包络 = 1−(along/跨度)²，主脊两端出图处收敛到 0。
const RIDGE_WARP_SPAN_FACTOR: f32 = 0.75;
/// 域扭曲 1D 采样固定切片 y（任意常数；两分量取不同切片行去相关，
/// 同盐不同坐标即得独立噪声，无需第二盐值）。
const RIDGE_WARP_SLICE_Y_MAIN: f32 = 137.0;
const RIDGE_WARP_SLICE_Y_SUB: f32 = 911.0;
/// 高度调制掩码权重下限（平原，规格 0.20~0.30 取中值）。
const NOISE_WEIGHT_PLAIN: f32 = 0.25;
/// 高度调制掩码权重上限（山体，规格 0.8~1.0 取中值偏上）。
const NOISE_WEIGHT_MOUNTAIN: f32 = 0.90;
/// 掩码权重过渡带的 h_norm 下沿/跨度：h_norm ≤ 0.30 全平原权重，≥ 0.70 全山体权重。
const NOISE_WEIGHT_HNORM_LOW: f32 = 0.30;
const NOISE_WEIGHT_HNORM_SPAN: f32 = 0.40;
/// 鞍部山口保护带噪声衰减下限（规格：走廊内振幅 ≤ 0.15）。
const SADDLE_NOISE_FLOOR: f32 = 0.15;
/// 鞍部保护带外过渡带宽度（× saddle_width）：走廊外 0.5×saddle_width 内平滑恢复满权重。
const SADDLE_NOISE_RAMP: f32 = 0.5;

/// ★ TB-01-3 支脊几何常数（07 号 §7.2 / 06 号 §3.2）。TB-01-5 已把「总开关 /
/// 振幅比中值 / 延伸长度」收敛为 `SimConfig`（`terrain_branch_ridge_*`），
/// 本组余下常数保持命名常数——改值等于换图，须随 `TERRAIN_GENERATOR_VERSION`
/// 递增（TB-01-6）。
/// 第 2 条支脊出现概率（第 1 条 100% 出现）。
const BRANCH_RIDGE_PROB_SECOND: f32 = 0.40;
/// 支脊与主脊夹角范围（弧度）：规格 φ ≈ 45°~70°。
const BRANCH_PHI_MIN_RAD: f32 = 45.0f32.to_radians();
const BRANCH_PHI_MAX_RAD: f32 = 70.0f32.to_radians();
/// 支脊延伸长度抖动（× `terrain_branch_ridge_length`）：默认 150m → 120~180m（规格区间）。
const BRANCH_LEN_JITTER_MIN: f32 = 0.8;
const BRANCH_LEN_JITTER_MAX: f32 = 1.2;
/// 支脊横截面宽度（× 主脊宽度）取值范围；振幅 = `terrain_branch_ridge_amplitude_ratio`
/// × [0.85, 1.15] 抖动 × 主脊振幅（默认 0.48 → 0.408~0.552，规格 0.40~0.55）。
/// 幅宽比中值 0.48/0.675 → 支脊侧翼最大坡度 ≈ 0.858×0.48/0.675 ≈ 0.61（31°），
/// 扣除噪声掩码后实测 18°~28°，符合「地形引导屏障但不过分陡峭」规格。
const BRANCH_WIDTH_RATIO_MIN: f32 = 0.60;
const BRANCH_WIDTH_RATIO_MAX: f32 = 0.75;
const BRANCH_AMP_JITTER_MIN: f32 = 0.85;
const BRANCH_AMP_JITTER_MAX: f32 = 1.15;
/// 鞍部禁区系数：支脊锚点沿脊距离必须 ≥ 1.5 × saddle_width（规格硬约束），
/// 杜绝支脊扎入山口走廊阻断全图唯一交通通道。
const BRANCH_SADDLE_FORBID_FACTOR: f32 = 1.5;
/// 支脊轴向衰减包络根部爬坡段（× L）：支脊在根部前 30% 长度内由 0 平滑升至
/// 满包络。没有爬坡时支脊在 d∥=0 直接以满振幅叠在主脊侧翼上，交汇处梯度
/// 超硬禁行线（实测根部四分带 72.8°），NO_WALK 斑块把主脊与支脊之间的楔形区
/// 封口，全图通行连通分量碎成 2~4 块（验收要求恒为 1）。支脊自身最大梯度
/// 0.858×A/W ≈ 33.9° 恰在 34° 线下，爬坡消去交汇叠加后支脊自身不再产 NO_WALK。
const BRANCH_ROOT_RAMP: f32 = 0.3;
/// 支脊根部的图内安全边距（米）：锚点沿脊范围收窄到「脊线仍在图内」的区段，
/// 根部距图缘至少此边距；再配合支脊朝图心倾斜（lean = −sign(anchor)），
/// 保证整条支脊（最长 180m + 高斯横截面）不出图——出图后高程采样被钳到
/// 边缘格，支脊会退化成不可见的贴边直线（seed 2 实测踩坑）。
const BRANCH_ROOT_MARGIN_M: f32 = 40.0;

/// 单点原始扭曲位移（米，未归一化）：包络 × 双分量噪声和。
#[inline]
fn ridge_warp_raw(along: f32, world_size: f32, seed: u64) -> f32 {
    let env_n = along / (RIDGE_WARP_SPAN_FACTOR * world_size);
    let envelope = (1.0 - env_n * env_n).clamp(0.0, 1.0);
    envelope
        * (RIDGE_WARP_AMP_MAIN_M
            * terrain_noise::gradient_noise_2d(
                along * RIDGE_WARP_FREQ_MAIN,
                RIDGE_WARP_SLICE_Y_MAIN,
                seed,
                terrain_noise::SALT_RIDGE_WARP,
            )
            + RIDGE_WARP_AMP_SUB_M
                * terrain_noise::gradient_noise_2d(
                    along * RIDGE_WARP_FREQ_SUB,
                    RIDGE_WARP_SLICE_Y_SUB,
                    seed,
                    terrain_noise::SALT_RIDGE_WARP,
                ))
}

/// 扭曲峰值归一化系数：预采样主脊出图跨度（±0.62×world）上的 |warp| 采样峰值，
/// 返回 `target / peak`，使任何种子的脊线蛇形横移都达到 `RIDGE_WARP_PEAK_TARGET_M`
/// 量级（形状仍由种子决定，只锁量级）。纯函数 + 固定采样点序，跨平台逐位确定；
/// peak≈0 时回退 1.0（理论不可达，防御性兜底）。
fn ridge_warp_peak_scale(world_size: f32, seed: u64) -> f32 {
    let span = 0.62 * world_size;
    let mut peak = 0.0f32;
    for i in 0..RIDGE_WARP_PEAK_SAMPLES {
        let a = -span + (i as f32 + 0.5) * (2.0 * span / RIDGE_WARP_PEAK_SAMPLES as f32);
        peak = peak.max(ridge_warp_raw(a, world_size, seed).abs());
    }
    if peak > 1e-3 {
        RIDGE_WARP_PEAK_TARGET_M / peak
    } else {
        1.0
    }
}

/// ★ TB-01-3 单条支脊：从主脊侧翼向外延伸的直线高斯山脊。
/// 根部钉在锚点处**扭曲后**的主脊线上（root 已扣除 `warp(anchor)` 横移），
/// 轴线方向 = 主脊 along 轴按夹角 φ（45°~70°）偏向指定一侧。
/// ★ TB-01-7 起公开并随 [`TerrainMap::branch_ridges`] 暴露给诊断探针
/// （`terrain_probe.rs` 据此计算支脊侧翼坡度与支脊区绕行比）。
#[derive(Debug, Clone)]
pub struct BranchRidge {
    /// 根部世界坐标（锚点在扭曲后主脊线上的落点）。
    pub root_x: f32,
    pub root_y: f32,
    /// 支脊轴线单位方向（世界系）。
    pub dir_x: f32,
    pub dir_y: f32,
    /// 延伸长度（米）/ 高斯横截面宽度（米）/ 振幅（米）。
    pub length: f32,
    pub width: f32,
    pub amplitude: f32,
}

impl BranchRidge {
    /// 支脊高程贡献：高斯横截面 × 沿轴线衰减包络 `(1 − d∥/L)²`（规格公式）
    /// × 根部爬坡（前 `BRANCH_ROOT_RAMP`×L 由 0 平滑升至满幅），
    /// 轴线段 `0 ≤ d∥ ≤ L` 之外恒为 0（根部融入主脊、末梢自然归零）。
    #[inline]
    fn elevation_at(&self, wx: f32, wy: f32) -> f32 {
        let dx = wx - self.root_x;
        let dy = wy - self.root_y;
        let d_par = dx * self.dir_x + dy * self.dir_y;
        if !(0.0..=self.length).contains(&d_par) {
            return 0.0;
        }
        let d_perp = -dx * self.dir_y + dy * self.dir_x;
        let t = d_par / self.length;
        let u = (t / BRANCH_ROOT_RAMP).min(1.0);
        let ramp = u * u * (3.0 - 2.0 * u);
        self.amplitude
            * (-(d_perp / self.width).powi(2)).exp()
            * (1.0 - t)
            * (1.0 - t)
            * ramp
    }
}

/// 支脊锚点允许范围的沿脊半宽：把「扭曲后脊线仍留在图内（边距
/// `BRANCH_ROOT_MARGIN_M`）」的沿脊区段解析出来。脊线点 = a·u_along + c·u_across，
/// 其中 |c| ≤ ridge_offset 振幅上界 + 扭曲峰值；对 x/y 两轴分别解
/// |a·t + c·t⊥| ≤ half − margin（t ∈ {cosθ, sinθ}），取更紧的一条。
fn branch_anchor_bound(world_size: f32, theta_cos: f32, theta_sin: f32) -> f32 {
    let half = world_size / 2.0;
    let c_bound = 0.08 * world_size + RIDGE_WARP_PEAK_TARGET_M;
    let slack = (half - BRANCH_ROOT_MARGIN_M - c_bound).max(0.0);
    let bx = slack / theta_cos.abs().max(1e-3);
    let by = slack / theta_sin.abs().max(1e-3);
    bx.min(by).clamp(0.0, half)
}

/// 鞍部禁区避让下的支脊锚点抽样：把 `gen_range(0,1)` 线性映射到
/// `[−bound, saddle−1.5sw] ∪ [saddle+1.5sw, +bound]` 的允许集（禁区长度先扣再映射），
/// 拒绝式重试会改变 RNG 消费次数，线性映射保持单次消费且分布均匀。
fn sample_branch_anchor(
    rng: &mut WorldRng,
    a_bound: f32,
    saddle_along: f32,
    saddle_width: f32,
) -> f32 {
    let forbid = BRANCH_SADDLE_FORBID_FACTOR * saddle_width;
    let left_end = (saddle_along - forbid).clamp(-a_bound, a_bound);
    let right_start = (saddle_along + forbid).clamp(-a_bound, a_bound);
    let left_len = left_end + a_bound;
    let total = left_len + (a_bound - right_start);
    if total <= 1.0 {
        // 禁区吞没全轴（理论不可达：saddle_width ≤ 0.19×world），防御性兜底取远端。
        return if saddle_along >= 0.0 { -a_bound } else { a_bound };
    }
    let p = rng.gen_range(0.0, 1.0) * total;
    if p < left_len {
        -a_bound + p
    } else {
        right_start + (p - left_len)
    }
}

/// 支脊参数抽样（★ relief_rng 专属消费，顺序固定：侧向硬币 → 每条
/// [存在性(仅第2条) → 锚点 → 夹角 → 长度 → 宽度 → 振幅]）。
/// 第 1 条 100% 出现、第 2 条 40%；两条强制分居主脊相反两侧（不对称山势），
/// 侧向由种子掷硬币决定第 1 条朝向，避免图图同构。
/// 锚点限制在脊线图内区段（`branch_anchor_bound`），且支脊沿脊分量朝图心倾斜
/// （lean = −sign(anchor)），两项共同保证最长支脊的末梢也不出图。
/// ★ TB-01-5：长度/振幅改走配置——长度 = `branch_len_base` × [0.8, 1.2] 抖动、
/// 振幅 = `amp_ratio` × [0.85, 1.15] 抖动 × 主脊振幅；RNG 消费次数与顺序不变。
fn sample_branch_ridges(
    rng: &mut WorldRng,
    world_size: f32,
    seed: u64,
    theta_cos: f32,
    theta_sin: f32,
    ridge_offset: f32,
    saddle_along: f32,
    saddle_width: f32,
    ridge_width: f32,
    ridge_amplitude: f32,
    warp_scale: f32,
    branch_len_base: f32,
    amp_ratio: f32,
) -> Vec<BranchRidge> {
    let a_bound = branch_anchor_bound(world_size, theta_cos, theta_sin);
    let mut out = Vec::with_capacity(2);
    let first_side = if rng.gen_bool(0.5) { 1.0 } else { -1.0 };
    for i in 0..2usize {
        if i == 1 && !rng.gen_bool(BRANCH_RIDGE_PROB_SECOND) {
            break;
        }
        let side = if i == 0 { first_side } else { -first_side };
        let anchor = sample_branch_anchor(rng, a_bound, saddle_along, saddle_width);
        let phi = rng.gen_range(BRANCH_PHI_MIN_RAD, BRANCH_PHI_MAX_RAD);
        let length =
            branch_len_base * rng.gen_range(BRANCH_LEN_JITTER_MIN, BRANCH_LEN_JITTER_MAX);
        let width = rng.gen_range(BRANCH_WIDTH_RATIO_MIN, BRANCH_WIDTH_RATIO_MAX) * ridge_width;
        let amplitude = amp_ratio
            * rng.gen_range(BRANCH_AMP_JITTER_MIN, BRANCH_AMP_JITTER_MAX)
            * ridge_amplitude;
        // 根部钉在锚点处扭曲后的主脊线上：脊线点 = anchor·u_along + (offset − warp)·u_across。
        let warp_anchor = ridge_warp_raw(anchor, world_size, seed) * warp_scale;
        let root_x = anchor * theta_cos + (ridge_offset - warp_anchor) * (-theta_sin);
        let root_y = anchor * theta_sin + (ridge_offset - warp_anchor) * theta_cos;
        // 轴线方向 = lean·u_along·cosφ + side·u_across·sinφ（φ 为与主脊轴的锐夹角）；
        // lean 朝图心倾斜（沿脊分量指向 |along| 减小方向），保证支脊整体留在图内。
        let lean = if anchor >= 0.0 { -1.0 } else { 1.0 };
        let (sin_phi, cos_phi) = phi.sin_cos();
        out.push(BranchRidge {
            root_x,
            root_y,
            dir_x: lean * theta_cos * cos_phi - side * theta_sin * sin_phi,
            dir_y: lean * theta_sin * cos_phi + side * theta_cos * sin_phi,
            length,
            width,
            amplitude,
        });
    }
    out
}

/// 在某一类（结构型 / 视觉型）内按 `TerrainSubFeatureKind` **升序**逐个判定，
/// **首个命中者即选定并立即停止**该类的后续判定（§5.3 互斥裁决）。
///
/// ★ 必须按 kind 编号扫描而非按表顺序：否则「选到哪一个」会随函数书写顺序、
/// 插入位置而变，同种子换图。
fn pick_sub_feature_in_class(
    seed: u64,
    profile: &str,
    structural: bool,
) -> Option<PlannedSubFeature> {
    for code in 0..SUB_FEATURE_KIND_COUNT {
        let kind = TerrainSubFeatureKind::from_code(code)?;
        if kind.is_structural() != structural {
            continue; // 另一类，不在本轮裁决范围内
        }
        // ⚠️ 候选池是 **profile 作用域** 的：某个 kind 不在本 profile 池内时必须
        // `continue` 跳过，不能用 `?` 提前返回 None——否则排在它后面的同类候选
        // 永远没机会判定（T2 的 OxbowLake/RiverCliff 编号 4/5 排在 T1 的
        // FootLake/RidgeWaterfall 0/1 之后，会被直接吞掉导致 T2 恒为空）。
        let cand = match sub_feature_candidate(profile, kind) {
            Some(c) => c,
            None => continue,
        };
        if roll_10000(seed, cand.salt) < cand.prob_bp {
            return Some(PlannedSubFeature {
                kind,
                salt: cand.salt,
                anchor_hint: Vec3::ZERO,
                accepted: false,
            });
        }
        // 未命中：继续判定同类下一个 kind（不重抽、不降级）
    }
    None
}

/// §5.3 第 4 步：规划本张图要注入哪些子特征。
///
/// **纯函数**：只消费 `seed` / `profile` / `enabled`，不读不写 `terrain`，
/// 不消费任何 `WorldRng`（因此不改变既有 `relief_rng` / `hydro_rng` / `accent_rng`
/// 的消费顺序，这是「旧 T1/T2 逐字节不变」的前提）。
///
/// 产出顺序恒为「结构型 → 视觉型」，每类至多一个，故长度 ≤ 2。
/// `enabled=false`（`terrainAccentSubFeatures`）或 profile 不在候选池内时返回空。
pub(crate) fn plan_subfeatures(
    seed: u64,
    profile: &str,
    enabled: bool,
) -> Vec<PlannedSubFeature> {
    if !enabled {
        return Vec::new();
    }
    let mut plan = Vec::with_capacity(2);
    if let Some(s) = pick_sub_feature_in_class(seed, profile, true) {
        plan.push(s);
    }
    if let Some(v) = pick_sub_feature_in_class(seed, profile, false) {
        plan.push(v);
    }
    plan
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainFeature {
    pub id: u32,
    pub kind: TerrainFeatureKind,
    pub vertices: Vec<Vec3>,
    pub elevation: f32,
    pub width: f32,
    pub flags: u16,
}

/// 规划期中间结构：只描述「要注入什么」，不含生成后的 ID 绑定，**不进快照**（§5.2）。
/// 由第 4 步 `plan_subfeatures()` 产出，第 5 步消费。
#[derive(Debug, Clone)]
pub struct PlannedSubFeature {
    pub kind: TerrainSubFeatureKind,
    /// 该 kind 的固定盐值（`sub_feature_salt`），阶段二复用它做放点哈希
    pub salt: u64,
    /// 由 profile 几何推导的候选锚点（山口鞍部 / 主河弯道）。
    /// ★ 第 4 步**禁止读 terrain**（§5.3），故本阶段恒为 `Vec3::ZERO`，
    /// 真实锚点由第 5 步接管后按 profile 几何填充。
    pub anchor_hint: Vec3,
    /// 第 5d 步局部（几何类）判定的结果。阶段一不施加几何，恒为 `false`。
    pub accepted: bool,
}

/// 已注入的子特征（06 号 §5.2 数据模型，D-B1-2 新增）。
/// 只描述「这张图注入了什么」，是快照/调试/存档的稳定事实源，不携带生成过程。
/// 稳定 ID = `1000 + TerrainSubFeatureKind as u32`，一种最多一个实例。
/// 本阶段容器恒为空数组（`#[serde(default)]` 保证旧档加载默认空，`SAVE_FORMAT_VERSION`
/// 不递增）；阶段二注入器填充后必须保持按 `id` 升序且唯一（见
/// `TerrainMap::validate_sub_features_sorted_unique`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainSubFeature {
    pub id: u32,
    pub kind: TerrainSubFeatureKind,
    /// 生成锚点，z 为最终地表高程
    pub anchor: Vec3,
    /// 世界坐标 AABB，仅用于调试/检查
    pub bounds_min: Vec3,
    pub bounds_max: Vec3,
    /// 关联 `TerrainFeature` 的稳定 ID，升序
    pub feature_ids: Vec<u32>,
    /// 关联装饰 ID 闭区间 [start, end]；无装饰则为 None
    pub accent_id_start: Option<u32>,
    pub accent_id_end: Option<u32>,
}

/// 地形生成器版本。改变高程/地表/特征生成算法时必须递增。
/// v1.47.7：2 -> 3（删除 T1 台地压平与 Ridge/Saddle/Terrace 特征生成）
/// v1.50.17：3 -> 4（T1-R 主脊通行力修复：主脊宽度/幅度改走配置并加陡，鞍部加宽；
///           同时移除 `generate_with_profile` 无配置的兼容入口，旧存档按版本门禁拒绝）
/// v1.50.41：4 -> 5（TB-01 多尺度 fBm 噪声与支脊系统：高程场实质性变更，
///           旧路网叠加新地貌会幽灵穿模，旧存档按版本门禁拒绝）
pub const TERRAIN_GENERATOR_VERSION: u32 = 5;
pub const TERRAIN_PROFILE_RANDOM: &str = "random";
pub const TERRAIN_PROFILE_RIVER_VALLEY: &str = "river_valley_v1";
pub const TERRAIN_PROFILE_MOUNTAIN_PASS: &str = "mountain_pass_v1";

/// 纯确定性自然地形生成引擎。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainMap {
    pub grid_width: usize,
    pub grid_height: usize,
    pub world_size: f32,
    pub cells: Vec<GeoCell>,
    pub tilt_angle_rad: f32,
    pub tilt_magnitude: f32,
    pub seed: u64,
    #[serde(default)]
    pub generator_version: u32,
    #[serde(default)]
    pub profile: String,
    #[serde(default)]
    pub features: Vec<TerrainFeature>,
    #[serde(default)]
    pub accents: Vec<TerrainAccent>,
    /// 已注入的子特征（§5.2）。D-B1-2 起为数据模型空容器，阶段二起由注入器填充。
    /// `#[serde(default)]`：旧档缺字段时默认空数组，`SAVE_FORMAT_VERSION` 不递增。
    #[serde(default)]
    pub sub_features: Vec<TerrainSubFeature>,
    /// ★ TB-01-7 诊断字段：本次生成实际抽样的支脊几何（≤2 条；仅山口 profile 且
    /// `terrain_branch_ridge_enabled` 时非空）。仅供 `terrain_probe.rs` 等工具读取，
    /// `#[serde(skip)]` 保证存档 JSON 字节不变（读档按种子重建时会重新填充）。
    #[serde(skip)]
    pub branch_ridges: Vec<BranchRidge>,
    pub hydrology: super::hydrology::Hydrology,
}

impl TerrainMap {
    pub fn new(grid_width: usize, grid_height: usize, world_size: f32) -> Self {
        let width = grid_width.max(1);
        let height = grid_height.max(1);
        let default_cell = GeoCell {
            elevation: 0.0,
            slope_angle_deg: 0.0,
            surface_kind: SurfaceKind::DryGround,
            natural_fertility: 1.0,
            water_body_id: None,
            feature_flags: 0,
        };
        Self {
            grid_width: width,
            grid_height: height,
            world_size,
            cells: vec![default_cell; width * height],
            tilt_angle_rad: 0.0,
            tilt_magnitude: 60.0,
            seed: 0,
            generator_version: TERRAIN_GENERATOR_VERSION,
            profile: TERRAIN_PROFILE_MOUNTAIN_PASS.to_string(),
            features: Vec::new(),
            accents: Vec::new(),
            sub_features: Vec::new(),
            branch_ridges: Vec::new(),
            hydrology: Default::default(),
        }
    }

    /// 生成 T0 基础高程与 T1 山脊/山口连续起伏地貌（v1.47.7 起不再生成台地/高台）。
    ///
    /// ★ T1-R 主脊通行力修复：主脊宽度/幅度改为消费 `SimConfig`（原先硬编码
    /// `0.16~0.23 × world_size` 与 `24~34m`，最大梯度仅 6.7~13.4°，全图无格越过
    /// `terrain_max_walk_slope`，山口不产生任何通行约束）。详见
    /// `docs/plan/tech/06-terrain-templates.md` §9.3.1。
    ///
    /// ★ TB-01-2：原 2 组平滑正弦波谐波由「高度调制掩码 × 鞍部保护带」调制的
    /// 3 倍频 fBm 取代（平原权重 0.25、山体 0.90、山口走廊 ≤0.15）；主脊
    /// `across` 施加低频域扭曲（幅度 12m、λ 200m、两端包络收敛）。
    /// 确定性：噪声/扭曲只消费世界种子 + 固定盐值（`terrain_noise` 模块），
    /// 不占用任何 `WorldRng` 流；`relief_rng` 消费顺序 = T1-R 四连抽后追加
    /// 支脊抽样（TB-01-3：侧向硬币 → 锚点/夹角/长度/宽度/振幅，第 2 条先掷 40% 存在性）。
    pub fn generate_with_profile(&mut self, seed: u64, profile: &str, config: &SimConfig) {
        self.seed = seed;
        self.generator_version = TERRAIN_GENERATOR_VERSION;
        self.profile = if profile.is_empty() || profile == TERRAIN_PROFILE_RANDOM {
            if (seed ^ 0x5052_4F46_494C_4531) % 2 == 0 {
                TERRAIN_PROFILE_MOUNTAIN_PASS.to_string()
            } else {
                TERRAIN_PROFILE_RIVER_VALLEY.to_string()
            }
        } else {
            profile.to_string()
        };
        self.features.clear();
        self.sub_features.clear();

        let mut rng = WorldRng::new(seed);
        let mut relief_rng = WorldRng::new(seed ^ 0x5245_4c49_4546_5431);
        let half_size = self.world_size / 2.0;
        self.tilt_angle_rad = rng.gen_range(0.0, std::f32::consts::TAU);
        self.tilt_magnitude = rng.gen_range(54.0, 66.0);
        let tilt_cos = self.tilt_angle_rad.cos();
        let tilt_sin = self.tilt_angle_rad.sin();
        let theta = relief_rng.gen_range(-0.18, 0.18);
        let theta_cos = theta.cos();
        let theta_sin = theta.sin();
        let ridge_offset = relief_rng.gen_range(-0.08, 0.08) * self.world_size;
        // ★ T1-R：主脊宽度/幅度走配置（禁止散落字面量）。通行力约束：
        //   高斯主脊最大梯度 ≈ 0.858 × amplitude / width，必须显著大于
        //   tan(terrain_max_walk_slope)，否则主脊上任何路线都合法、山口形同虚设。
        let ridge_width = config.terrain_pass_ridge_width.max(8.0);
        let ridge_amplitude = config.terrain_pass_ridge_amplitude.max(4.0);
        let saddle_along = relief_rng.gen_range(-0.12, 0.12) * self.world_size;
        // 鞍部过渡带的沿脊梯度 ≈ 0.9 × amplitude × 0.858 / saddle_width；主脊变陡后
        // 鞍部若过窄会把山口本身夹成不可通行，故下限从 0.10 放宽到 0.14。
        let saddle_width = relief_rng.gen_range(0.14, 0.19) * self.world_size;

        let cell_step_x = self.world_size / self.grid_width.saturating_sub(1).max(1) as f32;
        let cell_step_y = self.world_size / self.grid_height.saturating_sub(1).max(1) as f32;
        let mut raw = vec![0.0f32; self.grid_width * self.grid_height];
        // ★ TB-01-2：主脊域扭曲峰值归一化系数（仅山口 profile 消费；0 = 不扭曲）。
        let warp_scale = if self.profile == TERRAIN_PROFILE_MOUNTAIN_PASS {
            ridge_warp_peak_scale(self.world_size, seed)
        } else {
            0.0
        };
        // ★ TB-01-3：不对称支脊 1~2 条（仅山口 profile；relief_rng 专属流抽样，
        //   侧向硬币 + 鞍部禁区 ≥1.5×saddle_width 线性映射，见 sample_branch_ridges）。
        //   ★ TB-01-5：总开关/长度/振幅比走配置；开关关闭时 relief_rng 消费序
        //   在 saddle_width 后即止（同种子地形不同，但各自确定性不破坏）。
        let branch_ridges = if self.profile == TERRAIN_PROFILE_MOUNTAIN_PASS
            && config.terrain_branch_ridge_enabled
        {
            sample_branch_ridges(
                &mut relief_rng,
                self.world_size,
                seed,
                theta_cos,
                theta_sin,
                ridge_offset,
                saddle_along,
                saddle_width,
                ridge_width,
                ridge_amplitude,
                warp_scale,
                // 防御性下限：SimConfig::default() 为零值兑底，避免零长度/零振幅支脊。
                config.terrain_branch_ridge_length.max(1.0),
                config.terrain_branch_ridge_amplitude_ratio.max(0.1),
            )
        } else {
            Vec::new()
        };
        // ★ TB-01-7：支脊几何暴露给诊断探针（serde(skip)，不影响存档）。
        self.branch_ridges = branch_ridges.clone();
        // ★ TB-01-5：fBm 振幅/波长走配置。输出对两者均线性——坐标按
        //   SCALE_BASE_M/配置波长 预缩放（各倍频波长同比例缩放），输出按
        //   配置振幅/AMPLITUDE_M 增益；默认 300.0/6.0 时两系数恒为 1.0
        //   （×1.0 逐位精确），与常数版输出零漂移。
        let noise_freq_k = terrain_noise::SCALE_BASE_M / config.terrain_noise_scale_base.max(1.0);
        let noise_amp_k = config.terrain_noise_amplitude.max(0.0) / terrain_noise::AMPLITUDE_M;

        for gy in 0..self.grid_height {
            for gx in 0..self.grid_width {
                let wx = if self.grid_width <= 1 {
                    0.0
                } else {
                    (gx as f32 / (self.grid_width - 1) as f32) * self.world_size - half_size
                };
                let wy = if self.grid_height <= 1 {
                    0.0
                } else {
                    (gy as f32 / (self.grid_height - 1) as f32) * self.world_size - half_size
                };
                let proj = (wx * tilt_cos + wy * tilt_sin) / half_size.max(1.0);
                let base_tilt = proj * (self.tilt_magnitude * 0.5);
                // ★ TB-01-2：正弦波谐波（wave_large/wave_medium）由经掩码调制的
                // 3 倍频 fBm 取代（见循环尾部），基础高程只剩整体倾斜。
                let mut elev = base_tilt;
                let mut saddle_noise_damp = 1.0f32;

                if self.profile == TERRAIN_PROFILE_MOUNTAIN_PASS {
                    // v1.47.7：删除平顶高台（台地压平）。只保留主脊与山口鞍部的连续起伏地貌。
                    // ★ TB-01-2 主脊域扭曲：沿脊轴的低频 1D 噪声横向推动 across，
                    //   使笔直主脊呈明显蛇形（双分量：主弯 S 形 + 次级摆动）；
                    //   包络 (1−(along/0.75·world)²) 让主脊两端（出图处）扭曲
                    //   自然收敛，杜绝脊线斜刺出界。
                    let along = wx * theta_cos + wy * theta_sin;
                    let warp = ridge_warp_raw(along, self.world_size, seed) * warp_scale;
                    let across = -wx * theta_sin + wy * theta_cos - ridge_offset + warp;
                    let ridge = ridge_amplitude * (-(across / ridge_width.max(1.0)).powi(2)).exp();
                    let saddle = (-((along - saddle_along) / saddle_width.max(1.0)).powi(2)).exp();
                    elev += ridge - ridge * 0.90 * saddle;
                    // ★ TB-01-2 鞍部山口保护带：走廊内（|Δalong| ≤ saddle_width）噪声
                    //   振幅压到 15%，走廊外 0.5×saddle_width 内平滑恢复满权重，
                    //   保证全图唯一交通通道平缓无坑洼。
                    let d_corr = ((along - saddle_along).abs() - saddle_width)
                        / (SADDLE_NOISE_RAMP * saddle_width);
                    let t = d_corr.clamp(0.0, 1.0);
                    saddle_noise_damp =
                        SADDLE_NOISE_FLOOR + (1.0 - SADDLE_NOISE_FLOOR) * (t * t * (3.0 - 2.0 * t));
                    // ★ TB-01-3 支脊叠加：高斯横截面 × (1−d∥/L)² 轴向衰减包络，
                    //   锚点距鞍部 ≥ 1.5×saddle_width，山口走廊不受支脊坡度侵扰。
                    for br in &branch_ridges {
                        elev += br.elevation_at(wx, wy);
                    }
                }

                // ★ TB-01-2 高度调制掩码：h_norm ≥ 0.70（山体）权重升至满格、
                //   ≤ 0.30（平原生活区）衰减到 0.25——高频噪声在低平地带近乎静默，
                //   严禁全图均匀加噪（根 AGENTS.md §4 坑 #3：平原 ±2m 噪声即产生
                //   大面积 NO_BUILD 红格）。
                let h_norm = ((elev + 45.0) / 100.0).clamp(0.0, 1.0);
                let w_t = ((h_norm - NOISE_WEIGHT_HNORM_LOW) / NOISE_WEIGHT_HNORM_SPAN).clamp(0.0, 1.0);
                let weight = NOISE_WEIGHT_PLAIN
                    + (NOISE_WEIGHT_MOUNTAIN - NOISE_WEIGHT_PLAIN)
                        * (w_t * w_t * w_t * (w_t * (w_t * 6.0 - 15.0) + 10.0));
                elev += terrain_noise::fbm_terrain_3octaves(wx * noise_freq_k, wy * noise_freq_k, seed)
                    * noise_amp_k
                    * weight
                    * saddle_noise_damp;
                raw[gy * self.grid_width + gx] = elev;
            }
        }

        // ★ TB-01-4 坡度重算与地表属性映射（14号文 §9.2 步骤 2~5）：在复合高程场
        //   （倾斜 + fBm + 主脊/支脊）上统一重算——4 邻域中心差分，图边界自动退化为
        //   单侧差分（`saturating_sub` / `min` 钳位，杜绝贴边通行误判）；阈值即物理
        //   契约：≥34° RockFace+NO_WALK、20~34° SoftGround、<20° DryGround、
        //   ≥18° NO_BUILD（阈值来源 terrainMaxWalkSlope=30 / terrainMaxBuildSlope=16
        //   之上再留工程余量）。新支脊/噪声接入高程场后无需改动本段，自然生效。
        for gy in 0..self.grid_height {
            for gx in 0..self.grid_width {
                let idx = gy * self.grid_width + gx;
                let left = raw[gy * self.grid_width + gx.saturating_sub(1)];
                let right = raw[gy * self.grid_width + (gx + 1).min(self.grid_width - 1)];
                let up = raw[gy.saturating_sub(1) * self.grid_width + gx];
                let down = raw[(gy + 1).min(self.grid_height - 1) * self.grid_width + gx];
                let dx = if self.grid_width <= 1 { 0.0 } else { (right - left) / (((gx + 1).min(self.grid_width - 1) - gx.saturating_sub(1)) as f32 * cell_step_x.max(0.001)) };
                let dy = if self.grid_height <= 1 { 0.0 } else { (down - up) / (((gy + 1).min(self.grid_height - 1) - gy.saturating_sub(1)) as f32 * cell_step_y.max(0.001)) };
                let slope = (dx * dx + dy * dy).sqrt().atan().to_degrees();
                let normalized_height = ((raw[idx] + 45.0) / 100.0).clamp(0.0, 1.0);
                let fertility = (0.92 - slope / 70.0 - normalized_height * 0.18).clamp(0.1, 1.0);
                let surface_kind = if slope >= 34.0 { SurfaceKind::RockFace } else if slope >= 20.0 { SurfaceKind::SoftGround } else { SurfaceKind::DryGround };
                let mut flags = 0u16;
                if slope >= 18.0 { flags |= TERRAIN_FLAG_NO_BUILD; }
                if surface_kind.is_hard_blocked() { flags |= TERRAIN_FLAG_NO_WALK; }
                self.cells[idx] = GeoCell {
                    elevation: raw[idx],
                    slope_angle_deg: slope,
                    surface_kind,
                    natural_fertility: fertility,
                    water_body_id: None,
                    feature_flags: flags,
                };
            }
        }
    }

    #[inline]
    pub fn sample_elevation(&self, wx: f32, wy: f32) -> f32 {
        let (x, y) = self.grid_coords(wx, wy);
        let (ix, iy) = (x.floor() as usize, y.floor() as usize);
        let (jx, jy) = ((ix + 1).min(self.grid_width - 1), (iy + 1).min(self.grid_height - 1));
        let (u, v) = (x - ix as f32, y - iy as f32);
        let a = self.cells[iy * self.grid_width + ix].elevation * (1.0-u) + self.cells[iy * self.grid_width+jx].elevation*u;
        let b = self.cells[jy * self.grid_width + ix].elevation * (1.0-u) + self.cells[jy * self.grid_width+jx].elevation*u;
        a*(1.0-v)+b*v
    }

    #[inline]
    pub fn sample_cell(&self, wx: f32, wy: f32) -> &GeoCell {
        let (gx, gy) = self.grid_index(wx, wy);
        &self.cells[gy * self.grid_width + gx]
    }

    #[inline]
    pub fn grid_index(&self, wx: f32, wy: f32) -> (usize, usize) {
        let (x,y) = self.grid_coords(wx, wy);
        (x.round() as usize, y.round() as usize)
    }

    pub fn grid_coords(&self, x: f32, y: f32) -> (f32, f32) {
        (((x/self.world_size+0.5)*(self.grid_width-1) as f32).clamp(0.0,(self.grid_width-1) as f32),
         ((y/self.world_size+0.5)*(self.grid_height-1) as f32).clamp(0.0,(self.grid_height-1) as f32))
    }
    pub fn grid_pos(&self, x: usize, y: usize) -> Vec3 {
        Vec3::new((x as f32/(self.grid_width-1).max(1) as f32-0.5)*self.world_size,
                  (y as f32/(self.grid_height-1).max(1) as f32-0.5)*self.world_size,
                  self.cells[y*self.grid_width+x].elevation)
    }

    /// 对整条三次贝塞尔曲线做自适应密度采样；用于 T0 路网合法性门禁。
    pub fn validate_curve(&self, curve: &Curve3D, corridor_width: f32, max_walk_slope: f32) -> bool {
        super::corridor::validate_curve(self, curve, corridor_width, max_walk_slope, None)
    }

    /// §5.2 稳定 ID 契约：`sub_features` 必须按 `id` **严格升序**且 **ID 唯一**
    /// （稳定 ID 禁止用 `Vec::len()` / HashMap 遍历顺序 / 候选失败次数推导）。
    /// 本阶段容器恒为空数组，校验平凡通过；阶段二注入器每次写入后、
    /// 以及存档加载路径都必须调用，防止同种子因集合顺序漂移而换图。
    pub fn validate_sub_features_sorted_unique(&self) -> Result<(), String> {
        let mut prev: Option<u32> = None;
        for sf in &self.sub_features {
            if let Some(p) = prev {
                if sf.id <= p {
                    return Err(format!(
                        "sub_features 未按 id 严格升序存储或 ID 重复：id={}，前一个 id={}",
                        sf.id, p
                    ));
                }
            }
            prev = Some(sf.id);
        }
        Ok(())
    }
}
