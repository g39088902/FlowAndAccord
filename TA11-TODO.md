# TA-11 TODO · RockCluster / GrassTuft 全链路地表装饰

> **任务定义**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §1.2 任务表 TA-11（原代号 D-A 余项、P2，详见 §6.6）——**RockCluster / GrassTuft 全链路：生成器调用、枚举字典、FABS 快照、前端绘制入口；走独立盐值通道，不扰动既有抽样序列**。本文件将该任务拆解为标准可执行任务序列（TA-11-1 ～ TA-11-8），编号即建议实施顺序；每项标注出处章节、现状核对与验收方式。
> **状态**：基础生成与绘制骨架已在 D-B1-5（内核生成）与 D-B1-6（前端基础绘制）就绪；当前 TA-11 作为环境补全专项，重点补齐**水岸芦草变体**（§6.6 规定）、**视觉参数集中化**（`config.render.js`）、**碎石群微接触投影与岩面分层**、**渲染热路径零 GC 改造**以及**Chrome 端到端视觉与性能验收收口**。
> **难度**：中（涉及内核 RNG 隔离审计、快照与字典一致性核对、前端模型/绘制层扩展、视口剔除与缓存生命周期）。
> **依赖**：TA-01 ✅（装饰三件套模块拆分已于 v1.50.23 落地）；与 TA-04（世界光向动态受光）保持正交解耦（TA-04-5 负责岩面法线受光，本任务负责基础多边形分面、接触阴影与生态外观派生）；与 TA-14（最终几何遮罩）保持分工。
> **范围纪律**：纯表现层与视觉装饰，**严禁参与通行、资源、碰撞与建造判定**；草丛与碎石不得被当作湿地、水源、阻挡物或可采矿藏；不消费共享模拟 `WorldRng`（严格隔离在独立 `accent_rng`）；新增表现层配置集中于 `frontend/js/config.render.js`，**严禁**散落进 `SimConfig` 或 `config.js`；遵循单文件 800 行上限与无持久化单元测试禁令。
> **验收总入口**：07 号 §11.4「四季与边界 / 受光 / 旋转与遮挡 / 生命周期 / 性能」行；06 号 §5.5「D-B1 纯视觉子特征与装饰扩展」；浏览器验收必须使用 Chrome（本地存档依赖 File System Access API，07 号 §11.5）。

---

## 任务序列总览

| 编号 | 任务 | 涉及文件 | 难度 | 依赖 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TA-11-1** | 内核生成规则与独立加盐 RNG 审计 | `crates/sim_core/src/geo/accents.rs` | 低 | — | ✅ 已建基线 |
| **TA-11-2** | FABS 二进制快照与枚举字典全链路闭环核对 | `dict.rs` / `snapshot.rs` / `encode.rs` / `snapshot-bin.js` | 低 | TA-11-1 | ✅ 已建基线 |
| **TA-11-3** | 渲染表现层配置集中化与魔数解耦 | `config.render.js` / `accent-model.js` / `render_accents.js` | 低 | TA-11-2 | ✅ 已落地（v1.50.34） |
| **TA-11-4** | 草丛生态形态扩展：水岸芦草变体与季相微调 | `accent-model.js` / `render_accents.js` / `config.render.js` | 中 | TA-11-3 | ✅ 已落地 |
| **TA-11-5** | 碎石群地貌表现升级：微接触阴影与岩面分层 | `render_accents.js` / `config.render.js` | 低 | TA-11-3 | ✅ 已落地 |
| **TA-11-6** | 渲染热路径零 GC 改造与缓存生命周期审计 | `render_accents.js` / `accent-model.js` / `rustworld.js` | 中 | TA-11-4、TA-11-5 | ⏳ 待实施 |
| **TA-11-7** | Chrome 端到端四季视觉与动态操作验收 | 前端视口 / 浏览器交互环境 | 中 | TA-11-6 | ⏳ 待实施 |
| **TA-11-8** | 门禁全绿、版本规范自增与规划文档状态同步 | 全链路门禁 / `07-terrain-art.md` / `01-changelog.md` | 低 | TA-11-7 | ⏳ 待实施 |

---

## 任务明细

### TA-11-1 · 内核生成规则与独立加盐 RNG 审计

