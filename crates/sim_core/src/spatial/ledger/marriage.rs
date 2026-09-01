//! marriage.rs · 婚姻登记系统：Marriage 实体 + MarriageRegistry 登记簿
//!
//! 隶属「账本与仓库重构」计划 M1.3 / M1.4。核心解耦原则：
//! - **婚姻与房屋解耦**：Marriage 实体不持有任何 house_id 字段；
//!   "有房才能结婚"仅是登记时的资格校验（保留在 housing_system/marriage.rs），
//!   婚姻成立后不引用、不跟随房屋（房塌/搬迁不影响婚姻存续与家庭账本）。
//! - **登记簿是唯一真实来源**：Agent3D.spouse_id 降级为缓存，
//!   由本登记簿在 register/close 时回写。
//! - **家庭不挂婚姻**（v4）：家户账本登记在**男性户主**名下（`family.rs::Household`），
//!   本文件只记两性关系与历史，不承载任何账本/团体。
//! - **终身多段婚姻全留痕**：初婚/丧偶封账/改嫁开新账，by_agent 索引可完整回溯。
//! - **确定性**：next_id 顺序发号、BTreeMap 保序、不消耗 WorldRng。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::spatial::agent::AgentId;

pub type MarriageId = u64;

/// 婚姻终止事由（当前游戏仅丧偶解婚；改嫁发生在丧偶之后，故旧婚姻均以 Bereaved 封账）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MarriageEndReason {
    /// 丧偶（配偶死亡）
    Bereaved,
}

/// 一段婚姻实体（与房屋彻底解耦；**不承载账本**——家庭账本在男性户主的家户下）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Marriage {
    pub id: MarriageId,
    pub husband_id: AgentId,
    pub wife_id: AgentId,
    /// 登记时的世界 tick
    pub start_tick: u64,
    /// 封账时刻（None = 存续中）
    pub end_tick: Option<u64>,
    pub end_reason: Option<MarriageEndReason>,
}

impl Marriage {
    /// 是否存续
    pub fn is_active(&self) -> bool {
        self.end_tick.is_none()
    }
}

/// 全局婚姻登记簿：按人索引的多段婚姻全历史
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarriageRegistry {
    /// 全部婚姻（含已封账归档段）
    pub marriages: BTreeMap<MarriageId, Marriage>,
    /// 每人名下的婚姻 ID 时序（含历史各段，登记顺序即段位顺序）
    pub by_agent: BTreeMap<AgentId, Vec<MarriageId>>,
    /// 确定性发号器（从 1 递增，不回退）
    pub next_id: MarriageId,
    /// 预留的流水容量口径（家庭流水实际存放于家户账本，见 family.rs）
    pub journal_capacity: usize,
}

impl MarriageRegistry {
    pub fn new(journal_capacity: usize) -> Self {
        Self {
            marriages: BTreeMap::new(),
            by_agent: BTreeMap::new(),
            next_id: 1,
            journal_capacity: journal_capacity.max(1),
        }
    }

    /// 清空登记簿（世界重置/重播种子时调用，与 agents 清空同步）
    pub fn clear(&mut self) {
        self.marriages.clear();
        self.by_agent.clear();
        self.next_id = 1;
    }

    /// 某人当前存续婚姻（至多一段）
    pub fn active_marriage_of(&self, agent: AgentId) -> Option<MarriageId> {
        self.by_agent.get(&agent)?.iter().copied().find(|&mid| {
            self.marriages.get(&mid).is_some_and(Marriage::is_active)
        })
    }

    /// 登记资格：双方均无存续婚姻且不为同一人
    pub fn can_register(&self, husband_id: AgentId, wife_id: AgentId) -> bool {
        husband_id != wife_id
            && self.active_marriage_of(husband_id).is_none()
            && self.active_marriage_of(wife_id).is_none()
    }

    /// 登记结婚：创建婚姻 + 家庭团体（领导者=丈夫，成员=夫妻），返回婚姻 ID。
    ///
    /// 存续唯一性在登记簿单点校验（违反返回 None，调用方不应依赖此分支）；
    /// 丧偶女性的改嫁发生在旧婚姻封账之后，天然满足唯一性。
    pub fn register(&mut self, husband_id: AgentId, wife_id: AgentId, tick: u64) -> Option<MarriageId> {
        if !self.can_register(husband_id, wife_id) {
            return None;
        }
        let id = self.next_id;
        self.next_id += 1;

        self.marriages.insert(id, Marriage {
            id,
            husband_id,
            wife_id,
            start_tick: tick,
            end_tick: None,
            end_reason: None,
        });
        self.by_agent.entry(husband_id).or_default().push(id);
        self.by_agent.entry(wife_id).or_default().push(id);
        Some(id)
    }

    /// 封账归档：终止存续婚姻（只读归档，流水永久留痕）。重复封账返回 false。
    pub fn close(&mut self, marriage_id: MarriageId, reason: MarriageEndReason, tick: u64) -> bool {
        let Some(marriage) = self.marriages.get_mut(&marriage_id) else {
            return false;
        };
        if !marriage.is_active() {
            return false;
        }
        marriage.end_tick = Some(tick);
        marriage.end_reason = Some(reason);
        true
    }

    /// 由任一配偶查询婚姻实体（只读）
    pub fn get(&self, marriage_id: MarriageId) -> Option<&Marriage> {
        self.marriages.get(&marriage_id)
    }
}

