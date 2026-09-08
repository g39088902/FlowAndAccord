//! projection.rs · 执行状态到旧枚举与兼容视图的纯函数映射
//! 严格遵循技术规格书 §6.2 合法组合与兼容视图矩阵。

use crate::spatial::agent::PrimitiveActionState;
use super::strategy::{ActiveTask, ExecutionStrategy, ResourceStage, ReturnStage};
use super::primitive::{ActionPrimitive, HoldKind};
use super::NodePool;

/// 技术规格书 §6.2 兼容视图纯函数投影；穷尽映射，不使用休息态盲目兜底
pub fn compatible_legacy_state(task: &ActiveTask) -> PrimitiveActionState {
    use PrimitiveActionState as S;
    // 1. 优先检查路线失效原语
    if let ActionPrimitive::Hold(HoldKind::OffRoad) = task.primitive {
        return S::OffRoadDetour;
    }
    match &task.strategy {
        ExecutionStrategy::WildHarvest { pool, stage, .. } => {
            match stage {
                ResourceStage::Outbound => match pool {
                    NodePool::Water => S::SeekingWater,
                    NodePool::Food => S::SeekingFood,
                    NodePool::Wood => S::SeekingWood,
                    NodePool::Stone => S::SeekingStone,
                    NodePool::Gold => S::SeekingGold,
                },
                ResourceStage::OnSite => match pool {
                    NodePool::Water => S::DrinkingAtWater,
                    NodePool::Food => S::ForagingFood,
                    NodePool::Wood => S::GatheringWood,
                    NodePool::Stone => S::MiningStone,
                    NodePool::Gold => S::MiningGold,
                },
                ResourceStage::Returning => S::ReturningToCamp,
                ResourceStage::Unloading => S::RestingAtCamp,
            }
        }
        ExecutionStrategy::MarketTrade { stage, .. } => {
            match stage {
                ResourceStage::Outbound => S::SeekingMarket,
                ResourceStage::OnSite => S::BuyingAtMarket,
                ResourceStage::Returning => S::ReturningToCamp,
                ResourceStage::Unloading => S::RestingAtCamp,
            }
        }
        ExecutionStrategy::ReturnToResidence { stage, .. } => {
            match stage {
                ReturnStage::Travelling => S::ReturningToCamp,
                ReturnStage::Recovering => S::RestingAtCamp,
            }
        }
        ExecutionStrategy::Courtship { .. } => S::SeekingCourtship,
        ExecutionStrategy::ClaimThrone { .. } => S::SeekingThrone,
        ExecutionStrategy::Childcare { .. } => S::RaiseChild,
        ExecutionStrategy::FoundHome { .. } => S::RestingAtCamp,
        ExecutionStrategy::UpgradeHome { .. } => S::ConstructingHouse,
        ExecutionStrategy::RepairHome { .. } => S::RepairingHouse,
    }
}
