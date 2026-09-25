//! Deterministic, explainable gameplay constraints.
use super::fields::Field2;
use super::ir::TerrainConstraint;
use super::semantics::SemanticGrid;
use std::collections::BTreeSet;
#[derive(Debug, Clone, PartialEq)]
pub struct ConstraintReport {
    pub passed: bool,
    pub code: String,
    pub measured: f32,
    pub expected: String,
    pub affected_nodes: Vec<u16>,
}
pub fn evaluate(
    constraints: &[TerrainConstraint],
    semantics: &SemanticGrid,
) -> Vec<ConstraintReport> {
    constraints
        .iter()
        .map(|c| match c {
            TerrainConstraint::BuildableArea { min_cells } => {
                let m = semantics
                    .build_mask
                    .values
                    .iter()
                    .filter(|v| **v > 0.5)
                    .count() as f32;
                report(
                    m >= *min_cells as f32,
                    "BUILDABLE_AREA",
                    m,
                    min_cells.to_string(),
                )
            }
            TerrainConstraint::MaxSlope { max_deg } => {
                let m = semantics
                    .slope_deg
                    .values
                    .iter()
                    .copied()
                    .fold(0.0, f32::max);
                report(m <= *max_deg, "MAX_SLOPE", m, max_deg.to_string())
            }
            TerrainConstraint::WalkableComponents { min, max } => {
                let m = components(&semantics.walk_mask) as f32;
                report(
                    m >= *min as f32 && m <= *max as f32,
                    "WALKABLE_COMPONENTS",
                    m,
                    format!("{min}..={max}"),
                )
            }
            TerrainConstraint::WaterSourceCount { min, max } => {
                let m = semantics
                    .water_body_id
                    .iter()
                    .flatten()
                    .copied()
                    .collect::<BTreeSet<_>>()
                    .len() as f32;
                report(
                    m >= *min as f32 && m <= *max as f32,
                    "WATER_SOURCE_COUNT",
                    m,
                    format!("{min}..={max}"),
                )
            }
            _ => report(
                false,
                "UNSUPPORTED_CONSTRAINT",
                0.0,
                "constraint requires a compiled route/feature context".into(),
            ),
        })
        .collect()
}
fn report(passed: bool, code: &str, measured: f32, expected: String) -> ConstraintReport {
    ConstraintReport {
        passed,
        code: code.into(),
        measured,
        expected,
        affected_nodes: Vec::new(),
    }
}
fn components(mask: &Field2) -> usize {
    let mut seen = vec![false; mask.values.len()];
    let mut count = 0;
    for y in 0..mask.height {
        for x in 0..mask.width {
            let i = y * mask.width + x;
            if seen[i] || mask.values[i] < 0.5 {
                continue;
            }
            count += 1;
            let mut q = vec![(x, y)];
            seen[i] = true;
            while let Some((cx, cy)) = q.pop() {
                for (nx, ny) in [
                    (cx.wrapping_sub(1), cy),
                    (cx + 1, cy),
                    (cx, cy.wrapping_sub(1)),
                    (cx, cy + 1),
                ] {
                    if nx < mask.width && ny < mask.height {
                        let ni = ny * mask.width + nx;
                        if !seen[ni] && mask.values[ni] >= 0.5 {
                            seen[ni] = true;
                            q.push((nx, ny));
                        }
                    }
                }
            }
        }
    }
    count
}
