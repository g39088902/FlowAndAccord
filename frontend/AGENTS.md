# frontend 模块 · 局部操作指南

> ★★ **渲染架构决策（2026-09-17）：全量 WebGL，不再使用 Canvas 2D**。目标形态为全部内容（地形 / 装饰 / 实体 / 道路 / 标签 / 特效）进入同一 WebGL 管线、共享一个深度缓冲（[31 号迁移方案 §8](../docs/plan/tech/31-canvas-to-webgl-migration.md)、根 AGENTS.md §4.18）。★ **v1.60.1 部分提前落地**：**WebGL 为硬门槛**——不可用时 `main.js` 显示错误覆盖层并阻断启动（`?webgl=0` / `RENDER_CONFIG.useWebgl` 开关已删）；地形 / 光照 / 装饰 / 阴影四项的 **Canvas 备用通道已删除**（`terrain-texture.js` / `terrain-mesh-merge.js` / `render_shadows.js` / `fallback-handler.js` / `render-canvas-patch.js` / `webgl/terrain/test-grid.js` 六文件删除）。`#sim-canvas` 2D 覆盖层仍存在但只剩**水系 / 道路 / POI / 房屋 / 族人 / 标签**（阶段四~五未迁移），GL 阴影接收面仅 GL 地形。**改本节渲染文件前须知**：① 不在 Canvas 2D 侧追加遮挡优化（原 TA-08 三策略已取消，TA-08 任务已删除视为完成，验收矩阵并入 31 号 §8.5）；② `accent-model.js` / `accent-lod.js` / `accent-season.js` / `landscape-model.js` / `landscape-mask.js` 是**与渲染后端解耦的 CPU 侧几何与筛选层**，迁移将整体复用——严禁把其逻辑内联进 `ctx` 绘制函数。
>
> 本目录是原生静态前端：50 个 JS 文件（js/ 根 44 + webgl/ 6；含 ★ TA-06 人工验收台 `ta06-acceptance.js`，仅 `?ta06=1` 激活）（含 ★ M4 `snapshot-bin.js` 二进制解码器、★ v1.50.23 TA-01 装饰套件 `accent-season.js` / `accent-model.js` / **★ TA-07 `accent-lod.js`** / `render_accents.js` / `render_bush.js` / `render_grass.js` 与 ★ S4-02/S4-03 资源景观套件 `landscape-model.js` / `landscape-mask.js` / `render_landscapes.js`、★ S4-06 标签布局层 `label-layout.js`；★ v1.60.1 删除 `terrain-texture.js` / `terrain-mesh-merge.js` / `render_shadows.js` 与 webgl/ 下 `fallback-handler.js` / `render-canvas-patch.js` / `test-grid.js` 六文件）+ index.html + map.html + style.css + map.css + server.js，无构建工具，纯静态文件。
> 改本目录代码前：先读根 AGENTS.md §4（尤其 §4.1 双副本、§4.5 快照四处同步[M4]、§4.14 决策顺序），再读本文件。
> 全局规则以根 AGENTS.md 为准，冲突时以根文档为准。

---

## 0. Agent 交互契约

- 输入：`rustworld.js` 提供的同构快照对象；输出：Canvas、Inspector、制度大盘和决策视图。
- `rustworld.js` 是唯一快照适配层；UI 模块不得直接读取 WASM 或自行解释原始二进制帧。
- 新增 DOM ID、快照字段、枚举标签或交互芯片时，必须同步所有消费者并通过 `node tools/frontend-check.js`。
- 高频 DOM 容器必须使用内容快照缓存；排序展示必须保持与 Rust 相同的稳定顺序。

## 一、文件清单与职责边界

### 1.1 基础层（零业务依赖，最先加载）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/math.js` | ~140 | 3D 向量与投影变换（Vec3 / 世界坐标→屏幕坐标 / 倾斜投影）+ 地表色基座（`computeTerrainAlbedo` 反照率 / `terrainAmbientOcclusion` AO / ★ v1.50.74 `smoothAlbedoField` 反照率数据层平滑——边缘感知盒式模糊，水格屏障不混色，rustworld 建地形缓存时一次性消费） | 任何业务逻辑 |
| `js/config.js` | ~216 | `window.SIM_CONFIG` 全局数值配置（369 字段，含拆分配置合计），按功能分区注释 | 前端配置文件是数值权威，Rust 负责接收契约 |
| `js/config.poi-rates.js` | ~45 | POI 再生产速倍率的浏览器偏好（键 `flowaccord.poi-regen-rates.v1`）；在 Worker 创世前读取并随 INIT/RESET 传入 | 存档覆盖的既有世界倍率 |
| `js/config.decision-order.js` | ~30 | `window.SIM_DECISION_ORDER`：16 条活动分支顺序 + 层级覆盖。用户调整保存到 `flowaccord.decision-order.v3`；启动时迁移 v2（b11→b8、移除 b15） | Rust 侧默认为空 Vec，不写死顺序（根 AGENTS.md §4.12 例外） |
| `js/config.house-upgrade-cost.js` | ~50 | `window.SIM_HOUSE_UPGRADE_COST`：房屋升级材料成本矩阵 **20 字段**（M8 拆分文件，独立语义避免主配置臃肿），rustworld.js applyConfig 时 Object.assign 合并 | 值须与 Rust `config.rs` 的 house_upgrade_cost_tier* 默认一致（config-check 校验） |
| `js/config.lighting.js` | ~56 | ★ v1.48.0 `window.SIM_LIGHTING`：动态季节光照纯表现层配置（光位/强度/色温/阴影/量化档/限速）。**不并入 SIM_CONFIG**（并入会与 SimConfig 字段集比对冲突），不注入 WASM | 任何模拟行为参数（那些走 SimConfig） |
| `js/config.render.js` | ~323 | ★ v1.50.15 `window.RENDER_CONFIG`：渲染表现层参数（mapZLift 视觉抬升 / 足迹感知深度半径 agentFootprintR·laneFootprintR·poiBase*·poiMarkerFootprintR·accentFootprintR / ★ v1.50.88 车道绘制缓存 laneCullPadPx 16 粗剔外扩 + laneAdaptiveSegPx 140 屏幕弧长短车道 8 段自适应[0 = 关]）。★ v1.50.25 TA-03 增植被季相曲线 `accentSeasonProfiles` 与骨架参数（accentModelStyleVersion / accentDetail*Px / accentLeafClusters*）。★ **TA-06 物种变体参数（07 号 §6.3）**：增 `accentSpeciesWeights`（乔木/灌木累积权重）、`accentTreeSilhouettes`（三乔木轮廓：干高/冠幅/枝数/簇因子/仰角带/扁压/足迹/倾干系数，锥形常绿另有轮生层数与每层枝数）、`accentBushVariants`（三灌木变体：茎数/茎高/外倾/簇参数/扁压/足迹）与花朵 4 键（`accentFlowerDotsMax` / `accentFlowerDotRadiusK` / `accentFlowerMinPx` / `accentFlowerPalette`）；**删除** `accentEvergreenChance`、`treeTintYellowBand`、`treeTintRedBand`；`accentModelStyleVersion` 4 → 5（**本组为几何输入，调值必须同步 bump 风格版本**）。★ v1.50.34 TA-11-3 增 RockCluster / GrassTuft 视觉形态参数 17 键（accentRockCluster* 9 键 + accentGrassTuft* 8 键）；★ v1.50.36 TA-11-4/5 增芦草与接触阴影 6 键（accentGrassTuftReedChance/ReedHeight*/PlumeLen* + accentRockClusterShadowAlpha/StoneShadowAlpha——★ v1.60.1 起接触阴影 2 键随 Canvas 接触影通道删除，芦草 4 键保留），accent-model.js / render_accents.js 消费；★ v1.50.39 TA-04-3 增枝干明暗带 5 键（accentBarkBandOffset/WidthK/LitAlpha/DarkAlpha/MinWidthPx，render_accents.js::barkBandCfg 消费）；★ v1.50.40 TA-04-4 增叶簇亮部 5 键（accentCrownLitOffset/RxK/RyK/Alpha/MinPx，render_accents.js::crownLitCfg 消费）；★ v1.50.45 TA-04-5 增岩石立体几何 1 键（accentStoneHeightK 石体高宽比，render_accents.js::drawStoneBody 消费）；★ v1.50.46 TA-04-6 增树/灌木贴地投影 4 键（accentShadowAlpha/GroundAlpha/BranchAlpha/MinPx；★ v1.60.1 随 render_shadows.js 删除）；★ S4-02 增资源景观 7 键（landscapeEnabled 总开关 / landscapeStyleVersion / landscapeCacheMaxGroups / landscapeFrameChildBudget + landscapeRecipes 配方表 [rMin/rMax/roles{role,modelKind,slots,scale*,footprint}]，landscape-model.js / render_landscapes.js 消费）；★ S4-03 增景观遮罩 7 键（landscapeMaskEnabled 总开关 / landscapeMaskBinSize 分桶边长 / landscapeMaskLaneRadius 车道胶囊半径 / landscapeMaskLaneSamples 细分上限 / landscapeMaskHouseRadius 房屋保守圆 / landscapeMaskPoiExtraRadius POI 操作区余量 / landscapeMaskMargin 通用留白——全部世界单位，landscape-mask.js 消费）；★ S4-04 增可采细节 2 键（landscapeDetailQFloor 0.2 / landscapeDetailQCeil 0.85——detail 子图元 qThreshold 映射区间，**改值后须 LandscapeModel.resetCache() 重建** qThreshold 为构建期常量；landscape-model.js / render_landscapes.js 消费）；★ v1.50.87 删除 GroundPatch 相关 3 键（landscapeGroundMaxSlopeDeg / landscapeGroundWinterAlphaRatio / accentLODGroundPatchMinPx）与配方表五 GroundPatch role（配方 v4，仅存 foliage detail）；★ S4-06 增标签布局 10 键（labelLayoutEnabled 总开关 / labelGridCellSize 屏幕冲突网格 / labelMaxProposals 普通标签提案上限 / labelRectPadPx 矩形外扩 / labelSidePadPx 左右备选间距 / labelUiRefreshFrames UI 矩形重测帧隔 / labelUiRectIds UI 禁入元素表 + 旧硬编码 LOD 收编 labelPoiNameMinZoom 0.50 / labelStockRingMinZoom 0.70 / labelHouseNumberMinZoom 1.05，label-layout.js / render_world.js / render_agents.js 消费）；★ S4-07 增聚合与引线配置 5 键（labelClusterEnabled / labelClusterMaxZoom 0.95 / labelClusterRadiusPx 36 / labelHysteresisPx 4 / labelLeaderLineEnabled true + labelUiRectIds 默认生效 top-bar·inspector-card·ledger-panel·global-averages-card·global-resource-panel 5 面板）；★ TA-12-2 增地表纹样 11 键（terrainTexture 配置组；★ v1.60.1 随 terrain-texture.js 整组删除）；★ v1.50.74 增地表反照率平滑 1 键（`terrainAlbedoSmoothRadius` 2——math.js::smoothAlbedoField 消费，rustworld 建地形缓存时一次性调用，0=关；**改值需重开世界/刷新页面生效**）。**不并入 SIM_CONFIG**（同上互检冲突），不注入 WASM；render_depth_queue.js 顶层 `const RC` 消费，须早于其加载 | 渲染深度队列（render_depth_queue.js） |
| `js/lighting.js` | ~359 | ★ v1.48.0 `window.SimLighting`：年周期光弧引擎——年度相位推导、视觉限速器、面光照、世界空间阴影、天空氛围。★ v1.50.40 起含零分配投影变体 `sunScreenDirFullInto(out)` / `lightDirInto(out)`（装饰绘制每实体刷新刮擦，TA-04-3/4）。★ v1.50.90 GL shader 光照路径（方案 C）：地形受光由 terrain-renderer.js 顶点 shader 直译 `shadeAlbedoInto` 公式，uniform 经 `lightRev()` 版本号闸节流上传。★ **v1.60.1 Canvas 备用通道删除**：CPU 逐格烘焙 `relightTerrain` / `shadeAlbedoInto`（shader 直译后无 CPU 消费）/ `lastMs` / `relightCount` 已删除——`applyRelight` 只推进 `S.lightRev` + 清 dirty，`update(now, sim)` 恢复两参（不再有 glOwnsTerrain 第三参）；⚠️ **`S.lightRev++` 必须在 applyRelight 触发点计数**（GL uniform 上传的唯一信号）；`lightParams` / `shadeFace` / `shadeRgbInto` / `markDirty` / `resync` 保留（`lightParams` 被 terrain-renderer.js GL uniform 上传消费）。**必须在 rustworld.js 与渲染六件套之前加载** | DOM 操作、模拟状态写入、RNG 消费 |

### 1.2 决策引擎视图层（三件套，必须在 rustworld.js 之前加载）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/decision-viz-data.js` | ~75 | `D.BRANCH_MAP`：16 条活动分支的统一中文名、条件文案、默认层级与状态映射；决策卡和 Inspector 共用 | DOM 操作、拖动逻辑 |
| `js/decision-viz-view.js` | ~350 | 决策引擎覆层的 DOM 渲染：Branch 分支卡（含 ID 展示）/分界线/检查器/拖动事件绑定 | 数据来源、配置合并 |
| `js/decision-viz.js` | ~207 | 集成层：`mergeIntoSimConfig()` 把顺序合并进 SIM_CONFIG / 拖动松手→`applyConfig()` 热注入→★ v1.27.0 保存到浏览器 localStorage（schema 1 版本化，含 `savedAt`；非法/版本不符回退默认） | 具体渲染（委托给 view）、具体元数据（委托给 data） |

**加载约束**：三件套必须在 `rustworld.js` 之前加载——`rustworld.js` 构造时会读取 `window.SIM_CONFIG`（已包含合并后的决策顺序）并调用 `applyConfig`。

