//! static_water.rs · TB-03 静水几何共用规划（盆地泉池 / 湖畔大湖）。
//!
//! 负责静水闭合水域的几何事实（TB-03-IMPLEMENTATION-PLAN §7）：
//! 1. 闭合轮廓多边形：有限低频径向扰动椭圆，首点重复闭合、限制凹度（无岛屿）；
//! 2. 水面高程 = 干岸参考 − 固定差（水平水面，静水语义：零流向、connections 为空）；
//! 3. cells 涂写：轮廓内格 `DeepWater` + `water_body_id` + NO_WALK|NO_BUILD，
//!    水下高程按池床/湖床剖面强制下凹（与轮廓同源）；
//! 4. 取水岸点：定位于真实干地（岸环/退距内），`WaterAccessPoint ↔ 水体 #1 ↔ 池 #1`
//!    显式绑定（id 固定按候选槽位分配）。
//!
//! 水量由 World 的共享池维护（`prepare_terrain_layout` 一次建立总池，岸点只镜像），
//! 几何不随库存变化；轮廓双副本（`WaterBody.vertices` ↔ `TerrainFeature #1`）逐字节一致。

use super::biome::*;
use super::hydrology::{WaterAccessPoint, WaterBody};
use super::terrain::{TerrainFeature, TerrainFeatureKind, TerrainMap};
use crate::config::SimConfig;
use crate::spatial::vec3::Vec3;

/// 静水计划：一次规划、多处消费（cells 涂写 / 特征与水体登记 / 门禁）。
#[derive(Debug, Clone)]
pub struct StaticWaterPlan {
    /// 水体 id（恒为 1；同世界不得冲突）
    pub water_body_id: u32,
    /// 水平水面高程（米）
    pub level: f32,
    /// 闭合轮廓顶点（末点 = 首点；`WaterBody.vertices` 与 `TerrainFeature #1` 双副本）
    pub outline: Vec<Vec3>,
    /// 水域中心（世界坐标）
    pub center_x: f32,
    pub center_y: f32,
    /// 岸环/安全退距宽度（米，轮廓外 NO_BUILD 干燥带）
    pub shore_ring_m: f32,
    /// 取水岸点（世界坐标；槽位序即稳定 id 序）
    pub access_points: Vec<(f32, f32)>,
}

/// 闭合扰动椭圆轮廓：N 等分角 + 2 谐波径向扰动，末点重复首点。
///
/// `warp` 为相对扰动幅度（|warp1|+|warp2| < 0.2 保证半径恒正、无凹颈/岛屿）。
/// 角度按固定升序遍历（确定性；不依赖 HashMap 等无序容器）。
pub fn build_closed_ellipse_outline(
    cx: f32,
    cy: f32,
    a: f32,
    b: f32,
    rotation_rad: f32,
    warp1: f32,
    warp2: f32,
    phase1: f32,
    phase2: f32,
    segments: usize,
) -> Vec<Vec3> {
    let n = segments.max(12);
    let (sin_r, cos_r) = rotation_rad.sin_cos();
    let mut out = Vec::with_capacity(n + 1);
    for i in 0..=n {
        let theta = (i as f32 / n as f32) * std::f32::consts::TAU;
        let w = 1.0 + warp1 * (2.0 * theta + phase1).sin() + warp2 * (3.0 * theta + phase2).sin();
        let ex = a * theta.cos() * w;
        let ey = b * theta.sin() * w;
        // 椭圆局部系旋转到世界系
        let wx = cx + ex * cos_r - ey * sin_r;
        let wy = cy + ex * sin_r + ey * cos_r;
        out.push(Vec3::new(wx, wy, 0.0));
    }
    // 显式闭合：末点 = 首点（校验器与前端 fill 双方依赖该约定）
    if let Some(first) = out.first().copied() {
        if let Some(last) = out.last_mut() {
            *last = first;
        }
    }
    out
}

impl StaticWaterPlan {
    /// 点到水域中心的归一化椭圆距离（局部系 q；轮廓面 q ≈ 1 + warp(θ)）。
    #[inline]
    pub fn normalized_radius(&self, wx: f32, wy: f32, a: f32, b: f32, rotation_rad: f32) -> f32 {
        let dx = wx - self.center_x;
        let dy = wy - self.center_y;
        let (sin_r, cos_r) = rotation_rad.sin_cos();
        let u = dx * cos_r + dy * sin_r;
        let v = -dx * sin_r + dy * cos_r;
        ((u / a).powi(2) + (v / b).powi(2)).sqrt()
    }

    /// 点是否落在闭合轮廓多边形内（射线法，顶点数 O(n)、纯浮点确定性）。
    pub fn point_in_outline(&self, wx: f32, wy: f32) -> bool {
        point_in_polygon(&self.outline, wx, wy)
    }
}

