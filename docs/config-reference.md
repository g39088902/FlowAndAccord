# Flow & Accord · 仿真超参数速查表 (config-reference.md)

> 本表由 `tools/config-check.js` 自动生成，反映 `config.js` 与 Rust `SimConfig` 的权威字段、类型、默认值与中文说明。
> 调参只需修改 `frontend/js/config.js`（无需重编译），修改后运行 `node tools/config-check.js` 校验一致性。

## 12. 地区与王国系统

| 字段 (camelCase) | 类型 | 默认值 | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `simulationDt` | f32 | 0.03333333333333333 | world_tick.rs / sim_wasm (§4.3 严禁改) | 单个 tick 对应的模拟秒数 (1/30) |
| `ticksPerSecond` | u64 | 30 | world_tick.rs / rustworld.js | 每秒 tick 数（决定模拟实时倍速基准） |
| `agentDecisionIntervalTicks` | u64 | 30 | decisions/scheduler.rs (§4.3 错峰相位) | 每个族人错峰决策间隔 (tick)，平均 1 秒决策一次 |
| `agentHungerCapacity` | f32 | 50 | agent.rs (饱食容量) | 饱食度容量上限 |
| `agentThirstCapacity` | f32 | 50 | agent.rs (水分容量) | 水分容量上限 |
| `agentInitialHunger` | f32 | 25 | agent.rs (初始属性) | 始祖/新生儿初始饱食度 |
| `agentInitialThirst` | f32 | 25 | agent.rs (初始属性) | 始祖/新生儿初始水分 |
| `agentInitialStamina` | f32 | 95 | agent.rs (初始属性) | 始祖初始体力 |
| `agentBaseMetabolismDecay` | f32 | 0.1 | agent.rs (基础代谢/速度) | 基础代谢消耗速率 (饱食/水分 每秒) |
| `agentHealthDecayPerSec` | f32 | 0.01 | agent.rs (健康衰减) | 濒死健康衰减速率 (每秒) |
| `agentPregnantMetabolismMult` | f32 | 1.25 | agent.rs (妊娠代谢) | 孕期代谢消耗倍率 |
| `agentWorkMetabolismMult` | f32 | 1 | agent.rs (劳作代谢) | 劳作代谢消耗倍率 |
| `agentDeathDecayDuration` | f32 | 12 | agent.rs (死亡衰减) | 生命耗尽后彻底消亡的衰减时长 (秒) |
| `agentAdultAge` | f32 | 1800 | agent.rs (成年阈值) / decisions/ | 成年年龄阈值 (模拟秒，= 60 分钟) |
| `agentPregnancyDuration` | f32 | 900 | agent.rs (妊娠代谢) | 妊娠期时长 (模拟秒，= 30 分钟) |
| `agentMiscarriageThreshold` | f32 | 10 | agent.rs (流产判定) | 饥渴任一低于此值即触发流产风险 |
| `agentMiscarriageStaminaThreshold` | f32 | 20 | agent.rs (流产判定) | 体力低于此值即触发流产风险 |
| `agentMiscarriageCooldown` | f32 | 450 | agent.rs (流产判定) | 流产后休养冷却 (秒，期间禁止再次受孕) |
| `agentPostpartumCooldown` | f32 | 900 | agent.rs (产后休养冷却) | 产后休养冷却 (秒，分娩后期间禁止再次受孕) |
| `agentMiscarriageAlertDuration` | f32 | 5 | agent.rs (流产判定) | 流产告警存续时长 (秒) |
| `agentConceptionHungerMin` | f32 | 40 | agent.rs (受孕判定) | 受孕所需最低饱食度 |
| `agentConceptionThirstMin` | f32 | 40 | agent.rs (受孕判定) | 受孕所需最低水分 |
| `agentConceptionStaminaMin` | f32 | 80 | agent.rs (受孕判定) | 受孕所需最低体力 |
| `carryCapacityResource` | f32 | 50 | agent.rs / ecology.rs / decisions/ | 单类资源随身行囊容量 (水/粮/木/石 互不共享) |
| `agentGoldLoadFull` | f32 | 20 | agent.rs (淘金行囊) / ecology.rs | 单趟淘金运满入库量 |
| `agentBaseMoveSpeedMult` | f32 | 4 | agent.rs (基础代谢/速度) | 基础移动速度倍率 |
| `agentStaminaCapacity` | f32 | 100 | agent.rs (体力容量) | 体力值上限 (%) |
| `agentStealthVisibilityCovert` | f32 | 0.25 | agent.rs (隐秘可见度) | 隐秘特工可见度 |
| `agentStealthVisibilityNormal` | f32 | 1 | agent.rs (隐秘可见度) | 普通族人可见度 |
| `agentRestStaminaRecoveryRate` | f32 | 8 | agent.rs (休息恢复) / ecology.rs | 营地/家宅休息时基础体力恢复速率 (每秒，乘睡眠效率) |
| `agentRepairStaminaBurn` | f32 | 2.5 | housing_system/maintenance.rs (修缮体力) | 修缮房屋体力消耗速率 (每秒) |
| `agentGatherStaminaBurn` | f32 | 2 | ecology.rs (采收体力) | 伐木/采石/淘金体力消耗速率 (每秒) |
| `agentLaborStaminaFloor` | f32 | 5 | agent.rs (劳作体力下限) | 劳作体力消耗后的最低保留体力下限 |
| `agentDigestionRatioMin` | f32 | 0.2 | agent.rs (消化效率代谢系数) | 消化效率影响代谢的系数下限 |
| `agentDigestionRatioMax` | f32 | 5 | agent.rs (消化效率代谢系数) | 消化效率影响代谢的系数上限 |
| `agentSelfSatisfiedThreshold` | f32 | 49.9 | ecology.rs (自饮自食阈值) | 自饮自食「已满足」判定阈值 (≥ 视为饱腹/解渴) |
| `agentNewbornHunger` | f32 | 25 | birth.rs (新生儿属性) / agent.rs | 新生儿初始饱食度 |
| `agentNewbornThirst` | f32 | 25 | birth.rs (新生儿属性) / agent.rs | 新生儿初始水分 |
| `agentNewbornStamina` | f32 | 100 | birth.rs (新生儿属性) / agent.rs | 新生儿初始体力 (%) |
| `agentSpawnCount` | usize | 20 | ecology.rs (始祖播撒) / agent.rs | 每局播撒的初始始祖族人数量 |
| `agentCovertEveryN` | usize | 4 | ecology.rs (始祖隐秘特工比例) | 每第 N 名始祖设为隐秘特工 (i % N == 0) |
| `agentSpawnJitter` | f32 | 10 | ecology.rs (始祖播撒) / agent.rs | 始祖初始属性随机抖动幅度 (±) |
| `agentSpawnHungerBase` | f32 | 25 | ecology.rs (始祖播撒) / agent.rs | 始祖初始饱食抖动基线 |
| `agentSpawnHungerClampMin` | f32 | 10 | ecology.rs (始祖播撒) / agent.rs | 始祖初始饱食夹取下限 |
| `agentSpawnHungerClampMax` | f32 | 45 | ecology.rs (始祖播撒) / agent.rs | 始祖初始饱食夹取上限 |
| `agentSpawnStaminaBase` | f32 | 90 | ecology.rs (始祖播撒) / agent.rs | 始祖初始体力抖动基线 |
| `agentSpawnStaminaClampMin` | f32 | 55 | ecology.rs (始祖播撒) / agent.rs | 始祖初始体力夹取下限 |
| `agentSpawnStaminaClampMax` | f32 | 100 | ecology.rs (始祖播撒) / agent.rs | 始祖初始体力夹取上限 |
| `agentSpawnBaseSpeed` | f32 | 8.5 | agent.rs / graph.rs (寻路速度基准) | 所有 agent 共用的基础默认行走速度 |
| `traitDefaultMean` | f32 | 100 | agent.rs / birth.rs (禀赋遗传演化) | 禀赋基准均值 |
| `traitInitialStdDev` | f32 | 20 | agent.rs / birth.rs (禀赋遗传演化) | 始祖禀赋初始标准差 |
| `traitMutationDelta` | f32 | 10 | agent.rs / birth.rs (禀赋遗传演化) | 遗传突变偏移量 |
| `traitInheritClampMin` | f32 | 10 | agent.rs / birth.rs (禀赋遗传演化) | 遗传继承单项禀赋夹取下限 |
| `traitInheritClampMax` | f32 | 190 | agent.rs / birth.rs (禀赋遗传演化) | 遗传继承单项禀赋夹取上限 |
| `poiMinDistance` | f32 | 70 | ecology.rs (POI 空间排斥间距 §4.7) | POI 间最小排斥间距 (m) |
| `countCamps` | usize | 5 | ecology.rs (POI 数量 §4.7) | 营地数量 |
| `countWaterSources` | usize | 6 | ecology.rs (POI 数量 §4.7) | 清泉数量 |
| `countBerryBushes` | usize | 6 | ecology.rs (POI 数量 §4.7) | 浆果数量 |
| `countWoods` | usize | 3 | ecology.rs (POI 数量 §4.7) | 林木数量 |
| `countStoneMines` | usize | 2 | ecology.rs (POI 数量 §4.7) | 石矿数量 |
| `countGoldMines` | usize | 1 | ecology.rs (POI 数量 §4.7) | 金矿数量 |
| `stockMaxWater` | f32 | 100 | poi.rs / ecology.rs (POI 储量上限) | 清泉储量上限 |
| `stockMaxBerry` | f32 | 100 | poi.rs / ecology.rs (POI 储量上限) | 浆果储量上限 |
| `stockMaxWood` | f32 | 100 | poi.rs / ecology.rs (POI 储量上限) | 林木储量上限 |
| `stockMaxStone` | f32 | 100 | poi.rs / ecology.rs (POI 储量上限) | 石矿储量上限 |
| `stockMaxGold` | f32 | 100 | poi.rs / ecology.rs (POI 储量上限) | 金矿储量上限 |
| `regenBaseWater` | f32 | 2 | ecology.rs / world_tick.rs (POI 再生速率) | 清泉基础再生速率 (单位/秒) |
| `regenBaseBerry` | f32 | 2 | ecology.rs / world_tick.rs (POI 再生速率) | 浆果基础再生速率 |
| `regenBaseWood` | f32 | 2 | ecology.rs / world_tick.rs (POI 再生速率) | 林木基础再生速率 |
| `regenBaseStone` | f32 | 2 | ecology.rs / world_tick.rs (POI 再生速率) | 石矿基础再生速率 |
| `regenBaseGold` | f32 | 1.8 | ecology.rs / world_tick.rs (POI 再生速率) | 金矿基础再生速率 |
| `poiInteractionRateResource` | f32 | 10 | ecology.rs (POI 交互采收/卸货) | 资源 POI 现场采收速率 (单位/秒) |
| `poiInteractionRateGold` | f32 | 5 | ecology.rs (POI 交互采收/卸货) | 金矿现场采收速率 (单位/秒) |
| `poiUnloadRateResource` | f32 | 10 | ecology.rs (回家卸货入账速率 §4.4) | 资源入库卸货速率 (单位/秒) |
| `poiUnloadRateGold` | f32 | 5 | ecology.rs (回家卸货入账速率 §4.4) | 黄金入库卸货速率 (单位/秒) |
| `poiSpawnRadiusCamp` | f32 | 0.7 | ecology.rs (POI 初始化播撒布局) | 营地撒点半径占半图比例 |
| `poiSpawnRadiusResource` | f32 | 0.8 | ecology.rs (POI 初始化播撒布局) | 资源 POI 撒点半径占半图比例 |
| `poiSpawnFallbackRatio` | f32 | 0.6 | ecology.rs (POI 初始化播撒布局) | 紧密撒点回退最小间距比例 (min_distance × N) |
| `countTerrainTransitionNodes` | usize | 17 | ecology.rs (路网过渡节点) | 地形过渡节点数量 (路网骨架) |
| `poiSpawnSpreadRatio` | f32 | 0.85 | ecology.rs (POI 初始化播撒布局) | 地形过渡节点散布范围占半图比例 |
| `roadConnectNearDist` | f32 | 175 | ecology.rs (路网连接距离) | 路网直连近距阈值 (≤ 双向铺装) |
| `roadConnectFarDist` | f32 | 320 | ecology.rs (路网连接距离) | 路网直连远距阈值 (≤ 单向泥径) |
| `roadGradePaveThreshold` | f32 | 8 | graph.rs (道路等级铺装阈值) | 坡度铺装阈值 (高差超过则盘山道，否则泥径) |
| `poiInteractionRadius` | f32 | 22 | ecology.rs (POI 交互采收/卸货) | 采收现场「已抵达 POI」判定半径 (m) |
| `campHomeConsumeRate` | f32 | 3 | ecology.rs (营地在家吃喝) | 营地/家宅休息自饮自食消耗速率 (单位/秒) |
| `decisionPoiSeekMinStockRatio` | f32 | 0.3 | decisions/routing.rs / decisions/harvest.rs (施密特触发器 §4.2) | POI 私有施密特触发器开启阈值 (库存 ≥ 此比例) |
| `decisionPoiAbandonStockRatio` | f32 | 0.1 | decisions/routing.rs / decisions/harvest.rs (施密特触发器 §4.2) | POI 私有施密特触发器关闭阈值 (库存 < 此比例) |
| `decisionCriticalThirst` | f32 | 25 | decisions/ (生理临界阈值) | 临界口渴阈值 (触发寻水) |
| `decisionCriticalHunger` | f32 | 25 | decisions/ (生理临界阈值) | 临界饥饿阈值 (触发觅食) |
| `decisionRestStaminaTarget` | f32 | 100 | decisions/ (休息目标体力) | 休息目标体力 |
| `decisionStockGoldCooldown` | f32 | 45 | decisions/ (备料淘金冷却) | 盖房备料淘金冷却 (秒) |
| `decisionGoldWealthCooldown` | f32 | 180 | decisions/ (淘金冷却 §4.8) | 4 级庄园竣工前娱乐淘金冷却 (秒) |
| `decisionHouseRepairNeedThreshold` | f32 | 50 | decisions/ (修缮触发) / housing_system/ | 房屋耐久低于此值触发修缮需求 |
| `decisionFoundHomeHungerMin` | f32 | 20 | decisions/founding.rs (立宅选址) | 立宅所需最低饱食度 |
| `decisionFoundHomeThirstMin` | f32 | 20 | decisions/founding.rs (立宅选址) | 立宅所需最低水分 |
| `decisionFoundHomeStaminaMin` | f32 | 60 | decisions/founding.rs (立宅选址) | 立宅所需最低体力 |
| `decisionFoundHomeCandidates` | usize | 12 | decisions/founding.rs (立宅选址) | 立宅候选点数量 |
| `decisionFoundHomeDistMin` | f32 | 24 | decisions/founding.rs (立宅选址) | 立宅候选点与现有房屋的硬间距下限 (m) |
| `decisionFoundHomeDistMax` | f32 | 80 | decisions/founding.rs (立宅选址) | 立宅候选点与营地的软间距上限 (m) |
| `decisionWorkStaminaThreshold` | f32 | 50 | decisions/ (劳作体力阈值) | 劳作所需最低体力 (低于则返家休息) |
| `decisionFamilyStockTriggerOn` | f32 | 100 | decisions/ (家户补货滞回触发器 §4.8) | M7 家庭库存施密特触发下限：家户账本余额 < 此 → 去采 |
| `decisionFamilyStockTriggerOff` | f32 | 200 | decisions/ (家户补货滞回触发器 §4.8) | M7 家庭库存施密特结束上限：一旦去采，余额 ≥ 此 → 补足停止 |
| `houseDurabilityMax` | f32 | 100 | housing_system/ (耐久度上限) | 房屋耐久上限 |
| `houseDepreciationRate` | f32 | 0.02 | housing_system/maintenance.rs (折旧) | 房屋耐久自然折旧速率 (每秒) |
| `houseRepairTriggerThreshold` | f32 | 80 | housing_system/maintenance.rs (修缮) | 耐久低于此值允许修缮 |
| `houseRepairSpeed` | f32 | 5 | housing_system/maintenance.rs (修缮) | 修缮进度速率 (每秒) |
| `houseUpgradeCostTier1Water` | f32 | 50 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 1 级：水 |
| `houseUpgradeCostTier1Food` | f32 | 50 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 1 级：粮 |
| `houseUpgradeCostTier1Wood` | f32 | 0 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 1 级：木（不消耗） |
| `houseUpgradeCostTier1Stone` | f32 | 0 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 1 级：石（不消耗） |
| `houseUpgradeCostTier1Gold` | f32 | 0 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 1 级：金（不消耗） |
| `houseUpgradeCostTier2Water` | f32 | 75 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 2 级：水 |
| `houseUpgradeCostTier2Food` | f32 | 75 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 2 级：粮 |
| `houseUpgradeCostTier2Wood` | f32 | 75 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 2 级：木 |
| `houseUpgradeCostTier2Stone` | f32 | 0 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 2 级：石（不消耗） |
| `houseUpgradeCostTier2Gold` | f32 | 0 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 2 级：金（不消耗） |
| `houseUpgradeCostTier3Water` | f32 | 100 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 3 级：水 |
| `houseUpgradeCostTier3Food` | f32 | 100 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 3 级：粮 |
| `houseUpgradeCostTier3Wood` | f32 | 100 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 3 级：木 |
| `houseUpgradeCostTier3Stone` | f32 | 100 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 3 级：石 |
| `houseUpgradeCostTier3Gold` | f32 | 0 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 3 级：金（不消耗） |
| `houseUpgradeCostTier4Water` | f32 | 125 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 4 级：水 |
| `houseUpgradeCostTier4Food` | f32 | 125 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 4 级：粮 |
| `houseUpgradeCostTier4Wood` | f32 | 125 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 4 级：木 |
| `houseUpgradeCostTier4Stone` | f32 | 125 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 4 级：石 |
| `houseUpgradeCostTier4Gold` | f32 | 125 | housing_system/upgrade.rs (升级成本矩阵 §4.8) | 升到 4 级：金 |
| `houseWinterWoodBurnRate` | f32 | 0.12 | housing_system/maintenance.rs (冬季供暖 §4.8) | 冬季供暖木材消耗速率 (每秒) |
| `houseWinterColdTemp` | f32 | 5 | housing_system/maintenance.rs (冬季供暖 §4.8) | 低温供暖阈值 (℃) |
| `houseMinSpacing` | f32 | 20 | housing_system/founding.rs (房屋间距) | 房屋间最小水平间距 (m) |
| `campMaxHouses` | u32 | 30 | — | 每个营地最多可建设的房屋数量 |
| `houseNodeReuseRadius` | f32 | 20 | housing_system/founding.rs (立宅节点占用) | 立宅优先复用空置路网节点检索半径 (m) |
| `houseNodePoiOccupyRadius` | f32 | 1.5 | housing_system/founding.rs (立宅节点占用) | 判定节点被 POI 占用的贴合半径 (m) |
| `seasonYearLength` | f32 | 240 | world_season.rs (四季周期) | 一年 (四季) 总时长 (模拟秒) |
| `tempBaseMid` | f32 | 14 | world_season.rs (温度正弦曲线) | 年均基准温度 (℃) |
| `tempAmplitude` | f32 | 17 | world_season.rs (温度正弦曲线) | 季节温度振幅 (℃) |
| `roadWearDecayRate` | f32 | 0.0067 | graph.rs (踩踏增长/自然衰减 §4.3) | 道路自然杂草衰减速率 (%/秒,相对当前磨损比例衰减) |
| `roadWearStepInc` | f32 | 0.05 | graph.rs (踩踏增长/自然衰减 §4.3) | 族人单次通行踩踏增量 (等级/次) |
| `roadMaxWear` | f32 | 5 | graph.rs (最高磨损等级) | 道路磨损上限 |
| `roadSpeedDirtTrack` | f32 | 36 | graph.rs (各道路类型限速) | 泥泞小径限速 |
| `roadSpeedCobblestone` | f32 | 44 | graph.rs (各道路类型限速) | 碎石盘山道限速 |
| `roadSpeedAsphaltUrban` | f32 | 60 | graph.rs (各道路类型限速) | 城镇大道限速 |
| `roadSpeedSkywayElevated` | f32 | 96 | graph.rs (各道路类型限速) | 高架飞索限速 |
| `roadSpeedSmugglerTrail` | f32 | 40 | graph.rs (各道路类型限速) | 私贩密径限速 |
| `roadLevelFactorBase` | f32 | 0.5 | graph.rs (等级速度加成) | 道路等级影响移速基准系数 (等级 0) |
| `roadLevelFactorWearCoef` | f32 | 0.333 | graph.rs (等级速度加成) | 道路等级影响移速磨损系数 |
| `roadLevelFactorMin` | f32 | 0.5 | graph.rs (等级速度加成) | 道路等级移速乘子下限 |
| `roadLevelFactorMax` | f32 | 2.2 | graph.rs (等级速度加成) | 道路等级移速乘子上限 |
| `agentMoveStaminaBase` | f32 | 0.6 | agent.rs (运动学) / graph.rs (寻路) | 移动基础体力消耗 (每秒) |
| `agentMoveStaminaPregnant` | f32 | 0.3 | agent.rs (运动学) / graph.rs (寻路) | 孕期额外移动体力消耗 (每秒) |
| `agentMoveStaminaGradeCoef` | f32 | 3.5 | agent.rs (运动学) / graph.rs (寻路) | 坡度对移动体力消耗加成系数 |
| `agentMoveAccelCoef` | f32 | 4 | agent.rs (运动学) / graph.rs (寻路) | 移动加速度收敛系数 |
| `roadAstarGradePenaltyCoef` | f32 | 1.5 | graph.rs (A* 寻路权重) | A* 坡度通行代价惩罚系数 |
| `roadAstarHeuristicDivisor` | f32 | 80 | graph.rs (A* 寻路权重) | A* 启发式距离除数 |
| `roadHiddenPreferModifier` | f32 | 0.4 | graph.rs / decisions/ (隐秘道路偏好) | A* 偏好隐秘时隐秘道路代价乘子 |
| `roadVisiblePreferModifier` | f32 | 1.2 | graph.rs / decisions/ (可见道路偏好) | A* 偏好隐秘时公开道路代价乘子 |
| `roadHiddenAvoidModifier` | f32 | 2.5 | graph.rs / decisions/ (隐秘道路偏好) | A* 非偏好隐秘时隐秘道路代价乘子 |
| `roadVisibleAvoidModifier` | f32 | 1 | graph.rs / decisions/ (可见道路偏好) | A* 非偏好隐秘时公开道路代价乘子 |
| `ledgerJournalCapacity` | usize | 64 | ledger/ (所有账本容量) | 账本流水环形缓冲容量 (每团体/家户，条) |
| `clanTributeRate` | f32 | 0.05 | ledger/clan.rs (族税征收) | 族税率：家户每周期向族库缴纳账面余额的比例 |
| `clanTributeIntervalTicks` | u64 | 1800 | ledger/clan.rs (族税征收) | 族税征收周期 (tick)，每 N tick 全局统一征收一次 |
| `clanMutualAidMinBalance` | f32 | 50 | ledger/clan.rs (族内互助) | 族内互助族库最低余额门槛 |
| `clanMutualAidFamilyThreshold` | f32 | 10 | ledger/clan.rs (族内互助) | 极贫家庭门槛：家户账面水+粮总额 < 此值视为极贫 |
| `clanMutualAidCooldownTicks` | u64 | 900 | ledger/clan.rs (族内互助) | 族内互助冷却 (tick)，每家户每 N tick 最多接收一次 |
| `ledgerTaxRate` | f32 | 0.03 | ledger/region.rs (公仓税) | 公仓税率：家户每周期向地区公仓缴纳账面余额的比例 |
| `ledgerTaxIntervalTicks` | u64 | 2400 | ledger/region.rs (公仓税) | 公仓税征收周期 (tick)，每 N tick 全局统一征收一次 |
| `ledgerReliefMinBalance` | f32 | 30 | ledger/region.rs (救济) | 救济公仓最低余额门槛：地区公仓总余额 > 此值方可签发救济 |
| `ledgerReliefFamilyThreshold` | f32 | 8 | ledger/region.rs (救济) | 极贫家庭门槛：家户账面水+粮总额 < 此值视为极贫 |
| `ledgerReliefCooldownTicks` | u64 | 1200 | ledger/region.rs (救济) | 救济冷却 (tick)，每家户每 N tick 最多接收一次救济 |

## 5. 马斯洛需求与决策门槛

| 字段 (camelCase) | 类型 | 默认值 | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `decisionEvalOrder` | Vec<String> | [] | decisions/branches.rs (前端拖动热注入) | 决策分支评估顺序（空=基线；权威顺序在 config.decision-order.js，启动时由 decision-viz.js 合并覆盖） |
| `decisionEvalLevels` | Vec<u8> | [] | decisions/branches.rs (层级覆盖) | 分支层级覆盖（与顺序下标并行，0=代码动态默认，1-5=强制层级；空=全动态默认） |
