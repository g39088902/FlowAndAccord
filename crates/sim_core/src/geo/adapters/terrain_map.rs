//! UGC-03 migration adapter from compiled fields to the legacy `TerrainMap` view.
//!
//! The adapter is deliberately one-way: recipes and compiled fields remain the
//! source of truth, while `TerrainMap` is populated only for existing query,
//! ecology, snapshot and renderer consumers. Legacy feature polygons are not
//! invented here; cell semantics are sufficient for the heightfield path and
//! keep the old feature ID protocol valid for fallback worlds.

use crate::geo::backend::HeightfieldBackend;
use crate::geo::procedural::CompiledTerrain;
use crate::geo::terrain::TerrainMap;
use crate::spatial::vec3::Vec3;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TerrainMigrationDiff {
    pub elevation_max_abs_error: f32,
    pub surface_differences: usize,
    pub water_id_differences: usize,
}

/// Convert a compiled heightfield into the compatibility map consumed by the
/// existing world systems. All row-major cell indices are copied exactly once.
pub fn terrain_map_from_compiled(compiled: &CompiledTerrain, seed: u64) -> TerrainMap {
    let backend = HeightfieldBackend::from_compiled(compiled, compiled.world_size);
    let mut map = backend.to_terrain_map(seed, &compiled.recipe_id);
    for (cell, water_id) in map
        .cells
        .iter_mut()
        .zip(compiled.semantics.water_body_id.iter().copied())
    {
        cell.water_body_id = water_id;
    }
    map
}

/// Compare the migrated field projection with a legacy map for diagnostics.
/// This does not decide whether a migration is acceptable; recipe gates own
/// that policy and can record this stable report alongside creation diagnostics.
pub fn compare_recipe_to_legacy(
    migrated: &TerrainMap,
    legacy: &TerrainMap,
) -> TerrainMigrationDiff {
    let n = migrated.cells.len().min(legacy.cells.len());
    let mut elevation_max_abs_error: f32 = 0.0;
    let mut surface_differences = 0;
    let mut water_id_differences = 0;
    for i in 0..n {
        elevation_max_abs_error = elevation_max_abs_error
            .max((migrated.cells[i].elevation - legacy.cells[i].elevation).abs());
        surface_differences +=
            usize::from(migrated.cells[i].surface_kind != legacy.cells[i].surface_kind);
        water_id_differences +=
            usize::from(migrated.cells[i].water_body_id != legacy.cells[i].water_body_id);
    }
    TerrainMigrationDiff {
        elevation_max_abs_error,
        surface_differences: surface_differences + migrated.cells.len().saturating_sub(n),
        water_id_differences: water_id_differences + migrated.cells.len().saturating_sub(n),
    }
}

/// Project a row-major cell into world space for adapter diagnostics and
/// downstream migration tooling.
pub fn cell_world_position(map: &TerrainMap, index: usize) -> Option<Vec3> {
    (index < map.cells.len()).then(|| map.grid_pos(index % map.grid_width, index / map.grid_width))
}
