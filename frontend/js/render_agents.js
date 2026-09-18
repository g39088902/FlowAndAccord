// === 族人绘制 (从 render.js 拆分) ===
// 部落民单实体渲染 drawAgent（由 drawWorldEntities 统一深度调度）/ 选中高亮 / 状态气泡
// 依赖全局: ctx, camera, sim, project3D, MASLOW_STYLE, NEED_KIND_LABEL, parseMaslowNeed

// ★ v1.47.9 单实体绘制入口：由 render_world.js::drawWorldEntities() 按相机深度统一调度。
// ★ S4-06：施工/流产/夺位角标为 pinned 标记（收集阶段登记占格，绘制经 posOf 确认）；
//   选中需求气泡迁出至交互覆盖层 drawSelectedNeedBubbleOverlay()（深度队列之后强制安置）。
const _agentLLPos = { x: 0, y: 0 };
let _llSelAgent = null; // 本帧选中的族人（收集阶段捕获，覆盖层消费后清空）

// ★ S4-06 族人标签提案（收集阶段由 render_depth_queue 调用；条件与 drawAgent 一一对应）
function proposeAgentLabels(agent) {
  if (agent.isFetus) return;
  if (!agent.isAlive) return;
  // 选中目标捕获须在任何 early-return 之前（布局关态 overlay 回退路径同样消费）
  if (sim.selectionType === 'agent' && sim.selectedAgentId === agent.id) _llSelAgent = agent;
  const LL = window.LabelLayout;
  if (!LL || !LL.active()) return;
  const RC = window.RENDER_CONFIG || {};
  const z = camera.zoom;
  const p2D = projectLifted(agent.pos);
  const x = p2D.x, y = p2D.y;
  if (x < -80 || x > w + 80 || y < -80 || y > h + 80) return;
  const kb = agent.id * 16;
  if (agent.state === 'ConstructingHouse') {
    LL.propose(kb + LL.KEY_AGENT_BUILD, 0, x, y, '🔨', `${Math.floor(12 * z)}px sans-serif`, 0, -10 * z, true);
  }
  if (agent.miscarriageTimer > 0) {
    const floatY = (5.0 - agent.miscarriageTimer) * 7.0;
    LL.propose(kb + LL.KEY_AGENT_MISC, 0, x, y, '🥀', `${Math.floor(13 * z)}px sans-serif`, 0, -12 * z - floatY, true);
  }
  if (agent.isOnExpedition && sim.expeditionTargets && sim.expeditionTargets.get(agent.id) != null) {
    LL.propose(kb + LL.KEY_AGENT_EXPED, 0, x, y, '⚔️', `${Math.floor(14 * z)}px serif`, 0, -18 * z, true);
  }
}

// ★ S4-06 交互覆盖标签：选中族人需求气泡（原 drawAgent 内联绘制迁出）。
// 由 drawWorldEntities 分发循环结束后调用——画在世界层之上（不参与地形遮挡），
// 经 LabelLayout.overlayPlace 强制安置（优先避开 UI 禁入矩形与已接受矩形，钳制在画布内）；
// 布局关态回退旧固定位置（锚点上方）。
function drawSelectedNeedBubbleOverlay() {
  const agent = _llSelAgent;
  _llSelAgent = null;
  if (!agent) return;
  const need = parseMaslowNeed(agent.currentNeed, agent);
  if (!need) return;
  const z = camera.zoom;
  const label = `${need.icon} ${need.name} · ${need.kindLabel}`;
  const font = `${Math.max(8, Math.floor(10 * z))}px sans-serif`;
  const p2D = projectLifted(agent.pos);
  const pillH0 = 14 * camera.zoom;
  // 首选基线位 = 旧内联绘制的等价位置（pill 顶 = 锚点上方 14z，基线 = 顶 + 0.72×pillH）
  let px = p2D.x, py = p2D.y - 14 * z - pillH0 * 0.28;
  const LL = window.LabelLayout;
  if (LL && LL.active() && LL.overlayPlace(agent.id * 16 + 10, p2D.x, p2D.y, label, font, -14 * z - pillH0 * 0.28, _agentLLPos)) {
    px = _agentLLPos.x; py = _agentLLPos.y;
  }

  ctx.font = font;
  ctx.textAlign = 'center';
  const tw = ctx.measureText(label).width;
  const pillH = 14 * camera.zoom;
  const pillY = py - pillH * 0.72;
  const bx = px - tw / 2 - 5 * camera.zoom;
  const bw = tw + 10 * camera.zoom;
  ctx.fillStyle = 'rgba(5, 10, 18, 0.88)';
  ctx.strokeStyle = need.color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(bx, pillY, bw, pillH, 4 * camera.zoom);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = need.color;
  ctx.fillText(label, px, py);
}

function drawAgent(agent) {
  // ★ M1.7 胎儿不设置地图实体：不在地图上渲染
  if (agent.isFetus) return;
  const p2D = projectLifted(agent.pos); // ★ v1.50.12 精灵锚点略抬于地表（render_world.js 定义）
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
    // 绘制 🔨 施工标识与细线进度环（★ S4-06：图标 pinned，经 posOf 确认本帧已登记）
    const LLg = window.LabelLayout;
    if (!LLg || !LLg.active() || LLg.posOf(agent.id * 16 + LLg.KEY_AGENT_BUILD, _agentLLPos)) {
      ctx.font = `${Math.floor(12 * camera.zoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🔨', p2D.x, p2D.y - 10 * camera.zoom);
    }

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
    const LLm = window.LabelLayout;
    if (!LLm || !LLm.active() || LLm.posOf(agent.id * 16 + LLm.KEY_AGENT_MISC, _agentLLPos)) {
      ctx.font = `${Math.floor(13 * camera.zoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🥀', p2D.x, p2D.y - 12 * camera.zoom - floatY);
    }
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

  // ★ S4-06：选中需求气泡已迁至交互覆盖层 drawSelectedNeedBubbleOverlay()
  // （drawWorldEntities 分发循环结束后调用，深度队列之上强制安置，见上方函数）

  // ★ M4: 夺位远征动态标牌（金色战盔 + 虚线光束指向目标营地）
  // ★ S4-06：战盔图标 pinned，经 posOf 确认本帧已登记（提案条件与提案侧一致）
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
        const LLe = window.LabelLayout;
        if (!LLe || !LLe.active() || LLe.posOf(agent.id * 16 + LLe.KEY_AGENT_EXPED, _agentLLPos)) {
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
