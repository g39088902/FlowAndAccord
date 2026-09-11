#!/usr/bin/env node
/*
 * Flow & Accord · M19.4d 多品类采收候选预排队列与行程优化验证 (test-itinerary.js)
 * ============================================================================
 * 验证目标（M19.4d Harvest Itinerary Planning & Route Optimization）：
 *   1. 多品类短缺下的预排行程链路生成 (TSP Heuristic Itinerary Chain):
 *      - 家户存在多种物资缺口时，策略规划器预排多品类连续采收链路；
 *      - ActiveTaskSnapshot 透出清晰的 `itinerary` 字符串 (如 "💧备水 → 🍒备粮 → 🌲备木")。
 *   2. TSP 最近邻贪心链路排序 (Nearest Neighbor Proximity Ordering):
 *      - 从出发点/当前位置出发，贪心选择空间最近的短缺 POI 作为下一跳。
 *   3. 连续采收多站顺路推进 (Multi-stop Continuous Harvest Execution):
 *      - 在前一站点采收完毕后，优先消费预排候选队列，平滑转入下一站点。
 *   4. 异常中断与危机关头清空队列 (Queue Invalidation & Safety Return):
 *      - 当体力告警 (< work_stamina_threshold) 时，预排队列平滑清空并返家休整。
 *   5. 多随机种子长程确定性与数值安全 (零 NaN / 零越界 / 逐字节重放吻合)。
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
  console.log('=== Flow & Accord · M19.4d 多品类采收候选预排队列与行程优化验证 ===\n');

  const wasmPath = path.join(ROOT, 'frontend', 'rust', 'sim_wasm.wasm');
  const wasmBytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const ex = instance.exports;
  const cfg = loadSimConfig();
  const reader = createSnapshotReader(ex);

  /** 单类资源随身行囊容量（水/粮/木/石 互不共享）：判定“行囊已装满”的权威阈值 */
  const CARRY_CAP = cfg.carryCapacityResource;

  function applyConfig() {
    const cfgJson = JSON.stringify(cfg);
    const enc = new TextEncoder();
    const cfgBytes = enc.encode(cfgJson);
    const cfgPtr = ex.world_config_buf_ptr(cfgBytes.length);
    new Uint8Array(ex.memory.buffer, cfgPtr, cfgBytes.length).set(cfgBytes);
    ex.world_apply_config_buf(cfgBytes.length);
  }

  function getSaveState() {
    const ptr = ex.world_save_ptr();
    const len = ex.world_save_len();
    const copy = new Uint8Array(len);
    copy.set(new Uint8Array(ex.memory.buffer, ptr, len));
    return JSON.parse(new TextDecoder('utf-8').decode(copy));
  }

  function restoreSaveState(saveState) {
    const jsonStr = JSON.stringify(saveState);
    const enc = new TextEncoder();
    const bytes = enc.encode(jsonStr);
    const ptr = ex.world_save_buf_ptr(bytes.length);
    new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
    const ret = ex.world_load(bytes.length);
    assert(ret === 0, `读档失败，错误码: ${ret}`);
    reader.resetCaches();
  }

  /** 设置标准测试族人：有房、已婚、户主、高体力、不触发市场/求偶/竞拍 */
  function setupTestMale(save) {
    const h = save.houses[0];
    assert(h, '需有房屋实体');
    const male = save.agents.find(a => a.gender === 'Male' && a.is_alive && !a.is_fetus);
    assert(male, '未找到在世男性族人');
    male.home_house_id = h.id;
    h.owner_id = male.id;
    male.spouse_id = 99999; // 已婚，不触发求偶
    const hhId = save.household_registry.by_agent[male.id];
    assert(hhId, '未入籍家户');
    const hh = save.household_registry.households[hhId];
    hh.group.leader = male.id;
    male.is_household_head = true;
    male.carried_water = 0.0;
    male.carried_food = 0.0;
    male.carried_wood = 0.0;
    male.carried_stone = 0.0;
    male.carried_gold = 0.0;
    male.thirst = 90.0;
    male.hunger = 90.0;
    male.stamina = 95.0;
    male.current_lane_id = null;
    male.harvest_queue = [null, null, null, null];
    return { male, h, hh };
  }

  /**
   * 推进至下一个决策相位并执行该相位的 world_tick。
   * 内核语义：world_tick 处理当前 tick_counter，然后 tick_counter += 1。
   * 决策在 (tick_counter + agent.id) % 120 == 0 的帧上触发。
   * 返回执行完毕后的 tick_counter 值。
   */
  function advanceToDecision(tickCounter, agentId) {
    let tick = tickCounter;
    for (let i = 0; i < 240; i++) {
      const willDecide = (tick + agentId) % 120 === 0;
      ex.world_tick(1.0 / 60.0);
      tick++;
      if (willDecide) return tick;
    }
    throw new Error('240 ticks 内未命中决策相位');
  }

  applyConfig();

  // ==========================================================================
  // [1/5] 多品类短缺下的预排行程链路生成
  // ==========================================================================
  console.log('[1/5] 验证多品类短缺下的预排行程链路生成 (Itinerary Chain Planning)...');
  {
    ex.world_create(0, 764.0, 42.0, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 1800; i++) ex.world_tick(1.0 / 60.0);

    const save = getSaveState();
    const { male, h, hh } = setupTestMale(save);

    // 水、粮、木三重短缺；石/金充沛但低于豪绅阈值 (200)
    // ★ 关键：用完整对象替换 balances，防止未设品类余额为 0 触发施密特
    hh.group.ledger.balances = { Water: 0, Food: 0, Wood: 0, Stone: 250, Gold: 150 };
    male.family_stock_active = [true, true, true, false, false];

    male.state = 'RestingAtCamp';
    male.world_pos = { x: h.pos.x, y: h.pos.y, z: h.pos.z };

    restoreSaveState(save);
    advanceToDecision(save.tick_counter, male.id);

    const snap = reader.getSnapshot();
    const a = snap.agents.find(ag => ag.id === male.id);
    assert(a.active_task, '族人出发采收时未安装 ActiveTask');
    console.log(`  🗺️ 族人出发采收: 意图 = ${a.active_task.branch}, 预排行程 = "${a.active_task.itinerary}"`);
    assert(
      a.active_task.itinerary && a.active_task.itinerary.includes('→'),
      `预排行程未形成多站链路: "${a.active_task.itinerary}"`
    );
    // 行程仅含水/粮/木三类，不含石/金
    assert(!a.active_task.itinerary.includes('🪨'), '行程不应含充沛品类 (石)');
    assert(!a.active_task.itinerary.includes('🪙'), '行程不应含充沛品类 (金)');
    console.log('  ✅ [1/5] 多品类短缺行程预排链路生成验证通过');
  }

  // ==========================================================================
  // [2/5] TSP 最近邻贪心链路排序验证
  // ==========================================================================
  console.log('\n[2/5] 验证 TSP 最近邻贪心链路排序 (Nearest Neighbor Ordering)...');
  {
    ex.world_create(0, 764.0, 42.0, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 1800; i++) ex.world_tick(1.0 / 60.0);

    const save = getSaveState();
    const { male, h, hh } = setupTestMale(save);

    // ★ 精确控制：仅粮、木短缺；水/石/金充沛且低于豪绅阈值
    hh.group.ledger.balances = { Water: 250, Food: 0, Wood: 0, Stone: 250, Gold: 150 };
    male.family_stock_active = [false, true, true, false, false];

    // 从 Water 15 处出发 (Berry 81.6m < Wood 163.0m → 应先选 Food)
    const water15 = save.pois.find(p => p.id === 15);
    male.world_pos = { x: water15.pos.x, y: water15.pos.y, z: water15.pos.z };
    male.state = 'DrinkingAtWater';
    male.carried_water = CARRY_CAP; // 水已装满，触发 finished → try_continue_harvesting

    restoreSaveState(save);
    advanceToDecision(save.tick_counter, male.id);

    const snap = reader.getSnapshot();
    const a = snap.agents.find(ag => ag.id === male.id);
    console.log(`  🍒 从 Water 15 出发: branch = ${a.active_task ? a.active_task.branch : '无'}, state = ${a.state}`);
    assert(
      a.state === 'SeekingFood' || (a.active_task && a.active_task.branch === 'b6'),
      `从 Water 15 出发（Berry 更近）应优先选 b6 备粮: state=${a.state}, branch=${a.active_task ? a.active_task.branch : '无'}`
    );
    console.log('  ✅ [2/5] TSP 最近邻贪心链路排序验证通过');
  }

  // ==========================================================================
  // [3/5] 连续采收多站顺路推进验证
  // ==========================================================================
  console.log('\n[3/5] 验证连续采收多站顺路推进 (Multi-stop Continuous Harvest)...');
  {
    ex.world_create(0, 764.0, 42.0, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 1800; i++) ex.world_tick(1.0 / 60.0);

    const save = getSaveState();
    const { male, h, hh } = setupTestMale(save);

    // 水、粮短缺
    hh.group.ledger.balances = { Water: 0, Food: 0, Wood: 250, Stone: 250, Gold: 150 };
    male.family_stock_active = [true, true, false, false, false];

    // 预排队列手动注入 B6StockFood，模拟上一站水采完后队列中持有粮食
    male.harvest_queue = ['B6StockFood', null, null, null];
    male.carried_water = CARRY_CAP; // 水已装满（容量阈值按配置，触发 finished）
    male.state = 'DrinkingAtWater'; // 在清泉现场完成采水

    // 放在一个水源 POI 附近
    const water10 = save.pois.find(p => p.id === 10);
    male.world_pos = { x: water10.pos.x, y: water10.pos.y, z: water10.pos.z };

    restoreSaveState(save);
    advanceToDecision(save.tick_counter, male.id);

    const snap = reader.getSnapshot();
    const a = snap.agents.find(ag => ag.id === male.id);
    console.log(`  🎒 水满现场转站: 状态 = ${a.state}, branch = ${a.active_task ? a.active_task.branch : '无'}`);
    assert(
      a.state === 'SeekingFood' || (a.active_task && a.active_task.branch === 'b6'),
      `水满后族人未顺路转往预排下一站(粮食): state=${a.state}, branch=${a.active_task ? a.active_task.branch : '无'}`
    );
    console.log('  ✅ [3/5] 连续采收多站顺路推进验证通过');
  }

  // ==========================================================================
  // [4/5] 异常中断与体力告警清空队列验证
  // ==========================================================================
  console.log('\n[4/5] 验证异常中断与体力告警清空队列 (Queue Invalidation & Safety Return)...');
  {
    ex.world_create(0, 764.0, 42.0, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 1800; i++) ex.world_tick(1.0 / 60.0);

    const save = getSaveState();
    const { male, h, hh } = setupTestMale(save);

    hh.group.ledger.balances = { Water: 0, Food: 0, Wood: 250, Stone: 250, Gold: 150 };
    male.family_stock_active = [true, true, false, false, false];

    male.harvest_queue = ['B6StockFood', 'B7StockWood', null, null];
    male.stamina = 15.0; // 体力告警 (低于工作门槛 30.0)
    male.state = 'DrinkingAtWater';
    male.carried_water = CARRY_CAP;

    const water10 = save.pois.find(p => p.id === 10);
    male.world_pos = { x: water10.pos.x, y: water10.pos.y, z: water10.pos.z };

    restoreSaveState(save);
    advanceToDecision(save.tick_counter, male.id);

    const snap = reader.getSnapshot();
    const a = snap.agents.find(ag => ag.id === male.id);
    console.log(`  💤 体力耗尽 (15%): 状态 = ${a.state}, 主导需求 = "${a.current_need || '无'}"`);
    assert(
      a.state === 'ReturningToCamp' || a.state === 'RestingAtCamp' || (a.current_need && a.current_need.includes('Rest')),
      `体力告警时未安全折返回家: state=${a.state}`
    );
    // 存读档核验 harvest_queue 已清空
    const postSave = getSaveState();
    const postMale = postSave.agents.find(ag => ag.id === male.id);
    assert(
      postMale.harvest_queue.every(s => s === null),
      '返家后 harvest_queue 未能安全清空'
    );
    console.log('  ✅ [4/5] 异常中断与体力告警清空队列验证通过');
  }

  // ==========================================================================
  // [5/5] 多随机种子长程确定性与数值稳定性验证
  // ==========================================================================
  console.log('\n[5/5] 验证多随机种子长程确定性矩阵与数值稳定性...');
  const seeds = [101, 202, 303];
  for (const s of seeds) {
    ex.world_create(0, 764.0, s, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 600; i++) ex.world_tick(1.0 / 60.0);
    const snap1 = reader.getSnapshot();
    const savePtr1 = ex.world_save_ptr();
    const saveLen1 = ex.world_save_len();
    const saveCopy1 = new Uint8Array(saveLen1);
    saveCopy1.set(new Uint8Array(ex.memory.buffer, savePtr1, saveLen1));
    const hash1 = crypto.createHash('sha256').update(saveCopy1).digest('hex');

    for (const a of snap1.agents) {
      assert(!Number.isNaN(a.x) && !Number.isNaN(a.y) && !Number.isNaN(a.z), `Seed ${s} Agent ${a.id} 出现 NaN 坐标`);
      assert(!Number.isNaN(a.hunger) && !Number.isNaN(a.thirst) && !Number.isNaN(a.stamina), `Seed ${s} Agent ${a.id} 生理指标出现 NaN`);
      assert(a.x >= -500 && a.x <= 500 && a.y >= -500 && a.y <= 500, `Seed ${s} Agent ${a.id} 坐标严重越界: (${a.x}, ${a.y})`);
    }

    ex.world_create(0, 764.0, s, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 600; i++) ex.world_tick(1.0 / 60.0);
    const savePtr2 = ex.world_save_ptr();
    const saveLen2 = ex.world_save_len();
    const saveCopy2 = new Uint8Array(saveLen2);
    saveCopy2.set(new Uint8Array(ex.memory.buffer, savePtr2, saveLen2));
    const hash2 = crypto.createHash('sha256').update(saveCopy2).digest('hex');

    assert(hash1 === hash2, `Seed ${s} 确定性重放失败: ${hash1} !== ${hash2}`);
    console.log(`  ✅ Seed ${s}: 600 tick 推进正常 (人口 ${snap1.agents.length}, 0 NaN, 0 越界, 重放哈希逐字节一致)`);
  }

  console.log('\n======================================================');
  console.log('🎉 M19.4d 多品类采收候选预排队列与行程优化验证全通！');
  console.log('======================================================\n');
}

run().catch(err => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
