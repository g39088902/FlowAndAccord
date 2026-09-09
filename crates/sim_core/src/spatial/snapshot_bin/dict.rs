//! dict.rs · 快照枚举的「码位 ↔ 名称」字典（M4 二进制快照）
//!
//! 闭集枚举在二进制帧里以 `u8` 码位传输，前端按码位查名称表还原成字符串。
//! **名称表由 Rust 侧 `as_str()` / `Debug` 生成并经 `world_enum_table_*` 导出**，
//! 前端不再硬编码任何枚举名——新增变体只需改本文件，前端自动同步，杜绝前后端漂移。
//!
//! # 不变量的守护方式
//! - `*_code()` 使用**穷尽 `match`**：枚举新增变体时编译直接报错，强制同步本文件；
//! - `*_table()` 用 `as_str()` / 常量数组生成名称，与 JSON 快照的序列化口径一致；
//! - `tools/test-wasm.js` 的「二进制 ≡ JSON 深比较」断言是最终防线，任何口径不一致都会红。

use crate::spatial::agent::{Gender, PrimitiveActionState};
use crate::spatial::graph::{NodeType, RoadClass};
use crate::spatial::house::HouseTier;
use crate::spatial::ledger::{ResourceKind, TransferReason};
use crate::spatial::poi::PoiType;
use crate::spatial::snapshot::Season;
use crate::geo::SurfaceKind;

#[inline]
pub fn surface_kind_code(kind: SurfaceKind) -> u8 {
    match kind {
        SurfaceKind::DryGround => 0,
        SurfaceKind::SoftGround => 1,
        SurfaceKind::ShallowWater => 2,
        SurfaceKind::DeepWater => 3,
        SurfaceKind::RiverBank => 4,
        SurfaceKind::RiverTerrace => 5,
        SurfaceKind::RockFace => 6,
    }
}

#[inline]
pub fn terrain_feature_kind_code(kind: crate::geo::TerrainFeatureKind) -> u8 {
    match kind {
        crate::geo::TerrainFeatureKind::Ridge => 0,
        crate::geo::TerrainFeatureKind::Saddle => 1,
        crate::geo::TerrainFeatureKind::Terrace => 2,
    }
}

pub fn terrain_feature_kind_table() -> Vec<&'static str> {
    [
        crate::geo::TerrainFeatureKind::Ridge,
        crate::geo::TerrainFeatureKind::Saddle,
        crate::geo::TerrainFeatureKind::Terrace,
    ]
    .iter()
    .map(|k| k.as_str())
    .collect()
}

pub fn surface_kind_table() -> Vec<&'static str> {
    [
        SurfaceKind::DryGround,
        SurfaceKind::SoftGround,
        SurfaceKind::ShallowWater,
        SurfaceKind::DeepWater,
        SurfaceKind::RiverBank,
        SurfaceKind::RiverTerrace,
        SurfaceKind::RockFace,
    ]
    .iter()
    .map(|k| k.as_str())
    .collect()
}

// ═══════════════════════════════════════════════════════════════
// 性别 Gender
// ═══════════════════════════════════════════════════════════════

#[inline]
pub fn gender_code(g: Gender) -> u8 {
    match g {
        Gender::Male => 0,
        Gender::Female => 1,
    }
}

pub fn gender_table() -> Vec<&'static str> {
    [Gender::Male, Gender::Female]
        .iter()
        .map(|g| g.as_str())
        .collect()
}

// ═══════════════════════════════════════════════════════════════
// 行为状态 PrimitiveActionState（21 变体）
// ═══════════════════════════════════════════════════════════════

#[inline]
pub fn state_code(s: PrimitiveActionState) -> u8 {
    match s {
        PrimitiveActionState::RestingAtCamp => 0,
        PrimitiveActionState::SeekingWater => 1,
        PrimitiveActionState::SeekingFood => 2,
        PrimitiveActionState::DrinkingAtWater => 3,
        PrimitiveActionState::ForagingFood => 4,
        PrimitiveActionState::SeekingWood => 5,
        PrimitiveActionState::GatheringWood => 6,
        PrimitiveActionState::SeekingStone => 7,
        PrimitiveActionState::MiningStone => 8,
        PrimitiveActionState::SeekingGold => 9,
        PrimitiveActionState::MiningGold => 10,
        PrimitiveActionState::ReturningToCamp => 11,
        PrimitiveActionState::ConstructingHouse => 12,
        PrimitiveActionState::RepairingHouse => 13,
        PrimitiveActionState::OffRoadDetour => 14,
        PrimitiveActionState::SeekingThrone => 15,
        PrimitiveActionState::SeekingMarket => 16,
        PrimitiveActionState::BuyingAtMarket => 17,
        PrimitiveActionState::SeekingCourtship => 18,
        PrimitiveActionState::RaiseChild => 19,
        PrimitiveActionState::Dead => 20,
    }
}

