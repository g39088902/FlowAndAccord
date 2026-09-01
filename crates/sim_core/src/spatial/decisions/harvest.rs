use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::poi::PoiType;
use super::super::house::HouseTier;
use super::needs::*;
use super::evaluate::Decisioner;

/// 现场采收行为：饮水/觅食/伐木/采石/淘金在资源点的完成判定与去向，
/// 以及家宅仓储满额查询。均在 Agent 已抵达 POI 现场时由 decide 调度。
impl<'a> Decisioner<'a> {
    pub fn decide_drinking(&mut self, agent: &mut Agent3D) {
        let can_stock = agent.home_house_id.is_some();
        let house_water_full = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_water >= h.max_pantry_water)
            .unwrap_or(true);
        let self_satisfied = agent.thirst >= self.config.agent_self_satisfied_threshold;
        let carry_full = can_stock && agent.carried_water >= self.config.carry_capacity_resource;
        let unavailable = self.is_target_poi_unavailable(agent, PoiType::WaterSource);

        let needs_more_water = !self_satisfied || (can_stock && !house_water_full && !carry_full);
        if unavailable && needs_more_water && agent.stamina >= self.config.decision_work_stamina_threshold {
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
                agent.current_need = Some(if agent.stamina < self.config.decision_work_stamina_threshold { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
                self.return_home(agent);
            }
        }
    }

    pub fn decide_foraging(&mut self, agent: &mut Agent3D) {
        let can_stock = agent.home_house_id.is_some();
        let house_food_full = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_food >= h.max_pantry_food)
            .unwrap_or(true);
        let self_satisfied = agent.hunger >= self.config.agent_self_satisfied_threshold;
        let carry_full = can_stock && agent.carried_food >= self.config.carry_capacity_resource;
        let unavailable = self.is_target_poi_unavailable(agent, PoiType::BerryBush);

        let needs_more_food = !self_satisfied || (can_stock && !house_food_full && !carry_full);
        if unavailable && needs_more_food && agent.stamina >= self.config.decision_work_stamina_threshold {
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
                agent.current_need = Some(if agent.stamina < self.config.decision_work_stamina_threshold { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
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

        if unavailable && !fully_stocked && !carry_full && agent.hunger >= self.config.decision_critical_hunger && agent.thirst >= self.config.decision_critical_thirst && agent.stamina >= self.config.decision_work_stamina_threshold {
            if let Some(next_target) = self.nearest_of(agent, pool, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, next_target, state) {
                    return;
                }
            }
        }

        if unavailable || fully_stocked || carry_full || agent.hunger < self.config.decision_critical_hunger || agent.thirst < self.config.decision_critical_thirst || agent.stamina < self.config.decision_work_stamina_threshold {
            agent.current_need = Some(if agent.stamina < self.config.decision_work_stamina_threshold { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
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
            .map(|h| h.pantry_gold >= h.max_pantry_gold)
            .unwrap_or(false);
        let unavailable = self.is_target_poi_unavailable(agent, PoiType::GoldMine);

        if unavailable && !gold_load_full && !(is_building_stock && house_gold_full) && agent.hunger >= self.config.decision_critical_hunger && agent.thirst >= self.config.decision_critical_thirst && agent.stamina >= self.config.decision_work_stamina_threshold {
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
            || agent.stamina < self.config.decision_work_stamina_threshold
        {
            agent.gold_mining_cooldown = if is_building_stock { self.config.decision_stock_gold_cooldown } else { self.config.decision_gold_wealth_cooldown };
            agent.current_need = Some(if agent.stamina < self.config.decision_work_stamina_threshold { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
            self.return_home(agent);
        }
    }

    pub fn wood_fully_stocked(&self, agent: &Agent3D) -> bool {
        agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_wood >= h.max_pantry_wood)
            .unwrap_or(true)
    }

    pub fn stone_fully_stocked(&self, agent: &Agent3D) -> bool {
        agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_stone >= h.max_pantry_stone)
            .unwrap_or(true)
    }
}
