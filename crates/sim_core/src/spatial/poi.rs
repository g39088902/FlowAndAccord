use serde::{Deserialize, Serialize};
use super::vec3::Vec3;

pub type PoiId = u32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PoiType {
    Camp,        // 🏕️ 避风营地 (无限储量与无限庇护，休眠恢复体力、饱暖受孕与分娩)
    WaterSource, // 💧 低洼清泉 (产出水资源，单点上限40.0单位，1.00单位/秒)
    BerryBush,   // 🍒 缓坡浆果 (产出食物资源，单点上限40.0单位，1.00单位/秒)
}

/// 有限生态地标实体 (清泉/浆果最大储量 40.0 单位，产出速率 1.0 单位/秒；营地无限)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimitivePoi {
    pub id: PoiId,
    pub poi_type: PoiType,
    pub pos: Vec3,
    pub current_stock: f32, // 当前可用储量 (0.0 ~ 40.0 单位，营地为无限)
    pub max_stock: f32,     // 储量上限 (40.0 单位，营地为无限)
    pub regen_rate: f32,    // 每秒自然再生速率 (1.00 单位/秒)
}

impl PrimitivePoi {
    pub fn new(id: PoiId, poi_type: PoiType, pos: Vec3) -> Self {
        let (max_stock, regen_rate, initial_stock) = match poi_type {
            PoiType::Camp => (f32::INFINITY, 0.0, f32::INFINITY),
            PoiType::WaterSource => (40.0, 1.00, 30.0),
            PoiType::BerryBush => (40.0, 1.00, 30.0),
        };

        Self {
            id,
            poi_type,
            pos,
            current_stock: initial_stock,
            max_stock,
            regen_rate,
        }
    }

    /// 自然周期再生 Tick
    pub fn tick_regenerate(&mut self, dt: f32) {
        if self.regen_rate > 0.0 && self.current_stock.is_finite() {
            self.current_stock = (self.current_stock + self.regen_rate * dt).min(self.max_stock);
        }
    }

    /// 提取资源
    pub fn extract(&mut self, amount: f32) -> f32 {
        if !self.current_stock.is_finite() {
            return amount;
        }
        let available = self.current_stock.min(amount);
        self.current_stock -= available;
        available
    }
}
