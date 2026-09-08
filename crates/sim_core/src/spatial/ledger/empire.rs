//! empire.rs · M5 帝国/联邦上层政体
//!
//! 当前只实现帝国（Empire）。数据模型已经把政体与首长称谓拆开，未来可在不改变
//! 营地→帝国归属和公帑结算接口的前提下增加 Federation / President 等变体。
//! 帝国由 1..=n 个营地组成，营地分组按 camp_id 的升序确定性切片，不消耗 RNG。

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use crate::spatial::agent::{AgentId, Gender};
use crate::spatial::ledger::group::{Group, GroupKind};
use crate::spatial::ledger::journal::{LedgerRef, ResourceKind, TransferReason, TransferRecord};
use crate::spatial::world::World3DEngine;

/// 帝国上层政体。只落地 Empire，保留 Federation 扩展位。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EmpireRegime {
    Empire,
    /// 预留：联邦政体尚未接入不同的成员/选举规则。
    Federation,
}

/// 帝国首长称谓。只落地 Emperor，保留 President 扩展位。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EmpireHeadTitle {
    Emperor,
    /// 预留：联邦/共和政体可将首长称谓切换为总统。
    President,
}

/// 单个帝国：成员是营地集合，候选首长是这些营地当前国王。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Empire {
    pub empire_id: u32,
    pub group: Group,
    pub regime: EmpireRegime,
    pub head_title: EmpireHeadTitle,
    pub member_camps: BTreeSet<u32>,
    pub current_reign_start: Option<u64>,
    #[serde(default)]
    pub cumulative_imperial_privy: f32,
}

impl Empire {
    pub fn new(empire_id: u32, journal_capacity: usize) -> Self {
        Self {
            empire_id,
            group: Group::new(GroupKind::Empire(empire_id), None, journal_capacity),
            regime: EmpireRegime::Empire,
            head_title: EmpireHeadTitle::Emperor,
            member_camps: BTreeSet::new(),
            current_reign_start: None,
            cumulative_imperial_privy: 0.0,
        }
    }
}

/// 帝国登记簿：帝国 ↔ 营地唯一归属映射。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmpireRegistry {
    pub empires: BTreeMap<u32, Empire>,
    pub camp_to_empire: BTreeMap<u32, u32>,
    journal_capacity: usize,
}

impl EmpireRegistry {
    pub fn new(journal_capacity: usize) -> Self {
        Self {
            empires: BTreeMap::new(),
            camp_to_empire: BTreeMap::new(),
            journal_capacity: journal_capacity.max(1),
        }
    }

    pub fn clear(&mut self) {
        self.empires.clear();
        self.camp_to_empire.clear();
    }

    pub fn empire_of_camp(&self, camp_id: u32) -> Option<u32> {
        self.camp_to_empire.get(&camp_id).copied()
    }

    pub fn get(&self, empire_id: u32) -> Option<&Empire> {
        self.empires.get(&empire_id)
    }

    pub fn get_mut(&mut self, empire_id: u32) -> Option<&mut Empire> {
        self.empires.get_mut(&empire_id)
    }

    pub fn all_empires(&self) -> impl Iterator<Item = (&u32, &Empire)> {
        self.empires.iter()
    }

    /// 以升序营地做连续切片，保证每个帝国至少 1 个营地（当 camps 非空）。
    /// 只有结构为空或营地集合发生变化时重建，避免每 tick 改写制度归属。
    pub fn ensure_structure(&mut self, camp_ids: &[u32], requested_count: usize) {
        let mut camps: Vec<u32> = camp_ids.iter().copied().collect();
        camps.sort_unstable();
        camps.dedup();
        if camps.is_empty() {
            self.clear();
            return;
        }
        let count = requested_count.max(1).min(camps.len());
        let existing_camps: BTreeSet<u32> = self.camp_to_empire.keys().copied().collect();
        if existing_camps == camps.iter().copied().collect() && self.empires.len() == count {
            return;
        }

        let mut previous = std::mem::take(&mut self.empires);
        self.camp_to_empire.clear();
        for empire_id in 1..=(count as u32) {
            let empire = if let Some(mut old) = previous.remove(&empire_id) {
                old.empire_id = empire_id;
                old.member_camps.clear();
                old.group.kind = GroupKind::Empire(empire_id);
                old
            } else {
                Empire::new(empire_id, self.journal_capacity)
            };
            self.empires.insert(empire_id, empire);
        }
        let base = camps.len() / count;
        let remainder = camps.len() % count;
        let mut cursor = 0usize;
        for idx in 0..count {
            let take = base + usize::from(idx < remainder);
            let empire_id = (idx + 1) as u32;
            for &camp_id in &camps[cursor..cursor + take] {
                self.camp_to_empire.insert(camp_id, empire_id);
                if let Some(empire) = self.empires.get_mut(&empire_id) {
                    empire.member_camps.insert(camp_id);
                }
            }
            cursor += take;
        }
    }
}

