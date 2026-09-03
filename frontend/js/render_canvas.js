// === Canvas 渲染主循环与共享状态 (从 render.js 拆分) ===
// 共享变量声明 / 马斯洛需求元数据 / render(now) 主循环调度 / 启动
// 子模块: render_world.js (地形/路网/POI/房屋) / render_agents.js (族人/特效) / render_inspector.js (面板/拾取) / render_hud.js (HUD/大盘)

// ==========================================
// 30 FPS 渲染主循环
// ==========================================
let frameCount = 0, lastFpsUpdate = performance.now();
let lastRenderTime = performance.now();
let lastUiUpdate = performance.now();
let lastTopBarUpdate = performance.now(); // 📊 顶栏数据栏独立节流 (无头模式下同样刷新)
const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

// ==========================================
// 🐞 调试模式: 帧耗时 / FPS / 内存采样与 HUD 刷新
// ==========================================
let dbgRenderMs = 0, dbgFrameMs = 0, dbgCurrentFps = 0, dbgHudUpdate = performance.now();
let dbgLastTick = 0, dbgLastTickSec = performance.now(); // ⚡ 每秒真实 Tick 速率采样基准
const dbgElCache = {};

// ★ M4: 夺位远征视口动态标牌与登基礼花状态
let coronationEffects = [];       // {x, y, startTime, particles:[{dx,dy,life}]}
let prevKingsMap = new Map();     // campId -> kingId（上一帧，用于检测新登基）
const CORONATION_DURATION = 2000; // 登基礼花持续 2 秒

// 预分配地形顶点投影缓冲数组 (消除每帧 GC 垃圾回收与对象分配)
let terrainProjX = new Float32Array(3600);
let terrainProjY = new Float32Array(3600);

// Canvas 视口尺寸（每帧在 render() 内更新；全局声明供 render_world/render_agents 等绘制函数共享）
let w = window.innerWidth, h = window.innerHeight;

// ==========================================
// 马斯洛需求层次元数据 (对应 sim_core decisions.rs 的 current_need 标识符)
// ==========================================
const MASLOW_STYLE = {
  Physiological:     { level: 1, icon: '💧', name: '生理需求', color: '#38bdf8', desc: '生存底线：口渴饮水 / 饥饿进食 / 体力<50% 归巢休养' },
  Safety:            { level: 2, icon: '🏠', name: '安全需求', color: '#f59e0b', desc: '家宅安全：私宅水粮木储备填满 / 房屋耐久<50%修缮至100%' },
  Belonging:         { level: 3, icon: '👪', name: '归属与爱', color: '#ec4899', desc: '成家立业：0级仓库水粮填满升级成婚 / 家庭生存纽带' },
  Esteem:            { level: 4, icon: '🏛️', name: '尊重需求', color: '#a78bfa', desc: '阶层跃升：建材采石 / 盖房淘金(45s冷却) / 房屋施工扩建' },
  SelfActualization: { level: 5, icon: '👑', name: '自我实现', color: '#fbbf24', desc: '终极奢华：4级大庄园竣工后的娱乐淘金(180s冷却)' },
};
const NEED_KIND_LABEL = {
  QuenchThirst: '口渴饮水',
  SateHunger: '饥饿进食',
  Rest: '休养生息',
  ReturnHome: '送货回家',       // 专属标签: 安全需求 · 送货回家
  StockWater: '仓库储水',
  StockFood: '仓库储粮',
  StockWood: '过冬木柴',
  StockStone: '采石建材',
  StockGold: '盖房淘金',       // 专属标签: ④ 尊重需求 · 盖房淘金 (45s冷却)
  GoldWealth: '娱乐淘金',      // 专属标签: ⑤ 自我实现 · 娱乐淘金 (180s冷却)
  RepairHouse: '修缮房屋',
  BuildHouse: '施工建房',
  Detour: '越野寻路',
  Courtship: '求偶成婚',
};
const NEED_KIND_REASON = {
  QuenchThirst: '自身水分告急，前往水泉痛饮至满值并带回补给家户账本。',
  SateHunger: '自身饱食告急，前往浆果丛采食至满值并带回补给家户账本。',
  Rest: '正在归宿静坐休养，体力恢复速率 = 8.0%/s × 睡眠效率/100，属性越高休息越快，恢复至 100% 满值后方可结束。',
  ReturnHome: '现场采收或搬运完成，折返回家将行囊卸入家户账本（家庭储备唯一真相源）。',
  RepairHouse: '房屋耐久跌破50%，正在投入体力劳作修缮至100%避免风化坍塌。',
  StockWater: '有房即可：家户账本水 < 100 触发去采，补到 ≥ 200 才停（施密特滞回，与房屋等级脱钩）。',
  StockFood: '有房即可：家户账本粮 < 100 触发去采，补到 ≥ 200 才停。',
  StockWood: '有房即可：家户账本木 < 100 触发去采，补到 ≥ 200 才停。',
  BuildHouse: '家户账本可付本次升级材料（升1级水粮各50/升2级木粮水各75/升3级石木粮水各100/升4级金石木粮水各125）→ 一次性扣账并瞬时晋升，户主威望+1。',
  StockStone: '有房即可：家户账本石 < 100 触发去采，补到 ≥ 200 才停（不再以升级建材为唯一导向）。',
  StockGold: '有房即可：家户账本金 < 100 触发去采，补到 ≥ 200 才停（淘金冷却45s）。',
  GoldWealth: '4级庄园竣工且水/粮/木/石/金均 ≥ 200 后，娱乐性淘金积累随身财富（冷却180s）。',
  Detour: '车道临时受阻，正在荒野中越野寻路。',
  Courtship: '寻访全图魅力最高的单身女性，前往求偶并迎娶入家户。',
};
const LEVEL_NUMERALS = ['①', '②', '③', '④', '⑤'];

