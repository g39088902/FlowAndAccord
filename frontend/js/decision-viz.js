/* ==========================================================================
 * Flow & Accord · 马斯洛决策引擎集成层 (decision-viz.js)
 * --------------------------------------------------------------------------
 * 职责（唯一与内核/配置打交道的决策视图层）：
 *   1) 启动时把 config.decision-order.js（或本地未落盘副本）合并进 window.SIM_CONFIG，
 *      保证 rustworld.js 首次 applyConfig 之前顺序已就位；
 *   2) 拖动卡片/分界线松手 → 计算层级覆盖 → 经 rustWorld.applyConfig() 热注入运行中的 WASM；
 *   3) 同步 POST /save-decision-order 落盘 config.decision-order.js（静态环境降级 localStorage）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var D = global.SIM_DECISION_VIZ_DATA;
  var STORE_KEY = 'decisionViz.pending.v1';
  var IDS = {
    overlay: 'decision-viz-overlay',
    viewport: 'dviz-viewport',
    world: 'dviz-world',
    nodes: 'dviz-nodes',
    layerNav: 'dviz-layer-nav',
    inspEmpty: 'dviz-insp-empty',
    inspCard: 'dviz-insp-card',
    statusTip: 'dviz-status'
  };

  var zeros = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var state = { order: [], divGaps: [], levels: [] };
  var lastGood = null;
  var mounted = false;

  // ── 校验与推导工具 ───────────────────────────────────────────────────────
  function isValidOrder(a) {
    return Array.isArray(a) && a.length === 13 && new Set(a).size === 13
      && a.every(function (s) { return D.BRANCH_MAP[s]; });
  }
  function isValidLevels(a) {
    return Array.isArray(a) && a.length === 13 && a.every(function (v) { return Number.isInteger(v) && v >= 0 && v <= 5; });
  }
  function defaultZone(id) { return D.BRANCH_MAP[id] ? D.BRANCH_MAP[id].level : 1; }
  function zoneOf(divGaps, p) {
    var lv = 1;
    for (var j = 0; j < divGaps.length; j++) { if (divGaps[j] < p) lv++; }
    return lv;
  }
  /** 层级覆盖：所在区间 == 分支代码默认层级 → 0（保留动态默认，如 b5/b6/b7 的 family_level）；否则强制覆盖 */
  function computeLevels(order, divGaps) {
    return order.map(function (id, i) {
      var z = zoneOf(divGaps, i + 1);
      return z === defaultZone(id) ? 0 : z;
    });
  }
  /** 由「顺序 + 层级覆盖」反推分界线位置（每层至少 1 张、分界严格递增） */
  function deriveDivGaps(order, levels) {
    var eff = order.map(function (id, i) { return levels[i] || defaultZone(id); });
    var gaps = [], prev = 0;
    for (var k = 1; k <= 4; k++) {
      var cnt = 0;
      for (var i = 0; i < 13; i++) { if (eff[i] <= k) cnt++; }
      var g = Math.max(cnt, prev + 1, k);
      g = Math.min(Math.max(g, 1), 12 - (4 - k));
      gaps.push(g); prev = g;
    }
    return gaps;
  }

  function loadPending() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (isValidOrder(o.decisionEvalOrder) && isValidLevels(o.decisionEvalLevels)) return o;
    } catch (e) { /* ignore */ }
    return null;
  }
  function savePending(o) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ }
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
    savePending(payload); // 先写本地兜底，落盘成功后再清除
    fetch('save-decision-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json(); }).then(function (j) {
      if (j && j.ok) {
        clearPending();
        lastGood = snapshot();
        flash('✅ 已热注入内核并落盘 config.decision-order.js', 'ok');
      } else {
        flash('⚠️ 已热注入内核，落盘被拒绝（' + ((j && j.error) || '未知原因') + '）· 已暂存本机', 'warn');
      }
    }).catch(function () {
      flash('⚠️ 已热注入内核，未落盘（静态环境无写文件能力）· 已暂存本机', 'warn');
    });
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
      state.levels = zeros.slice();
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
