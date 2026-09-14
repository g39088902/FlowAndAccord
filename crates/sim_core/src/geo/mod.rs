pub mod biome;
pub mod query;
pub mod terrain;
pub mod hydrology;
pub mod corridor;
pub mod accents;
pub mod validation;
pub mod plateau;

pub use biome::{GeoCell, SurfaceKind};
pub use plateau::PlateauGeometry;
pub use query::{explain_failure, sample_cell, validate_footprint, FootprintQuery, LandUseKind, TerrainFailure, TerrainQueryResult};
pub use terrain::{BranchRidge, GenesisOverrides, TerrainFeature, TerrainFeatureKind, TerrainMap, TerrainSubFeature, TerrainSubFeatureKind, TERRAIN_GENERATOR_VERSION, TERRAIN_PROFILE_FLAT_BASELINE, TERRAIN_PROFILE_GRASSLAND_PLAIN, TERRAIN_PROFILE_HILLSIDE_WOODLAND, TERRAIN_PROFILE_MOUNTAIN_PASS, TERRAIN_PROFILE_PLATEAU_SETTLEMENT, TERRAIN_PROFILE_RANDOM, TERRAIN_PROFILE_RIVER_VALLEY, TERRAIN_PROFILE_RIVER_VALLEY_SETTLEMENT};
pub use accents::{AccentKind, TerrainAccent, ACCENT_RNG_SALT};
