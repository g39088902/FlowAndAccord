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
const ORDER_JS = path.join(ROOT, 'frontend', 'js', 'config.decision-order.js');
const OUT_MD = path.join(ROOT, 'docs', 'config-reference.md');

// ---------------------------------------------------------------------------
// 配置字段 → 影响模块映射 (v1.7.0 新增)
//   基于字段名前缀推断，特殊字段显式覆盖。用于 config-reference.md 的「影响模块」列。
//   改字段影响面时须同步更新此映射。
// ---------------------------------------------------------------------------
const IMPACT_OVERRIDES = {
  simulationDt: 'world_tick.rs / sim_wasm (§4.3 严禁改)',
  ticksPerSecond: 'world_tick.rs / rustworld.js',
  agentDecisionIntervalTicks: 'decisions/scheduler.rs (§4.3 错峰相位)',
  carryCapacityResource: 'agent.rs / ecology.rs / decisions/',
  campHomeConsumeRate: 'ecology.rs (营地在家吃喝)',
  agentSpawnBaseSpeed: 'agent.rs / graph.rs (寻路速度基准)',
  decisionEvalOrder: 'decisions/branches.rs (前端拖动热注入)',
  decisionEvalLevels: 'decisions/branches.rs (层级覆盖)',
  ledgerJournalCapacity: 'ledger/ (所有账本容量)',
};

const IMPACT_PREFIX_RULES = [
  { prefix: 'agentMove', mod: 'agent.rs (运动学) / graph.rs (寻路)' },
  { prefix: 'agentSpawn', mod: 'ecology.rs (始祖播撒) / agent.rs' },
  { prefix: 'agentNewborn', mod: 'birth.rs (新生儿属性) / agent.rs' },
  { prefix: 'agentConception', mod: 'agent.rs (受孕判定)' },
  { prefix: 'agentPregnan', mod: 'agent.rs (妊娠代谢)' },
  { prefix: 'agentMiscarriage', mod: 'agent.rs (流产判定)' },
  { prefix: 'agentPostpartum', mod: 'agent.rs (产后休养冷却)' },
  { prefix: 'agentInitial', mod: 'agent.rs (初始属性)' },
  { prefix: 'agentRest', mod: 'agent.rs (休息恢复) / ecology.rs' },
  { prefix: 'agentRepair', mod: 'housing_system/maintenance.rs (修缮体力)' },
  { prefix: 'agentGather', mod: 'ecology.rs (采收体力)' },
  { prefix: 'agentLabor', mod: 'agent.rs (劳作体力下限)' },
  { prefix: 'agentWork', mod: 'agent.rs (劳作代谢)' },
  { prefix: 'agentStealth', mod: 'agent.rs (隐秘可见度)' },
  { prefix: 'agentCovert', mod: 'ecology.rs (始祖隐秘特工比例)' },
  { prefix: 'agentDigestion', mod: 'agent.rs (消化效率代谢系数)' },
  { prefix: 'agentSelfSatisfied', mod: 'ecology.rs (自饮自食阈值)' },
  { prefix: 'agentGold', mod: 'agent.rs (淘金行囊) / ecology.rs' },
  { prefix: 'agentAdult', mod: 'agent.rs (成年阈值) / decisions/' },
  { prefix: 'agentDeath', mod: 'agent.rs (死亡衰减)' },
  { prefix: 'agentHealth', mod: 'agent.rs (健康衰减)' },
  { prefix: 'agentHunger', mod: 'agent.rs (饱食容量)' },
  { prefix: 'agentThirst', mod: 'agent.rs (水分容量)' },
  { prefix: 'agentStamina', mod: 'agent.rs (体力容量)' },
  { prefix: 'agentBase', mod: 'agent.rs (基础代谢/速度)' },

  { prefix: 'decisionFoundHome', mod: 'decisions/founding.rs (立宅选址)' },
  { prefix: 'decisionFamilyStock', mod: 'decisions/ (家户补货滞回触发器 §4.8)' },
  { prefix: 'decisionPoi', mod: 'decisions/routing.rs / decisions/harvest.rs (施密特触发器 §4.2)' },
  { prefix: 'decisionHouseRepair', mod: 'decisions/ (修缮触发) / housing_system/' },
  { prefix: 'decisionCritical', mod: 'decisions/ (生理临界阈值)' },
  { prefix: 'decisionRest', mod: 'decisions/ (休息目标体力)' },
  { prefix: 'decisionWork', mod: 'decisions/ (劳作体力阈值)' },
  { prefix: 'decisionGold', mod: 'decisions/ (淘金冷却 §4.8)' },
  { prefix: 'decisionStock', mod: 'decisions/ (备料淘金冷却)' },
  { prefix: 'decisionEval', mod: 'decisions/branches.rs (策展顺序/层级 §4.14)' },

  { prefix: 'houseWinter', mod: 'housing_system/maintenance.rs (冬季供暖 §4.8)' },
  { prefix: 'houseRepair', mod: 'housing_system/maintenance.rs (修缮)' },
  { prefix: 'houseNode', mod: 'housing_system/founding.rs (立宅节点占用)' },
  { prefix: 'houseMinSpacing', mod: 'housing_system/founding.rs (房屋间距)' },
  { prefix: 'houseDepreciation', mod: 'housing_system/maintenance.rs (折旧)' },
  { prefix: 'houseDurability', mod: 'housing_system/ (耐久度上限)' },
  { prefix: 'houseUpgradeCost', mod: 'housing_system/upgrade.rs (升级成本矩阵 §4.8)' },

  { prefix: 'poiInteraction', mod: 'ecology.rs (POI 交互采收/卸货)' },
  { prefix: 'poiUnload', mod: 'ecology.rs (回家卸货入账速率 §4.4)' },
  { prefix: 'poiSpawn', mod: 'ecology.rs (POI 初始化播撒布局)' },
  { prefix: 'poiMinDistance', mod: 'ecology.rs (POI 空间排斥间距 §4.7)' },

  { prefix: 'countTerrain', mod: 'ecology.rs (路网过渡节点)' },
  { prefix: 'count', mod: 'ecology.rs (POI 数量 §4.7)' },

  { prefix: 'regenBase', mod: 'ecology.rs / world_tick.rs (POI 再生速率)' },
  { prefix: 'stockMax', mod: 'poi.rs / ecology.rs (POI 储量上限)' },
  { prefix: 'market', mod: 'poi.rs / ecology.rs / market.rs (外部市场与动态定价)' },

  { prefix: 'roadAstar', mod: 'graph.rs (A* 寻路权重)' },
  { prefix: 'roadConnect', mod: 'ecology.rs (路网连接距离)' },
  { prefix: 'roadGrade', mod: 'graph.rs (道路等级铺装阈值)' },
  { prefix: 'roadHidden', mod: 'graph.rs / decisions/ (隐秘道路偏好)' },
  { prefix: 'roadVisible', mod: 'graph.rs / decisions/ (可见道路偏好)' },
  { prefix: 'roadLevelFactor', mod: 'graph.rs (等级速度加成)' },
  { prefix: 'roadSpeed', mod: 'graph.rs (各道路类型限速)' },
  { prefix: 'roadWear', mod: 'graph.rs (踩踏增长/自然衰减 §4.3)' },
  { prefix: 'roadMaxWear', mod: 'graph.rs (最高磨损等级)' },

  { prefix: 'season', mod: 'world_season.rs (四季周期)' },
  { prefix: 'temp', mod: 'world_season.rs (温度正弦曲线)' },

  { prefix: 'trait', mod: 'agent.rs / birth.rs (禀赋遗传演化)' },

  { prefix: 'clanTribute', mod: 'ledger/clan.rs (族税征收)' },
  { prefix: 'clanMutualAid', mod: 'ledger/clan.rs (族内互助)' },

  { prefix: 'ledgerTax', mod: 'ledger/region.rs (公仓税)' },
  { prefix: 'ledgerRelief', mod: 'ledger/region.rs (救济)' },
  { prefix: 'ledgerJournal', mod: 'ledger/ (流水容量)' },
];

