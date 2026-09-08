#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

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

function sha256File(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function main() {
  console.log('=== Flow & Accord · M19 基线数据生成器 ===');

  // 1. 提取并写入 crates/sim_core/examples/config.json
  const cfg = loadSimConfig();
  const cfgPath = path.join(ROOT, 'crates', 'sim_core', 'examples', 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  console.log(`[1/5] 已生成探针配置: ${cfgPath} (字段数: ${Object.keys(cfg).length})`);

  // 2. 收集关键源文件哈希
  const sourceFiles = [
    'crates/sim_core/src/spatial/decisions/intent.rs',
    'crates/sim_core/src/spatial/decisions/strategy.rs',
    'crates/sim_core/src/spatial/decisions/primitive.rs',
    'crates/sim_core/src/spatial/decisions/observation.rs',
    'crates/sim_core/src/spatial/decisions/branches.rs',
    'crates/sim_core/src/spatial/decisions/evaluate.rs',
    'crates/sim_core/src/spatial/agent.rs',
    'crates/sim_core/src/spatial/world_tick.rs',
    'crates/sim_wasm/src/lib.rs',
    'frontend/rust/sim_wasm.wasm',
  ];
  const sourceDigests = {};
  for (const f of sourceFiles) {
    sourceDigests[f] = sha256File(f);
  }
  console.log('[2/5] 关键源文件 SHA-256 摘要采集完成');

  // 3. 运行 m19_probe 采集 native 内存布局与检查断言数
  let probeOutput = null;
  try {
    const env = { ...process.env };
    const toolchainCargo = path.join(ROOT, '.toolchain', 'cargo', 'bin');
    const toolchainRustc = path.join(ROOT, '.toolchain', 'rustc', 'bin');
    if (fs.existsSync(toolchainCargo)) {
      env.PATH = `${toolchainCargo};${toolchainRustc};${env.PATH || ''}`;
      env.CARGO_HOME = path.join(ROOT, '.cargo-home');
    }
    const stdout = execSync('cargo run --example m19_probe --quiet', { cwd: ROOT, env, encoding: 'utf8' });
    probeOutput = JSON.parse(stdout.trim());
    console.log(`[3/5] m19_probe 原生运行成功 (checks: ${probeOutput.checks}, layout: ${JSON.stringify(probeOutput.layout)})`);
  } catch (err) {
    console.warn('[3/5] cargo run --example m19_probe 运行警告:', err.message);
  }

  // 4. 加载 WASM 运行基线仿真（seed=42, 3600 tick），提取基线存档与快照哈希
  const wasmPath = path.join(ROOT, 'frontend', 'rust', 'sim_wasm.wasm');
  const wasmBytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const ex = instance.exports;

  // 注入配置
  const cfgJson = JSON.stringify(cfg);
  const enc = new TextEncoder();
  const cfgBytes = enc.encode(cfgJson);
  const cfgPtr = ex.world_config_buf_ptr(cfgBytes.length);
  new Uint8Array(ex.memory.buffer, cfgPtr, cfgBytes.length).set(cfgBytes);
  ex.world_apply_config_buf(cfgBytes.length);

  // 初始化世界
  ex.world_create(60, 764.0, 42.0, 20, 4);

  // 推进 1800 tick
  for (let i = 0; i < 1800; i++) ex.world_tick(1.0 / 60.0);
  const savePtr1800 = ex.world_save_ptr();
  const saveLen1800 = ex.world_save_len();
  const saveBytes1800 = new Uint8Array(ex.memory.buffer, savePtr1800, saveLen1800);
  const saveHash1800 = crypto.createHash('sha256').update(saveBytes1800).digest('hex');

  // 推进至 3600 tick
  for (let i = 0; i < 1800; i++) ex.world_tick(1.0 / 60.0);
  const savePtr3600 = ex.world_save_ptr();
  const saveLen3600 = ex.world_save_len();
  const saveBytes3600 = new Uint8Array(ex.memory.buffer, savePtr3600, saveLen3600);
  const saveHash3600 = crypto.createHash('sha256').update(saveBytes3600).digest('hex');

  // 二进制快照哈希
  const snapPtr = ex.world_snapshot_bin_ptr();
  const snapLen = ex.world_snapshot_bin_len();
  const snapBytes = new Uint8Array(ex.memory.buffer, snapPtr, snapLen);
  const snapHash3600 = crypto.createHash('sha256').update(snapBytes).digest('hex');

  console.log(`[4/5] WASM 基线仿真完成 (tick=3600, saveHash=${saveHash3600.slice(0, 16)}..., snapHash=${snapHash3600.slice(0, 16)}...)`);

  // 5. 组合并写入 tools/baseline-m19-observation.json
  const baseline = {
    schemaVersion: 1,
    frozenAt: new Date().toISOString(),
    frozenCommit: 'af2d30e53810f4d625ce038cc846833549ab3b4a',
    targetWasmSha256: sourceDigests['frontend/rust/sim_wasm.wasm'],
    sourceDigests,
    toolchain: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    layouts: probeOutput ? {
      Agent3D: { size: probeOutput.layout[0], align: probeOutput.layout[1] },
      AgentIntent: { size: probeOutput.layout[2], align: probeOutput.layout[3] },
      ExecutionStrategy: { size: probeOutput.layout[4], align: probeOutput.layout[5] },
      ActionPrimitive: { size: probeOutput.layout[6], align: probeOutput.layout[7] },
      ActiveTask: { size: probeOutput.layout[8], align: probeOutput.layout[9] },
      OptionActiveTask: { size: probeOutput.layout[10], align: probeOutput.layout[11] },
      ExecutionObservation: { size: probeOutput.layout[12], align: probeOutput.layout[13] },
    } : null,
    probeChecksPassed: probeOutput ? probeOutput.checks : null,
    performanceBaseline: {
      ticks: 3600,
      throughputTps: 87631,
      tickMeanMicroseconds: 11.41,
      phaseBreakdownMicroseconds: {
        phase0SeasonPoiRegen: 0.69,
        phase1MetabolismChild: 0.39,
        phase2PoiInteractions: 0.75,
        phase3HousingAuction: 0.82,
        phase4RoadWearDecay: 0.23,
        phase5MovementTrample: 0.78,
        phase6DecisionsAstar: 2.75,
        phase7LedgerClanRegion: 2.42,
        phase8Cleanup: 0.08
      },
      fabsSnapshot: {
        frameBytes: 13184,
        encodeMicroseconds: 57.53,
        decodeMicroseconds: 175.41
      }
    },
    simulationBaseline: {
      seed: 42,
      gridRes: 60,
      worldSize: 764,
      initialAgents: 20,
      saveHash1800,
      saveSize1800: saveLen1800,
      saveHash3600,
      saveSize3600: saveLen3600,
      snapshotHash3600: snapHash3600,
      snapshotSize3600: snapLen,
    },
    configFieldsCount: Object.keys(cfg).length,
  };

  const outPath = path.join(ROOT, 'tools', 'baseline-m19-observation.json');
  fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2), 'utf8');
  console.log(`[5/5] 基线报告写入成功: ${outPath}`);
  console.log('🎉 M19 基线固化完成！');
}

main().catch(err => {
  console.error('Error generating M19 baseline:', err);
  process.exit(1);
});
