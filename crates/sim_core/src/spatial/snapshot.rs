use super::agent::AgentId;
use super::decisions::branches::BranchId;
use super::decisions::intent::{CompletionPolicy, IntentKind};
use super::decisions::primitive::{ActionPrimitive, HoldKind};
use super::decisions::strategy::{ActiveTask, ExecutionStrategy, ResidenceTarget};
use super::graph::{LaneId, NodeId};
pub use super::house::{
    HouseAuctionHistorySnapshot, HouseBidSnapshot, HouseDealSnapshot, HouseSnapshot,
};
use super::poi::PoiId;
use super::vec3::Vec3;
use serde::{Deserialize, Serialize};

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
    #[serde(default)]
    pub terrain_features: Vec<TerrainFeatureSnapshot>,
    #[serde(default)]
    pub terrain_accents: Vec<TerrainAccentSnapshot>,
    #[serde(default)]
    pub terrain_generator_version: u32,
    #[serde(default)]
    pub terrain_profile: String,
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
    /// ★ 帝国/联邦上层政体快照（M5；当前仅实现帝国）
    #[serde(default)]
    pub empires: Vec<EmpireSnapshot>,
    /// ★ 公仓兜底账本余额（M2 绝嗣家户资产归集，预留 M4 Region 对接）
    pub public_granary_balances: Vec<LedgerBalanceSnapshot>,
    pub total_births: u32,
    pub total_deaths: u32,
    pub total_deaths_natural: u32,
    pub total_deaths_unnatural: u32,
    pub total_miscarriages: u32,
    /// ★ 历史累计创建家户总数（含已解散；快照 households 仅导出存续活跃家户）
    #[serde(default)]
    pub total_households: u64,
    #[serde(default)]
    pub auction_started: u64,
    #[serde(default)]
    pub auction_sold: u64,
    #[serde(default)]
    pub auction_flopped: u64,
    /// ★ v1.35.2 全局所有国王累计收到的内帑总额（黄金）
    #[serde(default)]
    pub total_royal_privy: f32,
    /// ★ M5 全图所有皇帝累计收到的帝国公帑总额（黄金）
    #[serde(default)]
    pub total_imperial_privy: f32,
    /// ★ 房屋报价中心历史受理记录 (256 size 环形缓冲区快照)
    #[serde(default)]
    pub auction_history: Vec<HouseAuctionHistorySnapshot>,
    pub season: String,
    pub temperature: f32,
    pub season_progress: f32,
    pub last_mutation_event: Option<String>,
    /// ★ v1.8.7 死亡/流产墓碑（滑动窗口保留，含本帧死亡与腹中胎儿流产/随母亡故）。
    /// 供前端即使在高倍速单帧跨过整个衰减窗口时，也能强制把档案库对应条目补记为已故并保留死因。
    pub recent_deaths: Vec<RecentDeathSnapshot>,
    /// ★ v1.22.6 生态大盘产速倍率（内核唯一真相源，随存档持久化）。
    /// 前端两处消费方共用同一数值，保证「生态大盘设置」与「POI 卡片显示」一致：
    /// - POI 卡片「产出速率」= 快照 `regen_rate`（基准值）× 本组对应倍率；
    /// - 生态大盘滑块位置与标签由本组数值回写（读档/重置后自动同步）。
    /// ⚠ 榷场特例：粮食再生复用**浆果槽位**（见 `world_tick.rs`），内核无独立粮食倍率。
    #[serde(default = "default_regen_multiplier")]
    pub water_regen_multiplier: f32,
    #[serde(default = "default_regen_multiplier")]
    pub berry_regen_multiplier: f32,
    #[serde(default = "default_regen_multiplier")]
    pub wood_regen_multiplier: f32,
    #[serde(default = "default_regen_multiplier")]
    pub stone_regen_multiplier: f32,
    #[serde(default = "default_regen_multiplier")]
    pub gold_regen_multiplier: f32,
    /// ★ 气候演化内部时钟 (游戏小时，供前端外推预测未来气温折线)
    #[serde(default)]
    pub season_timer: f32,
    /// ★ 厄尔尼诺周期初始随机相位
    #[serde(default)]
    pub el_nino_phase: f32,
    /// ★ 纪元候波大周期初始随机相位 (49年长周期)
    #[serde(default)]
    pub climate_epoch_phase: f32,
}

/// 产速倍率的 serde 默认值：1.0（未注入倍率时等同基准产速）
fn default_regen_multiplier() -> f32 {
    1.0
}

