//! 地形通行力探针（临时诊断示例，不进入测试套件）。
//!
//! 用途：对 T1 `mountain_pass_v1` / T2 `river_valley_v1` 直接调用内核生成器，实测
//! 「主脊是否真的挡路」。对应 `docs/22-plan-terrain-features.md` §7.3.1。
//!
//! 运行：`cargo run --release -p sim_core --example terrain_probe`
//!
//! 关键指标：
//! - `max_slope_deg`：全图最大格子坡度。低于 `terrain_max_walk_slope`(30°) 则永远不挡路。
//! - `blocked_cells`：`slope > 30°` 的格子数（走廊校验会拒绝这些格）。
//! - `hard_blocked_cells`：`slope >= 34°` 即 `RockFace`/`NO_WALK` 的格子数（真正的硬墙）。
//! - `components`：可行走格子的连通分量数。>1 说明有区域被封死（生存风险）。
//! - `detour_max` / `detour_p95`：测地距离 / 欧氏距离。≈1.0 表示地形完全无阻碍；
//!   出现明显 >1.5 的样本才说明「近在咫尺却必须绕行」，即山口玩法成立。

use sim_core::config::SimConfig;
use sim_core::geo::biome::TERRAIN_FLAG_NO_WALK;
use sim_core::geo::{SurfaceKind, TerrainMap};
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

struct Report {
    max_slope: f32,
    blocked: usize,
    hard_blocked: usize,
    no_walk: usize,
    buildable: usize,
    components: usize,
    detour_max: f32,
    detour_p95: f32,
}

fn analyse(t: &TerrainMap, sample_sources: usize) -> Report {
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
                detours.push(dist[dst] / euc);
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

    Report {
        max_slope,
        blocked,
        hard_blocked: hard,
        no_walk,
        buildable,
        components,
        detour_max,
        detour_p95,
    }
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
        println!(
            "\n=== {} · grid=120 world=764 · seeds 1..={} ===",
            profile, count
        );
        println!(
            "{:>5} {:>9} {:>8} {:>8} {:>7} {:>9} {:>6} {:>9} {:>9}",
            "seed", "maxslope", ">30°", ">=34°", "NO_WALK", "buildable", "comp", "detourMx", "detour95"
        );
        let mut agg_max = 0.0f32;
        let mut agg_min_max = f32::MAX;
        let mut agg_blocked = 0usize;
        let mut agg_hard = 0usize;
        let mut agg_build = usize::MAX;
        let mut agg_comp = 1usize;
        let mut agg_detour = 0.0f32;
        let mut agg_min_detour = f32::MAX;
        for &seed in &seeds {
            let mut t = TerrainMap::new(120, 120, 764.0);
            t.generate_with_config(seed, &cfg);
            let r = analyse(&t, 12);
            println!(
                "{:>5} {:>9.2} {:>8} {:>8} {:>7} {:>9} {:>6} {:>9.2} {:>9.2}",
                seed,
                r.max_slope,
                r.blocked,
                r.hard_blocked,
                r.no_walk,
                r.buildable,
                r.components,
                r.detour_max,
                r.detour_p95
            );
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
    }
}
