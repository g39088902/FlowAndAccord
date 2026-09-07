# 荒地开垦农田与农业税经济系统设计

> 状态：设计稿。本文把现有的 POI、家户账本、地区公仓和马斯洛决策引擎连接成一条可实现的生产链，暂不宣称功能已经落地。

## 设计目标

农田应当成为一种可以长期持有、持续产出、需要维护的生产资产，而不是另一种会自动再生的自然 POI。Agent 通过家户账本投入木、石、粮、水和金，把荒地变成耕地，再把产出转成家户粮食和地区税收。资本投入应当有清晰的回本周期、边际收益递减和失败风险，避免“只要有钱就无限堆产出”。

系统遵守现有边界：家户账本仍是家庭物资的唯一真相源，地区公仓仍由 `RegionRegistry` 管理，任何“投资不投资”都来自决策分支，世界 tick 只结算 Agent 已经写下的待执行意图。

## 核心对象

新增 `crates/sim_core/src/spatial/farm.rs`，定义 `FarmPlot` 和 `FarmTier`。农田不放进 `PrimitivePoi`，因为它是产权资产而非自然资源点。

```text
FarmPlot {
  id: FarmPlotId,
  camp_id: u32,
  owner_household: HouseholdId,
  node_id: NodeId,
  area: f32,                 // 可耕面积，首期固定 1.0，后续可扩张
  tier: FarmTier,            // Wasteland → Reclaimed → Irrigated → Tooled → Fertile
  fertility: f32,             // 0..1，每次收获后下降，土壤改良可恢复
  irrigation: f32,            // 0..1，影响干旱季产量
  tool_quality: f32,          // 0..1，影响单位劳作产出
  labor_progress: f32,        // 当前季投入的劳作小时
  crop_stage: f32,            // 0..1，达到 1.0 才能收获
  planted_tick: u64,
  harvest_ready_tick: u64,
  cumulative_output: f32,
  cumulative_tax: f32,
  capital_ledger: Ledger,     // 记录仍沉淀在农田上的资本资产
}
```

`LedgerRef` 增加 `Farm(FarmPlotId)`。这样每一笔投入都能写成 `Family → Farm`，收获写成 `Farm → Family`，农业税写成 `Farm → Region`，不会把投资误记成家庭消费，也不会和现有 `Tax` 流水混淆。`TransferReason` 增加 `AgriculturalTax` 和 `FarmHarvest`；现有 `Investment` 原样保留用于投入流水。

农田通过 `owner_household` 持有，户主死亡或分家时不自动销毁。实现阶段由 `bookkeeping` 在家户解散时把农田转给合法继承家户；无继承人时转入地区公田（`owner_household = None`，由地区账本接管），避免资产凭空消失。

## 开垦、投资和产出

### 四个可投资方向

每块农田有四个独立投资槽，全部使用配置值，不在 Rust 逻辑里散落常数：

| 方向 | 作用 | 建议收益曲线 |
| --- | --- | --- |
| 开垦面积 | 把荒地变成可播种土地 | 一次性解锁，`area` 从 0 增至 1 |
| 灌溉 | 降低旱季损失、缩短成熟时间 | 产量乘数 `1 + 0.35 × irrigation` |
| 农具 | 提高单位劳作产出 | 产量乘数 `1 + 0.25 × tool_quality` |
| 地力 | 提高长期产量并减缓肥力衰减 | 产量乘数 `1 + 0.30 × fertility_bonus` |

首期建议的升级成本由 `config.js` 的 4×5 矩阵承载，与房屋升级成本保持同一注入方式：

| 目标等级 | 水 | 粮 | 木 | 石 | 金 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Reclaimed | 20 | 30 | 60 | 30 | 10 |
| Irrigated | 40 | 20 | 50 | 70 | 30 |
| Tooled | 20 | 30 | 70 | 20 | 50 |
| Fertile | 30 | 40 | 40 | 50 | 80 |

