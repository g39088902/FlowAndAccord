# geo 模块 · 局部操作指南

> 本目录负责确定性地形生成：高程场 + 生物群系 + 水系 + 装饰散布。
> 改本目录代码前：先读根 AGENTS.md §4，再读本文件。
> 全局规则以根 AGENTS.md 为准，冲突时以根文档为准。

## 文件清单

| 文件 | 职责 |
| :--- | :--- |
| `mod.rs` | 模块入口 + 公开重导出 |
| `terrain.rs` | 高程场采样与 `TerrainMap` 结构体（含 `cells`/`features`/`accents`/`sub_features`）+ ★ D-B1-3 子特征选择器 `plan_subfeatures()` |
| `hydrology.rs` | 深度图 → 水面/浅滩/河岸 → 河道闭合轮廓（`River`/`RiverBank` 特征）+ ★ D-B1-3 §5.3 第 4–5、9 步钩子接线 |
| `biome.rs` | 生物群系分类与色表 |
| `query.rs` | 通行性、坡度、建造条件等地表查询 |
| `corridor.rs` | 廊道/路径几何分析 |
| `accents.rs` | ★ v1.49.1 D-A 装饰散布（Tree/Bush/Boulder/RockCluster/GrassTuft，独立 salt RNG） |

## 关键易踩坑

1. **生成顺序**：`terrain.rs::generate_with_profile` 生成高程场（不含水系/装饰）；`hydrology.rs::generate_with_config` 在水系生成完成后追加调用 `accents::generate_accents`。装饰不能在水系生成之前调用（会落入深水区）。
2. **RNG 隔离**：`generate_accents` 使用 `WorldRng::new(seed ^ ACCENT_RNG_SALT)` —— `ACCENT_RNG_SALT = 0x4143_4345_4E54_3031`。此流与地形播撒、生态 POI、水系生成完全独立，保证装饰确定性可单独籽验。
3. **`TerrainMap` 字段增删** = 影响存档序列化 + 快照四处同步（见根 AGENTS.md §4.5）。新增字段须加 `#[serde(default)]` 以保持向后兼容。
4. **装饰储量不写入存档逻辑**：`Vec<TerrainAccent>` 在 `world_save.rs` 中随 `TerrainMap.terrain_state` 自动序列化（由 `#[derive(Serialize, Deserialize)]` 派生），无需在 `WorldSave` 中单独列出。
5. **子特征选择器是纯函数（`terrain.rs::plan_subfeatures`）**：只消费 `seed` / `profile` / `enabled`，**不消费任何 `WorldRng`**、不读不写 `terrain`——这是「新增判定却保持旧 T1/T2 逐字节不变」的唯一办法。判定一律走无状态整数混合 `mix64` / `roll_10000`（**禁用 `DefaultHasher`、浮点哈希、系统时间**，它们跨编译目标不保证一致）。
6. **候选池按 profile 作用域扫描**：`pick_sub_feature_in_class()` 按 kind 编号升序扫描，某 kind 不在本 profile 池内时必须 `continue` 跳过，**不能**用 `?` 提前返回 `None`——T2 候选（`OxbowLake`=4 / `RiverCliff`=5）编号排在 T1 候选（`FootLake`=0 / `RidgeWaterfall`=1）之后，提前返回会让 T2 恒为空。新增 kind 时同步递增 `SUB_FEATURE_KIND_COUNT`。
7. **选中 ≠ 注入（阶段一现状）**：`plan_subfeatures()` 已产出计划，但第 5 步几何施加与第 9 步专属装饰仍是空实现，`terrain.sub_features` 恒为空数组。任何让 `plan` 开始写格子的改动**都是阶段二/三的范围**，且必然改变旧世界输出，须独立递增 `TERRAIN_GENERATOR_VERSION`。
