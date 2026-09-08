//! preemption.rs · 分级任务抢占与平滑中断机制 (M19.4b)
//! 负责在 L1 仲裁中评估正在进行的任务是否被危机生存或更高优先级意图打断，
//! 实行平滑掉头重路由，严禁瞬移，保留随身行囊与建材进度。

use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::house::HouseTier;
use super::super::ledger::journal::ResourceKind;
use super::branches::BranchId;
use super::needs::*;
use super::evaluate::Decisioner;
use super::strategy::{ActiveTask, ExecutionStrategy, ResourceStage, HomeStage, CommitStage};
use super::primitive::{ActionPrimitive, ArrivalKind, HoldKind};
use super::intent::{IntentKind, GoldPurpose};
use super::transition;

impl<'a> Decisioner<'a> {
    /// 检查当前 agent 是否正在执行娱乐淘金（Tier 4 自我实现奢靡消遣）
    pub fn is_executing_gold_wealth(&self, agent: &Agent3D) -> bool {
        if let Some(task) = &agent.active_task {
            if matches!(task.intent.kind, IntentKind::AcquireGold(GoldPurpose::Wealth)) {
                return true;
            }
        }
        (agent.state == PrimitiveActionState::SeekingGold || agent.state == PrimitiveActionState::MiningGold)
            && !family_stock_on(agent, ResourceKind::Gold)
    }

    /// 检查当前 agent 是否正在采收集运建材（木/石）
    pub fn is_executing_building_material(&self, agent: &Agent3D) -> bool {
        if let Some(task) = &agent.active_task {
            if matches!(task.intent.kind, IntentKind::StockHousehold(ResourceKind::Stone) | IntentKind::StockHousehold(ResourceKind::Wood)) {
                return true;
            }
        }
        matches!(
            agent.state,
            PrimitiveActionState::SeekingWood
                | PrimitiveActionState::GatheringWood
                | PrimitiveActionState::SeekingStone
                | PrimitiveActionState::MiningStone
        )
    }

    /// 检查当前 agent 是否正在进行远征夺位
    pub fn is_executing_seek_throne(&self, agent: &Agent3D) -> bool {
        if let Some(task) = &agent.active_task {
            if matches!(task.intent.kind, IntentKind::ClaimThrone) {
                return true;
            }
        }
        agent.state == PrimitiveActionState::SeekingThrone
    }

    /// 检查当前 agent 是否正在房屋施工升级或修缮
    pub fn is_executing_construction_or_repair(&self, agent: &Agent3D) -> bool {
        if let Some(task) = &agent.active_task {
            if matches!(task.intent.kind, IntentKind::RepairHome | IntentKind::UpgradeHome { .. }) {
                return true;
            }
        }
        matches!(agent.state, PrimitiveActionState::ConstructingHouse | PrimitiveActionState::RepairingHouse)
    }