/// 死亡/流产墓碑记录（v1.8.7）
///
/// 每次 tick 内发生的**死亡**（饥荒饿死/脱水渴死/寿终正寝）与**腹中胎儿夭折**
/// （流产 / 随母亡故）都会记入本结构，随快照输出。前端据此：
/// - 对档案库中"滞留存活"的陈旧副本强制补记 `isAlive=false` 并写入死因；
/// - 将流产/随母亡故的胎儿以"已故子嗣"身份写入档案库（族谱可见）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentDeathSnapshot {
    /// 死者 AgentId（含腹中胎儿预分配 id）
    pub id: AgentId,
    /// 死亡原因："饥荒饿死" / "脱水渴死" / "寿终正寝" / "流产" / "随母亡故"
    pub cause: String,
    /// 是否自然死亡（寿终正寝=true；饥荒/脱水/流产等=false）
    pub is_natural: bool,
    /// 是否腹中胎儿（流产/随母亡故的胎儿=true）
    pub is_fetus: bool,
    /// 死者生父 AgentId（胎儿/成年人均携带，供前端族谱入档时保血缘）
    pub father_id: Option<AgentId>,
    /// 死者生母 AgentId（胎儿/成年人均携带，供前端族谱入档时保血缘）
    pub mother_id: Option<AgentId>,
    /// 死亡发生的世界 tick（供前端去重与族谱时间轴）
    pub tick: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoCellSnapshot {
    pub elevation: f32,
    pub slope_angle: f32,
    #[serde(default)]
    pub surface_kind: String,
    #[serde(default)]
    pub natural_fertility: f32,
    #[serde(default)]
    pub water_body_id: Option<u32>,
    #[serde(default)]
    pub feature_flags: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainFeatureSnapshot {
    pub id: u32,
    pub kind: String,
    pub vertices: Vec<Vec3>,
    pub elevation: f32,
    pub width: f32,
    pub flags: u16,
}

/// ★ v1.48.0 D-A：地表装饰快照（纯视觉要素，约 24B/个）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainAccentSnapshot {
    pub id: u32,
    pub kind: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub scale: f32,
    pub rotation: f32,
    pub tint: u8,
}

/// ★ v1.10.0 空置房屋快照条目（营地空置房屋列表：房屋 ID + 受益人 ID 列表）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VacantHouseSnapshot {
    pub house_id: u32,
    pub beneficiary_ids: Vec<AgentId>,
}

