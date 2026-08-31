// ============================================================================
// Flow & Accord · 仿真超参数集中配置文件 (config.js)
//
// 本文件集中归档全系统所有动力学、生理代谢、生态演化、房屋营造、
// 马斯洛决策门槛、四季环境与路网踩踏超参数。
// 💡 修改本文件中的数值后，仅需刷新浏览器（或在控制台调用 sim.applyConfig()）即可生效，
// 无需重新编译 Rust / WASM 内核！
// ============================================================================

window.SIM_CONFIG = {
  // ==========================================================================
  // 1. 引擎节拍与时间基准 (Simulation Time & Ticks)
  // ==========================================================================
  /** 基础仿真时间微步步长 (秒)，对应 30 FPS 锁定帧率 (1/30 = 0.033333s) */
  simulationDt: 1.0 / 30.0,
  /** 每秒对应的引擎 Tick 步数 */
  ticksPerSecond: 30,
  /** 部落民错峰决策相位周期 (每 30 ticks = 1.0 秒决策一次) */
  agentDecisionIntervalTicks: 30,

  // ==========================================================================
  // 2. 部落民生理、代谢与生命周期 (Agent Physiology & Lifecycle)
  // ==========================================================================
  /** 部落民饱食度上限 (单位) */
  agentHungerCapacity: 50.0,
  /** 部落民水分值上限 (单位) */
  agentThirstCapacity: 50.0,
  /** 部落民初始饱食度 (初始 50% = 25.0 单位) */
  agentInitialHunger: 25.0,
  /** 部落民初始水分值 (初始 50% = 25.0 单位) */
  agentInitialThirst: 25.0,
  /** 部落民初始体力值 (%) */
  agentInitialStamina: 95.0,
  /** 部落民正常基准代谢消耗速率 (单位/秒，未怀孕状态下每10秒消耗1单位 = 0.10/s) */
  agentBaseMetabolismDecay: 0.10,
  /** 部落民健康值每秒自然衰减速率 (单位/秒，不可补充，归零即老死；0.01/s 对应约 5000s 寿命) */
  agentHealthDecayPerSec: 0.01,
  /** 孕期女性代谢加速倍率 (1.25x，即 0.125 单位/秒) */
  agentPregnantMetabolismMult: 1.25,
  /** 重体力劳动 (营建/修缮/采伐/挖矿) 代谢加速倍率 (1.0x) */
  agentWorkMetabolismMult: 1.0,
  /** 尸体在荒野中留存衰变时长 (秒) */
  agentDeathDecayDuration: 12.0,
  /** 部落民成年年龄门槛 (秒，年满 1800 秒方可结婚与受孕) */
  agentAdultAge: 1800.0,
  /** 女性妊娠孕期总时长 (秒，900 秒孕期) */
  agentPregnancyDuration: 900.0,
  /** 妊娠流产危险线: 饱食/水分指标跌破此值即发生流产 (20% 警戒线 = 10.0 单位) */
  agentMiscarriageThreshold: 10.0,
  /** 妊娠流产体力危险线: 体力跌破此百分比即发生流产 (20.0%) */
  agentMiscarriageStaminaThreshold: 20.0,
  /** 流产后休养冷却时长 (秒，期间禁止再次受孕，600 秒休养) */
  agentMiscarriageCooldown: 600.0,
  /** 流产警告警报留存显示时长 (秒) */
  agentMiscarriageAlertDuration: 5.0,
  /** 受孕门槛: 女性饱食度最低要求 (≥80% = 40.0 单位) */
  agentConceptionHungerMin: 40.0,
  /** 受孕门槛: 女性水分值最低要求 (≥80% = 40.0 单位) */
  agentConceptionThirstMin: 40.0,
  /** 受孕门槛: 女性体力值最低要求 (≥80.0%) */
  agentConceptionStaminaMin: 80.0,
  /** 随身行囊单品类独立容量上限 (水/粮/木/石 各 50.0 单位，互不共享) */
  carryCapacityResource: 50.0,
  /** 单趟淘金黄金满载运载量 (黄金随身无限容量，但达到 20.0 触发返家入库) */
  agentGoldLoadFull: 20.0,
  /** 荒野越野无路行走的移速衰减系数 (50%) */
  agentOffroadSpeedFactor: 0.50,
  /** 基础公路移速相对于默认基准的倍率 (4.0x) */
  agentBaseMoveSpeedMult: 4.0,
  /** 隐秘特工小人的能见度可见度系数 (0.25) */
  agentStealthVisibilityCovert: 0.25,
  /** 普通部落民的能见度可见度系数 (1.0) */
  agentStealthVisibilityNormal: 1.0,

  // ==========================================================================
  // 3. 先天禀赋与遗传演化 (Genetics & Inherited Traits)
  // ==========================================================================
  /** 始祖代先天禀赋均值 (智力/力量/魅力/消化/睡眠/寿命) */
  traitDefaultMean: 100.0,
  /** 始祖代先天禀赋正态分布标准差 (N(100, 20)，95% 族人落在 60~140) */
  traitInitialStdDev: 20.0,
  /** 后代继承变异扰动范围 (父母均值 ±10.0 × 线性随机数) */
  traitMutationDelta: 10.0,

  // ==========================================================================
  // 4. 生态地标与 POI 采收交互 (POI & Ecology Generation)
  // ==========================================================================
  /** POI 地标空间排斥最小间距 (米) */
  poiMinDistance: 70.0,
  /** 全图避风营地数量 (处) */
  countCamps: 5,
  /** 全图清泉水源数量 (处) */
  countWaterSources: 6,
  /** 全图浆果灌木数量 (处) */
  countBerryBushes: 6,
  /** 全图林木林地数量 (处) */
  countWoods: 3,
  /** 全图嶙峋石矿数量 (处) */
  countStoneMines: 2,
  /** 全图璀璨金矿数量 (处) */
  countGoldMines: 1,
  /** 清泉水源最大可用储量上限 (单位) */
  stockMaxWater: 100.0,
  /** 浆果灌木最大可用储量上限 (单位) */
  stockMaxBerry: 100.0,
  /** 森林木材最大可用储量上限 (单位) */
  stockMaxWood: 100.0,
  /** 石矿石料最大可用储量上限 (单位) */
  stockMaxStone: 100.0,
  /** 金矿黄金最大可用储量上限 (单位) */
  stockMaxGold: 100.0,
  /** 清泉水源自然基准产出速率 (单位/秒) */
  regenBaseWater: 2.0,
  /** 浆果灌木自然基准生长速率 (单位/秒) */
  regenBaseBerry: 2.0,
  /** 林木成材自然基准生成速率 (单位/秒) */
  regenBaseWood: 2.0,
  /** 石矿矿脉自然基准沉积速率 (单位/秒) */
  regenBaseStone: 2.0,
  /** 金矿黄金自然基准淘洗速率 (单位/秒) */
  regenBaseGold: 1.8,
  /** 水/果/木/石现场采收与行囊装载速率 (单位/秒) */
  poiInteractionRateResource: 10.0,
  /** 金矿现场淘洗与装载速率 (单位/秒) */
  poiInteractionRateGold: 5.0,
  /** 营地/家宅休息时的体力恢复基础速率 (%/秒) */
  campRestStaminaRecoveryRate: 20.0,
  /** 随身物资回家卸货存入家宅仓库速率 (单位/秒) */
  poiUnloadRateResource: 10.0,
  /** 黄金回家卸货存入家宅金库速率 (单位/秒) */
  poiUnloadRateGold: 5.0,

  // ==========================================================================
  // 5. 马斯洛需求与决策门槛 (Maslow Needs & Decision Thresholds)
  // ==========================================================================
  /** 启动寻路门槛: POI 储量低于此比例时排除在候选池外，绝不前往 (≥30%) */
  decisionPoiSeekMinStockRatio: 0.30,
  /** 中途放弃熔断门槛: 赶路途中目标 POI 储量跌破此比例时立即掉头放弃 (<10%) */
  decisionPoiAbandonStockRatio: 0.10,
  /** 生理口渴告急门槛: 水分值低于此值触发饮水需求 (25.0 单位) */
  decisionCriticalThirst: 25.0,
  /** 生理饥饿告急门槛: 饱食度低于此值触发觅食需求 (25.0 单位) */
  decisionCriticalHunger: 25.0,
  /** 生理疲惫告急门槛: 体力低于此百分比触发归巢休整 (30.0%) */
  decisionCriticalStamina: 30.0,
  /** 归巢休整目标: 一旦开始休息，必须充盈至此百分比方可解除休息 (100.0%) */
  decisionRestStaminaTarget: 100.0,
  /** 采金备料冷却时长 (秒，为3级庄舍升级大庄园备料) */
  decisionStockGoldCooldown: 45.0,
  /** 娱乐性淘金冷却时长 (秒，4级大庄园竣工后的自我实现娱乐) */
  decisionGoldWealthCooldown: 180.0,
  /** 房屋修缮需求门槛: 耐久度跌破此百分比产生修缮意愿 (50.0%) */
  decisionHouseRepairNeedThreshold: 50.0,
  /** 体力充沛时的富余觅食概率 (8%) */
  decisionForageSurplusChance: 0.08,

  // ==========================================================================
  // 6. 私宅营造、代际传承与升级 (Housing System)
  // ==========================================================================
  /** 房屋耐久度满值 (100.0) */
  houseDurabilityMax: 100.0,
  /** 房屋自然风化折旧速率 (耐久度/秒) */
  houseDepreciationRate: 0.02,
  /** 房屋安排修缮开工门槛: 耐久度跌破此百分比安排户主/配偶修缮 (80.0%) */
  houseRepairTriggerThreshold: 80.0,
  /** 房屋修缮劳作回血速率 (耐久度/秒) */
  houseRepairSpeed: 5.0,
  /** 0级仓库升1级茅草房所需建造工时 (秒) */
  houseBuildTimeTier0To1: 30.0,
  /** 1级茅草房升2级私宅所需建造工时 (秒) */
  houseBuildTimeTier1To2: 45.0,
  /** 2级私宅升3级庄舍所需建造工时 (秒) */
  houseBuildTimeTier2To3: 60.0,
  /** 3级庄舍升4级大庄园所需建造工时 (秒) */
  houseBuildTimeTier3To4: 90.0,
  /** 0级仓库分品类仓储上限 (各 20.0 单位) */
  houseCapacityTier0: 20.0,
  /** 1级茅草房分品类仓储上限 (各 40.0 单位) */
  houseCapacityTier1: 40.0,
  /** 2级私宅分品类仓储上限 (各 80.0 单位) */
  houseCapacityTier2: 80.0,
  /** 3级庄舍分品类仓储上限 (各 120.0 单位) */
  houseCapacityTier3: 120.0,
  /** 4级大庄园分品类仓储上限 (各 160.0 单位) */
  houseCapacityTier4: 160.0,
  /** 0级仓库升级水粮储备比例要求 (各 90%) */
  houseUpgradeTier0WaterRatio: 0.90,
  houseUpgradeTier0FoodRatio: 0.90,
  /** 1级茅草房升级木材储备比例要求 (85%) */
  houseUpgradeTier1WoodRatio: 0.85,
  /** 1级茅草房升级水粮保底储备比例要求 (50%) */
  houseUpgradeTier1FoodWaterRatio: 0.50,
  /** 2级私宅升级石料储备比例要求 (85%) */
  houseUpgradeTier2StoneRatio: 0.85,
  /** 2级私宅升级水粮木保底储备比例要求 (50%) */
  houseUpgradeTier2OtherRatio: 0.50,
  /** 3级庄舍升级黄金与石料储备比例要求 (各 85%) */
  houseUpgradeTier3GoldStoneRatio: 0.85,
  /** 3级庄舍升级水粮木保底储备比例要求 (50%) */
  houseUpgradeTier3OtherRatio: 0.50,
  /** 房屋激活生育支持所需物资比例 (水粮木均 ≥ 50%) */
  houseFertilityStockRatio: 0.50,
  /** 冬季房屋取暖木材燃烧速率 (单位/秒) */
  houseWinterWoodBurnRate: 0.12,
  /** 低温触发取暖气温阈值 (°C) */
  houseWinterColdTemp: 5.0,

  // ==========================================================================
  // 7. 四季更迭与宏观气候 (Seasons & Macro Climate)
  // ==========================================================================
  /** 完整年轮周期时长 (秒，240 秒一年) */
  seasonYearLength: 240.0,
  /** 单一季度时长 (秒，每季 60 秒) */
  seasonQuarterLength: 60.0,
  /** 年均气温基准中值 (°C) */
  tempBaseMid: 14.0,
  /** 季节气温波动正弦振幅 (°C，-3°C ~ 31°C) */
  tempAmplitude: 17.0,

  // ==========================================================================
  // 8. 空间路网、限速与踩踏演化 (Roads & Wear Evolution)
  // ==========================================================================
  /** 道路自然杂草丛生踩踏衰减速率 (等级/秒) */
  roadWearDecayRate: 0.0005,
  /** 族人单次通行踩踏增量 (等级/次) */
  roadWearStepInc: 0.005,
  /** 踩踏道路最高等级上限 (5.0) */
  roadMaxWear: 5.0,
  /** 泥泞小径基准限速 (m/s) */
  roadSpeedDirtTrack: 36.0,
  /** 碎石盘山道基准限速 (m/s) */
  roadSpeedCobblestone: 44.0,
  /** 沥青主干道基准限速 (m/s) */
  roadSpeedAsphaltUrban: 60.0,
  /** 悬空高架快速路基准限速 (m/s) */
  roadSpeedSkywayElevated: 96.0,
  /** 走私暗道基准限速 (m/s) */
  roadSpeedSmugglerTrail: 40.0,
};
