# 32. 地形生成门禁（Terrain Generation Gates）

> 定位：把散落在 `geo/`、`spatial/`、探针与 `tools/` 里的**地形生成相关校验与验收**集中为一张门禁地图——谁在什么时机检查什么、失败码是什么、谁消费失败。
> 阅读对象：改地形 / 模板 / 生成器代码前，先读本文件「§9 改 X 跑什么」与「§10 一页速查」。
> 机制细节不在此复述：地表/特征/水体/装饰模型见 [14 号文](./14-terrain-and-network.md)，创世流水线 0–11 步见 [06 号（规划）§5.3](../../plan/tech/06-terrain-templates.md)。

---

## 1. 什么是「地形生成门禁」

地形生成器（`geo/terrain.rs::generate_with_config`，0–9 步私有阶段）产出 `TerrainMap` 后，还要跨过一系列**只读校验、验收窗口、版本与一致性契约**，世界才被允许发布、存档与继续演化。这些统称「地形生成门禁」，按防线分为五层：

| 防线 | 门禁 | 触发时机 | 失败后果 |
| :--- | :--- | :--- | :--- |
| **A. 生成期静态校验** | `validation.rs` 五组断言 | 创世第 7 步（生成器内部） | 失败码暂丢弃，由防线 B 兜底重试 |
| **B. 创世事务门禁链** | 静态几何 → 路网 → 模板专属 → 生存诊断 | `new_seeded_with_config_bounded` 发布前 | 候选整体丢弃 → 有界降级 → 全败返回错误 |
| **C. 存档读入门禁** | 版本 / profile 白名单 / 读档路网校验 | `WorldSave::load` | 明确报错拒绝加载 |
| **D. 探针验收** | `terrain_probe` / `accent_water_probe` 窗口与达标线 | 人工（改生成参数后必跑） | 打印 `GATE FAIL` / `TB01_7_HAS_FAIL`，不自动阻断 |
| **E. 回归 / 一致性门禁** | `tools/` 确定性、配置、快照、文档 | CI 与提交前 | exit 1 阻断发布 |

共同铁律：**全部只读、不修复、不重排既有生成顺序**（06 号 §5.2「不在校验器里偷偷修复数据」）；失败码一经发布**语义不变**，是降级环的分派依据。

---

## 2. 门禁体系总览

| # | 门禁 | 位置 | 失败码示例 | 消费方 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 静态几何校验（5 组断言） | `geo/validation.rs` | `FeatureIdsDuplicated` / `WaterBodyOutlineMismatch` / `CellWaterFlagMismatch` / `AccentIdsNotStrictlyAscending` 等 | 创世门禁链（`Geometry:` 前缀）、几何事务 preview、生成器第 7 步 |
| 2 | 路网读档校验 | `spatial/terrain_network.rs::validate_terrain_world` | `车道 X 不符合地表通行规则` / `POI 不可达` / `没有合法路网` | 创世门禁链（`RoadNetwork:` 前缀）、`world_save.rs` 读档后 |
| 3 | 台地模板门禁 | `validate_plateau_gates` | `PlateauBuildAreaInsufficient` / `PlateauRampABlocked` / `PlateauWaterUnreachable` | 创世门禁链 |
| 4 | 冲积扇模板门禁 | `validate_fan_gates` | `FanBuildAreaInsufficient` / `FanDryCorridorBlocked` | 创世门禁链 |
| 5 | 盆地生活带门禁 | `validate_basin_build_area_gate` | `BasinBuildAreaInsufficient` | 创世门禁链 |
| 6 | 火山湖模板门禁 | `validate_volcanic_lake_gates` | `LakeBuildAreaInsufficient` / `WaterAccessInvalid` / `LakeShoreDisconnected` | 创世门禁链 |
| 7 | 生存诊断 | `spatial/survival_diagnosis.rs::diagnose_survival` | `SpawnDisconnected` / `SurvivalCostExceeded` | 创世门禁链（`Survival:` 前缀） |
| 8 | 有界降级环 | `spatial/creation_fallback.rs` | `budget_exhausted` / `no_new_strategy` | 生产创建入口 |
| 9 | 存档版本 + profile 白名单 | `spatial/world_save.rs` | `地形生成器版本不兼容` / `地形 profile 不受支持` | `WorldSave::load` |
| 10 | 探针 §1.4 GateWindow | `examples/terrain_probe.rs` | `[GATE FAIL]`（越窗项） | 人工验收 |
| 11 | 山口 TB-01-7 验收 | `examples/terrain_probe.rs::print_tb017_verdict` | `TB01_7_HAS_FAIL` | 人工验收 |
| 12 | 冲积扇 G1/G2/G3 | `examples/terrain_probe.rs` | `[GATE FAIL] fan_*` | 人工验收 |
| 13 | 装饰落点禁区 | `examples/accent_water_probe.rs` | `inW0 != 0` / `edge3% != 0` / `minD < 3.0` 等判读 | 人工验收 |
| 14 | 确定性 / 快照 / 配置 / 文档门禁 | `tools/test-wasm.js` 等 | `ALL_TESTS_DONE` 缺失 / exit 1 | CI 与提交前 |
| 15 | 生成器版本契约 | `geo/terrain.rs::TERRAIN_GENERATOR_VERSION` | 存档版本门禁拒绝 | 存档门禁 / 前端兼容线 |

