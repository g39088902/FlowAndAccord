//! 地表水体与坡度的静态数据结构。水量由 World 的共享池维护，几何不随库存变化。
//!
//! 地图已不再生成任何程序生成水面（河流/支流/静湖均已删除），本模块只保留
//! `WaterBody` / `WaterAccessPoint` / `WaterPool` / `Hydrology` / `TerrainConnection`
//! 这些仍被生存水源、快照与存档消费的数据结构，以及坡度差分助手。
use super::terrain::TerrainMap;
use crate::spatial::vec3::Vec3;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Hydrology {
    pub water_bodies: Vec<WaterBody>,
    pub access_points: Vec<WaterAccessPoint>,
    pub connections: Vec<TerrainConnection>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaterBody {
    pub id: u32,
    pub level: f32,
    pub flow_direction: Vec3,
    pub resource_pool_id: u32,
    pub vertices: Vec<Vec3>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaterAccessPoint {
    pub id: u32,
    pub water_body_id: u32,
    pub resource_pool_id: u32,
    pub pos: Vec3,
    pub nearest_node_id: Option<u32>,
    pub interaction_radius: f32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainConnection {
    pub id: u32,
    pub start: Vec3,
    pub end: Vec3,
    pub width: f32,
    pub node_a: Option<u32>,
    pub node_b: Option<u32>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaterPool {
    pub id: u32,
    pub current_stock: f32,
    pub max_stock: f32,
    pub regen_rate: f32,
    pub source_poi_ids: Vec<u32>,
}
impl WaterPool {
    pub fn extract(&mut self, amount: f32) -> f32 {
        let taken = amount.max(0.0).min(self.current_stock);
        self.current_stock -= taken;
        taken
    }
}

impl TerrainMap {
    /// 对有效格索引读取当前高程的四邻域差分，不读缓存坡度、不修改地表。
    /// 子特征局部试算与全图定稿必须共用此判据，保留既有运算次序与
    /// 步长口径（生产为方形网格，两轴沿用 grid_width），边缘使用单侧差分。
    #[inline]
    pub(crate) fn slope_from_elevation(&self, x: usize, y: usize) -> f32 {
        let step = self.world_size / (self.grid_width - 1).max(1) as f32;
        let (l, r, u, d) = (
            x.saturating_sub(1),
            (x + 1).min(self.grid_width - 1),
            y.saturating_sub(1),
            (y + 1).min(self.grid_height - 1),
        );
        let dx = (self.cells[y * self.grid_width + r].elevation
            - self.cells[y * self.grid_width + l].elevation)
            / ((r - l).max(1) as f32 * step);
        let dy = (self.cells[d * self.grid_width + x].elevation
            - self.cells[u * self.grid_width + x].elevation)
            / ((d - u).max(1) as f32 * step);
        (dx * dx + dy * dy).sqrt().atan().to_degrees()
    }

    pub fn recompute_slopes(&mut self) {
        for y in 0..self.grid_height {
            for x in 0..self.grid_width {
                // 此循环只写 slope，不写 elevation，无需复制全图高程。
                let slope = self.slope_from_elevation(x, y);
                self.cells[y * self.grid_width + x].slope_angle_deg = slope;
            }
        }
    }
}