use crate::spatial::agent::PrimitiveActionState;
use crate::spatial::house::HouseTier;
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// 施工计时与多级房屋升级推进、竣工仓储扩容与生育激活 (成婚由 marriage.rs 持续扫描自动匹配)
    pub(crate) fn tick_house_construction(&mut self, dt: f32) {
        let mut upgraded_houses = Vec::new();
        for agent in &mut self.agents {
            if !agent.is_alive {
                continue;
            }

            if agent.state == PrimitiveActionState::ConstructingHouse {
                agent.build_timer += dt;
                let required_time = match agent.home_house_id.and_then(|hid| self.houses.iter().find(|h| h.id == hid)).map(|h| h.tier) {
                    Some(HouseTier::Tier0Warehouse) => self.config.house_build_time_tier0_to_1,
                    Some(HouseTier::Tier1ThatchedHut) => self.config.house_build_time_tier1_to_2,
                    Some(HouseTier::Tier2LeanTo) => self.config.house_build_time_tier2_to_3,
                    Some(HouseTier::Tier3Homestead) => self.config.house_build_time_tier3_to_4,
                    _ => self.config.house_build_time_tier0_to_1,
                };
                if agent.build_timer >= required_time {
                    agent.build_timer = 0.0;
                    agent.state = PrimitiveActionState::RestingAtCamp;
                    agent.current_need = Some("Physiological·Rest".to_string());
                    if let Some(hid) = agent.home_house_id {
                        upgraded_houses.push((agent.id, hid));
                    }
                }
            }
        }

        // 升级竣工、扩容储量与激活生育 (成婚由 marriage.rs 每 tick 持续扫描自动匹配，不在此事件钩子中处理)
        for (_, house_id) in upgraded_houses {
            if let Some(house) = self.houses.iter_mut().find(|h| h.id == house_id) {
                let prev_tier = house.tier;
                let success = house.upgrade_to_next_tier(&self.config);
                if success {
                    if prev_tier == HouseTier::Tier0Warehouse {
                        self.last_event = Some(format!("🎉 0级仓库升级为 1级茅草房！正式激活生育功能，仓储扩容至 40 单位！"));
                    } else if prev_tier == HouseTier::Tier1ThatchedHut {
                        self.last_event = Some(format!("🏡 1级茅草房消耗木材完成升级！第 #{} 号房屋晋升为 2级私宅，仓储扩容至 80 单位！", house_id));
                    } else if prev_tier == HouseTier::Tier2LeanTo {
                        self.last_event = Some(format!("🏯 2级私宅消耗石料完成升级！第 #{} 号房屋晋升为 3级木石庄舍，仓储扩容至 120 单位！", house_id));
                    } else {
                        self.last_event = Some(format!("🏰 终极大庄园竣工！第 #{} 号房屋晋升为 4级氏族大庄园，仓储扩容至 160 单位！", house_id));
                    }
                }
            }
        }
    }

}
