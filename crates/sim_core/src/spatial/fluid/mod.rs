//! 运行时水体求解器（Position Based Fluids，深度平均域）。
//!
//! # 定位
//!
//! 取代 v1.61.4 起「前端表现层粒子」的水面来源：水面粒子由**内核**求解并下发，
//! 前端只按既有画风（压扁菱形 + 同源配色 + 亮点抽样）绘制内核粒子。
//!
//! # 物理模型
//!
//! - 粒子 = 一根水柱（质量 `spacing²`，水平占位恒定），在**平面域**上被 PBF 的
//!   不可压缩约束求解；面内不可压缩在深度平均口径下等价于「水柱厚度守恒」。
//! - 受力 = 重力沿地形坡度分量 `-g·∇z_bed` + Manning 底部摩阻 `g n² |v| v / h^{4/3}`；
//!   因此水沿坡向下流、在洼地积水、在窄口加速。
//! - 边界 = **开放**：粒子越过世界边界即被移除（水从地图边缘流出），不再硬夹紧。
//! - 补源 = 降雨（全图随机落点，强度取自 `rainfall_intensity()`）+ 泉眼（`WaterSource`
//!   POI 位置）。补源与耗散共同构成**开放水循环**：降雨/泉涌补水，出流口与坡面
//!   下渗排水，总粒子数因此是动态的（不再是播种期的固定值）。
//! - 寿命 = 非水体格上的粒子按秒累积 `age`，超过 `SHEET_FLOW_LIFETIME` 即下渗消失；
//!   进入水体格立刻清零（正式并入水体）。这是防止陆地薄水粒子长期占满粒子上限的闸门。
//!
//! # 为什么不是三维 SPH
//!
//! 本项目地形格距 ≈3m、河道水深 1~3m，竖直方向不足一个粒子层：三维核在薄层里
//! 退化成面密度，代价高且数值脆。深度平均后仍保留真实流速场与质量守恒，
//! 且这正是侵蚀所需的量。若将来要三维水体（如瀑布），只需替换 `pbf.rs` 的核与
//! `grid.rs` 的分桶维度，`FluidSim` 的对接口径不变。
//!
//! # 不变量（违反即出 bug）
//!
//! ① 不消耗 `WorldRng`：播种与抖动走 `seed ^ SEED_SALT` 的**局部** PRNG；
//! ② 推进由 tick 驱动（每 `FLUID_STEP_TICKS` 拍一步，`dt` 由累计的 tick dt 给出），
//!    与墙钟无关 ⇒ 同种子逐位可复现，且与渲染帧率解耦；补源的随机落点用
//!    `seed ^ SPAWN_SALT ^ tick_counter` 的**局部** PRNG ⇒ 读档后同一 tick 落点逐位相同；
//! ③ 稳态零堆分配：全部状态在放置期预分配，`step` 内只写数值字段；
//! ④ 状态必须随存档持久化（`FluidSaveState`，f32 位精确的十六进制打包），
//!    否则读档续演与不中断运行不再逐字节一致（`test-wasm.js` 门禁）。粒子数是
//!    **动态**的（补源/出流），故存档必须携带每个粒子的 `age` 与补源信用。

pub mod erosion;
pub mod grid;
pub mod pbf;

use crate::geo::terrain::TerrainMap;
use crate::rng::WorldRng;
use grid::ColGrid;
use serde::{Deserialize, Serialize};

