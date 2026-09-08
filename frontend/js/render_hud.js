// === HUD 与大盘辅助函数 (从 render.js 拆分) ===
// 调试工具 / 顶栏统计 / 调试监视器 / 资源大盘 / 全局均值大盘 / 账本面板 / 格式化工具
// 依赖: render_canvas.js 中声明的共享变量 (dbgRenderMs, dbgFrameMs, dbgCurrentFps 等)

// 🐞 调试工具函数
function dbgEl(id) {
  if (dbgElCache[id] === undefined) dbgElCache[id] = document.getElementById(id);
  return dbgElCache[id];
}
function fmtMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
function dbgSetText(id, text) {
  const el = dbgEl(id);
  if (el) el.textContent = text;
}

// 资源大盘 (水/果/木/石/金 全地图汇总)
function drawResourceDashboard() {
let totalWaterCur = 0, totalWaterMax = 0;
let totalBerryCur = 0, totalBerryMax = 0;
let totalWoodCur = 0, totalWoodMax = 0;
let totalStoneCur = 0, totalStoneMax = 0;
let totalGoldCur = 0, totalGoldMax = 0;

for (const p of sim.pois) {
  if (p.type === 'Water') {
    totalWaterCur += p.currentStock;
    totalWaterMax += p.maxStock;
  } else if (p.type === 'Berry') {
    totalBerryCur += p.currentStock;
    totalBerryMax += p.maxStock;
  } else if (p.type === 'Wood') {
    totalWoodCur += p.currentStock;
    totalWoodMax += p.maxStock;
  } else if (p.type === 'Stone') {
    totalStoneCur += p.currentStock;
    totalStoneMax += p.maxStock;
  } else if (p.type === 'Gold') {
    totalGoldCur += p.currentStock;
    totalGoldMax += p.maxStock;
  }
}

const waterPct = Math.round((totalWaterCur / Math.max(1, totalWaterMax)) * 100);
const berryPct = Math.round((totalBerryCur / Math.max(1, totalBerryMax)) * 100);
const woodPct = Math.round((totalWoodCur / Math.max(1, totalWoodMax)) * 100);
const stonePct = Math.round((totalStoneCur / Math.max(1, totalStoneMax)) * 100);
const goldPct = Math.round((totalGoldCur / Math.max(1, totalGoldMax)) * 100);

document.getElementById('val-global-water').textContent = `${totalWaterCur.toFixed(1)} / ${totalWaterMax.toFixed(1)} 单位 (${waterPct}%)`;
document.getElementById('fill-global-water').style.width = `${waterPct}%`;
document.getElementById('fill-global-water').style.background = waterPct < 25 ? '#ef4444' : '#38bdf8';

document.getElementById('val-global-berry').textContent = `${totalBerryCur.toFixed(1)} / ${totalBerryMax.toFixed(1)} 单位 (${berryPct}%)`;
document.getElementById('fill-global-berry').style.width = `${berryPct}%`;
document.getElementById('fill-global-berry').style.background = berryPct < 25 ? '#ef4444' : '#10b981';

document.getElementById('val-global-wood').textContent = `${totalWoodCur.toFixed(1)} / ${totalWoodMax.toFixed(1)} 单位 (${woodPct}%)`;
document.getElementById('fill-global-wood').style.width = `${woodPct}%`;
document.getElementById('fill-global-wood').style.background = woodPct < 25 ? '#ef4444' : '#d97706';

document.getElementById('val-global-stone').textContent = `${totalStoneCur.toFixed(1)} / ${totalStoneMax.toFixed(1)} 单位 (${stonePct}%)`;
document.getElementById('fill-global-stone').style.width = `${stonePct}%`;
document.getElementById('fill-global-stone').style.background = stonePct < 25 ? '#ef4444' : '#94a3b8';

const valGoldEl = document.getElementById('val-global-gold');
const fillGoldEl = document.getElementById('fill-global-gold');
if (valGoldEl && fillGoldEl) {
  valGoldEl.textContent = `${totalGoldCur.toFixed(1)} / ${totalGoldMax.toFixed(1)} 单位 (${goldPct}%)`;
  fillGoldEl.style.width = `${goldPct}%`;
  fillGoldEl.style.background = goldPct < 25 ? '#ef4444' : '#fbbf24';
}

const ecoHealthBadge = document.getElementById('global-eco-health');
if (waterPct < 20 || berryPct < 20 || woodPct < 20) {
  ecoHealthBadge.textContent = '⚠️ 资源枯竭危机';
  ecoHealthBadge.style.color = '#ef4444';
} else if (waterPct < 45 || berryPct < 45 || woodPct < 45) {
  ecoHealthBadge.textContent = '⚡ 储量紧俏';
  ecoHealthBadge.style.color = '#f59e0b';
} else {
  ecoHealthBadge.textContent = '🌿 资源丰盛';
  ecoHealthBadge.style.color = '#10b981';
}
}

// === HUD 与大盘辅助函数 (从 render.js 拆分) ===
// 顶栏统计 / 调试监视器 / 全局均值大盘 / 账本面板 / 格式化工具
// 依赖: render_canvas.js 中声明的共享变量 (dbgRenderMs, dbgFrameMs 等)

