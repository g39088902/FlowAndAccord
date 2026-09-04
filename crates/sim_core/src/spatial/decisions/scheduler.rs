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
            tick: self.tick_counter,
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
        // ★ 求偶物理规则：把本拍内 male agent 自主下定决心（courtship_pending）的成婚登记落地
        self.execute_pending_courtships();
        // ★ v1.26.0 竞拍物理规则：把本拍内无房成年男性自主下定决心（pending_bid_house_id）的出价落地
        self.execute_pending_bids();
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
                // ★ v1.22.0 防御：无法从原地区移除（如已是原地区国王）则中止登基，避免一人跨多地区/多王
                if !self.region_registry.remove_member(agent_id, tick) {
                    if let Some(a) = self.agent_by_id_mut(agent_id) {
                        a.coronation_pending = None;
                        a.expedition_target_camp = None;
                    }
                    self.last_event = Some(format!("👑 #{} 已是别地国王，放弃对【{}】的登基", agent_id, camp_name));
                    return;
                }
            }
            self.region_registry.add_member(camp_id, agent_id, tick, arrival);
        }

        // WRITE: 立王（历史国王入档，见 Region::set_king）
        let mut coronated = false;
        if let Some(region) = self.region_registry.regions.get_mut(&camp_id) {
            coronated = region.set_king(agent_id, tick, &format!("夺位远征登基：【{}】", camp_name), None);
        }

        // WRITE: agent 状态与威望加成
        let bonus = self.config.prestige_king_bonus;
        let camp_node = self.pois.iter()
            .find(|p| p.poi_type == crate::spatial::poi::PoiType::Camp && p.id == camp_id)
            .and_then(|p| self.find_nearest_node(p.pos));
        if let Some(agent) = self.agent_by_id_mut(agent_id) {
            agent.enter_stationary_state(crate::spatial::agent::PrimitiveActionState::RestingAtCamp);
            agent.current_need = Some("SelfActualization·King".to_string());
            agent.coronation_pending = None;
            agent.expedition_target_camp = None;
            if coronated {
                agent.prestige = agent.prestige.saturating_add(bonus);
            }
            if let Some(node) = camp_node {
                agent.home_camp_node = node;
            }
        }

        self.last_event = Some(format!("👑 胜者为王：部落民 #{} 率先抵达，登基为【{}】第一任国王！", agent_id, camp_name));
    }

    // ══════════════════════════════════════════════════════════
    // ★ 求偶成婚 · 物理规则执行器（决策由马斯洛引擎驱动，此处只执行物理结算）
    // ══════════════════════════════════════════════════════════

    /// 求偶物理规则执行器：扫描本拍内 male agent 自主写下的求偶达成决心（courtship_pending），
    /// 校验双方资格（在世、单身、女方未孕）后执行结婚登记并转籍家户。
    /// 与 execute_pending_coronations / materialize_founded_houses 同模式：系统只当物理规则执行者。
    pub fn execute_pending_courtships(&mut self) {
        let tick = self.tick_counter;
        let mut pending: Vec<(u32, u32)> = Vec::new(); // (male_id, female_id)
        for agent in &self.agents {
            if let Some(female_id) = agent.courtship_pending {
                pending.push((agent.id, female_id));
            }
        }
        if pending.is_empty() {
            return;
        }

        for (male_id, female_id) in pending {
            // 清空男方的 pending 决心
            if let Some(male) = self.agent_by_id_mut(male_id) {
                male.courtship_pending = None;
            }

            // 资格二次原子核验
            let male_eligible = self.agent_by_id(male_id).map(|a| {
                a.is_alive && a.gender == crate::spatial::agent::Gender::Male && a.spouse_id.is_none()
            }).unwrap_or(false);
            let female_eligible = self.agent_by_id(female_id).map(|a| {
                a.is_alive && a.gender == crate::spatial::agent::Gender::Female && a.spouse_id.is_none() && !a.is_pregnant
            }).unwrap_or(false);

            if !male_eligible || !female_eligible {
                if let Some(male) = self.agent_by_id_mut(male_id) {
                    male.courtship_target_id = None;
                    if male.state == crate::spatial::agent::PrimitiveActionState::SeekingCourtship {
                        male.enter_stationary_state(crate::spatial::agent::PrimitiveActionState::RestingAtCamp);
                    }
                }
                continue;
            }

            // 登记婚姻（登记簿保证存续唯一性；失败则不结）
            let Some(_marriage_id) = self.marriage_registry.register(male_id, female_id, tick) else {
                if let Some(male) = self.agent_by_id_mut(male_id) {
                    male.courtship_target_id = None;
                    if male.state == crate::spatial::agent::PrimitiveActionState::SeekingCourtship {
                        male.enter_stationary_state(crate::spatial::agent::PrimitiveActionState::RestingAtCamp);
                    }
                }
                continue;
            };

            // 获取男方家户 ID（无家户则自动建户）
            let male_hid = match self.household_registry.household_of(male_id) {
                Some(hid) => hid,
                None => self.household_registry.create(male_id, None, tick),
            };

            // 女方转入男方家户（家庭跟着男人走）
            self.household_registry.transfer_member(female_id, male_hid, tick);

            // 更新男方状态
            if let Some(male) = self.agent_by_id_mut(male_id) {
                male.spouse_id = Some(female_id);
                male.courtship_target_id = None;
                if male.state == crate::spatial::agent::PrimitiveActionState::SeekingCourtship {
                    male.enter_stationary_state(crate::spatial::agent::PrimitiveActionState::RestingAtCamp);
                }
            }

            // 更新女方状态与房产居住
            let house_info = self.houses.iter_mut().find(|h| h.owner_id == Some(male_id)).map(|h| {
                h.spouse_id = Some(female_id);
                (h.id, h.door_node_id)
            });

            let is_remarriage = if let Some(female) = self.agent_by_id_mut(female_id) {
                female.spouse_id = Some(male_id);
                if let Some((house_id, door_node_id)) = house_info {
                    female.home_house_id = Some(house_id);
                    female.home_camp_node = door_node_id;
                }
                !female.children_ids.is_empty()
            } else {
                false
            };

            if is_remarriage {
                self.last_event = Some(format!(
                    "💍 族人求偶改嫁成家: 女性 #{} ♀ 改嫁家户户主 #{} ♂（入家户 #{}）！",
                    female_id, male_id, male_hid
                ));
            } else {
                self.last_event = Some(format!(
                    "💍 族人求偶喜结连理: 男性 #{} ♂ 成功迎娶单身女性 #{} ♀（入家户 #{}）！",
                    male_id, female_id, male_hid
                ));
            }
        }
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

        // ★ 求偶候选池：预收集全图在世、成年、单身、未孕的女性
        let mut eligible_females = Vec::new();
        for a in &self.agents {
            if a.is_alive
                && a.gender == crate::spatial::agent::Gender::Female
                && !a.is_fetus
                && a.age >= self.config.agent_adult_age
                && a.spouse_id.is_none()
                && !a.is_pregnant
            {
                if let Some(node) = self.find_nearest_node(a.world_pos) {
                    eligible_females.push(EligibleFemale {
                        id: a.id,
                        pos: a.world_pos,
                        libido: a.libido,
                        nearest_node: node,
                    });
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
            eligible_females,
        }
    }
}
