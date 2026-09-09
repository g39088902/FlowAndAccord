# 新增地形实施技术方案

> **状态**：T0 主体、T1 山口聚落与 T2 两岸河谷水系已落地（v1.47.5，commit `6d5cea4`）；支持 T1/T2 模板按种子哈希随机生成（`terrainProfile = 'random'`）；T3 湖泊/湿地/峡谷/瀑布及后续 T4 动态水文未实现、未排期。
> **v1.47.7 变更**：删除 T1 台地（高台）设计与实现——不再生成台地平顶压平地貌与 `Ridge`/`Saddle`/`Terrace` 三类地貌特征及对应前端轮廓绘制（山脊线/山口圆/台地轮廓）；T1 profile 只保留主脊与山口鞍部连续起伏，地貌特征仅剩水系类（`River`/`RiverBank`/`ShallowFord`/`SpringValley`），生成器版本 2→3。
> **整理日期**：2026-09-09。
> **适用范围**：T0 统一地表查询、T1 山口聚落、T2 两岸河谷；T3 湖泊/湿地/峡谷/瀑布仅定义扩展接口，不在本方案中一次性实现。
> **依据**：[25-plan-system-integration.md](./25-plan-system-integration.md)、[22-plan-terrain-features.md](./22-plan-terrain-features.md)、[21-plan-terrain-art.md](./21-plan-terrain-art.md)。
> **定位**：本文是跨阶段实施方案。T0/T1/T2 部分已实现，现状以 `docs/current/01-spatial-network.md`、`08-config-system.md`、`15-save-load.md`、`07-frontend-ui.md` 与 `11-changelog.md` v1.47.5 条目为准；T3~T4 仍为规划契约，不代表当前代码已经具备这些行为。

## 1. 方案结论

采用“静态地貌生成 + 内核地表查询 + 合法走廊生成 + 共享水资源池 + FABS 增量快照”的路线，不引入完整侵蚀模拟、流体模拟、桥梁施工或 GPU 渲染器作为前置条件。

第一条可实施主线如下：

```text
T0 地表查询与完整曲线校验
  -> T1 山口聚落（丘陵/山脊/山口连续起伏；v1.47.7 起无台地）
  -> T2 静态主河/两处浅滩/河滩河阶/泉谷
  -> T3 湖泊/湿地/峡谷/瀑布逐项扩展
  -> T4 动态水文、桥梁、土地演化
```

首批地图采用受约束模板，而不是对当前高程场增加随机噪声：

```text
seed + terrain_generator_version + SimConfig
  -> 地貌骨架与高程
  -> 地表类别与坡度
  -> 水系几何（T2）
  -> 合法走廊、山口/浅滩连接
  -> POI、营地和初始族人候选
  -> 完整世界校验
  -> 路网与快照
  -> 前端材质和装饰派生
```

核心原则：

1. **Rust 地理事实唯一真相源**：前端只绘制内核提供的高程、地表类别、水域、岸带和连接设施，不用装饰反推碰撞或资源。
2. **先走廊后曲线**：先在栅格上找合法通行走廊，再拟合 `Curve3D`；不能用节点端点合法替代整条曲线合法。
3. **静态拓扑先行**：T1/T2 的地形、水位、浅滩和禁建区在创世时确定；运行中不改变道路拓扑，降低缓存和存档风险。
4. **水体几何与水资源池分离**：河湖可以有连续视觉轮廓，但可采水点引用共享资源池，不按岸点重复发库存。
5. **同一查询服务供房屋、农业、防务和路网消费**：不再让各模块分别判断坡度、占地、水域和接路。
6. **新增随机只使用地形局部 RNG**：地貌结构和装饰不污染现有世界 RNG；POI、始祖、出生等既有消费顺序保持不变。
7. **同版本同种子确定性优先于旧地图兼容**：生成器变更必须通过版本门禁拒绝旧存档，不能把旧路网与新地貌静默拼接。

### 1.1 落地状态总览（v1.47.5）

| 阶段 | 状态 | 落地要点 | 剩余工作 |
| :--- | :--- | :--- | :--- |
| T0 地表查询与完整曲线校验 | ✅ 主体已落地 | `GeoCell` 扩展 `SurfaceKind`/肥力/水体关联/标志；`geo/query.rs` 提供 `sample_cell`/`validate_footprint`/稳定失败码；房屋实体化消费完整占地；`TerrainMap::validate_curve` 走廊校验原语；`geo/corridor.rs` 浅滩与陆路寻路 | 生态落位（`ecology/spawn.rs`）部分生存硬约束优化；`terrainGenerationMaxRetries` 已声明未消费 |
| T1 山口聚落（丘陵/山脊/山口连续起伏） | ✅ 已落地（v1.47.1/v1.47.2；v1.47.7 移除台地） | `mountain_pass_v1` profile；局部 `relief_rng` 派生主脊/山口连续起伏；存档版本门禁；前端按地表类别渲染。v1.47.7：删除台地压平与 `Ridge`/`Saddle`/`Terrace` 特征及前端轮廓绘制 | 山口地貌参数已部分配置化；支脊未实现 |
| T2 静态主河/浅滩/河阶/泉谷 | ✅ 已落地 | `river_valley_v1` profile + 生成器版本 3（v1.47.7 起，与 T1 共用全局版本）；主河生成（`geo/hydrology.rs`），单调河床下凹与水面静态；低滩（`NO_BUILD`）与河阶（`RiverTerrace`）；两处静态浅滩走廊（`ShallowFord`，跨水授权）；共享水池 `WaterPool` 聚合取水与稳定扣减；地形感知路网（`spatial/terrain_network.rs`）与 `LaneTerrainProfile` 边权通行代价折算；占地校验拒绝浅水（`WaterCovered`）；存档格式升级为 7（`SAVE_FORMAT_VERSION = 7`，`terrain_state` + `water_pools`）；10 个 T2 配置参数（227→237）；前端河道/岸线/浅滩特征渲染与 HUD 水量去重；支持 T1/T2 模板按种子哈希随机轮换（`terrainProfile: 'random'`） | T3 水系扩展（湖泊/湿地/峡谷/瀑布） |
| T3 湖泊/湿地/峡谷/瀑布 | ⏳ 未实施 | — | 扩展接口与逐项实现 |
| T4 动态水文、桥梁、土地演化 | ⏳ 未实施 | — | — |

实现偏差（方案设计 vs 实际落地）速查：存档格式版本递增至 7（§8.2）；配置落地 16/20 字段（§10，总配置数 221→227→237）；`TerrainFailure` 实现 8/10 变体（§3.4，`WaterCovered` 已产生）；`validate_curve` 落在 `geo/corridor.rs` 与 `terrain.rs`（§5.1）；路网感知生成落地于 `spatial/terrain_network.rs`（§5.1/§5.2）；房屋选址改造实际落在 `housing_system/settlement.rs`（§11.1）；前端地形缓存仍为单一 `_terrainCached`（§7.2）；FABS 新增 `TerrainFeatures=18` 承载山地与水系全部特征（§7.2）。

## 2. 现状与改造边界

### 2.1 当前实现可直接复用的部分

