//! validation.rs · §5.3 第 7 步静态几何与稳定 ID 校验（★ STAGE2-4）。
//!
//! 全部为 **只读断言**：不修复、不排序、不改任何数据（06 号 §5.2「不在校验器里
//! 偷偷修复数据」）。失败码是 STAGE2-5 有界重试环的分派依据，一经发布语义不变。
//!
//! 校验范围（06 号 §5.2「待补全的集合校验」）：
//! 1. 结构 ID 唯一 + 按 profile 的 ID 归属（既有 `features` **保持生成顺序**，
//!    当前 T2 为 10、11、1、20、21、30——排序会改变快照字节，严禁在此重排）；
//! 2. `sub_features` ID 严格升序唯一（既有 `validate_sub_features_sorted_unique`）
//!    + `feature_ids` 引用存在 + accent 区间配对；
//! 3. 水体轮廓按**明确关联**验证：主河水体 1 ↔ `River` 特征 1（顶点双副本逐字节
//!    相等）；未来局部湖才对应 `WaterBody` 特征（枚举落地后收紧 kind 检查），
//!    不得要求主河匹配不存在的 WaterBody 枚举记录；
//! 4. 取水点 / 浅滩授权走廊引用存在、顶点在界、浅滩端点在陆侧；
//! 5. cells 水域归属与 NO_WALK/NO_BUILD 通行标志一致。
//!
//! 兼容性边界：全部规则对当前 T1/T2/草原/半坡矩阵必须平凡通过；新增会拒绝
//! 旧合法世界的规则按行为变更拆分并评估版本（STAGE2-TODO §STAGE2-4）。

use super::biome::{SurfaceKind, TERRAIN_FLAG_NO_BUILD, TERRAIN_FLAG_NO_WALK};
use super::terrain::{
    TerrainFeatureKind, TerrainMap, TERRAIN_PROFILE_GRASSLAND_PLAIN, TERRAIN_PROFILE_HILLSIDE_WOODLAND,
    TERRAIN_PROFILE_MOUNTAIN_PASS, TERRAIN_PROFILE_RIVER_VALLEY,
};

use crate::spatial::vec3::Vec3;

/// 顶点越界判定的宽容余量（米）：只拦截明显出界的几何，不卡良性浮点抖动。
const BOUND_EPSILON_M: f32 = 0.5;

/// 已知 profile 的 `TerrainFeature` 稳定 ID 归属表：id → 期望 kind。
/// 未登记的 ID 不允许出现（T2 核心水系「绝不重排」，06 号 §5.2 ID 表）；
/// 未来子特征 ID 段（T1 100–127 / T2 200–227）由调用方另行放行。
fn expected_feature_kind(profile: &str, id: u32) -> Option<TerrainFeatureKind> {
    match profile {
        TERRAIN_PROFILE_RIVER_VALLEY => match id {
            1 => Some(TerrainFeatureKind::River),
            10 | 11 => Some(TerrainFeatureKind::ShallowFord),
            20 | 21 => Some(TerrainFeatureKind::RiverBank),
            30 => Some(TerrainFeatureKind::SpringValley),
            _ => None,
        },
        // 草原 / 半坡：仅泉眼特征（第 2 步洼地安置 `30 + i`，i ∈ 0..2）。
        TERRAIN_PROFILE_GRASSLAND_PLAIN | TERRAIN_PROFILE_HILLSIDE_WOODLAND => match id {
            30 | 31 => Some(TerrainFeatureKind::SpringValley),
            _ => None,
        },
        // 山口：现状零特征；未来 D-B2 子特征走 100–127 段（由调用方放行）。
        TERRAIN_PROFILE_MOUNTAIN_PASS => None,
        // 未知 / 未来 profile：不做归属断言（避免拒绝尚未登记的合法布局）。
        _ => None,
    }
}

/// 已知 profile 的子特征 `TerrainFeature` ID 段（06 号 §5.2 ID 分区表）。
fn sub_feature_id_range(profile: &str) -> Option<(u32, u32)> {
    match profile {
        TERRAIN_PROFILE_MOUNTAIN_PASS => Some((100, 127)),
        TERRAIN_PROFILE_RIVER_VALLEY => Some((200, 227)),
        _ => None,
    }
}

