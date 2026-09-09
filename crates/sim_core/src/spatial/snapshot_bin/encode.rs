//! encode.rs · FABS 二进制快照帧编码（M4 核心）
//!
//! 将 `World3DEngine` 当前状态编码为单帧小端二进制，供前端 `snapshot-bin.js` 解码。
//! 编码结果与 `world_snapshot.rs::generate_snapshot()` 的 JSON **逐字段等价**——
//! 由 `tools/test-wasm.js` 的深比较断言守护。
//!
//! # 确定性
//! 全程只读内核状态，**不消耗 `WorldRng`、不改动任何演化字段**
//! （唯一副作用是消费 `terrain_dirty` 脏位与推进字符串驻留表游标，二者都不参与仿真演化）。
//!
//! # 四处同步铁律（改字段必须同步）
//! `snapshot.rs`（定义）→ `world_snapshot.rs`（JSON 赋值）→ 本文件（二进制编码）
//! → `frontend/js/snapshot-bin.js`（解码）。详见 `layout.rs` 模块文档。

use super::dict::*;
use super::layout::*;
use crate::spatial::agent::PrimitiveActionState;
use crate::spatial::poi::{market_unit_price, market_unit_price_with_base, PoiType};
use crate::spatial::snapshot::ActiveTaskSnapshot;
use crate::spatial::world::World3DEngine;

/// 已编码的一个 section（kind / 记录数 / 字节流）
struct Sec {
    kind: SectionKind,
    count: u32,
    data: Vec<u8>,
}

impl Sec {
    fn new(kind: SectionKind, count: u32, data: Vec<u8>) -> Self {
        Self { kind, count, data }
    }
}

