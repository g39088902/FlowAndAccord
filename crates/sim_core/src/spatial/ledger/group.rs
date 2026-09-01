//! group.rs · 团体基类：领导 + 成员列表（含领导）+ 账本
//!
//! 隶属「账本与仓库重构」计划 M1.2。家庭 / 宗族（M3）/ 地区（M4）本质都是团体，
//! 均实例化自本基类。成员与领导变动必须走本文件单点入口并留审计事件，
//! 严禁在模块外直接改写 leader / members 字段。

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use crate::spatial::agent::AgentId;
use super::family::HouseholdId;
use super::journal::Ledger;

/// 团体类型（五级产权账本的组织载体；M1 仅落地家庭，其余按计划逐期扩展）
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum GroupKind {
    /// 🏠 家庭（**跟着男人走**：以男性户主的家户为锚，与房屋解耦）
    Family(HouseholdId),
    // ⛩️ Clan(SurnameId)   —— M3 预留：宗族（领导者=族长：同姓最年长在世男性）
    // 🏛️ Region(CampId)    —— M4 预留：地区（领导者=国王，独有政体与换届）
    // 🏢 Corporate(CompanyId) —— 预留：商号/公司
}

/// 团体三要素：领导、成员列表（含领导）、账本（仓库）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub kind: GroupKind,
    /// 领导（家庭=户主；宗族=族长；地区=国王）。领导必然同时出现在 members 中。
    pub leader: Option<AgentId>,
    /// 成员列表（含领导）。BTreeSet 保证遍历顺序确定性（按 AgentId 升序）。
    pub members: BTreeSet<AgentId>,
    /// 团体账本（仓库的账面口径）
    pub ledger: Ledger,
}

impl Group {
    /// 创建团体：领导（若有）自动进入成员列表
    pub fn new(kind: GroupKind, leader: Option<AgentId>, journal_capacity: usize) -> Self {
        let mut members = BTreeSet::new();
        if let Some(l) = leader {
            members.insert(l);
        }
        Self { kind, leader, members, ledger: Ledger::new(journal_capacity) }
    }

    /// 加入成员（幂等：已是成员返回 false）。留 Membership 审计事件。
    pub fn add_member(&mut self, agent: AgentId, tick: u64) -> bool {
        if !self.members.insert(agent) {
            return false;
        }
        self.ledger.push_event(tick, format!("👥 成员 #{} 加入团体", agent));
        true
    }

    /// 移除成员（领导不可被移除，返回 false；不存在返回 false）。留 Membership 审计事件。
    pub fn remove_member(&mut self, agent: AgentId, tick: u64) -> bool {
        if self.leader == Some(agent) {
            return false; // 领导更替必须走 set_leader，禁止直接开除领导
        }
        if !self.members.remove(&agent) {
            return false;
        }
        self.ledger.push_event(tick, format!("🚪 成员 #{} 离开团体", agent));
        true
    }

    /// 更替领导：新领导必须已是成员；留 Succession/Membership 审计事件
    pub fn set_leader(&mut self, agent: AgentId, tick: u64, note: &str) -> bool {
        if !self.members.contains(&agent) {
            return false;
        }
        let old = self.leader.replace(agent);
        match old {
            Some(old_leader) if old_leader != agent => {
                self.ledger.push_event(tick, format!("👑 领导由 #{} 更替为 #{}：{}", old_leader, agent, note));
            }
            _ => {
                self.ledger.push_event(tick, format!("👑 领导确认为 #{}：{}", agent, note));
            }
        }
        true
    }

    /// 是否包含某成员（含领导）
    pub fn has_member(&self, agent: AgentId) -> bool {
        self.members.contains(&agent)
    }
}