- **目标**：审计并锁定 `crates/sim_core/src/geo/accents.rs` 中 `RockCluster` 与 `GrassTuft` 的生成器实现，确保生成顺序固定、候选地表契约准确、随机数消费严格隔离。
- **内容**：
  1. **固定生成序列**：严格遵循 `Tree → Boulder → Bush → RockCluster → GrassTuft` 的生成顺序（06 号文 §5.5），尾部追加新种类，禁止在既有段之间插入扰动随机数流。
  2. **生成基数与密度缩放**：确认基准常量 `BASE_ROCK_CLUSTER_COUNT = 12`（子石由前端派生，内核仅下发 anchor，数量少于巨石）、`BASE_GRASS_TUFT_COUNT = 60`（草甸辨识度主力），实际数量由 `terrainAccentDensity` 线性缩放并受 `MAX_RETRY_FACTOR = 3` 有界重试保护。
  3. **候选地表规则校验**：
     - `RockCluster`：仅允许落位在 `RiverBank`（接受率 40%）、`RiverTerrace`（接受率 25%）或坡度 $\ge 8^\circ$ 的 `DryGround` 裸岩坡脚；
     - `GrassTuft`：仅允许落位在 `DryGround`（80%）、`SoftGround`（90%）、`RiverTerrace`（70%）且坡度 $< 24^\circ$ 的平缓草甸地带；
     - 共同禁区：严格排除 `DeepWater`、`ShallowWater` 与 `TERRAIN_FLAG_NO_WALK`（水体与不可通行硬障碍严禁有草石生成）。
  4. **RNG 隔离与确定性保障**：只消费基于独立盐值 `seed ^ ACCENT_RNG_SALT`（`0x4143_4345_4E54_3031`）初始化的 `accent_rng`，严禁消费共享模拟 RNG；最终输出数组强制执行 `accents.sort_by_key(|a| a.id)`，确保跨平台生成结果逐字节一致。
- **现状核对**：内核生成已于 D-B1-5（`crates/sim_core/src/geo/accents.rs`）落地，经多种子回归无漂移。
- **出处**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §6.6、[06-terrain-templates.md](docs/plan/tech/06-terrain-templates.md) §5.5、根 AGENTS.md §4.3。
- **验收**：
  - 运行 `cargo test --lib` 编译通过；
  - 临时断言验证：同种子同配置下生成 `TerrainAccent` 列表的长度、ID、坐标、类型 100% 逐字节确定；
  - 全图无任何 `RockCluster`/`GrassTuft` 生成于水体内部或 `NO_WALK` 格子上。
- **依赖**：无（基线任务）。
- **落地记录**：已随 D-B1-5 在 `accents.rs` 落地；TA-11 执行时需复核其不变量。

---

### TA-11-2 · FABS 二进制快照与枚举字典全链路闭环核对

- **目标**：验证 `AccentKind`（含 RockCluster / GrassTuft）在快照四处同步与 FABS 二进制编解码链路中的完整性与防漂移保障。
- **内容**：
  1. **枚举定义与字典映射**：
     - `crates/sim_core/src/geo/accents.rs`：`AccentKind` 枚举变体固定 `RockCluster = 3`，`GrassTuft = 4`；
     - `crates/sim_core/src/spatial/snapshot_bin/dict.rs`：`accent_kind_code()` 与 `accent_kind_table()` 包含 5 项 `[Tree, Bush, Boulder, RockCluster, GrassTuft]`，通过 `enum_table_json()` 下发。
  2. **快照四处同步核对**（根 AGENTS.md §4.5）：
     - ① `crates/sim_core/src/spatial/snapshot.rs`：`TerrainAccentSnapshot` 结构体包含 `id`、`kind: String`、`x/y/z`、`scale`、`rotation`、`tint`；
     - ② `crates/sim_core/src/spatial/world_snapshot.rs`：`generate_snapshot()` 中赋值 `kind: accent.kind.as_str().to_string()`；
     - ③ `crates/sim_core/src/spatial/snapshot_bin/encode.rs`：FABS Section 21 正确写入 `accent_kind_code(accent.kind)`；
     - ④ `frontend/js/snapshot-bin.js`：Section 21 解码时映射 `kind = _enumTables.accentKind[kindCode]`，并由 `rustworld.js` 正确挂载至 `sim.accents`。
  3. **自动化测试守卫**：将 RockCluster 与 GrassTuft 的快照解析纳入 `tools/snapshot-check.js` 静态核对与 `test-wasm.js` 回归覆盖场景。
