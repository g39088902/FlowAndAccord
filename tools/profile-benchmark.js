#!/usr/bin/env node
// === Flow & Accord · 性能 Profiling 基准测试与分项分析器 (tools/profile-benchmark.js) ===
// 专用于度量 Rust 确定性内核在 WASM 环境下的宏观吞吐量、子系统耗时占比、快照开销与规模扩展性。
// 支持生成 Baseline JSON 并进行优化前后性能对比。
//
// 用法：
//   node tools/profile-benchmark.js                          # 默认执行宏观基准 + 子阶段拆解
//   node tools/profile-benchmark.js --ticks 6000 --breakdown # 跑 6000 tick 并输出 ASCII 耗时占比条形图
//   node tools/profile-benchmark.js --scale                  # 运行 20/50/100 人口规模压测对比
//   node tools/profile-benchmark.js --scale --pops 20,50,100,200,400 --scale-ticks 3000
//   node tools/profile-benchmark.js --batch                  # 运行 1/16/64/256/1024 批次步长对比
//   node tools/profile-benchmark.js --json baseline.json     # 导出基准数据供后续对比
//   node tools/profile-benchmark.js --compare baseline.json  # 对比当前性能与 baseline.json 的加速比
//   node tools/profile-benchmark.js --preset max-yield       # 物资产速拉满（单 tick 饱和）压力场景
//   node tools/profile-benchmark.js --set regenBaseWater=100 # 逐字段覆写配置（可重复 / 逗号分隔）

'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
// ★ T1：统一快照取值入口（FABS 二进制，快照仅此一条通道）
const { createSnapshotReader } = require('./snapshot-reader.js');
const wasmPath = path.join(ROOT, 'frontend', 'rust', 'sim_wasm.wasm');

// ─────────────────────────────────────────────────────────────
// 1. 配置加载与 WASM 实例化辅助
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// 1b. 产速档位预设与通用字段覆写 (Yield Presets & Field Overrides)
// ─────────────────────────────────────────────────────────────
// 目的：在不修改 frontend/js/config.js（仓库基线配置）的前提下，构造"物资产出拉满"的
// 压力测试场景，避免为跑一次压测而污染玩家默认值，也避免手改配置后忘记回滚。
//
// 语义定义：max-yield = **单 tick 饱和档**。
//   POI 再生：regen_rate 使任一 POI 在单个 tick 内即可从 0 回满至储量上限，
//             即 regen_rate = stock_max / dt（dt = 1/60 游戏小时 → ×60）。
//   采收/卸货：使单 tick 内即可装满一囊（资源按 carryCapacityResource，黄金按 agentGoldLoadFull）。
// 该档位下「物资不再成为瓶颈」，人口与房屋将 Growth 到机制允许的上限，是内核的最坏负载画像。
const YIELD_PRESETS = {
  'max-yield': (cfg) => {
    const dt = cfg.simulationDt || 1 / 60;
    const sat = (maxStock) => maxStock / dt;
    return {
      // 生态 POI 自然再生（清泉/浆果/林木/石矿/金矿）
      regenBaseWater: sat(cfg.stockMaxWater),
      regenBaseBerry: sat(cfg.stockMaxBerry),
      regenBaseWood: sat(cfg.stockMaxWood),
      regenBaseStone: sat(cfg.stockMaxStone),
      regenBaseGold: sat(cfg.stockMaxGold),
      // 外部市场（榷场互市）三类物资产速
      marketRegenBaseWater: sat(cfg.marketStockMaxWater),
      marketRegenBaseFood: sat(cfg.marketStockMaxFood),
      marketRegenBaseWood: sat(cfg.marketStockMaxWood),
      // 现场采收速率：单 tick 装满一囊
      poiInteractionRateResource: (cfg.carryCapacityResource || 100) / dt,
      poiInteractionRateGold: (cfg.agentGoldLoadFull || 20) / dt,
      // 入库卸货速率：单 tick 卸空一囊
      poiUnloadRateResource: (cfg.carryCapacityResource || 100) / dt,
      poiUnloadRateGold: (cfg.agentGoldLoadFull || 20) / dt,
    };
  },
};

