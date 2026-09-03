// === Inspector 面板与点击拾取 (从 render.js 拆分) ===
// 族人/房屋/POI Inspector 面板 DOM 更新 / 智能点击拾取 / 家户账本信息
// 依赖全局: sim, camera, project3D, canvas, totalDragDist, clickCycle

// ★ v1.9.0 进度条变化速率追踪（按游戏时间秒计量，悬停展示每秒变化量；Task1）
const _meterRateTracker = (() => {
  const buckets = {};
  return {
    push(key, value, gameDt) {
      const t = performance.now() / 1000;
      const b = buckets[key] || (buckets[key] = { prevVal: value, prevT: t, rate: 0 });
      const realDt = t - b.prevT;
      if (realDt > 0.6) {
        // 间隔过久（暂停/切卡/重开）：重置基准，不产出速率
        b.prevVal = value; b.prevT = t;
        return b.rate;
      }
      if (realDt > 0.02 && gameDt > 0) {
        const inst = (value - b.prevVal) / gameDt;
        // 忽略极端跳变（数值被重置/瞬移），用 EMA 平滑
        if (Math.abs(inst) < 60) b.rate = b.rate === 0 ? inst : b.rate * 0.6 + inst * 0.4;
      }
      b.prevVal = value; b.prevT = t;
      return b.rate;
    },
    reset(key) { if (buckets[key]) buckets[key].rate = 0; }
  };
})();
function _fmtRate(v) {
  if (!isFinite(v) || Math.abs(v) < 0.005) return '约 0.00/秒';
  return (v > 0 ? '+' : '') + v.toFixed(2) + '/秒';
}
// 每帧游戏时间增量（秒）＝ simulationDt × 倍速
const _gameDt = () => (sim.simulationDt || 1 / 30) * (sim.speedMult || 1);