- **现状核对**：快照四处同步已于 D-B1-4/5 同步就绪，`node tools/snapshot-check.js` 静态核对全绿（JSON 对拍门禁已随 JSON 快照通道移除，回归兜底走 `test-wasm.js` / `test-determinism.js` 存读档与跨世界场景）。
- **出处**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §10.1、§10.4、根 AGENTS.md §4.5。
- **验收**：`node tools/snapshot-check.js` 退出码为 0。
- **依赖**：TA-11-1。
- **落地记录**：已于 D-B1-4/5 落地并通过全量快照比对门禁。

---

### TA-11-3 · 渲染表现层配置集中化与魔数解耦

- **目标**：将 `accent-model.js` 与 `render_accents.js` 中硬编码的 RockCluster 与 GrassTuft 视觉形态参数抽离至 `frontend/js/config.render.js`（`window.RENDER_CONFIG`），实现纯表现层调参无需改动逻辑代码。
- **内容**：
  1. **RockCluster 配置抽离**：
     - `accentRockClusterMinStones: 2`（子石最少数量）；
     - `accentRockClusterMaxStones: 5`（子石最多数量）；
     - `accentRockClusterSpreadBase: 3.2`（簇散布基准半径，世界米）；
     - `accentRockClusterSpreadVar: 1.2`（散布随机离散系数）；
     - `accentRockClusterMainRadiusBase: 2.4`、`MainRadiusVar: 1.0`（主石半径 2.4~3.4m）；
     - `accentRockClusterDebrisRadiusBase: 1.1`、`DebrisRadiusVar: 1.3`（伴生碎石半径 1.1~2.4m）；
     - `accentRockClusterLODMinRadius: 0.6`（远景微碎石省略阈值）。
  2. **GrassTuft 配置抽离**：
     - `accentGrassTuftMinBlades: 3`（草叶最少叶数）；
     - `accentGrassTuftMaxBlades: 6`（草叶最多叶数）；
     - `accentGrassTuftHeightBase: 2.4`、`HeightVar: 1.6`（基准株高 2.4~4.0m）；
     - `accentGrassTuftBaseSpread: 0.8`（根部聚拢半径）；
     - `accentGrassTuftWinterHeightRatio: 0.62`（隆冬低矮萎缩保底高度系数）；
     - `accentGrassTuftReedChance: 0.35`（水岸/河阶派生芦草外观的概率）。
  3. **代码接入与缺省回退**：`accent-model.js` 与 `render_accents.js` 读取 `window.RENDER_CONFIG`，若字段缺失严格回退至现有数值，保证零配置漂移。
- **现状核对**：`config.render.js` 当前仅包含树冠季相与骨架参数（行 77~85），RockCluster 与 GrassTuft 参数散落在 `accent-model.js` 行 206~256 与 `render_accents.js` 行 509~552。
- **出处**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §6.7「config.render.js 集中维护视觉种类、曲线与质量预算」、§10.4「配置集中」。
- **验收**：
  - `frontend/js/config.render.js` 补齐上述配置项；
  - `node tools/frontend-check.js` 语法与引用全通；
  - 调整 `accentGrassTuftMaxBlades` 或 `accentRockClusterSpreadBase` 在浏览器刷新后即时生效。
- **依赖**：TA-11-2。
- **落地记录**：✅ 已于 v1.50.34 落地。`config.render.js` 新增 17 键（含 TA-11-4 预留键 `accentGrassTuftReedChance`，另补 `accentGrassTuftBaseSpreadVar: 0.9` 使根部聚拢公式完整参数化）；`accent-model.js` 两骨架经 `cfgNum` 缺省回退读配置（回退值与原硬编码逐位一致，`accentModelStyleVersion` 保持 3、模型缓存零重建）；`render_accents.js` 接入 `accentRockClusterLODMinRadius` 与 `accentGrassTuftWinterHeightRatio`。临时断言（§4.10 已删）验证 500 id 缺省配置下骨架输出与旧硬编码逐位一致、覆盖配置即时生效；门禁 `frontend-check` / `config-check` / `test-wasm`（重编译 WASM 双副本后）全绿。

---

### TA-11-4 · 草丛生态形态扩展：水岸芦草变体与季相微调

