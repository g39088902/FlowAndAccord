/*
 * Flow & Accord · 前端渲染表现层配置（★ v1.50.15 从 render_world.js 硬编码抽出）
 * ============================================================================
 * 本文件只承载**纯前端表现层**参数（不参与仿真、不消耗 WorldRng、不入快照）。
 *
 * ⚠️ 为什么不放进 config.js：config.js 与 Rust SimConfig 由 tools/config-check.js
 *   严格互检（字段一一对应，多写的键按孤儿报错），渲染参数不属于仿真超参，
 *   故按 config.lighting.js / config.poi-rates.js 的先例独立成文件。
 *   本文件必须在 render_world.js 与 render_terrain.js 之前加载（index.html 已保证）。
 * 调参后刷新浏览器即可生效（建议 Ctrl+F5 强刷清缓存），无需重编译 WASM。
 * ============================================================================
 */
window.RENDER_CONFIG = {
  // —— WebGL 渲染（★ Phase 1-2: Canvas 2D → WebGL 迁移）——
  useWebgl: (() => {
    // 默认开启，可通过 URL 参数覆盖
    const params = new URLSearchParams(window.location.search);
    return params.get('webgl') !== '0';
  })(),

  // —— 渲染帧率上限（★ v1.50.82 从 render_canvas.js 硬编码 TARGET_FPS=30 抽出）——
  // 语义：绘制帧的**目标上限**；仿真推进完全由 Worker 独立线程按 speedMult 驱动，
  //       主线程 sim.tick() 为空操作，故提高此值**不影响模拟速度、不影响确定性**。
  // 取值：
  //   > 0   → 按该目标 FPS 门控绘制帧（默认 60；显示器 rAF 通常为 60，更高值无收益只会放宽门控）
  //   0 / 'uncapped' / 'none' → 完全解除门控，每个 rAF 回调都绘制（上限即显示器刷新率）
  // 覆盖方式（优先级从高到低）：URL ?fps=<值>  →  localStorage 'fa.renderFps'  →  本默认值
  // 例：?fps=0 不设限、?fps=30 回到旧行为、?fps=144 给高刷屏让路。
  // ⚠️ 视觉效果提醒：Worker 快照下发仍按人口自适应节流（15~30Hz，见 sim_worker.js
  //    SNAP_THROTTLE_TIERS），主线程无运动插值，故解除门控主要改善**镜头拖拽/缩放**
  //    的跟手度与 UI 刷新；族人位置的更新频率仍受快照节流约束。
  targetFps: 60,
  
  webglDebug: {
    enableBatchStats: true,  // 打印 batching 统计
    enableFrametime: true,   // GPU frametime 测量
  },

  // —— 立体精灵视觉抬升（世界单位）——
  // POI 图标 / 房屋 / 族人 / 装饰的绘制锚点统一上抬量，坡面上不再「陷进」地面。
  // 贴地元素（道路/底座/水面/足迹线/目标环）不消费此值，否则坡面悬空。
  mapZLift: 0.0,

  // —— 足迹感知深度半径（世界单位，沿朝相机方向采样）——
  // rotX 默认 1.05（cosX≈0.5）时地面在屏幕上压缩近半：锚点下方 N 像素的笔迹
  // 相当于伸入下前方约 2N 世界单位的地面 territory；排序深度必须抬到
  // 「足迹触及的最远格心 + ε」之上，否则该格后画盖掉下半（「半截入土」）。
  agentFootprintR: 18,        // 族人：人偶/受孕环/施工环/选中环以锚点为中心，下方笔迹最大 ~9px
  laneFootprintR: 6,          // 路面：描边半宽 ~1.4px，热力图高等级外光晕 ~2.9px
  laneCullPadPx: 16,          // ★ v1.50.88 车道屏幕 AABB 粗剔外扩余量（CSS px；覆盖描边宽与外光晕）
  laneAdaptiveSegPx: 140,     // ★ v1.50.88 车道屏幕弧长低于此用 8 段（否则 16 段）；0 = 关闭自适应
  poiBaseCampR: 16,           // 营地底座基础半径（每等级 +poiBaseCampRPerLevel）
  poiBaseCampRPerLevel: 3,
  poiBaseResourceR: 12,       // 资源点底座半径
  poiMarkerFootprintR: 20,    // POI 标记足迹（覆盖图标/储量环/门牌）
  accentFootprintR: 8,        // 地表装饰（Tree/Boulder/Bush）足迹

  // —— 连续植被季相（TA-02；accent-season.js 唯一消费入口）——
  // u 为快照年相位：春中心 0 / 夏 0.25 / 秋 0.5 / 冬 0.75；初春从 0.875 开始。
  // 每行：[u, 叶量, [R,G,B]反照率, 芽量, 花量, 地被落叶量, 枯荣系数]。
  // 周期 smoothstep 插值，最后一行跨年连到第一行；花只为 floweringBush 曲线输出。
  // 叶量/芽/花/地被为 TA-03/15 的数据接口；当前精灵只消费连续叶色。
  accentSeasonJitterTurns: 0.025, // kind/id 稳定偏移；生产者硬限幅 0.04，保留盛夏/隆冬平台
  accentSeasonProfiles: {
    deciduousTree: [
      [0.000, 0.42, [112, 151, 73], 0.65, 0, 0.10, 0],
      [0.125, 1.00, [79, 126, 55], 0, 0, 0, 0],
      [0.300, 1.00, [60, 101, 47], 0, 0, 0, 0],
      [0.400, 1.00, [91, 117, 49], 0, 0, 0, 0.15],
      [0.480, 1.00, [172, 147, 65], 0, 0, 0.05, 0.55],
      [0.550, 0.65, [171, 99, 51], 0, 0, 0.55, 0.90],
      [0.650, 0.03, [108, 77, 53], 0, 0, 1.00, 1],
      [0.850, 0.03, [88, 84, 67], 0, 0, 0.45, 1],
      [0.900, 0.03, [105, 117, 66], 0.35, 0, 0.30, 0.65],
      [0.960, 0.12, [124, 155, 78], 1.00, 0, 0.18, 0.10],
    ],
    deciduousBush: [
      [0.000, 0.52, [108, 143, 70], 0.55, 0, 0.08, 0],
      [0.125, 1.00, [69, 110, 49], 0, 0, 0, 0],
      [0.300, 1.00, [54, 91, 43], 0, 0, 0, 0],
      [0.400, 1.00, [97, 108, 45], 0, 0, 0, 0.20],
      [0.470, 1.00, [164, 125, 56], 0, 0, 0.05, 0.55],
      [0.540, 0.60, [154, 87, 48], 0, 0, 0.55, 0.90],
      [0.650, 0.04, [99, 74, 53], 0, 0, 1.00, 1],
      [0.850, 0.04, [83, 80, 62], 0, 0, 0.40, 1],
      [0.900, 0.04, [101, 116, 61], 0.45, 0, 0.25, 0.60],
      [0.960, 0.18, [117, 148, 71], 1.00, 0, 0.15, 0.10],
    ],
    evergreen: [
      [0.000, 0.96, [71, 113, 66], 0.25, 0, 0, 0],
      [0.125, 1.00, [67, 108, 60], 0, 0, 0, 0],
      [0.300, 1.00, [56, 94, 54], 0, 0, 0, 0],
      [0.500, 0.98, [62, 98, 56], 0, 0, 0, 0],
      [0.650, 0.94, [52, 80, 64], 0, 0, 0, 0],
      [0.850, 0.94, [52, 80, 64], 0, 0, 0, 0],
      [0.960, 0.95, [66, 104, 66], 0.35, 0, 0, 0],
    ],
  },
  // 花灌木复用落叶灌木叶历，只覆写开花量（speciesOf 派生 flowering 变体时消费）。
  accentFlowerCycle: [[0.00, 1], [0.08, 0.55], [0.16, 0], [0.88, 0], [0.96, 0.65]],

  // —— ★ TA-06 植被物种变体（三乔木轮廓 + 三灌木变体 + 花朵图元；07 号 §6.3/§10.2）——
  // ★ 本组为几何输入，调值必须同步 bump accentModelStyleVersion，否则旧模型缓存不会重建（§10.2）。
  accentModelStyleVersion: 6, // 骨架模型风格版本：调值即整体重建模型缓存（TA-06 三乔木/三灌木骨架形态变更 4→5；★ TA-07-3 新增 bounds/farClusters/segTier 分级几何 5→6）
  accentSpeciesWeights: {
    // 累积权重表（speciesOf 单 u 值查表分配；乔木常绿占比维持 0.24 与旧 accentEvergreenChance 一致，冬季观感不突变）
    tree: { broad: 0.42, sparse: 0.34, conifer: 0.24 },
    // 灌木常绿 0.20 ≈ 现状 0.24 的灌木侧份额
    bush: { multiStem: 0.56, flowering: 0.24, lowEvergreen: 0.20 },
  },
  // 三乔木轮廓参数（accent-model.js::treeSkeleton 消费；世界单位，未乘 accent.scale/zoom）。
  // broad 阔冠落叶（宽扁外展）/ sparse 疏冠落叶（枝形清晰、冠内空隙大）/ conifer 锥形常绿（窄塔轮生层）。
  accentTreeSilhouettes: {
    broad:   { trunkHBase: 5.6, trunkHVar: 1.6, crownR: 10.5, branchMin: 6, branchMax: 7, subBranchPer: 1,
               subLenK: 0.50, subDroop: 0.35, clusterFactor: 1.15, clusterRBase: 2.3, clusterRVar: 1.3,
               elevMin: 0.30, elevMax: 0.75, crownSquash: 0.78, footprintR: 13, leanShearK: 1.0 },
    sparse:  { trunkHBase: 7.2, trunkHVar: 2.4, crownR: 8.8, branchMin: 4, branchMax: 5, subBranchPer: 2,
               subLenK: 0.62, subDroop: 0.18, clusterFactor: 0.70, clusterRBase: 1.8, clusterRVar: 1.0,
               elevMin: 0.55, elevMax: 1.05, crownSquash: 0.78, footprintR: 11, leanShearK: 1.0 },
    conifer: { trunkHBase: 8.5, trunkHVar: 2.5, crownR: 4.8, branchMin: 0, branchMax: 0, subBranchPer: 0,
               clusterFactor: 1.30, clusterRBase: 1.3, clusterRVar: 0.7, elevMin: 0.12, elevMax: 0.42,
               whorlLayersMin: 4, whorlLayersMax: 6, whorlBranchesMin: 3, whorlBranchesMax: 5,
               crownSquash: 0.62, footprintR: 6, leanShearK: 0.45 }, // 倾干收敛（针叶树读感挺直）
  },
  // 三灌木变体参数（accent-model.js::bushSkeleton 消费）：multiStem=现状基准逐值复现
  // （crownR 5.5+1.2×vSeed 修正历史漂移——与绘制口径统一为模型单一来源）。
  accentBushVariants: {
    multiStem:    { stemMin: 4, stemMax: 6, heightBase: 3.4, heightVar: 1.6, outKMin: 0.38, outKMax: 0.68,
                    clusterFactor: 1.0, clusterRBase: 1.5, clusterRVar: 0.9,
                    crownRBase: 5.5, crownRVar: 1.2, crownSquash: 0.72, footprintR: 8 },
    flowering:    { stemMin: 4, stemMax: 6, heightBase: 3.0, heightVar: 1.4, outKMin: 0.30, outKMax: 0.55,
                    clusterFactor: 1.0, clusterRBase: 1.4, clusterRVar: 0.8,
                    crownRBase: 4.8, crownRVar: 1.0, crownSquash: 0.72, footprintR: 6.5 },
    lowEvergreen: { stemMin: 5, stemMax: 8, heightBase: 1.8, heightVar: 1.0, outKMin: 0.45, outKMax: 0.75,
                    clusterFactor: 1.1, clusterRBase: 1.2, clusterRVar: 0.7,
                    crownRBase: 5.0, crownRVar: 1.0, crownSquash: 0.55, footprintR: 5.5 }, // 扁压铺展、贴地弱影
  },
  // 花朵图元（render_bush.js 消费）：花位/花色构建期固定（模型 flowers[]），花量只决定
  // 可见点数 round(K×flowerAmount) 与 alpha；低饱和三色板，禁发光/禁径向渐变光晕（§4.1）。
  accentFlowerDotsMax: 9,      // 单株花位上限（构建期生成，花量再按比例显隐）
  // 花点屏幕半径 = 宿主簇屏幕半径 × K。K 取 0.30 使「近景档（冠屏半径 ≥ accentDetailNearPx）」
  // 起花点即 ≥ minPx 可辨（实测 zoom 3 ≈ 1.3~2.0px 可见、zoom 1.6 及以下亚像素整组省略）；
  // 首轮建议值 0.09 会让花点在近景仍只有 0.4~0.6px，验收项「花灌木春季可见花」不可达，故上调。
  accentFlowerDotRadiusK: 0.30,
  accentFlowerMinPx: 1.2,      // 花点屏幕半径低于此该点省略（远景亚像素噪声）
  accentFlowerPalette: [[246, 242, 232], [226, 190, 186], [238, 224, 168]], // 白 / 淡粉 / 淡黄（低饱和）

  // —— 局部三维植被骨架（TA-03，v1.50.25；TA-06 起轮廓参数上移 accentTreeSilhouettes/accentBushVariants）——
  // 模型/叶簇/枝干为 accent.id 稳定哈希派生，不进快照；accent-model.js 消费。
  // ★ TA-07：下列两键为三档判档阈值，归属 accentLOD 口径组（键名与数值不变，唯一消费入口
  //   迁往 accent-lod.js::cfg；严禁在其他文件直接读或另留一份判档实现）。
  accentDetailNearPx: 15,     // 近景（tier 2）：二级枝、簇亮部、春芽
  accentDetailMidPx: 7,       // 中景（tier 1）：主枝与全部叶簇；远景（tier 0）只保留树形与叶量
  accentLeafClustersTree: 16, // 每棵树基准叶簇数（§6.4 建议 12~24；×轮廓 clusterFactor 得实际簇数）
  accentLeafClustersBush: 8,  // 每丛灌木基准叶簇数（基生细茎端 + 茎中段；×变体 clusterFactor）

  // —— ★ TA-07 装饰细节分级 LOD 与入队剔除（唯一消费入口 accent-lod.js；07 号 §6.7/§11.3）——
  // 口径唯一：特征尺度（CSS px）、三档判档与滞回、屏幕 AABB 解析解全部在 accent-lod.js 实现；
  // 装饰 / 灌木 / 草丛 / 阴影 / 景观 / 队列六处消费点一律读它，**严禁**各处留余量公式或阈值
  // 字面量（旧 render_accents.js 的 44/14 启发余量与 render_shadows.js 的 crownR×1.8 已收口）。
  // ⚠️ 本组含**几何输入**（accentLODFarMaxClusters / accentKindBounds）：调值必须同步 bump
  //   accentModelStyleVersion，否则旧模型缓存不重建；纯阈值键（accentLODHysteresis /
  //   accentLODCullPadPx / accentLOD*MinPx）不入缓存键，热调即生效（对齐 TA-12-7 live 化教训）。
  accentLODHysteresis: 0.12,        // 档位滞回死区比例：降档阈值 = T×(1−h)，消除临界缩放往复抖动
  accentLODHysteresisEnabled: true,  // 滞回总开关（false = 每帧裸判档，A/B 与排障用；纯渲染开关）
  accentLODCullEnabled: true,        // 入队前两级剔除总开关（false = 完整回退现状路径，A/B 与排障用）
  accentLODCullPadPx: 2,             // 屏幕 AABB 外扩余量（CSS px；覆盖描边线宽与抗锯齿）
  accentLODFarMaxClusters: 8,        // 远景簇子集上限（模型层按簇半径降序预生成索引表；几何输入）
  accentLODStoneFarSides: true,      // 远景石体两笔简化开关（顶面 + 剪影描边，省逐侧面片受光）
  accentLODPlumeMinPx: 2.0,          // 芦花穗屏幕长度低于此省略（收编 render_grass.js 硬编码 2）
  accentLODShadowReachK: 2.5,        // 阴影粗剔外扩系数（须 ≥ config.lighting.js::shadowLenMax 2.40 × 实高）
  // 一级粗剔保守常数表（世界单位；须 ≥ 各 kind 真值上界，宁多画不漏画；TA-07-3 以骨架实测校核）
  // yUp = 屏幕竖直额外上界（× cosX）：石体底环按 v1.50.13「底边贴落地点」契约整体落在锚点
  //       上方（非以锚点为心对称），不显式登记会让远景石体顶部被误剔。
  accentKindBounds: {
    // 表值 = max(骨架实测上界, 方案 §3.5 建议保守值)；实测（各 kind 4000 id 骨架几何，
    //   tools 临时脚本，用后删除，见实施记录）：Tree rH 12.38 / zMax 17.31 / zMin 0；
    //   Bush rH 6.04 / zMax 8.03 / zMin −0.93；Boulder rH 7.20 / zMax 1.80 / yUp 7.20；
    //   RockCluster rH 7.01 / zMax 1.24 / yUp 7.01；GrassTuft rH 5.07 / zMax 7.49。
    //   石类的 rH/yUp 取方案建议值（> 实测）覆盖变径 × spread × 底环上移的组合上界，
    //   代价只是多画不漏画。
    // rS = 「球体半径」上界（× scaled，**不乘 cosX**）：叶簇/子石是屏幕空间球，竖直方向按
    //      全半径外扩；漏掉它会让低俯角（cosX→0）下的冠顶被误剔（TA-07-2 保守性断言捕获）。
    Tree:        { rH: 13.5, zMin: 0,    zMax: 18,   yUp: 0,  rS: 4 },
    Bush:        { rH: 6.5,  zMin: -1.5, zMax: 8.5,  yUp: 0,  rS: 3 },
    Boulder:     { rH: 7.2,  zMin: 0,    zMax: 1.8,  yUp: 7.2, rS: 0 },
    RockCluster: { rH: 11,   zMin: 0,    zMax: 3,    yUp: 11, rS: 4.5 },
    GrassTuft:   { rH: 5.5,  zMin: 0,    zMax: 7.5,  yUp: 0,  rS: 1.5 },
  },

  // —— 地表装饰 RockCluster / GrassTuft 视觉形态参数（TA-11-3，07 号 §6.6/§6.7/§10.4）——
  // 消费入口：accent-model.js（骨架派生，accent.id 纯函数入模型缓存）与
  // render_accents.js（远景 LOD 阈值、冬季萎缩系数）。调参后刷新浏览器即生效，
  // 无需重编译 WASM；逻辑层缺省回退值与下列数值严格一致（删任一键行为不变）。
  accentRockClusterMinStones: 2,          // 子石最少数量（内核只下发 anchor，子石前端派生）
  accentRockClusterMaxStones: 5,          // 子石最多数量
  accentRockClusterSpreadBase: 3.2,       // 簇散布基准半径（世界米）
  accentRockClusterSpreadVar: 1.2,        // 散布随机离散系数（×vSeed）
  accentRockClusterMainRadiusBase: 2.4,   // 主石半径基准（世界米）
  accentRockClusterMainRadiusVar: 1.0,    // 主石半径随机幅度（2.4~3.4m）
  accentRockClusterDebrisRadiusBase: 1.1, // 伴生碎石半径基准（世界米）
  accentRockClusterDebrisRadiusVar: 1.3,  // 伴生碎石半径随机幅度（1.1~2.4m）
  accentRockClusterLODMinRadius: 0.6,     // 远景微碎石省略阈值（屏幕半径 px）
  accentGrassTuftLODMinPx: 1.4,           // ★ S7-03 远景草丛整丛省略阈值（草叶屏幕长度 px；高密草甸批量绘制耗时平稳）
  accentRockClusterShadowAlpha: 0.14,     // 簇群整片微接触落底阴影透明度（TA-11-5，rgba(25,20,15,α)）
  accentRockClusterStoneShadowAlpha: 0.10,// 逐石接触椭圆阴影透明度（TA-11-5，主石自动 +0.02）

  // —— 岩石立体受光几何（TA-04-5，render_accents.js::drawStoneBody 消费；Boulder 与 RockCluster 子石共用）——
  // 棱柱轮廓随相机投影（billboard 移除），亮暗由世界光向点积决定（不固定「顶亮侧暗」）。
  accentStoneHeightK: 0.30,               // 石体高宽比：石高 = K × 石半径（侧面带高随相机 sinX 投影）

  // —— 装饰绘制 WebGL 迁移（★ accent-renderer.js + shadow-pass.js；Canvas 2D → WebGL 阶段三装饰切片）——
  // GL 地形活动时 Boulder/RockCluster/Tree/Bush/GrassTuft（含资源景观子图元与花朵/春芽）
  // 改由 WebGLAccentRenderer 绘制：几何/配色与 Canvas 路径单一同源（sink 分发，受光公式零复制），
  // 逐三角形解析 AA 对齐 Canvas 抗锯齿；落底阴影不再手绘（v1.50.83 Boulder 落底影与
  // Canvas 手绘贴地影在 GL 模式下一律省略），统一由 WebGLShadowPass 阴影图（世界空间代理
  // 几何 → 光向深度 → 地形采样变暗）承担。关闭即完整回退 Canvas 现状路径（A/B 用）。
  accentWebglEnabled: (() => {            // 总开关（URL ?accentgl=0 优先，?stonegl=0 兼容别名；纯前端开关）
    const params = new URLSearchParams(window.location.search);
    return params.get('accentgl') !== '0' && params.get('stonegl') !== '0';
  })(),
  accentWebglShadowStrength: 0.38,        // 阴影内地形变暗比例（0 = 关阴影；约 0.3~0.5 观感自然）

  // —— 树/灌木贴地投影（TA-04-6，render_shadows.js::drawAccentShadowGround 消费）——
  // 阴影为地面图元独立入统一深度队列（入队/分发归 render_depth_queue.js）；影长由模型实高
  // （trunkH × accent.scale，不含 zoom）经世界光向 shadowOffset 驱动，叶量调制覆盖与强度。
  accentShadowAlpha: 0.17,                // 冠影峰值不透明度（夏季完整冠影；随叶量 0.30+0.70×leaf 衰减）
  accentShadowGroundAlpha: 0.12,          // 接地弱影不透明度（贴树根，冬季仍存）
  accentShadowBranchAlpha: 0.10,          // 稀疏枝影峰值不透明度（α ∝ 1−leaf，冬季为主）
  accentShadowMinPx: 2.5,                 // 冠屏半径低于此整组省略阴影（远景亚像素噪声）

  accentGrassTuftMinBlades: 3,            // 草叶最少叶数
  accentGrassTuftMaxBlades: 6,            // 草叶最多叶数
  accentGrassTuftHeightBase: 2.4,         // 基准株高下限（世界米）
  accentGrassTuftHeightVar: 1.6,          // 株高随机幅度（2.4~4.0m）
  accentGrassTuftBaseSpread: 0.8,         // 根部聚拢半径基准（世界米）
  accentGrassTuftBaseSpreadVar: 0.9,      // 根部离锚点距离随机幅度（0.8~1.7m）
  accentGrassTuftWinterHeightRatio: 0.62, // 隆冬低矮萎缩保底高度系数（0.62+0.38×叶量）
  // —— 芦草变体（TA-11-4，07 号 §6.6「水岸可派生芦草外观」）——
  // accent-model.js::grassTuftSkeleton 消费：稳定哈希 < ReedChance 派生 isReed；
  // 穗量/季相枯色由 render_grass.js::grassSeasonColor 按季节样本驱动（几何不随季节变）。
  accentGrassTuftReedChance: 0.35,        // 芦草变体派生概率（验收口径：近景约 30%~40% 草丛带穗）
  accentGrassTuftReedHeightBase: 4.2,     // 芦草基准株高下限（世界米）
  accentGrassTuftReedHeightVar: 1.8,      // 芦草株高随机幅度（4.2~6.0m，挺拔高于普通短草）
  accentGrassTuftPlumeLenBase: 0.9,       // 穗状芦花长度下限（世界米）
  accentGrassTuftPlumeLenVar: 0.6,        // 穗长随机幅度（0.9~1.5m）

  // —— 世界光向动态受光（TA-04，lighting.js 消费）——
  sunScreenEps: 0.02,         // 屏幕光心退化半径：光向接近视线（投影 len < eps）时亮部按 len/eps 平滑回冠心（lighting.js::sunScreenDirFull，TA-04-1 迁入）

  // —— 枝干圆柱侧面明暗（TA-04-3，render_accents.js::drawAccentTree/drawAccentBush 消费）——
  // 迎光/背光带位置由世界光向（经倾干剪切逆转置）的屏幕投影决定——转相机/改光向明暗随动，
  // 不以相机正面定义迎光面（07 号 §6.5 第 2 段）。调参刷新即生效，无需重编译 WASM。
  accentBarkBandOffset: 0.38,    // 明暗带中心相对当地干宽的偏移比例（<0.5 保证带留在轮廓内，主干另有 clip 兜底）
  accentBarkBandWidthK: 0.50,    // 明暗带线宽相对当地干宽的比例
  accentBarkBandLitAlpha: 0.55,  // 迎光带不透明度（叠于朝屏体色上混出圆柱侧面渐变）
  accentBarkBandDarkAlpha: 0.40, // 背光带不透明度（背光面弱于迎光面，避免死黑）
  accentBarkBandMinWidthPx: 2.0, // 侧面明暗最小可辨屏幕宽度（主干带 / 枝茎高光低于此省略，防远景亚像素噪声）

  // —— 叶簇宽而弱亮部（TA-04-4，render_accents.js::drawAccentTree/drawAccentBush 消费）——
  // 近景簇亮部中心沿屏幕光向偏移（lighting.js::sunScreenDirFullInto，光近视线时平滑回冠心），
  // 颜色经受光管线随簇法线迎光程度衰减；替代 v1.50.27「屏幕固定位置白椭圆」避免塑料反光。
  accentCrownLitOffset: 0.45, // 亮部中心偏移相对簇半径的比例（沿屏幕光向）
  accentCrownLitRxK: 0.55,    // 亮部椭圆横半径相对簇半径的比例（宽于旧 0.42 白斑）
  accentCrownLitRyK: 0.42,    // 亮部椭圆纵半径相对簇半径的比例
  accentCrownLitAlpha: 0.16,  // 亮部峰值不透明度（弱于旧 0.20 小白斑，宽而弱）
  accentCrownLitMinPx: 2.2,   // 簇屏幕半径低于此省略亮部（远景亚像素噪声）

  // —— 世界坐标锁定地表纹理（★ TA-12-2，TA-12-TODO §3/§5；terrain-texture.js 消费）——
  // CPU 确定性派生小型世界空间图元（草斑/土纹）：固定整数哈希 + 独立属性通道 + 世界桶候选，
  // 位置/形状/方向固定在世界空间，缩放/旋转/暂停/刷新/存读档不重新抽样（首期不依赖 _engineSeed）。
  // 纯渲染配置，不进 SIM_CONFIG、不经 applyConfig 注入 WASM；所有数字须有真实消费点（§5.3）。
  terrainTexture: {
    enabled: true,             // 总开关（false = 不构建模型、不绘制；纯前端开关）
    styleVersion: 1,           // 纹样派生算法版本（哈希输入之一；调值整体换纹样并重建）
    bucketSizeWorld: 12,       // 世界桶边长（世界单位）
    grassCandidates: 3,        // 每桶草斑候选上限（非保证密度，经低频密度场 × 材质权重筛选）
    soilCandidates: 2,         // 每桶土纹候选上限
    grassSizeRange: [2, 6],    // 草斑直径区间（世界单位）
    soilLengthRange: [1, 3],   // 土纹长度区间（世界单位）
    soilWidthRange: [0.2, 0.5],// 土纹宽度区间（世界单位；禁止屏幕固定宽度）
    contrast: 0.04,            // 明度扰动基准幅度（相对原反照率等比例，§4.1 建议 3%~5%）
    contrastMax: 0.08,         // 明度扰动上限（§4.1 上限 8%）
    cacheMaxBytes: 8388608,    // 模型缓存上限 8 MiB（超出按候选数等比例确定性截断）
    buildBudgetMs: 2,          // 分批构建每帧预算（未就绪格 TA-12-3 只画原基底）
    // ★ TA-12-3 LOD：特征尺度 = 图元特征尺寸(世界单位) × camera.zoom(世界→CSS 像素)，
    //   在 [2,5] CSS px 区间 smoothstep 淡入（远景隐去细土纹、草斑平滑减弱，§4.2）；
    //   只作用于绘制透明度，不改变纹样身份 → 不触发模型重建。
    detailFadePx: [2, 5],
  },

  // —— 资源景观（★ S4-02，STAGE-04-TODO §3.2；landscape-model.js / render_landscapes.js 消费）——
  // 围绕资源 POI 的前端确定性派生景观：模型只由世界 seed / POI 类型与坐标 / 静态地形 /
  // 配方固定盐值 / role / slot 派生；库存丰度 q 只驱动画面动态细节，绝不参与几何重抽。
  // 本段为**纯渲染配置**，不进 SIM_CONFIG、不经 applyConfig 注入 WASM；关态完整回退原画面。
  landscapeEnabled: true,       // 总开关（false = 零开销回退原画面路径；纯前端开关，禁写模拟事实）
  landscapeStyleVersion: 1,     // 景观配方风格版本（组缓存/模型缓存键组成部分；调值整体重建）
  landscapeCacheMaxGroups: 256, // 景观组模型缓存上限（超限整体清空，不 LRU；§3.2 有界缓存）
  landscapeFrameChildBudget: 420, // 每帧入队子图元（含阴影）硬上限；按固定遍历序截断（§3.4 预算）
  // —— 可采细节（★ S4-04，STAGE-04-TODO §3.2；landscape-model/render_landscapes 消费）——
  landscapeDetailQFloor: 0.2,   // detail 子图元 q 阈值映射区间下界（q ≥ threshold_i 才显示；骨架不受影响）
  landscapeDetailQCeil: 0.85,   // detail 子图元 q 阈值映射区间上界（threshold_i = floor + (ceil-floor)·(slot+0.5)/slots）
  // —— 景观遮罩（★ S4-03，STAGE-04-TODO §3.3；landscape-mask.js 消费）——
  // 全部距离/半径均为**世界单位**（遮罩查询在世界空间命中，不涉及显示像素；
  // 世界 → 屏幕换算只在绘制端经 camera.zoom 一次）。
  landscapeMaskEnabled: true,   // 遮罩总开关（false = 景观与基础装饰全部按原样绘制；纯前端开关）
  landscapeMaskBinSize: 96,     // 保护区空间分桶边长（世界单位；查询先取足迹相交桶再精确测距）
  landscapeMaskLaneRadius: 9,   // 车道胶囊保护半径（世界单位，含路面与磨损外晕余量）
  landscapeMaskLaneSamples: 36, // 每条车道采样细分上限（目标弦距 ≤10 世界单位，弦差须小于留白余量；异常段退化为端点包围区）
  landscapeMaskHouseRadius: 18, // 房屋保守保护圆（世界单位：Tier4 半宽 8.4 + 接触影 + 入口余量；入口未映射按周边整体保护）
  landscapeMaskPoiExtraRadius: 4, // POI 操作区在 max(底座半径, 图标世界尺寸~12) 基础上的额外余量（复用 poiBase* 同源键；poiMarkerFootprintR 是深度辅助半径非视觉占地，禁用作保护半径）
  landscapeMaskMargin: 2,       // 通用留白余量（世界单位；车道采样弦差须小于该值）
  landscapeRecipes: {           // 配方表（role 顺序 = 候选生成顺序；slots = 每 role 候选上限 K）
    Water: { rMin: 24, rMax: 46, roles: [       // 陆侧岸石 + 低草；水面候选由模型层拒绝（不画新泉池）
      { role: 'stone', modelKind: 'RockCluster', slots: 2, scaleMin: 0.55, scaleMax: 0.85, footprint: 10 },
      { role: 'grass', modelKind: 'GrassTuft',   slots: 4, scaleMin: 0.8,  scaleMax: 1.2,  footprint: 6 },
    ] },
    Wood: { rMin: 30, rMax: 60, roles: [        // 少量主树 + 林缘灌木 + 林下草；foliage=可采细节（q 显隐）；避让归 S4-03 遮罩
      { role: 'tree',    modelKind: 'Tree',        slots: 3, scaleMin: 0.9,  scaleMax: 1.35, footprint: 10.5 },
      { role: 'bush',    modelKind: 'Bush',        slots: 3, scaleMin: 0.7,  scaleMax: 1.1,  footprint: 8 },
      { role: 'grass',   modelKind: 'GrassTuft',   slots: 3, scaleMin: 0.8,  scaleMax: 1.2,  footprint: 6 },
      { role: 'foliage', modelKind: 'Bush',        slots: 3, scaleMin: 0.45, scaleMax: 0.7, footprint: 8, stockRole: 'detail' },
    ] },
    Berry: { rMin: 22, rMax: 44, roles: [        // 不规则低灌木簇（采收中心保留原图标）
      { role: 'bush',  modelKind: 'Bush',        slots: 5, scaleMin: 0.7,  scaleMax: 1.1,  footprint: 8 },
      { role: 'grass', modelKind: 'GrassTuft',   slots: 2, scaleMin: 0.8,  scaleMax: 1.2,  footprint: 6 },
    ] },
    Stone: { rMin: 22, rMax: 42, roles: [        // 岩石露头 + 少量草（不画成阻路峭壁）
      { role: 'rock',   modelKind: 'RockCluster', slots: 2, scaleMin: 1.0,  scaleMax: 1.5,  footprint: 12 },
      { role: 'grass',  modelKind: 'GrassTuft',   slots: 2, scaleMin: 0.8,  scaleMax: 1.2,  footprint: 6 },
    ] },
    Gold: { rMin: 22, rMax: 42, roles: [         // 岩石骨架 + 少量草（禁止整片发光/扩矿）
      { role: 'rock',  modelKind: 'RockCluster', slots: 2, scaleMin: 1.0,  scaleMax: 1.5,  footprint: 12 },
      { role: 'grass', modelKind: 'GrassTuft',   slots: 2, scaleMin: 0.8,  scaleMax: 1.2,  footprint: 6 },
    ] },
  },

  // —— 标签布局（★ S4-06，STAGE-04-TODO §4.6；label-layout.js / render_world.js / render_agents.js 消费）——
  // 世界画布文字统一候选层：pinned（实体锚定标记）恒接受占格；ordinary（可省略文字）
  // 依次尝试 [首选/锚点镜像/正右/正左] 固定备选位，屏幕网格冲突 + UI 禁入矩形，全败即省略。
  // 本段为**纯渲染配置**，不进 SIM_CONFIG、不经 applyConfig 注入 WASM；关态完整回退旧直接绘制。
  labelLayoutEnabled: true,       // 总开关（false = 全部文字走 v1.50.51 旧直接绘制路径；纯前端开关）
  labelGridCellSize: 48,          // 屏幕冲突网格单元边长（CSS px；矩形相交查询先取单元再精确 AABB）
  labelMaxProposals: 160,         // 每帧普通标签提案上限（超出按收集序丢弃；pinned 恒受实体数约束）
  labelRectPadPx: 2,              // 标签矩形四周外扩余量（CSS px，相交判定保守侧）
  labelSidePadPx: 10,             // 左右备选位与锚点的水平间距（CSS px）
  labelUiRefreshFrames: 10,       // UI 禁入矩形重测帧间隔（DOM getBoundingClientRect 节流；resize 立即重测）
  labelUiRectIds: ['top-bar', 'inspector-card', 'ledger-panel', 'global-averages-card', 'global-resource-panel'], // UI 禁入矩形元素 ID 列表（避开覆盖区；隐藏/折叠元素自动跳过）
  // 旧硬编码 LOD 阈值收编（STAGE-04-TODO §6.3：POI 名称 z>0.50 / 库存环 z≥0.70 / 房屋编号 z>1.05）
  labelPoiNameMinZoom: 0.50,      // 营地名称/舍数显示的最小缩放（原 drawPoiMarker 硬编码）
  labelStockRingMinZoom: 0.70,    // POI 库存环显示的最小缩放（原 showDetailRings 硬编码；选中态恒显示）
  labelHouseNumberMinZoom: 1.05,  // 房屋编号显示的最小缩放（原 drawHouse showLabels 硬编码；选中态恒显示）
  // ★ S4-07 聚合与交互兜底（STAGE-04-TODO §4.7；label-layout.js / render_inspector.js 消费）
  labelClusterEnabled: true,      // 聚合总开关（低缩放/拥挤时同类普通标签聚合为数量徽标）
  labelClusterMaxZoom: 0.95,      // 触发房屋标签聚合的最高缩放门槛（<= 此缩放或近邻密集时聚合）
  labelClusterRadiusPx: 36,       // 屏幕聚类半径（CSS px；同类普通标签在此距离内聚合）
  labelHysteresisPx: 4,           // 有限布局滞回裕量（CSS px；消除缓慢平移时的临界跳位抖动）
  labelLeaderLineEnabled: true,   // 边缘兜底引线开关（绘制从实体到边缘提示区的引线）

  // —— 地形共面网格贪婪合并 (Terrain Quad Meshing) ——
  terrainMeshMerge: {
    enabled: true,          // 是否开启近似方向/共面四边形合并
    maxSpan: 8,             // 合并矩形单边最大网格跨度 (建议 4~8 格，防深度穿插)
    normalAngleDeg: 2.0,    // 法线方向近似角差容差 (度，cosθ >= cos(2°))
    planeElevTol: 0.5,      // 平面共面高程容差 (米)
    sameSurfaceKind: true,  // 严格限制同材质类型 (草地/岩壁/浅滩等不跨类合并)
    pathBatching: true,     // 方案 A：地形同色路径合批 (连续同色单元合并至单次 fill)
  },

  // —— 地表反照率数据层平滑（★ v1.50.74 地表贴图插值；math.js::smoothAlbedoField 消费）——
  // 世界建缓存时对 albR/G/B 做边缘感知盒式模糊（半径 r 格）：陆地格间硬色阶变连续
  // 渐变；水格（DeepWater/ShallowWater）作屏障不混色，水陆边界无晕圈。
  // 建缓存一次性消费（~几 ms），每帧零成本；relightTerrain 与 TerrainTexture 色档自动拾取。
  // ⚠️ 改值需重开世界/刷新页面生效（不随帧重建）；0 = 关（回退原始逐格色场）。
  terrainAlbedoSmoothRadius: 2,
};
