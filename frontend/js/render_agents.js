// === 族人与特效绘制 (从 render.js 拆分) ===
// 部落民单实体渲染 drawAgent（由 drawWorldEntities 统一深度调度）/ 选中高亮 / 状态气泡 / 登基礼花特效
// 依赖全局: ctx, camera, sim, project3D, MASLOW_STYLE, NEED_KIND_LABEL, parseMaslowNeed, coronationEffects, prevKingsMap, CORONATION_DURATION

// ★ v1.47.9 单实体绘制入口：由 render_world.js::drawWorldEntities() 按相机深度统一调度。
function drawAgent(agent) {
  // ★ M1.7 胎儿不设置地图实体：不在地图上渲染
  if (agent.isFetus) return;
  const p2D = project3D(agent.pos);
  const isSelectedAgent = sim.selectionType === 'agent' && sim.selectedAgentId === agent.id;

  if (!agent.isAlive) {
    const deathAlpha = Math.max(0, Math.min(1.0, agent.deathDecayTimer / 4.0));
    ctx.save();
    ctx.globalAlpha = deathAlpha * 0.75;
    // 宁静小石堆/墓石标记，替代刺眼的白色骷髅贴图
    const stoneR = 3.0 * camera.zoom;
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(p2D.x - stoneR * 0.6, p2D.y + stoneR * 0.2, stoneR * 0.8, 0, Math.PI * 2);
    ctx.arc(p2D.x + stoneR * 0.6, p2D.y + stoneR * 0.2, stoneR * 0.7, 0, Math.PI * 2);
    ctx.arc(p2D.x, p2D.y - stoneR * 0.4, stoneR * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // 温润低饱和服饰色系，融入沙盘大地质感
  let stateColor = '#d97706'; // 默认暖赭色
  if (agent.state === 'SeekingWater' || agent.state === 'DrinkingAtWater') stateColor = '#0284c7'; // 澄澈湖蓝
  else if (agent.state === 'SeekingFood' || agent.state === 'ForagingFood') stateColor = '#15803d'; // 沉稳林绿
  else if (agent.state === 'SeekingWood' || agent.state === 'GatheringWood') stateColor = '#b45309'; // 暖木土黄
  else if (agent.state === 'SeekingStone' || agent.state === 'MiningStone') stateColor = '#64748b'; // 风化岩灰
  else if (agent.state === 'SeekingGold' || agent.state === 'MiningGold') stateColor = '#d97706'; // 沉淀暖金
  else if (agent.state === 'ReturningToCamp') stateColor = '#c2410c'; // 归巢土红
  else if (agent.state === 'ConstructingHouse') stateColor = '#b45309';

  // 幼年期标识 (未满 1800s)
  const isAdult = agent.age >= 1800.0;

  if (agent.state === 'ConstructingHouse') {
    // 绘制 🔨 施工标识与细线进度环
    ctx.font = `${Math.floor(12 * camera.zoom)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('🔨', p2D.x, p2D.y - 10 * camera.zoom);

    const progress = Math.min(1.0, agent.buildTimer / 30.0);
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(p2D.x, p2D.y, 7.0 * camera.zoom, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
  }

  if (agent.isPregnant) {
    stateColor = '#be185d'; // 沉着柔和的胭红，告别荧光刺眼感
    ctx.save();
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.40)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([3 * camera.zoom, 3 * camera.zoom]);
    ctx.beginPath();
    ctx.arc(p2D.x, p2D.y, (5.0 + agent.pregnancyProgress * 3.5) * camera.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (agent.miscarriageTimer > 0) {
    const mAlpha = Math.max(0, Math.min(1.0, agent.miscarriageTimer / 2.0));
    const floatY = (5.0 - agent.miscarriageTimer) * 7.0;
    ctx.save();
    ctx.globalAlpha = mAlpha;
    ctx.font = `${Math.floor(13 * camera.zoom)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('🥀', p2D.x, p2D.y - 12 * camera.zoom - floatY);
    ctx.restore();
  }

  // 行走微弱尘土轨迹 (大幅降低透明度，杜绝满屏荧光毛毛虫)
  if (agent.trail.length > 1) {
    ctx.save();
    ctx.lineWidth = 0.9 * camera.zoom;
    ctx.lineCap = 'round';
    for (let t = 0; t < agent.trail.length - 1; t++) {
      const pA = project3D(agent.trail[t]);
      const pB = project3D(agent.trail[t + 1]);
      const alpha = ((t + 1) / agent.trail.length) * 0.14;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = stateColor;
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 1. 族人地面微接触阴影 (Drop Shadow，扎根沙盘感) — 方向/长度随季节光位
  const agentRadius = (isAdult ? 3.6 : 2.5) * camera.zoom;
  const aShadow = lightShadowOffset(0.8, 1.8, (window.SimLighting && window.SimLighting.cfg().agentShadowHeight) || 1.6);
  ctx.fillStyle = `rgba(20, 15, 10, ${(0.24 * aShadow.alphaScale).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(p2D.x + aShadow.x, p2D.y + aShadow.y, agentRadius * 1.05, agentRadius * 0.55, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // 2. 实体人偶点 (主体与微小头部)
  ctx.fillStyle = stateColor;
  ctx.beginPath();
  ctx.arc(p2D.x, p2D.y, agentRadius, 0, Math.PI * 2);
  ctx.fill();

  // 2.5 受光侧微高光 (随季节光向绕人偶转动；取负高度即光源方向)
  const LS = window.SimLighting;
  if (LS && LS.enabled()) {
    const lit = LS.shadowOffset(-0.55);
    ctx.fillStyle = 'rgba(255, 246, 224, 0.15)';
    ctx.beginPath();
    ctx.arc(p2D.x + lit.dx, p2D.y + lit.dy - agentRadius * 0.2, agentRadius * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  // 族人头部微光点
  ctx.fillStyle = '#fce7f3';
  ctx.beginPath();
  ctx.arc(p2D.x - 0.5 * camera.zoom, p2D.y - 0.7 * camera.zoom, agentRadius * 0.45, 0, Math.PI * 2);
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

function drawCoronationEffects(now) {
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

}
