# Flow & Accord · 仿真超参数速查表 (config-reference.md)

> 本表由 `tools/config-check.js` 自动生成，反映 `config.js` 与 Rust `SimConfig` 的权威字段、类型、默认值与中文说明。
> 调参只需修改 `frontend/js/config.js`（无需重编译），修改后运行 `node tools/config-check.js` 校验一致性。

## 9. 动力学移动与寻路权重

| 字段 (camelCase) | 类型 | 默认值 | 中文说明 |
| :--- | :--- | :--- | :--- |
| `simulationDt` | f32 | 0.03333333333333333 | 单个 tick 对应的模拟秒数 (1/30) |
| `ticksPerSecond` | u64 | 30 | 每秒 tick 数（决定模拟实时倍速基准） |
| `agentDecisionIntervalTicks` | u64 | 30 | 每个族人错峰决策间隔 (tick)，平均 1 秒决策一次 |
| `agentHungerCapacity` | f32 | 50 | 饱食度容量上限 |
| `agentThirstCapacity` | f32 | 50 | 水分容量上限 |
| `agentInitialHunger` | f32 | 25 | 始祖/新生儿初始饱食度 |
| `agentInitialThirst` | f32 | 25 | 始祖/新生儿初始水分 |
| `agentInitialStamina` | f32 | 95 | 始祖初始体力 |
| `agentBaseMetabolismDecay` | f32 | 0.1 | 基础代谢消耗速率 (饱食/水分 每秒) |
| `agentHealthDecayPerSec` | f32 | 0.01 | 濒死健康衰减速率 (每秒) |
| `agentPregnantMetabolismMult` | f32 | 1.25 | 孕期代谢消耗倍率 |
| `agentWorkMetabolismMult` | f32 | 1 | 劳作代谢消耗倍率 |
| `agentDeathDecayDuration` | f32 | 12 | 生命耗尽后彻底消亡的衰减时长 (秒) |
| `agentAdultAge` | f32 | 1800 | 成年年龄阈值 (模拟秒，= 60 分钟) |
| `agentPregnancyDuration` | f32 | 900 | 妊娠期时长 (模拟秒，= 30 分钟) |
| `agentMiscarriageThreshold` | f32 | 10 | 饥渴任一低于此值即触发流产风险 |
| `agentMiscarriageStaminaThreshold` | f32 | 20 | 体力低于此值即触发流产风险 |
| `agentMiscarriageCooldown` | f32 | 450 | 流产后休养冷却 (秒，期间禁止再次受孕) |
| `agentMiscarriageAlertDuration` | f32 | 5 | 流产告警存续时长 (秒) |
| `agentConceptionHungerMin` | f32 | 40 | 受孕所需最低饱食度 |
| `agentConceptionThirstMin` | f32 | 40 | 受孕所需最低水分 |
| `agentConceptionStaminaMin` | f32 | 80 | 受孕所需最低体力 |
| `carryCapacityResource` | f32 | 50 | 单类资源随身行囊容量 (水/粮/木/石 互不共享) |
| `agentGoldLoadFull` | f32 | 20 | 单趟淘金运满入库量 |
| `agentBaseMoveSpeedMult` | f32 | 4 | 基础移动速度倍率 |
| `agentStaminaCapacity` | f32 | 100 | 体力值上限 (%) |
| `agentStealthVisibilityCovert` | f32 | 0.25 | 隐秘特工可见度 |
| `agentStealthVisibilityNormal` | f32 | 1 | 普通族人可见度 |
| `agentRestStaminaRecoveryRate` | f32 | 8 | 营地/家宅休息时基础体力恢复速率 (每秒，乘睡眠效率) |
| `agentConstructStaminaBurn` | f32 | 3.5 | 营建/升级房屋体力消耗速率 (每秒) |
| `agentRepairStaminaBurn` | f32 | 2.5 | 修缮房屋体力消耗速率 (每秒) |
| `agentGatherStaminaBurn` | f32 | 2 | 伐木/采石/淘金体力消耗速率 (每秒) |
| `agentLaborStaminaFloor` | f32 | 5 | 劳作体力消耗后的最低保留体力下限 |
| `agentDigestionRatioMin` | f32 | 0.2 | 消化效率影响代谢的系数下限 |
| `agentDigestionRatioMax` | f32 | 5 | 消化效率影响代谢的系数上限 |
| `agentSelfSatisfiedThreshold` | f32 | 49.9 | 自饮自食「已满足」判定阈值 (≥ 视为饱腹/解渴) |
| `agentNewbornHunger` | f32 | 25 | 新生儿初始饱食度 |
| `agentNewbornThirst` | f32 | 25 | 新生儿初始水分 |
| `agentNewbornStamina` | f32 | 100 | 新生儿初始体力 (%) |
| `agentSpawnCount` | usize | 20 | 每局播撒的初始始祖族人数量 |
| `agentCovertEveryN` | usize | 4 | 每第 N 名始祖设为隐秘特工 (i % N == 0) |
| `agentSpawnJitter` | f32 | 10 | 始祖初始属性随机抖动幅度 (±) |
| `agentSpawnHungerBase` | f32 | 25 | 始祖初始饱食抖动基线 |
| `agentSpawnHungerClampMin` | f32 | 10 | 始祖初始饱食夹取下限 |
| `agentSpawnHungerClampMax` | f32 | 45 | 始祖初始饱食夹取上限 |
| `agentSpawnStaminaBase` | f32 | 90 | 始祖初始体力抖动基线 |
| `agentSpawnStaminaClampMin` | f32 | 55 | 始祖初始体力夹取下限 |
| `agentSpawnStaminaClampMax` | f32 | 100 | 始祖初始体力夹取上限 |
| `agentSpawnBaseSpeed` | f32 | 8.5 | 所有 agent 共用的基础默认行走速度 |
| `traitDefaultMean` | f32 | 100 | 禀赋基准均值 |
| `traitInitialStdDev` | f32 | 20 | 始祖禀赋初始标准差 |
| `traitMutationDelta` | f32 | 10 | 遗传突变偏移量 |
| `traitInheritClampMin` | f32 | 10 | 遗传继承单项禀赋夹取下限 |
| `traitInheritClampMax` | f32 | 190 | 遗传继承单项禀赋夹取上限 |
| `poiMinDistance` | f32 | 70 | POI 间最小排斥间距 (m) |
| `countCamps` | usize | 5 | 营地数量 |
| `countWaterSources` | usize | 6 | 清泉数量 |
| `countBerryBushes` | usize | 6 | 浆果数量 |
| `countWoods` | usize | 3 | 林木数量 |
| `countStoneMines` | usize | 2 | 石矿数量 |
| `countGoldMines` | usize | 1 | 金矿数量 |
| `stockMaxWater` | f32 | 100 | 清泉储量上限 |
| `stockMaxBerry` | f32 | 100 | 浆果储量上限 |
| `stockMaxWood` | f32 | 100 | 林木储量上限 |
| `stockMaxStone` | f32 | 100 | 石矿储量上限 |
| `stockMaxGold` | f32 | 100 | 金矿储量上限 |
| `regenBaseWater` | f32 | 2 | 清泉基础再生速率 (单位/秒) |
| `regenBaseBerry` | f32 | 2 | 浆果基础再生速率 |
| `regenBaseWood` | f32 | 2 | 林木基础再生速率 |
| `regenBaseStone` | f32 | 2 | 石矿基础再生速率 |
| `regenBaseGold` | f32 | 1.8 | 金矿基础再生速率 |
| `poiInteractionRateResource` | f32 | 10 | 资源 POI 现场采收速率 (单位/秒) |
| `poiInteractionRateGold` | f32 | 5 | 金矿现场采收速率 (单位/秒) |
| `poiUnloadRateResource` | f32 | 10 | 资源入库卸货速率 (单位/秒) |
| `poiUnloadRateGold` | f32 | 5 | 黄金入库卸货速率 (单位/秒) |
| `poiSpawnRadiusCamp` | f32 | 0.7 | 营地撒点半径占半图比例 |
| `poiSpawnRadiusResource` | f32 | 0.8 | 资源 POI 撒点半径占半图比例 |
| `poiSpawnFallbackRatio` | f32 | 0.6 | 紧密撒点回退最小间距比例 (min_distance × N) |
| `countTerrainTransitionNodes` | usize | 17 | 地形过渡节点数量 (路网骨架) |
| `poiSpawnSpreadRatio` | f32 | 0.85 | 地形过渡节点散布范围占半图比例 |
| `roadConnectNearDist` | f32 | 175 | 路网直连近距阈值 (≤ 双向铺装) |
| `roadConnectFarDist` | f32 | 320 | 路网直连远距阈值 (≤ 单向泥径) |
| `roadGradePaveThreshold` | f32 | 8 | 坡度铺装阈值 (高差超过则盘山道，否则泥径) |
| `poiInteractionRadius` | f32 | 22 | 采收现场「已抵达 POI」判定半径 (m) |
| `campHomeConsumeRate` | f32 | 3 | 营地/家宅休息自饮自食消耗速率 (单位/秒) |
| `decisionPoiSeekMinStockRatio` | f32 | 0.3 | POI 私有施密特触发器开启阈值 (库存 ≥ 此比例) |
| `decisionPoiAbandonStockRatio` | f32 | 0.1 | POI 私有施密特触发器关闭阈值 (库存 < 此比例) |
| `decisionCriticalThirst` | f32 | 25 | 临界口渴阈值 (触发寻水) |
| `decisionCriticalHunger` | f32 | 25 | 临界饥饿阈值 (触发觅食) |
| `decisionRestStaminaTarget` | f32 | 100 | 休息目标体力 |
| `decisionStockGoldCooldown` | f32 | 45 | 盖房备料淘金冷却 (秒) |
| `decisionGoldWealthCooldown` | f32 | 180 | 4 级庄园竣工前娱乐淘金冷却 (秒) |
| `decisionHouseRepairNeedThreshold` | f32 | 50 | 房屋耐久低于此值触发修缮需求 |
| `decisionFoundHomeHungerMin` | f32 | 20 | 立宅所需最低饱食度 |
| `decisionFoundHomeThirstMin` | f32 | 20 | 立宅所需最低水分 |
| `decisionFoundHomeStaminaMin` | f32 | 60 | 立宅所需最低体力 |
| `decisionFoundHomeCandidates` | usize | 12 | 立宅候选点数量 |
| `decisionFoundHomeDistMin` | f32 | 24 | 立宅候选点与现有房屋的硬间距下限 (m) |
| `decisionFoundHomeDistMax` | f32 | 80 | 立宅候选点与营地的软间距上限 (m) |
| `decisionWorkStaminaThreshold` | f32 | 50 | 劳作所需最低体力 (低于则返家休息) |
| `houseDurabilityMax` | f32 | 100 | 房屋耐久上限 |
| `houseDepreciationRate` | f32 | 0.02 | 房屋耐久自然折旧速率 (每秒) |
| `houseRepairTriggerThreshold` | f32 | 80 | 耐久低于此值允许修缮 |
| `houseRepairSpeed` | f32 | 5 | 修缮进度速率 (每秒) |
| `houseBuildTimeTier0To1` | f32 | 30 | 0→1 级建造时长 (秒) |
| `houseBuildTimeTier1To2` | f32 | 45 | 1→2 级建造时长 |
| `houseBuildTimeTier2To3` | f32 | 60 | 2→3 级建造时长 |
| `houseBuildTimeTier3To4` | f32 | 90 | 3→4 级建造时长 |
| `houseCapacityTier0` | f32 | 20 | 0 级仓库仓储容量 |
| `houseCapacityTier1` | f32 | 40 | 1 级茅草房仓储容量 |
| `houseCapacityTier2` | f32 | 80 | 2 级半棚屋仓储容量 |
| `houseCapacityTier3` | f32 | 120 | 3 级木石庄舍仓储容量 |
| `houseCapacityTier4` | f32 | 160 | 4 级大庄园仓储容量 |
| `houseUpgradeTier0WaterRatio` | f32 | 0.9 | 0 级升级所需水占比 |
| `houseUpgradeTier0FoodRatio` | f32 | 0.9 | 0 级升级所需粮占比 |
| `houseUpgradeTier1WoodRatio` | f32 | 0.85 | 1 级升级所需木占比 |
| `houseUpgradeTier1FoodWaterRatio` | f32 | 0.5 | 1 级升级所需水粮占比 |
| `houseUpgradeTier2StoneRatio` | f32 | 0.85 | 2 级升级所需石占比 |
| `houseUpgradeTier2OtherRatio` | f32 | 0.5 | 2 级升级所需水粮木占比 |
| `houseUpgradeTier3GoldStoneRatio` | f32 | 0.85 | 3 级升级所需金石占比 |
| `houseUpgradeTier3OtherRatio` | f32 | 0.5 | 3 级升级所需水粮木占比 |
| `houseFertilityStockRatio` | f32 | 0.5 | 户主受孕所需仓储充裕比例 |
| `houseWinterWoodBurnRate` | f32 | 0.12 | 冬季供暖木材消耗速率 (每秒) |
| `houseWinterColdTemp` | f32 | 5 | 低温供暖阈值 (℃) |
| `houseMinSpacing` | f32 | 20 | 房屋间最小水平间距 (m) |
| `houseNodeReuseRadius` | f32 | 20 | 立宅优先复用空置路网节点检索半径 (m) |
| `houseNodePoiOccupyRadius` | f32 | 1.5 | 判定节点被 POI 占用的贴合半径 (m) |
| `seasonYearLength` | f32 | 240 | 一年 (四季) 总时长 (模拟秒) |
| `tempBaseMid` | f32 | 14 | 年均基准温度 (℃) |
| `tempAmplitude` | f32 | 17 | 季节温度振幅 (℃) |
| `roadWearDecayRate` | f32 | 0.0067 | 道路自然杂草衰减速率 (%/秒,相对当前磨损比例衰减) |
| `roadWearStepInc` | f32 | 0.05 | 族人单次通行踩踏增量 (等级/次) |
| `roadMaxWear` | f32 | 5 | 道路磨损上限 |
| `roadSpeedDirtTrack` | f32 | 36 | 泥泞小径限速 |
| `roadSpeedCobblestone` | f32 | 44 | 碎石盘山道限速 |
| `roadSpeedAsphaltUrban` | f32 | 60 | 城镇大道限速 |
| `roadSpeedSkywayElevated` | f32 | 96 | 高架飞索限速 |
| `roadSpeedSmugglerTrail` | f32 | 40 | 私贩密径限速 |
| `roadLevelFactorBase` | f32 | 0.5 | 道路等级影响移速基准系数 (等级 0) |
| `roadLevelFactorWearCoef` | f32 | 0.333 | 道路等级影响移速磨损系数 |
| `roadLevelFactorMin` | f32 | 0.5 | 道路等级移速乘子下限 |
| `roadLevelFactorMax` | f32 | 2.2 | 道路等级移速乘子上限 |
| `agentMoveStaminaBase` | f32 | 0.6 | 移动基础体力消耗 (每秒) |
| `agentMoveStaminaPregnant` | f32 | 0.3 | 孕期额外移动体力消耗 (每秒) |
| `agentMoveStaminaGradeCoef` | f32 | 3.5 | 坡度对移动体力消耗加成系数 |
| `agentMoveAccelCoef` | f32 | 4 | 移动加速度收敛系数 |
| `roadAstarGradePenaltyCoef` | f32 | 1.5 | A* 坡度通行代价惩罚系数 |
| `roadAstarHeuristicDivisor` | f32 | 80 | A* 启发式距离除数 |
| `roadHiddenPreferModifier` | f32 | 0.4 | A* 偏好隐秘时隐秘道路代价乘子 |
| `roadVisiblePreferModifier` | f32 | 1.2 | A* 偏好隐秘时公开道路代价乘子 |
| `roadHiddenAvoidModifier` | f32 | 2.5 | A* 非偏好隐秘时隐秘道路代价乘子 |
| `roadVisibleAvoidModifier` | f32 | 1 | A* 非偏好隐秘时公开道路代价乘子 |
