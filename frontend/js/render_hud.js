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

  // ⚡ 现实世界每秒实际推进的模拟 Tick 数 (含倍速加成)
  const realNow = performance.now();
  const dtSec = Math.max(0.001, (realNow - dbgLastTickSec) / 1000);
  const tickRate = Math.max(0, (s.tick - dbgLastTick) / dtSec);
  dbgLastTick = s.tick;
  dbgLastTickSec = realNow;

  dbgSetText('dbg-tick', s.tick.toLocaleString('en-US'));
  dbgSetText('dbg-tick-rate', Math.round(tickRate).toLocaleString('en-US') + ' tick/s');
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
  document.getElementById('stat-houses').textContent = sim.houses.filter(h => !h.isRuin).length;
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

  // 顶栏四季与气温展示
  const seasonIcons = { 'Spring': '🌸 春季', 'Summer': '☀️ 夏季', 'Autumn': '🍂 秋季', 'Winter': '❄️ 冬季' };
  document.getElementById('stat-season').textContent = seasonIcons[sim.currentSeason] || '🌸 春季';
  document.getElementById('stat-temp').textContent = `${sim.temperature.toFixed(1)}°C`;
  document.getElementById('stat-temp').style.color = sim.currentSeason === 'Winter' ? '#38bdf8' : (sim.currentSeason === 'Summer' ? '#f59e0b' : '#e2e8f0');

  // ★ M2: 账本与社会制度 UI 更新（与顶栏统计同一 10FPS 节流）
  if (window.LedgerUI && typeof window.LedgerUI.update === 'function') {
    window.LedgerUI.update(sim);
  }
}

// ==========================================
// 全局存活部落民属性均值大盘汇总计算与 DOM 渲染
// ==========================================
function updateGlobalAverages(aliveAgents, houses) {
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
    if (el('avg-age-val')) el('avg-age-val').textContent = '0.0s';
    if (el('avg-speed-val')) el('avg-speed-val').textContent = '0.0 m/s';
    if (el('avg-gender-val')) el('avg-gender-val').textContent = '0♂ / 0♀';
    if (el('avg-house-val')) el('avg-house-val').textContent = '0% (0间)';
    if (el('avg-single-val')) el('avg-single-val').textContent = '0♂ / 0♀';
    if (el('avg-married-val')) el('avg-married-val').textContent = '0对 (0人)';
    return;
  }

  let sumHunger = 0, sumThirst = 0, sumStamina = 0, sumHealth = 0, sumMaxHealth = 0, sumAge = 0, sumSpeed = 0;
  let sumWater = 0, sumFood = 0, sumWood = 0, sumStone = 0, sumGold = 0;
  let sumInt = 0, sumStr = 0, sumDig = 0, sumLib = 0, sumSlp = 0, sumLif = 0;
  let males = 0, withHouse = 0;
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
    if (a.homeHouseId !== null && a.homeHouseId !== undefined) withHouse++;

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
  const housePct = Math.round((withHouse / n) * 100);
  const validHousesCount = houses ? houses.filter(h => !h.isRuin).length : 0;
  const marriedCouples = Math.floor(marriedCount / 2);

  const el = id => document.getElementById(id);
  if (el('avg-health-val')) el('avg-health-val').textContent = `${avgHealth.toFixed(1)} / ${avgMaxHealth.toFixed(1)} (${healthPct}%)`;
  if (el('avg-health-fill')) el('avg-health-fill').style.width = `${Math.min(100, Math.max(0, healthPct))}%`;
  if (el('avg-hunger-val')) el('avg-hunger-val').textContent = `${avgHunger.toFixed(1)} / 50.0 (${hungerPct}%)`;
  if (el('avg-hunger-fill')) el('avg-hunger-fill').style.width = `${Math.min(100, Math.max(0, hungerPct))}%`;
  if (el('avg-thirst-val')) el('avg-thirst-val').textContent = `${avgThirst.toFixed(1)} / 50.0 (${thirstPct}%)`;
  if (el('avg-thirst-fill')) el('avg-thirst-fill').style.width = `${Math.min(100, Math.max(0, thirstPct))}%`;
  if (el('avg-stamina-val')) el('avg-stamina-val').textContent = `${avgStamina.toFixed(1)}%`;
  if (el('avg-stamina-fill')) el('avg-stamina-fill').style.width = `${Math.min(100, Math.max(0, staminaPct))}%`;

  if (el('avg-age-val')) el('avg-age-val').textContent = `${avgAge.toFixed(1)}s`;
  if (el('avg-speed-val')) el('avg-speed-val').textContent = `${avgSpeed.toFixed(1)} m/s`;
  if (el('avg-gender-val')) el('avg-gender-val').textContent = `${males}♂ / ${females}♀`;
  if (el('avg-house-val')) el('avg-house-val').textContent = `${housePct}% (${validHousesCount}间)`;
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
}


// ═══════════════════════════════════════════════════════════
// ★ 账本与家户/婚姻系统渲染函数 (v0.9.72 M1)
// ═══════════════════════════════════════════════════════════

// tick → 模拟秒转换 (1 tick = 1/30 s)
function tickToSec(tick) { return tick / 30.0; }
// 模拟秒 → 可读时长
function formatDuration(sec) {
  if (sec < 60) return sec.toFixed(0) + 's';
  if (sec < 3600) return (sec / 60).toFixed(1) + 'min';
  return (sec / 3600).toFixed(1) + 'h';
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
