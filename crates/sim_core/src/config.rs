//! Flow & Accord 核心仿真超参数集中配置文件 (config.rs)
//!
//! 本文件集中归档并管理全系统所有动力学、生理代谢、生态演化、
//! 房屋营造、马斯洛决策门槛、四季环境与路网踩踏超参数。
//! 仿真超参数完全由前端 JavaScript (frontend/js/config.js) 传入驱动（JS 唯一真相源）。
//!
//! 设计约定：
//! - Rust 仅定义 SimConfig 结构体与字段类型映射，默认值完全来自前端 JS 配置注入。
//! - 前端 `config.js` 必须按 camelCase 键与本结构体字段一一对应（由 `tools/config-check.js` 校验）。

use serde::{Deserialize, Serialize};

// ============================================================================
// 动态仿真配置结构体 (SimConfig)
// ============================================================================

/// 统一动态超参数结构体，支持从前端 JSON 动态反序列化更新
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
    /// ★ v1.47.0 衰弱（风烛残年）健康阈值：健康值 < 此值即视为濒死——
    /// 不再响应储备类需求（b5/b6/b7/b9/b10），饮食优先返家从家户账本解决。
    pub agent_frail_health_threshold: f32,
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
    pub trait_high_threshold: f32,
    pub trait_low_threshold: f32,
    pub trait_strength_load_bonus: f32,
    pub trait_strength_load_penalty: f32,

    // 4. 生态地标与 POI 采收交互
    pub poi_min_distance: f32,
    pub count_camps: usize,
    /// 帝国数量（每个帝国至少辖 1 个营地）
    pub count_empires: usize,
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
    /// ★ v1.47.0 衰弱族人「在家解决饮食」的家户账本余额门槛：
    /// 家户该品类余额 ≥ 此值才派发返家吃喝，余额不足仍按原逻辑外出就源。
    pub decision_home_meal_min_stock: f32,
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
    /// 分支层级覆盖（与 decision_eval_order 下标并行）：
    /// 0=⓪瞬间行为 / 1=①生理 / 2=②安全 / 3=③归属 / 4=④尊重 / 5=⑤自我实现 / 6=保留代码动态默认。
    /// ★ v1.29.0 编码迁移：原「0=保留代码动态默认」改由 6 承担，0 让位给新层级「瞬间行为」。
    /// 非瞬发分支被写成 0 时由 branches.rs::level_override_for 钳制回代码默认层级。
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

    // 7. 地形生成、地表查询与山口 profile
    pub terrain_profile: String,
    pub terrain_ridge_amplitude: f32,
    pub terrain_ridge_width: f32,
    pub terrain_river_width_min: f32,
    pub terrain_river_width_max: f32,
    pub terrain_river_water_level: f32,
    pub terrain_river_bank_width: f32,
    pub terrain_river_terrace_width: f32,
    pub terrain_crossing_width: f32,
    pub terrain_soft_ground_cost: f32,
    pub terrain_shallow_water_cost: f32,

    pub terrain_max_walk_slope: f32,
    pub terrain_max_build_slope: f32,
    pub terrain_footprint_half_extent: f32,
    pub terrain_road_corridor_width: f32,
pub terrain_generation_max_retries: usize,
/// ★ v1.48.0 D-A 装饰系统：装饰密度倍率（0.0=无装饰, 0.5=稀疏, 1.0=默认, 2.0=茂密）
pub terrain_accent_density: f32,
/// ★ v1.48.0 D-B 子特征注入：是否启用子特征注入（山脚湖/瀑布/峭壁等）
pub terrain_accent_sub_features: bool,
/// ★ v1.48.0 D-A 装饰系统：装饰树木是否按季节变色
pub terrain_tree_season_tint: bool,

// 8. 四季更迭与宏观气候
    pub season_year_length: f32,
    pub temp_base_mid: f32,
    pub temp_amplitude: f32,
    pub temp_el_nino_cycle_years: f32,
    pub temp_el_nino_amplitude: f32,
    /// 纪元候波（大世纪极值波动，49年长周期）
    pub temp_climate_epoch_cycle_years: f32,
    pub temp_climate_epoch_amplitude: f32,
    /// 浆果霜冻减产起始气温阈值 (℃)
    pub berry_frost_decline_temp: f32,
    /// 浆果冰封彻底绝收气温阈值 (℃)
    pub berry_frost_zero_temp: f32,

    // 8. 空间路网、限速与踩踏演化
    pub road_wear_decay_rate: f32,
    pub road_wear_step_inc: f32,
    pub road_wear_tier_step: f32,
    pub road_benefit_max_wear: f32,
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
    pub royal_privy_interval_ticks: u64,
    pub royal_privy_rate: f32,
    pub imperial_privy_interval_ticks: u64,
    pub imperial_privy_rate: f32,

    // 13. 外部市场（榷场互市）与幂律动态定价
    pub count_markets: usize,
    pub market_stock_max_water: f32,
    pub market_stock_max_food: f32,
    pub market_stock_max_wood: f32,
    pub market_regen_base_water: f32,
    pub market_regen_base_food: f32,
    pub market_regen_base_wood: f32,
    pub market_price_base: f32,
    pub market_price_power_exponent: f32,
    pub market_price_floor_stock: f32,
    pub market_emergency_family_stock_threshold: f32,
    pub market_min_family_gold: f32,
    pub market_min_dispatch_stamina: f32,
    pub market_settlement_step: f32,
    pub market_wealthy_family_gold: f32,
    pub market_poor_family_gold: f32,

    // 14. 二手房屋市场、营地中介拍卖与麦穗竞价
    pub house_auction_bid_cooldown_ticks: u64,
    pub house_auction_deadline_durability: f32,
    pub house_auction_observation_ratio: f32,
    pub house_auction_min_bid_gold: f32,
    pub house_auction_bid_history_capacity: usize,
    pub house_auction_crown_share_weight: f32,
    pub house_auction_benchmark_decay_rate: f32,
    pub market_price_base_wood: f32,
    pub market_price_base_stone: f32,
}

impl SimConfig {
    /// 一年固定四季，单季长度自动由年轮总时长 1/4 计算派生
    #[inline]
    pub fn season_quarter_length(&self) -> f32 {
        self.season_year_length * 0.25
    }
}
