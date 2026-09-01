// =========================================================================
// 🧪 族谱布局测试数据集生成器 (Flow & Accord)
//  零依赖 Node 脚本：直接驱动 sim_wasm 内核跑满指定 tick 数（默认 50 万），
//  周期性读取快照累积「全量族人档案库」(快照本身只含存活者)，
//  再按焦点裁剪出直系血脉子图，并输出统计报告供 Y 轴映射参数拟合。
//
//  用法: node tools/gen-dag-testdata.js [--ticks=500000] [--seed=2026] [--poll=900] [--out=/tmp/dag-lab]
// =========================================================================
const fs = require('fs');
const path = require('path');

// ------------------------------ 参数解析 ------------------------------
const argv = process.argv.slice(2);
function arg(name, def) {
  const hit = argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : def;
}
const TOTAL_TICKS = parseInt(arg('ticks', '500000'), 10);
const SEED = parseFloat(arg('seed', '2026'));
const POLL = parseInt(arg('poll', '900'), 10);      // 每 POLL tick 读一次快照并入档
const OUT_DIR = arg('out', '/tmp/dag-lab');
const FOCUS_ID = arg('focus', '') ? parseInt(arg('focus', ''), 10) : null;
const TD = 1 / 30; // simulationDt，严禁改动

const ROOT = path.resolve(__dirname, '..');
const wasmPath = path.join(ROOT, 'frontend', 'rust', 'sim_wasm.wasm');
if (!fs.existsSync(wasmPath)) throw new Error('wasm not found: ' + wasmPath);
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ------------------------------ 统计工具 ------------------------------
function pct(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.round((sortedArr.length - 1) * p)));
  return sortedArr[idx];
}
function summarize(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  return {
    n: s.length,
    min: s.length ? s[0] : 0,
    p10: pct(s, 0.10), p25: pct(s, 0.25), p50: pct(s, 0.50),
    p75: pct(s, 0.75), p90: pct(s, 0.90), p99: pct(s, 0.99),
    max: s.length ? s[s.length - 1] : 0,
    mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0
  };
}

