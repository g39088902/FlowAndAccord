#!/usr/bin/env node
// === Flow & Accord · 增强型确定性与不变量矩阵测试套件 (tools/test-determinism.js) ===
// 严苛验证 Rust 确定性内核在不同调用路径、分批步长、快照采样与存读档下的数学一致性。
// 运行：node tools/test-determinism.js

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const wasmPath = path.join(ROOT, 'frontend', 'rust', 'sim_wasm.wasm');
// ★ T1：统一走 tools/snapshot-reader.js（FABS 二进制优先，JSON 仅调试回退）
const { createSnapshotReader } = require('./snapshot-reader.js');

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

async function createInstance() {
  if (!fs.existsSync(wasmPath)) throw new Error('WASM 文件未找到: ' + wasmPath);
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;

  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();

  function applyConfig(cfg) {
    const encoded = textEncoder.encode(JSON.stringify(cfg));
    const ptr = ex.world_config_buf_ptr(encoded.length);
    new Uint8Array(ex.memory.buffer, ptr, encoded.length).set(encoded);
    const res = ex.world_apply_config_buf(encoded.length);
    if (res !== 0) throw new Error('applyConfig 失败，错误码: ' + res);
  }

  // ★ T1：快照取值统一由通用读取器提供（FABS 二进制解码；getSnapshotString 恒取全量帧，
  //       保证「取快照历史」不影响字符串内容，Suite 4 才不会假阳性分叉）
  const reader = createSnapshotReader(ex);

  function getSnapshotString() {
    return reader.getSnapshotString();
  }

  function getSnapshot() {
    return reader.getSnapshot();
  }

  function saveToString() {
    const ptr = ex.world_save_ptr();
    const len = ex.world_save_len();
    if (!len) throw new Error('world_save 失败');
    return textDecoder.decode(new Uint8Array(ex.memory.buffer, ptr, len));
  }

  function loadFromString(json) {
    const encoded = textEncoder.encode(json);
    const ptr = ex.world_save_buf_ptr(encoded.length);
    new Uint8Array(ex.memory.buffer, ptr, encoded.length).set(encoded);
    const res = ex.world_load(encoded.length);
    if (res !== 0) throw new Error('world_load 失败: ' + res);
    // 读档后引擎（含字符串驻留表）整体重建 → 解码器缓存必须清空，否则 strid 串味
    reader.resetCaches();
  }

  function worldCreate(gridRes, worldSize, seed, agentCount, campCount, config) {
    if (config) applyConfig(config);
    return ex.world_create(gridRes, worldSize, seed, agentCount, campCount);
  }

  return { ex, applyConfig, worldCreate, getSnapshotString, getSnapshot, saveToString, loadFromString };
}