### 1.3 核心桥接与渲染层

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/snapshot-bin.js` | ~520 | **★ M4 (v1.45.3) FABS 二进制快照解码器**：`window.SnapshotBin.decode(Uint8Array) → 与 JSON 快照逐字段同构的 JS 对象`；维护持久化字符串驻留缓存与枚举名称表（`setEnumTables`/`resetCaches`）。★ v1.50.33 D-B1-7：`terrain_features`/`terrain_accents`/`terrain_sub_features` 仅静态地形脏帧携带（数组，可为空 = 明确空集合），section 缺席时为 `null`（= 未发送，消费方必须保留旧值，对齐 lanes/nodes 约定）。**必须在 rustworld.js 之前加载** | 任何 DOM 操作、Canvas 绘制 |
| `js/sim_worker.js` | ~300 | **仿真内核专用 Web Worker**（★ v1.38.0 Phase 1 解耦）：在独立 Worker 线程加载 WASM 引擎、自适应计时循环驱动 `world_tick_steps`、背压限频下发快照（**★ M4 优先二进制 FABS 帧 `.slice()` 后 `postMessage(transfer)` 转移**，wasm 无导出自动回退 JSON）、管理历史检查点与时光倒流 | 任何 DOM 操作、Canvas 绘制 |
| `js/rustworld.js` | ~600 | **主线程仿真代理层**（★ v1.38.0 改造）：管理 Worker 生命周期、将快照映射为 JS 视图对象（`_applySnapshot`，**★ M4 支持 ArrayBuffer/Uint8Array 入参经 SnapshotBin 解码**）、向 Worker 发送控制指令（暂停/倍速/调参/存读档）、提供同构实体查询接口与档案库。★ v1.50.33 D-B1-7：静态地形三通道（features/accents/subFeatures）缓存独立于地形网格缓存——`Array.isArray` 判明确静态帧（可为空）整组替换、`null`/无键增量帧保留旧值（禁止用数组长度猜测是否发送）；`_invalidateWorldStaticCaches()` 在 READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 四处随消息生命周期失效静态数据与 `AccentModel` 模型缓存（06 号 §18.4）。★ v1.62.0：`fluidParticles`（内核水体粒子）+ `_applyTerrainDelta`（侵蚀地形增量就地打补丁：改高程/坡度/flags、重算受影响格及 4 邻域法线/AO/反照率、bump `dynamicWaterRevision` 触发 GL 几何重传；**不动 minZ/maxZ**） | WASM 底层直接执行（委托给 sim_worker.js） |
| `js/render_canvas.js` | ~232 | **Canvas 主循环调度**（v1.7.1 从 render.js 拆分）：共享变量声明（frameCount/camera 引用/dbg 变量）/ 马斯洛需求元数据 MASLOW_STYLE / parseMaslowNeed / `render(now)` 主循环骨架（★ v1.50.90 起 `SimLighting.update` 先行；★ v1.60.1 起 GL 地形层直绘 `sim-canvas-gl`，随后 2D 覆盖层 `drawWorldEntities()` 统一深度实体，末尾 `drawTerrainGrid` 'G' 键调试网格）| 具体绘制（委托给 render_world/render_agents/render_inspector/render_hud） |
| `js/render_hud.js` | ~600 | **HUD 与大盘辅助函数**（v1.7.1 拆分）：dbgEl/fmtMB/dbgSetText 调试工具 / updateDebugHud 调试监视器 / updateTopBarStats 顶栏统计 / drawResourceDashboard 全地图资源大盘 / updateGlobalAverages 全局均值大盘 / updateLedgerPanel 家户账本面板 / tickToSec/formatDuration 格式化工具 / updateAgentLedgerInfo 族人家户账本信息 / **★ v1.46.15 未来 49 年气候预测折线图浮窗（Canvas 渲染 + 悬停交互）** | Canvas 绘制（在 render_canvas/render_world/render_agents） |
| `js/render_terrain.js` | ~161 | ★ v1.48.0 从 render_world.js 拆出；★ v1.49.1 深度队列化改造；★ **v1.60.1 仅剩 GL 时代仍有效的三块**：`drawTerrainShell`（纯顶点投影，无落笔——供调试/几何复用的壳层骨架）/ `drawTerrainGrid`（'G' 键调试网格线，2D 叠层画在 GL 地形之上，仍可用）/ **非水面水系特征绘制**（`drawFeatureItem`：RiverBank 单段描边、ShallowFord 浅滩踏石、Cliff 峭壁、泉谷整条——仍走 2D 深度队列；★ **v1.61.4 水面零多边形拟合**：`drawRiverBand` / `drawWaterBodyTile` / `_projectDynamicWaterVertices` / `_wbTileGrid` 已删除，River / WaterBody 直接跳过——水面唯一来源是 water_particles.js 粒子层）。★ v1.60.1 已删除：`drawTerrainCell` / `flushTerrainBatch` / `drawTerrainTextureForQuad`（地形格改由 GL 地形层绘制）/ `drawSkyBackdrop`（天空清屏由 GL 层承担）/ `drawBoundaryWallSeg`（侧壁由 GL 地形层顶点绘制）；v1.48.1 `TERRAIN_SEAM_PX` 缝隙补偿随 Canvas 逐格填充一并失效 | 立体实体、绘制调度（在 render_depth_queue）、HUD、共享状态 |
| `js/accent-season.js` | ~80 | ★ v1.50.23 TA-01（docs/plan/tech/07-terrain-art.md §6.7）：**`window.SimTreeTint` 季相层**——装饰树木季节叶色的唯一生产者（`yearPhase`/`sample`/兼容 `brownness`，消费 `RENDER_CONFIG.accentSeason*`）；TA-02 已提供连续叶色/叶量/芽/花/地被曲线。★ TA-06-2 删除 `tint()` 三档量化兼容接口（连同 `treeTintYellowBand`/`treeTintRedBand`，全仓无消费点），profile 由 `AccentModel` 的 `model.profile` 单一入口送入。**新增消费方只能读它，不得另建季节色逻辑** | 模型几何（accent-model）、绘制（render_accents / render_bush） |
| `js/accent-model.js` | ~784 | ★ v1.50.23 TA-01：**`window.AccentModel` 模型层**——稳定形态派生 + 个体模型缓存（全局 `_accentHash` 哈希 / 个体种子 `vSeed` / `extent` 包围体预留）。★ **TA-07-3 分级几何（07 号 §6.7）**：模型条目新增 `bounds{rH,zMin,zMax,yUp,rS}` **真值包围体**（由骨架几何求值，取代 `extentOf` 的 kind 级硬编码常数；`yUp` = 石体底环贴落地点上移、`rS` = 屏幕空间球半径不乘 cosX）+ `farClusters`（远景簇子集，半径降序前 `accentLODFarMaxClusters`、回排为原索引升序保画家次序，`Uint8Array`）+ `segTier`（0 主枝 / 1 二级枝；Bush 与 conifer 恒 0）+ `stoneMain`（恒 0）；三者均为 `(kind,id)` 纯函数入现有缓存（**不改** `_CACHE_MAX=2048` / 生命周期 / 键构造）。`accentLODFarMaxClusters` 与 `accentKindBounds` 属**几何输入**，调值必须同步 bump `accentModelStyleVersion`（TA-07 起 5→6）。⚠️ 本文件已 784 行逼近 §4.6 的 800 行红线，下次扩容优先按 TA-06 §3.7-4 预案拆出 `accent-species.js` |★ v1.50.25 TA-03：局部三维骨架——Tree = 锥形主干 + 主枝/二级枝（segments 线段）+ 枝端/冠顶/包络叶簇；Bush = 基生细茎 + 叶簇；叶簇带稳定脱落次序 `shed` 与色差通道 `lite`（accent.id 纯函数）；缓存键 `v{accentModelStyleVersion}#kind#id`、上限 2048 条超限清空。★ **TA-06 物种变体（7 号 §6.3）**：`speciesOf(kind,id) → { silhouette, profile }` 按 `RENDER_CONFIG.accentSpeciesWeights` **累积权重表**派生（哈希全新 800 段：800 乔木 / 802 灌木 / 810+i×3 花位花色 / 841+ 锥形轮生层；997/998 保留给季相 jitter；旧 400 通道随 `evergreenOf` 过渡接口删除且不复用）——三乔木轮廓 `broad`（阔冠宽扁外展）/`sparse`（疏冠 2 二级枝、空隙大）/`conifer`（轮生 4~6 层 × 3~5 短枝、层半径线性收缩、簇小而扁、倾干收敛）与三灌木变体 `multiStem`（现状基准逐值复现）/`flowering`（略收外倾 + **构建期固定花位** `flowers[]`）/`lowEvergreen`（短茎扁压铺展）；非 Tree/Bush 返回 `undefined`（GrassTuft/Boulder/RockCluster 零影响，`profile` 亦为 undefined → 绘制层回退原曲线）。骨架统一输出 `crownR`/`trunkH`/`footprintR`/`crownSquash`/`leanShearK` 为**唯一几何真相源**（修正旧绘制冠幅与骨架返回值不一致的历史漂移）；`extentOf` 对 Tree/Bush 改由骨架实际几何求值。**物种权重与轮廓参数属几何输入，调值必须同步 bump `accentModelStyleVersion`**（§10.2 缓存键契约）。★ v1.50.31 D-B1-6：`RockCluster`（内核只下发 anchor，2–5 颗子石偏移/尺度/形状全由 accent.id 哈希派生，不建实体）与 `GrassTuft`（3–6 根短草线骨架）模型分支（★ v1.50.34 TA-11-3 起两骨架的数量/散布/半径/株高参数走 `config.render.js` accentRockCluster*/accentGrassTuft*，缺省回退与原值逐位一致）。`resetCache()` 经 rustworld.js `_invalidateWorldStaticCaches()` 在 READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 四处调用（★ v1.50.33 D-B1-7；与静态数据失效同一消息生命周期，换世界不残留旧模型）。★ v1.50.36 TA-11-4：GrassTuft 增哈希派生芦草变体（`skeleton.isReed`，株高 4.2~6.0m、穗长 plume 通道，概率走 `accentGrassTuftReedChance`）；★ v1.50.37 TA-11-6：`shearNormalInto` 零 GC 变体、`extentOf` GrassTuft 5→7（覆盖芦草株高与芦花穗高位） | 季相曲线（accent-season）、绘制（render_accents / render_bush） |
| `js/accent-lod.js` | ~206 | ★ TA-07-2（07 号 §6.7/§10.2）**装饰细节分级 LOD 集中解析层** `window.AccentLOD`：特征尺度（主体特征世界尺寸 × `accent.scale` × `camera.zoom` = **CSS px**，DPR 由 `main.js` 的 `setTransform` 承担 ⇒ 档位天然 DPR 无关）/ `tierOf`（三档判档 + 阈值带滞回：升档裸阈值、降档 `T×(1−h)`，`h=accentLODHysteresis`）/ `tierFor(owner,kind,model,scaled)`（档位写个体瞬态字段 `_lodT`，随对象生命周期自然失效，**严禁**模块级 Map）/ `kindBounds`（一级粗剔保守常数表，须 ≥ 真值上界）/ `aabbOf`（解析式屏幕 AABB，含 `yUp` 石体贴地偏移与 `rS` 球体半径两个**不乘 cosX** 的修正项）/ `shadowAabb`（冠影 + 影梢两圆并集）/ `leanShear`（倾干剪切单一来源）/ `stats`（dev 计数器）。**口径唯一红线**：装饰 / 灌木 / 草丛 / 阴影 / 景观 / 队列六处一律读它，**严禁**各处留余量公式或阈值字面量（旧 `44+44×scale` / `24+14×scale` 启发余量与 `crownR×1.8+|so|` 已全部收口）。临时断言脚本曾实测 72 万投影点全部落在解析 AABB 内 | 模型（accent-model，须先加载）、配置（config.render.js）、全部装饰族消费点 |
| `js/landscape-model.js` | ~350 | ★ S4-02（16 号文 §2.16）**资源景观模型层** `window.LandscapeModel`：围绕资源 POI（Water/Wood/Berry/Stone/Gold）的前端确定性派生景观——固定 uint32 哈希（世界 seed×类型盐×poi.id×配方盐×role×slot）、配方/slot/候选上限（RENDER_CONFIG.landscapeRecipes，缺省回退与集中值一致）、极坐标盘采样（`r=sqrt(lerp(rMin²,rMax²,u))`）、双线性高程插值（索引口径同 render_depth_queue::_ownCellCenterDepth，出界拒绝）、Water 配方水面候选拒绝（ShallowWater/DeepWater；RiverBank 岸带放行）。**模型只由静态输入派生**；库存丰度 `q` 只写组上动态字段（q 缺失/maxStock≤0 → 无效，保留基础标记），绝不参与几何重抽。组缓存上限 `landscapeCacheMaxGroups`；`resetCache()` 经 rustworld.js `_invalidateWorldStaticCaches()` 随 READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 生命周期调用（与 AccentModel 同源）。子图元模型经 `AccentModel.getByKey`（完整 key 通道 `'L#'` 命名空间）解析，**禁止**把景观 key 截成可能与 accent.id 碰撞的整数。★ S4-03：`version()` 组几何版本号（每次重建 +1，遮罩占据网格重建判据）；子图元 `key/dx/dy/x/y/z/rot/scale/footprint` + 表现缓存 `_view/_masked`。★ S4-04：`foliage` 可采细节（**`stockRole:'detail'`**：`qThreshold` 构建期由 `landscapeDetailQFloor/QCeil` 区间按 (slot+0.5)/slots 线性映射为常量，**改配置阈值后须 resetCache 重建**）；`childActive(group,child)`（骨架恒可见 / detail 按 q≥threshold，绘制与遮罩共用）。★ v1.50.87 配方 v4（RECIPE_VERSION 4）：GroundPatch 贴地色差片整体删除（wet/shade/fruit/quarry/vein 五 role、坡度拒绝 `sampleSlopeDeg`、点簇 `dots` 预计算与 `_gpStyles`/`_gpDot` 绘制全部移除）——detail 机制仅存 Wood foliage 小灌木 | 绘制（render_landscapes）、S4-03 遮挡避让（landscape-mask） |
| `js/landscape-mask.js` | ~415 | ★ S4-03（16 号文 §2.17）**景观遮罩与动态几何更新层** `window.LandscapeMask`：最终世界几何到达后的表现层确定性后处理——① 保护区三类：车道 = 实际曲线全段采样胶囊带（8 点粗估弧长 → 目标弦距 ≤10 细分、上限 `landscapeMaskLaneSamples`，弦差须小于留白余量；异常段退化为端点中点保守包围圆）、房屋 = 保守圆 `landscapeMaskHouseRadius`（前端无入口映射，按周边整体保护不猜门朝向）、POI = 操作区（max(底座半径, 图标世界尺寸 ~12) + `landscapeMaskPoiExtraRadius`，底座键复用 poiBase* 同源配置；**poiMarkerFootprintR 是深度辅助半径非视觉占地，严禁直接用作保护半径**——否则资源环内圈 rMin 22~24 会被整环误杀；连接路段/取水走廊由车道胶囊覆盖）；全部几何量**世界单位**，不涉显示像素。② 空间索引 = 世界网格分桶（`landscapeMaskBinSize`）+ 查询足迹相交桶再精确圆-圆/圆-线段测距，**严禁**每帧 accents × 全道路 × 全房屋扫描。③ 动态失效 = 字段签名脏桶：房屋/POI 集合签名逐实体 diff（建房/拆房/升级/营地升圈只动脏桶），车道按 `geom_version + 条数` 变化才逐条 diff（**磨损 wear 不入签名不触发**；geom_version 空跳逐条一致零重建）；`geomRev` 修订号驱动占据网格（可见景观子图元入桶 + 逐子图元预判 `child._masked`）与装饰判定缓存 `accent._lm`。④ 去重 = 来源优先级（可见景观 > 基础装饰），被保护区隐藏的子图元不参与去重。⑤ 失败处理：索引异常 → `hardReset` + 无景观降级（childHidden 恒 true / accentHidden 恒 false），**不使用旧世界索引**；`landscapeEnabled=false` 或 `landscapeMaskEnabled=false` → 休眠（判定恒 false，完整回退原画面）。**源数组保持不变**（只隐藏不移除）；`resetCache()` 与 AccentModel/LandscapeModel 同一生命周期。★ S4-04：`stockRole:'detail'` 子图元只做 `_masked` 预判、**不入占据桶**（其显隐随 q 逐帧变化而 geomRev 不变，入桶会让基础装饰被「当前不可见的细节」误去重）；`childHidden` 对 detail 照常生效 | 模型（landscape-model）、深度队列装饰段（render_depth_queue）、景观入队（render_landscapes） |
| `js/render_accents.js` | ~711 | ★ v1.50.23 TA-01：**装饰绘制层**——`drawAccentEntity`（分发；★ v1.50.39 起 GrassTuft 分发至 render_grass.js、★ TA-06-5 起 Bush 分发至 render_bush.js）/ `drawAccentTree` / `drawAccentBoulder` / `drawAccentRockCluster`，仍由 render_world.js 深度队列以 DEPTH_ACCENT 调度。★ **TA-07-4/6/7 收口**：判档一律走 `AccentLOD.tierFor`（本地 `accentDetailLevels()` 已删除）；中景只画 `segTier===0` 主枝、二级枝移入近景；远景取 `model.farClusters` 簇子集（**Pass A 仍单 path 并集**，禁退化成离散气泡）；`drawStoneBody` 增 `farSimplified` 入参（远景两笔：顶面 + 剪影描边）；RockCluster 远景只画主石（`model.stoneMain`）+ 碎石影随同略去；视口剔除改为**消费深度项的 AABB 与锚点屏幕坐标**（`drawAccentEntity(accent, it)`，第二参可选，缺省内部按 AccentLOD 自算）；簇级剔除补 x 判据。颜色/几何/画序/深度公式**零改动**★ v1.50.25 TA-03：局部三维坐标走与锚点同一套相机投影（含倾干剪切），枝干全年保留，叶簇按 `leafDensity`×`shed` 次序收缩隐藏（禁整冠透明度），簇间画家排序；细节分级近/中/远三档（config.render.js accentDetail*Px）；贴地投影随叶量调制；春芽按 budAmount 绘制。★ v1.50.27 漫画风两遍式树冠：叶簇**严禁**恢复「逐簇深色 rim 描边」（簇间叠压出深色分界线）——统一「Pass A 全簇单 path 冠影色合并剪影 + Pass B 逐簇基色 × 冠内体积明暗（下暗上亮、远暗近亮，基准取整副骨架）」，近景亮部（★ v1.50.40 TA-04-4 起改世界光向屏幕投影驱动，亮部回簇心规则见 lighting.js::sunScreenDirFull）。★ v1.50.31 D-B1-6：新增 `drawAccentRockCluster`（anchor 派生 2–5 颗子石，Boulder 三笔灰岩色板 + 簇内深度画家排序）与 `drawAccentGrassTuft`（3–6 根短草线，颜色由 `SimTreeTint` 按当前季节派生、不读存档 `tint`，冬季低矮枯草；★ v1.50.34 TA-11-3 起远景 LOD 省略阈值 `accentRockClusterLODMinRadius` 与冬季萎缩系数 `accentGrassTuftWinterHeightRatio` 走 `config.render.js`）；未知 kind 直接跳过 + 计数，开发模式（`sim.debugMode`）3s 限频报警，不得错画成 Bush。★ TA-04-2 世界光向受光经 `lighting.js::shadeRgbInto` 唯一公式入口接入；★ v1.50.39 TA-04-3 枝干圆柱侧面明暗——`cylinderShade()` 几何帮助函数（迎光/背光/朝屏三支世界法线 + 屏幕迎光方向，刮擦零分配；主干模型轴 (0,0,1)、剪切仅绘制层施加）+ 主干三色（朝屏体色/迎光带/背光带，带位由世界光向屏幕投影驱动、clip 防溢出）+ 枝条/茎逐段朝屏法线受光与迎光侧细高光；**严禁恢复 v1.49.3「固定屏幕左上」树皮亮线**（已移除）；明暗带 5 参数走 `config.render.js` accentBarkBand*；★ v1.50.40 TA-04-4 叶簇宽而弱亮部——近景簇亮部中心沿屏幕光向偏移（`_sunScr` 经 `SimLighting.sunScreenDirFullInto` 每实体刷新，光近视线平滑回簇心）、亮色经 `accentLitFill` 按簇法线点积着色（迎光亮/背光衰减，取代旧「只给上半冠」tZ 启发式）、椭圆 `0.55rr×0.42rr` 弱 alpha；**严禁恢复「屏幕固定位置」白椭圆高光与 `accentLeafPalette` 旧渐变色板**（均已移除）；亮部 5 参数走 `config.render.js` accentCrownLit*；★ v1.50.36 TA-11-4/5 芦草白穗季相（`grassSeasonColor` 纯函数：春芽→夏深→秋金→隆冬 `rgb(95,88,70)` 草叶不脱落、穗色随 litter 转干灰）与碎石群微接触落底阴影（簇群整片 + 逐石接触椭圆，先影后石；★ v1.60.1 接触影随 Canvas 通道删除）；★ v1.50.37 TA-11-6 渲染热路径零 GC——刮擦池（`_rockScratchPool`/`_crownScratchPool`；草叶池已随 GrassTuft 迁往 render_grass.js）+ `projTo` 复用点投影 + 稳定性插入排序 `_sortScratch`（n≤16 等深次序与 `Array.sort` 一致），稳态零逐帧堆分配。★ **TA-06-6 三乔木轮廓接入**：`drawAccentTree` 按 `model.species.silhouette` 落笔但**画序不分支**——阔冠/疏冠/锥形常绿的差异全部来自模型骨架；冠幅 `sk.crownR`、扁压 `sk.crownSquash`、倾干幅度 `sk.leanShearK` 一律读模型（§3.8 单一几何真相源）。★ v1.50.83 **石体 sink 分发（WebGL 迁移）**：`drawStoneBody` 与 RockCluster 接触阴影在 `WebGLStoneLayer.sinkOn` 时把与 Canvas 逐位相同的屏幕空间图元按同一画序分发给 stone-renderer.js（`accentLitFill` 的 `_litFinal` 数值色出口同源消费）。★ **v1.60.1 起 sink 硬门槛**：GL 层未就绪的帧**整只跳过绘制**（不再存在 Canvas else 分支——本文件内已零 `ctx` 引用）；**修改石体/装饰几何与配色时必须保持 sink 分发路径为唯一出口，严禁复活 Canvas 绘制分支** | 深度队列调度（render_world）、季相（accent-season）、GL 石体层（stone-renderer） |
| `js/render_bush.js` | ~256 | ★ TA-06-5 自 render_accents.js 迁出（守 §4.6 800 行上限）并接入 TA-06-7：**灌木绘制层**——`drawAccentBush`（三变体共用画序，`sk.crownR`/`sk.crownSquash` 读模型）+ `drawBushFlowers`（**花朵图元**：花位/花色来自模型 `skeleton.flowers` 构建期固定点，花量只决定可见点数 `round(K×flowerAmount)` 与 alpha、**绝不参与位置重抽**；低饱和三色板 `accentFlowerPalette`，**禁发光/禁径向渐变/禁高饱和**；走宿主簇法线 `accentLitFill` 单一受光入口；细节分级 = 中景及以上（`detailMid` 门槛）且花点屏半径 ≥ `accentFlowerMinPx`，远景整组省略（定稿 `accentFlowerDotRadiusK` **0.30** / `accentFlowerMinPx` **1.2**：方案建议 0.09/1.6 下花点恒低于落笔阈值、缩放 1~8 实测 0 点不可达，故上调））。复用 render_accents.js 模块级共享工具（`accentLitFill`/`cylinderShade`/`accentClusterVisibility`/`barkBandCfg`/`crownLitCfg`/`_crownScratchPool`/`_sortScratch`/`_ptA~_ptD`/`_ld`/`_sunScr`，经典脚本全局作用域）——★ TA-07 起判档改读 `window.AccentLOD`（`accentDetailLevels` 已删除），**必须晚于** render_accents.js、**早于** render_landscapes.js（后者的 `drawLandscapeChild` 分派 `drawAccentBush`）加载 | 深度队列调度（render_world）、季相（accent-season）、模型（accent-model） |
| `js/render_grass.js` | ~169 | ★ v1.50.39 自 render_accents.js 迁出（守 §4.6 800 行上限）：**GrassTuft 草丛绘制层**——`drawAccentGrassTuft`（3–6 根短草线 + 芦草变体穗状芦花）与季相色纯函数 `grassSeasonColor`（春芽→夏深→秋金→隆冬 `rgb(95,88,70)` 草叶不脱落、穗色随 litterAmount 转干灰；草丛本期**不在**世界光向受光范围，§6.5 保留季相短草线）。复用 render_accents.js 模块级共享工具（经典脚本顶层声明即全局）：`_shadowOffset`/`_sortScratch`/`_ptA~_ptD`；自带草叶池 `_grassScratchPool`/`_grassScratch`（零 GC 条目覆写）。★ v1.50.45 S7-03 高密草甸 LOD：远景草丛整丛省略阈值 `accentGrassTuftLODMinPx`（config.render.js，草叶屏幕长度不足即整丛跳过；平地草原全图 ~480 丛）。加载顺序紧随 render_accents.js | 深度队列调度（render_world）、季相（accent-season）、模型（accent-model） |
| `js/render_landscapes.js` | ~182 | ★ S4-02（16 号文 §2.16）**资源景观绘制接入层**：`collectLandscapes`（由 render_depth_queue.js::drawWorldEntities 在装饰段后调用——先 `LandscapeModel.sync(sim)`（静态签名变化才重建几何；遮罩层已在装饰段前同步，此处幂等兜底），被遮蔽子图元（`LandscapeMask.childHidden`，S4-03）先于预算跳过，再把子图元以 DEPTH_LANDSCAPE(13) 入队，深度口径与装饰一致走 `_decalDepth`；★ v1.60.1 起 `DEPTH_LANDSCAPE_SHADOW` 档与 `drawLandscapeShadowGround` 已删除——景观阴影由 GL 阴影图承担；`landscapeFrameChildBudget` 每帧入队硬上限、固定遍历序截断、★ TA-07 起视口剔除改走 `AccentLOD` 解析 AABB——**入队与绘制共用同一份**（旧「入队 + 绘制各写一遍 44/14 余量」已删））/ `drawLandscapeChild`（复用 render_accents/render_grass 既有图元与 SimTreeTint 季相，**不复制光照公式**；sink 硬门槛——GL 层未就绪的帧整只跳过）。子图元模型经 `AccentModel.getByKey('L#…')` 解析；未知 modelKind 跳过+计数（debug 限频报警）。**配置关态（`landscapeEnabled=false`）零入队零同步，完整回退原画面路径**；开关为纯渲染开关，严禁经 applyConfig 写模拟事实。★ S4-04：collect 增 `LandscapeModel.childActive` 过滤——`stockRole:'detail'` 可采细节（foliage 小灌木）按 q≥qThreshold 显隐（不入队不占预算，骨架恒可见）。★ v1.50.87：GroundPatch 贴地色差片绘制整体删除（`drawLandscapeGroundPatch`/`_gpStyles`/`_gpDot` 与 berry/gold/quarry/wet/shade 五 tone 全部移除；child._q 镜像随之删除）——资源景观仅剩立体子图元 | 配方/缓存（landscape-model）、遮罩（landscape-mask）、深度队列调度 |
| `js/webgl/layers/accents/accent-renderer.js` | ~460 | ★ v1.50.83 石体切片 → ★ v1.50.84 全装饰（原 stone-renderer.js 更名扩展）**装饰绘制 WebGL 层** `window.WebGLAccentRenderer`（实例 `window.WebGLAccentLayer`，render_canvas.js 与地形渲染器同点惰性创建）：Boulder/RockCluster/Tree/Bush/GrassTuft（含资源景观子图元、花朵/春芽）GPU 绘制。**几何与配色单一同源**——各绘制函数在 `sinkOn` 期间把与 Canvas 逐位相同的屏幕空间图元按同一画序分发（`quad`/`polyRing`/`ellipseRGBA`/`profileStroke`/`polyStroke`[miter 描边 + 平/圆头]/`ribbonQuad`[树干双曲线条带]），本层只做三角化 + 逐三角形解析式边缘 AA（重心坐标 × 每边像素距离，内部边旗标防接缝）；**深度测试开、深度写入关**——对 GL 地形读深度（锚点世界深度 + 1 世界单位朝相机偏置，NDC z 系数与 projection-utils sz=-0.0005 逐位一致），图元间保持画家收集序；★ v1.50.89 **图元级视深细化 `setViewDepth(dRel)`**——beginAccent 另存锚点视深 `_z0`，抬高图元（叶簇/枝条/花芽/茎/草叶）由绘制函数传自身 3D 视深相对增量（`projTo().d`，近端取大）+ 簇世界半径（`c.r × accent.scale` billboard 近端补偿）覆写：整株共享锚点深度在陡视角（rotX→1.45，cosX≈0.12）下会被锚点下前方更近地面整片裁掉叶簇下部（Canvas 无深度测试无此问题）；贴地图元（干/石/底环）保持锚点深度；只影响与地形遮挡，图元间仍画家序；`beginFrame/endFrame` 由 render_canvas.js 在 drawWorldEntities 前后调用。⚠️ 画风红线：本层**严禁**复制任何几何/光照公式；修改绘制函数时 sink 分发必须同步保持。**过渡边界**：装饰在底层 GL 画布、位于 2D 覆盖层之下 | 几何/配色（render_accents/bush/grass sink 分发）、GL 地形深度（terrain-renderer）、帧编排（render_canvas） |
| `js/webgl/layers/accents/shadow-pass.js` | ~460 | ★ v1.50.84 **阴影图层**（"WebGL 自带影子"替代全部自绘阴影）：`window.WebGLShadowPass`（实例，render_canvas.js 惰性创建；⚠️ **类走全局词法绑定，严禁 `window.WebGLShadowPass = 类`**——该 window 键专属实例，历史上 `?accentgl=0` 关态曾因误挂类对象导致存在性误判、每帧异常黑屏，开关虽已删除仍须遵守）：① 世界空间**代理几何**——Tree/Bush 冠簇椭球 + 干/枝/茎 4 棱柱 + Boulder/RockCluster 石棱柱 + ★ v1.50.94 GrassTuft 草丛棱柱簇与芦花椭球 + 花灌木开花点簇球（含资源景观子图元；模型/倾干剪切/坡度与绘制层同源，但形状为保守近似——代理只服务遮挡判定，不参与画面配色，不违反单一同源红线）。★ v1.50.91 同谓词过滤（accentHidden / childActive）；★ v1.50.92 严谨正交列主序矩阵 + `_prism` 顶底端盖与树干下沉扎地（0.5m 保底半径 0.35m 消除根部脱节与漏光）+ 冠簇随 leafDensity 平滑缩放至 0（叶落完全后树干与大枝阴影常驻地表）；★ v1.50.93 石体阴影补齐；★ v1.50.94 草丛代理（两段棱柱外弯+根部下沉0.25m凝聚核+芦花绒穗）+ 开花灌木花朵点簇代理 + 景观草丛放行，实现花草地表真实阴影；② 沿 SimLighting 世界光向渲染 2048² 深度图（**纯深度附件 FBO + drawBuffers NONE**——⚠️ ANGLE/D3D11 对「2048 深度 + 1×1 哑色附件」报 FRAMEBUFFER_UNSUPPORTED，实测踩坑；光向退化/仰角 <~11.5° 本帧禁用）；③ 缓存 = 双签名漂移重建（结构 s = 未遮蔽装饰数 ×31 + 景观版本 + 活跃子图元数，立即重建；季相 t = 落叶基准叶量 48 档平滑量化，限频 250ms 防高倍速逐帧重建）+ rustworld 生命周期 resetCache；④ terrain-renderer.js 地形片元采样阴影图（独立深度比较 + 4+1 tap PCF 平滑均值滤波）按 `accentWebglShadowStrength` 变暗——★ v1.60.1 起 Canvas 自绘贴地影/石群接触影/草丛接触影通道已删除，**阴影仅由阴影图承担**。**接收面仅 GL 地形**（2D 实体与装饰自身不接收，阶段四统一解决） | 代理模型（accent-model/landscape-model）、光向（SimLighting）、地形消费（terrain-renderer） |
| `js/label-layout.js` | ~780 | ★ S4-06/S4-07（16 号文 §2.18）**标签候选层与屏幕布局** `window.LabelLayout`：世界画布 10 处文字入口统一抽离为「提案 → 测量 → 矩形 → 优先级 → 固定备选位」布局层。帧内三段式挂载 render_depth_queue.js::drawWorldEntities——① beginFrame(w,h) 重置提案池/冲突网格/UI 矩形；② 收集阶段 proposePoiLabels（render_world.js）/proposeHouseLabels（render_world.js）/proposeAgentLabels（render_agents.js）逐实体提交候选（锚点 projectLifted + 类别）；③ list.sort() 后 resolve()：按 (优先级, 收集序) 稳定排序安置——**pinned**（实体锚定标记：POI 图标/施工🔨/流产🥀/夺位⚔️）恒接受占格不移位，**ordinary**（可省略文字：营地名称/舍数、拍卖🔨/修缮🔧/房屋编号）依次尝试 [首选→锚点镜像→首选同排右→首选同排左] 四个固定备选位（候选数有界 ≤4），屏幕网格冲突检测（labelGridCellSize 分桶 + 链表，非全对扫描）+ UI 禁入矩形（labelUiRectIds，labelUiRefreshFrames 帧节流重测 + resize 立即置脏），全败即省略。★ S4-07 聚合与交互兜底：低缩放（z ≤ labelClusterMaxZoom）或密集半径（labelClusterRadiusPx）下普通房屋编号 `KEY_HOUSE_NUM` 聚合成 `🏠 N舍` 数量徽标（`_buildClusters`/`drawClusters`），点击徽标弹出只读成员列表 `#label-cluster-popup`，项内提供定位/选中跳转；选中（Selected）与悬浮（Hovered）双目标强制保留（分别占位独立兜底），被 UI 遮挡或溢出边界时自动回落至左侧边缘提示槽位 `#label-fallback-dock` 并拉出虚线引线 `drawLeaderLines` 指向世界锚点；`_prevSlotMap` + `labelHysteresisPx` 有限布局滞回消除微抖动；`hitTest` 拾取查询（聚合徽标 > 已安置标签 > Canvas 原有欧氏距离拾取）；`syncFallbackDockDOM` 与 `openClusterPopup` 严格遵循 AGENTS.md §4.15 红线引入内容快照缓存，HTML 未变更绝不重写 innerHTML；`isPointInUi` 阻断穿透 UI 悬浮。绘制侧旧入口只消费 posOf(key)——普通标签仍在**实体深度**落笔，地形遮挡行为不变（山后标签不透山）；布局关态（labelLayoutEnabled=false）posOf 恒 false 完整回退 v1.50.51 旧直接绘制。**overlay 通道** overlayPlace()：选中族人需求气泡强制安置不省略、不参与地形遮挡，避开 UI 矩形与已接受矩形后钳制画布内。键位规划 = 实体 id×16 + 槽位（poi 0..3/house 4..6/agent 7..9，气泡 10） | 提案（render_world/render_agents/render_depth_queue）、绘制消费（render_world/render_agents）、点击拾取与悬浮联动（render_inspector/render_depth_queue） |
| `js/render_depth_queue.js` | ~510 | ★ v1.50.46 TA-04-6 前置自 render_world.js 拆分（守 §4.6 800 行上限 + 「入队和分发归队列层」单一职责）：**世界统一深度队列层**——DEPTH_* 常量、`_depthPool` 对象池（★ TA-07 新增 `ex/ey` 存锚点屏幕坐标，装饰/景观项复用 `s1x/s1y/s2x/s2y` 存屏幕 AABB；道路分段用法不变）、`_ownCellCenterDepth`/`_surfaceDepth`/`_decalDepth` 贴面/足迹感知深度、`MAP_Z_LIFT`/`projectLifted`、`drawWorldEntities()` 收集与远 → 近分发。★ **v1.60.1 地形入队退役**：地形格/侧壁/贴地投影的入队与分发已删除（`DEPTH_CELL`/`DEPTH_WALL`/`DEPTH_ACCENT_SHADOW`/`DEPTH_LANDSCAPE_SHADOW` 常量删除）——地形与侧壁遮挡由 GL 地形深度缓冲承担，队列内**保留**：非水面水系特征（RiverBank / ShallowFord / Cliff / 泉谷；★ v1.61.4 起 River / WaterBody 水面**不入队**——水面 = 粒子层）/ 水粒子 / 游鱼 / 道路 / 辖区连线 / POI 底座与标记 / 房屋 / 装饰 / 族人。★ v1.50.88 **车道静态几何缓存**（`_laneGeoCache` WeakMap，`window.LaneGeoCache` 暴露）：17 点世界采样 + 旋转键段深度缓存 + 屏幕 AABB 粗剔（`laneCullPadPx`）+ 屏幕弧长短车道自适应 8 段（`laneAdaptiveSegPx`）——`curve.evalPos`/`_decalDepth` 缓存命中后逐帧归零，车道绘制成本与车道数解耦（128x 倍速 612 车道 10fps 根因修复）。**各图元绘制逻辑不进本文件**。★ S4-06/S4-07：drawWorldEntities 帧首 updateEntityHover 实体悬浮检测（同步 sim.hoveredEntity）+ LabelLayout.beginFrame → POI/房屋/族人收集循环内同步提案（proposePoiLabels/proposeHouseLabels/proposeAgentLabels）→ list.sort() 前 resolve() 安置 → 分发循环结束后 drawSelectedNeedBubbleOverlay() 交互覆盖标签 → LabelLayout.drawClusters/drawLeaderLines/syncFallbackDockDOM 同步渲染与 DOM 停靠区 ★ **TA-07-6 入队前两级剔除**：装饰段在 `_decalDepth` **之前**先做一级粗剔（`AccentLOD.kindBounds` 保守常数，零模型访问 ⇒ 屏外个体不付 `AccentModel.get()`、不构建屏外骨架）再做二级精剔（模型真值 `bounds` AABB）。剔除总开关 `accentLODCullEnabled=false` 完整回退现状路径。分发签名 `drawAccentEntity(it.a, it)` / `drawLandscapeChild(it.a, it)`（★ v1.60.1 起阴影段分发签名已删） | 绘制入口（render_terrain/render_world/render_accents/render_grass/render_agents）、标签布局（label-layout） |
| `js/river_life.js` | ~286 | **★ v1.49.0 水系微观生态纯表现层**：`window.RiverLife`——`init(features, seed)`（世界重置/读档时由 rustworld.js 以 `_engineSeed` 重建，4 群 22 条游鱼沿河道中心线巡航）/ `update`（墙钟驱动，暂停时继续流动属设计决策）/ `drawFishSingle`（★ v1.50.86 起 WebGL sink 分发，★ v1.60.1 起 **sink 硬门槛**：GL 层未就绪的帧整条游鱼跳过绘制，文件内零 `ctx` 引用——水底影子 `ellipseRotRGBA` / 鱼身梭形 `ribbonQuad` / 背光高线 `polyStroke` 平头 / 两瓣尾鳍 `quad`，配色单一数值源 `FISH_PALETTES`）；★ v1.50.3 移除水面微波虚线、★ v1.50.4 移除水底卵石层（`drawRiverbed` 及卵石数据已删除）、★ v1.50.86 删除迎光面太阳波光（`drawSunGlint`/`drawGlintAt`/`centerPoints` 访问器与 `DEPTH_GLINT` 深度档一并删除）；在 render_terrain.js 之前加载 | 仿真状态读写、WorldRng 消耗、快照契约 |
| `js/water_particles.js` | ~190 | ★ **v1.62.0 水体粒子渲染层**（求解已上移到内核 `crates/sim_core/src/spatial/fluid/`，权威说明见 `docs/current/tech/33-runtime-fluid.md`）——本层只消费快照 `Fluid` section 的粒子位置（`rustWorldSim.fluidParticles`），逐粒子视觉抖动由「粒子下标 + 世界种子」稳定哈希派生（只算一次 ⇒ 稳态不闪、零堆分配），复用 v1.61.4 的观感常量（配色/透明度/每 5 粒亮点）与 sink 落笔路径；**v1.61.3 的前端流场构建 / 渠坐标积分 / 覆盖率折叠选活 / 墙钟累加器已全部删除，勿复活**。以下为历史沿革（已过时，仅供追溯）：`window.WaterParticles`——静态水体外轮廓只作为**场源**：河流取中心线断面表（河心/切向/半河宽/断面高程，倒坡整表倒序 ⇒ `u=0` 恒为上游），湖泊取到岸有符号距离场（扫描线填充 + 双向倒角距离，格距 1~6m、每体 ≤64×64 格，创世期一次）。`init(features,seed)` 用 `_engineSeed` 独立 PRNG 建场，粒子数由面积推导（河流 `area/2.2²`、湖泊 `area/3.0²`，单体上限 1500/1300、**全图预算 3600** 超限等比缩），粒径 = **实际间距 × 1.30** 自适应；`update(timeMs)` 墙钟累加器 + **固定 1/60 步长**（每帧 ≤4 步、长暂停丢弃积压）：河流在渠坐标系 `(u,q)` 积分（顺流速度松弛 × 断面坡度 + 横向回中弹簧 + 湍流 + `q=±1` 岸线反弹 + `u≥1` 回上游重生），湖泊世界坐标积分（出界硬回推 + 近岸软回推 + 慢漂移环流）；`coverage` 收窄展示域（`√coverage` 绕质心/河心）并**折叠选活**（河流从两岸退、湖泊从岸线退，粒子身份稳定不闪烁）；`drawParticle` 向 `WebGLAccentLayer` sink 分发压扁菱形（★ sink 硬门槛：GL 未就绪帧整帧跳过），逐粒子旋转/尺寸/透明度抖动打散栅格感；`stats()` 调试探针。**不写模拟状态、不消耗 WorldRng、不进存档**；入队端屏幕剔除在 render_depth_queue.js；★ v1.61.4 起为**水面唯一来源**（地表水格不承载水色、terrain-style 水格乘色与 2D 多边形水面绘制已删） | 模拟状态写入、WorldRng 消耗、快照契约 |
| `js/render_world.js` | ~510 | **世界图元绘制层**（v1.7.1 拆分；★ v1.50.46 TA-04-6 深度队列整块迁往 render_depth_queue.js——`drawWorldEntities` / DEPTH_* / `_surfaceDepth`·`_decalDepth` / `MAP_Z_LIFT`·`projectLifted` / `collectCampHouseLinks` 均已迁出，**严禁回迁**）。保留：`lightShadowOffset`（贴地阴影偏移 = 世界光向 → 屏幕投影，render_agents/render_accents 共享消费；★ v1.60.1 render_shadows.js 已删）/ `shadeHex`（立体面受光）/ `updateLaneHover`（道路悬浮检测 + Tooltip，★ v1.50.88 复用 `window.LaneGeoCache` 缓存世界采样内联投影零分配，缓存未命中回退旧 evalPos 路径）/ `cacheLaneStyle` + `drawLaneSegment`（道路样式缓存与单段描边）/ drawPoiGroundBase + drawPoiMarker（POI 底座/图标/门牌/储量环）/ drawHouse（私宅 2.5D 微缩模型，★ v1.48.0 面法线受光 + 世界空间阴影）/ drawCampHouseLink（辖区连线绘制）。★ S4-06：proposePoiLabels/proposeHouseLabels 提案函数 + drawPoiMarker/drawHouse 文字消费 posOf（未安置即省略；图标 pinned 确认登记）；三处 LOD 硬编码（POI 名称 z>0.50/库存环 z≥0.70/房屋编号 z>1.05）收进 config.render.js labelPoiNameMinZoom/labelStockRingMinZoom/labelHouseNumberMinZoom；houseHalfW/HalfH 与标签提案共用同一套 tier 视觉几何 | 共享状态（在 render_canvas）、HUD（在 render_hud）、深度队列（render_depth_queue.js）、标签布局（label-layout.js） |
| `js/render_agents.js` | ~290 | **族人绘制**（v1.7.1 拆分）：**★ v1.47.9 drawAgent（单实体绘制入口，由 `drawWorldEntities` 统一深度调度）** + 选中高亮 + 墓石。★ S4-06：proposeAgentLabels 提案（施工🔨/流产🥀/夺位⚔️ pinned + 选中目标捕获）+ 三角标绘制消费 posOf；选中需求气泡自 drawAgent 迁出为 **drawSelectedNeedBubbleOverlay**（深度队列分发循环结束后调用，overlayPlace 强制安置避开 UI 覆盖区，关态回退旧固定位置） | 共享状态（在 render_canvas）、绘制调度（在 render_world 的 drawWorldEntities）、标签布局（label-layout.js） |
| `js/inspector-shared.js` | ~55 | ★ v1.60.1 Inspector 共享帮助层：`_meterRateTracker` 进度速率追踪（悬停展示每小时变化）/ `_fmtRate` / `_gameDt` / `poiRegenMultiplier`·`effectiveRegenRate`（POI 卡片与生态大盘滑块共用产速口径） | DOM 面板渲染（在 inspector-* 各面板） |
| `js/inspector-hormone.js` | ~147 | ★ H-06 激素观察面板与趋势采样器：`HORMONE_DEFS` 四轴十一激素定义（与 snapshot 顺序严格一致）/ `window.HormoneTrend`（tick 差分趋势，rustworld 世界生命周期 reset）/ `_ensureHormoneRows` 惰性构建 / `updateHormonePanel`（面板 DOM 位于族谱模态，逐帧数据驱动） | 模态开关（归 dag.js）、行为结算（在 hormones.rs） |
| `js/inspector-agent.js` | ~563 | 族人 Inspector 面板：`updateAgentInspector(selAgent, views)`——状态机中文文案/年龄性别/威望徽章/马斯洛卡/M19 决策任务卡/2x2 生存指标/随身行囊/调试计数/搬运去向/传送按钮/冷却与怀孕 | 视图切换与选中解析（在 render_inspector.js 调度层）、血脉族谱（在 inspector-lineage.js） |
| `js/inspector-house.js` | ~226 | 房屋 Inspector 面板：`updateHouseInspector(house, views)`——等级标题/耐久速率/家庭储备/生育徽章/户主追踪/拍卖状态与档案/修建者确权 | 视图切换（在 render_inspector.js）、拍卖撮合（在 auction-ui.js） |
| `js/inspector-poi.js` | ~305 | POI Inspector 面板：`updatePoiInspector(poi, views)`——储量条/榷场三槽价签与产速/营地晋升进度/国王与国库/交易流水/描述文案 | 视图切换（在 render_inspector.js）、辖区详情模态（在 camp-detail.js） |
| `js/inspector-lineage.js` | ~211 | 血脉与世系族谱子层：`updateAgentLineage(selAgent)`——父/母/配偶/私宅/子嗣 chips（content-snapshot 缓存防高频重建）+ 威望值 + 族谱模态 self 卡片与先天禀赋 | 族谱模态开关（在 dag.js）、实体跳转委托（在 main.js/entity-link.js） |
| `js/render_inspector.js` | ~160 | **Inspector 调度层**（v1.60.1 自 1860 行拆出 7 文件）：updateInspector 三视图分发（house/poi/agent 传 views 对象）+ 智能点击拾取事件监听器（排除拖拽平移，★ S4-07 优先命中 LabelLayout.hitTest 聚合徽标/已安置标签，未命中回退原有 agent->house->poi 欧氏距离与循环切换） | 面板内容渲染（在 inspector-* 各面板）、wasm 交互（在 rustworld.js）、标签布局（label-layout.js） |
| `js/camp-detail.js` | ~218 | ★ v1.12.0 营地辖区详情模态：`renderCampDetail`（国王/继承人/历史国王/管辖家庭/辖区房屋/王国账本）+ `window._campDetailTick`（每帧刷新）/`window.closeCampDetail`/`window.isCampDetailOpen` + 按钮/国王 chip/Esc/背板点击事件绑定 | POI 选中状态（在 rustworld.js）、渲染调度（render_canvas.js 消费 _campDetailTick） |
| `js/main.js` | ~886 | 全局初始化 / 相机控制（缩放/平移/跟随）/ 事件绑定（点击拾取/快捷键 Space/Esc/重置按钮/倍速切换）/ 控制台日志 / 无头模式切换 / **★ v1.27.0 启动即暂停**（`sim.isPaused=true`，由 save-ui.js 完成存档连接后解除）/ **★ v1.60.1 WebGL 硬门槛**：WebGL 不可用时显示错误覆盖层并阻断启动（`?webgl=0` / `RENDER_CONFIG.useWebgl` 开关已删） | Canvas 绘制（在 render.js）、wasm 交互（在 rustworld.js） |
| `js/entity-link.js` | — | **统一 Agent/房屋实体跳转**：生成实体链接并以唯一捕获阶段委托路由到世界 Inspector | 业务卡片数据、Canvas 绘制 |
| `js/save-ui.js` | ~630 | **读档/存档系统 UI**（v1.11.0）：三槽位（自动槽每 60s 覆盖 + 手动槽 1/2）localStorage 读写、槽位元信息索引、顶栏「💾 存档/📂 读档」面板（保存/读取双标签）、导出 Blob 下载 / 导入 FileReader 校验、读档后自动暂停；**v1.11.0 新增本地文件存档**（File System Access API）：用户连接本地 .json 文件后存档直写磁盘、自动保存同步切换本地模式、不支持浏览器降级到传统导入导出；**★ v1.27.0 启动存档文件门禁**（`bootstrapStartupGate`）：启动层必须先建立/连接可写 `.json` 存档文件（格式版本匹配）才解除模拟暂停，Firefox 等不兼容浏览器保持阻断；**★ v1.28.0 启动自动读档**：已连接自动槽（默认目录 + 默认文件名 `flowaccord-save1.json`，句柄经 IndexedDB 恢复）时打开游戏直接读取其内容续演，读取失败回退手动连接；**★ v1.28.1 权限重授加固**：句柄权限未持久化时不再自动断开/删除 IndexedDB 记录——启动门禁先静默重授（授权已持久化立即成功），失败提供「授权并读取上次存档」按钮（用户手势内 requestPermission），保存/读取遇 NotAllowedError 就地重授重试；**★ v1.50.8 `?nogate=1` 门禁旁路**：URL 携带 `nogate` query 参数（任意值）时直接隐藏门禁并解除暂停，不连接存档（自动保存对空句柄 no-op，仅内存演算，供截图/演示/自动化场景） | 存档正文序列化（在 rustworld.js + 内核 `world_save.rs`） |
| `js/auction-ui.js` | ~793 | **房屋拍卖交易所与竞价大盘 UI**（v1.15.0）：`#house-auction-modal` 视窗交互 / `_auctionUiTick` 每帧高频驱动 / 麦穗 37% 动态时间轴标尺与当前耐久指针 / 辖区意向买家池扫描 / 实时竞价信息流与裁决 / 历史成交档案 / 视口与族人定位聚焦 / ★ v1.27.0 状态徽章流拍率统计 + 在售房源条固定节点增量更新（内容快照缓存，高倍速点击稳定） | Canvas 绘制（在 render_world） |
| `js/ta06-acceptance.js` | ~360 | ★ v1.52.1 **植被观察台**（TA-06 验收通过后转为长期调试工具；懒初始化：`#debug-hud` 调试监视器内「🌿 植被观察台」按钮（需先勾选调试模式）或 URL `?ta06=1` 激活；未打开时仅注册 `window.__vegPanelToggle`，零 DOM 零 rAF 零帧循环）：左上浮动面板（季节锁定 自动/春/夏/秋/冬 · 光向 0/90/180/270 + 动态光联动 · 相机 rotZ 四方位 / rotX 三档 / 缩放 0.6~6 · 7 株样板一键飞往 · 物种标注层开关 · 4Hz 读数行）；`REPS` 七株身份表（seed 42，全部 `LandscapeMask.accentHidden=false` 复核：阔冠#3/疏冠#22/锥形#8/多茎#67/花灌#72[春花朵首选]/花灌#80[粉花]/低矮常绿#74）；`findVisibleRep()` 运行时遮罩兜底（身份株被遮罩时自动改飞同变体最近未遮罩株）；标签层 `accentHidden` 过滤 + zoom<0.8 淡出 + 视口外隐藏。**必须晚于 auction-ui.js 加载**（最后一位，独立调试模态，不参与生产渲染管线） | 无（纯调试 UI，不消费渲染管线） |

