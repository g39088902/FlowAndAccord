//! Position Based Fluids（Macklin & Müller 2013）在**深度平均域**上的核函数与约束求解。
//!
//! 为什么是 2D 核：本项目水体是格距 ≈3m 的贴地薄层（水深 1~3m），竖直方向不足一个
//! 粒子层。三维核在薄层里会退化成「面内密度 = 面密度」，代价高、数值脆；深度平均后
//! 面内不可压缩性恰好等价于「水柱厚度守恒」，且给出侵蚀所需的流速场。
//!
//! 全部函数为自由函数（显式切片入参），使调用方可同时对 `FluidSim` 的不同字段做
//! 独占/共享借用，热路径零堆分配。

use super::grid::ColGrid;
use std::f32::consts::PI;

/// 二维 poly6 核值（支撑域半径 `h`，`r ≥ h` 返回 0）。
#[inline]
pub fn poly6(r2: f32, h2: f32, h8: f32) -> f32 {
    if r2 >= h2 {
        return 0.0;
    }
    let d = h2 - r2;
    4.0 / (PI * h8) * d * d * d
}

/// 二维 spiky 核梯度 `∇_i W(p_i - p_j)` 与核值一并返回。
///
/// spiky 梯度方向沿 `p_i - p_j`（`dW/dr < 0` ⇒ 梯度指向对方，符号由系数负值承担）。
#[inline]
pub fn pair_kernel(dx: f32, dy: f32, h: f32, h2: f32, h5: f32, h8: f32) -> (f32, f32, f32) {
    let r2 = dx * dx + dy * dy;
    if r2 >= h2 || r2 <= 1e-12 {
        return (0.0, 0.0, 0.0);
    }
    let r = r2.sqrt();
    let d = h2 - r2;
    let w = 4.0 / (PI * h8) * d * d * d;
    let s = h - r;
    let coef = -30.0 / (PI * h5) * s * s / r;
    (w, coef * dx, coef * dy)
}

/// 核自贡献 `W(0)`（`4/(π h²)`，由 2D poly6 在 `r=0` 处化简）。
#[inline]
pub fn self_kernel(h2: f32) -> f32 {
    4.0 / (PI * h2)
}

/// 粒子密度 `ρ_i = Σ_j m·W(|p_i - p_j|)`（含自贡献）。
pub fn compute_density(
    grid: &ColGrid,
    xs: &[f32],
    ys: &[f32],
    count: usize,
    mass: f32,
    h: f32,
    h2: f32,
    h5: f32,
    h8: f32,
    out: &mut [f32],
) {
    let self_w = self_kernel(h2);
    for i in 0..count {
        let xi = xs[i];
        let yi = ys[i];
        let mut rho = mass * self_w;
        grid.for_each_candidate(xs, ys, i, |j| {
            if j == i {
                return;
            }
            let (w, _, _) = pair_kernel(xi - xs[j], yi - ys[j], h, h2, h5, h8);
            rho += mass * w;
        });
        out[i] = rho;
    }
}

/// PBF 约束乘子 `λ_i`。仅约束**压缩**（`C > 0`）——自由表面处密度天然偏低，
/// 若同时约束膨胀会把水面粒子拉回内部（表面张力伪影），水面就读不出来了。
pub fn compute_lambda(
    grid: &ColGrid,
    xs: &[f32],
    ys: &[f32],
    count: usize,
    dens: &[f32],
    rest_density: f32,
    h: f32,
    h2: f32,
    h5: f32,
    h8: f32,
    eps: f32,
    out: &mut [f32],
) {
    let inv_rho0 = 1.0 / rest_density;
    for i in 0..count {
        let c = dens[i] * inv_rho0 - 1.0;
        if c <= 0.0 {
            out[i] = 0.0;
            continue;
        }
        let xi = xs[i];
        let yi = ys[i];
        let mut sum_sq = 0.0f32;
        let mut gx_sum = 0.0f32;
        let mut gy_sum = 0.0f32;
        grid.for_each_candidate(xs, ys, i, |j| {
            if j == i {
                return;
            }
            let (_, gx, gy) = pair_kernel(xi - xs[j], yi - ys[j], h, h2, h5, h8);
            let sx = gx * inv_rho0;
            let sy = gy * inv_rho0;
            sum_sq += sx * sx + sy * sy;
            gx_sum += sx;
            gy_sum += sy;
        });
        // 自身项的梯度 = 邻居梯度之和的相反数，平方后与上式同形
        sum_sq += gx_sum * gx_sum + gy_sum * gy_sum;
        out[i] = -c / (sum_sq + eps);
    }
}

