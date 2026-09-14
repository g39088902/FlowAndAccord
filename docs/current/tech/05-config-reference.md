# 05. Flow & Accord · 仿真超参数速查表

> 本表由 `tools/config-check.js` 自动生成，反映 `config.js` 与 Rust `SimConfig` 的权威字段、类型、默认值与中文说明。
> 调参只需修改 `frontend/js/config.js`（无需重编译），修改后运行 `node tools/config-check.js` 校验一致性。

## 1. 引擎节拍与时间基准

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `simulationDt` | f32 | 0.016666666666666666 | world_tick.rs / sim_wasm (§4.3 严禁改) | 单个 tick 对应的模拟小时数 (1/60) |
| `agentDecisionIntervalTicks` | u64 | 120 | decisions/scheduler.rs (§4.3 错峰相位) | 每个族人错峰决策间隔 (tick)，平均 2 游戏小时决策一次 |

## 2. 部落民生理、代谢与生命周期

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `agentHungerCapacity` | f32 | 50 | agent.rs (饱食容量) | 饱食度容量上限 |
| `agentThirstCapacity` | f32 | 50 | agent.rs (水分容量) | 水分容量上限 |
| `agentInitialHunger` | f32 | 45 | agent.rs (初始属性) | 始祖/新生儿初始饱食度 |
| `agentInitialThirst` | f32 | 45 | agent.rs (初始属性) | 始祖/新生儿初始水分 |
| `agentInitialStamina` | f32 | 95 | agent.rs (初始属性) | 始祖初始体力 |
| `agentBaseMetabolismDecay` | f32 | 0.2 | agent.rs (基础代谢/速度) | 基础代谢消耗速率 (饱食/水分 每秒) |
| `agentHealthDecayPerSec` | f32 | 0.01 | agent.rs (健康衰减) | 濒死健康衰减速率 (每秒) |
| `agentFrailHealthThreshold` | f32 | 2 | agent.rs / decisions/branches.rs (衰弱阈值 · 不响应储备需求/在家进食) | 衰弱(风烛残年)健康阈值：健康值 < 此值不再响应储备需求、饮食优先在家解决 |
| `agentPregnantMetabolismMult` | f32 | 1.25 | agent.rs (妊娠代谢) | 孕期代谢消耗倍率 |
| `agentWorkMetabolismMult` | f32 | 1 | agent.rs (劳作代谢) | 劳作代谢消耗倍率 |
| `agentDeathDecayDuration` | f32 | 12 | agent.rs (死亡衰减) | 生命耗尽后彻底消亡的衰减时长 (秒) |
| `agentAdultAge` | f32 | 1800 | agent.rs (成年阈值) / decisions/ | 成年年龄阈值 (模拟秒，= 60 分钟) |
| `agentPregnancyDuration` | f32 | 200 | agent.rs (妊娠代谢) | 妊娠期时长 (模拟秒，≈ 3.3 分钟) |
| `agentMiscarriageThreshold` | f32 | 10 | agent.rs (流产判定) | 饥渴任一低于此值即触发流产风险 |
| `agentMiscarriageStaminaThreshold` | f32 | 20 | agent.rs (流产判定) | 体力低于此值即触发流产风险 |
| `agentMiscarriageCooldown` | f32 | 200 | agent.rs (流产判定) | 流产后休养冷却 (秒，期间禁止再次受孕) |
| `agentPostpartumCooldown` | f32 | 200 | agent.rs (产后休养冷却) | 产后休养冷却 (秒，分娩后期间禁止再次受孕) |
| `agentMiscarriageAlertDuration` | f32 | 5 | agent.rs (流产判定) | 流产告警存续时长 (秒) |
| `agentConceptionHungerMin` | f32 | 40 | agent.rs (受孕判定) | 受孕所需最低饱食度 |
| `agentConceptionThirstMin` | f32 | 40 | agent.rs (受孕判定) | 受孕所需最低水分 |
| `agentConceptionStaminaMin` | f32 | 80 | agent.rs (受孕判定) | 受孕所需最低体力 |
| `carryCapacityResource` | f32 | 100 | agent.rs / ecology/ / decisions/ | 单类资源随身行囊容量 (水/粮/木/石 互不共享) |
| `agentGoldLoadFull` | f32 | 20 | agent.rs (淘金行囊) / ecology/ | 单趟淘金运满入库量 |
| `agentBaseMoveSpeedMult` | f32 | 4 | agent.rs (基础代谢/速度) | 基础移动速度倍率 |
| `agentStaminaCapacity` | f32 | 100 | agent.rs (体力容量) | 体力值上限 (%) |
| `agentStealthVisibilityCovert` | f32 | 0.25 | agent.rs (隐秘可见度) | 隐秘特工可见度 |
| `agentStealthVisibilityNormal` | f32 | 1 | agent.rs (隐秘可见度) | 普通族人可见度 |
| `agentRestStaminaRecoveryRate` | f32 | 8 | agent.rs (休息恢复) / ecology/ | 营地/家宅休息时基础体力恢复速率 (每秒，乘睡眠效率) |
| `agentRepairStaminaBurn` | f32 | 2.5 | housing_system/maintenance.rs (修缮体力) | 修缮房屋体力消耗速率 (每秒) |
| `agentGatherStaminaBurn` | f32 | 2 | ecology/ (采收体力) | 伐木/采石/淘金体力消耗速率 (每秒) |
| `agentLaborStaminaFloor` | f32 | 5 | agent.rs (劳作体力下限) | 劳作体力消耗后的最低保留体力下限 |
| `agentDigestionRatioMin` | f32 | 0.2 | agent.rs (消化效率代谢系数) | 消化效率影响代谢的系数下限 |
| `agentDigestionRatioMax` | f32 | 5 | agent.rs (消化效率代谢系数) | 消化效率影响代谢的系数上限 |
| `agentSelfSatisfiedThreshold` | f32 | 49.9 | ecology/ (自饮自食阈值) | 自饮自食「已满足」判定阈值 (≥ 视为饱腹/解渴) |
| `agentNewbornHunger` | f32 | 25 | birth.rs (新生儿属性) / agent.rs | 新生儿初始饱食度 |
| `agentNewbornThirst` | f32 | 25 | birth.rs (新生儿属性) / agent.rs | 新生儿初始水分 |
| `agentNewbornStamina` | f32 | 100 | birth.rs (新生儿属性) / agent.rs | 新生儿初始体力 (%) |
| `agentSpawnCount` | usize | 20 | ecology/ (始祖播撒) / agent.rs | 每局播撒的初始始祖族人数量 |
| `agentCovertEveryN` | usize | 4 | ecology/ (始祖隐秘特工比例) | 每第 N 名始祖设为隐秘特工 (i % N == 0) |
| `agentSpawnJitter` | f32 | 10 | ecology/ (始祖播撒) / agent.rs | 始祖初始属性随机抖动幅度 (±) |
| `agentSpawnHungerBase` | f32 | 45 | ecology/ (始祖播撒) / agent.rs | 始祖初始饱食/水分抖动基线 |
| `agentSpawnHungerClampMin` | f32 | 35 | ecology/ (始祖播撒) / agent.rs | 始祖初始饱食/水分夹取下限 |
| `agentSpawnHungerClampMax` | f32 | 50 | ecology/ (始祖播撒) / agent.rs | 始祖初始饱食/水分夹取上限 |
| `agentSpawnStaminaBase` | f32 | 90 | ecology/ (始祖播撒) / agent.rs | 始祖初始体力抖动基线 |
| `agentSpawnStaminaClampMin` | f32 | 55 | ecology/ (始祖播撒) / agent.rs | 始祖初始体力夹取下限 |
| `agentSpawnStaminaClampMax` | f32 | 100 | ecology/ (始祖播撒) / agent.rs | 始祖初始体力夹取上限 |
| `agentSpawnBaseSpeed` | f32 | 8.5 | agent.rs / graph.rs (寻路速度基准) | 所有 agent 共用的基础默认行走速度 |

