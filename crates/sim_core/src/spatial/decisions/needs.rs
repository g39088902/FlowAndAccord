use super::super::vec3::Vec3;
use super::super::graph::NodeId;
use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::house::{House, HouseTier};
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
    StockStone,     // 尊重: 采石建材 (庄舍/庄园升级储备)
    StockGold,      // 尊重: 为3级庄舍升级大庄园备金 (冷却 45s)
    GoldWealth,     // 自我实现: 4级大庄园竣工后的娱乐性淘金 (冷却 180s)
    ForageSurplus,  // 生理: 体力充沛时的低概率富余觅食
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
    pub fn nodes(self, ctx: &DecisionContext) -> &[NodeId] {
        match self {
            NodePool::Water => &ctx.water_nodes,
            NodePool::Food => &ctx.food_nodes,
            NodePool::Wood => &ctx.wood_nodes,
            NodePool::Stone => &ctx.stone_nodes,
            NodePool::Gold => &ctx.gold_nodes,
        }
    }
}

/// 决策上下文: 仅收集全图储量充足 (≥30%) 的资源节点池与营地坐标
pub struct DecisionContext {
    pub water_nodes: Vec<NodeId>,
    pub food_nodes: Vec<NodeId>,
    pub wood_nodes: Vec<NodeId>,
    pub stone_nodes: Vec<NodeId>,
    pub gold_nodes: Vec<NodeId>,
    pub camp_positions: Vec<(NodeId, Vec3)>,
    pub gold_depleted: bool,
}

/// 家宅物资与修缮缺口 (按房屋等级与耐久度计算)
pub struct HouseStockNeeds {
    pub need_repair: bool,
    pub need_water: bool,
    pub need_food: bool,
    pub need_wood: bool,
    pub need_stone: bool,
    pub need_gold: bool,
}

pub fn house_stock_needs(house: &House) -> HouseStockNeeds {
    let (need_water, need_food, need_wood, need_stone, need_gold) = match house.tier {
        HouseTier::Tier0Warehouse => (
            house.pantry_water < (house.max_pantry_water * HOUSE_UPGRADE_TIER0_WATER_RATIO),
            house.pantry_food < (house.max_pantry_food * HOUSE_UPGRADE_TIER0_FOOD_RATIO),
            false, false, false,
        ),
        HouseTier::Tier1ThatchedHut => (
            house.pantry_water < (house.max_pantry_water * HOUSE_UPGRADE_TIER1_FOOD_WATER_RATIO),
            house.pantry_food < (house.max_pantry_food * HOUSE_UPGRADE_TIER1_FOOD_WATER_RATIO),
            house.pantry_wood < (house.max_pantry_wood * HOUSE_UPGRADE_TIER1_WOOD_RATIO),
            false, false,
        ),
        HouseTier::Tier2LeanTo => (
            house.pantry_water < (house.max_pantry_water * HOUSE_UPGRADE_TIER2_OTHER_RATIO),
            house.pantry_food < (house.max_pantry_food * HOUSE_UPGRADE_TIER2_OTHER_RATIO),
            house.pantry_wood < (house.max_pantry_wood * HOUSE_UPGRADE_TIER2_OTHER_RATIO),
            house.pantry_stone < (house.max_pantry_stone * HOUSE_UPGRADE_TIER2_STONE_RATIO),
            false,
        ),
        HouseTier::Tier3Homestead => (
            house.pantry_water < (house.max_pantry_water * HOUSE_UPGRADE_TIER3_OTHER_RATIO),
            house.pantry_food < (house.max_pantry_food * HOUSE_UPGRADE_TIER3_OTHER_RATIO),
            house.pantry_wood < (house.max_pantry_wood * HOUSE_UPGRADE_TIER3_OTHER_RATIO),
            house.pantry_stone < (house.max_pantry_stone * HOUSE_UPGRADE_TIER3_GOLD_STONE_RATIO),
            house.pantry_gold < (house.max_pantry_gold * HOUSE_UPGRADE_TIER3_GOLD_STONE_RATIO),
        ),
        HouseTier::Tier4Manor => (
            house.pantry_water < (house.max_pantry_water * HOUSE_FERTILITY_STOCK_RATIO),
            house.pantry_food < (house.max_pantry_food * HOUSE_FERTILITY_STOCK_RATIO),
            house.pantry_wood < (house.max_pantry_wood * HOUSE_FERTILITY_STOCK_RATIO),
            false, false,
        ),
    };
    HouseStockNeeds {
        need_repair: house.durability < DECISION_HOUSE_REPAIR_NEED_THRESHOLD && !house.is_ruin,
        need_water, need_food, need_wood, need_stone, need_gold,
    }
}

pub fn state_need_label_with_agent(state: PrimitiveActionState, agent: &Agent3D, houses: &[House]) -> Option<(&'static str, &'static str)> {
    Some(match state {
        PrimitiveActionState::SeekingWater | PrimitiveActionState::DrinkingAtWater => {
            if agent.thirst < 25.0 { ("Physiological", "QuenchThirst") } else { ("Safety", "StockWater") }
        }
        PrimitiveActionState::SeekingFood | PrimitiveActionState::ForagingFood => {
            if agent.hunger < 25.0 { ("Physiological", "SateHunger") } else { ("Safety", "StockFood") }
        }
        PrimitiveActionState::SeekingWood | PrimitiveActionState::GatheringWood => ("Safety", "StockWood"),
        PrimitiveActionState::SeekingStone | PrimitiveActionState::MiningStone => ("Esteem", "StockStone"),
        PrimitiveActionState::SeekingGold | PrimitiveActionState::MiningGold => {
            let is_building_stock = agent.home_house_id
                .and_then(|hid| houses.iter().find(|h| h.id == hid))
                .map(|h| h.tier == HouseTier::Tier3Homestead && h.pantry_gold < h.max_pantry_gold)
                .unwrap_or(false);
            if is_building_stock { ("Esteem", "StockGold") } else { ("SelfActualization", "GoldWealth") }
        }
        PrimitiveActionState::ReturningToCamp => {
            if agent.stamina < 50.0 { ("Physiological", "Rest") } else { ("Safety", "ReturnHome") }
        }
        PrimitiveActionState::RepairingHouse => ("Safety", "RepairHouse"),
        PrimitiveActionState::ConstructingHouse => {
            let is_tier0 = agent.home_house_id
                .and_then(|hid| houses.iter().find(|h| h.id == hid))
                .map(|h| h.tier == HouseTier::Tier0Warehouse)
                .unwrap_or(false);
            if is_tier0 { ("Belonging", "BuildHouse") } else { ("Esteem", "BuildHouse") }
        }
        PrimitiveActionState::OffRoadDetour => ("Safety", "Detour"),
        _ => return None,
    })
}