use super::super::vec3::Vec3;
use super::super::graph::NodeId;
use super::super::agent::{Agent3D, AgentId, PrimitiveActionState};
use super::super::house::{House, HouseTier};
use super::super::ledger::family::HouseholdRegistry;
use super::super::ledger::journal::ResourceKind;
use super::super::poi::PoiId;
use super::branches::BranchId;
use crate::config::*;

/// 马斯洛需求层次 (低 → 高，低层绝对优先)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MaslowLevel {
    Physiological,      // ① 生理需求 (最高优先级·生存底线)
    Safety,             // ② 安全需求 (仓库水粮木储备填满 / 房屋修缮)
    Belonging,          // ③ 归属与爱 (0级仓库升级成婚 / 家庭纽带)
    Esteem,             // ④ 尊重需求 (建材储备 / 盖房淘金[45s] / 房屋施工升级)
    SelfActualization,  // ⑤ 自我实现 (4级大庄园竣工后的娱乐淘金[180s])
}

impl MaslowLevel {
    /// 数字层级 (1-5) → 枚举；0 及非法值返回 None（0 语义 = 保留代码动态默认）
    pub fn from_u8(v: u8) -> Option<MaslowLevel> {
        Some(match v {
            1 => MaslowLevel::Physiological,
            2 => MaslowLevel::Safety,
            3 => MaslowLevel::Belonging,
            4 => MaslowLevel::Esteem,
            5 => MaslowLevel::SelfActualization,
            _ => return None,
        })
    }

    /// 层级 → 前端标签字符串（与 current_need 标签格式一致）
    pub fn as_str(self) -> &'static str {
        match self {
            MaslowLevel::Physiological => "Physiological",
            MaslowLevel::Safety => "Safety",
            MaslowLevel::Belonging => "Belonging",
            MaslowLevel::Esteem => "Esteem",
            MaslowLevel::SelfActualization => "SelfActualization",
        }
    }
}

/// 具体需求种类 (对应可执行的动作)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NeedKind {
    QuenchThirst,   // 生理: 口渴 → 赶往水泉痛饮并带水补给家宅
    SateHunger,     // 生理: 饥饿 → 赶往浆果丛觅食并带粮补给家宅
    Rest,           // 生理: 归巢休养生息 (一旦开始休息充盈至100%)
    RepairHouse,    // 安全: 房屋耐久<50%产生修缮需求，修缮至100%
    StockWater,     // 安全: 家宅储水 (家庭生存储备，填满水库)
    StockFood,      // 安全: 家宅储粮 (家庭生存储备，填满粮仓)
    StockWood,      // 安全: 过冬木柴 / 私宅基础木料 (填满木仓)
    BuildHouse,     // 归属/尊重: 材料备齐后施工升级房屋
    FoundHome,      // 生理(末档): 无家成年男性自主“自立门户”选址立宅 (0级仓库)
    StockStone,     // 尊重: 采石建材 (庄舍/庄园升级储备)
    StockGold,      // 尊重: 为3级庄舍升级大庄园备金 (冷却 45s)
    GoldWealth,     // 自我实现: 4级大庄园竣工后的娱乐性淘金 (冷却 180s)
    SeekThrone,     // 生理(第一层生存·最高档): 夺位远征 — 王位空缺且满足条件时自主出征夺位登基（夺位=资源分配权）
    MarketTrade,    // 生理(兜底): 榷场商贸 — 家户断水断粮且野外断流时以黄金换购水粮
    Courtship,      // 归属: 寻找全图魅力最高单身女性求偶成婚
    BidHouse,       // ★ v1.26.0 安全: 无房成年男性对随机一套在售空置房屋出价竞购（出价后进入全局冷却）
    RaiseChild,     // 尊重: 已婚成年男性自主发起养育小孩行动
}

/// 一条需求判定结论
#[derive(Debug, Clone, Copy)]
pub struct Need {
    pub level: MaslowLevel,
    pub kind: NeedKind,
    pub target_state: PrimitiveActionState,
}

