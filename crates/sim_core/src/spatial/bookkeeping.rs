//! bookkeeping.rs · M2 旁路记账与家户经济规则（tick_bookkeeping 总入口）
//!
//! 隶属「账本与仓库重构」计划 M2。核心原则：
//! - **旁路观测**：只读物理事件（行囊变化/休息状态/季节温度），只追加账本流水，
//!   不修改任何物理库存字段（pantry_*/carried_*），与物理层完全解耦。
//! - **确定性**：不消耗 WorldRng；所有集合遍历按 id 保序；不新增决策相位。
//! - **执行顺序**：Deposit/Consume/Heating（观测）→ Inheritance（户主死亡清算）→ Split（成年/丧父分家）。
//!   Inheritance 先于 Split：丧父之子由继承直接立户，Split 幂等跳过已立户者。

use crate::spatial::agent::{AgentId, Gender, PrimitiveActionState};
use crate::spatial::house::HouseTier;
use crate::spatial::ledger::family::HouseholdId;
use crate::spatial::ledger::journal::{
    LedgerRef, ResourceKind, TransferReason, TransferRecord,
};
use crate::spatial::snapshot::Season;
use crate::spatial::world::World3DEngine;

/// 五类资源的固定顺序（保证遍历确定性）
const RESOURCE_ORDER: [ResourceKind; 5] = [
    ResourceKind::Water,
    ResourceKind::Food,
    ResourceKind::Wood,
    ResourceKind::Stone,
    ResourceKind::Gold,
];