function getImpactModule(fieldName) {
  if (IMPACT_OVERRIDES[fieldName]) return IMPACT_OVERRIDES[fieldName];
  for (const rule of IMPACT_PREFIX_RULES) {
    if (fieldName.startsWith(rule.prefix)) return rule.mod;
  }
  return '—';
}

// ---------------------------------------------------------------------------
// 解析拆分配置 JS（config.js 或 config.house-upgrade-cost.js）
//   - globalName: 顶层挂载的对象名（如 'SIM_CONFIG' / 'SIM_HOUSE_UPGRADE_COST'）
//   - 提取每个键的值（含 `1.0/30.0` 这类表达式求值）与行内中文说明
// ---------------------------------------------------------------------------
function parseConfigJs(text, globalName = 'SIM_CONFIG') {
  const objMatch = text.match(new RegExp('window\\.' + globalName + '\\s*=\\s*(\\{[\\s\\S]*?\\});'));
  if (!objMatch) throw new Error(`无法在配置文件中定位 window.${globalName} 对象`);
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

    // 结构体字段（捕获 `pub name: Type,`，含 Vec<String>/Vec<u8> 泛型）
    const f = line.match(/^\s*pub\s+(\w+)\s*:\s*([\w<>, ]+?)\s*,/);
    if (f) {
      fields.push({ name: snakeToCamel(f[1]), rustName: f[1], type: f[2], section: currentSection });
    }

    // Default 映射（仅捕获 `name: CONST,` 在 impl Default 块内）
    const d = line.match(/^\s*(\w+)\s*:\s*([A-Z_][A-Z0-9_]*)\s*,/);
    if (d && i >= defaultStartLine && i <= defaultEndLine) {
      defaults[snakeToCamel(d[1])] = d[2];
    }
    // Default 映射（`name: Vec::new(),` → 空数组默认）
    const dv = line.match(/^\s*(\w+)\s*:\s*Vec::new\(\)\s*,/);
    if (dv && i >= defaultStartLine && i <= defaultEndLine) {
      defaults[snakeToCamel(dv[1])] = '__VEC_EMPTY__';
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
    if (constName === '__VEC_EMPTY__') {
      fieldDefaults[f.name] = [];
      fieldSections[f.name] = f.section;
    } else if (constName && consts[constName]) {
      fieldDefaults[f.name] = consts[constName].value;
      fieldSections[f.name] = consts[constName].section;
    } else {
      fieldDefaults[f.name] = undefined;
      fieldSections[f.name] = f.section || currentSection;
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

  const errors = [];
  const warnings = [];

  // ★ M8 升级材料成本矩阵拆分配置（config.house-upgrade-cost.js，20 字段）纳入字段集/类型/数值比对：
  // Rust 侧 20 个 house_upgrade_cost_tier{1..4}_* 的权威默认值在此文件，须在孤儿/缺失检查前并入前端字段集。
  const COST_JS = path.join(ROOT, 'frontend', 'js', 'config.house-upgrade-cost.js');
  if (!fs.existsSync(COST_JS)) {
    errors.push('缺失拆分配置文件 config.house-upgrade-cost.js（Rust 侧 20 个 house_upgrade_cost_tier* 字段缺失权威默认值来源）');
  } else {
    const costText = fs.readFileSync(COST_JS, 'utf8');
    const cost = parseConfigJs(costText, 'SIM_HOUSE_UPGRADE_COST');
    for (const k of Object.keys(cost.values)) {
      js.values[k] = cost.values[k];
      js.descriptions[k] = cost.descriptions[k] || '';
    }
  }

  const rustFieldNames = new Set(rs.fields.map(f => f.name));
  const jsFieldNames = new Set(Object.keys(js.values));

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
    // 数组类型字段（Vec<String>/Vec<u8>）：类型 + 逐元素比对
    if (f.type.startsWith('Vec<')) {
      if (!Array.isArray(jsVal)) {
        errors.push(`类型错配: ${f.name} 在 Rust 为 ${f.type}，但前端值非数组`);
        continue;
      }
      if (f.type === 'Vec<u8>' && !jsVal.every(v => Number.isInteger(v))) {
        errors.push(`类型错配: ${f.name} 在 Rust 为 Vec<u8>，但前端数组含非整数元素`);
      }
      if (f.type === 'Vec<String>' && !jsVal.every(v => typeof v === 'string')) {
        errors.push(`类型错配: ${f.name} 在 Rust 为 Vec<String>，但前端数组含非字符串元素`);
      }
      const rsArr = rs.fieldDefaults[f.name];
      if (Array.isArray(rsArr) && JSON.stringify(rsArr) !== JSON.stringify(jsVal)) {
        errors.push(`数值漂移: ${f.name} Rust 默认 ${JSON.stringify(rsArr)} ≠ 前端 ${JSON.stringify(jsVal)}`);
      }
      continue;
    }
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

  // 4) 决策顺序持久化文件（config.decision-order.js）词汇表轻校验
  if (fs.existsSync(ORDER_JS)) {
    const orderText = fs.readFileSync(ORDER_JS, 'utf8');
    const om = orderText.match(/window\.SIM_DECISION_ORDER\s*=\s*(\{[\s\S]*?\});/);
    if (!om) {
      errors.push('config.decision-order.js: 无法定位 window.SIM_DECISION_ORDER 对象');
    } else {
      let o = null;
      try { o = (function () { return eval('(' + om[1] + ')'); })(); } catch (e) { /* fallthrough */ }
      if (!o) {
        errors.push('config.decision-order.js: 对象字面量求值失败');
      } else {
        const ids = o.decisionEvalOrder, lv = o.decisionEvalLevels;
        const idOk = Array.isArray(ids) && ids.length === 15 && new Set(ids).size === 15
          && ids.every(s => /^b(?:[1-9]|1[0-5])$/.test(s));
        if (!idOk) errors.push('config.decision-order.js: decisionEvalOrder 必须为 15 个互不重复的 b1..b15');
        const lvOk = Array.isArray(lv) && lv.length === 15 && lv.every(v => Number.isInteger(v) && v >= 0 && v <= 5);
        if (!lvOk) errors.push('config.decision-order.js: decisionEvalLevels 必须为 15 个 0-5 整数');
      }
    }
  } else {
    warnings.push('未找到 config.decision-order.js（拖动决策卡后由 server.js 生成落盘）');
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
    lines.push('| 字段 (camelCase) | 类型 | 默认值 | 影响模块 | 中文说明 |');
    lines.push('| :--- | :--- | :--- | :--- | :--- |');
    for (const f of fields) {
      const def = rs.fieldDefaults[f.name];
      const desc = js.descriptions[f.name] || '';
      const defStr = Array.isArray(def) ? JSON.stringify(def) : String(def);
      const impact = getImpactModule(f.name);
      lines.push(`| \`${f.name}\` | ${f.type} | ${defStr} | ${impact} | ${desc} |`);
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
