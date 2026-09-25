//! Finite deterministic candidate ordering.
use super::ir::UncertaintySpec;
use super::operators::mix64;
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub index: u8,
    pub hash: u64,
    pub score: f32,
}
pub fn candidates(seed: u64, spec: &UncertaintySpec) -> Vec<Candidate> {
    let count = spec.candidate_count.max(1);
    let mut out = (0..count)
        .map(|i| Candidate {
            index: i,
            hash: mix64(seed ^ i as u64),
            score: (mix64(seed ^ 0x554e434552544149 ^ i as u64) % 1_000_000) as f32 / 1_000_000.0,
        })
        .collect::<Vec<_>>();
    out.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.hash.cmp(&b.hash)));
    out.truncate(spec.keep_top_n.max(1) as usize);
    out
}
