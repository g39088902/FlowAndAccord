use rand::Rng;
use serde::{Deserialize, Serialize};

use super::vec3::Vec3;
use super::graph::{LaneGraph3D, LaneId, NodeId, NodeType, RoadClass};
use super::agent::{Agent3D, AgentId, PrimitiveActionState};
use super::poi::{PrimitivePoi, PoiId, PoiType};
use crate::geo::terrain::TerrainMap;

/// 外部渲染只读快照数据结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldSnapshot3D {
    pub tick: u64,
    pub terrain_cells: Vec<GeoCellSnapshot>,
    pub grid_w: usize,
    pub grid_h: usize,
    pub world_size: f32,
    pub tilt_angle_rad: f32,
    pub tilt_magnitude: f32,
    pub pois: Vec<PoiSnapshot>,
    pub nodes: Vec<NodeSnapshot>,
    pub lanes: Vec<LaneSnapshot>,
    pub agents: Vec<AgentSnapshot>,
    pub total_births: u32,
    pub total_deaths: u32,
    pub last_mutation_event: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoCellSnapshot {
    pub elevation: f32,
    pub slope_angle: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoiSnapshot {
    pub id: PoiId,
    pub poi_type: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub current_stock: f32,
    pub max_stock: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSnapshot {
    pub id: NodeId,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub node_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneSnapshot {
    pub id: LaneId,
    pub from: NodeId,
    pub to: NodeId,
    pub p0: Vec3,
    pub p1: Vec3,
    pub p2: Vec3,
    pub p3: Vec3,
    pub road_class: String,
    pub speed_limit: f32,
    pub is_hidden: bool,
    pub concealment: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSnapshot {
    pub id: AgentId,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub heading_rad: f32,
    pub pitch_rad: f32,
    pub velocity: f32,
    pub state: String,
    pub is_alive: bool,
    pub hunger: f32,
    pub thirst: f32,
    pub stamina: f32,
    pub inventory_food: f32,
    pub is_pregnant: bool,
    pub pregnancy_progress: f32,
    pub is_offroad: bool,
    pub miscarriage_alert: bool,
    pub death_decay_timer: f32,
    pub death_cause: Option<String>,
    pub is_covert: bool,
    pub stealth_visibility: f32,
}

/// 3D 空间世界与原始生态生存繁衍仿真管理器
pub struct World3DEngine {
    pub terrain: TerrainMap,
    pub network: LaneGraph3D,
    pub pois: Vec<PrimitivePoi>,
    pub agents: Vec<Agent3D>,
    pub next_agent_id: AgentId,
    pub total_births: u32,
    pub total_deaths: u32,
    pub tick_counter: u64,
    pub last_event: Option<String>,
}

impl World3DEngine {
    pub fn new(grid_res: usize, world_size: f32) -> Self {
        let mut terrain = TerrainMap::new(grid_res, grid_res, world_size);
        terrain.generate_natural_landscape(42);

        Self {
            terrain,
            network: LaneGraph3D::new(),
            pois: Vec::new(),
            agents: Vec::new(),
            next_agent_id: 1,
            total_births: 0,
            total_deaths: 0,
            tick_counter: 0,
            last_event: None,
        }
    }

    /// 构建有限资源 POI (+100% 概率翻倍) 与全图直连动线
    pub fn seed_primitive_ecology(&mut self, agent_count: usize) {
        let mut rng = rand::thread_rng();
        let half_size = self.terrain.world_size / 2.0;

        self.pois.clear();
        self.network = LaneGraph3D::new();
        self.agents.clear();
        self.total_births = 0;
        self.total_deaths = 0;
        self.next_agent_id = 1;

        let mut camp_nodes = Vec::new();
        let mut water_nodes = Vec::new();
        let mut food_nodes = Vec::new();
        let mut all_node_ids = Vec::new();

        // 1. 生成 6 处避风营地 (+100% 翻倍)
        for i in 0..6 {
            let x = rng.gen_range(-half_size * 0.70..half_size * 0.70);
            let y = rng.gen_range(-half_size * 0.70..half_size * 0.70);
            let elev = self.terrain.sample_elevation(x, y) + 0.5;
            let node_id = self.network.add_node(Vec3::new(x, y, elev), NodeType::GroundIntersection);
            camp_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new((i + 1) as u32, PoiType::Camp, Vec3::new(x, y, elev)));
        }

        // 2. 生成 6 处低洼清泉 (+100% 翻倍)
        for i in 0..6 {
            let mut best_x = 0.0f32;
            let mut best_y = 0.0f32;
            let mut lowest_z = 999.0f32;

            for _ in 0..12 {
                let rx = rng.gen_range(-half_size * 0.85..half_size * 0.85);
                let ry = rng.gen_range(-half_size * 0.85..half_size * 0.85);
                let rz = self.terrain.sample_elevation(rx, ry);
                if rz < lowest_z {
                    lowest_z = rz;
                    best_x = rx;
                    best_y = ry;
                }
            }

            let node_id = self.network.add_node(Vec3::new(best_x, best_y, lowest_z), NodeType::GroundIntersection);
            water_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new((i + 10) as u32, PoiType::WaterSource, Vec3::new(best_x, best_y, lowest_z)));
        }

        // 3. 生成 8 处缓坡浆果灌木 (+100% 翻倍)
        for i in 0..8 {
            let x = rng.gen_range(-half_size * 0.80..half_size * 0.80);
            let y = rng.gen_range(-half_size * 0.80..half_size * 0.80);
            let elev = self.terrain.sample_elevation(x, y);
            let node_id = self.network.add_node(Vec3::new(x, y, elev), NodeType::GroundIntersection);
            food_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new((i + 20) as u32, PoiType::BerryBush, Vec3::new(x, y, elev)));
        }

        // 4. 地形过渡节点
        for _ in 0..16 {
            let x = rng.gen_range(-half_size * 0.85..half_size * 0.85);
            let y = rng.gen_range(-half_size * 0.85..half_size * 0.85);
            let elev = self.terrain.sample_elevation(x, y);
            let node_id = self.network.add_node(Vec3::new(x, y, elev), NodeType::GroundIntersection);
            all_node_ids.push(node_id);
        }

        // 5. 全图任意点直连路网 (已修筑道路100%移速，其余直连越野50%移速)
        for i in 0..all_node_ids.len() {
            for j in (i + 1)..all_node_ids.len() {
                let id_a = all_node_ids[i];
                let id_b = all_node_ids[j];
                let pos_a = self.network.graph[*self.network.node_map.get(&id_a).unwrap()].pos;
                let pos_b = self.network.graph[*self.network.node_map.get(&id_b).unwrap()].pos;
                let dist = pos_a.distanceTo(&pos_b);

                // 近距离有现成修筑道路 (100% 速度)，中远距离有直连越野便道 (50% 速度)
                if dist < 175.0 {
                    let delta_z = (pos_a.z - pos_b.z).abs();
                    let road_class = if delta_z > 8.0 { RoadClass::Cobblestone } else { RoadClass::DirtTrack };
                    let _ = self.network.add_lane(id_a, id_b, road_class);
                    let _ = self.network.add_lane(id_b, id_a, road_class);
                } else if dist < 360.0 {
                    // 直连荒野越野路径 (is_hidden = true 标识越野，移速降为 50%)
                    let _ = self.network.add_lane_with_options(id_a, id_b, None, RoadClass::DirtTrack, true, 0.9);
                    let _ = self.network.add_lane_with_options(id_b, id_a, None, RoadClass::DirtTrack, true, 0.9);
                }
            }
        }

        // 6. 注入初始部落民 (8 人)
        for i in 0..agent_count {
            let home_camp = camp_nodes[i % camp_nodes.len()];
            let is_covert = i % 4 == 0;
            let agent_id = self.next_agent_id;
            self.next_agent_id += 1;

            let mut agent = Agent3D::new(agent_id, home_camp, 8.5 + (i as f32 % 3.0), is_covert);
            let camp_pos = self.network.graph[*self.network.node_map.get(&home_camp).unwrap()].pos;
            agent.world_pos = camp_pos;
            self.agents.push(agent);
        }

        self.last_event = Some("🏕️ 生态繁盛升级: POI数量翻倍至20处，消耗减半，支持全图直连越野！".to_string());
    }

    /// 真实有限资源交互结算与分娩
    pub fn tick_poi_interactions(&mut self, dt: f32) {
        let mut newborn_mothers = Vec::new();

        for agent in &mut self.agents {
            if !agent.is_alive {
                continue;
            }

            if agent.ready_to_birth {
                agent.ready_to_birth = false;
                newborn_mothers.push((agent.id, agent.home_camp_node));
            }

            match agent.state {
                PrimitiveActionState::DrinkingAtWater => {
                    let agent_pos = agent.world_pos;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::WaterSource && p.pos.distance_to(&agent_pos) < 22.0) {
                        let extracted = poi.extract(30.0 * dt);
                        agent.thirst = (agent.thirst + extracted * 1.2).min(100.0);
                    }
                }
                PrimitiveActionState::ForagingFood => {
                    let agent_pos = agent.world_pos;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::BerryBush && p.pos.distance_to(&agent_pos) < 22.0) {
                        if agent.inventory_food < 4.0 {
                            let extracted = poi.extract(1.2 * dt);
                            agent.inventory_food = (agent.inventory_food + extracted).min(4.0);
                            agent.hunger = (agent.hunger + extracted * 20.0).min(100.0);
                        }
                    }
                }
                _ => {}
            }
        }

        // 分娩诞生新生儿！
        for (mother_id, camp_node) in newborn_mothers {
            let baby_id = self.next_agent_id;
            self.next_agent_id += 1;
            self.total_births += 1;

            let mut baby = Agent3D::new(baby_id, camp_node, 8.5, false);
            let camp_pos = self.network.graph[*self.network.node_map.get(&camp_node).unwrap()].pos;
            baby.world_pos = camp_pos;
            baby.hunger = 95.0;
            baby.thirst = 95.0;
            baby.stamina = 100.0;
            baby.inventory_food = 0.5;

            self.agents.push(baby);
            self.last_event = Some(format!("🍼 母亲 #{} 顺利产下一名健康的新生儿 (Agent #{})！部落添丁！", mother_id, baby_id));
        }

        self.agents.retain(|a| a.is_alive || a.death_decay_timer > 0.0);
    }

    /// 生存决策调度
    pub fn tick_decisions(&mut self) {
        let mut rng = rand::thread_rng();

        let water_nodes: Vec<NodeId> = self.pois.iter().filter(|p| p.poi_type == PoiType::WaterSource && p.current_stock > 1.0)
            .filter_map(|p| self.find_nearest_node(p.pos)).collect();
        let food_nodes: Vec<NodeId> = self.pois.iter().filter(|p| p.poi_type == PoiType::BerryBush && p.current_stock > 1.0)
            .filter_map(|p| self.find_nearest_node(p.pos)).collect();

        for agent in &mut self.agents {
            if !agent.is_alive {
                continue;
            }

            match agent.state {
                PrimitiveActionState::RestingAtCamp => {
                    let thirst_urgency = if agent.is_pregnant { 55.0 } else { 40.0 };
                    let hunger_urgency = if agent.is_pregnant { 60.0 } else { 48.0 };

                    if agent.thirst < thirst_urgency && !water_nodes.is_empty() {
                        let target = water_nodes[rng.gen_range(0..water_nodes.len())];
                        if let Some(path) = self.network.find_path_3d_with_preference(agent.home_camp_node, target, agent.is_covert) {
                            if !path.is_empty() {
                                agent.state = PrimitiveActionState::SeekingWater;
                                agent.target_poi_node = Some(target);
                                agent.route = path.clone();
                                agent.route_index = 0;
                                agent.current_lane_id = Some(path[0]);
                                agent.distance_along_curve = 0.0;
                            }
                        }
                    } else if (agent.hunger < hunger_urgency || agent.inventory_food < 0.5) && !food_nodes.is_empty() {
                        let target = food_nodes[rng.gen_range(0..food_nodes.len())];
                        if let Some(path) = self.network.find_path_3d_with_preference(agent.home_camp_node, target, agent.is_covert) {
                            if !path.is_empty() {
                                agent.state = PrimitiveActionState::SeekingFood;
                                agent.target_poi_node = Some(target);
                                agent.route = path.clone();
                                agent.route_index = 0;
                                agent.current_lane_id = Some(path[0]);
                                agent.distance_along_curve = 0.0;
                            }
                        }
                    } else if agent.stamina >= 95.0 && agent.hunger > 65.0 && !food_nodes.is_empty() && rng.gen_bool(0.04) {
                        let target = food_nodes[rng.gen_range(0..food_nodes.len())];
                        if let Some(path) = self.network.find_path_3d_with_preference(agent.home_camp_node, target, agent.is_covert) {
                            if !path.is_empty() {
                                agent.state = PrimitiveActionState::SeekingFood;
                                agent.target_poi_node = Some(target);
                                agent.route = path.clone();
                                agent.route_index = 0;
                                agent.current_lane_id = Some(path[0]);
                                agent.distance_along_curve = 0.0;
                            }
                        }
                    }
                }
                PrimitiveActionState::DrinkingAtWater => {
                    if agent.thirst >= 90.0 {
                        if agent.hunger < 50.0 && !food_nodes.is_empty() {
                            let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                            let target = food_nodes[rng.gen_range(0..food_nodes.len())];
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.state = PrimitiveActionState::SeekingFood;
                                    agent.target_poi_node = Some(target);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        } else {
                            let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, agent.home_camp_node, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.state = PrimitiveActionState::ReturningToCamp;
                                    agent.target_poi_node = Some(agent.home_camp_node);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        }
                    }
                }
                PrimitiveActionState::ForagingFood => {
                    if agent.hunger >= 85.0 && agent.inventory_food >= 2.5 {
                        let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                        if let Some(path) = self.network.find_path_3d_with_preference(curr_node, agent.home_camp_node, agent.is_covert) {
                            if !path.is_empty() {
                                agent.state = PrimitiveActionState::ReturningToCamp;
                                agent.target_poi_node = Some(agent.home_camp_node);
                                agent.route = path.clone();
                                agent.route_index = 0;
                                agent.current_lane_id = Some(path[0]);
                                agent.distance_along_curve = 0.0;
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn find_nearest_node(&self, pos: Vec3) -> Option<NodeId> {
        let mut best_id = None;
        let mut min_dist = f32::MAX;
        for node in self.network.graph.node_weights() {
            let d = node.pos.distance_to(&pos);
            if d < min_dist {
                min_dist = d;
                best_id = Some(node.id);
            }
        }
        best_id
    }

    /// 确定性仿真 Tick
    pub fn tick(&mut self, dt: f32) {
        self.tick_counter += 1;

        // 1. POI 自然恢复
        for poi in &mut self.pois {
            poi.tick_regenerate(dt);
        }

        // 2. 代谢与繁衍
        for agent in &mut self.agents {
            if let Some(event) = agent.tick_metabolism(dt) {
                if !agent.is_alive {
                    self.total_deaths += 1;
                }
                self.last_event = Some(event);
            }
        }

        // 3. POI 实际提取、分娩与死亡尸骸消逝
        self.tick_poi_interactions(dt);

        if self.tick_counter % 15 == 0 {
            self.tick_decisions();
        }

        // 4. 动力学运动
        for agent in &mut self.agents {
            agent.tick_movement(dt, &self.network);
        }
    }

    /// 导出快照
    pub fn generate_snapshot(&self) -> WorldSnapshot3D {
        let mut terrain_cells = Vec::with_capacity(self.terrain.cells.len());
        for cell in &self.terrain.cells {
            terrain_cells.push(GeoCellSnapshot {
                elevation: cell.elevation,
                slope_angle: cell.slope_angle_deg,
            });
        }

        let mut pois = Vec::new();
        for p in &self.pois {
            pois.push(PoiSnapshot {
                id: p.id,
                poi_type: format!("{:?}", p.poi_type),
                x: p.pos.x,
                y: p.pos.y,
                z: p.pos.z,
                current_stock: p.current_stock,
                max_stock: p.max_stock,
            });
        }

        let mut nodes = Vec::new();
        for node_idx in self.network.graph.node_indices() {
            let node = &self.network.graph[node_idx];
            nodes.push(NodeSnapshot {
                id: node.id,
                x: node.pos.x,
                y: node.pos.y,
                z: node.pos.z,
                node_type: format!("{:?}", node.node_type),
            });
        }

        let mut lanes = Vec::new();
        for edge_idx in self.network.graph.edge_indices() {
            let lane = &self.network.graph[edge_idx];
            lanes.push(LaneSnapshot {
                id: lane.id,
                from: lane.from_node,
                to: lane.to_node,
                p0: lane.curve.p0,
                p1: lane.curve.p1,
                p2: lane.curve.p2,
                p3: lane.curve.p3,
                road_class: format!("{:?}", lane.road_class),
                speed_limit: lane.speed_limit,
                is_hidden: lane.is_hidden,
                concealment: lane.concealment,
            });
        }

        let mut agents = Vec::new();
        for agent in &self.agents {
            agents.push(AgentSnapshot {
                id: agent.id,
                x: agent.world_pos.x,
                y: agent.world_pos.y,
                z: agent.world_pos.z,
                heading_rad: agent.forward_heading_rad,
                pitch_rad: agent.pitch_rad,
                velocity: agent.current_velocity,
                state: format!("{:?}", agent.state),
                is_alive: agent.is_alive,
                hunger: agent.hunger,
                thirst: agent.thirst,
                stamina: agent.stamina,
                inventory_food: agent.inventory_food,
                is_pregnant: agent.is_pregnant,
                pregnancy_progress: agent.pregnancy_progress,
                is_offroad: agent.is_traveling_offroad,
                miscarriage_alert: agent.miscarriage_alert_timer > 0.0,
                death_decay_timer: agent.death_decay_timer,
                death_cause: agent.death_cause.clone(),
                is_covert: agent.is_covert,
                stealth_visibility: agent.stealth_visibility,
            });
        }

        WorldSnapshot3D {
            tick: self.tick_counter,
            terrain_cells,
            grid_w: self.terrain.grid_width,
            grid_h: self.terrain.grid_height,
            world_size: self.terrain.world_size,
            tilt_angle_rad: self.terrain.tilt_angle_rad,
            tilt_magnitude: self.terrain.tilt_magnitude,
            pois,
            nodes,
            lanes,
            agents,
            total_births: self.total_births,
            total_deaths: self.total_deaths,
            last_mutation_event: self.last_event.clone(),
        }
    }
}