### 1.4 族谱系统（四件套，独立标签页）

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/dag-layout.js` | ~362 | 族谱时间轴布局数学（**纯函数，零 DOM**）：Y=出生 tick 线性映射（亲子最小间距约束密度下限）/ X 冲突横向扩展 / 视口虚拟化 LOD / 时间刻度尺计算 | Canvas 渲染、数据构建 |
| `js/dag-view.js` | ~458 | 族谱 Canvas 虚拟化渲染 + pan/zoom + LOD + 刻度尺绘制 + 节点点击 | 布局计算（委托给 layout）、数据来源 |
| `js/dag-standalone.js` | ~284 | 族谱独立新标签页的 HTML 模板生成 + `window.open` 编排 | 主页面内的族谱模态 |
| `js/dag.js` | ~306 | 族谱数据构建（从 rustworld.agentArchive 生成血脉图）+ 模态框编排 + Inspector 联动 + 先祖档案库穿梭 | 布局数学（layout）、渲染（view） |

### 1.5 制度大盘层

| 文件 | 行数 | 职责 | 不负责 |
|---|---|---|---|
| `js/ledger-ui.js` | ~818 | 社会与经济制度大盘：**四标签页**（家户 household / 婚姻 marriage / 宗族 clan / 王国 region）/ 标签切换 `switchTab` / 每家户账本余额展示 / 流水穿透抽屉 / 族长/国王顺位展示 / 公仓/族库余额 / 格式化工具函数（tickToSec / agentName / balTotal） | Canvas 渲染、wasm 交互、族人 Inspector |

### 1.6 基础设施

| 文件 | 行数 | 职责 |
|---|---|---|
| `server.js` | ~122 | 静态文件开发服务器（内置 `.wasm` MIME = application/wasm）/ `POST /save-decision-order` 端点（★ v1.27.0 起仅保留兼容迁移，决策顺序保存主路径已迁至浏览器 localStorage）/ 默认 3004 端口 |
| `index.html` | ~900 行 | 单页应用骨架：Canvas 容器 / 顶栏（含存档按钮） / Inspector / 制度大盘 / 决策引擎覆层 / 存档面板 / 族谱模态 / **★ v1.27.0 启动存档门禁层 `#startup-save-gate`**（v1.28.0 起已连接默认存档时自动读档续演；v1.28.1 起权限未持久化不删记录、提供授权按钮重授）/ 48 个 script 标签按序加载（★ M4 含 `js/snapshot-bin.js`；★ v1.60.1 terrain-texture/terrain-mesh-merge/render_shadows/fallback-handler/test-grid 五个 script 标签已删） |
| `style.css` | — | 全局样式（顶栏/Inspector/大盘/决策视图/族谱/调试器） |
| `rust/sim_wasm.wasm` | — | WASM 编译产物**主副本**（rustworld.js 实际 fetch 的路径） |
| `sim_wasm.wasm` | — | WASM 编译产物**根目录备用副本** |

