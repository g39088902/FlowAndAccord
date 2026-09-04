# spatial 模块 · 局部操作指南

> 本目录是 sim_core 的空间模拟核心层，包含 14 个散文件 + 3 个子目录（decisions / housing_system / ledger）。
> 改本目录代码前：先读根 AGENTS.md §4，再读本文件，最后读对应子目录的局部 AGENTS.md（如有）。
> 全局规则以根 AGENTS.md 为准，冲突时以根文档为准。

---

## 一、文件清单与职责边界

### 1.1 基础设施层（零业务逻辑）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `vec3.rs` | ~30 | 3D 向量数学库（加减/点积/叉积/距离/归一化） | 任何业务逻辑 |
| `curve.rs` | ~40 | 三次贝塞尔曲线定义与采样 | 路网拓扑 |
| `graph.rs` | ~210 | LaneGraph3D 拓扑路网 + A* 寻路 + 踩踏衰减 + 节点类型 | POI 语义、agent 决策 |

### 1.2 实体层（数据结构 + 轻量行为）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `poi.rs` | ~210 | PrimitivePoi 实体定义（24 处 POI：营地5/泉6/果6/木3/石2/金1/榷场互市1）、ID 段位、储量再生与双库存计价 | 采收逻辑、初始化布局 |
| `house.rs` | ~115 | House 实体（5 阶等级、耐久度、户主绑定）、HouseSnapshot | 施工计时、升级判定、继承（这些在 housing_system/） |
| `agent.rs` | ~530 | Agent3D 实体（生理代谢、随身行囊、状态机、运动、施密特触发器、威望）、百家姓库、Gender/PrimitiveActionState 枚举 | 决策逻辑（在 decisions/）、POI 交互（在 ecology.rs） |

### 1.3 系统层（tick 调度 + 跨实体逻辑）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `world.rs` | ~170 | World3DEngine 结构体定义 + 构造函数 + agent_index 工具 + 节点查找。**业务逻辑已拆分到同目录 4 个子文件**（v1.7.1） | 具体业务逻辑（委托给 world_tick/world_snapshot/world_config/world_season） |
| `world_tick.rs` | ~275 | tick() 管线调度（§4.3 固定顺序）+ settle_gold_inheritance + tick_fetus_reconcile | 具体子系统 tick（委托给 ecology/housing_system/decisions/bookkeeping/ledger） |
| `world_snapshot.rs` | ~415 | generate_snapshot() 快照生成（地形/POI/房屋/路网/agent/家户/婚姻/宗族/地区） | 快照结构体定义（在 snapshot.rs）、前端映射（在 rustworld.js） |
| `world_config.rs` | ~50 | 配置注入与反序列化（apply_config_json / apply_config / set_regen_multiplier） | 配置结构体定义（在 config.rs） |
| `world_season.rs` | ~40 | 四季更迭与宏观环境温度演化（正弦周期拟合） | tick 调度（在 world_tick.rs） |
| `world_save.rs` | ~205 | **读档/存档契约（v1.8.0）**：`WorldSave` 全量状态结构体 + `to_save()` + `serialize_save()` / `deserialize_save()`（格式版本门禁 + 参数校验 + agent id 唯一性校验 + 按 seed 重建地形 + `rebuild_agent_index()`） | 各实体自身的 serde 实现（在各自文件：`graph.rs` 手写路网 serde、`poi.rs` 的 `finite_f32` 助手、`rng.rs` 的 WorldRng） |
| `ecology.rs` | ~445 | 生态初始化（POI 播撒 + 路网构建 + 始祖生成）、POI 交互（现场采收装载、回家卸货入账、在家吃喝、榷场互市）、分娩结算 | 决策（decisions/）、账本结构（ledger/） |
| `birth.rs` | ~205 | 妊娠结算、分娩（原位复用胎儿 ID）、新生儿属性遗传、流产处理 | 受孕判定（在 agent.rs tick_metabolism）、家户入籍（在 ledger/family.rs） |
| `bookkeeping.rs` | ~320 | M2 家庭生命周期结算：继承清算（户主死亡）+ 分家抽资（成年/丧父）。只记账本余额，不动物理库存 | 日常收付（已由 ecology.rs / maintenance.rs 真实收付） |
| `snapshot.rs` | ~290 | 全部快照结构体定义（WorldSnapshot3D / AgentSnapshot / HouseSnapshot / PoiSnapshot / NodeSnapshot / LaneSnapshot / HouseholdSnapshot / MarriageSnapshot / ClanSnapshot / RegionSnapshot / LedgerBalanceSnapshot / TransferRecordSnapshot / GeoCellSnapshot） | 快照赋值（在 world.rs）、前端映射（在 rustworld.js） |

