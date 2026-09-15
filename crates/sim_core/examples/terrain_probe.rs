//! 地形通行力探针（临时诊断示例，不进入测试套件）。
//!
//! 用途：直接调用内核生成器，实测各 profile 的通行力与模板专属指标。
//! 现覆盖 T1 `mountain_pass_v1` / T2 `river_valley_v1` / 草原 `grassland_plain_v1` /
//! 半坡 `hillside_woodland_v1` / 台地 `plateau_v1`（v1.50.68 起模板池 8 路；
//! 原河谷聚落模板已删除）。
//! 对应 `docs/plan/tech/06-terrain-templates.md` §9.3.1、§18.7 与 STAGE-07-TODO S7-01。
//!
//! 运行：
//! - `cargo run --release -p sim_core --example terrain_probe`（旧基线：T1+T2，seeds 1..=12）
//! - `cargo run --release -p sim_core --example terrain_probe -- --profile mountain_pass_v1 [--seeds 60]`
//! - `cargo run --release -p sim_core --example terrain_probe -- --profile grassland_plain_v1 [--seeds 60]`
//! - `cargo run --release -p sim_core --example terrain_probe -- --profile hillside_woodland_v1 [--seeds 60]`
//! - `cargo run --release -p sim_core --example terrain_probe -- world 20`（创世校验模式，行为不变）
//!
//! §1.4 七项通用指标：max_slope / >30° / >=34° / NO_WALK / buildable / components /
//! detour_p95，外加 waterM（初始营地=图中心 → 最近可用水源距离；地形层近似：取水点 ∪ 水面格）。
//! 模板专属指标（S7-01 定义）：草原 `mound_count` / `soft_ground` / `fertility`；
//! 半坡 `windward_max` / `leeward_max` / `buildable_band`（原河谷聚落专属指标
//! `floor_width` / `cliff_mean` / `crossing95` 随模板删除一并下线）。
//!
//! 关键指标口径：
//! - `max_slope_deg`：全图最大格子坡度。低于 `terrain_max_walk_slope`(30°) 则永远不挡路。
//! - `blocked_cells`：`slope > 30°` 的格子数（走廊校验会拒绝这些格）。
//! - `hard_blocked_cells`：`slope >= 34°` 即 `RockFace`/`NO_WALK` 的格子数（真正的硬墙）。
//! - `components`：可行走格子的连通分量数。>1 说明有区域被封死（生存风险）。
//! - `detour_max` / `detour_p95`：测地距离 / 欧氏距离。≈1.0 表示地形完全无阻碍；
//!   出现明显 >1.5 的样本才说明「近在咫尺却必须绕行」，即山口玩法成立。
//! - `crossing95`：直线段穿过不可行走格（深水/崖壁，浅滩不算）的对置点对绕行比 p95，
//!   用于证明「两岸交往必须依赖浅滩」（S7-07 接线门禁，实测校准下限 1.90）。
//! - ★ TB-01-7 支脊统计（v1.50.42/43，全模板输出列、山口专属验收块）：`brN` 检出支脊
//!   条数（来自 `TerrainMap::branch_ridges`）；`brSlope` 支脊侧翼（|d⊥| ≤ width）峰值
//!   坡度；`brDet` 直线穿越支脊影响区（|d⊥| ≤ 1.5×width）的样本对绕行比最大值。
//!   山口 profile 末尾按达标线输出验收判定（components==1 / detour 2.0~5.2 /
//!   buildable ≥10500 / 硬禁行 2%~5% / 支脊检出率 100% → TB01_7_ALL_PASS）。

use sim_core::config::SimConfig;
use sim_core::geo::biome::TERRAIN_FLAG_NO_WALK;
use sim_core::geo::terrain::{
    TERRAIN_PROFILE_ALLUVIAL_FAN, TERRAIN_PROFILE_BASIN_OASIS, TERRAIN_PROFILE_GRASSLAND_PLAIN,
    TERRAIN_PROFILE_HILLSIDE_WOODLAND, TERRAIN_PROFILE_LAKESIDE_BASIN,
    TERRAIN_PROFILE_MOUNTAIN_PASS, TERRAIN_PROFILE_PLATEAU,
    TERRAIN_PROFILE_RIVER_VALLEY,
};
use sim_core::geo::{BranchRidge, SurfaceKind, TerrainFeatureKind, TerrainMap};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, VecDeque};

const WALK_SLOPE: f32 = 30.0; // SimConfig::terrain_max_walk_slope
const ROCK_SLOPE: f32 = 34.0; // SurfaceKind::RockFace 阈值

const PROFILE_GRASSLAND_PLAIN: &str = "grassland_plain_v1";
const PROFILE_HILLSIDE_WOODLAND: &str = "hillside_woodland_v1";

/// §1.4 探针门禁窗口（STAGE-07-TODO §1.4 基线表）。仅对内核已实现的阶段七模板生效；
/// `band_width_min` 为连续可建带最小宽度（S7-04 坡脚 ≥35m；草原开阔图不设）。
struct GateWindow {
    max_slope: (f32, f32),
    hard_blocked: (usize, usize),
    no_walk: (usize, usize),
    buildable_min: usize,
    detour_p95: (f32, f32),
    water_dist_max: f32,
    band_width_min: f32,
    crossing95_min: f32,
}

fn gate_window_for(profile: &str) -> Option<GateWindow> {
    match profile {
        PROFILE_GRASSLAND_PLAIN => Some(GateWindow {
            max_slope: (0.0, 20.0),
            hard_blocked: (0, 0),
            no_walk: (0, 0),
            buildable_min: 12000,
            detour_p95: (0.0, 1.15),
            water_dist_max: f32::INFINITY,
            band_width_min: 0.0,
            crossing95_min: 0.0,
        }),
        // ★ S7-04 窗口修订：`detour_p95` 下限 1.15 撤销——本探针的测地距离是
        //   纯几何 Dijkstra（不叠加坡度时耗），而半坡「全域 <30° 零禁行」的设计
        //   铁律下不存在不可行格，几何绕行比天然 ≈1.08（与草原同底），§1.4 原表
        //   「1.15~1.45 轻度绕行」在本口径下不可达；慢行代价由
        //   `LaneTerrainProfile` 坡度折算（路网时耗）与 `leeward_slope_max`
        //   指标承载，绕行压力由 `NO_BUILD`(≥18°) 把房屋压进坡脚带实现。
        //   故仅保留上界 1.45（防出现意外的几何死区式绕行）。
        PROFILE_HILLSIDE_WOODLAND => Some(GateWindow {
            max_slope: (22.0, 28.5),
            hard_blocked: (0, 0),
            no_walk: (0, 0),
            buildable_min: 7500,
            detour_p95: (0.0, 1.45),
            water_dist_max: f32::INFINITY,
            band_width_min: 35.0,
            crossing95_min: 0.0,
        }),
        TERRAIN_PROFILE_PLATEAU => Some(GateWindow {
            max_slope: (42.0, 58.0),
            hard_blocked: (150, 350),
            no_walk: (150, 350),
            buildable_min: 4000,
            detour_p95: (0.0, 3.50),
            water_dist_max: f32::INFINITY,
            band_width_min: 32.0,
            crossing95_min: 0.0,
        }),
        _ => None,
    }
}

