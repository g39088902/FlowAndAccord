//! harvest.rs · 现场采收与榷场采购结算。
//!
//! 由 `tick.rs::tick_poi_interactions` 按 agent 状态分派，均为**纯物理结算**：
//! 只从 POI 储量扣减、装入随身行囊、扣减家户账本黄金，不派发新任务（根 AGENTS.md §4.11.1）。
//!
//! 契约（`spatial/AGENTS.md` §3.1）：每类资源独立行囊容量 `carryCapacityResource`；
//! 无家宅者不装袋，只就地自饮自食。

use super::super::agent::Agent3D;
use super::super::ledger::family::HouseholdRegistry;
use super::super::ledger::journal::{LedgerRef, ResourceKind, TransferReason, TransferRecord};
use super::super::poi::{
    market_unit_price, market_unit_price_with_base, MarketTradeRecord, PoiType, PrimitivePoi,
};
use crate::config::SimConfig;

/// 现场饮水：先补自身口渴，有家宅则同时装入随身水囊。
pub(super) fn harvest_water(
    agent: &mut Agent3D,
    pois: &mut [PrimitivePoi],
    config: &SimConfig,
    carry_cap: f32,
    rate_res: f32,
    dt: f32,
) {
    let agent_pos = agent.world_pos;
    let agent_hid = agent.home_house_id;
    if let Some(poi) = pois.iter_mut().find(|p| {
        p.poi_type == PoiType::WaterSource
            && p.pos.distance_to(&agent_pos) < config.poi_interaction_radius
    }) {
        let need = (config.agent_thirst_capacity - agent.thirst).max(0.0);
        if need > 0.01 {
            let extracted = poi.extract(need.min(rate_res * dt));
            agent.thirst = (agent.thirst + extracted).min(config.agent_thirst_capacity);
        }
        if agent_hid.is_some() && agent.carried_water < carry_cap && poi.current_stock > 0.01 {
            let load = (carry_cap - agent.carried_water).min(rate_res * dt);
            let extracted = poi.extract(load);
            agent.carried_water = (agent.carried_water + extracted).min(carry_cap);
            agent.cumulative_mined += extracted;
            agent.cumulative_mined_water += extracted;
        }
    }
}

/// 现场觅食：先补自身饥饿，有家宅则同时装入随身粮袋。
pub(super) fn harvest_food(
    agent: &mut Agent3D,
    pois: &mut [PrimitivePoi],
    config: &SimConfig,
    carry_cap: f32,
    rate_res: f32,
    dt: f32,
) {
    let agent_pos = agent.world_pos;
    let agent_hid = agent.home_house_id;
    if let Some(poi) = pois.iter_mut().find(|p| {
        p.poi_type == PoiType::BerryBush
            && p.pos.distance_to(&agent_pos) < config.poi_interaction_radius
    }) {
        let need = (config.agent_hunger_capacity - agent.hunger).max(0.0);
        if need > 0.01 {
            let extracted = poi.extract(need.min(rate_res * dt));
            agent.hunger = (agent.hunger + extracted).min(config.agent_hunger_capacity);
        }
        if agent_hid.is_some() && agent.carried_food < carry_cap && poi.current_stock > 0.01 {
            let load = (carry_cap - agent.carried_food).min(rate_res * dt);
            let extracted = poi.extract(load);
            agent.carried_food = (agent.carried_food + extracted).min(carry_cap);
            agent.cumulative_mined += extracted;
            agent.cumulative_mined_food += extracted;
        }
    }
}