// 解析 Rust 侧 current_need 字符串 (如 "Physiological·QuenchThirst" -> 层级元数据)
function parseMaslowNeed(needStr, agent) {
  if (agent) {
    if (agent.state === 'ConstructingHouse') {
      const myHouse = sim.houses && sim.houses.find(h => h.id === agent.homeHouseId);
      const isTier0 = myHouse && (myHouse.tier === 'Tier0Warehouse' || myHouse.tier === 0);
      needStr = isTier0 ? 'Belonging·BuildHouse' : 'Esteem·BuildHouse';
    } else if (agent.state === 'RepairingHouse') {
      needStr = 'Safety·RepairHouse';
    } else if (agent.state === 'ReturningToCamp') {
      if (agent.stamina >= 50.0) {
        needStr = 'Safety·ReturnHome';
      } else {
        needStr = 'Physiological·Rest';
      }
    } else if (agent.state === 'SeekingGold' || agent.state === 'MiningGold') {
      const myHouse = sim.houses && sim.houses.find(h => h.id === agent.homeHouseId);
      const isTier4 = myHouse && (myHouse.tier === 'Tier4Manor' || myHouse.tier === 4);
      if (isTier4) {
        needStr = 'SelfActualization·GoldWealth';
      } else {
        // 房屋未达4级大庄园，所有的淘金行为均为建房备料（④ 尊重需求 · 盖房淘金）
        needStr = 'Esteem·StockGold';
      }
    }
  }
  if (!needStr) return null;
  const idx = needStr.indexOf('·');
  let levelKey = idx > 0 ? needStr.slice(0, idx) : needStr;
  let kindKey = idx > 0 ? needStr.slice(idx + 1) : '';

  // 强校验：StockGold 恒定属于 ④ 尊重需求，GoldWealth 恒定属于 ⑤ 自我实现
  if (kindKey === 'StockGold') {
    levelKey = 'Esteem';
  } else if (kindKey === 'GoldWealth') {
    levelKey = 'SelfActualization';
  }

  const style = MASLOW_STYLE[levelKey];
  if (!style) return null;
  const kindLabel = NEED_KIND_LABEL[kindKey] || kindKey || '休憩满足';
  return {
    levelKey,
    kindKey,
    kindLabel,
    reason: NEED_KIND_REASON[kindKey] || style.desc,
    numeral: LEVEL_NUMERALS[style.level - 1],
    badgeText: `${style.icon} ${style.name} · ${kindLabel}`,
    ...style,
  };
}

