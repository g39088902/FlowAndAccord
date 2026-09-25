//! Finite deterministic candidate ordering and comparison records.
use super::constraints::ConstraintReport;
use super::ir::UncertaintySpec;
use super::operators::mix64;
use serde::{Deserialize, Serialize};

/// Salt for the candidate stream. It is independent from every field-operator
/// stream, so adding diagnostics cannot change generated terrain values.
pub const CANDIDATE_SALT: u64 = 0x554e_4345_5254_4149;

#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub index: u8,
    pub hash: u64,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CandidateFieldHash {
    pub name: String,
    pub hash: u64,
}

/// Developer-facing comparison result. This record is only attached to the
/// diagnostics bundle; it is never part of a runtime snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CandidateResult {
    pub index: u8,
    pub hash: u64,
    pub parameters: Vec<f32>,
    pub passed: bool,
    pub score: f32,
    pub reports: Vec<ConstraintReport>,
    pub field_hashes: Vec<CandidateFieldHash>,
}

pub fn candidates(seed: u64, spec: &UncertaintySpec) -> Vec<Candidate> {
    let count = spec.candidate_count.max(1);
    let mut out = (0..count)
        .map(|i| Candidate {
            index: i,
            hash: candidate_hash(seed, i),
            score: random_score(seed, i),
        })
        .collect::<Vec<_>>();
    out.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.hash.cmp(&b.hash)));
    out.truncate(spec.keep_top_n.max(1) as usize);
    out
}

/// Map candidate `i` into the declared parameter ranges using only stable
/// integer mixing. A zero-width range remains exactly at its declared value.
pub fn candidate_parameters(seed: u64, spec: &UncertaintySpec, index: u8) -> Vec<f32> {
    spec.parameter_jitter
        .iter()
        .enumerate()
        .map(|(parameter_index, range)| {
            let stream = mix64(
                seed ^ CANDIDATE_SALT
                    ^ (index as u64).wrapping_mul(0x9e3779b97f4a7c15)
                    ^ (parameter_index as u64).wrapping_mul(0xbf58476d1ce4e5b9),
            );
            let unit = (stream % 1_000_000) as f32 / 1_000_000.0;
            range.min + (range.max - range.min) * unit
        })
        .collect()
}

/// Build and stably rank candidate diagnostics. Constraint pass status is the
/// primary key, the deterministic score is the secondary key, and the hash is
/// the final tie-breaker. This makes candidate order reproducible across
/// native and WASM builds.
pub fn candidate_results(
    seed: u64,
    spec: &UncertaintySpec,
    reports: &[ConstraintReport],
    field_hashes: &[CandidateFieldHash],
) -> Vec<CandidateResult> {
    let count = spec.candidate_count.max(1);
    let pass_ratio = if reports.is_empty() {
        1.0
    } else {
        reports.iter().filter(|report| report.passed).count() as f32 / reports.len() as f32
    };
    let mut results = (0..count)
        .map(|index| {
            let random = random_score(seed, index);
            CandidateResult {
                index,
                hash: candidate_hash(seed, index),
                parameters: candidate_parameters(seed, spec, index),
                passed: reports.iter().all(|report| report.passed),
                score: pass_ratio * 0.999 + random * 0.001,
                reports: reports.to_vec(),
                field_hashes: field_hashes.to_vec(),
            }
        })
        .collect::<Vec<_>>();
    results.sort_by(|a, b| {
        b.passed
            .cmp(&a.passed)
            .then(b.score.total_cmp(&a.score))
            .then(a.hash.cmp(&b.hash))
    });
    results.truncate(spec.keep_top_n.max(1).min(count) as usize);
    results
}

pub fn candidate_hash(seed: u64, index: u8) -> u64 {
    mix64(seed ^ CANDIDATE_SALT ^ index as u64)
}

fn random_score(seed: u64, index: u8) -> f32 {
    (mix64(seed ^ CANDIDATE_SALT.rotate_left(17) ^ index as u64) % 1_000_000) as f32 / 1_000_000.0
}
