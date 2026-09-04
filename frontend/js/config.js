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
  simulationDt: 1.0 / 30.0,        // 单个 tick 对应的模拟秒数 (1/30)
  ticksPerSecond: 30,              // 每秒 tick 数（决定模拟实时倍速基准）
  agentDecisionIntervalTicks: 30,  // 每个族人错峰决策间隔 (tick)，平均 1 秒决策一次

  // ==========================================================================
  // 2. 部落民生理、代谢与生命周期 (Agent Physiology & Lifecycle)
  // ==========================================================================
  agentHungerCapacity: 50.0,       // 饱食度容量上限
  agentThirstCapacity: 50.0,       // 水分容量上限
  agentInitialHunger: 25.0,       // 始祖/新生儿初始饱食度
  agentInitialThirst: 25.0,       // 始祖/新生儿初始水分
  agentInitialStamina: 95.0,      // 始祖初始体力
  agentBaseMetabolismDecay: 0.10, // 基础代谢消耗速率 (饱食/水分 每秒)
  agentHealthDecayPerSec: 0.01,   // 濒死健康衰减速率 (每秒)
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
  carryCapacityResource: 50.0,    // 单类资源随身行囊容量 (水/粮/木/石 互不共享)
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
  agentSpawnHungerBase: 25.0,      // 始祖初始饱食抖动基线
  agentSpawnHungerClampMin: 10.0,  // 始祖初始饱食夹取下限
  agentSpawnHungerClampMax: 45.0,  // 始祖初始饱食夹取上限
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

  // ==========================================================================
  // 4. 生态地标与 POI 采收交互 (POI & Ecology Generation)
  // ==========================================================================
  poiMinDistance: 70.0,           // POI 间最小排斥间距 (m)
  countCamps: 5,                  // 营地数量
  countWaterSources: 6,           // 清泉数量
  countBerryBushes: 6,            // 浆果数量
  countWoods: 3,                  // 林木数量
  countStoneMines: 2,             // 石矿数量
  countGoldMines: 1,              // 金矿数量
  stockMaxWater: 100.0,           // 清泉储量上限
  stockMaxBerry: 100.0,           // 浆果储量上限
  stockMaxWood: 100.0,            // 林木储量上限
  stockMaxStone: 100.0,           // 石矿储量上限
  stockMaxGold: 100.0,            // 金矿储量上限
  regenBaseWater: 2.0,            // 清泉基础再生速率 (单位/秒)
  regenBaseBerry: 2.0,            // 浆果基础再生速率
  regenBaseWood: 2.0,             // 林木基础再生速率
  regenBaseStone: 2.0,            // 石矿基础再生速率
  regenBaseGold: 1.8,             // 金矿基础再生速率
  poiInteractionRateResource: 10.0, // 资源 POI 现场采收速率 (单位/秒)
  poiInteractionRateGold: 5.0,    // 金矿现场采收速率 (单位/秒)
  poiUnloadRateResource: 10.0,    // 资源入库卸货速率 (单位/秒)
  poiUnloadRateGold: 5.0,         // 黄金入库卸货速率 (单位/秒)
  poiSpawnRadiusCamp: 0.70,       // 营地撒点半径占半图比例
  poiSpawnRadiusResource: 0.80,   // 资源 POI 撒点半径占半图比例
  poiSpawnFallbackRatio: 0.6,     // 紧密撒点回退最小间距比例 (min_distance × N)
  countTerrainTransitionNodes: 17,// 地形过渡节点数量 (路网骨架)
  poiSpawnSpreadRatio: 0.85,      // 地形过渡节点散布范围占半图比例
  roadConnectNearDist: 175.0,     // 路网直连近距阈值 (≤ 双向铺装)
  roadConnectFarDist: 320.0,      // 路网直连远距阈值 (≤ 单向泥径)
  roadGradePaveThreshold: 8.0,    // 坡度铺装阈值 (高差超过则盘山道，否则泥径)
  poiInteractionRadius: 22.0,     // 采收现场「已抵达 POI」判定半径 (m)
  campHomeConsumeRate: 3.0,       // 营地/家宅休息自饮自食消耗速率 (单位/秒)

  // ==========================================================================
  // 5. 马斯洛需求与决策门槛 (Maslow Needs & Decision Thresholds)
  // ==========================================================================
  decisionPoiSeekMinStockRatio: 0.30, // POI 私有施密特触发器开启阈值 (库存 ≥ 此比例)
  decisionPoiAbandonStockRatio: 0.10,// POI 私有施密特触发器关闭阈值 (库存 < 此比例)
  decisionCriticalThirst: 25.0,   // 临界口渴阈值 (触发寻水)
  decisionCriticalHunger: 25.0,   // 临界饥饿阈值 (触发觅食)
  decisionRestStaminaTarget: 100.0, // 休息目标体力
  decisionStockGoldCooldown: 45.0,// 盖房备料淘金冷却 (秒)
  decisionGoldWealthCooldown: 180.0, // 4 级庄园竣工前娱乐淘金冷却 (秒)
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
  decisionEvalOrder: [], // 决策分支评估顺序（空=基线；权威顺序在 config.decision-order.js，启动时由 decision-viz.js 合并覆盖）
  decisionEvalLevels: [], // 分支层级覆盖（与顺序下标并行，0=代码动态默认，1-5=强制层级；空=全动态默认）

  // ==========================================================================
  // 6. 私宅营造、代际传承与升级 (Housing System)
  // ==========================================================================
  houseDurabilityMax: 100.0,      // 房屋耐久上限
  houseDepreciationRate: 0.02,    // 房屋耐久自然折旧速率 (每秒)
  houseRepairTriggerThreshold: 80.0, // 耐久低于此值允许修缮
  houseRepairSpeed: 5.0,          // 修缮进度速率 (每秒)
  // M6 升级瞬时化：houseBuildTimeTier*To* 已删除（房屋升级一次性扣账、无施工时长）
  // M8：houseCapacityTier0..4、houseUpgradeTier{0..3}*Ratio、houseFertilityStockRatio 共 14 个字段已删除，
  // 升级材料成本改由 config.house-upgrade-cost.js 的 20 个 houseUpgradeCostTier{1..4}{Water,Food,Wood,Stone,Gold} 字段承载
  houseWinterWoodBurnRate: 0.12,  // 冬季供暖木材消耗速率 (每秒)
  houseWinterColdTemp: 5.0,       // 低温供暖阈值 (℃)
  houseMinSpacing: 20.0,          // 房屋间最小水平间距 (m)
  campMaxHouses: 25,               // 每个营地最多可建设的房屋数量
  campLevelVillageMinHouses: 5,    // 营地升级为村的最低房屋数量
  campLevelTownshipMinHouses: 10,  // 营地升级为乡的最低房屋数量
  campLevelTownMinHouses: 15,      // 营地升级为镇的最低房屋数量
  campLevelCountyMinHouses: 20,    // 营地升级为县的最低房屋数量
  houseNodeReuseRadius: 20.0,     // 立宅优先复用空置路网节点检索半径 (m)
  houseNodePoiOccupyRadius: 1.5,  // 判定节点被 POI 占用的贴合半径 (m)

  // ==========================================================================
  // 7. 四季更迭与宏观气候 (Seasons & Macro Climate)
  // ==========================================================================
  seasonYearLength: 240.0,        // 一年 (四季) 总时长 (模拟秒)
  tempBaseMid: 14.0,              // 年均基准温度 (℃)
  tempAmplitude: 17.0,            // 季节温度振幅 (℃)

  // ==========================================================================
  // 8. 空间路网、限速与踩踏演化 (Roads & Wear Evolution)
  // ==========================================================================
  roadWearDecayRate: 0.0067,      // 道路自然杂草衰减速率 (%/秒,相对当前磨损比例衰减)
  roadWearStepInc: 0.05,          // 族人单次通行踩踏增量 (等级/次)
  roadMaxWear: 5.0,               // 道路磨损上限
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
  roadAstarHeuristicDivisor: 80.0,// A* 启发式距离除数
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
  clanTributeIntervalTicks: 1800, // 族税征收周期 (tick)，每 N tick 全局统一征收一次
  clanMutualAidMinBalance: 50.0,  // 族内互助族库最低余额门槛
  clanMutualAidFamilyThreshold: 10.0, // 极贫家庭门槛：家户账面水+粮总额 < 此值视为极贫
  clanMutualAidCooldownTicks: 900, // 族内互助冷却 (tick)，每家户每 N tick 最多接收一次
  prestigeClanElderBonus: 3,      // 宗族长老（族长）顺位任职威望奖励

  // ==========================================================================
  // 12. 地区与王国系统 (Region & Kingdom — M4)
  // ==========================================================================
  ledgerTaxRate: 0.03,              // 公仓税率：家户每周期向地区公仓缴纳账面余额的比例
  ledgerTaxIntervalTicks: 2400,     // 公仓税征收周期 (tick)，每 N tick 全局统一征收一次
  ledgerReliefMinBalance: 30.0,     // 救济公仓最低余额门槛：地区公仓总余额 > 此值方可签发救济
  ledgerReliefFamilyThreshold: 8.0, // 极贫家庭门槛：家户账面水+粮总额 < 此值视为极贫
  ledgerReliefCooldownTicks: 1200,  // 救济冷却 (tick)，每家户每 N tick 最多接收一次救济
  prestigeKingBonus: 3,             // 国王登基任职威望奖励

  // ==========================================================================
  // 13. 外部市场（榷场互市）与幂律动态定价 (External Market & Dynamic Pricing)
  // ==========================================================================
  countMarkets: 1,                          // 全图生成外部市场 POI 数量
  marketStockMaxWater: 100.0,               // 外部市场清水储备容量上限
  marketStockMaxFood: 100.0,                // 外部市场粮食储备容量上限
  marketRegenBaseWater: 2.0,                // 外部市场清水每秒自然再生速率
  marketRegenBaseFood: 2.0,                 // 外部市场粮食每秒自然再生速率
  marketPriceBase: 0.1,                     // 满库存起步基准单价 (黄金 / 单位资源)
  marketPricePowerExponent: 2.0,            // 幂律定价指数 k
  marketPriceFloorStock: 1.0,               // 计价库存钳制下限 (防除零与价格封顶)
  marketEmergencyFamilyStockThreshold: 10.0,// 家户物资绝境警戒线
  marketMinFamilyGold: 0.5,                 // 户主准入起步黄金底线
  marketMinDispatchStamina: 15.0,           // 户主出发前往市场的最低体力门槛

  // ==========================================================================
  // 14. 二手房屋市场、营地中介拍卖与麦穗竞价 (Housing Market & Auction)
  // ==========================================================================
  houseAuctionBidCooldownTicks: 300,  // 买家全局出价冷却 (tick，默认 300 = 10 模拟秒，出价后对任何房屋都不再出价)
  houseAuctionDeadlineDurability: 10.0,// 最晚出售修缮度时限 (耐久度跌至此值时只要有新报价即成交)
  houseAuctionObservationRatio: 0.37,  // 麦穗理论最优停止观察期比例 (37%)
  houseAuctionMinBidGold: 0.01,       // 单次出价最低家户黄金门槛 (低于此值不出价)
  houseAuctionBidHistoryCapacity: 128, // 单次拍卖会话报价流水环形缓冲容量 (条)
  houseAuctionCrownShareWeight: 1.0,  // 王国公户遗产分账份额权重 (与人类受益人同等参与份额制分配，无人类受益人时独得全额)
  marketPriceBaseWood: 0.15,          // 木材基准金价 (保留：待榷市扩展承载木材后作单价基准)
  marketPriceBaseStone: 0.20,         // 石料基准金价 (保留：待榷市扩展承载石料后作单价基准)
};
