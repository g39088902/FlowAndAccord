//! validation.rs · §5.3 第 7 步静态几何与稳定 ID 校验（★ STAGE2-4）。
//!
//! 全部为 **只读断言**：不修复、不排序、不改任何数据（06 号 §5.2「不在校验器里
//! 偷偷修复数据」）。失败码是 STAGE2-5 有界重试环的分派依据，一经发布语义不变。
//!
//! 地图不再产出任何程序生成水面，故水域/湖泊/取水点/深水格相关的断言已删除；
//! 保留的校验范围：
//! 1. 结构 ID 唯一 + 按 profile 的 ID 归属（既有 `features` **保持生成顺序**）；
//! 2. `sub_features` ID 严格升序唯一 + `feature_ids` 引用存在 + accent 区间配对；
//! 3. 授权走廊（`hydrology.connections`）ID 唯一、端点在界、宽度有效；
//! 4. cells 字段有限且通行/禁建标志与地表类别一致；
//! 5. 通用装饰 ID 按数组顺序严格递增且唯一（POI 避让过滤可留下 ID 间隙）。

use super::biome::{SurfaceKind, TERRAIN_FLAG_NO_WALK};
use super::terrain::{TerrainMap, TERRAIN_PROFILE_MOUNTAIN_PASS};

use crate::spatial::vec3::Vec3;

/// 顶点越界判定的宽容余量（米）：只拦截明显出界的几何，不卡良性浮点抖动。
const BOUND_EPSILON_M: f32 = 0.5;

/// 已知 profile 的子特征 `TerrainFeature` ID 段（06 号 §5.2 ID 分区表）。
fn sub_feature_id_range(profile: &str) -> Option<(u32, u32)> {
    match profile {
        TERRAIN_PROFILE_MOUNTAIN_PASS => Some((100, 127)),
        _ => None,
    }
}

/// §5.3 第 7 步入口：依次执行特征 / 子特征 / 走廊 / cells / 装饰五组断言。
pub(crate) fn validate_static_terrain_geometry(t: &TerrainMap) -> Result<(), &'static str> {
    if t.field_compiled {
        return validate_compiled_static_terrain(t);
    }
    validate_features(t)?;
    validate_sub_features(t)?;
    validate_hydrology(t)?;
    validate_cells(t)?;
    validate_accents(t)?;
    Ok(())
}

/// Field compiler maps carry no legacy profile IDs or water geometry; only the
/// shared cell/flag and accent invariants apply.
fn validate_compiled_static_terrain(t: &TerrainMap) -> Result<(), &'static str> {
    validate_cells(t)?;
    validate_accents(t)
}

/// 断言 1：`features` ID 唯一、按 profile 归属、顶点在界。
fn validate_features(t: &TerrainMap) -> Result<(), &'static str> {
    let half = t.world_size * 0.5;
    let mut seen: Vec<u32> = Vec::with_capacity(t.features.len());
    for f in &t.features {
        if seen.contains(&f.id) {
            return Err("FeatureIdsDuplicated");
        }
        seen.push(f.id);
        if !matches!(sub_feature_id_range(&t.profile), Some((lo, hi)) if f.id >= lo && f.id <= hi)
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

/// 断言 3：授权走廊 ID 唯一、端点在界、宽度有效。
fn validate_hydrology(t: &TerrainMap) -> Result<(), &'static str> {
    let half = t.world_size * 0.5;
    let mut conn_ids: Vec<u32> = Vec::with_capacity(t.hydrology.connections.len());
    for c in &t.hydrology.connections {
        if conn_ids.contains(&c.id) {
            return Err("ConnectionIdDuplicated");
        }
        conn_ids.push(c.id);
        if !pos_bounded(&c.start, half)
            || !pos_bounded(&c.end, half)
            || !(c.width.is_finite() && c.width > 0.0)
        {
            return Err("ConnectionInvalid");
        }
    }
    Ok(())
}

/// 断言 4：cells 字段有限且通行/禁建标志与地表类别一致。
///
/// 地图不再产出水面，故只剩 `RockFace` 硬禁行这一条自然地表事实：
/// RockFace ⇒ 无水体 + NO_WALK；NO_WALK 只允许出现在 RockFace 上。
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
        let mismatch = match c.surface_kind {
            SurfaceKind::RockFace => c.water_body_id.is_some() || !no_walk,
            _ => c.water_body_id.is_some() || no_walk,
        };
        if mismatch {
            return Err("CellWaterFlagMismatch");
        }
    }
    Ok(())
}

/// 断言 5：通用装饰 ID 按数组顺序严格递增且唯一；POI 避让过滤可留下 ID 间隙。
/// 第 7 步执行时装饰尚未散布（恒空、平凡通过）；本断言也供存档加载路径复用。
fn validate_accents(t: &TerrainMap) -> Result<(), &'static str> {
    let mut previous_id = None;
    for accent in &t.accents {
        if previous_id.is_some_and(|id| accent.id <= id) {
            return Err("AccentIdsNotStrictlyAscending");
        }
        previous_id = Some(accent.id);
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