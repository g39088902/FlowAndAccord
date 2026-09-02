//! 需求判定分支注册表 (branches.rs)
//!
//! `evaluate_needs` 的 13 条分支抽为按稳定字符串 ID ("b1".."b13") 索引的自包含条件函数。
//! 本文件只描述「每条分支的语义」，**不持有任何策展优先级**：
//! 评估顺序的唯一真相源是前端持久化配置文件 `frontend/js/config.decision-order.js`，
//! 经 `SimConfig.decision_eval_order` 热注入；为空或非法时回退 `BranchId::ALL`
//! 中性声明序（b1→b13，仅兜底，不携带语义优先级）。
//!
//! 每条分支的条件函数自包含全部守卫（无家守卫 / b13 的 4 级庄园门禁 /
//! b5~b7 的 family_level 动态默认），因此任意排列都语义安全，无需框架特判。

use super::super::agent::{Agent3D, Gender, PrimitiveActionState};
use super::super::house::{House, HouseTier};
use super::evaluate::Decisioner;
use super::needs::*;
use crate::config::SimConfig;

/// 13 条需求判定分支的稳定标识（声明序即中性兜底序，不含语义优先级）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BranchId {
    B1QuenchThirst,
    B2SateHunger,
    B3Rest,
    B4RepairHouse,
    B5StockWater,
    B6StockFood,
    B7StockWood,
    B8BuildHouseTier0,
    B9StockStone,
    B10StockGold,
    B11BuildHouseUpgrade,
    B12FoundHome,
    B13GoldWealth,
}

impl BranchId {
    /// 中性声明序（b1..b13）：仅作配置缺失/非法时的兜底遍历序，不携带语义优先级。
    /// 生产环境的策展优先级只存在于前端配置文件，严禁在此处写死。
    pub const ALL: [BranchId; 13] = [
        BranchId::B1QuenchThirst,
        BranchId::B2SateHunger,
        BranchId::B3Rest,
        BranchId::B4RepairHouse,
        BranchId::B5StockWater,
        BranchId::B6StockFood,
        BranchId::B7StockWood,
        BranchId::B8BuildHouseTier0,
        BranchId::B9StockStone,
        BranchId::B10StockGold,
        BranchId::B11BuildHouseUpgrade,
        BranchId::B12FoundHome,
        BranchId::B13GoldWealth,
    ];

