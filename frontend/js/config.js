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
  terrainProfile: 'random', // 地貌模板：'random'（按种子随机T1山口/T2河谷）| 'mountain_pass_v1'（固定T1）| 'river_valley_v1'（固定T2）；影响地形重建与存档门禁
  terrainRidgeAmplitude: 28.0, // T2 地貌 / 通行参数
  // ★ v1.50.17 T1-R 主脊通行力修复：T1 山口聚落主脊宽度/幅度（原先硬编码 0.16~0.23×world_size
  //   与 24~34m，最大梯度仅 6.7~13.4°，低于 terrainMaxWalkSlope=30°，山口不产生通行约束）。
  //   通行力约束：0.858 × terrainPassRidgeAmplitude / terrainPassRidgeWidth 须显著大于
  //   tan(terrainMaxWalkSlope)=0.577，否则主脊不挡路。详见 docs/plan/tech/06-terrain-templates.md §9.3.1。
  terrainPassRidgeWidth: 62.0, // T1 山口主脊高斯半宽 (m)
  terrainPassRidgeAmplitude: 53.0, // T1 山口主脊幅度 (m)
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
  houseAuctionBenchmarkDecayRate: 0.02, // ★ v1.30.0 麦穗决策期标杆衰减速率 (金/模拟秒)：无人击穿时标杆线性下调至底价，防高标杆+空钱袋双锁死；≤0 关闭
  marketPriceBaseWood: 0.15,          // 木材基准金价 (保留：待榷市扩展承载木材后作单价基准)
};
