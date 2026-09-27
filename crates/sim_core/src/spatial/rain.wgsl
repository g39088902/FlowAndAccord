// 降水粒子渲染 shader（纯渲染）。
// 粒子物理（生成 / 下落 / 下坡流动 / 斥力 / 蒸发）已由 Rust 在 `world_tick` 中
// 确定性推进，并经快照下发；前端每帧把粒子状态写入 storage buffer，本 shader
// 只做投影与绘制。不再包含任何 compute 入口或墙钟驱动的模拟。
//
// 每个粒子绘制为一个**立方体**：8 个世界空间角点经 `project` 投影后组成 6 个面
// （36 个顶点 / 实例），逐面乘一个固定明暗系数以呈现立体感（顶面最亮、侧面次之、
// 底面最暗）。投影为仿射变换，故立方体在斜视角下呈等轴测方块。
struct Particle { pos:vec4<f32>, prev:vec4<f32>, flags:vec4<f32> };
// cubeHalf = 立方体半边长（世界单位，边长 = 2 × cubeHalf），由前端 RENDER_CONFIG.rainCubeHalf 逐帧传入。
struct Camera { viewport:vec2<f32>, pan:vec2<f32>, angles:vec2<f32>, zoom:f32, cubeHalf:f32 };
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var<storage,read> renderParticles:array<Particle>;

// 8 个角点（单位立方体，符号位 = x/y/z 轴）。
const CORN: array<vec3<f32>,8> = array<vec3<f32>,8>(
  vec3<f32>(-1.0,-1.0,-1.0), vec3<f32>(1.0,-1.0,-1.0), vec3<f32>(1.0,1.0,-1.0), vec3<f32>(-1.0,1.0,-1.0),
  vec3<f32>(-1.0,-1.0,1.0), vec3<f32>(1.0,-1.0,1.0), vec3<f32>(1.0,1.0,1.0), vec3<f32>(-1.0,1.0,1.0));
// 6 个面 × 2 三角形 × 3 顶点：依次为 +Z / -Z / +X / -X / +Y / -Y。
const FACE: array<u32,36> = array<u32,36>(
  4u,5u,6u, 4u,6u,7u,
  0u,3u,2u, 0u,2u,1u,
  1u,2u,6u, 1u,6u,5u,
  0u,4u,7u, 0u,7u,3u,
  3u,7u,6u, 3u,6u,2u,
  0u,1u,5u, 0u,5u,4u);
// 逐面明暗系数（顶=+Z 最亮，底=-Z 最暗）。
const SHADE: array<f32,6> = array<f32,6>(1.0, 0.5, 0.80, 0.80, 0.60, 0.60);

fn project(p:vec3<f32>)->vec2<f32>{
  let cz=cos(camera.angles.y);let sz=sin(camera.angles.y);let cx=cos(camera.angles.x);let sx=sin(camera.angles.x);
  let rx=p.x*cz-p.y*sz;let ry=p.x*sz+p.y*cz;
  return vec2<f32>(camera.viewport.x*0.5+camera.pan.x+rx*camera.zoom,camera.viewport.y*0.5+camera.pan.y+(ry*cx-p.z*sx)*camera.zoom);
}

struct RenderOut { @builtin(position) position:vec4<f32>, @location(0) color:vec4<f32> };
@vertex fn renderVertex(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->RenderOut{
  let p=renderParticles[ii];
  let face=vi/6u;
  let corner=FACE[vi];
  let s=project(p.pos.xyz+CORN[corner]*camera.cubeHalf);
  let falling=p.flags.w>0.5;
  // 寿命已延长 8 倍，淡出窗口同步 ×8（否则粒子会在 23s 后长期不可见却仍占槽位）。
  let fade=max(0.05,0.34*(1.0-max(0.0,p.flags.x-64.0)/120.0));
  let alpha=select(fade,0.42,falling)*p.flags.z;
  let shade=SHADE[face];
  var o:RenderOut;
  o.position=vec4<f32>(s.x/camera.viewport.x*2.0-1.0,1.0-s.y/camera.viewport.y*2.0,0.0,1.0);
  o.color=vec4<f32>(0.40*shade,0.78*shade,1.0*shade,alpha);
  return o;
}
@fragment fn renderFragment(v:RenderOut)->@location(0) vec4<f32>{return v.color;}