// 应用「预设 + 命令行 --set 覆写」，返回实际生效的覆写清单（便于写入报告与审计）
function applyConfigOverrides(cfg, presetName, args) {
  const applied = [];
  if (presetName) {
    const fn = YIELD_PRESETS[presetName];
    if (!fn) {
      throw new Error(`未知产速预设: ${presetName}（可用: ${Object.keys(YIELD_PRESETS).join(', ')}）`);
    }
    const patch = fn(cfg);
    for (const [k, v] of Object.entries(patch)) {
      applied.push({ key: k, from: cfg[k], to: v, source: `preset:${presetName}` });
      cfg[k] = v;
    }
  }
  // 通用逐字段覆写：--set key=value（可重复，亦可逗号分隔多个）
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--set') continue;
    const raw = args[i + 1];
    if (!raw) continue;
    for (const pair of raw.split(',')) {
      const idx = pair.indexOf('=');
      if (idx <= 0) throw new Error(`--set 语法错误: ${pair}（应为 key=value）`);
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (!(key in cfg)) throw new Error(`--set 未知配置键: ${key}`);
      const num = Number(val);
      if (!Number.isFinite(num)) throw new Error(`--set 非数值: ${pair}`);
      applied.push({ key, from: cfg[key], to: num, source: 'cli' });
      cfg[key] = num;
    }
  }
  return applied;
}

async function createEngine(seed, agentCount, campCount, config) {
  if (!fs.existsSync(wasmPath)) throw new Error('WASM 文件未找到: ' + wasmPath);
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  // ★ 重要修正：world_create 的 agent_count 形参在内核中实际被忽略
  //   （sim_core::spatial::ecology::seed_primitive_ecology(&mut self, _agent_count: usize) 未使用该形参），
  //   真实初始人口取自 config.agentSpawnCount。若不同步写入配置，--agents / --scale 将形同虚设
  //   （历史上一度出现「400 人比 20 人还快」的假象，实为全部按 20 人跑）。
  const cfg = agentCount > 0 && agentCount !== config.agentSpawnCount
    ? { ...config, agentSpawnCount: agentCount }
    : config;

  // 注入配置
  const encoded = textEncoder.encode(JSON.stringify(cfg));
  const ptr = ex.world_config_buf_ptr(encoded.length);
  new Uint8Array(ex.memory.buffer, ptr, encoded.length).set(encoded);
  const res = ex.world_apply_config_buf(encoded.length);
  if (res !== 0) throw new Error('配置注入失败: ' + res);

  ex.world_create(0, 764.0, seed, agentCount, campCount);

  return { ex, textDecoder, textEncoder };
}

// ─────────────────────────────────────────────────────────────
// 2. 统计计算工具
// ─────────────────────────────────────────────────────────────
function calculateStats(samplesNs) {
  if (!samplesNs.length) return { p50: 0, p90: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  const sorted = [...samplesNs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const sum = sorted.reduce((acc, v) => acc + Number(v), 0);
  const mean = sum / sorted.length;
  const pick = (pct) => Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct))]);
  return {
    meanUs: mean / 1000,
    p50Us: pick(0.50) / 1000,
    p90Us: pick(0.90) / 1000,
    p95Us: pick(0.95) / 1000,
    p99Us: pick(0.99) / 1000,
    maxUs: Number(sorted[sorted.length - 1]) / 1000,
  };
}

function formatBar(pct, width = 24) {
  const fillLen = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '█'.repeat(fillLen) + '░'.repeat(width - fillLen);
}

// ─────────────────────────────────────────────────────────────
// 3. 测试模块实现
// ─────────────────────────────────────────────────────────────

// 模块 A: 纯内核推进宏观吞吐量
async function runThroughputBench(ticks, seed, agents, camps, config) {
  const { ex } = await createEngine(seed, agents, camps, config);
  const dt = 1.0 / 60.0;

  // 预热 100 tick
  ex.world_tick_steps(100, dt);

  // 分批采样延迟（每批 10 tick）
  const batchSize = 10;
  const batches = Math.floor(ticks / batchSize);
  const samplesNs = [];

  const startNs = process.hrtime.bigint();
  for (let i = 0; i < batches; i++) {
    const t0 = process.hrtime.bigint();
    ex.world_tick_steps(batchSize, dt);
    const t1 = process.hrtime.bigint();
    samplesNs.push((t1 - t0) / BigInt(batchSize));
  }
  const endNs = process.hrtime.bigint();

  const totalDurationMs = Number(endNs - startNs) / 1e6;
  const actualTicks = batches * batchSize;
  const tps = (actualTicks / (totalDurationMs / 1000));
  const usPerTick = (totalDurationMs * 1000) / actualTicks;
  const gameHoursPerSec = tps / 60;
  const speedupMultiplier = tps; // 1x 下 60 TPS = 1 小时/秒

  const stats = calculateStats(samplesNs);

  return {
    ticks: actualTicks,
    durationMs: totalDurationMs,
    tps,
    usPerTick,
    gameHoursPerSec,
    speedupMultiplier,
    stats,
  };
}

