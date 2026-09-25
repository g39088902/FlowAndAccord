//! Fixed-order deterministic terrain field compiler.
use super::fields::{Field2, FieldError};
use super::hydrology::{project_semantics, solve_hydrology, HydrologyFields, HydrologySettings};
use super::ir::{validate_recipe, RecipeError, ResolvedRecipe, TerrainRecipe};
use super::materials::MaterialTable;
use super::processes::{hydraulic_erosion, thermal_relaxation_with_slope, ErosionSettings};
use super::semantics::{self, SemanticGrid, SurfaceThresholds};
use super::{constraints, diagnostics, operators};
use crate::config::SimConfig;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackendKind {
    Heightfield,
    Voxel,
}

#[derive(Debug, Clone)]
pub struct TerrainFields {
    pub elevation: Field2,
    pub hardness: Field2,
    pub rainfall: Field2,
}

#[derive(Debug, Clone)]
pub struct CompiledTerrain {
    pub world_size: f32,
    pub fields: TerrainFields,
    pub sediment: Field2,
    pub hydrology: HydrologyFields,
    pub semantics: SemanticGrid,
    pub reports: Vec<constraints::ConstraintReport>,
    pub diagnostics: diagnostics::DiagnosticsBundle,
    pub backend: BackendKind,
    pub recipe_id: String,
    pub stratigraphy: super::ir::StratigraphicColumn,
    pub materials: MaterialTable,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TerrainCompileError {
    Recipe(RecipeError),
    Field(FieldError),
    MissingOutputNode(u16),
    InvalidNodeInputs(u16),
    Semantic(String),
    ConstraintFailure(Vec<constraints::ConstraintReport>),
}
impl TerrainCompileError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Recipe(e) => e.code(),
            Self::Field(e) => e.code(),
            Self::MissingOutputNode(_) => "MISSING_OUTPUT_NODE",
            Self::InvalidNodeInputs(_) => "INVALID_NODE_INPUTS",
            Self::Semantic(_) => "SEMANTIC_PROJECTION",
            Self::ConstraintFailure(_) => "CONSTRAINT_FAILURE",
        }
    }
}

impl From<RecipeError> for TerrainCompileError {
    fn from(e: RecipeError) -> Self {
        Self::Recipe(e)
    }
}
impl From<FieldError> for TerrainCompileError {
    fn from(e: FieldError) -> Self {
        Self::Field(e)
    }
}

pub fn compile_terrain(
    seed: u64,
    recipe: &TerrainRecipe,
    config: &SimConfig,
    backend: BackendKind,
) -> Result<CompiledTerrain, TerrainCompileError> {
    let width = if config.terrain_grid_res == 0 {
        recipe.output.grid_width.max(2)
    } else {
        config.terrain_grid_res.max(2)
    };
    let height = if config.terrain_grid_res == 0 {
        recipe.output.grid_height.max(2)
    } else {
        config.terrain_grid_res.max(2)
    };
    compile_terrain_with_dimensions(
        seed,
        recipe,
        width,
        height,
        recipe.output.world_size,
        config,
        backend,
    )
}

