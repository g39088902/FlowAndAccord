/*
 * Flow & Accord · 前端渲染表现层配置（★ v1.50.15 从 render_world.js 硬编码抽出）
 * ============================================================================
 * 本文件只承载**纯前端表现层**参数（不参与仿真、不消耗 WorldRng、不入快照）。
 *
 * ⚠️ 为什么不放进 config.js：config.js 与 Rust SimConfig 由 tools/config-check.js
 *   严格互检（字段一一对应，多写的键按孤儿报错），渲染参数不属于仿真超参，
 *   故按 config.lighting.js / config.poi-rates.js 的先例独立成文件。
 *   本文件必须在 render_world.js 之前加载（index.html 已保证）。
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
};
