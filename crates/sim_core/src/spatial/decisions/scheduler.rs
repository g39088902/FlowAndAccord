use super::super::poi::PoiType;
use super::super::world::World3DEngine;
use super::branches;
use super::needs::*;
use super::evaluate::Decisioner;

impl World3DEngine {
    /// 错峰决策调度: 每 tick 调用一次；每个 agent 仅在 (tick + id) % AGENT_DECISION_INTERVAL_TICKS 的相位上决策
    pub fn tick_decisions(&mut self) {
        let ctx = self.build_decision_context();
        let poi_stock_observations: Vec<_> = self.pois.iter()
            .filter(|poi| poi.poi_type != PoiType::Camp)
            .map(|poi| (poi.id, poi.current_stock, poi.max_stock))
            .collect();
        // 每拍解析一次注入的分支评估顺序（空/非法→中性声明序），热路径零分配
        let branch_order = branches::resolve_order(&self.config.decision_eval_order);
        let mut decisioner = Decisioner {
            ctx: &ctx,
            network: &self.network,
            houses: &self.houses,
            households: &self.household_registry,
            regions: &self.region_registry,
            rng: &mut self.rng,
            config: &self.config,
            branch_order: &branch_order,
        };
        for agent in &mut self.agents {
            // ★ 胎儿跳过行动决策：无地图实体、无自主行动
            if agent.is_alive && !agent.is_fetus && (self.tick_counter + agent.id as u64) % self.config.agent_decision_interval_ticks == 0 {
                for &(poi_id, current_stock, max_stock) in &poi_stock_observations {
                    agent.observe_poi_stock_with_config(poi_id, current_stock, max_stock, &self.config);
                }
                decisioner.decide(agent);
            }
        }
        drop(decisioner);
        // ★ M4 登基物理规则：把本拍内 agent 自主下定决心（coronation_pending）的登基落地
        self.execute_pending_coronations();
        // 实体化登记：将本拍内 agent 自主选定的宅址落地为 0 级仓库（放置校验/路网接入/房产绑定）
        self.materialize_founded_houses();
    }

    /// 收集全图资源节点与营地坐标；每名 Agent 会用自己的触发器过滤候选。
    // ══════════════════════════════════════════════════════════
    // ★ M4 夺位远征 · 登基物理规则（决策由马斯洛引擎驱动，此处只执行物理结算）
    // ══════════════════════════════════════════════════════════

    /// 登基物理规则执行器：扫描本拍内 agent 自主写下“已抵达且王位空缺”的登基决心
    /// （coronation_pending），校验目标营地仍无主后执行登基。与 materialize_founded_houses
    /// 同模式：决策器只下决心，系统只执行物理规则，不干涉 agent 决策、不强行摊派远征任务。
    pub fn execute_pending_coronations(&mut self) {
        let tick = self.tick_counter;
        let mut pending: Vec<(u32, u32)> = Vec::new(); // (agent_id, camp_id)
        for agent in &self.agents {
            if let Some(camp_id) = agent.coronation_pending {
                pending.push((agent.id, camp_id));
            }
        }
        if pending.is_empty() {
            return;
        }
        for (agent_id, camp_id) in pending {
            let still_leaderless = self
                .region_registry
                .regions
                .get(&camp_id)
                .map(|r| r.group.leader.is_none())
                .unwrap_or(false);
            if !still_leaderless {
                // 王位已被他人抢先：清空登基决心与远征目标，交由决策器重定向/放弃
                if let Some(agent) = self.agent_by_id_mut(agent_id) {
                    agent.coronation_pending = None;
                    agent.expedition_target_camp = None;
                    agent.current_need = None;
                }
                continue;
            }
            self.coronate_king(agent_id, camp_id, tick);
        }
    }

    /// 登基（物理规则）：抵达无主营地后成为国王（地区成员变更 + 立王 + 状态落地）
    fn coronate_king(&mut self, agent_id: u32, camp_id: u32, tick: u64) {
        let camp_name = self.pois.iter()
            .find(|p| p.poi_type == crate::spatial::poi::PoiType::Camp && p.id == camp_id)
            .map(|p| p.camp_title())
            .unwrap_or_else(|| format!("营地#{}", camp_id));

        // READ: 原地区
        let old_camp = self.region_registry.region_of(agent_id);
        let arrival = self.agent_by_id(agent_id).map(|a| a.arrival_tick).unwrap_or(tick);

        // WRITE: 地区成员变更
        if old_camp != Some(camp_id) {
            if old_camp.is_some() {
                self.region_registry.remove_member(agent_id, tick);
            }
            self.region_registry.add_member(camp_id, agent_id, tick, arrival);
        }

        // WRITE: 立王（历史国王入档，见 Region::set_king）
        if let Some(region) = self.region_registry.regions.get_mut(&camp_id) {
            region.set_king(agent_id, tick, &format!("夺位远征登基：【{}】", camp_name), None);
        }

        // WRITE: agent 状态
        let camp_node = self.pois.iter()
            .find(|p| p.poi_type == crate::spatial::poi::PoiType::Camp && p.id == camp_id)
            .and_then(|p| self.find_nearest_node(p.pos));
        if let Some(agent) = self.agent_by_id_mut(agent_id) {
            agent.state = crate::spatial::agent::PrimitiveActionState::RestingAtCamp;
            agent.current_need = Some("SelfActualization·King".to_string());
            agent.coronation_pending = None;
            agent.expedition_target_camp = None;
            if let Some(node) = camp_node {
                agent.home_camp_node = node;
            }
        }

        self.last_event = Some(format!("👑 胜者为王：部落民 #{} 率先抵达，登基为【{}】第一任国王！", agent_id, camp_name));
    }

    pub fn build_decision_context(&self) -> DecisionContext {
        let mut water_nodes = Vec::new();
        let mut food_nodes = Vec::new();
        let mut wood_nodes = Vec::new();
        let mut stone_nodes = Vec::new();
        let mut gold_nodes = Vec::new();
        let mut market_nodes = Vec::new();
        let mut camp_positions = Vec::new();
        let mut camp_pois = Vec::new();

        for poi in &self.pois {
            let Some(node) = self.find_nearest_node(poi.pos) else { continue };
            let target = ResourceNode { poi_id: poi.id, node };
            match poi.poi_type {
                PoiType::WaterSource => water_nodes.push(target),
                PoiType::BerryBush => food_nodes.push(target),
                PoiType::WoodForest => wood_nodes.push(target),
                PoiType::StoneQuarry => stone_nodes.push(target),
                PoiType::GoldMine => gold_nodes.push(target),
                PoiType::Market => market_nodes.push(target),
                PoiType::Camp => {
                    camp_positions.push((node, poi.pos));
                    camp_pois.push((poi.id, poi.pos));
                }
            }
        }

        DecisionContext {
            water_nodes,
            food_nodes,
            wood_nodes,
            stone_nodes,
            gold_nodes,
            market_nodes,
            camp_positions,
            camp_pois,
        }
    }
}