---

## 3. 创世门禁链（生产路径）

生产入口 `World3DEngine::new_seeded_with_config_bounded`（`creation_fallback.rs`）对每个候选世界依次运行 06 号 §5.3 第 10/11 步之后的**门禁链**（`run_creation_gates`）：

```
静态几何（Geometry:） → 路网读档校验（RoadNetwork:） → 模板专属 → 生存诊断（Survival:）
```

> ⚠️ 路网与生存门禁只在**已播撒生态**的候选上运行；旧兼容入口 `new_seeded_with_config`（探针/图鉴用）产出纯地形候选、无 POI/路网，此时**仅做几何门禁**。

### 3.1 静态几何校验（`geo/validation.rs` · 创世第 7 步）

五组只读断言，全部通过才 `Ok(())`：

**断言 1 · `features`**：ID 唯一；按 profile 归属且 kind 与稳定 ID 表一致（T2：1=`River`、10/11=`ShallowFord`、20/21=`RiverBank`；火山湖：1=`WaterBody`）；子特征 ID 段（T1 100–127 / T2 200–227）放行；顶点非空、在界（`BOUND_EPSILON_M=0.5m`）、高程有限。失败码：`FeatureIdsDuplicated` / `FeatureIdKindMismatch` / `FeatureIdOwnershipInvalid` / `FeatureVerticesInvalid`。

**断言 2 · `sub_features`**：ID 严格升序唯一；`feature_ids` 引用存在且升序；accent 区间配对（`[start,end]` 均 Some 且 start ≤ end）。失败码：`SubFeatureIdsUnsortedOrDuplicated` / `SubFeatureReferenceMissing` / `SubFeatureAccentRangeInvalid`。

**断言 3 · 水系**：水体 ID 唯一、轮廓非空且在界、水位有限；**水体轮廓与同 id 特征顶点双副本逐字节相等**（主河水体 1 ↔ `River` 特征 1；静水水体 1 ↔ `WaterBody`，不得误标成河流绕过校验）；静水（火山湖）零流向、零授权走廊、轮廓闭合（末点=首点）且非自交（O(n²) 段相交普查）；取水点引用水体且落位在界；授权走廊 ID 唯一、端点在界、宽度正有限；浅滩特征恰好 2 顶点且**端点必须落在陆侧**（读档校验与 corridor 授权都依赖此事实）。失败码：`WaterBodyIdDuplicated` / `WaterBodyOutlineInvalid` / `WaterBodyFeatureMissing` / `WaterBodyOutlineMismatch` / `StaticWaterOutlineInvalid` / `AccessPointInvalid` / `ConnectionIdDuplicated` / `ConnectionInvalid` / `FordEndpointInvalid` / `FordEndpointNotOnLand`。

**断言 4 · cells 水域归属与通行标志一致**（阈值即物理契约，与第 6 步派生及水系写入同源）：

