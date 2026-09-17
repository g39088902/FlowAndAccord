#!/usr/bin/env node
/*
 * Flow & Accord · 版本号统一升版器 (tools/bump-version.js)
 * ============================================================================
 * 用途：
 *   版本号「唯一真相源」= `frontend/index.html` 的版本徽章（`.version-tag`）。
 *   本工具一次性同步**全部版本号定义点**，杜绝手工遗漏造成的版本漂移。
 *
 *   典型事故（本工具要消灭的问题）：index.html 徽章已升到 v1.44.0，而
 *   `world_save.rs::SAVE_APP_VERSION` 与 `save-ui.js::DEFAULT_APP_VERSION`
 *   仍停留在 1.37.1 —— 存档门禁持续写入/校验旧版本号，旧档不会自动废弃。
 *
 * ★★ 版本号语义（v1.50.80 起定案，与 AGENTS.md §6 及 06 号文 §2.2 同源）
 *   版本号 = major.minor.patch，三段各有分工，**升哪一段决定旧存档是否还能用**：
 *
 *   | 段位 | 何时自增 | 对存档的影响 | 是否需重编译 WASM |
 *   | :--- | :--- | :--- | :--- |
 *   | patch（末尾） | 前端渲染 / 表现层优化等不触碰存档与数值逻辑的变更 | **旧存档继续可用** | 否 |
 *   | minor（中间） | 功能变化 / 数值逻辑变化 / 存档结构不兼容 | 旧存档自动废弃 | **是** |
 *   | major（首位） | 仅人工变更 | 旧存档自动废弃 | **是** |
 *
 *   落地方式：内核 `SAVE_APP_VERSION` 只存**兼容线** major.minor（如 `1.50`），
 *   加载判定取前两段比对 ⇒ patch 升版不动该常量，末尾差异不影响旧档。
 *   本工具据此把定义点分成两级：
 *     - `tier: 'compat'`（存档兼容线，两段）——仅 minor/major 升版时同步；
 *     - 其余（应用版本串，三段）——每次升版都同步。
 *
 * 用法：
 *   node tools/bump-version.js --check        # 校验一致性（漂移即 exit 1，CI / 提交门禁）
 *   node tools/bump-version.js --sync         # 全部定义点对齐到徽章版本（不自增）
 *   node tools/bump-version.js                # 自增 patch（1.50.79 → 1.50.80，旧档可用、无需重编译）
 *   node tools/bump-version.js --minor        # 自增 minor（1.50.80 → 1.51.0，废弃旧档、需重编译）
 *   node tools/bump-version.js --major        # 自增 major（人工决策）
 *   node tools/bump-version.js 1.51.0         # 指定版本
 *   任意模式可叠加 --dry-run（只打印不落盘）
 *
 * ⚠️ 只有当 `tier: 'compat'` 的定义点被改写时才需重编译 WASM 并同步双副本
 *    （AGENTS.md §4.1），否则浏览器仍是旧版本常量。
 *
 * 零依赖，仅使用 Node 内置模块。
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VER_RE = /\d+\.\d+\.\d+/;            // 三段（应用版本串：徽章 / 文档 / 前端常量）
const VER_RE_LOOSE = /\d+\.\d+(?:\.\d+)?/; // 两段或三段（存档兼容线常量允许两段）

// ─────────────────────────────────────────────────────────────
// 版本号定义点清单（新增定义点时必须登记到这里，否则 --check 不会覆盖）
// ─────────────────────────────────────────────────────────────
const SITES = [
  {
    id: 'index.html 版本徽章',
    file: 'frontend/index.html',
    re: /(<span class="version-tag"[^>]*>v)\d+\.\d+\.\d+(<\/span>)/g,
    source: true,
  },
  {
    // ★ v1.50.80：此常量是**存档兼容线**（只存 major.minor 两段），不是完整应用版本。
    //   仅在 minor / major 升版时同步 ⇒ 纯前端渲染优化的 patch 升版不动它，
    //   旧存档照常加载，也免去重编译 WASM。判定见 app_version_compat_line。
    id: 'world_save.rs SAVE_APP_VERSION（存档兼容线·编译进 WASM）',
    file: 'crates/sim_core/src/spatial/world_save.rs',
    re: /(pub const SAVE_APP_VERSION: &str = ")\d+\.\d+(?:\.\d+)?(";)/g,
    rust: true,
    tier: 'compat',
  },
  {
    id: 'save-ui.js DEFAULT_APP_VERSION',
    file: 'frontend/js/save-ui.js',
    re: /(const DEFAULT_APP_VERSION = ')\d+\.\d+\.\d+(';)/g,
  },
  {
    id: 'rustworld.js 引擎版本兜底串',
    file: 'frontend/js/rustworld.js',
    re: /(['"])v?\d+\.\d+\.\d+\1/g,
  },
  {
    // ★ v1.44.2 补登记：Worker 兜底串曾长期停留在 v1.38.0 且带 `v` 前缀，
    // 与内核 SAVE_APP_VERSION（无 `v`）格式不一致，导致存档门禁误判旧档。
    id: 'sim_worker.js Worker 版本兜底串',
    file: 'frontend/js/sim_worker.js',
    re: /(return ')v?\d+\.\d+\.\d+(';)/g,
  },
  {
    id: 'AGENTS.md §1 架构图版本',
    file: 'AGENTS.md',
    re: /(浏览器 UI \(版本: v)\d+\.\d+\.\d+(\))/g,
  },
  {
    id: 'AGENTS.md §2 步骤四版本',
    file: 'AGENTS.md',
    re: /(版本徽章 \*\*`v)\d+\.\d+\.\d+(`\*\*)/g,
  },
  {
    id: 'docs/current/README.md 版本行',
    file: 'docs/current/README.md',
    re: /(\*\*版本\*\*：v)\d+\.\d+\.\d+/g,
  },
  {
    id: 'docs/current/01-changelog.md 最新版本',
    file: 'docs/current/01-changelog.md',
    re: /(最新版本：\*\*v)\d+\.\d+\.\d+(\*\*)/g,
  },
  {
    id: 'docs/current/tech/06-snapshot-and-save.md 存档版本说明',
    file: 'docs/current/tech/06-snapshot-and-save.md',
    re: /(当前 \*\*)\d+\.\d+\.\d+(\*\*)/g,
  },
  {
    id: 'README.md 版本徽章',
    file: 'README.md',
    re: /(`v)\d+\.\d+\.\d+(` · `Rust 内核)/g,
  },
  {
    id: 'README.en.md 版本徽章',
    file: 'README.en.md',
    re: /(`v)\d+\.\d+\.\d+(` · `Rust core)/g,
  },
];

const SAVE_FORMAT_FILE = 'crates/sim_core/src/spatial/world_save.rs';

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────
function read(file) {
  const abs = path.join(ROOT, file);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

function scan(site) {
  const text = read(site.file);
  if (text === null) return { site, missing: true, versions: [], matches: [] };
  site.re.lastIndex = 0;
  const matches = text.match(site.re) || [];
  // ★ 兼容线定义点（两段）用宽松正则，其余（三段）用严格正则
  const re = site.tier === 'compat' ? VER_RE_LOOSE : VER_RE;
  const versions = matches
    .map((m) => (m.match(re) || [])[0])
    .filter(Boolean);
  return { site, missing: false, text, matches, versions };
}

/** 取版本号的兼容线（major.minor 两段） */
function compatLineOf(ver) {
  const [a, b] = ver.split('.').map(Number);
  return `${a}.${b}`;
}