function updateDebugHud(now) {
  if (!sim.debugMode || now - dbgHudUpdate < 200) return;
  dbgHudUpdate = now;
  if (typeof sim.getDebugStats !== 'function') return;
  const s = sim.getDebugStats();

  // ⚡ 现实世界每秒实际推进的模拟 Tick 数 (含倍速加成；优先读取 Worker 500ms 滑动窗口权威统计，平滑无离散抖动)
  const realNow = performance.now();
  const dtSec = Math.max(0.001, (realNow - dbgLastTickSec) / 1000);
  const fallbackTickRate = Math.max(0, (s.tick - dbgLastTick) / dtSec);
  dbgLastTick = s.tick;
  dbgLastTickSec = realNow;
  const tickRate = (typeof s.tickRate === 'number') ? s.tickRate : fallbackTickRate;

  dbgSetText('dbg-tick', s.tick.toLocaleString('en-US'));
  dbgSetText('dbg-tick-rate', Math.round(tickRate).toLocaleString('en-US') + ' tick/s');
  dbgSetText('dbg-royal-privy', ((sim.totalRoyalPrivy || 0).toFixed(1)) + ' 单位');
  dbgSetText('dbg-fps', String(Math.round(dbgCurrentFps)));
  dbgSetText('dbg-tick-ms', s.tickMs.toFixed(2) + ' ms');
  dbgSetText('dbg-snap-ms', s.snapMs.toFixed(2) + ' ms');
  dbgSetText('dbg-render-ms', dbgRenderMs.toFixed(2) + ' ms');
  dbgSetText('dbg-frame-ms', dbgFrameMs.toFixed(2) + ' ms');
  dbgSetText('dbg-cpu', Math.min(100, (dbgFrameMs / FRAME_INTERVAL) * 100).toFixed(1) + '%');
  dbgSetText('dbg-js-heap', s.memSupported ? `${fmtMB(s.jsHeapUsed)} / ${fmtMB(s.jsHeapLimit)}` : '浏览器不支持');
  dbgSetText('dbg-wasm-mem', fmtMB(s.wasmBytes));
  const tip = dbgEl('dbg-mem-tip');
  if (tip) tip.style.display = s.memSupported ? 'none' : 'block';
}

// ==========================================
// 📊 顶栏数据栏刷新 (节流 ~100ms; 独立于画布渲染，无头模式下同样更新，保证长程演化数据实时可见)
// ==========================================
function updateTopBarStats(now) {
  if (now - lastTopBarUpdate < 100) return;
  lastTopBarUpdate = now;

  const aliveAgents = sim.agents.filter(a => a.isAlive);
  const pregnantAgents = aliveAgents.filter(a => a.isPregnant);

  document.getElementById('stat-pop').textContent = aliveAgents.length;
  document.getElementById('stat-houses').textContent = sim.houses.length;
  document.getElementById('stat-pois').textContent = sim.pois.length;
  // ★ 家户与婚姻统计 (v0.9.72 M1)
  const activeHouseholds = sim.households ? sim.households.filter(h => !h.isDissolved).length : 0;
  const activeMarriages = sim.marriages ? sim.marriages.filter(m => m.isActive).length : 0;
  const shEl = document.getElementById('stat-households');
  if (shEl) shEl.textContent = activeHouseholds;
  const smEl = document.getElementById('stat-marriages');
  if (smEl) smEl.textContent = activeMarriages;
  document.getElementById('stat-pregnant').textContent = pregnantAgents.length;
  document.getElementById('stat-births').textContent = sim.totalBirths;
  document.getElementById('stat-deaths').textContent = sim.totalDeaths;
  document.getElementById('stat-deaths-natural').textContent = sim.totalDeathsNatural;
  document.getElementById('stat-deaths-unnatural').textContent = sim.totalDeathsUnnatural;
  document.getElementById('stat-miscarriages').textContent = sim.totalMiscarriages;

  // ⚡ 控制台实际演化倍速展示
  const actualSpeedEl = document.getElementById('stat-actual-speed');
  if (actualSpeedEl) {
    if (sim.isPaused) {
      actualSpeedEl.textContent = '0.0x (已暂停)';
      actualSpeedEl.style.color = '#94a3b8';
    } else {
      const isStalled = sim._lastSnapshotRealTime && (performance.now() - sim._lastSnapshotRealTime > 1500);
      const rate = (isStalled || typeof sim.tickRate !== 'number') ? 0 : sim.tickRate;
      const mult = rate / 60;
      const multStr = mult >= 10 ? Math.round(mult) + 'x' : mult.toFixed(1) + 'x';
      actualSpeedEl.textContent = `${multStr} (${Math.round(rate)} tick/s)`;
      actualSpeedEl.style.color = '#38bdf8';
    }
  }

  // 顶栏四季与气温展示
  const seasonIcons = { 'Spring': '🌸 春季', 'Summer': '☀️ 夏季', 'Autumn': '🍂 秋季', 'Winter': '❄️ 冬季' };
  document.getElementById('stat-season').textContent = seasonIcons[sim.currentSeason] || '🌸 春季';
  document.getElementById('stat-temp').textContent = `${sim.temperature.toFixed(1)}°C`;
  document.getElementById('stat-temp').style.color = sim.currentSeason === 'Winter' ? '#38bdf8' : (sim.currentSeason === 'Summer' ? '#f59e0b' : '#e2e8f0');

  // 气温预测浮窗如果在展开状态，每 30 帧刷新一次以跟随时间平滑演化
  if (_climatePopupVisible && sim && (sim.tickCount - _lastClimateChartRenderTick >= 30)) {
    _lastClimateChartRenderTick = sim.tickCount;
    renderClimateForecastChart();
  }

  // ★ M2: 账本与社会制度 UI 更新（与顶栏统计同一 10FPS 节流）
  if (window.LedgerUI && typeof window.LedgerUI.update === 'function') {
    window.LedgerUI.update(sim);
  }
}