// ── 引擎调参（单点真相源；世界单位 / 秒口径；改值需重开世界）──
/// 每多少 tick 推进一次求解器（6 拍 = 10Hz 模拟时间；dt = 6/60 = 0.1s）。
///
/// 这是**成本/稳定性**的主要旋钮：求解成本与推进频率成正比，而 dt = 0.1s 下
/// PBF 两个子步（子步 dt 0.05s）仍远稳于重力位移尺度（每子步 ≈12mm ≪ 间距 2.6m）。
pub const FLUID_STEP_TICKS: u64 = 6;
/// 每个流体步内的子步数（PBF 论文建议：小步长 + 少迭代优于大步长 + 多迭代）。
/// 实测健康度：`dt = 0.1s` 下单子步（子步 dt 0.1s、重力位移 ≈49mm ≪ 间距 2.6m）
/// 与双子步的水体分布/河道保持能力等价，成本减半 ⇒ 取 1。
const SUBSTEPS: u32 = 1;
/// 粒子目标间距（m，即求解器维持的最小粒子间距）。★ 由 2.6 提升 70%（×1.7）至 4.42，
/// 再提升 50%（×1.5）至 6.63 ⇒ 单粒子代表更大的水体体积（质量 = `spacing²`、支撑域半径
/// 同步放大），同一水体所需粒子数按 `1/(6.63/2.6)² = 1/6.5²` 下降。
/// ⚠️ 显示粒径与之解耦（见 `render_radii` 与 `RENDER_SPACING_BASE`）：抬升间距只让粒子
/// 在平面上铺得更开，**不改单颗粒子的显示大小**。
const FLUID_SPACING: f32 = 6.63;
/// 支撑域半径 = 间距 × 该系数（1.9 ⇒ 邻域约 11 个粒子）。
const FLUID_RADIUS_K: f32 = 1.9;
/// 全图粒子上限（渲染、求解成本与存档体积的硬闸）。含播种 + 降雨/泉涌的瞬态粒子。
/// ★ 试调 1600 → 4096（2026-09-26，配合 `SHEET_FLOW_LIFETIME = 512s`）：
/// 常态降雨下实测平台 ≈1300~1440（受出流限制、未顶满），暴雨/多泉眼世界才会用上余量。
/// ⚠️ 成本近似线性（≈0.11~0.17 µs/tick/粒子）：4096 粒 ≈ 0.45~0.7 ms/tick，
/// 1× 实时约占单核数个百分比，倍速上限随之下降。
const FLUID_MAX_PARTICLES: usize = 4096;
/// 初始播种预算上限（水体格铺到目标间距即可，余量留给补源的瞬态粒子）。
/// `3000 / 1.7² ≈ 1038`：与「间距 ×1.7」同源的换算，保证同一水体下
/// `spacing_eff = √(水体面积 / 播种数)` 恰好放大 1.7 倍（见 `effective_spacing`）。
const FLUID_SEED_BUDGET: usize = 1040;
/// 每格最多播撒粒子数（防止单格过密）。
const MAX_PER_CELL: usize = 1;
/// 水柱深度下限 / 上限（m）。上限同时是侵蚀的「深水保护」阈值（见 `erosion.rs`）。
const MIN_DEPTH: f32 = 0.35;
pub(crate) const MAX_DEPTH: f32 = 3.0;
/// 重力加速度（m/s²）。侵蚀剪应力与求解器共用同一常数（`erosion.rs` 复用）。
pub(crate) const GRAVITY: f32 = 9.81;
/// Manning 糙率（0.055 ≈ 山地溪流）。侵蚀剪应力复用同一糙率口径。
pub(crate) const MANNING_N: f32 = 0.055;
/// 速度全局阻尼（1/s 口径的一次性比例削减）。
const DAMPING: f32 = 0.02;
/// 速度上限（m/s）——防数值爆炸。
const MAX_SPEED: f32 = 6.0;
/// XSPH 粘性系数。
const VISCOSITY_C: f32 = 0.06;
/// PBF 人工张力修正参数（`s_corr`）。
const SCORR_K: f32 = 0.06;
const SCORR_N: f32 = 4.0;
const SCORR_Q_RATIO: f32 = 0.2;
/// 约束力混合常数（CFM 松弛）。
const CFM_EPS: f32 = 2.0e-2;
/// 单次位置修正上限 = 目标间距 × 该系数。
const MAX_DELTA_RATIO: f32 = 0.25;
/// 播种抖动与初始相位的局部 PRNG 盐。
const SEED_SALT: u64 = 0x464c_5549_4430_3031;
/// 补源（降雨 / 泉涌）落点抖动的局部 PRNG 盐。与 tick 异或 ⇒ 同 tick 落点逐位相同。
const SPAWN_SALT: u64 = 0x464c_5549_4453_504e; // "FLUIDSPN"
/// 绘制粒径系数（与 v1.61.4 前端同源）：水面粒径 = 基准间距 × 1.30，亮点 = × 0.52。
const RENDER_FILL_K: f32 = 1.30;
const RENDER_TONE_K: f32 = 0.52;
/// 绘制粒径基准间距（m）：**与求解器目标间距 `FLUID_SPACING` 解耦**的常量。
/// ★ 2026-09-26：`FLUID_SPACING` 抬升至 6.63 时本基准保持 4.42 ⇒ 单粒子显示大小不变。
/// 仅当预算不足使 `spacing_eff > spacing`（水更稀）时按 `spacing_eff / spacing` 等比放大，
/// 维持「粒子即水面」的读感。
const RENDER_SPACING_BASE: f32 = 4.42;

// ── 补源 / 耗散调参（单点真相源；世界单位 / 秒口径）──
/// 降雨补给速率（粒子 / 秒，按单位降雨强度）：`rainfall_intensity() = 1.0` 时的产率。
/// 与泉眼一起构成补源；**常态降雨下补源 ≈ 出流**（实测出流 ≈ 0.3%/秒 × 粒子数），
/// 故常量降雨把河道稳定在播种水位附近，暴雨才顶到 `FLUID_MAX_PARTICLES`。
const RAIN_SPAWN_RATE: f32 = 1.2;
/// 泉眼补给速率（粒子 / 秒 / 眼）：泉眼为地下水补给，不随降雨强度变化。
const SPRING_SPAWN_RATE: f32 = 0.3;
/// 泉眼落点抖动半径（m）：绕 POI 坐标散开，避免同点重合。
const SPRING_JITTER: f32 = 8.0;
/// 补源信用上限（粒子数）：满员时长期攒信用会在有空位时一次性倾泻 ⇒ 封顶。
const SPAWN_CREDIT_MAX: f32 = 4.0;
/// 坡面漫流（未并入水体的粒子）最长存活时间（秒）：到点即下渗/蒸发消失。
/// ★ 试调 30 → 120 → 512（2026-09-26）：创世已无水体格 ⇒ 不存在「并入水体即清零」的
/// 路径，所有粒子都受本闸门约束；延长寿命让雨水有更长时间顺坡汇流/在低处滞留。
/// ⚠️ 它同时是「全图降雨不淤积」的闸门：稳态粒子数 ≈ 补源速率 × 本寿命，
/// 512s 下常态降雨已足以顶到 `FLUID_MAX_PARTICLES`（1600）上限（≈444s 填满）。
const SHEET_FLOW_LIFETIME: f32 = 512.0;