impl World3DEngine {
    /// M2 旁路记账总入口：只读观测物理事件并追加账本流水。
    /// 在 tick() 尾段（错峰决策之后）调用，作为 tick 的最后一步。
    pub fn tick_bookkeeping(&mut self, dt: f32) {
        let tick = self.tick_counter;

        // ══════════════════════════════════════════════════════════
        // READ PHASE：收集所有观测数据（不可变借用，无修改）
        // ══════════════════════════════════════════════════════════

        // ── 1. 行囊快照 + Deposit 检测 ──
        let mut deposits: Vec<(AgentId, HouseholdId, ResourceKind, f32)> = Vec::new();
        let mut current_carried: Vec<(AgentId, (f32, f32, f32, f32, f32))> = Vec::new();

        for agent in &self.agents {
            if !agent.is_alive {
                continue;
            }
            let cur = (
                agent.carried_water,
                agent.carried_food,
                agent.carried_wood,
                agent.carried_stone,
                agent.carried_gold,
            );
            current_carried.push((agent.id, cur));

            // Deposit：RestingAtCamp + 有 home_house_id + 某类行囊较上 tick 减少 > 0.01
            if agent.state == PrimitiveActionState::RestingAtCamp && agent.home_house_id.is_some() {
                if let Some(prev) = self.prev_carried.get(&agent.id) {
                    if let Some(hid) = self.household_registry.household_of(agent.id) {
                        let diffs = [
                            prev.0 - cur.0,
                            prev.1 - cur.1,
                            prev.2 - cur.2,
                            prev.3 - cur.3,
                            prev.4 - cur.4,
                        ];
                        for (r, d) in RESOURCE_ORDER.iter().zip(diffs.iter()) {
                            if *d > 0.01 {
                                deposits.push((agent.id, hid, *r, *d));
                            }
                        }
                    }
                }
            }
        }

        // ── 2. Consume 检测：RestingAtCamp + 有 home_house_id + 非0级房屋 ──
        let mut consumes: Vec<(HouseholdId, f32, f32)> = Vec::new();
        let consume_rate = self.config.camp_home_consume_rate * dt;
        for agent in &self.agents {
            if !agent.is_alive {
                continue;
            }
            if agent.state != PrimitiveActionState::RestingAtCamp {
                continue;
            }
            let Some(house_id) = agent.home_house_id else {
                continue;
            };
            // 0级仓库不扣生活水粮（AGENTS.md §4.8）
            let is_tier0 = self
                .houses
                .iter()
                .any(|h| h.id == house_id && h.tier == HouseTier::Tier0Warehouse);
            if is_tier0 {
                continue;
            }
            if let Some(hid) = self.household_registry.household_of(agent.id) {
                consumes.push((hid, consume_rate, consume_rate));
            }
        }

        // ── 3. Heating 检测：冬季/低温 + 户主有非0级房屋 ──
        let mut heatings: Vec<HouseholdId> = Vec::new();
        if self.current_season == Season::Winter || self.temperature < self.config.house_winter_cold_temp {
            for (hid, hh) in &self.household_registry.households {
                if hh.is_dissolved {
                    continue;
                }
                // 查户主是否有非0级房屋（用 agent_index O(1) 查找）
                if let Some(head_idx) = self.agent_index.get(&hh.head) {
                    if let Some(head_agent) = self.agents.get(*head_idx) {
                        if let Some(house_id) = head_agent.home_house_id {
                            if let Some(house) = self.houses.iter().find(|h| h.id == house_id) {
                                if house.tier != HouseTier::Tier0Warehouse {
                                    heatings.push(*hid);
                                }
                            }
                        }
                    }
                }
            }
        }

        // ══════════════════════════════════════════════════════════
        // WRITE PHASE：修改账本（prev_carried / household ledgers）
        // ══════════════════════════════════════════════════════════

        // 更新 prev_carried 缓存
        for (id, cur) in &current_carried {
            self.prev_carried.insert(*id, *cur);
        }

        // 处理 Deposit：Personal(agent) → Family(household)，credit 家户账本
        for (agent_id, hid, resource, amount) in deposits {
            if let Some(hh) = self.household_registry.get_mut(hid) {
                hh.group.ledger.credit(resource, amount);
                let record = TransferRecord {
                    tick,
                    from: LedgerRef::Personal(agent_id),
                    to: LedgerRef::Family(hid),
                    resource,
                    amount,
                    reason: TransferReason::Deposit,
                };
                hh.group.ledger.push_transfer(record);
            }
        }

        // 处理 Consume：Family → Void（record_consumption 单边 debit + 流水）
        for (hid, water_amt, food_amt) in consumes {
            if let Some(hh) = self.household_registry.get_mut(hid) {
                hh.group.ledger.record_consumption(
                    LedgerRef::Family(hid),
                    ResourceKind::Water,
                    water_amt,
                    TransferReason::Consume,
                    tick,
                );
                hh.group.ledger.record_consumption(
                    LedgerRef::Family(hid),
                    ResourceKind::Food,
                    food_amt,
                    TransferReason::Consume,
                    tick,
                );
            }
        }

        // 处理 Heating：Family → Void（冬季烧柴）
        let wood_rate = self.config.house_winter_wood_burn_rate * dt;
        for hid in heatings {
            if let Some(hh) = self.household_registry.get_mut(hid) {
                hh.group.ledger.record_consumption(
                    LedgerRef::Family(hid),
                    ResourceKind::Wood,
                    wood_rate,
                    TransferReason::Heating,
                    tick,
                );
            }
        }

        // ── 4. Inheritance（户主死亡清算）先于 Split ──
        self.tick_inheritance(tick);

        // ── 5. Split（成年/丧父分家抽资）──
        self.tick_household_split(tick);
    }

    // ══════════════════════════════════════════════════════════════
    // Inheritance：户主死亡 → 资源平分在世子一代 / 绝嗣入公仓 → 解散家户
    // ══════════════════════════════════════════════════════════════

