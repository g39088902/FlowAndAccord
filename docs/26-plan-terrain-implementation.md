# 新增地形实施技术方案

> **状态**：T0 主体与 T1 已落地（v1.47.1，commit `6751014`，文档同步 `a0bfcfc`）；T2 两岸河谷及后续 T3/T4 未实现、未排期。
> **整理日期**：2026-09-09。
> **适用范围**：T0 统一地表查询、T1 山口聚落、T2 两岸河谷；T3 湖泊/湿地/峡谷/瀑布仅定义扩展接口，不在本方案中一次性实现。
> **依据**：[25-plan-system-integration.md](./25-plan-system-integration.md)、[22-plan-terrain-features.md](./22-plan-terrain-features.md)、[21-plan-terrain-art.md](./21-plan-terrain-art.md)。
> **定位**：本文是跨阶段实施方案。T0/T1 部分已实现，现状以 `docs/current/01-spatial-network.md`、`08-config-system.md`、`15-save-load.md`、`07-frontend-ui.md` 与 `11-changelog.md` v1.47.1 条目为准；T2~T4 仍为规划契约，不代表当前代码已经具备这些行为。

## 1. 方案结论

采用“静态地貌生成 + 内核地表查询 + 合法走廊生成 + 共享水资源池 + FABS 增量快照”的路线，不引入完整侵蚀模拟、流体模拟、桥梁施工或 GPU 渲染器作为前置条件。

第一条可实施主线如下：