### 1.7 独立页面（地图图鉴，★ v1.50.0）

| 文件 | 行数 | 职责 |
|---|---|---|
| `map.html` / `map.css` | ~70 / ~75 | **独立只读地图页**：将正式游戏地形渲染嵌入 `?mapOnly=1&nogate=1` 模式；地图页自身不创建实体、不读写存档，叠加种子控件、当前地形类型展示与说明，并可选只读断层/褶皱诊断 recipe。 |
| `js/map-view.js` | ~155 | 地图图鉴编排脚本：把种子/profile 更新为 `index.html?seed=<n>&mapOnly=1&nogate=1` 内嵌页，根据种子确定性预测并与引擎首帧回传同步展示当前地形类型名称；普通地图可同步「在正式游戏中使用此种子」链接，构造演示只允许只读预览。 |

**同种子契约**：`mapOnly=1` 经 `rustworld.js → sim_worker.js → sim_wasm::world_create_map` 调用与正式游戏相同的 `World3DEngine::new_seeded_with_config` / `TerrainMap::generate_with_config`；但不调用 `seed_primitive_ecology`，故地图页只含地形、水系和自然装饰，绝不能自行实现哈希噪声或模板绘制。`fault_scarp_demo_v1` 与 `folded_basin_demo_v1` 是地图图鉴专用诊断 recipe：只通过明确的 `terrainProfile` 查询参数选择，不加入正式 `random` 池或存档白名单，且不得用「正式游戏使用此种子」链接启动。

