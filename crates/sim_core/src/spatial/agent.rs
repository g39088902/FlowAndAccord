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
    RestingAtCamp,      // 🏕️ 营地/家宅休息 (恢复体力、饱暖受孕、消耗家宅储备)
    SeekingWater,       // 🚶 正在赶往水源
    SeekingFood,        // 🍒 正在赶往浆果丛觅食
    DrinkingAtWater,    // 💧 正在水泉边痛饮
    ForagingFood,       // 🍒 正在浆果丛觅食
    SeekingWood,        // 🚶 正在赶往林地伐木
    GatheringWood,      // 🌲 正在林地伐木并补给家宅
    SeekingStone,       // 🚶 正在赶往石矿采石
    MiningStone,        // 🪨 正在石矿采石并补给家宅
    SeekingGold,        // 🚶 正在赶往金矿淘金
    MiningGold,         // 🪙 正在金矿开采黄金(随身无限携带)
    ReturningToCamp,    // 🏕️ 饱腹/解渴/采收返回营地或私宅
    ConstructingHouse,  // 🔨 正在投入工时营建/升级房屋
    RepairingHouse,     // 🔧 正在劳作修缮房屋耐久度
    OffRoadDetour,      // ⚠️ 荒野越野寻路中
    Dead,               // 💀 已死亡 (饥荒或脱水致死)
}

