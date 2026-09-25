//! Stable hashes, field slices, profiles and candidate diagnostics.
//!
//! These records are developer artifacts only. They never enter runtime
//! snapshots or affect the field compiler's RNG streams.
use super::constraints::ConstraintReport;
use super::fields::{Field2, FieldError};
use super::groundwater::GroundwaterFields;
use super::ir::StratigraphicColumn;
use super::semantics::{SemanticGrid, SurfaceMaterial, SurfacePalette};
use super::strata::sample_stratum;
use super::uncertainty::{CandidateFieldHash, CandidateResult};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldDiagnostic {
    pub name: String,
    pub width: usize,
    pub height: usize,
    pub hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldSliceHeader {
    pub width: usize,
    pub height: usize,
    pub stride: usize,
    pub units: String,
    pub seed: u64,
    pub recipe_hash: u64,
    pub generator_version: u32,
    pub quantization: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldSlice {
    pub name: String,
    pub header: FieldSliceHeader,
    pub values: Vec<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProfileSample {
    pub x: u16,
    pub y: u16,
    pub world_x: f32,
    pub world_y: f32,
    pub elevation: f32,
    pub strata_depth_offset: f32,
    pub stratum_id: u16,
    pub stratum_material: u8,
    pub stratum_palette: u8,
    pub water_table: f32,
    pub discharge: f32,
    pub soil_moisture: f32,
    pub material: u8,
    pub palette: u8,
    pub vegetation_ok: bool,
    pub source_nodes: Vec<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiagnosticsBundle {
    pub seed: u64,
    pub recipe_hash: u64,
    pub generator_version: u32,
    pub fields: Vec<FieldDiagnostic>,
    pub confidence: FieldDiagnostic,
    pub constraints: Vec<ConstraintReport>,
    pub candidates: Vec<CandidateResult>,
    pub selected_candidate_hash: u64,
}

impl DiagnosticsBundle {
    /// Serialize the diagnostic bundle as stable pretty JSON for developer
    /// tools. The bundle is intentionally separate from runtime snapshots.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    pub fn write(&self, path: impl AsRef<Path>) -> std::io::Result<()> {
        let json = self.to_json().map_err(std::io::Error::other)?;
        std::fs::write(path, json)
    }
}

pub fn field_diagnostic(name: &str, field: &Field2) -> FieldDiagnostic {
    FieldDiagnostic {
        name: name.into(),
        width: field.width,
        height: field.height,
        hash: field.hash_quantized(1000.0),
    }
}

pub fn field_slice(
    name: &str,
    field: &Field2,
    seed: u64,
    recipe_hash: u64,
    generator_version: u32,
    units: &str,
    quantization: f32,
) -> FieldSlice {
    let quantization = if quantization.is_finite() && quantization > 0.0 {
        quantization
    } else {
        1000.0
    };
    FieldSlice {
        name: name.into(),
        header: FieldSliceHeader {
            width: field.width,
            height: field.height,
            stride: field.width,
            units: units.into(),
            seed,
            recipe_hash,
            generator_version,
            quantization,
        },
        values: field
            .values
            .iter()
            .map(|value| (value * quantization).round() as i32)
            .collect(),
    }
}

/// Quantize confidence from the local variance of candidate field values.
/// Identical candidate fields yield 255; disagreement lowers the byte in a
/// bounded, monotonic way.
pub fn confidence_field(fields: &[&Field2]) -> Result<Field2, FieldError> {
    let first = fields.first().ok_or(FieldError::InvalidDimensions)?;
    if fields
        .iter()
        .any(|field| field.width != first.width || field.height != first.height || !field.finite())
    {
        return Err(FieldError::SizeMismatch);
    }
    Field2::from_fn(first.width, first.height, |x, y| {
        let values = fields
            .iter()
            .map(|field| field.get_unchecked(x, y))
            .collect::<Vec<_>>();
        let mean = values.iter().sum::<f32>() / values.len() as f32;
        let variance = values
            .iter()
            .map(|value| {
                let delta = *value - mean;
                delta * delta
            })
            .sum::<f32>()
            / values.len() as f32;
        (255.0 / (1.0 + variance * 32.0)).round().clamp(0.0, 255.0)
    })
}

/// Sample a deterministic grid line between two world-space points. Grid
/// points use the same centered `[-world_size/2, world_size/2]` convention as
/// the field operators, and integer Bresenham traversal keeps the sample set
/// stable for native and WASM.
pub fn profile_slice(
    elevation: &Field2,
    groundwater: &GroundwaterFields,
    semantics: &SemanticGrid,
    stratigraphy: &StratigraphicColumn,
    strata_depth_offset: &Field2,
    world_size: f32,
    start_world: [f32; 2],
    end_world: [f32; 2],
    source_nodes: &[u16],
) -> Vec<ProfileSample> {
    if elevation.width == 0
        || elevation.height == 0
        || world_size <= 0.0
        || !world_size.is_finite()
        || groundwater.water_table.width != elevation.width
        || groundwater.water_table.height != elevation.height
        || semantics.width != elevation.width
        || semantics.height != elevation.height
        || strata_depth_offset.width != elevation.width
        || strata_depth_offset.height != elevation.height
    {
        return Vec::new();
    }
    let start = world_to_grid(start_world, elevation.width, elevation.height, world_size);
    let end = world_to_grid(end_world, elevation.width, elevation.height, world_size);
    let points = bresenham(start, end);
    points
        .into_iter()
        .map(|(x, y)| {
            let index = y * elevation.width + x;
            let depth = strata_depth_offset.values[index].max(0.0);
            let stratum = sample_stratum(stratigraphy, depth);
            let material = surface_material_code(semantics.surface_material[index]);
            let palette = surface_palette_code(semantics.surface_palette[index]);
            let world_x = x as f32 / elevation.width.saturating_sub(1).max(1) as f32 * world_size
                - world_size * 0.5;
            let world_y = y as f32 / elevation.height.saturating_sub(1).max(1) as f32 * world_size
                - world_size * 0.5;
            ProfileSample {
                x: x as u16,
                y: y as u16,
                world_x,
                world_y,
                elevation: elevation.values[index],
                strata_depth_offset: depth,
                stratum_id: stratum.map(|value| value.id).unwrap_or_default(),
                stratum_material: stratum.map(|value| value.material).unwrap_or_default(),
                stratum_palette: stratum.map(|value| value.palette).unwrap_or_default(),
                water_table: groundwater.water_table.values[index],
                discharge: groundwater.discharge.values[index],
                soil_moisture: groundwater.soil_moisture.values[index],
                material,
                palette,
                vegetation_ok: semantics.vegetation_ok[index],
                source_nodes: source_nodes.to_vec(),
            }
        })
        .collect()
}

pub fn candidate_field_hashes(fields: &[FieldDiagnostic]) -> Vec<CandidateFieldHash> {
    fields
        .iter()
        .map(|field| CandidateFieldHash {
            name: field.name.clone(),
            hash: field.hash,
        })
        .collect()
}

pub fn recipe_hash(bytes: &[u8]) -> u64 {
    let mut h = 0xcbf29ce484222325u64;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn world_to_grid(world: [f32; 2], width: usize, height: usize, world_size: f32) -> (usize, usize) {
    let x = ((world[0] / world_size + 0.5) * width.saturating_sub(1) as f32)
        .round()
        .clamp(0.0, width.saturating_sub(1) as f32) as usize;
    let y = ((world[1] / world_size + 0.5) * height.saturating_sub(1) as f32)
        .round()
        .clamp(0.0, height.saturating_sub(1) as f32) as usize;
    (x, y)
}

fn bresenham(start: (usize, usize), end: (usize, usize)) -> Vec<(usize, usize)> {
    let (mut x0, mut y0) = (start.0 as i32, start.1 as i32);
    let (x1, y1) = (end.0 as i32, end.1 as i32);
    let dx = (x1 - x0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 - y0).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut error = dx + dy;
    let mut points = Vec::new();
    loop {
        points.push((x0.max(0) as usize, y0.max(0) as usize));
        if x0 == x1 && y0 == y1 {
            break;
        }
        let twice = 2 * error;
        if twice >= dy {
            error += dy;
            x0 += sx;
        }
        if twice <= dx {
            error += dx;
            y0 += sy;
        }
    }
    points
}

fn surface_material_code(material: SurfaceMaterial) -> u8 {
    match material {
        SurfaceMaterial::Grass => 0,
        SurfaceMaterial::Sand => 1,
        SurfaceMaterial::BareSoil => 2,
        SurfaceMaterial::Gravel => 3,
        SurfaceMaterial::Rock => 4,
    }
}

fn surface_palette_code(palette: SurfacePalette) -> u8 {
    match palette {
        SurfacePalette::Green => 0,
        SurfacePalette::Yellow => 1,
        SurfacePalette::Brown => 2,
        SurfacePalette::Grey => 3,
    }
}
