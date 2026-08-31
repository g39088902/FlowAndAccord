use super::super::poi::PoiType;
use super::super::world::World3DEngine;
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
        let mut decisioner = Decisioner {
            ctx: &ctx,
            network: &self.network,
            houses: &self.houses,
            rng: &mut self.rng,
            config: &self.config,
        };
        for agent in &mut self.agents {
            if agent.is_alive && (self.tick_counter + agent.id as u64) % self.config.agent_decision_interval_ticks == 0 {
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