/// 射线法点-多边形包含判定（顶点数 O(n)、纯浮点确定性、不读任何容器遍历顺序）。
///
/// ★ v1.52.0 提取自 `StaticWaterPlan::point_in_outline`，并由装饰落点水线判定
/// （`accents::near_water_surface`）共用：两处必须判**同一份**几何，禁止各写一份。
/// 判定式与提取前逐字一致（静水格涂写结果逐比特不变）。
pub(super) fn point_in_polygon(v: &[Vec3], wx: f32, wy: f32) -> bool {
    if v.len() < 4 {
        return false;
    }
    let mut inside = false;
    let mut j = v.len() - 1;
    for i in 0..v.len() {
        let (xi, yi) = (v[i].x, v[i].y);
        let (xj, yj) = (v[j].x, v[j].y);
        if ((yi > wy) != (yj > wy)) && (wx < (xj - xi) * (wy - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// 静水施加（§5.3 第 3 步静水路径）：涂写 cells + 登记 `WaterBody` 特征/水体 + 岸点。
///
/// * `bed_elevation(wx, wy)`：水下格高程剖面（轮廓内消费；与第 2 步池床/湖床雕入同源）。
/// * `access_points`：岸点世界坐标（槽位序即 id 序，id 从 1 起）。
/// * 岸环/退距 cells 不在此涂写——由第 6 步地表派生按几何覆盖意图统一加 NO_BUILD
///   （TB-03 §3.2 优先级：真实深水 > 干燥岸带 > 普通坡度派生）。
pub(super) fn apply_static_water<F>(
    map: &mut TerrainMap,
    plan: &StaticWaterPlan,
    cfg: &SimConfig,
    bed_elevation: F,
) where
    F: Fn(f32, f32) -> f32,
{
    // 1. cells 涂写：轮廓内格 = DeepWater + 水体归属 + 禁行禁建 + 池床/湖床高程。
    //    仅遍历轮廓 AABB 覆盖的格子（保守外扩 1 格），带外一格不碰。
    let half = map.world_size * 0.5;
    let xs: Vec<f32> = plan.outline.iter().map(|v| v.x).collect();
    let ys: Vec<f32> = plan.outline.iter().map(|v| v.y).collect();
    let (min_x, max_x) = (xs.iter().cloned().fold(f32::MAX, f32::min), xs.iter().cloned().fold(f32::MIN, f32::max));
    let (min_y, max_y) = (ys.iter().cloned().fold(f32::MAX, f32::min), ys.iter().cloned().fold(f32::MIN, f32::max));
    let gx_lo = ((((min_x - 1.0) / map.world_size + 0.5) * (map.grid_width - 1).max(1) as f32).floor() as isize)
        .clamp(0, (map.grid_width - 1) as isize) as usize;
    let gx_hi = ((((max_x + 1.0) / map.world_size + 0.5) * (map.grid_width - 1).max(1) as f32).ceil() as isize)
        .clamp(0, (map.grid_width - 1) as isize) as usize;
    let gy_lo = ((((min_y - 1.0) / map.world_size + 0.5) * (map.grid_height - 1).max(1) as f32).floor() as isize)
        .clamp(0, (map.grid_height - 1) as isize) as usize;
    let gy_hi = ((((max_y + 1.0) / map.world_size + 0.5) * (map.grid_height - 1).max(1) as f32).ceil() as isize)
        .clamp(0, (map.grid_height - 1) as isize) as usize;
    let _ = half;
    for gy in gy_lo..=gy_hi {
        for gx in gx_lo..=gx_hi {
            let p = map.grid_pos(gx, gy);
            if !plan.point_in_outline(p.x, p.y) {
                continue;
            }
            let c = &mut map.cells[gy * map.grid_width + gx];
            c.elevation = bed_elevation(p.x, p.y);
            c.surface_kind = SurfaceKind::DeepWater;
            c.water_body_id = Some(plan.water_body_id);
            c.feature_flags = TERRAIN_FLAG_NO_BUILD | TERRAIN_FLAG_NO_WALK;
            c.natural_fertility = 0.0;
        }
    }

    // 2. 水体登记：`WaterBody`（零流向静水语义）+ 同 id `TerrainFeature` 双副本
    //    （逐字节一致，由 validation.rs 断言）。
    let level = plan.level;
    map.hydrology.water_bodies.push(WaterBody {
        id: plan.water_body_id,
        level,
        flow_direction: Vec3::new(0.0, 0.0, 0.0),
        resource_pool_id: 1,
        vertices: plan.outline.clone(),
    });
    map.features.push(TerrainFeature {
        id: plan.water_body_id,
        kind: TerrainFeatureKind::WaterBody,
        vertices: plan.outline.clone(),
        elevation: level,
        width: plan.shore_ring_m,
        flags: 0,
    });

    // 3. 取水岸点：显式 `WaterAccessPoint ↔ 水体 #1 ↔ 池 #1` 绑定；id 固定按候选
    //    槽位分配（不随失败改号），落位在真实干地（岸环内，由调用方保证）。
    for (i, &(px, py)) in plan.access_points.iter().enumerate() {
        let pos = Vec3::new(px, py, map.sample_elevation(px, py));
        map.hydrology.access_points.push(WaterAccessPoint {
            id: i as u32 + 1,
            water_body_id: plan.water_body_id,
            resource_pool_id: 1,
            pos,
            nearest_node_id: None,
            interaction_radius: cfg.poi_interaction_radius,
        });
    }
}
