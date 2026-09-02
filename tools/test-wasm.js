// Node 端到端验证 sim_wasm 引擎 (无需浏览器，直接用 Node 的 WebAssembly 运行时)
// 长期回归保留三项：确定性（同种子逐字节一致）、长程稳定性（无 panic / 越界 / NaN）、
// 存档读档确定性（存档点续演 == 不中断连续运行）+ 版本不兼容拒绝加载
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

  // === 存档 / 读档桥接（v1.7.0）===
  function saveError() {
    const len = ex.world_last_error_len();
    if (!len) return '';
    const ptr = ex.world_last_error_ptr();
    return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr, len));
  }
  function saveToString() {
    const ptr = ex.world_save_ptr();
    const len = ex.world_save_len();
    if (!len) throw new Error('world_save failed: ' + (saveError() || 'empty buffer'));
    return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr, len));
  }
  function loadFromString(json) {
    const encoded = new TextEncoder().encode(json);
    const ptr = ex.world_save_buf_ptr(encoded.length);
    new Uint8Array(ex.memory.buffer, ptr, encoded.length).set(encoded);
    const res = ex.world_load(encoded.length);
    if (res !== 0) throw new Error('world_load failed: ' + res + ' ' + saveError());
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
    // ★ M8 升级材料成本矩阵拆分配置（config.house-upgrade-cost.js，20 字段）合并注入，
    // 使 WASM 在真实成本值（50/75/100/125 矩阵）下运行而非 0 默认值。
    const costPath = path.join(ROOT, 'frontend', 'js', 'config.house-upgrade-cost.js');
    if (fs.existsSync(costPath)) {
      new Function('window', fs.readFileSync(costPath, 'utf8'))(windowShim);
      Object.assign(windowShim.SIM_CONFIG, windowShim.SIM_HOUSE_UPGRADE_COST || {});
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

  // === Test 3: 存档 / 读档确定性 (存档点续演 == 不中断连续运行) ===
  // 强确定性要求：RNG 内部状态、施密特触发器、私有冷却、账本流水、路网磨损、
  // 发号器与计数器全部入档。若任一字段漏存，此处续演结果即与连续运行分叉。
  const SAVE_TICKS = 900;  // 存档前推进（×2 = 1800 tick ≈ 60 模拟秒）
  const POST_TICKS = 900;  // 存档后推进
  const SAVE_SEED = 31415;

  // 基准：连续不中断跑到 SAVE + POST
  ex.world_create(60, 764.0, SAVE_SEED, 20);
  applyConfig(simConfig);
  runSteps(SAVE_TICKS, 1 / 30);
  const savedJson = saveToString();
  const tickAtSave = snapshot().tick;
  runSteps(POST_TICKS, 1 / 30);
  const snapContinuous = JSON.stringify(snapshot());

  // 对照：新建同种子世界 → 跑到存档点 → 读档覆盖 → 续演同样步数
  ex.world_create(60, 764.0, SAVE_SEED, 20);
  applyConfig(simConfig);
  runSteps(SAVE_TICKS, 1 / 30);
  loadFromString(savedJson);
  const tickAfterLoad = snapshot().tick;
  runSteps(POST_TICKS, 1 / 30);
  const snapReloaded = JSON.stringify(snapshot());

  console.log('save size: ' + (savedJson.length / 1024).toFixed(1) + ' KB  tick@save=' + tickAtSave);
  console.log('save/load tick restored: ' + (tickAfterLoad === tickAtSave));
  console.log('save/load determinism: ' + (snapContinuous === snapReloaded));
  if (tickAfterLoad !== tickAtSave) throw new Error('SAVE_TICK_NOT_RESTORED: ' + tickAfterLoad + ' != ' + tickAtSave);
  if (snapContinuous !== snapReloaded) throw new Error('SAVE_LOAD_DETERMINISM_FAILED');

  // === Test 4: 版本不兼容必须拒绝加载（不静默降级、不破坏当前世界）===
  const tampered = JSON.parse(savedJson);
  tampered.format_version = 99;
  let rejected = false;
  try {
    loadFromString(JSON.stringify(tampered));
  } catch (e) {
    rejected = /format_version|版本|failed/.test(String(e.message));
  }
  const snapAfterReject = JSON.stringify(snapshot());
  console.log('incompatible version rejected: ' + rejected + '  world intact: ' + (snapAfterReject === snapReloaded));
  if (!rejected) throw new Error('INCOMPATIBLE_SAVE_NOT_REJECTED');
  if (snapAfterReject !== snapReloaded) throw new Error('WORLD_MUTATED_BY_FAILED_LOAD');

  console.log('ALL_TESTS_DONE');
})().catch(e => { console.error('TEST_FAIL', e); process.exit(1); });
