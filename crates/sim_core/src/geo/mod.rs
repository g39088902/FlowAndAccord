pub mod biome;
pub mod query;
pub mod terrain;

pub use biome::{GeoCell, SurfaceKind};
pub use query::{explain_failure, sample_cell, validate_footprint, FootprintQuery, LandUseKind, TerrainFailure, TerrainQueryResult};
pub use terrain::{TerrainFeature, TerrainFeatureKind, TerrainMap, TERRAIN_GENERATOR_VERSION, TERRAIN_PROFILE_MOUNTAIN_PASS};
