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
  // 花灌木复用落叶灌木叶历，只覆写开花量；物种分配与花朵绘制留给 TA-06/03。
  accentFlowerCycle: [[0.00, 1], [0.08, 0.55], [0.16, 0], [0.88, 0], [0.96, 0.65]],
  treeTintYellowBand: 0.32,   // tint() 兼容输出，正式绘制不再量化为三档
  treeTintRedBand: 0.72,

  // —— 局部三维植被骨架（TA-03，v1.50.25；补位簇夹紧枝端修复 v1.50.26；见 §6.2/6.4）——
  // 模型/叶簇/枝干为 accent.id 稳定哈希派生，不进快照；accent-model.js 消费。
  accentModelStyleVersion: 4,   // 骨架模型风格版本：调值即整体重建模型缓存（§10.2 缓存键契约；TA-11-4 芦草骨架形态变更 3→4）
  accentDetailNearPx: 15,     // 近景：二级枝、簇高光、春芽
  accentDetailMidPx: 7,       // 中景：主枝与全部叶簇；远景只保留树形与叶量
  accentLeafClustersTree: 16, // 每棵树稳定叶簇数（§6.4 建议 12~24；由 id 派生，不进快照）
  accentLeafClustersBush: 8,  // 每丛灌木稳定叶簇数（基生细茎端 + 茎中段）
  accentEvergreenChance: 0.24,// 现有 Tree/Bush 无物种字段时的稳定哈希常绿变体比例（TA-06 前过渡）

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
    // detailFadePx: [2,5] 归 TA-12-3 随 drawCell LOD 落地时登记（§4.2 特征尺度淡入区间）
  },

  // —— 资源景观（★ S4-02，STAGE-04-TODO §3.2；landscape-model.js / render_landscapes.js 消费）——
  // 围绕资源 POI 的前端确定性派生景观：模型只由世界 seed / POI 类型与坐标 / 静态地形 /
  // 配方固定盐值 / role / slot 派生；库存丰度 q 只驱动画面动态细节，绝不参与几何重抽。
  // 本段为**纯渲染配置**，不进 SIM_CONFIG、不经 applyConfig 注入 WASM；关态完整回退原画面。
  landscapeEnabled: true,       // 总开关（false = 零开销回退原画面路径；纯前端开关，禁写模拟事实）
  landscapeStyleVersion: 1,     // 景观配方风格版本（组缓存/模型缓存键组成部分；调值整体重建）
  landscapeCacheMaxGroups: 256, // 景观组模型缓存上限（超限整体清空，不 LRU；§3.2 有界缓存）
  landscapeFrameChildBudget: 420, // 每帧入队子图元（含阴影）硬上限；按固定遍历序截断（§3.4 预算）
  // —— 可采细节与贴地片（★ S4-04，STAGE-04-TODO §3.2/§3.4；landscape-model/render_landscapes 消费）——
  landscapeDetailQFloor: 0.2,   // detail 子图元 q 阈值映射区间下界（q ≥ threshold_i 才显示；骨架不受影响）
  landscapeDetailQCeil: 0.85,   // detail 子图元 q 阈值映射区间上界（threshold_i = floor + (ceil-floor)·(slot+0.5)/slots）
  landscapeGroundMaxSlopeDeg: 16, // GroundPatch 贴地片坡度拒绝阈值（度；格心+半径 0.7 四缘任一超限即拒绝，§3.4 跨陡坡不贴片）
  landscapeGroundWinterAlphaRatio: 0.6, // 冬季贴地片 alpha 乘数（积雪覆盖湿润/阴影观感）
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
    Water: { rMin: 24, rMax: 46, roles: [       // 陆侧岸石 + 低草 + 湿润土贴地片；水面候选由模型层拒绝（不画新泉池）
      { role: 'stone', modelKind: 'RockCluster', slots: 2, scaleMin: 0.55, scaleMax: 0.85, footprint: 10 },
      { role: 'grass', modelKind: 'GrassTuft',   slots: 4, scaleMin: 0.8,  scaleMax: 1.2,  footprint: 6 },
      { role: 'wet',   modelKind: 'GroundPatch', slots: 2, rMin: 30, rMax: 42, radiusMin: 6, radiusMax: 9, tone: 'wet' },
    ] },
    Wood: { rMin: 30, rMax: 60, roles: [        // 少量主树 + 林缘灌木 + 林下草 + 林下暗部；foliage=可采细节（q 显隐）；避让归 S4-03 遮罩
      { role: 'tree',    modelKind: 'Tree',        slots: 3, scaleMin: 0.9,  scaleMax: 1.35, footprint: 10.5 },
      { role: 'bush',    modelKind: 'Bush',        slots: 3, scaleMin: 0.7,  scaleMax: 1.1,  footprint: 8 },
      { role: 'grass',   modelKind: 'GrassTuft',   slots: 3, scaleMin: 0.8,  scaleMax: 1.2,  footprint: 6 },
      { role: 'shade',   modelKind: 'GroundPatch', slots: 2, radiusMin: 8,  radiusMax: 12, tone: 'shade' },
      { role: 'foliage', modelKind: 'Bush',        slots: 3, scaleMin: 0.45, scaleMax: 0.7, footprint: 8, stockRole: 'detail' },
    ] },
    Berry: { rMin: 22, rMax: 44, roles: [       // 不规则低灌木簇（采收中心保留原图标）
      { role: 'bush',  modelKind: 'Bush',        slots: 5, scaleMin: 0.7,  scaleMax: 1.1,  footprint: 8 },
      { role: 'grass', modelKind: 'GrassTuft',   slots: 2, scaleMin: 0.8,  scaleMax: 1.2,  footprint: 6 },
    ] },
    Stone: { rMin: 22, rMax: 42, roles: [       // 岩石露头 + 少量草（不画成阻路峭壁）
      { role: 'rock',  modelKind: 'RockCluster', slots: 2, scaleMin: 1.0,  scaleMax: 1.5,  footprint: 12 },
      { role: 'grass', modelKind: 'GrassTuft',   slots: 2, scaleMin: 0.8,  scaleMax: 1.2,  footprint: 6 },
    ] },
    Gold: { rMin: 22, rMax: 42, roles: [        // 岩石骨架（禁止整片发光/扩矿，归 S4-05 细节）
      { role: 'rock',  modelKind: 'RockCluster', slots: 2, scaleMin: 1.0,  scaleMax: 1.5,  footprint: 12 },
      { role: 'grass', modelKind: 'GrassTuft',   slots: 2, scaleMin: 0.8,  scaleMax: 1.2,  footprint: 6 },
    ] },
  },
};