/// 伐木装载（★ M19.4c 力量禀赋加成：高力量 +25% / 低力量 −15% 装载速率）。
pub(super) fn harvest_wood(
    agent: &mut Agent3D,
    pois: &mut [PrimitivePoi],
    config: &SimConfig,
    carry_cap: f32,
    rate_res: f32,
    dt: f32,
) {
    let agent_pos = agent.world_pos;
    let agent_hid = agent.home_house_id;
    if let Some(poi) = pois.iter_mut().find(|p| {
        p.poi_type == PoiType::WoodForest
            && p.pos.distance_to(&agent_pos) < config.poi_interaction_radius
    }) {
        if agent_hid.is_some() && agent.carried_wood < carry_cap && poi.current_stock > 0.01 {
            // ★ M19.4c 力量禀赋加成：高力量(>=110)装载速率+25%，低力量(<=90)惩罚-15%
            let rate_heavy = if agent.strength >= config.trait_high_threshold {
                rate_res * (1.0 + config.trait_strength_load_bonus)
            } else if agent.strength <= config.trait_low_threshold {
                rate_res * (1.0 - config.trait_strength_load_penalty)
            } else {
                rate_res
            };
            let load = (carry_cap - agent.carried_wood).min(rate_heavy * dt);
            let extracted = poi.extract(load);
            agent.carried_wood = (agent.carried_wood + extracted).min(carry_cap);
            agent.cumulative_mined += extracted;
            agent.cumulative_mined_wood += extracted;
        }
    }
}

/// 采石装载（★ M19.4c 力量禀赋加成：高力量 +25% / 低力量 −15% 装载速率）。
pub(super) fn harvest_stone(
    agent: &mut Agent3D,
    pois: &mut [PrimitivePoi],
    config: &SimConfig,
    carry_cap: f32,
    rate_res: f32,
    dt: f32,
) {
    let agent_pos = agent.world_pos;
    let agent_hid = agent.home_house_id;
    if let Some(poi) = pois.iter_mut().find(|p| {
        p.poi_type == PoiType::StoneQuarry
            && p.pos.distance_to(&agent_pos) < config.poi_interaction_radius
    }) {
        if agent_hid.is_some() && agent.carried_stone < carry_cap && poi.current_stock > 0.01 {
            // ★ M19.4c 力量禀赋加成：高力量(>=110)装载速率+25%，低力量(<=90)惩罚-15%
            let rate_heavy = if agent.strength >= config.trait_high_threshold {
                rate_res * (1.0 + config.trait_strength_load_bonus)
            } else if agent.strength <= config.trait_low_threshold {
                rate_res * (1.0 - config.trait_strength_load_penalty)
            } else {
                rate_res
            };
            let load = (carry_cap - agent.carried_stone).min(rate_heavy * dt);
            let extracted = poi.extract(load);
            agent.carried_stone = (agent.carried_stone + extracted).min(carry_cap);
            agent.cumulative_mined += extracted;
            agent.cumulative_mined_stone += extracted;
        }
    }
}

/// 淘金装载（黄金容量无限，无 `carryCapacityResource` 上限）。
pub(super) fn harvest_gold(
    agent: &mut Agent3D,
    pois: &mut [PrimitivePoi],
    config: &SimConfig,
    rate_gold: f32,
    dt: f32,
) {
    let agent_pos = agent.world_pos;
    if let Some(poi) = pois.iter_mut().find(|p| {
        p.poi_type == PoiType::GoldMine
            && p.pos.distance_to(&agent_pos) < config.poi_interaction_radius
    }) {
        if poi.current_stock > 0.01 {
            let extracted = poi.extract(rate_gold * dt);
            agent.carried_gold += extracted;
            agent.cumulative_mined += extracted;
            agent.cumulative_mined_gold += extracted;
        }
    }
}

