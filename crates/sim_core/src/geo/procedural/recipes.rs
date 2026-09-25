//! Built-in data-only recipes. Geometry lives in the generic compiler.
use super::ir::*;
use super::materials::MaterialTable;

pub const GRASSLAND_PLAIN_V1: &str = "grassland_plain_v1";
pub const MOUNTAIN_PASS_V1: &str = "mountain_pass_v1";
pub const RIVER_VALLEY_V1: &str = "river_valley_v1";
pub const PLATEAU_V1: &str = "plateau_v1";
pub const BASIN_OASIS_V1: &str = "basin_oasis_v1";
pub const ALLUVIAL_FAN_V1: &str = "alluvial_fan_v1";
pub const VOLCANIC_LAKE_V1: &str = "volcanic_lake_v1";
pub const HILLSIDE_WOODLAND_V1: &str = "hillside_woodland_v1";

fn recipe_from_nodes(
    id: &str,
    nodes: Vec<TerrainNode>,
    elevation_node: NodeId,
    hydrology: HydrologySpec,
) -> TerrainRecipe {
    TerrainRecipe {
        id: id.into(),
        schema_version: 1,
        nodes,
        stratigraphy: default_strata(),
        materials: default_materials(),
        structures: vec![],
        uncertainty: UncertaintySpec::default(),
        constraints: vec![TerrainConstraint::WalkableComponents { min: 1, max: 1 }],
        hydrology,
        output: OutputSpec {
            elevation_node,
            hardness_node: Some(100),
            rainfall_node: Some(101),
            ..OutputSpec::default()
        },
    }
}

fn common_nodes(base: FieldOp, relief: FieldOp, noise_amplitude: f32) -> Vec<TerrainNode> {
    vec![
        TerrainNode {
            id: 0,
            op: base,
            inputs: vec![],
            strength: 1.0,
            mask: None,
        },
        TerrainNode {
            id: 1,
            op: relief,
            inputs: vec![],
            strength: 1.0,
            mask: None,
        },
        TerrainNode {
            id: 2,
            op: FieldOp::NoiseFbm {
                frequency: 0.006,
                octaves: 3,
                amplitude: noise_amplitude,
            },
            inputs: vec![],
            strength: 1.0,
            mask: None,
        },
        TerrainNode {
            id: 3,
            op: FieldOp::Add,
            inputs: vec![0, 1, 2],
            strength: 1.0,
            mask: None,
        },
        TerrainNode {
            id: 100,
            op: FieldOp::Constant { value: 0.65 },
            inputs: vec![],
            strength: 1.0,
            mask: None,
        },
        TerrainNode {
            id: 101,
            op: FieldOp::Constant { value: 0.55 },
            inputs: vec![],
            strength: 1.0,
            mask: None,
        },
    ]
}

