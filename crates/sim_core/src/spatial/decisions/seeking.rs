use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::poi::PoiType;
use super::super::ledger::journal::ResourceKind;
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
                // ★ M7 冷却区分：家庭储备缺金（trigger ON）→ StockGold；已补足（4级庄园娱乐淘金）→ GoldWealth
                agent.gold_mining_cooldown = if family_stock_on(agent, ResourceKind::Gold) {
                    self.config.decision_stock_gold_cooldown
                } else {
                    self.config.decision_gold_wealth_cooldown
                };
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

    /// ★ M4 夺位远征途中状态处理（马斯洛引擎驱动，世界不干涉）：
    /// - 体力告警 → 放弃远征折返回家；
    /// - 抵达目标营地且王位仍空缺 → 写下登基决心（coronation_pending），交由世界物理规则登基；
    /// - 目标营地王位易主 → 重定向至最近仍空缺的可夺位营地（原地掉头，保持坐标连续）；
    /// - 无可夺位营地 → 放弃远征恢复正常决策。
    pub fn decide_seeking_throne(&mut self, agent: &mut Agent3D) {
        // 体力告警：放弃夺位，折返回家
        if agent.stamina < self.config.decision_work_stamina_threshold {
            agent.expedition_target_camp = None;
            agent.current_need = Some("Physiological·Rest".to_string());
            self.return_home(agent);
            return;
        }

        let interact_radius = self.config.poi_interaction_radius;
        let home_camp_id = || -> Option<u32> {
            agent.home_house_id
                .and_then(|hid| self.houses.iter().find(|h| h.id == hid && !h.is_ruin))
                .map(|h| h.camp_id)
        };

        let Some(target_camp) = agent.expedition_target_camp else {
            // 无目标记录：重新按资格找目标，找不到则放弃
            if let Some(camp_id) = self.eligible_leaderless_camp(agent, home_camp_id().is_some(), home_camp_id()) {
                agent.expedition_target_camp = Some(camp_id);
                if let Some(node) = self.camp_node_of(camp_id) {
                    if self.turn_around_and_route_to(agent, node, PrimitiveActionState::SeekingThrone) {
                        return;
                    }
                    let curr = self.start_node(agent);
                    if self.dispatch(agent, curr, node, PrimitiveActionState::SeekingThrone) {
                        return;
                    }
                }
            }
            agent.expedition_target_camp = None;
            agent.current_need = None;
            agent.state = PrimitiveActionState::RestingAtCamp;
            return;
        };

        // 目标营地王位仍空缺？
        let target_still_leaderless = self
            .regions
            .regions
            .get(&target_camp)
            .map(|r| r.group.leader.is_none())
            .unwrap_or(false);
        let camp_pos = self
            .ctx
            .camp_pois
            .iter()
            .find(|(id, _)| *id == target_camp)
            .map(|(_, p)| *p);

        if target_still_leaderless {
            if let Some(pos) = camp_pos {
                if agent.world_pos.distance_to(&pos) < interact_radius {
                    // 已抵达且王位空缺：写下登基决心，交由世界物理规则执行登基
                    agent.coronation_pending = Some(target_camp);
                    agent.current_need = Some("Physiological·SeekThrone".to_string());
                    return;
                }
            }
            // 仍在途中：保持现有路线，无需处理
            return;
        }

        // 目标易主：重定向至最近仍空缺的可夺位营地；无则放弃
        if let Some(new_camp) = self.eligible_leaderless_camp(agent, home_camp_id().is_some(), home_camp_id()) {
            if new_camp != target_camp {
                agent.expedition_target_camp = Some(new_camp);
                if let Some(node) = self.camp_node_of(new_camp) {
                    if self.turn_around_and_route_to(agent, node, PrimitiveActionState::SeekingThrone) {
                        return;
                    }
                    let curr = self.start_node(agent);
                    if self.dispatch(agent, curr, node, PrimitiveActionState::SeekingThrone) {
                        return;
                    }
                }
            }
            return;
        }

        // 无任何可夺位营地：放弃远征，恢复正常决策
        agent.expedition_target_camp = None;
        agent.coronation_pending = None;
        agent.current_need = None;
        agent.state = PrimitiveActionState::RestingAtCamp;
    }
}
