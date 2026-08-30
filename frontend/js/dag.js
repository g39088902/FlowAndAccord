// =========================================================================
// 🌳 DAG 直系家族血脉拓扑全景图谱模块 (Flow & Accord)
// 支持世代出生时间 Y 轴流转、双亲独立有向边 (DAG)、配偶关联与丝滑拖拽缩放
// =========================================================================

(function (window) {
  'use strict';

  // 节点尺寸与布局常量
  const NODE_W = 184;
  const NODE_H = 80;
  const LEVEL_H = 160;
  const SIBLING_GAP = 32;
  const SPOUSE_GAP = 20;

  // 1. 提取与构建真实 DAG 数据 (纯净直系血亲：父母/父母之父母，子女/子女之子女，排除叔伯姨姑旁系)
  function buildLineageDAG(focusId, sim) {
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
    const directSpouses = new Set();

    if (focusId && allMap.has(focusId)) {
      relevantIds.add(focusId);

      // 1. 向上溯源纯净直系祖先 (仅双亲，不检索父母兄弟姐妹即叔伯姑舅姨)
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

      // 2. 向下追溯纯净直系后代 (仅亲生子女，不检索叔伯姨姑的堂表后代)
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

      // 3. 关联直系核心配偶 (焦点族人配偶，以及后代各代双亲配偶，保障育儿双亲完整，不含祖先再婚旁支)
      const focusAg = allMap.get(focusId);
      if (focusAg && focusAg.spouseId && allMap.has(focusAg.spouseId)) {
        directSpouses.add(focusAg.spouseId);
        relevantIds.add(focusAg.spouseId);
      }
      for (const dId of descendants) {
        const dAg = allMap.get(dId);
        if (dAg) {
          if (dAg.spouseId && allMap.has(dAg.spouseId)) {
            directSpouses.add(dAg.spouseId);
            relevantIds.add(dAg.spouseId);
          }
          if (dAg.fatherId && allMap.has(dAg.fatherId) && !ancestors.has(dAg.fatherId) && dAg.fatherId !== focusId) {
            directSpouses.add(dAg.fatherId);
            relevantIds.add(dAg.fatherId);
          }
          if (dAg.motherId && allMap.has(dAg.motherId) && !ancestors.has(dAg.motherId) && dAg.motherId !== focusId) {
            directSpouses.add(dAg.motherId);
            relevantIds.add(dAg.motherId);
          }
        }
      }
    }

    const currentTick = (sim && sim.worldTick !== undefined) ? sim.worldTick : ((sim && sim.worldSnapshot && sim.worldSnapshot.tick) || 0);

    // 格式化节点数据并精确计算出生时间 (birthSec)
    const nodes = [];
    const nodeMap = new Map();
    for (const id of relevantIds) {
      const ag = allMap.get(id);
      if (!ag) continue;
      const gen = ag.generation && ag.generation >= 1 ? ag.generation : ((ag.fatherId || ag.motherId) ? 2 : 1);
      
      // 出生时间计算：始祖按初始年龄/ID排列于负数年代，后代按出生tick与ID单调递增
      let birthSec = 0;
      if (gen === 1 || (!ag.fatherId && !ag.motherId)) {
        birthSec = -2000 + (ag.id * 8);
      } else {
        const ageSec = ag.age || 0;
        birthSec = Math.max(0, (currentTick / 30) - ageSec);
        if (birthSec === 0) birthSec = (gen - 1) * 300 + ag.id * 10;
      }

      const nodeObj = {
        id: ag.id,
        gender: ag.gender || (ag.id % 2 === 1 ? 'male' : 'female'),
        generation: gen,
        birthSec,
        isAlive: !!ag.isAlive,
        isPregnant: !!ag.isPregnant,
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
        isFocus: ag.id === focusId,
        isDirectSpouse: directSpouses.has(ag.id)
      };
      nodes.push(nodeObj);
      nodeMap.set(ag.id, nodeObj);
    }

    // 拓扑层级计算 (Topological Generation Depth)
    for (const n of nodes) {
      n.depth = Math.max(0, n.generation - 1);
    }

    // 按代际深度分组并按出生时间排序
    const depthGroups = new Map();
    for (const n of nodes) {
      if (!depthGroups.has(n.depth)) depthGroups.set(n.depth, []);
      depthGroups.get(n.depth).push(n);
    }

    const sortedDepths = Array.from(depthGroups.keys()).sort((a, b) => a - b);
    let maxRowW = 800;
    const paddingX = 80;
    const paddingY = 80;

    // 每一代根据出生时间与配偶对排布 X 与出生时间微阶梯 Y 坐标
    for (const depth of sortedDepths) {
      const rowNodes = depthGroups.get(depth);
      // 同层按出生时间先后排序
      rowNodes.sort((a, b) => a.birthSec - b.birthSec);

      const orderedRow = [];
      const visitedInRow = new Set();

      for (const n of rowNodes) {
        if (visitedInRow.has(n.id)) continue;
        visitedInRow.add(n.id);
        orderedRow.push(n);
        // 如果有配偶且在同层，紧随其后排列
        if (n.spouseId && nodeMap.has(n.spouseId) && nodeMap.get(n.spouseId).depth === depth) {
          if (!visitedInRow.has(n.spouseId)) {
            visitedInRow.add(n.spouseId);
            orderedRow.push(nodeMap.get(n.spouseId));
          }
        }
      }

      let currX = paddingX;
      for (let i = 0; i < orderedRow.length; i++) {
        const n = orderedRow[i];
        n.x = currX;

        // Y 轴位置：按出生时间平滑阶梯排布，先出生者在上，后出生者在下
        const birthOffsetInRow = (i % 2 === 1 && orderedRow[i - 1].spouseId === n.id)
          ? (orderedRow[i - 1].yOffset || 0)
          : ((n.birthSec > 0 ? (n.birthSec % 40) : (i * 10)));
        n.yOffset = Math.min(36, birthOffsetInRow);
        n.y = paddingY + depth * LEVEL_H + n.yOffset;

        const isSpouseNext = (i + 1 < orderedRow.length) && (orderedRow[i + 1].id === n.spouseId);
        currX += NODE_W + (isSpouseNext ? SPOUSE_GAP : SIBLING_GAP);
      }
      if (currX > maxRowW) maxRowW = currX;
    }

    // DAG 拓扑硬约束：子代的 Y 必须严格大于双亲的 Y 底部
    for (const n of nodes) {
      let minParentY = -1;
      if (n.fatherId && nodeMap.has(n.fatherId)) {
        minParentY = Math.max(minParentY, nodeMap.get(n.fatherId).y + NODE_H + 36);
      }
      if (n.motherId && nodeMap.has(n.motherId)) {
        minParentY = Math.max(minParentY, nodeMap.get(n.motherId).y + NODE_H + 36);
      }
      if (minParentY > n.y) {
        n.y = minParentY;
      }
    }

    let maxY = 0;
    for (const n of nodes) {
      if (n.y + NODE_H > maxY) maxY = n.y + NODE_H;
    }

    const totalH = Math.max(760, maxY + paddingY);
    const totalW = Math.max(1050, maxRowW + paddingX);

    // 构建真实 DAG 连线数据：双亲各自一条独立有向边 (Father & Mother Directed Edges with Arrows)
    const edges = [];
    const spouseEdges = [];
    const processedSpousePairs = new Set();

    for (const n of nodes) {
      // 夫妻横向关联虚线
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

      // 父亲 -> 子女 独立有向边 (DAG 边 1: 父亲出发，蓝色箭头指向子代左肩)
      if (n.fatherId && nodeMap.has(n.fatherId)) {
        const f = nodeMap.get(n.fatherId);
        const startX = f.x + NODE_W * 0.38;
        const startY = f.y + NODE_H;
        const endX = n.x + NODE_W * 0.32;
        const endY = n.y;
        const midY = startY + Math.max(20, (endY - startY) * 0.5);

        edges.push({
          childId: n.id,
          parentId: f.id,
          parentType: 'father',
          markerId: (n.isAncestor || n.isFocus) ? 'arrow-ancestor' : 'arrow-father',
          isAncestorLine: n.isAncestor || n.isFocus,
          isDescendantLine: n.isDescendant || n.isFocus,
          d: `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`
        });
      }

      // 母亲 -> 子女 独立有向边 (DAG 边 2: 母亲出发，粉色箭头指向子代右肩)
      if (n.motherId && nodeMap.has(n.motherId)) {
        const m = nodeMap.get(n.motherId);
        const startX = m.x + NODE_W * 0.62;
        const startY = m.y + NODE_H;
        const endX = n.x + NODE_W * 0.68;
        const endY = n.y;
        const midY = startY + Math.max(20, (endY - startY) * 0.5);

        edges.push({
          childId: n.id,
          parentId: m.id,
          parentType: 'mother',
          markerId: (n.isAncestor || n.isFocus) ? 'arrow-ancestor' : 'arrow-mother',
          isAncestorLine: n.isAncestor || n.isFocus,
          isDescendantLine: n.isDescendant || n.isFocus,
          d: `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`
        });
      }
    }

    return {
      focusId,
      width: totalW,
      height: totalH,
      sortedGens: sortedDepths.map(d => d + 1),
      nodes,
      edges,
      spouseEdges,
      nodeMap
    };
  }

  // 2. 生成完全独立的单文件 HTML 字符串 (支持打开新标签页独立运行)
  function generateStandaloneDagHtml(focusId, sim) {
    const dag = buildLineageDAG(focusId, sim);
    const dagJson = JSON.stringify(dag);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flow & Accord · 直系血脉 DAG 完整族谱</title>
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
    .dag-workspace {
      flex: 1;
      position: relative;
      background: radial-gradient(circle at 50% 50%, #0f172a 0%, #070b12 100%);
      overflow: hidden;
      cursor: grab;
      touch-action: none;
    }
    .dag-workspace:active {
      cursor: grabbing;
    }
    .dag-viewport {
      position: absolute;
      top: 0; left: 0;
      transform-origin: 0 0;
      will-change: transform;
      pointer-events: none;
    }
    .dag-svg-layer {
      position: absolute;
      top: 0; left: 0;
      pointer-events: none;
    }
    .dag-edge {
      fill: none;
      stroke: rgba(148, 163, 184, 0.4);
      stroke-width: 2;
      transition: stroke 0.2s, stroke-width 0.2s;
    }
    .dag-edge.father-edge {
      stroke: #38bdf8;
      stroke-width: 2.2;
    }
    .dag-edge.mother-edge {
      stroke: #f472b6;
      stroke-width: 2.2;
    }
    .dag-edge.ancestor {
      stroke: #fbbf24;
      stroke-width: 2.8;
      filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.6));
    }
    .dag-edge.descendant.father-edge {
      stroke: #38bdf8;
      stroke-width: 2.8;
      filter: drop-shadow(0 0 4px rgba(56, 189, 248, 0.6));
    }
    .dag-edge.descendant.mother-edge {
      stroke: #ec4899;
      stroke-width: 2.8;
      filter: drop-shadow(0 0 4px rgba(236, 72, 153, 0.6));
    }
    .dag-spouse-edge {
      stroke: #f43f5e;
      stroke-dasharray: 4 4;
      stroke-width: 1.8;
      opacity: 0.85;
    }
    .dag-node {
      position: absolute;
      width: ${NODE_W}px;
      height: ${NODE_H}px;
      background: rgba(15, 23, 42, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 10px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-shadow: 0 6px 16px rgba(0,0,0,0.4);
      cursor: pointer;
      pointer-events: auto;
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .dag-node:hover {
      transform: translateY(-2px) scale(1.02);
      border-color: #38bdf8;
      box-shadow: 0 10px 24px rgba(56, 189, 248, 0.25);
      z-index: 10;
    }
    .dag-node.focus {
      border: 2px solid #38bdf8;
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.5), 0 8px 24px rgba(0,0,0,0.6);
      background: rgba(14, 30, 56, 0.98);
      z-index: 20;
    }
    .dag-node.ancestor {
      border-color: rgba(251, 191, 36, 0.8);
      background: rgba(36, 28, 12, 0.94);
    }
    .dag-node.descendant {
      border-color: rgba(56, 189, 248, 0.7);
      background: rgba(12, 32, 48, 0.94);
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
      pointer-events: auto;
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
      <div class="dag-title">🌳 Flow & Accord · 直系血脉 DAG 完整族谱</div>
      <div class="dag-stats-badge" id="topbar-stats">直系世代数: 1 · 直系族人: 0 (纯净直系血亲)</div>
    </div>
    <div class="dag-actions">
      <button class="dag-btn" id="btn-focus-center">🎯 居中定位</button>
      <button class="dag-btn" id="btn-reset-view">🔍 重置缩放</button>
    </div>
  </div>

  <div class="dag-workspace" id="workspace">
    <div class="dag-viewport" id="viewport">
      <svg class="dag-svg-layer" id="svgLayer">
        <defs>
          <marker id="arrow-father" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#38bdf8" />
          </marker>
          <marker id="arrow-mother" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#f472b6" />
          </marker>
          <marker id="arrow-ancestor" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#fbbf24" />
          </marker>
        </defs>
      </svg>
      <div id="nodesLayer" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;"></div>
    </div>
    <div class="dag-help-bar">🖱️ 拖拽画布平移 · 滚轮缩放 · 双亲独立有向边 (蓝👨父 / 粉👩母) · Y轴按出生时间排序</div>
    <div class="dag-sidebar" id="sidebar" style="display:none;">
      <div class="dag-sidebar-title">
        <span id="side-title">族人档案</span>
        <button class="dag-btn" style="padding:2px 6px; font-size:10px;" id="side-close">✕</button>
      </div>
      <div id="side-body" style="font-size:11px; line-height:1.6; color:#cbd5e1;"></div>
    </div>
  </div>

  <script>
    let DAG = ${dagJson};
    let scale = 1.0;
    let panX = 40;
    let panY = 40;
    let isDragging = false;
    let startX = 0, startY = 0;
    let startPanX = 0, startPanY = 0;
    let isMoved = false;
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
      topStats.textContent = '直系世代数: ' + (DAG.sortedGens.length || 1) + ' · 直系族人: ' + DAG.nodes.length + ' (纯净直系血亲)';
      renderGraph();
      centerOnNode(currentFocus);
      setupEvents();
    }

    function renderGraph() {
      svgLayer.setAttribute('width', DAG.width);
      svgLayer.setAttribute('height', DAG.height);
      
      // 保留 defs
      const defs = svgLayer.querySelector('defs');
      svgLayer.innerHTML = '';
      if (defs) svgLayer.appendChild(defs);

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

      // 双亲各自独立有向边 (DAG Edges)
      DAG.edges.forEach(e => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', e.d);
        let cls = 'dag-edge';
        if (e.parentType === 'father') cls += ' father-edge';
        else if (e.parentType === 'mother') cls += ' mother-edge';
        if (e.isAncestorLine) cls += ' ancestor';
        if (e.isDescendantLine) cls += ' descendant';
        path.setAttribute('class', cls);
        path.setAttribute('marker-end', 'url(#' + e.markerId + ')');
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

        const avatar = !n.isAlive ? '💀' : (n.gender === 'female' ? (n.isPregnant ? '🤰' : '👩') : '👦');
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
          if (isMoved) return;
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
        <div>👶 直系子嗣: \${n.children ? n.children.length : 0} 位</div>
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
      // 丝滑 Pointer 拖拽交互
      workspace.onpointerdown = e => {
        if (e.target.closest('button') || e.target.closest('#side-close')) return;
        isDragging = true;
        isMoved = false;
        startX = e.clientX;
        startY = e.clientY;
        startPanX = panX;
        startPanY = panY;
        try { workspace.setPointerCapture(e.pointerId); } catch (_) {}
      };

      workspace.onpointermove = e => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isMoved = true;
        panX = startPanX + dx;
        panY = startPanY + dy;
        updateTransform();
      };

      const endDrag = e => {
        if (!isDragging) return;
        isDragging = false;
        try {
          if (workspace.hasPointerCapture(e.pointerId)) {
            workspace.releasePointerCapture(e.pointerId);
          }
        } catch (_) {}
      };

      workspace.onpointerup = endDrag;
      workspace.onpointercancel = endDrag;

      workspace.onwheel = e => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
        const newScale = Math.max(0.2, Math.min(3.0, scale * zoomFactor));
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

  // 3. 在当前页面内全屏渲染 DAG 模态组件 (纯净直系血脉 DAG · 出生时间 Y 轴排布 · 双亲独立有向边)
  let currentInPageDag = null;
  let inPageScale = 1.0;
  let inPagePanX = 50;
  let inPagePanY = 50;
  let inPageDragging = false;
  let inPageStartX = 0, inPageStartY = 0;
  let inPageStartPanX = 0, inPageStartPanY = 0;
  let inPageMoved = false;
  let inPageFocusId = 1;

  function renderInPageDag(sim, containerEl) {
    if (!containerEl) return;
    const dag = buildLineageDAG(inPageFocusId, sim);
    currentInPageDag = dag;

    containerEl.innerHTML = `
      <div class="dag-viewport" id="inpage-dag-viewport">
        <svg class="dag-svg-layer" id="inpage-dag-svg" width="${dag.width}" height="${dag.height}">
          <defs>
            <marker id="inpage-arrow-father" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#38bdf8" />
            </marker>
            <marker id="inpage-arrow-mother" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#f472b6" />
            </marker>
            <marker id="inpage-arrow-ancestor" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#fbbf24" />
            </marker>
          </defs>
        </svg>
        <div id="inpage-dag-nodes" style="position:absolute; top:0; left:0; width:${dag.width}px; height:${dag.height}px; pointer-events:none;"></div>
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

    // 双亲各自独立有向 Bezier 连线 (DAG Edges with Markers)
    dag.edges.forEach(e => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', e.d);
      let cls = 'dag-edge';
      if (e.parentType === 'father') cls += ' father-edge';
      else if (e.parentType === 'mother') cls += ' mother-edge';
      if (e.isAncestorLine) cls += ' ancestor';
      if (e.isDescendantLine) cls += ' descendant';
      path.setAttribute('class', cls);
      
      const markerId = e.isAncestorLine ? 'inpage-arrow-ancestor' : (e.parentType === 'father' ? 'inpage-arrow-father' : 'inpage-arrow-mother');
      path.setAttribute('marker-end', 'url(#' + markerId + ')');
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
        if (inPageMoved) return;
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
        <div>👶 直系后代: ${n.children ? n.children.length : 0} 位</div>
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
    openInNewTab(focusId, sim) {
      const win = window.open('', '_blank');
      if (!win) {
        // 若被浏览器拦截弹窗，则降级为在主页面打开
        this.openModal(focusId, sim);
        return;
      }
      const html = generateStandaloneDagHtml(focusId, sim);
      win.document.open();
      win.document.write(html);
      win.document.close();
    },
    openModal(focusId, sim) {
      const modal = document.getElementById('full-dag-modal');
      const container = document.getElementById('dag-graph-container');
      if (!modal || !container) return;

      inPageFocusId = focusId || (sim && sim.selectedAgentId) || 1;
      inPageScale = 1.0;

      modal.style.display = 'flex';
      renderInPageDag(sim, container);
      centerInPageNode(inPageFocusId, container);

      // 绑定 Pointer 拖拽与缩放事件
      container.style.touchAction = 'none';

      container.onpointerdown = e => {
        if (e.target.closest('button') || e.target.closest('#dag-insp-close')) return;
        inPageDragging = true;
        inPageMoved = false;
        inPageStartX = e.clientX;
        inPageStartY = e.clientY;
        inPageStartPanX = inPagePanX;
        inPageStartPanY = inPagePanY;
        try { container.setPointerCapture(e.pointerId); } catch (_) {}
      };

      container.onpointermove = e => {
        if (!inPageDragging) return;
        const dx = e.clientX - inPageStartX;
        const dy = e.clientY - inPageStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) inPageMoved = true;
        inPagePanX = inPageStartPanX + dx;
        inPagePanY = inPageStartPanY + dy;
        updateInPageTransform();
      };

      const endInPageDrag = e => {
        if (!inPageDragging) return;
        inPageDragging = false;
        try {
          if (container.hasPointerCapture(e.pointerId)) {
            container.releasePointerCapture(e.pointerId);
          }
        } catch (_) {}
      };

      container.onpointerup = endInPageDrag;
      container.onpointercancel = endInPageDrag;

      container.onwheel = e => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        const newScale = Math.max(0.2, Math.min(3.0, inPageScale * factor));
        const rect = container.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        inPagePanX = mx - (mx - inPagePanX) * (newScale / inPageScale);
        inPagePanY = my - (my - inPagePanY) * (newScale / inPageScale);
        inPageScale = newScale;
        updateInPageTransform();
      };

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
          window.FlowDag.openInNewTab(inPageFocusId, sim);
        };
      }

      const btnClose = document.getElementById('dag-btn-close');
      if (btnClose) {
        btnClose.onclick = () => { modal.style.display = 'none'; };
      }
    }
  };
})(window);
