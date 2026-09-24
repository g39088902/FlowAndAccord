// === Inspector 房屋视图面板（自 render_inspector.js 拆出；由调度层传入 views 解构） ===
function updateHouseInspector(house, views) {
  const { agentView, poiView, houseView, followBtn } = views;
    agentView.style.display = 'none';
    poiView.style.display = 'none';
    houseView.style.display = 'flex';
    if (followBtn) followBtn.style.display = 'none';

    // ★ v1.12.0 恢复营地视图可能隐藏的元素
    const tsHouse = document.getElementById('insp-title-state');
    if (tsHouse) tsHouse.style.display = '';
    const dtHouse = document.getElementById('insp-detail-text');
    if (dtHouse) dtHouse.style.display = '';
    const pibHouse = document.getElementById('insp-poi-info-badge');
    if (pibHouse) pibHouse.style.display = '';
    const mbHouse = document.getElementById('insp-market-box');
    if (mbHouse) mbHouse.style.display = 'none';

    const isWarehouse = house.tier === 'Tier0Warehouse';
    let tierTitle = '📦 0级 仓库';
    if (house.tier === 'Tier1ThatchedHut') tierTitle = '🛖 1级 茅草房';
    else if (house.tier === 'Tier2LeanTo') tierTitle = '🏡 2级 私宅';
    else if (house.tier === 'Tier3Homestead') tierTitle = '🏯 3级 木石庄舍';
    else if (house.tier === 'Tier4Manor') tierTitle = '🏰 4级 家族大庄园';

    document.getElementById('insp-title-name').textContent = `${tierTitle} #${house.id}`;

    let stateText = '🌿 私人居所';
    const isVacant = house.ownerId == null;
    if (isVacant) {
      stateText = '🏚️ 无主空置房 (正常风化中)';
    } else if (house.isRepairing) {
      stateText = `🔧 族人劳作修缮中 (${Math.round(house.durability)}%)`;
    } else {
      stateText = isWarehouse ? '🏠 起步营地' : (house.tier === 'Tier4Manor' ? '🏰 4级氏族大庄园' : '🏡 安居宅邸');
    }
    document.getElementById('insp-title-state').textContent = stateText;
    document.getElementById('insp-title-state').style.color = isVacant ? '#94a3b8' : (house.isRepairing ? '#38bdf8' : (isWarehouse ? '#f59e0b' : '#10b981'));

    const durPct = Math.round(house.durability);
    document.getElementById('insp-house-dur-val').textContent = `${durPct}% (${isVacant ? '无主正常风化中' : (house.isRepairing ? '族人修缮回血中' : (durPct < 85 ? '需修缮' : '稳固使用中'))})`;
    document.getElementById('insp-house-dur-fill').style.width = `${durPct}%`;
    document.getElementById('insp-house-dur-fill').style.background = durPct < 30 ? '#ef4444' : (durPct < 85 ? '#f59e0b' : '#10b981');
    // ★ v1.9.0 房屋耐久/修缮变化速度（按游戏秒；Task1 进度条悬停）
    const durRate = _meterRateTracker.push('dur' + house.id, house.durability, _gameDt());
    const durFillEl = document.getElementById('insp-house-dur-fill');
    if (durFillEl) {
      let durHint = '耐久变化 ' + _fmtRate(durRate);
      if (isVacant) durHint = '🏚️ 无主空置房 · 正常风化 ' + _fmtRate(durRate);
      else if (house.isRepairing) durHint = '🔧 修缮回血中 · 每小时变化 ' + _fmtRate(durRate);
      durFillEl.title = durHint;
    }

    // ★ M6 家庭储备展示（唯一真相源 = 户主家户账本；房屋不再持有仓库）
    // ★ v1.10.0 无主空置房（ownerId==null）无家户账本，跳过储备展示
    const ownerAgentRef = (house.ownerId != null && typeof sim.getAgent === 'function') ? sim.getAgent(house.ownerId) : (house.ownerId != null ? sim.agents.find(a => a.id === house.ownerId) : null);
    const ownerHousehold = (house.ownerId != null && typeof sim.getHouseholdOfAgent === 'function') ? sim.getHouseholdOfAgent(house.ownerId)
      : (house.ownerId != null ? (sim.households.find(hh2 => hh2.head === house.ownerId || (hh2.members || []).includes(house.ownerId)) || null) : null);
    const hhBal = (ownerHousehold && ownerHousehold.balances) || {};
    // ★ M8 储备条改纯数值：账本余额无容量上限，删除了 houseCapacityTier 百分比分母（进度条 DOM 已移除）
    const hhRows = [
      ['insp-house-water-val', hhBal.Water],
      ['insp-house-food-val', hhBal.Food],
      ['insp-house-wood-val', hhBal.Wood],
      ['insp-house-stone-val', hhBal.Stone],
      ['insp-house-gold-val', hhBal.Gold]
    ];
    for (const [valId, amt] of hhRows) {
      const vEl = document.getElementById(valId);
      const v = amt || 0;
      if (vEl) vEl.textContent = `${v.toFixed(1)} 单位`;
    }

    // 建筑形态与升级要求（M6：一次性扣账、瞬时升级，无施工工时/体力）
    const tierDescElem = document.getElementById('insp-house-tier-desc');
    if (tierDescElem) {
      let upgradeCondition = '';
      // ★ M8 升级条件 = 家户账本可支付该次一次性材料成本（数值与 config.house-upgrade-cost.js 矩阵一致）
      if (isWarehouse) upgradeCondition = '0级 起步营地 → 升级 1 级需账本水50+粮50（瞬时扣账晋升）';
      else if (house.tier === 'Tier1ThatchedHut') upgradeCondition = '1级 茅草房 → 升级 2 级需账本木/粮/水各75（瞬时扣账晋升）';
      else if (house.tier === 'Tier2LeanTo') upgradeCondition = '2级 私宅 → 升级 3 级需账本石/木/粮/水各100（瞬时扣账晋升）';
      else if (house.tier === 'Tier3Homestead') upgradeCondition = '3级 木石庄舍 → 升级 4 级需账本金/石/木/粮/水各125（瞬时扣账晋升）';
      else upgradeCondition = '4级 氏族大庄园 (终极形态；户主威望已达此宅邸等级点数)';
      tierDescElem.textContent = upgradeCondition;
      tierDescElem.style.color = isWarehouse ? '#f59e0b' : '#10b981';
    }

    const fertilityBadge = document.getElementById('insp-house-fertility-badge');
    if (fertilityBadge) {
      // ★ v1.28.0 生育重新挂钩住宅等级：男方（户主）名下须有 ≥1 级私宅，0 级仓库不可生育
      if (isWarehouse) {
        fertilityBadge.textContent = '🍼 0级仓库不可生育：户主需先升级到 1 级茅草房';
        fertilityBadge.style.color = '#f59e0b';
      } else {
        fertilityBadge.textContent = '🍼 可生育：户主名下住宅 ≥1 级，夫妻身体指标达标即可受孕';
        fertilityBadge.style.color = '#10b981';
      }
    }

    // 户主追踪按钮绑定（v1.10.0 无主空置房显示"无主"，删除代际显示）
    const ownerAgent = (house.ownerId != null && typeof sim.getAgent === 'function') ? sim.getAgent(house.ownerId) : (house.ownerId != null ? sim.agents.find(a => a.id === house.ownerId) : null);
    const ownerAlive = ownerAgent && ownerAgent.isAlive;
    const ownerBtn = document.getElementById('insp-house-owner-btn');
    if (ownerBtn) {
      if (house.ownerId == null) {
        ownerBtn.textContent = '🏚️ 无主空置房（受益人登记于所属营地）';
        ownerBtn.className = 'lineage-chip dead';
        ownerBtn.removeAttribute('data-agent-id');
      } else {
        ownerBtn.textContent = `Agent #${house.ownerId} ${ownerAlive ? '🟢 健在 (点击追踪)' : '💀 已故'} 🔍`;
        ownerBtn.className = `lineage-chip ${ownerAlive ? '' : 'dead'}`;
        ownerBtn.setAttribute('data-agent-id', house.ownerId);
      }
    }

    // 所属聚落辖区绑定
    const campPoi = sim.pois.find(p => p.id === house.campId);
    const campTitle = campPoi ? campPoi.campTitle : `营地 #${house.campId || 1}`;
    const houseCampElem = document.getElementById('insp-house-camp-name');
    if (houseCampElem) {
      houseCampElem.textContent = `🏕️ ${campTitle}`;
    }

    // ★ v1.26.0 房屋拍卖状态与档案展示（估价机制已删除，改展示最高出价）
    const valGoldEl = document.getElementById('insp-house-val-gold');
    if (valGoldEl) {
      valGoldEl.textContent = (house.highestBid || 0) > 0 ? `${(house.highestBid || 0).toFixed(2)} 金` : '暂无出价';
    }

    const auctionTagEl = document.getElementById('insp-house-auction-tag');
    const auctionInfoEl = document.getElementById('insp-house-auction-info');
    const dealInfoEl = document.getElementById('insp-house-deal-info');

    if (isVacant) {
      if (auctionTagEl) {
        auctionTagEl.textContent = '🏛️ 营地中介挂牌拍卖';
        auctionTagEl.style.background = 'rgba(239,68,68,0.2)';
        auctionTagEl.style.borderColor = 'rgba(239,68,68,0.4)';
        auctionTagEl.style.color = '#f87171';
      }
      if (auctionInfoEl) auctionInfoEl.style.display = 'flex';

      const phaseEl = document.getElementById('insp-house-auction-phase');
      if (phaseEl) {
        if (house.auctionPhase === '观察期') {
          phaseEl.textContent = '🌾 麦穗37%观察期 (摸底蓄势，绝不卖出)';
          phaseEl.style.color = '#f59e0b';
        } else if (house.auctionPhase === '决策期') {
          phaseEl.textContent = '🎯 麦穗决策期 (出现更高报价即成交)';
          phaseEl.style.color = '#38bdf8';
        } else {
          phaseEl.textContent = '⚠️ 10%修缮度强制出清 (选最高出价成交)';
          phaseEl.style.color = '#ef4444';
        }
      }

      const benchEl = document.getElementById('insp-house-benchmark-bid');
      if (benchEl) {
        benchEl.textContent = house.benchmarkBid > 0 ? `${house.benchmarkBid.toFixed(2)} 金` : '暂无标杆 (摸底中)';
      }

      const highEl = document.getElementById('insp-house-highest-bid');
      if (highEl) {
        highEl.textContent = house.highestBid > 0 ? `${house.highestBid.toFixed(2)} 金` : '暂无有效出价';
      }

      const countEl = document.getElementById('insp-house-bids-count');
      if (countEl) countEl.textContent = house.bidsCount || 0;
    } else {
      if (auctionTagEl) {
        auctionTagEl.textContent = isWarehouse ? '0级仓库' : '正常私宅';
        auctionTagEl.style.background = 'rgba(245,158,11,0.2)';
        auctionTagEl.style.borderColor = 'rgba(245,158,11,0.4)';
        auctionTagEl.style.color = '#fbbf24';
      }
      if (auctionInfoEl) auctionInfoEl.style.display = 'none';
    }

    if (house.lastDealPrice != null) {
      if (dealInfoEl) dealInfoEl.style.display = 'block';
      const lastDealEl = document.getElementById('insp-house-last-deal-text');
      if (lastDealEl) {
        lastDealEl.textContent = `以 ${house.lastDealPrice.toFixed(2)} 金竞得成交 (第 ${house.lastDealTick} 拍)`;
      }
    } else {
      if (dealInfoEl) dealInfoEl.style.display = 'none';
    }

    // 档案摘要与展开列表
    const bidsList = house.recentBids || [];
    const dealsList = house.recentDeals || [];
    const summaryEl = document.getElementById('insp-house-archive-summary');
    if (summaryEl) {
      summaryEl.textContent = `${house.bidsCount || bidsList.length} 报价 / ${dealsList.length} 成交`;
    }

    const archiveContentEl = document.getElementById('insp-house-archive-content');
    if (archiveContentEl && archiveContentEl.style.display !== 'none') {
      let html = '';
      if (dealsList.length > 0) {
        html += '<div style="color:#6ee7b7; font-weight:600; margin-bottom:2px;">📜 历史成交记录:</div>';
        for (const d of dealsList) {
          html += `<div style="color:#a7f3d0; margin-bottom:2px;">• 第${d.tick}拍: 买方 #${d.buyerId} 以 ${d.price.toFixed(2)}金 成交 (修缮度${d.durability.toFixed(1)}%, ${d.reason})</div>`;
        }
      }
      if (bidsList.length > 0) {
        html += '<div style="color:#fcd34d; font-weight:600; margin-top:4px; margin-bottom:2px;">📋 近期报价记录:</div>';
        for (const b of bidsList) {
          html += `<div style="color:#e2e8f0; margin-bottom:1px;">• 第${b.tick}拍 [${b.phase}]: 买方 #${b.bidderId} 开价 ${b.amount.toFixed(2)}金</div>`;
        }
      }
      if (!html) html = '<div style="color:#94a3b8;">暂无历史报价或成交记录</div>';
      archiveContentEl.innerHTML = html;
    }

    const houseCoordEl = document.getElementById('insp-house-coord');

    // ★ 修建/升级者（历史确权：立宅修建者与最近升级者，均不随代际继承改变）
    const builderVal = document.getElementById('insp-house-builder-val');
    if (builderVal) {
      const upgName = (house.lastUpgraderId == null) ? '—' : `Agent #${house.lastUpgraderId}`;
      builderVal.textContent = `修建者 Agent #${house.builderId} · 最近升级 ${upgName}`;
    }
    if (houseCoordEl) houseCoordEl.textContent = `(X: ${Math.round(house.pos.x)}m, Y: ${Math.round(house.pos.y)}m)`;
    document.getElementById('insp-detail-text').textContent = isVacant ? '户主故去后由营地中介挂牌拍卖，按麦穗理论37%原则撮合交易，修缮度跌至10%时强制选最高出价成交。' : (isWarehouse ? '0级仓库自带5水5粮5木，需搬运水粮各满10.0单位后，投入30s升级为1级茅草房并激活家庭生育。' : `属于族人 #${house.ownerId} 的私产空间。冬季自动消耗木材供暖(木材<10无法生育)；升级私宅需要木头，私宅往上升级需要石头(石头仅用于盖房升级)。`);
}
