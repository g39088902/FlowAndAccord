use serde::{Deserialize, Serialize};
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, LaneId, NodeId};

pub type AgentId = u32;

/// 原始生存与繁衍行为状态机
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrimitiveActionState {
    RestingAtCamp,      // 🏕️ 营地休息 (恢复体力、饱暖受孕、孕育新生命)
    SeekingWater,       // 🚶 正在赶往水源
    DrinkingAtWater,    // 💧 正在水洼原位痛饮
    SeekingFood,        // 🚶 正在赶往采摘区
    ForagingFood,       // 🍒 正在果丛原位进食
    ReturningToCamp,    // 🏕️ 饱腹/解渴返回营地
    OffRoadDetour,      // ⚠️ 荒野越野寻路中
    Dead,               // 💀 已死亡 (饥荒或脱水致死)
}

/// 3D 动力学 Agent 实体 (统一单位系统：最大 6.0 单位、10秒1单位消耗、60秒流产冷却、90秒孕期)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent3D {
    pub id: AgentId,
    pub state: PrimitiveActionState,
    pub is_alive: bool,

    // 统一生理指标 (0.0 ~ 6.0 单位)
    pub hunger: f32,          // 饱食度 (最大 6.0 单位)
    pub thirst: f32,          // 水分值 (最大 6.0 单位)
    pub stamina: f32,         // 体力值 (0.0 ~ 100.0%)
    pub home_camp_node: NodeId, // 所属归宿营地节点
    pub target_poi_node: Option<NodeId>, // 当前行动目标节点

    // 繁衍孕育系统 (90 秒孕期，流产后 60 秒再次受孕冷却)
    pub is_pregnant: bool,
    pub pregnancy_progress: f32,
    pub ready_to_birth: bool,
    pub miscarriage_alert_timer: f32,
    pub miscarriage_cooldown_timer: f32, // 流产后 60 秒冷却
    pub death_decay_timer: f32,
    pub death_cause: Option<String>,

    // 空间运动与越野参数
    pub current_lane_id: Option<LaneId>,
    pub distance_along_curve: f32,
    pub current_velocity: f32,
    pub max_desired_speed: f32, // 基准公路移速 (16~22 m/s)
    pub is_traveling_offroad: bool, // 是否正在无路荒野越野 (速度为 50%)
    pub route: Vec<LaneId>,
    pub route_index: usize,

    // 隐秘特性
    pub is_covert: bool,
    pub stealth_visibility: f32,

    // 空间状态缓存
    pub world_pos: Vec3,
    pub forward_heading_rad: f32,
    pub pitch_rad: f32,
}

impl Agent3D {
    pub fn new(id: AgentId, home_camp: NodeId, max_speed: f32, is_covert: bool) -> Self {
        let doubled_speed = max_speed * 2.0;
        Self {
            id,
            state: PrimitiveActionState::RestingAtCamp,
            is_alive: true,
            hunger: 5.2 + (id as f32 % 0.7), // 初始 5.2 ~ 5.9 单位 (满值 6.0)
            thirst: 5.2 + (id as f32 % 0.7),
            stamina: 95.0,
            home_camp_node: home_camp,
            target_poi_node: None,
            is_pregnant: false,
            pregnancy_progress: 0.0,
            ready_to_birth: false,
            miscarriage_alert_timer: 0.0,
            miscarriage_cooldown_timer: 0.0,
            death_decay_timer: 12.0,
            death_cause: None,
            current_lane_id: None,
            distance_along_curve: 0.0,
            current_velocity: 0.0,
            max_desired_speed: doubled_speed,
            is_traveling_offroad: false,
            route: Vec::new(),
            route_index: 0,
            is_covert,
            stealth_visibility: if is_covert { 0.25 } else { 1.0 },
            world_pos: Vec3::ZERO,
            forward_heading_rad: 0.0,
            pitch_rad: 0.0,
        }
    }

