//! Multi-layer query contracts used by the future voxel backend.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolidInterval {
    pub z_min: f32,
    pub z_max: f32,
    pub material: u8,
    pub walkable: bool,
}
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SurfaceHit {
    pub z: f32,
    pub material: u8,
    pub layer: u16,
}
pub trait LayeredTerrainQuery {
    fn solid_intervals(&self, x: f32, y: f32) -> Vec<SolidInterval>;
    fn surface_at(&self, x: f32, y: f32, layer: u16) -> Option<SurfaceHit>;
}