投入时从家户账本扣除资源并转入农田资本账本。每次升级只能提升一级；当家户余额不足时不写 `pending`，因此不会产生“先承诺、后透支”的幽灵投资。为了让资本回报可计算，`FarmPlot` 保存累计投入价值和累计产出，前端可直接显示回本倍数。

### 生产公式

农田每个季节只允许一次收获。成熟度由劳作、温度和水分共同推进；Agent 的劳作不创建新的强制状态扫描器，而是通过投资分支写入 `pending_farm_action`，随后由农田结算器消耗 `labor_progress`。

```text
climate = clamp(1 - abs(temperature - crop_optimal_temp) / crop_temp_span, 0.25, 1.0)
labor   = clamp(labor_progress / labor_required, 0.25, 1.0)
yield   = base_yield_per_area
       × area
       × climate
       × labor
       × (1 + 0.35 × irrigation)
       × (1 + 0.25 × tool_quality)
       × (0.70 + 0.30 × fertility)
```

收获时先把 `yield` 记入 `Farm` 账本，再执行农业税，最后把税后粮食转入家户账本。这样农业税针对的是“本次农业流量”，不会再次对同一批粮食征收一次库存税：现有 `ledger_tax` 仍然只看征税时点的家户存量。

```text
gross = yield
tax   = region_has_king ? gross × agricultural_tax_rate : 0
net   = gross - tax
Farm → Region  : tax       (AgriculturalTax，仅当地区有国王)
Farm → Family  : net       (FarmHarvest)
```

农业税是“王税”，只随王国政体存在：**地区没有国王时不征农业税**，该季收获以 `net = gross` 全额转入家户粮账，账面上不出现 `AgriculturalTax` 流水，也不产生任何欠税债务；王位恢复后，从下一次收获起恢复正常征收，既往未征部分概不追溯。这与现有“无主地区账本冻结”的规则保持一致，且农田与家户账目始终干净、没有历史包袱。

每次收获后：`fertility -= fertility_decay_per_harvest`。地力投资把衰减下限抬高，连续高投入会出现边际收益递减，而不是线性无限增产。

## Agent 自主投资链路

新增 `BranchId::B19InvestFarm` 和 `NeedKind::InvestFarm`。它属于安全/尊重层，不得抢占口渴、饥饿、休息、返家等生理需求。

分支自包含条件：

1. Agent 在世、成年、属于存续家户，并且是户主或户主配偶；
2. 没有临界口渴/饥饿、没有卸货任务，体力高于 `decision_work_stamina_threshold`；
3. 家户水粮余额高于投资后的安全储备线，黄金余额足以覆盖目标等级成本；
4. 家户拥有农田，或营地存在可开垦且未被占用的地块；
5. 该农田没有未结算的 `pending_farm_action`，且投资冷却已经结束；
6. 按确定性 ROI 选择目标：`expected_net_food_30d / capital_cost` 降序，收益相同时取农田 ID 较小者。

分支只写：

```text
pending_farm_action = {
  farm_id,
  target_tier,
  investor_id,
  cost: [(ResourceKind, amount)]
}
```

`world_tick` 在决策阶段之后执行 `execute_pending_farm_actions`，再次校验家户归属、余额、房屋/营地容量和农田状态，成功才扣账、升级并写入 `Investment` 流水。投资动作不消耗 `WorldRng`，候选排序只使用 ID、余额和配置值，保证同种子确定性。

如果后续要表现“下田劳作”，再增加 `CultivatingFarm` 移动态和对应路由；首期可以把投资视为户主在农田节点完成的一次结算，避免为了一个经济动作复活系统扫描式派工。

## 农业税与地区财政

农业税属于地区制度，而不是家户的普通财富税，其征收主体是地区国王。`Region` 增加（有王时正常入账，无王期间保持 0，不存在应征而未征的挂账）：

```text
agricultural_tax_collected: f32
agricultural_output: f32
```

