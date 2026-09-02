use crate::config::SimConfig;
use super::poi::PoiType;
use super::world::World3DEngine;

/// 配置注入与反序列化
///
/// 前端 `rustworld.js::applyConfig` 将 `window.SIM_CONFIG` 序列化为 JSON
/// 后经 WASM 桥接调用 `apply_config_json`，反序列化为 `SimConfig` 并
/// 同步刷新所有现有 POI 的产速基准。
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
        // 同步刷新所有现有 POI 的产速基准
        for poi in &mut self.pois {
            let base_regen = match poi.poi_type {
                PoiType::WaterSource => self.config.regen_base_water,
                PoiType::BerryBush => self.config.regen_base_berry,
                PoiType::WoodForest => self.config.regen_base_wood,
                PoiType::StoneQuarry => self.config.regen_base_stone,
                PoiType::GoldMine => self.config.regen_base_gold,
                _ => poi.regen_rate,
            };
            poi.regen_rate = base_regen;
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
