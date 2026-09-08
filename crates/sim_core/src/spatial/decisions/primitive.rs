//! M19 原语描述类型；ActionPrimitive 描述当前行动原语并投射兼容状态。
use crate::spatial::graph::NodeId;
use crate::spatial::poi::PoiId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActionPrimitive {
    Navigate {
        target: NodeId,
        arrival: ArrivalKind,
    },
    Hold(HoldKind),
    AwaitSettlement,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArrivalKind {
    ResourceSite,
    Residence,
    SocialTarget,
    FoundSite,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HoldKind {
    ResourceSite(PoiId),
    Residence,
    Repair,
    Upgrade,
    OffRoad,
}
