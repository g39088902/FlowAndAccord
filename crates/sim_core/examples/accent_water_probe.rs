//! 装饰落点禁区探针（诊断示例，不进入测试套件）。
//!
//! 用途：直接调用内核生成器，实测「★ v1.52.0 两条落点禁区契约」是否成立——
//! ① 地图边缘 3%（× world_size）保护带内装饰数恒 0；
//! ② 装饰中心距「渲染水面多边形」（`hydrology.water_bodies`，与前端
//!    `drawRiverBand` / `drawWaterBodyTile` 同源）恒 ≥ `WATER_CLEARANCE_M`。
//!
//! 输出列：`total` 装饰总数 / `inW0` 落在水面多边形内 / `d<1.5`·`d<3`·`d<6` 距水线
//! 分别小于 1.5m·3m·6m 的数量 / `cellW` 落在水格（应为 0，另由生成器外层禁区保证）/
//! `edge3%` 落在边缘保护带内 / `minD` 最近的「装饰中心↔水线」距离 / `nPoly`·`polyV`
//! 水面多边形数与首个体顶点数（无水面模板为 0 / 0，`minD` 为 `f32::MAX`）。
//! 每模板 seed=1 追加逐种类拆解（数量 / 水内 / 边缘带）。
//!
//! 运行：`cargo run --release -p sim_core --example accent_water_probe`
//! 契约判读：`inW0 == 0`、`d<3 == 0`、`edge3% == 0`、`cellW == 0`、`minD ≥ 3.0`，
//! 且各模板 `total` 与预算公式（八模板 217 / 1025 / 337）一致（即未因拒绝而饥饿）。

use sim_core::config::SimConfig;
use sim_core::geo::biome::SurfaceKind;
use sim_core::geo::terrain::TerrainMap;
use sim_core::geo::accents::AccentKind;

fn point_in_poly(v: &[sim_core::spatial::vec3::Vec3], x: f32, y: f32) -> bool {
    if v.len() < 4 {
        return false;
    }
    let mut inside = false;
    let mut j = v.len() - 1;
    for i in 0..v.len() {
        let (xi, yi) = (v[i].x, v[i].y);
        let (xj, yj) = (v[j].x, v[j].y);
        if ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn dist_to_poly(v: &[sim_core::spatial::vec3::Vec3], x: f32, y: f32) -> f32 {
    let mut best = f32::MAX;
    let n = v.len();
    for i in 0..n {
        let a = v[i];
        let b = v[(i + 1) % n];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let l2 = dx * dx + dy * dy;
        let t = if l2 <= 1e-9 {
            0.0
        } else {
            (((x - a.x) * dx + (y - a.y) * dy) / l2).clamp(0.0, 1.0)
        };
        let px = a.x + t * dx;
        let py = a.y + t * dy;
        best = best.min(((x - px).powi(2) + (y - py).powi(2)).sqrt());
    }
    best
}

fn kind_name(k: AccentKind) -> &'static str {
    k.as_str()
}

fn main() {
    let cfg: SimConfig = serde_json::from_str(include_str!("config.json")).unwrap();
    let profiles = [
        "mountain_pass_v1",
        "river_valley_v1",
        "grassland_plain_v1",
        "hillside_woodland_v1",
        "plateau_v1",
        "basin_oasis_v1",
        "alluvial_fan_v1",
        "lakeside_basin_v1",
    ];
    println!(
        "{:>20} {:>4} {:>6} {:>8} {:>8} {:>8} {:>8} {:>7} {:>7} {:>7} {:>9} {:>7}",
        "profile",
        "seed",
        "total",
        "inW0",
        "d<1.5",
        "d<3",
        "d<6",
        "cellW",
        "edge3%",
        "minD",
        "nPoly",
        "polyV"
    );
    for p in profiles {
        let mut c = cfg.clone();
        c.terrain_profile = p.to_string();
        for seed in 1..=8u64 {
            let mut t = TerrainMap::new(256, 256, 764.0);
            t.generate_with_config(seed, &c);
            let polys: Vec<&Vec<sim_core::spatial::vec3::Vec3>> =
                t.hydrology.water_bodies.iter().map(|w| &w.vertices).collect();
            let half = t.world_size * 0.5;
            let margin = t.world_size * 0.03;
            let (mut total, mut in0, mut m15, mut m3, mut m6) = (0, 0, 0, 0, 0);
            let (mut cell_w, mut edge) = (0, 0);
            let mut min_d = f32::MAX;
            for a in &t.accents {
                total += 1;
                let mut d = f32::MAX;
                let mut inside = false;
                for pl in &polys {
                    if point_in_poly(pl, a.pos.x, a.pos.y) {
                        inside = true;
                    }
                    d = d.min(dist_to_poly(pl, a.pos.x, a.pos.y));
                }
                if inside {
                    in0 += 1;
                }
                if inside || d < 1.5 {
                    m15 += 1;
                }
                if inside || d < 3.0 {
                    m3 += 1;
                }
                if inside || d < 6.0 {
                    m6 += 1;
                }
                min_d = min_d.min(d);
                let k = t.sample_cell(a.pos.x, a.pos.y).surface_kind;
                if k == SurfaceKind::DeepWater || k == SurfaceKind::ShallowWater {
                    cell_w += 1;
                }
                if a.pos.x.abs() > half - margin || a.pos.y.abs() > half - margin {
                    edge += 1;
                }
            }
            let pv = polys.first().map(|v| v.len()).unwrap_or(0);
            println!(
                "{:>20} {:>4} {:>6} {:>8} {:>8} {:>8} {:>8} {:>7} {:>7} {:>7.2} {:>9} {:>7}",
                p, seed, total, in0, m15, m3, m6, cell_w, edge, min_d, polys.len(), pv
            );
            if seed == 1 {
                // 逐种类拆解（水内 + 边缘带）
                let mut per: Vec<(AccentKind, usize, usize, usize)> = Vec::new();
                for k in [
                    AccentKind::Tree,
                    AccentKind::Bush,
                    AccentKind::Boulder,
                    AccentKind::RockCluster,
                    AccentKind::GrassTuft,
                ] {
                    let n = t.accents.iter().filter(|a| a.kind == k).count();
                    let w = t
                        .accents
                        .iter()
                        .filter(|a| a.kind == k)
                        .filter(|a| polys.iter().any(|pl| point_in_poly(pl, a.pos.x, a.pos.y)))
                        .count();
                    let e = t
                        .accents
                        .iter()
                        .filter(|a| a.kind == k)
                        .filter(|a| {
                            a.pos.x.abs() > half - margin || a.pos.y.abs() > half - margin
                        })
                        .count();
                    per.push((k, n, w, e));
                }
                for (k, n, w, e) in per {
                    println!("      {:<12} n={:<5} inWater={:<4} edge={}", kind_name(k), n, w, e);
                }
            }
        }
    }
}
