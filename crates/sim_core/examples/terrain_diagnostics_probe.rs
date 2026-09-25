//! UGC-09 profile diagnostics and finite uncertainty probe.
//!
//! Usage:
//! `cargo run --release -p sim_core --example terrain_diagnostics_probe -- [profile] [seed] [grid]`

use sim_core::config::SimConfig;
use sim_core::geo::procedural::{
    builtin, field_slice, BackendKind, ParameterRange, UncertaintySpec,
};
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
        .unwrap_or(48)
        .max(2);
    let mut recipe = builtin(profile).unwrap_or_else(|| panic!("unknown recipe: {profile}"));
    recipe.uncertainty = UncertaintySpec {
        candidate_count: 5,
        parameter_jitter: vec![
            ParameterRange {
                min: -1.0,
                max: 1.0,
            },
            ParameterRange { min: 0.0, max: 1.0 },
        ],
        keep_top_n: 3,
    };
    let mut config = SimConfig::default();
    config.terrain_grid_res = grid;
    let compiled =
        TerrainGenerator::compile_procedural(seed, &recipe, &config, BackendKind::Heightfield)
            .unwrap_or_else(|error| panic!("UGC-09 compile failed: {}", error.code()));

    let profile_samples = compiled.profile_slice(
        [-compiled.world_size * 0.5, -compiled.world_size * 0.5],
        [compiled.world_size * 0.5, compiled.world_size * 0.5],
    );
    let elevation_slice = field_slice(
        "elevation",
        &compiled.fields.elevation,
        seed,
        compiled.diagnostics.recipe_hash,
        compiled.diagnostics.generator_version,
        "m",
        1000.0,
    );
    let json = compiled
        .diagnostics
        .to_json()
        .unwrap_or_else(|error| panic!("diagnostic JSON failed: {error}"));
    assert!(json.contains("candidate"));
    assert!(json.contains("confidence"));
    assert!(!profile_samples.is_empty());
    assert_eq!(elevation_slice.values.len(), grid * grid);
    assert_eq!(
        compiled.diagnostics.selected_candidate_hash,
        compiled.diagnostics.candidates[0].hash
    );
    assert!(compiled
        .diagnostics
        .candidates
        .windows(2)
        .all(|pair| pair[0].passed > pair[1].passed || pair[0].score >= pair[1].score));

    println!(
        "UGC09 profile={profile} seed={seed} grid={grid} candidates={} kept={} selected={:016x} confidence_hash={:016x} profile_samples={} elevation_slice={}x{}",
        recipe.uncertainty.candidate_count,
        compiled.diagnostics.candidates.len(),
        compiled.diagnostics.candidates[0].hash,
        compiled.diagnostics.confidence.hash,
        profile_samples.len(),
        elevation_slice.header.width,
        elevation_slice.header.height,
    );
    for candidate in &compiled.diagnostics.candidates {
        println!(
            "candidate index={} hash={:016x} score={:.6} passed={} params={:?}",
            candidate.index,
            candidate.hash,
            candidate.score,
            candidate.passed,
            candidate.parameters
        );
    }
    for sample in profile_samples.iter().take(3) {
        println!(
            "profile x={} y={} elevation={:.3} stratum={} water_table={:.3} material={} nodes={:?}",
            sample.x,
            sample.y,
            sample.elevation,
            sample.stratum_id,
            sample.water_table,
            sample.material,
            sample.source_nodes,
        );
    }
}
