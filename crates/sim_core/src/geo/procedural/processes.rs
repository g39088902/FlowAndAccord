//! Deterministic terrain transport processes. Traversals and ties are stable.
use super::fields::{Field2, FieldError};
use super::semantics::slope_field_with_world_size;

fn neighbors(
    x: usize,
    y: usize,
    width: usize,
    height: usize,
) -> impl Iterator<Item = (usize, usize, f32)> {
    const OFFSETS: [(isize, isize, f32); 8] = [
        (-1, -1, std::f32::consts::SQRT_2),
        (0, -1, 1.0),
        (1, -1, std::f32::consts::SQRT_2),
        (-1, 0, 1.0),
        (1, 0, 1.0),
        (-1, 1, std::f32::consts::SQRT_2),
        (0, 1, 1.0),
        (1, 1, std::f32::consts::SQRT_2),
    ];
    OFFSETS.into_iter().filter_map(move |(dx, dy, distance)| {
        let nx = x as isize + dx;
        let ny = y as isize + dy;
        (nx >= 0 && ny >= 0 && nx < width as isize && ny < height as isize).then_some((
            nx as usize,
            ny as usize,
            distance,
        ))
    })
}

/// Steepest-descent neighbour used by hydraulic transport. Ties are broken by
/// the smallest row-major index so downstream routing stays deterministic.
fn steepest_downstream(elevation: &Field2, index: usize) -> Option<usize> {
    let width = elevation.width;
    let height = elevation.height;
    let x = index % width;
    let y = index / width;
    let here = elevation.values[index];
    let mut best: Option<(f32, usize)> = None;
    for (nx, ny, distance) in neighbors(x, y, width, height) {
        let next = ny * width + nx;
        let drop = here - elevation.values[next];
        if drop > 0.0 {
            let rate = drop / distance;
            if best.is_none_or(|(best_rate, best_index)| {
                rate > best_rate || (rate.to_bits() == best_rate.to_bits() && next < best_index)
            }) {
                best = Some((rate, next));
            }
        }
    }
    best.map(|(_, i)| i)
}

