#!/usr/bin/env node
/*
 * Flow & Accord · 快照三处同步校验工具 (snapshot-check.js)
 * ============================================================================
 * 用途：
 *   校验快照字段在三处的一致性（根 AGENTS.md §4.5）：
 *     1. snapshot.rs / house.rs — 快照结构体定义
 *     2. world.rs generate_snapshot() — 字段赋值
 *     3. rustworld.js _applySnapshot() — 前端映射读取
 *
 *   捕获：
 *     - Rust 定义了但 world.rs 未赋值的字段
 *     - world.rs 赋值了但 snapshot.rs 未定义的字段（拼写错误）
 *     - snapshot.rs 定义了但 rustworld.js 未读取的字段（可能遗漏前端展示）
 *     - rustworld.js 读取了但 snapshot.rs 未定义的字段（拼写错误/已删除）
 *
 * 用法：
 *   node tools/snapshot-check.js
 *
 * 退出码：发现错误（定义/赋值/读取不匹配）时返回 1，否则 0。
 * 警告（如前端未读取某字段）不阻断，仅提示。
 * 本工具零依赖，仅使用 Node 内置模块。
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_RS = path.join(ROOT, 'crates', 'sim_core', 'src', 'spatial', 'snapshot.rs');
const HOUSE_RS = path.join(ROOT, 'crates', 'sim_core', 'src', 'spatial', 'house.rs');
const WORLD_RS = path.join(ROOT, 'crates', 'sim_core', 'src', 'spatial', 'world.rs');
const RUSTWORLD_JS = path.join(ROOT, 'frontend', 'js', 'rustworld.js');

// ---------------------------------------------------------------------------
// 1. 从 Rust 文件提取所有 Snapshot 结构体的字段
// ---------------------------------------------------------------------------
function extractSnapshotStructs(text) {
  const structs = {};
  // 匹配 pub struct XxxSnapshot { ... }（支持 WorldSnapshot3D 这类后缀）
  const structRe = /pub struct (\w*Snapshot\w*)\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = structRe.exec(text)) !== null) {
    const name = m[1];
    const body = m[2];
    const fields = new Set();
    // 匹配 pub field_name: Type,
    const fieldRe = /^\s*pub\s+(\w+)\s*:/gm;
    let fm;
    while ((fm = fieldRe.exec(body)) !== null) {
      fields.add(fm[1]);
    }
    structs[name] = fields;
  }
  return structs;
}

// ---------------------------------------------------------------------------
// 2. 从 world.rs generate_snapshot() 提取每个 Snapshot 构造块的赋值字段
//    使用括号深度匹配，避免 format!("{:?}") 等内嵌 {} 提前截断
// ---------------------------------------------------------------------------
function extractBracedBlock(text, startIdx) {
  // 从 startIdx（{ 的位置）开始，找到匹配的 }
  let depth = 0;
  let inString = false;
  let inChar = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : '';
    if (inString) {
      if (ch === '"' && prev !== '\\') inString = false;
      continue;
    }
    if (inChar) {
      if (ch === "'" && prev !== '\\') inChar = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "'" && /[a-zA-Z_]/.test(prev || ' ')) { inChar = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(startIdx + 1, i);
    }
  }
  return null;
}

function extractWorldAssignments(text) {
  const assignments = {};
  // 找到 generate_snapshot 函数范围（用括号深度匹配）
  const fnStart = text.indexOf('pub fn generate_snapshot');
  if (fnStart === -1) return assignments;
  // 找到函数体的第一个 {
  const firstBrace = text.indexOf('{', fnStart);
  if (firstBrace === -1) return assignments;
  // 用括号深度匹配找到函数结束的 }
  const fnBody = extractBracedBlock(text, firstBrace);
  if (!fnBody) return assignments;

  // 匹配 XxxSnapshot { 然后用括号深度提取内容
  const structRe = /(\w+Snapshot)\s*\{/g;
  let m;
  while ((m = structRe.exec(fnBody)) !== null) {
    const name = m[1];
    const braceStart = m.index + m[0].length - 1; // { 的位置
    const blockContent = extractBracedBlock(fnBody, braceStart);
    if (!blockContent) continue;

    if (!assignments[name]) assignments[name] = new Set();
    // 匹配字段名：支持标准语法 `field: value,` 和简写语法 `field,`
    // 字段名出现在行首或逗号后，后跟冒号或逗号
    const RUST_KEYWORDS = new Set(['pub', 'mut', 'ref', 'move', 'static', 'const', 'let', 'if', 'else', 'for', 'while', 'loop', 'match', 'return', 'break', 'continue', 'fn', 'struct', 'enum', 'impl', 'trait', 'type', 'where', 'use', 'mod', 'crate', 'self', 'super', 'in', 'as', 'dyn', 'async', 'await', 'unsafe', 'extern', 'true', 'false', 'Some', 'None', 'Ok', 'Err']);
    const fieldRe = /(?:^|,|\{)\s*(\w+)\s*(?::|,|\})/gm;
    let fm;
    while ((fm = fieldRe.exec(blockContent)) !== null) {
      const field = fm[1];
      if (!/^\d/.test(field) && !RUST_KEYWORDS.has(field)) {
        assignments[name].add(field);
      }
    }
  }
  return assignments;
}

// ---------------------------------------------------------------------------
// 3. 从 rustworld.js 提取快照字段读取
//    - 顶层：snap.xxx
//    - 数组 map：p.xxx / a.xxx / h.xxx 等
// ---------------------------------------------------------------------------
function extractJsReads(text) {
  const reads = {
    topLevel: new Set(),      // snap.xxx — 对应 WorldSnapshot3D
    arrays: {},                // 数组名 -> Set of 字段名
  };

  // 顶层 snap.xxx
  const topRe = /snap\.(\w+)/g;
  let m;
  while ((m = topRe.exec(text)) !== null) {
    reads.topLevel.add(m[1]);
  }

  // 数组 map：this.xxx = snap.yyy.map(var => ({ field: var.field, ... }))
  // 或 this.xxx = snap.yyy.map(var => { return { field: var.field }; })
  const mapRe = /this\.(\w+)\s*=\s*(?:snap\.\w+|\([^)]*\))\s*(?:\|\|\s*\[\])?\.map\(\s*(?:\((\w+)\)|(\w+))\s*=>\s*\{?([\s\S]*?)\}\s*\)/g;
  while ((m = mapRe.exec(text)) !== null) {
    const arrName = m[1];
    const varName = m[2] || m[3];
    const body = m[4];
    if (!reads.arrays[arrName]) reads.arrays[arrName] = new Set();
    // 提取 varName.field
    if (varName) {
      const fieldRe = new RegExp(`\\b${varName}\\.(\\w+)`, 'g');
      let fm;
      while ((fm = fieldRe.exec(body)) !== null) {
        reads.arrays[arrName].add(fm[1]);
      }
    }
  }

  // 也处理 for...of 循环中的字段读取
  const forRe = /for\s*\(\s*(?:const|let|var)\s+(\w+)\s+of\s+snap\.(\w+)/g;
  while ((m = forRe.exec(text)) !== null) {
    const varName = m[1];
    const arrName = m[2];
    // 找到这个 for 循环的范围（简化：到下一个 for 或函数结束）
    const afterFor = text.slice(m.index);
    const blockEnd = afterFor.indexOf('\n      }', 10);
    const block = blockEnd === -1 ? afterFor : afterFor.slice(0, blockEnd);
    if (!reads.arrays[arrName]) reads.arrays[arrName] = new Set();
    const fieldRe = new RegExp(`\\b${varName}\\.(\\w+)`, 'g');
    let fm;
    while ((fm = fieldRe.exec(block)) !== null) {
      reads.arrays[arrName].add(fm[1]);
    }
  }

  // 也处理 .reduce() 模式
  const reduceRe = /this\.(\w+)\s*=\s*(?:snap\.\w+|\([^)]*\))\s*(?:\|\|\s*\[\])?\.reduce\(\s*(?:\((\w+)\s*,\s*(\w+)\)|(\w+)\s*,\s*(\w+))\s*=>\s*\{?([\s\S]*?)\}\s*\)/g;
  while ((m = reduceRe.exec(text)) !== null) {
    const arrName = m[1];
    const varName = m[3] || m[5]; // 第二个参数是元素变量
    const body = m[6];
    if (!reads.arrays[arrName]) reads.arrays[arrName] = new Set();
    if (varName) {
      const fieldRe = new RegExp(`\\b${varName}\\.(\\w+)`, 'g');
      let fm;
      while ((fm = fieldRe.exec(body)) !== null) {
        reads.arrays[arrName].add(fm[1]);
      }
    }
  }

  // 处理直接索引访问（如 snap.terrain_cells[idx].field）
  const indexRe = /snap\.(\w+)\[[^\]]+\]\.(\w+)/g;
  while ((m = indexRe.exec(text)) !== null) {
    const arrName = m[1];
    const field = m[2];
    if (!reads.arrays[arrName]) reads.arrays[arrName] = new Set();
    reads.arrays[arrName].add(field);
  }

  return reads;
}

// ---------------------------------------------------------------------------
// 4. 数组名 → Snapshot 结构体名 的映射
// ---------------------------------------------------------------------------
const ARRAY_TO_STRUCT = {
  pois: 'PoiSnapshot',
  houses: 'HouseSnapshot',
  nodes: 'NodeSnapshot',
  lanes: 'LaneSnapshot',
  agents: 'AgentSnapshot',
  terrain_cells: 'GeoCellSnapshot',
  households: 'HouseholdSnapshot',
  marriages: 'MarriageSnapshot',
  clans: 'ClanSnapshot',
  regions: 'RegionSnapshot',
  public_granary_balances: 'LedgerBalanceSnapshot',
};

// WorldSnapshot3D 的顶层字段（非数组）
const WORLD_TOP_FIELDS = [
  'tick', 'grid_w', 'grid_h', 'world_size', 'tilt_angle_rad', 'tilt_magnitude',
  'total_births', 'total_deaths', 'total_deaths_natural', 'total_deaths_unnatural',
  'total_miscarriages', 'season', 'temperature', 'season_progress', 'last_mutation_event',
];

// 前端自添加字段白名单（非快照字段，前端在映射时自己计算/添加的派生字段）
const FRONTEND_DERIVED_FIELDS = new Set([
  'reverseId',  // lanes 映射中前端添加的反向查找 ID
]);

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function main() {
  console.log('=== Flow & Accord · 快照三处同步校验 ===\n');

  // 读取文件
  const snapshotText = fs.readFileSync(SNAPSHOT_RS, 'utf8');
  const houseText = fs.readFileSync(HOUSE_RS, 'utf8');
  const worldText = fs.readFileSync(WORLD_RS, 'utf8');
  const jsText = fs.readFileSync(RUSTWORLD_JS, 'utf8');

  // 1. 提取结构体定义（snapshot.rs + house.rs）
  const structs = { ...extractSnapshotStructs(snapshotText), ...extractSnapshotStructs(houseText) };

  // 2. 提取 world.rs 赋值
  const assignments = extractWorldAssignments(worldText);

  // 3. 提取 rustworld.js 读取
  const jsReads = extractJsReads(jsText);

  let errors = 0;
  let warnings = 0;

  // --- 检查 1：Rust 定义 vs world.rs 赋值 ---
  console.log('--- 检查 1：snapshot.rs 定义 vs world.rs 赋值 ---');
  for (const [structName, definedFields] of Object.entries(structs)) {
    const assignedFields = assignments[structName];
    if (!assignedFields) {
      console.log(`  ⚠ ${structName}: world.rs 中未找到构造块（可能在其他文件构造，或嵌套在其他表达式中）`);
      warnings++;
      continue;
    }

    // 定义了但未赋值
    const missingAssign = [...definedFields].filter(f => !assignedFields.has(f));
    // 赋值了但未定义（拼写错误）
    const extraAssign = [...assignedFields].filter(f => !definedFields.has(f));

    if (missingAssign.length > 0) {
      console.log(`  ✗ ${structName}: 定义了 ${missingAssign.length} 个字段但 world.rs 未赋值:`);
      for (const f of missingAssign) console.log(`    - ${f}`);
      errors += missingAssign.length;
    }
    if (extraAssign.length > 0) {
      console.log(`  ✗ ${structName}: world.rs 赋值了 ${extraAssign.length} 个未定义的字段（可能拼写错误）:`);
      for (const f of extraAssign) console.log(`    - ${f}`);
      errors += extraAssign.length;
    }
    if (missingAssign.length === 0 && extraAssign.length === 0) {
      console.log(`  ✓ ${structName}: ${definedFields.size} 字段全部赋值一致`);
    }
  }

  // --- 检查 2：WorldSnapshot3D 顶层字段 vs rustworld.js snap.xxx ---
  console.log('\n--- 检查 2：WorldSnapshot3D 顶层字段 vs rustworld.js 读取 ---');
  const worldStruct = structs['WorldSnapshot3D'];
  if (worldStruct) {
    // 顶层字段（排除数组字段）
    const topDefined = [...worldStruct].filter(f => WORLD_TOP_FIELDS.includes(f) || !ARRAY_TO_STRUCT[f]);
    const topRead = jsReads.topLevel;

    const missingRead = topDefined.filter(f => !topRead.has(f));
    const extraRead = [...topRead].filter(f => !worldStruct.has(f));

    if (missingRead.length > 0) {
      console.log(`  ⚠ WorldSnapshot3D: ${missingRead.length} 个顶层字段 rustworld.js 未读取（可能遗漏前端展示）:`);
      for (const f of missingRead) console.log(`    - ${f}`);
      warnings += missingRead.length;
    }
    if (extraRead.length > 0) {
      console.log(`  ✗ WorldSnapshot3D: rustworld.js 读取了 ${extraRead.length} 个未定义字段（可能拼写错误/已删除）:`);
      for (const f of extraRead) console.log(`    - ${f}`);
      errors += extraRead.length;
    }
    if (missingRead.length === 0 && extraRead.length === 0) {
      console.log(`  ✓ WorldSnapshot3D 顶层字段: 全部读取一致`);
    }
  }

  // --- 检查 3：数组元素字段 vs rustworld.js 读取 ---
  console.log('\n--- 检查 3：数组元素字段 vs rustworld.js 读取 ---');
  for (const [arrName, structName] of Object.entries(ARRAY_TO_STRUCT)) {
    const definedFields = structs[structName];
    const readFields = jsReads.arrays[arrName];

    if (!definedFields) {
      console.log(`  ⚠ ${arrName} → ${structName}: 结构体未找到`);
      warnings++;
      continue;
    }
    if (!readFields || readFields.size === 0) {
      console.log(`  ⚠ ${arrName} → ${structName}: rustworld.js 中未找到 map/for 读取（可能用其他方式映射）`);
      warnings++;
      continue;
    }

    // 定义了但未读取（警告：可能遗漏前端展示）
    const missingRead = [...definedFields].filter(f => !readFields.has(f));
    // 读取了但未定义（错误：拼写错误），排除前端自添加派生字段
    const extraRead = [...readFields].filter(f => !definedFields.has(f) && !FRONTEND_DERIVED_FIELDS.has(f));

    if (missingRead.length > 0) {
      console.log(`  ⚠ ${arrName} → ${structName}: ${missingRead.length} 个字段 rustworld.js 未读取（可能遗漏前端展示）:`);
      for (const f of missingRead) console.log(`    - ${f}`);
      warnings += missingRead.length;
    }
    if (extraRead.length > 0) {
      console.log(`  ✗ ${arrName} → ${structName}: rustworld.js 读取了 ${extraRead.length} 个未定义字段（可能拼写错误/已删除）:`);
      for (const f of extraRead) console.log(`    - ${f}`);
      errors += extraRead.length;
    }
    if (missingRead.length === 0 && extraRead.length === 0) {
      console.log(`  ✓ ${arrName} → ${structName}: ${definedFields.size} 字段全部读取一致`);
    }
  }

  // --- 汇总 ---
  console.log('\n=== 校验结果汇总 ===');
  console.log(`  快照结构体数: ${Object.keys(structs).length}`);
  console.log(`  错误 (必须修复): ${errors}`);
  console.log(`  警告 (建议检查): ${warnings}`);

  if (errors > 0) {
    console.log('\n❌ SNAPSHOT_CHECK_FAILED');
    process.exit(1);
  } else {
    console.log('\n✅ SNAPSHOT_CHECK_PASSED' + (warnings > 0 ? ' (有警告)' : ''));
    process.exit(0);
  }
}

main();