/// 榷场互市结算：现场濒危自救（水/粮）→ 按家户需求装袋购入（水/粮/木）→ 家户黄金记账扣减。
///
/// 支付顺序：先扣家户账本黄金，不足部分由随身黄金（`agent.carried_gold`）协同补足，
/// 黄金最终流向 `LedgerRef::Void`（通缩闭环）。详见 `docs/current/16-market-pricing.md`。
pub(super) fn buy_at_market(
    agent: &mut Agent3D,
    pois: &mut [PrimitivePoi],
    household_registry: &mut HouseholdRegistry,
    config: &SimConfig,
    tick: u64,
    carry_cap: f32,
) {
    let agent_pos = agent.world_pos;
    let Some(hh_hid) = household_registry.household_of(agent.id) else {
        return;
    };
    if let Some(poi) = pois.iter_mut().find(|p| {
        p.poi_type == PoiType::Market
            && p.pos.distance_to(&agent_pos) < config.poi_interaction_radius
    }) {
        let step = config.market_settlement_step;
        let p_water = market_unit_price(poi.current_stock, poi.max_stock, config);
        let p_food = market_unit_price(poi.secondary_stock, poi.secondary_max_stock, config);
        let p_wood = market_unit_price_with_base(
            poi.tertiary_stock,
            poi.tertiary_max_stock,
            config.market_price_base_wood,
            config,
        );
        // ★ v1.28.0 榷场流水环形缓冲容量（复用账本流水容量，未新增超参）
        let market_trade_capacity = config.ledger_journal_capacity;

        let (hh_gold, hh_water, hh_food, hh_wood) = household_registry
            .get(hh_hid)
            .map(|hh| {
                (
                    hh.group.ledger.balance(ResourceKind::Gold),
                    hh.group.ledger.balance(ResourceKind::Water),
                    hh.group.ledger.balance(ResourceKind::Food),
                    hh.group.ledger.balance(ResourceKind::Wood),
                )
            })
            .unwrap_or((0.0, 0.0, 0.0, 0.0));
        let mut current_hh_gold = hh_gold;
        let mut current_carried_gold = agent.carried_gold;
        let mut total_hh_gold_paid = 0.0;

        // 步骤 A：现场濒危自救缓冲（thirst/hunger < 10.0 优先就地饮水/进食保命，固定以 step 为结算步长）
        let cost_water_rescue = step * p_water;
        if agent.thirst < 10.0
            && poi.current_stock >= step
            && (current_hh_gold + current_carried_gold) >= cost_water_rescue
        {
            let thirst_deficit = config.agent_thirst_capacity - agent.thirst;
            if thirst_deficit >= step {
                let buy_amount = step;
                let gold_cost = buy_amount * p_water;
                poi.extract(buy_amount);
                agent.thirst =
                    (agent.thirst + buy_amount).min(config.agent_thirst_capacity);
                let from_hh = current_hh_gold.min(gold_cost);
                current_hh_gold -= from_hh;
                total_hh_gold_paid += from_hh;
                let from_carried = gold_cost - from_hh;
                current_carried_gold = (current_carried_gold - from_carried).max(0.0);
                agent.carried_gold = current_carried_gold;
                // ★ v1.28.0 流水留痕（自救饮水）
                poi.push_market_trade(
                    MarketTradeRecord {
                        tick,
                        agent_id: agent.id,
                        household_id: Some(hh_hid),
                        resource: "Water".to_string(),
                        amount: buy_amount,
                        unit_price: p_water,
                        gold_cost,
                    },
                    market_trade_capacity,
                );
            }
        }
        let cost_food_rescue = step * p_food;
        if agent.hunger < 10.0
            && poi.secondary_stock >= step
            && (current_hh_gold + current_carried_gold) >= cost_food_rescue
        {
            let hunger_deficit = config.agent_hunger_capacity - agent.hunger;
            if hunger_deficit >= step {
                let buy_amount = step;
                let gold_cost = buy_amount * p_food;
                poi.extract_secondary(buy_amount);
                agent.hunger = (agent.hunger + buy_amount).min(config.agent_hunger_capacity);
                let from_hh = current_hh_gold.min(gold_cost);
                current_hh_gold -= from_hh;
                total_hh_gold_paid += from_hh;
                let from_carried = gold_cost - from_hh;
                current_carried_gold = (current_carried_gold - from_carried).max(0.0);
                agent.carried_gold = current_carried_gold;
                // ★ v1.28.0 流水留痕（自救进食）
                poi.push_market_trade(
                    MarketTradeRecord {
                        tick,
                        agent_id: agent.id,
                        household_id: Some(hh_hid),
                        resource: "Food".to_string(),
                        amount: buy_amount,
                        unit_price: p_food,
                        gold_cost,
                    },
                    market_trade_capacity,
                );
            }
        }

        // 步骤 B：装袋购入（固定以 step 为离散结算步长：行囊容量 / 市场库存 / 剩余家财+随身金 / 家户需求 多重约束）
        let d_th = config.market_emergency_family_stock_threshold;
        let water_needed = agent.family_stock_active[0] || hh_water < d_th;
        let food_needed = agent.family_stock_active[1] || hh_food < d_th;
        let wood_needed = agent.family_stock_active[2] || hh_wood < d_th;

        // 购水装袋
        let water_space = carry_cap - agent.carried_water;
        let cost_water = step * p_water;
        if water_needed
            && water_space >= step
            && poi.current_stock >= step
            && (current_hh_gold + current_carried_gold) >= cost_water
        {
            let buy_amount = step;
            let gold_cost = buy_amount * p_water;
            poi.extract(buy_amount);
            agent.carried_water = (agent.carried_water + buy_amount).min(carry_cap);
            let from_hh = current_hh_gold.min(gold_cost);
            current_hh_gold -= from_hh;
            total_hh_gold_paid += from_hh;
            let from_carried = gold_cost - from_hh;
            current_carried_gold = (current_carried_gold - from_carried).max(0.0);
            agent.carried_gold = current_carried_gold;
            // ★ v1.28.0 流水留痕（清水装袋）
            poi.push_market_trade(
                MarketTradeRecord {
                    tick,
                    agent_id: agent.id,
                    household_id: Some(hh_hid),
                    resource: "Water".to_string(),
                    amount: buy_amount,
                    unit_price: p_water,
                    gold_cost,
                },
                market_trade_capacity,
            );
        }
        // 购粮装袋
        let food_space = carry_cap - agent.carried_food;
        let cost_food = step * p_food;
        if food_needed
            && food_space >= step
            && poi.secondary_stock >= step
            && (current_hh_gold + current_carried_gold) >= cost_food
        {
            let buy_amount = step;
            let gold_cost = buy_amount * p_food;
            poi.extract_secondary(buy_amount);
            agent.carried_food = (agent.carried_food + buy_amount).min(carry_cap);
            let from_hh = current_hh_gold.min(gold_cost);
            current_hh_gold -= from_hh;
            total_hh_gold_paid += from_hh;
            let from_carried = gold_cost - from_hh;
            current_carried_gold = (current_carried_gold - from_carried).max(0.0);
            agent.carried_gold = current_carried_gold;
            // ★ v1.28.0 流水留痕（粮食装袋）
            poi.push_market_trade(
                MarketTradeRecord {
                    tick,
                    agent_id: agent.id,
                    household_id: Some(hh_hid),
                    resource: "Food".to_string(),
                    amount: buy_amount,
                    unit_price: p_food,
                    gold_cost,
                },
                market_trade_capacity,
            );
        }
        // 购木装袋
        let wood_space = carry_cap - agent.carried_wood;
        let cost_wood = step * p_wood;
        if wood_needed
            && wood_space >= step
            && poi.tertiary_stock >= step
            && (current_hh_gold + current_carried_gold) >= cost_wood
        {
            let buy_amount = step;
            let gold_cost = buy_amount * p_wood;
            poi.extract_tertiary(buy_amount);
            agent.carried_wood = (agent.carried_wood + buy_amount).min(carry_cap);
            let from_hh = current_hh_gold.min(gold_cost);
            current_hh_gold -= from_hh;
            total_hh_gold_paid += from_hh;
            let from_carried = gold_cost - from_hh;
            current_carried_gold = (current_carried_gold - from_carried).max(0.0);
            agent.carried_gold = current_carried_gold;
            let _ = (current_hh_gold, current_carried_gold);
            // ★ v1.36.0 流水留痕（木料装袋）
            poi.push_market_trade(
                MarketTradeRecord {
                    tick,
                    agent_id: agent.id,
                    household_id: Some(hh_hid),
                    resource: "Wood".to_string(),
                    amount: buy_amount,
                    unit_price: p_wood,
                    gold_cost,
                },
                market_trade_capacity,
            );
        }

        // 步骤 C：扣减家户黄金记账流水（Transfer to Void, Reason = Market）
        if total_hh_gold_paid > 0.001 {
            if let Some(hh) = household_registry.get_mut(hh_hid) {
                hh.group.ledger.debit(ResourceKind::Gold, total_hh_gold_paid);
                hh.group.ledger.push_transfer(TransferRecord {
                    tick,
                    from: LedgerRef::Family(hh_hid),
                    to: LedgerRef::Void,
                    resource: ResourceKind::Gold,
                    amount: total_hh_gold_paid,
                    reason: TransferReason::Market,
                });
            }
        }
    }
}
