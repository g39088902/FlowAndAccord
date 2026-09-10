use super::biome::{GeoCell, SurfaceKind, TERRAIN_FLAG_NO_BUILD, TERRAIN_FLAG_NO_WALK};
use super::accents::TerrainAccent;
use crate::rng::WorldRng;
use crate::spatial::curve::Curve3D;
use crate::spatial::vec3::Vec3;
use serde::{Deserialize, Serialize};

/// 静态地貌特征。只描述几何，不携带资源、税收或行为语义。
/// v1.47.7：删除 T1 的 Ridge/Saddle/Terrace 三特征（含台地压平），仅保留水系地貌特征。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TerrainFeatureKind {
    River,
    RiverBank,
    ShallowFord,
    SpringValley,
}

impl TerrainFeatureKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::River => "River",
            Self::RiverBank => "RiverBank",
            Self::ShallowFord => "ShallowFord",
            Self::SpringValley => "SpringValley",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainFeature {
    pub id: u32,
    pub kind: TerrainFeatureKind,
    pub vertices: Vec<Vec3>,
    pub elevation: f32,
    pub width: f32,
    pub flags: u16,
}

/// 地形生成器版本。改变高程/地表/特征生成算法时必须递增。
/// v1.47.7：2 -> 3（删除 T1 台地压平与 Ridge/Saddle/Terrace 特征生成）
pub const TERRAIN_GENERATOR_VERSION: u32 = 3;
pub const TERRAIN_PROFILE_RANDOM: &str = "random";
pub const TERRAIN_PROFILE_RIVER_VALLEY: &str = "river_valley_v1";
pub const TERRAIN_PROFILE_MOUNTAIN_PASS: &str = "mountain_pass_v1";

/// 纯确定性自然地形生成引擎。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainMap {
    pub grid_width: usize,
    pub grid_height: usize,
    pub world_size: f32,
    pub cells: Vec<GeoCell>,
    pub tilt_angle_rad: f32,
    pub tilt_magnitude: f32,
    pub seed: u64,
    #[serde(default)]
    pub generator_version: u32,
    #[serde(default)]
    pub profile: String,
    #[serde(default)]
    pub features: Vec<TerrainFeature>,
    #[serde(default)]
    pub accents: Vec<TerrainAccent>,
    pub hydrology: super::hydrology::Hydrology,
}

impl TerrainMap {
    pub fn new(grid_width: usize, grid_height: usize, world_size: f32) -> Self {
        let width = grid_width.max(1);
        let height = grid_height.max(1);
        let default_cell = GeoCell {
            elevation: 0.0,
            slope_angle_deg: 0.0,
            surface_kind: SurfaceKind::DryGround,
            natural_fertility: 1.0,
            water_body_id: None,
            feature_flags: 0,
        };
        Self {
            grid_width: width,
            grid_height: height,
            world_size,
            cells: vec![default_cell; width * height],
            tilt_angle_rad: 0.0,
            tilt_magnitude: 60.0,
            seed: 0,
            generator_version: TERRAIN_GENERATOR_VERSION,
            profile: TERRAIN_PROFILE_MOUNTAIN_PASS.to_string(),
            features: Vec::new(),
            accents: Vec::new(),
            hydrology: Default::default(),
        }
    }

    /// 兼容旧调用点；默认启用 T1 山口聚落 profile。
    pub fn generate_natural_landscape(&mut self, seed: u64) {
        self.generate_with_profile(seed, TERRAIN_PROFILE_MOUNTAIN_PASS);
    }

