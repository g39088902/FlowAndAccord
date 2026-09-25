//! Geometry backends behind the terrain compiler.
pub mod heightfield;
pub mod layers;
pub mod meshing;
pub mod voxel;
pub use heightfield::{HeightfieldBackend, HeightfieldView};
pub use layers::{LayeredTerrainQuery, SolidInterval, SurfaceHit};
pub use meshing::{
    extract_surface_nets, extract_surface_nets_at, MeshTriangle, MeshVertex, SurfaceMesh,
};
pub use voxel::{
    TerrainGeometry, VoxelBackend, VoxelError, DENSITY_SCALE, HEIGHTFIELD_QUANTUM_M,
    VOXEL_CHUNK_SIZE, VOXEL_HALO,
};
