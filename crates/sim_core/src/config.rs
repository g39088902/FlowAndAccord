//! Flow & Accord 核心仿真超参数集中配置文件 (config.rs)
//!
//! 本文件集中归档并管理全系统所有动力学、生理代谢、生态演化、
//! 房屋营造、马斯洛决策门槛、四季环境与路网踩踏超参数。
//! 便于开发者和玩家一站式调参、测试与平衡性实验。

// ============================================================================
// 1. 引擎节拍与时间基准 (Simulation Time & Ticks)
// ============================================================================

/// 基础仿真时间微步步长 (秒)，对应 30 FPS 锁定帧率 (1/30 = 0.033333s)
pub const SIMULATION_DT: f32 = 1.0 / 30.0;

/// 每秒对应的引擎 Tick 步数
pub const TICKS_PER_SECOND: u64 = 30;

/// 部落民错峰决策相位周期 (每 30 ticks = 1.0 秒决策一次)
pub const AGENT_DECISION_INTERVAL_TICKS: u64 = 30;

// ============================================================================
// 2. 部落民生理、代谢与生命周期 (Agent Physiology & Lifecycle)
// ============================================================================

/// 部落民饱食度上限 (单位)
pub const AGENT_HUNGER_CAPACITY: f32 = 50.0;

/// 部落民水分值上限 (单位)
pub const AGENT_THIRST_CAPACITY: f32 = 50.0;

/// 部落民初始饱食度 (初始 50% = 25.0 单位)
pub const AGENT_INITIAL_HUNGER: f32 = 25.0;

/// 部落民初始水分值 (初始 50% = 25.0 单位)
pub const AGENT_INITIAL_THIRST: f32 = 25.0;

/// 部落民初始体力值 (%)
pub const AGENT_INITIAL_STAMINA: f32 = 95.0;

/// 部落民正常基准代谢消耗速率 (单位/秒，未怀孕状态下每10秒消耗1单位 = 0.10/s)
pub const AGENT_BASE_METABOLISM_DECAY: f32 = 0.10;

/// 部落民健康值每秒自然衰减速率 (单位/秒，不可补充，归零即老死；0.02/s 对应约 5000s 寿命)
pub const AGENT_HEALTH_DECAY_PER_SEC: f32 = 0.01;

/// 孕期女性代谢加速倍率 (1.25x，即 0.125 单位/秒)
pub const AGENT_PREGNANT_METABOLISM_MULT: f32 = 1.25;

/// 重体力劳动 (营建/修缮/采伐/挖矿) 代谢加速倍率 (1.25x)
pub const AGENT_WORK_METABOLISM_MULT: f32 = 1.0;

/// 尸体在荒野中留存衰变时长 (秒)
pub const AGENT_DEATH_DECAY_DURATION: f32 = 12.0;

/// 部落民成年年龄门槛 (秒，年满 1800 秒方可结婚与受孕)
pub const AGENT_ADULT_AGE: f32 = 1800.0;

/// 女性妊娠孕期总时长 (秒，900 秒孕期)
pub const AGENT_PREGNANCY_DURATION: f32 = 900.0;

/// 妊娠流产危险线: 饱食/水分指标跌破此值即发生流产 (20% 警戒线 = 10.0 单位)
pub const AGENT_MISCARRIAGE_THRESHOLD: f32 = 10.0;

/// 妊娠流产体力危险线: 体力跌破此百分比即发生流产 (20.0%)
pub const AGENT_MISCARRIAGE_STAMINA_THRESHOLD: f32 = 20.0;

/// 流产后休养冷却时长 (秒，期间禁止再次受孕，600 秒休养)
pub const AGENT_MISCARRIAGE_COOLDOWN: f32 = 600.0;

/// 流产警告警报留存显示时长 (秒)
pub const AGENT_MISCARRIAGE_ALERT_DURATION: f32 = 5.0;

/// 受孕门槛: 女性饱食度最低要求 (≥80% = 40.0 单位)
pub const AGENT_CONCEPTION_HUNGER_MIN: f32 = 40.0;

/// 受孕门槛: 女性水分值最低要求 (≥80% = 40.0 单位)
pub const AGENT_CONCEPTION_THIRST_MIN: f32 = 40.0;

