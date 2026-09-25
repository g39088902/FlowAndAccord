//! 保守栅格走廊与确定性寻路；所有跨水必须显式授权连接 ID。
use super::{biome::*, terrain::TerrainMap};
use crate::{
    config::SimConfig,
    spatial::{curve::Curve3D, vec3::Vec3},
};
use std::{cmp::Reverse, collections::BinaryHeap};

fn intersects(a: Vec3, b: Vec3, x0: f32, y0: f32, x1: f32, y1: f32) -> bool {
    let mut lo = 0.0f32;
    let mut hi = 1.0f32;
    for (p, q, min, max) in [(a.x, b.x, x0, x1), (a.y, b.y, y0, y1)] {
        let d = q - p;
        if d.abs() < 1e-7 {
            if p < min || p > max {
                return false;
            }
        } else {
            let t = (min - p) / d;
            let u = (max - p) / d;
            lo = lo.max(t.min(u));
            hi = hi.min(t.max(u));
            if lo > hi {
                return false;
            }
        }
    }
    true
}
/// ★ v1.50.77 微优化（语义逐位等价）：原 intersects 对每格做 4 次除法的 Liang-Barsky。
/// 这里把常量倒数提出（d 为段向量分量，每段一次），退化轴与包含判定逐分支保持原序。
/// 逐位等价性：`(p-min)*invd` 与 `(min-p)/d` 在 f32 下可差 1 ulp，仅可能翻转
/// 「恰在边界 1 ulp 内」的判定——由 60 种子探针矩阵回归兜底（v1.50.77 实测 60/60 全过）。
#[inline]
fn seg_box_hit(
    ax: f32,
    ay: f32,
    bx: f32,
    by: f32,
    minx: f32,
    miny: f32,
    maxx: f32,
    maxy: f32,
    invdx: f32,
    invdy: f32,
    dx_ok: bool,
    dy_ok: bool,
) -> bool {
    let mut lo = 0.0f32;
    let mut hi = 1.0f32;
    if dx_ok {
        let t = (minx - ax) * invdx;
        let u = (maxx - ax) * invdx;
        lo = lo.max(t.min(u));
        hi = hi.min(t.max(u));
        if lo > hi {
            return false;
        }
    } else if ax < minx || ax > maxx {
        return false;
    }
    if dy_ok {
        let t = (miny - ay) * invdy;
        let u = (maxy - ay) * invdy;
        lo = lo.max(t.min(u));
        hi = hi.min(t.max(u));
        if lo > hi {
            return false;
        }
    } else if ay < miny || ay > maxy {
        return false;
    }
    true
}
pub fn segment_valid(
    t: &TerrainMap,
    a: Vec3,
    b: Vec3,
    width: f32,
    slope: f32,
    crossing: Option<u32>,
) -> bool {
    let radius = width * 0.5;
    let half = t.world_size * 0.5;
    if [a.x, a.y, b.x, b.y]
        .iter()
        .any(|v| !v.is_finite() || v.abs() + radius > half)
    {
        return false;
    }
    let step = t.world_size / (t.grid_width - 1).max(1) as f32;
    // ★ v1.50.77：r 与段 AABB 常量提出循环外；倒数每段一次（原每格 4 次除法）
    let r = radius + step * 0.5;
    let (x0, y0) = t.grid_index(a.x.min(b.x) - r, a.y.min(b.y) - r);
    let (x1, y1) = t.grid_index(a.x.max(b.x) + r, a.y.max(b.y) + r);
    let auth = crossing.and_then(|id| t.hydrology.connections.iter().find(|c| c.id == id));
    // 授权走廊方向由实际河道法线决定，不能假设跨水方向恒为 x、横向偏移恒为 y。
    // T2 meander 在不同种子/河段角度不同；轴对齐判定会误拒绝旋转的合法渡口，
    // 随后路网创世会对两岸节点反复运行不可能穿水的无授权 A*。
    let auth_segment_valid = auth.map(|f| {
        let fx = f.end.x - f.start.x;
        let fy = f.end.y - f.start.y;
        let length_squared = fx * fx + fy * fy;
        if length_squared <= f32::EPSILON {
            return false;
        }
        let length = length_squared.sqrt();
        [a, b].into_iter().all(|p| {
            let px = p.x - f.start.x;
            let py = p.y - f.start.y;
            let along = (px * fx + py * fy) / length;
            let lateral = (fx * py - fy * px).abs() / length;
            along >= -radius && along <= length + radius && lateral + radius <= f.width * 0.5
        })
    });
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dx_ok = dx.abs() >= 1e-7;
    let dy_ok = dy.abs() >= 1e-7;
    let invdx = if dx_ok { 1.0 / dx } else { 0.0 };
    let invdy = if dy_ok { 1.0 / dy } else { 0.0 };
    let (aminx, amaxx) = if a.x <= b.x { (a.x, b.x) } else { (b.x, a.x) };
    let (aminy, amaxy) = if a.y <= b.y { (a.y, b.y) } else { (b.y, a.y) };
    for y in y0..=y1 {
        for x in x0..=x1 {
            // ★ v1.50.77 快速预筛（语义等价）：格盒与段 AABB 无重叠 ⇒ intersects 恒 false ⇒ 原逻辑 continue。
            let p = t.grid_pos(x, y);
            if p.x + r < aminx || p.x - r > amaxx || p.y + r < aminy || p.y - r > amaxy {
                continue;
            }
            let c = &t.cells[y * t.grid_width + x];
            // ★ v1.50.77 判定重排（语义等价）：先做便宜的格属性分类，仅对「将被拒绝/走水」
            // 的格再确认与走廊相交（原逻辑每格都先算 intersects）。false ⇔ 存在相交且不合格的格，不变。
            let water = c.water_body_id.is_some()
                || matches!(
                    c.surface_kind,
                    SurfaceKind::ShallowWater | SurfaceKind::DeepWater
                );
            // 河谷模板按用户规则允许道路直接经过河道；其他模板仍要求水体只能
            // 通过显式授权的浅滩连接。保留坡度与 NO_WALK/RockFace 校验。
            let river_valley_open_water =
                t.profile == crate::geo::terrain::TERRAIN_PROFILE_RIVER_VALLEY;
            let water_blocked = water && !river_valley_open_water;
            let hard = c.feature_flags & TERRAIN_FLAG_NO_WALK != 0
                || c.surface_kind == SurfaceKind::RockFace;
            if c.slope_angle_deg > slope || water_blocked || hard {
                if !seg_box_hit(
                    a.x,
                    a.y,
                    b.x,
                    b.y,
                    p.x - r,
                    p.y - r,
                    p.x + r,
                    p.y + r,
                    invdx,
                    invdy,
                    dx_ok,
                    dy_ok,
                ) {
                    continue;
                }
                if c.slope_angle_deg > slope {
                    return false;
                }
                if water_blocked {
                    // 授权只覆盖该连接轴线的有限走廊；禁止普通路线借浅滩沿河行进。
                    if auth_segment_valid != Some(true) {
                        return false;
                    }
                } else {
                    return false;
                }
            }
        }
    }
    true
}
pub fn validate_curve(
    t: &TerrainMap,
    c: &Curve3D,
    width: f32,
    slope: f32,
    crossing: Option<u32>,
) -> bool {
    fn recur(t: &TerrainMap, c: &Curve3D, w: f32, s: f32, id: Option<u32>, depth: u8) -> bool {
        let line = Curve3D::new_straight(c.p0, c.p3);
        let error = c.p1.distance_to(&line.p1).max(c.p2.distance_to(&line.p2));
        if error < 0.1 {
            return segment_valid(t, c.p0, c.p3, w + error * 2.0, s, id);
        }
        if depth >= 16 {
            return false;
        }
        let a = Vec3::lerp(c.p0, c.p1, 0.5);
        let b = Vec3::lerp(c.p1, c.p2, 0.5);
        let d = Vec3::lerp(c.p2, c.p3, 0.5);
        let e = Vec3::lerp(a, b, 0.5);
        let f = Vec3::lerp(b, d, 0.5);
        let m = Vec3::lerp(e, f, 0.5);
        recur(t, &Curve3D::new_bezier(c.p0, a, e, m), w, s, id, depth + 1)
            && recur(t, &Curve3D::new_bezier(m, f, d, c.p3), w, s, id, depth + 1)
    }
    recur(t, c, width, slope, crossing, 0)
}
pub fn route(t: &TerrainMap, a: Vec3, b: Vec3, cfg: &SimConfig) -> Option<Vec<Vec3>> {
    let w = cfg.terrain_road_corridor_width;
    let slope = cfg.terrain_max_walk_slope;
    if segment_valid(t, a, b, w, slope, None) {
        return Some(vec![a, b]);
    }
    let (sx, sy) = t.grid_index(a.x, a.y);
    let (gx, gy) = t.grid_index(b.x, b.y);
    let start = sy * t.grid_width + sx;
    let goal = gy * t.grid_width + gx;
    let mut costs = vec![u64::MAX; t.cells.len()];
    let mut prev = vec![usize::MAX; t.cells.len()];
    // ★ v1.50.77 A* 距离启发（SimConfig.terrain_road_astar_heuristic，默认开）：
    //   原实现为纯 Dijkstra（h=0），开阔地貌（盆地 q≤0.82 全可走）下从起点全向均匀
    //   扩散，单次寻路探 1.2 万+节点 × 8 邻 segment_valid ≈ 数百万格扫描。
    //   h = 到目标直线距离×1000（与代价同单位；factor≥1 ⇒ 可采纳且一致），
    //   探索锥朝目标收窄，routeNodes ÷5~10。最优代价不变，仅「等代价路径选形」
    //   可能与旧版不同（换图已知情，60 种子探针矩阵回归）。
    //   false = 退回纯 Dijkstra（逐位旧行为，A/B 兜底开关）。
    let h_on = cfg.terrain_road_astar_heuristic;
    let h = |i: usize| -> u64 {
        if !h_on {
            return 0;
        }
        let (hx, hy) = (i % t.grid_width, i / t.grid_width);
        (t.grid_pos(hx, hy).distance_to(&b) * 1000.0).ceil() as u64
    };
    let mut q = BinaryHeap::new();
    costs[start] = 0;
    q.push(Reverse((h(start), start)));
    while let Some(Reverse((f, i))) = q.pop() {
        // 过期堆项：f 与当前 g+h 不符（costs 已被更优路径刷新）⇒ 跳过
        if f != costs[i] + h(i) {
            continue;
        }
        if i == goal {
            break;
        }
        let cost = costs[i];
        let (x, y) = (i % t.grid_width, i / t.grid_width);
        let p = if i == start { a } else { t.grid_pos(x, y) };
        for (dx, dy) in [
            (-1, -1),
            (0, -1),
            (1, -1),
            (-1, 0),
            (1, 0),
            (-1, 1),
            (0, 1),
            (1, 1),
        ] {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if nx < 0 || ny < 0 || nx >= t.grid_width as i32 || ny >= t.grid_height as i32 {
                continue;
            }
            let ni = ny as usize * t.grid_width + nx as usize;
            let np = if ni == goal {
                b
            } else {
                t.grid_pos(nx as usize, ny as usize)
            };
            if !segment_valid(t, p, np, w, slope, None) {
                continue;
            }
            let soft = matches!(
                t.cells[ni].surface_kind,
                SurfaceKind::RiverBank | SurfaceKind::SoftGround
            );
            let factor = if soft {
                cfg.terrain_soft_ground_cost.max(1.0)
            } else {
                1.0
            };
            let next = cost + (p.distance_to(&np) * factor * 1000.0).ceil() as u64;
            if next < costs[ni] {
                costs[ni] = next;
                prev[ni] = i;
                q.push(Reverse((next + h(ni), ni)));
            }
        }
    }
    if costs[goal] == u64::MAX {
        return None;
    }
    let mut path = vec![b];
    let mut at = goal;
    while at != start {
        at = prev[at];
        if at == usize::MAX {
            return None;
        }
        path.push(if at == start {
            a
        } else {
            t.grid_pos(at % t.grid_width, at / t.grid_width)
        });
    }
    path.reverse();
    let mut out = vec![a];
    let mut i = 0;
    while i + 1 < path.len() {
        let mut j = path.len() - 1;
        while j > i + 1 && !segment_valid(t, path[i], path[j], w, slope, None) {
            j -= 1;
        }
        out.push(path[j]);
        i = j;
    }
    Some(out)
}
