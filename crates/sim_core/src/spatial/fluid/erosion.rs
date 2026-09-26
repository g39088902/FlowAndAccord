//! 运行时水力侵蚀 / 沉积（水体求解器的地形反馈）。
//!
//! # 定位
//!
//! 把 `FluidSim` 解出的**流速场**回灌到河床：高速水流下切河床（侵蚀）、
//! 缓流区淤积（沉积）。这是「水改造地形」的唯一写入口，也是流体求解器
//! 从「表现」升级为「地形营力」的关键一环。
//!
//! # 物理模型（写意口径，够用即止）
//!
//! 1. **栅格化**：每个粒子把自身水柱深度与速度累加到所在地形格，得到逐格
//!    平均水深 `h` 与平均流速 `v`（与求解器同一套 `TerrainMap` 栅格）。
//! 2. **床面剪应力**（Manning 阻力口径）：`τ = ρ g n² |v|² / h^{1/3}`。
//! 3. **侵蚀 / 沉积**：`τ > τ_c` 时下切 `K_e·(τ−τ_c)·dt`；`τ < τ_c` 时淤积
//!    `K_d·(τ_c−τ)·dt`。`τ_c` 为起动切应力。
//! 4. **限幅**：单次变化 ≤ `DZ_MAX`，逐格累计下切 ≤ `MAX_INCISION`、
//!    累计淤积 ≤ `MAX_AGGRADE`，且写入后的格坡度不得超过可行走坡度上限
//!    （防「侵蚀把某格变成不可通行」而让既有车道失配）。
//!
//! # 写入范围（关键约束）
//!
//! **只改 `water_body_id.is_some()` 的水体格**：陆地格的高程/坡度/flags 一律不动
//! ⇒ 车道几何校验（`corridor::validate_curve` 读 `TerrainMap.cells`）不受影响；
//! 水体格本身在非河谷模板带 `NO_WALK`（车道本就不经过），在河谷模板是可行走浅水，
//! 由坡度上限兜底保证不会因侵蚀而超过 `terrain_max_walk_slope`。
//!
//! **深水（`level − bed ≥ MAX_DEPTH`）整体跳过**：渲染水面是
//! `z = bed + clamp(level − bed, MIN, MAX)`，水柱深度封顶后任何床面变化都只会
//! **平移**水面而不再改变水深——下切 ⇒ 湖面下沉/露滩（视觉上是「湖被抽干」而非
//! 「河被刷深」），淤积 ⇒ 水面凭空上抬。深水（湖泊）本身也是低能环境，故侵蚀只
//! 发生在「下切仍能加深水体」的河段与浅水边缘。
//!
//! # 确定性
//!
//! 不消耗 `WorldRng`；累加按粒子下标序、逐格处理按行主序；所有限幅与坡度保护
//! 都是固定迭代次数的纯算术 ⇒ 同种子逐位可复现。逐格累计量不入存档，
//! 读档时由「当前高程 − 重建高度场」精确还原（见 `World3DEngine::sync_voxel_surface_from_terrain`）。

use crate::geo::terrain::TerrainMap;
use crate::spatial::fluid::{FluidSim, GRAVITY, MANNING_N, MAX_DEPTH};
use std::cell::RefCell;

/// 侵蚀推进节拍：每 N 个流体步执行一次（流体步 = `FLUID_STEP_TICKS` 拍 ≈ 0.1s 模拟时间）。
/// 10 ⇒ 约每 1 秒模拟时间一次；这是「可见速度 / 成本」的主要旋钮。
pub const EROSION_EVERY_FLUID_STEPS: u64 = 10;

