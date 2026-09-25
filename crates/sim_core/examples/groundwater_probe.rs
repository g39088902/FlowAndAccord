//! UGC-08 static groundwater and vegetation probe.
//!
//! Usage:
//! `cargo run --release -p sim_core --example groundwater_probe -- [profile] [seed] [grid]`

use sim_core::config::SimConfig;
use sim_core::geo::procedural::{builtin, BackendKind};
use sim_core::geo::TerrainGenerator;

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let profile = args
        .first()
        .map(String::as_str)
        .unwrap_or("grassland_plain_v1");
    let seed = args
        .get(1)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(42);
    let grid = args
        .get(2)
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(64)
        .max(2);
    let recipe = builtin(profile).unwrap_or_else(|| panic!("unknown recipe: {profile}"));
    let mut config = SimConfig::default();
    config.terrain_grid_res = grid;
    let compiled =
        TerrainGenerator::compile_procedural(seed, &recipe, &config, BackendKind::Heightfield)
            .unwrap_or_else(|error| panic!("UGC-08 compile failed: {}", error.code()));

    let hydro = &compiled.groundwater;
    let dry_threshold = recipe.hydrology.groundwater_dry_threshold;
    let grass_threshold = recipe.hydrology.groundwater_grass_threshold;
    let dry_cells = hydro
        .water_access
        .values
        .iter()
        .filter(|value| **value < dry_threshold)
        .count();
    let grass_cells = compiled
        .semantics
        .vegetation_ok
        .iter()
        .filter(|value| **value)
        .count();
    let aquifer_cells = hydro.aquifer_mask.iter().filter(|value| **value).count();
    let discharge_cells = hydro
        .discharge
        .values
        .iter()
        .filter(|value| **value > 0.0)
        .count();
    let access_min = hydro
        .water_access
        .values
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min);
    let access_max = hydro
        .water_access
        .values
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    let table_min = hydro
        .water_table
        .values
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min);
    let table_max = hydro
        .water_table
        .values
        .iter()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    let invalid_grass = compiled
        .semantics
        .vegetation_ok
        .iter()
        .zip(&hydro.water_access.values)
        .filter(|(grass, access)| **grass && **access < grass_threshold)
        .count();

    println!(
        "UGC08 profile={profile} seed={seed} grid={grid} dry_cells={dry_cells} grass_cells={grass_cells} aquifer_cells={aquifer_cells} discharge_cells={discharge_cells} table={table_min:.3}..{table_max:.3} access={access_min:.3}..{access_max:.3} invalid_grass={invalid_grass}"
    );
    for field in &compiled.diagnostics.fields {
        if matches!(
            field.name.as_str(),
            "recharge"
                | "water_table"
                | "aquifer_mask"
                | "discharge"
                | "water_access"
                | "soil_moisture"
                | "vegetation_ok"
        ) {
            println!("field={} hash={:016x}", field.name, field.hash);
        }
    }
}
