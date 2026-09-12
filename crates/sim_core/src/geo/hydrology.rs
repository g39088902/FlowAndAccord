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
impl TerrainMap {
    pub fn generate_with_config(&mut self, seed: u64, config: &SimConfig) {
        self.generate_with_profile(seed, &config.terrain_profile, config);
        self.hydrology = Hydrology::default();
        if self.profile == TERRAIN_PROFILE_RIVER_VALLEY { self.generate_river(seed, config); }
        // ★ D-B1-3（06号 §5.3 第 4–5 步钩子）：子特征注入规划与几何施加。
        // 第 4 步 `plan_subfeatures()` 已由 D-B1-3 落地——纯无状态哈希（mix64/roll_10000
        // + 固定盐值 + kind 升序互斥裁决），**不消费任何 WorldRng**、不读不写 terrain。
        // 第 5 步（几何施加 5a~5d）与第 9 步（专属装饰）仍是空操作，属阶段二/三：
        // 本阶段 `plan` 只被第 9 步空钩子形式化消费，不写任何格子、不改任何地表。
        let sub_plan = plan_subfeatures(seed, &self.profile, config.terrain_accent_sub_features);
        // ★ v1.48.0 D-A：散布地表装饰（在地貌与水系生成完成后，避免装饰落入深水区）
        self.accents = super::accents::generate_accents(self, config.terrain_accent_density, seed);
        // ★ D-B1-3（06号 §5.3 第 9 步钩子）：子特征专属装饰追加（hash 放点、不消费 accent_rng）。
        // 阶段一为空实现——`sub_plan` 仅在此被读取长度以绑定钩子，不产生任何装饰；
        // 阶段二接管后此处按 §5.5 追加 Accent 并回填 `accent_id_start/end`。
        if !sub_plan.is_empty() {
            // 空钩子占位（阶段二接管：append_subfeature_accents）。
        }
    }
    fn generate_river(&mut self, seed: u64, cfg: &SimConfig) {
        let mut rng = WorldRng::new(seed ^ 0x4859_4452_4f54_3032);
        let phase = rng.gen_range(-1.0, 1.0);
        let size = self.world_size;
        let level = cfg.terrain_river_water_level;
        let width = ((cfg.terrain_river_width_min + cfg.terrain_river_width_max)*0.5).max(12.0);
        let bank = cfg.terrain_river_bank_width.max(8.0);
        let terrace = cfg.terrain_river_terrace_width.max(20.0);
        let center = |y: f32| size*0.055*(y/size*5.0+phase).sin();
        let half_width = |y: f32| width*0.5 + (cfg.terrain_river_width_max-cfg.terrain_river_width_min).max(0.0)*0.22*(y/size*7.0).cos();
        self.features.clear();
        for gy in 0..self.grid_height {
            for gx in 0..self.grid_width {
                let p = self.grid_pos(gx, gy);
                let d = (p.x-center(p.y)).abs();
                let w = half_width(p.y);
                let c = &mut self.cells[gy*self.grid_width+gx];
                let outside = (d-w).max(0.0);
                // 单调河床；河阶外衔接低丘，水面完全静态。
                c.elevation = if d < w { level-1.4 + p.y/size*0.3 }
                    else if outside < bank { level + 0.4 + outside/bank*1.6 }
                    else { let u = ((outside-bank)/terrace).clamp(0.0,1.0);
                        level+2.0+u*2.0 + ((outside-bank-terrace).max(0.0)/size*cfg.terrain_ridge_amplitude.max(1.0))* (0.8+0.2*(p.y/90.0).sin()) };
                c.surface_kind = if d < w { SurfaceKind::DeepWater } else if outside < bank { SurfaceKind::RiverBank }
                    else if outside < bank+terrace { SurfaceKind::RiverTerrace } else { SurfaceKind::DryGround };
                c.water_body_id = if d < w {Some(1)} else {None};
                c.feature_flags = if d < w {TERRAIN_FLAG_NO_BUILD|TERRAIN_FLAG_NO_WALK} else if outside < bank {TERRAIN_FLAG_NO_BUILD|TERRAIN_FLAG_SHORE_ACCESS} else {0};
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
        self.recompute_slopes();
    }
    pub fn recompute_slopes(&mut self) {
        let raw:Vec<_>=self.cells.iter().map(|c|c.elevation).collect();
        let step=self.world_size/(self.grid_width-1).max(1) as f32;
        for y in 0..self.grid_height {for x in 0..self.grid_width {
            let (l,r,u,d)=(x.saturating_sub(1),(x+1).min(self.grid_width-1),y.saturating_sub(1),(y+1).min(self.grid_height-1));
            let dx=(raw[y*self.grid_width+r]-raw[y*self.grid_width+l])/((r-l).max(1) as f32*step);
            let dy=(raw[d*self.grid_width+x]-raw[u*self.grid_width+x])/((d-u).max(1) as f32*step);
            self.cells[y*self.grid_width+x].slope_angle_deg=(dx*dx+dy*dy).sqrt().atan().to_degrees();
        }}
    }
}
