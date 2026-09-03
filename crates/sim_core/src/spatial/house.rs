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

/// 房屋历史报价档案条目 (v1.14.0)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HouseBidRecord {
    pub tick: u64,
    pub bidder_id: AgentId,
    pub household_id: u64,
    pub amount: f32,
    pub durability: f32,
    pub valuation: f32,
    pub phase: String, // "观察期" | "决策期" | "出清期"
}

/// 房屋历史成交档案条目 (v1.14.0)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HouseDealRecord {
    pub deal_tick: u64,
    pub buyer_id: AgentId,
    pub household_id: u64,
    pub price: f32,
    pub durability: f32,
    pub valuation: f32,
    pub camp_id: u32,
    pub total_bids_count: usize,
    pub reason: String, // "麦穗决策期击中更高报价" | "10%修缮度最后时限最高价强制成交"
}

/// 正在进行的拍卖现场状态（房屋有主时为 None）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HouseAuctionState {
    pub start_durability: f32,
    pub benchmark_bid: f32,
    pub current_highest_bid: f32,
    pub current_highest_bidder: Option<AgentId>,
}

/// 房屋实体（M6 建筑化：只保留等级/耐久/位置/户主等建筑属性，不再持有任何资源存量）
/// ★ v1.10.0 去绝嗣废弃：owner_id 改为 Option（None=无主空置房），删除 is_ruin/generation，
/// 无主房屋不再加速风化，户主死亡后由营地空置房屋列表登记受益人。
/// ★ v1.14.0 营地虚拟中介拍卖与档案持久化（估价、麦穗拍卖状态、报价历史、成交记录）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct House {
    pub id: u32,
    pub owner_id: Option<AgentId>,          // 户主 ID（None=无主空置房）
    pub spouse_id: Option<AgentId>,         // 配偶共有人 ID（有房夫妇同住时登记）
    pub camp_id: u32,                       // 归属行政管辖营地 ID (PoiId)
    pub pos: Vec3,                          // 房屋世界坐标
    pub door_node_id: NodeId,               // 房屋大门连接的路网节点
    pub tier: HouseTier,                    // 房屋等级
    pub durability: f32,                    // 耐久度 (0.0 ~ 100.0)
    pub age: f32,                           // 房龄 (秒)
    pub construction_progress: f32,         // 保留字段：历史施工进度（瞬时升级后恒为 1.0 由竣工置位，纯兼容保留）
    pub is_repairing: bool,                 // 当前是否正在被族人劳作修缮
    pub builder_id: AgentId,                // 修建者（立宅人）：立宅时即固定
    pub last_upgrader_id: Option<AgentId>,  // 最近升级者：每次升级时更新；从未升级为 None

    // ★ v1.14.0 拍卖与档案扩展
    #[serde(default)]
    pub bids_history: Vec<HouseBidRecord>,
    #[serde(default)]
    pub deal_history: Vec<HouseDealRecord>,
    #[serde(default)]
    pub auction_state: Option<HouseAuctionState>,
    #[serde(default)]
    pub current_valuation: f32,
}

impl House {
    pub fn new(id: u32, owner_id: AgentId, pos: Vec3, door_node_id: NodeId, tier: HouseTier, camp_id: u32) -> Self {
        Self::new_with_config(id, owner_id, pos, door_node_id, tier, camp_id, &SimConfig::default())
    }

    pub fn new_with_config(id: u32, owner_id: AgentId, pos: Vec3, door_node_id: NodeId, tier: HouseTier, camp_id: u32, config: &SimConfig) -> Self {
        Self {
            id,
            owner_id: Some(owner_id),
            spouse_id: None,
            camp_id,
            pos,
            door_node_id,
            tier,
            durability: config.house_durability_max,
            age: 0.0,
            construction_progress: 0.0,
            is_repairing: false,
            builder_id: owner_id,
            last_upgrader_id: None,
            bids_history: Vec::new(),
            deal_history: Vec::new(),
            auction_state: None,
            current_valuation: 0.0,
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

    /// 房屋自然风化与折旧（v1.10.0 起无主房屋不再加速风化，统一正常速率）
    pub fn tick_depreciation(&mut self, dt: f32, config: &SimConfig) {
        self.age += dt;
        let decay_rate = config.house_depreciation_rate * 2.0;
        self.durability = (self.durability - decay_rate * dt).max(0.0);
    }
}

/// 房屋快照中的报价条目 (v1.14.0)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HouseBidSnapshot {
    pub tick: u64,
    pub bidder_id: AgentId,
    pub amount: f32,
    pub phase: String,
}

/// 房屋快照中的成交条目 (v1.14.0)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HouseDealSnapshot {
    pub tick: u64,
    pub buyer_id: AgentId,
    pub price: f32,
    pub durability: f32,
    pub reason: String,
}

/// 房屋可视化与前端快照（M6：不再携带任何资源存量字段；v1.10.0 删除 is_ruin/generation，owner_id 为 Option）
/// ★ v1.14.0 增加估价、麦穗拍卖状态、成交与报价档案快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HouseSnapshot {
    pub id: u32,
    pub owner_id: Option<AgentId>,
    pub spouse_id: Option<AgentId>,
    pub camp_id: u32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub tier: String,
    pub durability: f32,
    pub age: f32,
    pub construction_progress: f32,
    pub is_repairing: bool,
    pub builder_id: AgentId,
    pub last_upgrader_id: Option<AgentId>,
    // ★ v1.14.0 拍卖与档案字段
    pub current_valuation: f32,
    pub auction_phase: Option<String>,
    pub benchmark_bid: f32,
    pub highest_bid: f32,
    pub bids_count: usize,
    pub last_deal_price: Option<f32>,
    pub last_deal_tick: Option<u64>,
    pub auction_start_durability: Option<f32>,
    pub recent_bids: Vec<HouseBidSnapshot>,
    pub recent_deals: Vec<HouseDealSnapshot>,
}
