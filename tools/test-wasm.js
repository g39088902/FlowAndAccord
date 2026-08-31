// Node 端到端验证 sim_wasm 引擎 (无需浏览器，直接用 Node 的 WebAssembly 运行时)
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

  // === Test 1: create + basic invariants ===
  ex.world_create(60, 764.0, 42, 12);
  let s = snapshot();
  console.log('tick0: agents=' + s.agents.length + ' pois=' + s.pois.length + ' houses=' + s.houses.length +
    ' lanes=' + s.lanes.length + ' nodes=' + s.nodes.length + ' terrainCells=' + s.terrain_cells.length);
  if (s.agents.length !== 12) throw new Error('expected 12 agents');

  runSteps(3000, 1 / 30); // ~100 秒仿真
  s = snapshot();
  console.log('after 3000 steps: tick=' + s.tick + ' agents=' + s.agents.length + ' houses=' + s.houses.length +
    ' births=' + s.total_births + ' deaths=' + s.total_deaths + ' miscarriages=' + s.total_miscarriages +
    ' season=' + s.season + ' temp=' + s.temperature.toFixed(1));

  const states = {};
  for (const a of s.agents) states[a.state] = (states[a.state] || 0) + 1;
  console.log('state dist:', JSON.stringify(states));

  let outOfBounds = 0, nanCount = 0;
  for (const a of s.agents) {
    if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(a.z)) nanCount++;
    if (Math.abs(a.x) > 400 || Math.abs(a.y) > 400) outOfBounds++;
  }
  console.log('agents out-of-bounds: ' + outOfBounds + '  NaN: ' + nanCount);

  // === Test 2: 确定性 (同种子 -> 快照逐字节一致) ===
  ex.world_create(60, 764.0, 777, 12);
  runSteps(600, 1 / 30);
  const snapA = JSON.stringify(snapshot());
  ex.world_create(60, 764.0, 777, 12);
  runSteps(600, 1 / 30);
  const snapB = JSON.stringify(snapshot());
  console.log('determinism (same seed):', snapA === snapB);
  if (snapA !== snapB) throw new Error('DETERMINISM FAILED');

  // === Test 3: 不同种子 -> 不同世界 ===
  ex.world_create(60, 764.0, 778, 12);
  runSteps(600, 1 / 30);
  const snapC = JSON.stringify(snapshot());
  console.log('different seed differs:', snapA !== snapC);

  // === Test 4: 再生倍率生效 ===
  ex.world_create(60, 764.0, 42, 12);
  ex.world_set_regen_multiplier(0, 4.0);
  runSteps(200, 1 / 30);
  const s2 = snapshot();
  const water = s2.pois.filter(p => p.poi_type === 'WaterSource');
  console.log('water stock (x4 regen):', water.length ? water[0].current_stock.toFixed(1) : 'n/a');

  // === Test 5: 长期运行稳定性 (无 panic/超界) ===
  ex.world_create(60, 764.0, 2026, 12);
  runSteps(6000, 1 / 30); // ~200 秒
  const s3 = snapshot();
  console.log('long-run: agents=' + s3.agents.length + ' houses=' + s3.houses.length +
    ' births=' + s3.total_births + ' deaths=' + s3.total_deaths);

  // === Test 6: 动态 JS Config 注入验证 (免重编译) ===
  if (typeof ex.world_config_buf_ptr === 'function' && typeof ex.world_apply_config_buf === 'function') {
    const customConfig = {
      tempBaseMid: 35.0,
      seasonQuarterLength: 100.0,
    };
    const encoded = new TextEncoder().encode(JSON.stringify(customConfig));
    const ptr = ex.world_config_buf_ptr(encoded.length);
    new Uint8Array(ex.memory.buffer, ptr, encoded.length).set(encoded);
    const res = ex.world_apply_config_buf(encoded.length);
    console.log('dynamic JS config injection:', res === 0 ? 'success' : 'failed (' + res + ')');
    if (res !== 0) throw new Error('CONFIG INJECTION FAILED: ' + res);
  }

  console.log('ALL_TESTS_DONE');
})().catch(e => { console.error('TEST_FAIL', e); process.exit(1); });
