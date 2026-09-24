// ★ v1.12.0 营地辖区详情模态（自 render_inspector.js 拆出）
// ══════════ 🏛️ 营地辖区详情模态框 (v1.12.0) ══════════
(function () {
  const TICK_PER_SEC = 60; // 60 ticks = 1 游戏小时
  let currentCampPoi = null;

  function fmtDuration(ticks) {
    if (!ticks || ticks <= 0) return '—';
    const hours = Math.floor(ticks / TICK_PER_SEC);
    if (hours < 1) return ticks + ' tick';
    if (hours < 24) return hours + '小时';
    const days = Math.floor(hours / 24);
    const rem = hours % 24;
    return rem > 0 ? `${days}天${rem}小时` : `${days}天`;
  }

  function agentChip(id, cls, title) {
    if (window.EntityLink) return window.EntityLink.agent(id, `${cls === 'dead' ? '💀' : '👤'} #${id}`, { className: cls, title });
    return `<span class="lineage-chip ${cls || ''}" data-agent-id="${id}" title="${title || '点击追踪'}">${cls === 'dead' ? '💀' : '👤'} #${id}</span>`;
  }

  function renderCampDetail() {
    if (!currentCampPoi) return;
    const sim = window.rustWorldSim;
    const poi = currentCampPoi;
    const region = (sim.regions || []).find(r => r.campId === poi.id);
    const backdrop = document.getElementById('camp-detail-backdrop');
    if (!backdrop) return;

    document.getElementById('camp-detail-title').textContent = `🏛️ ${poi.campTitle || poi.name} · 辖区详情`;

    // 国王
    const kingEl = document.getElementById('camp-detail-king');
    if (region && region.kingId != null) {
      const reignSecs = region.currentReignStart != null ? fmtDuration(sim.tickCount - region.currentReignStart) : '—';
      const nextHtml = `${agentChip(region.kingId, '', '点击追踪国王视角')} <span style="color:#94a3b8;font-size:11px;">· 在位 ${reignSecs}</span>`;
      if (kingEl && kingEl.innerHTML !== nextHtml) kingEl.innerHTML = nextHtml;
    } else if (kingEl) {
      const nextHtml = '<span style="color:#ef4444;">王位空缺（可被夺位）</span>';
      if (kingEl.innerHTML !== nextHtml) kingEl.innerHTML = nextHtml;
    }

    // 继承人
    const heirEl = document.getElementById('camp-detail-heir');
    const heirs = region ? (region.heirCandidates || []) : [];
    if (heirs.length > 0) {
      const nextHtml = heirs.map((hid, i) =>
        `${i === 0 ? '🫅 第一顺位：' : ''}${agentChip(hid, '', '点击追踪继承人')}`
      ).join('  ');
      if (heirEl && heirEl.innerHTML !== nextHtml) heirEl.innerHTML = nextHtml;
    } else if (heirEl) {
      const nextHtml = '— 无明确继承人（绝嗣风险）';
      if (heirEl.textContent !== nextHtml) heirEl.textContent = nextHtml;
    }

    // 历史国王（含在位时长与死因）
    const histEl = document.getElementById('camp-detail-hist-kings');
    const hks = region ? (region.historyKings || []) : [];
    if (hks.length > 0) {
      const nextHtml = hks.map(hk => {
        const dur = fmtDuration(hk.reignEndTick - hk.reignStartTick);
        const cause = hk.deathCause ? ` · 💀 ${hk.deathCause}` : ' · 被废黜/仍在世';
        return `<div style="margin-bottom:2px;">${agentChip(hk.agentId, 'dead', '点击查看先祖')} <span style="color:#94a3b8;font-size:11px;">在位 ${dur}${cause}</span></div>`;
      }).join('');
      if (histEl && histEl.innerHTML !== nextHtml) histEl.innerHTML = nextHtml;
    } else if (histEl) {
      const nextHtml = '— 暂无历史国王记录';
      if (histEl.textContent !== nextHtml) histEl.textContent = nextHtml;
    }

    // 管辖家庭
    const govEl = document.getElementById('camp-detail-governed');
    const ghs = region ? (region.governedHouseholds || []) : [];
    if (ghs.length > 0) {
      const nextHtml = ghs.map(hid => {
        const hh = (sim.households || []).find(h => h.id === hid);
        const n = hh && hh.members ? hh.members.length : '?';
        const head = hh && hh.headId != null ? `户主#${hh.headId}` : '';
        return `<span style="display:inline-block;margin:1px 4px 1px 0;">🏠 #${hid} (${n}人${head ? ' · ' + head : ''})</span>`;
      }).join('');
      if (govEl && govEl.innerHTML !== nextHtml) govEl.innerHTML = nextHtml;
    } else if (govEl) {
      const nextHtml = '— 暂无管辖家庭';
      if (govEl.textContent !== nextHtml) govEl.textContent = nextHtml;
    }

    // 辖区房屋：从实时房屋快照分为全部空置与已有人居住，避免只展示 vacant_houses 登记表。
    const vacEl = document.getElementById('camp-detail-vacant');
    const occEl = document.getElementById('camp-detail-occupied');
    const campHouses = (sim.houses || []).filter(h => h.campId === poi.id);
    const vacantHouses = campHouses.filter(h => h.ownerId == null);
    const occupiedHouses = campHouses.filter(h => h.ownerId != null);
    const vacantById = new Map((poi.vacantHouses || []).map(vh => [vh.houseId, vh]));
    const tierNames = { Tier0Warehouse: '仓库', Tier1ThatchedHut: '茅草房', Tier2LeanTo: '半棚屋', Tier3Homestead: '庄舍', Tier4Manor: '大庄园' };
    if (vacantHouses.length > 0) {
      const nextVacHtml = `<div style="color:#f59e0b;margin-bottom:2px;">🏚️ 空置（${vacantHouses.length}）</div>` + vacantHouses.map(h => {
        const vh = vacantById.get(h.id);
        const ben = vh && vh.beneficiaryIds && vh.beneficiaryIds.length > 0
          ? ` · 受益人 ${vh.beneficiaryIds.map(bid => `#${bid}`).join('、')}` : '';
        const auction = h.auctionPhase ? ` · ${h.auctionPhase}` : '';
        return `<div style="margin-bottom:2px;">🏚️ #${h.id} ${tierNames[h.tier] || h.tier} · 耐久 ${Math.round(h.durability)}%${auction}${ben}</div>`;
      }).join('');
      if (vacEl && vacEl.innerHTML !== nextVacHtml) vacEl.innerHTML = nextVacHtml;
    } else if (vacEl) {
      const nextVacHtml = '<div style="color:#94a3b8;">🏚️ 空置（0）</div>';
      if (vacEl.innerHTML !== nextVacHtml) vacEl.innerHTML = nextVacHtml;
    }
    if (occupiedHouses.length > 0) {
      const nextOccHtml = `<div style="color:#38bdf8;margin-bottom:2px;">🏠 已有人居住（${occupiedHouses.length}）</div>` + occupiedHouses.map(h =>
        `<div style="margin-bottom:2px;">🏠 #${h.id} ${tierNames[h.tier] || h.tier} · 户主 #${h.ownerId} · 耐久 ${Math.round(h.durability)}%</div>`
      ).join('');
      if (occEl && occEl.innerHTML !== nextOccHtml) occEl.innerHTML = nextOccHtml;
    } else if (occEl) {
      const nextOccHtml = '<div style="color:#94a3b8;">🏠 已有人居住（0）</div>';
      if (occEl.innerHTML !== nextOccHtml) occEl.innerHTML = nextOccHtml;
    }

    // 王国账本
    if (region) {
      const resMap = { Water: 'camp-detail-ledger-water', Food: 'camp-detail-ledger-food', Wood: 'camp-detail-ledger-wood', Stone: 'camp-detail-ledger-stone', Gold: 'camp-detail-ledger-gold' };
      for (const rk of Object.keys(resMap)) {
        const el = document.getElementById(resMap[rk]);
        if (el) el.textContent = ((region.balances && region.balances[rk]) || 0).toFixed(1);
      }
      const jEl = document.getElementById('camp-detail-ledger-journal');
      if (jEl) {
        const jn = (region.recentJournal || []).slice(0, 6);
        if (jn.length > 0) {
          const reasonZh = { 'Tax': '公仓税', 'Relief': '王室救济', 'Legacy': '绝嗣归并', 'Tribute': '族税', 'Split': '分家', 'Inheritance': '继承', 'HousingPurchase': '房屋拍卖' };
          const nextJournalHtml = jn.map(r => `<div>· ${reasonZh[r.reason] || r.reason} ${r.resource || ''} ${(r.amount || 0).toFixed(1)}${r.tick != null ? ' (Tick ' + r.tick + ')' : ''}</div>`).join('');
          if (jEl.innerHTML !== nextJournalHtml) jEl.innerHTML = nextJournalHtml;
        } else {
          if (jEl.textContent !== '暂无流水记录') jEl.textContent = '暂无流水记录';
        }
      }
    }
  }

  function openCampDetail(poi) {
    currentCampPoi = poi;
    renderCampDetail();
    const backdrop = document.getElementById('camp-detail-backdrop');
    if (backdrop) backdrop.style.display = 'flex';
  }

  function closeCampDetail() {
    currentCampPoi = null;
    const backdrop = document.getElementById('camp-detail-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  }

  function isCampDetailOpen() {
    const backdrop = document.getElementById('camp-detail-backdrop');
    return !!backdrop && backdrop.style.display !== 'none';
  }
  window.closeCampDetail = closeCampDetail;
  window.isCampDetailOpen = isCampDetailOpen;

  // 事件绑定：详情按钮与国库点击（在营地渲染时动态存在，用事件委托）
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#btn-camp-detail, #insp-camp-treasury-box');
    if (btn) {
      const sim = window.rustWorldSim;
      if (sim && sim.selectionType === 'poi' && sim.selectedPoiId != null) {
        const poi = sim.pois.find(p => p.id === sim.selectedPoiId);
        if (poi) openCampDetail(poi);
      }
    }
  });

  // ★ v1.37.2 点击营地卡片国王快速跳转角色卡片（兜底保障）
  document.addEventListener('click', (e) => {
    const kingChip = e.target.closest('#insp-camp-king .lineage-chip, #insp-camp-king [data-agent-id], #insp-camp-king [data-entity-id]');
    if (kingChip) {
      const agentId = kingChip.getAttribute('data-entity-id') || kingChip.getAttribute('data-agent-id');
      if (agentId != null && typeof window.focusOnAgent === 'function') {
        window.focusOnAgent(agentId);
      }
    }
  });

  // 事件绑定：房屋报价档案展开/折叠
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#btn-toggle-house-bids');
    if (btn) {
      const content = document.getElementById('insp-house-archive-content');
      if (content) {
        content.style.display = (content.style.display === 'none') ? 'block' : 'none';
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.id === 'camp-detail-backdrop') closeCampDetail();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('camp-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeCampDetail);
  });

  // Esc 关闭（捕获阶段，避免与 Inspector 关闭冲突）
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isCampDetailOpen()) {
      closeCampDetail();
      e.stopPropagation();
    }
  }, true);

  // 每帧刷新详情框内容（如果打开着）
  window._campDetailTick = function () {
    if (isCampDetailOpen() && currentCampPoi) {
      const sim = window.rustWorldSim;
      const poi = sim.pois.find(p => p.id === currentCampPoi.id);
      if (poi) { currentCampPoi = poi; renderCampDetail(); }
    }
  };
})();
