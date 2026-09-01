// =========================================================================
// 🖼️ 族谱视图控制器 (Flow & Accord)
//   · 视口虚拟化：只挂载视口内 (含缓冲) 的卡片与亲子边，DOM 数量恒定
//   · 缩放分层 LOD：概览色块 → 简档(头像/编号/世代) → 完整卡片
//   · 左侧时间刻度尺：不随横向平移，只随纵向平移与缩放滚动，提供时间锚点
//   · 依赖 FlowDagLayout；standalone 内嵌时布局 SRC 必须先于本 SRC 注入
// =========================================================================
(function (root, factory) {
  const api = factory();
  if (root) root.FlowDagView = api;
  try { if (typeof module === 'object' && module.exports) module.exports = api; } catch (_) {}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 依赖解析：浏览器下取自 window.FlowDagLayout；
  // standalone 独立页内嵌源码时布局函数已声明于同一作用域，直接组装。
  const L = (typeof FlowDagLayout !== 'undefined')
    ? FlowDagLayout
    : {
      LAYOUT_CONST: LAYOUT_CONST, lodLevel: lodLevel,
      edgePathTimeline: edgePathTimeline, edgePathFlat: edgePathFlat,
      rulerMarks: rulerMarks, layoutTimelineDag: layoutTimelineDag
    };
  const VIEW_SRC_HEADER =
    'const L = (typeof FlowDagLayout !== \'undefined\') ? FlowDagLayout : {\n' +
    '  LAYOUT_CONST: LAYOUT_CONST, lodLevel: lodLevel,\n' +
    '  edgePathTimeline: edgePathTimeline, edgePathFlat: edgePathFlat,\n' +
    '  rulerMarks: rulerMarks, layoutTimelineDag: layoutTimelineDag\n' +
    '};\n';

  const RULER_W = 74;       // 刻度尺宽度 (px)
  const CULL_PAD = 260;     // 视口外缓冲 (px，屏幕单位)
  const MIN_SCALE = 0.04;
  const MAX_SCALE = 3.0;

  // ------------------------------------------------------------ 卡片渲染
  function avatarOf(n) {
    if (!n.isAlive) return '💀';
    if (n.gender === 'female') return n.isPregnant ? '🤰' : '👩';
    return '👦';
  }
  function genText(n) {
    return n.generation === 1 ? '始祖' : 'G' + n.generation;
  }
  function nodeClasses(n, lod, selectedId) {
    let cls = 'dag-node dag-node--' + lod;
    if (n.isSpine) cls += ' spine';
    if (n.isAncestor) cls += ' ancestor';
    else if (n.isDescendant) cls += ' descendant';
    if (!n.isAlive) cls += ' dead';
    if (n.id === selectedId) cls += ' focus';
    return cls;
  }
  function cardHtml(n, lod) {
    if (lod === 'block') {
      // 概览档: 仅用性别色 + 生死明暗 + 主干亮边编码，保留形态、舍弃文字
      return '<i class="dag-node-dot"></i>';
    }
    if (lod === 'simple') {
      return '<div class="dag-node-line"><span>' + avatarOf(n) + '</span>' +
        '<span class="dag-node-id">#' + n.id + '</span>' +
        '<span class="dag-node-gen">' + genText(n) + '</span></div>';
    }
    const statusText = n.isAlive
      ? ('🟢 ' + n.age + 's · 心' + n.health)
      : ('💀 ' + (n.deathCause || '仙逝'));
    return '' +
      '<div class="dag-node-header">' +
        '<div class="dag-node-name"><span>' + avatarOf(n) + '</span>' +
        '<span>#' + n.id + ' ' + (n.gender === 'female' ? '♀' : '♂') + '</span></div>' +
        '<span class="dag-node-gen">' + genText(n) + '</span>' +
      '</div>' +
      '<div class="dag-node-status"><span>' + statusText + '</span>' +
        '<span>' + (n.homeHouseId ? '🏠#' + n.homeHouseId : '🏕️营') + '</span></div>' +
      '<div class="dag-node-traits">' +
        '<span>智' + n.intelligence + '</span><span>力' + n.strength + '</span>' +
        '<span>魅' + n.libido + '</span><span>寿' + n.lifeExpectancy + '</span>' +
      '</div>';
  }

  // ------------------------------------------------------------ 视图控制器
  function createDagView(config) {
    const container = config.container;
    const dag = config.dag;
    const onSelect = config.onSelect || function () {};
    const onTransform = config.onTransform || null;
    const C = L.LAYOUT_CONST;

    container.classList.add('dag-view-host');
    container.innerHTML =
      '<div class="dag-vp">' +
        '<svg class="dag-svg-layer"></svg>' +
        '<div class="dag-nodes-layer"></div>' +
      '</div>' +
      '<div class="dag-ruler"></div>';
    const vp = container.querySelector('.dag-vp');
    const svg = container.querySelector('.dag-svg-layer');
    const layer = container.querySelector('.dag-nodes-layer');
    const ruler = container.querySelector('.dag-ruler');

    let scale = 1.0, panX = 0, panY = 0;
    let selectedId = dag.focusId;
    let hoverId = null;
    let destroyed = false;
    let rafPending = false;

    // 边索引：节点 → 关联边 (视口裁剪用)
    const edgesOf = new Map();
    dag.edges.forEach((e, ix) => {
      e.__ix = ix;
      if (!edgesOf.has(e.parent.id)) edgesOf.set(e.parent.id, []);
      if (!edgesOf.has(e.child.id)) edgesOf.set(e.child.id, []);
      edgesOf.get(e.parent.id).push(e);
      edgesOf.get(e.child.id).push(e);
    });
    let ySorted = dag.nodes.slice().sort((a, b) => (a.y - b.y) || (a.id - b.id));
    let cardSlots = [];
    let edgeSlots = [];
    let rulerSlots = [];

    svg.setAttribute('width', dag.width);
    svg.setAttribute('height', dag.height);

    // -------------------------------------------------- 视口裁剪 (按 y 有序数组二分)
    function visibleNodes() {
      const cw = container.clientWidth || 1200;
      const ch = container.clientHeight || 780;
      const x0 = (-panX - CULL_PAD) / scale;
      const x1 = (-panX + cw + CULL_PAD) / scale;
      const y0 = (-panY - CULL_PAD) / scale;
      const y1 = (-panY + ch + CULL_PAD) / scale;
      let lo = 0, hi = ySorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ySorted[mid].y + C.NODE_H < y0) lo = mid + 1; else hi = mid;
      }
      const out = [];
      for (let i = lo; i < ySorted.length; i++) {
        const n = ySorted[i];
        if (n.y > y1) break;
        if (n.x + C.NODE_W >= x0 && n.x <= x1) out.push(n);
      }
      return out;
    }

    function ensureCard(i) {
      if (!cardSlots[i]) {
        const el = document.createElement('div');
        el.className = 'dag-node';
        el.style.position = 'absolute';
        layer.appendChild(el);
        cardSlots[i] = { el: el, key: '' };
      }
      return cardSlots[i];
    }
    function ensurePath(i) {
      if (!edgeSlots[i]) {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('class', 'dag-edge');
        svg.appendChild(p);
        edgeSlots[i] = { el: p, key: '' };
      }
      return edgeSlots[i];
    }
    function invalidateKeys() { for (const s of cardSlots) s.key = ''; }

    // -------------------------------------------------- 刷新 (虚拟化 + LOD + 刻度尺 + 亲属高亮)
    function refresh() {
      if (destroyed) return;
      const lod = L.lodLevel(scale);
      const ch = container.clientHeight || 780;

      container.classList.toggle('lod-block', lod === 'block');
      container.classList.toggle('lod-simple', lod === 'simple');
      container.classList.toggle('lod-full', lod === 'full');
      vp.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + scale + ')';

      const vis = visibleNodes();
      const relSet = hoverId ? relativesOf(hoverId) : null;
      let used = 0;
      for (let i = 0; i < vis.length; i++) {
        const n = vis[i];
        const slot = ensureCard(used);
        const key = n.id + '|' + lod + '|' + (n.id === selectedId ? 1 : 0);
        if (slot.key !== key) {
          slot.el.className = nodeClasses(n, lod, selectedId);
          slot.el.innerHTML = cardHtml(n, lod);
          slot.el.__nid = n.id;
          slot.key = key;
        }
        slot.el.style.left = n.x + 'px';
        slot.el.style.top = n.y + 'px';
        slot.el.style.display = '';
        if (relSet) {
          slot.el.classList.toggle('rel', relSet.has(n.id));
          slot.el.classList.toggle('faded', !relSet.has(n.id));
        } else if (slot.el.classList.contains('rel') || slot.el.classList.contains('faded')) {
          slot.el.classList.remove('rel', 'faded');
        }
        used++;
      }
      for (let i = used; i < cardSlots.length; i++) {
        if (cardSlots[i].el.style.display !== 'none') cardSlots[i].el.style.display = 'none';
      }

      // 亲子边：仅绘制至少一端落在扩展视口内的边
      const seen = new Set();
      const visEdges = [];
      for (let i = 0; i < vis.length; i++) {
        const list = edgesOf.get(vis[i].id);
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const e = list[k];
          if (seen.has(e.__ix)) continue;
          seen.add(e.__ix);
          visEdges.push(e);
        }
      }
      visEdges.sort((a, b) => a.__ix - b.__ix);
      for (let i = 0; i < visEdges.length; i++) {
        const e = visEdges[i];
        const slot = ensurePath(i);
        const rel = relSet ? (relSet.has(e.parent.id) && relSet.has(e.child.id)) : false;
        const key = e.__ix + '|' + lod + '|' + (relSet ? (rel ? 1 : 0) : 0);
        if (slot.key !== key) {
          if (lod === 'block') {
            if (e.__flat === undefined) e.__flat = L.edgePathFlat(e);
            slot.el.setAttribute('d', e.__flat);
          } else {
            if (e.__curve === undefined) e.__curve = L.edgePathTimeline(e);
            slot.el.setAttribute('d', e.__curve);
          }
          let cls = 'dag-edge ' + (e.parentType === 'father' ? 'father-edge' : 'mother-edge');
          if (e.child.isDescendant || e.child.id === dag.focusId) cls += ' descendant';
          if (relSet) cls += rel ? ' rel' : ' faded';
          slot.el.setAttribute('class', cls);
          slot.key = key;
        }
        slot.el.style.display = '';
      }
      for (let i = visEdges.length; i < edgeSlots.length; i++) {
        if (edgeSlots[i].el.style.display !== 'none') edgeSlots[i].el.style.display = 'none';
      }

      updateRuler(ch);
    }

    function relativesOf(id) {
      const set = new Set([id]);
      const src = (dag.nodeMap && dag.nodeMap.get(id)) || dag.nodes.find(x => x.id === id);
      if (!src) return set;
      if (src.fatherId) set.add(src.fatherId);
      if (src.motherId) set.add(src.motherId);
      if (src.spouseId) set.add(src.spouseId);
      for (const c of (src.children || [])) set.add(c);
      return set;
    }

    // -------------------------------------------------- 时间刻度尺 (固定左侧，不随横向平移)
    function updateRuler(ch) {
      const r = L.rulerMarks(dag.tickMin, dag.tickMax, dag.pxPerTick, 46 / scale);
      const marks = [];
      for (const m of r.marks) {
        const sy = panY + dag.tickToY(m.tick) * scale;
        if (sy >= -24 && sy <= ch + 24) marks.push({ m: m, sy: sy });
      }
      let used = 0;
      for (let i = 0; i < marks.length; i++) {
        const mk = marks[i];
        if (!rulerSlots[used]) {
          const d = document.createElement('div');
          ruler.appendChild(d);
          rulerSlots[used] = { el: d, key: '' };
        }
        const slot = rulerSlots[used];
        const key = mk.m.tick + '|' + (mk.m.major ? 1 : 0);
        if (slot.key !== key) {
          slot.el.textContent = mk.m.text;
          slot.el.className = 'dag-ruler-mark' + (mk.m.major ? ' major' : '');
          slot.key = key;
        }
        slot.el.style.top = mk.sy + 'px';
        slot.el.style.display = '';
        used++;
      }
      for (let i = used; i < rulerSlots.length; i++) {
        if (rulerSlots[i].el.style.display !== 'none') rulerSlots[i].el.style.display = 'none';
      }
      // 年代分隔带：容器背景水平细线随纵向平移与缩放滚动
      const period = r.step * dag.pxPerTick * scale;
      if (period > 6 && period < 20000) {
        const base = panY + dag.tickToY(r.marks.length ? r.marks[0].tick : dag.tickMin) * scale;
        const off = ((base % period) + period) % period;
        container.style.backgroundImage =
          'repeating-linear-gradient(to bottom, rgba(148,163,184,0.08) 0px, rgba(148,163,184,0.08) 1px, transparent 1px, transparent ' + period + 'px)';
        container.style.backgroundPosition = '0 ' + off + 'px';
      } else {
        container.style.backgroundImage = '';
      }
    }

    function invalidate() {
      if (rafPending || destroyed) return;
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; refresh(); });
    }
    function applyTransform() {
      invalidate();
      if (onTransform) onTransform(scale, panX, panY);
    }

    // -------------------------------------------------- 视角控制
    function viewSize() {
      return { cw: container.clientWidth || 1200, ch: container.clientHeight || 780 };
    }
    function fitAll() {
      const sz = viewSize();
      const padX = RULER_W + 24;
      scale = Math.min((sz.cw - padX - 40) / dag.width, (sz.ch - 48) / dag.height);
      scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
      panX = padX + (sz.cw - padX - dag.width * scale) / 2;
      panY = (sz.ch - dag.height * scale) / 2;
      applyTransform();
    }
    function centerOn(id, targetScale) {
      const n = dag.nodes.find(x => x.id === id);
      if (!n) return;
      const sz = viewSize();
      if (targetScale) scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, targetScale));
      panX = (sz.cw + RULER_W) / 2 - (n.x + C.NODE_W / 2) * scale;
      panY = sz.ch / 2 - (n.y + C.NODE_H / 2) * scale;
      applyTransform();
    }
    function relayout(pxPerTick) {
      const nd = L.layoutTimelineDag(dag.nodes, dag.edges, { pxPerTick: pxPerTick, focusId: dag.focusId });
      dag.width = nd.width; dag.height = nd.height; dag.pxPerTick = nd.pxPerTick;
      dag.tickToY = nd.tickToY; dag.yToTick = nd.yToTick; dag.spine = nd.spine;
      for (const e of dag.edges) { e.__flat = undefined; e.__curve = undefined; }
      ySorted = dag.nodes.slice().sort((a, b) => (a.y - b.y) || (a.id - b.id));
      svg.setAttribute('width', dag.width);
      svg.setAttribute('height', dag.height);
      invalidateKeys();
      invalidate();
    }
    function setSelected(id) {
      selectedId = id;
      invalidateKeys();
      invalidate();
    }
    function getTransform() { return { scale: scale, panX: panX, panY: panY }; }
    function setTransform(s, px, py) {
      scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
      panX = px; panY = py;
      applyTransform();
    }
    function zoomBy(factor) {
      const sz = viewSize();
      const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
      const cx = (sz.cw + RULER_W) / 2, cy = sz.ch / 2;
      panX = cx - (cx - panX) * (ns / scale);
      panY = cy - (cy - panY) * (ns / scale);
      scale = ns;
      applyTransform();
    }

    // -------------------------------------------------- 交互 (拖拽 / 滚轮 / 点击 / 悬停)
    let dragging = false, moved = false, sx = 0, sy = 0, spx = 0, spy = 0;
    function onDown(e) {
      if (e.target.closest && e.target.closest('button')) return;
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY; spx = panX; spy = panY;
      try { container.setPointerCapture(e.pointerId); } catch (_) {}
    }
    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      panX = spx + dx; panY = spy + dy;
      applyTransform();
    }
    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      try { if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId); } catch (_) {}
      const el = e.target.closest ? e.target.closest('.dag-node') : null;
      if (!moved && el && el.__nid !== undefined) {
        selectedId = el.__nid;
        invalidateKeys();
        invalidate();
        const n = dag.nodes.find(x => x.id === selectedId);
        if (n) onSelect(n);
      }
    }
    function onWheel(e) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      panX = mx - (mx - panX) * (ns / scale);
      panY = my - (my - panY) * (ns / scale);
      scale = ns;
      applyTransform();
    }
    function onOver(e) {
      const el = e.target.closest ? e.target.closest('.dag-node') : null;
      const id = el && el.__nid !== undefined ? el.__nid : null;
      if (id !== hoverId) { hoverId = id; invalidateKeys(); invalidate(); }
    }
    function onLeave() {
      if (hoverId !== null) { hoverId = null; invalidateKeys(); invalidate(); }
    }

    container.style.touchAction = 'none';
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', onUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('mouseover', onOver);
    container.addEventListener('mouseleave', onLeave);
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => invalidate());
      ro.observe(container);
    }

    function destroy() {
      destroyed = true;
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onUp);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('mouseover', onOver);
      container.removeEventListener('mouseleave', onLeave);
      if (ro) ro.disconnect();
      container.innerHTML = '';
      container.style.backgroundImage = '';
      container.classList.remove('dag-view-host', 'lod-block', 'lod-simple', 'lod-full');
    }

    return {
      refresh: refresh, invalidate: invalidate, fitAll: fitAll, centerOn: centerOn,
      relayout: relayout, setSelected: setSelected, getTransform: getTransform,
      setTransform: setTransform, zoomBy: zoomBy, destroy: destroy,
      getScale: function () { return scale; },
      getLod: function () { return L.lodLevel(scale); }
    };
  }

  return {
    createDagView: createDagView, cardHtml: cardHtml, nodeClasses: nodeClasses, RULER_W: RULER_W,
    SRC: VIEW_SRC_HEADER +
      'const RULER_W = 74;\nconst CULL_PAD = 260;\nconst MIN_SCALE = 0.04;\nconst MAX_SCALE = 3.0;\n\n' +
      [avatarOf, genText, nodeClasses, cardHtml, createDagView].map(f => f.toString()).join('\n\n')
  };
});
