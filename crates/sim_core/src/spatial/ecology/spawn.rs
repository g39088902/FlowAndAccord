//! spawn.rs · 生态播撒的实体落位与路网构建。
//!
//! 本文件只负责「把 POI 与节点放到地图上并连成路网」，不含 agent 生成与制度登记
//! （在 `founder.rs`），也不含播撒步骤编排（在 `seed.rs`）。
//!
//! ⚠️ POI 播撒顺序即 RNG 消费顺序（营地→泉→果→木→石→金→榷场互市→过渡节点），
//! 任何重排都会改变同种子随机序列，详见 `spatial/AGENTS.md` §4.3。

use super::super::graph::{NodeType, RoadClass};
use super::super::poi::{PoiType, PrimitivePoi};
use super::super::vec3::Vec3;
use super::super::world::World3DEngine;

/// 播撒过程中的共享布局状态：POI 间距排斥基准 + 各类节点 id 集合。
#[derive(Default)]
pub(super) struct SeedLayout {
    /// 已落位 POI 坐标（`poiMinDistance` 最小间距排斥基准）
    pub poi_positions: Vec<Vec3>,
    /// 营地节点 id（始祖 `home_camp` 归属与地区登记用）
    pub camp_nodes: Vec<u32>,
    /// 普通道路节点 id（始祖出生候选集来源，严禁出生于营地范围）
    pub road_nodes: Vec<u32>,
    /// 全部 POI + 过渡节点 id（全图路网连接用）
    pub all_node_ids: Vec<u32>,
}

impl World3DEngine {
    /// 在避让既有 POI 的前提下随机落位一个新 POI 坐标。
    ///
    /// 三级降级：100 次严格间距 → 50 次放宽间距（× `poiSpawnFallbackRatio`）→ 无条件兜底。
    /// 每次调用恰好消耗 2 个均匀随机数/轮，顺序不可变更。
    pub(super) fn find_spaced_poi_pos(
        &mut self,
        poi_positions: &mut Vec<Vec3>,
        radius_ratio: f32,
    ) -> Vec3 {
        let half_size = self.terrain.world_size / 2.0;
        let min_poi_distance = self.config.poi_min_distance;
        let poi_spawn_fallback_ratio = self.config.poi_spawn_fallback_ratio;

        for _ in 0..100 {
            let x = self.rng.gen_range(-half_size * radius_ratio, half_size * radius_ratio);
            let y = self.rng.gen_range(-half_size * radius_ratio, half_size * radius_ratio);
            let elev = self.terrain.sample_elevation(x, y);
            let cand = Vec3::new(x, y, elev);
            if poi_positions
                .iter()
                .all(|p| p.distance_to(&cand) >= min_poi_distance)
            {
                poi_positions.push(cand);
                return cand;
            }
        }
        // Fallback with looser distance if tight
        for _ in 0..50 {
            let x = self.rng.gen_range(-half_size * radius_ratio, half_size * radius_ratio);
            let y = self.rng.gen_range(-half_size * radius_ratio, half_size * radius_ratio);
            let elev = self.terrain.sample_elevation(x, y);
            let cand = Vec3::new(x, y, elev);
            if poi_positions.iter().all(|p| {
                p.distance_to(&cand) >= min_poi_distance * poi_spawn_fallback_ratio
            }) {
                poi_positions.push(cand);
                return cand;
            }
        }
        let x = self.rng.gen_range(-half_size * radius_ratio, half_size * radius_ratio);
        let y = self.rng.gen_range(-half_size * radius_ratio, half_size * radius_ratio);
        let cand = Vec3::new(x, y, self.terrain.sample_elevation(x, y));
        poi_positions.push(cand);
        cand
    }

    /// 1. 生成避风营地（ID 段位 1-4）
    pub(super) fn spawn_camp_pois(&mut self, layout: &mut SeedLayout) {
        let radius_ratio = self.config.poi_spawn_radius_camp;
        let mut available_names = crate::spatial::poi::COUNTY_NAMES.to_vec();
        for i in 0..self.config.count_camps {
            let mut pos = self.find_spaced_poi_pos(&mut layout.poi_positions, radius_ratio);
            pos.z += 0.5;
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            layout.camp_nodes.push(node_id);
            layout.all_node_ids.push(node_id);

            let name_idx = (self.rng.gen_range(0.0, available_names.len() as f32) as usize)
                .min(available_names.len().saturating_sub(1));
            let chosen_name = available_names.swap_remove(name_idx).to_string();

            let mut poi =
                PrimitivePoi::new_with_name((i + 1) as u32, PoiType::Camp, pos, chosen_name);
            poi.nearest_node_id = Some(node_id);
            self.pois.push(poi);
        }
    }

