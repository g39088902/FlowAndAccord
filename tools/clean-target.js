#!/usr/bin/env node
/**
 * tools/clean-target.js · target/ 清理器（★ v1.50.82）
 * ============================================================================
 * 目的：清理 target/ 中**本项目用不到**的构建产物，抑制磁盘占用膨胀。
 *
 * 背景：target/ 一度涨到 1.6 GB，其中 928 MB 是**宿主平台（x86 Windows）的 debug 产物**——
 *   本项目只发布 wasm32，这些产物纯属占用。详见根 AGENTS.md §4.10.1 与 Cargo.toml 注释。
 *
 * 用法：
 *   node tools/clean-target.js              # 预览：只统计，不删除（默认安全）
 *   node tools/clean-target.js --dry-run    # 同上（显式）
 *   node tools/clean-target.js --yes        # 实际执行删除
 *   node tools/clean-target.js --all --yes  # 连 wasm32 的 dev-wasm 缓存一起清（保留 release）
 *
 * 清理范围（默认）：
 *   target/debug                            # 宿主 x86 debug 产物（最大头）
 *   target/release                          # 宿主 x86 release（由 cargo test --lib 产生，该门禁已移除）
 *   target/wasm32-unknown-unknown/debug     # wasm32 dev 产物（dev profile 会触发 rustc ICE，已不可用）
 *
 * 始终保留（绝不删）：
 *   target/wasm32-unknown-unknown/release   # 发布产物，前端双副本的来源
 *   target/wasm32-unknown-unknown/dev-wasm  # 本地迭代缓存（--all 时才删，删了重编即可）
 *
 * 零依赖，仅使用 Node 内置模块。
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'target');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--yes') || argv.includes('-y');
const ALL = argv.includes('--all');

// 默认清理目标（相对 target/ 的路径）
const DEFAULT_TARGETS = [
  'debug',                              // 宿主 x86 debug（928 MB 级）
  'release',                            // 宿主 x86 release（122 MB 级）
  'wasm32-unknown-unknown/debug',       // wasm32 dev（275 MB 级，dev profile 已不可用）
];
// --all 时追加
const EXTRA_TARGETS = [
  'wasm32-unknown-unknown/dev-wasm',    // 本地迭代缓存（52 MB 级）
];
// 永不删除（双保险）
const PROTECTED = [
  'wasm32-unknown-unknown/release',
];

function dirSize(dir) {
  let total = 0;
  let walk;
  walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      try {
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) total += fs.statSync(p).size;
      } catch { /* 权限/竞争忽略 */ }
    }
  };
  walk(dir);
  return total;
}

function fmtMB(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

// 保护检查：任何待删路径都不能是保护路径或其父级
function isProtected(rel) {
  return PROTECTED.some((p) => rel === p || p.startsWith(rel + '/') || p.startsWith(rel + '\\'));
}

console.log('=== Flow & Accord · target 清理器 ===\n');
if (!fs.existsSync(TARGET)) {
  console.log('target/ 不存在，无需清理。');
  process.exit(0);
}

const before = dirSize(TARGET);
console.log(`当前 target/ 占用: ${fmtMB(before)}\n`);

const list = ALL ? [...DEFAULT_TARGETS, ...EXTRA_TARGETS] : DEFAULT_TARGETS;
let totalFreed = 0;
const removed = [];
const skipped = [];

for (const rel of list) {
  if (isProtected(rel)) { skipped.push(`${rel}（受保护，跳过）`); continue; }
  const abs = path.join(TARGET, rel);
  if (!fs.existsSync(abs)) { skipped.push(`${rel}（不存在，跳过）`); continue; }
  const size = dirSize(abs);
  removed.push({ rel, size });
  totalFreed += size;
  if (APPLY) {
    fs.rmSync(abs, { recursive: true, force: true });
    console.log(`🗑️  已删除  ${rel.padEnd(38)} ${fmtMB(size).padStart(10)}`);
  } else {
    console.log(`·  待删除  ${rel.padEnd(38)} ${fmtMB(size).padStart(10)}`);
  }
}

for (const s of skipped) console.log(`·  跳过    ${s}`);

const after = APPLY ? dirSize(TARGET) : before - totalFreed;
console.log(`\n${APPLY ? '清理后' : '预计清理后'} target/ 占用: ${fmtMB(after)}`);
console.log(`${APPLY ? '已释放' : '预计释放'}: ${fmtMB(totalFreed)}`);

// 校验发布产物仍在
const releaseWasm = path.join(TARGET, 'wasm32-unknown-unknown', 'release', 'sim_wasm.wasm');
if (fs.existsSync(releaseWasm)) {
  console.log(`\n✅ 发布产物完好: ${path.relative(ROOT, releaseWasm)} (${fs.statSync(releaseWasm).size} 字节)`);
} else if (APPLY) {
  console.log('\n⚠️  未找到 release 产物（可能尚未构建），前端双副本不受影响。');
}

if (!APPLY) {
  console.log('\n这是预览模式，未做任何删除。实际执行请加 --yes');
  console.log('（加 --all 可额外清理 wasm32/dev-wasm 迭代缓存，重编即可恢复）');
}