    fn tick_inheritance(&mut self, tick: u64) {
        // READ PHASE：收集待清算家户（户主已死亡）
        let mut pending: Vec<(HouseholdId, Vec<(ResourceKind, f32)>, Vec<AgentId>)> = Vec::new();

        for (hid, hh) in &self.household_registry.households {
            if hh.is_dissolved {
                continue;
            }
            // 户主是否已死亡（agent_index O(1) 查找；找不到视为死亡）
            let head_dead = self
                .agent_index
                .get(&hh.head)
                .and_then(|idx| self.agents.get(*idx))
                .map(|a| !a.is_alive)
                .unwrap_or(true);
            if !head_dead {
                continue;
            }

            // 收集户主的在世子一代（children_ids 中 is_alive=true，不含配偶/母亲）
            let mut living_children: Vec<AgentId> = Vec::new();
            if let Some(head_idx) = self.agent_index.get(&hh.head) {
                if let Some(head_agent) = self.agents.get(*head_idx) {
                    for cid in &head_agent.children_ids {
                        if let Some(cidx) = self.agent_index.get(cid) {
                            if let Some(child) = self.agents.get(*cidx) {
                                if child.is_alive {
                                    living_children.push(*cid);
                                }
                            }
                        }
                    }
                }
            }

            // 收集账面余额（仅 > 0.001 的品类）
            let balances: Vec<(ResourceKind, f32)> = RESOURCE_ORDER
                .iter()
                .map(|&rk| (rk, hh.group.ledger.balance(rk)))
                .filter(|(_, amt)| *amt > 0.001)
                .collect();

            pending.push((*hid, balances, living_children));
        }

        // WRITE PHASE：执行继承分配
        for (hid, balances, living_children) in pending {
            if !living_children.is_empty() {
                // 有在世子一代：资源平分
                let n = living_children.len() as f32;
                for child_id in &living_children {
                    // 确定子女的目标家户：已有自己家户则直接转入，否则立户
                    let target_hid = if let Some(chid) = self.household_registry.household_of(*child_id) {
                        if let Some(chh) = self.household_registry.get(chid) {
                            if chh.head == *child_id {
                                Some(chid)
                            } else {
                                None // 子女仍在父亲家户中，需立新户
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    let target_hid = match target_hid {
                        Some(h) => h,
                        None => self.household_registry.create(*child_id, Some(hid), tick),
                    };

                    // 按品类转入继承份额
                    for (resource, total_amt) in &balances {
                        let share = total_amt / n;
                        if share > 0.001 {
                            self.transfer_household_resource(hid, target_hid, *resource, share, TransferReason::Inheritance, tick);
                        }
                    }
                }
            } else {
                // 绝嗣：全部资源转入公仓兜底账本
                for (resource, amount) in &balances {
                    if *amount > 0.001 {
                        // Debit 旧家户
                        if let Some(old_hh) = self.household_registry.get_mut(hid) {
                            old_hh.group.ledger.debit(*resource, *amount);
                            let record = TransferRecord {
                                tick,
                                from: LedgerRef::Family(hid),
                                to: LedgerRef::PublicGranary,
                                resource: *resource,
                                amount: *amount,
                                reason: TransferReason::Inheritance,
                            };
                            old_hh.group.ledger.push_transfer(record.clone());
                        }
                        // Credit 公仓
                        self.public_granary.credit(*resource, *amount);
                        let record = TransferRecord {
                            tick,
                            from: LedgerRef::Family(hid),
                            to: LedgerRef::PublicGranary,
                            resource: *resource,
                            amount: *amount,
                            reason: TransferReason::Inheritance,
                        };
                        self.public_granary.push_transfer(record);
                    }
                }
            }

            // 清算后解散家户（流水只读归档）
            self.household_registry.dissolve(hid, tick);
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Split：男子成年（父在世 W=2+n）或丧父（父亡 W=n）→ 从父亲家户分走 1/W 资源 → 立新户
    // ══════════════════════════════════════════════════════════════

    fn tick_household_split(&mut self, tick: u64) {
        // READ PHASE：收集分家候选人 + 预先计算分割金额（基于原始余额，避免同 tick 多子分割不均）
        struct SplitCandidate {
            old_hid: HouseholdId,
            new_hid: HouseholdId,
            amounts: Vec<(ResourceKind, f32)>,
            spouse_id: Option<AgentId>,
            children_ids: Vec<AgentId>,
        }

        let mut candidates: Vec<SplitCandidate> = Vec::new();

        for agent in &self.agents {
            if !agent.is_alive || agent.gender != Gender::Male || agent.is_fetus {
                continue;
            }

            // 幂等：已是自己家户户主的男人不再分家
            if let Some(hid) = self.household_registry.household_of(agent.id) {
                if let Some(hh) = self.household_registry.get(hid) {
                    if hh.head == agent.id {
                        continue;
                    }
                }
            } else {
                continue; // 无家户归属（始祖已在初始化时立户，不应到此）
            }

            // 条件A：成年；条件B：父亲已死亡（无论是否成年）
            let is_adult = agent.age >= self.config.agent_adult_age;
            let father_dead = match agent.father_id {
                Some(fid) => self
                    .agent_index
                    .get(&fid)
                    .and_then(|idx| self.agents.get(*idx))
                    .map(|a| !a.is_alive)
                    .unwrap_or(true),
                None => false, // 始祖（father_id=None）已在初始化时立户，不会到此
            };

            if !is_adult && !father_dead {
                continue;
            }

            let Some(old_hid) = self.household_registry.household_of(agent.id) else {
                continue;
            };

            // 计算子一代数量 n：父亲 children_ids 长度
            // ★ M1.7 受孕即建胎儿 agent 并加入父亲 children_ids，故不再单独 +1（否则重复计数）
            let mut n_children = 0usize;
            if let Some(father_head) = self.household_registry.get(old_hid).map(|h| h.head) {
                if let Some(fidx) = self.agent_index.get(&father_head) {
                    if let Some(father) = self.agents.get(*fidx) {
                        n_children = father.children_ids.len();
                    }
                }
            }

            // 父权重仅在父亲在世时计入：成年分家 → W = 2(父) + n(子一代，含胎儿)；
            // 丧父分家 → 亡父不占权重，W = n，资源在子一代间平分（与继承清算语义一致）。
            let father_alive = !father_dead;
            let weight_total = n_children as f32 + if father_alive { 2.0 } else { 0.0 };
            let split_ratio = 1.0 / weight_total;

            // 预先计算各品类分割金额（基于当前原始余额）
            let amounts: Vec<(ResourceKind, f32)> = RESOURCE_ORDER
                .iter()
                .filter_map(|&rk| {
                    let bal = self
                        .household_registry
                        .get(old_hid)
                        .map(|h| h.group.ledger.balance(rk))
                        .unwrap_or(0.0);
                    let amt = bal * split_ratio;
                    if amt > 0.001 {
                        Some((rk, amt))
                    } else {
                        None
                    }
                })
                .collect();

            // 预先创建新家户（create 内部已处理 by_agent 归属与幂等）
            let new_hid = self.household_registry.create(agent.id, Some(old_hid), tick);

            candidates.push(SplitCandidate {
                old_hid,
                new_hid,
                amounts,
                spouse_id: agent.spouse_id,
                children_ids: agent.children_ids.clone(),
            });
        }

        // WRITE PHASE：执行资源转移 + 成员迁移
        for c in candidates {
            // 资源从旧家户转到新家户（Split 流水）
            for (resource, amount) in c.amounts {
                self.transfer_household_resource(c.old_hid, c.new_hid, resource, amount, TransferReason::Split, tick);
            }

            // 妻子从旧家户迁入新家户（transfer_member 先移后加，保证唯一归属）
            if let Some(wife_id) = c.spouse_id {
                self.household_registry.transfer_member(wife_id, c.new_hid, tick);
            }

            // 在世子女从旧家户迁入新家户
            for child_id in &c.children_ids {
                if let Some(cidx) = self.agent_index.get(child_id) {
                    if let Some(child) = self.agents.get(*cidx) {
                        if child.is_alive {
                            self.household_registry.transfer_member(*child_id, c.new_hid, tick);
                        }
                    }
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 内部辅助：两家户间资源转移（debit old + credit new + 双方流水）
    // ══════════════════════════════════════════════════════════════

    fn transfer_household_resource(
        &mut self,
        from_hid: HouseholdId,
        to_hid: HouseholdId,
        resource: ResourceKind,
        amount: f32,
        reason: TransferReason,
        tick: u64,
    ) {
        if amount <= 0.0 || from_hid == to_hid {
            return;
        }
        let record = TransferRecord {
            tick,
            from: LedgerRef::Family(from_hid),
            to: LedgerRef::Family(to_hid),
            resource,
            amount,
            reason,
        };
        // Debit 旧家户（顺序 get_mut，无重叠借用）
        if let Some(old_hh) = self.household_registry.get_mut(from_hid) {
            old_hh.group.ledger.debit(resource, amount);
            old_hh.group.ledger.push_transfer(record.clone());
        }
        // Credit 新家户
        if let Some(new_hh) = self.household_registry.get_mut(to_hid) {
            new_hh.group.ledger.credit(resource, amount);
            new_hh.group.ledger.push_transfer(record);
        }
    }
}
