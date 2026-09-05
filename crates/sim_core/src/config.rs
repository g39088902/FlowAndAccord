//! Flow & Accord 核心仿真超参数集中配置文件 (config.rs)
//!
//! 本文件集中归档并管理全系统所有动力学、生理代谢、生态演化、
//! 房屋营造、马斯洛决策门槛、四季环境与路网踩踏超参数。
//! 支持通过 JSON (serde) 从前端 JavaScript 动态加载或热更新。
//!
//! 设计约定（避免 magic number）：
//! - 每个可调超参都在本文件拥有「命名 const（默认值唯一真相源）+ SimConfig 字段 + Default 映射」三处一致定义。
//! - 逻辑层一律通过 `self.config.<字段>` 引用，禁止散落字面量；const 仅作 Default 默认值来源。
//! - 前端 `config.js` 必须按 camelCase 键与本结构体字段一一对应（由 `tools/config-check.js` 校验）。

use serde::{Deserialize, Serialize};

// ============================================================================
// 1. 引擎节拍与时间基准 (Simulation Time & Ticks)
// ============================================================================
pub const SIMULATION_DT: f32 = 1.0 / 30.0;
pub const TICKS_PER_SECOND: u64 = 30;
pub const AGENT_DECISION_INTERVAL_TICKS: u64 = 30;

// ============================================================================
// 2. 部落民生理、代谢与生命周期 (Agent Physiology & Lifecycle)
// ============================================================================
pub const AGENT_HUNGER_CAPACITY: f32 = 50.0;
pub const AGENT_THIRST_CAPACITY: f32 = 50.0;
pub const AGENT_INITIAL_HUNGER: f32 = 45.0;
pub const AGENT_INITIAL_THIRST: f32 = 45.0;
pub const AGENT_INITIAL_STAMINA: f32 = 95.0;
pub const AGENT_BASE_METABOLISM_DECAY: f32 = 0.10;
pub const AGENT_HEALTH_DECAY_PER_SEC: f32 = 0.01;
pub const AGENT_PREGNANT_METABOLISM_MULT: f32 = 1.25;
pub const AGENT_WORK_METABOLISM_MULT: f32 = 1.0;
pub const AGENT_DEATH_DECAY_DURATION: f32 = 12.0;
pub const AGENT_ADULT_AGE: f32 = 1800.0;
pub const AGENT_PREGNANCY_DURATION: f32 = 200.0;
pub const AGENT_MISCARRIAGE_THRESHOLD: f32 = 10.0;
pub const AGENT_MISCARRIAGE_STAMINA_THRESHOLD: f32 = 20.0;
pub const AGENT_MISCARRIAGE_COOLDOWN: f32 = 200.0; // 流产后休养冷却 (秒，期间禁止再次受孕)
pub const AGENT_POSTPARTUM_COOLDOWN: f32 = 200.0; // 产后休养冷却 (秒，分娩后期间禁止再次受孕)
pub const AGENT_MISCARRIAGE_ALERT_DURATION: f32 = 5.0;
pub const AGENT_CONCEPTION_HUNGER_MIN: f32 = 40.0;
pub const AGENT_CONCEPTION_THIRST_MIN: f32 = 40.0;
pub const AGENT_CONCEPTION_STAMINA_MIN: f32 = 80.0;
pub const CARRY_CAPACITY_RESOURCE: f32 = 100.0;
pub const AGENT_GOLD_LOAD_FULL: f32 = 20.0;
pub const AGENT_BASE_MOVE_SPEED_MULT: f32 = 4.0;
/// 体力值上限 (%，休息恢复与劳作消耗均 clamp 至此)
pub const AGENT_STAMINA_CAPACITY: f32 = 100.0;
pub const AGENT_STEALTH_VISIBILITY_COVERT: f32 = 0.25;
pub const AGENT_STEALTH_VISIBILITY_NORMAL: f32 = 1.0;
/// 营地/家宅休息时基础体力恢复速率 (单位/秒，乘以睡眠效率比例)
pub const AGENT_REST_STAMINA_RECOVERY_RATE: f32 = 8.0;
/// 修缮房屋时的体力消耗速率 (单位/秒)
/// ★ M6 升级瞬时化：房屋升级不再消耗体力，已删除 agent_construct_stamina_burn
pub const AGENT_REPAIR_STAMINA_BURN: f32 = 2.5;
/// 伐木/采石/淘金时的体力消耗速率 (单位/秒)
pub const AGENT_GATHER_STAMINA_BURN: f32 = 2.0;
/// 劳作（营建/修缮/采集）体力消耗后的最低保留体力下限
pub const AGENT_LABOR_STAMINA_FLOOR: f32 = 5.0;
/// 消化效率影响代谢消耗的系数下限（digest_efficiency/100 的 clamp 下限）
pub const AGENT_DIGESTION_RATIO_MIN: f32 = 0.2;
/// 消化效率影响代谢消耗的系数上限（digest_efficiency/100 的 clamp 上限）
pub const AGENT_DIGESTION_RATIO_MAX: f32 = 5.0;
/// 自饮自食「已满足」判定阈值（≥ 此值视为饱腹/解渴，停止就地进食）
pub const AGENT_SELF_SATISFIED_THRESHOLD: f32 = 49.9;
/// 新生儿初始饱食度
pub const AGENT_NEWBORN_HUNGER: f32 = 25.0;
/// 新生儿初始水分值
pub const AGENT_NEWBORN_THIRST: f32 = 25.0;
/// 新生儿初始体力值 (%)
pub const AGENT_NEWBORN_STAMINA: f32 = 100.0;
/// 每局播撒的初始始祖族人数量（10男10女）
pub const AGENT_SPAWN_COUNT: usize = 20;
/// 每第 N 名始祖设为隐秘特工（i % N == 0）
pub const AGENT_COVERT_EVERY_N: usize = 4;
/// 始祖初始属性随机抖动幅度（± 此值）
pub const AGENT_SPAWN_JITTER: f32 = 10.0;
/// 始祖初始饱食/水分抖动基线（基线 ± 抖动后 clamp）
pub const AGENT_SPAWN_HUNGER_BASE: f32 = 45.0;
pub const AGENT_SPAWN_HUNGER_CLAMP_MIN: f32 = 35.0;
pub const AGENT_SPAWN_HUNGER_CLAMP_MAX: f32 = 50.0;
/// 始祖初始体力抖动基线（基线 ± 抖动后 clamp）
pub const AGENT_SPAWN_STAMINA_BASE: f32 = 90.0;
pub const AGENT_SPAWN_STAMINA_CLAMP_MIN: f32 = 55.0;
pub const AGENT_SPAWN_STAMINA_CLAMP_MAX: f32 = 100.0;
/// 所有 agent 共用的基础默认行走速度（再乘以 agent_base_move_speed_mult 得到共享基准速度）
pub const AGENT_SPAWN_BASE_SPEED: f32 = 8.5;

