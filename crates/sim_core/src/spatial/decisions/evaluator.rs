use super::super::vec3::Vec3;
use super::super::graph::{LaneGraph3D, NodeId};
use super::super::agent::{Agent3D, Gender, PrimitiveActionState};
use super::super::poi::PoiType;
use super::super::house::{House, HouseTier};
use super::super::world::World3DEngine;
use super::needs::*;
use crate::config::*;
use crate::rng::WorldRng;

/// 单名族人的马斯洛需求决策器 (持有全部只读上下文，逐人驱动状态机)
pub struct Decisioner<'a> {
    pub ctx: &'a DecisionContext,
    pub network: &'a LaneGraph3D,
    pub houses: &'a [House],
    pub rng: &'a mut WorldRng,
    pub config: &'a SimConfig,
}

impl<'a> Decisioner<'a> {
    pub fn node_pos(&self, node: NodeId) -> Vec3 {
        self.network.graph[*self.network.node_map.get(&node).unwrap()].pos
    }

    pub fn available_nodes(&self, agent: &Agent3D, pool: NodePool) -> Vec<NodeId> {
        pool.nodes(self.ctx).iter()
            .filter(|target| agent.poi_is_seekable(target.poi_id))
            .map(|target| target.node)
            .collect()
    }

    pub fn has_available_node(&self, agent: &Agent3D, pool: NodePool) -> bool {
        pool.nodes(self.ctx).iter().any(|target| agent.poi_is_seekable(target.poi_id))
    }

    pub fn nearest_of(&self, agent: &Agent3D, pool: NodePool, pos: Vec3) -> Option<NodeId> {
        self.available_nodes(agent, pool).into_iter().min_by(|&a, &b| {
            self.node_pos(a).distance_to(&pos)
                .partial_cmp(&self.node_pos(b).distance_to(&pos))
                .unwrap()
        })
    }

    pub fn start_node(&self, agent: &Agent3D) -> NodeId {
        self.network.graph.node_weights()
            .min_by(|a, b| a.pos.distance_to(&agent.world_pos).partial_cmp(&b.pos.distance_to(&agent.world_pos)).unwrap())
            .map(|n| n.id)
            .unwrap_or(agent.home_camp_node)
    }

    pub fn home_target(&self, agent: &Agent3D) -> NodeId {
        if agent.home_house_id.is_some() {
            agent.home_camp_node
        } else {
            self.ctx.camp_positions.iter()
                .min_by(|(_, a), (_, b)| a.distance_to(&agent.world_pos).partial_cmp(&b.distance_to(&agent.world_pos)).unwrap())
                .map(|(nid, _)| *nid)
                .unwrap_or(agent.home_camp_node)
        }
    }

    pub fn dispatch(&self, agent: &mut Agent3D, start: NodeId, target: NodeId, state: PrimitiveActionState) -> bool {
        if let Some(path) = self.network.find_path_3d_with_preference(start, target, agent.is_covert) {
            if !path.is_empty() {
                agent.state = state;
                agent.target_poi_node = Some(target);
                agent.route = path;
                agent.route_index = 0;
                agent.current_lane_id = Some(agent.route[0]);
                agent.distance_along_curve = 0.0;
                return true;
            }
        }
        false
    }

    /// 当小人中途放弃或重定向时，原地掉头沿当前车道反向往回走，保持坐标平滑无瞬移闪现
    pub fn turn_around_and_route_to(&self, agent: &mut Agent3D, target_node: NodeId, state: PrimitiveActionState) -> bool {
        if let Some(lane_id) = agent.current_lane_id {
            if let Some(&edge_idx) = self.network.edge_map.get(&lane_id) {
                let from_node = self.network.graph[edge_idx].from_node;
                let to_node = self.network.graph[edge_idx].to_node;
                let curr_dist = agent.distance_along_curve;

                let from_idx = self.network.node_map[&from_node];
                let to_idx = self.network.node_map[&to_node];
                if let Some(rev_edge_idx) = self.network.graph.find_edge(to_idx, from_idx) {
                    let rev_lane = &self.network.graph[rev_edge_idx];
                    let rev_lane_id = rev_lane.id;
                    let rev_len = rev_lane.curve.length;

                    let route = if from_node == target_node {
                        vec![rev_lane_id]
                    } else if let Some(remaining) = self.network.find_path_3d_with_preference(from_node, target_node, agent.is_covert) {
                        let mut r = Vec::with_capacity(1 + remaining.len());
                        r.push(rev_lane_id);
                        r.extend(remaining);
                        r
                    } else {
                        vec![rev_lane_id]
                    };

                    agent.state = state;
                    agent.target_poi_node = Some(target_node);
                    agent.route = route;
                    agent.route_index = 0;
                    agent.current_lane_id = Some(rev_lane_id);
                    agent.distance_along_curve = (rev_len - curr_dist).clamp(0.0, rev_len);
                    return true;
                }
            }
        }
        false
    }

