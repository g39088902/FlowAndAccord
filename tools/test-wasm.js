// Node 端到端验证 sim_wasm 引擎 (无需浏览器，直接用 Node 的 WebAssembly 运行时)
// 长期回归仅保留两项：确定性（同种子逐字节一致）与长程稳定性（无 panic / 越界 / NaN）
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const wasmPath = path.join(ROOT, 'frontend', 'rust', 'sim_wasm.wasm');

(async () => {
  if (!fs.existsSync(wasmPath)) throw new Error('wasm not found: ' + wasmPath);
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;

  function snapshot() {
    const ptr = ex.world_snapshot_ptr();
    const len = ex.world_snapshot_len();
    return JSON.parse(new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr, len)));
  }
  function runSteps(worldTicks, dt) {
    for (let i = 0; i < worldTicks; i++) ex.world_tick_steps(2, dt);
  }

  // === 生产配置注入：config.js + config.decision-order.js 合并后经线性内存注入 WASM ===
  // 使确定性门禁在「与浏览器一致的真实配置」（含决策分支评估顺序）下运行。
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
    return windowShim.SIM_CONFIG;
  }
  function applyConfig(cfg) {
    const encoded = new TextEncoder().encode(JSON.stringify(cfg));
    const ptr = ex.world_config_buf_ptr(encoded.length);
    new Uint8Array(ex.memory.buffer, ptr, encoded.length).set(encoded);
    const res = ex.world_apply_config_buf(encoded.length);
    if (res !== 0) throw new Error('apply_config failed: ' + res);
  }
  const simConfig = loadSimConfig();

  // === Test 1: 确定性 (同种子 -> 快照逐字节一致) ===
  ex.world_create(60, 764.0, 777, 20);
  applyConfig(simConfig);
  runSteps(600, 1 / 30);
  const snapA = JSON.stringify(snapshot());
  ex.world_create(60, 764.0, 777, 20);
  applyConfig(simConfig);
  runSteps(600, 1 / 30);
  const snapB = JSON.stringify(snapshot());
  console.log('determinism (same seed):', snapA === snapB);
  if (snapA !== snapB) throw new Error('DETERMINISM FAILED');

  // === Test 2: 长程运行稳定性 (无 panic / 越界 / NaN) ===
  ex.world_create(60, 764.0, 2026, 20);
  applyConfig(simConfig);
  runSteps(6000, 1 / 30); // ~200 秒
  const s = snapshot();
  let outOfBounds = 0, nanCount = 0;
  for (const a of s.agents) {
    if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(a.z)) nanCount++;
    if (Math.abs(a.x) > 400 || Math.abs(a.y) > 400) outOfBounds++;
  }
  console.log('long-run: agents=' + s.agents.length + ' houses=' + s.houses.length +
    ' births=' + s.total_births + ' deaths=' + s.total_deaths);
  console.log('agents out-of-bounds: ' + outOfBounds + '  NaN: ' + nanCount);
  if (nanCount > 0) throw new Error('NAN FOUND: ' + nanCount);
  if (outOfBounds > 0) throw new Error('OUT_OF_BOUNDS FOUND: ' + outOfBounds);

  console.log('ALL_TESTS_DONE');
})().catch(e => { console.error('TEST_FAIL', e); process.exit(1); });