// ==========================================
// 全局存活部落民属性均值大盘汇总计算与 DOM 渲染
// ==========================================
function updateGlobalAverages(aliveAgents, houses, households) {
  const cardEl = document.getElementById('global-averages-card');
  if (!cardEl) return;
  const countEl = document.getElementById('avg-alive-count');
  const n = aliveAgents ? aliveAgents.length : 0;
  if (countEl) countEl.textContent = `${n}人存活`;

  if (n === 0) {
    const el = id => document.getElementById(id);
    if (el('avg-health-val')) el('avg-health-val').textContent = '0.0 / 100.0 (0%)';
    if (el('avg-health-fill')) el('avg-health-fill').style.width = '0%';
    if (el('avg-hunger-val')) el('avg-hunger-val').textContent = '0.0 / 50.0 (0%)';
    if (el('avg-hunger-fill')) el('avg-hunger-fill').style.width = '0%';
    if (el('avg-thirst-val')) el('avg-thirst-val').textContent = '0.0 / 50.0 (0%)';
    if (el('avg-thirst-fill')) el('avg-thirst-fill').style.width = '0%';
    if (el('avg-stamina-val')) el('avg-stamina-val').textContent = '0.0%';
    if (el('avg-stamina-fill')) el('avg-stamina-fill').style.width = '0%';
    if (el('avg-age-val')) el('avg-age-val').textContent = '0.0小时';
    if (el('avg-speed-val')) el('avg-speed-val').textContent = '0.0 m/h';
    if (el('avg-gender-val')) el('avg-gender-val').textContent = '0♂ / 0♀';
    if (el('avg-house-val')) el('avg-house-val').textContent = '0% (0间/0户)';
    if (el('avg-single-val')) el('avg-single-val').textContent = '0♂ / 0♀';
    if (el('avg-married-val')) el('avg-married-val').textContent = '0对 (0人)';
    if (el('avg-gini-gold-val')) el('avg-gini-gold-val').textContent = '0.000 (完全平等)';
    if (el('avg-gini-gold-fill')) { el('avg-gini-gold-fill').style.width = '0%'; el('avg-gini-gold-fill').style.background = '#10b981'; }
    if (el('avg-gini-top-val')) el('avg-gini-top-val').textContent = '0.0';
    if (el('avg-gini-bottom-val')) el('avg-gini-bottom-val').textContent = '0.0';
    if (el('avg-gini-ratio-val')) el('avg-gini-ratio-val').textContent = '0.0x';
    if (el('avg-gini-zero-val')) el('avg-gini-zero-val').textContent = '0户';
    return;
  }

  let sumHunger = 0, sumThirst = 0, sumStamina = 0, sumHealth = 0, sumMaxHealth = 0, sumAge = 0, sumSpeed = 0;
  let sumWater = 0, sumFood = 0, sumWood = 0, sumStone = 0, sumGold = 0;
  let sumInt = 0, sumStr = 0, sumDig = 0, sumLib = 0, sumSlp = 0, sumLif = 0;
  let males = 0;
  let singleAdultMales = 0, singleAdultFemales = 0, marriedCount = 0;

  for (let i = 0; i < n; i++) {
    const a = aliveAgents[i];
    sumHunger += a.hunger || 0;
    sumThirst += a.thirst || 0;
    sumStamina += a.stamina || 0;
    const aMaxH = a.maxHealth || a.lifeExpectancy || 100.0;
    sumHealth += a.health !== undefined ? a.health : aMaxH;
    sumMaxHealth += aMaxH;
    sumAge += a.age || 0;
    sumSpeed += a.velocity || 0;

    sumWater += a.carriedWater || 0;
    sumFood += a.carriedFood || 0;
    sumWood += a.carriedWood || 0;
    sumStone += a.carriedStone || 0;
    sumGold += a.carriedGold || 0;

    sumInt += a.intelligence !== undefined ? a.intelligence : 100;
    sumStr += a.strength !== undefined ? a.strength : 100;
    sumDig += a.digestionEfficiency !== undefined ? a.digestionEfficiency : 100;
    sumLib += a.libido !== undefined ? a.libido : 100;
    sumSlp += a.sleepEfficiency !== undefined ? a.sleepEfficiency : 100;
    sumLif += a.lifeExpectancy !== undefined ? a.lifeExpectancy : 100;

    if (a.gender === 'male') males++;

    const isAdult = (a.age || 0) >= 1800.0;
    const isSingle = !a.spouseId;
    if (isSingle) {
      if (isAdult) {
        if (a.gender === 'male') singleAdultMales++;
        else singleAdultFemales++;
      }
    } else {
      marriedCount++;
    }
  }

  const avgHunger = sumHunger / n;
  const avgThirst = sumThirst / n;
  const avgStamina = sumStamina / n;
  const avgHealth = sumHealth / n;
  const avgMaxHealth = sumMaxHealth / n || 100.0;
  const avgAge = sumAge / n;
  const avgSpeed = sumSpeed / n;

  const healthPct = Math.round((avgHealth / avgMaxHealth) * 100);
  const hungerPct = Math.round((avgHunger / 50.0) * 100);
  const thirstPct = Math.round((avgThirst / 50.0) * 100);
  const staminaPct = Math.round(avgStamina);

  const females = n - males;
  // ★ v1.22.6 有房率口径修正：分子 = 有主房屋数（排除空置/在售/无主房），分母 = 存续家户数
  let ownedHousesCount = 0;
  if (houses) {
    for (let i = 0; i < houses.length; i++) {
      const ow = houses[i].ownerId;
      if (ow !== null && ow !== undefined) ownedHousesCount++;
    }
  }
  let activeHouseholdsCount = 0;
  if (households) {
    for (let i = 0; i < households.length; i++) {
      if (!households[i].isDissolved) activeHouseholdsCount++;
    }
  }
  const housePct = activeHouseholdsCount > 0 ? Math.round((ownedHousesCount / activeHouseholdsCount) * 100) : 0;
  const marriedCouples = Math.floor(marriedCount / 2);

  // === 家户金余额基尼系数与财富分配统计（基于家户账本，非个人随身携带量） ===
  const hhGoldValues = (households || [])
    .filter(hh => !hh.isDissolved)
    .map(hh => ({ id: hh.id, gold: (hh.balances && hh.balances.Gold) || 0 }));
  const hhCount = hhGoldValues.length;
  const sortedGold = [...hhGoldValues].sort((a, b) => a.gold - b.gold || a.id - b.id);
  const totalGold = sortedGold.reduce((s, v) => s + v.gold, 0);
  let giniGold = 0;
  if (hhCount > 1 && totalGold > 0) {
    let cumWeighted = 0;
    for (let i = 0; i < hhCount; i++) cumWeighted += (i + 1) * sortedGold[i].gold;
    giniGold = (2 * cumWeighted) / (hhCount * totalGold) - (hhCount + 1) / hhCount;
  }
  const giniPct = Math.round(Math.min(100, Math.max(0, giniGold * 100)));
  let giniLabel, giniColor;
  if (giniGold < 0.2)      { giniLabel = '高度平等';   giniColor = '#10b981'; }
  else if (giniGold < 0.3) { giniLabel = '比较平等';   giniColor = '#22c55e'; }
  else if (giniGold < 0.4) { giniLabel = '相对合理';   giniColor = '#eab308'; }
  else if (giniGold < 0.5) { giniLabel = '差距较大';   giniColor = '#f59e0b'; }
  else if (giniGold < 0.6) { giniLabel = '高度不平等'; giniColor = '#f97316'; }
  else                      { giniLabel = '极端不平等'; giniColor = '#ef4444'; }
  const topEntry = [...hhGoldValues].sort((a, b) => b.gold - a.gold || a.id - b.id)[0];
  const topGold = topEntry ? topEntry.gold : 0;
  const topHouseholdId = topEntry ? topEntry.id : null;
  const bottomGold = sortedGold[0] ? sortedGold[0].gold : 0;
  const richPoorRatio = bottomGold > 0 ? (topGold / bottomGold) : (topGold > 0 ? Infinity : 0);
  const zeroGoldCount = sortedGold.filter(v => v.gold <= 0).length;

  const el = id => document.getElementById(id);
  if (el('avg-health-val')) el('avg-health-val').textContent = `${avgHealth.toFixed(1)} / ${avgMaxHealth.toFixed(1)} (${healthPct}%)`;
  if (el('avg-health-fill')) el('avg-health-fill').style.width = `${Math.min(100, Math.max(0, healthPct))}%`;
  if (el('avg-hunger-val')) el('avg-hunger-val').textContent = `${avgHunger.toFixed(1)} / 50.0 (${hungerPct}%)`;
  if (el('avg-hunger-fill')) el('avg-hunger-fill').style.width = `${Math.min(100, Math.max(0, hungerPct))}%`;
  if (el('avg-thirst-val')) el('avg-thirst-val').textContent = `${avgThirst.toFixed(1)} / 50.0 (${thirstPct}%)`;
  if (el('avg-thirst-fill')) el('avg-thirst-fill').style.width = `${Math.min(100, Math.max(0, thirstPct))}%`;
  if (el('avg-stamina-val')) el('avg-stamina-val').textContent = `${avgStamina.toFixed(1)}%`;
  if (el('avg-stamina-fill')) el('avg-stamina-fill').style.width = `${Math.min(100, Math.max(0, staminaPct))}%`;

  if (el('avg-age-val')) el('avg-age-val').textContent = `${avgAge.toFixed(1)}小时`;
  if (el('avg-speed-val')) el('avg-speed-val').textContent = `${avgSpeed.toFixed(1)} m/h`;
  if (el('avg-gender-val')) el('avg-gender-val').textContent = `${males}♂ / ${females}♀`;
  if (el('avg-house-val')) el('avg-house-val').textContent = `${housePct}% (${ownedHousesCount}间/${activeHouseholdsCount}户)`;
  if (el('avg-single-val')) el('avg-single-val').textContent = `${singleAdultMales}♂ / ${singleAdultFemales}♀`;
  if (el('avg-married-val')) el('avg-married-val').textContent = `${marriedCouples}对 (${marriedCount}人)`;

  if (el('avg-carry-water')) el('avg-carry-water').textContent = (sumWater / n).toFixed(1);
  if (el('avg-carry-food')) el('avg-carry-food').textContent = (sumFood / n).toFixed(1);
  if (el('avg-carry-wood')) el('avg-carry-wood').textContent = (sumWood / n).toFixed(1);
  if (el('avg-carry-stone')) el('avg-carry-stone').textContent = (sumStone / n).toFixed(1);
  if (el('avg-carry-gold')) el('avg-carry-gold').textContent = (sumGold / n).toFixed(1);

  if (el('avg-trait-int')) el('avg-trait-int').textContent = (sumInt / n).toFixed(1);
  if (el('avg-trait-str')) el('avg-trait-str').textContent = (sumStr / n).toFixed(1);
  if (el('avg-trait-dig')) el('avg-trait-dig').textContent = (sumDig / n).toFixed(1);
  if (el('avg-trait-lib')) el('avg-trait-lib').textContent = (sumLib / n).toFixed(1);
  if (el('avg-trait-slp')) el('avg-trait-slp').textContent = (sumSlp / n).toFixed(1);
  if (el('avg-trait-lif')) el('avg-trait-lif').textContent = (sumLif / n).toFixed(1);

  // 基尼指数与财富分配统计
  if (el('avg-gini-gold-val')) el('avg-gini-gold-val').textContent = `${giniGold.toFixed(3)} (${giniLabel})`;
  if (el('avg-gini-gold-fill')) {
    el('avg-gini-gold-fill').style.width = `${giniPct}%`;
    el('avg-gini-gold-fill').style.background = giniColor;
  }
  if (el('avg-gini-top-val')) el('avg-gini-top-val').textContent = topHouseholdId == null ? '—' : `#${topHouseholdId} · ${topGold.toFixed(1)}`;
  if (el('avg-gini-bottom-val')) el('avg-gini-bottom-val').textContent = bottomGold.toFixed(1);
  if (el('avg-gini-ratio-val')) el('avg-gini-ratio-val').textContent = richPoorRatio === Infinity ? '∞' : `${richPoorRatio.toFixed(1)}x`;
  if (el('avg-gini-zero-val')) el('avg-gini-zero-val').textContent = `${zeroGoldCount}户`;
}


