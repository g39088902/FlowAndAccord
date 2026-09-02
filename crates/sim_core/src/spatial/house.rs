use serde::{Deserialize, Serialize};
use super::vec3::Vec3;
use super::graph::NodeId;
use super::agent::AgentId;
use crate::config::*;

/// 房屋建筑等级（M6 起不再承载仓储容量——家庭物资唯一真相源为家户账本，等级仅作目标基准与威望因子）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HouseTier {
    Tier0Warehouse,   // 0级 仓库 (无建材即立的起步营地)
    Tier1ThatchedHut, // 1级 茅草房
    Tier2LeanTo,      // 2级 私宅
    Tier3Homestead,   // 3级 木石庄舍
    Tier4Manor,       // 4级 氏族大庄园
}

/// 房屋实体（M6 建筑化：只保留等级/耐久/位置/户主/代际等建筑属性，不再持有任何资源存量）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct House {
    pub id: u32,
    pub owner_id: AgentId,                 // 户主 ID
    pub spouse_id: Option<AgentId>,         // 配偶共有人 ID（有房夫妇同住时登记）
    pub camp_id: u32,                       // 归属行政管辖营地 ID (PoiId)
    pub pos: Vec3,                          // 房屋世界坐标
    pub door_node_id: NodeId,               // 房屋大门连接的路网节点
    pub tier: HouseTier,                    // 房屋等级
    pub durability: f32,                    // 耐久度 (0.0 ~ 100.0)
    pub age: f32,                           // 房龄 (秒)
    pub generation: u32,                    // 代际传承代数 (从第1代祖屋开始)
    pub is_ruin: bool,                      // 是否因户主绝嗣而成为无主废墟
    pub construction_progress: f32,         // 保留字段：历史施工进度（瞬时升级后恒为 1.0 由竣工置位，纯兼容保留）
    pub is_repairing: bool,                 // 当前是否正在被族人劳作修缮
}

impl House {
    pub fn new(id: u32, owner_id: AgentId, pos: Vec3, door_node_id: NodeId, tier: HouseTier, camp_id: u32) -> Self {
        Self::new_with_config(id, owner_id, pos, door_node_id, tier, camp_id, &SimConfig::default())
    }

    pub fn new_with_config(id: u32, owner_id: AgentId, pos: Vec3, door_node_id: NodeId, tier: HouseTier, camp_id: u32, config: &SimConfig) -> Self {
        Self {
            id,
            owner_id,
            spouse_id: None,
            camp_id,
            pos,
            door_node_id,
            tier,
            durability: config.house_durability_max,
            age: 0.0,
            generation: 1,
            is_ruin: false,
            construction_progress: 0.0,
            is_repairing: false,
        }
    }

    /// 晋升下一级房屋（M6 仅推进等级；仓储/容量语义已移除，config 仅用于兼容签名）
    pub fn upgrade_to_next_tier(&mut self, _config: &SimConfig) -> bool {
        match self.tier {
            HouseTier::Tier0Warehouse => {
                self.tier = HouseTier::Tier1ThatchedHut;
                self.construction_progress = 1.0;
                true
            }
            HouseTier::Tier1ThatchedHut => {
                self.tier = HouseTier::Tier2LeanTo;
                self.construction_progress = 1.0;
                true
            }
            HouseTier::Tier2LeanTo => {
                self.tier = HouseTier::Tier3Homestead;
                self.construction_progress = 1.0;
                true
            }
            HouseTier::Tier3Homestead => {
                self.tier = HouseTier::Tier4Manor;
                self.construction_progress = 1.0;
                true
            }
            HouseTier::Tier4Manor => false,
        }
    }

    /// 劳作修缮房屋 (+amount 耐久度)
    pub fn repair(&mut self, amount: f32, config: &SimConfig) {
        self.durability = (self.durability + amount).min(config.house_durability_max);
    }

    /// 房屋自然风化与折旧
    pub fn tick_depreciation(&mut self, dt: f32, config: &SimConfig) {
        self.age += dt;
        let decay_rate = if self.is_ruin { config.house_depreciation_rate * 15.0 } else { config.house_depreciation_rate * 2.0 };
        self.durability = (self.durability - decay_rate * dt).max(0.0);
    }
}

/// 房屋可视化与前端快照（M6：不再携带任何资源存量字段）
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
    pub age: f32,
    pub generation: u32,
    pub is_ruin: bool,
    pub construction_progress: f32,
    pub is_repairing: bool,
}