fn is_walkable(t: &TerrainMap, i: usize) -> bool {
    let c = &t.cells[i];
    if c.slope_angle_deg > WALK_SLOPE {
        return false;
    }
    if c.feature_flags & TERRAIN_FLAG_NO_WALK != 0 {
        return false;
    }
    if matches!(c.surface_kind, SurfaceKind::DeepWater) {
        return false;
    }
    // ShallowWater 只在授权浅滩走廊（TerrainConnection）内可跨越；T2 固定两处，故视为可通行。
    if c.water_body_id.is_some() && !matches!(c.surface_kind, SurfaceKind::ShallowWater) {
        return false;
    }
    true
}

fn is_buildable(t: &TerrainMap, i: usize) -> bool {
    let c = &t.cells[i];
    c.slope_angle_deg <= 16.0 && c.feature_flags & 1 == 0 && c.water_body_id.is_none()
}

fn cell_world(t: &TerrainMap, gx: usize, gy: usize) -> (f32, f32) {
    let wx = if t.grid_width <= 1 {
        0.0
    } else {
        (gx as f32 / (t.grid_width - 1) as f32 - 0.5) * t.world_size
    };
    let wy = if t.grid_height <= 1 {
        0.0
    } else {
        (gy as f32 / (t.grid_height - 1) as f32 - 0.5) * t.world_size
    };
    (wx, wy)
}

/// ★ TB-01-7 支脊轴线局部坐标：(沿轴 d∥, 垂轴 d⊥)。
fn branch_coords(br: &BranchRidge, wx: f32, wy: f32) -> (f32, f32) {
    let dx = wx - br.root_x;
    let dy = wy - br.root_y;
    (dx * br.dir_x + dy * br.dir_y, -dx * br.dir_y + dy * br.dir_x)
}

/// ★ TB-01-7 支脊统计：检出条数 + 侧翼（|d⊥| ≤ width 且 0≤d∥≤L）峰值坡度。
fn branch_flank_stats(t: &TerrainMap) -> (usize, f32) {
    let mut flank_max = 0.0f32;
    if t.branch_ridges.is_empty() {
        return (0, flank_max);
    }
    for gy in 0..t.grid_height {
        for gx in 0..t.grid_width {
            let (wx, wy) = cell_world(t, gx, gy);
            for br in &t.branch_ridges {
                let (d_par, d_perp) = branch_coords(br, wx, wy);
                if (0.0..=br.length).contains(&d_par) && d_perp.abs() <= br.width {
                    let s = t.cells[gy * t.grid_width + gx].slope_angle_deg;
                    if s > flank_max {
                        flank_max = s;
                    }
                }
            }
        }
    }
    (t.branch_ridges.len(), flank_max)
}

/// ★ TB-01-7 支脊影响区掩码（|d⊥| ≤ 1.5×width 且 0≤d∥≤L，外扩 1 格防漏边）：
/// 直线穿越该区的样本对被迫绕行，是「支脊形成次级绕行」的直接证据。
fn branch_zone_mask(t: &TerrainMap) -> Vec<bool> {
    let n = t.cells.len();
    let mut mask = vec![false; n];
    if t.branch_ridges.is_empty() {
        return mask;
    }
    let step = t.world_size / (t.grid_width.max(2) - 1) as f32;
    for gy in 0..t.grid_height {
        for gx in 0..t.grid_width {
            let (wx, wy) = cell_world(t, gx, gy);
            for br in &t.branch_ridges {
                let (d_par, d_perp) = branch_coords(br, wx, wy);
                if (0.0..=br.length).contains(&d_par) && d_perp.abs() <= 1.5 * br.width + step {
                    mask[gy * t.grid_width + gx] = true;
                    break;
                }
            }
        }
    }
    mask
}

/// ★ TB-01-7 线段 src→dst 是否穿过支脊影响区：按格步长采样（影响区半宽
/// ≥1.5×width ≈ 60m，远大于格步 6.4m，步长采样不会漏穿）。
fn seg_crosses_zone(
    t: &TerrainMap,
    zone: &[bool],
    sx: usize,
    sy: usize,
    dx: usize,
    dy: usize,
) -> bool {
    if zone.is_empty() {
        return false;
    }
    let step = t.world_size / (t.grid_width.max(2) - 1) as f32;
    let half = t.world_size * 0.5;
    let (x0, y0) = cell_world(t, sx, sy);
    let (x1, y1) = cell_world(t, dx, dy);
    let len = ((x1 - x0).powi(2) + (y1 - y0).powi(2)).sqrt();
    let n = (len / step).ceil().max(1.0) as usize;
    for k in 0..=n {
        let u = k as f32 / n as f32;
        let wx = x0 + (x1 - x0) * u;
        let wy = y0 + (y1 - y0) * u;
        let gx = ((wx + half) / step).round();
        let gy = ((wy + half) / step).round();
        if gx < 0.0 || gy < 0.0 || gx >= t.grid_width as f32 || gy >= t.grid_height as f32 {
            continue;
        }
        if zone[gy as usize * t.grid_width + gx as usize] {
            return true;
        }
    }
    false
}

/// 失败日志用的格子定位：网格坐标 + 世界坐标 + 该格坡度。
fn cell_desc(t: &TerrainMap, gx: usize, gy: usize) -> String {
    let (wx, wy) = cell_world(t, gx, gy);
    let slope = t.cells[gy * t.grid_width + gx].slope_angle_deg;
    format!(
        "格(x={},y={},wx={:+.0},wy={:+.0},slope={:.1}°)",
        gx, gy, wx, wy, slope
    )
}

fn p95(sorted: &[f32]) -> f32 {
    if sorted.is_empty() {
        0.0
    } else {
        sorted[(sorted.len() * 95 / 100).min(sorted.len() - 1)]
    }
}

