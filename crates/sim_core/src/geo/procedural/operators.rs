//! Pure, profile-independent field operators.
use super::fields::{Field2, FieldError};
use super::ir::FieldOp;

pub(crate) const HASH_SALT: u64 = 0x5445_5252_4E53_3031;

pub fn evaluate(
    op: &FieldOp,
    inputs: &[&Field2],
    seed: u64,
    width: usize,
    height: usize,
    world_size: f32,
) -> Result<Field2, FieldError> {
    if matches!(op, FieldOp::SmoothUnion { smoothness } | FieldOp::SmoothSubtract { smoothness } if *smoothness <= 0.0 || !smoothness.is_finite())
    {
        return Err(FieldError::InvalidSmoothing);
    }
    let half = world_size * 0.5;
    Field2::from_fn(width, height, |x, y| {
        let wx = if width > 1 {
            x as f32 / (width - 1) as f32 * world_size - half
        } else {
            0.0
        };
        let wy = if height > 1 {
            y as f32 / (height - 1) as f32 * world_size - half
        } else {
            0.0
        };
        match op {
            FieldOp::Constant { value } => *value,
            FieldOp::Plane {
                direction,
                slope,
                base,
            } => base + (wx * direction[0] + wy * direction[1]) * slope,
            FieldOp::NoiseFbm {
                frequency,
                octaves,
                amplitude,
            } => fbm(seed, wx * *frequency, wy * *frequency, *octaves) * *amplitude,
            FieldOp::Ridge {
                start,
                end,
                width,
                amplitude,
            } => ridge(wx, wy, *start, *end, *width, *amplitude),
            FieldOp::Valley {
                start,
                end,
                width,
                depth,
            } => -ridge(wx, wy, *start, *end, *width, *depth),
            FieldOp::Depression {
                center,
                radius,
                depth,
            } => radial(wx, wy, *center, *radius, -*depth),
            FieldOp::Cone {
                center,
                radius,
                height,
            } => radial(wx, wy, *center, *radius, *height),
            FieldOp::Plateau {
                center,
                radius,
                height,
                edge,
            } => plateau(wx, wy, *center, *radius, *height, *edge),
            FieldOp::Add => inputs.iter().map(|f| f.get_unchecked(x, y)).sum(),
            FieldOp::Multiply => inputs.iter().fold(1.0, |v, f| v * f.get_unchecked(x, y)),
            FieldOp::SmoothUnion { smoothness } => smooth_extreme(inputs, x, y, *smoothness, false),
            FieldOp::SmoothSubtract { smoothness } => {
                smooth_extreme(inputs, x, y, *smoothness, true)
            }
        }
    })
}

fn smooth_extreme(inputs: &[&Field2], x: usize, y: usize, k: f32, subtract: bool) -> f32 {
    if inputs.is_empty() {
        return 0.0;
    }
    let a = inputs[0].get_unchecked(x, y);
    let b = inputs.get(1).map(|f| f.get_unchecked(x, y)).unwrap_or(0.0);
    let h = (0.5 + 0.5 * if subtract { (a + b) / k } else { (b - a) / k }).clamp(0.0, 1.0);
    if subtract {
        a * (1.0 - h) + (-b) * h + k * h * (1.0 - h)
    } else {
        a * (1.0 - h) + b * h - k * h * (1.0 - h)
    }
}
fn radial(x: f32, y: f32, center: [f32; 2], radius: f32, amount: f32) -> f32 {
    if radius <= 0.0 {
        return 0.0;
    }
    let d = ((x - center[0]).powi(2) + (y - center[1]).powi(2)).sqrt();
    let t = (1.0 - d / radius).clamp(0.0, 1.0);
    amount * t * t * (3.0 - 2.0 * t)
}
fn ridge(x: f32, y: f32, start: [f32; 2], end: [f32; 2], width: f32, amount: f32) -> f32 {
    if width <= 0.0 {
        return 0.0;
    }
    let dx = end[0] - start[0];
    let dy = end[1] - start[1];
    let len2 = (dx * dx + dy * dy).max(1e-6);
    let t = ((x - start[0]) * dx + (y - start[1]) * dy) / len2;
    let t = t.clamp(0.0, 1.0);
    let px = start[0] + t * dx;
    let py = start[1] + t * dy;
    let d = ((x - px).powi(2) + (y - py).powi(2)).sqrt();
    amount * (-(d / width).powi(2)).exp()
}
fn plateau(x: f32, y: f32, center: [f32; 2], radius: f32, height: f32, edge: f32) -> f32 {
    if radius <= 0.0 {
        return 0.0;
    }
    let d = ((x - center[0]).powi(2) + (y - center[1]).powi(2)).sqrt();
    let edge = edge.max(1e-3);
    let t = ((radius + edge - d) / edge).clamp(0.0, 1.0);
    height * t * t * (3.0 - 2.0 * t)
}
fn fbm(seed: u64, x: f32, y: f32, octaves: u8) -> f32 {
    let n = octaves.clamp(1, 8);
    let mut sum = 0.0;
    let mut amp = 1.0;
    let mut freq = 1.0;
    let mut norm = 0.0;
    for _ in 0..n {
        sum += gradient_noise(seed, x * freq, y * freq) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    sum / norm
}
fn gradient_noise(seed: u64, x: f32, y: f32) -> f32 {
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let sx = fade(tx);
    let sy = fade(ty);
    let n00 = grad(seed, x0, y0, tx, ty);
    let n10 = grad(seed, x0 + 1, y0, tx - 1.0, ty);
    let n01 = grad(seed, x0, y0 + 1, tx, ty - 1.0);
    let n11 = grad(seed, x0 + 1, y0 + 1, tx - 1.0, ty - 1.0);
    let a = n00 + (n10 - n00) * sx;
    let b = n01 + (n11 - n01) * sx;
    a + (b - a) * sy
}
fn fade(t: f32) -> f32 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}
fn grad(seed: u64, x: i32, y: i32, dx: f32, dy: f32) -> f32 {
    let mut h = seed
        ^ HASH_SALT
        ^ (x as i64 as u64).wrapping_mul(0x9e3779b97f4a7c15)
        ^ (y as i64 as u64).wrapping_mul(0xbf58476d1ce4e5b9);
    h = mix64(h);
    let g = (h & 7) as usize;
    const G: [[f32; 2]; 8] = [
        [1., 0.],
        [-1., 0.],
        [0., 1.],
        [0., -1.],
        [0.70710677, 0.70710677],
        [-0.70710677, 0.70710677],
        [0.70710677, -0.70710677],
        [-0.70710677, -0.70710677],
    ];
    G[g][0] * dx + G[g][1] * dy
}
pub(crate) fn mix64(mut x: u64) -> u64 {
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58476d1ce4e5b9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94d049bb133111eb);
    x ^ (x >> 31)
}
