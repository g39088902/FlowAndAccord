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

  // =========================================================================
  // 1. 直系血脉图谱数据构建 (仅收录焦点的父/母递归祖先链 + 子女递归后代链)
  //    不再做全量旁系录入：只有从焦点沿 fatherId/motherId 向上递归可达的祖先，
  //    以及沿 children 向下递归可达的后代，才会进入图谱。
  // =========================================================================
  function buildLineageDAG(focusId, sim) {
    // 临时全量映射仅用于解析父子链路 (不用于最终入图)
    const lookup = new Map();
    if (sim && sim.agentArchive) {
      for (const [id, ag] of sim.agentArchive) {
        lookup.set(id, ag);
      }
    }
    if (sim && sim.agents) {
      for (const ag of sim.agents) {
        lookup.set(ag.id, ag);
      }
    }

    // 焦点校正：默认取编号最小且存活的族人
    if (!focusId || !lookup.has(focusId)) {
      const ids = Array.from(lookup.keys()).sort((a, b) => a - b);
      focusId = ids.find(id => lookup.get(id) && lookup.get(id).isAlive) || ids[0] || 1;
    }

    // 依据焦点 BFS 递归收集直系血脉 ID 集合
    //   ancestors: 焦点的父/母递归向上链 (不含焦点本身)
    //   descendants: 焦点的子女递归向下链 (不含焦点本身)
    //   lineageIds: 三者并集 = 最终入图节点 (焦点 + 祖先链 + 后代链)
    const ancestors = new Set();
    const descendants = new Set();
    const lineageIds = new Set();
    if (focusId && lookup.has(focusId)) {
      lineageIds.add(focusId);
      // 向上递归祖先
      const aq = [focusId];
      while (aq.length > 0) {
        const cur = lookup.get(aq.shift());
        if (!cur) continue;
        for (const pId of [cur.fatherId, cur.motherId]) {
          if (pId && lookup.has(pId) && !ancestors.has(pId)) {
            ancestors.add(pId);
            lineageIds.add(pId);
            aq.push(pId);
          }
        }
      }
      // 向下递归后代
      const dq = [focusId];
      while (dq.length > 0) {
        const cur = lookup.get(dq.shift());
        if (!cur || !Array.isArray(cur.children)) continue;
        for (const cId of cur.children) {
          if (lookup.has(cId) && !descendants.has(cId)) {
            descendants.add(cId);
            lineageIds.add(cId);
            dq.push(cId);
          }
        }
      }
    }

    // 只把直系血脉人物录入 allMap (旁系亲属不进图)
    const allMap = new Map();
    for (const id of lineageIds) {
      const ag = lookup.get(id);
      if (ag) allMap.set(id, ag);
    }

    // 直系血脉节点格式化
    // 注: agent.birthTick 由 Rust 内核在出生时记录 (始祖=0, 后代=分娩时的 tick_counter),
    // 严格反映出生时序. 用于播种时分配纵向带 (越晚出生越靠下),
    // 形成"上=祖先 / 下=后代"的天然代际纵向分层.
    const ticks = Array.from(allMap.values())
      .map(ag => ag && ag.birthTick !== undefined ? ag.birthTick : 0)
      .filter(t => typeof t === 'number' && !isNaN(t));
    const tickMin = ticks.length > 0 ? Math.min(...ticks) : 0;
    const tickMax = ticks.length > 0 ? Math.max(...ticks) : 0;
    const tickRange = Math.max(1, tickMax - tickMin);

    const nodes = [];
    const nodeMap = new Map();
    for (const ag of allMap.values()) {
      if (!ag || ag.id === undefined || ag.id === null) continue;
      const gen = ag.generation && ag.generation >= 1 ? ag.generation : ((ag.fatherId || ag.motherId) ? 2 : 1);

      const nodeObj = {
        id: ag.id,
        gender: ag.gender || (ag.id % 2 === 1 ? 'male' : 'female'),
        generation: gen,
        isAlive: !!ag.isAlive,
        isPregnant: !!ag.isPregnant,
        age: Math.floor(ag.age || 0),
        birthTick: ag.birthTick !== undefined ? ag.birthTick : 0,
        hunger: Math.round(ag.hunger || 0),
        stamina: Math.round(ag.stamina || 0),
        health: ag.health !== undefined ? Number(ag.health).toFixed(1) : '100',
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
        // 出生时序归一化: 0=最早 (tick 最小, 始祖), 1=最晚 (tick 最大, 最新生新生儿)
        birthRank: Math.max(0, Math.min(1, ((ag.birthTick !== undefined ? ag.birthTick : 0) - tickMin) / tickRange)),
        x: 0, y: 0, vx: 0, vy: 0
      };
      nodes.push(nodeObj);
      nodeMap.set(ag.id, nodeObj);
    }

    // 亲子有向边 —— 仅父子/母子两条，不生成夫妻边
    const edges = [];
    for (const n of nodes) {
      if (n.fatherId && nodeMap.has(n.fatherId)) {
        edges.push({ parent: nodeMap.get(n.fatherId), child: n, parentType: 'father' });
      }
      if (n.motherId && nodeMap.has(n.motherId)) {
        edges.push({ parent: nodeMap.get(n.motherId), child: n, parentType: 'mother' });
      }
    }

    // 预置宽松画布尺寸 (与播种时使用的 xRange/layerSpan 一致, 让初始播种点都在画布内)
    const initialSpan = Math.sqrt(nodes.length) * 600;
    const width = Math.max(1600, initialSpan);
    const height = Math.max(1100, initialSpan);

    // 力导向播种 + 同步预热收敛 (首帧即接近稳定，动画阶段仅做精致抛光)
    initForceLayout(nodes, width, height);
    const warmSteps = nodes.length > 700 ? 60 : 160;
    for (let k = 0; k < warmSteps; k++) {
      stepForceSimulation(nodes, edges, width, height);
    }

    // 平移至正坐标区域并计算画布尺寸
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    const pad = 180;
    const ox = pad - minX;
    const oy = pad - minY;
    if (ox !== 0 || oy !== 0) {
      for (const n of nodes) {
        n.x += ox;
        n.y += oy;
      }
    }
    const totalW = Math.max(1400, maxX - minX + pad * 2);
    const totalH = Math.max(1000, maxY - minY + pad * 2);

    return { focusId, width: totalW, height: totalH, nodes, edges, nodeMap };
  }

  // =========================================================================
  // 🔧 力导向布局引擎 (纯力学自动布局 · 软截止全对斥力 · 软边界兜底 · 无惯性松弛收敛)
  //   随距离单调递减且带软截止的全对斥力(cutoff 外无作用)主导节点自然稀疏;
  //   亲子弹簧仅做轻量血缘聚类; 软边界把整图约束在 √n·400 的圆域内防无限散开;
  //   无惯性松弛位移积分(位移 = 合力 × 温度冷却曲线)保证快速收敛停稳。
  //   无任何排名/代数分层约束。
  //   注意：以下四个函数均为自包含实现，不引用模块级变量 (edgePath 仅依赖
  //   NODE_W/NODE_H，standalone 页内已先行声明)；generateStandaloneDagHtml
  //   通过 Function.prototype.toString() 将源码内嵌新标签页，二者严格同源。
  // =========================================================================
  function initForceLayout(nodes, width, height) {
    // 出生时序播种 (分层唯一来源): Y 轴按 birthRank 直接分配纵向带状位置
    // (rank=0 始祖在最上, rank=1 最新生在最下); X 轴在画布水平范围内确定性伪随机散布.
    // 后续力学迭代 (斥力/弹簧/X 软边界) 仅在各自纵向带内做局部调整, 不做任何 Y 向回拉,
    // 代际分层秩序由播种一次性确定并保持.
    const rand = (seed) => {
      let h = (seed ^ 0x9E3779B9) >>> 0;
      h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
      h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
      h = h ^ (h >>> 15);
      return (h >>> 0) / 4294967296;
    };
    const cx = width / 2;
    const cy = height / 2;
    // 纵向跨度匹配软边界直径, 让分层有足够空间
    const layerSpan = Math.sqrt(nodes.length) * 600;
    // 水平散布范围与纵向跨度相当, 让整图保持方形
    const xRange = Math.sqrt(nodes.length) * 600;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const rank = n.birthRank !== undefined ? n.birthRank : 0.5;
      // X: 确定性伪随机散布在 [cx - xRange/2, cx + xRange/2] 范围内
      const u = rand(n.id * 131 + 7);
      n.x = cx + (u - 0.5) * xRange;
      // Y: 直接按 birthRank 线性映射到 [cy - layerSpan/2, cy + layerSpan/2]
      // (rank=0 始祖在最上, rank=1 新生儿在最下)
      n.y = cy + (rank - 0.5) * layerSpan;
      n.vx = 0;
      n.vy = 0;
    }
    nodes._step = 0; // 温度冷却步数清零 (重新播种/重新布局时重置降温曲线)
  }

  function stepForceSimulation(nodes, edges, width, height) {
    const n = nodes.length;
    const P = {
      repulsion: 2000,  // 斥力系数 (F = (k/d)·(1−d/cutoff): 随距离单调递减, cutoff 外为 0)
      cutoff: 700,      // 斥力软截止半径: 覆盖数个近邻, 远距对无相互作用 → 边缘净推力有限, 稳定收敛
      spring: 0.003,    // 亲子弹簧刚度 (F = k·(d − rest), 弱于斥力, 仅凝聚血缘聚类)
      rest: 300,        // 弹簧自然中心距 (与目标近邻间距接近, 避免边把节点压出重叠)
      boundary: 0.35,   // 软边界回拉刚度 (X 超界后线性拉回, 防过度稀疏/漂移)
      maxDisp: 4,       // 单步位移钳制上限 (位移上限随温度冷却同步收缩)
      minDist: 190,     // 节点卡片最小间距 (卡片 184×80, 任意方向排列均不叠压)
      collide: 1.0,     // 近距线性推挤刚度 (minDist 内按重叠量果断分开, 无惯性松弛下不振荡)
    };
    // 温度冷却: 指数降温曲线 (数组级步数计数, 播种时置 0; 布局引擎每步递增),
    // 布局主体在前 ~100 步完成 (temp > 0.2), 之后温度渐缓 → 位移上限同步收缩, 保证最终冻结收敛
    if (nodes._step === undefined) nodes._step = 0;
    nodes._step++;
    const temp = Math.exp(-nodes._step / 70); // 温度: 0 步→1.0, 70 步→0.37, 140 步→0.14, 300 步→0.014
    let maxMove = 0;
    // 每步实时计算图质心 (软边界回拉与整图漂移锚定)
    let cgx = 0, cgy = 0;
    for (const nd of nodes) { cgx += nd.x; cgy += nd.y; }
    cgx /= n; cgy /= n;

    // 1. 全节点两两斥力 —— 随距离单调递减且带软截止:
    //    近距离推力强 → 节点相互散开(自然稀疏)；超过 cutoff 的远距对无相互作用,
    //    边缘节点受到的净推力有限, 由软边界兜住整图 —— 既不会挤成一团, 也不会松散到无边无际。
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = ((a.id + i) % 7) - 3;
          dy = ((b.id + j) % 7) - 3;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        if (d >= P.cutoff) continue; // 软截止: 远距对无斥力
        let f;
        if (d < P.minDist) {
          // 近距线性推挤: 重叠越深推力越大, 确保卡片间距, 严防叠压
          f = (P.minDist - d) * P.collide;
        } else {
          // 随距离单调递减 (在 cutoff 处平滑归零)
          f = P.repulsion / d * (1 - d / P.cutoff);
        }
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // 2. 亲子弹簧牵引: 有边节点相互靠近, 血缘关系自然凝聚为聚类
    for (let k = 0; k < edges.length; k++) {
      const a = edges[k].parent;
      const b = edges[k].child;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = P.spring * (d - P.rest);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // 3. 软边界回拉: 仅 X 方向约束在水平边界内 (避免整图横向无限散开);
    //    Y 方向不做任何回拉 —— 纵向代际分层由播种 (initForceLayout 按 birthRank
    //    分配初始 Y) 一次性确定, 力学迭代仅在各自纵向带内做局部调整, 不再受中心力干扰.
    const R_MAX_X = Math.sqrt(n) * 400;
    for (const nd of nodes) {
      const dx = nd.x - cgx;
      const adx = Math.abs(dx);
      if (adx > R_MAX_X) {
        const over = adx - R_MAX_X;
        const f = Math.min(over * P.boundary, 80);
        nd.vx += (dx > 0 ? f : -f);
      }
    }

    // 4. 无惯性松弛位移积分: 位移 = 合力 × 温度 (位移上限随温度同步收缩),
    //    合力在平衡位形自然趋零 → 完全静止; 温度冷却兜底, 任何残余力也会被冷却冻结
    for (const n of nodes) {
      const cap = P.maxDisp * temp;
      const mx = Math.max(-cap, Math.min(cap, n.vx * temp));
      const my = Math.max(-cap, Math.min(cap, n.vy * temp));
      n.x += mx;
      n.y += my;
      n.vx = 0; // 合力累加器清零 (无惯性: 每步从零重新累加, 杜绝速度放大)
      n.vy = 0;
      const m = Math.abs(mx) > Math.abs(my) ? Math.abs(mx) : Math.abs(my);
      if (m > maxMove) maxMove = m;
    }

    return maxMove;
  }

  // 亲子边 Bezier 路径 (父下缘 → 子上缘，垂直中点控制，正反方向均平滑)
  function edgePath(e, offsetX, offsetY) {
    const a = e.parent;
    const b = e.child;
    const startX = a.x + offsetX + NODE_W * (e.parentType === 'father' ? 0.34 : 0.66);
    const startY = a.y + offsetY + NODE_H;
    const endX = b.x + offsetX + NODE_W * (e.parentType === 'father' ? 0.32 : 0.68);
    const endY = b.y + offsetY;
    const midY = (startY + endY) * 0.5;
    return 'M ' + startX + ' ' + startY + ' C ' + startX + ' ' + midY + ', ' + endX + ' ' + midY + ', ' + endX + ' ' + endY;
  }

  // 力导向动画驱动: 每帧若干物理子步 + 刷新渲染，收敛 (maxMove < 0.3) 即停稳
  function animateForceLayout(dag, refreshFn, onSettle) {
    const maxSteps = dag.nodes.length > 700 ? 160 : 300;
    let step = 0;
    let raf = 0;
    function frame() {
      let moved = Infinity;
      for (let k = 0; k < 4 && step < maxSteps; k++) {
        moved = stepForceSimulation(dag.nodes, dag.edges, dag.width, dag.height);
        step++;
      }
      if (refreshFn) refreshFn();
      if (moved >= 0.3 && step < maxSteps) {
        raf = requestAnimationFrame(frame);
      } else if (onSettle) {
        onSettle();
      }
    }
    frame();
    return {
      stop() { cancelAnimationFrame(raf); }
    };
  }

  // 物理引擎源码单源 (standalone 新标签页内嵌此源码，复用同一套布局算法)
  const FORCE_SIM_SRC = [initForceLayout, stepForceSimulation, edgePath, animateForceLayout]
    .map(fn => fn.toString())
    .join('\n\n');

  // 2. 生成完全独立的单文件 HTML 字符串 (支持打开新标签页独立运行 · 力导向自动布局)
  function generateStandaloneDagHtml(focusId, sim) {
    const dag = buildLineageDAG(focusId, sim);
    // 紧凑序列化：边仅携带 id，反序列化后重建对象引用，避免 JSON 体积随边数膨胀
    const ser = {
      focusId: dag.focusId,
      width: dag.width,
      height: dag.height,
      nodes: dag.nodes,
      edges: dag.edges.map(e => ({ parentId: e.parent.id, childId: e.child.id, parentType: e.parentType }))
    };
    const dagJson = JSON.stringify(ser);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flow & Accord · 直系血脉拓扑族谱</title>
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
      border: 2px solid #ef4444;
      box-shadow: 0 0 22px rgba(239, 68, 68, 0.55), 0 8px 24px rgba(0,0,0,0.6);
      background: rgba(48, 14, 18, 0.98);
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
      <div class="dag-title">🌳 Flow & Accord · 直系血脉拓扑族谱</div>
      <div class="dag-stats-badge" id="topbar-stats">直系族人: 0 · 亲子边: 0 (力导向自动布局)</div>
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
    <div class="dag-help-bar">🖱️ 拖拽画布平移 · 滚轮缩放 · 纯力学自动布局: 亲子弹簧牵引 + 距离斥力自然舒展 · 蓝👨父 / 粉👩母</div>
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
    // 节点尺寸与布局常量：standalone 独立作用域必须自带定义
    // (与 dag.js 模块级常量保持一致，否则 centerOnNode 等会抛 ReferenceError，导致 setupEvents 永不执行、画布无法拖动)
    const NODE_W = 184;
    const NODE_H = 80;
    const LEVEL_H = 160;
    const SIBLING_GAP = 32;
    const SPOUSE_GAP = 20;
    const PAD = 180;

    // 力导向物理引擎 (与 dag.js 严格同源：经 Function.prototype.toString() 内嵌)
    ${FORCE_SIM_SRC}

    // 重建亲子边对象引用 (JSON 仅序列化紧凑 id，反序列化后回填 parent/child 对象)
    (function () {
      const nmap = new Map(DAG.nodes.map(n => [n.id, n]));
      DAG.edges = DAG.edges.map(e => ({
        parent: nmap.get(e.parentId),
        child: nmap.get(e.childId),
        parentType: e.parentType
      }));
    })();

    let scale = 1.0;
    let panX = 40;
    let panY = 40;
    let isDragging = false;
    let startX = 0, startY = 0;
    let startPanX = 0, startPanY = 0;
    let isMoved = false;
    let userPanned = false;
    let currentFocus = DAG.focusId;
    let layoutOx = 0, layoutOy = 0;
    let edgeEls = [];
    let nodeEls = [];

    const workspace = document.getElementById('workspace');
    const viewport = document.getElementById('viewport');
    const svgLayer = document.getElementById('svgLayer');
    const nodesLayer = document.getElementById('nodesLayer');
    const sidebar = document.getElementById('sidebar');
    const sideTitle = document.getElementById('side-title');
    const sideBody = document.getElementById('side-body');
    const topStats = document.getElementById('topbar-stats');

    function init() {
      topStats.textContent = '直系族人: ' + DAG.nodes.length + ' · 亲子边: ' + DAG.edges.length + ' (力导向自动布局)';
      buildDom();
      refreshLayout();
      centerAll();
      animateForceLayout(DAG, refreshLayout, () => {
        if (!userPanned) centerAll();
      });
      setupEvents();
    }

    function buildDom() {
      svgLayer.setAttribute('width', DAG.width);
      svgLayer.setAttribute('height', DAG.height);

      // 保留 defs
      const defs = svgLayer.querySelector('defs');
      svgLayer.innerHTML = '';
      if (defs) svgLayer.appendChild(defs);
      nodesLayer.innerHTML = '';
      edgeEls = [];
      nodeEls = [];

      // 亲子独立有向边 (仅父子/母子，不绘制夫妻线)
      DAG.edges.forEach(e => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        let cls = 'dag-edge';
        if (e.parentType === 'father') cls += ' father-edge';
        else if (e.parentType === 'mother') cls += ' mother-edge';
        if (e.child.isDescendant || e.child.isFocus) cls += ' descendant';
        path.setAttribute('class', cls);
        const markerId = (e.parentType === 'father' ? 'arrow-father' : 'arrow-mother');
        path.setAttribute('marker-end', 'url(#' + markerId + ')');
        svgLayer.appendChild(path);
        edgeEls.push({ el: path, e });
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
        card.style.width = NODE_W + 'px';
        card.style.height = NODE_H + 'px';
        card.style.position = 'absolute';

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
          // 轻量聚焦：仅切换高亮与浮动档案，不整图重建 (不打断力导向收敛)
          currentFocus = n.id;
          nodeEls.forEach(item => item.el.classList.remove('focus'));
          card.classList.add('focus');
          inspectNode(n);
        };

        nodesLayer.appendChild(card);
        nodeEls.push({ el: card, n });
      });
    }

    // 力导向每帧布局刷新：自适应画布尺寸 + 更新边路径与节点坐标
    function refreshLayout() {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of DAG.nodes) {
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x > maxX) maxX = n.x;
        if (n.y > maxY) maxY = n.y;
      }
      DAG.width = Math.max(1400, maxX - minX + PAD * 2);
      DAG.height = Math.max(1000, maxY - minY + PAD * 2);
      svgLayer.setAttribute('width', DAG.width);
      svgLayer.setAttribute('height', DAG.height);
      const ox = PAD - minX;
      const oy = PAD - minY;
      layoutOx = ox;
      layoutOy = oy;
      for (let i = 0; i < edgeEls.length; i++) {
        edgeEls[i].el.setAttribute('d', edgePath(edgeEls[i].e, ox, oy));
      }
      for (let i = 0; i < nodeEls.length; i++) {
        nodeEls[i].el.style.left = (nodeEls[i].n.x + ox) + 'px';
        nodeEls[i].el.style.top = (nodeEls[i].n.y + oy) + 'px';
      }
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
    }

    // 整图自适应居中
    function centerAll() {
      if (!DAG.nodes.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of DAG.nodes) {
        const rx = n.x + layoutOx;
        const ry = n.y + layoutOy;
        if (rx < minX) minX = rx;
        if (ry < minY) minY = ry;
        if (rx > maxX) maxX = rx;
        if (ry > maxY) maxY = ry;
      }
      const wRect = workspace.getBoundingClientRect();
      panX = wRect.width / 2 - ((minX + maxX) / 2) * scale;
      panY = wRect.height / 2 - ((minY + maxY) / 2) * scale;
      updateTransform();
    }

    function centerOnNode(id) {
      const n = DAG.nodes.find(node => node.id === id);
      if (!n) return;
      const wRect = workspace.getBoundingClientRect();
      panX = wRect.width / 2 - (n.x + layoutOx + NODE_W / 2) * scale;
      panY = wRect.height / 2 - (n.y + layoutOy + NODE_H / 2) * scale;
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
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          isMoved = true;
          userPanned = true;
        }
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
        userPanned = true;
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
        centerAll();
      };
      document.getElementById('side-close').onclick = () => { sidebar.style.display = 'none'; };
    }

    init();
  </script>
