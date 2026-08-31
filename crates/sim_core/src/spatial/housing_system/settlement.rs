use crate::spatial::graph::{NodeId, NodeType, RoadClass};
use crate::spatial::house::{House, HouseTier};
use crate::spatial::poi::PoiType;
use crate::spatial::vec3::Vec3;
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// 实体化登记：将本拍决策阶段由 agent 自主选定的宅址（pending_house_pos）落地为 0 级仓库。
    /// 系统在此仅执行物理规则与基础设施——放置校验（≥28m）、路网接入、房产绑定，
    /// 不再有任何“指挥 agent 建房”的主动扫描；是否自立门户完全由 agent 自己的需求决定。
    pub(crate) fn materialize_founded_houses(&mut self) {
        let mut pending: Vec<(usize, Vec3)> = Vec::new();
        for (i, agent) in self.agents.iter().enumerate() {
            if agent.is_alive && agent.home_house_id.is_none() {
                if let Some(pos) = agent.pending_house_pos {
                    pending.push((i, pos));
                }
            }
        }
        if pending.is_empty() {
            return;
        }
        // 先统一清空待办，避免失败后残留；失败的 agent 会在下一拍决策时重新自选。
        for (i, _) in &pending {
            self.agents[*i].pending_house_pos = None;
        }

        for (i, chosen) in pending {
            let cand_pos = Vec3::new(chosen.x, chosen.y, self.terrain.sample_elevation(chosen.x, chosen.y));
            // 实体化时重新校验（同拍内其他 agent 可能已抢占该址），2D 距离与决策阶段口径一致
            let is_valid = self.houses.iter().all(|h| {
                let dx = h.pos.x - cand_pos.x;
                let dy = h.pos.y - cand_pos.y;
                (dx * dx + dy * dy).sqrt() >= self.config.house_min_spacing
            });
            if !is_valid {
                continue;
            }

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

            let owner_id = self.agents[i].id;
            let house = House::new_with_config(house_id, owner_id, cand_pos, door_node, HouseTier::Tier0Warehouse, camp_id, &self.config);
            self.houses.push(house);

            let agent = &mut self.agents[i];
            agent.home_house_id = Some(house_id);
            agent.home_camp_node = door_node;
            agent.world_pos = cand_pos;
            self.last_event = Some(format!("📦 部落民 #{} ♂ 自主选址，于【{}】管辖区建立了第 #{} 号 0级仓库，开始搬运备货！", owner_id, camp_name, house_id));
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
