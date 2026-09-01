// =========================================================================
// 🧭 族谱「出生时间轴」布局引擎 (Flow & Accord)
//   · 纯函数、零 DOM 依赖 —— 浏览器 (window.FlowDagLayout) 与 Node (require) 双端复用
//   · Y = (birthTick − tickMin) × PX_PER_TICK，严格线性映射出生时刻 (先出生者必在上)
//   · X = 核心家庭分组 + 主干优先落位 + 冲突横向探测 (卡片不冲突即紧凑，冲突则横向扩展)
//   · 完全确定性：无随机数、不依赖遍历顺序，同数据必得同结果
//   · 独立新标签页 (standalone) 通过 FlowDagLayout.SRC 内嵌同源源码
// =========================================================================
// 浏览器以经典 <script> 加载 (挂载 window.FlowDagLayout)；
// Node 侧因 frontend/package.json 声明 "type":"module"，文件会被判为 ESM，
// 故统一走 globalThis 挂载，Node 脚本 require/eval 后取 globalThis.FlowDagLayout 即可。
(function (root, factory) {
  const api = factory();
  if (root) root.FlowDagLayout = api;
  try { if (typeof module === 'object' && module.exports) module.exports = api; } catch (_) {}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- 常量
  const LAYOUT_CONST = {
    NODE_W: 184,          // 卡片宽
    NODE_H: 80,           // 卡片高
    GAP_X: 28,            // 横向间隙
    GAP_Y: 34,            // 纵向间隙
    PAD: 180,             // 画布留白
    // 时间密度: 每 tick 映射的像素。
    // 拟合依据 (50 万 tick / 333 人真实数据, 见 tools/gen-dag-testdata.js 统计报告):
    //   · 亲子出生间隔 min 30,885 tick → 124px ≥ VNEAR(114)，任意亲子纵向不打架，连线基本垂直；
    //   · 同胞出生间隔 p50 27,007 tick → 108px < VNEAR，同父母子女自然横向并排成"同代行"；
    //   · 整图 50 万 tick → 约 2,000~2,400px 高，长宽比≈1.35，fit 缩放 0.32~0.34 为各焦点最优值。
    PX_PER_TICK: 0.004,
    LOD_BLOCK: 0.45,      // scale <  → 概览档 (紧凑色块 + 直线边)
    LOD_SIMPLE: 0.75,     // scale <  → 简档 (头像+编号+世代)，否则全档
    TICKS_PER_SEC: 30,    // 1 模拟秒
    TICKS_PER_SEASON: 1800, // 1 季 (60 模拟秒)
    TICKS_PER_YEAR: 7200    // 1 年 (240 模拟秒)
  };

  const VNEAR = LAYOUT_CONST.NODE_H + LAYOUT_CONST.GAP_Y; // 纵向判定贴邻: 114
  const HNEAR = LAYOUT_CONST.NODE_W + LAYOUT_CONST.GAP_X; // 横向判定贴邻 = 列步长: 212

  // ------------------------------------------------- 主干链标记 (焦点直系主脉)
  // 祖先侧沿父系优先上溯至根，后代侧沿首生子嗣下溯至叶，构成穿过焦点的一条连续主脉。
  function markSpine(nodes, nodeMap, focusId) {
    const spine = new Set();
    if (!focusId || !nodeMap.has(focusId)) return spine;
    let cur = nodeMap.get(focusId);
    spine.add(cur.id);
    // 上溯: 父优先、缺则母
    while (cur) {
      const p = (cur.fatherId && nodeMap.get(cur.fatherId)) || (cur.motherId && nodeMap.get(cur.motherId));
      if (!p || spine.has(p.id)) break;
      spine.add(p.id);
      cur = p;
    }
    // 下溯: 每代取最早出生的子嗣 (长子/长女继承主脉)
    cur = nodeMap.get(focusId);
    while (cur) {
      const kids = (cur.children || []).map(id => nodeMap.get(id)).filter(Boolean)
        .sort((a, b) => (a.birthTick - b.birthTick) || (a.id - b.id));
      const first = kids.find(k => !spine.has(k.id));
      if (!first) break;
      spine.add(first.id);
      cur = first;
    }
    return spine;
  }

  // ------------------------------------------------- 核心家庭分组 (同父母子女)
  function buildFamilies(nodes, nodeMap) {
    const families = new Map();
    for (const n of nodes) {
      const key = (n.fatherId || 0) + '|' + (n.motherId || 0);
      if (!families.has(key)) families.set(key, { key, fatherId: n.fatherId || null, motherId: n.motherId || null, children: [] });
      families.get(key).children.push(n);
    }
    for (const f of families.values()) {
      f.children.sort((a, b) => (a.birthTick - b.birthTick) || (a.id - b.id));
      f.children.forEach((c, i) => { c.familyKey = f.key; c.siblingIx = i; c.familySize = f.children.length; });
      const fx = f.fatherId && nodeMap.get(f.fatherId);
      const mx = f.motherId && nodeMap.get(f.motherId);
      f.father = fx || null;
      f.mother = mx || null;
    }
    return families;
  }

  // ------------------------------------------------- Y 严格线性时间轴
  function assignTimelineY(nodes, pxPerTick, tickMin, pad) {
    for (const n of nodes) {
      n.y = pad + (n.birthTick - tickMin) * pxPerTick;
    }
  }

  // ------------------------------------------------- X 冲突规避横向扩展
  //  已放置节点按 y 分桶 (桶高 = VNEAR)，探测时只比较相邻 3 桶，避免 O(n²) 全表扫描。
  function makeOccupancy(pxPerTick, tickMin, pad) {
    const buckets = new Map();
    const keyOf = (y) => Math.floor((y - pad) / VNEAR);
    // 预测某节点 (尚未落位) 的桶号
    const keyOfTick = (birthTick) => Math.floor(((birthTick - tickMin) * pxPerTick) / VNEAR);
    return {
      add(n) {
        const k = keyOf(n.y);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(n);
      },
      // 判断落在 (col * HNEAR, y) 的卡片是否与已放置卡片冲突
      collides(col, y, selfId) {
        const x = col * HNEAR;
        const k = keyOf(y);
        for (let b = k - 1; b <= k + 1; b++) {
          const arr = buckets.get(b);
          if (!arr) continue;
          for (let i = 0; i < arr.length; i++) {
            const m = arr[i];
            if (m.id === selfId) continue;
            if (Math.abs(m.y - y) < VNEAR && Math.abs(m.x - x) < HNEAR) return true;
          }
        }
        return false;
      },
      bucketSizes() {
        const out = [];
        for (const [k, v] of buckets) out.push([k, v.length]);
        out.sort((a, b) => a[0] - b[0]);
        return out;
      },
      keyOfTick
    };
  }

  // 在整数列网格上由 idealCol 向两侧探测最近的无冲突列
  function probeColumn(occ, idealCol, y, selfId, maxSpan) {
    if (!occ.collides(idealCol, y, selfId)) return idealCol;
    for (let d = 1; d <= maxSpan; d++) {
      if (!occ.collides(idealCol + d, y, selfId)) return idealCol + d;
      if (!occ.collides(idealCol - d, y, selfId)) return idealCol - d;
    }
    return idealCol + maxSpan + 1; // 理论上不会走到 (网格足够宽)
  }

  // 亲属 (父母 + 子女) 横向偏移代价，用于局部优化
  function relativeCost(n, col, nodeMap) {
    let cost = 0, cnt = 0;
    for (const pId of [n.fatherId, n.motherId]) {
      const p = pId && nodeMap.get(pId);
      if (p && p._placed) { cost += Math.abs(p.col - col); cnt++; }
    }
    for (const cId of (n.children || [])) {
      const c = nodeMap.get(cId);
      if (c && c._placed) { cost += Math.abs(c.col - col); cnt++; }
    }
    return cnt ? cost / cnt : 0;
  }

  function packHorizontal(nodes, nodeMap, spine, families, pxPerTick, tickMin, pad) {
    const occ = makeOccupancy(pxPerTick, tickMin, pad);
    const birthOrder = nodes.slice().sort((a, b) => (a.birthTick - b.birthTick) || (a.id - b.id));
    const maxSpan = Math.max(8, birthOrder.length);

    // —— 第一遍: 主干优先落位 (全部锚定第 0 列，形成贯穿全图的垂直主脉)
    for (const n of birthOrder) {
      if (!spine.has(n.id)) continue;
      n.col = probeColumn(occ, 0, n.y, n.id, maxSpan);
      n.x = n.col * HNEAR;
      n._placed = true;
      occ.add(n);
    }
    // —— 第二遍: 其余节点按出生顺序落位，理想列 = 双亲中点 + 同胞序号偏移
    for (const n of birthOrder) {
      if (n._placed) continue;
      const f = n.familyKey ? families.get(n.familyKey) : null;
      const father = n.fatherId && nodeMap.get(n.fatherId);
      const mother = n.motherId && nodeMap.get(n.motherId);
      let base = 0, hasParent = false;
      if (father && father._placed && mother && mother._placed) { base = (father.col + mother.col) / 2; hasParent = true; }
      else if (father && father._placed) { base = father.col; hasParent = true; }
      else if (mother && mother._placed) { base = mother.col; hasParent = true; }
      // 同父母子女整体以双亲中点为中心向两侧铺开，长幼自左向右
      let ideal = base;
      if (f && f.children.length > 1) {
        ideal = base + (n.siblingIx - (f.children.length - 1) / 2) * 1;
      }
      if (!hasParent) ideal = f && f.children.length > 1 ? (n.siblingIx - (f.children.length - 1) / 2) : 0;
      n.col = probeColumn(occ, Math.round(ideal), n.y, n.id, maxSpan);
      n.x = n.col * HNEAR;
      n._placed = true;
      occ.add(n);
    }

    // —— 第三遍: 局部松弛 (父向子女质心靠拢 → 子向双亲中点靠拢)，仅在不冲突且代价下降时接受
    for (let pass = 0; pass < 2; pass++) {
      for (let i = birthOrder.length - 1; i >= 0; i--) {
        const n = birthOrder[i];
        if (spine.has(n.id)) continue;
        const kids = (n.children || []).map(id => nodeMap.get(id)).filter(c => c && c._placed);
        if (!kids.length) continue;
        const target = kids.reduce((s, k) => s + k.col, 0) / kids.length;
        const cand = probeColumn(occ, Math.round(target), n.y, n.id, maxSpan);
        if (cand !== n.col && !occ.collides(cand, n.y, n.id) && relativeCost(n, cand, nodeMap) < relativeCost(n, n.col, nodeMap)) {
          n.col = cand; n.x = cand * HNEAR;
        }
      }
      for (const n of birthOrder) {
        if (spine.has(n.id)) continue;
        const father = n.fatherId && nodeMap.get(n.fatherId);
        const mother = n.motherId && nodeMap.get(n.motherId);
        if (!father && !mother) continue;
        const cols = [father, mother].filter(p => p && p._placed).map(p => p.col);
        if (!cols.length) continue;
        const target = cols.reduce((s, c) => s + c, 0) / cols.length;
        const cand = probeColumn(occ, Math.round(target), n.y, n.id, maxSpan);
        if (cand !== n.col && !occ.collides(cand, n.y, n.id) && relativeCost(n, cand, nodeMap) < relativeCost(n, n.col, nodeMap)) {
          n.col = cand; n.x = cand * HNEAR;
        }
      }
    }

    for (const n of nodes) { n._placed = undefined; }
    return occ;
  }

  // ------------------------------------------------- 主入口
  function layoutTimelineDag(nodes, edges, opts) {
    const C = LAYOUT_CONST;
    const o = opts || {};
    const pxPerTick = o.pxPerTick !== undefined ? o.pxPerTick : C.PX_PER_TICK;
    const pad = o.pad !== undefined ? o.pad : C.PAD;

    if (!nodes.length) {
      return { nodes, edges, width: 1400, height: 1000, pxPerTick, tickMin: 0, tickMax: 0, spine: [], families: new Map() };
    }
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    let tickMin = Infinity, tickMax = -Infinity;
    for (const n of nodes) {
      const t = n.birthTick || 0;
      if (t < tickMin) tickMin = t;
      if (t > tickMax) tickMax = t;
    }
    const focusId = o.focusId;
    const spine = markSpine(nodes, nodeMap, focusId);
    const families = buildFamilies(nodes, nodeMap);

    assignTimelineY(nodes, pxPerTick, tickMin, pad);
    packHorizontal(nodes, nodeMap, spine, families, pxPerTick, tickMin, pad);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      n.isSpine = spine.has(n.id);
      if (n.x < minX) minX = n.x;
      if (n.x + C.NODE_W > maxX) maxX = n.x + C.NODE_W;
      if (n.y < minY) minY = n.y;
      if (n.y + C.NODE_H > maxY) maxY = n.y + C.NODE_H;
    }
    for (const n of nodes) { n.x = n.x - minX + pad; n.y = n.y - minY + pad; }

    const width = Math.max(1400, (maxX - minX) + pad * 2);
    const height = Math.max(1000, (maxY - minY) + pad * 2);
    // y ↔ tick 互转 (供时间刻度尺使用)
    const toY = (tick) => pad + (tick - tickMin) * pxPerTick - minY + pad;
    return {
      nodes, edges, width, height, pxPerTick, tickMin, tickMax,
      spine: Array.from(spine), families,
      yToTick: (y) => tickMin + (y - pad + minY - pad) / pxPerTick,
      tickToY: toY
    };
  }

  // ------------------------------------------------- 亲子边路径
  function edgePathTimeline(e, offsetX, offsetY) {
    const C = LAYOUT_CONST;
    const a = e.parent;
    const b = e.child;
    const startX = a.x + offsetX + C.NODE_W * (e.parentType === 'father' ? 0.34 : 0.66);
    const startY = a.y + offsetY + C.NODE_H;
    const endX = b.x + offsetX + C.NODE_W * (e.parentType === 'father' ? 0.32 : 0.68);
    const endY = b.y + offsetY;
    const midY = (startY + endY) * 0.5;
    return 'M ' + startX + ' ' + startY + ' C ' + startX + ' ' + midY + ', ' + endX + ' ' + midY + ', ' + endX + ' ' + endY;
  }

  // 概览档: 退化为直线，避免长距离 Bezier 在缩略视图里糊成一团
  function edgePathFlat(e, offsetX, offsetY) {
    const C = LAYOUT_CONST;
    const a = e.parent;
    const b = e.child;
    const startX = a.x + offsetX + C.NODE_W * 0.5;
    const startY = a.y + offsetY + C.NODE_H;
    const endX = b.x + offsetX + C.NODE_W * 0.5;
    const endY = b.y + offsetY;
    return 'M ' + startX + ' ' + startY + ' L ' + endX + ' ' + endY;
  }

  // ------------------------------------------------- 缩放分层 LOD
  function lodLevel(scale) {
    if (scale < LAYOUT_CONST.LOD_BLOCK) return 'block';
    if (scale < LAYOUT_CONST.LOD_SIMPLE) return 'simple';
    return 'full';
  }

  // ------------------------------------------------- 时间刻度尺
  function tickToTimeLabel(tick) {
    const C = LAYOUT_CONST;
    const year = Math.floor(tick / C.TICKS_PER_YEAR) + 1;
    const seasonIx = Math.floor((tick % C.TICKS_PER_YEAR) / C.TICKS_PER_SEASON);
    const names = ['春', '夏', '秋', '冬'];
    return { year, season: names[seasonIx] || '春', seasonIx, text: '第' + year + '年·' + (names[seasonIx] || '春') };
  }

  // 依据缩放挑选刻度粒度，保证相邻刻度像素间距不小于 minPxGap
  function rulerMarks(tickMin, tickMax, pxPerTick, minPxGap) {
    const C = LAYOUT_CONST;
    const steps = [
      { step: C.TICKS_PER_SEASON, major: false },
      { step: C.TICKS_PER_YEAR, major: true },
      { step: C.TICKS_PER_YEAR * 5, major: true },
      { step: C.TICKS_PER_YEAR * 10, major: true },
      { step: C.TICKS_PER_YEAR * 25, major: true },
      { step: C.TICKS_PER_YEAR * 50, major: true },
      { step: C.TICKS_PER_YEAR * 100, major: true }
    ];
    const gap = minPxGap || 46;
    let pick = steps[steps.length - 1];
    for (const s of steps) {
      if (s.step * pxPerTick >= gap) { pick = s; break; }
    }
    const marks = [];
    const start = Math.ceil(tickMin / pick.step) * pick.step;
    for (let t = start; t <= tickMax; t += pick.step) {
      const lb = tickToTimeLabel(t);
      marks.push({
        tick: t,
        text: pick.major ? ('第' + lb.year + '年') : lb.text,
        major: pick.major
      });
    }
    return { step: pick.step, major: pick.major, marks };
  }

  const SRC_FNS = [
    markSpine, buildFamilies, assignTimelineY, makeOccupancy, probeColumn,
    relativeCost, packHorizontal, layoutTimelineDag, edgePathTimeline, edgePathFlat,
    lodLevel, tickToTimeLabel, rulerMarks
  ];

  return {
    LAYOUT_CONST, VNEAR, HNEAR,
    markSpine, buildFamilies, assignTimelineY, packHorizontal, layoutTimelineDag,
    edgePathTimeline, edgePathFlat, lodLevel, tickToTimeLabel, rulerMarks,
    // standalone 独立新标签页内嵌同源源码 (含常量字面量，杜绝作用域缺失)
    SRC: 'const LAYOUT_CONST = ' + JSON.stringify(LAYOUT_CONST) + ';\n' +
      'const VNEAR = LAYOUT_CONST.NODE_H + LAYOUT_CONST.GAP_Y;\n' +
      'const HNEAR = LAYOUT_CONST.NODE_W + LAYOUT_CONST.GAP_X;\n\n' +
      SRC_FNS.map(f => f.toString()).join('\n\n')
  };
});
