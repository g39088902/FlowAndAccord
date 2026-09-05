use crate::config::SimConfig;
use super::poi::PoiType;
use super::world::World3DEngine;

/// 配置注入与反序列化
///
/// 前端 `rustworld.js::applyConfig` 将 `window.SIM_CONFIG` 序列化为 JSON
/// 后经 WASM 桥接调用 `apply_config_json`，反序列化为 `SimConfig` 并
/// 同步刷新所有现有 POI 的产速基准与储量上限。
impl World3DEngine {
    /// 从 JSON 字符串解析并应用动态仿真配置
    pub fn apply_config_json(&mut self, json_str: &str) -> Result<(), String> {
        let cfg: SimConfig = serde_json::from_str(json_str).map_err(|e| e.to_string())?;
        self.apply_config(cfg);
        Ok(())
    }

    /// 应用动态仿真配置
    pub fn apply_config(&mut self, config: SimConfig) {
        self.config = config;
        // 同步刷新所有现有 POI 的产速基准与储量上限（v1.33.1 修复 max_stock 动态更新遗漏）
        for poi in &mut self.pois {
            match poi.poi_type {
                PoiType::WaterSource => {
                    poi.regen_rate = self.config.regen_base_water;
                    poi.max_stock = self.config.stock_max_water;
                }
                PoiType::BerryBush => {
                    poi.regen_rate = self.config.regen_base_berry;
                    poi.max_stock = self.config.stock_max_berry;
                }
                PoiType::WoodForest => {
                    poi.regen_rate = self.config.regen_base_wood;
                    poi.max_stock = self.config.stock_max_wood;
                }
                PoiType::StoneQuarry => {
                    poi.regen_rate = self.config.regen_base_stone;
                    poi.max_stock = self.config.stock_max_stone;
                }
                PoiType::GoldMine => {
                    poi.regen_rate = self.config.regen_base_gold;
                    poi.max_stock = self.config.stock_max_gold;
                }
                PoiType::Market => {
                    poi.regen_rate = self.config.market_regen_base_water;
                    poi.max_stock = self.config.market_stock_max_water;
                    poi.secondary_regen_rate = self.config.market_regen_base_food;
                    poi.secondary_max_stock = self.config.market_stock_max_food;
                }
                _ => {}
            }
            if poi.max_stock.is_finite() && poi.current_stock > poi.max_stock {
                poi.current_stock = poi.max_stock;
            }
            if poi.secondary_max_stock.is_finite() && poi.secondary_stock > poi.secondary_max_stock {
                poi.secondary_stock = poi.secondary_max_stock;
            }
        }
    }

    /// 设置某类 POI 的自然再生倍率 (0=水泉, 1=浆果, 2=林木, 3=石矿, 4=金矿)
    pub fn set_regen_multiplier(&mut self, which: u8, mult: f32) {
        let mult = mult.max(0.0);
        match which {
            0 => self.water_regen_multiplier = mult,
            1 => self.berry_regen_multiplier = mult,
            2 => self.wood_regen_multiplier = mult,
            3 => self.stone_regen_multiplier = mult,
            4 => self.gold_regen_multiplier = mult,
            _ => {}
        }
    }
}
