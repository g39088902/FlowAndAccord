use super::biome::{GeoCell, SurfaceKind, TERRAIN_FLAG_NO_BUILD, TERRAIN_FLAG_NO_WALK};
use super::accents::TerrainAccent;
use crate::config::SimConfig;
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

/// 地图模板子特征种类（06 号 §5.2 数据模型，D-B1-2 新增）。
/// 编号即 `TerrainSubFeatureKind as u32`，是稳定 ID 分区
/// `1000 + kind` 的组成部分；与 `TerrainFeatureKind`（0–6）是**两套编号空间**，
/// 混用会直接算错 ID。本阶段仅落地模型，容器恒为空数组，注入自阶段二起。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TerrainSubFeatureKind {
    FootLake = 0,
    RidgeWaterfall = 1,
    ForestedSlope = 2,
    RockyOutcrop = 3,
    OxbowLake = 4,
    RiverCliff = 5,
    RiversideForest = 6,
    GravelBeach = 7,
}

impl TerrainSubFeatureKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::FootLake => "FootLake",
            Self::RidgeWaterfall => "RidgeWaterfall",
            Self::ForestedSlope => "ForestedSlope",
            Self::RockyOutcrop => "RockyOutcrop",
            Self::OxbowLake => "OxbowLake",
            Self::RiverCliff => "RiverCliff",
            Self::RiversideForest => "RiversideForest",
            Self::GravelBeach => "GravelBeach",
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

/// 已注入的子特征（06 号 §5.2 数据模型，D-B1-2 新增）。
/// 只描述「这张图注入了什么」，是快照/调试/存档的稳定事实源，不携带生成过程。
/// 稳定 ID = `1000 + TerrainSubFeatureKind as u32`，一种最多一个实例。
/// 本阶段容器恒为空数组（`#[serde(default)]` 保证旧档加载默认空，`SAVE_FORMAT_VERSION`
/// 不递增）；阶段二注入器填充后必须保持按 `id` 升序且唯一（见
/// `TerrainMap::validate_sub_features_sorted_unique`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainSubFeature {
    pub id: u32,
    pub kind: TerrainSubFeatureKind,
    /// 生成锚点，z 为最终地表高程
    pub anchor: Vec3,
    /// 世界坐标 AABB，仅用于调试/检查
    pub bounds_min: Vec3,
    pub bounds_max: Vec3,
    /// 关联 `TerrainFeature` 的稳定 ID，升序
    pub feature_ids: Vec<u32>,
    /// 关联装饰 ID 闭区间 [start, end]；无装饰则为 None
    pub accent_id_start: Option<u32>,
    pub accent_id_end: Option<u32>,
}

/// 地形生成器版本。改变高程/地表/特征生成算法时必须递增。
/// v1.47.7：2 -> 3（删除 T1 台地压平与 Ridge/Saddle/Terrace 特征生成）
/// v1.50.17：3 -> 4（T1-R 主脊通行力修复：主脊宽度/幅度改走配置并加陡，鞍部加宽；
///           同时移除 `generate_with_profile` 无配置的兼容入口，旧存档按版本门禁拒绝）
pub const TERRAIN_GENERATOR_VERSION: u32 = 4;
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
    /// 已注入的子特征（§5.2）。D-B1-2 起为数据模型空容器，阶段二起由注入器填充。
    /// `#[serde(default)]`：旧档缺字段时默认空数组，`SAVE_FORMAT_VERSION` 不递增。
    #[serde(default)]
    pub sub_features: Vec<TerrainSubFeature>,
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
            sub_features: Vec::new(),
            hydrology: Default::default(),
        }
    }

    /// 生成 T0 基础高程与 T1 山脊/山口连续起伏地貌（v1.47.7 起不再生成台地/高台）。
    ///
    /// ★ T1-R 主脊通行力修复：主脊宽度/幅度改为消费 `SimConfig`（原先硬编码
    /// `0.16~0.23 × world_size` 与 `24~34m`，最大梯度仅 6.7~13.4°，全图无格越过
    /// `terrain_max_walk_slope`，山口不产生任何通行约束）。详见
    /// `docs/plan/tech/06-terrain-templates.md` §9.3.1。
    pub fn generate_with_profile(&mut self, seed: u64, profile: &str, config: &SimConfig) {
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
        self.sub_features.clear();

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
        // ★ T1-R：主脊宽度/幅度走配置（禁止散落字面量）。通行力约束：
        //   高斯主脊最大梯度 ≈ 0.858 × amplitude / width，必须显著大于
        //   tan(terrain_max_walk_slope)，否则主脊上任何路线都合法、山口形同虚设。
        let ridge_width = config.terrain_pass_ridge_width.max(8.0);
        let ridge_amplitude = config.terrain_pass_ridge_amplitude.max(4.0);
        let saddle_along = relief_rng.gen_range(-0.12, 0.12) * self.world_size;
        // 鞍部过渡带的沿脊梯度 ≈ 0.9 × amplitude × 0.858 / saddle_width；主脊变陡后
        // 鞍部若过窄会把山口本身夹成不可通行，故下限从 0.10 放宽到 0.14。
        let saddle_width = relief_rng.gen_range(0.14, 0.19) * self.world_size;

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

    /// §5.2 稳定 ID 契约：`sub_features` 必须按 `id` **严格升序**且 **ID 唯一**
    /// （稳定 ID 禁止用 `Vec::len()` / HashMap 遍历顺序 / 候选失败次数推导）。
    /// 本阶段容器恒为空数组，校验平凡通过；阶段二注入器每次写入后、
    /// 以及存档加载路径都必须调用，防止同种子因集合顺序漂移而换图。
    pub fn validate_sub_features_sorted_unique(&self) -> Result<(), String> {
        let mut prev: Option<u32> = None;
        for sf in &self.sub_features {
            if let Some(p) = prev {
                if sf.id <= p {
                    return Err(format!(
                        "sub_features 未按 id 严格升序存储或 ID 重复：id={}，前一个 id={}",
                        sf.id, p
                    ));
                }
            }
            prev = Some(sf.id);
        }
        Ok(())
    }
}