// ============================================================================
// 3. 先天禀赋与遗传演化 (Genetics & Inherited Traits)
// ============================================================================
pub const TRAIT_DEFAULT_MEAN: f32 = 100.0;
pub const TRAIT_INITIAL_STD_DEV: f32 = 20.0;
pub const TRAIT_MUTATION_DELTA: f32 = 10.0;
/// 遗传继承时单项禀赋的 clamp 下限（防止极端个体）
pub const TRAIT_INHERIT_CLAMP_MIN: f32 = 10.0;
/// 遗传继承时单项禀赋的 clamp 上限
pub const TRAIT_INHERIT_CLAMP_MAX: f32 = 190.0;

// ============================================================================
// 4. 生态地标与 POI 采收交互 (POI & Ecology Generation)
// ============================================================================
pub const POI_MIN_DISTANCE: f32 = 70.0;
pub const COUNT_CAMPS: usize = 4;
pub const CAMP_MAX_HOUSES: u32 = 25;
/// 营地行政级别升级所需的最低房屋数量（村、乡、镇、县）
pub const CAMP_LEVEL_VILLAGE_MIN_HOUSES: u32 = 5;
pub const CAMP_LEVEL_TOWNSHIP_MIN_HOUSES: u32 = 10;
pub const CAMP_LEVEL_TOWN_MIN_HOUSES: u32 = 15;
pub const CAMP_LEVEL_COUNTY_MIN_HOUSES: u32 = 20;
pub const COUNT_WATER_SOURCES: usize = 6;
pub const COUNT_BERRY_BUSHES: usize = 6;
pub const COUNT_WOODS: usize = 3;
pub const COUNT_STONE_MINES: usize = 2;
pub const COUNT_GOLD_MINES: usize = 1;
pub const STOCK_MAX_WATER: f32 = 200.0;
pub const STOCK_MAX_BERRY: f32 = 200.0;
pub const STOCK_MAX_WOOD: f32 = 200.0;
pub const STOCK_MAX_STONE: f32 = 200.0;
pub const STOCK_MAX_GOLD: f32 = 200.0;
pub const REGEN_BASE_WATER: f32 = 2.0;
pub const REGEN_BASE_BERRY: f32 = 2.0;
pub const REGEN_BASE_WOOD: f32 = 2.0;
pub const REGEN_BASE_STONE: f32 = 2.0;
pub const REGEN_BASE_GOLD: f32 = 1.8;
pub const POI_INTERACTION_RATE_RESOURCE: f32 = 10.0;
pub const POI_INTERACTION_RATE_GOLD: f32 = 5.0;
pub const POI_UNLOAD_RATE_RESOURCE: f32 = 10.0;
pub const POI_UNLOAD_RATE_GOLD: f32 = 5.0;
/// 营地撒点半径占半图的比例（越接近 1 越靠边）
pub const POI_SPAWN_RADIUS_CAMP: f32 = 0.70;
/// 资源类 POI 撒点半径占半图的比例
pub const POI_SPAWN_RADIUS_RESOURCE: f32 = 0.80;
/// 紧密撒点回退时的最小间距比例（min_poi_distance × 此值）
pub const POI_SPAWN_FALLBACK_RATIO: f32 = 0.6;
/// 地形过渡节点数量（连接各营地的路网骨架）
pub const COUNT_TERRAIN_TRANSITION_NODES: usize = 17;
/// 地形过渡节点散布范围占半图的比例
pub const POI_SPAWN_SPREAD_RATIO: f32 = 0.85;
/// 路网直连接入的近距阈值（≤ 此距离双向铺装）
pub const ROAD_CONNECT_NEAR_DIST: f32 = 175.0;
/// 路网直连接入的远距阈值（≤ 此距离单向泥径）
pub const ROAD_CONNECT_FAR_DIST: f32 = 320.0;
/// 坡度铺装阈值：高差超过此值铺碎石盘山道，否则泥泞小径
pub const ROAD_GRADE_PAVE_THRESHOLD: f32 = 8.0;
/// 采收现场「已抵达 POI」的判定半径（与 POI 坐标距离 < 此值方可交互）
pub const POI_INTERACTION_RADIUS: f32 = 22.0;
/// 营地/家宅休息时从仓库自饮自食的消耗速率 (单位/秒)
pub const CAMP_HOME_CONSUME_RATE: f32 = 3.0;

// ============================================================================
// 5. 马斯洛需求与决策门槛 (Maslow Needs & Decision Thresholds)
// ============================================================================
pub const DECISION_POI_SEEK_MIN_STOCK_RATIO: f32 = 0.50;
pub const DECISION_POI_ABANDON_STOCK_RATIO: f32 = 0.10;
pub const DECISION_CRITICAL_THIRST: f32 = 25.0;
pub const DECISION_CRITICAL_HUNGER: f32 = 25.0;
pub const DECISION_REST_STAMINA_TARGET: f32 = 100.0;
pub const DECISION_STOCK_GOLD_COOLDOWN: f32 = 45.0;
pub const DECISION_GOLD_WEALTH_COOLDOWN: f32 = 180.0;
pub const DECISION_HOUSE_REPAIR_NEED_THRESHOLD: f32 = 50.0;
pub const DECISION_FOUND_HOME_HUNGER_MIN: f32 = 20.0;
pub const DECISION_FOUND_HOME_THIRST_MIN: f32 = 20.0;
pub const DECISION_FOUND_HOME_STAMINA_MIN: f32 = 60.0;
pub const DECISION_FOUND_HOME_CANDIDATES: usize = 12;
pub const DECISION_FOUND_HOME_DIST_MIN: f32 = 24.0;
pub const DECISION_FOUND_HOME_DIST_MAX: f32 = 80.0;
pub const DECISION_WORK_STAMINA_THRESHOLD: f32 = 50.0;
/// M7 家庭库存施密特触发器：触发下限（家户账本余额低于此值 → 置 ON 去采）
pub const DECISION_FAMILY_STOCK_TRIGGER_ON: f32 = 100.0;
/// M7 家庭库存施密特触发器：结束上限（一旦 ON，余额 ≥ 此值 → 置 OFF 补足）
pub const DECISION_FAMILY_STOCK_TRIGGER_OFF: f32 = 200.0;
/// 求偶发起所需的家户账本最低黄金（严格大于此值）
pub const DECISION_COURTSHIP_MIN_FAMILY_GOLD: f32 = 5.0;

// ============================================================================
// 6. 私宅营造、代际传承与升级 (Housing System)
// ============================================================================
pub const HOUSE_DURABILITY_MAX: f32 = 100.0;
pub const HOUSE_DEPRECIATION_RATE: f32 = 0.02;
pub const HOUSE_REPAIR_TRIGGER_THRESHOLD: f32 = 80.0;
pub const HOUSE_REPAIR_SPEED: f32 = 5.0;
/// ★ M6 房屋升级瞬时化：不再有施工工时，已删除 house_build_time_tier*_to_*
/// ★ M8：以下 14 个字段已删除——升级成本改由下方「M8 材料成本矩阵」20 个字段直接承载，
/// 不再需要 capacity（容量基准）× ratio（比率）推导：
///   house_capacity_tier0..4、house_upgrade_tier{0..3}_*_ratio、house_fertility_stock_ratio