    pub fn return_home(&self, agent: &mut Agent3D) {
        let target_home = self.home_target(agent);
        // 若小人正在途中移动，优先原地掉头沿原车道反向往回走，绝不瞬移
        if self.turn_around_and_route_to(agent, target_home, PrimitiveActionState::ReturningToCamp) {
            agent.home_camp_node = target_home;
            return;
        }

        let curr_node = self.start_node(agent);
        if curr_node == target_home {
            agent.state = PrimitiveActionState::RestingAtCamp;
            agent.current_velocity = 0.0;
            agent.current_lane_id = None;
            agent.home_camp_node = target_home;
            return;
        }
        if self.dispatch(agent, curr_node, target_home, PrimitiveActionState::ReturningToCamp) {
            agent.home_camp_node = target_home;
        } else {
            agent.state = PrimitiveActionState::ReturningToCamp;
            agent.home_camp_node = target_home;
        }
    }

    /// 查询本 Agent 对当前目标 POI 的私有施密特触发器结论。
    pub fn is_target_poi_unavailable(&self, agent: &Agent3D, poi_type: PoiType) -> bool {
        if let Some(target_node) = agent.target_poi_node {
            let pool = match poi_type {
                PoiType::WaterSource => NodePool::Water,
                PoiType::BerryBush => NodePool::Food,
                PoiType::WoodForest => NodePool::Wood,
                PoiType::StoneQuarry => NodePool::Stone,
                PoiType::GoldMine => NodePool::Gold,
                PoiType::Camp => return false,
            };
            if let Some(target) = pool.nodes(self.ctx).iter().find(|target| target.node == target_node) {
                return !agent.poi_is_seekable(target.poi_id);
            }
        }
        !self.has_available_node(agent, match poi_type {
            PoiType::WaterSource => NodePool::Water,
            PoiType::BerryBush => NodePool::Food,
            PoiType::WoodForest => NodePool::Wood,
            PoiType::StoneQuarry => NodePool::Stone,
            PoiType::GoldMine => NodePool::Gold,
            PoiType::Camp => return false,
        })
    }

