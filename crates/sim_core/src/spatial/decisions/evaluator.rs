use super::super::vec3::Vec3;
use super::super::graph::{LaneGraph3D, NodeId};
use super::super::agent::{Agent3D, Gender, PrimitiveActionState, CARRY_CAPACITY_RESOURCE};
use super::super::poi::{PrimitivePoi, PoiType};
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
    pub pois: &'a [PrimitivePoi],
    pub rng: &'a mut WorldRng,
}

impl<'a> Decisioner<'a> {
    pub fn node_pos(&self, node: NodeId) -> Vec3 {
        self.network.graph[*self.network.node_map.get(&node).unwrap()].pos
    }

    pub fn nearest_of(&self, pool: NodePool, pos: Vec3) -> Option<NodeId> {
        pool.nodes(self.ctx).iter().copied().min_by(|&a, &b| {
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

    pub fn source_empty(&self, poi_type: PoiType, pos: Vec3) -> bool {
        self.pois.iter()
            .find(|p| p.poi_type == poi_type && p.pos.distance_to(&pos) < 22.0)
            .map(|p| p.current_stock <= 0.05)
            .unwrap_or(true)
    }

    /// 检查 Agent 正在赶往的目标 POI 是否已跌破 10% 储量 (若跌破则中途直接放弃)
    pub fn is_target_poi_depleted_below_10(&self, agent: &Agent3D, poi_type: PoiType) -> bool {
        if let Some(target_node) = agent.target_poi_node {
            if let Some(&node_idx) = self.network.node_map.get(&target_node) {
                let target_pos = self.network.graph[node_idx].pos;
                if let Some(poi) = self.pois.iter().find(|p| p.poi_type == poi_type && p.pos.distance_to(&target_pos) < 30.0) {
                    return poi.current_stock < (poi.max_stock * DECISION_POI_ABANDON_STOCK_RATIO);
                }
            }
        }
        self.pois.iter()
            .filter(|p| p.poi_type == poi_type)
            .all(|p| p.current_stock < (p.max_stock * DECISION_POI_ABANDON_STOCK_RATIO))
    }

    pub fn decide(&mut self, agent: &mut Agent3D) {
        if agent.state == PrimitiveActionState::RestingAtCamp {
            self.decide_resting(agent);
            return;
        }
        if agent.current_need.is_none()
            || agent.state == PrimitiveActionState::ReturningToCamp
            || agent.state == PrimitiveActionState::ConstructingHouse
            || agent.state == PrimitiveActionState::RepairingHouse
        {
            agent.current_need = state_need_label_with_agent(agent.state, agent, self.houses).map(|(l, k)| format!("{}·{}", l, k));
        }
        match agent.state {
            PrimitiveActionState::DrinkingAtWater => self.decide_drinking(agent),
            PrimitiveActionState::ForagingFood => self.decide_foraging(agent),
            PrimitiveActionState::GatheringWood => self.decide_harvest(agent, PoiType::WoodForest, self.wood_fully_stocked(agent)),
            PrimitiveActionState::MiningStone => self.decide_harvest(agent, PoiType::StoneQuarry, self.stone_fully_stocked(agent)),
            PrimitiveActionState::MiningGold => self.decide_mining_gold(agent),
            PrimitiveActionState::SeekingWood => self.decide_seeking_material(agent, NodePool::Wood, PoiType::WoodForest),
            PrimitiveActionState::SeekingStone => self.decide_seeking_material(agent, NodePool::Stone, PoiType::StoneQuarry),
            PrimitiveActionState::SeekingGold => self.decide_seeking_material(agent, NodePool::Gold, PoiType::GoldMine),
            PrimitiveActionState::SeekingWater => self.decide_seeking_survival(agent, NodePool::Water, PoiType::WaterSource),
            PrimitiveActionState::SeekingFood => self.decide_seeking_survival(agent, NodePool::Food, PoiType::BerryBush),
            _ => {}
        }
    }

    pub fn decide_resting(&mut self, agent: &mut Agent3D) {
        let need = self.evaluate_resting_need(agent);
        agent.current_need = need.map(|n| format!("{:?}·{:?}", n.level, n.kind));
        if let Some(need) = need {
            self.fulfill_resting_need(agent, need);
        }
    }

    pub fn evaluate_resting_need(&mut self, agent: &Agent3D) -> Option<Need> {
        let thirst_urgency = if agent.is_pregnant { 24.5 } else { 20.0 };
        let hunger_urgency = if agent.is_pregnant { 24.5 } else { 20.0 };
        if agent.thirst < thirst_urgency && !self.ctx.water_nodes.is_empty() {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::QuenchThirst, target_state: PrimitiveActionState::SeekingWater });
        }
        if agent.hunger < hunger_urgency && !self.ctx.food_nodes.is_empty() {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::SateHunger, target_state: PrimitiveActionState::SeekingFood });
        }

