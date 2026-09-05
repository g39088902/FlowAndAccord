use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::poi::PoiType;
use super::super::ledger::journal::ResourceKind;
use super::needs::*;
use super::evaluate::Decisioner;

/// 途中转向与可用性检查（§4.2）：目标 POI 被 Agent 私有施密特触发器关闭时，
/// 原地掉头平滑重路由至就近同类可用 POI；仅当自身无可用品或体力告警时才折返回家。
impl<'a> Decisioner<'a> {
    pub fn try_route_to_market(&mut self, agent: &mut Agent3D, pool: NodePool) -> bool {
        if !matches!(pool, NodePool::Water | NodePool::Food) || self.ctx.market_nodes.is_empty() { return false; }
        let can_pay = self.households.household_of(agent.id)
            .and_then(|hid| self.households.get(hid))
            .map(|hh| hh.group.leader == Some(agent.id) && hh.group.ledger.balance(ResourceKind::Gold) >= self.config.market_min_family_gold)
            .unwrap_or(false);
        if !can_pay || agent.stamina < self.config.decision_work_stamina_threshold { return false; }
        let Some(target) = self.nearest_market_node(agent) else { return false; };
        agent.current_need = Some("Physiological·MarketTrade".to_string());
        self.turn_around_and_route_to(agent, target, PrimitiveActionState::SeekingMarket)
            || { let curr = self.start_node(agent); self.dispatch(agent, curr, target, PrimitiveActionState::SeekingMarket) }
    }
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

        // 临界口渴/饥饿属于更高优先级的生理需求，不能被普通疲劳熔断强制打断；
        // 只有没有临界生存需求时，体力阈值才允许决策器安排返家休息。
        let critical_survival = match pool {
            NodePool::Water => agent.thirst < self.config.decision_critical_thirst,
            NodePool::Food => agent.hunger < self.config.decision_critical_hunger,
            _ => false,
        };
        if agent.stamina < self.config.decision_work_stamina_threshold && !critical_survival {
            agent.current_need = Some("Physiological·Rest".to_string());
            self.return_home(agent);
            return;
        }

        if !self.has_available_node(agent, pool) || target_unavailable {
            // 采集途中发现同类野外 POI 全部关闭时，直接原地掉头赴榷场；
            // 市场支付使用家户账本远程结算，不要求 agent 先回家或携带金币。
            if !self.has_available_node(agent, pool) && self.try_route_to_market(agent, pool) { return; }
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
                .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
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
            agent.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
            return;
        };

        // 目标营地王位仍空缺？（无 region 实体视为空缺，允许孤儿营地继续走向登基）
        let target_still_leaderless = self
            .regions
            .regions
            .get(&target_camp)
            .map(|r| r.group.leader.is_none())
            .unwrap_or(true);
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
        agent.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
    }

    /// ★ 求偶途中状态机：奔赴心仪女性
    pub fn decide_seeking_courtship(&mut self, agent: &mut Agent3D) {
        // 1. 生存指标熔断：口渴/饥饿/体力严重告警时终止求偶，保命优先
        if agent.thirst < self.config.decision_critical_thirst
            || agent.hunger < self.config.decision_critical_hunger
            || agent.stamina < self.config.decision_work_stamina_threshold
        {
            agent.courtship_target_id = None;
            agent.courtship_pending = None;
            self.return_home(agent);
            return;
        }

        // 2. 身份资格校验（若自身已婚或死亡，立刻清空并恢复营地）
        if agent.spouse_id.is_some() || !agent.is_alive || agent.gender != crate::spatial::agent::Gender::Male {
            agent.courtship_target_id = None;
            agent.courtship_pending = None;
            agent.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
            return;
        }

        let interact_radius = self.config.poi_interaction_radius;
        let target_female_id = agent.courtship_target_id;

        // 检查原目标女性是否仍处于候选集合中
        let current_target = target_female_id.and_then(|tid| {
            self.ctx.eligible_females.iter().find(|f| f.id == tid).copied()
        });

        if let Some(target) = current_target {
            if agent.world_pos.distance_to(&target.pos) <= interact_radius {
                // 已抵达且满足互动半径：写下求偶决心，待世界调度执行结婚
                agent.courtship_pending = Some(target.id);
                agent.current_need = Some("Belonging·Courtship".to_string());
                return;
            }
            // 仍在途中：若路径走完但尚未进入互动半径（如目标略有移动），向其最新最近路网节点重补路径
            // 注：advance_to_next_lane 走完路线后 route Vec 未清空（仅 route_index 越界、current_lane_id 置 None），
            //     故必须同时以 current_lane_id.is_none() 判断"已停在目标节点附近"，否则不会重补路径而站死。
            if agent.route.is_empty() || agent.current_lane_id.is_none() {
                let curr = self.start_node(agent);
                if curr != target.nearest_node {
                    self.dispatch(agent, curr, target.nearest_node, PrimitiveActionState::SeekingCourtship);
                }
            }
            return;
        }

        // 目标女性已不可用（已被他人迎娶/已怀孕/已身亡）：尝试重定向到全图下一名魅力最高单身女性
        if let Some(new_target) = self.best_courtship_target(agent).copied() {
            agent.courtship_target_id = Some(new_target.id);
            if agent.world_pos.distance_to(&new_target.pos) <= interact_radius {
                agent.courtship_pending = Some(new_target.id);
                agent.current_need = Some("Belonging·Courtship".to_string());
                return;
            }
            if self.turn_around_and_route_to(agent, new_target.nearest_node, PrimitiveActionState::SeekingCourtship) {
                return;
            }
            let curr = self.start_node(agent);
            if self.dispatch(agent, curr, new_target.nearest_node, PrimitiveActionState::SeekingCourtship) {
                return;
            }
        }

        // 全图已无任何合格单身女性：放弃求偶，返回归宿营地/私宅
        agent.courtship_target_id = None;
        agent.courtship_pending = None;
        agent.current_need = None;
        self.return_home(agent);
    }
}
