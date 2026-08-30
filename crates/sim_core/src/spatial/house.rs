use serde::{Deserialize, Serialize};
use super::vec3::Vec3;
use super::graph::NodeId;
use super::agent::AgentId;
use crate::config::*;

/// 房屋建筑等级 (多级资本积累与仓储扩容)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HouseTier {
    Tier0Warehouse,   // 0级 仓库 (无劳动力门槛，容量各 10.0，满水粮后投入30s升级)
    Tier1ThatchedHut, // 1级 茅草房 (容量各 20.0，迎娶结发，水粮木≥10激活生育，满木材升级私宅)
    Tier2LeanTo,      // 2级 私宅 (容量各 40.0，私产大屋，升级庄舍需储备石头)
    Tier3Homestead,   // 3级 木石庄舍 (容量各 80.0，升级庄园需储备石头)
    Tier4Manor,       // 4级 氏族大庄园 (容量各 150.0，终极聚落大屋)
}

/// 房屋实体 (耐用资本品、独立分品类仓储、修缮维护与家庭避风港)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct House {
    pub id: u32,
    pub owner_id: AgentId,                 // 户主 ID
    pub spouse_id: Option<AgentId>,         // 配偶共有人 ID
    pub camp_id: u32,                       // 归属行政管辖营地 ID (PoiId)
    pub pos: Vec3,                          // 房屋世界坐标
    pub door_node_id: NodeId,               // 房屋大门连接的路网节点
    pub tier: HouseTier,                    // 房屋等级
    pub durability: f32,                    // 耐久度 (0.0 ~ 100.0)
    pub pantry_food: f32,                   // 私有食物独立储备 (单位)
    pub max_pantry_food: f32,               // 私有食物仓储上限 (单位)
    pub pantry_water: f32,                  // 私有水资源独立储备 (单位)
    pub max_pantry_water: f32,              // 私有水资源仓储上限 (单位)
    pub pantry_wood: f32,                   // 私有木材独立储备 (单位，用于冬季取暖与升级私宅)
    pub max_pantry_wood: f32,               // 私有木材仓储上限 (单位)
    pub pantry_stone: f32,                  // 私有石料独立储备 (单位，仅用于盖房与高级升级)
    pub max_pantry_stone: f32,              // 私有石料仓储上限 (单位)
    pub pantry_gold: f32,                   // 私有黄金独立储备 (单位，用于最高级大庄园升级与奢华贮藏)
    pub max_pantry_gold: f32,               // 私有黄金仓储上限 (单位)
    pub age: f32,                           // 房龄 (秒)
    pub generation: u32,                    // 代际传承代数 (从第1代祖屋开始)
    pub is_ruin: bool,                      // 是否因户主绝嗣而成为无主废墟
    pub construction_progress: f32,         // 升级/建造工时进度 (0.0 ~ 1.0)
    pub is_repairing: bool,                 // 当前是否正在被族人劳作修缮
}

impl House {
    pub fn new(id: u32, owner_id: AgentId, pos: Vec3, door_node_id: NodeId, tier: HouseTier, camp_id: u32) -> Self {
        let (init_water, init_food, init_wood, init_stone, init_gold, max_cap, init_prog) = match tier {
            HouseTier::Tier0Warehouse => (0.0, 0.0, 0.0, 0.0, 0.0, HOUSE_CAPACITY_TIER0, 0.0), // 0级仓库不附赠任何初始资源，需自主搬运备货
            HouseTier::Tier1ThatchedHut => (20.0, 20.0, 20.0, 0.0, 0.0, HOUSE_CAPACITY_TIER1, 1.0),
            HouseTier::Tier2LeanTo => (40.0, 40.0, 40.0, 0.0, 0.0, HOUSE_CAPACITY_TIER2, 1.0),
            HouseTier::Tier3Homestead => (60.0, 60.0, 60.0, 0.0, 0.0, HOUSE_CAPACITY_TIER3, 1.0),
            HouseTier::Tier4Manor => (80.0, 80.0, 80.0, 0.0, 0.0, HOUSE_CAPACITY_TIER4, 1.0),
        };

        Self {
            id,
            owner_id,
            spouse_id: None,
            camp_id,
            pos,
            door_node_id,
            tier,
            durability: HOUSE_DURABILITY_MAX,
            pantry_food: init_food,
            max_pantry_food: max_cap,
            pantry_water: init_water,
            max_pantry_water: max_cap,
            pantry_wood: init_wood,
            max_pantry_wood: max_cap,
            pantry_stone: init_stone,
            max_pantry_stone: max_cap,
            pantry_gold: init_gold,
            max_pantry_gold: max_cap,
            age: 0.0,
            generation: 1,
            is_ruin: false,
            construction_progress: init_prog,
            is_repairing: false,
        }
    }

    /// 是否支持继续怀孕/激活生育 (必须是非0级仓库且水粮木均≥最大容量的50%，未成废墟)
    pub fn is_fertility_active(&self) -> bool {
        self.tier != HouseTier::Tier0Warehouse
            && self.pantry_water >= (self.max_pantry_water * HOUSE_FERTILITY_STOCK_RATIO)
            && self.pantry_food >= (self.max_pantry_food * HOUSE_FERTILITY_STOCK_RATIO)
            && self.pantry_wood >= (self.max_pantry_wood * HOUSE_FERTILITY_STOCK_RATIO)
            && !self.is_ruin
    }