## 3. 先天禀赋与遗传演化

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `traitDefaultMean` | f32 | 100 | agent.rs / birth.rs (禀赋遗传演化) | 禀赋基准均值 |
| `traitInitialStdDev` | f32 | 20 | agent.rs / birth.rs (禀赋遗传演化) | 始祖禀赋初始标准差 |
| `traitMutationDelta` | f32 | 10 | agent.rs / birth.rs (禀赋遗传演化) | 遗传突变偏移量 |
| `traitInheritClampMin` | f32 | 10 | agent.rs / birth.rs (禀赋遗传演化) | 遗传继承单项禀赋夹取下限 |
| `traitInheritClampMax` | f32 | 190 | agent.rs / birth.rs (禀赋遗传演化) | 遗传继承单项禀赋夹取上限 |
| `traitHighThreshold` | f32 | 110 | agent.rs / birth.rs (禀赋遗传演化) | 先天卓越禀赋门槛 (力量/智力高于此值触发卓越特化) |
| `traitLowThreshold` | f32 | 90 | agent.rs / birth.rs (禀赋遗传演化) | 先天劣势禀赋门槛 (力量/智力低于此值触发避重就轻特化) |
| `traitStrengthLoadBonus` | f32 | 0.25 | agent.rs / birth.rs (禀赋遗传演化) | 高力量重体力装载速率加成 (+25%) |
| `traitStrengthLoadPenalty` | f32 | 0.15 | agent.rs / birth.rs (禀赋遗传演化) | 低力量重体力装载速率惩罚 (-15%) |

## 4. 生态地标与 POI 采收交互

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `poiMinDistance` | f32 | 70 | ecology/ (POI 空间排斥间距 §4.7) | POI 间最小排斥间距 (m) |
| `countCamps` | usize | 4 | ecology/ (POI 数量 §4.7) | 营地数量 |
| `countEmpires` | usize | 1 | ledger/empire.rs (帝国数量与营地确定性分组) | 帝国数量（自动钳制为 1..=营地数量；当前政体仅实现帝国） |
| `countWaterSources` | usize | 6 | ecology/ (POI 数量 §4.7) | 清泉数量 |
| `countBerryBushes` | usize | 6 | ecology/ (POI 数量 §4.7) | 浆果数量 |
| `countWoods` | usize | 3 | ecology/ (POI 数量 §4.7) | 林木数量 |
| `countStoneMines` | usize | 2 | ecology/ (POI 数量 §4.7) | 石矿数量 |
| `countGoldMines` | usize | 1 | ecology/ (POI 数量 §4.7) | 金矿数量 |
| `stockMaxWater` | f32 | 400 | poi.rs / ecology/ (POI 储量上限) | 清泉储量上限 |
| `stockMaxBerry` | f32 | 400 | poi.rs / ecology/ (POI 储量上限) | 浆果储量上限 |
| `stockMaxWood` | f32 | 200 | poi.rs / ecology/ (POI 储量上限) | 林木储量上限 |
| `stockMaxStone` | f32 | 200 | poi.rs / ecology/ (POI 储量上限) | 石矿储量上限 |
| `stockMaxGold` | f32 | 200 | poi.rs / ecology/ (POI 储量上限) | 金矿储量上限 |
| `regenBaseWater` | f32 | 2 | ecology/ / world_tick.rs (POI 再生速率) | 清泉基础再生速率 (单位/小时) |
| `regenBaseBerry` | f32 | 2 | ecology/ / world_tick.rs (POI 再生速率) | 浆果基础再生速率 |
| `regenBaseWood` | f32 | 2 | ecology/ / world_tick.rs (POI 再生速率) | 林木基础再生速率 |
| `regenBaseStone` | f32 | 2 | ecology/ / world_tick.rs (POI 再生速率) | 石矿基础再生速率 |
| `regenBaseGold` | f32 | 1.8 | ecology/ / world_tick.rs (POI 再生速率) | 金矿基础再生速率 |
| `poiInteractionRateResource` | f32 | 10 | ecology/ (POI 交互采收/卸货) | 资源 POI 现场采收速率 (单位/小时) |
| `poiInteractionRateGold` | f32 | 5 | ecology/ (POI 交互采收/卸货) | 金矿现场采收速率 (单位/小时) |
| `poiUnloadRateResource` | f32 | 10 | ecology/ (回家卸货入账速率 §4.4) | 资源入库卸货速率 (单位/小时) |
| `poiUnloadRateGold` | f32 | 5 | ecology/ (回家卸货入账速率 §4.4) | 黄金入库卸货速率 (单位/小时) |
| `poiSpawnRadiusCamp` | f32 | 0.7 | ecology/ (POI 初始化播撒布局) | 营地撒点半径占半图比例 |
| `poiSpawnRadiusResource` | f32 | 0.8 | ecology/ (POI 初始化播撒布局) | 资源 POI 撒点半径占半图比例 |
| `poiSpawnFallbackRatio` | f32 | 0.6 | ecology/ (POI 初始化播撒布局) | 紧密撒点回退最小间距比例 (min_distance × N) |
| `countTerrainTransitionNodes` | usize | 17 | ecology/ (路网过渡节点) | 地形过渡节点数量 (路网骨架) |
| `poiSpawnSpreadRatio` | f32 | 0.85 | ecology/ (POI 初始化播撒布局) | 地形过渡节点散布范围占半图比例 |
| `poiInteractionRadius` | f32 | 22 | ecology/ (POI 交互采收/卸货) | 采收现场「已抵达 POI」判定半径 (m) |
| `campHomeConsumeRate` | f32 | 3 | ecology/ (营地在家吃喝) | 营地/家宅休息自饮自食消耗速率 (单位/小时) |

