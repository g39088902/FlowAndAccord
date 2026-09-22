//! 静态河谷几何。水量由 World 的共享池维护，几何不随库存变化。
use serde::{Deserialize, Serialize};
use crate::{config::SimConfig, rng::WorldRng, spatial::vec3::Vec3};
use super::{biome::*, terrain::*};

/// Parameterised river centreline used during terrain generation.
///
/// The centreline is deliberately generation-only (it is not part of the
/// save/snapshot schema).  Consumers should use the exact segment distance
/// rather than the old horizontal `x - center(y)` approximation.
#[derive(Debug, Clone)]
pub struct RiverCenterline {
    pub points: Vec<Vec3>,
    pub cumulative: Vec<f32>,
    pub total: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct MeanderWindow {
    pub s0: f32,
    pub s1: f32,
    pub arc_length: f32,
    pub chord_length: f32,
    pub chord_over_arc: f32,
    pub neck_width: f32,
    pub swing_diameter: f32,
}

impl RiverCenterline {
    pub fn new(points: Vec<Vec3>) -> Self {
        let mut cumulative = Vec::with_capacity(points.len());
        cumulative.push(0.0);
        for i in 1..points.len() {
            let d = points[i].distance_to(&points[i - 1]);
            cumulative.push(cumulative[i - 1] + d);
        }
        let total = *cumulative.last().unwrap_or(&0.0);
        Self { points, cumulative, total }
    }

    pub fn sample(&self, s: f32) -> Vec3 {
        if self.points.is_empty() { return Vec3::ZERO; }
        if self.points.len() == 1 { return self.points[0]; }
        let s = s.clamp(0.0, self.total);
        let hi = self.cumulative.partition_point(|v| *v < s);
        if hi == 0 { return self.points[0]; }
        if hi >= self.points.len() { return *self.points.last().unwrap(); }
        let lo = hi - 1;
        let span = (self.cumulative[hi] - self.cumulative[lo]).max(f32::EPSILON);
        Vec3::lerp(self.points[lo], self.points[hi], (s - self.cumulative[lo]) / span)
    }

    /// Exact point-to-polyline distance.  Ties are resolved by the lowest
    /// segment index, making the result deterministic across platforms.
    pub fn distance(&self, p: Vec3) -> (f32, f32, f32) {
        let mut best_d2 = f32::INFINITY;
        let mut best_s = 0.0;
        let mut best_lateral = 0.0;
        for i in 0..self.points.len().saturating_sub(1) {
            let a = self.points[i];
            let b = self.points[i + 1];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let len2 = dx * dx + dy * dy;
            if len2 <= f32::EPSILON { continue; }
            let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / len2).clamp(0.0, 1.0);
            let qx = a.x + dx * t;
            let qy = a.y + dy * t;
            let ex = p.x - qx;
            let ey = p.y - qy;
            let d2 = ex * ex + ey * ey;
            if d2 < best_d2 {
                best_d2 = d2;
                best_s = self.cumulative[i] + len2.sqrt() * t;
                // Positive = left of the direction of travel.
                best_lateral = (dx * ey - dy * ex).signum() * d2.sqrt();
            }
        }
        (best_d2.sqrt(), best_s, best_lateral)
    }

    /// Signed cross-track distance (positive on the left bank).
    pub fn lateral(&self, p: Vec3) -> f32 { self.distance(p).2 }

    /// Arc-length position where the centreline crosses a requested y.
    /// The generated production centreline is y-monotonic; this also handles
    /// a non-monotonic future centreline by returning the nearest crossing.
    pub fn s_at_y(&self, y: f32) -> f32 {
        let mut best = (f32::INFINITY, 0.0);
        for i in 0..self.points.len().saturating_sub(1) {
            let a = self.points[i]; let b = self.points[i + 1];
            let dy = b.y - a.y;
            let t = if dy.abs() < f32::EPSILON { 0.0 } else { ((y-a.y)/dy).clamp(0.0, 1.0) };
            let err = (a.y + dy*t - y).abs();
            if err < best.0 { best = (err, self.cumulative[i] + a.distance_to(&b)*t); }
        }
        best.1
    }

