//! 需求判定分支注册表 (branches.rs)
//!
//! `evaluate_needs` 的 18 条分支抽为按稳定字符串 ID ("b1".."b18") 索引的自包含条件函数。
//! 本文件只描述「每条分支的语义」，**不持有任何策展优先级**：
//! 评估顺序的唯一真相源是前端持久化配置文件 `frontend/js/config.decision-order.js`，
//! 经 `SimConfig.decision_eval_order` 热注入；为空或非法时回退 `BranchId::ALL`
//! 中性声明序（b1→b18，仅兜底，不携带语义优先级）。
//!
//! 每条分支的条件函数自包含全部守卫（无家守卫 / b13 的 4 级庄园门禁 /
//! b5~b7 的 family_level 动态默认），因此任意排列都语义安全，无需框架特判。
//!
//! ★ v1.29.0 瞬间行为（⓪ 层）：`is_instant()` 白名单内的分支（b16 求偶近距 / b17 竞拍购房 /
//! b18 育儿在宅）可返回 `MaslowLevel::Instantaneous` 结论——命中即刻执行（只写决心，
//! 不移动、不消耗资源与 RNG）后继续遍历后续分支，见 `evaluate.rs::evaluate_instant_needs`。

use super::super::agent::{Agent3D, Gender, PrimitiveActionState};
use super::super::house::{House, HouseTier};
use super::super::ledger::journal::ResourceKind;
use super::evaluate::Decisioner;
use super::needs::*;
use crate::config::SimConfig;

/// 18 条需求判定分支的稳定标识（声明序即中性兜底序，不含语义优先级）
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
    B14SeekThrone,
    B15MarketTrade,
    B16Courtship,
    B17BidHouse,
    B18RaiseChild,
}

