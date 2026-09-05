use super::super::vec3::Vec3;
use super::super::graph::{LaneGraph3D, NodeId};
use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::poi::PoiType;
use super::super::house::House;
use super::super::ledger::family::HouseholdRegistry;
use super::super::ledger::region::RegionRegistry;
use super::super::ledger::journal::ResourceKind;
use super::branches::{self, BranchId};
use super::needs::*;
use crate::config::*;
use crate::rng::WorldRng;

/// 单名族人的马斯洛需求决策器 (持有全部只读上下文，逐人驱动状态机)
pub struct Decisioner<'a> {
    pub ctx: &'a DecisionContext,
    pub network: &'a LaneGraph3D,
    pub houses: &'a [House],
    /// ★ M6 账本化：家户登记簿只读引用（家庭物资唯一真相源 = 家户账本余额）
    pub households: &'a HouseholdRegistry,
    /// ★ M4 地区与王国登记簿只读引用（夺位远征资格 / 国王立宅约束 / 登基判定）
    pub regions: &'a RegionRegistry,
    pub rng: &'a mut WorldRng,
    pub config: &'a SimConfig,
    /// 本拍使用的分支评估顺序（由 config.decision_eval_order 解析，见 branches.rs）
    pub branch_order: &'a [BranchId; 18],
    /// ★ v1.26.0 当前世界 tick（用于竞拍冷却判定，见 B17BidHouse）
    pub tick: u64,
}

