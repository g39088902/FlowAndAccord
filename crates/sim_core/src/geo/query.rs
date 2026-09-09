use super::biome::{GeoCell, SurfaceKind, TERRAIN_FLAG_NO_BUILD, TERRAIN_FLAG_NO_WALK};
use super::terrain::TerrainMap;
use crate::spatial::vec3::Vec3;

pub const TERRAIN_SURFACE_MASK_DRY: u16 = 1 << SurfaceKind::DryGround as u8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LandUseKind {
    Road,
    House,
    Farm,
    Defense,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerrainFailure {
    None,
    OutOfBounds,
    WaterCovered,
    DeepWater,
    CliffTooSteep,
    SurfaceForbidden,
    FootprintTooUneven,
    NoRoadAccess,
}

impl TerrainFailure {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::None => "None",
            Self::OutOfBounds => "OutOfBounds",
            Self::WaterCovered => "WaterCovered",
            Self::DeepWater => "DeepWater",
            Self::CliffTooSteep => "CliffTooSteep",
            Self::SurfaceForbidden => "SurfaceForbidden",
            Self::FootprintTooUneven => "FootprintTooUneven",
            Self::NoRoadAccess => "NoRoadAccess",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct FootprintQuery {
    pub center: Vec3,
    pub half_extents: (f32, f32),
    pub rotation_rad: f32,
    pub use_kind: LandUseKind,
}

#[derive(Debug, Clone, Copy)]
pub struct TerrainQueryResult {
    pub valid: bool,
    pub failure: TerrainFailure,
    pub min_elevation: f32,
    pub max_elevation: f32,
    pub max_slope_deg: f32,
    pub surface_mask: u16,
    pub walk_cost: f32,
}

impl TerrainQueryResult {
    pub const fn invalid(failure: TerrainFailure) -> Self {
        Self {
            valid: false,
            failure,
            min_elevation: 0.0,
            max_elevation: 0.0,
            max_slope_deg: 0.0,
            surface_mask: 0,
            walk_cost: 1.0,
        }
    }
}

pub fn sample_cell(terrain: &TerrainMap, wx: f32, wy: f32) -> &GeoCell {
    terrain.sample_cell(wx, wy)
}

pub fn validate_footprint(terrain: &TerrainMap, query: FootprintQuery, max_slope_deg: f32) -> TerrainQueryResult {
    let (hx, hy) = query.half_extents;
    let radius = (hx * hx + hy * hy).sqrt();
    let step = (terrain.world_size / terrain.grid_width.max(1) as f32).max(1.0);
    let samples = ((radius / step).ceil() as i32).clamp(1, 32);
    let (sin_r, cos_r) = query.rotation_rad.sin_cos();
    let mut result = TerrainQueryResult {
        valid: true,
        failure: TerrainFailure::None,
        min_elevation: f32::MAX,
        max_elevation: f32::MIN,
        max_slope_deg: 0.0,
        surface_mask: 0,
        walk_cost: 1.0,
    };
    for iy in -samples..=samples {
        for ix in -samples..=samples {
            let local_x = ix as f32 * step;
            let local_y = iy as f32 * step;
            if local_x.abs() > hx || local_y.abs() > hy {
                continue;
            }
            let wx = query.center.x + local_x * cos_r - local_y * sin_r;
            let wy = query.center.y + local_x * sin_r + local_y * cos_r;
            if wx.abs() > terrain.world_size * 0.5 || wy.abs() > terrain.world_size * 0.5 {
                return TerrainQueryResult::invalid(TerrainFailure::OutOfBounds);
            }
            let cell = terrain.sample_cell(wx, wy);
            result.min_elevation = result.min_elevation.min(cell.elevation);
            result.max_elevation = result.max_elevation.max(cell.elevation);
            result.max_slope_deg = result.max_slope_deg.max(cell.slope_angle_deg);
            result.surface_mask |= 1u16 << (cell.surface_kind as u8);
            result.walk_cost = result.walk_cost.max(surface_walk_cost(cell.surface_kind));
            if cell.surface_kind == SurfaceKind::DeepWater {
                return TerrainQueryResult::invalid(TerrainFailure::DeepWater);
            }
            if cell.surface_kind == SurfaceKind::RockFace {
                return TerrainQueryResult::invalid(TerrainFailure::CliffTooSteep);
            }
            if query.use_kind != LandUseKind::Road && cell.feature_flags & TERRAIN_FLAG_NO_BUILD != 0 {
                return TerrainQueryResult::invalid(TerrainFailure::SurfaceForbidden);
            }
            if query.use_kind == LandUseKind::Road && cell.feature_flags & TERRAIN_FLAG_NO_WALK != 0 {
                return TerrainQueryResult::invalid(TerrainFailure::SurfaceForbidden);
            }
        }
    }
    if result.max_slope_deg > max_slope_deg {
        return TerrainQueryResult::invalid(TerrainFailure::FootprintTooUneven);
    }
    result.valid = true;
    result
}

#[inline]
pub fn surface_walk_cost(kind: SurfaceKind) -> f32 {
    match kind {
        SurfaceKind::DryGround | SurfaceKind::RiverTerrace => 1.0,
        SurfaceKind::SoftGround | SurfaceKind::RiverBank => 1.25,
        SurfaceKind::ShallowWater => 2.0,
        SurfaceKind::DeepWater | SurfaceKind::RockFace => f32::INFINITY,
    }
}

pub fn explain_failure(failure: TerrainFailure) -> &'static str {
    match failure {
        TerrainFailure::None => "地块合法",
        TerrainFailure::OutOfBounds => "超出地图边界",
        TerrainFailure::WaterCovered => "地块被水域覆盖",
        TerrainFailure::DeepWater => "深水不可通行或建造",
        TerrainFailure::CliffTooSteep => "坡面过陡",
        TerrainFailure::SurfaceForbidden => "地表类别不允许该用途",
        TerrainFailure::FootprintTooUneven => "完整占地高差或坡度过大",
        TerrainFailure::NoRoadAccess => "没有合法道路接入",
    }
}
