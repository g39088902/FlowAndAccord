use crate::spatial::agent::{Gender, PrimitiveActionState};
use crate::spatial::house::HouseTier;
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// 施工计时与多级房屋升级推进、竣工仓储扩容与初次成婚激活
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

        // 升级竣工、扩容储量与激活生育/成婚
        for (owner_id, house_id) in upgraded_houses {
            if let Some(house) = self.houses.iter_mut().find(|h| h.id == house_id) {
                let prev_tier = house.tier;
                let success = house.upgrade_to_next_tier(&self.config);
                if success {
                    let door_node = house.door_node_id;

                    if prev_tier == HouseTier::Tier0Warehouse {
                        let single_female_id = self.agents.iter()
                            .find(|a| a.is_alive && a.gender == Gender::Female && a.age >= self.config.agent_adult_age && a.spouse_id.is_none() && !a.is_pregnant)
                            .map(|a| a.id);

                        if let Some(female_id) = single_female_id {
                            if let Some(husband) = self.agents.iter_mut().find(|a| a.id == owner_id) {
                                husband.spouse_id = Some(female_id);
                            }
                            if let Some(wife) = self.agents.iter_mut().find(|a| a.id == female_id) {
                                wife.spouse_id = Some(owner_id);
                                wife.home_house_id = Some(house_id);
                                wife.home_camp_node = door_node;
                            }
                            house.spouse_id = Some(female_id);
                            self.last_event = Some(format!("🎉 0级仓库满水粮并升级为 1级茅草房！迎娶女性 #{} ♀ 结为夫妻，激活生育！", female_id));
                        } else {
                            self.last_event = Some(format!("🎉 0级仓库升级为 1级茅草房！正式激活生育功能，仓储扩容至 40 单位！"));
                        }
                    } else if prev_tier == HouseTier::Tier1ThatchedHut {
                        self.last_event = Some(format!("🏡 1级茅草房消耗木材完成升级！第 #{} 号房屋晋升为 2级私宅，仓储扩容至 80 单位！", house_id));
                    } else if prev_tier == HouseTier::Tier2LeanTo {
                        self.last_event = Some(format!("🏛️ 2级私宅消耗石料完成升级！第 #{} 号房屋晋升为 3级木石庄舍，仓储扩容至 120 单位！", house_id));
                    } else {
                        self.last_event = Some(format!("🏰 终极大庄园竣工！第 #{} 号房屋晋升为 4级氏族大庄园，仓储扩容至 160 单位！", house_id));
                    }
                }
            }
        }
    }

    /// 检查房屋是否已备齐升级材料，若备齐且有成年男性主人在家休息，自动启动施工
    pub(crate) fn check_start_house_upgrades(&mut self) {
        for house in &mut self.houses {
            if house.is_pantry_full(&self.config) && house.tier != HouseTier::Tier4Manor {
                if let Some(owner) = self.agents.iter_mut().find(|a| a.id == house.owner_id && a.is_alive && a.gender == Gender::Male && a.age >= self.config.agent_adult_age && a.state == PrimitiveActionState::RestingAtCamp && a.stamina >= 100.0) {
                    owner.state = PrimitiveActionState::ConstructingHouse;
                    owner.build_timer = 0.0;
                    owner.current_need = Some(if house.tier == HouseTier::Tier0Warehouse {
                        "Belonging·BuildHouse".to_string()
                    } else {
                        "Esteem·BuildHouse".to_string()
                    });
                }
            }
        }
    }
}
