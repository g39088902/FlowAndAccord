//! Deterministic structural displacement and unconformity fields.
use super::fields::{Field2, FieldError};
use super::ir::{AxisSpec, ConeCellSpec, FoldAnnulusSpec, FoldNetworkSpec, PlaneSpec, StructuralEvent};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum StructureError {
    InvalidGeometry,
    InvalidParameters,
    UnknownSurface(u16),
    Field(FieldError),
    NonFiniteResult,
}

#[derive(Debug, Clone)]
pub struct StructureField {
    /// Per-cell amount by which the top of the stratigraphic column was
    /// removed, used when mapping depth to a stratum.
    pub strata_depth_offset: Field2,
    /// Stable indices of events that changed the elevation field.
    pub displaced_event_indices: Vec<usize>,
    /// Stable indices of unconformities that changed the strata offset.
    pub unconformity_event_indices: Vec<usize>,
}

/// Apply structural events in declared order using scratch fields. On error,
/// `elevation` is left untouched and no partial result is returned.
pub fn apply_structures(
    elevation: &mut Field2,
    events: &[StructuralEvent],
    node_fields: &BTreeMap<u16, Field2>,
    world_size: f32,
) -> Result<StructureField, StructureError> {
    apply_structures_seeded(elevation, events, node_fields, world_size, 0)
}

/// Seed-aware structural application used by the terrain compiler. The public
/// compatibility wrapper above keeps hand-authored callers deterministic while
/// compiled recipes can vary their fine fold relief with the world seed.
pub fn apply_structures_seeded(
    elevation: &mut Field2,
    events: &[StructuralEvent],
    node_fields: &BTreeMap<u16, Field2>,
    world_size: f32,
    seed: u64,
) -> Result<StructureField, StructureError> {
    if !world_size.is_finite() || world_size <= 0.0 {
        return Err(StructureError::InvalidGeometry);
    }
    let mut scratch = elevation.clone();
    let mut strata_depth_offset = Field2::new(elevation.width, elevation.height, 0.0)
        .map_err(StructureError::Field)?;
    let mut displaced_event_indices = Vec::new();
    let mut unconformity_event_indices = Vec::new();
    let cell_x = world_size / elevation.width.saturating_sub(1).max(1) as f32;
    let cell_y = world_size / elevation.height.saturating_sub(1).max(1) as f32;
    let half = world_size * 0.5;

    for (event_index, event) in events.iter().enumerate() {
        match event {
            StructuralEvent::Fault {
                plane,
                displacement_m,
            } => {
                let (nx, ny) = normalized_plane(plane)?;
                if !displacement_m.is_finite() {
                    return Err(StructureError::InvalidParameters);
                }
                let smoothing_width = cell_x.max(cell_y).max(1e-3) * 2.0;
                for y in 0..scratch.height {
                    for x in 0..scratch.width {
                        let wx = x as f32 * cell_x - half;
                        let wy = y as f32 * cell_y - half;
                        let signed_distance = (wx - plane.origin[0]) * nx
                            + (wy - plane.origin[1]) * ny;
                        let t = ((signed_distance / smoothing_width + 1.0) * 0.5)
                            .clamp(0.0, 1.0);
                        let smooth = t * t * (3.0 - 2.0 * t);
                        let i = y * scratch.width + x;
                        scratch.values[i] += smooth * displacement_m;
                    }
                }
                displaced_event_indices.push(event_index);
            }
            StructuralEvent::Fold {
                axis,
                amplitude_m,
                wavelength_m,
            } => {
                validate_axis(axis)?;
                if !amplitude_m.is_finite()
                    || !wavelength_m.is_finite()
                    || *wavelength_m <= 0.0
                {
                    return Err(StructureError::InvalidParameters);
                }
                let dx = axis.end[0] - axis.start[0];
                let dy = axis.end[1] - axis.start[1];
                let length = (dx * dx + dy * dy).sqrt();
                for y in 0..scratch.height {
                    for x in 0..scratch.width {
                        let wx = x as f32 * cell_x - half - axis.start[0];
                        let wy = y as f32 * cell_y - half - axis.start[1];
                        let signed_distance = (dx * wy - dy * wx) / length;
                        let along = (dx * (wx + axis.start[0]) + dy * (wy + axis.start[1])) / length;
                        // Fold axes use the same irregular polygonal domain as
                        // the terrain base.  The authored wavelength remains a
                        // broad structural guide, while local value noise
                        // breaks the unnaturally perfect parallel bands.
                        let domain_warp = deterministic_value_noise(
                            0x464f_4c44_5741_5250,
                            along / wavelength_m,
                            signed_distance / wavelength_m,
                        ) * wavelength_m * 0.22;
                        let phase = std::f32::consts::TAU
                            * (signed_distance + domain_warp)
                            / wavelength_m;
                        let i = y * scratch.width + x;
                        let polygon_factor = 1.0
                            + 0.24
                                * super::operators::polygonal_surface(
                                    seed ^ 0x464f_4c44_504f_4c59,
                                    wx + axis.start[0],
                                    wy + axis.start[1],
                                    wavelength_m.max(40.0),
                                    1.0,
                                );
                        scratch.values[i] += deterministic_sin(phase) * amplitude_m * polygon_factor;
                    }
                }
                displaced_event_indices.push(event_index);
            }
            StructuralEvent::FoldNetwork { spec } => {
                validate_fold_network(spec)?;
                apply_fold_network(&mut scratch, spec, world_size, cell_x, cell_y, seed)?;
                displaced_event_indices.push(event_index);
            }
            StructuralEvent::Unconformity { surface } => {
                let surface_field = node_fields
                    .get(surface)
                    .ok_or(StructureError::UnknownSurface(*surface))?;
                if surface_field.width != scratch.width || surface_field.height != scratch.height {
                    return Err(StructureError::InvalidGeometry);
                }
                for i in 0..scratch.values.len() {
                    // A lower reference surface exposes deeper material by
                    // advancing the stratigraphic depth at the current top.
                    strata_depth_offset.values[i] = strata_depth_offset.values[i]
                        + (scratch.values[i] - surface_field.values[i]).max(0.0);
                }
                unconformity_event_indices.push(event_index);
            }
        }
    }

    if !scratch.finite() || !strata_depth_offset.finite() {
        return Err(StructureError::NonFiniteResult);
    }
    *elevation = scratch;
    Ok(StructureField {
        strata_depth_offset,
        displaced_event_indices,
        unconformity_event_indices,
    })
}

