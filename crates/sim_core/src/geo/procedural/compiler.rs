//! Fixed-order deterministic terrain field compiler.
use super::fields::{Field2, FieldError};
use super::groundwater::{solve_groundwater, GroundwaterFields, GroundwaterSettings};
use super::hydrology::{solve_hydrology, HydrologyFields, HydrologySettings};
use super::ir::{validate_recipe, RecipeError, ResolvedRecipe, TerrainRecipe};
use super::materials::MaterialTable;
use super::processes::{hydraulic_erosion, thermal_relaxation_with_slope, ErosionSettings};
use super::semantics::{self, SemanticGrid, SurfaceThresholds};
use super::strata::sample_stratum;
use super::structures::{StructureError, StructureField};
use super::{constraints, diagnostics, operators, uncertainty};
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
    pub permeability: Field2,
    pub soil_storage: Field2,
}

#[derive(Debug, Clone)]
pub struct CompiledTerrain {
    pub world_size: f32,
    pub output_node: u16,
    pub fields: TerrainFields,
    pub sediment: Field2,
    pub hydrology: HydrologyFields,
    pub semantics: SemanticGrid,
    pub groundwater: GroundwaterFields,
    /// Quantized only when exported through diagnostics; not part of runtime
    /// snapshots or gameplay state.
    pub confidence: Field2,
    pub reports: Vec<constraints::ConstraintReport>,
    pub diagnostics: diagnostics::DiagnosticsBundle,
    pub backend: BackendKind,
    pub recipe_id: String,
    pub stratigraphy: super::ir::StratigraphicColumn,
    pub materials: MaterialTable,
    pub structures: StructureField,
}

impl CompiledTerrain {
    /// Return a deterministic developer profile through the compiled fields.
    pub fn profile_slice(
        &self,
        start_world: [f32; 2],
        end_world: [f32; 2],
    ) -> Vec<diagnostics::ProfileSample> {
        let mut source_nodes = vec![self.output_node];
        for node in self
            .diagnostics
            .constraints
            .iter()
            .flat_map(|report| report.affected_nodes.iter().copied())
        {
            if !source_nodes.contains(&node) {
                source_nodes.push(node);
            }
        }
        diagnostics::profile_slice(
            &self.fields.elevation,
            &self.groundwater,
            &self.semantics,
            &self.stratigraphy,
            &self.structures.strata_depth_offset,
            self.world_size,
            start_world,
            end_world,
            &source_nodes,
        )
    }

