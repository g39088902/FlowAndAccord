//! Heightfield compatibility backend for existing GeoCell consumers.
use crate::geo::biome::GeoCell;
use crate::geo::procedural::{CompiledTerrain, Field2, MaterialTable, StratigraphicColumn};

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
    /// Build a compatibility backend from an already generated `TerrainMap`.
    ///
    /// UGC-05 uses this path when a caller requests a static voxel chunk after
    /// world creation. It deliberately does not re-run the field compiler or
    /// consume any simulation RNG.
    pub fn from_terrain_map(map: &crate::geo::terrain::TerrainMap) -> Option<Self> {
        if map.grid_width == 0
            || map.grid_height == 0
            || map.cells.len() != map.grid_width * map.grid_height
            || !map.world_size.is_finite()
            || map.world_size <= 0.0
        {
            return None;
        }
        let recipe = crate::geo::procedural::builtin(&map.profile);
        Some(Self {
            width: map.grid_width,
            height: map.grid_height,
            world_size: map.world_size,
            elevation: Field2 {
                width: map.grid_width,
                height: map.grid_height,
                values: map.cells.iter().map(|cell| cell.elevation).collect(),
            },
            cells: map.cells.clone(),
            stratigraphy: recipe.as_ref().map(|recipe| recipe.stratigraphy.clone()),
            materials: recipe
                .as_ref()
                .map(|recipe| recipe.materials.clone())
                .unwrap_or_default(),
            strata_depth_offset: None,
        })
    }

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
                natural_fertility: compiled.fields.rainfall.values[i],
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
