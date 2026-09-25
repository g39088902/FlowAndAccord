pub mod accents;
pub mod adapters;
pub mod alluvial_fan;
pub mod backend;
pub mod basin;
pub mod biome;
pub mod corridor;
pub mod generator;
mod geometry_transaction;
pub mod hydrology;
pub mod plateau;
pub mod procedural;
pub mod query;
pub mod runtime;
pub mod static_water;
pub mod terrain;
pub mod validation;
pub mod volcanic_lake;

pub use accents::{AccentKind, TerrainAccent, ACCENT_RNG_SALT};
pub use alluvial_fan::FanGeometry;
pub use basin::BasinGeometry;
pub use biome::{GeoCell, SurfaceKind};
pub use generator::TerrainGenerator;
pub use hydrology::{MeanderWindow, RiverCenterline};
pub use plateau::PlateauGeometry;
pub use query::{
    explain_failure, sample_cell, validate_footprint, FootprintQuery, LandUseKind, TerrainFailure,
    TerrainQueryResult,
};
pub use runtime::TerrainRuntime;
pub use terrain::{
    is_static_water_profile, water_source_poi_count, BranchRidge, GenesisOverrides, TerrainFeature,
    TerrainFeatureKind, TerrainMap, TerrainSubFeature, TerrainSubFeatureKind,
    TERRAIN_GENERATOR_VERSION, TERRAIN_PROFILE_ALLUVIAL_FAN, TERRAIN_PROFILE_BASIN_OASIS,
    TERRAIN_PROFILE_FLAT_BASELINE, TERRAIN_PROFILE_GRASSLAND_PLAIN,
    TERRAIN_PROFILE_HILLSIDE_WOODLAND, TERRAIN_PROFILE_MOUNTAIN_PASS, TERRAIN_PROFILE_PLATEAU,
    TERRAIN_PROFILE_RANDOM, TERRAIN_PROFILE_RIVER_VALLEY, TERRAIN_PROFILE_VOLCANIC_LAKE,
};
pub use volcanic_lake::VolcanicLakeGeometry;

// Field compiler and geometry backends are additive during migration.
pub use adapters::{compare_recipe_to_legacy, terrain_map_from_compiled, TerrainMigrationDiff};
pub use backend::{
    extract_surface_nets, extract_surface_nets_at, ChunkDelta, DeltaRun, HeightfieldBackend, HeightfieldView,
    LayeredTerrainQuery, MeshTriangle, MeshVertex, SolidInterval, SurfaceHit, SurfaceMesh,
    TerrainGeometry, TerrainStaticKey, VoxelBackend, VoxelError, DENSITY_SCALE,
    HEIGHTFIELD_QUANTUM_M, TERRAIN_CHUNK_PACKET_HEADER_LEN, TERRAIN_CHUNK_PACKET_VERSION,
    VOXEL_BACKEND_VERSION, VOXEL_CHUNK_SIZE, VOXEL_HALO,
};
pub use procedural::{
    BackendKind, CompiledTerrain, Field2, FieldOp, TerrainCompileError, TerrainRecipe,
};