- ✅ `TerrainMap` 已拥有固定网格、高程、坡度和种子，并通过局部 `WorldRng` 生成自然地形；v1.47.1 起支持 `profile` 与生成器版本。
- ✅ `World3DEngine::terrain_dirty` 已支持静态地形只在初始化、读档或显式请求时下发。
- ✅ `LaneGraph3D` 已有节点、双向车道、三次贝塞尔曲线、A*、APSP、路径缓存和路网几何增量签名。
- ✅ `Curve3D` 已提供 3D 位置、切线和弧长计算，可作为贴地路线的几何载体。
- ✅ 房屋、POI、Agent 坐标均使用 `Vec3`，前端已有统一 `project3D` 投影。
- ✅ FABS 已将地形、路网几何与动态磨损拆成不同 section，适合把静态地貌事实作为一次性增量帧发送；v1.47.1 已把地表字段与地貌特征并入 FABS。
- ✅ 存档按 seed 重建地形，v1.47.1 起增加生成器版本与 profile 门禁。

### 2.2 当前实现不能直接承载的部分

- ✅ `GeoCell` 已扩展地表类别、肥力、水体关联与禁建/禁行标志（v1.47.1）；且 `ShallowWater`/`DeepWater`/`RiverBank`/`RiverTerrace` 枚举在 T2 `river_valley_v1` 中已正式激活落地。
- ✅ `sample_cell`/`validate_footprint`/`validate_curve` 已提供，`spatial/terrain_network.rs` 已全面消费地表与走廊合法性；房屋、浅滩道路均做严格占地与走廊检查。
- ✅ `terrain_network.rs` 引入地形感知路网，通过 `corridor::route` A* 走廊与浅滩连接跨河，消除了直线车道穿深水的问题。
- ✅ `LaneEdge3D` 增加 `LaneTerrainProfile`，A* 边权与 Agent 移动速度按地形成本折算，软地/河岸/浅滩产生真实通行减速。
- ✅ 水源 POI 聚合接入 `WaterPool`，多个岸点共享水池库存与自然再生（T2）。
- ✅ 快照与 FABS 格式版本 2 支持河流折线、岸带、浅滩连接等特征下发。
- ✅ `render_world.js` 的 `drawTerrainFeatures` 绘制水系特征（`River`/`RiverBank`/`ShallowFord`/`SpringValley`）；v1.47.7 起 `Ridge`/`Saddle`/`Terrace` 三类轮廓绘制已随特征删除。

T0 基础契约、T1 山地与 T2 水系骨干已全链路打通。剩余长期演化工作（湖泊、湿地、桥梁建造、洪水演化）留待 T3/T4。

## 3. 目标数据模型

### 3.1 地表单元

✅ 已落地（v1.47.1）。`GeoCell` 已扩展为“可查询的静态地表事实”，与下列建议字段一致：

```rust
pub struct GeoCell {
    pub elevation: f32,
    pub slope_angle_deg: f32,
    pub surface_kind: SurfaceKind,
    pub natural_fertility: f32,
    pub water_body_id: Option<u32>,
    pub feature_flags: u16,
}
```

`SurfaceKind` 采用闭集枚举，T0/T1/T2 只启用以下变体（v1.47.1 已全部定义；T1 只实际生成 `DryGround`/`SoftGround`/`RockFace`）：

```text
DryGround       普通干地
SoftGround      湿软地，允许通行但增加成本
ShallowWater    浅水，只有被浅滩连接覆盖的走廊可跨越
DeepWater       深水，硬禁行且禁建
RiverBank       河岸/岸带，允许岸边交互，不代表可涉水
RiverTerrace    河阶，可在占地和坡度满足时建房
RockFace        陡壁/裸岩面，超过通行坡度时硬禁行
```

说明：

- `natural_fertility` 只描述自然土地条件，不能直接写入家户粮食或农业资产 `fertility`。
- `water_body_id` 只表示几何归属；可采水资源通过独立的 `WaterPool` 关联，不能把每个单元当成一份库存。v1.47.5 中，T2 `river_valley_v1` 将深水单元关联至 `Some(1)`，其他地表为 `None`。
- `feature_flags` 只放稳定、可组合的查询事实。v1.47.1 已定义 `NO_BUILD`/`NO_WALK`/`SHORE_ACCESS`/`CROSSING_CANDIDATE` 四个标志；T2 中深水写入 `NO_BUILD|NO_WALK`，河岸写入 `NO_BUILD|SHORE_ACCESS`，浅滩写入 `NO_BUILD|CROSSING_CANDIDATE`。
- T1 启用地表类别与禁建禁行，T2 正式启用水体关联与浅滩候选；两者无缝兼容。

### 3.2 地貌特征

✅ T1/T2 已落地（v1.47.5），定义于 `geo/terrain.rs`；特征使用按 ID 排序的 `Vec`，避免 HashMap 迭代顺序进入确定性路径：

```rust
pub struct TerrainFeature {
    pub id: u32,
    pub kind: TerrainFeatureKind,
    pub vertices: Vec<Vec3>,
    pub elevation: f32,
    pub width: f32,
    pub flags: u16,
}
```

`TerrainFeatureKind` 规划与落地情况（v1.47.7：`Ridge`/`Saddle`/`Terrace` 三特征已删除，不生成也不绘制）：

```text
River          河道中心线和水面边界  ✅ v1.47.5 (T2)
RiverBank      岸带轮廓              ✅ v1.47.5 (T2)
ShallowFord    静态浅滩连接          ✅ v1.47.5 (T2)
SpringValley   泉谷                  ✅ v1.47.5 (T2)
WaterBody      湖泊水面（T3）        ⏳ T3
Wetland        湿地斑块（T3）        ⏳ T3
Cliff          峡谷壁/断崖（T3）     ⏳ T3
Waterfall      瀑布（T3）            ⏳ T3
```

特征的职责是表达几何和查询来源，不承担库存、税收、生产或 Agent 行为。`vertices` 采用世界坐标，前端按投影绘制；浅滩由 `TerrainConnection` 表达授权通道（两端端点、走廊宽度与节点），配合 `corridor::segment_valid` 授权跨水。

### 3.3 水体与共享资源池

✅ 已落地（v1.47.5）。实现于 `geo/hydrology.rs` 与 `spatial/terrain_network.rs`：

```rust
pub struct WaterBody {
    pub id: u32,
    pub level: f32,
    pub flow_direction: Vec3,
    pub resource_pool_id: u32,
    pub vertices: Vec<Vec3>,
}

pub struct WaterPool {
    pub id: u32,
    pub current_stock: f32,
    pub max_stock: f32,
    pub regen_rate: f32,
    pub source_poi_ids: Vec<u32>,
}

pub struct WaterAccessPoint {
    pub id: u32,
    pub water_body_id: u32,
    pub resource_pool_id: u32,
    pub pos: Vec3,
    pub nearest_node_id: Option<u32>,
    pub interaction_radius: f32,
}
```

落地细节：

