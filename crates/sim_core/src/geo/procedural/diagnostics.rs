//! Stable hashes and small diagnostic records; these never enter runtime snapshots.
use super::constraints::ConstraintReport;
use super::fields::Field2;
#[derive(Debug, Clone)]
pub struct FieldDiagnostic {
    pub name: String,
    pub width: usize,
    pub height: usize,
    pub hash: u64,
}
#[derive(Debug, Clone)]
pub struct DiagnosticsBundle {
    pub seed: u64,
    pub recipe_hash: u64,
    pub generator_version: u32,
    pub fields: Vec<FieldDiagnostic>,
    pub constraints: Vec<ConstraintReport>,
}
pub fn field_diagnostic(name: &str, field: &Field2) -> FieldDiagnostic {
    FieldDiagnostic {
        name: name.into(),
        width: field.width,
        height: field.height,
        hash: field.hash_quantized(1000.0),
    }
}
pub fn recipe_hash(bytes: &[u8]) -> u64 {
    let mut h = 0xcbf29ce484222325u64;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}