    /// 仓库是否已达到升级所需物资要求
    pub fn is_pantry_full(&self) -> bool {
        match self.tier {
            HouseTier::Tier0Warehouse => {
                self.pantry_water >= (self.max_pantry_water * HOUSE_UPGRADE_TIER0_WATER_RATIO) && self.pantry_food >= (self.max_pantry_food * HOUSE_UPGRADE_TIER0_FOOD_RATIO)
            }
            HouseTier::Tier1ThatchedHut => {
                self.pantry_wood >= (self.max_pantry_wood * HOUSE_UPGRADE_TIER1_WOOD_RATIO) && self.pantry_water >= (self.max_pantry_water * HOUSE_UPGRADE_TIER1_FOOD_WATER_RATIO) && self.pantry_food >= (self.max_pantry_food * HOUSE_UPGRADE_TIER1_FOOD_WATER_RATIO)
            }
            HouseTier::Tier2LeanTo => {
                self.pantry_stone >= (self.max_pantry_stone * HOUSE_UPGRADE_TIER2_STONE_RATIO) && self.pantry_wood >= (self.max_pantry_wood * HOUSE_UPGRADE_TIER2_OTHER_RATIO) && self.pantry_water >= (self.max_pantry_water * HOUSE_UPGRADE_TIER2_OTHER_RATIO) && self.pantry_food >= (self.max_pantry_food * HOUSE_UPGRADE_TIER2_OTHER_RATIO)
            }
            HouseTier::Tier3Homestead => {
                self.pantry_gold >= (self.max_pantry_gold * HOUSE_UPGRADE_TIER3_GOLD_STONE_RATIO) && self.pantry_stone >= (self.max_pantry_stone * HOUSE_UPGRADE_TIER3_GOLD_STONE_RATIO) && self.pantry_wood >= (self.max_pantry_wood * HOUSE_UPGRADE_TIER3_OTHER_RATIO) && self.pantry_water >= (self.max_pantry_water * HOUSE_UPGRADE_TIER3_OTHER_RATIO) && self.pantry_food >= (self.max_pantry_food * HOUSE_UPGRADE_TIER3_OTHER_RATIO)
            }
            HouseTier::Tier4Manor => false,
        }
    }

    /// 晋升下一级房屋 (大幅扩容储备空间: 20 -> 40 -> 80 -> 120 -> 160)
    pub fn upgrade_to_next_tier(&mut self) -> bool {
        match self.tier {
            HouseTier::Tier0Warehouse => {
                self.tier = HouseTier::Tier1ThatchedHut;
                self.max_pantry_water = HOUSE_CAPACITY_TIER1;
                self.max_pantry_food = HOUSE_CAPACITY_TIER1;
                self.max_pantry_wood = HOUSE_CAPACITY_TIER1;
                self.max_pantry_stone = HOUSE_CAPACITY_TIER1;
                self.max_pantry_gold = HOUSE_CAPACITY_TIER1;
                self.construction_progress = 1.0;
                true
            }
            HouseTier::Tier1ThatchedHut => {
                self.tier = HouseTier::Tier2LeanTo;
                self.max_pantry_water = HOUSE_CAPACITY_TIER2;
                self.max_pantry_food = HOUSE_CAPACITY_TIER2;
                self.max_pantry_wood = HOUSE_CAPACITY_TIER2;
                self.max_pantry_stone = HOUSE_CAPACITY_TIER2;
                self.max_pantry_gold = HOUSE_CAPACITY_TIER2;
                self.construction_progress = 1.0;
                true
            }
            HouseTier::Tier2LeanTo => {
                self.tier = HouseTier::Tier3Homestead;
                self.max_pantry_water = HOUSE_CAPACITY_TIER3;
                self.max_pantry_food = HOUSE_CAPACITY_TIER3;
                self.max_pantry_wood = HOUSE_CAPACITY_TIER3;
                self.max_pantry_stone = HOUSE_CAPACITY_TIER3;
                self.max_pantry_gold = HOUSE_CAPACITY_TIER3;
                self.construction_progress = 1.0;
                true
            }
            HouseTier::Tier3Homestead => {
                self.tier = HouseTier::Tier4Manor;
                self.max_pantry_water = HOUSE_CAPACITY_TIER4;
                self.max_pantry_food = HOUSE_CAPACITY_TIER4;
                self.max_pantry_wood = HOUSE_CAPACITY_TIER4;
                self.max_pantry_stone = HOUSE_CAPACITY_TIER4;
                self.max_pantry_gold = HOUSE_CAPACITY_TIER4;
                self.construction_progress = 1.0;
                true
            }
            HouseTier::Tier4Manor => false,
        }
    }

    /// 劳作修缮房屋 (+amount 耐久度)
    pub fn repair(&mut self, amount: f32) {
        self.durability = (self.durability + amount).min(HOUSE_DURABILITY_MAX);
    }

    /// 房屋自然风化与折旧
    pub fn tick_depreciation(&mut self, dt: f32) {
        self.age += dt;
        let decay_rate = if self.is_ruin { HOUSE_DEPRECIATION_RATE * 15.0 } else { HOUSE_DEPRECIATION_RATE * 2.0 };
        self.durability = (self.durability - decay_rate * dt).max(0.0);
    }
}

/// 房屋可视化与前端快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HouseSnapshot {
    pub id: u32,
    pub owner_id: AgentId,
    pub spouse_id: Option<AgentId>,
    pub camp_id: u32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub tier: String,
    pub durability: f32,
    pub pantry_food: f32,
    pub max_pantry_food: f32,
    pub pantry_water: f32,
    pub max_pantry_water: f32,
    pub pantry_wood: f32,
    pub max_pantry_wood: f32,
    pub pantry_stone: f32,
    pub max_pantry_stone: f32,
    pub age: f32,
    pub generation: u32,
    pub is_ruin: bool,
    pub construction_progress: f32,
    pub is_fertility_active: bool,
    pub is_pantry_full: bool,
    pub is_repairing: bool,
}
