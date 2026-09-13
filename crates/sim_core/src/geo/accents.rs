//! accents.rs · 地表装饰系统（D-A 装饰系统基础，v1.48.0；★ D-B1-5 补齐 RockCluster/GrassTuft；
//! ★ S7-03 草原草甸斑块化散布与孤树压制）
//!
//! 装饰层是独立于地貌特征（`TerrainFeature`）之外的纯视觉要素集合。
//! 使用独立 `accent_rng` 加盐生成，不消费模拟 RNG、不参与通行/资源/碰撞计算。
//! ★ S7-03：`grassland_plain_v1` 走专属预算与斑块调制分支（见 `GRASSLAND_*` 常数与
//! `grass_patch_field`）——只改该 profile 的装饰分布，T1/T2 路径零引用、逐位不变。
//!
//! # 四处同步
//! 装饰数据需要同步四处（根 AGENTS.md §4.5）：
//! 1. `snapshot.rs`（`TerrainAccentSnapshot`）
//! 2. `world_snapshot.rs`（JSON 赋值）
//! 3. `snapshot_bin/encode.rs`（FABS Section 21 编码）
//! 4. `frontend/js/snapshot-bin.js`（FABS Section 21 解码）

use super::biome::SurfaceKind;
use super::terrain::TERRAIN_PROFILE_GRASSLAND_PLAIN;
use crate::rng::WorldRng;
use crate::spatial::vec3::Vec3;
use serde::{Deserialize, Serialize};

/// 装饰 RNG 盐值："ACCNT01"
pub const ACCENT_RNG_SALT: u64 = 0x4143_4345_4E54_3031;

/// 装饰物种类。D-A 阶段实现 Tree/Boulder/Bush；★ D-B1-5 补齐 RockCluster/GrassTuft 生成。
///
/// 生成固定顺序（06 号文 §5.5）：Tree → Boulder → Bush → RockCluster → GrassTuft。
/// 新增种类只允许追加在尾部，不得插入既有段之间（会改变 accent_rng 消费顺序）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AccentKind {
    Tree = 0,
    Bush = 1,
    Boulder = 2,
    RockCluster = 3,
    GrassTuft = 4,
}

impl AccentKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Tree => "Tree",
            Self::Bush => "Bush",
            Self::Boulder => "Boulder",
            Self::RockCluster => "RockCluster",
            Self::GrassTuft => "GrassTuft",
        }
    }
}

/// 单个地表装饰物。纯视觉要素，不影响通行/资源/碰撞。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainAccent {
    pub id: u32,
    pub kind: AccentKind,
    pub pos: Vec3,
    /// 视觉缩放倍率 0.7 ~ 1.4
    pub scale: f32,
    /// 旋转弧度 0 ~ 2π
    pub rotation_rad: f32,
    /// 色调变体：0=默认, 1=偏黄(秋季), 2=偏红(深秋)。由前端按季节设置。
    pub tint: u8,
}

/// 装饰生成的基础数量配置（density=1.0 时的目标数量）
const BASE_TREE_COUNT: usize = 40;
const BASE_BOULDER_COUNT: usize = 20;
const BASE_BUSH_COUNT: usize = 25;
/// ★ D-B1-5（06 号文 §5.5）：RockCluster / GrassTuft 基础目标数量。
/// RockCluster 由前端按 anchor 派生 2–5 颗子石，内核只下发 anchor，数量宜少于 Boulder；
/// GrassTuft 承担草甸辨识度，允许高密度。
const BASE_ROCK_CLUSTER_COUNT: usize = 12;
const BASE_GRASS_TUFT_COUNT: usize = 60;

/// 候选点最大重试次数 = 3x 目标总数（防死循环）
const MAX_RETRY_FACTOR: usize = 3;

