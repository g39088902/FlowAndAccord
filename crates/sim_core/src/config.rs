//! Flow & Accord 核心仿真超参数集中配置文件 (config.rs)
//!
//! 本文件集中归档并管理全系统所有动力学、生理代谢、生态演化、
//! 房屋营造、马斯洛决策门槛、四季环境与路网踩踏超参数。
//! 支持通过 JSON (serde) 从前端 JavaScript 动态加载或热更新。

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
pub const AGENT_INITIAL_HUNGER: f32 = 25.0;
pub const AGENT_INITIAL_THIRST: f32 = 25.0;
pub const AGENT_INITIAL_STAMINA: f32 = 95.0;
pub const AGENT_BASE_METABOLISM_DECAY: f32 = 0.10;
pub const AGENT_HEALTH_DECAY_PER_SEC: f32 = 0.01;
pub const AGENT_PREGNANT_METABOLISM_MULT: f32 = 1.25;
pub const AGENT_WORK_METABOLISM_MULT: f32 = 1.0;
pub const AGENT_DEATH_DECAY_DURATION: f32 = 12.0;
pub const AGENT_ADULT_AGE: f32 = 1800.0;
pub const AGENT_PREGNANCY_DURATION: f32 = 900.0;
pub const AGENT_MISCARRIAGE_THRESHOLD: f32 = 10.0;
pub const AGENT_MISCARRIAGE_STAMINA_THRESHOLD: f32 = 20.0;
pub const AGENT_MISCARRIAGE_COOLDOWN: f32 = 450.0; // 流产后休养冷却 (秒，期间禁止再次受孕)
pub const AGENT_MISCARRIAGE_ALERT_DURATION: f32 = 5.0;
pub const AGENT_CONCEPTION_HUNGER_MIN: f32 = 40.0;
pub const AGENT_CONCEPTION_THIRST_MIN: f32 = 40.0;
pub const AGENT_CONCEPTION_STAMINA_MIN: f32 = 80.0;
pub const CARRY_CAPACITY_RESOURCE: f32 = 50.0;
pub const AGENT_GOLD_LOAD_FULL: f32 = 20.0;
pub const AGENT_OFFROAD_SPEED_FACTOR: f32 = 0.50;
pub const AGENT_BASE_MOVE_SPEED_MULT: f32 = 4.0;
/// 💪 力量禀赋对步行速度的加成系数: 力量每偏离基准均值 ±100 点，移速相应增减该比例
pub const AGENT_STRENGTH_SPEED_BONUS: f32 = 0.40;
/// 💪 力量移速加成下限倍率 (力量极低者步履蹒跚，最低降至基准速度的 70%)
pub const AGENT_STRENGTH_SPEED_MIN: f32 = 0.70;
/// 💪 力量移速加成上限倍率 (力量极高者健步如飞，最高提升至基准速度的 130%)
pub const AGENT_STRENGTH_SPEED_MAX: f32 = 1.30;
pub const AGENT_STEALTH_VISIBILITY_COVERT: f32 = 0.25;
pub const AGENT_STEALTH_VISIBILITY_NORMAL: f32 = 1.0;

// ============================================================================
// 3. 先天禀赋与遗传演化 (Genetics & Inherited Traits)
// ============================================================================
pub const TRAIT_DEFAULT_MEAN: f32 = 100.0;
pub const TRAIT_INITIAL_STD_DEV: f32 = 20.0;
pub const TRAIT_MUTATION_DELTA: f32 = 10.0;

// ============================================================================
// 4. 生态地标与 POI 采收交互 (POI & Ecology Generation)
// ============================================================================
pub const POI_MIN_DISTANCE: f32 = 70.0;
pub const COUNT_CAMPS: usize = 5;
pub const COUNT_WATER_SOURCES: usize = 6;
pub const COUNT_BERRY_BUSHES: usize = 6;
pub const COUNT_WOODS: usize = 3;
pub const COUNT_STONE_MINES: usize = 2;
pub const COUNT_GOLD_MINES: usize = 1;
pub const STOCK_MAX_WATER: f32 = 100.0;
pub const STOCK_MAX_BERRY: f32 = 100.0;
pub const STOCK_MAX_WOOD: f32 = 100.0;
pub const STOCK_MAX_STONE: f32 = 100.0;
pub const STOCK_MAX_GOLD: f32 = 100.0;
pub const REGEN_BASE_WATER: f32 = 2.0;
pub const REGEN_BASE_BERRY: f32 = 2.0;
pub const REGEN_BASE_WOOD: f32 = 2.0;
pub const REGEN_BASE_STONE: f32 = 2.0;
pub const REGEN_BASE_GOLD: f32 = 1.8;
pub const POI_INTERACTION_RATE_RESOURCE: f32 = 10.0;
pub const POI_INTERACTION_RATE_GOLD: f32 = 5.0;
pub const POI_UNLOAD_RATE_RESOURCE: f32 = 10.0;
pub const POI_UNLOAD_RATE_GOLD: f32 = 5.0;

