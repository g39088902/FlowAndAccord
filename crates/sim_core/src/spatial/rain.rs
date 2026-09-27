//! Rust-owned WebGPU precipitation contract.
//!
//! The browser GPU executes the WGSL compute shader exported by this module. Rust
//! owns the shader source, deterministic seed/configuration contract, snapshot
//! type and save schema; JavaScript only provides the browser GPU device and
//! submits the command encoder.
use serde::{Deserialize, Serialize};

pub const RAIN_PARTICLE_MAX: usize = 320;
pub const RAIN_GPU_WGSL: &str = include_str!("rain.wgsl");
const RAIN_RNG_SALT: u64 = 0x5241_494E_5041_5254;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RainParticle {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub prev_x: f32,
    pub prev_y: f32,
    pub prev_z: f32,
    pub vx: f32,
    pub vy: f32,
    pub age: f32,
    pub max_age: f32,
    pub falling: bool,
}

impl crate::spatial::world::World3DEngine {
    /// Private deterministic seed for the GPU spawn stream. It is kept separate
    /// from WorldRng so GPU particle rendering cannot perturb simulation order.
    pub(crate) fn rain_seed(seed: u64) -> u64 {
        seed ^ RAIN_RNG_SALT
    }
}