---

## 二、脚本加载顺序（index.html，勿打乱）

```
1. math.js                    零依赖基础（含 computeTerrainAlbedo 反照率/光照分解）
2. config.js                  SIM_CONFIG (369 字段，含拆分配置合计)
3. config.poi-rates.js        localStorage POI 产速偏好（创世前读取）
4. config.decision-order.js   SIM_DECISION_ORDER (合并进 SIM_CONFIG)
5. config.house-upgrade-cost.js SIM_HOUSE_UPGRADE_COST (M8 升级成本矩阵 20 字段，applyConfig 时合并)
6. config.lighting.js         ★ v1.48.0 SIM_LIGHTING 动态季节光照前端配置（纯表现层，不注入 WASM）
7. config.render.js           ★ v1.50.15 RENDER_CONFIG 渲染表现层参数（视觉抬升/足迹深度半径，须早于 render_world.js）
7b. terrain-style.js          ★ TB-03-11 景观风格样式表（window.TerrainStyle：profile→基调白名单 + 世界 seed 固定盐选型 + 逐 SurfaceKind 反照率乘色，math.js::computeTerrainAlbedo 末尾消费；纯表现层，样式开关物理零变化；READY 激活 / LOAD_RESULT 回中性；★ v1.61.4 起 volcanic_blue 水格乘色删除——水面由粒子承担）
8. lighting.js                ★ v1.48.0 年周期光弧引擎 SimLighting（须早于 rustworld.js 与渲染六件套）
9. decision-viz-data.js       分支元数据
10. decision-viz-view.js      决策视图 DOM 渲染
11. decision-viz.js           集成层: mergeIntoSimConfig() ← 此时 SIM_CONFIG 才完整
12. snapshot-bin.js           ★ M4 FABS 二进制快照解码器（必须在 rustworld.js 之前）
13. rustworld.js              构造时读取 SIM_CONFIG 并 applyConfig ← 必须在配置、决策三件套及 snapshot-bin 之后
14. webgl/core/context.js     ★ WebGL 块六件（14-19）：context / shader-manager /
15. webgl/core/shader-manager.js   projection-utils / terrain-renderer / accent-renderer /
16. webgl/utils/projection-utils.js shadow-pass；★ v1.60.1 起块内无 fallback-handler /
17. webgl/layers/terrain/terrain-renderer.js   render-canvas-patch / test-grid
18. webgl/layers/accents/accent-renderer.js
19. webgl/layers/accents/shadow-pass.js
20. dag-layout.js             族谱布局数学
21. dag-view.js               族谱渲染
22. dag-standalone.js         族谱独立页模板
23. dag.js                    族谱数据构建+编排
24. main.js                   事件绑定+初始化（★ v1.60.1 WebGL 硬门槛：不可用即错误覆盖层阻断启动）
25. entity-link.js            统一实体跳转（依赖 main.js）
26. ledger-ui.js              制度大盘
27. save-ui.js                读档/存档系统（v1.8.0）← 依赖 main.js 暴露的 window.rustWorldSim
28. render_canvas.js          Canvas 主循环调度（v1.7.1 拆分）
29. river_life.js             水系微观生态纯表现层（★ v1.49.0，须早于 render_terrain.js）
29b. water_particles.js      ★ v1.61.3 水体粒子运动模拟引擎（建场/固定步长积分/折叠选活；须早于 render_depth_queue.js）
30. accent-season.js          ★ v1.50.23 TA-01 装饰季相层（window.SimTreeTint 唯一生产者）
31. accent-model.js           ★ v1.50.23 TA-01 装饰模型层（window.AccentModel 缓存，须早于 render_accents.js）
31b. accent-lod.js            ★ TA-07-2 装饰细节分级 LOD 集中解析层（window.AccentLOD；依赖 RENDER_CONFIG，
                              函数体内运行时解析 AccentModel；须早于 render_accents/render_bush/render_grass/
                              render_landscapes/render_depth_queue 全部消费点）
32. landscape-model.js        ★ S4-02 资源景观模型层（window.LandscapeModel 配方/组缓存，须早于 landscape-mask.js / render_landscapes.js）
33. landscape-mask.js         ★ S4-03 景观遮罩层（window.LandscapeMask 保护区/分桶/脏桶失效，依赖 LandscapeModel）
34. render_terrain.js         调试网格/非水面水系特征（★ v1.60.1 起 Canvas 地形格/天空/侧壁绘制已删，地形在 17 号 GL 层；★ v1.61.4 起无任何水面多边形填充——水面 = 粒子层）
35. render_accents.js         ★ v1.50.23 TA-01 装饰绘制层（drawAccentEntity 分发 + Tree/Boulder/RockCluster，早于 render_world.js）
35b. render_bush.js           ★ TA-06-5 灌木绘制层（drawAccentBush + 花朵图元，自 render_accents.js 迁出；须晚于 render_accents.js、早于 render_landscapes.js）
36. render_grass.js           ★ v1.50.39 GrassTuft 草丛绘制（自 render_accents.js 迁出，紧随其后加载）
37. render_landscapes.js      ★ S4-02 资源景观绘制接入层（子图元入统一深度队列，紧随 render_grass.js；★ v1.60.1 原 30 号 render_shadows.js 已删除）
37a. label-layout.js          ★ S4-06/S4-07 标签布局层（window.LabelLayout，普通标签聚合/双目标兜底/避障布局，须早于 render_depth_queue.js / render_world.js / render_agents.js）
38. render_hud.js             HUD/大盘辅助函数（v1.7.1 拆分）
39. render_depth_queue.js     ★ v1.50.46 TA-04-6 世界统一深度队列层（自 render_world.js 拆出，早于 render_world.js）
40. render_world.js           路网/POI/房屋绘制 + lightShadowOffset/shadeHex（★ v1.50.46 深度队列迁出）
41. render_agents.js          族人绘制（v1.7.1 拆分）
42. inspector-shared.js        ★ v1.60.1 Inspector 共享计量/产速帮助层（_meterRateTracker/_fmtRate/_gameDt/poiRegenMultiplier/effectiveRegenRate，须早于 inspector 各面板）
43. inspector-hormone.js       ★ H-06 激素观察面板与趋势采样器（window.HormoneTrend，rustworld 世界生命周期 reset）
44. inspector-agent.js         族人 Inspector 面板（状态机文案/马斯洛卡/M19 任务卡/生存指标/行囊/冷却怀孕）
45. inspector-house.js         房屋 Inspector 面板（耐久/家庭储备/拍卖档案）
46. inspector-poi.js           POI Inspector 面板（储量/榷场三槽/营地晋升/王国国库）
47. inspector-lineage.js       血脉与世系族谱子层（父子配偶子嗣 chips + 族谱模态 self 卡片 + 禀赋）
48. render_inspector.js        Inspector 调度层 + 智能点击拾取（v1.60.1 自 1860 行拆出 7 文件）
49. camp-detail.js             ★ v1.12.0 营地辖区详情模态（window._campDetailTick/closeCampDetail/isCampDetailOpen）
50. auction-ui.js             拍卖大盘（最后加载，独立模态）
51. ta06-acceptance.js      ★ v1.52.1 植被观察台（控制台按钮或 ?ta06=1 激活；未打开零影响，最后加载）
```