    /// 生成 T0 基础高程与 T1 山脊/山口连续起伏地貌（v1.47.7 起不再生成台地/高台）。
    pub fn generate_with_profile(&mut self, seed: u64, profile: &str) {
        self.seed = seed;
        self.generator_version = TERRAIN_GENERATOR_VERSION;
        self.profile = if profile.is_empty() || profile == TERRAIN_PROFILE_RANDOM {
            if (seed ^ 0x5052_4F46_494C_4531) % 2 == 0 {
                TERRAIN_PROFILE_MOUNTAIN_PASS.to_string()
            } else {
                TERRAIN_PROFILE_RIVER_VALLEY.to_string()
            }
        } else {
            profile.to_string()
        };
        self.features.clear();

        let mut rng = WorldRng::new(seed);
        let mut relief_rng = WorldRng::new(seed ^ 0x5245_4c49_4546_5431);
        let half_size = self.world_size / 2.0;
        self.tilt_angle_rad = rng.gen_range(0.0, std::f32::consts::TAU);
        self.tilt_magnitude = rng.gen_range(54.0, 66.0);
        let tilt_cos = self.tilt_angle_rad.cos();
        let tilt_sin = self.tilt_angle_rad.sin();
        let p1_x: f32 = rng.gen_range(0.0, 100.0);
        let p1_y: f32 = rng.gen_range(0.0, 100.0);
        let p2_x: f32 = rng.gen_range(0.0, 100.0);
        let p2_y: f32 = rng.gen_range(0.0, 100.0);
        let theta = relief_rng.gen_range(-0.18, 0.18);
        let ridge_offset = relief_rng.gen_range(-0.08, 0.08) * self.world_size;
        let ridge_width = relief_rng.gen_range(0.16, 0.23) * self.world_size;
        let ridge_amplitude = relief_rng.gen_range(24.0, 34.0);
        let saddle_along = relief_rng.gen_range(-0.12, 0.12) * self.world_size;
        let saddle_width = relief_rng.gen_range(0.10, 0.15) * self.world_size;

        let cell_step_x = self.world_size / self.grid_width.saturating_sub(1).max(1) as f32;
        let cell_step_y = self.world_size / self.grid_height.saturating_sub(1).max(1) as f32;
        let mut raw = vec![0.0f32; self.grid_width * self.grid_height];

        for gy in 0..self.grid_height {
            for gx in 0..self.grid_width {
                let wx = if self.grid_width <= 1 {
                    0.0
                } else {
                    (gx as f32 / (self.grid_width - 1) as f32) * self.world_size - half_size
                };
                let wy = if self.grid_height <= 1 {
                    0.0
                } else {
                    (gy as f32 / (self.grid_height - 1) as f32) * self.world_size - half_size
                };
                let proj = (wx * tilt_cos + wy * tilt_sin) / half_size.max(1.0);
                let base_tilt = proj * (self.tilt_magnitude * 0.5);
                let wave_large = ((wx * 0.006 + p1_x).sin() * (wy * 0.006 + p1_y).cos()) * 5.0;
                let wave_medium = ((wx * 0.014 + p2_x).cos() + (wy * 0.014 + p2_y).sin()) * 2.5;
                let mut elev = base_tilt + wave_large + wave_medium;

                if self.profile == TERRAIN_PROFILE_MOUNTAIN_PASS {
                    // v1.47.7：删除平顶高台（台地压平）。只保留主脊与山口鞍部的连续起伏地貌。
                    let along = wx * theta.cos() + wy * theta.sin();
                    let across = -wx * theta.sin() + wy * theta.cos() - ridge_offset;
                    let ridge = ridge_amplitude * (-(across / ridge_width.max(1.0)).powi(2)).exp();
                    let saddle = (-((along - saddle_along) / saddle_width.max(1.0)).powi(2)).exp();
                    elev = elev + ridge - ridge * 0.90 * saddle;
                }
                raw[gy * self.grid_width + gx] = elev;
            }
        }

        for gy in 0..self.grid_height {
            for gx in 0..self.grid_width {
                let idx = gy * self.grid_width + gx;
                let left = raw[gy * self.grid_width + gx.saturating_sub(1)];
                let right = raw[gy * self.grid_width + (gx + 1).min(self.grid_width - 1)];
                let up = raw[gy.saturating_sub(1) * self.grid_width + gx];
                let down = raw[(gy + 1).min(self.grid_height - 1) * self.grid_width + gx];
                let dx = if self.grid_width <= 1 { 0.0 } else { (right - left) / (((gx + 1).min(self.grid_width - 1) - gx.saturating_sub(1)) as f32 * cell_step_x.max(0.001)) };
                let dy = if self.grid_height <= 1 { 0.0 } else { (down - up) / (((gy + 1).min(self.grid_height - 1) - gy.saturating_sub(1)) as f32 * cell_step_y.max(0.001)) };
                let slope = (dx * dx + dy * dy).sqrt().atan().to_degrees();
                let normalized_height = ((raw[idx] + 45.0) / 100.0).clamp(0.0, 1.0);
                let fertility = (0.92 - slope / 70.0 - normalized_height * 0.18).clamp(0.1, 1.0);
                let surface_kind = if slope >= 34.0 { SurfaceKind::RockFace } else if slope >= 20.0 { SurfaceKind::SoftGround } else { SurfaceKind::DryGround };
                let mut flags = 0u16;
                if slope >= 18.0 { flags |= TERRAIN_FLAG_NO_BUILD; }
                if surface_kind.is_hard_blocked() { flags |= TERRAIN_FLAG_NO_WALK; }
                self.cells[idx] = GeoCell {
                    elevation: raw[idx],
                    slope_angle_deg: slope,
                    surface_kind,
                    natural_fertility: fertility,
                    water_body_id: None,
                    feature_flags: flags,
                };
            }
        }
    }

