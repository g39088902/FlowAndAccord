# geo 模块 · 局部操作指南

> 本目录负责确定性地形生成：高程场 + 生物群系 + 水系 + 装饰散布。
> 改本目录代码前：先读根 AGENTS.md §4，再读本文件。
> 全局规则以根 AGENTS.md 为准，冲突时以根文档为准。

## 文件清单

| 文件 | 职责 |
| :--- | :--- |
| `mod.rs` | 模块入口 + 公开重导出 |
| `terrain.rs` | 高程场采样与 `TerrainMap` 结构体（含 `cells`/`features`/`accents`/`sub_features` + `branch_ridges` 诊断字段）+ ★ D-B1-3 子特征选择器 `plan_subfeatures()` + ★ TB-01 多尺度噪声内核 `terrain_noise`（确定性 2D 梯度噪声 + 3 倍频 fBm + 主脊域扭曲）+ ★ TB-01-3 支脊系统 `BranchRidge`/`sample_branch_ridges`（pub，供探针消费）+ ★ S7-02 阶段七 `grassland_plain_v1` 草原分支（低幅高程场/孤立残丘/泉溪洼地雕入与 `SpringValley` 泉眼特征） |
| `hydrology.rs` | 深度图 → 水面/浅滩/河岸 → 河道闭合轮廓（`River`/`RiverBank` 特征）+ ★ D-B1-3 §5.3 第 4–5、9 步钩子接线 |
| `biome.rs` | 生物群系分类与色表 |
| `query.rs` | 通行性、坡度、建造条件等地表查询 |
| `corridor.rs` | 廊道/路径几何分析 |
| `accents.rs` | ★ v1.49.1 D-A 装饰散布（Tree/Bush/Boulder/RockCluster/GrassTuft，独立 salt RNG） |

## 关键易踩坑

