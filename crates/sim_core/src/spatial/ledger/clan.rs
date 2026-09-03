//! clan.rs · M3 宗族系统：宗族聚合、族长顺位、族税征收、族内互助
//!
//! 隶属「账本与仓库重构」计划 M3。核心原则：
//! - **按姓氏聚合**：同姓 agent 自动归入同一宗族（不要求同营地）；始祖播撒即入族，
//!   新生儿随父姓入族。
//! - **族长顺位**：族长 = 同姓在世最年长男性；并列按 id 取小（确定性）；无在世男性
//!   则宗族无主（leader=None），账本冻结（不主动支出，但可接收 Tribute）。
//! - **族税**：每 `clan_tribute_interval_ticks` 全局统一征收，存续家户按账面余额
//!   × `clan_tribute_rate` 向族库缴纳（只记账不扣物理库存）。
//! - **族内互助**：族库充足时对极贫家户（水+粮 < threshold）拨付 MutualAid，
//!   每家户每 `clan_mutual_aid_cooldown_ticks` 最多一次。
//! - **确定性**：不消耗 WorldRng；BTreeMap/BTreeSet 保序；全局统一征税时点。
//! - **新旧分离**：不 import house.rs 仓储字段；族税/互助只记账本余额。

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use crate::spatial::agent::{AgentId, Gender};
use crate::spatial::ledger::family::HouseholdId;
use crate::spatial::ledger::group::{Group, GroupKind};
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

// ══════════════════════════════════════════════════════════════
// ClanRegistry：按姓氏索引的宗族团体登记簿
// ══════════════════════════════════════════════════════════════

/// 宗族登记簿：按姓氏聚合的团体（族长=同姓最年长在世男性）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClanRegistry {
    /// 全部宗族（按姓氏 String 升序保序遍历）
    pub clans: BTreeMap<String, Group>,
    /// 每人当前所属姓氏（唯一归属索引）
    pub by_agent: BTreeMap<AgentId, String>,
    /// ★ v1.9.0 绝嗣宗族标记（所有男性已亡；族产已平分给其他宗族 / 入公仓）。
    /// 绝嗣后不再反复清算；保留历史数据与账本流水。
    pub extinct: BTreeSet<String>,
    journal_capacity: usize,
}

impl ClanRegistry {
    pub fn new(journal_capacity: usize) -> Self {
        Self {
            clans: BTreeMap::new(),
            by_agent: BTreeMap::new(),
            extinct: BTreeSet::new(),
            journal_capacity: journal_capacity.max(1),
        }
    }

    /// 清空登记簿（世界重置/重播种子时与 agents 清空同步）
    pub fn clear(&mut self) {
        self.clans.clear();
        self.by_agent.clear();
        self.extinct.clear();
    }

    /// 按姓氏读取宗族
    pub fn get(&self, surname: &str) -> Option<&Group> {
        self.clans.get(surname)
    }

    /// 按姓氏可写读取宗族
    pub fn get_mut(&mut self, surname: &str) -> Option<&mut Group> {
        self.clans.get_mut(surname)
    }

    /// 某人当前所属姓氏
    pub fn clan_of(&self, agent: AgentId) -> Option<&String> {
        self.by_agent.get(&agent)
    }

    /// 确保宗族存在（不存在则创建空宗族，leader=None）
    pub fn ensure_clan(&mut self, surname: &str) {
        if !self.clans.contains_key(surname) {
            let group = Group::new(GroupKind::Clan(surname.to_string()), None, self.journal_capacity);
            self.clans.insert(surname.to_string(), group);
        }
    }

    /// 加入宗族成员（幂等：已是成员返回 false）。自动确保宗族存在。
    /// ★ v1.9.1 宗族与女性无关：女性一律不入族（宗族 = 纯父系男性团体）。
    pub fn add_member(&mut self, surname: &str, agent: AgentId, tick: u64, gender: Gender) -> bool {
        if gender != Gender::Male {
            return false;
        }
        self.ensure_clan(surname);
        let clan = self.clans.get_mut(surname).expect("clan just ensured");
        if !clan.add_member(agent, tick) {
            return false;
        }
        self.by_agent.insert(agent, surname.to_string());
        true
    }

    /// 移除宗族成员（领导不可被直接移除，返回 false；不存在返回 false）
    pub fn remove_member(&mut self, agent: AgentId, tick: u64) -> bool {
        let Some(surname) = self.by_agent.remove(&agent) else {
            return false;
        };
        let removed = self
            .clans
            .get_mut(&surname)
            .is_some_and(|c| c.remove_member(agent, tick));
        if !removed {
            // 团体侧拒绝移除（如试图移除族长）：恢复归属索引
            self.by_agent.insert(agent, surname);
        }
        removed
    }
}

