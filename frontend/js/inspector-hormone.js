// ★ H-06 激素观察面板与趋势采样器（自 render_inspector.js 拆出）
// window.HormoneTrend 由 rustworld.js 在世界生命周期时 reset；
// _hormoneTrendAgentId 由 render_inspector.js 调度层在选中对象变化时维护。
// ★ H-06 四轴十一激素定义（与 snapshot.rs::HormoneSnapshot levels/baselines 顺序严格一致）
// axis: 奖赏-情绪 / 应激 / 生殖 / 代谢；temperament 未实现，故无气质项（H-20 后补）
const HORMONE_DEFS = [
  { idx: 0, key: 'da',   label: 'DA 多巴胺',     axis: 'reward',  color: '#fbbf24' },
  { idx: 2, key: 's5ht', label: '5-HT 血清素',   axis: 'reward',  color: '#38bdf8' },
  { idx: 3, key: 'ep',   label: 'EP 内啡肽',     axis: 'reward',  color: '#34d399' },
  { idx: 4, key: 'ot',   label: 'OT 催产素',     axis: 'reward',  color: '#f472b6' },
  { idx: 5, key: 'cort', label: 'CORT 皮质醇',   axis: 'stress',  color: '#f87171' },
  { idx: 6, key: 'adr',  label: 'ADR 肾上腺素',  axis: 'stress',  color: '#fb923c' },
  { idx: 7, key: 'ne',   label: 'NE 去甲肾上腺素', axis: 'stress', color: '#a78bfa' },
  { idx: 8, key: 'and',  label: 'AND 雄激素',    axis: 'repro',   color: '#f97316' },
  { idx: 9, key: 'est',  label: 'EST 雌激素',    axis: 'repro',   color: '#ec4899' },
  { idx: 10, key: 'prog', label: 'PROG 孕激素',  axis: 'repro',   color: '#c084fc' },
  { idx: 11, key: 'thy', label: 'THY 甲状腺素',  axis: 'meta',    color: '#2dd4bf' },
];
const HORMONE_AXIS_LABELS = {
  reward: '💊 奖赏-情绪轴', stress: '🔥 应激轴', repro: '🧬 生殖轴', meta: '⚙️ 代谢轴',
};
// DA 奖赏阈值单独标示（levels[1] / baselines[1]），不计入十一激素
const HORMONE_DA_THRESHOLD_IDX = 1;

// ★ H-06 激素趋势采样器：趋势 = 相同世界/Agent 的两个样本 ÷ 实际 tick 差。
// 1 tick = simulationDt(1/60) 游戏小时，速率与倍速/快照间隔无关；
// 同 tick 不做差分；tick 回退（读档/回溯）兜底重置该 agent 样本。
const HormoneTrend = (() => {
  const samples = new Map(); // agentId -> { tick, vals: number[] }
  return {
    /** 采样并返回各激素速率 (/游戏小时)；tick 未前进时返回 null（不做同 tick 差分） */
    sample(agentId, tick, vals) {
      const prev = samples.get(agentId);
      let rates = null;
      if (prev) {
        if (tick < prev.tick) {
          // tick 回退（读档/回溯/换世界兜底）：丢弃旧样本，本拍不产出速率
          samples.set(agentId, { tick, vals: vals.slice() });
          return null;
        }
        if (tick > prev.tick) {
          const hours = (tick - prev.tick) * (sim.simulationDt || 1 / 60);
          rates = vals.map((v, i) => (v - prev.vals[i]) / hours);
        }
      }
      // 存副本而非引用：上游若原地复用 levels 数组，引用会让 prev.vals 恒等于当前值 → 恒 0 假趋势
      samples.set(agentId, { tick, vals: vals.slice() });
      return rates;
    },
    /** 世界生命周期（READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE）与选中对象变化时清理 */
    reset() { samples.clear(); },
  };
})();
window.HormoneTrend = HormoneTrend;
// ★ H-06 上一拍选中的 agent（选中对象变化时清理趋势缓存）
let _hormoneTrendAgentId = null;