pub fn grassland_plain_v1() -> TerrainRecipe {
    TerrainRecipe {
        id: GRASSLAND_PLAIN_V1.into(),
        schema_version: 1,
        nodes: vec![
            TerrainNode {
                id: 0,
                op: FieldOp::Plane {
                    direction: [0.0, 1.0],
                    slope: 0.015,
                    base: 0.0,
                },
                inputs: vec![],
                strength: 1.0,
                mask: None,
            },
            TerrainNode {
                id: 1,
                op: FieldOp::NoiseFbm {
                    frequency: 0.006,
                    octaves: 3,
                    amplitude: 8.0,
                },
                inputs: vec![],
                strength: 1.0,
                mask: None,
            },
            TerrainNode {
                id: 2,
                op: FieldOp::Add,
                inputs: vec![0, 1],
                strength: 1.0,
                mask: None,
            },
            TerrainNode {
                id: 3,
                op: FieldOp::Constant { value: 0.55 },
                inputs: vec![],
                strength: 1.0,
                mask: None,
            },
            TerrainNode {
                id: 4,
                op: FieldOp::Constant { value: 0.35 },
                inputs: vec![],
                strength: 1.0,
                mask: None,
            },
        ],
        stratigraphy: default_strata(),
        materials: default_materials(),
        structures: vec![],
        uncertainty: UncertaintySpec::default(),
        constraints: vec![TerrainConstraint::WalkableComponents { min: 1, max: 1 }],
        hydrology: HydrologySpec {
            channel_threshold: 900.0,
            bank_width_m: 18.0,
            ..HydrologySpec::default()
        },
        output: OutputSpec {
            elevation_node: 2,
            hardness_node: Some(4),
            rainfall_node: Some(3),
            ..OutputSpec::default()
        },
    }
}
pub fn mountain_pass_v1() -> TerrainRecipe {
    TerrainRecipe {
        id: MOUNTAIN_PASS_V1.into(),
        schema_version: 1,
        nodes: vec![
            TerrainNode {
                id: 0,
                op: FieldOp::Plane {
                    direction: [0.0, 1.0],
                    slope: 0.01,
                    base: 0.0,
                },
                inputs: vec![],
                strength: 1.0,
                mask: None,
            },
            TerrainNode {
                id: 1,
                op: FieldOp::Ridge {
                    start: [-400.0, -300.0],
                    end: [350.0, 320.0],
                    width: 130.0,
                    amplitude: 85.0,
                },
                inputs: vec![],
                strength: 1.0,
                mask: None,
            },
            TerrainNode {
                id: 2,
                op: FieldOp::NoiseFbm {
                    frequency: 0.007,
                    octaves: 3,
                    amplitude: 7.0,
                },
                inputs: vec![],
                strength: 1.0,
                mask: None,
            },
            TerrainNode {
                id: 3,
                op: FieldOp::Add,
                inputs: vec![0, 1, 2],
                strength: 1.0,
                mask: None,
            },
            TerrainNode {
                id: 4,
                op: FieldOp::Constant { value: 0.8 },
                inputs: vec![],
                strength: 1.0,
                mask: None,
            },
            TerrainNode {
                id: 5,
                op: FieldOp::Constant { value: 0.5 },
                inputs: vec![],
                strength: 1.0,
                mask: None,
            },
        ],
        stratigraphy: default_strata(),
        materials: default_materials(),
        structures: vec![],
        uncertainty: UncertaintySpec::default(),
        constraints: vec![
            TerrainConstraint::WalkableComponents { min: 1, max: 1 },
            TerrainConstraint::BuildableArea { min_cells: 64 },
        ],
        hydrology: HydrologySpec {
            channel_threshold: 900.0,
            bank_width_m: 18.0,
            ..HydrologySpec::default()
        },
        output: OutputSpec {
            elevation_node: 3,
            hardness_node: Some(4),
            rainfall_node: Some(5),
            ..OutputSpec::default()
        },
    }
}

pub fn river_valley_v1() -> TerrainRecipe {
    recipe_from_nodes(
        RIVER_VALLEY_V1,
        common_nodes(
            FieldOp::Plane {
                direction: [0.0, 1.0],
                slope: 0.008,
                base: 8.0,
            },
            FieldOp::Valley {
                start: [-500.0, -420.0],
                end: [500.0, 420.0],
                width: 105.0,
                depth: 42.0,
            },
            6.0,
        ),
        3,
        HydrologySpec {
            channel_threshold: 420.0,
            bank_width_m: 18.0,
            ..HydrologySpec::default()
        },
    )
}

pub fn plateau_v1() -> TerrainRecipe {
    recipe_from_nodes(
        PLATEAU_V1,
        common_nodes(
            FieldOp::Plane {
                direction: [0.15, 0.98],
                slope: 0.006,
                base: 0.0,
            },
            FieldOp::Plateau {
                center: [0.0, 0.0],
                radius: 245.0,
                height: 22.0,
                edge: 90.0,
            },
            4.0,
        ),
        3,
        HydrologySpec {
            min_lake_depth_m: 20.0,
            ..HydrologySpec::default()
        },
    )
}

pub fn basin_oasis_v1() -> TerrainRecipe {
    recipe_from_nodes(
        BASIN_OASIS_V1,
        common_nodes(
            FieldOp::Plane {
                direction: [0.0, 1.0],
                slope: 0.004,
                base: 12.0,
            },
            FieldOp::Depression {
                center: [0.0, 15.0],
                radius: 330.0,
                depth: 34.0,
            },
            5.0,
        ),
        3,
        HydrologySpec {
            min_lake_depth_m: 0.75,
            ..HydrologySpec::default()
        },
    )
}

