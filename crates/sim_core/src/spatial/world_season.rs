use super::snapshot::Season;
use super::world::World3DEngine;

/// 四季更迭与宏观环境温度演化 (正弦周期拟合)
///
/// 由 `world_tick.rs::tick()` 步骤 0 调用。季节判定以 `season_timer`
/// 对 `season_year_length` 取模后按四分之一年分箱；温度为 mid ± amplitude
/// 的正弦曲线，与季节相位对齐。
impl World3DEngine {
    pub fn tick_season(&mut self, dt: f32) {
        self.season_timer += dt;
        let year_length = self.config.season_year_length;
        let quarter_length = self.config.season_quarter_length();
        let season_time = self.season_timer % year_length;
        let season_idx = (((season_time + quarter_length * 0.5) / quarter_length) as usize) % 4;
        let prev_season = self.current_season;
        self.current_season = match season_idx {
            0 => Season::Spring,
            1 => Season::Summer,
            2 => Season::Autumn,
            _ => Season::Winter,
        };

        if self.current_season != prev_season {
            let (icon, name) = match self.current_season {
                Season::Spring => ("🌸", "春季 (大地回春，气候温和)"),
                Season::Summer => ("☀️", "夏季 (炎炎夏日，草木茂盛)"),
                Season::Autumn => ("🍂", "秋季 (秋风送爽，抓紧备柴过冬)"),
                Season::Winter => ("❄️", "冬季 (严寒降临，房屋消耗木头取暖)"),
            };
            self.last_event = Some(format!("{} 季节轮转: 步入 {}！", icon, name));
        }

        let angle = (season_time / year_length) * std::f32::consts::TAU;
        self.temperature = self.config.temp_base_mid + self.config.temp_amplitude * angle.sin();
    }
}
