use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::poi::PoiType;
use super::super::house::HouseTier;
use super::needs::*;
use super::evaluate::Decisioner;

/// 途中转向与可用性检查（§4.2）：目标 POI 被 Agent 私有施密特触发器关闭时，
/// 原地掉头平滑重路由至就近同类可用 POI；仅当自身无可用品或体力告警时才折返回家。
impl<'a> Decisioner<'a> {
    /// 建材途中转向与可用性检查（目标 POI 被施密特触发器关闭时就近重路由或放弃）
    pub fn decide_seeking_material(&mut self, agent: &mut Agent3D, pool: NodePool, poi_type: PoiType) {
        let target_unavailable = self.is_target_poi_unavailable(agent, poi_type);
        let gold_interrupted = pool == NodePool::Gold && (!self.has_available_node(agent, NodePool::Gold) || target_unavailable);

        if agent.stamina < self.config.decision_work_stamina_threshold || gold_interrupted {
            if gold_interrupted {
                let is_building_stock = agent.home_house_id
                    .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                    .map(|h| h.tier == HouseTier::Tier3Homestead && h.pantry_gold < h.max_pantry_gold)
                    .unwrap_or(false);
                agent.gold_mining_cooldown = if is_building_stock { self.config.decision_stock_gold_cooldown } else { self.config.decision_gold_wealth_cooldown };
            }
            agent.current_need = Some(if agent.stamina < self.config.decision_work_stamina_threshold { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
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

        if agent.stamina < self.config.decision_work_stamina_threshold {
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
}
