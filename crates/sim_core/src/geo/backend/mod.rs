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
    ChunkDelta, DeltaRun, TerrainGeometry, TerrainStaticKey, VoxelBackend, VoxelError, DENSITY_SCALE,
    HEIGHTFIELD_QUANTUM_M, TERRAIN_CHUNK_PACKET_HEADER_LEN, TERRAIN_CHUNK_PACKET_VERSION,
    VOXEL_BACKEND_VERSION, VOXEL_CHUNK_SIZE, VOXEL_HALO,
};