**关键约束**：
- 配置/视图准备文件（3-11：config.poi-rates.js、config.decision-order.js、config.house-upgrade-cost.js、config.lighting.js、lighting.js + 决策三件套）必须在 `rustworld.js`（13）之前——否则创世没有持久 POI 产速，或 WASM 注入的是不含决策顺序/升级成本矩阵的不完整配置
- ★ M4 `snapshot-bin.js`（12）必须在 `rustworld.js`（13）之前——否则 READY 首个二进制快照无法解码
- ★ v1.48.0 `config.lighting.js`（6）与 `lighting.js`（8）必须早于 `rustworld.js`——`_applySnapshot` 建地形缓存时会调用 `SimLighting.markDirty()`，缺失则首帧不重着色
- 改拆分配置 JS（新增全局对象）必须同步：`rustworld.js::applyConfig` 合并逻辑、`tools/config-check.js` 前端字段集、`tools/test-wasm.js` 注入
- **`save-ui.js`（27）必须在 `main.js`（24）之后**——它读取 `window.rustWorldSim`（main.js 挂载）调用 `saveWorld()/loadWorld()`
- **渲染系列（28-51）最后加载**，`render_canvas.js` 的 `render(now)` 主循环依赖 `window.rustWorld`、`window.dag`、`window.ledgerUI` 等全局对象；共享全局作用域，函数声明可提升，加载顺序为 canvas→river_life→accent-season→accent-model→landscape-model→landscape-mask→terrain→accents→bush→grass→landscapes→hud→depth_queue→world→agents→inspector-shared→inspector-hormone→inspector-agent/house/poi/lineage→inspector 调度→camp-detail
- ★ v1.50.84 `webgl/layers/accents/accent-renderer.js` + `shadow-pass.js` 注册于 index.html WebGL 块（14-19，rustworld.js 之后、dag 块之前）；实例在 render_canvas.js 与 `TerrainWebGLRenderer` 同点惰性创建，`beginFrame/endFrame` 夹住 `drawWorldEntities()`，阴影图先于地形渲染更新——★ v1.60.1 起 GL 层未就绪的帧装饰**整只跳过**（Canvas 备用分支已删），WebGL 整体不可用时 main.js 错误覆盖层阻断启动

---

## 三、数据流与渲染管线

```
WASM 内核 (sim_wasm.wasm)
    │  world_tick(dt) 每帧调用
    ▼
★ M4 FABS 二进制帧（sim_worker.js slice + transfer；wasm 无导出则回退 JSON）
    │  SnapshotBin.decode()（snapshot-bin.js）
    ▼
rustworld.js::_applySnapshot(snap)
    │  映射为 JS 对象（车道/节点按 geom_version 缓存，仅覆写 wear）
    ├─→ this.agents[] / this.houses[] / this.pois[]
    ├─→ this.households[] / this.marriages[] / this.clans[] / this.regions[]
    ├─→ this.network { lanes: Map, nodes: Map }
    ├─→ this.terrain { cells: [] }
    └─→ this.agentArchive (Map, 全量生命周期档案含已故先祖)
         │
         ├─→ render.js::render(now)     Canvas 绘制（地形/路网/POI/房屋/族人/轨迹）
         ├─→ render.js::updateTopBarStats()  顶栏统计（人口/出生/死亡/季节/温度）
         ├─→ render.js::updateDebugHud()     调试监视器（Tick/FPS/CPU/内存/WASM内存）
         ├─→ render.js::Inspector            选中族人/房屋/POI 的详情面板
         ├─→ render.js::updateGlobalAverages()  全局均值大盘（饱食/水分/体力/行囊）
         ├─→ ledger-ui.js::switchTab/render      制度大盘四标签页（家户账本面板亦由此处接管）
         ├─→ decision-viz-view.js                 决策引擎覆层（实时监控选中 agent 的决策链）
         └─→ dag.js / dag-view.js                 族谱时间轴（从 agentArchive 构建）

main.js::事件绑定
    ├─ 鼠标点击 → 拾取族人/房屋/POI → 更新选中态 → render.js 重绘 Inspector
    ├─ 滚轮/右键拖拽 → 相机缩放/平移 → render.js 下帧生效
    ├─ Space → 暂停/继续 → rustWorld.isPaused
    ├─ Esc → 关闭 Inspector → 同时关闭镜头跟随 (根 AGENTS.md §4.8)
    └─ 重置按钮 → rustWorld.reset() → 重新播撒 20 名族人
```

---

## 四、DOM ID 共享契约

以下 DOM ID 被多个 JS 文件共享，**改 ID 必须全量搜索替换**：

| DOM ID 前缀 | 消费方 | 用途 |
|---|---|---|
| `agent-inspector-*` | render.js / main.js | 族人 Inspector 面板各字段 |
| `house-inspector-*` | render.js / main.js | 房屋 Inspector 面板 |
| `poi-inspector-*` | render.js / main.js | POI 弹窗面板 |
| `tab-*-content` | ledger-ui.js | 制度大盘四标签页内容容器（household/marriage/clan/region） |
| `.ledger-tab-btn` | ledger-ui.js / style.css | 标签页切换按钮 |
| `dv-*` / `.dviz-*` | decision-viz-view.js / decision-viz.js / style.css | 决策引擎覆层元素 |
| `dag-*` | dag.js / dag-view.js / dag-standalone.js / style.css | 族谱模态与独立页 |
| `debug-*` | render_hud.js / main.js | 调试监视器字段 |
| `save-*` / `.save-slot-*` / `.save-tab-btn` | save-ui.js / index.html / style.css | 存档面板与槽位卡片（v1.8.0） |
| `btn-pause` | main.js / save-ui.js | 暂停按钮（`togglePause()` 改文案，save-ui 读档后同步置为「▶️ 继续模拟」） |
| `chk-dynamic-light` | main.js / index.html / style.css | ★ v1.48.0 动态季节光照开关（`L` 键同源触发，`change` 事件热切换） |
| `stat-sun` | render_hud.js / index.html | ★ v1.48.0 当前光位读数（方位 + 高度角） |
| `dbg-light-phase` | render_hud.js / index.html | ★ v1.48.0 光相/光档调试读数（★ v1.60.1 重着色耗时读数 `dbg-light-ms` 随 CPU 烘焙删除；`dbg-terrain-faces` 面数读数随地形格 Canvas 通道删除） |
| `version-tag` | index.html | 版本徽章 · **版本号唯一真相源**（由 `node tools/bump-version.js --patch` 自动同步至 SAVE_APP_VERSION 等全部定义点，勿手工改） |

**搜索方法**：改 ID 前用 `grep -r "旧ID" frontend/` 确认所有引用点。

---

## 五、局部易踩坑

