//! Serializable field graph and recipe validation.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use super::materials::MaterialTable;

pub type NodeId = u16;
pub type RecipeId = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FieldOp {
    Constant {
        value: f32,
    },
    Plane {
        direction: [f32; 2],
        slope: f32,
        base: f32,
    },
    NoiseFbm {
        frequency: f32,
        octaves: u8,
        amplitude: f32,
    },
    Ridge {
        start: [f32; 2],
        end: [f32; 2],
        width: f32,
        amplitude: f32,
    },
    Valley {
        start: [f32; 2],
        end: [f32; 2],
        width: f32,
        depth: f32,
    },
    Depression {
        center: [f32; 2],
        radius: f32,
        depth: f32,
    },
    Cone {
        center: [f32; 2],
        radius: f32,
        height: f32,
    },
    Plateau {
        center: [f32; 2],
        radius: f32,
        height: f32,
        edge: f32,
    },
    Add,
    Multiply,
    SmoothUnion {
        smoothness: f32,
    },
    SmoothSubtract {
        smoothness: f32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProcessOp {
    Uplift,
    Lithology,
    ThermalRelaxation { iterations: u16, rate: f32 },
    HydraulicErosion { iterations: u16, dt: f32 },
    FlowAccumulation,
    Deposition { rate: f32 },
    WaterLevelSolve,
    BiomeClassification,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TerrainNode {
    pub id: NodeId,
    pub op: FieldOp,
    pub inputs: Vec<NodeId>,
    pub strength: f32,
    pub mask: Option<NodeId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StratigraphicColumn {
    pub units: Vec<StratumSpec>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StratumSpec {
    pub id: u16,
    pub thickness_m: f32,
    pub material: u8,
    pub hardness: f32,
    pub soil_storage: f32,
    pub permeability: f32,
    pub palette: u8,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StructuralEvent {
    Fault {
        plane: PlaneSpec,
        displacement_m: f32,
    },
    Fold {
        axis: AxisSpec,
        amplitude_m: f32,
        wavelength_m: f32,
    },
    Unconformity {
        surface: NodeId,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlaneSpec {
    pub origin: [f32; 2],
    pub normal: [f32; 2],
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AxisSpec {
    pub start: [f32; 2],
    pub end: [f32; 2],
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct UncertaintySpec {
    pub candidate_count: u8,
    pub parameter_jitter: Vec<ParameterRange>,
    pub keep_top_n: u8,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParameterRange {
    pub min: f32,
    pub max: f32,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OutputSpec {
    pub grid_width: usize,
    pub grid_height: usize,
    pub world_size: f32,
    pub elevation_node: NodeId,
    pub hardness_node: Option<NodeId>,
    pub rainfall_node: Option<NodeId>,
}
impl Default for OutputSpec {
    fn default() -> Self {
        Self {
            grid_width: 64,
            grid_height: 64,
            world_size: 1000.0,
            elevation_node: 0,
            hardness_node: None,
            rainfall_node: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TerrainConstraint {
    WalkableComponents {
        min: u32,
        max: u32,
    },
    BuildableArea {
        min_cells: u32,
    },
    MandatoryCorridor {
        start: [f32; 2],
        end: [f32; 2],
        width_m: f32,
    },
    WaterSourceCount {
        min: u32,
        max: u32,
    },
    CrossingCount {
        min: u32,
        max: u32,
    },
    DetourRatio {
        min: f32,
        max: f32,
    },
    MaxSlope {
        max_deg: f32,
    },
    FeatureSeparation {
        kind: u8,
        min_m: f32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HydrologySpec {
    pub thermal_iterations: u16,
    pub repose_angle_deg: f32,
    pub thermal_rate: f32,
    pub erosion_iterations: u16,
    pub erosion_dt: f32,
    pub erodibility: f32,
    pub capacity_factor: f32,
    pub deposition_rate: f32,
    pub min_elevation: f32,
    pub max_elevation: f32,
    pub max_sediment: f32,
    pub channel_threshold: f32,
    pub bank_width_m: f32,
    pub min_lake_depth_m: f32,
}
impl Default for HydrologySpec {
    fn default() -> Self {
        Self {
            thermal_iterations: 0,
            repose_angle_deg: 34.0,
            thermal_rate: 0.25,
            erosion_iterations: 0,
            erosion_dt: 0.1,
            erodibility: 0.15,
            capacity_factor: 0.02,
            deposition_rate: 0.1,
            min_elevation: -1000.0,
            max_elevation: 1000.0,
            max_sediment: 1000.0,
            channel_threshold: f32::MAX,
            bank_width_m: 12.0,
            min_lake_depth_m: 0.5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TerrainRecipe {
    pub id: RecipeId,
    pub schema_version: u16,
    pub nodes: Vec<TerrainNode>,
    pub stratigraphy: StratigraphicColumn,
    #[serde(default)]
    pub materials: MaterialTable,
    pub structures: Vec<StructuralEvent>,
    pub uncertainty: UncertaintySpec,
    pub constraints: Vec<TerrainConstraint>,
    pub output: OutputSpec,
    #[serde(default)]
    pub hydrology: HydrologySpec,
}
impl Default for TerrainRecipe {
    fn default() -> Self {
        Self {
            id: String::new(),
            schema_version: 1,
            nodes: Vec::new(),
            stratigraphy: StratigraphicColumn { units: Vec::new() },
            materials: MaterialTable::default(),
            structures: Vec::new(),
            uncertainty: UncertaintySpec::default(),
            constraints: Vec::new(),
            output: OutputSpec::default(),
            hydrology: HydrologySpec::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecipeError {
    EmptyId,
    DuplicateNode(NodeId),
    UnknownInput { node: NodeId, input: NodeId },
    Cycle { nodes: Vec<NodeId> },
    NonFiniteParameter { node: NodeId },
    InvalidDimensions,
    InvalidWorldSize,
    UnsupportedOp,
    InvalidStratigraphy,
    InvalidMaterialTable,
    InvalidStructure { event_index: usize },
    UnknownStructureSurface { event_index: usize, surface: NodeId },
}
impl RecipeError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::EmptyId => "EMPTY_ID",
            Self::DuplicateNode(_) => "DUPLICATE_NODE",
            Self::UnknownInput { .. } => "UNKNOWN_INPUT",
            Self::Cycle { .. } => "CYCLE",
            Self::NonFiniteParameter { .. } => "NON_FINITE_PARAMETER",
            Self::InvalidDimensions => "INVALID_DIMENSIONS",
            Self::InvalidWorldSize => "INVALID_WORLD_SIZE",
            Self::UnsupportedOp => "UNSUPPORTED_OP",
            Self::InvalidStratigraphy => "INVALID_STRATIGRAPHY",
            Self::InvalidMaterialTable => "INVALID_MATERIAL_TABLE",
            Self::InvalidStructure { .. } => "INVALID_STRUCTURE",
            Self::UnknownStructureSurface { .. } => "UNKNOWN_STRUCTURE_SURFACE",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedRecipe {
    pub recipe: TerrainRecipe,
    pub topo_order: Vec<NodeId>,
    pub indices: BTreeMap<NodeId, usize>,
}

pub fn validate_recipe(recipe: &TerrainRecipe) -> Result<ResolvedRecipe, RecipeError> {
    if recipe.id.trim().is_empty() {
        return Err(RecipeError::EmptyId);
    }
    if recipe.output.grid_width == 0 || recipe.output.grid_height == 0 {
        return Err(RecipeError::InvalidDimensions);
    }
    if !recipe.output.world_size.is_finite() || recipe.output.world_size <= 0.0 {
        return Err(RecipeError::InvalidWorldSize);
    }
    if !recipe.stratigraphy.validate() {
        return Err(RecipeError::InvalidStratigraphy);
    }
    if !recipe.materials.validate()
        || recipe
            .stratigraphy
            .units
            .iter()
            .any(|unit| recipe.materials.get(unit.material).is_none())
    {
        return Err(RecipeError::InvalidMaterialTable);
    }
    let h = &recipe.hydrology;
    let hydrology_values = [
        h.repose_angle_deg,
        h.thermal_rate,
        h.erosion_dt,
        h.erodibility,
        h.capacity_factor,
        h.deposition_rate,
        h.min_elevation,
        h.max_elevation,
        h.max_sediment,
        h.channel_threshold,
        h.bank_width_m,
        h.min_lake_depth_m,
    ];
    if hydrology_values.iter().any(|v| !v.is_finite())
        || h.min_elevation > h.max_elevation
        || h.max_sediment < 0.0
        || h.bank_width_m < 0.0
        || h.min_lake_depth_m < 0.0
    {
        return Err(RecipeError::NonFiniteParameter {
            node: recipe.output.elevation_node,
        });
    }
    let mut indices = BTreeMap::new();
    for (i, node) in recipe.nodes.iter().enumerate() {
        if indices.insert(node.id, i).is_some() {
            return Err(RecipeError::DuplicateNode(node.id));
        }
        if !node.strength.is_finite() || !op_finite(&node.op) {
            return Err(RecipeError::NonFiniteParameter { node: node.id });
        }
    }
    let known: BTreeSet<NodeId> = indices.keys().copied().collect();
    for (event_index, event) in recipe.structures.iter().enumerate() {
        let invalid = match event {
            StructuralEvent::Fault {
                plane,
                displacement_m,
            } => {
                let norm_sq = plane.normal[0] * plane.normal[0] + plane.normal[1] * plane.normal[1];
                plane.origin.iter().chain(plane.normal.iter()).any(|v| !v.is_finite())
                    || !displacement_m.is_finite()
                    || !norm_sq.is_finite()
                    || norm_sq <= 1e-12
            }
            StructuralEvent::Fold {
                axis,
                amplitude_m,
                wavelength_m,
            } => {
                let dx = axis.end[0] - axis.start[0];
                let dy = axis.end[1] - axis.start[1];
                let length_sq = dx * dx + dy * dy;
                axis.start.iter().chain(axis.end.iter()).any(|v| !v.is_finite())
                    || !amplitude_m.is_finite()
                    || !wavelength_m.is_finite()
                    || *wavelength_m <= 0.0
                    || !length_sq.is_finite()
                    || length_sq <= 1e-12
            }
            StructuralEvent::Unconformity { surface } => {
                if !known.contains(surface) {
                    return Err(RecipeError::UnknownStructureSurface {
                        event_index,
                        surface: *surface,
                    });
                }
                false
            }
        };
        if invalid {
            return Err(RecipeError::InvalidStructure { event_index });
        }
    }
    let mut indegree = BTreeMap::new();
    let mut outgoing: BTreeMap<NodeId, Vec<NodeId>> = BTreeMap::new();
    for node in &recipe.nodes {
        indegree.insert(node.id, node.inputs.len() + node.mask.is_some() as usize);
        for input in node.inputs.iter().copied().chain(node.mask) {
            if !known.contains(&input) {
                return Err(RecipeError::UnknownInput {
                    node: node.id,
                    input,
                });
            }
            outgoing.entry(input).or_default().push(node.id);
        }
    }
    let mut ready: BTreeSet<NodeId> = indegree
        .iter()
        .filter_map(|(&id, &d)| (d == 0).then_some(id))
        .collect();
    let mut topo = Vec::with_capacity(recipe.nodes.len());
    while let Some(id) = ready.pop_first() {
        topo.push(id);
        if let Some(next) = outgoing.get(&id) {
            for &dst in next {
                let d = indegree.get_mut(&dst).unwrap();
                *d -= 1;
                if *d == 0 {
                    ready.insert(dst);
                }
            }
        }
    }
    if topo.len() != recipe.nodes.len() {
        let nodes = indegree
            .into_iter()
            .filter_map(|(id, d)| (d > 0).then_some(id))
            .collect();
        return Err(RecipeError::Cycle { nodes });
    }
    Ok(ResolvedRecipe {
        recipe: recipe.clone(),
        topo_order: topo,
        indices,
    })
}

fn op_finite(op: &FieldOp) -> bool {
    let finite = |v: f32| v.is_finite();
    match op {
        FieldOp::Constant { value } => finite(*value),
        FieldOp::Plane {
            direction,
            slope,
            base,
        } => direction.iter().all(|v| finite(*v)) && finite(*slope) && finite(*base),
        FieldOp::NoiseFbm {
            frequency,
            octaves: _,
            amplitude,
        } => finite(*frequency) && finite(*amplitude),
        FieldOp::Ridge {
            start,
            end,
            width,
            amplitude,
        } => {
            start.iter().chain(end.iter()).all(|v| finite(*v))
                && finite(*width)
                && finite(*amplitude)
        }
        FieldOp::Valley {
            start,
            end,
            width,
            depth,
        } => start.iter().chain(end.iter()).all(|v| finite(*v)) && finite(*width) && finite(*depth),
        FieldOp::Depression {
            center,
            radius,
            depth,
        } => center.iter().all(|v| finite(*v)) && finite(*radius) && finite(*depth),
        FieldOp::Cone {
            center,
            radius,
            height,
        } => center.iter().all(|v| finite(*v)) && finite(*radius) && finite(*height),
        FieldOp::Plateau {
            center,
            radius,
            height,
            edge,
        } => {
            center.iter().all(|v| finite(*v)) && finite(*radius) && finite(*height) && finite(*edge)
        }
        FieldOp::SmoothUnion { smoothness } | FieldOp::SmoothSubtract { smoothness } => {
            finite(*smoothness) && *smoothness > 0.0
        }
        FieldOp::Add | FieldOp::Multiply => true,
    }
}