    /// 核心生命代谢 Tick (10秒消耗1单位，怀孕期消耗+50%即0.15单位/秒，90秒孕期，60秒流产保护冷却)
    pub fn tick_metabolism(&mut self, dt: f32) -> Option<String> {
        if self.miscarriage_alert_timer > 0.0 {
            self.miscarriage_alert_timer = (self.miscarriage_alert_timer - dt).max(0.0);
        }
        if self.miscarriage_cooldown_timer > 0.0 {
            self.miscarriage_cooldown_timer = (self.miscarriage_cooldown_timer - dt).max(0.0);
        }

        if !self.is_alive {
            self.death_decay_timer = (self.death_decay_timer - dt).max(0.0);
            return None;
        }

        let mut event_msg = None;
        let metabolic_multiplier = if self.is_pregnant { 1.5 } else { 1.0 };

        // 统一需求消耗：未怀孕 10秒消耗1单位 (0.1单位/秒)，怀孕期为 0.15单位/秒
        let decay_per_sec = 0.1 * metabolic_multiplier;
        self.hunger = (self.hunger - decay_per_sec * dt).max(0.0);
        self.thirst = (self.thirst - decay_per_sec * dt).max(0.0);

        // 死亡判定 (归 0 即死亡)
        if self.hunger <= 0.0 {
            self.is_alive = false;
            self.state = PrimitiveActionState::Dead;
            self.death_cause = Some("饥荒饿死".to_string());
            self.is_pregnant = false;
            self.death_decay_timer = 12.0;
            return Some(format!("💀 部落民 #{} 因长期饥荒极度营养不良不幸饿死！", self.id));
        }
        if self.thirst <= 0.0 {
            self.is_alive = false;
            self.state = PrimitiveActionState::Dead;
            self.death_cause = Some("脱水渴死".to_string());
            self.is_pregnant = false;
            self.death_decay_timer = 12.0;
            return Some(format!("💀 部落民 #{} 因严重脱水在荒野中渴死！", self.id));
        }

        // 受孕判定 (各指标 >= 80% 即 4.8 单位，且不在流产 60 秒冷却期内)
        if self.state == PrimitiveActionState::RestingAtCamp && !self.is_pregnant && self.miscarriage_cooldown_timer <= 0.0 {
            if self.hunger >= 4.8 && self.thirst >= 4.8 && self.stamina >= 80.0 {
                self.is_pregnant = true;
                self.pregnancy_progress = 0.0;
                event_msg = Some(format!("🤰 部落民 #{} 饱暖康健(≥4.8单位)，成功受孕进入90秒妊娠期 (代谢+50%)！", self.id));
            }
        }

        // 妊娠与流产判定 (孕期 90 秒，跌破 20% 即 1.2 单位触发流产并进入 60 秒冷却)
        if self.is_pregnant {
            if self.hunger < 1.2 || self.thirst < 1.2 || self.stamina < 20.0 {
                self.is_pregnant = false;
                self.pregnancy_progress = 0.0;
                self.miscarriage_alert_timer = 5.0;
                self.miscarriage_cooldown_timer = 60.0; // 流产后 60 秒内禁止再次受孕
                return Some(format!("🥀 痛惜！部落民 #{} 生存指标跌破 20%(<1.2单位)，导致流产 (60秒内休养不可受孕)！", self.id));
            }

            self.pregnancy_progress += dt / 90.0;
            if self.pregnancy_progress >= 1.0 {
                self.is_pregnant = false;
                self.pregnancy_progress = 0.0;
                self.ready_to_birth = true;
                return Some(format!("🍼 喜讯！部落民 #{} 历经90秒漫长孕期，顺利产下一名健康的新生儿！", self.id));
            }
        }

        // 营地休息恢复体力
        if self.state == PrimitiveActionState::RestingAtCamp {
            self.stamina = (self.stamina + 8.0 * dt).min(100.0);
        }

        event_msg
    }

    /// 3D 动力学移动与能耗结算 (无路时按 50% 移速越野，体力消耗减半)
    pub fn tick_movement(&mut self, dt: f32, road_network: &LaneGraph3D) {
        if !self.is_alive {
            self.current_velocity = 0.0;
            return;
        }

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

        // 检查是否为无路越野段 (若是越野土路/直连，速度乘数 0.5)
        let offroad_multiplier = if lane.road_class == crate::spatial::graph::RoadClass::DirtTrack && lane.is_hidden {
            0.5
        } else {
            1.0
        };
        self.is_traveling_offroad = offroad_multiplier < 0.9;

        // 坡度体力能耗
        let delta_z = lane.curve.p3.z - lane.curve.p0.z;
        let uphill_penalty = if delta_z > 0.0 { (delta_z / lane.curve.length).max(0.0) } else { 0.0 };
        let stamina_burn = (0.6 + if self.is_pregnant { 0.3 } else { 0.0 }) * (1.0 + uphill_penalty * 3.5);
        self.stamina = (self.stamina - stamina_burn * dt).max(0.0);

        let stamina_factor = (self.stamina / 25.0).clamp(0.2, 1.0);
        let target_speed = self.max_desired_speed.min(lane.speed_limit) * offroad_multiplier * stamina_factor;

        let accel = (target_speed - self.current_velocity) * 4.0;
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
            self.current_velocity = 0.0;
            self.current_lane_id = None;
            self.is_traveling_offroad = false;
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
