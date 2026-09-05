use super::super::vec3::Vec3;
use super::super::graph::{LaneGraph3D, NodeId};
use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::poi::PoiType;
use super::super::house::{House, HouseTier};
use super::super::ledger::family::HouseholdRegistry;
use super::super::ledger::region::RegionRegistry;
use super::super::ledger::journal::ResourceKind;
use super::branches::{self, BranchId};
use super::needs::*;
use crate::config::*;
use crate::rng::WorldRng;

/// 单名族人的马斯洛需求决策器 (持有全部只读上下文，逐人驱动状态机)
pub struct Decisioner<'a> {
    pub ctx: &'a DecisionContext,
    pub network: &'a LaneGraph3D,
    pub houses: &'a [House],
    /// ★ M6 账本化：家户登记簿只读引用（家庭物资唯一真相源 = 家户账本余额）
    pub households: &'a HouseholdRegistry,
    /// ★ M4 地区与王国登记簿只读引用（夺位远征资格 / 国王立宅约束 / 登基判定）
    pub regions: &'a RegionRegistry,
    pub rng: &'a mut WorldRng,
    pub config: &'a SimConfig,
    /// 本拍使用的分支评估顺序（由 config.decision_eval_order 解析，见 branches.rs）
    pub branch_order: &'a [BranchId; 18],
    /// ★ v1.26.0 当前世界 tick（用于竞拍冷却判定，见 B17BidHouse）
    pub tick: u64,
}

