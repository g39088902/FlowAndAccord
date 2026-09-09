//! home.rs · 回家卸货入账与在家吃喝。
//!
//! 由 `tick.rs::tick_poi_interactions` 在 `RestingAtCamp` 状态分派。
//!
//! ★ M6 终态：**家户账本 = 家庭物资唯一真相源**（房屋 `pantry_*` 已删除）。
//! 行囊按 `poiUnloadRateResource` 卸入家户账本（Deposit: Personal → Family）；
//! 吃喝从家户账本真实扣减（Consume: Family → Void）。
//! 只有拥有实体住宅的 agent 才能卸货入账，无房者不得"隔空入账"。

use super::super::agent::Agent3D;
use super::super::ledger::family::HouseholdRegistry;
use super::super::ledger::journal::{LedgerRef, ResourceKind, TransferReason, TransferRecord};
use crate::config::SimConfig;

/// 在宅休整：卸货入账（水/粮/木/石/金）+ 从家户账本吃喝。
pub(super) fn rest_at_camp(
    agent: &mut Agent3D,
    household_registry: &mut HouseholdRegistry,
    config: &SimConfig,
    tick: u64,
    unload_res: f32,
    unload_gold: f32,
    dt: f32,
) {
    // 房屋 pantry 已删除：无容量上限、无房屋等级/0 级门槛，凡有家户即享家庭储备。
    if agent.home_house_id.is_some() {
        if let Some(hh_hid) = household_registry.household_of(agent.id) {
            let deposit_rate = unload_res * dt;
            // —— 卸货入账：水 ——
            if agent.carried_water > 0.01 {
                let d = agent.carried_water.min(deposit_rate);
                agent.carried_water -= d;
                if d > 0.001 {
                    if let Some(hh) = household_registry.get_mut(hh_hid) {
                        hh.group.ledger.credit(ResourceKind::Water, d);
                        hh.group.ledger.push_transfer(TransferRecord {
                            tick,
                            from: LedgerRef::Personal(agent.id),
                            to: LedgerRef::Family(hh_hid),
                            resource: ResourceKind::Water,
                            amount: d,
                            reason: TransferReason::Deposit,
                        });
                    }
                }
            }
            // —— 卸货入账：粮 ——
            if agent.carried_food > 0.01 {
                let d = agent.carried_food.min(deposit_rate);
                agent.carried_food -= d;
                if d > 0.001 {
                    if let Some(hh) = household_registry.get_mut(hh_hid) {
                        hh.group.ledger.credit(ResourceKind::Food, d);
                        hh.group.ledger.push_transfer(TransferRecord {
                            tick,
                            from: LedgerRef::Personal(agent.id),
                            to: LedgerRef::Family(hh_hid),
                            resource: ResourceKind::Food,
                            amount: d,
                            reason: TransferReason::Deposit,
                        });
                    }
                }
            }
            // —— 卸货入账：木 ——
            if agent.carried_wood > 0.01 {
                let d = agent.carried_wood.min(deposit_rate);
                agent.carried_wood -= d;
                if d > 0.001 {
                    if let Some(hh) = household_registry.get_mut(hh_hid) {
                        hh.group.ledger.credit(ResourceKind::Wood, d);
                        hh.group.ledger.push_transfer(TransferRecord {
                            tick,
                            from: LedgerRef::Personal(agent.id),
                            to: LedgerRef::Family(hh_hid),
                            resource: ResourceKind::Wood,
                            amount: d,
                            reason: TransferReason::Deposit,
                        });
                    }
                }
            }
            // —— 卸货入账：石 ——
            if agent.carried_stone > 0.01 {
                let d = agent.carried_stone.min(deposit_rate);
                agent.carried_stone -= d;
                if d > 0.001 {
                    if let Some(hh) = household_registry.get_mut(hh_hid) {
                        hh.group.ledger.credit(ResourceKind::Stone, d);
                        hh.group.ledger.push_transfer(TransferRecord {
                            tick,
                            from: LedgerRef::Personal(agent.id),
                            to: LedgerRef::Family(hh_hid),
                            resource: ResourceKind::Stone,
                            amount: d,
                            reason: TransferReason::Deposit,
                        });
                    }
                }
            }
            // —— 卸货入账：金 ——
            if agent.carried_gold > 0.01 {
                let deposit = agent.carried_gold.min(unload_gold * dt);
                agent.carried_gold = (agent.carried_gold - deposit).max(0.0);
                if deposit > 0.001 {
                    if let Some(hh) = household_registry.get_mut(hh_hid) {
                        hh.group.ledger.credit(ResourceKind::Gold, deposit);
                        hh.group.ledger.push_transfer(TransferRecord {
                            tick,
                            from: LedgerRef::Personal(agent.id),
                            to: LedgerRef::Family(hh_hid),
                            resource: ResourceKind::Gold,
                            amount: deposit,
                            reason: TransferReason::Deposit,
                        });
                    }
                }
            }
            // —— 吃喝：从家户账本真实扣减 ——
            let ledger_water = household_registry
                .get(hh_hid)
                .map(|hh| hh.group.ledger.balance(ResourceKind::Water))
                .unwrap_or(0.0);
            if agent.thirst < config.agent_thirst_capacity && ledger_water > 0.05 {
                let drink_amount = (config.agent_thirst_capacity - agent.thirst)
                    .min(ledger_water)
                    .min(config.camp_home_consume_rate * dt);
                agent.thirst = (agent.thirst + drink_amount).min(config.agent_thirst_capacity);
                if drink_amount > 0.001 {
                    if let Some(hh) = household_registry.get_mut(hh_hid) {
                        hh.group.ledger.record_consumption(
                            LedgerRef::Family(hh_hid),
                            ResourceKind::Water,
                            drink_amount,
                            TransferReason::Consume,
                            tick,
                        );
                    }
                }
            }
            let ledger_food = household_registry
                .get(hh_hid)
                .map(|hh| hh.group.ledger.balance(ResourceKind::Food))
                .unwrap_or(0.0);
            if agent.hunger < config.agent_hunger_capacity && ledger_food > 0.05 {
                let eat_amount = (config.agent_hunger_capacity - agent.hunger)
                    .min(ledger_food)
                    .min(config.camp_home_consume_rate * dt);
                agent.hunger = (agent.hunger + eat_amount).min(config.agent_hunger_capacity);
                if eat_amount > 0.001 {
                    if let Some(hh) = household_registry.get_mut(hh_hid) {
                        hh.group.ledger.record_consumption(
                            LedgerRef::Family(hh_hid),
                            ResourceKind::Food,
                            eat_amount,
                            TransferReason::Consume,
                            tick,
                        );
                    }
                }
            }
        }
    }
}