#[derive(Debug, Clone, Copy)]
pub struct ErosionSettings {
    pub iterations: u16,
    pub dt: f32,
    pub erodibility: f32,
    pub capacity_factor: f32,
    pub deposition_rate: f32,
    pub min_elevation: f32,
    pub max_elevation: f32,
    pub max_sediment: f32,
}
impl Default for ErosionSettings {
    fn default() -> Self {
        Self {
            iterations: 0,
            dt: 0.1,
            erodibility: 0.15,
            capacity_factor: 0.02,
            deposition_rate: 0.1,
            min_elevation: -1000.0,
            max_elevation: 1000.0,
            max_sediment: 1000.0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ErosionResult {
    pub sediment: Field2,
}

/// Fixed iteration hydraulic transport. Material moved off a cell is carried to
/// its steepest-descent neighbour; deposition returns sediment to the elevation
/// field. Capacity is driven by local rainfall rather than a flow field.
pub fn hydraulic_erosion(
    elevation: &mut Field2,
    rainfall: &Field2,
    hardness: &Field2,
    sediment: &mut Field2,
    cell_size: f32,
    settings: ErosionSettings,
) -> Result<ErosionResult, FieldError> {
    validate_same_size(elevation, rainfall)?;
    validate_same_size(elevation, hardness)?;
    validate_same_size(elevation, sediment)?;
    if !settings.dt.is_finite()
        || !settings.erodibility.is_finite()
        || !settings.capacity_factor.is_finite()
        || !settings.deposition_rate.is_finite()
        || !settings.min_elevation.is_finite()
        || !settings.max_elevation.is_finite()
        || !settings.max_sediment.is_finite()
        || settings.min_elevation > settings.max_elevation
    {
        return Err(FieldError::NonFinite);
    }
    let dt = settings.dt.clamp(0.0, 1.0);
    for _ in 0..settings.iterations {
        let slope =
            slope_field_with_world_size(elevation, cell_size * (elevation.width - 1) as f32)
                .map_err(|_| FieldError::NonFinite)?;
        let mut next_sediment = sediment.values.clone();
        let mut delta_elevation = vec![0.0f32; elevation.values.len()];
        let mut order: Vec<usize> = (0..elevation.values.len()).collect();
        order.sort_by(|a, b| {
            elevation.values[*b]
                .total_cmp(&elevation.values[*a])
                .then(a.cmp(b))
        });
        for index in order {
            let hard = hardness.values[index].clamp(0.0, 1.0);
            let capacity = (rainfall.values[index].max(0.0)
                * slope.values[index].to_radians().tan().max(0.0)
                * settings.capacity_factor)
                .clamp(0.0, settings.max_sediment);
            let erode = ((capacity - sediment.values[index]).max(0.0)
                * settings.erodibility.max(0.0)
                * dt
                * (1.0 - hard))
                .min((elevation.values[index] - settings.min_elevation).max(0.0));
            delta_elevation[index] -= erode;
            next_sediment[index] = (next_sediment[index] + erode).min(settings.max_sediment);

            let transport = (next_sediment[index].min(capacity) * dt).min(next_sediment[index]);
            if let Some(downstream) = steepest_downstream(elevation, index) {
                next_sediment[index] -= transport;
                next_sediment[downstream] =
                    (next_sediment[downstream] + transport).min(settings.max_sediment);
            } else {
                let deposit = (next_sediment[index] * settings.deposition_rate.clamp(0.0, 1.0))
                    .min(settings.max_elevation - elevation.values[index]);
                next_sediment[index] -= deposit;
                delta_elevation[index] += deposit;
            }
        }
        for index in 0..elevation.values.len() {
            elevation.values[index] = (elevation.values[index] + delta_elevation[index])
                .clamp(settings.min_elevation, settings.max_elevation);
            sediment.values[index] = next_sediment[index].clamp(0.0, settings.max_sediment);
            if !elevation.values[index].is_finite() || !sediment.values[index].is_finite() {
                return Err(FieldError::NonFinite);
            }
        }
    }
    Ok(ErosionResult {
        sediment: sediment.clone(),
    })
}

/// Move material only when neighboring terrain exceeds the configured repose
/// grade. Pair deltas are accumulated before application to avoid scan bias.
pub fn thermal_relaxation(
    elevation: &mut Field2,
    iterations: u32,
    rate: f32,
) -> Result<(), FieldError> {
    thermal_relaxation_with_slope(elevation, iterations, 34.0, rate, 1.0)
}
pub fn thermal_relaxation_with_slope(
    elevation: &mut Field2,
    iterations: u32,
    repose_angle_deg: f32,
    rate: f32,
    cell_size: f32,
) -> Result<(), FieldError> {
    if !repose_angle_deg.is_finite()
        || !rate.is_finite()
        || !cell_size.is_finite()
        || cell_size <= 0.0
    {
        return Err(FieldError::NonFinite);
    }
    let max_drop = repose_angle_deg.to_radians().tan() * cell_size;
    let rate = rate.clamp(0.0, 1.0);
    for _ in 0..iterations {
        let mut delta = vec![0.0f32; elevation.values.len()];
        for y in 0..elevation.height {
            for x in 0..elevation.width {
                let i = y * elevation.width + x;
                for (nx, ny) in [(x + 1, y), (x, y + 1)] {
                    if nx >= elevation.width || ny >= elevation.height {
                        continue;
                    }
                    let j = ny * elevation.width + nx;
                    let difference = elevation.values[i] - elevation.values[j];
                    let excess = difference.abs() - max_drop;
                    if excess > 0.0 {
                        let transfer = excess * 0.5 * rate;
                        let sign = difference.signum();
                        delta[i] -= sign * transfer;
                        delta[j] += sign * transfer;
                    }
                }
            }
        }
        for (value, change) in elevation.values.iter_mut().zip(delta) {
            *value += change;
            if !value.is_finite() {
                return Err(FieldError::NonFinite);
            }
        }
    }
    Ok(())
}

fn validate_same_size(a: &Field2, b: &Field2) -> Result<(), FieldError> {
    if a.width == b.width && a.height == b.height {
        Ok(())
    } else {
        Err(FieldError::SizeMismatch)
    }
}