/// 资源节点池 (供给类型 → 节点表)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodePool {
    Water,
    Food,
    Wood,
    Stone,
    Gold,
}

impl NodePool {
    pub fn nodes(self, ctx: &DecisionContext) -> &[ResourceNode] {
        match self {
            NodePool::Water => &ctx.water_nodes,
            NodePool::Food => &ctx.food_nodes,
            NodePool::Wood => &ctx.wood_nodes,
            NodePool::Stone => &ctx.stone_nodes,
            NodePool::Gold => &ctx.gold_nodes,
        }
    }
}

/// 一处资源 POI 与它邻近的路网节点。
#[derive(Debug, Clone, Copy)]
pub struct ResourceNode {
    pub poi_id: PoiId,
    pub node: NodeId,
}

/// 决策时收集的单身适婚女性候选
#[derive(Debug, Clone, Copy)]
pub struct EligibleFemale {
    pub id: AgentId,
    pub pos: Vec3,
    pub libido: f32,
    pub nearest_node: NodeId,
}

/// 决策上下文：收集资源节点；是否可用由每个 Agent 的私有触发器决定。
pub struct DecisionContext {
    pub water_nodes: Vec<ResourceNode>,
    pub food_nodes: Vec<ResourceNode>,
    pub wood_nodes: Vec<ResourceNode>,
    pub stone_nodes: Vec<ResourceNode>,
    pub gold_nodes: Vec<ResourceNode>,
    pub market_nodes: Vec<ResourceNode>,
    pub camp_positions: Vec<(NodeId, Vec3)>,
    /// 全部营地 POI：(camp_id, 营地坐标)（夺位远征目标定位与国王立宅约束使用）
    pub camp_pois: Vec<(u32, Vec3)>,
    /// 全图可求偶的在世成年单身女性列表（求偶分支使用）
    pub eligible_females: Vec<EligibleFemale>,
    /// 满足原受孕条件的已婚女性 ID（供“养育小孩”分支核验配偶）
    pub conception_ready_females: Vec<AgentId>,
}

/// 便捷读取某 agent 所属家户账本的品类余额（无家户返回 0.0）
pub fn ledger_balance_of(
    households: &HouseholdRegistry,
    agent: &Agent3D,
    kind: ResourceKind,
) -> f32 {
    households
        .household_of(agent.id)
        .and_then(|hid| households.get(hid))
        .map(|hh| hh.group.ledger.balance(kind))
        .unwrap_or(0.0)
}

// ════════════════════════════════════════════════════════════════
// ★ M7 家庭库存施密特触发器（与房屋等级彻底脱钩）
// ════════════════════════════════════════════════════════════════

/// 五类家庭库存触发器的固定顺序（下标与 `Agent3D.family_stock_active` 对齐）
pub const FAMILY_STOCK_ORDER: [ResourceKind; 5] = [
    ResourceKind::Water,
    ResourceKind::Food,
    ResourceKind::Wood,
    ResourceKind::Stone,
    ResourceKind::Gold,
];

/// 品类 → 触发器下标
pub fn family_stock_index(kind: ResourceKind) -> usize {
    match kind {
        ResourceKind::Water => 0,
        ResourceKind::Food => 1,
        ResourceKind::Wood => 2,
        ResourceKind::Stone => 3,
        ResourceKind::Gold => 4,
    }
}

/// 读取该 agent 的某品类家庭库存触发器：true = 需要去采（家庭账本该资源未补足）
pub fn family_stock_on(agent: &Agent3D, kind: ResourceKind) -> bool {
    agent.family_stock_active[family_stock_index(kind)]
}

/// 施密特滞回状态转移：余额 < on → 开；已开则需余额 ≥ off 才关（中间带保持）
pub fn family_stock_update(active: bool, balance: f32, on: f32, off: f32) -> bool {
    if active {
        !(balance >= off)
    } else {
        balance < on
    }
}

