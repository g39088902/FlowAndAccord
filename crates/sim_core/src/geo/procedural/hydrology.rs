//! Deterministic hydrology fields and their gameplay projection.
use super::fields::{Field2, FieldError};
use super::processes::{water_level_solve, WaterBodyField};
use super::semantics::SemanticGrid;
use crate::geo::biome::{SurfaceKind, TERRAIN_FLAG_NO_BUILD, TERRAIN_FLAG_NO_WALK};

#[derive(Debug, Clone, Copy)]
pub struct HydrologySettings {
    pub min_lake_depth_m: f32,
}
impl Default for HydrologySettings {
    fn default() -> Self {
        Self {
            min_lake_depth_m: 0.5,
        }
    }
}

#[derive(Debug, Clone)]
pub struct HydrologyFields {
    pub water: WaterBodyField,
}

pub fn water_level(elevation: &Field2, min_depth: f32) -> Result<WaterBodyField, FieldError> {
    water_level_solve(elevation, min_depth)
}

/// Only static lakes survive: the channel/river network was removed, so the
/// hydrology stage is a single priority-flood solve over the elevation field.
pub fn solve_hydrology(
    elevation: &Field2,
    settings: HydrologySettings,
) -> Result<HydrologyFields, FieldError> {
    let water = water_level_solve(elevation, settings.min_lake_depth_m)?;
    Ok(HydrologyFields { water })
}

/// Apply water facts after all continuous fields are stable. Existing hard
/// blocks are only strengthened; this projection never opens a blocked cell.
pub fn project_semantics(semantics: &mut SemanticGrid, water: &WaterBodyField) {
    let n = semantics.surface_kind.len();
    semantics.water_body_id = vec![None; n];
    semantics.water_depth = water.depth.clone();
    let lake_offset = n as u32 + 1;
    for i in 0..n {
        if let Some(id) = water.body_id[i] {
            semantics.surface_kind[i] = SurfaceKind::DeepWater;
            semantics.vegetation_ok[i] = false;
            semantics.flags[i] |= TERRAIN_FLAG_NO_WALK | TERRAIN_FLAG_NO_BUILD;
            semantics.water_body_id[i] = Some(lake_offset.saturating_add(id));
        }
        semantics.walk_mask.values[i] = if semantics.flags[i] & TERRAIN_FLAG_NO_WALK == 0 {
            1.0
        } else {
            0.0
        };
        semantics.build_mask.values[i] = if semantics.flags[i] & TERRAIN_FLAG_NO_BUILD == 0 {
            1.0
        } else {
            0.0
        };
    }
}