pub fn state_table() -> Vec<&'static str> {
    use PrimitiveActionState as S;
    [
        S::RestingAtCamp,
        S::SeekingWater,
        S::SeekingFood,
        S::DrinkingAtWater,
        S::ForagingFood,
        S::SeekingWood,
        S::GatheringWood,
        S::SeekingStone,
        S::MiningStone,
        S::SeekingGold,
        S::MiningGold,
        S::ReturningToCamp,
        S::ConstructingHouse,
        S::RepairingHouse,
        S::OffRoadDetour,
        S::SeekingThrone,
        S::SeekingMarket,
        S::BuyingAtMarket,
        S::SeekingCourtship,
        S::RaiseChild,
        S::Dead,
    ]
    .iter()
    .map(|s| s.as_str())
    .collect()
}

// ═══════════════════════════════════════════════════════════════
// POI 类型 PoiType（7 变体）
// ═══════════════════════════════════════════════════════════════

#[inline]
pub fn poi_type_code(p: PoiType) -> u8 {
    match p {
        PoiType::Camp => 0,
        PoiType::WaterSource => 1,
        PoiType::BerryBush => 2,
        PoiType::WoodForest => 3,
        PoiType::StoneQuarry => 4,
        PoiType::GoldMine => 5,
        PoiType::Market => 6,
    }
}

pub fn poi_type_table() -> Vec<&'static str> {
    use PoiType as P;
    [
        P::Camp,
        P::WaterSource,
        P::BerryBush,
        P::WoodForest,
        P::StoneQuarry,
        P::GoldMine,
        P::Market,
    ]
    .iter()
    .map(|p| p.as_str())
    .collect()
}

// ═══════════════════════════════════════════════════════════════
// 节点类型 NodeType（5 变体）
// ═══════════════════════════════════════════════════════════════

#[inline]
pub fn node_type_code(n: NodeType) -> u8 {
    match n {
        NodeType::GroundIntersection => 0,
        NodeType::ElevatedOverpass => 1,
        NodeType::TunnelPortal => 2,
        NodeType::CulDeSac => 3,
        NodeType::SecretHideout => 4,
    }
}

pub fn node_type_table() -> Vec<&'static str> {
    use NodeType as N;
    [
        N::GroundIntersection,
        N::ElevatedOverpass,
        N::TunnelPortal,
        N::CulDeSac,
        N::SecretHideout,
    ]
    .iter()
    .map(|n| n.as_str())
    .collect()
}

// ═══════════════════════════════════════════════════════════════
// 道路等级 RoadClass（5 变体）
// ═══════════════════════════════════════════════════════════════

#[inline]
pub fn road_class_code(r: RoadClass) -> u8 {
    match r {
        RoadClass::DirtTrack => 0,
        RoadClass::Cobblestone => 1,
        RoadClass::AsphaltUrban => 2,
        RoadClass::SkywayElevated => 3,
        RoadClass::SmugglerTrail => 4,
    }
}

pub fn road_class_table() -> Vec<&'static str> {
    use RoadClass as R;
    [
        R::DirtTrack,
        R::Cobblestone,
        R::AsphaltUrban,
        R::SkywayElevated,
        R::SmugglerTrail,
    ]
    .iter()
    .map(|r| r.as_str())
    .collect()
}

// ═══════════════════════════════════════════════════════════════
// 房屋等级 HouseTier（5 变体）
// ═══════════════════════════════════════════════════════════════

#[inline]
pub fn house_tier_code(t: HouseTier) -> u8 {
    match t {
        HouseTier::Tier0Warehouse => 0,
        HouseTier::Tier1ThatchedHut => 1,
        HouseTier::Tier2LeanTo => 2,
        HouseTier::Tier3Homestead => 3,
        HouseTier::Tier4Manor => 4,
    }
}

pub fn house_tier_table() -> Vec<&'static str> {
    use HouseTier as T;
    [
        T::Tier0Warehouse,
        T::Tier1ThatchedHut,
        T::Tier2LeanTo,
        T::Tier3Homestead,
        T::Tier4Manor,
    ]
    .iter()
    .map(|t| t.as_str())
    .collect()
}

// ═══════════════════════════════════════════════════════════════
// 资源品类 ResourceKind（5 变体）
//
// ⚠ JSON 快照用 `format!("{:?}", rk)` 序列化，故名称表必须与 `Debug` 输出逐字一致。
// ═══════════════════════════════════════════════════════════════

#[inline]
pub fn resource_kind_code(r: ResourceKind) -> u8 {
    match r {
        ResourceKind::Water => 0,
        ResourceKind::Food => 1,
        ResourceKind::Wood => 2,
        ResourceKind::Stone => 3,
        ResourceKind::Gold => 4,
    }
}

/// 与 `ResourceKind` 枚举序**严格一致**的固定顺序（账本余额按此序平铺 5×f32）
pub const RESOURCE_KIND_ORDER: [ResourceKind; 5] = [
    ResourceKind::Water,
    ResourceKind::Food,
    ResourceKind::Wood,
    ResourceKind::Stone,
    ResourceKind::Gold,
];

pub fn resource_kind_table() -> Vec<&'static str> {
    RESOURCE_KIND_ORDER
        .iter()
        .map(|r| format!("{:?}", r))
        .collect::<Vec<_>>()
        .into_iter()
        .map(|s| Box::leak(s.into_boxed_str()) as &'static str)
        .collect()
}