    /// 分支 → 稳定字符串 ID（与前端 decision-viz-data.js 的 BRANCHES 一一对应）
    pub fn str_id(self) -> &'static str {
        match self {
            BranchId::B1QuenchThirst => "b1",
            BranchId::B2SateHunger => "b2",
            BranchId::B3Rest => "b3",
            BranchId::B4RepairHouse => "b4",
            BranchId::B5StockWater => "b5",
            BranchId::B6StockFood => "b6",
            BranchId::B7StockWood => "b7",
            BranchId::B8BuildHouseTier0 => "b8",
            BranchId::B9StockStone => "b9",
            BranchId::B10StockGold => "b10",
            BranchId::B11BuildHouseUpgrade => "b11",
            BranchId::B12FoundHome => "b12",
            BranchId::B13GoldWealth => "b13",
        }
    }

    /// 字符串 ID → 分支
    pub fn from_str_id(s: &str) -> Option<BranchId> {
        Some(match s {
            "b1" => BranchId::B1QuenchThirst,
            "b2" => BranchId::B2SateHunger,
            "b3" => BranchId::B3Rest,
            "b4" => BranchId::B4RepairHouse,
            "b5" => BranchId::B5StockWater,
            "b6" => BranchId::B6StockFood,
            "b7" => BranchId::B7StockWood,
            "b8" => BranchId::B8BuildHouseTier0,
            "b9" => BranchId::B9StockStone,
            "b10" => BranchId::B10StockGold,
            "b11" => BranchId::B11BuildHouseUpgrade,
            "b12" => BranchId::B12FoundHome,
            "b13" => BranchId::B13GoldWealth,
            _ => return None,
        })
    }

    fn index(self) -> usize {
        self as usize
    }

    /// 自包含分支条件：命中返回 Need（level 为代码动态默认，可被 decision_eval_levels 覆盖）。
    /// 不消耗 RNG，可安全地以任意顺序调用。
    pub fn evaluate(&self, d: &Decisioner, a: &Agent3D) -> Option<Need> {
        let cfg = d.config;
        match self {
            BranchId::B1QuenchThirst => {
                if a.thirst < cfg.decision_critical_thirst && d.has_available_node(a, NodePool::Water) {
                    return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::QuenchThirst, target_state: PrimitiveActionState::SeekingWater });
                }
            }
            BranchId::B2SateHunger => {
                if a.hunger < cfg.decision_critical_hunger && d.has_available_node(a, NodePool::Food) {
                    return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::SateHunger, target_state: PrimitiveActionState::SeekingFood });
                }
            }
            BranchId::B3Rest => {
                if a.stamina < cfg.decision_rest_stamina_target {
                    return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::Rest, target_state: PrimitiveActionState::RestingAtCamp });
                }
            }
            BranchId::B4RepairHouse => {
                if let Some(house) = home_house(d, a) {
                    let needs = house_stock_needs(house, cfg);
                    if needs.need_repair && is_house_member(house, a) {
                        return Some(Need { level: MaslowLevel::Safety, kind: NeedKind::RepairHouse, target_state: PrimitiveActionState::RepairingHouse });
                    }
                }
            }
            BranchId::B5StockWater => {
                if let Some(house) = home_house(d, a) {
                    if house_stock_needs(house, cfg).need_water && d.has_available_node(a, NodePool::Water) {
                        return Some(Need { level: family_level(a), kind: NeedKind::StockWater, target_state: PrimitiveActionState::SeekingWater });
                    }
                }
            }
            BranchId::B6StockFood => {
                if let Some(house) = home_house(d, a) {
                    if house_stock_needs(house, cfg).need_food && d.has_available_node(a, NodePool::Food) {
                        return Some(Need { level: family_level(a), kind: NeedKind::StockFood, target_state: PrimitiveActionState::SeekingFood });
                    }
                }
            }
            BranchId::B7StockWood => {
                if let Some(house) = home_house(d, a) {
                    if house_stock_needs(house, cfg).need_wood && d.has_available_node(a, NodePool::Wood) {
                        return Some(Need { level: family_level(a), kind: NeedKind::StockWood, target_state: PrimitiveActionState::SeekingWood });
                    }
                }
            }
            BranchId::B8BuildHouseTier0 => {
                if let Some(house) = home_house(d, a) {
                    if house.tier == HouseTier::Tier0Warehouse && house.is_pantry_full(cfg) && is_house_member(house, a) && is_male_adult(a, cfg) {
                        return Some(Need { level: MaslowLevel::Belonging, kind: NeedKind::BuildHouse, target_state: PrimitiveActionState::ConstructingHouse });
                    }
                }
            }
            BranchId::B9StockStone => {
                if let Some(house) = home_house(d, a) {
                    if house_stock_needs(house, cfg).need_stone && d.has_available_node(a, NodePool::Stone) {
                        return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::StockStone, target_state: PrimitiveActionState::SeekingStone });
                    }
                }
            }
            BranchId::B10StockGold => {
                if let Some(house) = home_house(d, a) {
                    if house_stock_needs(house, cfg).need_gold && d.has_available_node(a, NodePool::Gold) && a.gold_mining_cooldown <= 0.0 {
                        return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::StockGold, target_state: PrimitiveActionState::SeekingGold });
                    }
                }
            }
            BranchId::B11BuildHouseUpgrade => {
                if let Some(house) = home_house(d, a) {
                    if house.is_pantry_full(cfg) && house.tier != HouseTier::Tier4Manor && is_house_member(house, a) && is_male_adult(a, cfg) {
                        return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::BuildHouse, target_state: PrimitiveActionState::ConstructingHouse });
                    }
                }
            }
            BranchId::B12FoundHome => {
                // 无家判定 = home_house_id 为空，或其家宅已坍塌为废墟
                if home_house(d, a).is_none()
                    && is_male_adult(a, cfg)
                    && a.hunger >= cfg.decision_found_home_hunger_min
                    && a.thirst >= cfg.decision_found_home_thirst_min
                    && a.stamina >= cfg.decision_found_home_stamina_min
                {
                    return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::FoundHome, target_state: PrimitiveActionState::RestingAtCamp });
                }
            }
            BranchId::B13GoldWealth => {
                // 4 级大庄园「万事俱备」门禁内建：庄园竣工 + 无任何备料/修缮缺口 + 仓未满 + 有金源 + 冷却结束
                if let Some(house) = home_house(d, a) {
                    let needs = house_stock_needs(house, cfg);
                    let gated = house.tier != HouseTier::Tier4Manor
                        || needs.need_repair
                        || needs.need_wood
                        || needs.need_stone
                        || needs.need_gold
                        || needs.need_water
                        || needs.need_food
                        || house.is_pantry_full(cfg);
                    if !gated && d.has_available_node(a, NodePool::Gold) && a.gold_mining_cooldown <= 0.0 {
                        return Some(Need { level: MaslowLevel::SelfActualization, kind: NeedKind::GoldWealth, target_state: PrimitiveActionState::SeekingGold });
                    }
                }
            }
        }
        None
    }
}

