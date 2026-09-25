//! Projection from continuous fields to closed gameplay surface facts.
use super::fields::Field2;
use super::groundwater::GroundwaterFields;
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
    pub water_access: Field2,
    pub soil_moisture: Field2,
    pub vegetation_ok: Vec<bool>,
    pub build_mask: Field2,
    pub walk_mask: Field2,
    pub flags: Vec<u16>,
    pub water_body_id: Vec<Option<u32>>,
    pub water_depth: Field2,
}
#[derive(Debug, Clone, Copy)]
pub struct SurfaceThresholds {
    pub grass_water: f32,
    pub dry: f32,
    pub min_soil_moisture: f32,
    pub min_soil_storage: f32,
    pub wetland_moisture: f32,
    pub max_grass_slope: f32,
    pub max_build_slope: f32,
    pub max_walk_slope: f32,
}
impl Default for SurfaceThresholds {
    fn default() -> Self {
        Self {
            grass_water: 0.45,
            dry: 0.2,
            min_soil_moisture: 0.3,
            min_soil_storage: 0.25,
            wetland_moisture: 0.65,
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
    rainfall: &Field2,
    hardness: &Field2,
    thresholds: SurfaceThresholds,
    world_size: f32,
) -> Result<SemanticGrid, String> {
    let storage = Field2::new(elevation.width, elevation.height, 1.0)
        .map_err(|_| "FIELD_ERROR")?;
    project_internal(
        elevation,
        rainfall,
        hardness,
        rainfall,
        rainfall,
        &storage,
        thresholds,
        world_size,
    )
}

/// Project the final surface facts from the shared groundwater and soil fields.
/// The legacy `project_with_world_size` entry point remains available for small
/// callers that only have rainfall; the compiler uses this causal path.
pub fn project_with_groundwater(
    elevation: &Field2,
    rainfall: &Field2,
    hardness: &Field2,
    groundwater: &GroundwaterFields,
    thresholds: SurfaceThresholds,
    world_size: f32,
) -> Result<SemanticGrid, String> {
    project_internal(
        elevation,
        rainfall,
        hardness,
        &groundwater.water_access,
        &groundwater.soil_moisture,
        &groundwater.soil_storage,
        thresholds,
        world_size,
    )
}

fn project_internal(
    elevation: &Field2,
    rainfall: &Field2,
    hardness: &Field2,
    water_access: &Field2,
    soil_moisture: &Field2,
    soil_storage: &Field2,
    thresholds: SurfaceThresholds,
    world_size: f32,
) -> Result<SemanticGrid, String> {
    if elevation.width != rainfall.width
        || elevation.width != hardness.width
        || elevation.height != hardness.height
        || elevation.width != water_access.width
        || elevation.height != water_access.height
        || elevation.width != soil_moisture.width
        || elevation.height != soil_moisture.height
        || elevation.width != soil_storage.width
        || elevation.height != soil_storage.height
    {
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
        let access = water_access.values[i].clamp(0.0, 1.0);
        let moisture = soil_moisture.values[i].clamp(0.0, 1.0);
        let storage = soil_storage.values[i].clamp(0.0, 1.0);
        let slope = slope_deg.values[i];
        let hard = hardness.values[i].max(0.0);
        let grassy = access >= thresholds.grass_water
            && moisture >= thresholds.min_soil_moisture
            && storage >= thresholds.min_soil_storage
            && slope <= thresholds.max_grass_slope;
        vegetation_ok[i] = grassy;
        if grassy {
            material[i] = SurfaceMaterial::Grass;
            palette[i] = SurfacePalette::Green;
        } else if moisture >= thresholds.wetland_moisture && access >= thresholds.dry {
            material[i] = SurfaceMaterial::BareSoil;
            palette[i] = SurfacePalette::Green;
            if slope <= thresholds.max_walk_slope {
                surface_kind[i] = SurfaceKind::SoftGround;
            }
        } else if access < thresholds.dry {
            material[i] = if hard > 0.7 {
                SurfaceMaterial::Gravel
            } else {
                SurfaceMaterial::Sand
            };
            palette[i] = if hard > 0.7 {
                SurfacePalette::Grey
            } else {
                SurfacePalette::Yellow
            };
        }
        if hard > 0.85 && slope > thresholds.max_walk_slope {
            surface_kind[i] = SurfaceKind::RockFace;
            material[i] = SurfaceMaterial::Rock;
            palette[i] = SurfacePalette::Grey;
            vegetation_ok[i] = false;
            flags[i] |= TERRAIN_FLAG_NO_WALK | TERRAIN_FLAG_NO_BUILD;
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
        water_access: water_access.clone(),
        soil_moisture: soil_moisture.clone(),
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