// ── ★ S7-03（STAGE-07-TODO S7-03）平地草原草甸预算与斑块调制常数 ──
// 只被 `is_grassland` 分支消费，T1/T2 装饰路径零引用（输出逐位不变）；
// 装饰是纯视觉要素，改值不递增 `TERRAIN_GENERATOR_VERSION`、不动快照结构。
/// 孤树意象：草原 Tree 预算压至普通地图的 20%（06 号 §4.1「少量孤树」）。
const GRASSLAND_TREE_BUDGET_RATIO: f32 = 0.2;
/// 高密度草甸：草原 GrassTuft 预算 ×8（60 → 480 @density=1.0，受
/// `config.terrain_accent_density` 乘子继续调制；斑块调制只改分布不改总量）。
const GRASSLAND_GRASS_TUFT_BUDGET_RATIO: f32 = 8.0;
/// 草甸斑块大频波长（米）：圈出「草甸群落」的宏观走向。
const GRASS_PATCH_LAMBDA_LARGE_M: f32 = 95.0;
/// 草甸斑块小频波长（米）：群落内部深浅交错的次级斑块。
const GRASS_PATCH_LAMBDA_SMALL_M: f32 = 26.0;
/// 斑块大频固定盐值 "GRSPATL1"（8 ASCII 字符打包 u64，风格同 `ACCENT_RNG_SALT`）。
/// 一经落地永不更改——改盐值等于换图（同种子草原装饰不再复现）。
const SALT_GRASS_PATCH_LARGE: u64 = 0x4752_5350_4154_4C31;
/// 斑块小频固定盐值 "GRSPATS1"。同上，永不更改。
const SALT_GRASS_PATCH_SMALL: u64 = 0x4752_5350_4154_5331;

