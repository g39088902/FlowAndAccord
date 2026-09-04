# housing_system · 私宅全生命周期系统 (AGENTS.md)

> 本目录局部操作指南。全局规则以根目录 `AGENTS.md` 为准（§4.8 行为硬约束 / §4.11 自主决策原则），本文件只收录本目录的职责边界、文件清单与局部易踩坑。

---

## 1. 📂 目录职责

私宅从"自主立宅 → 备货升级 → 成婚繁衍 → 折旧修缮 → 户主亡故空置登记 → 坍塌消亡"的**全生命周期物理规则结算器**。系统只做结算，不做指挥——一切"盖不盖、何时盖、在哪盖"由 agent 自主决策（根 AGENTS.md §4.11）。

## 2. 📁 文件清单（7 个单一职责子模块）

| 文件 | 职责 |
| :--- | :--- |
| `mod.rs` | `tick_housing(dt)`：房屋系统总管线，固定内部顺序（见 §3） |
| `maintenance.rs` | 冬季供暖消耗、自然风化折旧与坍塌、修缮进度结算（★M2 修缮完工记入家户团体事件） |
| `construction.rs` | 施工计时与瞬时升级（★M6 一次性从户主家户账本扣除建材，瞬时晋升） |
| `marriage.rs` | 丧偶解除婚姻（成婚已迁移至马斯洛决策引擎 B16Courtship 与 execute_pending_courtships 物理执行器） |
| `settlement.rs` | `materialize_founded_houses`（立宅实体化：空置节点复用 → 放置校验 → 建门接入 → 营地绑定）+ 空置节点检索 + 营地行政区阶梯升级 |
| `inheritance.rs` | 空置房登记（户主亡故→无主空置→★挂牌瞬间清空居住者→新建携带空报价队列的拍卖会话→营地 vacant_houses 列表+受益人），取代原父系继承；金币继承在 `world.rs::settle_gold_inheritance` |
| `auction.rs` | ★ v1.26.0 决策相位出价执行器 `execute_pending_bids`、麦穗 37% 竞价、份额制分账（王国公户+受益人）与成交交割 |

## 3. ⚙️ tick_housing 内部顺序（勿打乱）

`world.tick()` 中"房屋系统"环节调用本管线，顺序固定：冬季供暖 → 折旧坍塌 → 丧偶解婚 → 修缮结算 → 施工计时与竣工 → 空置房登记（户主亡故→无主→清空居住者→营地列表）→ 金币遗产继承（`world.rs`）→ 营地行政区升级。

> ★ v1.26.0 起「竞价」已不在本管线：出价下沉到决策引擎 `B17BidHouse` 分支，成交由 `decisions/scheduler.rs` 末尾的世界物理执行器 `execute_pending_bids`（`auction.rs`）落地，发生在 `tick_decisions`（步骤 6）而非房屋系统（步骤 4）。

> 升级/立宅启动由 agent 自主决策触发，本目录不扫描指挥。

## 4. ⚠️ 本目录局部易踩坑

### 4.1 严禁复活旧扫描器

`tick_warehouse_founding`（settlement）、`check_start_house_upgrades`（construction）、修缮强制切换块（maintenance）均已删除。任何"系统主动派活"逻辑一律不得回归；`tick_house_repair`/`tick_house_construction` 只能**结算** agent 自己进入的 `RepairingHouse`/`ConstructingHouse` 状态。

### 4.2 立宅实体化：空置节点优先复用

`materialize_founded_houses` 是决策结果的"落地"环节：
1. **先复用后新建**：在候选宅址半径内检索空置节点（房屋坍塌后遗留的孤儿门节点 / 无主野外路口），命中则直接把该节点当大门、不新建节点和车道（仅当该节点无任何出边时才补接入）；
2. **空置定义**：既不是任何现存房屋的 `door_node_id`，也不在任何 POI 的贴合半径内；
3. **放置校验**：与所有现存房屋的 2D 距离 ≥ `house_min_spacing`；
4. 新建路径才 `add_node` 并双向接入最近 3 节点（`RoadClass::DirtTrack`，距离并列按 id 升序）；
5. 最后绑定最近营地、创建 `Tier0Warehouse` 并写回 `home_house_id`。

