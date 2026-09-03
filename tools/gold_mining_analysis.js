#!/usr/bin/env node
/**
 * 无头分析脚本：验证各时刻族人需求状态，定位为何不挖金币
 *
 * 运行：node tools/gold_mining_analysis.js
 *
 * 直接加载 sim_wasm.wasm，不依赖浏览器/前端渲染。
 */

const fs = require('fs');
const path = require('path');

const WASM_PATH = path.join(__dirname, '..', 'frontend', 'rust', 'sim_wasm.wasm');

// 触发器阈值（与 Rust config.rs 一致）
const TRIGGER_ON = 100.0;   // 余额 < 100 → ON（去采）
const TRIGGER_OFF = 200.0;  // ON后余额 ≥ 200 → OFF（补足）

// 决策顺序（兜底序，与 branches.rs BranchId::ALL 一致）
const DECISION_ORDER = [
  'b14 夺位', 'b1 口渴', 'b2 饥饿', 'b3 休息', 'b4 修缮',
  'b5 储水', 'b6 储粮', 'b7 储木', 'b8 建0级房', 'b9 采石',
  'b10 备金', 'b11 升级房', 'b12 立宅', 'b13 娱乐淘金'
];

function triggerOn(balance) {
  return balance < TRIGGER_ON;
}

function collectHouseholdBalances(snap) {
  const map = new Map();
  for (const hh of snap.households) {
    if (hh.is_dissolved) continue;
    const bal = { water: 0, food: 0, wood: 0, stone: 0, gold: 0 };
    for (const b of hh.balances || []) {
      if (b.resource === 'Water') bal.water = b.amount;
      else if (b.resource === 'Food') bal.food = b.amount;
      else if (b.resource === 'Wood') bal.wood = b.amount;
      else if (b.resource === 'Stone') bal.stone = b.amount;
      else if (b.resource === 'Gold') bal.gold = b.amount;
    }
    map.set(hh.id, { ...bal, head: hh.head, members: hh.members });
  }
  return map;
}

function findHouseholdForAgent(hhMap, agentId) {
  for (const [id, hh] of hhMap) {
    if (hh.head === agentId || (hh.members || []).includes(agentId)) {
      return id;
    }
  }
  return null;
}