/** 惰性构建激素面板计量行（一次构建，后续只更新 textContent/width，避免高频 innerHTML） */
function _ensureHormoneRows() {
  const rowsEl = document.getElementById('insp-hormone-rows');
  if (!rowsEl || rowsEl.childElementCount > 0) return;
  let lastAxis = null;
  for (const def of HORMONE_DEFS) {
    if (def.axis !== lastAxis) {
      const axisEl = document.createElement('div');
      axisEl.style.cssText = 'font-size:8.5px; color:#64748b; font-weight:700; margin-top:2px;';
      axisEl.textContent = HORMONE_AXIS_LABELS[def.axis];
      rowsEl.appendChild(axisEl);
      lastAxis = def.axis;
    }
    const row = document.createElement('div');
    row.innerHTML = `
      <div class="meter-label" style="font-size:9px;">
        <span>${def.label}</span>
        <span class="mono-num" id="insp-hormone-val-${def.key}" style="color:${def.color};">—</span>
      </div>
      <div class="meter-bg"><div class="meter-fill" id="insp-hormone-fill-${def.key}" style="background:${def.color}; width:0%;"></div></div>`;
    rowsEl.appendChild(row);
  }
  // DA 奖赏阈值单独标示行（不是第十二种激素）
  const th = document.createElement('div');
  th.innerHTML = `
    <div class="meter-label" style="font-size:9px; margin-top:3px;">
      <span>🎯 DA 奖赏阈值 <span style="color:#64748b;">(适应漂移·非激素)</span></span>
      <span class="mono-num" id="insp-hormone-val-dathr" style="color:#e2e8f0;">—</span>
    </div>
    <div class="meter-bg"><div class="meter-fill" id="insp-hormone-fill-dathr" style="background:#94a3b8; width:0%;"></div></div>`;
  rowsEl.appendChild(th);
}

/** ★ H-06 激素面板更新（P0 只读观察；仅展示个体状态，气质功能未实现时无气质项）。
 *  ★ v1.50.65 面板 DOM 已自 Inspector 迁入「详细档案与族谱」模态（#lineage-modal 内
 *  .lineage-hormone-block），本函数仅负责数据驱动；模态关闭时随父级 display:none 隐藏。 */
function updateHormonePanel(selAgent, worldTick) {
  const box = document.getElementById('insp-hormone-box');
  if (!box) return;
  const h = selAgent.hormones;
  if (!h || !h.levels || !h.baselines) {
    box.style.display = 'none';
    return;
  }
  // ★ v1.50.65 面板迁入族谱模态后仍用 'block' 块级堆叠（模态 body 为 flex column，
  // box 作为普通块级子项参与纵向排布）。历史教训：v1.50.63 前用 'flex' 未设
  // flex-direction，默认 row 把标题挤成左侧竖条、计量行偏右，视觉上像独立小窗。
  box.style.display = 'block';
  _ensureHormoneRows();

  // 趋势采样：levels[1] 即 DA 阈值，速率按同下标复用（数组直传避免每帧分配）
  const rates = HormoneTrend.sample(selAgent.id, worldTick || 0, h.levels);

  const setMeter = (key, level, baseline, rate) => {
    const valEl = document.getElementById(`insp-hormone-val-${key}`);
    const fillEl = document.getElementById(`insp-hormone-fill-${key}`);
    if (!valEl || !fillEl) return;
    valEl.textContent = `${level.toFixed(1)} / 基线${baseline.toFixed(1)}`;
    fillEl.style.width = `${Math.max(0, Math.min(100, level))}%`;
    fillEl.title = rate !== null && rate !== undefined
      ? '每小时变化 ' + _fmtRate(rate)
      : '等待下一拍采样';
  };
  for (const def of HORMONE_DEFS) {
    const i = def.idx;
    setMeter(def.key, h.levels[i], h.baselines[i], rates ? rates[i] : null);
  }
  // DA 阈值独立标示（速率与 levels[1] 同源）
  setMeter('dathr', h.levels[HORMONE_DA_THRESHOLD_IDX], h.baselines[HORMONE_DA_THRESHOLD_IDX], rates ? rates[HORMONE_DA_THRESHOLD_IDX] : null);

  // 状态标签（游戏规则标签，非医学判断）：慢性压力 / 营养不足 / NE 焦虑 / 余韵窗口
  const labelsEl = document.getElementById('insp-hormone-labels');
  const statusEl = document.getElementById('insp-hormone-status');
  if (labelsEl) {
    const parts = [];
    if ((h.chronicStress || 0) > 1) parts.push(`<span style="color:#f87171;">慢性压力 ${h.chronicStress.toFixed(0)}</span>`);
    if ((h.nutritionDeficit || 0) > 1) parts.push(`<span style="color:#fbbf24;">营养不足 ${h.nutritionDeficit.toFixed(0)}</span>`);
    if (h.anxious) parts.push('<span style="color:#a78bfa;">焦虑警觉</span>');
    const timerNames = ['EP崩解', 'ADR疲劳', '产后脆弱'];
    for (let i = 0; i < 3; i++) {
      const t = (h.crashTimers && h.crashTimers[i]) || 0;
      if (t > 0) parts.push(`<span style="color:#fb923c;">${timerNames[i]} ${t}t</span>`);
    }
    labelsEl.innerHTML = parts.length ? parts.join(' · ') : '—';
  }
  if (statusEl) {
    statusEl.textContent = h.anxious ? '焦虑' : ((h.chronicStress || 0) > 50 ? '高压' : '平稳');
    statusEl.style.color = h.anxious ? '#a78bfa' : ((h.chronicStress || 0) > 50 ? '#f87171' : '#10b981');
  }
}
