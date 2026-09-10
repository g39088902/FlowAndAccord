#!/usr/bin/env node
/*
 * Flow & Accord · 前端静态一致性与语法校验门禁 (frontend-check.js)
 * ============================================================================
 * 用途：
 *   1. 语法检查：对 frontend/ 目录下全部 JS 文件执行语法解析（防语法错误瘫痪前端）
 *   2. DOM ID 校验：检查 JS 中通过 getElementById 调用的 DOM ID 在各前端 HTML 页面是否存在
 *
 * 用法：
 *   node tools/frontend-check.js
 *
 * 退出码：0 为全部通过，1 为存在语法错误或未捕获的遗漏 DOM ID。
 * 零依赖，仅使用 Node 内置模块。
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const JS_DIR = path.join(FRONTEND_DIR, 'js');
const HTML_FILES = fs.readdirSync(FRONTEND_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
  .map((entry) => path.join(FRONTEND_DIR, entry.name));

let hasError = false;

console.log('=== Flow & Accord · 前端静态一致性检查 ===');

// ---------------------------------------------------------------------------
// 1. JS 语法检查 (Syntax Check via node --check)
// ---------------------------------------------------------------------------
console.log('\n[1/2] 正在校验前端 JS 脚本语法 (node --check)...');
function getJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.bak')) {
      files.push(fullPath);
    }
  }
  return files;
}

const jsFiles = [
  ...getJsFiles(JS_DIR),
  path.join(FRONTEND_DIR, 'server.js')
].filter(f => fs.existsSync(f));

let syntaxPassed = 0;
for (const filePath of jsFiles) {
  const relPath = path.relative(ROOT, filePath);
  try {
    execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' });
    syntaxPassed++;
  } catch (err) {
    const msg = (err.stderr || err.stdout || Buffer.from(err.message)).toString();
    console.error(`❌ 语法错误: ${relPath}\n${msg}`);
    hasError = true;
  }
}
if (!hasError) {
  console.log(`✅ 语法检查通过：共 ${syntaxPassed} 个 JS 文件语法严格合法。`);
}

// ---------------------------------------------------------------------------
// 2. DOM ID 存在性检查 (DOM ID Existence Check)
// ---------------------------------------------------------------------------
console.log('\n[2/2] 正在校验 document.getElementById DOM 引用完整性...');
const declaredIds = new Set();

// 收集 HTML 页面中硬编码的 ID
for (const htmlFile of HTML_FILES) {
  const htmlContent = fs.readFileSync(htmlFile, 'utf8');
  const idDeclRegex = /\bid\s*=\s*["']([^"']+)["']/g;
  let idMatch;
  while ((idMatch = idDeclRegex.exec(htmlContent)) !== null) {
    declaredIds.add(idMatch[1]);
  }
}

// 收集 JS 中动态 innerHTML 创建的 ID（形如 id="xxx" 或 id='xxx'）
for (const filePath of jsFiles) {
  const code = fs.readFileSync(filePath, 'utf8');
  const innerHtmlIdRegex = /id\s*=\s*["'\\]+([a-zA-Z0-9_\-]+)["'\\]+/g;
  let m;
  while ((m = innerHtmlIdRegex.exec(code)) !== null) {
    declaredIds.add(m[1]);
  }
}

// 白名单：已确认属于可选容错探针的 ID
const ALLOWLIST = new Set([
  'insp-house-coord', // 可选坐标探测
  'stat-fps'          // 可选旧版 FPS 占位
]);

const idUsageRegex = /document\.getElementById\(\s*["']([^"']+)["']\s*\)/g;
const missingUsage = new Map(); // id -> [files]

for (const filePath of jsFiles) {
  const relPath = path.relative(ROOT, filePath);
  const code = fs.readFileSync(filePath, 'utf8');
  let m;
  while ((m = idUsageRegex.exec(code)) !== null) {
    const usedId = m[1];
    if (!declaredIds.has(usedId) && !ALLOWLIST.has(usedId)) {
      if (!missingUsage.has(usedId)) {
        missingUsage.set(usedId, []);
      }
      missingUsage.get(usedId).push(relPath);
    }
  }
}

if (missingUsage.size > 0) {
  console.error(`❌ 发现 ${missingUsage.size} 个未声明的 DOM ID：`);
  for (const [id, callers] of missingUsage.entries()) {
    console.error(`   - #${id} 被引用在: ${[...new Set(callers)].join(', ')}`);
  }
  hasError = true;
} else {
  console.log(`✅ DOM 引用检查通过：JS 中调用的全部 DOM ID 均在模板或 HTML 中完备定义。`);
}

// ---------------------------------------------------------------------------
// 总结
// ---------------------------------------------------------------------------
if (hasError) {
  console.error('\n💥 前端静态一致性校验失败，请修复上述问题！');
  process.exit(1);
} else {
  console.log('\n🎉 全部前端静态门禁检查通过！\n');
  process.exit(0);
}
