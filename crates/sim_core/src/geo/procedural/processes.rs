//! Deterministic terrain transport processes. Traversals and ties are stable.
use super::fields::{Field2, FieldError};
use super::semantics::slope_field_with_world_size;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, VecDeque};

#[derive(Debug, Clone)]
pub struct FlowField {
    /// Downstream cell index. Every edge is strictly descending or advances a
    /// deterministic flat rank, so accumulation is acyclic.
    pub direction: Vec<Option<usize>>,
    pub accumulation: Field2,
}

pub fn flow_accumulation(elevation: &Field2, rainfall: &Field2) -> Result<FlowField, FieldError> {
    flow_accumulation_with_cell_size(elevation, rainfall, 1.0)
}

pub fn flow_accumulation_with_cell_size(
    elevation: &Field2,
    rainfall: &Field2,
    cell_size: f32,
) -> Result<FlowField, FieldError> {
    if elevation.width != rainfall.width || elevation.height != rainfall.height {
        return Err(FieldError::SizeMismatch);
    }
    if !cell_size.is_finite() || cell_size <= 0.0 {
        return Err(FieldError::InvalidDimensions);
    }
    let width = elevation.width;
    let height = elevation.height;
    let count = elevation.values.len();
    let mut flat_rank = vec![u32::MAX; count];
    let mut queue = VecDeque::new();

    // Start flat routing at the map edge and every cell with a lower neighbor.
    // Seeds are inserted in row-major order; 8-neighbors are scanned in a fixed
    // order, which makes equal-elevation drainage reproducible across targets.
    for index in 0..count {
        let x = index % width;
        let y = index / width;
        let height_here = elevation.values[index];
        let has_lower = neighbors(x, y, width, height)
            .any(|(nx, ny, _)| elevation.values[ny * width + nx] < height_here);
        let is_edge = x == 0 || y == 0 || x + 1 == width || y + 1 == height;
        if has_lower || is_edge {
            flat_rank[index] = 0;
            queue.push_back(index);
        }
    }
    while let Some(index) = queue.pop_front() {
        let x = index % width;
        let y = index / width;
        for (nx, ny, _) in neighbors(x, y, width, height) {
            let next = ny * width + nx;
            if flat_rank[next] == u32::MAX
                && elevation.values[next].to_bits() == elevation.values[index].to_bits()
            {
                flat_rank[next] = flat_rank[index].saturating_add(1);
                queue.push_back(next);
            }
        }
    }
    // Isolated enclosed flats with no lower neighbor are seeded at their
    // smallest row-major cell, then drained outward by increasing rank.
    for index in 0..count {
        if flat_rank[index] == u32::MAX {
            flat_rank[index] = 0;
            queue.push_back(index);
            while let Some(current) = queue.pop_front() {
                let x = current % width;
                let y = current / width;
                for (nx, ny, _) in neighbors(x, y, width, height) {
                    let next = ny * width + nx;
                    if flat_rank[next] == u32::MAX
                        && elevation.values[next].to_bits() == elevation.values[current].to_bits()
                    {
                        flat_rank[next] = flat_rank[current].saturating_add(1);
                        queue.push_back(next);
                    }
                }
            }
        }
    }

    let mut direction = vec![None; count];
    for index in 0..count {
        let x = index % width;
        let y = index / width;
        let here = elevation.values[index];
        let mut downhill: Option<(f32, usize)> = None;
        let mut flat: Option<(u32, usize)> = None;
        for (nx, ny, distance) in neighbors(x, y, width, height) {
            let next = ny * width + nx;
            let raw_drop = here - elevation.values[next];
            if raw_drop > 0.0 {
                let drop = raw_drop / (distance * cell_size);
                if downhill.is_none_or(|(best_drop, best_index)| {
                    drop > best_drop || (drop.to_bits() == best_drop.to_bits() && next < best_index)
                }) {
                    downhill = Some((drop, next));
                }
            } else if elevation.values[next].to_bits() == here.to_bits()
                && flat_rank[next] < flat_rank[index]
            {
                let candidate = (flat_rank[next], next);
                if flat.is_none_or(|best| candidate < best) {
                    flat = Some(candidate);
                }
            }
        }
        direction[index] = downhill.map(|(_, i)| i).or_else(|| flat.map(|(_, i)| i));
    }

    // Descending elevation, then row-major index. Equal-height flat edges are
    // ordered by descending flat rank to preserve upstream-before-downstream.
    let mut order: Vec<usize> = (0..count).collect();
    order.sort_by(|a, b| {
        elevation.values[*b]
            .total_cmp(&elevation.values[*a])
            .then(flat_rank[*b].cmp(&flat_rank[*a]))
            .then(a.cmp(b))
    });
    let mut accumulation = rainfall.clone();
    for index in order {
        if let Some(next) = direction[index] {
            accumulation.values[next] += accumulation.values[index];
            if !accumulation.values[next].is_finite() {
                return Err(FieldError::NonFinite);
            }
        }
    }
    Ok(FlowField {
        direction,
        accumulation,
    })
}

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
    pub flow: FlowField,
    pub sediment: Field2,
}