/// 水的密度（kg/m³）。
const RHO: f32 = 1000.0;
/// 起动切应力（Pa）：细砂/粉砂量级，低于它不产生冲刷。
const TAU_CRITICAL: f32 = 4.0;
/// 侵蚀系数（m / (Pa·s)）。
const K_ERODE: f32 = 3.0e-3;
/// 沉积系数（m / (Pa·s)），比侵蚀小一个量级，避免缓流区快速淤平。
const K_DEPOSIT: f32 = 8.0e-4;
/// 单次（一拍）床面变化上限（m）。
const DZ_MAX: f32 = 0.06;
/// 逐格累计下切上限（m）。
const MAX_INCISION: f32 = 2.5;
/// 逐格累计淤积上限（m）。
const MAX_AGGRADE: f32 = 0.30;
/// 计算剪应力时的最小水深（m），防除零放大。
const MIN_DEPTH: f32 = 0.25;
/// 坡度上限保护的余量（度）：写入后的坡度必须 ≤ 上限 − 余量。
const SLOPE_MARGIN: f32 = 0.5;
/// 坡度保护的最大折半次数（8 ⇒ 最小可接受量为原值的 1/256）。
const SLOPE_HALVING_STEPS: u32 = 8;
/// 配置缺失时的兜底可行走坡度上限（度），与前端 `terrainMaxWalkSlope` 默认值同源。
const FALLBACK_WALK_SLOPE: f32 = 30.0;

/// 待下发的侵蚀脏格（首次修改序去重）。
#[derive(Default)]
struct Pending {
    mask: Vec<u8>,
    list: Vec<u32>,
}

/// 侵蚀器。全部状态在构造期预分配，`step` 内零堆分配。
pub struct Erosion {
    width: usize,
    height: usize,
    cell_count: usize,
    /// 逐格粒子数 / 速度和 / 水深和（栅格化累加器）。
    count: Vec<f32>,
    sum_vx: Vec<f32>,
    sum_vy: Vec<f32>,
    sum_h: Vec<f32>,
    /// 逐格累计床面变化（m，下切为负）：限幅与读档还原用。
    cumulative: Vec<f32>,
    pending: RefCell<Pending>,
    /// 已发生的侵蚀步数（调试探针）。
    pub steps: u64,
    /// 最近一步改动的格数（调试探针）。
    pub last_changed: usize,
}

impl Erosion {
    pub fn new(width: usize, height: usize) -> Self {
        let cell_count = width.max(1) * height.max(1);
        Self {
            width: width.max(1),
            height: height.max(1),
            cell_count,
            count: vec![0.0; cell_count],
            sum_vx: vec![0.0; cell_count],
            sum_vy: vec![0.0; cell_count],
            sum_h: vec![0.0; cell_count],
            cumulative: vec![0.0; cell_count],
            pending: RefCell::new(Pending {
                mask: vec![0; cell_count],
                list: Vec::new(),
            }),
            steps: 0,
            last_changed: 0,
        }
    }

    /// 读档重建后回填逐格累计变化量（`当前高程 − 原始高度场`）。
    pub fn set_cumulative(&mut self, index: usize, value: f32) {
        if index < self.cell_count {
            self.cumulative[index] = if value.is_finite() { value } else { 0.0 };
        }
    }

    /// 取走自上次下发以来改动的格下标（首次修改序），并清空待发列表。
    /// 由快照编码器调用（`&self` ⇒ 内部可变性，同 `strtab` 先例）。
    pub fn take_pending(&self) -> Vec<u32> {
        let mut pending = self.pending.borrow_mut();
        let list = std::mem::take(&mut pending.list);
        for &index in &list {
            if let Some(slot) = pending.mask.get_mut(index as usize) {
                *slot = 0;
            }
        }
        list
    }

    /// 丢弃待发增量（全量地形帧已携带最新高程 ⇒ 增量作废，避免同一改动重复下发）。
    pub fn clear_pending(&self) {
        let mut pending = self.pending.borrow_mut();
        let list = std::mem::take(&mut pending.list);
        for &index in &list {
            if let Some(slot) = pending.mask.get_mut(index as usize) {
                *slot = 0;
            }
        }
    }