    /// 2. 生成清泉水源（ID 段位 10-15）
    pub(super) fn spawn_water_pois(&mut self, layout: &mut SeedLayout) {
        let radius_ratio = self.config.poi_spawn_radius_resource;
        for i in 0..self.config.count_water_sources {
            let pos = self.find_spaced_poi_pos(&mut layout.poi_positions, radius_ratio);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            layout.all_node_ids.push(node_id);

            let mut poi = PrimitivePoi::new_with_name(
                (i + 10) as u32,
                PoiType::WaterSource,
                pos,
                format!("低洼清泉 #{}", i + 1),
            );
            poi.nearest_node_id = Some(node_id);
            poi.max_stock = self.config.stock_max_water;
            poi.current_stock = self.config.stock_max_water * 0.75;
            poi.regen_rate = self.config.regen_base_water;
            self.pois.push(poi);
        }
    }

    /// 3. 生成浆果灌木（ID 段位 20-25）
    pub(super) fn spawn_berry_pois(&mut self, layout: &mut SeedLayout) {
        let radius_ratio = self.config.poi_spawn_radius_resource;
        for i in 0..self.config.count_berry_bushes {
            let pos = self.find_spaced_poi_pos(&mut layout.poi_positions, radius_ratio);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            layout.all_node_ids.push(node_id);

            let mut poi = PrimitivePoi::new_with_name(
                (i + 20) as u32,
                PoiType::BerryBush,
                pos,
                format!("缓坡浆果 #{}", i + 1),
            );
            poi.nearest_node_id = Some(node_id);
            poi.max_stock = self.config.stock_max_berry;
            poi.current_stock = self.config.stock_max_berry * 0.75;
            poi.regen_rate = self.config.regen_base_berry;
            self.pois.push(poi);
        }
    }

    /// 4. 生成林木林地（ID 段位 30-32）
    pub(super) fn spawn_wood_pois(&mut self, layout: &mut SeedLayout) {
        let radius_ratio = self.config.poi_spawn_radius_resource;
        for i in 0..self.config.count_woods {
            let pos = self.find_spaced_poi_pos(&mut layout.poi_positions, radius_ratio);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            layout.all_node_ids.push(node_id);

            let mut poi = PrimitivePoi::new_with_name(
                (i + 30) as u32,
                PoiType::WoodForest,
                pos,
                format!("茂密林木 #{}", i + 1),
            );
            poi.nearest_node_id = Some(node_id);
            poi.max_stock = self.config.stock_max_wood;
            poi.current_stock = self.config.stock_max_wood * 0.75;
            poi.regen_rate = self.config.regen_base_wood;
            self.pois.push(poi);
        }
    }

    /// 5. 生成石矿采石场（ID 段位 40-41）
    pub(super) fn spawn_stone_pois(&mut self, layout: &mut SeedLayout) {
        let radius_ratio = self.config.poi_spawn_radius_resource;
        for i in 0..self.config.count_stone_mines {
            let pos = self.find_spaced_poi_pos(&mut layout.poi_positions, radius_ratio);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            layout.all_node_ids.push(node_id);

            let mut poi = PrimitivePoi::new_with_name(
                (i + 40) as u32,
                PoiType::StoneQuarry,
                pos,
                format!("嶙峋采石场 #{}", i + 1),
            );
            poi.nearest_node_id = Some(node_id);
            poi.max_stock = self.config.stock_max_stone;
            poi.current_stock = self.config.stock_max_stone * 0.75;
            poi.regen_rate = self.config.regen_base_stone;
            self.pois.push(poi);
        }
    }

    /// 6. 生成璀璨金矿（ID 段位 50）
    pub(super) fn spawn_gold_pois(&mut self, layout: &mut SeedLayout) {
        let radius_ratio = self.config.poi_spawn_radius_resource;
        for i in 0..self.config.count_gold_mines {
            let pos = self.find_spaced_poi_pos(&mut layout.poi_positions, radius_ratio);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            layout.all_node_ids.push(node_id);

            let mut poi = PrimitivePoi::new_with_name(
                (i + 50) as u32,
                PoiType::GoldMine,
                pos,
                "璀璨金矿 #1".to_string(),
            );
            poi.nearest_node_id = Some(node_id);
            poi.max_stock = self.config.stock_max_gold;
            poi.current_stock = self.config.stock_max_gold * 0.75;
            poi.regen_rate = self.config.regen_base_gold;
            self.pois.push(poi);
        }
    }

    /// 6.5 生成榷场互市（外部市场，ID 段位 60）
    pub(super) fn spawn_market_pois(&mut self, layout: &mut SeedLayout) {
        let radius_ratio = self.config.poi_spawn_radius_resource;
        for i in 0..self.config.count_markets {
            let pos = self.find_spaced_poi_pos(&mut layout.poi_positions, radius_ratio);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            layout.all_node_ids.push(node_id);

            let mut poi = PrimitivePoi::new_with_name(
                (i + 60) as u32,
                PoiType::Market,
                pos,
                format!("榷场互市 #{}", i + 1),
            );
            poi.nearest_node_id = Some(node_id);
            poi.max_stock = self.config.market_stock_max_water;
            poi.current_stock = self.config.market_stock_max_water * 0.75;
            poi.regen_rate = self.config.market_regen_base_water;
            poi.secondary_max_stock = self.config.market_stock_max_food;
            poi.secondary_stock = self.config.market_stock_max_food * 0.75;
            poi.secondary_regen_rate = self.config.market_regen_base_food;
            poi.tertiary_max_stock = self.config.market_stock_max_wood;
            poi.tertiary_stock = self.config.market_stock_max_wood * 0.75;
            poi.tertiary_regen_rate = self.config.market_regen_base_wood;
            self.pois.push(poi);
        }
    }

