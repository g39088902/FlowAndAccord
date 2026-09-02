use super::super::vec3::Vec3;
use super::super::graph::LaneGraph3D;
use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::poi::PoiType;
use super::super::house::House;
use super::super::ledger::family::HouseholdRegistry;
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
    pub rng: &'a mut WorldRng,
    pub config: &'a SimConfig,
    /// 本拍使用的分支评估顺序（由 config.decision_eval_order 解析，见 branches.rs）
    pub branch_order: &'a [BranchId; 13],
}

impl<'a> Decisioner<'a> {
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

        match agent.state {
            PrimitiveActionState::RestingAtCamp => {
                if let Some(need) = self.evaluate_needs(agent) {
                    agent.current_need = state_need_label_with_agent(need.target_state, agent, self.houses, self.households, self.config)
                        .map(|(lvl, k)| format!("{}·{}", lvl, k));
                    self.fulfill_resting_need(agent, need);
                } else {
                    agent.current_need = Some("Physiological·Rest".to_string());
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
            _ => {}
        }
    }

    /// 马斯洛需求逐条评估（数据驱动）：
    /// 按注入的分支顺序迭代 branches.rs 注册表，首个命中即返回；
    /// 命中后套用 decision_eval_levels 层级覆盖（0/缺失 = 保留分支自带的代码动态默认）。
    /// 顺序的唯一真相源在前端配置文件，空/非法注入已由 resolve_order 回退为中性声明序。
    pub fn evaluate_needs(&mut self, agent: &Agent3D) -> Option<Need> {
        for branch in self.branch_order.iter() {
            if let Some(mut need) = branch.evaluate(self, agent) {
                if let Some(lv) = branches::level_override_for(self.config, *branch) {
                    need.level = lv;
                }
                return Some(need);
            }
        }
        None
    }

    pub fn fulfill_resting_need(&mut self, agent: &mut Agent3D, need: Need) {
        if need.kind == NeedKind::Rest { return; }
        if need.kind == NeedKind::RepairHouse {
            agent.state = PrimitiveActionState::RepairingHouse;
            return;
        }
        if need.kind == NeedKind::BuildHouse {
            agent.state = PrimitiveActionState::ConstructingHouse;
            agent.build_timer = 0.0;
            return;
        }
        if need.kind == NeedKind::FoundHome {
            // 系统仅在实体化阶段执行放置校验与路网接入（见 materialize_founded_houses）。
            for _ in 0..self.config.decision_found_home_candidates {
                let angle = self.rng.gen_range(0.0, std::f32::consts::TAU);
                let dist = self.rng.gen_range(self.config.decision_found_home_dist_min, self.config.decision_found_home_dist_max);
                let cand = Vec3::new(
                    agent.world_pos.x + angle.cos() * dist,
                    agent.world_pos.y + angle.sin() * dist,
                    agent.world_pos.z,
                );
                let is_valid = self.houses.iter().all(|h| {
                    let dx = h.pos.x - cand.x;
                    let dy = h.pos.y - cand.y;
                    (dx * dx + dy * dy).sqrt() >= self.config.house_min_spacing
                });
                if is_valid {
                    agent.pending_house_pos = Some(cand);
                    agent.current_need = Some("Physiological·FoundHome".to_string());
                    return;
                }
            }
            agent.current_need = Some("Physiological·FoundHome".to_string());
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
            NeedKind::Rest | NeedKind::RepairHouse | NeedKind::BuildHouse | NeedKind::FoundHome => None,
        };
        if let Some(target) = target {
            self.dispatch(agent, start, target, need.target_state);
        }
    }
}
