use serde::{Deserialize, Serialize};
use super::vec3::Vec3;
use super::graph::NodeId;
use super::agent::AgentId;

/// 房屋建筑等级 (多级资本积累与仓储扩容)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HouseTier {
    Tier0Warehouse,   // 0级 仓库 (无劳动力门槛，容量各 10.0，满仓后投入30s升级)
    Tier1LeanTo,      // 1级 私宅 (容量各 20.0，水粮≥10激活生育，满仓后投入40s升级)
    Tier2ThatchedHut, // 2级 夯土茅草屋 (容量各 40.0，满仓后投入50s升级)
    Tier3Homestead,   // 3级 木构石基宅舍 (容量各 80.0，满仓后投入60s升级)
    Tier4Manor,       // 4级 氏族大庄园 (容量各 150.0，终极仓储大屋)
}

/// 房屋实体 (耐用资本品、独立分品类仓储、修缮维护与家庭避风港)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct House {
    pub id: u32,
    pub owner_id: AgentId,                 // 户主 ID
    pub spouse_id: Option<AgentId>,         // 配偶共有人 ID
    pub pos: Vec3,                          // 房屋世界坐标
    pub door_node_id: NodeId,               // 房屋大门连接的路网节点
    pub tier: HouseTier,                    // 房屋等级
    pub durability: f32,                    // 耐久度 (0.0 ~ 100.0)
    pub pantry_food: f32,                   // 私有食物独立储备 (单位)
    pub max_pantry_food: f32,               // 私有食物仓储上限 (单位)
    pub pantry_water: f32,                  // 私有水资源独立储备 (单位)
    pub max_pantry_water: f32,              // 私有水资源仓储上限 (单位)
    pub age: f32,                           // 房龄 (秒)
    pub generation: u32,                    // 代际传承代数 (从第1代祖屋开始)
    pub is_ruin: bool,                      // 是否因户主绝嗣而成为无主废墟
    pub construction_progress: f32,         // 升级/建造工时进度 (0.0 ~ 1.0)
    pub is_repairing: bool,                 // 当前是否正在被族人劳作修缮
}

impl House {
    pub fn new(id: u32, owner_id: AgentId, pos: Vec3, door_node_id: NodeId, tier: HouseTier) -> Self {
        let (init_water, init_food, max_cap, init_prog) = match tier {
            HouseTier::Tier0Warehouse => (5.0, 5.0, 10.0, 0.0), // 0级仓库自带 5 水 5 粮
            HouseTier::Tier1LeanTo => (10.0, 10.0, 20.0, 1.0),
            HouseTier::Tier2ThatchedHut => (20.0, 20.0, 40.0, 1.0),
            HouseTier::Tier3Homestead => (40.0, 40.0, 80.0, 1.0),
            HouseTier::Tier4Manor => (80.0, 80.0, 150.0, 1.0),
        };

        Self {
            id,
            owner_id,
            spouse_id: None,
            pos,
            door_node_id,
            tier,
            durability: 100.0,
            pantry_food: init_food,
            max_pantry_food: max_cap,
            pantry_water: init_water,
            max_pantry_water: max_cap,
            age: 0.0,
            generation: 1,
            is_ruin: false,
            construction_progress: init_prog,
            is_repairing: false,
        }
    }

    /// 是否支持继续怀孕/激活生育 (必须是非0级仓库且水粮均≥10.0单位，某项<10失去生育支持)
    pub fn is_fertility_active(&self) -> bool {
        self.tier != HouseTier::Tier0Warehouse && self.pantry_water >= 10.0 && self.pantry_food >= 10.0 && !self.is_ruin
    }

    /// 仓库是否已填满 (水粮均达到上限)
    pub fn is_pantry_full(&self) -> bool {
        self.pantry_water >= self.max_pantry_water && self.pantry_food >= self.max_pantry_food
    }

    /// 晋升下一级房屋 (大幅扩容储备空间)
    pub fn upgrade_to_next_tier(&mut self) -> bool {
        match self.tier {
            HouseTier::Tier0Warehouse => {
                self.tier = HouseTier::Tier1LeanTo;
                self.max_pantry_water = 20.0;
                self.max_pantry_food = 20.0;
                self.construction_progress = 1.0;
                true
            }
            HouseTier::Tier1LeanTo => {
                self.tier = HouseTier::Tier2ThatchedHut;
                self.max_pantry_water = 40.0;
                self.max_pantry_food = 40.0;
                self.construction_progress = 1.0;
                true
            }
            HouseTier::Tier2ThatchedHut => {
                self.tier = HouseTier::Tier3Homestead;
                self.max_pantry_water = 80.0;
                self.max_pantry_food = 80.0;
                self.construction_progress = 1.0;
                true
            }
            HouseTier::Tier3Homestead => {
                self.tier = HouseTier::Tier4Manor;
                self.max_pantry_water = 150.0;
                self.max_pantry_food = 150.0;
                self.construction_progress = 1.0;
                true
            }
            HouseTier::Tier4Manor => false,
        }
    }

    /// 劳作修缮房屋 (+amount 耐久度)
    pub fn repair(&mut self, amount: f32) {
        self.durability = (self.durability + amount).min(100.0);
    }

    /// 房屋自然风化与折旧
    pub fn tick_depreciation(&mut self, dt: f32) {
        self.age += dt;
        let decay_rate = if self.is_ruin { 0.30 } else { 0.04 };
        self.durability = (self.durability - decay_rate * dt).max(0.0);
    }
}

/// 房屋可视化与前端快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HouseSnapshot {
    pub id: u32,
    pub owner_id: AgentId,
    pub spouse_id: Option<AgentId>,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub tier: String,
    pub durability: f32,
    pub pantry_food: f32,
    pub max_pantry_food: f32,
    pub pantry_water: f32,
    pub max_pantry_water: f32,
    pub age: f32,
    pub generation: u32,
    pub is_ruin: bool,
    pub construction_progress: f32,
    pub is_fertility_active: bool,
    pub is_repairing: bool,
}
