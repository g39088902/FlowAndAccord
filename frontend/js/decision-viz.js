/* ==========================================================================
 * Flow & Accord · 马斯洛决策引擎集成层 (decision-viz.js)
 * --------------------------------------------------------------------------
 * 职责（唯一与内核/配置打交道的决策视图层）：
 *   1) 启动时把 config.decision-order.js（或本地未落盘副本）合并进 window.SIM_CONFIG，
 *      保证 rustworld.js 首次 applyConfig 之前顺序已就位；
 *   2) 拖动卡片/分界线松手 → 计算层级覆盖 → 经 rustWorld.applyConfig() 热注入运行中的 WASM；
 *   3) 将用户的顺序与分界线配置保存到浏览器 localStorage。
 * ========================================================================== */
(function (global) {
  'use strict';

  var D = global.SIM_DECISION_VIZ_DATA;
  // ★ v1.29.0 编码迁移：0 由「保留代码动态默认」改为「⓪ 瞬间行为」，动态默认哨兵改为 6
  var STORE_KEY = 'flowaccord.decision-order.v2';
  var LEGACY_STORE_KEY = 'flowaccord.decision-order.v1';
  var DYNAMIC_DEFAULT = 6;   // 层级覆盖哨兵：保留分支自带的代码动态默认
  var LV_MAX = 5;            // 最大合法层级码（⓪ 瞬间 … ⑤ 自我实现）
  var IDS = {
    overlay: 'decision-viz-overlay',
    viewport: 'dviz-viewport',
    world: 'dviz-world',
    nodes: 'dviz-nodes',
    inspEmpty: 'dviz-insp-empty',
    inspCard: 'dviz-insp-card',
    statusTip: 'dviz-status'
  };

  // 兜底层级数组：全部「保留代码动态默认」（v1.29.0 起哨兵为 6，不再使用 0）
  var zeros = Object.keys(D.BRANCH_MAP || {}).map(function () { return DYNAMIC_DEFAULT; });
  var state = { order: [], divGaps: [], levels: [] };
  var lastGood = null;
  var mounted = false;

  // ── 校验与推导工具 ───────────────────────────────────────────────────────
  function isValidOrder(a) {
    var n = Object.keys(D.BRANCH_MAP || {}).length;
    return Array.isArray(a) && a.length === n && new Set(a).size === n
      && a.every(function (s) { return D.BRANCH_MAP[s]; });
  }
  function isValidLevels(a) {
    var n = Object.keys(D.BRANCH_MAP || {}).length;
    return Array.isArray(a) && a.length === n
      && a.every(function (v) { return Number.isInteger(v) && v >= 0 && v <= 6; });
  }
  function defaultZone(id) { return D.BRANCH_MAP[id] ? D.BRANCH_MAP[id].level : 1; }
  /** 分区序号（1 起算，自上而下）→ 层级码（0 起算） */
  function zoneCode(divGaps, p) {
    var lv = 1;
    for (var j = 0; j < divGaps.length; j++) { if (divGaps[j] < p) lv++; }
    return lv - 1;
  }
  /** 层级覆盖：所在分区 == 分支代码默认层级 → DYNAMIC_DEFAULT（保留动态默认，如 b5/b6/b7 的 family_level）；否则强制覆盖 */
  function computeLevels(order, divGaps) {
    return order.map(function (id, i) {
      var code = zoneCode(divGaps, i + 1);
      return code === defaultZone(id) ? DYNAMIC_DEFAULT : code;
    });
  }
  /** 生效层级：0-5 为强制层级码，6/缺失/非法 = 保留代码动态默认。
   *  ⚠️ 0 已是合法层级（⓪ 瞬间行为），不可用 `levels[i] || default` 的 falsy 短路。 */
  function effectiveLevel(levels, id, i) {
    var v = levels[i];
    return Number.isInteger(v) && v >= 0 && v <= LV_MAX ? v : defaultZone(id);
  }
  /** 由「顺序 + 层级覆盖」反推分界线位置（每层至少 1 张、分界严格递增）；分区数 = LV 档数 */
  function deriveDivGaps(order, levels) {
    var eff = order.map(function (id, i) { return effectiveLevel(levels, id, i); });
    var gaps = [], prev = 0;
    var n = order.length;
    var divs = Object.keys(D.LV || {}).length - 1; // 分界线数 = 分区数 - 1（v1.29.0：6 区 5 线）
    for (var k = 1; k <= divs; k++) {
      var cnt = 0;
      for (var i = 0; i < n; i++) { if (eff[i] <= k - 1) cnt++; }
      var g = Math.max(cnt, prev + 1, k);
      g = Math.min(Math.max(g, 1), (n - 1) - (divs - k));
      gaps.push(g); prev = g;
    }
    return gaps;
  }

  function loadPending() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (o && o.schema === 1 && isValidOrder(o.decisionEvalOrder) && isValidLevels(o.decisionEvalLevels)) return o;
    } catch (e) { /* ignore */ }
    return null;
  }
  /** ★ v1.29.0 旧键迁移：v1 的 0（保留动态默认）→ 6；1-5 语义不变。迁移后写入 v2 并清除旧键。 */
  function loadLegacy() {
    try {
      var raw = localStorage.getItem(LEGACY_STORE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !isValidOrder(o.decisionEvalOrder)) return null;
      var lv = Array.isArray(o.decisionEvalLevels)
        ? o.decisionEvalLevels.map(function (v) { return v === 0 ? DYNAMIC_DEFAULT : v; })
        : zeros.slice();
      if (!isValidLevels(lv)) lv = zeros.slice();
      return { decisionEvalOrder: o.decisionEvalOrder.slice(), decisionEvalLevels: lv };
    } catch (e) { /* ignore */ }
    return null;
  }
  function savePending(o) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ schema: 1, decisionEvalOrder: o.decisionEvalOrder, decisionEvalLevels: o.decisionEvalLevels, savedAt: Date.now() })); } catch (e) { /* ignore */ }
  }
  function clearPending() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  }

  // ── ① 启动合并：顺序真相源 → window.SIM_CONFIG ───────────────────────────
  function mergeIntoSimConfig() {
    var cfg = global.SIM_CONFIG;
    if (!cfg) return;
    var file = global.SIM_DECISION_ORDER;
    var pending = loadPending();
    if (!pending) {
      // ★ v1.29.0 旧键（v1）迁移：0（动态默认）→ 6 后写入 v2 并清除旧键，避免重复迁移
      var legacy = loadLegacy();
      if (legacy) {
        savePending(legacy);
        try { localStorage.removeItem(LEGACY_STORE_KEY); } catch (e) { /* ignore */ }
        pending = legacy;
        console.info('[DecisionViz] 已将本机顺序配置迁移到 v2 编码（0=⓪瞬间行为 / 6=保留动态默认）');
      }
    }
    var src = null;
    if (pending) src = pending;
    else if (file && isValidOrder(file.decisionEvalOrder)) src = file;
    if (!src) {
      console.warn('[DecisionViz] 顺序配置无效或缺失，回退出厂策展顺序（请检查 config.decision-order.js）');
      src = { decisionEvalOrder: D.DEFAULT_ORDER.slice(), decisionEvalLevels: zeros.slice() };
    }
    state.order = src.decisionEvalOrder.slice();
    state.levels = isValidLevels(src.decisionEvalLevels) ? src.decisionEvalLevels.slice() : zeros.slice();
    state.divGaps = deriveDivGaps(state.order, state.levels);
    cfg.decisionEvalOrder = state.order.slice();
    cfg.decisionEvalLevels = state.levels.slice();
    lastGood = snapshot();
    if (pending) console.info('[DecisionViz] 已载入本机未落盘的顺序修改（静态环境降级）');
  }

  function snapshot() {
    return { order: state.order.slice(), divGaps: state.divGaps.slice(), levels: state.levels.slice() };
  }
  function rollbackTo(snap) {
    state.order = snap.order.slice();
    state.divGaps = snap.divGaps.slice();
    state.levels = snap.levels.slice();
  }

  // ── ② 提交：热注入 + 落盘 ───────────────────────────────────────────────
  function commit() {
    var cfg = global.SIM_CONFIG;
    state.levels = computeLevels(state.order, state.divGaps);
    cfg.decisionEvalOrder = state.order.slice();
    cfg.decisionEvalLevels = state.levels.slice();

    var sim = global.rustWorldSim;
    if (sim && sim._ready && typeof sim.applyConfig === 'function') {
      var ok = sim.applyConfig();
      if (ok !== true) {
        // 注入失败：回滚本地顺序与配置，避免前端与内核不一致
        rollbackTo(lastGood);
        cfg.decisionEvalOrder = state.order.slice();
        cfg.decisionEvalLevels = state.levels.slice();
        if (mounted) global.DecisionVizView.setState(state.order, state.divGaps, state.levels);
        flash('❌ 热注入失败，已回滚到上一次生效顺序', 'err');
        return;
      }
    }

    var payload = { decisionEvalOrder: state.order, decisionEvalLevels: state.levels };
    savePending(payload);
    lastGood = snapshot();
    flash('✅ 已热注入内核并保存到本浏览器', 'ok');
  }

  function flash(text, tone) {
    var s = document.getElementById(IDS.statusTip);
    if (!s) return;
    s.textContent = text;
    s.style.color = tone === 'ok' ? '#4ade80' : (tone === 'warn' ? '#fbbf24' : (tone === 'err' ? '#ef4444' : '#8aa0b5'));
    s.style.borderColor = tone === 'ok' ? 'rgba(74,222,128,.45)' : (tone === 'warn' ? 'rgba(251,191,36,.45)' : (tone === 'err' ? 'rgba(239,68,68,.5)' : 'rgba(255,255,255,.14)'));
  }

  // ── ③ 覆盖层开关 ───────────────────────────────────────────────────────
  function open() {
    var ov = document.getElementById(IDS.overlay);
    if (!ov) return;
    ov.style.display = 'flex';
    if (!mounted) {
      global.DecisionVizView.mount(IDS, state, { onCommit: commit, onStatus: function () { } });
      mounted = true;
    }
    setTimeout(function () { global.DecisionVizView.fit(); }, 30);
  }
  function close() {
    var ov = document.getElementById(IDS.overlay);
    if (ov) ov.style.display = 'none';
  }
  function isOpen() {
    var ov = document.getElementById(IDS.overlay);
    return !!ov && ov.style.display !== 'none' && ov.style.display !== '';
  }

  function bindUi() {
    var btn = document.getElementById('btn-decision-viz');
    if (btn) btn.addEventListener('click', function () { isOpen() ? close() : open(); });
    var closeBtn = document.getElementById('dviz-btn-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
    var btnFit = document.getElementById('dviz-btn-fit');
    if (btnFit) btnFit.addEventListener('click', function () { global.DecisionVizView.fit(); });
    var btnReset = document.getElementById('dviz-btn-reset');
    if (btnReset) btnReset.addEventListener('click', function () {
      state.order = D.DEFAULT_ORDER.slice();
      state.levels = state.order.map(function () { return DYNAMIC_DEFAULT; });
      state.divGaps = D.DEFAULT_DIVGAPS.slice();
      global.DecisionVizView.setState(state.order, state.divGaps, state.levels);
      commit();
      flash('↺ 已重置为出厂策展顺序并热注入', 'ok');
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && isOpen()) { close(); e.stopPropagation(); }
    });
  }

  mergeIntoSimConfig();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi);
  else bindUi();

  global.DecisionViz = { open: open, close: close, state: function () { return snapshot(); } };
})(window);
