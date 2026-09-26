//! Deterministic hydrology fields (flow / channels / water levels). They are no
//! longer projected into surface water semantics at creation time — the map is
//! published fully dry (see the pipeline note in `compiler.rs`).
use super::fields::{Field2, FieldError};
use super::processes::{
    flow_accumulation_with_cell_size, water_level_solve, FlowField, WaterBodyField,
};
use std::collections::VecDeque;

#[derive(Debug, Clone)]
pub struct ChannelField {
    pub flow: Field2,
    pub channel: Vec<bool>,
    pub channel_id: Vec<Option<u32>>,
    pub bank: Vec<bool>,
}

#[derive(Debug, Clone, Copy)]
pub struct HydrologySettings {
    pub channel_threshold: f32,
    pub bank_width_m: f32,
    pub min_lake_depth_m: f32,
}
impl Default for HydrologySettings {
    fn default() -> Self {
        Self {
            channel_threshold: 200.0,
            bank_width_m: 12.0,
            min_lake_depth_m: 0.5,
        }
    }
}

#[derive(Debug, Clone)]
pub struct HydrologyFields {
    pub flow: FlowField,
    pub channels: ChannelField,
    pub water: WaterBodyField,
}

pub fn compute_flow(elevation: &Field2, rainfall: &Field2) -> Result<FlowField, FieldError> {
    flow_accumulation_with_cell_size(elevation, rainfall, 1.0)
}

pub fn classify_channels(flow: &FlowField, threshold: f32, bank_width_cells: u32) -> ChannelField {
    let width = flow.accumulation.width;
    let height = flow.accumulation.height;
    let n = width * height;
    let channel: Vec<bool> = flow
        .accumulation
        .values
        .iter()
        .map(|v| *v >= threshold)
        .collect();
    let mut channel_id = vec![None; n];
    let mut bank = vec![false; n];
    let mut seen = vec![false; n];
    for start in 0..n {
        if !channel[start] || seen[start] {
            continue;
        }
        let mut cells = Vec::new();
        let mut queue = VecDeque::from([start]);
        seen[start] = true;
        while let Some(i) = queue.pop_front() {
            cells.push(i);
            for j in cardinal_neighbors(i, width, height) {
                if channel[j] && !seen[j] {
                    seen[j] = true;
                    queue.push_back(j);
                }
            }
        }
        let id = cells.iter().copied().min().unwrap_or(start) as u32 + 1;
        for i in cells {
            channel_id[i] = Some(id);
        }
    }
    // Expand only through land cells. The ring distance and scan order are fixed.
    let mut distance = vec![u32::MAX; n];
    let mut queue = VecDeque::new();
    for i in 0..n {
        if channel[i] {
            distance[i] = 0;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        if distance[i] >= bank_width_cells {
            continue;
        }
        for j in cardinal_neighbors(i, width, height) {
            if distance[j] == u32::MAX {
                distance[j] = distance[i] + 1;
                queue.push_back(j);
            }
        }
    }
    for i in 0..n {
        bank[i] = !channel[i]
            && distance[i] != u32::MAX
            && distance[i] > 0
            && distance[i] <= bank_width_cells;
    }
    ChannelField {
        flow: flow.accumulation.clone(),
        channel,
        channel_id,
        bank,
    }
}

pub fn water_level(elevation: &Field2, min_depth: f32) -> Result<WaterBodyField, FieldError> {
    water_level_solve(elevation, min_depth)
}

pub fn solve_hydrology(
    elevation: &Field2,
    rainfall: &Field2,
    cell_size: f32,
    settings: HydrologySettings,
) -> Result<HydrologyFields, FieldError> {
    let flow = flow_accumulation_with_cell_size(elevation, rainfall, cell_size)?;
    let bank_width_cells = if settings.bank_width_m <= 0.0 {
        0
    } else {
        (settings.bank_width_m / cell_size.max(1e-6)).ceil() as u32
    };
    let channels = classify_channels(&flow, settings.channel_threshold, bank_width_cells);
    let water = water_level_solve(elevation, settings.min_lake_depth_m)?;
    Ok(HydrologyFields {
        flow,
        channels,
        water,
    })
}

fn cardinal_neighbors(index: usize, width: usize, height: usize) -> impl Iterator<Item = usize> {
    let x = index % width;
    let y = index / width;
    [
        (x.wrapping_sub(1), y),
        (x + 1, y),
        (x, y.wrapping_sub(1)),
        (x, y + 1),
    ]
    .into_iter()
    .filter_map(move |(nx, ny)| {
        if nx < width && ny < height {
            Some(ny * width + nx)
        } else {
            None
        }
    })
}
