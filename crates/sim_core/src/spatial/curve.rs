use serde::{Deserialize, Serialize};
use super::vec3::Vec3;

/// 3D 三次贝塞尔曲线车道几何体（支持高架匝道、爬坡与复杂立体弯道）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Curve3D {
    pub p0: Vec3,       // 起点 (From Node)
    pub p1: Vec3,       // 起点切向控制点
    pub p2: Vec3,       // 终点切向控制点
    pub p3: Vec3,       // 终点 (To Node)
    pub length: f32,    // 预计算的积分弧长 (米)
}

impl Curve3D {
    /// 构造直线车道
    pub fn new_straight(p0: Vec3, p3: Vec3) -> Self {
        let p1 = Vec3::lerp(p0, p3, 0.333333);
        let p2 = Vec3::lerp(p0, p3, 0.666667);
        let length = p0.distance_to(&p3);
        Self { p0, p1, p2, p3, length }
    }

    /// 构造带曲率与高度梯度的 3D 贝塞尔车道
    pub fn new_bezier(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3) -> Self {
        let mut curve = Self { p0, p1, p2, p3, length: 0.0 };
        curve.length = curve.calculate_arc_length(16);
        curve
    }

    /// 高斯数值分段采样计算三维曲线弧长
    pub fn calculate_arc_length(&self, segments: usize) -> f32 {
        let mut total_len = 0.0;
        let mut prev_pt = self.evaluate_pos(0.0);
        for i in 1..=segments {
            let t = i as f32 / segments as f32;
            let current_pt = self.evaluate_pos(t);
            total_len += prev_pt.distance_to(&current_pt);
            prev_pt = current_pt;
        }
        total_len.max(0.001)
    }

    /// 根据归一化参数 t ∈ [0.0, 1.0] 计算 3D 空间坐标
    pub fn evaluate_pos(&self, t: f32) -> Vec3 {
        let t = t.clamp(0.0, 1.0);
        let u = 1.0 - t;
        let tt = t * t;
        let uu = u * u;
        let uuu = uu * u;
        let ttt = tt * t;

        Vec3 {
            x: uuu * self.p0.x + 3.0 * uu * t * self.p1.x + 3.0 * u * tt * self.p2.x + ttt * self.p3.x,
            y: uuu * self.p0.y + 3.0 * uu * t * self.p1.y + 3.0 * u * tt * self.p2.y + ttt * self.p3.y,
            z: uuu * self.p0.z + 3.0 * uu * t * self.p1.z + 3.0 * u * tt * self.p2.z + ttt * self.p3.z,
        }
    }

    /// 计算在 t 处的 3D 归一化切线向量（用于计算 Agent 的朝向与俯仰角）
    pub fn evaluate_tangent(&self, t: f32) -> Vec3 {
        let t = t.clamp(0.0, 1.0);
        let u = 1.0 - t;
        let d_x = 3.0 * u * u * (self.p1.x - self.p0.x) + 6.0 * u * t * (self.p2.x - self.p1.x) + 3.0 * t * t * (self.p3.x - self.p2.x);
        let d_y = 3.0 * u * u * (self.p1.y - self.p0.y) + 6.0 * u * t * (self.p2.y - self.p1.y) + 3.0 * t * t * (self.p3.y - self.p2.y);
        let d_z = 3.0 * u * u * (self.p1.z - self.p0.z) + 6.0 * u * t * (self.p2.z - self.p1.z) + 3.0 * t * t * (self.p3.z - self.p2.z);
        let mag = (d_x * d_x + d_y * d_y + d_z * d_z).sqrt().max(1e-6);
        Vec3::new(d_x / mag, d_y / mag, d_z / mag)
    }
}