`tick_region` 的顺序调整为：

1. 更新国王与继承；
2. 结算已成熟农田的收获：地区有国王时对本次收获流量征农业税，**无国王时跳过征税、收获全额归家户**；
3. 执行现有 `Tax`（库存税）、救济和内帑。

农业税率、征收周期、税后最低留粮线全部进入 `SimConfig`。建议初始值：农业税率 `0.12`，税后最低留粮线为家户 `decisionFamilyStockTriggerOff` 的 25%。留粮线用于防止征税把家户粮账扣穿：若本期税额会导致家户粮账跌破该线，则按差额少征且差额不滚欠。无王期间不征也不欠，因此不需要欠税上限、滞纳惩罚类参数。

## 快照、存档和前端

实现时需要三处同步：

- `snapshot.rs`：新增 `FarmSnapshot`、`AgricultureSummarySnapshot`，顶层增加 `farms` 和地区农业统计；
- `world_snapshot.rs`：按农田 ID 升序导出，保持只读快照不修改生产状态；
- `frontend/js/rustworld.js`：映射农田、累计产出、投资等级与地区农业统计。

Canvas 先用半透明多边形标出农田，Inspector 展示“等级 / 地力 / 下一次收获 / 本季预计产量 / 累计投入 / 累计农业税”。制度大盘的王国页增加“农业产出、农业税、税负率”三项（无王期间农业税与税负率显示 0），家户页增加“农田资产与净粮食收益”。高频容器必须沿用现有内容快照缓存，避免农田卡片重建破坏点击。

`WorldSave` 需要保存完整 `farms`、`next_farm_id` 和农田账本；新增字段后提升 `SAVE_FORMAT_VERSION`，并同步读档校验。应用版本仍用统一升版器，不手工修改版本字符串。

## 配置清单

建议新增以下配置字段，并同时加入 `config.rs` 常量、`SimConfig`、`Default`、`frontend/js/config.js`、`tools/config-check.js` 和 `tools/test-wasm.js`：

```text
countFarmPlots
farmBaseYieldPerArea
farmLaborRequired
farmCropCycleTicks
farmOptimalTemperature
farmTemperatureSpan
farmFertilityDecayPerHarvest
farmAgriculturalTaxRate
farmTaxIntervalTicks
farmMinimumHouseholdFoodReserve
farmInvestmentCooldownTicks
farmUpgradeCostTier1..4{Water,Food,Wood,Stone,Gold}
farmIrrigationYieldCoef
farmToolYieldCoef
farmFertilityYieldCoef
```

## 分阶段落地

**M1：生产资产内核。** 新增 `farm.rs`、`LedgerRef::Farm`、流水原因、农田存档和快照；只允许测试命令创建农田，先验证产量、账本转移和确定性。

**M2：自主投资。** 接入 B19、待执行意图和 ROI 选址；完成家户继承/分家时的农田产权迁移。

**M3：农业税。** 接入 `tick_region` 与王国统计；地区无国王时跳过征税、收获全额归家户；确保农业税与现有库存税的税基不重复。

**M4：表现层。** 农田 Canvas、Inspector、家户/王国账本页、投资回本曲线和农业税统计标识。

## 必须保留的验证

除现有 `cargo test --lib`、`node tools/test-wasm.js`、`node tools/test-determinism.js`、`node tools/config-check.js`、`node tools/frontend-check.js` 外，农业系统需要增加临时诊断断言：

- 同种子下农田列表、投入流水、收获量、税额逐字节一致；
- 无王地区收获全额归家户、不产生 `AgriculturalTax` 流水与欠税债务，王位恢复后只对新收获征税；
- 家户余额不足时不会写入投资流水，也不会出现负账本；
- 农业税只对收获流量征收一次，普通库存税仍按期对家户存量征收；
- 继承、分家、读档后农田所有权与 `owner_household` 一致；
- 长程运行中农田数量和流水环形缓冲不会无界增长。