/// 水体求解器。SoA 布局（逐数组缓存友好 + 零每帧分配）。
pub struct FluidSim {
    count: usize,
    x: Vec<f32>,
    y: Vec<f32>,
    z: Vec<f32>,
    vx: Vec<f32>,
    vy: Vec<f32>,
    px: Vec<f32>,
    py: Vec<f32>,
    dx: Vec<f32>,
    dy: Vec<f32>,
    dens: Vec<f32>,
    lambda: Vec<f32>,
    svx: Vec<f32>,
    svy: Vec<f32>,
    depth: Vec<f32>,
    /// 坡面漫流寿命（秒）：每步按 `dt` 累积，落在**水体格**上立刻清零（并入水体）。
    /// 超过 `SHEET_FLOW_LIFETIME` 的粒子在 `despawn` 中下渗消失。
    age: Vec<f32>,
    /// Manning 摩阻系数 `g·n²/h^{4/3}`：只依赖水柱深度 ⇒ 预算化，
    /// 避免在每个子步对每个粒子调用 `powf`；随深度逐帧重算（见 `step` ①）。
    fric: Vec<f32>,
    /// 当前步的河床坡度（重力驱动分量）：每步算一次，两个子步共用。
    gx: Vec<f32>,
    gy: Vec<f32>,
    grid: ColGrid,
    mass: f32,
    spacing: f32,
    radius: f32,
    rest_density: f32,
    scorr_q: f32,
    /// 实际粒子间距 = √(水体格总面积 / 粒子数)：预算不足时会大于 `spacing`，
    /// 前端据此反推粒径，保证「粒子即水面」在任何水体规模下都读得出来。
    spacing_eff: f32,
    /// 世界 AABB 半边长（**出流判定阈值**）：粒子越出该范围即被移除）。
    world_half: f32,
    bed_eps: f32,
    /// 泉眼坐标（世界 x/y，由 `refresh_springs` 复用容量刷新）⇒ 补源不分配。
    springs: Vec<[f32; 2]>,
    /// 降雨补源信用（粒子数余量）：不足 1 个时不生成，跨步累计。
    rain_credit: f32,
    /// 泉眼补源信用（同上）。
    spring_credit: f32,
    /// 求解器步数（调试探针）。
    pub revision: u64,
    /// 是否参与推进（无水体格且无泉眼时为 false，快照不下发 Fluid section）。
    /// 有补源生成粒子后由 `step` 自动置真（泉眼地图也能长出水体）。
    pub enabled: bool,
}

/// 快照统计（调试探针用）。
#[derive(Debug, Clone, Copy, Default)]
pub struct FluidStats {
    pub particles: usize,
    pub mean_speed: f32,
    pub max_speed: f32,
    pub revision: u64,
}

impl FluidSim {
    /// 按世界规模与地形分辨率建空求解器（只做预分配，不播撒）。
    pub fn new(world_size: f32, grid_res: usize) -> Self {
        let cap = FLUID_MAX_PARTICLES;
        let spacing = FLUID_SPACING;
        let radius = spacing * FLUID_RADIUS_K;
        let step = world_size / (grid_res.max(2) - 1) as f32;
        let mut sim = Self {
            count: 0,
            x: vec![0.0; cap],
            y: vec![0.0; cap],
            z: vec![0.0; cap],
            vx: vec![0.0; cap],
            vy: vec![0.0; cap],
            px: vec![0.0; cap],
            py: vec![0.0; cap],
            dx: vec![0.0; cap],
            dy: vec![0.0; cap],
            dens: vec![0.0; cap],
            lambda: vec![0.0; cap],
            svx: vec![0.0; cap],
            svy: vec![0.0; cap],
            depth: vec![0.0; cap],
            age: vec![0.0; cap],
            fric: vec![0.0; cap],
            gx: vec![0.0; cap],
            gy: vec![0.0; cap],
            grid: ColGrid::new(world_size, radius, cap),
            mass: spacing * spacing,
            spacing,
            radius,
            rest_density: 1.0,
            scorr_q: 0.0,
            spacing_eff: spacing,
            world_half: world_size * 0.5,
            bed_eps: (step * 0.5).max(0.25),
            springs: Vec::new(),
            rain_credit: 0.0,
            spring_credit: 0.0,
            revision: 0,
            enabled: false,
        };
        // 静止密度兜底：按**理想六方堆积**测一次（与分辨率/水体形状无关的常数）。
        // 无静态水体的泉眼地图靠它起步——若留在 1.0，粒子会互相穿模而非被撑开。
        sim.measure_ideal_rest_density();
        sim
    }

    /// 用 5×5 六方点阵测量「理想堆积」的静止密度与 `s_corr` 参考核值。
    /// 纯确定性（无 RNG）、与 `spacing` 同尺度 ⇒ 任意世界都是同一常数。
    fn measure_ideal_rest_density(&mut self) {
        const N: usize = 5;
        let s = self.spacing;
        let (cx, cy) = ((N as f32 - 1.0) * 0.5, (N as f32 - 1.0) * 0.5 * 0.866);
        let mut k = 0usize;
        for gy in 0..N {
            for gx in 0..N {
                self.x[k] = (gx as f32 + if gy % 2 == 1 { 0.5 } else { 0.0 } - cx) * s;
                self.y[k] = (gy as f32 * 0.866 - cy) * s;
                k += 1;
            }
        }
        self.count = N * N;
        self.rebuild_and_measure();
        self.count = 0;
    }

    /// 粒子数。
    #[inline]
    pub fn particle_count(&self) -> usize {
        self.count
    }