| surface_kind | 要求 |
| :--- | :--- |
| `DeepWater` | 有水体归属 + `NO_WALK` + `NO_BUILD` |
| `ShallowWater` | 有水体归属 + `NO_BUILD` 且**不** `NO_WALK`（跨河授权通道） |
| `RockFace` | 无水体归属 + `NO_WALK` |
| 其余 | 无水体归属、无 `NO_WALK` |

所有字段有限、肥力 ∈ [0,1]。失败码：`CellFieldNotFinite` / `CellWaterFlagMismatch`。

**断言 5 · 装饰 ID**：按数组顺序**严格递增且唯一**；POI 避让过滤保留原 ID 时可留间隙（v1.53.1 修复，勿回退为「连续」要求）。失败码：`AccentIdsNotStrictlyAscending`。第 7 步执行时装饰尚未散布（恒空平凡通过），本断言供存档加载路径复用。

### 3.2 路网读档校验（`validate_terrain_world`）

- 全图每条车道过 `corridor::validate_curve`（走廊宽度 / `terrain_max_walk_slope` / 浅滩授权 `crossing_id` 豁免）；
- 全体 POI 必须存在 `nearest_node_id` 且在连通图中（自任一图节点可达）。

失败码：`车道 X 不符合地表通行规则` / `没有合法路网` / `POI 缺少道路接入` / `POI X 不可达`。该函数**同时是读档后的复核入口**（`world_save.rs`），保证「存档即读回」。

### 3.3 模板专属门禁（房屋候选 + 走廊 + 岸点）

公共底座 `count_spaced_buildable`：**按最终格网步进 3 扫描**完整占地合法且互不重叠（间距 ≥ 3×`terrain_footprint_half_extent`）的房屋候选，合法性完全由定稿格子裁决（坡度 / `NO_BUILD` / 水体 / 地表）——**固定生成期锚点会落在陡缘/禁建带**（TB-03-06 实测踩坑）。

| 模板 | 生活带 | 走廊 / 路由 | 失败码 |
| :--- | :--- | :--- | :--- |
| 台地 | 台面房屋候选 ≥ 3 | 台心 → 双坡脚水源 POI(10/11) 双入口通路 | `PlateauBuildAreaInsufficient` / `PlateauRampBlocked` / `PlateauWaterUnreachable` / `PlateauRampABlocked` / `PlateauRampBBlocked` |
| 冲积扇 | `r<0.9L` 且 `|θ|<0.85α` 内 ≥ 3 | 山口内 20m → 扇缘全宽**干地**走廊（干沟可慢行横跨） | `FanBuildAreaInsufficient` / `FanDryCorridorBlocked` |
| 盆地 | `q<0.82` 盆底 ≥ 3 | 不再以旧出口几何作为创世硬门禁；实际车道与 POI 仍经路网/生存诊断校验 | `BasinBuildAreaInsufficient` |
| 火山湖 | 环岸 `d>setback` 且 `d<0.75×r_mean` ≥ 3 | 双岸点环岸通路 + 双出口自水线外平台 → 岭外（`r_out×2.55`）可达；岸点全部干地合法 | `LakeBuildAreaInsufficient` / `WaterAccessInvalid` / `LakeShoreDisconnected` |

> ⚠️ 火山湖出口起终点**禁止以水体格为起点**（池心是 DeepWater），且**不可用固定比例半径**（湖半轴独立抽样可达 1.6:1，窄轴方向固定点会落进湖里，TB-03-08 踩坑）。

### 3.4 生存诊断（`survival_diagnosis.rs` · STAGE2-6）

按**实际配置**枚举初始营地与必需资源（水/粮）及市场，逐营地检查路网可达性并计算坡度/软地折算后的往返成本：

- 预算全部由现有配置推导（**不新增超参**）：`允许往返 = 2 × capacity / 代谢速率`（无家宅者只现场自饮自食，约束每一程不耗尽自身容量）；
- 水源/浆果往返受代谢成本门槛约束（失败码 `SurvivalCostExceeded`）；
- **市场只要求路网可达，不设往返时限**（v1.54.1 取消 500s 门槛；即使作为水/粮补给替代 POI 也不受时限约束）；
- 失败码 `SpawnDisconnected`（营地或资源类无合法路网路径）；
- ⚠️ 依赖已注入的非零配置；零值退化配置下车道限速 0，全部营地会如实报 `SpawnDisconnected`。

