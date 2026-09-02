// =========================================================================
// 🌳 直系血脉时间轴族谱模块 (Flow & Accord)
//   · 数据层 buildLineageDAG：焦点父/母递归祖先链 + 子女递归后代链
//   · 布局层 FlowDagLayout：Y 严格线性映射出生 tick，X 冲突规避横向扩展
//   · 渲染层 FlowDagView：视口虚拟化 + 缩放分层 LOD + 时间刻度尺
//   · 独立新标签页由 FlowDagStandalone 生成，三端共用同一套布局与渲染源码
// =========================================================================

(function (window) {
  'use strict';

  const DEFAULT_PX_PER_TICK = window.FlowDagLayout.LAYOUT_CONST.PX_PER_TICK;

  // =========================================================================
  // 1. 直系血脉图谱数据构建 (仅收录焦点的父/母递归祖先链 + 子女递归后代链)
  // =========================================================================
  function buildLineageDAG(focusId, sim) {
    const lookup = new Map();
    if (sim && sim.agentArchive) {
      for (const [id, ag] of sim.agentArchive) lookup.set(id, ag);
    }
    if (sim && sim.agents) {
      for (const ag of sim.agents) lookup.set(ag.id, ag);
    }

    // ★ v1.8.7 反查子女索引：档案库中任何留有 fatherId/motherId 的对象（含流产/随母亡故入档的胎儿）
    //   都是对应父母的子女——即使父母 children_ids 已因流产被内核清理，族谱也能画出"死因: 流产"节点
    const reverseChildren = new Map();
    for (const [, ag] of lookup) {
      if (!ag) continue;
      for (const pId of [ag.fatherId, ag.motherId]) {
        if (pId == null) continue;
        if (!reverseChildren.has(pId)) reverseChildren.set(pId, []);
        reverseChildren.get(pId).push(ag.id);
      }
    }

    // 焦点校正：默认取编号最小且存活的族人
    if (!focusId || !lookup.has(focusId)) {
      const ids = Array.from(lookup.keys()).sort((a, b) => a - b);
      focusId = ids.find(id => lookup.get(id) && lookup.get(id).isAlive) || ids[0] || 1;
    }

    const ancestors = new Set();
    const descendants = new Set();
    const lineageIds = new Set();
    if (lookup.has(focusId)) {
      lineageIds.add(focusId);
      const aq = [focusId];
      while (aq.length > 0) {
        const cur = lookup.get(aq.shift());
        if (!cur) continue;
        for (const pId of [cur.fatherId, cur.motherId]) {
          if (pId && lookup.has(pId) && !ancestors.has(pId)) {
            ancestors.add(pId); lineageIds.add(pId); aq.push(pId);
          }
        }
      }
      const dq = [focusId];
      while (dq.length > 0) {
        const cur = lookup.get(dq.shift());
        if (!cur) continue;
        const kids = new Set();
        if (Array.isArray(cur.children)) for (const c of cur.children) kids.add(c);
        if (reverseChildren.has(cur.id)) for (const c of reverseChildren.get(cur.id)) kids.add(c);
        for (const cId of kids) {
          if (lookup.has(cId) && !descendants.has(cId)) {
            descendants.add(cId); lineageIds.add(cId); dq.push(cId);
          }
        }
      }
    }

    const nodes = [];
    const nodeMap = new Map();
    for (const id of lineageIds) {
      const ag = lookup.get(id);
      if (!ag || ag.id === undefined || ag.id === null) continue;
      const gen = ag.generation && ag.generation >= 1
        ? ag.generation : ((ag.fatherId || ag.motherId) ? 2 : 1);
      const node = {
        id: ag.id,
        gender: ag.gender || (ag.id % 2 === 1 ? 'male' : 'female'),
        generation: gen,
        isAlive: !!ag.isAlive,
        isPregnant: !!ag.isPregnant,
        age: Math.floor(ag.age || 0),
        birthTick: ag.birthTick !== undefined ? ag.birthTick : 0,
        health: ag.health !== undefined ? Number(ag.health).toFixed(1) : '100',
        deathCause: ag.deathCause || null,
        fatherId: ag.fatherId || null,
        motherId: ag.motherId || null,
        spouseId: ag.spouseId || null,
        children: Array.isArray(ag.children) ? [...ag.children] : [],
        homeHouseId: ag.homeHouseId || null,
        intelligence: Math.round(ag.intelligence || 100),
        strength: Math.round(ag.strength || 100),
        libido: Math.round(ag.libido || 100),
        digestionEfficiency: Math.round(ag.digestionEfficiency || 100),
        sleepEfficiency: Math.round(ag.sleepEfficiency || 100),
        lifeExpectancy: Math.round(ag.lifeExpectancy || 100),
        isAncestor: ancestors.has(ag.id),
        isDescendant: descendants.has(ag.id),
        isFocus: ag.id === focusId,
        x: 0, y: 0, col: 0
      };
      nodes.push(node);
      nodeMap.set(ag.id, node);
    }

    // 亲子独立有向边 (父亲 / 母亲各一条，不生成夫妻边)
    const edges = [];
    for (const n of nodes) {
      if (n.fatherId && nodeMap.has(n.fatherId)) {
        edges.push({ parent: nodeMap.get(n.fatherId), child: n, parentType: 'father' });
      }
      if (n.motherId && nodeMap.has(n.motherId)) {
        edges.push({ parent: nodeMap.get(n.motherId), child: n, parentType: 'mother' });
      }
    }

    // 时间轴布局 (确定性：同数据必得同结果，无力学收敛)
    const laid = window.FlowDagLayout.layoutTimelineDag(nodes, edges, {
      focusId: focusId,
      pxPerTick: DEFAULT_PX_PER_TICK
    });

    return {
      focusId: focusId,
      nodes: nodes,
      edges: edges,
      nodeMap: nodeMap,
      width: laid.width,
      height: laid.height,
      pxPerTick: laid.pxPerTick,
      tickMin: laid.tickMin,
      tickMax: laid.tickMax,
      tickToY: laid.tickToY,
      yToTick: laid.yToTick,
      spine: laid.spine
    };
  }

  // =========================================================================
  // 2. 页内全屏模态渲染
  // =========================================================================
  let inPageView = null;
  let inPageDag = null;
  let inPageFocusId = 1;
  let inPageDensity = 1;
  let inPageSim = null;

  function renderInPageDag(sim, containerEl) {
    if (!containerEl) return;
    if (inPageView) inPageView.destroy();

    inPageSim = sim;
    inPageDag = buildLineageDAG(inPageFocusId, sim);
    inPageFocusId = inPageDag.focusId;

    inPageView = window.FlowDagView.createDagView({
      container: containerEl,
      dag: inPageDag,
      onSelect: (n) => showInPageInspector(n, sim)
    });

    const statsEl = document.getElementById('dag-modal-stats');
    if (statsEl) {
      const years = ((inPageDag.tickMax - inPageDag.tickMin) / 7200).toFixed(1);
      statsEl.textContent = '直系 ' + inPageDag.nodes.length + ' 人 · 亲子边 ' +
        inPageDag.edges.length + ' · 跨度 ' + years + ' 年';
    }
    inPageView.fitAll();
  }

  function showInPageInspector(n, sim) {
    const insp = document.getElementById('dag-inspector-panel');
    const header = document.getElementById('dag-insp-header');
    const content = document.getElementById('dag-insp-content');
    if (!insp || !header || !content) return;

    header.innerHTML =
      '<div style="font-size:13px; font-weight:700; color:#38bdf8; display:flex; align-items:center; gap:6px;">' +
        '<span>' + (n.gender === 'female' ? '👩' : '👦') + '</span>' +
        '<span>部落民 #' + n.id + ' (第' + n.generation + '代 · ' + (n.gender === 'female' ? '女性' : '男性') + ')</span>' +
      '</div>' +
      '<button id="dag-insp-close" style="background:transparent; border:none; color:#94a3b8; font-size:14px; cursor:pointer;">✕</button>';

    content.innerHTML =
      '<div style="margin-bottom:6px; color:#38bdf8; font-weight:600;">' +
        (n.isAlive
          ? ('🟢 活跃中 · 年龄 ' + n.age + 's · 健康 ' + n.health)
          : ('💀 已故 · 死因: ' + (n.deathCause || '寿终正寝'))) +
      '</div>' +
      '<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-bottom:8px;">' +
        '<div>🕐 出生 tick: ' + n.birthTick + '</div>' +
        '<div>' + (n.isSpine ? '🟥 位于主干血脉' : '〰️ 旁支血脉') + '</div>' +
        '<div>👴 父亲: ' + (n.fatherId ? '#' + n.fatherId : '无 (始祖)') + '</div>' +
        '<div>👩 母亲: ' + (n.motherId ? '#' + n.motherId : '无 (始祖)') + '</div>' +
        '<div>💍 配偶: ' + (n.spouseId ? '#' + n.spouseId : '未婚') + '</div>' +
        '<div>👶 直系后代: ' + (n.children ? n.children.length : 0) + ' 位</div>' +
      '</div>' +
      '<div style="background:rgba(30,41,59,0.6); padding:6px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.06);">' +
        '<strong>🧬 遗传禀赋属性:</strong><br>' +
        '🧠 智力: ' + n.intelligence + ' · 💪 力量: ' + n.strength + ' · ❤️‍🔥 魅力: ' + n.libido + '<br>' +
        '🍽️ 消化率: ' + n.digestionEfficiency + ' · 😴 睡眠率: ' + n.sleepEfficiency + ' · ⏳ 寿命: ' + n.lifeExpectancy +
      '</div>' +
      '<button id="dag-insp-track-btn" class="dag-tool-btn primary" style="width:100%; margin-top:8px; justify-content:center;">🎯 切换世界镜头追踪此人</button>';

    insp.style.display = 'flex';
    document.getElementById('dag-insp-close').onclick = () => { insp.style.display = 'none'; };

    const trackBtn = document.getElementById('dag-insp-track-btn');
    if (trackBtn) {
      trackBtn.onclick = () => {
        if (sim) {
          sim.selectionType = 'agent';
          sim.selectedAgentId = n.id;
          if (window.camera && typeof sim.getAgent === 'function') {
            const ag = sim.getAgent(n.id);
            if (ag && ag.pos) {
              const cosZ = Math.cos(window.camera.rotZ), sinZ = Math.sin(window.camera.rotZ);
              const rx = ag.pos.x * cosZ - ag.pos.y * sinZ;
              const ry = ag.pos.x * sinZ + ag.pos.y * cosZ;
              const cosX = Math.cos(window.camera.rotX), sinX = Math.sin(window.camera.rotX);
              const y2 = ry * cosX - (ag.pos.z || 0) * sinX;
              window.camera.panX = -rx * window.camera.zoom;
              window.camera.panY = -y2 * window.camera.zoom;
            }
          }
        }
        closeModal();
      };
    }
  }

  function closeModal() {
    const modal = document.getElementById('full-dag-modal');
    if (modal) modal.style.display = 'none';
    const insp = document.getElementById('dag-inspector-panel');
    if (insp) insp.style.display = 'none';
    if (inPageView) { inPageView.destroy(); inPageView = null; }
    inPageDag = null;
  }

  // =========================================================================
  // 3. 对外 API
  // =========================================================================
  window.FlowDag = {
    buildLineageDAG: buildLineageDAG,

    generateStandaloneDagHtml(focusId, sim) {
      return window.FlowDagStandalone.generateStandaloneDagHtml(focusId, sim);
    },

    openInNewTab(focusId, sim) {
      const win = window.open('', '_blank');
      if (!win) { this.openModal(focusId, sim); return; }
      const html = this.generateStandaloneDagHtml(focusId, sim);
      win.document.open();
      win.document.write(html);
      win.document.close();
    },

    openModal(focusId, sim) {
      const modal = document.getElementById('full-dag-modal');
      const container = document.getElementById('dag-graph-container');
      if (!modal || !container) return;

      inPageFocusId = focusId || (sim && sim.selectedAgentId) || 1;
      inPageDensity = 1;
      const densityEl = document.getElementById('dag-density');
      const densityValEl = document.getElementById('dag-density-val');
      if (densityEl) densityEl.value = '1';
      if (densityValEl) densityValEl.textContent = '1.00x';

      modal.style.display = 'flex';
      renderInPageDag(sim, container);
      bindModalButtons(container);
    },

    closeModal: closeModal,

    // 供 main.js / 无头截图脚本读取当前视图状态
    getInPageView() { return inPageView; },
    getInPageDag() { return inPageDag; }
  };

  // ---------------------------------------------------------------- 按钮绑定
  let modalBound = false;
  function bindModalButtons(container) {
    const btnCenter = document.getElementById('dag-btn-center');
    if (btnCenter) {
      btnCenter.onclick = () => { if (inPageView) inPageView.fitAll(); };
    }
    const btnReset = document.getElementById('dag-btn-reset-zoom');
    if (btnReset) {
      btnReset.onclick = () => {
        if (!inPageView) return;
        inPageView.centerOn(inPageFocusId, 1.0);
      };
    }
    const btnNewTab = document.getElementById('dag-btn-new-tab');
    if (btnNewTab) {
      btnNewTab.onclick = () => window.FlowDag.openInNewTab(inPageFocusId, inPageSim);
    }
    const btnClose = document.getElementById('dag-btn-close');
    if (btnClose) btnClose.onclick = closeModal;

    const densityEl = document.getElementById('dag-density');
    if (densityEl && !modalBound) {
      modalBound = true;
      densityEl.oninput = (e) => {
        inPageDensity = parseFloat(e.target.value) || 1;
        const valEl = document.getElementById('dag-density-val');
        if (valEl) valEl.textContent = inPageDensity.toFixed(2) + 'x';
        if (inPageView) inPageView.relayout(DEFAULT_PX_PER_TICK * inPageDensity);
      };
    }
  }
})(window);