    /// ★ M19.4b 分级任务抢占核心仲裁器：
    /// 依据抢占策略矩阵（Preemption Matrix）在决策节拍核验当前活动任务是否允许并需要被更高紧急度需求中断。
    /// 若发生抢占，清空旧任务控制器、保留随身背包、沿车道平滑掉头重路由并安装新 ActiveTask，返回 true；
    /// 若无抢占，返回 false（由调用方继续步进原任务）。
    pub fn try_preempt_task(&mut self, agent: &mut Agent3D) -> bool {
        if !agent.is_alive || agent.is_fetus || agent.state == PrimitiveActionState::Dead {
            return false;
        }

        // ──────────────────────────────────────────────────────────
        // 矩阵行 1：娱乐淘金 (GoldWealth)
        // 允许被何种意图抢占：任何生理需求、安全储备、私宅修缮、登基远征
        // ──────────────────────────────────────────────────────────
        if self.is_executing_gold_wealth(agent) {
            if let Some((branch, need)) = self.arbitrate_sustained_task(agent) {
                if branch != BranchId::B13GoldWealth {
                    agent.gold_mining_cooldown = self.config.decision_gold_wealth_cooldown;
                    if need.kind == NeedKind::Rest {
                        transition::preempt_task(agent);
                        self.return_home(agent);
                        agent.current_need = Some("Physiological·Rest".to_string());
                        return true;
                    }
                    return self.dispatch_preempted_task(agent, branch, need);
                }
            }
            return false;
        }

        // ──────────────────────────────────────────────────────────
        // 矩阵行 2：建材采收 (StockStone / StockWood)
        // 允许被何种意图抢占：临界饥渴、冬季暴雪私宅断柴 (<10)、私宅耐久危机 (<20%)
        // ──────────────────────────────────────────────────────────
        if self.is_executing_building_material(agent) {
            // 1. 临界生理危机 (Thirst / Hunger < 15)
            if agent.thirst < self.config.decision_critical_thirst {
                self.preempt_critical_survival(agent, NeedKind::QuenchThirst);
                return true;
            }
            if agent.hunger < self.config.decision_critical_hunger {
                self.preempt_critical_survival(agent, NeedKind::SateHunger);
                return true;
            }

            let home_house = agent.home_house_id
                .and_then(|hid| self.houses.iter().find(|h| h.id == hid));

            // 2. 冬季暴雪私宅断柴 (<10)：气温低于阈值、非 0 级仓库、且木材 < 10
            let is_freezing = self.ctx.temperature < self.config.house_winter_cold_temp;
            let has_warm_house = home_house.map(|h| h.tier != HouseTier::Tier0Warehouse).unwrap_or(false);
            let firewood_deficit = self.ledger_balance(agent, ResourceKind::Wood) < 10.0;
            let not_already_wood = !matches!(agent.state, PrimitiveActionState::SeekingWood | PrimitiveActionState::GatheringWood);

            if is_freezing && has_warm_house && firewood_deficit && not_already_wood {
                let need = Need {
                    level: MaslowLevel::Safety,
                    kind: NeedKind::StockWood,
                    target_state: PrimitiveActionState::SeekingWood,
                };
                return self.dispatch_preempted_task(agent, BranchId::B7StockWood, need);
            }

            // 3. 私宅耐久危机 (< 20%)：私宅耐久濒临崩塌，抢修优先
            let durability_critical = home_house.map(|h| h.durability < self.config.house_durability_max * 0.20).unwrap_or(false);
            if durability_critical {
                let need = Need {
                    level: MaslowLevel::Safety,
                    kind: NeedKind::RepairHouse,
                    target_state: PrimitiveActionState::RepairingHouse,
                };
                return self.dispatch_preempted_task(agent, BranchId::B4RepairHouse, need);
            }

            return false;
        }

        // ──────────────────────────────────────────────────────────
        // 矩阵行 3：远征登基 (SeekThrone)
        // 允许被何种意图抢占：临界饥渴濒死
        // ──────────────────────────────────────────────────────────
        if self.is_executing_seek_throne(agent) {
            if agent.thirst < self.config.decision_critical_thirst {
                agent.expedition_target_camp = None;
                agent.coronation_pending = None;
                self.preempt_critical_survival(agent, NeedKind::QuenchThirst);
                return true;
            }
            if agent.hunger < self.config.decision_critical_hunger {
                agent.expedition_target_camp = None;
                agent.coronation_pending = None;
                self.preempt_critical_survival(agent, NeedKind::SateHunger);
                return true;
            }
            return false;
        }

        // ──────────────────────────────────────────────────────────
        // 矩阵行 4：升级施工 / 修缮 (ConstructingHouse / RepairingHouse)
        // 允许被何种意图抢占：临界求生、王位空缺加冕
        // 动作：暂停施工/修缮，进度冻结不回滚
        // ──────────────────────────────────────────────────────────
        if self.is_executing_construction_or_repair(agent) {
            // 1. 临界求生
            if agent.thirst < self.config.decision_critical_thirst {
                if agent.state == PrimitiveActionState::ConstructingHouse {
                    agent.build_timer = 0.0;
                }
                self.preempt_critical_survival(agent, NeedKind::QuenchThirst);
                return true;
            }
            if agent.hunger < self.config.decision_critical_hunger {
                if agent.state == PrimitiveActionState::ConstructingHouse {
                    agent.build_timer = 0.0;
                }
                self.preempt_critical_survival(agent, NeedKind::SateHunger);
                return true;
            }

            // 2. 王位空缺加冕：若有营地王位空缺且自身具备资格，暂停施工奔赴加冕
            if let Some(throne_need) = BranchId::B14SeekThrone.evaluate(self, agent) {
                if agent.state == PrimitiveActionState::ConstructingHouse {
                    agent.build_timer = 0.0;
                }
                return self.dispatch_preempted_task(agent, BranchId::B14SeekThrone, throne_need);
            }

            return false;
        }

        // ──────────────────────────────────────────────────────────
        // 补充保护：自立门户建房选址中途 (FoundHome) 遇临界饥渴
        // ──────────────────────────────────────────────────────────
        if agent.pending_house_pos.is_some() {
            if agent.thirst < self.config.decision_critical_thirst {
                agent.pending_house_pos = None;
                self.preempt_critical_survival(agent, NeedKind::QuenchThirst);
                return true;
            }
            if agent.hunger < self.config.decision_critical_hunger {
                agent.pending_house_pos = None;
                self.preempt_critical_survival(agent, NeedKind::SateHunger);
                return true;
            }
        }

        false
    }

