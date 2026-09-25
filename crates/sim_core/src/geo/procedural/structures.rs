//! Deterministic structural displacement and unconformity fields.
use super::fields::{Field2, FieldError};
use super::ir::{AxisSpec, PlaneSpec, StructuralEvent};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum StructureError {
    InvalidGeometry,
    InvalidParameters,
    UnknownSurface(u16),
    Field(FieldError),
    NonFiniteResult,
}

#[derive(Debug, Clone)]
pub struct StructureField {
    /// Per-cell amount by which the top of the stratigraphic column was
    /// removed, used when mapping depth to a stratum.
    pub strata_depth_offset: Field2,
    /// Stable indices of events that changed the elevation field.
    pub displaced_event_indices: Vec<usize>,
    /// Stable indices of unconformities that changed the strata offset.
    pub unconformity_event_indices: Vec<usize>,
}

/// Apply structural events in declared order using scratch fields. On error,
/// `elevation` is left untouched and no partial result is returned.
pub fn apply_structures(
    elevation: &mut Field2,
    events: &[StructuralEvent],
    node_fields: &BTreeMap<u16, Field2>,
    world_size: f32,
) -> Result<StructureField, StructureError> {
    if !world_size.is_finite() || world_size <= 0.0 {
        return Err(StructureError::InvalidGeometry);
    }
    let mut scratch = elevation.clone();
    let mut strata_depth_offset = Field2::new(elevation.width, elevation.height, 0.0)
        .map_err(StructureError::Field)?;
    let mut displaced_event_indices = Vec::new();
    let mut unconformity_event_indices = Vec::new();
    let cell_x = world_size / elevation.width.saturating_sub(1).max(1) as f32;
    let cell_y = world_size / elevation.height.saturating_sub(1).max(1) as f32;
    let half = world_size * 0.5;

    for (event_index, event) in events.iter().enumerate() {
        match event {
            StructuralEvent::Fault {
                plane,
                displacement_m,
            } => {
                let (nx, ny) = normalized_plane(plane)?;
                if !displacement_m.is_finite() {
                    return Err(StructureError::InvalidParameters);
                }
                let smoothing_width = cell_x.max(cell_y).max(1e-3) * 2.0;
                for y in 0..scratch.height {
                    for x in 0..scratch.width {
                        let wx = x as f32 * cell_x - half;
                        let wy = y as f32 * cell_y - half;
                        let signed_distance = (wx - plane.origin[0]) * nx
                            + (wy - plane.origin[1]) * ny;
                        let t = ((signed_distance / smoothing_width + 1.0) * 0.5)
                            .clamp(0.0, 1.0);
                        let smooth = t * t * (3.0 - 2.0 * t);
                        let i = y * scratch.width + x;
                        scratch.values[i] += smooth * displacement_m;
                    }
                }
                displaced_event_indices.push(event_index);
            }
            StructuralEvent::Fold {
                axis,
                amplitude_m,
                wavelength_m,
            } => {
                validate_axis(axis)?;
                if !amplitude_m.is_finite()
                    || !wavelength_m.is_finite()
                    || *wavelength_m <= 0.0
                {
                    return Err(StructureError::InvalidParameters);
                }
                let dx = axis.end[0] - axis.start[0];
                let dy = axis.end[1] - axis.start[1];
                let length = (dx * dx + dy * dy).sqrt();
                for y in 0..scratch.height {
                    for x in 0..scratch.width {
                        let wx = x as f32 * cell_x - half - axis.start[0];
                        let wy = y as f32 * cell_y - half - axis.start[1];
                        let signed_distance = (dx * wy - dy * wx) / length;
                        let phase = std::f32::consts::TAU * signed_distance / wavelength_m;
                        let i = y * scratch.width + x;
                        scratch.values[i] += deterministic_sin(phase) * amplitude_m;
                    }
                }
                displaced_event_indices.push(event_index);
            }
            StructuralEvent::Unconformity { surface } => {
                let surface_field = node_fields
                    .get(surface)
                    .ok_or(StructureError::UnknownSurface(*surface))?;
                if surface_field.width != scratch.width || surface_field.height != scratch.height {
                    return Err(StructureError::InvalidGeometry);
                }
                for i in 0..scratch.values.len() {
                    // A lower reference surface exposes deeper material by
                    // advancing the stratigraphic depth at the current top.
                    strata_depth_offset.values[i] = strata_depth_offset.values[i]
                        + (scratch.values[i] - surface_field.values[i]).max(0.0);
                }
                unconformity_event_indices.push(event_index);
            }
        }
    }

    if !scratch.finite() || !strata_depth_offset.finite() {
        return Err(StructureError::NonFiniteResult);
    }
    *elevation = scratch;
    Ok(StructureField {
        strata_depth_offset,
        displaced_event_indices,
        unconformity_event_indices,
    })
}

/// Fixed Taylor polynomial with argument reduction avoids platform libm drift.
fn deterministic_sin(value: f32) -> f32 {
    let tau = std::f32::consts::TAU;
    let mut x = value.rem_euclid(tau);
    if x > std::f32::consts::PI {
        x -= tau;
    }
    let x2 = x * x;
    x * (1.0
        + x2 * (-1.0 / 6.0
            + x2 * (1.0 / 120.0
                + x2 * (-1.0 / 5040.0
                    + x2 * (1.0 / 362880.0 + x2 * (-1.0 / 39916800.0))))))
}

fn normalized_plane(plane: &PlaneSpec) -> Result<(f32, f32), StructureError> {
    if plane.origin.iter().any(|value| !value.is_finite())
        || plane.normal.iter().any(|value| !value.is_finite())
    {
        return Err(StructureError::InvalidParameters);
    }
    let length = (plane.normal[0] * plane.normal[0] + plane.normal[1] * plane.normal[1]).sqrt();
    if !length.is_finite() || length <= 1e-6 {
        return Err(StructureError::InvalidGeometry);
    }
    Ok((plane.normal[0] / length, plane.normal[1] / length))
}

fn validate_axis(axis: &AxisSpec) -> Result<(), StructureError> {
    if axis.start.iter().chain(axis.end.iter()).any(|value| !value.is_finite()) {
        return Err(StructureError::InvalidParameters);
    }
    let dx = axis.end[0] - axis.start[0];
    let dy = axis.end[1] - axis.start[1];
    if (dx * dx + dy * dy).sqrt() <= 1e-6 {
        return Err(StructureError::InvalidGeometry);
    }
    Ok(())
}