    /// 核心决策调度
    pub fn decide(&mut self, agent: &mut Agent3D) {
        if !agent.is_alive {
            agent.current_need = None;
            return;
        }

        match agent.state {
            PrimitiveActionState::RestingAtCamp => {
                if let Some(need) = self.evaluate_needs(agent) {
                    agent.current_need = state_need_label_with_agent(need.target_state, agent, self.houses)
                        .map(|(lvl, k)| format!("{}·{}", lvl, k));
                    self.fulfill_resting_need(agent, need);
                } else {
                    agent.current_need = Some("Physiological·Rest".to_string());
                }
            }
            PrimitiveActionState::SeekingWater => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingWater, agent, self.houses)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_survival(agent, NodePool::Water, PoiType::WaterSource);
            }
            PrimitiveActionState::SeekingFood => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingFood, agent, self.houses)
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
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingGold, agent, self.houses)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_material(agent, NodePool::Gold, PoiType::GoldMine);
            }
            PrimitiveActionState::DrinkingAtWater => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::DrinkingAtWater, agent, self.houses)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_drinking(agent);
            }
            PrimitiveActionState::ForagingFood => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::ForagingFood, agent, self.houses)
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
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::MiningGold, agent, self.houses)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_mining_gold(agent);
            }
            PrimitiveActionState::ConstructingHouse => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::ConstructingHouse, agent, self.houses)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
            }
            PrimitiveActionState::RepairingHouse => {
                agent.current_need = Some("Safety·RepairHouse".to_string());
            }
            PrimitiveActionState::ReturningToCamp => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::ReturningToCamp, agent, self.houses)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
            }
            _ => {}
        }
    }

    /// 马斯洛需求层级逐层评估
    pub fn evaluate_needs(&mut self, agent: &Agent3D) -> Option<Need> {
        let thirst_urgency = if agent.is_pregnant { self.config.decision_critical_thirst } else { self.config.decision_critical_thirst * 0.8 };
        let hunger_urgency = if agent.is_pregnant { self.config.decision_critical_hunger } else { self.config.decision_critical_hunger * 0.8 };
        if agent.thirst < thirst_urgency && self.has_available_node(agent, NodePool::Water) {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::QuenchThirst, target_state: PrimitiveActionState::SeekingWater });
        }
        if agent.hunger < hunger_urgency && self.has_available_node(agent, NodePool::Food) {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::SateHunger, target_state: PrimitiveActionState::SeekingFood });
        }

        if agent.stamina < self.config.decision_rest_stamina_target {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::Rest, target_state: PrimitiveActionState::RestingAtCamp });
        }

        if let Some(house) = agent.home_house_id.and_then(|hid| self.houses.iter().find(|h| h.id == hid && !h.is_ruin)) {
            let is_house_member = house.owner_id == agent.id || house.spouse_id == Some(agent.id);
            let needs = house_stock_needs(house, self.config);

            if needs.need_repair && is_house_member {
                return Some(Need { level: MaslowLevel::Safety, kind: NeedKind::RepairHouse, target_state: PrimitiveActionState::RepairingHouse });
            }

            let female_bias = if agent.gender == Gender::Female { 0.70 } else { 0.45 };
            let family_level = if agent.spouse_id.is_some() || !agent.children_ids.is_empty() {
                MaslowLevel::Belonging
            } else {
                MaslowLevel::Safety
            };

            if needs.need_water && self.has_available_node(agent, NodePool::Water) && self.rng.gen_bool(female_bias) {
                return Some(Need { level: family_level, kind: NeedKind::StockWater, target_state: PrimitiveActionState::SeekingWater });
            }
            if needs.need_food && self.has_available_node(agent, NodePool::Food) && self.rng.gen_bool(female_bias) {
                return Some(Need { level: family_level, kind: NeedKind::StockFood, target_state: PrimitiveActionState::SeekingFood });
            }
            if needs.need_wood && self.has_available_node(agent, NodePool::Wood) {
                return Some(Need { level: family_level, kind: NeedKind::StockWood, target_state: PrimitiveActionState::SeekingWood });
            }

            if house.tier == HouseTier::Tier0Warehouse && house.is_pantry_full(self.config) && is_house_member && agent.gender == Gender::Male && agent.age >= self.config.agent_adult_age {
                return Some(Need { level: MaslowLevel::Belonging, kind: NeedKind::BuildHouse, target_state: PrimitiveActionState::ConstructingHouse });
            }

            if needs.need_stone && self.has_available_node(agent, NodePool::Stone) {
                return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::StockStone, target_state: PrimitiveActionState::SeekingStone });
            }

            if needs.need_gold && self.has_available_node(agent, NodePool::Gold) && agent.gold_mining_cooldown <= 0.0 {
                return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::StockGold, target_state: PrimitiveActionState::SeekingGold });
            }

            if house.is_pantry_full(self.config) && house.tier != HouseTier::Tier4Manor && is_house_member && agent.gender == Gender::Male && agent.age >= self.config.agent_adult_age {
                return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::BuildHouse, target_state: PrimitiveActionState::ConstructingHouse });
            }

            if house.tier != HouseTier::Tier4Manor
                || needs.need_repair
                || needs.need_wood
                || needs.need_stone
                || needs.need_gold
                || needs.need_water
                || needs.need_food
                || house.is_pantry_full(self.config)
            {
                return None;
            }
        } else {
            return None;
        }

        if agent.hunger < self.config.decision_critical_hunger && self.has_available_node(agent, NodePool::Food) && self.rng.gen_bool(self.config.decision_forage_surplus_chance * 0.5) {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::ForageSurplus, target_state: PrimitiveActionState::SeekingFood });
        }

        if self.has_available_node(agent, NodePool::Gold) && agent.gold_mining_cooldown <= 0.0 && self.rng.gen_bool(0.40) {
            return Some(Need { level: MaslowLevel::SelfActualization, kind: NeedKind::GoldWealth, target_state: PrimitiveActionState::SeekingGold });
        }
        None
    }

    pub fn fulfill_resting_need(&mut self, agent: &mut Agent3D, need: Need) {
        if need.kind == NeedKind::Rest { return; }
        if need.kind == NeedKind::RepairHouse {
            agent.state = PrimitiveActionState::RepairingHouse;
            return;
        }
        if need.kind == NeedKind::BuildHouse {
            agent.state = PrimitiveActionState::ConstructingHouse;
            agent.build_timer = 0.0;
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
            NeedKind::ForageSurplus => {
                let nodes = self.available_nodes(agent, NodePool::Food);
                if nodes.is_empty() { return; }
                Some(nodes[self.rng.gen_range_usize(0, nodes.len())])
            }
            NeedKind::Rest | NeedKind::RepairHouse | NeedKind::BuildHouse => None,
        };
        if let Some(target) = target {
            self.dispatch(agent, start, target, need.target_state);
        }
    }

    pub fn decide_drinking(&mut self, agent: &mut Agent3D) {
        let can_stock = agent.home_house_id.is_some();
        let house_water_full = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_water >= (h.max_pantry_water * 0.98))
            .unwrap_or(true);
        let self_satisfied = agent.thirst >= 49.9;
        let carry_full = can_stock && agent.carried_water >= self.config.carry_capacity_resource;
        let unavailable = self.is_target_poi_unavailable(agent, PoiType::WaterSource);

        let needs_more_water = !self_satisfied || (can_stock && !house_water_full && !carry_full);
        if unavailable && needs_more_water && agent.stamina >= 50.0 {
            if let Some(next_target) = self.nearest_of(agent, NodePool::Water, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, next_target, PrimitiveActionState::SeekingWater) {
                    return;
                }
            }
        }

        let finished = (self_satisfied && (!can_stock || house_water_full)) || carry_full || unavailable;

        if finished {
            if agent.hunger < self.config.decision_critical_hunger && self.has_available_node(agent, NodePool::Food) {
                let nodes = self.available_nodes(agent, NodePool::Food);
                let target = nodes[self.rng.gen_range_usize(0, nodes.len())];
                let curr_node = self.start_node(agent);
                agent.current_need = Some("Physiological·SateHunger".to_string());
                self.dispatch(agent, curr_node, target, PrimitiveActionState::SeekingFood);
            } else {
                agent.current_need = Some(if agent.stamina < 50.0 { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
                self.return_home(agent);
            }
        }
    }

    pub fn decide_foraging(&mut self, agent: &mut Agent3D) {
        let can_stock = agent.home_house_id.is_some();
        let house_food_full = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_food >= (h.max_pantry_food * 0.98))
            .unwrap_or(true);
        let self_satisfied = agent.hunger >= 49.9;
        let carry_full = can_stock && agent.carried_food >= self.config.carry_capacity_resource;
        let unavailable = self.is_target_poi_unavailable(agent, PoiType::BerryBush);

        let needs_more_food = !self_satisfied || (can_stock && !house_food_full && !carry_full);
        if unavailable && needs_more_food && agent.stamina >= 50.0 {
            if let Some(next_target) = self.nearest_of(agent, NodePool::Food, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, next_target, PrimitiveActionState::SeekingFood) {
                    return;
                }
            }
        }

        let finished = (self_satisfied && (!can_stock || house_food_full)) || carry_full || unavailable;

        if finished {
            if agent.thirst < self.config.decision_critical_thirst && self.has_available_node(agent, NodePool::Water) {
                let nodes = self.available_nodes(agent, NodePool::Water);
                let target = nodes[self.rng.gen_range_usize(0, nodes.len())];
                let curr_node = self.start_node(agent);
                agent.current_need = Some("Physiological·QuenchThirst".to_string());
                self.dispatch(agent, curr_node, target, PrimitiveActionState::SeekingWater);
            } else {
                agent.current_need = Some(if agent.stamina < 50.0 { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
                self.return_home(agent);
            }
        }
    }

    pub fn decide_harvest(&mut self, agent: &mut Agent3D, poi_type: PoiType, fully_stocked: bool) {
        let (pool, state, carry_full) = match poi_type {
            PoiType::WoodForest => (NodePool::Wood, PrimitiveActionState::SeekingWood, agent.carried_wood >= self.config.carry_capacity_resource),
            PoiType::StoneQuarry => (NodePool::Stone, PrimitiveActionState::SeekingStone, agent.carried_stone >= self.config.carry_capacity_resource),
            _ => (NodePool::Wood, PrimitiveActionState::SeekingWood, false),
        };
        let unavailable = self.is_target_poi_unavailable(agent, poi_type);

        if unavailable && !fully_stocked && !carry_full && agent.hunger >= self.config.decision_critical_hunger && agent.thirst >= self.config.decision_critical_thirst && agent.stamina >= 50.0 {
            if let Some(next_target) = self.nearest_of(agent, pool, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, next_target, state) {
                    return;
                }
            }
        }

        if unavailable || fully_stocked || carry_full || agent.hunger < self.config.decision_critical_hunger || agent.thirst < self.config.decision_critical_thirst || agent.stamina < 50.0 {
            agent.current_need = Some(if agent.stamina < 50.0 { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
            self.return_home(agent);
        }
    }

    pub fn decide_mining_gold(&mut self, agent: &mut Agent3D) {
        let is_building_stock = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.tier == HouseTier::Tier3Homestead && h.pantry_gold < h.max_pantry_gold)
            .unwrap_or(false);
        let gold_load_full = agent.carried_gold >= self.config.agent_gold_load_full;
        let house_gold_full = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_gold >= (h.max_pantry_gold * 0.98))
            .unwrap_or(false);
        let unavailable = self.is_target_poi_unavailable(agent, PoiType::GoldMine);

        if unavailable && !gold_load_full && !(is_building_stock && house_gold_full) && agent.hunger >= self.config.decision_critical_hunger && agent.thirst >= self.config.decision_critical_thirst && agent.stamina >= 50.0 {
            if let Some(next_target) = self.nearest_of(agent, NodePool::Gold, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, next_target, PrimitiveActionState::SeekingGold) {
                    return;
                }
            }
        }

        if gold_load_full
            || (is_building_stock && house_gold_full)
            || unavailable
            || agent.hunger < self.config.decision_critical_hunger
            || agent.thirst < self.config.decision_critical_thirst
            || agent.stamina < 50.0
        {
            agent.gold_mining_cooldown = if is_building_stock { self.config.decision_stock_gold_cooldown } else { self.config.decision_gold_wealth_cooldown };
            agent.current_need = Some(if agent.stamina < 50.0 { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
            self.return_home(agent);
        }
    }

    /// 建材途中转向与可用性检查（目标 POI 被施密特触发器关闭时就近重路由或放弃）
    pub fn decide_seeking_material(&mut self, agent: &mut Agent3D, pool: NodePool, poi_type: PoiType) {
        let target_unavailable = self.is_target_poi_unavailable(agent, poi_type);
        let gold_interrupted = pool == NodePool::Gold && (!self.has_available_node(agent, NodePool::Gold) || target_unavailable);

        if agent.stamina < 50.0 || gold_interrupted {
            if gold_interrupted {
                let is_building_stock = agent.home_house_id
                    .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                    .map(|h| h.tier == HouseTier::Tier3Homestead && h.pantry_gold < h.max_pantry_gold)
                    .unwrap_or(false);
                agent.gold_mining_cooldown = if is_building_stock { self.config.decision_stock_gold_cooldown } else { self.config.decision_gold_wealth_cooldown };
            }
            agent.current_need = Some(if agent.stamina < 50.0 { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
            self.return_home(agent);
            return;
        }

        if !self.has_available_node(agent, pool) || target_unavailable {
            if let Some(new_target) = self.nearest_of(agent, pool, agent.world_pos) {
                if Some(new_target) != agent.target_poi_node {
                    let state = match poi_type {
                        PoiType::WoodForest => PrimitiveActionState::SeekingWood,
                        PoiType::StoneQuarry => PrimitiveActionState::SeekingStone,
                        PoiType::GoldMine => PrimitiveActionState::SeekingGold,
                        _ => PrimitiveActionState::ReturningToCamp,
                    };
                    if self.turn_around_and_route_to(agent, new_target, state) {
                        return;
                    }
                    let curr_node = self.start_node(agent);
                    if self.dispatch(agent, curr_node, new_target, state) {
                        return;
                    }
                }
            }
            agent.current_need = Some("Safety·ReturnHome".to_string());
            self.return_home(agent);
        }
    }

    /// 生存资源途中可用性检查（目标 POI 被施密特触发器关闭时就近重路由或放弃）
    pub fn decide_seeking_survival(&mut self, agent: &mut Agent3D, pool: NodePool, poi_type: PoiType) {
        let target_unavailable = self.is_target_poi_unavailable(agent, poi_type);

        if agent.stamina < 50.0 {
            agent.current_need = Some("Physiological·Rest".to_string());
            self.return_home(agent);
            return;
        }

        if !self.has_available_node(agent, pool) || target_unavailable {
            if let Some(new_target) = self.nearest_of(agent, pool, agent.world_pos) {
                if Some(new_target) != agent.target_poi_node {
                    let state = match poi_type {
                        PoiType::WaterSource => PrimitiveActionState::SeekingWater,
                        PoiType::BerryBush => PrimitiveActionState::SeekingFood,
                        _ => PrimitiveActionState::ReturningToCamp,
                    };
                    if self.turn_around_and_route_to(agent, new_target, state) {
                        return;
                    }
                    let curr_node = self.start_node(agent);
                    if self.dispatch(agent, curr_node, new_target, state) {
                        return;
                    }
                }
            }
            agent.current_need = Some("Safety·ReturnHome".to_string());
            self.return_home(agent);
        }
    }

    pub fn wood_fully_stocked(&self, agent: &Agent3D) -> bool {
        agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_wood >= (h.max_pantry_wood * 0.98))
            .unwrap_or(true)
    }

    pub fn stone_fully_stocked(&self, agent: &Agent3D) -> bool {
        agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_stone >= (h.max_pantry_stone * 0.98))
            .unwrap_or(true)
    }
}

