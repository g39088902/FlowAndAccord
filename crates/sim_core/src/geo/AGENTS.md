# geo 模块 · 局部操作指南

> 本目录负责确定性地形生成：高程场 + 生物群系 + 水系 + 装饰散布。
> 改本目录代码前：先读根 AGENTS.md §4，再读本文件。
> 全局规则以根 AGENTS.md 为准，冲突时以根文档为准。

## 文件清单

| 文件 | 职责 |
| :--- | :--- |
| `mod.rs` | 模块入口 + 公开重导出 |
| `terrain.rs` | 高程场采样与 `TerrainMap` 结构体（含 `cells`/`features`/`accents`） |
| `hydrology.rs` | 深度图 → 水面/浅滩/河岸 → 河道闭合轮廓（`River`/`RiverBank` 特征） |
| `biome.rs` | 生物群系分类与色表 |
| `query.rs` | 通行性、坡度、建造条件等地表查询 |
| `corridor.rs` | 廊道/路径几何分析 |
| `accents.rs` | ★ v1.49.1 D-A 装饰散布（Tree/Bush/Boulder/RockCluster/GrassTuft，独立 salt RNG） |

## 关键易踩坑

1. **生成顺序**：`terrain.rs::generate_with_profile` 生成高程场（不含水系/装饰）；`hydrology.rs::generate_with_config` 在水系生成完成后追加调用 `accents::generate_accents`。装饰不能在水系生成之前调用（会落入深水区）。
2. **RNG 隔离**：`generate_accents` 使用 `WorldRng::new(seed ^ ACCENT_RNG_SALT)` —— `ACCENT_RNG_SALT = 0x4143_4345_4E54_3031`。此流与地形播撒、生态 POI、水系生成完全独立，保证装饰确定性可单独籽验。
3. **`TerrainMap` 字段增删** = 影响存档序列化 + 快照四处同步（见根 AGENTS.md §4.5）。新增字段须加 `#[serde(default)]` 以保持向后兼容。
4. **装饰储量不写入存档逻辑**：`Vec<TerrainAccent>` 在 `world_save.rs` 中随 `TerrainMap.terrain_state` 自动序列化（由 `#[derive(Serialize, Deserialize)]` 派生），无需在 `WorldSave` 中单独列出。
