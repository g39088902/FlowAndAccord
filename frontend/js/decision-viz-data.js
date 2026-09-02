/* ==========================================================================
 * Flow & Accord · 马斯洛决策引擎元数据 (decision-viz-data.js)
 * --------------------------------------------------------------------------
 * 13 条需求判定分支的展示元数据，与内核 branches.rs::BranchId 一一对应：
 *   id "b1".."b13" ↔ BranchId::B1QuenchThirst .. B13GoldWealth
 * 本文件只描述「分支长什么样」，评估顺序由 config.decision-order.js 驱动。
 * ========================================================================== */
(function (global) {
  'use strict';

  // 马斯洛层级色板（与主页深色科技风一致）
  var LV = {
    1: { name: '生理需求', hex: '#ef4444', kinds: 'QuenchThirst · SateHunger · Rest · FoundHome' },
    2: { name: '安全需求', hex: '#38bdf8', kinds: 'RepairHouse · StockWater · StockFood · StockWood' },
    3: { name: '归属与爱', hex: '#10b981', kinds: 'BuildHouse(0级)' },
    4: { name: '尊重需求', hex: '#f59e0b', kinds: 'BuildHouse(1-4级) · StockStone · StockGold' },
    5: { name: '自我实现', hex: '#a78bfa', kinds: 'GoldWealth(冷却180s)' }
  };

  // 13 条分支（level = 该分支的代码默认层级，即未被分界线强制覆盖时的所属层）
  var BRANCHES = [
    { id: 'b1', cond: '口渴 < 25 且有可用水源', need: 'Physiological · QuenchThirst', target: 'SeekingWater', level: 1, cfg: ['decisionCriticalThirst=25.0'], anchor: 'branches.rs::B1QuenchThirst' },
    { id: 'b2', cond: '饥饿 < 25 且有可用粮源', need: 'Physiological · SateHunger', target: 'SeekingFood', level: 1, cfg: ['decisionCriticalHunger=25.0'], anchor: 'branches.rs::B2SateHunger' },
    { id: 'b3', cond: '体力 < 100', need: 'Physiological · Rest', target: 'RestingAtCamp', level: 1, cfg: ['decisionRestStaminaTarget=100.0'], anchor: 'branches.rs::B3Rest' },
    { id: 'b12', cond: '无家 + 成年男 + 饥渴体力达标', need: 'Physiological · FoundHome', target: '掷点→立宅', level: 1, cfg: ['decisionFoundHome{Min}=20/20/60', 'Candidates=12'], anchor: 'branches.rs::B12FoundHome' },
    { id: 'b4', cond: '有家宅 且 耐久 < 50%（成员）', need: 'Safety · RepairHouse', target: 'RepairingHouse', level: 2, cfg: ['decisionHouseRepairNeedThreshold=50.0'], anchor: 'branches.rs::B4RepairHouse' },
    { id: 'b5', cond: '有房(含0级) 且 家户账本水 <100', need: 'Safety · StockWater', target: 'SeekingWater', level: 2, cfg: ['familyStock{On,Off}=100/200'], anchor: 'branches.rs::B5StockWater' },
    { id: 'b6', cond: '有房(含0级) 且 家户账本粮 <100', need: 'Safety · StockFood', target: 'SeekingFood', level: 2, cfg: ['familyStock{On,Off}=100/200'], anchor: 'branches.rs::B6StockFood' },
    { id: 'b7', cond: '有房(含0级) 且 家户账本木 <100', need: 'Safety · StockWood', target: 'SeekingWood', level: 2, cfg: ['familyStock{On,Off}=100/200'], anchor: 'branches.rs::B7StockWood' },
    { id: 'b8', cond: '0级宅 且账本水≥50粮≥50 + 成年男成员', need: 'Belonging · BuildHouse(0级)', target: '瞬发升级(1级)', level: 3, cfg: ['upgrade_material_cost(T0)=水50粮50'], anchor: 'branches.rs::B8BuildHouseTier0' },
    { id: 'b9', cond: '有房(含0级) 且 家户账本石 <100', need: 'Safety · StockStone', target: 'SeekingStone', level: 2, cfg: ['familyStock{On,Off}=100/200'], anchor: 'branches.rs::B9StockStone' },
    { id: 'b10', cond: '有房(含0级) 且 家户账本金 <100 且 淘金冷却≤0', need: 'Safety · StockGold', target: 'SeekingGold', level: 2, cfg: ['decisionStockGoldCooldown=45.0'], anchor: 'branches.rs::B10StockGold' },
    { id: 'b11', cond: '账本可付本次材料(2级木粮水75/3级石木粮水100/4级金石木粮水125)', need: 'Esteem · BuildHouse(1-4级)', target: '瞬发升级(下一级)', level: 4, cfg: ['upgrade_material_cost(tier)'], anchor: 'branches.rs::B11BuildHouseUpgrade' },
    { id: 'b13', cond: '4级庄园 且 五类储备全≥200 且 冷却≤0', need: 'SelfActualization · GoldWealth', target: 'SeekingGold', level: 5, cfg: ['decisionGoldWealthCooldown=180.0'], anchor: 'branches.rs::B13GoldWealth' }
  ];

  var BRANCH_MAP = {};
  BRANCHES.forEach(function (b) { BRANCH_MAP[b.id] = b; });

  var ALL_IDS = BRANCHES.map(function (b) { return b.id; });

  // 出厂策展优先级（与原硬编码级联语义等价）；「重置顺序」恢复此序列
  var DEFAULT_ORDER = ['b1', 'b2', 'b3', 'b12', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10', 'b11', 'b13'];
  // 默认分界线：位于第 g 张卡之后（第1层|第2层=4 / 第2层|第3层=8 / 第3层|第4层=9 / 第4层|第5层=12）
  var DEFAULT_DIVGAPS = [4, 8, 9, 12];

  // 行动状态机摘要（agent.rs::PrimitiveActionState 15 态）
  var FSM_STATES = [
    'RestingAtCamp', 'SeekingWater', 'SeekingFood', 'SeekingWood', 'SeekingStone', 'SeekingGold',
    'DrinkingAtWater', 'ForagingFood', 'GatheringWood', 'MiningStone', 'MiningGold',
    'ReturningToCamp', 'ConstructingHouse', 'RepairingHouse', 'OffRoadDetour'
  ];

  // 行动状态中文描述（PrimitiveActionState 15 态 → 中文语义），决策卡 target 与状态机芯片共用
  var FSM_STATE_ZH = {
    RestingAtCamp: '营地休整', SeekingWater: '外出寻水', SeekingFood: '外出觅食',
    SeekingWood: '外出寻木', SeekingStone: '外出寻石', SeekingGold: '外出寻金',
    DrinkingAtWater: '清泉饮水', ForagingFood: '采食浆果', GatheringWood: '伐木取木',
    MiningStone: '采石取石', MiningGold: '淘金取金', ReturningToCamp: '返家卸货',
    ConstructingHouse: '建房施工', RepairingHouse: '房屋修缮', OffRoadDetour: '途中掉头重路由'
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
    FSM_STATES: FSM_STATES,
    zh: zh
  };
})(window);
