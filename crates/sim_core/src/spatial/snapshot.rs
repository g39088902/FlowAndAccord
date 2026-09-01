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
    /// ★ 家户登记簿快照（家庭跟着男人走：以男性户主为锚的家庭单元与账本）
    pub households: Vec<HouseholdSnapshot>,
    /// ★ 婚姻登记簿快照（一人终生多段婚姻全留痕）
    pub marriages: Vec<MarriageSnapshot>,
    pub total_births: u32,
    pub total_deaths: u32,
    pub total_deaths_natural: u32,
    pub total_deaths_unnatural: u32,
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
    /// 出生时刻的世界 tick 数 (始祖=0, 后代=分娩时的 tick_counter)
    /// 供前端族谱按出生时序排序与施加纵向重力
    pub birth_tick: u64,
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

// ═══════════════════════════════════════════════════════════════
// ★ 账本与家户/婚姻快照 (v0.9.72 M1 账本系统前端展示)
// ═══════════════════════════════════════════════════════════════

/// 单品类账面余额快照（制度账本层，与物理仓库分离）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerBalanceSnapshot {
    /// 资源品类: "Water" / "Food" / "Wood" / "Stone" / "Gold"
    pub resource: String,
    /// 账面数量
    pub amount: f32,
}

/// 家户快照（家庭跟着男人走：以男性户主为锚的家庭单元与账本）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HouseholdSnapshot {
    pub id: u64,
    /// 户主（必为男性）——家户存在即户主存在
    pub head: AgentId,
    /// 成员列表（含户主 + 妻子 + 未成年子女 + 腹中胎儿），按 AgentId 升序
    pub members: Vec<AgentId>,
    /// 账面余额（5种资源的制度账本，与房屋物理仓库分离）
    pub balances: Vec<LedgerBalanceSnapshot>,
    /// 分家来源家户（M2 分家抽资时记录血缘链）
    pub parent_household: Option<u64>,
    /// 家户成立时的世界 tick
    pub founded_tick: u64,
    /// 户主死亡清算后标记解散（流水只读归档）
    pub is_dissolved: bool,
    /// 最近团体事件（家户成立/成员加入/成员离开/领导更替等，最多取最近8条）
    pub recent_events: Vec<String>,
}

/// 婚姻快照（一人终生多段婚姻全留痕，与房屋解耦）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarriageSnapshot {
    pub id: u64,
    pub husband_id: AgentId,
    pub wife_id: AgentId,
    /// 登记时的世界 tick
    pub start_tick: u64,
    /// 封账时刻（None = 存续中）
    pub end_tick: Option<u64>,
    /// 终止事由: "Bereaved"（丧偶）等
    pub end_reason: Option<String>,
    /// 是否存续中
    pub is_active: bool,
}
