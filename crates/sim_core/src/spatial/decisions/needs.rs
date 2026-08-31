use super::super::vec3::Vec3;
use super::super::graph::NodeId;
use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::house::{House, HouseTier};
use super::super::poi::PoiId;
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
    FoundHome,      // 归属: 无家成年男性自主“自立门户”选址立宅 (0级仓库)
    StockStone,     // 尊重: 采石建材 (庄舍/庄园升级储备)
    StockGold,      // 尊重: 为3级庄舍升级大庄园备金 (冷却 45s)
    GoldWealth,     // 自我实现: 4级大庄园竣工后的娱乐性淘金 (冷却 180s)
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

/// 决策上下文：收集资源节点；是否可用由每个 Agent 的私有触发器决定。
pub struct DecisionContext {
    pub water_nodes: Vec<ResourceNode>,
    pub food_nodes: Vec<ResourceNode>,
    pub wood_nodes: Vec<ResourceNode>,
    pub stone_nodes: Vec<ResourceNode>,
    pub gold_nodes: Vec<ResourceNode>,
    pub camp_positions: Vec<(NodeId, Vec3)>,
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

pub fn house_stock_needs(house: &House, config: &SimConfig) -> HouseStockNeeds {
    let (need_water, need_food, need_wood, need_stone, need_gold) = match house.tier {
        HouseTier::Tier0Warehouse => (
            house.pantry_water < (house.max_pantry_water * config.house_upgrade_tier0_water_ratio),
            house.pantry_food < (house.max_pantry_food * config.house_upgrade_tier0_food_ratio),
            false, false, false,
        ),
        HouseTier::Tier1ThatchedHut => (
            house.pantry_water < (house.max_pantry_water * config.house_upgrade_tier1_food_water_ratio),
            house.pantry_food < (house.max_pantry_food * config.house_upgrade_tier1_food_water_ratio),
            house.pantry_wood < (house.max_pantry_wood * config.house_upgrade_tier1_wood_ratio),
            false, false,
        ),
        HouseTier::Tier2LeanTo => (
            house.pantry_water < (house.max_pantry_water * config.house_upgrade_tier2_other_ratio),
            house.pantry_food < (house.max_pantry_food * config.house_upgrade_tier2_other_ratio),
            house.pantry_wood < (house.max_pantry_wood * config.house_upgrade_tier2_other_ratio),
            house.pantry_stone < (house.max_pantry_stone * config.house_upgrade_tier2_stone_ratio),
            false,
        ),
        HouseTier::Tier3Homestead => (
            house.pantry_water < (house.max_pantry_water * config.house_upgrade_tier3_other_ratio),
            house.pantry_food < (house.max_pantry_food * config.house_upgrade_tier3_other_ratio),
            house.pantry_wood < (house.max_pantry_wood * config.house_upgrade_tier3_other_ratio),
            house.pantry_stone < (house.max_pantry_stone * config.house_upgrade_tier3_gold_stone_ratio),
            house.pantry_gold < (house.max_pantry_gold * config.house_upgrade_tier3_gold_stone_ratio),
        ),
        HouseTier::Tier4Manor => (
            house.pantry_water < (house.max_pantry_water * config.house_fertility_stock_ratio),
            house.pantry_food < (house.max_pantry_food * config.house_fertility_stock_ratio),
            house.pantry_wood < (house.max_pantry_wood * config.house_fertility_stock_ratio),
            false, false,
        ),
    };
    HouseStockNeeds {
        need_repair: house.durability < config.decision_house_repair_need_threshold && !house.is_ruin,
        need_water, need_food, need_wood, need_stone, need_gold,
    }
}

pub fn state_need_label_with_agent(state: PrimitiveActionState, agent: &Agent3D, houses: &[House], config: &SimConfig) -> Option<(&'static str, &'static str)> {
    Some(match state {
        PrimitiveActionState::SeekingWater | PrimitiveActionState::DrinkingAtWater => {
            if agent.thirst < config.decision_critical_thirst { ("Physiological", "QuenchThirst") } else { ("Safety", "StockWater") }
        }
        PrimitiveActionState::SeekingFood | PrimitiveActionState::ForagingFood => {
            if agent.hunger < config.decision_critical_hunger { ("Physiological", "SateHunger") } else { ("Safety", "StockFood") }
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
            if agent.stamina < config.decision_work_stamina_threshold { ("Physiological", "Rest") } else { ("Safety", "ReturnHome") }
        }
        PrimitiveActionState::RepairingHouse => ("Safety", "RepairHouse"),
        PrimitiveActionState::ConstructingHouse => {
            let is_tier0 = agent.home_house_id
                .and_then(|hid| houses.iter().find(|h| h.id == hid))
                .map(|h| h.tier == HouseTier::Tier0Warehouse)
                .unwrap_or(false);
            if is_tier0 { ("Belonging", "BuildHouse") } else { ("Esteem", "BuildHouse") }
        }
        PrimitiveActionState::RestingAtCamp => ("Physiological", "Rest"),
        PrimitiveActionState::OffRoadDetour => ("Safety", "Detour"),
        _ => return None,
    })
}