impl Default for EmpireRegistry {
    fn default() -> Self {
        Self::new(64)
    }
}

impl World3DEngine {
    /// 帝国结算：先按下属王国国王威望选皇帝，再按王国内帑同周期抽取 5% 黄金。
    pub fn tick_empire(&mut self, _dt: f32) {
        let tick = self.tick_counter;
        self.ensure_empire_structure();
        self.update_emperors(tick);
        self.tick_imperial_privy(tick);
    }

    fn ensure_empire_structure(&mut self) {
        let camp_ids: Vec<u32> = self
            .pois
            .iter()
            .filter(|p| p.poi_type == crate::spatial::poi::PoiType::Camp)
            .map(|p| p.id)
            .collect();
        self.empire_registry
            .ensure_structure(&camp_ids, self.config.count_empires);
    }

    fn update_emperors(&mut self, tick: u64) {
        let mut choices: Vec<(u32, Option<AgentId>)> = Vec::new();
        for (empire_id, empire) in &self.empire_registry.empires {
            let mut best: Option<(u32, AgentId)> = None;
            for camp_id in &empire.member_camps {
                let Some(king_id) = self
                    .region_registry
                    .get(*camp_id)
                    .and_then(|r| r.group.leader)
                else {
                    continue;
                };
                let Some(king) = self.agent_by_id(king_id) else {
                    continue;
                };
                if !king.is_alive || king.gender != Gender::Male {
                    continue;
                }
                let candidate = (king.prestige, king_id);
                if best.map_or(true, |current| {
                    candidate.0 > current.0 || (candidate.0 == current.0 && candidate.1 < current.1)
                }) {
                    best = Some(candidate);
                }
            }
            choices.push((*empire_id, best.map(|(_, id)| id)));
        }

        for (empire_id, chosen) in choices {
            let Some(empire) = self.empire_registry.get_mut(empire_id) else {
                continue;
            };
            if let Some(id) = chosen {
                empire.group.members.insert(id);
                if empire.group.leader != Some(id) {
                    if empire
                        .group
                        .set_leader(id, tick, "帝国内威望最高的下属国王加冕")
                    {
                        empire.current_reign_start = Some(tick);
                        self.last_event = Some(format!(
                            "🌐 帝国 #{}：国王 #{} 以最高威望加冕为皇帝！",
                            empire_id, id
                        ));
                    }
                }
            } else if empire.group.leader.is_some() {
                empire.group.leader = None;
                empire.current_reign_start = None;
                empire
                    .group
                    .ledger
                    .push_event(tick, "🌐 帝国内无在位国王，皇位空悬，帝国账本冻结");
            }
        }
    }

    /// 与国王内帑完全相同的 6000 tick 周期；每个帝国从每个下属王国公仓黄金余额抽取 5%。
    fn tick_imperial_privy(&mut self, tick: u64) {
        const INTERVAL_TICKS: u64 = 6000;
        if tick == 0
            || tick
                < self
                    .last_imperial_payout_tick
                    .saturating_add(INTERVAL_TICKS)
        {
            return;
        }
        self.last_imperial_payout_tick = tick - (tick % INTERVAL_TICKS);

        let mut payouts: Vec<(u32, u32, AgentId, f32)> = Vec::new();
        for (empire_id, empire) in &self.empire_registry.empires {
            let Some(emperor_id) = empire.group.leader else {
                continue;
            };
            for camp_id in &empire.member_camps {
                let Some(region) = self.region_registry.get(*camp_id) else {
                    continue;
                };
                let amount = region.group.ledger.balance(ResourceKind::Gold) * 0.05;
                if amount > 0.0 {
                    payouts.push((*empire_id, *camp_id, emperor_id, amount));
                }
            }
        }

        for (empire_id, camp_id, emperor_id, amount) in payouts {
            if let Some(region) = self.region_registry.get_mut(camp_id) {
                region.group.ledger.debit(ResourceKind::Gold, amount);
                region.group.ledger.push_transfer(TransferRecord {
                    tick,
                    from: LedgerRef::Region(camp_id),
                    to: LedgerRef::Personal(emperor_id),
                    resource: ResourceKind::Gold,
                    amount,
                    reason: TransferReason::ImperialPrivy,
                });
            }
            if let Some(empire) = self.empire_registry.get_mut(empire_id) {
                empire.cumulative_imperial_privy += amount;
                empire.group.ledger.push_transfer(TransferRecord {
                    tick,
                    from: LedgerRef::Region(camp_id),
                    to: LedgerRef::Personal(emperor_id),
                    resource: ResourceKind::Gold,
                    amount,
                    reason: TransferReason::ImperialPrivy,
                });
            }
            if let Some(emperor) = self.agent_by_id_mut(emperor_id) {
                emperor.carried_gold += amount;
                emperor.cumulative_imperial_privy += amount;
            }
        }
    }
}