impl BranchId {
    /// 中性声明序（b1..b16）：仅作配置缺失/非法时的兜底遍历序，不携带语义优先级。
    /// 生产环境的策展优先级只存在于前端配置文件，严禁在此处写死。
    /// ★ M4 夺位远征 B14SeekThrone 声明在最前：第一层生存需求（生理层最高档），兜底序下亦优先于口渴/饥饿/休息。
    pub const ALL: [BranchId; 18] = [
        BranchId::B14SeekThrone,
        BranchId::B1QuenchThirst,
        BranchId::B2SateHunger,
        BranchId::B15MarketTrade,
        BranchId::B3Rest,
        BranchId::B17BidHouse,
        BranchId::B12FoundHome,
        BranchId::B4RepairHouse,
        BranchId::B5StockWater,
        BranchId::B6StockFood,
        BranchId::B7StockWood,
        BranchId::B16Courtship,
        BranchId::B8BuildHouseTier0,
        BranchId::B9StockStone,
        BranchId::B10StockGold,
        BranchId::B11BuildHouseUpgrade,
        BranchId::B13GoldWealth,
        BranchId::B18RaiseChild,
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
            BranchId::B14SeekThrone => "b14",
            BranchId::B15MarketTrade => "b15",
            BranchId::B16Courtship => "b16",
            BranchId::B17BidHouse => "b17",
            BranchId::B18RaiseChild => "b18",
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
            "b14" => BranchId::B14SeekThrone,
            "b15" => BranchId::B15MarketTrade,
            "b16" => BranchId::B16Courtship,
            "b17" => BranchId::B17BidHouse,
            "b18" => BranchId::B18RaiseChild,
            _ => return None,
        })
    }

    fn index(self) -> usize {
        self as usize
    }

    /// ★ v1.29.0 瞬发白名单：只有这些分支可能产出「⓪ 瞬间行为」结论（命中即执行并继续遍历）。
    /// 其余分支即使在决策引擎 UI 中被强制覆盖为 0 层，也由 `level_override_for` 钳制回代码默认层级，
    /// 避免把移动型分支（如 b1 解渴）变成「瞬发后继续遍历」而破坏语义。
    pub fn is_instant(self) -> bool {
        matches!(
            self,
            BranchId::B16Courtship | BranchId::B17BidHouse | BranchId::B18RaiseChild
        )
    }

    /// 自包含分支条件：命中返回 Need（level 为代码动态默认，可被 decision_eval_levels 覆盖）。
    /// 不消耗 RNG，可安全地以任意顺序调用。
    ///
    /// ★ M6 账本化：一切“家庭存量/备齐”判定读取【家户账本】余额（d.ledger_balance），
    /// 目标阈值由 needs::stock_goal / upgrade_ready 基于家宅等级基准计算；不再读取 house.pantry_*。
    pub fn evaluate(&self, d: &Decisioner, a: &Agent3D) -> Option<Need> {
        let cfg = d.config;
        // 家宅等级（有房且非废墟）→ 备料/升级阈值基准等级
        let home_tier = home_house(d, a).map(|h| h.tier);
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
                    let need_repair = house.durability < cfg.decision_house_repair_need_threshold;
                    if need_repair && is_house_member(house, a) {
                        return Some(Need { level: MaslowLevel::Safety, kind: NeedKind::RepairHouse, target_state: PrimitiveActionState::RepairingHouse });
                    }
                }
            }
            BranchId::B5StockWater => {
                // ★ M7 去采与房屋等级脱钩：有房（含 0 级，非废墟）且家庭库存触发器 ON（账本水 < 下限）
                if home_tier.is_some() && family_stock_on(a, ResourceKind::Water) && d.has_available_node(a, NodePool::Water) {
                    return Some(Need { level: family_level(a), kind: NeedKind::StockWater, target_state: PrimitiveActionState::SeekingWater });
                }
            }
            BranchId::B6StockFood => {
                if home_tier.is_some() && family_stock_on(a, ResourceKind::Food) && d.has_available_node(a, NodePool::Food) {
                    return Some(Need { level: family_level(a), kind: NeedKind::StockFood, target_state: PrimitiveActionState::SeekingFood });
                }
            }
            BranchId::B7StockWood => {
                if home_tier.is_some() && family_stock_on(a, ResourceKind::Wood) && d.has_available_node(a, NodePool::Wood) {
                    return Some(Need { level: family_level(a), kind: NeedKind::StockWood, target_state: PrimitiveActionState::SeekingWood });
                }
            }
            BranchId::B8BuildHouseTier0 => {
                // ★ M7 升级就绪 = 家庭账本余额覆盖该级一次性材料成本（0→1 无材料 → 恒就绪）
                if let Some(house) = home_house(d, a) {
                    if house.tier == HouseTier::Tier0Warehouse && upgrade_ready_by_cost(house.tier, cfg, |k| d.ledger_balance(a, k)) && is_house_member(house, a) && is_male_adult(a, cfg) {
                        return Some(Need { level: MaslowLevel::Belonging, kind: NeedKind::BuildHouse, target_state: PrimitiveActionState::ConstructingHouse });
                    }
                }
            }
            BranchId::B9StockStone => {
                // ★ M7 石料也因家庭储备不足而采（不再按房屋等级“升级建材”导向）
                if home_tier.is_some() && family_stock_on(a, ResourceKind::Stone) && d.has_available_node(a, NodePool::Stone) {
                    return Some(Need { level: family_level(a), kind: NeedKind::StockStone, target_state: PrimitiveActionState::SeekingStone });
                }
            }
            BranchId::B10StockGold => {
                // ★ M7 黄金也因家庭储备不足而采（保留淘金冷却节流）
                if home_tier.is_some() && family_stock_on(a, ResourceKind::Gold) && d.has_available_node(a, NodePool::Gold) && a.gold_mining_cooldown <= 0.0 {
                    return Some(Need { level: family_level(a), kind: NeedKind::StockGold, target_state: PrimitiveActionState::SeekingGold });
                }
            }
            BranchId::B11BuildHouseUpgrade => {
                // ★ M7 升级就绪 = 家庭账本余额覆盖该级一次性材料成本（与 construction 共用公式）
                if let Some(house) = home_house(d, a) {
                    if upgrade_ready_by_cost(house.tier, cfg, |k| d.ledger_balance(a, k)) && house.tier != HouseTier::Tier4Manor && is_house_member(house, a) && is_male_adult(a, cfg) {
                        return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::BuildHouse, target_state: PrimitiveActionState::ConstructingHouse });
                    }
                }
            }
            BranchId::B12FoundHome => {
                // 无家判定 = home_house_id 为空（v1.10.0 起无绝嗣废墟状态）
                // ★ v1.10.0 营地容量预检：至少存在一个未满（< camp_max_houses）的营地才允许立宅
                if home_house(d, a).is_none()
                    && is_male_adult(a, cfg)
                    && a.hunger >= cfg.decision_found_home_hunger_min
                    && a.thirst >= cfg.decision_found_home_thirst_min
                    && a.stamina >= cfg.decision_found_home_stamina_min
                    && d.has_nonfull_camp()
                {
                    return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::FoundHome, target_state: PrimitiveActionState::RestingAtCamp });
                }
            }
            BranchId::B13GoldWealth => {
                // 4 级大庄园「万事俱备」门禁（M7 再锚）：庄园竣工 + 家户五类储备 trigger 全 OFF（余额均 ≥200）
                // + 无修缮缺口 + 有金源 + 冷却结束
                if let Some(house) = home_house(d, a) {
                    let need_repair = house.durability < cfg.decision_house_repair_need_threshold;
                    let all_stocked = FAMILY_STOCK_ORDER.iter().all(|&rk| !family_stock_on(a, rk));
                    let gated = house.tier != HouseTier::Tier4Manor || need_repair || !all_stocked;
                    if !gated && d.has_available_node(a, NodePool::Gold) && a.gold_mining_cooldown <= 0.0 {
                        return Some(Need { level: MaslowLevel::SelfActualization, kind: NeedKind::GoldWealth, target_state: PrimitiveActionState::SeekingGold });
                    }
                }
            }
            BranchId::B14SeekThrone => {
                // ★ M4 夺位远征：第一层生存需求（生理层最高档）——看结果不看开头：王位 = 资源的分配权，夺位为获取资源分配权而自主出征
                // 守卫（全部内联，任意排列语义安全）：在世男性成年、非现任国王
                if !a.is_alive || a.gender != Gender::Male || a.age < cfg.agent_adult_age {
                    return None;
                }
                if d.is_king(a) {
                    return None;
                }
                // ★ M6 前提：空缺王位的营地 = 自家房屋（含 0 级仓库）所在地；或完全未建房未建仓
                let home_camp_id = a.home_house_id
                    .and_then(|hid| d.houses.iter().find(|h| h.id == hid))
                    .map(|h| h.camp_id);
                if d.eligible_leaderless_camp(a, home_camp_id.is_some(), home_camp_id).is_some() {
                    return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::SeekThrone, target_state: PrimitiveActionState::SeekingThrone });
                }
            }
            BranchId::B15MarketTrade => {
                return d.evaluate_market_trade(a);
            }
            BranchId::B16Courtship => {
                // ★ 求偶：由马斯洛引擎驱动（第三层：归属与爱）
                // 守卫（自包含）：仅在世成年单身男性发起，女性不执行求偶
                if !a.is_alive || a.gender != Gender::Male || a.is_fetus || a.age < cfg.agent_adult_age || a.spouse_id.is_some() {
                    return None;
                }
                // 幂等守卫：已有未结算的求偶决心（世界执行器尚未落地）→ 本拍不再重复写
                if a.courtship_pending.is_some() {
                    return None;
                }
                // 需存在至少一名合格单身女性且家户金币达标
                if d.ledger_balance(a, ResourceKind::Gold) <= cfg.decision_courtship_min_family_gold {
                    return None;
                }
                let Some(target) = d.best_courtship_target(a) else {
                    return None;
                };
                // ★ v1.29.0 瞬发变体：目标已在交互半径内 → ⓪ 瞬间行为，只写决心、不迈步
                if a.world_pos.distance_to(&target.pos) <= cfg.poi_interaction_radius {
                    return Some(Need {
                        level: MaslowLevel::Instantaneous,
                        kind: NeedKind::Courtship,
                        target_state: PrimitiveActionState::RestingAtCamp, // 占位：瞬发只写 pending，不改运动状态
                    });
                }
                return Some(Need {
                    level: MaslowLevel::Belonging,
                    kind: NeedKind::Courtship,
                    target_state: PrimitiveActionState::SeekingCourtship,
                });
            }
            BranchId::B17BidHouse => {
                // ★ v1.26.0 竞购现房：成年男性自主对最优在售空置房屋出价
                // ★ v1.29.0 放宽进入条件：无房 或 有比自己家等级更高的房在售 均可参与（见 best_bid_candidate）
                // 守卫全内联（任意排列语义安全）：在世 + 非胎儿 + 成年男性 + 无未结算 pending + 冷却结束 + 有金 + 有在售房
                if !a.is_alive || a.gender != Gender::Male || a.is_fetus || a.age < cfg.agent_adult_age {
                    return None;
                }
                if a.pending_bid_house_id.is_some() {
                    return None;
                }
                let cooldown_ok = a
                    .last_bid_tick
                    .map(|t| d.tick >= t && d.tick - t >= cfg.house_auction_bid_cooldown_ticks)
                    .unwrap_or(true);
                if !cooldown_ok {
                    return None;
                }
                if best_bid_candidate(d, a).is_none() {
                    return None;
                }
                // ★ v1.29.0 竞拍购房归入 ⓪ 瞬间行为：只写 pending，不移动、不扣账
                return Some(Need {
                    level: MaslowLevel::Instantaneous,
                    kind: NeedKind::BidHouse,
                    target_state: PrimitiveActionState::RestingAtCamp, // 占位：落地阶段只写 pending，不改运动状态
                });
            }
            BranchId::B18RaiseChild => {
                if a.is_alive && !a.is_fetus && a.gender == Gender::Male
                    && a.age >= cfg.agent_adult_age
                    && a.spouse_id.map(|sid| d.ctx.conception_ready_wives.iter().any(|w| w.id == sid)).unwrap_or(false)
                    // ★ v1.28.0 住宅门槛：男方（户主）名下须有 ≥1 级私宅，0 级仓库不再生育
                    && d.houses.iter().any(|h| h.owner_id == Some(a.id) && h.tier != HouseTier::Tier0Warehouse)
                {
                    // 幂等守卫：已有未结算的养育决心 → 本拍不再重复写
                    if a.raise_child_pending {
                        return None;
                    }
                    // ★ v1.29.0 瞬发变体：夫妻已在自家宅门口 → ⓪ 瞬间行为，只写决心、不再派发返家
                    if couple_at_home_door(d, a) {
                        return Some(Need {
                            level: MaslowLevel::Instantaneous,
                            kind: NeedKind::RaiseChild,
                            target_state: PrimitiveActionState::RestingAtCamp, // 占位：瞬发只写 pending，不改运动状态
                        });
                    }
                    return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::RaiseChild, target_state: PrimitiveActionState::RaiseChild });
                }
            }
        }
        None
    }
}