// ══════════════════════════════════════════════════════════════
// impl World3DEngine：宗族系统 tick 逻辑
// ══════════════════════════════════════════════════════════════

impl World3DEngine {
    /// M3 宗族系统总入口：族长顺位 → 族税征收 → 族内互助
    /// 在 tick() 尾段（tick_bookkeeping 之后）调用。
    pub fn tick_clan(&mut self, _dt: f32) {
        let tick = self.tick_counter;
        self.update_clan_leaders(tick);
        self.tick_clan_tribute(tick);
        self.tick_clan_mutual_aid(tick);
    }

    // ══════════════════════════════════════════════════════════
    // 族长顺位：同姓在世最年长男性，并列按 id 取小
    // ══════════════════════════════════════════════════════════

    fn update_clan_leaders(&mut self, tick: u64) {
        // READ PHASE：收集每个宗族的新族长候选（不可变借用 agents）
        let mut successions: Vec<(String, Option<AgentId>)> = Vec::new();
        // ★ v1.9.0 绝嗣检测：已无在世男性且尚未标记绝嗣的宗族
        let mut extinct_candidates: Vec<String> = Vec::new();

        for (surname, clan) in &self.clan_registry.clans {
            let mut best: Option<(AgentId, f32)> = None; // (id, age)
            let mut has_living_male = false;

            // BTreeSet 按 AgentId 升序遍历，并列时先遇到的 id 更小，自然满足确定性
            for &member_id in &clan.members {
                let Some(agent) = self.agent_by_id(member_id) else {
                    continue;
                };
                if !agent.is_alive || agent.gender != Gender::Male {
                    continue;
                }
                has_living_male = true;
                match best {
                    None => best = Some((member_id, agent.age)),
                    Some((_, best_age)) if agent.age > best_age => {
                        best = Some((member_id, agent.age));
                    }
                    _ => {} // age <= best_age：保持当前（id 更小者优先，因升序遍历先遇到）
                }
            }

            let new_leader = best.map(|(id, _)| id);
            // 绝嗣判定：宗族已存在（成员非空）但已无在世男性，且尚未标记绝嗣
            if !has_living_male && !clan.members.is_empty() && !self.clan_registry.extinct.contains(surname) {
                extinct_candidates.push(surname.clone());
            }
            // 仅在族长实际变化时记录（避免每 tick 刷事件）
            if clan.leader != new_leader {
                successions.push((surname.clone(), new_leader));
            }
        }

        // WRITE PHASE A：绝嗣结算（族产平分给其他宗族 / 入公仓），在领导更替前执行
        for surname in extinct_candidates {
            self.mark_clan_extinct(&surname, tick);
        }

        // WRITE PHASE B：应用族长更替
        for (surname, new_leader) in successions {
            let Some(clan) = self.clan_registry.clans.get_mut(&surname) else {
                continue;
            };
            match new_leader {
                Some(id) => {
                    clan.set_leader(id, tick, "同姓最年长在世男性顺位继承");
                }
                None => {
                    // 无在世男性：宗族无主，账本冻结（绝嗣宗族由 mark_clan_extinct 记录事件）
                    clan.leader = None;
                    if !self.clan_registry.extinct.contains(&surname) {
                        clan.ledger.push_event(tick, format!("⛩️ 宗族【{}】无在世男性，族长之位空缺，账本冻结", surname));
                    }
                }
            }
        }
    }