- T2 保留现有 `PoiType::WaterSource`，但将同一河流两岸的多个岸点（`WaterAccessPoint`）的储量读取和扣减委托给同一个 `WaterPool`（池 ID 1）。
- 既有 Agent 装载、回家卸货、家户账本和施密特触发器保持原有语义；在 `spatial/ecology/harvest.rs` 中，多名 Agent 采水先收集需求并按 `agent.id` 升序稳定排序，再串行扣减共享水池，保证不同执行批次下的绝对确定性。
- 自然再生在 `spatial/ecology/tick.rs` 中按池统一执行，每个水源 POI 的动态储量通过 `sync_water_pois()` 与所属水池实时同步。
- 水面存在但 `current_stock == 0` 时，前端仍绘制水面，HUD 大盘按池 ID 去重统计（`render_hud.js`），避免同一水池被多点统计导致总量虚高。
- T2 水位保持静态几何事实（`terrain_river_water_level = 0.0`），枯水/丰水动态涨落预留给 T4。

### 3.4 地表查询结果

◐ 已落地主体（v1.47.1），实现于 `geo/query.rs`。落地接口与下列建议语义一致，命名按现有风格微调：

```rust
pub struct FootprintQuery {
    pub center: Vec3,
    pub half_extents: (f32, f32),   // 方案原拟 Vec2，实现为元组
    pub rotation_rad: f32,
    pub use_kind: LandUseKind,
}

pub struct TerrainQueryResult {
    pub valid: bool,
    pub failure: TerrainFailure,
    pub min_elevation: f32,
    pub max_elevation: f32,
    pub max_slope_deg: f32,
    pub surface_mask: u16,
    pub walk_cost: f32,
}
```

已提供：

- ✅ `sample_cell(wx, wy)`：返回地表类别、高程、坡度和水体关联。
- ✅ `validate_footprint(query, max_slope_deg)`：对完整占地覆盖的栅格单元求高差、最大坡度、水域覆盖、禁建标记和地表成本；触及浅水时拒绝并返回 `WaterCovered`。
- ✅ `surface_walk_cost(kind)` 与 `explain_failure(failure)`：稳定步行成本与诊断文案。
- ✅ `TerrainMap::validate_curve(curve, corridor_width, max_walk_slope)` 与 `geo/corridor.rs`：完整曲线与走廊校验原语，浅滩授权走廊豁免 `ShallowWater`。

未提供（后续补充）：

- ⏳ `nearest_valid_node(pos, use_kind)`：只返回在合法地表上的路网节点（当前路网由 `spatial/terrain_network.rs` 统一拓扑连接）。

`TerrainFailure` 使用闭集错误码。v1.47.5 实现了 8 个变体：

```text
OutOfBounds          ✅ 产生
WaterCovered         ✅ 产生（占地触碰浅水时拒绝建房）
DeepWater            ✅ 产生
CliffTooSteep        ✅ 产生
SurfaceForbidden     ✅ 产生
FootprintTooUneven   ✅ 产生
NoRoadAccess         ◐ 已定义，暂不产生（房屋占用另由 settlement 检查，未并入）
Occupied             ⏳ 未实现
NoValidCrossing      ⏳ 未实现（T2 走廊校验由 corridor::segment_valid/validate_curve 承载）
```

房屋、农田、哨塔和路卡向查询服务传入各自 `LandUseKind`。当前房屋消费 `LandUseKind::House`；`Farm`/`Defense` 待后续农业与防务接入。

## 4. 确定性地貌生成

### 4.1 RNG 分域与 Profile 模板选择

✅ 已落地 `relief_rng` 与 `hydro_rng`（v1.47.5 起版本 2；v1.47.7 删除 T1 台地压平后 `TERRAIN_GENERATOR_VERSION = 3`）。实现：

```text
terrain_seed = seed
relief_rng   = WorldRng::new(seed ^ 0x5245_4C49_4546_5431)   // "RELIEFT1" 盐值，已固定 (T1)
hydro_rng    = WorldRng::new(seed ^ 0x4859_4452_4F54_3032)   // "HYDRT02" 盐值，已固定 (T2)
```

★ **T1/T2 随机轮换机制**：
- 前端与内核配置中 `terrainProfile` 默认为 `'random'`（亦支持显式锁定 `'mountain_pass_v1'` 或 `'river_valley_v1'`）。
- 当配置为 `'random'` 时，内核在生成前依据世界种子执行确定性哈希：
  `(seed ^ 0x5052_4F46_494C_4531) % 2 == 0` → 实例化为 `mountain_pass_v1`（T1 山口聚落）；
  否则 → 实例化为 `river_valley_v1`（T2 两岸河谷）。
- 创世完成后，`terrain.profile` 记录具体实例化模板名，存档 `WorldSave` 记录真实模板名，完全保持同种子 100% 逐字节确定性与读档一致性，同时确保普通玩家开局/重置时两套地貌按 ~50% 概率自然轮换。

要求：

- 盐值在代码中固定并写入生成器版本说明；不使用系统时间、浮点 Hash 或 HashMap 遍历作为随机输入。
- T1 不消费 `hydro_rng`；T2 只在自身子流中消费，不扰动 Agent、POI 和出生的全局 RNG 序列。
- 前端装饰使用 `terrain_feature_id + material_version + season` 的稳定整数哈希，不消费模拟 RNG。

### 4.2 T0 基础生成器

✅ 主体已落地（v1.47.1），保留 `TerrainMap` 的网格尺寸、世界尺寸和高程采样入口，生成步骤已抽取到 `generate_with_profile`：

1. ✅ 生成基础倾斜和低频起伏，保持当前 seed 的确定性（倾斜/幅度/四相位仍从主 RNG 消费，顺序未变）。
2. ✅ 计算完整网格高程和内部坡度；边界单元采用单侧差分而不是固定为 0，避免边缘通行误判。
3. ✅ 生成初始 `SurfaceKind::DryGround`。
4. ✅ 按坡度阈值写入 `SurfaceKind` 候选：≥34° `RockFace`、≥20° `SoftGround`、其余 `DryGround`；同时写入 `NO_BUILD`（≥18°）与 `NO_WALK`（硬禁行地表）标志。最终禁行由配置和查询服务确定，不直接把所有高坡标成不可通行。
5. ✅ 生成 `natural_fertility` 的静态遮罩（`(0.92 - slope/70 - 归一化高程*0.18).clamp(0.1, 1.0)`）。T0 只透传和可视化，不接入农业产量。
6. ⏳ 对每个初始营地、关键资源和市场执行合法地表与生存距离校验——未实施（`ecology/spawn.rs` 未消费查询服务，`terrainGenerationMaxRetries` 因此尚未被使用）。

`sample_elevation` 已新增 `sample_cell`/`grid_index` 采样入口；仍为最近邻（未改双线性插值）。若后续改变采样方式，必须同时复核 POI、房屋、路网和 Agent 的接地位置。

### 4.3 T1 山口聚落模板

✅ 已落地（v1.47.1/v1.47.2；v1.47.7 起**不再包含台地/高台**），使用可配置的定向地貌骨架（`profile = "mountain_pass_v1"`），不做无限随机重抽：

```text
主脊：一条沿方向 theta 的长条高程增量
支脊：最多两条低幅度分支            ⏳ 当前版本未实现支脊
山口：主脊上的一个低鞍部窗口
台地：❌ 已删除（v1.47.7 起不再生成平顶高台）
```

实现步骤（落地情况）：

