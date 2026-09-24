// === Inspector 族人视图面板主体（自 render_inspector.js 拆出） ===
// 家族血脉与世系族谱子层见 inspector-lineage.js（updateAgentLineage）；
// 激素面板见 inspector-hormone.js（updateHormonePanel）。
function updateAgentInspector(selAgent, views) {
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
    let detailText = selAgent.homeHouseId ? '在专属家宅中安居，夫妻与子女共享水粮木石储备，冬季房屋自动供暖；★ v1.28.0 户主（男性）名下住宅需 ≥1 级（非0级仓库）且夫妻身体指标达标才可孕育。' : '在露天营地休息，无私宅不可受孕。';

    if (selAgent.isFetus) {
      // ★ M1.7 腹中胎儿：已获 agent 身份，但不占地图实体、不行动、不消耗
      stateText = '🤰 腹中孕育中';
      detailText = '在母亲腹中孕育，尚未出生。已获完整 agent 身份（可继承、可被卡片追踪），但不设置地图实体、跳过行动决策，也不产生任何需求消耗。出生后将转为正常新生儿。';
    } else if (!selAgent.isAlive) {
      const isDecaying = typeof selAgent.deathDecayTimer === 'number' && selAgent.deathDecayTimer > 0;
      stateText = isDecaying ? '💀 刚离世' : '💀 已故先祖';
      detailText = isDecaying
        ? `死因: ${selAgent.deathCause || '未知饥荒'} (遗骸将在 ${Math.ceil(selAgent.deathDecayTimer)}小时 后消逝)`
        : `死因: ${selAgent.deathCause || '寿终正寝/未知'} (已入土长眠，载入族谱先祖志)`;
    } else if (selAgent.state === 'RestingAtCamp') {
      if (selAgent.stamina < 99.5) {
        const restRate = (8.0 * (selAgent.sleepEfficiency || 100) / 100).toFixed(1);
        stateText = (selAgent.homeHouseId ? '🏡 私宅休养' : '🏕️ 营地休养') + ' (+' + restRate + '%/h)';
        detailText = '正在家宅/营地静坐休养，体力恢复速率 = 8.0%/h × 睡眠效率/100 (' + restRate + '%/h)，睡眠效率越高休息越快，恢复至 100% 满值后方可开展后续工作。';
      } else {
        stateText = selAgent.homeHouseId ? '🏡 私宅安居' : '🏕️ 营地驻留';
        detailText = '体力充盈至 100% 且温饱无虞，安居静候下一个生活/营建需求。';
      }
    } else if (selAgent.state === 'ConstructingHouse') {
      const progPct = Math.round((selAgent.buildTimer / 30.0) * 100);
      stateText = `🔨 营建中 (${progPct}%)`;
      detailText = '投入体力与工时营建或升级私宅(30小时工期)，完成后将扩容储备空间并激活/保障繁衍孕育。';
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
    } else if (selAgent.state === 'SeekingCourtship') {
      const targetStr = selAgent.courtshipTargetId ? ` (#${selAgent.courtshipTargetId})` : '';
      stateText = '💍 前往求偶' + targetStr;
      detailText = `正在前往寻访全图魅力最高的单身女性${targetStr}，准备向其求偶并迎娶入家户。`;
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
        ageValElem.textContent = `${Math.floor(selAgent.age)}小时 · ${isFemale ? '已成年♀' : '已成年♂'}`;
        ageValElem.style.color = isFemale ? '#ec4899' : '#38bdf8';
      } else {
        const needGrow = Math.ceil(1800.0 - selAgent.age);
        ageValElem.textContent = `${Math.floor(selAgent.age)}小时 · 🍼幼年(需${needGrow}小时)`;
        ageValElem.style.color = '#a78bfa';
      }
    }

    // 🌟 族人副栏威望徽章展示
    const prestigeBadge = document.getElementById('insp-prestige-badge');
    if (prestigeBadge) {
      const p = selAgent.prestige || 0;
      if (p > 0) {
        prestigeBadge.style.display = 'inline-flex';
        prestigeBadge.textContent = `🌟 威望 ${p}`;
        prestigeBadge.style.color = p >= 5 ? '#fbbf24' : (p > 0 ? '#a78bfa' : '#64748b');
        prestigeBadge.style.borderColor = p >= 5 ? 'rgba(251, 191, 36, 0.4)' : 'rgba(167, 139, 250, 0.3)';
        prestigeBadge.style.background = p >= 5 ? 'rgba(251, 191, 36, 0.12)' : 'rgba(167, 139, 250, 0.1)';
      } else {
        prestigeBadge.style.display = 'none';
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
          maslowBox.style.display = 'flex';
          maslowBox.style.borderColor = need.color + '66';
          maslowBadge.textContent = `${need.icon} ${need.numeral} ${need.name} · ${need.kindLabel}`;
          maslowBadge.style.color = need.color;
          maslowBadge.style.borderColor = need.color;
          maslowBadge.style.background = need.color + '1a';
          maslowReason.textContent = need.reason;
        } else if (selAgent.state === 'RestingAtCamp') {
          maslowBox.style.display = 'flex';
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

    // ★ M19.4a 决策与行动中枢三栏透视与瞬发高亮更新
    const instantPill = document.getElementById('insp-instant-pill');
    const instantText = document.getElementById('insp-instant-text');
    if (instantPill && instantText) {
      let instMsg = null;
      if (selAgent.coronationPending != null) {
        instMsg = `加冕登基 @ 营地 #${selAgent.coronationPending}`;
      } else if (selAgent.courtshipPending != null) {
        instMsg = `登记完婚 @ 伴侣 #${selAgent.courtshipPending}`;
      } else if (selAgent.raiseChildPending) {
        instMsg = `生育后代 · 受孕结算`;
      } else if (selAgent.pendingBidHouseIds && selAgent.pendingBidHouseIds.length > 0) {
        instMsg = `竞购住宅 · 出价 @ 房屋 #${selAgent.pendingBidHouseIds[0]}`;
      } else if (selAgent.pendingHousePos) {
        instMsg = `建立家宅 · 选址待落成`;
      }
      if (instMsg && selAgent.isAlive && !selAgent.isFetus) {
        instantText.textContent = instMsg;
        instantPill.style.display = 'inline-flex';
      } else {
        instantPill.style.display = 'none';
      }
    }

    const elBranch = document.getElementById('insp-task-branch');
    const elLevel = document.getElementById('insp-task-level');
    const elCompletion = document.getElementById('insp-task-completion');
    const elStrategy = document.getElementById('insp-task-strategy');
    const elTarget = document.getElementById('insp-task-target');
    const elStage = document.getElementById('insp-task-stage');
    const elPrimitive = document.getElementById('insp-task-primitive');
    const elPrimDetail = document.getElementById('insp-task-prim-detail');
    const elStatus = document.getElementById('insp-task-status');
    const elItineraryRow = document.getElementById('insp-task-itinerary-row');
    const elItinerary = document.getElementById('insp-task-itinerary');

    if (elBranch && elLevel && elCompletion && elStrategy && elTarget && elStage && elPrimitive && elPrimDetail && elStatus) {
      const task = selAgent.activeTask || selAgent.active_task;
      if (task) {
        const branchMeta = window.SIM_DECISION_VIZ_DATA && window.SIM_DECISION_VIZ_DATA.BRANCH_MAP
          ? window.SIM_DECISION_VIZ_DATA.BRANCH_MAP[task.branch]
          : null;
        const branchName = branchMeta ? branchMeta.zh : (task.branchDesc || task.branch_desc || '未知分支');
        elBranch.textContent = `${task.branch} ${branchName}`;
        elBranch.title = `${task.branch} (${task.intentKind || task.intent_kind || ''})`;

        const lvlMap = {
          Physiological: '① 生理',
          Safety: '② 安全',
          Belonging: '③ 归属',
          Esteem: '④ 尊重',
          SelfActualization: '⑤ 实现',
          Instantaneous: '⓪ 瞬发',
        };
        elLevel.textContent = lvlMap[task.level] || task.level || '--';
        elLevel.title = task.level || '';

        // 判据友好化展示
        let compText = task.completion || '--';
        if (compText.includes('HouseholdStockSatisfied')) compText = '储备补足';
        else if (compText.includes('SurvivalSatisfied')) compText = '饱渴满足';
        else if (compText.includes('GoldTripFinished')) compText = '运金满载';
        else if (compText.includes('RecoveryFinished')) compText = '休养充沛';
        else if (compText.includes('HomeRepaired')) compText = '修缮竣工';
        else if (compText.includes('HomeAtTier')) compText = '晋升落成';
        else if (compText.includes('HomeFounded')) compText = '立宅完成';
        else if (compText.includes('MarriageRegistered')) compText = '结为连理';
        else if (compText.includes('CoronationRegistered')) compText = '登基为王';
        else if (compText.includes('ChildcareSettled')) compText = '养育落实';
        elCompletion.textContent = compText;
        elCompletion.title = task.completion || '';

        const stratMap = {
          WildHarvest: '野外采收',
          MarketTrade: '采购物资',
          ReturnToResidence: '返家休整',
          Courtship: '求偶成家',
          ClaimThrone: '争取王位',
          Childcare: '返宅生育',
          FoundHome: '建立家宅',
          UpgradeHome: '改善住宅',
          RepairHome: '修缮住宅',
        };
        elStrategy.textContent = stratMap[task.strategyKind || task.strategy_kind] || task.strategyKind || task.strategy_kind || '--';

        let targetText = '--';
        const tid = task.targetId !== undefined ? task.targetId : task.target_id;
        const ttype = task.targetType || task.target_type;
        if (ttype === 'Poi' && tid != null) {
          const poi = (sim.pois || []).find(p => p.id === tid);
          targetText = poi ? `${poi.name || poi.campTitle || ('POI #' + tid)}` : `POI #${tid}`;
        } else if (ttype === 'House' && tid != null) {
          targetText = `私宅 #${tid}`;
        } else if (ttype === 'Camp' && tid != null) {
          targetText = `营地 #${tid}`;
        } else if (ttype === 'Agent' && tid != null) {
          targetText = `族人 #${tid}`;
        }
        elTarget.textContent = targetText;
        elTarget.title = `${ttype || 'None'}: ${tid != null ? tid : '无'}`;

        const stageMap = {
          Outbound: '去程在途',
          OnSite: '现场作业',
          Returning: '携货返程',
          Unloading: '入库卸货',
          Travelling: '在途奔赴',
          Recovering: '驻留恢复',
          Ready: '就绪结算',
          AwaitingSettlement: '等待世界',
          Working: '施工劳作',
        };
        elStage.textContent = stageMap[task.stage] || task.stage || '--';
        elStage.title = `阶段: ${task.stage || ''}`;

        const primMap = {
          Navigate: '沿路导航',
          Hold: '驻留作业',
          AwaitSettlement: '物理结算',
        };
        elPrimitive.textContent = primMap[task.primitiveKind || task.primitive_kind] || task.primitiveKind || task.primitive_kind || '--';

        const pDetail = task.primitiveDetail || task.primitive_detail || '--';
        elPrimDetail.textContent = pDetail.length > 9 ? pDetail.substring(0, 9) + '…' : pDetail;
        elPrimDetail.title = pDetail;

        elStatus.textContent = selAgent.velocity > 0.01 ? `${selAgent.velocity.toFixed(1)}m/s` : '原地进行';
        elStatus.style.color = selAgent.velocity > 0.01 ? '#38bdf8' : '#34d399';

        if (elItineraryRow && elItinerary) {
          const itin = task.itinerary || '--';
          if (itin && itin !== '--') {
            elItineraryRow.style.display = 'flex';
            elItinerary.textContent = itin;
            elItinerary.title = `多品类预排采收链路: ${itin}`;
          } else {
            elItineraryRow.style.display = 'none';
          }
        }
      } else if (selAgent.isAlive && !selAgent.isFetus) {
        if (elItineraryRow) elItineraryRow.style.display = 'none';
        // 闲适休养状态
        elBranch.textContent = 'b3 恢复体力';
        elBranch.title = 'b3 恢复体力 / 营地休养';
        elLevel.textContent = '① 生理';
        elLevel.title = 'Physiological';
        elCompletion.textContent = selAgent.stamina >= 99.5 ? '充沛满值' : '恢复中';
        elStrategy.textContent = selAgent.homeHouseId ? '私宅安居' : '营地驻留';
        elTarget.textContent = selAgent.homeHouseId ? `私宅 #${selAgent.homeHouseId}` : '露天营地';
        elStage.textContent = selAgent.stamina >= 99.5 ? '安居静候' : '休养回体';
        elPrimitive.textContent = '静止驻留';
        elPrimDetail.textContent = selAgent.homeHouseId ? 'Residence' : 'Camp';
        elStatus.textContent = `${Math.round(selAgent.stamina)}% 体力`;
        elStatus.style.color = '#10b981';
      } else {
        if (elItineraryRow) elItineraryRow.style.display = 'none';
        // 胎儿或亡故
        elBranch.textContent = '--';
        elLevel.textContent = selAgent.isFetus ? '孕育' : '终态';
        elCompletion.textContent = selAgent.isFetus ? '待分娩' : '入土长眠';
        elStrategy.textContent = selAgent.isFetus ? '母腹中' : '长眠先祖';
        elTarget.textContent = '--';
        elStage.textContent = '--';
        elPrimitive.textContent = '--';
        elPrimDetail.textContent = '--';
        elStatus.textContent = selAgent.isFetus ? '胎儿' : '已故';
        elStatus.style.color = '#94a3b8';
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

// ★ H-06 四轴十一激素观察面板（趋势按实际 tick 差计算，不把快照间隔视为固定；
// ★ v1.50.65 面板 DOM 位于族谱模态，此处照常逐帧驱动，模态关闭时更新在隐藏子树上进行）
updateHormonePanel(selAgent, sim.tickCount || 0);

    // ★ v1.9.0 饱食/口渴/体力每秒变化速度（按游戏时间秒；Task1 进度条悬停）
    const _gdt = _gameDt();
    if (hungerFillEl) hungerFillEl.title = '饱食度 · 每小时变化 ' + _fmtRate(_meterRateTracker.push('hunger' + selAgent.id, selAgent.hunger, _gdt));
    if (thirstFillEl) thirstFillEl.title = '口渴度 · 每小时变化 ' + _fmtRate(_meterRateTracker.push('thirst' + selAgent.id, selAgent.thirst, _gdt));
    if (stamFillEl) stamFillEl.title = '体力 · 每小时变化 ' + _fmtRate(_meterRateTracker.push('stamina' + selAgent.id, selAgent.stamina, _gdt));

    // 🎒 随身行囊 (紧凑胶囊网格)
    const cWater = selAgent.carriedWater || 0.0;
    const cFood = selAgent.carriedFood || 0.0;
    const cWood = selAgent.carriedWood || 0.0;
    const cStone = selAgent.carriedStone || 0.0;
    const cGold = selAgent.carriedGold || 0.0;
    const carryCapEl = document.getElementById('insp-carry-cap');
    if (carryCapEl) carryCapEl.textContent = '分项容量 100 · 黄金∞';
    const carryFillEl = document.getElementById('insp-carry-fill');
    if (carryFillEl) carryFillEl.parentElement.style.display = 'none';

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
      } else if (cWater + cFood + cWood + cStone + cGold <= 0.01) {
        carryHintEl.textContent = '行囊空空 (物资将在现场采收后装入)';
      } else {
        carryHintEl.textContent = '🏠 随身携货，返回家宅后卸货存入私宅仓库。';
      }
    }

    // ★ v1.26.3 调试模式: 累计开采资源量 · 分品种（仅调试模式勾选时显示）
    const debugMiningEl = document.getElementById('insp-debug-mining');
    const debugMiningValEl = document.getElementById('insp-debug-mining-val');
    if (debugMiningEl && debugMiningValEl) {
      if (sim.debugMode) {
        debugMiningEl.style.display = 'flex';
        debugMiningValEl.textContent = `${(selAgent.cumulativeMined || 0).toFixed(1)} 单位`;
        debugMiningValEl.title = '本 agent 一生从资源点装载入随身行囊的累计总量（水/粮/木/石/金五类合计；市场购买与就地自饮自食不计入）';
        const miningVals = [
          ['insp-debug-mining-water', selAgent.cumulativeMinedWater],
          ['insp-debug-mining-food', selAgent.cumulativeMinedFood],
          ['insp-debug-mining-wood', selAgent.cumulativeMinedWood],
          ['insp-debug-mining-stone', selAgent.cumulativeMinedStone],
          ['insp-debug-mining-gold', selAgent.cumulativeMinedGold],
        ];
        for (const [id, v] of miningVals) {
          const el = document.getElementById(id);
          if (el) el.textContent = (v || 0).toFixed(1);
        }
      } else {
        debugMiningEl.style.display = 'none';
      }
    }

    // ★ v1.35.2/M5 调试模式: 国王内帑与皇帝帝国公帑累计（仅调试模式勾选且该族人为相关首长/曾获拨付时显示）
    const debugPrivyEl = document.getElementById('insp-debug-privy');
    const debugPrivyValEl = document.getElementById('insp-debug-privy-val');
    if (debugPrivyEl && debugPrivyValEl) {
      const isKing = (sim.regions || []).some(r => r.kingId === selAgent.id);
      const privyTotal = selAgent.cumulativeRoyalPrivy || 0;
      const isEmperor = (sim.empires || []).some(e => e.emperorId === selAgent.id);
      const imperialTotal = selAgent.cumulativeImperialPrivy || 0;
      if (sim.debugMode && (privyTotal > 0.001 || imperialTotal > 0.001 || isKing || isEmperor)) {
        debugPrivyEl.style.display = 'flex';
        debugPrivyValEl.textContent = `${privyTotal.toFixed(1)} + ${imperialTotal.toFixed(1)} 📦`;
        debugPrivyValEl.title = `国王内帑 ${privyTotal.toFixed(1)}；帝国公帑 ${imperialTotal.toFixed(1)}${isEmperor ? '（现任皇帝）' : ''}（全品类物资总量）`;
      } else {
        debugPrivyEl.style.display = 'none';
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

    // 家族血脉与世系族谱渲染 → inspector-lineage.js
    updateAgentLineage(selAgent);

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
      const pregTotal = (window.SIM_CONFIG && window.SIM_CONFIG.agentPregnancyDuration) || 200;
      document.getElementById('insp-preg-val').textContent = pVal + '% (' + Math.round(selAgent.pregnancyProgress * pregTotal) + 'h / ' + pregTotal + 'h)';
      document.getElementById('insp-preg-fill').style.width = `${pVal}%`;
      // ★ v1.9.0 怀孕进度每小时变化（按游戏小时，进度%）（Task1 进度条悬停）
      const pregFillEl = document.getElementById('insp-preg-fill');
      if (pregFillEl) pregFillEl.title = '怀孕进度 · 每小时变化 ' + _fmtRate(_meterRateTracker.push('preg' + selAgent.id, selAgent.pregnancyProgress, _gdt) * 100) + '（进度%）';
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