impl World3DEngine {
    /// 把当前世界编码为 FABS 帧写入 `out`（复用调用方缓冲，避免每帧分配）。
    ///
    /// `out` 会被 `clear()` 后整体覆写。
    pub fn write_snapshot_binary(&self, out: &mut Vec<u8>) {
        out.clear();

        let mut tab = self.strtab.borrow_mut();
        let mut secs: Vec<Sec> = Vec::with_capacity(18);
        let mut flags: u16 = 0;

        // ── 增量判定：地形脏位（Cell，&self 可消费）与路网几何签名 ──
        let need_terrain = self.terrain_dirty.replace(false);
        let geom_sig = ((self.network.graph.node_count() as u64) << 32)
            | (self.network.graph.edge_count() as u64);
        let need_geom = self.last_geom_sig.replace(geom_sig) != geom_sig;

        // ══════════════ GLOBAL ══════════════
        {
            let mut w = BinWriter::with_capacity(160);
            let quarter_length = self.config.season_quarter_length();
            let season_progress =
                ((self.season_timer + quarter_length * 0.5) % quarter_length) / quarter_length;
            w.u32(self.terrain.grid_width as u32);
            w.u32(self.terrain.grid_height as u32);
            w.f32(self.terrain.world_size);
            w.f32(self.terrain.tilt_angle_rad);
            w.f32(self.terrain.tilt_magnitude);
            w.u8(season_code(self.current_season));
            w.f32(self.temperature);
            w.f32(season_progress);
            w.u32(self.total_births);
            w.u32(self.total_deaths);
            w.u32(self.total_deaths_natural);
            w.u32(self.total_deaths_unnatural);
            w.u32(self.total_miscarriages);
            w.u64(self.household_registry.households.len() as u64);
            w.u64(self.auction_started);
            w.u64(self.auction_sold);
            w.u64(self.auction_flopped);
            w.f32(
                self.region_registry
                    .regions
                    .values()
                    .map(|r| r.cumulative_royal_privy)
                    .sum::<f32>(),
            );
            w.f32(
                self.empire_registry
                    .empires
                    .values()
                    .map(|e| e.cumulative_imperial_privy)
                    .sum::<f32>(),
            );
            w.f32(self.water_regen_multiplier);
            w.f32(self.berry_regen_multiplier);
            w.f32(self.wood_regen_multiplier);
            w.f32(self.stone_regen_multiplier);
            w.f32(self.gold_regen_multiplier);
            w.u32(tab.intern_opt(&self.last_event));
            w.f32(self.season_timer);
            w.f32(self.el_nino_phase);
            w.f32(self.climate_epoch_phase);
            w.u32(self.terrain.generator_version);
            w.u32(tab.intern(self.terrain.profile.as_str()));
            w.align4();
            secs.push(Sec::new(SectionKind::Global, 1, w.into_inner()));
        }

        // ══════════════ AGENT ══════════════
        {
            let mut w = BinWriter::with_capacity(self.agents.len() * 220 + 64);
            for agent in &self.agents {
                w.u32(agent.id);
                w.u8(gender_code(agent.gender));
                w.f32(agent.world_pos.x);
                w.f32(agent.world_pos.y);
                w.f32(agent.world_pos.z);
                w.f32(agent.age);
                w.u64(agent.birth_tick);
                w.f32(agent.forward_heading_rad);
                w.f32(agent.pitch_rad);
                w.f32(agent.current_velocity);
                w.f32(agent.carried_water);
                w.f32(agent.carried_food);
                w.f32(agent.carried_wood);
                w.f32(agent.carried_stone);
                w.f32(agent.carried_gold);
                w.f32(agent.cumulative_mined);
                w.f32(agent.cumulative_mined_water);
                w.f32(agent.cumulative_mined_food);
                w.f32(agent.cumulative_mined_wood);
                w.f32(agent.cumulative_mined_stone);
                w.f32(agent.cumulative_mined_gold);
                w.f32(agent.cumulative_royal_privy);
                w.f32(agent.cumulative_imperial_privy);
                w.f32(agent.build_timer);
                w.f32(agent.miscarriage_alert_timer);
                w.u8(state_code(agent.state));
                w.u8(agent.is_alive as u8);
                w.f32(agent.hunger);
                w.f32(agent.thirst);
                w.f32(agent.stamina);
                w.f32(agent.health);
                w.f32(agent.max_health);
                w.u8(agent.is_pregnant as u8);
                w.f32(agent.pregnancy_progress);
                w.opt_u32(agent.pregnancy_child_id);
                w.u8(agent.is_fetus as u8);
                w.f32(agent.miscarriage_cooldown_timer);
                w.f32(agent.postpartum_cooldown_timer);
                w.u8((agent.miscarriage_alert_timer > 0.0) as u8);
                w.f32(agent.death_decay_timer);
                w.u32(tab.intern_opt(&agent.death_cause));
                w.u32(tab.intern_opt(&agent.current_need));
                w.u8(agent.is_covert as u8);
                w.f32(agent.stealth_visibility);
                w.opt_u32(agent.home_house_id);
                w.u32(agent.generation);
                w.opt_u32(agent.spouse_id);
                w.opt_u32(agent.mother_id);
                w.opt_u32(agent.father_id);
                w.u32_list(&agent.children_ids);
                w.f32(agent.intelligence);
                w.f32(agent.strength);
                w.f32(agent.digestion_efficiency);
                w.f32(agent.libido);
                w.f32(agent.sleep_efficiency);
                w.f32(agent.life_expectancy);
                w.u32(tab.intern(agent.surname.as_str()));
                w.u32(agent.prestige);
                w.u32(
                    self.marriage_registry
                        .by_agent
                        .get(&agent.id)
                        .map(|v| v.len() as u32)
                        .unwrap_or(0),
                );
                let hid = self.household_registry.household_of(agent.id);
                w.opt_u64(hid);
                // 家户角色推导口径与 world_snapshot.rs 保持一致
                let role = match hid {
                    Some(hid) => match self.household_registry.get(hid) {
                        Some(hh) => {
                            if hh.head == agent.id {
                                ROLE_HEAD
                            } else if agent.spouse_id == Some(hh.head) {
                                ROLE_SPOUSE
                            } else {
                                ROLE_CHILD
                            }
                        }
                        None => ROLE_NONE,
                    },
                    None => ROLE_NONE,
                };
                w.u8(role);
                w.u64(agent.arrival_tick);
                w.u8(matches!(agent.state, PrimitiveActionState::SeekingThrone) as u8);
                w.opt_u32(agent.expedition_target_camp);
                w.opt_u32(agent.coronation_pending);
                w.opt_u32(agent.courtship_target_id);
                for &b in agent.family_stock_active.iter() {
                    w.u8(b as u8);
                }
                if let Some(task) = &agent.active_task {
                    let snap = ActiveTaskSnapshot::from_task_and_queue(task, &agent.harvest_queue);
                    w.u8(1);
                    w.u32(tab.intern(&snap.branch));
                    w.u32(tab.intern(&snap.branch_desc));
                    w.u32(tab.intern(&snap.level));
                    w.u32(tab.intern(&snap.intent_kind));
                    w.u32(tab.intern(&snap.completion));
                    w.u32(tab.intern(&snap.strategy_kind));
                    w.u32(tab.intern(&snap.stage));
                    w.opt_u32(snap.target_id);
                    w.u32(tab.intern(&snap.target_type));
                    w.u32(tab.intern(&snap.primitive_kind));
                    w.u32(tab.intern(&snap.primitive_detail));
                    w.u32(tab.intern(&snap.itinerary));
                } else {
                    w.u8(0);
                }
            }
            w.align4();
            secs.push(Sec::new(
                SectionKind::Agent,
                self.agents.len() as u32,
                w.into_inner(),
            ));
        }

        // ══════════════ POI ══════════════
        {
            let mut w = BinWriter::with_capacity(self.pois.len() * 160 + 256);
            for p in &self.pois {
                let (water_price, food_price, wood_price) = if p.poi_type == PoiType::Market {
                    (
                        market_unit_price(p.current_stock, p.max_stock, &self.config),
                        market_unit_price(p.secondary_stock, p.secondary_max_stock, &self.config),
                        market_unit_price_with_base(
                            p.tertiary_stock,
                            p.tertiary_max_stock,
                            self.config.market_price_base_wood,
                            &self.config,
                        ),
                    )
                } else {
                    (0.0, 0.0, 0.0)
                };
                w.u32(p.id);
                w.u8(poi_type_code(p.poi_type));
                w.f32(p.pos.x);
                w.f32(p.pos.y);
                w.f32(p.pos.z);
                w.f32(p.current_stock);
                w.f32(p.max_stock);
                w.f32(p.regen_rate);
                w.f32(p.secondary_stock);
                w.f32(p.secondary_max_stock);
                w.f32(p.secondary_regen_rate);
                w.f32(p.tertiary_stock);
                w.f32(p.tertiary_max_stock);
                w.f32(p.tertiary_regen_rate);
                w.f32(water_price);
                w.f32(food_price);
                w.f32(wood_price);
                w.f32(p.cumulative_sold_water);
                w.f32(p.cumulative_sold_food);
                w.f32(p.cumulative_sold_wood);
                w.f32(p.cumulative_revenue);
                w.u32(tab.intern(p.name.as_str()));
                w.u32(tab.intern(p.camp_title().as_str()));
                w.u8(p.level);
                w.u32(p.bound_houses_count);
                // 空置房屋列表（仅营地有内容）
                w.u16(p.vacant_houses.len() as u16);
                for vh in &p.vacant_houses {
                    w.u32(vh.house_id);
                    w.u32_list(&vh.beneficiary_ids);
                }
                // 榷场交易流水（从新到旧最多 8 条）
                if p.poi_type == PoiType::Market {
                    let trades: Vec<_> = p.market_trades.iter().rev().take(8).collect();
                    w.u16(trades.len() as u16);
                    for t in trades {
                        w.u64(t.tick);
                        w.u32(t.agent_id);
                        w.opt_u64(t.household_id);
                        w.u32(tab.intern(t.resource.as_str()));
                        w.f32(t.amount);
                        w.f32(t.unit_price);
                        w.f32(t.gold_cost);
                    }
                } else {
                    w.u16(0);
                }
            }
            w.align4();
            secs.push(Sec::new(
                SectionKind::Poi,
                self.pois.len() as u32,
                w.into_inner(),
            ));
        }

        // ══════════════ HOUSE ══════════════
        {
            let mut w = BinWriter::with_capacity(self.houses.len() * 160 + 256);
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
                        (Some(phase), st.benchmark_bid, st.current_highest_bid)
                    }
                    None => (None, 0.0, 0.0),
                };
                let last_deal = h.deal_history.last();
                let st = h.auction_state.as_ref();

