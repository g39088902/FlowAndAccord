use serde::{Deserialize, Serialize};
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, LaneId, NodeId};

pub type AgentId = u32;

/// Agent 运行状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentState {
    Navigating,     // 正常在路网上通行
    OffRoadDetour,  // 遭遇断路，正在脱困
    Arrived,        // 抵达终点
    StealthInfiltrating, // 正在隐秘潜行穿越隐藏密道
}

/// Agent 职业与行为类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentType {
    Civilian,        // 普通市民 (走常规道路)
    CargoTransit,    // 物流货运 (重载干道)
    Smuggler,        // 走私商贩 (偏好隐秘暗道、避开税卡)
    CovertOperative, // 秘密特工/在野密探 (完全潜行，使用隐形迷彩)
}

/// 3D 动力学 Agent 实体 (支持潜行与伪装)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent3D {
    pub id: AgentId,
    pub agent_type: AgentType,
    pub state: AgentState,
    pub current_lane_id: Option<LaneId>,
    pub distance_along_curve: f32, // 沿当前曲线行进距离 s ∈ [0.0, curve.length]
    pub current_velocity: f32,     // 当前线速度 (m/s)
    pub max_desired_speed: f32,    // 期望巡航速度 (m/s)
    pub route: Vec<LaneId>,        // 剩余车道规划
    pub route_index: usize,        // 当前所在 route 索引
    pub origin_node: NodeId,
    pub destination_node: NodeId,

    // 隐秘与潜行特性
    pub is_covert: bool,           // 是否处于隐秘/潜行状态
    pub stealth_visibility: f32,   // 隐形透明度 0.0 (完全隐形) ~ 1.0 (完全显形)

    // 空间表现数据缓存（用于 3D 渲染与物理导出）
    pub world_pos: Vec3,
    pub forward_heading_rad: f32, // 水平偏航角 (Yaw)
    pub pitch_rad: f32,           // 垂直俯仰角 (Pitch)
}

impl Agent3D {
    pub fn new(id: AgentId, origin: NodeId, destination: NodeId, max_speed: f32) -> Self {
        Self::new_with_type(id, origin, destination, max_speed, AgentType::Civilian)
    }

    pub fn new_with_type(
        id: AgentId,
        origin: NodeId,
        destination: NodeId,
        max_speed: f32,
        agent_type: AgentType,
    ) -> Self {
        let is_covert = matches!(agent_type, AgentType::Smuggler | AgentType::CovertOperative);
        Self {
            id,
            agent_type,
            state: AgentState::Arrived,
            current_lane_id: None,
            distance_along_curve: 0.0,
            current_velocity: 0.0,
            max_desired_speed: max_speed,
            route: Vec::new(),
            route_index: 0,
            origin_node: origin,
            destination_node: destination,
            is_covert,
            stealth_visibility: if is_covert { 0.25 } else { 1.0 },
            world_pos: Vec3::ZERO,
            forward_heading_rad: 0.0,
            pitch_rad: 0.0,
        }
    }

    /// 核心 Tick 物理与潜行状态更新
    pub fn tick(&mut self, dt: f32, road_network: &LaneGraph3D) {
        if self.state == AgentState::Arrived || self.state == AgentState::OffRoadDetour {
            return;
        }

        let Some(lane_id) = self.current_lane_id else { return };
        let Some(edge_idx) = road_network.edge_map.get(&lane_id) else {
            self.handle_lane_severance();
            return;
        };

        let lane = &road_network.graph[*edge_idx];
        let target_speed = self.max_desired_speed.min(lane.speed_limit);

        // 潜行状态动态判定：在隐藏道路上潜行系数增强
        if lane.is_hidden || self.is_covert {
            self.state = AgentState::StealthInfiltrating;
            self.stealth_visibility = (self.stealth_visibility - 1.5 * dt).max(0.15);
        } else {
            self.state = AgentState::Navigating;
            self.stealth_visibility = (self.stealth_visibility + 1.0 * dt).min(1.0);
        }

        // 动力学平滑加减速逼近
        let accel = (target_speed - self.current_velocity) * 3.0;
        self.current_velocity = (self.current_velocity + accel * dt).max(0.0);
        self.distance_along_curve += self.current_velocity * dt;

        if self.distance_along_curve >= lane.curve.length {
            self.advance_to_next_lane(road_network);
        } else {
            let t = (self.distance_along_curve / lane.curve.length).clamp(0.0, 1.0);
            self.world_pos = lane.curve.evaluate_pos(t);
            let tangent = lane.curve.evaluate_tangent(t);

            self.forward_heading_rad = tangent.y.atan2(tangent.x);
            let horizontal_len = (tangent.x * tangent.x + tangent.y * tangent.y).sqrt();
            self.pitch_rad = tangent.z.atan2(horizontal_len);
        }
    }

    /// 跨越到路线中的下一条车道
    fn advance_to_next_lane(&mut self, road_network: &LaneGraph3D) {
        self.route_index += 1;
        if self.route_index < self.route.len() {
            let next_lane_id = self.route[self.route_index];
            if road_network.edge_map.contains_key(&next_lane_id) {
                self.current_lane_id = Some(next_lane_id);
                self.distance_along_curve = 0.0;
            } else {
                self.handle_lane_severance();
            }
        } else {
            self.state = AgentState::Arrived;
            self.current_velocity = 0.0;
            self.current_lane_id = None;
        }
    }

    /// 断路紧急自愈
    pub fn handle_lane_severance(&mut self) {
        self.state = AgentState::OffRoadDetour;
        self.current_velocity = 0.0;
        self.route.clear();
        self.current_lane_id = None;
    }
}