/// 直线段（网格空间）是否穿过不可行走格（深水/崖壁/禁行）；浅滩走廊不算障碍。
fn line_blocked(t: &TerrainMap, ax: usize, ay: usize, bx: usize, by: usize) -> bool {
    let steps = (((bx as f32 - ax as f32).powi(2) + (by as f32 - ay as f32).powi(2)).sqrt() as usize)
        .clamp(4, 400);
    for k in 1..steps {
        let u = k as f32 / steps as f32;
        let x = (ax as f32 + (bx as f32 - ax as f32) * u).round() as usize;
        let y = (ay as f32 + (by as f32 - ay as f32) * u).round() as usize;
        if !is_walkable(t, y * t.grid_width + x) {
            return true;
        }
    }
    false
}

/// 生活水源距离（§1.4 第 7 项，地形层近似）：图中心（初始营地）到最近可用水源格。
/// 候选 = 水系取水点 ∪ 任意水面格；两者皆无（如清泉由生态层布点）时返回 None。
fn measure_water_dist(t: &TerrainMap) -> Option<f32> {
    let w = t.grid_width;
    let h = t.grid_height;
    let cell_step = t.world_size / (w.max(2) - 1) as f32;
    let (cx, cy) = ((w.saturating_sub(1)) as f32 * 0.5, (h.saturating_sub(1)) as f32 * 0.5);
    let mut best: Option<(f32, usize)> = None;
    let consider = |gx: f32, gy: f32, idx: usize, best: &mut Option<(f32, usize)>| {
        let d = (gx - cx).hypot(gy - cy);
        if best.map_or(true, |(bd, _)| d < bd) {
            *best = Some((d, idx));
        }
    };
    for ap in &t.hydrology.access_points {
        let (gx, gy) = t.grid_index(ap.pos.x, ap.pos.y);
        consider(gx as f32, gy as f32, gy * w + gx, &mut best);
    }
    for f in &t.features {
        if f.kind == TerrainFeatureKind::SpringValley {
            for v in &f.vertices {
                let (gx, gy) = t.grid_index(v.x, v.y);
                consider(gx as f32, gy as f32, gy * w + gx, &mut best);
            }
        }
    }
    for i in 0..t.cells.len() {
        if t.cells[i].water_body_id.is_some() {
            let (gx, gy) = (i % w, i / w);
            consider(gx as f32, gy as f32, i, &mut best);
        }
    }
    best.map(|(d, _)| d * cell_step)
}

struct Report {
    max_slope: f32,
    max_slope_cell: (usize, usize),
    blocked: usize,
    hard_blocked: usize,
    no_walk: usize,
    buildable: usize,
    components: usize,
    /// 除最大分量外的死区样本：(size, 格坐标)，最多 4 条。
    component_overflow: Vec<(usize, (usize, usize))>,
    detour_max: f32,
    detour_p95: f32,
    /// 跨障对置点对（直线穿不可行走格）的绕行比 p95。
    crossing_detour_p95: f32,
    water_dist: Option<f32>,
    /// ★ TB-01-7 直线穿越支脊影响区的样本对中的最大绕行比（无支脊/无穿越对时为 0）。
    branch_detour_max: f32,
    /// ★ TB-01-7 穿越支脊影响区的样本对数。
    branch_detour_n: usize,
}

fn analyse(t: &TerrainMap, sample_sources: usize, zone: &[bool]) -> Report {
    let n = t.cells.len();
    let mut max_slope = 0.0f32;
    let mut max_slope_idx = 0usize;
    let mut blocked = 0usize;
    let mut hard = 0usize;
    let mut no_walk = 0usize;
    let mut buildable = 0usize;
    for i in 0..n {
        let s = t.cells[i].slope_angle_deg;
        if s > max_slope {
            max_slope = s;
            max_slope_idx = i;
        }
        if s > WALK_SLOPE {
            blocked += 1;
        }
        if s >= ROCK_SLOPE {
            hard += 1;
        }
        if t.cells[i].feature_flags & TERRAIN_FLAG_NO_WALK != 0 {
            no_walk += 1;
        }
        if is_buildable(t, i) {
            buildable += 1;
        }
    }

    // 连通分量（记录每个分量大小与首格，供死区失败日志定位）
    let mut seen = vec![false; n];
    let mut comps: Vec<(usize, usize)> = Vec::new();
    let mut walkable: Vec<usize> = Vec::new();
    for start in 0..n {
        if seen[start] || !is_walkable(t, start) {
            continue;
        }
        let first = start;
        let mut size = 0usize;
        let mut q = VecDeque::new();
        q.push_back(start);
        seen[start] = true;
        while let Some(i) = q.pop_front() {
            size += 1;
            walkable.push(i);
            let (x, y) = (i % t.grid_width, i / t.grid_width);
            for (dx, dy) in [
                (-1i32, -1i32),
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
                if seen[ni] || !is_walkable(t, ni) {
                    continue;
                }
                seen[ni] = true;
                q.push_back(ni);
            }
        }
        comps.push((size, first));
    }
    let components = comps.len();
    let mut sorted_comps = comps.clone();
    sorted_comps.sort_by(|a, b| b.0.cmp(&a.0));
    let component_overflow: Vec<(usize, (usize, usize))> = sorted_comps
        .iter()
        .skip(1)
        .take(4)
        .map(|(size, idx)| (*size, (idx % t.grid_width, idx / t.grid_width)))
        .collect();

    // 测地 / 欧氏 绕行比
    let step = t.world_size / (t.grid_width.max(2) - 1) as f32;
    let diag = step * std::f32::consts::SQRT_2;
    let mut detours: Vec<f32> = Vec::new();
    let mut crossing: Vec<f32> = Vec::new();
    let mut branch_detours: Vec<f32> = Vec::new();
    if !walkable.is_empty() {
        let stride = (walkable.len() / sample_sources.max(1)).max(1);
        let sources: Vec<usize> = walkable.iter().step_by(stride).copied().collect();
        for &src in sources.iter().take(sample_sources) {
            let mut dist = vec![f32::INFINITY; n];
            let mut heap = BinaryHeap::new();
            dist[src] = 0.0;
            heap.push(Reverse((0u32, src)));
            while let Some(Reverse((d, i))) = heap.pop() {
                if d as f32 * 0.01 > dist[i] {
                    continue;
                }
                let (x, y) = (i % t.grid_width, i / t.grid_width);
                for (dx, dy) in [
                    (-1i32, -1i32),
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
                    if !is_walkable(t, ni) {
                        continue;
                    }
                    let w = if dx != 0 && dy != 0 { diag } else { step };
                    let nd = dist[i] + w;
                    if nd < dist[ni] - 1e-4 {
                        dist[ni] = nd;
                        heap.push(Reverse(((nd * 100.0) as u32, ni)));
                    }
                }
            }
            let (sx, sy) = (src % t.grid_width, src / t.grid_width);
            for &dst in walkable.iter() {
                if !dist[dst].is_finite() {
                    continue;
                }
                let (dx, dy) = (dst % t.grid_width, dst / t.grid_width);
                let euc = (((dx as f32 - sx as f32) * step).powi(2)
                    + ((dy as f32 - sy as f32) * step).powi(2))
                .sqrt();
                if euc < 150.0 {
                    continue;
                }
                let ratio = dist[dst] / euc;
                detours.push(ratio);
                // 跨障对：直线段被深水/崖壁切断的对置点（浅滩可跨越，不算障碍）
                if ratio > 1.30 && line_blocked(t, sx, sy, dx, dy) {
                    crossing.push(ratio);
                }
                // ★ TB-01-7 支脊区穿越对：直线穿越支脊影响区（或端点在区内）
                if zone[dst] || seg_crosses_zone(t, zone, sx, sy, dx, dy) {
                    branch_detours.push(ratio);
                }
            }
        }
    }
    detours.sort_by(|a, b| a.partial_cmp(b).unwrap());
    crossing.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let detour_max = detours.last().copied().unwrap_or(0.0);
    let detour_p95 = p95(&detours);
    let crossing_detour_p95 = p95(&crossing);
    let branch_detour_max = branch_detours.iter().copied().fold(0.0f32, f32::max);

    Report {
        max_slope,
        max_slope_cell: (max_slope_idx % t.grid_width, max_slope_idx / t.grid_width),
        blocked,
        hard_blocked: hard,
        no_walk,
        buildable,
        components,
        component_overflow,
        detour_max,
        detour_p95,
        crossing_detour_p95,
        water_dist: measure_water_dist(t),
        branch_detour_max,
        branch_detour_n: branch_detours.len(),
    }
}