/// 房屋某次升级需一次性扣除的材料成本（M7 起同时作为 b8/b11 就绪判据，
/// 与 construction.rs::try_instant_upgrade 共用，杜绝公式漂移）
///
/// ★ M8 改为「4 级 × 5 资源」固定成本矩阵：入参 `tier` 是**当前等级**，
/// 返回「升到下一级」所需的一次性扣除量（即取目标等级那一行）：
/// - Tier0Warehouse（0→1）→ Tier1 行：水 50、粮 50（木/石/金为 0）
/// - Tier1ThatchedHut（1→2）→ Tier2 行：木/粮/水 各 75（石/金为 0）
/// - Tier2LeanTo（2→3）→ Tier3 行：石/木/粮/水 各 100（金为 0）
/// - Tier3Homestead（3→4）→ Tier4 行：金/石/木/粮/水 各 125
/// - Tier4Manor：已是顶级，返回空
///
/// 成本为 0 的品类：扣账侧 `amt > 0.001` 守卫自动跳过；就绪侧 `balance >= amt - 1e-3` 恒成立。
/// 因此无需在此硬编码每级的品类集合，矩阵中保留 0 值即可自然表达并保留未来单独调参能力。
pub fn upgrade_material_cost(tier: HouseTier, config: &SimConfig) -> Vec<(ResourceKind, f32)> {
    let (w, f, wd, s, g) = match tier {
        // 升到 1 级
        HouseTier::Tier0Warehouse => (
            config.house_upgrade_cost_tier1_water,
            config.house_upgrade_cost_tier1_food,
            config.house_upgrade_cost_tier1_wood,
            config.house_upgrade_cost_tier1_stone,
            config.house_upgrade_cost_tier1_gold,
        ),
        // 升到 2 级
        HouseTier::Tier1ThatchedHut => (
            config.house_upgrade_cost_tier2_water,
            config.house_upgrade_cost_tier2_food,
            config.house_upgrade_cost_tier2_wood,
            config.house_upgrade_cost_tier2_stone,
            config.house_upgrade_cost_tier2_gold,
        ),
        // 升到 3 级
        HouseTier::Tier2LeanTo => (
            config.house_upgrade_cost_tier3_water,
            config.house_upgrade_cost_tier3_food,
            config.house_upgrade_cost_tier3_wood,
            config.house_upgrade_cost_tier3_stone,
            config.house_upgrade_cost_tier3_gold,
        ),
        // 升到 4 级
        HouseTier::Tier3Homestead => (
            config.house_upgrade_cost_tier4_water,
            config.house_upgrade_cost_tier4_food,
            config.house_upgrade_cost_tier4_wood,
            config.house_upgrade_cost_tier4_stone,
            config.house_upgrade_cost_tier4_gold,
        ),
        HouseTier::Tier4Manor => return Vec::new(),
    };
    vec![
        (ResourceKind::Water, w),
        (ResourceKind::Food, f),
        (ResourceKind::Wood, wd),
        (ResourceKind::Stone, s),
        (ResourceKind::Gold, g),
    ]
}

/// 房屋改善型换房成本：把当前等级到目标等级之间的升级资源差按市场基准价折算为黄金。
/// 该函数无随机数，供决策与成交执行器共同调用。
pub fn house_upgrade_cost_price(from: HouseTier, to: HouseTier, config: &SimConfig) -> f32 {
    let tiers = [HouseTier::Tier0Warehouse, HouseTier::Tier1ThatchedHut, HouseTier::Tier2LeanTo, HouseTier::Tier3Homestead, HouseTier::Tier4Manor];
    let start = tiers.iter().position(|t| *t == from).unwrap_or(0);
    let end = tiers.iter().position(|t| *t == to).unwrap_or(start);
    if end <= start { return 0.0; }
    let mut total = 0.0;
    for tier in tiers[start..end].iter().copied() {
        for (kind, amount) in upgrade_material_cost(tier, config) {
            let price = match kind {
                ResourceKind::Water | ResourceKind::Food => config.market_price_base,
                ResourceKind::Wood => config.market_price_base_wood,
                ResourceKind::Stone => config.market_price_base_stone,
                ResourceKind::Gold => 1.0,
            };
            total += amount * price;
        }
    }
    (total * 100.0).round() / 100.0
}