    /// 7. 地形过渡节点（非 POI，作为开局小人生成位）
    pub(super) fn spawn_terrain_transition_nodes(&mut self, layout: &mut SeedLayout) {
        let half_size = self.terrain.world_size / 2.0;
        let spread = self.config.poi_spawn_spread_ratio;
        for _ in 0..self.config.count_terrain_transition_nodes {
            let x = self.rng.gen_range(-half_size * spread, half_size * spread);
            let y = self.rng.gen_range(-half_size * spread, half_size * spread);
            let elev = self.terrain.sample_elevation(x, y);
            let node_id = self
                .network
                .add_node(Vec3::new(x, y, elev), NodeType::GroundIntersection);
            layout.all_node_ids.push(node_id);
            layout.road_nodes.push(node_id);
        }
    }

    /// 8. 全图路网连接（近距走铺装/土路，远距走土路，均为双向车道）
    pub(super) fn connect_road_network(&mut self, all_node_ids: &[u32]) {
        for i in 0..all_node_ids.len() {
            for j in (i + 1)..all_node_ids.len() {
                let id_a = all_node_ids[i];
                let id_b = all_node_ids[j];
                let pos_a = self.network.graph[*self.network.node_map.get(&id_a).unwrap()].pos;
                let pos_b = self.network.graph[*self.network.node_map.get(&id_b).unwrap()].pos;
                let dist = pos_a.distance_to(&pos_b);

                if dist < self.config.road_connect_near_dist {
                    let delta_z = (pos_a.z - pos_b.z).abs();
                    let road_class = if delta_z > self.config.road_grade_pave_threshold {
                        RoadClass::Cobblestone
                    } else {
                        RoadClass::DirtTrack
                    };
                    let _ = self
                        .network
                        .add_lane(id_a, id_b, None, road_class, &self.config);
                    let _ = self
                        .network
                        .add_lane(id_b, id_a, None, road_class, &self.config);
                } else if dist < self.config.road_connect_far_dist {
                    let _ =
                        self.network
                            .add_lane(id_a, id_b, None, RoadClass::DirtTrack, &self.config);
                    let _ =
                        self.network
                            .add_lane(id_b, id_a, None, RoadClass::DirtTrack, &self.config);
                }
            }
        }
    }

    /// ★ v1.21.1 生成一个远离所有营地 POI 的野外道路交叉节点（始祖出生地兜底，严禁落营地）
    pub(super) fn make_far_spawn_node(&mut self, camp_positions: &[Vec3], safe_dist: f32) -> u32 {
        let half_size = self.terrain.world_size / 2.0;
        let spread = self.config.poi_spawn_spread_ratio;
        let mut best = Vec3::ZERO;
        let mut best_min_dist = -1.0f32;
        for _ in 0..100 {
            let x = self.rng.gen_range(-half_size * spread, half_size * spread);
            let y = self.rng.gen_range(-half_size * spread, half_size * spread);
            let cand = Vec3::new(x, y, self.terrain.sample_elevation(x, y));
            let min_dist = camp_positions
                .iter()
                .map(|c| c.distance_to(&cand))
                .fold(f32::MAX, |a, b| a.min(b));
            if min_dist >= safe_dist {
                let nid = self.network.add_node(cand, NodeType::GroundIntersection);
                self.connect_spawn_node(nid);
                return nid;
            }
            // 记录当前最优（离最近营地最远）候选
            if min_dist > best_min_dist {
                best_min_dist = min_dist;
                best = cand;
            }
        }
        // 兜底：返回 100 次尝试中「离最近营地最远」的候选（最大化避让营地，绝不随机贴近营地）
        let nid = self.network.add_node(best, NodeType::GroundIntersection);
        self.connect_spawn_node(nid);
        nid
    }

    /// ★ v1.21.1 将新生成的野外节点就近接入既有路网（双向车道），保证始祖出生后即可寻路
    pub(super) fn connect_spawn_node(&mut self, nid: u32) {
        let pos = self.network.graph[*self.network.node_map.get(&nid).unwrap()].pos;
        let mut nearest: Vec<(f32, u32)> = self
            .network
            .graph
            .node_weights()
            .filter(|n| n.id != nid)
            .map(|n| (n.pos.distance_to(&pos), n.id))
            .collect();
        nearest.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        for (dist, other) in nearest.into_iter().take(2) {
            let road_class = if dist > self.config.road_grade_pave_threshold {
                RoadClass::Cobblestone
            } else {
                RoadClass::DirtTrack
            };
            let _ = self
                .network
                .add_lane(nid, other, None, road_class, &self.config);
            let _ = self
                .network
                .add_lane(other, nid, None, road_class, &self.config);
        }
    }
}