- **目标**：全面兑现 07 号文 §6.6 规定的草丛季相与生态微环境特征——「嫩绿→深绿→枯黄→冬季低矮枯草，偏向林缘和空旷地；水岸可派生芦草外观」。
- **内容**：
  1. **稳定哈希芦草变体（Reed Variant）**：
     - 在 `accent-model.js::grassTuftSkeleton()` 中，通过稳定哈希 `_accentHash(id, 720) < cfg.accentGrassTuftReedChance` 派生芦草类型标志 `isReed`；
     - 芦草形态特征：茎秆挺拔更高（基准株高 4.2~6.0m），叶尖微弯弧度更收敛，顶端附着穗状芦花/花序线段（局部端点增设 plume 结构）；
     - 空间分布协同：虽然 accent 生成早于水体语义，但通过稳定哈希赋予部分簇芦草形态，配合河滩/河阶的高密度分布形成自然芦苇荡视觉。
  2. **四季节相表现深化**：
     - **春（嫩绿萌发）**：连续叶色偏黄嫩，株高适中，芽苞隐现；
     - **夏（深绿繁茂）**：叶色深浓，簇形伸展饱满；
     - **秋（金黄褐黄 + 芦花蓬松）**：叶色转为赤金与枯赭，芦草顶端穗状花序呈现淡黄白高光（`flowerAmount`/`litterAmount` 协同）；
     - **冬（低矮枯草）**：株高按 `0.62 + 0.38 * leafDensity` 缩减收拢，叶色转灰枯褐（`rgb(95, 88, 70)`），**草叶不脱落**，冬季依然可见枯草残桩与挺立芦秆（严禁整丛消失或变为纯透明）。
  3. **纯函数与确定性纪律**：变体与季相颜色完全由 `accent.id` 与快照 `sim.currentSeason` / `seasonProgress` 决定，不产生逐帧累积状态，时光回溯与读档逐位复现。
- **现状核对**：当前 `drawAccentGrassTuft` 仅有一套 2.4~4.0m 的普通短草线，无水岸芦草变体；冬季高度收缩已生效，但缺少秋季芦花与顶端穗状细节。
- **出处**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §6.6「GrassTuft 季相与放置规则」、§6.3 统一季相模型。
- **验收**：
  - 在近景视口下，约 30%~40% 的草丛呈现更挺立带穗的芦草外观；
  - 推进四季（春→夏→秋→冬），草丛经历「嫩绿 → 葱绿 → 金黄带白穗 → 矮萎枯草」的平滑过渡；
  - 暂停模拟、拖动镜头或回溯历史 Tick，草丛形态与颜色零抖动、零跳变。
- **依赖**：TA-11-3。
- **落地记录**：✅ 已落地。`accent-model.js::grassTuftSkeleton` 以稳定哈希 `_accentHash(id,720) < accentGrassTuftReedChance` 派生 `isReed`——芦草株高 4.2~6.0m（新配置键 `accentGrassTuftReedHeightBase/Var`）、叶尖外倾收敛至 0.14~0.34、每叶带穗长 `plume`（`accentGrassTuftPlumeLenBase/Var`，0.9~1.5m，非芦草恒 0），哈希通道 716+i×5 独立无碰撞；`render_accents.js` 新增季相色纯函数 `grassSeasonColor(season)`——春芽提亮（budAmount→嫩芽绿 35% 混合）→ 夏深绿 → 秋枯赭（枯萎深度 = brownness×(1−叶量)×1.35）→ 隆冬精确收敛 `rgb(95,88,70)`，芦花穗量随 brownness 0.35→0.8 渐升（flowerAmount 叠加预留）、穗色按 litterAmount 由淡黄白 `(240,233,200)` 转干灰 `(190,182,158)`、隆冬残穗挺立，穗几何为叶曲线末端三笔花序线段（随隆冬 hK 收缩，远景屏长 <2px 省略），芦秆线宽 0.52 略细于短草 0.62；`config.render.js` `accentModelStyleVersion` 3→4（芦草骨架形态变更即整体重建缓存）。临时断言（§4.10 已删）验证 2000 id 芦草比例 0.346（30%~40% 带内）、株高/穗长区间、清缓存重建逐位一致、四季颜色收敛与年环步进 ≤4.03、绘制冒烟通过；门禁 `frontend-check` / `config-check` 全绿（纯前端变更，未动 Rust/WASM）。