(async () => {
  console.log('=== Flow & Accord · 增强型确定性与不变量矩阵测试 ===\n');
  const simConfig = loadSimConfig();
  const dt = 1.0 / 60.0;
  let passCount = 0;
  const totalSuites = 6;

  // ─────────────────────────────────────────────────────────────
  // Suite 1: 多随机种子重放一致性 (Multi-Seed Replay Invariance)
  // ─────────────────────────────────────────────────────────────
  process.stdout.write('[Suite 1/6] 多随机种子独立重放一致性测试 (5 种子)... ');
  const seeds = [42, 101, 777, 2026, 31415];
  for (const seed of seeds) {
    const runA = await createInstance();
    runA.worldCreate(120, 764.0, seed, 20, simConfig.countCamps, simConfig);
    runA.ex.world_tick_steps(600, dt);
    const snapA = runA.getSnapshotString();

    const runB = await createInstance();
    runB.worldCreate(120, 764.0, seed, 20, simConfig.countCamps, simConfig);
    runB.ex.world_tick_steps(600, dt);
    const snapB = runB.getSnapshotString();

    if (snapA !== snapB) {
      throw new Error(`Suite 1 失败: 种子 ${seed} 两次独立运行快照产生分叉！`);
    }
  }
  console.log('✅ PASS (5/5 种子重放逐字节一致)');
  passCount++;

  // ─────────────────────────────────────────────────────────────
  // Suite 2: 步长分批推进独立性 (Batch Step Size Invariance)
  // 验证: 600 单步 vs 60*10 步 vs 6*100 步 vs 1*600 步 最终状态完全相同
  // ─────────────────────────────────────────────────────────────
  process.stdout.write('[Suite 2/6] 步长分批推进独立性 (1步 vs 10步 vs 100步 vs 600步批次)... ');
  const batchSeed = 8888;
  // A: 1 步 * 600
  const instA = await createInstance();
  instA.worldCreate(120, 764.0, batchSeed, 20, simConfig.countCamps, simConfig);
  for (let i = 0; i < 600; i++) instA.ex.world_tick(dt);
  const snapBatch1 = instA.getSnapshotString();

  // B: 10 步 * 60
  const instB = await createInstance();
  instB.worldCreate(120, 764.0, batchSeed, 20, simConfig.countCamps, simConfig);
  for (let i = 0; i < 60; i++) instB.ex.world_tick_steps(10, dt);
  const snapBatch10 = instB.getSnapshotString();

  // C: 100 步 * 6
  const instC = await createInstance();
  instC.worldCreate(120, 764.0, batchSeed, 20, simConfig.countCamps, simConfig);
  for (let i = 0; i < 6; i++) instC.ex.world_tick_steps(100, dt);
  const snapBatch100 = instC.getSnapshotString();

  // D: 600 步 * 1
  const instD = await createInstance();
  instD.worldCreate(120, 764.0, batchSeed, 20, simConfig.countCamps, simConfig);
  instD.ex.world_tick_steps(600, dt);
  const snapBatch600 = instD.getSnapshotString();

  if (snapBatch1 !== snapBatch10) throw new Error('Suite 2 失败: 单步推进与 10 步分批结果不一致！');
  if (snapBatch10 !== snapBatch100) throw new Error('Suite 2 失败: 10 步分批与 100 步分批结果不一致！');
  if (snapBatch100 !== snapBatch600) throw new Error('Suite 2 失败: 100 步分批与 600 步单批结果不一致！');
  console.log('✅ PASS (四种批次颗粒度快照逐字节一致)');
  passCount++;

  // ─────────────────────────────────────────────────────────────
  // Suite 3: 子阶段步进等价性 (Subphase Stepping Equivalence)
  // 验证: world_tick(dt) 与 world_tick_subphase(0..8, dt) 逻辑完全等价
  // ─────────────────────────────────────────────────────────────
  process.stdout.write('[Suite 3/6] 子阶段步进与标准步进等价性验证... ');
  const subphaseSeed = 9999;
  const instMono = await createInstance();
  instMono.worldCreate(120, 764.0, subphaseSeed, 20, simConfig.countCamps, simConfig);
  instMono.ex.world_tick_steps(300, dt);
  const snapMono = instMono.getSnapshotString();

  const instSub = await createInstance();
  instSub.worldCreate(120, 764.0, subphaseSeed, 20, simConfig.countCamps, simConfig);
  for (let t = 0; t < 300; t++) {
    for (let p = 0; p <= 8; p++) {
      instSub.ex.world_tick_subphase(p, dt);
    }
  }
  const snapSub = instSub.getSnapshotString();

  if (snapMono !== snapSub) {
    throw new Error('Suite 3 失败: 子阶段循环步进与整步步进结果分叉！');
  }
  console.log('✅ PASS (子阶段拆分 100% 保持确定性与状态等价)');
  passCount++;

  // ─────────────────────────────────────────────────────────────
  // Suite 4: 快照提取无副作用性 (Snapshot Non-interference)
  // 验证: 中途频繁提取快照不影响 RNG 序列与物理演化
  // ─────────────────────────────────────────────────────────────
  process.stdout.write('[Suite 4/6] 中途高频提取快照无副作用性 (Zero Side-Effects)... ');
  const sideEffectSeed = 54321;
  // 路径 A: 创世拉取地形快照后，每 20 tick 提取一次快照
  const instA4 = await createInstance();
  instA4.worldCreate(120, 764.0, sideEffectSeed, 20, simConfig.countCamps, simConfig);
  instA4.getSnapshot(); // 模拟生产环境 tick 0 提取创世快照（消费一次性静态地形数据）
  for (let i = 0; i < 30; i++) {
    instA4.ex.world_tick_steps(20, dt);
    instA4.getSnapshot(); // 中途高频提取并解析
  }
  const snapInterleaved = instA4.getSnapshotString();

  // 路径 B: 创世拉取地形快照后，一口气连续跑完 600 tick 不提取任何中间快照
  const instB4 = await createInstance();
  instB4.worldCreate(120, 764.0, sideEffectSeed, 20, simConfig.countCamps, simConfig);
  instB4.getSnapshot(); // 模拟生产环境 tick 0 提取创世快照
  instB4.ex.world_tick_steps(600, dt);
  const snapDirect = instB4.getSnapshotString();

  if (snapInterleaved !== snapDirect) {
    throw new Error('Suite 4 失败: 中途提取快照改变了模拟演进状态（存在副作用/漏消耗RNG）！');
  }
  console.log('✅ PASS (快照生成完全只读、无状态污染)');
  passCount++;

  // ─────────────────────────────────────────────────────────────
  // Suite 5: 多切片存读档连续性 (Multi-slice Save/Load Consistency)
  // ─────────────────────────────────────────────────────────────
  process.stdout.write('[Suite 5/6] 多时间切片存读档连续性验证 (多点倒流重放)... ');
  const slSeed = 12345;
  const instSL = await createInstance();
  instSL.worldCreate(120, 764.0, slSeed, 20, simConfig.countCamps, simConfig);

  // 推进到 300 并保存
  instSL.ex.world_tick_steps(300, dt);
  const save300 = instSL.saveToString();

  // 推进到 600 并保存
  instSL.ex.world_tick_steps(300, dt);
  const save600 = instSL.saveToString();

  // 推进到 900 保存
  instSL.ex.world_tick_steps(300, dt);
  const snapTarget900 = instSL.getSnapshotString();

  // 验证 1: 从 600 载入并推进 300 步
  instSL.loadFromString(save600);
  instSL.ex.world_tick_steps(300, dt);
  const snapFrom600 = instSL.getSnapshotString();
  if (snapFrom600 !== snapTarget900) {
    throw new Error('Suite 5 失败: 从 tick 600 存档续演到 tick 900 与连续运行分叉！');
  }

  // 验证 2: 从 300 载入并推进 600 步
  instSL.loadFromString(save300);
  instSL.ex.world_tick_steps(600, dt);
  const snapFrom300 = instSL.getSnapshotString();
  if (snapFrom300 !== snapTarget900) {
    throw new Error('Suite 5 失败: 从 tick 300 存档续演到 tick 900 与连续运行分叉！');
  }
  console.log('✅ PASS (多检查点倒流续演 100% 逐字节吻合)');
  passCount++;

  // ─────────────────────────────────────────────────────────────
  // Suite 6: 多初始人口规模数值鲁棒性与确定性 (Population Invariance)
  // ─────────────────────────────────────────────────────────────
  process.stdout.write('[Suite 6/6] 多人口规模数值稳定性与确定性 (10 / 20 / 50 人口)... ');
  const popSeed = 76543;
  for (const pop of [10, 20, 50]) {
    const instPopA = await createInstance();
    instPopA.worldCreate(120, 764.0, popSeed, pop, simConfig.countCamps, simConfig);
    instPopA.ex.world_tick_steps(1200, dt);
    const snapPopAStr = instPopA.getSnapshotString();
    const snapPopA = JSON.parse(snapPopAStr);

    // 校验无 NaN / 无越界
    for (const a of snapPopA.agents) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z)) {
        throw new Error(`Suite 6 失败: 人口 ${pop} 出现 NaN 坐标！agent=${a.id}`);
      }
      if (Math.abs(a.x) > 450 || Math.abs(a.y) > 450) {
        throw new Error(`Suite 6 失败: 人口 ${pop} 出现越界坐标！agent=${a.id} pos=(${a.x}, ${a.y})`);
      }
    }

    // 重跑一次核对确定性
    const instPopB = await createInstance();
    instPopB.worldCreate(120, 764.0, popSeed, pop, simConfig.countCamps, simConfig);
    instPopB.ex.world_tick_steps(1200, dt);
    const snapPopBStr = instPopB.getSnapshotString();
    if (snapPopAStr !== snapPopBStr) {
      throw new Error(`Suite 6 失败: 人口 ${pop} 重放确定性分叉！`);
    }
  }
  console.log('✅ PASS (各人口规模长程运行无 NaN、无越界且绝对确定)');
  passCount++;

  console.log(`\n======================================================`);
  console.log(`🎉 确定性矩阵测试全通！通过套件: ${passCount}/${totalSuites}`);
  console.log(`======================================================`);
})().catch(e => {
  console.error('\n❌ DETERMINISM TEST FAILED:', e);
  process.exit(1);
});
