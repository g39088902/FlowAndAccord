//! Deterministic scalar fields used by the terrain compiler.
use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point2 {
    pub x: f32,
    pub y: f32,
}

pub trait ScalarField<P> {
    fn sample(&self, p: P) -> f32;
}

pub type MaskField = Field2;
pub type MaterialField = Vec<u8>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Field2 {
    pub width: usize,
    pub height: usize,
    pub values: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FieldError {
    InvalidDimensions,
    InvalidSmoothing,
    SizeMismatch,
    OutOfBounds,
    NonFinite,
}

impl FieldError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::InvalidDimensions => "INVALID_DIMENSIONS",
            Self::SizeMismatch => "SIZE_MISMATCH",
            Self::OutOfBounds => "OUT_OF_BOUNDS",
            Self::NonFinite => "NON_FINITE",
            Self::InvalidSmoothing => "INVALID_SMOOTHING",
        }
    }
}

impl Field2 {
    pub fn new(width: usize, height: usize, fill: f32) -> Result<Self, FieldError> {
        if width == 0 || height == 0 {
            return Err(FieldError::InvalidDimensions);
        }
        if !fill.is_finite() {
            return Err(FieldError::NonFinite);
        }
        Ok(Self {
            width,
            height,
            values: vec![fill; width * height],
        })
    }
    pub fn from_values(width: usize, height: usize, values: Vec<f32>) -> Result<Self, FieldError> {
        if width == 0 || height == 0 {
            return Err(FieldError::InvalidDimensions);
        }
        if values.len() != width * height {
            return Err(FieldError::SizeMismatch);
        }
        if values.iter().any(|v| !v.is_finite()) {
            return Err(FieldError::NonFinite);
        }
        Ok(Self {
            width,
            height,
            values,
        })
    }
    pub fn from_fn<F: FnMut(usize, usize) -> f32>(
        width: usize,
        height: usize,
        mut f: F,
    ) -> Result<Self, FieldError> {
        if width == 0 || height == 0 {
            return Err(FieldError::InvalidDimensions);
        }
        let mut values = Vec::with_capacity(width * height);
        for y in 0..height {
            for x in 0..width {
                let value = f(x, y);
                if !value.is_finite() {
                    return Err(FieldError::NonFinite);
                }
                values.push(value);
            }
        }
        Ok(Self {
            width,
            height,
            values,
        })
    }
    #[inline]
    pub fn index(&self, x: usize, y: usize) -> Option<usize> {
        (x < self.width && y < self.height).then_some(y * self.width + x)
    }
    #[inline]
    pub fn get(&self, x: usize, y: usize) -> Option<f32> {
        self.index(x, y).map(|i| self.values[i])
    }
    #[inline]
    pub fn get_unchecked(&self, x: usize, y: usize) -> f32 {
        self.values[y * self.width + x]
    }
    pub fn set(&mut self, x: usize, y: usize, value: f32) -> Result<(), FieldError> {
        let i = self.index(x, y).ok_or(FieldError::OutOfBounds)?;
        if !value.is_finite() {
            return Err(FieldError::NonFinite);
        }
        self.values[i] = value;
        Ok(())
    }
    pub fn fill(&mut self, value: f32) -> Result<(), FieldError> {
        if !value.is_finite() {
            return Err(FieldError::NonFinite);
        }
        self.values.fill(value);
        Ok(())
    }
    pub fn hash_quantized(&self, scale: f32) -> u64 {
        let scale = if scale.is_finite() && scale > 0.0 {
            scale
        } else {
            1.0
        };
        let mut h = Fnv64::default();
        (self.width as u64).hash(&mut h);
        (self.height as u64).hash(&mut h);
        for &value in &self.values {
            ((value * scale).round() as i64).hash(&mut h);
        }
        h.finish()
    }
    pub fn finite(&self) -> bool {
        self.values.iter().all(|v| v.is_finite())
    }
}

pub struct FieldWriter<'a> {
    field: &'a mut Field2,
}
impl<'a> FieldWriter<'a> {
    pub fn new(field: &'a mut Field2) -> Self {
        Self { field }
    }
    pub fn set(&mut self, x: usize, y: usize, value: f32) -> Result<(), FieldError> {
        self.field.set(x, y, value)
    }
    pub fn field(&self) -> &Field2 {
        self.field
    }
}

impl ScalarField<Point2> for Field2 {
    fn sample(&self, p: Point2) -> f32 {
        let x = p.x.floor().clamp(0.0, (self.width - 1) as f32) as usize;
        let y = p.y.floor().clamp(0.0, (self.height - 1) as f32) as usize;
        self.get_unchecked(x, y)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Ord, PartialOrd, Serialize, Deserialize)]
pub struct ChunkCoord {
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Field3Chunk {
    pub coord: ChunkCoord,
    pub size: u8,
    pub halo: u8,
    pub density_q16: Vec<i16>,
    pub material: Vec<u8>,
}
impl Field3Chunk {
    pub fn new(coord: ChunkCoord, size: u8, halo: u8) -> Result<Self, FieldError> {
        if size == 0 {
            return Err(FieldError::InvalidDimensions);
        }
        let n = (size as usize + 2 * halo as usize).pow(3);
        Ok(Self {
            coord,
            size,
            halo,
            density_q16: vec![0; n],
            material: vec![0; n],
        })
    }
}

#[derive(Default)]
struct Fnv64(u64);
impl Hasher for Fnv64 {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        if self.0 == 0 {
            self.0 = 0xcbf29ce484222325;
        }
        for b in bytes {
            self.0 ^= *b as u64;
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
    }
}
