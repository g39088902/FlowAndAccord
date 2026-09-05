use crate::spatial::agent::PrimitiveActionState;
use crate::spatial::graph::NodeId;
use crate::spatial::house::HouseTier;
use crate::spatial::ledger::journal::{LedgerRef, ResourceKind, TransferReason};
use crate::spatial::snapshot::Season;
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// 冬季取暖消耗：低温或冬季时房屋消耗木材取暖
    /// ★ M6 终态：真实消耗「户主家户账本」木（Heating: Family → Void）；房屋 pantry 已删除。
    /// 0 级仓库无火炕不取暖（与历史语义一致）；账本有柴才烧得到，无柴则本 tick 不耗。
    pub(crate) fn tick_winter_heating(&mut self, dt: f32) {
        if self.current_season == Season::Winter || self.temperature < self.config.house_winter_cold_temp {
            let wood_burn_rate = self.config.house_winter_wood_burn_rate * dt;
            let tick = self.tick_counter;
            // READ：需供暖房屋的户主家户（非 0 级；无主空置房不取暖）
            let targets: Vec<u64> = self
                .houses
                .iter()
                .filter(|h| h.tier != HouseTier::Tier0Warehouse)
                .filter_map(|h| h.owner_id.and_then(|oid| self.household_registry.household_of(oid)))
                .collect();
            // WRITE：对每户家户账本真实扣柴
            for hh_hid in targets {
                let ledger_wood = self.household_registry.get(hh_hid).map(|hh| hh.group.ledger.balance(ResourceKind::Wood)).unwrap_or(0.0);
                let burn = wood_burn_rate.min(ledger_wood);
                if burn > 0.001 {
                    if let Some(hh) = self.household_registry.get_mut(hh_hid) {
                        hh.group.ledger.record_consumption(LedgerRef::Family(hh_hid), ResourceKind::Wood, burn, TransferReason::Heating, tick);
                    }
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
                if let Some(h) = self.houses.iter().find(|h| h.id == *hid) {
                    if h.auction_state.is_some() { self.auction_flopped = self.auction_flopped.saturating_add(1); }
                }
                self.last_event = Some(format!("🏚️ 房屋 #{} 因自然风化耐久耗尽归零，彻底坍塌消逝！", hid));
            }
            self.houses.retain(|h| h.durability > 0.0);
            // ★ v1.10.0 坍塌房屋从营地空置列表移除
            for camp in &mut self.pois {
                if camp.poi_type == crate::spatial::poi::PoiType::Camp {
                    camp.vacant_houses.retain(|vh| !collapsed_house_ids.contains(&vh.house_id));
                }
            }
        }
    }

    /// 房屋劳作修缮结算 (修缮由 agent 自主决策的 RepairHouse 需求触发, 系统仅推进进度, 不再扫描指挥)
    /// ★ v1.10.0 无主空置房（owner_id=None）不修缮；仅有主房屋可被户主/配偶修缮。
    pub(crate) fn tick_house_repair(&mut self, dt: f32) {
        for house in &mut self.houses {
            house.is_repairing = false;
            if house.durability < self.config.house_durability_max {
                let owner_id = house.owner_id;
                let spouse_id = house.spouse_id;
                for agent in &mut self.agents {
                    if agent.is_alive && (owner_id == Some(agent.id) || spouse_id == Some(agent.id)) {
                        if agent.state == PrimitiveActionState::RepairingHouse {
                            house.is_repairing = true;
                            house.repair(self.config.house_repair_speed * dt, &self.config);
                            if house.durability >= self.config.house_durability_max {
                                agent.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
                                agent.current_need = Some("Physiological·Rest".to_string());
                                // ★ M2 Maintenance 事件：修缮完工记入家户团体事件（纯审计，无资源消耗）
                                let tick = self.tick_counter;
                                if let Some(oid) = owner_id {
                                    if let Some(hid) = self.household_registry.household_of(oid) {
                                        if let Some(hh) = self.household_registry.get_mut(hid) {
                                            hh.group.ledger.push_event(tick, format!("🔧 修缮完工：房屋 #{} 耐久度恢复至 100%（修缮人 #{})", house.id, agent.id));
                                        }
                                    }
                                }
                                self.last_event = Some(format!("🔧 部落民 #{} 劳作修缮了 #{} 号房屋，耐久度已恢复至 100%！", agent.id, house.id));
                            }
                        }
                    }
                }
            } else {
                for agent in &mut self.agents {
                    if agent.state == PrimitiveActionState::RepairingHouse && agent.home_house_id == Some(house.id) {
                        agent.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
                        agent.current_need = Some("Physiological·Rest".to_string());
                    }
                }
            }
        }
    }
}
