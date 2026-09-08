//! M19.1 原语描述类型；没有执行器，也不会改变现有物理结算。
use crate::spatial::graph::NodeId;
use crate::spatial::poi::PoiId;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionPrimitive {
    Navigate {
        target: NodeId,
        arrival: ArrivalKind,
    },
    Hold(HoldKind),
    AwaitSettlement,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArrivalKind {
    ResourceSite,
    Residence,
    SocialTarget,
    FoundSite,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldKind {
    ResourceSite(PoiId),
    Residence,
    Repair,
    Upgrade,
    OffRoad,
}
