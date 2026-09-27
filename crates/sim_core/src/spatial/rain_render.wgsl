// 降水粒子渲染入口（纯渲染，样式与迁移前逐位保持一致）。
// 每个粒子绘制为一个世界空间立方体：8 个角点经 project 投影后组成 6 个面
// （36 顶点 / 实例），逐面乘固定明暗系数（顶面最亮、侧面次之、底面最暗）。
// 实例列表由 compute 侧的 sortedIdx（稠密存活列表）经 drawArgs 间接绘制驱动。

const CORN: array<vec3<f32>, 8> = array<vec3<f32>, 8>(
  vec3<f32>(-1.0, -1.0, -1.0), vec3<f32>(1.0, -1.0, -1.0), vec3<f32>(1.0, 1.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0),
  vec3<f32>(-1.0, -1.0, 1.0), vec3<f32>(1.0, -1.0, 1.0), vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(-1.0, 1.0, 1.0));
const FACE: array<u32, 36> = array<u32, 36>(
  4u, 5u, 6u, 4u, 6u, 7u,
  0u, 3u, 2u, 0u, 2u, 1u,
  1u, 2u, 6u, 1u, 6u, 5u,
  0u, 4u, 7u, 0u, 7u, 3u,
  3u, 7u, 6u, 3u, 6u, 2u,
  0u, 1u, 5u, 0u, 5u, 4u);
const SHADE: array<f32, 6> = array<f32, 6>(1.0, 0.5, 0.80, 0.80, 0.60, 0.60);

fn project(p: vec3<f32>) -> vec2<f32> {
  let cz = cos(camera.angles.y);
  let sz = sin(camera.angles.y);
  let cx = cos(camera.angles.x);
  let sx = sin(camera.angles.x);
  let rx = p.x * cz - p.y * sz;
  let ry = p.x * sz + p.y * cz;
  return vec2<f32>(
    camera.viewport.x * 0.5 + camera.pan.x + rx * camera.zoom,
    camera.viewport.y * 0.5 + camera.pan.y + (ry * cx - p.z * sx) * camera.zoom);
}

struct RenderOut { @builtin(position) position: vec4<f32>, @location(0) color: vec4<f32> };

@vertex
fn renderVertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> RenderOut {
  let pi = renderOrder[ii];
  let p = renderParticles[pi];
  let face = vi / 6u;
  let corner = FACE[vi];
  let s = project(p.pos.xyz + CORN[corner] * camera.cubeHalf);
  let falling = p.misc.y > 0.5;
  // 寿命淡出窗口（与迁移前同口径）。
  let fade = max(0.05, 0.34 * (1.0 - max(0.0, p.pos.w - 64.0) / 120.0));
  let alpha = select(fade, 0.42, falling);
  let shade = SHADE[face];
  var o: RenderOut;
  o.position = vec4<f32>(s.x / camera.viewport.x * 2.0 - 1.0, 1.0 - s.y / camera.viewport.y * 2.0, 0.0, 1.0);
  o.color = vec4<f32>(0.40 * shade, 0.78 * shade, 1.0 * shade, alpha);
  return o;
}

@fragment
fn renderFragment(v: RenderOut) -> @location(0) vec4<f32> {
  return v.color;
}