// ----------------------------------------------------------------------------
// ★ M8 房屋升级材料成本矩阵（4 级 × 5 资源，共 20 个超参）
// 语义：`house_upgrade_cost_tierN_*` = 升到 N 级时，该品类一次性扣除的数量。
// 该级不消耗的品类填 0.0（扣账时 `amt > 0.001` 守卫自动跳过；就绪判定 `balance >= amt - 1e-3` 恒成立）。
// 单一真相源：同时供 construction.rs 一次性扣账 与 branches.rs b8/b11 升级就绪判定 使用。
// 行数 = 目标等级：Tier1 行=升到1级(0→1)；Tier2 行=升到2级(1→2)；Tier3 行=升到3级(2→3)；Tier4 行=升到4级(3→4)。
// ----------------------------------------------------------------------------
// 升到 1 级（0→1）：水 50、粮 50（木/石/金不消耗）
pub const HOUSE_UPGRADE_COST_TIER1_WATER: f32 = 50.0;
pub const HOUSE_UPGRADE_COST_TIER1_FOOD: f32 = 50.0;
pub const HOUSE_UPGRADE_COST_TIER1_WOOD: f32 = 0.0;
pub const HOUSE_UPGRADE_COST_TIER1_STONE: f32 = 0.0;
pub const HOUSE_UPGRADE_COST_TIER1_GOLD: f32 = 0.0;
// 升到 2 级（1→2）：木 75、粮 75、水 75（石/金不消耗）
pub const HOUSE_UPGRADE_COST_TIER2_WATER: f32 = 75.0;
pub const HOUSE_UPGRADE_COST_TIER2_FOOD: f32 = 75.0;
pub const HOUSE_UPGRADE_COST_TIER2_WOOD: f32 = 75.0;
pub const HOUSE_UPGRADE_COST_TIER2_STONE: f32 = 0.0;
pub const HOUSE_UPGRADE_COST_TIER2_GOLD: f32 = 0.0;
// 升到 3 级（2→3）：石 100、木 100、粮 100、水 100（金不消耗）
pub const HOUSE_UPGRADE_COST_TIER3_WATER: f32 = 100.0;
pub const HOUSE_UPGRADE_COST_TIER3_FOOD: f32 = 100.0;
pub const HOUSE_UPGRADE_COST_TIER3_WOOD: f32 = 100.0;
pub const HOUSE_UPGRADE_COST_TIER3_STONE: f32 = 100.0;
pub const HOUSE_UPGRADE_COST_TIER3_GOLD: f32 = 0.0;
// 升到 4 级（3→4）：金 125、石 125、木 125、粮 125、水 125（全品类）
pub const HOUSE_UPGRADE_COST_TIER4_WATER: f32 = 125.0;
pub const HOUSE_UPGRADE_COST_TIER4_FOOD: f32 = 125.0;
pub const HOUSE_UPGRADE_COST_TIER4_WOOD: f32 = 125.0;
pub const HOUSE_UPGRADE_COST_TIER4_STONE: f32 = 125.0;
pub const HOUSE_UPGRADE_COST_TIER4_GOLD: f32 = 125.0;

pub const HOUSE_WINTER_WOOD_BURN_RATE: f32 = 0.12;
pub const HOUSE_WINTER_COLD_TEMP: f32 = 5.0;
pub const HOUSE_MIN_SPACING: f32 = 20.0;
/// 立宅时优先复用空置路网节点的检索半径 (m)：候选宅址此半径内若存在空置节点则直接复用，不再新建节点
pub const HOUSE_NODE_REUSE_RADIUS: f32 = 20.0;
/// 判定节点被 POI 自身占用的贴合半径 (m)：小于此距离视为该 POI 的接驳节点，不可当作空置节点复用
pub const HOUSE_NODE_POI_OCCUPY_RADIUS: f32 = 1.5;

// ============================================================================
// 7. 四季更迭与宏观气候 (Seasons & Macro Climate)
// ============================================================================
pub const SEASON_YEAR_LENGTH: f32 = 240.0;
pub const TEMP_BASE_MID: f32 = 14.0;
pub const TEMP_AMPLITUDE: f32 = 17.0;

// ============================================================================
// 8. 空间路网、限速与踩踏演化 (Roads & Wear Evolution)
// ============================================================================
/// 道路自然杂草丛生衰减速率 (%/秒,相对当前磨损的比例衰减)
pub const ROAD_WEAR_DECAY_RATE: f32 = 0.0067;
/// 族人单次通行踩踏增量 (等级/次)；注意：世界实际采用 0.05，const 须与此一致
pub const ROAD_WEAR_STEP_INC: f32 = 0.05;
pub const ROAD_MAX_WEAR: f32 = 5.0;
pub const ROAD_SPEED_DIRT_TRACK: f32 = 36.0;
pub const ROAD_SPEED_COBBLESTONE: f32 = 44.0;
pub const ROAD_SPEED_ASPHALT_URBAN: f32 = 60.0;
pub const ROAD_SPEED_SKYWAY_ELEVATED: f32 = 96.0;
pub const ROAD_SPEED_SMUGGLER_TRAIL: f32 = 40.0;
/// 道路等级影响移速的基准系数 (等级 0 时的速度乘子)
pub const ROAD_LEVEL_FACTOR_BASE: f32 = 0.50;
/// 道路等级影响移速的磨损系数 (每单位 wear 提升的乘子增量)
pub const ROAD_LEVEL_FACTOR_WEAR_COEF: f32 = 0.333;
/// 道路等级影响移速乘子的下限
pub const ROAD_LEVEL_FACTOR_MIN: f32 = 0.50;
/// 道路等级影响移速乘子的上限
pub const ROAD_LEVEL_FACTOR_MAX: f32 = 2.20;

// ============================================================================
// 9. 动力学移动与寻路权重 (Movement & Pathfinding)
// ============================================================================
/// 移动基础体力消耗 (单位/秒)
pub const AGENT_MOVE_STAMINA_BASE: f32 = 0.6;
/// 孕期额外移动体力消耗 (单位/秒)
pub const AGENT_MOVE_STAMINA_PREGNANT: f32 = 0.3;
/// 坡度对移动体力消耗的加成系数
pub const AGENT_MOVE_STAMINA_GRADE_COEF: f32 = 3.5;
/// 移动加速度收敛系数（趋近目标速度的比例）
pub const AGENT_MOVE_ACCEL_COEF: f32 = 4.0;
/// A* 寻路中坡度对通行代价的惩罚系数
pub const ROAD_ASTAR_GRADE_PENALTY_COEF: f32 = 1.5;
/// A* 启发式估算的距离除数（goal 距离 / 此值）
pub const ROAD_ASTAR_HEURISTIC_DIVISOR: f32 = 80.0;
/// A* 偏好隐秘路线时，隐秘道路的代价乘子（越小越优先）
pub const ROAD_HIDDEN_PREFER_MODIFIER: f32 = 0.4;
/// A* 偏好隐秘路线时，公开道路的代价乘子
pub const ROAD_VISIBLE_PREFER_MODIFIER: f32 = 1.2;
/// A* 非偏好隐秘时，隐秘道路的代价乘子（越大越回避）
pub const ROAD_HIDDEN_AVOID_MODIFIER: f32 = 2.5;
/// A* 非偏好隐秘时，公开道路的代价乘子
pub const ROAD_VISIBLE_AVOID_MODIFIER: f32 = 1.0;

