use crate::spatial::graph::{NodeId, NodeType, RoadClass};
use crate::spatial::house::{House, HouseTier};
use crate::spatial::poi::PoiType;
use crate::spatial::vec3::Vec3;
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// 宅址放置校验：与现有房屋（含尚未坍塌的废墟）的水平距离须 ≥ house_min_spacing
    pub(crate) fn is_house_site_valid(&self, pos: Vec3) -> bool {
        self.houses.iter().all(|h| {
            let dx = h.pos.x - pos.x;
            let dy = h.pos.y - pos.y;
            (dx * dx + dy * dy).sqrt() >= self.config.house_min_spacing
        })
    }

    /// 节点是否空置：既不是任何现存房屋的大门节点，也不是某个 POI 自身的接驳节点。
    /// 房屋坍塌后遗留的孤儿门节点、以及无人占用的野外路口均属空置。
    pub(crate) fn is_node_vacant(&self, node_id: NodeId, node_pos: Vec3) -> bool {
        if self.houses.iter().any(|h| h.door_node_id == node_id) {
            return false;
        }
        !self.pois.iter().any(|p| p.pos.distance_to(&node_pos) < self.config.house_node_poi_occupy_radius)
    }

    /// 在候选宅址的合法半径内检索最近的空置节点。返回值已同时通过房屋最小间距校验；
    /// 距离并列时取节点 id 较小者，保证确定性。
    pub(crate) fn find_vacant_node_near(&self, center: Vec3, radius: f32) -> Option<(NodeId, Vec3)> {
        let mut best: Option<(NodeId, Vec3, f32)> = None;
        for node in self.network.graph.node_weights() {
            let dx = node.pos.x - center.x;
            let dy = node.pos.y - center.y;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist > radius {
                continue;
            }
            if !self.is_node_vacant(node.id, node.pos) {
                continue;
            }
            if !self.is_house_site_valid(node.pos) {
                continue;
            }
            let is_better = match best {
                None => true,
                Some((best_id, _, best_dist)) => dist < best_dist || (dist == best_dist && node.id < best_id),
            };
            if is_better {
                best = Some((node.id, node.pos, dist));
            }
        }
        best.map(|(id, pos, _)| (id, pos))
    }

    /// 将节点双向接入最近的 count 个既有节点（泥泞小径），排除自身
    fn connect_node_to_nearest(&mut self, node_id: NodeId, pos: Vec3, count: usize) {
        let mut sorted_nearby_nodes: Vec<(NodeId, f32)> = self.network.graph.node_weights()
            .filter(|n| n.id != node_id)
            .map(|n| (n.id, n.pos.distance_to(&pos)))
            .collect();
        sorted_nearby_nodes.sort_by(|a, b| {
            a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0))
        });
        for &(near_id, _) in sorted_nearby_nodes.iter().take(count) {
            let _ = self.network.add_lane_with_options(node_id, near_id, None, RoadClass::DirtTrack, false, 1.0, &self.config);
            let _ = self.network.add_lane_with_options(near_id, node_id, None, RoadClass::DirtTrack, false, 1.0, &self.config);
        }
    }

    /// 复用的空置节点若已彻底失联（无任何出边），补建接入路径，避免建出孤岛宅院
    fn ensure_node_connected(&mut self, node_id: NodeId, pos: Vec3) {
        let has_lane = self.network.node_map.get(&node_id)
            .map(|idx| self.network.graph.neighbors(*idx).next().is_some())
            .unwrap_or(false);
        if !has_lane {
            self.connect_node_to_nearest(node_id, pos, 3);
        }
    }

    /// 实体化登记：将本拍决策阶段由 agent 自主选定的宅址（pending_house_pos）落地为 0 级仓库。
    /// 系统在此仅执行物理规则与基础设施——空置节点复用、放置校验（≥ house_min_spacing）、
    /// 路网接入、房产绑定，不再有任何“指挥 agent 建房”的主动扫描；是否自立门户完全由 agent 自己的需求决定。
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

            // 优先复用合法范围内最近的空置节点（房屋坍塌遗留的孤儿门节点 / 无主野外路口），
            // 无可复用节点时才新建，杜绝路网节点随代际更替无限膨胀。
            let reuse = self.find_vacant_node_near(cand_pos, self.config.house_node_reuse_radius);

            let (site_pos, door_node, is_reused) = if let Some((node_id, node_pos)) = reuse {
                self.ensure_node_connected(node_id, node_pos);
                (node_pos, node_id, true)
            } else {
                // 实体化时重新校验（同拍内其他 agent 可能已抢占该址），2D 距离与决策阶段口径一致
                if !self.is_house_site_valid(cand_pos) {
                    continue;
                }
                let node_id = self.network.add_node(cand_pos, NodeType::GroundIntersection);
                self.connect_node_to_nearest(node_id, cand_pos, 3);
                (cand_pos, node_id, false)
            };

            let house_id = self.next_house_id;
            self.next_house_id += 1;

            let owner_id = self.agents[i].id;
            // ★ v1.9.0 无房国王盖房挂靠自己的王国（营地）：国王宅邸必属其治下营地
            let king_camp_id = self.region_registry.regions.iter()
                .find(|(_, r)| r.group.leader == Some(owner_id))
                .map(|(cid, _)| *cid);
            // ★ v1.10.0 营地房屋上限：只在未满（< camp_max_houses）的营地建设，所有营地满则放弃本次建房
            let max_houses = self.config.camp_max_houses as usize;
            // 按距宅址的距离排序所有营地（确定性：同距取 id 小）
            let mut camps_by_dist: Vec<(u32, f32)> = self.pois.iter()
                .filter(|p| p.poi_type == PoiType::Camp)
                .map(|p| (p.id, p.pos.distance_to(&site_pos)))
                .collect();
            camps_by_dist.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap().then(a.0.cmp(&b.0)));
            // 统计各营地当前房屋数（含本拍已实体化的房屋，防止同拍超建）
            let camp_house_count = |cid: u32| -> usize {
                self.houses.iter().filter(|h| h.camp_id == cid).count()
            };
            // 选址：国王优先自己的王国营地（若未满），否则按距离尝试未满营地；全部满则放弃
            let camp_id = if let Some(kcid) = king_camp_id {
                if camp_house_count(kcid) < max_houses {
                    Some(kcid)
                } else {
                    camps_by_dist.iter()
                        .find(|(cid, _)| camp_house_count(*cid) < max_houses)
                        .map(|(cid, _)| *cid)
                }
            } else {
                camps_by_dist.iter()
                    .find(|(cid, _)| camp_house_count(*cid) < max_houses)
                    .map(|(cid, _)| *cid)
            };
            let Some(camp_id) = camp_id else {
                // 所有营地均已满，放弃本次建房（agent 下拍重新决策）
                continue;
            };
            let camp_name = self.pois.iter()
                .find(|p| p.poi_type == PoiType::Camp && p.id == camp_id)
                .map(|p| p.camp_title())
                .unwrap_or_else(|| "营地".to_string());
            let house = House::new_with_config(house_id, owner_id, site_pos, door_node, HouseTier::Tier0Warehouse, camp_id, &self.config);
            self.houses.push(house);

            let agent = &mut self.agents[i];
            agent.home_house_id = Some(house_id);
            agent.home_camp_node = door_node;
            agent.world_pos = site_pos;
            let site_note = if is_reused {
                format!("（复用空置门径节点 #{}）", door_node)
            } else {
                String::new()
            };
            self.last_event = Some(format!("📦 部落民 #{} ♂ 自主选址，于【{}】管辖区建立了第 #{} 号 0级仓库{}，开始搬运备货！", owner_id, camp_name, house_id, site_note));
        }
    }

    /// 统计各营地绑定的有效房屋数量并执行五级行政区阶梯升级
    pub(crate) fn tick_camp_administrative_upgrades(&mut self) {
        for poi in &mut self.pois {
            if poi.poi_type == PoiType::Camp {
                let count = self.houses.iter().filter(|h| h.camp_id == poi.id).count() as u32;
                if let Some(msg) = poi.update_camp_level(count) {
                    self.last_event = Some(msg);
                }
            }
        }
    }
}
