//! 地形通行力探针（诊断示例，不进入测试套件）。
//!
//! 用途：对 T1 `mountain_pass_v1` / T2 `river_valley_v1` 直接调用内核生成器，实测
//! 「主脊是否真的挡路」。对应 `docs/plan/tech/06-terrain-templates.md` §9.3.1。
//!
//! 运行：`cargo run --release -p sim_core --example terrain_probe [种子数]`
//!（TB-01-7 验收命令：`cargo run --release -p sim_core --example terrain_probe -- 60`）
//!
//! 关键指标：
//! - `max_slope_deg`：全图最大格子坡度。低于 `terrain_max_walk_slope`(30°) 则永远不挡路。
//! - `blocked_cells`：`slope > 30°` 的格子数（走廊校验会拒绝这些格）。
//! - `hard_blocked_cells`：`slope >= 34°` 即 `RockFace`/`NO_WALK` 的格子数（真正的硬墙）。
//! - `components`：可行走格子的连通分量数。>1 说明有区域被封死（生存风险）。
//! - `detour_max` / `detour_p95`：测地距离 / 欧氏距离。≈1.0 表示地形完全无阻碍；
//!   出现明显 >1.5 的样本才说明「近在咫尺却必须绕行」，即山口玩法成立。
//! - ★ TB-01-7 支脊统计：`brN` 检出支脊条数（来自 `TerrainMap::branch_ridges`）；
//!   `brSlope` 支脊侧翼（|d⊥| ≤ width）峰值坡度；`brDet` 直线穿越支脊影响区
//!   （|d⊥| ≤ 1.5×width）的样本对绕行比最大值——支脊形成次级自然绕行的直接证据。
//!   末尾按 TB-01-7 达标线输出 60 种子验收判定（components==1 / detour 2.0~4.8 /
//!   buildable ≥10500 / 硬禁行 2%~5% / 支脊检出率 100%）。

use sim_core::config::SimConfig;
use sim_core::geo::biome::TERRAIN_FLAG_NO_WALK;
use sim_core::geo::{BranchRidge, SurfaceKind, TerrainMap};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, VecDeque};

const WALK_SLOPE: f32 = 30.0; // SimConfig::terrain_max_walk_slope
const ROCK_SLOPE: f32 = 34.0; // SurfaceKind::RockFace 阈值

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

/// 格点 → 世界坐标（与 terrain.rs generate_with_profile 同一口径）。
fn cell_world(t: &TerrainMap, gx: usize, gy: usize) -> (f32, f32) {
    let half = t.world_size * 0.5;
    let wx = if t.grid_width <= 1 {
        0.0
    } else {
        (gx as f32 / (t.grid_width - 1) as f32) * t.world_size - half
    };
    let wy = if t.grid_height <= 1 {
        0.0
    } else {
        (gy as f32 / (t.grid_height - 1) as f32) * t.world_size - half
    };
    (wx, wy)
}

/// 支脊轴线局部坐标：(沿轴 d∥, 垂轴 d⊥)。
fn branch_coords(br: &BranchRidge, wx: f32, wy: f32) -> (f32, f32) {
    let dx = wx - br.root_x;
    let dy = wy - br.root_y;
    (dx * br.dir_x + dy * br.dir_y, -dx * br.dir_y + dy * br.dir_x)
}

/// 支脊统计：检出条数 + 侧翼（|d⊥| ≤ width 且 0≤d∥≤L）峰值坡度。
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

/// 支脊影响区掩码（|d⊥| ≤ 1.5×width 且 0≤d∥≤L，外扩 1 格防漏边）：
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
                if (0.0..=br.length).contains(&d_par)
                    && d_perp.abs() <= 1.5 * br.width + step
                {
                    mask[gy * t.grid_width + gx] = true;
                    break;
                }
            }
        }
    }
    mask
}
struct Report {
    max_slope: f32,
    blocked: usize,
    hard_blocked: usize,
    no_walk: usize,
    buildable: usize,
    components: usize,
    detour_max: f32,
    detour_p95: f32,
    /// 直线穿越支脊影响区的样本对中的最大绕行比（无支脊或无穿越对时为 0）。
    branch_detour_max: f32,
    /// 穿越支脊影响区的样本对数。
    branch_detour_n: usize,
}

