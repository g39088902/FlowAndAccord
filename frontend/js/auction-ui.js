/**
 * auction-ui.js · 房屋拍卖交易所与竞价窥视大盘 (v1.15.0)
 *
 * 职责：
 * 1. 控制 #house-auction-modal 视窗的开启、关闭与标签页切换；
 * 2. 每帧高频刷新 (_auctionUiTick)：实时推进麦穗 37% 博弈时间轴、动态指针、买方意向池与报价流水；
 * 3. 展现麦穗理论最优停止博弈全景（观察期摸底树标杆 -> 决策期超标杆成交 -> 10%修缮度强制出清）；
 * 4. 支持地图定位、买家追踪与历史成交公证书查阅。
 */

(function () {
  let isOpen = false;
  let currentHouseId = null;
  let currentTab = 'active'; // 'active' | 'history'

  const TICK_PER_SEC = 30; // 30 ticks = 1 模拟秒

  // ★ v1.22.3 内容快照缓存：拍卖大盘每帧高频刷新，仅当生成 HTML 与上次不一致时才重建 DOM，
  //   避免每帧销毁重建卡片导致 mousedown 与 mouseup 之间节点被替换、click 无法命中（点房屋无法切换/历史跳转失效）。
  const _htmlCache = new Map();
  function renderHtml(el, html) {
    if (!el) return;
    if (_htmlCache.get(el) === html) return;
    _htmlCache.set(el, html);
    el.innerHTML = html;
  }

  function getSim() {
    return window.rustWorldSim;
  }

  function getActiveAuctionHouses() {
    const sim = getSim();
    if (!sim || !sim.houses) return [];
    return sim.houses.filter(h => h.ownerId == null && h.auctionPhase != null);
  }

  function getAllDeals() {
    const sim = getSim();
    if (!sim || !sim.houses) return [];
    const deals = [];
    for (const h of sim.houses) {
      if (h.recentDeals && h.recentDeals.length > 0) {
        for (const d of h.recentDeals) {
          deals.push({
            houseId: h.id,
            tier: h.tier,
            campId: h.campId,
            tick: d.tick,
            buyerId: d.buyerId,
            price: d.price,
            durability: d.durability,
            reason: d.reason,
          });
        }
      }
    }
    // 按 tick 降序排列（最新成交在前）
    deals.sort((a, b) => b.tick - a.tick);
    return deals;
  }

  function getSelectedHouse() {
    const sim = getSim();
    if (!sim || !sim.houses) return null;
    if (currentHouseId != null) {
      const found = sim.houses.find(h => h.id === currentHouseId);
      if (found) return found;
    }
    const active = getActiveAuctionHouses();
    if (active.length > 0) {
      currentHouseId = active[0].id;
      return active[0];
    }
    return sim.houses[0] || null;
  }

  function getTierLabel(tier) {
    if (tier === 'Tier1ThatchedHut') return { icon: '🛖', name: '茅草私宅' };
    if (tier === 'Tier2LeanTo') return { icon: '🏡', name: '进阶私宅' };
    if (tier === 'Tier3Homestead') return { icon: '🏯', name: '木石庄舍' };
    if (tier === 'Tier4Manor') return { icon: '🏰', name: '氏族大庄园' };
    return { icon: '📦', name: '起步仓库' };
  }

  function getCampTitle(campId) {
    const sim = getSim();
    if (!sim || !sim.pois) return `营地 #${campId || 1}`;
    const p = sim.pois.find(poi => poi.id === campId);
    return p ? (p.campTitle || p.name) : `营地 #${campId || 1}`;
  }

  /**
   * 扫描辖区内符合出价条件的单身/无房成年男性户主（意向买家池）
   */
  function scanPotentialBuyers(campId, houseValuation) {
    const sim = getSim();
    if (!sim || !sim.agents) return [];

    const buyers = [];
    for (const a of sim.agents) {
      if (a.isAlive && a.gender === 'Male' && a.age >= 18 && a.homeHouseId == null) {
        // 查找家户账本黄金
        let gold = 0;
        if (typeof sim.getHouseholdOfAgent === 'function') {
          const hh = sim.getHouseholdOfAgent(a.id);
          if (hh && hh.balances) gold = hh.balances.Gold || 0;
        } else if (sim.households) {
          const hh = sim.households.find(h => h.head === a.id || (h.members || []).includes(a.id));
          if (hh && hh.balances) gold = hh.balances.Gold || 0;
        }

        // 判断出价意愿与能力
        let status = '蓄资中';
        let statusColor = '#94a3b8';
        if (gold >= houseValuation) {
          status = '💰 资金充裕 · 意向强烈';
          statusColor = '#10b981';
        } else if (gold > 0) {
          status = `🪙 存金 ${gold.toFixed(1)} (尽力出资)`;
          statusColor = '#f59e0b';
        } else {
          status = '微薄无金 · 暂无出价能力';
          statusColor = '#64748b';
        }

        buyers.push({
          id: a.id,
          age: Math.floor(a.age),
          gold,
          spouseId: a.spouseId,
          status,
          statusColor,
          sameCamp: (a.campId === campId),
        });
      }
    }

    // 按黄金降序排列，同辖区优先
    buyers.sort((a, b) => {
      if (a.sameCamp !== b.sameCamp) return a.sameCamp ? -1 : 1;
      return b.gold - a.gold;
    });

    return buyers;
  }

  /**
   * 打开拍卖交易所模态大盘
   */
  function openAuctionModal(targetHouseId) {
    const sim = getSim();
    if (!sim) return;

    if (targetHouseId != null) {
      currentHouseId = targetHouseId;
    } else {
      const active = getActiveAuctionHouses();
      if (active.length > 0) {
        currentHouseId = active[0].id;
      }
    }

    isOpen = true;
    const backdrop = document.getElementById('house-auction-backdrop');
    if (backdrop) backdrop.style.display = 'flex';

    renderModal();
  }

  /**
   * 关闭拍卖交易所模态大盘
   */
  function closeAuctionModal() {
    isOpen = false;
    const backdrop = document.getElementById('house-auction-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  }

  function isAuctionModalOpen() {
    return isOpen;
  }

  /**
   * 视口定位聚焦到当前房屋
   */
  function focusCurrentHouse() {
    const house = getSelectedHouse();
    if (!house) return;
    const sim = getSim();
    if (!sim) return;

    sim.selectionType = 'house';
    sim.selectedHouseId = house.id;

    if (window.camera) {
      window.camera.x = house.pos.x;
      window.camera.y = house.pos.y;
    }
  }

  /**
   * 视口定位聚焦到指定族人
   */
  function focusAgent(agentId) {
    const sim = getSim();
    if (!sim || !sim.agents) return;
    const a = sim.agents.find(ag => ag.id === agentId);
    if (!a) return;

    sim.selectionType = 'agent';
    sim.selectedAgentId = a.id;

    if (window.camera) {
      window.camera.x = a.pos.x;
      window.camera.y = a.pos.y;
    }
  }

  /**
   * 完整渲染模态框各板块
   */
  function renderModal() {
    if (!isOpen) return;

    const sim = getSim();
    if (!sim) return;

    const activeHouses = getActiveAuctionHouses();
    const allDeals = getAllDeals();

    // 1. 顶部状态计数
    const statusBadge = document.getElementById('auction-modal-status-badge');
    if (statusBadge) {
      renderHtml(statusBadge, activeHouses.length > 0
        ? `<span style="color:#10b981;">🟢 ${activeHouses.length} 栋房屋挂牌竞拍中</span>`
        : `<span style="color:#94a3b8;">⚪ 暂无在售空置房屋</span>`);
    }

    const tabActiveCount = document.getElementById('tab-active-count');
    if (tabActiveCount) tabActiveCount.textContent = activeHouses.length;
    const tabHistoryCount = document.getElementById('tab-history-count');
    if (tabHistoryCount) tabHistoryCount.textContent = allDeals.length;

    // 2. Tab 切换按钮激活状态
    const tabActiveBtn = document.getElementById('tab-btn-active-auctions');
    const tabHistoryBtn = document.getElementById('tab-btn-history-deals');
    const activeView = document.getElementById('auction-active-view');
    const historyView = document.getElementById('auction-history-view');

    if (currentTab === 'active') {
      if (tabActiveBtn) tabActiveBtn.classList.add('active');
      if (tabHistoryBtn) tabHistoryBtn.classList.remove('active');
      if (activeView) activeView.style.display = 'block';
      if (historyView) historyView.style.display = 'none';
    } else {
      if (tabActiveBtn) tabActiveBtn.classList.remove('active');
      if (tabHistoryBtn) tabHistoryBtn.classList.add('active');
      if (activeView) activeView.style.display = 'none';
      if (historyView) historyView.style.display = 'block';
      renderHistoryView(allDeals);
      return;
    }

    // 3. 在售房屋水平切换条 (Strip Cards)
    const stripEl = document.getElementById('auction-house-strip');
    if (stripEl) {
      if (activeHouses.length === 0) {
        renderHtml(stripEl, `<span style="font-size:11px; color:#64748b; padding:4px 8px;">全图聚落目前安居乐业，暂无遗留挂牌房产</span>`);
      } else {
        renderHtml(stripEl, activeHouses.map(h => {
          const t = getTierLabel(h.tier);
          const isSelected = (h.id === currentHouseId);
          const phaseColor = (h.auctionPhase === '观察期') ? '#f59e0b' : ((h.auctionPhase === '决策期') ? '#38bdf8' : '#ef4444');
          return `
            <div class="auction-strip-card ${isSelected ? 'selected' : ''}" data-house-id="${h.id}">
              <div class="strip-card-top">
                <span>${t.icon} #${h.id}</span>
                <span style="color:${phaseColor}; font-size:10px; font-weight:600;">${h.auctionPhase || '在售'}</span>
              </div>
              <div class="strip-card-bottom">
                <span>${Math.round(h.durability)}%耐久</span>
                <span style="color:#fbbf24; font-weight:700;">${(h.currentValuation || 0).toFixed(1)}G</span>
              </div>
            </div>
          `;
        }).join(''));
      }
    }

    // 4. 当前选中房屋的核心基本面
    const house = getSelectedHouse();
    if (!house) {
      const heroCard = document.getElementById('auction-hero-card');
      if (heroCard) renderHtml(heroCard, `<div style="color:#94a3b8; font-size:12px; padding:12px;">暂无选中的房屋</div>`);
      return;
    }

    const tInfo = getTierLabel(house.tier);
    const heroIcon = document.getElementById('auction-hero-icon');
    if (heroIcon) heroIcon.textContent = tInfo.icon;

    const heroName = document.getElementById('auction-hero-name');
    if (heroName) heroName.textContent = `${tInfo.name} #${house.id}`;

    const phasePill = document.getElementById('auction-hero-phase-pill');
    if (phasePill) {
      if (house.auctionPhase === '观察期') {
        phasePill.textContent = '🌾 麦穗37%观察期 (只摸底不卖)';
        phasePill.className = 'auction-phase-pill obs';
      } else if (house.auctionPhase === '决策期') {
        phasePill.textContent = '🎯 麦穗决策期 (出现更高报价即成交)';
        phasePill.className = 'auction-phase-pill dec';
      } else if (house.auctionPhase === '出清期') {
        phasePill.textContent = '⚠️ 10%修缮度强制出清';
        phasePill.className = 'auction-phase-pill clr';
      } else {
        phasePill.textContent = house.ownerId ? '正常私宅' : '挂牌拍卖中';
        phasePill.className = 'auction-phase-pill';
      }
    }

    const heroCamp = document.getElementById('auction-hero-camp');
    if (heroCamp) heroCamp.textContent = `🏕️ ${getCampTitle(house.campId)}`;

    const heroDetails = document.getElementById('auction-hero-details');
    if (heroDetails) {
      const upgStr = house.lastUpgraderId ? ` · 最近升级 Agent #${house.lastUpgraderId}` : '';
      heroDetails.textContent = `修缮耐久 ${house.durability.toFixed(1)}% · 房龄 ${Math.floor(house.age)}s · 立宅修建者 Agent #${house.builderId}${upgStr}`;
    }

    const heroPrice = document.getElementById('auction-hero-price');
    if (heroPrice) {
      renderHtml(heroPrice, `${(house.currentValuation || 0).toFixed(2)} <span style="font-size:12px; color:#f59e0b;">金</span>`);
    }

    const landStatus = document.getElementById('auction-hero-land-status');
    if (landStatus) {
      const campHouses = sim.houses.filter(h => h.campId === house.campId).length;
      const maxHouses = (sim.config && sim.config.campMaxHouses) || 30;
      if (campHouses < maxHouses) {
        renderHtml(landStatus, `<span style="color:#10b981;">🟢 闲置土地充裕 (${campHouses}/${maxHouses}栋) · 估价以自建成本为上限</span>`);
      } else {
        renderHtml(landStatus, `<span style="color:#f87171;">🔴 聚落土地告罄 (${campHouses}/${maxHouses}栋) · 供求绝对稀缺溢价</span>`);
      }
    }

    // 5. 麦穗 37% 时间轴标尺与动态指针
    renderTimeline(house);

    // 6. 辖区意向买家池
    renderBuyers(house);

    // 7. 实时竞价过程流水
    renderBidsFeed(house);
  }

  /**
   * 渲染麦穗 37% 博弈时间轴
   */
  function renderTimeline(house) {
    const startDur = house.auctionStartDurability || 100.0;
    const deadlineDur = 10.0;
    const curDur = Math.max(0, Math.min(100, house.durability));

    // 计算 37% 门槛耐久
    const span = Math.max(0.1, startDur - deadlineDur);
    const obs37Dur = startDur - 0.37 * span;

    // 时间轴全长表示 0% 到 100% 耐久（左端 0%，右端 100%）
    // 观察期区间: [obs37Dur, startDur]
    // 决策期区间: [deadlineDur, obs37Dur]
    // 强制出清区间: [0, deadlineDur]
    const obsLeft = obs37Dur;
    const obsWidth = Math.max(0, startDur - obs37Dur);

    const decLeft = deadlineDur;
    const decWidth = Math.max(0, obs37Dur - deadlineDur);

    const segObs = document.getElementById('timeline-seg-obs');
    if (segObs) {
      segObs.style.left = `${obsLeft}%`;
      segObs.style.width = `${obsWidth}%`;
    }

    const segDec = document.getElementById('timeline-seg-dec');
    if (segDec) {
      segDec.style.left = `${decLeft}%`;
      segDec.style.width = `${decWidth}%`;
    }

    const line37 = document.getElementById('timeline-line-37');
    if (line37) {
      line37.style.left = `${obs37Dur}%`;
    }

    // 移动指针坐落在当前耐久位置
    const needle = document.getElementById('timeline-current-needle');
    if (needle) {
      needle.style.left = `${curDur}%`;
    }
    const needleText = document.getElementById('needle-dur-text');
    if (needleText) {
      needleText.textContent = `${curDur.toFixed(1)}%`;
    }

    // 标尺参数数值
    const statStart = document.getElementById('timeline-stat-start');
    if (statStart) statStart.textContent = `${startDur.toFixed(1)}%`;

    const statDur = document.getElementById('timeline-stat-dur');
    if (statDur) statDur.textContent = `${curDur.toFixed(1)}%`;

    const stat37 = document.getElementById('timeline-stat-37dur');
    if (stat37) stat37.textContent = `${obs37Dur.toFixed(1)}%`;

    const statBench = document.getElementById('timeline-stat-bench');
    if (statBench) {
      statBench.textContent = house.benchmarkBid > 0 ? `${house.benchmarkBid.toFixed(2)} 金` : '暂无 (摸底中)';
    }

    const statHighest = document.getElementById('timeline-stat-highest');
    if (statHighest) {
      statHighest.textContent = house.highestBid > 0 ? `${house.highestBid.toFixed(2)} 金` : '暂无有效出价';
    }
  }

  /**
   * 渲染辖区意向买家池
   */
  function renderBuyers(house) {
    const buyersListEl = document.getElementById('auction-buyers-list');
    const buyersCountEl = document.getElementById('auction-buyers-count');
    if (!buyersListEl) return;

    const buyers = scanPotentialBuyers(house.campId, house.currentValuation);
    if (buyersCountEl) buyersCountEl.textContent = buyers.length;

    if (buyers.length === 0) {
      renderHtml(buyersListEl, `<div class="auction-empty-hint">当前聚落无单身/无房成年男性户主，暂无潜在买家</div>`);
      return;
    }

    renderHtml(buyersListEl, buyers.map(b => {
      const sameBadge = b.sameCamp
        ? `<span class="buyer-tag local">本地族人</span>`
        : `<span class="buyer-tag foreign">邻境移入</span>`;
      return `
        <div class="auction-buyer-card">
          <div class="buyer-card-left">
            <div class="buyer-card-name">
              <span class="lineage-chip" data-agent-id="${b.id}">👤 #${b.id} (${b.age}岁)</span>
              ${sameBadge}
            </div>
            <div class="buyer-card-status" style="color:${b.statusColor};">${b.status}</div>
          </div>
          <div class="buyer-card-right">
            <div class="buyer-gold-val">🪙 ${b.gold.toFixed(1)} 金</div>
            <button class="buyer-jump-btn" data-agent-id="${b.id}" title="聚焦并追踪该族人">定位 🔍</button>
          </div>
        </div>
      `;
    }).join(''));
  }

  /**
   * 渲染实时竞价过程流水
   */
  function renderBidsFeed(house) {
    const feedEl = document.getElementById('auction-bids-feed');
    const countEl = document.getElementById('auction-bids-count');
    if (!feedEl) return;

    const bids = house.recentBids || [];
    if (countEl) countEl.textContent = house.bidsCount || bids.length;

    if (bids.length === 0) {
      renderHtml(feedEl, `<div class="auction-empty-hint">等待营地中介开启报价轮询中… (每 3 秒评估一次)</div>`);
      return;
    }

    // 竞价流水
    renderHtml(feedEl, bids.map((b, idx) => {
      let verdict = '';
      let verdictColor = '#94a3b8';

      if (b.phase === '观察期') {
        verdict = '🌾 摸底样本 · 参与确立标杆';
        verdictColor = '#f59e0b';
      } else if (b.phase === '决策期') {
        verdict = (house.lastDealPrice != null && Math.abs(b.amount - house.lastDealPrice) < 0.01)
          ? '🎉 击中更优麦穗 · 达成交易！'
          : '🎯 决策期出价 (低于此前最高标杆)';
        verdictColor = (verdict.startsWith('🎉')) ? '#10b981' : '#38bdf8';
      } else {
        verdict = (house.lastDealPrice != null && Math.abs(b.amount - house.lastDealPrice) < 0.01)
          ? '⚠️ 强制出清成交 · 选最高出价交割'
          : '⚠️ 最终出清竞标出价';
        verdictColor = '#ef4444';
      }

      return `
        <div class="auction-bid-card">
          <div class="bid-card-header">
            <span class="bid-tick-tag">Tick #${b.tick}</span>
            <span class="lineage-chip" data-agent-id="${b.bidderId}">买方 #${b.bidderId} 🔍</span>
            <span class="bid-phase-badge ${b.phase === '观察期' ? 'obs' : (b.phase === '决策期' ? 'dec' : 'clr')}">${b.phase}</span>
          </div>
          <div class="bid-card-body">
            <div class="bid-amount">报价: <strong>🪙 ${b.amount.toFixed(2)} 金</strong></div>
            <div class="bid-verdict" style="color:${verdictColor};">${verdict}</div>
          </div>
        </div>
      `;
    }).join(''));
  }

  /**
   * 渲染历史成交记录视图
   */
  function renderHistoryView(deals) {
    const listEl = document.getElementById('auction-deals-list');
    if (!listEl) return;

    if (deals.length === 0) {
      renderHtml(listEl, `<div class="auction-empty-hint">暂无已完成的拍卖交易记录</div>`);
      return;
    }

    renderHtml(listEl, deals.map(d => {
      const t = getTierLabel(d.tier);
      return `
        <div class="auction-deal-card">
          <div class="deal-card-header">
            <div class="deal-card-title">
              <span>${t.icon} ${t.name} #${d.houseId}</span>
              <span class="deal-badge">已交割确权</span>
            </div>
            <div class="deal-tick-lbl">成交于 Tick #${d.tick}</div>
          </div>
          <div class="deal-card-grid">
            <div><strong>买受户主:</strong> <span class="lineage-chip" data-agent-id="${d.buyerId}">Agent #${d.buyerId} 🔍</span></div>
            <div><strong>成交金额:</strong> <strong style="color:#fbbf24;">🪙 ${d.price.toFixed(2)} 金</strong></div>
            <div><strong>交割修缮度:</strong> <span>${d.durability.toFixed(1)}%</span></div>
            <div><strong>成交事由:</strong> <span style="color:#10b981;">${d.reason || '房屋拍卖竞购'}</span></div>
          </div>
          <div class="deal-card-footer">
            <span>💰 黄金已由买方家庭账本划转至营地所属地区公仓</span>
            <button class="buyer-jump-btn" data-house-id="${d.houseId}">查看该房</button>
          </div>
        </div>
      `;
    }).join(''));
  }

  // ══════════ 事件委托与初始化绑定 ══════════
  function initEvents() {
    // 顶部栏按钮打开
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#btn-open-auction-modal');
      if (btn) openAuctionModal();
    });

    // 画布双击在售房屋直接打开大盘
    const canvas = document.getElementById('world-canvas');
    if (canvas) {
      canvas.addEventListener('dblclick', () => {
        const sim = getSim();
        if (sim && sim.selectionType === 'house' && sim.selectedHouseId != null) {
          const h = sim.houses.find(house => house.id === sim.selectedHouseId);
          if (h && h.ownerId == null && h.auctionPhase != null) {
            openAuctionModal(h.id);
          }
        }
      });
    }

    // Inspector 卡片内按钮打开
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#btn-open-auction-window');
      if (btn) {
        const sim = getSim();
        const hid = (sim && sim.selectionType === 'house') ? sim.selectedHouseId : null;
        openAuctionModal(hid);
      }
    });

    // 关闭按钮
    document.addEventListener('click', (e) => {
      if (e.target.closest('#house-auction-close') || e.target.closest('#btn-auction-footer-close')) {
        closeAuctionModal();
      }
    });

    // 遮罩点击关闭
    document.addEventListener('click', (e) => {
      if (e.target.id === 'house-auction-backdrop') closeAuctionModal();
    });

    // Tab 切换
    document.addEventListener('click', (e) => {
      if (e.target.closest('#tab-btn-active-auctions')) {
        currentTab = 'active';
        renderModal();
      } else if (e.target.closest('#tab-btn-history-deals')) {
        currentTab = 'history';
        renderModal();
      }
    });

    // 在售房屋条卡片选择
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.auction-strip-card');
      if (card && card.dataset.houseId) {
        currentHouseId = parseInt(card.dataset.houseId, 10);
        renderModal();
      }
    });

    // 地图定位当前房屋
    document.addEventListener('click', (e) => {
      if (e.target.closest('#btn-auction-focus-house')) {
        focusCurrentHouse();
      }
    });

    // 定位族人
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.buyer-jump-btn');
      if (btn && btn.dataset.agentId) {
        const aid = parseInt(btn.dataset.agentId, 10);
        focusAgent(aid);
      } else if (btn && btn.dataset.houseId) {
        const hid = parseInt(btn.dataset.houseId, 10);
        currentHouseId = hid;
        currentTab = 'active';
        renderModal();
      }
    });

    // 族人芯片点击支持追踪
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.lineage-chip');
      if (chip && chip.dataset.agentId && isOpen) {
        const aid = parseInt(chip.dataset.agentId, 10);
        focusAgent(aid);
      }
    });

    // Esc 快捷键关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isAuctionModalOpen()) {
        closeAuctionModal();
        e.stopPropagation();
      }
    }, true);
  }

  // 每一帧在 render_canvas.js 主循环中调用
  window._auctionUiTick = function () {
    const sim = getSim();
    if (!sim) return;

    // 同步顶部栏数字徽章
    const topCountEl = document.getElementById('top-auction-count');
    if (topCountEl) {
      const activeCount = sim.houses ? sim.houses.filter(h => h.ownerId == null && h.auctionPhase != null).length : 0;
      topCountEl.textContent = activeCount;
      const barBtn = document.getElementById('btn-open-auction-modal');
      if (barBtn) {
        if (activeCount > 0) {
          barBtn.classList.add('has-active');
        } else {
          barBtn.classList.remove('has-active');
        }
      }
    }

    if (isOpen) {
      renderModal();
    }
  };

  window.openAuctionModal = openAuctionModal;
  window.closeAuctionModal = closeAuctionModal;
  window.isAuctionModalOpen = isAuctionModalOpen;

  document.addEventListener('DOMContentLoaded', initEvents);
})();
