use super::agent::{Gender, PrimitiveActionState};
use super::ledger::journal::ResourceKind;
use super::poi::{PoiType, market_unit_price};
use super::house::{HouseSnapshot, HouseBidSnapshot, HouseDealSnapshot};
use super::snapshot::{
    AgentSnapshot, ClanSnapshot, GeoCellSnapshot, HistoryKingSnapshot, HouseholdSnapshot, LaneSnapshot, LedgerBalanceSnapshot, RegionSnapshot,
    MarriageSnapshot, NodeSnapshot, PoiSnapshot, Season, TransferRecordSnapshot, VacantHouseSnapshot, WorldSnapshot3D,
};
use super::world::World3DEngine;

/// 快照生成
///
/// `generate_snapshot()` 将 `World3DEngine` 的完整状态序列化为 `WorldSnapshot3D`，
/// 经 WASM 线性内存以 JSON 形式传递给前端 `rustworld.js::_applySnapshot()`。
///
/// **三处同步不变量**（根 AGENTS.md §4.5）：新增字段时必须同步修改
/// 1. `snapshot.rs`（结构体定义）
/// 2. 本文件 `generate_snapshot()`（赋值）
/// 3. `frontend/js/rustworld.js::_applySnapshot()`（前端映射）
impl World3DEngine {
    /// 导出快照
    pub fn generate_snapshot(&self) -> WorldSnapshot3D {
        let mut terrain_cells = Vec::with_capacity(self.terrain.cells.len());
        for cell in &self.terrain.cells {
            terrain_cells.push(GeoCellSnapshot {
                elevation: cell.elevation,
                slope_angle: cell.slope_angle_deg,
            });
        }

        let mut pois = Vec::new();
        for p in &self.pois {
            let (water_price, food_price) = if p.poi_type == PoiType::Market {
                (
                    market_unit_price(p.current_stock, p.max_stock, &self.config),
                    market_unit_price(p.secondary_stock, p.secondary_max_stock, &self.config),
                )
            } else {
                (0.0, 0.0)
            };
            pois.push(PoiSnapshot {
                id: p.id,
                poi_type: format!("{:?}", p.poi_type),
                x: p.pos.x,
                y: p.pos.y,
                z: p.pos.z,
                current_stock: p.current_stock,
                max_stock: p.max_stock,
                regen_rate: p.regen_rate,
                secondary_stock: p.secondary_stock,
                secondary_max_stock: p.secondary_max_stock,
                secondary_regen_rate: p.secondary_regen_rate,
                water_price,
                food_price,
                name: p.name.clone(),
                camp_title: p.camp_title(),
                level: p.level,
                bound_houses: p.bound_houses_count,
                vacant_houses: p.vacant_houses.iter().map(|vh| VacantHouseSnapshot {
                    house_id: vh.house_id,
                    beneficiary_ids: vh.beneficiary_ids.clone(),
                }).collect(),
            });
        }

        let mut houses = Vec::new();
        for h in &self.houses {
            let (auction_phase, benchmark_bid, highest_bid) = match &h.auction_state {
                Some(st) => {
                    let deadline = self.config.house_auction_deadline_durability;
                    let obs_ratio = self.config.house_auction_observation_ratio;
                    let obs_dur = if st.start_durability > deadline {
                        st.start_durability - obs_ratio * (st.start_durability - deadline)
                    } else {
                        deadline
                    };
                    let phase = if h.durability > obs_dur {
                        "观察期"
                    } else if h.durability > deadline {
                        "决策期"
                    } else {
                        "出清期"
                    };
                    (Some(phase.to_string()), st.benchmark_bid, st.current_highest_bid)
                }
                None => (None, 0.0, 0.0),
            };

            let last_deal = h.deal_history.last();

            let recent_bids: Vec<HouseBidSnapshot> = h.bids_history.iter().rev().take(10).map(|b| HouseBidSnapshot {
                tick: b.tick,
                bidder_id: b.bidder_id,
                amount: b.amount,
                phase: b.phase.clone(),
            }).collect();

            let recent_deals: Vec<HouseDealSnapshot> = h.deal_history.iter().rev().take(5).map(|d| HouseDealSnapshot {
                tick: d.deal_tick,
                buyer_id: d.buyer_id,
                price: d.price,
                durability: d.durability,
                reason: d.reason.clone(),
            }).collect();

            houses.push(HouseSnapshot {
                id: h.id,
                owner_id: h.owner_id,
                spouse_id: h.spouse_id,
                camp_id: h.camp_id,
                x: h.pos.x,
                y: h.pos.y,
                z: h.pos.z,
                tier: format!("{:?}", h.tier),
                durability: h.durability,
                age: h.age,
                construction_progress: h.construction_progress,
                is_repairing: h.is_repairing,
                builder_id: h.builder_id,
                last_upgrader_id: h.last_upgrader_id,
                current_valuation: h.current_valuation,
                auction_phase,
                benchmark_bid,
                highest_bid,
                bids_count: h.bids_history.len(),
                last_deal_price: last_deal.map(|d| d.price),
                last_deal_tick: last_deal.map(|d| d.deal_tick),
                auction_start_durability: h.auction_state.as_ref().map(|st| st.start_durability),
                recent_bids,
                recent_deals,
            });
        }

        let mut nodes = Vec::new();
        for node_idx in self.network.graph.node_indices() {
            let node = &self.network.graph[node_idx];
            nodes.push(NodeSnapshot {
                id: node.id,
                x: node.pos.x,
                y: node.pos.y,
                z: node.pos.z,
                node_type: format!("{:?}", node.node_type),
            });
        }

        let mut lanes = Vec::new();
        for edge_idx in self.network.graph.edge_indices() {
            let lane = &self.network.graph[edge_idx];
            lanes.push(LaneSnapshot {
                id: lane.id,
                from: lane.from_node,
                to: lane.to_node,
                p0: lane.curve.p0,
                p1: lane.curve.p1,
                p2: lane.curve.p2,
                p3: lane.curve.p3,
                road_class: format!("{:?}", lane.road_class),
                speed_limit: lane.speed_limit,
                wear: lane.wear,
                is_hidden: lane.is_hidden,
                concealment: lane.concealment,
            });
        }

        let mut agents = Vec::new();
        for agent in &self.agents {
            agents.push(AgentSnapshot {
                id: agent.id,
                gender: format!("{:?}", agent.gender),
                x: agent.world_pos.x,
                y: agent.world_pos.y,
                z: agent.world_pos.z,
                age: agent.age,
                birth_tick: agent.birth_tick,
                heading_rad: agent.forward_heading_rad,
                pitch_rad: agent.pitch_rad,
                velocity: agent.current_velocity,
                carried_water: agent.carried_water,
                carried_food: agent.carried_food,
                carried_wood: agent.carried_wood,
                carried_stone: agent.carried_stone,
                carried_gold: agent.carried_gold,
                build_timer: agent.build_timer,
                miscarriage_alert_timer: agent.miscarriage_alert_timer,
                state: format!("{:?}", agent.state),
                is_alive: agent.is_alive,
                hunger: agent.hunger,
                thirst: agent.thirst,
                stamina: agent.stamina,
                health: agent.health,
                max_health: agent.max_health,
                is_pregnant: agent.is_pregnant,
                pregnancy_progress: agent.pregnancy_progress,
                pregnancy_child_id: agent.pregnancy_child_id,
                is_fetus: agent.is_fetus,
                miscarriage_cooldown: agent.miscarriage_cooldown_timer,
                postpartum_cooldown: agent.postpartum_cooldown_timer,
                miscarriage_alert: agent.miscarriage_alert_timer > 0.0,
                death_decay_timer: agent.death_decay_timer,
                death_cause: agent.death_cause.clone(),
                current_need: agent.current_need.clone(),
                is_covert: agent.is_covert,
                stealth_visibility: agent.stealth_visibility,
                home_house_id: agent.home_house_id,
                generation: agent.generation,
                spouse_id: agent.spouse_id,
                mother_id: agent.mother_id,
                father_id: agent.father_id,
                children_ids: agent.children_ids.clone(),
                intelligence: agent.intelligence,
                strength: agent.strength,
                digestion_efficiency: agent.digestion_efficiency,
                libido: agent.libido,
                sleep_efficiency: agent.sleep_efficiency,
                life_expectancy: agent.life_expectancy,
                surname: agent.surname.clone(),
                // ★ M6 威望改为 Agent 持久综合分值（透传存储值，不再由子嗣数派生）
                prestige: agent.prestige,
                // ★ M2 婚姻与家户归属
                marriage_history_count: self.marriage_registry.by_agent.get(&agent.id).map(|v| v.len() as u32).unwrap_or(0),
                household_id: self.household_registry.household_of(agent.id),
                household_role: {
                    if let Some(hid) = self.household_registry.household_of(agent.id) {
                        if let Some(hh) = self.household_registry.get(hid) {
                            if hh.head == agent.id {
                                "Head".to_string()
                            } else if agent.spouse_id == Some(hh.head) {
                                "Spouse".to_string()
                            } else {
                                "Child".to_string()
                            }
                        } else {
                            "None".to_string()
                        }
                    } else {
                        "None".to_string()
                    }
                },
                // ★ M4 到达时刻与夺位远征状态
                arrival_tick: agent.arrival_tick,
                is_on_expedition: matches!(agent.state, crate::spatial::agent::PrimitiveActionState::SeekingThrone),
                expedition_target_camp: agent.expedition_target_camp,
                coronation_pending: agent.coronation_pending,
                courtship_target_id: agent.courtship_target_id,
            });
        }

        // ★ 家户登记簿快照（家庭跟着男人走）
        let resource_kinds = [ResourceKind::Water, ResourceKind::Food, ResourceKind::Wood, ResourceKind::Stone, ResourceKind::Gold];
        let mut households = Vec::new();
        for (_hid, hh) in &self.household_registry.households {
            let balances: Vec<LedgerBalanceSnapshot> = resource_kinds.iter().map(|&rk| {
                LedgerBalanceSnapshot {
                    resource: format!("{:?}", rk),
                    amount: hh.group.ledger.balance(rk),
                }
            }).collect();
            // 取最近8条团体事件（从新到旧；直接访问 VecDeque 字段以获得 DoubleEndedIterator）
            let recent_events: Vec<String> = hh.group.ledger.events
                .iter()
                .rev()
                .take(8)
                .map(|e| e.note.clone())
                .collect();
            // 取最近8笔资源流水（从新到旧）
            let recent_journal: Vec<TransferRecordSnapshot> = hh.group.ledger.journal
                .iter()
                .rev()
                .take(8)
                .map(|r| TransferRecordSnapshot {
                    tick: r.tick,
                    resource: format!("{:?}", r.resource),
                    amount: r.amount,
                    from: format!("{:?}", r.from),
                    to: format!("{:?}", r.to),
                    reason: format!("{:?}", r.reason),
                })
                .collect();
            households.push(HouseholdSnapshot {
                id: hh.id,
                head: hh.head,
                members: hh.group.members.iter().copied().collect(),
                balances,
                parent_household: hh.parent_household,
                founded_tick: hh.founded_tick,
                is_dissolved: hh.is_dissolved,
                recent_events,
                recent_journal,
            });
        }

        // ★ 婚姻登记簿快照
        let mut marriages = Vec::new();
        for (_mid, m) in &self.marriage_registry.marriages {
            marriages.push(MarriageSnapshot {
                id: m.id,
                husband_id: m.husband_id,
                wife_id: m.wife_id,
                start_tick: m.start_tick,
                end_tick: m.end_tick,
                end_reason: m.end_reason.map(|r| format!("{:?}", r)),
                is_active: m.is_active(),
            });
        }

        // ★ M3 宗族登记簿快照
        let mut clans = Vec::new();
        for (surname, clan) in &self.clan_registry.clans {
            let balances: Vec<LedgerBalanceSnapshot> = resource_kinds.iter().map(|&rk| {
                LedgerBalanceSnapshot {
                    resource: format!("{:?}", rk),
                    amount: clan.ledger.balance(rk),
                }
            }).collect();
            let recent_events: Vec<String> = clan.ledger.events
                .iter()
                .rev()
                .take(8)
                .map(|e| e.note.clone())
                .collect();
            let recent_journal: Vec<TransferRecordSnapshot> = clan.ledger.journal
                .iter()
                .rev()
                .take(8)
                .map(|r| TransferRecordSnapshot {
                    tick: r.tick,
                    resource: format!("{:?}", r.resource),
                    amount: r.amount,
                    from: format!("{:?}", r.from),
                    to: format!("{:?}", r.to),
                    reason: format!("{:?}", r.reason),
                })
                .collect();
            // ★ v1.9.0 绝嗣状态
            let is_extinct = self.clan_registry.extinct.contains(surname);
            clans.push(ClanSnapshot {
                surname: surname.clone(),
                leader_id: clan.leader,
                member_count: clan.members.len() as u32,
                member_ids: clan.members.iter().copied().collect(),
                balances,
                recent_journal,
                recent_events,
                is_extinct,
            });
        }

        // ★ M4 地区与王国快照
        let mut regions = Vec::new();
        for (camp_id, region) in &self.region_registry.regions {
            let camp_name = self.pois.iter()
                .find(|p| p.poi_type == PoiType::Camp && p.id == *camp_id)
                .map(|p| p.camp_title())
                .unwrap_or_else(|| format!("营地#{}", camp_id));

            let balances: Vec<LedgerBalanceSnapshot> = resource_kinds.iter().map(|&rk| {
                LedgerBalanceSnapshot {
                    resource: format!("{:?}", rk),
                    amount: region.group.ledger.balance(rk),
                }
            }).collect();
            let recent_events: Vec<String> = region.group.ledger.events
                .iter()
                .rev()
                .take(8)
                .map(|e| e.note.clone())
                .collect();
            let recent_journal: Vec<TransferRecordSnapshot> = region.group.ledger.journal
                .iter()
                .rev()
                .take(8)
                .map(|r| TransferRecordSnapshot {
                    tick: r.tick,
                    resource: format!("{:?}", r.resource),
                    amount: r.amount,
                    from: format!("{:?}", r.from),
                    to: format!("{:?}", r.to),
                    reason: format!("{:?}", r.reason),
                })
                .collect();

            // 到达时序前10
            let arrival_order: Vec<u32> = region.arrival_order.iter().take(10).copied().collect();

            // 顺位前3继承人（长子继承制：国王的儿子→孙子→arrival_order下一男性）
            let mut heir_candidates: Vec<u32> = Vec::new();
            if let Some(king_id) = region.group.leader {
                // 儿子
                let mut sons: Vec<(u32, f32)> = Vec::new();
                for a in &self.agents {
                    if a.is_alive && a.gender == Gender::Male && a.father_id == Some(king_id) {
                        sons.push((a.id, a.age));
                    }
                }
                sons.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap().then(a.0.cmp(&b.0)));
                for (sid, _) in sons.iter().take(3) {
                    heir_candidates.push(*sid);
                }
                // 若儿子不足3个，补孙子
                if heir_candidates.len() < 3 {
                    let son_ids: std::collections::BTreeSet<u32> = sons.iter().map(|(id, _)| *id).collect();
                    let mut grandsons: Vec<(u32, f32)> = Vec::new();
                    for a in &self.agents {
                        if a.is_alive && a.gender == Gender::Male {
                            if let Some(fid) = a.father_id {
                                if son_ids.contains(&fid) {
                                    grandsons.push((a.id, a.age));
                                }
                            }
                        }
                    }
                    grandsons.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap().then(a.0.cmp(&b.0)));
                    for (gid, _) in grandsons.iter() {
                        if heir_candidates.len() >= 3 { break; }
                        heir_candidates.push(*gid);
                    }
                }
            }

