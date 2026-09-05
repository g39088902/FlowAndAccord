/* ==========================================================================
 * Flow & Accord · 马斯洛决策引擎元数据 (decision-viz-data.js)
 * --------------------------------------------------------------------------
 * 18 条 Branch 分支的展示元数据，与内核 branches.rs::BranchId 一一对应：
 *   id "b1".."b18" ↔ BranchId::B1QuenchThirst .. B18RaiseChild
 * 本文件只描述「分支长什么样」，评估顺序由 config.decision-order.js 驱动。
 * ========================================================================== */
(function (global) {
  'use strict';

  // 马斯洛层级色板（与主页深色科技风一致）
  // ★ v1.29.0 新增 ⓪ 瞬间行为（编码 0）：优先级高于生理需求——条件满足即刻执行，
  //   不移动、不消耗资源，命中后同一 tick 内继续向后遍历其余分支。
  var LV = {
    0: { name: '瞬间行为', hex: '#22d3ee', kinds: 'BidHouse · Courtship(近距) · RaiseChild(在宅)' },
    1: { name: '生理需求', hex: '#ef4444', kinds: 'SeekThrone · QuenchThirst · SateHunger · Rest · FoundHome' },
    2: { name: '安全需求', hex: '#38bdf8', kinds: 'RepairHouse · StockWater · StockFood · StockWood' },
    3: { name: '归属与爱', hex: '#10b981', kinds: 'BuildHouse(0级)' },
    4: { name: '尊重需求', hex: '#f59e0b', kinds: 'BuildHouse(1-4级) · StockStone · StockGold' },
    5: { name: '自我实现', hex: '#a78bfa', kinds: 'GoldWealth(冷却180s)' }
  };

  // 18 条 Branch 分支（level = 该分支的代码默认层级，即未被分界线强制覆盖时的所属层；zh = 中文短名）
  var BRANCHES = [
    { id: 'b1', zh: '解渴', cond: '口渴 < 25 且有可用水源', need: 'Physiological · QuenchThirst', target: 'SeekingWater', level: 1, cfg: ['decisionCriticalThirst=25.0'], anchor: 'branches.rs::B1QuenchThirst' },
    { id: 'b2', zh: '觅食', cond: '饥饿 < 25 且有可用粮源', need: 'Physiological · SateHunger', target: 'SeekingFood', level: 1, cfg: ['decisionCriticalHunger=25.0'], anchor: 'branches.rs::B2SateHunger' },
    { id: 'b3', zh: '休整', cond: '体力 < 100', need: 'Physiological · Rest', target: 'RestingAtCamp', level: 1, cfg: ['decisionRestStaminaTarget=100.0'], anchor: 'branches.rs::B3Rest' },
    { id: 'b12', zh: '立宅', cond: '无家 + 成年男 + 饥渴体力达标', need: 'Physiological · FoundHome', target: '掷点→立宅', level: 1, cfg: ['decisionFoundHome{Min}=20/20/60', 'Candidates=12'], anchor: 'branches.rs::B12FoundHome' },
    { id: 'b17', zh: '竞拍购房', cond: '成年男 + 无未结算出价 + 冷却结束 + 有在售空置房 + 家户金够价（无房可竞拍任意在售房 / 有房仅竞拍更高等级房）', need: 'Instantaneous · BidHouse', target: '⚡ 最优一套→pending', level: 0, instant: true, cfg: ['houseAuctionBidCooldownTicks=300', 'houseAuctionMinBidGold=0.01'], anchor: 'branches.rs::B17BidHouse' },
    { id: 'b4', zh: '修缮', cond: '有家宅 且 耐久 < 50%（成员）', need: 'Safety · RepairHouse', target: 'RepairingHouse', level: 2, cfg: ['decisionHouseRepairNeedThreshold=50.0'], anchor: 'branches.rs::B4RepairHouse' },
    { id: 'b5', zh: '备水', cond: '有房(含0级) 且 家户账本水 <100', need: 'Safety · StockWater', target: 'SeekingWater', level: 2, cfg: ['familyStock{On,Off}=100/200'], anchor: 'branches.rs::B5StockWater' },
    { id: 'b6', zh: '备粮', cond: '有房(含0级) 且 家户账本粮 <100', need: 'Safety · StockFood', target: 'SeekingFood', level: 2, cfg: ['familyStock{On,Off}=100/200'], anchor: 'branches.rs::B6StockFood' },
    { id: 'b7', zh: '备木', cond: '有房(含0级) 且 家户账本木 <100', need: 'Safety · StockWood', target: 'SeekingWood', level: 2, cfg: ['familyStock{On,Off}=100/200'], anchor: 'branches.rs::B7StockWood' },
    { id: 'b8', zh: '建房·0级', cond: '0级宅 且账本水≥50粮≥50 + 成年男成员', need: 'Belonging · BuildHouse(0级)', target: '瞬发升级(1级)', level: 3, cfg: ['upgrade_material_cost(T0)=水50粮50'], anchor: 'branches.rs::B8BuildHouseTier0' },
    { id: 'b9', zh: '备石', cond: '有房(含0级) 且 家户账本石 <100', need: 'Safety · StockStone', target: 'SeekingStone', level: 2, cfg: ['familyStock{On,Off}=100/200'], anchor: 'branches.rs::B9StockStone' },
    { id: 'b10', zh: '备金', cond: '有房(含0级) 且 家户账本金 <100 且 淘金冷却≤0', need: 'Safety · StockGold', target: 'SeekingGold', level: 2, cfg: ['decisionStockGoldCooldown=45.0'], anchor: 'branches.rs::B10StockGold' },
    { id: 'b11', zh: '升级庄园', cond: '账本可付本次材料(2级木粮水75/3级石木粮水100/4级金石木粮水125)', need: 'Esteem · BuildHouse(1-4级)', target: '瞬发升级(下一级)', level: 4, cfg: ['upgrade_material_cost(tier)'], anchor: 'branches.rs::B11BuildHouseUpgrade' },
    { id: 'b13', zh: '娱乐淘金', cond: '4级庄园 且 五类储备全≥200 且 冷却≤0', need: 'SelfActualization · GoldWealth', target: 'SeekingGold', level: 5, cfg: ['decisionGoldWealthCooldown=180.0'], anchor: 'branches.rs::B13GoldWealth' },
    { id: 'b14', zh: '夺位', cond: '在世成年男性 且 非现任国王 且 存在空缺王位营地（有房限自家房屋营地/无房可任意）', need: 'Physiological · SeekThrone', target: 'SeekingThrone', level: 1, cfg: ['poiMinDistance=70', '性别+房籍守卫'], anchor: 'branches.rs::B14SeekThrone' },
    { id: 'b15', zh: '榷场贸易', cond: '成年男性户主 且 (水或粮断供) 且 存金≥0.5 且 体力≥15', need: 'Physiological · MarketTrade', target: 'SeekingMarket', level: 1, cfg: ['marketEmergencyFamilyStockThreshold=10.0', 'marketMinFamilyGold=0.5', 'marketMinDispatchStamina=15.0'], anchor: 'market.rs::evaluate_market_trade' },
    { id: 'b16', zh: '求偶', cond: '在世成年男性 且 单身 且 存在全图单身成年女性（⚡近距变体：目标已在交互半径内→就地写决心）', need: 'Belonging · Courtship', target: 'SeekingCourtship', level: 3, instant: true, cfg: ['性别+单身守卫', '魅力最高优先', 'poiInteractionRadius 近距瞬发'], anchor: 'branches.rs::B16Courtship' },
    { id: 'b18', zh: '育儿', cond: '在世成年男性 + 有老婆 + 妻子满足原怀孕条件 + ★v1.28.0 男方名下住宅≥1级（⚡在宅变体：夫妻同在自家门口→就地写决心）', need: 'Esteem · RaiseChild', target: 'RaiseChild→受孕', level: 4, instant: true, cfg: ['原有受孕阈值与冷却', '房屋≥1级（非0级仓库）', '宅门口双静止瞬发'], anchor: 'branches.rs::B18RaiseChild' }
  ];

  var BRANCH_MAP = {};
  BRANCHES.forEach(function (b) { BRANCH_MAP[b.id] = b; });

  var ALL_IDS = BRANCHES.map(function (b) { return b.id; });

  // 出厂策展优先级（与原硬编码级联语义等价）；「重置顺序」恢复此序列
  // ★ v1.29.0：b17 竞拍购房归入 ⓪ 瞬间行为并置于首位（瞬间层必须至少 1 张卡，否则分界线会误吞首卡）
  var DEFAULT_ORDER = ['b17', 'b14', 'b1', 'b2', 'b15', 'b3', 'b12', 'b4', 'b16', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10', 'b11', 'b13', 'b18'];
  // 默认分界线：位于第 g 张卡之后
  // （⓪|①=1 / ①|②=7 / ②|③=13 / ③|④=15 / ④|⑤=16）
  var DEFAULT_DIVGAPS = [1, 7, 13, 15, 16];

  // 行动状态中文描述（PrimitiveActionState → 中文语义），Branch 分支卡 target 的中文显示依赖此表
  var FSM_STATE_ZH = {
    RestingAtCamp: '营地休整', SeekingWater: '外出寻水', SeekingFood: '外出觅食',
    SeekingWood: '外出寻木', SeekingStone: '外出寻石', SeekingGold: '外出寻金',
    DrinkingAtWater: '清泉饮水', ForagingFood: '采食浆果', GatheringWood: '伐木取木',
    MiningStone: '采石取石', MiningGold: '淘金取金', ReturningToCamp: '返家卸货',
    ConstructingHouse: '建房施工', RepairingHouse: '房屋修缮', OffRoadDetour: '途中掉头重路由',
    SeekingThrone: '夺位远征', SeekingMarket: '奔赴榷场', BuyingAtMarket: '榷场交易',
    SeekingCourtship: '奔赴求偶', RaiseChild: '养育小孩'
  };
  /** 英文状态码 → 中文语义；未知则原样返回 */
  function zh(s) { return FSM_STATE_ZH[s] || s; }

  global.SIM_DECISION_VIZ_DATA = {
    LV: LV,
    BRANCHES: BRANCHES,
    BRANCH_MAP: BRANCH_MAP,
    ALL_IDS: ALL_IDS,
    DEFAULT_ORDER: DEFAULT_ORDER,
    DEFAULT_DIVGAPS: DEFAULT_DIVGAPS,
    zh: zh
  };
})(window);
