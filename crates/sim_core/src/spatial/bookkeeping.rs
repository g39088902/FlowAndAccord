//! bookkeeping.rs · M2 旁路记账与家户经济规则（tick_bookkeeping 总入口）
//!
//! 隶属「账本与仓库重构」计划 M2，M6（账本化改造）阶段一修订：
//! - **旧旁路观测已删除**：Deposit（卸货差分）/ Consume（在家吃喝）/ Heating（冬季烧柴）
//!   三条观测自 M6 阶段一起改由生态层/维护层**真实收付**家户账本（见 ecology/ RestingAtCamp、
//!   maintenance.rs tick_winter_heating），此处不再重复记账，避免双写。
//! - 本文件仍承担**家庭生命周期结算**：Inheritance（户主死亡继承清算）+ Split（成年/丧父分家抽资），
//!   二者只记账本余额（credit/debit + 流水），不动物理库存。
//! - **确定性**：不消耗 WorldRng；所有集合遍历按 id 保序；不新增决策相位。
//! - **执行顺序**：Inheritance 先于 Split（丧父之子由继承直接立户，Split 幂等跳过已立户者）。

use crate::spatial::agent::{AgentId, Gender};
use crate::spatial::ledger::family::HouseholdId;
use crate::spatial::ledger::journal::{LedgerRef, ResourceKind, TransferReason, TransferRecord};
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
    // Inheritance：户主死亡 → 资源平分在世妻子与子一代（女性入背包/超额入公仓，男性立新户/转存续户）/ 绝嗣入公仓 → 解散家户
    // ══════════════════════════════════════════════════════════════

    fn tick_inheritance(&mut self, tick: u64) {
        // READ PHASE：收集待清算家户（户主已死亡）
        let mut pending: Vec<(HouseholdId, Vec<(ResourceKind, f32)>, Vec<AgentId>)> = Vec::new();

        for hid in &self.household_registry.active_households {
            let Some(hh) = self.household_registry.households.get(hid) else {
                continue;
            };
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

            // 收集继承人：在世妻子（如有）+ 在世子一代
            let mut living_heirs: Vec<AgentId> = Vec::new();

            // 1. 妻子（若在世）
            let surviving_wife = self
                .marriage_registry
                .by_agent
                .get(&hh.head)
                .and_then(|mids| {
                    mids.last().and_then(|&mid| {
                        let m = self.marriage_registry.get(mid)?;
                        if m.husband_id == hh.head {
                            let is_alive = self
                                .agent_index
                                .get(&m.wife_id)
                                .and_then(|idx| self.agents.get(*idx))
                                .map(|a| a.is_alive)
                                .unwrap_or(false);
                            if is_alive {
                                Some(m.wife_id)
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    })
                });
            if let Some(wife_id) = surviving_wife {
                living_heirs.push(wife_id);
            }

            // 2. 收集户主的在世子一代（children_ids 中 is_alive=true）
            if let Some(head_idx) = self.agent_index.get(&hh.head) {
                if let Some(head_agent) = self.agents.get(*head_idx) {
                    for cid in &head_agent.children_ids {
                        if let Some(cidx) = self.agent_index.get(cid) {
                            if let Some(child) = self.agents.get(*cidx) {
                                if child.is_alive && !living_heirs.contains(cid) {
                                    living_heirs.push(*cid);
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

            pending.push((*hid, balances, living_heirs));
        }

        // WRITE PHASE：执行继承分配
        for (hid, balances, living_heirs) in pending {
            if !living_heirs.is_empty() {
                // 有在世继承人（妻子/子女）：资源平分
                let n = living_heirs.len() as f32;
                for heir_id in &living_heirs {
                    let heir_id = *heir_id;
                    let heir_gender = self
                        .agent_index
                        .get(&heir_id)
                        .and_then(|idx| self.agents.get(*idx))
                        .map(|a| a.gender);

                    if heir_gender == Some(Gender::Female) {
                        // 女性继承人（妻子/女儿）：不能成立家户，遗产装入随身背包，超出背包容量入公仓
                        let carry_cap = self.config.carry_capacity_resource;
                        let mut transfers: Vec<(ResourceKind, f32, f32)> = Vec::new();

                        if let Some(&agent_idx) = self.agent_index.get(&heir_id) {
                            let heir_agent = &mut self.agents[agent_idx];
                            for (resource, total_amt) in &balances {
                                let share = total_amt / n;
                                if share <= 0.001 {
                                    continue;
                                }
                                let (to_bag, to_granary) = match resource {
                                    ResourceKind::Water => {
                                        let space = (carry_cap - heir_agent.carried_water).max(0.0);
                                        let b = share.min(space);
                                        heir_agent.carried_water += b;
                                        (b, share - b)
                                    }
                                    ResourceKind::Food => {
                                        let space = (carry_cap - heir_agent.carried_food).max(0.0);
                                        let b = share.min(space);
                                        heir_agent.carried_food += b;
                                        (b, share - b)
                                    }
                                    ResourceKind::Wood => {
                                        let space = (carry_cap - heir_agent.carried_wood).max(0.0);
                                        let b = share.min(space);
                                        heir_agent.carried_wood += b;
                                        (b, share - b)
                                    }
                                    ResourceKind::Stone => {
                                        let space = (carry_cap - heir_agent.carried_stone).max(0.0);
                                        let b = share.min(space);
                                        heir_agent.carried_stone += b;
                                        (b, share - b)
                                    }
                                    ResourceKind::Gold => {
                                        heir_agent.carried_gold += share;
                                        (share, 0.0)
                                    }
                                };
                                transfers.push((*resource, to_bag, to_granary));
                            }
                        }

                        // 记账：扣减已故家户账本，写入个人背包（Personal）与公仓（PublicGranary）
                        for (resource, to_bag, to_granary) in transfers {
                            let total_share = to_bag + to_granary;
                            if total_share <= 0.001 {
                                continue;
                            }
                            if let Some(old_hh) = self.household_registry.get_mut(hid) {
                                old_hh.group.ledger.debit(resource, total_share);
                                if to_bag > 0.001 {
                                    old_hh.group.ledger.push_transfer(TransferRecord {
                                        tick,
                                        from: LedgerRef::Family(hid),
                                        to: LedgerRef::Personal(heir_id),
                                        resource,
                                        amount: to_bag,
                                        reason: TransferReason::Inheritance,
                                    });
                                }
                                if to_granary > 0.001 {
                                    old_hh.group.ledger.push_transfer(TransferRecord {
                                        tick,
                                        from: LedgerRef::Family(hid),
                                        to: LedgerRef::PublicGranary,
                                        resource,
                                        amount: to_granary,
                                        reason: TransferReason::Inheritance,
                                    });
                                }
                            }
                            if to_granary > 0.001 {
                                self.public_granary.credit(resource, to_granary);
                                self.public_granary.push_transfer(TransferRecord {
                                    tick,
                                    from: LedgerRef::Family(hid),
                                    to: LedgerRef::PublicGranary,
                                    resource,
                                    amount: to_granary,
                                    reason: TransferReason::Inheritance,
                                });
                            }
                        }

                        // 若女性原属于该家户，从旧家户中移除归属（女性丧父或丧夫均不能自立家户）
                        if self.household_registry.household_of(heir_id) == Some(hid) {
                            self.household_registry.remove_member(heir_id, tick);
                        }
                    } else {
                        // 男性继承人：若已属于其他独立家户则转入，否则立新户
                        let target_hid =
                            if let Some(chid) = self.household_registry.household_of(heir_id) {
                                if chid != hid {
                                    Some(chid)
                                } else {
                                    None // 仍在已故家户中（未立户子女），需立新户
                                }
                            } else {
                                None
                            };

                        let target_hid = match target_hid {
                            Some(h) => h,
                            None => self.household_registry.create(heir_id, Some(hid), tick),
                        };

                        // 按品类转入继承份额
                        for (resource, total_amt) in &balances {
                            let share = total_amt / n;
                            if share > 0.001 {
                                self.transfer_household_resource(
                                    hid,
                                    target_hid,
                                    *resource,
                                    share,
                                    TransferReason::Inheritance,
                                    tick,
                                );
                            }
                        }
                    }
                }
            } else {
                // 绝嗣（无在世妻子且无在世子女）：全部资源转入公仓兜底账本
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
    // Split：男子成年或丧父 → 从父亲家户分走 1/W 资源（W = 1(父) + 1(母) + n(子一代)）→ 立新户
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
        // ★ v1.44.0 户主标志自愈收集：需将 `is_household_head` 置 true 的在世男性
        // （幂等命中 = 旧档/新增立户路径首拍回填；新分家户主 = 立户即回填）
        let mut head_flag_sync: Vec<AgentId> = Vec::new();

        for agent in &self.agents {
            if !agent.is_alive || agent.gender != Gender::Male || agent.is_fetus {
                continue;
            }

            // ★ v1.44.0 O(1) 快速短路：户主在世期间终生不可能再分家（数学不变量），
            // 稳态下全图绝大部分成年男性在此一次布尔判断退出，免去两次红黑树幂等回溯查询。
            if agent.is_household_head {
                continue;
            }

            // 条件A：成年；条件B：父亲已死亡（无论是否成年）
            // 绝大多数未成年男童其父在世，廉价判断后立即跳过，不碰红黑树
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

            // 幂等：已是自己家户户主的男人不再分家（单次查询并复用 old_hid）
            let Some(old_hid) = self.household_registry.household_of(agent.id) else {
                continue; // 无家户归属（始祖已在初始化时立户，不应到此）
            };
            if self
                .household_registry
                .get(old_hid)
                .is_some_and(|hh| hh.head == agent.id)
            {
                // ★ v1.44.0 已是户主（旧档反序列化默认 false / 未来新增立户路径）：
                // 自愈回填标志，本拍起此后 O(1) 短路；语义与旧版 continue 完全等价
                head_flag_sync.push(agent.id);
                continue;
            }

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

            // 权重计算：
            // 成年分家 → 父亲权重 1.0（若在世），母亲权重 1.0（若在世/如有），子一代各权重 1.0
            // 丧父/丧母时，亡者不占权重。
            let father_alive = !father_dead;
            let father_weight = if father_alive { 1.0 } else { 0.0 };

            // 母亲（生母优先，若生母已故但父亲有在世续弦妻室则看续弦）是否在世
            let mother_alive = {
                let bio_mother_alive = agent
                    .mother_id
                    .and_then(|mid| self.agent_index.get(&mid))
                    .and_then(|idx| self.agents.get(*idx))
                    .map(|m| m.is_alive)
                    .unwrap_or(false);
                if bio_mother_alive {
                    true
                } else {
                    agent
                        .father_id
                        .and_then(|fid| self.agent_index.get(&fid))
                        .and_then(|idx| self.agents.get(*idx))
                        .and_then(|f| f.spouse_id)
                        .and_then(|sp| self.agent_index.get(&sp))
                        .and_then(|idx| self.agents.get(*idx))
                        .map(|sp| sp.is_alive)
                        .unwrap_or(false)
                }
            };
            let mother_weight = if mother_alive { 1.0 } else { 0.0 };

            let weight_total = (n_children as f32 + father_weight + mother_weight).max(1.0);
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
            let new_hid = self
                .household_registry
                .create(agent.id, Some(old_hid), tick);

            candidates.push(SplitCandidate {
                old_hid,
                new_hid,
                amounts,
                spouse_id: agent.spouse_id,
                children_ids: agent.children_ids.clone(),
            });
            // 分家即成为新家户户主，WRITE 阶段统一回填标志
            head_flag_sync.push(agent.id);
        }

        // WRITE PHASE：执行资源转移 + 成员迁移
        for c in candidates {
            // 资源从旧家户转到新家户（Split 流水）
            for (resource, amount) in c.amounts {
                self.transfer_household_resource(
                    c.old_hid,
                    c.new_hid,
                    resource,
                    amount,
                    TransferReason::Split,
                    tick,
                );
            }

            // 妻子从旧家户迁入新家户（transfer_member 先移后加，保证唯一归属）
            if let Some(wife_id) = c.spouse_id {
                self.household_registry
                    .transfer_member(wife_id, c.new_hid, tick);
            }

            // 在世子女从旧家户迁入新家户
            for child_id in &c.children_ids {
                if let Some(cidx) = self.agent_index.get(child_id) {
                    if let Some(child) = self.agents.get(*cidx) {
                        if child.is_alive {
                            self.household_registry
                                .transfer_member(*child_id, c.new_hid, tick);
                        }
                    }
                }
            }
        }

        // ★ v1.44.0 统一回填 `is_household_head`（幂等命中户主 + 新分家户主）。
        // 回填后标志单向置 true、终生不复位：在世男性一旦成为户主即不再分家，
        // 下一 tick 起在本函数首部 O(1) 短路，彻底免去红黑树幂等回溯。
        for head_id in head_flag_sync {
            if let Some(agent) = self.agent_by_id_mut(head_id) {
                agent.is_household_head = true;
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