// ============================================================================
// 5. 马斯洛需求与决策门槛 (Maslow Needs & Decision Thresholds)
// ============================================================================
pub const DECISION_POI_SEEK_MIN_STOCK_RATIO: f32 = 0.30;
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
pub const DECISION_FOUND_HOME_DIST_MIN: f32 = 16.0;
pub const DECISION_FOUND_HOME_DIST_MAX: f32 = 42.0;
pub const DECISION_WORK_STAMINA_THRESHOLD: f32 = 50.0;

// ============================================================================
// 6. 私宅营造、代际传承与升级 (Housing System)
// ============================================================================
pub const HOUSE_DURABILITY_MAX: f32 = 100.0;
pub const HOUSE_DEPRECIATION_RATE: f32 = 0.02;
pub const HOUSE_REPAIR_TRIGGER_THRESHOLD: f32 = 80.0;
pub const HOUSE_REPAIR_SPEED: f32 = 5.0;
pub const HOUSE_BUILD_TIME_TIER0_TO_1: f32 = 30.0;
pub const HOUSE_BUILD_TIME_TIER1_TO_2: f32 = 45.0;
pub const HOUSE_BUILD_TIME_TIER2_TO_3: f32 = 60.0;
pub const HOUSE_BUILD_TIME_TIER3_TO_4: f32 = 90.0;
pub const HOUSE_CAPACITY_TIER0: f32 = 20.0;
pub const HOUSE_CAPACITY_TIER1: f32 = 40.0;
pub const HOUSE_CAPACITY_TIER2: f32 = 80.0;
pub const HOUSE_CAPACITY_TIER3: f32 = 120.0;
pub const HOUSE_CAPACITY_TIER4: f32 = 160.0;
pub const HOUSE_UPGRADE_TIER0_WATER_RATIO: f32 = 0.90;
pub const HOUSE_UPGRADE_TIER0_FOOD_RATIO: f32 = 0.90;
pub const HOUSE_UPGRADE_TIER1_WOOD_RATIO: f32 = 0.85;
pub const HOUSE_UPGRADE_TIER1_FOOD_WATER_RATIO: f32 = 0.50;
pub const HOUSE_UPGRADE_TIER2_STONE_RATIO: f32 = 0.85;
pub const HOUSE_UPGRADE_TIER2_OTHER_RATIO: f32 = 0.50;
pub const HOUSE_UPGRADE_TIER3_GOLD_STONE_RATIO: f32 = 0.85;
pub const HOUSE_UPGRADE_TIER3_OTHER_RATIO: f32 = 0.50;
pub const HOUSE_FERTILITY_STOCK_RATIO: f32 = 0.50;
pub const HOUSE_WINTER_WOOD_BURN_RATE: f32 = 0.12;
pub const HOUSE_WINTER_COLD_TEMP: f32 = 5.0;
pub const HOUSE_MIN_SPACING: f32 = 24.0;
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
/// 道路自然杂草丛生衰减速率 (等级/秒)：已翻倍加速退化，人迹罕至的荒径会更快被植被吞没
pub const ROAD_WEAR_DECAY_RATE: f32 = 0.0010;
pub const ROAD_WEAR_STEP_INC: f32 = 0.005;
pub const ROAD_MAX_WEAR: f32 = 5.0;
pub const ROAD_SPEED_DIRT_TRACK: f32 = 36.0;
pub const ROAD_SPEED_COBBLESTONE: f32 = 44.0;
pub const ROAD_SPEED_ASPHALT_URBAN: f32 = 60.0;
pub const ROAD_SPEED_SKYWAY_ELEVATED: f32 = 96.0;
pub const ROAD_SPEED_SMUGGLER_TRAIL: f32 = 40.0;