### 5.1 render.js 已拆分为 5 个文件（v1.7.1）· v1.48.0 再拆出 render_terrain.js

render.js 原 2128 行（800 行规范的 2.6 倍），v1.7.1 拆分为 5 个文件，单文件均 <800 行：
- `render_canvas.js`（~226 行）：共享状态 + 主循环调度骨架
- `render_hud.js`（~490 行）：HUD/调试/资源大盘/均值大盘/账本面板
- `render_world.js`（~480 行）：地形/路网/POI/房屋绘制
- `render_agents.js`（~210 行）：族人绘制 + 夺位远征动态标牌
- `render_inspector.js`（~790 行）：Inspector 面板 + 点击拾取

**拆分方法**：所有内容在全局作用域，函数声明可提升，多 script 标签共享全局作用域。`render(now)` 主循环保留在 `render_canvas.js` 作为调度骨架，调用其他文件中的绘制函数。

**改"族人渲染"只需读 `render_agents.js`**，改"地形/路网"只需读 `render_world.js`，不用在 2100 行里翻。原 render.js 备份为 `render.js.bak`。

可拆分候选：
- `render_canvas.js`：Canvas 上下文管理 + `render(now)` 主循环骨架 + 视口变换
- `render_world.js`：地形/路网/POI/房屋绘制
- `render_agents.js`：族人绘制 + 选中高亮 + 轨迹 + 状态气泡
- `render_inspector.js`：Inspector 面板 DOM 更新（族人/房屋/POI）
- `render_hud.js`：顶栏统计 + 调试监视器 + 全局均值大盘 + 账本面板

拆分时保持 `render(now)` 作为入口函数，内部调用各子模块的绘制函数。全局对象 `window.render` 或直接函数挂载需保持兼容。

### 5.2 快照四处同步（★ M4 起；根 AGENTS.md §4.5）

给 agent/house/poi 新增快照字段时，必须 **★ M4 起四处同步**：
1. `crates/sim_core/src/spatial/snapshot.rs` — 结构体定义
2. `crates/sim_core/src/spatial/world_snapshot.rs` — `generate_snapshot()` 赋值（★ T1 起为 test-only 真值通道）
3. `crates/sim_core/src/spatial/snapshot_bin/encode.rs` — `write_snapshot_binary()`（M4 FABS 二进制编码，字段顺序/码位须与 1、2 等价）
4. `frontend/js/snapshot-bin.js`（解码）+ `frontend/js/rustworld.js`（`_applySnapshot()` 映射）

**前端消费方**可能还包括 render.js / ledger-ui.js / decision-viz-view.js / dag.js，需同步更新读取逻辑。

遗漏任何一处都会导致前端 `undefined` 或展示旧值；JSON 对拍门禁已随 JSON 快照通道移除（v1.50.33），同步核对走 `node tools/snapshot-check.js` + `test-wasm.js` / `test-determinism.js`。

> ★ M4 相关派生缓存：`snapshot-bin.js` 维护跨帧字符串驻留缓存（引擎重建/读档/重置时必须调用 `SnapshotBin.resetCaches()`，rustworld 已在 READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 处理器调用）；**★ v1.46.0 起解码器自身也用 `STR_TAB.start_index == 0` 判「全新驻留表」自动清缓存**——判据**不能**用 `strtab_epoch`（新世界恒为 0，会导致换世界后 id→字符串串味，见根 AGENTS.md §4.5.1）；`rustworld.js` 维护车道/节点几何缓存（`_laneCache`/`_geomVersion`），增量帧（`snap.lanes===null`）只覆写 `wear`。**★ v1.50.33 D-B1-7**：静态地形三通道（features/accents/subFeatures）缓存与地形网格缓存（`_terrainCached`）拆分——增量帧三通道为 `null`（未发送）一律保留旧值、明确静态帧（数组，可为空）整组替换；静态数据与 `AccentModel` 模型缓存（★ S4-02 起含 `LandscapeModel` 资源景观组缓存，★ S4-03 起含 `LandscapeMask` 保护区索引与占据网格）由 `_invalidateWorldStaticCaches()` 随 READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 消息生命周期失效（`STR_TAB.start_index==0` 判据仅管字符串驻留表，不替代世界生命周期处理，契约见 docs/plan/tech/06-terrain-templates.md §18.4）。

### 5.3 配置热注入的时序

`rustWorld.applyConfig(cfg)` 支持运行中热注入，但有两个约束：
1. **必须在 wasm 加载完成后**（`this._ready === true`），否则静默返回 false
2. **决策顺序变更**须先改 `SIM_CONFIG.decisionEvalOrder` / `decisionEvalLevels`，再调 `applyConfig`，最后保存到浏览器 localStorage（★ v1.27.0 起；decision-viz.js 已封装此链路，★ v1.29.0 起键 `flowaccord.decision-order.v2`）

直接改 `rustWorld.config` 无效——配置只通过 `applyConfig` 序列化注入 wasm。

### 5.4 agentArchive 全量档案库

`rustWorld.agentArchive: Map<agentId, AgentSnapshot>` 保存**所有出生过的族人**（含已故先祖），用于：
- 族谱系统（dag.js）构建血脉图，不依赖当前存活 agents
- 断代/绝嗣穿梭时不跳帧
- 死亡族人的 Inspector 回溯

**新增 agent 字段时**，除了快照四处同步，还须确认 `agentArchive` 的写入逻辑（在 `_applySnapshot` 中）是否正确归档新字段。

**v1.8.7 墓碑补记**：`_applySnapshot` 消费 `snap.recent_deaths`（死亡/流产墓碑，`_consumedDeathIds` 幂等去重，`initEcology`/`loadWorld` 时清空）——①对档案库滞留"存活"的陈旧副本（高倍速 ≥512x 跨过衰减窗口所致）强制补记 `isAlive=false` + `deathCause`；②流产/随母亡故胎儿以"已故子嗣"身份入档（`isFetus=false`，血缘 `fatherId`/`motherId` 由墓碑携带——高倍速下胎儿整个生命周期可在单帧内，`prevAgents` 取不到，必须靠墓碑保血缘），族谱据此可画"💀 死因: 流产"节点。

### 5.5 镜头跟随与 Inspector 联动

根 AGENTS.md §4.8：选中小人后 `isCameraFollow` 开启，**关闭 Inspector（✕ 或 Esc）时必须同时关闭跟随**。此逻辑在 main.js 的 Esc 键绑定和 Inspector 关闭按钮中。

新增 Inspector 关闭方式（如点击其他 UI 区域）时，须同步调用 `rustWorld.isCameraFollow = false`，否则镜头会持续跟随已取消选中的族人。

### 5.6 决策顺序保存（v1.27.0 起 localStorage 为主）

★ v1.27.0 起决策顺序保存主路径改为浏览器 `localStorage`（★ v1.29.0 起键 `flowaccord.decision-order.v2`，schema 1，含 `savedAt`；启动时自动迁移旧键 v1 的 0→6 编码）：静态 COS 与本地开发行为一致，无需写文件；非法/版本不符的覆盖值在启动时丢弃并回退内置默认。`server.js` 的 `POST /save-decision-order` 端点**保留仅作兼容迁移/清理**，不再是正常保存路径。

**不要新增其他写文件端点**——前端定位是纯静态，本地文件写入仅限存档系统（File System Access API 用户手势直写）这一个文档化例外。

### 5.7 WASM 双副本（根 AGENTS.md §4.1）

改 Rust 内核后必须重编译并复制到两个位置：
- `frontend/rust/sim_wasm.wasm`（rustworld.js 实际 fetch 的主路径）
- `frontend/sim_wasm.wasm`（根目录静态备用）

只改前端 JS/CSS/HTML 时**不需要重编译 wasm**，浏览器 Ctrl+F5 即生效。

### 5.8 存档系统的存储配额与读档副作用（v1.11.0）

- 存档正文存在 `localStorage` 的 `flowaccord.save.v1.<slotId>`（3 槽位），**槽位元信息统一放索引键** `flowaccord.save.v1.__index`——元信息若随正文各存一份会双倍占用配额。
- 单份存档约 392 KB（人口增长/账本流水累积后可达数 MB），三槽位约 1.2 MB+；localStorage 单域约 5 MB，`setItem` 抛 `QuotaExceededError` 时必须捕获并提示用户删除旧档或导出备份。
- **v1.11.0 本地文件存档（File System Access API）**：用户通过 `showSaveFilePicker` 连接一个本地 .json 文件后获得 `FileSystemFileHandle`，存档经 `createWritable()` 直写用户磁盘，不受浏览器存储配额限制；已连接本地文件时 `tickAutoSave()` 自动切换为写本地文件而非 localStorage。
- **本地文件句柄不持久化**：页面刷新后 `localFileHandle` 失效（浏览器安全策略），需用户重新连接；状态条和底部提示必须明确告知这一点。
- **权限失效处理**：写入/读取时捕获 `NotAllowedError`，自动 `disconnectLocalFile()` 并提示重新连接，不可静默失败。
- **兼容性降级**：`supportsLocalFileAPI()` 检测 `showSaveFilePicker`/`showOpenFilePicker`，不支持时（Firefox 等）隐藏连接按钮，读取标签下的「选择存档文件」降级到传统 `input[type=file]`，底部提示引导使用 Chrome/Edge。
- `loadWorld()` 成功后会清空 `_trails` / `agentArchive` / `_lastEvent` / `_terrainCached` 并 `deselect()`，**任何新增的派生缓存都必须同步清空**，否则读档后残留旧世界的可视化状态。
- 读档后**不重新注入 `window.SIM_CONFIG`**：存档自带 `SimConfig`，重注入会让前端热调参覆盖存档时的运行参数。
- 自动槽每 60 秒覆盖一次，世界 tick 未推进时跳过（`lastAutoTick` 守卫），暂停时不会空写。

### 5.9 世界图层顺序与统一相机深度绘制（★ v1.47.9 建立 / ★ v1.60.1 地形格出队）

