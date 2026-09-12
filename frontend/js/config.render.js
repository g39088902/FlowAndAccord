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

  // —— 装饰树木季节叶色（★ 2026-09-12 落地，accent-season.js::SimTreeTint 消费；v1.50.23 自 render_terrain.js 迁出）——
  // 年相位 u 的定义与 lighting.js::phaseFromSnapshot 完全一致（同一真相源：快照 season +
  // season_progress，缺字段回退 seasonTimer / seasonYearLength）：春 0.00 / 夏 0.25 / 秋 0.50 / 冬 0.75。
  // 叶色档只有 3 档可用（drawAccentTree 的既定调色板）：0=鲜绿(春夏) / 1=黄绿(秋) / 2=红褐(深秋·冬)。
  treeTintCycle: [            // 枯荣系数 b 的分段线性年历：0=鲜绿，1=枯褐
    { u: 0.000, b: 0.00 },    // 春：返青完成
    { u: 0.375, b: 0.00 },    // 夏末：全绿保持
    { u: 0.500, b: 0.55 },    // 中秋：初黄
    { u: 0.625, b: 1.00 },    // 深秋：红褐
    { u: 0.875, b: 1.00 },    // 冬末：枯褐保持（无落叶/光秃形态，故冬季沿用红褐档）
    { u: 0.970, b: 0.00 },    // 初春：返青（0.97→1.00 与 u=0 的 b=0 恰好衔接，无跳变）
  ],
  treeTintYellowBand: 0.32,   // b ≥ 此值 → 黄绿档；低于则为鲜绿档（两档分界）
  treeTintRedBand: 0.72,      // b ≥ 此值 → 红褐档
  treeTintJitterTurns: 0.05,  // 逐树相位抖动幅度（年相位比例，按 accent.id 确定性派生）
                              // 目的：避免成片树在同一帧整体换色「整片闪一下」，林相错落更自然

  // —— 局部三维植被样板（纯表现层；见 docs/plan/tech/07-terrain-art.md §6.1/6.2）——
  accentModelStyleVersion: 1,
  accentDetailNearPx: 15,     // 近景：细枝、完整叶簇
  accentDetailMidPx: 7,       // 中景：主枝与主要叶簇
  accentLeafClustersTree: 16, // 每棵树稳定叶簇数（由 id 派生，不进快照）
  accentLeafClustersBush: 8,
  accentEvergreenChance: 0.24,// 现有 Tree/Bush 无物种字段时的稳定哈希变体比例
};
