//! journal.rs · 账本内核：统一资源类型、账本存量与可审计流水
//!
//! 隶属「账本与仓库重构」计划（docs/PLAN_LEDGER_REFACTOR.md）M1.1。
//! 设计原则：本模块为**制度账本层**，只记录"归谁、谁付的、谁收的"权责流水，
//! 与物理仓储层（house.rs pantry_* / agent.rs carried_* / ecology.rs POI 储量）完全分离，
//! 不读取、不修改任何物理库存字段。

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

use crate::spatial::agent::AgentId;
use super::family::HouseholdId;

/// 统一资源类型（终结散落字段的抽象口径；M1 仅作账本记账维度，不改物理仓储）
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ResourceKind {
    Water, // 💧 清水
    Food,  // 🍒 食物
    Wood,  // 🌲 木材
    Stone, // 🪨 石料
    Gold,  // 🪙 黄金
}

/// 流水主体引用（账本一方的社会身份）
///
/// M1 仅落地 Personal / Family 两级；Clan（M3 宗族）/ Region（M4 地区）/ Corporate
/// （预留公司）按计划逐期扩展，本枚举即五级产权账本（PLAN.md §3.4）的实例化锚点。
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum LedgerRef {
    /// 🧍 个人私产（逻辑指代随身行囊，不改物理字段）
    Personal(AgentId),
    /// 🏠 家产（登记在**男性户主**的家户下，与房屋解耦）
    Family(HouseholdId),
    /// Void (resource consumed/destroyed, no recipient ledger)
    Void,
    /// 公仓兜底账本（M2 绝嗣家户资产归集，预留 M4 Region 对接）
    PublicGranary,
    /// ⛩️ 族产（M3：按姓氏聚合的宗族账本）
    Clan(String),
    /// 🏛️ 地区公仓（M4：按营地聚合的王国团体账本，领导者=国王）
    Region(u32),
    // 🏢 Corporate(CompanyId) —— 预留：公司资产
}

/// 流水事由（M2-M4 逐期启用；本期仅注册枚举成员保证前向兼容）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferReason {
    /// 采收装袋（个人采得，源头为生态）
    Harvest,
    /// 回家卸货存入（M2 启用）
    Deposit,
    /// 家庭生活消耗（吃喝，M2 启用）
    Consume,
    /// 冬季供暖烧柴（M2 启用）
    Heating,
    /// 施工扣款（开工/竣工，M2 启用）
    Construction,
    /// 修缮工时（M2 启用）
    Maintenance,
    /// 遗产继承（M2 启用）
    Inheritance,
    /// 分家抽资（M2 启用：男子成年/丧父自立门户，从旧家户分走资源）
    Split,
    /// 公仓税（M4 启用）
    Tax,
    /// 族税（M3 启用）
    Tribute,
    /// 灾年救济（M4 启用）
    Relief,
    /// 族内互助（M3 启用）
    MutualAid,
    /// 宗族绝嗣遗产归并（M3 · v1.9.0：绝嗣宗族族产平分给其他宗族 / 入公仓）
    Legacy,
    /// 工资（Corporate 预留）
    Wage,
    /// 分红（Corporate 预留）
    Dividend,
    /// 投资/注资（Corporate 预留）
    Investment,
}

/// 单笔显式交易流水（可审计核心：每笔都写明谁→谁、什么资源、多少、为何）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransferRecord {
    /// 流水发生时的世界 tick（可回溯到精确时刻）
    pub tick: u64,
    /// 付出方主体
    pub from: LedgerRef,
    /// 接收方主体
    pub to: LedgerRef,
    /// 资源品类
    pub resource: ResourceKind,
    /// 数量（正数）
    pub amount: f32,
    /// 事由
    pub reason: TransferReason,
}

/// 非资源类团体事件（成员进出 Membership / 领导更替 Succession 等纯审计记录）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LedgerEvent {
    pub tick: u64,
    pub note: String,
}