function updateInspector() {
const inspectorCard = document.getElementById('inspector-card');
const agentView = document.getElementById('insp-agent-view');
const poiView = document.getElementById('insp-poi-view');
const houseView = document.getElementById('insp-house-view');
const followBtn = document.getElementById('insp-agent-actions');

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
  if (house) {
    agentView.style.display = 'none';
    poiView.style.display = 'none';
    houseView.style.display = 'flex';
    if (followBtn) followBtn.style.display = 'none';

    const isWarehouse = house.tier === 'Tier0Warehouse';
    let tierTitle = '📦 0级 仓库';
    if (house.tier === 'Tier1ThatchedHut') tierTitle = '🛖 1级 茅草房';
    else if (house.tier === 'Tier2LeanTo') tierTitle = '🏡 2级 私宅';
    else if (house.tier === 'Tier3Homestead') tierTitle = '🏯 3级 木石庄舍';
    else if (house.tier === 'Tier4Manor') tierTitle = '🏰 4级 家族大庄园';

    document.getElementById('insp-title-name').textContent = `${tierTitle} #${house.id}`;
    
    let stateText = '🌿 私人居所';
    if (house.isRuin) {
      stateText = '💀 绝嗣废墟 (快速风化中)';
    } else if (house.isRepairing) {
      stateText = `🔧 族人劳作修缮中 (${Math.round(house.durability)}%)`;
    } else {
      stateText = isWarehouse ? '🏠 起步营地' : (house.tier === 'Tier4Manor' ? '🏰 4级氏族大庄园' : '🏡 安居宅邸');
    }
    document.getElementById('insp-title-state').textContent = stateText;
    document.getElementById('insp-title-state').style.color = house.isRuin ? '#ef4444' : (house.isRepairing ? '#38bdf8' : (isWarehouse ? '#f59e0b' : '#10b981'));

    const durPct = Math.round(house.durability);
    document.getElementById('insp-house-dur-val').textContent = `${durPct}% (${house.isRuin ? '加速风化中' : (house.isRepairing ? '族人修缮回血中' : (durPct < 85 ? '需修缮' : '稳固使用中'))})`;
    document.getElementById('insp-house-dur-fill').style.width = `${durPct}%`;
    document.getElementById('insp-house-dur-fill').style.background = durPct < 30 ? '#ef4444' : (durPct < 85 ? '#f59e0b' : '#10b981');
    // ★ v1.9.0 房屋耐久/修缮变化速度（按游戏秒；Task1 进度条悬停）
    const durRate = _meterRateTracker.push('dur' + house.id, house.durability, _gameDt());
    const durFillEl = document.getElementById('insp-house-dur-fill');
    if (durFillEl) {
      let durHint = '耐久变化 ' + _fmtRate(durRate);
      if (house.isRuin) durHint = '💀 绝嗣废墟 · 加速风化 ' + _fmtRate(durRate);
      else if (house.isRepairing) durHint = '🔧 修缮回血中 · 每秒变化 ' + _fmtRate(durRate);
      durFillEl.title = durHint;
    }

    // ★ M6 家庭储备展示（唯一真相源 = 户主家户账本；房屋不再持有仓库）
    const ownerAgentRef = (typeof sim.getAgent === 'function') ? sim.getAgent(house.ownerId) : sim.agents.find(a => a.id === house.ownerId);
    const ownerHousehold = (typeof sim.getHouseholdOfAgent === 'function') ? sim.getHouseholdOfAgent(house.ownerId)
      : (sim.households.find(hh2 => hh2.head === house.ownerId || (hh2.members || []).includes(house.ownerId)) || null);
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
      // ★ M6 生育去房屋化：房屋/仓储不再作为生育前提
      fertilityBadge.textContent = '🍼 生育已去房屋化：已婚夫妻身体指标达标即可受孕（无需房屋或储仓）';
      fertilityBadge.style.color = '#10b981';
    }

    // 户主追踪按钮绑定
    const ownerAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(house.ownerId) : sim.agents.find(a => a.id === house.ownerId);
    const ownerAlive = ownerAgent && ownerAgent.isAlive;
    const ownerBtn = document.getElementById('insp-house-owner-btn');
    if (ownerBtn) {
      ownerBtn.textContent = `Agent #${house.ownerId} ${ownerAlive ? '🟢 健在 (点击追踪)' : '💀 已故'} (第${house.generation}代) 🔍`;
      ownerBtn.className = `lineage-chip ${ownerAlive ? '' : 'dead'}`;
      ownerBtn.setAttribute('data-agent-id', house.ownerId);
    }

    // 所属聚落辖区绑定
    const campPoi = sim.pois.find(p => p.id === house.campId);
    const campTitle = campPoi ? campPoi.campTitle : `营地 #${house.campId || 1}`;
    const houseCampElem = document.getElementById('insp-house-camp-name');
    if (houseCampElem) {
      houseCampElem.textContent = `🏕️ ${campTitle}`;
    }

    const houseCoordEl = document.getElementById('insp-house-coord');

    // ★ 修建/升级者（历史确权：立宅修建者与最近升级者，均不随代际继承改变）
    const builderVal = document.getElementById('insp-house-builder-val');
    if (builderVal) {
      const upgName = (house.lastUpgraderId == null) ? '—' : `Agent #${house.lastUpgraderId}`;
      builderVal.textContent = `修建者 Agent #${house.builderId} · 最近升级 ${upgName}`;
    }
    if (houseCoordEl) houseCoordEl.textContent = `(X: ${Math.round(house.pos.x)}m, Y: ${Math.round(house.pos.y)}m)`;
    document.getElementById('insp-detail-text').textContent = house.isRuin ? '户主去世且未有族人继承，房屋正处于风化瓦解状态。' : (isWarehouse ? '0级仓库自带5水5粮5木，需搬运水粮各满10.0单位后，投入30s升级为1级茅草房并激活家庭生育。' : `属于族人 #${house.ownerId} 的私产空间。冬季自动消耗木材供暖(木材<10无法生育)；升级私宅需要木头，私宅往上升级需要石头(石头仅用于盖房升级)。`);
  }
} else if (sim.selectionType === 'poi' && sim.selectedPoiId !== null) {
  const poi = sim.pois.find(p => p.id === sim.selectedPoiId);
  if (poi) {
    agentView.style.display = 'none';
    houseView.style.display = 'none';
    poiView.style.display = 'flex';
    if (followBtn) followBtn.style.display = 'none';

    const poiIcon = poi.type === 'Camp' ? ((poi.level || 0) >= 4 ? '🏛️' : ((poi.level || 0) >= 2 ? '🏘️' : '🏕️')) : (poi.type === 'Water' ? '💧' : (poi.type === 'Berry' ? '🍒' : (poi.type === 'Wood' ? '🌲' : (poi.type === 'Gold' ? '🪙' : '🪨'))));
    document.getElementById('insp-title-name').textContent = poi.type === 'Camp' ? `${poiIcon} ${poi.campTitle || poi.name}` : `${poiIcon} ${poi.name}`;
    
    let stateBadge = '资源充足';
    let badgeColor = '#10b981';
    if (poi.type === 'Camp') {
      const lvlNames = ['原始营地 (1阶)', '村落 (2阶)', '乡集 (3阶)', '集镇 (4阶)', '县邑 (5阶)'];
      stateBadge = `${lvlNames[poi.level || 0]} · 辖 ${poi.boundHouses || 0} 房`;
      badgeColor = '#f59e0b';
    } else if (!isFinite(poi.currentStock) || poi.maxStock <= 0) {
      stateBadge = '无限供应';
      badgeColor = '#f59e0b';
    } else if (poi.currentStock < 4.0) {
      stateBadge = '资源枯竭中';
      badgeColor = '#ef4444';
    } else if (poi.currentStock < poi.maxStock * 0.4) {
      stateBadge = '储量偏低';
      badgeColor = '#f59e0b';
    }
    document.getElementById('insp-title-state').textContent = stateBadge;
    document.getElementById('insp-title-state').style.color = badgeColor;

    const stockRow = document.getElementById('insp-poi-stock-row');
    const campUpgradeRow = document.getElementById('insp-camp-upgrade-row');
    if (poi.type === 'Camp') {
      stockRow.style.display = 'none';
      if (campUpgradeRow) {
        campUpgradeRow.style.display = 'flex';
        const nextTarget = (poi.level || 0) === 0 ? 6 : ((poi.level || 0) === 1 ? 12 : ((poi.level || 0) === 2 ? 18 : 24));
        const prevTarget = (poi.level || 0) === 0 ? 0 : ((poi.level || 0) === 1 ? 6 : ((poi.level || 0) === 2 ? 12 : 18));
        const count = poi.boundHouses || 0;
        const nextTitle = (poi.level || 0) === 0 ? '村落 (6房)' : ((poi.level || 0) === 1 ? '乡集 (12房)' : ((poi.level || 0) === 2 ? '集镇 (18房)' : '县邑 (24房)'));
        
        if ((poi.level || 0) >= 4) {
          document.getElementById('lbl-camp-upgrade-title').textContent = `🏛️ 县级行政区 (已达最高级)`;
          document.getElementById('insp-camp-upgrade-val').textContent = `${count} 间私宅`;
          document.getElementById('insp-camp-upgrade-fill').style.width = '100%';
        } else {
          const ratio = Math.min(100, Math.round(((count - prevTarget) / (nextTarget - prevTarget)) * 100));
          document.getElementById('lbl-camp-upgrade-title').textContent = `🏛️ 晋升 ${nextTitle}`;
          document.getElementById('insp-camp-upgrade-val').textContent = `${count} / ${nextTarget} 间房`;
          document.getElementById('insp-camp-upgrade-fill').style.width = `${Math.max(0, ratio)}%`;
        }
      }
    } else {
      if (campUpgradeRow) campUpgradeRow.style.display = 'none';
      stockRow.style.display = 'flex';
      const ratio = Math.round((poi.currentStock / poi.maxStock) * 100);
      if (poi.type === 'Water') {
        document.getElementById('lbl-poi-stock-title').textContent = '清泉蓄水量 (上限60.0)';
        document.getElementById('insp-poi-stock-fill').style.background = '#38bdf8';
      } else if (poi.type === 'Berry') {
        document.getElementById('lbl-poi-stock-title').textContent = '成熟浆果 (上限60.0)';
        document.getElementById('insp-poi-stock-fill').style.background = '#10b981';
      } else if (poi.type === 'Wood') {
        document.getElementById('lbl-poi-stock-title').textContent = '林木木材 (上限60.0)';
        document.getElementById('insp-poi-stock-fill').style.background = '#b45309';
      } else if (poi.type === 'Stone') {
        document.getElementById('lbl-poi-stock-title').textContent = '石矿石料 (上限60.0)';
        document.getElementById('insp-poi-stock-fill').style.background = '#94a3b8';
      } else if (poi.type === 'Gold') {
        document.getElementById('lbl-poi-stock-title').textContent = '璀璨金矿 (上限60.0)';
        document.getElementById('insp-poi-stock-fill').style.background = '#fbbf24';
      }
      document.getElementById('insp-poi-stock-val').textContent = `${poi.currentStock.toFixed(1)} / ${poi.maxStock.toFixed(1)} 单位`;
      document.getElementById('insp-poi-stock-fill').style.width = `${ratio}%`;
    }

    // ★ v1.9.0 营地王国信息与王国账本（Task3：国王/继承人/历史国王/管辖家庭/国家账本）
    const kingdomBox = document.getElementById('insp-camp-kingdom-box');
    if (kingdomBox) {
      const region = sim.regions.find(r => r.campId === poi.id);
      if (poi.type === 'Camp' && region) {
        kingdomBox.style.display = 'flex';
        const kingEl = document.getElementById('insp-camp-king');
        if (kingEl) {
          if (region.kingId != null) {
            kingEl.innerHTML = `<span class="lineage-chip" data-agent-id="${region.kingId}" title="点击追踪国王视角">👑 Agent #${region.kingId}</span>`;
          } else {
            kingEl.innerHTML = `<span style="color:#ef4444;">王位空缺（可被夺位）</span>`;
          }
        }
        const heirEl = document.getElementById('insp-camp-heir');
        if (heirEl) {
          const heirId = (region.heirCandidates || [])[0];
          if (heirId != null) {
            heirEl.innerHTML = `<span class="lineage-chip" data-agent-id="${heirId}" title="点击追踪继承人视角">🤴 Agent #${heirId}</span>`;
          } else {
            heirEl.textContent = '—';
          }
        }
        const histEl = document.getElementById('insp-camp-hist-kings');
        if (histEl) {
          const hk = region.historyKings || [];
          if (hk.length > 0) {
            histEl.innerHTML = hk.map(kid => `<span class="lineage-chip dead" data-agent-id="${kid}" title="点击查看历史国王">#${kid}</span>`).join(' ');
          } else {
            histEl.textContent = '—';
          }
        }
        const govEl = document.getElementById('insp-camp-governed');
        if (govEl) {
          const ghs = region.governedHouseholds || [];
          if (ghs.length > 0) {
            govEl.textContent = ghs.map(hid => {
              const hh = (sim.households || []).find(h => h.id === hid);
              const n = hh && hh.members ? hh.members.length : '?';
              return `🏠#${hid}(${n}人)`;
            }).join('  ');
          } else {
            govEl.textContent = '—';
          }
        }
        const resMap = { Water: 'insp-camp-ledger-water', Food: 'insp-camp-ledger-food', Wood: 'insp-camp-ledger-wood', Stone: 'insp-camp-ledger-stone', Gold: 'insp-camp-ledger-gold' };
        for (const rk of Object.keys(resMap)) {
          const el = document.getElementById(resMap[rk]);
          if (el) el.textContent = ((region.balances && region.balances[rk]) || 0).toFixed(1);
        }
        const jEl = document.getElementById('insp-camp-ledger-journal');
        if (jEl) {
          const jn = (region.recentJournal || []).slice(0, 4);
          if (jn.length > 0) {
            jEl.innerHTML = jn.map(r => {
              const reasonZh = { 'Tax': '公仓税', 'Relief': '王室救济', 'Legacy': '绝嗣归并', 'Tribute': '族税', 'Split': '分家', 'Inheritance': '继承' }[r.reason] || r.reason;
              return `<div>· ${reasonZh} ${r.resource || ''} ${(r.amount || 0).toFixed(1)}${r.tick != null ? ' (Tick ' + r.tick + ')' : ''}</div>`;
            }).join('');
          } else {
            jEl.textContent = '';
          }
        }
      } else {
        kingdomBox.style.display = 'none';
      }
    }

    document.getElementById('insp-poi-regen').textContent = poi.regenRate > 0 ? `+${poi.regenRate.toFixed(2)} 单位/秒` : `无限储量 (公共避风聚落)`;
    const elevEl = document.getElementById('insp-poi-elev');
    if (elevEl) elevEl.textContent = poi.pos.z < -10 ? '低洼谷地 (汇水充盈)' : (poi.pos.z > 10 ? '峻峭高台 (视野开阔)' : '平缓原野 (适宜定居)');
    const poiCoordEl = document.getElementById('insp-poi-coord');
    if (poiCoordEl) poiCoordEl.textContent = poi.type === 'Camp' ? '聚落中心' : (poi.campTitle ? `${poi.campTitle} 领地` : '荒原公域');
    
    let desc = `【${poi.campTitle || poi.name}】公共避风聚落(储量无限)，族人在此休养回体与繁衍。辖内已自发落成 ${poi.boundHouses || 0} 间私宅，随房屋增加逐步升级为【营地 → 村 → 乡 → 镇 → 县】！`;
    if (poi.type === 'Water') desc = '低洼处天然地泉(上限60单位,产速2.0/s)，小人饮水并补给家宅。';
    else if (poi.type === 'Berry') desc = '向阳缓坡野生灌木(上限60单位,产速2.0/s)，小人采食并补给家宅。';
    else if (poi.type === 'Wood') desc = '茂密原生林地(上限60单位,产速2.0/s)，伐木用于冬季房屋供暖与升级茅草房。';
    else if (poi.type === 'Stone') desc = '嶙峋高地石矿(上限60单位,产速1.5/s)，采石仅用于私宅升级木石庄舍与大庄园。';
    else if (poi.type === 'Gold') desc = '璀璨金矿(上限60单位,产速1.2/s)，开采黄金装入随身行囊(黄金无限容量，单趟运满20回宅入库)，存入私宅金库用于晋升最高级氏族大庄园。';
    document.getElementById('insp-detail-text').textContent = desc;
  }
} else {
  agentView.style.display = 'block';
  poiView.style.display = 'none';
  houseView.style.display = 'none';
  if (followBtn) followBtn.style.display = 'block';

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
    const isAdult = selAgent.age >= 1800.0;
    const isFemale = selAgent.gender === 'female';
    const genderBadge = isFemale ? '♀' : '♂';
    const roleIcon = selAgent.isFetus ? '👶' : (!selAgent.isAlive ? '💀' : (selAgent.isPregnant ? '🤰' : (isAdult ? (isFemale ? '👩' : '👨') : '🍼')));
    
    let homeTag = `🏕️ 露天营地`;
    if (selAgent.homeHouseId !== null) {
      const myHouse = sim.houses.find(h => h.id === selAgent.homeHouseId);
      if (myHouse) {
        if (myHouse.ownerId === selAgent.id) homeTag = `🏡 #${selAgent.homeHouseId}家·户主`;
        else if (myHouse.spouseId === selAgent.id) homeTag = `🏡 #${selAgent.homeHouseId}家·配偶`;
        else homeTag = `🏡 #${selAgent.homeHouseId}家·子女`;
      }
    }
    const surnameBadge = selAgent.surname ? `【${selAgent.surname}】` : '';
    if (selAgent.isFetus) {
      // ★ M1.7 腹中胎儿卡片：无地图实体、跳过决策/代谢/行动
      document.getElementById('insp-title-name').textContent = `${surnameBadge}腹中胎儿 #${selAgent.id} ${genderBadge} 👶`;
    } else {
      document.getElementById('insp-title-name').textContent = `${surnameBadge}部落民 #${selAgent.id} ${genderBadge} ${roleIcon}`;
    }
    
    const homeBadgeEl = document.getElementById('insp-home-badge');
    if (homeBadgeEl) homeBadgeEl.textContent = homeTag;
    
    let stateText = selAgent.homeHouseId ? '🏡 私宅安居' : '🏕️ 营地驻留';
    let detailText = selAgent.homeHouseId ? '在专属家宅中安居，夫妻与子女共享水粮木石储备，冬季房屋自动供暖，满足饱暖与木材>=10可激活孕育。' : '在露天营地休息，无私宅不可受孕。';

    if (selAgent.isFetus) {
      // ★ M1.7 腹中胎儿：已获 agent 身份，但不占地图实体、不行动、不消耗
      stateText = '🤰 腹中孕育中';
      detailText = '在母亲腹中孕育，尚未出生。已获完整 agent 身份（可继承、可被卡片追踪），但不设置地图实体、跳过行动决策，也不产生任何需求消耗。出生后将转为正常新生儿。';
    } else if (!selAgent.isAlive) {
      const isDecaying = typeof selAgent.deathDecayTimer === 'number' && selAgent.deathDecayTimer > 0;
      stateText = isDecaying ? '💀 刚离世' : '💀 已故先祖';
      detailText = isDecaying
        ? `死因: ${selAgent.deathCause || '未知饥荒'} (遗骸将在 ${Math.ceil(selAgent.deathDecayTimer)}s 后消逝)`
        : `死因: ${selAgent.deathCause || '寿终正寝/未知'} (已入土长眠，载入族谱先祖志)`;
    } else if (selAgent.state === 'RestingAtCamp') {
      if (selAgent.stamina < 99.5) {
        const restRate = (8.0 * (selAgent.sleepEfficiency || 100) / 100).toFixed(1);
        stateText = (selAgent.homeHouseId ? '🏡 私宅休养' : '🏕️ 营地休养') + ' (+' + restRate + '%/s)';
        detailText = '正在家宅/营地静坐休养，体力恢复速率 = 8.0%/s × 睡眠效率/100 (' + restRate + '%/s)，睡眠效率越高休息越快，恢复至 100% 满值后方可开展后续工作。';
      } else {
        stateText = selAgent.homeHouseId ? '🏡 私宅安居' : '🏕️ 营地驻留';
        detailText = '体力充盈至 100% 且温饱无虞，安居静候下一个生活/营建需求。';
      }
    } else if (selAgent.state === 'ConstructingHouse') {
      const progPct = Math.round((selAgent.buildTimer / 30.0) * 100);
      stateText = `🔨 营建中 (${progPct}%)`;
      detailText = '投入体力与工时营建或升级私宅(30s工期)，完成后将扩容储备空间并激活/保障繁衍孕育。';
    } else if (selAgent.state === 'RepairingHouse') {
      stateText = '🔧 房屋修缮中';
      detailText = '投入体力劳作修缮专属私宅，恢复房屋耐久度至 100% 避免风化坍塌。';
    } else if (selAgent.state === 'SeekingWater') {
      const isStocking = selAgent.currentNeed && (selAgent.currentNeed.includes('StockWater') || selAgent.currentNeed.includes('Safety') || selAgent.currentNeed.includes('Belonging'));
      stateText = isStocking ? '💧 前往运水' : '💧 前往饮水';
      detailText = isStocking ? '前往水源采集清泉运回私宅仓库（安全需求，家庭生存储备）。' : '自身口渴难耐，前往水源直接饮水解渴。';
    } else if (selAgent.state === 'DrinkingAtWater') {
      const isStocking = selAgent.currentNeed && (selAgent.currentNeed.includes('StockWater') || selAgent.currentNeed.includes('Safety') || selAgent.currentNeed.includes('Belonging'));
      stateText = isStocking ? '💧 采水存仓中' : '💧 清泉痛饮中';
      detailText = isStocking ? '在水泉处持续汲水填满私宅水库，保障家庭基础生存。' : '在清泉处直接痛饮补充水分至 50.0 单位上限。';
    } else if (selAgent.state === 'SeekingFood') {
      const isStocking = selAgent.currentNeed && (selAgent.currentNeed.includes('StockFood') || selAgent.currentNeed.includes('Safety') || selAgent.currentNeed.includes('Belonging'));
      stateText = isStocking ? '🍒 前往采粮' : '🍒 前往觅食';
      detailText = isStocking ? '前往浆果丛采集野果运回私宅粮仓（安全需求，家庭生存储备）。' : '自身饥肠辘辘，前往浆果丛直接进食充饥。';
    } else if (selAgent.state === 'ForagingFood') {
      const isStocking = selAgent.currentNeed && (selAgent.currentNeed.includes('StockFood') || selAgent.currentNeed.includes('Safety') || selAgent.currentNeed.includes('Belonging'));
      stateText = isStocking ? '🍒 采摘存仓中' : '🍒 进食充饥中';
      detailText = isStocking ? '在灌木丛持续采摘浆果填满私宅粮仓，保障家庭基础生存。' : '在灌木丛处直接采食充饥至 50.0 单位上限。';
    } else if (selAgent.state === 'SeekingWood') {
      stateText = '🌲 前往伐木';
      detailText = '前往森林伐木获取木材，搬运回私宅用于冬季供暖与升级。';
    } else if (selAgent.state === 'GatheringWood') {
      stateText = '🌲 森林采伐中';
      detailText = '正在林区砍伐木材并持续运往私宅木料仓。';
    } else if (selAgent.state === 'SeekingStone') {
      stateText = '🪨 前往采石';
      detailText = '前往嶙峋石矿开采石料，用于私宅升级木石庄舍与大庄园。';
    } else if (selAgent.state === 'MiningStone') {
      stateText = '🪨 石矿开采中';
      detailText = '正在采石场开采石料并运回私宅石料仓(石头仅用于盖房)。';
    } else if (selAgent.state === 'SeekingGold') {
      stateText = '🪙 前往淘金';
      detailText = '前往璀璨金矿开采黄金并随身装载(黄金无限容量)，单趟运满20后回宅存入私宅金库用于升级与财富贮藏。';
    } else if (selAgent.state === 'MiningGold') {
      stateText = '🪙 淘金采矿中';
      detailText = '正在金矿开采黄金装入随身行囊(黄金无限容量)，单趟运满20后送回私宅金库储存。';
    } else if (selAgent.state === 'ReturningToCamp') {
      if (selAgent.stamina >= 50.0) {
        stateText = selAgent.homeHouseId ? '🏡 携货返家' : '🏕️ 携货返营';
        detailText = '已完成现场采收或搬运，正常折返回家将物资存入仓库（安全需求，体力充沛）。';
      } else {
        stateText = '🚶 疲惫返巢';
        detailText = '体力耗竭跌破50%，正在沿路返回专属私宅/营地；到达归宿后就地休养至100%满值。';
      }
    }

    document.getElementById('insp-title-state').textContent = stateText;
    document.getElementById('insp-title-state').style.color = !selAgent.isAlive ? '#ef4444' : '#f59e0b';
    
    // 年龄与性别生育状态展示
    const ageValElem = document.getElementById('insp-age-val');
    if (ageValElem) {
      if (selAgent.isFetus) {
        ageValElem.textContent = '🤰 孕育中 (未出生)';
        ageValElem.style.color = '#ec4899';
      } else if (isAdult) {
        ageValElem.textContent = `${Math.floor(selAgent.age)}s · ${isFemale ? '已成年♀' : '已成年♂'}`;
        ageValElem.style.color = isFemale ? '#ec4899' : '#38bdf8';
      } else {
        const needGrow = Math.ceil(1800.0 - selAgent.age);
        ageValElem.textContent = `${Math.floor(selAgent.age)}s · 🍼幼年(需${needGrow}s)`;
        ageValElem.style.color = '#a78bfa';
      }
    }

    // 马斯洛当前主导需求与决策逻辑卡片更新
    const maslowBox = document.getElementById('insp-maslow-box');
    const maslowBadge = document.getElementById('insp-maslow-badge');
    const maslowReason = document.getElementById('insp-maslow-reason');
    if (maslowBox && maslowBadge && maslowReason) {
      if (!selAgent.isAlive) {
        maslowBox.style.display = 'none';
      } else {
        const need = parseMaslowNeed(selAgent.currentNeed, selAgent);
        if (need) {
          maslowBox.style.display = 'block';
          maslowBox.style.borderColor = need.color + '66';
          maslowBadge.textContent = `${need.icon} ${need.numeral} ${need.name} · ${need.kindLabel}`;
          maslowBadge.style.color = need.color;
          maslowBadge.style.borderColor = need.color;
          maslowBadge.style.background = need.color + '1a';
          maslowReason.textContent = need.reason;
        } else if (selAgent.state === 'RestingAtCamp') {
          maslowBox.style.display = 'block';
          maslowBox.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          maslowBadge.textContent = selAgent.homeHouseId ? '🏡 闲适安居 · 需求充盈' : '🏕️ 营地休养 · 暂无急需';
          maslowBadge.style.color = '#10b981';
          maslowBadge.style.borderColor = '#10b981';
          maslowBadge.style.background = 'rgba(16, 185, 129, 0.12)';
          maslowReason.textContent = `体力充沛(${Math.round(selAgent.stamina)}%)且温饱与家宅需求均满足，安居休养中。`;
        } else {
          maslowBox.style.display = 'none';
        }
      }
    }

    // 2x2 生存健康指标
    const maxHealth = selAgent.maxHealth || selAgent.lifeExpectancy || 100.0;
    const curHealth = selAgent.health !== undefined ? selAgent.health : maxHealth;
    const healthPct = Math.max(0, Math.min(100, Math.round((curHealth / maxHealth) * 100)));
    const healthValEl = document.getElementById('insp-health-val');
    if (healthValEl) healthValEl.textContent = `${curHealth.toFixed(1)}/${maxHealth.toFixed(0)}`;
    const healthFillEl = document.getElementById('insp-health-fill');
    if (healthFillEl) healthFillEl.style.width = `${healthPct}%`;

    const stamValEl = document.getElementById('insp-stamina-val');
    if (stamValEl) stamValEl.textContent = `${Math.round(selAgent.stamina)}%`;
    const stamFillEl = document.getElementById('insp-stamina-fill');
    if (stamFillEl) stamFillEl.style.width = `${selAgent.stamina}%`;

    const hungerValEl = document.getElementById('insp-hunger-val');
    if (hungerValEl) hungerValEl.textContent = `${selAgent.hunger.toFixed(1)}/50`;
    const hungerFillEl = document.getElementById('insp-hunger-fill');
    if (hungerFillEl) hungerFillEl.style.width = `${Math.round((selAgent.hunger / 50.0) * 100)}%`;

    const thirstValEl = document.getElementById('insp-thirst-val');
    if (thirstValEl) thirstValEl.textContent = `${selAgent.thirst.toFixed(1)}/50`;
    const thirstFillEl = document.getElementById('insp-thirst-fill');
    if (thirstFillEl) thirstFillEl.style.width = `${Math.round((selAgent.thirst / 50.0) * 100)}%`;

    // ★ v1.9.0 饱食/口渴/体力每秒变化速度（按游戏时间秒；Task1 进度条悬停）
    const _gdt = _gameDt();
    if (hungerFillEl) hungerFillEl.title = '饱食度 · 每秒变化 ' + _fmtRate(_meterRateTracker.push('hunger' + selAgent.id, selAgent.hunger, _gdt));
    if (thirstFillEl) thirstFillEl.title = '口渴度 · 每秒变化 ' + _fmtRate(_meterRateTracker.push('thirst' + selAgent.id, selAgent.thirst, _gdt));
    if (stamFillEl) stamFillEl.title = '体力 · 每秒变化 ' + _fmtRate(_meterRateTracker.push('stamina' + selAgent.id, selAgent.stamina, _gdt));

    // 🎒 随身行囊 (紧凑胶囊网格)
    const CARRY_TOTAL_CAP = 200.0;
    const cWater = selAgent.carriedWater || 0.0;
    const cFood = selAgent.carriedFood || 0.0;
    const cWood = selAgent.carriedWood || 0.0;
    const cStone = selAgent.carriedStone || 0.0;
    const cGold = selAgent.carriedGold || 0.0;
    const carryUsed = Math.min(CARRY_TOTAL_CAP, cWater + cFood + cWood + cStone);
    const totalCargo = carryUsed + cGold;
    const carryPct = Math.round((carryUsed / CARRY_TOTAL_CAP) * 100);

    const carryCapEl = document.getElementById('insp-carry-cap');
    if (carryCapEl) carryCapEl.textContent = `${carryUsed.toFixed(1)} / ${CARRY_TOTAL_CAP.toFixed(0)}`;
    const carryFillEl = document.getElementById('insp-carry-fill');
    if (carryFillEl) carryFillEl.style.width = `${carryPct}%`;

    const updateChip = (chipId, numId, val) => {
      const chip = document.getElementById(chipId);
      const num = document.getElementById(numId);
      if (num) num.textContent = val > 0.01 ? val.toFixed(1) : '0';
      if (chip) {
        if (val > 0.01) chip.classList.add('active');
        else chip.classList.remove('active');
      }
    };
    updateChip('chip-water', 'insp-carry-water', cWater);
    updateChip('chip-food', 'insp-carry-food', cFood);
    updateChip('chip-wood', 'insp-carry-wood', cWood);
    updateChip('chip-stone', 'insp-carry-stone', cStone);
    updateChip('chip-gold', 'insp-carry-gold', cGold);

    const carryHintEl = document.getElementById('insp-carry-hint');
    if (carryHintEl) {
      if (!selAgent.isAlive) {
        carryHintEl.textContent = '💀 遗骸物资将随遗体风化消散。';
      } else if (totalCargo <= 0.01) {
        carryHintEl.textContent = '行囊空空 (物资将在现场采收后装入)';
      } else if (carryUsed >= CARRY_TOTAL_CAP - 0.01) {
        carryHintEl.textContent = '🎒 行囊已满载，正在返家卸货入库。';
      } else {
        carryHintEl.textContent = '🏠 随身携货，返回家宅后卸货存入私宅仓库。';
      }
    }

    // 🚚 搬运去向
    const haulBox = document.getElementById('insp-carry-haul');
    const haulTextEl = document.getElementById('insp-carry-haul-text');
    if (haulBox && haulTextEl) {
      let haulText = '';
      let haulColor = '#e2e8f0';
      const myHouse = selAgent.homeHouseId !== null ? sim.houses.find(h => h.id === selAgent.homeHouseId) : null;
      const houseTag = myHouse ? `私宅 #${myHouse.id}` : '营地';
      if (selAgent.isAlive) {
        if (selAgent.state === 'SeekingWater' || selAgent.state === 'DrinkingAtWater') {
          if (myHouse && cWater < 49.95) {
            haulText = `💧 汲水入囊 → ${houseTag}`;
            haulColor = '#38bdf8';
          }
        } else if (selAgent.state === 'SeekingFood' || selAgent.state === 'ForagingFood') {
          if (myHouse && cFood < 49.95) {
            haulText = `🍒 采食入囊 → ${houseTag}`;
            haulColor = '#10b981';
          }
        } else if (selAgent.state === 'SeekingWood' || selAgent.state === 'GatheringWood') {
          if (myHouse && cWood < 49.95) {
            haulText = `🌲 伐木入囊 → ${houseTag}`;
            haulColor = '#d97706';
          }
        } else if (selAgent.state === 'SeekingStone' || selAgent.state === 'MiningStone') {
          if (myHouse && cStone < 49.95) {
            haulText = `🪨 采石入囊 → ${houseTag}`;
            haulColor = '#94a3b8';
          }
        } else if (selAgent.state === 'SeekingGold' || selAgent.state === 'MiningGold') {
          haulText = `🪙 淘金入囊 → ${houseTag}`;
          haulColor = '#fbbf24';
        } else if (selAgent.state === 'ReturningToCamp') {
          const packList = [];
          if (cWater > 0.01) packList.push(`💧${cWater.toFixed(1)}`);
          if (cFood > 0.01) packList.push(`🍒${cFood.toFixed(1)}`);
          if (cWood > 0.01) packList.push(`🌲${cWood.toFixed(1)}`);
          if (cStone > 0.01) packList.push(`🪨${cStone.toFixed(1)}`);
          if (cGold > 0.01) packList.push(`🪙${cGold.toFixed(1)}`);
          if (packList.length > 0) {
            haulText = `🏠 返程卸货 → ${houseTag} (${packList.join(' ')})`;
            haulColor = '#94a3b8';
          } else if (myHouse) {
            haulText = `🏠 返程中 → ${houseTag}`;
            haulColor = '#94a3b8';
          }
        }
      }
      haulBox.style.display = haulText ? 'flex' : 'none';
      haulTextEl.textContent = haulText;
      haulTextEl.style.color = haulColor;
    }

    // 🏠 传送到私宅按钮状态切换
    const teleportBtn = document.getElementById('btn-teleport-house');
    if (teleportBtn) {
      if (selAgent.homeHouseId !== null && selAgent.homeHouseId !== undefined) {
        teleportBtn.style.display = 'inline-flex';
        teleportBtn.textContent = `🏠 私宅 #${selAgent.homeHouseId}`;
        teleportBtn.title = `聚焦并传送到所属私宅 #${selAgent.homeHouseId}`;
      } else {
        teleportBtn.style.display = 'none';
      }
    }

    document.getElementById('insp-detail-text').textContent = detailText;

    // 家族血脉与世系族谱渲染 (兼容父亲、母亲、配偶与子嗣)
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

    // 🌟 威望值展示（所有影响因子的综合集合体：子嗣 + 宅邸等级等）
    const prestigeElem = document.getElementById('insp-prestige-val');
    if (prestigeElem) {
      const prestige = selAgent.prestige || 0;
      prestigeElem.textContent = prestige > 0
        ? `🌟 威望 ${prestige}`
        : '暂无威望';
      prestigeElem.style.color = prestige >= 5 ? '#fbbf24' : (prestige > 0 ? '#a78bfa' : '#64748b');
    }

    // 弹窗头部与自身卡片更新
    const modalTitle = document.getElementById('lineage-modal-title');
    if (modalTitle) {
      const genText = selAgent.generation === 1 ? '始祖第1代' : `第${selAgent.generation || 2}代`;
      const clanPrefix = selAgent.surname ? `${selAgent.surname}氏 · ` : '';
      modalTitle.textContent = `${clanPrefix}部落民 #${selAgent.id} (${genText} · ${selAgent.gender === 'female' ? '♀' : '♂'}) 详细档案与族谱`;
    }
    const selfName = document.getElementById('lineage-self-name');
    if (selfName) {
      const genText = selAgent.generation === 1 ? '始祖第1代' : `第${selAgent.generation || 2}代`;
      const clanLabel = selAgent.surname ? `【${selAgent.surname}】氏 ` : '';
      selfName.textContent = `${clanLabel}部落民 #${selAgent.id} (${genText} · ${selAgent.gender === 'female' ? '女性 ♀' : '男性 ♂'})`;
    }
    const selfAvatar = document.getElementById('lineage-self-avatar');
    if (selfAvatar) {
      selfAvatar.textContent = !selAgent.isAlive ? '💀' : (selAgent.gender === 'female' ? (selAgent.isPregnant ? '🤰' : '👩') : '👦');
    }
    const selfGen = document.getElementById('lineage-self-gen');
    if (selfGen) {
      const genNum = selAgent.generation && selAgent.generation >= 1 ? selAgent.generation : ((selAgent.fatherId || selAgent.motherId) ? 2 : 1);
      selfGen.textContent = genNum === 1 ? '始祖第1代' : `第${genNum}代`;
    }
    const selfStatus = document.getElementById('lineage-self-status');
    if (selfStatus) {
      const hVal = selAgent.health !== undefined ? selAgent.health.toFixed(1) : '—';
      selfStatus.textContent = `年龄 ${Math.floor(selAgent.age)}s · 健康 ${hVal} · 饱食 ${Math.round(selAgent.hunger)} · 体力 ${Math.round(selAgent.stamina)}%`;
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

    const cdBox = document.getElementById('insp-cooldown-box');
    const cdPrefix = document.getElementById('insp-cooldown-prefix');
    // ★ 冷却提示前缀随类型动态切换：正常生育显示「产后休养」，流产显示「流产调养」
    const postpartumCd = selAgent.postpartumCooldown || 0;
    const miscarriageCd = selAgent.miscarriageCooldown || 0;
    if (selAgent.isAlive && !selAgent.isPregnant && (postpartumCd > 0 || miscarriageCd > 0)) {
      cdBox.style.display = 'flex';
      const isPostpartum = postpartumCd > 0;
      cdPrefix.textContent = isPostpartum ? '🤱 产后休养中: ' : '🥀 流产调养中: ';
      const cd = isPostpartum ? postpartumCd : miscarriageCd;
      document.getElementById('insp-cooldown-val').textContent = `剩余 ${Math.ceil(cd)}s 可受孕`;
    } else {
      cdBox.style.display = 'none';
    }

    const pregBox = document.getElementById('insp-preg-box');
    if (selAgent.isPregnant && selAgent.isAlive) {
      pregBox.style.display = 'flex';
      const pVal = Math.round(selAgent.pregnancyProgress * 100);
      document.getElementById('insp-preg-val').textContent = `${pVal}% (${Math.round(selAgent.pregnancyProgress * 900)}s / 900s)`;
      document.getElementById('insp-preg-fill').style.width = `${pVal}%`;
      // ★ v1.9.0 怀孕进度每秒变化（按游戏秒，进度%）（Task1 进度条悬停）
      const pregFillEl = document.getElementById('insp-preg-fill');
      if (pregFillEl) pregFillEl.title = '怀孕进度 · 每秒变化 ' + _fmtRate(_meterRateTracker.push('preg' + selAgent.id, selAgent.pregnancyProgress, _gdt) * 100) + '（进度%）';
      // ★ M1.7 母亲卡片按钮 → 跳转胎儿卡片（data-agent-id 由 main.js 委托处理）
      const pregFetusBtn = document.getElementById('insp-preg-fetus-btn');
      if (pregFetusBtn) {
        if (selAgent.pregnancyChildId != null) {
          pregFetusBtn.style.display = 'inline-flex';
          pregFetusBtn.setAttribute('data-agent-id', selAgent.pregnancyChildId);
          pregFetusBtn.textContent = `👶 查看腹中胎儿 #${selAgent.pregnancyChildId}`;
        } else {
          pregFetusBtn.style.display = 'none';
        }
      }
    } else {
      pregBox.style.display = 'none';
    }
  }
}
}

// 智能点击拾取 (排除拖拽平移)
// 智能点击拾取 (排除拖拽平移) —— 多个元素 (agent/house/poi) 重叠时，连续点击同一位置循环切换到其他元素
let clickCycle = null; // { x, y } 上一次循环切换的点击位置
canvas.addEventListener('click', e => {
  if (totalDragDist > 8) return;
  const clickX = e.clientX, clickY = e.clientY;

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

// 点击拾取需要的全局变量