// ═══════════════════════════════════════════════════════════
// ★ 账本与家户/婚姻系统渲染函数 (v0.9.72 M1)
// ═══════════════════════════════════════════════════════════

// tick → 游戏小时转换 (1 tick = 1/60 h)
function tickToHour(tick) { return tick / 60.0; }
function tickToSec(tick) { return tickToHour(tick); } // 兼容历史调用
// 游戏小时 → 可读时长
function formatDuration(hours) {
  if (!hours || hours <= 0) return '0小时';
  if (hours < 1) return (hours * 60).toFixed(0) + '分';
  if (hours < 24) return hours.toFixed(1) + '小时';
  const days = Math.floor(hours / 24);
  const remHrs = Math.floor(hours % 24);
  return remHrs > 0 ? `${days}天${remHrs}小时` : `${days}天`;
}

// 更新 Agent Inspector 中的家户与婚姻信息
function updateAgentLedgerInfo(agent) {
  const hhBox = document.getElementById('insp-household-box');
  const mgBox = document.getElementById('insp-marriage-box');
  if (!hhBox || !mgBox) return;
  if (!agent) { hhBox.style.display = 'none'; mgBox.style.display = 'none'; return; }

  // --- 家户归属 ---
  const hh = (typeof sim.getHouseholdOfAgent === 'function') ? sim.getHouseholdOfAgent(agent.id) : null;
  if (hh) {
    hhBox.style.display = 'block';
    document.getElementById('insp-hh-id').textContent = hh.id;
    const headAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(hh.head) : null;
    document.getElementById('insp-hh-head').textContent = '#' + hh.head + (headAgent && headAgent.surname ? '【' + headAgent.surname + '】' : '');
    document.getElementById('insp-hh-members').textContent = hh.members.length;
    // 角色判定（★ M2: 优先使用内核 household_role 字段，回退本地推断）
    const roleMap = { Head: '👑 户主', Spouse: '💍 配偶', Child: '👶 子女', None: '—' };
    let role;
    if (agent.householdRole && agent.householdRole !== 'None' && roleMap[agent.householdRole]) {
      role = roleMap[agent.householdRole];
    } else {
      role = '成员';
      if (hh.head === agent.id) role = '👑 户主';
      else if (agent.gender === 'female') role = '💍 配偶';
      else role = '👶 子女';
    }
    const roleEl = document.getElementById('insp-hh-role');
    roleEl.textContent = role;
    roleEl.style.color = hh.head === agent.id ? '#fbbf24' : (agent.gender === 'female' ? '#ec4899' : '#a78bfa');
    // 分家来源
    const parentEl = document.getElementById('insp-hh-parent');
    if (hh.parentHousehold) {
      parentEl.style.display = 'inline';
      document.getElementById('insp-hh-parent-id').textContent = hh.parentHousehold;
    } else {
      parentEl.style.display = 'none';
    }
    // 账面余额
    const bal = hh.balances || {};
    document.getElementById('insp-hh-bal-water').textContent = (bal.Water || 0).toFixed(1);
    document.getElementById('insp-hh-bal-food').textContent = (bal.Food || 0).toFixed(1);
    document.getElementById('insp-hh-bal-wood').textContent = (bal.Wood || 0).toFixed(1);
    document.getElementById('insp-hh-bal-stone').textContent = (bal.Stone || 0).toFixed(1);
    document.getElementById('insp-hh-bal-gold').textContent = (bal.Gold || 0).toFixed(1);
    // 家户大事记
    const events = hh.recentEvents || [];
    const eventsTitle = document.getElementById('insp-hh-events-title');
    const eventsList = document.getElementById('insp-hh-events');
    if (events.length > 0) {
      eventsTitle.style.display = 'block';
      eventsList.style.display = 'block';
      eventsList.innerHTML = events.slice(0, 5).map(e =>
        '<div class="ledger-event-item">' + e + '</div>'
      ).join('');
    } else {
      eventsTitle.style.display = 'none';
      eventsList.style.display = 'none';
    }
  } else {
    hhBox.style.display = 'none';
  }

  // --- 婚姻登记 ---
  const activeMg = (typeof sim.getActiveMarriageOf === 'function') ? sim.getActiveMarriageOf(agent.id) : null;
  const allMg = (typeof sim.getAllMarriagesOf === 'function') ? sim.getAllMarriagesOf(agent.id) : [];
  const statusEl = document.getElementById('insp-mg-status');
  const activeEl = document.getElementById('insp-mg-active');
  const historyEl = document.getElementById('insp-mg-history');
  const singleEl = document.getElementById('insp-mg-single');

  if (activeMg) {
    mgBox.style.display = 'block';
    activeEl.style.display = 'block';
    historyEl.style.display = allMg.length > 1 ? 'block' : 'none';
    singleEl.style.display = 'none';
    statusEl.textContent = '💍 存续中';
    statusEl.style.color = '#ec4899';
    document.getElementById('insp-mg-id').textContent = activeMg.id;
    const husb = (typeof sim.getAgent === 'function') ? sim.getAgent(activeMg.husbandId) : null;
    const wife = (typeof sim.getAgent === 'function') ? sim.getAgent(activeMg.wifeId) : null;
    document.getElementById('insp-mg-husband').textContent = '#' + activeMg.husbandId + (husb && husb.surname ? '【' + husb.surname + '】' : '');
    document.getElementById('insp-mg-wife').textContent = '#' + activeMg.wifeId + (wife && wife.surname ? '【' + wife.surname + '】' : '');
    const marrySec = tickToSec(sim.tickCount - activeMg.startTick);
    document.getElementById('insp-mg-duration').textContent = formatDuration(marrySec);
    document.getElementById('insp-mg-start').textContent = activeMg.startTick;
    // 历史婚姻（★ M2: 优先使用内核 marriage_history_count）
    const mgTotal = agent.marriageHistoryCount || allMg.length;
    if (allMg.length > 1) {
      document.getElementById('insp-mg-history-count').textContent = mgTotal - 1;
      document.getElementById('insp-mg-history-list').innerHTML = allMg
        .filter(m => !m.isActive)
        .map(m => {
          const dur = m.endTick ? formatDuration(tickToSec(m.endTick - m.startTick)) : '—';
          return '<div class="ledger-mg-history-item">婚姻 #' + m.id + ' · 夫#' + m.husbandId + ' 妻#' + m.wifeId + ' · 存续' + dur + ' · ' + (m.endReason || '丧偶') + '</div>';
        }).join('');
    }
  } else if (allMg.length > 0) {
    mgBox.style.display = 'block';
    activeEl.style.display = 'none';
    historyEl.style.display = 'block';
    singleEl.style.display = 'none';
    statusEl.textContent = '🕊️ 丧偶/离异';
    statusEl.style.color = '#64748b';
    document.getElementById('insp-mg-history-count').textContent = agent.marriageHistoryCount || allMg.length;
    document.getElementById('insp-mg-history-list').innerHTML = allMg.map(m => {
      const dur = m.endTick ? formatDuration(tickToSec(m.endTick - m.startTick)) : '—';
      return '<div class="ledger-mg-history-item">婚姻 #' + m.id + ' · 夫#' + m.husbandId + ' 妻#' + m.wifeId + ' · 存续' + dur + ' · ' + (m.endReason || '丧偶') + '</div>';
    }).join('');
  } else {
    mgBox.style.display = 'block';
    activeEl.style.display = 'none';
    historyEl.style.display = 'none';
    singleEl.style.display = 'block';
    statusEl.textContent = '💔 未婚';
    statusEl.style.color = '#64748b';
  }
}