function printAnalysis(wasm, snap, step, simSeconds) {
  const alive = snap.agents.filter(a => a.is_alive && !a.is_fetus);
  const hhMap = collectHouseholdBalances(snap);

  // 淘金相关统计
  let goldTriggerOn = 0;
  let withHouse = 0;
  let noHouse = 0;
  let seekingGold = 0;
  let miningGold = 0;
  let totalCarriedGold = 0;
  const goldValues = [];

  const stateCounts = {};
  const needCounts = {};

  for (const a of alive) {
    totalCarriedGold += a.carried_gold || 0;
    goldValues.push(a.carried_gold || 0);
    if (a.home_house_id != null) withHouse++; else noHouse++;

    const state = a.state || 'Unknown';
    stateCounts[state] = (stateCounts[state] || 0) + 1;

    if (state.includes('Gold')) {
      if (state.includes('Seeking')) seekingGold++;
      if (state.includes('Mining')) miningGold++;
    }

    if (a.current_need) {
      needCounts[a.current_need] = (needCounts[a.current_need] || 0) + 1;
    }

    const hhId = findHouseholdForAgent(hhMap, a.id);
    if (hhId != null) {
      const bal = hhMap.get(hhId);
      if (bal && triggerOn(bal.gold)) goldTriggerOn++;
    }
  }

  console.log('\n' + '═'.repeat(95));
  console.log(`📊 step=${step} | 模拟时间=${simSeconds.toFixed(0)}s (${(simSeconds/60).toFixed(1)}min) | tick=${snap.tick} | ${snap.season} ${snap.temperature.toFixed(1)}°C`);
  console.log('─'.repeat(95));
  console.log(`👥 存活=${alive.length}人  有房=${withHouse}  无房=${noHouse}  携金总量=${totalCarriedGold.toFixed(1)}  出生=${snap.total_births} 死亡=${snap.total_deaths}`);
  // 家户平均资源储量与人口
  const allHhGlobal = [...hhMap.values()];
  const hhCountGlobal = allHhGlobal.length;
  const totalHhPopGlobal = allHhGlobal.reduce((s,b)=>s+(b.members||[]).length,0);
  const avgWGlobal = hhCountGlobal ? allHhGlobal.reduce((s,b)=>s+b.water,0)/hhCountGlobal : 0;
  const avgFGlobal = hhCountGlobal ? allHhGlobal.reduce((s,b)=>s+b.food,0)/hhCountGlobal : 0;
  const avgWdGlobal = hhCountGlobal ? allHhGlobal.reduce((s,b)=>s+b.wood,0)/hhCountGlobal : 0;
  const avgSGlobal = hhCountGlobal ? allHhGlobal.reduce((s,b)=>s+b.stone,0)/hhCountGlobal : 0;
  const avgGGlobal = hhCountGlobal ? allHhGlobal.reduce((s,b)=>s+b.gold,0)/hhCountGlobal : 0;
  console.log(`🏠 家户=${hhCountGlobal}户  家户总人口=${totalHhPopGlobal}人  户均=${(hhCountGlobal?totalHhPopGlobal/hhCountGlobal:0).toFixed(1)}人  户均储量: 水${avgWGlobal.toFixed(1)} 粮${avgFGlobal.toFixed(1)} 木${avgWdGlobal.toFixed(1)} 石${avgSGlobal.toFixed(1)} 金${avgGGlobal.toFixed(1)}`);
  console.log(`💰 淘金: Gold触发器ON=${goldTriggerOn}人  寻金中=${seekingGold}  淘金中=${miningGold}`);
  // 金币基尼系数（基于家户账本金余额，与前端 render_hud.js 一致）
  const hhGoldVals = (snap.households || [])
    .filter(h => !h.is_dissolved)
    .map(h => {
      const gb = (h.balances || []).find(b => b.resource === 'Gold');
      return gb ? gb.amount : 0;
    });
  const nGold = hhGoldVals.length;
  const sortedGold = [...hhGoldVals].sort((a, b) => a - b);
  const totalGoldVal = sortedGold.reduce((s, v) => s + v, 0);
  let giniGold = 0;
  if (nGold > 1 && totalGoldVal > 0) {
    let cumW = 0;
    for (let i = 0; i < nGold; i++) cumW += (i + 1) * sortedGold[i];
    giniGold = (2 * cumW) / (nGold * totalGoldVal) - (nGold + 1) / nGold;
  }
  let giniLabel, giniColor;
  if (giniGold < 0.2) { giniLabel = '高度平等'; giniColor = '绿'; }
  else if (giniGold < 0.3) { giniLabel = '比较平等'; giniColor = '浅绿'; }
  else if (giniGold < 0.4) { giniLabel = '相对合理'; giniColor = '黄'; }
  else if (giniGold < 0.5) { giniLabel = '差距较大'; giniColor = '橙'; }
  else if (giniGold < 0.6) { giniLabel = '高度不平等'; giniColor = '深橙'; }
  else { giniLabel = '极端不平等'; giniColor = '红'; }
  const topGold = sortedGold[nGold - 1] || 0;
  const bottomGold = sortedGold[0] || 0;
  const zeroGoldCount = sortedGold.filter(v => v <= 0).length;
  console.log(`📊 家户金基尼: ${giniGold.toFixed(3)} (${giniLabel}/${giniColor}色)  最富户=${topGold.toFixed(1)}  最贫户=${bottomGold.toFixed(1)}  零金户=${zeroGoldCount}/${nGold}`);
  // 地图资源总量（POI current_stock 按类型汇总）
  const mapRes = { WaterSource: 0, BerryBush: 0, WoodForest: 0, StoneQuarry: 0, GoldMine: 0 };
  const mapMax = { WaterSource: 0, BerryBush: 0, WoodForest: 0, StoneQuarry: 0, GoldMine: 0 };
  const mapCount = { WaterSource: 0, BerryBush: 0, WoodForest: 0, StoneQuarry: 0, GoldMine: 0 };
  for (const p of snap.pois || []) {
    if (mapRes[p.poi_type] !== undefined) {
      mapRes[p.poi_type] += p.current_stock;
      mapMax[p.poi_type] += p.max_stock;
      mapCount[p.poi_type]++;
    }
  }
  console.log(`🗺️  地图储量: 水${mapRes.WaterSource.toFixed(1)}/${mapMax.WaterSource.toFixed(0)}(${mapCount.WaterSource}处) 粮${mapRes.BerryBush.toFixed(1)}/${mapMax.BerryBush.toFixed(0)}(${mapCount.BerryBush}处) 木${mapRes.WoodForest.toFixed(1)}/${mapMax.WoodForest.toFixed(0)}(${mapCount.WoodForest}处) 石${mapRes.StoneQuarry.toFixed(1)}/${mapMax.StoneQuarry.toFixed(0)}(${mapCount.StoneQuarry}处) 金${mapRes.GoldMine.toFixed(1)}/${mapMax.GoldMine.toFixed(0)}(${mapCount.GoldMine}处)`);

  // 状态分布
  console.log('\n🔄 动作状态分布:');
  const states = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]);
  for (const [state, cnt] of states) {
    console.log(`  ${String(cnt).padStart(3)}人  ${state}`);
  }

  // 需求分布
  console.log('\n🎯 当前需求分布 (current_need):');
  const needs = Object.entries(needCounts).sort((a, b) => b[1] - a[1]);
  for (const [need, cnt] of needs) {
    console.log(`  ${String(cnt).padStart(3)}人  ${need}`);
  }

  // 家户账本
  console.log('\n🏠 家户账本与触发器 (ON=余额<100需采, off=余额≥200已足):');
  console.log(`  ${'HH'.padStart(5)}  ${'人口'.padStart(4)}  ${'水'.padStart(6)}  ${'粮'.padStart(6)}  ${'木'.padStart(6)}  ${'石'.padStart(6)}  ${'金'.padStart(6)}  触发器(水/粮/木/石/金)`);
  const hhList = [...hhMap.entries()].sort((a, b) => a[0] - b[0]);
  // 累计平均资源储量和总人口
  let sumW=0, sumF=0, sumWd=0, sumS=0, sumG=0, sumPop=0;
  for (let i = 0; i < Math.min(hhList.length, 12); i++) {
    const [id, bal] = hhList[i];
    const pop = (bal.members || []).length;
    sumW+=bal.water; sumF+=bal.food; sumWd+=bal.wood; sumS+=bal.stone; sumG+=bal.gold; sumPop+=pop;
    const trig = [bal.water, bal.food, bal.wood, bal.stone, bal.gold]
      .map(v => triggerOn(v) ? 'ON' : 'off').join('/');
    console.log(`  ${String(id).padStart(5)}  ${String(pop).padStart(4)}  ${bal.water.toFixed(1).padStart(6)}  ${bal.food.toFixed(1).padStart(6)}  ${bal.wood.toFixed(1).padStart(6)}  ${bal.stone.toFixed(1).padStart(6)}  ${bal.gold.toFixed(1).padStart(6)}  ${trig}`);
  }
  // 全部家户的平均（不限于显示的12家）
  const allHh = [...hhMap.values()];
  const hhCount = allHh.length;
  const avgW = hhCount ? allHh.reduce((s,b)=>s+b.water,0)/hhCount : 0;
  const avgF = hhCount ? allHh.reduce((s,b)=>s+b.food,0)/hhCount : 0;
  const avgWd = hhCount ? allHh.reduce((s,b)=>s+b.wood,0)/hhCount : 0;
  const avgS = hhCount ? allHh.reduce((s,b)=>s+b.stone,0)/hhCount : 0;
  const avgG = hhCount ? allHh.reduce((s,b)=>s+b.gold,0)/hhCount : 0;
  const totalHhPop = allHh.reduce((s,b)=>s+(b.members||[]).length,0);
  const avgPop = hhCount ? totalHhPop/hhCount : 0;
  console.log(`  ${'平均'.padStart(5)}  ${avgPop.toFixed(1).padStart(4)}  ${avgW.toFixed(1).padStart(6)}  ${avgF.toFixed(1).padStart(6)}  ${avgWd.toFixed(1).padStart(6)}  ${avgS.toFixed(1).padStart(6)}  ${avgG.toFixed(1).padStart(6)}  (${hhCount}家户, 总人口${totalHhPop})`);

  // 逐人详情
  console.log('\n👤 族人详情 (前12人):');
  console.log(`  ${'ID'.padStart(4)}  ${'性'.padStart(2)}  ${'年龄s'.padStart(6)}  ${'口渴'.padStart(5)}  ${'饥饿'.padStart(5)}  ${'体力'.padStart(5)}  ${'携金'.padStart(5)}  ${'房'.padStart(2)}  state / current_need`);
  for (let i = 0; i < Math.min(alive.length, 12); i++) {
    const a = alive[i];
    const need = a.current_need || '-';
    console.log(`  ${String(a.id).padStart(4)}  ${(a.gender||'?')[0].padStart(2)}  ${String(Math.round(a.age||0)).padStart(6)}  ${(a.thirst||0).toFixed(1).padStart(5)}  ${(a.hunger||0).toFixed(1).padStart(5)}  ${(a.stamina||0).toFixed(1).padStart(5)}  ${(a.carried_gold||0).toFixed(1).padStart(5)}  ${(a.home_house_id!=null?'是':'否').padStart(2)}  ${a.state} | ${need}`);
  }
}

