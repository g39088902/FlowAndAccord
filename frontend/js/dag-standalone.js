// =========================================================================
// 📄 族谱独立新标签页 HTML 模板 (Flow & Accord)
//  生成完全自包含的单文件 HTML：内嵌 FlowDagLayout.SRC + FlowDagView.SRC，
//  与页内模态严格同源（v0.9.56 曾因 standalone 缺失布局常量导致拖拽失效，务必保持同源）。
// =========================================================================
(function (window) {
  'use strict';

  function generateStandaloneDagHtml(focusId, sim) {
    const dag = window.FlowDag.buildLineageDAG(focusId, sim);
    // 紧凑序列化：边仅携带 id，反序列化后重建对象引用
    const ser = {
      focusId: dag.focusId,
      width: dag.width,
      height: dag.height,
      pxPerTick: dag.pxPerTick,
      tickMin: dag.tickMin,
      tickMax: dag.tickMax,
      nodes: dag.nodes,
      edges: dag.edges.map(e => ({ parentId: e.parent.id, childId: e.child.id, parentType: e.parentType }))
    };
    const dagJson = JSON.stringify(ser);
    const layoutSrc = window.FlowDagLayout.SRC;
    const viewSrc = window.FlowDagView.SRC;
    const years = ((dag.tickMax - dag.tickMin) / 7200).toFixed(1);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flow & Accord · 直系血脉时间轴族谱</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      background: #090e17; color: #f1f5f9; overflow: hidden; width: 100vw; height: 100vh;
      display: flex; flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .dag-topbar {
      height: 56px; background: rgba(15, 23, 42, 0.96);
      border-bottom: 1px solid rgba(56, 189, 248, 0.25);
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 20px; z-index: 100; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    .dag-brand { display: flex; align-items: center; gap: 12px; }
    .dag-title { font-size: 15px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
    .dag-stats-badge {
      font-size: 11px; color: #94a3b8; background: rgba(30, 41, 59, 0.8);
      padding: 3px 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);
    }
    .dag-actions { display: flex; align-items: center; gap: 8px; }
    .dag-btn {
      background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255,255,255,0.15); color: #cbd5e1;
      padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;
      display: inline-flex; align-items: center; gap: 5px; transition: all 0.2s ease; font-family: inherit;
    }
    .dag-btn:hover { background: rgba(56, 189, 248, 0.2); border-color: #38bdf8; color: #38bdf8; }
    .dag-btn.primary { background: rgba(56, 189, 248, 0.18); border-color: rgba(56,189,248,0.45); color: #38bdf8; }
    .dag-density { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #94a3b8; }
    .dag-density input[type=range] { width: 120px; accent-color: #38bdf8; }
    .dag-density b { color: #38bdf8; font-variant-numeric: tabular-nums; min-width: 34px; display: inline-block; }

    .dag-workspace { flex: 1; position: relative; background: radial-gradient(circle at 50% 50%, #0f172a 0%, #070b12 100%); }

    /* 视图宿主：虚拟化容器 */
    .dag-view-host { position: absolute; inset: 0; overflow: hidden; cursor: grab; }
    .dag-view-host:active { cursor: grabbing; }
    .dag-vp { position: absolute; top: 0; left: 0; transform-origin: 0 0; will-change: transform; pointer-events: none; }
    .dag-svg-layer { position: absolute; top: 0; left: 0; pointer-events: none; }
    .dag-nodes-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }

    /* 时间刻度尺 */
    .dag-ruler {
      position: absolute; top: 0; left: 0; width: 74px; height: 100%;
      background: linear-gradient(90deg, rgba(9,14,23,0.96) 60%, rgba(9,14,23,0.55) 100%);
      border-right: 1px solid rgba(56,189,248,0.18); pointer-events: none; z-index: 5;
    }
    .dag-ruler-mark {
      position: absolute; left: 0; width: 68px; text-align: right; padding-right: 8px;
      font-size: 10px; color: #64748b; transform: translateY(-50%); white-space: nowrap;
      font-variant-numeric: tabular-nums; letter-spacing: 0.2px;
    }
    .dag-ruler-mark.major { color: #94a3b8; font-weight: 600; }
    .dag-ruler-mark.major::after {
      content: ''; position: absolute; right: -6px; top: 50%; width: 10px; height: 1px;
      background: rgba(56,189,248,0.35);
    }

    /* 亲子边 */
    .dag-edge { fill: none; stroke: rgba(148,163,184,0.45); stroke-width: 2; vector-effect: non-scaling-stroke; transition: opacity 0.18s, stroke-width 0.18s; }
    .dag-edge.father-edge { stroke: #38bdf8; stroke-width: 2.2; marker-end: url(#dag-arrow-father); }
    .dag-edge.mother-edge { stroke: #f472b6; stroke-width: 2.2; marker-end: url(#dag-arrow-mother); }
    .dag-edge.descendant.father-edge { stroke-width: 2.8; filter: drop-shadow(0 0 4px rgba(56,189,248,0.6)); }
    .dag-edge.descendant.mother-edge { stroke: #ec4899; stroke-width: 2.8; filter: drop-shadow(0 0 4px rgba(236,72,153,0.6)); }
    .dag-edge.rel { opacity: 1; stroke-width: 3; }
    .dag-edge.faded { opacity: 0.12; }
    .lod-block .dag-edge { stroke-width: 1.1; marker-end: none; }
    .lod-block .dag-edge.rel { stroke-width: 2; }

    /* 节点卡片 */
    .dag-node {
      position: absolute; width: 184px; height: 80px;
      background: rgba(15,23,42,0.94); border: 1px solid rgba(255,255,255,0.14);
      border-radius: 10px; padding: 8px 10px; pointer-events: auto; cursor: pointer;
      display: flex; flex-direction: column; justify-content: center; gap: 4px;
      box-shadow: 0 6px 16px rgba(0,0,0,0.4); transition: opacity 0.18s, box-shadow 0.18s, border-color 0.18s;
    }
    .dag-node:hover { border-color: #38bdf8; box-shadow: 0 10px 24px rgba(56,189,248,0.25); z-index: 10; }
    .dag-node.ancestor { border-color: rgba(251,191,36,0.8); background: rgba(36,28,12,0.94); }
    .dag-node.descendant { border-color: rgba(56,189,248,0.7); background: rgba(12,32,48,0.94); }
    .dag-node.spine { box-shadow: 0 0 0 2px rgba(239,68,68,0.35), 0 6px 18px rgba(0,0,0,0.5); }
    .dag-node.dead { opacity: 0.72; filter: grayscale(0.4); }
    .dag-node.focus { border: 2px solid #ef4444; box-shadow: 0 0 22px rgba(239,68,68,0.55), 0 8px 24px rgba(0,0,0,0.6); background: rgba(48,14,18,0.98); z-index: 20; }
    .dag-node.rel { opacity: 1; border-color: #38bdf8; }
    .dag-node.faded { opacity: 0.16; }
    .dag-node--block {
      padding: 0; border-radius: 8px; background: #1e3a5f; border-color: rgba(255,255,255,0.18);
      box-shadow: none;
    }
    .dag-node--block.female { background: #4c1d3a; }
    .dag-node--block.dead { background: #334155; opacity: 0.55; }
    .dag-node--block.spine { background: #7f1d1d; border-color: rgba(248,113,113,0.8); }
    .dag-node--block.focus { background: #ef4444; border-color: #fecaca; }
    .dag-node--block .dag-node-dot { display: none; }
    .dag-node--simple { justify-content: center; }
    .dag-node-line { display: flex; align-items: center; gap: 8px; justify-content: center; }
    .dag-node-id { font-size: 14px; font-weight: 700; color: #f8fafc; }
    .dag-node-header { display: flex; align-items: center; justify-content: space-between; }
    .dag-node-name { font-size: 12px; font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 4px; }
    .dag-node-gen { font-size: 9px; padding: 1px 5px; border-radius: 4px; background: #334155; color: #94a3b8; }
    .dag-node-status { font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }
    .dag-node-traits {
      display: flex; gap: 6px; font-size: 9px; color: #cbd5e1;
      border-top: 1px solid rgba(255,255,255,0.06); padding-top: 3px;
    }

    .dag-sidebar {
      position: absolute; top: 20px; right: 20px; width: 290px;
      background: rgba(15,23,42,0.96); border: 1px solid rgba(56,189,248,0.35);
      border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,0.7); padding: 16px;
      z-index: 110; backdrop-filter: blur(10px); display: none; flex-direction: column; gap: 10px;
    }
    .dag-sidebar-title { font-size: 14px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; justify-content: space-between; }
    .dag-help-bar {
      position: absolute; bottom: 15px; left: 92px;
      background: rgba(15,23,42,0.85); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px; padding: 6px 14px; font-size: 11px; color: #94a3b8; pointer-events: none; z-index: 50;
    }
    .dag-legend {
      position: absolute; bottom: 15px; right: 20px; display: flex; gap: 12px;
      font-size: 11px; color: #94a3b8; background: rgba(15,23,42,0.85);
      border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 6px 14px; z-index: 50;
    }
  </style>
</head>
<body>
  <svg width="0" height="0" style="position:absolute;" aria-hidden="true">
    <defs>
      <marker id="dag-arrow-father" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#38bdf8" />
      </marker>
      <marker id="dag-arrow-mother" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#f472b6" />
      </marker>
    </defs>
  </svg>

  <div class="dag-topbar">
    <div class="dag-brand">
      <div class="dag-title">🌳 Flow & Accord · 直系血脉时间轴族谱</div>
      <div class="dag-stats-badge" id="topbar-stats">载入中…</div>
    </div>
    <div class="dag-actions">
      <div class="dag-density">
        <span>时间密度</span>
        <input type="range" id="density" min="0.25" max="4" step="0.05" value="1" />
        <b id="density-val">1.00x</b>
      </div>
      <button class="dag-btn" id="btn-focus-center">🎯 定位焦点</button>
      <button class="dag-btn" id="btn-fit">🔍 适应窗口</button>
      <button class="dag-btn primary" id="btn-reset">↺ 重置</button>
    </div>
  </div>

  <div class="dag-workspace">
    <div class="dag-view-host" id="workspace"></div>
    <div class="dag-help-bar">🖱️ 拖拽平移 · 滚轮缩放 · 纵向 = 出生时间 (上=先祖 / 下=后裔) · 蓝👨父 / 粉👩母</div>
    <div class="dag-legend">
      <span>🟥 主干血脉</span><span>🟨 祖先链</span><span>🟦 后代链</span><span>🟪 女性</span><span>🟦 男性</span><span>灰 = 已故</span>
    </div>
    <div class="dag-sidebar" id="sidebar">
      <div class="dag-sidebar-title">
        <span id="side-title">族人档案</span>
        <button class="dag-btn" style="padding:2px 6px; font-size:10px;" id="side-close">✕</button>
      </div>
      <div id="side-body" style="font-size:11px; line-height:1.6; color:#cbd5e1;"></div>
    </div>
  </div>

  <script>
    // ---------------- 布局引擎 (与页内模态同源) —— 必须先于 DEFAULT_PX/bootstrap 声明 ----------------
    ${layoutSrc}

    // ---------------- 视图控制器 (与页内模态同源) ----------------
    ${viewSrc}

    // ---------------- 数据 + 装配 ----------------
    var DATA = ${dagJson};
    var YEARS = ${years};
    var DEFAULT_PX = LAYOUT_CONST.PX_PER_TICK;

    // ---------------- 装配 ----------------
    var nodeMap = new Map(DATA.nodes.map(function (n) { return [n.id, n]; }));
    DATA.edges = DATA.edges.map(function (e) {
      return { parent: nodeMap.get(e.parentId), child: nodeMap.get(e.childId), parentType: e.parentType };
    });
    DATA.nodeMap = nodeMap;

    var workspace = document.getElementById('workspace');
    var sidebar = document.getElementById('sidebar');
    var sideTitle = document.getElementById('side-title');
    var sideBody = document.getElementById('side-body');
    var topStats = document.getElementById('topbar-stats');

    var laid = layoutTimelineDag(DATA.nodes, DATA.edges, { focusId: DATA.focusId, pxPerTick: DATA.pxPerTick });
    DATA.width = laid.width; DATA.height = laid.height; DATA.pxPerTick = laid.pxPerTick;
    DATA.tickToY = laid.tickToY; DATA.yToTick = laid.yToTick; DATA.spine = laid.spine;

    var view = createDagView({
      container: workspace,
      dag: DATA,
      onSelect: function (n) { inspectNode(n); }
    });

    function inspectNode(n) {
      sideTitle.innerHTML = (n.gender === 'female' ? '👩' : '👦') + ' 部落民 #' + n.id + ' (第' + n.generation + '代)';
      sideBody.innerHTML =
        '<div style="margin-bottom:6px; color:#38bdf8; font-weight:600;">' +
          (n.isAlive ? ('🟢 存活 · 年龄 ' + n.age + 's') : ('💀 已故 · 死因: ' + (n.deathCause || '寿终正寝'))) +
        '</div>' +
        '<div>🕐 出生 tick: ' + n.birthTick + (n.isSpine ? ' · 🟥 主干血脉' : '') + '</div>' +
        '<div>👴 父亲: ' + (n.fatherId ? '#' + n.fatherId : '无 (始祖)') + '</div>' +
        '<div>👩 母亲: ' + (n.motherId ? '#' + n.motherId : '无 (始祖)') + '</div>' +
        '<div>💍 配偶: ' + (n.spouseId ? '#' + n.spouseId : '未婚') + '</div>' +
        '<div>👶 直系子嗣: ' + (n.children ? n.children.length : 0) + ' 位</div>' +
        '<div>🏠 房屋: ' + (n.homeHouseId ? '私宅 #' + n.homeHouseId : '居住在营地') + '</div>' +
        '<div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.1);">' +
          '<strong>🧬 先天禀赋属性</strong><br>' +
          '🧠 智力: ' + n.intelligence + ' · 💪 力量: ' + n.strength + '<br>' +
          '❤️‍🔥 魅力: ' + n.libido + ' · 🍽️ 消化: ' + n.digestionEfficiency + '<br>' +
          '😴 睡眠: ' + n.sleepEfficiency + ' · ⏳ 寿命: ' + n.lifeExpectancy +
        '</div>';
      sidebar.style.display = 'flex';
    }

    topStats.textContent = '直系族人 ' + DATA.nodes.length + ' · 亲子边 ' + DATA.edges.length +
      ' · 时间跨度 ' + YEARS + ' 年 (' + DATA.tickMin + ' ~ ' + DATA.tickMax + ' tick)';

    document.getElementById('btn-fit').onclick = function () { view.fitAll(); };
    document.getElementById('btn-focus-center').onclick = function () { view.centerOn(DATA.focusId, Math.max(view.getScale(), 0.9)); };
    document.getElementById('btn-reset').onclick = function () {
      document.getElementById('density').value = 1;
      document.getElementById('density-val').textContent = '1.00x';
      view.relayout(DEFAULT_PX);
      view.fitAll();
    };
    document.getElementById('side-close').onclick = function () { sidebar.style.display = 'none'; };
    document.getElementById('density').oninput = function (e) {
      var v = parseFloat(e.target.value);
      document.getElementById('density-val').textContent = v.toFixed(2) + 'x';
      view.relayout(DEFAULT_PX * v);
    };

    view.fitAll();
    // 调试/无头截图用句柄
    window.__dag = { view: view, dag: DATA, layout: laid };
  </script>
</body>
</html>`;
  }

  window.FlowDagStandalone = { generateStandaloneDagHtml: generateStandaloneDagHtml };
})(window);
