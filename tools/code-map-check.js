#!/usr/bin/env node
/*
 * Flow & Accord · 代码地图一致性校验工具 (code-map-check.js)
 * ============================================================================
 * 用途：
 *   扫描实际文件树（crates/ + frontend/）与 docs/current/09-code-map.md
 *   中登记的文件清单做交叉对比，捕获：
 *     1. 文档缺失（实际有文件但代码地图未登记）
 *     2. 文档过时（代码地图登记了但实际已删除/重命名）
 *     3. 描述关键词漂移（如代码地图仍写"仓储"但代码中已无 pantry 字段）
 *
 * 用法：
 *   node tools/code-map-check.js
 *
 * 退出码：发现任何不一致时返回 1，否则 0。
 * 本工具零依赖，仅使用 Node 内置模块。
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CODE_MAP_MD = path.join(ROOT, 'docs', 'current', '09-code-map.md');

// ---------------------------------------------------------------------------
// 1. 扫描实际文件树
// ---------------------------------------------------------------------------
function scanActualFiles() {
  const files = new Set();
  const targets = [
    path.join(ROOT, 'crates'),
    path.join(ROOT, 'frontend'),
    path.join(ROOT, 'tools'),
    path.join(ROOT, '.github'),
    path.join(ROOT, 'docs'),
  ];

  // 根目录的 md 文件单独处理
  const rootMds = ['AGENTS.md', 'README.md', 'TODO.md'];
  for (const f of rootMds) {
    const full = path.join(ROOT, f);
    if (fs.existsSync(full)) files.add(f);
  }

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        // 跳过构建产物和缓存
        if (e.name === 'target' || e.name === 'node_modules' || e.name === '.cargo-home') continue;
        walk(full);
      } else if (e.isFile()) {
        const rel = path.relative(ROOT, full).replace(/\\/g, '/');
        // 只跟踪源码和配置文件，跳过 wasm 二进制和锁文件
        if (/\.(rs|js|ts|html|css|toml|yml|yaml|json|md)$/.test(rel) &&
            !rel.endsWith('.wasm') &&
            !rel.endsWith('Cargo.lock')) {
          files.add(rel);
        }
      }
    }
  }

  for (const t of targets) {
    if (fs.existsSync(t)) walk(t);
  }
  return files;
}

// ---------------------------------------------------------------------------
// 2. 解析 09-code-map.md 中的文件清单
//    从代码块中提取所有文件路径（含 .rs/.js/.yml/.md 等）
// ---------------------------------------------------------------------------
function parseCodeMapFiles(text) {
  const files = new Set();
  // 提取 ```text ... ``` 代码块
  const blockRe = /```text\n([\s\S]*?)```/g;
  let blockMatch;
  while ((blockMatch = blockRe.exec(text)) !== null) {
    const block = blockMatch[1];
    // 逐行提取文件名：匹配路径片段中的 xxx.ext
    // 树形符号行如：│   │       ├── config.rs                   # 说明
    const lineRe = /(?:^|\s)([a-zA-Z0-9_./-]+\.(?:rs|js|ts|html|css|toml|yml|yaml|json|md|wasm))/g;
    let m;
    while ((m = lineRe.exec(block)) !== null) {
      let filePath = m[1];
      // 去掉可能的行内注释残留
      filePath = filePath.replace(/#.*$/, '').trim();
      // 代码地图中写的是相对路径片段，需要补全为相对于 ROOT 的路径
      // 例如 "config.rs" 在 crates/sim_core/src/ 下，但代码地图用树形表示
      // 我们收集所有出现的文件名，后续用"文件名匹配"做粗粒度对比
      files.add(filePath);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// 3. 构建代码地图中的"目录→文件"映射（基于树形缩进）
// ---------------------------------------------------------------------------
function parseCodeMapTree(text) {
  const blockRe = /```text\n([\s\S]*?)```/g;
  const blockMatch = blockRe.exec(text);
  if (!blockMatch) return { dirs: new Map(), files: new Set() };

  const block = blockMatch[1];
  const lines = block.split('\n');

  // 用栈维护当前路径前缀
  const pathStack = []; // [{ indent, name }]
  const allFiles = new Set();
  const dirMap = new Map(); // dirPath -> Set of fileNames

  for (const line of lines) {
    if (!line.trim()) continue;
    // 计算缩进层级：树形符号前的空格数
    const indentMatch = line.match(/^([\s│├└─]*?)([a-zA-Z0-9_./-]+)/);
    if (!indentMatch) continue;

    const prefix = indentMatch[1];
    const name = indentMatch[2];
    // 缩进层级：每 4 空格或一组树形符号算一级
    const level = Math.floor(prefix.length / 4);

    // 弹出栈中大于等于当前层级的元素
    while (pathStack.length > level) {
      pathStack.pop();
    }

    const isDir = !/\.(rs|js|ts|html|css|toml|yml|yaml|json|md|wasm)$/.test(name);

    if (isDir) {
      // 去掉尾部斜杠，避免 join 时产生双斜杠
      pathStack.push({ name: name.replace(/\/$/, ''), isDir: true });
    } else {
      // 文件：构建完整相对路径
      const dirParts = pathStack.filter(p => p.isDir).map(p => p.name);
      // 代码地图根目录是 FlowAndAccord/，需要去掉
      const relDir = dirParts.slice(1).join('/');
      const relPath = relDir ? `${relDir}/${name}` : name;
      allFiles.add(relPath);

      if (!dirMap.has(relDir)) dirMap.set(relDir, new Set());
      dirMap.get(relDir).add(name);
    }
  }

  return { dirs: dirMap, files: allFiles };
}

// ---------------------------------------------------------------------------
// 4. 描述关键词漂移检测
// ---------------------------------------------------------------------------
function detectDescriptionDrift(text) {
  const warnings = [];

  // 检测代码地图中仍声称"有仓储"但 house.rs 已无 pantry
  // 注意：排除"无仓储"/"去仓储"/"删除仓储"这类否定表述
  const hasStorageClaim = /(独立仓储|pantry|库存容量|max_pantry|仓储容量)/i.test(text) &&
    !/(无仓储|去仓储|删除仓储|仓储已删|不含仓储)/i.test(text);
  if (hasStorageClaim) {
    const houseRs = fs.readFileSync(path.join(ROOT, 'crates', 'sim_core', 'src', 'spatial', 'house.rs'), 'utf8');
    if (!/pantry/i.test(houseRs)) {
      warnings.push('代码地图仍声称存在"仓储/pantry"，但 house.rs 已删除 pantry 字段（M6 起家户账本为唯一真相源）');
    }
  }

  // 检测代码地图中 decisions/ 文件数是否与实际一致
  const decisionsDir = path.join(ROOT, 'crates', 'sim_core', 'src', 'spatial', 'decisions');
  if (fs.existsSync(decisionsDir)) {
    const actualRsFiles = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.rs')).length;
    const docMatch = text.match(/decisions\/\s*[（(](\d+)\s*个/);
    if (docMatch) {
      const docCount = parseInt(docMatch[1], 10);
      if (docCount !== actualRsFiles) {
        warnings.push(`代码地图写 decisions/ 有 ${docCount} 个文件，实际有 ${actualRsFiles} 个 .rs 文件`);
      }
    }
  }

  // 检测前端 JS 文件数
  const jsDir = path.join(ROOT, 'frontend', 'js');
  if (fs.existsSync(jsDir)) {
    const actualJsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).length;
    // 代码地图或 AGENTS.md 中可能写"9 个 JS 文件"
    if (/9\s*个\s*JS/i.test(text) || /9 个 JS 文件/.test(text)) {
      if (actualJsFiles !== 9) {
        warnings.push(`文档写"9 个 JS 文件"，实际 frontend/js/ 有 ${actualJsFiles} 个 .js 文件`);
      }
    }
  }

  // 检测 SimConfig 字段数
  const configRs = fs.readFileSync(path.join(ROOT, 'crates', 'sim_core', 'src', 'config.rs'), 'utf8');
  const structMatch = configRs.match(/pub struct SimConfig\s*\{([\s\S]*?)\}/);
  if (structMatch) {
    const fieldCount = (structMatch[1].match(/^\s*pub\s+\w+/gm) || []).length;
    const docFieldMatch = text.match(/(\d+)\s*字段/);
    if (docFieldMatch) {
      const docCount = parseInt(docFieldMatch[1], 10);
      if (Math.abs(docCount - fieldCount) > 2) { // 允许 2 个误差（注释行等）
        warnings.push(`代码地图写 SimConfig 约 ${docCount} 字段，实际 config.rs 有 ${fieldCount} 个 pub 字段`);
      }
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function main() {
  console.log('=== Flow & Accord · 代码地图一致性校验 ===\n');

  if (!fs.existsSync(CODE_MAP_MD)) {
    console.error('ERROR: 代码地图文件不存在: ' + CODE_MAP_MD);
    process.exit(1);
  }

  const codeMapText = fs.readFileSync(CODE_MAP_MD, 'utf8');
  const actualFiles = scanActualFiles();
  const parsed = parseCodeMapTree(codeMapText);
  const docFiles = parsed.files;

  let errors = 0;
  let warnings = 0;

  // --- 检查 1：实际有但文档未登记 ---
  console.log('--- 检查 1：实际文件 vs 代码地图登记 ---');
  // 构建配置文件不强制在代码地图登记（代码地图定位为源码映射）
  const BUILD_CONFIG_FILES = new Set([
    'crates/sim_core/Cargo.toml',
    'crates/sim_wasm/Cargo.toml',
    'frontend/package.json',
    'Cargo.toml',
    'Cargo.lock',
  ]);

  const missingInDoc = [];
  for (const f of actualFiles) {
    // 跳过一些不需要在代码地图登记的文件
    if (f.startsWith('.git/') || f.includes('/.idea/') || f.includes('/.codebuddy/')) continue;
    if (f.endsWith('.md') && !f.startsWith('docs/')) continue; // 非 docs 目录的 md 不强制登记
    if (BUILD_CONFIG_FILES.has(f)) continue;
    if (!docFiles.has(f)) {
      // 尝试模糊匹配：文件名相同但路径不同
      const baseName = path.basename(f);
      const fuzzyMatch = [...docFiles].some(d => path.basename(d) === baseName);
      if (!fuzzyMatch) {
        missingInDoc.push(f);
      }
    }
  }

  if (missingInDoc.length > 0) {
    console.log(`  ⚠ 实际有 ${missingInDoc.length} 个文件未在代码地图中登记：`);
    for (const f of missingInDoc.sort()) {
      console.log(`    - ${f}`);
    }
    warnings += missingInDoc.length;
  } else {
    console.log('  ✓ 所有实际文件均已在代码地图中登记');
  }

  // --- 检查 2：文档登记了但实际不存在 ---
  const missingInActual = [];
  for (const f of docFiles) {
    if (!actualFiles.has(f)) {
      // 跳过 wasm（构建产物）和目录
      if (f.endsWith('.wasm')) continue;
      missingInActual.push(f);
    }
  }

  if (missingInActual.length > 0) {
    console.log(`\n  ⚠ 代码地图登记了 ${missingInActual.length} 个但实际不存在的文件（可能已删除/重命名）：`);
    for (const f of missingInActual.sort()) {
      console.log(`    - ${f}`);
    }
    errors += missingInActual.length;
  } else {
    console.log('\n  ✓ 代码地图登记的所有文件均存在');
  }

  // --- 检查 3：描述关键词漂移 ---
  console.log('\n--- 检查 3：描述关键词漂移 ---');
  const driftWarnings = detectDescriptionDrift(codeMapText);
  if (driftWarnings.length > 0) {
    for (const w of driftWarnings) {
      console.log(`  ⚠ ${w}`);
    }
    warnings += driftWarnings.length;
  } else {
    console.log('  ✓ 未检测到明显的描述关键词漂移');
  }

  // --- 检查 4：嵌套 AGENTS.md 与目录对应 ---
  console.log('\n--- 检查 4：嵌套 AGENTS.md 覆盖 ---');
  const nestedAgents = [
    'crates/sim_core/AGENTS.md',
    'crates/sim_wasm/AGENTS.md',
    'crates/sim_core/src/spatial/AGENTS.md',
    'crates/sim_core/src/spatial/decisions/AGENTS.md',
    'crates/sim_core/src/spatial/housing_system/AGENTS.md',
    'crates/sim_core/src/spatial/ledger/AGENTS.md',
    'frontend/AGENTS.md',
  ];
  let agentsOk = true;
  for (const a of nestedAgents) {
    if (!fs.existsSync(path.join(ROOT, a))) {
      console.log(`  ✗ 缺失: ${a}`);
      agentsOk = false;
      errors++;
    }
  }
  if (agentsOk) {
    console.log(`  ✓ 全部 ${nestedAgents.length} 个嵌套 AGENTS.md 均存在`);
  }

  // --- 汇总 ---
  console.log('\n=== 校验结果汇总 ===');
  console.log(`  实际扫描文件数: ${actualFiles.size}`);
  console.log(`  代码地图登记数: ${docFiles.size}`);
  console.log(`  错误 (必须修复): ${errors}`);
  console.log(`  警告 (建议修复): ${warnings}`);

  if (errors > 0) {
    console.log('\n❌ CODE_MAP_CHECK_FAILED');
    process.exit(1);
  } else if (warnings > 0) {
    console.log('\n⚠ CODE_MAP_CHECK_WARNINGS');
    process.exit(0); // 警告不阻断，但建议修复
  } else {
    console.log('\n✅ CODE_MAP_CHECK_PASSED');
    process.exit(0);
  }
}

main();
