#!/usr/bin/env node
/*
 * Flow & Accord · Markdown 相对链接可达性门禁 (doc-link-check.js)
 * ============================================================================
 * 用途：
 *   校验 docs/ 下全部 Markdown 的**相对链接**是否指向真实存在的文件/目录，
 *   捕获「文档迁移后路径深度未同步」「重命名后引用未更新」等失效引用。
 *
 *   为什么需要它（2026-09-12 技术债审计 §3）：
 *     `cross-doc-check.js` 只校验跨文档的**事实指纹**，`code-map-check.js` 只校验
 *     **源码文件**是否登记，**没有任何门禁校验 Markdown 链接是否可达**。
 *     结果是 2026-09-12 文档体系重构（`docs/*.md` → `docs/current/tech/*.md`，深两级）后，
 *     指向源码/工具/配置的 `../crates/…`、`../frontend/…`、`../.github/…` 整批失效却全绿通过——
 *     共 27 处散落 7 篇，直到人工审计才发现。
 *
 * 排除项（不是缺陷，勿报）：
 *   · `http(s)://` / `mailto:` / 纯 `#anchor` —— 非本地相对链接
 *   · `/` 开头的绝对路径 —— 多为示例占位符（如截图路径示例），不参与校验
 *
 * 用法：
 *   node tools/doc-link-check.js            # 校验全仓 Markdown
 *   node tools/doc-link-check.js --verbose  # 额外打印全部失效明细（默认只列前若干条）
 *
 * 退出码：存在任何失效链接时返回 1，否则 0。
 * 本工具零依赖，仅使用 Node 内置模块。
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');

/** 不参与扫描的目录（构建产物 / 缓存 / 归档冻结区） */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'target', '.toolchain', '.vendor', '.cargo-home',
  '.workbuddy', '.codebuddy', '.idea', '.playwright-cli', '.rust-dist',
]);

/** 收集全部 .md 文件 */
function collectMarkdown(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) collectMarkdown(p, out);
    } else if (ent.name.endsWith('.md')) {
      out.push(p);
    }
  }
  return out;
}

const ALLOWED_EXTS = new Set(['.md', '.js', '.rs', '.json', '.html', '.css', '.yml', '.yaml',
  '.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.txt', '.toml', '.wasm', '.ps1', '.sh']);

function main() {
  const files = collectMarkdown(ROOT);
  const broken = [];
  let total = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    const baseDir = path.dirname(file);
    const re = /\[([^\]]*)\]\(\s*(?!https?:|mailto:|#)([^)\s]+?)\s*\)/g;
    let m;
    while ((m = re.exec(text))) {
      let target = m[2].split('#')[0];
      if (!target) continue;                       // 纯锚点
      if (target.startsWith('/')) continue;        // 绝对路径示例占位符
      total++;
      try { target = decodeURIComponent(target); } catch (e) { /* 保持原样 */ }
      const abs = path.resolve(baseDir, target);
      if (!fs.existsSync(abs)) {
        const line = text.slice(0, m.index).split('\n').length;
        broken.push({ rel, line, label: m[1], target: m[2] });
      } else {
        // 形如 `a.md.md`、`file.js.js` 的重复后缀多为改写脚本误伤，单独提示
        const dupExt = /(\.[a-z0-9]+)\1$/i.exec(target);
        if (dupExt && ALLOWED_EXTS.has(dupExt[1].toLowerCase())) {
          const line = text.slice(0, m.index).split('\n').length;
          broken.push({ rel, line, label: m[1], target: m[2], note: '疑似重复扩展名' });
        }
      }
    }
  }

  console.log('=== Flow & Accord · Markdown 相对链接可达性检查 ===');
  console.log(`扫描文档: ${files.length} 篇 · 相对链接: ${total} 条 · 失效: ${broken.length} 条\n`);

  if (broken.length === 0) {
    console.log('✅ DOC_LINK_CHECK_PASSED —— 全部相对链接可达');
    process.exit(0);
  }

  const limit = VERBOSE ? broken.length : 30;
  for (const b of broken.slice(0, limit)) {
    console.log(`  ✗ ${b.rel}:${b.line}  ->  ${b.target}${b.note ? '  [' + b.note + ']' : ''}`);
  }
  if (broken.length > limit) {
    console.log(`  … 其余 ${broken.length - limit} 条（加 --verbose 查看全部）`);
  }
  console.log(`\n❌ DOC_LINK_CHECK_FAILED —— ${broken.length} 条失效链接`);
  console.log('   修法：文档迁入更深目录后，指向仓库根的相对路径需整体补一级（如 ../crates/ → ../../../crates/）。');
  process.exit(1);
}

main();