/// §5.3 第 7 步入口：依次执行特征 / 子特征 / 水系与 cells 四组断言。
pub(crate) fn validate_static_terrain_geometry(t: &TerrainMap) -> Result<(), &'static str> {
    validate_features(t)?;
    validate_sub_features(t)?;
    validate_hydrology(t)?;
    validate_cells(t)?;
    validate_accents(t)?;
    Ok(())
}

/// 断言 1：`features` ID 唯一、按 profile 归属且 kind 与 ID 表一致、顶点在界。
fn validate_features(t: &TerrainMap) -> Result<(), &'static str> {
    let half = t.world_size * 0.5;
    let mut seen: Vec<u32> = Vec::with_capacity(t.features.len());
    for f in &t.features {
        if seen.contains(&f.id) {
            return Err("FeatureIdsDuplicated");
        }
        seen.push(f.id);
        if let Some(expect) = expected_feature_kind(&t.profile, f.id) {
            if f.kind != expect {
                return Err("FeatureIdKindMismatch");
            }
        } else if !matches!(sub_feature_id_range(&t.profile), Some((lo, hi)) if f.id >= lo && f.id <= hi)
        {
            return Err("FeatureIdOwnershipInvalid");
        }
        if f.vertices.is_empty() || !vertices_bounded(&f.vertices, half) || !f.elevation.is_finite()
        {
            return Err("FeatureVerticesInvalid");
        }
    }
    Ok(())
}

/// 断言 2：`sub_features` 升序唯一 + 引用存在 + accent 区间配对。
fn validate_sub_features(t: &TerrainMap) -> Result<(), &'static str> {
    t.validate_sub_features_sorted_unique()
        .map_err(|_| "SubFeatureIdsUnsortedOrDuplicated")?;
    for sf in &t.sub_features {
        let mut prev: Option<u32> = None;
        for fid in &sf.feature_ids {
            if let Some(p) = prev {
                if *fid <= p {
                    return Err("SubFeatureReferenceMissing");
                }
            }
            if !t.features.iter().any(|f| f.id == *fid) {
                return Err("SubFeatureReferenceMissing");
            }
            prev = Some(*fid);
        }
        match (sf.accent_id_start, sf.accent_id_end) {
            (None, None) => {}
            (Some(s), Some(e)) if s <= e => {}
            _ => return Err("SubFeatureAccentRangeInvalid"),
        }
    }
    Ok(())
}

