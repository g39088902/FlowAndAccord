//! Projection from continuous fields to closed gameplay surface facts.
use super::fields::Field2;
use crate::geo::biome::{SurfaceKind, TERRAIN_FLAG_NO_BUILD, TERRAIN_FLAG_NO_WALK};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SurfaceMaterial {
    Grass,
    Sand,
    BareSoil,
    Gravel,
    Rock,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SurfacePalette {
    Green,
    Yellow,
    Brown,
    Grey,
}
#[derive(Debug, Clone)]
pub struct SemanticGrid {
    pub width: usize,
    pub height: usize,
    pub slope_deg: Field2,
    pub surface_kind: Vec<SurfaceKind>,
    pub material: Vec<SurfaceMaterial>,
    pub palette: Vec<SurfacePalette>,
    /// Named aliases used by the field compiler and voxel material stage.
    pub surface_material: Vec<SurfaceMaterial>,
    pub surface_palette: Vec<SurfacePalette>,
    pub vegetation_ok: Vec<bool>,
    pub build_mask: Field2,
    pub walk_mask: Field2,
    pub flags: Vec<u16>,
    pub water_body_id: Vec<Option<u32>>,
    pub water_depth: Field2,
}
#[derive(Debug, Clone, Copy)]
pub struct SurfaceThresholds {
    pub max_grass_slope: f32,
    pub max_build_slope: f32,
    pub max_walk_slope: f32,
}
impl Default for SurfaceThresholds {
    fn default() -> Self {
        Self {
            max_grass_slope: 28.0,
            max_build_slope: 18.0,
            max_walk_slope: 34.0,
        }
    }
}

pub fn project(
    elevation: &Field2,
    rainfall: &Field2,
    hardness: &Field2,
    thresholds: SurfaceThresholds,
) -> Result<SemanticGrid, String> {
    project_with_world_size(elevation, rainfall, hardness, thresholds, 1.0)
}
pub fn project_with_world_size(
    elevation: &Field2,
    _rainfall: &Field2,
    hardness: &Field2,
    thresholds: SurfaceThresholds,
    world_size: f32,
) -> Result<SemanticGrid, String> {
    project_internal(elevation, hardness, thresholds, world_size)
}

/// Fixed surface derivation from slope and hardness only. Soil moisture and
/// groundwater no longer influence material, palette or vegetation.
fn project_internal(
    elevation: &Field2,
    hardness: &Field2,
    thresholds: SurfaceThresholds,
    world_size: f32,
) -> Result<SemanticGrid, String> {
    if elevation.width != hardness.width || elevation.height != hardness.height {
        return Err("FIELD_SIZE_MISMATCH".into());
    }
    let slope_deg = slope_field_with_world_size(elevation, world_size)?;
    let n = elevation.values.len();
    let mut surface_kind = vec![SurfaceKind::DryGround; n];
    let mut material = vec![SurfaceMaterial::BareSoil; n];
    let mut palette = vec![SurfacePalette::Brown; n];
    let mut vegetation_ok = vec![false; n];
    let mut flags = vec![0; n];
    let mut build = vec![0.0; n];
    let mut walk = vec![0.0; n];
    for i in 0..n {
        let slope = slope_deg.values[i];
        let hard = hardness.values[i].max(0.0);
        if slope <= thresholds.max_grass_slope {
            material[i] = SurfaceMaterial::Grass;
            palette[i] = SurfacePalette::Green;
            vegetation_ok[i] = true;
        } else if hard > 0.85 && slope > thresholds.max_walk_slope {
            surface_kind[i] = SurfaceKind::RockFace;
            material[i] = SurfaceMaterial::Rock;
            palette[i] = SurfacePalette::Grey;
            vegetation_ok[i] = false;
            flags[i] |= TERRAIN_FLAG_NO_WALK | TERRAIN_FLAG_NO_BUILD;
        } else if hard > 0.7 && slope > thresholds.max_build_slope {
            material[i] = SurfaceMaterial::Gravel;
            palette[i] = SurfacePalette::Grey;
        }
        if slope > thresholds.max_walk_slope {
            flags[i] |= TERRAIN_FLAG_NO_WALK;
        }
        if slope > thresholds.max_build_slope {
            flags[i] |= TERRAIN_FLAG_NO_BUILD;
        }
        build[i] = if flags[i] & TERRAIN_FLAG_NO_BUILD == 0 {
            1.0
        } else {
            0.0
        };
        walk[i] = if flags[i] & TERRAIN_FLAG_NO_WALK == 0 {
            1.0
        } else {
            0.0
        };
    }
    Ok(SemanticGrid {
        width: elevation.width,
        height: elevation.height,
        slope_deg,
        surface_kind,
        material: material.clone(),
        palette: palette.clone(),
        surface_material: material,
        surface_palette: palette,
        vegetation_ok,
        build_mask: Field2::from_values(elevation.width, elevation.height, build)
            .map_err(|_| "FIELD_ERROR")?,
        walk_mask: Field2::from_values(elevation.width, elevation.height, walk)
            .map_err(|_| "FIELD_ERROR")?,
        flags,
        water_body_id: vec![None; n],
        water_depth: Field2::new(elevation.width, elevation.height, 0.0)
            .map_err(|_| "FIELD_ERROR")?,
    })
}
pub fn slope_field(elevation: &Field2) -> Result<Field2, String> {
    slope_field_with_world_size(elevation, 1.0)
}
pub fn slope_field_with_world_size(elevation: &Field2, world_size: f32) -> Result<Field2, String> {
    let w = elevation.width;
    let h = elevation.height;
    let sx = world_size.max(1e-6) / (w.saturating_sub(1).max(1) as f32);
    let sy = world_size.max(1e-6) / (h.saturating_sub(1).max(1) as f32);
    Field2::from_fn(w, h, |x, y| {
        let l = elevation.get_unchecked(x.saturating_sub(1), y);
        let r = elevation.get_unchecked((x + 1).min(w - 1), y);
        let d = elevation.get_unchecked(x, y.saturating_sub(1));
        let u = elevation.get_unchecked(x, (y + 1).min(h - 1));
        let dx = (r - l) * 0.5 / sx;
        let dy = (u - d) * 0.5 / sy;
        (dx * dx + dy * dy).sqrt().atan().to_degrees()
    })
    .map_err(|_| "FIELD_ERROR".into())
}
