//! accents.rs · 地表装饰系统（D-A 装饰系统基础，v1.48.0）
//!
//! 装饰层是独立于地貌特征（`TerrainFeature`）之外的纯视觉要素集合。
//! 使用独立 `accent_rng` 加盐生成，不消费模拟 RNG、不参与通行/资源/碰撞计算。
//!
//! # 四处同步
//! 装饰数据需要同步四处（根 AGENTS.md §4.5）：
//! 1. `snapshot.rs`（`TerrainAccentSnapshot`）
//! 2. `world_snapshot.rs`（JSON 赋值）
//! 3. `snapshot_bin/encode.rs`（FABS Section 21 编码）
//! 4. `frontend/js/snapshot-bin.js`（FABS Section 21 解码）

use super::biome::SurfaceKind;
use crate::rng::WorldRng;
use crate::spatial::vec3::Vec3;
use serde::{Deserialize, Serialize};

/// 装饰 RNG 盐值："ACCNT01"
pub const ACCENT_RNG_SALT: u64 = 0x4143_4345_4E54_3031;

/// 装饰物种类。D-A 阶段实现 Tree/Boulder/Bush 三种。
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

/// 候选点最大重试次数 = 3x 目标总数（防死循环）
const MAX_RETRY_FACTOR: usize = 3;

/// 使用独立 accent_rng 在地形表面散布装饰物。
///
/// 在 generate_with_profile 末尾调用（此时路网/房屋/POI 尚未放置，
/// 故只根据地表的表面类别/坡度/肥力做禁区过滤）。
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
    let tree_count = ((BASE_TREE_COUNT as f32) * density).round() as usize;
    let boulder_count = ((BASE_BOULDER_COUNT as f32) * density).round() as usize;
    let bush_count = ((BASE_BUSH_COUNT as f32) * density).round() as usize;
    let total_target = tree_count + boulder_count + bush_count;
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
        |cell, rng| {
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
        |cell, rng| {
            // Boulder 偏好陡坡与裸露 RockFace
            if cell.surface_kind == SurfaceKind::RockFace {
                return true;
            }
            if cell.slope_angle_deg > 18.0
                && cell.feature_flags & super::biome::TERRAIN_FLAG_NO_BUILD != 0
            {
                return rng.gen_range(0.0, 1.0) < 0.6;
            }
            false
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
        |cell, rng| {
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

    // 按 id 排序输出（确保确定性）
    accents.sort_by_key(|a| a.id);
    accents
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
    F: Fn(&super::biome::GeoCell, &mut WorldRng) -> bool,
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
        if cell.feature_flags & super::biome::TERRAIN_FLAG_NO_WALK != 0 {
            continue;
        }

        // 偏好检查
        if !accept(cell, rng) {
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