### 1.4 子目录（各有独立局部 AGENTS.md）

| 子目录 | 文件数 | 职责 | 局部指南 |
|---|---|---|---|
| `decisions/` | 9 | 马斯洛决策状态机：需求评估、分支注册表、寻路路由、采收判定、途中重路由、商贸决策、错峰调度 | `decisions/AGENTS.md` |
| `housing_system/` | 7 | 房屋全生命周期：施工升级、冬季供暖、耐久修缮、自动成婚、立宅选址、空置房登记 | `housing_system/AGENTS.md` |
| `ledger/` | 8 | 账本与社会经济制度：账本内核、团体基类、婚姻登记簿、家户体系、宗族、地区王国 | `ledger/AGENTS.md` |

---

## 二、world.rs::tick() 内部调用顺序（勿打乱）

> 这是本层最重要的不变量。调整顺序会破坏确定性或行为语义。详见 `docs/current/13-impact-matrix.md` §二。

```
0. tick_season(dt)                          四季更迭与温度演化
1. POI 自然恢复 (for poi in pois)           按类型应用产速倍率
2. 代谢与繁衍 (for agent in agents)          agent.tick_metabolism (胎儿跳过)
   2.3 tick_fetus_reconcile()                受孕建胎儿/流产移除/位置跟随
   2.5 settle_gold_inheritance()              死者金币平分给在世子一代
3. tick_poi_interactions(dt)                 POI 实际提取、装载、卸货入账、分娩
4. tick_housing(dt)                           房屋折旧、冬季供暖、空置房登记
5. network.tick_wear_decay(dt)               道路自然衰减
6. 运动 (for agent in agents)                 agent.tick_movement (胎儿跳过)
   tick_decisions()                           错峰决策 ((tick + id) % 30 == 0)
7. tick_bookkeeping()                         M2 继承清算 + 分家抽资
8. tick_clan(dt)                              M3 族长顺位 → 族税 → 族内互助
9. tick_region(dt)                            M4 初王顺位 → 长子继承 → 公仓税 → 救济
```

**关键不变量**：
- **卸货入账在决策之前**（步骤 3 → 决策）：决策读到的是卸货后的家户账本余额（M6 起）
- **道路衰减在运动之前**（步骤 5 → 6）：运动踩踏的是衰减后的路网
- **决策在运动之后**：决策基于本 tick 运动后的位置和状态
- **bookkeeping/clan/region 在决策之后**：制度结算使用决策后的最终状态
- **胎儿跳过**：代谢（步骤 2）、运动（步骤 6）、决策均跳过 `is_fetus` 的 agent

---

## 三、核心接口契约

### 3.1 agent.rs ↔ ecology.rs 装载/卸货契约

```
agent.carry_water / carry_food / carry_wood / carry_stone  (每类独立容量 50.0)
agent.carry_gold                                              (容量无限)

ecology.rs::tick_poi_interactions(dt)
  ├─ 现场采收 (DrinkingAtWater / ForagingFood / GatheringWood / MiningStone / MiningGold)
  │    └─ 从 POI 储量扣减 → 装入 agent 行囊 (受 carryCapacityResource 限制)
  │    └─ 无家宅者不装袋，只就地自饮自食
  └─ 回家卸货 (RestingAtCamp)
       └─ 按 poiUnloadRateResource(10/s) 从行囊扣减 → 存入家户账本 (Deposit 流水)
       └─ 在家吃喝从家户账本真实扣减 (Consume 流水)
       └─ 行囊满即触发 ReturningToCamp 返家
```

**改容量/装卸速率必须全链条联动**：`agent.rs` → `ecology.rs` → `decisions/` → `snapshot.rs` → `rustworld.js` → `render.js`（根 AGENTS.md §4.4）。

### 3.2 bookkeeping.rs 与 ledger/ 的分工边界

