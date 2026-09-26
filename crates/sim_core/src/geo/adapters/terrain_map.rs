//! UGC-03 migration adapter from compiled fields to the legacy `TerrainMap` view.
//!
//! The adapter is deliberately one-way: recipes and compiled fields remain the
//! source of truth, while `TerrainMap` is populated only for existing query,
//! ecology, snapshot and renderer consumers. Compiled water semantics are
//! additionally projected to generic closed `WaterBody` contours so the
//! existing depth queue can render them without changing the snapshot protocol.

use crate::geo::backend::HeightfieldBackend;
use crate::geo::biome::SurfaceKind;
use crate::geo::procedural::CompiledTerrain;
use crate::geo::terrain::{TerrainFeature, TerrainFeatureKind, TerrainMap};
use crate::geo::hydrology::{WaterAccessPoint, WaterBody};
use crate::spatial::vec3::Vec3;
use std::collections::{BTreeMap, BTreeSet};

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
    append_compiled_water_features(&mut map, compiled);
    map
}

type GridPoint = (usize, usize);
type GridEdge = (GridPoint, GridPoint);

/// Project compiled water semantics into the polygon channel consumed by the
/// existing 2D depth queue. The field compiler intentionally has no legacy
/// feature objects, so the adapter traces each water body's outer grid contour
/// once. All vertices use shared half-cell coordinates, which keeps the water
/// polygon flush with the WebGL heightfield instead of leaving a grid halo.
fn append_compiled_water_features(map: &mut TerrainMap, compiled: &CompiledTerrain) {
    let ids: BTreeSet<u32> = compiled
        .semantics
        .water_body_id
        .iter()
        .flatten()
        .copied()
        .collect();
    if ids.is_empty() {
        return;
    }
    let width = compiled.semantics.width;
    let height = compiled.semantics.height;
    let mut next_access_id = 1u32;
    for body_id in ids {
        let edges = body_boundary_edges(&compiled.semantics.water_body_id, width, height, body_id);
        let Some(grid_polygon) = trace_boundary(edges) else {
            continue;
        };
        let level = water_body_level(compiled, body_id);
        let vertices: Vec<Vec3> = grid_polygon
            .iter()
            .map(|&(x, y)| {
                let (wx, wy) = boundary_world_position(x, y, width, height, compiled.world_size);
                Vec3::new(wx, wy, level)
            })
            .collect();
        if vertices.len() < 4 {
            continue;
        }
        // A traced contour is a generic closed polygon. Use WaterBody rather
        // than River because the legacy River renderer expects paired left and
        // right banks, while compiled contours may be lakes or branching
        // channels and are rendered by the tiled polygon path.
        map.features.push(TerrainFeature {
            id: body_id,
            kind: TerrainFeatureKind::WaterBody,
            vertices: vertices.clone(),
            elevation: level,
            width: compiled.world_size / width.max(2) as f32 * 2.0,
            flags: 0,
        });
        map.hydrology.water_bodies.push(WaterBody {
            id: body_id,
            level,
            flow_direction: Vec3::ZERO,
            resource_pool_id: 1,
            vertices,
        });
        if let Some(pos) = find_access_position(map, compiled, body_id) {
            map.hydrology.access_points.push(WaterAccessPoint {
                id: next_access_id,
                water_body_id: body_id,
                resource_pool_id: 1,
                pos,
                nearest_node_id: None,
                interaction_radius: 12.0,
            });
            next_access_id = next_access_id.saturating_add(1);
        }
    }
}

fn body_boundary_edges(
    body_ids: &[Option<u32>],
    width: usize,
    height: usize,
    body_id: u32,
) -> BTreeSet<GridEdge> {
    let mut edges = BTreeSet::new();
    let same = |x: isize, y: isize| -> bool {
        x >= 0
            && y >= 0
            && (x as usize) < width
            && (y as usize) < height
            && body_ids[y as usize * width + x as usize] == Some(body_id)
    };
    for y in 0..height {
        for x in 0..width {
            if body_ids[y * width + x] != Some(body_id) {
                continue;
            }
            if !same(x as isize, y as isize - 1) {
                edges.insert(((x, y), (x + 1, y)));
            }
            if !same(x as isize + 1, y as isize) {
                edges.insert(((x + 1, y), (x + 1, y + 1)));
            }
            if !same(x as isize, y as isize + 1) {
                edges.insert(((x + 1, y + 1), (x, y + 1)));
            }
            if !same(x as isize - 1, y as isize) {
                edges.insert(((x, y + 1), (x, y)));
            }
        }
    }
    edges
}