/// ★ v1.28.0 榷场单笔成交流水快照（供前端「🔄 交易流水」面板展示，与内核 `MarketTradeRecord` 一一对应）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketTradeSnapshot {
    /// 成交时的世界 tick
    pub tick: u64,
    /// 采购人 AgentId
    pub agent_id: AgentId,
    /// 采购人家户 ID（无家户时为 null）
    pub household_id: Option<u64>,
    /// 资源品类: "Water" / "Food"
    pub resource: String,
    /// 成交数量
    pub amount: f32,
    /// 成交单价（金/单位）
    pub unit_price: f32,
    /// 本次支出黄金总额
    pub gold_cost: f32,
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
    #[serde(default)]
    pub secondary_stock: f32,
    #[serde(default)]
    pub secondary_max_stock: f32,
    #[serde(default)]
    pub secondary_regen_rate: f32,
    #[serde(default)]
    pub tertiary_stock: f32,
    #[serde(default)]
    pub tertiary_max_stock: f32,
    #[serde(default)]
    pub tertiary_regen_rate: f32,
    #[serde(default)]
    pub water_price: f32,
    #[serde(default)]
    pub food_price: f32,
    #[serde(default)]
    pub wood_price: f32,
    #[serde(default)]
    pub cumulative_sold_water: f32,
    #[serde(default)]
    pub cumulative_sold_food: f32,
    #[serde(default)]
    pub cumulative_sold_wood: f32,
    #[serde(default)]
    pub cumulative_revenue: f32,
    pub name: String,
    pub camp_title: String,
    pub level: u8,
    pub bound_houses: u32,
    /// ★ v1.10.0 空置房屋列表（仅营地有意义）
    pub vacant_houses: Vec<VacantHouseSnapshot>,
    /// ★ v1.28.0 榷场交易流水（仅 Market 有内容，从新到旧最多 8 条）
    #[serde(default)]
    pub market_trades: Vec<MarketTradeSnapshot>,
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
    pub wear: f32, // 踩踏等级连续浮点数 (0.0 ~ 10.0，>5.0 为溢出耐久缓冲)
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
    /// ★ v1.26.3 累计开采资源量（单位）：本 agent 一生从资源点装载入随身行囊的累计总量
    /// （水/粮/木/石/金五类合计；市场购买与就地自饮自食不计入）。调试模式前端展示用。
    pub cumulative_mined: f32,
    /// ★ v1.26.3 累计开采资源量 · 分品种（水/粮/木/石/金），合计字段的明细拆分。
    pub cumulative_mined_water: f32,
    pub cumulative_mined_food: f32,
    pub cumulative_mined_wood: f32,
    pub cumulative_mined_stone: f32,
    pub cumulative_mined_gold: f32,
    /// ★ v1.35.2 累计收到的内帑总额（黄金）：本 agent 一生作为国王从地区公仓领取的内帑累计总量
    pub cumulative_royal_privy: f32,
    /// ★ M5 累计收到的帝国公帑总额（黄金）：本 agent 一生作为皇帝从下属王国公仓领取的累计总量
    #[serde(default)]
    pub cumulative_imperial_privy: f32,
    pub build_timer: f32,
    pub miscarriage_alert_timer: f32,
    pub state: String,
    pub is_alive: bool,
    pub hunger: f32, // 0.0 ~ 25.0 单位
    pub thirst: f32, // 0.0 ~ 25.0 单位
    pub stamina: f32,
    pub health: f32,     // 健康需求值
    pub max_health: f32, // 健康上限/寿命基准
    pub is_pregnant: bool,
    pub pregnancy_progress: f32,
    /// ★ M1.7 腹中胎儿预分配 ID（母亲卡片按钮跳转胎儿卡片用）
    pub pregnancy_child_id: Option<AgentId>,
    /// ★ M1.7 腹中胎儿标记（已获 agent 身份，但无地图实体、跳过决策/代谢/行动）
    pub is_fetus: bool,
    pub miscarriage_cooldown: f32,
    pub postpartum_cooldown: f32,
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
    // 姓氏宗族与威望
    pub surname: String, // 姓氏 (始祖随机赋予，后代父系继承)
    /// ★ M6 威望持久综合分值（所有影响因子集合体）：当前因子 = 子嗣活产 +1、宅邸每级 +1；
    /// 子女日后死亡不回减；随 agent 终身、不随房屋/家户转移（非"宗族声望"）
    pub prestige: u32,
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
    /// ★ v1.9.0 M4 远征目标营地（决策器选定写入）
    pub expedition_target_camp: Option<u32>,
    /// ★ v1.9.0 M4 待登基（抵达且王位仍空缺，待世界物理执行器 coronate）
    pub coronation_pending: Option<u32>,
    /// ★ 求偶目标女性 ID（决策器选定写入）
    pub courtship_target_id: Option<u32>,
    /// ★ M7/诊断 透传家庭库存施密特触发器（水/粮/木/石/金，true=需补采，false=充足）
    pub family_stock_active: [bool; 5],
    /// ★ M19.4 活动任务透视快照（意图-策略-原语三栏透视与决策可解释性）
    #[serde(default)]
    pub active_task: Option<ActiveTaskSnapshot>,
}

/// ★ M19.4 活动任务快照（意图-策略-原语三栏透视与决策可解释性）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActiveTaskSnapshot {
    pub branch: String,
    pub branch_desc: String,
    pub level: String,
    pub intent_kind: String,
    pub completion: String,
    pub strategy_kind: String,
    pub stage: String,
    pub target_id: Option<u32>,
    pub target_type: String,
    pub primitive_kind: String,
    pub primitive_detail: String,
    pub itinerary: String,
}