| 维度 | bookkeeping.rs (M2) | ledger/ (M1/M3/M4) |
|---|---|---|
| 定位 | 家庭生命周期**结算触发器** | 账本与社会制度**数据结构 + 规则** |
| 内容 | 继承清算 (Inheritance) + 分家抽资 (Split) | 账本内核 / 家户 / 婚姻 / 宗族 / 地区王国 |
| 调用方 | world.rs::tick() 步骤 7 | 被 bookkeeping.rs / ecology.rs / housing_system / birth.rs / decisions 调用 |
| 日常收付 | **不负责**（M6 起已删除 Deposit/Consume/Heating 旁路观测） | 提供 Ledger::transfer() 接口，由生态/维护层直接调用 |
| 确定性 | 不消耗 WorldRng，按 id 保序遍历 | 内核操作确定性，不消耗 RNG |

**注意**：bookkeeping.rs 的 `RESOURCE_ORDER` 常量（水/粮/木/石/金）必须与 `ledger/journal.rs::ResourceKind` 枚举顺序一致。

### 3.3 snapshot.rs 的映射责任

snapshot.rs 只定义**数据结构**，不做任何赋值或转换。三处同步：

1. **定义**：`snapshot.rs` 中各 Snapshot 结构体的字段
2. **赋值**：`world.rs::generate_snapshot()` 中从 World3DEngine 状态填充
3. **映射**：`frontend/js/rustworld.js::_applySnapshot()` 中从 JSON 映射为 JS 对象

新增字段时三处必须同步，否则前端读到 `undefined`。详见根 AGENTS.md §4.5。

---

## 四、局部易踩坑

### 4.1 agent_index 哈希表同步

`World3DEngine.agent_index: HashMap<AgentId, usize>` 是 AgentId → agents Vec 下标的快速查找索引。**任何导致 agents Vec 结构变更的操作后必须调用 `rebuild_agent_index()` 刷新**：
- 新增 agent（始祖播撒、分娩、胎儿创建）
- 移除 agent（死亡清理、流产移除胎儿）
- Vec 排序或重排

遗漏会导致 `agent_by_id()` 返回错误下标或 panic。

### 4.2 胎儿 agent 的特殊处理

`Agent3D.is_fetus = true` 的 agent 在以下环节**必须跳过**：
- `world.rs::tick()` 代谢（步骤 2）
- `world.rs::tick()` 运动（步骤 6）
- `decisions/scheduler.rs::tick_decisions()` 决策
- `ecology.rs` POI 交互和渲染
- `render.js` Canvas 绘制和点击拾取

胎儿**参与**：家户成员计数、继承清算（`children_ids` 已包含胎儿）、宗族成员、族谱数据。

分娩时**原位复用胎儿 ID** 替换为新生儿，不新建 ID（`birth.rs::resolve_newborns`）。

### 4.3 WorldRng 消费顺序确定性

`World3DEngine.rng: WorldRng` 全局共享，按 agents 顺序依次消费。**本层任何新增随机消耗必须保持确定性**：
- 遍历 agents 时按 Vec 顺序（即 id 升序），不可用 HashMap 迭代
- POI 初始化播撒按固定类型顺序（营地→泉→果→木→石→金）
- 新增 RNG 消费点会改变后续所有随机数，导致同种子逐字节不一致

`test-wasm.js` 的同种子一致性校验会捕获此类回归。

### 4.4 world.rs 已拆分为 5 个文件（v1.7.1）

world.rs 原 881 行已超 §4.6 的 800 行规范，v1.7.1 拆分为 5 个文件：
- `world.rs`（~170 行）：结构体定义 + 构造函数 + agent_index 工具 + 节点查找
- `world_tick.rs`（~275 行）：tick() 管线调度 + 胎儿对账 + 金币继承
- `world_snapshot.rs`（~415 行）：generate_snapshot() 快照生成
- `world_config.rs`（~50 行）：配置注入与反序列化
- `world_season.rs`（~40 行）：四季温度计算

**Rust 多文件 impl 块分散**：`impl World3DEngine { }` 可在多个文件中分散定义，无需移动结构体定义。新增方法时放入对应职责文件，勿回退到单文件堆积。

**改"快照相关"只需读 `world_snapshot.rs`**，改"tick 调度"只需读 `world_tick.rs`，不用在 880 行里翻。

