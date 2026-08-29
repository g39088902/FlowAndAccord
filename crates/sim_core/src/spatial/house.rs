use serde::{Deserialize, Serialize};
use super::vec3::Vec3;
use super::graph::NodeId;
use super::agent::AgentId;

/// 房屋建筑等级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HouseTier {
    Tier1LeanTo,     // 简易兽皮/枯枝棚 (单人劳作 30s，建造成本翻倍，代谢降耗 20%，回体 +25%，私储 15)
    Tier2ThatchedHut, // 夯土茅草屋 (家庭筑造 60s，建造成本翻倍，代谢降耗 40%，回体 +75%，流产率减半，私储 30)
    Tier3Homestead,   // 木构石基宅舍 (家族祖屋 120s，代谢降耗 60%，回体 +120%，私储 60)
}

/// 房屋实体 (耐用资本品与私有产权空间)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct House {
    pub id: u32,
    pub owner_id: AgentId,                 // 户主 ID
    pub spouse_id: Option<AgentId>,         // 配偶共有人 ID
    pub pos: Vec3,                          // 房屋世界坐标
    pub door_node_id: NodeId,               // 房屋大门连接的路网节点
    pub tier: HouseTier,                    // 房屋等级
    pub durability: f32,                    // 耐久度 (0.0 ~ 100.0)
    pub pantry_food: f32,                   // 私有食物储备 (单位)
    pub pantry_water: f32,                  // 私有水资源储备 (单位)
    pub max_pantry_capacity: f32,           // 私有仓储上限
    pub age: f32,                           // 房龄 (秒)
    pub generation: u32,                    // 代际传承代数 (从第1代祖屋开始)
    pub is_ruin: bool,                      // 是否因户主绝嗣而成为无主废墟
    pub construction_progress: f32,         // 建造进度 (0.0 ~ 1.0, 1.0 表示竣工)
}

impl House {
    pub fn new(id: u32, owner_id: AgentId, pos: Vec3, door_node_id: NodeId, tier: HouseTier) -> Self {
        let max_pantry = match tier {
            HouseTier::Tier1LeanTo => 15.0,
            HouseTier::Tier2ThatchedHut => 30.0,
            HouseTier::Tier3Homestead => 60.0,
        };

        Self {
            id,
            owner_id,
            spouse_id: None,
            pos,
            door_node_id,
            tier,
            durability: 100.0,
            pantry_food: 0.0,
            pantry_water: 0.0,
            max_pantry_capacity: max_pantry,
            age: 0.0,
            generation: 1,
            is_ruin: false,
            construction_progress: 0.0,
        }
    }

    /// 室内代谢降耗系数 (乘在原本的 decayRate 上)
    pub fn metabolic_efficiency_factor(&self) -> f32 {
        if self.construction_progress < 1.0 || self.is_ruin {
            return 1.0;
        }
        match self.tier {
            HouseTier::Tier1LeanTo => 0.80,     // 节省 20%
            HouseTier::Tier2ThatchedHut => 0.60, // 节省 40%
            HouseTier::Tier3Homestead => 0.40,   // 节省 60%
        }
    }

    /// 室内体力恢复速率 (单位/秒)
    pub fn stamina_recovery_rate(&self) -> f32 {
        if self.construction_progress < 1.0 || self.is_ruin {
            return 8.0;
        }
        match self.tier {
            HouseTier::Tier1LeanTo => 10.0,
            HouseTier::Tier2ThatchedHut => 14.0,
            HouseTier::Tier3Homestead => 18.0,
        }
    }

    /// 房屋自然风化与折旧 (老化速度翻倍：正常 0.04/s，废墟 0.30/s)
    pub fn tick_depreciation(&mut self, dt: f32) {
        if self.construction_progress < 1.0 {
            return;
        }
        self.age += dt;
        let decay_rate = if self.is_ruin { 0.30 } else { 0.04 }; // 正常 2500s 折旧完毕，废墟 330s 风化坍塌
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
    pub pantry_water: f32,
    pub max_pantry_capacity: f32,
    pub age: f32,
    pub generation: u32,
    pub is_ruin: bool,
    pub construction_progress: f32,
}
