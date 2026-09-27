// 降水粒子公共定义（compute + render 共用；Rust 侧 concat 拼成单个 WGSL 模块下发）。
//
// ★ v1.64.0：粒子物理（生成 / 下落 / 下坡流动 / 邻域力 / 蒸发）已由 Rust 内核迁出，
// 改由本模块的 compute 入口在 GPU 上以 3D 固定网格空间哈希推进；Rust 只保留配置契约
// （交互力求根 + 物理常数）与 shader 导出。粒子状态为纯表现层，不进快照 / 存档。

struct Particle {
  pos:  vec4<f32>,  // x, y, z, age
  vel:  vec4<f32>,  // vx, vy, vz, max_age
  prev: vec4<f32>,  // prev_x, prev_y, prev_z, 保留
  misc: vec4<f32>,  // alive(0/1), falling(0/1), 保留, 保留
};

struct SimState {
  alive:   atomic<u32>,
  freeTop: atomic<i32>,
  // 间接绘制参数（`drawIndirect` 从该缓冲区字节偏移 8 处读取）：[36, 存活数, 0, 0]
  drawArgs: array<u32, 4>,
};

struct RainParams {
  worldSize: f32,
  gridW: f32,
  gridH: f32,
  dt: f32,

  gravity: f32,
  spawnHeightBase: f32,
  spawnHeightRand: f32,
  spawnSpeed: f32,

  maxAgeBase: f32,
  maxAgeRand: f32,
  fallDamp: f32,
  landClearance: f32,

  groundRestLift: f32,
  flowRestLift: f32,
  flowAccel: f32,
  flowSpeedMax: f32,

  flowDamp: f32,
  gradientMinStep: f32,
  attractA: f32,
  repelR: f32,

  forceScale: f32,
  reachFar: f32,
  minX: f32,
  minY: f32,

  minZ: f32,
  cellSizeX: f32,
  cellSizeY: f32,
  cellSizeZ: f32,

  gridX: u32,
  gridY: u32,
  gridZ: u32,
  maxParticles: u32,

  spawnCount: u32,
  spawnSeed: u32,
  stepSeq: u32,
  forceValid: u32,

  neighborCap: u32,
  numCells: u32,
  pad0: u32,
  pad1: u32,
};

struct Camera { viewport: vec2<f32>, pan: vec2<f32>, angles: vec2<f32>, zoom: f32, cubeHalf: f32 };

// ── compute 绑定 0..8（1 uniform + 8 storage；默认 maxStorageBuffersPerShaderStage = 8）──
// cellCounterBuf 前 numCells 段 = 单元计数，后 numCells 段 = 散布游标（= 各段起点）。
@group(0) @binding(0) var<uniform> params: RainParams;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> terrain: array<f32>;
@group(0) @binding(3) var<storage, read_write> cellCounterBuf: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> cellOffsets: array<u32>;
@group(0) @binding(5) var<storage, read_write> particleCell: array<u32>;
@group(0) @binding(6) var<storage, read_write> sortedIdx: array<u32>;
@group(0) @binding(7) var<storage, read_write> freeStack: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> simState: SimState;

// ── render 绑定 9..11（只读视图；顶点阶段不允许 read_write 存储）──
@group(0) @binding(9)  var<uniform> camera: Camera;
@group(0) @binding(10) var<storage, read> renderParticles: array<Particle>;
@group(0) @binding(11) var<storage, read> renderOrder: array<u32>;