    pub fn write_diagnostics(&self, path: impl AsRef<std::path::Path>) -> std::io::Result<()> {
        self.diagnostics.write(path)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum TerrainCompileError {
    Recipe(RecipeError),
    Field(FieldError),
    MissingOutputNode(u16),
    InvalidNodeInputs(u16),
    Semantic(String),
    ConstraintFailure(Vec<constraints::ConstraintReport>),
    Structure(StructureError),
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
            Self::Structure(_) => "STRUCTURE_INVALID",
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
    // Every authored template is grounded on the same irregular polygonal
    // surface.  Operators still provide their intended macro landform, while
    // this shared layer removes perfectly regular curve/plane silhouettes
    // from the final terrain and keeps adjacent polygon cells continuous.
    let half = world_size * 0.5;
    let cell_x = world_size / width.saturating_sub(1).max(1) as f32;
    let cell_y = world_size / height.saturating_sub(1).max(1) as f32;
    for y in 0..height {
        for x in 0..width {
            let wx = x as f32 * cell_x - half;
            let wy = y as f32 * cell_y - half;
            let i = y * width + x;
            elevation.values[i] += operators::polygonal_surface(
                seed ^ 0x5445_5252_4149_4e31,
                wx,
                wy,
                148.0,
                2.4,
            );
        }
    }
    let hardness = output
        .hardness_node
        .and_then(|id| fields.get(&id).cloned())
        .unwrap_or(Field2::new(width, height, 0.5)?);
    let rainfall = output
        .rainfall_node
        .and_then(|id| fields.get(&id).cloned())
        .unwrap_or(Field2::new(width, height, 0.5)?);
    let cell_size = world_size / width.saturating_sub(1).max(1) as f32;
    let structures = super::structures::apply_structures_seeded(
        &mut elevation,
        &resolved.recipe.structures,
        &fields,
        world_size,
        seed,
    )
    .map_err(TerrainCompileError::Structure)?;
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
    let (permeability, soil_storage) = surface_material_fields(
        &recipe.stratigraphy,
        &structures.strata_depth_offset,
        width,
        height,
    )?;
    let groundwater = solve_groundwater(
        &elevation,
        &rainfall,
        &permeability,
        &soil_storage,
        &hydrology
            .water
            .body_id
            .iter()
            .map(Option::is_some)
            .collect::<Vec<_>>(),
        &hydrology.channels.channel,
        world_size,
        GroundwaterSettings {
            iterations: hydro_spec.groundwater_iterations,
            aquifer_threshold: hydro_spec.groundwater_aquifer_threshold,
            discharge_threshold: hydro_spec.groundwater_discharge_threshold,
            access_radius_m: hydro_spec.groundwater_access_radius_m,
        },
    )?;
    // 创世不投影预设水系：原先此处调用 `hydrology::project_semantics`（D8 河道 /
    // priority-flood 湖面 → 水域格 + 河岸）与 `project_river_valley_trunk`（河谷模板
    // 手写主槽），使地图诞生即带水面与湿河床。现全部删除 ⇒ 无水域格 / 无 `WaterBody`
    // 特征与水体 / 无河岸取水点、流体内核无播种粒子；水体改由运行时自然水
    // （降雨 + 泉眼）与侵蚀在后续阶段涌现。
    let projected = semantics::project_with_groundwater(
        &elevation,
        &rainfall,
        &hardness,
        &groundwater,
        SurfaceThresholds {
            dry: hydro_spec.groundwater_dry_threshold,
            grass_water: hydro_spec.groundwater_grass_threshold,
            min_soil_moisture: hydro_spec.groundwater_min_soil_moisture,
            min_soil_storage: hydro_spec.groundwater_min_soil_storage,
            wetland_moisture: hydro_spec.groundwater_wetland_threshold,
            ..SurfaceThresholds::default()
        },
        world_size,
    )
    .map_err(TerrainCompileError::Semantic)?;
    let mut reports = constraints::evaluate(&resolved.recipe.constraints, &projected);
    for report in &mut reports {
        if report.affected_nodes.is_empty() {
            report.affected_nodes.push(output.elevation_node);
        }
    }
    if reports.iter().any(|report| !report.passed) {
        return Err(TerrainCompileError::ConstraintFailure(reports));
    }
    let recipe_hash = diagnostics::recipe_hash(&serde_json::to_vec(recipe).unwrap_or_default());
    let confidence = diagnostics::confidence_field(&[&elevation])?;
    let mut field_diagnostics = vec![
        diagnostics::field_diagnostic("elevation", &elevation),
        diagnostics::field_diagnostic("hardness", &hardness),
        diagnostics::field_diagnostic("rainfall", &rainfall),
        diagnostics::field_diagnostic("permeability", &permeability),
        diagnostics::field_diagnostic("soil_storage", &soil_storage),
        diagnostics::field_diagnostic("flow", &hydrology.flow.accumulation),
        diagnostics::field_diagnostic("sediment", &sediment),
        diagnostics::field_diagnostic("water_depth", &hydrology.water.depth),
        diagnostics::field_diagnostic("recharge", &groundwater.recharge),
        diagnostics::field_diagnostic("water_table", &groundwater.water_table),
        diagnostics::field_diagnostic("discharge", &groundwater.discharge),
        diagnostics::field_diagnostic("water_access", &groundwater.water_access),
        diagnostics::field_diagnostic("soil_moisture", &groundwater.soil_moisture),
        diagnostics::field_diagnostic(
            "aquifer_mask",
            &Field2::from_values(
                width,
                height,
                groundwater
                    .aquifer_mask
                    .iter()
                    .map(|value| if *value { 1.0 } else { 0.0 })
                    .collect(),
            )?,
        ),
        diagnostics::field_diagnostic(
            "vegetation_ok",
            &Field2::from_values(
                width,
                height,
                projected
                    .vegetation_ok
                    .iter()
                    .map(|value| if *value { 1.0 } else { 0.0 })
                    .collect(),
            )?,
        ),
    ];
    let confidence_diagnostic = diagnostics::field_diagnostic("confidence", &confidence);
    field_diagnostics.push(confidence_diagnostic.clone());
    let candidates = uncertainty::candidate_results(
        seed,
        &resolved.recipe.uncertainty,
        &reports,
        &diagnostics::candidate_field_hashes(&field_diagnostics),
    );
    let selected_candidate_hash = candidates
        .first()
        .map(|candidate| candidate.hash)
        .unwrap_or(0);
    let diagnostic = diagnostics::DiagnosticsBundle {
        seed,
        recipe_hash,
        generator_version: crate::geo::terrain::TERRAIN_GENERATOR_VERSION,
        fields: field_diagnostics,
        confidence: confidence_diagnostic,
        constraints: reports.clone(),
        candidates,
        selected_candidate_hash,
    };
    Ok(CompiledTerrain {
        world_size,
        output_node: output.elevation_node,
        fields: TerrainFields {
            elevation,
            hardness,
            rainfall,
            permeability,
            soil_storage,
        },
        sediment,
        hydrology,
        semantics: projected,
        groundwater,
        confidence,
        reports,
        diagnostics: diagnostic,
        backend,
        recipe_id: recipe.id.clone(),
        stratigraphy: recipe.stratigraphy.clone(),
        materials: recipe.materials.clone(),
        structures,
    })
}

pub fn resolve_recipe(recipe: &TerrainRecipe) -> Result<ResolvedRecipe, RecipeError> {
    validate_recipe(recipe)
}

fn surface_material_fields(
    stratigraphy: &super::ir::StratigraphicColumn,
    strata_depth_offset: &Field2,
    width: usize,
    height: usize,
) -> Result<(Field2, Field2), FieldError> {
    if strata_depth_offset.width != width || strata_depth_offset.height != height {
        return Err(FieldError::SizeMismatch);
    }
    let fallback = stratigraphy.units.last().ok_or(FieldError::SizeMismatch)?;
    let mut permeability = Vec::with_capacity(width * height);
    let mut soil_storage = Vec::with_capacity(width * height);
    for depth in &strata_depth_offset.values {
        let sample = sample_stratum(stratigraphy, (*depth).max(0.0)).unwrap_or_else(|| {
            super::strata::StratumSample {
                id: fallback.id,
                material: fallback.material,
                hardness: fallback.hardness,
                soil_storage: fallback.soil_storage,
                permeability: fallback.permeability,
                palette: fallback.palette,
            }
        });
        permeability.push(sample.permeability.clamp(0.0, 1.0));
        soil_storage.push(sample.soil_storage.clamp(0.0, 1.0));
    }
    Ok((
        Field2::from_values(width, height, permeability)?,
        Field2::from_values(width, height, soil_storage)?,
    ))
}
