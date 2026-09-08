/* ==========================================================================
 * Flow & Accord · 马斯洛决策引擎元数据 (decision-viz-data.js)
 * --------------------------------------------------------------------------
 * 16 条活动 Branch 的展示元数据，与内核 BranchId 一一对应。
 * b11 已并入 b8，b15 已下沉为资源意图的「采购物资」策略。
 * 本文件只描述「分支长什么样」，评估顺序由 config.decision-order.js 驱动。
 * ========================================================================== */
(function (global) {
  'use strict';

  // 马斯洛层级色板（与主页深色科技风一致）
  // ★ v1.29.0 新增 ⓪ 瞬间行为（编码 0）：优先级高于生理需求——条件满足即刻执行，
  //   不移动、不消耗资源，命中后同一 tick 内继续向后遍历其余分支。
  var LV = {
    0: { name: '瞬间行为', hex: '#22d3ee', kinds: '竞购住宅 · 在宅改善 · 近距求偶 · 在宅生育' },
    1: { name: '生理需求', hex: '#ef4444', kinds: '饮水解渴 · 进食充饥 · 恢复体力' },
    2: { name: '安全需求', hex: '#38bdf8', kinds: '基本储备 · 建立家宅 · 修缮住宅' },
    3: { name: '归属与爱', hex: '#10b981', kinds: '求偶成家 · 生育后代' },
    4: { name: '尊重需求', hex: '#f59e0b', kinds: '改善住宅 · 发展储备 · 争取王位' },
    5: { name: '自我实现', hex: '#a78bfa', kinds: '积累财富' }
  };

  // 16 条活动 Branch（level = 默认展示层；zh = 全站统一中文名）
  var BRANCHES = [
    { id: 'b1', zh: '饮水解渴', cond: '口渴告急且野外取水或市场采购至少一种可行', need: 'Physiological · QuenchThirst', target: '选择采水或采购策略', level: 1, cfg: ['decisionCriticalThirst=25.0'], anchor: 'branches.rs::B1QuenchThirst' },
    { id: 'b2', zh: '进食充饥', cond: '饥饿告急且野外取食或市场采购至少一种可行', need: 'Physiological · SateHunger', target: '选择采食或采购策略', level: 1, cfg: ['decisionCriticalHunger=25.0'], anchor: 'branches.rs::B2SateHunger' },
    { id: 'b3', zh: '恢复体力', cond: '体力低于恢复目标', need: 'Physiological · Rest', target: 'RestingAtCamp', level: 1, cfg: ['decisionRestStaminaTarget=100.0'], anchor: 'branches.rs::B3Rest' },
    { id: 'b12', zh: '建立家宅', cond: '无家 + 成年男 + 饥渴体力达标', need: 'Safety · FoundHome', target: '选址并建立家宅', level: 2, cfg: ['decisionFoundHome{Min}=20/20/60', 'Candidates=12'], anchor: 'branches.rs::B12FoundHome' },
    { id: 'b17', zh: '竞购住宅', cond: '成年男 + 无未结算出价 + 冷却结束 + 有合格在售住宅', need: 'Instantaneous · BidHouse', target: '⚡ 写入竞购出价', level: 0, instant: true, cfg: ['houseAuctionBidCooldownTicks=300', 'houseAuctionMinBidGold=0.01'], anchor: 'branches.rs::B17BidHouse' },
    { id: 'b4', zh: '修缮住宅', cond: '住宅耐久低于个性化维护阈值', need: 'Safety · RepairHouse', target: 'RepairingHouse', level: 2, cfg: ['decisionHouseRepairNeedThreshold'], anchor: 'branches.rs::B4RepairHouse' },
    { id: 'b5', zh: '储备饮水', cond: '家户饮水储备触发且采集或采购可行', need: 'Safety · StockWater', target: '选择采水或采购策略', level: 2, cfg: ['familyStock{On,Off}=100/200'], anchor: 'branches.rs::B5StockWater' },
    { id: 'b6', zh: '储备食物', cond: '家户食物储备触发且采集或采购可行', need: 'Safety · StockFood', target: '选择采食或采购策略', level: 2, cfg: ['familyStock{On,Off}=100/200'], anchor: 'branches.rs::B6StockFood' },
    { id: 'b7', zh: '储备木材', cond: '家户木材储备触发且采集或采购可行', need: 'Safety · StockWood', target: '选择伐木或采购策略', level: 2, cfg: ['familyStock{On,Off}=100/200'], anchor: 'branches.rs::B7StockWood' },
    { id: 'b8', zh: '改善住宅', cond: '未满级住宅 + 家户可付下一级材料 + 成年男性成员', need: 'Safety/Esteem · UpgradeHome', target: '在宅瞬发；异地先返宅', level: 4, instant: true, cfg: ['upgrade_material_cost(tier)'], anchor: 'branches.rs::B8ImproveHome' },
    { id: 'b9', zh: '储备石材', cond: '家户石材储备触发且可采集', need: 'Esteem · StockStone', target: 'SeekingStone', level: 4, cfg: ['familyStock{On,Off}=100/200'], anchor: 'branches.rs::B9StockStone' },
    { id: 'b10', zh: '储备资金', cond: '家户黄金储备触发且淘金冷却结束', need: 'Esteem · StockGold', target: 'SeekingGold', level: 4, cfg: ['decisionStockGoldCooldown=45.0'], anchor: 'branches.rs::B10StockGold' },
    { id: 'b13', zh: '积累财富', cond: '4级庄园 + 五类储备充足 + 住宅无需修缮 + 冷却结束', need: 'SelfActualization · GoldWealth', target: '选择淘金积累财富', level: 5, cfg: ['decisionGoldWealthCooldown=180.0'], anchor: 'branches.rs::B13GoldWealth' },
    { id: 'b14', zh: '争取王位', cond: '成年男性非国王且存在符合房籍约束的空缺王位', need: 'Esteem · SeekThrone', target: 'SeekingThrone', level: 4, cfg: ['性别+房籍守卫'], anchor: 'branches.rs::B14SeekThrone' },
    { id: 'b16', zh: '求偶成家', cond: '成年单身男性且存在合格女性；近距时瞬发提交', need: 'Belonging · Courtship', target: '近距提交；异地寻访', level: 3, instant: true, cfg: ['魅力+距离+ID择优'], anchor: 'branches.rs::B16Courtship' },
    { id: 'b18', zh: '生育后代', cond: '夫妻符合生育条件且男方拥有至少1级住宅', need: 'Belonging · RaiseChild', target: '在宅提交；异地返宅', level: 3, instant: true, cfg: ['生育阈值与冷却', '住宅≥1级'], anchor: 'branches.rs::B18RaiseChild' }
  ];

  var BRANCH_MAP = {};
  BRANCHES.forEach(function (b) { BRANCH_MAP[b.id] = b; });

  // current_need / ActiveTask 意图的统一中文目录；Canvas、Inspector 与决策卡共用。
  var NEED_KIND_LABELS = {
    QuenchThirst: '饮水解渴', SateHunger: '进食充饥', Rest: '恢复体力',
    ReturnHome: '送货回家', StockWater: '储备饮水', StockFood: '储备食物',
    StockWood: '储备木材', StockStone: '储备石材', StockGold: '储备资金',
    GoldWealth: '积累财富', RepairHouse: '修缮住宅', BuildHouse: '改善住宅',
    FoundHome: '建立家宅', Courtship: '求偶成家', SeekThrone: '争取王位',
    MarketTrade: '采购物资', BidHouse: '竞购住宅', RaiseChild: '生育后代',
    Detour: '越野寻路'
  };

  var ALL_IDS = BRANCHES.map(function (b) { return b.id; });

  // 出厂策展优先级（与原硬编码级联语义等价）；「重置顺序」恢复此序列
  // b17 竞购住宅置于瞬间区首位；b8 在宅时也可走瞬发通道。
  var DEFAULT_ORDER = ['b17', 'b1', 'b2', 'b3', 'b5', 'b6', 'b7', 'b12', 'b4', 'b16', 'b18', 'b8', 'b9', 'b10', 'b14', 'b13'];
  // 默认分界线：位于第 g 张卡之后
  // （⓪|①=1 / ①|②=7 / ②|③=13 / ③|④=15 / ④|⑤=16）
  var DEFAULT_DIVGAPS = [1, 4, 9, 11, 15];

  // 行动状态中文描述（PrimitiveActionState → 中文语义），Branch 分支卡 target 的中文显示依赖此表
  var FSM_STATE_ZH = {
    RestingAtCamp: '营地休整', SeekingWater: '外出寻水', SeekingFood: '外出觅食',
    SeekingWood: '外出寻木', SeekingStone: '外出寻石', SeekingGold: '外出寻金',
    DrinkingAtWater: '清泉饮水', ForagingFood: '采食浆果', GatheringWood: '伐木取木',
    MiningStone: '采石取石', MiningGold: '淘金取金', ReturningToCamp: '返家卸货',
    ConstructingHouse: '建房施工', RepairingHouse: '房屋修缮', OffRoadDetour: '途中掉头重路由',
    SeekingThrone: '争取王位', SeekingMarket: '前往采购', BuyingAtMarket: '采购物资',
    SeekingCourtship: '求偶成家', RaiseChild: '生育后代'
  };
  /** 英文状态码 → 中文语义；未知则原样返回 */
  function zh(s) { return FSM_STATE_ZH[s] || s; }

  global.SIM_DECISION_VIZ_DATA = {
    LV: LV,
    BRANCHES: BRANCHES,
    BRANCH_MAP: BRANCH_MAP,
    NEED_KIND_LABELS: NEED_KIND_LABELS,
    ALL_IDS: ALL_IDS,
    DEFAULT_ORDER: DEFAULT_ORDER,
    DEFAULT_DIVGAPS: DEFAULT_DIVGAPS,
    zh: zh
  };
})(window);