### 3.5 门禁链顺序与失败码前缀

```
Geometry:<码>   ← validate_static_terrain_geometry（含模板专属门禁，见 3.3）
RoadNetwork:<码> ← validate_terrain_world（仅已播撒生态候选）
Survival:<码>   ← diagnose_survival 最差失败码（worst_code）
```

前缀语义**一经发布不变**，供 `WorldCreationDiagnostic` 记录与将来降级策略细化消费。

---

## 4. 有界降级环（STAGE2-5 · `creation_fallback.rs`）

- **预算**：`terrainGenerationMaxRetries` = 首次之外的最多重试次数（0 = 只尝试一次），入口钳制至 **≤ 8**；耗尽返回 `Err(诊断)`。
- **降级阶梯**（每步必须产生不同的 `(effective_profile, disabled_mask, disable_spurs)` 键）：
  1. 禁用已注入的结构子特征（`disabled_mask`，掩码见 `STRUCTURAL_SUBFEATURE_MASK`）；
  2. 移除可选支脊（仅山口 profile 且开关仍开启）；
  3. 兜底显式降级至已验收的 `flat_baseline`（STAGE2-7 显式诊断基线，可存档续演）。
- **候选隔离**：失败候选的 RNG / 计数器 / POI / 路网 / 缓存整体丢弃，不污染最终模拟；同策略同 seed 必然复现（纯函数式重建）。
- **诊断记录**：`WorldCreationDiagnostic`（seed / requested / effective / generator_version / degraded / attempts[] / end_reason ∈ `first_try` `degraded` `budget_exhausted` `no_new_strategy` `legacy_fallback`）；降级成功不冒充原模板成功——`last_event` 事件流明示 `⚠️ 地形生成降级：请求 X → 实际 Y`。
- **对外**：WASM `world_create` 全败返回 1 + `world_last_error_*`。

---

## 5. 存档读入门禁（`world_save.rs`）

| 门禁 | 判据 | 失败示例 |
| :--- | :--- | :--- |
| 结构版本 | `SAVE_FORMAT_VERSION` 精确相等（不随应用版本自增） | `存档格式版本不兼容` |
| 应用兼容线 | `app_version_compat_line` 前两段 `major.minor` 比对（**禁止**全串 `===`） | `存档应用版本不兼容` |
| 世界参数 | `grid_res != 0`、`world_size` 正有限 | `存档世界参数非法` |
| **地形生成器版本** | `terrain_generator_version == TERRAIN_GENERATOR_VERSION`（当前 **21**） | `地形生成器版本不兼容：存档为 vX，当前内核为 v21` |
| **profile 白名单** | 九个：`mountain_pass_v1` / `river_valley_v1` / `flat_baseline` / `grassland_plain_v1` / `hillside_woodland_v1` / `plateau_v1` / `alluvial_fan_v1` / `basin_oasis_v1` / `volcanic_lake_v1` | `地形 profile 不受支持` |
| 读档路网复核 | 加载后 `validate_terrain_world()` | `车道 X 不符合地表通行规则` |

> 生成器版本与 profile 双门禁保证**旧路网不会与不匹配的新地貌静默组合**。

---

## 6. 探针验收门禁（临时诊断示例，不进入测试套件）

> 运行口径（统一 `grid=256 world=764`，探针冻结配置 = `examples/config.json`；v1.50.70 分辨率 160→256 后门禁窗口已按面积等比重标）。

### 6.1 `terrain_probe` §1.4 GateWindow（草原 / 半坡 / 台地）

`--profile <name> --seeds 60`，每种子逐项比对窗口，违例打印 `[GATE FAIL] seed=N <项>`：

| profile | max_slope | hard_blocked(≥34°) | NO_WALK | buildable_min | detour_p95 | 其他 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `grassland_plain_v1` | 0° ~ 20° | 0 | 0 | **54500** | ≤ 1.15 | — |
| `hillside_woodland_v1` | 22° ~ 28.5° | 0 | 0 | **34000** | ≤ 1.45 | 可建带宽 ≥ 35m |
| `plateau_v1` | 42° ~ 85° | 900 ~ 3800 | 900 ~ 3800 | **18100** | ≤ 3.50 | 可建带宽 ≥ 32m |

