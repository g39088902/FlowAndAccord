use super::biome::{GeoCell, SurfaceKind, TERRAIN_FLAG_NO_BUILD, TERRAIN_FLAG_NO_WALK};
use super::accents::TerrainAccent;
use crate::config::SimConfig;
use crate::rng::WorldRng;
use crate::spatial::curve::Curve3D;
use crate::spatial::vec3::Vec3;
use serde::{Deserialize, Serialize};

/// 静态地貌特征。只描述几何，不携带资源、税收或行为语义。
/// v1.47.7：删除 T1 的 Ridge/Saddle/Terrace 三特征（含台地压平），仅保留水系地貌特征。
/// ★ TB-03：末尾追加 `WaterBody`（静水闭合水体，盆地泉池/湖畔大湖），不移动旧枚举码位。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TerrainFeatureKind {
    River,
    RiverBank,
    ShallowFord,
    SpringValley,
    WaterBody,
}

impl TerrainFeatureKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::River => "River",
            Self::RiverBank => "RiverBank",
            Self::ShallowFord => "ShallowFord",
            Self::SpringValley => "SpringValley",
            Self::WaterBody => "WaterBody",
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
/// ★ S7-03 起 `accents.rs` 草甸斑块哈希共享同一 finalizer（pub(crate) 复用，
/// 不复制第二份实现）。
pub(crate) fn mix64(mut x: u64) -> u64 {
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
/// 高斯轮廓的峰值梯度系数：exp(-(d/A)²/(2W²)) 轮廓在 d=±W 处导数最大，
/// 值 = A/W·exp(-0.5)。半坡主坡（S7-04）以「目标峰值坡度」反解宽度时消费。
const GAUSS_PEAK_GRADIENT: f32 = 0.606_530_66; // = exp(-0.5)，std::f32::consts 无 FRAC_1_SQRT_E
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

/// ★ STAGE2-5 创世覆盖（降级策略 → 生成器的唯一通道）。默认值 = 无覆盖，
/// 输出与无参路径逐位一致。
#[derive(Debug, Clone, Default)]
pub struct GenesisOverrides {
    /// 结构子特征禁用掩码（`1 << TerrainSubFeatureKind as u32`）。
    pub disabled_subfeature_mask: u32,
}

/// §5.3 创世流水线各阶段间传递的临时数据（★ STAGE2-3）。
///
/// 全部为单次创世内的过程 scratch：不进快照、不进存档、不参与 tick。
/// `pub(super)`：第 3 步实现在 `hydrology.rs`（同为 `geo` 子模块），需跨文件访问。
pub(super) struct GenesisScratch {
    /// T2 主河静态几何：编排器在第 2 步前规划（`plan_river_geometry`，hydro_rng
    /// **独立流**单次 phase 抽取，规划时点不影响任何共享 RNG 消费序）；第 2 步铺
    /// 河谷低丘、第 3 步施加水面共用同一份，保证两段几何逐比特一致（STAGE2-2 契约）。
    pub(super) river_geometry: Option<super::hydrology::RiverGeometry>,
    /// ★ S7-06 河谷聚落谷地几何：第 2 步 settlement 分支抽样构建（relief_rng
    /// 局部流），第 6 步地表派生（谷底肥力 0.95 / 陡壁 RockFace 判定）共用同一份。
    pub(super) valley_geometry: Option<ValleyGeometry>,
    /// ★ TB-02 台地聚落静态几何：第 2 步 plateau 分支构建，第 10 步路网接入消费。
    pub(super) plateau_geometry: Option<super::plateau::PlateauGeometry>,
    /// ★ TB-03 冲积扇静态几何：第 2 步构建（扇面高程 + 干沟 + 锚点），第 6 步
    /// 地表派生（干沟 `SoftGround|NO_BUILD` 覆盖意图）与第 10 步门禁消费。
    pub(super) fan_geometry: Option<super::alluvial_fan::FanGeometry>,
    /// ★ TB-03 盆地静态几何：第 2 步构建（盆体高程 + 出口），第 6 步地表派生消费。
    pub(super) basin_geometry: Option<super::basin::BasinGeometry>,
    /// ★ TB-03 湖畔盆地静态几何：第 2 步构建（湖盆高程 + 环岸），第 3 步静水
    /// （大湖 `StaticWaterPlan`）与第 6 步安全退距覆盖意图消费。
    pub(super) lake_geometry: Option<super::lakeside::LakeGeometry>,
    /// 草原泉溪洼地软地凹圈掩码（第 2 步标记 → 第 6 步地表派生消费）。
    pub(super) soft_ring: Vec<bool>,
}

impl Default for GenesisScratch {
    fn default() -> Self {
        Self {
            river_geometry: None,
            valley_geometry: None,
            plateau_geometry: None,
            fan_geometry: None,
            basin_geometry: None,
            lake_geometry: None,
            soft_ring: Vec::new(),
        }
    }
}

/// §5.3 第 5 步单个子特征的几何管线工作区（★ STAGE2-3 接口就位）。
/// 5a 产出高程快照 → 5b 施加几何 → 5c 写临时坡度 → 5d 判定失败时按快照整块回滚。
#[derive(Debug, Default)]
struct SubFeatureWorkspace {
    /// AABB 格索引闭区间（行主序）；空工作区以 `elevation_snapshot` 为空表达。
    bbox_min: (usize, usize),
    bbox_max: (usize, usize),
    /// 5a：AABB 内**原**高程快照（回滚真相源；施加写格子前必须先有本快照，
    /// 严禁边遍历边读回已改写的邻格）。
    elevation_snapshot: Vec<f32>,
    /// 5c：AABB 内临时坡度（**判定专用**，严禁提交 `cells.slope_angle_deg`——
    /// 第 6 步才是全图唯一坡度定稿点）。
    scratch_slopes: Vec<f32>,
}

impl SubFeatureWorkspace {
    fn is_empty(&self) -> bool {
        self.elevation_snapshot.is_empty()
    }
}

/// §5.3 第 0 步 `resolve_profile`：解析 profile。空串 / `random` 按种子整数判别
/// 分派候选池。纯整数运算，**不消费任何 `WorldRng`**（逻辑自原 `generate_with_profile`
/// 头部逐字抽出）。
fn resolve_profile(seed: u64, profile: &str) -> String {
    if profile.is_empty() || profile == TERRAIN_PROFILE_RANDOM {
        // ★ TB-03-13：random 候选池 6→9（冲积扇/盆地/湖畔盆地通过各自
        //   M1 物理门禁与 60 种子矩阵后准入，各 ~11.1% 均衡入列；
        //   `flat_baseline` 永不入列）。9 路判别；显式 profile 的输出不受影响。
        const RANDOM_CANDIDATES: [&str; 9] = [
            TERRAIN_PROFILE_MOUNTAIN_PASS,
            TERRAIN_PROFILE_RIVER_VALLEY,
            TERRAIN_PROFILE_GRASSLAND_PLAIN,
            TERRAIN_PROFILE_HILLSIDE_WOODLAND,
            TERRAIN_PROFILE_RIVER_VALLEY_SETTLEMENT,
            TERRAIN_PROFILE_PLATEAU_SETTLEMENT,
            TERRAIN_PROFILE_ALLUVIAL_FAN,
            TERRAIN_PROFILE_BASIN_OASIS,
            TERRAIN_PROFILE_LAKESIDE_BASIN,
        ];
        RANDOM_CANDIDATES[((seed ^ 0x5052_4F46_494C_4531) % 9) as usize].to_string()
    } else {
        profile.to_string()
    }
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
/// v1.50.41（mac）/ v1.50.40（master）：4 -> 5（两条分支各自递增后于本合并汇合——
///           mac：TB-01 多尺度 fBm 噪声与支脊系统；master：S7-02 新增 `grassland_plain_v1`
///           低幅高程场/残丘/泉溪洼地分支。旧存档按版本门禁拒绝）
/// v1.50.46：5 -> 6（S7-04 新增 `hillside_woodland_v1` 不对称缓坡山体分支；
///           既有 T1/T2/草原路径逐位不变，递增遵循 S7-02 先例——新分支入库即换版）
/// v1.50.48：6 -> 7（两条分支各自递增撞号后于本合并汇合——test 线：S7-06
///           新增 `river_valley_settlement_v1` 深切河谷分支（冲积谷底 + 连续
///           陡壁 RockFace 硬禁行 + 台地缓穹）；master 线：STAGE2-7 新增
///           `flat_baseline` 显式诊断/降级基线分支（倾斜-only 平地，无 fBm/
///           山脊/洼地/水系）。既有 T1/T2/草原/半坡路径各自逐位不变，
///           递增遵循 S7-02 先例——新分支入库即换版）
/// v1.50.49：7 -> 8（S7-07 settlement 分支接入主河水系——谷轴河道下凹 + 岸带/
///           河阶/2 浅滩走廊 + WaterPool #1 取水点；第 6 步派生跳过水系写定
///           地表。settlement 同种子地形变化；既有 4 profile 路径逐位不变）
/// v1.50.54：8 -> 9（TB-02 新增 `plateau_settlement_v1` 台地聚落分支——平缓且
///           可建的台面 + 连续陡峭台缘 RockFace 硬禁行 + 两个可通过道路走廊的
///           缓坡入口 + 坡脚取水点生活水源；既有 5 profile 路径逐位不变）
/// v1.50.55：9 -> 10（TB-03 新增 `alluvial_fan_v1` 冲积扇 / `basin_oasis_v1` 盆地
///           / `lakeside_basin_v1` 湖畔盆地三个分支 + `TerrainFeatureKind::WaterBody`
///           静水水体特征；三个新 profile 各自自包含、互不影响，既有 6 profile
///           路径逐位不变。递增遵循「新分支入库即换版」先例）
pub const TERRAIN_GENERATOR_VERSION: u32 = 10;
pub const TERRAIN_PROFILE_RANDOM: &str = "random";
pub const TERRAIN_PROFILE_RIVER_VALLEY: &str = "river_valley_v1";
pub const TERRAIN_PROFILE_MOUNTAIN_PASS: &str = "mountain_pass_v1";
/// 阶段七插队模板：平地草原（06 号 §4.1 · STAGE-07-TODO S7-02）。
/// 低幅起伏平原 + 孤立残丘 + 泉溪洼地（清泉 POI 由生态层布点，洼地落 SoftGround 凹圈）。
pub const TERRAIN_PROFILE_GRASSLAND_PLAIN: &str = "grassland_plain_v1";
/// 阶段七插队模板：半坡林地（06 号 §4.2 · STAGE-07-TODO S7-04）。
/// 单侧不对称缓坡山体——迎风坡宽缓（目标峰值 8°~12°）、背风坡较陡
/// （目标峰值 23°~23.2°，叠加 fBm/倾斜后全域 max_slope 落在探针门禁
/// 22°~28.5° 窗口），**全域坡度严格 <30° 不设硬禁行**；脊线经 crest_shift
/// 推离图心，图心落在迎风坡脚平缓带（初始营地可建）；坡脚泉溪洼地复用
/// S7-02 洼地语义（SoftGround 凹圈）。
/// 林地是装饰层事实（S7-05 梯级散布），本分支不写任何林地地表。
pub const TERRAIN_PROFILE_HILLSIDE_WOODLAND: &str = "hillside_woodland_v1";
/// 阶段七插队模板：河谷聚落（06 号 §4.3 · STAGE-07-TODO S7-06）。
/// 南北走向深切河谷——中央连续冲积谷底（宽 160~190m、高程平缓、基础肥力 0.95）
/// + 两侧连续陡壁（smoothstep 剖面，峰坡 39°~41° ≥34° 自动派生 `RockFace` +
/// `TERRAIN_FLAG_NO_WALK` 硬禁行）+ 壁顶台地缓穹（沿谷轴向图缘二次收敛，谷口
/// 坡度 ≤22° 保持全图通行连通）。谷底保留 ≥55m 干燥平坦河阶带（S7-07 主河
/// 下凹与浅滩走廊在此带内局部写入）；谷底规划两处生活水源锚点（清泉 POI 由生态层布点）。
pub const TERRAIN_PROFILE_RIVER_VALLEY_SETTLEMENT: &str = "river_valley_settlement_v1";
/// TB-02 模板：台地聚落（06 号 §5.6 / 07 号 §7.4）。
/// 圆角矩形台面（平缓、起伏 <16°、可建 ≥3 处房屋）+ 真实阻路陡峭台缘（B=0.6H，
/// 峰坡 ~68° ≥34° 派生 RockFace + NO_WALK）+ 两个可通过道路走廊的缓坡入口（B=4.0H，
/// 峰坡 ~20.6° ≤30° 可行走、核心宽 ≥32m）+ 坡脚两处生活水源锚点。
pub const TERRAIN_PROFILE_PLATEAU_SETTLEMENT: &str = "plateau_settlement_v1";
/// ★ TB-03 模板：山前冲积扇（07 号 §7.4 / TB-03-IMPLEMENTATION-PLAN §5）。
/// 山口锚点到扇缘的连续缓坡（smoothstep 径向剖面 + 角向窗口）+ 1~2 条真实干浅沟
/// （`SoftGround|NO_BUILD`、无水面、可慢行）+ 至少一条山口→扇缘全宽干地走廊；
/// 水源沿用独立清泉 POI（扇外缘合法干地落位，无静水水体）。
pub const TERRAIN_PROFILE_ALLUVIAL_FAN: &str = "alluvial_fan_v1";
/// ★ TB-03 模板：盆地（TB-03-IMPLEMENTATION-PLAN §4）。
/// 大尺度连续椭圆盆地围绕中心平缓生活带组织——超宽盆底可建生活带 + 环抱高山
/// 山壁天然屏障 + 至少一个明确陆路出口垭口走廊。
pub const TERRAIN_PROFILE_BASIN_OASIS: &str = "basin_oasis_v1";
/// ★ TB-03 模板：湖畔盆地（TB-03-IMPLEMENTATION-PLAN §6 独立规格）。
/// 中心静水湖占据显著面积（半轴 0.10~0.16×world）迫使路线沿岸绕行——连续环湖
/// 干岸（安全退距外可建）+ 两个分离陆路出口 + 两个分离湖岸取水点共享同一淡水池。
pub const TERRAIN_PROFILE_LAKESIDE_BASIN: &str = "lakeside_basin_v1";

/// ★ TB-03 静水新模板判定：湖畔盆地的水体 #1 是 `WaterBody` 特征
/// （非 River），其水资源预算走「配置一次建立总池」路径（不按岸点数乘算）。
pub fn is_static_water_profile(profile: &str) -> bool {
    profile == TERRAIN_PROFILE_LAKESIDE_BASIN
}

/// ★ TB-03：各 profile 的实际取水 POI（清泉）数量。
///
/// 湖畔首版明确双岸点，静水水资源预算走「配置一次建立总池」路径；
/// 其余模板（含盆地）清泉 POI 数 = `countWater`。
pub fn water_source_poi_count(profile: &str, count_water_sources: usize) -> usize {
    if profile == TERRAIN_PROFILE_LAKESIDE_BASIN {
        2
    } else {
        count_water_sources
    }
}

/// ★ S7-06 河谷聚落静态谷地几何（创世 scratch 专用，不进快照/存档）。
///
/// 由 `generate_base_relief` 的 settlement 分支从 `relief_rng` 抽样构建
///（消费序：蜿蜒相位 → 蜿蜒振幅 → 谷深 → 陡壁幅宽比 → 谷底半宽 → 水源锚点×2
/// → ★ S7-07 主河半宽），
/// 第 2 步铺高程与第 6 步地表派生共用同一份，保证两段几何逐比特一致。
/// ★ S7-07：谷轴中心线同时是主河中心线（河道位于谷底中心，微幅弯曲由谷轴
/// 蜿蜒承载）；河宽/岸带/河阶几何随本结构移交第 3 步水系局部写入。
#[derive(Debug, Clone)]
pub struct ValleyGeometry {
    /// 谷底基准高程（米）：谷底整体近乎平坦，仅剩阻尼 fBm 微起伏。
    pub floor_base_m: f32,
    /// 谷底半宽（米）：抽自 [80, 95] ⇒ W_floor ∈ [160,190]（规格 150~190，
    /// 下沿抬到 160 以保证扣除 S7-07 河道+河岸带后两侧河阶干燥平坦带 ≥55m）。
    pub floor_half_m: f32,
    /// 陡壁总高差（米）：抽自 [44, 48]（规格 40~50）。
    pub h_wall_m: f32,
    /// 陡壁宽度（米）：由 幅宽比 H/W ∈ [0.54, 0.585] 反解 W = H/比 ∈ [75,89]
    /// （规格 70~90）——幅宽比与高差联动抽样，使 smoothstep 剖面峰值梯度
    /// 1.5×H/W 稳定落在 39°~41.5°（≥34° 硬禁行、≤45° 探针窗上限）。
    pub w_wall_m: f32,
    /// 蜿蜒振幅（米）与相位：谷轴 `center_x(y) = amp·sin(y/world·waves + phase)`，
    /// 打破笔直槽谷的机械感；amp ∈ [18,30] 远小于谷底半宽，图心列恒在谷底内。
    /// ★ S7-08：振幅/波形走 SimConfig（`terrain_valley_meander_amp_*` /
    /// `terrain_valley_meander_waves`），随本结构在第 2/6 步间共享。
    pub meander_amp_m: f32,
    /// ★ S7-08：谷轴蜿蜒全程周期数（原 `VALLEY_MEANDER_WAVES` 常数，默认 3.0）。
    pub meander_waves: f32,
    pub meander_phase_rad: f32,
    /// 陡壁/台地包络起始 |y|（米）：|y| ≤ 此值包络恒为 1（深切段），之外按
    /// `1 − u²`（u = (|y|−起点)/(半图−起点)）二次收敛到图缘 0——谷口段陡壁
    /// 降为 ≤30° 缓梁、台地 sinks 到谷底高程，全图连通分量保持 1。
    pub taper_start_m: f32,
    /// 谷底水源锚点（世界坐标，2 处对角错布）：第 2 步末尾据此保留
    /// （水源地理锚定 + 生态清泉 POI 落点）。
    pub spring_anchors: Vec<(f32, f32)>,
    /// ★ S7-07 主河半宽（米）：河宽抽自 [22, 32]（规格 22~32m）取半。恒定半宽
    /// （「微幅弯曲」由谷轴蜿蜒承载）；半宽 + 岸带 8m ≤ 24m，守住 S7-06 建造
    /// 保护线（谷底半宽 ≥80 时两侧干燥平坦河阶 ≥55m）。
    pub river_half_m: f32,
}

impl ValleyGeometry {
    /// 谷轴中心线 x 坐标（南北走向 + 微幅蜿蜒）。★ S7-08：波形数走结构字段
    /// （构造时从 SimConfig 读入），第 2/6 步与 hydrology 三方共享同一取值。
    #[inline]
    pub(super) fn center_x(&self, y: f32, world_size: f32) -> f32 {
        self.meander_amp_m
            * (y / world_size * self.meander_waves + self.meander_phase_rad).sin()
    }

    /// 陡壁/台地公共沿谷包络（图缘收敛到 0）。最大下降梯度
    /// `2×H/(半图−起点)` ≈ 0.39（21.5° @H=45），远低于 30° 可行走线——
    /// 谷口段是绕行通道而非断崖。
    #[inline]
    pub(super) fn wall_env(&self, y: f32, half_size: f32) -> f32 {
        let ay = y.abs();
        if ay <= self.taper_start_m {
            1.0
        } else {
            let u = ((ay - self.taper_start_m) / (half_size - self.taper_start_m).max(1.0)).min(1.0);
            1.0 - u * u
        }
    }
}

/// ★ STAGE2-7 显式诊断/降级基线（06 号 §5.8「基线先验收」）：倾斜-only 平地。
/// 无 fBm/山脊/支脊/洼地/水系/特征——仅保留世界倾斜（16~24m 跨度）与第 6 步
/// 统一坡度/地表/肥力/flags 派生，供几何校验、生存诊断与有界回退环（STAGE2-5）
/// 作为**显式降级目标**与诊断对照。
/// ⚠️ 只经显式指定进入，**永不加入 `random` 映射**（`resolve_profile` 不分派它）；
/// 不宣称与旧 T0 等价（旧 T0 生成源已随 v1.50.17 兼容壳删除、基底公式被
/// TB-01-2 取代，无可验证旧基准——基准缺口已在 06 号 §5.8 记录）。
pub const TERRAIN_PROFILE_FLAT_BASELINE: &str = "flat_baseline";

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

    /// §5.3 第 2 步 `generate_base_relief`：生成基础起伏（原 `generate_with_profile`
    /// 主体，★ STAGE2-3 阶段化重构迁移）。T0 基础高程 + T1 山脊/山口 + 草原 + T2 河谷低丘。
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
    ///
    /// ★ STAGE2-3 流水线分工：本步只铺高程并标记软地凹圈掩码；坡度/地表/肥力/flags
    /// 统一由第 6 步 `finalize_slope_and_surface` 定稿（全图唯一写点）。profile 解析
    /// 与静态状态清空已上移至流水线第 0/1 步；T2 分支在铺完倾斜+fBm 高程后（其结果
    /// 被整体覆盖，但主 RNG/relief_rng 消费顺序必须原样保留）以 STAGE2-2 提取的
    /// `generate_river_valley_base_relief` 铺河谷低丘陆地基底。
    fn generate_base_relief(
        &mut self,
        seed: u64,
        config: &SimConfig,
        scratch: &mut GenesisScratch,
    ) {
        let mut rng = WorldRng::new(seed);
        let mut relief_rng = WorldRng::new(seed ^ 0x5245_4c49_4546_5431);
        let half_size = self.world_size / 2.0;
        self.tilt_angle_rad = rng.gen_range(0.0, std::f32::consts::TAU);
        // ★ S7-02 草原 / ★ S7-04 半坡林地 / ★ S7-06 河谷聚落 / ★ STAGE2-7
        //   flat_baseline：基础倾斜压到 16~24（主地貌由专属特征承担，坡度主体
        //   2°~8°；flat_baseline 则只有倾斜本身；河谷聚落的高程被谷地公式
        //   整体覆写，倾斜只保持「低幅地貌」的语义一致）。抽取数不变（1 次），
        //   仅区间不同——T1/T2 路径的 rng 消费序列与取值逐位不变。
        let is_flat_baseline = self.profile == TERRAIN_PROFILE_FLAT_BASELINE;
        let is_plateau = self.profile == TERRAIN_PROFILE_PLATEAU_SETTLEMENT;
        // ★ TB-03 三个新模板：低幅基础倾斜（主地貌由专属特征承担，与草原/半坡同口径）
        let is_fan = self.profile == TERRAIN_PROFILE_ALLUVIAL_FAN;
        let is_basin = self.profile == TERRAIN_PROFILE_BASIN_OASIS;
        let is_lakeside = self.profile == TERRAIN_PROFILE_LAKESIDE_BASIN;
        let low_relief = self.profile == TERRAIN_PROFILE_GRASSLAND_PLAIN
            || self.profile == TERRAIN_PROFILE_HILLSIDE_WOODLAND
            || self.profile == TERRAIN_PROFILE_RIVER_VALLEY_SETTLEMENT
            || is_plateau
            || is_fan
            || is_basin
            || is_lakeside
            || is_flat_baseline;
        self.tilt_magnitude = if low_relief {
            rng.gen_range(16.0, 24.0)
        } else {
            rng.gen_range(54.0, 66.0)
        };
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

        // ★ S7-02 平地草原辅助特征参数（只消费 relief_rng 局部流；T1/T2 不进入本块，
        //   消费序列与逐位输出不受影响）。
        //   残丘：高斯最大梯度 ≈ 0.858 × A/R，A/R ∈ [0.19, 0.31] → 峰值坡度
        //   ≈ 9.3°~14.9°，叠加低幅基础波动后严格 < 18°（不产生通行障碍）。
        let is_grassland = self.profile == TERRAIN_PROFILE_GRASSLAND_PLAIN;
        let is_hillside = self.profile == TERRAIN_PROFILE_HILLSIDE_WOODLAND;
        let grass_mounds: Vec<(f32, f32, f32, f32)> = if is_grassland {
            let mound_count = if relief_rng.gen_range(0.0, 1.0) < 0.5 { 1 } else { 2 };
            // ★ S7-08：幅度/幅径比走 SimConfig（默认 6.5~9.5 / 0.19~0.31 与原
            //   字面量逐位相同）。防御性钳制防止零值 Default 产生空抽样区间。
            let amp_lo = config.terrain_grassland_mound_amp_min.max(0.0);
            let amp_hi = config.terrain_grassland_mound_amp_max.max(amp_lo + 0.01);
            let ratio_lo = config.terrain_grassland_mound_ratio_min.max(0.01);
            let ratio_hi = config.terrain_grassland_mound_ratio_max.max(ratio_lo + 0.001);
            let mut placed: Vec<(f32, f32, f32, f32)> = Vec::with_capacity(mound_count);
            for i in 0..mound_count {
                let mut ang = relief_rng.gen_range(0.0, std::f32::consts::TAU);
                let rad = relief_rng.gen_range(0.30, 0.42) * self.world_size;
                let amp = relief_rng.gen_range(amp_lo, amp_hi);
                let mrad = amp / relief_rng.gen_range(ratio_lo, ratio_hi);
                // 两丘潜在重叠时把第二丘转到对侧（不额外消费 RNG，保持确定性）
                if i > 0 {
                    if let Some(&(px, py, _, pr)) = placed.first() {
                        let (cx, cy) = (ang.cos() * rad, ang.sin() * rad);
                        if (cx - px).hypot(cy - py) < pr + mrad {
                            ang += std::f32::consts::PI;
                        }
                    }
                }
                placed.push((ang.cos() * rad, ang.sin() * rad, amp, mrad));
            }
            placed
        } else {
            Vec::new()
        };
        // ★ S7-04 半坡林地主坡参数（只消费 relief_rng 局部流；其余 profile 不进入
        //   本块，消费序列与逐位输出不受影响）。
        //   不对称高斯主坡：峰值梯度出现在 across=±W 处，值 = exp(-0.5)×A/W——
        //   以「目标峰值坡度」反解宽度。背风目标 19°~23°（叠加 fBm/倾斜后全域
        //   max_slope 落入门禁 22°~28.5°，见 S7-04 实测记录）、迎风目标 8°~12°
        //   （宽缓可建，目标 <14°）；crest_shift 把脊线推离图心 0.18~0.30×world，
        //   图心落在迎风坡脚平缓带（初始营地坡度 <10° 可建），陡峭带远离营地。
        let hill_params: Option<(f32, f32, f32, f32)> = if is_hillside {
            // ★ S7-08：幅度/目标坡度/脊线横移走 SimConfig（默认区间与原字面量
            //   逐位相同）。防御性钳制防止零值 Default 产生空抽样区间。
            let amp_lo = config.terrain_hillside_amp_min.max(1.0);
            let amp_hi = config.terrain_hillside_amp_max.max(amp_lo + 0.1);
            let lee_lo = config.terrain_hillside_lee_slope_min.max(0.1);
            let lee_hi = config.terrain_hillside_lee_slope_max.max(lee_lo + 0.01);
            let wind_lo = config.terrain_hillside_wind_slope_min.max(0.1);
            let wind_hi = config.terrain_hillside_wind_slope_max.max(wind_lo + 0.01);
            let shift_lo = config.terrain_hillside_crest_shift_min.max(0.0);
            let shift_hi = config.terrain_hillside_crest_shift_max.max(shift_lo + 0.001);
            let amp = relief_rng.gen_range(amp_lo, amp_hi);
            let lee_target = relief_rng.gen_range(lee_lo, lee_hi).to_radians().tan();
            let wind_target = relief_rng.gen_range(wind_lo, wind_hi).to_radians().tan();
            let sgn = if relief_rng.gen_range(0.0, 1.0) < 0.5 { -1.0 } else { 1.0 };
            let crest_shift = sgn * relief_rng.gen_range(shift_lo, shift_hi) * self.world_size;
            Some((
                amp,
                GAUSS_PEAK_GRADIENT * amp / wind_target, // W_wind（宽缓）
                GAUSS_PEAK_GRADIENT * amp / lee_target,  // W_lee（较陡）
                crest_shift,
            ))
        } else {
            None
        };

        // ★ S7-06 河谷聚落谷地参数（只消费 relief_rng 局部流；其余 profile 不进入
        //   本块，消费序列与逐位输出不受影响）。抽样序固定：蜿蜒相位 → 蜿蜒振幅 →
        //   谷深 → 陡壁幅宽比 → 谷底半宽 → 水源锚点×2（各 1 次 y 偏移）
        //   → ★ S7-07 主河半宽。
        //   幅宽比与谷深联动反解陡壁宽度，使 smoothstep 剖面峰值梯度 1.5×H/W
        //   稳定落在 39°~41.5°（≥34° 硬禁行线下留噪声余量、≤45° 探针窗上限）；
        //   谷底半宽下沿 80 保证扣除 S7-07 河道+河岸带（≤24m）后两侧干燥平坦
        //   河阶带 ≥55m（06 号 §4.3 建造保护）。
        let is_valley_settlement = self.profile == TERRAIN_PROFILE_RIVER_VALLEY_SETTLEMENT;
        let valley: Option<ValleyGeometry> = if is_valley_settlement {
            // ★ S7-08：谷地形态参数全部走 SimConfig（默认区间与原字面量逐位相同，
            //   抽样序不变）。防御性钳制防止零值 Default 产生空抽样区间/退化几何。
            let meander_phase_rad = relief_rng.gen_range(0.0, std::f32::consts::TAU);
            let ma_lo = config.terrain_valley_meander_amp_min.max(0.0);
            let ma_hi = config.terrain_valley_meander_amp_max.max(ma_lo + 0.1);
            let meander_amp_m = relief_rng.gen_range(ma_lo, ma_hi);
            let h_lo = config.terrain_valley_wall_height_min.max(1.0);
            let h_hi = config.terrain_valley_wall_height_max.max(h_lo + 0.1);
            let h_wall_m = relief_rng.gen_range(h_lo, h_hi);
            let wr_lo = config.terrain_valley_wall_ratio_min.max(0.01);
            let wr_hi = config.terrain_valley_wall_ratio_max.max(wr_lo + 0.001);
            let w_wall_m = h_wall_m / relief_rng.gen_range(wr_lo, wr_hi);
            let fh_lo = config.terrain_valley_floor_half_min.max(1.0);
            let fh_hi = config.terrain_valley_floor_half_max.max(fh_lo + 0.1);
            let floor_half_m = relief_rng.gen_range(fh_lo, fh_hi);
            // 谷底两处生活水源：南北对角错布（i=0 东北偏西岸、i=1 西南偏东岸语义上
            // 即「两岸各一」），|y| ∈ [0.06,0.13]×world 保证图心（初始营地）水源距
            // ≤ ~115m（探针窗 140m），横向贴谷轴 ±0.52×谷底半宽避开 S7-07 河道带。
            let mut spring_anchors = Vec::with_capacity(2);
            for i in 0..2usize {
                let y_sign = if i == 0 { 1.0 } else { -1.0 };
                let x_sign = if i == 0 { -1.0 } else { 1.0 };
                let sy = y_sign * relief_rng.gen_range(0.06, 0.13) * self.world_size;
                let sx = x_sign * floor_half_m * 0.52;
                spring_anchors.push((sx, sy));
            }
            // ★ S7-07 主河半宽：河宽抽自 `terrain_valley_river_width_min/max`（默认
            //   [22, 32]，06 号 §4.3 规格 22~32m）取半；岸带/河阶/浅滩位置走
            //   SimConfig（`terrain_valley_river_bank_m` 等，S7-08 集中化），水面
            //   高程与跨河走廊宽度由第 3 步从 SimConfig 读取（与 T2 同源）。
            let rw_lo = config.terrain_valley_river_width_min.max(0.0);
            let rw_hi = config.terrain_valley_river_width_max.max(rw_lo + 0.1);
            let river_half_m = relief_rng.gen_range(rw_lo, rw_hi) * 0.5;
            Some(ValleyGeometry {
                floor_base_m: config.terrain_valley_floor_base_m,
                floor_half_m,
                h_wall_m,
                w_wall_m,
                meander_amp_m,
                meander_waves: config.terrain_valley_meander_waves.max(0.01),
                meander_phase_rad,
                taper_start_m: config.terrain_valley_taper_ratio.max(0.0) * self.world_size * 0.5,
                spring_anchors,
                river_half_m,
            })
        } else {
            None
        };
        // 泉溪洼地锚点候选：2 处，锚在中心近域（图心=初始营地，是最近水源地理）；
        // 落点会在 raw 填充后吸附到局部最低格（「在低洼处开辟微凹地」）。
        // ★ S7-04 半坡林地复用同一洼地语义（坡脚泉溪 = 生活供水锚点；草原创世
        //   的抽取序与取值逐位不变）。
        let foot_depressions: Vec<(f32, f32, f32, f32)> = if is_grassland || is_hillside {
            // ★ S7-08：深度/凹圈半径走 SimConfig（默认 1.4~2.2 / 24~34 与原字面量
            //   逐位相同；草原/半坡共用同一组）。
            let depth_lo = config.terrain_spring_depression_depth_min.max(0.0);
            let depth_hi = config.terrain_spring_depression_depth_max.max(depth_lo + 0.01);
            let drad_lo = config.terrain_spring_depression_radius_min.max(1.0);
            let drad_hi = config.terrain_spring_depression_radius_max.max(drad_lo + 0.1);
            (0..2)
                .map(|_| {
                    let ang = relief_rng.gen_range(0.0, std::f32::consts::TAU);
                    let rad = relief_rng.gen_range(0.08, 0.28) * self.world_size;
                    let depth = relief_rng.gen_range(depth_lo, depth_hi);
                    let drad = relief_rng.gen_range(drad_lo, drad_hi);
                    (ang.cos() * rad, ang.sin() * rad, depth, drad)
                })
                .collect()
        } else {
            Vec::new()
        };

        // ★ TB-02 台地聚落静态几何参数（只消费 relief_rng 局部流；其余 profile 不进入
        //   本块，消费序列与逐位输出不受影响）。
        let plateau = if is_plateau {
            Some(super::plateau::PlateauGeometry::plan(
                &mut relief_rng,
                self.world_size,
                config,
            ))
        } else {
            None
        };

        // ★ TB-03 三个新模板静态几何（各自只消费 relief_rng 局部流，互不影响；
        //   基础倾斜闭包与 base_tilt 同式，供泉池/湖岸平坦基准解析计算）。
        let tilt_at = |wx: f32, wy: f32| -> f32 {
            ((wx * tilt_cos + wy * tilt_sin) / half_size.max(1.0)) * (self.tilt_magnitude * 0.5)
        };
        let fan = if is_fan {
            Some(super::alluvial_fan::FanGeometry::plan(&mut relief_rng, self.world_size, config))
        } else {
            None
        };
        let basin = if is_basin {
            Some(super::basin::BasinGeometry::plan(
                &mut relief_rng,
                self.world_size,
                config,
                tilt_at,
            ))
        } else {
            None
        };
        let lake = if is_lakeside {
            Some(super::lakeside::LakeGeometry::plan(
                &mut relief_rng,
                self.world_size,
                config,
                tilt_at,
            ))
        } else {
            None
        };

        // ★ S7-08：删除死变量 `wave_scale`（S7-02 时代的正弦波谐波振幅削减 ×0.4；
        //   TB-01-2 用 fBm + 高度调制掩码取代谐波后该变量零消费，长期触发
        //   unused warning）。草原「低幅起伏」现由 low_relief 倾斜区间 + 掩码
        //   平原权重（NOISE_WEIGHT_PLAIN）承载，无独立削减系数可配置。
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
        // ★ S7-04 半坡噪声阻尼：fBm 在坡面上的局部梯度会把 max_slope 的逐种子
        //   方差推到 ±2° 以上，压穿门禁窗口（22°~28.5°）与 §4.1 固定种子带
        //   （seed 7 [23,26.5]）。半坡分支对噪声增益统一 ×配置阻尼
        //   （terrain_hillside_noise_damp，默认 0.6；其余 profile ×1.0 逐位不变）。
        let noise_amp_k = if is_hillside {
            noise_amp_k * config.terrain_hillside_noise_damp.max(0.0)
        } else {
            noise_amp_k
        };
        // ★ S7-06/S7-08 河谷聚落 fBm 分区阻尼（谷底/陡壁强阻尼保「高程平缓」与
        //   峰坡窗口，台地中等阻尼出自然滚动丘陵）：改走 SimConfig（默认 0.15/0.15/0.5）。
        let valley_noise_floor_k = config.terrain_valley_noise_floor_k;
        let valley_noise_wall_k = config.terrain_valley_noise_wall_k;
        let valley_noise_upland_k = config.terrain_valley_noise_upland_k;

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

                // ★ S7-06 河谷聚落：谷地高程场整体覆写（谷底/陡壁/台地三分带）。
                //   剖面 smoothstep（3t²−2t³）两端导数为 0——谷底边缘与壁顶台地
                //   均 C1 平滑衔接（06 号 §4.3「山坡与谷底边缘平滑连续」）；
                //   陡壁+台地共用同一沿谷包络 wall_env（壁顶=台地高程逐格相等，
                //   不会在接缝处产生竖向断崖），包络在谷口段二次收敛保证绕行连通。
                if let Some(vg) = valley.as_ref() {
                    let fbm_v = terrain_noise::fbm_terrain_3octaves(
                        wx * noise_freq_k,
                        wy * noise_freq_k,
                        seed,
                    ) * noise_amp_k;
                    let d = (wx - vg.center_x(wy, self.world_size)).abs();
                    let env = vg.wall_env(wy, half_size);
                    elev = if d < vg.floor_half_m {
                        // 冲积谷底：基准高程 + 强阻尼微起伏（高程平缓、可建）
                        vg.floor_base_m + fbm_v * valley_noise_floor_k
                    } else if d < vg.floor_half_m + vg.w_wall_m {
                        // 连续陡壁：峰值梯度 1.5×H/W ≈ tan(39°~41.5°)，≥34° 段
                        // 由第 6 步派生 RockFace + NO_WALK 硬禁行
                        let t = (d - vg.floor_half_m) / vg.w_wall_m;
                        let s = t * t * (3.0 - 2.0 * t);
                        vg.floor_base_m + vg.h_wall_m * env * s + fbm_v * valley_noise_wall_k
                    } else {
                        // 壁顶台地缓穹：随包络向图缘收敛到谷底高程（谷口开阔）
                        vg.floor_base_m + vg.h_wall_m * env + fbm_v * valley_noise_upland_k
                    };
                    raw[gy * self.grid_width + gx] = elev;
                    continue;
                }

                // ★ TB-02 台地聚落：高程场采样（圆角矩形 SDF + 分离过渡带 + 缓坡入口 + 噪声遮罩）。
                if let Some(pg) = plateau.as_ref() {
                    let fbm_v = terrain_noise::fbm_terrain_3octaves(
                        wx * noise_freq_k,
                        wy * noise_freq_k,
                        seed,
                    ) * noise_amp_k;
                    let warp_v = ridge_warp_raw(wy, self.world_size, seed);
                    raw[gy * self.grid_width + gx] = pg.elevation_at(wx, wy, base_tilt, fbm_v, warp_v);
                    continue;
                }

                // ★ TB-03 冲积扇：扇面高程 + 干浅沟下凹（扇体噪声阻尼随包络渐变出扇；
                //   扇外恢复 0.25 平原权重）。
                if let Some(fg) = fan.as_ref() {
                    let fbm_v = terrain_noise::fbm_terrain_3octaves(
                        wx * noise_freq_k,
                        wy * noise_freq_k,
                        seed,
                    ) * noise_amp_k;
                    let (z_fan, w) = fg.elevation_at(wx, wy);
                    let (gully_dz, _) = fg.gully_depth_at(wx, wy);
                    raw[gy * self.grid_width + gx] = base_tilt + z_fan - gully_dz + fbm_v * w;
                    continue;
                }

                // ★ TB-03 盆地：盆地下凹 + 环抱高山 + 出口走廊；中心平缓区噪声强抑制
                //   （不做整片平坦化——盆底曲率混合环会产生 33°+ 陡坡环阻断出口，TB-03-06 实测踩坑）。
                if let Some(bg) = basin.as_ref() {
                    let fbm_v = terrain_noise::fbm_terrain_3octaves(
                        wx * noise_freq_k,
                        wy * noise_freq_k,
                        seed,
                    ) * noise_amp_k;
                    let (q, theta) = bg.q_at(wx, wy);
                    let (dz, w) = bg.basin_dz(q, theta, wx, wy);
                    raw[gy * self.grid_width + gx] = base_tilt + dz + fbm_v * w;
                    continue;
                }

                // ★ TB-03 湖畔盆地：湖床/干岸平台/外坡分带；湖心近域平坦基准
                //   （局部倾斜破坏水平水面与环岸平台，跨外坡带平滑回归）。
                if let Some(lg) = lake.as_ref() {
                    let fbm_v = terrain_noise::fbm_terrain_3octaves(
                        wx * noise_freq_k,
                        wy * noise_freq_k,
                        seed,
                    ) * noise_amp_k;
                    let (dz, w, dblend) = lg.elevation_offset(wx, wy);
                    let base_eff = base_tilt * (1.0 - dblend) + lg.shore_datum * dblend;
                    raw[gy * self.grid_width + gx] = base_eff + dz + fbm_v * w;
                    continue;
                }

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

                // ★ S7-02 孤立残丘：高斯缓丘叠加（1~2 处，中心外围；远景地标 + 高肥力坡脚）
                for &(mx, my, amp, mrad) in &grass_mounds {
                    let dx = wx - mx;
                    let dy = wy - my;
                    elev += amp * (-(dx * dx + dy * dy) / (mrad * mrad)).exp();
                }
                // ★ S7-04 不对称主坡：迎风（across<0）宽缓高斯 / 背风（across>0）
                //   较窄高斯，两侧在 across=0 处导数同为 0（C1 连续，脊线圆滑无折角）。
                //   脊线走向沿用既有 theta，横向偏移 = ridge_offset + crest_shift
                //   （crest_shift 把陡峭带推离图心，营地落在迎风坡脚平缓带）。
                if let Some((h_amp, w_wind, w_lee, crest_shift)) = hill_params {
                    let across =
                        -wx * theta_sin + wy * theta_cos - ridge_offset - crest_shift;
                    let w = if across <= 0.0 { w_wind } else { w_lee };
                    elev += h_amp * (-(across * across) / (2.0 * w * w)).exp();
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
                // ★ STAGE2-7 flat_baseline：跳过 fBm 叠加（也不进上方任何 profile
                //   专属块）——elev 恒为基础倾斜，本分支即「倾斜-only」诊断基线。
                if !is_flat_baseline {
                    elev += terrain_noise::fbm_terrain_3octaves(
                        wx * noise_freq_k,
                        wy * noise_freq_k,
                        seed,
                    ) * noise_amp_k
                        * weight
                        * saddle_noise_damp;
                }
                raw[gy * self.grid_width + gx] = elev;
            }
        }

        // ★ S7-02 泉溪洼地：候选锚点吸附到局部最低格（「在低洼处开辟微凹地」），
        //   高斯微凹盆直接雕入 raw（在坡度派生之前）；凹圈带（0.7R~1.5R）标记
        //   SoftGround，盆心保持 DryGround。无水体、无水面。
        let mut soft_ring = if foot_depressions.is_empty() {
            Vec::new()
        } else {
            vec![false; self.grid_width * self.grid_height]
        };
        let mut springs: Vec<(usize, usize, f32, f32, f32, f32)> = Vec::new();
        if !foot_depressions.is_empty() {
            let gw = self.world_size / (self.grid_width.max(2) - 1) as f32;
            let to_grid = |v: f32, n: usize| {
                ((v / self.world_size + 0.5) * (n - 1) as f32)
                    .round()
                    .clamp(10.0, (n - 11) as f32) as usize
            };
            for (di, &(cwx, cwy, depth, drad)) in foot_depressions.iter().enumerate() {
                let (cgx, cgy) = (to_grid(cwx, self.grid_width), to_grid(cwy, self.grid_height));
                let mut best = (cgx, cgy);
                let mut best_e = f32::MAX;
                for wy in cgy.saturating_sub(8)..=(cgy + 8).min(self.grid_height - 1) {
                    for wx in cgx.saturating_sub(8)..=(cgx + 8).min(self.grid_width - 1) {
                        let e = raw[wy * self.grid_width + wx];
                        if e < best_e {
                            best_e = e;
                            best = (wx, wy);
                        }
                    }
                }
                let (mut sx, mut sy) = best;
                let mut swx = (sx as f32 / (self.grid_width - 1).max(1) as f32 - 0.5) * self.world_size;
                let mut swy = (sy as f32 / (self.grid_height - 1).max(1) as f32 - 0.5) * self.world_size;
                // 与已接受洼地过近时沿连线外推到 0.22×world_size（确定性修正，不消费 RNG）
                if di > 0 {
                    if let Some(&(pgx, pgy, _, _, _, _)) = springs.first() {
                        let pwx = (pgx as f32 / (self.grid_width - 1).max(1) as f32 - 0.5) * self.world_size;
                        let pwy = (pgy as f32 / (self.grid_height - 1).max(1) as f32 - 0.5) * self.world_size;
                        let min_dist = 0.22 * self.world_size;
                        let d = (swx - pwx).hypot(swy - pwy);
                        if d < min_dist && d > 1e-3 {
                            let k = min_dist / d;
                            swx = pwx + (swx - pwx) * k;
                            swy = pwy + (swy - pwy) * k;
                            sx = to_grid(swx, self.grid_width);
                            sy = to_grid(swy, self.grid_height);
                        }
                    }
                }
                // 水源锚定半径（§1.4 草原 water≤160m）：吸附点偏向图缘的种子沿径向
                // 收拢盆心到 0.20×world_size ≈153m 界内（确定性修正，不消费 RNG）。
                let max_anchor_r = 0.20 * self.world_size;
                let anchor_r = swx.hypot(swy);
                if anchor_r > max_anchor_r {
                    let k = max_anchor_r / anchor_r;
                    swx *= k;
                    swy *= k;
                    sx = to_grid(swx, self.grid_width);
                    sy = to_grid(swy, self.grid_height);
                }
                let reach = (drad * 1.8 / gw).ceil() as i32;
                for dy in -reach..=reach {
                    for dx in -reach..=reach {
                        let gx = sx as i32 + dx;
                        let gy = sy as i32 + dy;
                        if gx < 0 || gy < 0 || gx >= self.grid_width as i32 || gy >= self.grid_height as i32 {
                            continue;
                        }
                        let cell_wx = (gx as f32 / (self.grid_width - 1).max(1) as f32 - 0.5) * self.world_size;
                        let cell_wy = (gy as f32 / (self.grid_height - 1).max(1) as f32 - 0.5) * self.world_size;
                        let ddx = cell_wx - swx;
                        let ddy = cell_wy - swy;
                        let d2 = ddx * ddx + ddy * ddy;
                        let idx = gy as usize * self.grid_width + gx as usize;
                        raw[idx] -= depth * (-(d2) / (drad * drad)).exp();
                        let d = d2.sqrt();
                        if d >= drad * 0.7 && d <= drad * 1.5 {
                            soft_ring[idx] = true;
                        }
                    }
                }
                springs.push((sx, sy, swx, swy, depth, drad));
            }
        }

        // ★ STAGE2-3 流水线分工：第 2 步只铺高程（坡度/地表/肥力/flags 由第 6 步
        //   `finalize_slope_and_surface` 全图唯一定稿；原 TB-01-4 内联派生逐字迁移至
        //   第 6 步 `derive_surface_and_flags`，输入输出逐比特一致）。此处写临时中性值，
        //   任何 profile 下都会在第 6 步（或第 2/3 步后续覆写）被完全覆盖，不可观察。
        for idx in 0..self.cells.len() {
            self.cells[idx] = GeoCell {
                elevation: raw[idx],
                slope_angle_deg: 0.0,
                surface_kind: SurfaceKind::DryGround,
                natural_fertility: 1.0,
                water_body_id: None,
                feature_flags: 0,
            };
        }
        // 软地凹圈掩码移交流水线 scratch，第 6 步地表派生消费（优先级高于坡度派生）。
        scratch.soft_ring = soft_ring;
        // ★ S7-06 谷地几何移交流水线 scratch，第 6 步地表派生消费（谷底/陡壁分区）。
        //   clone 仅含 2 个水源锚点的轻量几何（scratch 专用）。
        scratch.valley_geometry = valley.clone();
        // ★ TB-02 台地几何移交流水线 scratch，第 10 步路网接入消费。
        scratch.plateau_geometry = plateau.clone();
        // ★ TB-03 三个新模板几何移交流水线 scratch（第 3 步静水 / 第 6 步覆盖意图 /
        //   第 10 步路网与门禁消费）。
        scratch.fan_geometry = fan.clone();
        scratch.basin_geometry = basin.clone();
        scratch.lake_geometry = lake.clone();

        // ★ T2 河谷低丘陆地基底（STAGE2-2 提取公式，铺满全图）＝第 2 步的
        //   river_valley 分支；几何由编排器第 2 步前规划的共享 `RiverGeometry` 提供。
        if let Some(geom) = scratch.river_geometry.as_ref() {
            self.generate_river_valley_base_relief(geom, config);
        }
        }

    /// T2 `river_valley_v1` 陆地区域基础生成（★ STAGE2-2 公式解耦，06 号 §5.3 兼容性拆分）。
    ///
    /// 旧实现中「河阶外低丘」公式内联在 `hydrology.rs::generate_river` 的全图覆写里，
    /// 水系阶段把前置地貌全部冲刷，统一地表派生无法局部生效。现将该公式**逐字**提取为
    /// 本函数：铺满全图写陆地基底——高程用旧 else 分支原式（`u` 夹取、山脊项、浮点次序
    /// 不改），地表 `DryGround`、肥力 `0.75`、flags `0`、无水体归属；随后
    /// `hydrology.rs::generate_river` 只覆盖水系影响带。拆分前后最终网格逐比特等价：
    /// 带内河阶格的山脊项恒为 +0.0，本函数写出的高程即旧实现的最终值。
    ///
    /// 流水线定位：06 号 §5.3 第 2 步 `generate_base_relief` 的 river_valley 分支前身
    ///（阶段化管线重构属 STAGE2-3）。
    pub fn generate_river_valley_base_relief(
        &mut self,
        geom: &super::hydrology::RiverGeometry,
        config: &SimConfig,
    ) {
        let size = self.world_size;
        let level = geom.level;
        let bank = geom.bank;
        let terrace = geom.terrace;
        for gy in 0..self.grid_height {
            for gx in 0..self.grid_width {
                let p = self.grid_pos(gx, gy);
                let d = (p.x - geom.center(p.y, size)).abs();
                let w = geom.half_width(p.y, size);
                let outside = (d - w).max(0.0);
                let c = &mut self.cells[gy * self.grid_width + gx];
                // 旧 T2 河阶外低丘公式（原 else 分支逐字保留）
                let u = ((outside - bank) / terrace).clamp(0.0, 1.0);
                c.elevation = level + 2.0 + u * 2.0
                    + ((outside - bank - terrace).max(0.0) / size
                        * config.terrain_ridge_amplitude.max(1.0))
                        * (0.8 + 0.2 * (p.y / 90.0).sin());
                c.surface_kind = SurfaceKind::DryGround;
                c.water_body_id = None;
                c.feature_flags = 0;
                c.natural_fertility = 0.75;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ★ STAGE2-3（06 号 §5.3）：无歧义创世流水线（阶段化重构）。
    //
    // 编排器 `generate_with_config`（0–9 步）+ 私有阶段函数；外部调用点不变
    // （`spatial/world.rs` 与探针仍只调用 `generate_with_config(seed, config)`）。
    // 第 10/11 步由 World 创世序列执行（见编排器尾部注释）。
    // ─────────────────────────────────────────────────────────────────────────

    /// ★ STAGE2-3（06 号 §5.3）：无歧义创世流水线编排器。阶段划分：
    ///
    /// ```text
    /// 0. resolve_profile(seed, profile)            // 不消费 WorldRng
    /// 1. reset_static_terrain_state()              // 清 features/accents/sub_features/hydrology
    /// 2. generate_base_relief(seed)                // 山口起伏/草原/河谷低丘；主 RNG + relief_rng 消费序不变
    /// 3. apply_profile_static_hydrology(config)    // T2 主河水系覆盖（STAGE2-2 收敛版）；P1 水面预留
    /// 4. plan_subfeatures(seed, profile, enabled)  // ✅ D-B1-3 纯 hash，不消费 WorldRng
    /// 5. 子特征几何管线（5a–5d）                   // ★ 阶段二空注入，数据管线/快照/回滚接口就位
    /// 6. finalize_slope_and_surface()              // 全图唯一写 slope + 派生/合并 flags 的位置
    /// 7. validate_static_terrain_geometry()        // STAGE2-4 扩充完整断言；Err → STAGE2-5 重试环
    /// 8. generate_base_accents(seed, density)      // 既有 accent_rng 独立流，消费顺序不变
    /// 9. append_subfeature_accents(plan)           // ★ 阶段二空实现
    /// 10. ecology 布局与路网连接                   // = seed_primitive_ecology（POI 播撒 +
    ///     prepare_terrain_layout / connect_terrain_world，只读取定稿地表）
    /// 11. validate_terrain_world + 生存成本诊断    // = 存档/校验路径；STAGE2-6 补诊断 → STAGE2-5 消费
    /// ```
    ///
    /// ★ 确定性契约：第 0/4 步不消费任何 `WorldRng`；第 2 步保持既有主 RNG 与
    /// `relief_rng` 消费顺序；第 3 步 hydro_rng 独立流；第 8 步 accent_rng 独立流；
    /// 子特征判定一律走无状态整数混合（`mix64`），严禁在阶段间插入共享流抽样。
    pub fn generate_with_config(&mut self, seed: u64, config: &SimConfig) {
        self.generate_with_config_overrides(seed, config, &GenesisOverrides::default());
    }

    /// ★ STAGE2-5 创世覆盖通道：`disabled_subfeature_mask` 位屏蔽结构子特征
    /// （`1 << TerrainSubFeatureKind as u32`，见 `creation_fallback::STRUCTURAL_SUBFEATURE_MASK`）。
    /// 只改变「注入什么」，**不改变任何 RNG 消费**（第 4 步规划是纯 hash，
    /// 过滤发生在规划产出之后）；阶段二注入器为空时无物理效果。
    pub fn generate_with_config_overrides(
        &mut self,
        seed: u64,
        config: &SimConfig,
        overrides: &GenesisOverrides,
    ) {
        // 0. 解析 profile（纯整数判别，不消费 WorldRng）
        self.profile = resolve_profile(seed, &config.terrain_profile);
        self.seed = seed;
        self.generator_version = TERRAIN_GENERATOR_VERSION;
        // 1. 清空静态地形状态（§5.2：每次创世先清空，再按流水线重建）
        self.reset_static_terrain_state();
        // T2 主河几何规划：hydro_rng 独立流（单次 phase 抽取），规划时点不影响
        // 任何共享 RNG 消费序；第 2 步铺河谷低丘与第 3 步施加水面共用同一份。
        let mut scratch = GenesisScratch::default();
        if self.profile == TERRAIN_PROFILE_RIVER_VALLEY {
            scratch.river_geometry = Some(super::hydrology::plan_river_geometry(seed, config));
        }
        // 2. 基础起伏（山口起伏 / 草原 / 河谷低丘）
        self.generate_base_relief(seed, config, &mut scratch);
        // 3. 静态水系（T2 主河；P1 预留）
        self.apply_profile_static_hydrology(config, &scratch);
        // 4. 子特征规划（纯 hash：不读不写 terrain、不消费任何 WorldRng）；
        //    STAGE2-5 降级掩码在规划产出后过滤结构子特征（不触碰 RNG）。
        let mut sub_plan =
            plan_subfeatures(seed, &self.profile, config.terrain_accent_sub_features);
        if overrides.disabled_subfeature_mask != 0 {
            sub_plan.retain(|p| {
                !p.kind.is_structural()
                    || overrides.disabled_subfeature_mask & (1 << (p.kind as u32)) == 0
            });
        }
        // 5. 子特征几何管线 5a–5d（阶段二空注入，接口就位）
        self.apply_subfeature_pipeline(&mut sub_plan);
        // 6. 全图唯一定稿坡度 + 派生/合并 flags
        self.finalize_slope_and_surface(&scratch);
        // 7. 静态几何校验（阶段二先接线稳定 ID 校验；Err 由 STAGE2-5 有界重试环消费）
        let _ = self.validate_static_terrain_geometry();
        // 8. 通用装饰（既有 accent_rng 独立流；地貌与水系定稿后散布，避免落入深水）
        self.generate_base_accents(seed, config.terrain_accent_density);
        // 9. 子特征专属装饰（阶段二空实现）
        self.append_subfeature_accents(&sub_plan);
        // 第 10/11 步不在本函数：`World3DEngine` 创世序列在 `world_create` 中先调用
        // 本函数、再调用 `seed_primitive_ecology`（第 10 步）；`validate_terrain_world`
        // （第 11 步，含 STAGE2-6 生存成本诊断）在存档/校验路径执行并冒泡给
        // STAGE2-5 有界回退环。
    }

    /// §5.3 第 1 步：清空静态地形状态（§5.2「每次创世先清空，再按流水线重建」）。
    fn reset_static_terrain_state(&mut self) {
        self.features.clear();
        self.accents.clear();
        self.sub_features.clear();
        self.branch_ridges.clear();
        self.hydrology = Default::default();
    }

    /// §5.3 第 5 步：按 `TerrainSubFeatureKind` 升序逐个处理已计划子特征，
    /// 走 5a 快照 → 5b 几何施加 → 5c 临时坡度 → 5d 接受/回滚的完整管线。
    ///
    /// ★ 阶段二空注入：`apply_subfeature_geometry` 为空桩、不写任何格子，
    /// 数据管线、快照结构与回滚接口完整就位，供阶段三（D-B2 首批子特征）填充。
    fn apply_subfeature_pipeline(&mut self, plan: &mut [PlannedSubFeature]) {
        if plan.is_empty() {
            return;
        }
        // 计划产出顺序为「结构型 → 视觉型」；本步要求按 kind 编号升序处理。
        let mut order: Vec<usize> = (0..plan.len()).collect();
        order.sort_by_key(|&i| plan[i].kind as u32);
        for &i in &order {
            let mut ws = self.snapshot_subfeature_bbox(&plan[i]); // 5a
            self.apply_subfeature_geometry(&mut plan[i], &ws); // 5b（阶段二空桩）
            self.recompute_slopes_scratch(&mut ws); // 5c（仅局部 scratch，不提交）
            self.accept_or_rollback(&mut plan[i], &ws); // 5d
        }
    }

    /// §5.3 第 5a 步 `snapshot_bbox`：复制子特征 AABB 内的原高程到局部快照。
    ///
    /// 阶段二 `anchor_hint` 恒为 `Vec3::ZERO`（真实锚点由第 5 步接管后按 profile
    /// 几何填充），空锚点 ⇒ 空工作区；阶段三在此按 kind 展开半径（clamp 进图）
    /// 并填充快照与 `bbox_min/max`。
    fn snapshot_subfeature_bbox(&self, f: &PlannedSubFeature) -> SubFeatureWorkspace {
        let mut ws = SubFeatureWorkspace::default();
        if f.anchor_hint == Vec3::ZERO {
            return ws;
        }
        // 阶段三扩展点：world→grid 定位锚点 → 按 kind 半径展开 AABB → 行主序复制
        // `cells[].elevation` 到 `ws.elevation_snapshot`（几何施加写格子前必须先有
        // 本快照，严禁边遍历边读回已改写的邻格）。
        let (gx, gy) = self.grid_index(f.anchor_hint.x, f.anchor_hint.y);
        ws.bbox_min = (gx, gy);
        ws.bbox_max = (gx, gy);
        ws.elevation_snapshot
            .push(self.cells[gy * self.grid_width + gx].elevation);
        ws
    }

    /// §5.3 第 5b 步 `apply_subfeature_geometry`：几何施加桩。
    ///
    /// ★ 阶段二空注入——「只改高程与水面、不写 slope/flags」的约束由第 6 步
    /// 唯一写点保证；阶段三（D-B2）在此按 §5.4 各 kind 规格施加几何，并回填
    /// 关联 `TerrainFeature` 稳定 ID 与 `sub_features` 容器。
    fn apply_subfeature_geometry(&mut self, f: &mut PlannedSubFeature, ws: &SubFeatureWorkspace) {
        let _ = (f, ws); // 阶段二空桩：不写任何格子
    }

    /// §5.3 第 5c 步 `recompute_slopes_scratch`：仅在 AABB 内做**临时**坡度试算
    /// （4 邻域中心差分，读含 5b 施加结果的 cells），结果只写入工作区、**严禁**
    /// 提交 `cells.slope_angle_deg`——第 6 步才是全图唯一坡度定稿点。
    fn recompute_slopes_scratch(&self, ws: &mut SubFeatureWorkspace) {
        ws.scratch_slopes.clear();
        if ws.is_empty() {
            return;
        }
        let (gx0, gy0) = ws.bbox_min;
        let (gx1, gy1) = ws.bbox_max;
        for gy in gy0..=gy1 {
            for gx in gx0..=gx1 {
                ws.scratch_slopes.push(self.slope_from_elevation(gx, gy));
            }
        }
    }

    /// §5.3 第 5d 步 `accept_or_rollback`：几何类接受判定。
    ///
    /// ★ 阶段二无几何施加（5b 空桩）⇒ 无几何可拒绝，`accepted` 保持 `false`
    /// （未注入，子特征容器不写入）。阶段三按 §5.4 拒绝条件用 `ws.scratch_slopes`
    /// 判定；失败时调用 `rollback_subfeature_geometry` 整块回滚，并由第 6 步
    /// 统一重算坡度与派生地表（§5.3「回滚后必须重新执行第 6 步」）。
    fn accept_or_rollback(&mut self, f: &mut PlannedSubFeature, ws: &SubFeatureWorkspace) {
        // 数据管线自检：临时坡度与快照必须逐格对应。
        debug_assert_eq!(ws.scratch_slopes.len(), ws.elevation_snapshot.len());
        let _ = f; // 阶段三：accepted 由本判定写入
    }

    /// §5.3 第 5d 步回滚路径：按 5a 快照整块恢复 AABB 内高程。
    ///
    /// ★ 阶段二不触发（几何施加桩为空操作）；阶段三几何类判定失败时调用。
    /// 只恢复高程——坡度/地表/flags 由第 6 步统一重算，严禁局部手工修补。
    #[allow(dead_code)] // 阶段三（D-B2 首批子特征）接入几何类拒绝条件后启用
    fn rollback_subfeature_geometry(&mut self, ws: &SubFeatureWorkspace) {
        if ws.is_empty() {
            return;
        }
        let (gx0, gy0) = ws.bbox_min;
        let (gx1, gy1) = ws.bbox_max;
        let mut i = 0usize;
        for gy in gy0..=gy1 {
            for gx in gx0..=gx1 {
                self.cells[gy * self.grid_width + gx].elevation = ws.elevation_snapshot[i];
                i += 1;
            }
        }
    }

    /// §5.3 第 6 步：全图唯一定稿坡度与派生/合并 flags 的位置。
    ///
    /// 6a `recompute_slopes()`：全图 4 邻域中心差分定稿 `slope_angle_deg`；
    /// 6b `derive_surface_and_flags()`：水面/河岸/河阶/浅滩等水系优先地表保留
    /// 其既有 `surface_kind` 与 flags，仅坡度派生类地表合并派生结果。
    ///
    /// ★ STAGE2-2 硬门禁「统一派生不得顺带更改旧 T2 的陆地分类」：T2 陆地
    /// （河阶带外）的地表/flags 由第 2 步陆地基底写定（历史事实：无坡度派生），
    /// 本阶段保持原样；统一陆地派生的启用属阶段三物理变更，须递增
    /// `TERRAIN_GENERATOR_VERSION` 并独立验收。
    fn finalize_slope_and_surface(&mut self, scratch: &GenesisScratch) {
        self.recompute_slopes();
        self.derive_surface_and_flags(scratch);
    }

    /// §5.3 第 6b 步：地表派生与 flags 合并。原 `generate_base_relief`（旧
    /// `generate_with_profile`）的 TB-01-4 内联派生逐字迁移至此（T0/T1/草原路径），
    /// 输入输出逐比特一致。
    fn derive_surface_and_flags(&mut self, scratch: &GenesisScratch) {
        if self.profile == TERRAIN_PROFILE_RIVER_VALLEY {
            return; // T2：只定稿坡度（6a），地表/flags/肥力由第 2/3 步写定
        }
        let is_grassland = self.profile == TERRAIN_PROFILE_GRASSLAND_PLAIN;
        // ★ S7-06 河谷聚落：谷底/陡壁分区派生。谷底（冲积带，扣除 S7-07 水系
        //   写定带）强制 DryGround + 基础肥力 0.95（06 号 §4.3「高程平缓、基础
        //   肥力 0.95」）；陡壁与台地走通用坡度派生（≥34° RockFace + NO_WALK
        //   硬禁行、20~34° SoftGround、≥18° NO_BUILD）。
        let valley = scratch.valley_geometry.as_ref();
        // ★ TB-03 覆盖意图（§3.2 优先级：真实深水已由水系写定并在上方跳过；
        //   干沟软地禁建 → 干燥岸带/安全退距禁建 → 普通坡度派生）。
        //   深水禁行禁建不可被取消；覆盖意图只叠加 NO_BUILD/SoftGround，不取消
        //   坡度派生已有的硬禁行。
        let fan_g = scratch.fan_geometry.as_ref();
        let basin_g = scratch.basin_geometry.as_ref();
        let lake_g = scratch.lake_geometry.as_ref();
        let needs_world_pos = fan_g.is_some() || basin_g.is_some() || lake_g.is_some();
        let world_size = self.world_size;
        for gy in 0..self.grid_height {
            for gx in 0..self.grid_width {
                let idx = gy * self.grid_width + gx;
                // ★ S7-07 水系优先：第 3 步已写定的水面/岸带/河阶/浅滩地表保持
                //   原样（surface_kind/flags/肥力由 `generate_settlement_river`
                //   一并定稿；坡度仍由 6a 全图定稿）。这些类别只可能来自水系
                //   写入——本函数的派生分支只产出 DryGround/SoftGround/RockFace，
                //   对无水 profile（T1/草原/半坡）该判据恒假、逐位无影响。
                if matches!(
                    self.cells[idx].surface_kind,
                    SurfaceKind::DeepWater
                        | SurfaceKind::RiverBank
                        | SurfaceKind::RiverTerrace
                        | SurfaceKind::ShallowWater
                ) {
                    continue;
                }
                let slope = self.cells[idx].slope_angle_deg;
                let normalized_height = ((self.cells[idx].elevation + 45.0) / 100.0).clamp(0.0, 1.0);
                let on_floor = valley.map_or(false, |vg| {
                    let wx = (gx as f32 / (self.grid_width - 1).max(1) as f32 - 0.5) * world_size;
                    let wy = (gy as f32 / (self.grid_height - 1).max(1) as f32 - 0.5) * world_size;
                    (wx - vg.center_x(wy, world_size)).abs() < vg.floor_half_m
                });
                // ★ TB-03 覆盖判据（仅新模板进入，旧 profile 恒 false、逐位无影响）
                let (wx, wy) = if needs_world_pos {
                    (
                        (gx as f32 / (self.grid_width - 1).max(1) as f32 - 0.5) * world_size,
                        (gy as f32 / (self.grid_height - 1).max(1) as f32 - 0.5) * world_size,
                    )
                } else {
                    (0.0, 0.0)
                };
                let gully_cover = fan_g.map_or(false, |fg| fg.gully_depth_at(wx, wy).1);
                let shore_cover = lake_g.map_or(false, |lg| lg.on_shore_ring(wx, wy));
                // ★ S7-02 草甸沃土：肥力基线抬高（可建格均值 0.85~0.95）；T1 公式不变。
                let fertility = if on_floor {
                    0.95
                } else if is_grassland {
                    (0.97 - slope / 70.0 * 0.5 - normalized_height * 0.10).clamp(0.1, 1.0)
                } else {
                    (0.92 - slope / 70.0 - normalized_height * 0.18).clamp(0.1, 1.0)
                };
                // ★ S7-02 泉溪洼地凹圈：低坡软地带优先于坡度派生（草原全域坡度 < 18°，
                //   不会与 RockFace 冲突）；软地只慢行不禁建（06 号 §4.1）。
                //   ★ TB-03 干沟软地禁建：覆盖意图优先于坡度派生（可慢行、禁建）。
                let surface_kind = if gully_cover {
                    SurfaceKind::SoftGround
                } else if on_floor {
                    SurfaceKind::DryGround
                } else if !scratch.soft_ring.is_empty() && scratch.soft_ring[idx] {
                    SurfaceKind::SoftGround
                } else if slope >= 34.0 {
                    SurfaceKind::RockFace
                } else if slope >= 20.0 {
                    SurfaceKind::SoftGround
                } else {
                    SurfaceKind::DryGround
                };
                // 阈值即物理契约：≥34° RockFace+NO_WALK、20~34° SoftGround、
                // <20° DryGround、≥18° NO_BUILD（阈值来源 terrainMaxWalkSlope=30 /
                // terrainMaxBuildSlope=16 之上再留工程余量）。
                // ★ TB-03：干沟与干燥岸环/安全退距叠加 NO_BUILD（只增不取消硬禁行）。
                let mut flags = 0u16;
                if slope >= 18.0 || gully_cover || shore_cover {
                    flags |= TERRAIN_FLAG_NO_BUILD;
                }
                if surface_kind.is_hard_blocked() {
                    flags |= TERRAIN_FLAG_NO_WALK;
                }
                let c = &mut self.cells[idx];
                c.surface_kind = surface_kind;
                c.natural_fertility = fertility;
                c.feature_flags = flags;
            }
        }
    }

    /// §5.3 第 7 步：静态几何校验。
    ///
    /// ★ STAGE2-4 完整断言集已落地（断言实现见 `geo/validation.rs`）：特征 ID
    /// 唯一/归属/kind 一致、子特征 ID 升序唯一 + 引用存在、水体轮廓双副本逐字节
    /// 一致（主河水体 1 ↔ `River` 特征 1）、取水点/授权走廊引用与边界、浅滩端点
    /// 在陆侧、cells 水域归属与 NO_WALK/NO_BUILD 一致。校验器只读不修复、
    /// 不重排既有 `features` 生成顺序（T2 为 10、11、1、20、21、30，排序会改
    /// 变快照字节）。失败 Err 由 STAGE2-5 有界重试环消费（本阶段仍不启用拒绝）。
    pub fn validate_static_terrain_geometry(&self) -> Result<(), &'static str> {
        super::validation::validate_static_terrain_geometry(self)
    }

    /// §5.3 第 8 步：通用地表装饰散布（既有 accent_rng 独立流，消费顺序不变）。
    /// 发生在路网/房屋/POI 尚未出现时，只按地表类别/坡度/肥力过滤禁区。
    fn generate_base_accents(&mut self, seed: u64, density: f32) {
        self.accents = super::accents::generate_accents(self, density, seed);
    }

    /// §5.3 第 9 步 `append_subfeature_accents`：子特征专属装饰追加接口
    /// （hash 放点、不消费 accent_rng，从通用装饰 `len()` 起按 kind 升序连续
    /// 追加并回填 `accent_id_start/end`）。
    ///
    /// ★ 阶段二空实现：D-B2 注入器接管前 `plan` 不产生任何装饰。
    fn append_subfeature_accents(&mut self, plan: &[PlannedSubFeature]) {
        let _ = plan;
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
