//! Stable static groundwater approximation for creation-time fields.
//!
//! This is intentionally a bounded field solve, not a per-tick fluid model.
//! Every traversal has a fixed order and every value is clamped to a normalized
//! range so native and WASM creation produce the same semantic fields.

use super::fields::{Field2, FieldError};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

#[derive(Debug, Clone, Copy)]
pub struct GroundwaterSettings {
    pub iterations: u16,
    pub aquifer_threshold: f32,
    pub discharge_threshold: f32,
    pub access_radius_m: f32,
}

impl Default for GroundwaterSettings {
    fn default() -> Self {
        Self {
            iterations: 4,
            aquifer_threshold: 0.45,
            discharge_threshold: 0.42,
            access_radius_m: 180.0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct GroundwaterFields {
    pub recharge: Field2,
    pub water_table: Field2,
    pub aquifer_mask: Vec<bool>,
    pub discharge: Field2,
    pub water_access: Field2,
    pub soil_moisture: Field2,
    pub soil_storage: Field2,
}

/// Solve the static groundwater chain from surface fields and hydrology facts.
///
/// `water_mask` and `channel_mask` are supplied by the already solved surface
/// water stage. They seed the access field but never modify elevation or water
/// geometry. Groundwater propagation follows higher cells before lower cells;
/// equal elevations use row-major order as a stable tie break.
pub fn solve_groundwater(
    elevation: &Field2,
    rainfall: &Field2,
    permeability: &Field2,
    storage: &Field2,
    water_mask: &[bool],
    channel_mask: &[bool],
    world_size: f32,
    settings: GroundwaterSettings,
) -> Result<GroundwaterFields, FieldError> {
    validate_same_size(elevation, rainfall)?;
    validate_same_size(elevation, permeability)?;
    validate_same_size(elevation, storage)?;
    let count = elevation.values.len();
    if water_mask.len() != count || channel_mask.len() != count {
        return Err(FieldError::SizeMismatch);
    }
    if !world_size.is_finite()
        || world_size <= 0.0
        || settings.iterations == 0
        || !settings.aquifer_threshold.is_finite()
        || !settings.discharge_threshold.is_finite()
        || !settings.access_radius_m.is_finite()
        || !(0.0..=1.0).contains(&settings.aquifer_threshold)
        || !(0.0..=1.0).contains(&settings.discharge_threshold)
        || settings.access_radius_m <= 0.0
    {
        return Err(FieldError::NonFinite);
    }

    let recharge = Field2::from_values(
        elevation.width,
        elevation.height,
        rainfall
            .values
            .iter()
            .zip(&permeability.values)
            .zip(&storage.values)
            .map(|((rain, permeability), storage)| {
                rain.clamp(0.0, 1.0) * permeability.clamp(0.0, 1.0) * storage.clamp(0.0, 1.0)
            })
            .collect(),
    )?;

    let mut order: Vec<usize> = (0..count).collect();
    order.sort_by(|a, b| {
        elevation.values[*b]
            .total_cmp(&elevation.values[*a])
            .then(a.cmp(b))
    });
    let mut order_rank = vec![0usize; count];
    for (rank, index) in order.iter().copied().enumerate() {
        order_rank[index] = rank;
    }

    // A bounded Gauss-Seidel style relaxation. Higher cells are visited first,
    // so their updated value can contribute to lower cells in the same sweep.
    let mut water_table = recharge
        .values
        .iter()
        .zip(&storage.values)
        .map(|(recharge, storage)| {
            (recharge * (0.45 + 0.55 * storage.clamp(0.0, 1.0))).clamp(0.0, 1.0)
        })
        .collect::<Vec<_>>();
    for _ in 0..settings.iterations {
        let previous = water_table.clone();
        for &index in &order {
            let x = index % elevation.width;
            let y = index / elevation.width;
            let mut upstream = 0.0;
            let mut upstream_count = 0u32;
            for neighbor in cardinal_neighbors(x, y, elevation.width, elevation.height) {
                let higher = elevation.values[neighbor] > elevation.values[index]
                    || (elevation.values[neighbor].to_bits() == elevation.values[index].to_bits()
                        && neighbor < index);
                if higher {
                    upstream += if order_rank[neighbor] < order_rank[index] {
                        water_table[neighbor]
                    } else {
                        previous[neighbor]
                    } * permeability.values[neighbor].clamp(0.0, 1.0);
                    upstream_count += 1;
                }
            }
            let mean_upstream = if upstream_count == 0 {
                0.0
            } else {
                upstream / upstream_count as f32
            };
            let retained = recharge.values[index]
                + mean_upstream * (0.18 + 0.32 * permeability.values[index].clamp(0.0, 1.0));
            water_table[index] = (0.62 * previous[index]
                + 0.38 * retained * (0.55 + 0.45 * storage.values[index].clamp(0.0, 1.0)))
            .clamp(0.0, 1.0);
        }
    }
    let water_table = Field2::from_values(elevation.width, elevation.height, water_table)?;
    let aquifer_mask = water_table
        .values
        .iter()
        .map(|value| *value >= settings.aquifer_threshold)
        .collect::<Vec<_>>();

    let discharge = Field2::from_values(
        elevation.width,
        elevation.height,
        (0..count)
            .map(|index| {
                let x = index % elevation.width;
                let y = index / elevation.width;
                let mut lower_peak = f32::NEG_INFINITY;
                let mut downhill = false;
                let mut uphill = false;
                for neighbor in cardinal_neighbors(x, y, elevation.width, elevation.height) {
                    if elevation.values[neighbor] < elevation.values[index] {
                        downhill = true;
                        lower_peak = lower_peak.max(water_table.values[neighbor]);
                    }
                    if water_table.values[neighbor] > water_table.values[index] + 0.005 {
                        uphill = true;
                    }
                }
                let edge =
                    x == 0 || y == 0 || x + 1 == elevation.width || y + 1 == elevation.height;
                let spring_drop = if lower_peak.is_finite() {
                    water_table.values[index] - lower_peak
                } else {
                    0.0
                };
                if water_table.values[index] >= settings.discharge_threshold
                    && !uphill
                    && ((downhill && spring_drop >= 0.0) || edge)
                {
                    (water_table.values[index]
                        * (0.55 + 0.45 * permeability.values[index].clamp(0.0, 1.0)))
                    .clamp(0.0, 1.0)
                } else {
                    0.0
                }
            })
            .collect(),
    )?;

    let water_access = access_field(
        elevation,
        &water_table,
        &discharge,
        water_mask,
        channel_mask,
        world_size,
        settings.access_radius_m,
    )?;
    let soil_moisture = Field2::from_values(
        elevation.width,
        elevation.height,
        water_table
            .values
            .iter()
            .zip(&recharge.values)
            .zip(&water_access.values)
            .map(|((table, recharge), access)| {
                (table * 0.55 + recharge * 0.3 + access * 0.15).clamp(0.0, 1.0)
            })
            .collect(),
    )?;

    Ok(GroundwaterFields {
        recharge,
        water_table,
        aquifer_mask,
        discharge,
        water_access,
        soil_moisture,
        soil_storage: storage.clone(),
    })
}

fn access_field(
    elevation: &Field2,
    water_table: &Field2,
    discharge: &Field2,
    water_mask: &[bool],
    channel_mask: &[bool],
    world_size: f32,
    access_radius_m: f32,
) -> Result<Field2, FieldError> {
    let count = elevation.values.len();
    let cell_size = world_size / elevation.width.saturating_sub(1).max(1) as f32;
    let mut distance = vec![u64::MAX; count];
    let mut heap = BinaryHeap::new();
    for index in 0..count {
        let seeded = water_mask[index]
            || channel_mask[index]
            || discharge.values[index] > 0.0
            || (water_table.values[index] >= 0.75
                && (index % elevation.width == 0 || index / elevation.width == 0));
        if seeded {
            distance[index] = 0;
            heap.push(Reverse((0u64, index)));
        }
    }
    while let Some(Reverse((cost, index))) = heap.pop() {
        if cost != distance[index] {
            continue;
        }
        let x = index % elevation.width;
        let y = index / elevation.width;
        let slope_penalty = local_slope(elevation, x, y, cell_size);
        let step = (cell_size * (1.0 + slope_penalty / 90.0) * 1000.0)
            .round()
            .max(1.0) as u64;
        for neighbor in cardinal_neighbors(x, y, elevation.width, elevation.height) {
            let next = cost.saturating_add(step);
            if next < distance[neighbor] {
                distance[neighbor] = next;
                heap.push(Reverse((next, neighbor)));
            }
        }
    }
    Field2::from_values(
        elevation.width,
        elevation.height,
        distance
            .into_iter()
            .map(|distance| {
                if distance == u64::MAX {
                    0.0
                } else {
                    let meters = distance as f32 / 1000.0;
                    (1.0 / (1.0 + meters / access_radius_m)).clamp(0.0, 1.0)
                }
            })
            .collect(),
    )
}

fn local_slope(elevation: &Field2, x: usize, y: usize, cell_size: f32) -> f32 {
    let left = elevation.get_unchecked(x.saturating_sub(1), y);
    let right = elevation.get_unchecked((x + 1).min(elevation.width - 1), y);
    let down = elevation.get_unchecked(x, y.saturating_sub(1));
    let up = elevation.get_unchecked(x, (y + 1).min(elevation.height - 1));
    let dx = (right - left) * 0.5 / cell_size.max(1e-6);
    let dy = (up - down) * 0.5 / cell_size.max(1e-6);
    (dx * dx + dy * dy).sqrt().atan().to_degrees()
}

fn validate_same_size(a: &Field2, b: &Field2) -> Result<(), FieldError> {
    (a.width == b.width && a.height == b.height)
        .then_some(())
        .ok_or(FieldError::SizeMismatch)
}

fn cardinal_neighbors(
    x: usize,
    y: usize,
    width: usize,
    height: usize,
) -> impl Iterator<Item = usize> {
    [
        (x.wrapping_sub(1), y),
        (x + 1, y),
        (x, y.wrapping_sub(1)),
        (x, y + 1),
    ]
    .into_iter()
    .filter_map(move |(nx, ny)| (nx < width && ny < height).then_some(ny * width + nx))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(width: usize, height: usize, value: f32) -> Field2 {
        Field2::new(width, height, value).unwrap()
    }

    #[test]
    fn groundwater_is_deterministic_and_bounded() {
        let elevation = Field2::from_values(4, 3, (0..12).map(|i| i as f32).collect()).unwrap();
        let rainfall = field(4, 3, 0.7);
        let permeability = field(4, 3, 0.8);
        let storage = field(4, 3, 0.9);
        let water_mask = vec![false; 12];
        let channel_mask = vec![false; 12];
        let settings = GroundwaterSettings::default();
        let a = solve_groundwater(
            &elevation,
            &rainfall,
            &permeability,
            &storage,
            &water_mask,
            &channel_mask,
            300.0,
            settings,
        )
        .unwrap();
        let b = solve_groundwater(
            &elevation,
            &rainfall,
            &permeability,
            &storage,
            &water_mask,
            &channel_mask,
            300.0,
            settings,
        )
        .unwrap();
        assert_eq!(a.water_table.values, b.water_table.values);
        assert!(a
            .water_table
            .values
            .iter()
            .chain(a.soil_moisture.values.iter())
            .all(|value| (0.0..=1.0).contains(value)));
    }

    #[test]
    fn surface_water_is_always_accessible() {
        let elevation = field(3, 3, 0.0);
        let rainfall = field(3, 3, 0.1);
        let permeability = field(3, 3, 0.1);
        let storage = field(3, 3, 0.1);
        let mut water_mask = vec![false; 9];
        water_mask[4] = true;
        let solved = solve_groundwater(
            &elevation,
            &rainfall,
            &permeability,
            &storage,
            &water_mask,
            &[false; 9],
            100.0,
            GroundwaterSettings::default(),
        )
        .unwrap();
        assert_eq!(solved.water_access.values[4], 1.0);
        assert!(solved.water_access.values[0] > 0.0);
    }
}