fn trace_boundary(edges: BTreeSet<GridEdge>) -> Option<Vec<GridPoint>> {
    if edges.is_empty() {
        return None;
    }
    let mut outgoing: BTreeMap<GridPoint, Vec<GridPoint>> = BTreeMap::new();
    for &(start, end) in &edges {
        outgoing.entry(start).or_default().push(end);
    }
    let first = *edges.iter().next()?;
    let mut unused = edges;
    let mut polygon = vec![first.0];
    let mut current = first.0;
    let mut next = first.1;
    let max_steps = unused.len().saturating_add(1);
    for _ in 0..max_steps {
        unused.remove(&(current, next));
        polygon.push(next);
        if next == polygon[0] {
            return (polygon.len() >= 4).then_some(polygon);
        }
        let candidates = outgoing.get(&next)?;
        let candidate = candidates
            .iter()
            .copied()
            .filter(|end| unused.contains(&(next, *end)))
            .min_by_key(|end| boundary_turn_key(current, next, *end))?;
        current = next;
        next = candidate;
    }
    None
}

fn boundary_turn_key(previous: GridPoint, current: GridPoint, next: GridPoint) -> u8 {
    let incoming = (
        current.0 as isize - previous.0 as isize,
        current.1 as isize - previous.1 as isize,
    );
    let outgoing = (
        next.0 as isize - current.0 as isize,
        next.1 as isize - current.1 as isize,
    );
    // Prefer continuing straight, then right, then left, then reversing. This
    // keeps touching diagonal cells on a single deterministic outer contour.
    match (incoming, outgoing) {
        (a, b) if a == b => 0,
        ((1, 0), (0, 1)) | ((0, 1), (-1, 0)) | ((-1, 0), (0, -1)) | ((0, -1), (1, 0)) => 1,
        _ => 2,
    }
}

fn boundary_world_position(
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    world_size: f32,
) -> (f32, f32) {
    let half = world_size * 0.5;
    let sx = world_size / width.saturating_sub(1).max(1) as f32;
    let sy = world_size / height.saturating_sub(1).max(1) as f32;
    let wx = if x == 0 {
        -half
    } else if x == width {
        half
    } else {
        -half + (x as f32 - 0.5) * sx
    };
    let wy = if y == 0 {
        -half
    } else if y == height {
        half
    } else {
        -half + (y as f32 - 0.5) * sy
    };
    (wx, wy)
}

fn water_body_level(compiled: &CompiledTerrain, body_id: u32) -> f32 {
    let mut sum = 0.0;
    let mut count = 0u32;
    for (index, id) in compiled.semantics.water_body_id.iter().enumerate() {
        if *id == Some(body_id) {
            let level = compiled.hydrology.water.water_level.values[index];
            if level.is_finite() {
                sum += level;
                count += 1;
            }
        }
    }
    if count > 0 {
        sum / count as f32
    } else {
        0.0
    }
}

fn find_access_position(
    map: &TerrainMap,
    compiled: &CompiledTerrain,
    body_id: u32,
) -> Option<Vec3> {
    let width = compiled.semantics.width;
    let height = compiled.semantics.height;
    for y in 0..height {
        for x in 0..width {
            if compiled.semantics.water_body_id[y * width + x] != Some(body_id) {
                continue;
            }
            for (nx, ny) in [(x.wrapping_sub(1), y), (x + 1, y), (x, y.wrapping_sub(1)), (x, y + 1)] {
                if nx >= width || ny >= height {
                    continue;
                }
                let index = ny * width + nx;
                if compiled.semantics.water_body_id[index].is_none()
                    && !matches!(map.cells[index].surface_kind, SurfaceKind::DeepWater | SurfaceKind::ShallowWater)
                {
                    return Some(map.grid_pos(nx, ny));
                }
            }
        }
    }
    None
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
