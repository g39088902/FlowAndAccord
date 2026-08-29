use crate::rng::WorldRng;
use serde::{Deserialize, Serialize};
use super::biome::GeoCell;

/// 纯粹自然地形生成引擎 (全局随机倾斜大势 ±30m + 连续随机起伏)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainMap {
    pub grid_width: usize,              // 网格宽度 (如 60)
    pub grid_height: usize,             // 网格高度 (如 60)
    pub world_size: f32,                // 世界物理跨度 (米, 如 764m)
    pub cells: Vec<GeoCell>,            // 空间高程栅格
    pub tilt_angle_rad: f32,            // 全局倾斜方向 (弧度)
    pub tilt_magnitude: f32,            // 全局倾斜高差幅度 (米, 约 60m 即 ±30m)
    pub seed: u64,
}

impl TerrainMap {
    pub fn new(grid_width: usize, grid_height: usize, world_size: f32) -> Self {
        let count = grid_width * grid_height;
        let default_cell = GeoCell {
            elevation: 0.0,
            slope_angle_deg: 0.0,
        };
        Self {
            grid_width,
            grid_height,
            world_size,
            cells: vec![default_cell; count],
            tilt_angle_rad: 0.0,
            tilt_magnitude: 60.0, // 默认 ±30m 倾斜落差
            seed: 0,
        }
    }

    /// 生成全局大势倾斜 (±30m) 与随机平滑起伏
    pub fn generate_natural_landscape(&mut self, seed: u64) {
        self.seed = seed;
        let mut rng = WorldRng::new(seed);
        let half_size = self.world_size / 2.0;

        // 1. 随机确定地图全局高低大势方向与倾斜幅度 (基准 ±30m)
        self.tilt_angle_rad = rng.gen_range(0.0, std::f32::consts::TAU);
        self.tilt_magnitude = rng.gen_range(54.0, 66.0); // 总倾斜落差约 60米 (即 ±27m ~ ±33m)
        let tilt_cos = self.tilt_angle_rad.cos();
        let tilt_sin = self.tilt_angle_rad.sin();

        // 2. 随机起伏多尺度谐波相位与频率
        let p1_x: f32 = rng.gen_range(0.0, 100.0);
        let p1_y: f32 = rng.gen_range(0.0, 100.0);
        let p2_x: f32 = rng.gen_range(0.0, 100.0);
        let p2_y: f32 = rng.gen_range(0.0, 100.0);

        let cell_step = self.world_size / (self.grid_width - 1) as f32;
        let mut raw_elevations = vec![0.0f32; self.grid_width * self.grid_height];

        // 阶段一：计算每个网格点的高程 = 全局倾斜斜面 (±30m) + 局部连续平滑起伏
        for gy in 0..self.grid_height {
            for gx in 0..self.grid_width {
                let wx = (gx as f32 / (self.grid_width - 1) as f32) * self.world_size - half_size;
                let wy = (gy as f32 / (self.grid_height - 1) as f32) * self.world_size - half_size;

                // ① 全局线性倾斜大势 (范围约 -30m ~ +30m)
                let proj = (wx * tilt_cos + wy * tilt_sin) / half_size; // [-1.0, 1.0]
                let base_tilt = proj * (self.tilt_magnitude * 0.5);

                // ② 多尺度平滑起伏波浪 (大尺度缓坡 + 中尺度微起伏)
                let wave_large = ((wx * 0.006 + p1_x).sin() * (wy * 0.006 + p1_y).cos()) * 5.0;
                let wave_medium = ((wx * 0.014 + p2_x).cos() + (wy * 0.014 + p2_y).sin()) * 2.5;

                let elev = base_tilt + wave_large + wave_medium;
                raw_elevations[gy * self.grid_width + gx] = elev;
            }
        }

        // 阶段二：计算坡度角
        for gy in 0..self.grid_height {
            for gx in 0..self.grid_width {
                let idx = gy * self.grid_width + gx;
                let elev = raw_elevations[idx];

                let dz_dx = if gx > 0 && gx < self.grid_width - 1 {
                    (raw_elevations[gy * self.grid_width + gx + 1] - raw_elevations[gy * self.grid_width + gx - 1]) / (2.0 * cell_step)
                } else { 0.0 };
                let dz_dy = if gy > 0 && gy < self.grid_height - 1 {
                    (raw_elevations[(gy + 1) * self.grid_width + gx] - raw_elevations[(gy - 1) * self.grid_width + gx]) / (2.0 * cell_step)
                } else { 0.0 };
                let slope_deg = (dz_dx * dz_dx + dz_dy * dz_dy).sqrt().atan().to_degrees();

                self.cells[idx] = GeoCell {
                    elevation: elev,
                    slope_angle_deg: slope_deg,
                };
            }
        }
    }

    /// 采样任意 3D 世界坐标 (x, y) 的地表高程
    pub fn sample_elevation(&self, wx: f32, wy: f32) -> f32 {
        let half_size = self.world_size / 2.0;
        let norm_x = ((wx + half_size) / self.world_size).clamp(0.0, 0.999);
        let norm_y = ((wy + half_size) / self.world_size).clamp(0.0, 0.999);

        let gx = (norm_x * self.grid_width as f32) as usize;
        let gy = (norm_y * self.grid_height as f32) as usize;
        let idx = gy * self.grid_width + gx;

        self.cells[idx].elevation
    }
}