1. ✅ 从 `relief_rng` 固定生成 `theta`（±0.18 rad）、主脊偏移（±0.08×world_size）、宽度（0.16~0.23×world_size）、幅度（24~34m）、山口位置（±0.12×world_size）与宽度（0.10~0.15×world_size）。
2. ✅ 用到主脊中心线的有符号距离生成高斯型高程增量；主脊两侧平滑过渡，禁止在格点边界产生尖峰。
3. ✅ 在山口窗口压低主脊（`elev += ridge - ridge * 0.90 * saddle`），生成连续的低坡通道；山口是普通地表走廊，不新增传送节点。
4. ❌ 台地平顶压平算法（Tableland Flattening）——v1.47.7 已整体删除，不再削平任何平台。
5. ✅ 重新计算坡度、地表类别和可建掩码。
6. ❌ `Ridge`/`Saddle`/`Terrace` 特征折线生成——v1.47.7 已整体删除（T1 profile 不再输出任何地貌特征）。
7. ⏳ 先生成/筛选合法 POI 与营地候选，再通过 T0 路网走廊生成器接入节点——未实施（待 `spawn.rs`/走廊生成器接入）。

T1 的首轮验收只要求“路线会绕山、山口可通过”，不增加高地防御、资源加成或行政税收。

### 4.4 T2 主河与浅滩模板

✅ 已落地（v1.47.5）。实现于 `geo/hydrology.rs::generate_river`：

T2 包含“一条蜿蜒主河 + 两处静态浅滩通道 + 两岸河阶 + 泉谷”。

生成流程：

1. ✅ 从 `hydro_rng` 生成主河中心线平移相位，以正弦波结合世界尺寸生成单调中心线（`center(y)`）与变宽河道带（`half_width(y)`）。
2. ✅ 河床高程统一凹陷（`level - 1.4`），地表标记为 `DeepWater`，写入 `NO_BUILD|NO_WALK`，关联 `water_body_id = Some(1)`。
3. ✅ 河道外缘向外生成宽度为 `bank` 的 `RiverBank`（标记 `NO_BUILD|SHORE_ACCESS`），再向外生成宽度为 `terrace` 的 `RiverTerrace`（天然高肥力 0.95，平缓河阶地表）。
4. ✅ 在南侧（`-size*0.24`）与北侧（`size*0.24`）生成两处 `TerrainConnection` 浅滩跨水走廊，河床局部抬高为浅水（`ShallowWater`），写入 `NO_BUILD|CROSSING_CANDIDATE`，并生成 `ShallowFord` 地貌特征折线。
5. ✅ 生成水面双侧轮廓与河岸轮廓（`River` 与 `RiverBank` 特征）。
6. ✅ 在河流两岸交替布置水源取水点（`WaterAccessPoint`），统一绑定至共享水池 `WaterPool #1`。
7. ✅ 生成从河岸高地汇入主河的浅沟特征 `SpringValley`（不产生独立水库存）。
8. ✅ 调用 `recompute_slopes()` 重算受河道开凿影响的坡度与地表属性。

浅滩具有明确的：

```text
crossing_id: 1, 2
两岸接入端点 (start / end) 与路网节点 (node_a / node_b)
实际直线/曲线几何
通道宽度: config.terrain_crossing_width (26.0m)
浅滩地表通行代价: config.terrain_shallow_water_cost (2.0)
仅授权横向穿越，禁止借道浅滩沿河纵向涉水
```

T2 不实现桥梁、游泳、船舶、水位涨落和洪水事件。

## 5. 路网与运动实现

### 5.1 合法走廊生成与地形感知路网

✅ 已落地（v1.47.5）。实现于 `geo/corridor.rs` 与 `spatial/terrain_network.rs`：

```text
节点候选
  -> 网格 A* 走廊搜索 (corridor::route)         ✅ 已落地
  -> 记录地表成本、最大坡度、浅滩跨水连接       ✅ 已落地
  -> 使用固定控制点拟合 Curve3D                 ✅ 已落地
  -> 对完整曲线按走廊宽度栅格化 (validate_curve) ✅ 已落地
  -> 通过后写入 LaneEdge3D (地形通行摘要)        ✅ 已落地
```

落地细节：

- **走廊搜索与校验**（`geo/corridor.rs`）：
  - `segment_valid(t, a, b, width, slope, crossing)` 检查线段覆盖的网格单元，硬禁行 `DeepWater`、`RockFace`、越界与无授权水域；有 `crossing_id` 时允许横向穿越 `ShallowWater`。
  - `validate_curve(t, curve, width, slope, crossing)` 递归自适应二分贝塞尔曲线，对每一段进行走廊宽度栅格化覆盖校验。
  - `route(t, a, b, cfg)` 基于网格的确定性 A* 寻路，在避开深水与陡坡的同时，沿软地和河岸搜索最优通行走廊，并执行视线贪心合并（Raycast Shortcutting）。
- **地形感知路网生成**（`spatial/terrain_network.rs`）：
  - `prepare_terrain_layout`：将 POI 与路网节点移动到合法陆地位置，水源 POI 绑定河岸取水点，非水 POI 避开深水与水系。
  - `connect_terrain_world`：优先为浅滩连接（`TerrainConnection`）在两岸建立交叉节点并授权跨水车道；其余地表节点通过 `corridor::route` 连接为稳定的近邻骨架与连通分量补边。
  - `validate_terrain_world`：创世与读档时校验全图车道均符合地表通行规则，且全体 POI 均在连通图内。

### 5.2 LaneEdge3D 扩展与地形通行代价

✅ 已落地（v1.47.5）。定义于 `spatial/graph.rs`：

```rust
pub struct LaneTerrainProfile {
    pub max_slope_deg: f32,
    pub terrain_time_cost: f32,
    pub surface_mask: u16,
    pub crossing_id: Option<u32>,
}
```

落地细节：

- 每个车道在生成时采样整条曲线覆盖单元，求得最大坡度，并将软地/河岸的 `terrain_soft_ground_cost`（默认 1.25）及浅滩跨水的 `terrain_shallow_water_cost`（默认 2.0）写入 `terrain_time_cost`。
- **A* 寻路边权折算**（`graph.rs::effective_speed`）：
  `effective_speed = edge.speed_limit * road_level_factor / edge.terrain_profile.terrain_time_cost.max(1.0);`
- **Agent 移动速度折算**（`agent.rs`）：
  `target_speed = self.max_desired_speed * road_level_factor * (self.strength / 100.0) / lane.terrain_profile.terrain_time_cost.max(1.0);`
- 行人穿过浅滩或泥泞岸带时具有逼真的减速表现，路网 A* 会自然偏好干地与平坦走廊。
- 路网与地形随 `WorldSave` 完整持久化，读档后 100% 恢复。

### 5.3 在途与失效边界

T1/T2 本身不改变静态拓扑，因此只需防止非法初始曲线。未来出现路卡或水位变化时：

1. 物理层检测当前车道不可通行，报告 `RouteInvalidated` 并把 Agent 放在最近合法位置。
2. 清除当前车道和速度时必须使用 `enter_stationary_state()` 或既有路线恢复入口。
3. 决策器在正常决策相位重新评估去向；系统不得扫描全体 Agent 强制改派任务。
4. 不用 FABS 字符串 epoch 作为通行缓存失效版本。

## 6. 房屋、农业、设施与 POI 接入

### 6.1 房屋完整占地