## 5. 马斯洛需求与决策门槛

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `decisionPoiSeekMinStockRatio` | f32 | 0.5 | decisions/routing.rs / decisions/harvest.rs (施密特触发器 §4.2) | POI 私有施密特触发器开启阈值 (库存 ≥ 此比例) |
| `decisionPoiAbandonStockRatio` | f32 | 0.1 | decisions/routing.rs / decisions/harvest.rs (施密特触发器 §4.2) | POI 私有施密特触发器关闭阈值 (库存 < 此比例) |
| `decisionCriticalThirst` | f32 | 25 | decisions/ (生理临界阈值) | 临界口渴阈值 (触发寻水) |
| `decisionCriticalHunger` | f32 | 25 | decisions/ (生理临界阈值) | 临界饥饿阈值 (触发觅食) |
| `decisionHomeMealMinStock` | f32 | 1 | decisions/branches.rs + evaluate.rs (衰弱者在家解决饮食门槛) | 衰弱族人在家解决饮食的家户账本余额门槛 (该品类余额 ≥ 此值才返家吃喝) |
| `decisionRestStaminaTarget` | f32 | 100 | decisions/ (休息目标体力) | 休息目标体力 |
| `decisionStockGoldCooldown` | f32 | 45 | decisions/ (备料淘金冷却) | 盖房备料淘金冷却 (秒) |
| `decisionGoldWealthCooldown` | f32 | 180 | decisions/ (淘金冷却 §4.8) | 4 级庄园积累财富的淘金策略冷却 (秒) |
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
| `decisionCourtshipMinFamilyGold` | f32 | 5 | — | 求偶发起最低家户金币（严格大于此值） |
| `decisionEvalOrder` | Vec<String> | [] | decisions/branches.rs (前端拖动热注入) | 决策分支评估顺序（空=基线；权威顺序在 config.decision-order.js，启动时由 decision-viz.js 合并覆盖） |
| `decisionEvalLevels` | Vec<u8> | [] | decisions/branches.rs (层级覆盖) | 分支层级覆盖（与顺序下标并行，0=⓪瞬间行为/1-5=①..⑤马斯洛层级/6=保留代码动态默认；空=全动态默认） |

## 6. 私宅营造、代际传承与升级

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `houseDurabilityMax` | f32 | 100 | housing_system/ (耐久度上限) | 房屋耐久上限 |
| `houseDepreciationRate` | f32 | 0.02 | housing_system/maintenance.rs (折旧) | 房屋耐久自然折旧速率 (每秒) |
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
| `houseWinterColdTemp` | f32 | 8 | housing_system/maintenance.rs (冬季供暖 §4.8) | 低温供暖阈值 (℃) |
| `houseMinSpacing` | f32 | 20 | housing_system/founding.rs (房屋间距) | 房屋间最小水平间距 (m) |
| `campMaxHouses` | u32 | 25 | — | 每个营地最多可建设的房屋数量 |
| `campLevelVillageMinHouses` | u32 | 5 | poi.rs (营地行政级别升级) | 营地升级为村的最低房屋数量 |
| `campLevelTownshipMinHouses` | u32 | 10 | poi.rs (营地行政级别升级) | 营地升级为乡的最低房屋数量 |
| `campLevelTownMinHouses` | u32 | 15 | poi.rs (营地行政级别升级) | 营地升级为镇的最低房屋数量 |
| `campLevelCountyMinHouses` | u32 | 20 | poi.rs (营地行政级别升级) | 营地升级为县的最低房屋数量 |
| `houseNodeReuseRadius` | f32 | 20 | housing_system/founding.rs (立宅节点占用) | 立宅优先复用空置路网节点检索半径 (m) |
| `houseNodePoiOccupyRadius` | f32 | 1.5 | housing_system/founding.rs (立宅节点占用) | 判定节点被 POI 占用的贴合半径 (m) |

## 7. 地形生成、地表查询与山口 profile

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `terrainGridRes` | usize | 120 | sim_wasm/lib.rs (resolve_grid_res 建世界栅格) | 地形栅格每边格数（120 → 步长 764/119 ≈ 6.42m） |
| `terrainProfile` | String | random | geo/terrain.rs / world_save.rs (地形生成器版本门禁) | 地貌模板：'random'（按种子随机 9 张候选池：T1山口/T2河谷/草原/半坡/河谷聚落/台地聚落/★ TB-03 冲积扇/盆地绿洲/湖畔盆地，各 ~11.1%）| 'mountain_pass_v1'（固定T1）| 'river_valley_v1'（固定T2）| 'grassland_plain_v1'（草原）| 'hillside_woodland_v1'（半坡林地）| 'river_valley_settlement_v1'（河谷聚落）| 'plateau_settlement_v1'（台地聚落，v1.50.54）| 'alluvial_fan_v1'（★ TB-03 山前冲积扇：山口→扇缘缓坡+干浅沟）| 'basin_oasis_v1'（★ TB-03 盆地绿洲：大盆地+中心小泉池+单岸点共享池）| 'lakeside_basin_v1'（★ TB-03 湖畔盆地：中心大湖+环湖干岸+双出口+双岸点共享池）| 'flat_baseline'（显式诊断/降级基线：倾斜-only 平地，永不加入 random）；影响地形重建与存档门禁 |
| `terrainRidgeAmplitude` | f32 | 28 | — | T2 地貌 / 通行参数 |
| `terrainPassRidgeWidth` | f32 | 62 | geo/terrain.rs (T1 主脊高斯半宽，通行力约束) | T1 山口主脊高斯半宽 (m) |
| `terrainPassRidgeAmplitude` | f32 | 53 | geo/terrain.rs (T1 主脊幅度，通行力约束) | T1 山口主脊幅度 (m) |
| `terrainNoiseAmplitude` | f32 | 6 | geo/terrain.rs (fBm 振幅增益，默认 6.0 零漂移) | fBm 基础振幅 (m)；Octave 0 基准，Octave 1/2 按 0.43/0.145 比例跟随 |