/// 使用独立 accent_rng 在地形表面散布装饰物。
///
/// 在创世流水线第 8 步调用（★ STAGE2-3；地貌与水系定稿后、路网/房屋/POI 尚未放置，
/// 故只根据地表的表面类别/坡度/肥力做禁区过滤）。
///
/// ★ S7-03：`grassland_plain_v1` 走专属分支——Tree 预算压至 20%（孤树）、
/// GrassTuft 预算 ×8 并经「双频哈希斑块 × 残丘坡度疏草」调制分布、
/// Bush 向泉溪洼地凹圈（`SoftGround` 软地带）聚集。草原无水面（S7-02），
/// 深水/浅水过滤天然恒真。T1/T2 的预算与偏好判定完全不变。
pub fn generate_accents(
    terrain: &super::terrain::TerrainMap,
    density: f32,
    seed: u64,
) -> Vec<TerrainAccent> {
    let mut accents = Vec::new();
    let mut accent_rng = WorldRng::new(seed ^ ACCENT_RNG_SALT);

    if density <= 0.0 {
        return accents;
    }

    let density = density.clamp(0.0, 2.0);
    // ★ S7-03 草原专属预算倍率（Tree ×0.2 / GrassTuft ×8；其余种类与通用一致，
    // Bush 聚集靠偏好而非预算，总量仍受控）。
    let is_grassland = terrain.profile == TERRAIN_PROFILE_GRASSLAND_PLAIN;
    let tree_ratio = if is_grassland { GRASSLAND_TREE_BUDGET_RATIO } else { 1.0 };
    let grass_tuft_ratio =
        if is_grassland { GRASSLAND_GRASS_TUFT_BUDGET_RATIO } else { 1.0 };
    let tree_count = ((BASE_TREE_COUNT as f32) * tree_ratio * density).round() as usize;
    let boulder_count = ((BASE_BOULDER_COUNT as f32) * density).round() as usize;
    let bush_count = ((BASE_BUSH_COUNT as f32) * density).round() as usize;
    let rock_cluster_count = ((BASE_ROCK_CLUSTER_COUNT as f32) * density).round() as usize;
    let grass_tuft_count =
        ((BASE_GRASS_TUFT_COUNT as f32) * grass_tuft_ratio * density).round() as usize;
    let total_target = tree_count + boulder_count + bush_count + rock_cluster_count + grass_tuft_count;
    let max_retries = total_target * MAX_RETRY_FACTOR;

    let world_size = terrain.world_size;
    let half_size = world_size / 2.0;

    let mut id_counter = 0u32;

    // Tree 生成
    generate_accents_of_kind(
        &mut accents,
        &mut id_counter,
        AccentKind::Tree,
        tree_count,
        max_retries,
        terrain,
        half_size,
        &mut accent_rng,
        |_wx, _wy, cell, rng| {
            // ★ v1.49.3 放宽：平地（含 0 坡）与河流两岸（河滩/河阶，喜湿）均可生树，
            // 仅仍排除水面/岩壁等禁区（外层已过滤 NO_WALK/水体）
            match cell.surface_kind {
                SurfaceKind::DryGround | SurfaceKind::SoftGround => {
                    if cell.slope_angle_deg > 32.0 {
                        return false;
                    }
                    // 肥力加权：高肥力更高概率
                    let fertility_weight = cell.natural_fertility;
                    rng.gen_range(0.0, 1.0) < fertility_weight
                }
                SurfaceKind::RiverTerrace => {
                    // 河阶：地势平缓湿润，按肥力高概率接受
                    if cell.slope_angle_deg > 32.0 {
                        return false;
                    }
                    rng.gen_range(0.0, 1.0) < (cell.natural_fertility * 0.5 + 0.5)
                }
                SurfaceKind::RiverBank => {
                    // 河滩：水分充沛，树木高概率扎根（河流地图从此有树）
                    rng.gen_range(0.0, 1.0) < 0.85
                }
                _ => false,
            }
        },
    );

    // Boulder 生成
    generate_accents_of_kind(
        &mut accents,
        &mut id_counter,
        AccentKind::Boulder,
        boulder_count,
        max_retries,
        terrain,
        half_size,
        &mut accent_rng,
        |_wx, _wy, cell, rng| {
            // Boulder 偏好陡坡与裸露 RockFace。
            // ★ v1.50.10 修复：原「slope>18 且 NO_BUILD」条件在两类地貌下几乎恒为假——
            // ① NO_BUILD 在河谷图被陆地基底（terrain.rs::generate_river_valley_base_relief，
            //    STAGE2-2 拆分前为 generate_river 全图重写）清零；且河谷重算后
            //    坡度普遍 <8°（河阶抬升 ≈5.7°、远丘 ≈2°）、全图无 RockFace（surface_kind 被重写）；
            // ② T1 山口图坡度构成（基础斜面 ≈4.5°/波形 ≈3~4°/主脊梯度 ≈10°）也极少超过 18°
            //    （无头实证：T1 Seed=999 修复前仅 1 颗、T2 各 Seed 均为 0）。
            // 装饰是纯视觉要素，不参与通行/建造判定，故只依赖坡度本身，门槛降至 10°。
            if cell.slope_angle_deg > 18.0 {
                return true;
            }
            if cell.slope_angle_deg > 10.0 {
                return rng.gen_range(0.0, 1.0) < 0.6;
            }
            // 河谷图补充：巨石以「河滩卵石 / 河阶散石」形态点缀平缓河谷
            match cell.surface_kind {
                SurfaceKind::RiverBank => rng.gen_range(0.0, 1.0) < 0.5,
                SurfaceKind::RiverTerrace => rng.gen_range(0.0, 1.0) < 0.25,
                _ => false,
            }
        },
    );

    // Bush 生成
    generate_accents_of_kind(
        &mut accents,
        &mut id_counter,
        AccentKind::Bush,
        bush_count,
        max_retries,
        terrain,
        half_size,
        &mut accent_rng,
        |wx, wy, cell, rng| {
            if is_grassland {
                // ★ S7-03 草原：泉溪洼地凹圈（S7-02 落地的 SoftGround 环带）周围聚集
                //   灌木，形成水源的视觉提示——候选点本格或 25m 六向邻点命中软地即视为
                //   「洼地邻域」高概率接受，开阔干地只零星点缀（预算不变、聚集靠偏好；
                //   邻域探测是纯地形查询，不消费 accent_rng、不写任何格子）。
                let near_soft = match cell.surface_kind {
                    SurfaceKind::SoftGround => true,
                    SurfaceKind::DryGround => (0..6).any(|k| {
                        let ang = std::f32::consts::TAU * k as f32 / 6.0;
                        terrain
                            .sample_cell(wx + 25.0 * ang.cos(), wy + 25.0 * ang.sin())
                            .surface_kind
                            == SurfaceKind::SoftGround
                    }),
                    _ => false,
                };
                return rng.gen_range(0.0, 1.0) < if near_soft { 0.85 } else { 0.12 };
            }
            // Bush 偏好林缘过渡带（SoftGround 且肥力中等）
            if cell.surface_kind == SurfaceKind::SoftGround {
                return rng.gen_range(0.0, 1.0) < 0.7;
            }
            if cell.surface_kind == SurfaceKind::DryGround && cell.natural_fertility > 0.55 {
                return rng.gen_range(0.0, 1.0) < 0.4;
            }
            // ★ v1.49.3 河滩/河阶灌丛：喜湿低矮灌丛点缀河流两岸
            if cell.surface_kind == SurfaceKind::RiverBank {
                return rng.gen_range(0.0, 1.0) < 0.6;
            }
            if cell.surface_kind == SurfaceKind::RiverTerrace {
                return rng.gen_range(0.0, 1.0) < 0.5;
            }
            false
        },
    );

    // ★ D-B1-5（06 号文 §5.5）：RockCluster 生成（固定顺序第 4 段）
    generate_accents_of_kind(
        &mut accents,
        &mut id_counter,
        AccentKind::RockCluster,
        rock_cluster_count,
        max_retries,
        terrain,
        half_size,
        &mut accent_rng,
        |_wx, _wy, cell, rng| {
            // 候选地表（§5.5 表）：RiverBank/RiverTerrace 卵石群，或坡度 ≥ 8° 的干地裸岩群。
            // 内核只下发 anchor，2–5 颗子石由前端按 accent.id 派生（§5.5），
            // 不为子石建实体、不改变碰撞/路面——本函数天然满足（纯视觉装饰）。
            // ★ S7-03 草原：残丘坡面（坡度 ≥ 8° 的 DryGround）天然命中裸岩群分支。
            match cell.surface_kind {
                SurfaceKind::RiverBank => rng.gen_range(0.0, 1.0) < 0.4,
                SurfaceKind::RiverTerrace => rng.gen_range(0.0, 1.0) < 0.25,
                SurfaceKind::DryGround => cell.slope_angle_deg >= 8.0,
                _ => false,
            }
        },
    );

    // ★ D-B1-5（06 号文 §5.5）：GrassTuft 生成（固定顺序第 5 段）
    generate_accents_of_kind(
        &mut accents,
        &mut id_counter,
        AccentKind::GrassTuft,
        grass_tuft_count,
        max_retries,
        terrain,
        half_size,
        &mut accent_rng,
        |wx, wy, cell, rng| {
            // 候选地表（§5.5 表）：DryGround/SoftGround/RiverTerrace 且坡度 < 24°；
            // 深水/浅水/NO_WALK 已由 generate_accents_of_kind 外层禁区过滤排除。
            // 草丛是纯视觉要素，不得被当作湿地/水源/可采资源（本层不写任何格子）。
            if cell.slope_angle_deg >= 24.0 {
                return false;
            }
            if is_grassland {
                // ★ S7-03 草甸斑块化：双频哈希值噪声（大频 95m 群落走向 + 小频 26m
                //   深浅斑块）调制接受概率（0.25~1.15，均值 ≈0.7），形成深浅交错的
                //   草甸群落而非均匀撒点；残丘坡面（坡度 6°→14°）线性疏草露土，
                //   泉洼软地（SoftGround）略密。纯函数调制不消费 accent_rng 额外流。
                let base = if cell.surface_kind == SurfaceKind::SoftGround { 0.95 } else { 0.90 };
                let slope_k =
                    1.0 - 0.85 * ((cell.slope_angle_deg - 6.0) / 8.0).clamp(0.0, 1.0);
                let patch_k = 0.25 + 0.90 * grass_patch_field(wx, wy, seed);
                return rng.gen_range(0.0, 1.0) < base * slope_k * patch_k;
            }
            match cell.surface_kind {
                SurfaceKind::DryGround => rng.gen_range(0.0, 1.0) < 0.8,
                SurfaceKind::SoftGround => rng.gen_range(0.0, 1.0) < 0.9,
                SurfaceKind::RiverTerrace => rng.gen_range(0.0, 1.0) < 0.7,
                _ => false,
            }
        },
    );

    // 按 id 排序输出（确保确定性）
    accents.sort_by_key(|a| a.id);
    accents
}

