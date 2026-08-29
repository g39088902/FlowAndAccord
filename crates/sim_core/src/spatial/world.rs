use rand::Rng;
use serde::{Deserialize, Serialize};

use super::vec3::Vec3;
use super::graph::{LaneGraph3D, LaneId, NodeId, NodeType, RoadClass};
use super::agent::{Agent3D, AgentId, AgentState, AgentType};
use crate::geo::terrain::TerrainMap;

/// 外部渲染只读快照数据结构 (纯净高程与路网)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldSnapshot3D {
    pub tick: u64,
    pub terrain_cells: Vec<GeoCellSnapshot>,
    pub grid_w: usize,
    pub grid_h: usize,
    pub world_size: f32,
    pub tilt_angle_rad: f32,
    pub tilt_magnitude: f32,
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
    pub agent_type: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub heading_rad: f32,
    pub pitch_rad: f32,
    pub velocity: f32,
    pub state: String,
    pub is_covert: bool,
    pub stealth_visibility: f32,
}

/// 3D 空间世界与倾斜起伏地势交通仿真管理器
pub struct World3DEngine {
    pub terrain: TerrainMap,
    pub network: LaneGraph3D,
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
            agents: Vec::new(),
            tick_counter: 0,
            last_event: None,
        }
    }

    /// 根据倾斜起伏地形铺设立体路网与隐藏密道
    pub fn seed_geo_aware_city(&mut self, surface_node_count: usize) {
        let mut rng = rand::thread_rng();
        let half_size = self.terrain.world_size / 2.0;

        let mut node_ids = Vec::new();

        // 1. 生成地表与局部高架节点 (吸附地表高程)
        for _ in 0..surface_node_count {
            let x = rng.gen_range(-half_size * 0.88..half_size * 0.88);
            let y = rng.gen_range(-half_size * 0.88..half_size * 0.88);
            let mut elev = self.terrain.sample_elevation(x, y);

            let node_type = if rng.gen_bool(0.15) {
                elev += 12.0; // 局部高架立交桥
                NodeType::ElevatedOverpass
            } else {
                NodeType::GroundIntersection
            };

            let id = self.network.add_node(Vec3::new(x, y, elev), node_type);
            node_ids.push(id);
        }

        // 2. 邻近节点铺设车道 (支持公共干道、缓坡路与隐藏走私便道)
        for i in 0..node_ids.len() {
            for j in (i + 1)..node_ids.len() {
                let id_a = node_ids[i];
                let id_b = node_ids[j];
                let pos_a = self.network.graph[*self.network.node_map.get(&id_a).unwrap()].pos;
                let pos_b = self.network.graph[*self.network.node_map.get(&id_b).unwrap()].pos;

                let dist = pos_a.distanceTo(&pos_b);
                if dist < 195.0 {
                    let will_be_hidden = rng.gen_bool(0.22); // 随机隐秘便道

                    let road_class = if will_be_hidden {
                        RoadClass::SmugglerTrail
                    } else if pos_a.z > 14.0 || pos_b.z > 14.0 {
                        RoadClass::SkywayElevated
                    } else if (pos_a.z - pos_b.z).abs() > 4.0 {
                        RoadClass::Cobblestone
                    } else if rng.gen_bool(0.3) {
                        RoadClass::DirtTrack
                    } else {
                        RoadClass::AsphaltUrban
                    };

                    let _ = self.network.add_lane_with_options(
                        id_a, id_b, None, road_class, will_be_hidden, if will_be_hidden { 0.85 } else { 0.0 },
                    );
                    let _ = self.network.add_lane_with_options(
                        id_b, id_a, None, road_class, will_be_hidden, if will_be_hidden { 0.85 } else { 0.0 },
                    );
                }
            }
        }
    }

    /// 注入常规市民 Agent
    pub fn spawn_random_agent(&mut self, max_speed: f32) -> Option<AgentId> {
        self.spawn_typed_agent(max_speed, AgentType::Civilian)
    }

    /// 注入指定类型 Agent (市民 / 货运 / 潜行特工)
    pub fn spawn_typed_agent(&mut self, max_speed: f32, agent_type: AgentType) -> Option<AgentId> {
        let node_keys: Vec<NodeId> = self.network.node_map.keys().copied().collect();
        if node_keys.len() < 2 {
            return None;
        }

        let mut rng = rand::thread_rng();
        let start = node_keys[rng.gen_range(0..node_keys.len())];
        let mut goal = node_keys[rng.gen_range(0..node_keys.len())];
        while goal == start {
            goal = node_keys[rng.gen_range(0..node_keys.len())];
        }

        let prefer_hidden = matches!(agent_type, AgentType::Smuggler | AgentType::CovertOperative);
        let path = self.network.find_path_3d_with_preference(start, goal, prefer_hidden)?;
        if path.is_empty() {
            return None;
        }

        let agent_id = (self.agents.len() + 1) as u32;
        let mut agent = Agent3D::new_with_type(agent_id, start, goal, max_speed, agent_type);
        agent.state = if prefer_hidden { AgentState::StealthInfiltrating } else { AgentState::Navigating };
        agent.current_lane_id = Some(path[0]);
        agent.route = path;
        agent.route_index = 0;

        let start_pos = self.network.graph[*self.network.node_map.get(&start).unwrap()].pos;
        agent.world_pos = start_pos;

        self.agents.push(agent);
        Some(agent_id)
    }

    /// 刷新到达终点的 Agent
    pub fn refresh_arrived_agents(&mut self) {
        let node_keys: Vec<NodeId> = self.network.node_map.keys().copied().collect();
        if node_keys.len() < 2 {
            return;
        }

        let mut rng = rand::thread_rng();
        for agent in &mut self.agents {
            if agent.state == AgentState::Arrived || agent.state == AgentState::OffRoadDetour {
                let start = node_keys[rng.gen_range(0..node_keys.len())];
                let mut goal = node_keys[rng.gen_range(0..node_keys.len())];
                while goal == start {
                    goal = node_keys[rng.gen_range(0..node_keys.len())];
                }

                let prefer_hidden = matches!(agent.agent_type, AgentType::Smuggler | AgentType::CovertOperative);
                if let Some(path) = self.network.find_path_3d_with_preference(start, goal, prefer_hidden) {
                    if !path.is_empty() {
                        agent.state = if prefer_hidden { AgentState::StealthInfiltrating } else { AgentState::Navigating };
                        agent.origin_node = start;
                        agent.destination_node = goal;
                        agent.current_lane_id = Some(path[0]);
                        agent.distance_along_curve = 0.0;
                        agent.route = path;
                        agent.route_index = 0;
                        let start_pos = self.network.graph[*self.network.node_map.get(&start).unwrap()].pos;
                        agent.world_pos = start_pos;
                    }
                }
            }
        }
    }

    /// 确定性仿真 Tick
    pub fn tick(&mut self, dt: f32) {
        self.tick_counter += 1;

        if self.tick_counter % 150 == 0 {
            self.trigger_random_topology_mutation();
        }

        if self.tick_counter % 30 == 0 {
            self.refresh_arrived_agents();
        }

        for agent in &mut self.agents {
            agent.tick(dt, &self.network);
        }
    }

    /// 随机拓扑突变
    pub fn trigger_random_topology_mutation(&mut self) {
        let mut rng = rand::thread_rng();

        let will_remove = rng.gen_bool(0.5) && self.network.edge_map.len() > 15;
        if will_remove {
            let keys: Vec<LaneId> = self.network.edge_map.keys().copied().collect();
            let target_lane = keys[rng.gen_range(0..keys.len())];
            if let Some(removed) = self.network.remove_lane(target_lane) {
                self.last_event = Some(format!("⚠️ 道路拆除/折损: Lane #{} ({} -> {})", removed.id, removed.from_node, removed.to_node));
            }
        } else {
            let node_keys: Vec<NodeId> = self.network.node_map.keys().copied().collect();
            if node_keys.len() >= 2 {
                let id_a = node_keys[rng.gen_range(0..node_keys.len())];
                let id_b = node_keys[rng.gen_range(0..node_keys.len())];
                if id_a != id_b {
                    let is_hidden = rng.gen_bool(0.25);
                    let road_class = if is_hidden {
                        RoadClass::SmugglerTrail
                    } else {
                        RoadClass::AsphaltUrban
                    };

                    if let Ok(lane_id) = self.network.add_lane_with_options(
                        id_a, id_b, None, road_class, is_hidden, if is_hidden { 0.85 } else { 0.0 }
                    ) {
                        self.last_event = Some(format!("✨ 拓扑自发生长: 新建车道 #{} ({})", lane_id, if is_hidden { "🕶️ 走私密道" } else { "公共干道" }));
                    }
                }
            }
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
                agent_type: format!("{:?}", agent.agent_type),
                x: agent.world_pos.x,
                y: agent.world_pos.y,
                z: agent.world_pos.z,
                heading_rad: agent.forward_heading_rad,
                pitch_rad: agent.pitch_rad,
                velocity: agent.current_velocity,
                state: format!("{:?}", agent.state),
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
            nodes,
            lanes,
            agents,
            last_mutation_event: self.last_event.clone(),
        }
    }
}
