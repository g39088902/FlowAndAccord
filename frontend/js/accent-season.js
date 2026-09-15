// === Accent 连续季相（TA-02；★ TA-06-2 清理兼容接口）===
// SimTreeTint 是 Tree/Bush 季相唯一生产者。只读快照，不累计帧状态、不用墙钟/RNG。
// sample(accent, sim, profile?) 返回 0..1 叶/芽/花/落叶量与浮点 RGB 反照率。
// profile: deciduousTree / deciduousBush / evergreen / floweringBush；省略时按 kind。
// ★ TA-06 起物种与 profile 由 accent-model.js::speciesOf 派生（模型对象 model.profile 为
// 单一入口）；花灌木首次真实消费 floweringBush（叶历沿用落叶灌木 + accentFlowerCycle 覆写花量）。
// 曲线本身不改（07 号 §6.3：物种分配只负责把正确 profile 送进来）。几何落叶属于 TA-03。
// 依赖 config.render.js 与 accent-model.js（渲染期均已加载）。
window.SimTreeTint = window.SimTreeTint || (function () {
  const SEASON_INDEX = { Spring: 0, Summer: 1, Autumn: 2, Winter: 3 };
  const cfg = () => window.RENDER_CONFIG;
  const wrap01 = v => v - Math.floor(v);
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // 与 lighting.js 的原始快照公式同构；不能读经限速平滑的 SimLighting.phase()。
  function yearPhase(sim) {
    if (!sim) return 0;
    const idx = SEASON_INDEX[sim.currentSeason];
    if (idx != null && Number.isFinite(sim.seasonProgress)) {
      return wrap01((idx - 0.5 + clamp01(sim.seasonProgress)) / 4);
    }
    const year = (window.SIM_CONFIG && window.SIM_CONFIG.seasonYearLength) || 240;
    const t = Number.isFinite(sim.seasonTimer) ? sim.seasonTimer : 0;
    return wrap01(t / Math.max(1e-6, year));
  }

  // 环形区间查找，跨 1→0 使用真实间距插值，结点两侧一阶连续。
  function segment(cycle, u) {
    u = wrap01(Number.isFinite(u) ? u : 0);
    for (let i = 0; i < cycle.length; i++) {
      const a = cycle[i], b = cycle[(i + 1) % cycle.length];
      const end = i + 1 === cycle.length ? b[0] + 1 : b[0];
      const x = u < cycle[0][0] ? u + 1 : u;
      if (x >= a[0] && x <= end) {
        const t = clamp01((x - a[0]) / (end - a[0]));
        return { a, b, t: t * t * (3 - 2 * t) };
      }
    }
    return { a: cycle[0], b: cycle[0], t: 0 };
  }
  const mix = (a, b, t) => a + (b - a) * t;

  function phaseOffset(accent) {
    const configured = cfg().accentSeasonJitterTurns;
    const amp = Number.isFinite(configured) ? Math.max(0, Math.min(0.04, configured)) : 0;
    // 独立通道，kind/id 稳定；不把相位写进几何缓存，调参/恢复无需失效季相缓存。
    const channel = accent && accent.kind === 'Bush' ? 998 : 997;
    return (_accentHash((accent && accent.id) || 0, channel) - 0.5) * 2 * amp;
  }

  function sample(accent, sim, profile) {
    const profiles = cfg().accentSeasonProfiles;
    const fallback = accent && accent.kind === 'Bush' ? 'deciduousBush' : 'deciduousTree';
    const name = profile === 'floweringBush' ? 'deciduousBush' : profile;
    const cycle = profiles[name] || profiles[fallback];
    const u = wrap01(yearPhase(sim) + phaseOffset(accent));
    const { a, b, t } = segment(cycle, u);
    const value = index => clamp01(mix(a[index], b[index], t));
    let flowerAmount = value(4);
    if (profile === 'floweringBush') {
      const f = segment(cfg().accentFlowerCycle, u);
      flowerAmount = clamp01(mix(f.a[1], f.b[1], f.t));
    }
    return {
      leafDensity: value(1),
      leafColor: a[2].map((c, i) => mix(c, b[2][i], t)),
      budAmount: value(3), flowerAmount,
      litterAmount: value(5), brownness: value(6),
    };
  }

  // 迁移期兼容：复用同一条年历，不能再维护旧 treeTintCycle。
  function brownness(u) {
    const { a, b, t } = segment(cfg().accentSeasonProfiles.deciduousTree, u);
    return clamp01(mix(a[6], b[6], t));
  }
  // ★ TA-06-2：旧 tint() 三档量化兼容接口连同 treeTintYellowBand/treeTintRedBand 一并删除
  //（全仓无消费点；07 号 §6.3 要求迁移完成后统一清理，避免两套年历并存）。
  return { yearPhase, sample, brownness };
})();