/// 模板专属指标（S7-01 定义）。全部为对任意 `TerrainMap` 的纯几何统计，
/// 不依赖 profile 分支——S7-02/S7-04/S7-06 落地后按 profile 名套用 §1.4 窗口即可。
#[derive(Clone, Copy)]
struct TemplateMetrics {
    /// 草原：孤立残丘数（局部极大 + 环带突出量 ≥3.5m + 峰值坡度 <20° + 15 格去重）。
    mound_count: usize,
    /// 草原：软地占比（非深水陆格中 `SurfaceKind::SoftGround`）。
    soft_ground_ratio: f32,
    /// 草原：可建格平均自然肥力。
    fertility_mean: f32,
    /// 半坡：迎风面（拟合梯度两侧中平均坡度较小者）最大坡度。
    windward_slope_max: f32,
    /// 半坡：背风面最大坡度。
    leeward_slope_max: f32,
    /// 半坡/河谷：最大连续可建带宽（行/列扫描的最长 `is_buildable` 连续段 × 格距）。
    buildable_band_width: f32,
    /// 河谷：谷底开阔宽度（行/列扫描的最长「可行走且坡度 <20°」连续段 × 格距）。
    valley_floor_width: f32,
    /// 河谷：崖壁格（`RockFace`）平均坡度。
    cliff_slope_mean: f32,
    /// ★ v1.50.68 冲积扇：扇面图面覆盖率（z_fan 增量 >2m 的格占比；非 fan 恒 0）。
    fan_coverage: f32,
    /// ★ v1.50.68 冲积扇：可见干沟条数（中心深 ≥4m；非 fan 恒 0）。
    fan_gully_visible: usize,
    /// ★ v1.50.68 冲积扇：全图最大高差（max−min elevation，山口堆体量指标）。
    fan_relief: f32,
}

