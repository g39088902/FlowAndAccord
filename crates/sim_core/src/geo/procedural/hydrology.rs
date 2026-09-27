//! Deterministic water-fact projection.
//!
//! The map no longer produces any procedural water surface, so this stage only
//! resets the water facts to empty/zero and derives the walk/build masks from
//! the accumulated terrain flags.
use super::fields::Field2;
use super::semantics::SemanticGrid;
use crate::geo::biome::{TERRAIN_FLAG_NO_BUILD, TERRAIN_FLAG_NO_WALK};

/// Apply water facts after all continuous fields are stable. Water bodies and
/// depth are always empty/zero; the walk/build masks are derived from flags so
/// existing hard blocks are preserved and never opened.
pub fn project_semantics(semantics: &mut SemanticGrid) {
    let n = semantics.surface_kind.len();
    semantics.water_body_id = vec![None; n];
    semantics.water_depth = Field2 {
        width: semantics.width,
        height: semantics.height,
        values: vec![0.0; n],
    };
    for i in 0..n {
        semantics.walk_mask.values[i] = if semantics.flags[i] & TERRAIN_FLAG_NO_WALK == 0 {
            1.0
        } else {
            0.0
        };
        semantics.build_mask.values[i] = if semantics.flags[i] & TERRAIN_FLAG_NO_BUILD == 0 {
            1.0
        } else {
            0.0
        };
    }
}