## 8. 36/0.125 跟随（默认 300 → λ 300/108/37.5m）。默认 300.0。

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `terrainNoiseScaleBase` | f32 | 300 | geo/terrain.rs (fBm 波长缩放，默认 300.0 零漂移) | fBm 宏观基础波长 (m)；Octave 1/2 按 0.36/0.125 比例跟随（默认 → λ 300/108/37.5m） |
| `terrainBranchRidgeEnabled` | bool | true | geo/terrain.rs (支脊生成总开关) | 支脊生成总开关（T1 山口 profile；false 时 relief_rng 消费序缩短） |
| `terrainBranchRidgeAmplitudeRatio` | f32 | 0.48 | geo/terrain.rs (支脊振幅比中值 ×[0.85,1.15] 抖动) | 支脊/主脊振幅比中值；每条 ×[0.85,1.15] 抖动（默认 → 0.408~0.552） |
| `terrainBranchRidgeLength` | f32 | 150 | geo/terrain.rs (支脊长度 ×[0.8,1.2] 抖动) | 支脊基础延伸长度 (m)；每条 ×[0.8,1.2] 抖动（默认 → 120~180m） |
| `terrainGrasslandMoundAmpMin` | f32 | 6.5 | geo/terrain.rs (S7-02 草原残丘幅度抽样下限) | 残丘高斯幅度抽样下限 (m)；A/R∈[0.19,0.31] → 峰值坡度 ≈9.3°~14.9° |
| `terrainGrasslandMoundAmpMax` | f32 | 9.5 | geo/terrain.rs (S7-02 草原残丘幅度抽样上限) | 残丘高斯幅度抽样上限 (m) |
| `terrainGrasslandMoundRatioMin` | f32 | 0.19 | geo/terrain.rs (S7-02 草原残丘幅径比下限) | 残丘 幅度/半径比 抽样下限（峰值坡度 ≈0.858×A/R） |
| `terrainGrasslandMoundRatioMax` | f32 | 0.31 | geo/terrain.rs (S7-02 草原残丘幅径比上限) | 残丘 幅度/半径比 抽样上限（过大→残丘成通行障碍） |
| `terrainSpringDepressionDepthMin` | f32 | 1.4 | geo/terrain.rs (S7-02/04 泉溪洼地深度下限) | 洼地深度抽样下限 (m) |
| `terrainSpringDepressionDepthMax` | f32 | 2.2 | geo/terrain.rs (S7-02/04 泉溪洼地深度上限) | 洼地深度抽样上限 (m) |
| `terrainSpringDepressionRadiusMin` | f32 | 24 | geo/terrain.rs (S7-02/04 泉溪洼地凹圈半径下限) | 洼地凹圈半径抽样下限 (m)；凹圈 0.7R~1.5R 写 SoftGround |
| `terrainSpringDepressionRadiusMax` | f32 | 34 | geo/terrain.rs (S7-02/04 泉溪洼地凹圈半径上限) | 洼地凹圈半径抽样上限 (m) |
| `terrainHillsideNoiseDamp` | f32 | 0.6 | geo/terrain.rs (S7-04 半坡 fBm 噪声增益阻尼) | fBm 噪声增益阻尼（换 max_slope 门禁窗口 22°~28.5° 余量） |
| `terrainHillsideAmpMin` | f32 | 26 | geo/terrain.rs (S7-04 半坡主坡幅度抽样下限) | 不对称高斯主坡幅度抽样下限 (m) |
| `terrainHillsideAmpMax` | f32 | 32 | geo/terrain.rs (S7-04 半坡主坡幅度抽样上限) | 主坡幅度抽样上限 (m)；过大→背风峰值压穿 28.5° 窗 |
| `terrainHillsideLeeSlopeMin` | f32 | 23 | geo/terrain.rs (S7-04 背风坡目标峰值坡度下限) | 背风坡目标峰值坡度抽样下限 (度)；按目标坡度反解宽度 |
| `terrainHillsideLeeSlopeMax` | f32 | 23.2 | geo/terrain.rs (S7-04 背风坡目标峰值坡度上限) | 背风坡目标峰值坡度抽样上限 (度) |
| `terrainHillsideWindSlopeMin` | f32 | 8 | geo/terrain.rs (S7-04 迎风坡目标峰值坡度下限) | 迎风坡目标峰值坡度抽样下限 (度)；宽缓可建 |
| `terrainHillsideWindSlopeMax` | f32 | 12 | geo/terrain.rs (S7-04 迎风坡目标峰值坡度上限) | 迎风坡目标峰值坡度抽样上限 (度)；目标 <14° |
| `terrainHillsideCrestShiftMin` | f32 | 0.18 | geo/terrain.rs (S7-04 脊线横移比例下限 ×world) | 脊线横移比例抽样下限（×world；陡峭带远离初始营地） |
| `terrainHillsideCrestShiftMax` | f32 | 0.3 | geo/terrain.rs (S7-04 脊线横移比例上限 ×world) | 脊线横移比例抽样上限（×world） |
| `terrainValleyFloorBaseM` | f32 | 3 | geo/terrain.rs (S7-06 谷底基准高程) | 谷底基准高程 (m)；主河水面低于此值下凹成河 |
| `terrainValleyFloorHalfMin` | f32 | 80 | geo/terrain.rs (S7-06 谷底半宽抽样下限；建造保护线) | 谷底半宽抽样下限 (m)；下沿 80 守两侧河阶干带 ≥55m 建造保护线 |
| `terrainValleyFloorHalfMax` | f32 | 95 | geo/terrain.rs (S7-06 谷底半宽抽样上限) | 谷底半宽抽样上限 (m)；⇒ W_floor ∈ [160,190] |
| `terrainValleyWallHeightMin` | f32 | 44 | geo/terrain.rs (S7-06 陡壁总高差抽样下限) | 陡壁总高差抽样下限 (m)；规格 40~50 |
| `terrainValleyWallHeightMax` | f32 | 48 | geo/terrain.rs (S7-06 陡壁总高差抽样上限) | 陡壁总高差抽样上限 (m) |
| `terrainValleyWallRatioMin` | f32 | 0.54 | geo/terrain.rs (S7-06 陡壁幅宽比 H/W 下限) | 陡壁幅宽比 H/W 抽样下限（smoothstep 峰值梯度 1.5×H/W） |
| `terrainValleyWallRatioMax` | f32 | 0.585 | geo/terrain.rs (S7-06 陡壁幅宽比 H/W 上限；峰值梯度窗) | H/W 抽样上限；→ 峰值梯度 39°~41.5° ≥34° 硬禁行且 ≤45° 探针窗 |
| `terrainValleyMeanderAmpMin` | f32 | 18 | geo/terrain.rs (S7-06 谷轴蜿蜒振幅下限) | 谷轴蜿蜒振幅抽样下限 (m)；远小于谷底半宽 |
| `terrainValleyMeanderAmpMax` | f32 | 30 | geo/terrain.rs (S7-06 谷轴蜿蜒振幅上限) | 谷轴蜿蜒振幅抽样上限 (m) |
| `terrainValleyMeanderWaves` | f32 | 3 | geo/terrain.rs (S7-06 谷轴蜿蜒周期数；S7-07 兼主河波形) | 谷轴蜿蜒全程周期数（y/world 系数；S7-07 起兼作主河中心线波形） |
| `terrainValleyTaperRatio` | f32 | 0.47 | geo/terrain.rs (S7-06 陡壁/台地包络起始比例；谷口缓梁) | 陡壁/台地包络起始比例（×半图）；深切段中部 47%，谷口缓梁保绕行 |
| `terrainValleyNoiseFloorK` | f32 | 0.15 | geo/terrain.rs (S7-06 谷底 fBm 分区阻尼) | 谷底 fBm 分区阻尼（强阻尼保高程平缓与峰坡窗口） |
| `terrainValleyNoiseWallK` | f32 | 0.15 | geo/terrain.rs (S7-06 陡壁 fBm 分区阻尼) | 陡壁 fBm 分区阻尼（保峰值梯度窗口） |
| `terrainValleyNoiseUplandK` | f32 | 0.5 | geo/terrain.rs (S7-06 台地 fBm 分区阻尼) | 台地 fBm 分区阻尼（中等阻尼出滚动丘陵） |
| `terrainValleyRiverWidthMin` | f32 | 22 | geo/terrain.rs (S7-07 主河河宽抽样下限) | 主河河宽抽样下限 (m)；规格 22~32，取半为半宽 |
| `terrainValleyRiverWidthMax` | f32 | 32 | geo/terrain.rs (S7-07 主河河宽抽样上限) | 主河河宽抽样上限 (m) |
| `terrainValleyRiverBankM` | f32 | 8 | geo/hydrology.rs (S7-07 低滩禁建带半宽；建造保护线) | 低滩禁建带半宽 (m)；刻意不复用 T2 的 18m 宽岸（会吃掉聚落河阶） |
| `terrainValleyRiverTerraceM` | f32 | 20 | geo/hydrology.rs (S7-07 河阶带半宽) | 河阶带半宽 (m)；岸带外 RiverTerrace 高肥力 0.95 覆盖带 |
| `terrainValleyFordRatio` | f32 | 0.32 | geo/hydrology.rs (S7-07 授权浅滩 y 位置比例) | 授权浅滩 y 位置比例（±×world）；比 T2 先例 ±0.24 更稀疏 |
| `terrainValleyAccessOffsetMinM` | f32 | 35 | geo/hydrology.rs (S7-07 取水点离轴最小偏移；POI 间距) | 取水点离轴最小偏移 (m)；保证对置点对间距 ≥70m POI 口径 |
| `terrainPlateauHeightMin` | f32 | 18 | geo/plateau.rs (TB-02 台面最小抬升高度) | 台面最小抬升高度 (m)；规格 18~26 |
| `terrainPlateauHeightMax` | f32 | 26 | geo/plateau.rs (TB-02 台面最大抬升高度) | 台面最大抬升高度 (m) |
| `terrainPlateauHalfWidthRatio` | f32 | 0.22 | geo/plateau.rs (TB-02 台面半宽相对世界比例) | 台面半宽相对世界尺寸比例；0.22×768 ≈ 169m |
| `terrainPlateauHalfDepthRatio` | f32 | 0.18 | geo/plateau.rs (TB-02 台面半深相对世界比例) | 台面半深相对世界尺寸比例；0.18×768 ≈ 138m |
| `terrainPlateauCornerRadiusRatio` | f32 | 0.35 | geo/plateau.rs (TB-02 台面圆角比例) | 台面圆角相对最小半尺寸比例；0.35×138 ≈ 48m |
| `terrainPlateauEdgeBandRatio` | f32 | 0.6 | geo/plateau.rs (TB-02 台缘过渡带宽度比例；≥34° 硬禁行) | 普通台缘过渡带宽度对高差比率；B_edge = 0.6H，峰坡 ~68° ≥34° 硬禁行 |
| `terrainPlateauRampBandRatio` | f32 | 4 | geo/plateau.rs (TB-02 入口缓坡过渡带宽度比例；≤30° 可行走) | 入口缓坡过渡带宽度对高差比率；B_ramp = 4.0H，峰坡 ~20.6° ≤30° 可行走 |
| `terrainPlateauRampWidth` | f32 | 36 | geo/plateau.rs (TB-02 缓坡核心横向宽度) | 缓坡核心横向宽度 (m)；≥32m |
| `terrainPlateauRampShoulderWidth` | f32 | 24 | geo/plateau.rs (TB-02 缓坡肩部横向过渡宽度) | 缓坡肩部横向过渡宽度 (m)；光滑过渡至 edge_band |
| `terrainPlateauTopNoiseGain` | f32 | 0.2 | geo/plateau.rs (TB-02 台面区域噪声阻尼增益) | 台面区域噪声阻尼增益；起伏平缓保 ≥3 处房屋可建 |
| `terrainPlateauRampNoiseGain` | f32 | 0.12 | geo/plateau.rs (TB-02 缓坡入口噪声阻尼增益) | 缓坡入口区域噪声阻尼增益；走廊平缓保可走 |
| `terrainPlateauOutlineWarp` | f32 | 6 | geo/plateau.rs (TB-02 台缘轮廓低频扰动幅度) | 台缘轮廓低频扰动幅度 (m) |
| `terrainFanLengthRatio` | f32 | 0.42 | geo/alluvial_fan.rs (TB-03 扇体长度比例) | 扇体长度比例（×worldSize，山口→扇缘） |
| `terrainFanHalfAngleDeg` | f32 | 30 | geo/alluvial_fan.rs (TB-03 扇半角) | 扇半角（度，角向窗口 ±α） |
| `terrainFanAmplitude` | f32 | 30 | geo/alluvial_fan.rs (TB-03 山口到扇缘总高差) | 山口到扇缘总高差 (m)；1.5×A/L ≈ tan(8°) 扇头侧缘 ≤tan(22°) |
| `terrainFanGullyCountMax` | u32 | 2 | geo/alluvial_fan.rs (TB-03 干浅沟数量上限) | 干浅沟数量上限（1~2，relief_rng 掷存在性） |
| `terrainFanGullyDepthM` | f32 | 2.2 | geo/alluvial_fan.rs (TB-03 干浅沟最大深度) | 干浅沟最大深度 (m)；沟内 SoftGround+NO_BUILD 可慢行 |
| `terrainFanGullyWidthM` | f32 | 20 | geo/alluvial_fan.rs (TB-03 干浅沟横截面全宽) | 干浅沟横截面全宽 (m)；须跨越多个格子 |
| `terrainFanGullyMeanderAmpRad` | f32 | 0.12 | geo/alluvial_fan.rs (TB-03 干浅沟角向蜿蜒幅度) | 干浅沟中心线角向蜿蜒幅度（弧度） |
| `terrainBasinSemiAxisRatio` | f32 | 0.34 | geo/basin.rs (TB-03 盆地半轴比例) | 盆地半轴比例（×worldSize，椭圆 a/b 共用基准） |
| `terrainBasinDepthM` | f32 | 34 | geo/basin.rs (TB-03 盆深) | 盆深 (m，中心相对盆缘下凹总量) |
| `terrainBasinRimHeightM` | f32 | 3 | geo/basin.rs (TB-03 外缘低脊高度) | 外缘低脊高度 (m)；有限支撑环抱轮廓，出口处归零 |
| `terrainBasinExitWidthDeg` | f32 | 34 | geo/basin.rs (TB-03 陆路出口角宽) | 陆路出口角宽（度）；首版至少一个明确出口 |
| `terrainBasinPoolRadiusMinM` | f32 | 10 | geo/basin.rs (TB-03 中心泉池半径抽样下限) | 中心泉池半径抽样下限 (m)；06 §5.6 初值 |
| `terrainBasinPoolRadiusMaxM` | f32 | 14 | geo/basin.rs (TB-03 中心泉池半径抽样上限) | 中心泉池半径抽样上限 (m) |
| `terrainBasinPoolDepthM` | f32 | 2.2 | geo/basin.rs (TB-03 泉池床最大深度) | 泉池床最大深度 (m)；水面位于池床之上、岸环最低地表之下 |
| `terrainBasinBankRingM` | f32 | 12 | geo/basin.rs (TB-03 泉池外干燥岸环宽) | 泉池外干燥岸环宽 (m)；NO_BUILD 禁建安全环，生活带在岸环外 |
| `terrainBasinNoiseGain` | f32 | 0.3 | geo/basin.rs (TB-03 盆底噪声阻尼增益) | 盆底/盆壁噪声阻尼增益；出口与生活带噪声额外抑制 |
| `terrainLakeSemiAxisRatioMin` | f32 | 0.1 | geo/lakeside.rs (TB-03 湖半轴比例抽样下限) | 湖半轴比例抽样下限（×worldSize） |
| `terrainLakeSemiAxisRatioMax` | f32 | 0.16 | geo/lakeside.rs (TB-03 湖半轴比例抽样上限) | 湖半轴比例抽样上限；椭圆两轴各自独立抽样 |
| `terrainLakeDepthM` | f32 | 3.5 | geo/lakeside.rs (TB-03 湖床最大深度) | 湖床最大深度 (m)；静水湖水位恒定 |
| `terrainLakeShoreSetbackM` | f32 | 10 | geo/lakeside.rs (TB-03 水岸安全退距) | 水岸安全退距 (m)；岸线外 NO_BUILD 缓冲，其外为可建干岸 |
| `terrainLakeOutlineWarpM` | f32 | 14 | geo/lakeside.rs (TB-03 湖岸低频径向扰动幅度) | 湖岸低频径向扰动幅度 (m)；限制凹度、不生成岛屿 |
| `terrainLakeNoiseGain` | f32 | 0.3 | geo/lakeside.rs (TB-03 环岸噪声阻尼增益) | 环岸噪声阻尼增益；环岸干岸带平缓可建 |
| `terrainRiverWidthMin` | f32 | 28 | — | T2 地貌 / 通行参数 |
| `terrainRiverWidthMax` | f32 | 42 | — | T2 地貌 / 通行参数 |
| `terrainRiverWaterLevel` | f32 | 0 | — | T2 地貌 / 通行参数 |
| `terrainRiverBankWidth` | f32 | 18 | — | T2 地貌 / 通行参数 |
| `terrainRiverTerraceWidth` | f32 | 65 | — | T2 地貌 / 通行参数 |
| `terrainCrossingWidth` | f32 | 26 | — | T2 地貌 / 通行参数 |
| `terrainSoftGroundCost` | f32 | 1.25 | — | T2 地貌 / 通行参数 |
| `terrainShallowWaterCost` | f32 | 2 | — | T2 地貌 / 通行参数 |
| `terrainMaxWalkSlope` | f32 | 30 | geo/query.rs / graph.rs (道路完整曲线校验) | 普通道路允许的最大坡度 (度) |
| `terrainMaxBuildSlope` | f32 | 16 | geo/query.rs / housing_system/settlement.rs (房屋完整占地) | 房屋/设施完整占地允许的最大坡度 (度) |
| `terrainFootprintHalfExtent` | f32 | 7 | geo/query.rs / housing_system/settlement.rs (房屋占地) | 房屋基础完整占地半径 (m) |
| `terrainRoadCorridorWidth` | f32 | 5 | geo/terrain.rs / graph.rs (道路走廊宽度) | 道路合法走廊宽度 (m) |
| `terrainAccentDensity` | f32 | 1 | geo/accents.rs (装饰密度) | 装饰密度倍率（0.0=无装饰, 0.5=稀疏, 1.0=默认, 2.0=茂密） |
| `terrainAccentSubFeatures` | bool | true | geo/hydrology.rs (§5.3 第 4–5、9 步子特征注入钩子门控) | ★ STAGE2-1（06号 R.5/§5.8）：创世有界重试上限（初始创世失败时阶梯降级重试的最大次数， |
| `terrainGenerationMaxRetries` | u32 | 3 | spatial/world.rs (创世重试预算钳制；STAGE2-5 阶梯降级重试环) | ========================================================================== |

