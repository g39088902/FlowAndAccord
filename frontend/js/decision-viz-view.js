/* ==========================================================================
 * Flow & Accord · 马斯洛决策引擎视图层 (decision-viz-view.js)
 * --------------------------------------------------------------------------
 * 单列纵列画布：18 张 Branch 分支卡 → 5 条可拖分界线（v1.29.0 起 6 个层级分区）。
 * 本文件只负责「渲染 + 拖拽交互」，不直接改配置：
 *   卡片换序 / 分界线重划 → onCommit(state) → 由 decision-viz.js 落盘并热注入内核。
 * ========================================================================== */
(function (global) {
  'use strict';

  var D = global.SIM_DECISION_VIZ_DATA;
  var DYNAMIC_DEFAULT = 6;   // 层级覆盖哨兵：保留分支自带的代码动态默认（v1.29.0 起 0 已让位给⓪瞬间行为）
  // GAP 加大为分界线让出空间；DIV_H 从 24 → 40，分界线热区显著增大（拖动更容易命中）
  var NODE_W = 560, NODE_H = 80, GAP = 50, DIV_H = 40, COL_X = 30, BASE_Y = 24;

  var el = {};           // DOM 引用
  var st = null;         // { order:[], divGaps:[], levels:[] }（与控制器共享同一对象）
  var cb = null;         // { onCommit, onStatus }
  var nodes = [], nodeMap = {}, nodeEls = {};
  var scale = 1, panX = 30, panY = 10, worldW = 640, worldH = 1400;
  var drag = null, pan = null, lastMoved = false, selected = null;

  /** 英文状态码 → 中文语义；若中英相同则只显示中文 */
  function zhDisp(t) {
    var z = D.zh(t);
    return t === z ? z : z + ' <code>' + t + '</code>';
  }

  function status(t, tone) {
    if (el.statusTip) el.statusTip.textContent = t;
    if (el.statusTip) el.statusTip.style.color = tone === 'ok' ? '#4ade80' : (tone === 'warn' ? '#fbbf24' : (tone === 'err' ? '#ef4444' : '#8aa0b5'));
    if (cb && cb.onStatus) cb.onStatus(t, tone || '');
  }

  // ── 布局 ────────────────────────────────────────────────────────────────
  /** 分区层级码（0 起算，与 LV 键 / 内核 MaslowLevel 编码一致：0=⓪瞬间 … 5=⑤自我实现） */
  function zoneOf(p) { // p: 1-based 卡片位置
    var lv = 0;
    for (var j = 0; j < st.divGaps.length; j++) { if (st.divGaps[j] < p) lv++; }
    return lv;
  }
  // 显示层级 = 卡片当前位置所在的分区（始终实时计算）。
  // 修复：此前用 st.levels[i] 优先——它是上一次 commit 的陈旧覆盖值，
  // 拖动分界线时 levels 尚未重算，导致部分卡片颜色不随分界刷新。
  function levelAt(i) { return zoneOf(i + 1); }

  function buildNodes() {
    var list = [];
    st.order.forEach(function (id, i) {
      list.push({ id: id, kind: 'branch', bId: id, w: NODE_W, h: NODE_H });
      var p = i + 1, di = st.divGaps.indexOf(p);
      if (di >= 0) list.push({ id: 'div' + (di + 1), kind: 'divider', k: di + 1, g: p, w: NODE_W, h: DIV_H });
    });
    return list;
  }

  function layoutNodes(list) {
    var y = BASE_Y;
    list.forEach(function (n) {
      n.x = COL_X;
      if (n.kind === 'divider') {
        n.y = BASE_Y + (n.g - 1) * (NODE_H + GAP) + NODE_H + GAP / 2 - DIV_H / 2;
      } else {
        n.y = y; y += n.h + GAP;
      }
    });
    return y;
  }

  function syncBranchOrder() {
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    var list = [];
    st.order.forEach(function (id, i) {
      list.push(byId[id]);
      var p = i + 1, di = st.divGaps.indexOf(p);
      if (di >= 0) { var dn = byId['div' + (di + 1)]; dn.g = p; list.push(dn); }
    });
    nodes = list;
  }

  function applyNodePositions() {
    nodes.forEach(function (n) {
      var e = nodeEls[n.id];
      if (e) { e.style.left = n.x + 'px'; e.style.top = n.y + 'px'; }
    });
  }

  function branchSlotTops() {
    var tops = {}, y = BASE_Y;
    st.order.forEach(function (id) { tops[id] = y; y += NODE_H + GAP; });
    return tops;
  }

  function gapCenters() {
    var cs = [], base = BASE_Y;
    for (var g = 0; g <= st.order.length; g++) cs.push(base + (g - 1) * (NODE_H + GAP) + NODE_H + GAP / 2);
    return cs;
  }

  // ── 渲染 ────────────────────────────────────────────────────────────────
  function nodeHTML(n) {
    var h = '';
    if (n.kind === 'branch') {
      var bv = D.BRANCH_MAP[n.bId];
      if (bv) {
        h += '<div class="dv-cols">'
          + '<div class="dv-col dv-col-l">'
          + '<div class="dv-branch-id">' + n.bId + ' · ' + (bv.zh || '') + '</div>'
          + '<div class="dv-tag">条件</div>'
          + '<div class="dv-sub" style="margin-top:2px">' + bv.cond + '</div>'
          + '<div class="dv-tag dv-lvtag" style="margin-top:4px"></div>'
          + '</div>'
          + '<div class="dv-col">'
          + '<div class="dv-tag">命中 → 需求</div>'
          + '<div class="dv-result"></div>'
          + '<div class="dv-tag dv-target">→ ' + zhDisp(bv.target) + '</div>'
          + '</div></div>';
      }
    } else if (n.kind === 'divider') {
      h += '<div class="dv-div">'
        // 分界线 k（1 起算）上方为第 k-1 层、下方为第 k 层（层级码 0 起算）
        + '<span class="dv-chip" style="background:' + D.LV[n.k - 1].hex + '">↑ 第' + (n.k - 1) + '层 · ' + D.LV[n.k - 1].name + '</span>'
        + '<span class="dv-line"></span>'
        + '<span class="dv-grab">⋮⋮ 拖动分界</span>'
        + '<span class="dv-line"></span>'
        + '<span class="dv-chip" style="background:' + D.LV[n.k].hex + '">第' + n.k + '层 · ' + D.LV[n.k].name + ' ↓</span>'
        + '</div>';
    }
    return h;
  }

  function renderNodes() {
    el.nodesLayer.innerHTML = '';
    nodeEls = {};
    nodes.forEach(function (n) {
      var e = document.createElement('div');
      e.className = 'dv-node dv-kind-' + n.kind;
      e.style.left = n.x + 'px'; e.style.top = n.y + 'px';
      e.style.width = n.w + 'px'; e.style.height = n.h + 'px';
      e.innerHTML = nodeHTML(n);
      e.dataset.id = n.id;
      e.addEventListener('pointerdown', function (ev) { onNodeDown(ev, n, e); });
      e.addEventListener('click', function (ev) { ev.stopPropagation(); if (lastMoved) { lastMoved = false; return; } selectNode(n.id); });
      el.nodesLayer.appendChild(e);
      nodeEls[n.id] = e; nodeMap[n.id] = n;
    });
  }

  function refreshLevels() {
    st.order.forEach(function (id, i) {
      var lv = levelAt(i), e = nodeEls[id];
      if (!e) return;
      e.style.borderLeftColor = D.LV[lv].hex;
      var tag = e.querySelector('.dv-lvtag');
      if (tag) {
        var bv = D.BRANCH_MAP[id];
        tag.textContent = '第' + lv + '层 · ' + D.LV[lv].name + (bv.level !== lv ? (' · 原:第' + bv.level + '层') : '');
        tag.style.color = D.LV[lv].hex;
      }
      var res = e.querySelector('.dv-result');
      if (res) res.style.color = D.LV[lv].hex;
    });
  }

  // ── 拖拽 ────────────────────────────────────────────────────────────────
  function onNodeDown(ev, n, e) {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    ev.stopPropagation();
    try { e.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
    if (n.kind === 'divider') {
      e.classList.add('dv-dragging');
      drag = { div: true, id: n.id, di: n.k - 1, sy: ev.clientY, startY: n.y, moved: false };
      status('⤦ 拖动分界线到两张 Branch 分支卡之间，重新划分上下方层级');
      return;
    }
    e.classList.add('dv-dragging');
    drag = { id: n.id, sy: ev.clientY, startY: n.y, moved: false };
    lastMoved = false;
  }

  function onPointerMove(ev) {
    if (!drag) {
      if (pan) { panX = pan.px + (ev.clientX - pan.sx); panY = pan.py + (ev.clientY - pan.sy); applyTransform(); }
      return;
    }
    var movedPx = Math.abs(ev.clientY - drag.sy) > 3;
    if (drag.div) {
      var py = drag.startY + (ev.clientY - drag.sy) / scale;
      var centers = gapCenters(), best = 0, bd = 1e9;
      for (var gi = 1; gi < centers.length - 1; gi++) { var dd = Math.abs(py - centers[gi]); if (dd < bd) { bd = dd; best = gi; } }
      var minG = (drag.di === 0 ? 1 : st.divGaps[drag.di - 1] + 1);
      // 末条分界线上界为「倒数第二张卡之后」，保证最底层至少 1 张卡（v1.29.0 起 5 条分界）
      var maxG = (drag.di === st.divGaps.length - 1 ? st.order.length - 1 : st.divGaps[drag.di + 1] - 1);
      var g = Math.max(minG, Math.min(maxG, best));
      if (g !== st.divGaps[drag.di]) {
        st.divGaps[drag.di] = g;
        syncBranchOrder(); layoutNodes(nodes); applyNodePositions(); refreshLevels();
        status('⤦ 分界线移至第 ' + g + ' 张卡之后：第' + drag.di + '层 | 第' + (drag.di + 1) + '层');
      }
    } else {
      var desiredY = drag.startY + (ev.clientY - drag.sy) / scale;
      var idx = st.order.indexOf(drag.id);
      var cy = desiredY + NODE_H / 2;
      var tops = branchSlotTops();
      var swapped = false;
      if (idx > 0 && cy < tops[st.order[idx - 1]] + NODE_H / 2) {
        swap(idx, idx - 1); swapped = true;
      } else if (idx < st.order.length - 1 && cy > tops[st.order[idx + 1]] + NODE_H / 2) {
        swap(idx, idx + 1); swapped = true;
      }
      if (swapped) {
        // 关键修复：此处不再改写 drag.startY。
        // 原实现把 startY 重置为「换位前槽位」，而 desiredY = startY + 累计指针位移，
        // 起点被抬高/压低一格导致每次越过相邻卡位移额外累加 → 越拖越快、瞬移到顶端。
        // 保持 startY 恒为拖拽起点槽位，卡片持续「手指跟随」，松手后再吸附到最终槽位。
        syncBranchOrder(); layoutNodes(nodes); applyNodePositions(); refreshLevels();
      }
      nodeEls[drag.id].style.top = desiredY + 'px';
    }
    if (movedPx) drag.moved = true;
  }

  function swap(i, j) {
    var oi = st.order[i]; st.order[i] = st.order[j]; st.order[j] = oi;
    var li = st.levels[i]; st.levels[i] = st.levels[j]; st.levels[j] = li;
  }

  function onPointerUp() {
    if (drag) {
      var d = drag; drag = null;
      var e = nodeEls[d.id];
      if (e) e.classList.remove('dv-dragging');
      if (d.moved) {
        lastMoved = true;
        syncBranchOrder(); layoutNodes(nodes); applyNodePositions(); refreshLevels();
        if (cb && cb.onCommit) cb.onCommit(st, d.div ? 'divider' : 'order');
      }
    }
    if (pan) { pan = null; el.viewport.classList.remove('dv-panning'); }
  }

  function applyTransform() {
    el.world.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + scale + ')';
  }

  function fit() {
    var rect = el.viewport.getBoundingClientRect();
    var pad = 40;
    var s = Math.min((rect.width - pad) / worldW, (rect.height - pad) / worldH, 1.2);
    scale = Math.max(0.35, s);
    panX = (rect.width - worldW * scale) / 2;
    panY = (rect.height - worldH * scale) / 2;
    applyTransform();
    status('🎯 已适应窗口');
  }

  // ── 检查器 ──────────────────────────────────────────────────────────────
  function selectNode(id) {
    Object.keys(nodeEls).forEach(function (k) { nodeEls[k].classList.remove('dv-selected'); });
    var n = nodeMap[id];
    if (!n) return;
    nodeEls[id].classList.add('dv-selected');
    selected = id;
    showInspector(n);
  }

  function showInspector(n) {
    var html = '';
    if (n.kind === 'branch') {
      var b = D.BRANCH_MAP[n.bId] || {};
      var i = st.order.indexOf(n.bId);
      var lv = i >= 0 ? levelAt(i) : b.level;
      // ⚠️ v1.29.0 起 0 是合法层级（⓪ 瞬间行为），判定「是否被强制覆盖」必须用哨兵 6 比较，不可用真值短路
      var overridden = i >= 0 && st.levels[i] !== undefined && st.levels[i] !== DYNAMIC_DEFAULT;
      var instantNote = b.instant ? ' · ⚡ 具备瞬发变体（近距/在宅时归入⓪瞬间行为）' : '';
      html = '<div class="dv-insp-head"><span class="dv-chip" style="background:' + D.LV[lv].hex + '">第' + lv + '层</span>'
        + '<div class="dv-insp-title"><b>' + n.bId + ' · ' + (b.zh || '') + '</b><span>' + D.LV[lv].name + (overridden ? ' · 层级被强制覆盖' : ' · 6(代码动态默认)') + instantNote + '</span></div></div>'
        + '<div class="dv-insp-body">'
        + '<div class="dv-row"><span class="dv-k">触发条件</span><span class="dv-v">' + b.cond + '</span></div>'
        + '<div class="dv-row"><span class="dv-k">需求结论</span><span class="dv-v"><b style="color:' + D.LV[lv].hex + '">' + b.need + '</b></span></div>'
        + '<div class="dv-row"><span class="dv-k">目标动作</span><span class="dv-v">' + zhDisp(b.target) + '</span></div>'
        + '<div class="dv-row"><span class="dv-k">当前槽位</span><span class="dv-v">第 ' + (i + 1) + ' 位 · 第 ' + lv + ' 层</span></div>'
        + '<div class="dv-row"><span class="dv-k">源码锚点</span><span class="dv-v"><span class="dv-code">' + b.anchor + '</span></span></div>'
        + '<div class="dv-row"><span class="dv-k">config 键</span><span class="dv-v">' + (b.cfg || []).map(function (x) { return '<span class="dv-cfg">' + x + '</span>'; }).join('') + '</span></div>'
        + '<div class="dv-sub">命中后经 <code>fulfill_resting_need</code> 落地：寻路 dispatch → Seeking* 状态；途中目标被触发器关闭 → 原地掉头重路由。</div></div>';
    } else if (n.kind === 'divider') {
      html = '<div class="dv-insp-head"><span class="dv-chip" style="background:' + D.LV[n.k].hex + '">分界线 ' + n.k + '</span>'
        + '<div class="dv-insp-title"><b>层级划分</b><span>' + D.LV[n.k - 1].name + ' ｜ ' + D.LV[n.k].name + '</span></div></div>'
        + '<div class="dv-insp-body">'
        + '<div class="dv-row"><span class="dv-k">划分</span><span class="dv-v">第' + (n.k - 1) + '层（上方）｜第' + n.k + '层（下方）</span></div>'
        + '<div class="dv-row"><span class="dv-k">当前位于</span><span class="dv-v">第 ' + n.g + ' 张 Branch 分支卡之后</span></div>'
        + '<div class="dv-sub">拖动此分界线到任意两张 Branch 分支卡之间可重新划分层级归属；每层至少保留 1 张卡。松手后层级覆盖随顺序一并落盘 <code>config.decision-order.js</code> 并热注入内核。</div></div>';
    }
    if (el.inspEmpty) el.inspEmpty.style.display = 'none';
    if (el.inspCard) { el.inspCard.style.display = 'block'; el.inspCard.innerHTML = html; }
  }

  // ── 装载 ────────────────────────────────────────────────────────────────
  function relayout() {
    nodes = buildNodes();
    worldH = layoutNodes(nodes);
    renderNodes();
    refreshLevels();
  }

  global.DecisionVizView = {
    mount: function (ids, state, callbacks) {
      el = {
        viewport: document.getElementById(ids.viewport),
        world: document.getElementById(ids.world),
        nodesLayer: document.getElementById(ids.nodes),
        inspEmpty: document.getElementById(ids.inspEmpty),
        inspCard: document.getElementById(ids.inspCard),
        statusTip: document.getElementById(ids.statusTip)
      };
      st = state; cb = callbacks;

      el.viewport.addEventListener('pointermove', onPointerMove);
      el.viewport.addEventListener('pointerup', onPointerUp);
      el.viewport.addEventListener('pointercancel', onPointerUp);
      el.viewport.addEventListener('pointerdown', function (ev) {
        if (ev.target === el.viewport || ev.target === el.world) {
          if (ev.button === 2 || (ev.pointerType === 'mouse' && ev.button === 0)) {
            el.viewport.setPointerCapture(ev.pointerId);
            pan = { sx: ev.clientX, sy: ev.clientY, px: panX, py: panY };
            el.viewport.classList.add('dv-panning');
          }
        }
      });
      el.viewport.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
      el.viewport.addEventListener('wheel', function (ev) {
        ev.preventDefault();
        var rect = el.viewport.getBoundingClientRect();
        var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
        var ns = Math.min(3.2, Math.max(0.35, scale * (ev.deltaY < 0 ? 1.12 : 0.89)));
        var wx = (mx - panX) / scale, wy = (my - panY) / scale;
        panX = mx - wx * ns; panY = my - wy * ns; scale = ns;
        applyTransform();
      }, { passive: false });

      relayout();
      applyTransform();
      status('就绪 · ' + st.order.length + ' 条 Branch 分支 · 拖动卡片调序 / 拖动分界线重分层');
    },
    setState: function (order, divGaps, levels) {
      st.order = order.slice();
      st.divGaps = divGaps.slice();
      st.levels = levels ? levels.slice() : st.levels;
      relayout();
    },
    refresh: function () { refreshLevels(); },
    fit: fit,
    selectedId: function () { return selected; }
  };
})(window);