/// 家宅查找（存活房屋；v1.10.0 起无绝嗣废墟状态）
fn home_house<'h>(d: &Decisioner<'h>, a: &Agent3D) -> Option<&'h House> {
    a.home_house_id.and_then(|hid| d.houses.iter().find(|h| h.id == hid))
}

fn is_house_member(house: &House, a: &Agent3D) -> bool {
    house.owner_id == Some(a.id) || house.spouse_id == Some(a.id)
}

/// ★ v1.29.0 竞拍最优目标：等级降序、ID 升序（确定性、**零分配**、不耗 RNG）。
/// 分支守卫与 `fulfill_resting_need::write_bid_pending` 共用同一判据，杜绝两处公式漂移。
/// 进入条件（★ v1.29.0 放宽）：**无房** 或 **有比自己家等级更高的房在售** 均可参与——
/// - 无房者：可竞拍任意在售空置房（含 0 级仓库，起拍价抬到 `house_auction_min_bid_gold` 兜底）；
/// - 有房者：仅改善型换房，只竞拍 `tier > 自家等级` 的更高等级房。
/// 返回 `(房屋 ID, 折算金价)`。
pub fn best_bid_candidate(d: &Decisioner, a: &Agent3D) -> Option<(u32, f32)> {
    let cfg = d.config;
    let own_tier = a
        .home_house_id
        .and_then(|hid| d.houses.iter().find(|h| h.id == hid))
        .map(|h| h.tier)
        .unwrap_or(HouseTier::Tier0Warehouse);
    let gold = d.ledger_balance(a, ResourceKind::Gold);
    let mut best: Option<(u32, f32, u8)> = None; // (house_id, price, tier)
    for h in d.houses.iter() {
        if h.owner_id.is_some() || h.auction_state.is_none() {
            continue; // 仅无主且在售的空置房
        }
        // 连续随机报价：有房者也可以对任意在售房屋表达意向，
        // 不再把“改善型换房”当作资格门槛；是否接受由报价时点规则决定。
        let mut price = house_upgrade_cost_price(own_tier, h.tier, cfg);
        if a.home_house_id.is_none() {
            // ★ v1.29.0 放宽：无房者竞拍 0 级仓库时折算价为 0，抬到起拍底价，保证「无房即可参与」
            price = price.max(cfg.house_auction_min_bid_gold);
        }
        if price < cfg.house_auction_min_bid_gold || gold < cfg.house_auction_min_bid_gold {
            continue;
        }
        let tier = h.tier as u8;
        let is_better = match best {
            None => true,
            Some((best_id, _, best_tier)) => tier > best_tier || (tier == best_tier && h.id < best_id),
        };
        if is_better {
            best = Some((h.id, price, tier));
        }
    }
    // 连续报价允许“尽力报价”：报价能力不足以覆盖折算价时仍产生一笔
    // 不可撤回的随机报价，由当前时点的接受规则决定是否受理。
    best.map(|(id, price, _)| (id, price.min(gold).max(cfg.house_auction_min_bid_gold)))
}

