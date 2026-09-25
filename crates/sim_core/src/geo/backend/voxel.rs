//! Deterministic sparse voxel storage and top-surface compatibility queries.
//!
//! Chunks are static creation data. They are never sampled from the simulation
//! tick; callers explicitly build/load them and then use `TerrainGeometry` or
//! `LayeredTerrainQuery` for geometry work.
use super::heightfield::HeightfieldBackend;
use super::layers::{LayeredTerrainQuery, SolidInterval, SurfaceHit};
use crate::geo::biome::SurfaceKind;
use crate::geo::procedural::{
    sample_stratum, ChunkCoord, CompiledTerrain, Field3Chunk, FieldError, MaterialTable,
    StratigraphicColumn,
};
use crate::spatial::vec3::Vec3;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const VOXEL_CHUNK_SIZE: u8 = 32;
pub const VOXEL_HALO: u8 = 1;
pub const DENSITY_SCALE: f32 = 256.0;
pub const HEIGHTFIELD_QUANTUM_M: f32 = 1.0 / DENSITY_SCALE;
pub const VOXEL_BACKEND_VERSION: u32 = 2;
pub const TERRAIN_CHUNK_PACKET_VERSION: u16 = 1;
pub const TERRAIN_CHUNK_PACKET_HEADER_LEN: usize = 52;

/// Stable identity for static terrain data and voxel cache entries.
///
/// This key is intentionally independent from the simulation tick and is safe
/// to persist alongside a save without putting static chunk arrays in FABS.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TerrainStaticKey {
    pub recipe_id: String,
    pub recipe_hash: u64,
    pub seed: u64,
    pub generator_version: u32,
    pub voxel_backend_version: u32,
}

/// A run-length encoded edit against one generated voxel chunk.
///
/// Runs replace both density and material samples in row-major order. Keeping
/// the run payload independent from the static terrain key lets saves carry
/// only authored edits while the compiler rebuilds the baseline on demand.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeltaRun {
    pub start: u32,
    pub density_q16: Vec<i16>,
    pub material: Vec<u8>,
}

/// Persisted authored changes for one voxel chunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChunkDelta {
    pub coord: ChunkCoord,
    pub base_hash: u64,
    #[serde(default)]
    pub runs: Vec<DeltaRun>,
}

impl ChunkDelta {
    /// Validate run ordering and bounds against a generated chunk.
    pub fn validate(&self, sample_count: usize) -> Result<(), VoxelError> {
        let mut previous_end = 0usize;
        for run in &self.runs {
            if run.density_q16.is_empty() || run.density_q16.len() != run.material.len() {
                return Err(VoxelError::InvalidDelta);
            }
            let start = run.start as usize;
            let end = start
                .checked_add(run.density_q16.len())
                .ok_or(VoxelError::InvalidDelta)?;
            if start < previous_end || end > sample_count {
                return Err(VoxelError::InvalidDelta);
            }
            previous_end = end;
        }
        Ok(())
    }
}

impl TerrainStaticKey {
    pub fn from_terrain_map(map: &crate::geo::terrain::TerrainMap) -> Self {
        let recipe_hash = crate::geo::procedural::builtin(&map.profile)
            .and_then(|recipe| serde_json::to_vec(&recipe).ok())
            .map(|bytes| crate::geo::procedural::diagnostics::recipe_hash(&bytes))
            .unwrap_or_else(|| crate::geo::procedural::diagnostics::recipe_hash(map.profile.as_bytes()));
        Self {
            recipe_id: map.profile.clone(),
            recipe_hash,
            seed: map.seed,
            generator_version: map.generator_version,
            voxel_backend_version: VOXEL_BACKEND_VERSION,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoxelError {
    InvalidChunk,
    MissingChunk,
    InvalidBounds,
    InvalidScale,
    InvalidDelta,
    DeltaBaseMismatch,
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
    source_stratigraphy: Option<StratigraphicColumn>,
    material_table: MaterialTable,
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
            source_stratigraphy: None,
            material_table: MaterialTable::default(),
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
            source_stratigraphy: heightfield.stratigraphy.clone(),
            material_table: heightfield.materials.clone(),
            ..Self::default()
        };
        let horizontal = (heightfield.world_size / voxel_scale).ceil() as i32;
        let vertical = ((max_z - min_z) / voxel_scale).ceil() as i32;
        let x_chunks = div_ceil(horizontal, backend.chunk_size as i32);
        let y_chunks = x_chunks;
        let z_chunks = div_ceil(vertical.max(1), backend.chunk_size as i32).max(1);
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

    /// Build the static voxel volume from the current compatibility map.
    /// This is the UGC-05 request path: it never touches `WorldRng`.
    pub fn from_terrain_map(
        map: &crate::geo::terrain::TerrainMap,
        voxel_scale: f32,
    ) -> Result<Self, VoxelError> {
        let heightfield = HeightfieldBackend::from_terrain_map(map).ok_or(VoxelError::InvalidBounds)?;
        let (min, max) = map
            .cells
            .iter()
            .map(|cell| cell.elevation)
            .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), value| {
                (lo.min(value), hi.max(value))
            });
        let margin = voxel_scale.max(1.0) * 2.0;
        Self::from_heightfield(&heightfield, min - margin, max + margin, voxel_scale)
    }

