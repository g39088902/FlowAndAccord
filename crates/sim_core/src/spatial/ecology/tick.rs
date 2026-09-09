//! tick.rs · `tick_poi_interactions` 调度壳。
//!
//! 只负责「遍历 agent → 胎儿/死者跳过 → 分娩委托收集 → 按状态分派 → 出生结算 → 尸骸清理」，
//! 各状态的物理结算分别在 `harvest.rs`（现场采收/榷场采购）与 `home.rs`（卸货入账/在家吃喝）。
//!
//! ⚠️ 本函数是 `world_tick.rs` 管线步骤 3，必须早于决策（决策读卸货后的家户账本余额），
//! 详见 `spatial/AGENTS.md` §二。

use super::super::agent::PrimitiveActionState;
use super::super::world::World3DEngine;
use super::{harvest, home};

impl World3DEngine {
    /// 真实有限资源交互结算与分娩
    pub fn tick_poi_interactions(&mut self, dt: f32) {
        let mut newborn_mothers = Vec::new();
        let carry_cap = self.config.carry_capacity_resource;
        let rate_res = self.config.poi_interaction_rate_resource;
        let rate_gold = self.config.poi_interaction_rate_gold;
        let unload_res = self.config.poi_unload_rate_resource;
        let unload_gold = self.config.poi_unload_rate_gold;

        let mut order:Vec<_>=(0..self.agents.len()).collect();
        order.sort_by_key(|&i|self.agents[i].id);
        for i in order {
            let agent=&mut self.agents[i];
            if !agent.is_alive {
                continue;
            }
            // ★ 胎儿跳过 POI 交互：无地图实体、无携带装卸/进食饮水
            if agent.is_fetus {
                continue;
            }

            if agent.ready_to_birth {
                agent.ready_to_birth = false;
                newborn_mothers.push((agent.id, agent.home_camp_node));
            }

            match agent.state {
                PrimitiveActionState::DrinkingAtWater => {
                    harvest::harvest_water(
                        agent,
                        &mut self.pois,
                        &mut self.water_pools,
                        &self.config,
                        carry_cap,
                        rate_res,
                        dt,
                    );
                }
                PrimitiveActionState::ForagingFood => {
                    harvest::harvest_food(
                        agent,
                        &mut self.pois,
                        &self.config,
                        carry_cap,
                        rate_res,
                        dt,
                    );
                }
                PrimitiveActionState::GatheringWood => {
                    harvest::harvest_wood(
                        agent,
                        &mut self.pois,
                        &self.config,
                        carry_cap,
                        rate_res,
                        dt,
                    );
                }
                PrimitiveActionState::MiningStone => {
                    harvest::harvest_stone(
                        agent,
                        &mut self.pois,
                        &self.config,
                        carry_cap,
                        rate_res,
                        dt,
                    );
                }
                PrimitiveActionState::MiningGold => {
                    harvest::harvest_gold(agent, &mut self.pois, &self.config, rate_gold, dt);
                }
                PrimitiveActionState::BuyingAtMarket => {
                    harvest::buy_at_market(
                        agent,
                        &mut self.pois,
                        &mut self.household_registry,
                        &self.config,
                        self.tick_counter,
                        carry_cap,
                    );
                }
                PrimitiveActionState::RestingAtCamp => {
                    home::rest_at_camp(
                        agent,
                        &mut self.household_registry,
                        &self.config,
                        self.tick_counter,
                        unload_res,
                        unload_gold,
                        dt,
                    );
                }
                _ => {}
            }
        }

        self.sync_water_pois();
        // 出生结算委托给 birth.rs（内部使用 agent_index O(1) 查找，并增量更新索引）
        self.resolve_newborns(newborn_mothers);

        // 清理已彻底消逝的尸骸，仅在尸骸彻底消散（长度变化）时重建索引
        let prev_len = self.agents.len();
        self.agents
            .retain(|a| a.is_alive || a.death_decay_timer > 0.0);
        if self.agents.len() != prev_len {
            self.rebuild_agent_index();
        }
    }
}
