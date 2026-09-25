//! Stratigraphic sampling independent from visual palette choices.
use super::ir::{StratigraphicColumn, StratumSpec};
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StratumSample {
    pub id: u16,
    pub material: u8,
    pub hardness: f32,
    pub soil_storage: f32,
    pub permeability: f32,
    pub palette: u8,
}
pub fn sample_stratum(column: &StratigraphicColumn, depth: f32) -> Option<StratumSample> {
    if depth < 0.0 {
        return None;
    }
    let mut d = depth;
    for u in &column.units {
        if d <= u.thickness_m {
            return Some(StratumSample {
                id: u.id,
                material: u.material,
                hardness: u.hardness,
                soil_storage: u.soil_storage,
                permeability: u.permeability,
                palette: u.palette,
            });
        }
        d -= u.thickness_m;
    }
    None
}
pub fn validate_column(column: &StratigraphicColumn) -> bool {
    let mut ids = std::collections::BTreeSet::new();
    !column.units.is_empty()
        && column.units.iter().all(|u: &StratumSpec| {
            u.thickness_m.is_finite()
                && u.thickness_m > 0.0
                && u.hardness.is_finite()
                && u.soil_storage.is_finite()
                && u.permeability.is_finite()
                && ids.insert(u.id)
        })
}