✅ 已落地（v1.47.1），实现于 `housing_system/settlement.rs`（方案清单原列 `founding.rs`，实际改动位置不同）：

```text
候选中心点
  -> FootprintQuery（房屋尺寸、朝向、LandUseKind::House）
  -> 高差/坡度/地表/水域/河滩/占用校验
  -> 门前接入节点候选
  -> 门前曲线完整合法性校验
  -> 稳定排序后由 Agent 自主选中
```

落地细节：

- `is_house_site_valid` 先执行 `validate_footprint`（`terrain_footprint_half_extent` = 7.0m、`terrain_max_build_slope` = 16°、`LandUseKind::House`），触碰浅水、深水或陡坡直接判非法并返回稳定失败码。
- 候选生成循环对每个候选点先做占地校验，非法点跳过；占用/碰撞仍由原有 `houses_clear` 等规则判定。
- 失败不生成实体；没有合法地块时由决策器按正常分支重试，不由地形系统瞬移居民或强制选址。✅ 与方案一致。
- 门前曲线完整合法性校验（走廊接入后）当前尚未覆盖——房屋只保证占地合法，门前道路仍走既有节点复用逻辑。

### 6.2 农田与静态防务设施

⏳ 未实施。方案：

- 农田、哨塔和路卡统一消费 `validate_footprint`，各自只定义占地、坡度、接路和水域允许规则。
- 天然 `natural_fertility` 与农业可投资 `fertility` 分开；农业接入前先校准公式，避免地形优势和资产肥力重复计算。
- T0 只提供公共查询和诊断；不因地形单元标记为高肥力而直接产生粮食。
- 静态哨塔可以在 T1 消费山口/高地查询，但不自动获得防御、税收或视野加成，除非 18 专项明确接入。
- 路卡和桥梁属于动态通行后续，不得在 T2 视觉层提前生成可用设施。

### 6.3 水源 POI 接入

✅ 已落地（v1.47.5）。实现于 `spatial/poi.rs`、`spatial/ecology/harvest.rs`、`spatial/ecology/tick.rs`：

```rust
pub struct PrimitivePoi {
    // 既有字段保持不变
    pub water_pool_id: Option<u32>,
    pub access_point_id: Option<u32>,
}
```

采收与再生流程：

```text
Agent 到达河岸取水点 (WaterAccessPoint)
  -> harvest.rs: 收集同一 tick 全体 Agent 取水请求
  -> 按 agent.id 升序稳定排序 (保证确定性)
  -> 依次从共享 WaterPool 扣减实际出水量
  -> 装入 Agent 随身行囊
  -> 返回并卸入家户账本
```

落地细节：

- 在 `spatial/poi.rs` 中，`PrimitivePoi` 增加 `water_pool_id` 与 `access_point_id`。
- 在 `spatial/ecology/tick.rs` 中，`self.water_pools` 按池统一进行自然再生，之后调用 `sync_water_pois()` 同步各取水 POI 的储量展示。
- 切换岸点不会绕过 `decision_poi_seek_min_stock_ratio`、`decision_poi_abandon_stock_ratio` 和断流后的市场兜底。水体几何不进入 POI 库存字段，不复制储量。

## 7. 快照与 FABS 方案

### 7.1 JSON 同构结构

✅ 已落地主体（v1.47.1）：`WorldSnapshot3D` 已增加 `terrain_features`、`terrain_generator_version`、`terrain_profile`，`GeoCellSnapshot` 已扩展地表字段；`water_bodies`/`water_access_points` 未加（T2 再补）：

```rust
pub struct WorldSnapshot3D {
    pub terrain_cells: Vec<GeoCellSnapshot>,
    pub terrain_features: Vec<TerrainFeatureSnapshot>,   // ✅ v1.47.1
    pub water_bodies: Vec<WaterBodySnapshot>,            // ⏳ T2
    pub water_access_points: Vec<WaterAccessPointSnapshot>, // ⏳ T2
    pub terrain_generator_version: u32,                  // ✅ v1.47.1
    pub terrain_profile: String,                         // ✅ v1.47.1
    // 既有字段保持不变
}

pub struct GeoCellSnapshot {
    pub elevation: f32,
    pub slope_angle: f32,
    pub surface_kind: String,
    pub natural_fertility: f32,
    pub water_body_id: Option<u32>,
    pub feature_flags: u16,
}
```

快照原则：

- 地形静态数据只在 `terrain_dirty` 为 true 时发出；普通 tick 帧发送空数组并复用前端缓存。✅ 已实现（`terrain_features` 仅脏帧输出，其余帧为空 Vec）。
- `terrain_content_version` 由内核根据生成器版本、地图参数和内容摘要生成，前端只用于缓存键，不参与模拟 RNG。◐ 当前用 `terrain_generator_version + terrain_profile` 表达版本事实，`terrain_content_version` 未单独引入。
- 水池库存是动态事实，应随 POI/水资源快照发送；水体轮廓、岸点和特征几何是静态事实。
- 所有 `Vec` 按稳定 ID、固定种类顺序输出；不能依赖 HashMap 顺序。✅ 特征按生成顺序输出（T2 水系：ShallowFord=10/11、RiverBank=20/21、SpringValley=30；v1.47.7 起不再有 Ridge/Saddle/Terrace）。

### 7.2 FABS 变更

✅ 已落地（v1.47.1）。FABS 地形记录布局已扩展，格式版本 `FORMAT_VERSION` 1→2；实施清单对应落地情况：

1. ✅ `snapshot.rs` 增加字段。
2. ✅ `world_snapshot.rs` 完成 JSON 赋值。
3. ✅ `snapshot_bin/encode.rs` 增加 `surface_kind` 码、`natural_fertility`、`water_body_id`、`feature_flags`（TERRAIN section 单格布局：elevation f32 + slope f32 + surface_kind u8 + fertility f32 + water_body_id opt_u32 + feature_flags u16 + align4，约 8B→24B/格）。
4. ✅ `frontend/js/snapshot-bin.js` 按完全相同顺序解码（FORMAT_VERSION = 2，新增 `align4` 帮助函数）。
5. ✅ `tools/test-snapshot-bin.js` 深比较 JSON 与二进制结果（v1.47.1 落地时通过）。
6. ✅ `snapshot_bin/layout.rs::FORMAT_VERSION` 递增到 2，前端校验不匹配即拒绝旧帧；不要声称旧解码器可以安全解析新地形记录。

新增 section（v1.47.1 只落地第 1 个）：

```text
SectionKind::TerrainFeatures = 18        ✅ v1.47.1（id u32 + kind u8 + flags u16 + elevation f32 + width f32 + vertex_count u16 + 变长顶点 Vec3 + align4）
SectionKind::WaterBodies = 19            ⏳ T2
SectionKind::WaterAccessPoints = 20      ⏳ T2
```

section 记录使用变长顶点列表，未知 section 仍可按 `byte_len` 跳过。T2 若只在 `TERRAIN` 中塞入河流折线，会造成网格快照和矢量几何职责混杂，后续无法做增量和前端缓存，因此不采用。

前端映射：