        if agent.stamina < 100.0 {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::Rest, target_state: PrimitiveActionState::RestingAtCamp });
        }

        if let Some(house) = agent.home_house_id.and_then(|hid| self.houses.iter().find(|h| h.id == hid && !h.is_ruin)) {
            let is_house_member = house.owner_id == agent.id || house.spouse_id == Some(agent.id);
            let needs = house_stock_needs(house);

            if needs.need_repair && is_house_member {
                return Some(Need { level: MaslowLevel::Safety, kind: NeedKind::RepairHouse, target_state: PrimitiveActionState::RepairingHouse });
            }

            let female_bias = if agent.gender == Gender::Female { 0.70 } else { 0.45 };
            let family_level = if agent.spouse_id.is_some() || !agent.children_ids.is_empty() {
                MaslowLevel::Belonging
            } else {
                MaslowLevel::Safety
            };

            if needs.need_water && !self.ctx.water_nodes.is_empty() && self.rng.gen_bool(female_bias) {
                return Some(Need { level: family_level, kind: NeedKind::StockWater, target_state: PrimitiveActionState::SeekingWater });
            }
            if needs.need_food && !self.ctx.food_nodes.is_empty() && self.rng.gen_bool(female_bias) {
                return Some(Need { level: family_level, kind: NeedKind::StockFood, target_state: PrimitiveActionState::SeekingFood });
            }
            if needs.need_wood && !self.ctx.wood_nodes.is_empty() {
                return Some(Need { level: family_level, kind: NeedKind::StockWood, target_state: PrimitiveActionState::SeekingWood });
            }

            if house.tier == HouseTier::Tier0Warehouse && house.is_pantry_full() && is_house_member && agent.gender == Gender::Male && agent.age >= AGENT_ADULT_AGE {
                return Some(Need { level: MaslowLevel::Belonging, kind: NeedKind::BuildHouse, target_state: PrimitiveActionState::ConstructingHouse });
            }

            if needs.need_stone && !self.ctx.stone_nodes.is_empty() {
                return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::StockStone, target_state: PrimitiveActionState::SeekingStone });
            }

            if needs.need_gold && !self.ctx.gold_nodes.is_empty() && !self.ctx.gold_depleted && agent.gold_mining_cooldown <= 0.0 {
                return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::StockGold, target_state: PrimitiveActionState::SeekingGold });
            }

            if house.is_pantry_full() && house.tier != HouseTier::Tier4Manor && is_house_member && agent.gender == Gender::Male && agent.age >= AGENT_ADULT_AGE {
                return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::BuildHouse, target_state: PrimitiveActionState::ConstructingHouse });
            }

            if house.tier != HouseTier::Tier4Manor
                || needs.need_repair
                || needs.need_wood
                || needs.need_stone
                || needs.need_gold
                || needs.need_water
                || needs.need_food
                || house.is_pantry_full()
            {
                return None;
            }
        } else {
            return None;
        }

        if agent.hunger < 25.0 && !self.ctx.food_nodes.is_empty() && self.rng.gen_bool(0.04) {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::ForageSurplus, target_state: PrimitiveActionState::SeekingFood });
        }

        if !self.ctx.gold_nodes.is_empty() && !self.ctx.gold_depleted && agent.gold_mining_cooldown <= 0.0 && self.rng.gen_bool(0.40) {
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
            agent.gold_mining_cooldown = 45.0;
        } else if need.kind == NeedKind::GoldWealth {
            agent.gold_mining_cooldown = 180.0;
        }

        let start = self.start_node(agent);
        let target = match need.kind {
            NeedKind::QuenchThirst | NeedKind::StockWater => self.nearest_of(NodePool::Water, agent.world_pos),
            NeedKind::SateHunger | NeedKind::StockFood => self.nearest_of(NodePool::Food, agent.world_pos),
            NeedKind::StockWood => self.nearest_of(NodePool::Wood, agent.world_pos),
            NeedKind::StockStone => self.nearest_of(NodePool::Stone, agent.world_pos),
            NeedKind::StockGold | NeedKind::GoldWealth => self.nearest_of(NodePool::Gold, agent.world_pos),
            NeedKind::ForageSurplus => {
                let len = self.ctx.food_nodes.len();
                if len == 0 { return; }
                Some(self.ctx.food_nodes[self.rng.gen_range_usize(0, len)])
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
        let carry_full = can_stock && agent.carried_water >= CARRY_CAPACITY_RESOURCE;
        let empty = self.source_empty(PoiType::WaterSource, agent.world_pos);

        // 如果自身尚未喝饱 或 家宅需要且背包未满，且体力健康，当前水源枯竭时尝试前往下一处未枯竭水源
        let needs_more_water = !self_satisfied || (can_stock && !house_water_full && !carry_full);
        if empty && needs_more_water && agent.stamina >= 50.0 {
            if let Some(next_target) = self.nearest_of(NodePool::Water, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, next_target, PrimitiveActionState::SeekingWater) {
                    return;
                }
            }
        }

        let finished = (self_satisfied && (!can_stock || house_water_full)) || carry_full || empty;

        if finished {
            if agent.hunger < 25.0 && !self.ctx.food_nodes.is_empty() {
                let target = self.ctx.food_nodes[self.rng.gen_range_usize(0, self.ctx.food_nodes.len())];
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
        let carry_full = can_stock && agent.carried_food >= CARRY_CAPACITY_RESOURCE;
        let empty = self.source_empty(PoiType::BerryBush, agent.world_pos);

        // 如果自身尚未吃饱 或 家宅需要且背包未满，且体力健康，当前灌木枯竭时尝试前往下一处未枯竭食物点
        let needs_more_food = !self_satisfied || (can_stock && !house_food_full && !carry_full);
        if empty && needs_more_food && agent.stamina >= 50.0 {
            if let Some(next_target) = self.nearest_of(NodePool::Food, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, next_target, PrimitiveActionState::SeekingFood) {
                    return;
                }
            }
        }

        let finished = (self_satisfied && (!can_stock || house_food_full)) || carry_full || empty;

        if finished {
            if agent.thirst < 25.0 && !self.ctx.water_nodes.is_empty() {
                let target = self.ctx.water_nodes[self.rng.gen_range_usize(0, self.ctx.water_nodes.len())];
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
            PoiType::WoodForest => (NodePool::Wood, PrimitiveActionState::SeekingWood, agent.carried_wood >= CARRY_CAPACITY_RESOURCE),
            PoiType::StoneQuarry => (NodePool::Stone, PrimitiveActionState::SeekingStone, agent.carried_stone >= CARRY_CAPACITY_RESOURCE),
            _ => (NodePool::Wood, PrimitiveActionState::SeekingWood, false),
        };
        let empty = self.source_empty(poi_type, agent.world_pos);

        // 如果当前采集点枯竭，但背包未满、家宅未满且体力和水粮健康，尝试就近前往下一个该类资源点
        if empty && !fully_stocked && !carry_full && agent.hunger >= 25.0 && agent.thirst >= 25.0 && agent.stamina >= 50.0 {
            if let Some(next_target) = self.nearest_of(pool, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, next_target, state) {
                    return;
                }
            }
        }

        if empty || fully_stocked || carry_full || agent.hunger < 25.0 || agent.thirst < 25.0 || agent.stamina < 50.0 {
            agent.current_need = Some(if agent.stamina < 50.0 { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
            self.return_home(agent);
        }
    }

    pub fn decide_mining_gold(&mut self, agent: &mut Agent3D) {
        let is_building_stock = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.tier == HouseTier::Tier3Homestead && h.pantry_gold < h.max_pantry_gold)
            .unwrap_or(false);
        let gold_load_full = agent.carried_gold >= 20.0;
        let house_gold_full = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_gold >= (h.max_pantry_gold * 0.98))
            .unwrap_or(false);
        let empty = self.source_empty(PoiType::GoldMine, agent.world_pos);

        if empty && !gold_load_full && !(is_building_stock && house_gold_full) && agent.hunger >= 25.0 && agent.thirst >= 25.0 && agent.stamina >= 50.0 {
            if let Some(next_target) = self.nearest_of(NodePool::Gold, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, next_target, PrimitiveActionState::SeekingGold) {
                    return;
                }
            }
        }

        if gold_load_full
            || (is_building_stock && house_gold_full)
            || empty
            || agent.hunger < 25.0
            || agent.thirst < 25.0
            || agent.stamina < 50.0
        {
            agent.gold_mining_cooldown = if is_building_stock { 45.0 } else { 180.0 };
            agent.current_need = Some(if agent.stamina < 50.0 { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
            self.return_home(agent);
        }
    }

    /// 建材途中转向与余额不足检查 (中途目标 POI < 10% 就近重新寻路或放弃)
    pub fn decide_seeking_material(&mut self, agent: &mut Agent3D, pool: NodePool, poi_type: PoiType) {
        let target_depleted = self.is_target_poi_depleted_below_10(agent, poi_type);
        let gold_interrupted = pool == NodePool::Gold && (self.ctx.gold_depleted || target_depleted);

        // 紧急生理需求或体力耗尽优先打断
        if agent.thirst < 25.0 && !self.ctx.water_nodes.is_empty() {
            let target = self.nearest_of(NodePool::Water, agent.world_pos).unwrap_or(self.ctx.water_nodes[0]);
            if !self.turn_around_and_route_to(agent, target, PrimitiveActionState::SeekingWater) {
                let curr_node = self.start_node(agent);
                self.dispatch(agent, curr_node, target, PrimitiveActionState::SeekingWater);
            }
            return;
        }
        if agent.hunger < 25.0 && !self.ctx.food_nodes.is_empty() {
            let target = self.nearest_of(NodePool::Food, agent.world_pos).unwrap_or(self.ctx.food_nodes[0]);
            if !self.turn_around_and_route_to(agent, target, PrimitiveActionState::SeekingFood) {
                let curr_node = self.start_node(agent);
                self.dispatch(agent, curr_node, target, PrimitiveActionState::SeekingFood);
            }
            return;
        }
        if agent.stamina < 50.0 {
            agent.current_need = Some("Physiological·Rest".to_string());
            self.return_home(agent);
            return;
        }

        // 目标 POI 枯竭时，尝试就近前往同类未枯竭 POI
        if target_depleted || gold_interrupted || pool.nodes(self.ctx).is_empty() {
            if pool == NodePool::Gold {
                let is_building_stock = agent.home_house_id
                    .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                    .map(|h| h.tier == HouseTier::Tier3Homestead && h.pantry_gold < h.max_pantry_gold)
                    .unwrap_or(false);
                agent.gold_mining_cooldown = if is_building_stock { 45.0 } else { 180.0 };
            }
            if let Some(new_target) = self.nearest_of(pool, agent.world_pos) {
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

    /// 生存资源途中余额不足检查 (中途目标 POI < 10% 就近重新寻路或放弃)
    pub fn decide_seeking_survival(&mut self, agent: &mut Agent3D, pool: NodePool, poi_type: PoiType) {
        let target_depleted = self.is_target_poi_depleted_below_10(agent, poi_type);

        if agent.stamina < 50.0 {
            agent.current_need = Some("Physiological·Rest".to_string());
            self.return_home(agent);
            return;
        }

        if pool.nodes(self.ctx).is_empty() || target_depleted {
            // 目标 POI 枯竭或不可用，尝试就近前往其他未枯竭的同类生存 POI
            if let Some(new_target) = self.nearest_of(pool, agent.world_pos) {
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
    /// 错峰决策调度: 每 tick 调用一次；每个 agent 仅在 (tick + id) % 30 的相位上决策
    pub fn tick_decisions(&mut self) {
        let ctx = self.build_decision_context();
        let mut decisioner = Decisioner {
            ctx: &ctx,
            network: &self.network,
            houses: &self.houses,
            pois: &self.pois,
            rng: &mut self.rng,
        };
        for agent in &mut self.agents {
            if agent.is_alive && (self.tick_counter + agent.id as u64) % AGENT_DECISION_INTERVAL_TICKS == 0 {
                decisioner.decide(agent);
            }
        }
    }

    /// 收集全图储量充足 (≥30%) 的资源节点池与营地坐标
    pub fn build_decision_context(&self) -> DecisionContext {
        let mut water_nodes = Vec::new();
        let mut food_nodes = Vec::new();
        let mut wood_nodes = Vec::new();
        let mut stone_nodes = Vec::new();
        let mut gold_nodes = Vec::new();
        let mut camp_positions = Vec::new();

        let mut total_gold_cur = 0.0f32;
        let mut total_gold_max = 0.0f32;
        for poi in &self.pois {
            if poi.poi_type == PoiType::GoldMine {
                total_gold_cur += poi.current_stock;
                total_gold_max += poi.max_stock;
            }
        }
        let gold_depleted = total_gold_max > 0.0 && (total_gold_cur / total_gold_max) < DECISION_POI_SEEK_MIN_STOCK_RATIO;

        for poi in &self.pois {
            // POI 储量低于 30% 则不启动对该点的寻路决策 (营地无限储量除外)
            if poi.poi_type != PoiType::Camp && poi.current_stock < (poi.max_stock * DECISION_POI_SEEK_MIN_STOCK_RATIO) {
                continue;
            }
            let Some(node) = self.find_nearest_node(poi.pos) else { continue };
            match poi.poi_type {
                PoiType::WaterSource => water_nodes.push(node),
                PoiType::BerryBush => food_nodes.push(node),
                PoiType::WoodForest => wood_nodes.push(node),
                PoiType::StoneQuarry => stone_nodes.push(node),
                PoiType::GoldMine => { if !gold_depleted { gold_nodes.push(node); } }
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
            gold_depleted,
        }
    }
}