1. **生成顺序**：`terrain.rs::generate_with_profile` 生成高程场（不含水系/装饰）；T2 `river_valley_v1` 在其后由 `terrain.rs::generate_river_valley_base_relief` 铺满全图写陆地基底（★ STAGE2-2 公式解耦：河阶外低丘公式唯一权威位置），再由 `hydrology.rs::generate_with_config` 完成水系——`generate_river` **仅覆盖水系影响带**（`d < half_width + bank + terrace`），带外一格不碰。水系生成完成后追加调用 `accents::generate_accents`。装饰不能在水系生成之前调用（会落入深水区）。
2. **RNG 隔离**：`generate_accents` 使用 `WorldRng::new(seed ^ ACCENT_RNG_SALT)` —— `ACCENT_RNG_SALT = 0x4143_4345_4E54_3031`。此流与地形播撒、生态 POI、水系生成完全独立，保证装饰确定性可单独籽验。
3. **`TerrainMap` 字段增删** = 影响存档序列化 + 快照四处同步（见根 AGENTS.md §4.5）。新增字段须加 `#[serde(default)]` 以保持向后兼容。
4. **装饰储量不写入存档逻辑**：`Vec<TerrainAccent>` 在 `world_save.rs` 中随 `TerrainMap.terrain_state` 自动序列化（由 `#[derive(Serialize, Deserialize)]` 派生），无需在 `WorldSave` 中单独列出。
5. **子特征选择器是纯函数（`terrain.rs::plan_subfeatures`）**：只消费 `seed` / `profile` / `enabled`，**不消费任何 `WorldRng`**、不读不写 `terrain`——这是「新增判定却保持旧 T1/T2 逐字节不变」的唯一办法。判定一律走无状态整数混合 `mix64` / `roll_10000`（**禁用 `DefaultHasher`、浮点哈希、系统时间**，它们跨编译目标不保证一致）。
6. **候选池按 profile 作用域扫描**：`pick_sub_feature_in_class()` 按 kind 编号升序扫描，某 kind 不在本 profile 池内时必须 `continue` 跳过，**不能**用 `?` 提前返回 `None`——T2 候选（`OxbowLake`=4 / `RiverCliff`=5）编号排在 T1 候选（`FootLake`=0 / `RidgeWaterfall`=1）之后，提前返回会让 T2 恒为空。新增 kind 时同步递增 `SUB_FEATURE_KIND_COUNT`。
7. **选中 ≠ 注入（阶段一现状）**：`plan_subfeatures()` 已产出计划，但第 5 步几何施加与第 9 步专属装饰仍是空实现，`terrain.sub_features` 恒为空数组。任何让 `plan` 开始写格子的改动**都是阶段二/三的范围**，且必然改变旧世界输出，须独立递增 `TERRAIN_GENERATOR_VERSION`。
8. **多尺度噪声内核是纯函数（TB-01-2 起）**：`terrain_noise` 模块（梯度哈希/五次样条/fBm）只消费世界种子 + 固定盐值（`SALT_TERRAIN_NOISE`/`SALT_RIDGE_WARP`），**不消费任何 `WorldRng`**，同入参跨平台逐位一致；盐值一经落地永不更改（改盐值=换图）。fBm 接入高程**必须**同时保留高度调制掩码（平原 0.25 / 山体 0.90）与鞍部保护带（走廊内 ≤0.15），严禁绕过掩码全图均匀加噪——平原 ±2m 噪声即产生大面积 `NO_BUILD` 红格（根 AGENTS.md §4 坑 #3）。主脊域扭曲包络保证两端出图处收敛归零；振幅常数只定双分量**形状权重**，绝对量级由 `ridge_warp_peak_scale` 峰值归一化锁定（目标 45m、160 采样点——梯度噪声输出随种子波动大，直乘振幅会导致部分种子蛇形不可见）。★ TB-01-5（v1.50.40）起 fBm 振幅/波长与支脊开关/振幅比/长度改由 SimConfig 驱动（`terrain_noise_amplitude` / `terrain_noise_scale_base` / `terrain_branch_ridge_enabled` / `terrain_branch_ridge_amplitude_ratio` / `terrain_branch_ridge_length`，前端 config.js 为默认值真相源）：噪声经「坐标预缩放 × 输出增益」接入，默认 300.0/6.0 时两系数恒为 1.0（逐位零漂移）；支脊长度 = 配置长度 × [0.8,1.2] 抖动、振幅 = 配置比 × [0.85,1.15] 抖动 × 主脊振幅，RNG 消费次数与顺序不变；支脊开关关闭时 `relief_rng` 消费序在 saddle_width 后即止（同种子地形不同，各自确定性不破坏）。掩码/扭曲常数（`RIDGE_WARP_*`/`NOISE_WEIGHT_*`/`SADDLE_NOISE_*`）与支脊余下常数（φ 夹角/宽度比/第 2 条概率）改值等于换图，须随 `TERRAIN_GENERATOR_VERSION` 递增（TB-01-6）。 TB-01-3 支脊（`BranchRidge`/`sample_branch_ridges`）三条硬规则：① 锚点必须过鞍部禁区（`|anchor − saddle_along| ≥ 1.5×saddle_width`，线性映射实现、禁止拒绝式重试改变 RNG 消费次数）且限制在 `branch_anchor_bound` 的图内区段 + 朝图心倾斜——否则根部/末梢出图被高程钳位，支脊退化成不可见贴边直线；② 包络必须带根部爬坡（前 30% 长度 0→满幅）——满幅直叠主脊侧翼会产生 ≥34° NO_WALK 交汇斑块，把主脊与支脊间楔形区封口，全图通行连通分量碎成 2~4（验收要求恒为 1；支脊自身最大梯度 0.858×A/W≈33.9° 恰在硬禁行线下，交汇叠加是唯一 ≥34° 来源）；③ 抽样消费序固定（侧向硬币 → [存在性 → 锚点 → 夹角 → 长度 → 宽度 → 振幅]），支脊常数（`BRANCH_*`）改值等于换图。★ TB-01-8 收口（v1.50.41~43）：生成器版本已为 **5**；`TerrainMap::branch_ridges` 为 `#[serde(skip)]` 诊断字段（从不序列化，存档字节零影响，读档按种子重建时重新填充——是坑 #3「`#[serde(default)]`」规则的 skip 变体）；改 T1 主脊/鞍部/支脊/噪声任一参数后必须重跑 60 种子探针矩阵 `cargo run --release -p sim_core --example terrain_probe -- 60`，末尾验收判定块须 `TB01_7_ALL_PASS`（达标线：components==1 全部 · detour 2.0~5.2 · buildable ≥10500 · 硬禁行 2%~5% · 支脊检出率 100%）。
