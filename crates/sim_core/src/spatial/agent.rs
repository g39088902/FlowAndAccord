use serde::{Deserialize, Serialize};
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, LaneId, NodeId};

pub type AgentId = u32;

/// 原始生存行为状态机
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrimitiveActionState {
    RestingAtCamp,      // 🏕️ 营地休息 (恢复体力、吃浆果)
    SeekingWater,       // 🚶 正在赶往水源
    DrinkingAtWater,    // 💧 正在水坑饮水
    SeekingFood,        // 🚶 正在赶往采摘区
    ForagingFood,       // 🍒 正在采摘浆果
    ReturningToCamp,    // 🏕️ 负重/疲惫返回营地
    OffRoadDetour,      // ⚠️ 寻路脱困中
}

/// 3D 动力学生存 Agent 实体 (具备生理代谢与坡度能耗感知)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent3D {
    pub id: AgentId,
    pub state: PrimitiveActionState,

    // 生理代谢稳态指标 (0.0 ~ 100.0)
    pub hunger: f32,          // 饱食度 (100 = 饱, 0 = 极度饥饿)
    pub thirst: f32,          // 水分值 (100 = 充足, 0 = 严重脱水)
    pub stamina: f32,         // 体力值 (100 = 充沛, 0 = 精疲力竭)
    pub inventory_food: f32,  // 携带的野果数量 (0 ~ 5)
    pub home_camp_node: NodeId, // 所属归宿营地节点
    pub target_poi_node: Option<NodeId>, // 当前行动目标节点

    // 空间运动参数
    pub current_lane_id: Option<LaneId>,
    pub distance_along_curve: f32,
    pub current_velocity: f32,
    pub max_desired_speed: f32,
    pub route: Vec<LaneId>,
    pub route_index: usize,

    // 隐秘特性 (潜行特工/流民)
    pub is_covert: bool,
    pub stealth_visibility: f32,

    // 空间状态缓存
    pub world_pos: Vec3,
    pub forward_heading_rad: f32,
    pub pitch_rad: f32,
}

impl Agent3D {
    pub fn new(id: AgentId, home_camp: NodeId, max_speed: f32, is_covert: bool) -> Self {
        Self {
            id,
            state: PrimitiveActionState::RestingAtCamp,
            hunger: 85.0 + (id as f32 % 15.0),
            thirst: 80.0 + (id as f32 % 20.0),
            stamina: 90.0,
            inventory_food: 1.0,
            home_camp_node: home_camp,
            target_poi_node: None,
            current_lane_id: None,
            distance_along_curve: 0.0,
            current_velocity: 0.0,
            max_desired_speed: max_speed,
            route: Vec::new(),
            route_index: 0,
            is_covert,
            stealth_visibility: if is_covert { 0.25 } else { 1.0 },
            world_pos: Vec3::ZERO,
            forward_heading_rad: 0.0,
            pitch_rad: 0.0,
        }
    }

    /// 核心生命代谢 Tick
    pub fn tick_metabolism(&mut self, dt: f32) {
        // 1. 基础基础代谢自然衰减
        self.hunger = (self.hunger - 0.45 * dt).max(0.0);
        self.thirst = (self.thirst - 0.85 * dt).max(0.0); // 水分消耗快于饥饿

        // 2. 状态内原位交互行为 (休眠恢复、饮水、采摘)
        match self.state {
            PrimitiveActionState::RestingAtCamp => {
                // 在营地休眠快速恢复体力
                self.stamina = (self.stamina + 8.0 * dt).min(100.0);
                // 饿了且包里有食物则进食
                if self.hunger < 70.0 && self.inventory_food > 0.1 {
                    let eat_amount = (1.5 * dt).min(self.inventory_food);
                    self.inventory_food -= eat_amount;
                    self.hunger = (self.hunger + eat_amount * 25.0).min(100.0);
                }
            }
            PrimitiveActionState::DrinkingAtWater => {
                // 水坑狂饮恢复水分
                self.thirst = (self.thirst + 35.0 * dt).min(100.0);
            }
            PrimitiveActionState::ForagingFood => {
                // 采集浆果，满载或饱腹即可
                if self.inventory_food < 4.0 {
                    self.inventory_food = (self.inventory_food + 1.2 * dt).min(4.0);
                }
                if self.hunger < 90.0 {
                    self.hunger = (self.hunger + 15.0 * dt).min(100.0);
                }
            }
            _ => {}
        }
    }

    /// 3D 动力学移动与坡度能耗结算
    pub fn tick_movement(&mut self, dt: f32, road_network: &LaneGraph3D) {
        let is_moving = matches!(
            self.state,
            PrimitiveActionState::SeekingWater
                | PrimitiveActionState::SeekingFood
                | PrimitiveActionState::ReturningToCamp
        );

        if !is_moving {
            self.current_velocity = 0.0;
            return;
        }

        let Some(lane_id) = self.current_lane_id else { return };
        let Some(edge_idx) = road_network.edge_map.get(&lane_id) else {
            self.state = PrimitiveActionState::OffRoadDetour;
            return;
        };

        let lane = &road_network.graph[*edge_idx];

        // 坡度计算: 起点与终点的高程差
        let delta_z = lane.curve.p3.z - lane.curve.p0.z;
        let uphill_penalty = if delta_z > 0.0 { (delta_z / lane.curve.length).max(0.0) } else { 0.0 };

        // 上坡显著增加体力消耗: Grade-Aware Stamina Burn
        let stamina_burn = 1.2 * (1.0 + uphill_penalty * 3.5);
        self.stamina = (self.stamina - stamina_burn * dt).max(0.0);

        // 体力疲惫时移速大幅下降
        let stamina_factor = (self.stamina / 30.0).clamp(0.25, 1.0);
        let target_speed = self.max_desired_speed.min(lane.speed_limit) * stamina_factor;

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
            let h_len = (tangent.x * tangent.x + tangent.y * tangent.y).sqrt();
            self.pitch_rad = tangent.z.atan2(h_len);
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
                self.state = PrimitiveActionState::OffRoadDetour;
            }
        } else {
            // 到达目的地，转入原位交互状态
            self.current_velocity = 0.0;
            self.current_lane_id = None;
            match self.state {
                PrimitiveActionState::SeekingWater => {
                    self.state = PrimitiveActionState::DrinkingAtWater;
                }
                PrimitiveActionState::SeekingFood => {
                    self.state = PrimitiveActionState::ForagingFood;
                }
                PrimitiveActionState::ReturningToCamp => {
                    self.state = PrimitiveActionState::RestingAtCamp;
                }
                _ => {}
            }
        }
    }
}
