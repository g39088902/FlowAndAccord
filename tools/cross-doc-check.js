#!/usr/bin/env node
/*
 * Flow & Accord · 跨文档事实指纹一致性检查器 (tools/cross-doc-check.js)
 * ============================================================================
 * 用途：
 *   解决「N 份文档，如何确保每两份之间没有冲突」的机检部分——不做 O(N²)
 *   全文比对，而是把可枚举事实（配置字段值 / 关键常量 / 结构数字）提取为
 *   「指纹」，同一指纹键在多篇文档中出现且值不同，即为文档间冲突。
 *
 *   两类检查：
 *     1. CONFLICT（文档 vs 文档）：同一指纹键在 ≥2 篇文档中值不同；
 *     2. DRIFT   （文档 vs 权威）：配置字段指纹与 frontend/js/config.js
 *        权威值不一致（自动读取，不硬编码数值，防自身漂移）。
 *
 * 用法：
 *   node tools/cross-doc-check.js            # 常规检查
 *   node tools/cross-doc-check.js --json     # 结构化输出（CI / 仪表盘）
 *
 * 退出码：0 = 全部一致；1 = 存在文档间冲突或权威漂移。
 *
 * 扫描范围：根 AGENTS.md + 各局部 AGENTS.md + docs 目录下全部 markdown。
 * 已知边界（有意排除）：
 *   - docs/current/01-changelog.md：历史版本记录，保留旧值；
 *   - docs/plan/ 目录：规划态文档描述愿景数值，不参与现状比对；
 *   - 版本号字符串：由 tools/bump-version.js --check 统一门禁，此处不重复；
 *   - 语义型冲突（机制描述 / 因果 / 归属自相矛盾）：无法机检，靠维护清单
 *     （doc-maintenance-check.js）+ 人工复核兜底。
 *
 * 零依赖，仅使用 Node 内置模块。
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = 'frontend/js/config.js';
const EXCLUDED = [
  new RegExp('^docs/current/01-changelog\\.md$'), // 历史版本记录，全是过去值
  new RegExp('^docs/plan/'),               // 规划文档（愿景态数值），不与现状比对
  new RegExp('^README\\.md$'),             // 对外营销文档，存在刻意简化表述
  new RegExp('^TODO\\.md$'),
];

// ---------------------------------------------------------------------------
// 1. 扫描目标文件
// ---------------------------------------------------------------------------
function allMdFiles() {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (['.git', 'node_modules', 'target', '.cargo-home'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.md$/i.test(e.name)) {
        const rel = path.relative(ROOT, p).split(path.sep).join('/');
        if (EXCLUDED.some((re) => re.test(rel))) continue;
        out.push(rel);
      }
    }
  }
  // 根 AGENTS.md + 局部 AGENTS.md
  for (const rel of ['AGENTS.md', 'crates/sim_core/AGENTS.md', 'crates/sim_core/src/spatial/AGENTS.md', 'crates/sim_core/src/spatial/decisions/AGENTS.md', 'crates/sim_core/src/spatial/housing_system/AGENTS.md', 'crates/sim_core/src/spatial/ledger/AGENTS.md', 'crates/sim_wasm/AGENTS.md', 'frontend/AGENTS.md']) {
    if (fs.existsSync(path.join(ROOT, rel))) out.push(rel);
  }
  walk(path.join(ROOT, 'docs'));
  return [...new Set(out)].sort();
}

function readText(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_) { return ''; }
}

// ---------------------------------------------------------------------------
// 2. 权威值读取（frontend/js/config.js，不硬编码数值）
// ---------------------------------------------------------------------------
let _configText = null;
function configText() {
  if (_configText === null) _configText = readText(CONFIG_FILE);
  return _configText;
}
function authorityValue(field) {
  if (field === '__configFieldCount__') {
    // 配置字段总数权威：config.rs SimConfig 结构体 pub 字段数（与 doc-maintenance-check 同口径）
    const m = readText('crates/sim_core/src/config.rs').match(/pub struct SimConfig \{([\s\S]*?)\n\}/);
    const body = m ? m[1] : readText('crates/sim_core/src/config.rs');
    const n = (body.match(/^\s*pub\s+\w+\s*:/gm) || []).length;
    return n ? String(n) : null;
  }
  if (field === '__toolCount__') {
    // tools 工具数权威：tools/ 目录下实际 .js 脚本数
    const n = (fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => f.endsWith('.js'))).length;
    return n ? String(n) : null;
  }
  const m = configText().match(new RegExp('\\b' + field + '\\s*:\\s*(-?[0-9]+(?:\\.[0-9]+)?)'));
  return m ? normalizeNum(m[1]) : null;
}

// ---------------------------------------------------------------------------
// 3. 指纹表
//    key   : 指纹键（同一事实的归一化标识）
//    re    : 提取正则（含捕获组）
//    norm  : 捕获组 → 归一化值
//    field : 可选的 config.js 权威字段名（存在则做 DRIFT 检查）
// ---------------------------------------------------------------------------
function normalizeNum(s) {
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}
function pairNorm(a, b) { return `${a}-${b}`; }

const CONFIG_FINGERPRINTS = [
  // 注意：分隔符用 [^0-9A-Za-z]（而非 \D），避免把类型名 u64 / f32 中的
  // 数字当作字段值（速查表 "| agentDecisionIntervalTicks | u64 | 120 |" 只应取 120）。
  { key: 'agentDecisionIntervalTicks', re: /agentDecisionIntervalTicks[^0-9A-Za-z]{0,16}?(?<![§#])(\d+)/g, norm: normalizeNum, field: 'agentDecisionIntervalTicks' },
  { key: 'decisionPoiSeekMinStockRatio', re: /decisionPoiSeekMinStockRatio[^0-9A-Za-z]{0,16}?(?<![§#])(\d+(?:\.\d+)?)/g, norm: normalizeNum, field: 'decisionPoiSeekMinStockRatio' },
  { key: 'decisionPoiAbandonStockRatio', re: /decisionPoiAbandonStockRatio[^0-9A-Za-z]{0,16}?(?<![§#])(\d+(?:\.\d+)?)/g, norm: normalizeNum, field: 'decisionPoiAbandonStockRatio' },
  { key: 'decisionFamilyStockTriggerOn', re: /decisionFamilyStockTriggerOn[^0-9A-Za-z]{0,16}?(?<![§#])(\d+(?:\.\d+)?)/g, norm: normalizeNum, field: 'decisionFamilyStockTriggerOn' },
  { key: 'decisionFamilyStockTriggerOff', re: /decisionFamilyStockTriggerOff[^0-9A-Za-z]{0,16}?(?<![§#])(\d+(?:\.\d+)?)/g, norm: normalizeNum, field: 'decisionFamilyStockTriggerOff' },
  { key: 'carryCapacityResource', re: /carryCapacityResource[^0-9A-Za-z]{0,16}?(?<![§#])(\d+(?:\.\d+)?)/g, norm: normalizeNum, field: 'carryCapacityResource' },
  { key: 'poiUnloadRateResource', re: /poiUnloadRateResource[^0-9A-Za-z]{0,16}?(?<![§#])(\d+(?:\.\d+)?)/g, norm: normalizeNum, field: 'poiUnloadRateResource' },
  { key: 'houseWinterColdTemp', re: /houseWinterColdTemp[^0-9A-Za-z]{0,16}?(?<![§#])(\d+(?:\.\d+)?)/g, norm: normalizeNum, field: 'houseWinterColdTemp' },
  { key: 'houseWinterWoodBurnRate', re: /houseWinterWoodBurnRate[^0-9A-Za-z]{0,16}?(?<![§#])(\d+(?:\.\d+)?)/g, norm: normalizeNum, field: 'houseWinterWoodBurnRate' },
  { key: 'decisionWorkStaminaThreshold', re: /decision_?work_?stamina_?threshold[^0-9A-Za-z]{0,16}?(?<![§#])(\d+(?:\.\d+)?)/g, norm: normalizeNum, field: 'decisionWorkStaminaThreshold' },
  { key: 'countCamps', re: /countCamps[^0-9A-Za-z]{0,16}?(?<![§#])(\d+)/g, norm: normalizeNum, field: 'countCamps' },
  { key: 'countBerryBushes', re: /countBerryBushes[^0-9A-Za-z]{0,16}?(?<![§#])(\d+)/g, norm: normalizeNum, field: 'countBerryBushes' },
  { key: 'countStoneMines', re: /countStoneMines[^0-9A-Za-z]{0,16}?(?<![§#])(\d+)/g, norm: normalizeNum, field: 'countStoneMines' },
  { key: 'countGoldMines', re: /countGoldMines[^0-9A-Za-z]{0,16}?(?<![§#])(\d+)/g, norm: normalizeNum, field: 'countGoldMines' },
  { key: 'countMarkets', re: /countMarkets[^0-9A-Za-z]{0,16}?(?<![§#])(\d+)/g, norm: normalizeNum, field: 'countMarkets' },
];

const PATTERN_FINGERPRINTS = [
  // 决策错峰相位：(tick + id) % 120 == 0 / % 120 == 0（权威 = agentDecisionIntervalTicks）
  { key: 'decisionPhaseTicks', re: /%\s*(\d+)\s*==\s*0/g, norm: normalizeNum, field: 'agentDecisionIntervalTicks' },
  // 配置字段总数声明：只匹配 SimConfig 上下文或 "共/总计 N 字段" 的≥100 声明，
  // 排除分区/矩阵等子集表述（如 "升级成本矩阵 20 字段"、"3 字段"）。权威 = config.rs 字段数。
  { key: 'configFieldCount', re: /SimConfig[^0-9]{0,20}?(\d{3,})\s*个?\s*字段/gi, norm: normalizeNum, field: '__configFieldCount__' },
  { key: 'configFieldCount', re: /(?:共|总计)\s*(\d{3,})\s*个?\s*字段/g, norm: normalizeNum, field: '__configFieldCount__' },
  // tools 工具数量总数声明：需带 "全部/共/目录下" 等前缀，排除 "6 个工具统一走 snapshot-reader" 类表述；
  // 权威 = tools 目录下实际 .js 脚本数（含公共模块）
  { key: 'toolCount', re: /(?:全部|共|总计|目录下|目录里的)\s*(\d+)\s*个\s*(?:tools\s*)?工具(?:脚本)?/g, norm: normalizeNum, field: '__toolCount__' },
  // POI 总量：共 23 处 POI
  { key: 'poiTotal', re: /(?:共\s*)?(\d+)\s*处\s*POI/g, norm: normalizeNum },
  // POI ID 段位（带连字符范围，低误报）
  { key: 'campIdRange', re: /营地\D{0,8}(\d+)\s*-\s*(\d+)/g, norm: pairNorm },
  { key: 'springIdRange', re: /清泉\D{0,8}(\d+)\s*-\s*(\d+)/g, norm: pairNorm },
  { key: 'berryIdRange', re: /浆果\D{0,8}(\d+)\s*-\s*(\d+)/g, norm: pairNorm },
  { key: 'forestIdRange', re: /林木\D{0,8}(\d+)\s*-\s*(\d+)/g, norm: pairNorm },
  { key: 'stoneIdRange', re: /石矿\D{0,8}(\d+)\s*-\s*(\d+)/g, norm: pairNorm },
];

// ---------------------------------------------------------------------------
// 4. 提取与聚合
// ---------------------------------------------------------------------------
function scanFile(rel, text, fingerprints, buckets) {
  for (const fp of fingerprints) {
    fp.re.lastIndex = 0;
    let m;
    while ((m = fp.re.exec(text)) !== null) {
      const value = fp.norm(...m.slice(1));
      if (!value) continue;
      const key = `${fp.key}:${value}`;
      (buckets[key] ||= { key: fp.key, value, docs: new Set() }).docs.add(rel);
      if (fp.field) {
        const auth = authorityValue(fp.field);
        if (auth !== null && normalizeNum(value) !== auth) {
          // 权威漂移 bucket：键必须含 value，避免不同值共享同一 bucket 导致文档串扰
          const dk = `${fp.key}@authority:${value}`;
          (buckets[dk] ||= { key: fp.key, value, docs: new Set(), authority: auth }).docs.add(rel);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. 报告
// ---------------------------------------------------------------------------
(function main() {
  const files = allMdFiles();
  const fingerprints = [...CONFIG_FINGERPRINTS, ...PATTERN_FINGERPRINTS];
  const buckets = {};
  for (const rel of files) scanFile(rel, readText(rel), fingerprints, buckets);

  // 汇总：按指纹键收集 distinct 值
  const byKey = {};
  for (const b of Object.values(buckets)) {
    (byKey[b.key] ||= []).push(b);
  }
  const keyCount = Object.keys(byKey).length;
  const conflicts = [];   // 文档间：同键多值
  const drifts = [];      // 文档 vs config.js 权威
  for (const [key, list] of Object.entries(byKey)) {
    if (list.some((b) => b.authority !== undefined)) {
      for (const b of list) if (b.authority !== undefined) drifts.push(b);
    }
    const distinct = new Map();
    for (const b of list) {
      const arr = distinct.get(b.value) || [];
      arr.push(b);
      distinct.set(b.value, arr);
    }
    if (distinct.size > 1) {
      for (const [, group] of distinct) {
        conflicts.push({ key, value: group[0].value, docs: [...new Set(group.flatMap((b) => [...b.docs]))] });
      }
    }
  }

  const json = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    scannedFiles: files.length,
    fingerprintKeys: keyCount,
    conflicts,
    drifts: drifts.map((d) => ({ key: d.key, docValue: d.value, authority: d.authority, docs: [...d.docs] })),
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(json, null, 2));
  } else {
    console.log('=== Flow & Accord · 跨文档事实指纹检查 ===');
    console.log(`扫描文档: ${files.length} 篇 · 指纹键: ${keyCount} 个 · 时间: ${json.checkedAt}`);
    for (const c of conflicts) {
      console.log(`⚠ CONFLICT  ${c.key} = ${c.value}  →  ${c.docs.join(', ')}`);
    }
    for (const d of json.drifts) {
      console.log(`⚠ DRIFT     ${d.key} = ${d.docValue}（权威 ${d.authority}）→  ${d.docs.join(', ')}`);
    }
    if (!conflicts.length && !drifts.length) console.log('✓ 全部指纹一致，未发现文档间冲突或权威漂移。');
    console.log(`\n汇总: 冲突 ${conflicts.length} · 漂移 ${drifts.length} · 文档 ${files.length}`);
  }

  if (conflicts.length || drifts.length) process.exitCode = 1;
})();