    /// Scan candidate windows for the R0-4 oxbow precondition.  This is a
    /// diagnostic/local predicate only: failure means the future OxbowLake
    /// feature is not injected, never that the base world is rejected.
    pub fn meander_windows(&self, half_width: f32) -> Vec<MeanderWindow> {
        let mut out = Vec::new();
        if self.points.len() < 3 { return out; }
        // A 20-sample window is ~60m at the production spacing and is wide
        // enough to contain the bend while keeping the two banks close.
        for i in 0..self.points.len().saturating_sub(20) {
            let j = (i + 20).min(self.points.len() - 1);
            let arc = self.cumulative[j] - self.cumulative[i];
            let chord = self.points[i].distance_to(&self.points[j]);
            if arc <= f32::EPSILON { continue; }
            let neck = (chord - 2.0 * half_width).max(0.0);
            let swing = self.points[i..=j].iter().map(|p| p.x).fold(0.0f32, |m, x| m.max(x.abs())) * 2.0;
            if chord / arc <= 0.71 && neck >= 0.5 * half_width && neck <= 3.0 * half_width && swing >= 4.0 * half_width {
                out.push(MeanderWindow { s0: self.cumulative[i], s1: self.cumulative[j], arc_length: arc, chord_length: chord, chord_over_arc: chord / arc, neck_width: neck, swing_diameter: swing });
            }
        }
        out
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Hydrology {
    pub water_bodies: Vec<WaterBody>,
    pub access_points: Vec<WaterAccessPoint>,
    pub connections: Vec<TerrainConnection>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaterBody {
    pub id: u32,
    pub level: f32,
    pub flow_direction: Vec3,
    pub resource_pool_id: u32,
    pub vertices: Vec<Vec3>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaterAccessPoint {
    pub id: u32,
    pub water_body_id: u32,
    pub resource_pool_id: u32,
    pub pos: Vec3,
    pub nearest_node_id: Option<u32>,
    pub interaction_radius: f32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainConnection {
    pub id: u32,
    pub start: Vec3,
    pub end: Vec3,
    pub width: f32,
    pub node_a: Option<u32>,
    pub node_b: Option<u32>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaterPool {
    pub id: u32,
    pub current_stock: f32,
    pub max_stock: f32,
    pub regen_rate: f32,
    pub source_poi_ids: Vec<u32>,
}
impl WaterPool {
    pub fn extract(&mut self, amount: f32) -> f32 {
        let taken = amount.max(0.0).min(self.current_stock);
        self.current_stock -= taken;
        taken
    }
}

/// T2 主河静态几何参数（★ STAGE2-2 公式解耦：陆地区域基础生成与水系影响带覆盖
/// 共享同一份河几何，保证拆分前后逐比特等价）。
///
/// 由 `plan_river_geometry` 从单一 `hydro_rng`（`seed ^ 0x4859_4452_4f54_3032`）
/// 规划：仅消费 1 次 `gen_range(-1.0, 1.0)` 相位抽取，消费顺序与旧
/// `generate_river` 完全一致。`width_amp` 为 `(width_max - width_min).max(0.0) * 0.22`
/// 的预乘（浮点结合次序与旧内联算式相同，逐比特同值）。
#[derive(Clone)]
pub struct RiverGeometry {
    pub phase: f32,
    pub level: f32,
    /// `((width_min + width_max) * 0.5).max(12.0)`
    pub width: f32,
    /// `bank_width.max(8.0)`
    pub bank: f32,
    /// `terrace_width.max(20.0)`
    pub terrace: f32,
    pub width_amp: f32,
    pub centerline: RiverCenterline,
}

impl RiverGeometry {
    /// 主河中心线：正弦蜿蜒，完全静态（水量由共享池维护，几何不随库存变化）。
    #[inline]
    pub fn center(&self, y: f32, _size: f32) -> f32 {
        let p = self.centerline.s_at_y(y);
        self.centerline.sample(p).x
    }
    /// 河道半宽：基准半宽 + 波动振幅。
    #[inline]
    pub fn half_width(&self, y: f32, size: f32) -> f32 {
        self.width * 0.5 + self.width_amp * (y / size * 7.0).cos()
    }

    #[inline]
    pub fn distance(&self, p: Vec3) -> (f32, f32, f32) { self.centerline.distance(p) }

    #[inline]
    pub fn point_at_y(&self, y: f32) -> Vec3 { self.centerline.sample(self.centerline.s_at_y(y)) }
}

/// 规划 T2 主河几何（§5.3 第 3 步 `apply_profile_static_hydrology` 的参数解析前身）。
/// `pub(super)`：★ STAGE2-3 编排器（`terrain.rs::generate_with_config`）在第 2 步前
/// 调用并写入流水线 scratch，第 2 步铺河谷低丘与第 3 步施加水面共用同一份几何。
pub(super) fn plan_river_geometry(seed: u64, cfg: &SimConfig, size: f32) -> RiverGeometry {
    let mut rng = WorldRng::new(seed ^ 0x4859_4452_4f54_3032);
    let phase = rng.gen_range(-1.0, 1.0);
    let half = size * 0.5;
    // Three broad loops provide a real meander train while leaving generous
    // margin for the river terrace.  The phase remains the historical single
    // hydro RNG draw; all derived points are pure arithmetic.
    let mut points = Vec::with_capacity(257);
    for i in 0..=256 {
        let t = i as f32 / 256.0;
        let y = -half + t * size;
        let x = size * 0.155 * (t * std::f32::consts::TAU * 3.0 + phase * 0.35).sin();
        points.push(Vec3::new(x, y, 0.0));
    }
    RiverGeometry {
        phase,
        level: cfg.terrain_river_water_level,
        width: ((cfg.terrain_river_width_min + cfg.terrain_river_width_max) * 0.5).max(12.0),
        bank: cfg.terrain_river_bank_width.max(8.0),
        terrace: cfg.terrain_river_terrace_width.max(20.0),
        width_amp: (cfg.terrain_river_width_max - cfg.terrain_river_width_min).max(0.0) * 0.22,
        centerline: RiverCenterline::new(points),
    }
}

impl TerrainMap {
    /// §5.3 第 3 步 `apply_profile_static_hydrology`：静态水系施加（★ STAGE2-3
    /// 阶段化重构）。T2 主河走 STAGE2-2 收敛版 `generate_river`（仅覆盖水系影响带，
    /// 陆地基底已由第 2 步 river_valley 分支铺满全图）；P1 新模板的对应水面在此预留。
    ///
    /// 坡度定稿移交流水线第 6 步（原 `generate_river` 尾部 `recompute_slopes()`
    /// 上移至 `finalize_slope_and_surface`，调用时序不变）。
    pub(super) fn apply_profile_static_hydrology(
        &mut self,
        config: &SimConfig,
        scratch: &super::terrain::GenesisScratch,
    ) {
        if let Some(geom) = scratch.river_geometry.as_ref() {
            self.generate_river(geom, config);
        }
        // ★ TB-03 静水（湖畔大湖）：`WaterBody` 特征 #1 + 水体 #1 + 岸点
        //   独立于主河逻辑、零流向静水语义、connections 为空。
        if let Some(lg) = scratch.lake_geometry.as_ref() {
            if let Some(plan) = lg.water.as_ref() {
                super::static_water::apply_static_water(
                    self,
                    plan,
                    config,
                    |wx, wy| lg.lake_bed_elevation(wx, wy),
                );
            }
        }
    }
    /// T2 主河水系写入（★ STAGE2-2 收敛：仅覆盖水系影响带）。
    ///
    /// 陆地区域（`outside >= bank + terrace`）的高程/地表/肥力/flags 已由
    /// `terrain.rs::generate_river_valley_base_relief` 铺满全图，本函数**只写**
    /// 横向距离落在影响带内（`d < half_width + bank + terrace`）的局部网格：
    /// 河面、河岸、河阶三种地表覆盖 + 浅滩走廊、轮廓特征与取水点。带外一格不碰。
    /// 静态状态清空归流水线第 1 步、坡度定稿归第 6 步（★ STAGE2-3），本函数不再
    /// 自行 `features.clear()` / `recompute_slopes()`。
    fn generate_river(&mut self, geom: &RiverGeometry, cfg: &SimConfig) {
        let size = self.world_size;
        let level = geom.level;
        let bank = geom.bank;
        let terrace = geom.terrace;
        let width = geom.width;
        let center = |y: f32| geom.center(y, size);
        let half_width = |y: f32| geom.half_width(y, size);
        for gy in 0..self.grid_height {
            let row_y = (gy as f32/(self.grid_height-1).max(1) as f32-0.5)*size;
            // 影响带列边界（保守外扩 2 格；格内仍用原判据精确裁决，浮点边界不受影响）
            let span = half_width(row_y) + bank + terrace;
            let gx_lo = ((((center(row_y)-span)/size+0.5)*(self.grid_width-1).max(1) as f32).floor() as isize - 3).max(0) as usize;
            let gx_hi = ((((center(row_y)+span)/size+0.5)*(self.grid_width-1).max(1) as f32).ceil() as isize + 3)
                .min((self.grid_width-1) as isize).max(gx_lo as isize) as usize;
            for gx in gx_lo..=gx_hi {
                let p = self.grid_pos(gx, gy);
                let (d, _, _) = geom.distance(p);
                let w = half_width(p.y);
                let outside = (d-w).max(0.0);
                // ★ 水系影响带之外：严格保持陆地区域基础生成结果，一格不写
                //（判据与旧 surface_kind else-if 链的补集逐比特同界）。
                if outside >= bank+terrace { continue; }
                let c=&mut self.cells[gy*self.grid_width+gx];
                // 河面/河岸覆盖高程；河阶高程与陆地基底公式逐比特同值
                //（山脊项在带内恒为 +0.0），故只覆盖地表/归属/flags。
                if d < w {
                    c.elevation = level-1.4 + p.y/size*0.3;
                    c.surface_kind = SurfaceKind::DeepWater;
                    c.water_body_id = Some(1);
                    c.feature_flags = TERRAIN_FLAG_NO_BUILD|TERRAIN_FLAG_NO_WALK;
                } else if outside < bank {
                    c.elevation = level + 0.4 + outside/bank*1.6;
                    c.surface_kind = SurfaceKind::RiverBank;
                    c.water_body_id = None;
                    c.feature_flags = TERRAIN_FLAG_NO_BUILD|TERRAIN_FLAG_SHORE_ACCESS;
                } else {
                    c.surface_kind = SurfaceKind::RiverTerrace;
                    c.water_body_id = None;
                    c.feature_flags = 0;
                }
                c.natural_fertility = if outside < bank+terrace {0.95} else {0.75};
            }
        }
        // 授权走廊：两端超出保守栅格岸线，普通道路只能接到陆地端点。
        let margin = size/(self.grid_width-1).max(1) as f32*2.0;
        for (i,y) in [-size*0.24,size*0.24].into_iter().enumerate() {
            let cp = geom.point_at_y(y);
            let (_, s, _) = geom.distance(cp);
            let ahead = geom.centerline.sample((s + 1.0).min(geom.centerline.total));
            let mut tx = ahead.x - cp.x; let mut ty = ahead.y - cp.y;
            let tl = (tx*tx + ty*ty).sqrt().max(f32::EPSILON); tx /= tl; ty /= tl;
            let nx = -ty; let ny = tx;
            let reach = half_width(y)+bank+margin;
            let mut a = Vec3::new(cp.x-nx*reach, cp.y-ny*reach,0.0);
            let mut b = Vec3::new(cp.x+nx*reach, cp.y+ny*reach,0.0);
            a.z=self.sample_elevation(a.x,a.y); b.z=self.sample_elevation(b.x,b.y);
            let crossing = TerrainConnection {id:i as u32+1,start:a,end:b,width:cfg.terrain_crossing_width.max(12.0),node_a:None,node_b:None};
            for gy in 0..self.grid_height { for gx in 0..self.grid_width {
                let p=self.grid_pos(gx,gy);
                if ((p.x-cp.x)*tx + (p.y-cp.y)*ty).abs() <= crossing.width*0.5 && self.cells[gy*self.grid_width+gx].water_body_id.is_some() {
                    let c=&mut self.cells[gy*self.grid_width+gx];
                    c.surface_kind=SurfaceKind::ShallowWater; c.elevation=level-0.25;
                    c.feature_flags=TERRAIN_FLAG_NO_BUILD|TERRAIN_FLAG_CROSSING_CANDIDATE;
                }
            }}
            self.features.push(TerrainFeature{id:10+i as u32,kind:TerrainFeatureKind::ShallowFord,vertices:vec![a,b],elevation:level,width:crossing.width,flags:0});
            self.hydrology.connections.push(crossing);
        }
        let mut left=Vec::new(); let mut right=Vec::new();
        for i in 0..=192 {
            let s = geom.centerline.total * i as f32 / 192.0;
            let p = geom.centerline.sample(s);
            let q = geom.centerline.sample((s + 1.0).min(geom.centerline.total));
            let mut tx=q.x-p.x; let mut ty=q.y-p.y;
            let tl=(tx*tx+ty*ty).sqrt().max(f32::EPSILON); tx/=tl; ty/=tl;
            let w=geom.half_width(p.y,size);
            left.push(Vec3::new(p.x-ty*w,p.y+tx*w,level));
            right.push(Vec3::new(p.x+ty*w,p.y-tx*w,level));
        }
        let mut outline=left.clone(); outline.extend(right.iter().rev().copied());
        self.hydrology.water_bodies.push(WaterBody{id:1,level,flow_direction:Vec3::new(0.0,-1.0,0.0),resource_pool_id:1,vertices:outline.clone()});
        self.features.push(TerrainFeature{id:1,kind:TerrainFeatureKind::River,vertices:outline,elevation:level,width,flags:0});
        for (i,vertices) in [left,right].into_iter().enumerate() {
            self.features.push(TerrainFeature{id:20+i as u32,kind:TerrainFeatureKind::RiverBank,vertices,elevation:level,width:bank,flags:0});
        }
        let n=cfg.count_water_sources;
        for i in 0..n {
            let s = geom.centerline.total * (i as f32 + 1.0) / (n as f32 + 1.0);
            let c = geom.centerline.sample(s);
            let q = geom.centerline.sample((s + 1.0).min(geom.centerline.total));
            let mut tx=q.x-c.x; let mut ty=q.y-c.y;
            let tl=(tx*tx+ty*ty).sqrt().max(f32::EPSILON); tx/=tl; ty/=tl;
            let side_sign=if i%2==0 {-1.0} else {1.0};
            let x=c.x-ty*side_sign*(geom.half_width(c.y,size)+bank+margin);
            let y=c.y+tx*side_sign*(geom.half_width(c.y,size)+bank+margin);
            let p=Vec3::new(x,y,self.sample_elevation(x,y));
            self.hydrology.access_points.push(WaterAccessPoint{id:i as u32+1,water_body_id:1,resource_pool_id:1,pos:p,nearest_node_id:None,interaction_radius:cfg.poi_interaction_radius});
        }
    }

    /// 对有效格索引读取当前高程的四邻域差分，不读缓存坡度、不修改地表。
    /// 子特征局部试算与全图定稿必须共用此判据，保留既有运算次序与
    /// 步长口径（生产为方形网格，两轴沿用 grid_width），边缘使用单侧差分。
    #[inline]
    pub(crate) fn slope_from_elevation(&self, x: usize, y: usize) -> f32 {
        let step = self.world_size / (self.grid_width - 1).max(1) as f32;
        let (l, r, u, d) = (
            x.saturating_sub(1),
            (x + 1).min(self.grid_width - 1),
            y.saturating_sub(1),
            (y + 1).min(self.grid_height - 1),
        );
        let dx = (self.cells[y * self.grid_width + r].elevation
            - self.cells[y * self.grid_width + l].elevation)
            / ((r - l).max(1) as f32 * step);
        let dy = (self.cells[d * self.grid_width + x].elevation
            - self.cells[u * self.grid_width + x].elevation)
            / ((d - u).max(1) as f32 * step);
        (dx * dx + dy * dy).sqrt().atan().to_degrees()
    }

    pub fn recompute_slopes(&mut self) {
        for y in 0..self.grid_height {
            for x in 0..self.grid_width {
                // 此循环只写 slope，不写 elevation，无需复制全图高程。
                let slope = self.slope_from_elevation(x, y);
                self.cells[y * self.grid_width + x].slope_angle_deg = slope;
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// ★ 阶段三 D-B2 · RiverCliff 河谷峭壁注入器（06 号 §5.4.D · v1.52.6）
//
// 结构型子特征：改变高程 + 岩壁地表（`RockFace` 覆盖意图 → 第 6 步物化
// `NO_WALK|NO_BUILD`）+ `Cliff` 特征（id=224）。全部判定走无状态 `mix64`
// 哈希，**不消费任何 WorldRng**；几何施加在第 5 步整图事务域内进行
// （`geometry_transaction.rs`），任一局部判定失败整块回滚、判为未注入、不重抽。
//
// 与 §5.4.D 规格的两处实现口径（以实现为准，均为规格兼容的收紧）：
// 1. 崖基线锚定在**河阶带外缘 +6m**（规格「崖顶距河中心 > half+bank+8」的
//    加大版）：河岸/河阶属水系优先地表（§5.3 第 6 步），`RockFace` 不得覆盖
//    （覆盖会留下「可通行的陡峭河阶」或触发 `CellWaterFlagMismatch`），
//    崖面整体落在河阶带外侧的 `DryGround` 陆地格上才能稳定派生硬禁行；
// 2. 沿程两端加 6m 连续 taper（§5.4.D.6「沿程两端回落连续」）。
// ═══════════════════════════════════════════════════════════════════════

/// 崖面带宽（across 方向；§5.4.D.2 候选值 18m，离散尺度探针准入后冻结）。
const CLIFF_WIDTH_M: f32 = 18.0;
/// 崖面全高起点比例：across ≥ RATIO×WIDTH 后达到全高 H。0.25 = 规格候选初值
///（抬升带 4.5m ≈ 1.5 格；离散中心差分窗口 2Δ≈6m 可完整覆盖抬升带，格点坡度最陡）。
const CLIFF_RISE_RATIO: f32 = 0.25;
/// 崖顶外侧回落平滑带宽度（§5.4.D.2「边缘再用 12m 平滑带衔接」）。
const CLIFF_SMOOTH_M: f32 = 12.0;
/// 沿程两端连续 taper（保证崖端高程连续，§5.4.D.6）。
const CLIFF_TAPER_M: f32 = 6.0;
/// 选址裕量：支撑域距地图边界的最小距离（与 OxbowLake 的 40m 口径一致）。
const CLIFF_EDGE_MARGIN_M: f32 = 40.0;
/// 崖基线在河阶带外缘之外的最小逐点净距（选址校验）。
const CLIFF_TERRACE_CLEARANCE_M: f32 = 4.0;
/// 浅滩授权走廊保护带：走廊半宽之外再退 20m。
const CLIFF_FORD_MARGIN_M: f32 = 20.0;
/// 硬禁行连续带验收下限（目标长度的 70%，§5.4.D.3/§5.4.D.7）。
const CLIFF_BAND_MIN_RATIO: f32 = 0.7;
/// 硬禁行阈值（与第 6 步地表派生一致：slope ≥ 34° → `SurfaceKind::RockFace`）。
const CLIFF_ROCKFACE_SLOPE_DEG: f32 = 34.0;

/// 峭壁抬升主值（纯函数，供第 5 步注入与离散尺度探针共用）。
/// `along`：沿崖切向坐标（崖段中点为原点）；`across`：自崖基线向崖侧的法向距离。
/// 剖面 = 沿程 taper（±len/2 之外 6m 连续回落）× 横向剖面（0→rise_w smoothstep
/// 升至全高 H → 平台至 width → width→width+smooth 12m 平滑回落到 0）。
pub(crate) fn river_cliff_lift(along: f32, across: f32, len: f32, h: f32) -> f32 {
    if across <= 0.0 || h <= 0.0 {
        return 0.0;
    }
    let half_len = len * 0.5;
    let a_env = if along.abs() <= half_len {
        1.0
    } else if along.abs() >= half_len + CLIFF_TAPER_M {
        0.0
    } else {
        let t = (half_len + CLIFF_TAPER_M - along.abs()) / CLIFF_TAPER_M;
        t * t * (3.0 - 2.0 * t)
    };
    if a_env <= 0.0 {
        return 0.0;
    }
    let rise_w = CLIFF_RISE_RATIO * CLIFF_WIDTH_M;
    let outer = CLIFF_WIDTH_M + CLIFF_SMOOTH_M;
    if across >= outer {
        return 0.0;
    }
    let s = if across <= rise_w {
        let t = across / rise_w;
        t * t * (3.0 - 2.0 * t)
    } else if across <= CLIFF_WIDTH_M {
        1.0
    } else {
        let t = (outer - across) / CLIFF_SMOOTH_M;
        t * t * (3.0 - 2.0 * t)
    };
    h * s * a_env
}

/// §5.4.D `RiverCliff`（仅 T2，不产生水体）。由第 5 步 `geometry_transaction`
/// 调用：`baseline` 为未注入原图（只读），`candidate`/`scratch` 为事务候选。
/// **只允许**修改 candidate 高程、追加特征/子特征、登记 scratch 覆盖意图——
/// slope/flags 由第 6 步唯一物化（事务断言「提前写地表」会拒绝任何越界写入）。
/// 返回 `Ok(false)` = 未注入（不重抽其他特征）；`Err` = 局部拒绝（整块回滚）。
pub(super) fn apply_river_cliff(
    baseline: &TerrainMap,
    candidate: &mut TerrainMap,
    scratch: &mut GenesisScratch,
    plan: &mut PlannedSubFeature,
) -> Result<bool, &'static str> {
    if baseline.profile != TERRAIN_PROFILE_RIVER_VALLEY {
        return Ok(false);
    }
    let Some(geom) = scratch.river_geometry.as_ref() else {
        return Ok(false);
    };
    let size = candidate.world_size;
    let gw = candidate.grid_width;
    let seed = baseline.seed;
    let step_cell = size / (candidate.grid_width - 1).max(1) as f32;

    // ── 确定性参数（无状态哈希；绝不消费 WorldRng，§5.3 契约）──
    let h_len = mix64(seed ^ plan.salt ^ 0x5243_4C46_5F4C_454E); // "RCLF_LEN"
    let h_height = mix64(seed ^ plan.salt ^ 0x5243_4C46_5F48_4549); // "RCLF_HEI"
    let h_side = mix64(seed ^ plan.salt ^ 0x5243_4C46_5F53_4944); // "RCLF_SID"
    let h_scan = mix64(seed ^ plan.salt ^ 0x5243_4C46_5F53_4341); // "RCLF_SCA"
    let len = 55.0 + (h_len % 1000) as f32 * 0.025; // 55 ~ 79.975m（§5.4.D.1）
    let cliff_h = 6.0 + (h_height % 1000) as f32 * 0.006; // 6 ~ 11.994m（hash 固定）
    let side = if h_side & 1 == 0 { 1.0f32 } else { -1.0f32 };

    // ── 选址扫描：沿主河 y 轴等距槽位，起点由 hash 决定并环绕（同种子恒同序）──
    let y_margin = CLIFF_EDGE_MARGIN_M + len * 0.5 + CLIFF_TAPER_M;
    let y_lo = -size * 0.5 + y_margin;
    let y_hi = size * 0.5 - y_margin;
    if y_hi <= y_lo {
        return Ok(false);
    }
    let slot = 8.0f32;
    let n_slots = ((y_hi - y_lo) / slot) as usize;
    if n_slots == 0 {
        return Ok(false);
    }
    let jitter = (h_scan % 1000) as f32 * 0.001 * slot;
    let start = ((h_scan >> 20) as usize) % (n_slots + 1);
    // 浅滩授权走廊保护数据（读 baseline；T2 恒有 2 条，宽度取最大值口径）
    let ford_half = baseline
        .hydrology
        .connections
        .iter()
        .map(|c| c.width)
        .fold(0.0f32, f32::max)
        * 0.5;
    let ford_ys = [-size * 0.24, size * 0.24];

    // 选址通过后锚点局部系：t = 河流切向（单位），n = 指向崖侧的外法向（单位），
    // A = 崖基线中点（基线 = 河中心沿 n 平移 base_dist）。
    let mut chosen: Option<(f32, f32, f32, f32, f32)> = None; // (ax, ay, tx, ty, nx)
    for i in 0..=n_slots {
        let k = (start + i) % (n_slots + 1);
        let y0 = y_lo + jitter + k as f32 * slot;
        if y0 > y_hi {
            continue;
        }
        // 段 y 区间不与浅滩走廊重叠（走廊半宽 + 20m，16 等分逐点校验）
        let mut ok = true;
        let mut max_hw = 0.0f32;
        for j in 0..=16u32 {
            let y = y0 - len * 0.5 + len * j as f32 / 16.0;
            max_hw = max_hw.max(geom.half_width(y, size));
            if ford_ys.iter().any(|fy| (y - fy).abs() < ford_half + CLIFF_FORD_MARGIN_M) {
                ok = false;
                break;
            }
        }
        if !ok {
            continue;
        }
        // 崖基线距离：段内最大半宽 + bank + terrace + 6（河阶带外缘外 6m，见模块注释）
        let base_dist = max_hw + geom.bank + geom.terrace + 6.0;
        let cp = geom.point_at_y(y0);
        let cs = geom.centerline.s_at_y(y0);
        let prev = geom.centerline.sample((cs - 1.0).max(0.0));
        let next = geom.centerline.sample((cs + 1.0).min(geom.centerline.total));
        let mut tx = next.x - prev.x; let mut ty = next.y - prev.y;
        let tlen = (tx * tx + ty * ty).sqrt().max(f32::EPSILON);
        tx /= tlen; ty /= tlen;
        let (nx, ny) = (side * -ty, side * tx);
        let ax = cp.x + nx * base_dist;
        let ay = cp.y + ny * base_dist;
        // 崖基线逐点净距 ≥ 河阶带外缘 + CLEARANCE（防河湾凸岸贴上崖脚）
        let mut min_clear = f32::INFINITY;
        let mut in_bounds = true;
        for j in 0..=16u32 {
            let s = -len * 0.5 + len * j as f32 / 16.0;
            let px = ax + tx * s;
            let py = ay + ty * s;
            if px.abs() > size * 0.5 - CLIFF_EDGE_MARGIN_M {
                in_bounds = false;
                break;
            }
            let (_, _, lateral) = geom.distance(Vec3::new(px, py, 0.0));
            let signed = lateral * side;
            min_clear = min_clear.min(signed - (geom.half_width(py, size) + geom.bank + geom.terrace));
        }
        if !in_bounds || min_clear < CLIFF_TERRACE_CLEARANCE_M {
            continue;
        }
        // 支撑域 AABB（along × across 外矩形 4 角），用于取水点圆相交判定
        let outer = CLIFF_WIDTH_M + CLIFF_SMOOTH_M;
        let half_ext = len * 0.5 + CLIFF_TAPER_M;
        let (mut bmin_x, mut bmax_x, mut bmin_y, mut bmax_y) =
            (f32::INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::NEG_INFINITY);
        for (s, a) in [
            (-half_ext, 0.0),
            (half_ext, 0.0),
            (-half_ext, outer),
            (half_ext, outer),
        ] {
            let px = ax + tx * s + nx * a;
            let py = ay + ty * s + ny * a;
            bmin_x = bmin_x.min(px);
            bmax_x = bmax_x.max(px);
            bmin_y = bmin_y.min(py);
            bmax_y = bmax_y.max(py);
        }
        // §5.4.D.5 几何类：崖体 AABB 不得与任一 WaterAccessPoint 的
        // interaction_radius 圆相交（违反即跳过该槽位）。
        if baseline.hydrology.access_points.iter().any(|ap| {
            let qx = ap.pos.x.clamp(bmin_x, bmax_x) - ap.pos.x;
            let qy = ap.pos.y.clamp(bmin_y, bmax_y) - ap.pos.y;
            qx * qx + qy * qy < ap.interaction_radius * ap.interaction_radius
        }) {
            continue;
        }
        chosen = Some((ax, ay, tx, ty, nx));
        // ny 由 (tx, side) 唯一重构：n = (side·ty, −side·tx)，nx = side·ty 已存，
        // ny = −side·tx 在 apply 段还原。
        break;
    }
    let Some((ax, ay, tx, ty, nx)) = chosen else {
        return Ok(false);
    };
    let ny = -side * tx;

    // ── 崖面高程施加（只写 candidate 高程；支撑域 AABB 内逐格）──
    let outer = CLIFF_WIDTH_M + CLIFF_SMOOTH_M;
    let half_ext = len * 0.5 + CLIFF_TAPER_M;
    let (mut bmin_x, mut bmax_x, mut bmin_y, mut bmax_y) =
        (f32::INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::NEG_INFINITY);
    for (s, a) in [
        (-half_ext, 0.0),
        (half_ext, 0.0),
        (-half_ext, outer),
        (half_ext, outer),
    ] {
        let px = ax + tx * s + nx * a;
        let py = ay + ty * s + ny * a;
        bmin_x = bmin_x.min(px);
        bmax_x = bmax_x.max(px);
        bmin_y = bmin_y.min(py);
        bmax_y = bmax_y.max(py);
    }
    let gx_lo = (((bmin_x / size + 0.5) * (gw - 1).max(1) as f32).floor() as isize - 2)
        .clamp(0, (gw - 1) as isize) as usize;
    let gx_hi = (((bmax_x / size + 0.5) * (gw - 1).max(1) as f32).ceil() as isize + 2)
        .clamp(0, (gw - 1) as isize) as usize;
    let gy_lo = (((bmin_y / size + 0.5) * (candidate.grid_height - 1).max(1) as f32).floor() as isize - 2)
        .clamp(0, (candidate.grid_height - 1) as isize) as usize;
    let gy_hi = (((bmax_y / size + 0.5) * (candidate.grid_height - 1).max(1) as f32).ceil() as isize + 2)
        .clamp(0, (candidate.grid_height - 1) as isize) as usize;
    let mut modified: Vec<(usize, f32)> = Vec::new(); // (cell_index, across)
    let (mut z_min, mut z_max) = (f32::INFINITY, f32::NEG_INFINITY);
    for gy in gy_lo..=gy_hi {
        for gx in gx_lo..=gx_hi {
            let p = candidate.grid_pos(gx, gy);
            let dx = p.x - ax;
            let dy = p.y - ay;
            let across = dx * nx + dy * ny;
            if across <= 0.0 {
                continue;
            }
            let along = dx * tx + dy * ty;
            let lift = river_cliff_lift(along, across, len, cliff_h);
            if lift <= 0.0 {
                continue;
            }
            let idx = gy * gw + gx;
            let cell = &mut candidate.cells[idx];
            // 安全网：水系格 / 非干地格不施加（选址已保证段内全在河阶带外）。
            if cell.water_body_id.is_some()
                || !matches!(cell.surface_kind, SurfaceKind::DryGround | SurfaceKind::SoftGround)
            {
                continue;
            }
            cell.elevation += lift;
            z_min = z_min.min(cell.elevation);
            z_max = z_max.max(cell.elevation);
            modified.push((idx, across));
        }
    }
    if modified.is_empty() {
        return Ok(false);
    }

    // ── 5c/5d 局部判定（临时坡度；判据与第 6 步全图定稿同源：slope_from_elevation）──
    // 覆盖意图规则：**支撑域全部 modified 格整体登记 RockFace**（崖体 18m + 外侧
    // 回落带 12m）。不能按坡度/18m 阈值离散切分：崖顶平台坡度 ≈ 基底（<34°），
    // 只按坡度登记会产生被崖面与外侧陡带夹住的「可走口袋」（探针实测 89~129 格
    // 孤立分量）；而只挡崖体又会让 18~30m 回落带里的离散陡格与崖体锯齿边界把
    // 可走缝隙掐断成 1 格宽小口袋（探针实测 2~8 格 × 多个）。整域登记后崖体 +
    // 坡脚碎石带为一条实心禁行带，与主河之间始终隔着连续河阶缓带，两翼开口，
    // 连通分量恒不增加；崖顶/碎石带本就不可步行，语义一致。
    let mut overlay_idx: Vec<usize> = Vec::with_capacity(modified.len());
    for &(idx, _) in &modified {
        overlay_idx.push(idx);
    }
    // 硬禁行连续带 ≥ 70% 目标长度：沿崖面中线（across = 抬升带中点）按 ≤Δ/2 采样，
    // 记录实际格点派生坡度 ≥34° 的最长连续覆盖（§5.4.D.3/7）。
    let rise_w = CLIFF_RISE_RATIO * CLIFF_WIDTH_M;
    let sample_across = rise_w * 0.5;
    let n_steps = ((len / (step_cell * 0.5)).ceil() as usize).max(2);
    let step_len = len / n_steps as f32;
    let (mut run, mut best_run) = (0.0f32, 0.0f32);
    for i in 0..=n_steps {
        let s = -len * 0.5 + len * i as f32 / n_steps as f32;
        let px = ax + tx * s + nx * sample_across;
        let py = ay + ty * s + ny * sample_across;
        let (gx, gy) = candidate.grid_index(px, py);
        if candidate.slope_from_elevation(gx, gy) >= CLIFF_ROCKFACE_SLOPE_DEG {
            run += step_len;
            best_run = best_run.max(run);
        } else {
            run = 0.0;
        }
    }
    if best_run < len * CLIFF_BAND_MIN_RATIO {
        // 几何类局部拒绝：整块回滚、判为未注入、不重抽其他特征（§5.3 两层分工）。
        return Ok(false);
    }
    // 连通分量不增加（§5.3「不得切断既有生存链路」①）：未注入原图与注入候选
    // 各自独立统计可行走连通分量（blocked = NO_WALK ∪ 本次 RockFace 意图）。
    let mut added_block = vec![false; candidate.cells.len()];
    for &idx in &overlay_idx {
        added_block[idx] = true;
    }
    let base_comps = count_walkable_components(baseline, &[]);
    let cand_comps = count_walkable_components(candidate, &added_block);
    if cand_comps > base_comps {
        return Ok(false);
    }
    // 登记覆盖意图：第 6 步物化 RockFace，is_hard_blocked 自动补 NO_WALK|NO_BUILD；
    // 肥力回写原值（不改变既有肥力事实）。
    for &idx in &overlay_idx {
        scratch.surface_overlays.push(super::geometry_transaction::SurfaceOverlay {
            cell_index: idx,
            surface_kind: SurfaceKind::RockFace,
            water_body_id: None,
            natural_fertility: candidate.cells[idx].natural_fertility,
            flags: 0,
        });
    }

    // ── Cliff 特征（id=224 = 200 + kind_code(6)×4 + 0，§5.2 ID 表）与子特征登记 ──
    // 崖顶折线 = 全高平台中线（across = rise_w + (width−rise_w)/2）9 点采样。
    let top_across = rise_w + (CLIFF_WIDTH_M - rise_w) * 0.5;
    let mut verts = Vec::with_capacity(9);
    for i in 0..9u32 {
        let s = -len * 0.5 + len * i as f32 / 8.0;
        let px = ax + tx * s + nx * top_across;
        let py = ay + ty * s + ny * top_across;
        let z = candidate.sample_elevation(px, py);
        verts.push(Vec3::new(px, py, z));
    }
    candidate.features.push(TerrainFeature {
        id: 224,
        kind: TerrainFeatureKind::Cliff,
        elevation: verts[4].z,
        vertices: verts.clone(),
        width: CLIFF_WIDTH_M,
        flags: 0,
    });
    candidate.sub_features.push(TerrainSubFeature {
        id: 1000 + TerrainSubFeatureKind::RiverCliff as u32,
        kind: TerrainSubFeatureKind::RiverCliff,
        anchor: verts[4],
        bounds_min: Vec3::new(bmin_x, bmin_y, z_min),
        bounds_max: Vec3::new(bmax_x, bmax_y, z_max),
        feature_ids: vec![224],
        accent_id_start: None,
        accent_id_end: None,
    });
    plan.anchor_hint = verts[4];
    Ok(true)
}

/// 可行走连通分量统计（4 邻域；blocked = NO_WALK 标志 ∪ 调用方追加的意图格）。
/// 供 RiverCliff 5d 判定「注入后连通分量数不增加」（§5.3）；纯只读。
fn count_walkable_components(map: &TerrainMap, extra_block: &[bool]) -> u32 {
    let gw = map.grid_width;
    let gh = map.grid_height;
    let n = gw * gh;
    let mut visited = vec![false; n];
    let mut stack: Vec<usize> = Vec::with_capacity(256);
    let mut comps = 0u32;
    for start in 0..n {
        if visited[start] {
            continue;
        }
        visited[start] = true;
        let blocked = map.cells[start].feature_flags & TERRAIN_FLAG_NO_WALK != 0
            || extra_block.get(start).copied().unwrap_or(false);
        if blocked {
            continue;
        }
        comps += 1;
        stack.clear();
        stack.push(start);
        while let Some(i) = stack.pop() {
            let x = i % gw;
            for nidx in
                [(x > 0).then(|| i - 1), (x + 1 < gw).then(|| i + 1),
                 (i >= gw).then(|| i - gw), (i + gw < gh * gw).then(|| i + gw)]
            {
                let Some(nidx) = nidx else { continue };
                if !visited[nidx] {
                    visited[nidx] = true;
                    let blocked = map.cells[nidx].feature_flags & TERRAIN_FLAG_NO_WALK != 0
                        || extra_block.get(nidx).copied().unwrap_or(false);
                    if !blocked {
                        stack.push(nidx);
                    }
                }
            }
        }
    }
    comps
}
