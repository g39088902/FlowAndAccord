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
    /// ★ v1.50.19：地形栅格分辨率（每边格数），全项目分辨率的单一真相源。
    /// `world_create(grid_res = 0, …)` 时内核回落到本值；调用方传非 0 值可显式覆盖（仅供测试）。
    /// ⚠️ 改动本值会改变网格步长（world_size / (res-1)）、地形形态、POI 落位与全部确定性基线，
    /// 并使旧存档因 `SAVE_APP_VERSION` 变更而废弃——调整后必须重跑全量门禁与性能基准。
    pub terrain_grid_res: usize,
    pub terrain_profile: String,
    pub terrain_ridge_amplitude: f32,
    /// ★ v1.50.17 T1-R：T1 山口聚落主脊高斯半宽 (m)。
    /// 通行力约束：主脊最大梯度 ≈ 0.858 × `terrain_pass_ridge_amplitude` / 本值，
    /// 必须显著大于 tan(`terrain_max_walk_slope`)，否则主脊不产生绕行代价（docs/22 §9.3.1）。
    pub terrain_pass_ridge_width: f32,
    /// ★ v1.50.17 T1-R：T1 山口聚落主脊幅度 (m)。
    pub terrain_pass_ridge_amplitude: f32,
    /// ★ TB-01-5：多尺度 fBm 噪声基础振幅 (m)。Octave 0（宏观次级丘陵）基准；
    /// Octave 1/2 按固定比例 0.43/0.145 跟随。默认 6.0。
    pub terrain_noise_amplitude: f32,
    /// ★ TB-01-5：fBm 宏观基础波长 (m)。Octave 0 基准；Octave 1/2 按固定比例
    /// 0.36/0.125 跟随（默认 300 → λ 300/108/37.5m）。默认 300.0。
    pub terrain_noise_scale_base: f32,
    /// ★ TB-01-5：支脊生成总开关（T1 山口 profile）。false = 不生成支脊，
    /// `relief_rng` 消费序在鞍部宽度后即止（确定性不破坏，仅同种子地形不同）。
    pub terrain_branch_ridge_enabled: bool,
    /// ★ TB-01-5：支脊与主脊的振幅比中值。每条支脊实际取
    /// 本值 × [0.85, 1.15] 均匀抖动（默认 0.48 → 0.408~0.552，规格 0.40~0.55）。
    pub terrain_branch_ridge_amplitude_ratio: f32,
    /// ★ TB-01-5：支脊基础延伸长度 (m)。每条支脊实际取
    /// 本值 × [0.8, 1.2] 均匀抖动（默认 150 → 120~180，规格区间）。
    pub terrain_branch_ridge_length: f32,
    // ── ★ S7-08 阶段七 3 个静态 profile 参数集中化（06号 §4.1/§4.2/§4.3）。
    //    全部默认值 = 参数化前的 terrain.rs/hydrology.rs 形态常数（输出逐位不变）；
    //    唯一真相源 = 前端 config.js。改任一值等于换图（同种子形态漂移），遵循
    //    生成器版本契约——仅在需要隔离旧世界时递增 TERRAIN_GENERATOR_VERSION。──
    /// ★ S7-02 平地草原：孤立残丘高斯幅度抽样下限 (m)。默认 6.5（规格 A∈[6.5,9.5]，
    /// A/R∈[0.19,0.31] → 峰值坡度 ≈9.3°~14.9°，叠加低幅波动后严格 <18° 无通行障碍）。
    pub terrain_grassland_mound_amp_min: f32,
    /// ★ S7-02 平地草原：孤立残丘高斯幅度抽样上限 (m)。默认 9.5。
    pub terrain_grassland_mound_amp_max: f32,
    /// ★ S7-02 平地草原：残丘 幅度/半径比（决定峰值坡度 ≈0.858×A/R）抽样下限。默认 0.19。
    pub terrain_grassland_mound_ratio_min: f32,
    /// ★ S7-02 平地草原：残丘 幅度/半径比 抽样上限。默认 0.31（比值过大会把残丘
    /// 推成通行障碍，与「低障碍模板」定位冲突——06号 §4.1 约束③）。
    pub terrain_grassland_mound_ratio_max: f32,
    /// ★ S7-02/S7-04 共用：泉溪洼地深度抽样下限 (m)。默认 1.4（草原/半坡各 2 处
    /// 坡脚泉溪洼地，锚点吸附局部最低格）。
    pub terrain_spring_depression_depth_min: f32,
    /// ★ S7-02/S7-04 共用：泉溪洼地深度抽样上限 (m)。默认 2.2。
    pub terrain_spring_depression_depth_max: f32,
    /// ★ S7-02/S7-04 共用：泉溪洼地凹圈半径抽样下限 (m)。默认 24.0
    /// （凹圈 0.7R~1.5R 写 `SoftGround`，盆心 `DryGround`）。
    pub terrain_spring_depression_radius_min: f32,
    /// ★ S7-02/S7-04 共用：泉溪洼地凹圈半径抽样上限 (m)。默认 34.0。
    pub terrain_spring_depression_radius_max: f32,
    /// ★ S7-04 半坡林地：fBm 噪声增益阻尼系数（×0.6）。半坡坡面上的噪声局部梯度
    /// 会把 max_slope 逐种子方差推到 ±2° 以上、压穿门禁窗口（22°~28.5°）——
    /// 用阻尼换窗口余量；其余 profile ×1.0 逐位不变。
    pub terrain_hillside_noise_damp: f32,
    /// ★ S7-04 半坡林地：不对称高斯主坡幅度抽样下限 (m)。默认 26.0。
    pub terrain_hillside_amp_min: f32,
    /// ★ S7-04 半坡林地：不对称高斯主坡幅度抽样上限 (m)。默认 32.0（幅度过大会
    /// 使背风坡峰值 >28.5° 探针窗上限——06号 §4.2 约束①）。
    pub terrain_hillside_amp_max: f32,
    /// ★ S7-04 半坡林地：背风坡目标峰值坡度抽样下限 (度)。默认 23.0
    /// （高斯峰值梯度 e^(-0.5)×A/W，以目标坡度反解宽度）。
    pub terrain_hillside_lee_slope_min: f32,
    /// ★ S7-04 半坡林地：背风坡目标峰值坡度抽样上限 (度)。默认 23.2（区间收紧是
    /// S7-04 实测校准结果：叠加 fBm/倾斜后全域 max_slope 落入 22°~28.5° 门禁窗）。
    pub terrain_hillside_lee_slope_max: f32,
    /// ★ S7-04 半坡林地：迎风坡目标峰值坡度抽样下限 (度)。默认 8.0（宽缓可建）。
    pub terrain_hillside_wind_slope_min: f32,
    /// ★ S7-04 半坡林地：迎风坡目标峰值坡度抽样上限 (度)。默认 12.0
    /// （目标 <14°，图心落迎风坡脚 <10° 可建带）。
    pub terrain_hillside_wind_slope_max: f32,
    /// ★ S7-04 半坡林地：脊线横移比例抽样下限（× world）。默认 0.18
    /// （crest_shift 把脊线推离图心，陡峭带远离初始营地）。
    pub terrain_hillside_crest_shift_min: f32,
    /// ★ S7-04 半坡林地：脊线横移比例抽样上限（× world）。默认 0.30。
    pub terrain_hillside_crest_shift_max: f32,
    /// ★ TB-02 台地：台面最小抬升高度 (m)。默认 18.0。
    pub terrain_plateau_height_min: f32,
    /// ★ TB-02 台地：台面最大抬升高度 (m)。默认 26.0。
    pub terrain_plateau_height_max: f32,
    /// ★ TB-02 台地：台面半宽相对世界尺寸比例。默认 0.22。
    pub terrain_plateau_half_width_ratio: f32,
    /// ★ TB-02 台地：台面半深相对世界尺寸比例。默认 0.18。
    pub terrain_plateau_half_depth_ratio: f32,
    /// ★ TB-02 台地：台面圆角相对最小半尺寸比例。默认 0.35。
    pub terrain_plateau_corner_radius_ratio: f32,
    /// ★ TB-02 台地：普通台缘过渡带宽度对高差比率（B_edge = ratio * H）。默认 0.6。
    pub terrain_plateau_edge_band_ratio: f32,
    /// ★ TB-02 台地：入口缓坡过渡带宽度对高差比率（B_ramp = ratio * H）。默认 4.0。
    pub terrain_plateau_ramp_band_ratio: f32,
    /// ★ TB-02 台地：缓坡核心横向宽度 (m)。默认 36.0 (>= 32m)。
    pub terrain_plateau_ramp_width: f32,
    /// ★ TB-02 台地：缓坡肩部横向过渡宽度 (m)。默认 24.0。
    pub terrain_plateau_ramp_shoulder_width: f32,
    /// ★ TB-02 台地：台面区域噪声阻尼增益。默认 0.20。
    pub terrain_plateau_top_noise_gain: f32,
    /// ★ TB-02 台地：缓坡入口区域噪声阻尼增益。默认 0.12。
    pub terrain_plateau_ramp_noise_gain: f32,
    /// ★ TB-02 台地：台缘轮廓低频扰动幅度 (m)。默认 6.0。
    pub terrain_plateau_outline_warp: f32,
    // ── ★ TB-03 盆地 / 山前冲积扇 / 湖畔盆地模板参数（仅对应 profile 消费；
    //    默认值唯一真相源 = 前端 config.js；改任一值等于换图，遵循
    //    TERRAIN_GENERATOR_VERSION 契约）──
    /// ★ TB-03 山前冲积扇：扇体长度比例（× world_size，山口→扇缘）。默认 0.58
    /// （v1.50.68 辨识度改善：扇面 >2m 增量覆盖 ≈15.5%，原 0.42 仅 ≈9%）。
    pub terrain_fan_length_ratio: f32,
    /// ★ TB-03 山前冲积扇：扇半角（度，角向窗口 ±α）。默认 38.0（v1.50.68 扩角）。
    pub terrain_fan_half_angle_deg: f32,
    /// ★ TB-03 山前冲积扇：山口到扇缘总高差 (m)。默认 52.0（v1.50.68 提升，
    /// 双段凸形径向剖面：扇头 0~0.2L 陡段 ≈10° 形成山口堆 + 其后缓段 ≤6°；
    /// 扇头侧缘配合 `MIN_ANG_EDGE_M=150` 横向梯度 ≤ tan(19°)，不产生横贯扇面
    /// 的硬禁行墙）。
    pub terrain_fan_amplitude: f32,
    /// ★ TB-03 山前冲积扇：干浅沟数量上限（v1.50.68 起 3~4 均匀掷，放射沟系）。默认 4。
    pub terrain_fan_gully_count_max: u32,
    /// ★ TB-03 山前冲积扇：干浅沟最大深度 (m)。默认 4.5（v1.50.68 提升，≥0.6 格
    /// 目视可辨；沟内 DryGround+NO_BUILD 色差带，可慢行；叠加扇面坡度后横向
    /// 梯度 < 30°，不产生硬禁行）。
    pub terrain_fan_gully_depth_m: f32,
    /// ★ TB-03 山前冲积扇：干浅沟横截面全宽 (m)。默认 22.0（须跨越多个格子）。
    pub terrain_fan_gully_width_m: f32,
    /// ★ TB-03 山前冲积扇：干浅沟中心线角向蜿蜒幅度（弧度）。默认 0.12。
    pub terrain_fan_gully_meander_amp_rad: f32,
    /// ★ TB-03 山前冲积扇：粒度分带——扇顶砾石带外缘（t = r/L）。默认 0.32
    /// （v1.50.68 新增；带内 DryGround + 肥力折减）。
    pub terrain_fan_top_band_ratio: f32,
    /// ★ TB-03 山前冲积扇：粒度分带——扇缘沃土带内缘（t = r/L）。默认 0.68
    /// （v1.50.68 新增；带内肥力 ×1.10 后 clamp）。
    pub terrain_fan_edge_band_ratio: f32,
    /// ★ TB-03 山前冲积扇：粒度分带——扇顶带肥力折减系数。默认 0.75
    /// （v1.50.68 新增；干燥低肥命中裸岩 accents，扇顶粗颗粒意象）。
    pub terrain_fan_top_fertility_scale: f32,
    /// ★ TB-03 盆地：盆地半轴比例（× world_size，椭圆 a/b 共用基准，广阔平坦盆底）。默认 0.42。
    pub terrain_basin_semi_axis_ratio: f32,
    /// ★ TB-03 盆地：盆深 (m，中心相对盆底起伏基准下凹总量)。默认 18.0。
    pub terrain_basin_depth_m: f32,
    /// ★ TB-03 盆地：外缘高耸山体基底高度 (m)。默认 42.0（雄峻环抱高山，出口处受控归低）。
    pub terrain_basin_rim_height_m: f32,
    /// ★ TB-03 盆地：陆路出口角宽（度，出口走廊在盆地轮廓上的角向全宽）。默认 38.0。
    pub terrain_basin_exit_width_deg: f32,
    /// ★ TB-03 盆地：盆底/盆壁噪声阻尼增益。默认 0.30（出口与盆底生活带噪声受额外抑制）。
    pub terrain_basin_noise_gain: f32,
    /// ★ TB-03 湖畔盆地：湖半轴比例抽样下限（× world_size）。默认 0.10。
    pub terrain_lake_semi_axis_ratio_min: f32,
    /// ★ TB-03 湖畔盆地：湖半轴比例抽样上限。默认 0.16（椭圆两轴各自独立抽样）。
    pub terrain_lake_semi_axis_ratio_max: f32,
    /// ★ TB-03 湖畔盆地：湖床最大深度 (m)。默认 3.5（静水湖，水位恒定）。
    pub terrain_lake_depth_m: f32,
    /// ★ TB-03 湖畔盆地：水岸安全退距 (m)。默认 10.0（岸线外 NO_BUILD 缓冲，其外才是可建干岸）。
    pub terrain_lake_shore_setback_m: f32,
    /// ★ TB-03 湖畔盆地：湖岸低频径向扰动幅度 (m)。默认 14.0（限制凹度、不生成岛屿）。
    pub terrain_lake_outline_warp_m: f32,
    /// ★ TB-03 湖畔盆地：环岸噪声阻尼增益。默认 0.30（环岸干岸带平缓可建）。
    pub terrain_lake_noise_gain: f32,
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
    /// ★ v1.48.0 D-A 装饰系统：装饰密度倍率（0.0=无装饰, 0.5=稀疏, 1.0=默认, 2.0=茂密）
    pub terrain_accent_density: f32,
    /// ★ D-B1（06号 §5.3）：子特征注入总开关（山脚湖/山涧飞瀑/河谷峭壁等）。
    /// 唯一消费点 = `geo/hydrology.rs::generate_with_config` 的 §5.3 第 4–5、9 步空钩子门控；
    /// 阶段一钩子为空操作（开关两态下世界输出逐字节等价），选择器实现属 D-B1-3、完整阶段化流水线属阶段二。
    pub terrain_accent_sub_features: bool,
    /// ★ STAGE2-1（06号 R.5 / §5.8 / §18.2）：创世有界重试上限。
    /// 语义 = 初始创世失败（静态几何校验/生存诊断）时，阶梯降级重试的最大次数
    /// （0 = 只尝试一次；默认 3，唯一真相源 = 前端 config.js）。消费点 =
    /// `spatial/creation_fallback.rs::new_seeded_with_config_bounded` 有界降级环
    /// （★ STAGE2-5 落地：入口钳制 ≤8 + 阶梯降级 + 策略去重 + 诊断记录）。
    pub terrain_generation_max_retries: u32,

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

    // 15. 四轴十一激素系统 · 动力学首批超参 (H-01 / H-02 / H-03)
    pub hormone_da_baseline: f32,
    pub hormone_da_threshold_baseline: f32,
    pub hormone_5ht_baseline: f32,
    pub hormone_ep_baseline: f32,
    pub hormone_ot_baseline: f32,
    pub hormone_cort_baseline: f32,
    pub hormone_adr_baseline: f32,
    pub hormone_ne_baseline: f32,
    pub hormone_and_male_baseline: f32,
    pub hormone_and_female_baseline: f32,
    pub hormone_est_female_baseline: f32,
    pub hormone_est_other_baseline: f32,
    pub hormone_est_menopause_age: f32,
    pub hormone_prog_pregnant_baseline: f32,
    pub hormone_prog_non_pregnant_baseline: f32,
    pub hormone_thy_baseline: f32,

    pub hormone_da_decay: f32,
    pub hormone_da_threshold_decay: f32,
    pub hormone_da_threshold_drift_ratio: f32,
    pub hormone_5ht_decay: f32,
    pub hormone_ep_decay: f32,
    pub hormone_ot_decay: f32,
    pub hormone_cort_decay: f32,
    pub hormone_adr_decay: f32,
    pub hormone_ne_decay: f32,
    pub hormone_and_decay: f32,
    pub hormone_est_decay: f32,
    pub hormone_prog_decay: f32,
    pub hormone_thy_decay: f32,

    pub hormone_pulse_upgrade_da: f32,
    pub hormone_pulse_marriage_da: f32,
    pub hormone_pulse_marriage_ot: f32,
    pub hormone_pulse_marriage_5ht: f32,
    pub hormone_pulse_conception_prog: f32,
    pub hormone_pulse_miscarriage_cort: f32,
    pub hormone_pulse_birth_mother_ot: f32,
    pub hormone_pulse_birth_mother_da: f32,
    pub hormone_pulse_birth_father_ot: f32,
    pub hormone_pulse_birth_father_da: f32,
    pub hormone_pulse_coronation_da: f32,
    pub hormone_pulse_coronation_and: f32,
    pub hormone_pulse_coronation_5ht: f32,
    pub hormone_pulse_bag_full_da: f32,
    pub hormone_pulse_meal_da: f32,
    pub hormone_pulse_unload_da: f32,
    pub hormone_pulse_full_stamina_5ht: f32,
    pub hormone_pulse_full_stamina_da: f32,
    pub hormone_pulse_bereavement_spouse_cort: f32,
    pub hormone_pulse_bereavement_spouse_ot_crash: f32,
    pub hormone_pulse_bereavement_spouse_5ht_crash: f32,
    pub hormone_pulse_bereavement_child_cort: f32,
    pub hormone_pulse_bereavement_child_ot_crash: f32,
    pub hormone_pulse_bereavement_child_5ht_crash: f32,

    pub hormone_rate_well_fed_5ht: f32,
    pub hormone_rate_deprivation_cort: f32,
    pub hormone_rate_critical_adr: f32,
    pub hormone_rate_cohabitation_ot: f32,
    pub hormone_rate_cohabitation_5ht: f32,

    // 15.1 四轴十一激素系统 · 耦合与峰后窗口超参 (H-04)
    /// chronic_stress=100 时血清素有效基线最大下调量（CORT→5-HT 抑制，单位同激素水平）
    pub hormone_couple_chronic_5ht_drop: f32,
    /// chronic_stress=100 时雄激素有效基线最大下调量（CORT→AND 生殖轴压制，H-17 沿用）
    pub hormone_couple_chronic_and_drop: f32,
    /// OT=100 时离散应激 CORT 脉冲的缓冲比例上限（OT→压力缓冲）
    pub hormone_couple_ot_buffer_ratio: f32,
    /// nutrition_deficit=100 时甲状腺素有效基线最大下调量（营养→THY 节流）
    pub hormone_couple_nutrition_thy_drop: f32,
    /// 饥渴匮乏时营养不足累计速率 (/游戏小时)
    pub hormone_nutrition_deficit_rate: f32,
    /// 饱食良好时营养不足恢复速率 (/游戏小时)
    pub hormone_nutrition_deficit_recovery: f32,
    /// 内啡肽峰后崩解窗口的触发峰值阈值（越阈上升沿触发）
    pub hormone_ep_peak_threshold: f32,
    /// 内啡肽峰后过劳崩解窗口时长 (游戏小时)
    pub hormone_ep_crash_hours: f32,
    /// 肾上腺素峰后疲劳窗口的触发峰值阈值（越阈上升沿触发）
    pub hormone_adr_peak_threshold: f32,
    /// 肾上腺素峰后深度疲劳窗口时长 (游戏小时)
    pub hormone_adr_fatigue_hours: f32,
    /// NE 焦虑标签的去甲肾上腺素下限（高 NE + 低 5-HT = 焦虑警觉）
    pub hormone_anxiety_ne_threshold: f32,
    /// NE 焦虑标签的血清素上限
    pub hormone_anxiety_5ht_threshold: f32,

    // 15.1 四轴十一激素系统 · 行为意愿通道超参 (H-08 / H-09 · P1)
    /// ★ 行为效果总开关（H-08）：关闭时意愿乘子恒为 1.0、低谷累计惰性、分支等待不生效，
    /// 既有行为与 RNG 消费逐位等价（§1.4 开关覆盖全部行为路径）
    pub hormone_effects_enabled: bool,
    /// DA 原始驱动力除数正下界 ε（raw_drive = dopamine / max(threshold, ε)，防零除）
    pub hormone_da_drive_epsilon: f32,
    /// DA 驱动力→意愿乘子线性增益（乘子 = 1 + gain × (raw_drive − 1)，钳制前）
    pub hormone_da_drive_mult_gain: f32,
    /// 意愿乘子钳制下限（初始候选 0.75）
    pub hormone_da_drive_mult_min: f32,
    /// 意愿乘子钳制上限（初始候选 1.35）
    pub hormone_da_drive_mult_max: f32,
    /// ★ H-08 消沉判定独立阈值：raw_drive 低于该值视为消沉（低谷累计；禁用钳制值判定）
    pub hormone_da_depression_threshold: f32,
    /// ★ H-08 意愿等待放行阈值：合成意愿乘子低于该值时高阶分支（b8 高阶升级 / b13）进入有界等待
    pub hormone_da_will_defer_mult: f32,
    /// ★ H-08 意愿等待窗口（游戏小时）：低谷累计达窗口后高阶分支无条件放行（0 = 禁用等待）
    pub hormone_da_will_defer_hours: f32,
    /// ★ H-08 低谷累计恢复速率（/游戏小时）：意愿恢复后 da_low_streak 的回落速率
    pub hormone_da_low_streak_recovery: f32,
    /// ★ H-09 CORT 危机聚焦压制强度：归一化皮质醇 (=cortisol/100) 在钳制前对意愿乘子的线性减量
    /// （仅调制意愿，不改升级扣账成本 / all_stocked 判据 / family_stock_on 触发器）
    pub hormone_cort_will_suppress: f32,
}

impl SimConfig {
    /// 一年固定四季，单季长度自动由年轮总时长 1/4 计算派生
    #[inline]
    pub fn season_quarter_length(&self) -> f32 {
        self.season_year_length * 0.25
    }
}