    /// 粒子平面坐标只读视图（快照编码用）。
    #[inline]
    pub fn positions(&self) -> (&[f32], &[f32], &[f32]) {
        (&self.x, &self.y, &self.z)
    }

    /// 粒子平面速度只读视图（侵蚀栅格化用）。
    #[inline]
    pub fn velocities(&self) -> (&[f32], &[f32]) {
        (&self.vx, &self.vy)
    }

    /// 粒子水柱深度只读视图（侵蚀栅格化用）。
    #[inline]
    pub fn depths(&self) -> &[f32] {
        &self.depth
    }

    /// 支撑域半径（m）。
    #[inline]
    pub fn support_radius(&self) -> f32 {
        self.radius
    }

    /// 绘制粒径 `(水面粒径, 亮点粒径)`（世界单位）。前端只用它还原 v1.61.4 的颗粒读感。
    /// 基准与求解器目标间距**解耦**（`RENDER_SPACING_BASE`）：目标间距下恒为该基准，
    /// 抬升 `FLUID_SPACING` 不改单粒子显示大小；仅预算不足时按实际间距等比放大。
    #[inline]
    pub fn render_radii(&self) -> (f32, f32) {
        // ratio ≥ 1：目标间距下恒为基准（显示大小不变）；只有水更稀时才等比放大。
        let ratio = (self.spacing_eff / self.spacing).max(1.0);
        let base = RENDER_SPACING_BASE * ratio;
        (base * RENDER_FILL_K, base * RENDER_TONE_K)
    }

    /// 调试统计。
    pub fn stats(&self) -> FluidStats {
        let n = self.count;
        if n == 0 {
            return FluidStats { revision: self.revision, ..Default::default() };
        }
        let mut sum = 0.0f32;
        let mut max = 0.0f32;
        for i in 0..n {
            let sp = (self.vx[i] * self.vx[i] + self.vy[i] * self.vy[i]).sqrt();
            sum += sp;
            if sp > max {
                max = sp;
            }
        }
        FluidStats {
            particles: n,
            mean_speed: sum / n as f32,
            max_speed: max,
            revision: self.revision,
        }
    }

    /// 按地形水体格播种粒子（创世 / 重置 / 读档缺流体状态时调用）。
    ///
    /// 播种是**确定性**的：只依赖 `terrain.seed` 与地形格，不消耗 `WorldRng`。
    pub fn seed_from_terrain(&mut self, terrain: &TerrainMap) {
        self.count = 0;
        let total = terrain.cells.len();
        if total == 0 {
            self.enabled = false;
            return;
        }

        let Some((water, budget)) = plan_layers(terrain) else {
            self.enabled = false;
            return;
        };
        self.spacing_eff = effective_spacing(terrain, water.len(), budget);

        let gw = terrain.grid_width;
        let cell_step = terrain.world_size / (gw.max(2) - 1) as f32;
        let mut rng = WorldRng::new(terrain.seed ^ SEED_SALT);

        for k in 0..budget {
            // 按比例把预算均匀铺到水体格上（确定性取模，不用 RNG 选格）
            let ci = water[(k * water.len()) / budget] as usize;
            let cx = ci % gw;
            let cy = ci / gw;
            let base = terrain.grid_pos(cx, cy);
            let jx = (rng.gen_range(0.0, 1.0) - 0.5) * cell_step;
            let jy = (rng.gen_range(0.0, 1.0) - 0.5) * cell_step;
            self.x[k] = base.x + jx;
            self.y[k] = base.y + jy;
            self.vx[k] = 0.0;
            self.vy[k] = 0.0;
            self.age[k] = 0.0;
        }
        self.count = budget;

        // ④ 静止密度 = 播种构型下的平均密度（自由表面松弛：只约束压缩）
        self.rebuild_and_measure();
        self.derive_columns(terrain);
        self.enabled = true;
        self.revision = 0;
    }

    /// 派生全部粒子的 `(水柱深度, 摩阻, 渲染水位)`（不含坡度分量）。
    /// 播种与读档后各调用一次 ⇒ 首帧快照的水面即正确，不必等第一步推进；
    /// 坡度分量只由 `step` ① 重算（保存路径不需要）。
    fn derive_columns(&mut self, terrain: &TerrainMap) {
        for k in 0..self.count {
            let bed = bed_at(terrain, self.x[k], self.y[k]);
            let (depth, fric) = column_at(terrain, self.x[k], self.y[k], bed);
            self.depth[k] = depth;
            self.fric[k] = fric;
            self.z[k] = bed + depth;
        }
    }

    /// 用引擎的 POI 列表刷新泉眼坐标（容量复用 ⇒ 稳态零分配）。
    /// 泉眼为地下水补给：不随降雨强度变化，是「无静态水体」地图的唯一水源。
    pub fn refresh_springs<I: Iterator<Item = (f32, f32)>>(&mut self, sources: I) {
        self.springs.clear();
        for (x, y) in sources {
            self.springs.push([x, y]);
        }
    }

    /// 是否存在泉眼补源。
    #[inline]
    pub fn has_springs(&self) -> bool {
        !self.springs.is_empty()
    }

    /// 泉眼数量（调试探针）。
    #[inline]
    pub fn spring_count(&self) -> usize {
        self.springs.len()
    }

