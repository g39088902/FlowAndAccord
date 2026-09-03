//! family.rs · 家户体系：**家庭跟着男人走，而不是跟着婚姻走**（v4 核心）
//!
//! 隶属「账本与仓库重构」计划 M1.4。规则要点（详见计划文档 §2.4）：
//! - **家庭归属**：家户以**男性户主**为锚；婚姻只是两性关系记录（`marriage.rs`），
//!   不承载家庭账本。已婚女性随夫入家户，未成年子女（含母亲腹中胎儿）归父亲家户。
//! - **分家（M2 落地）**：男人成年或失去父亲即成立新家户。父亲在世时权重 1、
//!   母亲（如有且在世）权重 1，其余子一代（含胎儿）各权重 1，分家从旧家户每一类资源分走 `1/W`；
//!   均记 `Split` 流水。
//! - **继承（M2 落地）**：户主死亡 → 资源平分在世妻子（如有）与在世子一代；
//!   无在世妻子且无在世子一代 → 全部交入公仓。
//! - **确定性**：`next_id` 顺序发号、`BTreeMap` 保序、不消耗 `WorldRng`。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::spatial::agent::AgentId;
use super::group::{Group, GroupKind};

pub type HouseholdId = u64;

/// 家户：以男性户主为锚的家庭单元（内嵌家庭团体与账本）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Household {
    pub id: HouseholdId,
    /// 户主（必为男性）——家户存在即户主存在
    pub head: AgentId,
    /// 家庭团体：leader = 户主，成员 = 户主 + 妻子 + 未成年子女 + 腹中胎儿
    pub group: Group,
    /// 分家来源家户（M2 分家抽资时记录血缘链）
    pub parent_household: Option<HouseholdId>,
    pub founded_tick: u64,
    /// 户主死亡清算后标记解散（流水只读归档）
    pub is_dissolved: bool,
}

impl Household {
    /// 建立家户：户主自动成为团体领导与首个成员
    pub fn new(
        id: HouseholdId,
        head: AgentId,
        parent_household: Option<HouseholdId>,
        founded_tick: u64,
        journal_capacity: usize,
    ) -> Self {
        let mut group = Group::new(GroupKind::Family(id), Some(head), journal_capacity);
        let note = match parent_household {
            Some(parent) => format!("🏠 家户 #{} 成立：户主 #{} ♂（自分家 #{} 析出）", id, head, parent),
            None => format!("🏠 家户 #{} 成立：户主 #{} ♂", id, head),
        };
        group.ledger.push_event(founded_tick, note);
        Self { id, head, group, parent_household, founded_tick, is_dissolved: false }
    }
}

/// 家户登记簿：每人任一时刻唯一归属（`by_agent`）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HouseholdRegistry {
    /// 全部家户（含已解散归档）
    pub households: BTreeMap<HouseholdId, Household>,
    /// 每人当前所属家户（唯一归属索引）
    pub by_agent: BTreeMap<AgentId, HouseholdId>,
    /// 确定性发号器（从 1 递增，不回退）
    pub next_id: HouseholdId,
    journal_capacity: usize,
}

impl HouseholdRegistry {
    pub fn new(journal_capacity: usize) -> Self {
        Self {
            households: BTreeMap::new(),
            by_agent: BTreeMap::new(),
            next_id: 1,
            journal_capacity: journal_capacity.max(1),
        }
    }

    /// 清空登记簿（世界重置/重播种子时与 agents 清空同步）
    pub fn clear(&mut self) {
        self.households.clear();
        self.by_agent.clear();
        self.next_id = 1;
    }

    /// 某人当前所属家户
    pub fn household_of(&self, agent: AgentId) -> Option<HouseholdId> {
        self.by_agent.get(&agent).copied()
    }

    /// 只读取家户
    pub fn get(&self, id: HouseholdId) -> Option<&Household> {
        self.households.get(&id)
    }

    /// 可写取家户
    pub fn get_mut(&mut self, id: HouseholdId) -> Option<&mut Household> {
        self.households.get_mut(&id)
    }

    /// 为男性户主成立新家户（parent = 分家来源，可空）
    pub fn create(
        &mut self,
        head: AgentId,
        parent: Option<HouseholdId>,
        tick: u64,
    ) -> HouseholdId {
        // 已拥有自己家户者不重复建户（幂等：成年判定每 tick 为真）
        if let Some(existing) = self.by_agent.get(&head).copied() {
            if self.households.get(&existing).is_some_and(|h| h.head == head) {
                return existing;
            }
            self.remove_member(head, tick);
        }
        let id = self.next_id;
        self.next_id += 1;
        let household = Household::new(id, head, parent, tick, self.journal_capacity);
        self.households.insert(id, household);
        self.by_agent.insert(head, id);
        id
    }

    /// 加入成员（默认加入其归属家户；尚未归属返回 false）
    pub fn add_member(&mut self, household_id: HouseholdId, agent: AgentId, tick: u64) -> bool {
        let Some(household) = self.households.get_mut(&household_id) else {
            return false;
        };
        if household.is_dissolved {
            return false;
        }
        if !household.group.add_member(agent, tick) {
            return false;
        }
        self.by_agent.insert(agent, household_id);
        true
    }

    /// 移除成员（户主不可被移除——户主亡故走 dissolve 清算）
    pub fn remove_member(&mut self, agent: AgentId, tick: u64) -> bool {
        let Some(household_id) = self.by_agent.remove(&agent) else {
            return false;
        };
        let removed = self
            .households
            .get_mut(&household_id)
            .is_some_and(|h| h.group.remove_member(agent, tick));
        if !removed {
            // 团体侧拒绝移除（如试图移除户主）：恢复归属索引，保持索引与团体一致
            self.by_agent.insert(agent, household_id);
        }
        removed
    }

    /// 成员迁移（改嫁/转入夫家：先从旧家户移除，再加入新家户，保证唯一归属）
    pub fn transfer_member(&mut self, agent: AgentId, to: HouseholdId, tick: u64) -> bool {
        let from = self.by_agent.get(&agent).copied();
        if let Some(from_id) = from {
            if from_id == to {
                return false;
            }
            if let Some(h) = self.households.get_mut(&from_id) {
                if h.head == agent {
                    // 若原家户户主自立后改嫁/迁移，将原家户标记解散并卸下领导锁定
                    h.is_dissolved = true;
                    h.group.leader = None;
                }
                h.group.remove_member(agent, tick);
            }
        }
        if !self.add_member(to, agent, tick) {
            return false;
        }
        let note = match from {
            Some(from_id) => format!("🔁 成员 #{} 由家户 #{} 转入家户 #{}", agent, from_id, to),
            None => format!("➕ 成员 #{} 入家户 #{}", agent, to),
        };
        if let Some(h) = self.households.get_mut(&to) {
            h.group.ledger.push_event(tick, note);
        }
        true
    }

    /// 户主死亡清算后解散家户（流水只读归档，成员保留清单供继承结算）
    pub fn dissolve(&mut self, household_id: HouseholdId, tick: u64) -> bool {
        let Some(household) = self.households.get_mut(&household_id) else {
            return false;
        };
        if household.is_dissolved {
            return false;
        }
        household.is_dissolved = true;
        household.group.ledger.push_event(
            tick,
            format!("⚰️ 家户 #{} 户主 #{} 亡故清算，家户解散归档", household_id, household.head),
        );
        true
    }
}