// ═══════════════════════════════════════════════════════════════
// 四季 Season（4 变体）
//
// ⚠ JSON 快照用 `world_snapshot.rs` 的 match 输出 "Spring" 等字面量。
// ═══════════════════════════════════════════════════════════════

#[inline]
pub fn season_code(s: Season) -> u8 {
    match s {
        Season::Spring => 0,
        Season::Summer => 1,
        Season::Autumn => 2,
        Season::Winter => 3,
    }
}

pub fn season_table() -> Vec<&'static str> {
    vec!["Spring", "Summer", "Autumn", "Winter"]
}

// ═══════════════════════════════════════════════════════════════
// 家户角色 HouseholdRole（4 种）
//
// 由 `world_snapshot.rs` 就地推导，非独立枚举；顺序固定为 None/Head/Spouse/Child。
// ═══════════════════════════════════════════════════════════════

pub const ROLE_NONE: u8 = 0;
pub const ROLE_HEAD: u8 = 1;
pub const ROLE_SPOUSE: u8 = 2;
pub const ROLE_CHILD: u8 = 3;

pub fn household_role_table() -> Vec<&'static str> {
    vec!["None", "Head", "Spouse", "Child"]
}

// ═══════════════════════════════════════════════════════════════
// 流水事由 TransferReason（22 变体）
//
// ⚠ JSON 快照用 `format!("{:?}", r)` 序列化，名称为变体名本身。
// ═══════════════════════════════════════════════════════════════

#[inline]
pub fn transfer_reason_code(r: TransferReason) -> u8 {
    use TransferReason as T;
    match r {
        T::Harvest => 0,
        T::Deposit => 1,
        T::Consume => 2,
        T::Heating => 3,
        T::Construction => 4,
        T::Maintenance => 5,
        T::Inheritance => 6,
        T::Split => 7,
        T::Tax => 8,
        T::Tribute => 9,
        T::Relief => 10,
        T::MutualAid => 11,
        T::Legacy => 12,
        T::Wage => 13,
        T::Dividend => 14,
        T::Investment => 15,
        T::Market => 16,
        T::HousingPurchase => 17,
        T::EstateShare => 18,
        T::TransferTax => 19,
        T::RoyalPrivy => 20,
        T::ImperialPrivy => 21,
    }
}

pub fn transfer_reason_table() -> Vec<&'static str> {
    use TransferReason as T;
    [
        T::Harvest,
        T::Deposit,
        T::Consume,
        T::Heating,
        T::Construction,
        T::Maintenance,
        T::Inheritance,
        T::Split,
        T::Tax,
        T::Tribute,
        T::Relief,
        T::MutualAid,
        T::Legacy,
        T::Wage,
        T::Dividend,
        T::Investment,
        T::Market,
        T::HousingPurchase,
        T::EstateShare,
        T::TransferTax,
        T::RoyalPrivy,
        T::ImperialPrivy,
    ]
    .iter()
    .map(|r| format!("{:?}", r))
    .collect::<Vec<_>>()
    .into_iter()
    .map(|s| Box::leak(s.into_boxed_str()) as &'static str)
    .collect()
}

// ═══════════════════════════════════════════════════════════════
// 枚举名称表总装（经 world_enum_table_ptr/len 以 JSON 下发前端）
// ═══════════════════════════════════════════════════════════════

/// 生成全部枚举名称表 JSON。
///
/// 仅在世界初始化时由前端取一次；返回的字符串由 `sim_wasm` 缓存进静态缓冲。
/// 键名与 `frontend/js/snapshot-bin.js::setEnumTables()` 一一对应。
pub fn enum_table_json() -> String {
    let mut out = String::with_capacity(2048);
    out.push('{');
    push_arr(&mut out, "surfaceKind", &surface_kind_table(), true);
    push_arr(&mut out, "terrainFeatureKind", &terrain_feature_kind_table(), false);
    push_arr(&mut out, "gender", &gender_table(), false);
    push_arr(&mut out, "state", &state_table(), false);
    push_arr(&mut out, "poiType", &poi_type_table(), false);
    push_arr(&mut out, "nodeType", &node_type_table(), false);
    push_arr(&mut out, "roadClass", &road_class_table(), false);
    push_arr(&mut out, "houseTier", &house_tier_table(), false);
    push_arr(&mut out, "resourceKind", &resource_kind_table(), false);
    push_arr(&mut out, "season", &season_table(), false);
    push_arr(&mut out, "householdRole", &household_role_table(), false);
    push_arr(&mut out, "transferReason", &transfer_reason_table(), false);
    out.push('}');
    out
}

fn push_arr(out: &mut String, key: &str, items: &[&str], first: bool) {
    if !first {
        out.push(',');
    }
    out.push('"');
    out.push_str(key);
    out.push_str("\":[");
    for (i, s) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('"');
        push_json_escaped(out, s);
        out.push('"');
    }
    out.push(']');
}

fn push_json_escaped(out: &mut String, s: &str) {
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
}