/// 草甸斑块单格点哈希值（[0,1)）：世界种子 + 频段盐值 + 整数格坐标混合。
/// 与 `plan_subfeatures` 同一纪律——禁用 `DefaultHasher`/浮点哈希/系统时间，
/// 只依赖整数运算，跨平台逐位确定。
fn grass_patch_value(ix: i64, iy: i64, seed: u64, salt: u64) -> f32 {
    let m = super::terrain::mix64(
        seed
            ^ salt
            ^ (ix as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
            ^ (iy as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F),
    );
    ((m >> 11) as f64 / (1u64 << 53) as f64) as f32
}

/// 单频平滑值噪声：格点哈希值场经五次 Hermite 样条双线性插值（与
/// `terrain_noise::gradient_noise_2d` 同款平滑核，二阶导连续、无格网接缝）。
fn smooth_patch_field(wx: f32, wy: f32, lambda_m: f32, seed: u64, salt: u64) -> f32 {
    let gx = wx / lambda_m;
    let gy = wy / lambda_m;
    let x0 = gx.floor();
    let y0 = gy.floor();
    let fx = gx - x0;
    let fy = gy - y0;
    let sx = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
    let sy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);
    let ix = x0 as i64;
    let iy = y0 as i64;
    let v00 = grass_patch_value(ix, iy, seed, salt);
    let v10 = grass_patch_value(ix + 1, iy, seed, salt);
    let v01 = grass_patch_value(ix, iy + 1, seed, salt);
    let v11 = grass_patch_value(ix + 1, iy + 1, seed, salt);
    let a = v00 + (v10 - v00) * sx;
    let b = v01 + (v11 - v01) * sx;
    a + (b - a) * sy
}