async function main() {
  console.log('🚀 Flow & Accord 无头分析：族人为何不挖金币？');
  console.log('   决策顺序(兜底): ' + DECISION_ORDER.join(' → '));
  console.log(`   触发器: 余额<${TRIGGER_ON}→ON(去采); ON后余额≥${TRIGGER_OFF}→OFF(补足)`);
  console.log('   b10备金条件: 有房 + Gold触发器ON + 有可用金矿 + 淘金冷却≤0');
  console.log('   b13娱乐淘金条件: 4级庄园 + 无修缮 + 五类触发器全OFF + 冷却≤0');

  // 加载 wasm
  const wasmBytes = fs.readFileSync(WASM_PATH);
  const result = await WebAssembly.instantiate(wasmBytes, {});
  const wasm = result.instance.exports;
  const memory = wasm.memory;

  // 创建世界（与前端一致：grid=60, size=764, seed=42, 20人）
  wasm.world_create(60, 764.0, 42, 20);

  function getSnapshot() {
    const ptr = wasm.world_snapshot_ptr();
    const len = wasm.world_snapshot_len();
    if (!len) return null;
    const bytes = new Uint8Array(memory.buffer, ptr, len);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  const dt = 0.5;
  const totalSteps = 20000; // 10000s ≈ 166.7min 模拟时间
  const reportInterval = 2000; // 每1000s报告一次

  // 初始状态
  let snap = getSnapshot();
  printAnalysis(wasm, snap, 0, 0);

  for (let step = 1; step <= totalSteps; step++) {
    wasm.world_tick(dt);
    if (step % reportInterval === 0) {
      snap = getSnapshot();
      printAnalysis(wasm, snap, step, step * dt);
    }
  }

  // 最终总结
  snap = getSnapshot();
  const alive = snap.agents.filter(a => a.is_alive && !a.is_fetus);
  const hhMap = collectHouseholdBalances(snap);
  let goldTriggerOn = 0, withHouse = 0, noHouse = 0;
  for (const a of alive) {
    if (a.home_house_id != null) withHouse++; else noHouse++;
    const hhId = findHouseholdForAgent(hhMap, a.id);
    if (hhId != null) {
      const bal = hhMap.get(hhId);
      if (bal && triggerOn(bal.gold)) goldTriggerOn++;
    }
  }

  console.log('\n' + '═'.repeat(95));
  console.log(`📋 最终总结 (模拟${(totalSteps*dt).toFixed(0)}s = ${(totalSteps*dt/60).toFixed(1)}min):`);
  console.log(`  存活=${alive.length}人 (有房=${withHouse}, 无房=${noHouse})  Gold触发器ON=${goldTriggerOn}人`);
  // 家户平均资源储量与人口
  const allHhFinal = [...hhMap.values()];
  const hhCountFinal = allHhFinal.length;
  const totalHhPopFinal = allHhFinal.reduce((s,b)=>s+(b.members||[]).length,0);
  const avgWFinal = hhCountFinal ? allHhFinal.reduce((s,b)=>s+b.water,0)/hhCountFinal : 0;
  const avgFFinal = hhCountFinal ? allHhFinal.reduce((s,b)=>s+b.food,0)/hhCountFinal : 0;
  const avgWdFinal = hhCountFinal ? allHhFinal.reduce((s,b)=>s+b.wood,0)/hhCountFinal : 0;
  const avgSFinal = hhCountFinal ? allHhFinal.reduce((s,b)=>s+b.stone,0)/hhCountFinal : 0;
  const avgGFinal = hhCountFinal ? allHhFinal.reduce((s,b)=>s+b.gold,0)/hhCountFinal : 0;
  console.log(`  家户=${hhCountFinal}户  家户总人口=${totalHhPopFinal}人  户均=${(hhCountFinal?totalHhPopFinal/hhCountFinal:0).toFixed(1)}人`);
  console.log(`  户均储量: 水=${avgWFinal.toFixed(1)}  粮=${avgFFinal.toFixed(1)}  木=${avgWdFinal.toFixed(1)}  石=${avgSFinal.toFixed(1)}  金=${avgGFinal.toFixed(1)}`);
  console.log('');
  console.log('🔍 不挖金币的原因诊断:');

  const reasons = [];
  if (withHouse === 0) {
    reasons.push('❌ 【根本原因】无人有房 → b10备金的 home_tier.is_some() 守卫直接短路。族人还在 b12立宅 阶段，需先建立0级仓库才能触发备金需求。');
  }
  if (withHouse > 0 && goldTriggerOn === 0) {
    reasons.push('❌ Gold触发器全OFF → 所有有房者的家户账本Gold余额≥100，系统不认为需要采金。');
  }
  if (withHouse > 0 && goldTriggerOn > 0) {
    reasons.push('⚠️  有房且Gold触发器ON，但被前置分支阻塞。决策是"首个命中即返回"，若 b5储水/b6储粮/b7储木 持续ON（账本未补足到200），永远轮不到 b10备金。');
  }

  // 检查前置分支阻塞情况
  const waterOn = [...hhMap.values()].filter(b => triggerOn(b.water)).length;
  const foodOn = [...hhMap.values()].filter(b => triggerOn(b.food)).length;
  const woodOn = [...hhMap.values()].filter(b => triggerOn(b.wood)).length;
  const stoneOn = [...hhMap.values()].filter(b => triggerOn(b.stone)).length;
  console.log(`  前置触发器状态: 水ON=${waterOn}家户  粮ON=${foodOn}  木ON=${woodOn}  石ON=${stoneOn}  金ON=${goldTriggerOn}`);
  if (waterOn > 0 || foodOn > 0 || woodOn > 0) {
    console.log('  → 水/粮/木触发器持续ON，族人每次决策优先命中 b5/b6/b7，b10备金被阻塞。');
  }

  for (const r of reasons) console.log('  ' + r);
  console.log('═'.repeat(95));
}

main().catch(e => { console.error(e); process.exit(1); });
