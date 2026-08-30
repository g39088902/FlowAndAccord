use serde::{Deserialize, Serialize};
use super::vec3::Vec3;
use super::graph::{LaneId, NodeId};
use super::agent::AgentId;
use super::poi::PoiId;
use super::house::HouseSnapshot;

/// 四季系统 (240秒完整年轮，每季60秒)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Season {
    Spring, // 🌸 春季 (温和 15°C ~ 25°C)
    Summer, // ☀️ 夏季 (炎热 25°C ~ 35°C)
    Autumn, // 🍂 秋季 (凉爽 10°C ~ 18°C)
    Winter, // ❄️ 冬季 (严寒 -10°C ~ 2°C，房屋消耗木头取暖)
}

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
    pub houses: Vec<HouseSnapshot>,
    pub nodes: Vec<NodeSnapshot>,
    pub lanes: Vec<LaneSnapshot>,
    pub agents: Vec<AgentSnapshot>,
    pub total_births: u32,
    pub total_deaths: u32,
    pub total_miscarriages: u32,
    pub season: String,
    pub temperature: f32,
    pub season_progress: f32,
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
    pub regen_rate: f32,
    pub name: String,
    pub camp_title: String,
    pub level: u8,
    pub bound_houses: u32,
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
    pub wear: f32, // 踩踏等级连续浮点数 (0.0 ~ 5.0)
    pub is_hidden: bool,
    pub concealment: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSnapshot {
    pub id: AgentId,
    pub gender: String, // "Female" / "Male"
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub age: f32, // 年龄 (秒)
    pub heading_rad: f32,
    pub pitch_rad: f32,
    pub velocity: f32,
    pub carried_water: f32,
    pub carried_food: f32,
    pub carried_wood: f32,
    pub carried_stone: f32,
    pub carried_gold: f32,
    pub build_timer: f32,
    pub miscarriage_alert_timer: f32,
    pub state: String,
    pub is_alive: bool,
    pub hunger: f32, // 0.0 ~ 25.0 单位
    pub thirst: f32, // 0.0 ~ 25.0 单位
    pub stamina: f32,
    pub health: f32, // 健康需求值
    pub max_health: f32, // 健康上限/寿命基准
    pub is_pregnant: bool,
    pub pregnancy_progress: f32,
    pub miscarriage_cooldown: f32,
    pub is_offroad: bool,
    pub miscarriage_alert: bool,
    pub death_decay_timer: f32,
    pub death_cause: Option<String>,
    pub current_need: Option<String>, // 马斯洛需求标签
    pub is_covert: bool,
    pub stealth_visibility: f32,
    pub home_house_id: Option<u32>,
    pub generation: u32,
    pub spouse_id: Option<AgentId>,
    pub mother_id: Option<AgentId>,
    pub father_id: Option<AgentId>,
    pub children_ids: Vec<AgentId>,
    // 先天禀赋属性: 始祖 N(100,20) 正态分布 / 后代父母均值±10×线性随机数
    pub intelligence: f32,
    pub strength: f32,
    pub digestion_efficiency: f32,
    pub libido: f32,
    pub sleep_efficiency: f32,
    pub life_expectancy: f32,
    // 姓氏宗族与声望
    pub surname: String,   // 姓氏 (始祖随机赋予，后代父系继承)
    pub prestige: u32,     // 声望值 (当前 = 子女数量，未来可叠加多项)
}