//! Heightfield compatibility backend for existing GeoCell consumers.
use crate::geo::biome::GeoCell;
use crate::geo::procedural::{
    CompiledTerrain, Field2, MaterialTable, StratigraphicColumn, SurfaceMaterial, SurfacePalette,
};

#[derive(Debug, Clone)]
pub struct HeightfieldBackend {
    pub width: usize,
    pub height: usize,
    pub world_size: f32,
    pub elevation: Field2,
    pub cells: Vec<GeoCell>,
    pub stratigraphy: Option<StratigraphicColumn>,
    pub materials: MaterialTable,
    pub strata_depth_offset: Option<Field2>,
    pub surface_material: Option<Vec<SurfaceMaterial>>,
    pub surface_palette: Option<Vec<SurfacePalette>>,
}
#[derive(Debug, Clone, Copy)]
pub struct HeightfieldView<'a> {
    backend: &'a HeightfieldBackend,
}
impl<'a> HeightfieldView<'a> {
    pub fn sample_elevation(&self, x: f32, y: f32) -> f32 {
        self.backend.sample_elevation(x, y)
    }
    pub fn sample_cell(&self, x: f32, y: f32) -> &'a GeoCell {
        self.backend.sample_cell(x, y)
    }
    /// Compatibility name used by geometry consumers migrating from fields.
    pub fn surface_at(&self, x: f32, y: f32) -> f32 {
        self.backend.surface_at(x, y)
    }
    pub fn backend(&self) -> &'a HeightfieldBackend {
        self.backend
    }
}

impl HeightfieldBackend {
    pub fn from_compiled(compiled: &CompiledTerrain, world_size: f32) -> Self {
        let e = &compiled.fields.elevation;
        let cells = e
            .values
            .iter()
            .enumerate()
            .map(|(i, v)| GeoCell {
                elevation: *v,
                slope_angle_deg: compiled.semantics.slope_deg.values[i],
                surface_kind: compiled.semantics.surface_kind[i],
                // Legacy fertility is the compatibility projection of the
                // causal soil-moisture field; rainfall alone must not create
                // grass in a dry or impermeable cell.
                natural_fertility: compiled.semantics.soil_moisture.values[i],
                water_body_id: compiled.semantics.water_body_id[i],
                feature_flags: compiled.semantics.flags[i],
            })
            .collect();
        Self {
            width: e.width,
            height: e.height,
            world_size,
            elevation: e.clone(),
            cells,
            stratigraphy: Some(compiled.stratigraphy.clone()),
            materials: compiled.materials.clone(),
            strata_depth_offset: Some(compiled.structures.strata_depth_offset.clone()),
            surface_material: Some(compiled.semantics.surface_material.clone()),
            surface_palette: Some(compiled.semantics.surface_palette.clone()),
        }
    }
    pub fn from_compiled_default(compiled: &CompiledTerrain) -> Self {
        Self::from_compiled(compiled, compiled.world_size)
    }
    pub fn sample_elevation(&self, x: f32, y: f32) -> f32 {
        let (gx, gy) = self.index_pair(x, y);
        self.elevation.get_unchecked(gx, gy)
    }
    pub fn surface_at(&self, x: f32, y: f32) -> f32 {
        self.sample_elevation(x, y)
    }
    pub fn sample_cell(&self, x: f32, y: f32) -> &GeoCell {
        let (gx, gy) = self.index_pair(x, y);
        &self.cells[gy * self.width + gx]
    }
    pub fn sample_strata_depth_offset(&self, x: f32, y: f32) -> f32 {
        self.strata_depth_offset
            .as_ref()
            .map(|field| {
                let (gx, gy) = self.index_pair(x, y);
                field.get_unchecked(gx, gy)
            })
            .unwrap_or(0.0)
    }
    pub fn index(&self, v: f32) -> usize {
        let half = self.world_size * 0.5;
        (((v + half) / self.world_size).clamp(0.0, 0.999999)
            * (self.width.saturating_sub(1)) as f32)
            .round() as usize
    }
    fn index_pair(&self, x: f32, y: f32) -> (usize, usize) {
        (
            self.index(x).min(self.width - 1),
            self.index(y).min(self.height - 1),
        )
    }
    pub fn as_view(&self) -> HeightfieldView<'_> {
        HeightfieldView { backend: self }
    }
    pub fn to_terrain_map(&self, seed: u64, recipe_id: &str) -> crate::geo::terrain::TerrainMap {
        let mut map =
            crate::geo::terrain::TerrainMap::new(self.width, self.height, self.world_size);
        map.seed = seed;
        map.profile = recipe_id.to_string();
        map.field_compiled = true;
        map.cells = self.cells.clone();
        map
    }
}