impl From<&ActiveTask> for ActiveTaskSnapshot {
    fn from(t: &ActiveTask) -> Self {
        let branch = t.intent.source_branch.str_id().to_string();
        let branch_desc = match t.intent.source_branch {
            BranchId::B1QuenchThirst => "饮水解渴",
            BranchId::B2SateHunger => "进食充饥",
            BranchId::B3Rest => "恢复体力",
            BranchId::B4RepairHouse => "修缮住宅",
            BranchId::B5StockWater => "储备饮水",
            BranchId::B6StockFood => "储备食物",
            BranchId::B7StockWood => "储备木材",
            BranchId::B8ImproveHome => "改善住宅",
            BranchId::B9StockStone => "储备石材",
            BranchId::B10StockGold => "储备资金",
            BranchId::B12FoundHome => "建立家宅",
            BranchId::B13GoldWealth => "积累财富",
            BranchId::B14SeekThrone => "争取王位",
            BranchId::B16Courtship => "求偶成家",
            BranchId::B17BidHouse => "竞购住宅",
            BranchId::B18RaiseChild => "生育后代",
        }
        .to_string();
        let level = t.intent.level.as_str().to_string();
        let intent_kind = match t.intent.kind {
            IntentKind::SatisfySurvival(res) => format!("SatisfySurvival({:?})", res),
            IntentKind::StockHousehold(res) => format!("StockHousehold({:?})", res),
            IntentKind::AcquireGold(purpose) => format!("AcquireGold({:?})", purpose),
            IntentKind::EmergencySupply => "EmergencySupply".to_string(),
            IntentKind::RestAndRecover => "RestAndRecover".to_string(),
            IntentKind::RepairHome => "RepairHome".to_string(),
            IntentKind::UpgradeHome { target_tier } => format!("UpgradeHome({:?})", target_tier),
            IntentKind::FoundNewHome => "FoundNewHome".to_string(),
            IntentKind::SeekCourtship => "SeekCourtship".to_string(),
            IntentKind::ClaimThrone => "ClaimThrone".to_string(),
            IntentKind::RaiseChild => "RaiseChild".to_string(),
        };
        let completion = match t.intent.completion {
            CompletionPolicy::SurvivalSatisfied(res) => format!("SurvivalSatisfied({:?})", res),
            CompletionPolicy::HouseholdStockSatisfied(res) => {
                format!("HouseholdStockSatisfied({:?})", res)
            }
            CompletionPolicy::GoldTripFinished(purpose) => {
                format!("GoldTripFinished({:?})", purpose)
            }
            CompletionPolicy::EmergencySupplyFinished => "EmergencySupplyFinished".to_string(),
            CompletionPolicy::RecoveryFinished => "RecoveryFinished".to_string(),
            CompletionPolicy::HomeRepaired => "HomeRepaired".to_string(),
            CompletionPolicy::HomeAtTier(tier) => format!("HomeAtTier({:?})", tier),
            CompletionPolicy::HomeFounded => "HomeFounded".to_string(),
            CompletionPolicy::MarriageRegistered => "MarriageRegistered".to_string(),
            CompletionPolicy::CoronationRegistered => "CoronationRegistered".to_string(),
            CompletionPolicy::ChildcareSettled => "ChildcareSettled".to_string(),
        };
        let strategy_kind = match t.strategy {
            ExecutionStrategy::WildHarvest { .. } => "WildHarvest",
            ExecutionStrategy::MarketTrade { .. } => "MarketTrade",
            ExecutionStrategy::ReturnToResidence { .. } => "ReturnToResidence",
            ExecutionStrategy::Courtship { .. } => "Courtship",
            ExecutionStrategy::ClaimThrone { .. } => "ClaimThrone",
            ExecutionStrategy::Childcare { .. } => "Childcare",
            ExecutionStrategy::FoundHome { .. } => "FoundHome",
            ExecutionStrategy::UpgradeHome { .. } => "UpgradeHome",
            ExecutionStrategy::RepairHome { .. } => "RepairHome",
        }
        .to_string();
        let stage = match t.strategy {
            ExecutionStrategy::WildHarvest { stage, .. } => format!("{:?}", stage),
            ExecutionStrategy::MarketTrade { stage, .. } => format!("{:?}", stage),
            ExecutionStrategy::ReturnToResidence { stage, .. } => format!("{:?}", stage),
            ExecutionStrategy::Courtship { stage, .. } => format!("{:?}", stage),
            ExecutionStrategy::ClaimThrone { stage, .. } => format!("{:?}", stage),
            ExecutionStrategy::Childcare { stage, .. } => format!("{:?}", stage),
            ExecutionStrategy::FoundHome { stage, .. } => format!("{:?}", stage),
            ExecutionStrategy::UpgradeHome { stage, .. } => format!("{:?}", stage),
            ExecutionStrategy::RepairHome { stage, .. } => format!("{:?}", stage),
        };
        let (target_id, target_type) = match t.strategy {
            ExecutionStrategy::WildHarvest { poi, .. } => (
                poi.map(|p| p as u32),
                if poi.is_some() { "Poi" } else { "None" },
            ),
            ExecutionStrategy::MarketTrade { market, .. } => (Some(market as u32), "Poi"),
            ExecutionStrategy::ReturnToResidence { destination, .. } => match destination {
                ResidenceTarget::House(hid) => (Some(hid), "House"),
                ResidenceTarget::Camp(nid) => (Some(nid as u32), "Camp"),
            },
            ExecutionStrategy::Courtship { female, .. } => (Some(female), "Agent"),
            ExecutionStrategy::ClaimThrone { camp, .. } => (Some(camp), "Camp"),
            ExecutionStrategy::Childcare { house, .. } => (Some(house), "House"),
            ExecutionStrategy::FoundHome { route_target, .. } => {
                (Some(route_target as u32), "Camp")
            }
            ExecutionStrategy::UpgradeHome { house, .. } => (Some(house), "House"),
            ExecutionStrategy::RepairHome { house, .. } => (Some(house), "House"),
        };
        let (primitive_kind, primitive_detail) = match t.primitive {
            ActionPrimitive::Navigate { target, arrival } => (
                "Navigate".to_string(),
                format!("Node #{} ({:?})", target, arrival),
            ),
            ActionPrimitive::Hold(hold) => (
                "Hold".to_string(),
                match hold {
                    HoldKind::ResourceSite(poi) => format!("ResourceSite #{}", poi),
                    HoldKind::Residence => "Residence".to_string(),
                    HoldKind::Repair => "Repair".to_string(),
                    HoldKind::Upgrade => "Upgrade".to_string(),
                    HoldKind::OffRoad => "OffRoad".to_string(),
                },
            ),
            ActionPrimitive::AwaitSettlement => {
                ("AwaitSettlement".to_string(), "Settlement".to_string())
            }
        };
        ActiveTaskSnapshot {
            branch,
            branch_desc,
            level,
            intent_kind,
            completion,
            strategy_kind,
            stage,
            target_id,
            target_type: target_type.to_string(),
            primitive_kind,
            primitive_detail,
            itinerary: "--".to_string(),
        }
    }
}

