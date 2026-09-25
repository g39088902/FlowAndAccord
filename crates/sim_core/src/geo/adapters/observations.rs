//! Read-only external observation metadata boundary (UGC-11 placeholder).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservationMetadata {
    pub units: String,
    pub crs: String,
    pub source: String,
    pub timestamp: String,
    pub content_hash: u64,
}
pub trait ObservationSource {
    fn metadata(&self) -> &ObservationMetadata;
}