## 9. 四季更迭与宏观气候

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `seasonYearLength` | f32 | 240 | world_season.rs (四季周期) | 一年 (四季) 总时长 (模拟秒) |
| `tempBaseMid` | f32 | 14 | world_season.rs (温度正弦曲线) | 年均基准温度 (℃) |
| `tempAmplitude` | f32 | 17 | world_season.rs (温度正弦曲线) | 季节温度振幅 (℃) |
| `tempElNinoCycleYears` | f32 | 7 | world_season.rs (温度正弦曲线) | 厄尔尼诺叠加正弦周期 (年) |
| `tempElNinoAmplitude` | f32 | 5 | world_season.rs (温度正弦曲线) | 厄尔尼诺叠加正弦振幅范围 (±℃) |
| `tempClimateEpochCycleYears` | f32 | 49 | world_season.rs (温度正弦曲线) | 纪元候波叠加正弦长周期 (年) |
| `tempClimateEpochAmplitude` | f32 | 5 | world_season.rs (温度正弦曲线) | 纪元候波正弦振幅范围 (±℃) |
| `berryFrostDeclineTemp` | f32 | 8 | — | 浆果开始减产的霜降气温阈值 (℃) |
| `berryFrostZeroTemp` | f32 | 0 | — | 浆果彻底绝收休眠的冰封气温阈值 (℃) |

