//! Field graph based terrain generation primitives (UGC-01).
pub mod compiler;
pub mod constraints;
pub mod diagnostics;
pub mod fields;
pub mod groundwater;
pub mod hydrology;
pub mod ir;
pub mod materials;
pub mod operators;
pub mod processes;
pub mod recipes;
pub mod semantics;
pub mod strata;
pub mod uncertainty;
pub use compiler::{
    compile_terrain, compile_terrain_with_dimensions, BackendKind, CompiledTerrain,
    TerrainCompileError, TerrainFields,
};
pub use fields::{
    ChunkCoord, Field2, Field3Chunk, FieldError, FieldWriter, MaskField, MaterialField, Point2,
    ScalarField,
};
pub use ir::{
    validate_recipe, FieldOp, HydrologySpec, NodeId, OutputSpec, ProcessOp, RecipeError, RecipeId,
    ResolvedRecipe, StratigraphicColumn, StratumSpec, TerrainNode, TerrainRecipe,
};
pub use recipes::{
    alluvial_fan_v1, basin_oasis_v1, builtin, builtins, grassland_plain_v1, hillside_woodland_v1,
    mountain_pass_v1, plateau_v1, river_valley_v1, volcanic_lake_v1, ALLUVIAL_FAN_V1,
    BASIN_OASIS_V1, GRASSLAND_PLAIN_V1, HILLSIDE_WOODLAND_V1, MOUNTAIN_PASS_V1, PLATEAU_V1,
    RIVER_VALLEY_V1, VOLCANIC_LAKE_V1,
};

pub use hydrology::{ChannelField, HydrologyFields, HydrologySettings};
pub use materials::{MaterialProps, MaterialTable};
pub use strata::{sample_stratum, validate_column, StratumSample};
pub use processes::{ErosionResult, ErosionSettings, FlowField, WaterBodyField};