/// Fixed iteration hydraulic transport. Material moved off a cell is carried to
/// its downstream cell; deposition returns sediment to the elevation field.
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
    let mut flow = flow_accumulation_with_cell_size(elevation, rainfall, cell_size)?;
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
            let capacity = (flow.accumulation.values[index].max(0.0)
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
            if let Some(downstream) = flow.direction[index] {
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
        flow = flow_accumulation_with_cell_size(elevation, rainfall, cell_size)?;
    }
    Ok(ErosionResult {
        flow,
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

#[derive(Clone, Copy, Debug)]
struct FloodNode {
    elevation: f32,
    index: usize,
}
impl PartialEq for FloodNode {
    fn eq(&self, other: &Self) -> bool {
        self.elevation.to_bits() == other.elevation.to_bits() && self.index == other.index
    }
}
impl Eq for FloodNode {}
impl PartialOrd for FloodNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for FloodNode {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .elevation
            .total_cmp(&self.elevation)
            .then_with(|| other.index.cmp(&self.index))
    }
}

#[derive(Debug, Clone)]
pub struct WaterBodyField {
    pub spill_elevation: Field2,
    pub water_level: Field2,
    pub depth: Field2,
    pub body_id: Vec<Option<u32>>,
}

/// Priority-Flood from map edges. Closed depressions are filled to their spill
/// elevation; each connected basin receives its minimum row-major cell ID + 1.
pub fn water_level_solve(elevation: &Field2, min_depth: f32) -> Result<WaterBodyField, FieldError> {
    if !min_depth.is_finite() || min_depth < 0.0 {
        return Err(FieldError::NonFinite);
    }
    let width = elevation.width;
    let height = elevation.height;
    let n = elevation.values.len();
    let mut spill = vec![f32::INFINITY; n];
    let mut visited = vec![false; n];
    let mut heap = BinaryHeap::new();
    for i in 0..n {
        let x = i % width;
        let y = i / width;
        if x == 0 || y == 0 || x + 1 == width || y + 1 == height {
            spill[i] = elevation.values[i];
            visited[i] = true;
            heap.push(FloodNode {
                elevation: spill[i],
                index: i,
            });
        }
    }
    while let Some(node) = heap.pop() {
        let x = node.index % width;
        let y = node.index / width;
        for (nx, ny, _) in neighbors(x, y, width, height) {
            let j = ny * width + nx;
            if visited[j] {
                continue;
            }
            visited[j] = true;
            spill[j] = elevation.values[j].max(node.elevation);
            heap.push(FloodNode {
                elevation: spill[j],
                index: j,
            });
        }
    }
    let depth = Field2::from_values(
        width,
        height,
        (0..n)
            .map(|i| (spill[i] - elevation.values[i]).max(0.0))
            .collect(),
    )?;
    let spill_elevation = Field2::from_values(width, height, spill.clone())?;
    let water_level = Field2::from_values(
        width,
        height,
        (0..n)
            .map(|i| {
                if depth.values[i] >= min_depth {
                    spill[i]
                } else {
                    elevation.values[i]
                }
            })
            .collect(),
    )?;
    let wet: Vec<bool> = depth
        .values
        .iter()
        .map(|d| *d >= min_depth && *d > 0.0)
        .collect();
    let mut body_id = vec![None; n];
    let mut visited = vec![false; n];
    for start in 0..n {
        if !wet[start] || visited[start] {
            continue;
        }
        let mut cells = Vec::new();
        let mut q = VecDeque::from([start]);
        visited[start] = true;
        while let Some(i) = q.pop_front() {
            cells.push(i);
            let x = i % width;
            let y = i / width;
            for (nx, ny, _) in neighbors(x, y, width, height) {
                let j = ny * width + nx;
                if wet[j] && !visited[j] {
                    visited[j] = true;
                    q.push_back(j);
                }
            }
        }
        let id = (cells.iter().copied().min().unwrap_or(start) as u32).saturating_add(1);
        for i in cells {
            body_id[i] = Some(id);
        }
    }
    Ok(WaterBodyField {
        spill_elevation,
        water_level,
        depth,
        body_id,
    })
}
