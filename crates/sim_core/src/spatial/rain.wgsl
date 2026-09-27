      struct Params { dt:f32, rainfall:f32, world_size:f32, grid_w:u32, grid_h:u32, frame:u32, pad0:u32, pad1:u32 };
      struct Particle { pos:vec4<f32>, prev:vec4<f32>, vel:vec4<f32>, flags:vec4<f32> };
      struct State { carry:f32, rng:u32, pad0:u32, pad1:u32 };
      struct Camera { viewport:vec2<f32>, pan:vec2<f32>, angles:vec2<f32>, zoom:f32, pad:f32 };
      @group(0) @binding(0) var<uniform> params:Params;
      @group(0) @binding(1) var<storage,read_write> particles:array<Particle>;
      @group(0) @binding(2) var<storage,read> heights:array<f32>;
      @group(0) @binding(3) var<storage,read_write> state:State;
      @group(1) @binding(0) var<uniform> camera:Camera;
      @group(1) @binding(1) var<storage,read> renderParticles:array<Particle>;
      const MAX:u32=320u;
      fn terrainHeight(x:f32,y:f32)->f32 {
        let half=params.world_size*0.5; let gx=clamp((x+half)/params.world_size*f32(params.grid_w-1u),0.0,f32(params.grid_w-1u));
        let gy=clamp((y+half)/params.world_size*f32(params.grid_h-1u),0.0,f32(params.grid_h-1u));
        let ix=u32(floor(gx)); let iy=u32(floor(gy)); let jx=min(ix+1u,params.grid_w-1u); let jy=min(iy+1u,params.grid_h-1u);
        let tx=gx-f32(ix); let ty=gy-f32(iy); let a=heights[iy*params.grid_w+ix]*(1.0-tx)+heights[iy*params.grid_w+jx]*tx;
        let b=heights[jy*params.grid_w+ix]*(1.0-tx)+heights[jy*params.grid_w+jx]*tx; return a*(1.0-ty)+b*ty;
      }
      fn rand(s:ptr<function,u32>)->f32 { *s=(*s*1664525u+1013904223u); return f32(*s)/4294967296.0; }
      @compute @workgroup_size(1) fn spawnMain() {
        let dt=max(params.dt,0.0); if(params.rainfall<=0.0){state.carry=0.0;return;}
        var carry=state.carry+dt*17.0*clamp(params.rainfall,0.0,5.0); var count=u32(floor(carry)); carry-=f32(count); var rng=state.rng;
        for(var i:u32=0u;i<MAX && count>0u;i+=1u){ if(particles[i].flags.z<0.5){
          let x=(rand(&rng)*2.0-1.0)*params.world_size*0.5; let y=(rand(&rng)*2.0-1.0)*params.world_size*0.5; let g=terrainHeight(x,y); let z=g+38.0+rand(&rng)*28.0;
          particles[i].pos=vec4<f32>(x,y,z,0.0); particles[i].prev=particles[i].pos; particles[i].vel=vec4<f32>((rand(&rng)-0.5)*1.2,(rand(&rng)-0.5)*1.2,0.0,0.0);
          particles[i].flags=vec4<f32>(0.0,14.0+rand(&rng)*9.0,1.0,1.0); count-=1u;
        }} state.carry=carry; state.rng=rng;
      }
      @compute @workgroup_size(64) fn updateMain(@builtin(global_invocation_id) gid:vec3<u32>) {
        let id=gid.x; if(id>=MAX || particles[id].flags.z<0.5){return;}
        var p=particles[id]; let dt=max(params.dt,0.0); let age=p.flags.x+dt; p.prev=p.pos;
        var pos=p.pos; let ground=terrainHeight(pos.x,pos.y); var falling=p.flags.w>0.5; var v=p.vel.xy;
        if(falling){
          let damp=pow(0.995,dt*60.0); v*=damp; pos.z=pos.z-72.0*dt;
          pos=vec4<f32>(pos.x+v.x*dt,pos.y+v.y*dt,pos.z,pos.w);
          if(pos.z<=ground+0.22){pos.z=ground+0.12;falling=false;v*=0.35;}
        } else {
          let s=max(0.35,params.world_size/(f32(params.grid_w)-1.0)); let hx=(terrainHeight(pos.x+s,pos.y)-terrainHeight(pos.x-s,pos.y))/(2.0*s); let hy=(terrainHeight(pos.x,pos.y+s)-terrainHeight(pos.x,pos.y-s))/(2.0*s); v+=vec2<f32>(-hx*21.0*dt,-hy*21.0*dt);
          for(var j:u32=0u;j<MAX;j+=1u){if(j!=id && particles[j].flags.z>0.5 && particles[j].flags.w<0.5){let d=particles[j].pos.xy-pos.xy;let d2=dot(d,d);if(d2>0.0&&d2<9.0){let dlen=sqrt(d2);v-=d*((3.0-dlen)*0.035/dlen);}}}
          let speed=length(v);if(speed>16.0){v*=16.0/speed;}v*=pow(0.82,dt); pos=vec4<f32>(pos.x+v.x*dt,pos.y+v.y*dt,pos.z,pos.w); pos.z=terrainHeight(pos.x,pos.y)+0.10;
        }
        p.pos=pos; p.vel=vec4<f32>(v,0.0,0.0); p.flags=vec4<f32>(age,p.flags.y,p.flags.z,select(0.0,1.0,falling));
        if(age>p.flags.y||abs(pos.x)>params.world_size||abs(pos.y)>params.world_size){p.flags=vec4<f32>(p.flags.x,p.flags.y,0.0,p.flags.w);}particles[id]=p;
      }
      fn project(p:vec3<f32>)->vec2<f32>{let cz=cos(camera.angles.y);let sz=sin(camera.angles.y);let cx=cos(camera.angles.x);let sx=sin(camera.angles.x);let rx=p.x*cz-p.y*sz;let ry=p.x*sz+p.y*cz;return vec2<f32>(camera.viewport.x*0.5+camera.pan.x+rx*camera.zoom,camera.viewport.y*0.5+camera.pan.y+(ry*cx-p.z*sx)*camera.zoom);}
      struct RenderOut { @builtin(position) position:vec4<f32>, @location(0) color:vec4<f32> };
      @vertex fn renderVertex(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->RenderOut{let p=renderParticles[ii];let cur=project(p.pos.xyz);let prv=project(p.prev.xyz);let d=cur-prv;let len=max(length(d),1.0);let dir=d/len;let n=vec2<f32>(-dir.y,dir.x);let falling=p.flags.w>0.5;let width=select(4.40,2.30,falling);let tail=select(2.2,clamp(len*2.8,3.0,14.0),falling);let base=cur-dir*tail;var q:array<vec3<f32>,6>;q[0]=vec3<f32>(cur+n*width,1.0);q[1]=vec3<f32>(cur-n*width,1.0);q[2]=vec3<f32>(base-n*width*0.55,1.0);q[3]=q[0];q[4]=q[2];q[5]=vec3<f32>(base+n*width*0.55,1.0);let v=q[vi];var o:RenderOut;o.position=vec4<f32>(v.x/camera.viewport.x*2.0-1.0,1.0-v.y/camera.viewport.y*2.0,0.0,1.0);o.color=vec4<f32>(0.40,0.78,1.0,select(max(0.05,0.34*(1.0-max(0.0,p.flags.x-8.0)/15.0)),0.42,falling)*p.flags.z);return o;}
      @fragment fn renderFragment(v:RenderOut)->@location(0) vec4<f32>{return v.color;}