/// 单一账本：分品类存量视图 + 双环形流水（资源流水 + 团体事件）
///
/// 账本只记"权责"，与物理库存不强制相等（前端分别标注"账面"与"库存"）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ledger {
    /// 分品类存量（账面余额）
    pub balances: BTreeMap<ResourceKind, f32>,
    /// 资源流水环形缓冲（超容量丢弃最旧，容量由 config.ledger_journal_capacity 控制）
    pub journal: VecDeque<TransferRecord>,
    /// 团体事件环形缓冲（成员/领导变动等）
    pub events: VecDeque<LedgerEvent>,
    journal_capacity: usize,
}

impl Ledger {
    /// 创建空账本（journal_capacity 来自 config.ledger_journal_capacity）
    pub fn new(journal_capacity: usize) -> Self {
        Self {
            balances: BTreeMap::new(),
            journal: VecDeque::new(),
            events: VecDeque::new(),
            journal_capacity: journal_capacity.max(1),
        }
    }

    /// 账面余额（无记录品类返回 0.0）
    pub fn balance(&self, kind: ResourceKind) -> f32 {
        self.balances.get(&kind).copied().unwrap_or(0.0)
    }

    /// 记入增量（记账不约束非负总额——账面允许透支审计口径，物理层不受影响）
    pub fn credit(&mut self, kind: ResourceKind, amount: f32) {
        if amount <= 0.0 {
            return;
        }
        *self.balances.entry(kind).or_insert(0.0) += amount;
    }

    /// 记入减量（余额下限 0.0，防浮点漂移出负账面）
    pub fn debit(&mut self, kind: ResourceKind, amount: f32) {
        if amount <= 0.0 {
            return;
        }
        let entry = self.balances.entry(kind).or_insert(0.0);
        *entry = (*entry - amount).max(0.0);
    }

    /// 追加一笔资源流水（环形缓冲，超容量淘汰最旧）
    pub fn push_transfer(&mut self, record: TransferRecord) {
        if self.journal.len() >= self.journal_capacity {
            self.journal.pop_front();
        }
        self.journal.push_back(record);
    }

    /// 追加一条团体事件（环形缓冲，超容量淘汰最旧）
    pub fn push_event(&mut self, tick: u64, note: impl Into<String>) {
        if self.events.len() >= self.journal_capacity {
            self.events.pop_front();
        }
        self.events.push_back(LedgerEvent { tick, note: note.into() });
    }

    /// 单边消耗记账：debit 资源 + 记录 from -> Void 流水（无接收方账本）
    /// 用于 Consume（生活吃喝）、Heating（冬季烧柴）等资源灭失场景
    pub fn record_consumption(&mut self, from: LedgerRef, resource: ResourceKind, amount: f32, reason: TransferReason, tick: u64) {
        if amount <= 0.0 {
            return;
        }
        self.debit(resource, amount);
        let record = TransferRecord { tick, from, to: LedgerRef::Void, resource, amount, reason };
        self.push_transfer(record);
    }

    /// 只读流水迭代（从旧到新）
    pub fn journal(&self) -> impl Iterator<Item = &TransferRecord> {
        self.journal.iter()
    }

    /// 只读事件迭代（从旧到新）
    pub fn events(&self) -> impl Iterator<Item = &LedgerEvent> {
        self.events.iter()
    }
}

/// 主体间显式转账总线：一笔流水同时写入双方账本，保证两端对账一致
pub fn transfer(
    from_ledger: &mut Ledger,
    to_ledger: &mut Ledger,
    from: LedgerRef,
    to: LedgerRef,
    resource: ResourceKind,
    amount: f32,
    reason: TransferReason,
    tick: u64,
) {
    if amount <= 0.0 {
        return;
    }
    from_ledger.debit(resource, amount);
    to_ledger.credit(resource, amount);
    let record = TransferRecord { tick, from, to, resource, amount, reason };
    from_ledger.push_transfer(record.clone());
    to_ledger.push_transfer(record);
}

