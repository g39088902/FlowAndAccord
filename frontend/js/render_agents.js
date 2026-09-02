// === 族人与特效绘制 (从 render.js 拆分) ===
// 部落民 Agent 渲染 / 选中高亮 / 状态气泡 / 登基礼花特效
// 依赖全局: ctx, camera, sim, project3D, MASLOW_STYLE, NEED_KIND_LABEL, parseMaslowNeed, coronationEffects, prevKingsMap, CORONATION_DURATION

function drawAgents() {
const agentsToRender = sim.showAgents ? sim.agents : [];
for (const agent of agentsToRender) {
  // ★ M1.7 胎儿不设置地图实体：不在地图上渲染
  if (agent.isFetus) continue;
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
