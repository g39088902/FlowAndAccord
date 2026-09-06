use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::poi::PoiType;
use super::super::ledger::journal::ResourceKind;
use super::needs::*;
use super::evaluate::Decisioner;
use super::branches::BranchId;

/// 现场采收行为：饮水/觅食/伐木/采石/淘金在资源点的完成判定与去向，
/// 以及家庭备料目标查询。均在 Agent 已抵达 POI 现场时由 decide 调度。
/// ★ M6 账本化：家宅“备满/达标”一律读【家户账本】余额与等级目标阈值（不再读 pantry_*）。
impl<'a> Decisioner<'a> {
    /// ★ M7 该品类家庭储备是否“已补足/无需再采”：
    /// 无房（无 home 或已废墟）→ 恒视为已补足（不可采）；有房 → 触发器 OFF（账本余额 ≥ 上限）为补足。
    fn stock_met(&self, agent: &Agent3D, kind: ResourceKind) -> bool {
        let has_home = match agent.home_house_id {
            Some(id) => self.houses.iter().any(|h| h.id == id),
            None => false,
        };
        !has_home || !family_stock_on(agent, kind)
    }

    /// ★ v1.35.0 单趟多品类连续采收：在某一 POI 采收完成（装满/断流/家宅该品类已补足）后，
    /// 若有私宅且体力充沛（≥ decision_work_stamina_threshold），按编排顺序检查家宅是否短缺其他品类。
    /// 若有其他品类短缺且自身行囊有余量、目标 POI 可用，则直接 dispatch 前往下一处 POI 继续采收；
    /// 仅在无可采集短缺或体力不足时才返回 false（由调用方安排返家）。
    pub fn try_continue_harvesting(&mut self, agent: &mut Agent3D) -> bool {
        if agent.home_house_id.is_none() || agent.stamina < self.config.decision_work_stamina_threshold {
            return false;
        }
        for branch in self.branch_order.iter() {
            let is_harvest_branch = matches!(
                branch,
                BranchId::B1QuenchThirst
                    | BranchId::B2SateHunger
                    | BranchId::B5StockWater
                    | BranchId::B6StockFood
                    | BranchId::B7StockWood
                    | BranchId::B9StockStone
                    | BranchId::B10StockGold
            );
            if !is_harvest_branch {
                continue;
            }
            let Some(need) = branch.evaluate(self, agent) else {
                continue;
            };
            let pool = match need.kind {
                NeedKind::QuenchThirst | NeedKind::StockWater => NodePool::Water,
                NeedKind::SateHunger | NeedKind::StockFood => NodePool::Food,
                NeedKind::StockWood => NodePool::Wood,
                NeedKind::StockStone => NodePool::Stone,
                NeedKind::StockGold => NodePool::Gold,
                _ => continue,
            };
            if need.kind == NeedKind::StockGold {
                agent.gold_mining_cooldown = self.config.decision_stock_gold_cooldown;
            }
            if let Some(target) = self.nearest_of(agent, pool, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, target, need.target_state) {
                    agent.current_need = state_need_label_with_agent(
                        need.target_state,
                        agent,
                        self.houses,
                        self.households,
                        self.config,
                    ).map(|(lvl, k)| format!("{}·{}", lvl, k));
                    return true;
                }
            }
        }
        false
    }

    pub fn decide_drinking(&mut self, agent: &mut Agent3D) {
        let can_stock = agent.home_house_id.is_some();
        let house_water_full = self.stock_met(agent, ResourceKind::Water);
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
            if self.try_route_to_market(agent, NodePool::Water) { return; }
        }

        let finished = (self_satisfied && (!can_stock || house_water_full)) || carry_full || unavailable;

        if finished {
            if self.try_continue_harvesting(agent) {
                return;
            }
            agent.current_need = Some(if agent.stamina < self.config.decision_work_stamina_threshold { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
            self.return_home(agent);
        }
    }

    pub fn decide_foraging(&mut self, agent: &mut Agent3D) {
        let can_stock = agent.home_house_id.is_some();
        let house_food_full = self.stock_met(agent, ResourceKind::Food);
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
            if self.try_route_to_market(agent, NodePool::Food) { return; }
        }

        let finished = (self_satisfied && (!can_stock || house_food_full)) || carry_full || unavailable;

        if finished {
            if self.try_continue_harvesting(agent) {
                return;
            }
            agent.current_need = Some(if agent.stamina < self.config.decision_work_stamina_threshold { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
            self.return_home(agent);
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
            if pool == NodePool::Wood && self.try_route_to_market(agent, NodePool::Wood) { return; }
        }

        let finished = unavailable || fully_stocked || carry_full || agent.hunger < self.config.decision_critical_hunger || agent.thirst < self.config.decision_critical_thirst || agent.stamina < self.config.decision_work_stamina_threshold;

        if finished {
            if self.try_continue_harvesting(agent) {
                return;
            }
            agent.current_need = Some(if agent.stamina < self.config.decision_work_stamina_threshold { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
            self.return_home(agent);
        }
    }

    pub fn decide_mining_gold(&mut self, agent: &mut Agent3D) {
        // ★ M7 金与房屋等级脱钩：家庭储备缺金（trigger ON）或 4 级庄园娱乐淘金（trigger OFF）
        // 都同样采到行囊满/源不可用/生理危机才收工；冷却在收尾时按“是否仍缺金”区分。
        let gold_load_full = agent.carried_gold >= self.config.agent_gold_load_full;
        let unavailable = self.is_target_poi_unavailable(agent, PoiType::GoldMine);

        if unavailable && !gold_load_full && agent.hunger >= self.config.decision_critical_hunger && agent.thirst >= self.config.decision_critical_thirst && agent.stamina >= self.config.decision_work_stamina_threshold {
            if let Some(next_target) = self.nearest_of(agent, NodePool::Gold, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, next_target, PrimitiveActionState::SeekingGold) {
                    return;
                }
            }
        }

        if gold_load_full
            || unavailable
            || agent.hunger < self.config.decision_critical_hunger
            || agent.thirst < self.config.decision_critical_thirst
            || agent.stamina < self.config.decision_work_stamina_threshold
        {
            // 收尾冷却：家庭储备仍缺金（stock_met=false，补金之旅）→ StockGold 45；家庭已足（娱乐淘金）→ GoldWealth 180
            agent.gold_mining_cooldown = if self.stock_met(agent, ResourceKind::Gold) {
                self.config.decision_gold_wealth_cooldown
            } else {
                self.config.decision_stock_gold_cooldown
            };
            if self.try_continue_harvesting(agent) {
                return;
            }
            agent.current_need = Some(if agent.stamina < self.config.decision_work_stamina_threshold { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
            self.return_home(agent);
        }
    }

    pub fn wood_fully_stocked(&self, agent: &Agent3D) -> bool {
        self.stock_met(agent, ResourceKind::Wood)
    }

    pub fn stone_fully_stocked(&self, agent: &Agent3D) -> bool {
        self.stock_met(agent, ResourceKind::Stone)
    }
}