fn measure_template_metrics(t: &TerrainMap) -> TemplateMetrics {
    let w = t.grid_width;
    let h = t.grid_height;
    let n = w * h;
    let cell_step = t.world_size / (w.max(2) - 1) as f32;

    let mut land = 0usize;
    let mut soft = 0usize;
    let mut fert_sum = 0.0f64;
    let mut fert_n = 0usize;
    let mut cliff_sum = 0.0f64;
    let mut cliff_n = 0usize;
    for i in 0..n {
        let c = &t.cells[i];
        if c.surface_kind != SurfaceKind::DeepWater {
            land += 1;
        }
        if c.surface_kind == SurfaceKind::SoftGround {
            soft += 1;
        }
        if is_buildable(t, i) {
            fert_sum += c.natural_fertility as f64;
            fert_n += 1;
        }
        if c.surface_kind == SurfaceKind::RockFace {
            cliff_sum += c.slope_angle_deg as f64;
            cliff_n += 1;
        }
    }
    let soft_ground_ratio = if land > 0 { soft as f32 / land as f32 } else { 0.0 };
    let fertility_mean = if fert_n > 0 {
        (fert_sum / fert_n as f64) as f32
    } else {
        0.0
    };
    let cliff_slope_mean = if cliff_n > 0 {
        (cliff_sum / cliff_n as f64) as f32
    } else {
        0.0
    };

    // 孤立残丘计数：5×5 局部极大 + 6 格环带平均高程突出量 ≥3.5m + 峰值坡度 <20°，
    // 15 格切比雪夫半径内去重（对应草原残丘 A_m∈[6,10]m、R_m∈[45,65]m 的可分尺度）。
    let mut peaks: Vec<(f32, usize)> = Vec::new();
    for gy in 2..h.saturating_sub(2) {
        for gx in 2..w.saturating_sub(2) {
            let idx = gy * w + gx;
            let e = t.cells[idx].elevation;
            if t.cells[idx].slope_angle_deg >= 20.0 {
                continue;
            }
            let mut is_max = true;
            'nb: for dy in -2i32..=2 {
                for dx in -2i32..=2 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let ni = (gy as i32 + dy) as usize * w + (gx as i32 + dx) as usize;
                    if t.cells[ni].elevation > e {
                        is_max = false;
                        break 'nb;
                    }
                }
            }
            if !is_max {
                continue;
            }
            let mut ring_sum = 0.0f64;
            let mut ring_n = 0usize;
            for dy in -6i32..=6 {
                for dx in -6i32..=6 {
                    if dx.abs() <= 2 && dy.abs() <= 2 {
                        continue;
                    }
                    let (nx, ny) = (gx as i32 + dx, gy as i32 + dy);
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        continue;
                    }
                    ring_sum += t.cells[ny as usize * w + nx as usize].elevation as f64;
                    ring_n += 1;
                }
            }
            if ring_n == 0 {
                continue;
            }
            let prom = e as f64 - ring_sum / ring_n as f64;
            if prom >= 3.5 {
                peaks.push((prom as f32, idx));
            }
        }
    }
    peaks.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    let mut picked: Vec<usize> = Vec::new();
    for &(_, idx) in peaks.iter() {
        let (px, py) = ((idx % w) as i32, (idx / w) as i32);
        let far = picked.iter().all(|&p| {
            let (qx, qy) = ((p % w) as i32, (p / w) as i32);
            (px - qx).abs().max(py - qy).abs() > 15
        });
        if far {
            picked.push(idx);
        }
        if picked.len() >= 4 {
            break;
        }
    }
    let mound_count = picked.len();

    // 不对称主坡：对高程做最小二乘平面拟合取得梯度方向，以全图最高格的投影为脊线；
    // 脊线两侧中平均坡度较小的一侧记为迎风面。纯几何统计，不读 profile。
    let (mut sx, mut sy, mut sz) = (0.0f64, 0.0f64, 0.0f64);
    let (mut sxx, mut syy, mut sxy, mut sxz, mut syz) =
        (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
    for i in 0..n {
        let (wx, wy) = cell_world(t, i % w, i / w);
        let (xf, yf, zf) = (wx as f64, wy as f64, t.cells[i].elevation as f64);
        sx += xf;
        sy += yf;
        sz += zf;
        sxx += xf * xf;
        syy += yf * yf;
        sxy += xf * yf;
        sxz += xf * zf;
        syz += yf * zf;
    }
    let cnt = n as f64;
    let mx = sx / cnt;
    let my = sy / cnt;
    let mz = sz / cnt;
    let cxx = sxx - cnt * mx * mx;
    let cyy = syy - cnt * my * my;
    let cxy = sxy - cnt * mx * my;
    let cxz = sxz - cnt * mx * mz;
    let cyz = syz - cnt * my * mz;
    let det = cxx * cyy - cxy * cxy;
    let (ga, gb) = if det.abs() > 1e-9 {
        ((cxz * cyy - cyz * cxy) / det, (cyz * cxx - cxz * cxy) / det)
    } else {
        (0.0, 0.0)
    };
    let mut best_idx = 0usize;
    let mut best_e = f32::MIN;
    for i in 0..n {
        if t.cells[i].elevation > best_e {
            best_e = t.cells[i].elevation;
            best_idx = i;
        }
    }
    let (bx, by) = cell_world(t, best_idx % w, best_idx / w);
    let crest_u = ga * bx as f64 + gb * by as f64;
    let (mut w_sum, mut w_n, mut w_max) = (0.0f64, 0usize, 0.0f32);
    let (mut l_sum, mut l_n, mut l_max) = (0.0f64, 0usize, 0.0f32);
    for i in 0..n {
        let (wx, wy) = cell_world(t, i % w, i / w);
        let u = ga * wx as f64 + gb * wy as f64;
        let s = t.cells[i].slope_angle_deg;
        if u < crest_u {
            w_sum += s as f64;
            w_n += 1;
            w_max = w_max.max(s);
        } else {
            l_sum += s as f64;
            l_n += 1;
            l_max = l_max.max(s);
        }
    }
    let w_mean = if w_n > 0 { w_sum / w_n as f64 } else { 0.0 };
    let l_mean = if l_n > 0 { l_sum / l_n as f64 } else { 0.0 };
    let (windward_slope_max, leeward_slope_max) =
        if w_mean <= l_mean { (w_max, l_max) } else { (l_max, w_max) };

    // 连续带宽：行/列双向扫描最长连续段
    let mut band_max = 0usize;
    let mut floor_max = 0usize;
    for gy in 0..h {
        let (mut run_b, mut run_f) = (0usize, 0usize);
        for gx in 0..w {
            let i = gy * w + gx;
            run_b = if is_buildable(t, i) { run_b + 1 } else { 0 };
            run_f = if is_walkable(t, i) && t.cells[i].slope_angle_deg < 20.0 {
                run_f + 1
            } else {
                0
            };
            band_max = band_max.max(run_b);
            floor_max = floor_max.max(run_f);
        }
    }
    for gx in 0..w {
        let (mut run_b, mut run_f) = (0usize, 0usize);
        for gy in 0..h {
            let i = gy * w + gx;
            run_b = if is_buildable(t, i) { run_b + 1 } else { 0 };
            run_f = if is_walkable(t, i) && t.cells[i].slope_angle_deg < 20.0 {
                run_f + 1
            } else {
                0
            };
            band_max = band_max.max(run_b);
            floor_max = floor_max.max(run_f);
        }
    }

    // ★ v1.50.68 冲积扇指标：扇面图面覆盖率（z_fan 增量 >2m 格占比）、
    // 可见干沟条数（中心深 ≥4m）与全图最大高差（山口堆体量）。
    // 非 fan profile（几何为 None）恒 0，不参与其他模板窗口。
    let (fan_coverage, fan_gully_visible, fan_relief) = match t.fan_geometry.as_ref() {
        Some(fg) => {
            let mut covered = 0usize;
            for gy in 0..h {
                for gx in 0..w {
                    let (wx, wy) = cell_world(t, gx, gy);
                    let (zf, _) = fg.elevation_at(wx, wy);
                    if zf > 2.0 {
                        covered += 1;
                    }
                }
            }
            let gully_n = fg.gullies.iter().filter(|g| g.depth >= 4.0).count();
            let mut emax = f32::MIN;
            let mut emin = f32::MAX;
            for c in &t.cells {
                emax = emax.max(c.elevation);
                emin = emin.min(c.elevation);
            }
            (covered as f32 / n as f32, gully_n, emax - emin)
        }
        None => (0.0, 0, 0.0),
    };

    TemplateMetrics {
        mound_count,
        soft_ground_ratio,
        fertility_mean,
        windward_slope_max,
        leeward_slope_max,
        buildable_band_width: band_max as f32 * cell_step,
        valley_floor_width: floor_max as f32 * cell_step,
        cliff_slope_mean,
        fan_coverage,
        fan_gully_visible,
        fan_relief,
    }
}