                w.u32(h.id);
                w.opt_u32(h.owner_id);
                w.opt_u32(h.spouse_id);
                w.u32(h.camp_id);
                w.f32(h.pos.x);
                w.f32(h.pos.y);
                w.f32(h.pos.z);
                w.u8(house_tier_code(h.tier));
                w.f32(h.durability);
                w.f32(h.age);
                w.f32(h.construction_progress);
                w.u8(h.is_repairing as u8);
                w.u32(h.builder_id);
                w.opt_u32(h.last_upgrader_id);
                w.u32(match auction_phase {
                    Some(s) => tab.intern(s),
                    None => NONE_U32,
                });
                w.f32(benchmark_bid);
                w.f32(highest_bid);
                w.u32(st.map(|s| s.bids_history.len()).unwrap_or(0) as u32);
                w.opt_f32(last_deal.map(|d| d.price));
                w.opt_u64(last_deal.map(|d| d.deal_tick));
                w.opt_f32(h.auction_state.as_ref().map(|s| s.start_durability));
                // 报价流水（本次拍卖会话内，从新到旧最多 10 条）
                match st {
                    Some(s) => {
                        let bids: Vec<_> = s.bids_history.iter().rev().take(10).collect();
                        w.u16(bids.len() as u16);
                        for b in bids {
                            w.u64(b.tick);
                            w.u32(b.bidder_id);
                            w.f32(b.amount);
                            w.u32(tab.intern(b.phase.as_str()));
                        }
                    }
                    None => w.u16(0),
                }
                // 成交档案（从新到旧最多 5 条）
                let deals: Vec<_> = h.deal_history.iter().rev().take(5).collect();
                w.u16(deals.len() as u16);
                for d in deals {
                    w.u64(d.deal_tick);
                    w.u32(d.buyer_id);
                    w.f32(d.price);
                    w.f32(d.durability);
                    w.u32(tab.intern(d.reason.as_str()));
                }
            }
            w.align4();
            secs.push(Sec::new(
                SectionKind::House,
                self.houses.len() as u32,
                w.into_inner(),
            ));
        }

        // ══════════════ LANE_GEO / LANE_WEAR / NODE（增量） ══════════════
        {
            let lane_count = self.network.graph.edge_count();
            let mut wear = BinWriter::with_capacity(lane_count * 4 + 16);
            let mut geo: Option<BinWriter> = if need_geom {
                Some(BinWriter::with_capacity(lane_count * 64 + 16))
            } else {
                None
            };
            for edge_idx in self.network.graph.edge_indices() {
                let lane = &self.network.graph[edge_idx];
                wear.f32(lane.wear);
                if let Some(g) = geo.as_mut() {
                    g.u32(lane.id);
                    g.u32(lane.from_node);
                    g.u32(lane.to_node);
                    g.f32(lane.curve.p0.x);
                    g.f32(lane.curve.p0.y);
                    g.f32(lane.curve.p0.z);
                    g.f32(lane.curve.p1.x);
                    g.f32(lane.curve.p1.y);
                    g.f32(lane.curve.p1.z);
                    g.f32(lane.curve.p2.x);
                    g.f32(lane.curve.p2.y);
                    g.f32(lane.curve.p2.z);
                    g.f32(lane.curve.p3.x);
                    g.f32(lane.curve.p3.y);
                    g.f32(lane.curve.p3.z);
                    g.u8(road_class_code(lane.road_class));
                    g.f32(lane.speed_limit);
                    g.u8(lane.is_hidden as u8);
                    g.f32(lane.concealment);
                }
            }
            wear.align4();
            secs.push(Sec::new(
                SectionKind::LaneWear,
                lane_count as u32,
                wear.into_inner(),
            ));
            if let Some(g) = geo {
                let mut g = g;
                g.align4();
                flags |= flag::HAS_LANE_GEO;
                secs.push(Sec::new(
                    SectionKind::LaneGeo,
                    lane_count as u32,
                    g.into_inner(),
                ));
            }
            if need_geom {
                let node_count = self.network.graph.node_count();
                let mut n = BinWriter::with_capacity(node_count * 16 + 16);
                for node_idx in self.network.graph.node_indices() {
                    let node = &self.network.graph[node_idx];
                    n.u32(node.id);
                    n.f32(node.pos.x);
                    n.f32(node.pos.y);
                    n.f32(node.pos.z);
                    n.u8(node_type_code(node.node_type));
                }
                n.align4();
                secs.push(Sec::new(
                    SectionKind::Node,
                    node_count as u32,
                    n.into_inner(),
                ));
            }
        }

        // ══════════════ TERRAIN（脏帧） ══════════════
        if need_terrain {
            let mut w = BinWriter::with_capacity(self.terrain.cells.len() * 24 + 16);
            for cell in &self.terrain.cells {
                w.f32(cell.elevation);
                w.f32(cell.slope_angle_deg);
                w.u8(surface_kind_code(cell.surface_kind));
                w.f32(cell.natural_fertility);
                w.opt_u32(cell.water_body_id);
                w.u16(cell.feature_flags);
                w.align4();
            }
            w.align4();
            flags |= flag::HAS_TERRAIN;
            secs.push(Sec::new(
                SectionKind::Terrain,
                self.terrain.cells.len() as u32,
                w.into_inner(),
            ));

            let mut f = BinWriter::with_capacity(self.terrain.features.len() * 96 + 16);
            for feature in &self.terrain.features {
                f.u32(feature.id);
                f.u8(terrain_feature_kind_code(feature.kind));
                f.u16(feature.flags);
                f.f32(feature.elevation);
                f.f32(feature.width);
                f.u16(feature.vertices.len() as u16);
                for vertex in &feature.vertices {
                    f.f32(vertex.x);
                    f.f32(vertex.y);
                    f.f32(vertex.z);
                }
                f.align4();
            }
            f.align4();
            secs.push(Sec::new(
                SectionKind::TerrainFeatures,
                self.terrain.features.len() as u32,
                f.into_inner(),
            ));
        }

        // ══════════════ HOUSEHOLD ══════════════
        {
            let mut w = BinWriter::with_capacity(
                self.household_registry.active_households.len() * 512 + 128,
            );
            let mut n = 0u32;
            for hid in &self.household_registry.active_households {
                let Some(hh) = self.household_registry.households.get(hid) else {
                    continue;
                };
                n += 1;
                w.u64(hh.id);
                w.u32(hh.head);
                let members: Vec<u32> = hh.group.members.iter().copied().collect();
                w.u32_list(&members);
                Self::write_balances(&mut w, &hh.group.ledger);
                w.opt_u64(hh.parent_household);
                w.u64(hh.founded_tick);
                w.u8(hh.is_dissolved as u8);
                Self::write_events(&mut w, &hh.group.ledger, &mut *tab);
                Self::write_journal(&mut w, &hh.group.ledger, &mut *tab);
            }
            w.align4();
            secs.push(Sec::new(SectionKind::Household, n, w.into_inner()));
        }

        // ══════════════ MARRIAGE ══════════════
        {
            let mut w = BinWriter::with_capacity(self.marriage_registry.marriages.len() * 48 + 16);
            for (_mid, m) in &self.marriage_registry.marriages {
                w.u64(m.id);
                w.u32(m.husband_id);
                w.u32(m.wife_id);
                w.u64(m.start_tick);
                w.opt_u64(m.end_tick);
                w.u32(match m.end_reason {
                    Some(r) => tab.intern(&format!("{:?}", r)),
                    None => NONE_U32,
                });
                w.u8(m.is_active() as u8);
            }
            w.align4();
            secs.push(Sec::new(
                SectionKind::Marriage,
                self.marriage_registry.marriages.len() as u32,
                w.into_inner(),
            ));
        }

        // ══════════════ CLAN ══════════════
        {
            let mut w = BinWriter::with_capacity(self.clan_registry.clans.len() * 512 + 128);
            for (surname, clan) in &self.clan_registry.clans {
                w.u32(tab.intern(surname.as_str()));
                w.opt_u32(clan.leader);
                let members: Vec<u32> = clan.members.iter().copied().collect();
                w.u32(members.len() as u32);
                w.u32_list(&members);
                Self::write_balances(&mut w, &clan.ledger);
                Self::write_journal(&mut w, &clan.ledger, &mut *tab);
                Self::write_events(&mut w, &clan.ledger, &mut *tab);
                w.u8(self.clan_registry.extinct.contains(surname) as u8);
            }
            w.align4();
            secs.push(Sec::new(
                SectionKind::Clan,
                self.clan_registry.clans.len() as u32,
                w.into_inner(),
            ));
        }

        // ══════════════ REGION ══════════════
        {
            let mut w = BinWriter::with_capacity(self.region_registry.regions.len() * 512 + 128);
            for (camp_id, region) in &self.region_registry.regions {
                let camp_name = self
                    .pois
                    .iter()
                    .find(|p| p.poi_type == PoiType::Camp && p.id == *camp_id)
                    .map(|p| p.camp_title())
                    .unwrap_or_else(|| format!("营地#{}", camp_id));

                // 长子继承制顺位前 3（口径与 world_snapshot.rs 完全一致）
                let mut heir_candidates: Vec<u32> = Vec::new();
                if let Some(king_id) = region.group.leader {
                    use crate::spatial::agent::Gender;
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
                    if heir_candidates.len() < 3 {
                        let son_ids: std::collections::BTreeSet<u32> =
                            sons.iter().map(|(id, _)| *id).collect();
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
                        grandsons
                            .sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap().then(a.0.cmp(&b.0)));
                        for (gid, _) in grandsons.iter() {
                            if heir_candidates.len() >= 3 {
                                break;
                            }
                            heir_candidates.push(*gid);
                        }
                    }
                }
                let active_expedition_agents: Vec<u32> = self
                    .agents
                    .iter()
                    .filter(|a| {
                        a.is_alive
                            && a.state == PrimitiveActionState::SeekingThrone
                            && a.expedition_target_camp == Some(*camp_id)
                    })
                    .map(|a| a.id)
                    .collect();
                let member_ids: Vec<u32> = region.group.members.iter().copied().collect();
                let governed_households: Vec<u64> = self
                    .household_registry
                    .active_households
                    .iter()
                    .filter(|&&hid| {
                        self.household_registry.get(hid).is_some_and(|hh| {
                            self.region_registry.region_of(hh.head) == Some(*camp_id)
                        })
                    })
                    .copied()
                    .collect();

                w.u32(*camp_id);
                w.u32(tab.intern(camp_name.as_str()));
                w.opt_u32(region.group.leader);
                w.u32(tab.intern(&format!("{:?}", region.regime)));
                w.u32(tab.intern(&format!("{:?}", region.succession)));
                w.u32(region.group.members.len() as u32);
                let arrival: Vec<u32> = region.arrival_order.iter().take(10).copied().collect();
                w.u32_list(&arrival);
                w.u32_list(&heir_candidates);
                Self::write_balances(&mut w, &region.group.ledger);
                Self::write_journal(&mut w, &region.group.ledger, &mut *tab);
                Self::write_events(&mut w, &region.group.ledger, &mut *tab);
                w.u32_list(&active_expedition_agents);
                w.u16(region.history_kings.len() as u16);
                for hk in &region.history_kings {
                    w.u32(hk.agent_id);
                    w.u64(hk.reign_start_tick);
                    w.u64(hk.reign_end_tick);
                    w.u32(tab.intern_opt(&hk.death_cause));
                }
                w.u32(member_ids.len() as u32);
                w.u32_list(&member_ids);
                w.u64_list(&governed_households);
                w.opt_u64(region.current_reign_start);
                w.f32(region.cumulative_royal_privy);
            }
            w.align4();
            secs.push(Sec::new(
                SectionKind::Region,
                self.region_registry.regions.len() as u32,
                w.into_inner(),
            ));
        }

        // ══════════════ EMPIRE ══════════════
        {
            let mut w = BinWriter::with_capacity(self.empire_registry.empires.len() * 512 + 64);
            for (empire_id, empire) in &self.empire_registry.empires {
                let member_camp_ids: Vec<u32> = empire.member_camps.iter().copied().collect();
                let mut king_candidates: Vec<u32> = member_camp_ids
                    .iter()
                    .filter_map(|cid| self.region_registry.get(*cid).and_then(|r| r.group.leader))
                    .collect();
                king_candidates.sort_unstable();
                let member_count: u32 = member_camp_ids
                    .iter()
                    .filter_map(|cid| self.region_registry.get(*cid))
                    .map(|r| r.group.members.len() as u32)
                    .sum();

                w.u32(*empire_id);
                w.u32(tab.intern(&format!("{:?}", empire.regime)));
                w.u32(tab.intern(&format!("{:?}", empire.head_title)));
                w.opt_u32(empire.group.leader);
                w.u32_list(&member_camp_ids);
                w.u32(member_count);
                w.u32_list(&king_candidates);
                Self::write_balances(&mut w, &empire.group.ledger);
                Self::write_journal(&mut w, &empire.group.ledger, &mut *tab);
                Self::write_events(&mut w, &empire.group.ledger, &mut *tab);
                w.opt_u64(empire.current_reign_start);
                w.f32(empire.cumulative_imperial_privy);
            }
            w.align4();
            secs.push(Sec::new(
                SectionKind::Empire,
                self.empire_registry.empires.len() as u32,
                w.into_inner(),
            ));
        }

        // ══════════════ GRANARY（公仓兜底余额） ══════════════
        {
            let mut w = BinWriter::with_capacity(32);
            Self::write_balances(&mut w, &self.public_granary);
            w.align4();
            secs.push(Sec::new(SectionKind::Granary, 1, w.into_inner()));
        }

        // ══════════════ DEATH（死亡/流产墓碑） ══════════════
        {
            let mut w = BinWriter::with_capacity(self.recent_deaths.len() * 32 + 16);
            for d in &self.recent_deaths {
                w.u32(d.id);
                w.u32(tab.intern(d.cause.as_str()));
                w.u8(d.is_natural as u8);
                w.u8(d.is_fetus as u8);
                w.opt_u32(d.father_id);
                w.opt_u32(d.mother_id);
                w.u64(d.tick);
            }
            w.align4();
            secs.push(Sec::new(
                SectionKind::Death,
                self.recent_deaths.len() as u32,
                w.into_inner(),
            ));
        }

        // ══════════════ AUCTION_HIST（房屋报价中心历史受理，从新到旧） ══════════════
        {
            let mut w = BinWriter::with_capacity(self.auction_history.len() * 48 + 16);
            for r in self.auction_history.iter().rev() {
                w.u64(r.tick);
                w.u32(r.house_id);
                w.u32(tab.intern(&format!("{:?}", r.tier)));
                w.u32(r.camp_id);
                w.f32(r.durability);
                w.u8(r.is_flop as u8);
                w.opt_u32(r.buyer_id);
                w.f32(r.price);
                w.u32(r.total_bids_count as u32);
                w.u32(tab.intern(r.reason.as_str()));
            }
            w.align4();
            secs.push(Sec::new(
                SectionKind::AuctionHist,
                self.auction_history.len() as u32,
                w.into_inner(),
            ));
        }

        // ══════════════ STR_TAB（增量字符串，必须最后写） ══════════════
        {
            let cursor = tab.sent_cursor();
            let delta_len = tab.delta_since(cursor).len();
            let mut w = BinWriter::with_capacity(256);
            w.u32(cursor);
            w.u32(delta_len as u32);
            for i in 0..delta_len {
                let s = &tab.delta_since(cursor)[i];
                let b = s.as_bytes();
                w.u32(b.len() as u32);
                w.bytes(b);
            }
            w.align4();
            if delta_len > 0 {
                flags |= flag::HAS_STR_TAB;
            }
            secs.push(Sec::new(
                SectionKind::StrTab,
                delta_len as u32,
                w.into_inner(),
            ));
            let total_len = tab.len() as u32;
            tab.mark_sent(total_len);
        }

        drop(tab);

        // ══════════════ 组装 Header + SectionDir + Sections ══════════════
        let dir_len = secs.len() * DIR_ENTRY_LEN;
        let mut body_offset = HEADER_LEN + dir_len;
        let mut dir = Vec::with_capacity(dir_len);
        let total_sections_bytes: usize = secs.iter().map(|s| s.data.len()).sum();
        out.reserve(body_offset + total_sections_bytes);

        for s in &secs {
            let mut e = Vec::with_capacity(DIR_ENTRY_LEN);
            e.extend_from_slice(&s.kind.raw().to_le_bytes());
            e.extend_from_slice(&0u16.to_le_bytes()); // pad
            e.extend_from_slice(&(body_offset as u32).to_le_bytes());
            e.extend_from_slice(&s.count.to_le_bytes());
            e.extend_from_slice(&(s.data.len() as u32).to_le_bytes());
            dir.extend_from_slice(&e);
            body_offset += s.data.len();
        }

        // Header
        out.extend_from_slice(&MAGIC);
        out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
        out.extend_from_slice(&flags.to_le_bytes());
        out.extend_from_slice(&(body_offset as u32).to_le_bytes());
        out.extend_from_slice(&self.tick_counter.to_le_bytes());
        out.extend_from_slice(&geom_sig.to_le_bytes());
        out.extend_from_slice(&self.strtab.borrow().epoch().to_le_bytes());
        out.extend_from_slice(&(secs.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // reserved
        out.extend_from_slice(&0u32.to_le_bytes()); // reserved2
                                                    // SectionDir
        out.extend_from_slice(&dir);
        // Sections
        for s in &secs {
            out.extend_from_slice(&s.data);
        }
    }

    /// 账本 5 类资源余额（固定序 Water/Food/Wood/Stone/Gold，与 JSON 的 `Vec<LedgerBalanceSnapshot>` 等价）
    fn write_balances(w: &mut BinWriter, ledger: &crate::spatial::ledger::Ledger) {
        for rk in RESOURCE_KIND_ORDER.iter() {
            w.f32(ledger.balance(*rk));
        }
    }

    /// 最近 8 条团体事件（从新到旧）
    fn write_events(
        w: &mut BinWriter,
        ledger: &crate::spatial::ledger::Ledger,
        tab: &mut super::strtab::StrTab,
    ) {
        let notes: Vec<&String> = ledger
            .events
            .iter()
            .rev()
            .take(8)
            .map(|e| &e.note)
            .collect();
        w.u16(notes.len() as u16);
        for n in notes {
            w.u32(tab.intern(n.as_str()));
        }
    }

    /// 最近 8 笔资源流水（从新到旧）
    fn write_journal(
        w: &mut BinWriter,
        ledger: &crate::spatial::ledger::Ledger,
        tab: &mut super::strtab::StrTab,
    ) {
        let recs: Vec<_> = ledger.journal.iter().rev().take(8).collect();
        w.u16(recs.len() as u16);
        for r in recs {
            w.u64(r.tick);
            w.u8(resource_kind_code(r.resource));
            w.f32(r.amount);
            w.u32(tab.intern(&format!("{:?}", r.from)));
            w.u32(tab.intern(&format!("{:?}", r.to)));
            w.u8(transfer_reason_code(r.reason));
        }
    }

    /// 枚举名称表 JSON（前端启动时取一次，杜绝前后端枚举漂移）
    pub fn enum_table_json(&self) -> String {
        enum_table_json()
    }
}