/// 受孕门槛: 女性体力值最低要求 (≥80.0%)
pub const AGENT_CONCEPTION_STAMINA_MIN: f32 = 80.0;

/// 随身行囊单品类独立容量上限 (水/粮/木/石 各 50.0 单位，互不共享)
pub const CARRY_CAPACITY_RESOURCE: f32 = 50.0;

/// 单趟淘金黄金满载运载量 (黄金随身无限容量，但达到 20.0 触发返家入库)
pub const AGENT_GOLD_LOAD_FULL: f32 = 20.0;

/// 荒野越野无路行走的移速衰减系数 (50%)
pub const AGENT_OFFROAD_SPEED_FACTOR: f32 = 0.50;

/// 基础公路移速相对于默认基准的倍率 (4.0x)
pub const AGENT_BASE_MOVE_SPEED_MULT: f32 = 4.0;

/// 隐秘特工小人的能见度可见度系数 (0.25)
pub const AGENT_STEALTH_VISIBILITY_COVERT: f32 = 0.25;

/// 普通部落民的能见度可见度系数 (1.0)
pub const AGENT_STEALTH_VISIBILITY_NORMAL: f32 = 1.0;

// ============================================================================
// 3. 先天禀赋与遗传演化 (Genetics & Inherited Traits)
// ============================================================================

/// 始祖代先天禀赋均值 (智力/力量/魅力/消化/睡眠/寿命)
pub const TRAIT_DEFAULT_MEAN: f32 = 100.0;

/// 始祖代先天禀赋正态分布标准差 (N(100, 20)，95% 族人落在 60~140)
pub const TRAIT_INITIAL_STD_DEV: f32 = 20.0;

/// 后代继承变异扰动范围 (父母均值 ±10.0 × 线性随机数)
pub const TRAIT_MUTATION_DELTA: f32 = 10.0;

// ============================================================================
// 4. 生态地标与 POI 采收交互 (POI & Ecology Generation)
// ============================================================================

/// POI 地标空间排斥最小间距 (米)
pub const POI_MIN_DISTANCE: f32 = 70.0;

/// 全图避风营地数量 (处)
pub const COUNT_CAMPS: usize = 5;

/// 全图清泉水源数量 (处)
pub const COUNT_WATER_SOURCES: usize = 6;

/// 全图浆果灌木数量 (处)
pub const COUNT_BERRY_BUSHES: usize = 6;

/// 全图林木林地数量 (处)
pub const COUNT_WOODS: usize = 3;

/// 全图嶙峋石矿数量 (处)
pub const COUNT_STONE_MINES: usize = 2;

/// 全图璀璨金矿数量 (处)
pub const COUNT_GOLD_MINES: usize = 1;

/// 清泉水源最大可用储量上限 (单位)
pub const STOCK_MAX_WATER: f32 = 60.0;

/// 浆果灌木最大可用储量上限 (单位)
pub const STOCK_MAX_BERRY: f32 = 60.0;

/// 森林木材最大可用储量上限 (单位)
pub const STOCK_MAX_WOOD: f32 = 60.0;

/// 石矿石料最大可用储量上限 (单位)
pub const STOCK_MAX_STONE: f32 = 60.0;

/// 金矿黄金最大可用储量上限 (单位)
pub const STOCK_MAX_GOLD: f32 = 60.0;

/// 清泉水源自然基准产出速率 (单位/秒)
pub const REGEN_BASE_WATER: f32 = 2.0;

/// 浆果灌木自然基准生长速率 (单位/秒)
pub const REGEN_BASE_BERRY: f32 = 2.0;

/// 林木成材自然基准生成速率 (单位/秒)
pub const REGEN_BASE_WOOD: f32 = 2.0;

/// 石矿矿脉自然基准沉积速率 (单位/秒)
pub const REGEN_BASE_STONE: f32 = 2.0;

/// 金矿黄金自然基准淘洗速率 (单位/秒)
pub const REGEN_BASE_GOLD: f32 = 1.8;

/// 水/果/木/石现场采收与行囊装载速率 (单位/秒)
pub const POI_INTERACTION_RATE_RESOURCE: f32 = 10.0;