    /// 临界生理生存紧急抢占转向
    fn preempt_critical_survival(&mut self, agent: &mut Agent3D, kind: NeedKind) {
        let (branch, target_state, pool) = match kind {
            NeedKind::QuenchThirst => (BranchId::B1QuenchThirst, PrimitiveActionState::SeekingWater, NodePool::Water),
            NeedKind::SateHunger => (BranchId::B2SateHunger, PrimitiveActionState::SeekingFood, NodePool::Food),
            _ => return,
        };
        let need = Need {
            level: MaslowLevel::Physiological,
            kind,
            target_state,
        };
        if self.has_available_node(agent, pool) {
            self.dispatch_preempted_task(agent, branch, need);
        } else if !self.try_route_to_market(agent, pool) {
            transition::preempt_task(agent);
            self.return_home(agent);
        }
    }

    /// 执行抢占派发：清空旧任务控制器、保留背包、平滑重路由并安装新 ActiveTask
    pub fn dispatch_preempted_task(&mut self, agent: &mut Agent3D, branch: BranchId, need: Need) -> bool {
        transition::preempt_task(agent);

        let home_house = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid));
        let home_tier = home_house.map(|h| h.tier);
        let intent = need.observe_intent(branch, home_tier).ok().and_then(|obs| obs.sustained());

        agent.current_need = state_need_label_with_agent(
            need.target_state,
            agent,
            self.houses,
            self.households,
            self.config,
        ).map(|(lvl, k)| format!("{}·{}", lvl, k));

        match need.kind {
            NeedKind::QuenchThirst | NeedKind::StockWater => {
                let pool = NodePool::Water;
                if let Some(target) = self.nearest_of(agent, pool, agent.world_pos) {
                    let at_target = agent.current_lane_id.is_none()
                        && agent.world_pos.distance_to(&self.node_pos(target)) <= self.config.poi_interaction_radius;
                    if at_target {
                        agent.enter_stationary_state(PrimitiveActionState::DrinkingAtWater);
                        if let Some(intent) = intent {
                            let poi = pool.nodes(self.ctx).iter().find(|rn| rn.node == target).map(|rn| rn.poi_id);
                            let task = ActiveTask {
                                intent,
                                strategy: ExecutionStrategy::WildHarvest {
                                    pool,
                                    poi,
                                    stage: ResourceStage::OnSite,
                                },
                                primitive: ActionPrimitive::Hold(poi.map(HoldKind::ResourceSite).unwrap_or(HoldKind::Residence)),
                            };
                            transition::install_task(agent, task);
                        }
                        return true;
                    }
                    if self.route_or_turn_around(agent, target, need.target_state) {
                        if let Some(intent) = intent {
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
                        return true;
                    }
                }
                if self.try_route_to_market(agent, pool) {
                    return true;
                }
                self.return_home(agent);
                true
            }
            NeedKind::SateHunger | NeedKind::StockFood => {
                let pool = NodePool::Food;
                if let Some(target) = self.nearest_of(agent, pool, agent.world_pos) {
                    let at_target = agent.current_lane_id.is_none()
                        && agent.world_pos.distance_to(&self.node_pos(target)) <= self.config.poi_interaction_radius;
                    if at_target {
                        agent.enter_stationary_state(PrimitiveActionState::ForagingFood);
                        if let Some(intent) = intent {
                            let poi = pool.nodes(self.ctx).iter().find(|rn| rn.node == target).map(|rn| rn.poi_id);
                            let task = ActiveTask {
                                intent,
                                strategy: ExecutionStrategy::WildHarvest {
                                    pool,
                                    poi,
                                    stage: ResourceStage::OnSite,
                                },
                                primitive: ActionPrimitive::Hold(poi.map(HoldKind::ResourceSite).unwrap_or(HoldKind::Residence)),
                            };
                            transition::install_task(agent, task);
                        }
                        return true;
                    }
                    if self.route_or_turn_around(agent, target, need.target_state) {
                        if let Some(intent) = intent {
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
                        return true;
                    }
                }
                if self.try_route_to_market(agent, pool) {
                    return true;
                }
                self.return_home(agent);
                true
            }
            NeedKind::StockWood => {
                let pool = NodePool::Wood;
                if let Some(target) = self.nearest_of(agent, pool, agent.world_pos) {
                    let at_target = agent.current_lane_id.is_none()
                        && agent.world_pos.distance_to(&self.node_pos(target)) <= self.config.poi_interaction_radius;
                    if at_target {
                        agent.enter_stationary_state(PrimitiveActionState::GatheringWood);
                        if let Some(intent) = intent {
                            let poi = pool.nodes(self.ctx).iter().find(|rn| rn.node == target).map(|rn| rn.poi_id);
                            let task = ActiveTask {
                                intent,
                                strategy: ExecutionStrategy::WildHarvest {
                                    pool,
                                    poi,
                                    stage: ResourceStage::OnSite,
                                },
                                primitive: ActionPrimitive::Hold(poi.map(HoldKind::ResourceSite).unwrap_or(HoldKind::Residence)),
                            };
                            transition::install_task(agent, task);
                        }
                        return true;
                    }
                    if self.route_or_turn_around(agent, target, need.target_state) {
                        if let Some(intent) = intent {
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
                        return true;
                    }
                }
                if self.try_route_to_market(agent, pool) {
                    return true;
                }
                self.return_home(agent);
                true
            }
            NeedKind::StockStone => {
                let pool = NodePool::Stone;
                if let Some(target) = self.nearest_of(agent, pool, agent.world_pos) {
                    let at_target = agent.current_lane_id.is_none()
                        && agent.world_pos.distance_to(&self.node_pos(target)) <= self.config.poi_interaction_radius;
                    if at_target {
                        agent.enter_stationary_state(PrimitiveActionState::MiningStone);
                        if let Some(intent) = intent {
                            let poi = pool.nodes(self.ctx).iter().find(|rn| rn.node == target).map(|rn| rn.poi_id);
                            let task = ActiveTask {
                                intent,
                                strategy: ExecutionStrategy::WildHarvest {
                                    pool,
                                    poi,
                                    stage: ResourceStage::OnSite,
                                },
                                primitive: ActionPrimitive::Hold(poi.map(HoldKind::ResourceSite).unwrap_or(HoldKind::Residence)),
                            };
                            transition::install_task(agent, task);
                        }
                        return true;
                    }
                    if self.route_or_turn_around(agent, target, need.target_state) {
                        if let Some(intent) = intent {
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
                        return true;
                    }
                }
                self.return_home(agent);
                true
            }
            NeedKind::RepairHouse => {
                let target = self.home_target(agent);
                let home_pos = self.node_pos(target);
                let at_home = agent.current_lane_id.is_none()
                    && agent.world_pos.distance_to(&home_pos) <= self.config.poi_interaction_radius;
                if at_home {
                    agent.enter_stationary_state(PrimitiveActionState::RepairingHouse);
                    if let Some(intent) = intent {
                        let task = ActiveTask {
                            intent,
                            strategy: ExecutionStrategy::RepairHome {
                                house: agent.home_house_id.unwrap_or(0),
                                stage: HomeStage::Working,
                            },
                            primitive: ActionPrimitive::Hold(HoldKind::Repair),
                        };
                        transition::install_task(agent, task);
                    }
                } else if self.route_or_turn_around(agent, target, PrimitiveActionState::RepairingHouse) {
                    if let Some(intent) = intent {
                        let task = ActiveTask {
                            intent,
                            strategy: ExecutionStrategy::RepairHome {
                                house: agent.home_house_id.unwrap_or(0),
                                stage: HomeStage::Returning,
                            },
                            primitive: ActionPrimitive::Navigate {
                                target,
                                arrival: ArrivalKind::Residence,
                            },
                        };
                        transition::install_task(agent, task);
                    }
                }
                true
            }
            NeedKind::SeekThrone => {
                let home_camp_id = agent.home_house_id
                    .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                    .map(|h| h.camp_id);
                let Some(camp_id) = self.eligible_leaderless_camp(agent, home_camp_id.is_some(), home_camp_id) else {
                    return false;
                };
                let Some(target_node) = self.camp_node_of(camp_id) else {
                    return false;
                };
                agent.expedition_target_camp = Some(camp_id);
                if self.route_or_turn_around(agent, target_node, PrimitiveActionState::SeekingThrone) {
                    if let Some(intent) = intent {
                        let task = ActiveTask {
                            intent,
                            strategy: ExecutionStrategy::ClaimThrone {
                                camp: camp_id,
                                stage: CommitStage::Travelling,
                            },
                            primitive: ActionPrimitive::Navigate {
                                target: target_node,
                                arrival: ArrivalKind::SocialTarget,
                            },
                        };
                        transition::install_task(agent, task);
                    }
                    return true;
                }
                false
            }
            NeedKind::Rest => {
                self.return_home(agent);
                true
            }
            _ => {
                self.dispatch_task(agent, branch, need);
                true
            }
        }
    }
}