// ==========================================
// render(now) 主循环调度
// ==========================================
function render(now) {
  requestAnimationFrame(render);

  if (!now) now = performance.now();
  const elapsed = now - lastRenderTime;

  if (elapsed < FRAME_INTERVAL - 1.5) {
    return;
  }
  lastRenderTime = now - (elapsed % FRAME_INTERVAL);

  const frameStart = performance.now();
  sim.tick();
  const tickEnd = performance.now();

  // 🐞 调试 HUD 刷新 (置于无头模式 return 之前，保证无头长程演化依旧可监视)
  updateDebugHud(now);

  // 📊 顶栏数据栏刷新 (置于无头模式 return 之前，无头模式下同样实时更新人口/宅舍/季节等数据)
  updateTopBarStats(now);

  // 🧠 无头模式: 只推进模拟，跳过全部画布渲染与 DOM 刷新
  if (sim.headless) {
    dbgRenderMs = 0;
    if (sim.debugMode) dbgFrameMs += ((performance.now() - frameStart) - dbgFrameMs) * 0.15;
    return;
  }

// 0. 镜头跟随选中小人
if (isCameraFollow && sim.selectionType === 'agent') {
  const selAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(sim.selectedAgentId) : sim.agents.find(a => a.id === sim.selectedAgentId);
  if (selAgent && selAgent.isAlive && selAgent.pos) {
    const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
    const rx = selAgent.pos.x * cosZ - selAgent.pos.y * sinZ;
    const ry = selAgent.pos.x * sinZ + selAgent.pos.y * cosZ;
    const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
    const y2 = ry * cosX - selAgent.pos.z * sinX;

    const targetPanX = -rx * camera.zoom;
    const targetPanY = -y2 * camera.zoom;
    camera.panX += (targetPanX - camera.panX) * 0.15;
    camera.panY += (targetPanY - camera.panY) * 0.15;
  }
}

w = window.innerWidth;
h = window.innerHeight;
ctx.clearRect(0, 0, w, h);
  // 1. 3D 地形网格渲染
  drawTerrain();

  // 2. 原始生态 POI 渲染
  drawPois();

  // 2.5 自建私产宅舍渲染
  drawHouses();

  // 3. 动态踩踏道路网络渲染
  drawLanes();

  // 4. 部落民 Agent 渲染
  drawAgents();

  // ★ M4: 登基礼花特效
  drawCoronationEffects(now);

frameCount++;
if (now - lastFpsUpdate >= 500) {
  dbgCurrentFps = (frameCount * 1000) / (now - lastFpsUpdate);
  const fpsEl = document.getElementById('stat-fps');
  if (fpsEl) fpsEl.textContent = Math.round(dbgCurrentFps);
  frameCount = 0;
  lastFpsUpdate = now;
}

if (now - lastUiUpdate >= 100) {
  lastUiUpdate = now;

  const aliveAgents = sim.agents.filter(a => a.isAlive);

    // 6. 实时汇总全地图资源大盘
    drawResourceDashboard();

    // 6.5. 实时汇总全图存活部落民属性平均值大盘
    updateGlobalAverages(aliveAgents, sim.houses, sim.households);
  }

  // 7. 刷新动态 Inspector 面板
  updateInspector();
  // ★ v1.12.0 刷新营地辖区详情模态框（若打开）
  if (typeof window._campDetailTick === 'function') window._campDetailTick();
  // ★ v1.15.0 刷新房屋拍卖交易所模态框与顶部数字徽章
  if (typeof window._auctionUiTick === 'function') window._auctionUiTick();

// 🐞 采样本帧「渲染 + UI」耗时与整帧耗时 (调试模式下)
if (sim.debugMode) {
  const frameEnd = performance.now();
  dbgRenderMs += ((frameEnd - tickEnd) - dbgRenderMs) * 0.15;
  dbgFrameMs += ((frameEnd - frameStart) - dbgFrameMs) * 0.15;
}
}

// 启动渲染循环
requestAnimationFrame(render);