// 更新家户与账本大盘面板
function updateLedgerPanel() {
  const panel = document.getElementById('ledger-panel');
  if (!panel) return;
  const households = sim.households || [];
  const marriages = sim.marriages || [];
  const activeHH = households.filter(h => !h.isDissolved);
  const dissolvedHH = households.filter(h => h.isDissolved);
  const activeMG = marriages.filter(m => m.isActive);

  // 始终更新计数徽章（即使面板折叠）
  const countEl = document.getElementById('ledger-panel-count');
  if (countEl) countEl.textContent = activeHH.length + '户';

  // 折叠时不更新列表内容
  if (panel.classList.contains('minimized')) return;

  const ovActive = document.getElementById('ledger-ov-active');
  if (ovActive) ovActive.textContent = activeHH.length;
  const ovDissolved = document.getElementById('ledger-ov-dissolved');
  if (ovDissolved) ovDissolved.textContent = dissolvedHH.length;
  const ovMarriages = document.getElementById('ledger-ov-marriages');
  if (ovMarriages) ovMarriages.textContent = activeMG.length;
  const ovTotal = document.getElementById('ledger-ov-marriages-total');
  if (ovTotal) ovTotal.textContent = marriages.length;

  // 家户列表
  const hhList = document.getElementById('ledger-household-list');
  if (hhList) {
    hhList.innerHTML = activeHH.slice(0, 20).map(h => {
      const head = (typeof sim.getAgent === 'function') ? sim.getAgent(h.head) : null;
      const headName = '#' + h.head + (head && head.surname ? '【' + head.surname + '】' : '');
      const bal = h.balances || {};
      const totalBal = (bal.Water||0) + (bal.Food||0) + (bal.Wood||0) + (bal.Stone||0) + (bal.Gold||0);
      return '<div class="ledger-hh-item" data-agent-id="' + h.head + '" title="点击追踪户主 #' + h.head + '">' +
        '<div class="ledger-hh-item-head"><span class="ledger-hh-id">🏠 #' + h.id + '</span>' +
        '<span class="ledger-hh-head-name lineage-chip" data-agent-id="' + h.head + '">' + headName + ' 👑</span>' +
        '<span class="ledger-hh-members">👥 ' + h.members.length + '人</span>' +
        '<span class="ledger-hh-bal-total">📒 ' + totalBal.toFixed(1) + '</span></div>' +
        '<div class="ledger-hh-item-bal">' +
          '<span style="color:#38bdf8;">💧' + (bal.Water||0).toFixed(0) + '</span>' +
          '<span style="color:#10b981;">🍒' + (bal.Food||0).toFixed(0) + '</span>' +
          '<span style="color:#d97706;">🌲' + (bal.Wood||0).toFixed(0) + '</span>' +
          '<span style="color:#94a3b8;">🪨' + (bal.Stone||0).toFixed(0) + '</span>' +
          '<span style="color:#fbbf24;">🪙' + (bal.Gold||0).toFixed(0) + '</span>' +
        '</div></div>';
    }).join('');
    if (activeHH.length > 20) {
      hhList.innerHTML += '<div class="ledger-hh-more">... 另有 ' + (activeHH.length - 20) + ' 户未展示</div>';
    }
    if (activeHH.length === 0) {
      hhList.innerHTML = '<div class="ledger-empty">尚无家户（成年男性立宅后成立）</div>';
    }
  }

  // 婚姻列表
  const mgList = document.getElementById('ledger-marriage-list');
  if (mgList) {
    mgList.innerHTML = marriages.slice(0, 20).map(m => {
      const husb = (typeof sim.getAgent === 'function') ? sim.getAgent(m.husbandId) : null;
      const wife = (typeof sim.getAgent === 'function') ? sim.getAgent(m.wifeId) : null;
      const status = m.isActive ? '<span style="color:#ec4899;">💍存续</span>' : '<span style="color:#64748b;">🕊️' + (m.endReason || '丧偶') + '</span>';
      const dur = m.isActive ? formatDuration(tickToSec(sim.tickCount - m.startTick)) : (m.endTick ? formatDuration(tickToSec(m.endTick - m.startTick)) : '—');
      return '<div class="ledger-mg-item">' +
        '<span class="ledger-mg-id">💍 #' + m.id + '</span>' +
        '<span class="lineage-chip" data-agent-id="' + m.husbandId + '">#' + m.husbandId + (husb && husb.surname ? '【' + husb.surname + '】' : '') + ' ♂</span>' +
        '<span style="color:#64748b;">×</span>' +
        '<span class="lineage-chip" data-agent-id="' + m.wifeId + '">#' + m.wifeId + (wife && wife.surname ? '【' + wife.surname + '】' : '') + ' ♀</span>' +
        '<span class="ledger-mg-dur">' + dur + '</span>' + status +
      '</div>';
    }).join('');
    if (marriages.length > 20) {
      mgList.innerHTML += '<div class="ledger-hh-more">... 另有 ' + (marriages.length - 20) + ' 段未展示</div>';
    }
    if (marriages.length === 0) {
      mgList.innerHTML = '<div class="ledger-empty">尚无婚姻登记</div>';
    }
  }
}