## 10. 空间路网、限速与踩踏演化

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `roadWearDecayRate` | f32 | 0.0033 | graph.rs (踩踏增长/自然衰减 §4.3) | 道路自然杂草衰减速率 (%/小时,相对当前磨损比例衰减，0.005 即 0.5%/h) |
| `roadWearStepInc` | f32 | 0.075 | graph.rs (踩踏增长/自然衰减 §4.3) | 族人单次通行踩踏增量 (等级/次) |
| `roadWearTierStep` | f32 | 0.25 | graph.rs (踩踏增长/自然衰减 §4.3) | 道路等级阶梯步进 (用于 A* 寻路速度加成量化与端点对缓存跨阶失效) |
| `roadBenefitMaxWear` | f32 | 5 | graph.rs (移速增益上限磨损值) | 道路移速增益上限磨损值 (超过此值无额外移速加成) |
| `roadMaxWear` | f32 | 20 | graph.rs (最高磨损等级/溢出上限) | 道路磨损/踩踏耐久度上限 (允许溢出至最多10) |
| `roadSpeedDirtTrack` | f32 | 36 | graph.rs (各道路类型限速) | 泥泞小径限速 |
| `roadSpeedCobblestone` | f32 | 44 | graph.rs (各道路类型限速) | 碎石盘山道限速 |
| `roadSpeedAsphaltUrban` | f32 | 60 | graph.rs (各道路类型限速) | 城镇大道限速 |
| `roadSpeedSkywayElevated` | f32 | 96 | graph.rs (各道路类型限速) | 高架飞索限速 |
| `roadSpeedSmugglerTrail` | f32 | 40 | graph.rs (各道路类型限速) | 私贩密径限速 |
| `roadLevelFactorBase` | f32 | 0.5 | graph.rs (等级速度加成) | 道路等级影响移速基准系数 (等级 0) |
| `roadLevelFactorWearCoef` | f32 | 0.333 | graph.rs (等级速度加成) | 道路等级影响移速磨损系数 |
| `roadLevelFactorMin` | f32 | 0.5 | graph.rs (等级速度加成) | 道路等级移速乘子下限 |
| `roadLevelFactorMax` | f32 | 2.2 | graph.rs (等级速度加成) | 道路等级移速乘子上限 |

