use crate::spatial::agent::{Gender, PrimitiveActionState};
use crate::spatial::graph::{NodeId, NodeType, RoadClass};
use crate::spatial::house::{House, HouseTier};
use crate::spatial::poi::PoiType;
use crate::spatial::vec3::Vec3;
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// 自发选址设立 0级仓库 与路网拓扑接入
    pub(crate) fn tick_warehouse_founding(&mut self) {
        if self.tick_counter % 15 != 0 {
            return;
        }

        for i in 0..self.agents.len() {
            let agent = &self.agents[i];
            let is_already_owner = self.houses.iter().any(|h| h.owner_id == agent.id && !h.is_ruin);
            if !agent.is_alive || agent.gender != Gender::Male || is_already_owner || agent.state != PrimitiveActionState::RestingAtCamp {
                continue;
            }

            if agent.age >= self.config.agent_adult_age && agent.hunger >= 18.0 && agent.thirst >= 18.0 && agent.stamina >= 100.0 {
                let agent_id = agent.id;
                let agent_pos = agent.world_pos;

                for _ in 0..12 {
                    let angle = self.rng.gen_range(0.0, std::f32::consts::TAU);
                    let dist = self.rng.gen_range(16.0, 42.0);
                    let cand_x = agent_pos.x + angle.cos() * dist;
                    let cand_y = agent_pos.y + angle.sin() * dist;
                    let cand_z = self.terrain.sample_elevation(cand_x, cand_y);

                    let cand_pos = Vec3::new(cand_x, cand_y, cand_z);
                    let is_valid = self.houses.iter().all(|h| h.pos.distance_to(&cand_pos) >= 14.0);

                    if is_valid {
                        let house_id = self.next_house_id;
                        self.next_house_id += 1;

                        let mut sorted_nearby_nodes: Vec<(NodeId, f32)> = self.network.graph.node_weights()
                            .map(|n| (n.id, n.pos.distance_to(&cand_pos)))
                            .collect();
                        sorted_nearby_nodes.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());

                        let door_node = self.network.add_node(cand_pos, NodeType::GroundIntersection);
                        for &(near_id, _) in sorted_nearby_nodes.iter().take(3) {
                            let _ = self.network.add_lane_with_options(door_node, near_id, None, RoadClass::DirtTrack, false, 1.0);
                            let _ = self.network.add_lane_with_options(near_id, door_node, None, RoadClass::DirtTrack, false, 1.0);
                        }

                        let nearest_camp = self.pois.iter()
                            .filter(|p| p.poi_type == PoiType::Camp)
                            .min_by(|a, b| a.pos.distance_to(&cand_pos).partial_cmp(&b.pos.distance_to(&cand_pos)).unwrap());
                        let camp_id = nearest_camp.map(|p| p.id).unwrap_or(1);
                        let camp_name = nearest_camp.map(|p| p.camp_title()).unwrap_or_else(|| "营地".to_string());

                        let house = House::new_with_config(house_id, agent_id, cand_pos, door_node, HouseTier::Tier0Warehouse, camp_id, &self.config);
                        self.houses.push(house);

                        let agent_mut = &mut self.agents[i];
                        agent_mut.home_house_id = Some(house_id);
                        agent_mut.home_camp_node = door_node;
                        agent_mut.world_pos = cand_pos;
                        self.last_event = Some(format!("📦 部落民 #{} ♂ 于【{}】管辖区选址建立了第 #{} 号 0级仓库，开始搬运备货！", agent_id, camp_name, house_id));
                        break;
                    }
                }
            }
        }
    }

    /// 统计各营地绑定的有效房屋数量并执行五级行政区阶梯升级
    pub(crate) fn tick_camp_administrative_upgrades(&mut self) {
        for poi in &mut self.pois {
            if poi.poi_type == PoiType::Camp {
                let count = self.houses.iter().filter(|h| h.camp_id == poi.id && !h.is_ruin).count() as u32;
                if let Some(msg) = poi.update_camp_level(count) {
                    self.last_event = Some(msg);
                }
            }
        }
    }
}