    /// 重建桶索引并测量平均密度作为 `rest_density`。
    fn rebuild_and_measure(&mut self) {
        let n = self.count;
        let h = self.radius;
        let h2 = h * h;
        let h5 = h2 * h2 * h;
        let h8 = h5 * h2 * h;
        self.grid.rebuild(&self.x, &self.y, n);
        pbf::compute_density(
            &self.grid,
            &self.x,
            &self.y,
            n,
            self.mass,
            h,
            h2,
            h5,
            h8,
            &mut self.dens,
        );
        if n == 0 {
            self.rest_density = 1.0;
            return;
        }
        let mut sum = 0.0f32;
        for i in 0..n {
            sum += self.dens[i];
        }
        let mean = sum / n as f32;
        self.rest_density = if mean.is_finite() && mean > 1e-6 { mean } else { 1.0 };
        let dq = h * SCORR_Q_RATIO;
        self.scorr_q = pbf::poly6(dq * dq, h2, h8);
    }

    /// 按 `dt` 推进一个流体步（顺序固定：补源 → 剖面/深度/寿命 → 子步 → 出流与下渗淘汰）。
    ///
    /// * `tick`：当前 tick 计数——补源落点的局部 PRNG 种，读档恢复 `tick_counter` 后
    ///   同一 tick 的落点逐位相同（无需把 PRNG 状态入档）。
    /// * `rainfall`：有效降雨强度（`World3DEngine::rainfall_intensity()`；0 = 无雨）。
    pub fn step(&mut self, terrain: &TerrainMap, dt: f32, tick: u64, rainfall: f32) {
        if !dt.is_finite() || dt <= 0.0 {
            return;
        }
        self.spawn(terrain, dt, tick, rainfall);
        if self.count == 0 {
            return;
        }
        // 每步一次：河床坡度（重力驱动分量）、水柱深度、渲染水位与摩阻。
        // 地形在一个流体步内不变，两个子步共用同一份坡度（粒子单步位移 ≪ 格距）。
        let n = self.count;
        let eps = self.bed_eps;
        for i in 0..n {
            let (z, sx, sy) = bed_profile(terrain, self.x[i], self.y[i], eps);
            self.gx[i] = sx;
            self.gy[i] = sy;
            let (depth, fric) = column_at(terrain, self.x[i], self.y[i], z);
            self.depth[i] = depth;
            self.fric[i] = fric;
            self.z[i] = z + depth;
            // 坡面漫流寿命：落在水体格上即并入水体（清零），否则按模拟时间累积。
            self.age[i] = if is_water_at(terrain, self.x[i], self.y[i]) {
                0.0
            } else {
                self.age[i] + dt
            };
        }

        let sub_dt = dt / SUBSTEPS as f32;
        for _ in 0..SUBSTEPS {
            self.substep(sub_dt);
        }
        self.despawn();
        self.revision = self.revision.wrapping_add(1);
    }

    /// 补源：降雨（全图均匀落点）+ 泉眼（POI 坐标邻域落点）。
    ///
    /// 信用按 `速率 × dt` 累积，够 1 个才生成；满员时靠 `SPAWN_CREDIT_MAX` 封顶，
    /// 避免长期满员后一次性倾泻。落点走 `seed ^ SPAWN_SALT ^ tick` 的局部 PRNG
    /// ⇒ 不消耗 `WorldRng`、同 tick 可复现。
    fn spawn(&mut self, terrain: &TerrainMap, dt: f32, tick: u64, rainfall: f32) {
        let cap = self.x.len();
        if self.count >= cap {
            return;
        }
        let rain_rate = if rainfall.is_finite() {
            (RAIN_SPAWN_RATE * rainfall).max(0.0)
        } else {
            0.0
        };
        let spring_rate = SPRING_SPAWN_RATE * self.springs.len() as f32;
        if rain_rate <= 0.0 && spring_rate <= 0.0 {
            return;
        }
        self.rain_credit = (self.rain_credit + rain_rate * dt).min(SPAWN_CREDIT_MAX);
        self.spring_credit = (self.spring_credit + spring_rate * dt).min(SPAWN_CREDIT_MAX);
        let mut n_spring = 0usize;
        while self.spring_credit >= 1.0 && self.count + n_spring < cap {
            self.spring_credit -= 1.0;
            n_spring += 1;
        }
        let mut n_rain = 0usize;
        while self.rain_credit >= 1.0 && self.count + n_spring + n_rain < cap {
            self.rain_credit -= 1.0;
            n_rain += 1;
        }
        if n_spring + n_rain == 0 {
            return;
        }
        let half = self.world_half;
        let n_src = self.springs.len();
        let mut rng = WorldRng::new(terrain.seed ^ SPAWN_SALT ^ tick);
        // 顺序固定：先泉眼（等距轮转挑眼）后降雨 ⇒ 同 tick 的随机数消耗序列一致。
        for k in 0..n_spring {
            let s = self.springs[k % n_src];
            let x = (s[0] + (rng.gen_range(0.0, 1.0) - 0.5) * SPRING_JITTER * 2.0)
                .clamp(-half, half);
            let y = (s[1] + (rng.gen_range(0.0, 1.0) - 0.5) * SPRING_JITTER * 2.0)
                .clamp(-half, half);
            self.push_particle(x, y);
        }
        for _ in 0..n_rain {
            let x = rng.gen_range(-half, half);
            let y = rng.gen_range(-half, half);
            self.push_particle(x, y);
        }
        self.enabled = true;
    }

    /// 追加一个粒子（满员则忽略）。位置之外的状态由本步 ① 段统一派生。
    fn push_particle(&mut self, x: f32, y: f32) {
        let i = self.count;
        if i >= self.x.len() {
            return;
        }
        self.x[i] = x;
        self.y[i] = y;
        self.vx[i] = 0.0;
        self.vy[i] = 0.0;
        self.age[i] = 0.0;
        self.count = i + 1;
    }

