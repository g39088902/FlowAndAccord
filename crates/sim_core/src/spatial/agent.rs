use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, LaneId, NodeId};
use super::poi::PoiId;
use crate::config::*;

pub type AgentId = u32;

// Re-export for external and internal callers
pub use crate::config::CARRY_CAPACITY_RESOURCE;

/// Agent 对单个 POI 的库存施密特记忆：高阈值开启、低阈值关闭，中间区间保持前态。
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct StockSchmittTrigger {
    active: bool,
    activate_ratio: f32,
    deactivate_ratio: f32,
}

impl StockSchmittTrigger {
    pub fn new(initial_ratio: f32, activate_ratio: f32, deactivate_ratio: f32) -> Self {
        assert!(deactivate_ratio <= activate_ratio, "施密特触发器的关闭阈值不能高于开启阈值");
        Self { active: initial_ratio >= activate_ratio, activate_ratio, deactivate_ratio }
    }

    pub fn update(&mut self, ratio: f32) -> bool {
        if self.active {
            if ratio < self.deactivate_ratio { self.active = false; }
        } else if ratio >= self.activate_ratio {
            self.active = true;
        }
        self.active
    }

    pub fn is_active(&self) -> bool { self.active }
}

/// 百家姓（前150姓），用于始祖随机赋姓
pub const COMMON_SURNAMES: &[&str] = &[
    "赵", "钱", "孙", "李", "周", "吴", "郑", "王", "冯", "陈",
    "褚", "卫", "蒋", "沈", "韩", "杨", "朱", "秦", "尤", "许",
    "何", "吕", "施", "张", "孔", "曹", "严", "华", "金", "魏",
    "陶", "姜", "戚", "谢", "邹", "喻", "柏", "水", "窦", "章",
    "云", "苏", "潘", "葛", "奚", "范", "彭", "郎", "鲁", "韦",
    "昌", "马", "苗", "凤", "花", "方", "俞", "任", "袁", "柳",
    "酆", "鲍", "史", "唐", "费", "廉", "岑", "薛", "雷", "贺",
    "倪", "汤", "滕", "殷", "罗", "毕", "郝", "邬", "安", "常",
    "乐", "于", "时", "傅", "皮", "卞", "齐", "康", "伍", "余",
    "元", "卜", "顾", "孟", "平", "黄", "和", "穆", "萧", "尹",
    "姚", "邵", "湛", "汪", "祁", "毛", "禹", "狄", "米", "贝",
    "明", "臧", "计", "伏", "成", "戴", "谈", "宋", "茅", "庞",
    "熊", "纪", "舒", "屈", "项", "祝", "董", "梁", "杜", "阮",
    "蓝", "闵", "席", "季", "麻", "强", "贾", "路", "娄", "危",
    "江", "童", "颜", "郭", "梅", "盛", "林", "刁", "钟", "徐",
];

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
    SeekingThrone,      // ⚔️ 夺位远征中（冲向无主营地登基）
    SeekingMarket,      // 🚶 正在赶往外部市场求购水粮
    BuyingAtMarket,     // ⚖️ 正在市场现场交易（就地自救与装载行囊）
    SeekingCourtship,   // 💍 正在奔赴心仪女性求偶
    RaiseChild,         // 👶 尊重需求：男性自主承担养育小孩并尝试使妻子受孕
    Dead,               // 💀 已死亡 (饥荒或脱水致死)
}