    #[inline]
    pub fn sample_elevation(&self, wx: f32, wy: f32) -> f32 {
        let (x, y) = self.grid_coords(wx, wy);
        let (ix, iy) = (x.floor() as usize, y.floor() as usize);
        let (jx, jy) = ((ix + 1).min(self.grid_width - 1), (iy + 1).min(self.grid_height - 1));
        let (u, v) = (x - ix as f32, y - iy as f32);
        let a = self.cells[iy * self.grid_width + ix].elevation * (1.0-u) + self.cells[iy * self.grid_width+jx].elevation*u;
        let b = self.cells[jy * self.grid_width + ix].elevation * (1.0-u) + self.cells[jy * self.grid_width+jx].elevation*u;
        a*(1.0-v)+b*v
    }

    #[inline]
    pub fn sample_cell(&self, wx: f32, wy: f32) -> &GeoCell {
        let (gx, gy) = self.grid_index(wx, wy);
        &self.cells[gy * self.grid_width + gx]
    }

    #[inline]
    pub fn grid_index(&self, wx: f32, wy: f32) -> (usize, usize) {
        let (x,y) = self.grid_coords(wx, wy);
        (x.round() as usize, y.round() as usize)
    }

    pub fn grid_coords(&self, x: f32, y: f32) -> (f32, f32) {
        (((x/self.world_size+0.5)*(self.grid_width-1) as f32).clamp(0.0,(self.grid_width-1) as f32),
         ((y/self.world_size+0.5)*(self.grid_height-1) as f32).clamp(0.0,(self.grid_height-1) as f32))
    }
    pub fn grid_pos(&self, x: usize, y: usize) -> Vec3 {
        Vec3::new((x as f32/(self.grid_width-1).max(1) as f32-0.5)*self.world_size,
                  (y as f32/(self.grid_height-1).max(1) as f32-0.5)*self.world_size,
                  self.cells[y*self.grid_width+x].elevation)
    }

    /// 对整条三次贝塞尔曲线做自适应密度采样；用于 T0 路网合法性门禁。
    pub fn validate_curve(&self, curve: &Curve3D, corridor_width: f32, max_walk_slope: f32) -> bool {
        super::corridor::validate_curve(self, curve, corridor_width, max_walk_slope, None)
    }

}
