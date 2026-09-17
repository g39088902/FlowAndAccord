// === 世界图元绘制层（POI 底座与标记 / 私产宅舍 / 道路样式与描边 / 光照帮助函数）===
// ★ TA-04-6 前置拆分：世界统一深度队列（drawWorldEntities / DEPTH_* / 深度帮助函数 /
//   MAP_Z_LIFT / projectLifted / RC）已迁往 render_depth_queue.js（队列层单一职责，
//   入队和分发归队列层、绘制归本文件等图元模块）；collectCampHouseLinks 随入队迁出，
//   drawCampHouseLink 绘制保留在本文件。拆分为纯代码搬移，零行为变更。
// 依赖全局: ctx, camera, sim, project3D, window.SimLighting；
//   本文件的 lightShadowOffset / shadeHex 亦被 render_agents / render_accents / render_shadows 消费。

// ★ 动态季节光照：贴地阴影偏移 = 世界空间光向 → 屏幕投影（随相机旋转）
//   关闭动态光照时回退 v1.47.11 的固定屏幕偏移，保证 A/B 对照
// 传入 out（复用点对象）时零分配写入（★ TA-11-6 热路径消费）；省略时保持返回新对象的既有行为。
function lightShadowOffset(legacyX, legacyY, height, out) {
  const L = window.SimLighting;
  if (L && L.enabled()) {
    const o = L.shadowOffset(height);
    const alphaScale = Math.max(0.75, Math.min(1.5, L.shadowAlpha() / 0.24));
    if (out) { out.x = o.dx; out.y = o.dy; out.alphaScale = alphaScale; return out; }
    return { x: o.dx, y: o.dy, alphaScale: alphaScale };
  }
  if (out) { out.x = legacyX * camera.zoom; out.y = legacyY * camera.zoom; out.alphaScale = 1; return out; }
  return { x: legacyX * camera.zoom, y: legacyY * camera.zoom, alphaScale: 1 };
}

// ★ 动态季节光照：立体面受光（法线 → 色值），关闭时原样返回基色
function shadeHex(baseHex, nx, ny, nz) {
  const L = window.SimLighting;
  return (L && L.enabled()) ? L.shadeFace(baseHex, nx, ny, nz) : baseHex;
}

