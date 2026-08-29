// === Canvas 渲染主循环与 Inspector 更新 ===
    // ==========================================
    // 30 FPS 渲染主循环
    // ==========================================
    let frameCount = 0, lastFpsUpdate = performance.now();
    let lastRenderTime = performance.now();
    const TARGET_FPS = 30;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;

    function render(now) {
      requestAnimationFrame(render);

      if (!now) now = performance.now();
      const elapsed = now - lastRenderTime;

      if (elapsed < FRAME_INTERVAL - 1.5) {
        return;
      }
      lastRenderTime = now - (elapsed % FRAME_INTERVAL);

      sim.tick();

      // 0. 镜头跟随选中小人
      if (isCameraFollow && sim.selectionType === 'agent') {
        const selAgent = sim.agents.find(a => a.id === sim.selectedAgentId && a.isAlive);
        if (selAgent) {
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

      // 1. 3D 地形网格渲染
      if (sim.showTerrain) {
        const gSize = sim.terrain.gridSize;
        const minZ = sim.terrain.minZ, maxZ = sim.terrain.maxZ;

        for (let gy = 0; gy < gSize - 1; gy++) {
          for (let gx = 0; gx < gSize - 1; gx++) {
            const c00 = sim.terrain.cells[gy * gSize + gx];
            const c10 = sim.terrain.cells[gy * gSize + (gx + 1)];
            const c11 = sim.terrain.cells[(gy + 1) * gSize + (gx + 1)];
            const c01 = sim.terrain.cells[(gy + 1) * gSize + gx];

            const p00 = project3D(new Vec3(c00.wx, c00.wy, c00.elev));
            const p10 = project3D(new Vec3(c10.wx, c10.wy, c10.elev));
            const p11 = project3D(new Vec3(c11.wx, c11.wy, c11.elev));
            const p01 = project3D(new Vec3(c01.wx, c01.wy, c01.elev));

            ctx.fillStyle = getElevationColor(c00, minZ, maxZ);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
            ctx.lineWidth = 0.4;

            ctx.beginPath();
            ctx.moveTo(p00.x, p00.y);
            ctx.lineTo(p10.x, p10.y);
            ctx.lineTo(p11.x, p11.y);
            ctx.lineTo(p01.x, p01.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      // 2. 原始生态 POI 渲染与有限储量指示环 (上限 40.0 单位)
      for (const poi of sim.pois) {
        const p2D = project3D(poi.pos);
        const isSelectedPoi = sim.selectionType === 'poi' && sim.selectedPoiId === poi.id;

        if (poi.type === 'Camp') {
          const grad = ctx.createRadialGradient(p2D.x, p2D.y, 2, p2D.x, p2D.y, 26 * camera.zoom);
          grad.addColorStop(0, 'rgba(245, 158, 11, 0.85)');
          grad.addColorStop(0.4, 'rgba(239, 68, 68, 0.45)');
          grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(p2D.x, p2D.y, 26 * camera.zoom, 0, Math.PI * 2); ctx.fill();

          ctx.font = `${Math.floor(15 * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('🏕️', p2D.x, p2D.y + 4);
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

          if (sim.showPoiStock && isFinite(poi.maxStock)) {
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

          if (sim.showPoiStock && isFinite(poi.maxStock)) {
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.arc(p2D.x, p2D.y, 15 * camera.zoom, -Math.PI/2, -Math.PI/2 + ratio * Math.PI * 2);
            ctx.stroke();
          }
        } else if (poi.type === 'Wood') {
          const ratio = isFinite(poi.maxStock) ? (poi.currentStock / poi.maxStock) : 1.0;
          const grad = ctx.createRadialGradient(p2D.x, p2D.y, 2, p2D.x, p2D.y, (11 + ratio * 13) * camera.zoom);
          grad.addColorStop(0, 'rgba(234, 179, 8, 0.85)');
          grad.addColorStop(0.6, 'rgba(202, 138, 4, 0.4)');
          grad.addColorStop(1, 'rgba(234, 179, 8, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(p2D.x, p2D.y, (11 + ratio * 13) * camera.zoom, 0, Math.PI * 2); ctx.fill();

          ctx.font = `${Math.floor(13 * camera.zoom)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('🌲', p2D.x, p2D.y + 4);

          if (sim.showPoiStock && isFinite(poi.maxStock)) {
            ctx.strokeStyle = '#eab308';
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

          if (sim.showPoiStock && isFinite(poi.maxStock)) {
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

          if (sim.showPoiStock && isFinite(poi.maxStock)) {
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.arc(p2D.x, p2D.y, 16 * camera.zoom, -Math.PI/2, -Math.PI/2 + ratio * Math.PI * 2);
            ctx.stroke();
          }
        }

        if (isSelectedPoi) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.2;
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(p2D.x, p2D.y, 22 * camera.zoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // 2.5 自建私产宅舍渲染 (0级仓库 📦 / 1级茅草房 🛖 / 2级私宅 🏡 / 3级庄舍 🏛️ / 4级庄园 🏰 / 无主废墟 🏚️)
      for (const house of sim.houses) {
        const p2D = project3D(house.pos);
        const isSelectedHouse = sim.selectionType === 'house' && sim.selectedHouseId === house.id;
        const isWarehouse = house.tier === 'Tier0Warehouse';
        let tierIcon = '📦';
        let tierLabel = '仓';
        if (house.tier === 'Tier1ThatchedHut') { tierIcon = '🛖'; tierLabel = '茅'; }
        else if (house.tier === 'Tier2LeanTo') { tierIcon = '🏡'; tierLabel = '宅'; }
        else if (house.tier === 'Tier3Homestead') { tierIcon = '🏛️'; tierLabel = '庄'; }
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
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.2;
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(p2D.x, p2D.y, 16 * camera.zoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
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
            ctx.save();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = lineWidth + 2.0 * camera.zoom;
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 10 * camera.zoom;
            ctx.beginPath();
            const segs = 16;
            for (let i = 0; i <= segs; i++) {
              const pt3D = lane.curve.evalPos(i / segs);
              const p2D = project3D(pt3D);
              if (i === 0) ctx.moveTo(p2D.x, p2D.y);
              else ctx.lineTo(p2D.x, p2D.y);
            }
            ctx.stroke();
            ctx.restore();
          }

          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = lineWidth;
          ctx.setLineDash(lineDash);

          // 高等级道路光晕外发光
          if (wear >= 4.0) {
            ctx.shadowColor = '#f59e0b';
            ctx.shadowBlur = 10 * camera.zoom;
          } else if (wear >= 3.0) {
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 7 * camera.zoom;
          } else if (wear >= 2.0) {
            ctx.shadowColor = '#f59e0b';
            ctx.shadowBlur = 5 * camera.zoom;
          }

          ctx.beginPath();
          const segs = 16;
          for (let i = 0; i <= segs; i++) {
            const pt3D = lane.curve.evalPos(i / segs);
            const p2D = project3D(pt3D);
            if (i === 0) ctx.moveTo(p2D.x, p2D.y);
            else ctx.lineTo(p2D.x, p2D.y);
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.setLineDash([]);
        }

        // 更新悬浮 Tooltip 提示
        const roadTooltip = document.getElementById('road-hover-tooltip');
        if (roadTooltip) {
          if (hoveredLane) {
            const wear = Math.min(5.0, hoveredLane.wear || 0.0);
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

            const speedFactor = (0.50 + 0.333 * wear);
            const speedBonusPct = Math.round((speedFactor - 1.0) * 100);
            const speedText = speedBonusPct >= 0 ? `+${speedBonusPct}%` : `${speedBonusPct}%`;
            const wearPct = Math.round((wear / 5.0) * 100);

            roadTooltip.innerHTML = `
              <div class="road-tooltip-title">
                <span style="color:${levelColor}; font-weight:700;">🛣️ ${levelName}</span>
                <span style="color:${levelColor}; font-size:10px; background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px;">${badgeText}</span>
              </div>
              <div style="display:flex; justify-content:space-between; margin-top:2px;">
                <span style="color:#94a3b8;">耐久度 / 踩踏值:</span>
                <span style="color:#f8fafc; font-weight:700; font-family:monospace;">${wear.toFixed(2)} / 5.00 (${wearPct}%)</span>
              </div>
              <div class="road-tooltip-bar-bg">
                <div class="road-tooltip-bar-fill" style="width:${wearPct}%; background:${barColor};"></div>
              </div>
              <div style="display:flex; justify-content:space-between; margin-top:3px;">
                <span style="color:#94a3b8;">移动速度加成:</span>
                <span style="color:#38bdf8; font-weight:700; font-family:monospace;">${speedFactor.toFixed(2)}x (${speedText})</span>
              </div>
              <div style="font-size:10px; color:#64748b; margin-top:3px; border-top:1px solid rgba(255,255,255,0.06); padding-top:4px;">
                👟 步行通行: <span style="color:#10b981;">+0.05/次</span> · 闲置自然衰减: <span style="color:#f87171;">-${(wear * (0.010 / 1.5)).toFixed(3)}/s (0.67%/s)</span>
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

      // 4. 部落民 Agent 渲染
      for (const agent of sim.agents) {
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

        // 幼年期标识 (未满 120s)
        const isAdult = agent.age >= 120.0;

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

        if (agent.isOffroad) {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
          ctx.lineWidth = 1.0;
          ctx.beginPath();
          ctx.arc(p2D.x, p2D.y, 6.0 * camera.zoom, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (agent.trail.length > 1) {
          ctx.strokeStyle = stateColor;
          ctx.lineWidth = 2.0 * camera.zoom;
          ctx.beginPath();
          for (let t = 0; t < agent.trail.length; t++) {
            const tp = project3D(agent.trail[t]);
            if (t === 0) ctx.moveTo(tp.x, tp.y);
            else ctx.lineTo(tp.x, tp.y);
          }
          ctx.stroke();
        }

        // 幼体稍小 (3.0px)，成体标准 (4.5px)
        const agentRadius = (isAdult ? 4.5 : 3.2) * camera.zoom;
        ctx.fillStyle = stateColor;
        ctx.shadowColor = stateColor;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p2D.x, p2D.y, agentRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (isSelectedAgent) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.8;
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(p2D.x, p2D.y, 9.5 * camera.zoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      // 5. 更新顶栏统计
      frameCount++;
      if (now - lastFpsUpdate >= 500) {
        document.getElementById('stat-fps').textContent = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
        frameCount = 0;
        lastFpsUpdate = now;
      }

      const aliveAgents = sim.agents.filter(a => a.isAlive);
      const pregnantAgents = aliveAgents.filter(a => a.isPregnant);

      document.getElementById('stat-pop').textContent = aliveAgents.length;
      document.getElementById('stat-houses').textContent = sim.houses.filter(h => !h.isRuin).length;
      document.getElementById('stat-pois').textContent = sim.pois.length;
      document.getElementById('stat-pregnant').textContent = pregnantAgents.length;
      document.getElementById('stat-births').textContent = sim.totalBirths;
      document.getElementById('stat-deaths').textContent = sim.totalDeaths;
      document.getElementById('stat-miscarriages').textContent = sim.totalMiscarriages;

      // 顶栏四季与气温展示
      const seasonIcons = { 'Spring': '🌸 春季', 'Summer': '☀️ 夏季', 'Autumn': '🍂 秋季', 'Winter': '❄️ 冬季' };
      document.getElementById('stat-season').textContent = seasonIcons[sim.currentSeason] || '🌸 春季';
      document.getElementById('stat-temp').textContent = `${sim.temperature.toFixed(1)}°C`;
      document.getElementById('stat-temp').style.color = sim.currentSeason === 'Winter' ? '#38bdf8' : (sim.currentSeason === 'Summer' ? '#f59e0b' : '#e2e8f0');

      // 6. 实时汇总全地图资源大盘 (水/果/木/石)
      let totalWaterCur = 0, totalWaterMax = 0;
      let totalBerryCur = 0, totalBerryMax = 0;
      let totalWoodCur = 0, totalWoodMax = 0;
      let totalStoneCur = 0, totalStoneMax = 0;

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
        }
      }

      const waterPct = Math.round((totalWaterCur / Math.max(1, totalWaterMax)) * 100);
      const berryPct = Math.round((totalBerryCur / Math.max(1, totalBerryMax)) * 100);
      const woodPct = Math.round((totalWoodCur / Math.max(1, totalWoodMax)) * 100);
      const stonePct = Math.round((totalStoneCur / Math.max(1, totalStoneMax)) * 100);

      document.getElementById('val-global-water').textContent = `${totalWaterCur.toFixed(1)} / ${totalWaterMax.toFixed(1)} 单位 (${waterPct}%)`;
      document.getElementById('fill-global-water').style.width = `${waterPct}%`;
      document.getElementById('fill-global-water').style.background = waterPct < 25 ? '#ef4444' : '#38bdf8';

      document.getElementById('val-global-berry').textContent = `${totalBerryCur.toFixed(1)} / ${totalBerryMax.toFixed(1)} 单位 (${berryPct}%)`;
      document.getElementById('fill-global-berry').style.width = `${berryPct}%`;
      document.getElementById('fill-global-berry').style.background = berryPct < 25 ? '#ef4444' : '#10b981';

      document.getElementById('val-global-wood').textContent = `${totalWoodCur.toFixed(1)} / ${totalWoodMax.toFixed(1)} 单位 (${woodPct}%)`;
      document.getElementById('fill-global-wood').style.width = `${woodPct}%`;
      document.getElementById('fill-global-wood').style.background = woodPct < 25 ? '#ef4444' : '#eab308';

      document.getElementById('val-global-stone').textContent = `${totalStoneCur.toFixed(1)} / ${totalStoneMax.toFixed(1)} 单位 (${stonePct}%)`;
      document.getElementById('fill-global-stone').style.width = `${stonePct}%`;
      document.getElementById('fill-global-stone').style.background = stonePct < 25 ? '#ef4444' : '#94a3b8';

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

      // 7. 刷新动态 Inspector 面板
      const agentView = document.getElementById('insp-agent-view');
      const poiView = document.getElementById('insp-poi-view');
      const houseView = document.getElementById('insp-house-view');
      const followBtn = document.getElementById('insp-agent-actions');

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
          else if (house.tier === 'Tier3Homestead') tierTitle = '🏛️ 3级 木石庄舍';
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

          // 建筑形态与升级要求
          const tierDescElem = document.getElementById('insp-house-tier-desc');
          if (tierDescElem) {
            let upgradeCondition = '';
            if (isWarehouse) upgradeCondition = '0级 仓库 (需搬运水粮各满10单位升级为1级茅草房)';
            else if (house.tier === 'Tier1ThatchedHut') upgradeCondition = `1级 茅草房 (仓储上限: ${house.maxPantryWater.toFixed(0)}单位，升级2级私宅需木材20单位)`;
            else if (house.tier === 'Tier2LeanTo') upgradeCondition = `2级 私宅 (仓储上限: ${house.maxPantryWater.toFixed(0)}单位，升级3级庄舍需石头40单位)`;
            else if (house.tier === 'Tier3Homestead') upgradeCondition = `3级 木石庄舍 (仓储上限: ${house.maxPantryWater.toFixed(0)}单位，升级4级庄园需石头80单位)`;
            else upgradeCondition = `4级 家族大庄园 (终极形态，仓储上限 150 单位)`;
            tierDescElem.textContent = upgradeCondition;
            tierDescElem.style.color = isWarehouse ? '#f59e0b' : '#10b981';
          }

          const fertilityBadge = document.getElementById('insp-house-fertility-badge');
          if (fertilityBadge) {
            if (isWarehouse) {
              fertilityBadge.textContent = '🔒 未激活 (0级仓库不支持生育，需升级为1级茅草房)';
              fertilityBadge.style.color = '#ef4444';
            } else if (house.pantryWood < 10.0) {
              fertilityBadge.textContent = `⚠️ 失去支持 (木材不足10单位无法保障冬季取暖: 🌲${house.pantryWood.toFixed(1)}/10.0)`;
              fertilityBadge.style.color = '#ef4444';
            } else if (house.pantryWater < 10.0 || house.pantryFood < 10.0) {
              fertilityBadge.textContent = `⚠️ 失去支持 (水或粮<10单位: 💧${house.pantryWater.toFixed(1)}/🍒${house.pantryFood.toFixed(1)})`;
              fertilityBadge.style.color = '#f59e0b';
            } else {
              fertilityBadge.textContent = '🟢 充盈激活 (水粮木均≥10单位，保障过冬取暖与夫妻受孕)';
              fertilityBadge.style.color = '#10b981';
            }
          }

          // 户主追踪按钮绑定
          const ownerAgent = sim.agents.find(a => a.id === house.ownerId);
          const ownerAlive = ownerAgent && ownerAgent.isAlive;
          const ownerBtn = document.getElementById('insp-house-owner-btn');
          if (ownerBtn) {
            ownerBtn.textContent = `Agent #${house.ownerId} ${ownerAlive ? '🟢 健在 (点击追踪)' : '💀 已故'} (第${house.generation}代) 🔍`;
            ownerBtn.className = `lineage-chip ${ownerAlive ? '' : 'dead'}`;
            ownerBtn.setAttribute('data-agent-id', house.ownerId);
          }

          document.getElementById('insp-house-coord').textContent = `(X: ${Math.round(house.pos.x)}m, Y: ${Math.round(house.pos.y)}m)`;
          document.getElementById('insp-detail-text').textContent = house.isRuin ? '户主去世且未有族人继承，房屋正处于风化瓦解状态。' : (isWarehouse ? '0级仓库自带5水5粮5木，需搬运水粮各满10.0单位后，投入30s升级为1级茅草房并激活家庭生育。' : `属于族人 #${house.ownerId} 的私产空间。冬季自动消耗木材供暖(木材<10无法生育)；升级私宅需要木头，私宅往上升级需要石头(石头仅用于盖房升级)。`);
        }
      } else if (sim.selectionType === 'poi' && sim.selectedPoiId !== null) {
        const poi = sim.pois.find(p => p.id === sim.selectedPoiId);
        if (poi) {
          agentView.style.display = 'none';
          houseView.style.display = 'none';
          poiView.style.display = 'flex';
          if (followBtn) followBtn.style.display = 'none';

          const poiIcon = poi.type === 'Camp' ? '🏕️' : (poi.type === 'Water' ? '💧' : (poi.type === 'Berry' ? '🍒' : (poi.type === 'Wood' ? '🌲' : '🪨')));
          document.getElementById('insp-title-name').textContent = `${poiIcon} ${poi.name}`;
          
          let stateBadge = '资源充足';
          if (!isFinite(poi.currentStock)) {
            stateBadge = '无限庇护';
          } else if (poi.currentStock < 4.0) {
            stateBadge = '资源枯竭中';
          } else if (poi.currentStock < poi.maxStock * 0.4) {
            stateBadge = '储量偏低';
          }
          document.getElementById('insp-title-state').textContent = stateBadge;
          document.getElementById('insp-title-state').style.color = poi.currentStock < 4.0 ? '#ef4444' : '#10b981';

          const stockRow = document.getElementById('insp-poi-stock-row');
          if (poi.type === 'Camp') {
            stockRow.style.display = 'none';
          } else {
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
              document.getElementById('insp-poi-stock-fill').style.background = '#eab308';
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

          document.getElementById('insp-poi-regen').textContent = poi.regenRate > 0 ? `+${poi.regenRate.toFixed(2)} 单位/秒` : `无限储量 (避风营地)`;
          document.getElementById('insp-poi-elev').textContent = `Z = ${poi.pos.z.toFixed(1)}m (${poi.pos.z < -10 ? '低洼区' : (poi.pos.z > 10 ? '高台区' : '平缓中台')})`;
          document.getElementById('insp-poi-coord').textContent = `(X: ${Math.round(poi.pos.x)}m, Y: ${Math.round(poi.pos.y)}m)`;
          
          let desc = '避风篝火营地(储量无限)，小人在此休养回体。';
          if (poi.type === 'Water') desc = '低洼处天然地泉(上限60单位,产速2.0/s)，小人饮水并补给家宅。';
          else if (poi.type === 'Berry') desc = '向阳缓坡野生灌木(上限60单位,产速2.0/s)，小人采食并补给家宅。';
          else if (poi.type === 'Wood') desc = '茂密原生林地(上限60单位,产速2.0/s)，伐木用于冬季房屋供暖与升级茅草房。';
          else if (poi.type === 'Stone') desc = '嶙峋高地石矿(上限60单位,产速1.5/s)，采石仅用于私宅升级木石庄舍与大庄园。';
          else if (poi.type === 'Gold') desc = '璀璨金矿(上限60单位,产速1.2/s)，开采黄金随身无限携带，存入私宅用于晋升最高级氏族大庄园。';
          document.getElementById('insp-detail-text').textContent = desc;
        }
      } else {
        agentView.style.display = 'block';
        poiView.style.display = 'none';
        houseView.style.display = 'none';
        if (followBtn) followBtn.style.display = 'block';

        const selAgent = sim.agents.find(a => a.id === sim.selectedAgentId) || aliveAgents[0];
        if (selAgent) {
          sim.selectedAgentId = selAgent.id;
          const isAdult = selAgent.age >= 120.0;
          const isFemale = selAgent.gender === 'female';
          const genderBadge = isFemale ? '♀' : '♂';
          const roleIcon = selAgent.isPregnant ? '🤰' : (isAdult ? (isFemale ? '👩' : '👨') : '🍼');
          
          let homeTag = `[🏕️ 营地]`;
          if (selAgent.homeHouseId !== null) {
            const myHouse = sim.houses.find(h => h.id === selAgent.homeHouseId);
            if (myHouse) {
              if (myHouse.ownerId === selAgent.id) homeTag = `[🏡 #${selAgent.homeHouseId}家·户主]`;
              else if (myHouse.spouseId === selAgent.id) homeTag = `[🏡 #${selAgent.homeHouseId}家·配偶]`;
              else homeTag = `[🏡 #${selAgent.homeHouseId}家·子女]`;
            }
          }
          document.getElementById('insp-title-name').textContent = `部落民 #${selAgent.id} ${genderBadge} ${roleIcon} ${homeTag}`;
          
          let stateText = selAgent.homeHouseId ? '🏡 私宅安居中' : '🏕️ 营地休息中';
          let detailText = selAgent.homeHouseId ? '在专属家宅中安居，夫妻与子女共享水粮木石储备，冬季房屋自动供暖，满足饱暖与木材>=10可激活孕育。' : '在露天营地休息恢复体力，无私宅不可受孕。';

          if (!selAgent.isAlive) {
            stateText = '💀 已死亡';
            detailText = `死因: ${selAgent.deathCause || '未知饥荒'} (遗骸将在 ${Math.ceil(selAgent.deathDecayTimer)}s 后消逝)`;
          } else if (selAgent.state === 'ConstructingHouse') {
            const progPct = Math.round((selAgent.buildTimer / 30.0) * 100);
            stateText = `🔨 营建/升级房屋 (${progPct}% - 30s工期)`;
            detailText = '投入体力与工时营建或升级私宅(30s工期)，完成后将扩容储备空间并激活/保障繁衍孕育。';
          } else if (selAgent.state === 'RepairingHouse') {
            stateText = '🔧 劳作修缮房屋中';
            detailText = '投入体力劳作修缮专属私宅，恢复房屋耐久度至 100% 避免风化坍塌。';
          } else if (selAgent.state === 'SeekingWater') {
            stateText = selAgent.isOffroad ? '💧 荒野直连寻水 (50%移速)' : '💧 沿道路寻水 (100%满速)';
            detailText = '前往水洼直接饮水解渴并顺带补充私宅储备。';
          } else if (selAgent.state === 'DrinkingAtWater') {
            stateText = '💧 水洼痛饮中';
            detailText = '在清泉处直接痛饮补充水分至 50.0 单位上限并补给私宅。';
          } else if (selAgent.state === 'SeekingFood') {
            stateText = selAgent.isOffroad ? '🍒 荒野直连觅食 (50%移速)' : '🍒 沿道路前往果丛 (100%满速)';
            detailText = '前往浆果丛直接进食充饥并顺带补充私宅储备。';
          } else if (selAgent.state === 'ForagingFood') {
            stateText = '🍒 正在就地进食';
            detailText = '在灌木丛处直接采食充饥至 50.0 单位上限并补给私宅。';
          } else if (selAgent.state === 'SeekingWood') {
            stateText = '🌲 正在前往林地伐木';
            detailText = '前往森林伐木获取木材，搬运回私宅用于冬季供暖与升级。';
          } else if (selAgent.state === 'GatheringWood') {
            stateText = '🌲 森林伐木采伐中';
            detailText = '正在林区砍伐木材并持续运往私宅木料仓。';
          } else if (selAgent.state === 'SeekingStone') {
            stateText = '🪨 正在前往石矿采石';
            detailText = '前往嶙峋石矿开采石料，用于私宅升级木石庄舍与大庄园。';
          } else if (selAgent.state === 'MiningStone') {
            stateText = '🪨 矿区开采石料中';
            detailText = '正在采石场开采石料并运回私宅石料仓(石头仅用于盖房)。';
          } else if (selAgent.state === 'SeekingGold') {
            stateText = '🪙 正在前往金矿淘金';
            detailText = '前往璀璨金矿开采黄金(随身无限携带)，运回私宅用于升级最高级氏族大庄园。';
          } else if (selAgent.state === 'MiningGold') {
            stateText = '🪙 金矿开采淘金中';
            detailText = '正在金矿开采黄金并随身装载(无限容量)，源源不断存入家宅金库。';
          } else if (selAgent.state === 'ReturningToCamp') {
            stateText = selAgent.homeHouseId ? '🏡 返回私产宅舍' : '🏕️ 沿道路返回营地';
            detailText = '已完成现场采集，返回专属归宿。';
          }

          document.getElementById('insp-title-state').textContent = stateText;
          document.getElementById('insp-title-state').style.color = '#f59e0b';
          
          // 年龄与性别生育状态展示
          const ageValElem = document.getElementById('insp-age-val');
          if (isAdult) {
            if (isFemale) {
              ageValElem.textContent = `${Math.floor(selAgent.age)}s (👩 ♀ 女性·已成年可孕育)`;
              ageValElem.style.color = '#ec4899';
            } else {
              ageValElem.textContent = `${Math.floor(selAgent.age)}s (👨 ♂ 男性·已成年)`;
              ageValElem.style.color = '#38bdf8';
            }
          } else {
            const needGrow = Math.ceil(120.0 - selAgent.age);
            if (isFemale) {
              ageValElem.textContent = `${Math.floor(selAgent.age)}s (🍼 ♀ 女童·还需成长 ${needGrow}s)`;
              ageValElem.style.color = '#f472b6';
            } else {
              ageValElem.textContent = `${Math.floor(selAgent.age)}s (🍼 ♂ 男童·还需成长 ${needGrow}s)`;
              ageValElem.style.color = '#7dd3fc';
            }
          }

          const hungerPct = Math.round((selAgent.hunger / 50.0) * 100);
          document.getElementById('insp-hunger-val').textContent = `${selAgent.hunger.toFixed(1)} / 50.0 单位 (${hungerPct}%)`;
          document.getElementById('insp-hunger-fill').style.width = `${hungerPct}%`;

          const thirstPct = Math.round((selAgent.thirst / 50.0) * 100);
          document.getElementById('insp-thirst-val').textContent = `${selAgent.thirst.toFixed(1)} / 50.0 单位 (${thirstPct}%)`;
          document.getElementById('insp-thirst-fill').style.width = `${thirstPct}%`;

          document.getElementById('insp-stamina-val').textContent = `${Math.round(selAgent.stamina)}%`;
          document.getElementById('insp-stamina-fill').style.width = `${selAgent.stamina}%`;
          const goldValEl = document.getElementById('insp-gold-val');
          if (goldValEl) goldValEl.textContent = `${(selAgent.carriedGold || 0.0).toFixed(1)} 单位`;
          document.getElementById('insp-detail-text').textContent = detailText;

          // 家族血脉与世系族谱渲染 (兼容父亲、母亲、配偶与子嗣)
          const fatherElem = document.getElementById('insp-lineage-father');
          if (selAgent.fatherId) {
            const fAgent = sim.agents.find(a => a.id === selAgent.fatherId);
            const fAlive = fAgent && fAgent.isAlive;
            const fHtml = `<span class="lineage-chip ${fAlive ? '' : 'dead'}" data-agent-id="${selAgent.fatherId}" title="点击追踪父亲视角">👨 父亲 #${selAgent.fatherId} ${fAlive ? '🟢' : '💀'}</span>`;
            if (fatherElem.innerHTML !== fHtml) fatherElem.innerHTML = fHtml;
          } else {
            const fHtml = `<span style="color:#64748b;">— (开局始祖代)</span>`;
            if (fatherElem.innerHTML !== fHtml) fatherElem.innerHTML = fHtml;
          }

          const motherElem = document.getElementById('insp-lineage-mother');
          if (selAgent.motherId) {
            const mAgent = sim.agents.find(a => a.id === selAgent.motherId);
            const mAlive = mAgent && mAgent.isAlive;
            const mHtml = `<span class="lineage-chip female ${mAlive ? '' : 'dead'}" data-agent-id="${selAgent.motherId}" title="点击追踪母亲视角">👩 母亲 #${selAgent.motherId} ${mAlive ? '🟢' : '💀'}</span>`;
            if (motherElem.innerHTML !== mHtml) motherElem.innerHTML = mHtml;
          } else {
            const mHtml = `<span style="color:#64748b;">— (开局始祖代)</span>`;
            if (motherElem.innerHTML !== mHtml) motherElem.innerHTML = mHtml;
          }

          const spouseElem = document.getElementById('insp-lineage-spouse');
          if (selAgent.spouseId) {
            const sAgent = sim.agents.find(a => a.id === selAgent.spouseId);
            const sAlive = sAgent && sAgent.isAlive;
            const isHusband = sAgent && sAgent.gender === 'male';
            const sHtml = `<span class="lineage-chip ${isHusband ? '' : 'female'} ${sAlive ? '' : 'dead'}" data-agent-id="${selAgent.spouseId}" title="点击追踪配偶视角">💍 ${isHusband ? '丈夫' : '妻子'} #${selAgent.spouseId} ${sAlive ? '🟢' : '💀'}</span>`;
            if (spouseElem.innerHTML !== sHtml) spouseElem.innerHTML = sHtml;
          } else {
            const sHtml = `<span style="color:#64748b;">未婚单身</span>`;
            if (spouseElem.innerHTML !== sHtml) spouseElem.innerHTML = sHtml;
          }

          const childrenElem = document.getElementById('insp-lineage-children');
          if (selAgent.children && selAgent.children.length > 0) {
            let cHtml = '';
            for (const cId of selAgent.children) {
              const cAgent = sim.agents.find(a => a.id === cId);
              const cAlive = cAgent && cAgent.isAlive;
              const isFem = cAgent && cAgent.gender === 'female';
              cHtml += `<span class="lineage-chip ${isFem ? 'female' : ''} ${cAlive ? '' : 'dead'}" data-agent-id="${cId}" title="点击追踪子嗣 #${cId}">${isFem ? '👧' : '👦'} #${cId} ${cAlive ? '🟢' : '💀'}</span>`;
            }
            if (childrenElem.innerHTML !== cHtml) childrenElem.innerHTML = cHtml;
          } else {
            const cHtml = `<span style="color:#64748b;">暂无子女</span>`;
            if (childrenElem.innerHTML !== cHtml) childrenElem.innerHTML = cHtml;
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
            document.getElementById('insp-preg-val').textContent = `${pVal}% (${Math.round(selAgent.pregnancyProgress * 120)}s / 120s)`;
            document.getElementById('insp-preg-fill').style.width = `${pVal}%`;
          } else {
            pregBox.style.display = 'none';
          }
        }
      }
    }
    requestAnimationFrame(render);

    // 智能点击拾取 (排除拖拽平移)
    canvas.addEventListener('click', e => {
      if (totalDragDist > 8) return;
      const clickX = e.clientX, clickY = e.clientY;

      for (const h of sim.houses) {
        const p2D = project3D(h.pos);
        if (Math.hypot(clickX - p2D.x, clickY - p2D.y) < 24) {
          sim.selectionType = 'house';
          sim.selectedHouseId = h.id;
          return;
        }
      }

      for (const poi of sim.pois) {
        const p2D = project3D(poi.pos);
        if (Math.hypot(clickX - p2D.x, clickY - p2D.y) < 26) {
          sim.selectionType = 'poi';
          sim.selectedPoiId = poi.id;
          return;
        }
      }

      let closestAgent = null, minDist = 25;
      for (const agent of sim.agents) {
        const p2D = project3D(agent.pos);
        const d = Math.hypot(clickX - p2D.x, clickY - p2D.y);
        if (d < minDist) {
          minDist = d;
          closestAgent = agent;
        }
      }

      if (closestAgent) {
        sim.selectionType = 'agent';
        sim.selectedAgentId = closestAgent.id;
      }
    });