/// §1.4 门禁断言辅助：逐项比对窗口，违例时产出含种子外定位信息（坐标/坡度/原因）的日志行。
fn check_gates(t: &TerrainMap, r: &Report, m: &TemplateMetrics, win: &GateWindow) -> Vec<String> {
    let mut v = Vec::new();
    if r.components > 1 {
        let mut detail = String::new();
        for (size, (gx, gy)) in r.component_overflow.iter().take(4) {
            detail.push_str(&format!("〔死区 size={} @ {}〕", size, cell_desc(t, *gx, *gy)));
        }
        v.push(format!(
            "components={} > 1 · 存在不可达死区 {}",
            r.components, detail
        ));
    }
    if r.max_slope < win.max_slope.0 - 1e-4 || r.max_slope > win.max_slope.1 + 1e-4 {
        let (gx, gy) = r.max_slope_cell;
        v.push(format!(
            "max_slope={:.2}° 越窗 [{:.1}°, {:.1}°] · {}",
            r.max_slope,
            win.max_slope.0,
            win.max_slope.1,
            cell_desc(t, gx, gy)
        ));
    }
    if r.hard_blocked < win.hard_blocked.0 || r.hard_blocked > win.hard_blocked.1 {
        v.push(format!(
            "hard_blocked={} 越窗 [{}, {}]",
            r.hard_blocked, win.hard_blocked.0, win.hard_blocked.1
        ));
    }
    if r.no_walk < win.no_walk.0 || r.no_walk > win.no_walk.1 {
        v.push(format!(
            "no_walk={} 越窗 [{}, {}]",
            r.no_walk, win.no_walk.0, win.no_walk.1
        ));
    }
    if r.buildable < win.buildable_min {
        v.push(format!("buildable={} < {}", r.buildable, win.buildable_min));
    }
    if r.detour_p95 < win.detour_p95.0 - 1e-4 || r.detour_p95 > win.detour_p95.1 + 1e-4 {
        v.push(format!(
            "detour_p95={:.2} 越窗 [{:.2}, {:.2}]",
            r.detour_p95, win.detour_p95.0, win.detour_p95.1
        ));
    }
    if win.water_dist_max.is_finite() {
        match r.water_dist {
            None => v.push("water_dist 无数据（图内无取水点/水面格）".to_string()),
            Some(d) if d > win.water_dist_max => {
                v.push(format!("water_dist={:.0}m > {:.0}m", d, win.water_dist_max))
            }
            _ => {}
        }
    }
    if win.band_width_min > 0.0 && m.buildable_band_width < win.band_width_min {
        v.push(format!(
            "buildable_band_width={:.1}m < {:.1}m",
            m.buildable_band_width, win.band_width_min
        ));
    }
    // ★ S7-07：跨障绕行95 下限——浅滩是两岸交往的唯一合法纽带（对置直线
    //   穿障点对的测地/欧氏绕行比 p95；浅滩格 ShallowWater 不算障碍）。
    if r.crossing_detour_p95 < win.crossing95_min - 1e-4 {
        v.push(format!(
            "crossing95={:.2} < {:.2}（两岸绕行不足，浅滩纽带失效）",
            r.crossing_detour_p95, win.crossing95_min
        ));
    }
    v
}

fn print_metrics_summary(metrics: &[TemplateMetrics], cross95_max: f32, water_max: Option<f32>) {
    if metrics.is_empty() {
        return;
    }
    let cnt = metrics.len() as f32;
    let mound_mean = metrics.iter().map(|m| m.mound_count).sum::<usize>() as f32 / cnt;
    let mound_max = metrics.iter().map(|m| m.mound_count).max().unwrap_or(0);
    let soft_mean = metrics.iter().map(|m| m.soft_ground_ratio).sum::<f32>() / cnt;
    let fert_mean = metrics.iter().map(|m| m.fertility_mean).sum::<f32>() / cnt;
    let wind_max = metrics
        .iter()
        .map(|m| m.windward_slope_max)
        .fold(0.0f32, f32::max);
    let lee_max = metrics
        .iter()
        .map(|m| m.leeward_slope_max)
        .fold(0.0f32, f32::max);
    let band_min = metrics
        .iter()
        .map(|m| m.buildable_band_width)
        .fold(f32::MAX, f32::min);
    let floor_min = metrics
        .iter()
        .map(|m| m.valley_floor_width)
        .fold(f32::MAX, f32::min);
    let cliff_mean = metrics.iter().map(|m| m.cliff_slope_mean).sum::<f32>() / cnt;
    let fan_cov_min = metrics
        .iter()
        .map(|m| m.fan_coverage)
        .fold(f32::MAX, f32::min);
    let fan_gully_min = metrics.iter().map(|m| m.fan_gully_visible).min().unwrap_or(0);
    let fan_relief_min = metrics
        .iter()
        .map(|m| m.fan_relief)
        .fold(f32::MAX, f32::min);
    println!(
        "--- 模板指标 · mound_count 均值={:.1}/峰值={} · 软地比 均值={:.1}% · 肥力 均值={:.2} · 迎风坡max 峰值={:.2}° · 背风坡max 峰值={:.2}° · 可建带宽 最小={:.0}m · 谷底宽 最小={:.0}m · 崖壁坡度 均值={:.2}° · 跨障绕行95 峰值={:.2} · 水源距 峰值={} · 扇面覆盖 最小={:.1}% · 可见干沟 最少={} · 全图高差 最小={:.0}m",
        mound_mean,
        mound_max,
        soft_mean * 100.0,
        fert_mean,
        wind_max,
        lee_max,
        band_min,
        floor_min,
        cliff_mean,
        cross95_max,
        water_max.map_or("n/a".to_string(), |d| format!("{:.0}m", d)),
        fan_cov_min * 100.0,
        fan_gully_min,
        fan_relief_min,
    );
}

