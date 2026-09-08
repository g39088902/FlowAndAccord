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
    // 默认时间密度；布局时按实际亲子出生间隔设置下限，保持线性时间轴和代际留白。
    PX_PER_TICK: 0.002,
    LOD_BLOCK: 0.45,      // scale <  → 概览档 (紧凑色块 + 直线边)
    LOD_SIMPLE: 0.75,     // scale <  → 简档 (头像+编号+世代)，否则全档
    TICKS_PER_SEC: 60,    // 1 游戏小时
    TICKS_PER_SEASON: 3600, // 1 季 (60 游戏小时)
    TICKS_PER_YEAR: 14400   // 1 年 (240 游戏小时)
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

  function isFemale(n) {
    return !!(n && n.gender === 'female');
  }

  // 将 idealCol 对齐到符合自身性别的奇偶列 (男奇 1, 3, 5... / 女偶 0, 2, 4...)
  function alignColumnToGender(ideal, isFem) {
    const p = isFem ? 0 : 1;
    const r = Math.round(ideal);
    if (((r % 2) + 2) % 2 === p) return r;
    const dLeft = Math.abs((r - 1) - ideal);
    const dRight = Math.abs((r + 1) - ideal);
    if (Math.abs(dLeft - dRight) < 1e-4) {
      return isFem ? (r + 1) : (r - 1);
    }
    return dLeft < dRight ? (r - 1) : (r + 1);
  }

  // 在整数列网格上由 idealCol 向两侧探测最近的无冲突列 (步长 2 保持性别单双奇偶不串列)
  function probeColumn(occ, idealCol, y, selfId, maxSpan) {
    if (!occ.collides(idealCol, y, selfId)) return idealCol;
    for (let step = 1; step <= maxSpan; step++) {
      const d = step * 2;
      if (!occ.collides(idealCol + d, y, selfId)) return idealCol + d;
      if (!occ.collides(idealCol - d, y, selfId)) return idealCol - d;
    }
    return idealCol + (maxSpan + 1) * 2;
  }

  // 亲属 (父母 + 子女 + 配偶) 横向偏移代价，用于局部优化
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
    const sp = n.spouseId && nodeMap.get(n.spouseId);
    if (sp && sp._placed) { cost += Math.abs(sp.col - col); cnt++; }
    return cnt ? cost / cnt : 0;
  }

  function packHorizontal(nodes, nodeMap, spine, families, pxPerTick, tickMin, pad) {
    const occ = makeOccupancy(pxPerTick, tickMin, pad);
    const birthOrder = nodes.slice().sort((a, b) => (a.birthTick - b.birthTick) || (a.id - b.id));
    const maxSpan = Math.max(8, birthOrder.length);

    // —— 第一遍: 主干优先落位 (男性锚定第 1 列单数，女性锚定第 0 列双数)
    for (const n of birthOrder) {
      if (!spine.has(n.id)) continue;
      const spineIdeal = isFemale(n) ? 0 : 1;
      n.col = probeColumn(occ, spineIdeal, n.y, n.id, maxSpan);
      n.x = n.col * HNEAR;
      n._placed = true;
      occ.add(n);
    }
    // —— 第二遍: 其余节点按出生顺序落位，理想列 = 双亲中点 (或配偶) + 同胞序号偏移 (步长 2)
    for (const n of birthOrder) {
      if (n._placed) continue;
      const f = n.familyKey ? families.get(n.familyKey) : null;
      const father = n.fatherId && nodeMap.get(n.fatherId);
      const mother = n.motherId && nodeMap.get(n.motherId);
      const spouse = n.spouseId && nodeMap.get(n.spouseId);
      let base = isFemale(n) ? 0 : 1, hasAnchor = false;
      if (father && father._placed && mother && mother._placed) {
        base = (father.col + mother.col) / 2;
        hasAnchor = true;
      } else if (father && father._placed) {
        base = father.col;
        hasAnchor = true;
      } else if (mother && mother._placed) {
        base = mother.col;
        hasAnchor = true;
      } else if (spouse && spouse._placed) {
        base = spouse.col;
        hasAnchor = true;
      }
      // 同父母子女整体以双亲中点为中心向两侧铺开，同性别步长为 2
      let ideal = base;
      if (f && f.children.length > 1) {
        ideal = base + (n.siblingIx - (f.children.length - 1) / 2) * 2;
      } else if (!hasAnchor) {
        ideal = isFemale(n) ? 0 : 1;
      }
      const aligned = alignColumnToGender(ideal, isFemale(n));
      n.col = probeColumn(occ, aligned, n.y, n.id, maxSpan);
      n.x = n.col * HNEAR;
      n._placed = true;
      occ.add(n);
    }

    // —— 第三遍: 局部松弛 (父向子女质心靠拢 → 子向双亲/配偶中点靠拢)，仅在保持性别奇偶、不冲突且代价下降时接受
    for (let pass = 0; pass < 2; pass++) {
      for (let i = birthOrder.length - 1; i >= 0; i--) {
        const n = birthOrder[i];
        if (spine.has(n.id)) continue;
        const kids = (n.children || []).map(id => nodeMap.get(id)).filter(c => c && c._placed);
        if (!kids.length) continue;
        const target = kids.reduce((s, k) => s + k.col, 0) / kids.length;
        const aligned = alignColumnToGender(target, isFemale(n));
        const cand = probeColumn(occ, aligned, n.y, n.id, maxSpan);
        if (cand !== n.col && !occ.collides(cand, n.y, n.id) && relativeCost(n, cand, nodeMap) < relativeCost(n, n.col, nodeMap)) {
          n.col = cand; n.x = cand * HNEAR;
        }
      }
      for (const n of birthOrder) {
        if (spine.has(n.id)) continue;
        const father = n.fatherId && nodeMap.get(n.fatherId);
        const mother = n.motherId && nodeMap.get(n.motherId);
        const spouse = n.spouseId && nodeMap.get(n.spouseId);
        if (!father && !mother && (!spouse || !spouse._placed)) continue;
        const anchors = [father, mother, spouse].filter(p => p && p._placed).map(p => p.col);
        if (!anchors.length) continue;
        const target = anchors.reduce((s, c) => s + c, 0) / anchors.length;
        const aligned = alignColumnToGender(target, isFemale(n));
        const cand = probeColumn(occ, aligned, n.y, n.id, maxSpan);
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
    let pxPerTick = Number.isFinite(o.pxPerTick) && o.pxPerTick > 0 ? o.pxPerTick : C.PX_PER_TICK;
    // 横向避碰只能防止卡片相交，无法保证子代在父辈卡片下方。
    // 同时放大整条时间轴，使每条有效亲子边至少留出 GAP_Y，刻度仍严格线性。
    for (const e of edges) {
      const delta = e.child.birthTick - e.parent.birthTick;
      if (delta > 0) pxPerTick = Math.max(pxPerTick, (VNEAR + 1) / delta);
    }
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

    let minCol = Infinity, maxCol = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      n.isSpine = spine.has(n.id);
      if (n.col < minCol) minCol = n.col;
      if (n.col > maxCol) maxCol = n.col;
      if (n.y < minY) minY = n.y;
      if (n.y + C.NODE_H > maxY) maxY = n.y + C.NODE_H;
    }

    // 偶数平移基准：确保所有节点的最终列号为严格正整数 (>= 1)，且奇偶性严格不变
    // 使得：男性始终进入第 1, 3, 5, 7, ... 单数格子；女性始终进入第 2, 4, 6, 8, ... 双数格子
    const baseCol = (((minCol % 2) + 2) % 2 === 1) ? (minCol - 1) : (minCol - 2);
    for (const n of nodes) {
      n.col = n.col - baseCol; // 最终整数格子编号 (单数=男, 双数=女)
      n.x = pad + (n.col - 1) * HNEAR;
      n.y = n.y - minY + pad;
    }

    const finalMaxCol = maxCol - baseCol;
    const width = Math.max(1400, pad * 2 + finalMaxCol * HNEAR);
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
  // offsetX/offsetY 兼容历史调用签名 (缺省视为 0，避免产生 NaN 坐标导致 SVG 不渲染)
  function edgePathTimeline(e, offsetX, offsetY) {
    const C = LAYOUT_CONST;
    const a = e.parent;
    const b = e.child;
    const ox = offsetX || 0;
    const oy = offsetY || 0;
    const startX = a.x + ox + C.NODE_W * (e.parentType === 'father' ? 0.34 : 0.66);
    const startY = a.y + oy + C.NODE_H;
    const endX = b.x + ox + C.NODE_W * (e.parentType === 'father' ? 0.32 : 0.68);
    const endY = b.y + oy;
    const midY = (startY + endY) * 0.5;
    return 'M ' + startX + ' ' + startY + ' C ' + startX + ' ' + midY + ', ' + endX + ' ' + midY + ', ' + endX + ' ' + endY;
  }

  // 概览档: 退化为直线，避免长距离 Bezier 在缩略视图里糊成一团
  function edgePathFlat(e, offsetX, offsetY) {
    const C = LAYOUT_CONST;
    const a = e.parent;
    const b = e.child;
    const ox = offsetX || 0;
    const oy = offsetY || 0;
    const startX = a.x + ox + C.NODE_W * 0.5;
    const startY = a.y + oy + C.NODE_H;
    const endX = b.x + ox + C.NODE_W * 0.5;
    const endY = b.y + oy;
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
    isFemale, alignColumnToGender,
    markSpine, buildFamilies, assignTimelineY, makeOccupancy, probeColumn,
    relativeCost, packHorizontal, layoutTimelineDag, edgePathTimeline, edgePathFlat,
    lodLevel, tickToTimeLabel, rulerMarks
  ];

  return {
    LAYOUT_CONST, VNEAR, HNEAR,
    isFemale, alignColumnToGender,
    markSpine, buildFamilies, assignTimelineY, packHorizontal, layoutTimelineDag,
    edgePathTimeline, edgePathFlat, lodLevel, tickToTimeLabel, rulerMarks,
    // standalone 独立新标签页内嵌同源源码 (含常量字面量，杜绝作用域缺失)
    SRC: 'const LAYOUT_CONST = ' + JSON.stringify(LAYOUT_CONST) + ';\n' +
      'const VNEAR = LAYOUT_CONST.NODE_H + LAYOUT_CONST.GAP_Y;\n' +
      'const HNEAR = LAYOUT_CONST.NODE_W + LAYOUT_CONST.GAP_X;\n\n' +
      SRC_FNS.map(f => f.toString()).join('\n\n')
  };
});