    /// 待发增量是否为空（快照结构体侧的只读判据）。
    #[inline]
    pub fn pending_is_empty(&self) -> bool {
        self.pending.borrow().list.is_empty()
    }

    /// 待发增量格下标（首次修改序）的只读副本；不改变待发状态。
    /// 供 JSON 真值通道（`WorldSnapshot3D::terrain_delta`）读取，清空权仍归 FABS 编码器。
    pub fn pending_indices(&self) -> Vec<u32> {
        self.pending.borrow().list.clone()
    }

    /// 用当前粒子场推进一次侵蚀。
    ///
    /// * `terrain` / `heights`：语义投影与权威高度场（同一栅格、同一行主序），
    ///   两者同步写入；`heights` 是 `VoxelBackend` 的 `source_heightfield` 高程切片。
    /// * `dt`：本次侵蚀覆盖的模拟时长（秒）。
    /// * `walk_slope_deg`：可行走坡度上限（度），来自 `SimConfig`。
    ///
    /// 返回本次改动的格数。
    pub fn step(
        &mut self,
        terrain: &mut TerrainMap,
        heights: &mut [f32],
        fluid: &FluidSim,
        dt: f32,
        walk_slope_deg: f32,
    ) -> usize {
        self.last_changed = 0;
        if !dt.is_finite() || dt <= 0.0 {
            return 0;
        }
        if terrain.grid_width != self.width || terrain.grid_height != self.height {
            return 0;
        }
        if heights.len() < self.cell_count || terrain.cells.len() != self.cell_count {
            return 0;
        }
        let particles = fluid.particle_count();
        if particles == 0 {
            return 0;
        }

        // ① 栅格化：粒子 → 逐格 (水深, 流速) 平均量
        self.rasterize(terrain, fluid, particles);
        if !self
            .count
            .iter()
            .any(|value| *value >= 1.0)
        {
            return 0;
        }

        // ② 逐格剪应力 → 侵蚀/沉积 → 写回高程
        let slope_cap = if walk_slope_deg.is_finite() && walk_slope_deg > 1.0 {
            walk_slope_deg
        } else {
            FALLBACK_WALK_SLOPE
        };
        let mut pending = self.pending.borrow_mut();
        let mut changed = 0usize;
        for index in 0..self.cell_count {
            let hits = self.count[index];
            if hits < 1.0 {
                continue;
            }
            // 只改水体格：陆地格的高程/坡度不进任何校验路径之外的状态。
            if terrain.cells[index].water_body_id.is_none() {
                continue;
            }
            // ⑤ 深水保护：`level − bed ≥ MAX_DEPTH` 时水柱深度已被渲染上限封顶。
            //   此时任何床面变化都只会**平移**渲染水面（`z = bed + min(level−bed, MAX_DEPTH)`）
            //   而不再改变水深表达：下切 ⇒ 湖面下沉/露滩，淤积 ⇒ 水面凭空上抬。
            //   深水（湖泊）在物理上也是低能环境 ⇒ 整体跳过，侵蚀只发生在
            //   「下切仍能加深水体」的河段与浅水边缘。
            if let Some(level) = water_level_of(terrain, terrain.cells[index].water_body_id) {
                if level - terrain.cells[index].elevation >= MAX_DEPTH {
                    continue;
                }
            }
            let depth = (self.sum_h[index] / hits).max(MIN_DEPTH);
            let vx = self.sum_vx[index] / hits;
            let vy = self.sum_vy[index] / hits;
            let speed = (vx * vx + vy * vy).sqrt();
            if !speed.is_finite() {
                continue;
            }
            let tau = RHO * GRAVITY * MANNING_N * MANNING_N * speed * speed
                / depth.powf(1.0 / 3.0);
            if !tau.is_finite() {
                continue;
            }
            let mut dz = if tau > TAU_CRITICAL {
                -K_ERODE * (tau - TAU_CRITICAL) * dt
            } else {
                K_DEPOSIT * (TAU_CRITICAL - tau) * dt
            };
            if !dz.is_finite() || dz == 0.0 {
                continue;
            }

            // ③ 累计限幅
            let cumulative = self.cumulative[index];
            if dz < 0.0 {
                let room = MAX_INCISION + cumulative;
                if room <= 0.0 {
                    continue;
                }
                if -dz > room {
                    dz = -room;
                }
            } else {
                let room = MAX_AGGRADE - cumulative;
                if room <= 0.0 {
                    continue;
                }
                if dz > room {
                    dz = room;
                }
            }
            if dz.abs() > DZ_MAX {
                dz = DZ_MAX.copysign(dz);
            }

            // ④ 坡度上限保护：折半直到写入后坡度不超上限（或退化为零）。
            //   坡度一律走 `TerrainMap::slope_from_elevation`（唯一真相源），
            //   故先试写、判定不合格再回退，绝不复制第二份坡度公式。
            let base_elevation = terrain.cells[index].elevation;
            let current_slope = terrain.cells[index].slope_angle_deg;
            let limit = current_slope.max(slope_cap - SLOPE_MARGIN);
            let gx = index % self.width;
            let gy = index / self.width;
            let mut applied = dz;
            let mut new_slope = current_slope;
            let mut accepted = false;
            for _ in 0..SLOPE_HALVING_STEPS {
                if applied.abs() < 1.0e-4 {
                    break;
                }
                terrain.cells[index].elevation = base_elevation + applied;
                let slope = terrain.slope_from_elevation(gx, gy);
                if slope.is_finite() && slope <= limit {
                    new_slope = slope;
                    accepted = true;
                    break;
                }
                applied *= 0.5;
            }
            if !accepted {
                terrain.cells[index].elevation = base_elevation;
                continue;
            }

            let new_elevation = base_elevation + applied;
            terrain.cells[index].elevation = new_elevation;
            terrain.cells[index].slope_angle_deg = new_slope;
            heights[index] = new_elevation;
            self.cumulative[index] = cumulative + applied;
            if pending.mask[index] == 0 {
                pending.mask[index] = 1;
                pending.list.push(index as u32);
            }
            changed += 1;
        }
        drop(pending);

        self.steps = self.steps.wrapping_add(1);
        self.last_changed = changed;
        changed
    }