    /// Same static source as `from_terrain_map`, but leave chunks unallocated
    /// until `ensure_chunk`/`encode_chunk` requests them. This is the WASM
    /// request path and keeps untouched chunks out of the cache.
    pub fn from_terrain_map_lazy(
        map: &crate::geo::terrain::TerrainMap,
        voxel_scale: f32,
    ) -> Result<Self, VoxelError> {
        if !voxel_scale.is_finite() || voxel_scale <= 0.0 {
            return Err(VoxelError::InvalidScale);
        }
        let heightfield = HeightfieldBackend::from_terrain_map(map).ok_or(VoxelError::InvalidBounds)?;
        let (min, max) = map
            .cells
            .iter()
            .map(|cell| cell.elevation)
            .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), value| {
                (lo.min(value), hi.max(value))
            });
        if !min.is_finite() || !max.is_finite() || min > max {
            return Err(VoxelError::InvalidBounds);
        }
        let margin = voxel_scale.max(1.0) * 2.0;
        let min_z = min - margin;
        let max_z = max + margin;
        let half = heightfield.world_size * 0.5;
        Ok(Self {
            voxel_scale,
            origin: Vec3::new(-half, -half, min_z),
            min_z,
            max_z,
            source_heightfield: Some(heightfield),
            ..Self::default()
        })
    }

    pub fn insert_chunk(&mut self, chunk: Field3Chunk) {
        self.chunks.insert(chunk.coord, chunk);
    }

    pub fn ensure_chunk(&mut self, coord: ChunkCoord) -> Result<(), VoxelError> {
        if coord.x < 0 || coord.y < 0 || coord.z < 0 {
            return Err(VoxelError::MissingChunk);
        }
        let horizontal = (self.world_size() / self.voxel_scale).ceil() as i32;
        let vertical = ((self.max_z - self.min_z) / self.voxel_scale).ceil() as i32;
        let x_chunks = div_ceil(horizontal, self.chunk_size as i32).max(1);
        let z_chunks = div_ceil(vertical.max(1), self.chunk_size as i32).max(1);
        if coord.x >= x_chunks || coord.y >= x_chunks || coord.z >= z_chunks {
            return Err(VoxelError::MissingChunk);
        }
        if self.chunks.contains_key(&coord) {
            return Ok(());
        }
        let chunk = {
            let heightfield = self
                .source_heightfield
                .as_ref()
                .ok_or(VoxelError::MissingChunk)?;
            self.build_chunk(heightfield, coord)?
        };
        self.chunks.insert(coord, chunk);
        Ok(())
    }

    fn world_size(&self) -> f32 {
        self.origin.x.abs() * 2.0
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

    /// Return a stable hash of the generated chunk before authored edits.
    pub fn chunk_hash(&mut self, coord: ChunkCoord) -> Result<u64, VoxelError> {
        self.ensure_chunk(coord)?;
        self.chunks
            .get(&coord)
            .map(hash_chunk)
            .ok_or(VoxelError::MissingChunk)
    }

    /// Verify and apply an authored chunk delta to the generated baseline.
    pub fn apply_delta(&mut self, delta: &ChunkDelta) -> Result<(), VoxelError> {
        self.ensure_chunk(delta.coord)?;
        let sample_count = self
            .chunks
            .get(&delta.coord)
            .ok_or(VoxelError::MissingChunk)?
            .density_q16
            .len();
        delta.validate(sample_count)?;
        let base_hash = self
            .chunks
            .get(&delta.coord)
            .map(hash_chunk)
            .ok_or(VoxelError::MissingChunk)?;
        if base_hash != delta.base_hash {
            return Err(VoxelError::DeltaBaseMismatch);
        }
        let chunk = self
            .chunks
            .get_mut(&delta.coord)
            .ok_or(VoxelError::MissingChunk)?;
        for run in &delta.runs {
            let start = run.start as usize;
            let end = start + run.density_q16.len();
            chunk.density_q16[start..end].copy_from_slice(&run.density_q16);
            chunk.material[start..end].copy_from_slice(&run.material);
        }
        Ok(())
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

    /// Encode one chunk into the stable UGC-05 little-endian packet format.
    ///
    /// Header fields: magic `FAVX`, packet version, chunk coordinate, size,
    /// halo, voxel scale, world origin, sample count, density byte length and
    /// material byte length. Payload order is density `i16` values followed by
    /// material `u8` values in z/y/x row-major order.
    pub fn encode_chunk(&mut self, coord: ChunkCoord, out: &mut Vec<u8>) -> Result<(), VoxelError> {
        self.ensure_chunk(coord)?;
        let chunk = self.chunks.get(&coord).ok_or(VoxelError::MissingChunk)?;
        if chunk.density_q16.len() != chunk.material.len() {
            return Err(VoxelError::InvalidChunk);
        }
        let origin = self.chunk_origin(coord);
        let sample_count = chunk.density_q16.len();
        let density_bytes = sample_count.checked_mul(2).ok_or(VoxelError::InvalidChunk)?;
        let total = TERRAIN_CHUNK_PACKET_HEADER_LEN
            .checked_add(density_bytes)
            .and_then(|value| value.checked_add(sample_count))
            .ok_or(VoxelError::InvalidChunk)?;
        out.clear();
        out.reserve(total);
        out.extend_from_slice(b"FAVX");
        push_u16(out, TERRAIN_CHUNK_PACKET_VERSION);
        push_u16(out, 0);
        push_i32(out, coord.x);
        push_i32(out, coord.y);
        push_i32(out, coord.z);
        out.push(chunk.size);
        out.push(chunk.halo);
        push_u16(out, 0);
        push_f32(out, self.voxel_scale);
        push_f32(out, origin.x);
        push_f32(out, origin.y);
        push_f32(out, origin.z);
        push_u32(out, sample_count as u32);
        push_u32(out, density_bytes as u32);
        push_u32(out, sample_count as u32);
        for &value in &chunk.density_q16 {
            out.extend_from_slice(&value.to_le_bytes());
        }
        out.extend_from_slice(&chunk.material);
        debug_assert_eq!(out.len(), total);
        Ok(())
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
                    chunk.material[i] = self.material_at_depth(
                        heightfield,
                        p.x,
                        p.y,
                        p.z,
                        surface,
                    );
                }
            }
        }
        Ok(chunk)
    }

    fn material_at_depth(
        &self,
        heightfield: &HeightfieldBackend,
        x: f32,
        y: f32,
        z: f32,
        surface: f32,
    ) -> u8 {
        if let Some(column) = &self.source_stratigraphy {
            let depth = (surface - z).max(0.0);
            if let Some(sample) = sample_stratum(column, depth) {
                if self.material_table.get(sample.material).is_some() {
                    return sample.material;
                }
            }
        }
        material_for(heightfield.sample_cell(x, y).surface_kind)
    }

    pub fn chunk_origin(&self, coord: ChunkCoord) -> Vec3 {
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

#[inline]
fn push_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

#[inline]
fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

#[inline]
fn push_i32(out: &mut Vec<u8>, value: i32) {
    out.extend_from_slice(&value.to_le_bytes());
}

#[inline]
fn push_f32(out: &mut Vec<u8>, value: f32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn hash_chunk(chunk: &Field3Chunk) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for bytes in [
        chunk.coord.x.to_le_bytes().as_slice(),
        chunk.coord.y.to_le_bytes().as_slice(),
        chunk.coord.z.to_le_bytes().as_slice(),
        &[chunk.size],
        &[chunk.halo],
    ] {
        for &byte in bytes {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    for value in &chunk.density_q16 {
        for byte in value.to_le_bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    for &byte in &chunk.material {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
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