/// 家宅查找（存活且非废墟）
fn home_house<'h>(d: &Decisioner<'h>, a: &Agent3D) -> Option<&'h House> {
    a.home_house_id.and_then(|hid| d.houses.iter().find(|h| h.id == hid && !h.is_ruin))
}

fn is_house_member(house: &House, a: &Agent3D) -> bool {
    house.owner_id == a.id || house.spouse_id == Some(a.id)
}

/// b5/b6/b7 的动态默认层级：有配偶或子女 → 归属层，否则 → 安全层
fn family_level(a: &Agent3D) -> MaslowLevel {
    if a.spouse_id.is_some() || !a.children_ids.is_empty() {
        MaslowLevel::Belonging
    } else {
        MaslowLevel::Safety
    }
}

fn is_male_adult(a: &Agent3D, cfg: &SimConfig) -> bool {
    a.gender == Gender::Male && a.age >= cfg.agent_adult_age
}

/// 解析注入的评估顺序：恰好 13 个互不重复的有效 ID 才采用，否则回退中性声明序。
/// 解析结果为定长数组，热路径零分配。
pub fn resolve_order(ids: &[String]) -> [BranchId; 13] {
    if ids.len() == 13 {
        let mut parsed = BranchId::ALL;
        let mut seen = [false; 13];
        for (i, s) in ids.iter().enumerate() {
            match BranchId::from_str_id(s) {
                Some(b) if !seen[b.index()] => {
                    seen[b.index()] = true;
                    parsed[i] = b;
                }
                _ => return BranchId::ALL,
            }
        }
        return parsed;
    }
    BranchId::ALL
}

/// 层级覆盖查询：decision_eval_levels 与 decision_eval_order 按下标并行（按分支 ID 查位），
/// 0 / 缺失 / 非法值 = 保留代码动态默认。评估结论与 current_need 标签共用本函数保证一致。
pub fn level_override_for(config: &SimConfig, branch: BranchId) -> Option<MaslowLevel> {
    let idx = config
        .decision_eval_order
        .iter()
        .position(|s| s == branch.str_id())?;
    config
        .decision_eval_levels
        .get(idx)
        .copied()
        .and_then(MaslowLevel::from_u8)
}