    /// 出流与下渗淘汰：越过世界边界（水从地图边缘流出）或坡面漫流超时的粒子被移除。
    fn despawn(&mut self) {
        let half = self.world_half;
        let mut i = 0;
        while i < self.count {
            let out = self.x[i].abs() > half || self.y[i].abs() > half;
            if out || self.age[i] > SHEET_FLOW_LIFETIME {
                self.swap_remove(i);
            } else {
                i += 1;
            }
        }
    }

    /// 移除第 `i` 个粒子：末尾粒子整组字段顶替到 `i`（`count` 减一）。
    /// 代价是「只有一个粒子的绘制下标变了」（相对整体左移，视觉抖动最不突兀）。
    fn swap_remove(&mut self, i: usize) {
        let last = self.count - 1;
        if i != last {
            self.x[i] = self.x[last];
            self.y[i] = self.y[last];
            self.z[i] = self.z[last];
            self.vx[i] = self.vx[last];
            self.vy[i] = self.vy[last];
            self.px[i] = self.px[last];
            self.py[i] = self.py[last];
            self.dx[i] = self.dx[last];
            self.dy[i] = self.dy[last];
            self.dens[i] = self.dens[last];
            self.lambda[i] = self.lambda[last];
            self.svx[i] = self.svx[last];
            self.svy[i] = self.svy[last];
            self.depth[i] = self.depth[last];
            self.age[i] = self.age[last];
            self.fric[i] = self.fric[last];
            self.gx[i] = self.gx[last];
            self.gy[i] = self.gy[last];
        }
        self.count = last;
    }

    /// 单个子步：受力 → 预测 → 约束投影 → 速度回收 → 粘性。
    fn substep(&mut self, dt: f32) {
        let n = self.count;
        let h = self.radius;
        let h2 = h * h;
        let h5 = h2 * h2 * h;
        let h8 = h5 * h2 * h;
        let max_delta = self.spacing * MAX_DELTA_RATIO;

        // ① 重力沿坡分量 + Manning 底部摩阻（预算化系数），并预测位置
        for i in 0..n {
            let vxi = self.vx[i];
            let vyi = self.vy[i];
            let speed = (vxi * vxi + vyi * vyi).sqrt();
            let fric = self.fric[i];
            let ax = -GRAVITY * self.gx[i] - fric * speed * vxi;
            let ay = -GRAVITY * self.gy[i] - fric * speed * vyi;
            let mut nvx = (vxi + ax * dt) * (1.0 - DAMPING);
            let mut nvy = (vyi + ay * dt) * (1.0 - DAMPING);
            if !nvx.is_finite() {
                nvx = 0.0;
            }
            if !nvy.is_finite() {
                nvy = 0.0;
            }
            let sp = (nvx * nvx + nvy * nvy).sqrt();
            if sp > MAX_SPEED {
                let k = MAX_SPEED / sp;
                nvx *= k;
                nvy *= k;
            }
            self.vx[i] = nvx;
            self.vy[i] = nvy;
            self.px[i] = self.x[i] + nvx * dt;
            self.py[i] = self.y[i] + nvy * dt;
        }

        // ② 约束投影（PBF）
        self.grid.rebuild(&self.px, &self.py, n);
        pbf::compute_density(
            &self.grid,
            &self.px,
            &self.py,
            n,
            self.mass,
            h,
            h2,
            h5,
            h8,
            &mut self.dens,
        );
        pbf::compute_lambda(
            &self.grid,
            &self.px,
            &self.py,
            n,
            &self.dens,
            self.rest_density,
            h,
            h2,
            h5,
            h8,
            CFM_EPS,
            &mut self.lambda,
        );
        pbf::integrate_delta(
            &self.grid,
            &self.px,
            &self.py,
            n,
            &self.lambda,
            self.rest_density,
            h,
            h2,
            h5,
            h8,
            SCORR_K,
            SCORR_N,
            self.scorr_q,
            &mut self.dx,
            &mut self.dy,
        );

        // ③ 施加修正（只限制单步修正量），速度回收。
        // 边界**不夹紧**：越出世界 AABB 的粒子由 `despawn` 移除 ⇒ 水从地图边缘流出。
        let inv_dt = 1.0 / dt;
        for i in 0..n {
            let mut ddx = self.dx[i];
            let mut ddy = self.dy[i];
            if !ddx.is_finite() {
                ddx = 0.0;
            }
            if !ddy.is_finite() {
                ddy = 0.0;
            }
            let dl = (ddx * ddx + ddy * ddy).sqrt();
            if dl > max_delta {
                let k = max_delta / dl;
                ddx *= k;
                ddy *= k;
            }
            let nx = self.px[i] + ddx;
            let ny = self.py[i] + ddy;
            let nvx = (nx - self.x[i]) * inv_dt;
            let nvy = (ny - self.y[i]) * inv_dt;
            if nvx.is_finite() {
                self.vx[i] = nvx;
            }
            if nvy.is_finite() {
                self.vy[i] = nvy;
            }
            self.x[i] = nx;
            self.y[i] = ny;
        }

        // ④ XSPH 粘性（双缓冲，避免就地更新引入顺序偏差）
        pbf::apply_viscosity(
            &self.grid,
            &self.x,
            &self.y,
            n,
            &self.vx,
            &self.vy,
            self.rest_density,
            h,
            h2,
            h5,
            h8,
            VISCOSITY_C,
            &mut self.svx,
            &mut self.svy,
        );
        for i in 0..n {
            if self.svx[i].is_finite() {
                self.vx[i] = self.svx[i];
            }
            if self.svy[i].is_finite() {
                self.vy[i] = self.svy[i];
            }
        }
    }
}

