use super::biome::{GeoCell, SurfaceKind, TERRAIN_FLAG_NO_BUILD, TERRAIN_FLAG_NO_WALK};
use crate::rng::WorldRng;
use crate::spatial::curve::Curve3D;
use crate::spatial::vec3::Vec3;
use serde::{Deserialize, Serialize};

/// T1 静态地貌特征。只描述几何，不携带资源、税收或行为语义。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TerrainFeatureKind {
    Ridge,
    Saddle,
    Terrace,
}

impl TerrainFeatureKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ridge => "Ridge",
            Self::Saddle => "Saddle",
            Self::Terrace => "Terrace",
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
pub const TERRAIN_GENERATOR_VERSION: u32 = 1;
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
        }
    }

    /// 兼容旧调用点；默认启用 T1 山口聚落 profile。
    pub fn generate_natural_landscape(&mut self, seed: u64) {
        self.generate_with_profile(seed, TERRAIN_PROFILE_MOUNTAIN_PASS);
    }

    /// 生成 T0 基础高程与 T1 山脊/山口/台地地貌。
    pub fn generate_with_profile(&mut self, seed: u64, profile: &str) {
        self.seed = seed;
        self.generator_version = TERRAIN_GENERATOR_VERSION;
        self.profile = if profile.is_empty() {
            TERRAIN_PROFILE_MOUNTAIN_PASS.to_string()
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
        let terrace_along = relief_rng.gen_range(-0.30, 0.05) * self.world_size;
        let terrace_across = relief_rng.gen_range(0.20, 0.32) * self.world_size;
        let terrace_a = self.world_size * 0.14;
        let terrace_b = self.world_size * 0.11;
        let terrace_center_wx = terrace_along * theta.cos() - (terrace_across + ridge_offset) * theta.sin();
        let terrace_center_wy = terrace_along * theta.sin() + (terrace_across + ridge_offset) * theta.cos();
        let center_proj = (terrace_center_wx * tilt_cos + terrace_center_wy * tilt_sin) / half_size.max(1.0);
        let center_base_tilt = center_proj * (self.tilt_magnitude * 0.5);
        let center_wave_large = ((terrace_center_wx * 0.006 + p1_x).sin() * (terrace_center_wy * 0.006 + p1_y).cos()) * 5.0;
        let center_wave_medium = ((terrace_center_wx * 0.014 + p2_x).cos() + (terrace_center_wy * 0.014 + p2_y).sin()) * 2.5;
        let center_ridge = ridge_amplitude * (-((terrace_across) / ridge_width.max(1.0)).powi(2)).exp();
        let center_saddle = (-((terrace_along - saddle_along) / saddle_width.max(1.0)).powi(2)).exp();
        let center_ambient = center_base_tilt + center_wave_large + center_wave_medium + center_ridge - center_ridge * 0.90 * center_saddle;
        let plateau_elev = center_ambient + 8.0;

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
                    let along = wx * theta.cos() + wy * theta.sin();
                    let across = -wx * theta.sin() + wy * theta.cos() - ridge_offset;
                    let ridge = ridge_amplitude * (-(across / ridge_width.max(1.0)).powi(2)).exp();
                    let saddle = (-((along - saddle_along) / saddle_width.max(1.0)).powi(2)).exp();
                    let ambient_elev = elev + ridge - ridge * 0.90 * saddle;

                    let du = (along - terrace_along) / terrace_a;
                    let dv = (across - terrace_across) / terrace_b;
                    let r_raw = (du * du + dv * dv).sqrt();
                    if r_raw < 1.25 {
                        let phi = dv.atan2(du);
                        let perturb = 1.0 + 0.08 * (3.0 * phi).sin() - 0.05 * (2.0 * phi).cos();
                        let r = r_raw / perturb;
                        if r < 1.0 {
                            // 核心平坦台面 (r <= 0.55): 100% 削平至 plateau_elev，坡度严格消除为 0°
                            // 台缘过渡陡坡 (0.55 < r < 1.0): smoothstep 平滑过渡回周围自然地貌
                            let w = if r <= 0.55 {
                                1.0
                            } else {
                                let t = (1.0 - r) / 0.45;
                                t * t * (3.0 - 2.0 * t)
                            };
                            elev = (1.0 - w) * ambient_elev + w * plateau_elev;
                        } else {
                            elev = ambient_elev;
                        }
                    } else {
                        elev = ambient_elev;
                    }
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
                let dx = if self.grid_width <= 1 { 0.0 } else { (right - left) / (2.0 * cell_step_x.max(0.001)) };
                let dy = if self.grid_height <= 1 { 0.0 } else { (down - up) / (2.0 * cell_step_y.max(0.001)) };
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
        self.build_t1_features(theta, ridge_offset, saddle_along, terrace_along, terrace_across, terrace_a, terrace_b);
    }

    fn build_t1_features(
        &mut self,
        theta: f32,
        ridge_offset: f32,
        saddle_along: f32,
        terrace_along: f32,
        terrace_across: f32,
        terrace_a: f32,
        terrace_b: f32,
    ) {
        let half = self.world_size / 2.0;
        let dir = Vec3::new(theta.cos(), theta.sin(), 0.0);
        let side = Vec3::new(-theta.sin(), theta.cos(), 0.0);
        let mut ridge_points = Vec::new();
        for i in 0..=8 {
            let along = -half * 0.82 + (i as f32 / 8.0) * self.world_size * 0.82;
            let p = scale_vec(dir, along);
            ridge_points.push(Vec3::new(p.x, p.y, self.sample_elevation(p.x, p.y)));
        }
        let saddle_pos = scale_vec(dir, saddle_along);
        let terrace_center = add_vec(scale_vec(dir, terrace_along), scale_vec(side, terrace_across + ridge_offset));
        let num_rim_points = 24;
        let mut terrace_points = Vec::with_capacity(num_rim_points);
        for i in 0..num_rim_points {
            let phi = i as f32 * std::f32::consts::TAU / num_rim_points as f32;
            let perturb = 1.0 + 0.08 * (3.0 * phi).sin() - 0.05 * (2.0 * phi).cos();
            let du = terrace_a * phi.cos() * perturb;
            let dv = terrace_b * phi.sin() * perturb;
            let p = add_vec(terrace_center, add_vec(scale_vec(dir, du), scale_vec(side, dv)));
            terrace_points.push(Vec3::new(p.x, p.y, self.sample_elevation(p.x, p.y)));
        }
        self.features.push(TerrainFeature { id: 1, kind: TerrainFeatureKind::Ridge, vertices: ridge_points, elevation: 0.0, width: self.world_size * 0.18, flags: 0 });
        self.features.push(TerrainFeature { id: 2, kind: TerrainFeatureKind::Saddle, vertices: vec![Vec3::new(saddle_pos.x, saddle_pos.y, self.sample_elevation(saddle_pos.x, saddle_pos.y))], elevation: self.sample_elevation(saddle_pos.x, saddle_pos.y), width: self.world_size * 0.12, flags: 0 });
        self.features.push(TerrainFeature { id: 3, kind: TerrainFeatureKind::Terrace, vertices: terrace_points, elevation: self.sample_elevation(terrace_center.x, terrace_center.y), width: terrace_a * 2.0, flags: 0 });
    }

    #[inline]
    pub fn sample_elevation(&self, wx: f32, wy: f32) -> f32 {
        self.sample_cell(wx, wy).elevation
    }

    #[inline]
    pub fn sample_cell(&self, wx: f32, wy: f32) -> &GeoCell {
        let (gx, gy) = self.grid_index(wx, wy);
        &self.cells[gy * self.grid_width + gx]
    }

    #[inline]
    pub fn grid_index(&self, wx: f32, wy: f32) -> (usize, usize) {
        let half_size = self.world_size / 2.0;
        let norm_x = ((wx + half_size) / self.world_size.max(0.001)).clamp(0.0, 0.999_999);
        let norm_y = ((wy + half_size) / self.world_size.max(0.001)).clamp(0.0, 0.999_999);
        let gx = (norm_x * self.grid_width as f32) as usize;
        let gy = (norm_y * self.grid_height as f32) as usize;
        (gx.min(self.grid_width - 1), gy.min(self.grid_height - 1))
    }

    /// 对整条三次贝塞尔曲线做自适应密度采样；用于 T0 路网合法性门禁。
    pub fn validate_curve(&self, curve: &Curve3D, corridor_width: f32, max_walk_slope: f32) -> bool {
        let step = (self.world_size / self.grid_width.max(1) as f32).max(0.5);
        let samples = ((curve.length / step).ceil() as usize * 2).clamp(16, 256);
        for i in 0..=samples {
            let t = i as f32 / samples as f32;
            let p = curve.evaluate_pos(t);
            let cell = self.sample_cell(p.x, p.y);
            if cell.surface_kind.is_hard_blocked() || cell.feature_flags & TERRAIN_FLAG_NO_WALK != 0 || cell.slope_angle_deg > max_walk_slope { return false; }
            if corridor_width > 0.0 {
                let tangent = curve.evaluate_tangent(t);
                    let normal = Vec3::new(-tangent.y, tangent.x, 0.0).normalize();
                for side in [-1.0f32, 1.0] {
                    let q = add_vec(p, scale_vec(normal, corridor_width * 0.5 * side));
                    let side_cell = self.sample_cell(q.x, q.y);
                    if side_cell.surface_kind.is_hard_blocked() || side_cell.feature_flags & TERRAIN_FLAG_NO_WALK != 0 || side_cell.slope_angle_deg > max_walk_slope { return false; }
                }
            }
        }
        true
    }
}

#[inline]
fn scale_vec(v: Vec3, scalar: f32) -> Vec3 {
    Vec3::new(v.x * scalar, v.y * scalar, v.z * scalar)
}

#[inline]
fn add_vec(a: Vec3, b: Vec3) -> Vec3 {
    Vec3::new(a.x + b.x, a.y + b.y, a.z + b.z)
}
