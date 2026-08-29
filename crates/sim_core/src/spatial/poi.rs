use serde::{Deserialize, Serialize};
use crate::spatial::vec3::Vec3;

pub type PoiId = u32;

/// 原始生存兴趣点类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PoiType {
    Camp,        // 🏕️ 避风营地 / 火塘 (恢复体力、存粮、避难)
    WaterSource, // 💧 低洼水坑 / 清泉 (解渴)
    BerryBush,   // 🍒 野果浆果丛 (采摘食物)
}

/// 原始地表资源地标
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimitivePoi {
    pub id: PoiId,
    pub poi_type: PoiType,
    pub pos: Vec3,
    pub resource_amount: f32, // 剩余资源量 (如野果数量/蓄水量)
    pub max_capacity: f32,
}

impl PrimitivePoi {
    pub fn new(id: PoiId, poi_type: PoiType, pos: Vec3) -> Self {
        let max_capacity = match poi_type {
            PoiType::Camp => 100.0,
            PoiType::WaterSource => 500.0,
            PoiType::BerryBush => 50.0,
        };
        Self {
            id,
            poi_type,
            pos,
            resource_amount: max_capacity,
            max_capacity,
        }
    }

    /// 资源随时间缓慢自然再生
    pub fn tick_regenerate(&mut self, dt: f32) {
        match self.poi_type {
            PoiType::BerryBush => {
                self.resource_amount = (self.resource_amount + 0.5 * dt).min(self.max_capacity);
            }
            PoiType::WaterSource => {
                self.resource_amount = (self.resource_amount + 2.0 * dt).min(self.max_capacity);
            }
            PoiType::Camp => {}
        }
    }
}