    /// ★ v1.9.0 宗族绝嗣结算：所有男性已亡 → 标记绝嗣，族产平分给其他存续宗族（无则入公仓兜底）。
    /// 保留历史数据：宗族实体、成员列表与账本流水均保留。
    fn mark_clan_extinct(&mut self, surname: &str, tick: u64) {
        if self.clan_registry.extinct.contains(surname) {
            return;
        }
        // READ：收集绝嗣宗族账面余额（五类固定顺序）
        let mut balances: Vec<(ResourceKind, f32)> = Vec::new();
        if let Some(clan) = self.clan_registry.get(surname) {
            for &rk in RESOURCE_ORDER.iter() {
                let bal = clan.ledger.balance(rk);
                if bal > 0.001 {
                    balances.push((rk, bal));
                }
            }
        }

        // 收集其他存续宗族（非绝嗣、且仍留有成员）
        let other_clans: Vec<String> = self.clan_registry.clans.iter()
            .filter(|(s, c)| *s != surname && !self.clan_registry.extinct.contains(*s) && !c.members.is_empty())
            .map(|(s, _)| s.clone())
            .collect();

        if other_clans.is_empty() {
            // 无其他存续宗族：族产入公仓兜底账本
            for (rk, amt) in &balances {
                let record = TransferRecord {
                    tick,
                    from: LedgerRef::Clan(surname.to_string()),
                    to: LedgerRef::PublicGranary,
                    resource: *rk,
                    amount: *amt,
                    reason: TransferReason::Legacy,
                };
                if let Some(clan) = self.clan_registry.get_mut(surname) {
                    clan.ledger.debit(*rk, *amt);
                    clan.ledger.push_transfer(record.clone());
                }
                self.public_granary.credit(*rk, *amt);
                self.public_granary.push_transfer(record);
            }
        } else {
            // 族产平分给其他存续宗族
            let share_count = other_clans.len() as f32;
            for (rk, amt) in &balances {
                if let Some(clan) = self.clan_registry.get_mut(surname) {
                    clan.ledger.debit(*rk, *amt);
                }
                let share = amt / share_count;
                for other in &other_clans {
                    let record = TransferRecord {
                        tick,
                        from: LedgerRef::Clan(surname.to_string()),
                        to: LedgerRef::Clan(other.clone()),
                        resource: *rk,
                        amount: share,
                        reason: TransferReason::Legacy,
                    };
                    if let Some(clan) = self.clan_registry.get_mut(surname) {
                        clan.ledger.push_transfer(record.clone());
                    }
                    if let Some(other_clan) = self.clan_registry.get_mut(other) {
                        other_clan.ledger.credit(*rk, share);
                        other_clan.ledger.push_transfer(record);
                    }
                }
            }
        }

        // WRITE：标记绝嗣 + 记录事件
        self.clan_registry.extinct.insert(surname.to_string());
        if let Some(clan) = self.clan_registry.get_mut(surname) {
            clan.ledger.push_event(tick, format!("⛩️ 宗族【{}】所有男性已亡，转为【绝嗣】状态，族产{}归集", surname, if other_clans.is_empty() { "入公仓兜底".to_string() } else { format!("平分给其他 {} 个宗族", other_clans.len()) }));
        }
        self.last_event = Some(format!("⛩️ 宗族【{}】绝嗣：所有男性已亡，族产{}归集", surname, if other_clans.is_empty() { "入公仓兜底".to_string() } else { format!("平分给其他 {} 个宗族", other_clans.len()) }));
    }

    // ══════════════════════════════════════════════════════════
    // 族税：全局统一时点征收，存续家户 → 族库（Tribute 流水）
    // ══════════════════════════════════════════════════════════

