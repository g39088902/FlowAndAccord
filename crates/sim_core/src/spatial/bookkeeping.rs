//! bookkeeping.rs · M2 旁路记账与家户经济规则（tick_bookkeeping 总入口）
//!
//! 隶属「账本与仓库重构」计划 M2，M6（账本化改造）阶段一修订：
//! - **旧旁路观测已删除**：Deposit（卸货差分）/ Consume（在家吃喝）/ Heating（冬季烧柴）
//!   三条观测自 M6 阶段一起改由生态层/维护层**真实收付**家户账本（见 ecology.rs RestingAtCamp、
//!   maintenance.rs tick_winter_heating），此处不再重复记账，避免双写。
//! - 本文件仍承担**家庭生命周期结算**：Inheritance（户主死亡继承清算）+ Split（成年/丧父分家抽资），
//!   二者只记账本余额（credit/debit + 流水），不动物理库存。
//! - **确定性**：不消耗 WorldRng；所有集合遍历按 id 保序；不新增决策相位。
//! - **执行顺序**：Inheritance 先于 Split（丧父之子由继承直接立户，Split 幂等跳过已立户者）。

use crate::spatial::agent::{AgentId, Gender};
use crate::spatial::ledger::family::HouseholdId;
use crate::spatial::ledger::journal::{
    LedgerRef, ResourceKind, TransferReason, TransferRecord,
};
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
    /// M2 家庭生命周期结算总入口（M6 起仅含继承清算与分家抽资）。
    /// 在 tick() 尾段（错峰决策之后）调用，作为账本制度结算的最后一步前序。
    pub fn tick_bookkeeping(&mut self) {
        let tick = self.tick_counter;

        // ── 1. Inheritance（户主死亡清算）先于 Split ──
        self.tick_inheritance(tick);

        // ── 2. Split（成年/丧父分家抽资）──
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
