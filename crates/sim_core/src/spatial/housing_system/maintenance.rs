use crate::spatial::agent::PrimitiveActionState;
use crate::spatial::graph::NodeId;
use crate::spatial::house::HouseTier;
use crate::spatial::ledger::journal::{LedgerRef, ResourceKind, TransferReason};
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// 低温供暖消耗：气温低于阈值时房屋消耗木材取暖
    /// ★ M6 终态：真实消耗「户主家户账本」木（Heating: Family → Void）；房屋 pantry 已删除。
    /// 0 级仓库无火炕不取暖（与历史语义一致）；账本有柴才烧得到，无柴则本 tick 不耗。
    pub(crate) fn tick_winter_heating(&mut self, dt: f32) {
        if self.temperature < self.config.house_winter_cold_temp {
            let wood_burn_rate = self.config.house_winter_wood_burn_rate * dt;
            let tick = self.tick_counter;
            // READ：需供暖房屋的户主家户（非 0 级；无主空置房不取暖）
            let targets: Vec<u64> = self
                .houses
                .iter()
                .filter(|h| h.tier != HouseTier::Tier0Warehouse)
                .filter_map(|h| {
                    h.owner_id
                        .and_then(|oid| self.household_registry.household_of(oid))
                })
                .collect();
            // WRITE：对每户家户账本真实扣柴
            for hh_hid in targets {
                let ledger_wood = self
                    .household_registry
                    .get(hh_hid)
                    .map(|hh| hh.group.ledger.balance(ResourceKind::Wood))
                    .unwrap_or(0.0);
                let burn = wood_burn_rate.min(ledger_wood);
                if burn > 0.001 {
                    if let Some(hh) = self.household_registry.get_mut(hh_hid) {
                        hh.group.ledger.record_consumption(
                            LedgerRef::Family(hh_hid),
                            ResourceKind::Wood,
                            burn,
                            TransferReason::Heating,
                            tick,
                        );
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
            let updates: Vec<(usize, NodeId)> = self
                .agents
                .iter()
                .enumerate()
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
                    if h.auction_state.is_some() {
                        self.auction_flopped = self.auction_flopped.saturating_add(1);
                        let total_bids = h
                            .auction_state
                            .as_ref()
                            .map(|st| st.bids_history.len())
                            .unwrap_or(0);
                        self.push_auction_history(
                            crate::spatial::house::HouseAuctionHistoryRecord {
                                tick: self.tick_counter,
                                house_id: h.id,
                                tier: h.tier,
                                camp_id: h.camp_id,
                                durability: 0.0,
                                is_flop: true,
                                buyer_id: None,
                                price: 0.0,
                                total_bids_count: total_bids,
                                reason: "耐久耗尽自然坍塌流拍".to_string(),
                            },
                        );
                    }
                }
                self.last_event = Some(format!(
                    "🏚️ 房屋 #{} 因自然风化耐久耗尽归零，彻底坍塌消逝！",
                    hid
                ));
            }
            self.houses.retain(|h| h.durability > 0.0);
            // ★ v1.10.0 坍塌房屋从营地空置列表移除
            for camp in &mut self.pois {
                if camp.poi_type == crate::spatial::poi::PoiType::Camp {
                    camp.vacant_houses
                        .retain(|vh| !collapsed_house_ids.contains(&vh.house_id));
                }
            }
        }
    }

    /// 房屋劳作修缮结算 (修缮由 agent 自主决策的 RepairHouse 需求触发, 系统仅推进进度, 不再扫描指挥)
    /// ★ v1.10.0 无主空置房（owner_id=None）不修缮；仅有主房屋可被户主/配偶修缮。
    pub(crate) fn tick_house_repair(&mut self, dt: f32) {
        let max_durability = self.config.house_durability_max;
        let repair_speed = self.config.house_repair_speed;
        let mut completed_repairs: Vec<(u32, u32, Option<u32>)> = Vec::new(); // (house_id, agent_id, owner_id)

        for house in &mut self.houses {
            house.is_repairing = false;
            let candidate_ids: [Option<u32>; 2] = [house.owner_id, house.spouse_id];

            if house.durability < max_durability {
                let owner_id = house.owner_id;
                for aid in candidate_ids.into_iter().flatten() {
                    let Some(&idx) = self.agent_index.get(&aid) else {
                        continue;
                    };
                    let agent = &mut self.agents[idx];
                    if agent.is_alive && agent.state == PrimitiveActionState::RepairingHouse {
                        house.is_repairing = true;
                        house.repair(repair_speed * dt, &self.config);
                        if house.durability >= max_durability {
                            crate::spatial::decisions::transition::finish_task(agent);
                            agent.current_need = Some("Physiological·Rest".to_string());
                            completed_repairs.push((house.id, agent.id, owner_id));
                        }
                    }
                }
            } else {
                for aid in candidate_ids.into_iter().flatten() {
                    let Some(&idx) = self.agent_index.get(&aid) else {
                        continue;
                    };
                    let agent = &mut self.agents[idx];
                    if agent.state == PrimitiveActionState::RepairingHouse
                        && agent.home_house_id == Some(house.id)
                    {
                        crate::spatial::decisions::transition::finish_task(agent);
                        agent.current_need = Some("Physiological·Rest".to_string());
                    }
                }
            }
        }

        let tick = self.tick_counter;
        for (house_id, agent_id, owner_id) in completed_repairs {
            if let Some(oid) = owner_id {
                if let Some(hid) = self.household_registry.household_of(oid) {
                    if let Some(hh) = self.household_registry.get_mut(hid) {
                        hh.group.ledger.push_event(
                            tick,
                            format!(
                                "🔧 修缮完工：房屋 #{} 耐久度恢复至 100%（修缮人 #{})",
                                house_id, agent_id
                            ),
                        );
                    }
                }
            }
            self.last_event = Some(format!(
                "🔧 部落民 #{} 劳作修缮了 #{} 号房屋，耐久度已恢复至 100%！",
                agent_id, house_id
            ));
        }
    }
}
