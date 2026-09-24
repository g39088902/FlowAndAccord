// === Inspector 家族血脉与世系族谱渲染（自 render_inspector.js 拆出；由 updateAgentInspector 调用） ===
// 兼容父亲、母亲、配偶与子嗣 chips、威望值、族谱模态自身卡片与先天禀赋 traits。
function updateAgentLineage(selAgent) {
    const fatherElem = document.getElementById('insp-lineage-father');
    if (fatherElem) {
      if (selAgent.fatherId) {
        const fAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(selAgent.fatherId) : sim.agents.find(a => a.id === selAgent.fatherId);
        const fAlive = fAgent && fAgent.isAlive;
        const fGen = fAgent ? (fAgent.generation || 1) : 1;
        const fHtml = `<span class="lineage-chip ${fAlive ? '' : 'dead'}" data-agent-id="${selAgent.fatherId}" title="点击追踪父亲视角 (第${fGen}代)">👨 父亲 #${selAgent.fatherId} (第${fGen}代) ${fAlive ? '🟢' : '💀'}</span>`;
        if (fatherElem.innerHTML !== fHtml) fatherElem.innerHTML = fHtml;
      } else {
        const fHtml = `<span style="color:#64748b;">— (开局始祖代)</span>`;
        if (fatherElem.innerHTML !== fHtml) fatherElem.innerHTML = fHtml;
      }
    }

    const motherElem = document.getElementById('insp-lineage-mother');
    if (motherElem) {
      if (selAgent.motherId) {
        const mAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(selAgent.motherId) : sim.agents.find(a => a.id === selAgent.motherId);
        const mAlive = mAgent && mAgent.isAlive;
        const mGen = mAgent ? (mAgent.generation || 1) : 1;
        const mHtml = `<span class="lineage-chip female ${mAlive ? '' : 'dead'}" data-agent-id="${selAgent.motherId}" title="点击追踪母亲视角 (第${mGen}代)">👩 母亲 #${selAgent.motherId} (第${mGen}代) ${mAlive ? '🟢' : '💀'}</span>`;
        if (motherElem.innerHTML !== mHtml) motherElem.innerHTML = mHtml;
      } else {
        const mHtml = `<span style="color:#64748b;">— (开局始祖代)</span>`;
        if (motherElem.innerHTML !== mHtml) motherElem.innerHTML = mHtml;
      }
    }

    const spouseElem = document.getElementById('insp-lineage-spouse');
    if (spouseElem) {
      if (selAgent.spouseId) {
        const sAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(selAgent.spouseId) : sim.agents.find(a => a.id === selAgent.spouseId);
        const sAlive = sAgent && sAgent.isAlive;
        const isHusband = sAgent && sAgent.gender === 'male';
        const sGen = sAgent ? (sAgent.generation || 1) : 1;
        const sHtml = `<span class="lineage-chip ${isHusband ? '' : 'female'} ${sAlive ? '' : 'dead'}" data-agent-id="${selAgent.spouseId}" title="点击追踪配偶视角 (第${sGen}代)">💍 ${isHusband ? '丈夫' : '妻子'} #${selAgent.spouseId} (第${sGen}代) ${sAlive ? '🟢' : '💀'}</span>`;
        if (spouseElem.innerHTML !== sHtml) spouseElem.innerHTML = sHtml;
      } else {
        const sHtml = `<span style="color:#64748b;">未婚单身</span>`;
        if (spouseElem.innerHTML !== sHtml) spouseElem.innerHTML = sHtml;
      }
    }

    const houseElem = document.getElementById('insp-lineage-house');
    if (houseElem) {
      if (selAgent.homeHouseId) {
        const myH = sim.houses.find(h => h.id === selAgent.homeHouseId);
        const tierName = myH ? ({
          'Tier0Warehouse': '0级仓库',
          'Tier1ThatchedHut': '1级茅草房',
          'Tier2LeanTo': '2级半棚屋',
          'Tier3Homestead': '3级木石庄舍',
          'Tier4Manor': '4级大庄园'
        }[myH.tier] || '私宅') : '私宅';
        // ★ v1.9.0 点击房屋 → 跳转房屋卡片（Task8）
        const hHtml = `<span class="lineage-chip house" data-house-id="${selAgent.homeHouseId}" style="color:#38bdf8; font-weight:600;" title="点击跳转到房屋卡片 #${selAgent.homeHouseId}">🏠 #${selAgent.homeHouseId} (${tierName})</span>`;
        if (houseElem.innerHTML !== hHtml) houseElem.innerHTML = hHtml;
      } else {
        const hHtml = `<span style="color:#64748b;">居于营地 (无私宅)</span>`;
        if (houseElem.innerHTML !== hHtml) houseElem.innerHTML = hHtml;
      }
    }

    const childrenElem = document.getElementById('insp-lineage-children');
    const childrenCountElem = document.getElementById('insp-lineage-children-count');
    if (childrenElem) {
      if (selAgent.children && selAgent.children.length > 0) {
        let cHtml = '';
        for (const cId of selAgent.children) {
          const cAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(cId) : sim.agents.find(a => a.id === cId);
          const cAlive = cAgent && cAgent.isAlive;
          const isFem = cAgent && cAgent.gender === 'female';
          const isFetus = !!(cAgent && cAgent.isFetus);
          const cGen = cAgent ? (cAgent.generation || (selAgent.generation ? selAgent.generation + 1 : 2)) : (selAgent.generation ? selAgent.generation + 1 : 2);
          const cSurname = cAgent && cAgent.surname ? `【${cAgent.surname}】` : '';
          // ★ M1.7 腹中胎儿在子嗣栏中以 👶 标记
          cHtml += `<span class="lineage-chip ${isFem ? 'female' : ''} ${cAlive ? '' : 'dead'}" data-agent-id="${cId}" title="${isFetus ? '腹中胎儿 · 点击查看胎儿卡片' : '点击追踪第' + cGen + '代子嗣 #' + cId}">${isFetus ? '👶' : (isFem ? '👧' : '👦')} ${cSurname}#${cId} ${isFetus ? '(腹中胎儿)' : '(第' + cGen + '代)'} ${cAlive ? '🟢' : '💀'}</span>`;
        }
        if (childrenElem.innerHTML !== cHtml) childrenElem.innerHTML = cHtml;
        if (childrenCountElem) childrenCountElem.textContent = `共 ${selAgent.children.length} 位后代`;
      } else {
        const cHtml = `<span style="color:#64748b;">暂无子女</span>`;
        if (childrenElem.innerHTML !== cHtml) childrenElem.innerHTML = cHtml;
        if (childrenCountElem) childrenCountElem.textContent = `0 位后代`;
      }
    }

    // 🌟 威望值展示（所有影响因子的综合集合体：子嗣 + 宅邸等级 + 国王/宗族长老等）
    const prestigeElem = document.getElementById('insp-prestige-val');
    if (prestigeElem) {
      const prestige = selAgent.prestige || 0;
      prestigeElem.textContent = prestige > 0
        ? `🌟 威望 ${prestige}`
        : '暂无威望';
      prestigeElem.title = '威望构成：子嗣活产父母各+1、私宅每晋升一级户主+1、担任国王+3、担任宗族长老+3';
      prestigeElem.style.color = prestige >= 5 ? '#fbbf24' : (prestige > 0 ? '#a78bfa' : '#64748b');
    }

    // 弹窗头部与自身卡片更新
    const modalTitle = document.getElementById('lineage-modal-title');
    if (modalTitle) {
      const clanPrefix = selAgent.surname ? `${selAgent.surname}氏 · ` : '';
      modalTitle.textContent = `${clanPrefix}部落民 #${selAgent.id} 详细档案与族谱`;
    }
    const selfName = document.getElementById('lineage-self-name');
    if (selfName) {
      const clanLabel = selAgent.surname ? `【${selAgent.surname}】氏 ` : '';
      selfName.textContent = `${clanLabel}部落民 #${selAgent.id}`;
    }
    const selfGender = document.getElementById('lineage-self-gender');
    if (selfGender) {
      const isFem = selAgent.gender === 'female';
      selfGender.textContent = isFem ? '♀ 女性' : '♂ 男性';
      selfGender.className = `lineage-badge-gender ${isFem ? 'female' : 'male'}`;
    }
    const selfAvatar = document.getElementById('lineage-self-avatar');
    if (selfAvatar) {
      const isAlive = selAgent.isAlive;
      const isFem = selAgent.gender === 'female';
      selfAvatar.textContent = !isAlive ? '💀' : (isFem ? (selAgent.isPregnant ? '🤰' : '👩') : '👦');
      selfAvatar.className = `lineage-self-avatar ${!isAlive ? 'dead' : (isFem ? 'female' : 'male')}`;
    }
    const selfGen = document.getElementById('lineage-self-gen');
    if (selfGen) {
      const genNum = selAgent.generation && selAgent.generation >= 1 ? selAgent.generation : ((selAgent.fatherId || selAgent.motherId) ? 2 : 1);
      selfGen.textContent = genNum === 1 ? '始祖第1代' : `第${genNum}代`;
    }
    const selfStatus = document.getElementById('lineage-self-status');
    if (selfStatus) {
      const hVal = selAgent.health !== undefined ? selAgent.health.toFixed(1) : '—';
      const isLowHealth = selAgent.health !== undefined && selAgent.health < 40;
      const isLowHunger = selAgent.hunger !== undefined && selAgent.hunger < 30;
      const isLowStamina = selAgent.stamina !== undefined && selAgent.stamina < 25;
      const sHtml = `
        <div class="vital-item" title="存活年龄 (小时)">
          <span class="vital-label">⏳ 年龄</span>
          <span class="vital-value">${Math.floor(selAgent.age)}小时</span>
        </div>
        <div class="vital-item ${isLowHealth ? 'vital-warn' : ''}" title="生命健康度 (0~100)">
          <span class="vital-label">❤️ 健康</span>
          <span class="vital-value" style="color:${isLowHealth ? '#f87171' : '#34d399'};">${hVal}</span>
        </div>
        <div class="vital-item ${isLowHunger ? 'vital-warn' : ''}" title="饱食度 (0~100)">
          <span class="vital-label">🍖 饱食</span>
          <span class="vital-value" style="color:${isLowHunger ? '#fbbf24' : '#38bdf8'};">${Math.round(selAgent.hunger)}</span>
        </div>
        <div class="vital-item ${isLowStamina ? 'vital-warn' : ''}" title="体力精力 (0~100%)">
          <span class="vital-label">⚡ 体力</span>
          <span class="vital-value" style="color:${isLowStamina ? '#fb923c' : '#a78bfa'};">${Math.round(selAgent.stamina)}%</span>
        </div>
      `;
      if (selfStatus.innerHTML !== sHtml) selfStatus.innerHTML = sHtml;
    }
    const selfNeedBadge = document.getElementById('lineage-self-need-badge');
    if (selfNeedBadge) {
      if (!selAgent.isAlive) {
        const cause = selAgent.deathCause || '寿终正寝';
        selfNeedBadge.textContent = `💀 已故 · ${cause}`;
        selfNeedBadge.style.color = '#94a3b8';
        selfNeedBadge.style.borderColor = 'rgba(148, 163, 184, 0.35)';
        selfNeedBadge.style.background = 'rgba(148, 163, 184, 0.12)';
      } else {
        const parsed = parseMaslowNeed(selAgent.currentNeed, selAgent);
        if (parsed) {
          selfNeedBadge.textContent = parsed.badgeText || `${parsed.icon} ${parsed.name} · ${parsed.kindLabel}`;
          selfNeedBadge.style.color = parsed.color;
          selfNeedBadge.style.borderColor = `${parsed.color}55`;
          selfNeedBadge.style.background = `${parsed.color}1f`;
        } else {
          const restText = selAgent.state === 'RestingAtCamp'
            ? (selAgent.homeHouseId ? '🏡 闲适安居' : '🏕️ 营地休养')
            : '🟢 活跃中';
          selfNeedBadge.textContent = restText;
          selfNeedBadge.style.color = '#10b981';
          selfNeedBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          selfNeedBadge.style.background = 'rgba(16, 185, 129, 0.12)';
        }
      }
    }

    // 🧬 先天禀赋属性 (族谱页 · 遗传记录仅展示): 始祖 N(100,20) 正态 / 后代父母均值±10
    const traitsElem = document.getElementById('lineage-self-traits');
    if (traitsElem && typeof selAgent.intelligence === 'number') {
      const traitDefs = [
        { label: '🧠 智力', key: 'intelligence', color: '#38bdf8' },
        { label: '💪 力量', key: 'strength', color: '#ef4444' },
        { label: '❤️‍🔥 魅力', key: 'libido', color: '#ec4899' },
        { label: '🍽️ 消化效率', key: 'digestionEfficiency', color: '#f59e0b' },
        { label: '😴 睡眠效率', key: 'sleepEfficiency', color: '#a78bfa' },
        { label: '⏳ 预期寿命', key: 'lifeExpectancy', color: '#10b981' },
      ];
      let tHtml = '';
      for (const t of traitDefs) {
        const v = selAgent[t.key];
        const pct = Math.max(0, Math.min(100, (v / 200) * 100)); // 10~190 映射 5%~95% 刻度
        tHtml += `<div class="lineage-trait" title="${t.label} (遗传记录；消化效率/睡眠效率已参与行为结算)">
          <div class="meter-label"><span>${t.label}</span><span style="color:${t.color}; font-weight:700;">${Math.round(v)}</span></div>
          <div class="meter-bg"><div class="meter-fill" style="background:${t.color}; width:${pct}%;"></div></div>
        </div>`;
      }
      if (traitsElem.innerHTML !== tHtml) traitsElem.innerHTML = tHtml;
    }
    const traitsSource = document.getElementById('lineage-traits-source');
    if (traitsSource) {
      const hasParents = selAgent.fatherId || selAgent.motherId;
      traitsSource.textContent = hasParents ? '父母均值 ±10 遗传' : '始祖 N(100,20) 正态';
    }
}