// ============================================================================
// 9. 动态仿真配置结构体 (SimConfig)
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
    pub agent_miscarriage_alert_duration: f32,
    pub agent_conception_hunger_min: f32,
    pub agent_conception_thirst_min: f32,
    pub agent_conception_stamina_min: f32,
    pub carry_capacity_resource: f32,
    pub agent_gold_load_full: f32,
    pub agent_offroad_speed_factor: f32,
    pub agent_base_move_speed_mult: f32,
    pub agent_strength_speed_bonus: f32,
    pub agent_strength_speed_min: f32,
    pub agent_strength_speed_max: f32,
    pub agent_stealth_visibility_covert: f32,
    pub agent_stealth_visibility_normal: f32,

    // 3. 先天禀赋与遗传演化
    pub trait_default_mean: f32,
    pub trait_initial_std_dev: f32,
    pub trait_mutation_delta: f32,

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

    // 6. 私宅营造、代际传承与升级
    pub house_durability_max: f32,
    pub house_depreciation_rate: f32,
    pub house_repair_trigger_threshold: f32,
    pub house_repair_speed: f32,
    pub house_build_time_tier0_to_1: f32,
    pub house_build_time_tier1_to_2: f32,
    pub house_build_time_tier2_to_3: f32,
    pub house_build_time_tier3_to_4: f32,
    pub house_capacity_tier0: f32,
    pub house_capacity_tier1: f32,
    pub house_capacity_tier2: f32,
    pub house_capacity_tier3: f32,
    pub house_capacity_tier4: f32,
    pub house_upgrade_tier0_water_ratio: f32,
    pub house_upgrade_tier0_food_ratio: f32,
    pub house_upgrade_tier1_wood_ratio: f32,
    pub house_upgrade_tier1_food_water_ratio: f32,
    pub house_upgrade_tier2_stone_ratio: f32,
    pub house_upgrade_tier2_other_ratio: f32,
    pub house_upgrade_tier3_gold_stone_ratio: f32,
    pub house_upgrade_tier3_other_ratio: f32,
    pub house_fertility_stock_ratio: f32,
    pub house_winter_wood_burn_rate: f32,
    pub house_winter_cold_temp: f32,
    pub house_min_spacing: f32,
    pub house_node_reuse_radius: f32,

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
            agent_miscarriage_alert_duration: AGENT_MISCARRIAGE_ALERT_DURATION,
            agent_conception_hunger_min: AGENT_CONCEPTION_HUNGER_MIN,
            agent_conception_thirst_min: AGENT_CONCEPTION_THIRST_MIN,
            agent_conception_stamina_min: AGENT_CONCEPTION_STAMINA_MIN,
            carry_capacity_resource: CARRY_CAPACITY_RESOURCE,
            agent_gold_load_full: AGENT_GOLD_LOAD_FULL,
            agent_offroad_speed_factor: AGENT_OFFROAD_SPEED_FACTOR,
            agent_base_move_speed_mult: AGENT_BASE_MOVE_SPEED_MULT,
            agent_strength_speed_bonus: AGENT_STRENGTH_SPEED_BONUS,
            agent_strength_speed_min: AGENT_STRENGTH_SPEED_MIN,
            agent_strength_speed_max: AGENT_STRENGTH_SPEED_MAX,
            agent_stealth_visibility_covert: AGENT_STEALTH_VISIBILITY_COVERT,
            agent_stealth_visibility_normal: AGENT_STEALTH_VISIBILITY_NORMAL,

            // 3. 先天禀赋与遗传演化
            trait_default_mean: TRAIT_DEFAULT_MEAN,
            trait_initial_std_dev: TRAIT_INITIAL_STD_DEV,
            trait_mutation_delta: TRAIT_MUTATION_DELTA,

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

            // 6. 私宅营造、代际传承与升级
            house_durability_max: HOUSE_DURABILITY_MAX,
            house_depreciation_rate: HOUSE_DEPRECIATION_RATE,
            house_repair_trigger_threshold: HOUSE_REPAIR_TRIGGER_THRESHOLD,
            house_repair_speed: HOUSE_REPAIR_SPEED,
            house_build_time_tier0_to_1: HOUSE_BUILD_TIME_TIER0_TO_1,
            house_build_time_tier1_to_2: HOUSE_BUILD_TIME_TIER1_TO_2,
            house_build_time_tier2_to_3: HOUSE_BUILD_TIME_TIER2_TO_3,
            house_build_time_tier3_to_4: HOUSE_BUILD_TIME_TIER3_TO_4,
            house_capacity_tier0: HOUSE_CAPACITY_TIER0,
            house_capacity_tier1: HOUSE_CAPACITY_TIER1,
            house_capacity_tier2: HOUSE_CAPACITY_TIER2,
            house_capacity_tier3: HOUSE_CAPACITY_TIER3,
            house_capacity_tier4: HOUSE_CAPACITY_TIER4,
            house_upgrade_tier0_water_ratio: HOUSE_UPGRADE_TIER0_WATER_RATIO,
            house_upgrade_tier0_food_ratio: HOUSE_UPGRADE_TIER0_FOOD_RATIO,
            house_upgrade_tier1_wood_ratio: HOUSE_UPGRADE_TIER1_WOOD_RATIO,
            house_upgrade_tier1_food_water_ratio: HOUSE_UPGRADE_TIER1_FOOD_WATER_RATIO,
            house_upgrade_tier2_stone_ratio: HOUSE_UPGRADE_TIER2_STONE_RATIO,
            house_upgrade_tier2_other_ratio: HOUSE_UPGRADE_TIER2_OTHER_RATIO,
            house_upgrade_tier3_gold_stone_ratio: HOUSE_UPGRADE_TIER3_GOLD_STONE_RATIO,
            house_upgrade_tier3_other_ratio: HOUSE_UPGRADE_TIER3_OTHER_RATIO,
            house_fertility_stock_ratio: HOUSE_FERTILITY_STOCK_RATIO,
            house_winter_wood_burn_rate: HOUSE_WINTER_WOOD_BURN_RATE,
            house_winter_cold_temp: HOUSE_WINTER_COLD_TEMP,
            house_min_spacing: HOUSE_MIN_SPACING,
            house_node_reuse_radius: HOUSE_NODE_REUSE_RADIUS,

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