            // 正在冲向该营地夺位的族人（决策引擎驱动的远征：agent 自主持有目标营地）
            let active_expedition_agents: Vec<u32> = self.agents.iter()
                .filter(|a| a.is_alive && a.state == PrimitiveActionState::SeekingThrone && a.expedition_target_camp == Some(*camp_id))
                .map(|a| a.id)
                .collect();

            // ★ v1.12.0 历史国王（含在位时长与死因）/ 居民列表 / 管辖家庭
            let history_kings: Vec<HistoryKingSnapshot> = region.history_kings.iter().map(|hk| HistoryKingSnapshot {
                agent_id: hk.agent_id,
                reign_start_tick: hk.reign_start_tick,
                reign_end_tick: hk.reign_end_tick,
                death_cause: hk.death_cause.clone(),
            }).collect();
            let member_ids: Vec<u32> = region.group.members.iter().copied().collect();
            let governed_households: Vec<u64> = self.household_registry.households.iter()
                .filter(|(_, hh)| !hh.is_dissolved && self.region_registry.region_of(hh.head) == Some(*camp_id))
                .map(|(hid, _)| *hid)
                .collect();

            regions.push(RegionSnapshot {
                camp_id: *camp_id,
                camp_name,
                king_id: region.group.leader,
                regime: format!("{:?}", region.regime),
                succession: format!("{:?}", region.succession),
                member_count: region.group.members.len() as u32,
                arrival_order,
                heir_candidates,
                balances,
                recent_journal,
                recent_events,
                active_expedition_agents,
                history_kings,
                member_ids,
                governed_households,
                current_reign_start: region.current_reign_start,
            });
        }

        let season_str = match self.current_season {
            Season::Spring => "Spring",
            Season::Summer => "Summer",
            Season::Autumn => "Autumn",
            Season::Winter => "Winter",
        };
        let quarter_length = self.config.season_quarter_length();
        let season_progress = ((self.season_timer + quarter_length * 0.5) % quarter_length) / quarter_length;

        WorldSnapshot3D {
            tick: self.tick_counter,
            terrain_cells,
            grid_w: self.terrain.grid_width,
            grid_h: self.terrain.grid_height,
            world_size: self.terrain.world_size,
            tilt_angle_rad: self.terrain.tilt_angle_rad,
            tilt_magnitude: self.terrain.tilt_magnitude,
            pois,
            houses,
            nodes,
            lanes,
            agents,
            households,
            marriages,
            clans,
            regions,
            public_granary_balances: resource_kinds.iter().map(|&rk| {
                LedgerBalanceSnapshot {
                    resource: format!("{:?}", rk),
                    amount: self.public_granary.balance(rk),
                }
            }).collect(),
            total_births: self.total_births,
            total_deaths: self.total_deaths,
            total_deaths_natural: self.total_deaths_natural,
            total_deaths_unnatural: self.total_deaths_unnatural,
            total_miscarriages: self.total_miscarriages,
            season: season_str.to_string(),
            temperature: self.temperature,
            season_progress,
            last_mutation_event: self.last_event.clone(),
            recent_deaths: self.recent_deaths.clone(),
        }
    }
}
