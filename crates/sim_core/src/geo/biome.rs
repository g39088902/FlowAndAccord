use serde::{Deserialize, Serialize};

/// 栅格空间几何单元 (纯净高程与微观坡度)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoCell {
    pub elevation: f32,          // 真实地表高程 (米)
    pub slope_angle_deg: f32,    // 局部坡度角 (度)
}