// ============================================================================
// 10. 账本与婚姻登记子系统 (Ledger & Marriage Registry)
// ============================================================================
/// 账本流水环形缓冲容量（每账本，条）：超容量淘汰最旧流水，防长程运行内存膨胀
pub const LEDGER_JOURNAL_CAPACITY: usize = 64;

/// 族税率：家户每周期向族库缴纳账面余额的比例（默认 5%）
pub const CLAN_TRIBUTE_RATE: f32 = 0.05;
/// 族税征收周期（tick）：每 N tick 全局统一征收一次（默认 1800 = 60秒）
pub const CLAN_TRIBUTE_INTERVAL_TICKS: u64 = 1800;
/// 族内互助族库最低余额门槛：族库总余额 > 此值方可签发互助（默认 50.0）
pub const CLAN_MUTUAL_AID_MIN_BALANCE: f32 = 50.0;
/// 极贫家庭门槛：家户账面水+粮总额 < 此值视为极贫，可申请族内互助（默认 10.0）
pub const CLAN_MUTUAL_AID_FAMILY_THRESHOLD: f32 = 10.0;
/// 族内互助冷却（tick）：每家户每 N tick 最多接收一次互助（默认 900 = 30秒）
pub const CLAN_MUTUAL_AID_COOLDOWN_TICKS: u64 = 900;
/// 宗族长老（族长）顺位任职威望奖励（默认 +3）
pub const PRESTIGE_CLAN_ELDER_BONUS: u32 = 3;

// ============================================================================
// 10b. 地区与王国系统 (M4: Region & Kingdom)
// ============================================================================
/// 公仓税率：家户每周期向地区公仓缴纳账面余额的比例（默认 3%）
pub const LEDGER_TAX_RATE: f32 = 0.03;
/// 公仓税征收周期（tick）：每 N tick 全局统一征收一次（默认 2400 = 80秒）
pub const LEDGER_TAX_INTERVAL_TICKS: u64 = 2400;
/// 救济公仓最低余额门槛：地区公仓总余额 > 此值方可签发救济（默认 30.0）
pub const LEDGER_RELIEF_MIN_BALANCE: f32 = 30.0;
/// 极贫家庭门槛：家户账面水+粮总额 < 此值视为极贫，可申请救济（默认 8.0）
pub const LEDGER_RELIEF_FAMILY_THRESHOLD: f32 = 8.0;
/// 救济冷却（tick）：每家户每 N tick 最多接收一次救济（默认 1200 = 40秒）
pub const LEDGER_RELIEF_COOLDOWN_TICKS: u64 = 1200;
/// 国王登基任职威望奖励（默认 +3）
pub const PRESTIGE_KING_BONUS: u32 = 3;

// ============================================================================
// 10c. 外部市场（榷场互市）与幂律动态定价 (External Market & Dynamic Pricing)
// ============================================================================
/// 全图生成外部市场 POI 数量（默认 1 座）
pub const COUNT_MARKETS: usize = 1;
/// 外部市场清水储备容量上限（等同于 1 座低洼清泉）
pub const MARKET_STOCK_MAX_WATER: f32 = 200.0;
/// 外部市场粮食储备容量上限（等同于 1 座缓坡浆果）
pub const MARKET_STOCK_MAX_FOOD: f32 = 200.0;
/// 外部市场清水每秒自然再生速率
pub const MARKET_REGEN_BASE_WATER: f32 = 2.0;
/// 外部市场粮食每秒自然再生速率
pub const MARKET_REGEN_BASE_FOOD: f32 = 2.0;
/// 满库存起步基准单价（黄金 / 单位资源）
pub const MARKET_PRICE_BASE: f32 = 0.1;
/// 幂律定价指数 k（越大则低库存时价格飙升越剧烈）
pub const MARKET_PRICE_POWER_EXPONENT: f32 = 2.0;
/// 计价库存钳制下限（防除以零与价格封顶，库存<=此值时单价封顶 1000 金）
pub const MARKET_PRICE_FLOOR_STOCK: f32 = 1.0;
/// 家户物资绝境警戒线（低于该值且野外对应点断流时触发商贸求购）
pub const MARKET_EMERGENCY_FAMILY_STOCK_THRESHOLD: f32 = 10.0;
/// 户主准入起步黄金底线（家户账面黄金低于该值不启动商贸）
pub const MARKET_MIN_FAMILY_GOLD: f32 = 0.5;
/// 户主出发前往市场的最低体力门槛（低于该值不启程，防半路力竭）
pub const MARKET_MIN_DISPATCH_STAMINA: f32 = 15.0;

// ============================================================================
// 14. 二手房屋市场、营地中介拍卖与麦穗竞价 (Housing Market & Auction)
// ============================================================================
/// ★ v1.26.0 买家全局出价冷却（tick，默认 300 = 10 模拟秒）：出价后对任何在售房屋都不再出价
pub const HOUSE_AUCTION_BID_COOLDOWN_TICKS: u64 = 300;
/// 最晚出售修缮度时限（耐久度跌至此值时只要有新报价即成交，默认 10.0%）
pub const HOUSE_AUCTION_DEADLINE_DURABILITY: f32 = 10.0;
/// 麦穗理论最优停止观察期比例（默认 0.37 即 37%）
pub const HOUSE_AUCTION_OBSERVATION_RATIO: f32 = 0.37;
/// ★ v1.26.0 单次出价最低家户黄金门槛（家户账面黄金低于该值不出价，默认 0.01）
pub const HOUSE_AUCTION_MIN_BID_GOLD: f32 = 0.01;
/// ★ v1.26.0 单次拍卖会话报价流水环形缓冲容量（条，默认 128；超容量淘汰最旧）
pub const HOUSE_AUCTION_BID_HISTORY_CAPACITY: usize = 128;
/// ★ v1.26.0 王国公户遗产分账份额权重（与人类受益人同等参与份额制分配，默认 1.0；无人类受益人时独得全额）
pub const HOUSE_AUCTION_CROWN_SHARE_WEIGHT: f32 = 1.0;
/// 木材基准金价（保留：待榷市扩展承载木材后作单价基准，默认 0.15）
pub const MARKET_PRICE_BASE_WOOD: f32 = 0.15;
/// 石料基准金价（保留：待榷市扩展承载石料后作单价基准，默认 0.20）
pub const MARKET_PRICE_BASE_STONE: f32 = 0.20;

// ============================================================================
// 15. 动态仿真配置结构体 (SimConfig)
// ============================================================================