```text
T0 地表查询与完整曲线校验
  -> T1 丘陵/台地/山脊/山口
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

### 1.1 落地状态总览（v1.47.1）

| 阶段 | 状态 | 落地要点 | 剩余工作 |
| :--- | :--- | :--- | :--- |
| T0 地表查询与完整曲线校验 | ✅ 主体已落地 | `GeoCell` 扩展 `SurfaceKind`/肥力/水体关联/标志；`geo/query.rs` 提供 `sample_cell`/`validate_footprint`/稳定失败码；房屋实体化消费完整占地；`TerrainMap::validate_curve` 走廊校验原语 | 生态落位（`ecology/spawn.rs`）生存校验未接入；路网走廊生成器未接入（`graph.rs` 仍全图直线铺路）；`terrainMaxWalkSlope`/`terrainRoadCorridorWidth`/`terrainGenerationMaxRetries` 已声明未消费 |
| T1 丘陵/台地/山脊/山口 | ✅ 已落地 | `mountain_pass_v1` profile + 生成器版本 1；局部 `relief_rng` 派生主脊/山口/台地；`Ridge`/`Saddle`/`Terrace` 特征；存档版本门禁；前端特征绘制 | 地貌参数硬编码于 `terrain.rs`（未配置化）；山口/台地对路网成本与选址的完整联动待走廊接入后验证 |
| T2 静态主河/浅滩/河阶/泉谷 | ⏳ 未实施 | — | 全部待实施（见 §4.4/§6.3/§7/§11.3） |
| T3 湖泊/湿地/峡谷/瀑布 | ⏳ 未实施 | — | 扩展接口与逐项实现 |
| T4 动态水文、桥梁、土地演化 | ⏳ 未实施 | — | — |

实现偏差（方案设计 vs 实际落地）速查：存档格式版本未递增（§8.2）；配置仅落地 6/20 字段（§10）；`TerrainFailure` 实现 8/10 变体（§3.4）；`validate_curve` 落在 `terrain.rs` 而非 `query.rs`（§5.1）；房屋选址改造实际落在 `housing_system/settlement.rs`（§11.1）；前端地形缓存仍为单一 `_terrainCached`（§7.2）；FABS 仅新增 `TerrainFeatures=18` 一个 section（§7.2）。

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

- ✅ `GeoCell` 已扩展地表类别、肥力、水体关联与禁建/禁行标志（v1.47.1）；但 `ShallowWater`/`DeepWater`/`RiverBank`/`RiverTerrace` 枚举仅为 T2 预留，当前只生成干地/软地/裸岩面。
- ◐ `sample_cell`/`validate_footprint`/`validate_curve` 已提供，但 POI 落位和道路连接仍只检查端点；`graph.rs` 与 `ecology/spawn.rs` 尚未消费查询服务。
- ⏳ `connect_road_network` 仍在节点间创建直线车道，无法识别河流、陡壁和水域边界（待 T0 后续走廊生成器接入）。
- ⏳ A* 目前主要使用曲线长度、端点高差、道路磨损和道路偏好；没有基础地表通行成本，也没有硬禁行判定（`LaneEdge3D::terrain_profile` 未实现）。
- ⏳ 当前水源 POI 各自拥有库存，没有多个岸点引用同一水源池的概念（T2）。
- ◐ 快照已携带地表类别、肥力、特征折线、生成器版本与 profile；河湖折线、岸带、浅滩连接字段仍无（T2）。
- ◐ `render_world.js` 已绘制 `Ridge`/`Saddle`/`Terrace` 特征（`drawTerrainFeatures`）；水域、岸线、浅滩与地貌图层渲染仍无（T2）。

T0 必须先修复这些契约缺口；T1/T2 不应绕过 T0 直接添加视觉河流或山体装饰。目前 T0 的查询契约与房屋接入已完成，剩余缺口集中在生态落位与路网走廊接入。

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
- `water_body_id` 只表示几何归属；可采水资源通过独立的 `WaterPool` 关联，不能把每个单元当成一份库存。v1.47.1 中该字段恒为 `None`（T1 未生成水体）。
- `feature_flags` 只放稳定、可组合的查询事实。v1.47.1 已定义 `NO_BUILD`/`NO_WALK`/`SHORE_ACCESS`/`CROSSING_CANDIDATE` 四个标志，T1 生成只写入前两者；不要用位标记替代需要数值的坡度、宽度和成本。
- T1 已按“先用 `surface_kind` 和 `feature_flags`，T2 再启用水体关联”实施；不能为了渲染增加会改变模拟的字段。

### 3.2 地貌特征

✅ T1 子集已落地（v1.47.1），定义于 `geo/terrain.rs`；`TerrainFeatureKind` 当前只含 `Ridge`/`Saddle`/`Terrace`，河流/浅滩/水体等变体待 T2/T3。特征使用按 ID 排序的 `Vec`，避免 HashMap 迭代顺序进入确定性路径：

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

`TerrainFeatureKind` 规划至少包含：

```text
Ridge          山脊中心线或边界      ✅ v1.47.1
Saddle         山口鞍部              ✅ v1.47.1
Terrace        台地/河阶轮廓         ✅ v1.47.1
River          河道中心线和水面边界  ⏳ T2
RiverBank      岸带轮廓              ⏳ T2
ShallowFord    静态浅滩连接          ⏳ T2
WaterBody      湖泊水面（T3）        ⏳ T3
Wetland        湿地斑块（T3）        ⏳ T3
Cliff          峡谷壁/断崖（T3）     ⏳ T3
SpringValley   泉谷（T2）            ⏳ T2
Waterfall      瀑布（T3）            ⏳ T3
```

特征的职责是表达几何和查询来源，不承担库存、税收、生产或 Agent 行为。`vertices` 采用世界坐标，前端按投影绘制；需要沿路通行的对象另由 `TerrainConnection` 表达，避免把折线视觉对象误当作路网边。

### 3.3 水体与共享资源池

⏳ T2 规划，未实施。方案如下：

```rust
pub struct WaterBody {
    pub id: u32,
    pub level: f32,
    pub flow_direction: Vec3,
    pub outlet_feature_id: Option<u32>,
    pub resource_pool_id: Option<u32>,
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

实施建议：

- T2 可以保留现有 `PoiType::WaterSource`，但把多个岸点的储量读取和扣减委托给同一个 `WaterPool`。
- 既有 Agent 装载、回家卸货、家户账本和施密特触发器不改语义；只把“选择哪个水源点”替换为“选择哪个合法岸点及其共享池”。
- 同一水体可以有多个 `WaterAccessPoint`，但 `source_poi_ids` 和 `resource_pool_id` 只登记一次；同 tick 多人采水按稳定 AgentId 顺序串行扣减。
- 水面存在但 `current_stock == 0` 时，前端仍绘制水面，资源面板显示断流/不可采，不删除水面或生成另一份库存。
- T2 不做水位动态变化。`level` 是静态几何事实；枯水、洪水和水面动画属于 T4。

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
- ✅ `validate_footprint(query, max_slope_deg)`：对完整占地覆盖的栅格单元求高差、最大坡度、水域覆盖、禁建标记和地表成本。
- ✅ `surface_walk_cost(kind)` 与 `explain_failure(failure)`：稳定步行成本与诊断文案。
- ✅ `TerrainMap::validate_curve(curve, corridor_width, max_walk_slope)`：曲线自适应分段并栅格化覆盖走廊（含两侧），返回整条路径是否禁行/超坡（见 §5.1；注意实现落在 `terrain.rs` 而非 `query.rs`，且当前尚无调用点）。

未提供（后续补充）：

- ⏳ `nearest_valid_node(pos, use_kind)`：只返回在合法地表上的路网节点（待路网接入时实现）。
- ⏳ `water_access_points(water_body_id)`：T2 水系落地后实现。

`TerrainFailure` 使用闭集错误码。v1.47.1 实现了 8 个变体（方案 10 个中缺 `Occupied` 与 `NoValidCrossing`；`WaterCovered`/`NoRoadAccess` 已定义但当前校验不产生——前者留待 T2 浅水覆盖，后者待接路接入）：

```text
OutOfBounds          ✅ 产生
WaterCovered         ◐ 已定义，暂不产生（T2）
DeepWater            ✅ 产生
CliffTooSteep        ✅ 产生
SurfaceForbidden     ✅ 产生
FootprintTooUneven   ✅ 产生
NoRoadAccess         ◐ 已定义，暂不产生（房屋占用另由 settlement 检查，未并入）
Occupied             ⏳ 未实现
NoValidCrossing      ⏳ 未实现（T2）
```

房屋、农田、哨塔和路卡只向查询服务传入各自 `LandUseKind`，不复制判定代码。查询只读，不修改 Agent、账本、路网或 RNG。当前仅房屋消费 `LandUseKind::House`；`Farm`/`Defense` 待农业与防务接入。

## 4. 确定性地貌生成

### 4.1 RNG 分域

◐ 已落地 `relief_rng`（v1.47.1），`hydro_rng`/`feature_rng` 待 T2。实际实现：

```text
terrain_seed = seed
relief_rng   = WorldRng::new(seed ^ 0x5245_4C49_4546_5431)   // "RELIEFT1" 盐值，已固定
hydro_rng    = WorldRng::new(seed xor HYDRO_SALT)            // ⏳ T2
feature_rng  = WorldRng::new(seed xor FEATURE_SALT)          // ⏳ T2
```

要求：

- 盐值在代码中固定并写入生成器版本说明；不使用系统时间、浮点 Hash 或 HashMap 遍历作为随机输入。✅ 已固定并随 `TERRAIN_GENERATOR_VERSION = 1` 演进。
- T1 不创建 `hydro_rng` 的消费；T2 启用后只消费自己的子流，不改变 Agent、POI 和出生的全局 RNG 序列。✅ 当前实现未触碰主 `WorldRng` 消费顺序。
- 每个子流的调用顺序固定，候选点按 `(feature_kind, ordinal)` 顺序尝试。
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

✅ 已落地（v1.47.1），使用可配置的定向地貌骨架（`profile = "mountain_pass_v1"`），不做无限随机重抽：

```text
主脊：一条沿方向 theta 的长条高程增量
支脊：最多两条低幅度分支            ⏳ 当前版本未实现支脊
山口：主脊上的一个低鞍部窗口
台地：山脚或侧翼的一到两块平缓平台   ✅ 一块
```

实现步骤（落地情况）：

1. ✅ 从 `relief_rng` 固定生成 `theta`（±0.18 rad）、主脊偏移（±0.08×world_size）、宽度（0.16~0.23×world_size）、幅度（24~34m）、山口位置（±0.12×world_size）与宽度（0.10~0.15×world_size）、台地位置（沿脊 -0.30~0.05、垂直 0.20~0.32×world_size）。
2. ✅ 用到主脊中心线的有符号距离生成高斯型高程增量；主脊两侧平滑过渡，禁止在格点边界产生尖峰。
3. ✅ 在山口窗口压低主脊（`elev += ridge - ridge * 0.90 * saddle`），生成连续的低坡通道；山口是普通地表走廊，不新增传送节点。
4. ✅ 台地通过有限范围 `smooth_box` 高度平台函数（+8m）生成，边缘平滑过渡，不做垂直台阶。
5. ✅ 重新计算坡度、地表类别和可建掩码。
6. ✅ 为主脊（9 点折线）、山口（单点）、台地（4 点矩形）生成特征折线，供前端表现和诊断定位。
7. ⏳ 先生成/筛选合法 POI 与营地候选，再通过 T0 路网走廊生成器接入节点——未实施（待 `spawn.rs`/走廊生成器接入）。

T1 的首轮验收只要求“路线会绕山、山口可通过、台地可建”，不增加高地防御、资源加成或行政税收。注意：当前地貌参数硬编码于 `terrain.rs` 内部（由 `relief_rng` 派生），未落入 `SimConfig`；如需调参需先配置化。

### 4.4 T2 主河与浅滩模板

⏳ 未实施。方案如下：

T2 首张有水地图固定为“一条主河 + 两处静态浅滩 + 两岸河阶 + 少量丘陵/泉谷”。

河流生成必须在高程骨架之后：

1. 从地图边缘或高地出口确定上游点和下游出口点，使用固定控制点生成单调下游中心线。
2. 对中心线按世界坐标采样并投影到网格，得到河道带；河道带宽度按配置平滑变化，不在格点上生成断裂蓝点。
3. 对每个河道单元设置统一 `water_level`，使河床高程低于水位且沿下游不逆流。
4. 河流必须连接地图出口或湖泊预留出口；若存在局部高程逆流，优先统一修改水系覆盖范围和河床高度，不在前端修图。
5. 河道两侧生成 `RiverBank`，再向外生成低滩和河阶。低滩首期设置 `NO_BUILD`，河阶按完整占地验证后可建。
6. 在两处候选位置寻找两岸宽度、坡度和岸点均合法的 `ShallowFord`；每处浅滩生成独立连接对象和两端接入节点。
7. 生成水体、岸带、河阶、浅滩及泉谷特征，并绑定共享 `WaterPool`。
8. 运行完整世界校验：所有普通路段不穿水、两处浅滩可达、关闭任一浅滩后仍存在合法陆路连通或明确不可达结果。

浅滩不是河上的绘制纹理，也不是传送节点。它必须有：

```text
crossing_id
两岸端点/接入节点
实际曲线几何
通道宽度
浅滩地表成本
允许的 LandUseKind
```

T2 不实现桥梁、游泳、船舶、水位涨落和洪水事件。

## 5. 路网与运动实现

### 5.1 合法走廊生成

◐ 校验原语已提供，走廊生成器未实施。`geo/corridor.rs` 尚未创建；v1.47.1 先在 `TerrainMap::validate_curve` 上落地了完整曲线走廊校验（自适应采样、中心线 + 走廊两侧检查硬禁行/禁行标志/坡度），但**当前没有任何调用点**——`graph.rs` 仍直接直线铺路，待路网生成器接入后再替换：

```text
节点候选
  -> 网格 A* / 走廊搜索          ⏳ 未实施
  -> 记录地表成本、最大坡度、是否跨浅滩   ⏳
  -> 使用固定控制点拟合 Curve3D  ⏳
  -> 对完整曲线按走廊宽度栅格化  ✅ 原语已具备（validate_curve）
  -> 重新检查每个采样段和覆盖单元 ✅ 原语已具备
  -> 通过后写入 LaneEdge3D       ⏳
```

走廊搜索的硬规则：

- `DeepWater`、`RockFace` 超过通行坡度、越界和未授权水域不得进入开放集。
- `SoftGround`、`ShallowWater` 只增加成本；道路等级加速不能抵消硬禁行。
- 浅滩只允许沿 `TerrainConnection` 授权的跨水方向通过；普通道路不能从河床中抄近路。
- 走廊覆盖使用完整栅格穿越或保守的线段-单元相交测试，不能只按固定稀疏步长采样。
- 候选相同成本时按 `(cost, max_slope, node_id sequence)` 稳定排序。

### 5.2 LaneEdge3D 扩展

⏳ 未实施。建议给 `LaneEdge3D` 增加静态通行摘要，而不是每次 Agent 移动时重新扫描整个地形：

```rust
pub struct LaneTerrainProfile {
    pub max_slope_deg: f32,
    pub terrain_time_cost: f32,
    pub surface_mask: u16,
    pub crossing_id: Option<u32>,
}
```

`LaneEdge3D` 增加 `terrain_profile` 后：

- A* 边权使用现有道路速度、磨损量、隐秘偏好，再加 `terrain_time_cost`；坡度成本仍保留，但不能和同一坡度重复计费。
- 启发式下界改为“直线距离 / 最大合法速度”的保守下界，不能把新增地形成本直接塞进一个可能高估的启发式，避免 A* 失去正确性。
- T1/T2 地形静态，`path_cache` 和 APSP 在创世完成后建立；配置热注入若改变道路或地形成本，必须清空缓存并重建 APSP。
- 新增 `terrain_profile` 会改变路网存档和 FABS 车道几何编码，实施时同步增加存档格式版本和 FABS 格式版本。
- 动态路卡、桥梁、洪水不复用本字段解决；未来需要独立通行版本和任务恢复契约。

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

- `is_house_site_valid` 先执行 `validate_footprint`（`terrain_footprint_half_extent` = 7.0m、`terrain_max_build_slope` = 16°、`LandUseKind::House`），失败直接判非法。
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

⏳ 未实施（T2）。方案：

首期推荐保留 `PrimitivePoi` 的水源交互接口，新增池引用：

```rust
pub struct PrimitivePoi {
    // 既有字段
    pub water_pool_id: Option<u32>,
    pub access_point_id: Option<u32>,
}
```

采收流程保持：

```text
Agent 到达合法岸点
  -> 检查共享 WaterPool 当前库存
  -> 按稳定顺序扣减共享池
  -> 装入 Agent 行囊
  -> 返回并卸入家户账本
```

切换岸点不能绕过 `decision_poi_seek_min_stock_ratio`、`decision_poi_abandon_stock_ratio` 和断流后的市场兜底。水体几何不进入 POI 库存字段，不复制储量。

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
- 所有 `Vec` 按稳定 ID、固定种类顺序输出；不能依赖 HashMap 顺序。✅ 特征按固定 ID 顺序（Ridge=1/Saddle=2/Terrace=3）输出。

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

✅ 已落地（v1.47.1）。`WorldSave` 已增加：

```rust
pub terrain_generator_version: u32,     // 当前为 1
pub terrain_profile: String,            // 当前为 "mountain_pass_v1"
```

`terrain_profile` 用于区分 `flat_baseline`、`mountain_pass_v1`、`river_valley_v1` 等地图模板。若未来生成器还依赖非配置的布局数据，可再保存经过校验的 `terrain_content_version` 或完整静态地形；不允许只保存一个无法解释的版本字符串。当前仅有 `mountain_pass_v1`（`TERRAIN_PROFILE_MOUNTAIN_PASS`）被接受。

### 8.2 读档规则

✅ 已落地（v1.47.1），含一处与方案原预期的偏差：

- ✅ `deserialize_save()` 在既有校验（格式版本、grid_res、world_size、agent id 唯一）之后，新增 `terrain_generator_version` 与 `terrain_profile` 校验，不匹配直接返回明确错误；不得用新生成的地形加载旧路网和旧房屋。
- ✅ 地形重建改用 `TerrainMap::generate_with_profile(seed, terrain_profile)`。
- ◐ **偏差**：`SAVE_FORMAT_VERSION` 保持 6 未递增（方案原拟“新增字段时手工递增”）。实现改为给新字段加 `#[serde(default = ...)]` 向后兼容：旧档以 `generator_version = 1`、`profile = mountain_pass_v1` 默认值加载，恰好等于当前内核生成器；只有未来生成器版本推进后才需要真正拒绝旧档。若后续新增不可默认化的结构字段，仍须递增格式版本。
- ⏳ 如果后续允许洪水、桥梁或地貌变化，变化后的事实必须进入存档或确定性事件日志；仅保存初始 seed 不再足够。
- ⏳ 读档后重建地形、验证已存实体位置和车道曲线；发现旧状态落在禁水/禁建区域时拒绝加载，而不是自动瞬移修复——当前靠生成器版本门禁在入口拦截，实体级逐项校验未实施。

## 9. 前端景观实现

### 9.1 渲染职责拆分

◐ 已按兜底方案落地（v1.47.1）：未拆 `render_features.js`，但在 `render_world.js` 内新增独立函数 `drawTerrainFeatures()`；后续 T2 水系/岸线量大时可再拆文件：

```text
render_terrain.js       网格、坡面材质、边界和地表类别     ⏳ 未拆
render_features.js      山脊、台地、河流、岸线、浅滩、湿地  ◐ 未拆，已提供 drawTerrainFeatures 独立函数
render_world.js         POI、房屋、道路调度及层级排序      ✅
```

### 9.2 绘制顺序

◐ 已落地 T1 特征部分（v1.47.1）。当前实际顺序：背景底色 → 地形网格四边形 → **地形特征**（`drawTerrainFeatures`：Ridge 棕色虚线折线、Saddle 圆、Terrace 闭合描边）→ 网格线 → 道路/POI/房屋/Agent 等，与下列推荐顺序一致：

```text
背景底色
  -> 地形网格与坡面光照
  -> 河床/湿地底色                     ⏳ T2
  -> 水面与岸线                       ⏳ T2
  -> 贴地道路和道路阴影
  -> 浅滩几何（不是桥梁）              ⏳ T2
  -> POI 景观群
  -> 房屋和接地阴影
  -> Agent
  -> 选择框、标签和调试层
```

规则：

- 普通视图隐藏网格线；道路等级颜色只在分析视图展示。
- 水面颜色、岸石和芦草都是静态视觉派生，不改变通行或库存。
- 浅滩人物脚部可做局部遮挡，但 Agent 的物理 `z` 和路线几何来自内核。
- 地形材质按 `surface_kind`、坡度、坡向和季节混合；不把视觉纹理解释为新湿度或土壤模拟。
- 装饰对象使用稳定 `(feature_id, local_index, material_version, season)` 哈希，换世界、读档、回溯后可重建且不漂移。
- 缩放分级时远景保留山口、主河、聚落和主路轮廓；近景再增加岸石、草斑和树群。

### 9.3 命中与标注

⏳ 未实施。方案：

- 地形特征命中检测使用与绘制一致的世界坐标折线和宽度，不用只检测装饰精灵。
- 普通水面不可点击为可采点；只有 `WaterAccessPoint` 的有效岸边区域可进入 POI Inspector。
- 标签层沿用现有选中、悬浮、异常、普通四级优先级；河流名称、浅滩状态和断流状态不能遮住当前 Agent/房屋。
- 地形特征不新增高频全量 DOM 容器；若增加 Inspector 列表，必须使用内容快照缓存。

## 10. 配置设计

◐ 已落地 6 个仿真字段（v1.47.1，分区 7「地形生成、地表查询与山口 profile」，字段数 221→227）；方案原拟 20 字段中其余（山脊/山口/河流参数等）未加入——T1 地貌参数硬编码于 `terrain.rs`，T2 水系字段待实现时补充：

```text
✅ terrainProfile             "mountain_pass_v1"  影响地形重建与存档门禁
✅ terrainMaxWalkSlope        30.0                道路/走廊最大坡度（已声明，暂未消费）
✅ terrainMaxBuildSlope       16.0                房屋完整占地最大坡度（已消费）
✅ terrainFootprintHalfExtent 7.0                 房屋基础占地半尺寸（已消费）
✅ terrainRoadCorridorWidth   5.0                 T0 曲线走廊校验宽度（已声明，暂未消费）
✅ terrainGenerationMaxRetries 8                  地形布局有界重试上限（已声明，暂未消费）
```

未落地的规划字段（按阶段补充）：

```text
⏳ T1（如需调参再配置化）：terrainRidgeAmplitude / terrainRidgeWidth / terrainSaddleDepth / terrainTerraceCount / terrainMaxWalkSlope 消费
⏳ T2：terrainSoftGroundCost / terrainShallowWaterCost / terrainRiverWidthMin / terrainRiverWidthMax / terrainRiverWaterLevel / terrainRiverBankWidth / terrainRiverTerraceWidth / terrainCrossingCount / terrainCrossingWidth / terrainCrossingMaxCost / terrainRequiredBuildArea / terrainRequiredResourcePathCost
```

实现约束：

- ✅ 每个字段同时出现在 Rust `SimConfig`、默认映射、前端 `config.js`，并由 `config-check.js` 校验（已加入 6 行 `IMPACT_OVERRIDES` 映射）。
- ✅ `terrainProfile` 影响存档重建，已进入存档并被应用版本/生成器版本门禁覆盖；不能仅作为前端配置热注入。
- ⏳ `terrainGenerationMaxRetries` 必须有上限；失败按固定顺序调整候选浅滩、缓坡和 POI，而不是无限重抽种子——字段已声明，消费逻辑待生态落位接入。
- 水面颜色、岸石密度、树群数量、标签阈值和缓存上限放入前端渲染配置，不进入 Rust RNG 或 FABS 模拟字段。
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
| `crates/sim_core/src/geo/terrain.rs` 或新 `relief.rs` | 丘陵、台地、主脊、支脊、山口模板 | ✅ 实现在 `terrain.rs`（`relief_rng` + `smooth_box`，未建 `relief.rs`；支脊未实现） |
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
| `frontend/js/render_world.js` | 山脊、台地、材质和遮挡绘制 | ✅ 已改（`drawTerrainFeatures`：Ridge/Saddle/Terrace） |
| `frontend/js/render_canvas.js` | 保持调度并增加必要缓存失效调用 | ⏳ 未改 |

### 11.3 T2

| 文件 | 修改内容 | 落地 |
|---|---|---|
| `crates/sim_core/src/geo/hydrology.rs` | 河道、水体、河阶、岸带、浅滩和水池生成 | ⏳ 未建 |
| `crates/sim_core/src/spatial/poi.rs` | 水源 POI 关联 `WaterPool`/岸点，保持既有采收 API | ⏳ 未改 |
| `crates/sim_core/src/spatial/ecology/harvest.rs` | 共享水池扣减与稳定顺序结算 | ⏳ 未改 |
| `crates/sim_core/src/spatial/ecology/spawn.rs` | 水源、岸点和浅滩节点落位 | ⏳ 未改 |
| `crates/sim_core/src/spatial/graph.rs` | 浅滩连接对象和授权跨水路线 | ⏳ 未改 |
| `crates/sim_core/src/spatial/snapshot.rs` | 水体、岸点、浅滩快照 | ⏳ 未加（`water_bodies`/`water_access_points` 字段未入快照） |
| `crates/sim_core/src/spatial/snapshot_bin/encode.rs` | `TerrainFeatures`/水体 section 编码 | ⏳ 未做（`WaterBodies=19`/`WaterAccessPoints=20` 未建） |
| `frontend/js/snapshot-bin.js` | 变长特征 section 解码 | ⏳ 未做 |
| `frontend/js/rustworld.js` | 河流/岸点/水体缓存和断流状态映射 | ⏳ 未做 |
| `frontend/js/render_world.js` 或 `render_features.js` | 河床、水面、岸线、浅滩和河阶绘制 | ⏳ 未做 |
| `tools/diagnose.js` | 过水、断流、浅滩关闭和完整曲线规则 | ⏳ 未加 |

## 12. 分阶段验收门禁

### 12.1 T0 门禁

- ✅ 同种子、同配置生成的地形网格、地表类别、查询结果和合法候选逐字节一致——v1.47.1 已由 `test-wasm.js` 与 `test-determinism.js` 6/6 覆盖。
- ✅ 房屋占地跨越水域、陡坡、边界或已有占用时均返回稳定失败码，不生成实体——房屋占地已接入；其中“跨越水域”在 T1 无水体生成前由深水检查兜底，`Occupied` 由 `houses_clear` 判定（未并入 `TerrainFailure`）。
- ◐ 路线曲线任一段穿过禁行单元时创建失败；仅端点合法不能通过——`validate_curve` 已实现该语义，但路网生成器尚未调用，端到端门禁待走廊接入后补。
- ⏳ 初始营地、关键资源和市场位于预期陆路连通分量，往返成本不超过生存诊断上限——未实施（`spawn.rs` 未接入）。
- ⏳ 现有无新地貌基线在关闭地形 profile 后保持行为等价——暂无 `flat_baseline` profile 开关（`generate_natural_landscape` 保留为兼容壳，默认仍走 `mountain_pass_v1`）。

### 12.2 T1 门禁

- ◐ 固定山口种子：主脊可从远景辨认，陡坡会挡路，山口存在合法连续路线——地貌特征与前端绘制已落地；山口/主脊对路网成本的约束待走廊接入后验证。
- ◐ 台地至少产生多个合格房屋候选，房屋底面不悬空；没有系统强制居民入住指定台地——房屋占地校验已接入，但“多个合格候选/台地可建”未做专项验证。
- ⏳ 两端欧氏距离相近但越过主脊的路线成本高于经过山口的路线；A* 不把高差端点简化成平路——待路网地形成本接入。
- ⏳ 生成失败时在有界重试后使用通过校验的简化 profile，并记录失败原因——`terrainGenerationMaxRetries` 未消费。
- ✅ T1 FABS 二进制与 JSON 深比较通过，读档/重置/回溯无旧特征或字符串串味——`test-snapshot-bin.js` 通过。

### 12.3 T2 门禁

⏳ 全部待实施：

- 河道有明确上游/下游和出口；普通陆路不穿深水，人物只能经两处浅滩跨河。
- 关闭任一浅滩后，可达性和路径成本发生预期变化；不允许从河中抄近路或瞬移到对岸。
- 两岸岸点可以引用同一 `WaterPool`；多人采水、断流、装载、回家卸货和家户账本守恒。
- 河阶可容纳真实房屋占地，低滩返回 `NO_BUILD`；河水几何仍存在但资源池耗尽时显示断流事实。
- 水面、岸线、浅滩、人物和道路投影一致；近景不出现人物穿山、穿水或悬空。

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

- Rust/配置：`cargo test --lib`、WASM 编译、双副本同步、`node tools/test-wasm.js`、`node tools/config-check.js`——✅ v1.47.1 全部通过（双副本 `frontend/rust/sim_wasm.wasm` + `frontend/sim_wasm.wasm` 已同步）。
- 快照：`node tools/test-snapshot-bin.js`，并核对 `snapshot.rs`、`world_snapshot.rs`、`encode.rs`、`snapshot-bin.js`、`rustworld.js`——✅ v1.47.1 通过。
- 前端：`node tools/frontend-check.js`，再按浏览器指南进行固定镜头、缩放、旋转、命中和读档验收——✅ 语法/DOM 校验通过；浏览器专项验收（固定镜头/特征命中）未记录，待 T1-B 补充。
- 诊断：补充完整曲线穿水/穿壁、浅滩关闭、共享水池、建房跨河和缓存换世界规则——⏳ 未加（`diagnose.js` 未改）。
- 性能：按景观计划目标记录主线程 p95、新增地形/特征绘制增量、快照解码耗时和缓存内存；曲线校验只在创世、选址或拓扑变化时执行，不放入每帧——⏳ 未建立基准。

## 13. 实施顺序与退出标准

建议按以下提交边界推进，每个边界都可独立回滚。✅ = 已随 v1.47.1 落地，⏳ = 待实施：

1. ✅ **T0-A：数据模型和查询**。只增加 `GeoCell` 字段、查询服务和固定诊断，不改变默认地图外观——已落地；`geo/query.rs`、`biome.rs` 扩展、FABS 地表字段均随 v1.47.1 提交。
2. ◐ **T0-B：生成校验和房屋接入**。完整占地、完整曲线、合法节点和生存校验通过——房屋完整占地 ✅ 已接入；完整曲线仅提供 `validate_curve` 原语（路网生成器未接入）、合法节点与生态生存校验 ⏳ 未含。
3. ✅ **T1-A：山口地貌**。固定 profile、山脊/台地/山口生成、路网成本和存档版本门禁——profile/地貌/存档门禁 ✅ 已落地；路网成本接入 ⏳ 未含（留给 T0 走廊接入后联动验证）。
4. ◐ **T1-B：山地景观**。材质、特征、标签、遮挡和固定镜头验收通过——特征绘制 ✅ 已落地（`drawTerrainFeatures`）；标签、命中检测、遮挡细化与固定镜头验收 ⏳ 未含。
5. ⏳ **T2-A：静态水系几何**。河道、河阶、岸带、浅滩和水系快照，不先接动态水量。
6. ⏳ **T2-B：共享水池与两岸玩法**。采水、断流、跨河、建房和生存诊断通过。
7. ⏳ **T2-C：完整垂直切片**。两岸河谷的内核、WASM、存档、前端、性能和多种子门禁全部通过。

T1/T2 的退出标准：同版本同种子可复现；同一静态世界的地理、路网、资源、选址和画面事实一致；失败有界且可解释；旧 profile 不会被新生成器静默加载；普通观察能在短时间内辨认主要地貌、聚落、主路和水源区。T1 已满足其中确定性、存档门禁与地貌可辨认部分；路网/资源/选址的事实一致性待 T0 走廊接入后整体验收。

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

T0/T1 落地后，已把已实现的机制同步到 `docs/current/` 现状文档（`01-spatial-network.md`、`08-config-system.md`、`15-save-load.md`、`07-frontend-ui.md`、`13-impact-matrix.md` 等）与 `docs/current/11-changelog.md` v1.47.1 条目（commit `a0bfcfc`）。本文继续保留为跨阶段实施方案：T0/T1 部分以落地状态标注为准，T2~T4 仍为规划契约，不把未实现内容写成当前行为。