pub fn alluvial_fan_v1() -> TerrainRecipe {
    recipe_from_nodes(
        ALLUVIAL_FAN_V1,
        common_nodes(
            FieldOp::Plane {
                direction: [0.0, 1.0],
                slope: -0.01,
                base: 18.0,
            },
            FieldOp::Cone {
                center: [0.0, -230.0],
                radius: 520.0,
                height: 32.0,
            },
            4.5,
        ),
        3,
        HydrologySpec {
            channel_threshold: 700.0,
            bank_width_m: 12.0,
            min_lake_depth_m: 20.0,
            ..HydrologySpec::default()
        },
    )
}

pub fn volcanic_lake_v1() -> TerrainRecipe {
    recipe_from_nodes(
        VOLCANIC_LAKE_V1,
        common_nodes(
            FieldOp::Plane {
                direction: [0.0, 1.0],
                slope: 0.003,
                base: 18.0,
            },
            FieldOp::Depression {
                center: [40.0, 25.0],
                radius: 205.0,
                depth: 58.0,
            },
            3.5,
        ),
        3,
        HydrologySpec {
            channel_threshold: f32::MAX,
            bank_width_m: 0.0,
            min_lake_depth_m: 1.0,
            ..HydrologySpec::default()
        },
    )
}

pub fn hillside_woodland_v1() -> TerrainRecipe {
    recipe_from_nodes(
        HILLSIDE_WOODLAND_V1,
        common_nodes(
            FieldOp::Plane {
                direction: [0.25, 0.97],
                slope: 0.012,
                base: 0.0,
            },
            FieldOp::Ridge {
                start: [-330.0, 360.0],
                end: [340.0, 170.0],
                width: 170.0,
                amplitude: 38.0,
            },
            5.0,
        ),
        3,
        HydrologySpec {
            min_lake_depth_m: 20.0,
            ..HydrologySpec::default()
        },
    )
}

pub fn builtin(id: &str) -> Option<TerrainRecipe> {
    match id {
        GRASSLAND_PLAIN_V1 => Some(grassland_plain_v1()),
        MOUNTAIN_PASS_V1 => Some(mountain_pass_v1()),
        RIVER_VALLEY_V1 => Some(river_valley_v1()),
        PLATEAU_V1 => Some(plateau_v1()),
        BASIN_OASIS_V1 => Some(basin_oasis_v1()),
        ALLUVIAL_FAN_V1 => Some(alluvial_fan_v1()),
        VOLCANIC_LAKE_V1 => Some(volcanic_lake_v1()),
        HILLSIDE_WOODLAND_V1 => Some(hillside_woodland_v1()),
        _ => None,
    }
}
pub fn builtins() -> Vec<TerrainRecipe> {
    vec![
        grassland_plain_v1(),
        mountain_pass_v1(),
        river_valley_v1(),
        plateau_v1(),
        basin_oasis_v1(),
        alluvial_fan_v1(),
        volcanic_lake_v1(),
        hillside_woodland_v1(),
    ]
}
fn default_strata() -> StratigraphicColumn {
    StratigraphicColumn {
        units: vec![
            StratumSpec {
                id: 0,
                thickness_m: 2.0,
                material: 1,
                hardness: 0.2,
                soil_storage: 0.9,
                permeability: 0.8,
                palette: 1,
            },
            StratumSpec {
                id: 1,
                thickness_m: 18.0,
                material: 0,
                hardness: 0.5,
                soil_storage: 0.7,
                permeability: 0.5,
                palette: 0,
            },
            StratumSpec {
                id: 2,
                thickness_m: 1000.0,
                material: 4,
                hardness: 0.95,
                soil_storage: 0.05,
                permeability: 0.05,
                palette: 3,
            },
        ],
    }
}

fn default_materials() -> MaterialTable {
    MaterialTable::default()
}