### 4.5 ecology.rs 的世界重置全量清空

`seed_primitive_ecology()` 是世界重置入口，必须清空**所有**与 agents 相关的状态：
- agents / pois / network / houses（基础实体）
- marriage_registry / household_registry / clan_registry / region_registry（登记簿）
- mutual_aid_cooldown / relief_cooldown（冷却映射）
- total_births / total_deaths / total_miscarriages（计数器）
- next_agent_id / next_house_id（发号器）

遗漏任何一项会导致重置后残留旧状态，引发"重置后族人仍显示旧家户"等 bug。

### 4.6 🔴 运动系统：移动由 `current_lane_id` 唯一驱动 · 非移动态切换必须走 `enter_stationary_state()`（v1.25.0 起）

`agent.rs::tick_movement` 不再维护 `is_moving` 白名单。移动完全由 `current_lane_id.is_some()` 决定：有车道则走完整位移管线（速度积分/车道循迹/踩踏拓路/坡度能耗），无车道则 `current_velocity=0` 直接静止。`dispatch()` / `turn_around_and_route_to()` 自动写入 `current_lane_id`，因此**新增移动态无需修改运动系统任何代码**。

**硬约束**：所有从移动态切到非移动态的场景，必须调用 `agent.enter_stationary_state(state)`——该方法统一清空 `current_lane_id` / `current_velocity` / `route_index`，是"非移动态 = 无车道"不变量的唯一写入入口。禁止直接 `agent.state = X` 而不清车道（会导致沿残留路线继续移动，"人在家但坐标在跑"）。

当前所有非移动态切换点均已走 `enter_stationary_state()`：`advance_to_next_lane`（路线走完转静止态）、`tick_movement`（车道消失转 OffRoadDetour）、`evaluate.rs`（RepairHouse/BuildHouse 需求）、`routing.rs::return_home`（已在家）、`seeking.rs`（放弃远征/求偶资格失败）、`scheduler.rs`（登基/成婚/资格失败）、`ledger/region.rs`（封王终止远征）、`housing_system/`（营建/修缮完工）。

配套契约：
- `advance_to_next_lane` 走完路线后，`route` Vec **不会清空**（仅 `route_index` 越界、`current_lane_id` 置 `None`）。凡"走完后保持原态、等待决策器结算"的状态（`SeekingCourtship` / `SeekingThrone` 走 `_ => {}` 分支），其决策层"是否还在移动/重补路"判定必须用 `current_lane_id.is_none()`，**严禁**用 `route.is_empty()`（永不成立 → 到点站死）。
- 立宅时 `settlement.rs` 直接设置 `world_pos = site_pos` 是已有设计（FoundHome 触发的位置瞬移），与移动系统无关。

详见根 AGENTS.md §4.16 与 `decisions/AGENTS.md` §4.9。

---

## 五、跨子目录调用关系

```
world.rs (tick 调度)
  ├─→ agent.rs        (代谢/运动/状态机)
  ├─→ ecology.rs      (POI 交互/装载/卸货)
  ├─→ birth.rs        (妊娠/分娩/遗传)
  ├─→ bookkeeping.rs  (继承/分家)
  ├─→ graph.rs        (路网/寻路/衰减)
  ├─→ poi.rs          (POI 实体)
  ├─→ house.rs        (房屋实体)
  ├─→ snapshot.rs     (快照定义)
  ├─→ decisions/      (需求评估/分支/路由/调度) ← 有局部 AGENTS.md
  ├─→ housing_system/ (施工/供暖/修缮/成婚/选址/继承) ← 有局部 AGENTS.md
  └─→ ledger/         (账本/家户/婚姻/宗族/地区) ← 有局部 AGENTS.md

ecology.rs → ledger/    (卸货入账 Deposit、在家吃喝 Consume)
housing_system/ → ledger/ (冬季烧柴 Heating、升级扣账 Construction)
bookkeeping.rs → ledger/ (继承 Inheritance、分家 Split)
birth.rs → ledger/       (新生儿入家户、入宗族)
decisions/ → ledger/     (读取家户账本余额做决策)
decisions/ → graph.rs    (A* 寻路、路径规划)
housing_system/ → graph.rs (立宅路网节点接入)
```

**改任何子目录的公共接口时，须检查上图中的调用方是否受影响。**
