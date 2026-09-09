use serde::{Deserialize, Serialize};

/// T0/T1 地表类别。枚举只表达内核事实；渲染材质由前端派生。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SurfaceKind {
    DryGround,
    SoftGround,
    ShallowWater,
    DeepWater,
    RiverBank,
    RiverTerrace,
    RockFace,
}

impl SurfaceKind {
    #[inline]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DryGround => "DryGround",
            Self::SoftGround => "SoftGround",
            Self::ShallowWater => "ShallowWater",
            Self::DeepWater => "DeepWater",
            Self::RiverBank => "RiverBank",
            Self::RiverTerrace => "RiverTerrace",
            Self::RockFace => "RockFace",
        }
    }

    #[inline]
    pub const fn is_hard_blocked(self) -> bool {
        matches!(self, Self::DeepWater | Self::RockFace)
    }
}

/// 地表事实标志。不要用标志替代坡度、宽度等数值约束。
pub const TERRAIN_FLAG_NO_BUILD: u16 = 1 << 0;
pub const TERRAIN_FLAG_NO_WALK: u16 = 1 << 1;
pub const TERRAIN_FLAG_SHORE_ACCESS: u16 = 1 << 2;
pub const TERRAIN_FLAG_CROSSING_CANDIDATE: u16 = 1 << 3;

/// 栅格空间几何单元：高程、坡度与可消费的静态地表事实。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoCell {
    pub elevation: f32,       // 真实地表高程 (米)
    pub slope_angle_deg: f32, // 局部坡度角 (度)
    #[serde(default)]
    pub surface_kind: SurfaceKind,
    #[serde(default)]
    pub natural_fertility: f32,
    #[serde(default)]
    pub water_body_id: Option<u32>,
    #[serde(default)]
    pub feature_flags: u16,
}

impl Default for SurfaceKind {
    fn default() -> Self {
        Self::DryGround
    }
}