/// 金矿现场淘洗与装载速率 (单位/秒)
pub const POI_INTERACTION_RATE_GOLD: f32 = 5.0;

/// 营地/家宅休息时的体力恢复基础速率 (%/秒)
pub const CAMP_REST_STAMINA_RECOVERY_RATE: f32 = 20.0;

/// 随身物资回家卸货存入家宅仓库速率 (单位/秒)
pub const POI_UNLOAD_RATE_RESOURCE: f32 = 10.0;

/// 黄金回家卸货存入家宅金库速率 (单位/秒)
pub const POI_UNLOAD_RATE_GOLD: f32 = 5.0;

// ============================================================================
// 5. 马斯洛需求与决策门槛 (Maslow Needs & Decision Thresholds)
// ============================================================================

/// 启动寻路门槛: POI 储量低于此比例时排除在候选池外，绝不前往 (≥30%)
pub const DECISION_POI_SEEK_MIN_STOCK_RATIO: f32 = 0.30;

/// 中途放弃熔断门槛: 赶路途中目标 POI 储量跌破此比例时立即掉头放弃 (<10%)
pub const DECISION_POI_ABANDON_STOCK_RATIO: f32 = 0.10;

/// 生理口渴告急门槛: 水分值低于此值触发饮水需求 (25.0 单位)
pub const DECISION_CRITICAL_THIRST: f32 = 25.0;

/// 生理饥饿告急门槛: 饱食度低于此值触发觅食需求 (25.0 单位)
pub const DECISION_CRITICAL_HUNGER: f32 = 25.0;

/// 生理疲惫告急门槛: 体力低于此百分比触发归巢休整 (30.0%)
pub const DECISION_CRITICAL_STAMINA: f32 = 30.0;

/// 归巢休整目标: 一旦开始休息，必须充盈至此百分比方可解除休息 (100.0%)
pub const DECISION_REST_STAMINA_TARGET: f32 = 100.0;

/// 采金备料冷却时长 (秒，为3级庄舍升级大庄园备料)
pub const DECISION_STOCK_GOLD_COOLDOWN: f32 = 45.0;

/// 娱乐性淘金冷却时长 (秒，4级大庄园竣工后的自我实现娱乐)
pub const DECISION_GOLD_WEALTH_COOLDOWN: f32 = 180.0;

/// 房屋修缮需求门槛: 耐久度跌破此百分比产生修缮意愿 (50.0%)
pub const DECISION_HOUSE_REPAIR_NEED_THRESHOLD: f32 = 50.0;

/// 体力充沛时的富余觅食概率 (8%)
pub const DECISION_FORAGE_SURPLUS_CHANCE: f32 = 0.08;

// ============================================================================
// 6. 私宅营造、代际传承与升级 (Housing System)
// ============================================================================

/// 房屋耐久度满值 (100.0)
pub const HOUSE_DURABILITY_MAX: f32 = 100.0;

/// 房屋自然风化折旧速率 (耐久度/秒)
pub const HOUSE_DEPRECIATION_RATE: f32 = 0.02;

/// 房屋安排修缮开工门槛: 耐久度跌破此百分比安排户主/配偶修缮 (80.0%)
pub const HOUSE_REPAIR_TRIGGER_THRESHOLD: f32 = 80.0;

/// 房屋修缮劳作回血速率 (耐久度/秒)
pub const HOUSE_REPAIR_SPEED: f32 = 5.0;

/// 0级仓库升1级茅草房所需建造工时 (秒)
pub const HOUSE_BUILD_TIME_TIER0_TO_1: f32 = 30.0;

/// 1级茅草房升2级私宅所需建造工时 (秒)
pub const HOUSE_BUILD_TIME_TIER1_TO_2: f32 = 45.0;

/// 2级私宅升3级庄舍所需建造工时 (秒)
pub const HOUSE_BUILD_TIME_TIER2_TO_3: f32 = 60.0;

/// 3级庄舍升4级大庄园所需建造工时 (秒)
pub const HOUSE_BUILD_TIME_TIER3_TO_4: f32 = 90.0;

/// 0级仓库分品类仓储上限 (各 20.0 单位)
pub const HOUSE_CAPACITY_TIER0: f32 = 20.0;

