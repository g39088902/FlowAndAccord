#!/usr/bin/env node
/**
 * tools/diagnose.js
 * Flow & Accord · 确定性无头内核诊断与 Bug 嗅探排查工具
 *
 * 用法示例：
 *   node tools/diagnose.js --seed 42 --tick 3000
 *   node tools/diagnose.js --seed 42 --tick 3000 --check anomalies
 *   node tools/diagnose.js --seed 42 --tick 3000 --agent 5 --trace-window 150
 *   node tools/diagnose.js --seed 1024 --tick 4500 --house 2
 *   node tools/diagnose.js --seed 42 --tick 3000 --export-json out.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WASM_PATH = path.join(ROOT, 'frontend', 'rust', 'sim_wasm.wasm');

// ═══════════════════════════════════════════════════════════════
// 1. 命令行参数解析
// ═══════════════════════════════════════════════════════════════
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    seed: 42,
    tick: 3000,
    sample: 500,
    agent: null,
    house: null,
    household: null,
    check: 'all',          // 'all' | 'anomalies' | 'starvation' | 'deaths' | 'none'
    traceWindow: 150,      // 截止前高频窗口
    format: 'markdown',    // 'markdown' | 'json'
    exportJson: null,
    exportReport: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--seed' || arg === '-s') options.seed = Number(args[++i]);
    else if (arg === '--tick' || arg === '-t') options.tick = Number(args[++i]);
    else if (arg === '--sample') options.sample = Number(args[++i]);
    else if (arg === '--agent' || arg === '-a') options.agent = Number(args[++i]);
    else if (arg === '--house' || arg === '-h') options.house = Number(args[++i]);
    else if (arg === '--household') options.household = Number(args[++i]);
    else if (arg === '--check' || arg === '-c') options.check = args[++i];
    else if (arg === '--trace-window' || arg === '-w') options.traceWindow = Number(args[++i]);
    else if (arg === '--format' || arg === '-f') options.format = args[++i];
    else if (arg === '--export-json') options.exportJson = args[++i];
    else if (arg === '--export-report') options.exportReport = args[++i];
    else if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  return options;
}

function printHelp() {
  console.log(`
Flow & Accord · 确定性无头内核诊断工具 (tools/diagnose.js)

用法:
  node tools/diagnose.js [options]

选项:
  -s, --seed <number>         随机种子 (默认: 42)
  -t, --tick <number>         目标截止 tick (默认: 3000)
  --sample <number>           宏观采样步长 (默认: 500)
  -a, --agent <id>            专项追踪特定族人 ID
  -h, --house <id>            专项追踪特定房屋 ID
  --household <id>            专项追踪特定家户 ID
  -c, --check <type>          异常嗅探规则: all | anomalies | starvation | deaths | none (默认: all)
  -w, --trace-window <ticks>  截止 tick 前的高频追踪窗口 (默认: 150)
  -f, --format <fmt>          输出格式: markdown | json (默认: markdown)
  --export-json <path>        导出截止时刻完整快照 JSON 文件
  --export-report <path>      导出诊断 Markdown 报告到文件
  --help                      显示帮助信息
`);
}

// ═══════════════════════════════════════════════════════════════
// 2. 配置与 WASM 初始化
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// 3. 遥测与异常嗅探器引擎
// ═══════════════════════════════════════════════════════════════
class AnomalyDetector {
  constructor(config) {
    this.config = config;
    this.anomalies = [];
    this.stagnantAgents = new Map(); // id -> { pos, count }
    this.previousDeaths = 0;
  }

  sniff(snap, tick) {
    const triggerOn = this.config.decisionFamilyStockTriggerOn || 100.0;
    const triggerOff = this.config.decisionFamilyStockTriggerOff || 200.0;
    const aliveAgents = snap.agents.filter(a => a.is_alive && !a.is_fetus);

    // 1. 生理死锁与绝境检查 (Rule 1)
    for (const a of aliveAgents) {
      const inDanger = (a.hunger < 5.0 || a.thirst < 5.0);
      const isSeeking = a.state.startsWith('Seeking') || a.state.startsWith('Drinking') || a.state.startsWith('Foraging');
      if (inDanger && !isSeeking && a.state === 'RestingAtCamp') {
        this.anomalies.push({
          tick,
          severity: 'HIGH',
          rule: 'Rule 1: 生理险境死锁',
          detail: `族人 #${a.id} 饱食=${a.hunger.toFixed(1)}/水=${a.thirst.toFixed(1)} 处于极危濒死区间(<5.0)，但仍在 RestingAtCamp，未触发求生状态`,
          targetId: a.id,
        });
      }
    }

    // 2. 空间停滞探测 (Rule 5)
    for (const a of aliveAgents) {
      if (a.state.startsWith('Seeking') || a.state === 'ConstructingHouse' || a.state === 'RepairingHouse') {
        const prev = this.stagnantAgents.get(a.id);
        if (prev) {
          const dist = Math.hypot(a.x - prev.pos.x, a.y - prev.pos.y);
          if (dist < 0.05) {
            prev.count++;
            if (prev.count === 60) { // ~2秒无位移
              this.anomalies.push({
                tick,
                severity: 'MEDIUM',
                rule: 'Rule 5: 空间移动阻断/停滞',
                detail: `族人 #${a.id} 处于 ${a.state} 状态，但连续 60 tick 几乎无位移 (移动距离 < 0.05m)`,
                targetId: a.id,
              });
            }
          } else {
            prev.pos = { x: a.x, y: a.y };
            prev.count = 0;
          }
        } else {
          this.stagnantAgents.set(a.id, { pos: { x: a.x, y: a.y }, count: 0 });
        }
      }
    }

    // 3. 房屋建材满足但停滞不升级 (Rule 3)
    for (const h of snap.houses) {
      const hh = snap.households.find(item => item.head === h.owner_id && !item.is_dissolved);
      if (hh && h.tier) {
        const tierNum = parseInt(h.tier.replace(/[^0-9]/g, '')) || 0;
        if (tierNum >= 1 && tierNum <= 3) {
          const nextTier = tierNum + 1;
          const costWater = this.config[`houseUpgradeCostTier${nextTier}Water`] || 0;
          const costFood = this.config[`houseUpgradeCostTier${nextTier}Food`] || 0;
          const costWood = this.config[`houseUpgradeCostTier${nextTier}Wood`] || 0;
          const costStone = this.config[`houseUpgradeCostTier${nextTier}Stone`] || 0;
          const costGold = this.config[`houseUpgradeCostTier${nextTier}Gold`] || 0;

          const getBal = (rk) => {
            const b = (hh.balances || []).find(item => item.resource === rk);
            return b ? b.amount : 0;
          };
          const w = getBal('Water'), f = getBal('Food'), wd = getBal('Wood'), s = getBal('Stone'), g = getBal('Gold');

          if (w >= costWater && f >= costFood && wd >= costWood && s >= costStone && g >= costGold) {
            if (!h.pendingUpgradeTicks) h.pendingUpgradeTicks = 0;
            h.pendingUpgradeTicks += 30;
            if (h.pendingUpgradeTicks >= 900) {
              this.anomalies.push({
                tick,
                severity: 'MEDIUM',
                rule: 'Rule 3: 房屋建材就绪但晋升停滞',
                detail: `房屋 #${h.id} (当前${h.tier}) 家户 #${hh.id} 材料充足 (水${w.toFixed(0)}/${costWater} 粮${f.toFixed(0)}/${costFood} 木${wd.toFixed(0)}/${costWood} 石${s.toFixed(0)}/${costStone} 金${g.toFixed(0)}/${costGold})，但长期未完成晋升`,
                targetId: h.id,
              });
              h.pendingUpgradeTicks = -99999;
            }
          }
        }
      }
    }

    // 4. 非自然死亡浪潮 (Rule 6)
    const currentDeaths = snap.total_deaths_unnatural || 0;
    if (currentDeaths - this.previousDeaths >= 3) {
      this.anomalies.push({
        tick,
        severity: 'HIGH',
        rule: 'Rule 6: 短时非自然死亡潮',
        detail: `短时间内发生 ${currentDeaths - this.previousDeaths} 例非自然死亡 (渴死/饿死)`,
      });
    }
    this.previousDeaths = currentDeaths;
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. 主流程执行
// ═══════════════════════════════════════════════════════════════
async function main() {
  const opts = parseArgs();

  if (!fs.existsSync(WASM_PATH)) {
    console.error(`❌ WASM 二进制未找到: ${WASM_PATH}\n请先运行 cargo build -p sim_wasm --target wasm32-unknown-unknown --release 并同步副本。`);
    process.exit(1);
  }

  const wasmBytes = fs.readFileSync(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const ex = instance.exports;

  function getSnapshot() {
    const ptr = ex.world_snapshot_ptr();
    const len = ex.world_snapshot_len();
    if (!len) return null;
    return JSON.parse(new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ptr, len)));
  }

  function applyConfig(cfg) {
    const encoded = new TextEncoder().encode(JSON.stringify(cfg));
    const ptr = ex.world_config_buf_ptr(encoded.length);
    new Uint8Array(ex.memory.buffer, ptr, encoded.length).set(encoded);
    const res = ex.world_apply_config_buf(encoded.length);
    if (res !== 0) throw new Error('world_apply_config_buf failed: ' + res);
  }

  const simConfig = loadSimConfig();
  const detector = new AnomalyDetector(simConfig);

  // 初始化世界：grid=60, size=764, seed, 20人
  ex.world_create(60, 764.0, opts.seed, 20, simConfig.countCamps);
  applyConfig(simConfig);

  const DT = 1.0 / 30.0;
  const SUBSTEPS = 10;
  const totalTicks = opts.tick;
  let currentTick = 0;

  const sampleSnapshots = [];
  const focusAgentTrace = [];
  const traceStartTick = Math.max(0, totalTicks - opts.traceWindow);

  console.log(`🚀 启动无头仿真诊断: Seed=${opts.seed} | 目标Tick=${totalTicks} (~${(totalTicks / 30).toFixed(1)}s 模拟时间)`);

  const startTime = Date.now();

  while (currentTick < totalTicks) {
    const nextSteps = Math.min(SUBSTEPS, totalTicks - currentTick);
    ex.world_tick_steps(nextSteps, DT);
    currentTick += nextSteps;

    // 宏观采样
    if (currentTick % opts.sample === 0 || currentTick === totalTicks) {
      const snap = getSnapshot();
      sampleSnapshots.push({ tick: currentTick, snap });
      if (opts.check !== 'none') {
        detector.sniff(snap, currentTick);
      }
    }

    // 重点 Agent 窗口微观轨迹采样
    if (opts.agent != null && currentTick >= traceStartTick && currentTick % 10 === 0) {
      const snap = getSnapshot();
      const a = snap.agents.find(item => item.id === opts.agent);
      if (a) {
        focusAgentTrace.push({
          tick: currentTick,
          state: a.state,
          need: a.current_need,
          hunger: a.hunger,
          thirst: a.thirst,
          stamina: a.stamina,
          pos: { x: a.x.toFixed(1), y: a.y.toFixed(1) },
          carried: [a.carried_water, a.carried_food, a.carried_wood, a.carried_stone, a.carried_gold].map(v => v.toFixed(0)),
          stockTrig: a.family_stock_active ? a.family_stock_active.map(v => v ? 'ON' : 'off').join('/') : '-/-/-/-/-',
        });
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const finalSnap = getSnapshot();

  if (opts.exportJson) {
    fs.writeFileSync(opts.exportJson, JSON.stringify(finalSnap, null, 2), 'utf8');
    console.log(`💾 最终快照 JSON 已导出至: ${opts.exportJson}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. 组装 Markdown 诊断报告
  // ═══════════════════════════════════════════════════════════════
  const report = generateReport({
    opts,
    simConfig,
    durationMs,
    finalSnap,
    sampleSnapshots,
    anomalies: detector.anomalies,
    focusAgentTrace,
  });

  if (opts.exportReport) {
    fs.writeFileSync(opts.exportReport, report, 'utf8');
    console.log(`📄 诊断报告已写入: ${opts.exportReport}`);
  } else {
    console.log('\n' + report);
  }
}

function generateReport({ opts, simConfig, durationMs, finalSnap, sampleSnapshots, anomalies, focusAgentTrace }) {
  const alive = finalSnap.agents.filter(a => a.is_alive && !a.is_fetus);
  const dead = finalSnap.agents.filter(a => !a.is_alive && !a.is_fetus);
  const fetuses = finalSnap.agents.filter(a => a.is_fetus);

  const lines = [];
  lines.push(`# 🛠️ Flow & Accord 确定性内核诊断报告`);
  lines.push(`> **种子 (Seed)**: \`${opts.seed}\` | **截止 Tick**: \`${opts.tick}\` (~${(opts.tick / 30).toFixed(1)}s 模拟时间) | **步进耗时**: \`${durationMs} ms\``);
  lines.push(`> **时间与环境**: ${finalSnap.season} ${finalSnap.temperature.toFixed(1)}°C (进度 ${(finalSnap.season_progress * 100).toFixed(0)}%) | 偏角: ${(finalSnap.tilt_angle_rad * 180 / Math.PI).toFixed(1)}°`);
  lines.push(``);

  // 1. 生态大盘
  lines.push(`## 📊 1. 宏观态势总览`);
  lines.push(`- **人口格局**: 存活 **${alive.length}** 人 | 死亡 **${finalSnap.total_deaths}** (自然 **${finalSnap.total_deaths_natural}** / 非自然 **${finalSnap.total_deaths_unnatural}**) | 累计出生 **${finalSnap.total_births}** | 胎儿 **${fetuses.length}**`);
  lines.push(`- **私产宅舍**: 总计 **${finalSnap.houses.length}** 所 (空置 **${finalSnap.houses.filter(h => h.owner_id == null).length}** 所)`);
  lines.push(`- **家户组织**: 存续家户 **${finalSnap.households.filter(h => !h.is_dissolved).length}** 户 | 存续婚姻 **${finalSnap.marriages.filter(m => m.divorced_tick == null).length}** 对`);
  lines.push(``);

  // 资源大盘
  const poiSummary = {};
  for (const p of finalSnap.pois || []) {
    if (!poiSummary[p.poi_type]) poiSummary[p.poi_type] = { count: 0, cur: 0, max: 0 };
    poiSummary[p.poi_type].count++;
    poiSummary[p.poi_type].cur += p.current_stock;
    poiSummary[p.poi_type].max += p.max_stock;
  }
  lines.push(`### 🗺️ 地图 POI 生态储备`);
  lines.push(`| POI 类型 | 处所 | 当前总储量 | 储量上限 | 充盈率 |`);
  lines.push(`| :--- | :---: | :---: | :---: | :---: |`);
  for (const [type, data] of Object.entries(poiSummary)) {
    const ratio = data.max > 0 ? ((data.cur / data.max) * 100).toFixed(1) + '%' : '-';
    lines.push(`| ${type} | ${data.count} | ${data.cur.toFixed(1)} | ${data.max.toFixed(0)} | ${ratio} |`);
  }
  lines.push(``);

  // 2. 异常嗅探结果 (Rule 1 ~ 8)
  lines.push(`## ⚠️ 2. 异常嗅探器告警 (${anomalies.length} 条记录)`);
  if (anomalies.length === 0) {
    lines.push(`✅ **未发现任何违例与死锁异常**。系统各项生理、建筑晋升、空间移动指标均处于健康带。`);
  } else {
    lines.push(`| 级别 | 涉及 Tick | 违例规则 | 详细情况摘要 |`);
    lines.push(`| :---: | :---: | :--- | :--- |`);
    for (const an of anomalies.slice(0, 15)) {
      const icon = an.severity === 'HIGH' ? '🔴 严重' : '🟡 警告';
      lines.push(`| ${icon} | \`${an.tick}\` | **${an.rule}** | ${an.detail} |`);
    }
    if (anomalies.length > 15) {
      lines.push(`| ... | ... | ... | *(仅显示前 15 条异常，完整见 JSON 导出)* |`);
    }
  }
  lines.push(``);

  // 3. 重点 Agent 追踪
  if (opts.agent != null) {
    lines.push(`## 👤 3. 族人 #${opts.agent} 显微档案与窗口轨迹`);
    const target = finalSnap.agents.find(a => a.id === opts.agent);
    if (!target) {
      lines.push(`❌ 未在当前世界中找到 ID 为 #${opts.agent} 的族人。`);
    } else {
      lines.push(`- **基本信息**: 性别=${target.gender} | 年龄=${(target.age).toFixed(0)}s | 代数=G${target.generation} | 威望=${target.prestige} | 存活=${target.is_alive ? '是' : '否'}`);
      lines.push(`- **生理状态**: 饱食=${target.hunger.toFixed(1)}/50 | 水分=${target.thirst.toFixed(1)}/50 | 体力=${target.stamina.toFixed(1)}% | 健康=${target.health.toFixed(1)}/${target.max_health.toFixed(1)}`);
      lines.push(`- **社会归属**: 房屋=${target.home_house_id != null ? '#' + target.home_house_id : '无'} | 家户=${target.household_id != null ? '#' + target.household_id + `(${target.household_role})` : '无'} | 配偶=${target.spouse_id != null ? '#' + target.spouse_id : '无'}`);
      lines.push(`- **行囊携带**: 水=${target.carried_water.toFixed(1)} | 粮=${target.carried_food.toFixed(1)} | 木=${target.carried_wood.toFixed(1)} | 石=${target.carried_stone.toFixed(1)} | 金=${target.carried_gold.toFixed(1)}`);
      lines.push(`- **家庭补货触发器 (水/粮/木/石/金)**: \`${target.family_stock_active ? target.family_stock_active.map(v => v ? 'ON' : 'off').join('/') : '-'}\``);
      lines.push(``);

      if (focusAgentTrace.length > 0) {
        lines.push(`#### ⏱️ 截止前微观逐拍时间序列 (后 ${opts.traceWindow} tick 采样)`);
        lines.push(`| Tick | 行动状态 (State) | 马斯洛需求 (Need) | 饱食 | 水分 | 体力 | 坐标 | 触发器 |`);
        lines.push(`| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |`);
        for (const tr of focusAgentTrace) {
          lines.push(`| \`${tr.tick}\` | \`${tr.state}\` | \`${tr.need || '-'}\` | ${tr.hunger.toFixed(1)} | ${tr.thirst.toFixed(1)} | ${tr.stamina.toFixed(0)}% | (${tr.pos.x},${tr.pos.y}) | \`${tr.stockTrig}\` |`);
        }
        lines.push(``);
      }
    }
  }

  // 4. 重点房屋追踪
  if (opts.house != null) {
    lines.push(`## 🏡 4. 房屋 #${opts.house} 档案分析`);
    const h = finalSnap.houses.find(item => item.id === opts.house);
    if (!h) {
      lines.push(`❌ 未找到 ID 为 #${opts.house} 的房屋。`);
    } else {
      const hh = finalSnap.households.find(item => item.head === h.owner_id && !item.is_dissolved);
      const bidInfo = (h.highest_bid || 0) > 0 ? ` | 最高出价=${(h.highest_bid || 0).toFixed(1)}金 | 标杆=${(h.benchmark_bid || 0).toFixed(1)}金 | 阶段=${h.auction_phase || '无'}` : '';
      lines.push(`- **规格与耐久**: 等级=\`${h.tier}\` | 耐久度=${h.durability.toFixed(1)}${bidInfo} | 建设工时=${h.construction_progress.toFixed(1)}s`);
      lines.push(`- **产权户主**: 户主ID=\`${h.owner_id != null ? '#' + h.owner_id : '空置/无主'}\` | 营地辖区=\`营地${h.camp_id}\``);
      if (hh) {
        lines.push(`- **对应家户账本 (#${hh.id})**:`);
        for (const b of hh.balances || []) {
          lines.push(`  - ${b.resource}: **${b.amount.toFixed(1)}**`);
        }
      } else {
        lines.push(`- **对应家户账本**: 暂无活跃关联家户`);
      }
      lines.push(``);
    }
  }

  // 5. 家户账本抽样分布 (前8户)
  lines.push(`## 🏠 5. 家户账本储备抽样 (前 8 户)`);
  lines.push(`| 家户ID | 户主 | 人口 | 水 | 粮 | 木 | 石 | 金 | 触发器 (水/粮/木/石/金) |`);
  lines.push(`| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`);
  const onThresh = simConfig.decisionFamilyStockTriggerOn || 100;
  for (const hh of finalSnap.households.filter(h => !h.is_dissolved).slice(0, 8)) {
    const getVal = (rk) => {
      const b = (hh.balances || []).find(item => item.resource === rk);
      return b ? b.amount : 0;
    };
    const w = getVal('Water'), f = getVal('Food'), wd = getVal('Wood'), s = getVal('Stone'), g = getVal('Gold');
    const trigs = [w, f, wd, s, g].map(v => v < onThresh ? 'ON' : 'off').join('/');
    lines.push(`| #${hh.id} | #${hh.head} | ${(hh.members || []).length} | ${w.toFixed(0)} | ${f.toFixed(0)} | ${wd.toFixed(0)} | ${s.toFixed(0)} | ${g.toFixed(0)} | \`${trigs}\` |`);
  }
  lines.push(``);

  // 6. Agent 根因排查指引
  lines.push(`## 💡 6. AI Agent 根因排查与修复指引`);
  lines.push(`若在此 Seed (${opts.seed}) / Tick (${opts.tick}) 发现 Bug，请按以下模块路径排查：`);
  lines.push(`1. **需求判定与优先级截胡**: 查阅 \`crates/sim_core/src/spatial/decisions/branches.rs\` 与 \`frontend/js/config.decision-order.js\``);
  lines.push(`2. **家户账本与施密特补货**: 查阅 \`crates/sim_core/src/spatial/decisions/evaluate.rs::refresh_family_stock\``);
  lines.push(`3. **房屋升级与材料门槛**: 查阅 \`crates/sim_core/src/spatial/decisions/needs.rs::upgrade_material_cost\` 与 \`config.house-upgrade-cost.js\``);
  lines.push(`4. **婚姻、求偶与繁衍冷却**: 查阅 \`crates/sim_core/src/spatial/housing_system/marriage.rs\` 与 \`birth.rs\``);
  lines.push(`5. **改动后回归验证**: 执行 \`node tools/diagnose.js --seed ${opts.seed} --tick ${opts.tick}\` 验证异常解除，再执行 \`node tools/test-wasm.js\` 门禁。`);

  return lines.join('\n');
}

main().catch(err => {
  console.error('❌ 诊断工具运行失败:', err);
  process.exit(1);
});
