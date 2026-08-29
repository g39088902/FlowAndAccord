use serde::{Deserialize, Serialize};

/// 3D 空间坐标向量 (X: 横向, Y: 纵向, Z: 高程/立交高度)
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0, z: 0.0 };

    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    pub fn distance_to(&self, other: &Vec3) -> f32 {
        ((self.x - other.x).powi(2) + (self.y - other.y).powi(2) + (self.z - other.z).powi(2)).sqrt()
    }

    pub fn distance_squared_to(&self, other: &Vec3) -> f32 {
        (self.x - other.x).powi(2) + (self.y - other.y).powi(2) + (self.z - other.z).powi(2)
    }

    pub fn horizontal_distance_to(&self, other: &Vec3) -> f32 {
        ((self.x - other.x).powi(2) + (self.y - other.y).powi(2)).sqrt()
    }

    pub fn lerp(a: Vec3, b: Vec3, t: f32) -> Vec3 {
        Vec3 {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: a.z + (b.z - a.z) * t,
        }
    }

    pub fn normalize(&self) -> Vec3 {
        let mag = (self.x * self.x + self.y * self.y + self.z * self.z).sqrt();
        if mag > 1e-6 {
            Vec3::new(self.x / mag, self.y / mag, self.z / mag)
        } else {
            Vec3::ZERO
        }
    }
}
