//! Stable static groundwater approximation for creation-time fields.
use super::fields::{Field2, FieldError};
#[derive(Debug, Clone)]
pub struct GroundwaterFields {
    pub recharge: Field2,
    pub water_table: Field2,
    pub aquifer_mask: Vec<bool>,
    pub discharge: Field2,
    pub water_access: Field2,
    pub soil_moisture: Field2,
}
pub fn solve_groundwater(
    rainfall: &Field2,
    permeability: &Field2,
    storage: &Field2,
) -> Result<GroundwaterFields, FieldError> {
    if rainfall.width != permeability.width
        || rainfall.width != storage.width
        || rainfall.height != permeability.height
        || rainfall.height != storage.height
    {
        return Err(FieldError::SizeMismatch);
    }
    let recharge = Field2::from_values(
        rainfall.width,
        rainfall.height,
        rainfall
            .values
            .iter()
            .zip(&permeability.values)
            .map(|(r, p)| r.max(0.0) * p.clamp(0.0, 1.0))
            .collect(),
    )?;
    let water_table = Field2::from_values(
        rainfall.width,
        rainfall.height,
        recharge
            .values
            .iter()
            .zip(&storage.values)
            .map(|(r, s)| (r * s.max(0.0)).clamp(0.0, 1.0))
            .collect(),
    )?;
    let aquifer_mask = water_table.values.iter().map(|v| *v >= 0.35).collect();
    let discharge = water_table.clone();
    let water_access = water_table.clone();
    let soil_moisture = water_table.clone();
    Ok(GroundwaterFields {
        recharge,
        water_table,
        aquifer_mask,
        discharge,
        water_access,
        soil_moisture,
    })
}
