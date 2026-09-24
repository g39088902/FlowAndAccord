// ★ Inspector 共享计量与产速帮助层（自 render_inspector.js 拆出；须早于 inspector 各面板与生态大盘加载）
// ★ v1.9.0 进度条变化速率追踪（按游戏时间秒计量，悬停展示每秒变化量；Task1）
const _meterRateTracker = (() => {
  const buckets = {};
  return {
    push(key, value, gameDt) {
      const t = performance.now() / 1000;
      const b = buckets[key] || (buckets[key] = { prevVal: value, prevT: t, rate: 0 });
      const realDt = t - b.prevT;
      if (realDt > 0.6) {
        // 间隔过久（暂停/切卡/重开）：重置基准，不产出速率
        b.prevVal = value; b.prevT = t;
        return b.rate;
      }
      if (realDt > 0.02 && gameDt > 0) {
        const inst = (value - b.prevVal) / gameDt;
        // 忽略极端跳变（数值被重置/瞬移），用 EMA 平滑
        if (Math.abs(inst) < 60) b.rate = b.rate === 0 ? inst : b.rate * 0.6 + inst * 0.4;
      }
      b.prevVal = value; b.prevT = t;
      return b.rate;
    },
    reset(key) { if (buckets[key]) buckets[key].rate = 0; }
  };
})();
function _fmtRate(v) {
  if (!isFinite(v) || Math.abs(v) < 0.005) return '约 0.00/小时';
  return (v > 0 ? '+' : '') + v.toFixed(2) + '/小时';
}
// 每帧游戏时间增量（小时）＝ simulationDt × 倍速
const _gameDt = () => (sim.simulationDt || 1 / 60) * (sim.speedMult || 1);

// ★ v1.22.6 产速倍率槽位映射（唯一真相源为内核 sim.regenMultipliers）
// POI 快照的 regen_rate 只含**基准值**，实际再生 = 基准 × 倍率（见 world_tick.rs）。
// slot='primary' 取主资源槽位；slot='secondary' 仅榷场粮食有意义。
// ⚠ 榷场特例：清水走 water 槽位，粮食再生**复用 berry 槽位**（内核无独立粮食倍率）。
function poiRegenMultiplier(poiType, slot) {
  const m = (sim && sim.regenMultipliers) || {};
  const pick = k => (typeof m[k] === 'number' ? m[k] : 1.0);
  if (poiType === 'Water') return pick('water');
  if (poiType === 'Berry') return pick('berry');
  if (poiType === 'Wood') return pick('wood');
  if (poiType === 'Stone') return pick('stone');
  if (poiType === 'Gold') return pick('gold');
  if (poiType === 'Market') {
    if (slot === 'tertiary') return pick('wood');
    if (slot === 'secondary') return pick('berry');
    return pick('water');
  }
  return 1.0;
}
// 生效产速 = 内核基准产速 × 倍率（POI 卡片与生态大盘滑块标签共用，保证两处数字一致）
function effectiveRegenRate(baseRate, multiplier) {
  return (baseRate || 0) * (typeof multiplier === 'number' ? multiplier : 1.0);
}
