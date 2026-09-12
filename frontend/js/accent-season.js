// === Accent 季相层（TA-01，docs/plan/tech/07-terrain-art.md §6.7）===
// 装饰树木季节叶色的**唯一生产者** window.SimTreeTint（v1.50.23 从 render_terrain.js 原位迁出，
// 迁移零行为变更）。只负责季相年历与物种曲线；后续 TA-02 将在本文件扩展 sample()
// 连续叶色/叶量生产器（替代三档映射），TA-06 在此加物种曲线。
//
// ★ 背景（勿重犯）：v1.48.0~2026-09-12 期间 SimTreeTint 全仓无赋值点，drawAccentEntity
//   的判据恒假 → 树木四季同色（死分支事故，见 frontend/AGENTS.md §5.11）。
//   **新增消费方只能读 window.SimTreeTint，不得另建季节色逻辑。**
//
// 契约：
// - 纯表现层：不消耗 WorldRng、不写模拟状态、不入快照、不参与内核确定性承诺。
// - 真相源 = 快照年相位（与 lighting.js 同一套 season/season_progress 公式），严禁另建计时器。
// - 调参走 window.RENDER_CONFIG.treeTint*（config.render.js），改完刷新浏览器即生效。
// - 依赖 _accentHash（定义在 accent-model.js；全局函数声明，渲染期调用时两文件均已加载）。
window.SimTreeTint = window.SimTreeTint || (function () {
  const SEASON_INDEX = { Spring: 0, Summer: 1, Autumn: 2, Winter: 3 };
  const DEFAULT_CYCLE = [
    { u: 0.000, b: 0.00 },   // 春：返青完成
    { u: 0.375, b: 0.00 },   // 夏末：全绿保持
    { u: 0.500, b: 0.55 },   // 中秋：初黄
    { u: 0.625, b: 1.00 },   // 深秋：红褐
    { u: 0.875, b: 1.00 },   // 冬末：枯褐保持
    { u: 0.970, b: 0.00 },   // 初春：返青
  ];

  function cfg() { return window.RENDER_CONFIG || {}; }
  function wrap01(v) { return v - Math.floor(v); }

  // 年相位（唯一真相源 = 快照；缺字段时回退 seasonTimer / seasonYearLength）
  // 内核分箱：season_idx = ((season_time + q/2) / q) % 4 ⇒ u = (idx − 0.5 + progress) / 4
  function yearPhase(sim) {
    if (!sim) return 0;
    const idx = SEASON_INDEX[sim.currentSeason];
    const prog = (typeof sim.seasonProgress === 'number' && isFinite(sim.seasonProgress))
      ? sim.seasonProgress : null;
    if (idx != null && prog != null) return wrap01((idx - 0.5 + prog) / 4);
    const year = (window.SIM_CONFIG && window.SIM_CONFIG.seasonYearLength) || 240;
    const t = (typeof sim.seasonTimer === 'number' && isFinite(sim.seasonTimer)) ? sim.seasonTimer : 0;
    return wrap01(t / Math.max(1e-6, year));
  }

  // 枯荣系数：0 = 鲜绿，1 = 枯褐（分段线性，年历由 RENDER_CONFIG.treeTintCycle 提供）
  function brownness(u) {
    const cycle = cfg().treeTintCycle || DEFAULT_CYCLE;
    if (!cycle || cycle.length === 0) return 0;
    for (let i = 1; i < cycle.length; i++) {
      const a = cycle[i - 1], b = cycle[i];
      if (u <= b.u) {
        const span = b.u - a.u;
        const t = span > 1e-9 ? (u - a.u) / span : 0;
        return a.b + (b.b - a.b) * (t < 0 ? 0 : (t > 1 ? 1 : t));
      }
    }
    return cycle[cycle.length - 1].b;
  }

  // 逐树确定性相位抖动（纯视觉，通道 997 与叶纹理通道 i+1…i+167 互不重叠）
  function jitter(id) {
    const amp = cfg().treeTintJitterTurns != null ? cfg().treeTintJitterTurns : 0.05;
    return (_accentHash(id | 0, 997) - 0.5) * 2 * amp;
  }

  return {
    yearPhase: yearPhase,
    brownness: brownness,
    // 叶色档：0 鲜绿(春夏) / 1 黄绿(秋) / 2 红褐(深秋·冬)
    tint: function (accent, sim) {
      const u = wrap01(yearPhase(sim) + jitter((accent && accent.id) || 0));
      const b = brownness(u);
      const c = cfg();
      const yb = c.treeTintYellowBand != null ? c.treeTintYellowBand : 0.32;
      const rb = c.treeTintRedBand != null ? c.treeTintRedBand : 0.72;
      return b >= rb ? 2 : (b >= yb ? 1 : 0);
    },
  };
})();
