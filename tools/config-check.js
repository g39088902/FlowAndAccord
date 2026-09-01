#!/usr/bin/env node
/*
 * Flow & Accord · 配置一致性校验与速查表生成工具 (config-check.js)
 * ============================================================================
 * 用途：
 *   1. 交叉校验 frontend/js/config.js 与 Rust SimConfig (crates/sim_core/src/config.rs)
 *      的字段集、类型与默认值是否完全一致，捕获「孤儿字段 / 缺失字段 / 类型错配 / 数值漂移」。
 *   2. 生成 docs/config-reference.md —— 一份带中文说明的参数速查表，降低用户检索与调参成本。
 *
 * 用法：
 *   node tools/config-check.js
 *
 * 退出码：发现任何错误 (孤儿/缺失/类型/数值漂移) 时返回 1，否则 0。
 * 本工具零依赖，仅使用 Node 内置模块。
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_JS = path.join(ROOT, 'frontend', 'js', 'config.js');
const CONFIG_RS = path.join(ROOT, 'crates', 'sim_core', 'src', 'config.rs');
const OUT_MD = path.join(ROOT, 'docs', 'config-reference.md');

// ---------------------------------------------------------------------------
// 解析 frontend/js/config.js
//   - 提取每个键的值（含 `1.0/30.0` 这类表达式求值）与行内中文说明
// ---------------------------------------------------------------------------
function parseConfigJs(text) {
  const objMatch = text.match(/window\.SIM_CONFIG\s*=\s*(\{[\s\S]*?\});/);
  if (!objMatch) throw new Error('无法在 config.js 中定位 window.SIM_CONFIG 对象');
  const body = objMatch[1];
  // 在受控作用域内求值对象字面量（允许 1.0/30.0 等表达式）
  const values = (function () { return eval('(' + body + ')'); })();

  // 行内中文说明：匹配 `key: value, // 说明`
  const descriptions = {};
  const lineRe = /(\w+)\s*:\s*[^,]*,\s*\/\/\s*(.*)/g;
  let m;
  while ((m = lineRe.exec(text)) !== null) {
    descriptions[m[1]] = m[2].trim();
  }
  return { values, descriptions };
}

// ---------------------------------------------------------------------------
// 解析 Rust config.rs
//   - 提取 SimConfig 结构体字段（转 camelCase 以匹配 JSON 键、类型、所属分区）
//   - 提取 Default 映射（字段 -> SCREAMING_CONST）
//   - 提取 const 默认值与其所属分区（SCREAMING_CONST -> 求值）
// ---------------------------------------------------------------------------
function snakeToCamel(s) {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function parseConfigRs(text) {
  const fields = [];        // { name(camel), rustName, type }
  const defaults = {};       // field(camel) -> constName
  const consts = {};         // constName -> { type, raw, value, section }

  let currentSection = '';
  const sectionRe = /\/\/\s*(\d+)\.\s*([^\n(]+)/;
  const defaultStart = text.indexOf('impl Default for SimConfig');
  const fnDefaultPos = text.indexOf('fn default()', defaultStart);
  const defaultEnd = text.indexOf('}', fnDefaultPos);
  // 转行号（用于与逐行扫描的 i 比较，避免字符索引误判）
  const defaultStartLine = text.slice(0, defaultStart).split('\n').length - 1;
  const defaultEndLine = text.slice(0, defaultEnd).split('\n').length - 1;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sec = line.match(sectionRe);
    if (sec) currentSection = `${sec[1]}. ${sec[2].trim()}`;

    // 结构体字段（仅捕获 `pub name: Type,`）
    const f = line.match(/^\s*pub\s+(\w+)\s*:\s*([\w]+)\s*,/);
    if (f) {
      fields.push({ name: snakeToCamel(f[1]), rustName: f[1], type: f[2] });
    }

    // Default 映射（仅捕获 `name: CONST,` 在 impl Default 块内）
    const d = line.match(/^\s*(\w+)\s*:\s*([A-Z_][A-Z0-9_]*)\s*,/);
    if (d && i >= defaultStartLine && i <= defaultEndLine) {
      defaults[snakeToCamel(d[1])] = d[2];
    }
  }

  // const 定义（全文件，记录所属分区）
  const constRe = /pub\s+const\s+(\w+)\s*:\s*([\w]+)\s*=\s*([^;]+);/g;
  let c;
  while ((c = constRe.exec(text)) !== null) {
    const raw = c[3].trim();
    let value;
    try { value = eval(raw); } catch (e) { value = raw; }
    consts[c[1]] = { type: c[2], raw, value, section: currentSection };
  }

  // 计算各字段默认值，并以「支撑 const 的分区」作为该字段的分区
  const fieldDefaults = {};
  const fieldSections = {};
  for (const f of fields) {
    const constName = defaults[f.name];
    if (constName && consts[constName]) {
      fieldDefaults[f.name] = consts[constName].value;
      fieldSections[f.name] = consts[constName].section;
    } else {
      fieldDefaults[f.name] = undefined;
      fieldSections[f.name] = currentSection;
    }
  }
  // 把 section 挂回 fields
  for (const f of fields) f.section = fieldSections[f.name];
  return { fields, fieldDefaults, consts };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function main() {
  const jsText = fs.readFileSync(CONFIG_JS, 'utf8');
  const rsText = fs.readFileSync(CONFIG_RS, 'utf8');

  const js = parseConfigJs(jsText);
  const rs = parseConfigRs(rsText);

  const rustFieldNames = new Set(rs.fields.map(f => f.name));
  const jsFieldNames = new Set(Object.keys(js.values));

  const errors = [];
  const warnings = [];

  // 1) 孤儿字段：JS 有而 Rust 无
  for (const key of jsFieldNames) {
    if (!rustFieldNames.has(key)) {
      errors.push(`孤儿字段 (前端有/Rust 无): ${key} = ${js.values[key]}`);
    }
  }

  // 2) 缺失字段：Rust 有而 JS 无
  for (const f of rs.fields) {
    if (!jsFieldNames.has(f.name)) {
      errors.push(`缺失字段 (Rust 有/前端无): ${f.name}`);
    }
  }

  // 3) 类型与数值校验（已对齐的字段）
  const EPS = 1e-6;
  for (const f of rs.fields) {
    if (!jsFieldNames.has(f.name)) continue;
    const jsVal = js.values[f.name];
    // 类型校验
    if ((f.type === 'usize' || f.type === 'u64') && !Number.isInteger(jsVal)) {
      errors.push(`类型错配: ${f.name} 在 Rust 为 ${f.type}，但前端值为浮点 ${jsVal}`);
    }
    // 数值校验
    const rsVal = rs.fieldDefaults[f.name];
    if (typeof rsVal === 'number' && typeof jsVal === 'number') {
      if (Math.abs(rsVal - jsVal) > EPS) {
        errors.push(`数值漂移: ${f.name} Rust 默认 ${rsVal} ≠ 前端 ${jsVal}`);
      }
    }
  }

  // 输出报告
  console.log('=== Flow & Accord 配置一致性校验 ===');
  console.log(`Rust 字段数: ${rs.fields.length}, 前端字段数: ${jsFieldNames.size}`);
  if (errors.length === 0) {
    console.log('✅ 字段集、类型、默认值完全一致，无漂移。');
  } else {
    console.log(`❌ 发现 ${errors.length} 处错误：`);
    for (const e of errors) console.log('  - ' + e);
  }
  if (warnings.length) {
    for (const w of warnings) console.log('  ⚠ ' + w);
  }

  // 生成速查表
  generateReference(rs, js, errors);
  console.log(`📄 已生成参数速查表: ${path.relative(ROOT, OUT_MD)}`);

  process.exit(errors.length === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// 生成 docs/config-reference.md
// ---------------------------------------------------------------------------
function generateReference(rs, js, errors) {
  const sections = new Map();
  for (const f of rs.fields) {
    if (!sections.has(f.section)) sections.set(f.section, []);
    sections.get(f.section).push(f);
  }

  const lines = [];
  lines.push('# Flow & Accord · 仿真超参数速查表 (config-reference.md)');
  lines.push('');
  lines.push('> 本表由 `tools/config-check.js` 自动生成，反映 `config.js` 与 Rust `SimConfig` 的权威字段、类型、默认值与中文说明。');
  lines.push('> 调参只需修改 `frontend/js/config.js`（无需重编译），修改后运行 `node tools/config-check.js` 校验一致性。');
  lines.push('');

  for (const [section, fields] of sections) {
    lines.push(`## ${section}`);
    lines.push('');
    lines.push('| 字段 (camelCase) | 类型 | 默认值 | 中文说明 |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const f of fields) {
      const def = rs.fieldDefaults[f.name];
      const desc = js.descriptions[f.name] || '';
      const defStr = (typeof def === 'number') ? String(def) : String(def);
      lines.push(`| \`${f.name}\` | ${f.type} | ${defStr} | ${desc} |`);
    }
    lines.push('');
  }

  if (errors.length) {
    lines.push('## ⚠ 校验错误');
    lines.push('');
    for (const e of errors) lines.push(`- ${e}`);
    lines.push('');
  }

  fs.writeFileSync(OUT_MD, lines.join('\n'), 'utf8');
}

main();
