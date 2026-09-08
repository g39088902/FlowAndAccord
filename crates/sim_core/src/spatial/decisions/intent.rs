//! M19.1 领域词汇与已知分支结果的只读转换；不评估分支、不选择任务。
//! 来源只能由实际调用方提供，不能从 state/current_need 反推。
use super::{BranchId, MaslowLevel, Need, NeedKind};
use crate::spatial::house::HouseTier;
use crate::spatial::ledger::journal::ResourceKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SurvivalResource {
    Water,
    Food,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoldPurpose {
    BuildingReserve,
    Wealth,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentKind {
    SatisfySurvival(SurvivalResource),
    StockHousehold(ResourceKind),
    AcquireGold(GoldPurpose),
    EmergencySupply,
    RestAndRecover,
    RepairHome,
    UpgradeHome { target_tier: HouseTier },
    FoundNewHome,
    SeekCourtship,
    ClaimThrone,
    RaiseChild,
}

/// 判据的类型名称，不在观察路径重新检查是否完成或锁存配置阈值。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompletionPolicy {
    SurvivalSatisfied(SurvivalResource),
    HouseholdStockSatisfied(ResourceKind),
    GoldTripFinished(GoldPurpose),
    EmergencySupplyFinished,
    RecoveryFinished,
    HomeRepaired,
    HomeAtTier(HouseTier),
    HomeFounded,
    MarriageRegistered,
    CoronationRegistered,
    ChildcareSettled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentIntent {
    pub source_branch: BranchId,
    pub level: MaslowLevel,
    pub kind: IntentKind,
    pub completion: CompletionPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmissionKind {
    Courtship,
    AuctionBids,
    RaiseChild,
}

/// b17 即使被覆盖为常规层也只提交；不生成占位持续任务。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentObservation {
    Sustained(AgentIntent),
    Submission {
        source_branch: BranchId,
        level: MaslowLevel,
        kind: SubmissionKind,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentObservationError {
    BranchKindMismatch,
    NonInstantBranch,
    MissingHomeTier,
    InvalidUpgradeTier,
}

impl Need {
    /// 转换已经产生（并已应用层级覆盖）的 Need，不再调用 evaluate。
    /// home_tier 仅升级需要，必须是该次评估时的家宅等级，不是事后等级。
    pub fn observe_intent(
        &self,
        source_branch: BranchId,
        home_tier: Option<HouseTier>,
    ) -> Result<IntentObservation, IntentObservationError> {
        use BranchId::*;
        use CompletionPolicy as C;
        use IntentKind as I;
        use IntentObservationError as E;
        let expected = match source_branch {
            B1QuenchThirst => NeedKind::QuenchThirst,
            B2SateHunger => NeedKind::SateHunger,
            B3Rest => NeedKind::Rest,
            B4RepairHouse => NeedKind::RepairHouse,
            B5StockWater => NeedKind::StockWater,
            B6StockFood => NeedKind::StockFood,
            B7StockWood => NeedKind::StockWood,
            B8BuildHouseTier0 | B11BuildHouseUpgrade => NeedKind::BuildHouse,
            B9StockStone => NeedKind::StockStone,
            B10StockGold => NeedKind::StockGold,
            B12FoundHome => NeedKind::FoundHome,
            B13GoldWealth => NeedKind::GoldWealth,
            B14SeekThrone => NeedKind::SeekThrone,
            B15MarketTrade => NeedKind::MarketTrade,
            B16Courtship => NeedKind::Courtship,
            B17BidHouse => NeedKind::BidHouse,
            B18RaiseChild => NeedKind::RaiseChild,
        };
        if self.kind != expected {
            return Err(E::BranchKindMismatch);
        }
        if self.is_instant() && !source_branch.is_instant() {
            return Err(E::NonInstantBranch);
        }
        let submission = match source_branch {
            B16Courtship if self.is_instant() => Some(SubmissionKind::Courtship),
            B17BidHouse => Some(SubmissionKind::AuctionBids),
            B18RaiseChild if self.is_instant() => Some(SubmissionKind::RaiseChild),
            _ => None,
        };
        if let Some(kind) = submission {
            return Ok(IntentObservation::Submission {
                source_branch,
                level: self.level,
                kind,
            });
        }
        let (kind, completion) = match source_branch {
            B1QuenchThirst => (
                I::SatisfySurvival(SurvivalResource::Water),
                C::SurvivalSatisfied(SurvivalResource::Water),
            ),
            B2SateHunger => (
                I::SatisfySurvival(SurvivalResource::Food),
                C::SurvivalSatisfied(SurvivalResource::Food),
            ),
            B3Rest => (I::RestAndRecover, C::RecoveryFinished),
            B4RepairHouse => (I::RepairHome, C::HomeRepaired),
            B5StockWater => (
                I::StockHousehold(ResourceKind::Water),
                C::HouseholdStockSatisfied(ResourceKind::Water),
            ),
            B6StockFood => (
                I::StockHousehold(ResourceKind::Food),
                C::HouseholdStockSatisfied(ResourceKind::Food),
            ),
            B7StockWood => (
                I::StockHousehold(ResourceKind::Wood),
                C::HouseholdStockSatisfied(ResourceKind::Wood),
            ),
            B9StockStone => (
                I::StockHousehold(ResourceKind::Stone),
                C::HouseholdStockSatisfied(ResourceKind::Stone),
            ),
            B10StockGold => (
                I::AcquireGold(GoldPurpose::BuildingReserve),
                C::GoldTripFinished(GoldPurpose::BuildingReserve),
            ),
            B13GoldWealth => (
                I::AcquireGold(GoldPurpose::Wealth),
                C::GoldTripFinished(GoldPurpose::Wealth),
            ),
            B8BuildHouseTier0 | B11BuildHouseUpgrade => {
                let tier = home_tier.ok_or(E::MissingHomeTier)?;
                if source_branch == B8BuildHouseTier0 && tier != HouseTier::Tier0Warehouse {
                    return Err(E::InvalidUpgradeTier);
                }
                let target_tier = match tier {
                    HouseTier::Tier0Warehouse => HouseTier::Tier1ThatchedHut,
                    HouseTier::Tier1ThatchedHut => HouseTier::Tier2LeanTo,
                    HouseTier::Tier2LeanTo => HouseTier::Tier3Homestead,
                    HouseTier::Tier3Homestead => HouseTier::Tier4Manor,
                    HouseTier::Tier4Manor => return Err(E::InvalidUpgradeTier),
                };
                (I::UpgradeHome { target_tier }, C::HomeAtTier(target_tier))
            }
            B12FoundHome => (I::FoundNewHome, C::HomeFounded),
            B14SeekThrone => (I::ClaimThrone, C::CoronationRegistered),
            B15MarketTrade => (I::EmergencySupply, C::EmergencySupplyFinished),
            B16Courtship => (I::SeekCourtship, C::MarriageRegistered),
            B18RaiseChild => (I::RaiseChild, C::ChildcareSettled),
            B17BidHouse => unreachable!("auction submission handled above"),
        };
        Ok(IntentObservation::Sustained(AgentIntent {
            source_branch,
            level: self.level,
            kind,
            completion,
        }))
    }
}
