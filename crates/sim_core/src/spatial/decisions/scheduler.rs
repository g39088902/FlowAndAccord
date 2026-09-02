use super::super::poi::PoiType;
use super::super::world::World3DEngine;
use super::branches;
use super::needs::*;
use super::evaluate::Decisioner;

impl World3DEngine {
    /// 错峰决策调度: 每 tick 调用一次；每个 agent 仅在 (tick + id) % AGENT_DECISION_INTERVAL_TICKS 的相位上决策
    pub fn tick_decisions(&mut self) {
        // ★ M4 夺位远征：最高优先级，在马斯洛需求评估之前处理
        self.tick_conquest_expedition();

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
        // 实体化登记：将本拍内 agent 自主选定的宅址落地为 0 级仓库（放置校验/路网接入/房产绑定）
        self.materialize_founded_houses();
    }

    /// 收集全图资源节点与营地坐标；每名 Agent 会用自己的触发器过滤候选。
    // ══════════════════════════════════════════════════════════
    // ★ M4 夺位远征：男性非国王冲向无主营地登基（最高优先级）
    // ══════════════════════════════════════════════════════════

    /// 夺位远征总入口：每 tick 调用。
    /// 1. 处理已在远征中的 agent（抵达登基 / 目标易主重定向 / 放弃）
    /// 2. 在决策相位检查未远征 agent 是否满足远征触发条件
    pub fn tick_conquest_expedition(&mut self) {
        let tick = self.tick_counter;
        let interval = self.config.agent_decision_interval_ticks;
        let interact_radius = self.config.poi_interaction_radius;

        enum ExpeditionAction {
            Coronate { agent_id: u32, camp_id: u32 },
            Redirect { agent_id: u32, new_camp: u32 },
            Abandon { agent_id: u32 },
            Start { agent_id: u32, target_camp: u32 },
        }
        let mut actions: Vec<ExpeditionAction> = Vec::new();

        // 收集无主营地列表
        let mut leaderless_camps: Vec<(u32, crate::spatial::vec3::Vec3)> = Vec::new();
        for (camp_id, region) in &self.region_registry.regions {
            if region.group.leader.is_none() {
                if let Some(camp_poi) = self.pois.iter().find(|p| {
                    p.poi_type == crate::spatial::poi::PoiType::Camp && p.id == *camp_id
                }) {
                    leaderless_camps.push((*camp_id, camp_poi.pos));
                }
            }
        }

        // 收集所有国王 ID
        let mut king_ids: std::collections::BTreeSet<u32> = std::collections::BTreeSet::new();
        for region in self.region_registry.regions.values() {
            if let Some(king) = region.group.leader {
                king_ids.insert(king);
            }
        }

        for agent in &self.agents {
            if !agent.is_alive { continue; }

            if agent.state == crate::spatial::agent::PrimitiveActionState::SeekingThrone {
                let Some(&target_camp) = self.expedition_targets.get(&agent.id) else {
                    actions.push(ExpeditionAction::Abandon { agent_id: agent.id });
                    continue;
                };
                let target_pos = leaderless_camps.iter().find(|(cid, _)| *cid == target_camp).map(|(_, pos)| *pos);
                let target_still_leaderless = target_pos.is_some();

                if let Some(pos) = target_pos {
                    if agent.world_pos.distance_to(&pos) < interact_radius {
                        actions.push(ExpeditionAction::Coronate { agent_id: agent.id, camp_id: target_camp });
                        continue;
                    }
                }
                if !target_still_leaderless {
                    if !leaderless_camps.is_empty() {
                        let new_target = leaderless_camps.iter()
                            .min_by(|a, b| agent.world_pos.distance_to(&a.1).partial_cmp(&agent.world_pos.distance_to(&b.1)).unwrap())
                            .map(|(cid, _)| *cid).unwrap_or(target_camp);
                        if new_target != target_camp {
                            actions.push(ExpeditionAction::Redirect { agent_id: agent.id, new_camp: new_target });
                        }
                    } else {
                        actions.push(ExpeditionAction::Abandon { agent_id: agent.id });
                    }
                }
            } else if (tick + agent.id as u64) % interval == 0 {
                if agent.gender != crate::spatial::agent::Gender::Male { continue; }
                if king_ids.contains(&agent.id) { continue; }
                if leaderless_camps.is_empty() { continue; }
                let target_camp = leaderless_camps.iter()
                    .min_by(|a, b| agent.world_pos.distance_to(&a.1).partial_cmp(&agent.world_pos.distance_to(&b.1)).unwrap())
                    .map(|(cid, _)| *cid).unwrap_or(1);
                actions.push(ExpeditionAction::Start { agent_id: agent.id, target_camp });
            }
        }

        for action in actions {
            match action {
                ExpeditionAction::Coronate { agent_id, camp_id } => self.coronate_king(agent_id, camp_id, tick),
                ExpeditionAction::Redirect { agent_id, new_camp } => self.redirect_expedition(agent_id, new_camp),
                ExpeditionAction::Abandon { agent_id } => self.abandon_expedition(agent_id),
                ExpeditionAction::Start { agent_id, target_camp } => self.start_expedition(agent_id, target_camp),
            }
        }
    }

