use serde::{Deserialize, Serialize};
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, LaneId, NodeId};

pub type AgentId = u32;

/// 原始生存与繁衍行为状态机
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrimitiveActionState {
    RestingAtCamp,      // 🏕️ 营地休息 (恢复体力、吃浆果、孕育新生命)
    SeekingWater,       // 🚶 正在赶往水源
    DrinkingAtWater,    // 💧 正在水坑饮水
    SeekingFood,        // 🚶 正在赶往采摘区
    ForagingFood,       // 🍒 正在采摘浆果
    ReturningToCamp,    // 🏕️ 负重/疲惫返回营地
    OffRoadDetour,      // ⚠️ 寻路脱困中
    Dead,               // 💀 已死亡 (饥荒或脱水致死)
}

/// 3D 动力学 Agent 实体 (具备移动提速、归零死亡、受孕怀胎与流产/生育机制)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent3D {
    pub id: AgentId,
    pub state: PrimitiveActionState,
    pub is_alive: bool,

    // 生理稳态指标 (0.0 ~ 100.0)
    pub hunger: f32,          // 饱食度
    pub thirst: f32,          // 水分值
    pub stamina: f32,         // 体力值
    pub inventory_food: f32,  // 携带的野果数量 (0.0 ~ 4.0)
    pub home_camp_node: NodeId, // 所属归宿营地节点
    pub target_poi_node: Option<NodeId>, // 当前行动目标节点

    // 繁衍孕育系统 (Pregnancy Lifecycle)
    pub is_pregnant: bool,        // 是否怀孕
    pub pregnancy_progress: f32,  // 孕育进度 0.0 ~ 1.0 (约需 18 秒)
    pub ready_to_birth: bool,     // 是否临盆待产 (准备生成新生儿)
    pub death_cause: Option<String>,

    // 空间运动参数 (标准移速翻倍至 16~22 m/s)
    pub current_lane_id: Option<LaneId>,
    pub distance_along_curve: f32,
    pub current_velocity: f32,
    pub max_desired_speed: f32,
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
        // 移速翻倍 (基准 16.0 ~ 22.0 m/s)
        let doubled_speed = max_speed * 2.0;
        Self {
            id,
            state: PrimitiveActionState::RestingAtCamp,
            is_alive: true,
            hunger: 85.0 + (id as f32 % 15.0),
            thirst: 85.0 + (id as f32 % 15.0),
            stamina: 95.0,
            inventory_food: 1.5,
            home_camp_node: home_camp,
            target_poi_node: None,
            is_pregnant: false,
            pregnancy_progress: 0.0,
            ready_to_birth: false,
            death_cause: None,
            current_lane_id: None,
            distance_along_curve: 0.0,
            current_velocity: 0.0,
            max_desired_speed: doubled_speed,
            route: Vec::new(),
            route_index: 0,
            is_covert,
            stealth_visibility: if is_covert { 0.25 } else { 1.0 },
            world_pos: Vec3::ZERO,
            forward_heading_rad: 0.0,
            pitch_rad: 0.0,
        }
    }

    /// 核心生命代谢与受孕繁衍 Tick
    pub fn tick_metabolism(&mut self, dt: f32) -> Option<String> {
        if !self.is_alive {
            return None;
        }

        let mut event_msg = None;

        // 1. 怀孕代谢压力倍率 (怀孕期间需求消耗速率增长 50%，即 1.5x)
        let metabolic_multiplier = if self.is_pregnant { 1.5 } else { 1.0 };

        // 基础代谢衰减
        self.hunger = (self.hunger - 0.45 * metabolic_multiplier * dt).max(0.0);
        self.thirst = (self.thirst - 0.85 * metabolic_multiplier * dt).max(0.0);

        // 2. 死亡判定规则：任意需求指标归零即告死亡
        if self.hunger <= 0.0 {
            self.is_alive = false;
            self.state = PrimitiveActionState::Dead;
            self.death_cause = Some("饥荒饿死".to_string());
            self.is_pregnant = false;
            return Some(format!("💀 部落民 #{} 因长期饥荒极度营养不良不幸饿死！", self.id));
        }
        if self.thirst <= 0.0 {
            self.is_alive = false;
            self.state = PrimitiveActionState::Dead;
            self.death_cause = Some("脱水渴死".to_string());
            self.is_pregnant = false;
            return Some(format!("💀 部落民 #{} 因严重脱水在荒野中渴死！", self.id));
        }

        // 3. 受孕机制：在营地休息且所有需求均达到 80%+ 时进入怀孕
        if self.state == PrimitiveActionState::RestingAtCamp && !self.is_pregnant {
            if self.hunger >= 80.0 && self.thirst >= 80.0 && self.stamina >= 80.0 {
                self.is_pregnant = true;
                self.pregnancy_progress = 0.0;
                event_msg = Some(format!("🤰 部落民 #{} 饱暖康健，成功受孕进入妊娠期 (代谢消耗 +50%)！", self.id));
            }
        }

        // 4. 妊娠期孕育与流产监控
        if self.is_pregnant {
            // 流产判定：若任何一条需求跌破 20%，发生流产！
            if self.hunger < 20.0 || self.thirst < 20.0 || self.stamina < 20.0 {
                self.is_pregnant = false;
                self.pregnancy_progress = 0.0;
                return Some(format!("🥀 痛惜！部落民 #{} 生存指标跌破 20% 安全线，体力虚脱导致流产！", self.id));
            }

            // 孕育进度推进 (18秒完成全孕期)
            self.pregnancy_progress += dt / 18.0;
            if self.pregnancy_progress >= 1.0 {
                self.is_pregnant = false;
                self.pregnancy_progress = 0.0;
                self.ready_to_birth = true; // 触发分娩新生儿
                return Some(format!("🍼 喜讯！部落民 #{} 历经艰辛顺利产下一名健康的部落新生儿！", self.id));
            }
        }

        // 5. 营地休养状态下的行为收益
        match self.state {
            PrimitiveActionState::RestingAtCamp => {
                self.stamina = (self.stamina + 8.0 * dt).min(100.0);
                if self.hunger < 75.0 && self.inventory_food > 0.1 {
                    let eat = (1.5 * dt).min(self.inventory_food);
                    self.inventory_food -= eat;
                    self.hunger = (self.hunger + eat * 25.0).min(100.0);
                }
            }
            _ => {}
        }

        event_msg
    }

    /// 3D 动力学移动与坡度能耗结算 (翻倍移速)
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

        // 坡度能耗
        let delta_z = lane.curve.p3.z - lane.curve.p0.z;
        let uphill_penalty = if delta_z > 0.0 { (delta_z / lane.curve.length).max(0.0) } else { 0.0 };

        let stamina_burn = (1.2 + if self.is_pregnant { 0.6 } else { 0.0 }) * (1.0 + uphill_penalty * 3.5);
        self.stamina = (self.stamina - stamina_burn * dt).max(0.0);

        // 体力归零时极度迟缓但不会立即暴毙 (直到饿死或渴死)
        let stamina_factor = (self.stamina / 25.0).clamp(0.2, 1.0);
        let target_speed = self.max_desired_speed.min(lane.speed_limit) * stamina_factor;

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