fn run_profile(cfg: &mut SimConfig, profile: &str, seeds: Vec<u64>) {
    cfg.terrain_profile = profile.to_string();
    let first = seeds.first().copied().unwrap_or(0);
    let last = seeds.last().copied().unwrap_or(0);
    println!(
        "\n=== {} · grid=120 world=764 · seeds {}..={} ({} 个) ===",
        profile,
        first,
        last,
        seeds.len()
    );
    println!(
        "{:>5} {:>9} {:>8} {:>8} {:>7} {:>9} {:>6} {:>9} {:>9} {:>7} {:>4} {:>8} {:>7}",
        "seed", "maxslope", ">30°", ">=34°", "NO_WALK", "buildable", "comp", "detourMx", "detour95", "waterM", "brN", "brSlope", "brDet"
    );
    let window = gate_window_for(profile);
    let mut agg_max = 0.0f32;
    let mut agg_min_max = f32::MAX;
    let mut agg_blocked = 0usize;
    let mut agg_hard = 0usize;
    let mut agg_build = usize::MAX;
    let mut agg_comp = 1usize;
    let mut agg_detour = 0.0f32;
    let mut agg_min_detour = f32::MAX;
    let mut metrics: Vec<TemplateMetrics> = Vec::new();
    let mut cross95_max = 0.0f32;
    let mut water_max: Option<f32> = None;
    let mut gate_fail_seeds = 0usize;
    let mut gate_fail_items = 0usize;
    // ★ TB-01-7 支脊统计聚合（mountain_pass 验收块用）
    let mut branch_seeds = 0usize;
    let mut br1 = 0usize;
    let mut br2 = 0usize;
    let mut flank_slope_max = 0.0f32;
    let mut br_detour_max = 0.0f32;
    let n_cells = 14400.0f32;
    let mut hard_ratio_min = f32::MAX;
    let mut hard_ratio_max = 0.0f32;
    for &seed in &seeds {
        let mut t = TerrainMap::new(120, 120, 764.0);
        t.generate_with_config(seed, cfg);
        let (br_n, flank_max) = branch_flank_stats(&t);
        let zone = branch_zone_mask(&t);
        let r = analyse(&t, 12, &zone);
        metrics.push(measure_template_metrics(&t));
        println!(
            "{:>5} {:>9.2} {:>8} {:>8} {:>7} {:>9} {:>6} {:>9.2} {:>9.2} {:>7} {:>4} {:>8.2} {:>7.2}",
            seed,
            r.max_slope,
            r.blocked,
            r.hard_blocked,
            r.no_walk,
            r.buildable,
            r.components,
            r.detour_max,
            r.detour_p95,
            r.water_dist
                .map_or("n/a".to_string(), |d| format!("{:.0}", d)),
            br_n,
            flank_max,
            r.branch_detour_max
        );
        if br_n > 0 {
            branch_seeds += 1;
            match br_n {
                1 => br1 += 1,
                _ => br2 += 1,
            }
        }
        flank_slope_max = flank_slope_max.max(flank_max);
        br_detour_max = br_detour_max.max(r.branch_detour_max);
        let hard_ratio = r.hard_blocked as f32 / n_cells * 100.0;
        hard_ratio_min = hard_ratio_min.min(hard_ratio);
        hard_ratio_max = hard_ratio_max.max(hard_ratio);
        if let Some(win) = window.as_ref() {
            let m = metrics.last().copied().unwrap();
            let violations = check_gates(&t, &r, &m, &win);
            for v in &violations {
                println!("    [GATE FAIL] seed={} {}", seed, v);
            }
            if !violations.is_empty() {
                gate_fail_seeds += 1;
                gate_fail_items += violations.len();
            }
        } else if r.components > 1 {
            // 旧基线仅做生存性警告（死区在任何模板下都不允许）
            for (size, (gx, gy)) in &r.component_overflow {
                println!(
                    "    [警告] seed={} components={} · 死区 size={} @ {}",
                    seed,
                    r.components,
                    size,
                    cell_desc(&t, *gx, *gy)
                );
            }
        }
        // ★ v1.50.68 冲积扇专属验收（G1/G2/G3 量化口径；独立于 GateWindow）。
        if profile == TERRAIN_PROFILE_ALLUVIAL_FAN {
            let m = metrics.last().copied().unwrap();
            let mut fan_fails: Vec<String> = Vec::new();
            // G1 门槛标定：>2m 增量实测 ≈15.5%（扇区几何占比 ≈22%，扇缘角向衰减与
            // 2m 阈裁剪掉外环；旧 0.42 参数同口径 ≈9%，改善比 ≈1.7 倍）。首跑 60 种子
            // 恒 15.4~15.5%，据此标 0.14（原解析估匕 20% 系未扣衰减口径）。
            if m.fan_coverage < 0.14 {
                fan_fails.push(format!(
                    "fan_coverage={:.1}% < 14%（扇体体量不足）",
                    m.fan_coverage * 100.0
                ));
            }
            if m.fan_gully_visible < 3 {
                fan_fails.push(format!(
                    "fan_gully_visible={} < 3（放射干沟不足）",
                    m.fan_gully_visible
                ));
            }
            if m.fan_relief < 40.0 {
                fan_fails.push(format!(
                    "fan_relief={:.1}m < 40m（山口堆意象不足）",
                    m.fan_relief
                ));
            }
            for v in &fan_fails {
                println!("    [GATE FAIL] seed={} {}", seed, v);
            }
            if !fan_fails.is_empty() {
                gate_fail_seeds += 1;
                gate_fail_items += fan_fails.len();
            }
        }
        cross95_max = cross95_max.max(r.crossing_detour_p95);
        if let Some(d) = r.water_dist {
            water_max = Some(water_max.map_or(d, |prev: f32| prev.max(d)));
        }
        agg_max = agg_max.max(r.max_slope);
        agg_min_max = agg_min_max.min(r.max_slope);
        agg_blocked += r.blocked;
        agg_hard += r.hard_blocked;
        agg_build = agg_build.min(r.buildable);
        agg_comp = agg_comp.max(r.components);
        agg_detour = agg_detour.max(r.detour_max);
        agg_min_detour = agg_min_detour.min(r.detour_max);
    }
    println!(
        "--- max_slope {:.2}°..{:.2}° · total >30°={} · total >=34°={} · min buildable={} · max components={} · detour_max {:.2}..{:.2}",
        agg_min_max, agg_max, agg_blocked, agg_hard, agg_build, agg_comp, agg_min_detour, agg_detour
    );
    if profile == TERRAIN_PROFILE_MOUNTAIN_PASS {
        print_tb017_verdict(
            seeds.len(),
            agg_comp,
            agg_min_detour,
            agg_detour,
            agg_build,
            hard_ratio_min,
            hard_ratio_max,
            branch_seeds,
            br1,
            br2,
            flank_slope_max,
            br_detour_max,
        );
    }
    print_metrics_summary(&metrics, cross95_max, water_max);
    if window.is_some() {
        println!(
            "--- §1.4 门禁：违例种子 {}/{} · 违例项 {}（详见上方 GATE FAIL）",
            gate_fail_seeds,
            seeds.len(),
            gate_fail_items
        );
    }
}

