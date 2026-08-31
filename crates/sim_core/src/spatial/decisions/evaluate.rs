use super::super::vec3::Vec3;
use super::super::graph::LaneGraph3D;
use super::super::agent::{Agent3D, Gender, PrimitiveActionState};
use super::super::poi::PoiType;
use super::super::house::{House, HouseTier};
use super::needs::*;
use crate::config::*;
use crate::rng::WorldRng;

/// 单名族人的马斯洛需求决策器 (持有全部只读上下文，逐人驱动状态机)
pub struct Decisioner<'a> {
    pub ctx: &'a DecisionContext,
    pub network: &'a LaneGraph3D,
    pub houses: &'a [House],
    pub rng: &'a mut WorldRng,
    pub config: &'a SimConfig,
}

impl<'a> Decisioner<'a> {
    /// 核心决策调度
    pub fn decide(&mut self, agent: &mut Agent3D) {
        if !agent.is_alive {
            agent.current_need = None;
            return;
        }

        match agent.state {
            PrimitiveActionState::RestingAtCamp => {
                if let Some(need) = self.evaluate_needs(agent) {
                    agent.current_need = state_need_label_with_agent(need.target_state, agent, self.houses, self.config)
                        .map(|(lvl, k)| format!("{}·{}", lvl, k));
                    self.fulfill_resting_need(agent, need);
                } else {
                    agent.current_need = Some("Physiological·Rest".to_string());
                }
            }
            PrimitiveActionState::SeekingWater => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingWater, agent, self.houses, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_survival(agent, NodePool::Water, PoiType::WaterSource);
            }
            PrimitiveActionState::SeekingFood => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingFood, agent, self.houses, self.config)
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
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::SeekingGold, agent, self.houses, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_seeking_material(agent, NodePool::Gold, PoiType::GoldMine);
            }
            PrimitiveActionState::DrinkingAtWater => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::DrinkingAtWater, agent, self.houses, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_drinking(agent);
            }
            PrimitiveActionState::ForagingFood => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::ForagingFood, agent, self.houses, self.config)
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
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::MiningGold, agent, self.houses, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
                self.decide_mining_gold(agent);
            }
            PrimitiveActionState::ConstructingHouse => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::ConstructingHouse, agent, self.houses, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
            }
            PrimitiveActionState::RepairingHouse => {
                agent.current_need = Some("Safety·RepairHouse".to_string());
            }
            PrimitiveActionState::ReturningToCamp => {
                agent.current_need = state_need_label_with_agent(PrimitiveActionState::ReturningToCamp, agent, self.houses, self.config)
                    .map(|(lvl, k)| format!("{}·{}", lvl, k));
            }
            _ => {}
        }
    }

    /// 马斯洛需求层级逐层评估
    pub fn evaluate_needs(&mut self, agent: &Agent3D) -> Option<Need> {
        if agent.thirst < self.config.decision_critical_thirst && self.has_available_node(agent, NodePool::Water) {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::QuenchThirst, target_state: PrimitiveActionState::SeekingWater });
        }
        if agent.hunger < self.config.decision_critical_hunger && self.has_available_node(agent, NodePool::Food) {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::SateHunger, target_state: PrimitiveActionState::SeekingFood });
        }

        if agent.stamina < self.config.decision_rest_stamina_target {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::Rest, target_state: PrimitiveActionState::RestingAtCamp });
        }

        if let Some(house) = agent.home_house_id.and_then(|hid| self.houses.iter().find(|h| h.id == hid && !h.is_ruin)) {
            let is_house_member = house.owner_id == agent.id || house.spouse_id == Some(agent.id);
            let needs = house_stock_needs(house, self.config);

            if needs.need_repair && is_house_member {
                return Some(Need { level: MaslowLevel::Safety, kind: NeedKind::RepairHouse, target_state: PrimitiveActionState::RepairingHouse });
            }

            let family_level = if agent.spouse_id.is_some() || !agent.children_ids.is_empty() {
                MaslowLevel::Belonging
            } else {
                MaslowLevel::Safety
            };

            if needs.need_water && self.has_available_node(agent, NodePool::Water) {
                return Some(Need { level: family_level, kind: NeedKind::StockWater, target_state: PrimitiveActionState::SeekingWater });
            }
            if needs.need_food && self.has_available_node(agent, NodePool::Food) {
                return Some(Need { level: family_level, kind: NeedKind::StockFood, target_state: PrimitiveActionState::SeekingFood });
            }
            if needs.need_wood && self.has_available_node(agent, NodePool::Wood) {
                return Some(Need { level: family_level, kind: NeedKind::StockWood, target_state: PrimitiveActionState::SeekingWood });
            }

            if house.tier == HouseTier::Tier0Warehouse && house.is_pantry_full(self.config) && is_house_member && agent.gender == Gender::Male && agent.age >= self.config.agent_adult_age {
                return Some(Need { level: MaslowLevel::Belonging, kind: NeedKind::BuildHouse, target_state: PrimitiveActionState::ConstructingHouse });
            }

            if needs.need_stone && self.has_available_node(agent, NodePool::Stone) {
                return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::StockStone, target_state: PrimitiveActionState::SeekingStone });
            }

            if needs.need_gold && self.has_available_node(agent, NodePool::Gold) && agent.gold_mining_cooldown <= 0.0 {
                return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::StockGold, target_state: PrimitiveActionState::SeekingGold });
            }

            if house.is_pantry_full(self.config) && house.tier != HouseTier::Tier4Manor && is_house_member && agent.gender == Gender::Male && agent.age >= self.config.agent_adult_age {
                return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::BuildHouse, target_state: PrimitiveActionState::ConstructingHouse });
            }

            if house.tier != HouseTier::Tier4Manor
                || needs.need_repair
                || needs.need_wood
                || needs.need_stone
                || needs.need_gold
                || needs.need_water
                || needs.need_food
                || house.is_pantry_full(self.config)
            {
                return None;
            }
        } else {
            // 无家可归：成年男性在生理稳定（饥渴 ≥ 20、体力 ≥ 60）时自主"自立门户"，
            // 必然触发选址立宅（无概率、无系统指挥，由本 Agent 决策相位自行决定）。
            if agent.gender == Gender::Male
                && agent.age >= self.config.agent_adult_age
                && agent.hunger >= self.config.decision_found_home_hunger_min
                && agent.thirst >= self.config.decision_found_home_thirst_min
                && agent.stamina >= self.config.decision_found_home_stamina_min
            {
                return Some(Need {
                    level: MaslowLevel::Belonging,
                    kind: NeedKind::FoundHome,
                    target_state: PrimitiveActionState::RestingAtCamp,
                });
            }
            return None;
        }

        if self.has_available_node(agent, NodePool::Gold) && agent.gold_mining_cooldown <= 0.0 {
            return Some(Need { level: MaslowLevel::SelfActualization, kind: NeedKind::GoldWealth, target_state: PrimitiveActionState::SeekingGold });
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
            // 自主选址：本 Agent 在自身周围掷 12 个候选点，取第一个与现有房屋保持 ≥14m 的位置；
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
                    agent.current_need = Some("Belonging·FoundHome".to_string());
                    return;
                }
            }
            agent.current_need = Some("Belonging·FoundHome".to_string());
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
