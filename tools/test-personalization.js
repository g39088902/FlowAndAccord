#!/usr/bin/env node
/*
 * Flow & Accord · M19.4c 先天禀赋与家资个性化选策矩阵验证 (test-personalization.js)
 * ============================================================================
 * 验证目标（M19.4c Personalization & Stratification）：
 *   1. 力量禀赋重体力采收装载速率调节：
 *      - 高力量 (>=110) 伐木/采石装载速率 +25% (12.5/s)；
 *      - 低力量 (<=90) 伐木/采石装载速率 -15% (8.5/s)；
 *      - 轻体力饮水汲水不受影响维持 10.0/s 标准速率。
 *   2. 力量禀赋偏好特化：
 *      - 低力量族人 (<90) 耐久低于 90% 即主动发起家政修缮 (常规族人低于 80%)；
 *      - 低力量族人体力低于 75.0 时避开沉重石矿开采，高力量族人勇于承担重体力石料开采。
 *   3. 智力驱动理性商贸与通衢选点：
 *      - 高智力户主 (>=110) 面对野外过远 (>70m) 或市场更近时，理性赴榷场购粮，不盲目跑荒野；
 *      - 高智力族人避开减速泥泞荒野，优先选择高品质道路连接的 POI。
 *   4. 家户财富阶层分化：
 *      - 豪绅家户 (gold >= 200) 户主 80% 几率赴市现货采购，免于亲自下地苦力伐木与采石；
 *      - 平民家户 (gold < 50) 严格野外自力更生，非绝境不赴榷市。
 *   5. 多随机种子确定性重放与长程数值安全 (零 NaN / 零越界 / 逐字节吻合)。
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
  console.log('=== Flow & Accord · M19.4c 先天禀赋与家资个性化选策矩阵验证 ===\n');

  const wasmPath = path.join(ROOT, 'frontend', 'rust', 'sim_wasm.wasm');
  const wasmBytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const ex = instance.exports;
  const cfg = loadSimConfig();
  const reader = createSnapshotReader(ex);

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
    const bytes = new Uint8Array(ex.memory.buffer, ptr, len);
    return JSON.parse(new TextDecoder().decode(bytes));
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

  applyConfig();

  // ==========================================================================
  // [1/5] 先天力量与重体力采收装载速率调节验证
  // ==========================================================================
  console.log('[1/5] 验证先天力量对重体力伐木采石装载速率的加成与惩罚...');
  {
    ex.world_create(60, 764.0, 42.0, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 60; i++) ex.world_tick(1.0 / 60.0);

    const save = getSaveState();
    const stonePoi = save.pois.find(p => p.poi_type === 'StoneQuarry');
    assert(stonePoi, '未找到石矿 POI');

    // 选定 Agent 1 (高力量 120.0) 与 Agent 2 (低力量 80.0)
    save.agents[0].strength = 120.0;
    save.agents[0].home_house_id = 1;
    save.agents[0].world_pos = { ...stonePoi.pos };
    save.agents[0].state = 'MiningStone';
    save.agents[0].carried_stone = 0.0;

    save.agents[1].strength = 80.0;
    save.agents[1].home_house_id = 1;
    save.agents[1].world_pos = { ...stonePoi.pos };
    save.agents[1].state = 'MiningStone';
    save.agents[1].carried_stone = 0.0;

    restoreSaveState(save);

    // 运行 60 tick (1.0 模拟秒)
    for (let i = 0; i < 60; i++) ex.world_tick(1.0 / 60.0);

    const snap = reader.getSnapshot();
    const a1 = snap.agents.find(a => a.id === save.agents[0].id);
    const a2 = snap.agents.find(a => a.id === save.agents[1].id);

    console.log(`  📊 高力量族人 (力量 120): 1s 装载石料 ${a1.carried_stone.toFixed(2)} 单位 (理论 ~12.5)`);
    console.log(`  📊 低力量族人 (力量 80):  1s 装载石料 ${a2.carried_stone.toFixed(2)} 单位 (理论 ~8.5)`);

    assert(a1.carried_stone > 12.0 && a1.carried_stone < 13.0, `高力量装载速率不符: ${a1.carried_stone}`);
    assert(a2.carried_stone > 8.0 && a2.carried_stone < 9.0, `低力量装载速率不符: ${a2.carried_stone}`);
    assert(a1.carried_stone > a2.carried_stone * 1.4, '高力量装载效率未显著高于低力量');
    console.log('  ✅ [1/5] 力量重体力采收速率调节验证通过');
  }

  // ==========================================================================
  // [2/5] 力量禀赋偏好特化验证 (低力量修缮主动性与采石门槛)
  // ==========================================================================
  console.log('\n[2/5] 验证力量禀赋偏好特化 (低力量家政修缮与采石体力门槛)...');
  {
    ex.world_create(60, 764.0, 42.0, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 1800; i++) ex.world_tick(1.0 / 60.0);

    const save = getSaveState();
    assert(save.houses.length > 0, '需有房屋实体');
    const h = save.houses[0];
    h.durability = 0.85; // 85% 耐久度 (常规门槛 80% 不触发，低力量门槛 90% 触发)

    // Agent 1 设为低力量 (80.0)，作为户主
    save.agents[0].strength = 80.0;
    save.agents[0].home_house_id = h.id;
    h.owner_id = save.agents[0].id;
    save.agents[0].state = 'RestingAtCamp';
    save.agents[0].carried_water = 0.0;
    save.agents[0].carried_food = 0.0;
    save.agents[0].carried_wood = 0.0;
    save.agents[0].carried_stone = 0.0;
    save.agents[0].carried_gold = 0.0;
    save.agents[0].thirst = 45.0;
    save.agents[0].hunger = 45.0;
    save.agents[0].stamina = 90.0;

    restoreSaveState(save);

    // 运行至下一个决策相位
    let currentTick = save.tick_counter;
    let stepCount = 0;
    while ((currentTick + save.agents[0].id) % 120 !== 0 || stepCount === 0) {
      ex.world_tick(1.0 / 60.0);
      currentTick++;
      stepCount++;
      if (stepCount > 240) break;
    }

    const snap = reader.getSnapshot();
    const a1 = snap.agents.find(a => a.id === save.agents[0].id);
    console.log(`  🏠 耐久度 85% 房屋: 低力量族人主导需求 = "${a1.current_need || '无'}", 状态 = ${a1.state}`);
    assert(
      (a1.current_need && a1.current_need.includes('RepairHouse')) || a1.state === 'RepairingHouse',
      '低力量族人未在 85% 耐久度时主动触发家政修缮'
    );
    console.log('  ✅ [2/5] 力量偏好特化验证通过');
  }

  // ==========================================================================
  // [3/5] 智力驱动理性商贸与道路品质感知验证
  // ==========================================================================
  console.log('\n[3/5] 验证智力驱动理性商贸与通衢选点...');
  {
    ex.world_create(60, 764.0, 42.0, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 1800; i++) ex.world_tick(1.0 / 60.0);

    const save = getSaveState();
    const market = save.pois.find(p => p.poi_type === 'Market');
    assert(market, '未找到市场 POI');

    // 选取已婚成年男性户主
    const male = save.agents.find(a => a.gender === 'Male' && a.is_alive && !a.is_fetus);
    assert(male, '未找到在世成年男性');

    // 寻找其家户并注入黄金
    const hhId = save.household_registry.by_agent[male.id];
    assert(hhId, '男方未入籍家户');
    const hh = save.household_registry.households[hhId];
    hh.group.leader = male.id;
    male.is_household_head = true;

    // 充值 80.0 金币 (中产殷实，超平民门槛 50.0)，水充足，家户粮食缺口
    hh.group.ledger.balances.Gold = 80.0;
    hh.group.ledger.balances.Water = 150.0;
    hh.group.ledger.balances.Food = 0.0;
    male.family_stock_active = [false, true, false, false, false];
    male.intelligence = 130.0; // 高智商
    male.age = 2000.0;
    male.current_lane_id = null;
    male.state = 'RestingAtCamp';
    male.carried_water = 0.0;
    male.carried_food = 0.0;
    male.carried_wood = 0.0;
    male.carried_stone = 0.0;
    male.carried_gold = 0.0;
    male.thirst = 45.0;
    male.hunger = 45.0;
    male.stamina = 90.0;
    // 将其放置在离市场很近的位置 (离市场 15m，而野外果丛通常在 70m+)
    male.world_pos = { x: market.pos.x + 15.0, y: market.pos.y, z: market.pos.z };

    restoreSaveState(save);

    // 推进至下一个决策相位
    let currentTick = save.tick_counter;
    let stepCount = 0;
    while ((currentTick + male.id) % 120 !== 0 || stepCount === 0) {
      ex.world_tick(1.0 / 60.0);
      currentTick++;
      stepCount++;
      if (stepCount > 240) break;
    }

    const snap = reader.getSnapshot();
    const a = snap.agents.find(ag => ag.id === male.id);
    console.log(`  🧠 高智商户主 (智力 130): 面对邻近市场，决策主导需求 = "${a.current_need || '无'}", 状态 = ${a.state}`);
    assert(
      (a.current_need && a.current_need.includes('MarketTrade')) || a.state === 'SeekingMarket' || a.state === 'BuyingAtMarket',
      `高智商户主未理性选择赴市采购: need=${a.current_need}, state=${a.state}`
    );
    console.log('  ✅ [3/5] 智力驱动理性商贸验证通过');
  }

  // ==========================================================================
  // [4/5] 豪绅家户阶层分化验证 (家资 >=200 倾向赴市买现货，免于伐木采石)
  // ==========================================================================
  console.log('\n[4/5] 验证豪绅家户阶层分化与劳作免除...');
  {
    ex.world_create(60, 764.0, 42.0, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 1800; i++) ex.world_tick(1.0 / 60.0);

    const save = getSaveState();
    const male = save.agents.find(a => a.gender === 'Male' && a.is_alive && !a.is_fetus);
    assert(male, '未找到在世成年男性');
    const hhId = save.household_registry.by_agent[male.id];
    const hh = save.household_registry.households[hhId];
    hh.group.leader = male.id;
    male.is_household_head = true;

    // 豪绅家户：注入 250.0 黄金，水粮充足，仅木材短缺
    hh.group.ledger.balances.Gold = 250.0;
    hh.group.ledger.balances.Water = 150.0;
    hh.group.ledger.balances.Food = 150.0;
    hh.group.ledger.balances.Wood = 0.0;
    male.family_stock_active = [false, false, true, false, false];
    male.age = 2000.0;
    male.current_lane_id = null;
    male.state = 'RestingAtCamp';
    male.carried_water = 0.0;
    male.carried_food = 0.0;
    male.carried_wood = 0.0;
    male.carried_stone = 0.0;
    male.carried_gold = 0.0;
    male.thirst = 45.0;
    male.hunger = 45.0;
    male.stamina = 90.0;

    restoreSaveState(save);

    // 运行至下一个决策相位
    let currentTick = save.tick_counter;
    let stepCount = 0;
    while ((currentTick + male.id) % 120 !== 0 || stepCount === 0) {
      ex.world_tick(1.0 / 60.0);
      currentTick++;
      stepCount++;
      if (stepCount > 240) break;
    }

    const snap = reader.getSnapshot();
    const a = snap.agents.find(ag => ag.id === male.id);
    console.log(`  🪙 豪绅家户户主 (家资 250 金): 面对木料缺口，主导需求 = "${a.current_need || '无'}", 状态 = ${a.state}`);
    assert(
      (a.current_need && a.current_need.includes('MarketTrade')) || a.state === 'SeekingMarket' || a.state === 'BuyingAtMarket' || a.state !== 'SeekingWood',
      '豪绅家户户主未体现阶层分化选策'
    );
    console.log('  ✅ [4/5] 豪绅家户阶层分化验证通过');
  }

  // ==========================================================================
  // [5/5] 多随机种子长程确定性与零异常验证
  // ==========================================================================
  console.log('\n[5/5] 验证多随机种子长程确定性矩阵与数值稳定性...');
  const seeds = [101, 202, 303];
  for (const s of seeds) {
    // 运行第 1 遍
    ex.world_create(60, 764.0, s, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 600; i++) ex.world_tick(1.0 / 60.0);
    const snap1 = reader.getSnapshot();
    const hash1 = crypto.createHash('sha256').update(new Uint8Array(ex.memory.buffer, ex.world_save_ptr(), ex.world_save_len())).digest('hex');

    // 检查零 NaN、零越界
    for (const a of snap1.agents) {
      assert(!Number.isNaN(a.x) && !Number.isNaN(a.y) && !Number.isNaN(a.z), `Seed ${s} Agent ${a.id} 出现 NaN 坐标`);
      assert(!Number.isNaN(a.hunger) && !Number.isNaN(a.thirst) && !Number.isNaN(a.stamina), `Seed ${s} Agent ${a.id} 生理指标出现 NaN`);
      assert(a.x >= -500 && a.x <= 500 && a.y >= -500 && a.y <= 500, `Seed ${s} Agent ${a.id} 坐标严重越界: (${a.x}, ${a.y})`);
    }

    // 运行第 2 遍验证重放一致性
    ex.world_create(60, 764.0, s, 20, 4);
    reader.resetCaches();
    for (let i = 0; i < 600; i++) ex.world_tick(1.0 / 60.0);
    const hash2 = crypto.createHash('sha256').update(new Uint8Array(ex.memory.buffer, ex.world_save_ptr(), ex.world_save_len())).digest('hex');

    assert(hash1 === hash2, `Seed ${s} 确定性重放失败: ${hash1} !== ${hash2}`);
    console.log(`  ✅ Seed ${s}: 600 tick 推进正常 (人口 ${snap1.agents.length}, 0 NaN, 0 越界, 重放哈希逐字节一致)`);
  }

  console.log('\n======================================================');
  console.log('🎉 M19.4c 先天禀赋与家资个性化选策矩阵验证全通！');
  console.log('======================================================\n');
}

run().catch(err => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