---

### TA-11-5 · 碎石群地貌表现升级：微接触阴影与岩面分层

- **目标**：优化 `RockCluster` 在倾斜坡地与河滩上的接地感，消除漂浮感，丰富碎石棱角与明暗层次，打散孤立圆石观感，并为 TA-04-5（动态受光）预留标准法线接口。
- **内容**：
  1. **微接触落底阴影（Contact Grounding Shadow）**：
     - 为簇内主石及整体碎石群增加柔和落底接触阴影，调用 `lightShadowOffset(0.6, 1.2, 0.4)`；
     - 投影随缩放与相机旋转协调偏移，透明度控制在极淡的 `rgba(25, 20, 15, 0.14)`，强化卵石镶嵌于地表的重量感与自然锚定。
  2. **碎石几何分层与棱角扰动**：
     - 主石采用 6~7 边形非对称变径多边形，辅石采用 5~6 边形，由 `_accentHash` 产生自然的尖角与平钝面，避免规则多边形的人工几何感；
     - 侧底面深灰（背光侧 `[78, 74, 68]`）与顶面浅灰（迎光侧 `[152, 146, 138]`）沿用 `stoneTone` 色差，外加 0.5~0.8px 低饱和暗边轮廓（`rgba(40, 36, 30, 0.75)`），使浅色碎石从高程地表纹理中清晰分离。
  3. **TA-04-5 接口预留与分面契约**：
     - 几何端点导出近似顶面法线 $(0, 0, 1)$ 与倾斜侧面法线，为后续 TA-04-5 世界光向点积受光（`shadeRgb`）做好结构准备，避免未来重复重构绘制循环。
- **现状核对**：当前 `drawAccentRockCluster` 已有底面/顶面两遍式绘制，但缺少落底阴影，在浅滩与斜坡上略显扁平悬浮。
- **出处**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §6.6「RockCluster 规则」、§6.5 动态受光、§4.1 色板与材质。
- **验收**：
  - 碎石群底部具备柔和微阴影，在河滩与斜坡上具有扎实的接地感；
  - 远景缩放（`zoom < 0.6`）下微碎石自动剔除，保留主石块面；近景缩放（`zoom > 1.2`）下棱角与明暗清晰，无重叠频闪。
- **依赖**：TA-11-3。
- **落地记录**：✅ 已落地（模型层 `accent-model.js::rockClusterSkeleton` 一并接入，几何契约前置）。①微接触落底阴影：`drawAccentRockCluster` 改调 `lightShadowOffset(0.6, 1.2, 0.4)`，簇群整片弱椭圆 `rgba(25,20,15,0.14)` + 逐石接触椭圆 `rgba(25,20,15,0.10)`（主石自动 +0.02，透明度走新配置键 `accentRockClusterShadowAlpha` / `accentRockClusterStoneShadowAlpha`），阴影先于全部石体绘制、只落地表不压邻石；②几何分层：主石 6~7 边 / 辅石 5~6 边（哈希通道 660+i×8，各约 50% 分布），逐顶点变径加宽至 0.78~1.22 产生尖角/平钝面对比，底层改逐面片扇形填充——每面片在几何端点就地导出倾斜侧面法线（相邻顶点方位角中点水平分量 + 下倾 0.45），顶面法线近似 (0,0,1)，TA-04-5 接入时只换光源参数无需重构绘制循环；暗边轮廓钳制 0.5~0.8px；③远景 LOD（`accentRockClusterLODMinRadius`）沿用。临时断言（§4.10 已删）验证 500 id 边数区间与 shape 长度/数值界、清缓存重建逐位一致、阴影绘制次序与透明度、配置即时生效、0.4x~2.2x 四档缩放冒烟；门禁 `frontend-check` 全绿（纯前端变更，未动 Rust/WASM）。

---

### TA-11-6 · 渲染热路径零 GC 改造与缓存生命周期审计