## 11. 动力学移动与寻路权重

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `agentMoveStaminaBase` | f32 | 0.6 | agent.rs (运动学) / graph.rs (寻路) | 移动基础体力消耗 (每秒) |
| `agentMoveStaminaPregnant` | f32 | 0.3 | agent.rs (运动学) / graph.rs (寻路) | 孕期额外移动体力消耗 (每秒) |
| `agentMoveStaminaGradeCoef` | f32 | 3.5 | agent.rs (运动学) / graph.rs (寻路) | 坡度对移动体力消耗加成系数 |
| `agentMoveAccelCoef` | f32 | 4 | agent.rs (运动学) / graph.rs (寻路) | 移动加速度收敛系数 |
| `roadAstarGradePenaltyCoef` | f32 | 1.5 | graph.rs (A* 寻路权重) | A* 坡度通行代价惩罚系数 |
| `roadHiddenPreferModifier` | f32 | 0.4 | graph.rs / decisions/ (隐秘道路偏好) | A* 偏好隐秘时隐秘道路代价乘子 |
| `roadVisiblePreferModifier` | f32 | 1.2 | graph.rs / decisions/ (可见道路偏好) | A* 偏好隐秘时公开道路代价乘子 |
| `roadHiddenAvoidModifier` | f32 | 2.5 | graph.rs / decisions/ (隐秘道路偏好) | A* 非偏好隐秘时隐秘道路代价乘子 |
| `roadVisibleAvoidModifier` | f32 | 1 | graph.rs / decisions/ (可见道路偏好) | A* 非偏好隐秘时公开道路代价乘子 |

## 12. 账本与婚姻登记子系统

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `ledgerJournalCapacity` | usize | 64 | ledger/ (所有账本容量) | 账本流水环形缓冲容量 (每团体/家户，条) |

