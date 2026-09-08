//! M19.1 按需、无分配的执行观察。只借用旧字段，不重跑决策或构造虚假的 ActiveTask。
//! legacy state 没有保留来源分支/返家前策略，故观察结果刻意不提供推测的 intent。
use super::NodePool;
use crate::spatial::agent::{Agent3D, AgentId, PrimitiveActionState};
use crate::spatial::graph::{LaneId, NodeId};
use crate::spatial::vec3::Vec3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleObservation {
    Alive,
    Fetus,
    Dead,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SitePhase {
    Travelling,
    OnSite,
}

/// 仅分解实际 state，不能将 RestingAtCamp 擅自解释成“正在休息/已卸完”。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityObservation {
    RestingAtCamp,
    WildHarvest { pool: NodePool, phase: SitePhase },
    MarketTrade(SitePhase),
    ReturningToCamp,
    ConstructingHouse,
    RepairingHouse,
    OffRoadDetour,
    SeekingThrone,
    SeekingCourtship,
    RaiseChild,
    Dead,
}

impl ActivityObservation {
    pub fn from_legacy(state: PrimitiveActionState) -> Self {
        use PrimitiveActionState as S;
        use SitePhase::{OnSite, Travelling};
        match state {
            S::RestingAtCamp => Self::RestingAtCamp,
            S::SeekingWater => Self::WildHarvest {
                pool: NodePool::Water,
                phase: Travelling,
            },
            S::DrinkingAtWater => Self::WildHarvest {
                pool: NodePool::Water,
                phase: OnSite,
            },
            S::SeekingFood => Self::WildHarvest {
                pool: NodePool::Food,
                phase: Travelling,
            },
            S::ForagingFood => Self::WildHarvest {
                pool: NodePool::Food,
                phase: OnSite,
            },
            S::SeekingWood => Self::WildHarvest {
                pool: NodePool::Wood,
                phase: Travelling,
            },
            S::GatheringWood => Self::WildHarvest {
                pool: NodePool::Wood,
                phase: OnSite,
            },
            S::SeekingStone => Self::WildHarvest {
                pool: NodePool::Stone,
                phase: Travelling,
            },
            S::MiningStone => Self::WildHarvest {
                pool: NodePool::Stone,
                phase: OnSite,
            },
            S::SeekingGold => Self::WildHarvest {
                pool: NodePool::Gold,
                phase: Travelling,
            },
            S::MiningGold => Self::WildHarvest {
                pool: NodePool::Gold,
                phase: OnSite,
            },
            S::SeekingMarket => Self::MarketTrade(Travelling),
            S::BuyingAtMarket => Self::MarketTrade(OnSite),
            S::ReturningToCamp => Self::ReturningToCamp,
            S::ConstructingHouse => Self::ConstructingHouse,
            S::RepairingHouse => Self::RepairingHouse,
            S::OffRoadDetour => Self::OffRoadDetour,
            S::SeekingThrone => Self::SeekingThrone,
            S::SeekingCourtship => Self::SeekingCourtship,
            S::RaiseChild => Self::RaiseChild,
            S::Dead => Self::Dead,
        }
    }

    /// 无副作用兼容投影；穷尽匹配，不用休息态兜底，不修改 Agent。
    pub fn legacy_state(self) -> PrimitiveActionState {
        use PrimitiveActionState as S;
        use SitePhase::{OnSite, Travelling};
        match self {
            Self::RestingAtCamp => S::RestingAtCamp,
            Self::WildHarvest { pool, phase } => match (pool, phase) {
                (NodePool::Water, Travelling) => S::SeekingWater,
                (NodePool::Water, OnSite) => S::DrinkingAtWater,
                (NodePool::Food, Travelling) => S::SeekingFood,
                (NodePool::Food, OnSite) => S::ForagingFood,
                (NodePool::Wood, Travelling) => S::SeekingWood,
                (NodePool::Wood, OnSite) => S::GatheringWood,
                (NodePool::Stone, Travelling) => S::SeekingStone,
                (NodePool::Stone, OnSite) => S::MiningStone,
                (NodePool::Gold, Travelling) => S::SeekingGold,
                (NodePool::Gold, OnSite) => S::MiningGold,
            },
            Self::MarketTrade(Travelling) => S::SeekingMarket,
            Self::MarketTrade(OnSite) => S::BuyingAtMarket,
            Self::ReturningToCamp => S::ReturningToCamp,
            Self::ConstructingHouse => S::ConstructingHouse,
            Self::RepairingHouse => S::RepairingHouse,
            Self::OffRoadDetour => S::OffRoadDetour,
            Self::SeekingThrone => S::SeekingThrone,
            Self::SeekingCourtship => S::SeekingCourtship,
            Self::RaiseChild => S::RaiseChild,
            Self::Dead => S::Dead,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MotionObservation<'a> {
    pub lane: Option<LaneId>,
    pub target_node: Option<NodeId>,
    pub position: Vec3,
    pub distance_along_curve: f32,
    pub velocity: f32,
    pub route: &'a [LaneId],
    pub route_index: usize,
}

/// 同一时点可以有多项 pending；借用竞拍集合，不截断、不复制、不消费。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PendingObservation<'a> {
    pub courtship: Option<AgentId>,
    pub coronation: Option<u32>,
    pub childcare: bool,
    pub auction_houses: &'a [u32],
    pub auction_upgrade: bool,
    pub home_site: Option<Vec3>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ExecutionObservation<'a> {
    pub lifecycle: LifecycleObservation,
    pub activity: ActivityObservation,
    pub motion: MotionObservation<'a>,
    pub pending: PendingObservation<'a>,
    pub home_house: Option<u32>,
    pub home_node: NodeId,
    pub courtship_target: Option<AgentId>,
    pub expedition_target: Option<u32>,
    /// 仅原样借用标签，不把它当成来源分支证据。
    pub label: Option<&'a str>,
}

impl Agent3D {
    /// 随时读取当前事实：无需更新缓存，不入档，不耗 RNG，不访问路网。
    /// lifecycle 与原始 motion 分开保留：尸骸可能仍带旧路线，不能视为可行动。
    pub fn observe_execution(&self) -> ExecutionObservation<'_> {
        ExecutionObservation {
            lifecycle: if !self.is_alive {
                LifecycleObservation::Dead
            } else if self.is_fetus {
                LifecycleObservation::Fetus
            } else {
                LifecycleObservation::Alive
            },
            activity: ActivityObservation::from_legacy(self.state),
            motion: MotionObservation {
                lane: self.current_lane_id,
                target_node: self.target_poi_node,
                position: self.world_pos,
                distance_along_curve: self.distance_along_curve,
                velocity: self.current_velocity,
                route: &self.route,
                route_index: self.route_index,
            },
            pending: PendingObservation {
                courtship: self.courtship_pending,
                coronation: self.coronation_pending,
                childcare: self.raise_child_pending,
                auction_houses: &self.pending_bid_house_ids,
                auction_upgrade: self.pending_bid_upgrade,
                home_site: self.pending_house_pos,
            },
            home_house: self.home_house_id,
            home_node: self.home_camp_node,
            courtship_target: self.courtship_target_id,
            expedition_target: self.expedition_target_camp,
            label: self.current_need.as_deref(),
        }
    }
}
