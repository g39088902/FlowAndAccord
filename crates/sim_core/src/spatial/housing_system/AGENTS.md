# housing_system · 私宅全生命周期系统 (AGENTS.md)

> 本文件是 `crates/sim_core/src/spatial/housing_system/` 目录的局部操作指南，供智能体/开发者改此目录代码前阅读。
> 全局规则以根目录 `AGENTS.md` 为准（§4.8 行为硬约束 / §4.11 自主决策原则），本文件只收录本目录的职责边界与局部易踩坑。

---

## 1. 📂 目录职责

私宅从"自主立宅 → 备货升级 → 成婚繁衍 → 折旧修缮 → 代际继承 → 绝嗣废墟"的**全生命周期物理规则结算器**。

## 2. 📁 文件清单（6 个单一职责子模块）

| 文件 | 职责 |
| :--- | :--- |
| `mod.rs` | `tick_housing(dt)`：房屋系统总管线，固定 9 步内部顺序（见 §3） |
| `maintenance.rs` | 冬季供暖消耗、自然风化折旧与坍塌、修缮进度结算 |
| `construction.rs` | 施工计时（按 tier 取 `house_build_time_tier*`）与竣工扩容、生育激活播报 |
| `marriage.rs` | 丧偶解除婚姻、自动成婚与单身/丧偶女性就近改嫁 |
| `settlement.rs` | `materialize_founded_houses`（立宅实体化：空置节点复用 → 放置校验 → 建门接入 → 营地绑定）+ `is_house_site_valid` / `is_node_vacant` / `find_vacant_node_near` 空置节点检索 + 营地行政区阶梯升级 |
| `inheritance.rs` | 父系代际房产确权继承、绝嗣废墟演化（金币继承在 `world.rs::settle_gold_inheritance`） |

## 3. ⚙️ tick_housing 内部顺序（勿打乱）

`world.tick()` 中"房屋系统"环节调用本管线，顺序固定：

0. `tick_winter_heating` — 冬季或气温 < `house_winter_cold_temp` 时，非废墟非 0 级房屋按 `house_winter_wood_burn_rate`(0.12/s) 烧柴；
1. `tick_house_depreciation_and_collapse` — 折旧，耐久归零坍塌并清退居住者至营地；
2. `tick_bereavement_unmarry` — 死者伴侣解婚；男死则遗孀迁出私宅回营地；
3. `tick_house_repair` — 修缮结算（仅推进 `RepairingHouse` 状态的 agent 的进度，不扫描指挥）；
4/5. `tick_house_construction` — 施工计时与升级竣工（`upgrade_to_next_tier` 扩容 + 播报）；
5.5. `tick_marriage_and_remarriage` — 自动成婚/改嫁（与升级事件**解耦**，每 tick 持续扫描匹配）；
6. （空位注释）升级/立宅启动由 agent 自主决策，本目录不扫描；
7. `tick_patrilineal_inheritance` — 父系代际继承与绝嗣废墟化；
8.5. `settle_gold_inheritance`（定义在 `world.rs`）— 死者随身金币平分给在世直接子女；
9. `tick_camp_administrative_upgrades` — 统计营地辖内有效房屋数，执行 5 级行政区升级。

## 4. ⚠️ 本目录易踩坑

- **严禁复活旧扫描器**：`tick_warehouse_founding`（settlement）、`check_start_house_upgrades`（construction）、修缮强制切换块（maintenance）均已删除，任何"系统主动派活"逻辑一律不得回归；`tick_house_repair`/`tick_house_construction` 只能**结算** agent 自己进入的 `RepairingHouse`/`ConstructingHouse` 状态。
- **立宅实体化的空置节点优先复用**：`materialize_founded_houses` 是决策结果的"落地"环节——先清空全部 `pending_house_pos`（失败者下一拍决策重选），随后逐点执行：
  1. **先复用后新建**：`find_vacant_node_near(cand_pos, house_node_reuse_radius)` 在候选宅址半径内检索**空置节点**（绝嗣废墟坍塌后遗留的孤儿门节点 / 无主野外路口），命中则直接把该节点当大门、房屋落点取节点坐标，**不新建节点、不新建车道**（仅当该节点无任何出边时才由 `ensure_node_connected` 补接入）；
  2. **空置定义**（`is_node_vacant`）：既不是任何现存房屋（含尚未坍塌的废墟）的 `door_node_id`，也不在任何 POI 的 `HOUSE_NODE_POI_OCCUPY_RADIUS`(1.5m) 贴合半径内；
  3. **放置校验**（`is_house_site_valid`）：与所有现存房屋的 2D 距离 ≥ `house_min_spacing`；复用候选在检索阶段即已通过该校验，新建路径则在建节点前重新校验（同拍多人可能抢占）；
  4. 新建路径才 `add_node`（`NodeType::GroundIntersection`）并由 `connect_node_to_nearest` 双向接入最近 3 节点（`RoadClass::DirtTrack`，排除自身、距离并列按 id 升序）；
  5. 最后绑定最近营地、创建 `Tier0Warehouse` 并写回 `home_house_id`/`home_camp_node`/`world_pos`。
  ⚠️ 路网**从不删除节点/车道**（`LaneGraph3D` 无 `remove_node`），复用是遏制节点随代际膨胀的唯一手段；复用检索必须保持确定性（距离并列取 id 较小者），且不得消耗 `WorldRng`。
- **冬季供暖只烧非 0 级有主房**：`tick_winter_heating` 跳过 `is_ruin` 与 `Tier0Warehouse`；家宅木材 < 10 时禁孕（§4.8，配合 `birth.rs`）。
- **修缮口径**：耐久 < `house_durability_max` 才允许推进；agent 处于 `RepairingHouse` 时置 `house.is_repairing = true`（快照/前端展示用）；修满回 `RestingAtCamp`。
- **成婚条件（勿遗漏）**：私宅 ≥1 级（`tier != Tier0Warehouse`）、无配偶、户主为成年单身男性、候选女性为成年单身**非孕期**；改嫁判定以女方是否有子女为准；孕期女性绝对不可改嫁（`agent.rs` 中 `pregnancy_father_id` 约束）。
- **继承规则**：户主故去 → 遗孀与女儿迁出至最近营地；继承人为**在世、无自有房产的直系男性后代中年龄最长者**（未成年亦可）；无继承人 → `is_ruin = true` 并清退所有居住者。
- **升级门槛以 `house.rs::is_pantry_full` 为准**（§4.8：0级水粮90%；1级木85%+水粮50%；2级石85%+水粮木50%；3级金85%+石85%+水粮木50%），施工时长来自 `SimConfig`（`house_build_time_tier0_to_1` 等），改动必须走 config 而非硬编码。
- **行政区升级**：`update_camp_level` 以营地下辖**有效（非废墟）**房屋数为准（0~5 营地 / 6~11 村 / 12~17 乡 / 18~23 镇 / 24+ 县），只在跨越门槛时广播。