窗口说明（实测校准口径）：
- 半坡 `detour_p95` 只保留上界 1.45（几何 Dijkstra 不叠加坡度时耗，全域 <30° 零禁行下绕行比天然 ≈1.08，原 1.15 下限不可达）；
- 台地上限 58→85° 与 hard/no_walk 窗口是 256 细网格离散化后崖缘相邻格对收敛到连续场真值的结果；`examples/config.json` 曾缺 12 个台地字段导致 H≈10m 矮台假象（补齐后 components 恒 1）。

通用指标口径：`>30°` = 走廊拒绝格；`>=34°` = `RockFace`/`NO_WALK` 硬墙；`components` = 可行走连通分量数（>1 即死区，任何模板下都警告）；`detour` ≈1.0 无阻碍、>1.5 才有「近在咫尺必须绕行」；`crossing95` = 直线穿不可行走格（深水/崖壁，浅滩不算）的对置点对绕行比 p95（S7-07 接线门禁，实测校准下限 1.90）；`waterM` = 图中心 → 最近可用水源距离。

### 6.2 山口 TB-01-7 验收（`TB01_7_ALL_PASS`）

`terrain_probe --profile mountain_pass_v1 --seeds 60` 末尾达标线（**改 T1 主脊/鞍部/支脊/噪声任一参数后必须重跑**）：

| 项 | 达标线 | 256 分辨率 60 种子实测 |
| :--- | :--- | :--- |
| components | 恒 **1**（全图可行走连通） | 1 |
| detour_max | ∈ **[2.0, 5.2]** | 达标 |
| buildable | ≥ **47600**/65536（160 时 18600/25600） | min 53295 |
| 硬禁行占比 | **2% ~ 5.5%** | 2.91% ~ 5.04% |
| 支脊检出率 | **100%**（第 1 条支脊全出现） | 100% |

输出 `TB01_7_ALL_PASS` / `TB01_7_HAS_FAIL`。

### 6.3 冲积扇 G1/G2/G3 专属验收

| 指标 | 门槛 | 256 复测实测 |
| :--- | :--- | :--- |
| `fan_coverage`（扇面 z_fan 增量 >2m 格占比） | ≥ **14%** | min 15.6% |
| `fan_gully_visible`（中心深 ≥4m 干沟条数） | ≥ **3** | 达标 |
| `fan_relief`（全图最大高差） | ≥ **40m** | ≥ 58m |

### 6.4 `terrain_probe world N` 创世自检模式

`cargo run --release -p sim_core --example terrain_probe -- world 20`：对 `random` / `river_valley_v1` / `volcanic_lake_v1` 三种 profile 逐种子创世后立刻跑**读档用的同一套校验**（`validate_terrain_world`），确认「非法车道」不会被创世产出——否则世界一旦存档就再也读不回来；并输出最少车道数与车道采样 max_slope 上界。

### 6.5 `accent_water_probe` 装饰落点禁区（v1.52.0 起）

8 模板 × 8 种子，契约判读：`inW0 == 0`（水面多边形内 0 件）、`d<3 == 0`、`edge3% == 0`（边缘带内 0 件）、`cellW == 0`（水格内 0 件）、`minD ≥ 3.0`（保守下限），且各模板 `total` 与预算公式一致（未因拒绝而饥饿）。

生成器侧常量（`accents.rs`）：
- `EDGE_PROTECTION_RATIO = 0.03`（× world_size，764m → 22.9m ≈ 7.6 格步长）；
- `WATER_CLEARANCE_M = 13.0`（v1.52.0 定为 3.0m；**v1.58.1 上调至 13m**，覆盖 ~8.5m 最大模型包围体 × 1.4 最大缩放并留余量；探针判读仍按保守下限 3.0）；
- 水面判定与前端 `drawRiverBand` / `drawWaterBodyTile` **同源**（`point_in_polygon` 唯一实现，静水涂写逐比特不变）。

> 装饰为纯视觉要素：改落点规则**不递增** `TERRAIN_GENERATOR_VERSION`、不动快照结构；但 `accent_rng` 拒绝会改变抽样序列 ⇒ 同种子装饰分布整体重排。

---