/// 双线性采样河床高程（世界坐标 → 栅格坐标口径与 `TerrainMap::grid_coords` 一致）。
#[inline]
pub fn bed_at(terrain: &TerrainMap, wx: f32, wy: f32) -> f32 {
    let gw = terrain.grid_width;
    let gh = terrain.grid_height;
    if gw == 0 || gh == 0 {
        return 0.0;
    }
    let (fx, fy) = terrain.grid_coords(wx, wy);
    let x0 = fx.floor().max(0.0) as usize;
    let y0 = fy.floor().max(0.0) as usize;
    let tx = fx - x0 as f32;
    let ty = fy - y0 as f32;
    let ix0 = x0.min(gw - 1);
    let iy0 = y0.min(gh - 1);
    let ix1 = (ix0 + 1).min(gw - 1);
    let iy1 = (iy0 + 1).min(gh - 1);
    let cells = &terrain.cells;
    let e00 = cells[iy0 * gw + ix0].elevation;
    let e10 = cells[iy0 * gw + ix1].elevation;
    let e01 = cells[iy1 * gw + ix0].elevation;
    let e11 = cells[iy1 * gw + ix1].elevation;
    let a = e00 + (e10 - e00) * tx;
    let b = e01 + (e11 - e01) * tx;
    a + (b - a) * ty
}

/// 河床剖面：一次返回 `(高程 z, 坡度 dz/dx, 坡度 dz/dy)`（中心差分，共 5 次双线性采样）。
#[inline]
fn bed_profile(terrain: &TerrainMap, wx: f32, wy: f32, eps: f32) -> (f32, f32, f32) {
    let z = bed_at(terrain, wx, wy);
    let inv = 1.0 / (2.0 * eps);
    let sx = (bed_at(terrain, wx + eps, wy) - bed_at(terrain, wx - eps, wy)) * inv;
    let sy = (bed_at(terrain, wx, wy + eps) - bed_at(terrain, wx, wy - eps)) * inv;
    (
        z,
        if sx.is_finite() { sx } else { 0.0 },
        if sy.is_finite() { sy } else { 0.0 },
    )
}

/// 播种计划：水体格下标（行主序）与粒子预算。无水体格时返回 `None`。
fn plan_layers(terrain: &TerrainMap) -> Option<(Vec<u32>, usize)> {
    let mut water: Vec<u32> = Vec::with_capacity(1024);
    for (i, cell) in terrain.cells.iter().enumerate() {
        if cell.water_body_id.is_some() {
            water.push(i as u32);
        }
    }
    if water.len() < 4 {
        return None;
    }
    let budget = FLUID_SEED_BUDGET.min(water.len() * MAX_PER_CELL);
    Some((water, budget))
}

/// 实际粒子间距 = √(水体格总面积 / 粒子数)。
///
/// 预算足够时等于 `FLUID_SPACING`；水体过大而不够铺时大于它（水更稀），
/// 前端据此放大粒径以维持「粒子即水面」的读感。
fn effective_spacing(terrain: &TerrainMap, water_cells: usize, budget: usize) -> f32 {
    if budget == 0 {
        return FLUID_SPACING;
    }
    let step = terrain.world_size / (terrain.grid_width.max(2) - 1) as f32;
    let area = water_cells as f32 * step * step;
    let s = (area / budget as f32).sqrt();
    if s.is_finite() && s > 0.1 {
        s
    } else {
        FLUID_SPACING
    }
}

/// 位置处的水体水位（非水体格 / 无匹配水体返回 `None`）。
#[inline]
fn water_level_at(terrain: &TerrainMap, wx: f32, wy: f32) -> Option<f32> {
    if terrain.cells.is_empty() {
        return None;
    }
    let (gx, gy) = terrain.grid_index(wx, wy);
    let id = terrain.cells[gy * terrain.grid_width + gx].water_body_id?;
    terrain
        .hydrology
        .water_bodies
        .iter()
        .find(|body| body.id == id)
        .map(|body| body.level)
}

/// 该位置是否落在水体格上（坡面漫流寿命的重置判据）。
#[inline]
fn is_water_at(terrain: &TerrainMap, wx: f32, wy: f32) -> bool {
    if terrain.cells.is_empty() {
        return false;
    }
    let (gx, gy) = terrain.grid_index(wx, wy);
    terrain.cells[gy * terrain.grid_width + gx].water_body_id.is_some()
}

/// 水柱深度：水体格 = `clamp(水位 − 河床, MIN_DEPTH, MAX_DEPTH)`，陆地格 = `MIN_DEPTH`。
///
/// 口径是粒子**当前位置**（不是播种格）⇒ 雨滴/泉水汇入河道后立刻取到该水体的厚度，
/// 渲染面也恒等于 `z_bed + clamp(水位 − z_bed, MIN, MAX)`（与 33 号文的模型同式）。
/// 位置随存档位精确恢复 ⇒ 连续运行与读档路径逐位一致，深度无需入档。
#[inline]
fn depth_at(terrain: &TerrainMap, wx: f32, wy: f32, bed: f32) -> f32 {
    match water_level_at(terrain, wx, wy) {
        Some(level) => (level - bed).clamp(MIN_DEPTH, MAX_DEPTH),
        None => MIN_DEPTH,
    }
}

