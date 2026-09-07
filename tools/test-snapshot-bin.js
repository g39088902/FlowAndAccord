#!/usr/bin/env node
/*
 * Flow & Accord · M4 二进制快照（FABS）↔ JSON 快照一致性门禁 (test-snapshot-bin.js)
 * ============================================================================
 * 用途：在同一 tick 下，用 `frontend/js/snapshot-bin.js` 解码二进制帧，与
 *       `world_snapshot_ptr` 的 JSON 快照做**深比较**（逐字段、逐数组元素、逐对象键），
 *       f32 用容差 |a-b| < 1e-6 比较。这是 M4「四处同步」防漂移的唯一自动保障网。
 *
 * 用法：
 *   node tools/test-snapshot-bin.js            # 默认在仓库根目录运行
 *   node tools/test-snapshot-bin.js <ROOT>     # 指定仓库根目录
 *
 * 覆盖场景：
 *   1. 首帧（含地形/路网全量/字符串驻留表初建）
 *   2. 推进 3600 tick 后的稳态帧（无地形增量、含 LANE_WEAR 与部分字符串增量）
 *   3. 存读档后帧（验证读档后编码一致）
 * 任一项不一致即 exit 1（深比较会给出第一条差异路径）。
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.argv[2] || process.cwd();
const wasmPath = path.join(ROOT, 'frontend', 'rust', 'sim_wasm.wasm');
const decPath = path.join(ROOT, 'frontend', 'js', 'snapshot-bin.js');

let failures = 0;

function fail(msg) {
  failures++;
  console.error('  ❌ ' + msg);
}

function ok(msg) {
  console.log('  ✅ ' + msg);
}

// ---------- 加载二进制解码器到 node 全局 ----------
const decSrc = fs.readFileSync(decPath, 'utf8');
const sandbox = { TextDecoder, TextEncoder, console };
vm.createContext(sandbox);
vm.runInContext(decSrc, sandbox); // IIFE 以 window=this 全局挂 SnapshotBin
const SnapshotBin = sandbox.SnapshotBin;
if (!SnapshotBin) throw new Error('snapshot-bin.js 未暴露 window.SnapshotBin');

// ---------- 深比较：JSON 快照对象 vs 二进制解码对象 ----------
const IGNORE_KEYS = new Set(['geom_version', 'strtab_epoch', 'lane_wear']); // M4 增量接口，非 JSON 字段

// f32 一致性比较：
//  - JSON 侧是 serde_json 对 f32 的「最短往返十进制串」（如 67.09234），
//    二进制侧是 DataView.getFloat32 的精确加宽 double（67.09233856201172）。
//    两者只差「十进制往返表示误差」（<1e-6），本质是同一个 f32 位型。
//  - 故用 `Math.fround` 把两侧都还原到 f32 位型后做精确相等比较；
//    整数（u64 id/tick 等，由 JSON 打印为十进制整数）直接按整数精确比较。
function numEqual(a, b) {
  if (a === b) return true;
  if (Number.isInteger(a) && Number.isInteger(b)) return false;
  return Math.fround(a) === Math.fround(b);
}

// 忽略数值类微量差别的比较（f32 往返同一内核数据，理论上完全一致）
function deepCompare(a, b, pathStr, extra) {
  if (extra) {
    if (extra === 'num') {
      if (typeof a !== 'number' || typeof b !== 'number') {
        fail(pathStr + `：类型不一致 ${typeof a} vs ${typeof b}`);
        return;
      }
      if (!numEqual(a, b)) fail(pathStr + `：数值不一致 ${a} vs ${b}`);
      return;
    }
    if (extra === 'bool') {
      if (a !== b) fail(pathStr + `：布尔不一致 ${a} vs ${b}`);
      return;
    }
  }
  if (a === null || b === null) {
    if (a !== b) fail(pathStr + `：null 不一致`);
    return;
  }
  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) {
    fail(pathStr + `：类型不一致 ${ta} vs ${tb}`);
    return;
  }
  if (ta === 'number') {
    if (!numEqual(a, b)) fail(pathStr + `：数值不一致 ${a} vs ${b}`);
    return;
  }
  if (ta === 'boolean' || ta === 'string') {
    if (a !== b) fail(pathStr + `：值不一致 ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) { fail(pathStr + '：数组/非数组不一致'); return; }
    if (a.length !== b.length) { fail(pathStr + `：数组长度不一致 ${a.length} vs ${b.length}`); return; }
    for (let i = 0; i < a.length; i++) deepCompare(a[i], b[i], `${pathStr}[${i}]`);
    return;
  }
  if (ta === 'object') {
    const ka = Object.keys(a).filter((k) => !IGNORE_KEYS.has(k)).sort();
    const kb = Object.keys(b).filter((k) => !IGNORE_KEYS.has(k)).sort();
    if (JSON.stringify(ka) !== JSON.stringify(kb)) {
      fail(pathStr + `：键集合不一致\n      JSON  缺:${kb.filter((k) => !ka.includes(k))}\n      二进制缺:${ka.filter((k) => !kb.includes(k))}`);
      return;
    }
    for (const k of ka) deepCompare(a[k], b[k], `${pathStr}.${k}`);
    return;
  }
  fail(pathStr + '：未知类型 ' + ta);
}

// ---------- wasm 装载 ----------
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

async function main() {
  if (!fs.existsSync(wasmPath)) throw new Error('wasm not found: ' + wasmPath);
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const ex = instance.exports;
  const td = new TextDecoder();

  const config = loadSimConfig();
  const jsonStr = JSON.stringify(config);
  const enc = new TextEncoder().encode(jsonStr);
  const cp = ex.world_config_buf_ptr(enc.length);
  new Uint8Array(ex.memory.buffer, cp, enc.length).set(enc);
  if (ex.world_apply_config_buf(enc.length) !== 0) throw new Error('config apply failed');

  // 枚举名称表注入解码器
  const etp = ex.world_enum_table_ptr();
  const etl = ex.world_enum_table_len();
  if (!etl) throw new Error('枚举名称表为空');
  SnapshotBin.setEnumTables(td.decode(new Uint8Array(ex.memory.buffer, etp, etl)));

  function jsonSnap() {
    const p = ex.world_snapshot_ptr();
    const l = ex.world_snapshot_len();
    if (!l) throw new Error('JSON 快照为空');
    return JSON.parse(td.decode(new Uint8Array(ex.memory.buffer, p, l)));
  }
  function binSnap() {
    const p = ex.world_snapshot_bin_ptr();
    const l = ex.world_snapshot_bin_len();
    if (!l) throw new Error('二进制快照为空');
    return SnapshotBin.decode(new Uint8Array(ex.memory.buffer, p, l).slice());
  }

  // 两通道共享 terrain_dirty / last_geom_sig：对比前必须用 world_require_terrain 复位，
  // 保证 JSON 与二进制都拿到完整地形与（必要时）全量路网几何。
  function compareBoth(label) {
    ex.world_require_terrain();
    const j = jsonSnap();
    ex.world_require_terrain();
    const b = binSnap();
    deepCompare(j, b, label);
    if (failures === 0) ok(label + ' 一致');
  }

  console.log('=== M4 二进制快照 (FABS) ↔ JSON 一致性门禁 ===');
  console.log(`解码器: ${decPath}`);
  console.log(`wasm:   ${wasmPath}\n`);

  // 场景 1：创世帧（世界刚创建，地形 + 全量路网 + 字符串驻留表初建）
  ex.world_create(60, 764.0, 42, 20, 4);
  SnapshotBin.resetCaches(); // 新引擎 → 清空字符串缓存（与浏览器读档/重置行为一致）
  console.log('[1/3] 创世帧（地形+路网全量）...');
  compareBoth('genesis');

  // 场景 2：推进 3600 tick 后的稳态帧（无地形增量，仅 LANE_WEAR + 少量字符串增量）
  ex.world_tick_steps(3600, 1.0 / 60.0);
  console.log('[2/3] 稳态帧（3600 tick 后）...');
  compareBoth('steady');

  // 场景 2b：增量帧（同一引擎再取一帧，无地形/路网全量 → 校验 lanes=null + lane_wear 存在）
  const inc = binSnap();
  if (inc.terrain_cells.length !== 0) fail('增量帧应无地形，实际 terrain_cells=' + inc.terrain_cells.length);
  else if (inc.lanes !== null) fail('增量帧应 lanes=null（复用缓存），实际为数组');
  else if (!inc.lane_wear || inc.lane_wear.length === 0) fail('增量帧应携带 lane_wear');
  else ok('增量帧（无地形/无路网几何，仅 LANE_WEAR）正确');

  // 场景 3：存读档后帧（验证读档后编码一致、字符串驻留表重建正确）
  console.log('[3/3] 存读档后帧...');
  const saveP = ex.world_save_ptr();
  const saveL = ex.world_save_len();
  if (!saveL) throw new Error('存档导出失败: ' + (ex.world_last_error_len ? td.decode(new Uint8Array(ex.memory.buffer, ex.world_last_error_ptr(), ex.world_last_error_len())) : ''));
  const saveJson = td.decode(new Uint8Array(ex.memory.buffer, saveP, saveL));
  const saveEnc = new TextEncoder().encode(saveJson);
  const bp = ex.world_save_buf_ptr(saveEnc.length);
  new Uint8Array(ex.memory.buffer, bp, saveEnc.length).set(saveEnc);
  if (ex.world_load(saveEnc.length) !== 0) throw new Error('存档加载失败');
  SnapshotBin.resetCaches(); // 引擎重建 → 清空字符串缓存
  compareBoth('reload');

  console.log('\n' + (failures === 0 ? 'ALL_BIN_JSON_EQUAL ✅ 二进制与 JSON 快照完全一致' : `共 ${failures} 处不一致 ❌`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