/// 升级就绪：家户账本余额能覆盖该级所有材料成本（成本为 0 的品类不阻塞）
pub fn upgrade_ready_by_cost(
    tier: HouseTier,
    config: &SimConfig,
    balance: impl Fn(ResourceKind) -> f32,
) -> bool {
    upgrade_material_cost(tier, config)
        .iter()
        .all(|(rk, amt)| balance(*rk) >= *amt - 1e-3)
}

pub fn state_need_label_with_agent(state: PrimitiveActionState, agent: &Agent3D, houses: &[House], _households: &HouseholdRegistry, config: &SimConfig) -> Option<(&'static str, &'static str)> {
    // (层级, 需求名, 对应判定分支)；分支用于套用 decision_eval_levels 层级覆盖（与评估结论共用同一覆盖表）
    let (lvl, kind, branch) = match state {
        PrimitiveActionState::SeekingWater | PrimitiveActionState::DrinkingAtWater => {
            if agent.thirst < config.decision_critical_thirst { ("Physiological", "QuenchThirst", Some(BranchId::B1QuenchThirst)) } else { ("Safety", "StockWater", Some(BranchId::B5StockWater)) }
        }
        PrimitiveActionState::SeekingFood | PrimitiveActionState::ForagingFood => {
            if agent.hunger < config.decision_critical_hunger { ("Physiological", "SateHunger", Some(BranchId::B2SateHunger)) } else { ("Safety", "StockFood", Some(BranchId::B6StockFood)) }
        }
        PrimitiveActionState::SeekingWood | PrimitiveActionState::GatheringWood => ("Safety", "StockWood", Some(BranchId::B7StockWood)),
        PrimitiveActionState::SeekingStone | PrimitiveActionState::MiningStone => ("Esteem", "StockStone", Some(BranchId::B9StockStone)),
        PrimitiveActionState::SeekingGold | PrimitiveActionState::MiningGold => {
            // ★ M7 与房屋等级脱钩：家庭储备缺金（trigger ON）→ StockGold；已补足（4级庄园娱乐）→ GoldWealth
            if family_stock_on(agent, ResourceKind::Gold) { ("Esteem", "StockGold", Some(BranchId::B10StockGold)) } else { ("SelfActualization", "GoldWealth", Some(BranchId::B13GoldWealth)) }
        }
        PrimitiveActionState::ReturningToCamp => {
            if agent.stamina < config.decision_work_stamina_threshold { ("Physiological", "Rest", Some(BranchId::B3Rest)) } else { ("Safety", "ReturnHome", None) }
        }
        PrimitiveActionState::RepairingHouse => ("Safety", "RepairHouse", Some(BranchId::B4RepairHouse)),
        PrimitiveActionState::SeekingMarket | PrimitiveActionState::BuyingAtMarket => {
            ("Physiological", "MarketTrade", Some(BranchId::B15MarketTrade))
        }
        PrimitiveActionState::ConstructingHouse => {
            let is_tier0 = agent.home_house_id
                .and_then(|hid| houses.iter().find(|h| h.id == hid))
                .map(|h| h.tier == HouseTier::Tier0Warehouse)
                .unwrap_or(false);
            if is_tier0 { ("Belonging", "BuildHouse", Some(BranchId::B8BuildHouseTier0)) } else { ("Esteem", "BuildHouse", Some(BranchId::B11BuildHouseUpgrade)) }
        }
        PrimitiveActionState::SeekingCourtship => ("Belonging", "Courtship", Some(BranchId::B16Courtship)),
        PrimitiveActionState::RaiseChild => ("Esteem", "RaiseChild", Some(BranchId::B18RaiseChild)),
        PrimitiveActionState::RestingAtCamp => ("Physiological", "Rest", Some(BranchId::B3Rest)),
        PrimitiveActionState::OffRoadDetour => ("Safety", "Detour", None),
        _ => return None,
    };
    let lvl = branch
        .and_then(|b| super::branches::level_override_for(config, b))
        .map(|lv| lv.as_str())
        .unwrap_or(lvl);
    Some((lvl, kind))
}
