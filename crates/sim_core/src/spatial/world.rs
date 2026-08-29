use rand::Rng;
use serde::{Deserialize, Serialize};

use super::vec3::Vec3;
use super::graph::{LaneGraph3D, LaneId, NodeId, NodeType, RoadClass};
use super::agent::{Agent3D, AgentId, PrimitiveActionState};
use super::poi::{PrimitivePoi, PoiId, PoiType};
use crate::geo::terrain::TerrainMap;

/// 外部渲染只读快照数据结构 (包含原始生态 POI 与 Agent 生命体征)
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
    pub resource_amount: f32,
    pub max_capacity: f32,
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
    pub hunger: f32,
    pub thirst: f32,
    pub stamina: f32,
    pub inventory_food: f32,
    pub is_covert: bool,
    pub stealth_visibility: f32,
}

/// 3D 空间世界与原始生态生存仿真管理器
pub struct World3DEngine {
    pub terrain: TerrainMap,
    pub network: LaneGraph3D,
    pub pois: Vec<PrimitivePoi>,
    pub agents: Vec<Agent3D>,
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
            tick_counter: 0,
            last_event: None,
        }
    }

    /// 根据地形高程生成原始三大生态 POI (营地、水坑、浆果丛) 与自然步道
    pub fn seed_primitive_ecology(&mut self, agent_count: usize) {
        let mut rng = rand::thread_rng();
        let half_size = self.terrain.world_size / 2.0;

        self.pois.clear();
        self.network = LaneGraph3D::new();
        self.agents.clear();

        let mut camp_nodes = Vec::new();
        let mut water_nodes = Vec::new();
        let mut food_nodes = Vec::new();
        let mut all_node_ids = Vec::new();

        // 1. 生成 3 处避风高台营地 (Camp: 位于中高地台 Z ∈ [-5m, 15m])
        for i in 0..3 {
            let x = rng.gen_range(-half_size * 0.65..half_size * 0.65);
            let y = rng.gen_range(-half_size * 0.65..half_size * 0.65);
            let elev = self.terrain.sample_elevation(x, y) + 0.5;
            let node_id = self.network.add_node(Vec3::new(x, y, elev), NodeType::GroundIntersection);
            camp_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new((i + 1) as u32, PoiType::Camp, Vec3::new(x, y, elev)));
        }

        // 2. 生成 3 处低洼水源地 (WaterSource: 探寻地势最低洼处)
        for i in 0..3 {
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

        // 3. 生成 4 处缓坡浆果丛 (BerryBush: 散布在缓坡向阳面)
        for i in 0..4 {
            let x = rng.gen_range(-half_size * 0.75..half_size * 0.75);
            let y = rng.gen_range(-half_size * 0.75..half_size * 0.75);
            let elev = self.terrain.sample_elevation(x, y);
            let node_id = self.network.add_node(Vec3::new(x, y, elev), NodeType::GroundIntersection);
            food_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new((i + 20) as u32, PoiType::BerryBush, Vec3::new(x, y, elev)));
        }

        // 4. 生成若干中间地形路口过渡节点
        for _ in 0..18 {
            let x = rng.gen_range(-half_size * 0.85..half_size * 0.85);
            let y = rng.gen_range(-half_size * 0.85..half_size * 0.85);
            let elev = self.terrain.sample_elevation(x, y);
            let node_id = self.network.add_node(Vec3::new(x, y, elev), NodeType::GroundIntersection);
            all_node_ids.push(node_id);
        }

        // 5. 在营地、水源与浆果丛之间铺设初级步行道 (DirtTrack / Cobblestone)
        for i in 0..all_node_ids.len() {
            for j in (i + 1)..all_node_ids.len() {
                let id_a = all_node_ids[i];
                let id_b = all_node_ids[j];
                let pos_a = self.network.graph[*self.network.node_map.get(&id_a).unwrap()].pos;
                let pos_b = self.network.graph[*self.network.node_map.get(&id_b).unwrap()].pos;

                let dist = pos_a.distanceTo(&pos_b);
                if dist < 190.0 {
                    let delta_z = (pos_a.z - pos_b.z).abs();
                    let road_class = if delta_z > 8.0 {
                        RoadClass::Cobblestone // 盘坡石子路
                    } else if rng.gen_bool(0.2) {
                        RoadClass::SmugglerTrail // 隐秘小径
                    } else {
                        RoadClass::DirtTrack // 泥泞步行土路
                    };

                    let is_hidden = road_class == RoadClass::SmugglerTrail;
                    let _ = self.network.add_lane_with_options(id_a, id_b, None, road_class, is_hidden, if is_hidden { 0.85 } else { 0.0 });
                    let _ = self.network.add_lane_with_options(id_b, id_a, None, road_class, is_hidden, if is_hidden { 0.85 } else { 0.0 });
                }
            }
        }

        // 6. 注入原始 Agent，并分配归宿营地
        for i in 0..agent_count {
            let home_camp = camp_nodes[i % camp_nodes.len()];
            let is_covert = i % 4 == 0; // 每4个中有一个敏锐猎人/特工
            let mut agent = Agent3D::new((i + 1) as u32, home_camp, 9.0 + (i as f32 % 5.0), is_covert);
            let camp_pos = self.network.graph[*self.network.node_map.get(&home_camp).unwrap()].pos;
            agent.world_pos = camp_pos;
            self.agents.push(agent);
        }

        self.last_event = Some("🏕️ 原始生态建立: 包含 3 处避风营地、3 处低洼清泉与 4 处浆果丛。".to_string());
    }

    /// 决策与生存状态机调度循环
    pub fn tick_decisions(&mut self) {
        let mut rng = rand::thread_rng();

        let water_nodes: Vec<NodeId> = self.pois.iter().filter(|p| p.poi_type == PoiType::WaterSource)
            .filter_map(|p| self.find_nearest_node(p.pos)).collect();
        let food_nodes: Vec<NodeId> = self.pois.iter().filter(|p| p.poi_type == PoiType::BerryBush)
            .filter_map(|p| self.find_nearest_node(p.pos)).collect();

        for agent in &mut self.agents {
            match agent.state {
                PrimitiveActionState::RestingAtCamp => {
                    // 在营地休息时根据紧迫度发起行动
                    if agent.thirst < 40.0 && !water_nodes.is_empty() {
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
                    } else if (agent.hunger < 50.0 || agent.inventory_food < 0.5) && !food_nodes.is_empty() {
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
                    } else if agent.stamina >= 95.0 && agent.hunger > 60.0 && !food_nodes.is_empty() && rng.gen_bool(0.04) {
                        // 精力充沛时外出采果储备
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
                    // 水喝饱后决定下一步
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
                            // 喝饱回营地
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
                    // 采满野果或吃饱后返回营地
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
                PrimitiveActionState::OffRoadDetour => {
                    // 迷路脱困直接搜寻返回营地
                    let curr_pos = agent.world_pos;
                    if let Some(near_node) = self.find_nearest_node(curr_pos) {
                        if let Some(path) = self.network.find_path_3d_with_preference(near_node, agent.home_camp_node, agent.is_covert) {
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

        // 1. POI 资源再生
        for poi in &mut self.pois {
            poi.tick_regenerate(dt);
        }

        // 2. 生理代谢与决策调度
        for agent in &mut self.agents {
            agent.tick_metabolism(dt);
        }

        if self.tick_counter % 20 == 0 {
            self.tick_decisions();
        }

        // 3. 动力学运动与坡度能耗
        for agent in &mut self.agents {
            agent.tick_movement(dt, &self.network);
        }
    }

    /// 导出包含 POI 与生存体征的完整渲染快照
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
                resource_amount: p.resource_amount,
                max_capacity: p.max_capacity,
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
                hunger: agent.hunger,
                thirst: agent.thirst,
                stamina: agent.stamina,
                inventory_food: agent.inventory_food,
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
            last_mutation_event: self.last_event.clone(),
        }
    }
}