pub fn compile_terrain_with_dimensions(
    seed: u64,
    recipe: &TerrainRecipe,
    width: usize,
    height: usize,
    world_size: f32,
    _config: &SimConfig,
    backend: BackendKind,
) -> Result<CompiledTerrain, TerrainCompileError> {
    let resolved = validate_recipe(recipe)?;
    let mut fields: BTreeMap<u16, Field2> = BTreeMap::new();
    for id in resolved.topo_order.iter().copied() {
        let node = &resolved.recipe.nodes[*resolved.indices.get(&id).unwrap()];
        let inputs: Vec<&Field2> = node
            .inputs
            .iter()
            .map(|input| {
                fields
                    .get(input)
                    .ok_or(TerrainCompileError::InvalidNodeInputs(id))
            })
            .collect::<Result<_, _>>()?;
        let mut field = operators::evaluate(&node.op, &inputs, seed, width, height, world_size)?;
        for value in &mut field.values {
            *value *= node.strength;
        }
        if let Some(mask_id) = node.mask {
            let mask = fields
                .get(&mask_id)
                .ok_or(TerrainCompileError::InvalidNodeInputs(id))?;
            for (value, mask_value) in field.values.iter_mut().zip(&mask.values) {
                *value *= mask_value.clamp(0.0, 1.0);
            }
        }
        fields.insert(id, field);
    }
    let output = &resolved.recipe.output;
    let mut elevation = fields.get(&output.elevation_node).cloned().ok_or(
        TerrainCompileError::MissingOutputNode(output.elevation_node),
    )?;
    let hardness = output
        .hardness_node
        .and_then(|id| fields.get(&id).cloned())
        .unwrap_or(Field2::new(width, height, 0.5)?);
    let rainfall = output
        .rainfall_node
        .and_then(|id| fields.get(&id).cloned())
        .unwrap_or(Field2::new(width, height, 0.5)?);
    let cell_size = world_size / width.saturating_sub(1).max(1) as f32;
    let hydro_spec = &resolved.recipe.hydrology;
    thermal_relaxation_with_slope(
        &mut elevation,
        hydro_spec.thermal_iterations as u32,
        hydro_spec.repose_angle_deg,
        hydro_spec.thermal_rate,
        cell_size,
    )?;
    let mut sediment = Field2::new(width, height, 0.0)?;
    let _erosion = hydraulic_erosion(
        &mut elevation,
        &rainfall,
        &hardness,
        &mut sediment,
        cell_size,
        ErosionSettings {
            iterations: hydro_spec.erosion_iterations,
            dt: hydro_spec.erosion_dt,
            erodibility: hydro_spec.erodibility,
            capacity_factor: hydro_spec.capacity_factor,
            deposition_rate: hydro_spec.deposition_rate,
            min_elevation: hydro_spec.min_elevation,
            max_elevation: hydro_spec.max_elevation,
            max_sediment: hydro_spec.max_sediment,
        },
    )?;
    let hydro_settings = HydrologySettings {
        channel_threshold: hydro_spec.channel_threshold,
        bank_width_m: hydro_spec.bank_width_m,
        min_lake_depth_m: hydro_spec.min_lake_depth_m,
    };
    let hydrology = solve_hydrology(&elevation, &rainfall, cell_size, hydro_settings)?;
    let mut projected = semantics::project_with_world_size(
        &elevation,
        &rainfall,
        &hardness,
        SurfaceThresholds::default(),
        world_size,
    )
    .map_err(TerrainCompileError::Semantic)?;
    project_semantics(&mut projected, &hydrology.channels, &hydrology.water);
    let reports = constraints::evaluate(&resolved.recipe.constraints, &projected);
    if reports.iter().any(|report| !report.passed) {
        return Err(TerrainCompileError::ConstraintFailure(reports));
    }
    let recipe_hash = diagnostics::recipe_hash(&serde_json::to_vec(recipe).unwrap_or_default());
    let diagnostic = diagnostics::DiagnosticsBundle {
        seed,
        recipe_hash,
        generator_version: 1,
        fields: vec![
            diagnostics::field_diagnostic("elevation", &elevation),
            diagnostics::field_diagnostic("hardness", &hardness),
            diagnostics::field_diagnostic("rainfall", &rainfall),
            diagnostics::field_diagnostic("flow", &hydrology.flow.accumulation),
            diagnostics::field_diagnostic("sediment", &sediment),
            diagnostics::field_diagnostic("water_depth", &hydrology.water.depth),
        ],
        constraints: reports.clone(),
    };
    Ok(CompiledTerrain {
        world_size,
        fields: TerrainFields {
            elevation,
            hardness,
            rainfall,
        },
        sediment,
        hydrology,
        semantics: projected,
        reports,
        diagnostics: diagnostic,
        backend,
        recipe_id: recipe.id.clone(),
        stratigraphy: recipe.stratigraphy.clone(),
        materials: recipe.materials.clone(),
    })
}

pub fn resolve_recipe(recipe: &TerrainRecipe) -> Result<ResolvedRecipe, RecipeError> {
    validate_recipe(recipe)
}