// ============================================================================
// 🌡️ 宏观气候演化预测折线图 (未来 49 年纪元候波)
// ============================================================================

let _climatePopupTimer = null;
let _climatePopupVisible = false;
let _lastClimateChartRenderTick = -1;

function predictClimateTemperature(seasonTimer, elNinoPhase, epochPhase, dtHours) {
  const cfg = window.SIM_CONFIG || {};
  const yearLength = cfg.seasonYearLength || 240.0;
  const t = seasonTimer + dtHours;

  const seasonTime = ((t % yearLength) + yearLength) % yearLength;
  const angle = (seasonTime / yearLength) * (Math.PI * 2);
  const baseMid = cfg.tempBaseMid != null ? cfg.tempBaseMid : 14.0;
  const baseAmp = cfg.tempAmplitude != null ? cfg.tempAmplitude : 17.0;
  const baseTemp = baseMid + baseAmp * Math.sin(angle);

  const ensoYears = Math.max(0.1, cfg.tempElNinoCycleYears != null ? cfg.tempElNinoCycleYears : 7.0);
  const ensoPeriod = ensoYears * yearLength;
  const ensoAngle = elNinoPhase + (t / ensoPeriod) * (Math.PI * 2);
  const ensoAmp = cfg.tempElNinoAmplitude != null ? cfg.tempElNinoAmplitude : 5.0;
  const ensoEffect = ensoAmp * Math.sin(ensoAngle);

  const epochYears = Math.max(0.1, cfg.tempClimateEpochCycleYears != null ? cfg.tempClimateEpochCycleYears : 49.0);
  const epochPeriod = epochYears * yearLength;
  const epochAngle = epochPhase + (t / epochPeriod) * (Math.PI * 2);
  const epochAmp = cfg.tempClimateEpochAmplitude != null ? cfg.tempClimateEpochAmplitude : 5.0;
  const epochEffect = epochAmp * Math.sin(epochAngle);

  return baseTemp + ensoEffect + epochEffect;
}