impl World3DEngine {
    /// 错峰决策调度: 每 tick 调用一次；每个 agent 仅在 (tick + id) % AGENT_DECISION_INTERVAL_TICKS 的相位上决策
    pub fn tick_decisions(&mut self) {
        let ctx = self.build_decision_context();
        let poi_stock_observations: Vec<_> = self.pois.iter()
            .filter(|poi| poi.poi_type != PoiType::Camp)
            .map(|poi| (poi.id, poi.current_stock, poi.max_stock))
            .collect();
        let mut decisioner = Decisioner {
            ctx: &ctx,
            network: &self.network,
            houses: &self.houses,
            rng: &mut self.rng,
            config: &self.config,
        };
        for agent in &mut self.agents {
            if agent.is_alive && (self.tick_counter + agent.id as u64) % self.config.agent_decision_interval_ticks == 0 {
                for &(poi_id, current_stock, max_stock) in &poi_stock_observations {
                    agent.observe_poi_stock_with_config(poi_id, current_stock, max_stock, &self.config);
                }
                decisioner.decide(agent);
            }
        }
    }

    /// 收集全图资源节点与营地坐标；每名 Agent 会用自己的触发器过滤候选。
    pub fn build_decision_context(&self) -> DecisionContext {
        let mut water_nodes = Vec::new();
        let mut food_nodes = Vec::new();
        let mut wood_nodes = Vec::new();
        let mut stone_nodes = Vec::new();
        let mut gold_nodes = Vec::new();
        let mut camp_positions = Vec::new();

        for poi in &self.pois {
            let Some(node) = self.find_nearest_node(poi.pos) else { continue };
            let target = ResourceNode { poi_id: poi.id, node };
            match poi.poi_type {
                PoiType::WaterSource => water_nodes.push(target),
                PoiType::BerryBush => food_nodes.push(target),
                PoiType::WoodForest => wood_nodes.push(target),
                PoiType::StoneQuarry => stone_nodes.push(target),
                PoiType::GoldMine => gold_nodes.push(target),
                PoiType::Camp => camp_positions.push((node, poi.pos)),
            }
        }

        DecisionContext {
            water_nodes,
            food_nodes,
            wood_nodes,
            stone_nodes,
            gold_nodes,
            camp_positions,
        }
    }
}
