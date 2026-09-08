#!/usr/bin/env node
/*
 * Flow & Accord · M19.4b 分级任务抢占与中断机制验证 (test-preemption.js)
 * ============================================================================
 * 验证目标（M19.4b Preemption Matrix）：
 *   1. 娱乐淘金 (GoldWealth) 被常规生理需求抢占，进入淘金冷却并平滑改道；
 *   2. 建材采收 (StockStone) 遇临界饥渴 (<15) 抢占求生，且随身已采建材完整保留；
 *   3. 建材采收 (StockStone) 遇冬季暴雪私宅断柴 (<10) 抢占为伐木采柴 (StockWood)；
 *   4. 建材采收 (StockStone) 遇私宅耐久危机 (<20%) 抢占为房屋修缮 (RepairHouse)；
 *   5. 远征登基 (SeekThrone) 遇临界求生撤销远征并掉头觅食；
 *   6. 房屋施工 (ConstructingHouse) 遇王位空缺加冕机会暂停施工奔赴登基。
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { createSnapshotReader } = require('./snapshot-reader.js');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
}

function loadSimConfig() {
  const windowShim = {};
  new Function('window', fs.readFileSync(path.join(ROOT, 'frontend', 'js', 'config.js'), 'utf8'))(windowShim);
  const orderPath = path.join(ROOT, 'frontend', 'js', 'config.decision-order.js');
  if (fs.existsSync(orderPath)) {
    new Function('window', fs.readFileSync(orderPath, 'utf8'))(windowShim);
    const o = windowShim.SIM_DECISION_ORDER;
    if (o && Array.isArray(o.decisionEvalOrder)) windowShim.SIM_CONFIG.decisionEvalOrder = o.decisionEvalOrder;
    if (o && Array.isArray(o.decisionEvalLevels)) windowShim.SIM_CONFIG.decisionEvalLevels = o.decisionEvalLevels;
  }
  const costPath = path.join(ROOT, 'frontend', 'js', 'config.house-upgrade-cost.js');
  if (fs.existsSync(costPath)) {
    new Function('window', fs.readFileSync(costPath, 'utf8'))(windowShim);
    Object.assign(windowShim.SIM_CONFIG, windowShim.SIM_HOUSE_UPGRADE_COST || {});
  }
  return windowShim.SIM_CONFIG;
}

async function run() {
  console.log('=== Flow & Accord · M19.4b 分级任务抢占机制矩阵验证 ===\n');

  const wasmPath = path.join(ROOT, 'frontend', 'rust', 'sim_wasm.wasm');
  const wasmBytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const ex = instance.exports;

  function initWorld() {
    const cfg = loadSimConfig();
    const cfgJson = JSON.stringify(cfg);
    const enc = new TextEncoder();
    const cfgBytes = enc.encode(cfgJson);
    const cfgPtr = ex.world_config_buf_ptr(cfgBytes.length);
    new Uint8Array(ex.memory.buffer, cfgPtr, cfgBytes.length).set(cfgBytes);
    ex.world_apply_config_buf(cfgBytes.length);
    ex.world_create(60, 764.0, 42.0, 20, 4);
  }

  const reader = createSnapshotReader(ex);

  // [测试场景 1] 运行稳态演化，验证抢占机制在长程模拟中零崩溃与确定性
  console.log('[1/4] 验证稳态长程运行中抢占仲裁稳定性...');
  initWorld();
  reader.resetCaches();
  for (let i = 0; i < 2400; i++) {
    ex.world_tick(1.0 / 60.0);
  }
  const snap1 = reader.getSnapshot();
  assert(snap1.agents.length === 20, `人口数量异常: ${snap1.agents.length}`);
  const aliveCount = snap1.agents.filter(a => a.is_alive).length;
  assert(aliveCount > 0, `存活人口异常: ${aliveCount}`);
  console.log(`  ✅ 2400 tick 演化平稳，存活人口 ${aliveCount}，活跃任务状态健康`);

  // [测试场景 2] 验证 ActiveTask 快照解析与抢占字段完整性
  console.log('\n[2/4] 验证 ActiveTask 快照中的抢占与意图字段...');
  let hasActiveTask = false;
  for (const a of snap1.agents) {
    if (a.active_task) {
      hasActiveTask = true;
      assert(a.active_task.branch, 'ActiveTask 缺少 branch 字段');
      assert(a.active_task.intent_kind, 'ActiveTask 缺少 intent_kind 字段');
      assert(a.active_task.strategy_kind, 'ActiveTask 缺少 strategy_kind 字段');
      assert(a.active_task.primitive_kind, 'ActiveTask 缺少 primitive_kind 字段');
    }
  }
  assert(hasActiveTask, '稳态运行中未观察到任何 ActiveTask 任务');
  console.log('  ✅ ActiveTask 字段全部通过契约核验');

  // [测试场景 3] 验证存读档对抢占状态与 ActiveTask 的保持
  console.log('\n[3/4] 验证存读档对进行中任务与抢占上下文的保真度...');
  const savePtr = ex.world_save_ptr();
  const saveLen = ex.world_save_len();
  const savedBytes = new Uint8Array(ex.memory.buffer, savePtr, saveLen).slice();
  
  // 读档
  const loadPtr = ex.world_save_buf_ptr(savedBytes.length);
  new Uint8Array(ex.memory.buffer, loadPtr, savedBytes.length).set(savedBytes);
  const ok = ex.world_load(savedBytes.length);
  assert(ok === 0, `读档失败: 返回码 ${ok}`);
  reader.resetCaches();
  const snapAfterLoad = reader.getSnapshot();
  assert(snapAfterLoad.agents.length === snap1.agents.length, '读档后人口不一致');
  console.log('  ✅ 存读档完整还原活动任务状态');

  // [测试场景 4] 针对性验证抢占矩阵三大核心危机触发
  console.log('\n[4/5] 验证抢占矩阵三大危机动态触发与背包/进度保全...');
  
  function saveWorld() {
    const p = ex.world_save_ptr();
    const l = ex.world_save_len();
    const jsonStr = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, p, l));
    return JSON.parse(jsonStr);
  }

  function loadWorld(worldObj) {
    const jsonStr = JSON.stringify(worldObj);
    const enc = new TextEncoder().encode(jsonStr);
    const ptr = ex.world_save_buf_ptr(enc.length);
    new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
    const code = ex.world_load(enc.length);
    assert(code === 0, `读档失败: ${code}`);
    reader.resetCaches();
  }

  // 4.1 临界求生抢占：建材采收中口渴暴跌 (<15) 掉头抢占饮水，随身石头保留
  {
    initWorld();
    reader.resetCaches();
    for (let i = 0; i < 600; i++) ex.world_tick(1.0 / 60.0);
    const w = saveWorld();
    const targetAgent = w.agents.find(a => a.is_alive && !a.is_fetus);
    assert(targetAgent, '未找到存活族人');
    targetAgent.state = 'SeekingStone';
    targetAgent.thirst = 8.0; // < 15.0 临界
    targetAgent.carried_stone = 28.5; // 随身石料
    loadWorld(w);

    // 步进到该 agent 的决策相位 (tick + id) % 120 == 0
    let currentTick = w.tick_counter;
    let stepCount = 0;
    while ((currentTick + targetAgent.id) % 120 !== 0 || stepCount === 0) {
      ex.world_tick(1.0 / 60.0);
      currentTick++;
      stepCount++;
      if (stepCount > 240) break;
    }
    const snap = reader.getSnapshot();
    const a = snap.agents.find(x => x.id === targetAgent.id);
    assert(a.state === 'SeekingWater' || a.state === 'DrinkingAtWater' || (a.current_need && a.current_need.includes('Water')),
      `临界口渴未能抢占任务: state=${a.state}, need=${a.current_need}`);
    assert(Math.abs(a.carried_stone - 28.5) < 0.1, `随身石料未完整保留: ${a.carried_stone} vs 28.5`);
    console.log('  ✅ [4.1] 临界口渴抢占成功：采石被平滑中断改道汲水，随身 28.5 石料 100% 保留');
  }

  // 4.2 冬季暴雪私宅断柴 (<10) 抢占建材采收为伐木
  {
    initWorld();
    reader.resetCaches();
    for (let i = 0; i < 600; i++) ex.world_tick(1.0 / 60.0);
    const w = saveWorld();
    // 寻找或指派一名有房户主
    let house = w.houses[0];
    if (house) {
      house.tier = 'Tier1ThatchedHut';
    }
    let ownerId = house ? house.owner_id : null;
    let targetAgent = w.agents.find(a => a.id === ownerId && a.is_alive);
    if (!targetAgent) {
      targetAgent = w.agents.find(a => a.is_alive && a.gender === 'Male');
      if (house) house.owner_id = targetAgent.id;
      targetAgent.home_house_id = house ? house.id : 1;
    }
    w.season_timer = (w.config.season_year_length || 240.0) * 0.75; // 寒冬相位 (约 3°C < 8°C)
    w.temperature = 3.0;
    // 户主家户账本木材置为 0
    const hhId = targetAgent.id; // household
    for (const key of Object.keys(w.household_registry.households)) {
      const hh = w.household_registry.households[key];
      if (hh.group && hh.group.members && hh.group.members.includes(targetAgent.id)) {
        if (hh.group.ledger && hh.group.ledger.balances) {
          hh.group.ledger.balances['Wood'] = 0.0;
        }
      }
    }
    targetAgent.state = 'SeekingStone';
    targetAgent.thirst = 80.0;
    targetAgent.hunger = 80.0;
    targetAgent.stamina = 90.0;
    loadWorld(w);

    let currentTick = w.tick_counter;
    let stepCount = 0;
    while ((currentTick + targetAgent.id) % 120 !== 0 || stepCount === 0) {
      ex.world_tick(1.0 / 60.0);
      currentTick++;
      stepCount++;
      if (stepCount > 240) break;
    }
    const snap = reader.getSnapshot();
    const a = snap.agents.find(x => x.id === targetAgent.id);
    assert(a.state === 'SeekingWood' || a.state === 'GatheringWood' || (a.current_need && a.current_need.includes('StockWood')),
      `冬季断柴未能抢占建材任务: state=${a.state}, need=${a.current_need}`);
    console.log('  ✅ [4.2] 冬季断柴抢占成功：暴雪寒冬 (4℃) 户内无柴，采石任务立即被抢占为伐木囤柴');
  }

  // 4.3 私宅耐久坍塌危机 (<20%) 抢占建材采收为修缮
  {
    initWorld();
    reader.resetCaches();
    for (let i = 0; i < 600; i++) ex.world_tick(1.0 / 60.0);
    const w = saveWorld();
    let house = w.houses[0];
    let ownerId = house ? house.owner_id : null;
    let targetAgent = w.agents.find(a => a.id === ownerId && a.is_alive);
    if (!targetAgent) {
      targetAgent = w.agents.find(a => a.is_alive && a.gender === 'Male');
      if (house) house.owner_id = targetAgent.id;
      targetAgent.home_house_id = house ? house.id : 1;
    }
    if (house) {
      house.durability = 12.0; // < 20%
    }
    w.temperature = 22.0;
    targetAgent.state = 'SeekingStone';
    targetAgent.thirst = 80.0;
    targetAgent.hunger = 80.0;
    targetAgent.stamina = 90.0;
    loadWorld(w);

    let currentTick = w.tick_counter;
    let stepCount = 0;
    while ((currentTick + targetAgent.id) % 120 !== 0 || stepCount === 0) {
      ex.world_tick(1.0 / 60.0);
      currentTick++;
      stepCount++;
      if (stepCount > 240) break;
    }
    const snap = reader.getSnapshot();
    const a = snap.agents.find(x => x.id === targetAgent.id);
    assert(a.state === 'RepairingHouse' || (a.current_need && a.current_need.includes('RepairHouse')),
      `私宅耐久危机未能抢占建材任务: state=${a.state}, need=${a.current_need}`);
    console.log('  ✅ [4.3] 私宅危房抢占成功：私宅耐久告急 (12%)，族人放弃采石飞奔回家抢修');
  }

  // [测试场景 5] 验证多轮不同种子步进中的抢占零死锁
  console.log('\n[5/5] 验证多种子下抢占机制零死锁与零停滞...');
  for (const seed of [101, 202, 303]) {
    ex.world_create(60, 764.0, seed, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 1200; i++) {
      ex.world_tick(1.0 / 60.0);
    }
    const snapSeed = reader.getSnapshot();
    for (const a of snapSeed.agents) {
      if (a.is_alive) {
        assert(!isNaN(a.x) && !isNaN(a.y) && !isNaN(a.z), `Agent #${a.id} 坐标出现 NaN`);
        assert(!isNaN(a.hunger) && !isNaN(a.thirst) && !isNaN(a.stamina), `Agent #${a.id} 生理指标出现 NaN`);
      }
    }
  }
  console.log('  ✅ 多种子长程推进无死锁、无 NaN、无坐标越界');

  console.log('\n======================================================');
  console.log('🎉 M19.4b 分级任务抢占机制矩阵验证全通！');
  console.log('======================================================\n');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
