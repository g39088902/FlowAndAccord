// === Inspector POI 视图面板（自 render_inspector.js 拆出；由调度层传入 views 解构） ===
function updatePoiInspector(poi, views) {
  const { agentView, poiView, houseView, followBtn } = views;
    agentView.style.display = 'none';
    houseView.style.display = 'none';
    poiView.style.display = 'flex';
    if (followBtn) followBtn.style.display = 'none';

    const poiIcon = poi.type === 'Camp' ? ((poi.level || 0) >= 4 ? '🏛️' : ((poi.level || 0) >= 2 ? '🏘️' : '🏕️')) : (poi.type === 'Market' ? '🏪' : (poi.type === 'Water' ? '💧' : (poi.type === 'Berry' ? '🍒' : (poi.type === 'Wood' ? '🌲' : (poi.type === 'Gold' ? '🪙' : '🪨')))));
    document.getElementById('insp-title-name').textContent = poi.type === 'Camp' ? `${poiIcon} ${poi.campTitle || poi.name}` : `${poiIcon} ${poi.name}`;

    // ★ v1.12.0 营地删除标题右侧 state-badge；等级+辖房数移入晋升条标题
    const titleStateEl = document.getElementById('insp-title-state');
    if (poi.type === 'Camp') {
      if (titleStateEl) titleStateEl.style.display = 'none';
    } else {
      if (titleStateEl) titleStateEl.style.display = '';
      let stateBadge = '资源充足';
      let badgeColor = '#10b981';
      if (poi.type === 'Market') {
        stateBadge = '🏪 边境榷市';
        badgeColor = '#10b981';
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
      titleStateEl.textContent = stateBadge;
      titleStateEl.style.color = badgeColor;
    }

    const stockRow = document.getElementById('insp-poi-stock-row');
    const secondaryStockRow = document.getElementById('insp-poi-secondary-stock-row');
    const tertiaryStockRow = document.getElementById('insp-poi-tertiary-stock-row');
    const campUpgradeRow = document.getElementById('insp-camp-upgrade-row');
    const marketBox = document.getElementById('insp-market-box');

    if (poi.type === 'Camp') {
      if (marketBox) marketBox.style.display = 'none';
      stockRow.style.display = 'none';
      if (secondaryStockRow) secondaryStockRow.style.display = 'none';
      if (tertiaryStockRow) tertiaryStockRow.style.display = 'none';
      if (campUpgradeRow) {
        campUpgradeRow.style.display = 'flex';
        const lvlNames = ['原始营地 (1阶)', '村落 (2阶)', '乡集 (3阶)', '集镇 (4阶)', '县邑 (5阶)'];
        const vacantCount = (poi.vacantHouses && poi.vacantHouses.length) || 0;
        const cfg = window.SIM_CONFIG || {};
        const levelThresholds = [0, cfg.campLevelVillageMinHouses || 5, cfg.campLevelTownshipMinHouses || 10, cfg.campLevelTownMinHouses || 15, cfg.campLevelCountyMinHouses || 20];
        const level = poi.level || 0;
        const nextTarget = levelThresholds[Math.min(level + 1, 4)];
        const prevTarget = levelThresholds[level];
        const count = poi.boundHouses || 0;
        const nextName = ['村落', '乡集', '集镇', '县邑'][level] || '县邑';
        const nextTitle = `${nextName} (${nextTarget}房)`;
        const lvlLabel = `${lvlNames[level]} · 辖 ${count} 房${vacantCount > 0 ? ` · ${vacantCount}空置` : ''}`;

        if (level >= 4) {
          document.getElementById('lbl-camp-upgrade-title').textContent = `🏛️ ${lvlLabel} (已达最高级)`;
          document.getElementById('insp-camp-upgrade-val').textContent = `${count} 间私宅`;
          document.getElementById('insp-camp-upgrade-fill').style.width = '100%';
        } else {
          const ratio = Math.min(100, Math.round(((count - prevTarget) / (nextTarget - prevTarget)) * 100));
          document.getElementById('lbl-camp-upgrade-title').textContent = `🏛️ ${lvlLabel} → 晋升 ${nextTitle}`;
          document.getElementById('insp-camp-upgrade-val').textContent = `${count} / ${nextTarget} 间房`;
          document.getElementById('insp-camp-upgrade-fill').style.width = `${Math.max(0, ratio)}%`;
        }
      }
    } else if (poi.type === 'Market') {
      stockRow.style.display = 'none';
      if (secondaryStockRow) secondaryStockRow.style.display = 'none';
      if (tertiaryStockRow) tertiaryStockRow.style.display = 'none';
      if (campUpgradeRow) campUpgradeRow.style.display = 'none';
      if (marketBox) {
        marketBox.style.display = 'flex';
        const totalSold = (poi.cumulativeSoldWater || 0) + (poi.cumulativeSoldFood || 0) + (poi.cumulativeSoldWood || 0);
        const totalRevenue = poi.cumulativeRevenue || 0;
        const soldEl = document.getElementById('insp-market-total-sold');
        if (soldEl) soldEl.textContent = `${totalSold.toFixed(1)} 单位`;
        const breakdownEl = document.getElementById('insp-market-sold-breakdown');
        if (breakdownEl) breakdownEl.textContent = `💧${(poi.cumulativeSoldWater || 0).toFixed(1)} · 🍒${(poi.cumulativeSoldFood || 0).toFixed(1)} · 🌲${(poi.cumulativeSoldWood || 0).toFixed(1)}`;
        const revEl = document.getElementById('insp-market-total-revenue');
        if (revEl) revEl.textContent = `${totalRevenue.toFixed(2)} 金`;

        const multPrimary = poiRegenMultiplier(poi.type, 'primary');
        const effPrimary = effectiveRegenRate(poi.regenRate, multPrimary);
        const multSecondary = poiRegenMultiplier(poi.type, 'secondary');
        const effSecondary = effectiveRegenRate(poi.secondaryRegenRate, multSecondary);
        const multTertiary = poiRegenMultiplier(poi.type, 'tertiary');
        const effTertiary = effectiveRegenRate(poi.tertiaryRegenRate, multTertiary);

        // 💧 清水
        const waterPriceEl = document.getElementById('insp-market-water-price');
        if (waterPriceEl) waterPriceEl.textContent = `${(poi.waterPrice || 0.1).toFixed(2)} 金`;
        const waterFillEl = document.getElementById('insp-market-water-fill');
        const waterRatio = poi.maxStock > 0 ? Math.round((poi.currentStock / poi.maxStock) * 100) : 0;
        if (waterFillEl) waterFillEl.style.width = `${Math.max(0, Math.min(100, waterRatio))}%`;
        const waterStockEl = document.getElementById('insp-market-water-stock');
        if (waterStockEl) waterStockEl.textContent = `${poi.currentStock.toFixed(1)}/${poi.maxStock.toFixed(0)}`;
        const waterRegenEl = document.getElementById('insp-market-water-regen');
        if (waterRegenEl) waterRegenEl.textContent = `+${effPrimary.toFixed(1)}/h`;

        // 🍒 粮食
        const foodPriceEl = document.getElementById('insp-market-food-price');
        if (foodPriceEl) foodPriceEl.textContent = `${(poi.foodPrice || 0.1).toFixed(2)} 金`;
        const foodFillEl = document.getElementById('insp-market-food-fill');
        const foodMax = poi.secondaryMaxStock || 400;
        const foodRatio = foodMax > 0 ? Math.round(((poi.secondaryStock || 0) / foodMax) * 100) : 0;
        if (foodFillEl) foodFillEl.style.width = `${Math.max(0, Math.min(100, foodRatio))}%`;
        const foodStockEl = document.getElementById('insp-market-food-stock');
        if (foodStockEl) foodStockEl.textContent = `${(poi.secondaryStock || 0).toFixed(1)}/${foodMax.toFixed(0)}`;
        const foodRegenEl = document.getElementById('insp-market-food-regen');
        if (foodRegenEl) foodRegenEl.textContent = `+${effSecondary.toFixed(1)}/h`;

        // 🌲 木料
        const woodPriceEl = document.getElementById('insp-market-wood-price');
        if (woodPriceEl) woodPriceEl.textContent = `${(poi.woodPrice || 0.15).toFixed(2)} 金`;
        const woodFillEl = document.getElementById('insp-market-wood-fill');
        const woodMax = poi.tertiaryMaxStock || 400;
        const woodRatio = woodMax > 0 ? Math.round(((poi.tertiaryStock || 0) / woodMax) * 100) : 0;
        if (woodFillEl) woodFillEl.style.width = `${Math.max(0, Math.min(100, woodRatio))}%`;
        const woodStockEl = document.getElementById('insp-market-wood-stock');
        if (woodStockEl) woodStockEl.textContent = `${(poi.tertiaryStock || 0).toFixed(1)}/${woodMax.toFixed(0)}`;
        const woodRegenEl = document.getElementById('insp-market-wood-regen');
        if (woodRegenEl) woodRegenEl.textContent = `+${effTertiary.toFixed(1)}/h`;
      }
    } else {
      if (marketBox) marketBox.style.display = 'none';
      if (campUpgradeRow) campUpgradeRow.style.display = 'none';
      stockRow.style.display = 'flex';
      if (secondaryStockRow) secondaryStockRow.style.display = 'none';
      if (tertiaryStockRow) tertiaryStockRow.style.display = 'none';
      const ratio = Math.round((poi.currentStock / poi.maxStock) * 100);
      // ★ v1.22.6 上限取快照真实 maxStock，避免标题写死 60.0 与下方数值自相矛盾
      const capText = `上限${poi.maxStock.toFixed(1)}`;
      if (poi.type === 'Water') {
        document.getElementById('lbl-poi-stock-title').textContent = `清泉蓄水量 (${capText})`;
        document.getElementById('insp-poi-stock-fill').style.background = '#38bdf8';
      } else if (poi.type === 'Berry') {
        document.getElementById('lbl-poi-stock-title').textContent = `成熟浆果 (${capText})`;
        document.getElementById('insp-poi-stock-fill').style.background = '#10b981';
      } else if (poi.type === 'Wood') {
        document.getElementById('lbl-poi-stock-title').textContent = `林木木材 (${capText})`;
        document.getElementById('insp-poi-stock-fill').style.background = '#b45309';
      } else if (poi.type === 'Stone') {
        document.getElementById('lbl-poi-stock-title').textContent = `石矿石料 (${capText})`;
        document.getElementById('insp-poi-stock-fill').style.background = '#94a3b8';
      } else if (poi.type === 'Gold') {
        document.getElementById('lbl-poi-stock-title').textContent = `璀璨金矿 (${capText})`;
        document.getElementById('insp-poi-stock-fill').style.background = '#fbbf24';
      }
      document.getElementById('insp-poi-stock-val').textContent = `${poi.currentStock.toFixed(1)} / ${poi.maxStock.toFixed(1)} 单位`;
      document.getElementById('insp-poi-stock-fill').style.width = `${Math.max(0, Math.min(100, isFinite(ratio) ? ratio : 0))}%`;
    }

    // ★ v1.37.2 营地一级卡片展示国王 + 地区国库公仓 + 详情按钮
    const kingdomBox = document.getElementById('insp-camp-kingdom-box');
    if (kingdomBox) {
      const region = sim.regions.find(r => r.campId === poi.id);
      if (poi.type === 'Camp' && region) {
        kingdomBox.style.display = 'flex';
        const kingEl = document.getElementById('insp-camp-king');
        if (kingEl) {
          if (region.kingId != null) {
            const kingAgent = sim.getAgent ? sim.getAgent(region.kingId) : null;
            const kingPrivy = kingAgent && kingAgent.cumulativeRoyalPrivy != null ? kingAgent.cumulativeRoyalPrivy : (region.cumulativeRoyalPrivy || 0);
            const debugPrivyTag = sim.debugMode ? `<span style="margin-left:6px; font-size:10px; color:#fbbf24; font-weight:600;" title="🐞 调试模式：现任国王收到内帑总物资">内帑: ${kingPrivy.toFixed(1)} 📦</span>` : '';
            const kingLabel = `👑 Agent #${region.kingId}`;
            const chipHtml = window.EntityLink
              ? window.EntityLink.agent(region.kingId, kingLabel, { title: '点击追踪国王视角' })
              : `<button type="button" class="entity-link entity-link-agent lineage-chip" data-entity-kind="agent" data-entity-id="${region.kingId}" data-agent-id="${region.kingId}" title="点击追踪国王视角">${kingLabel}</button>`;
            const nextHtml = `${chipHtml}${debugPrivyTag}`;
            if (kingEl.innerHTML !== nextHtml) {
              kingEl.innerHTML = nextHtml;
            }
          } else {
            const regionPrivy = region.cumulativeRoyalPrivy || 0;
            const debugPrivyTag = (sim.debugMode && regionPrivy > 0) ? `<span style="margin-left:6px; font-size:10px; color:#fbbf24; font-weight:600;" title="🐞 调试模式：该王国历史累计拨付内帑总物资">内帑: ${regionPrivy.toFixed(1)} 📦</span>` : '';
            const nextHtml = `<span style="color:#ef4444;">王位空缺（可被夺位）</span>${debugPrivyTag}`;
            if (kingEl.innerHTML !== nextHtml) {
              kingEl.innerHTML = nextHtml;
            }
          }
        }

        // ★ v1.37.2 营地卡片国库信息展示（水/粮/木/石/金 五品类公仓余额与总存量）
        const b = region.balances || {};
        const wVal = (b.Water || 0);
        const fVal = (b.Food || 0);
        const wdVal = (b.Wood || 0);
        const sVal = (b.Stone || 0);
        const gVal = (b.Gold || 0);
        const total = wVal + fVal + wdVal + sVal + gVal;

        const totalEl = document.getElementById('insp-camp-treasury-total');
        if (totalEl) totalEl.textContent = `总存量 ${total.toFixed(1)}`;
        const twEl = document.getElementById('insp-camp-treasury-water');
        if (twEl) twEl.textContent = wVal.toFixed(1);
        const tfEl = document.getElementById('insp-camp-treasury-food');
        if (tfEl) tfEl.textContent = fVal.toFixed(1);
        const twdEl = document.getElementById('insp-camp-treasury-wood');
        if (twdEl) twdEl.textContent = wdVal.toFixed(1);
        const tsEl = document.getElementById('insp-camp-treasury-stone');
        if (tsEl) tsEl.textContent = sVal.toFixed(1);
        const tgEl = document.getElementById('insp-camp-treasury-gold');
        if (tgEl) tgEl.textContent = gVal.toFixed(1);
      } else {
        kingdomBox.style.display = 'none';
      }
    }

    // ★ v1.12.0 营地删除 poi-info-badge（产出速率）和描述文本
    // ★ v1.22.6 移除「地形地貌 / 所属辖区」两行（TODO-2），产出速率改为生效值 = 基准 × 生态大盘倍率
    const poiInfoBadge = document.getElementById('insp-poi-info-badge');
    const detailTextEl = document.getElementById('insp-detail-text');
    const regenSecondaryRow = document.getElementById('insp-poi-regen-secondary-row');
    const regenTertiaryRow = document.getElementById('insp-poi-regen-tertiary-row');
    const marketTrades = document.getElementById('insp-market-trades');
    if (poi.type === 'Camp') {
      if (poiInfoBadge) poiInfoBadge.style.display = 'none';
      if (detailTextEl) detailTextEl.style.display = 'none';
      if (regenSecondaryRow) regenSecondaryRow.style.display = 'none';
      if (regenTertiaryRow) regenTertiaryRow.style.display = 'none';
      if (marketTrades) marketTrades.style.display = 'none';
    } else {
      if (poiInfoBadge) poiInfoBadge.style.display = poi.type === 'Market' ? 'none' : '';
      if (detailTextEl) detailTextEl.style.display = '';

    const multPrimary = poiRegenMultiplier(poi.type, 'primary');
    const effPrimary = effectiveRegenRate(poi.regenRate, multPrimary);
    let regenText;
    if (poi.type === 'Camp') {
      regenText = `无限储量 (公共避风聚落)`;
    } else if (poi.type === 'Berry' && poi.regenRate <= 0.0001) {
      regenText = `❄️ 冰封绝收 (0.00 单位/小时 · 气温≤0℃)`;
    } else if (poi.type === 'Berry' && window.SIM_CONFIG && (window.SIM_CONFIG.berryFrostDeclineTemp || 8.0) > (sim.temperature ?? 20)) {
      regenText = `+${effPrimary.toFixed(2)} 单位/小时 (🍂 霜冻减产 · 当前气温 ${(sim.temperature ?? 0).toFixed(1)}℃)`;
    } else if (poi.regenRate > 0) {
      regenText = `+${effPrimary.toFixed(2)} 单位/小时 (基准 ${poi.regenRate.toFixed(2)} × ${multPrimary.toFixed(1)}x)`;
    } else {
      regenText = `+${effPrimary.toFixed(2)} 单位/小时 (停止产出)`;
    }
    document.getElementById('insp-poi-regen').textContent = regenText;

    // 第二条产速：仅榷场（粮食，复用浆果倍率槽位）
      if (regenSecondaryRow) {
      if (poi.type === 'Market') {
        regenSecondaryRow.style.display = '';
        const multSecondary = poiRegenMultiplier(poi.type, 'secondary');
        const effSecondary = effectiveRegenRate(poi.secondaryRegenRate, multSecondary);
        document.getElementById('insp-poi-regen-secondary').textContent =
          `+${effSecondary.toFixed(2)} 单位/小时 (基准 ${poi.secondaryRegenRate.toFixed(2)} × ${multSecondary.toFixed(1)}x)`;
      } else {
        regenSecondaryRow.style.display = 'none';
      }
    }

    // ★ v1.36.0 第三条产速：仅榷场（木材，复用林木倍率槽位）
      if (regenTertiaryRow) {
      if (poi.type === 'Market') {
        regenTertiaryRow.style.display = '';
        const multTertiary = poiRegenMultiplier(poi.type, 'tertiary');
        const effTertiary = effectiveRegenRate(poi.tertiaryRegenRate, multTertiary);
        document.getElementById('insp-poi-regen-tertiary').textContent =
          `+${effTertiary.toFixed(2)} 单位/小时 (基准 ${poi.tertiaryRegenRate.toFixed(2)} × ${multTertiary.toFixed(1)}x)`;
      } else {
        regenTertiaryRow.style.display = 'none';
      }
    }
      if (marketTrades) {
        if (poi.type === 'Market') {
          marketTrades.style.display = '';
          const list = document.getElementById('insp-market-trades-list');
          if (list) {
            // ★ v1.28.0 数据源改为榷场自带环形流水（不再扫描家户账本；家户账本只记黄金流出且会被冲掉）
            // ★ v1.35.1 榷场流水精简：仅保留资源 emoji（🍒/💧/🌲），省略文字描述
            const rows = (poi.marketTrades || []).slice(0, 8);
            const html = rows.length ? rows.map(t => {
              const icon = t.resource === 'Food' ? '🍒' : (t.resource === 'Wood' ? '🌲' : '💧');
              const hh = (t.householdId === null || t.householdId === undefined) ? '无家户' : ('家户#' + t.householdId);
              return `<div style="font-size:10px;color:#fbbf24;">t${t.tick} · 族人#${t.agentId} · ${hh} · ${icon} ${Number(t.amount || 0).toFixed(1)} · 单价 ${Number(t.unitPrice || 0).toFixed(2)}金 · 支出 ${Number(t.goldCost || 0).toFixed(2)}金</div>`;
            }).join('') : '<span style="color:#64748b;">暂无交易记录</span>';
            // ★ 高频重建容器：内容快照缓存，避免每帧 innerHTML 重建打断交互（根 AGENTS.md §4.15）
            if (list.innerHTML !== html) list.innerHTML = html;
          }
        } else marketTrades.style.display = 'none';
      }

      let desc = `【${poi.campTitle || poi.name}】公共避风聚落(储量无限)，族人在此休养回体与繁衍。辖内已自发落成 ${poi.boundHouses || 0} 间私宅，随房屋增加逐步升级为【营地 → 村 → 乡 → 镇 → 县】！`;
    // ★ v1.22.6 产速不再写死，统一读 SIM_CONFIG 基准值（根 AGENTS.md §4.12 禁止散落字面量）
    const cfg = (typeof window !== 'undefined' && window.SIM_CONFIG) || {};
    const baseRateOf = key => (typeof cfg[key] === 'number' ? cfg[key] : 0);
    if (poi.type === 'Water') desc = `低洼处天然地泉(上限${poi.maxStock.toFixed(0)}单位,基准产速${baseRateOf('regenBaseWater').toFixed(1)}/h)，小人饮水并补给家宅。`;
    else if (poi.type === 'Berry') desc = `向阳缓坡野生灌木(上限${poi.maxStock.toFixed(0)}单位,基准产速${baseRateOf('regenBaseBerry').toFixed(1)}/h)，小人采食并补给家宅。`;
    else if (poi.type === 'Wood') desc = `茂密原生林地(上限${poi.maxStock.toFixed(0)}单位,基准产速${baseRateOf('regenBaseWood').toFixed(1)}/h)，伐木用于冬季房屋供暖与升级茅草房。`;
    else if (poi.type === 'Stone') desc = `嶙峋高地石矿(上限${poi.maxStock.toFixed(0)}单位,基准产速${baseRateOf('regenBaseStone').toFixed(1)}/h)，采石仅用于私宅升级木石庄舍与大庄园。`;
    else if (poi.type === 'Gold') desc = `璀璨金矿(上限${poi.maxStock.toFixed(0)}单位,基准产速${baseRateOf('regenBaseGold').toFixed(1)}/h)，开采黄金装入随身行囊(黄金无限容量，单趟运满20回宅入库)，存入私宅金库用于晋升最高级氏族大庄园。`;
    else if (poi.type === 'Market') desc = `外部边境常驻榷场互市，为部落提供清水、粮食与木材商贸。各物资牌价随供需幂律动态浮动，交易黄金由户主家户账本远程结算并回收。`;
    document.getElementById('insp-detail-text').textContent = desc;
    }
}