    fn tick_clan_tribute(&mut self, tick: u64) {
        let interval = self.config.clan_tribute_interval_ticks;
        // tick=0 不征收（首次播撒即征无意义）；此后每 interval tick 全局统一征收
        if tick == 0 || tick % interval != 0 {
            return;
        }

        let rate = self.config.clan_tribute_rate;

        // READ PHASE：收集待征税家户（户主姓氏 + 各品类账面余额）
        struct TributeItem {
            hid: HouseholdId,
            surname: String,
            amounts: Vec<(ResourceKind, f32)>,
        }
        let mut items: Vec<TributeItem> = Vec::new();

        for (hid, hh) in &self.household_registry.households {
            if hh.is_dissolved {
                continue;
            }
            // 取户主姓氏
            let Some(head_agent) = self.agent_by_id(hh.head) else {
                continue;
            };
            let surname = head_agent.surname.clone();

            // 宗族必须有族长方可征税（无主宗族账本冻结）
            let clan_has_leader = self
                .clan_registry
                .get(&surname)
                .and_then(|c| c.leader)
                .is_some();
            if !clan_has_leader {
                continue;
            }

            // 每类资源独立计算税额 = 账面余额 × rate
            let amounts: Vec<(ResourceKind, f32)> = RESOURCE_ORDER
                .iter()
                .filter_map(|&rk| {
                    let bal = hh.group.ledger.balance(rk);
                    let amt = bal * rate;
                    if amt > 0.001 {
                        Some((rk, amt))
                    } else {
                        None
                    }
                })
                .collect();

            if !amounts.is_empty() {
                items.push(TributeItem { hid: *hid, surname, amounts });
            }
        }

        // WRITE PHASE：执行族税转移（家户 debit → 族库 credit）
        for item in items {
            for (resource, amount) in item.amounts {
                let record = TransferRecord {
                    tick,
                    from: LedgerRef::Family(item.hid),
                    to: LedgerRef::Clan(item.surname.clone()),
                    resource,
                    amount,
                    reason: TransferReason::Tribute,
                };
                // Debit 家户账本
                if let Some(hh) = self.household_registry.get_mut(item.hid) {
                    hh.group.ledger.debit(resource, amount);
                    hh.group.ledger.push_transfer(record.clone());
                }
                // Credit 族库账本
                if let Some(clan) = self.clan_registry.get_mut(&item.surname) {
                    clan.ledger.credit(resource, amount);
                    clan.ledger.push_transfer(record);
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // 族内互助：族库充足 → 极贫家户（MutualAid 流水）
    // ══════════════════════════════════════════════════════════

    fn tick_clan_mutual_aid(&mut self, tick: u64) {
        let min_balance = self.config.clan_mutual_aid_min_balance;
        let family_threshold = self.config.clan_mutual_aid_family_threshold;
        let cooldown = self.config.clan_mutual_aid_cooldown_ticks;

        // READ PHASE：收集待互助家户
        struct AidItem {
            hid: HouseholdId,
            surname: String,
            amounts: Vec<(ResourceKind, f32)>,
        }
        let mut items: Vec<AidItem> = Vec::new();

        // 按姓氏遍历宗族（BTreeMap 保序）
        for (surname, clan) in &self.clan_registry.clans {
            // 必须有族长才能签发互助（族长签字）
            let Some(_leader_id) = clan.leader else {
                continue;
            };

            // 族库总余额（5 类资源求和）
            let clan_total: f32 = RESOURCE_ORDER
                .iter()
                .map(|&rk| clan.ledger.balance(rk))
                .sum();
            if clan_total <= min_balance {
                continue;
            }

            // 找出本宗族的存续家户（户主属于本宗族）
            let mut clan_households: Vec<HouseholdId> = Vec::new();
            for (hid, hh) in &self.household_registry.households {
                if hh.is_dissolved {
                    continue;
                }
                if self.clan_registry.clan_of(hh.head) == Some(surname) {
                    clan_households.push(*hid);
                }
            }

            // 对每家户判定极贫 + 冷却
            for hid in clan_households {
                // 冷却检查
                if let Some(&last_tick) = self.mutual_aid_cooldown.get(&hid) {
                    if tick - last_tick < cooldown {
                        continue;
                    }
                }

                let Some(hh) = self.household_registry.get(hid) else {
                    continue;
                };
                let water = hh.group.ledger.balance(ResourceKind::Water);
                let food = hh.group.ledger.balance(ResourceKind::Food);
                let total = water + food;
                if total >= family_threshold {
                    continue; // 非极贫
                }

                // 计算互助总额 = min(族库余额 × 0.2, 缺口至 threshold 的 2倍)
                let gap = family_threshold - total;
                let aid_total = (clan_total * 0.2).min(gap * 2.0);
                if aid_total <= 0.001 {
                    continue;
                }

                // 按水/粮缺口比例分配互助额（确定性）
                let water_need = (family_threshold - water).max(0.0);
                let food_need = (family_threshold - food).max(0.0);
                let need_sum = water_need + food_need;
                let (water_share, food_share) = if need_sum > 0.001 {
                    (aid_total * water_need / need_sum, aid_total * food_need / need_sum)
                } else {
                    (aid_total * 0.5, aid_total * 0.5)
                };

                // 实际拨付 = min(计划额, 族库该品类可用余额)
                let mut amounts: Vec<(ResourceKind, f32)> = Vec::new();
                let clan_water_avail = clan.ledger.balance(ResourceKind::Water);
                let clan_food_avail = clan.ledger.balance(ResourceKind::Food);
                let water_actual = water_share.min(clan_water_avail);
                let food_actual = food_share.min(clan_food_avail);
                if water_actual > 0.001 {
                    amounts.push((ResourceKind::Water, water_actual));
                }
                if food_actual > 0.001 {
                    amounts.push((ResourceKind::Food, food_actual));
                }

                if !amounts.is_empty() {
                    items.push(AidItem { hid, surname: surname.clone(), amounts });
                }
            }
        }

        // WRITE PHASE：执行互助转移（族库 debit → 家户 credit）+ 更新冷却
        for item in items {
            for (resource, amount) in item.amounts {
                let record = TransferRecord {
                    tick,
                    from: LedgerRef::Clan(item.surname.clone()),
                    to: LedgerRef::Family(item.hid),
                    resource,
                    amount,
                    reason: TransferReason::MutualAid,
                };
                // Debit 族库账本
                if let Some(clan) = self.clan_registry.get_mut(&item.surname) {
                    clan.ledger.debit(resource, amount);
                    clan.ledger.push_transfer(record.clone());
                }
                // Credit 家户账本
                if let Some(hh) = self.household_registry.get_mut(item.hid) {
                    hh.group.ledger.credit(resource, amount);
                    hh.group.ledger.push_transfer(record);
                }
            }
            // 更新冷却
            self.mutual_aid_cooldown.insert(item.hid, tick);
        }
    }
}