/// 位置修正量 `Δp_i = (1/ρ0) Σ_j (λ_i + λ_j + s_corr) ∇W`。
///
/// `scorr_q` 为 `W(Δq)`（构建期预计算），`scorr_k`/`scorr_n` 为张力修正参数。
pub fn integrate_delta(
    grid: &ColGrid,
    xs: &[f32],
    ys: &[f32],
    count: usize,
    lambda: &[f32],
    rest_density: f32,
    h: f32,
    h2: f32,
    h5: f32,
    h8: f32,
    scorr_k: f32,
    scorr_n: f32,
    scorr_q: f32,
    out_x: &mut [f32],
    out_y: &mut [f32],
) {
    let inv_rho0 = 1.0 / rest_density;
    let inv_q = if scorr_q > 0.0 { 1.0 / scorr_q } else { 0.0 };
    for i in 0..count {
        let li = lambda[i];
        let xi = xs[i];
        let yi = ys[i];
        let mut ax = 0.0f32;
        let mut ay = 0.0f32;
        grid.for_each_candidate(xs, ys, i, |j| {
            if j == i {
                return;
            }
            let (w, gx, gy) = pair_kernel(xi - xs[j], yi - ys[j], h, h2, h5, h8);
            if w <= 0.0 {
                return;
            }
            // s_corr = -k·(W/W(Δq))^n，n 恒为小整数 ⇒ 用乘法连乘替代 powf
            // （powf 在每对邻居上调用是热路径最大开销，实测占单子步的一半以上）
            let ratio = w * inv_q;
            let ratio2 = ratio * ratio;
            let scorr = -scorr_k
                * if scorr_n >= 4.0 {
                    ratio2 * ratio2
                } else if scorr_n >= 2.0 {
                    ratio2
                } else {
                    ratio
                };
            let coef = (li + lambda[j] + scorr) * inv_rho0;
            ax += coef * gx;
            ay += coef * gy;
        });
        out_x[i] = ax;
        out_y[i] = ay;
    }
}

/// XSPH 粘性：把邻居速度按核权拉向本粒子，抑制高速下的粒子穿模与飞散。
pub fn apply_viscosity(
    grid: &ColGrid,
    xs: &[f32],
    ys: &[f32],
    count: usize,
    vx: &[f32],
    vy: &[f32],
    rest_density: f32,
    h: f32,
    h2: f32,
    h5: f32,
    h8: f32,
    c: f32,
    out_vx: &mut [f32],
    out_vy: &mut [f32],
) {
    let inv_rho0 = 1.0 / rest_density;
    for i in 0..count {
        let xi = xs[i];
        let yi = ys[i];
        let vxi = vx[i];
        let vyi = vy[i];
        let mut sx = 0.0f32;
        let mut sy = 0.0f32;
        grid.for_each_candidate(xs, ys, i, |j| {
            if j == i {
                return;
            }
            let (w, _, _) = pair_kernel(xi - xs[j], yi - ys[j], h, h2, h5, h8);
            if w <= 0.0 {
                return;
            }
            let k = w * inv_rho0;
            sx += (vx[j] - vxi) * k;
            sy += (vy[j] - vyi) * k;
        });
        out_vx[i] = vxi + c * sx;
        out_vy[i] = vyi + c * sy;
    }
}