/// ★ S7-03 草甸斑块场（[0,1]，均值 ≈0.5）：双频哈希值噪声叠加——
/// 大频（95m）圈出草甸群落宏观走向，小频（26m）在群落内打出深浅斑块。
/// 纯函数：只依赖世界种子 + 固定盐值（`SALT_GRASS_PATCH_*`）与坐标，
/// 不消费任何 `WorldRng` 流、不写任何格子，同入参跨平台逐位一致。
fn grass_patch_field(wx: f32, wy: f32, seed: u64) -> f32 {
    0.62 * smooth_patch_field(wx, wy, GRASS_PATCH_LAMBDA_LARGE_M, seed, SALT_GRASS_PATCH_LARGE)
        + 0.38 * smooth_patch_field(wx, wy, GRASS_PATCH_LAMBDA_SMALL_M, seed, SALT_GRASS_PATCH_SMALL)
}

/// 生成指定种类和数量的装饰物
fn generate_accents_of_kind<F>(
    accents: &mut Vec<TerrainAccent>,
    id_counter: &mut u32,
    kind: AccentKind,
    target: usize,
    max_retries: usize,
    terrain: &super::terrain::TerrainMap,
    half_size: f32,
    rng: &mut WorldRng,
    accept: F,
) where
    // ★ S7-03 起闭包追加候选点世界坐标 (wx, wy)——草原草甸斑块调制需要位置输入；
    // 既有偏好判定忽略这两参，RNG 消费次数与顺序不变（T1/T2 逐位不受影响）。
    F: Fn(f32, f32, &super::biome::GeoCell, &mut WorldRng) -> bool,
{
    let mut generated = 0;
    let mut retries = 0;

    while generated < target && retries < max_retries {
        retries += 1;

        // 随机候选点
        let wx = rng.gen_range(-half_size, half_size);
        let wy = rng.gen_range(-half_size, half_size);

        // 查地表
        let cell = terrain.sample_cell(wx, wy);

        // 禁区检查：水、岩壁、禁行地表
        if cell.surface_kind == SurfaceKind::DeepWater
            || cell.surface_kind == SurfaceKind::ShallowWater
        {
            continue;
        }
        // ★ v1.50.10：RockFace 必打 NO_WALK，但对 Boulder 是目标地表而非禁区——
        // 岩壁巨石属纯视觉装饰，放行到偏好检查（RockFace → 直接接受）
        if cell.feature_flags & super::biome::TERRAIN_FLAG_NO_WALK != 0
            && !(kind == AccentKind::Boulder && cell.surface_kind == SurfaceKind::RockFace)
        {
            continue;
        }

        // 偏好检查
        if !accept(wx, wy, cell, rng) {
            continue;
        }

        // 生成装饰
        let elevation = terrain.sample_elevation(wx, wy);
        let scale = rng.gen_range(0.7_f32, 1.4_f32);
        let rotation = rng.gen_range(0.0_f32, std::f32::consts::TAU);
        // tint 默认 0（季节调色由前端应用）

        accents.push(TerrainAccent {
            id: *id_counter,
            kind,
            pos: Vec3::new(wx, wy, elevation),
            scale,
            rotation_rad: rotation,
            tint: 0,
        });
        *id_counter += 1;
        generated += 1;
    }
}