- ✅ `rustworld.js::_applySnapshot()` 已把静态快照映射到 `this.terrain.cells`（含 `surfaceKind`/`naturalFertility`/`waterBodyId`/`featureFlags`）与 `this.terrain.features`/`generatorVersion`/`profile`。
- ✅ `SnapshotBin.resetCaches()` 在 READY、LOAD_RESULT、REWIND_RESULT、RESET_DONE 时继续执行；跨世界缓存失效仍以 `STR_TAB.start_index == 0` 为准，不能改用 epoch。
- ◐ `this._terrainCached` 未拆成 `terrainGridCached`/`terrainFeatureCached`——当前特征随地形脏帧一起下发、一起缓存，单一标志在 T1 范围内一致；后续特征与网格不同步下发时必须拆分。
- ◐ 读档、重置和回溯成功后清除地形派生缓存、装饰缓存、命中索引和旧世界的可见对象——特征随 `_terrainCached` 整体失效，专项清理待特征缓存拆分时补齐。

## 8. 存档与版本门禁

### 8.1 生成器版本

✅ 已落地（v1.47.5）。`WorldSave` 包含：

```rust
pub terrain_generator_version: u32,     // 当前为 3 (v1.47.7：删除 T1 台地压平后递增)
pub terrain_profile: String,            // "mountain_pass_v1" | "river_valley_v1"
```

`terrain_profile` 用于记录已实例化的具体地貌模板（创世时若配置为 `"random"`，内核会按种子哈希实例化为具体名称入档）。当前严格校验：仅 `mountain_pass_v1` 与 `river_valley_v1` 被接受。

### 8.2 读档规则

✅ 已落地（v1.47.5）：

- ✅ `SAVE_FORMAT_VERSION` 自 6 递增至 7，`WorldSave` 增加 `terrain_state: TerrainMap` 与 `water_pools: Vec<WaterPool>`，地形事实与共享水池直接从存档完整恢复，不依赖重新生成。
- ✅ `deserialize_save()` 严格校验 `save.terrain_generator_version == 3` 与 `save.terrain_profile`，不匹配直接返回明确错误。
- ✅ 校验存档内地形单元数必须等于 `grid_width * grid_height`，否则拒绝加载。
- ✅ `World3DEngine::to_save()` 将当前实际运行的 `terrain_state` 与 `water_pools` 完整入档；存读档测试（`test-wasm.js` Test 3 与 `test-determinism.js` Suite 5）通过，续演完全逐字节吻合。

## 9. 前端景观实现

### 9.1 渲染职责拆分

◐ 已落地（v1.47.1/v1.47.5）：在 `render_world.js` 内提供独立的 `drawTerrainFeatures()` 负责山地与水系特征绘制：

```text
render_terrain.js       网格、坡面材质、边界和地表类别     ⏳ 未拆（内嵌于 render_world.js）
render_features.js      河流、岸线、浅滩、泉谷等水系特征  ◐ 提供 drawTerrainFeatures() 独立函数（v1.47.7 起不含山脊/台地轮廓）
render_world.js         POI、房屋、道路调度及层级排序      ✅
```

### 9.2 绘制顺序

✅ 已落地 T1/T2 全品类特征绘制（v1.47.5）。当前实际顺序：背景底色 → 地形网格四边形 → **地形特征**（`drawTerrainFeatures`）→ 网格线 → 道路/POI/房屋/Agent 等：

- **River**：水蓝色透明光泽宽带（`rgba(56, 133, 190, 0.72)`），宽度自适应视口缩放；
- **RiverBank**：河岸沙洲轮廓带（`rgba(185, 151, 91, 0.42)`）；
- **ShallowFord**：浅滩跨水步道虚线（`rgba(218, 197, 133, 0.95)`，双向虚线）；
- **SpringValley**：浅沟细带；
- ~~**Ridge/Saddle/Terrace**~~（v1.47.7 已删除，不再绘制山脊线/山口圆/台地轮廓）。

规则：

- 普通视图隐藏网格线；道路等级颜色只在分析视图展示。
- 水面颜色、岸石为静态视觉派生，不改变内核通行或库存。
- HUD 大盘水源储量按 `waterPoolId` 去重汇总，避免多个河岸取水点重复累加导致总量虚高。
- 浅滩人物沿内核实际路线移动，过水时根据 `terrain_shallow_water_cost` 自然减速。

### 9.3 命中与标注

⏳ 未实施。方案：

- 地形特征命中检测使用与绘制一致的世界坐标折线和宽度，不用只检测装饰精灵。
- 普通水面不可点击为可采点；只有 `WaterAccessPoint` 的有效岸边区域可进入 POI Inspector。
- 标签层沿用现有选中、悬浮、异常、普通四级优先级；河流名称、浅滩状态和断流状态不能遮住当前 Agent/房屋。

## 10. 配置设计

✅ 已落地 16 个仿真字段（v1.47.5，分区 7「地形生成、地表查询与山口 profile」，字段数 221→227→237）：

```text
✅ terrainProfile             "random"            地貌模板："random"（种子轮换）| "mountain_pass_v1" | "river_valley_v1"
✅ terrainRidgeAmplitude      28.0                山脊/河谷起伏幅度 (m)
✅ terrainRidgeWidth          125.0               山脊/河谷影响宽度 (m)
✅ terrainRiverWidthMin       28.0                主河最小宽度 (m)
✅ terrainRiverWidthMax       42.0                主河最大宽度 (m)
✅ terrainRiverWaterLevel     0.0                 主河水面基准高度 (m)
✅ terrainRiverBankWidth      18.0                河岸缓冲区宽度 (m)
✅ terrainRiverTerraceWidth   65.0                河阶台地宽度 (m)
✅ terrainCrossingWidth       26.0                浅滩跨水走廊宽度 (m)
✅ terrainSoftGroundCost      1.25                软地/河岸通行时间代价乘子
✅ terrainShallowWaterCost    2.0                 浅滩跨水通行时间代价乘子
✅ terrainMaxWalkSlope        30.0                道路/走廊最大通行坡度 (度)
✅ terrainMaxBuildSlope       16.0                房屋完整占地最大坡度 (度)
✅ terrainFootprintHalfExtent 7.0                 房屋基础占地半尺寸 (m)
✅ terrainRoadCorridorWidth   5.0                 道路合法走廊宽度 (m)
✅ terrainGenerationMaxRetries 8                  地形布局有界重试上限
```

实现约束：

- ✅ 每个字段同时出现在 Rust `SimConfig`、默认映射、前端 `config.js`，并由 `config-check.js` 严格契约校验（全系统配置字段总计 237 个）。
- ✅ `terrainProfile` 影响地形创世与存档门禁；当设为 `"random"` 时，内核通过 `(seed ^ 0x5052_4F46_494C_4531) % 2` 确定性分支到 `mountain_pass_v1` 或 `river_valley_v1`。
- ✅ 新增配置不改变现有 `simulationDt`、Agent 决策相位、全局 RNG 消费顺序和 tick 顺序。

## 11. 文件级实施清单

> 落地列：✅ = v1.47.1 已改；◐ = 部分/原语已提供；⏳ = 未实施。

### 11.1 T0

