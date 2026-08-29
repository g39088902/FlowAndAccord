use serde::{Deserialize, Serialize};
use crate::spatial::vec3::Vec3;

pub type PoiId = u32;

/// 原始生存兴趣点类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PoiType {
    Camp,        // 🏕️ 避风营地 / 火塘 (恢复体力、储粮、生育抚育)
    WaterSource, // 💧 低洼清泉 / 水洼 (有限蓄水与涌出速率)
    BerryBush,   // 🍒 野果浆果丛 (有限果实存量与再生速率)
}

/// 原始地表有限资源地标
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimitivePoi {
    pub id: PoiId,
    pub poi_type: PoiType,
    pub pos: Vec3,
    pub current_stock: f32, // 当前可用资源存量
    pub max_stock: f32,     // 资源最大存储上限 (有限)
    pub regen_rate: f32,    // 资源有限产出/再生速率 (单位/秒)
}

impl PrimitivePoi {
    pub fn new(id: PoiId, poi_type: PoiType, pos: Vec3) -> Self {
        let (max_stock, regen_rate) = match poi_type {
            PoiType::Camp => (150.0, 0.0),       // 营地自身不产粮，靠采集带回
            PoiType::WaterSource => (60.0, 3.5), // 水坑上限 60.0，涌出速率 3.5/s
            PoiType::BerryBush => (25.0, 1.2),   // 灌木上限 25.0 颗，生长速率 1.2/s
        };
        Self {
            id,
            poi_type,
            pos,
            current_stock: max_stock * 0.75, // 初始 75% 存量
            max_stock,
            regen_rate,
        }
    }

    /// 资源自然有限再生
    pub fn tick_regenerate(&mut self, dt: f32) {
        if self.regen_rate > 0.0 {
            self.current_stock = (self.current_stock + self.regen_rate * dt).min(self.max_stock);
        }
    }

    /// 提取/采集资源 (受实际存量限制)
    pub fn extract(&mut self, desired_amount: f32) -> f32 {
        let actual = desired_amount.min(self.current_stock);
        self.current_stock -= actual;
        actual
    }

    /// 存放资源 (向营地存粮)
    pub fn deposit(&mut self, amount: f32) -> f32 {
        let space = (self.max_stock - self.current_stock).max(0.0);
        let actual = amount.min(space);
        self.current_stock += actual;
        actual
    }
}