/** 该定义点在当前应用版本下应写入的值（兼容线点取两段） */
function expectedFor(site, ver) {
  return site.tier === 'compat' ? compatLineOf(ver) : ver;
}

/** 该定义点内容替换时使用的版本号正则 */
function replaceRe(site) {
  return site.tier === 'compat' ? VER_RE_LOOSE : VER_RE;
}

function currentVersion() {
  const src = SITES.find((s) => s.source);
  const r = scan(src);
  if (r.missing || !r.versions.length) {
    console.error(`❌ 无法从 ${src.file} 读取版本徽章（唯一真相源缺失）`);
    process.exit(2);
  }
  return r.versions[0];
}

function bump(ver, kind) {
  const [a, b, c] = ver.split('.').map(Number);
  if (kind === 'major') return `${a + 1}.0.0`;
  if (kind === 'minor') return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

function formatVersion(ver) {
  const [a, b, c] = ver.split('.').map(Number);
  return `${a}.${b}.${c}`;
}

// ─────────────────────────────────────────────────────────────
// 模式一：--check 一致性门禁
// ─────────────────────────────────────────────────────────────
function runCheck(expected) {
  console.log('=== Flow & Accord · 版本号一致性检查 ===\n');
  console.log(`唯一真相源（frontend/index.html 徽章）: v${expected}\n`);

  let drift = 0;
  let missing = 0;
  let unmatched = 0;

  for (const site of SITES) {
    const r = scan(site);
    if (r.missing) {
      console.log(`❌ 缺失文件  ${site.id}  →  ${site.file}`);
      missing++;
      continue;
    }
    if (!r.versions.length) {
      console.log(`⚠️  未命中    ${site.id}  →  ${site.file}（正则未匹配到版本号，请检查定义点是否改名）`);
      unmatched++;
      continue;
    }
    const want = expectedFor(site, expected);
    const kind = site.tier === 'compat' ? '（存档兼容线）' : '';
    const bad = r.versions.filter((v) => v !== want);
    if (bad.length) {
      console.log(`❌ 版本漂移  ${site.id}${kind}`);
      console.log(`              ${site.file}: v${r.versions.join(', v')}  ≠  v${want}`);
      drift++;
    } else {
      console.log(`✅ 一致      ${site.id}${kind}  →  v${want}（${r.versions.length} 处）`);
    }
  }

  const fmtText = read(SAVE_FORMAT_FILE) || '';
  const fmt = (fmtText.match(/pub const SAVE_FORMAT_VERSION: u32 = (\d+);/) || [])[1];
  console.log(`\nℹ️  SAVE_FORMAT_VERSION = ${fmt || '未知'}（存档结构版本，仅在字段增删/不兼容变更时手工自增，不随应用版本变化）`);
  console.log(`ℹ️  存档兼容线 = v${compatLineOf(expected)}（SAVE_APP_VERSION，仅中间/大版本变更时推进；末尾版本升版不影响旧存档）`);

  console.log(`\n汇总: 一致 ${SITES.length - drift - missing - unmatched} · 漂移 ${drift} · 缺失 ${missing} · 未命中 ${unmatched}`);

  if (drift || missing) {
    console.log('\n❌ 版本号检查未通过。请运行 `node tools/bump-version.js --sync` 对齐，或 `--patch` 升版。');
    process.exit(1);
  }
  if (unmatched) {
    console.log('\n⚠️  存在未命中的定义点（可能是正则过时），请更新 tools/bump-version.js 的 SITES 清单。');
  } else {
    console.log('✅ 全部版本号定义点一致。');
  }
}

// ─────────────────────────────────────────────────────────────
// 模式二：升版 / 对齐
// ─────────────────────────────────────────────────────────────
function runBump(from, to, dryRun) {
  console.log('=== Flow & Accord · 版本号统一升版 ===\n');
  console.log(`版本变更: v${from}  →  v${to}${dryRun ? '  (--dry-run 预览，不写盘)' : ''}\n`);

  const changed = [];
  for (const site of SITES) {
    const r = scan(site);
    if (r.missing) {
      console.log(`⚠️  跳过（文件不存在）  ${site.file}`);
      continue;
    }
    if (!r.versions.length) {
      console.log(`⚠️  跳过（正则未命中）  ${site.file}  ← 需更新 SITES 清单`);
      continue;
    }
    const want = expectedFor(site, to);
    if (r.versions.every((v) => v === want)) {
      console.log(`·  已是 v${want}        ${site.id}${site.tier === 'compat' ? '（兼容线不变）' : ''}`);
      continue;
    }
    site.re.lastIndex = 0;
    const re = replaceRe(site);
    const next = r.text.replace(site.re, (m) => m.replace(re, want));
    if (!dryRun) fs.writeFileSync(path.join(ROOT, site.file), next, 'utf8');
    console.log(`✏️  v${r.versions.join('/v')} → v${want}   ${site.id}  (${site.file})`);
    changed.push(site);
  }

  const rustTouched = changed.some((s) => s.rust);
  const compatChanged = changed.some((s) => s.tier === 'compat');
  const kindLabel = compatChanged ? '中间版本（minor/major）' : '末尾版本（patch）';
  console.log(`\n已更新定义点: ${changed.length} 个文件  ·  升版类型: ${kindLabel}`);

  console.log('\n┌──────────────── 升版后必做清单 ────────────────┐');
  if (rustTouched) {
    console.log('│ 1. 存档兼容线已推进 → 必须重编译 WASM 并同步双副本（AGENTS.md §4.1）:');
    console.log('│    cargo build -p sim_wasm --target wasm32-unknown-unknown --release');
    console.log('│    Copy-Item ...\\sim_wasm.wasm -Destination frontend\\rust\\sim_wasm.wasm -Force');
    console.log('│    Copy-Item ...\\sim_wasm.wasm -Destination frontend\\sim_wasm.wasm -Force');
  } else {
    console.log('│ 1. 兼容线未变，未改动 Rust 常量 → 无需重编译 WASM（纯前端/文档升版）。');
  }
  console.log(`│ 2. 在 docs/current/01-changelog.md 追加 **v${to}** 条目（表头已自动更新）。`);
  console.log('│ 3. 跑门禁: node tools/bump-version.js --check');
  console.log('│            node tools/frontend-check.js && node tools/test-wasm.js');
  console.log('└──────────────────────────────────────────────┘');

  if (compatChanged) {
    console.log('\n⚠️  存档兼容线变更将自动废弃全部旧存档（设计行为，见 docs/current/tech/06-snapshot-and-save.md §2.2）。');
  } else {
    console.log(`\n✅ 末尾版本升版（兼容线 v${compatLineOf(to)} 未变）：旧存档继续可用，无需重开世界。`);
  }
}

// ─────────────────────────────────────────────────────────────
// CLI 入口
// ─────────────────────────────────────────────────────────────
(function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const current = currentVersion();

  if (args.includes('--check')) {
    runCheck(current);
    return;
  }

  let target;
  if (args.includes('--sync')) {
    target = current;
  } else if (args.includes('--major')) {
    target = bump(current, 'major');
  } else if (args.includes('--minor')) {
    target = bump(current, 'minor');
  } else {
    // 无显式版本时默认自增 patch（显式 --patch 亦落此分支）
    const explicit = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
    target = explicit ? formatVersion(explicit) : bump(current, 'patch');
  }

  if (target === current && !args.includes('--sync')) {
    console.log(`当前版本已是 v${current}，未做变更。使用 --sync 可强制对齐全部定义点。`);
    return;
  }
  runBump(current, target, dryRun);
})();