/// 3D 动力学 Agent 实体 (自身满足上限50.0、初始50%=25.0、120秒成年、男女二元性别只有女性可育、120秒孕期)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent3D {
    pub id: AgentId,
    pub gender: Gender, // 性别 (Male / Female)
    pub state: PrimitiveActionState,
    pub is_alive: bool,
    pub age: f32, // 年龄 (秒)，满 120 秒成年才具备生育能力

    // 统一生理指标 (0.0 ~ 50.0 单位，初始 50% 即 25.0 单位)
    pub hunger: f32,          // 饱食度 (最大 50.0 单位)
    pub thirst: f32,          // 水分值 (最大 50.0 单位)
    pub stamina: f32,         // 体力值 (0.0 ~ 100.0%)
    pub carried_gold: f32,    // 随身携带黄金数量 (无限容量，可随身常备或存入家宅升级庄园)
    pub home_camp_node: NodeId, // 所属归宿营地节点 (或房屋门前节点)
    pub target_poi_node: Option<NodeId>, // 当前行动目标节点
    pub home_house_id: Option<u32>,      // 拥有的私产房屋 ID
    pub build_timer: f32,                // 筑屋劳作工时计时器

    // 婚姻与家族血脉传承 (父系/母系、配偶与后代索引)
    pub spouse_id: Option<AgentId>,
    pub mother_id: Option<AgentId>,
    pub father_id: Option<AgentId>,
    pub children_ids: Vec<AgentId>,

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
            hunger: 25.0, // 初始 50% (满值 50.0)
            thirst: 25.0, // 初始 50% (满值 50.0)
            stamina: 95.0,
            carried_gold: 0.0,
            home_camp_node: home_camp,
            target_poi_node: None,
            home_house_id: None,
            build_timer: 0.0,
            spouse_id: None,
            mother_id: None,
            father_id: None,
            children_ids: Vec::new(),
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

    /// 核心生命代谢 Tick (上限50.0单位，房屋激活受孕繁衍)
    pub fn tick_metabolism(&mut self, dt: f32, fertility_active: bool) -> Option<String> {
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
        let mut metabolic_multiplier = if self.is_pregnant { 1.5 } else { 1.0 };

        if self.state == PrimitiveActionState::ConstructingHouse
            || self.state == PrimitiveActionState::RepairingHouse
            || self.state == PrimitiveActionState::GatheringWood
            || self.state == PrimitiveActionState::MiningStone
            || self.state == PrimitiveActionState::MiningGold
        {
            metabolic_multiplier *= 1.25; // 营建、修缮与采矿劳动轻微加速代谢
        }

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

        // 受孕判定 (上限50.0，饱暖≥75%即37.5单位，且房屋有生育支持：非0级、未成废墟、水粮木均≥10，即is_fertility_active)
        if self.gender == Gender::Female && self.spouse_id.is_some() && fertility_active && self.state == PrimitiveActionState::RestingAtCamp && !self.is_pregnant && self.miscarriage_cooldown_timer <= 0.0 {
            if self.age >= 120.0 && self.hunger >= 37.5 && self.thirst >= 37.5 && self.stamina >= 75.0 {
                self.is_pregnant = true;
                self.pregnancy_progress = 0.0;
                let spouse_str = self.spouse_id.map(|s| format!("与丈夫 #{} 结发", s)).unwrap_or_default();
                event_msg = Some(format!("🤰 女性部落民 #{} ({}) 在私宅中饱暖充盈(≥37.5单位)，成功受孕进入120秒妊娠期！", self.id, spouse_str));
            }
        }

        // 妊娠与流产判定 (孕期 120 秒；统一基准流产底线 25%=7.5单位)
        if self.is_pregnant {
            let miscarry_threshold = 7.5;
            if self.hunger < miscarry_threshold || self.thirst < miscarry_threshold || self.stamina < 20.0 {
                self.is_pregnant = false;
                self.pregnancy_progress = 0.0;
                self.miscarriage_alert_timer = 5.0;
                self.miscarriage_cooldown_timer = 60.0; // 流产后 60 秒内禁止再次受孕
                return Some(format!("🥀 痛惜！女性部落民 #{} 生存指标跌破安全线(<{:.2}单位)，导致流产 (60秒内休养不可受孕)！", self.id, miscarry_threshold));
            }

            self.pregnancy_progress += dt / 120.0; // 孕期 120 秒
            if self.pregnancy_progress >= 1.0 {
                self.is_pregnant = false;
                self.pregnancy_progress = 0.0;
                self.ready_to_birth = true;
                return Some(format!("🍼 喜讯！女性部落民 #{} 历经120秒漫长孕期，顺利产下一名健康的新生儿！", self.id));
            }
        }

        // 休息、筑屋与修缮体力结算
        if self.state == PrimitiveActionState::RestingAtCamp {
            let recovery_rate = 8.0;
            self.stamina = (self.stamina + recovery_rate * dt).min(100.0);
        } else if self.state == PrimitiveActionState::ConstructingHouse {
            self.stamina = (self.stamina - 3.5 * dt).max(5.0);
        } else if self.state == PrimitiveActionState::RepairingHouse {
            self.stamina = (self.stamina - 2.5 * dt).max(5.0); // 修缮劳作消耗体力
        } else if self.state == PrimitiveActionState::GatheringWood || self.state == PrimitiveActionState::MiningStone {
            self.stamina = (self.stamina - 2.0 * dt).max(5.0); // 伐木采石消耗体力
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
                | PrimitiveActionState::SeekingWood
                | PrimitiveActionState::SeekingStone
                | PrimitiveActionState::SeekingGold
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

        let lane = &road_network.graph[edge_idx];
        let wear = lane.wear;

        // 连续浮点道路速度因子：0.0 (荒野 50%) -> 1.0 (土径 83%) -> 2.0 (夯土 117%) -> 3.0 (石道 150%) -> 4.0 (石板 183%) -> 5.0 (极品大道 217%)
        let road_level_factor = (0.50 + 0.333 * wear).clamp(0.50, 2.20);
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
            // 踩踏拓路：按步行次数增加 (每次通行 +0.05，上限 5.0)，双向往返共同加固
            {
                let edge = &mut road_network.graph[edge_idx];
                let new_wear = (edge.wear + 0.05).min(5.0);
                edge.wear = new_wear;
                if let Some(rev_idx) = rev_edge_idx {
                    road_network.graph[rev_idx].wear = new_wear;
                }
            }
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
                PrimitiveActionState::SeekingWood => {
                    self.state = PrimitiveActionState::GatheringWood;
                }
                PrimitiveActionState::SeekingStone => {
                    self.state = PrimitiveActionState::MiningStone;
                }
                PrimitiveActionState::SeekingGold => {
                    self.state = PrimitiveActionState::MiningGold;
                }
                PrimitiveActionState::ReturningToCamp => {
                    self.state = PrimitiveActionState::RestingAtCamp;
                }
                _ => {}
            }
        }
    }
}
