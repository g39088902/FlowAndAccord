// === Canvas 渲染主循环与 Inspector 更新 ===
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
    // 刷新调试 HUD (节流 ~200ms; 于无头模式提前 return 之前调用，保证长程演化仍可监视)
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

    // 预分配地形顶点投影缓冲数组 (消除每帧 GC 垃圾回收与对象分配)
    let terrainProjX = new Float32Array(3600);
    let terrainProjY = new Float32Array(3600);

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
    };
    const NEED_KIND_REASON = {
      QuenchThirst: '自身水分告急(<25.0)，前往水泉痛饮至满值并回填家宅水库。',
      SateHunger: '自身饱食告急(<25.0)，前往浆果丛采食至满值并回填家宅粮仓。',
      Rest: '正在归宿静坐休养，体力恢复速率 = 8.0%/s × 睡眠效率/100，属性越高休息越快，恢复至 100% 满值后方可结束。',
      ReturnHome: '现场采收或搬运完成，折返回家将物资存入私宅仓库（安全需求）。',
      RepairHouse: '房屋耐久跌破50%，正在投入体力劳作修缮至100%避免风化坍塌。',
      StockWater: '私宅水库蓄水不足50%，优先外出运水保障家庭基础生存（安全需求，优先于建房）。',
      StockFood: '私宅粮仓储粮不足50%，优先外出采粮保障家庭基础生存（安全需求，优先于建房）。',
      StockWood: '私宅木料储备不足50%容量，优先外出伐木并一路补满至100%满仓（安全需求，优先于建房）。',
      BuildHouse: '建材已齐备，正在投入体力与30s工时营建或扩建升级私宅（消耗体力）。',
      StockStone: '拥有2~3级私宅且石料不足，前往石矿采石用于升级木石庄舍与大庄园。',
      StockGold: '拥有3级木石庄舍且金库缺金，外出采金备料用于升级4级大庄园(尊重需求，冷却45s)。',
      GoldWealth: '4级大庄园已竣工且物资充沛，闲暇无事外出娱乐性淘金积累随身财富(冷却180s)。',
      Detour: '车道临时受阻，正在荒野中越野寻路。',
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

      const w = window.innerWidth, h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      // 1. 3D 地形网格渲染 (顶点单次投影 + 颜色缓存 + 视口裁剪 + 批处理线框)
      if (sim.showTerrain && sim.terrain && sim.terrain.cells && sim.terrain.cells.length >= sim.terrain.gridSize * sim.terrain.gridSize) {
        const gSize = sim.terrain.gridSize;
        const totalVertices = gSize * gSize;
        if (terrainProjX.length !== totalVertices) {
          terrainProjX = new Float32Array(totalVertices);
          terrainProjY = new Float32Array(totalVertices);
        }

        const cx = w / 2 + camera.panX;
        const cy = h / 2 + camera.panY;
        const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
        const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
        const scale = camera.zoom;

        // 单次全网格顶点投影 (3600 次 vs 原 13924 次)
        for (let i = 0; i < totalVertices; i++) {
          const c = sim.terrain.cells[i];
          const rx = c.wx * cosZ - c.wy * sinZ;
          const ry = c.wx * sinZ + c.wy * cosZ;
          const y2 = ry * cosX - c.elev * sinX;
          terrainProjX[i] = cx + rx * scale;
          terrainProjY[i] = cy + y2 * scale;
        }

        // 视口裁剪绘制地形四边形
        for (let gy = 0; gy < gSize - 1; gy++) {
          const rowOffset0 = gy * gSize;
          const rowOffset1 = (gy + 1) * gSize;
          for (let gx = 0; gx < gSize - 1; gx++) {
            const i00 = rowOffset0 + gx;
            const i10 = rowOffset0 + (gx + 1);
            const i11 = rowOffset1 + (gx + 1);
            const i01 = rowOffset1 + gx;

            const p00x = terrainProjX[i00], p00y = terrainProjY[i00];
            const p10x = terrainProjX[i10], p10y = terrainProjY[i10];
            const p11x = terrainProjX[i11], p11y = terrainProjY[i11];
            const p01x = terrainProjX[i01], p01y = terrainProjY[i01];

            // 视口边界快速剔除
            const minX = Math.min(p00x, p10x, p11x, p01x);
            const maxX = Math.max(p00x, p10x, p11x, p01x);
            const minY = Math.min(p00y, p10y, p11y, p01y);
            const maxY = Math.max(p00y, p10y, p11y, p01y);

            if (maxX < -20 || minX > w + 20 || maxY < -20 || minY > h + 20) {
              continue;
            }

            const c00 = sim.terrain.cells[i00];
            ctx.fillStyle = c00.color || getElevationColor(c00, sim.terrain.minZ, sim.terrain.maxZ);
            ctx.beginPath();
            ctx.moveTo(p00x, p00y);
            ctx.lineTo(p10x, p10y);
            ctx.lineTo(p11x, p11y);
            ctx.lineTo(p01x, p01y);
            ctx.closePath();
            ctx.fill();
          }
        }

        // 批处理绘制地形网格线 (1 次 GPU Stroke 替代原 3481 次独立 Stroke)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        for (let gy = 0; gy < gSize; gy++) {
          const rowOffset = gy * gSize;
          ctx.moveTo(terrainProjX[rowOffset], terrainProjY[rowOffset]);
          for (let gx = 1; gx < gSize; gx++) {
            ctx.lineTo(terrainProjX[rowOffset + gx], terrainProjY[rowOffset + gx]);
          }
        }
        for (let gx = 0; gx < gSize; gx++) {
          ctx.moveTo(terrainProjX[gx], terrainProjY[gx]);
          for (let gy = 1; gy < gSize; gy++) {
            ctx.lineTo(terrainProjX[gy * gSize + gx], terrainProjY[gy * gSize + gx]);
          }
        }
        ctx.stroke();
      }

      // 2. 原始生态 POI 渲染与有限储量指示环 (上限 40.0 单位)
      for (const poi of sim.pois) {
        const p2D = project3D(poi.pos);
        const isSelectedPoi = sim.selectionType === 'poi' && sim.selectedPoiId === poi.id;

        if (poi.type === 'Camp') {
          const campRadius = (22 + (poi.level || 0) * 4) * camera.zoom;
          const grad = ctx.createRadialGradient(p2D.x, p2D.y, 2, p2D.x, p2D.y, campRadius);
          grad.addColorStop(0, 'rgba(245, 158, 11, 0.9)');
          grad.addColorStop(0.45, 'rgba(239, 68, 68, 0.5)');
          grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(p2D.x, p2D.y, campRadius, 0, Math.PI * 2); ctx.fill();

          const campIcon = (poi.level || 0) >= 4 ? '🏛️' : ((poi.level || 0) >= 2 ? '🏘️' : '🏕️');
          ctx.font = `${Math.floor((15 + (poi.level || 0) * 2) * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(campIcon, p2D.x, p2D.y + 4);

          // 营地地名与等级徽章标注 (随缩放自适应显示)
          if (camera.zoom > 0.45) {
            ctx.font = `bold ${Math.max(9, Math.floor(11 * camera.zoom))}px sans-serif`;
            ctx.fillStyle = '#fef08a';
            ctx.fillText(poi.campTitle || poi.name, p2D.x, p2D.y - (14 + (poi.level || 0) * 2) * camera.zoom);
            if (poi.boundHouses > 0) {
              ctx.font = `${Math.max(8, Math.floor(9 * camera.zoom))}px sans-serif`;
              ctx.fillStyle = '#93c5fd';
              ctx.fillText(`${poi.boundHouses}舍`, p2D.x, p2D.y + (16 + (poi.level || 0) * 2) * camera.zoom);
            }
          }
        } else if (poi.type === 'Water') {
          const ratio = isFinite(poi.maxStock) ? (poi.currentStock / poi.maxStock) : 1.0;
          const grad = ctx.createRadialGradient(p2D.x, p2D.y, 2, p2D.x, p2D.y, (12 + ratio * 14) * camera.zoom);
          grad.addColorStop(0, 'rgba(2, 132, 199, 0.9)');
          grad.addColorStop(0.5, 'rgba(56, 189, 248, 0.5)');
          grad.addColorStop(1, 'rgba(2, 132, 199, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(p2D.x, p2D.y, (12 + ratio * 14) * camera.zoom, 0, Math.PI * 2); ctx.fill();

          ctx.font = `${Math.floor(14 * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('💧', p2D.x, p2D.y + 4);

          if (isFinite(poi.maxStock)) {
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.arc(p2D.x, p2D.y, 16 * camera.zoom, -Math.PI/2, -Math.PI/2 + ratio * Math.PI * 2);
            ctx.stroke();
          }
        } else if (poi.type === 'Berry') {
          const ratio = isFinite(poi.maxStock) ? (poi.currentStock / poi.maxStock) : 1.0;
          const grad = ctx.createRadialGradient(p2D.x, p2D.y, 2, p2D.x, p2D.y, (10 + ratio * 12) * camera.zoom);
          grad.addColorStop(0, 'rgba(16, 185, 129, 0.85)');
          grad.addColorStop(0.6, 'rgba(5, 150, 105, 0.4)');
          grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(p2D.x, p2D.y, (10 + ratio * 12) * camera.zoom, 0, Math.PI * 2); ctx.fill();

          ctx.font = `${Math.floor(13 * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('🍒', p2D.x, p2D.y + 4);

          if (isFinite(poi.maxStock)) {
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.arc(p2D.x, p2D.y, 15 * camera.zoom, -Math.PI/2, -Math.PI/2 + ratio * Math.PI * 2);
            ctx.stroke();
          }
        } else if (poi.type === 'Wood') {
          const ratio = isFinite(poi.maxStock) ? (poi.currentStock / poi.maxStock) : 1.0;
          const grad = ctx.createRadialGradient(p2D.x, p2D.y, 2, p2D.x, p2D.y, (11 + ratio * 13) * camera.zoom);
          grad.addColorStop(0, 'rgba(180, 83, 9, 0.90)');
          grad.addColorStop(0.6, 'rgba(146, 64, 14, 0.45)');
          grad.addColorStop(1, 'rgba(120, 53, 15, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(p2D.x, p2D.y, (11 + ratio * 13) * camera.zoom, 0, Math.PI * 2); ctx.fill();

          ctx.font = `${Math.floor(13 * camera.zoom)}px -apple-system, "Segoe UI", sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('🌲', p2D.x, p2D.y + 4);

          if (isFinite(poi.maxStock)) {
            ctx.strokeStyle = '#b45309';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.arc(p2D.x, p2D.y, 15 * camera.zoom, -Math.PI/2, -Math.PI/2 + ratio * Math.PI * 2);
            ctx.stroke();
          }
        } else if (poi.type === 'Stone') {
          const ratio = isFinite(poi.maxStock) ? (poi.currentStock / poi.maxStock) : 1.0;
          const grad = ctx.createRadialGradient(p2D.x, p2D.y, 2, p2D.x, p2D.y, (10 + ratio * 12) * camera.zoom);
          grad.addColorStop(0, 'rgba(148, 163, 184, 0.85)');
          grad.addColorStop(0.6, 'rgba(100, 116, 139, 0.4)');
          grad.addColorStop(1, 'rgba(148, 163, 184, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(p2D.x, p2D.y, (10 + ratio * 12) * camera.zoom, 0, Math.PI * 2); ctx.fill();

          ctx.font = `${Math.floor(13 * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('🪨', p2D.x, p2D.y + 4);

          if (isFinite(poi.maxStock)) {
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.arc(p2D.x, p2D.y, 15 * camera.zoom, -Math.PI/2, -Math.PI/2 + ratio * Math.PI * 2);
            ctx.stroke();
          }
        } else if (poi.type === 'Gold') {
          const ratio = isFinite(poi.maxStock) ? (poi.currentStock / poi.maxStock) : 1.0;
          const grad = ctx.createRadialGradient(p2D.x, p2D.y, 2, p2D.x, p2D.y, (12 + ratio * 14) * camera.zoom);
          grad.addColorStop(0, 'rgba(251, 191, 36, 0.95)');
          grad.addColorStop(0.5, 'rgba(245, 158, 11, 0.55)');
          grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(p2D.x, p2D.y, (12 + ratio * 14) * camera.zoom, 0, Math.PI * 2); ctx.fill();

          ctx.font = `${Math.floor(14 * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('🪙', p2D.x, p2D.y + 4);

          if (isFinite(poi.maxStock)) {
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.arc(p2D.x, p2D.y, 16 * camera.zoom, -Math.PI/2, -Math.PI/2 + ratio * Math.PI * 2);
            ctx.stroke();
          }
        }

        if (isSelectedPoi) {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
          ctx.lineWidth = 4.0 * camera.zoom;
          ctx.beginPath();
          ctx.arc(p2D.x, p2D.y, 22 * camera.zoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8 * camera.zoom;
          ctx.beginPath();
          ctx.arc(p2D.x, p2D.y, 22 * camera.zoom, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 2.5 自建私产宅舍渲染 (0级仓库 📦 / 1级茅草房 🛖 / 2级私宅 🏡 / 3级庄舍 🏯 / 4级庄园 🏰 / 无主废墟 🏚️)
      for (const house of sim.houses) {
        const p2D = project3D(house.pos);
        const isSelectedHouse = sim.selectionType === 'house' && sim.selectedHouseId === house.id;
        const isWarehouse = house.tier === 'Tier0Warehouse';
        let tierIcon = '📦';
        let tierLabel = '仓';
        if (house.tier === 'Tier1ThatchedHut') { tierIcon = '🛖'; tierLabel = '茅'; }
        else if (house.tier === 'Tier2LeanTo') { tierIcon = '🏡'; tierLabel = '宅'; }
        else if (house.tier === 'Tier3Homestead') { tierIcon = '🏯'; tierLabel = '庄'; }
        else if (house.tier === 'Tier4Manor') { tierIcon = '🏰'; tierLabel = '堡'; }

        if (house.isRuin) {
          ctx.font = `${Math.floor(14 * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('🏚️', p2D.x, p2D.y + 4);
          ctx.font = '9px sans-serif';
          ctx.fillStyle = '#ef4444';
          ctx.fillText(`#${house.id}废墟`, p2D.x, p2D.y + 16 * camera.zoom);
        } else {
          // 居所光晕与图标
          const glowColor = isWarehouse ? 'rgba(217, 119, 6, 0.45)' : (house.tier === 'Tier4Manor' ? 'rgba(168, 85, 247, 0.45)' : 'rgba(245, 158, 11, 0.45)');
          const grad = ctx.createRadialGradient(p2D.x, p2D.y, 2, p2D.x, p2D.y, 18 * camera.zoom);
          grad.addColorStop(0, glowColor);
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(p2D.x, p2D.y, 18 * camera.zoom, 0, Math.PI * 2); ctx.fill();

          ctx.font = `${Math.floor(16 * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(tierIcon, p2D.x, p2D.y + 4);

          // 门牌与仓储数值提示
          ctx.font = '8px sans-serif';
          if (house.isRepairing) {
            ctx.fillStyle = '#38bdf8';
            ctx.fillText(`🔧修缮(${Math.round(house.durability)}%)`, p2D.x, p2D.y + 16 * camera.zoom);
          } else {
            ctx.fillStyle = house.isFertilityActive() ? '#10b981' : '#fde68a';
            ctx.fillText(`#${house.id}${tierLabel}(💧${Math.round(house.pantryWater)}/🍒${Math.round(house.pantryFood)}/🌲${Math.round(house.pantryWood)}${house.pantryStone > 0 ? '/🪨' + Math.round(house.pantryStone) : ''})`, p2D.x, p2D.y + 16 * camera.zoom);
          }
        }

        if (isSelectedHouse) {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
          ctx.lineWidth = 4.0 * camera.zoom;
          ctx.beginPath();
          ctx.arc(p2D.x, p2D.y, 16 * camera.zoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8 * camera.zoom;
          ctx.beginPath();
          ctx.arc(p2D.x, p2D.y, 16 * camera.zoom, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 3. 动态踩踏道路网络渲染与鼠标悬浮拾取 (初始无路 wear=0，人走多了踩出道路并升级至最高 5.0，无人走自然退化衰减)
      hoveredLane = null;
      let minHoverDist = 14;

      if (sim.showLanes) {
        // 先进行鼠标悬浮检测 (仅对可见道路 wear >= 0.3)
        if (!isDragging && mousePos.x >= 0 && mousePos.y >= 0) {
          for (const lane of sim.network.lanes.values()) {
            const wear = lane.wear || 0.0;
            if (wear < 0.3) continue;

            const segs = 12;
            let prev2D = null;
            for (let i = 0; i <= segs; i++) {
              const pt3D = lane.curve.evalPos(i / segs);
              const p2D = project3D(pt3D);
              if (prev2D) {
                const d = distToSegment(mousePos.x, mousePos.y, prev2D.x, prev2D.y, p2D.x, p2D.y);
                if (d < minHoverDist) {
                  minHoverDist = d;
                  hoveredLane = lane;
                }
              }
              prev2D = p2D;
            }
          }
        }

        // 渲染车道 (仅从 0.3 级开始显现，1级~5级动态质感演化)
        for (const lane of sim.network.lanes.values()) {
          const wear = lane.wear || 0.0;
          if (wear < 0.3) {
            // 原始荒野无路或踩踏痕迹过浅 (< 0.3级)，不显现
            continue;
          }

          const isHovered = hoveredLane && (lane.id === hoveredLane.id || (hoveredLane.reverseId && lane.id === hoveredLane.reverseId));

          const lineWidth = 2.0 * camera.zoom;
          let strokeColor, lineDash;
          if (wear < 1.0) {
            // 1级 踩踏初现细径 (泥土细道虚线，0.3 ~ 1.0 级平滑淡出)
            const t = (wear - 0.3) / 0.7;
            const alpha = Math.min(0.75, 0.20 + t * 0.45);
            strokeColor = `rgba(180, 83, 9, ${alpha})`;
            lineDash = [3, 4];
          } else if (wear < 2.0) {
            // 2级 夯土小道 (常通行道路，琥珀暖橙)
            const alpha = Math.min(0.85, 0.45 + (wear - 1.0) * 0.35);
            strokeColor = `rgba(245, 158, 11, ${alpha})`;
            lineDash = [];
          } else if (wear < 3.0) {
            // 3级 平整硬质石道 (高频主干道，明黄金色)
            strokeColor = 'rgba(250, 204, 21, 0.95)';
            lineDash = [];
          } else if (wear < 4.0) {
            // 4级 精修石板通衢 (坚固大道，冰蓝青色)
            strokeColor = 'rgba(56, 189, 248, 0.95)';
            lineDash = [];
          } else {
            // 5级 极品帝国大道 (最高等级通衢，尊贵紫粉金)
            strokeColor = 'rgba(217, 70, 239, 1.0)';
            lineDash = [];
          }

          // 鼠标悬浮高亮光晕
          if (isHovered) {
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
            ctx.lineWidth = lineWidth + 3.0 * camera.zoom;
            ctx.beginPath();
            const segs = 16;
            for (let i = 0; i <= segs; i++) {
              const pt3D = lane.curve.evalPos(i / segs);
              const p2D = project3D(pt3D);
              if (i === 0) ctx.moveTo(p2D.x, p2D.y);
              else ctx.lineTo(p2D.x, p2D.y);
            }
            ctx.stroke();
          }

          // 高等级大道外圈微光
          if (wear >= 4.0) {
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.25)';
            ctx.lineWidth = lineWidth + 3.0 * camera.zoom;
            ctx.beginPath();
            const segs = 16;
            for (let i = 0; i <= segs; i++) {
              const pt3D = lane.curve.evalPos(i / segs);
              const p2D = project3D(pt3D);
              if (i === 0) ctx.moveTo(p2D.x, p2D.y);
              else ctx.lineTo(p2D.x, p2D.y);
            }
            ctx.stroke();
          }

          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = lineWidth;
          ctx.setLineDash(lineDash);
          ctx.beginPath();
          const segs = 16;
          for (let i = 0; i <= segs; i++) {
            const pt3D = lane.curve.evalPos(i / segs);
            const p2D = project3D(pt3D);
            if (i === 0) ctx.moveTo(p2D.x, p2D.y);
            else ctx.lineTo(p2D.x, p2D.y);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // 更新悬浮 Tooltip 提示
        const roadTooltip = document.getElementById('road-hover-tooltip');
        const cfg = window.SIM_CONFIG || {};
        if (roadTooltip) {
          if (hoveredLane) {
            const wear = Math.min(cfg.roadMaxWear || 5.0, hoveredLane.wear || 0.0);
            let levelName = '1级 踩踏细径 (泥土小道)';
            let levelColor = '#b45309';
            let barColor = '#f59e0b';
            let badgeText = '1级 初见成型';

            if (wear >= 4.0) {
              levelName = '5级 极品帝国大道 (顶级通衢)';
              levelColor = '#f59e0b';
              barColor = 'linear-gradient(90deg, #f59e0b, #ec4899)';
              badgeText = '5级 极品通衢';
            } else if (wear >= 3.0) {
              levelName = '4级 精修石板通衢 (坚固大道)';
              levelColor = '#38bdf8';
              barColor = '#38bdf8';
              badgeText = '4级 精修石板';
            } else if (wear >= 2.0) {
              levelName = '3级 平整石道 (硬化主路)';
              levelColor = '#facc15';
              barColor = '#facc15';
              badgeText = '3级 平整石道';
            } else if (wear >= 1.0) {
              levelName = '2级 夯土土路 (常行小道)';
              levelColor = '#fb923c';
              barColor = '#fb923c';
              badgeText = '2级 夯土土路';
            }

            const speedFactor = (cfg.roadLevelFactorBase + cfg.roadLevelFactorWearCoef * wear);
            const speedBonusPct = Math.round((speedFactor - 1.0) * 100);
            const speedText = speedBonusPct >= 0 ? `+${speedBonusPct}%` : `${speedBonusPct}%`;
            const wearPct = Math.round((wear / (cfg.roadMaxWear || 5.0)) * 100);

            roadTooltip.innerHTML = `
              <div class="road-tooltip-title">
                <span style="color:${levelColor}; font-weight:700;">🛣️ ${levelName}</span>
                <span style="color:${levelColor}; font-size:10px; background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px;">${badgeText}</span>
              </div>
              <div style="display:flex; justify-content:space-between; margin-top:2px;">
                <span style="color:#94a3b8;">耐久度 / 踩踏值:</span>
                <span style="color:#f8fafc; font-weight:700; font-family:monospace;">${wear.toFixed(2)} / ${(cfg.roadMaxWear || 5.0).toFixed(2)} (${wearPct}%)</span>
              </div>
              <div class="road-tooltip-bar-bg">
                <div class="road-tooltip-bar-fill" style="width:${wearPct}%; background:${barColor};"></div>
              </div>
              <div style="display:flex; justify-content:space-between; margin-top:3px;">
                <span style="color:#94a3b8;">移动速度加成:</span>
                <span style="color:#38bdf8; font-weight:700; font-family:monospace;">${speedFactor.toFixed(2)}x (${speedText})</span>
              </div>
              <div style="font-size:10px; color:#64748b; margin-top:3px; border-top:1px solid rgba(255,255,255,0.06); padding-top:4px;">
                👟 步行通行: <span style="color:#10b981;">+${cfg.roadWearStepInc || 0.05}/次</span> · 闲置自然衰减: <span style="color:#f87171;">-${(wear * (cfg.roadWearDecayRate || 0.0067)).toFixed(4)}/s (${((cfg.roadWearDecayRate || 0.0067) * 100).toFixed(2)}%/s)</span>
              </div>
            `;

            roadTooltip.style.display = 'flex';
            roadTooltip.style.borderColor = levelColor;

            const tw = 250, th = 130;
            let tx = mousePos.x + 16;
            let ty = mousePos.y + 16;
            if (tx + tw > window.innerWidth - 10) tx = mousePos.x - tw - 12;
            if (ty + th > window.innerHeight - 10) ty = mousePos.y - th - 12;
            roadTooltip.style.left = `${tx}px`;
            roadTooltip.style.top = `${ty}px`;
          } else {
            roadTooltip.style.display = 'none';
          }
        }
      } else {
        const roadTooltip = document.getElementById('road-hover-tooltip');
        if (roadTooltip) roadTooltip.style.display = 'none';
      }

      // 4. 部落民 Agent 渲染 (受「👤 隐藏部落民」开关控制)
      const agentsToRender = sim.showAgents ? sim.agents : [];
      for (const agent of agentsToRender) {
        const p2D = project3D(agent.pos);
        const isSelectedAgent = sim.selectionType === 'agent' && sim.selectedAgentId === agent.id;

        if (!agent.isAlive) {
          const deathAlpha = Math.max(0, Math.min(1.0, agent.deathDecayTimer / 4.0));
          ctx.save();
          ctx.globalAlpha = deathAlpha;
          ctx.font = `${Math.floor(13 * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('💀', p2D.x, p2D.y);
          ctx.restore();
          continue;
        }

        let stateColor = '#facc15';
        if (agent.state === 'SeekingWater' || agent.state === 'DrinkingAtWater') stateColor = '#38bdf8';
        else if (agent.state === 'SeekingFood' || agent.state === 'ForagingFood') stateColor = '#10b981';
        else if (agent.state === 'SeekingWood' || agent.state === 'GatheringWood') stateColor = '#eab308';
        else if (agent.state === 'SeekingStone' || agent.state === 'MiningStone') stateColor = '#94a3b8';
        else if (agent.state === 'SeekingGold' || agent.state === 'MiningGold') stateColor = '#fbbf24';
        else if (agent.state === 'ReturningToCamp') stateColor = '#f59e0b';
        else if (agent.state === 'ConstructingHouse') stateColor = '#f59e0b';

        // 幼年期标识 (未满 1800s)
        const isAdult = agent.age >= 1800.0;

        if (agent.state === 'ConstructingHouse') {
          // 绘制 🔨 施工标识与进度环 (30s 成本翻倍)
          ctx.font = `${Math.floor(14 * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('🔨', p2D.x, p2D.y - 12 * camera.zoom);

          const progress = Math.min(1.0, agent.buildTimer / 30.0);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.0;
          ctx.beginPath();
          ctx.arc(p2D.x, p2D.y, 8.5 * camera.zoom, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
          ctx.stroke();
        }

        if (agent.isPregnant) {
          stateColor = '#ec4899';
          ctx.strokeStyle = '#ec4899';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(p2D.x, p2D.y, (8 + agent.pregnancyProgress * 6) * camera.zoom, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (agent.miscarriageTimer > 0) {
          const mAlpha = Math.max(0, Math.min(1.0, agent.miscarriageTimer / 2.0));
          const floatY = (5.0 - agent.miscarriageTimer) * 7.0;
          ctx.save();
          ctx.globalAlpha = mAlpha;
          ctx.font = `${Math.floor(15 * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('🥀', p2D.x, p2D.y - 12 * camera.zoom - floatY);
          ctx.restore();
        }

        if (agent.trail.length > 1) {
          ctx.save();
          ctx.lineWidth = 1.4 * camera.zoom;
          ctx.lineCap = 'round';
          for (let t = 0; t < agent.trail.length - 1; t++) {
            const pA = project3D(agent.trail[t]);
            const pB = project3D(agent.trail[t + 1]);
            const alpha = ((t + 1) / agent.trail.length) * 0.45;
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = stateColor;
            ctx.beginPath();
            ctx.moveTo(pA.x, pA.y);
            ctx.lineTo(pB.x, pB.y);
            ctx.stroke();
          }
          ctx.restore();
        }

        // 幼体稍小 (3.0px)，成体标准 (4.5px)
        const agentRadius = (isAdult ? 4.5 : 3.2) * camera.zoom;
        ctx.fillStyle = stateColor;
        ctx.beginPath();
        ctx.arc(p2D.x, p2D.y, agentRadius, 0, Math.PI * 2);
        ctx.fill();

        if (isSelectedAgent) {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
          ctx.lineWidth = 3.5 * camera.zoom;
          ctx.beginPath();
          ctx.arc(p2D.x, p2D.y, 9.5 * camera.zoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.6 * camera.zoom;
          ctx.beginPath();
          ctx.arc(p2D.x, p2D.y, 9.5 * camera.zoom, 0, Math.PI * 2);
          ctx.stroke();
        }

        // 选中小人头顶显示完整需求标签 (层级名 · 具体需求)
        const need = parseMaslowNeed(agent.currentNeed, agent);
        if (isSelectedAgent && need) {
          const label = `${need.icon} ${need.name} · ${need.kindLabel}`;
          ctx.font = `${Math.max(8, Math.floor(10 * camera.zoom))}px sans-serif`;
          ctx.textAlign = 'center';
          const tw = ctx.measureText(label).width;
          const pillH = 14 * camera.zoom;
          const pillY = p2D.y - 14 * camera.zoom - pillH;
          const bx = p2D.x - tw / 2 - 5 * camera.zoom;
          const bw = tw + 10 * camera.zoom;
          ctx.fillStyle = 'rgba(5, 10, 18, 0.88)';
          ctx.strokeStyle = need.color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.roundRect(bx, pillY, bw, pillH, 4 * camera.zoom);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = need.color;
          ctx.fillText(label, p2D.x, pillY + pillH * 0.72);
        }

        // ★ M4: 夺位远征动态标牌（金色战盔 + 虚线光束指向目标营地）
        if (agent.isOnExpedition && sim.expeditionTargets) {
          const targetCampId = sim.expeditionTargets.get(agent.id);
          if (targetCampId != null) {
            const targetPoi = sim.pois.find(p => p.id === targetCampId && p.type === 'Camp');
            if (targetPoi) {
              const t2D = project3D(targetPoi.pos);
              // 金色虚线光束
              ctx.save();
              ctx.setLineDash([5 * camera.zoom, 5 * camera.zoom]);
              ctx.strokeStyle = 'rgba(251,191,36,0.5)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(p2D.x, p2D.y);
              ctx.lineTo(t2D.x, t2D.y);
              ctx.stroke();
              ctx.restore();
              // 金色战盔图标（带光晕）
              ctx.save();
              ctx.shadowColor = '#fbbf24';
              ctx.shadowBlur = 8;
              ctx.font = `${Math.floor(14 * camera.zoom)}px serif`;
              ctx.textAlign = 'center';
              ctx.fillText('⚔️', p2D.x, p2D.y - 18 * camera.zoom);
              ctx.restore();
            }
          }
        }
      }

      // ★ M4: 登基礼花检测（对比上一帧 kings，新登基时在营地位置触发金色粒子爆炸）
      if (sim.regions && sim.regions.length > 0) {
        for (const r of sim.regions) {
          const prevKing = prevKingsMap.get(r.campId);
          if (r.kingId != null && prevKing !== r.kingId) {
            const campPoi = sim.pois.find(p => p.id === r.campId && p.type === 'Camp');
            if (campPoi) {
              const cp = project3D(campPoi.pos);
              const particles = [];
              for (let i = 0; i < 24; i++) {
                const angle = (Math.PI * 2 * i) / 24 + Math.random() * 0.3;
                const speed = 1.5 + Math.random() * 2.5;
                particles.push({ dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed, life: 1.0 });
              }
              coronationEffects.push({ x: cp.x, y: cp.y, startTime: performance.now(), particles });
            }
          }
          prevKingsMap.set(r.campId, r.kingId);
        }
      }

      // ★ M4: 绘制登基礼花粒子（2秒后自动清除）
      const nowCor = performance.now();
      coronationEffects = coronationEffects.filter(eff => nowCor - eff.startTime < CORONATION_DURATION);
      for (const eff of coronationEffects) {
        const elapsed = nowCor - eff.startTime;
        const t = elapsed / CORONATION_DURATION;
        const alpha = Math.max(0, 1 - t);
        ctx.save();
        for (const p of eff.particles) {
          const px = eff.x + p.dx * t * 40 * camera.zoom;
          const py = eff.y + p.dy * t * 40 * camera.zoom + t * t * 15 * camera.zoom;
          ctx.globalAlpha = alpha * p.life;
          ctx.fillStyle = '#fbbf24';
          ctx.shadowColor = '#fbbf24';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(px, py, 2.5 * camera.zoom, 0, Math.PI * 2);
          ctx.fill();
          p.life = Math.max(0, p.life - 0.008);
        }
        ctx.restore();
      }

      // 5. 更新顶栏统计 (降频至 ~100ms 刷新一次，减少 DOM 重排重绘)
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

        // 6. 实时汇总全地图资源大盘 (水/果/木/石/金)
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

        // 6.5. 实时汇总全图存活部落民属性平均值大盘
        updateGlobalAverages(aliveAgents, sim.houses);
      }

      // 7. 刷新动态 Inspector 面板
      const inspectorCard = document.getElementById('inspector-card');
      const agentView = document.getElementById('insp-agent-view');
      const poiView = document.getElementById('insp-poi-view');
      const houseView = document.getElementById('insp-house-view');
      const followBtn = document.getElementById('insp-agent-actions');

      // 关闭状态 (点击 ✕ 或按 Esc): 无选中时整体隐藏 Inspector 面板
      if (!sim.selectionType) {
        agentView.style.display = 'none';
        poiView.style.display = 'none';
        houseView.style.display = 'none';
        if (followBtn) followBtn.style.display = 'none';
        if (inspectorCard) inspectorCard.style.display = 'none';
        return;
      }
      if (inspectorCard) inspectorCard.style.display = 'flex';

      // ★ Agent 家户/婚姻信息渲染 (仅当选中 agent 时)
      if (sim.selectionType === 'agent' && sim.selectedAgentId !== null) {
        const _ledgerAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(sim.selectedAgentId) : sim.agents.find(a => a.id === sim.selectedAgentId);
        updateAgentLedgerInfo(_ledgerAgent);
      }

      if (sim.selectionType === 'house' && sim.selectedHouseId !== null) {
        const house = sim.houses.find(h => h.id === sim.selectedHouseId);
        if (house) {
          agentView.style.display = 'none';
          poiView.style.display = 'none';
          houseView.style.display = 'flex';
          if (followBtn) followBtn.style.display = 'none';

          const isWarehouse = house.tier === 'Tier0Warehouse';
          let tierTitle = '📦 0级 仓库';
          if (house.tier === 'Tier1ThatchedHut') tierTitle = '🛖 1级 茅草房';
          else if (house.tier === 'Tier2LeanTo') tierTitle = '🏡 2级 私宅';
          else if (house.tier === 'Tier3Homestead') tierTitle = '🏯 3级 木石庄舍';
          else if (house.tier === 'Tier4Manor') tierTitle = '🏰 4级 家族大庄园';

          document.getElementById('insp-title-name').textContent = `${tierTitle} #${house.id}`;
          
          let stateText = '🌿 私人居所';
          if (house.isRuin) {
            stateText = '💀 绝嗣废墟 (快速风化中)';
          } else if (house.isRepairing) {
            stateText = `🔧 族人劳作修缮中 (${Math.round(house.durability)}%)`;
          } else if (house.durability < 85.0) {
            stateText = `⚠️ 建筑磨损折旧 (${Math.round(house.durability)}% 待修缮)`;
          } else if (house.isPantryFull()) {
            stateText = house.tier === 'Tier4Manor' ? '🏰 终极庄园满仓' : '🔨 材料已备齐 (升级扩容中)';
          } else {
            stateText = isWarehouse ? '📦 储备补给中 (需水粮各满10.0)' : '🌾 私产安居中 (持续储备扩产)';
          }
          document.getElementById('insp-title-state').textContent = stateText;
          document.getElementById('insp-title-state').style.color = house.isRuin ? '#ef4444' : (house.isRepairing ? '#38bdf8' : (isWarehouse ? '#f59e0b' : '#10b981'));

          const durPct = Math.round(house.durability);
          document.getElementById('insp-house-dur-val').textContent = `${durPct}% (${house.isRuin ? '加速风化中' : (house.isRepairing ? '族人修缮回血中' : (durPct < 85 ? '需修缮' : '稳固使用中'))})`;
          document.getElementById('insp-house-dur-fill').style.width = `${durPct}%`;
          document.getElementById('insp-house-dur-fill').style.background = durPct < 30 ? '#ef4444' : (durPct < 85 ? '#f59e0b' : '#10b981');

          // 独立清泉储量 (水)
          const waterPct = Math.round((house.pantryWater / house.maxPantryWater) * 100);
          document.getElementById('insp-house-water-val').textContent = `${house.pantryWater.toFixed(1)} / ${house.maxPantryWater.toFixed(1)} 单位 (${waterPct}%)`;
          document.getElementById('insp-house-water-fill').style.width = `${waterPct}%`;

          // 独立粮食储量 (果)
          const foodPct = Math.round((house.pantryFood / house.maxPantryFood) * 100);
          document.getElementById('insp-house-food-val').textContent = `${house.pantryFood.toFixed(1)} / ${house.maxPantryFood.toFixed(1)} 单位 (${foodPct}%)`;
          document.getElementById('insp-house-food-fill').style.width = `${foodPct}%`;

          // 独立木材储量 (木)
          const woodPct = Math.round((house.pantryWood / house.maxPantryWood) * 100);
          document.getElementById('insp-house-wood-val').textContent = `${house.pantryWood.toFixed(1)} / ${house.maxPantryWood.toFixed(1)} 单位 (${woodPct}%)`;
          document.getElementById('insp-house-wood-fill').style.width = `${woodPct}%`;

          // 独立石料储量 (石)
          const stonePct = Math.round((house.pantryStone / house.maxPantryStone) * 100);
          document.getElementById('insp-house-stone-val').textContent = `${house.pantryStone.toFixed(1)} / ${house.maxPantryStone.toFixed(1)} 单位 (${stonePct}%)`;
          document.getElementById('insp-house-stone-fill').style.width = `${stonePct}%`;

          // 独立黄金储量 (金)
          const goldPct = Math.round((house.pantryGold / Math.max(1, house.maxPantryGold)) * 100);
          const goldValEl = document.getElementById('insp-house-gold-val');
          const goldFillEl = document.getElementById('insp-house-gold-fill');
          if (goldValEl && goldFillEl) {
            goldValEl.textContent = `${house.pantryGold.toFixed(1)} / ${house.maxPantryGold.toFixed(1)} 单位 (${goldPct}%)`;
            goldFillEl.style.width = `${goldPct}%`;
          }

          // 建筑形态与升级要求
          const tierDescElem = document.getElementById('insp-house-tier-desc');
          if (tierDescElem) {
            let upgradeCondition = '';
            if (isWarehouse) upgradeCondition = `0级 仓库 (需搬运水粮各满 ${(house.maxPantryWater * 0.9).toFixed(0)}单位升级为1级茅草房)`;
            else if (house.tier === 'Tier1ThatchedHut') upgradeCondition = `1级 茅草房 (仓储上限: ${house.maxPantryWater.toFixed(0)}单位，升级2级私宅需木材 ${(house.maxPantryWood * 0.85).toFixed(0)}单位)`;
            else if (house.tier === 'Tier2LeanTo') upgradeCondition = `2级 私宅 (仓储上限: ${house.maxPantryWater.toFixed(0)}单位，升级3级庄舍需石头 ${(house.maxPantryStone * 0.85).toFixed(0)}单位)`;
            else if (house.tier === 'Tier3Homestead') upgradeCondition = `3级 木石庄舍 (仓储上限: ${house.maxPantryWater.toFixed(0)}单位，升级4级庄园需金石建材)`;
            else upgradeCondition = `4级 家族大庄园 (终极形态，仓储上限 160 单位)`;
            tierDescElem.textContent = upgradeCondition;
            tierDescElem.style.color = isWarehouse ? '#f59e0b' : '#10b981';
          }

          const fertilityBadge = document.getElementById('insp-house-fertility-badge');
          if (fertilityBadge) {
            const reqCap = (house.maxPantryWater * 0.5).toFixed(0);
            if (isWarehouse) {
              fertilityBadge.textContent = '🔒 未激活 (0级仓库不支持生育，需升级为1级茅草房)';
              fertilityBadge.style.color = '#ef4444';
            } else if (house.pantryWood < house.maxPantryWood * 0.5) {
              fertilityBadge.textContent = `⚠️ 失去支持 (木材不足50%无法保障冬季取暖: 🌲${house.pantryWood.toFixed(1)}/${reqCap})`;
              fertilityBadge.style.color = '#ef4444';
            } else if (house.pantryWater < house.maxPantryWater * 0.5 || house.pantryFood < house.maxPantryFood * 0.5) {
              fertilityBadge.textContent = `⚠️ 失去支持 (水粮不足50%: 💧${house.pantryWater.toFixed(1)}/🍒${house.pantryFood.toFixed(1)}，需各≥${reqCap})`;
              fertilityBadge.style.color = '#f59e0b';
            } else {
              fertilityBadge.textContent = `🟢 充盈激活 (水粮木均≥50%即${reqCap}单位，保障过冬取暖与夫妻受孕)`;
              fertilityBadge.style.color = '#10b981';
            }
          }

          // 户主追踪按钮绑定
          const ownerAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(house.ownerId) : sim.agents.find(a => a.id === house.ownerId);
          const ownerAlive = ownerAgent && ownerAgent.isAlive;
          const ownerBtn = document.getElementById('insp-house-owner-btn');
          if (ownerBtn) {
            ownerBtn.textContent = `Agent #${house.ownerId} ${ownerAlive ? '🟢 健在 (点击追踪)' : '💀 已故'} (第${house.generation}代) 🔍`;
            ownerBtn.className = `lineage-chip ${ownerAlive ? '' : 'dead'}`;
            ownerBtn.setAttribute('data-agent-id', house.ownerId);
          }

          // 所属聚落辖区绑定
          const campPoi = sim.pois.find(p => p.id === house.campId);
          const campTitle = campPoi ? campPoi.campTitle : `营地 #${house.campId || 1}`;
          const houseCampElem = document.getElementById('insp-house-camp-name');
          if (houseCampElem) {
            houseCampElem.textContent = `🏕️ ${campTitle}`;
          }

          const houseCoordEl = document.getElementById('insp-house-coord');
          if (houseCoordEl) houseCoordEl.textContent = `(X: ${Math.round(house.pos.x)}m, Y: ${Math.round(house.pos.y)}m)`;
          document.getElementById('insp-detail-text').textContent = house.isRuin ? '户主去世且未有族人继承，房屋正处于风化瓦解状态。' : (isWarehouse ? '0级仓库自带5水5粮5木，需搬运水粮各满10.0单位后，投入30s升级为1级茅草房并激活家庭生育。' : `属于族人 #${house.ownerId} 的私产空间。冬季自动消耗木材供暖(木材<10无法生育)；升级私宅需要木头，私宅往上升级需要石头(石头仅用于盖房升级)。`);
        }
      } else if (sim.selectionType === 'poi' && sim.selectedPoiId !== null) {
        const poi = sim.pois.find(p => p.id === sim.selectedPoiId);
        if (poi) {
          agentView.style.display = 'none';
          houseView.style.display = 'none';
          poiView.style.display = 'flex';
          if (followBtn) followBtn.style.display = 'none';

          const poiIcon = poi.type === 'Camp' ? ((poi.level || 0) >= 4 ? '🏛️' : ((poi.level || 0) >= 2 ? '🏘️' : '🏕️')) : (poi.type === 'Water' ? '💧' : (poi.type === 'Berry' ? '🍒' : (poi.type === 'Wood' ? '🌲' : (poi.type === 'Gold' ? '🪙' : '🪨'))));
          document.getElementById('insp-title-name').textContent = poi.type === 'Camp' ? `${poiIcon} ${poi.campTitle || poi.name}` : `${poiIcon} ${poi.name}`;
          
          let stateBadge = '资源充足';
          let badgeColor = '#10b981';
          if (poi.type === 'Camp') {
            const lvlNames = ['原始营地 (1阶)', '村落 (2阶)', '乡集 (3阶)', '集镇 (4阶)', '县邑 (5阶)'];
            stateBadge = `${lvlNames[poi.level || 0]} · 辖 ${poi.boundHouses || 0} 房`;
            badgeColor = '#f59e0b';
          } else if (!isFinite(poi.currentStock) || poi.maxStock <= 0) {
            stateBadge = '无限供应';
            badgeColor = '#f59e0b';
          } else if (poi.currentStock < 4.0) {
            stateBadge = '资源枯竭中';
            badgeColor = '#ef4444';
          } else if (poi.currentStock < poi.maxStock * 0.4) {
            stateBadge = '储量偏低';
            badgeColor = '#f59e0b';
          }
          document.getElementById('insp-title-state').textContent = stateBadge;
          document.getElementById('insp-title-state').style.color = badgeColor;

          const stockRow = document.getElementById('insp-poi-stock-row');
          const campUpgradeRow = document.getElementById('insp-camp-upgrade-row');
          if (poi.type === 'Camp') {
            stockRow.style.display = 'none';
            if (campUpgradeRow) {
              campUpgradeRow.style.display = 'flex';
              const nextTarget = (poi.level || 0) === 0 ? 6 : ((poi.level || 0) === 1 ? 12 : ((poi.level || 0) === 2 ? 18 : 24));
              const prevTarget = (poi.level || 0) === 0 ? 0 : ((poi.level || 0) === 1 ? 6 : ((poi.level || 0) === 2 ? 12 : 18));
              const count = poi.boundHouses || 0;
              const nextTitle = (poi.level || 0) === 0 ? '村落 (6房)' : ((poi.level || 0) === 1 ? '乡集 (12房)' : ((poi.level || 0) === 2 ? '集镇 (18房)' : '县邑 (24房)'));
              
              if ((poi.level || 0) >= 4) {
                document.getElementById('lbl-camp-upgrade-title').textContent = `🏛️ 县级行政区 (已达最高级)`;
                document.getElementById('insp-camp-upgrade-val').textContent = `${count} 间私宅`;
                document.getElementById('insp-camp-upgrade-fill').style.width = '100%';
              } else {
                const ratio = Math.min(100, Math.round(((count - prevTarget) / (nextTarget - prevTarget)) * 100));
                document.getElementById('lbl-camp-upgrade-title').textContent = `🏛️ 晋升 ${nextTitle}`;
                document.getElementById('insp-camp-upgrade-val').textContent = `${count} / ${nextTarget} 间房`;
                document.getElementById('insp-camp-upgrade-fill').style.width = `${Math.max(0, ratio)}%`;
              }
            }
          } else {
            if (campUpgradeRow) campUpgradeRow.style.display = 'none';
            stockRow.style.display = 'flex';
            const ratio = Math.round((poi.currentStock / poi.maxStock) * 100);
            if (poi.type === 'Water') {
              document.getElementById('lbl-poi-stock-title').textContent = '清泉蓄水量 (上限60.0)';
              document.getElementById('insp-poi-stock-fill').style.background = '#38bdf8';
            } else if (poi.type === 'Berry') {
              document.getElementById('lbl-poi-stock-title').textContent = '成熟浆果 (上限60.0)';
              document.getElementById('insp-poi-stock-fill').style.background = '#10b981';
            } else if (poi.type === 'Wood') {
              document.getElementById('lbl-poi-stock-title').textContent = '林木木材 (上限60.0)';
              document.getElementById('insp-poi-stock-fill').style.background = '#b45309';
            } else if (poi.type === 'Stone') {
              document.getElementById('lbl-poi-stock-title').textContent = '石矿石料 (上限60.0)';
              document.getElementById('insp-poi-stock-fill').style.background = '#94a3b8';
            } else if (poi.type === 'Gold') {
              document.getElementById('lbl-poi-stock-title').textContent = '璀璨金矿 (上限60.0)';
              document.getElementById('insp-poi-stock-fill').style.background = '#fbbf24';
            }
            document.getElementById('insp-poi-stock-val').textContent = `${poi.currentStock.toFixed(1)} / ${poi.maxStock.toFixed(1)} 单位`;
            document.getElementById('insp-poi-stock-fill').style.width = `${ratio}%`;
          }

          document.getElementById('insp-poi-regen').textContent = poi.regenRate > 0 ? `+${poi.regenRate.toFixed(2)} 单位/秒` : `无限储量 (公共避风聚落)`;
          const elevEl = document.getElementById('insp-poi-elev');
          if (elevEl) elevEl.textContent = poi.pos.z < -10 ? '低洼谷地 (汇水充盈)' : (poi.pos.z > 10 ? '峻峭高台 (视野开阔)' : '平缓原野 (适宜定居)');
          const poiCoordEl = document.getElementById('insp-poi-coord');
          if (poiCoordEl) poiCoordEl.textContent = poi.type === 'Camp' ? '聚落中心' : (poi.campTitle ? `${poi.campTitle} 领地` : '荒原公域');
          
          let desc = `【${poi.campTitle || poi.name}】公共避风聚落(储量无限)，族人在此休养回体与繁衍。辖内已自发落成 ${poi.boundHouses || 0} 间私宅，随房屋增加逐步升级为【营地 → 村 → 乡 → 镇 → 县】！`;
          if (poi.type === 'Water') desc = '低洼处天然地泉(上限60单位,产速2.0/s)，小人饮水并补给家宅。';
          else if (poi.type === 'Berry') desc = '向阳缓坡野生灌木(上限60单位,产速2.0/s)，小人采食并补给家宅。';
          else if (poi.type === 'Wood') desc = '茂密原生林地(上限60单位,产速2.0/s)，伐木用于冬季房屋供暖与升级茅草房。';
          else if (poi.type === 'Stone') desc = '嶙峋高地石矿(上限60单位,产速1.5/s)，采石仅用于私宅升级木石庄舍与大庄园。';
          else if (poi.type === 'Gold') desc = '璀璨金矿(上限60单位,产速1.2/s)，开采黄金装入随身行囊(黄金无限容量，单趟运满20回宅入库)，存入私宅金库用于晋升最高级氏族大庄园。';
          document.getElementById('insp-detail-text').textContent = desc;
        }
      } else {
        agentView.style.display = 'block';
        poiView.style.display = 'none';
        houseView.style.display = 'none';
        if (followBtn) followBtn.style.display = 'block';

        let selAgent = null;
        if (sim.selectedAgentId !== null) {
          selAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(sim.selectedAgentId) : sim.agents.find(a => a.id === sim.selectedAgentId);
        }
        if (!selAgent) {
          selAgent = (sim.agents && sim.agents.length > 0)
            ? (sim.agents.find(a => a.isAlive) || sim.agents[0])
            : null;
        }
        if (selAgent) {
          sim.selectedAgentId = selAgent.id;
          const isAdult = selAgent.age >= 1800.0;
          const isFemale = selAgent.gender === 'female';
          const genderBadge = isFemale ? '♀' : '♂';
          const roleIcon = !selAgent.isAlive ? '💀' : (selAgent.isPregnant ? '🤰' : (isAdult ? (isFemale ? '👩' : '👨') : '🍼'));
          
          let homeTag = `🏕️ 露天营地`;
          if (selAgent.homeHouseId !== null) {
            const myHouse = sim.houses.find(h => h.id === selAgent.homeHouseId);
            if (myHouse) {
              if (myHouse.ownerId === selAgent.id) homeTag = `🏡 #${selAgent.homeHouseId}家·户主`;
              else if (myHouse.spouseId === selAgent.id) homeTag = `🏡 #${selAgent.homeHouseId}家·配偶`;
              else homeTag = `🏡 #${selAgent.homeHouseId}家·子女`;
            }
          }
          const surnameBadge = selAgent.surname ? `【${selAgent.surname}】` : '';
          document.getElementById('insp-title-name').textContent = `${surnameBadge}部落民 #${selAgent.id} ${genderBadge} ${roleIcon}`;
          
          const homeBadgeEl = document.getElementById('insp-home-badge');
          if (homeBadgeEl) homeBadgeEl.textContent = homeTag;
          
          let stateText = selAgent.homeHouseId ? '🏡 私宅安居' : '🏕️ 营地驻留';
          let detailText = selAgent.homeHouseId ? '在专属家宅中安居，夫妻与子女共享水粮木石储备，冬季房屋自动供暖，满足饱暖与木材>=10可激活孕育。' : '在露天营地休息，无私宅不可受孕。';

          if (!selAgent.isAlive) {
            const isDecaying = typeof selAgent.deathDecayTimer === 'number' && selAgent.deathDecayTimer > 0;
            stateText = isDecaying ? '💀 刚离世' : '💀 已故先祖';
            detailText = isDecaying
              ? `死因: ${selAgent.deathCause || '未知饥荒'} (遗骸将在 ${Math.ceil(selAgent.deathDecayTimer)}s 后消逝)`
              : `死因: ${selAgent.deathCause || '寿终正寝/未知'} (已入土长眠，载入族谱先祖志)`;
          } else if (selAgent.state === 'RestingAtCamp') {
            if (selAgent.stamina < 99.5) {
              const restRate = (8.0 * (selAgent.sleepEfficiency || 100) / 100).toFixed(1);
              stateText = (selAgent.homeHouseId ? '🏡 私宅休养' : '🏕️ 营地休养') + ' (+' + restRate + '%/s)';
              detailText = '正在家宅/营地静坐休养，体力恢复速率 = 8.0%/s × 睡眠效率/100 (' + restRate + '%/s)，睡眠效率越高休息越快，恢复至 100% 满值后方可开展后续工作。';
            } else {
              stateText = selAgent.homeHouseId ? '🏡 私宅安居' : '🏕️ 营地驻留';
              detailText = '体力充盈至 100% 且温饱无虞，安居静候下一个生活/营建需求。';
            }
          } else if (selAgent.state === 'ConstructingHouse') {
            const progPct = Math.round((selAgent.buildTimer / 30.0) * 100);
            stateText = `🔨 营建中 (${progPct}%)`;
            detailText = '投入体力与工时营建或升级私宅(30s工期)，完成后将扩容储备空间并激活/保障繁衍孕育。';
          } else if (selAgent.state === 'RepairingHouse') {
            stateText = '🔧 房屋修缮中';
            detailText = '投入体力劳作修缮专属私宅，恢复房屋耐久度至 100% 避免风化坍塌。';
          } else if (selAgent.state === 'SeekingWater') {
            const isStocking = selAgent.currentNeed && (selAgent.currentNeed.includes('StockWater') || selAgent.currentNeed.includes('Safety') || selAgent.currentNeed.includes('Belonging'));
            stateText = isStocking ? '💧 前往运水' : '💧 前往饮水';
            detailText = isStocking ? '前往水源采集清泉运回私宅仓库（安全需求，家庭生存储备）。' : '自身口渴难耐，前往水源直接饮水解渴。';
          } else if (selAgent.state === 'DrinkingAtWater') {
            const isStocking = selAgent.currentNeed && (selAgent.currentNeed.includes('StockWater') || selAgent.currentNeed.includes('Safety') || selAgent.currentNeed.includes('Belonging'));
            stateText = isStocking ? '💧 采水存仓中' : '💧 清泉痛饮中';
            detailText = isStocking ? '在水泉处持续汲水填满私宅水库，保障家庭基础生存。' : '在清泉处直接痛饮补充水分至 50.0 单位上限。';
          } else if (selAgent.state === 'SeekingFood') {
            const isStocking = selAgent.currentNeed && (selAgent.currentNeed.includes('StockFood') || selAgent.currentNeed.includes('Safety') || selAgent.currentNeed.includes('Belonging'));
            stateText = isStocking ? '🍒 前往采粮' : '🍒 前往觅食';
            detailText = isStocking ? '前往浆果丛采集野果运回私宅粮仓（安全需求，家庭生存储备）。' : '自身饥肠辘辘，前往浆果丛直接进食充饥。';
          } else if (selAgent.state === 'ForagingFood') {
            const isStocking = selAgent.currentNeed && (selAgent.currentNeed.includes('StockFood') || selAgent.currentNeed.includes('Safety') || selAgent.currentNeed.includes('Belonging'));
            stateText = isStocking ? '🍒 采摘存仓中' : '🍒 进食充饥中';
            detailText = isStocking ? '在灌木丛持续采摘浆果填满私宅粮仓，保障家庭基础生存。' : '在灌木丛处直接采食充饥至 50.0 单位上限。';
          } else if (selAgent.state === 'SeekingWood') {
            stateText = '🌲 前往伐木';
            detailText = '前往森林伐木获取木材，搬运回私宅用于冬季供暖与升级。';
          } else if (selAgent.state === 'GatheringWood') {
            stateText = '🌲 森林采伐中';
            detailText = '正在林区砍伐木材并持续运往私宅木料仓。';
          } else if (selAgent.state === 'SeekingStone') {
            stateText = '🪨 前往采石';
            detailText = '前往嶙峋石矿开采石料，用于私宅升级木石庄舍与大庄园。';
          } else if (selAgent.state === 'MiningStone') {
            stateText = '🪨 石矿开采中';
            detailText = '正在采石场开采石料并运回私宅石料仓(石头仅用于盖房)。';
          } else if (selAgent.state === 'SeekingGold') {
            stateText = '🪙 前往淘金';
            detailText = '前往璀璨金矿开采黄金并随身装载(黄金无限容量)，单趟运满20后回宅存入私宅金库用于升级与财富贮藏。';
          } else if (selAgent.state === 'MiningGold') {
            stateText = '🪙 淘金采矿中';
            detailText = '正在金矿开采黄金装入随身行囊(黄金无限容量)，单趟运满20后送回私宅金库储存。';
          } else if (selAgent.state === 'ReturningToCamp') {
            if (selAgent.stamina >= 50.0) {
              stateText = selAgent.homeHouseId ? '🏡 携货返家' : '🏕️ 携货返营';
              detailText = '已完成现场采收或搬运，正常折返回家将物资存入仓库（安全需求，体力充沛）。';
            } else {
              stateText = '🚶 疲惫返巢';
              detailText = '体力耗竭跌破50%，正在沿路返回专属私宅/营地；到达归宿后就地休养至100%满值。';
            }
          }

          document.getElementById('insp-title-state').textContent = stateText;
          document.getElementById('insp-title-state').style.color = !selAgent.isAlive ? '#ef4444' : '#f59e0b';
          
          // 年龄与性别生育状态展示
          const ageValElem = document.getElementById('insp-age-val');
          if (ageValElem) {
            if (isAdult) {
              ageValElem.textContent = `${Math.floor(selAgent.age)}s · ${isFemale ? '已成年♀' : '已成年♂'}`;
              ageValElem.style.color = isFemale ? '#ec4899' : '#38bdf8';
            } else {
              const needGrow = Math.ceil(1800.0 - selAgent.age);
              ageValElem.textContent = `${Math.floor(selAgent.age)}s · 🍼幼年(需${needGrow}s)`;
              ageValElem.style.color = '#a78bfa';
            }
          }

          // 马斯洛当前主导需求与决策逻辑卡片更新
          const maslowBox = document.getElementById('insp-maslow-box');
          const maslowBadge = document.getElementById('insp-maslow-badge');
          const maslowReason = document.getElementById('insp-maslow-reason');
          if (maslowBox && maslowBadge && maslowReason) {
            if (!selAgent.isAlive) {
              maslowBox.style.display = 'none';
            } else {
              const need = parseMaslowNeed(selAgent.currentNeed, selAgent);
              if (need) {
                maslowBox.style.display = 'block';
                maslowBox.style.borderColor = need.color + '66';
                maslowBadge.textContent = `${need.icon} ${need.numeral} ${need.name} · ${need.kindLabel}`;
                maslowBadge.style.color = need.color;
                maslowBadge.style.borderColor = need.color;
                maslowBadge.style.background = need.color + '1a';
                maslowReason.textContent = need.reason;
              } else if (selAgent.state === 'RestingAtCamp') {
                maslowBox.style.display = 'block';
                maslowBox.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                maslowBadge.textContent = selAgent.homeHouseId ? '🏡 闲适安居 · 需求充盈' : '🏕️ 营地休养 · 暂无急需';
                maslowBadge.style.color = '#10b981';
                maslowBadge.style.borderColor = '#10b981';
                maslowBadge.style.background = 'rgba(16, 185, 129, 0.12)';
                maslowReason.textContent = `体力充沛(${Math.round(selAgent.stamina)}%)且温饱与家宅需求均满足，安居休养中。`;
              } else {
                maslowBox.style.display = 'none';
              }
            }
          }

          // 2x2 生存健康指标
          const maxHealth = selAgent.maxHealth || selAgent.lifeExpectancy || 100.0;
          const curHealth = selAgent.health !== undefined ? selAgent.health : maxHealth;
          const healthPct = Math.max(0, Math.min(100, Math.round((curHealth / maxHealth) * 100)));
          const healthValEl = document.getElementById('insp-health-val');
          if (healthValEl) healthValEl.textContent = `${curHealth.toFixed(1)}/${maxHealth.toFixed(0)}`;
          const healthFillEl = document.getElementById('insp-health-fill');
          if (healthFillEl) healthFillEl.style.width = `${healthPct}%`;

          const stamValEl = document.getElementById('insp-stamina-val');
          if (stamValEl) stamValEl.textContent = `${Math.round(selAgent.stamina)}%`;
          const stamFillEl = document.getElementById('insp-stamina-fill');
          if (stamFillEl) stamFillEl.style.width = `${selAgent.stamina}%`;

          const hungerValEl = document.getElementById('insp-hunger-val');
          if (hungerValEl) hungerValEl.textContent = `${selAgent.hunger.toFixed(1)}/50`;
          const hungerFillEl = document.getElementById('insp-hunger-fill');
          if (hungerFillEl) hungerFillEl.style.width = `${Math.round((selAgent.hunger / 50.0) * 100)}%`;

          const thirstValEl = document.getElementById('insp-thirst-val');
          if (thirstValEl) thirstValEl.textContent = `${selAgent.thirst.toFixed(1)}/50`;
          const thirstFillEl = document.getElementById('insp-thirst-fill');
          if (thirstFillEl) thirstFillEl.style.width = `${Math.round((selAgent.thirst / 50.0) * 100)}%`;

          // 🎒 随身行囊 (紧凑胶囊网格)
          const CARRY_TOTAL_CAP = 200.0;
          const cWater = selAgent.carriedWater || 0.0;
          const cFood = selAgent.carriedFood || 0.0;
          const cWood = selAgent.carriedWood || 0.0;
          const cStone = selAgent.carriedStone || 0.0;
          const cGold = selAgent.carriedGold || 0.0;
          const carryUsed = Math.min(CARRY_TOTAL_CAP, cWater + cFood + cWood + cStone);
          const totalCargo = carryUsed + cGold;
          const carryPct = Math.round((carryUsed / CARRY_TOTAL_CAP) * 100);

          const carryCapEl = document.getElementById('insp-carry-cap');
          if (carryCapEl) carryCapEl.textContent = `${carryUsed.toFixed(1)} / ${CARRY_TOTAL_CAP.toFixed(0)}`;
          const carryFillEl = document.getElementById('insp-carry-fill');
          if (carryFillEl) carryFillEl.style.width = `${carryPct}%`;

          const updateChip = (chipId, numId, val) => {
            const chip = document.getElementById(chipId);
            const num = document.getElementById(numId);
            if (num) num.textContent = val > 0.01 ? val.toFixed(1) : '0';
            if (chip) {
              if (val > 0.01) chip.classList.add('active');
              else chip.classList.remove('active');
            }
          };
          updateChip('chip-water', 'insp-carry-water', cWater);
          updateChip('chip-food', 'insp-carry-food', cFood);
          updateChip('chip-wood', 'insp-carry-wood', cWood);
          updateChip('chip-stone', 'insp-carry-stone', cStone);
          updateChip('chip-gold', 'insp-carry-gold', cGold);

          const carryHintEl = document.getElementById('insp-carry-hint');
          if (carryHintEl) {
            if (!selAgent.isAlive) {
              carryHintEl.textContent = '💀 遗骸物资将随遗体风化消散。';
            } else if (totalCargo <= 0.01) {
              carryHintEl.textContent = '行囊空空 (物资将在现场采收后装入)';
            } else if (carryUsed >= CARRY_TOTAL_CAP - 0.01) {
              carryHintEl.textContent = '🎒 行囊已满载，正在返家卸货入库。';
            } else {
              carryHintEl.textContent = '🏠 随身携货，返回家宅后卸货存入私宅仓库。';
            }
          }

          // 🚚 搬运去向
          const haulBox = document.getElementById('insp-carry-haul');
          const haulTextEl = document.getElementById('insp-carry-haul-text');
          if (haulBox && haulTextEl) {
            let haulText = '';
            let haulColor = '#e2e8f0';
            const myHouse = selAgent.homeHouseId !== null ? sim.houses.find(h => h.id === selAgent.homeHouseId) : null;
            const houseTag = myHouse ? `私宅 #${myHouse.id}` : '营地';
            if (selAgent.isAlive) {
              if (selAgent.state === 'SeekingWater' || selAgent.state === 'DrinkingAtWater') {
                if (myHouse && cWater < 49.95) {
                  haulText = `💧 汲水入囊 → ${houseTag}`;
                  haulColor = '#38bdf8';
                }
              } else if (selAgent.state === 'SeekingFood' || selAgent.state === 'ForagingFood') {
                if (myHouse && cFood < 49.95) {
                  haulText = `🍒 采食入囊 → ${houseTag}`;
                  haulColor = '#10b981';
                }
              } else if (selAgent.state === 'SeekingWood' || selAgent.state === 'GatheringWood') {
                if (myHouse && cWood < 49.95) {
                  haulText = `🌲 伐木入囊 → ${houseTag}`;
                  haulColor = '#d97706';
                }
              } else if (selAgent.state === 'SeekingStone' || selAgent.state === 'MiningStone') {
                if (myHouse && cStone < 49.95) {
                  haulText = `🪨 采石入囊 → ${houseTag}`;
                  haulColor = '#94a3b8';
                }
              } else if (selAgent.state === 'SeekingGold' || selAgent.state === 'MiningGold') {
                haulText = `🪙 淘金入囊 → ${houseTag}`;
                haulColor = '#fbbf24';
              } else if (selAgent.state === 'ReturningToCamp') {
                const packList = [];
                if (cWater > 0.01) packList.push(`💧${cWater.toFixed(1)}`);
                if (cFood > 0.01) packList.push(`🍒${cFood.toFixed(1)}`);
                if (cWood > 0.01) packList.push(`🌲${cWood.toFixed(1)}`);
                if (cStone > 0.01) packList.push(`🪨${cStone.toFixed(1)}`);
                if (cGold > 0.01) packList.push(`🪙${cGold.toFixed(1)}`);
                if (packList.length > 0) {
                  haulText = `🏠 返程卸货 → ${houseTag} (${packList.join(' ')})`;
                  haulColor = '#94a3b8';
                } else if (myHouse) {
                  haulText = `🏠 返程中 → ${houseTag}`;
                  haulColor = '#94a3b8';
                }
              }
            }
            haulBox.style.display = haulText ? 'flex' : 'none';
            haulTextEl.textContent = haulText;
            haulTextEl.style.color = haulColor;
          }

          // 🏠 传送到私宅按钮状态切换
          const teleportBtn = document.getElementById('btn-teleport-house');
          if (teleportBtn) {
            if (selAgent.homeHouseId !== null && selAgent.homeHouseId !== undefined) {
              teleportBtn.style.display = 'inline-flex';
              teleportBtn.textContent = `🏠 私宅 #${selAgent.homeHouseId}`;
              teleportBtn.title = `聚焦并传送到所属私宅 #${selAgent.homeHouseId}`;
            } else {
              teleportBtn.style.display = 'none';
            }
          }

          document.getElementById('insp-detail-text').textContent = detailText;

          // 家族血脉与世系族谱渲染 (兼容父亲、母亲、配偶与子嗣)
          const fatherElem = document.getElementById('insp-lineage-father');
          if (fatherElem) {
            if (selAgent.fatherId) {
              const fAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(selAgent.fatherId) : sim.agents.find(a => a.id === selAgent.fatherId);
              const fAlive = fAgent && fAgent.isAlive;
              const fGen = fAgent ? (fAgent.generation || 1) : 1;
              const fHtml = `<span class="lineage-chip ${fAlive ? '' : 'dead'}" data-agent-id="${selAgent.fatherId}" title="点击追踪父亲视角 (第${fGen}代)">👨 父亲 #${selAgent.fatherId} (第${fGen}代) ${fAlive ? '🟢' : '💀'}</span>`;
              if (fatherElem.innerHTML !== fHtml) fatherElem.innerHTML = fHtml;
            } else {
              const fHtml = `<span style="color:#64748b;">— (开局始祖代)</span>`;
              if (fatherElem.innerHTML !== fHtml) fatherElem.innerHTML = fHtml;
            }
          }

          const motherElem = document.getElementById('insp-lineage-mother');
          if (motherElem) {
            if (selAgent.motherId) {
              const mAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(selAgent.motherId) : sim.agents.find(a => a.id === selAgent.motherId);
              const mAlive = mAgent && mAgent.isAlive;
              const mGen = mAgent ? (mAgent.generation || 1) : 1;
              const mHtml = `<span class="lineage-chip female ${mAlive ? '' : 'dead'}" data-agent-id="${selAgent.motherId}" title="点击追踪母亲视角 (第${mGen}代)">👩 母亲 #${selAgent.motherId} (第${mGen}代) ${mAlive ? '🟢' : '💀'}</span>`;
              if (motherElem.innerHTML !== mHtml) motherElem.innerHTML = mHtml;
            } else {
              const mHtml = `<span style="color:#64748b;">— (开局始祖代)</span>`;
              if (motherElem.innerHTML !== mHtml) motherElem.innerHTML = mHtml;
            }
          }

          const spouseElem = document.getElementById('insp-lineage-spouse');
          if (spouseElem) {
            if (selAgent.spouseId) {
              const sAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(selAgent.spouseId) : sim.agents.find(a => a.id === selAgent.spouseId);
              const sAlive = sAgent && sAgent.isAlive;
              const isHusband = sAgent && sAgent.gender === 'male';
              const sGen = sAgent ? (sAgent.generation || 1) : 1;
              const sHtml = `<span class="lineage-chip ${isHusband ? '' : 'female'} ${sAlive ? '' : 'dead'}" data-agent-id="${selAgent.spouseId}" title="点击追踪配偶视角 (第${sGen}代)">💍 ${isHusband ? '丈夫' : '妻子'} #${selAgent.spouseId} (第${sGen}代) ${sAlive ? '🟢' : '💀'}</span>`;
              if (spouseElem.innerHTML !== sHtml) spouseElem.innerHTML = sHtml;
            } else {
              const sHtml = `<span style="color:#64748b;">未婚单身</span>`;
              if (spouseElem.innerHTML !== sHtml) spouseElem.innerHTML = sHtml;
            }
          }

          const houseElem = document.getElementById('insp-lineage-house');
          if (houseElem) {
            if (selAgent.homeHouseId) {
              const myH = sim.houses.find(h => h.id === selAgent.homeHouseId);
              const tierName = myH ? ({
                'Tier0Warehouse': '0级仓库',
                'Tier1ThatchedHut': '1级茅草房',
                'Tier2LeanTo': '2级半棚屋',
                'Tier3Homestead': '3级木石庄舍',
                'Tier4Manor': '4级大庄园'
              }[myH.tier] || '私宅') : '私宅';
              const hHtml = `<span style="color:#38bdf8; font-weight:600;">🏠 #${selAgent.homeHouseId} (${tierName})</span>`;
              if (houseElem.innerHTML !== hHtml) houseElem.innerHTML = hHtml;
            } else {
              const hHtml = `<span style="color:#64748b;">居于营地 (无私宅)</span>`;
              if (houseElem.innerHTML !== hHtml) houseElem.innerHTML = hHtml;
            }
          }

          const childrenElem = document.getElementById('insp-lineage-children');
          const childrenCountElem = document.getElementById('insp-lineage-children-count');
          if (childrenElem) {
            if (selAgent.children && selAgent.children.length > 0) {
              let cHtml = '';
              for (const cId of selAgent.children) {
                const cAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(cId) : sim.agents.find(a => a.id === cId);
                const cAlive = cAgent && cAgent.isAlive;
                const isFem = cAgent && cAgent.gender === 'female';
                const cGen = cAgent ? (cAgent.generation || (selAgent.generation ? selAgent.generation + 1 : 2)) : (selAgent.generation ? selAgent.generation + 1 : 2);
                const cSurname = cAgent && cAgent.surname ? `【${cAgent.surname}】` : '';
                cHtml += `<span class="lineage-chip ${isFem ? 'female' : ''} ${cAlive ? '' : 'dead'}" data-agent-id="${cId}" title="点击追踪第${cGen}代子嗣 #${cId}">${isFem ? '👧' : '👦'} ${cSurname}#${cId} (第${cGen}代) ${cAlive ? '🟢' : '💀'}</span>`;
              }
              if (childrenElem.innerHTML !== cHtml) childrenElem.innerHTML = cHtml;
              if (childrenCountElem) childrenCountElem.textContent = `共 ${selAgent.children.length} 位后代`;
            } else {
              const cHtml = `<span style="color:#64748b;">暂无子女</span>`;
              if (childrenElem.innerHTML !== cHtml) childrenElem.innerHTML = cHtml;
              if (childrenCountElem) childrenCountElem.textContent = `0 位后代`;
            }
          }

          // 🌟 声望值展示（= 子女数量）
          const prestigeElem = document.getElementById('insp-prestige-val');
          if (prestigeElem) {
            const prestige = selAgent.prestige || 0;
            prestigeElem.textContent = prestige > 0
              ? `🌟 声望 ${prestige} · 育有 ${prestige} 位子嗣`
              : '暂无声望 (尚未育有子女)';
            prestigeElem.style.color = prestige >= 5 ? '#fbbf24' : (prestige > 0 ? '#a78bfa' : '#64748b');
          }

          // 弹窗头部与自身卡片更新
          const modalTitle = document.getElementById('lineage-modal-title');
          if (modalTitle) {
            const genText = selAgent.generation === 1 ? '始祖第1代' : `第${selAgent.generation || 2}代`;
            const clanPrefix = selAgent.surname ? `${selAgent.surname}氏 · ` : '';
            modalTitle.textContent = `${clanPrefix}部落民 #${selAgent.id} (${genText} · ${selAgent.gender === 'female' ? '♀' : '♂'}) 详细档案与族谱`;
          }
          const selfName = document.getElementById('lineage-self-name');
          if (selfName) {
            const genText = selAgent.generation === 1 ? '始祖第1代' : `第${selAgent.generation || 2}代`;
            const clanLabel = selAgent.surname ? `【${selAgent.surname}】氏 ` : '';
            selfName.textContent = `${clanLabel}部落民 #${selAgent.id} (${genText} · ${selAgent.gender === 'female' ? '女性 ♀' : '男性 ♂'})`;
          }
          const selfAvatar = document.getElementById('lineage-self-avatar');
          if (selfAvatar) {
            selfAvatar.textContent = !selAgent.isAlive ? '💀' : (selAgent.gender === 'female' ? (selAgent.isPregnant ? '🤰' : '👩') : '👦');
          }
          const selfGen = document.getElementById('lineage-self-gen');
          if (selfGen) {
            const genNum = selAgent.generation && selAgent.generation >= 1 ? selAgent.generation : ((selAgent.fatherId || selAgent.motherId) ? 2 : 1);
            selfGen.textContent = genNum === 1 ? '始祖第1代' : `第${genNum}代`;
          }
          const selfStatus = document.getElementById('lineage-self-status');
          if (selfStatus) {
            const hVal = selAgent.health !== undefined ? selAgent.health.toFixed(1) : '—';
            selfStatus.textContent = `年龄 ${Math.floor(selAgent.age)}s · 健康 ${hVal} · 饱食 ${Math.round(selAgent.hunger)} · 体力 ${Math.round(selAgent.stamina)}%`;
          }
          const selfNeedBadge = document.getElementById('lineage-self-need-badge');
          if (selfNeedBadge) {
            if (!selAgent.isAlive) {
              const cause = selAgent.deathCause || '寿终正寝';
              selfNeedBadge.textContent = `💀 已故 · ${cause}`;
              selfNeedBadge.style.color = '#94a3b8';
              selfNeedBadge.style.borderColor = 'rgba(148, 163, 184, 0.35)';
              selfNeedBadge.style.background = 'rgba(148, 163, 184, 0.12)';
            } else {
              const parsed = parseMaslowNeed(selAgent.currentNeed, selAgent);
              if (parsed) {
                selfNeedBadge.textContent = parsed.badgeText || `${parsed.icon} ${parsed.name} · ${parsed.kindLabel}`;
                selfNeedBadge.style.color = parsed.color;
                selfNeedBadge.style.borderColor = `${parsed.color}55`;
                selfNeedBadge.style.background = `${parsed.color}1f`;
              } else {
                const restText = selAgent.state === 'RestingAtCamp'
                  ? (selAgent.homeHouseId ? '🏡 闲适安居' : '🏕️ 营地休养')
                  : '🟢 活跃中';
                selfNeedBadge.textContent = restText;
                selfNeedBadge.style.color = '#10b981';
                selfNeedBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                selfNeedBadge.style.background = 'rgba(16, 185, 129, 0.12)';
              }
            }
          }

          // 🧬 先天禀赋属性 (族谱页 · 遗传记录仅展示): 始祖 N(100,20) 正态 / 后代父母均值±10
          const traitsElem = document.getElementById('lineage-self-traits');
          if (traitsElem && typeof selAgent.intelligence === 'number') {
            const traitDefs = [
              { label: '🧠 智力', key: 'intelligence', color: '#38bdf8' },
              { label: '💪 力量', key: 'strength', color: '#ef4444' },
              { label: '❤️‍🔥 魅力', key: 'libido', color: '#ec4899' },
              { label: '🍽️ 消化效率', key: 'digestionEfficiency', color: '#f59e0b' },
              { label: '😴 睡眠效率', key: 'sleepEfficiency', color: '#a78bfa' },
              { label: '⏳ 预期寿命', key: 'lifeExpectancy', color: '#10b981' },
            ];
            let tHtml = '';
            for (const t of traitDefs) {
              const v = selAgent[t.key];
              const pct = Math.max(0, Math.min(100, (v / 200) * 100)); // 10~190 映射 5%~95% 刻度
              tHtml += `<div class="lineage-trait" title="${t.label} (遗传记录；消化效率/睡眠效率已参与行为结算)">
                <div class="meter-label"><span>${t.label}</span><span style="color:${t.color}; font-weight:700;">${Math.round(v)}</span></div>
                <div class="meter-bg"><div class="meter-fill" style="background:${t.color}; width:${pct}%;"></div></div>
              </div>`;
            }
            if (traitsElem.innerHTML !== tHtml) traitsElem.innerHTML = tHtml;
          }
          const traitsSource = document.getElementById('lineage-traits-source');
          if (traitsSource) {
            const hasParents = selAgent.fatherId || selAgent.motherId;
            traitsSource.textContent = hasParents ? '父母均值 ±10 遗传' : '始祖 N(100,20) 正态';
          }

          const cdBox = document.getElementById('insp-cooldown-box');
          if (selAgent.miscarriageCooldown > 0 && selAgent.isAlive && !selAgent.isPregnant) {
            cdBox.style.display = 'flex';
            document.getElementById('insp-cooldown-val').textContent = `调养剩余 ${Math.ceil(selAgent.miscarriageCooldown)}s 可受孕`;
          } else {
            cdBox.style.display = 'none';
          }

          const pregBox = document.getElementById('insp-preg-box');
          if (selAgent.isPregnant && selAgent.isAlive) {
            pregBox.style.display = 'flex';
            const pVal = Math.round(selAgent.pregnancyProgress * 100);
            document.getElementById('insp-preg-val').textContent = `${pVal}% (${Math.round(selAgent.pregnancyProgress * 900)}s / 900s)`;
            document.getElementById('insp-preg-fill').style.width = `${pVal}%`;
          } else {
            pregBox.style.display = 'none';
          }
        }
      }

      // 🐞 采样本帧「渲染 + UI」耗时与整帧耗时 (调试模式下)
      if (sim.debugMode) {
        const frameEnd = performance.now();
        dbgRenderMs += ((frameEnd - tickEnd) - dbgRenderMs) * 0.15;
        dbgFrameMs += ((frameEnd - frameStart) - dbgFrameMs) * 0.15;
      }
    }
    requestAnimationFrame(render);

    // 智能点击拾取 (排除拖拽平移) —— 多个元素 (agent/house/poi) 重叠时，连续点击同一位置循环切换到其他元素
    let clickCycle = null; // { x, y } 上一次循环切换的点击位置
    canvas.addEventListener('click', e => {
      if (totalDragDist > 8) return;
      const clickX = e.clientX, clickY = e.clientY;

      // 收集光标下所有可选中元素，按渲染层级自上而下排序: agent (就近优先) -> house -> poi
      const targets = [];
      const agentHits = [];
      // 隐藏部落民时，族人不再参与点击拾取 (避免"看不见却点得中")
      for (const agent of (sim.showAgents ? sim.agents : [])) {
        const p2D = project3D(agent.pos);
        const d = Math.hypot(clickX - p2D.x, clickY - p2D.y);
        if (d <= 25) agentHits.push({ type: 'agent', id: agent.id, dist: d });
      }
      agentHits.sort((a, b) => a.dist - b.dist);
      for (const t of agentHits) targets.push(t);

      for (const h of sim.houses) {
        const p2D = project3D(h.pos);
        const d = Math.hypot(clickX - p2D.x, clickY - p2D.y);
        if (d <= 24) targets.push({ type: 'house', id: h.id, dist: d });
      }

      for (const poi of sim.pois) {
        const p2D = project3D(poi.pos);
        const d = Math.hypot(clickX - p2D.x, clickY - p2D.y);
        if (d <= 26) targets.push({ type: 'poi', id: poi.id, dist: d });
      }

      if (targets.length === 0) {
        clickCycle = null; // 点击空白处: 保持当前选中不变
        return;
      }

      // 当前选中项在目标列表中的位置
      let curType = sim.selectionType, curId = null;
      if (curType === 'agent') curId = sim.selectedAgentId;
      else if (curType === 'house') curId = sim.selectedHouseId;
      else if (curType === 'poi') curId = sim.selectedPoiId;

      let startIdx = 0;
      // 连续点击同一位置且当前选中仍在光标下时，切换到列表中的下一个元素 (循环)
      if (clickCycle && Math.hypot(clickX - clickCycle.x, clickY - clickCycle.y) <= 16) {
        const curIdx = targets.findIndex(t => t.type === curType && t.id === curId);
        if (curIdx >= 0) startIdx = (curIdx + 1) % targets.length;
      }

      const chosen = targets[startIdx];
      sim.selectionType = chosen.type;
      if (chosen.type === 'agent') sim.selectedAgentId = chosen.id;
      else if (chosen.type === 'house') sim.selectedHouseId = chosen.id;
      else sim.selectedPoiId = chosen.id;
      clickCycle = { x: clickX, y: clickY };
    });

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