- **目标**：彻底消除 `render_accents.js` 在渲染 RockCluster 与 GrassTuft 时的逐帧堆对象分配，并严格审计 `AccentModel` 缓存生命周期契约与未知种类防御。
- **内容**：
  1. **热路径零 GC 改造（Persistent Scratch Buffer）**：
     - 当前 `drawAccentRockCluster` 在每帧为每个实体执行 `const items = []`，每颗子石分配 `{ st, g }` 对象并调用 `items.sort()`；
     - 当前 `drawAccentGrassTuft` 同样为每根草叶分配 `{ b, bx, by, tx, ty, h, d }` 并排序；
     - **改造方案**：模块内建立持久复用的对象池/平铺缓冲数组（`_rockScratchPool`、`_grassScratchPool`），按索引写入，排序在定长复用切片内完成，彻底根除高频 GC 抖动（严格遵守根 AGENTS.md §4 性能规范）。
  2. **视口剔除与包围盒校准**：
     - 核对 `accent-model.js::extentOf`：`RockCluster = 10`、`GrassTuft` 升级芦草后由 `5` 调整为 `7`（覆盖芦花高位）；
     - 确认 `drawAccentEntity` 视口粗剔除公式（`upMargin` / `xMargin`）充分覆盖芦草挺拔高度与碎石外散半径，边缘无裁断与突发跳入（pop-in）。
  3. **缓存生命周期与世界切换重置**：
     - 验证 `rustworld.js` 在 `READY`、`LOAD_RESULT`、`REWIND_RESULT`、`RESET_DONE` 时调用 `AccentModel.resetCache()`；
     - 验证缓存键 `'v' + styleVersion + '#' + kind + '#' + id` 机制，递增 `accentModelStyleVersion` 时可强制热重建；
     - 复核字符串驻留表与模型缓存解耦：`STR_TAB.start_index == 0` 只管字符串表，模型生命周期走显式 `resetCache()`。
  4. **未知类型防御升级**：复核 `_reportUnknownAccent`，对非白名单种类严格跳过并在开发模式（`sim.debugMode`）以 3 秒限频汇总报警，**严禁错画为 Bush**。
- **现状核对**：`accent-model.js` 已实现基础缓存与清空接口；`render_accents.js` 中存在每帧 `const items = []` 的对象分配开销。
- **出处**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §6.7、§10.2、根 AGENTS.md §4.5.1。
- **验收**：
  - Chrome DevTools 内存面板录制 60 秒平稳运行 Profile，装饰绘制循环中 `items` 对象分配量为 0（零每帧内存阶梯上升）；
  - 执行重置世界（RESET）或加载存档（LOAD），模型缓存平稳释放重建，无内存泄漏与旧世界 ID 串味。
- **依赖**：TA-11-4、TA-11-5。

---

### TA-11-7 · Chrome 端到端四季视觉与动态操作验收

- **目标**：在官方基准运行环境（Chrome 浏览器 + 本地文件存档）下，对 RockCluster 与 GrassTuft 执行全场景视觉、季节、镜头与时间流转验收。
- **内容**：
  1. **四季端到端推进验证**：
     - 启动模拟，固定观察点，平稳推演 1 年完整年历；
     - 验证 GrassTuft 从初春嫩绿（芽点微显）→ 盛夏深绿繁盛 → 深秋赤金白穗芦花 → 寒冬低矮枯褐残草的连续渐变；
     - 验证 RockCluster 与 Boulder、地表岩石在四季光照下的色彩协调性，冬季无落叶但与枯草形成萧瑟地貌。
  2. **双地图模板适配验证**：
     - **T1 山口聚落（`mountain_pass_v1`）**：山口坡脚与碎石坡面呈现成组分布的 RockCluster，干地鞍部呈现疏密有致的 GrassTuft；
     - **T2 两岸河谷（`river_valley_v1`）**：河滩与河阶分布有带微阴影的鹅卵石群（RockCluster），沿河两岸自然涌现挺拔的水岸芦苇丛（GrassTuft Reed）。
  3. **视角交互与统一深度队列检验**：
     - 旋转相机（四方位角 0° / 90° / 180° / 270°）、俯仰调整（高俯角 / 低俯角）与平滑缩放（远景 0.4x / 中景 1.0x / 近景 2.2x）；
     - 验证深度排序：近处草石正确遮挡远处道路地表，但绝对不穿透覆盖前景房屋与选中人物；
     - 验证点击拾取不受纯视觉装饰干扰。
  4. **时间回溯与生命周期稳态验证**：
     - 执行时光倒流（Rewind Tick）与读取存档（Load Save）；
     - 验证同一 Tick 下草石的位置、高程、形态、颜色 100% 像素级一致，无重新随机抖动。