// ★ v1.47.9 POI 拆为「贴地底座（地面层）」与「标记（立体实体层）」两段：
// 底座/营地暖光是贴地绘制物，深度略远于自身标记（−0.01 epsilon），保证垫在自己图标之下。
// ★ v1.50.11 起底座不再整层先画，而是逐 POI 入统一深度队列（drawWorldEntities 收集阶段）。
function drawPoiGroundBase(poi) {
  const z = camera.zoom;
  const p2D = project3D(poi.pos);
  const x = p2D.x, y = p2D.y;

  if (poi.type === 'Camp') {
    const campR = (16 + (poi.level || 0) * 3) * z;
    // 1. 营地地面阴影（方向与长度随季节光位）
    const campShadow = lightShadowOffset(1.5, 3.0, (window.SimLighting && window.SimLighting.cfg().campShadowHeight) || 1.2);
    ctx.fillStyle = `rgba(20, 15, 10, ${(0.22 * campShadow.alphaScale).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x + campShadow.x, y + campShadow.y, campR * 1.1, campR * 0.55, -0.1, 0, Math.PI * 2);
    ctx.fill();

    // 2. 营地篝火与暖石基地 (温润暖赭底座，告别刺眼红黄色斑)
    const grad = ctx.createRadialGradient(x, y, 1, x, y, campR);
    grad.addColorStop(0, 'rgba(217, 119, 6, 0.75)');
    grad.addColorStop(0.65, 'rgba(180, 83, 9, 0.35)');
    grad.addColorStop(1, 'rgba(180, 83, 9, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, campR, 0, Math.PI * 2); ctx.fill();
    return;
  }

  // 自然资源与市场 POI (统一温润水墨/沙盘手办基座，彻底消除大光圈污染)
  const baseR = 12 * z;
  const poiShadow = lightShadowOffset(1.2, 2.5, (window.SimLighting && window.SimLighting.cfg().poiShadowHeight) || 0.9);
  ctx.fillStyle = `rgba(20, 15, 10, ${(0.20 * poiShadow.alphaScale).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(x + poiShadow.x, y + poiShadow.y, baseR * 1.1, baseR * 0.55, -0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = poiTintColor(poi);
  ctx.beginPath(); ctx.arc(x, y, baseR, 0, Math.PI * 2); ctx.fill();
}

// POI 底色（地面底座与图标共用，避免两段绘制各写一套色值）
function poiTintColor(poi) {
  if (poi.type === 'Water') return 'rgba(2, 132, 199, 0.28)';
  if (poi.type === 'Berry') return 'rgba(21, 128, 61, 0.28)';
  if (poi.type === 'Wood') return 'rgba(180, 83, 9, 0.28)';
  if (poi.type === 'Stone') return 'rgba(100, 116, 139, 0.28)';
  if (poi.type === 'Gold') return 'rgba(217, 119, 6, 0.28)';
  if (poi.type === 'Market') return 'rgba(217, 119, 6, 0.32)';
  return 'rgba(2, 132, 199, 0.25)';
}

// ★ S4-06 标签布局层（label-layout.js）消费刮擦：posOf 命中时写入文字基线位
const _llPos = { x: 0, y: 0 };
function _llActive() {
  const LL = window.LabelLayout;
  return LL && LL.active() ? LL : null;
}

// 房屋视觉半宽/半高（tier → 微缩模型几何，drawHouse 与标签提案共用同一套数值）
function houseHalfW(house, z) {
  return (house.tier === 'Tier0Warehouse' ? 5.25 : (house.tier === 'Tier4Manor' ? 8.4 : (house.tier === 'Tier3Homestead' ? 6.65 : 5.25))) * z;
}
function houseHalfH(house, z) {
  return (house.tier === 'Tier0Warehouse' ? 4.55 : (house.tier === 'Tier4Manor' ? 9.1 : (house.tier === 'Tier3Homestead' ? 6.65 : 5.25))) * z;
}

// ★ S4-06 POI 标签提案（收集阶段由 render_depth_queue 调用；条件与 drawPoiMarker 消费侧一一对应）。
// 键位 = poi.id * 16 + LabelLayout.KEY_POI_*；锚点 = projectLifted 精灵锚点（与绘制一致）。
// 图标为 pinned（恒接受占格不移位），舍数为 ordinary（可省略、四备选位）；营地名称不上地图，仅在 inspect 卡片展示。
function proposePoiLabels(poi) {
  const LL = _llActive();
  if (!LL) return;
  const RC = window.RENDER_CONFIG || {};
  const z = camera.zoom;
  const p2D = projectLifted(poi.pos);
  const x = p2D.x, y = p2D.y;
  if (x < -80 || x > w + 80 || y < -80 || y > h + 80) return; // 视口外不提案（绘制亦不可见）
  const kb = poi.id * 16;
  if (poi.type === 'Camp') {
    const lvl = poi.level || 0;
    const campIcon = lvl >= 4 ? '🏛️' : (lvl >= 2 ? '🏘️' : '🏕️');
    LL.propose(kb + LL.KEY_POI_ICON, 0, x, y, campIcon, `${Math.floor((13 + lvl * 2) * z)}px sans-serif`, 0, 4 * z, true);
    if (z > (RC.labelPoiNameMinZoom || 0.50)) {
      // ★ 营地名称不再上地图绘制，仅在 inspect 卡片中展示（保留舍数标签）
      if (poi.boundHouses > 0) {
        LL.propose(kb + LL.KEY_POI_COUNT, 3, x, y, `${poi.boundHouses}舍`,
          `${Math.max(8, Math.floor(9 * z))}px sans-serif`, 0, (14 + lvl * 2) * z, false);
      }
    }
  } else {
    const poiIcon = poi.type === 'Berry' ? '🍒' : poi.type === 'Wood' ? '🌲' : poi.type === 'Stone' ? '🪨' : poi.type === 'Gold' ? '🪙' : poi.type === 'Market' ? '🏪' : '💧';
    LL.propose(kb + LL.KEY_RES_ICON, 0, x, y, poiIcon, `${Math.floor(12 * z)}px sans-serif`, 0, 4 * z, true);
  }
}

// ★ S4-06 房屋标签提案：拍卖/修缮高优先级（状态警示优先安置），房屋编号普通级
// （选中时升为高优先级）。条件与 drawHouse 消费侧一一对应。
function proposeHouseLabels(house) {
  const LL = _llActive();
  if (!LL) return;
  const RC = window.RENDER_CONFIG || {};
  const z = camera.zoom;
  const p2D = projectLifted(house.pos);
  const x = p2D.x, y = p2D.y;
  if (x < -80 || x > w + 80 || y < -80 || y > h + 80) return;
  const isVacant = house.ownerId == null;
  const isAuction = isVacant && house.auctionPhase != null;
  const kb = house.id * 16;
  const hh = houseHalfH(house, z);
  const isSel = sim.selectionType === 'house' && sim.selectedHouseId === house.id;
  if (isAuction) {
    const plaqueLabel = house.highestBid > 0 ? `🔨 ${house.auctionPhase || '竞价'} · ${house.highestBid.toFixed(0)}G` : `🔨 ${house.auctionPhase || '招租'}`;
    LL.propose(kb + LL.KEY_HOUSE_AUCTION, 1, x, y, plaqueLabel, 'bold 8px sans-serif', 0, -hh * 1.7, false);
  } else if (house.isRepairing) {
    LL.propose(kb + LL.KEY_HOUSE_REPAIR, 1, x, y, `🔧修缮 (${Math.round(house.durability)}%)`, '8px sans-serif', 0, -hh * 1.6, false);
  } else if (z > (RC.labelHouseNumberMinZoom || 1.05) || isSel) {
    const isWarehouse = house.tier === 'Tier0Warehouse';
    const tierLabel = isWarehouse ? '仓' : (house.tier === 'Tier1ThatchedHut' ? '茅' : (house.tier === 'Tier2LeanTo' ? '宅' : (house.tier === 'Tier3Homestead' ? '庄' : '堡')));
    LL.propose(kb + LL.KEY_HOUSE_NUM, isSel ? 1 : 4, x, y, `#${house.id}${tierLabel}`, '8px sans-serif', 0, hh * 0.8, false);
  }
}

// POI 标记（图标 / 门牌 / 储量环 / 选中环）：参与统一深度排序，被近处实体正常遮挡。
// ★ S4-06：文字消费标签层落位——图标 pinned（posOf 确认已登记），名称/舍数 ordinary
// （未安置即省略）；布局关态走旧直接绘制路径，行为与 v1.50.51 逐位一致。
function drawPoiMarker(poi) {
  const z = camera.zoom;
  const RC = window.RENDER_CONFIG || {};
  const showDetailRings = z >= (RC.labelStockRingMinZoom || 0.70);
  const LL = _llActive();
  const p2D = projectLifted(poi.pos); // ★ v1.50.12 精灵锚点略抬于地表（贴地底座仍用 project3D）
  const isSelected = sim.selectionType === 'poi' && sim.selectedPoiId === poi.id;
  const x = p2D.x, y = p2D.y;

  if (poi.type === 'Camp') {
    const campIcon = (poi.level || 0) >= 4 ? '🏛️' : ((poi.level || 0) >= 2 ? '🏘️' : '🏕️');
    ctx.font = `${Math.floor((13 + (poi.level || 0) * 2) * z)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#d97706';
    if (!LL || LL.posOf(poi.id * 16 + LL.KEY_POI_ICON, _llPos)) {
      ctx.fillText(campIcon, x, y + 4 * z);
    }

    if (z > (RC.labelPoiNameMinZoom || 0.50)) {
      // ★ 营地名称不再上地图绘制，仅在 inspect 卡片中展示（保留舍数标签）
      if (poi.boundHouses > 0) {
        ctx.font = `${Math.max(8, Math.floor(9 * z))}px sans-serif`;
        ctx.fillStyle = '#cbd5e1';
        if (!LL || LL.posOf(poi.id * 16 + LL.KEY_POI_COUNT, _llPos)) {
          ctx.fillText(`${poi.boundHouses}舍`, LL ? _llPos.x : x, LL ? _llPos.y : y + (14 + (poi.level || 0) * 2) * z);
        }
      }
    }
  } else {
    let poiIcon = '💧', borderCol = '#0284c7';
    const ratio = isFinite(poi.maxStock) && poi.maxStock > 0 ? (poi.currentStock / poi.maxStock) : 1.0;

    if (poi.type === 'Water') { poiIcon = '💧'; borderCol = '#0284c7'; }
    else if (poi.type === 'Berry') { poiIcon = '🍒'; borderCol = '#15803d'; }
    else if (poi.type === 'Wood') { poiIcon = '🌲'; borderCol = '#b45309'; }
    else if (poi.type === 'Stone') { poiIcon = '🪨'; borderCol = '#64748b'; }
    else if (poi.type === 'Gold') { poiIcon = '🪙'; borderCol = '#d97706'; }
    else if (poi.type === 'Market') { poiIcon = '🏪'; borderCol = '#d97706'; }

    // 图标（pinned：posOf 确认已登记）
    ctx.font = `${Math.floor(12 * z)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = poiTintColor(poi);
    if (!LL || LL.posOf(poi.id * 16 + LL.KEY_RES_ICON, _llPos)) {
      ctx.fillText(poiIcon, x, y + 4 * z);
    }

    // 仅在局部放大或选中时才展示细线库存环，全景视口保持整洁
    if ((showDetailRings || isSelected) && poi.type !== 'Market') {
      const baseR = 12 * z;
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.arc(x, y, baseR + 2 * z, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
      ctx.stroke();
    }
  }

  if (isSelected) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 3.5 * z;
    ctx.beginPath(); ctx.arc(x, y, 18 * z, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6 * z;
    ctx.beginPath(); ctx.arc(x, y, 18 * z, 0, Math.PI * 2); ctx.stroke();
  }
}
function drawHouse(house) {
  const z = camera.zoom;
  const RC = window.RENDER_CONFIG || {};
  const showLabels = z > (RC.labelHouseNumberMinZoom || 1.05);
  const LL = _llActive();

  const p2D = projectLifted(house.pos); // ★ v1.50.12 精灵锚点略抬于地表
  const isSelected = sim.selectionType === 'house' && sim.selectedHouseId === house.id;
  const isWarehouse = house.tier === 'Tier0Warehouse';
  const isVacant = house.ownerId == null;
  const isAuction = isVacant && house.auctionPhase != null;
  const x = p2D.x, y = p2D.y;

  // 1. 地面柔和接触阴影 (Drop Shadow) - 按 70% 等比微缩，方向/长度随季节光位
  const sW = (house.tier === 'Tier4Manor' ? 10 : (house.tier === 'Tier3Homestead' ? 8.5 : 6.5)) * z;
  const sH = sW * 0.52;
  const hShadow = lightShadowOffset(1.4, 2.1, (window.SimLighting && window.SimLighting.cfg().houseShadowHeight) || 3.0);
  ctx.fillStyle = `rgba(22, 18, 14, ${(0.26 * hShadow.alphaScale).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(x + hShadow.x, y + hShadow.y, sW, sH, -0.12, 0, Math.PI * 2);
  ctx.fill();

  // 2. 2.5D 微缩建筑模型体块 (宽高缩小至原来的 70%) —— 半宽/半高与标签提案共用同一套数值
  const hw = houseHalfW(house, z);
  const hh = houseHalfH(house, z);

  // 墙体配色：空置房为古朴风化灰，有主房为温润奶油白/木质暖色
  const wallFront = isVacant ? '#d1c7b7' : (isWarehouse ? '#b8966c' : '#ede3d1');
  const wallSide = isVacant ? '#a89e8f' : (isWarehouse ? '#8c6f4b' : '#c4b8a3');

  // 屋顶配色 (层级分明)
  let roofFront, roofSide;
  if (isWarehouse) { roofFront = '#825f38'; roofSide = '#5c4122'; }
  else if (house.tier === 'Tier1ThatchedHut') { roofFront = '#c9a654'; roofSide = '#9e8038'; } // 茅草顶
  else if (house.tier === 'Tier2LeanTo') { roofFront = '#bf5737'; roofSide = '#8c3b22'; } // 暖陶瓦红
  else if (house.tier === 'Tier3Homestead') { roofFront = '#475569'; roofSide = '#334155'; } // 青石黛瓦庄院
  else { roofFront = '#334155'; roofSide = '#1e293b'; } // 城堡深石板青

  // 墙体受光面 (南/东) 与 背光面 (西)
  // ★ 动态季节光照：面法线参与光向计算（左墙 = 西、右墙 = 南、左坡 = 西向上、右坡 = 南向上）；
  //   相对旧固定光归一化 ⇒ 关闭动态光照或光位回到西北 41° 时与 v1.47.11 配色一致。
  ctx.fillStyle = shadeHex(wallSide, -1, 0, 0);
  ctx.beginPath();
  ctx.moveTo(x - hw, y);
  ctx.lineTo(x, y + hh * 0.4);
  ctx.lineTo(x, y - hh * 0.5);
  ctx.lineTo(x - hw, y - hh * 0.9);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = shadeHex(wallFront, 0, 1, 0);
  ctx.beginPath();
  ctx.moveTo(x, y + hh * 0.4);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x + hw, y - hh * 0.9);
  ctx.lineTo(x, y - hh * 0.5);
  ctx.closePath();
  ctx.fill();

  // 门洞微缩细节
  ctx.fillStyle = '#4a3828';
  ctx.beginPath();
  ctx.moveTo(x + hw * 0.2, y + hh * 0.15);
  ctx.lineTo(x + hw * 0.6, y - hh * 0.05);
  ctx.lineTo(x + hw * 0.6, y - hh * 0.5);
  ctx.lineTo(x + hw * 0.2, y - hh * 0.3);
  ctx.closePath();
  ctx.fill();

  // 双坡/四阿微缩屋顶 (具有太阳漫反射明暗)
  ctx.fillStyle = shadeHex(roofSide, -0.45, 0, 0.89);
  ctx.beginPath();
  ctx.moveTo(x - hw * 1.15, y - hh * 0.85);
  ctx.lineTo(x, y - hh * 0.45);
  ctx.lineTo(x, y - hh * 1.35);
  ctx.lineTo(x - hw * 0.8, y - hh * 1.6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = shadeHex(roofFront, 0, 0.45, 0.89);
  ctx.beginPath();
  ctx.moveTo(x, y - hh * 0.45);
  ctx.lineTo(x + hw * 1.15, y - hh * 0.85);
  ctx.lineTo(x + hw * 0.8, y - hh * 1.6);
  ctx.lineTo(x, y - hh * 1.35);
  ctx.closePath();
  ctx.fill();

  // 庄院飞檐或城堡塔楼细节
  if (house.tier === 'Tier3Homestead' || house.tier === 'Tier4Manor') {
    ctx.strokeStyle = roofSide;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(x - hw * 1.25, y - hh * 0.95);
    ctx.lineTo(x, y - hh * 0.42);
    ctx.lineTo(x + hw * 1.25, y - hh * 0.95);
    ctx.stroke();
  }

  // 3. 悬浮拍卖标牌或修缮标识 (全景降噪，仅在近景/选中或关键状态展示)
  //    ★ S4-06：文字消费标签层落位（未安置即省略）；关态走旧直接绘制路径
  if (isAuction) {
    const plaqueLabel = house.highestBid > 0 ? `🔨 ${house.auctionPhase || '竞价'} · ${house.highestBid.toFixed(0)}G` : `🔨 ${house.auctionPhase || '招租'}`;
    ctx.font = 'bold 8px sans-serif';
    ctx.fillStyle = '#f59e0b';
    ctx.textAlign = 'center';
    if (!LL || LL.posOf(house.id * 16 + LL.KEY_HOUSE_AUCTION, _llPos)) {
      ctx.fillText(plaqueLabel, LL ? _llPos.x : x, LL ? _llPos.y : y - hh * 1.7);
    }
  } else if (house.isRepairing) {
    ctx.font = '8px sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.textAlign = 'center';
    if (!LL || LL.posOf(house.id * 16 + LL.KEY_HOUSE_REPAIR, _llPos)) {
      ctx.fillText(`🔧修缮 (${Math.round(house.durability)}%)`, LL ? _llPos.x : x, LL ? _llPos.y : y - hh * 1.6);
    }
  } else if (showLabels || isSelected) {
    const tierLabel = isWarehouse ? '仓' : (house.tier === 'Tier1ThatchedHut' ? '茅' : (house.tier === 'Tier2LeanTo' ? '宅' : (house.tier === 'Tier3Homestead' ? '庄' : '堡')));
    ctx.font = '8px sans-serif';
    ctx.fillStyle = isVacant ? '#94a3b8' : '#e2e8f0';
    ctx.textAlign = 'center';
    if (!LL || LL.posOf(house.id * 16 + LL.KEY_HOUSE_NUM, _llPos)) {
      ctx.fillText(`#${house.id}${tierLabel}`, LL ? _llPos.x : x, LL ? _llPos.y : y + hh * 0.8);
    }
  }

  if (isSelected) {
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
    ctx.lineWidth = 3.5 * z;
    ctx.beginPath(); ctx.arc(x, y, sW * 1.1, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6 * z;
    ctx.beginPath(); ctx.arc(x, y, sW * 1.1, 0, Math.PI * 2); ctx.stroke();
  }
}

// 选中营地时，用特殊虚线把辖区内的全部房屋连回营地；线段置于房屋图标下方避免遮挡信息。
function drawCampHouseLink(it) {
  const house = it.a;
  const camp = _selLinkCamp;
  if (!camp) return;
  const camp2D = project3D(camp.pos);
  const house2D = project3D(house.pos);
  const vacant = house.ownerId == null;
  const color = vacant ? '#f59e0b' : '#38bdf8';
  ctx.save();
  ctx.lineWidth = Math.max(1.2, 2.0 * camera.zoom);
  ctx.setLineDash([Math.max(4, 8 * camera.zoom), Math.max(3, 5 * camera.zoom)]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 7 * camera.zoom;
  ctx.globalAlpha = 0.72;
  ctx.beginPath();
  ctx.moveTo(camp2D.x, camp2D.y);
  ctx.lineTo(house2D.x, house2D.y);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(house2D.x, house2D.y, Math.max(1.5, 2.5 * camera.zoom), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ★ v1.50.11：drawLanes 拆分——
//   ① updateLaneHover：悬浮检测 + Tooltip DOM 更新（原 drawLanes 前半段，逐帧整层无关深度）；
//   ② cacheLaneStyle + drawLaneSegment：道路样式计算与单段描边（由统一深度队列逐段调度）。
function updateLaneHover() {
hoveredLane = null;
let minHoverDist = 14;

if (sim.showLanes && sim.network && sim.network.lanes) {
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

  // 更新悬浮 Tooltip 提示
  const roadTooltip = document.getElementById('road-hover-tooltip');
  const cfg = window.SIM_CONFIG || {};
  if (roadTooltip) {
    if (hoveredLane) {
      const maxWear = cfg.roadMaxWear || 10.0;
      const benefitMax = cfg.roadBenefitMaxWear || 5.0;
      const rawWear = hoveredLane.wear || 0.0;
      const wear = Math.min(maxWear, rawWear);
      const effectiveWear = Math.min(benefitMax, wear);
      let levelName = '1级 踩踏细径 (泥土小道)';
      let levelColor = '#b45309';
      let barColor = '#f59e0b';
      let badgeText = '1级 初见成型';

      if (wear >= 4.0) {
        levelName = wear > benefitMax ? `5级 极品帝国大道 (溢出储备 ${(wear - benefitMax).toFixed(2)})` : '5级 极品帝国大道 (顶级通衢)';
        levelColor = '#f59e0b';
        barColor = 'linear-gradient(90deg, #f59e0b, #ec4899)';
        badgeText = wear > benefitMax ? '5级 满额溢出' : '5级 极品通衢';
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

      const speedFactor = Math.min(
        cfg.roadLevelFactorMax || 2.20,
        Math.max(
          cfg.roadLevelFactorMin || 0.50,
          (cfg.roadLevelFactorBase || 0.50) + (cfg.roadLevelFactorWearCoef || 0.333) * effectiveWear
        )
      );
      const speedBonusPct = Math.round((speedFactor - 1.0) * 100);
      const speedText = speedBonusPct >= 0 ? `+${speedBonusPct}%` : `${speedBonusPct}%`;
      const wearPct = Math.round((wear / maxWear) * 100);
      const isOverflow = wear > benefitMax;

      roadTooltip.innerHTML = `
        <div class="road-tooltip-title">
          <span style="color:${levelColor}; font-weight:700;">🛣️ ${levelName}</span>
          <span style="color:${levelColor}; font-size:10px; background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px;">${badgeText}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:2px;">
          <span style="color:#94a3b8;">耐久度 / 踩踏值:</span>
          <span style="color:#f8fafc; font-weight:700; font-family:monospace;">${wear.toFixed(2)} / ${maxWear.toFixed(2)} (${wearPct}%)${isOverflow ? ` <span style="color:#a78bfa; font-size:10px;">(溢出 +${(wear - benefitMax).toFixed(2)})</span>` : ''}</span>
        </div>
        <div class="road-tooltip-bar-bg">
          <div class="road-tooltip-bar-fill" style="width:${wearPct}%; background:${isOverflow ? 'linear-gradient(90deg, #f59e0b, #ec4899, #a78bfa)' : barColor};"></div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:3px;">
          <span style="color:#94a3b8;">移动速度加成:</span>
          <span style="color:#38bdf8; font-weight:700; font-family:monospace;">${speedFactor.toFixed(2)}x (${speedText}${isOverflow ? ' · 满额无额外增益' : ''})</span>
        </div>
        <div style="font-size:10px; color:#64748b; margin-top:3px; border-top:1px solid rgba(255,255,255,0.06); padding-top:4px;">
          👟 步行通行: <span style="color:#10b981;">+${cfg.roadWearStepInc || 0.1}/次</span> · 闲置自然衰减: <span style="color:#f87171;">-${(wear * (cfg.roadWearDecayRate || 0.005)).toFixed(4)}/h (${((cfg.roadWearDecayRate || 0.005) * 100).toFixed(2)}%/h)</span>
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

// 道路分段样式（每帧每路计算一次，字符串缓存到 lane 对象上，避免逐段分配 rgba 字符串）
// 样式规则与旧 drawLanes 完全一致：热力图模式（R 键）高饱和五档 / 自然模式低饱和泥土-夯土-石板五档。
function cacheLaneStyle(lane, wear) {
  const isHovered = hoveredLane && (lane.id === hoveredLane.id || (hoveredLane.reverseId && lane.id === hoveredLane.reverseId));
  let st = lane._rdStyle;
  if (!st) {
    st = { wear: -1, isHovered: false, heatmap: null, strokeColor: '', lineWidth: 0, lineDash: null };
    lane._rdStyle = st;
  }
  if (st.wear === wear && st.isHovered === isHovered && st.heatmap === sim.showRoadHeatmap) return;
  st.wear = wear; st.isHovered = isHovered; st.heatmap = sim.showRoadHeatmap;

  let lineWidth = 2.0 * camera.zoom;
  let strokeColor, lineDash;
  if (sim.showRoadHeatmap) {
    // 道路等级分析热力图模式 (按 R 键切换开启): 高饱和色彩与外圈分析光晕
    if (wear < 1.0) { strokeColor = `rgba(180, 83, 9, ${Math.min(0.75, 0.20 + (wear - 0.3) * 0.64)})`; lineDash = [3, 4]; }
    else if (wear < 2.0) { strokeColor = `rgba(245, 158, 11, ${Math.min(0.85, 0.45 + (wear - 1.0) * 0.35)})`; lineDash = []; }
    else if (wear < 3.0) { strokeColor = 'rgba(250, 204, 21, 0.95)'; lineDash = []; }
    else if (wear < 4.0) { strokeColor = 'rgba(56, 189, 248, 0.95)'; lineDash = []; }
    else { strokeColor = 'rgba(217, 70, 239, 1.0)'; lineDash = []; }
  } else {
    // 自然地表踩踏小径模式 (普通观察默认): 低饱和自然泥土、夯土与石板，消除高光割裂
    if (wear < 1.0) {
      lineWidth = 1.2 * camera.zoom;
      strokeColor = `rgba(142, 115, 84, ${Math.min(0.55, 0.12 + (wear - 0.3) * 0.50)})`;
      lineDash = [3, 4];
    } else if (wear < 2.0) {
      lineWidth = 1.6 * camera.zoom;
      strokeColor = `rgba(122, 98, 72, ${Math.min(0.75, 0.35 + (wear - 1.0) * 0.30)})`;
      lineDash = [];
    } else if (wear < 3.0) {
      lineWidth = 2.0 * camera.zoom;
      strokeColor = 'rgba(108, 95, 80, 0.85)';
      lineDash = [];
    } else if (wear < 4.0) {
      lineWidth = 2.4 * camera.zoom;
      strokeColor = 'rgba(132, 128, 120, 0.90)';
      lineDash = [];
    } else {
      lineWidth = 2.8 * camera.zoom;
      strokeColor = 'rgba(158, 154, 144, 0.95)';
      lineDash = [];
    }
  }
  st.strokeColor = strokeColor;
  st.lineWidth = lineWidth;
  st.lineDash = lineDash;
}

// 单段道路描边（统一深度队列调度）。悬浮高亮光晕与热力图外圈微光逐段先行落笔，
// 效果与旧整路两遍描边等价；lineDashOffset 按段首累计弧长推进，虚线相位跨段连续。
function drawLaneSegment(it) {
  const st = it.a._rdStyle;
  if (!st) return;

  if (st.isHovered) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = st.lineWidth + 3.0 * camera.zoom;
    ctx.beginPath();
    ctx.moveTo(it.s1x, it.s1y);
    ctx.lineTo(it.s2x, it.s2y);
    ctx.stroke();
  }

  // 高等级大道外圈微光 (仅在热力图模式下显示，自然模式保持地表克制)
  if (st.heatmap && st.wear >= 4.0) {
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.25)';
    ctx.lineWidth = st.lineWidth + 3.0 * camera.zoom;
    ctx.beginPath();
    ctx.moveTo(it.s1x, it.s1y);
    ctx.lineTo(it.s2x, it.s2y);
    ctx.stroke();
  }

  ctx.strokeStyle = st.strokeColor;
  ctx.lineWidth = st.lineWidth;
  ctx.setLineDash(st.lineDash);
  ctx.lineDashOffset = it.dash;
  ctx.beginPath();
  ctx.moveTo(it.s1x, it.s1y);
  ctx.lineTo(it.s2x, it.s2y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