// ------------------------------ 主流程 ------------------------------
(async () => {
  const t0 = Date.now();
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;

  function readSnapshot() {
    const ptr = ex.world_snapshot_ptr();
    const len = ex.world_snapshot_len();
    return JSON.parse(new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr, len)));
  }

  ex.world_create(60, 764.0, SEED, 20);

  // archive: id -> 族人档案 (末次出现状态覆盖式写入)
  const archive = new Map();
  const popCurve = [];
  let tick = 0;
  let extinctAt = null;
  let peakPop = 0;

  while (tick < TOTAL_TICKS) {
    const chunk = Math.min(POLL, TOTAL_TICKS - tick);
    ex.world_tick_steps(chunk, TD);
    tick += chunk;

    const snap = readSnapshot();
    for (const a of snap.agents) {
      const prev = archive.get(a.id);
      archive.set(a.id, {
        id: a.id,
        gender: a.gender === 'Female' ? 'female' : 'male',
        age: a.age,
        birthTick: a.birth_tick || 0,
        isAlive: true,
        isPregnant: !!a.is_pregnant,
        hunger: a.hunger, thirst: a.thirst, stamina: a.stamina,
        health: a.health, currentNeed: a.current_need || '',
        deathCause: a.death_cause || null,
        generation: a.generation || 1,
        spouseId: a.spouse_id || null,
        motherId: a.mother_id || null,
        fatherId: a.father_id || null,
        children: Array.isArray(a.children_ids) ? a.children_ids.slice() : [],
        homeHouseId: a.home_house_id || null,
        intelligence: a.intelligence, strength: a.strength, libido: a.libido,
        digestionEfficiency: a.digestion_efficiency,
        sleepEfficiency: a.sleep_efficiency,
        lifeExpectancy: a.life_expectancy,
        surname: a.surname || '', prestige: a.prestige || 0,
        firstSeenTick: prev ? prev.firstSeenTick : tick,
        lastSeenTick: tick
      });
    }
    if (snap.agents.length > peakPop) peakPop = snap.agents.length;
    if (snap.agents.length === 0 && extinctAt === null) extinctAt = tick;
    if (tick % (POLL * 10) === 0 || tick === TOTAL_TICKS) {
      popCurve.push({ tick, alive: snap.agents.length, houses: snap.houses.length, totalBirths: snap.total_births, totalDeaths: snap.total_deaths });
      process.stdout.write(`\r  ⏳ tick ${tick}/${TOTAL_TICKS} · 存活 ${snap.agents.length} · 累计出生 ${snap.total_births} · 档案 ${archive.size}   `);
    }
    if (extinctAt !== null && tick - extinctAt > 9000) {
      console.log(`\n  ⚠️  部落于 tick ${extinctAt} 灭绝，提前结束`);
      break;
    }
  }
  const finalSnap = readSnapshot();
  const finalTick = finalSnap.tick;
  const aliveIds = new Set(finalSnap.agents.map(a => a.id));

  // 死亡判定：末次出现早于终局快照 → 已故
  for (const ag of archive.values()) {
    if (!aliveIds.has(ag.id)) ag.isAlive = false;
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n  ✅ 内核推进 ${finalTick} tick 完成 (${elapsed}s) · 档案 ${archive.size} 人 · 峰值存活 ${peakPop} · 终局存活 ${aliveIds.size}`);

  // ------------------------------ 统计报告 ------------------------------
  const all = Array.from(archive.values());
  const birthGaps = [];          // 全局相邻出生 tick 间隔
  const sortedByBirth = all.slice().sort((a, b) => a.birthTick - b.birthTick || a.id - b.id);
  for (let i = 1; i < sortedByBirth.length; i++) {
    birthGaps.push(sortedByBirth[i].birthTick - sortedByBirth[i - 1].birthTick);
  }
  const parentChildGaps = [];    // 亲子出生间隔 (父/母 → 子女)
  const siblingGaps = [];        // 同父母相邻子女出生间隔
  const familySizes = [];
  const familyMap = new Map();
  for (const ag of all) {
    for (const pId of [ag.fatherId, ag.motherId]) {
      if (!pId) continue;
      const p = archive.get(pId);
      if (p) parentChildGaps.push(ag.birthTick - p.birthTick);
    }
    const fk = (ag.fatherId || 0) + '|' + (ag.motherId || 0);
    if (!familyMap.has(fk)) familyMap.set(fk, []);
    familyMap.get(fk).push(ag);
  }
  for (const list of familyMap.values()) {
    list.sort((a, b) => a.birthTick - b.birthTick || a.id - b.id);
    if (list.length > 1) {
      familySizes.push(list.length);
      for (let i = 1; i < list.length; i++) siblingGaps.push(list[i].birthTick - list[i - 1].birthTick);
    }
  }
  const genDepth = all.reduce((m, a) => Math.max(m, a.generation || 1), 1);
  const tickMin = sortedByBirth.length ? sortedByBirth[0].birthTick : 0;
  const tickMax = sortedByBirth.length ? sortedByBirth[sortedByBirth.length - 1].birthTick : 0;

  // ------------------------------ 焦点选择与直系子图裁剪 ------------------------------
  // 复刻 frontend/js/dag.js::buildLineageDAG 的 BFS 规则（向上父/母链 + 向女儿孙链）
  function lineageOf(focusId) {
    if (!archive.has(focusId)) return null;
    const ancestors = new Set(), descendants = new Set(), lineageIds = new Set([focusId]);
    const aq = [focusId];
    while (aq.length) {
      const cur = archive.get(aq.shift());
      if (!cur) continue;
      for (const pId of [cur.fatherId, cur.motherId]) {
        if (pId && archive.has(pId) && !ancestors.has(pId)) { ancestors.add(pId); lineageIds.add(pId); aq.push(pId); }
      }
    }
    const dq = [focusId];
    while (dq.length) {
      const cur = archive.get(dq.shift());
      if (!cur || !Array.isArray(cur.children)) continue;
      for (const cId of cur.children) {
        if (archive.has(cId) && !descendants.has(cId)) { descendants.add(cId); lineageIds.add(cId); dq.push(cId); }
      }
    }
    return { focusId, ancestors, descendants, lineageIds };
  }

  let focusId = FOCUS_ID;
  if (focusId === null) {
    // 在「终局存活者」中挑选直系血脉最庞大的个体（旁支最丰富 → 布局压力最大，最适合做压测样本）
    let best = null;
    for (const id of aliveIds) {
      const L = lineageOf(id);
      if (!L) continue;
      if (!best || L.lineageIds.size > best.size) best = { id, size: L.lineageIds.size };
    }
    if (!best) best = { id: sortedByBirth[0] ? sortedByBirth[0].id : 1, size: 1 };
    focusId = best.id;
    console.log(`  🎯 自动选取焦点 #${focusId} (直系血脉 ${best.size} 人)`);
  }
  const L = lineageOf(focusId);
  const nodes = Array.from(L.lineageIds).map(id => archive.get(id)).filter(Boolean)
    .sort((a, b) => a.birthTick - b.birthTick || a.id - b.id);
  const inGraph = new Set(nodes.map(n => n.id));
  const edges = [];
  for (const n of nodes) {
    if (n.fatherId && inGraph.has(n.fatherId)) edges.push({ parentId: n.fatherId, childId: n.id, parentType: 'father' });
    if (n.motherId && inGraph.has(n.motherId)) edges.push({ parentId: n.motherId, childId: n.id, parentType: 'mother' });
  }
  // 子图专属统计
  const subBirthGaps = [], subParentChild = [], subSibling = [];
  for (let i = 1; i < nodes.length; i++) subBirthGaps.push(nodes[i].birthTick - nodes[i - 1].birthTick);
  const subFamily = new Map();
  for (const n of nodes) {
    for (const pId of [n.fatherId, n.motherId]) {
      if (!pId) continue;
      const p = archive.get(pId);
      if (p) subParentChild.push(n.birthTick - p.birthTick);
    }
    const fk = (n.fatherId || 0) + '|' + (n.motherId || 0);
    if (!subFamily.has(fk)) subFamily.set(fk, []);
    subFamily.get(fk).push(n);
  }
  for (const list of subFamily.values()) {
    list.sort((a, b) => a.birthTick - b.birthTick || a.id - b.id);
    for (let i = 1; i < list.length; i++) subSibling.push(list[i].birthTick - list[i - 1].birthTick);
  }

  const stats = {
    meta: {
      generatedAt: new Date().toISOString(),
      seed: SEED, requestedTicks: TOTAL_TICKS, finalTick, pollInterval: POLL,
      elapsedSec: Number(elapsed), extinctAt, peakPop, finalAlive: aliveIds.size,
      tickSecond: 30, seasonYearTicks: 7200
    },
    population: {
      archiveSize: archive.size, totalBirths: finalSnap.total_births, totalDeaths: finalSnap.total_deaths,
      maxGeneration: genDepth, birthTickMin: tickMin, birthTickMax: tickMax
    },
    globalGaps: { betweenConsecutiveBirths: summarize(birthGaps), parentToChild: summarize(parentChildGaps), sibling: summarize(siblingGaps) },
    familySize: summarize(familySizes),
    lineage: {
      focusId, nodeCount: nodes.length, edgeCount: edges.length,
      ancestors: L.ancestors.size, descendants: L.descendants.size,
      birthTickMin: nodes.length ? nodes[0].birthTick : 0,
      birthTickMax: nodes.length ? nodes[nodes.length - 1].birthTick : 0,
      gaps: { betweenConsecutiveBirths: summarize(subBirthGaps), parentToChild: summarize(subParentChild), sibling: summarize(subSibling) }
    },
    popCurve
  };

  fs.writeFileSync(path.join(OUT_DIR, 'archive.json'), JSON.stringify(all));
  fs.writeFileSync(path.join(OUT_DIR, 'lineage.json'), JSON.stringify({ focusId, nodes, edges }));
  fs.writeFileSync(path.join(OUT_DIR, 'stats.json'), JSON.stringify(stats, null, 2));

  console.log('\n  📊 全量: 出生 tick 跨度 ' + tickMin + '~' + tickMax +
    ' · 相邻出生间隔 p10=' + stats.globalGaps.betweenConsecutiveBirths.p10 +
    ' p50=' + stats.globalGaps.betweenConsecutiveBirths.p50 +
    ' p90=' + stats.globalGaps.betweenConsecutiveBirths.p90);
  console.log('  📊 亲子间隔 p10=' + stats.globalGaps.parentToChild.p10 +
    ' p50=' + stats.globalGaps.parentToChild.p50 +
    ' p90=' + stats.globalGaps.parentToChild.p90 +
    ' (秒: p50≈' + (stats.globalGaps.parentToChild.p50 / 30).toFixed(1) + 's)');
  console.log('  📊 直系子图: 节点 ' + nodes.length + ' · 边 ' + edges.length +
    ' · 跨度 ' + stats.lineage.birthTickMin + '~' + stats.lineage.birthTickMax);
  console.log('  📊 子图亲子间隔 p10=' + stats.lineage.gaps.parentToChild.p10 +
    ' p50=' + stats.lineage.gaps.parentToChild.p50 +
    ' p90=' + stats.lineage.gaps.parentToChild.p90);
  console.log('  💾 已输出: ' + OUT_DIR + '/{archive.json, lineage.json, stats.json}');
})().catch(e => { console.error('GEN_FAIL', e); process.exit(1); });