    /// 开始夺位远征：READ 路径数据 → WRITE agent 状态
    fn start_expedition(&mut self, agent_id: u32, target_camp: u32) {
        // READ PHASE
        let agent_info = self.agent_by_id(agent_id).map(|a| (a.world_pos, a.home_camp_node, a.is_covert));
        let Some((agent_pos, agent_home, agent_covert)) = agent_info else { return };

        let target_node = self.pois.iter()
            .find(|p| p.poi_type == crate::spatial::poi::PoiType::Camp && p.id == target_camp)
            .and_then(|p| self.find_nearest_node(p.pos))
            .unwrap_or(1);
        let start_node = self.find_nearest_node(agent_pos).unwrap_or(agent_home);
        let path = self.network.find_path_3d_with_preference(start_node, target_node, agent_covert, &self.config);

        // WRITE PHASE
        self.expedition_targets.insert(agent_id, target_camp);
        if let Some(agent) = self.agent_by_id_mut(agent_id) {
            agent.state = crate::spatial::agent::PrimitiveActionState::SeekingThrone;
            agent.current_need = Some("SelfActualization·SeekingThrone".to_string());
            if let Some(path) = path {
                if !path.is_empty() {
                    agent.target_poi_node = Some(target_node);
                    agent.route = path;
                    agent.route_index = 0;
                    agent.current_lane_id = Some(agent.route[0]);
                    agent.distance_along_curve = 0.0;
                }
            }
        }
    }

    /// 登基：抵达无主营地后成为国王
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

        // WRITE: 设置国王
        if let Some(region) = self.region_registry.regions.get_mut(&camp_id) {
            region.group.set_leader(agent_id, tick, &format!("夺位远征登基：【{}】", camp_name));
        }

        // WRITE: agent 状态
        let camp_node = self.pois.iter()
            .find(|p| p.poi_type == crate::spatial::poi::PoiType::Camp && p.id == camp_id)
            .and_then(|p| self.find_nearest_node(p.pos));
        if let Some(agent) = self.agent_by_id_mut(agent_id) {
            agent.state = crate::spatial::agent::PrimitiveActionState::RestingAtCamp;
            agent.current_need = Some("SelfActualization·King".to_string());
            if let Some(node) = camp_node {
                agent.home_camp_node = node;
            }
        }

        self.expedition_targets.remove(&agent_id);
        self.last_event = Some(format!("👑 胜者为王：部落民 #{} 率先抵达，登基为【{}】第一任国王！", agent_id, camp_name));
    }

    /// 重定向远征：目标易主后转向最近的新无主营地
    fn redirect_expedition(&mut self, agent_id: u32, new_camp: u32) {
        self.expedition_targets.insert(agent_id, new_camp);

        // READ PHASE
        let agent_info = self.agent_by_id(agent_id).map(|a| {
            (a.world_pos, a.home_camp_node, a.is_covert, a.current_lane_id, a.distance_along_curve)
        });
        let Some((agent_pos, agent_home, agent_covert, cur_lane, cur_dist)) = agent_info else { return };

        let target_node = self.pois.iter()
            .find(|p| p.poi_type == crate::spatial::poi::PoiType::Camp && p.id == new_camp)
            .and_then(|p| self.find_nearest_node(p.pos))
            .unwrap_or(1);

        // 尝试原地掉头
        let mut route_result: Option<(Vec<u32>, u32, f32)> = None;
        if let Some(lane_id) = cur_lane {
            if let Some(&edge_idx) = self.network.edge_map.get(&lane_id) {
                let from_node = self.network.graph[edge_idx].from_node;
                let to_node = self.network.graph[edge_idx].to_node;
                let from_idx = self.network.node_map[&from_node];
                let to_idx = self.network.node_map[&to_node];
                if let Some(rev_edge_idx) = self.network.graph.find_edge(to_idx, from_idx) {
                    let rev_lane = &self.network.graph[rev_edge_idx];
                    let rev_lane_id = rev_lane.id;
                    let rev_len = rev_lane.curve.length;
                    let route = if from_node == target_node {
                        vec![rev_lane_id]
                    } else if let Some(remaining) = self.network.find_path_3d_with_preference(from_node, target_node, agent_covert, &self.config) {
                        let mut r = Vec::with_capacity(1 + remaining.len());
                        r.push(rev_lane_id);
                        r.extend(remaining);
                        r
                    } else {
                        vec![rev_lane_id]
                    };
                    route_result = Some((route, rev_lane_id, (rev_len - cur_dist).clamp(0.0, rev_len)));
                }
            }
        }

        // 掉头失败：从当前位置重新规划
        if route_result.is_none() {
            let start_node = self.find_nearest_node(agent_pos).unwrap_or(agent_home);
            if let Some(path) = self.network.find_path_3d_with_preference(start_node, target_node, agent_covert, &self.config) {
                if !path.is_empty() {
                    let first_lane = path[0];
                    route_result = Some((path, first_lane, 0.0));
                }
            }
        }

        // WRITE PHASE
        if let Some((route, first_lane, dist)) = route_result {
            if let Some(agent) = self.agent_by_id_mut(agent_id) {
                agent.target_poi_node = Some(target_node);
                agent.route = route;
                agent.route_index = 0;
                agent.current_lane_id = Some(first_lane);
                agent.distance_along_curve = dist;
            }
        }
    }

    /// 放弃远征：无无主营地时恢复正常决策
    fn abandon_expedition(&mut self, agent_id: u32) {
        self.expedition_targets.remove(&agent_id);
        if let Some(agent) = self.agent_by_id_mut(agent_id) {
            agent.state = crate::spatial::agent::PrimitiveActionState::RestingAtCamp;
            agent.current_need = None;
        }
    }

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
