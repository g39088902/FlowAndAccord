//! Deterministic sparse voxel storage and top-surface compatibility queries.
//!
//! Chunks are static creation data. They are never sampled from the simulation
//! tick; callers explicitly build/load them and then use `TerrainGeometry` or
//! `LayeredTerrainQuery` for geometry work.
use super::heightfield::HeightfieldBackend;
use super::layers::{LayeredTerrainQuery, SolidInterval, SurfaceHit};
use crate::geo::biome::SurfaceKind;
use crate::geo::procedural::{ChunkCoord, CompiledTerrain, Field3Chunk, FieldError};
use crate::spatial::vec3::Vec3;
use std::collections::BTreeMap;

pub const VOXEL_CHUNK_SIZE: u8 = 32;
pub const VOXEL_HALO: u8 = 1;
pub const DENSITY_SCALE: f32 = 256.0;
pub const HEIGHTFIELD_QUANTUM_M: f32 = 1.0 / DENSITY_SCALE;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoxelError {
    InvalidChunk,
    MissingChunk,
    InvalidBounds,
    InvalidScale,
    Field(FieldError),
}

#[derive(Debug, Clone)]
pub struct VoxelBackend {
    pub chunk_size: u8,
    pub halo: u8,
    pub chunks: BTreeMap<ChunkCoord, Field3Chunk>,
    pub density_scale: f32,
    pub voxel_scale: f32,
    pub origin: Vec3,
    pub min_z: f32,
    pub max_z: f32,
    /// Optional source retained by compiler-built backends for exact
    /// top-surface compatibility queries. Hand-authored chunks use density
    /// ray queries instead.
    source_heightfield: Option<HeightfieldBackend>,
}

impl Default for VoxelBackend {
    fn default() -> Self {
        Self {
            chunk_size: VOXEL_CHUNK_SIZE,
            halo: VOXEL_HALO,
            chunks: BTreeMap::new(),
            density_scale: DENSITY_SCALE,
            voxel_scale: 1.0,
            origin: Vec3::ZERO,
            min_z: 0.0,
            max_z: 0.0,
            source_heightfield: None,
        }
    }
}

impl VoxelBackend {
    pub fn new() -> Self {
        Self::default()
    }

    /// Build a static topography volume from the compatibility heightfield.
    pub fn from_heightfield(
        heightfield: &HeightfieldBackend,
        min_z: f32,
        max_z: f32,
        voxel_scale: f32,
    ) -> Result<Self, VoxelError> {
        if !min_z.is_finite() || !max_z.is_finite() || min_z >= max_z {
            return Err(VoxelError::InvalidBounds);
        }
        if !voxel_scale.is_finite() || voxel_scale <= 0.0 {
            return Err(VoxelError::InvalidScale);
        }
        let half = heightfield.world_size * 0.5;
        let origin = Vec3::new(-half, -half, min_z);
        let mut backend = Self {
            voxel_scale,
            origin,
            min_z,
            max_z,
            source_heightfield: Some(heightfield.clone()),
            ..Self::default()
        };
        let horizontal = (heightfield.world_size / voxel_scale).ceil() as i32;
        let vertical = ((max_z - min_z) / voxel_scale).ceil() as i32;
        let x_chunks = div_ceil(horizontal, backend.chunk_size as i32);
        let y_chunks = x_chunks;
        let z_chunks = div_ceil(vertical, backend.chunk_size as i32);
        for cz in 0..z_chunks {
            for cy in 0..y_chunks {
                for cx in 0..x_chunks {
                    let coord = ChunkCoord {
                        x: cx,
                        y: cy,
                        z: cz,
                    };
                    let chunk = backend.build_chunk(heightfield, coord)?;
                    backend.chunks.insert(coord, chunk);
                }
            }
        }
        Ok(backend)
    }