- **现状核对**：待 TA-11-3~6 完成后在 Chrome 中做最终视觉与交互实测。
- **出处**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §11.2、§11.4「Accent 专项验收」。
- **验收**：
  - 录制或截屏留存四季对比图；
  - 达成 §11.4 全部外观标准；
  - 60 FPS 稳定运行，无丢帧卡顿。
- **依赖**：TA-11-6。

---

### TA-11-8 · 门禁全绿、版本规范自增与规划文档状态同步

- **目标**：完成全链路回归门禁，按规范自增补丁版本号，更新项目总览与规划文档，产出完备的交付记录。
- **内容**：
  1. **自动化门禁全通**：
     - `cargo test --lib`（Rust 编译无警告）；
     - 若改动 Rust 代码，重编译 WASM 并同步双副本至 `frontend/rust/` 与 `frontend/`；
     - `node tools/test-wasm.js`（WASM 确定性与长程稳定）；
     - `node tools/test-determinism.js`（增强型确定性矩阵全通）；
     - `node tools/snapshot-check.js`（快照单通道静态核对）；
     - `node tools/config-check.js`（配置一致性无孤儿参数）；
     - `node tools/frontend-check.js`（前端 JS 语法与 DOM ID 完整）；
     - `node tools/doc-link-check.js`（Markdown 链接全可达）；
     - `node tools/cross-doc-check.js`（跨文档事实一致）；
     - `node tools/code-map-check.js`（代码地图登记一致）。
  2. **版本自增与双副本同步**：
     - 按根 AGENTS.md §4.9 执行 `node tools/bump-version.js --patch`（禁止手工改版本号）；
     - 升版后重编译 WASM 并复制到两处路径；
     - 检查 `SAVE_APP_VERSION` 同步更新。
  3. **文档事实与台账同步**：
     - 更新 `docs/plan/tech/07-terrain-art.md` §1.2 任务总表中 TA-11 状态为 `✅ 已落地`；
     - 更新 `07-terrain-art.md` §3.2（行 178）与 §10.1（行 437）中过时的「仅有枚举，生成器无调用」描述，修正为「已全面完成生成、FABS 快照、模型缓存与绘制」；
     - 在 `docs/current/01-changelog.md` 中追加本次交付的版本详细说明；
     - 更新根目录 `TODO.md` 与 `frontend/AGENTS.md` 对应的装饰维护记录。
- **现状核对**：待所有代码与验收完成后统一步骤收口。
- **出处**：根 AGENTS.md §4.0、§4.1、§4.9；[30-workflow.md](docs/current/tech/30-workflow.md)。
- **验收**：所有门禁退出码为 0，文档链接与指纹校验零告警。
- **依赖**：TA-11-7。

---

## 验收口径速查（对齐 07 号文 §11.4）

| 验收维度 | 核心标准 | 对应任务 | 验证工具 / 门禁 |
| :--- | :--- | :--- | :--- |
| **形态丰富度** | 碎石群 2~5 颗子石散布自然，主石突出；草丛具备普通短草与挺拔水岸芦草（带芦花穗）双变体 | TA-11-4、TA-11-5 | Chrome 近景视口（1.5x~2.2x）审查 |
| **四季节相** | 草丛嫩绿→深绿→秋金白穗→冬季低矮枯草；隆冬草叶不脱落且不消失；碎石四季常在无突变 | TA-11-4 | 跨年连续运行观察 |
| **地表贴合** | 碎石底部微阴影接地，斜坡与河滩无悬空感；严格避开深水、浅水及禁行岩壁（`NO_WALK`） | TA-11-1、TA-11-5 | T1 山口与 T2 河谷模板切片遍历 |
| **视口与性能** | 零每帧 GC 内存分配；视口剔除平滑无边缘截断；符合 §11.3 绘制增量 $\le 3\text{ms}$ 预算 | TA-11-6 | Chrome Performance / Memory Profile |
| **确定性与生命周期** | 换世界/读档/回溯模型完全一致，无跨世界残留；独立加盐 RNG，不扰动模拟实体决策 | TA-11-1、TA-11-6 | `test-determinism.js` |
| **工程质量** | 表现层配置集中于 `config.render.js`；单文件不超 800 行；快照四处同步与双副本就绪 | TA-11-2、TA-11-3、TA-11-8 | `frontend-check.js`、`config-check.js`、`bump-version.js` |
