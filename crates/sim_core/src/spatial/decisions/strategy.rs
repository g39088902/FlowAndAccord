//! M19 策略与阶段的领域词汇；ActiveTask 挂载于 Agent3D 作为持续任务唯一真相源。
use serde::{Deserialize, Serialize};
use super::intent::AgentIntent;
use super::primitive::ActionPrimitive;
use super::NodePool;
use crate::spatial::agent::AgentId;
use crate::spatial::graph::NodeId;
use crate::spatial::house::HouseTier;
use crate::spatial::poi::PoiId;
use crate::spatial::vec3::Vec3;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ActiveTask {
    pub intent: AgentIntent,
    pub strategy: ExecutionStrategy,
    pub primitive: ActionPrimitive,
}
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum ExecutionStrategy {
    WildHarvest {
        pool: NodePool,
        poi: Option<PoiId>,
        stage: ResourceStage,
    },
    MarketTrade {
        market: PoiId,
        stage: ResourceStage,
    },
    ReturnToResidence {
        destination: ResidenceTarget,
        stage: ReturnStage,
    },
    Courtship {
        female: AgentId,
        stage: CommitStage,
    },
    ClaimThrone {
        camp: u32,
        stage: CommitStage,
    },
    Childcare {
        house: u32,
        stage: CommitStage,
    },
    FoundHome {
        site: Vec3,
        route_target: NodeId,
        stage: CommitStage,
    },
    UpgradeHome {
        house: u32,
        target_tier: HouseTier,
        stage: HomeStage,
    },
    RepairHome {
        house: u32,
        stage: HomeStage,
    },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResourceStage {
    Outbound,
    OnSite,
    Returning,
    Unloading,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReturnStage {
    Travelling,
    Recovering,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CommitStage {
    Travelling,
    Ready,
    AwaitingSettlement,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HomeStage {
    Returning,
    Working,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResidenceTarget {
    House(u32),
    Camp(NodeId),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StrategyFailureReason {
    TargetPoiClosed,
    NoAvailablePoi,
    NoEligibleSocialTarget,
    Unreachable,
    InsufficientFunds,
    StaminaRestricted,
    ResidenceInvalid,
    HouseholdInvalid,
    SubmissionRejected,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StrategyFeasibility {
    Applicable,
    NotApplicable,
    Blocked(StrategyFailureReason),
}