function renderClimateForecastChart() {
  const canvas = document.getElementById('climate-forecast-canvas');
  if (!canvas || !sim) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = 480;
  const h = 200;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const cfg = window.SIM_CONFIG || {};
  const yearLength = cfg.seasonYearLength || 240.0;
  const seasonTimer = sim.seasonTimer || 0;
  const elNinoPhase = sim.elNinoPhase || 0;
  const epochPhase = sim.climateEpochPhase || 0;
  const currentYear = seasonTimer / yearLength;

  // 预测未来 49 年 (49 * yearLength 小时)
  const totalYears = 49.0;
  const totalDuration = totalYears * yearLength;
  const sampleSteps = 392; // 采样密度高精度平滑曲线
  const samples = new Array(sampleSteps + 1);

  let minTemp = Infinity;
  let maxTemp = -Infinity;
  let minYear = 0;
  let maxYear = 0;

  for (let i = 0; i <= sampleSteps; i++) {
    const fraction = i / sampleSteps;
    const dtHours = fraction * totalDuration;
    const tVal = predictClimateTemperature(seasonTimer, elNinoPhase, epochPhase, dtHours);
    const yr = currentYear + fraction * totalYears;
    samples[i] = { fraction, dtHours, temp: tVal, year: yr };
    if (tVal > maxTemp) {
      maxTemp = tVal;
      maxYear = yr;
    }
    if (tVal < minTemp) {
      minTemp = tVal;
      minYear = yr;
    }
  }

  // 坐标系边距
  const padLeft = 38;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 26;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  // 纵轴范围固定或安全自适应 [-16, 45] 保证 0℃ 与 8℃ 及极端震荡在图内
  const yMin = Math.min(-16, Math.floor(minTemp - 2));
  const yMax = Math.max(45, Math.ceil(maxTemp + 2));
  const tempToY = (t) => padTop + plotH - ((t - yMin) / (yMax - yMin)) * plotH;
  const xToX = (frac) => padLeft + frac * plotW;

  // 1. 背景网格与温度刻度线 (每 10℃ 一道)
  ctx.lineWidth = 1;
  ctx.font = '9px "SFMono-Regular", Consolas, monospace';
  for (let t = Math.ceil(yMin / 10) * 10; t <= yMax; t += 10) {
    const py = tempToY(t);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.beginPath();
    ctx.moveTo(padLeft, py);
    ctx.lineTo(w - padRight, py);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(t + '°', padLeft - 6, py);
  }

  // 2. 关键基准警戒线
  // 14℃ 年均中线
  const y14 = tempToY(14.0);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(padLeft, y14);
  ctx.lineTo(w - padRight, y14);
  ctx.stroke();

  // 8℃ 霜降供暖警戒线
  const y8 = tempToY(cfg.berryFrostDeclineTemp || 8.0);
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(padLeft, y8);
  ctx.lineTo(w - padRight, y8);
  ctx.stroke();
  ctx.fillStyle = '#fbbf24';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('8℃ 霜降供暖', w - padRight - 4, y8 - 2);

  // 0℃ 绝收冰封警戒线
  const y0 = tempToY(cfg.berryFrostZeroTemp || 0.0);
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.85)';
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(padLeft, y0);
  ctx.lineTo(w - padRight, y0);
  ctx.stroke();
  ctx.fillStyle = '#60a5fa';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('0℃ 绝收冰封', w - padRight - 4, y0 - 2);

  ctx.setLineDash([]); // 还原实线

  // 3. 横轴时间刻度 (以 7 年为一个厄尔尼诺周期)
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let yr = 0; yr <= 49; yr += 7) {
    const frac = yr / 49.0;
    const px = xToX(frac);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.moveTo(px, padTop);
    ctx.lineTo(px, h - padBottom);
    ctx.stroke();

    const label = yr === 0 ? '现' : `+${yr}y`;
    ctx.fillText(label, px, h - padBottom + 6);
  }

  // 4. 气温曲线下部填充渐变
  const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
  grad.addColorStop(0, 'rgba(56, 189, 248, 0.22)');
  grad.addColorStop(0.7, 'rgba(56, 189, 248, 0.05)');
  grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

  ctx.beginPath();
  ctx.moveTo(xToX(0), tempToY(samples[0].temp));
  for (let i = 1; i <= sampleSteps; i++) {
    ctx.lineTo(xToX(samples[i].fraction), tempToY(samples[i].temp));
  }
  ctx.lineTo(xToX(1), padTop + plotH);
  ctx.lineTo(xToX(0), padTop + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // 5. 绘制综合气温主曲线
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(xToX(0), tempToY(samples[0].temp));
  for (let i = 1; i <= sampleSteps; i++) {
    ctx.lineTo(xToX(samples[i].fraction), tempToY(samples[i].temp));
  }
  ctx.stroke();

  // 6. 标记极值点与起点
  // 起点 (当前温度)
  const startX = xToX(0);
  const startY = tempToY(samples[0].temp);
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(startX, startY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 最高温点
  const maxSample = samples.find(s => s.temp === maxTemp) || samples[0];
  const maxPx = xToX(maxSample.fraction);
  const maxPy = tempToY(maxSample.temp);
  ctx.fillStyle = '#f87171';
  ctx.beginPath();
  ctx.arc(maxPx, maxPy, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // 最低温点
  const minSample = samples.find(s => s.temp === minTemp) || samples[0];
  const minPx = xToX(minSample.fraction);
  const minPy = tempToY(minSample.temp);
  ctx.fillStyle = '#60a5fa';
  ctx.beginPath();
  ctx.arc(minPx, minPy, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // 7. 更新浮窗 DOM 信息指标
  const nowEl = document.getElementById('climate-popup-now');
  if (nowEl) {
    nowEl.textContent = `当前: ${(sim.temperature || 0).toFixed(1)}°C (第 ${currentYear.toFixed(1)} 年)`;
  }
  const maxEl = document.getElementById('climate-stat-max');
  if (maxEl) {
    maxEl.textContent = `${maxTemp.toFixed(1)}°C (+${(maxYear - currentYear).toFixed(1)}y)`;
  }
  const minEl = document.getElementById('climate-stat-min');
  if (minEl) {
    minEl.textContent = `${minTemp.toFixed(1)}°C (+${(minYear - currentYear).toFixed(1)}y)`;
  }
}

// 绑定气温浮窗鼠标悬停事件
function setupClimateForecastPopup() {
  const trigger = document.getElementById('stat-item-season');
  const popup = document.getElementById('climate-forecast-popup');
  if (!trigger || !popup) return;

  function showPopup() {
    if (_climatePopupTimer) {
      clearTimeout(_climatePopupTimer);
      _climatePopupTimer = null;
    }
    const rect = trigger.getBoundingClientRect();
    const popupW = 508;
    let left = rect.left + rect.width / 2 - popupW / 2;
    // 边界检测防溢出
    if (left < 10) left = 10;
    if (left + popupW > window.innerWidth - 10) left = window.innerWidth - popupW - 10;
    const top = rect.bottom + 8;

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.display = 'block';
    _climatePopupVisible = true;
    renderClimateForecastChart();
  }

  function hidePopup() {
    _climatePopupTimer = setTimeout(() => {
      popup.style.display = 'none';
      _climatePopupVisible = false;
      _climatePopupTimer = null;
    }, 120);
  }

  trigger.addEventListener('mouseenter', showPopup);
  trigger.addEventListener('mouseleave', hidePopup);
  popup.addEventListener('mouseenter', () => {
    if (_climatePopupTimer) {
      clearTimeout(_climatePopupTimer);
      _climatePopupTimer = null;
    }
  });
  popup.addEventListener('mouseleave', hidePopup);
}

// DOM 加载完成后自动初始化气温浮窗
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupClimateForecastPopup);
} else {
  setupClimateForecastPopup();
}