impl<'a> Decisioner<'a> {
    /// ★ 求偶目标检索：按魅力最高优先；魅力相同时距离最近优先；再以 ID 确定性打破并列
    pub fn best_courtship_target(&self, agent: &Agent3D) -> Option<&EligibleFemale> {
        self.ctx.eligible_females.iter().min_by(|a, b| {
            // 1. 魅力 libido 降序（最高优先）
            b.libido.partial_cmp(&a.libido).unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    // 2. 距离当前 agent 空间位置升序（最近优先）
                    let dist_a = a.pos.distance_to(&agent.world_pos);
                    let dist_b = b.pos.distance_to(&agent.world_pos);
                    dist_a.partial_cmp(&dist_b).unwrap_or(std::cmp::Ordering::Equal)
                })
                // 3. ID 升序
                .then_with(|| a.id.cmp(&b.id))
        })
    }

    /// ★ M6 账本化：读取 agent 所属家户账本的品类余额（无家户返回 0.0）
    pub fn ledger_balance(&self, agent: &Agent3D, kind: ResourceKind) -> f32 {
        ledger_balance_of(self.households, agent, kind)
    }

    /// ★ M7 每拍刷新五类家庭库存施密特触发器（输入 = 家户账本余额；滞回，不耗 RNG）。
    /// 在 `decide()` 开头统一调用一次，保证本拍内各分支读取到一致状态。
    pub fn refresh_family_stock(&mut self, agent: &mut Agent3D) {
        let on = self.config.decision_family_stock_trigger_on;
        let off = self.config.decision_family_stock_trigger_off;
        for (i, &rk) in FAMILY_STOCK_ORDER.iter().enumerate() {
            let bal = self.ledger_balance(agent, rk);
            agent.family_stock_active[i] = family_stock_update(agent.family_stock_active[i], bal, on, off);
        }
    }

    /// 核心决策调度
    pub fn decide(&mut self, agent: &mut Agent3D) {
        if !agent.is_alive {
            agent.current_need = None;
            return;
        }
        // ★ M7 先刷新家庭库存触发器（若该 agent 无家户/无房，分支层 guard 短路，不影响行为）
        self.refresh_family_stock(agent);

        // ★ v1.29.0 ⓪ 瞬间行为层：**全状态**、每拍先跑一遍。
        // 命中即刻执行（只写决心，不移动、不消耗资源），因此不占用本回合——
        // 执行后继续遍历后续瞬时分支，全部结算完再进入下面的常规状态机。
        let instant_label = self.evaluate_instant_needs(agent);
        if let Some(label) = &instant_label {
            agent.current_need = Some(label.clone());
        }

        match agent.state {
            PrimitiveActionState::RestingAtCamp => {
                // ecology.rs 在本阶段按速率卸货；卸完前禁止重新评估采集/远征需求，
                // 否则决策节拍可能在半卸货时把 agent 再次派出，造成“送货未完就出门”。
                if agent.home_house_id.is_some() && agent.has_cargo_to_unload() {
                    agent.current_need = Some("Safety·UnloadCargo".to_string());
                    return;
                }
                if let Some(need) = self.evaluate_needs(agent) {
                    agent.current_need = state_need_label_with_agent(need.target_state, agent, self.houses, self.households, self.config)
                        .map(|(lvl, k)| format!("{}·{}", lvl, k));
                    self.fulfill_resting_need(agent, need);
                } else if instant_label.is_none() {
                    // ★ v1.29.0 本拍已执行过瞬间行为且无常规需求：保留瞬间标签，避免行为不可见
                    agent.current_need = Some("Physiological·Rest".to_string());
                    // 未婚且无房的女性没有可执行事务时回所属营地休息，避免长期停在道路节点。
                    if agent.gender == super::super::agent::Gender::Female
                        && agent.spouse_id.is_none()
                        && agent.home_house_id.is_none()
                    {
                        self.return_home(agent);
                    }
                }
            }
            PrimitiveActionState::SeekingWater => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingWater, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_survival(agent, NodePool::Water, PoiType::WaterSource);
            }
            PrimitiveActionState::SeekingFood => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingFood, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_survival(agent, NodePool::Food, PoiType::BerryBush);
            }
            PrimitiveActionState::SeekingWood => {
                agent.current_need = Some("Safety·StockWood".to_string());
                self.decide_seeking_material(agent, NodePool::Wood, PoiType::WoodForest);
            }
            PrimitiveActionState::SeekingStone => {
                agent.current_need = Some("Esteem·StockStone".to_string());
                self.decide_seeking_material(agent, NodePool::Stone, PoiType::StoneQuarry);
            }
            PrimitiveActionState::SeekingGold => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingGold, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_material(agent, NodePool::Gold, PoiType::GoldMine);
            }
            PrimitiveActionState::SeekingThrone => {
                agent.current_need = Some("Physiological·SeekThrone".to_string());
                self.decide_seeking_throne(agent);
            }
            PrimitiveActionState::DrinkingAtWater => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::DrinkingAtWater, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_drinking(agent);
            }
            PrimitiveActionState::ForagingFood => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::ForagingFood, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_foraging(agent);
            }
            PrimitiveActionState::GatheringWood => {
                agent.current_need = Some("Safety·StockWood".to_string());
                let stocked = self.wood_fully_stocked(agent);
                self.decide_harvest(agent, PoiType::WoodForest, stocked);
            }
            PrimitiveActionState::MiningStone => {
                agent.current_need = Some("Esteem·StockStone".to_string());
                let stocked = self.stone_fully_stocked(agent);
                self.decide_harvest(agent, PoiType::StoneQuarry, stocked);
            }
            PrimitiveActionState::MiningGold => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::MiningGold, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_mining_gold(agent);
            }
            PrimitiveActionState::ConstructingHouse => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::ConstructingHouse, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
            }
            PrimitiveActionState::RepairingHouse => {
                agent.current_need = Some("Safety·RepairHouse".to_string());
            }
            PrimitiveActionState::ReturningToCamp => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::ReturningToCamp, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
            }
            PrimitiveActionState::SeekingMarket => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingMarket, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_market(agent);
            }
            PrimitiveActionState::BuyingAtMarket => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::BuyingAtMarket, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_buying_market(agent);
            }
            PrimitiveActionState::SeekingCourtship => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingCourtship, agent, self.houses, self.households, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_courtship(agent);
            }
            PrimitiveActionState::RaiseChild => {
                agent.current_need = Some("Esteem·RaiseChild".to_string());
                // 行动在世界结算阶段完成；下一决策拍重新评估。
                agent.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
            }
            _ => {}
        }
    }

    /// ★ v1.29.0 ⓪ 瞬间行为层评估：**全状态**、每拍最先执行（decide 顶部调用）。
    ///
    /// 只遍历 `BranchId::is_instant()` 白名单分支；结论为瞬间层者**立即执行并 continue**，
    /// 直至白名单遍历结束——因为瞬发动作不移动、不消耗任何资源，本回合没有被占用。
    /// 非瞬间层结论（如远距离求偶）一律忽略，交由后续常规状态机在合适状态下重新评估。
    ///
    /// 确定性：全链路不消耗 `WorldRng`（选房与选偶都用确定性排序）。
    /// 返回最后一条瞬间需求的标签（如 "Instantaneous·BidHouse"），供本拍无常规需求时保留显示。
    pub fn evaluate_instant_needs(&mut self, agent: &mut Agent3D) -> Option<String> {
        let order: &'a [BranchId; 18] = self.branch_order;
        let mut label: Option<String> = None;
        for branch in order.iter() {
            if !branch.is_instant() {
                continue;
            }
            let Some(need) = branch.evaluate(self, agent) else {
                continue;
            };
            if !need.is_instant() {
                continue; // 被层级覆盖降级为常规需求 → 交给常规状态机处理
            }
            label = Some(need.instant_label());
            self.apply_instant_need(agent, need);
        }
        label
    }

    /// ★ v1.29.0 瞬发落地：只写「决心 / pending」，**不 dispatch、不改运动状态、不消耗资源与 RNG**。
    /// 物理结算由世界执行器（`execute_pending_bids` / `execute_pending_courtships` /
    /// `execute_pending_childcare`）在随后完成——系统照例只当物理规则执行者。
    fn apply_instant_need(&mut self, agent: &mut Agent3D, need: Need) {
        match need.kind {
            NeedKind::BidHouse => self.write_bid_pending(agent),
            NeedKind::Courtship => {
                // 目标已在交互半径内（分支已判定）：就地写下求偶决心，当拍由执行器成婚
                if let Some(target) = self.best_courtship_target(agent).copied() {
                    agent.courtship_target_id = Some(target.id);
                    agent.courtship_pending = Some(target.id);
                }
            }
            NeedKind::RaiseChild => {
                // 夫妻已在自家宅门口：就地写下养育决心，下一拍由 childcare 执行器受孕
                agent.raise_child_pending = true;
            }
            _ => {}
        }
    }

    /// 竞拍决心写入（瞬发）：复用 `branches::all_bid_candidates` 的确定性候选全集（升序、不耗 RNG），
    /// 一次性写全部待出价房屋 ID；出价冷却与交割由 `housing_system/auction.rs` 落地。
    fn write_bid_pending(&mut self, agent: &mut Agent3D) {
        agent.pending_bid_house_ids = branches::all_bid_candidates(self, agent);
        agent.pending_bid_upgrade = agent.home_house_id.is_some();
    }

    /// 马斯洛需求逐条评估（数据驱动）：
    /// 按注入的分支顺序迭代 branches.rs 注册表，首个命中即返回；
    /// 命中后套用 decision_eval_levels 层级覆盖（6/缺失 = 保留分支自带的代码动态默认）。
    /// 顺序的唯一真相源在前端配置文件，空/非法注入已由 resolve_order 回退为中性声明序。
    pub fn evaluate_needs(&mut self, agent: &Agent3D) -> Option<Need> {
        let order: &'a [BranchId; 18] = self.branch_order;
        for branch in order.iter() {
            if let Some(mut need) = branch.evaluate(self, agent) {
                if let Some(lv) = branches::level_override_for(self.config, *branch) {
                    need.level = lv;
                }
                // ★ v1.29.0 瞬发命中已在 decide() 顶部结算完毕 → 跳过并继续遍历后续分支
                if need.is_instant() {
                    continue;
                }
                return Some(need);
            }
        }
        None
    }

    pub fn fulfill_resting_need(&mut self, agent: &mut Agent3D, need: Need) {
        // ★ v1.29.0 瞬发需求不得走常规落地链路（会派发移动/改状态）
        if need.is_instant() {
            self.apply_instant_need(agent, need);
            return;
        }
        if need.kind == NeedKind::Rest { return; }
        if need.kind == NeedKind::RaiseChild {
            agent.raise_child_pending = true;
            // 受孕意图需夫妻回到户主住宅后才执行；户主先返回自宅。
            if let Some(target) = agent.home_house_id
                .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                .map(|h| h.door_node_id)
            {
                let start = self.start_node(agent);
                let at_home = agent.current_lane_id.is_none()
                    && self.network.graph.node_weight(*self.network.node_map.get(&target).unwrap())
                        .map(|n| agent.world_pos.distance_to(&n.pos) <= self.config.poi_interaction_radius)
                        .unwrap_or(false);
                if !at_home && self.dispatch(agent, start, target, PrimitiveActionState::RaiseChild) {
                    agent.current_need = Some("Esteem·RaiseChild·ReturningHome".to_string());
                    return;
                }
            }
            agent.enter_stationary_state(PrimitiveActionState::RaiseChild);
            agent.current_need = Some("Esteem·RaiseChild".to_string());
            return;
        }
        if need.kind == NeedKind::BidHouse {
            // ★ v1.29.0 竞购现房：常规（被层级覆盖降级）路径同样只写 pending，
            // 选房判据与瞬发路径共用 branches::all_bid_candidates（确定性、不耗 RNG）。
            self.write_bid_pending(agent);
            if agent.pending_bid_house_ids.is_empty() {
                agent.current_need = None;
            }
            return;
        }
        if need.kind == NeedKind::RepairHouse {
            agent.enter_stationary_state(PrimitiveActionState::RepairingHouse);
            return;
        }
        if need.kind == NeedKind::BuildHouse {
            // 升级施工必须在自宅门口执行；未到家先沿路网返回，抵达后由 construction 结算。
            let target = agent.home_house_id
                .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                .map(|h| h.door_node_id);
            if let Some(target) = target {
                let start = self.start_node(agent);
                let at_home = agent.current_lane_id.is_none()
                    && self.network.graph.node_weight(*self.network.node_map.get(&target).unwrap())
                        .map(|n| agent.world_pos.distance_to(&n.pos) <= self.config.poi_interaction_radius)
                        .unwrap_or(false);
                if !at_home && self.dispatch(agent, start, target, PrimitiveActionState::ConstructingHouse) {
                    agent.current_need = Some("Esteem·BuildHouse·ReturningHome".to_string());
                    return;
                }
            }
            agent.enter_stationary_state(PrimitiveActionState::ConstructingHouse);
            agent.build_timer = 0.0;
            return;
        }
        if need.kind == NeedKind::FoundHome {
            // ★ M4 无房国王立宅约束：只能盖在自己的王国（营地）附近（复用 poiMinDistance）
            let king_camp_pos = self.king_camp_of(agent)
                .and_then(|kcid| self.ctx.camp_pois.iter().find(|(id, _)| *id == kcid))
                .map(|(_, p)| *p);
            // 系统仅在实体化阶段执行放置校验与路网接入（见 materialize_founded_houses）。
            for _ in 0..self.config.decision_found_home_candidates {
                let angle = self.rng.gen_range(0.0, std::f32::consts::TAU);
                let dist = self.rng.gen_range(self.config.decision_found_home_dist_min, self.config.decision_found_home_dist_max);
                let cand = Vec3::new(
                    agent.world_pos.x + angle.cos() * dist,
                    agent.world_pos.y + angle.sin() * dist,
                    agent.world_pos.z,
                );
                let mut is_valid = self.houses.iter().all(|h| {
                    let dx = h.pos.x - cand.x;
                    let dy = h.pos.y - cand.y;
                    (dx * dx + dy * dy).sqrt() >= self.config.house_min_spacing
                });
                // 资源点/榷场是基础设施实体，宅址不得落入其交互范围。
                if is_valid {
                    is_valid = self.ctx.poi_positions.iter().all(|p| {
                        let dx = p.x - cand.x;
                        let dy = p.y - cand.y;
                        (dx * dx + dy * dy).sqrt() >= self.config.poi_interaction_radius
                    });
                }
                if is_valid {
                    is_valid = self.ctx.camp_pois.iter().all(|(_, p)| {
                        let dx = p.x - cand.x;
                        let dy = p.y - cand.y;
                        (dx * dx + dy * dy).sqrt() >= self.config.house_node_poi_occupy_radius
                    });
                }
                // 国王宅址必须落在自己王国营地 poi_min_distance 以内（挂靠自己的王国）
                if is_valid {
                    if let Some(cp) = king_camp_pos {
                        let dx = cp.x - cand.x;
                        let dy = cp.y - cand.y;
                        if (dx * dx + dy * dy).sqrt() > self.config.poi_min_distance {
                            is_valid = false;
                        }
                    }
                }
                if is_valid {
                    agent.current_need = Some("Physiological·FoundHome".to_string());
                    // 先沿路网走到候选宅址附近，抵达后 settlement 才实体化房屋。
                    if let Some((target, _)) = self.network.graph.node_weights()
                        .map(|n| (n.id, n.pos))
                        .min_by(|(_, a), (_, b)| a.distance_to(&cand).partial_cmp(&b.distance_to(&cand)).unwrap()) {
                        let start = self.start_node(agent);
                        // 存已通过校验的候选点 cand 本身，而非「离 cand 最近的路网节点」——
                        // 后者可能是别人家门节点/营地节点，会导致实体化阶段 is_house_site_valid 校验失败、房子盖不起来。
                        agent.pending_house_pos = Some(cand);
                        let _ = self.dispatch(agent, start, target, PrimitiveActionState::RestingAtCamp);
                    } else {
                        agent.pending_house_pos = None;
                    }
                    return;
                }
            }
            agent.current_need = Some("Physiological·FoundHome".to_string());
            return;
        }
        if need.kind == NeedKind::SeekThrone {
            // ★ M4 夺位远征：目标 = 最近的可夺位营地（资格规则与分支守卫一致）
            let home_camp_id = agent.home_house_id
                .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                .map(|h| h.camp_id);
            let Some(camp_id) = self.eligible_leaderless_camp(agent, home_camp_id.is_some(), home_camp_id) else {
                agent.current_need = None;
                return;
            };
            let Some(target_node) = self.camp_node_of(camp_id) else {
                agent.current_need = None;
                return;
            };
            let start = self.start_node(agent);
            agent.expedition_target_camp = Some(camp_id);
            agent.current_need = Some("Physiological·SeekThrone".to_string());
            self.dispatch(agent, start, target_node, PrimitiveActionState::SeekingThrone);
            return;
        }
        if need.kind == NeedKind::MarketTrade {
            let Some(target) = self.nearest_market_node(agent) else {
                agent.current_need = None;
                return;
            };
            let start = self.start_node(agent);
            agent.current_need = Some("Physiological·MarketTrade".to_string());
            self.dispatch(agent, start, target, PrimitiveActionState::SeekingMarket);
            return;
        }
        if need.kind == NeedKind::Courtship {
            let Some(target) = self.best_courtship_target(agent).copied() else {
                agent.current_need = None;
                return;
            };
            agent.courtship_target_id = Some(target.id);
            agent.current_need = Some("Belonging·Courtship".to_string());
            if agent.world_pos.distance_to(&target.pos) <= self.config.poi_interaction_radius {
                agent.courtship_pending = Some(target.id);
            } else {
                let start = self.start_node(agent);
                self.dispatch(agent, start, target.nearest_node, PrimitiveActionState::SeekingCourtship);
            }
            return;
        }
        if need.kind == NeedKind::StockGold {
            agent.gold_mining_cooldown = self.config.decision_stock_gold_cooldown;
        } else if need.kind == NeedKind::GoldWealth {
            agent.gold_mining_cooldown = self.config.decision_gold_wealth_cooldown;
        }

        let start = self.start_node(agent);
        let target = match need.kind {
            NeedKind::QuenchThirst | NeedKind::StockWater => self.nearest_of(agent, NodePool::Water, agent.world_pos),
            NeedKind::SateHunger | NeedKind::StockFood => self.nearest_of(agent, NodePool::Food, agent.world_pos),
            NeedKind::StockWood => self.nearest_of(agent, NodePool::Wood, agent.world_pos),
            NeedKind::StockStone => self.nearest_of(agent, NodePool::Stone, agent.world_pos),
            NeedKind::StockGold | NeedKind::GoldWealth => self.nearest_of(agent, NodePool::Gold, agent.world_pos),
            NeedKind::Rest | NeedKind::RepairHouse | NeedKind::BuildHouse | NeedKind::FoundHome | NeedKind::SeekThrone | NeedKind::MarketTrade | NeedKind::Courtship | NeedKind::BidHouse | NeedKind::RaiseChild => None,
        };
        if let Some(target) = target {
            self.dispatch(agent, start, target, need.target_state);
        }
    }

    // ══════════════════════════════════════════════════════════
    // ★ M4 夺位远征 / 国王立宅 · 决策辅助
    // ══════════════════════════════════════════════════════════

    /// 本 agent 是否已是一地之王
    pub fn is_king(&self, agent: &Agent3D) -> bool {
        self.regions.regions.iter().any(|(_, r)| r.group.leader == Some(agent.id))
    }

    /// ★ v1.10.0 是否存在未满（< camp_max_houses）的营地（B12FoundHome 预检用）
    pub fn has_nonfull_camp(&self) -> bool {
        let max = self.config.camp_max_houses as usize;
        self.ctx.camp_pois.iter().any(|(cid, _)| {
            self.houses.iter().filter(|h| h.camp_id == *cid).count() < max
        })
    }

    /// 本 agent 若为王，返回其王国的营地 ID
    pub fn king_camp_of(&self, agent: &Agent3D) -> Option<u32> {
        self.regions.regions.iter()
            .find(|(_, r)| r.group.leader == Some(agent.id))
            .map(|(cid, _)| *cid)
    }

    /// 判定夺位远征资格并返回最近的可夺位营地。
    /// has_house=true 时仅自家营地王位空缺才可夺；无房（含废墟）则可夺任意空缺王位营地。
    /// ★ 遍历完整营地列表（camp_pois）：无 Region 实体的营地（有房无王的孤儿营地）也视为空缺王位，
    ///   避免房屋辖区（House.camp_id）与地区成员登记簿（RegionRegistry）脱节导致永无国王。
    pub fn eligible_leaderless_camp(&self, agent: &Agent3D, has_house: bool, home_camp_id: Option<u32>) -> Option<u32> {
        let mut best: Option<(u32, f32)> = None;
        for &(cid, pos) in &self.ctx.camp_pois {
            // 有王（region 存在且 leader 非空）→ 跳过；无 region 或 leader 为空 → 空缺王位
            if self.regions.regions.get(&cid).is_some_and(|r| r.group.leader.is_some()) {
                continue; // 王位未空缺
            }
            if has_house && Some(cid) != home_camp_id {
                continue; // 有房者只能夺自家营地王位
            }
            let dist = agent.world_pos.distance_to(&pos);
            if best.map(|(_, bd)| dist < bd).unwrap_or(true) {
                best = Some((cid, dist));
            }
        }
        best.map(|(id, _)| id)
    }

    /// 营地 ID → 最近路网节点（夺位远征目标节点）
    pub fn camp_node_of(&self, camp_id: u32) -> Option<NodeId> {
        let pos = self.ctx.camp_pois.iter().find(|(id, _)| *id == camp_id).map(|(_, p)| *p)?;
        self.ctx.camp_positions.iter()
            .min_by(|a, b| a.1.distance_to(&pos).partial_cmp(&b.1.distance_to(&pos)).unwrap())
            .map(|(n, _)| *n)
    }
}
