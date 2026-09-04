// === 世界元素绘制 (从 render.js 拆分) ===
// 地形 / 路网 / POI / 房屋绘制函数
// 依赖全局: ctx, camera, sim, project3D, getElevationColor, mousePos, isDragging, hoveredLane, terrainProjX, terrainProjY

function drawTerrain() {
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
}

function drawPois() {
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
  } else if (poi.type === 'Market') {
    const ratioWater = isFinite(poi.maxStock) && poi.maxStock > 0 ? (poi.currentStock / poi.maxStock) : 1.0;
    const ratioFood = isFinite(poi.secondaryMaxStock) && poi.secondaryMaxStock > 0 ? (poi.secondaryStock / poi.secondaryMaxStock) : 1.0;
    const grad = ctx.createRadialGradient(p2D.x, p2D.y, 2, p2D.x, p2D.y, 22 * camera.zoom);
    grad.addColorStop(0, 'rgba(245, 158, 11, 0.95)');
    grad.addColorStop(0.5, 'rgba(217, 119, 6, 0.50)');
    grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(p2D.x, p2D.y, 22 * camera.zoom, 0, Math.PI * 2); ctx.fill();

    ctx.font = `${Math.floor(16 * camera.zoom)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('🏪', p2D.x, p2D.y + 5);

    // 双库存环：内环水 (天蓝色)，外环粮 (玫瑰红)
    ctx.lineWidth = 2.0;
    ctx.strokeStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(p2D.x, p2D.y, 15 * camera.zoom, -Math.PI/2, -Math.PI/2 + ratioWater * Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(p2D.x, p2D.y, 18 * camera.zoom, -Math.PI/2, -Math.PI/2 + ratioFood * Math.PI * 2);
    ctx.stroke();
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
}

function drawHouses() {
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

  if (house.ownerId == null) {
    const isAuction = house.auctionPhase != null;
    if (isAuction) {
      // ★ v1.15.0 独特在售动效：金色脉冲呼吸光晕
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.005);
      const auraR = (16 + 5 * pulse) * camera.zoom;
      const grad = ctx.createRadialGradient(p2D.x, p2D.y, 2, p2D.x, p2D.y, auraR);
      grad.addColorStop(0, `rgba(245, 158, 11, ${0.4 + 0.25 * pulse})`);
      grad.addColorStop(0.7, `rgba(217, 119, 6, ${0.15 + 0.15 * pulse})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p2D.x, p2D.y, auraR, 0, Math.PI * 2);
      ctx.fill();

      // 房屋图标
      ctx.globalAlpha = 0.95;
      ctx.font = `${Math.floor(16 * camera.zoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(tierIcon, p2D.x, p2D.y + 4);
      ctx.globalAlpha = 1.0;

      // 悬浮拍卖标牌 (Floating Auction Plaque)
      const phaseColor = (house.auctionPhase === '观察期') ? '#f59e0b' : ((house.auctionPhase === '决策期') ? '#38bdf8' : '#ef4444');
      const phaseText = house.auctionPhase === '观察期' ? '🌾摸底' : (house.auctionPhase === '决策期' ? '🎯竞价' : '⚠️出清');
      const priceVal = house.highestBid || 0;
      const plaqueLabel = priceVal > 0 ? `🔨 ${phaseText} · ${priceVal.toFixed(1)}G` : `🔨 ${phaseText}`;

      ctx.font = 'bold 9px sans-serif';
      const textW = ctx.measureText(plaqueLabel).width;
      const badgeW = textW + 10;
      const badgeH = 15;
      const badgeX = p2D.x - badgeW / 2;
      const badgeY = p2D.y - (18 * camera.zoom) - badgeH;

      // 标牌背景与描边
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.strokeStyle = phaseColor;
      ctx.lineWidth = 1.2;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
        ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
      }

      // 指向屋顶的小三角
      ctx.fillStyle = phaseColor;
      ctx.beginPath();
      ctx.moveTo(p2D.x - 3, badgeY + badgeH);
      ctx.lineTo(p2D.x + 3, badgeY + badgeH);
      ctx.lineTo(p2D.x, badgeY + badgeH + 3);
      ctx.closePath();
      ctx.fill();

      // 标牌文字
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.fillText(plaqueLabel, p2D.x, badgeY + 11);

      // 门牌号与修缮度
      ctx.font = '8px sans-serif';
      ctx.fillStyle = phaseColor;
      ctx.fillText(`#${house.id}在售 (${Math.round(house.durability)}%)`, p2D.x, p2D.y + 16 * camera.zoom);
    } else {
      // 常规空置房屋
      ctx.globalAlpha = 0.55;
      ctx.font = `${Math.floor(14 * camera.zoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(tierIcon, p2D.x, p2D.y + 4);
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`#${house.id}空`, p2D.x, p2D.y + 16 * camera.zoom);
      ctx.globalAlpha = 1.0;
    }
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

    // 门牌与耐久提示（M6：房屋不再显示库存，家庭储备见家户账本）
    ctx.font = '8px sans-serif';
    if (house.isRepairing) {
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`🔧修缮(${Math.round(house.durability)}%)`, p2D.x, p2D.y + 16 * camera.zoom);
    } else {
      ctx.fillStyle = '#fde68a';
      ctx.fillText(`#${house.id}${tierLabel}`, p2D.x, p2D.y + 16 * camera.zoom);
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
}

function drawLanes() {
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
}