## 7. 回归与一致性门禁（`tools/` · CI 与提交前）

| 工具 | 与地形相关的检查面 |
| :--- | :--- |
| `test-wasm.js` | 同种子逐字节一致性、防越界、防 NaN、长程稳定；存档恢复 / 旧版本拒绝 / world intact |
| `test-determinism.js` | 多种子矩阵、分批独立性、快照无副作用、存读档（跨世界 STR_TAB 驻留表以 `start_index==0` 失效，防地名/人名串味） |
| `snapshot-check.js` + `test-wasm.js` | 快照**四处同步**（`snapshot.rs` / `world_snapshot.rs` / `encode.rs` / `snapshot-bin.js`+`rustworld.js`；新增地形快照字段必四处同步，JSON 对拍门禁已随 JSON 通道移除） |
| `config-check.js` | 前后端配置一致性契约；`terrainProfile` 映射「地形生成器版本门禁」、`terrainGridRes` 单一真相源；第 5 条**空转参数**（内核零读取即拒绝）；第 6 条现状文档配置清单漂移 |
| `frontend-check.js` | 前端脚本语法与 DOM ID 完整性 |
| `doc-link-check.js` / `cross-doc-check.js` / `doc-maintenance-check.js` | 文档链接可达、跨文档事实指纹、文档结构与登记体检 |
| CI（[26 号文](./26-cicd.md)） | 编译 WASM → 双副本同步 → test-wasm / cross-doc / doc-link 全绿 → COS 部署 |

---

## 8. 生成器版本契约（`TERRAIN_GENERATOR_VERSION`）

**当前版本 21**（v1.60.0：湖畔盆地 → 火山湖重构）。变更登记在 `geo/terrain.rs` 版本常量注释，此处只列**递增规则**：

| 情形 | 是否递增 | 备注 |
| :--- | :--- | :--- |
| 改变高程 / 地表 / 特征生成算法 | ✅ | 旧存档按版本门禁拒绝 |
| **新 profile 分支入库**（「新分支入库即换版」先例） | ✅ | 同种子输出改变，即使旧路径逐位不变 |
| 掩码 / 扭曲 / 支脊常数（`RIDGE_WARP_*` / `NOISE_WEIGHT_*` / `SADDLE_NOISE_*` / `BRANCH_*` 等） | ✅ | 改值等于换图 |
| 结构型子特征注入（RiverCliff 等） | ✅ | 必然改变命中种子输出 |
| 装饰纯视觉落点（草量、净空、裁树、四象限配额） | ❌ | 不动快照结构、不同步存档兼容线 |
| 仅前端渲染表现 | ❌ | patch 升版即可 |

配套约束：
- 双分支并发各自递增后合并**取高**（v1.50.48 撞号先例：7 = 河谷骨架〔test 线〕与 `flat_baseline`〔master 线〕）；
- 版本推进到 `minor`/`major` 时 `bump-version.js` 同步推进存档兼容线 `SAVE_APP_VERSION`（前两段）并提示「必须重编译 + 旧档废弃」；
- `TerrainMap::branch_ridges` 为 `#[serde(skip)]` 诊断字段（从不序列化，读档按种子重建）；其余新增字段须 `#[serde(default)]` 保持向后兼容。

### 8.1 RNG 隔离硬规则（确定性门禁的前提）

| 规则 | 内容 |
| :--- | :--- |
| 装饰独立盐流 | `ACCENT_RNG_SALT = 0x4143_4345_4E54_3031`，与地形播撒/生态 POI/水系完全独立，可单独籽验 |
| 噪声内核纯函数 | `terrain_noise` 只消费世界种子 + 固定盐值（`SALT_TERRAIN_NOISE`/`SALT_RIDGE_WARP`），**不消费 WorldRng**；盐值一经落地永不更改 |
| 子特征选择器纯函数 | `plan_subfeatures` 只消费 seed/profile/enabled，判定一律走 `mix64`/`roll_10000`（**禁用 `DefaultHasher`、浮点哈希、系统时间**——跨编译目标不保证一致） |
| 支脊抽样消费序固定 | 侧向硬币 → [存在性 → 锚点 → 夹角 → 长度 → 宽度 → 振幅]；禁拒绝式重试改 RNG 消费次数 |
| 模板几何重放 | `relief_rng` 头部公共消费 4 次 + 倾斜重放，`get_*_geometry` 纯函数零共享 RNG |
| 装饰早于 POI 两道防线 | `HILLSIDE_SPRING_CLEARANCE_M=30m`（= 默认交互半径 22 + 8）与 `ecology::trim_trees_near_pois(poi_interaction_radius + 8.0)` 口径必须一致；裁剪只作用于半坡，T1/T2/草原 accents 逐位不变（S7-10 门禁） |

