// ═══════════════════════════════════════════════════════════════
// ★ LedgerUI · M2 账本与社会制度 UI 模块 (v1.1.0)
// 从 render.js 抽离社会制度 UI：标签页枢纽 / 流水穿透抽屉 /
// 分家抽资可视化 / 丧父继承清算档案 / 公仓兜底余额
// 暴露 window.LedgerUI.update(sim) 供 render.js 10FPS 节流调用
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ─── 常量映射 ───────────────────────────────────────────────
  const RES_ICONS  = { Water: '💧', Food: '🍒', Wood: '🌲', Stone: '🪨', Gold: '🪙' };
  const RES_COLORS = { Water: '#38bdf8', Food: '#10b981', Wood: '#d97706', Stone: '#94a3b8', Gold: '#fbbf24' };
  const REASON_ICONS = { Deposit: '📥', Consume: '🍽️', Heating: '🔥', Construction: '🔨', Maintenance: '🔧', Split: '✂️', Inheritance: '⚰️', Tribute: '🏛️', MutualAid: '🛡️', Tax: '👑', Relief: '🤲', Legacy: '⛩️' };
  const REASON_LABELS = { Deposit: '存入', Consume: '消耗', Heating: '供暖', Construction: '营建', Maintenance: '修缮', Split: '分家', Inheritance: '继承', Tribute: '族税', MutualAid: '互助', Tax: '公仓税', Relief: '王室救济', Legacy: '绝嗣归并' };
  const ROLE_LABELS = { Head: '👑 户主', Spouse: '💍 配偶', Child: '👶 子女', None: '—' };

  // ─── 模块状态 ───────────────────────────────────────────────
  let activeTab = 'household';       // 当前标签页
  let journalHHId = null;            // 流水抽屉展开的家户 ID
  let dissolvedExpandedId = null;    // 继承档案展开的已解散家户 ID
  let journalClanSurname = null;     // 流水抽屉展开的宗族姓氏
  let successionExpandedSurname = null; // 族长顺位展开的宗族姓氏
  // ★ M4: 王国标签页状态
  let journalRegionCampId = null;    // 流水抽屉展开的地区 camp_id
  let regionArrivalExpanded = null;  // 到达时序展开的 camp_id
  let regionSuccessionExpanded = null; // 长子顺位展开的 camp_id
  let _simRef = null;                // 最近一次 sim 引用（事件回调用）

  // ─── 工具函数 ───────────────────────────────────────────────
  function tickToSec(t) { return t / 30.0; }
  function fmtDur(sec) {
    if (sec < 60) return sec.toFixed(0) + 's';
    if (sec < 3600) return (sec / 60).toFixed(1) + 'min';
    return (sec / 3600).toFixed(1) + 'h';
  }
  function agentName(sim, id) {
    if (id == null) return '—';
    const a = (typeof sim.getAgent === 'function') ? sim.getAgent(id) : null;
    return '#' + id + (a && a.surname ? '【' + a.surname + '】' : '');
  }
  function balTotal(bal) {
    return (bal.Water || 0) + (bal.Food || 0) + (bal.Wood || 0) + (bal.Stone || 0) + (bal.Gold || 0);
  }
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  // ─── 宗族辅助：从 Debug 字符串解析实体 ID ────────────────────
  function parseFamilyId(s) {
    if (!s) return null;
    const m = s.match(/Family\((\d+)\)/);
    return m ? parseInt(m[1], 10) : null;
  }
  function parseClanSurname(s) {
    if (!s) return null;
    const m = s.match(/Clan\("?([^")]+)"?\)/);
    return m ? m[1] : null;
  }
  // 族内有家户的男性数（户数近似）
  function countClanHouseholds(sim, clan) {
    if (!sim.agents || !clan.memberIds) return 0;
    const idSet = new Set(clan.memberIds);
    return sim.agents.filter(a =>
      idSet.has(a.id) && a.gender === 'male' && a.householdId != null
    ).length;
  }
  // 族长顺位：同姓男性在世，按年龄降序、并列 id 小者，取前3
  function getClanSuccession(sim, clan) {
    if (!sim.agents || !clan.surname) return [];
    return sim.agents
      .filter(a => a.surname === clan.surname && a.gender === 'male' && a.isAlive !== false)
      .sort((a, b) => (b.age || 0) - (a.age || 0) || a.id - b.id)
      .slice(0, 3);
  }

  // ─── 标签页切换 ─────────────────────────────────────────────
  function switchTab(tab) {
    activeTab = tab;
    journalHHId = null;
    dissolvedExpandedId = null;
    journalClanSurname = null;
    successionExpandedSurname = null;
    journalRegionCampId = null;
    regionArrivalExpanded = null;
    regionSuccessionExpanded = null;
    // 更新按钮激活态
    document.querySelectorAll('.ledger-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    // 切换内容可见性
    ['household', 'marriage', 'clan', 'region'].forEach(t => {
      const el = document.getElementById('tab-' + t + '-content');
      if (el) el.style.display = (t === tab) ? '' : 'none';
    });
    if (_simRef) update(_simRef);
  }

  // ─── 家户标签页渲染 ─────────────────────────────────────────
  function renderHouseholdTab(sim) {
    const households = sim.households || [];
    const marriages = sim.marriages || [];
    const activeHH = households.filter(h => !h.isDissolved);
    const dissolvedHH = households.filter(h => h.isDissolved);
    const activeMG = marriages.filter(m => m.isActive);

    // 概览统计
    setText('ledger-ov-active', activeHH.length);
    setText('ledger-ov-dissolved', dissolvedHH.length);
    setText('ledger-ov-marriages', activeMG.length);
    setText('ledger-ov-marriages-total', marriages.length);

    // 家户列表（存续优先，已解散附后；并列 id 小者在前）
    const sorted = activeHH.slice().sort((a, b) => a.id - b.id)
      .concat(dissolvedHH.slice().sort((a, b) => a.id - b.id));

    const list = document.getElementById('ledger-household-list');
    if (!list) return;

    if (sorted.length === 0) {
      list.innerHTML = '<div class="ledger-empty">尚无家户（成年男性立宅后成立）</div>';
    } else {
      const shown = sorted.slice(0, 20);
      list.innerHTML = shown.map(h => renderHouseholdItem(sim, h)).join('');
      if (sorted.length > 20) {
        list.innerHTML += '<div class="ledger-hh-more">... 另有 ' + (sorted.length - 20) + ' 户未展示</div>';
      }
    }

    // 公仓兜底余额卡片
    renderPublicGranary(sim);
  }

  function renderHouseholdItem(sim, h) {
    const head = agentName(sim, h.head);
    const bal = h.balances || {};
    const total = balTotal(bal);
    const isDiss = !!h.isDissolved;
    const journalOpen = (journalHHId === h.id) && !isDiss;
    const inheritOpen = (dissolvedExpandedId === h.id) && isDiss;

    let html = '<div class="ledger-hh-item' + (isDiss ? ' ledger-dissolved' : '') + (journalOpen ? ' ledger-journal-open' : '') + '" data-hh-id="' + h.id + '">';
    html += '<div class="ledger-hh-item-head">';
    html += '<span class="ledger-hh-id">🏠 #' + h.id + '</span>';
    html += '<span class="ledger-hh-head-name lineage-chip" data-agent-id="' + h.head + '">' + esc(head) + ' 👑</span>';
    html += '<span class="ledger-hh-members">👥 ' + h.members.length + '人</span>';

    // 分家标记
    if (h.parentHousehold != null) {
      html += '<span class="ledger-split-badge" title="分家抽资公式">🌱 分家自 #' + h.parentHousehold
        + '<span class="ledger-split-tooltip">' + renderSplitTooltip(sim, h) + '</span></span>';
    }
    // 已解散标签
    if (isDiss) {
      html += '<span class="ledger-dissolved-tag">⚰️ 已解散</span>';
    }

    html += '<span class="ledger-hh-bal-total ledger-bal-click" data-hh-bal="' + h.id + '" title="点击查看最近流水">📒 ' + total.toFixed(1) + '</span>';
    html += '</div>';

    // 账面余额行（可点击触发流水抽屉）
    html += '<div class="ledger-hh-item-bal ledger-bal-click" data-hh-bal="' + h.id + '">';
    html += '<span style="color:#38bdf8;">💧' + (bal.Water || 0).toFixed(0) + '</span>';
    html += '<span style="color:#10b981;">🍒' + (bal.Food || 0).toFixed(0) + '</span>';
    html += '<span style="color:#d97706;">🌲' + (bal.Wood || 0).toFixed(0) + '</span>';
    html += '<span style="color:#94a3b8;">🪨' + (bal.Stone || 0).toFixed(0) + '</span>';
    html += '<span style="color:#fbbf24;">🪙' + (bal.Gold || 0).toFixed(0) + '</span>';
    html += '</div>';

    // 家户大事记（高亮分家事件）
    const events = h.recentEvents || [];
    if (events.length > 0) {
      html += '<div class="ledger-hh-events">';
      events.slice(0, 3).forEach(e => {
        const isSplit = /分家|split/i.test(e);
        html += '<div class="ledger-event-item' + (isSplit ? ' event-split' : '') + '">' + esc(e) + '</div>';
      });
      html += '</div>';
    }

    // 流水抽屉（存续家户）
    if (journalOpen) {
      html += renderJournalDrawer(sim, h);
    }

    // 继承清算档案（已解散家户展开）
    if (isDiss && inheritOpen) {
      html += renderInheritanceArchive(sim, h);
    }

    html += '</div>';
    return html;
  }

  // ─── 分家公式气泡 ───────────────────────────────────────────
  function renderSplitTooltip(sim, h) {
    // 权重 W = 2(父) + n(子一代)；n 取父家户当前成员数 - 2（父母）作为近似
    const parent = (sim.households || []).find(p => p.id === h.parentHousehold);
    const parentMembers = parent ? parent.members.length : 2;
    const n = Math.max(0, parentMembers - 2);
    const W = 2 + n;
    const pct = (100 / W).toFixed(1);
    return '<div class="split-tip-title">🌱 分家抽资公式</div>'
      + '<div class="split-tip-formula">W = 2(父) + n(子一代) = 2 + ' + n + ' = <b>' + W + '</b></div>'
      + '<div class="split-tip-ratio">抽资比例 1/W = <b style="color:#f59e0b;">' + pct + '%</b></div>'
      + '<div class="split-tip-note">长子分家时从父家户账面按比例抽资立户</div>';
  }

  // ─── 流水穿透抽屉 ───────────────────────────────────────────
  function renderJournalDrawer(sim, h) {
    const journal = h.recentJournal || [];
    let html = '<div class="ledger-journal-drawer">';
    html += '<div class="ledger-journal-header">';
    html += '<span>📒 家户 #' + h.id + ' · 最近流水（' + journal.length + '笔）</span>';
    html += '<button class="ledger-journal-close" data-journal-close="' + h.id + '" title="关闭">✕</button>';
    html += '</div>';
    if (journal.length === 0) {
      html += '<div class="ledger-empty">暂无流水记录</div>';
    } else {
      html += '<div class="ledger-journal-list">';
      journal.slice(0, 8).forEach(r => {
        const rIcon = REASON_ICONS[r.reason] || '📌';
        const rLabel = REASON_LABELS[r.reason] || r.reason;
        const resIcon = RES_ICONS[r.resource] || '📦';
        const resColor = RES_COLORS[r.resource] || '#94a3b8';
        const amt = (r.amount || 0).toFixed(1);
        const from = esc(r.from || '—');
        const to = esc(r.to || '—');
        html += '<div class="ledger-journal-item">';
        html += '<span class="journal-tick">t' + r.tick + '</span>';
        html += '<span class="journal-reason" title="' + esc(r.reason) + '">' + rIcon + ' ' + rLabel + '</span>';
        html += '<span class="journal-res" style="color:' + resColor + ';">' + resIcon + ' ' + amt + '</span>';
        html += '<span class="journal-flow">' + from + ' → ' + to + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ─── 丧父继承清算档案 ───────────────────────────────────────
  function renderInheritanceArchive(sim, h) {
    const journal = h.recentJournal || [];
    const inheritRecords = journal.filter(r => r.reason === 'Inheritance');
    const hasInheritance = inheritRecords.length > 0;
    // 绝嗣判定：无继承流水且已解散 → 资产充入公仓
    const isAbsent = !hasInheritance;

    let html = '<div class="ledger-inherit-archive">';
    html += '<div class="ledger-inherit-header">⚰️ 继承清算档案 · 家户 #' + h.id + '</div>';
    html += '<div class="ledger-inherit-row"><span>原户主:</span><b>' + esc(agentName(sim, h.head)) + '</b></div>';
    html += '<div class="ledger-inherit-row"><span>成立时刻:</span><b>tick ' + h.foundedTick + ' (' + fmtDur(tickToSec(h.foundedTick)) + ')</b></div>';
    html += '<div class="ledger-inherit-row"><span>最终成员:</span><b>' + h.members.length + '人</b></div>';

    if (hasInheritance) {
      html += '<div class="ledger-inherit-subtitle">📜 继承分配明细</div>';
      html += '<div class="ledger-journal-list">';
      inheritRecords.slice(0, 8).forEach(r => {
        const resIcon = RES_ICONS[r.resource] || '📦';
        const resColor = RES_COLORS[r.resource] || '#94a3b8';
        html += '<div class="ledger-journal-item">';
        html += '<span class="journal-tick">t' + r.tick + '</span>';
        html += '<span class="journal-reason">⚰️ 继承</span>';
        html += '<span class="journal-res" style="color:' + resColor + ';">' + resIcon + ' ' + (r.amount || 0).toFixed(1) + '</span>';
        html += '<span class="journal-flow">' + esc(r.from || '—') + ' → ' + esc(r.to || '—') + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    if (isAbsent) {
      html += '<div class="ledger-absolve">🏛️ 绝嗣清算：无合法继承人，资产充入公仓兜底</div>';
    }
    html += '</div>';
    return html;
  }

  // ─── 公仓兜底余额卡片 ───────────────────────────────────────
  function renderPublicGranary(sim) {
    const el = document.getElementById('ledger-public-granary');
    if (!el) return;
    const bal = sim.publicGranaryBalances || {};
    const total = balTotal(bal);
    let html = '<div class="ledger-public-granary-card">';
    html += '<div class="pg-title">🏛️ 公仓兜底账本 <span class="pg-total">总额 ' + total.toFixed(1) + '</span></div>';
    html += '<div class="pg-balances">';
    ['Water', 'Food', 'Wood', 'Stone', 'Gold'].forEach(r => {
      html += '<span class="pg-bal-chip" style="color:' + RES_COLORS[r] + ';">' + RES_ICONS[r] + ' ' + (bal[r] || 0).toFixed(1) + '</span>';
    });
    html += '</div></div>';
    el.innerHTML = html;
  }

  // ─── 婚姻标签页渲染 ─────────────────────────────────────────
  function renderMarriageTab(sim) {
    const marriages = (sim.marriages || []).slice().sort((a, b) => b.id - a.id);
    const activeMG = marriages.filter(m => m.isActive);
    const endedMG = marriages.filter(m => !m.isActive);

    // 婚姻概览
    setText('ledger-mg-ov-active', activeMG.length);
    setText('ledger-mg-ov-total', marriages.length);
    setText('ledger-mg-ov-ended', endedMG.length);

    // 平均婚龄（存续婚姻）
    if (activeMG.length > 0 && sim.tickCount != null) {
      const avg = activeMG.reduce((s, m) => s + tickToSec(sim.tickCount - m.startTick), 0) / activeMG.length;
      setText('ledger-mg-ov-avg', fmtDur(avg));
    } else {
      setText('ledger-mg-ov-avg', '—');
    }

    const list = document.getElementById('ledger-marriage-list');
    if (!list) return;

    if (marriages.length === 0) {
      list.innerHTML = '<div class="ledger-empty">尚无婚姻登记</div>';
      return;
    }
    const shown = marriages.slice(0, 20);
    list.innerHTML = shown.map(m => {
      const husb = agentName(sim, m.husbandId);
      const wife = agentName(sim, m.wifeId);
      const status = m.isActive
        ? '<span style="color:#ec4899;">💍存续</span>'
        : '<span style="color:#64748b;">🕊️' + esc(m.endReason || '丧偶') + '</span>';
      const dur = m.isActive
        ? fmtDur(tickToSec((sim.tickCount || 0) - m.startTick))
        : (m.endTick ? fmtDur(tickToSec(m.endTick - m.startTick)) : '—');
      return '<div class="ledger-mg-item">'
        + '<span class="ledger-mg-id">💍 #' + m.id + '</span>'
        + '<span class="lineage-chip" data-agent-id="' + m.husbandId + '">' + esc(husb) + ' ♂</span>'
        + '<span style="color:#64748b;">×</span>'
        + '<span class="lineage-chip" data-agent-id="' + m.wifeId + '">' + esc(wife) + ' ♀</span>'
        + '<span class="ledger-mg-dur">' + dur + '</span>' + status
        + '</div>';
    }).join('');
    if (marriages.length > 20) {
      list.innerHTML += '<div class="ledger-hh-more">... 另有 ' + (marriages.length - 20) + ' 段未展示</div>';
    }
  }

  // ─── 宗族标签页渲染（M3） ────────────────────────────────────
  function renderClanTab(sim) {
    const clans = sim.clans || [];
    const ledClans = clans.filter(c => c.leaderId != null);
    const frozenClans = clans.filter(c => c.leaderId == null);
    const totalPop = clans.reduce((s, c) => s + (c.memberCount || 0), 0);

    setText('ledger-clan-ov-total', clans.length);
    setText('ledger-clan-ov-led', ledClans.length);
    setText('ledger-clan-ov-frozen', frozenClans.length);
    setText('ledger-clan-ov-pop', totalPop);

    const list = document.getElementById('ledger-clan-list');
    if (!list) return;

    if (clans.length === 0) {
      list.innerHTML = '<div class="ledger-empty">尚无宗族（族人按姓氏自动聚合）</div>';
      return;
    }

    // 按 member_count 降序，并列按 surname 字典序
    const sorted = clans.slice().sort((a, b) =>
      (b.memberCount || 0) - (a.memberCount || 0) ||
      (a.surname || '').localeCompare(b.surname || '')
    );

    const shown = sorted.slice(0, 20);
    list.innerHTML = shown.map(c => renderClanCard(sim, c)).join('');
    if (sorted.length > 20) {
      list.innerHTML += '<div class="ledger-hh-more">... 另有 ' + (sorted.length - 20) + ' 族未展示</div>';
    }
  }

  function renderClanCard(sim, clan) {
    const surname = esc(clan.surname || '?');
    const bal = clan.balances || {};
    const total = balTotal(bal);
    const hasLeader = clan.leaderId != null;
    const journalOpen = (journalClanSurname === clan.surname);
    const successionOpen = (successionExpandedSurname === clan.surname);
    const hhCount = countClanHouseholds(sim, clan);

    // ★ v1.9.0 Task11 绝嗣状态：所有男性已亡 → 标记绝嗣，族产已平分/入公仓，保留历史数据与账本流水
    const isExtinct = !!clan.isExtinct;
    let html = '<div class="clan-card' + (journalOpen ? ' clan-journal-open' : '') + (isExtinct ? ' clan-extinct' : '') + '" data-clan-surname="' + surname + '">';

    // ── 族徽 + 名号 + 族长 ──
    html += '<div class="clan-header">';
    html += '<span class="clan-emblem">' + (isExtinct ? '⛩️' : '🛡️') + '</span>';
    html += '<span class="clan-title">「' + surname + '」氏宗族</span>';
    if (isExtinct) {
      html += '<span class="clan-leader clan-extinct-badge">⛩️ 绝嗣 · 无在世男性</span>';
    } else if (hasLeader) {
      html += '<span class="clan-leader">👑 族长: <span class="lineage-chip" data-agent-id="' + clan.leaderId + '">' + esc(agentName(sim, clan.leaderId)) + '</span></span>';
    } else {
      html += '<span class="clan-leader clan-frozen">⚪ 宗族无主 · 账本冻结</span>';
    }
    html += '</div>';

    // ── 规模统计 ──
    html += '<div class="clan-stats">';
    html += '<span>👥 辖属 ' + hhCount + ' 户 / ' + (clan.memberCount || 0) + ' 人</span>';
    html += '<span class="clan-bal-total clan-bal-click" data-clan-bal="' + surname + '" title="点击查看最近流水">📒 ' + total.toFixed(1) + '</span>';
    html += '</div>';

    // ── 族库5类资源（可点击展开流水） ──
    html += '<div class="clan-balances clan-bal-click" data-clan-bal="' + surname + '">';
    ['Water', 'Food', 'Wood', 'Stone', 'Gold'].forEach(r => {
      html += '<span class="clan-bal-chip" style="color:' + RES_COLORS[r] + ';">' + RES_ICONS[r] + (bal[r] || 0).toFixed(0) + '</span>';
    });
    html += '</div>';

    // ── 族税进度条 ──
    const interval = (window.SIM_CONFIG && window.SIM_CONFIG.clanTributeIntervalTicks) || 1800;
    const rate = (window.SIM_CONFIG && window.SIM_CONFIG.clanTributeRate) || 0.05;
    const progress = ((sim.tickCount || 0) % interval) / interval;
    const percent = Math.round(progress * 100);
    html += '<div class="clan-tribute-bar">';
    html += '<div class="clan-tribute-label">📊 族税征缴率: ' + Math.round(rate * 100) + '% / 季 <span class="clan-tribute-pct">' + percent + '%</span></div>';
    html += '<div class="clan-tribute-track"><div class="clan-tribute-fill" style="width:' + percent + '%;"></div></div>';
    html += '</div>';

    // ── 互助救济气泡 ──
    const aidRecords = (clan.recentJournal || []).filter(r => r.reason === 'MutualAid');
    if (aidRecords.length > 0) {
      html += '<div class="clan-aid-bubble">';
      aidRecords.slice(0, 2).forEach(r => {
        const toFam = parseFamilyId(r.to);
        const resIcon = RES_ICONS[r.resource] || '📦';
        html += '<div class="clan-aid-item">🛡️ 宗族救济: 「' + surname + '」氏族库拨付 '
          + resIcon + '+' + (r.amount || 0).toFixed(1)
          + ' -> 极贫家户 #' + (toFam != null ? toFam : '?') + '</div>';
      });
      html += '</div>';
    }

    // ── 近期流水（Tribute/MutualAid 高亮，最多3笔） ──
    const recentClan = (clan.recentJournal || []).filter(r => r.reason === 'Tribute' || r.reason === 'MutualAid');
    if (recentClan.length > 0) {
      html += '<div class="clan-recent-journal">';
      recentClan.slice(0, 3).forEach(r => {
        const rIcon = REASON_ICONS[r.reason] || '📌';
        const rLabel = REASON_LABELS[r.reason] || r.reason;
        const resIcon = RES_ICONS[r.resource] || '📦';
        const resColor = RES_COLORS[r.resource] || '#94a3b8';
        html += '<div class="clan-journal-item">';
        html += '<span class="journal-tick">t' + r.tick + '</span>';
        html += '<span class="journal-reason" style="color:#10b981;">' + rIcon + ' ' + rLabel + '</span>';
        html += '<span class="journal-res" style="color:' + resColor + ';">' + resIcon + ' ' + (r.amount || 0).toFixed(1) + '</span>';
        html += '<span class="journal-flow">' + esc(r.from || '—') + ' → ' + esc(r.to || '—') + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    // ── 族长顺位（可展开） ──
    html += '<div class="clan-succession">';
    html += '<div class="clan-succession-toggle" data-clan-succession="' + surname + '">';
    html += '<span class="clan-succession-arrow">' + (successionOpen ? '▼' : '▶') + '</span>';
    html += '<span>👑 族长顺位继承人</span>';
    html += '</div>';
    if (successionOpen) {
      const heirs = getClanSuccession(sim, clan);
      html += '<div class="clan-succession-list">';
      if (heirs.length === 0) {
        html += '<div class="clan-succession-empty">无符合条件的男性继承人</div>';
      } else {
        heirs.forEach((h, i) => {
          const ageSec = tickToSec(h.age || 0);
          html += '<div class="clan-heir-item">';
          html += '<span class="clan-heir-rank">#' + (i + 1) + '</span>';
          html += '<span class="lineage-chip" data-agent-id="' + h.id + '">#' + h.id + '</span>';
          html += '<span class="clan-heir-age">(' + fmtDur(ageSec) + ')</span>';
          if (h.id === clan.leaderId) html += '<span class="clan-heir-current">现任族长</span>';
          html += '</div>';
        });
      }
      html += '</div>';
    }
    html += '</div>';

    // ── 宗族大事记 ──
    const events = clan.recentEvents || [];
    if (events.length > 0) {
      html += '<div class="ledger-hh-events">';
      events.slice(0, 2).forEach(e => {
        html += '<div class="ledger-event-item">' + esc(e) + '</div>';
      });
      html += '</div>';
    }

    // ── 流水抽屉 ──
    if (journalOpen) {
      html += renderClanJournalDrawer(clan);
    }

    html += '</div>';
    return html;
  }

  // ─── 宗族流水抽屉 ────────────────────────────────────────────
  function renderClanJournalDrawer(clan) {
    const journal = clan.recentJournal || [];
    let html = '<div class="ledger-journal-drawer">';
    html += '<div class="ledger-journal-header">';
    html += '<span>📒 「' + esc(clan.surname || '?') + '」氏宗族 · 最近流水（' + journal.length + '笔）</span>';
    html += '<button class="ledger-journal-close" data-clan-journal-close="' + esc(clan.surname || '') + '" title="关闭">✕</button>';
    html += '</div>';
    if (journal.length === 0) {
      html += '<div class="ledger-empty">暂无流水记录</div>';
    } else {
      html += '<div class="ledger-journal-list">';
      journal.slice(0, 8).forEach(r => {
        const rIcon = REASON_ICONS[r.reason] || '📌';
        const rLabel = REASON_LABELS[r.reason] || r.reason;
        const resIcon = RES_ICONS[r.resource] || '📦';
        const resColor = RES_COLORS[r.resource] || '#94a3b8';
        const isClanFlow = (r.reason === 'Tribute' || r.reason === 'MutualAid');
        html += '<div class="ledger-journal-item"' + (isClanFlow ? ' style="background:rgba(16,185,129,0.06);"' : '') + '>';
        html += '<span class="journal-tick">t' + r.tick + '</span>';
        html += '<span class="journal-reason" title="' + esc(r.reason) + '">' + rIcon + ' ' + rLabel + '</span>';
        html += '<span class="journal-res" style="color:' + resColor + ';">' + resIcon + ' ' + (r.amount || 0).toFixed(1) + '</span>';
        html += '<span class="journal-flow">' + esc(r.from || '—') + ' → ' + esc(r.to || '—') + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ─── 王国标签页渲染（M4） ────────────────────────────────────
  function renderRegionTab(sim) {
    const regions = sim.regions || [];
    const crowned = regions.filter(r => r.kingId != null);
    const vacant = regions.filter(r => r.kingId == null);
    const totalPop = regions.reduce((s, r) => s + (r.memberCount || 0), 0);
    const totalExped = regions.reduce((s, r) => s + (r.activeExpeditionAgents || []).length, 0);

    setText('ledger-region-ov-total', regions.length);
    setText('ledger-region-ov-crowned', crowned.length);
    setText('ledger-region-ov-vacant', vacant.length);
    setText('ledger-region-ov-pop', totalPop);
    setText('ledger-region-ov-exped', totalExped);

    const list = document.getElementById('ledger-region-list');
    if (!list) return;
    if (regions.length === 0) {
      list.innerHTML = '<div class="ledger-empty">尚无地区登记</div>';
      return;
    }
    // 按 camp_id 升序（5个营地固定顺序）
    const sorted = regions.slice().sort((a, b) => a.campId - b.campId);
    list.innerHTML = sorted.map(r => renderKingdomCard(sim, r)).join('');
  }

  function renderKingdomCard(sim, region) {
    const campName = esc(region.campName || ('营地#' + region.campId));
    const bal = region.balances || {};
    const total = balTotal(bal);
    const hasKing = region.kingId != null;
    const journalOpen = (journalRegionCampId === region.campId);
    const arrivalOpen = (regionArrivalExpanded === region.campId);
    const successionOpen = (regionSuccessionExpanded === region.campId);
    const expedAgents = region.activeExpeditionAgents || [];

    let html = '<div class="kingdom-card' + (journalOpen ? ' kingdom-journal-open' : '') + '" data-region-camp="' + region.campId + '">';
    // 王国名号 + 国王
    html += '<div class="kingdom-header"><span class="kingdom-emblem">🏛️</span><span class="kingdom-title">' + campName + '王国</span>';
    if (hasKing) {
      html += '<span class="kingdom-king">👑 国王: <span class="lineage-chip" data-agent-id="' + region.kingId + '">' + esc(agentName(sim, region.kingId)) + '</span></span>';
    } else {
      html += '<span class="kingdom-king kingdom-vacant">⚪ 王位空悬 · 群雄逐鹿</span>';
    }
    html += '</div>';
    // 政体/继承/规模
    html += '<div class="kingdom-stats"><span>政体: ' + esc(region.regime || 'Kingdom') + '</span><span>继承: ' + esc(region.succession || '长子继承制') + '</span><span>👥 辖属 ' + (region.memberCount || 0) + ' 人</span><span class="kingdom-bal-total kingdom-bal-click" data-region-bal="' + region.campId + '" title="点击查看公仓流水">📒 ' + total.toFixed(1) + '</span></div>';
    // 公仓5类资源（可点击展开流水）
    html += '<div class="kingdom-balances kingdom-bal-click" data-region-bal="' + region.campId + '">';
    ['Water', 'Food', 'Wood', 'Stone', 'Gold'].forEach(r => {
      html += '<span class="kingdom-bal-chip" style="color:' + RES_COLORS[r] + ';">' + RES_ICONS[r] + (bal[r] || 0).toFixed(0) + '</span>';
    });
    html += '</div>';
    // 公仓税进度条
    const taxInterval = (window.SIM_CONFIG && window.SIM_CONFIG.ledgerTaxIntervalTicks) || 2400;
    const taxRate = (window.SIM_CONFIG && window.SIM_CONFIG.ledgerTaxRate) || 0.03;
    const taxPct = Math.round((((sim.tickCount || 0) % taxInterval) / taxInterval) * 100);
    html += '<div class="kingdom-tax-bar"><div class="kingdom-tax-label">📊 公仓税率: ' + Math.round(taxRate * 100) + '% / 季 <span class="kingdom-tax-pct">' + taxPct + '%</span></div><div class="kingdom-tax-track"><div class="kingdom-tax-fill" style="width:' + taxPct + '%;"></div></div></div>';

    // 救济动态气泡
    const reliefRecords = (region.recentJournal || []).filter(r => r.reason === 'Relief');
    if (reliefRecords.length > 0) {
      html += '<div class="kingdom-relief-bubble">';
      reliefRecords.slice(0, 2).forEach(r => {
        const toFam = parseFamilyId(r.to);
        html += '<div class="kingdom-relief-item">👑 王室救济: ' + campName + '公仓拨付 ' + (RES_ICONS[r.resource] || '📦') + '+' + (r.amount || 0).toFixed(1) + ' -> 极贫家户 #' + (toFam != null ? toFam : '?') + '</div>';
      });
      html += '</div>';
    }
    // 到达时序（可展开）
    html += '<div class="kingdom-arrival"><div class="kingdom-arrival-toggle" data-region-arrival="' + region.campId + '"><span class="kingdom-arrow">' + (arrivalOpen ? '▼' : '▶') + '</span><span>📜 到达时序（始祖优先）</span></div>';
    if (arrivalOpen) {
      const arrivals = (region.arrivalOrder || []).slice(0, 5);
      html += '<div class="kingdom-arrival-list">';
      if (arrivals.length === 0) { html += '<div class="kingdom-empty">尚无到达记录</div>'; }
      else {
        arrivals.forEach((aid, i) => {
          const a = sim.getAgent ? sim.getAgent(aid) : null;
          html += '<div class="kingdom-arrival-item"><span class="kingdom-arrival-rank">#' + (i + 1) + '</span><span class="lineage-chip" data-agent-id="' + aid + '">#' + aid + '</span><span class="kingdom-arrival-tick">(tick ' + (a && a.arrivalTick != null ? a.arrivalTick : '?') + ')</span>' + (i === 0 ? '<span class="kingdom-founder-tag">始祖</span>' : '') + '</div>';
        });
      }
      html += '</div>';
    }
    html += '</div>';
    // 长子顺位链（可展开）
    html += '<div class="kingdom-succession"><div class="kingdom-succession-toggle" data-region-succession="' + region.campId + '"><span class="kingdom-arrow">' + (successionOpen ? '▼' : '▶') + '</span><span>👑 长子顺位继承人</span></div>';
    if (successionOpen) {
      const heirs = (region.heirCandidates || []).slice(0, 3);
      html += '<div class="kingdom-succession-list">';
      if (heirs.length === 0) { html += '<div class="kingdom-empty">无符合条件的继承人</div>'; }
      else {
        heirs.forEach((hid, i) => {
          const h = sim.getAgent ? sim.getAgent(hid) : null;
          const ageSec = h ? tickToSec(h.age || 0) : 0;
          let tag = '';
          if (hid === region.kingId) tag = '<span class="kingdom-heir-current">现任国王</span>';
          else if (i === 0 && hasKing) tag = '<span class="kingdom-heir-crown">王储</span>';
          html += '<div class="kingdom-heir-item"><span class="kingdom-heir-rank">#' + (i + 1) + '</span><span class="lineage-chip" data-agent-id="' + hid + '">#' + hid + '</span><span class="kingdom-heir-age">(' + fmtDur(ageSec) + ')</span>' + tag + '</div>';
        });
      }
      html += '</div>';
    }
    html += '</div>';

    // 夺位远征动态
    if (expedAgents.length > 0) {
      html += '<div class="kingdom-expedition"><div class="kingdom-expedition-title">⚔️ ' + expedAgents.length + ' 人正在远征夺位</div><div class="kingdom-expedition-list">';
      expedAgents.slice(0, 5).forEach(aid => { html += '<span class="lineage-chip" data-agent-id="' + aid + '">#' + aid + '</span> '; });
      if (expedAgents.length > 5) html += '<span style="color:#94a3b8;">... 共' + expedAgents.length + '人</span>';
      html += '</div></div>';
    }
    // 地区大事记
    const events = region.recentEvents || [];
    if (events.length > 0) {
      html += '<div class="ledger-hh-events">';
      events.slice(0, 2).forEach(e => {
        const isCor = /登基|加冕|国王/i.test(e);
        html += '<div class="ledger-event-item' + (isCor ? ' event-coronation' : '') + '">' + esc(e) + '</div>';
      });
      html += '</div>';
    }
    if (journalOpen) html += renderRegionJournalDrawer(region);
    html += '</div>';
    return html;
  }

  // 地区公仓流水抽屉
  function renderRegionJournalDrawer(region) {
    const journal = region.recentJournal || [];
    const campName = esc(region.campName || ('营地#' + region.campId));
    let html = '<div class="ledger-journal-drawer"><div class="ledger-journal-header"><span>📒 ' + campName + '王国 · 公仓最近流水（' + journal.length + '笔）</span><button class="ledger-journal-close" data-region-journal-close="' + region.campId + '" title="关闭">✕</button></div>';
    if (journal.length === 0) { html += '<div class="ledger-empty">暂无流水记录</div>'; }
    else {
      html += '<div class="ledger-journal-list">';
      journal.slice(0, 8).forEach(r => {
        const isRoyal = (r.reason === 'Tax' || r.reason === 'Relief');
        html += '<div class="ledger-journal-item"' + (isRoyal ? ' style="background:rgba(251,191,36,0.06);"' : '') + '><span class="journal-tick">t' + r.tick + '</span><span class="journal-reason" title="' + esc(r.reason) + '">' + (REASON_ICONS[r.reason] || '📌') + ' ' + (REASON_LABELS[r.reason] || r.reason) + '</span><span class="journal-res" style="color:' + (RES_COLORS[r.resource] || '#94a3b8') + ';">' + (RES_ICONS[r.resource] || '📦') + ' ' + (r.amount || 0).toFixed(1) + '</span><span class="journal-flow">' + esc(r.from || '—') + ' → ' + esc(r.to || '—') + '</span></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ─── 辅助：安全 setText ─────────────────────────────────────
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ─── 主更新入口（10FPS 节流由 render.js 保证） ─────────────
  function update(sim) {
    _simRef = sim;
    const panel = document.getElementById('ledger-panel');
    if (!panel) return;

    // 始终更新计数徽章（即使折叠）
    const households = sim.households || [];
    const activeHH = households.filter(h => !h.isDissolved);
    const countEl = document.getElementById('ledger-panel-count');
    if (countEl) countEl.textContent = activeHH.length + '户';

    // 折叠时跳过渲染
    if (panel.classList.contains('minimized')) return;

    if (activeTab === 'household') renderHouseholdTab(sim);
    else if (activeTab === 'marriage') renderMarriageTab(sim);
    else if (activeTab === 'clan') renderClanTab(sim);
    else if (activeTab === 'region') renderRegionTab(sim);
  }

  // ─── 事件委托 ───────────────────────────────────────────────
  function onDocumentClick(e) {
    // 标签页切换
    const tabBtn = e.target.closest('.ledger-tab-btn');
    if (tabBtn && !tabBtn.classList.contains('disabled')) {
      switchTab(tabBtn.dataset.tab);
      return;
    }
    // 流水抽屉关闭（家户）
    const closeBtn = e.target.closest('[data-journal-close]');
    if (closeBtn) {
      e.stopPropagation();
      const id = parseInt(closeBtn.dataset.journalClose, 10);
      if (journalHHId === id) journalHHId = null;
      if (_simRef) update(_simRef);
      return;
    }
    // 宗族流水抽屉关闭
    const clanCloseBtn = e.target.closest('[data-clan-journal-close]');
    if (clanCloseBtn) {
      e.stopPropagation();
      const sn = clanCloseBtn.dataset.clanJournalClose;
      if (journalClanSurname === sn) journalClanSurname = null;
      if (_simRef) update(_simRef);
      return;
    }
    // 点击账面余额区域 → 切换流水抽屉（存续家户）
    const balClick = e.target.closest('[data-hh-bal]');
    if (balClick) {
      e.stopPropagation();
      const id = parseInt(balClick.dataset.hhBal, 10);
      const hh = (_simRef ? (_simRef.households || []).find(h => h.id === id) : null);
      if (hh && !hh.isDissolved) {
        journalHHId = (journalHHId === id) ? null : id;
        if (_simRef) update(_simRef);
      }
      return;
    }
    // 点击族库余额区域 → 切换宗族流水抽屉
    const clanBalClick = e.target.closest('[data-clan-bal]');
    if (clanBalClick) {
      e.stopPropagation();
      const sn = clanBalClick.dataset.clanBal;
      journalClanSurname = (journalClanSurname === sn) ? null : sn;
      if (_simRef) update(_simRef);
      return;
    }
    // 点击族长顺位 → 展开/收起
    const successionClick = e.target.closest('[data-clan-succession]');
    if (successionClick) {
      e.stopPropagation();
      const sn = successionClick.dataset.clanSuccession;
      successionExpandedSurname = (successionExpandedSurname === sn) ? null : sn;
      if (_simRef) update(_simRef);
      return;
    }
    // ★ M4: 地区公仓流水抽屉关闭
    const regionCloseBtn = e.target.closest('[data-region-journal-close]');
    if (regionCloseBtn) {
      e.stopPropagation();
      const cid = parseInt(regionCloseBtn.dataset.regionJournalClose, 10);
      if (journalRegionCampId === cid) journalRegionCampId = null;
      if (_simRef) update(_simRef);
      return;
    }
    // ★ M4: 点击公仓余额 → 切换地区流水抽屉
    const regionBalClick = e.target.closest('[data-region-bal]');
    if (regionBalClick) {
      e.stopPropagation();
      const cid = parseInt(regionBalClick.dataset.regionBal, 10);
      journalRegionCampId = (journalRegionCampId === cid) ? null : cid;
      if (_simRef) update(_simRef);
      return;
    }
    // ★ M4: 到达时序展开/收起
    const regionArrivalClick = e.target.closest('[data-region-arrival]');
    if (regionArrivalClick) {
      e.stopPropagation();
      const cid = parseInt(regionArrivalClick.dataset.regionArrival, 10);
      regionArrivalExpanded = (regionArrivalExpanded === cid) ? null : cid;
      if (_simRef) update(_simRef);
      return;
    }
    // ★ M4: 长子顺位展开/收起
    const regionSuccessionClick = e.target.closest('[data-region-succession]');
    if (regionSuccessionClick) {
      e.stopPropagation();
      const cid = parseInt(regionSuccessionClick.dataset.regionSuccession, 10);
      regionSuccessionExpanded = (regionSuccessionExpanded === cid) ? null : cid;
      if (_simRef) update(_simRef);
      return;
    }
    // 点击已解散家户卡片 → 切换继承档案
    const hhItem = e.target.closest('.ledger-hh-item.ledger-dissolved');
    if (hhItem) {
      const id = parseInt(hhItem.dataset.hhId, 10);
      // 不拦截 lineage-chip 点击
      if (e.target.closest('.lineage-chip')) return;
      dissolvedExpandedId = (dissolvedExpandedId === id) ? null : id;
      if (_simRef) update(_simRef);
      return;
    }
  }

  // ─── 初始化 ──────────────────────────────────────────────────
  function init() {
    document.addEventListener('click', onDocumentClick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ─── 暴露全局 ────────────────────────────────────────────────
  window.LedgerUI = { update, switchTab };
})();