fn apply_fold_network(
    scratch: &mut Field2,
    spec: &FoldNetworkSpec,
    world_size: f32,
    cell_x: f32,
    cell_y: f32,
    seed: u64,
) -> Result<(), StructureError> {
    let half = world_size * 0.5;
    let cells = build_cone_cells(&spec.cone_cells, spec.annulus.as_ref(), seed);
    let band_count = spec.bands.len() as f32;
    let warp_scale = spec.warp_m / band_count.sqrt().max(1.0);
    for y in 0..scratch.height {
        for x in 0..scratch.width {
            let px = x as f32 * cell_x - half;
            let py = y as f32 * cell_y - half;
            let mut qx = px;
            let mut qy = py;

            // Warp the Voronoi sample locations with value noise projected on
            // the authored axes. This keeps polygon borders irregular without
            // introducing a periodic trigonometric ridge field.
            for (band_index, band) in spec.bands.iter().enumerate() {
                let (ux, uy, nx, ny) = axis_basis(&band.axis)?;
                let along = px * ux + py * uy;
                let across = px * nx + py * ny;
                let warp_seed = seed
                    ^ DOMAIN_WARP_SALT.wrapping_add(band_index as u64)
                    ^ (band.phase.to_bits() as u64);
                let wavelength = spec.warp_wavelength_m
                    * (band.wavelength_m / 132.0).clamp(0.6, 1.6);
                let amplitude = (band.amplitude_m.abs() / 36.0).clamp(0.0, 1.5);
                let lateral = deterministic_value_noise(
                    warp_seed,
                    along / wavelength + band.phase,
                    across / wavelength,
                ) * warp_scale
                    * band.weight.abs()
                    * amplitude;
                let longitudinal = deterministic_value_noise(
                    warp_seed ^ 0x9e37_79b9_7f4a_7c15,
                    across / wavelength,
                    along / wavelength + band.phase,
                ) * warp_scale
                    * 0.32
                    * band.weight.abs()
                    * amplitude;
                qx += nx * lateral + ux * longitudinal;
                qy += ny * lateral + uy * longitudinal;
            }

            // Every point belongs to one polygonal Voronoi cell. The cell's
            // distance to its nearest bisector is the local support radius;
            // using it as the zero-height boundary makes adjacent cones meet
            // continuously at the shared polygon floor.
            let cone = cone_cell_relief(&cells, qx, qy, spec.cone_cells.floor_m);
            let rough = ridged_fbm(
                seed ^ FOLD_NETWORK_SALT,
                qx / spec.micro_wavelength_m,
                qy / spec.micro_wavelength_m,
            );
            let ground = deterministic_value_noise(
                seed ^ GROUND_NOISE_SALT,
                qx / spec.cone_cells.ground_noise_wavelength_m,
                qy / spec.cone_cells.ground_noise_wavelength_m,
            );
            let belt = spec.annulus.as_ref().map_or(1.0, |ring| {
                let dx = px - ring.center[0];
                let dy = py - ring.center[1];
                let radius = (dx * dx + dy * dy).sqrt();
                let t = ((radius - ring.rise_start_m) / (ring.rise_full_m - ring.rise_start_m))
                    .clamp(0.0, 1.0);
                t * t * (3.0 - 2.0 * t)
            });
            let relief = cone * belt
                + ground * spec.cone_cells.ground_noise_m
                + rough * spec.micro_relief_m * 0.12 * belt;

            let i = y * scratch.width + x;
            scratch.values[i] += relief;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
enum ConeAnchor {
    Point { x: f32, y: f32 },
    Segment { ax: f32, ay: f32, bx: f32, by: f32 },
}

#[derive(Debug, Clone, Copy)]
struct ConeCell {
    anchor: ConeAnchor,
    height_m: f32,
}

fn build_cone_cells(
    spec: &ConeCellSpec,
    annulus: Option<&FoldAnnulusSpec>,
    seed: u64,
) -> Vec<ConeCell> {
    let columns = spec.columns as usize;
    let rows = spec.rows as usize;
    let origin_x = -0.5 * (columns.saturating_sub(1) as f32) * spec.spacing_m;
    let origin_y = -0.5 * (rows.saturating_sub(1) as f32) * spec.spacing_m;
    let mut cells = Vec::with_capacity(columns * rows);
    for row in 0..rows {
        let row_seed = seed ^ CONE_CELL_ROW_SALT.wrapping_add(row as u64);
        let row_stagger = (hash_unit(row_seed) * 2.0 - 1.0) * spec.stagger_m;
        for column in 0..columns {
            let index = (row * columns + column) as u64;
            let jx = hash_unit(seed ^ CONE_CELL_SITE_SALT ^ index.wrapping_mul(0x9e37_79b9_7f4a_7c15))
                * 2.0
                - 1.0;
            let jy = hash_unit(seed ^ CONE_CELL_SITE_SALT ^ index.wrapping_mul(0xbf58_476d_1ce4_e5b9))
                * 2.0
                - 1.0;
            let height_t = hash_unit(seed ^ CONE_CELL_HEIGHT_SALT ^ index);
            let macro_drift = deterministic_value_noise(
                seed ^ CONE_CELL_DRIFT_SALT,
                column as f32 * 0.71,
                row as f32 * 0.71,
            );
            let center_x = origin_x
                + column as f32 * spec.spacing_m
                + row_stagger * 0.34
                + jx * spec.jitter_m
                + macro_drift * spec.spacing_m * 0.16;
            let center_y = origin_y
                + row as f32 * spec.spacing_m
                + row_stagger
                + jy * spec.jitter_m
                + macro_drift * spec.spacing_m * 0.10;
            if let Some(ring) = annulus {
                let dx = center_x - ring.center[0];
                let dy = center_y - ring.center[1];
                if dx * dx + dy * dy < ring.site_inner_radius_m * ring.site_inner_radius_m {
                    continue;
                }
            }
            let anchor_kind = hash_unit(seed ^ CONE_CELL_KIND_SALT ^ index);
            let anchor = if anchor_kind < spec.line_probability {
                let mut dx = hash_unit(seed ^ CONE_CELL_DIRECTION_SALT ^ index) * 2.0 - 1.0;
                let mut dy = hash_unit(seed ^ CONE_CELL_DIRECTION_SALT ^ index.wrapping_mul(3))
                    * 2.0
                    - 1.0;
                let direction_length = (dx * dx + dy * dy).sqrt().max(1e-3);
                dx /= direction_length;
                dy /= direction_length;
                let length = spec.line_length_min_m
                    + (spec.line_length_max_m - spec.line_length_min_m)
                        * hash_unit(seed ^ CONE_CELL_LENGTH_SALT ^ index);
                let half_length = length * 0.5;
                ConeAnchor::Segment {
                    ax: center_x - dx * half_length,
                    ay: center_y - dy * half_length,
                    bx: center_x + dx * half_length,
                    by: center_y + dy * half_length,
                }
            } else {
                ConeAnchor::Point {
                    x: center_x,
                    y: center_y,
                }
            };
            cells.push(ConeCell {
                anchor,
                height_m: spec.min_height_m
                    + (spec.max_height_m - spec.min_height_m) * height_t,
            });
        }
    }
    cells
}

fn cone_cell_relief(cells: &[ConeCell], px: f32, py: f32, floor_m: f32) -> f32 {
    let mut nearest = 0usize;
    let mut nearest_distance = f32::MAX;
    let mut second_distance = f32::MAX;
    for (index, cell) in cells.iter().enumerate() {
        let distance = anchor_distance(cell.anchor, px, py);
        if distance < nearest_distance {
            second_distance = nearest_distance;
            nearest_distance = distance;
            nearest = index;
        } else if distance < second_distance {
            second_distance = distance;
        }
    }
    if cells.len() < 2 || !nearest_distance.is_finite() || !second_distance.is_finite() {
        return floor_m;
    }
    let nearest_cell = cells[nearest];
    // Equal distance to the two closest point/line anchors is the Voronoi
    // border. Half their distance gap is a stable support radius for either
    // anchor type and reaches zero continuously on the shared border.
    let edge_distance = ((second_distance - nearest_distance) * 0.5).max(0.0);
    let cone_t = (edge_distance / (nearest_distance + edge_distance).max(1e-3)).clamp(0.0, 1.0);
    let cone_profile = cone_t * (0.78 + 0.22 * cone_t);
    floor_m + nearest_cell.height_m * cone_profile
}

fn anchor_distance(anchor: ConeAnchor, px: f32, py: f32) -> f32 {
    match anchor {
        ConeAnchor::Point { x, y } => ((px - x) * (px - x) + (py - y) * (py - y)).sqrt(),
        ConeAnchor::Segment { ax, ay, bx, by } => {
            let dx = bx - ax;
            let dy = by - ay;
            let length_sq = dx * dx + dy * dy;
            if length_sq <= 1e-6 {
                return ((px - ax) * (px - ax) + (py - ay) * (py - ay)).sqrt();
            }
            let projection = ((px - ax) * dx + (py - ay) * dy) / length_sq;
            let t = projection.clamp(0.0, 1.0);
            let cx = ax + dx * t;
            let cy = ay + dy * t;
            ((px - cx) * (px - cx) + (py - cy) * (py - cy)).sqrt()
        }
    }
}

fn axis_basis(axis: &AxisSpec) -> Result<(f32, f32, f32, f32), StructureError> {
    let dx = axis.end[0] - axis.start[0];
    let dy = axis.end[1] - axis.start[1];
    let length = (dx * dx + dy * dy).sqrt();
    if !length.is_finite() || length <= 1e-6 {
        return Err(StructureError::InvalidGeometry);
    }
    let ux = dx / length;
    let uy = dy / length;
    Ok((ux, uy, -uy, ux))
}

fn validate_fold_network(spec: &FoldNetworkSpec) -> Result<(), StructureError> {
    if spec.bands.is_empty()
        || spec.bands.len() > 32
        || spec.annulus.as_ref().is_some_and(|ring| {
            ring.center.iter().any(|v| !v.is_finite())
                || !ring.site_inner_radius_m.is_finite()
                || ring.site_inner_radius_m < 0.0
                || !ring.rise_start_m.is_finite()
                || ring.rise_start_m < 0.0
                || !ring.rise_full_m.is_finite()
                || ring.rise_full_m <= ring.rise_start_m
                || ring.site_inner_radius_m > ring.rise_full_m
        })
        || spec.cone_cells.columns < 2
        || spec.cone_cells.columns > 32
        || spec.cone_cells.rows < 2
        || spec.cone_cells.rows > 32
        || !spec.cone_cells.spacing_m.is_finite()
        || spec.cone_cells.spacing_m <= 0.0
        || !spec.cone_cells.jitter_m.is_finite()
        || spec.cone_cells.jitter_m < 0.0
        || spec.cone_cells.jitter_m > spec.cone_cells.spacing_m * 0.45
        || !spec.cone_cells.stagger_m.is_finite()
        || spec.cone_cells.stagger_m < 0.0
        || spec.cone_cells.stagger_m > spec.cone_cells.spacing_m * 0.45
        || !spec.cone_cells.line_probability.is_finite()
        || spec.cone_cells.line_probability < 0.0
        || spec.cone_cells.line_probability > 1.0
        || !spec.cone_cells.line_length_min_m.is_finite()
        || !spec.cone_cells.line_length_max_m.is_finite()
        || spec.cone_cells.line_length_min_m <= 0.0
        || spec.cone_cells.line_length_max_m < spec.cone_cells.line_length_min_m
        || !spec.cone_cells.min_height_m.is_finite()
        || !spec.cone_cells.max_height_m.is_finite()
        || spec.cone_cells.min_height_m <= 0.0
        || spec.cone_cells.max_height_m < spec.cone_cells.min_height_m
        || !spec.cone_cells.floor_m.is_finite()
        || spec.cone_cells.floor_m < 0.0
        || !spec.cone_cells.ground_noise_m.is_finite()
        || spec.cone_cells.ground_noise_m < 0.0
        || !spec.cone_cells.ground_noise_wavelength_m.is_finite()
        || spec.cone_cells.ground_noise_wavelength_m <= 0.0
        || !spec.warp_m.is_finite()
        || !spec.warp_wavelength_m.is_finite()
        || spec.warp_wavelength_m <= 0.0
        || !spec.micro_relief_m.is_finite()
        || !spec.micro_wavelength_m.is_finite()
        || spec.micro_wavelength_m <= 0.0
    {
        return Err(StructureError::InvalidParameters);
    }
    for band in &spec.bands {
        if !band.amplitude_m.is_finite()
            || !band.wavelength_m.is_finite()
            || band.wavelength_m <= 0.0
            || !band.phase.is_finite()
            || !band.weight.is_finite()
        {
            return Err(StructureError::InvalidParameters);
        }
        axis_basis(&band.axis)?;
    }
    Ok(())
}

const FOLD_NETWORK_SALT: u64 = 0x464f_4c44_4e45_5431;
const DOMAIN_WARP_SALT: u64 = 0x444f_4d41_494e_5750;
const CONE_CELL_SITE_SALT: u64 = 0x434f_4e45_5349_5445;
const CONE_CELL_HEIGHT_SALT: u64 = 0x434f_4e45_4845_4947;
const CONE_CELL_ROW_SALT: u64 = 0x434f_4e45_524f_5753;
const CONE_CELL_DRIFT_SALT: u64 = 0x434f_4e45_4452_4946;
const CONE_CELL_KIND_SALT: u64 = 0x434f_4e45_4b49_4e44;
const CONE_CELL_DIRECTION_SALT: u64 = 0x434f_4e45_4449_5245;
const CONE_CELL_LENGTH_SALT: u64 = 0x434f_4e45_4c45_4e47;
const GROUND_NOISE_SALT: u64 = 0x4752_4f55_4e44_4e53;

fn ridged_fbm(seed: u64, x: f32, y: f32) -> f32 {
    let mut sum = 0.0;
    let mut amplitude = 0.58;
    let mut frequency = 1.0;
    let mut normalizer = 0.0;
    for octave in 0..4u64 {
        let n = deterministic_value_noise(
            seed ^ octave.wrapping_mul(0x9e37_79b9_7f4a_7c15),
            x * frequency,
            y * frequency,
        );
        sum += (1.0 - n.abs() * 1.85).max(-1.0) * amplitude;
        normalizer += amplitude;
        amplitude *= 0.5;
        frequency *= 2.03;
    }
    sum / normalizer.max(1e-6)
}

fn deterministic_value_noise(seed: u64, x: f32, y: f32) -> f32 {
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let sx = fade(tx);
    let sy = fade(ty);
    let n00 = lattice_value(seed, x0, y0);
    let n10 = lattice_value(seed, x0 + 1, y0);
    let n01 = lattice_value(seed, x0, y0 + 1);
    let n11 = lattice_value(seed, x0 + 1, y0 + 1);
    let a = n00 + (n10 - n00) * sx;
    let b = n01 + (n11 - n01) * sx;
    a + (b - a) * sy
}

fn lattice_value(seed: u64, x: i32, y: i32) -> f32 {
    let mut h = seed
        ^ (x as i64 as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15)
        ^ (y as i64 as u64).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    h = mix64(h);
    ((h >> 40) as u32 as f32 / 16_777_215.0) * 2.0 - 1.0
}

fn hash_unit(seed: u64) -> f32 {
    (mix64(seed) >> 32) as u32 as f32 / 4_294_967_295.0
}

fn fade(t: f32) -> f32 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

fn mix64(mut x: u64) -> u64 {
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

/// Fixed Taylor polynomial with argument reduction avoids platform libm drift.
fn deterministic_sin(value: f32) -> f32 {
    let tau = std::f32::consts::TAU;
    let mut x = value.rem_euclid(tau);
    if x > std::f32::consts::PI {
        x -= tau;
    }
    let x2 = x * x;
    x * (1.0
        + x2 * (-1.0 / 6.0
            + x2 * (1.0 / 120.0
                + x2 * (-1.0 / 5040.0
                    + x2 * (1.0 / 362880.0 + x2 * (-1.0 / 39916800.0))))))
}

fn normalized_plane(plane: &PlaneSpec) -> Result<(f32, f32), StructureError> {
    if plane.origin.iter().any(|value| !value.is_finite())
        || plane.normal.iter().any(|value| !value.is_finite())
    {
        return Err(StructureError::InvalidParameters);
    }
    let length = (plane.normal[0] * plane.normal[0] + plane.normal[1] * plane.normal[1]).sqrt();
    if !length.is_finite() || length <= 1e-6 {
        return Err(StructureError::InvalidGeometry);
    }
    Ok((plane.normal[0] / length, plane.normal[1] / length))
}

fn validate_axis(axis: &AxisSpec) -> Result<(), StructureError> {
    if axis.start.iter().chain(axis.end.iter()).any(|value| !value.is_finite()) {
        return Err(StructureError::InvalidParameters);
    }
    let dx = axis.end[0] - axis.start[0];
    let dy = axis.end[1] - axis.start[1];
    if (dx * dx + dy * dy).sqrt() <= 1e-6 {
        return Err(StructureError::InvalidGeometry);
    }
    Ok(())
}