| 文件 | 修改内容 | 落地 |
|---|---|---|
| `crates/sim_core/src/geo/biome.rs` | 扩展 `GeoCell`、新增 `SurfaceKind` 和稳定失败码/标志定义 | ✅ 已改（7 变体 + 4 标志 + `Default`） |
| `crates/sim_core/src/geo/terrain.rs` | 抽取生成步骤、完善边界坡度、增加地表采样与生成器版本 | ✅ 已改（`generate_with_profile`、`sample_cell`/`grid_index`、`validate_curve`、`TERRAIN_GENERATOR_VERSION=1`） |
| `crates/sim_core/src/geo/query.rs` | 新增地表、占地、曲线和接路查询 | ◐ 已建（`sample_cell`/`validate_footprint`/`surface_walk_cost`/`explain_failure`；曲线校验在 `terrain.rs`；无 `nearest_valid_node`） |
| `crates/sim_core/src/geo/corridor.rs` | 新增完整曲线走廊检查和静态路线拟合 | ⏳ 未建（`validate_curve` 原语已提供，走廊生成器待接入） |
| `crates/sim_core/src/geo/mod.rs` | 导出新模块和类型 | ✅ 已改 |
| `crates/sim_core/src/spatial/graph.rs` | 增加地形通行摘要、边权和缓存失效入口 | ⏳ 未改 |
| `crates/sim_core/src/spatial/ecology/spawn.rs` | POI/营地候选改用合法地表和有效节点 | ⏳ 未改 |
| `crates/sim_core/src/spatial/housing_system/founding.rs` | 中心点校验改为完整占地和门前接路 | ◐ 实际落在 `housing_system/settlement.rs`（`is_house_site_valid` + 候选过滤） |
| `crates/sim_core/src/config.rs` | 增加仿真地形参数 | ✅ 6 字段（分区 7） |
| `frontend/js/config.js` | 增加与 Rust 对齐的字段 | ✅ 6 字段 |
| `tools/config-check.js` | 增加地形字段影响模块映射 | ✅ 6 行映射 |

### 11.2 T1

| 文件 | 修改内容 | 落地 |
|---|---|---|
| `crates/sim_core/src/geo/terrain.rs` 或新 `relief.rs` | 丘陵、主脊、支脊、山口模板 | ✅ 实现在 `terrain.rs`（`relief_rng` + 高斯脊型，未建 `relief.rs`；支脊未实现；v1.47.7 删除台地压平） |
| `crates/sim_core/src/geo/feature.rs` | `TerrainFeature` 与稳定特征生成 | ◐ 实际并入 `terrain.rs`（`TerrainFeature`/`TerrainFeatureKind`/`build_t1_features`，未建 `feature.rs`） |
| `crates/sim_core/src/spatial/ecology/seed.rs` | 生成顺序：地貌校验后再播撒 POI、节点和始祖 | ⏳ 未改 |
| `crates/sim_core/src/spatial/graph.rs` | 山地合法走廊、坡度和地表成本接入 | ⏳ 未改 |
| `crates/sim_core/src/spatial/world_save.rs` | 生成器版本/profile 门禁 | ✅ 已改（deserialize 门禁 + `serde(default)`；`SAVE_FORMAT_VERSION` 保持 6） |
| `crates/sim_core/src/spatial/snapshot.rs` | 地表字段和地貌特征快照定义 | ✅ 已改（`GeoCellSnapshot` 扩展 + `TerrainFeatureSnapshot` + 版本/profile） |
| `crates/sim_core/src/spatial/world_snapshot.rs` | JSON 快照赋值 | ✅ 已改（特征仅脏帧输出） |
| `crates/sim_core/src/spatial/snapshot_bin/layout.rs` | FABS 版本和新增 section | ✅ `FORMAT_VERSION` 1→2、`TerrainFeatures=18` |
| `crates/sim_core/src/spatial/snapshot_bin/encode.rs` | 地表字段与特征编码 | ✅ 已改（TERRAIN 扩展 + TerrainFeatures section + 全局版本/profile） |
| `crates/sim_core/src/spatial/snapshot_bin/dict.rs` | 枚举名表 | ✅ 已改（`surfaceKind`/`terrainFeatureKind` 表注入 `enum_table_json`） |
| `frontend/js/snapshot-bin.js` | 同构解码 | ✅ 已改（`FORMAT_VERSION=2`、`K.TERRAIN_FEATURES=18`、`align4`、变长特征解码） |
| `frontend/js/rustworld.js` | 静态地形/特征缓存映射 | ✅ 已改（`features`/`generatorVersion`/`profile`；仍单一 `_terrainCached`） |
| `frontend/js/render_world.js` | 地形、材质和遮挡绘制 | ✅ 已改（`drawTerrainFeatures`：水系特征；v1.47.7 删除 Ridge/Saddle/Terrace 分支） |
| `frontend/js/render_canvas.js` | 保持调度并增加必要缓存失效调用 | ⏳ 未改 |

### 11.3 T2

| 文件 | 修改内容 | 落地 |
|---|---|---|
| `crates/sim_core/src/geo/hydrology.rs` | 主河、水体、河阶、岸带、浅滩和水池生成 | ✅ 已建（`generate_river`、`WaterPool`、`Hydrology`） |
| `crates/sim_core/src/geo/corridor.rs` | 浅滩走廊校验与跨水授权寻路 | ✅ 已建（`segment_valid`、`validate_curve`、`route`） |
| `crates/sim_core/src/spatial/terrain_network.rs` | 地形感知路网生成、边权折算与浅滩跨河 | ✅ 已建（`prepare_terrain_layout`、`connect_terrain_world`、`validate_terrain_world`） |
| `crates/sim_core/src/spatial/graph.rs` | `LaneEdge3D` 增加 `LaneTerrainProfile` 通行摘要与 A* 边权折算 | ✅ 已改 |
| `crates/sim_core/src/spatial/agent.rs` | 移动速度按 `lane.terrain_profile.terrain_time_cost` 折算 | ✅ 已改 |
| `crates/sim_core/src/spatial/poi.rs` | 水源 POI 关联 `WaterPool`/岸点，保持既有采收 API | ✅ 已改（`water_pool_id`、`access_point_id`） |
| `crates/sim_core/src/spatial/ecology/harvest.rs` | 共享水池扣减与按 `agent.id` 升序稳定结算 | ✅ 已改 |
| `crates/sim_core/src/spatial/ecology/tick.rs` | 共享水池统一自然再生与 POI 储量同步 | ✅ 已改 |
| `crates/sim_core/src/spatial/world_save.rs` | `SAVE_FORMAT_VERSION = 7`，`terrain_state` 与 `water_pools` 入档与门禁 | ✅ 已改 |
| `crates/sim_core/src/config.rs` | 增加 10 个 T2 参数（227→237） | ✅ 已改 |
| `frontend/js/config.js` | 增加 10 个 T2 参数，`terrainProfile` 默认为 `'random'` | ✅ 已改 |
| `crates/sim_core/src/spatial/snapshot_bin/dict.rs` | 特征枚举注册 River, RiverBank, ShallowFord, SpringValley | ✅ 已改 |
| `frontend/js/render_world.js` | 河道、岸线、浅滩和泉谷特征渲染 | ✅ 已改（`drawTerrainFeatures`） |
| `frontend/js/render_hud.js` | 水源储量按水池去重聚合显示 | ✅ 已改 |
| `tools/config-check.js` | 增加 10 个 T2 字段映射与 237 参数一致性校验 | ✅ 已改 |

