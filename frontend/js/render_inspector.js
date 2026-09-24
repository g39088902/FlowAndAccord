// === Inspector 面板与点击拾取（调度层；面板渲染已拆分为 inspector-* 子模块） ===
// updateInspector() 仅负责：三视图 DOM 切换 / 选中对象解析 / 家户账本 hook，并分发到子面板：
//   inspector-shared.js   共享计量与产速帮助层 (_meterRateTracker/_fmtRate/_gameDt/poiRegenMultiplier/effectiveRegenRate)
//   inspector-hormone.js  ★ H-06 激素观察面板与趋势采样器 (window.HormoneTrend，rustworld 世界生命周期 reset)
//   inspector-agent.js    族人面板主体 updateAgentInspector
//   inspector-house.js    房屋面板 updateHouseInspector
//   inspector-poi.js      POI 面板 updatePoiInspector
//   inspector-lineage.js  家族血脉与世系族谱 updateAgentLineage
//   camp-detail.js        ★ v1.12.0 营地辖区详情模态 (window._campDetailTick/closeCampDetail/isCampDetailOpen)
// 依赖全局: sim, camera, project3D, canvas, totalDragDist, clickCycle

function updateInspector() {
const inspectorCard = document.getElementById('inspector-card');
const agentView = document.getElementById('insp-agent-view');
const poiView = document.getElementById('insp-poi-view');
const houseView = document.getElementById('insp-house-view');
const followBtn = document.getElementById('insp-agent-actions');
const views = { agentView, poiView, houseView, followBtn };

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
  if (house) updateHouseInspector(house, views);
} else if (sim.selectionType === 'poi' && sim.selectedPoiId !== null) {
  const poi = sim.pois.find(p => p.id === sim.selectedPoiId);
  if (poi) updatePoiInspector(poi, views);
} else {
  agentView.style.display = 'block';
  poiView.style.display = 'none';
  houseView.style.display = 'none';
  if (followBtn) followBtn.style.display = 'block';

  // ★ v1.12.0 恢复营地视图可能隐藏的元素
  const tsAgent = document.getElementById('insp-title-state');
  if (tsAgent) tsAgent.style.display = '';
  const dtAgent = document.getElementById('insp-detail-text');
  if (dtAgent) dtAgent.style.display = '';
  const pibAgent = document.getElementById('insp-poi-info-badge');
  if (pibAgent) pibAgent.style.display = '';
  const marketTradesAgent = document.getElementById('insp-market-trades');
  if (marketTradesAgent) marketTradesAgent.style.display = 'none';
  const mbAgent = document.getElementById('insp-market-box');
  if (mbAgent) mbAgent.style.display = 'none';

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
    // ★ H-06 选中对象变化时清理激素趋势缓存（不同 agent 样本不得互相差分）
    if (typeof _hormoneTrendAgentId !== 'undefined' && _hormoneTrendAgentId !== selAgent.id) {
      HormoneTrend.reset();
    }
    _hormoneTrendAgentId = selAgent.id;
    updateAgentInspector(selAgent, views);
  }
}
}

// 智能点击拾取 (排除拖拽平移)
// 智能点击拾取 (排除拖拽平移) —— 多个元素 (agent/house/poi) 重叠时，连续点击同一位置循环切换到其他元素
let clickCycle = null; // { x, y } 上一次循环切换的点击位置
canvas.addEventListener('click', e => {
  if (totalDragDist > 8) return;
  const clickX = e.clientX, clickY = e.clientY;

  // ★ S4-07 智能交互拾取优先级：聚合徽标 > LabelLayout 已安置标签 > Canvas 原有欧氏距离实体
  const LL = window.LabelLayout;
  if (LL && LL.active()) {
    const hit = LL.hitTest(clickX, clickY);
    if (hit) {
      if (hit.isCluster) {
        LL.openClusterPopup(hit);
        return;
      }
      sim.selectionType = hit.ownerType;
      if (hit.ownerType === 'agent') sim.selectedAgentId = hit.ownerId;
      else if (hit.ownerType === 'house') sim.selectedHouseId = hit.ownerId;
      else if (hit.ownerType === 'poi') sim.selectedPoiId = hit.ownerId;
      clickCycle = { x: clickX, y: clickY };
      if (typeof LL.closeClusterPopup === 'function') LL.closeClusterPopup();
      if (typeof updateInspector === 'function') updateInspector();
      return;
    }
  }
  if (LL && typeof LL.closeClusterPopup === 'function') LL.closeClusterPopup();

  // 收集光标下所有可选中元素，按渲染层级自上而下排序: agent (就近优先) -> house -> poi
  const targets = [];
  const agentHits = [];
  // 隐藏部落民时，族人不再参与点击拾取 (避免"看不见却点得中")
  for (const agent of (sim.showAgents ? sim.agents : [])) {
    // ★ M1.7 胎儿无地图实体：不可在地图上被点击（只能从母亲卡片跳转）
    if (agent.isFetus) continue;
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
