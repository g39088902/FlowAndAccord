//! ledger · 独立经济账本子系统（账本与仓库重构计划，docs/PLAN_LEDGER_REFACTOR.md）
//!
//! **新旧分离三原则**（改此目录前必读，详见计划文档与局部 AGENTS.md）：
//! 1. 与现有房屋/仓库系统完全分离：不 import house.rs 仓储字段、不改 agent.rs 行囊字段、
//!    不动 ecology.rs 装卸逻辑——物理仓储层继续按原逻辑运转，本模块为制度账本层；
//! 2. 一切账本变动经 [`journal::transfer`] 总线或 Group 单点入口，产出可审计流水；
//! 3. 确定性红线：不消耗 WorldRng、不新增决策相位、所有集合用 BTree 保序。

pub mod clan;
pub mod family;
pub mod group;
pub mod journal;
pub mod marriage;
pub mod region;

pub use clan::ClanRegistry;
pub use family::{Household, HouseholdId, HouseholdRegistry};
pub use group::{Group, GroupKind};
pub use journal::{
    transfer, Ledger, LedgerEvent, LedgerRef, ResourceKind, TransferReason, TransferRecord,
};
pub use marriage::{Marriage, MarriageEndReason, MarriageId, MarriageRegistry};
pub use region::{Regime, Region, RegionRegistry, Succession};