// 模块 B: 内核 8 大子阶段细粒度拆解
async function runSubphaseBreakdown(ticks, seed, agents, camps, config, warmup = 60) {
  const { ex } = await createEngine(seed, agents, camps, config);
  const dt = 1.0 / 60.0;

  // 预热 (支持快速推进至稳态阶段再细粒度拆解)
  if (warmup > 0) {
    ex.world_tick_steps(warmup, dt);
  }

  const phaseNames = [
    '0. 四季与POI恢复 (Season & Poi Regen)',
    '1. 代谢繁衍与继承 (Metabolism & Child)',
    '2. POI交互卸货 (Poi Interactions)',
    '3. 房屋维护与折旧 (Housing & Auction)',
    '4. 道路自然衰减 (Road Wear Decay)',
    '5. 动力位移踩踏 (Movement & Trample)',
    '6. 马斯洛决策寻路 (Decisions & A*)',
    '7. 账本宗族公仓 (Ledger, Clan, Region)',
    '8. 墓碑窗口清理 (Cleanup)',
  ];

  const phaseTotalsNs = new Array(9).fill(0n);

  for (let t = 0; t < ticks; t++) {
    for (let p = 0; p <= 8; p++) {
      const t0 = process.hrtime.bigint();
      ex.world_tick_subphase(p, dt);
      const t1 = process.hrtime.bigint();
      phaseTotalsNs[p] += (t1 - t0);
    }
  }

  const grandTotalNs = phaseTotalsNs.reduce((acc, v) => acc + v, 0n);
  const grandTotalMs = Number(grandTotalNs) / 1e6;

  const breakdown = phaseNames.map((name, i) => {
    const totalMs = Number(phaseTotalsNs[i]) / 1e6;
    const usPerTick = (totalMs * 1000) / ticks;
    const pct = grandTotalMs > 0 ? (totalMs / grandTotalMs) * 100 : 0;
    return { name, totalMs, usPerTick, pct };
  });

  return { grandTotalMs, breakdown };
}

// 模块 C: 快照编码/解码开销
// 只度量 FABS 二进制通道（Rust 编码 + 内存拷出 + SnapshotBin.decode，
// 等价浏览器 transfer 路径）。
async function runSnapshotBench(samples, seed, agents, camps, config, warmup = 300) {
  const { ex } = await createEngine(seed, agents, camps, config);
  const dt = 1.0 / 60.0;
  if (warmup > 0) {
    ex.world_tick_steps(warmup, dt);
  }

  // ★ T1：统一快照读取器。reuse 恒为 false —— 帧间对象池化已实测否决
  //   （V8 新生代回收短命快照对象更快，且池化会让跨帧持有者读到静默变异的数据），
  //   因此这里与浏览器生产链路完全一致：每帧产出全新对象。
  const reader = createSnapshotReader(ex);
  const binDecoder = reader.decoder;

  // 预热一帧：消费创世地形脏位并同步字符串驻留表，保证 50 次采样都是稳态增量帧
  {
    const p0 = ex.world_snapshot_bin_ptr();
    const l0 = ex.world_snapshot_bin_len();
    if (l0) binDecoder.decode(new Uint8Array(ex.memory.buffer, p0, l0).slice());
  }

  const binEncodeNs = [];
  const binDecodeNs = [];
  let binBytes = 0;

  for (let i = 0; i < samples; i++) {
    // 推进数步让快照产生自然微变
    ex.world_tick_steps(2, dt);

    // Rust 二进制编码（FABS）
    const b0 = process.hrtime.bigint();
    const bptr = ex.world_snapshot_bin_ptr();
    const blen = ex.world_snapshot_bin_len();
    const b1 = process.hrtime.bigint();
    binEncodeNs.push(b1 - b0);
    binBytes = blen;

    // JS 二进制解码
    const b2 = process.hrtime.bigint();
    const bytes = new Uint8Array(ex.memory.buffer, bptr, blen).slice();
    binDecoder.decode(bytes);
    const b3 = process.hrtime.bigint();
    binDecodeNs.push(b3 - b2);
  }

  const n = binEncodeNs.length;
  const avgRustUs = Number(binEncodeNs.reduce((a, b) => a + b, 0n) / BigInt(n)) / 1000;
  const avgJsUs = Number(binDecodeNs.reduce((a, b) => a + b, 0n) / BigInt(n)) / 1000;

  const out = {
    channel: 'fabs',
    snapshotBytes: binBytes,
    snapshotKb: (binBytes / 1024).toFixed(1),
    avgRustUs,   // Rust 侧 FABS 编码
    avgJsUs,     // JS 侧拷贝 + 解码
    totalSnapshotUs: avgRustUs + avgJsUs,
    binBytes,
    binKb: (binBytes / 1024).toFixed(1),
    avgBinEncodeUs: avgRustUs,
    avgBinDecodeUs: avgJsUs,
    binTotalUs: avgRustUs + avgJsUs,
  };
  return out;
}