## 12. 分阶段验收门禁

### 12.1 T0 门禁

- ✅ 同种子、同配置生成的地形网格、地表类别、查询结果和合法候选逐字节一致——v1.47.1 已由 `test-wasm.js` 与 `test-determinism.js` 6/6 覆盖。
- ✅ 房屋占地跨越水域、陡坡、边界或已有占用时均返回稳定失败码，不生成实体——房屋占地已接入；其中“跨越水域”在浅水时返回 `WaterCovered`，深水返回 `DeepWater`，`Occupied` 由 `houses_clear` 判定。
- ✅ 路线曲线任一段穿过禁行单元时创建失败；仅端点合法不能通过——`validate_curve` 与 `segment_valid` 严格检查整条贝塞尔曲线与走廊宽度覆盖。
- ⏳ 初始营地、关键资源和市场位于预期陆路连通分量，往返成本不超过生存诊断上限——未实施（`spawn.rs` 基础生成）。
- ⏳ 现有无新地貌基线在关闭地形 profile 后保持行为等价——暂无 `flat_baseline` profile 开关（`generate_natural_landscape` 保留为兼容壳，默认仍走 `mountain_pass_v1`）。

### 12.2 T1 门禁

- ✅ 固定山口种子：主脊可从远景辨认，陡坡会挡路，山口存在合法连续路线——连续起伏地貌与路网感知生成已打通（v1.47.7 起不再有台地/特征轮廓绘制）。
- ❌ 台地房屋候选与平顶压平——v1.47.7 已整体删除，T1 不再生成台地。
- ✅ 两端欧氏距离相近但越过主脊的路线成本高于经过山口的路线；A* 考虑地形成本。
- ⏳ 生成失败时在有界重试后使用通过校验的简化 profile，并记录失败原因——`terrainGenerationMaxRetries` 未消费。
- ✅ T1 FABS 二进制与 JSON 深比较通过，读档/重置/回溯无旧特征或字符串串味——`test-snapshot-bin.js` 通过。

### 12.3 T2 门禁

✅ 全部通过（v1.47.5）：

- ✅ 河道有明确走向与单调下凹河床；普通陆路不穿深水，人物只能经两处浅滩跨河（`validate_terrain_world` 创世校验全通）。
- ✅ 浅滩具有明确地表通行代价（`terrain_shallow_water_cost`），过水真实减速，严禁借道浅滩沿河纵向涉水。
- ✅ 两岸岸点引用同一 `WaterPool`；多人采水按 `agent.id` 升序稳定串行扣减，家户账本与水池守恒，存读档多检查点逐字节吻合。
- ✅ 河阶平缓且肥力丰富（0.95），可容纳真实房屋占地；浅水占地严格返回 `WaterCovered` 拒绝建房。
- ✅ 水面、岸线、浅滩、人物和道路投影一致；HUD 水源储量按水池去重聚合，无虚高。
- ✅ T1/T2 随机轮换：当 `terrainProfile: 'random'` 时，基于种子哈希以 ~50% 概率自然分配至 T1 或 T2，且保持 100% 确定性。

### 12.4 通用确定性与性能门禁

每个阶段至少覆盖：

```text
固定种子：山口聚落、两岸河谷、失败重试种子
多种子矩阵：不同 seed、不同 agentCount、不同 campCount
分批步进：1x 与批量 world_tick_steps
存读档：保存后继续推进与连续运行到同 tick 对比
回溯：回滚后重新推进，地形/路网/装饰无残留
换世界：RESET 后检查 FABS 字符串和特征缓存
```

实现门禁按改动类型执行：

- Rust/配置：`cargo test --lib`、WASM 编译、双副本同步、`node tools/test-wasm.js`、`node tools/config-check.js`——✅ v1.47.5 全部通过（双副本 `frontend/rust/sim_wasm.wasm` + `frontend/sim_wasm.wasm` 已同步）。
- 快照：`node tools/test-snapshot-bin.js`，并核对 `snapshot.rs`、`world_snapshot.rs`、`encode.rs`、`snapshot-bin.js`、`rustworld.js`——✅ v1.47.5 通过。
- 前端：`node tools/frontend-check.js`——✅ 语法与 DOM 引用校验通过。
- 确定性矩阵：`node tools/test-determinism.js`——✅ 6/6 套件全通。

## 13. 实施顺序与退出标准

建议按以下提交边界推进，每个边界都可独立回滚。✅ = 已落地，⏳ = 待实施：

1. ✅ **T0-A：数据模型和查询**。只增加 `GeoCell` 字段、查询服务和固定诊断，不改变默认地图外观——已落地（v1.47.1）。
2. ✅ **T0-B：生成校验和房屋接入**。完整占地、完整曲线、浅滩走廊校验通过——已落地（v1.47.1/v1.47.5）。
3. ✅ **T1-A：山口地貌**。固定 profile、山脊/山口连续起伏生成、路网成本和存档版本门禁——已落地（v1.47.1/v1.47.2）。
4. ✅ **T1-B：山地景观**。材质与地表渲染通过——已落地（v1.47.2）；v1.47.7 删除台地平顶压平与 Ridge/Saddle/Terrace 特征/绘制。
5. ✅ **T2-A：静态水系几何**。河道、河阶、岸带、浅滩和水系特征折线生成——已落地（v1.47.5）。
6. ✅ **T2-B：共享水池与两岸玩法**。采水稳定排序聚合、浅滩跨河走廊、地形成本折算、断流与 HUD 统计——已落地（v1.47.5）。
7. ✅ **T2-C：完整垂直切片**。两岸河谷的内核、WASM、存档（FORMAT 7）、前端、T1/T2 随机轮换和 6 套件确定性矩阵全部通过——已落地（v1.47.5）。

T1/T2 的退出标准：同版本同种子可复现；同一静态世界的地理、路网、资源、选址和画面事实一致；失败有界且可解释；旧 profile 不会被新生成器静默加载；普通观察能在短时间内辨认主要地貌、聚落、主路和水源区。T0、T1、T2 已全面达到退出标准。

## 14. 明确不做的事项

本方案不包含：

- 完整侵蚀、流体、地下水、洪水和枯丰水期模拟；
- 游泳、船舶、桥梁建造、动态路卡和运行中地形改造；
- 由山地自动产生防御、税收、矿产或行政优势；
- 由河滩/高肥力标签直接发放粮食；
- 前端自行生成碰撞、水体库存、资源产量或可通行路线；
- 在系统 tick 中扫描居民并强制改写决策状态；
- 为了画面效果提前添加尚未通过内核契约的横穿道路大河、深湖或悬崖；
- 以 GPU/3D 引擎升级替代 T0 的查询、存档、确定性和路网基础工作。

T0/T1/T2 落地后，已把已实现的机制同步到 `docs/current/` 现状文档（`01-spatial-network.md`、`08-config-system.md`、`15-save-load.md`、`07-frontend-ui.md`、`13-impact-matrix.md` 等）与 `docs/current/11-changelog.md` v1.47.5 条目。本文继续保留为跨阶段实施方案：T0/T1/T2 部分以落地状态标注为准，T3~T4 仍为规划契约，不把未实现内容写成当前行为。
