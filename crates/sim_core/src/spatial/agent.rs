use serde::{Deserialize, Serialize};
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, LaneId, NodeId};

pub type AgentId = u32;

/// 性别系统
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Gender {
    Male,   // ♂ 男性
    Female, // ♀ 女性 (只有女性能受孕与分娩)
}

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

/// 3D 动力学 Agent 实体 (自身满足上限20.0、初始50%=10.0、120秒成年、男女二元性别只有女性可育、120秒孕期)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent3D {
    pub id: AgentId,
    pub gender: Gender, // 性别 (Male / Female)
    pub state: PrimitiveActionState,
    pub is_alive: bool,
    pub age: f32, // 年龄 (秒)，满 120 秒成年才具备生育能力

    // 统一生理指标 (0.0 ~ 20.0 单位，初始 50% 即 10.0 单位)
    pub hunger: f32,          // 饱食度 (最大 20.0 单位)
    pub thirst: f32,          // 水分值 (最大 20.0 单位)
    pub stamina: f32,         // 体力值 (0.0 ~ 100.0%)
    pub home_camp_node: NodeId, // 所属归宿营地节点
    pub target_poi_node: Option<NodeId>, // 当前行动目标节点

    // 繁衍孕育系统 (120 秒孕期，流产后 60 秒再次受孕冷却，年满 120 秒成年女性可育)
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
    pub max_desired_speed: f32, // 基准公路移速
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
    pub fn new(id: AgentId, home_camp: NodeId, max_speed: f32, is_covert: bool, initial_age: f32, gender: Gender) -> Self {
        let quadrupled_speed = max_speed * 4.0;
        Self {
            id,
            gender,
            state: PrimitiveActionState::RestingAtCamp,
            is_alive: true,
            age: initial_age,
            hunger: 10.0, // 初始 50% (满值 20.0)
            thirst: 10.0, // 初始 50% (满值 20.0)
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
            max_desired_speed: quadrupled_speed,
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

    /// 核心生命代谢 Tick (10秒消耗1单位，只有女性年满120秒成年才能受孕，孕期120秒，代谢+50%)
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

        // 年龄增长
        self.age += dt;

        let mut event_msg = None;
        let metabolic_multiplier = if self.is_pregnant { 1.5 } else { 1.0 };

        // 统一需求消耗：未怀孕 10秒消耗1单位 (0.10单位/秒)，怀孕期为 0.15单位/秒
        let decay_per_sec = 0.10 * metabolic_multiplier;
        self.hunger = (self.hunger - decay_per_sec * dt).max(0.0);
        self.thirst = (self.thirst - decay_per_sec * dt).max(0.0);

        // 死亡判定 (归 0 即死亡)
        if self.hunger <= 0.0 {
            self.is_alive = false;
            self.state = PrimitiveActionState::Dead;
            self.death_cause = Some("饥荒饿死".to_string());
            self.is_pregnant = false;
            self.death_decay_timer = 12.0;
            return Some(format!("💀 部落民 #{} 因长期饥荒不幸饿死！", self.id));
        }
        if self.thirst <= 0.0 {
            self.is_alive = false;
            self.state = PrimitiveActionState::Dead;
            self.death_cause = Some("脱水渴死".to_string());
            self.is_pregnant = false;
            self.death_decay_timer = 12.0;
            return Some(format!("💀 部落民 #{} 因严重脱水在荒野中渴死！", self.id));
        }

        // 受孕判定 (必须为女性 ♀、年满 120 秒成年、各指标 >= 80% 即 16.0 单位，且不在流产 60 秒冷却期内)
        if self.gender == Gender::Female && self.state == PrimitiveActionState::RestingAtCamp && !self.is_pregnant && self.miscarriage_cooldown_timer <= 0.0 {
            if self.age >= 120.0 && self.hunger >= 16.0 && self.thirst >= 16.0 && self.stamina >= 80.0 {
                self.is_pregnant = true;
                self.pregnancy_progress = 0.0;
                event_msg = Some(format!("🤰 女性部落民 #{} (年龄 {}s 已成年) 饱暖康健(≥16.0单位)，成功受孕进入120秒妊娠期 (代谢+50%)！", self.id, self.age.floor()));
            }
        }

        // 妊娠与流产判定 (孕期 120 秒，跌破 20% 即 4.0 单位触发流产并进入 60 秒冷却)
        if self.is_pregnant {
            if self.hunger < 4.0 || self.thirst < 4.0 || self.stamina < 20.0 {
                self.is_pregnant = false;
                self.pregnancy_progress = 0.0;
                self.miscarriage_alert_timer = 5.0;
                self.miscarriage_cooldown_timer = 60.0; // 流产后 60 秒内禁止再次受孕
                return Some(format!("🥀 痛惜！女性部落民 #{} 生存指标跌破 20%(<4.0单位)，导致流产 (60秒内休养不可受孕)！", self.id));
            }

            self.pregnancy_progress += dt / 120.0; // 孕期 120 秒
            if self.pregnancy_progress >= 1.0 {
                self.is_pregnant = false;
                self.pregnancy_progress = 0.0;
                self.ready_to_birth = true;
                return Some(format!("🍼 喜讯！女性部落民 #{} 历经120秒漫长孕期，顺利产下一名健康的新生儿！", self.id));
            }
        }

        // 营地休息恢复体力
        if self.state == PrimitiveActionState::RestingAtCamp {
            self.stamina = (self.stamina + 8.0 * dt).min(100.0);
        }

        event_msg
    }

    /// 3D 动力学移动与踩踏拓路 (走的人多了踩踏等级提升，移动速度连续浮点加快)
    pub fn tick_movement(&mut self, dt: f32, road_network: &mut LaneGraph3D) {
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
        let Some(edge_idx) = road_network.edge_map.get(&lane_id).copied() else {
            self.state = PrimitiveActionState::OffRoadDetour;
            return;
        };

        let from_node = road_network.graph[edge_idx].from_node;
        let to_node = road_network.graph[edge_idx].to_node;
        let from_idx = road_network.node_map[&from_node];
        let to_idx = road_network.node_map[&to_node];
        let rev_edge_idx = road_network.graph.find_edge(to_idx, from_idx);

        // 踩踏拓路：按人数实时累加 (1级20s、2级40s、3级80s)，双向往返共同加固
        {
            let edge = &mut road_network.graph[edge_idx];
            let gain_rate = if edge.wear < 2.0 { 0.050 } else { 0.025 };
            let new_wear = (edge.wear + gain_rate * dt).min(3.0);
            edge.wear = new_wear;
            if let Some(rev_idx) = rev_edge_idx {
                road_network.graph[rev_idx].wear = new_wear;
            }
        }

        let lane = &road_network.graph[edge_idx];
        let wear = lane.wear;

        // 连续浮点道路速度因子：0.0 (荒野 50%) -> 1.0 (20s土径 83%) -> 2.0 (40s夯土 117%) -> 3.0 (80s石道 150%)
        let road_level_factor = (0.50 + 0.333 * wear).clamp(0.50, 1.50);
        self.is_traveling_offroad = wear < 0.6;

        // 坡度体力能耗
        let delta_z = lane.curve.p3.z - lane.curve.p0.z;
        let uphill_penalty = if delta_z > 0.0 { (delta_z / lane.curve.length).max(0.0) } else { 0.0 };
        let stamina_burn = (0.6 + if self.is_pregnant { 0.3 } else { 0.0 }) * (1.0 + uphill_penalty * 3.5);
        self.stamina = (self.stamina - stamina_burn * dt).max(0.0);

        let stamina_factor = (self.stamina / 25.0).clamp(0.2, 1.0);
        let target_speed = self.max_desired_speed * road_level_factor * stamina_factor;

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