// 模块 D: 人口规模压测 (Scale)
async function runScaleBench(seed, camps, config, pops, scaleTicks) {
  const results = [];
  for (const pop of pops) {
    const res = await runThroughputBench(scaleTicks, seed, pop, camps, config);
    results.push({ pop, tps: res.tps, usPerTick: res.usPerTick });
  }
  return results;
}

// 模块 E: 批次步进压测 (Batch Size)
async function runBatchBench(seed, agents, camps, config) {
  const batchSizes = [1, 16, 64, 256, 1024];
  const results = [];
  const dt = 1.0 / 60.0;

  for (const b of batchSizes) {
    const { ex } = await createEngine(seed, agents, camps, config);
    ex.world_tick_steps(60, dt);

    const rounds = Math.max(1, Math.floor(2048 / b));
    const totalTicks = rounds * b;

    const t0 = process.hrtime.bigint();
    for (let r = 0; r < rounds; r++) {
      ex.world_tick_steps(b, dt);
    }
    const t1 = process.hrtime.bigint();

    const durationMs = Number(t1 - t0) / 1e6;
    const tps = totalTicks / (durationMs / 1000);
    const usPerTick = (durationMs * 1000) / totalTicks;
    results.push({ batchSize: b, tps, usPerTick, durationMs });
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// 4. CLI 解析与入口
// ─────────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  function getArg(flag, def) {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
  }
  const hasFlag = (flag) => args.includes(flag);

  const ticks = parseInt(getArg('--ticks', '3000'), 10);
  const seed = parseFloat(getArg('--seed', '42'));
  const agents = parseInt(getArg('--agents', '20'), 10);
  const camps = parseInt(getArg('--camps', '4'), 10);
  const jsonOut = getArg('--json', null);
  const compareFile = getArg('--compare', null);

  const runAll = !hasFlag('--scale') && !hasFlag('--batch') && !hasFlag('--only-breakdown');
  const doBreakdown = runAll || hasFlag('--breakdown') || hasFlag('--only-breakdown');
  const doScale = hasFlag('--scale');
  const doBatch = hasFlag('--batch');

  const breakdownTicksArg = getArg('--breakdown-ticks', null);
  let breakdownTicks = 1200;
  if (breakdownTicksArg) {
    breakdownTicks = parseInt(breakdownTicksArg, 10);
  } else if (hasFlag('--only-breakdown')) {
    breakdownTicks = ticks;
  }
  const breakdownWarmup = parseInt(getArg('--breakdown-warmup', '60'), 10);
  const snapshotWarmup = parseInt(getArg('--snapshot-warmup', '300'), 10);
  // 规模压测的人口档位与每组推进步数（用于绘制「单拍耗时 vs 人口」的扩展性曲线）
  const pops = getArg('--pops', '20,50,100')
    .split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
  const scaleTicks = parseInt(getArg('--scale-ticks', '1500'), 10);

  console.log(`╔════════════════════════════════════════════════════════════════════╗`);
  console.log(`║      Flow & Accord · WASM 仿真内核性能基准测试与分项分析器         ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════╝`);
  console.log(`环境配置: 种子=${seed} | 人口=${agents} | 营地=${camps} | 推进Tick=${ticks}`);
  console.log(`时间基准: dt = 1/60 游戏小时 | 60 tick = 1 游戏小时\n`);

  const simConfig = loadSimConfig();
  const presetName = getArg('--preset', null);
  const overrides = applyConfigOverrides(simConfig, presetName, args);
  const report = {
    timestamp: new Date().toISOString(),
    seed,
    agents,
    camps,
    ticks,
    preset: presetName || 'default',
    configOverrides: overrides,
  };
  if (overrides.length) {
    console.log(`⚙️  配置覆写 (${presetName ? `预设 ${presetName}` : '命令行'}，共 ${overrides.length} 项):`);
    for (const o of overrides) {
      console.log(`    ${o.key.padEnd(30)} ${String(o.from).padStart(10)} → ${String(o.to)}`);
    }
    console.log('');
  }

  // 1. 宏观吞吐量
  process.stdout.write(`🚀 正在运行宏观内核吞吐量基准测试 (${ticks} ticks)... `);
  const tp = await runThroughputBench(ticks, seed, agents, camps, simConfig);
  report.throughput = tp;
  console.log(`完成！\n`);

  console.log(`┌─────────────────── 宏观性能大盘 ───────────────────┐`);
  console.log(`│ 推进总用时:       ${tp.durationMs.toFixed(2).padStart(8)} ms`);
  console.log(`│ 模拟推进吞吐量:   ${Math.round(tp.tps).toLocaleString().padStart(8)} TPS (Ticks/秒)`);
  console.log(`│ 单 Tick 耗时:     ${tp.usPerTick.toFixed(2).padStart(8)} µs/tick`);
  console.log(`│ 仿真加速倍率:     ${Math.round(tp.speedupMultiplier).toLocaleString().padStart(8)}x 现实时间`);
  console.log(`│ 游戏时钟速率:     ${tp.gameHoursPerSec.toFixed(1).padStart(8)} 游戏小时/现实秒`);
  console.log(`├─────────────────── 延迟分位数 (µs) ────────────────┤`);
  console.log(`│ Mean:  ${tp.stats.meanUs.toFixed(2).padStart(7)} µs  │ P50:  ${tp.stats.p50Us.toFixed(2).padStart(7)} µs  │ P90:  ${tp.stats.p90Us.toFixed(2).padStart(7)} µs`);
  console.log(`│ P95:   ${tp.stats.p95Us.toFixed(2).padStart(7)} µs  │ P99:  ${tp.stats.p99Us.toFixed(2).padStart(7)} µs  │ Max:  ${tp.stats.maxUs.toFixed(2).padStart(7)} µs`);
  console.log(`└────────────────────────────────────────────────────┘\n`);

  // 2. 子阶段耗时拆解
  if (doBreakdown) {
    const warmupMsg = breakdownWarmup > 60 ? ` (预热跳过 ${breakdownWarmup} ticks)` : '';
    process.stdout.write(`🔬 正在采样 8 大子阶段耗时分布 (${breakdownTicks} ticks)${warmupMsg}... `);
    const bd = await runSubphaseBreakdown(breakdownTicks, seed, agents, camps, simConfig, breakdownWarmup);
    report.breakdown = bd;
    console.log(`完成！\n`);

    console.log(`┌────────────────────────────── 子阶段耗时占比分布 ──────────────────────────────┐`);
    console.log(`│ 阶段名称                               耗时(ms)    单拍(µs)    占比      条形图`);
    console.log(`├────────────────────────────────────────────────────────────────────────────────┤`);
    for (const item of bd.breakdown) {
      const name = item.name.padEnd(38);
      const ms = item.totalMs.toFixed(2).padStart(7);
      const us = item.usPerTick.toFixed(2).padStart(8);
      const pct = (item.pct.toFixed(1) + '%').padStart(6);
      const bar = formatBar(item.pct, 16);
      console.log(`│ ${name} ${ms}ms ${us}µs  ${pct}  [${bar}]`);
    }
    console.log(`└────────────────────────────────────────────────────────────────────────────────┘\n`);
  }

  // 3. 快照序列化与通信开销
  if (runAll) {
    const snapWarmupMsg = snapshotWarmup > 300 ? ` (预热跳过 ${snapshotWarmup} ticks)` : '';
    process.stdout.write(`📸 正在度量快照编码/解码开销 (50 采样)${snapWarmupMsg}... `);
    const snap = await runSnapshotBench(50, seed, agents, camps, simConfig, snapshotWarmup);
    report.snapshot = snap;
    console.log(`完成！\n`);

    const snapVsTick = (snap.totalSnapshotUs / tp.usPerTick).toFixed(1);
    const hzOccupancy = (snap.totalSnapshotUs * 30 / 10000).toFixed(1); // 30Hz 节流下的算力占用 %
    console.log(`┌────────────────── ★ 快照开销分析 (FABS 单通道) ─────────────────┐`);
    console.log(`│ 二进制帧体积:       ${String(snap.binKb).padStart(8)} KB (${snap.binBytes.toLocaleString()} 字节)`);
    console.log(`│ Rust 编码耗时:      ${snap.avgBinEncodeUs.toFixed(2).padStart(8)} µs (手写小端平铺)`);
    console.log(`│ JS 解码耗时:        ${snap.avgBinDecodeUs.toFixed(2).padStart(8)} µs (拷贝 + SnapshotBin.decode)`);
    console.log(`│ 单次快照总代价:     ${snap.binTotalUs.toFixed(2).padStart(8)} µs`);
    console.log(`│ 30Hz 节流算力占用:  ${hzOccupancy.padStart(8)} %`);
    console.log(`│ 等价计算步数:       生成 1 次快照耗时 ≈ 推进 ${snapVsTick} 个 Tick`);
    console.log(`└──────────────────────────────────────────────────────────┘\n`);
  }

  // 4. 规模对比
  if (doScale) {
    console.log(`👥 人口规模扩展性压测 (${pops.join(' vs ')} Agents, 每组 ${scaleTicks} ticks 全新世界):`);
    const scale = await runScaleBench(seed, camps, simConfig, pops, scaleTicks);
    report.scale = scale;
    const p0 = scale[0];
    for (const s of scale) {
      const ratio = s.usPerTick / p0.usPerTick;
      const linear = s.pop / p0.pop;
      // 人效 = 单拍耗时/人口；超线性系数 = 实测倍数 / 线性倍数（>1 即存在超线性放大）
      console.log(`  人口 ${String(s.pop).padStart(4)}: ${Math.round(s.tps).toLocaleString().padStart(9)} TPS | ${s.usPerTick.toFixed(2).padStart(7)} µs/tick` +
        ` | 单拍 ${ratio.toFixed(2)}x@${p0.pop}人 | 人效 ${(s.usPerTick / s.pop).toFixed(3)} µs/人 | 超线性系数 ${(ratio / linear).toFixed(2)}`);
    }
    console.log('');
  }

  // 5. 批次对比
  if (doBatch) {
    console.log(`⚡ 步长批次颗粒度压测 (world_tick_steps 批次大小):`);
    const batches = await runBatchBench(seed, agents, camps, simConfig);
    report.batch = batches;
    for (const b of batches) {
      console.log(`  批次 ${String(b.batchSize).padStart(4)} 步:  ${Math.round(b.tps).toLocaleString().padStart(8)} TPS | 单步耗时: ${b.usPerTick.toFixed(2)} µs`);
    }
    console.log('');
  }

  // 6. 对比历史 Baseline
  if (compareFile && fs.existsSync(compareFile)) {
    try {
      const base = JSON.parse(fs.readFileSync(compareFile, 'utf8'));
      console.log(`📊 性能优化加速比对照 (对比基准: ${path.basename(compareFile)}):`);
      if (base.throughput && tp) {
        const tpsDelta = ((tp.tps - base.throughput.tps) / base.throughput.tps) * 100;
        const usDelta = ((tp.usPerTick - base.throughput.usPerTick) / base.throughput.usPerTick) * 100;
        const speedup = (tp.tps / base.throughput.tps).toFixed(2);
        console.log(`  吞吐量 TPS:  ${Math.round(base.throughput.tps).toLocaleString()} → ${Math.round(tp.tps).toLocaleString()} (${tpsDelta >= 0 ? '+' : ''}${tpsDelta.toFixed(1)}%, 加速比: ${speedup}x)`);
        console.log(`  单拍耗时:    ${base.throughput.usPerTick.toFixed(2)}µs → ${tp.usPerTick.toFixed(2)}µs (${usDelta <= 0 ? '' : '+'}${usDelta.toFixed(1)}%)`);
      }
      console.log('');
    } catch (e) {
      console.error(`⚠️ 读取基准文件 ${compareFile} 失败:`, e.message);
    }
  }

  // 7. 保存输出
  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), 'utf8');
    console.log(`💾 基准测试数据已成功导出至: ${jsonOut}\n`);
  }

  console.log(`✅ Profiling 基准测试执行完毕！`);
})().catch(e => {
  console.error('\n❌ BENCHMARK FAILED:', e);
  process.exit(1);
});
