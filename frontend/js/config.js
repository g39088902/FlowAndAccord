/*
 * Flow & Accord · 前端仿真超参数配置文件
 * ============================================================================
 * 本文件是全部可调超参数的唯一前端入口。每个字段均带中文说明，便于检索与调参。
 *
 * ⚠️ 一致性约束（由 tools/config-check.js 自动校验）：
 *   1. 字段名采用 camelCase，必须与 Rust `crates/sim_core/src/config.rs` 中的
 *      SimConfig 结构体字段一一对应（serde rename_all = "camelCase"）。
 *   2. 字段数量、类型、默认值必须与 config.rs 的 const / Default 完全一致。
 *   3. 缺失键会自动回落 config.rs 默认值；多写的键会被 serde 忽略（视为孤儿，报错）。
 *
 * 调参后无需重新编译 WASM，刷新浏览器即可生效（建议 Ctrl+F5 强刷清缓存）。
 * ============================================================================
 */
window.SIM_CONFIG = {
  // ==========================================================================
  // 1. 引擎节拍与时间基准 (Simulation Time & Ticks)
  // ==========================================================================
  simulationDt: 1.0 / 60.0,        // 单个 tick 对应的模拟小时数 (1/60)
  agentDecisionIntervalTicks: 120, // 每个族人错峰决策间隔 (tick)，平均 2 游戏小时决策一次

  // ==========================================================================
  // 2. 部落民生理、代谢与生命周期 (Agent Physiology & Lifecycle)
  // ==========================================================================
  agentHungerCapacity: 50.0,       // 饱食度容量上限
  agentThirstCapacity: 50.0,       // 水分容量上限
  agentInitialHunger: 45.0,       // 始祖/新生儿初始饱食度
  agentInitialThirst: 45.0,       // 始祖/新生儿初始水分
  agentInitialStamina: 95.0,      // 始祖初始体力
  agentBaseMetabolismDecay: 0.20, // 基础代谢消耗速率 (饱食/水分 每秒)
  agentHealthDecayPerSec: 0.01,   // 濒死健康衰减速率 (每秒)
  agentFrailHealthThreshold: 2.0, // 衰弱(风烛残年)健康阈值：健康值 < 此值不再响应储备需求、饮食优先在家解决
  agentPregnantMetabolismMult: 1.25, // 孕期代谢消耗倍率
  agentWorkMetabolismMult: 1.0,   // 劳作代谢消耗倍率
  agentDeathDecayDuration: 12.0,  // 生命耗尽后彻底消亡的衰减时长 (秒)
  agentAdultAge: 1800.0,          // 成年年龄阈值 (模拟秒，= 60 分钟)
  agentPregnancyDuration: 200.0,  // 妊娠期时长 (模拟秒，≈ 3.3 分钟)
  agentMiscarriageThreshold: 10.0,// 饥渴任一低于此值即触发流产风险
  agentMiscarriageStaminaThreshold: 20.0, // 体力低于此值即触发流产风险
  agentMiscarriageCooldown: 200.0,// 流产后休养冷却 (秒，期间禁止再次受孕)
  agentPostpartumCooldown: 200.0,// 产后休养冷却 (秒，分娩后期间禁止再次受孕)
  agentMiscarriageAlertDuration: 5.0, // 流产告警存续时长 (秒)
  agentConceptionHungerMin: 40.0, // 受孕所需最低饱食度
  agentConceptionThirstMin: 40.0, // 受孕所需最低水分
  agentConceptionStaminaMin: 80.0,// 受孕所需最低体力
  carryCapacityResource: 100.0,   // 单类资源随身行囊容量 (水/粮/木/石 互不共享)
  agentGoldLoadFull: 20.0,        // 单趟淘金运满入库量
  agentBaseMoveSpeedMult: 4.0,    // 基础移动速度倍率
  agentStaminaCapacity: 100.0,    // 体力值上限 (%)
  agentStealthVisibilityCovert: 0.25, // 隐秘特工可见度
  agentStealthVisibilityNormal: 1.0,  // 普通族人可见度
  agentRestStaminaRecoveryRate: 8.0,  // 营地/家宅休息时基础体力恢复速率 (每秒，乘睡眠效率)
  // M6 升级瞬时化：agentConstructStaminaBurn 已删除（房屋升级不再耗体力）
  agentRepairStaminaBurn: 2.5,    // 修缮房屋体力消耗速率 (每秒)
  agentGatherStaminaBurn: 2.0,    // 伐木/采石/淘金体力消耗速率 (每秒)
  agentLaborStaminaFloor: 5.0,    // 劳作体力消耗后的最低保留体力下限
  agentDigestionRatioMin: 0.2,    // 消化效率影响代谢的系数下限
  agentDigestionRatioMax: 5.0,    // 消化效率影响代谢的系数上限
  agentSelfSatisfiedThreshold: 49.9, // 自饮自食「已满足」判定阈值 (≥ 视为饱腹/解渴)
  agentNewbornHunger: 25.0,       // 新生儿初始饱食度
  agentNewbornThirst: 25.0,       // 新生儿初始水分
  agentNewbornStamina: 100.0,     // 新生儿初始体力 (%)
  agentSpawnCount: 20,             // 每局播撒的初始始祖族人数量
  agentCovertEveryN: 4,            // 每第 N 名始祖设为隐秘特工 (i % N == 0)
  agentSpawnJitter: 10.0,          // 始祖初始属性随机抖动幅度 (±)
  agentSpawnHungerBase: 45.0,      // 始祖初始饱食/水分抖动基线
  agentSpawnHungerClampMin: 35.0,  // 始祖初始饱食/水分夹取下限
  agentSpawnHungerClampMax: 50.0,  // 始祖初始饱食/水分夹取上限
  agentSpawnStaminaBase: 90.0,     // 始祖初始体力抖动基线
  agentSpawnStaminaClampMin: 55.0, // 始祖初始体力夹取下限
  agentSpawnStaminaClampMax: 100.0,// 始祖初始体力夹取上限
  agentSpawnBaseSpeed: 8.5,        // 所有 agent 共用的基础默认行走速度

  // ==========================================================================
  // 3. 先天禀赋与遗传演化 (Genetics & Inherited Traits)
  // ==========================================================================
  traitDefaultMean: 100.0,        // 禀赋基准均值
  traitInitialStdDev: 20.0,       // 始祖禀赋初始标准差
  traitMutationDelta: 10.0,       // 遗传突变偏移量
  traitInheritClampMin: 10.0,     // 遗传继承单项禀赋夹取下限
  traitInheritClampMax: 190.0,    // 遗传继承单项禀赋夹取上限
  traitHighThreshold: 110.0,      // 先天卓越禀赋门槛 (力量/智力高于此值触发卓越特化)
  traitLowThreshold: 90.0,        // 先天劣势禀赋门槛 (力量/智力低于此值触发避重就轻特化)
  traitStrengthLoadBonus: 0.25,   // 高力量重体力装载速率加成 (+25%)
  traitStrengthLoadPenalty: 0.15, // 低力量重体力装载速率惩罚 (-15%)

  // ==========================================================================
  // 4. 生态地标与 POI 采收交互 (POI & Ecology Generation)
  // ==========================================================================
  poiMinDistance: 70.0,           // POI 间最小排斥间距 (m)
  countCamps: 4,                  // 营地数量
  countEmpires: 1,                // 帝国数量（自动钳制为 1..=营地数量；当前政体仅实现帝国）
  countWaterSources: 6,           // 清泉数量
  countBerryBushes: 6,            // 浆果数量
  countWoods: 3,                  // 林木数量
  countStoneMines: 2,             // 石矿数量
  countGoldMines: 1,              // 金矿数量
  stockMaxWater: 400.0,           // 清泉储量上限
  stockMaxBerry: 400.0,           // 浆果储量上限
  stockMaxWood: 200.0,            // 林木储量上限
  stockMaxStone: 200.0,           // 石矿储量上限
  stockMaxGold: 200.0,            // 金矿储量上限
  regenBaseWater: 2.0,            // 清泉基础再生速率 (单位/小时)
  regenBaseBerry: 2.0,            // 浆果基础再生速率
  regenBaseWood: 2.0,             // 林木基础再生速率
  regenBaseStone: 2.0,            // 石矿基础再生速率
  regenBaseGold: 1.8,             // 金矿基础再生速率
  poiInteractionRateResource: 10.0, // 资源 POI 现场采收速率 (单位/小时)
  poiInteractionRateGold: 5.0,    // 金矿现场采收速率 (单位/小时)
  poiUnloadRateResource: 10.0,    // 资源入库卸货速率 (单位/小时)
  poiUnloadRateGold: 5.0,         // 黄金入库卸货速率 (单位/小时)
  poiSpawnRadiusCamp: 0.70,       // 营地撒点半径占半图比例
  poiSpawnRadiusResource: 0.80,   // 资源 POI 撒点半径占半图比例
  poiSpawnFallbackRatio: 0.6,     // 紧密撒点回退最小间距比例 (min_distance × N)
  countTerrainTransitionNodes: 17,// 地形过渡节点数量 (路网骨架)
  poiSpawnSpreadRatio: 0.85,      // 地形过渡节点散布范围占半图比例
  poiInteractionRadius: 22.0,     // 采收现场「已抵达 POI」判定半径 (m)
  campHomeConsumeRate: 3.0,       // 营地/家宅休息自饮自食消耗速率 (单位/小时)

  // ==========================================================================
  // 5. 马斯洛需求与决策门槛 (Maslow Needs & Decision Thresholds)
  // ==========================================================================
  decisionPoiSeekMinStockRatio: 0.50, // POI 私有施密特触发器开启阈值 (库存 ≥ 此比例)
  decisionPoiAbandonStockRatio: 0.10,// POI 私有施密特触发器关闭阈值 (库存 < 此比例)
  decisionCriticalThirst: 25.0,   // 临界口渴阈值 (触发寻水)
  decisionCriticalHunger: 25.0,   // 临界饥饿阈值 (触发觅食)
  decisionHomeMealMinStock: 1.0,  // 衰弱族人在家解决饮食的家户账本余额门槛 (该品类余额 ≥ 此值才返家吃喝)
  decisionRestStaminaTarget: 100.0, // 休息目标体力
  decisionStockGoldCooldown: 45.0,// 盖房备料淘金冷却 (秒)
  decisionGoldWealthCooldown: 180.0, // 4 级庄园积累财富的淘金策略冷却 (秒)
  decisionHouseRepairNeedThreshold: 50.0, // 房屋耐久低于此值触发修缮需求
  decisionFoundHomeHungerMin: 20.0, // 立宅所需最低饱食度
  decisionFoundHomeThirstMin: 20.0, // 立宅所需最低水分
  decisionFoundHomeStaminaMin: 60.0, // 立宅所需最低体力
  decisionFoundHomeCandidates: 12, // 立宅候选点数量
  decisionFoundHomeDistMin: 24.0, // 立宅候选点与现有房屋的硬间距下限 (m)
  decisionFoundHomeDistMax: 80.0, // 立宅候选点与营地的软间距上限 (m)
  decisionWorkStaminaThreshold: 50.0, // 劳作所需最低体力 (低于则返家休息)
  decisionFamilyStockTriggerOn: 100.0, // M7 家庭库存施密特触发下限：家户账本余额 < 此 → 去采
  decisionFamilyStockTriggerOff: 200.0, // M7 家庭库存施密特结束上限：一旦去采，余额 ≥ 此 → 补足停止
  decisionCourtshipMinFamilyGold: 5.0, // 求偶发起最低家户金币（严格大于此值）
  decisionEvalOrder: [], // 决策分支评估顺序（空=基线；权威顺序在 config.decision-order.js，启动时由 decision-viz.js 合并覆盖）
  decisionEvalLevels: [], // 分支层级覆盖（与顺序下标并行，0=⓪瞬间行为/1-5=①..⑤马斯洛层级/6=保留代码动态默认；空=全动态默认）

  // ==========================================================================
  // 6. 私宅营造、代际传承与升级 (Housing System)
  // ==========================================================================
  houseDurabilityMax: 100.0,      // 房屋耐久上限
  houseDepreciationRate: 0.02,    // 房屋耐久自然折旧速率 (每秒)
  houseRepairSpeed: 5.0,          // 修缮进度速率 (每秒)
  // M6 升级瞬时化：houseBuildTimeTier*To* 已删除（房屋升级一次性扣账、无施工时长）
  // M8：houseCapacityTier0..4、houseUpgradeTier{0..3}*Ratio、houseFertilityStockRatio 共 14 个字段已删除，
  // 升级材料成本改由 config.house-upgrade-cost.js 的 20 个 houseUpgradeCostTier{1..4}{Water,Food,Wood,Stone,Gold} 字段承载
  houseWinterWoodBurnRate: 0.12,  // 冬季供暖木材消耗速率 (每秒)
  houseWinterColdTemp: 8.0,       // 低温供暖阈值 (℃)
  houseMinSpacing: 20.0,          // 房屋间最小水平间距 (m)
  campMaxHouses: 25,               // 每个营地最多可建设的房屋数量
  campLevelVillageMinHouses: 5,    // 营地升级为村的最低房屋数量
  campLevelTownshipMinHouses: 10,  // 营地升级为乡的最低房屋数量
  campLevelTownMinHouses: 15,      // 营地升级为镇的最低房屋数量
  campLevelCountyMinHouses: 20,    // 营地升级为县的最低房屋数量
  houseNodeReuseRadius: 20.0,     // 立宅优先复用空置路网节点检索半径 (m)
  houseNodePoiOccupyRadius: 1.5,  // 判定节点被 POI 占用的贴合半径 (m)

  // 地形生成、地表查询与山口 profile
  // ★ v1.50.19 地形栅格分辨率（每边格数）：全项目分辨率的单一真相源。
  //   world_create 的 grid_res 传 0 时内核回落到本值；非 0 值可显式覆盖（仅供测试）。
  //   ⚠️ 改动会改变网格步长（worldSize/(res-1)）、地形形态、POI 落位与全部确定性基线，
  //   并使旧存档因 SAVE_APP_VERSION 变更而废弃——调整后必跑全量门禁与性能基准。
  terrainGridRes: 120, // 地形栅格每边格数（120 → 步长 764/119 ≈ 6.42m）
  terrainProfile: 'random', // 地貌模板：'random'（按种子随机T1山口/T2河谷）| 'mountain_pass_v1'（固定T1）| 'river_valley_v1'（固定T2）| 'grassland_plain_v1'（固定草原，v1.50.40 内核骨架）| 'hillside_woodland_v1'（★ v1.50.51 S7-08 登记：半坡林地，v1.50.46 内核骨架）| 'river_valley_settlement_v1'（★ v1.50.51 S7-08 登记：河谷聚落，v1.50.48/49 内核+水系）| 'flat_baseline'（★ v1.50.48 STAGE2-7 显式诊断/降级基线：倾斜-only 平地，永不加入 random，仅用于诊断对照与有界回退降级目标）；★ S7-10 全链路验收收口：random 候选池扩为 T1/T2/草原/半坡/河谷聚落 5 张（各 ~20%）；flat_baseline 永不入 random；影响地形重建与存档门禁
  terrainRidgeAmplitude: 28.0, // T2 地貌 / 通行参数
  // ★ v1.50.17 T1-R 主脊通行力修复：T1 山口聚落主脊宽度/幅度（原先硬编码 0.16~0.23×world_size
  //   与 24~34m，最大梯度仅 6.7~13.4°，低于 terrainMaxWalkSlope=30°，山口不产生通行约束）。
  //   通行力约束：0.858 × terrainPassRidgeAmplitude / terrainPassRidgeWidth 须显著大于
  //   tan(terrainMaxWalkSlope)=0.577，否则主脊不挡路。详见 docs/plan/tech/06-terrain-templates.md §9.3.1。
  terrainPassRidgeWidth: 62.0, // T1 山口主脊高斯半宽 (m)
  terrainPassRidgeAmplitude: 53.0, // T1 山口主脊幅度 (m)
  // ★ TB-01-5：多尺度 fBm 噪声与支脊超参（改值即换图，须随 TERRAIN_GENERATOR_VERSION 递增）
  terrainNoiseAmplitude: 6.0, // fBm 基础振幅 (m)；Octave 0 基准，Octave 1/2 按 0.43/0.145 比例跟随
  terrainNoiseScaleBase: 300.0, // fBm 宏观基础波长 (m)；Octave 1/2 按 0.36/0.125 比例跟随（默认 → λ 300/108/37.5m）
  terrainBranchRidgeEnabled: true, // 支脊生成总开关（T1 山口 profile；false 时 relief_rng 消费序缩短）
  terrainBranchRidgeAmplitudeRatio: 0.48, // 支脊/主脊振幅比中值；每条 ×[0.85,1.15] 抖动（默认 → 0.408~0.552）
  terrainBranchRidgeLength: 150.0, // 支脊基础延伸长度 (m)；每条 ×[0.8,1.2] 抖动（默认 → 120~180m）
  // ★ v1.50.51 S7-08：阶段七 3 个静态 profile 形态参数集中化（06号 §4.1/§4.2/§4.3）。
  //   默认值 = 参数化前 terrain.rs/hydrology.rs 形态常数（世界输出逐位不变）。
  //   改任一值等于换图（同种子形态漂移），须遵循 TERRAIN_GENERATOR_VERSION 契约；
  //   各字段的保护线约束（建造保护线/门禁窗口）详见 sim_core config.rs doc 注释。
  // ── S7-02 平地草原（grassland_plain_v1）──
  terrainGrasslandMoundAmpMin: 6.5,   // 残丘高斯幅度抽样下限 (m)；A/R∈[0.19,0.31] → 峰值坡度 ≈9.3°~14.9°
  terrainGrasslandMoundAmpMax: 9.5,   // 残丘高斯幅度抽样上限 (m)
  terrainGrasslandMoundRatioMin: 0.19, // 残丘 幅度/半径比 抽样下限（峰值坡度 ≈0.858×A/R）
  terrainGrasslandMoundRatioMax: 0.31, // 残丘 幅度/半径比 抽样上限（过大→残丘成通行障碍）
  // ── S7-02/S7-04 共用：泉溪洼地（草原/半坡各 2 处坡脚泉溪）──
  terrainSpringDepressionDepthMin: 1.4,  // 洼地深度抽样下限 (m)
  terrainSpringDepressionDepthMax: 2.2,  // 洼地深度抽样上限 (m)
  terrainSpringDepressionRadiusMin: 24.0, // 洼地凹圈半径抽样下限 (m)；凹圈 0.7R~1.5R 写 SoftGround
  terrainSpringDepressionRadiusMax: 34.0, // 洼地凹圈半径抽样上限 (m)
  // ── S7-04 半坡林地（hillside_woodland_v1）──
  terrainHillsideNoiseDamp: 0.6,      // fBm 噪声增益阻尼（换 max_slope 门禁窗口 22°~28.5° 余量）
  terrainHillsideAmpMin: 26.0,        // 不对称高斯主坡幅度抽样下限 (m)
  terrainHillsideAmpMax: 32.0,        // 主坡幅度抽样上限 (m)；过大→背风峰值压穿 28.5° 窗
  terrainHillsideLeeSlopeMin: 23.0,   // 背风坡目标峰值坡度抽样下限 (度)；按目标坡度反解宽度
  terrainHillsideLeeSlopeMax: 23.2,   // 背风坡目标峰值坡度抽样上限 (度)
  terrainHillsideWindSlopeMin: 8.0,   // 迎风坡目标峰值坡度抽样下限 (度)；宽缓可建
  terrainHillsideWindSlopeMax: 12.0,  // 迎风坡目标峰值坡度抽样上限 (度)；目标 <14°
  terrainHillsideCrestShiftMin: 0.18, // 脊线横移比例抽样下限（×world；陡峭带远离初始营地）
  terrainHillsideCrestShiftMax: 0.30, // 脊线横移比例抽样上限（×world）
  // ── S7-06/S7-07 河谷聚落（river_valley_settlement_v1）──
  terrainValleyFloorBaseM: 3.0,       // 谷底基准高程 (m)；主河水面低于此值下凹成河
  terrainValleyFloorHalfMin: 80.0,    // 谷底半宽抽样下限 (m)；下沿 80 守两侧河阶干带 ≥55m 建造保护线
  terrainValleyFloorHalfMax: 95.0,    // 谷底半宽抽样上限 (m)；⇒ W_floor ∈ [160,190]
  terrainValleyWallHeightMin: 44.0,   // 陡壁总高差抽样下限 (m)；规格 40~50
  terrainValleyWallHeightMax: 48.0,   // 陡壁总高差抽样上限 (m)
  terrainValleyWallRatioMin: 0.54,    // 陡壁幅宽比 H/W 抽样下限（smoothstep 峰值梯度 1.5×H/W）
  terrainValleyWallRatioMax: 0.585,   // H/W 抽样上限；→ 峰值梯度 39°~41.5° ≥34° 硬禁行且 ≤45° 探针窗
  terrainValleyMeanderAmpMin: 18.0,   // 谷轴蜿蜒振幅抽样下限 (m)；远小于谷底半宽
  terrainValleyMeanderAmpMax: 30.0,   // 谷轴蜿蜒振幅抽样上限 (m)
  terrainValleyMeanderWaves: 3.0,     // 谷轴蜿蜒全程周期数（y/world 系数；S7-07 起兼作主河中心线波形）
  terrainValleyTaperRatio: 0.47,      // 陡壁/台地包络起始比例（×半图）；深切段中部 47%，谷口缓梁保绕行
  terrainValleyNoiseFloorK: 0.15,     // 谷底 fBm 分区阻尼（强阻尼保高程平缓与峰坡窗口）
  terrainValleyNoiseWallK: 0.15,      // 陡壁 fBm 分区阻尼（保峰值梯度窗口）
  terrainValleyNoiseUplandK: 0.5,     // 台地 fBm 分区阻尼（中等阻尼出滚动丘陵）
  terrainValleyRiverWidthMin: 22.0,   // 主河河宽抽样下限 (m)；规格 22~32，取半为半宽
  terrainValleyRiverWidthMax: 32.0,   // 主河河宽抽样上限 (m)
  terrainValleyRiverBankM: 8.0,       // 低滩禁建带半宽 (m)；刻意不复用 T2 的 18m 宽岸（会吃掉聚落河阶）
  terrainValleyRiverTerraceM: 20.0,   // 河阶带半宽 (m)；岸带外 RiverTerrace 高肥力 0.95 覆盖带
  terrainValleyFordRatio: 0.32,       // 授权浅滩 y 位置比例（±×world）；比 T2 先例 ±0.24 更稀疏
  terrainValleyAccessOffsetMinM: 35.0, // 取水点离轴最小偏移 (m)；保证对置点对间距 ≥70m POI 口径
  // ── TB-02 台地聚落（plateau_settlement_v1）──
  terrainPlateauHeightMin: 18.0,      // 台面最小抬升高度 (m)；规格 18~26
  terrainPlateauHeightMax: 26.0,      // 台面最大抬升高度 (m)
  terrainPlateauHalfWidthRatio: 0.22, // 台面半宽相对世界尺寸比例；0.22×768 ≈ 169m
  terrainPlateauHalfDepthRatio: 0.18, // 台面半深相对世界尺寸比例；0.18×768 ≈ 138m
  terrainPlateauCornerRadiusRatio: 0.35, // 台面圆角相对最小半尺寸比例；0.35×138 ≈ 48m
  terrainPlateauEdgeBandRatio: 0.6,   // 普通台缘过渡带宽度对高差比率；B_edge = 0.6H，峰坡 ~68° ≥34° 硬禁行
  terrainPlateauRampBandRatio: 4.0,   // 入口缓坡过渡带宽度对高差比率；B_ramp = 4.0H，峰坡 ~20.6° ≤30° 可行走
  terrainPlateauRampWidth: 36.0,      // 缓坡核心横向宽度 (m)；≥32m
  terrainPlateauRampShoulderWidth: 24.0, // 缓坡肩部横向过渡宽度 (m)；光滑过渡至 edge_band
  terrainPlateauTopNoiseGain: 0.20,   // 台面区域噪声阻尼增益；起伏平缓保 ≥3 处房屋可建
  terrainPlateauRampNoiseGain: 0.12,  // 缓坡入口区域噪声阻尼增益；走廊平缓保可走
  terrainPlateauOutlineWarp: 6.0,     // 台缘轮廓低频扰动幅度 (m)
  terrainRiverWidthMin: 28.0, // T2 地貌 / 通行参数
  terrainRiverWidthMax: 42.0, // T2 地貌 / 通行参数
  terrainRiverWaterLevel: 0.0, // T2 地貌 / 通行参数
  terrainRiverBankWidth: 18.0, // T2 地貌 / 通行参数
  terrainRiverTerraceWidth: 65.0, // T2 地貌 / 通行参数
  terrainCrossingWidth: 26.0, // T2 地貌 / 通行参数
  terrainSoftGroundCost: 1.25, // T2 地貌 / 通行参数
  terrainShallowWaterCost: 2.0, // T2 地貌 / 通行参数
  terrainMaxWalkSlope: 30.0,          // 普通道路允许的最大坡度 (度)
  terrainMaxBuildSlope: 16.0,         // 房屋/设施完整占地允许的最大坡度 (度)
  terrainFootprintHalfExtent: 7.0,    // 房屋基础完整占地半径 (m)
  terrainRoadCorridorWidth: 5.0,      // 道路合法走廊宽度 (m)
  // ★ v1.48.0 D-A 装饰系统
  terrainAccentDensity: 1.0,          // 装饰密度倍率（0.0=无装饰, 0.5=稀疏, 1.0=默认, 2.0=茂密）
  // ★ D-B1 子特征注入总开关（06号 §5.3）：山脚湖/山涧飞瀑/河谷峭壁等；置 false 时 §5.3 第 4–5、9 步为空。
  //   阶段一为空钩子门控（两态世界输出等价）；选择器实现属 D-B1-3，完整阶段化流水线属阶段二。
  terrainAccentSubFeatures: true,
  // ★ STAGE2-1（06号 R.5/§5.8）：创世有界重试上限（初始创世失败时阶梯降级重试的最大次数，
  //   0 = 只尝试一次）。消费点 = spatial/world.rs 建世界入口钳制；完整阶梯降级重试环属 STAGE2-5。
  terrainGenerationMaxRetries: 3,

  // ==========================================================================
  // 8. 四季更迭与宏观气候 (Seasons & Macro Climate)
  // ==========================================================================
  seasonYearLength: 240.0,        // 一年 (四季) 总时长 (模拟秒)
  tempBaseMid: 14.0,              // 年均基准温度 (℃)
  tempAmplitude: 17.0,            // 季节温度振幅 (℃)
  tempElNinoCycleYears: 7.0,      // 厄尔尼诺叠加正弦周期 (年)
  tempElNinoAmplitude: 5.0,       // 厄尔尼诺叠加正弦振幅范围 (±℃)
  tempClimateEpochCycleYears: 49.0, // 纪元候波叠加正弦长周期 (年)
  tempClimateEpochAmplitude: 5.0,  // 纪元候波正弦振幅范围 (±℃)
  berryFrostDeclineTemp: 8.0,      // 浆果开始减产的霜降气温阈值 (℃)
  berryFrostZeroTemp: 0.0,         // 浆果彻底绝收休眠的冰封气温阈值 (℃)

  // ==========================================================================
  // 8. 空间路网、限速与踩踏演化 (Roads & Wear Evolution)
  // ==========================================================================
  roadWearDecayRate: 0.0033,       // 道路自然杂草衰减速率 (%/小时,相对当前磨损比例衰减，0.005 即 0.5%/h)
  roadWearStepInc: 0.075,           // 族人单次通行踩踏增量 (等级/次)
  roadWearTierStep: 0.25,         // 道路等级阶梯步进 (用于 A* 寻路速度加成量化与端点对缓存跨阶失效)
  roadBenefitMaxWear: 5.0,        // 道路移速增益上限磨损值 (超过此值无额外移速加成)
  roadMaxWear: 20.0,              // 道路磨损/踩踏耐久度上限 (允许溢出至最多10)
  roadSpeedDirtTrack: 36.0,       // 泥泞小径限速
  roadSpeedCobblestone: 44.0,     // 碎石盘山道限速
  roadSpeedAsphaltUrban: 60.0,    // 城镇大道限速
  roadSpeedSkywayElevated: 96.0,  // 高架飞索限速
  roadSpeedSmugglerTrail: 40.0,   // 私贩密径限速
  roadLevelFactorBase: 0.50,      // 道路等级影响移速基准系数 (等级 0)
  roadLevelFactorWearCoef: 0.333, // 道路等级影响移速磨损系数
  roadLevelFactorMin: 0.50,       // 道路等级移速乘子下限
  roadLevelFactorMax: 2.20,       // 道路等级移速乘子上限

  // ==========================================================================
  // 9. 动力学移动与寻路权重 (Movement & Pathfinding)
  // ==========================================================================
  agentMoveStaminaBase: 0.6,      // 移动基础体力消耗 (每秒)
  agentMoveStaminaPregnant: 0.3,  // 孕期额外移动体力消耗 (每秒)
  agentMoveStaminaGradeCoef: 3.5, // 坡度对移动体力消耗加成系数
  agentMoveAccelCoef: 4.0,        // 移动加速度收敛系数
  roadAstarGradePenaltyCoef: 1.5, // A* 坡度通行代价惩罚系数
  roadHiddenPreferModifier: 0.4,  // A* 偏好隐秘时隐秘道路代价乘子
  roadVisiblePreferModifier: 1.2, // A* 偏好隐秘时公开道路代价乘子
  roadHiddenAvoidModifier: 2.5,   // A* 非偏好隐秘时隐秘道路代价乘子
  roadVisibleAvoidModifier: 1.0,  // A* 非偏好隐秘时公开道路代价乘子

  // ==========================================================================
  // 10. 账本与婚姻登记子系统 (Ledger & Marriage Registry)
  // ==========================================================================
  ledgerJournalCapacity: 64,      // 账本流水环形缓冲容量 (每团体/家户，条)

  // ==========================================================================
  // 11. 宗族系统 (Clan System — M3)
  // ==========================================================================
  clanTributeRate: 0.05,          // 族税率：家户每周期向族库缴纳账面余额的比例
  clanTributeIntervalTicks: 3600, // 族税征收周期 (tick)，每 N tick 全局统一征收一次 (60 游戏小时)
  clanMutualAidMinBalance: 50.0,  // 族内互助族库最低余额门槛
  clanMutualAidFamilyThreshold: 10.0, // 极贫家庭门槛：家户账面水+粮总额 < 此值视为极贫
  clanMutualAidCooldownTicks: 1800, // 族内互助冷却 (tick)，每家户每 N tick 最多接收一次 (30 游戏小时)
  prestigeClanElderBonus: 3,      // 宗族长老（族长）顺位任职威望奖励

  // ==========================================================================
  // 12. 地区与王国系统 (Region & Kingdom — M4)
  // ==========================================================================
  ledgerTaxRate: 0.03,              // 公仓税率：家户每周期向地区公仓缴纳账面余额的比例
  ledgerTaxIntervalTicks: 4800,     // 公仓税征收周期 (tick)，每 N tick 全局统一征收一次 (80 游戏小时)
  ledgerReliefMinBalance: 30.0,     // 救济公仓最低余额门槛：地区公仓总余额 > 此值方可签发救济
  ledgerReliefFamilyThreshold: 8.0, // 极贫家庭门槛：家户账面水+粮总额 < 此值视为极贫
  ledgerReliefCooldownTicks: 2400,  // 救济冷却 (tick)，每家户每 N tick 最多接收一次救济 (40 游戏小时)
  prestigeKingBonus: 3,             // 国王登基任职威望奖励
  royalPrivyIntervalTicks: 7200,    // 国王内帑结算周期 (tick)，每 N tick 结算一次 (120 游戏小时)
  royalPrivyRate: 0.01,             // 国王内帑提取比例：从地区公仓各品类物资中提取比例 (1%)
  imperialPrivyIntervalTicks: 7200, // 皇帝公帑结算周期 (tick)，每 N tick 结算一次 (120 游戏小时)
  imperialPrivyRate: 0.005,         // 皇帝公帑提取比例：从下属王国公仓各品类物资中提取比例 (0.5%)

  // ==========================================================================
  // 13. 外部市场（榷场互市）与幂律动态定价 (External Market & Dynamic Pricing)
  // ==========================================================================
  countMarkets: 1,                          // 全图生成外部市场 POI 数量
  marketStockMaxWater: 400.0,               // 外部市场清水储备容量上限
  marketStockMaxFood: 400.0,                // 外部市场粮食储备容量上限
  marketStockMaxWood: 400.0,                // 外部市场木料储备容量上限
  marketRegenBaseWater: 2.0,                // 外部市场清水每秒自然再生速率
  marketRegenBaseFood: 2.0,                 // 外部市场粮食每秒自然再生速率
  marketRegenBaseWood: 2.0,                 // 外部市场木料每秒自然再生速率
  marketPriceBase: 0.1,                     // 满库存起步基准单价 (黄金 / 单位资源)
  marketPricePowerExponent: 2.0,            // 幂律定价指数 k
  marketPriceFloorStock: 1.0,               // 计价库存钳制下限 (防除零与价格封顶)
  marketEmergencyFamilyStockThreshold: 10.0,// 家户物资绝境警戒线
  marketMinFamilyGold: 0.5,                 // 户主准入起步黄金底线
  marketMinDispatchStamina: 15.0,           // 户主出发前往市场的最低体力门槛
  marketSettlementStep: 5.0,                // 外部市场单次交易结算步长 (单位)
  marketWealthyFamilyGold: 200.0,           // 豪绅家户黄金门槛 (≥此值户主面临物资短缺时80%几率赴榷场现货采购)
  marketPoorFamilyGold: 50.0,               // 平民家户黄金门槛 (<此值严格野外自力更生，非绝境不赴榷场)

  // ==========================================================================
  // 14. 二手房屋市场、营地中介拍卖与麦穗竞价 (Housing Market & Auction)
  // ==========================================================================
  houseAuctionBidCooldownTicks: 180,  // 买家全局出价冷却 (tick，默认 180 = 3 游戏小时，出价后对任何房屋都不再出价)
  houseAuctionDeadlineDurability: 10.0,// 最晚出售修缮度时限 (耐久度跌至此值时只要有新报价即成交)
  houseAuctionObservationRatio: 0.37,  // 麦穗理论最优停止观察期比例 (37%)
  houseAuctionMinBidGold: 0.01,       // 单次出价最低家户黄金门槛 (低于此值不出价)
  houseAuctionBidHistoryCapacity: 128, // 单次拍卖会话报价流水环形缓冲容量 (条)
  houseAuctionCrownShareWeight: 1.0,  // 王国公户遗产分账份额权重 (与人类受益人同等参与份额制分配，无人类受益人时独得全额)
  houseAuctionBenchmarkDecayRate: 0.02, // 麦穗决策期标杆衰减速率 (金/模拟秒)：无人击穿时标杆线性下调至底价，防高标杆+空钱袋双锁死；≤0 关闭
  marketPriceBaseWood: 0.15,          // 木材基准金价 (保留：待榷市扩展承载木材后作单价基准)

  // ==========================================================================
  // 15. 四轴十一激素系统 · 动力学首批超参 (H-01 / H-02 / H-03)
  // ==========================================================================
  hormoneDaBaseline: 50.0, // 多巴胺基础基线
  hormoneDaThresholdBaseline: 50.0, // 多巴胺奖赏阈值基线
  hormone5htBaseline: 50.0, // 血清素基础基线
  hormoneEpBaseline: 20.0, // 内啡肽静息基线
  hormoneOtBaseline: 50.0, // 催产素基础基线
  hormoneCortBaseline: 20.0, // 皮质醇静息基线
  hormoneAdrBaseline: 10.0, // 肾上腺素静息基线
  hormoneNeBaseline: 30.0, // 去甲肾上腺素静息基线
  hormoneAndMaleBaseline: 60.0, // 雄激素成年男性基线
  hormoneAndFemaleBaseline: 10.0, // 雄激素女性与幼童基线
  hormoneEstFemaleBaseline: 50.0, // 雌激素育龄女性基线
  hormoneEstOtherBaseline: 10.0, // 雌激素男性/幼童/更年期基线
  hormoneEstMenopauseAge: 50.0, // 雌激素女性更年期起始年龄
  hormoneProgPregnantBaseline: 70.0, // 孕激素妊娠期基线
  hormoneProgNonPregnantBaseline: 10.0, // 孕激素非孕/男性基线
  hormoneThyBaseline: 50.0, // 甲状腺素基础代谢基线

  hormoneDaDecay: 0.5, // 多巴胺向基线回归速率 (/游戏小时)
  hormoneDaThresholdDecay: 0.04, // 多巴胺奖赏阈值慢速回归速率 (/游戏小时)
  hormoneDaThresholdDriftRatio: 0.2, // 多巴胺阈值漂移比例
  hormone5htDecay: 0.2, // 血清素向基线回归速率 (/游戏小时)
  hormoneEpDecay: 2.0, // 内啡肽向基线回归速率 (/游戏小时)
  hormoneOtDecay: 0.3, // 催产素向基线回归速率 (/游戏小时)
  hormoneCortDecay: 0.4, // 皮质醇向基线回归速率 (/游戏小时)
  hormoneAdrDecay: 12.0, // 肾上腺素向基线回归速率 (/游戏小时)
  hormoneNeDecay: 0.5, // 去甲肾上腺素向基线回归速率 (/游戏小时)
  hormoneAndDecay: 0.1, // 雄激素向基线回归速率 (/游戏小时)
  hormoneEstDecay: 0.1, // 雌激素向基线回归速率 (/游戏小时)
  hormoneProgDecay: 0.1, // 孕激素向基线回归速率 (/游戏小时)
  hormoneThyDecay: 0.05, // 甲状腺素向基线回归速率 (/游戏小时)

  hormonePulseUpgradeDa: 20.0, // 房屋升级成功多巴胺脉冲量
  hormonePulseMarriageDa: 25.0, // 成婚多巴胺脉冲量
  hormonePulseMarriageOt: 30.0, // 成婚催产素脉冲量
  hormonePulseMarriage5ht: 15.0, // 成婚血清素脉冲量
  hormonePulseConceptionProg: 50.0, // 受孕成功孕激素抬升脉冲量
  hormonePulseMiscarriageCort: 40.0, // 流产皮质醇应激脉冲量
  hormonePulseBirthMotherOt: 35.0, // 母亲顺利分娩催产素脉冲量
  hormonePulseBirthMotherDa: 20.0, // 母亲顺利分娩多巴胺脉冲量
  hormonePulseBirthFatherOt: 20.0, // 父亲迎来新生儿催产素脉冲量
  hormonePulseBirthFatherDa: 15.0, // 父亲迎来新生儿多巴胺脉冲量
  hormonePulseCoronationDa: 40.0, // 登基加冕多巴胺脉冲量
  hormonePulseCoronationAnd: 25.0, // 登基加冕雄激素脉冲量
  hormonePulseCoronation5ht: 20.0, // 登基加冕血清素脉冲量
  hormonePulseBagFullDa: 5.0, // 行囊装满多巴胺边界脉冲量
  hormonePulseMealDa: 2.0, // 现场进食/自饮多巴胺小脉冲量
  hormonePulseUnloadDa: 4.0, // 回家卸货入账多巴胺脉冲量
  hormonePulseFullStamina5ht: 5.0, // 满体力跨界血清素脉冲量
  hormonePulseFullStaminaDa: 3.0, // 满体力跨界多巴胺脉冲量
  hormonePulseBereavementSpouseCort: 50.0, // 丧偶皮质醇脉冲量
  hormonePulseBereavementSpouseOtCrash: 40.0, // 丧偶催产素崩落幅度
  hormonePulseBereavementSpouse5htCrash: 30.0, // 丧偶血清素崩落幅度
  hormonePulseBereavementChildCort: 40.0, // 丧子皮质醇脉冲量
  hormonePulseBereavementChildOtCrash: 30.0, // 丧子催产素崩落幅度
  hormonePulseBereavementChild5htCrash: 20.0, // 丧子血清素崩落幅度

  hormoneRateWellFed5ht: 2.0, // 长期饱食良好血清素持续增长速率 (/游戏小时)
  hormoneRateDeprivationCort: 3.0, // 饥渴匮乏警戒皮质醇持续增长速率 (/游戏小时)
  hormoneRateCriticalAdr: 5.0, // 临界求生自救肾上腺素持续增长速率 (/游戏小时)
  hormoneRateCohabitationOt: 2.5, // 夫妻在宅共处催产素持续增长速率 (/游戏小时)
  hormoneRateCohabitation5ht: 1.5, // 夫妻在宅共处血清素持续增长速率 (/游戏小时)

  // ★ H-04 耦合与峰后窗口
  hormoneCoupleChronic5htDrop: 20.0, // 慢性压力满值时血清素有效基线最大下调量 (CORT→5-HT)
  hormoneCoupleChronicAndDrop: 30.0, // 慢性压力满值时雄激素有效基线最大下调量 (CORT→AND 生殖轴压制)
  hormoneCoupleOtBufferRatio: 0.5, // 催产素满值时离散应激皮质醇脉冲的缓冲比例上限 (OT→压力缓冲)
  hormoneCoupleNutritionThyDrop: 25.0, // 营养不足满值时甲状腺素有效基线最大下调量 (营养→THY 节流)
  hormoneNutritionDeficitRate: 2.0, // 饥渴匮乏时营养不足累计速率 (/游戏小时)
  hormoneNutritionDeficitRecovery: 4.0, // 饱食良好时营养不足恢复速率 (/游戏小时)
  hormoneEpPeakThreshold: 80.0, // 内啡肽峰后崩解窗口触发峰值阈值 (越阈上升沿触发)
  hormoneEpCrashHours: 2.0, // 内啡肽峰后过劳崩解窗口时长 (游戏小时)
  hormoneAdrPeakThreshold: 70.0, // 肾上腺素峰后疲劳窗口触发峰值阈值 (越阈上升沿触发)
  hormoneAdrFatigueHours: 1.0, // 肾上腺素峰后深度疲劳窗口时长 (游戏小时)
  hormoneAnxietyNeThreshold: 60.0, // NE 焦虑标签的去甲肾上腺素下限 (高NE+低5-HT)
  hormoneAnxiety5htThreshold: 30.0, // NE 焦虑标签的血清素上限
};