/// 线段 src→dst 是否穿过支脊影响区：按格步长采样（影响区半宽 ≥1.5×width ≈ 60m，
/// 远大于格步 6.4m，步长采样不会漏穿）。
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

fn analyse(t: &TerrainMap, sample_sources: usize, zone: &[bool]) -> Report {
    let n = t.cells.len();
    let mut max_slope = 0.0f32;
    let mut blocked = 0usize;
    let mut hard = 0usize;
    let mut no_walk = 0usize;
    let mut buildable = 0usize;
    for i in 0..n {
        let s = t.cells[i].slope_angle_deg;
        if s > max_slope {
            max_slope = s;
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

    // 连通分量
    let mut seen = vec![false; n];
    let mut components = 0usize;
    let mut walkable: Vec<usize> = Vec::new();
    for start in 0..n {
        if seen[start] || !is_walkable(t, start) {
            continue;
        }
        components += 1;
        let mut q = VecDeque::new();
        q.push_back(start);
        seen[start] = true;
        while let Some(i) = q.pop_front() {
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
    }

    // 测地 / 欧氏 绕行比
    let step = t.world_size / (t.grid_width.max(2) - 1) as f32;
    let diag = step * std::f32::consts::SQRT_2;
    let mut detours: Vec<f32> = Vec::new();
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
                if zone[dst] || seg_crosses_zone(t, zone, sx, sy, dx, dy) {
                    branch_detours.push(ratio);
                }
            }
        }
    }
    detours.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let detour_max = detours.last().copied().unwrap_or(0.0);
    let detour_p95 = if detours.is_empty() {
        0.0
    } else {
        detours[(detours.len() * 95 / 100).min(detours.len() - 1)]
    };
    let branch_detour_max = branch_detours
        .iter()
        .copied()
        .fold(0.0f32, f32::max);

    Report {
        max_slope,
        blocked,
        hard_blocked: hard,
        no_walk,
        buildable,
        components,
        detour_max,
        detour_p95,
        branch_detour_max,
        branch_detour_n: branch_detours.len(),
    }
}

/// TB-01-7 达标线（仅山口 profile 参与判定）：
/// components==1 全部 · detour_max ∈ [2.0, 5.2]（v1.50.43 修订，原 4.8 为 12 种子时代口径）·
/// buildable ≥ 10500/14400 ·
/// 硬禁行占比 2%~5% · 支脊检出率 100%（第 1 条支脊 100% 出现）。
fn print_verdict(
    seeds: usize,
    comp_ok: usize,
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
) -> bool {
    let pass = |ok: bool| if ok { "PASS" } else { "FAIL" };
    let c1 = comp_ok == seeds;
    let c2 = detour_min >= 2.0 && detour_max <= 5.2;
    let c3 = buildable_min >= 10500;
    let c4 = hard_min >= 2.0 && hard_max <= 5.0;
    let c5 = branch_seeds == seeds;
    let all = c1 && c2 && c3 && c4 && c5;
    println!("--- TB-01-7 验收（60 种子达标线）---");
    println!(
        "[{}] components==1 : {}/{}",
        pass(c1),
        comp_ok,
        seeds
    );
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
        "支脊侧翼峰值坡度 {:.2}°（<34° 硬禁行线为 informational）· 支脊区绕行比峰值 {:.2}",
        flank_slope_max, br_detour_max
    );
    println!("{}", if all { "TB01_7_ALL_PASS" } else { "TB01_7_HAS_FAIL" });
    all
}