</body>
</html>`;
  }

  // 3. 在当前页面内全屏渲染 DAG 模态组件 (直系血脉单图 · 力导向自动布局 · 仅父子/母子边)
  let currentInPageDag = null;
  let inPageScale = 1.0;
  let inPagePanX = 50;
  let inPagePanY = 50;
  let inPageDragging = false;
  let inPageStartX = 0, inPageStartY = 0;
  let inPageStartPanX = 0, inPageStartPanY = 0;
  let inPageMoved = false;
  let inPageUserPanned = false;
  let inPageFocusId = 1;
  let inPageAnim = null;
  let inPageEdgeEls = [];
  let inPageNodeEls = [];
  let inPageOx = 0, inPageOy = 0;
  const INPAGE_PAD = 180;

  function renderInPageDag(sim, containerEl) {
    if (!containerEl) return;
    if (inPageAnim) inPageAnim.stop();
    const dag = buildLineageDAG(inPageFocusId, sim);
    currentInPageDag = dag;
    inPageEdgeEls = [];
    inPageNodeEls = [];
    inPageOx = 0;
    inPageOy = 0;

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

    // 亲子独立有向 Bezier 连线 (仅父子/母子，不绘制夫妻线)
    dag.edges.forEach(e => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let cls = 'dag-edge';
      if (e.parentType === 'father') cls += ' father-edge';
      else if (e.parentType === 'mother') cls += ' mother-edge';
      if (e.child.isDescendant || e.child.isFocus) cls += ' descendant';
      path.setAttribute('class', cls);
      
      const markerId = (e.parentType === 'father' ? 'inpage-arrow-father' : 'inpage-arrow-mother');
      path.setAttribute('marker-end', 'url(#' + markerId + ')');
      svgLayer.appendChild(path);
      inPageEdgeEls.push({ el: path, e });
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
      card.style.width = NODE_W + 'px';
      card.style.height = NODE_H + 'px';
      card.style.position = 'absolute';

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
        // 轻量聚焦：仅切换高亮与浮动档案，不整图重建 (不打断力导向收敛)
        inPageFocusId = n.id;
        inPageNodeEls.forEach(item => item.el.classList.remove('focus'));
        card.classList.add('focus');
        showInPageInspector(n, sim);
      };

      nodesLayer.appendChild(card);
      inPageNodeEls.push({ el: card, n });
    });

    // 力导向每帧布局刷新：自适应画布尺寸 + 更新边路径与节点坐标
    function refreshLayout() {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of dag.nodes) {
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x > maxX) maxX = n.x;
        if (n.y > maxY) maxY = n.y;
      }
      dag.width = Math.max(1400, maxX - minX + INPAGE_PAD * 2);
      dag.height = Math.max(1000, maxY - minY + INPAGE_PAD * 2);
      svgLayer.setAttribute('width', dag.width);
      svgLayer.setAttribute('height', dag.height);
      nodesLayer.style.width = dag.width + 'px';
      nodesLayer.style.height = dag.height + 'px';
      const ox = INPAGE_PAD - minX;
      const oy = INPAGE_PAD - minY;
      inPageOx = ox;
      inPageOy = oy;
      for (let i = 0; i < inPageEdgeEls.length; i++) {
        inPageEdgeEls[i].el.setAttribute('d', edgePath(inPageEdgeEls[i].e, ox, oy));
      }
      for (let i = 0; i < inPageNodeEls.length; i++) {
        inPageNodeEls[i].el.style.left = (inPageNodeEls[i].n.x + ox) + 'px';
        inPageNodeEls[i].el.style.top = (inPageNodeEls[i].n.y + oy) + 'px';
      }
    }

    refreshLayout();

    // 启动力导向动画 (预热已完成，此处仅做收敛抛光，收敛后自动停稳)
    inPageAnim = animateForceLayout(dag, refreshLayout, () => {
      if (!inPageUserPanned) centerInPageAll(containerEl);
    });

    updateInPageTransform();
  }

  // 整图自适应居中 (含力导向布局偏移量)
  function centerInPageAll(containerEl) {
    const dag = currentInPageDag;
    if (!dag || !dag.nodes.length || !containerEl) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of dag.nodes) {
      const rx = n.x + inPageOx;
      const ry = n.y + inPageOy;
      if (rx < minX) minX = rx;
      if (ry < minY) minY = ry;
      if (rx > maxX) maxX = rx;
      if (ry > maxY) maxY = ry;
    }
    const rect = containerEl.getBoundingClientRect();
    inPageScale = Math.min(1.0, Math.max(0.3, Math.min(
      rect.width / (maxX - minX + INPAGE_PAD),
      rect.height / (maxY - minY + INPAGE_PAD)
    )));
    inPagePanX = rect.width / 2 - ((minX + maxX) / 2) * inPageScale;
    inPagePanY = rect.height / 2 - ((minY + maxY) / 2) * inPageScale;
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
    inPagePanX = rect.width / 2 - (n.x + inPageOx + NODE_W / 2) * inPageScale;
    inPagePanY = rect.height / 2 - (n.y + inPageOy + NODE_H / 2) * inPageScale;
    updateInPageTransform();
  }

  // 4. 导出全局 API
  window.FlowDag = {
    buildLineageDAG,
    generateStandaloneDagHtml,
    _stepForce: stepForceSimulation, // 调试用: 单步力模拟
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
      inPageUserPanned = false;

      modal.style.display = 'flex';
      renderInPageDag(sim, container);
      centerInPageAll(container);

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
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) { inPageMoved = true; inPageUserPanned = true; }
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
        inPageUserPanned = true;
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
      if (btnCenter) btnCenter.onclick = () => {
        inPageUserPanned = true;
        centerInPageAll(container);
      };

      const btnReset = document.getElementById('dag-btn-reset-zoom');
      if (btnReset) {
        btnReset.onclick = () => {
          inPageUserPanned = true;
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
        btnClose.onclick = () => {
          if (inPageAnim) inPageAnim.stop();
          modal.style.display = 'none';
        };
      }
    }
  };
})(window);