/// ★ v1.29.0 夫妻是否同在自家宅门口（判据与 `world_tick.rs::execute_pending_childcare`
/// 的 `at_home` 完全一致：双方静止且都在门节点 `poi_interaction_radius` 内）。
/// 成立时「养育小孩」走瞬发链路，只写决心、不再派发返家。
fn couple_at_home_door(d: &Decisioner, a: &Agent3D) -> bool {
    let Some(wife_id) = a.spouse_id else {
        return false;
    };
    // 男方须静止（不在任何车道上）
    if a.current_lane_id.is_some() {
        return false;
    }
    let Some(house) = d.houses.iter().find(|h| h.owner_id == Some(a.id)) else {
        return false;
    };
    let door_pos = d
        .network
        .node_map
        .get(&house.door_node_id)
        .and_then(|idx| d.network.graph.node_weight(*idx))
        .map(|n| n.pos);
    let Some(door_pos) = door_pos else {
        return false;
    };
    let radius = d.config.poi_interaction_radius;
    if a.world_pos.distance_to(&door_pos) > radius {
        return false;
    }
    d.ctx
        .conception_ready_wives
        .iter()
        .any(|w| w.id == wife_id && w.stationary && w.pos.distance_to(&door_pos) <= radius)
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

/// 解析注入的评估顺序：恰好 16 个互不重复的有效 ID 才采用，否则回退中性声明序。
/// 解析结果为定长数组，热路径零分配。
pub fn resolve_order(ids: &[String]) -> [BranchId; 18] {
    if ids.len() == 18 {
        let mut parsed = BranchId::ALL;
        let mut seen = [false; 18];
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

/// 层级覆盖查询：decision_eval_levels 与 decision_eval_order 按下标并行（按分支 ID 查位）。
/// 编码：0=⓪瞬间行为 / 1-5=①…⑤马斯洛层级 / 6、缺失、非法值 = 保留代码动态默认。
/// ★ v1.29.0 钳制：非瞬发分支（`is_instant()` 为 false）被强制写成 0 时忽略该覆盖，
/// 保留代码动态默认——否则玩家在 UI 里把移动型分支拖进瞬间层会破坏语义。
/// 评估结论与 current_need 标签共用本函数保证一致。
pub fn level_override_for(config: &SimConfig, branch: BranchId) -> Option<MaslowLevel> {
    let idx = config
        .decision_eval_order
        .iter()
        .position(|s| s == branch.str_id())?;
    let lv = config
        .decision_eval_levels
        .get(idx)
        .copied()
        .and_then(MaslowLevel::from_u8)?;
    if lv == MaslowLevel::Instantaneous && !branch.is_instant() {
        return None;
    }
    Some(lv)
}