/// 3D 动力学 Agent 实体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent3D {
    pub id: AgentId,
    pub gender: Gender, // 性别 (Male / Female)
    pub state: PrimitiveActionState,
    pub is_alive: bool,
    pub age: f32,
    /// 出生时刻的世界 tick 数 (始祖在初始化时记录, 后代在分娩时记录)
    /// 用于前端族谱按出生时序施加纵向重力: 越晚出生的越靠下.
    pub birth_tick: u64,
    /// ★ M4 到达该地区的时刻 tick（始祖=0；新生儿=出生时 tick_counter）
    /// 用于地区初王顺位与 arrival_order 排序
    pub arrival_tick: u64,

    // 统一生理指标 (0.0 ~ 50.0 单位，初始 50% 即 25.0 单位)
    pub hunger: f32,          // 饱食度 (最大 50.0 单位)
    pub thirst: f32,          // 水分值 (最大 50.0 单位)
    pub stamina: f32,         // 体力值 (0.0 ~ 100.0%)
    pub health: f32,          // ❤️ 健康需求值 (出生时为寿命属性值，不可补充，归零即老死)
    pub max_health: f32,      // 健康值基准上限 (出生时记录的初始寿命)
    // 随身行囊: 水/粮/木/石 每类独立容量 50.0 单位 (互不共享)，黄金无限容量
    pub carried_water: f32,   // 随身携带清水
    pub carried_food: f32,    // 随身携带食物
    pub carried_wood: f32,    // 随身携带木材
    pub carried_stone: f32,   // 随身携带石料
    pub carried_gold: f32,    // 随身携带黄金
    /// ★ v1.26.3 累计开采资源量（单位）：本 agent 一生从资源点装载入随身行囊的累计总量
    /// （水/粮/木/石/金五类合计）。口径 = 「开采搬运」：市场购买与就地自饮自食不计入。
    /// 纯累加、不消耗 WorldRng，确定性不受影响。调试模式前端卡片展示用。
    #[serde(default)]
    pub cumulative_mined: f32,
    /// ★ v1.26.3 累计开采资源量 · 分品种（水/粮/木/石/金）：合计字段的明细拆分，仅调试展示用。
    /// 与 `cumulative_mined` 同步累加，保证 合计 == 五者之和。
    #[serde(default)]
    pub cumulative_mined_water: f32,
    #[serde(default)]
    pub cumulative_mined_food: f32,
    #[serde(default)]
    pub cumulative_mined_wood: f32,
    #[serde(default)]
    pub cumulative_mined_stone: f32,
    #[serde(default)]
    pub cumulative_mined_gold: f32,
    pub home_camp_node: NodeId, // 所属归宿营地节点 (或房屋门前节点)
    pub target_poi_node: Option<NodeId>, // 当前行动目标节点
    /// 对各 POI 的私有可派遣性记忆；仅在本 Agent 的决策相位刷新。
    pub poi_seekability: BTreeMap<PoiId, StockSchmittTrigger>,
    pub home_house_id: Option<u32>, // 绑定的私宅/大庄园 ID (若有)
    /// 自主“自立门户”决策选定的宅址候选 (待系统实体化登记为 0 级仓库)
    pub pending_house_pos: Option<Vec3>,
    /// ★ M4 夺位远征目标营地（决策引擎驱动：由本 agent 自主选定并持有的远征目标）
    /// 仅在本 agent 处于夺位远征意图期间非空；登基/重定向/放弃均由决策器读写。
    #[serde(default)]
    pub expedition_target_camp: Option<u32>,
    /// ★ M4 登基待结算标记：本 agent 已抵达目标营地且王位空缺，等待世界系统执行登基物理规则
    /// （与 pending_house_pos 同模式：决策器只下决心，实体化由 world 负责）。
    #[serde(default)]
    pub coronation_pending: Option<u32>,
    /// ★ 求偶目标女性 ID（决策引擎驱动：由成年单身男性自主选定）
    #[serde(default)]
    pub courtship_target_id: Option<AgentId>,
    /// ★ 求偶待结算标记：本 agent 已抵达目标女性互动半径，等待世界物理执行器登记结婚
    #[serde(default)]
    pub courtship_pending: Option<AgentId>,
    /// 男方自主“养育小孩”决策待执行标记；世界结算阶段核验妻子条件后受孕。
    #[serde(default)]
    pub raise_child_pending: bool,
    /// ★ v1.26.0 竞拍决心：本 agent 自主选定要出价的在售房屋 ID，等待世界执行器落地
    #[serde(default)]
    pub pending_bid_house_id: Option<u32>,
    /// ★ v1.26.0 上次出价的世界 tick（None = 从未出价），用于全局出价冷却
    #[serde(default)]
    pub last_bid_tick: Option<u64>,
    pub build_timer: f32,     // 正在营建/升级当前房屋投入的累计工时 (秒)
    pub gold_mining_cooldown: f32, // 淘金冷却时间 (秒)

    // 代际传承与家庭血缘
    pub generation: u32,             // 世代代数 (始祖为第1代，子一代为第2代，依此类推)
    pub spouse_id: Option<AgentId>,  // 配偶 ID (一夫一妻)
    pub mother_id: Option<AgentId>,  // 生母 ID
    pub father_id: Option<AgentId>,  // 生父 ID
    pub children_ids: Vec<AgentId>,  // 子女列表
    pub surname: String,             // 传承氏族姓氏 (如 "李"、"张")
    /// ★ M6/v1.18.0 威望（所有影响因子的综合持久分，非"宗族声望"）：当前因子 = 子嗣（活产各 +1）
    ///   + 宅邸（房屋每晋升一级 +1）+ 担任国王（登基 +3）+ 担任宗族长老（任职 +3）。
    ///   子女日后死亡不回减；随 agent 终身、不随房屋/家户转移。
    pub prestige: u32,
    /// ★ M7 家庭库存施密特触发器（五类，顺序固定 = 水/粮/木/石/金）：
    /// 输入为家户账本余额；余额 < 100 → 置 ON（需要去采）；一旦 ON 须余额 ≥ 200 才置 OFF。
    /// 每 agent 私有、带滞回、确定性；无房者由决策层 guard 短路，本值不直接参与行为。
    #[serde(default)]
    pub family_stock_active: [bool; 5],

    // 先天遗传基因指标 (禀赋均值 100.0，服从正态分布继承与变异)
    pub intelligence: f32,           // 智力: 决策理性与技能领悟
    pub strength: f32,               // 力量: 劳作与负重耐力
    pub digestion_efficiency: f32,   // 消化代谢效率: 影响饱腹消耗速率 (高者抗饿)
    pub libido: f32,                 // 繁衍意愿: 影响受孕倾向与求偶动力
    pub sleep_efficiency: f32,       // 睡眠效率: 影响体力回血速率 (高者恢复快)
    pub life_expectancy: f32,        // 预期基础寿命 (秒)

    // 繁衍与生命周期
    pub is_pregnant: bool,
    pub pregnancy_father_id: Option<AgentId>, // 胎儿生父 ID
    /// ★ 腹中胎儿的 AgentId（受孕瞬间即占号；M1.7 起由 `world.tick_fetus_reconcile` 同步创建完整 agent 实体，分娩原位替换复用该 ID）
    /// 目的：分家权重与遗产继承需把"妈妈肚子里的孩子"计入子一代（账本重构 M1.6/M1.7）
    pub pregnancy_child_id: Option<AgentId>,
    /// ★ 腹中胎儿标记（M1.7 受孕即建 agent 身份）
    /// 已获完整 Agent 实体：不设置地图实体、跳过决策/代谢/运动、无需求消耗；
    /// 出生时在 birth.rs::resolve_newborns 原位替换为新生儿。默认 false。
    #[serde(default)]
    pub is_fetus: bool,
    pub pregnancy_progress: f32,     // 孕期进度 (0.0 ~ 1.0)
    pub ready_to_birth: bool,        // 孕期满是否准备分娩
    pub miscarriage_alert_timer: f32,// 流产警报留存显示计时器 (秒)
    pub miscarriage_cooldown_timer: f32, // 流产后不可受孕的休养冷却计时器 (秒)
    /// ★ 产后休养冷却计时器 (秒)：分娩完成后置为 config.agent_postpartum_cooldown (900s)，期间禁止再次受孕
    #[serde(default)]
    pub postpartum_cooldown_timer: f32,
    pub death_decay_timer: f32,      // 死亡尸骸消逝倒计时 (秒)
    pub death_cause: Option<String>, // 死亡原因
    pub death_is_natural: bool,      // 是否自然死亡 (寿终正寝=true；饥荒/脱水等非自然死亡=false)

    // 3D 动力学运动与路网循迹
    pub current_lane_id: Option<LaneId>,
    pub distance_along_curve: f32,
    pub current_velocity: f32,
    pub max_desired_speed: f32,
    pub route: Vec<LaneId>,
    pub route_index: usize,

    // 马斯洛需求层次驱动的当前主导需求 (调试/前端观察用)
    #[serde(default)]
    pub current_need: Option<String>, // 当前驱动行动的需求标签
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
        Self::new_with_config(id, home_camp, max_speed, is_covert, initial_age, gender, &SimConfig::default())
    }

    pub fn new_with_config(id: AgentId, home_camp: NodeId, max_speed: f32, is_covert: bool, initial_age: f32, gender: Gender, config: &SimConfig) -> Self {
        let quadrupled_speed = max_speed * config.agent_base_move_speed_mult;
        Self {
            id,
            gender,
            state: PrimitiveActionState::RestingAtCamp,
            is_alive: true,
            age: initial_age,
            birth_tick: 0, // 默认 0; 由调用方 (ecology.rs 始祖初始化 / birth.rs 分娩) 覆写为当前 tick_counter
            arrival_tick: 0, // 默认 0; 由调用方 (ecology.rs 始祖 / birth.rs 分娩) 覆写
            hunger: config.agent_initial_hunger,
            thirst: config.agent_initial_thirst,
            stamina: config.agent_initial_stamina,
            health: config.trait_default_mean,
            max_health: config.trait_default_mean,
            carried_water: 0.0,
            carried_food: 0.0,
            carried_wood: 0.0,
            carried_stone: 0.0,
            carried_gold: 0.0,
            cumulative_mined: 0.0,
            cumulative_mined_water: 0.0,
            cumulative_mined_food: 0.0,
            cumulative_mined_wood: 0.0,
            cumulative_mined_stone: 0.0,
            cumulative_mined_gold: 0.0,
            home_camp_node: home_camp,
            target_poi_node: None,
            poi_seekability: BTreeMap::new(),
            home_house_id: None,
            pending_house_pos: None,
            expedition_target_camp: None,
            coronation_pending: None,
            courtship_target_id: None,
            courtship_pending: None,
            raise_child_pending: false,
            pending_bid_house_id: None,
            last_bid_tick: None,
            build_timer: 0.0,
            gold_mining_cooldown: 0.0,
            generation: 1,
            spouse_id: None,
            mother_id: None,
            father_id: None,
            children_ids: Vec::new(),
            surname: String::new(), // 由调用方（ecology.rs）赋值
            prestige: 0,
            family_stock_active: [false; 5],
            intelligence: config.trait_default_mean,
            strength: config.trait_default_mean,
            digestion_efficiency: config.trait_default_mean,
            libido: config.trait_default_mean,
            sleep_efficiency: config.trait_default_mean,
            life_expectancy: config.trait_default_mean,
            is_pregnant: false,
            pregnancy_father_id: None,
            pregnancy_child_id: None,
            is_fetus: false,
            pregnancy_progress: 0.0,
            ready_to_birth: false,
            miscarriage_alert_timer: 0.0,
            miscarriage_cooldown_timer: 0.0,
            postpartum_cooldown_timer: 0.0,
            death_decay_timer: config.agent_death_decay_duration,
            death_cause: None,
            death_is_natural: false,
            current_lane_id: None,
            distance_along_curve: 0.0,
            current_velocity: 0.0,
            max_desired_speed: quadrupled_speed,
            route: Vec::new(),
            route_index: 0,
            is_covert,
            stealth_visibility: if is_covert { config.agent_stealth_visibility_covert } else { config.agent_stealth_visibility_normal },
            current_need: None,
            world_pos: Vec3::ZERO,
            forward_heading_rad: 0.0,
            pitch_rad: 0.0,
        }
    }

    /// 随身行囊当前总装载量 (水+粮+木+石，黄金不计入容量)
    pub fn carried_load(&self) -> f32 {
        self.carried_water + self.carried_food + self.carried_wood + self.carried_stone
    }

    /// 用本次观察到的 POI 库存刷新该 Agent 私有的施密特触发器。
    pub fn observe_poi_stock(&mut self, poi_id: PoiId, current_stock: f32, max_stock: f32) -> bool {
        self.observe_poi_stock_with_config(poi_id, current_stock, max_stock, &SimConfig::default())
    }

    pub fn observe_poi_stock_with_config(&mut self, poi_id: PoiId, current_stock: f32, max_stock: f32, config: &SimConfig) -> bool {
        let ratio = if max_stock.is_finite() && max_stock > 0.0 {
            current_stock / max_stock
        } else {
            1.0
        };
        self.poi_seekability
            .entry(poi_id)
            .or_insert_with(|| StockSchmittTrigger::new(0.0, config.decision_poi_seek_min_stock_ratio, config.decision_poi_abandon_stock_ratio))
            .update(ratio)
    }

    /// 查询本 Agent 对某 POI 的可派遣结论；尚未观察到的 POI 默认为不可用。
    pub fn poi_is_seekable(&self, poi_id: PoiId) -> bool {
        self.poi_seekability.get(&poi_id).map(StockSchmittTrigger::is_active).unwrap_or(false)
    }

    /// 核心生命代谢 Tick (上限50.0单位；受孕由马斯洛“养育小孩”行动触发)
    /// 代谢与繁衍结算。
    ///
    /// `next_agent_id` 为全局发号器的可变引用：**受孕瞬间**即为胎儿占号并写入
    /// [`Self::pregnancy_child_id`]，使未出生的孩子能参与分家权重与遗产继承（账本重构 M1.6）。
    /// 该发号不消耗 `WorldRng`，仅按调用顺序递增，确定性不受影响。
    ///
    /// 受孕不在此处自动触发；由世界阶段执行男性的 raise_child_pending 意图。
    pub fn tick_metabolism(
        &mut self,
        dt: f32,
        config: &SimConfig,
        _next_agent_id: &mut AgentId,
    ) -> Option<String> {
        if self.gold_mining_cooldown > 0.0 {
            self.gold_mining_cooldown = (self.gold_mining_cooldown - dt).max(0.0);
        }
        if self.miscarriage_alert_timer > 0.0 {
            self.miscarriage_alert_timer = (self.miscarriage_alert_timer - dt).max(0.0);
        }
        if self.miscarriage_cooldown_timer > 0.0 {
            self.miscarriage_cooldown_timer = (self.miscarriage_cooldown_timer - dt).max(0.0);
        }
        if self.postpartum_cooldown_timer > 0.0 {
            self.postpartum_cooldown_timer = (self.postpartum_cooldown_timer - dt).max(0.0);
        }

        if !self.is_alive {
            self.death_decay_timer = (self.death_decay_timer - dt).max(0.0);
            return None;
        }

        // 年龄增长
        self.age += dt;

        let event_msg = None;
        let mut metabolic_multiplier = if self.is_pregnant { config.agent_pregnant_metabolism_mult } else { 1.0 };

        // ★ M6 升级瞬时化：ConstructingHouse 已无体力/工时投入，不再计入劳动代谢加速
        if self.state == PrimitiveActionState::RepairingHouse
            || self.state == PrimitiveActionState::GatheringWood
            || self.state == PrimitiveActionState::MiningStone
            || self.state == PrimitiveActionState::MiningGold
        {
            metabolic_multiplier *= config.agent_work_metabolism_mult; // 修缮与采矿劳动代谢加速
        }

        let dig_ratio = (self.digestion_efficiency / 100.0).clamp(config.agent_digestion_ratio_min, config.agent_digestion_ratio_max);
        let hunger_decay_per_sec = (config.agent_base_metabolism_decay * metabolic_multiplier) / dig_ratio;
        let thirst_decay_per_sec = config.agent_base_metabolism_decay * metabolic_multiplier;
        self.hunger = (self.hunger - hunger_decay_per_sec * dt).max(0.0);
        self.thirst = (self.thirst - thirst_decay_per_sec * dt).max(0.0);
        self.health = (self.health - config.agent_health_decay_per_sec * dt).max(0.0);

        // 死亡判定 (归 0 即死亡)
        if self.hunger <= 0.0 {
            self.is_alive = false;
            self.state = PrimitiveActionState::Dead;
            self.death_cause = Some("饥荒饿死".to_string());
            self.death_is_natural = false;
            self.is_pregnant = false;
            self.pregnancy_father_id = None;
            self.pregnancy_child_id = None;
            self.courtship_target_id = None;
            self.courtship_pending = None;
            self.death_decay_timer = config.agent_death_decay_duration;
            return Some(format!("💀 部落民 #{} 因长期饥荒不幸饿死！", self.id));
        }
        if self.thirst <= 0.0 {
            self.is_alive = false;
            self.state = PrimitiveActionState::Dead;
            self.death_cause = Some("脱水渴死".to_string());
            self.death_is_natural = false;
            self.is_pregnant = false;
            self.pregnancy_father_id = None;
            self.pregnancy_child_id = None;
            self.courtship_target_id = None;
            self.courtship_pending = None;
            self.death_decay_timer = config.agent_death_decay_duration;
            return Some(format!("💀 部落民 #{} 因严重脱水在荒野中渴死！", self.id));
        }
        if self.health <= 0.0 {
            self.is_alive = false;
            self.state = PrimitiveActionState::Dead;
            self.death_cause = Some("寿终正寝".to_string());
            self.death_is_natural = true;
            self.is_pregnant = false;
            self.pregnancy_father_id = None;
            self.pregnancy_child_id = None;
            self.courtship_target_id = None;
            self.courtship_pending = None;
            self.death_decay_timer = config.agent_death_decay_duration;
            return Some(format!("💀 部落民 #{} 寿终正寝，安详离世！", self.id));
        }

        // 妊娠与流产判定
        if self.is_pregnant {
            let miscarry_threshold = config.agent_miscarriage_threshold;
            if self.hunger < miscarry_threshold || self.thirst < miscarry_threshold || self.stamina < config.agent_miscarriage_stamina_threshold {
                self.is_pregnant = false;
                self.pregnancy_father_id = None;
                self.pregnancy_child_id = None; // 流产：释放胎儿占用的 ID
                self.pregnancy_progress = 0.0;
                self.miscarriage_alert_timer = config.agent_miscarriage_alert_duration;
                self.miscarriage_cooldown_timer = config.agent_miscarriage_cooldown;
                return Some(format!("🥀 痛惜！女性部落民 #{} 生存指标跌破20%安全线(<{:.1}单位)，导致流产 ({:.0}秒内休养不可受孕)！", self.id, miscarry_threshold, config.agent_miscarriage_cooldown));
            }

            self.pregnancy_progress += dt / config.agent_pregnancy_duration;
            if self.pregnancy_progress >= 1.0 {
                self.is_pregnant = false;
                self.pregnancy_progress = 0.0;
                self.ready_to_birth = true;
                // ★ 分娩后进入产后休养冷却：期间禁止再次受孕
                self.postpartum_cooldown_timer = config.agent_postpartum_cooldown;
                return Some(format!("🍼 喜讯！女性部落民 #{} 历经{:.0}秒漫长孕期，顺利产下一名健康的新生儿！", self.id, config.agent_pregnancy_duration));
            }
        }

        // 休息、修缮与采集体力结算（★ M6 升级瞬时化：ConstructingHouse 不再消耗体力）
        if self.state == PrimitiveActionState::RestingAtCamp {
            let recovery_rate = config.agent_rest_stamina_recovery_rate * (self.sleep_efficiency / 100.0);
            self.stamina = (self.stamina + recovery_rate * dt).min(config.agent_stamina_capacity);
        } else if self.state == PrimitiveActionState::RepairingHouse {
            self.stamina = (self.stamina - config.agent_repair_stamina_burn * dt).max(config.agent_labor_stamina_floor);
        } else if self.state == PrimitiveActionState::GatheringWood || self.state == PrimitiveActionState::MiningStone {
            self.stamina = (self.stamina - config.agent_gather_stamina_burn * dt).max(config.agent_labor_stamina_floor);
        }

        event_msg
    }

    /// 切换到静止态：统一清空车道、速度与路线索引，确保物理移动立即停止。
    ///
    /// 所有从移动态切到非移动态的场景必须调用本方法，禁止直接 `agent.state = X`
    /// 而不清 `current_lane_id`——否则 `tick_movement` 会沿残留路线继续移动，
    /// 出现"人在家休息但坐标在跑"的异常。移动由 `current_lane_id.is_some()` 唯一驱动，
    /// 本方法是该不变量的唯一写入入口。
    pub fn enter_stationary_state(&mut self, state: PrimitiveActionState) {
        self.state = state;
        self.current_lane_id = None;
        self.current_velocity = 0.0;
        self.route_index = 0;
    }

    /// 3D 动力学移动与踩踏拓路 (走的人多了踩踏等级提升，移动速度连续浮点加快)
    ///
    /// 移动由 `current_lane_id.is_some()` 唯一驱动：有车道则沿路线积分位移，
    /// 无车道则清零速度并静止。不再维护 is_moving 白名单——非移动态必须通过
    /// `enter_stationary_state()` 确保 `current_lane_id=None`，从源头消除残留。
    pub fn tick_movement(&mut self, dt: f32, road_network: &mut LaneGraph3D, config: &SimConfig) {
        if !self.is_alive {
            self.current_velocity = 0.0;
            return;
        }

        // 无车道 = 静止（非移动态通过 enter_stationary_state 保证到达此处）
        let Some(lane_id) = self.current_lane_id else {
            self.current_velocity = 0.0;
            return;
        };
        let Some(edge_idx) = road_network.edge_map.get(&lane_id).copied() else {
            // 车道在路网中消失（路网重建/衰减极端情况）：进入越野静止态等待决策器重路由
            self.enter_stationary_state(PrimitiveActionState::OffRoadDetour);
            return;
        };

        let from_node = road_network.graph[edge_idx].from_node;
        let to_node = road_network.graph[edge_idx].to_node;
        let from_idx = road_network.node_map[&from_node];
        let to_idx = road_network.node_map[&to_node];
        let rev_edge_idx = road_network.graph.find_edge(to_idx, from_idx);

        let lane = &road_network.graph[edge_idx];
        let wear = lane.wear;

        let road_level_factor = (config.road_level_factor_base + config.road_level_factor_wear_coef * wear).clamp(config.road_level_factor_min, config.road_level_factor_max);

        // 坡度体力能耗
        let delta_z = lane.curve.p3.z - lane.curve.p0.z;
        let uphill_penalty = if delta_z > 0.0 { (delta_z / lane.curve.length).max(0.0) } else { 0.0 };
        let stamina_burn = (config.agent_move_stamina_base + if self.is_pregnant { config.agent_move_stamina_pregnant } else { 0.0 }) * (1.0 + uphill_penalty * config.agent_move_stamina_grade_coef);
        self.stamina = (self.stamina - stamina_burn * dt).max(0.0);

        // 💪 力量禀赋直接决定步速: 行走速度 = 默认速度 × 道路质量 × (力量/100)，全员共用默认速度、不受体力影响、不加 clamp
        let target_speed = self.max_desired_speed * road_level_factor * (self.strength / 100.0);

        let accel = (target_speed - self.current_velocity) * config.agent_move_accel_coef;
        self.current_velocity = (self.current_velocity + accel * dt).max(0.0);
        self.distance_along_curve += self.current_velocity * dt;

        if self.distance_along_curve >= lane.curve.length {
            // 踩踏拓路
            {
                let edge = &mut road_network.graph[edge_idx];
                let new_wear = (edge.wear + config.road_wear_step_inc).min(config.road_max_wear);
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
                // 下一条车道在路网中消失：进入越野静止态，清空车道等待决策器重路由
                self.enter_stationary_state(PrimitiveActionState::OffRoadDetour);
            }
        } else {
            // 路线走完：统一通过 enter_stationary_state 切到对应静止态，确保车道/速度清零
            match self.state {
                PrimitiveActionState::SeekingWater => {
                    self.enter_stationary_state(PrimitiveActionState::DrinkingAtWater);
                }
                PrimitiveActionState::SeekingFood => {
                    self.enter_stationary_state(PrimitiveActionState::ForagingFood);
                }
                PrimitiveActionState::SeekingWood => {
                    self.enter_stationary_state(PrimitiveActionState::GatheringWood);
                }
                PrimitiveActionState::SeekingStone => {
                    self.enter_stationary_state(PrimitiveActionState::MiningStone);
                }
                PrimitiveActionState::SeekingGold => {
                    self.enter_stationary_state(PrimitiveActionState::MiningGold);
                }
                PrimitiveActionState::ReturningToCamp => {
                    self.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
                }
                PrimitiveActionState::SeekingMarket => {
                    self.enter_stationary_state(PrimitiveActionState::BuyingAtMarket);
                }
                _ => {
                    // SeekingCourtship / SeekingThrone 等由决策模块自行处理状态转换，
                    // 此处仅清零车道与速度，保持原 state 等待 decide_seeking_* 重补路或结算
                    self.current_velocity = 0.0;
                    self.current_lane_id = None;
                    self.route_index = 0;
                }
            }
        }
    }
}