/// 由位置派生单根水柱的 `(深度, Manning 摩阻系数)`：推进与播种/读档共用同一公式。
#[inline]
fn column_at(terrain: &TerrainMap, wx: f32, wy: f32, bed: f32) -> (f32, f32) {
    let depth = depth_at(terrain, wx, wy, bed);
    (
        depth,
        GRAVITY * MANNING_N * MANNING_N / depth.powf(4.0 / 3.0),
    )
}

/// 存档用的流体状态。
///
/// `particles` 为 `count` 组 `[x, y, vx, vy, age]` 的 f32 小端字节的十六进制串——
/// **位精确**（十六进制往返不丢精度），否则读档续演无法与不中断运行逐字节一致。
/// 粒子数是**动态**的（降雨/泉涌补源、边界出流、坡面下渗），故 `age` 与两个补源
/// 信用必须入档；深度 / 摩阻 / 静止密度派生量不入档（按地形与位置原样重算）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FluidSaveState {
    pub count: u32,
    pub rest_density: f32,
    pub revision: u64,
    /// 降雨补源信用（粒子数余量）；旧档缺字段时按 0 起算。
    #[serde(default)]
    pub rain_credit: f32,
    /// 泉眼补源信用；旧档缺字段时按 0 起算。
    #[serde(default)]
    pub spring_credit: f32,
    pub particles: String,
}

/// 每粒子存档字节数：`x, y, vx, vy, age` 共 5 个 f32。
const PARTICLE_STRIDE: usize = 20;

impl FluidSim {
    /// 导出位精确状态（`count == 0` 时 `particles` 为空串）。
    pub fn export_state(&self) -> FluidSaveState {
        let n = self.count;
        let mut bytes: Vec<u8> = Vec::with_capacity(n * PARTICLE_STRIDE);
        for i in 0..n {
            for v in [self.x[i], self.y[i], self.vx[i], self.vy[i], self.age[i]] {
                bytes.extend_from_slice(&v.to_le_bytes());
            }
        }
        FluidSaveState {
            count: n as u32,
            rest_density: self.rest_density,
            revision: self.revision,
            rain_credit: self.rain_credit,
            spring_credit: self.spring_credit,
            particles: hex_encode(&bytes),
        }
    }

    /// 从存档状态恢复。任何不自洽（长度/上限不符）都返回 `false`，
    /// 由调用方回退到 `seed_from_terrain`（旧档缺字段 / 旧载荷口径场景）。
    pub fn restore_state(&mut self, terrain: &TerrainMap, state: &FluidSaveState) -> bool {
        let n = state.count as usize;
        if n > FLUID_MAX_PARTICLES {
            return false;
        }
        let Some(bytes) = hex_decode(&state.particles) else {
            return false;
        };
        if bytes.len() != n * PARTICLE_STRIDE {
            return false;
        }
        // 实际间距仍按「静态水体面积 / 播种预算」定（与粒子数无关 ⇒ 稳态恒定）；
        // 显示粒径由 `render_radii` 以 `RENDER_SPACING_BASE` 为基准重新派生（与目标间距解耦）。
        self.spacing_eff = match plan_layers(terrain) {
            Some((water, budget)) => effective_spacing(terrain, water.len(), budget),
            None => FLUID_SPACING,
        };
        for k in 0..n {
            let o = k * PARTICLE_STRIDE;
            let rd = |i: usize| -> f32 {
                f32::from_le_bytes([
                    bytes[o + i * 4],
                    bytes[o + i * 4 + 1],
                    bytes[o + i * 4 + 2],
                    bytes[o + i * 4 + 3],
                ])
            };
            self.x[k] = rd(0);
            self.y[k] = rd(1);
            self.vx[k] = rd(2);
            self.vy[k] = rd(3);
            self.age[k] = rd(4);
        }
        self.count = n;
        self.rest_density = if state.rest_density.is_finite() && state.rest_density > 1e-6 {
            state.rest_density
        } else {
            1.0
        };
        self.rain_credit = if state.rain_credit.is_finite() {
            state.rain_credit.clamp(0.0, SPAWN_CREDIT_MAX)
        } else {
            0.0
        };
        self.spring_credit = if state.spring_credit.is_finite() {
            state.spring_credit.clamp(0.0, SPAWN_CREDIT_MAX)
        } else {
            0.0
        };
        self.revision = state.revision;
        let h2 = self.radius * self.radius;
        let h8 = h2 * h2 * h2 * h2;
        let dq = self.radius * SCORR_Q_RATIO;
        self.scorr_q = pbf::poly6(dq * dq, h2, h8);
        self.derive_columns(terrain);
        self.enabled = n > 0;
        true
    }
}

const HEX_DIGITS: &[u8; 16] = b"0123456789abcdef";

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX_DIGITS[(b >> 4) as usize] as char);
        out.push(HEX_DIGITS[(b & 0x0f) as usize] as char);
    }
    out
}

fn hex_nibble(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn hex_decode(text: &str) -> Option<Vec<u8>> {
    let bytes = text.as_bytes();
    if bytes.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 2);
    let mut i = 0;
    while i < bytes.len() {
        let hi = hex_nibble(bytes[i])?;
        let lo = hex_nibble(bytes[i + 1])?;
        out.push((hi << 4) | lo);
        i += 2;
    }
    Some(out)
}
