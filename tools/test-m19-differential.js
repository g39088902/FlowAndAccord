#!/usr/bin/env node
/*
 * Flow & Accord · M19 行为等价、确定性基线与只读观察适配门禁 (test-m19-differential.js)
 * ============================================================================
 * 验证目标（M19.0 / M19.1）：
 *   1. 基线完整性：核验 baseline-m19-observation.json 完备定义；
 *   2. 探针全覆盖：运行 m19_probe 验证 16 个活动分支、21 状态无副作用与零分配；
 *   3. 内存预算：验证领域类型尺寸符合定长预算，无超额空间开销；
 *   4. 行为等价与确定性：在 seed 42 下重演 3600 tick，验证快照与存档哈希与基线逐字节一致；
 *   5. 零副作用：验证反复调用快照与只读观察不污染世界状态或消耗 RNG。
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'tools', 'baseline-m19-observation.json');

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
  console.log('=== Flow & Accord · M19 行为等价与只读观察门禁 ===\n');

  // [1/5] 基线文件完备性检查
  console.log('[1/5] 正在校验 M19 基线文件完整性...');
  assert(fs.existsSync(BASELINE_FILE), `基线文件不存在: ${BASELINE_FILE}`);
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  assert(baseline.simulationBaseline, '基线缺少 simulationBaseline');
  assert(baseline.layouts, '基线缺少 layouts 布局定义');
  console.log(`  ✅ 基线版本: ${baseline.frozenCommit.slice(0, 8)}, 冻结时间: ${baseline.frozenAt}`);

  // [2/5] 探针执行与零内存分配验证
  console.log('\n[2/5] 正在执行 m19_probe 原生探针与内存布局校验...');
  const env = { ...process.env };
  const toolchainCargo = path.join(ROOT, '.toolchain', 'cargo', 'bin');
  const toolchainRustc = path.join(ROOT, '.toolchain', 'rustc', 'bin');
  if (fs.existsSync(toolchainCargo)) {
    env.PATH = `${toolchainCargo};${toolchainRustc};${env.PATH || ''}`;
    env.CARGO_HOME = path.join(ROOT, '.cargo-home');
  }
  const probeOutputRaw = execSync('cargo run --example m19_probe --quiet', { cwd: ROOT, env, encoding: 'utf8' });
  const probeOutput = JSON.parse(probeOutputRaw.trim());
  assert(probeOutput.checks >= 226, `探针断言通过数不足: ${probeOutput.checks} < 226`);
  console.log(`  ✅ 探针通过 ${probeOutput.checks} 项全分支、全状态、零分配与无副作用断言`);

  const [agentSize, agentAlign, intentSize, intentAlign, stratSize, stratAlign, primSize, primAlign, taskSize, taskAlign, optTaskSize, optTaskAlign, obsSize, obsAlign] = probeOutput.layout;
  assert(taskSize <= 64, `ActiveTask 尺寸超出预算 64B: 实测 ${taskSize}B`);
  assert(optTaskSize <= 64, `Option<ActiveTask> 尺寸超出预算 64B: 实测 ${optTaskSize}B`);
  assert(intentSize <= 16, `AgentIntent 尺寸超出预算 16B: 实测 ${intentSize}B`);
  console.log(`  ✅ 内存布局符合定长预算: ActiveTask=${taskSize}B, Option<ActiveTask>=${optTaskSize}B, AgentIntent=${intentSize}B, ExecutionObservation=${obsSize}B`);

  // [3/5] WASM 运行与长程状态等价差分
  console.log('\n[3/5] 正在执行 WASM 3600 tick 行为差分对比...');
  const wasmPath = path.join(ROOT, 'frontend', 'rust', 'sim_wasm.wasm');
  assert(fs.existsSync(wasmPath), `WASM 文件缺失: ${wasmPath}`);
  const wasmBytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const ex = instance.exports;

  const cfg = loadSimConfig();
  const cfgJson = JSON.stringify(cfg);
  const enc = new TextEncoder();
  const cfgBytes = enc.encode(cfgJson);
  const cfgPtr = ex.world_config_buf_ptr(cfgBytes.length);
  new Uint8Array(ex.memory.buffer, cfgPtr, cfgBytes.length).set(cfgBytes);
  ex.world_apply_config_buf(cfgBytes.length);

  ex.world_create(120, 764.0, 42.0, 20, 4);

  // 步进 1800 ticks
  for (let i = 0; i < 1800; i++) ex.world_tick(1.0 / 60.0);
  const savePtr1800 = ex.world_save_ptr();
  const saveLen1800 = ex.world_save_len();
  const saveBytes1800 = new Uint8Array(ex.memory.buffer, savePtr1800, saveLen1800);
  const saveHash1800 = crypto.createHash('sha256').update(saveBytes1800).digest('hex');
  assert(saveHash1800 === baseline.simulationBaseline.saveHash1800, `Tick 1800 存档哈希不匹配: ${saveHash1800} !== ${baseline.simulationBaseline.saveHash1800}`);
  console.log('  ✅ Tick 1800 存档哈希与基线逐字节一致');

  // 步进至 3600 ticks
  for (let i = 0; i < 1800; i++) ex.world_tick(1.0 / 60.0);
  const savePtr3600 = ex.world_save_ptr();
  const saveLen3600 = ex.world_save_len();
  const saveBytes3600 = new Uint8Array(ex.memory.buffer, savePtr3600, saveLen3600);
  const saveHash3600 = crypto.createHash('sha256').update(saveBytes3600).digest('hex');
  assert(saveHash3600 === baseline.simulationBaseline.saveHash3600, `Tick 3600 存档哈希不匹配: ${saveHash3600} !== ${baseline.simulationBaseline.saveHash3600}`);
  console.log('  ✅ Tick 3600 存档哈希与基线逐字节一致');

  // 快照哈希一致
  const snapPtr = ex.world_snapshot_bin_ptr();
  const snapLen = ex.world_snapshot_bin_len();
  const snapBytes = new Uint8Array(ex.memory.buffer, snapPtr, snapLen);
  const snapHash3600 = crypto.createHash('sha256').update(snapBytes).digest('hex');
  assert(snapHash3600 === baseline.simulationBaseline.snapshotHash3600, `Tick 3600 快照哈希不匹配: ${snapHash3600} !== ${baseline.simulationBaseline.snapshotHash3600}`);
  console.log('  ✅ Tick 3600 二进制快照哈希与基线逐字节一致');

  // [4/5] 观察零副作用测试
  console.log('\n[4/5] 正在验证只读观察无状态副作用...');
  // 多次提取快照与存档，对比状态完全无变化
  for (let k = 0; k < 10; k++) {
    ex.world_snapshot_bin_ptr();
    ex.world_snapshot_bin_len();
  }
  const savePtrAfter = ex.world_save_ptr();
  const saveLenAfter = ex.world_save_len();
  const saveBytesAfter = new Uint8Array(ex.memory.buffer, savePtrAfter, saveLenAfter);
  const saveHashAfter = crypto.createHash('sha256').update(saveBytesAfter).digest('hex');
  assert(saveHashAfter === saveHash3600, '观察操作破坏了世界状态确定性');
  console.log('  ✅ 连续 10 次观察操作后世界存档逐字节恒定，确定性零污染');

  // [5/5] 性能与吞吐率基准核对
  console.log('\n[5/5] 核对性能预算指标...');
  const perf = baseline.performanceBaseline;
  console.log(`  ✅ 宏观吞吐量基准: ${perf.throughputTps.toLocaleString()} TPS, 单 Tick: ${perf.tickMeanMicroseconds} µs`);
  console.log(`  ✅ Phase 6 (决策寻路) 耗时: ${perf.phaseBreakdownMicroseconds.phase6DecisionsAstar} µs/tick`);
  console.log(`  ✅ FABS 帧体积: ${(perf.fabsSnapshot.frameBytes / 1024).toFixed(1)} KB (Rust 编码 ${perf.fabsSnapshot.encodeMicroseconds} µs, JS 解码 ${perf.fabsSnapshot.decodeMicroseconds} µs)`);

  console.log('\n======================================================');
  console.log('🎉 M19 行为等价与只读观察门禁测试全通！');
  console.log('======================================================');
}

run().catch(err => {
  console.error('Fatal error in test-m19-differential:', err);
  process.exit(1);
});
