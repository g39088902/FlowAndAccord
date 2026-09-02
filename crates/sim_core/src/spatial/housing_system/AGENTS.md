# housing_system · 私宅全生命周期系统 (AGENTS.md)

> 本目录局部操作指南。全局规则以根目录 `AGENTS.md` 为准（§4.8 行为硬约束 / §4.11 自主决策原则），本文件只收录本目录的职责边界、文件清单与局部易踩坑。

---

## 1. 📂 目录职责

私宅从"自主立宅 → 备货升级 → 成婚繁衍 → 折旧修缮 → 代际继承 → 绝嗣废墟"的**全生命周期物理规则结算器**。系统只做结算，不做指挥——一切"盖不盖、何时盖、在哪盖"由 agent 自主决策（根 AGENTS.md §4.11）。

## 2. 📁 文件清单（6 个单一职责子模块）

| 文件 | 职责 |
| :--- | :--- |
| `mod.rs` | `tick_housing(dt)`：房屋系统总管线，固定内部顺序（见 §3） |
| `maintenance.rs` | 冬季供暖消耗、自然风化折旧与坍塌、修缮进度结算（★M2 修缮完工记入家户团体事件） |
| `construction.rs` | 施工计时（按 tier 取 `house_build_time_tier*`）与竣工扩容、生育激活播报（★M2 升级竣工按升级前等级从户主家户账本记 `Construction` 流水，只记账不扣物理库存） |
| `marriage.rs` | 丧偶解除婚姻、自动成婚与单身/丧偶女性就近改嫁 |
| `settlement.rs` | `materialize_founded_houses`（立宅实体化：空置节点复用 → 放置校验 → 建门接入 → 营地绑定）+ 空置节点检索 + 营地行政区阶梯升级 |
| `inheritance.rs` | 父系代际房产确权继承、绝嗣废墟演化（金币继承在 `world.rs::settle_gold_inheritance`） |

## 3. ⚙️ tick_housing 内部顺序（勿打乱）

`world.tick()` 中"房屋系统"环节调用本管线，顺序固定：冬季供暖 → 折旧坍塌 → 丧偶解婚 → 修缮结算 → 施工计时与竣工 → 成婚/改嫁 → 父系继承与绝嗣废墟化 → 金币遗产继承（`world.rs`）→ 营地行政区升级。

> 升级/立宅启动由 agent 自主决策触发，本目录不扫描指挥。

## 4. ⚠️ 本目录局部易踩坑

### 4.1 严禁复活旧扫描器

`tick_warehouse_founding`（settlement）、`check_start_house_upgrades`（construction）、修缮强制切换块（maintenance）均已删除。任何"系统主动派活"逻辑一律不得回归；`tick_house_repair`/`tick_house_construction` 只能**结算** agent 自己进入的 `RepairingHouse`/`ConstructingHouse` 状态。

### 4.2 立宅实体化：空置节点优先复用

`materialize_founded_houses` 是决策结果的"落地"环节：
1. **先复用后新建**：在候选宅址半径内检索空置节点（绝嗣废墟坍塌后遗留的孤儿门节点 / 无主野外路口），命中则直接把该节点当大门、不新建节点和车道（仅当该节点无任何出边时才补接入）；
2. **空置定义**：既不是任何现存房屋（含尚未坍塌的废墟）的 `door_node_id`，也不在任何 POI 的贴合半径内；
3. **放置校验**：与所有现存房屋的 2D 距离 ≥ `house_min_spacing`；
4. 新建路径才 `add_node` 并双向接入最近 3 节点（`RoadClass::DirtTrack`，距离并列按 id 升序）；
5. 最后绑定最近营地、创建 `Tier0Warehouse` 并写回 `home_house_id`。

⚠️ 路网**从不删除节点/车道**（`LaneGraph3D` 无 `remove_node`），复用是遏制节点随代际膨胀的唯一手段；复用检索必须保持确定性（距离并列取 id 较小者），且不得消耗 `WorldRng`。

### 4.3 成婚条件

私宅 ≥ 1 级（`tier != Tier0Warehouse`）、无配偶、户主为成年单身男性、候选女性为成年单身**非孕期**；改嫁判定以女方是否有子女为准；孕期女性绝对不可改嫁。

### 4.4 继承规则

户主故去 → 遗孀与女儿迁出至最近营地；继承人为**在世、无自有房产的直系男性后代中年龄最长者**（未成年亦可）；无继承人 → `is_ruin = true` 并清退所有居住者。

### 4.5 修缮口径

耐久 < `house_durability_max` 才允许推进；agent 处于 `RepairingHouse` 时置 `house.is_repairing = true`（快照/前端展示用）；修满回 `RestingAtCamp`。

### 4.6 升级门槛与施工时长

升级门槛以 `house.rs::is_pantry_full` 为准（根 AGENTS.md §4.8）；施工时长来自 `SimConfig`（`house_build_time_tier0_to_1` 等），改动必须走 config 而非硬编码。