⚠️ 路网**从不删除节点/车道**（`LaneGraph3D` 无 `remove_node`），复用是遏制节点随代际膨胀的唯一手段；复用检索必须保持确定性（距离并列取 id 较小者），且不得消耗 `WorldRng`。

### 4.3 成婚条件

私宅 ≥ 1 级（`tier != Tier0Warehouse`）、无配偶、户主为成年单身男性、候选女性为成年单身**非孕期**；改嫁判定以女方是否有子女为准；孕期女性绝对不可改嫁。

### 4.4 空置房登记与拍卖挂牌（v1.10.0 ~ v1.26.0）

户主故去 → 房屋 `owner_id`/`spouse_id` 置空 → **★ v1.26.0 挂牌瞬间清空全部居住者**（`home_house_id=None`、`home_camp_node` 回最近营地节点，房屋真正空置，遗孀遗孤立即无家）→ 新建拍卖会话 `HouseAuctionState`（携带空 `bids_history`，报价流水不跨场次）→ 登记到所属营地 `vacant_houses` 列表（附带受益人：在世子女+在世配偶，按 agent.id 升序去重）；无主空置房正常风化（与有主同速率），等待决策引擎竞价；坍塌后从列表移除，大门路网节点可被新立宅复用。

### 4.5 修缮口径

耐久 < `house_durability_max` 才允许推进；agent 处于 `RepairingHouse` 时置 `house.is_repairing = true`（快照/前端展示用）；修满回 `RestingAtCamp`。

### 4.6 升级门槛与施工时长

升级门槛以 `house.rs::is_pantry_full` 为准（根 AGENTS.md §4.8）；施工时长来自 `SimConfig`（`house_build_time_tier0_to_1` 等），改动必须走 config 而非硬编码。

### 4.7 决策相位出价与麦穗 37% 竞价（auction.rs，v1.26.0 重构）

1. **出价下沉到决策引擎**：无房成年男性在自己的决策相位（`(tick+id)%30==0`）命中 `B17BidHouse` 分支 → 在 `fulfill_resting_need` 内用共享 `WorldRng` 随机挑一套在售房屋写 `pending_bid_house_id`（不改变运动状态）；世界执行器 `execute_pending_bids` 校验后落地：**金额 = 家户账本全部黄金（无上限）**，出价后进入 `houseAuctionBidCooldownTicks`(300) 全局冷却；
2. **麦穗 37% 最优停止博弈**（成交判定只看新报价，不回溯历史）：
   - 观察期（起拍至 37% 损耗点）：只记录报价、树立最高标杆 `benchmark_bid`，不成交；
   - 决策期（37% 损耗点至 10% 修缮度）：新报价 `> benchmark_bid` 即成交；
   - 出清期（$\le 10\%$ 修缮度）：有新报价即成交（无人出价则挂到坍塌，接受该兜底缺失）；
3. **报价流水绑定拍卖会话**：`HouseAuctionState.bids_history` 为环形缓冲（容量 `houseAuctionBidHistoryCapacity`），挂牌时新建空队列、成交时随会话归档消失，不跨场次；
4. **份额制分账**：王国公户（`LedgerRef::Region`，权重 `houseAuctionCrownShareWeight`=1）与遗产受益人（在世配偶 1 份 + 每个在世子女 1 份）按权重共分全额成交价，失效受益人份额并入王国公户（无人类受益人时王国独得，零特判）；流水 `TransferTax`（王室）与 `EstateShare`（受益人）；
5. **交割与确权**：买方家户 `debit` 全额黄金 → 分账 → 过户 → 买家与家眷迁入、清出残留旧住户 → `deal_history` 沉淀（`total_bids_count` 取自会话队列长度）。
