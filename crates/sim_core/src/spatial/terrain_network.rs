//! 地表合法节点、统一道路提交与浅滩接入。规划失败不修改路网。
use super::{world::World3DEngine, graph::{NodeType,RoadClass,LaneTerrainProfile}, curve::Curve3D,vec3::Vec3};
use crate::geo::{corridor,biome::SurfaceKind};
impl World3DEngine {
    pub(crate) fn legal_land_position(&self, p:Vec3, occupied:&[Vec3])->Option<Vec3> {
        let valid=|q:Vec3| corridor::segment_valid(&self.terrain,q,q,self.config.terrain_road_corridor_width,self.config.terrain_max_walk_slope,None)
            && occupied.iter().all(|o| {let dx=o.x-q.x;let dy=o.y-q.y;(dx*dx+dy*dy).sqrt()>=self.config.poi_min_distance*self.config.poi_spawn_fallback_ratio});
        let mut p=p;p.z=self.terrain_runtime().sample_elevation(p.x,p.y);
        if valid(p){return Some(p);}
        // 从目标格向外扩圈。全图排序即使改成单遍最小值仍会为每个失效 POI
        // 扫描全部 256² 个格；扩圈后找到候选，并证明未扫描区域更远时即可结束。
        // 比较键与旧排序一致，保持距离相同时按 x/y 稳定打破平局。
        let (center_x, center_y) = self.terrain.grid_index(p.x, p.y);
        let max_radius = center_x
            .max(self.terrain.grid_width - 1 - center_x)
            .max(center_y)
            .max(self.terrain.grid_height - 1 - center_y);
        let mut best: Option<(Vec3, f32)> = None;
        for radius in 0..=max_radius {
            let x0 = center_x.saturating_sub(radius);
            let x1 = (center_x + radius).min(self.terrain.grid_width - 1);
            let y0 = center_y.saturating_sub(radius);
            let y1 = (center_y + radius).min(self.terrain.grid_height - 1);
            for gy in y0..=y1 {
                for gx in x0..=x1 {
                    if radius > 0
                        && gx != x0
                        && gx != x1
                        && gy != y0
                        && gy != y1
                    {
                        continue;
                    }
                    let candidate = self.terrain.grid_pos(gx, gy);
                    if !valid(candidate) {
                        continue;
                    }
                    let distance = candidate.distance_to(&p);
                    let replace = best.map_or(true, |(current, current_distance)| {
                        distance
                            .total_cmp(&current_distance)
                            .then(candidate.x.total_cmp(&current.x))
                            .then(candidate.y.total_cmp(&current.y))
                            .is_lt()
                    });
                    if replace {
                        best = Some((candidate, distance));
                    }
                }
            }

            if let Some((_, best_distance)) = best {
                // 任一未扫描格都在当前矩形外，故至少超出其某一条边；用该轴
                // 到最近未扫描格中心的距离作保守下界。严格大于才提前结束，
                // 让等距候选仍参与 x/y 平局判定。
                let mut unscanned_lower_bound = f32::INFINITY;
                if x0 > 0 {
                    let x = self.terrain.grid_pos(x0 - 1, center_y).x;
                    unscanned_lower_bound = unscanned_lower_bound.min((x - p.x).abs());
                }
                if x1 + 1 < self.terrain.grid_width {
                    let x = self.terrain.grid_pos(x1 + 1, center_y).x;
                    unscanned_lower_bound = unscanned_lower_bound.min((x - p.x).abs());
                }
                if y0 > 0 {
                    let y = self.terrain.grid_pos(center_x, y0 - 1).y;
                    unscanned_lower_bound = unscanned_lower_bound.min((y - p.y).abs());
                }
                if y1 + 1 < self.terrain.grid_height {
                    let y = self.terrain.grid_pos(center_x, y1 + 1).y;
                    unscanned_lower_bound = unscanned_lower_bound.min((y - p.y).abs());
                }
                if unscanned_lower_bound > best_distance {
                    break;
                }
            }
        }
        best.map(|(candidate, _)| candidate)
    }
    pub(crate) fn prepare_terrain_layout(&mut self) {
        let mut occupied:Vec<Vec3>=self.terrain.hydrology.access_points.iter().map(|a|a.pos).collect();
        let is_plateau = self.terrain.profile == crate::geo::terrain::TERRAIN_PROFILE_PLATEAU
            && !self.terrain.field_compiled;
        let plateau_geom = if is_plateau { self.get_plateau_geometry() } else { None };
        if let Some(pg) = plateau_geom.as_ref() {
            let anchor_elevations: Vec<f32> = pg
                .spring_anchors
                .iter()
                .map(|&(sx, sy)| self.terrain_runtime().sample_elevation(sx, sy))
                .collect();
            let mut w_idx = 0;
            for p in &mut self.pois {
                if p.poi_type == super::poi::PoiType::WaterSource && w_idx < pg.spring_anchors.len() {
                    let (sx, sy) = pg.spring_anchors[w_idx];
                    let sz = anchor_elevations[w_idx];
                    let pos = Vec3::new(sx, sy, sz);
                    p.pos = pos;
                    if let Some(n) = p.nearest_node_id {
                        self.network.graph[*self.network.node_map.get(&n).unwrap()].pos = pos;
                    }
                    w_idx += 1;
                }
            }
        }
        // ★ TB-03 冲积扇：清泉 POI 重锚到扇缘水源候选（2 处对置；其余清泉若
        //   数量 >2 走 legal_land_position，扇面坡度全域可建不阻断）。
        let is_fan = self.terrain.profile == crate::geo::terrain::TERRAIN_PROFILE_ALLUVIAL_FAN;
        let fan_geom = if is_fan { self.get_fan_geometry() } else { None };
        if let Some(fg) = fan_geom.as_ref() {
            let anchor_elevations: Vec<f32> = fg
                .spring_anchors
                .iter()
                .map(|&(sx, sy)| self.terrain_runtime().sample_elevation(sx, sy))
                .collect();
            let mut w_idx = 0;
            for p in &mut self.pois {
                if p.poi_type == super::poi::PoiType::WaterSource && w_idx < fg.spring_anchors.len() {
                    let (sx, sy) = fg.spring_anchors[w_idx];
                    let pos = Vec3::new(sx, sy, anchor_elevations[w_idx]);
                    p.pos = pos;
                    if let Some(n) = p.nearest_node_id {
                        self.network.graph[*self.network.node_map.get(&n).unwrap()].pos = pos;
                    }
                    w_idx += 1;
                }
            }
        }
        // ★ TB-03 静水新模板取水点命名（湖岸；旧模板保持「河岸」语义）
        let water_poi_label = if self.terrain.profile == crate::geo::terrain::TERRAIN_PROFILE_VOLCANIC_LAKE {
            "湖岸取水点"
        } else {
            "河岸取水点"
        };
        for i in 0..self.pois.len(){
            let access=if self.pois[i].poi_type==super::poi::PoiType::WaterSource {
                self.terrain.hydrology.access_points.get((self.pois[i].id-10) as usize).cloned()
            }else{None};
            let pos=if let Some(a)=access {
                self.pois[i].water_pool_id=Some(a.resource_pool_id);self.pois[i].access_point_id=Some(a.id);
                self.pois[i].name=format!("{} #{}",water_poi_label,a.id);
                a.pos
            }else if is_plateau && self.pois[i].poi_type == super::poi::PoiType::WaterSource && (self.pois[i].id == 10 || self.pois[i].id == 11) {
                self.pois[i].pos
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
        if let Some(pg) = plateau_geom.as_ref() {
            self.setup_plateau_network(pg);
        }
        self.water_pools.clear();
        if !self.terrain.hydrology.water_bodies.is_empty(){
            let ids:Vec<_>=self.pois.iter().filter(|p|p.water_pool_id==Some(1)).map(|p|p.id).collect();
            // ★ TB-03 静水新模板：总池预算一次按配置建立（`stockMaxWater×countWater`/
            //   `regenBaseWater×countWater`），实际岸点只镜像池状态、不再乘入预算；
            //   `countWater=0` ⇒ 空池走生存门禁明确失败/降级，不额外发库存。
            //   旧河流路径保持「按已绑定岸点数乘算」等价输出。
            let n_budget = if crate::geo::terrain::is_static_water_profile(&self.terrain.profile) {
                self.config.count_water_sources as usize
            } else {
                ids.len()
            };
            let max=self.config.stock_max_water*n_budget as f32;
            self.water_pools.push(crate::geo::hydrology::WaterPool{id:1,current_stock:max*0.75,max_stock:max,regen_rate:self.config.regen_base_water*n_budget as f32,source_poi_ids:ids});
            self.sync_water_pois();
        } else if self.terrain.cells.iter().any(|cell| {
            matches!(cell.surface_kind, crate::geo::biome::SurfaceKind::DeepWater)
        }) {
            // UGC-03 heightfield maps intentionally do not invent legacy
            // River/WaterBody polygons. Preserve the gameplay contract by
            // deriving one shared water pool from the new cell semantics;
            // rendering still consumes the cells directly.
            let water_sources: Vec<u32> = self
                .pois
                .iter_mut()
                .filter(|poi| poi.poi_type == super::poi::PoiType::WaterSource)
                .map(|poi| {
                    poi.water_pool_id = Some(1);
                    poi.id
                })
                .collect();
            let n_budget = self.config.count_water_sources as usize;
            let max = self.config.stock_max_water * n_budget as f32;
            self.water_pools.push(crate::geo::hydrology::WaterPool {
                id: 1,
                current_stock: max * 0.75,
                max_stock: max,
                regen_rate: self.config.regen_base_water * n_budget as f32,
                source_poi_ids: water_sources,
            });
            self.sync_water_pois();
        }
    }
    pub(crate) fn connect_land_nodes(&mut self,a:u32,b:u32)->bool {
        let pa=self.network.graph[self.network.node_map[&a]].pos;let pb=self.network.graph[self.network.node_map[&b]].pos;
        let Some(path)=corridor::route(&self.terrain,pa,pb,&self.config) else{return false;};
        self.commit_terrain_path(a,b,&path,None)
    }
    /// 提交一条走廊折线为车道。**先按读档同一判据（`corridor::validate_curve`）验证全部
    /// 曲线，全部通过才落盘**——否则创世会产出读档时被 `validate_terrain_world` 拒绝的
    /// 车道，世界一旦存档就再也读不回来。
    ///
    /// ★ v1.50.17：`route` 内部的 `segment_valid` 用原始走廊宽度，而 `validate_curve` 会按
    /// 控制点偏离弦长放大有效走廊宽度，判据更严；地形变陡后两者的差集不再为空，故必须在
    /// 提交前用同一判据复核。返回 `false` 表示整条折线一条车道都没提交。
    pub(crate) fn commit_terrain_path(&mut self,a:u32,b:u32,path:&[Vec3],crossing:Option<u32>)->bool {
        let segs=path.len().saturating_sub(1);
        if segs==0 {return false;}
        let w=self.config.terrain_road_corridor_width;let slope=self.config.terrain_max_walk_slope;
        let mut curves=Vec::with_capacity(segs);
        for pair in path.windows(2) {
            let mut forward=Curve3D::new_straight(pair[0],pair[1]);
            forward.p1.z=self.terrain_runtime().sample_elevation(forward.p1.x,forward.p1.y);
            forward.p2.z=self.terrain_runtime().sample_elevation(forward.p2.x,forward.p2.y);
            forward.length=forward.calculate_arc_length(32);
            // 反向车道是同一 x/y 轨迹的逆参数化，几何等价，验证正向即可覆盖两者。
            if !corridor::validate_curve(&self.terrain,&forward,w,slope,crossing){return false;}
            curves.push(forward);
        }
        let mut from=a;
        for (i,forward) in curves.into_iter().enumerate(){
            let to=if i+1==segs{b}else{self.network.add_node(path[i+1],NodeType::GroundIntersection)};
            let reverse=Curve3D::new_bezier(forward.p3,forward.p2,forward.p1,forward.p0);
            let mut profile=LaneTerrainProfile {max_slope_deg:0.0,terrain_time_cost:1.0,surface_mask:0,crossing_id:crossing};
            for k in 0..=32{let p=forward.evaluate_pos(k as f32/32.0);let c=self.terrain_runtime().sample_cell(p.x,p.y);
                profile.max_slope_deg=profile.max_slope_deg.max(c.slope_angle_deg);profile.surface_mask|=1u16<<(c.surface_kind as u8);
                if matches!(c.surface_kind,SurfaceKind::RiverBank|SurfaceKind::SoftGround){profile.terrain_time_cost=profile.terrain_time_cost.max(self.config.terrain_soft_ground_cost.max(1.0));}}
            if crossing.is_some(){profile.terrain_time_cost=self.config.terrain_shallow_water_cost.max(1.0);}
            for (u,v,curve) in [(from,to,forward),(to,from,reverse)] {
                if let Ok(id)=self.network.add_lane(u,v,Some(curve),RoadClass::DirtTrack,&self.config){let idx=self.network.edge_map[&id];self.network.graph[idx].terrain_profile=profile.clone();}
            }
            from=to;
        }
        true
    }
    pub(crate) fn connect_terrain_world(&mut self, ids:&[u32]) {
        let mut all=ids.to_vec();
        for node in self.network.graph.node_weights() {
            if !all.contains(&node.id) {
                all.push(node.id);
            }
        }
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
            let degree_a = *degrees.get(&a).unwrap_or(&0);
            let degree_b = *degrees.get(&b).unwrap_or(&0);
            if connected && degree_a >= 3 && degree_b >= 3 {continue;}
            if connected {
                // 已连通节点间的绕行边只增加网格密度，不承担连通性；若直线不合法，
                // 跳过可选的全图 A* 绕行搜索，避免河流两岸节点反复搜索同一无授权跨水路线。
                let pa = self.network.graph[self.network.node_map[&a]].pos;
                let pb = self.network.graph[self.network.node_map[&b]].pos;
                if !corridor::segment_valid(
                    &self.terrain,
                    pa,
                    pb,
                    self.config.terrain_road_corridor_width,
                    self.config.terrain_max_walk_slope,
                    None,
                ) {
                    continue;
                }
            }
            if self.connect_land_nodes(a,b){*degrees.entry(a).or_default()+=1;*degrees.entry(b).or_default()+=1;}
        }
    }
    pub fn validate_terrain_world(&self)->Result<(),String>{
        for lane in self.network.graph.edge_weights(){
            if !corridor::validate_curve(&self.terrain,&lane.curve,self.config.terrain_road_corridor_width,self.config.terrain_max_walk_slope,lane.terrain_profile.crossing_id){return Err(format!("车道 {} 不符合地表通行规则",lane.id));}
        }
        // POI 不要求全部落在同一个路网连通分量内。孤立 POI 允许作为地图上的
        // 独立资源点保留；仍要求它拥有对应的路网节点，且所有已提交车道通过
        // 上面的几何/地表校验。
        for poi in &self.pois {
            let Some(id)=poi.nearest_node_id else{return Err("POI 缺少道路接入".into());};
            if !self.network.node_map.contains_key(&id) {
                return Err(format!("POI {} 的道路节点不存在", poi.id));
            }
        }
        Ok(())
    }
    pub(crate) fn sync_water_pois(&mut self){
        for p in &mut self.pois {if let Some(pool)=p.water_pool_id.and_then(|id|self.water_pools.iter().find(|w|w.id==id)) {
            p.current_stock=pool.current_stock;p.max_stock=pool.max_stock;p.regen_rate=pool.regen_rate;
        }}
    }

    /// 重新派生台地几何（纯函数，仅读 seed 与 config，不消费共享 RNG）。
    pub fn get_plateau_geometry(&self) -> Option<crate::geo::PlateauGeometry> {
        if self.terrain.profile != crate::geo::terrain::TERRAIN_PROFILE_PLATEAU {
            return None;
        }
        let mut relief_rng = crate::rng::WorldRng::new(self.terrain.seed ^ 0x5245_4c49_4546_5431);
        let _theta = relief_rng.gen_range(-0.18, 0.18);
        let _ridge_offset = relief_rng.gen_range(-0.08, 0.08) * self.terrain.world_size;
        let _saddle_along = relief_rng.gen_range(-0.12, 0.12) * self.terrain.world_size;
        let _saddle_width = relief_rng.gen_range(0.14, 0.19) * self.terrain.world_size;
        Some(crate::geo::PlateauGeometry::plan(
            &mut relief_rng,
            self.terrain.world_size,
            &self.config,
        ))
    }

    fn setup_plateau_network(&mut self, pg: &crate::geo::PlateauGeometry) {
        let p_center = Vec3::new(pg.center_anchor.0, pg.center_anchor.1, self.terrain_runtime().sample_elevation(pg.center_anchor.0, pg.center_anchor.1));
        let p_a_top = Vec3::new(pg.ramp_a_top.0, pg.ramp_a_top.1, self.terrain_runtime().sample_elevation(pg.ramp_a_top.0, pg.ramp_a_top.1));
        let p_a_bot = Vec3::new(pg.ramp_a_bottom.0, pg.ramp_a_bottom.1, self.terrain_runtime().sample_elevation(pg.ramp_a_bottom.0, pg.ramp_a_bottom.1));
        let p_b_top = Vec3::new(pg.ramp_b_top.0, pg.ramp_b_top.1, self.terrain_runtime().sample_elevation(pg.ramp_b_top.0, pg.ramp_b_top.1));
        let p_b_bot = Vec3::new(pg.ramp_b_bottom.0, pg.ramp_b_bottom.1, self.terrain_runtime().sample_elevation(pg.ramp_b_bottom.0, pg.ramp_b_bottom.1));

        let n_center = self.network.add_node(p_center, NodeType::GroundIntersection);
        let n_a_top = self.network.add_node(p_a_top, NodeType::GroundIntersection);
        let n_a_bot = self.network.add_node(p_a_bot, NodeType::GroundIntersection);
        let n_b_top = self.network.add_node(p_b_top, NodeType::GroundIntersection);
        let n_b_bot = self.network.add_node(p_b_bot, NodeType::GroundIntersection);

        if let Some(path) = corridor::route(&self.terrain, p_center, p_a_top, &self.config) {
            self.commit_terrain_path(n_center, n_a_top, &path, None);
        }
        if let Some(path) = corridor::route(&self.terrain, p_a_top, p_a_bot, &self.config) {
            self.commit_terrain_path(n_a_top, n_a_bot, &path, None);
        }
        if let Some(path) = corridor::route(&self.terrain, p_center, p_b_top, &self.config) {
            self.commit_terrain_path(n_center, n_b_top, &path, None);
        }
        if let Some(path) = corridor::route(&self.terrain, p_b_top, p_b_bot, &self.config) {
            self.commit_terrain_path(n_b_top, n_b_bot, &path, None);
        }

        if let Some(w0) = self.pois.iter().find(|p| p.id == 10) {
            if let Some(nw0) = w0.nearest_node_id {
                if let Some(path) = corridor::route(&self.terrain, p_a_bot, w0.pos, &self.config) {
                    self.commit_terrain_path(n_a_bot, nw0, &path, None);
                }
            }
        }
        if let Some(w1) = self.pois.iter().find(|p| p.id == 11) {
            if let Some(nw1) = w1.nearest_node_id {
                if let Some(path) = corridor::route(&self.terrain, p_b_bot, w1.pos, &self.config) {
                    self.commit_terrain_path(n_b_bot, nw1, &path, None);
                }
            }
        }
    }

    /// TB-02 台地专有门禁校验（房屋候选区与双入口连通性）。
    pub fn validate_plateau_gates(&self) -> Result<(), String> {
        let Some(pg) = self.get_plateau_geometry() else {
            return Ok(());
        };

        // 1. 验证台面房屋候选区：至少 3 处互不重叠候选通过 validate_footprint
        let mut buildable_count = 0;
        for &pos in &pg.build_candidates {
            let res = crate::geo::validate_footprint(
                &self.terrain,
                crate::geo::FootprintQuery {
                    center: Vec3::new(pos.0, pos.1, self.terrain_runtime().sample_elevation(pos.0, pos.1)),
                    half_extents: (
                        self.config.terrain_footprint_half_extent,
                        self.config.terrain_footprint_half_extent,
                    ),
                    rotation_rad: 0.0,
                    use_kind: crate::geo::LandUseKind::House,
                },
                self.config.terrain_max_build_slope,
            );
            if res.valid {
                buildable_count += 1;
            }
        }
        if buildable_count < 3 {
            return Err("PlateauBuildAreaInsufficient".into());
        }

        // 2. 验证台面到两处坡脚水源 POI (10 与 11) 的双入口通路
        let Some(start_node) = self.network.graph.node_indices().find(|&idx| {
            let p = self.network.graph[idx].pos;
            (p.x - pg.center_anchor.0).hypot(p.y - pg.center_anchor.1) < 20.0
        }) else {
            return Err("PlateauRampBlocked".into());
        };

        let w0_node = self.pois.iter().find(|p| p.id == 10).and_then(|p| p.nearest_node_id).and_then(|nid| self.network.node_map.get(&nid).copied());
        let w1_node = self.pois.iter().find(|p| p.id == 11).and_then(|p| p.nearest_node_id).and_then(|nid| self.network.node_map.get(&nid).copied());

        let can_reach_w0 = w0_node.map_or(false, |w| petgraph::algo::has_path_connecting(&self.network.graph, start_node, w, None));
        let can_reach_w1 = w1_node.map_or(false, |w| petgraph::algo::has_path_connecting(&self.network.graph, start_node, w, None));

        if !can_reach_w0 && !can_reach_w1 {
            return Err("PlateauWaterUnreachable".into());
        }
        if !can_reach_w0 {
            return Err("PlateauRampABlocked".into());
        }
        if !can_reach_w1 {
            return Err("PlateauRampBBlocked".into());
        }

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════
    // ★ TB-03 盆地 / 山前冲积扇 / 火山湖：几何重放与模板专属门禁。
    // ═══════════════════════════════════════════════════════════════════

    /// 重放 `relief_rng` 头部公共消费（4 次），供 TB-03 几何重放入口复用。
    fn replay_relief_rng(&self) -> crate::rng::WorldRng {
        let mut relief_rng = crate::rng::WorldRng::new(self.terrain.seed ^ 0x5245_4c49_4546_5431);
        let _theta = relief_rng.gen_range(-0.18, 0.18);
        let _ridge_offset = relief_rng.gen_range(-0.08, 0.08) * self.terrain.world_size;
        let _saddle_along = relief_rng.gen_range(-0.12, 0.12) * self.terrain.world_size;
        let _saddle_width = relief_rng.gen_range(0.14, 0.19) * self.terrain.world_size;
        relief_rng
    }

    /// 重放基础倾斜平面（与 `generate_base_relief` 的 `base_tilt` 同式）。
    fn replay_tilt(&self) -> (f32, f32) {
        let mut rng = crate::rng::WorldRng::new(self.terrain.seed);
        let tilt_angle = rng.gen_range(0.0, std::f32::consts::TAU);
        (tilt_angle.cos(), tilt_angle.sin())
    }

    /// 重新派生冲积扇几何（纯函数，仅读 seed 与 config，不消费共享 RNG）。
    pub fn get_fan_geometry(&self) -> Option<crate::geo::FanGeometry> {
        if self.terrain.profile != crate::geo::terrain::TERRAIN_PROFILE_ALLUVIAL_FAN {
            return None;
        }
        let mut relief_rng = self.replay_relief_rng();
        Some(crate::geo::FanGeometry::plan(
            &mut relief_rng,
            self.terrain.world_size,
            &self.config,
        ))
    }

    /// 重新派生盆地几何。
    pub fn get_basin_geometry(&self) -> Option<crate::geo::BasinGeometry> {
        if self.terrain.profile != crate::geo::terrain::TERRAIN_PROFILE_BASIN_OASIS {
            return None;
        }
        let mut relief_rng = self.replay_relief_rng();
        let (tilt_cos, tilt_sin) = self.replay_tilt();
        let half = self.terrain.world_size * 0.5;
        // 倾斜幅度：重放主 RNG 第二抽（与生成路径同序同值）
        let mut rng = crate::rng::WorldRng::new(self.terrain.seed);
        let _angle = rng.gen_range(0.0, std::f32::consts::TAU);
        let tilt_magnitude = rng.gen_range(16.0, 24.0);
        let tilt_at = |wx: f32, wy: f32| -> f32 {
            ((wx * tilt_cos + wy * tilt_sin) / half.max(1.0)) * (tilt_magnitude * 0.5)
        };
        Some(crate::geo::BasinGeometry::plan(
            &mut relief_rng,
            self.terrain.world_size,
            &self.config,
            tilt_at,
        ))
    }

    /// 重新派生火山湖几何（含静水计划与干岸平坦基准）。
    pub fn get_volcanic_lake_geometry(&self) -> Option<crate::geo::VolcanicLakeGeometry> {
        if self.terrain.profile != crate::geo::terrain::TERRAIN_PROFILE_VOLCANIC_LAKE {
            return None;
        }
        let mut relief_rng = self.replay_relief_rng();
        let (tilt_cos, tilt_sin) = self.replay_tilt();
        let half = self.terrain.world_size * 0.5;
        let mut rng = crate::rng::WorldRng::new(self.terrain.seed);
        let _angle = rng.gen_range(0.0, std::f32::consts::TAU);
        let tilt_magnitude = rng.gen_range(16.0, 24.0);
        let tilt_at = |wx: f32, wy: f32| -> f32 {
            ((wx * tilt_cos + wy * tilt_sin) / half.max(1.0)) * (tilt_magnitude * 0.5)
        };
        Some(crate::geo::VolcanicLakeGeometry::plan(
            &mut relief_rng,
            self.terrain.world_size,
            &self.config,
            tilt_at,
        ))
    }

    /// 模板公共子校验：在区域内按格网扫描完整占地合法且互不重叠的房屋候选
    ///（≥3 通过）。合法性完全由实际定稿格子裁决（坡度/NO_BUILD/水体/地表），
    /// 不依赖生成期锚点（TB-03-06 实测：固定锚点会落在扇侧陡缘/岸环禁建带）。
    fn count_spaced_buildable<F: Fn(f32, f32) -> bool>(&self, region: F) -> usize {
        let mut picked: Vec<Vec3> = Vec::new();
        let step = 3usize;
        for gy in (0..self.terrain.grid_height).step_by(step) {
            for gx in (0..self.terrain.grid_width).step_by(step) {
                let p = self.terrain.grid_pos(gx, gy);
                if !region(p.x, p.y) {
                    continue;
                }
                // 互不重叠：间距 ≥ 3×footprint_half_extent（非重叠完整占地）
                if picked.iter().any(|q| q.distance_to(&p) < self.config.terrain_footprint_half_extent * 3.0) {
                    continue;
                }
                let res = crate::geo::validate_footprint(
                    &self.terrain,
                    crate::geo::FootprintQuery {
                        center: Vec3::new(p.x, p.y, self.terrain_runtime().sample_elevation(p.x, p.y)),
                        half_extents: (
                            self.config.terrain_footprint_half_extent,
                            self.config.terrain_footprint_half_extent,
                        ),
                        rotation_rad: 0.0,
                        use_kind: crate::geo::LandUseKind::House,
                    },
                    self.config.terrain_max_build_slope,
                );
                if res.valid {
                    picked.push(p);
                    if picked.len() >= 3 {
                        return 3;
                    }
                }
            }
        }
        picked.len()
    }

    /// 岸点干地合法性：全部取水岸点必须落在真实干地（无水体归属、非硬禁行）。
    fn validate_access_points_dry(&self) -> Result<(), String> {
        for ap in &self.terrain.hydrology.access_points {
            let (gx, gy) = self.terrain.grid_index(ap.pos.x, ap.pos.y);
            let c = &self.terrain.cells[gy * self.terrain.grid_width + gx];
            if c.water_body_id.is_some()
                || c.feature_flags & crate::geo::biome::TERRAIN_FLAG_NO_WALK != 0
            {
                return Err("WaterAccessInvalid".into());
            }
        }
        Ok(())
    }

    /// TB-03 冲积扇专有门禁：扇面房屋候选完整占地 + 山口→扇缘全宽干地走廊。
    pub fn validate_fan_gates(&self) -> Result<(), String> {
        let Some(fg) = self.get_fan_geometry() else {
            return Ok(());
        };
        // 扇面生活带：r < 0.9L 且 |θ| < 0.85α（浅沟格 NO_BUILD 自动被占地校验排除）
        let buildable = self.count_spaced_buildable(|wx, wy| {
            let (r, th) = fg.world_to_fan(wx, wy);
            r < 0.9 * fg.length && th.abs() < 0.85 * fg.half_angle
        });
        if buildable < 3 {
            return Err("FanBuildAreaInsufficient".into());
        }
        // 全宽干地走廊：山口内 20m → 扇缘锚点；干沟 SoftGround 可慢行横跨，
        // 走廊被阻断 ⇒ 生成失败（不能建路后回填高程）。
        let a = Vec3::new(
            fg.mouth_anchor.0 + fg.dir_x * 20.0,
            fg.mouth_anchor.1 + fg.dir_y * 20.0,
            0.0,
        );
        let b = Vec3::new(fg.edge_anchor.0, fg.edge_anchor.1, 0.0);
        let mut a = a;
        a.z = self.terrain_runtime().sample_elevation(a.x, a.y);
        let mut b = b;
        b.z = self.terrain_runtime().sample_elevation(b.x, b.y);
        if corridor::route(&self.terrain, a, b, &self.config).is_none() {
            return Err("FanDryCorridorBlocked".into());
        }
        Ok(())
    }

    /// TB-03 盆地生活带门禁：盆底平坦生活带房屋候选完整占地。
    ///
    /// 出口路径不再作为创世硬门禁。实际路网和生存诊断仍会校验已生成的
    /// 车道与 POI，避免用与 Field Compiler 不同源的旧出口几何拒绝盆地。
    pub fn validate_basin_build_area_gate(&self) -> Result<(), String> {
        let Some(bg) = self.get_basin_geometry() else {
            return Ok(());
        };
        // 盆底生活带：q < 0.82（盆壁与高山自动被占地校验排除）
        let buildable = self.count_spaced_buildable(|wx, wy| {
            let (q, _) = bg.q_at(wx, wy);
            q < 0.82
        });
        if buildable < 3 {
            return Err("BasinBuildAreaInsufficient".into());
        }
        Ok(())
    }

    /// TB-03 火山湖专有门禁：环岸生活带房屋候选完整占地 + 环岸通路 +
    /// 双出口可达 + 岸点干地合法。
    pub fn validate_volcanic_lake_gates(&self) -> Result<(), String> {
        let Some(lg) = self.get_volcanic_lake_geometry() else {
            return Ok(());
        };
        // 环岸生活带：水线外退距+占地余量 → 低坡环岸外缘。
        // 火山湖湖面收缩后，固定 0.42×均半轴会把最小湖型的可建带压到不足一栋房屋；
        // 扩到 0.75×均半轴仍由最终 footprint 坡度/禁建标志筛选，只放宽候选扫描范围。
        let r_mean = (lg.semi_a + lg.semi_b) * 0.5;
        let setback = lg.shore_setback_m + self.config.terrain_footprint_half_extent * 2.0;
        let buildable = self.count_spaced_buildable(|wx, wy| {
            let d = lg.shore_distance(wx, wy);
            d > setback && d < 0.75 * r_mean
        });
        if buildable < 3 {
            return Err("LakeBuildAreaInsufficient".into());
        }
        self.validate_access_points_dry()?;
        // 环岸全宽通路：两个取水岸点之间必须存在陆路路由（湖体阻断直穿，
        // 路由经环湖干岸绕行）。
        if let Some(plan) = lg.water.as_ref() {
            if plan.access_points.len() == 2 {
                let (ax, ay) = plan.access_points[0];
                let (bx, by) = plan.access_points[1];
                let mut a = Vec3::new(ax, ay, 0.0);
                a.z = self.terrain_runtime().sample_elevation(ax, ay);
                let mut b = Vec3::new(bx, by, 0.0);
                b.z = self.terrain_runtime().sample_elevation(bx, by);
                if corridor::route(&self.terrain, a, b, &self.config).is_none() {
                    return Err("LakeShoreDisconnected".into());
                }
            }
        }
        // 双出口：各出口方向自水线外平台（r_out+退距+8m）到岭外（r_out×2.55）
        // 必须可达。⚠️ 起终点不能用固定比例半径——湖半轴独立抽样（a/b 可达
        // 1.6:1），固定比例点在窄轴方向会落进湖里（TB-03-08 实测踩坑）。
        for &e in &lg.exit_thetas {
            let (r_out_e, _) = lg.outline_radius_at(e - lg.rotation_rad);
            let d1 = r_out_e + lg.shore_setback_m + 8.0;
            let d2 = r_out_e * 2.55;
            let mut a = Vec3::new(lg.center_x + e.cos() * d1, lg.center_y + e.sin() * d1, 0.0);
            a.z = self.terrain_runtime().sample_elevation(a.x, a.y);
            let mut b = Vec3::new(lg.center_x + e.cos() * d2, lg.center_y + e.sin() * d2, 0.0);
            b.z = self.terrain_runtime().sample_elevation(b.x, b.y);
            if corridor::route(&self.terrain, a, b, &self.config).is_none() {
                return Err("LakeShoreDisconnected".into());
            }
        }
        Ok(())
    }
}
