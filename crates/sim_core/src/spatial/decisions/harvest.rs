use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::poi::PoiType;
use super::super::ledger::journal::ResourceKind;
use super::needs::*;
use super::evaluate::Decisioner;
use super::branches::BranchId;
use super::strategy::{ActiveTask, ExecutionStrategy, ResourceStage};
use super::primitive::{ActionPrimitive, ArrivalKind};
use super::transition;

use crate::spatial::graph::NodeId;

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

    /// ★ L1 连续采收候选分支意图仲裁：检查单个分支是否满足连续采收资格并返回其 Need 与对应 POI 池
    pub fn arbitrate_continuous_harvest_candidate(&self, agent: &Agent3D, branch: BranchId) -> Option<(Need, NodePool)> {
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
            return None;
        }
        let need = branch.evaluate(self, agent)?;
        let pool = match need.kind {
            NeedKind::QuenchThirst | NeedKind::StockWater => NodePool::Water,
            NeedKind::SateHunger | NeedKind::StockFood => NodePool::Food,
            NeedKind::StockWood => NodePool::Wood,
            NeedKind::StockStone => NodePool::Stone,
            NeedKind::StockGold => NodePool::Gold,
            _ => return None,
        };
        Some((need, pool))
    }

    fn install_continuous_harvest_task(&mut self, agent: &mut Agent3D, branch: BranchId, need: Need, pool: NodePool, target: NodeId) {
        agent.current_need = state_need_label_with_agent(
            need.target_state,
            agent,
            self.houses,
            self.households,
            self.config,
        ).map(|(lvl, k)| format!("{}·{}", lvl, k));
        let home_tier = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.tier);
        if let Ok(obs) = need.observe_intent(branch, home_tier) {
            if let Some(intent) = obs.sustained() {
                let poi = pool.nodes(self.ctx).iter().find(|rn| rn.node == target).map(|rn| rn.poi_id);
                let task = ActiveTask {
                    intent,
                    strategy: ExecutionStrategy::WildHarvest {
                        pool,
                        poi,
                        stage: ResourceStage::Outbound,
                    },
                    primitive: ActionPrimitive::Navigate {
                        target,
                        arrival: ArrivalKind::ResourceSite,
                    },
                };
                transition::install_task(agent, task);
            }
        }
    }

    /// ★ M19.4d 行程优化规划器：基于当前位置与家户短缺品类，通过最近邻贪心算法 (Nearest Neighbor TSP)
    /// 预排多品类连续采收候选队列（最多 4 站，定长数组，零堆分配）。
    pub fn plan_harvest_itinerary(&self, agent: &Agent3D) -> [Option<BranchId>; 4] {
        let mut queue = [None; 4];
        if agent.home_house_id.is_none() || agent.stamina < self.config.decision_work_stamina_threshold {
            return queue;
        }

        #[derive(Clone, Copy)]
        struct CandidateStop {
            branch: BranchId,
            pool: NodePool,
            pos: crate::spatial::vec3::Vec3,
        }

        let harvest_branches = [
            BranchId::B5StockWater,
            BranchId::B6StockFood,
            BranchId::B7StockWood,
            BranchId::B9StockStone,
            BranchId::B10StockGold,
        ];

        let mut candidates: [Option<CandidateStop>; 5] = [None; 5];
        let mut count = 0;

        for &b in &harvest_branches {
            if let Some((_need, pool)) = self.arbitrate_continuous_harvest_candidate(agent, b) {
                if let Some(target) = self.nearest_of(agent, pool, agent.world_pos) {
                    let pos = self.node_pos(target);
                    candidates[count] = Some(CandidateStop { branch: b, pool, pos });
                    count += 1;
                }
            }
        }

        if count == 0 {
            return queue;
        }

        // 贪心最近邻链路排序 (TSP Heuristic):
        // 从当前位置出发，每一步选择距离上一站最近的未访问候选节点
        let mut curr_pos = agent.world_pos;
        let mut visited = [false; 5];

        for step in 0..4.min(count) {
            let mut best_idx = None;
            let mut best_dist = f32::MAX;

            for i in 0..count {
                if visited[i] {
                    continue;
                }
                let cand = candidates[i].as_ref().unwrap();
                let dist = curr_pos.distance_to(&cand.pos);
                if dist < best_dist {
                    best_dist = dist;
                    best_idx = Some(i);
                }
            }

            if let Some(idx) = best_idx {
                visited[idx] = true;
                let chosen = candidates[idx].as_ref().unwrap();
                queue[step] = Some(chosen.branch);
                curr_pos = chosen.pos;
            } else {
                break;
            }
        }

        queue
    }

    /// ★ v1.35.0 / M19.4d 单趟多品类连续采收与预排行程执行：
    /// 在某一 POI 采收完成（装满/断流/家宅该品类已补足）后，
    /// 优先沿用/就地规划预排候选队列，按就近链路依次派发下一处 POI 继续采收；
    /// 候选失效时自动尝试下一站，队列耗尽时回退至 branch_order 兜底。
    pub fn try_continue_harvesting(&mut self, agent: &mut Agent3D) -> bool {
        if agent.home_house_id.is_none() || agent.stamina < self.config.decision_work_stamina_threshold {
            agent.clear_harvest_queue();
            return false;
        }

        // 1. 若当前预排队列为空，就地根据当前位置与剩余短缺规划一条新预排行程
        if agent.harvest_queue.iter().all(|s| s.is_none()) {
            agent.harvest_queue = self.plan_harvest_itinerary(agent);
        }

        // 2. 优先消费预排行程候选队列
        while let Some(branch) = agent.pop_harvest_queue() {
            let Some((need, pool)) = self.arbitrate_continuous_harvest_candidate(agent, branch) else {
                continue;
            };
            if need.kind == NeedKind::StockGold {
                agent.gold_mining_cooldown = self.config.decision_stock_gold_cooldown;
            }
            if let Some(target) = self.nearest_of(agent, pool, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, target, need.target_state) {
                    self.install_continuous_harvest_task(agent, branch, need, pool, target);
                    return true;
                }
            }
        }

        // 3. 队列耗尽后回退至静态 branch_order 兜底遍历
        for &branch in self.branch_order.iter() {
            let Some((need, pool)) = self.arbitrate_continuous_harvest_candidate(agent, branch) else {
                continue;
            };
            if need.kind == NeedKind::StockGold {
                agent.gold_mining_cooldown = self.config.decision_stock_gold_cooldown;
            }
            if let Some(target) = self.nearest_of(agent, pool, agent.world_pos) {
                let curr_node = self.start_node(agent);
                if self.dispatch(agent, curr_node, target, need.target_state) {
                    self.install_continuous_harvest_task(agent, branch, need, pool, target);
                    return true;
                }
            }
        }

        agent.clear_harvest_queue();
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
                    if let Some(task) = agent.active_task.as_mut() {
                        if let ExecutionStrategy::WildHarvest { poi, stage, .. } = &mut task.strategy {
                            *poi = NodePool::Water.nodes(self.ctx).iter().find(|rn| rn.node == next_target).map(|rn| rn.poi_id);
                            *stage = ResourceStage::Outbound;
                        }
                        task.primitive = ActionPrimitive::Navigate { target: next_target, arrival: ArrivalKind::ResourceSite };
                    }
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
                    if let Some(task) = agent.active_task.as_mut() {
                        if let ExecutionStrategy::WildHarvest { poi, stage, .. } = &mut task.strategy {
                            *poi = NodePool::Food.nodes(self.ctx).iter().find(|rn| rn.node == next_target).map(|rn| rn.poi_id);
                            *stage = ResourceStage::Outbound;
                        }
                        task.primitive = ActionPrimitive::Navigate { target: next_target, arrival: ArrivalKind::ResourceSite };
                    }
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
                    if let Some(task) = agent.active_task.as_mut() {
                        if let ExecutionStrategy::WildHarvest { poi, stage, .. } = &mut task.strategy {
                            *poi = pool.nodes(self.ctx).iter().find(|rn| rn.node == next_target).map(|rn| rn.poi_id);
                            *stage = ResourceStage::Outbound;
                        }
                        task.primitive = ActionPrimitive::Navigate { target: next_target, arrival: ArrivalKind::ResourceSite };
                    }
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
                    if let Some(task) = agent.active_task.as_mut() {
                        if let ExecutionStrategy::WildHarvest { poi, stage, .. } = &mut task.strategy {
                            *poi = NodePool::Gold.nodes(self.ctx).iter().find(|rn| rn.node == next_target).map(|rn| rn.poi_id);
                            *stage = ResourceStage::Outbound;
                        }
                        task.primitive = ActionPrimitive::Navigate { target: next_target, arrival: ArrivalKind::ResourceSite };
                    }
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