/// 断言 3：水系引用完整性 + 水体轮廓双副本一致 + 浅滩端点在陆侧。
fn validate_hydrology(t: &TerrainMap) -> Result<(), &'static str> {
    let half = t.world_size * 0.5;
    let mut wb_ids: Vec<u32> = Vec::with_capacity(t.hydrology.water_bodies.len());
    for wb in &t.hydrology.water_bodies {
        if wb_ids.contains(&wb.id) {
            return Err("WaterBodyIdDuplicated");
        }
        wb_ids.push(wb.id);
        if wb.vertices.is_empty() || !vertices_bounded(&wb.vertices, half) || !wb.level.is_finite()
        {
            return Err("WaterBodyOutlineInvalid");
        }
        // 明确关联：水体轮廓必须有一份同 id 的 `TerrainFeature` 副本，逐字节相等。
        // 主河水体 1 的特征 kind 必须是 `River`（水面多边形）；未来局部湖对应
        // `WaterBody` 特征——该枚举变体随 D-B2 落地，在此之前不按 kind 拒绝其他水体。
        let Some(feat) = t.features.iter().find(|f| f.id == wb.id) else {
            return Err("WaterBodyFeatureMissing");
        };
        if wb.id == 1 && feat.kind != TerrainFeatureKind::River {
            return Err("WaterBodyFeatureMissing");
        }
        if feat.vertices != wb.vertices {
            return Err("WaterBodyOutlineMismatch");
        }
    }
    // 取水点：水体引用存在 + 落位在界。
    for ap in &t.hydrology.access_points {
        if !wb_ids.contains(&ap.water_body_id) || !pos_bounded(&ap.pos, half) {
            return Err("AccessPointInvalid");
        }
    }
    // 浅滩授权走廊：ID 唯一、端点在界、宽度有效。
    let mut conn_ids: Vec<u32> = Vec::with_capacity(t.hydrology.connections.len());
    for c in &t.hydrology.connections {
        if conn_ids.contains(&c.id) {
            return Err("ConnectionIdDuplicated");
        }
        conn_ids.push(c.id);
        if !pos_bounded(&c.start, half) || !pos_bounded(&c.end, half) || !(c.width.is_finite() && c.width > 0.0)
        {
            return Err("ConnectionInvalid");
        }
    }
    // 浅滩特征端点必须在陆侧（读档校验与 corridor 授权都依赖此事实）。
    for f in &t.features {
        if f.kind != TerrainFeatureKind::ShallowFord {
            continue;
        }
        if f.vertices.len() != 2 {
            return Err("FordEndpointInvalid");
        }
        for v in &f.vertices {
            let (gx, gy) = t.grid_index(v.x, v.y);
            let c = &t.cells[gy * t.grid_width + gx];
            if c.water_body_id.is_some()
                || matches!(c.surface_kind, SurfaceKind::DeepWater | SurfaceKind::ShallowWater)
            {
                return Err("FordEndpointNotOnLand");
            }
        }
    }
    Ok(())
}

/// 断言 4：cells 水域归属与通行/禁建标志一致。
///
/// 阈值即物理契约（与第 6 步派生及 T2 水系写入一致）：
/// DeepWater ⇒ 有水体归属 + NO_WALK|NO_BUILD；ShallowWater ⇒ 有水体归属 +
/// NO_BUILD 且**不** NO_WALK（跨河授权通道）；RockFace ⇒ 无水体 + NO_WALK；
/// NO_WALK 只允许出现在 DeepWater / RockFace 上。
fn validate_cells(t: &TerrainMap) -> Result<(), &'static str> {
    for c in &t.cells {
        if !c.elevation.is_finite()
            || !c.slope_angle_deg.is_finite()
            || !c.natural_fertility.is_finite()
            || !(0.0..=1.0).contains(&c.natural_fertility)
        {
            return Err("CellFieldNotFinite");
        }
        let no_walk = c.feature_flags & TERRAIN_FLAG_NO_WALK != 0;
        let no_build = c.feature_flags & TERRAIN_FLAG_NO_BUILD != 0;
        let mismatch = match c.surface_kind {
            SurfaceKind::DeepWater => c.water_body_id.is_none() || !no_walk || !no_build,
            SurfaceKind::ShallowWater => {
                c.water_body_id.is_none() || !no_build || no_walk
            }
            SurfaceKind::RockFace => c.water_body_id.is_some() || !no_walk,
            _ => c.water_body_id.is_some() || no_walk,
        };
        if mismatch {
            return Err("CellWaterFlagMismatch");
        }
    }
    Ok(())
}

/// 断言 5：通用装饰 ID 连续（0..N-1）。第 7 步执行时装饰尚未散布（恒空、平凡通过）；
/// 本断言供存档加载路径复用整套校验时兜底（06 号 §5.2「accents 保持既有连续顺序」）。
fn validate_accents(t: &TerrainMap) -> Result<(), &'static str> {
    for (i, a) in t.accents.iter().enumerate() {
        if a.id != i as u32 {
            return Err("AccentIdsNonSequential");
        }
    }
    Ok(())
}

fn vertices_bounded(vertices: &[Vec3], half: f32) -> bool {
    vertices.iter().all(|v| pos_bounded(v, half))
}

fn pos_bounded(v: &Vec3, half: f32) -> bool {
    let lim = half + BOUND_EPSILON_M;
    v.x.is_finite() && v.y.is_finite() && v.z.is_finite() && v.x.abs() <= lim && v.y.abs() <= lim
}