impl<'a> Decisioner<'a> {
    /// ★ 求偶目标检索：按魅力最高优先；魅力相同时距离最近优先；再以 ID 确定性打破并列
    pub fn best_courtship_target(&self, agent: &Agent3D) -> Option<&EligibleFemale> {
        self.ctx.eligible_females.iter().min_by(|a, b| {
            // 1. 魅力 libido 降序（最高优先）
            b.libido.partial_cmp(&a.libido).unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    // 2. 距离当前 agent 空间位置升序（最近优先）
                    let dist_a = a.pos.distance_to(&agent.world_pos);
                    let dist_b = b.pos.distance_to(&agent.world_pos);
                    dist_a.partial_cmp(&dist_b).unwrap_or(std::cmp::Ordering::Equal)
                })
                // 3. ID 升序
                .then_with(|| a.id.cmp(&b.id))
        })
    }

    /// ★ M6 账本化：读取 agent 所属家户账本的品类余额（无家户返回 0.0）
    pub fn ledger_balance(&self, agent: &Agent3D, kind: ResourceKind) -> f32 {
        ledger_balance_of(self.households, agent, kind)
    }

    /// ★ M7 每拍刷新五类家庭库存施密特触发器（输入 = 家户账本余额；滞回，不耗 RNG）。
    /// 在 `decide()` 开头统一调用一次，保证本拍内各分支读取到一致状态。
    pub fn refresh_family_stock(&mut self, agent: &mut Agent3D) {
        let on = self.config.decision_family_stock_trigger_on;
        let off = self.config.decision_family_stock_trigger_off;
        for (i, &rk) in FAMILY_STOCK_ORDER.iter().enumerate() {
            let bal = self.ledger_balance(agent, rk);
            agent.family_stock_active[i] = family_stock_update(agent.family_stock_active[i], bal, on, off);
        }
    }

    /// 核心决策调度
    pub fn decide(&mut self, agent: &mut Agent3D) {
        if !agent.is_alive {
            agent.current_need = None;
            return;
        }
        // ★ M7 先刷新家庭库存触发器（若该 agent 无家户/无房，分支层 guard 短路，不影响行为）
        self.refresh_family_stock(agent);

        match agent.state {
            PrimitiveActionState::RestingAtCamp => {
                // ecology.rs 在本阶段按速率卸货；卸完前禁止重新评估采集/远征需求，
                // 否则决策节拍可能在半卸货时把 agent 再次派出，造成“送货未完就出门”。
                if agent.has_cargo_to_unload() {
                    agent.current_need = Some("Safety·UnloadCargo".to_string());
                    return;
                }
                if let Some(need) = self.evaluate_needs(agent) {
                    agent.current_need = state_need_label_with_agent(need.target_state, agent, self.houses, self.households, self.config)
                        .map(|(lvl, k)| format!("{}·{}", lvl, k));
                    self.fulfill_resting_need(agent, need);
                } else {
                    agent.current_need = Some("Physiological·Rest".to_string());
                }
            }
            PrimitiveActionState::SeekingWater => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingWater, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_survival(agent, NodePool::Water, PoiType::WaterSource);
            }
            PrimitiveActionState::SeekingFood => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingFood, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_survival(agent, NodePool::Food, PoiType::BerryBush);
            }
            PrimitiveActionState::SeekingWood => {
                agent.current_need = Some("Safety·StockWood".to_string());
                self.decide_seeking_material(agent, NodePool::Wood, PoiType::WoodForest);
            }
            PrimitiveActionState::SeekingStone => {
                agent.current_need = Some("Esteem·StockStone".to_string());
                self.decide_seeking_material(agent, NodePool::Stone, PoiType::StoneQuarry);
            }
            PrimitiveActionState::SeekingGold => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingGold, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_material(agent, NodePool::Gold, PoiType::GoldMine);
            }
            PrimitiveActionState::SeekingThrone => {
                agent.current_need = Some("Physiological·SeekThrone".to_string());
                self.decide_seeking_throne(agent);
            }
            PrimitiveActionState::DrinkingAtWater => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::DrinkingAtWater, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_drinking(agent);
            }
            PrimitiveActionState::ForagingFood => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::ForagingFood, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_foraging(agent);
            }
            PrimitiveActionState::GatheringWood => {
                agent.current_need = Some("Safety·StockWood".to_string());
                let stocked = self.wood_fully_stocked(agent);
                self.decide_harvest(agent, PoiType::WoodForest, stocked);
            }
            PrimitiveActionState::MiningStone => {
                agent.current_need = Some("Esteem·StockStone".to_string());
                let stocked = self.stone_fully_stocked(agent);
                self.decide_harvest(agent, PoiType::StoneQuarry, stocked);
            }
            PrimitiveActionState::MiningGold => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::MiningGold, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_mining_gold(agent);
            }
            PrimitiveActionState::ConstructingHouse => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::ConstructingHouse, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
            }
            PrimitiveActionState::RepairingHouse => {
                agent.current_need = Some("Safety·RepairHouse".to_string());
            }
            PrimitiveActionState::ReturningToCamp => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::ReturningToCamp, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
            }
            PrimitiveActionState::SeekingMarket => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingMarket, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_market(agent);
            }
            PrimitiveActionState::BuyingAtMarket => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::BuyingAtMarket, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_buying_market(agent);
            }
            PrimitiveActionState::SeekingCourtship => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingCourtship, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_courtship(agent);
            }
            PrimitiveActionState::RaiseChild => {
                agent.current_need = Some("Esteem·RaiseChild".to_string());
                // 行动在世界结算阶段完成；下一决策拍重新评估。
                agent.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
            }
            _ => {}
        }
    }

    /// 马斯洛需求逐条评估（数据驱动）：
    /// 按注入的分支顺序迭代 branches.rs 注册表，首个命中即返回；
    /// 命中后套用 decision_eval_levels 层级覆盖（0/缺失 = 保留分支自带的代码动态默认）。
    /// 顺序的唯一真相源在前端配置文件，空/非法注入已由 resolve_order 回退为中性声明序。
    pub fn evaluate_needs(&mut self, agent: &Agent3D) -> Option<Need> {
        for branch in self.branch_order.iter() {
            if let Some(mut need) = branch.evaluate(self, agent) {
                if let Some(lv) = branches::level_override_for(self.config, *branch) {
                    need.level = lv;
                }
                return Some(need);
            }
        }
        None
    }

    pub fn fulfill_resting_need(&mut self, agent: &mut Agent3D, need: Need) {
        if need.kind == NeedKind::Rest { return; }
        if need.kind == NeedKind::RaiseChild {
            agent.raise_child_pending = true;
            // 受孕意图需夫妻回到户主住宅后才执行；户主先返回自宅。
            if let Some(target) = agent.home_house_id
                .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                .map(|h| h.door_node_id)
            {
                let start = self.start_node(agent);
                let at_home = agent.current_lane_id.is_none()
                    && self.network.graph.node_weight(*self.network.node_map.get(&target).unwrap())
                        .map(|n| agent.world_pos.distance_to(&n.pos) <= self.config.poi_interaction_radius)
                        .unwrap_or(false);
                if !at_home && self.dispatch(agent, start, target, PrimitiveActionState::RaiseChild) {
                    agent.current_need = Some("Esteem·RaiseChild·ReturningHome".to_string());
                    return;
                }
            }
            agent.enter_stationary_state(PrimitiveActionState::RaiseChild);
            agent.current_need = Some("Esteem·RaiseChild".to_string());
            return;
        }
        if need.kind == NeedKind::BidHouse {
            // ★ v1.26.0 竞购现房：随机挑一套在售空置房屋写 pending（消耗共享 RNG，确定性），
            // 不改变运动状态——只下决心，交割由世界执行器 execute_pending_bids 落地。
            let own_tier = agent.home_house_id
                .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                .map(|h| h.tier)
                .unwrap_or(HouseTier::Tier0Warehouse);
            let mut candidates: Vec<(u32, HouseTier, f32)> = self
                .houses
                .iter()
                .filter(|h| h.owner_id.is_none() && h.auction_state.is_some() && (agent.home_house_id.is_none() || h.tier > own_tier))
                .map(|h| (h.id, h.tier, house_upgrade_cost_price(own_tier, h.tier, self.config)))
                .collect();
            if candidates.is_empty() {
                agent.current_need = None;
                return;
            }
            candidates.sort_by(|a, b| (b.1 as u8).cmp(&(a.1 as u8)).then_with(|| a.0.cmp(&b.0)));
            let (house_id, _tier, price) = candidates[0];
            if price < self.config.house_auction_min_bid_gold || ledger_balance_of(self.households, agent, ResourceKind::Gold) < price {
                agent.current_need = None;
                return;
            }
            agent.pending_bid_house_id = Some(house_id);
            agent.pending_bid_price = Some(price);
            agent.pending_bid_upgrade = agent.home_house_id.is_some();
            agent.current_need = Some("Safety·BidHouse".to_string());
            return;
        }
        if need.kind == NeedKind::RepairHouse {
            agent.enter_stationary_state(PrimitiveActionState::RepairingHouse);
            return;
        }
        if need.kind == NeedKind::BuildHouse {
            // 升级施工必须在自宅门口执行；未到家先沿路网返回，抵达后由 construction 结算。
            let target = agent.home_house_id
                .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                .map(|h| h.door_node_id);
            if let Some(target) = target {
                let start = self.start_node(agent);
                let at_home = agent.current_lane_id.is_none()
                    && self.network.graph.node_weight(*self.network.node_map.get(&target).unwrap())
                        .map(|n| agent.world_pos.distance_to(&n.pos) <= self.config.poi_interaction_radius)
                        .unwrap_or(false);
                if !at_home && self.dispatch(agent, start, target, PrimitiveActionState::ConstructingHouse) {
                    agent.current_need = Some("Esteem·BuildHouse·ReturningHome".to_string());
                    return;
                }
            }
            agent.enter_stationary_state(PrimitiveActionState::ConstructingHouse);
            agent.build_timer = 0.0;
            return;
        }
        if need.kind == NeedKind::FoundHome {
            // ★ M4 无房国王立宅约束：只能盖在自己的王国（营地）附近（复用 poiMinDistance）
            let king_camp_pos = self.king_camp_of(agent)
                .and_then(|kcid| self.ctx.camp_pois.iter().find(|(id, _)| *id == kcid))
                .map(|(_, p)| *p);
            // 系统仅在实体化阶段执行放置校验与路网接入（见 materialize_founded_houses）。
            for _ in 0..self.config.decision_found_home_candidates {
                let angle = self.rng.gen_range(0.0, std::f32::consts::TAU);
                let dist = self.rng.gen_range(self.config.decision_found_home_dist_min, self.config.decision_found_home_dist_max);
                let cand = Vec3::new(
                    agent.world_pos.x + angle.cos() * dist,
                    agent.world_pos.y + angle.sin() * dist,
                    agent.world_pos.z,
                );
                let mut is_valid = self.houses.iter().all(|h| {
                    let dx = h.pos.x - cand.x;
                    let dy = h.pos.y - cand.y;
                    (dx * dx + dy * dy).sqrt() >= self.config.house_min_spacing
                });
                // 国王宅址必须落在自己王国营地 poi_min_distance 以内（挂靠自己的王国）
                if is_valid {
                    if let Some(cp) = king_camp_pos {
                        let dx = cp.x - cand.x;
                        let dy = cp.y - cand.y;
                        if (dx * dx + dy * dy).sqrt() > self.config.poi_min_distance {
                            is_valid = false;
                        }
                    }
                }
                if is_valid {
                    agent.pending_house_pos = Some(cand);
                    agent.current_need = Some("Physiological·FoundHome".to_string());
                    // 先沿路网走到候选宅址附近，抵达后 settlement 才实体化房屋。
                    if let Some((target, _)) = self.network.graph.node_weights()
                        .map(|n| (n.id, n.pos))
                        .min_by(|(_, a), (_, b)| a.distance_to(&cand).partial_cmp(&b.distance_to(&cand)).unwrap()) {
                        let start = self.start_node(agent);
                        let _ = self.dispatch(agent, start, target, PrimitiveActionState::RestingAtCamp);
                    }
                    return;
                }
            }
            agent.current_need = Some("Physiological·FoundHome".to_string());
            return;
        }
        if need.kind == NeedKind::SeekThrone {
            // ★ M4 夺位远征：目标 = 最近的可夺位营地（资格规则与分支守卫一致）
            let home_camp_id = agent.home_house_id
                .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                .map(|h| h.camp_id);
            let Some(camp_id) = self.eligible_leaderless_camp(agent, home_camp_id.is_some(), home_camp_id) else {
                agent.current_need = None;
                return;
            };
            let Some(target_node) = self.camp_node_of(camp_id) else {
                agent.current_need = None;
                return;
            };
            let start = self.start_node(agent);
            agent.expedition_target_camp = Some(camp_id);
            agent.current_need = Some("Physiological·SeekThrone".to_string());
            self.dispatch(agent, start, target_node, PrimitiveActionState::SeekingThrone);
            return;
        }
        if need.kind == NeedKind::MarketTrade {
            let Some(target) = self.nearest_market_node(agent) else {
                agent.current_need = None;
                return;
            };
            let start = self.start_node(agent);
            agent.current_need = Some("Physiological·MarketTrade".to_string());
            self.dispatch(agent, start, target, PrimitiveActionState::SeekingMarket);
            return;
        }
        if need.kind == NeedKind::Courtship {
            let Some(target) = self.best_courtship_target(agent).copied() else {
                agent.current_need = None;
                return;
            };
            agent.courtship_target_id = Some(target.id);
            agent.current_need = Some("Belonging·Courtship".to_string());
            if agent.world_pos.distance_to(&target.pos) <= self.config.poi_interaction_radius {
                agent.courtship_pending = Some(target.id);
            } else {
                let start = self.start_node(agent);
                self.dispatch(agent, start, target.nearest_node, PrimitiveActionState::SeekingCourtship);
            }
            return;
        }
        if need.kind == NeedKind::StockGold {
            agent.gold_mining_cooldown = self.config.decision_stock_gold_cooldown;
        } else if need.kind == NeedKind::GoldWealth {
            agent.gold_mining_cooldown = self.config.decision_gold_wealth_cooldown;
        }

        let start = self.start_node(agent);
        let target = match need.kind {
            NeedKind::QuenchThirst | NeedKind::StockWater => self.nearest_of(agent, NodePool::Water, agent.world_pos),
            NeedKind::SateHunger | NeedKind::StockFood => self.nearest_of(agent, NodePool::Food, agent.world_pos),
            NeedKind::StockWood => self.nearest_of(agent, NodePool::Wood, agent.world_pos),
            NeedKind::StockStone => self.nearest_of(agent, NodePool::Stone, agent.world_pos),
            NeedKind::StockGold | NeedKind::GoldWealth => self.nearest_of(agent, NodePool::Gold, agent.world_pos),
            NeedKind::Rest | NeedKind::RepairHouse | NeedKind::BuildHouse | NeedKind::FoundHome | NeedKind::SeekThrone | NeedKind::MarketTrade | NeedKind::Courtship | NeedKind::BidHouse | NeedKind::RaiseChild => None,
        };
        if let Some(target) = target {
            self.dispatch(agent, start, target, need.target_state);
        }
    }

    // ══════════════════════════════════════════════════════════
    // ★ M4 夺位远征 / 国王立宅 · 决策辅助
    // ══════════════════════════════════════════════════════════

    /// 本 agent 是否已是一地之王
    pub fn is_king(&self, agent: &Agent3D) -> bool {
        self.regions.regions.iter().any(|(_, r)| r.group.leader == Some(agent.id))
    }

    /// ★ v1.10.0 是否存在未满（< camp_max_houses）的营地（B12FoundHome 预检用）
    pub fn has_nonfull_camp(&self) -> bool {
        let max = self.config.camp_max_houses as usize;
        self.ctx.camp_pois.iter().any(|(cid, _)| {
            self.houses.iter().filter(|h| h.camp_id == *cid).count() < max
        })
    }

    /// 本 agent 若为王，返回其王国的营地 ID
    pub fn king_camp_of(&self, agent: &Agent3D) -> Option<u32> {
        self.regions.regions.iter()
            .find(|(_, r)| r.group.leader == Some(agent.id))
            .map(|(cid, _)| *cid)
    }

    /// 判定夺位远征资格并返回最近的可夺位营地。
    /// has_house=true 时仅自家营地王位空缺才可夺；无房（含废墟）则可夺任意空缺王位营地。
    pub fn eligible_leaderless_camp(&self, agent: &Agent3D, has_house: bool, home_camp_id: Option<u32>) -> Option<u32> {
        let mut best: Option<(u32, f32)> = None;
        for (cid, region) in &self.regions.regions {
            if region.group.leader.is_some() {
                continue; // 王位未空缺
            }
            if has_house && Some(*cid) != home_camp_id {
                continue; // 有房者只能夺自家营地王位
            }
            let Some(pos) = self.ctx.camp_pois.iter().find(|(id, _)| *id == *cid).map(|(_, p)| *p) else {
                continue;
            };
            let dist = agent.world_pos.distance_to(&pos);
            if best.map(|(_, bd)| dist < bd).unwrap_or(true) {
                best = Some((*cid, dist));
            }
        }
        best.map(|(id, _)| id)
    }

    /// 营地 ID → 最近路网节点（夺位远征目标节点）
    pub fn camp_node_of(&self, camp_id: u32) -> Option<NodeId> {
        let pos = self.ctx.camp_pois.iter().find(|(id, _)| *id == camp_id).map(|(_, p)| *p)?;
        self.ctx.camp_positions.iter()
            .min_by(|a, b| a.1.distance_to(&pos).partial_cmp(&b.1.distance_to(&pos)).unwrap())
            .map(|(n, _)| *n)
    }
}
