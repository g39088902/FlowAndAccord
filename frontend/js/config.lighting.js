// === 动态季节光照配置（前端独立配置） ===
// 方案：docs/current/tech/51-seasonal-lighting.md（年周期光弧：一年转一圈，四季各占一个象限）
// 定位：纯表现层数值，不注入 WASM、不并入 SIM_CONFIG（并入会与 SimConfig 字段集比对冲突）。
// 加载顺序：config.js 之后、lighting.js 与渲染五件套之前。
// 口径（已确认）：光向一年扫过 360°；春=东 / 夏=南 / 秋=西 / 冬=北；盛夏光强、隆冬光弱。
(function () {
  'use strict';
  window.SIM_LIGHTING = {
    // 总开关：false = 退回 v1.47.11 的固定光（西北 41°），用于 A/B 对照
    enabled: true,

    // ── 光位 ──
    // 罗盘方位 β = 360°·u + 该偏移；90° ⇒ 季分箱中心（u = 0/0.25/0.5/0.75）恰为
    // 春=东(90°) / 夏=南(180°) / 秋=西(270°) / 冬=北(0°)，每季光弧的均值即该正方向。
    azimuthOffsetDeg: 90.0,
    elevMinDeg: 22.0,         // 隆冬最低高度角
    elevMaxDeg: 72.0,         // 盛夏最高高度角
    elevPhaseTurns: 0.25,     // 高度角峰值所在的年度相位（0.25 = 盛夏分箱中心）

    // ── 强度与环境项 ──
    ambientBase: 0.40,        // 环境项基线
    ambientElevGain: 0.18,    // 环境项随高度角增益（日头越高对比越平）
    wrap: 0.35,               // 半兰伯特环绕宽度（背光面不至纯黑）
    lightMin: 0.45,           // 光因子下限
    lightMax: 1.30,           // 光因子上限
    intensity: { spring: 1.00, summer: 1.08, autumn: 1.02, winter: 0.90 },

    // ── 光色温（四季连续插值，不在季界跳变） ──
    tint: {
      spring: [1.00, 1.02, 0.99],
      summer: [1.06, 1.02, 0.90],
      autumn: [1.10, 0.99, 0.86],
      winter: [0.94, 0.99, 1.08],
    },
    tempTintPerDeg: 0.03,     // 气温偏差（含厄尔尼诺/纪元候波）→ 暖冷光色微调

    // ── 阴影 ──
    shadowLenMin: 0.35,       // 阴影长度 = clamp(cot e)（盛夏短、隆冬长）
    shadowLenMax: 2.40,
    shadowOpacityBase: 0.18,  // 阴影浓度基线
    shadowOpacityGain: 0.12,  // 低日头加浓
    houseShadowHeight: 3.0,   // 房屋等效世界高度 (m)
    agentShadowHeight: 1.6,   // 族人等效世界高度 (m)
    poiShadowHeight: 0.9,     // POI 底座等效世界高度 (m)
    campShadowHeight: 1.2,    // 营地底座等效世界高度 (m)

    // ── 性能与限速 ──
    lightStepsPerYear: 144,   // 光档数（2.5°/档），档位变化才整片重着色
    rateCapDegPerSec: 90.0,   // 视觉相位限速（最快 4 秒一圈，防高倍速频闪）

    // ── 氛围 ──
    skyWash: 0.055,           // 大气色洗不透明度
    respectLightTheme: true,  // 浅色 UI 下减轻天空暗部与色洗

    // 旧固定光方向（enabled=false 时使用；西北 41°，与 v1.47.11 一致）
    legacyDir: [-0.45, -0.60, 0.66],
  };
})();
