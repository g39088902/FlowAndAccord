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
    /// ★ 宗族登记簿快照（M3：按姓氏聚合的宗族团体与账本）
    pub clans: Vec<ClanSnapshot>,
    /// ★ 地区与王国快照（M4：按营地聚合的地区团体、国王、公仓与继承顺位）
    pub regions: Vec<RegionSnapshot>,
    /// ★ 公仓兜底账本余额（M2 绝嗣家户资产归集，预留 M4 Region 对接）
    pub public_granary_balances: Vec<LedgerBalanceSnapshot>,
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
    /// ★ M1.7 腹中胎儿预分配 ID（母亲卡片按钮跳转胎儿卡片用）
    pub pregnancy_child_id: Option<AgentId>,
    /// ★ M1.7 腹中胎儿标记（已获 agent 身份，但无地图实体、跳过决策/代谢/行动）
    pub is_fetus: bool,
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
    // ★ 婚姻与家户归属（M2 新增）
    /// 该 agent 的历史婚姻段数（含已封账各段）
    pub marriage_history_count: u32,
    /// 当前所属家户 ID（None = 无家户归属）
    pub household_id: Option<u64>,
    /// 在家户中的角色: "Head" / "Spouse" / "Child" / "None"
    pub household_role: String,
    /// ★ M4 到达该地区的时刻 tick（始祖=0；新生儿=出生时 tick_counter）
    pub arrival_tick: u64,
    /// ★ M4 是否在夺位远征中（state=SeekingThrone）
    pub is_on_expedition: bool,
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

/// 单笔资源流水快照（字符串化形式，供前端展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRecordSnapshot {
    /// 流水发生时的世界 tick
    pub tick: u64,
    /// 资源品类: "Water" / "Food" / "Wood" / "Stone" / "Gold"
    pub resource: String,
    /// 数量
    pub amount: f32,
    /// 付出方主体（字符串化）
    pub from: String,
    /// 接收方主体（字符串化）
    pub to: String,
    /// 事由: "Deposit" / "Consume" / "Heating" / "Construction" / "Maintenance" / "Inheritance" / "Split" 等
    pub reason: String,
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
    /// 最近8笔资源流水（从新到旧）
    pub recent_journal: Vec<TransferRecordSnapshot>,
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

/// 宗族快照（M3：按姓氏聚合的宗族团体与账本）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClanSnapshot {
    /// 姓氏（宗族唯一标识）
    pub surname: String,
    /// 族长 AgentId（None = 无主，账本冻结）
    pub leader_id: Option<AgentId>,
    /// 族人数量
    pub member_count: u32,
    /// 族人 AgentId 列表（按升序）
    pub member_ids: Vec<AgentId>,
    /// 族库账面余额（5种资源）
    pub balances: Vec<LedgerBalanceSnapshot>,
    /// 最近资源流水（从新到旧，最多8笔）
    pub recent_journal: Vec<TransferRecordSnapshot>,
    /// 最近团体事件（成员进出/族长更替等，最多8条）
    pub recent_events: Vec<String>,
}

/// 地区与王国快照（M4：按营地聚合的地区团体、国王、公仓与继承顺位）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionSnapshot {
    /// 营地 ID（1-5）
    pub camp_id: u32,
    /// 营地名称（如"桃源营地"）
    pub camp_name: String,
    /// 国王 AgentId（None = 王位空悬，账本冻结）
    pub king_id: Option<AgentId>,
    /// 政体: "Kingdom"
    pub regime: String,
    /// 继承制: "Primogeniture"
    pub succession: String,
    /// 地区居民数量
    pub member_count: u32,
    /// 到达时序前10（按 (arrival_tick, agent_id) 升序）
    pub arrival_order: Vec<AgentId>,
    /// 顺位前3继承人（长子继承制下的候选）
    pub heir_candidates: Vec<AgentId>,
    /// 地区公仓账面余额（5种资源）
    pub balances: Vec<LedgerBalanceSnapshot>,
    /// 最近资源流水（从新到旧，最多8笔）
    pub recent_journal: Vec<TransferRecordSnapshot>,
    /// 最近团体事件（国王登基/继承/成员进出等，最多8条）
    pub recent_events: Vec<String>,
    /// 正在冲向该营地夺位的族人列表
    pub active_expedition_agents: Vec<AgentId>,
}