fn main() {
    let mut cfg: SimConfig = serde_json::from_str(include_str!("config.json")).unwrap();
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 2 && args[1] == "world" {
        // 诊断模式：创世后立刻跑读档用的同一套校验（`validate_terrain_world`），确认
        // 「非法车道」不会在创世被产出——否则世界一旦存档就再也读不回来。
        let n: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(20);
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
    let count: u64 = args
        .get(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(12);
    let seeds: Vec<u64> = (1..=count).collect();
    for profile in ["mountain_pass_v1", "river_valley_v1"] {
        cfg.terrain_profile = profile.to_string();
        let is_pass_profile = profile == "mountain_pass_v1";
        println!(
            "\n=== {} · grid=120 world=764 · seeds 1..={} ===",
            profile, count
        );
        println!(
            "{:>5} {:>9} {:>8} {:>8} {:>7} {:>9} {:>6} {:>9} {:>9} {:>4} {:>8} {:>7} {:>7}",
            "seed", "maxslope", ">30°", ">=34°", "NO_WALK", "buildable", "comp", "detourMx", "detour95", "brN", "brSlope", "brDet", "brPairs"
        );
        let mut agg_max = 0.0f32;
        let mut agg_min_max = f32::MAX;
        let mut agg_blocked = 0usize;
        let mut agg_hard = 0usize;
        let mut agg_build = usize::MAX;
        let mut agg_comp = 1usize;
        let mut agg_detour = 0.0f32;
        let mut agg_min_detour = f32::MAX;
        // TB-01-7 验收聚合
        let mut comp_ok = 0usize;
        let mut buildable_min = usize::MAX;
        let mut hard_ratio_min = f32::MAX;
        let mut hard_ratio_max = 0.0f32;
        let mut branch_seeds = 0usize;
        let mut br1 = 0usize;
        let mut br2 = 0usize;
        let mut flank_slope_max = 0.0f32;
        let mut br_detour_max = 0.0f32;
        let n_cells = (120 * 120) as f32;
        for &seed in &seeds {
            let mut t = TerrainMap::new(120, 120, 764.0);
            t.generate_with_config(seed, &cfg);
            let (br_n, flank_max) = branch_flank_stats(&t);
            let zone = branch_zone_mask(&t);
            let r = analyse(&t, 12, &zone);
            println!(
                "{:>5} {:>9.2} {:>8} {:>8} {:>7} {:>9} {:>6} {:>9.2} {:>9.2} {:>4} {:>8.2} {:>7.2} {:>7}",
                seed,
                r.max_slope,
                r.blocked,
                r.hard_blocked,
                r.no_walk,
                r.buildable,
                r.components,
                r.detour_max,
                r.detour_p95,
                br_n,
                flank_max,
                r.branch_detour_max,
                r.branch_detour_n
            );
            agg_max = agg_max.max(r.max_slope);
            agg_min_max = agg_min_max.min(r.max_slope);
            agg_blocked += r.blocked;
            agg_hard += r.hard_blocked;
            agg_build = agg_build.min(r.buildable);
            agg_comp = agg_comp.max(r.components);
            agg_detour = agg_detour.max(r.detour_max);
            agg_min_detour = agg_min_detour.min(r.detour_max);
            if r.components == 1 {
                comp_ok += 1;
            }
            buildable_min = buildable_min.min(r.buildable);
            let hard_ratio = r.hard_blocked as f32 / n_cells * 100.0;
            hard_ratio_min = hard_ratio_min.min(hard_ratio);
            hard_ratio_max = hard_ratio_max.max(hard_ratio);
            flank_slope_max = flank_slope_max.max(flank_max);
            br_detour_max = br_detour_max.max(r.branch_detour_max);
            if br_n > 0 {
                branch_seeds += 1;
                match br_n {
                    1 => br1 += 1,
                    _ => br2 += 1,
                }
            }
        }
        println!(
            "--- max_slope {:.2}°..{:.2}° · total >30°={} · total >=34°={} · min buildable={} · max components={} · detour_max {:.2}..{:.2}",
            agg_min_max, agg_max, agg_blocked, agg_hard, agg_build, agg_comp, agg_min_detour, agg_detour
        );
        if is_pass_profile {
            print_verdict(
                seeds.len(),
                comp_ok,
                agg_min_detour,
                agg_detour,
                buildable_min,
                hard_ratio_min,
                hard_ratio_max,
                branch_seeds,
                br1,
                br2,
                flank_slope_max,
                br_detour_max,
            );
        }
    }
}