    pub fn from_compiled(compiled: &CompiledTerrain, voxel_scale: f32) -> Result<Self, VoxelError> {
        let heightfield = HeightfieldBackend::from_compiled_default(compiled);
        let (min, max) = compiled
            .fields
            .elevation
            .values
            .iter()
            .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), v| {
                (lo.min(*v), hi.max(*v))
            });
        let margin = voxel_scale.max(1.0) * 2.0;
        Self::from_heightfield(&heightfield, min - margin, max + margin, voxel_scale)
    }

    pub fn insert_chunk(&mut self, chunk: Field3Chunk) {
        self.chunks.insert(chunk.coord, chunk);
    }
    pub fn chunk(&self, c: ChunkCoord) -> Option<&Field3Chunk> {
        self.chunks.get(&c)
    }
    pub fn sample_density_at(&self, c: ChunkCoord, index: usize) -> Option<i16> {
        self.chunks
            .get(&c)
            .and_then(|ch| ch.density_q16.get(index))
            .copied()
    }

    pub fn mesh_chunk(&self, coord: ChunkCoord) -> Result<super::meshing::SurfaceMesh, VoxelError> {
        let chunk = self.chunks.get(&coord).ok_or(VoxelError::MissingChunk)?;
        Ok(super::meshing::extract_surface_nets_at(
            chunk,
            self.voxel_scale,
            {
                let p = self.chunk_origin(coord);
                [p.x, p.y, p.z]
            },
        ))
    }

    fn build_chunk(
        &self,
        heightfield: &HeightfieldBackend,
        coord: ChunkCoord,
    ) -> Result<Field3Chunk, VoxelError> {
        let mut chunk =
            Field3Chunk::new(coord, self.chunk_size, self.halo).map_err(VoxelError::Field)?;
        let side = (self.chunk_size + self.halo * 2) as usize;
        let base = self.chunk_origin(coord);
        for z in 0..side {
            for y in 0..side {
                for x in 0..side {
                    let p = Vec3::new(
                        base.x + (x as f32 - self.halo as f32) * self.voxel_scale,
                        base.y + (y as f32 - self.halo as f32) * self.voxel_scale,
                        base.z + (z as f32 - self.halo as f32) * self.voxel_scale,
                    );
                    let surface = heightfield.sample_elevation(p.x, p.y);
                    let density = ((surface - p.z) * self.density_scale)
                        .round()
                        .clamp(i16::MIN as f32, i16::MAX as f32)
                        as i16;
                    let i = z * side * side + y * side + x;
                    chunk.density_q16[i] = density;
                    chunk.material[i] =
                        material_for(heightfield.sample_cell(p.x, p.y).surface_kind);
                }
            }
        }
        Ok(chunk)
    }

    fn chunk_origin(&self, coord: ChunkCoord) -> Vec3 {
        Vec3::new(
            self.origin.x + coord.x as f32 * self.chunk_size as f32 * self.voxel_scale,
            self.origin.y + coord.y as f32 * self.chunk_size as f32 * self.voxel_scale,
            self.origin.z + coord.z as f32 * self.chunk_size as f32 * self.voxel_scale,
        )
    }

    fn lookup(&self, p: Vec3) -> Option<(&Field3Chunk, usize)> {
        if !p.x.is_finite() || !p.y.is_finite() || !p.z.is_finite() {
            return None;
        }
        let vx = ((p.x - self.origin.x) / self.voxel_scale).floor() as i32;
        let vy = ((p.y - self.origin.y) / self.voxel_scale).floor() as i32;
        let vz = ((p.z - self.origin.z) / self.voxel_scale).floor() as i32;
        let size = self.chunk_size as i32;
        let coord = ChunkCoord {
            x: vx.div_euclid(size),
            y: vy.div_euclid(size),
            z: vz.div_euclid(size),
        };
        let chunk = self.chunks.get(&coord)?;
        let side = (chunk.size + 2 * chunk.halo) as usize;
        let halo = chunk.halo as i32;
        let ix = (vx.rem_euclid(size) + halo) as usize;
        let iy = (vy.rem_euclid(size) + halo) as usize;
        let iz = (vz.rem_euclid(size) + halo) as usize;
        Some((chunk, iz * side * side + iy * side + ix))
    }

    fn density_world(&self, p: Vec3) -> i16 {
        if !p.x.is_finite() || !p.y.is_finite() || !p.z.is_finite() {
            return 0;
        }
        let qx = (p.x - self.origin.x) / self.voxel_scale;
        let qy = (p.y - self.origin.y) / self.voxel_scale;
        let qz = (p.z - self.origin.z) / self.voxel_scale;
        let x = qx.floor() as i32;
        let y = qy.floor() as i32;
        let z = qz.floor() as i32;
        let tx = qx - x as f32;
        let ty = qy - y as f32;
        let tz = qz - z as f32;
        let mut value = 0.0;
        for dz in 0..=1 {
            for dy in 0..=1 {
                for dx in 0..=1 {
                    let wx = if dx == 0 { 1.0 - tx } else { tx };
                    let wy = if dy == 0 { 1.0 - ty } else { ty };
                    let wz = if dz == 0 { 1.0 - tz } else { tz };
                    value += self.node_density(x + dx, y + dy, z + dz).unwrap_or(0) as f32
                        * wx
                        * wy
                        * wz;
                }
            }
        }
        value.round().clamp(i16::MIN as f32, i16::MAX as f32) as i16
    }

    fn node_density(&self, vx: i32, vy: i32, vz: i32) -> Option<i16> {
        let size = self.chunk_size as i32;
        let coord = ChunkCoord {
            x: vx.div_euclid(size),
            y: vy.div_euclid(size),
            z: vz.div_euclid(size),
        };
        let chunk = self.chunks.get(&coord)?;
        let side = (chunk.size + 2 * chunk.halo) as usize;
        let halo = chunk.halo as i32;
        let ix = (vx.rem_euclid(size) + halo) as usize;
        let iy = (vy.rem_euclid(size) + halo) as usize;
        let iz = (vz.rem_euclid(size) + halo) as usize;
        chunk
            .density_q16
            .get(iz * side * side + iy * side + ix)
            .copied()
    }
}

