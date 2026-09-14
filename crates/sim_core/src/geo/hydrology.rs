//! 静态河谷几何。水量由 World 的共享池维护，几何不随库存变化。
use serde::{Deserialize, Serialize};
use crate::{config::SimConfig, rng::WorldRng, spatial::vec3::Vec3};
use super::{biome::*, terrain::*};

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
}

impl RiverGeometry {
    /// 主河中心线：正弦蜿蜒，完全静态（水量由共享池维护，几何不随库存变化）。
    #[inline]
    pub fn center(&self, y: f32, size: f32) -> f32 {
        size * 0.055 * (y / size * 5.0 + self.phase).sin()
    }
    /// 河道半宽：基准半宽 + 波动振幅。
    #[inline]
    pub fn half_width(&self, y: f32, size: f32) -> f32 {
        self.width * 0.5 + self.width_amp * (y / size * 7.0).cos()
    }
}

/// 规划 T2 主河几何（§5.3 第 3 步 `apply_profile_static_hydrology` 的参数解析前身）。
/// `pub(super)`：★ STAGE2-3 编排器（`terrain.rs::generate_with_config`）在第 2 步前
/// 调用并写入流水线 scratch，第 2 步铺河谷低丘与第 3 步施加水面共用同一份几何。
pub(super) fn plan_river_geometry(seed: u64, cfg: &SimConfig) -> RiverGeometry {
    let mut rng = WorldRng::new(seed ^ 0x4859_4452_4f54_3032);
    let phase = rng.gen_range(-1.0, 1.0);
    RiverGeometry {
        phase,
        level: cfg.terrain_river_water_level,
        width: ((cfg.terrain_river_width_min + cfg.terrain_river_width_max) * 0.5).max(12.0),
        bank: cfg.terrain_river_bank_width.max(8.0),
        terrace: cfg.terrain_river_terrace_width.max(20.0),
        width_amp: (cfg.terrain_river_width_max - cfg.terrain_river_width_min).max(0.0) * 0.22,
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
        // ★ S7-07 河谷聚落主河：谷轴即河轴（`ValleyGeometry::center_x` 承载微幅
        //   蜿蜒），河宽/岸带/河阶形态参数（SimConfig）随谷地几何移交；写入同样严格收敛在
        //   河道影响带（06 号 §4.3 约束④「不得向两侧山壁外溢」）。
        if let Some(vg) = scratch.valley_geometry.as_ref() {
            self.generate_settlement_river(vg, config);
        }
        // ★ TB-03 静水（盆地泉池 / 湖畔大湖）：`WaterBody` 特征 #1 + 水体 #1 + 岸点
        //   独立于主河逻辑、零流向静水语义、connections 为空。
        if let Some(bg) = scratch.basin_geometry.as_ref() {
            if let Some(plan) = bg.water.as_ref() {
                super::static_water::apply_static_water(
                    self,
                    plan,
                    config,
                    |wx, wy| bg.pool_bed_elevation(wx, wy),
                );
            }
        }
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
            let row_cx = center(row_y);
            let gx_lo = ((((row_cx-span)/size+0.5)*(self.grid_width-1).max(1) as f32).floor() as isize - 2).max(0) as usize;
            let gx_hi = ((((row_cx+span)/size+0.5)*(self.grid_width-1).max(1) as f32).ceil() as isize + 2)
                .min((self.grid_width-1) as isize).max(gx_lo as isize) as usize;
            for gx in gx_lo..=gx_hi {
                let p = self.grid_pos(gx, gy);
                let d = (p.x-center(p.y)).abs();
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
            let reach = half_width(y)+bank+margin;
            let mut a = Vec3::new(center(y)-reach,y,0.0);
            let mut b = Vec3::new(center(y)+reach,y,0.0);
            a.z=self.sample_elevation(a.x,a.y); b.z=self.sample_elevation(b.x,b.y);
            let crossing = TerrainConnection {id:i as u32+1,start:a,end:b,width:cfg.terrain_crossing_width.max(12.0),node_a:None,node_b:None};
            for gy in 0..self.grid_height { for gx in 0..self.grid_width {
                let p=self.grid_pos(gx,gy);
                if (p.y-y).abs() <= crossing.width*0.5 && self.cells[gy*self.grid_width+gx].water_body_id.is_some() {
                    let c=&mut self.cells[gy*self.grid_width+gx];
                    c.surface_kind=SurfaceKind::ShallowWater; c.elevation=level-0.25;
                    c.feature_flags=TERRAIN_FLAG_NO_BUILD|TERRAIN_FLAG_CROSSING_CANDIDATE;
                }
            }}
            self.features.push(TerrainFeature{id:10+i as u32,kind:TerrainFeatureKind::ShallowFord,vertices:vec![a,b],elevation:level,width:crossing.width,flags:0});
            self.hydrology.connections.push(crossing);
        }
        let mut left=Vec::new(); let mut right=Vec::new();
        for i in 0..=96 {
            let y=(i as f32/96.0-0.5)*size;
            left.push(Vec3::new(center(y)-half_width(y),y,level));
            right.push(Vec3::new(center(y)+half_width(y),y,level));
        }
        let mut outline=left.clone(); outline.extend(right.iter().rev().copied());
        self.hydrology.water_bodies.push(WaterBody{id:1,level,flow_direction:Vec3::new(0.0,-1.0,0.0),resource_pool_id:1,vertices:outline.clone()});
        self.features.push(TerrainFeature{id:1,kind:TerrainFeatureKind::River,vertices:outline,elevation:level,width,flags:0});
        for (i,vertices) in [left,right].into_iter().enumerate() {
            self.features.push(TerrainFeature{id:20+i as u32,kind:TerrainFeatureKind::RiverBank,vertices,elevation:level,width:bank,flags:0});
        }
        let n=cfg.count_water_sources;
        for i in 0..n {
            let side=if i%2==0 {-1.0} else {1.0};
            let y=((i/2+1) as f32/((n+1)/2+1) as f32-0.5)*size*0.85;
            let x=center(y)+side*(half_width(y)+bank+margin);
            let p=Vec3::new(x,y,self.sample_elevation(x,y));
            self.hydrology.access_points.push(WaterAccessPoint{id:i as u32+1,water_body_id:1,resource_pool_id:1,pos:p,nearest_node_id:None,interaction_radius:cfg.poi_interaction_radius});
        }
        // 泉谷为通向主河的浅沟，不产生第二份水库存。
        let y=size*0.34; let x=center(y);
        let spring=vec![Vec3::new(x-terrace-bank,y+25.0,level+3.0),Vec3::new(x-bank,y+8.0,level+1.0),Vec3::new(x,y,level)];
        self.features.push(TerrainFeature{id:30,kind:TerrainFeatureKind::SpringValley,vertices:spring,elevation:level,width:4.0,flags:0});
    }

    /// ★ S7-07 河谷聚落主河水系写入（T2 `generate_river` 的谷轴镜像版）。
    ///
    /// 陆地（冲积谷底/陡壁/台地）已由 `terrain.rs::generate_base_relief` 铺满全图，
    /// 本函数**只写**横向距离落在河道影响带内（`d < river_half + bank + terrace`
    /// ≤ 16+8+20 = 44m ≪ 谷底半宽 ≥80m）的局部网格：河面、河岸、河阶三种地表
    /// 覆盖 + 浅滩走廊、轮廓特征与两岸取水点，带外一格不碰（06 号 §4.3 约束④
    /// 「水系写入不得向两侧山壁外溢」）。河道中心线 = 谷轴
    /// `ValleyGeometry::center_x`（微幅弯曲由谷轴蜿蜒承载、半宽恒定）；水面高程
    /// `terrain_river_water_level` 与走廊宽度 `terrain_crossing_width` 与 T2 同源
    /// （SimConfig）。坡度定稿归流水线第 6 步；本函数不自行重算坡度。
    fn generate_settlement_river(&mut self, vg: &super::terrain::ValleyGeometry, cfg: &SimConfig) {
        let size = self.world_size;
        let level = cfg.terrain_river_water_level;
        // ★ S7-08：岸带/河阶/浅滩位置/取水点偏移全部走 SimConfig（默认值 = 参数化前
        //   的 terrain.rs 形态常数，输出逐位不变；字段 doc 注释载明保护线约束）。
        let bank = cfg.terrain_valley_river_bank_m.max(0.0);
        let terrace = cfg.terrain_valley_river_terrace_m.max(0.0);
        let ford_ratio = cfg.terrain_valley_ford_ratio;
        let access_offset_min = cfg.terrain_valley_access_offset_min_m.max(0.0);
        let half = vg.river_half_m;
        let center = |y: f32| vg.center_x(y, size);
        for gy in 0..self.grid_height {
            let row_y = (gy as f32/(self.grid_height-1).max(1) as f32-0.5)*size;
            // 影响带列边界（保守外扩 2 格；格内仍用原判据精确裁决，与 T2 同式）
            let span = half + bank + terrace;
            let row_cx = center(row_y);
            let gx_lo = ((((row_cx-span)/size+0.5)*(self.grid_width-1).max(1) as f32).floor() as isize - 2).max(0) as usize;
            let gx_hi = ((((row_cx+span)/size+0.5)*(self.grid_width-1).max(1) as f32).ceil() as isize + 2)
                .min((self.grid_width-1) as isize).max(gx_lo as isize) as usize;
            for gx in gx_lo..=gx_hi {
                let p = self.grid_pos(gx, gy);
                let d = (p.x-center(p.y)).abs();
                let outside = (d-half).max(0.0);
                // ★ 水系影响带之外：严格保持谷地基底生成结果，一格不写。
                if outside >= bank+terrace { continue; }
                let c=&mut self.cells[gy*self.grid_width+gx];
                if d < half {
                    // 单调下凹河床 + 静态水面：河宽 22~32m（规格），河床沿 y 缓降。
                    c.elevation = level-1.4 + p.y/size*0.3;
                    c.surface_kind = SurfaceKind::DeepWater;
                    c.water_body_id = Some(1);
                    c.feature_flags = TERRAIN_FLAG_NO_BUILD|TERRAIN_FLAG_NO_WALK;
                } else if outside < bank {
                    // 低滩禁建带：自水面缓升（T2 同式），派生 `RiverBank`。
                    c.elevation = level + 0.4 + outside/bank*1.6;
                    c.surface_kind = SurfaceKind::RiverBank;
                    c.water_body_id = None;
                    c.feature_flags = TERRAIN_FLAG_NO_BUILD|TERRAIN_FLAG_SHORE_ACCESS;
                } else {
                    // 高肥力河阶：谷底高程（第 2 步写定）不动，只改地表归属。
                    c.surface_kind = SurfaceKind::RiverTerrace;
                    c.water_body_id = None;
                    c.feature_flags = 0;
                }
                c.natural_fertility = 0.95;
            }
        }
        // 授权浅滩走廊：±ford_ratio×world（默认 0.32，S7-08 起走 SimConfig）两处，端点
        // 超出保守栅格岸线，普通道路只能接到陆地端点；带内水面改写
        // `ShallowWater`（过水减速由 `terrain_shallow_water_cost` 在车道 profile
        // 上承载，授权见 `corridor::segment_valid` 的 connection 判据）。
        let margin = size/(self.grid_width-1).max(1) as f32*2.0;
        let crossing_width = cfg.terrain_crossing_width.max(12.0);
        for (i,y) in [-size*ford_ratio,size*ford_ratio].into_iter().enumerate() {
            let reach = half+bank+margin;
            let mut a = Vec3::new(center(y)-reach,y,0.0);
            let mut b = Vec3::new(center(y)+reach,y,0.0);
            a.z=self.sample_elevation(a.x,a.y); b.z=self.sample_elevation(b.x,b.y);
            let crossing = TerrainConnection {id:i as u32+1,start:a,end:b,width:crossing_width,node_a:None,node_b:None};
            for gy in 0..self.grid_height { for gx in 0..self.grid_width {
                let p=self.grid_pos(gx,gy);
                if (p.y-y).abs() <= crossing.width*0.5 && self.cells[gy*self.grid_width+gx].water_body_id.is_some() {
                    let c=&mut self.cells[gy*self.grid_width+gx];
                    c.surface_kind=SurfaceKind::ShallowWater; c.elevation=level-0.25;
                    c.feature_flags=TERRAIN_FLAG_NO_BUILD|TERRAIN_FLAG_CROSSING_CANDIDATE;
                }
            }}
            self.features.push(TerrainFeature{id:10+i as u32,kind:TerrainFeatureKind::ShallowFord,vertices:vec![a,b],elevation:level,width:crossing_width,flags:0});
            self.hydrology.connections.push(crossing);
        }
        let mut left=Vec::new(); let mut right=Vec::new();
        for i in 0..=96 {
            let y=(i as f32/96.0-0.5)*size;
            left.push(Vec3::new(center(y)-half,y,level));
            right.push(Vec3::new(center(y)+half,y,level));
        }
        let mut outline=left.clone(); outline.extend(right.iter().rev().copied());
        self.hydrology.water_bodies.push(WaterBody{id:1,level,flow_direction:Vec3::new(0.0,-1.0,0.0),resource_pool_id:1,vertices:outline.clone()});
        self.features.push(TerrainFeature{id:1,kind:TerrainFeatureKind::River,vertices:outline,elevation:level,width:half*2.0,flags:0});
        for (i,vertices) in [left,right].into_iter().enumerate() {
            self.features.push(TerrainFeature{id:20+i as u32,kind:TerrainFeatureKind::RiverBank,vertices,elevation:level,width:bank,flags:0});
        }
        // 两岸交替取水点：全部挂 `WaterPool #1`（`resource_pool_id = 1`），HUD 水量
        // 去重聚合由 `terrain_network.rs::prepare_terrain_layout` 统一建池。离轴
        // 偏移取 max(河道半宽+岸带+边距, 35m)，保证两岸对置取水点间距 ≥
        // 2×35 = 70m（`poi_min_distance` 口径）。
        let n=cfg.count_water_sources;
        for i in 0..n {
            let side=if i%2==0 {-1.0} else {1.0};
            let y=((i/2+1) as f32/((n+1)/2+1) as f32-0.5)*size*0.85;
            let x=center(y)+side*(half+bank+margin).max(access_offset_min);
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