/// 1级茅草房分品类仓储上限 (各 40.0 单位)
pub const HOUSE_CAPACITY_TIER1: f32 = 40.0;

/// 2级私宅分品类仓储上限 (各 80.0 单位)
pub const HOUSE_CAPACITY_TIER2: f32 = 80.0;

/// 3级庄舍分品类仓储上限 (各 120.0 单位)
pub const HOUSE_CAPACITY_TIER3: f32 = 120.0;

/// 4级大庄园分品类仓储上限 (各 160.0 单位)
pub const HOUSE_CAPACITY_TIER4: f32 = 160.0;

/// 0级仓库升级水粮储备比例要求 (各 90%)
pub const HOUSE_UPGRADE_TIER0_WATER_RATIO: f32 = 0.90;
pub const HOUSE_UPGRADE_TIER0_FOOD_RATIO: f32 = 0.90;

/// 1级茅草房升级木材储备比例要求 (85%)
pub const HOUSE_UPGRADE_TIER1_WOOD_RATIO: f32 = 0.85;
/// 1级茅草房升级水粮保底储备比例要求 (50%)
pub const HOUSE_UPGRADE_TIER1_FOOD_WATER_RATIO: f32 = 0.50;

/// 2级私宅升级石料储备比例要求 (85%)
pub const HOUSE_UPGRADE_TIER2_STONE_RATIO: f32 = 0.85;
/// 2级私宅升级水粮木保底储备比例要求 (50%)
pub const HOUSE_UPGRADE_TIER2_OTHER_RATIO: f32 = 0.50;

/// 3级庄舍升级黄金与石料储备比例要求 (各 85%)
pub const HOUSE_UPGRADE_TIER3_GOLD_STONE_RATIO: f32 = 0.85;
/// 3级庄舍升级水粮木保底储备比例要求 (50%)
pub const HOUSE_UPGRADE_TIER3_OTHER_RATIO: f32 = 0.50;

/// 房屋激活生育支持所需物资比例 (水粮木均 ≥ 50%)
pub const HOUSE_FERTILITY_STOCK_RATIO: f32 = 0.50;

/// 冬季房屋取暖木材燃烧速率 (单位/秒)
pub const HOUSE_WINTER_WOOD_BURN_RATE: f32 = 0.12;

/// 低温触发取暖气温阈值 (°C)
pub const HOUSE_WINTER_COLD_TEMP: f32 = 5.0;

// ============================================================================
// 7. 四季更迭与宏观气候 (Seasons & Macro Climate)
// ============================================================================

/// 完整年轮周期时长 (秒，240 秒一年)
pub const SEASON_YEAR_LENGTH: f32 = 240.0;

/// 单一季度时长 (秒，每季 60 秒)
pub const SEASON_QUARTER_LENGTH: f32 = 60.0;

/// 年均气温基准中值 (°C)
pub const TEMP_BASE_MID: f32 = 14.0;

/// 季节气温波动正弦振幅 (°C，-3°C ~ 31°C)
pub const TEMP_AMPLITUDE: f32 = 17.0;

// ============================================================================
// 8. 空间路网、限速与踩踏演化 (Roads & Wear Evolution)
// ============================================================================

/// 道路自然杂草丛生踩踏衰减速率 (等级/秒)
pub const ROAD_WEAR_DECAY_RATE: f32 = 0.0005;

/// 族人单次通行踩踏增量 (等级/次)
pub const ROAD_WEAR_STEP_INC: f32 = 0.005;

/// 踩踏道路最高等级上限 (5.0)
pub const ROAD_MAX_WEAR: f32 = 5.0;

/// 泥泞小径基准限速 (m/s)
pub const ROAD_SPEED_DIRT_TRACK: f32 = 36.0;

/// 碎石盘山道基准限速 (m/s)
pub const ROAD_SPEED_COBBLESTONE: f32 = 44.0;

/// 沥青主干道基准限速 (m/s)
pub const ROAD_SPEED_ASPHALT_URBAN: f32 = 60.0;

/// 悬空高架快速路基准限速 (m/s)
pub const ROAD_SPEED_SKYWAY_ELEVATED: f32 = 96.0;

/// 走私暗道基准限速 (m/s)
pub const ROAD_SPEED_SMUGGLER_TRAIL: f32 = 40.0;