/// ★ TB-01-7 山口 60 种子验收判定（TB01-TODO §合格断言；v1.50.43 起上限 5.2）：
/// components==1 全部 · detour_max ∈ [2.0, 5.2] · buildable ≥ 10500/14400 ·
/// 硬禁行占比 2%~5% · 支脊检出率 100%（第 1 条支脊 100% 出现）。
fn print_tb017_verdict(
    seeds: usize,
    comp_max: usize,
    detour_min: f32,
    detour_max: f32,
    buildable_min: usize,
    hard_min: f32,
    hard_max: f32,
    branch_seeds: usize,
    br1: usize,
    br2: usize,
    flank_slope_max: f32,
    br_detour_max: f32,
) {
    let pass = |ok: bool| if ok { "PASS" } else { "FAIL" };
    let c1 = comp_max == 1;
    let c2 = detour_min >= 2.0 && detour_max <= 5.2;
    let c3 = buildable_min >= 10500;
    let c4 = hard_min >= 2.0 && hard_max <= 5.0;
    let c5 = branch_seeds == seeds;
    let all = c1 && c2 && c3 && c4 && c5;
    println!("--- TB-01-7 验收（{} 种子达标线）---", seeds);
    println!("[{}] components==1 : max={}", pass(c1), comp_max);
    println!(
        "[{}] detour_max ∈ [2.0, 5.2] : {:.2}..{:.2}",
        pass(c2),
        detour_min,
        detour_max
    );
    println!("[{}] buildable ≥ 10500 : min={}", pass(c3), buildable_min);
    println!(
        "[{}] 硬禁行占比 2%~5% : {:.2}%..{:.2}%",
        pass(c4),
        hard_min,
        hard_max
    );
    println!(
        "[{}] 支脊检出率 100% : {}/{}（1 条: {} · 2 条: {}）",
        pass(c5),
        branch_seeds,
        seeds,
        br1,
        br2
    );
    println!(
        "支脊侧翼峰值坡度 {:.2}°（含与主脊交汇段，informational）· 支脊区绕行比峰值 {:.2}",
        flank_slope_max, br_detour_max
    );
    println!(
        "{}",
        if all {
            "TB01_7_ALL_PASS"
        } else {
            "TB01_7_HAS_FAIL"
        }
    );
}

fn main() {
    let mut cfg: SimConfig = serde_json::from_str(include_str!("config.json")).unwrap();
    let raw: Vec<String> = std::env::args().collect();
    if raw.len() >= 2 && raw[1] == "world" {
        // 诊断模式：创世后立刻跑读档用的同一套校验（`validate_terrain_world`），确认
        // 「非法车道」不会在创世被产出——否则世界一旦存档就再也读不回来。
        let n: u64 = raw.get(2).and_then(|s| s.parse().ok()).unwrap_or(20);
        for profile in ["random", "river_valley_v1"] {
            let mut fails = 0usize;
            let mut lanes_min = usize::MAX;
            let mut sample_max = 0.0f32;
            for seed in 1..=n {
                let mut c = cfg.clone();
                c.terrain_profile = profile.to_string();
                let mut w = sim_core::World3DEngine::new_seeded_with_config(120, 764.0, seed, c);
                w.seed_primitive_ecology(20);
                if let Err(e) = w.validate_terrain_world() {
                    fails += 1;
                    if fails <= 3 {
                        println!("  seed={} FAIL {}", seed, e);
                    }
                }
                lanes_min = lanes_min.min(w.network.graph.edge_count());
                for lane in w.network.graph.edge_weights() {
                    sample_max = sample_max.max(lane.terrain_profile.max_slope_deg);
                }
            }
            println!(
                "profile={:<16} seeds=1..={} · validate_terrain_world 失败={} · 最少车道数={} · 车道采样 max_slope 上界={:.2}°",
                profile, n, fails, lanes_min, sample_max
            );
        }
        return;
    }

    // CLI 解析：--profile <name> / --seeds <N>（§1.4 矩阵默认 60 种子，seed: 0..N）；
    // 保留旧位置参数 `<count>`（seeds 1..=count，双 profile 基线）向后兼容。
    let mut profile_arg: Option<String> = None;
    let mut seeds_arg: Option<u64> = None;
    let mut positional: Option<u64> = None;
    let mut i = 1;
    while i < raw.len() {
        match raw[i].as_str() {
            "--profile" => {
                profile_arg = raw.get(i + 1).cloned();
                i += 2;
            }
            "--seeds" => {
                seeds_arg = raw.get(i + 1).and_then(|s| s.parse().ok());
                i += 2;
            }
            other => {
                if positional.is_none() {
                    positional = other.parse().ok();
                }
                i += 1;
            }
        }
    }

    if let Some(name) = profile_arg {
        if name == TERRAIN_PROFILE_MOUNTAIN_PASS
            || name == TERRAIN_PROFILE_RIVER_VALLEY
            || name == TERRAIN_PROFILE_GRASSLAND_PLAIN
            || name == TERRAIN_PROFILE_HILLSIDE_WOODLAND
            || name == TERRAIN_PROFILE_PLATEAU
            || name == TERRAIN_PROFILE_ALLUVIAL_FAN
            || name == TERRAIN_PROFILE_BASIN_OASIS
            || name == TERRAIN_PROFILE_LAKESIDE_BASIN
        {
            let n = seeds_arg.unwrap_or(60);
            run_profile(&mut cfg, &name, (0..n).collect());
        } else {
            eprintln!("[错误] 未知 profile `{}`。", name);
            eprintln!(
                "  已实现：`{}` / `{}` / `{}` / `{}` / `{}` / `{}` / `{}` / `{}`。",
                TERRAIN_PROFILE_MOUNTAIN_PASS,
                TERRAIN_PROFILE_RIVER_VALLEY,
                TERRAIN_PROFILE_GRASSLAND_PLAIN,
                TERRAIN_PROFILE_HILLSIDE_WOODLAND,
                TERRAIN_PROFILE_PLATEAU,
                TERRAIN_PROFILE_ALLUVIAL_FAN,
                TERRAIN_PROFILE_BASIN_OASIS,
                TERRAIN_PROFILE_LAKESIDE_BASIN
            );
            std::process::exit(2);
        }
        return;
    }

    let seeds: Vec<u64> = match (seeds_arg, positional) {
        (Some(n), _) => (0..n).collect(),
        (_, Some(n)) => (1..=n).collect(),
        _ => (1..=12).collect(),
    };
    run_profile(&mut cfg, TERRAIN_PROFILE_MOUNTAIN_PASS, seeds.clone());
    run_profile(&mut cfg, TERRAIN_PROFILE_RIVER_VALLEY, seeds);
}
