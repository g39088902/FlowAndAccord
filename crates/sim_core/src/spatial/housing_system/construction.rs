use crate::spatial::agent::PrimitiveActionState;
use crate::spatial::house::HouseTier;
use crate::spatial::decisions::needs::upgrade_material_cost;
use crate::spatial::ledger::journal::{LedgerRef, TransferReason};
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// ★ M6 房屋升级瞬时化（BuildHouse 决策自主触发，系统仅结算）：
    ///
    /// 决策命中 b8/b11 时 agent 进入 `ConstructingHouse`——该状态自 M6 起**仅作"待升级"标记**，
    /// 不再累计工时、不再消耗体力。本函数在房屋系统阶段扫描标记并**立即执行升级事务**：
    /// 1. 校验户主家户账本建材余额仍充足（家庭账本为唯一真相源）；
    /// 2. 一次性 `record_consumption(Construction)` 从家户账本扣除对应建材；
    /// 3. `house.upgrade_to_next_tier()` 瞬时晋升（无时间/体力）；
    /// 4. 恢复 RestingAtCamp 状态并播报。
    ///
    /// 事务与账本收付封装保持确定性：不消耗 WorldRng、按 agents Vec 顺序处理。
    pub(crate) fn tick_house_construction(&mut self) {
        // 收集"待升级"agent（保持 agents Vec 序；同一家户同 tick 至多处理一次）
        let pending: Vec<u32> = self
            .agents
            .iter()
            .filter(|a| a.is_alive && !a.is_fetus && a.state == PrimitiveActionState::ConstructingHouse)
            .map(|a| a.id)
            .collect();
        for agent_id in pending {
            let at_house = self.agents.iter().find(|a| a.id == agent_id)
                .and_then(|a| a.home_house_id)
                .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                .map(|h| {
                    let pos = self.network.graph[*self.network.node_map.get(&h.door_node_id).unwrap()].pos;
                    self.agents.iter().find(|a| a.id == agent_id)
                        .map(|a| a.current_lane_id.is_none() && a.world_pos.distance_to(&pos) <= self.config.poi_interaction_radius)
                        .unwrap_or(false)
                }).unwrap_or(false);
            if !at_house { continue; }
            self.try_instant_upgrade(agent_id);
        }
    }

    /// 单次瞬时升级事务：无论成败都先离开 ConstructingHouse（失败静默，待再次备料决策触发）
    fn try_instant_upgrade(&mut self, agent_id: u32) {
        if let Some(a) = self.agents.iter_mut().find(|a| a.id == agent_id) {
            a.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
            a.build_timer = 0.0;
            a.current_need = Some("Physiological·Rest".to_string());
        }

        let Some(house_id) = self.agents.iter().find(|a| a.id == agent_id).and_then(|a| a.home_house_id) else {
            return;
        };
        let Some(owner_hid) = self.household_registry.household_of(agent_id) else {
            return;
        };
        let Some(house) = self.houses.iter().find(|h| h.id == house_id) else {
            return;
        };
        let prev_tier = house.tier;
        if prev_tier == HouseTier::Tier4Manor {
            return;
        }

        let cfg = &self.config;
        // 本次升级需一次性扣除的建材（★ M7 与 b8/b11 就绪判定共用 needs::upgrade_material_cost，公式单一真相源）
        let costs = upgrade_material_cost(prev_tier, cfg);

        // 余额校验（不足则放弃本次升级，建材留给家庭生活/后续再触发）
        let ledger_ok = self
            .household_registry
            .get(owner_hid)
            .map(|hh| costs.iter().all(|(rk, amt)| hh.group.ledger.balance(*rk) >= *amt - 1e-3))
            .unwrap_or(false);
        if !ledger_ok {
            return;
        }

        let tick = self.tick_counter;
        // 1. 一次性扣账（Construction: Family → Void）
        for (rk, amt) in &costs {
            if *amt > 0.001 {
                if let Some(hh) = self.household_registry.get_mut(owner_hid) {
                    hh.group.ledger.record_consumption(LedgerRef::Family(owner_hid), *rk, *amt, TransferReason::Construction, tick);
                }
            }
        }

        // 2. 瞬时晋升（不再有施工计时；升级完成后镜像 max_pantry 随 upgrade_to_next_tier 同步扩容）
        let succeeded = self
            .houses
            .iter_mut()
            .find(|h| h.id == house_id)
            .map(|h| {
                // ★ 修建/升级者：记录本次主持升级的族人（立宅修建者见 builder_id，二者均不随继承改变）
                h.last_upgrader_id = Some(agent_id);
                h.upgrade_to_next_tier(cfg)
            })
            .unwrap_or(false);
        if !succeeded {
            return;
        }

        // ★ M6 威望·宅邸因子：房屋每晋升一级，户主威望 +1（最高 4 级宅邸累计 +4；纯立宅不计）
        let owner_id = self.houses.iter().find(|h| h.id == house_id).and_then(|h| h.owner_id);
        if let Some(oid) = owner_id {
            if let Some(owner) = self.agents.iter_mut().find(|a| a.id == oid) {
                owner.prestige = owner.prestige.saturating_add(1);
            }
        }

        // 3. 事件播报（★ M8 文案随固定成本矩阵：升级已从家户账本一次性扣除材料）
        let msg = match prev_tier {
            HouseTier::Tier0Warehouse => format!("🎉 0 级仓库消耗水/粮各 50 升级为 1 级茅草房！一次性竣工。"),
            HouseTier::Tier1ThatchedHut => format!("🏡 1 级茅草房消耗木/粮/水各 75 完成升级！第 #{} 号房屋瞬时晋升为 2 级私宅！", house_id),
            HouseTier::Tier2LeanTo => format!("🏯 2 级私宅消耗石/木/粮/水各 100 完成升级！第 #{} 号房屋瞬时晋升为 3 级木石庄舍！", house_id),
            HouseTier::Tier3Homestead => format!("🏰 3 级庄舍消耗金/石/木/粮/水各 125 完成升级！第 #{} 号房屋瞬时晋升为 4 级氏族大庄园！", house_id),
            HouseTier::Tier4Manor => unreachable!(),
        };
        self.last_event = Some(msg);
    }
}