/// 统一动态超参数结构体，支持从前端 JSON 动态反序列化更新
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SimConfig {
    // 1. 引擎节拍与时间基准
    pub simulation_dt: f32,
    pub ticks_per_second: u64,
    pub agent_decision_interval_ticks: u64,

    // 2. 部落民生理、代谢与生命周期
    pub agent_hunger_capacity: f32,
    pub agent_thirst_capacity: f32,
    pub agent_initial_hunger: f32,
    pub agent_initial_thirst: f32,
    pub agent_initial_stamina: f32,
    pub agent_base_metabolism_decay: f32,
    pub agent_health_decay_per_sec: f32,
    pub agent_pregnant_metabolism_mult: f32,
    pub agent_work_metabolism_mult: f32,
    pub agent_death_decay_duration: f32,
    pub agent_adult_age: f32,
    pub agent_pregnancy_duration: f32,
    pub agent_miscarriage_threshold: f32,
    pub agent_miscarriage_stamina_threshold: f32,
    pub agent_miscarriage_cooldown: f32,
    pub agent_postpartum_cooldown: f32,
    pub agent_miscarriage_alert_duration: f32,
    pub agent_conception_hunger_min: f32,
    pub agent_conception_thirst_min: f32,
    pub agent_conception_stamina_min: f32,
    pub carry_capacity_resource: f32,
    pub agent_gold_load_full: f32,
    pub agent_base_move_speed_mult: f32,
    pub agent_stamina_capacity: f32,
    pub agent_stealth_visibility_covert: f32,
    pub agent_stealth_visibility_normal: f32,
    pub agent_rest_stamina_recovery_rate: f32,
    pub agent_repair_stamina_burn: f32,
    pub agent_gather_stamina_burn: f32,
    pub agent_labor_stamina_floor: f32,
    pub agent_digestion_ratio_min: f32,
    pub agent_digestion_ratio_max: f32,
    pub agent_self_satisfied_threshold: f32,
    pub agent_newborn_hunger: f32,
    pub agent_newborn_thirst: f32,
    pub agent_newborn_stamina: f32,
    pub agent_spawn_count: usize,
    pub agent_covert_every_n: usize,
    pub agent_spawn_jitter: f32,
    pub agent_spawn_hunger_base: f32,
    pub agent_spawn_hunger_clamp_min: f32,
    pub agent_spawn_hunger_clamp_max: f32,
    pub agent_spawn_stamina_base: f32,
    pub agent_spawn_stamina_clamp_min: f32,
    pub agent_spawn_stamina_clamp_max: f32,
    pub agent_spawn_base_speed: f32,

    // 3. 先天禀赋与遗传演化
    pub trait_default_mean: f32,
    pub trait_initial_std_dev: f32,
    pub trait_mutation_delta: f32,
    pub trait_inherit_clamp_min: f32,
    pub trait_inherit_clamp_max: f32,

    // 4. 生态地标与 POI 采收交互
    pub poi_min_distance: f32,
    pub count_camps: usize,
    pub count_water_sources: usize,
    pub count_berry_bushes: usize,
    pub count_woods: usize,
    pub count_stone_mines: usize,
    pub count_gold_mines: usize,
    pub stock_max_water: f32,
    pub stock_max_berry: f32,
    pub stock_max_wood: f32,
    pub stock_max_stone: f32,
    pub stock_max_gold: f32,
    pub regen_base_water: f32,
    pub regen_base_berry: f32,
    pub regen_base_wood: f32,
    pub regen_base_stone: f32,
    pub regen_base_gold: f32,
    pub poi_interaction_rate_resource: f32,
    pub poi_interaction_rate_gold: f32,
    pub poi_unload_rate_resource: f32,
    pub poi_unload_rate_gold: f32,
    pub poi_spawn_radius_camp: f32,
    pub poi_spawn_radius_resource: f32,
    pub poi_spawn_fallback_ratio: f32,
    pub count_terrain_transition_nodes: usize,
    pub poi_spawn_spread_ratio: f32,
    pub road_connect_near_dist: f32,
    pub road_connect_far_dist: f32,
    pub road_grade_pave_threshold: f32,
    pub poi_interaction_radius: f32,
    pub camp_home_consume_rate: f32,

    // 5. 马斯洛需求与决策门槛
    pub decision_poi_seek_min_stock_ratio: f32,
    pub decision_poi_abandon_stock_ratio: f32,
    pub decision_critical_thirst: f32,
    pub decision_critical_hunger: f32,
    pub decision_rest_stamina_target: f32,
    pub decision_stock_gold_cooldown: f32,
    pub decision_gold_wealth_cooldown: f32,
    pub decision_house_repair_need_threshold: f32,
    pub decision_found_home_hunger_min: f32,
    pub decision_found_home_thirst_min: f32,
    pub decision_found_home_stamina_min: f32,
    pub decision_found_home_candidates: usize,
    pub decision_found_home_dist_min: f32,
    pub decision_found_home_dist_max: f32,
    pub decision_work_stamina_threshold: f32,
    /// M7 家庭库存施密特触发下限（余额低于此 → 去采）
    pub decision_family_stock_trigger_on: f32,
    /// M7 家庭库存施密特结束上限（ON 后余额达此 → 补足停止）
    pub decision_family_stock_trigger_off: f32,
    pub decision_courtship_min_family_gold: f32,
    /// 决策分支评估顺序（13 个分支 ID，如 "b1".."b13"）。
    /// ⚠️ §4.12 三处规约的文档化例外：Rust 层**无策展顺序**，默认空 Vec = 未注入，
    /// 空/非法时按 branches.rs 声明序中性兜底；权威顺序在前端 `config.decision-order.js`。
    pub decision_eval_order: Vec<String>,
    /// 分支层级覆盖（与 decision_eval_order 下标并行）：0=保留代码动态默认，1-5=强制马斯洛层级。
    /// 默认空 Vec = 全部动态默认。
    pub decision_eval_levels: Vec<u8>,

    // 6. 私宅营造、代际传承与升级
    pub house_durability_max: f32,
    pub house_depreciation_rate: f32,
    pub house_repair_trigger_threshold: f32,
    pub house_repair_speed: f32,
    // ★ M8 房屋升级材料成本矩阵（4 级 × 5 资源；升到 N 级时该品类一次性扣除量，不消耗填 0）
    pub house_upgrade_cost_tier1_water: f32,
    pub house_upgrade_cost_tier1_food: f32,
    pub house_upgrade_cost_tier1_wood: f32,
    pub house_upgrade_cost_tier1_stone: f32,
    pub house_upgrade_cost_tier1_gold: f32,
    pub house_upgrade_cost_tier2_water: f32,
    pub house_upgrade_cost_tier2_food: f32,
    pub house_upgrade_cost_tier2_wood: f32,
    pub house_upgrade_cost_tier2_stone: f32,
    pub house_upgrade_cost_tier2_gold: f32,
    pub house_upgrade_cost_tier3_water: f32,
    pub house_upgrade_cost_tier3_food: f32,
    pub house_upgrade_cost_tier3_wood: f32,
    pub house_upgrade_cost_tier3_stone: f32,
    pub house_upgrade_cost_tier3_gold: f32,
    pub house_upgrade_cost_tier4_water: f32,
    pub house_upgrade_cost_tier4_food: f32,
    pub house_upgrade_cost_tier4_wood: f32,
    pub house_upgrade_cost_tier4_stone: f32,
    pub house_upgrade_cost_tier4_gold: f32,
    pub house_winter_wood_burn_rate: f32,
    pub house_winter_cold_temp: f32,
    pub house_min_spacing: f32,
    pub camp_max_houses: u32,
    pub camp_level_village_min_houses: u32,
    pub camp_level_township_min_houses: u32,
    pub camp_level_town_min_houses: u32,
    pub camp_level_county_min_houses: u32,
    pub house_node_reuse_radius: f32,
    pub house_node_poi_occupy_radius: f32,

    // 7. 四季更迭与宏观气候
    pub season_year_length: f32,
    pub temp_base_mid: f32,
    pub temp_amplitude: f32,

    // 8. 空间路网、限速与踩踏演化
    pub road_wear_decay_rate: f32,
    pub road_wear_step_inc: f32,
    pub road_max_wear: f32,
    pub road_speed_dirt_track: f32,
    pub road_speed_cobblestone: f32,
    pub road_speed_asphalt_urban: f32,
    pub road_speed_skyway_elevated: f32,
    pub road_speed_smuggler_trail: f32,
    pub road_level_factor_base: f32,
    pub road_level_factor_wear_coef: f32,
    pub road_level_factor_min: f32,
    pub road_level_factor_max: f32,

    // 9. 动力学移动与寻路权重
    pub agent_move_stamina_base: f32,
    pub agent_move_stamina_pregnant: f32,
    pub agent_move_stamina_grade_coef: f32,
    pub agent_move_accel_coef: f32,
    pub road_astar_grade_penalty_coef: f32,
    pub road_astar_heuristic_divisor: f32,
    pub road_hidden_prefer_modifier: f32,
    pub road_visible_prefer_modifier: f32,
    pub road_hidden_avoid_modifier: f32,
    pub road_visible_avoid_modifier: f32,

    // 10. 账本与婚姻登记子系统
    pub ledger_journal_capacity: usize,

    // 11. 宗族系统 (M3)
    pub clan_tribute_rate: f32,
    pub clan_tribute_interval_ticks: u64,
    pub clan_mutual_aid_min_balance: f32,
    pub clan_mutual_aid_family_threshold: f32,
    pub clan_mutual_aid_cooldown_ticks: u64,
    pub prestige_clan_elder_bonus: u32,

    // 12. 地区与王国系统 (M4)
    pub ledger_tax_rate: f32,
    pub ledger_tax_interval_ticks: u64,
    pub ledger_relief_min_balance: f32,
    pub ledger_relief_family_threshold: f32,
    pub ledger_relief_cooldown_ticks: u64,
    pub prestige_king_bonus: u32,

    // 13. 外部市场（榷场互市）与幂律动态定价
    pub count_markets: usize,
    pub market_stock_max_water: f32,
    pub market_stock_max_food: f32,
    pub market_regen_base_water: f32,
    pub market_regen_base_food: f32,
    pub market_price_base: f32,
    pub market_price_power_exponent: f32,
    pub market_price_floor_stock: f32,
    pub market_emergency_family_stock_threshold: f32,
    pub market_min_family_gold: f32,
    pub market_min_dispatch_stamina: f32,

    // 14. 二手房屋市场、营地中介拍卖与麦穗竞价
    pub house_auction_bid_cooldown_ticks: u64,
    pub house_auction_deadline_durability: f32,
    pub house_auction_observation_ratio: f32,
    pub house_auction_min_bid_gold: f32,
    pub house_auction_bid_history_capacity: usize,
    pub house_auction_crown_share_weight: f32,
    pub market_price_base_wood: f32,
    pub market_price_base_stone: f32,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            // 1. 引擎节拍与时间基准
            simulation_dt: SIMULATION_DT,
            ticks_per_second: TICKS_PER_SECOND,
            agent_decision_interval_ticks: AGENT_DECISION_INTERVAL_TICKS,

            // 2. 部落民生理、代谢与生命周期
            agent_hunger_capacity: AGENT_HUNGER_CAPACITY,
            agent_thirst_capacity: AGENT_THIRST_CAPACITY,
            agent_initial_hunger: AGENT_INITIAL_HUNGER,
            agent_initial_thirst: AGENT_INITIAL_THIRST,
            agent_initial_stamina: AGENT_INITIAL_STAMINA,
            agent_base_metabolism_decay: AGENT_BASE_METABOLISM_DECAY,
            agent_health_decay_per_sec: AGENT_HEALTH_DECAY_PER_SEC,
            agent_pregnant_metabolism_mult: AGENT_PREGNANT_METABOLISM_MULT,
            agent_work_metabolism_mult: AGENT_WORK_METABOLISM_MULT,
            agent_death_decay_duration: AGENT_DEATH_DECAY_DURATION,
            agent_adult_age: AGENT_ADULT_AGE,
            agent_pregnancy_duration: AGENT_PREGNANCY_DURATION,
            agent_miscarriage_threshold: AGENT_MISCARRIAGE_THRESHOLD,
            agent_miscarriage_stamina_threshold: AGENT_MISCARRIAGE_STAMINA_THRESHOLD,
            agent_miscarriage_cooldown: AGENT_MISCARRIAGE_COOLDOWN,
            agent_postpartum_cooldown: AGENT_POSTPARTUM_COOLDOWN,
            agent_miscarriage_alert_duration: AGENT_MISCARRIAGE_ALERT_DURATION,
            agent_conception_hunger_min: AGENT_CONCEPTION_HUNGER_MIN,
            agent_conception_thirst_min: AGENT_CONCEPTION_THIRST_MIN,
            agent_conception_stamina_min: AGENT_CONCEPTION_STAMINA_MIN,
            carry_capacity_resource: CARRY_CAPACITY_RESOURCE,
            agent_gold_load_full: AGENT_GOLD_LOAD_FULL,
            agent_base_move_speed_mult: AGENT_BASE_MOVE_SPEED_MULT,
            agent_stamina_capacity: AGENT_STAMINA_CAPACITY,
            agent_stealth_visibility_covert: AGENT_STEALTH_VISIBILITY_COVERT,
            agent_stealth_visibility_normal: AGENT_STEALTH_VISIBILITY_NORMAL,
            agent_rest_stamina_recovery_rate: AGENT_REST_STAMINA_RECOVERY_RATE,
            agent_repair_stamina_burn: AGENT_REPAIR_STAMINA_BURN,
            agent_gather_stamina_burn: AGENT_GATHER_STAMINA_BURN,
            agent_labor_stamina_floor: AGENT_LABOR_STAMINA_FLOOR,
            agent_digestion_ratio_min: AGENT_DIGESTION_RATIO_MIN,
            agent_digestion_ratio_max: AGENT_DIGESTION_RATIO_MAX,
            agent_self_satisfied_threshold: AGENT_SELF_SATISFIED_THRESHOLD,
            agent_newborn_hunger: AGENT_NEWBORN_HUNGER,
            agent_newborn_thirst: AGENT_NEWBORN_THIRST,
            agent_newborn_stamina: AGENT_NEWBORN_STAMINA,
            agent_spawn_count: AGENT_SPAWN_COUNT,
            agent_covert_every_n: AGENT_COVERT_EVERY_N,
            agent_spawn_jitter: AGENT_SPAWN_JITTER,
            agent_spawn_hunger_base: AGENT_SPAWN_HUNGER_BASE,
            agent_spawn_hunger_clamp_min: AGENT_SPAWN_HUNGER_CLAMP_MIN,
            agent_spawn_hunger_clamp_max: AGENT_SPAWN_HUNGER_CLAMP_MAX,
            agent_spawn_stamina_base: AGENT_SPAWN_STAMINA_BASE,
            agent_spawn_stamina_clamp_min: AGENT_SPAWN_STAMINA_CLAMP_MIN,
            agent_spawn_stamina_clamp_max: AGENT_SPAWN_STAMINA_CLAMP_MAX,
            agent_spawn_base_speed: AGENT_SPAWN_BASE_SPEED,

            // 3. 先天禀赋与遗传演化
            trait_default_mean: TRAIT_DEFAULT_MEAN,
            trait_initial_std_dev: TRAIT_INITIAL_STD_DEV,
            trait_mutation_delta: TRAIT_MUTATION_DELTA,
            trait_inherit_clamp_min: TRAIT_INHERIT_CLAMP_MIN,
            trait_inherit_clamp_max: TRAIT_INHERIT_CLAMP_MAX,

            // 4. 生态地标与 POI 采收交互
            poi_min_distance: POI_MIN_DISTANCE,
            count_camps: COUNT_CAMPS,
            count_water_sources: COUNT_WATER_SOURCES,
            count_berry_bushes: COUNT_BERRY_BUSHES,
            count_woods: COUNT_WOODS,
            count_stone_mines: COUNT_STONE_MINES,
            count_gold_mines: COUNT_GOLD_MINES,
            stock_max_water: STOCK_MAX_WATER,
            stock_max_berry: STOCK_MAX_BERRY,
            stock_max_wood: STOCK_MAX_WOOD,
            stock_max_stone: STOCK_MAX_STONE,
            stock_max_gold: STOCK_MAX_GOLD,
            regen_base_water: REGEN_BASE_WATER,
            regen_base_berry: REGEN_BASE_BERRY,
            regen_base_wood: REGEN_BASE_WOOD,
            regen_base_stone: REGEN_BASE_STONE,
            regen_base_gold: REGEN_BASE_GOLD,
            poi_interaction_rate_resource: POI_INTERACTION_RATE_RESOURCE,
            poi_interaction_rate_gold: POI_INTERACTION_RATE_GOLD,
            poi_unload_rate_resource: POI_UNLOAD_RATE_RESOURCE,
            poi_unload_rate_gold: POI_UNLOAD_RATE_GOLD,
            poi_spawn_radius_camp: POI_SPAWN_RADIUS_CAMP,
            poi_spawn_radius_resource: POI_SPAWN_RADIUS_RESOURCE,
            poi_spawn_fallback_ratio: POI_SPAWN_FALLBACK_RATIO,
            count_terrain_transition_nodes: COUNT_TERRAIN_TRANSITION_NODES,
            poi_spawn_spread_ratio: POI_SPAWN_SPREAD_RATIO,
            road_connect_near_dist: ROAD_CONNECT_NEAR_DIST,
            road_connect_far_dist: ROAD_CONNECT_FAR_DIST,
            road_grade_pave_threshold: ROAD_GRADE_PAVE_THRESHOLD,
            poi_interaction_radius: POI_INTERACTION_RADIUS,
            camp_home_consume_rate: CAMP_HOME_CONSUME_RATE,

            // 5. 马斯洛需求与决策门槛
            decision_poi_seek_min_stock_ratio: DECISION_POI_SEEK_MIN_STOCK_RATIO,
            decision_poi_abandon_stock_ratio: DECISION_POI_ABANDON_STOCK_RATIO,
            decision_critical_thirst: DECISION_CRITICAL_THIRST,
            decision_critical_hunger: DECISION_CRITICAL_HUNGER,
            decision_rest_stamina_target: DECISION_REST_STAMINA_TARGET,
            decision_stock_gold_cooldown: DECISION_STOCK_GOLD_COOLDOWN,
            decision_gold_wealth_cooldown: DECISION_GOLD_WEALTH_COOLDOWN,
            decision_house_repair_need_threshold: DECISION_HOUSE_REPAIR_NEED_THRESHOLD,
            decision_found_home_hunger_min: DECISION_FOUND_HOME_HUNGER_MIN,
            decision_found_home_thirst_min: DECISION_FOUND_HOME_THIRST_MIN,
            decision_found_home_stamina_min: DECISION_FOUND_HOME_STAMINA_MIN,
            decision_found_home_candidates: DECISION_FOUND_HOME_CANDIDATES,
            decision_found_home_dist_min: DECISION_FOUND_HOME_DIST_MIN,
            decision_found_home_dist_max: DECISION_FOUND_HOME_DIST_MAX,
            decision_work_stamina_threshold: DECISION_WORK_STAMINA_THRESHOLD,
            decision_family_stock_trigger_on: DECISION_FAMILY_STOCK_TRIGGER_ON,
            decision_family_stock_trigger_off: DECISION_FAMILY_STOCK_TRIGGER_OFF,
            decision_courtship_min_family_gold: DECISION_COURTSHIP_MIN_FAMILY_GOLD,
            // Rust 无策展顺序：空 = 未注入（中性兜底），权威值在前端 config.decision-order.js
            decision_eval_order: Vec::new(),
            decision_eval_levels: Vec::new(),

            // 6. 私宅营造、代际传承与升级
            house_durability_max: HOUSE_DURABILITY_MAX,
            house_depreciation_rate: HOUSE_DEPRECIATION_RATE,
            house_repair_trigger_threshold: HOUSE_REPAIR_TRIGGER_THRESHOLD,
            house_repair_speed: HOUSE_REPAIR_SPEED,
            house_upgrade_cost_tier1_water: HOUSE_UPGRADE_COST_TIER1_WATER,
            house_upgrade_cost_tier1_food: HOUSE_UPGRADE_COST_TIER1_FOOD,
            house_upgrade_cost_tier1_wood: HOUSE_UPGRADE_COST_TIER1_WOOD,
            house_upgrade_cost_tier1_stone: HOUSE_UPGRADE_COST_TIER1_STONE,
            house_upgrade_cost_tier1_gold: HOUSE_UPGRADE_COST_TIER1_GOLD,
            house_upgrade_cost_tier2_water: HOUSE_UPGRADE_COST_TIER2_WATER,
            house_upgrade_cost_tier2_food: HOUSE_UPGRADE_COST_TIER2_FOOD,
            house_upgrade_cost_tier2_wood: HOUSE_UPGRADE_COST_TIER2_WOOD,
            house_upgrade_cost_tier2_stone: HOUSE_UPGRADE_COST_TIER2_STONE,
            house_upgrade_cost_tier2_gold: HOUSE_UPGRADE_COST_TIER2_GOLD,
            house_upgrade_cost_tier3_water: HOUSE_UPGRADE_COST_TIER3_WATER,
            house_upgrade_cost_tier3_food: HOUSE_UPGRADE_COST_TIER3_FOOD,
            house_upgrade_cost_tier3_wood: HOUSE_UPGRADE_COST_TIER3_WOOD,
            house_upgrade_cost_tier3_stone: HOUSE_UPGRADE_COST_TIER3_STONE,
            house_upgrade_cost_tier3_gold: HOUSE_UPGRADE_COST_TIER3_GOLD,
            house_upgrade_cost_tier4_water: HOUSE_UPGRADE_COST_TIER4_WATER,
            house_upgrade_cost_tier4_food: HOUSE_UPGRADE_COST_TIER4_FOOD,
            house_upgrade_cost_tier4_wood: HOUSE_UPGRADE_COST_TIER4_WOOD,
            house_upgrade_cost_tier4_stone: HOUSE_UPGRADE_COST_TIER4_STONE,
            house_upgrade_cost_tier4_gold: HOUSE_UPGRADE_COST_TIER4_GOLD,
            house_winter_wood_burn_rate: HOUSE_WINTER_WOOD_BURN_RATE,
            house_winter_cold_temp: HOUSE_WINTER_COLD_TEMP,
            house_min_spacing: HOUSE_MIN_SPACING,
            camp_max_houses: CAMP_MAX_HOUSES,
            camp_level_village_min_houses: CAMP_LEVEL_VILLAGE_MIN_HOUSES,
            camp_level_township_min_houses: CAMP_LEVEL_TOWNSHIP_MIN_HOUSES,
            camp_level_town_min_houses: CAMP_LEVEL_TOWN_MIN_HOUSES,
            camp_level_county_min_houses: CAMP_LEVEL_COUNTY_MIN_HOUSES,
            house_node_reuse_radius: HOUSE_NODE_REUSE_RADIUS,
            house_node_poi_occupy_radius: HOUSE_NODE_POI_OCCUPY_RADIUS,

            // 7. 四季更迭与宏观气候
            season_year_length: SEASON_YEAR_LENGTH,
            temp_base_mid: TEMP_BASE_MID,
            temp_amplitude: TEMP_AMPLITUDE,

            // 8. 空间路网、限速与踩踏演化
            road_wear_decay_rate: ROAD_WEAR_DECAY_RATE,
            road_wear_step_inc: ROAD_WEAR_STEP_INC,
            road_max_wear: ROAD_MAX_WEAR,
            road_speed_dirt_track: ROAD_SPEED_DIRT_TRACK,
            road_speed_cobblestone: ROAD_SPEED_COBBLESTONE,
            road_speed_asphalt_urban: ROAD_SPEED_ASPHALT_URBAN,
            road_speed_skyway_elevated: ROAD_SPEED_SKYWAY_ELEVATED,
            road_speed_smuggler_trail: ROAD_SPEED_SMUGGLER_TRAIL,
            road_level_factor_base: ROAD_LEVEL_FACTOR_BASE,
            road_level_factor_wear_coef: ROAD_LEVEL_FACTOR_WEAR_COEF,
            road_level_factor_min: ROAD_LEVEL_FACTOR_MIN,
            road_level_factor_max: ROAD_LEVEL_FACTOR_MAX,

            // 9. 动力学移动与寻路权重
            agent_move_stamina_base: AGENT_MOVE_STAMINA_BASE,
            agent_move_stamina_pregnant: AGENT_MOVE_STAMINA_PREGNANT,
            agent_move_stamina_grade_coef: AGENT_MOVE_STAMINA_GRADE_COEF,
            agent_move_accel_coef: AGENT_MOVE_ACCEL_COEF,
            road_astar_grade_penalty_coef: ROAD_ASTAR_GRADE_PENALTY_COEF,
            road_astar_heuristic_divisor: ROAD_ASTAR_HEURISTIC_DIVISOR,
            road_hidden_prefer_modifier: ROAD_HIDDEN_PREFER_MODIFIER,
            road_visible_prefer_modifier: ROAD_VISIBLE_PREFER_MODIFIER,
            road_hidden_avoid_modifier: ROAD_HIDDEN_AVOID_MODIFIER,
            road_visible_avoid_modifier: ROAD_VISIBLE_AVOID_MODIFIER,

            // 10. 账本与婚姻登记子系统
            ledger_journal_capacity: LEDGER_JOURNAL_CAPACITY,

            // 11. 宗族系统 (M3)
            clan_tribute_rate: CLAN_TRIBUTE_RATE,
            clan_tribute_interval_ticks: CLAN_TRIBUTE_INTERVAL_TICKS,
            clan_mutual_aid_min_balance: CLAN_MUTUAL_AID_MIN_BALANCE,
            clan_mutual_aid_family_threshold: CLAN_MUTUAL_AID_FAMILY_THRESHOLD,
            clan_mutual_aid_cooldown_ticks: CLAN_MUTUAL_AID_COOLDOWN_TICKS,
            prestige_clan_elder_bonus: PRESTIGE_CLAN_ELDER_BONUS,

            // 12. 地区与王国系统 (M4)
            ledger_tax_rate: LEDGER_TAX_RATE,
            ledger_tax_interval_ticks: LEDGER_TAX_INTERVAL_TICKS,
            ledger_relief_min_balance: LEDGER_RELIEF_MIN_BALANCE,
            ledger_relief_family_threshold: LEDGER_RELIEF_FAMILY_THRESHOLD,
            ledger_relief_cooldown_ticks: LEDGER_RELIEF_COOLDOWN_TICKS,
            prestige_king_bonus: PRESTIGE_KING_BONUS,

            // 13. 外部市场（榷场互市）与幂律动态定价
            count_markets: COUNT_MARKETS,
            market_stock_max_water: MARKET_STOCK_MAX_WATER,
            market_stock_max_food: MARKET_STOCK_MAX_FOOD,
            market_regen_base_water: MARKET_REGEN_BASE_WATER,
            market_regen_base_food: MARKET_REGEN_BASE_FOOD,
            market_price_base: MARKET_PRICE_BASE,
            market_price_power_exponent: MARKET_PRICE_POWER_EXPONENT,
            market_price_floor_stock: MARKET_PRICE_FLOOR_STOCK,
            market_emergency_family_stock_threshold: MARKET_EMERGENCY_FAMILY_STOCK_THRESHOLD,
            market_min_family_gold: MARKET_MIN_FAMILY_GOLD,
            market_min_dispatch_stamina: MARKET_MIN_DISPATCH_STAMINA,

            // 14. 二手房屋市场、营地中介拍卖与麦穗竞价
            house_auction_bid_cooldown_ticks: HOUSE_AUCTION_BID_COOLDOWN_TICKS,
            house_auction_deadline_durability: HOUSE_AUCTION_DEADLINE_DURABILITY,
            house_auction_observation_ratio: HOUSE_AUCTION_OBSERVATION_RATIO,
            house_auction_min_bid_gold: HOUSE_AUCTION_MIN_BID_GOLD,
            house_auction_bid_history_capacity: HOUSE_AUCTION_BID_HISTORY_CAPACITY,
            house_auction_crown_share_weight: HOUSE_AUCTION_CROWN_SHARE_WEIGHT,
            market_price_base_wood: MARKET_PRICE_BASE_WOOD,
            market_price_base_stone: MARKET_PRICE_BASE_STONE,
        }
    }
}

impl SimConfig {
    /// 一年固定四季，单季长度自动由年轮总时长 1/4 计算派生
    #[inline]
    pub fn season_quarter_length(&self) -> f32 {
        self.season_year_length * 0.25
    }
}
