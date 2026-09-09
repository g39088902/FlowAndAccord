//! 地表合法节点、统一道路提交与浅滩接入。规划失败不修改路网。
use super::{world::World3DEngine, graph::{NodeType,RoadClass,LaneTerrainProfile}, curve::Curve3D,vec3::Vec3};
use crate::geo::{corridor,biome::SurfaceKind};
impl World3DEngine {
    pub(crate) fn legal_land_position(&self, p:Vec3, occupied:&[Vec3])->Option<Vec3> {
        let valid=|q:Vec3| corridor::segment_valid(&self.terrain,q,q,self.config.terrain_road_corridor_width,self.config.terrain_max_walk_slope,None)
            && occupied.iter().all(|o| {let dx=o.x-q.x;let dy=o.y-q.y;(dx*dx+dy*dy).sqrt()>=self.config.poi_min_distance*self.config.poi_spawn_fallback_ratio});
        let mut p=p;p.z=self.terrain.sample_elevation(p.x,p.y);
        if valid(p){return Some(p);}
        let mut candidates:Vec<_>=(0..self.terrain.cells.len()).map(|i|self.terrain.grid_pos(i%self.terrain.grid_width,i/self.terrain.grid_width)).filter(|q|valid(*q)).collect();
        candidates.sort_by(|a,b|a.distance_to(&p).total_cmp(&b.distance_to(&p)).then(a.x.total_cmp(&b.x)).then(a.y.total_cmp(&b.y)));
        candidates.first().copied()
    }
    pub(crate) fn prepare_terrain_layout(&mut self) {
        let mut occupied:Vec<Vec3>=self.terrain.hydrology.access_points.iter().map(|a|a.pos).collect();
        for i in 0..self.pois.len(){
            let access=if self.pois[i].poi_type==super::poi::PoiType::WaterSource {
                self.terrain.hydrology.access_points.get((self.pois[i].id-10) as usize).cloned()
            }else{None};
            let pos=if let Some(a)=access {
                self.pois[i].water_pool_id=Some(a.resource_pool_id);self.pois[i].access_point_id=Some(a.id);
                self.pois[i].name=format!("河岸取水点 #{}",a.id);
                a.pos
            }else {self.legal_land_position(self.pois[i].pos,&occupied).unwrap_or(self.pois[i].pos)};
            self.pois[i].pos=pos;occupied.push(pos);
            if let Some(n)=self.pois[i].nearest_node_id {
                self.network.graph[*self.network.node_map.get(&n).unwrap()].pos=pos;
                if let Some(id)=self.pois[i].access_point_id {
                    if let Some(a)=self.terrain.hydrology.access_points.iter_mut().find(|a|a.id==id){a.nearest_node_id=Some(n);}
                }
            }
        }
        let ids:Vec<_>=self.network.graph.node_weights().map(|n|n.id).collect();
        for id in ids {
            if self.pois.iter().any(|p|p.nearest_node_id==Some(id)){continue;}
            let idx=self.network.node_map[&id];let pos=self.network.graph[idx].pos;
            if let Some(p)=self.legal_land_position(pos,&[]) {self.network.graph[idx].pos=p;}
        }
        self.water_pools.clear();
        if !self.terrain.hydrology.water_bodies.is_empty(){
            let ids:Vec<_>=self.pois.iter().filter(|p|p.water_pool_id==Some(1)).map(|p|p.id).collect();
            let max=self.config.stock_max_water*ids.len() as f32;
            self.water_pools.push(crate::geo::hydrology::WaterPool{id:1,current_stock:max*0.75,max_stock:max,regen_rate:self.config.regen_base_water*ids.len() as f32,source_poi_ids:ids});
            self.sync_water_pois();
        }
    }
    pub(crate) fn connect_land_nodes(&mut self,a:u32,b:u32)->bool {
        let pa=self.network.graph[self.network.node_map[&a]].pos;let pb=self.network.graph[self.network.node_map[&b]].pos;
        let Some(path)=corridor::route(&self.terrain,pa,pb,&self.config) else{return false;};
        self.commit_terrain_path(a,b,&path,None);true
    }
    pub(crate) fn commit_terrain_path(&mut self,a:u32,b:u32,path:&[Vec3],crossing:Option<u32>) {
        let mut from=a;
        for (i,pair) in path.windows(2).enumerate(){
            let to=if i+2==path.len(){b}else{self.network.add_node(pair[1],NodeType::GroundIntersection)};
            let mut forward=Curve3D::new_straight(pair[0],pair[1]);
            forward.p1.z=self.terrain.sample_elevation(forward.p1.x,forward.p1.y);
            forward.p2.z=self.terrain.sample_elevation(forward.p2.x,forward.p2.y);
            forward.length=forward.calculate_arc_length(32);
            let reverse=Curve3D::new_bezier(forward.p3,forward.p2,forward.p1,forward.p0);
            let mut profile=LaneTerrainProfile {max_slope_deg:0.0,terrain_time_cost:1.0,surface_mask:0,crossing_id:crossing};
            for k in 0..=32{let p=forward.evaluate_pos(k as f32/32.0);let c=self.terrain.sample_cell(p.x,p.y);
                profile.max_slope_deg=profile.max_slope_deg.max(c.slope_angle_deg);profile.surface_mask|=1u16<<(c.surface_kind as u8);
                if matches!(c.surface_kind,SurfaceKind::RiverBank|SurfaceKind::SoftGround){profile.terrain_time_cost=profile.terrain_time_cost.max(self.config.terrain_soft_ground_cost.max(1.0));}}
            if crossing.is_some(){profile.terrain_time_cost=self.config.terrain_shallow_water_cost.max(1.0);}
            for (u,v,curve) in [(from,to,forward),(to,from,reverse)] {
                if let Ok(id)=self.network.add_lane(u,v,Some(curve),RoadClass::DirtTrack,&self.config){let idx=self.network.edge_map[&id];self.network.graph[idx].terrain_profile=profile.clone();}
            }
            from=to;
        }
    }
    pub(crate) fn connect_terrain_world(&mut self, ids:&[u32]) {
        let mut all=ids.to_vec();
        for i in 0..self.terrain.hydrology.connections.len(){
            let c=self.terrain.hydrology.connections[i].clone();
            let a=self.network.add_node(c.start,NodeType::GroundIntersection);let b=self.network.add_node(c.end,NodeType::GroundIntersection);
            self.terrain.hydrology.connections[i].node_a=Some(a);self.terrain.hydrology.connections[i].node_b=Some(b);
            all.extend([a,b]);
            if corridor::segment_valid(&self.terrain,c.start,c.end,self.config.terrain_road_corridor_width,self.config.terrain_max_walk_slope,Some(c.id)) {
                self.commit_terrain_path(a,b,&[c.start,c.end],Some(c.id));
            }
        }
        // 稳定的近邻骨架，加连通分量补边；不为每对 POI 复制整条走廊。
        let mut pairs=Vec::new();
        for (i,&a) in all.iter().enumerate(){for &b in &all[i+1..] {
            let pa=self.network.graph[self.network.node_map[&a]].pos;let pb=self.network.graph[self.network.node_map[&b]].pos;
            pairs.push((pa.distance_to(&pb),a,b));
        }}
        pairs.sort_by(|a,b|a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        let mut degrees=std::collections::BTreeMap::<u32,usize>::new();
        for (_,a,b) in pairs {
            let connected=petgraph::algo::has_path_connecting(&self.network.graph,self.network.node_map[&a],self.network.node_map[&b],None);
            if connected && *degrees.get(&a).unwrap_or(&0)>=3 && *degrees.get(&b).unwrap_or(&0)>=3{continue;}
            if self.connect_land_nodes(a,b){*degrees.entry(a).or_default()+=1;*degrees.entry(b).or_default()+=1;}
        }
    }
    pub fn validate_terrain_world(&self)->Result<(),String>{
        for lane in self.network.graph.edge_weights(){
            if !corridor::validate_curve(&self.terrain,&lane.curve,self.config.terrain_road_corridor_width,self.config.terrain_max_walk_slope,lane.terrain_profile.crossing_id){return Err(format!("车道 {} 不符合地表通行规则",lane.id));}
        }
        let Some(start)=self.network.graph.node_indices().next()else{return Err("没有合法路网".into());};
        for poi in &self.pois {let Some(id)=poi.nearest_node_id else{return Err("POI 缺少道路接入".into());};
            if !petgraph::algo::has_path_connecting(&self.network.graph,start,self.network.node_map[&id],None){return Err(format!("POI {} 不可达",poi.id));}}
        Ok(())
    }
    pub(crate) fn sync_water_pois(&mut self){
        for p in &mut self.pois {if let Some(pool)=p.water_pool_id.and_then(|id|self.water_pools.iter().find(|w|w.id==id)) {
            p.current_stock=pool.current_stock;p.max_stock=pool.max_stock;p.regen_rate=pool.regen_rate;
        }}
    }
}
