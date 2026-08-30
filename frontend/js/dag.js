// =========================================================================
// 🌳 DAG 完整家族血脉拓扑全景图谱模块 (Flow & Accord)
// 支持世代分层、双亲与子嗣连线、配偶眷属关联、祖先后代高亮溯源与新标签页独立导出
// =========================================================================

(function (window) {
  'use strict';

  // 节点尺寸与布局常量
  const NODE_W = 180;
  const NODE_H = 76;
  const LEVEL_H = 150;
  const SIBLING_GAP = 28;
  const SPOUSE_GAP = 18;

  // 1. 提取与构建 DAG 数据
  function buildLineageDAG(focusId, sim, mode) {
    if (!mode) mode = 'focus';
    const allMap = new Map();
    // 汇整当前活跃族人与先祖档案库
    if (sim && sim.agentArchive) {
      for (const [id, ag] of sim.agentArchive) {
        allMap.set(id, ag);
      }
    }
    if (sim && sim.agents) {
      for (const ag of sim.agents) {
        allMap.set(ag.id, ag);
      }
    }

    if (!focusId || !allMap.has(focusId)) {
      if (allMap.size > 0) focusId = allMap.keys().next().value;
    }

    const relevantIds = new Set();
    const ancestors = new Set();
    const descendants = new Set();

    if (mode === 'all') {
      for (const id of allMap.keys()) relevantIds.add(id);
    } else {
      if (focusId && allMap.has(focusId)) {
        relevantIds.add(focusId);

        // 向上检索所有祖先
        const aQueue = [focusId];
        while (aQueue.length > 0) {
          const currId = aQueue.shift();
          const ag = allMap.get(currId);
          if (!ag) continue;
          if (ag.fatherId && allMap.has(ag.fatherId)) {
            if (!ancestors.has(ag.fatherId)) {
              ancestors.add(ag.fatherId);
              relevantIds.add(ag.fatherId);
              aQueue.push(ag.fatherId);
            }
          }
          if (ag.motherId && allMap.has(ag.motherId)) {
            if (!ancestors.has(ag.motherId)) {
              ancestors.add(ag.motherId);
              relevantIds.add(ag.motherId);
              aQueue.push(ag.motherId);
            }
          }
        }

        // 向下检索所有后代
        const dQueue = [focusId];
        while (dQueue.length > 0) {
          const currId = dQueue.shift();
          const ag = allMap.get(currId);
          if (!ag) continue;
          if (ag.children && Array.isArray(ag.children)) {
            for (const cId of ag.children) {
              if (allMap.has(cId) && !descendants.has(cId)) {
                descendants.add(cId);
                relevantIds.add(cId);
                dQueue.push(cId);
              }
            }
          }
        }

        // 补齐涉及节点的所有配偶 (保持家庭双亲完整)
        const spouseAdditions = [];
        for (const id of relevantIds) {
          const ag = allMap.get(id);
          if (ag && ag.spouseId && allMap.has(ag.spouseId)) {
            spouseAdditions.push(ag.spouseId);
          }
        }
        for (const spId of spouseAdditions) relevantIds.add(spId);
      }
    }

    // 格式化节点数据
    const nodes = [];
    const nodeMap = new Map();
    for (const id of relevantIds) {
      const ag = allMap.get(id);
      if (!ag) continue;
      const gen = ag.generation && ag.generation >= 1 ? ag.generation : ((ag.fatherId || ag.motherId) ? 2 : 1);
      const nodeObj = {
        id: ag.id,
        gender: ag.gender || (ag.id % 2 === 1 ? 'male' : 'female'),
        generation: gen,
        isAlive: !!ag.isAlive,
        age: Math.floor(ag.age || 0),
        hunger: Math.round(ag.hunger || 0),
        stamina: Math.round(ag.stamina || 0),
        health: ag.health !== undefined ? ag.health.toFixed(1) : '100',
        currentNeed: ag.currentNeed || '',
        deathCause: ag.deathCause || null,
        fatherId: ag.fatherId || null,
        motherId: ag.motherId || null,
        spouseId: ag.spouseId || null,
        children: Array.isArray(ag.children) ? [...ag.children] : [],
        homeHouseId: ag.homeHouseId || null,
        intelligence: Math.round(ag.intelligence || 100),
        strength: Math.round(ag.strength || 100),
        libido: Math.round(ag.libido || 100),
        digestionEfficiency: Math.round(ag.digestionEfficiency || 100),
        sleepEfficiency: Math.round(ag.sleepEfficiency || 100),
        lifeExpectancy: Math.round(ag.lifeExpectancy || 100),
        isAncestor: ancestors.has(ag.id),
        isDescendant: descendants.has(ag.id),
        isFocus: ag.id === focusId
      };
      nodes.push(nodeObj);
      nodeMap.set(ag.id, nodeObj);
    }

    // 计算分层与坐标 (Topological Generation Layout)
    const genGroups = new Map();
    for (const n of nodes) {
      if (!genGroups.has(n.generation)) genGroups.set(n.generation, []);
      genGroups.get(n.generation).push(n);
    }

    const sortedGens = Array.from(genGroups.keys()).sort((a, b) => a - b);
    let maxRowW = 800;
    const padding = 80;

    // 对每一代内部进行配偶成对排列
    for (const gen of sortedGens) {
      const rowNodes = genGroups.get(gen);
      const orderedRow = [];
      const visitedInRow = new Set();

      for (const n of rowNodes) {
        if (visitedInRow.has(n.id)) continue;
        visitedInRow.add(n.id);
        orderedRow.push(n);
        if (n.spouseId && nodeMap.has(n.spouseId) && nodeMap.get(n.spouseId).generation === gen) {
          if (!visitedInRow.has(n.spouseId)) {
            visitedInRow.add(n.spouseId);
            orderedRow.push(nodeMap.get(n.spouseId));
          }
        }
      }

      // 计算当前行的 X 坐标
      let currX = padding;
      for (let i = 0; i < orderedRow.length; i++) {
        const n = orderedRow[i];
        n.x = currX;
        n.y = padding + (gen - (sortedGens[0] || 1)) * LEVEL_H;

        const isSpouseNext = (i + 1 < orderedRow.length) && (orderedRow[i + 1].id === n.spouseId);
        currX += NODE_W + (isSpouseNext ? SPOUSE_GAP : SIBLING_GAP);
      }
      if (currX > maxRowW) maxRowW = currX;
    }

    const totalH = padding * 2 + Math.max(1, sortedGens.length) * LEVEL_H;
    const totalW = Math.max(960, maxRowW + padding);

    // 构建连线数据 (Edges)
    const edges = [];
    const spouseEdges = [];
    const processedSpousePairs = new Set();

    for (const n of nodes) {
      // 夫妻连线
      if (n.spouseId && nodeMap.has(n.spouseId)) {
        const pairKey = [n.id, n.spouseId].sort().join('-');
        if (!processedSpousePairs.has(pairKey)) {
          processedSpousePairs.add(pairKey);
          const sp = nodeMap.get(n.spouseId);
          spouseEdges.push({
            from: n,
            to: sp,
            x1: Math.min(n.x, sp.x) + NODE_W,
            y1: n.y + NODE_H / 2,
            x2: Math.max(n.x, sp.x),
            y2: sp.y + NODE_H / 2
          });
        }
      }

      // 双亲 -> 子女连线
      const hasFather = n.fatherId && nodeMap.has(n.fatherId);
      const hasMother = n.motherId && nodeMap.has(n.motherId);
      if (hasFather || hasMother) {
        let parentX, parentY;
        if (hasFather && hasMother) {
          const f = nodeMap.get(n.fatherId);
          const m = nodeMap.get(n.motherId);
          parentX = (f.x + m.x + NODE_W) / 2;
          parentY = Math.max(f.y, m.y) + NODE_H;
        } else if (hasFather) {
          const f = nodeMap.get(n.fatherId);
          parentX = f.x + NODE_W / 2;
          parentY = f.y + NODE_H;
        } else {
          const m = nodeMap.get(n.motherId);
          parentX = m.x + NODE_W / 2;
          parentY = m.y + NODE_H;
        }

        const childX = n.x + NODE_W / 2;
        const childY = n.y;

        edges.push({
          childId: n.id,
          fatherId: n.fatherId,
          motherId: n.motherId,
          isAncestorLine: n.isAncestor || n.isFocus,
          isDescendantLine: n.isDescendant || n.isFocus,
          d: `M ${parentX} ${parentY} C ${parentX} ${(parentY + childY) / 2}, ${childX} ${(parentY + childY) / 2}, ${childX} ${childY}`
        });
      }
    }

    return {
      focusId,
      mode,
      width: totalW,
      height: totalH,
      sortedGens,
      nodes,
      edges,
      spouseEdges,
      nodeMap
    };
  }

  // 2. 生成完全独立的单文件 HTML 字符串 (支持打开新标签页独立运行)
  function generateStandaloneDagHtml(focusId, sim, mode) {
    if (!mode) mode = 'focus';
    const dag = buildLineageDAG(focusId, sim, mode);
    const dagJson = JSON.stringify(dag);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flow & Accord · 家族世系 DAG 完整族谱</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      background: #090e17;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .dag-topbar {
      height: 54px;
      background: rgba(15, 23, 42, 0.95);
      border-bottom: 1px solid rgba(56, 189, 248, 0.25);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      z-index: 100;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    .dag-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .dag-title {
      font-size: 15px;
      font-weight: 700;
      color: #38bdf8;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dag-stats-badge {
      font-size: 11px;
      color: #94a3b8;
      background: rgba(30, 41, 59, 0.8);
      padding: 3px 10px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .dag-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dag-btn {
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #cbd5e1;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.2s ease;
    }
    .dag-btn:hover {
      background: rgba(56, 189, 248, 0.2);
      border-color: #38bdf8;
      color: #38bdf8;
    }
    .dag-btn.active {
      background: #0284c7;
      border-color: #38bdf8;
      color: #fff;
    }
    .dag-workspace {
      flex: 1;
      position: relative;
      background: radial-gradient(circle at 50% 50%, #0f172a 0%, #070b12 100%);
      overflow: hidden;
      cursor: grab;
    }
    .dag-workspace:active {
      cursor: grabbing;
    }
    .dag-viewport {
      position: absolute;
      top: 0; left: 0;
      transform-origin: 0 0;
      will-change: transform;
    }
    .dag-svg-layer {
      position: absolute;
      top: 0; left: 0;
      pointer-events: none;
    }
    .dag-edge {
      fill: none;
      stroke: rgba(148, 163, 184, 0.35);
      stroke-width: 2;
      transition: stroke 0.2s, stroke-width 0.2s;
    }
    .dag-edge.ancestor {
      stroke: #fbbf24;
      stroke-width: 3;
      filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.6));
    }
    .dag-edge.descendant {
      stroke: #38bdf8;
      stroke-width: 3;
      filter: drop-shadow(0 0 4px rgba(56, 189, 248, 0.6));
    }
    .dag-spouse-edge {
      stroke: #ec4899;
      stroke-dasharray: 4 4;
      stroke-width: 1.5;
    }
    .dag-node {
      position: absolute;
      width: ${NODE_W}px;
      height: ${NODE_H}px;
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-shadow: 0 6px 16px rgba(0,0,0,0.4);
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .dag-node:hover {
      transform: translateY(-2px) scale(1.03);
      border-color: #38bdf8;
      box-shadow: 0 10px 24px rgba(56, 189, 248, 0.25);
      z-index: 10;
    }
    .dag-node.focus {
      border: 2px solid #38bdf8;
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.5), 0 8px 24px rgba(0,0,0,0.6);
      background: rgba(14, 30, 56, 0.95);
      z-index: 20;
    }
    .dag-node.ancestor {
      border-color: rgba(251, 191, 36, 0.8);
      background: rgba(36, 28, 12, 0.92);
    }
    .dag-node.descendant {
      border-color: rgba(56, 189, 248, 0.7);
      background: rgba(12, 32, 48, 0.92);
    }
    .dag-node.dead {
      opacity: 0.72;
      filter: grayscale(0.4);
    }
    .dag-node-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .dag-node-name {
      font-size: 12px;
      font-weight: 700;
      color: #f8fafc;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .dag-node-gen {
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 4px;
      background: #334155;
      color: #94a3b8;
    }
    .dag-node-status {
      font-size: 10px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
    }
    .dag-node-traits {
      display: flex;
      gap: 6px;
      font-size: 9px;
      color: #cbd5e1;
      border-top: 1px solid rgba(255,255,255,0.06);
      padding-top: 3px;
    }
    .dag-sidebar {
      position: absolute;
      top: 20px; right: 20px;
      width: 280px;
      background: rgba(15, 23, 42, 0.96);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.7);
      padding: 16px;
      z-index: 110;
      backdrop-filter: blur(10px);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .dag-sidebar-title {
      font-size: 14px;
      font-weight: 700;
      color: #38bdf8;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .dag-help-bar {
      position: absolute;
      bottom: 15px; left: 20px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 11px;
      color: #94a3b8;
      pointer-events: none;
      z-index: 50;
    }
  </style>
</head>
<body>
  <div class="dag-topbar">
    <div class="dag-brand">
      <div class="dag-title">🌳 Flow & Accord · 家族世系 DAG 全景</div>
      <div class="dag-stats-badge" id="topbar-stats">世代数: 1 · 节点: 0</div>
    </div>
    <div class="dag-actions">
      <button class="dag-btn" id="btn-focus-center">🎯 居中定位</button>
      <button class="dag-btn" id="btn-reset-view">🔍 重置缩放</button>
    </div>
  </div>

  <div class="dag-workspace" id="workspace">
    <div class="dag-viewport" id="viewport">
      <svg class="dag-svg-layer" id="svgLayer"></svg>
      <div id="nodesLayer"></div>
    </div>
    <div class="dag-help-bar">🖱️ 拖拽画布平移 · 滚轮缩放 · 点击卡片高亮祖先(金)与后代(蓝)</div>
    <div class="dag-sidebar" id="sidebar" style="display:none;">
      <div class="dag-sidebar-title">
        <span id="side-title">族人档案</span>
        <button class="dag-btn" style="padding:2px 6px; font-size:10px;" id="side-close">✕</button>
      </div>
      <div id="side-body" style="font-size:11px; line-height:1.6; color:#cbd5e1;"></div>
    </div>
  </div>

  <script>
    const DAG = ${dagJson};
    let scale = 1.0;
    let panX = 40;
    let panY = 40;
    let isDragging = false;
    let startX = 0, startY = 0;
    let currentFocus = DAG.focusId;

    const workspace = document.getElementById('workspace');
    const viewport = document.getElementById('viewport');
    const svgLayer = document.getElementById('svgLayer');
    const nodesLayer = document.getElementById('nodesLayer');
    const sidebar = document.getElementById('sidebar');
    const sideTitle = document.getElementById('side-title');
    const sideBody = document.getElementById('side-body');
    const topStats = document.getElementById('topbar-stats');

    function init() {
      topStats.textContent = '世代数: ' + (DAG.sortedGens.length || 1) + ' · 族人总数: ' + DAG.nodes.length;
      renderGraph();
      centerOnNode(currentFocus);
      setupEvents();
    }

    function renderGraph() {
      svgLayer.setAttribute('width', DAG.width);
      svgLayer.setAttribute('height', DAG.height);
      svgLayer.innerHTML = '';
      nodesLayer.innerHTML = '';

      // 夫妻连线
      DAG.spouseEdges.forEach(sp => {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', sp.x1);
        line.setAttribute('y1', sp.y1);
        line.setAttribute('x2', sp.x2);
        line.setAttribute('y2', sp.y2);
        line.setAttribute('class', 'dag-spouse-edge');
        svgLayer.appendChild(line);
      });

      // 双亲 -> 子女连线
      DAG.edges.forEach(e => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', e.d);
        let cls = 'dag-edge';
        if (e.isAncestorLine) cls += ' ancestor';
        if (e.isDescendantLine) cls += ' descendant';
        path.setAttribute('class', cls);
        svgLayer.appendChild(path);
      });

      // 渲染节点卡片
      DAG.nodes.forEach(n => {
        const card = document.createElement('div');
        let cls = 'dag-node';
        if (n.id === currentFocus) cls += ' focus';
        else if (n.isAncestor) cls += ' ancestor';
        else if (n.isDescendant) cls += ' descendant';
        if (!n.isAlive) cls += ' dead';

        card.className = cls;
        card.style.left = n.x + 'px';
        card.style.top = n.y + 'px';

        const avatar = !n.isAlive ? '💀' : (n.gender === 'female' ? '👩' : '👦');
        const genText = n.generation === 1 ? '始祖' : 'G' + n.generation;
        const statusText = n.isAlive ? ('🟢 ' + n.age + 's · 心' + n.health) : ('💀 ' + (n.deathCause || '仙逝'));

        card.innerHTML = \`
          <div class="dag-node-header">
            <div class="dag-node-name">
              <span>\${avatar}</span>
              <span>#\${n.id} \${n.gender === 'female' ? '♀' : '♂'}</span>
            </div>
            <span class="dag-node-gen">\${genText}</span>
          </div>
          <div class="dag-node-status">
            <span>\${statusText}</span>
            <span>\${n.homeHouseId ? '🏠#' + n.homeHouseId : '🏕️营'}</span>
          </div>
          <div class="dag-node-traits">
            <span>智\${n.intelligence}</span>
            <span>力\${n.strength}</span>
            <span>魅\${n.libido}</span>
            <span>寿\${n.lifeExpectancy}</span>
          </div>
        \`;

        card.onclick = (e) => {
          e.stopPropagation();
          inspectNode(n);
        };

        nodesLayer.appendChild(card);
      });

      updateTransform();
    }

    function inspectNode(n) {
      currentFocus = n.id;
      sideTitle.innerHTML = (n.gender === 'female' ? '👩' : '👦') + ' 部落民 #' + n.id + ' (第' + n.generation + '代)';
      sideBody.innerHTML = \`
        <div style="margin-bottom:6px; color:#38bdf8; font-weight:600;">
          \${n.isAlive ? '🟢 存活状态 · 年龄 ' + n.age + 's' : '💀 已故 · 死因: ' + (n.deathCause || '寿终正寝')}
        </div>
        <div>👴 父亲: \${n.fatherId ? '#' + n.fatherId : '无 (始祖代)'}</div>
        <div>👩 母亲: \${n.motherId ? '#' + n.motherId : '无 (始祖代)'}</div>
        <div>💍 配偶: \${n.spouseId ? '#' + n.spouseId : '未婚'}</div>
        <div>👶 子嗣数: \${n.children ? n.children.length : 0} 位</div>
        <div>🏠 房屋: \${n.homeHouseId ? '私宅 #' + n.homeHouseId : '居住在营地'}</div>
        <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.1);">
          <strong>🧬 先天禀赋属性</strong><br>
          🧠 智力: \${n.intelligence} · 💪 力量: \${n.strength}<br>
          ❤️‍🔥 魅力: \${n.libido} · 🍽️ 消化: \${n.digestionEfficiency}<br>
          😴 睡眠: \${n.sleepEfficiency} · ⏳ 寿命: \${n.lifeExpectancy}
        </div>
      \`;
      sidebar.style.display = 'flex';
      renderGraph();
    }

    function centerOnNode(id) {
      const n = DAG.nodes.find(node => node.id === id);
      if (!n) return;
      const wRect = workspace.getBoundingClientRect();
      panX = wRect.width / 2 - (n.x + NODE_W / 2) * scale;
      panY = wRect.height / 2 - (n.y + NODE_H / 2) * scale;
      updateTransform();
    }

    function updateTransform() {
      viewport.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + scale + ')';
    }

    function setupEvents() {
      workspace.onmousedown = e => {
        if (e.target.closest('.dag-node') || e.target.closest('.dag-sidebar')) return;
        isDragging = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
      };
      window.onmousemove = e => {
        if (!isDragging) return;
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        updateTransform();
      };
      window.onmouseup = () => { isDragging = false; };

      workspace.onwheel = e => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
        const newScale = Math.max(0.25, Math.min(2.5, scale * zoomFactor));
        const rect = workspace.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        panX = mx - (mx - panX) * (newScale / scale);
        panY = my - (my - panY) * (newScale / scale);
        scale = newScale;
        updateTransform();
      };

      document.getElementById('btn-focus-center').onclick = () => centerOnNode(currentFocus);
      document.getElementById('btn-reset-view').onclick = () => {
        scale = 1.0;
        centerOnNode(currentFocus);
      };
      document.getElementById('side-close').onclick = () => { sidebar.style.display = 'none'; };
    }

    init();
  </script>
</body>
</html>`;
  }

  // 3. 在当前页面内全屏渲染 DAG 模态组件
  let currentInPageDag = null;
  let inPageScale = 1.0;
  let inPagePanX = 50;
  let inPagePanY = 50;
  let inPageDragging = false;
  let inPageStartX = 0, inPageStartY = 0;
  let inPageFocusId = 1;
  let inPageMode = 'focus';

  function renderInPageDag(sim, containerEl) {
    if (!containerEl) return;
    const dag = buildLineageDAG(inPageFocusId, sim, inPageMode);
    currentInPageDag = dag;

    containerEl.innerHTML = `
      <div class="dag-viewport" id="inpage-dag-viewport">
        <svg class="dag-svg-layer" id="inpage-dag-svg" width="${dag.width}" height="${dag.height}"></svg>
        <div id="inpage-dag-nodes" style="position:absolute; top:0; left:0; width:${dag.width}px; height:${dag.height}px;"></div>
      </div>
    `;

    const svgLayer = document.getElementById('inpage-dag-svg');
    const nodesLayer = document.getElementById('inpage-dag-nodes');

    // 夫妻横向虚线连线
    dag.spouseEdges.forEach(sp => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', sp.x1);
      line.setAttribute('y1', sp.y1);
      line.setAttribute('x2', sp.x2);
      line.setAttribute('y2', sp.y2);
      line.setAttribute('class', 'dag-spouse-edge');
      svgLayer.appendChild(line);
    });

    // 双亲 -> 子女 Bezier 连线
    dag.edges.forEach(e => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', e.d);
      let cls = 'dag-edge';
      if (e.isAncestorLine) cls += ' ancestor';
      if (e.isDescendantLine) cls += ' descendant';
      path.setAttribute('class', cls);
      svgLayer.appendChild(path);
    });

    // 节点卡片
    dag.nodes.forEach(n => {
      const card = document.createElement('div');
      let cls = 'dag-node';
      if (n.id === inPageFocusId) cls += ' focus';
      else if (n.isAncestor) cls += ' ancestor';
      else if (n.isDescendant) cls += ' descendant';
      if (!n.isAlive) cls += ' dead';

      card.className = cls;
      card.style.left = n.x + 'px';
      card.style.top = n.y + 'px';

      const avatar = !n.isAlive ? '💀' : (n.gender === 'female' ? (n.isPregnant ? '🤰' : '👩') : '👦');
      const genText = n.generation === 1 ? '始祖' : 'G' + n.generation;
      const statusText = n.isAlive ? (`🟢 ${n.age}s · 心${n.health}`) : (`💀 ${n.deathCause || '仙逝'}`);

      card.innerHTML = `
        <div class="dag-node-header">
          <div class="dag-node-name">
            <span>${avatar}</span>
            <span>#${n.id} ${n.gender === 'female' ? '♀' : '♂'}</span>
          </div>
          <span class="dag-node-gen">${genText}</span>
        </div>
        <div class="dag-node-status">
          <span>${statusText}</span>
          <span>${n.homeHouseId ? '🏠#' + n.homeHouseId : '🏕️营'}</span>
        </div>
        <div class="dag-node-traits">
          <span>智${n.intelligence}</span>
          <span>力${n.strength}</span>
          <span>魅${n.libido}</span>
          <span>寿${n.lifeExpectancy}</span>
        </div>
      `;

      card.onclick = (e) => {
        e.stopPropagation();
        inPageFocusId = n.id;
        showInPageInspector(n, sim);
        renderInPageDag(sim, containerEl);
      };

      nodesLayer.appendChild(card);
    });

    updateInPageTransform();
  }

  function updateInPageTransform() {
    const vp = document.getElementById('inpage-dag-viewport');
    if (vp) {
      vp.style.transform = `translate(${inPagePanX}px, ${inPagePanY}px) scale(${inPageScale})`;
    }
  }

  function showInPageInspector(n, sim) {
    const insp = document.getElementById('dag-inspector-panel');
    const header = document.getElementById('dag-insp-header');
    const content = document.getElementById('dag-insp-content');
    if (!insp || !header || !content) return;

    header.innerHTML = `
      <div style="font-size:13px; font-weight:700; color:#38bdf8; display:flex; align-items:center; gap:6px;">
        <span>${n.gender === 'female' ? '👩' : '👦'}</span>
        <span>部落民 #${n.id} (第${n.generation}代 · ${n.gender === 'female' ? '女性' : '男性'})</span>
      </div>
      <button id="dag-insp-close" style="background:transparent; border:none; color:#94a3b8; font-size:14px; cursor:pointer;">✕</button>
    `;

    content.innerHTML = `
      <div style="margin-bottom:6px; color:#38bdf8; font-weight:600;">
        ${n.isAlive ? `🟢 活跃中 · 年龄 ${n.age}s · 健康 ${n.health}` : `💀 已故 · 死因: ${n.deathCause || '寿终正寝'}`}
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-bottom:8px;">
        <div>👴 父亲: ${n.fatherId ? '#' + n.fatherId : '无 (始祖)'}</div>
        <div>👩 母亲: ${n.motherId ? '#' + n.motherId : '无 (始祖)'}</div>
        <div>💍 配偶: ${n.spouseId ? '#' + n.spouseId : '未婚'}</div>
        <div>👶 后代: ${n.children ? n.children.length : 0} 位</div>
      </div>
      <div style="background:rgba(30,41,59,0.6); padding:6px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.06);">
        <strong>🧬 遗传禀赋属性:</strong><br>
        🧠 智力: ${n.intelligence} · 💪 力量: ${n.strength} · ❤️‍🔥 魅力: ${n.libido}<br>
        🍽️ 消化率: ${n.digestionEfficiency} · 😴 睡眠率: ${n.sleepEfficiency} · ⏳ 寿命: ${n.lifeExpectancy}
      </div>
      <button id="dag-insp-track-btn" class="dag-tool-btn primary" style="width:100%; margin-top:8px; justify-content:center;">🎯 切换世界镜头追踪此人</button>
    `;

    insp.style.display = 'flex';

    document.getElementById('dag-insp-close').onclick = () => { insp.style.display = 'none'; };
    const trackBtn = document.getElementById('dag-insp-track-btn');
    if (trackBtn) {
      trackBtn.onclick = () => {
        if (sim) {
          sim.selectionType = 'agent';
          sim.selectedAgentId = n.id;
          if (window.camera && typeof sim.getAgent === 'function') {
            const ag = sim.getAgent(n.id);
            if (ag && ag.pos) {
              const cosZ = Math.cos(window.camera.rotZ), sinZ = Math.sin(window.camera.rotZ);
              const rx = ag.pos.x * cosZ - ag.pos.y * sinZ;
              const ry = ag.pos.x * sinZ + ag.pos.y * cosZ;
              const cosX = Math.cos(window.camera.rotX), sinX = Math.sin(window.camera.rotX);
              const y2 = ry * cosX - (ag.pos.z || 0) * sinX;
              window.camera.panX = -rx * window.camera.zoom;
              window.camera.panY = -y2 * window.camera.zoom;
            }
          }
        }
        // 关闭 DAG 模态框返回主视图
        const dagModal = document.getElementById('full-dag-modal');
        if (dagModal) dagModal.style.display = 'none';
      };
    }
  }

  function centerInPageNode(id, containerEl) {
    if (!currentInPageDag) return;
    const n = currentInPageDag.nodes.find(node => node.id === id);
    if (!n || !containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    inPagePanX = rect.width / 2 - (n.x + NODE_W / 2) * inPageScale;
    inPagePanY = rect.height / 2 - (n.y + NODE_H / 2) * inPageScale;
    updateInPageTransform();
  }

  // 4. 导出全局 API
  window.FlowDag = {
    buildLineageDAG,
    generateStandaloneDagHtml,
    openInNewTab(focusId, sim, mode) {
      if (!mode) mode = 'focus';
      const win = window.open('', '_blank');
      if (!win) {
        // 若被浏览器拦截弹窗，则降级为在主页面打开
        this.openModal(focusId, sim, mode);
        return;
      }
      const html = generateStandaloneDagHtml(focusId, sim, mode);
      win.document.open();
      win.document.write(html);
      win.document.close();
    },
    openModal(focusId, sim, mode) {
      if (!mode) mode = 'focus';
      const modal = document.getElementById('full-dag-modal');
      const container = document.getElementById('dag-graph-container');
      if (!modal || !container) return;

      inPageFocusId = focusId || (sim && sim.selectedAgentId) || 1;
      inPageMode = mode;
      inPageScale = 1.0;

      modal.style.display = 'flex';
      renderInPageDag(sim, container);
      centerInPageNode(inPageFocusId, container);

      // 绑定交互控制事件
      container.onmousedown = e => {
        if (e.target.closest('.dag-node') || e.target.closest('.dag-floating-inspector')) return;
        inPageDragging = true;
        inPageStartX = e.clientX - inPagePanX;
        inPageStartY = e.clientY - inPagePanY;
      };
      window.onmousemove = e => {
        if (!inPageDragging) return;
        inPagePanX = e.clientX - inPageStartX;
        inPagePanY = e.clientY - inPageStartY;
        updateInPageTransform();
      };
      window.onmouseup = () => { inPageDragging = false; };

      container.onwheel = e => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        const newScale = Math.max(0.25, Math.min(2.5, inPageScale * factor));
        const rect = container.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        inPagePanX = mx - (mx - inPagePanX) * (newScale / inPageScale);
        inPagePanY = my - (my - inPagePanY) * (newScale / inPageScale);
        inPageScale = newScale;
        updateInPageTransform();
      };

      const btnModeFocus = document.getElementById('dag-btn-mode-focus');
      const btnModeAll = document.getElementById('dag-btn-mode-all');
      if (btnModeFocus && btnModeAll) {
        btnModeFocus.onclick = () => {
          inPageMode = 'focus';
          btnModeFocus.classList.add('active');
          btnModeAll.classList.remove('active');
          renderInPageDag(sim, container);
          centerInPageNode(inPageFocusId, container);
        };
        btnModeAll.onclick = () => {
          inPageMode = 'all';
          btnModeAll.classList.add('active');
          btnModeFocus.classList.remove('active');
          renderInPageDag(sim, container);
          centerInPageNode(inPageFocusId, container);
        };
      }

      const btnCenter = document.getElementById('dag-btn-center');
      if (btnCenter) btnCenter.onclick = () => centerInPageNode(inPageFocusId, container);

      const btnReset = document.getElementById('dag-btn-reset-zoom');
      if (btnReset) {
        btnReset.onclick = () => {
          inPageScale = 1.0;
          centerInPageNode(inPageFocusId, container);
        };
      }

      const btnNewTab = document.getElementById('dag-btn-new-tab');
      if (btnNewTab) {
        btnNewTab.onclick = () => {
          window.FlowDag.openInNewTab(inPageFocusId, sim, inPageMode);
        };
      }

      const btnClose = document.getElementById('dag-btn-close');
      if (btnClose) {
        btnClose.onclick = () => { modal.style.display = 'none'; };
      }
    }
  };
})(window);
