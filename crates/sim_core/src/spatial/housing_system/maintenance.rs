use crate::spatial::agent::PrimitiveActionState;
use crate::spatial::graph::NodeId;
use crate::spatial::house::HouseTier;
use crate::spatial::snapshot::Season;
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// 冬季取暖消耗：低温或冬季时房屋消耗木材取暖
    pub(crate) fn tick_winter_heating(&mut self, dt: f32) {
        if self.current_season == Season::Winter || self.temperature < self.config.house_winter_cold_temp {
            let wood_burn_rate = self.config.house_winter_wood_burn_rate * dt;
            for house in &mut self.houses {
                if !house.is_ruin && house.tier != HouseTier::Tier0Warehouse {
                    house.pantry_wood = (house.pantry_wood - wood_burn_rate).max(0.0);
                }
            }
        }
    }

    /// 房屋自然风化与折旧，0耐久度彻底坍塌消亡
    pub(crate) fn tick_house_depreciation_and_collapse(&mut self, dt: f32) {
        let mut collapsed_house_ids = Vec::new();
        for house in &mut self.houses {
            house.tick_depreciation(dt, &self.config);
            if house.durability <= 0.0 {
                collapsed_house_ids.push(house.id);
            }
        }

        if !collapsed_house_ids.is_empty() {
            let updates: Vec<(usize, NodeId)> = self.agents.iter().enumerate()
                .filter_map(|(i, agent)| {
                    if let Some(hid) = agent.home_house_id {
                        if collapsed_house_ids.contains(&hid) {
                            let c_node = self.find_nearest_node(agent.world_pos)?;
                            return Some((i, c_node));
                        }
                    }
                    None
                })
                .collect();

            for (i, c_node) in updates {
                self.agents[i].home_house_id = None;
                self.agents[i].home_camp_node = c_node;
            }
            for hid in &collapsed_house_ids {
                self.last_event = Some(format!("🏚️ 房屋 #{} 因自然风化耐久耗尽归零，彻底坍塌消逝！", hid));
            }
            self.houses.retain(|h| h.durability > 0.0);
        }
    }

    /// 房屋劳作修缮结算 (修缮由 agent 自主决策的 RepairHouse 需求触发, 系统仅推进进度, 不再扫描指挥)
    pub(crate) fn tick_house_repair(&mut self, dt: f32) {
        for house in &mut self.houses {
            house.is_repairing = false;
            if !house.is_ruin && house.durability < self.config.house_durability_max {
                let owner_id = house.owner_id;
                let spouse_id = house.spouse_id;
                for agent in &mut self.agents {
                    if agent.is_alive && (agent.id == owner_id || spouse_id == Some(agent.id)) {
                        if agent.state == PrimitiveActionState::RepairingHouse {
                            house.is_repairing = true;
                            house.repair(self.config.house_repair_speed * dt, &self.config);
                            if house.durability >= self.config.house_durability_max {
                                agent.state = PrimitiveActionState::RestingAtCamp;
                                agent.current_need = Some("Physiological·Rest".to_string());
                                self.last_event = Some(format!("🔧 部落民 #{} 劳作修缮了 #{} 号房屋，耐久度已恢复至 100%！", agent.id, house.id));
                            }
                        }
                    }
                }
            } else {
                for agent in &mut self.agents {
                    if agent.state == PrimitiveActionState::RepairingHouse && agent.home_house_id == Some(house.id) {
                        agent.state = PrimitiveActionState::RestingAtCamp;
                        agent.current_need = Some("Physiological·Rest".to_string());
                    }
                }
            }
        }
    }
}