impl ActiveTaskSnapshot {
    /// ★ M19.4d 结合当前进行中任务与预排采收队列生成快照透视图
    pub fn from_task_and_queue(t: &ActiveTask, queue: &[Option<BranchId>; 4]) -> Self {
        let mut snap = Self::from(t);
        let mut stops = Vec::new();
        let cur = match t.intent.source_branch {
            BranchId::B5StockWater => "💧储备饮水",
            BranchId::B6StockFood => "🍒储备食物",
            BranchId::B7StockWood => "🌲储备木材",
            BranchId::B9StockStone => "🪨储备石材",
            BranchId::B10StockGold => "🪙储备资金",
            _ => "",
        };
        if !cur.is_empty() {
            stops.push(cur);
        }
        for opt_b in queue.iter().flatten() {
            let name = match opt_b {
                BranchId::B5StockWater => "💧储备饮水",
                BranchId::B6StockFood => "🍒储备食物",
                BranchId::B7StockWood => "🌲储备木材",
                BranchId::B9StockStone => "🪨储备石材",
                BranchId::B10StockGold => "🪙储备资金",
                _ => "",
            };
            if !name.is_empty() {
                stops.push(name);
            }
        }
        snap.itinerary = if stops.len() > 1 {
            stops.join(" → ")
        } else {
            "--".to_string()
        };
        snap
    }
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
    /// ★ v1.9.0 是否已绝嗣（所有男性已亡；族产已平分/入公仓）
    pub is_extinct: bool,
}

/// ★ v1.12.0 历史国王快照（含在位起止 tick 与死因）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryKingSnapshot {
    pub agent_id: AgentId,
    pub reign_start_tick: u64,
    pub reign_end_tick: u64,
    pub death_cause: Option<String>,
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
    /// ★ v1.12.0 历史国王（已离任/驾崩的所有前任国王，不含现任），含在位时长与死因
    pub history_kings: Vec<HistoryKingSnapshot>,
    /// ★ v1.9.0 地区居民 AgentId 列表（按升序）
    pub member_ids: Vec<AgentId>,
    /// ★ v1.9.0 管辖的家庭（户主所属本地区的存续家户 HouseholdId，按升序）
    pub governed_households: Vec<u64>,
    /// ★ v1.12.0 现任国王登基 tick（None = 王位空悬），前端计算在位时长
    pub current_reign_start: Option<u64>,
    /// ★ v1.35.2 该地区王国累计拨付给国王的内帑总额（黄金）
    pub cumulative_royal_privy: f32,
}

/// 帝国快照（按帝国聚合营地与下属王国首长）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmpireSnapshot {
    pub empire_id: u32,
    pub regime: String,
    pub head_title: String,
    pub emperor_id: Option<AgentId>,
    pub member_camp_ids: Vec<u32>,
    pub member_count: u32,
    pub king_candidates: Vec<AgentId>,
    pub balances: Vec<LedgerBalanceSnapshot>,
    pub recent_journal: Vec<TransferRecordSnapshot>,
    pub recent_events: Vec<String>,
    pub current_reign_start: Option<u64>,
    pub cumulative_imperial_privy: f32,
}