    /// 粒子 → 逐格累加器（粒子下标序，确定性）。
    fn rasterize(&mut self, terrain: &TerrainMap, fluid: &FluidSim, particles: usize) {
        self.count.fill(0.0);
        self.sum_vx.fill(0.0);
        self.sum_vy.fill(0.0);
        self.sum_h.fill(0.0);

        let (px, py, _pz) = fluid.positions();
        let (vx, vy) = fluid.velocities();
        let depths = fluid.depths();
        let width = self.width;
        let height = self.height;
        for i in 0..particles {
            let (fx, fy) = terrain.grid_coords(px[i], py[i]);
            let gx = (fx.round() as isize).clamp(0, width as isize - 1) as usize;
            let gy = (fy.round() as isize).clamp(0, height as isize - 1) as usize;
            let index = gy * width + gx;
            self.count[index] += 1.0;
            self.sum_vx[index] += vx[i];
            self.sum_vy[index] += vy[i];
            self.sum_h[index] += depths[i];
        }
    }
}

/// 逐格的水体水位（无归属格返回 `None`）。水位取自创世期 `hydrology.water_bodies`
/// ——侵蚀不改水体归属也不改水位，故整局恒定。
#[inline]
fn water_level_of(terrain: &TerrainMap, body_id: Option<u32>) -> Option<f32> {
    let id = body_id?;
    terrain
        .hydrology
        .water_bodies
        .iter()
        .find(|body| body.id == id)
        .map(|body| body.level)
}
