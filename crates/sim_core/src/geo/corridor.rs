//! 保守栅格走廊与确定性寻路；所有跨水必须显式授权连接 ID。
use std::{cmp::Reverse, collections::BinaryHeap};
use crate::{config::SimConfig, spatial::{curve::Curve3D, vec3::Vec3}};
use super::{terrain::TerrainMap, biome::*};

fn intersects(a:Vec3,b:Vec3,x0:f32,y0:f32,x1:f32,y1:f32)->bool {
    let mut lo=0.0f32;let mut hi=1.0f32;
    for (p,q,min,max) in [(a.x,b.x,x0,x1),(a.y,b.y,y0,y1)] {
        let d=q-p;
        if d.abs()<1e-7 {if p<min || p>max{return false;}}
        else {let t=(min-p)/d;let u=(max-p)/d;lo=lo.max(t.min(u));hi=hi.min(t.max(u));if lo>hi{return false;}}
    }
    true
}
pub fn segment_valid(t:&TerrainMap,a:Vec3,b:Vec3,width:f32,slope:f32,crossing:Option<u32>)->bool {
    let radius=width*0.5; let half=t.world_size*0.5;
    if [a.x,a.y,b.x,b.y].iter().any(|v|!v.is_finite() || v.abs()+radius>half) {return false;}
    let step=t.world_size/(t.grid_width-1).max(1) as f32;
    let (x0,y0)=t.grid_index(a.x.min(b.x)-radius-step*0.5,a.y.min(b.y)-radius-step*0.5);
    let (x1,y1)=t.grid_index(a.x.max(b.x)+radius+step*0.5,a.y.max(b.y)+radius+step*0.5);
    let auth=crossing.and_then(|id|t.hydrology.connections.iter().find(|c|c.id==id));
    for y in y0..=y1 {for x in x0..=x1 {
        let p=t.grid_pos(x,y);let r=radius+step*0.5;
        if !intersects(a,b,p.x-r,p.y-r,p.x+r,p.y+r){continue;}
        let c=&t.cells[y*t.grid_width+x];
        if c.slope_angle_deg>slope{return false;}
        if c.water_body_id.is_some() || matches!(c.surface_kind,SurfaceKind::ShallowWater|SurfaceKind::DeepWater) {
            let Some(f)=auth else {return false;};
            // 授权只覆盖该连接的横向走廊；禁止普通路线借浅滩沿河行进。
            if (a.y-f.start.y).abs()+radius>f.width*0.5 || (b.y-f.start.y).abs()+radius>f.width*0.5 {return false;}
            if a.x.min(b.x)<f.start.x-radius || a.x.max(b.x)>f.end.x+radius{return false;}
        } else if c.feature_flags&TERRAIN_FLAG_NO_WALK!=0 || c.surface_kind==SurfaceKind::RockFace {return false;}
    }}
    true
}
pub fn validate_curve(t:&TerrainMap,c:&Curve3D,width:f32,slope:f32,crossing:Option<u32>)->bool {
    fn recur(t:&TerrainMap,c:&Curve3D,w:f32,s:f32,id:Option<u32>,depth:u8)->bool {
        let line=Curve3D::new_straight(c.p0,c.p3);
        let error=c.p1.distance_to(&line.p1).max(c.p2.distance_to(&line.p2));
        if error<0.1 {return segment_valid(t,c.p0,c.p3,w+error*2.0,s,id);}
        if depth>=16{return false;}
        let a=Vec3::lerp(c.p0,c.p1,0.5);let b=Vec3::lerp(c.p1,c.p2,0.5);let d=Vec3::lerp(c.p2,c.p3,0.5);
        let e=Vec3::lerp(a,b,0.5);let f=Vec3::lerp(b,d,0.5);let m=Vec3::lerp(e,f,0.5);
        recur(t,&Curve3D::new_bezier(c.p0,a,e,m),w,s,id,depth+1)&&recur(t,&Curve3D::new_bezier(m,f,d,c.p3),w,s,id,depth+1)
    }
    recur(t,c,width,slope,crossing,0)
}
pub fn route(t:&TerrainMap,a:Vec3,b:Vec3,cfg:&SimConfig)->Option<Vec<Vec3>> {
    let w=cfg.terrain_road_corridor_width;let slope=cfg.terrain_max_walk_slope;
    if segment_valid(t,a,b,w,slope,None){return Some(vec![a,b]);}
    let (sx,sy)=t.grid_index(a.x,a.y);let (gx,gy)=t.grid_index(b.x,b.y);
    let start=sy*t.grid_width+sx;let goal=gy*t.grid_width+gx;
    let mut costs=vec![u64::MAX;t.cells.len()];let mut prev=vec![usize::MAX;t.cells.len()];
    let mut q=BinaryHeap::new();costs[start]=0;q.push(Reverse((0u64,start)));
    while let Some(Reverse((cost,i)))=q.pop(){
        if cost!=costs[i]{continue;}if i==goal{break;}
        let (x,y)=(i%t.grid_width,i/t.grid_width);let p=if i==start{a}else{t.grid_pos(x,y)};
        for (dx,dy) in [(-1,-1),(0,-1),(1,-1),(-1,0),(1,0),(-1,1),(0,1),(1,1)] {
            let (nx,ny)=(x as i32+dx,y as i32+dy);
            if nx<0||ny<0||nx>=t.grid_width as i32||ny>=t.grid_height as i32{continue;}
            let ni=ny as usize*t.grid_width+nx as usize;let np=if ni==goal{b}else{t.grid_pos(nx as usize,ny as usize)};
            if !segment_valid(t,p,np,w,slope,None){continue;}
            let soft=matches!(t.cells[ni].surface_kind,SurfaceKind::RiverBank|SurfaceKind::SoftGround);
            let factor=if soft {cfg.terrain_soft_ground_cost.max(1.0)}else{1.0};
            let next=cost+(p.distance_to(&np)*factor*1000.0).ceil() as u64;
            if next<costs[ni]{costs[ni]=next;prev[ni]=i;q.push(Reverse((next,ni)));}
        }
    }
    if costs[goal]==u64::MAX{return None;}
    let mut path=vec![b];let mut at=goal;
    while at!=start {at=prev[at];if at==usize::MAX{return None;}path.push(if at==start{a}else{t.grid_pos(at%t.grid_width,at/t.grid_width)});}
    path.reverse();let mut out=vec![a];let mut i=0;
    while i+1<path.len(){let mut j=path.len()-1;while j>i+1&&!segment_valid(t,path[i],path[j],w,slope,None){j-=1;}out.push(path[j]);i=j;}
    Some(out)
}