## 13. 宗族系统

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `clanTributeRate` | f32 | 0.05 | ledger/clan.rs (族税征收) | 族税率：家户每周期向族库缴纳账面余额的比例 |
| `clanTributeIntervalTicks` | u64 | 3600 | ledger/clan.rs (族税征收) | 族税征收周期 (tick)，每 N tick 全局统一征收一次 (60 游戏小时) |
| `clanMutualAidMinBalance` | f32 | 50 | ledger/clan.rs (族内互助) | 族内互助族库最低余额门槛 |
| `clanMutualAidFamilyThreshold` | f32 | 10 | ledger/clan.rs (族内互助) | 极贫家庭门槛：家户账面水+粮总额 < 此值视为极贫 |
| `clanMutualAidCooldownTicks` | u64 | 1800 | ledger/clan.rs (族内互助) | 族内互助冷却 (tick)，每家户每 N tick 最多接收一次 (30 游戏小时) |
| `prestigeClanElderBonus` | u32 | 3 | ledger/clan.rs (族长威望奖励) | 宗族长老（族长）顺位任职威望奖励 |

## 14. 地区与王国系统

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `ledgerTaxRate` | f32 | 0.03 | ledger/region.rs (公仓税) | 公仓税率：家户每周期向地区公仓缴纳账面余额的比例 |
| `ledgerTaxIntervalTicks` | u64 | 4800 | ledger/region.rs (公仓税) | 公仓税征收周期 (tick)，每 N tick 全局统一征收一次 (80 游戏小时) |
| `ledgerReliefMinBalance` | f32 | 30 | ledger/region.rs (救济) | 救济公仓最低余额门槛：地区公仓总余额 > 此值方可签发救济 |
| `ledgerReliefFamilyThreshold` | f32 | 8 | ledger/region.rs (救济) | 极贫家庭门槛：家户账面水+粮总额 < 此值视为极贫 |
| `ledgerReliefCooldownTicks` | u64 | 2400 | ledger/region.rs (救济) | 救济冷却 (tick)，每家户每 N tick 最多接收一次救济 (40 游戏小时) |
| `prestigeKingBonus` | u32 | 3 | ledger/region.rs / decisions/scheduler.rs (国王登基威望奖励) | 国王登基任职威望奖励 |
| `royalPrivyIntervalTicks` | u64 | 7200 | — | 国王内帑结算周期 (tick)，每 N tick 结算一次 (120 游戏小时) |
| `royalPrivyRate` | f32 | 0.01 | — | 国王内帑提取比例：从地区公仓各品类物资中提取比例 (1%) |
| `imperialPrivyIntervalTicks` | u64 | 7200 | — | 皇帝公帑结算周期 (tick)，每 N tick 结算一次 (120 游戏小时) |
| `imperialPrivyRate` | f32 | 0.005 | — | 皇帝公帑提取比例：从下属王国公仓各品类物资中提取比例 (0.5%) |

## 15. 外部市场（榷场互市）与幂律动态定价

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `countMarkets` | usize | 1 | ecology/ (POI 数量 §4.7) | 全图生成外部市场 POI 数量 |
| `marketStockMaxWater` | f32 | 400 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 外部市场清水储备容量上限 |
| `marketStockMaxFood` | f32 | 400 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 外部市场粮食储备容量上限 |
| `marketStockMaxWood` | f32 | 400 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 外部市场木料储备容量上限 |
| `marketRegenBaseWater` | f32 | 2 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 外部市场清水每秒自然再生速率 |
| `marketRegenBaseFood` | f32 | 2 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 外部市场粮食每秒自然再生速率 |
| `marketRegenBaseWood` | f32 | 2 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 外部市场木料每秒自然再生速率 |
| `marketPriceBase` | f32 | 0.1 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 满库存起步基准单价 (黄金 / 单位资源) |
| `marketPricePowerExponent` | f32 | 2 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 幂律定价指数 k |
| `marketPriceFloorStock` | f32 | 1 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 计价库存钳制下限 (防除零与价格封顶) |
| `marketEmergencyFamilyStockThreshold` | f32 | 10 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 家户物资绝境警戒线 |
| `marketMinFamilyGold` | f32 | 0.5 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 户主准入起步黄金底线 |
| `marketMinDispatchStamina` | f32 | 15 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 户主出发前往市场的最低体力门槛 |
| `marketSettlementStep` | f32 | 5 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 外部市场单次交易结算步长 (单位) |
| `marketWealthyFamilyGold` | f32 | 200 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 豪绅家户黄金门槛 (≥此值户主面临物资短缺时80%几率赴榷场现货采购) |
| `marketPoorFamilyGold` | f32 | 50 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 平民家户黄金门槛 (<此值严格野外自力更生，非绝境不赴榷场) |

## 16. 二手房屋市场、营地中介拍卖与麦穗竞价

| 字段 (camelCase) | 类型 | 默认值 (JS真相源) | 影响模块 | 中文说明 |
| :--- | :--- | :--- | :--- | :--- |
| `houseAuctionBidCooldownTicks` | u64 | 180 | housing_system/auction.rs (竞价冷却/报价流水/遗产分账) | 买家全局出价冷却 (tick，默认 180 = 3 游戏小时，出价后对任何房屋都不再出价) |
| `houseAuctionDeadlineDurability` | f32 | 10 | housing_system/auction.rs (竞价冷却/报价流水/遗产分账) | 最晚出售修缮度时限 (耐久度跌至此值时只要有新报价即成交) |
| `houseAuctionObservationRatio` | f32 | 0.37 | housing_system/auction.rs (竞价冷却/报价流水/遗产分账) | 麦穗理论最优停止观察期比例 (37%) |
| `houseAuctionMinBidGold` | f32 | 0.01 | housing_system/auction.rs (竞价冷却/报价流水/遗产分账) | 单次出价最低家户黄金门槛 (低于此值不出价) |
| `houseAuctionBidHistoryCapacity` | usize | 128 | housing_system/auction.rs (竞价冷却/报价流水/遗产分账) | 单次拍卖会话报价流水环形缓冲容量 (条) |
| `houseAuctionCrownShareWeight` | f32 | 1 | housing_system/auction.rs (竞价冷却/报价流水/遗产分账) | 王国公户遗产分账份额权重 (与人类受益人同等参与份额制分配，无人类受益人时独得全额) |
| `houseAuctionBenchmarkDecayRate` | f32 | 0.02 | housing_system/auction.rs (竞价冷却/报价流水/遗产分账) | ★ v1.30.0 麦穗决策期标杆衰减速率 (金/模拟秒)：无人击穿时标杆线性下调至底价，防高标杆+空钱袋双锁死；≤0 关闭 |
| `marketPriceBaseWood` | f32 | 0.15 | poi.rs / ecology/ / market.rs (外部市场与动态定价) | 木材基准金价 (保留：待榷市扩展承载木材后作单价基准) |