pub trait TerrainGeometry {
    fn sample_density(&self, p: Vec3) -> i16;
    fn sample_material(&self, p: Vec3) -> u8;
    fn load_chunk(&self, c: ChunkCoord) -> Result<&Field3Chunk, VoxelError>;
}

impl TerrainGeometry for VoxelBackend {
    fn sample_density(&self, p: Vec3) -> i16 {
        self.density_world(p)
    }
    fn sample_material(&self, p: Vec3) -> u8 {
        self.lookup(p).map(|(c, i)| c.material[i]).unwrap_or(0)
    }
    fn load_chunk(&self, c: ChunkCoord) -> Result<&Field3Chunk, VoxelError> {
        self.chunks.get(&c).ok_or(VoxelError::MissingChunk)
    }
}

impl LayeredTerrainQuery for VoxelBackend {
    fn solid_intervals(&self, x: f32, y: f32) -> Vec<SolidInterval> {
        let Some(hit) = self.surface_at(x, y, 0) else {
            return Vec::new();
        };
        vec![SolidInterval {
            z_min: self.min_z,
            z_max: hit.z,
            material: hit.material,
            walkable: true,
        }]
    }

    fn surface_at(&self, x: f32, y: f32, layer: u16) -> Option<SurfaceHit> {
        if layer != 0 || !x.is_finite() || !y.is_finite() {
            return None;
        }
        if let Some(heightfield) = &self.source_heightfield {
            return Some(SurfaceHit {
                z: heightfield.surface_at(x, y),
                material: material_for(heightfield.sample_cell(x, y).surface_kind),
                layer,
            });
        }
        let mut hi = self.max_z;
        let mut lo = self.min_z;
        if self.density_world(Vec3::new(x, y, hi)) >= 0 {
            return Some(SurfaceHit {
                z: hi,
                material: self.sample_material(Vec3::new(x, y, hi)),
                layer,
            });
        }
        if self.density_world(Vec3::new(x, y, lo)) < 0 {
            return None;
        }
        for _ in 0..16 {
            let mid = (lo + hi) * 0.5;
            if self.density_world(Vec3::new(x, y, mid)) >= 0 {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        let z = (lo + hi) * 0.5;
        Some(SurfaceHit {
            z,
            material: self.sample_material(Vec3::new(x, y, z)),
            layer,
        })
    }
}

fn div_ceil(value: i32, divisor: i32) -> i32 {
    (value.max(0) + divisor - 1) / divisor
}

fn material_for(kind: SurfaceKind) -> u8 {
    match kind {
        SurfaceKind::DryGround => 0,
        SurfaceKind::SoftGround => 1,
        SurfaceKind::ShallowWater | SurfaceKind::DeepWater => 2,
        SurfaceKind::RiverBank | SurfaceKind::RiverTerrace => 3,
        SurfaceKind::RockFace => 4,
    }
}