- **固定图层顺序**（`render_canvas.js::render`，★ v1.60.1 起三步）：`SimLighting.update()` → **WebGL 地形层直绘 `sim-canvas-gl`**（terrain-renderer.js：清屏/天空 + 地形与侧壁 shader 直译受光 + 阴影图采样）→ **`drawWorldEntities`（2D 覆盖层统一深度队列，内含道路悬浮检测与 Tooltip）** → `drawTerrainGrid`（'G' 键调试网格线，0.04 透明度 2D 叠层画在 GL 地形上，仍可用）。★ v1.60.1 已删除 `drawSkyBackdrop`（天空清屏由 GL 层承担）与 Canvas 地形格整层绘制——旧管线中独立的「地形格整层 / 路网 / POI 底座 / 大气色洗」四个 pass 并入统一深度队列或 GL 地形层——**严禁恢复任何「整层先画」调用**（已有三次历史教训：v1.47.8 房屋、v1.50.2 装饰、v1.50.11 之前图标透山）。
- **★ 世界统一深度队列（核心契约，★ v1.60.1 地形格/侧壁/贴地投影入队已删）**：`render_world.js::drawWorldEntities()` 每帧把**水系特征（★ v1.50.20 河面按剖分区间逐段入队，段深度 = 段四角最大相机深度；RiverBank 逐段描边；ShallowFord 挂所在段深度 + ε）、游鱼（逐条）、道路（★ v1.50.88 车道静态几何缓存 + 旋转键段深度缓存 + 屏幕 AABB 粗剔 + 屏幕弧长 < `laneAdaptiveSegPx` 自适应 8 段——`_decalDepth` 与 `curve.evalPos` 缓存命中后逐帧归零，成本与车道数解耦；同深度保持收集原序）、营地辖区连线（中点近似深度）、POI 底座（−0.01 ε 垫在自己标记下）、POI 标记 / 房屋 / 族人（`render_agents.js::drawAgent`）/ 地表装饰（`render_accents.js::drawAccentEntity`）** 全部收进同一个列表，按 `depth = ry·sinX + z·cosX`（数值越大越靠近视点）**升序**绘制（远 → 近）；同深度保持收集原序（`Array.sort` 稳定）维持渲染确定性。深度项走持久对象池 `_depthPool`（零每帧 GC）。地形格/侧壁/树灌木贴地投影不再入队（`DEPTH_CELL`/`DEPTH_WALL`/`DEPTH_ACCENT_SHADOW`/`DEPTH_LANDSCAPE_SHADOW` 常量已删）：地形与侧壁遮挡由 GL 深度缓冲承担（v1.50.11~v1.50.13 的「图标透山 / 贴边实体盖侧壁」问题在 GL 下由逐像素深度测试根治，Canvas 地形格入队为历史过渡手段）。
- **★ v1.50.20 河面必须分段入队（勿回退）**：River 水面整条多边形若以「全顶点最大相机深度」单坑入队（v1.50.11 做法），河道任一岸段靠近相机时整条河就排到队尾、盖住所有更远的树/房/POI/族人（用户可见症状：「河流叠加在树和房子上」）。现在水面按剖分区间逐段入队（河道 outline 是「左岸 N 点顺去 + 右岸 N 点逆回」闭合带，顶点 `i` 与 `vLen−1−i` 同为第 `i` 断面；段四角 = `v[b]/v[b+1]/v[vLen−2−b]/v[vLen−1−b]`），绘制走 `render_terrain.js::drawRiverBand`：**clip 到段四边形内、再整多边形两遍填充**——硬 clip 逐像素归属唯一一段 ⇒ 无接缝、无半透明叠 blend，观感与整河填充一致；RiverBank 同理逐段描边；涉渡挂所在段深度 + ε（二分左岸单调 y 定位段）。新增「沿河长条状贴地特征」时一律沿用此分段模式。
- **新增世界实体/贴地图元必须挂进同一队列**：在 `drawWorldEntities()` 收集阶段登记种类 + 提供单实体绘制函数即可，**严禁**在 `render()` 里新增独立的整层绘制调用。注意深度键约定：立体实体用锚点（`pos`/裸 `x/y/z`）深度；跨大深度区间的面状元素（河道等）用「顶点最大深度」近似；贴地装饰性线条（辖区连线）允许中点近似。
- **★ 大气色洗（★ v1.60.1 改 GL shader 承担）**：色洗原先是「贴地图元之后、立体实体之前」的整屏 `fillRect`，v1.50.11 起烘焙进地形色、v1.60.1 起 CPU 烘焙与 `cell.color` 写回随 `relightTerrain` 删除——现由 terrain-renderer.js 顶点 shader 的 wash mix（当季 tint × `skyWash` × 浅色主题 0.55 系数）承担，2D 覆盖层不再有色洗。`drawAtmosphereWash()` 函数已删除，勿在文档外恢复。
- **★ v1.48.1 地形格间抗锯齿缝隙（历史注记）**：Canvas2D 逐格填充时相邻格共享边透光会产生 1px 深色网格线，`drawTerrainCell` 曾对每格四条边沿**各自外法线**外扩 `TERRAIN_SEAM_PX`(0.75px) 补偿。★ v1.60.1 `drawTerrainCell` 已删除——GL 地形逐像素栅格化无此问题，该契约随 Canvas 通道一并失效，**勿在 2D 侧复活逐格填充**。
- **★ v1.50.12/v1.50.13 贴面防埋修正（部分仍有效）**：★ v1.60.1 起地形格不再入队，「格心深度 vs 锚点深度」的地形格排序根因已随 GL 深度缓冲消失；但队列内**道路/底座/装饰/族人之间的相互遮挡仍由 `_surfaceDepth()`/`_decalDepth()` 足迹感知深度**解决（`_ownCellCenterDepth()` 由世界坐标反查所在格，底座圆/储量环/路面触及相邻近格时防止「半截入土」；足迹感知对足迹外的真山体深度仍是真值）；② **视觉层**——立体精灵（POI 标记/房屋/族人/装饰）绘制锚点经 `projectLifted()` / `MAP_Z_LIFT`(4.0 世界单位) 略抬于地表；★ v1.50.13 锚点几何修正：**精灵必须「底边贴锚点」向上画**——`drawAccentBoulder` 七边形原以锚点为中心（下半沉入 1.04r）、已整体上移 r；`drawAccentBush` 瓣簇已上移 0.55r；新增精灵图形时落笔范围必须在锚点之上，中心对称图形先平移再画。**贴地元素（道路/底座/水面/足迹线/目标指示环）禁止抬升**，否则路面与底座会在坡面上悬空。新增入队元素时：排序深度按「点状 → `_surfaceDepth`；面状/线状 → `_decalDepth`」判定。
- **★ v1.50.15 族人/道路足迹深度强化 + config.render.js（勿回退）**：① **族人**——`drawAgent` 的人偶圆/受孕环/施工环/选中环**以锚点为中心**（下方笔迹最大 ~9px），且装饰环多不适合逐个改几何，故排序深度直接走 `_decalDepth(r=18)`（rotX 默认 1.05 即 cosX≈0.5，地面屏幕压缩近半 ⇒ 锚点下方 N px ≈ 朝相机 2N 世界单位）；② **道路分段**——深度改 **5 采样 × `_decalDepth(r=6)`** 取最大（v1.50.13 的 3 采样 `_surfaceDepth` 两缺口：路拱半宽朝相机侧伸入的**下一格**未覆盖；整赛道仅 16 分段、长路段跨 3+ 格时中段触格漏采）；③ **渲染参数独立配置**——`config.render.js` / `window.RENDER_CONFIG`（mapZLift、agentFootprintR、laneFootprintR、poiBaseCampR(+PerLevel)、poiBaseResourceR、poiMarkerFootprintR、accentFootprintR），**严禁把渲染参数写进 config.js**（与 Rust SimConfig 严格互检、孤儿键报错），须在 render_world.js 之前加载；render_world.js 顶层 `const RC = window.RENDER_CONFIG || {}` 消费，全部读点带缺省回退。
- **★ v1.50.14 边界侧壁深度排序（★ v1.60.1 历史化）**：四面沙盘侧壁是地图边界处最靠近相机的几何，贴边实体伸过边界线的部分必须被侧壁盖住。v1.50.11~v1.50.13 曾把侧壁按边界格分段经 `DEPTH_WALL`(11) 入队（`render_terrain.js::drawBoundaryWallSeg`）。★ v1.60.1 起侧壁由 GL 地形层顶点绘制并参与深度测试，`DEPTH_WALL` 与 `drawBoundaryWallSeg` 已删除——「侧壁盖住贴边笔迹」由 GPU 深度测试天然保证，严禁在 2D 侧复活侧壁绘制。
- **★ TA-07 装饰 LOD 与入队剔除四条红线（勿回退）**：① **口径唯一**——特征尺度 / 三档判档 / 屏幕 AABB 只有 `accent-lod.js` 一个实现，六处消费点一律读它；旧 `24+44×scale` / `24+14×scale` 启发余量（装饰与景观入队+绘制共四处）和 `crownR×1.8+|so|` 经验包络已全部删除，**严禁**在任何一处另起一份。② **入队端与绘制端消费同一个 AABB**（经深度项 `s1x/s1y/s2x/s2y` + 锚点 `ex/ey` 传递，绘制端不重算不重剔）——两处各算一套会出现漏画（可见缺陷，零容忍）。③ **包围体保守性**——一级 `accentKindBounds` 必须 ≥ 真值上界（宁多画不漏画），且必须显式登记 `yUp`（石体底环按 v1.50.13 契约整体在锚点上方，非对称圆盘）与 `rS`（叶簇/子石是屏幕空间球，竖直外扩**不乘 cosX**）；漏掉任一项会在低俯角剔掉冠顶。档位滞回只影响「画哪些图元」，瞬态字段 `_lodT` 挂个体对象（随世界事件整组换新自然失效），**严禁**模块级 `Map` 存滞回。④ **深度项字段约定**——`_depthItem` 池条目含 `ex/ey`（锚点屏幕坐标）与 `lod`（1 = 入队端已剔除并写入 AABB）；装饰/景观项复用 `s1x/s1y/s2x/s2y` 存屏幕 AABB（左下/右上；★ v1.60.1 起阴影深度项已删），道路分段的 `s1/s2/dash` 用法不变；`_depthItem` 每次复用清零 `lod`——漏清零会让关态拿到上一帧的 AABB。

### 5.10 动态季节光照契约（★ v1.48.0）

- **光相唯一来源 = 快照**：`SimLighting.phaseFromSnapshot()` 只消费 `sim.currentSeason` + `sim.seasonProgress`（缺字段回退 `seasonTimer / seasonYearLength`）。**严禁**前端另建计时器或按 `Date.now()` 推季节——那会与内核的气温、供暖、浆果霜冻形成两套季节事实。
- **一年一圈**：年度相位 `u = (seasonIdx - 0.5 + seasonProgress) / 4`；方位 `β = 360°u + 90°`（春=东 / 夏=南 / 秋=西 / 冬=北，季分箱中心恰为正方向），高度角 `e = 47° + 25°·sin(2πu)`（盛夏 72°、隆冬 22°）。
- **地形受光走 GL shader 直译（★ v1.60.1 起 CPU 烘焙已删）**：`rustworld.js::_applySnapshot` 建地形缓存时预存 `nx/ny/nz`（单位法线）+ `albR/G/B`（无光反照率）+ `ao`（GL 消费的静态缓存，保留），terrain-renderer.js 构建为 `vboShade` 并在几何闸变化时一次上传；受光公式由顶点 shader 直译 `shadeAlbedoInto`（wrap 漫反射 → 环境项 → 钳制 → tint → wash），`SimLighting.applyRelight` 在光档（`lightStepsPerYear`，默认 144 档/年）变化时只推进 `lightRev`，uniform 经 `lightRev()` 版本号闸节流上传。★ v1.60.1 `relightTerrain` / CPU 写回 `cell.color` / `shadeAlbedoInto` CPU 路径已删除，严禁在绘制循环里逐格生成颜色字符串。
- **视觉限速器**：仿真角速度超过 `rateCapDegPerSec`（默认 90°/s，最快 4 秒一圈）时按限速跟随，相位误差超过半圈直接对齐——高倍速下不得出现频闪。
- **时间跳变必须 `resync()`**：`rustworld.js` 在 `READY / LOAD_RESULT / REWIND_RESULT / RESET_DONE` 四处已调用；新增任何重建世界的入口都要补上，否则光相会从上一世界缓慢爬回来。
- **阴影用世界空间**：`lightShadowOffset()`（render_world.js）与 `SimLighting.shadowOffset()` 把世界光向投影到屏幕（随相机 `rotZ/rotX` 旋转）；**禁止**再写死屏幕偏移。
- **纯表现层边界**：不消耗 `WorldRng`、不写模拟状态、不进存档、不参与逐字节确定性承诺；`enabled=false` 必须退回 v1.47.11 的固定光（西北 41°）以便 A/B 对照。
- 详细设计与验收见 [../docs/current/tech/17-seasonal-lighting.md](../docs/current/tech/17-seasonal-lighting.md)。

### 5.11 装饰树季节叶色契约（★ 2026-09-12 落地，修复长期死分支）

- **背景（勿重犯）**：v1.48.0~2026-09-12 期间 `drawAccentEntity` 一直写作
  `if (window.SimTreeTint && sim.treeTintEnabled !== false) { … }`，但 **`window.SimTreeTint` 全仓没有任何赋值点**，
  判断用的 `sim.treeTintEnabled` 来源字段 `terrainTreeSeasonTint` 又在 v1.50.18 被清理
  → 条件恒假、分支永不进入，树木叶色恒等于 `accent.tint`，而 Rust `geo/accents.rs` 恒写 `tint: 0`
  → **四季渲染完全相同**（文档却一直声称"按当前季节实时派生"）。
- **唯一生产者 = `window.SimTreeTint`**（`accent-season.js`）：`sample(accent, sim, profile?)` 输出连续季相，绘制树木与灌木都只读它；`brownness()` 为同一套曲线的兼容接口，不另建年历（★ TA-06-2 已删除无消费点的 `tint()` 三档量化接口）。
- **真相源 = 原始快照**：`currentSeason` + `seasonProgress`，缺字段回退 `seasonTimer / seasonYearLength`；春中心为 0，初春为 0.875。不能用经限速的 `SimLighting.phase()` 决定叶量，更不能用墙钟。
- **周期曲线**：参数集中在 `config.render.js` 的 `accentSeasonProfiles` / `accentFlowerCycle`；跨年 smoothstep 插值，输出浮点 RGB 反照率及 0–1 叶量/芽量/花量/地被量。★ TA-06 起物种与 profile 由 `accent-model.js::speciesOf` 从 `accent.id` 稳定哈希派生，`model.profile` 为**单一入口**（阔冠/疏冠 → `deciduousTree`、锥形常绿与低矮常绿 → `evergreen`、落叶多茎 → `deciduousBush`、花灌木 → `floweringBush`）；曲线本身不改，物种分配只负责把正确 profile 送进来。非 Tree/Bush 的 `profile` 为 `undefined` → 回退原曲线（GrassTuft 芦草穗量不受 `floweringBush` 影响）。
- **有界个体偏移**：kind/id 独立哈希通道 997/998（**专属季相 jitter，禁止与物种派生通道混用**），`accentSeasonJitterTurns` 默认 ±0.025 年、硬限幅 ±0.04；共同盛夏满叶、隆冬落叶 3–4% 平台避免错季。常绿曲线全年保留至少 94% 叶量（`fade 0.09` 下 `accentClusterVisibility` 恒 ≥0.27 > 0.06 显示阈，故锥形常绿/低矮常绿无需「不脱落」特例分支）。
- **消费边界**：叶色/叶量/芽量已全部由几何消费——叶簇按 `leafDensity`×稳定 `shed` 次序收缩隐藏（枝干全年保留，冬季落叶树余 0~5% 叶量，禁整冠透明度），芽量绘制为枝端芽点。★ TA-06-7 起**花量首次真实消费**：花灌木花朵点簇可见点数 = `round(K×flowerAmount)`（K = 模型构建期固定花位数 ≤ `accentFlowerDotsMax`），花色/花位属几何不入季相缓存。地被落叶与飘叶仍待 TA-15。禁止把整冠透明度当作落叶。
- **缓存与恢复**：季相按输入直接求值，不保存历史结果；几何缓存不含季相，恢复/读档/回溯自动按新快照重建颜色。暂停时输入不变，输出不漂移。
- **纯表现层**：不消耗 WorldRng，不写模拟/快照/存档；Boulder 保持原配色，Rust `TerrainAccent.tint` 仍是恒 0 的预留字段，植被不读它。

---

## 六、与 Rust 内核的接口对照

| 前端调用 | WASM 导出 | 用途 |
|---|---|---|
| `rustWorld._loadWasm()` | `world_create(grid, size, seed, agentCount, campCount)` | 创建世界实例（campCount 播种前注入，见根 AGENTS.md §4.7） |
| `rustWorld.tick()` / 倍速多步 | `world_tick(dt)` | 推进模拟 |
| `rustWorld.applyConfig(cfg)` | `world_apply_config(jsonPtr, len)` | 热注入配置 |
| `sim_worker.pullSnapshot()` | ★ T1/M5 `world_snapshot_bin_ptr/len` → 唯一 FABS 二进制帧（`.slice()` 拷出 + `postMessage(transfer)`）；不再存在生产 JSON 回退 | 拉取快照 |
| `SnapshotBin.setEnumTables()` | `world_enum_table_ptr/len` → 枚举名称表 JSON | M4 解码枚举码位（单一真相源，杜绝前后端漂移） |
| `rustWorld.saveWorld()` | `world_save_ptr()` + `world_save_len()` | 导出全量存档 JSON（v1.8.0） |
| `rustWorld.loadWorld(json)` | `world_save_buf_ptr(len)` + `world_load(len)` | 载入存档覆盖世界（0 成功 / -1 越界 / -2 非 UTF-8 / -3 解析或校验失败） |
| `rustWorld.readSaveError()` | `world_last_error_ptr()` + `world_last_error_len()` | 读取最近一次存档/读档失败原因 |
| `rustWorld.reset()` | `world_reset(seed)` | 重置世界 |
| 决策顺序写盘 | （无 wasm 接口，纯前端文件） | server.js 原子写 |

wasm 导出函数的完整清单见 `crates/sim_wasm/AGENTS.md`。