违反任一规则都会破坏「同种子同输出」的确定性，是 `test-wasm.js` / `test-determinism.js` 的拦截面。

---

## 9. 改 X 跑什么（快速决策表）

| 改动 | 必跑门禁 |
| :--- | :--- |
| 改 T1 主脊 / 鞍部 / 支脊 / 噪声参数 | `terrain_probe --profile mountain_pass_v1 --seeds 60` → `TB01_7_ALL_PASS` |
| 改草原 / 半坡 / 台地形态参数 | `terrain_probe --profile <name> --seeds 60` → §1.4 门禁 0 违例 |
| 改冲积扇 | G1/G2/G3 专属验收 + `terrain_probe world 20` |
| 改装饰落点 / 净空 / 裁树 | `accent_water_probe` 契约判读 + 同种子装饰分布核对 |
| 新增 profile 分支 | 递增 `TERRAIN_GENERATOR_VERSION` + 存档白名单 + 探针 GateWindow + （若加字段）快照四处同步 + `config.rs`/`config.js`/`examples/config.json`/`config-check.js` 四处同步 |
| 改任何 Rust 内核 | `cargo build --release` + **WASM 双副本同步**（`frontend/rust/` + `frontend/`）+ `test-wasm.js` + `config-check.js` |
| 改快照字段 | 四处同步（见 §7）+ `snapshot-check.js` + `test-wasm.js` / `test-determinism.js` 回归 |
| 纯文档变更 | `doc-maintenance-check.js` + `cross-doc-check.js` + `bump-version.js --check` 零漂移；**不升版** |

---

## 10. 一页速查（全部门禁清单）

| 门禁 | 检查什么 | 失败即 |
| :--- | :--- | :--- |
| 静态几何 5 断言 | ID/归属/顶点/水体双副本/浅滩陆侧/cells 标志/装饰递增 | 候选丢弃 → 降级 |
| 路网读档校验 | 车道走廊合法 + POI 连通 | 候选丢弃 → 降级；读档拒绝 |
| 模板专属 4 门禁 | 房屋候选 ≥3 + 走廊/出口/岸点 | 候选丢弃 → 降级 |
| 生存诊断 | 营地→水/粮往返成本、市场可达 | 候选丢弃 → 降级 |
| 有界降级环 | 预算 ≤8、阶梯、策略去重 | 全败返回错误 |
| 存档版本/profile | 版本 21、九 profile 白名单 | 拒绝加载 |
| 探针窗口/达标线 | 坡度/禁行/可建/连通/绕行/支脊 | `GATE FAIL` / `HAS_FAIL` |
| 装饰落点禁区 | 边缘 3% 保护带 + 水面净空 13m | 探针判读违例 |
| 回归一致性 | 确定性/快照/配置/文档 | CI exit 1 |
| 生成器版本契约 | 改图即递增 21 | 旧档拒绝 |

---

## 关联文档

- [14 号文 · 地形与路网](./14-terrain-and-network.md)：地表/特征/水体/装饰模型、§8.1 静态几何校验、§8.2 世界初始化事务与有界降级、§9 各模板生成实现
- [06 号 · 快照与存档](./06-snapshot-and-save.md)：快照四处同步链、存档门禁与兼容线
- 规划版 [06 号 · 地形模板](../../plan/tech/06-terrain-templates.md)：创世流水线 0–11 步、§5.3/§5.8 门禁链与降级阶梯
- `crates/sim_core/src/geo/AGENTS.md`：geo 模块局部操作指南（易踩坑清单）
- [03 号 · 确定性](./03-determinism.md) / [28 号 · 不变量](./28-invariants.md) / [26 号 · CI/CD](./26-cicd.md)
