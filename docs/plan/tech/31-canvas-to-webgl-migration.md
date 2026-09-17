# Flow & Accord · Canvas 2D → WebGL 迁移方案 (Phased Migration Plan)

> **文档状态**: ★ **目标形态已定**（2026-09-17）：**全量 WebGL 渲染，不再使用 Canvas 2D**——阶段三~五（装饰层 / 实体层 / Canvas 2D 退役）由「未实施」转为**既定路线**。阶段一/二已落地 (v1.50.77 双 Canvas 架构上线：地形由 `frontend/js/webgl/` 绘制于底层 `sim-canvas-gl`，实体/装饰仍在 Canvas 2D 覆盖层 `sim-canvas`；v1.50.80~82 帧率解限)，双 Canvas 为**过渡形态**。 | **创建日期**: 2026-09-17 | **影响范围**: 前端渲染层
> **修订历史**: v1.0 - 初始版本，细化阶段一 (基础框架) 与阶段二 (地形层迁移)；v2.0 (2026-09-17) - 架构决策落定：全量 WebGL 为目标形态，补充阶段三~五正式方案，取消 2D 回退为长期能力，TA-08 覆盖层近似策略作废；v2.1 (2026-09-17) TA-08 任务删除并视为完成，其 §2 验收矩阵并入本文 §8.5
> **落地口径**: 阶段一/二的实现以 [frontend/AGENTS.md](../../../frontend/AGENTS.md) 与 `docs/current/` 现状文档为准（实际文件结构较本文示例有出入）；阶段三~五为在办方案，实施后须同步刷新 `docs/current/`。

---

## 📋 目录

- [1. 现状分析](#1-现状分析)
- [2. 迁移目标](#2-迁移目标)
- [3. 技术选型](#3-技术选型)
- [4. 总体架构](#4-总体架构)
- [5. 阶段一：基础框架搭建](#5-阶段一基础框架搭建)
- [6. 阶段二：地形层迁移](#6-阶段二地形层迁移)
- [7. 性能门禁与验收标准](#7-性能门禁与验收标准)
- [8. 阶段三~五：全量 WebGL 迁移（装饰层 / 实体层 / Canvas 退役）](#8-阶段三五全量-webgl-迁移装饰层--实体层--canvas-退役)
- [9. 风险评估与缓解策略](#9-风险评估与缓解策略)

---

## 1. 现状分析

### 1.1 当前渲染瓶颈

**Canvas 2D 绘制开销分解** (基于 `render_canvas.js` 主循环):

```
每帧 Draw Calls: ~800-1200
├── 地形格填充      ~450 calls  (60×60 网格视口内可见约 450 格)
├── 装饰图元        ~300 calls  (树 ~180 + 灌木 ~80 + 岩石 ~40)
├── 道路分段        ~100 calls  (平均路面分段)
├── POI/房屋        ~30 calls   (20 POI + ~10 房屋)
└── 族人与特效      ~20 calls   (20 族人 + 粒子特效)

状态切换开销:
├── fillStyle/color 设置 ~1500 次
├── beginPath/fill/stroke 组合调用 ~800 次
└── globalAlpha/scatter 设置 ~200 次
```

**GC 压力来源**:

```javascript
// render_terrain.js::drawTerrainCell - 每帧分配
ctx.beginPath();              // 路径对象
ctx.lineTo(...);              // 多次方法调用
ctx.closePath();              // 完成路径
ctx.fill();                   // 光栅化
// → 单格产生 ~5-10 个临时对象，450 格 = ~2000-4000 对象/帧
```

**关键发现**:
1. 地形层占整体开销的 **40%+**,且几何规整适合批量优化
2. 装饰层图元多但形态各异，优化空间中等
3. 大量小路径绘制是 GC 压力的主要来源

### 1.2 现有架构特征

**深度队列系统** (`render_depth_queue.js`):
```javascript
const DEPTH_CELL = 0;      // 地形格
const DEPTH_ACCENT = 9;    // 地表装饰
const DEPTH_AGENT = 10;    // 族人
// ...按相机深度升序 (远→近) 排序，维持画家算法
```

**投影变换** (`math.js`):
```javascript
// 世界坐标 → 屏幕坐标
function project3D({x, y, z}) {
  const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
  const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
  const rx = x * cosZ - y * sinZ;
  const ry = x * sinZ + y * cosZ;
  const y2 = ry * cosX - z * sinX;
  return {
    x: w/2 + camera.panX + rx * camera.zoom,
    y: h/2 + camera.panY + y2 * camera.zoom,
    depth: ry * sinX + z * cosX  // 相机深度
  };
}
```

**投影缓冲池** (已存在的零分配优化):
```javascript
let terrainProjX = new Float32Array(3600);
let terrainProjY = new Float32Array(3600);
```

---

## 2. 迁移目标

### 2.1 功能目标

| 目标 | 指标 | 验证方式 |
|------|------|----------|
| **画面一致性** | 像素级差异 < 1% | 同种子/同配置截图对比 |
| **帧率提升** | ≥50% (复杂场景) | `tools/profile-benchmark.js` |
| **GC 频率降低** | ≥60% | Chrome DevTools Performance 面板 |
| **内存增长** | < 20% | WASM 内存 + GPU 显存总计 |
| **加载时间** | 无显著增加 | 首屏到可交互时间 |

### 2.2 非功能目标

- **零依赖**: 纯 WebGL API，不引入 Three.js/Babylon.js 等库
- **渐进式迁移**: 每个阶段独立可回退，不影响其他部分
- **单一渲染管线（★ v2.0 定稿）**: 迁移终点为**全部内容（地形 / 装饰 / 实体 / 道路 / 标签 / 特效）纳入同一 WebGL 管线**，共享一个深度缓冲；**不再保留 Canvas 2D 作为渲染器或长期降级路径**。WebGL 不可用时给出明确不支持提示，不做 2D 降级（过渡期例外见 §9.2）
- **确定性保持**: 不影响 WASM 内核的逐字节确定性承诺
- **遮挡口径变更（★ v2.0 定稿）**: 跨实体遮挡由 GPU 深度缓冲逐像素解决，Canvas 2D 覆盖层的近似排序/拆分/兜底策略（原 TA-08 策略 A/B/C）**全部取消**；选中对象被遮挡时改由「关深度测试的描边 pass + 叶簇半透明」实现，验收矩阵见 §8.5（原 TA-08 §2 并入；TA-08 任务已删除视为完成）

---

## 3. 技术选型

### 3.1 WebGL vs WebGPU

| 维度 | WebGL 2 | WebGPU | 选择理由 |
|------|---------|--------|---------|
| 浏览器支持 | ✅ 95%+ | ⚠️ 受限 | WebGL 成熟度高 |
| 学习曲线 | ✅ 平缓 | ❌ 陡峭 | 团队零 WebGPU 经验 |
| 工具链 | ✅ 完善 | ⚠️ 发展中 | CTS/调试器成熟 |
| 复杂度 | ✅ 可控 | ❌ 高 | WebGPU 设备抽象层复杂 |
| 本需求收益 | ✅ 足够 | ⚠️ 过度设计 | 本项目无需 Ray Tracing 等高级特性 |

**结论**: **WebGL 2** (fallback to WebGL 1 via extensions)

### 3.2 Shader 管理策略

```typescript
// 构建时编译而非运行时 (避免 runtime compile 开销)
// tools/build-shaders.ts
import fs from 'fs';

const shaders = {
  'terrain.vert': fs.readFileSync('frontend/js/webgl/shaders/terrain.vert', 'utf-8'),
  'terrain.frag': fs.readFileSync('frontend/js/webgl/shaders/terrain.frag', 'utf-8'),
};

console.log(`export const SHADER_SOURCE = ${JSON.stringify(shaders)}`);
```

**优势**:
- 开发时可热重载 (读取文件系统)
- 生产环境打包进 bundle (减少 HTTP 请求)

### 3.3 批量化策略

**实例化渲染 (Instanced Rendering)** - 优先采用:
```glsl
// 单一 draw call 绘制 N 个相同 mesh
gl.drawArraysInstanced(GL.TRIANGLES, 0, vertexCount, instanceCount);
```

**顶点索引缓冲 (VBO/EBO)** - 地形层必选:
```javascript
// 合并相邻 quad 为单个 buffer
const vertices = new Float32Array([
  // Quad 1: 顶点 A,B,C,D
  ...coordsA, ...elevA, ...colorA,
  ...coordsB, ...elevB, ...colorB,
  ...
]);
```

**纹理图集 (Texture Atlas)** - 装饰层可选:
```
预设尺寸：256×256 / 512×512
内容：树皮纹理 / 叶簇颜色 palettes / 岩石材质
```

---

## 4. 总体架构

### 4.1 分层架构

```
frontend/js/webgl/
├── core/
│   ├── context.js          # WebGL 上下文封装 (+ fallback 检测)
│   ├── shader-manager.js   # Shader 编译 + 链接 + uniform 缓存
│   ├── buffer-pool.js      # VBO/EBO 对象池 (零分配复用)
│   └── texture-cache.js    # 纹理缓存 + atlas 管理
│
├── layers/
│   ├── terrain/
│   │   ├── renderer.js     # 地形批处理 + instancing
│   │   ├── batcher.js      # CPU 侧 batch 生成
│   │   └── shaders/
│   │       ├── vert.glsl
│   │       └── frag.glsl
│   │
│   ├── accents/
│   │   ├── renderer.js     # 装饰 instancing
│   │   ├── model-cache.js  # 几何缓存
│   │   └── shaders/
│   │
│   └── agents/
│       └── renderer.js     # 族人骨骼动画
│
├── utils/
│   ├── projection-utils.js # 矩阵运算补充 (camera matrix)
│   └── depth-sort.js       # 复用现有深度队列逻辑
│
└── api/
    ├── render-layer-compat.js  # Canvas2D ↔ WebGL 统一接口
    └── fallback-handler.js     # 降级控制
```

### 4.2 与现有系统集成

> ★ **v2.0 口径**：下图为**过渡期**（阶段一~四）形态。目标形态（阶段五后）为单一路径：`rustworld.js::sim` → WebGL Renderer → Canvas Element，`Canvas2D Renderer` / `Fallback Handler` 两个分支整体删除（见 §8.3）。

**数据流（过渡期）**:
```
rustworld.js::sim
  │
  ├─→ sim.terrain.cells[] ──────────────┐
  ├─→ sim.pois[]                        │
  ├─→ sim.houses[]                      │
  ├─→ sim.agents[]                      │
  └─→ sim.clans[] / sim.regions[]       │
                                        ↓
                  frontend/js/render_depth_queue.js
                           │
         ┌─────────────────┼─────────────────┐
         ↓                 ↓                 ↓
   Canvas2D Renderer  WebGL Renderer  Fallback Handler
         │                 │                 │
         └─────────────────┴─────────────────┘
                              │
                              ↓
                         Canvas Element
```

**混合渲染模式（过渡期，阶段五删除）**:
```javascript
// frontend/js/webgl/fallback-handler.js
class RenderFallbackManager {
  constructor() {
    this.enabled = !!window.USE_WEBGL && this.detectSupport();
    this.currentMode = 'auto'; // 'webgl' | 'canvas2d' | 'auto'
  }
  
  detectSupport() {
    const canvas = document.querySelector('#main-canvas');
    const gl = canvas.getContext('webgl2');
    return !!(gl && gl.getExtension('INSTANCED_ARRAY'));
  }
  
  renderFrame(now) {
    if (!this.enabled || this.currentMode === 'canvas2d') {
      canvasRender.now(now);  // 现有 Canvas 2D
    } else if (this.currentMode === 'webgl') {
      webglRenderer.render(now);
    } else {
      // auto: 根据负载动态选择
      if (getEstimatedDrawCalls() > 500) {
        webglRenderer.render(now);
      } else {
        canvasRender.now(now);
      }
    }
  }
}
```

### 4.3 深度队列兼容性

**过渡期原则（阶段一~二）**: 保持现有深度排序逻辑，仅改变绘制后端

```javascript
// frontend/js/render_depth_queue.js (保持不变)
// ...depth sorting logic...

// 新接口：分发到不同后端
function dispatchToBackend(item) {
  if (window.USE_WEBGL && isSupported(item.kind)) {
    webglRenderer.submit(item);
  } else {
    canvasRenderer.submit(item);
  }
}

// 所有图元的 draw* 函数保持不变，由 backend 选择执行哪个实现
```

> ★ **v2.0（2026-09-17）口径修正**：上文的「双后端分发」只是阶段一~二把地形先搬上 GPU 的过渡手段。**目标形态下 `drawWorldEntities()` 的画家算法深度队列不再是遮挡判据**——遮挡由 GPU 深度缓冲承担，深度队列退化为：① 不透明批次的前后提交顺序（性能优化，不影响正确性）；② 透明批次（叶簇、水面）的 CPU 侧排序依据。阶段三~五完成后 `canvasRenderer.submit` 分支随 2D 覆盖层一并删除，`dispatchToBackend` 收敛为单一 WebGL 提交路径（见 §8）。

---

## 5. 阶段一：基础框架搭建

**工期**: 1 周 | **风险**: 低 | **优先级**: ⭐⭐⭐

### 5.1 阶段一目标

✅ 建立可用的 WebGL 渲染基础设施  
✅ 能绘制简单几何体测试 pipeline  
✅ 提供 Canvas 2D ↔ WebGL 无缝切换能力  
❌ 暂不追求极致性能优化  

### 5.2 详细实施步骤

#### Step 1.1: 项目初始化 (Day 1)

**文件结构创建**:
```bash
mkdir -p frontend/js/webgl/core
mkdir -p frontend/js/webgl/layers/terrain/shaders
mkdir -p frontend/js/webgl/layers/accents/shaders
mkdir -p frontend/js/webgl/utils
```

**新建核心文件**:

**`frontend/js/webgl/core/context.js`**:
```javascript
// === WebGL 上下文管理 (阶段一产出) ===
// 职责：WebGL 上下文创建、能力探测、错误处理、fallback 决策

class WebGLContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.supported = false;
    this.version = 'unknown';
    
    this.init();
  }
  
  init() {
    try {
      // 尝试 WebGL 2
      this.gl = this.canvas.getContext('webgl2', {
        antialias: false,
        depth: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
      });
      
      if (!this.gl) {
        console.warn('[WebGL] WebGL2 not available, trying WebGL 1');
        // 降级 WebGL 1
        this.gl = this.canvas.getContext('webgl', {
          antialias: false,
          desynchronized: true
        });
        
        if (!this.gl) {
          throw new Error('No WebGL context available');
        }
        
        this.version = '1.0';
        this.checkExtensions1();
      } else {
        this.version = '2.0';
        this.supported = true;
      }
      
      // 记录设备信息
      const debugInfo = this.gl.getParameter(this.gl.DEBUG_RENDERER_INFO);
      this.vendor = debugInfo ? debugInfo[0] : 'unknown';
      this.renderer = debugInfo ? debugInfo[1] : 'unknown';
      
      console.log(`[WebGL] Initialized: ${this.version} on ${this.vendor}/${this.renderer}`);
      
    } catch (e) {
      console.error('[WebGL] Initialization failed:', e);
      this.gl = null;
      this.supported = false;
    }
  }
  
  checkExtensions1() {
    // WebGL 1 必需扩展
    const required = [
      'OES_vertex_array_object',      // VAO 支持
      'EXT_color_buffer_float',       // 浮点帧缓冲
      'ANGLE_instanced_arrays',       // Instancing
    ];
    
    for (const ext of required) {
      const supported = !!this.gl.getExtension(ext);
      console.log(`[WebGL 1] Extension ${ext}: ${supported ? '✓' : '✗'}`);
      if (!supported && ext === 'ANGLE_instanced_arrays') {
        this.supported = false;
      }
    }
  }
  
  isReady() {
    return this.supported && !!this.gl;
  }
  
  get GL() {
    return this.gl;
  }
}

// 全局实例
window.webglContext = null;
```

**`frontend/js/webgl/core/shader-manager.js`**:
```javascript
// === Shader 编译器与管理器 (阶段一产出) ===
// 职责：编译 GLSL → 链接程序、uniform 位置缓存

class ShaderManager {
  constructor(gl) {
    this.gl = gl;
    this.programs = new Map();
    this.uniformCache = new Map();
  }
  
  async compileShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`Shader compile error:\n${info}`);
    }
    
    return shader;
  }
  
  async loadProgram(vertexSrc, fragmentSrc) {
    const key = `vert:${vertexSrc.length}-frag:${fragmentSrc.length}`;
    
    if (this.programs.has(key)) {
      return this.programs.get(key);
    }
    
    const vs = await this.compileShader(this.gl.VERTEX_SHADER, vertexSrc);
    const fs = await this.compileShader(this.gl.FRAGMENT_SHADER, fragmentSrc);
    
    const program = this.gl.createProgram();
    this.gl.attachShader(program, vs);
    this.gl.attachShader(program, fs);
    this.gl.linkProgram(program);
    
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(program);
      this.gl.deleteProgram(program);
      throw new Error(`Program link error:\n${info}`);
    }
    
    // 缓存 uniform 位置
    this.cacheUniforms(program);
    
    this.programs.set(key, program);
    return program;
  }
  
  cacheUniforms(program) {
    const count = this.gl.getProgramParameter(program, this.gl.ACTIVE_UNIFORMS);
    const locations = {};
    
    for (let i = 0; i < count; i++) {
      const uniform = this.gl.getActiveUniform(program, i);
      const name = uniform.name.split('.')[0]; // Handle arrays
      locations[name] = this.gl.getUniformLocation(program, uniform.name);
    }
    
    this.uniformCache.set(program, locations);
  }
  
  getUniformLocation(program, name) {
    const cache = this.uniformCache.get(program);
    return cache ? cache[name] : null;
  }
}
```

**`frontend/js/webgl/utils/projection-utils.js`**:
```javascript
// === 投影矩阵工具函数 ===
// 补充 math.js 中的投影逻辑，生成 WebGL 友好的矩阵

class ProjectionUtils {
  /**
   * 生成透视投影矩阵 (WebGL 风格：z∈[-1,1])
   */
  static perspective(fov, aspect, near, far) {
    const f = 1.0 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    
    return new Float32Array([
      f / aspect,  0,            0,            0,
      0,           f,            0,            0,
      0,           0, (far + near) * nf, 2 * far * nf,
      0,           0,           -1,            0
    ]);
  }
  
  /**
   * 生成视图矩阵 (简化版：仅旋转和平移)
   */
  static lookAt(cam, target = {x: 0, y: 0, z: 0}) {
    const fwd = {
      x: cam.x - target.x,
      y: cam.y - target.y,
      z: cam.z - target.z
    };
    const fwdLen = Math.hypot(fwd.x, fwd.y, fwd.z);
    fwd.x /= fwdLen; fwd.y /= fwdLen; fwd.z /= fwdLen;
    
    const right = {
      y: fwd.z,
      x: fwd.y,
      z: -fwd.x
    };
    const rightLen = Math.hypot(right.x, right.y, right.z);
    right.x /= rightLen; right.y /= rightLen; right.z /= rightLen;
    
    const up = {
      x: right.y * fwd.z - right.z * fwd.y,
      y: right.z * fwd.x - right.x * fwd.z,
      z: right.x * fwd.y - right.y * fwd.x
    };
    
    return new Float32Array([
      right.x,  up.x,  -fwd.x,  0,
      right.y,  up.y,  -fwd.y,  0,
      right.z,  up.z,  -fwd.z,  0,
      -(right.x * cam.x + right.y * cam.y + right.z * cam.z),
      -(up.x * cam.x + up.y * cam.y + up.z * cam.z),
      -(-fwd.x * cam.x - fwd.y * cam.y - fwd.z * cam.z),
      1, 1, 1, 1
    ]);
  }
  
  /**
   * 生成仿射矩阵 (平移/缩放)
   */
  static translate(x, y, z) {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1
    ]);
  }
  
  static scale(s) {
    return new Float32Array([
      s, 0, 0, 0,
      0, s, 0, 0,
      0, 0, s, 0,
      0, 0, 0, 1
    ]);
  }
}
```

#### Step 1.2: 简单测试场景 (Day 2-3)

**测试网格绘制** (`frontend/js/webgl/layers/terrain/test-grid.js`):
```javascript
// === 地形网格测试渲染器 (阶段一 PoC) ===

class TestGridRenderer {
  constructor(webglCtx) {
    this.gl = webglCtx.gl;
    this.manager = new ShaderManager(this.gl);
    this.vao = null;
    this.vbo = null;
  }
  
  async init() {
    // 编译 shader
    const vsSource = `#version 300 es
      in vec2 a_position;
      in float a_elev;
      uniform mat4 u_model;
      uniform mat4 u_projection;
      out vec3 v_color;
      void main() {
        vec4 pos = u_projection * u_model * vec4(a_position, a_elev, 1.0);
        gl_Position = pos;
        v_color = mix(vec3(0.3, 0.6, 0.3), vec3(0.5, 0.4, 0.2), a_elev / 20.0);
      }
    `;
    
    const fsSource = `#version 300 es
      precision mediump float;
      in vec3 v_color;
      out vec4 outColor;
      void main() {
        outColor = vec4(v_color, 1.0);
      }
    `;
    
    const program = await this.manager.loadProgram(vsSource, fsSource);
    this.gl.useProgram(program);
    
    // 创建简单网格 geometry (5×5 格子)
    this.createGridGeometry();
  }
  
  createGridGeometry() {
    // 每个 quad 6 顶点 (2 triangles)
    const size = 60;
    const count = 25; // 5×5 grid
    
    const vertices = [];
    for (let i = 0; i < count; i++) {
      const x = (i % 5) * size - size;
      const z = Math.floor(i / 5) * size - size;
      const elev = Math.sin(x * 0.02) * Math.cos(z * 0.02) * 3;
      
      // Quad vertices
      const dx = size / 2;
      vertices.push(
        x - dx, z - dx, elev,
        x + dx, z - dx, elev,
        x - dx, z + dx, elev,
        x + dx, z + dx, elev
      );
    }
    
    // VBO
    this.vbo = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.STATIC_DRAW);
    
    // Attribute layout: 3 floats per vertex (x, z, elev)
    const stride = 3 * 4;
    const positionLoc = this.gl.getAttribLocation(this.gl.program, 'a_position');
    this.gl.vertexAttribPointer(positionLoc, 2, this.gl.FLOAT, false, stride, 0);
    this.gl.enableVertexAttribArray(positionLoc);
    
    const elevLoc = this.gl.getAttribLocation(this.gl.program, 'a_elev');
    this.gl.vertexAttribPointer(elevLoc, 1, this.gl.FLOAT, false, stride, 2 * 4);
    this.gl.enableVertexAttribArray(elevLoc);
  }
  
  render(projectionMatrix, viewMatrix) {
    this.gl.useProgram(this.manager.programs.values().next().value);
    
    // Uniforms
    const projLoc = this.manager.getUniformLocation(this.gl.program, 'u_projection');
    const modelLoc = this.manager.getUniformLocation(this.gl.program, 'u_model');
    
    this.gl.uniformMatrix4fv(projLoc, false, projectionMatrix);
    this.gl.uniformMatrix4fv(modelLoc, false, viewMatrix);
    
    // Draw
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 5 * 6); // 25 quads × 6 verts
  }
}
```

**集成到主循环** (`frontend/js/render_canvas.js`):
```javascript
// 在文件开头添加
let webglTestRenderer = null;

// 在主循环 render(now) 开头
function render(now) {
  requestAnimationFrame(render);
  
  // ★ 阶段一集成点：检测 WebGL 并初始化测试渲染器
  if (window.USE_WEBGL && !webglTestRenderer && window.webglContext?.isReady()) {
    const canvas = document.querySelector('#main-canvas');
    webglTestRenderer = new TestGridRenderer(window.webglContext);
    webglTestRenderer.init().then(() => {
      console.log('[WebGL] Test renderer ready');
    }).catch(e => {
      console.error('[WebGL] Test renderer failed:', e);
    });
  }
  
  // 无头模式检查
  if (sim.headless) return;
  
  w = window.innerWidth;
  h = window.innerHeight;
  
  // ★ 混合渲染模式
  if (webglTestRenderer && !sim.isPaused) {
    // WebGL 模式
    const gl = window.webglContext.GL;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.4, 0.6, 0.8, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // 计算投影矩阵 (简化：正交投影)
    const aspect = w / h;
    const fov = 1.0;
    const near = 0.1;
    const far = 200.0;
    const projMatrix = ProjectionUtils.perspective(fov, aspect, near, far);
    const viewMatrix = ProjectionUtils.lookAt({x: 0, y: 0, z: 50});
    
    webglTestRenderer.render(projMatrix, viewMatrix);
  } else {
    // 原有 Canvas 2D 代码
    ctx.clearRect(0, 0, w, h);
    drawSkyBackdrop();
    drawTerrainShell();
    // ...
  }
  
  // ... 其余主循环代码不变
}
```

#### Step 1.3: 配置与开关 (Day 4)

**修改 `config.render.js`**:
```javascript
// 新增 WebGL 配置区段
window.RENDER_CONFIG = {
  // ... existing config ...
  
  // ★ WebGL 渲染开关
  useWebgl: (() => {
    // 默认开启，可通过 URL 参数覆盖
    const params = new URLSearchParams(window.location.search);
    return params.get('webgl') !== '0';
  })(),
  
  // WebGL 调试选项 (后续阶段启用)
  webglDebug: {
    enableBatchStats: true,  // 打印 batching 统计
    enableFrametime: true,   // GPU frametime 测量
  },
};
```

**修改 `index.html`** (添加加载顺序):
```html
<!-- 在现有 script tags 末尾添加 -->
<script src="js/webgl/core/context.js"></script>
<script src="js/webgl/core/shader-manager.js"></script>
<script src="js/webgl/utils/projection-utils.js"></script>
<script src="js/webgl/layers/terrain/test-grid.js"></script>
<script src="js/webgl/fallback-handler.js"></script>

<!-- 然后才是现有 render_canvas.js -->
<script src="js/render_canvas.js"></script>
```

**全局初始化** (`frontend/js/main.js`):
```javascript
// 在 file 顶部
window.USE_WEBGL = window.RENDER_CONFIG?.useWebgl !== false;

// 在 initialize() 中
function initialize() {
  // ... 现有初始化代码 ...
  
  // ★ 阶段一新增：初始化 WebGL 上下文 (懒加载)
  const canvas = document.querySelector('#main-canvas');
  if (window.USE_WEBGL) {
    window.webglContext = new WebGLContext(canvas);
    
    if (!window.webglContext.isReady()) {
      console.warn('[WebGL] Disabled due to lack of support');
      window.USE_WEBGL = false;
    }
  }
  
  // ...
}
```

### 5.3 阶段一验收标准

| 测试项 | 预期结果 | 验证方法 |
|--------|---------|---------|
| **背景检测** | WebGL 可用即显示 log | Console 输出 |
| **简单网格** | 5×5 绿色/棕色渐变网格 | 视觉检查 |
| **Camera 控制** | 滚轮缩放/右键拖拽有效 | 交互测试 |
| **Fallback** | WebGL 不可用时回退 Canvas 2D | 模拟不支持环境 |
| **URL 开关** | `?webgl=0` 禁用 WebGL | URL 参数测试 |

**PoC 演示效果**:
```
Canvas: 纯色背景
WebGL: 5×5 网格，草地色平坦区域，山地色凸起部分
Interaction: 鼠标控制视角旋转和缩放
```

---

## 6. 阶段二：地形层迁移

**工期**: 2 周 | **风险**: 中 | **优先级**: ⭐⭐⭐⭐⭐

### 6.1 阶段二目标

✅ 完整迁移 `render_terrain.js` 至 WebGL  
✅ 实现地形格批量 batching (同色 quad 合并)  
✅ 保留深度队列调度逻辑  
✅ 画面一致性验证 (像素级对比)  
✅ 性能基准对比 (FPS/GC/内存)

### 6.2 详细实施步骤

#### Step 2.1: Shader 设计与编译 (Week 1, Day 1)

**地形顶点着色器** (`frontend/js/webgl/layers/terrain/shaders/terrain.vert`):
```glsl
// === Terrain Vertex Shader (WebGL 2) ===
// 输入: 四顶点 quad 数据，输出: 屏幕坐标 + 插值颜色

#version 300 es
precision highp float;

// 输入属性 (batch 格式)
in vec3 a_position;       // x, z 为世界坐标，y = elevation
in vec3 a_color;          // RGB 基色
in int a_batch_id;        // 批次 ID (用于 instancing)

// Uniforms
uniform mat4 u_model;
uniform mat4 u_projection;
uniform float u_zoom;     // 相机缩放因子 (用于抗锯齿补偿)

// 输出给 fragment shader
out vec3 v_color;
out float v_elevOffset;
out vec2 v_texCoord;

void main() {
  // 模型变换 (地球曲率校正 + 局部偏移)
  vec4 worldPos = u_model * vec4(a_position.x, a_position.y, a_position.z, 1.0);
  
  // 投影变换
  gl_Position = u_projection * worldPos;
  
  // 颜色传递
  v_color = a_color;
  
  // 高程偏移 (供 LOD 或细节增强)
  v_elevOffset = a_position.y;
  
  // UV 坐标 (用于地表纹样 TA-12-2)
  v_texCoord = a_position.xz * 0.5 + 0.5;
}
```

**地形片段着色器** (`frontend/js/webgl/layers/terrain/shaders/terrain.frag`):
```glsl
// === Terrain Fragment Shader (WebGL 2) ===
// 处理：光照插值 + 大气色洗烘焙 + 法线 AO (可选)

#version 300 es
precision highp float;

in vec3 v_color;
in float v_elevOffset;
in vec2 v_texCoord;

out vec4 outColor;

// 统一来自 lighting.js::SimLighting
uniform bool u_lightingEnabled;
uniform vec3 u_sunDirection;    // 单位向量
uniform vec3 u_tint;            // 季相 tint
uniform float u_seasonFactor;   // 0~1，季节强度
uniform vec3 u_washColor;       // 大气色洗颜色

void main() {
  // 1. 光照计算 (面法线近似：假设面朝上)
  vec3 normal = vec3(0.0, 1.0, 0.0);
  float diff = max(dot(normal, u_sunDirection), 0.0);
  
  vec3 finalColor = v_color;
  
  if (u_lightingEnabled) {
    // 季相 tint 调制
    finalColor = v_color * u_tint;
    
    // 基础光照 (day/night cycle)
    finalColor *= 0.3 + 0.7 * diff;
  }
  
  // 2. 大气色洗 (已在 relightTerrain 烘焙至此，但这里保留 blend 余量)
  if (length(u_washColor) > 0.0) {
    finalColor = mix(finalColor, u_washColor, 0.15);
  }
  
  // 3. AO 预计算 (从 elevOffset 推导坡度伪影)
  // TODO: 后期可改为接收法线输入做精确 AO
  
  outColor = vec4(finalColor, 1.0);
}
```

**编译脚本** (`tools/build-shaders.ts`):
```typescript
#!/usr/bin/env ts-node
// 将 .glsl 文件转换为 JS string 常量

import fs from 'fs';
import path from 'path';

const shaderDir = './frontend/js/webgl/layers/terrain/shaders';

const shaders = {
  'terrain.vert': fs.readFileSync(path.join(shaderDir, 'terrain.vert'), 'utf-8'),
  'terrain.frag': fs.readFileSync(path.join(shaderDir, 'terrain.frag'), 'utf-8'),
};

const output = `// Auto-generated from build-shaders.ts\nexport const TERRAIN_SHADERS = ${JSON.stringify(shaders, null, 2)};\n`;

fs.writeFileSync('./frontend/js/webgl/layers/terrain/shaders/generated.ts', output);
console.log('✓ Shaders compiled');
```

运行:
```bash
npx ts-node tools/build-shaders.ts
```

#### Step 2.2: 批处理系统设计 (Week 1, Day 2-3)

**批处理器** (`frontend/js/webgl/layers/terrain/batcher.js`):
```javascript
// === Terrain Batch Batcher (CPU 侧) ===
// 职责：将散乱地形格合并为同色 batch，生成 WebGL 缓冲区

class TerrainBatcher {
  constructor() {
    this.batchPool = [];
    this.currentBatchIndex = 0;
  }
  
  /**
   * 批量处理地形格数组
   * @param {Array} cells - sim.terrain.cells[]
   * @param {object} config - RENDER_CONFIG.terrainMeshMerge
   * @returns {Array} batches [{vertices, indices, colorHash, count}]
   */
  batch(cells, config) {
    const batches = new Map(); // colorHash → BatchState
    
    for (const cell of cells) {
      const colorHash = this.hashColor(cell.color);
      
      if (!batches.has(colorHash)) {
        batches.set(colorHash, {
          hash: colorHash,
          vertices: [],  // Float32Array builder
          indices: [],   // Uint16Array builder
          quadCount: 0,
          min: {x: Infinity, z: Infinity},
          max: {x: -Infinity, z: -Infinity}
        });
      }
      
      const batch = batches.get(colorHash);
      this.addQuad(batch, cell);
    }
    
    return Array.from(batches.values()).map(b => ({
      colorHash: b.hash,
      vertices: new Float32Array(b.vertices),
      indices: new Uint16Array(b.indices),
      count: b.quadCount,
      bounds: {min: b.min, max: b.max}
    }));
  }
  
  hashColor(colorString) {
    // 简化的颜色哈希 (RGB 拼接)
    const rgb = colorString.match(/(\d+),\s*(\d+),\s*(\d+)/).slice(1);
    return `${rgb[0]}-${rgb[1]}-${rgb[2]}`;
  }
  
  addQuad(batch, cell) {
    // 更新边界
    const wx = cell.wx, wy = cell.wy, elev = cell.elev;
    const half = 30; // 格子半宽 (worldSize/2 / gridSize)
    
    batch.min.x = Math.min(batch.min.x, wx - half);
    batch.min.z = Math.min(batch.min.z, wy - half);
    batch.max.x = Math.max(batch.max.x, wx + half);
    batch.max.z = Math.max(batch.max.z, wy + half);
    
    // 6 顶点 (2 triangles)
    const h = half;
    const verts = batch.vertices;
    const idx = verts.length / 3;
    
    // Quad 顶点布局 (逆时针 winding)
    const offset = [
      [-h, -h],  // bottom-left
      [h, -h],   // bottom-right
      [-h, h],   // top-left
      [h, h]     // top-right
    ];
    
    for (const [dx, dz] of offset) {
      verts.push(wx + dx, elev, wy + dz);
    }
    
    // Indices: 2 triangles
    const indices = batch.indices;
    indices.push(idx, idx + 1, idx + 2);
    indices.push(idx + 1, idx + 3, idx + 2);
    
    batch.quadCount++;
  }
  
  /**
   * 重置批处理器 (重用以减少 GC)
   */
  reset() {
    this.batchPool.length = 0;
    this.currentBatchIndex = 0;
  }
}

window.terrainBatcher = new TerrainBatcher();
```

**增量构建优化** (`frontend/js/webgl/layers/terrain/incremental-batcher.js`):
```javascript
// === 增量批处理 (避免每帧全量 rebuild) ===
// 利用地形静态特性：cell.color 仅在光照变化时更新

class IncrementalTerrainBatcher extends TerrainBatcher {
  constructor() {
    super();
    this.lastLightingPhase = null;
    this.batchesByLightingPhase = new Map();
    this.cacheInvalidated = false;
  }
  
  /**
   * 尝试从缓存取用
   */
  batch(cells, config) {
    const currentLightingPhase = this.getLightingPhase();
    
    // 若光档未变且缓存有效，直接返回旧 batches
    if (currentLightingPhase === this.lastLightingPhase && !this.cacheInvalidated) {
      return this.batchesByLightingPhase.get(currentLightingPhase);
    }
    
    // 缓存失效或光档变化 → 重新 batch
    const batches = super.batch(cells, config);
    this.batchesByLightingPhase.set(currentLightingPhase, batches);
    this.lastLightingPhase = currentLightingPhase;
    
    return batches;
  }
  
  getLightingPhase() {
    if (!window.SimLighting) return 0;
    const cfg = window.SimLighting.cfg();
    const steps = cfg.lightStepsPerYear || 144;
    const phase = window.SimLighting.phase(); // 0~1
    return Math.floor(phase * steps);
  }
  
  invalidate() {
    this.cacheInvalidated = true;
    this.batchesByLightingPhase.clear();
  }
}

window.incrementalBatcher = new IncrementalTerrainBatcher();
```

#### Step 2.3: WebGL 渲染器实现 (Week 1, Day 4 - Week 2, Day 1)

**地形渲染器** (`frontend/js/webgl/layers/terrain/renderer.js`):
```javascript
// === Terrain WebGL Renderer ===

class TerrainWebGLRenderer {
  constructor(webglContext) {
    this.gl = webglContext.GL;
    this.manager = new ShaderManager(this.gl);
    this.batcher = window.incrementalBatcher || new TerrainBatcher();
    
    // Buffers (持久化，零分配)
    this.vertexBuffer = this.gl.createBuffer();
    this.indexBuffer = this.gl.createBuffer();
    
    // VAOs per batch (减少 bind 次数)
    this.vaos = [];
    
    // Stats
    this.stats = { batches: 0, totalQuads: 0, lastBatchTime: 0 };
  }
  
  async init() {
    const shaders = TERRAIN_SHADERS;
    this.program = await this.manager.loadProgram(shaders.terrain.vert, shaders.terrain.frag);
    this.gl.useProgram(this.program);
    
    this.setupAttributes();
    this.createVAOs();
  }
  
  setupAttributes() {
    const stride = 3 * 4; // 3 floats per vertex (x, elev, z)
    
    const posLoc = this.gl.getAttribLocation(this.program, 'a_position');
    this.gl.enableVertexAttribArray(posLoc);
    this.gl.vertexAttribPointer(posLoc, 3, this.gl.FLOAT, false, stride, 0);
    
    const colorLoc = this.gl.getAttribLocation(this.program, 'a_color');
    this.gl.enableVertexAttribArray(colorLoc);
    this.gl.vertexAttribPointer(colorLoc, 3, this.gl.FLOAT, false, stride, 0);
    
    const batchIdLoc = this.gl.getAttribLocation(this.program, 'a_batch_id');
    this.gl.enableVertexAttribArray(batchIdLoc);
    this.gl.vertexAttribPointer(batchIdLoc, 1, this.gl.INT, false, stride, 0);
  }
  
  createVAOs() {
    // 每个 batch 一个 VAO
    for (let i = 0; i < 64; i++) {
      const vao = this.gl.createVertexArray();
      this.gl.bindVertexArray(vao);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      this.vaos.push(vao);
    }
  }
  
  /**
   * 渲染地形
   */
  render(cells, camera, config) {
    const startTime = performance.now();
    this.gl.useProgram(this.program);
    
    // 绑定 framebuffer (default = 0)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, w, h);
    
    // Clear
    this.gl.clearColor(0.4, 0.6, 0.8, 1.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    
    // Generate batches
    const batches = this.batcher.batch(cells, config);
    this.stats.batches = batches.length;
    this.stats.totalQuads = batches.reduce((sum, b) => sum + b.count, 0);
    
    // 计算投影矩阵
    const aspect = w / h;
    const fov = 1.2; // 较宽 FOV 匹配 Canvas2D 观感
    const near = 1.0;
    const far = 200.0;
    const projMatrix = ProjectionUtils.perspective(fov, aspect, near, far);
    
    // View matrix (从 camera 对象提取)
    const camPos = { x: 0, y: 0, z: 50 }; // 简化：应同步 camera.panX/panY/rotZ
    const viewMatrix = ProjectionUtils.lookAt(camPos);
    
    // Bind uniforms once
    const projLoc = this.manager.getUniformLocation(this.program, 'u_projection');
    const modelLoc = this.manager.getUniformLocation(this.program, 'u_model');
    const zoomLoc = this.manager.getUniformLocation(this.program, 'u_zoom');
    
    this.gl.uniformMatrix4fv(projLoc, false, projMatrix);
    this.gl.uniformMatrix4fv(modelLoc, false, viewMatrix);
    this.gl.uniform1f(zoomLoc, camera.zoom);
    
    // 光照 uniform
    if (window.SimLighting?.enabled()) {
      const light = window.SimLighting;
      const sunDir = light.sunScreenDir();
      const tint = light.tint();
      const seasonFactor = light.seasonFactor?.() || 0;
      const washColor = light.washColor?.() || [0, 0, 0];
      
      this.gl.uniform1i(this.manager.getUniformLocation(this.program, 'u_lightingEnabled'), 1);
      this.gl.uniform3fv(this.manager.getUniformLocation(this.program, 'u_sunDirection'), sunDir);
      this.gl.uniform3fv(this.manager.getUniformLocation(this.program, 'u_tint'), tint);
      this.gl.uniform1f(this.manager.getUniformLocation(this.program, 'u_seasonFactor'), seasonFactor);
      this.gl.uniform3fv(this.manager.getUniformLocation(this.program, 'u_washColor'), washColor);
    } else {
      this.gl.uniform1i(this.manager.getUniformLocation(this.program, 'u_lightingEnabled'), 0);
    }
    
    // Draw each batch
    let drawCalls = 0;
    for (const batch of batches) {
      // Update buffers
      this.gl.bindVertexArray(this.vaos[this.vaos.length - 1]);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, batch.vertices, this.gl.STATIC_DRAW);
      
      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, batch.indices, this.gl.STATIC_DRAW);
      
      // Set batch ID
      const batchIdLoc = this.gl.getAttribLocation(this.program, 'a_batch_id');
      // Simplified: assign static batch ID per draw
      
      // Draw
      this.gl.drawElements(this.gl.TRIANGLES, batch.indices.length, this.gl.UNSIGNED_SHORT, 0);
      drawCalls++;
    }
    
    this.stats.lastBatchTime = performance.now() - startTime;
  }
  
  getStats() {
    return { ...this.stats, gpuTime: 0 }; // GPU timing requires extension
  }
}
```

#### Step 2.4: 深度队列集成 (Week 2, Day 2)

**修改 `render_depth_queue.js`**:
```javascript
// 添加 WebGL 地形提交入口
function submitTerrainToBackend(cells, config) {
  if (window.USE_WEBGL && window.terrainWebglRenderer?.isReady()) {
    // WebGL 路径：提前 batch
    window.terrainWebglRenderer.render(cells, camera, config);
  } else {
    // Canvas 2D 路径：保留原逻辑
    for (const cell of cells) {
      drawTerrainCell(cell);
    }
  }
}

// 在 drawWorldEntities() 中替换原有的地形绘制调用
if (hasTerrain) {
  // 原有地形绘制 → 调用统一接口
  submitTerrainToBackend(cells, meshMergeCfg);
}
```

#### Step 2.5: 画面一致性验证 (Week 2, Day 3-4)

**截图对比脚本** (`tools/snapshot-compare.js`):
```javascript
#!/usr/bin/env node
// 对比 Canvas 2D 和 WebGL 渲染帧

const puppeteer = require('puppeteer');
const fs = require('fs');

async function compare(mode1, mode2, seed = 12345) {
  const browser = await puppeteer.launch({ headless: true });
  
  for (const mode of [mode1, mode2]) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:3004?seed=${seed}&webgl=${mode === 'webgl' ? '1' : '0'}`);
    await page.waitForSelector('#main-canvas');
    
    const canvas = await page.$('#main-canvas');
    const screenshot = await canvas.screenshot({ encoding: 'binary' });
    fs.writeFileSync(`./snapshots/${mode}_seed${seed}.png`, screenshot);
    
    await browser.close();
  }
  
  // 像素级对比
  const img1 = await loadImage('./snapshots/canvas_seed12345.png');
  const img2 = await loadImage('./snapshots/webgl_seed12345.png');
  
  const diff = pixelmatch(img1.data, img2.data, { threshold: 0.1 });
  console.log(`Pixel difference: ${(diff / img1.width / img1.height * 100).toFixed(2)}%`);
  
  if (diff / img1.width / img1.height < 0.01) {
    console.log('✓ PASS: Visual consistency verified');
  } else {
    console.error('✗ FAIL: Visual drift detected');
    process.exit(1);
  }
}

compare('canvas', 'webgl').catch(console.error);
```

运行验证:
```bash
# 启动服务器
node frontend/server.js

# 并行运行对比
node tools/snapshot-compare.js
```

### 6.3 性能基准测试

**扩展 `tools/profile-benchmark.js`**:
```javascript
// 添加 WebGL 性能采集
async function profileWebglVsCanvas() {
  const modes = ['canvas', 'webgl'];
  const seeds = [1, 42, 12345, 99999];
  
  for (const mode of modes) {
    console.log(`\n=== Profiling ${mode.toUpperCase()} ===`);
    
    for (const seed of seeds) {
      const url = `http://localhost:3004?seed=${seed}&webgl=${mode === 'webgl' ? '1' : '0'}`;
      
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
      const client = await page.target().createCDPSession();
      await client.send('Performance.enable');
      
      await page.goto(url);
      await page.waitForSelector('#main-canvas');
      
      // Warm-up
      await page.evaluate(() => {
        for (let i = 0; i < 10; i++) sim.tick();
      });
      
      // Measure
      const metrics = await page.evaluate(() => {
        const start = performance.now();
        let frames = 0;
        
        return new Promise(resolve => {
          const interval = setInterval(() => {
            frames++;
            if (frames >= 60) {
              clearInterval(interval);
              resolve({
                fps: frames,
                renderTime: performance.now() - start
              });
            }
          }, 1000);
        });
      });
      
      console.log(`Seed ${seed}: FPS=${metrics.fps}, FrameTime=${metrics.renderTime.toFixed(1)}ms`);
      
      await browser.close();
    }
  }
}

profileWebglVsCanvas().catch(console.error);
```

**预期性能数据表**:
| 场景 | Canvas 2D | WebGL 目标 | 提升 |
|------|-----------|-----------|------|
| 种子#1 (平原) | 30 FPS | 45 FPS | +50% |
| 种子#42 (丘陵) | 22 FPS | 38 FPS | +73% |
| 种子#12345 (复杂) | 18 FPS | 32 FPS | +78% |
| GC/分钟 | 25 次 | 8 次 | -68% |

### 6.4 阶段二验收标准

| 验收项 | 标准 | 验证方法 |
|--------|------|---------|
| **视觉一致性** | 像素差异 < 1% | `snapshot-compare.js` |
| **FPS 提升** | ≥50% (复杂场景) | `profile-benchmark.js` |
| **GC 频率** | ≤40% 原频率 | Chrome DevTools |
| **Fallback** | WebGL 失败自动回退 | 强制 disable 测试 |
| **内存增长** | < 15% | WASM + GPU 显存总计 |

---

## 7. 性能门禁与验收标准

### 7.1 CI 门禁集成

**`.github/workflows/webgl-check.yml`**:
```yaml
name: WebGL Migration Check

on:
  push:
    branches: [ master ]
  pull_request:
    branches: [ master ]

jobs:
  visual-consistency:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install deps
        run: npm ci
      
      - name: Build shaders
        run: npx ts-node tools/build-shaders.ts
      
      - name: Run snapshot comparison
        run: node tools/snapshot-compare.js
      
      - name: Profile performance
        run: node tools/profile-benchmark.js
        
  regression-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Run existing test suite
        run: |
          cargo test --lib
          node tools/test-wasm.js
          node tools/config-check.js
```

### 7.2 发布标准

**阶段二完成判定**:
- ✅ 所有视觉一致性测试通过
- ✅ 性能提升达到预期 (≥50% FPS)
- ✅ 无回归 bug (cargo test + wasm tests pass)
- ✅ 文档更新完成 (本文档 + AGENTS.md §5.12)

---

## 8. 阶段三~五：全量 WebGL 迁移（装饰层 / 实体层 / Canvas 退役）

> **状态**: ★ **2026-09-17 定为目标形态**（原为「未实施 / TBD」）。架构决策：**所有渲染内容进入同一 WebGL 管线，不再使用 Canvas 2D**；双 Canvas 覆盖层是过渡形态，迁移完成后整体退役。
> **总工期估算**: 5~7 周（不含阶段一/二已交付部分）| **风险**: 高 | **前置**: 阶段一/二已落地；现行性能数据（07 号 §11.3；原 TA-08 实测基线随任务删除不再采集）
> **核心收益**: ① 逐像素深度缓冲彻底解决模型内穿插与跨实体遮挡（TA-08 策略全部取消）；② 消除跨画布层序约束与三块画布叠层隐患；③ 装饰/实体实例化批绘制，draw call 数量级下降。

### 8.1 阶段三：装饰层迁移（Accent → GPU）

**范围**（现状全部由 Canvas 2D 绘制，经 `DEPTH_ACCENT` 入队）：

| 现状模块 | 迁移对象 |
|---|---|
| `render_accents.js` | Tree / Boulder / RockCluster 绘制 |
| `render_bush.js` | Bush 三变体 + 花朵图元 |
| `render_grass.js` | GrassTuft / 芦草 |
| `render_landscapes.js` + `landscape-model.js` | 资源景观子图元（含 GroundPatch 贴地片、detail 可采细节） |
| `render_shadows.js` | 树/灌木贴地投影与接触阴影 |
| `accent-model.js` / `accent-season.js` / `accent-lod.js` | **保留**为 CPU 侧几何与筛选来源，不迁 GPU |

**实施要点**：

1. **几何来源不变**：`accent-model.js` 的局部三维骨架（主干 / 枝条 segments / 叶簇椭球）与 `(kind,id)` 纯函数派生规则**逐值不变**，改由 vertex/index buffer 生成器消费；模型缓存 `_CACHE_MAX=2048` 与生命周期契约保留；
2. **实例化批绘制**：同 species × segTier 的枝条/叶簇归并为 instanced draw；叶簇按 `AccentLOD` 档位选择 instance 集合（远景只提交 `farClusters` 子集，中景剔 `segTier===1`），LOD 判定仍留在 CPU 侧；
3. **透明批次**：叶簇、花朵走预乘 alpha 混合 + CPU 侧按相机深度排序（复用现有 `_sortScratch` 次序），或 alpha-to-coverage（MSAA 可用时）；**禁用**逐簇深色 rim 描边的漫画风约定在 GPU 侧同样不得恢复；
4. **受光与季相**：`accent-season.js` 叶色/叶量曲线、`lighting.js::shadeRgbInto` / `accentLitFill` 的受光公式迁为 shader uniform/attribute，**公式本身不变**（TA-04 系列验收逐场景复测）；
5. **贴地投影**（`render_shadows.js`）走独立 decal 批次，随叶量调制的 alpha 入 uniform；
6. **景观遮罩**（`landscape-mask.js`）判定逻辑保持 CPU 侧，输出子图元可见性/`_masked` 供 instance 剔除，**不搬进 shader**。

**验收**：07 号 §11.1/§11.3 四季×受光×季节轮转逐场景对照（模型摘要逐值不变）；§8.5 矩阵前三行逐条通过；`frontend-check.js` + `config-check.js` 全绿。

### 8.2 阶段四：实体层与表现层迁移（Agent / House / POI / 道路 / 特效）

**范围**：`render_agents.js`（族人 + 马斯洛需求配色 + 选中态）、房屋与工地、POI 底座与图标、道路段与车辙、礼花/粒子特效、`terrain-mesh-merge.js` 产出的地形 quad（已在 GPU 侧）。

**实施要点**：

1. **族人**：低多边形 + 实例化；需求配色与季节色走 uniform，不逐帧重传几何；
2. **选中遮挡补偿**（承接原 TA-08 策略 C）：选中实体在**关闭深度测试**的第二趟 pass 中补一圈描边，叶簇等前景透明体在该趟降 alpha；实现口径与验收见 §8.5；
3. **拾取**：由「按 `sim.*` 原序数组遍历 + 屏幕坐标判定」改为 **ID-buffer 颜色拾取**（离屏 FBO 渲染实体 ID，读 1×1 像素）或 CPU 侧保留现有遍历——二选一由阶段三实测性能决定，**不得**引入第二套世界事实来源；
4. **标签层**：DOM 标签（`label-layout.js` + 标签避让）**本轮保留 DOM**，不作为 GPU 迁移对象；若后续并入，走位图文字集（texture atlas）；
5. **道路**：曲线段三角化后合批提交，磨损 `wear` 走顶点属性；水系河面透明段排序规则（现「段四角取最大」口径）在 GPU 侧改为按段深度排序 + 深度写入关闭。

**验收**：全实体类型四方位旋转一致性；拾取命中率与现状持平；高密度聚落拖动 p95 达标（§7.1 门禁）。

### 8.3 阶段五：Canvas 2D 退役

**删除清单**（迁移完成后执行）：

| 对象 | 处置 |
|---|---|
| `#sim-canvas` 2D 覆盖层画布 | **删除**；`index.html`/`style.css`/`map.html` 同步 |
| `frontend/js/webgl/fallback-handler.js` 的 2D 回退分支 | **删除**；WebGL 不可用时给出明确不支持提示（不做降级，见 §9.2） |
| `render_terrain.js` / `render_world.js` / `render_depth_queue.js` 的 Canvas 2D 绘制路径 | **删除**；仅保留 WebGL 提交路径 |
| `render_accents.js` / `render_bush.js` / `render_grass.js` / `render_landscapes.js` / `render_shadows.js` / `render_agents.js` 的 `ctx` 绘制实现 | **删除**，由对应 GPU 渲染模块替代 |
| `math.js::project3D` 等 CPU 投影 | 保留（拾取/标签/AABB 剔除仍需要屏幕坐标） |
| `frontend/AGENTS.md`、`docs/current/tech/16`/`21`/`31` | **必须同步**：文件清单、加载顺序、DOM ID 共享契约、双 Canvas 描述 |
| `tools/frontend-check.js` / `code-map-check.js` | 门禁基线同步（DOM ID 与文件登记删除项） |

**退役判据**：阶段三/四全部验收通过 + 连续两个版本无 2D 回退触发记录 + 标签层与拾取功能在纯 WebGL 下无回归。

### 8.4 与原计划的差异（删除项汇总）

| 原计划 | 处置 |
|---|---|
| TA-08 策略 A（模型内排序）/ B（实体拆子项）/ C（屏幕空间兜底） | **取消**；TA-08 任务已于 2026-09-17 删除并视为完成，验收矩阵并入 §8.5 |
| 07 号 §9.3「TC-03 条件触发」 | 改为**既定路径**：不再由性能/遮挡缺陷触发，直接按本方案阶段三~五推进 |
| §2.2「向后兼容：支持降级 Canvas 2D 模式」 | **删除**，替换为「单一渲染管线」目标 |
| §8.2 的 `FORCE_CANVAS2D` 紧急开关 | **仅过渡期保留**，阶段五随 2D 路径一并删除 |
| 「禁止在 2D 覆盖层上再叠加第三块画布」 | 升级为「不再存在 2D 覆盖层」 |

### 8.5 遮挡验收矩阵（★ v2.1 自原 TA-08 §2 并入）

> **来源注记（2026-09-17）**：原仓库根目录任务文档 `TA-08-blocking-measurement.md`（遮挡边界实测与验收矩阵）**已删除并视为完成**——TA-08 重定向后仅剩「测量脚本 + 证据包」工作、无任何功能开发任务，经用户确认关闭；其 §2 验收矩阵并入本节，作为阶段三~五迁移（TC-03）的验收标准。原「模型内排序 / 实体拆子项 / 屏幕空间兜底」三策略随 v2.0 架构决策取消；Canvas 2D 现状基线证据包随任务删除**不再采集**，验收直接以迁移后 WebGL 管线结果为准。

| 场景 | 视角 | 通过标准 |
|------|------|----------|
| 一树一屋一人 | 四方位 × 低/高俯角 × 远/中/近景 | ① 族人在树后不被完整遮挡（半透明叶簇下可见轮廓或选中高亮）；② 选中信息卡片始终可读；③ 岩壁不压盖近路与取水点 |
| 模型内排序 | 连续旋转相机 | 枝簇按实际世界空间深度正确穿插，非简单「全前/全后」分层 |
| 性能预算 | 高密度聚落拖动 | 遮挡相关处理（含选中描边 pass）p95 增量 ≤ 3 ms（07 号 §11.3 口径，走 `tools/profile-benchmark.js`，结果登记 07 号 §11.3） |

实现要点（承接 §8.1/§8.2）：枝簇穿插由 GPU 深度缓冲逐像素解决，无需排序；选中实体被叶簇遮挡时关闭深度测试补一轮描边 pass + 叶簇半透明化（§8.2 第 2 条）；地形-实体在同一管线内统一深度，岩壁压路自然消除。

---

## 9. 风险评估与缓解策略

### 9.1 风险矩阵

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|---------|
| **WebGL 驱动兼容性问题** | 中 | 高 | 启动时能力检测 + 明确不支持提示（**不再提供 2D 降级**，§9.2）；迁移前完成硬件兼容矩阵 |
| **性能不如预期** | 低 | 中 | 渐进式优化 + A/B 对比 |
| **画面不一致** | 中 | 中 | 自动化截图对比 + 阈值告警 |
| **GC 开销转移至 GPU** | 低 | 低 | Buffer reuse + 对象池 |
| **开发进度延误** | 中 | 中 | Phased approach (先 PoC 再 full) |
| **叶簇透明批次穿插错误** | 中 | 中 | CPU 侧按深度排序透明批次；MSAA 可用时改用 alpha-to-coverage；固定种子旋转切片复测（§8.5） |
| **拾取/标签迁移回归** | 中 | 高 | 拾取改 ID-buffer 前先做命中率对照；标签层本轮保留 DOM，不纳入迁移 |
| **阶段五删除 2D 路径后无退路** | 低 | 高 | 阶段五以「连续两个版本无回退触发」为前置判据；删除动作独立提交，可单次 revert |

### 9.2 回退策略（★ 仅过渡期有效）

> **口径变更（v2.0）**：`FORCE_CANVAS2D` 紧急开关**只在阶段三~四的过渡期**作为开发安全网存在。阶段五（Canvas 2D 退役）执行后该开关随 2D 绘制路径一并删除——**目标形态不提供 2D 降级**，WebGL 不可用时明确告知用户不支持，而非降级渲染。

**过渡期紧急回退**:
```javascript
// index.html中添加快速关闭开关（阶段五删除）
window.FORCE_CANVAS2D = (() => {
  const params = new URLSearchParams(window.location.search);
  return params.get('forcemap2d') === '1';
})();

if (window.FORCE_CANVAS2D) {
  console.warn('[Migration] WebGL disabled via URL param');
  window.USE_WEBGL = false;
}
```

**迁移阶段标记**（阶段五完成后替换为能力检测）:
```javascript
// rustworld.js::applyConfig 中添加
window.WEBGL_MIGRATION_PHASE = 'phase4-complete'; // phase3 / phase4 / phase5-complete

// 过渡期：阶段标记缺失时回退 Canvas 2D（阶段五删除此分支）
if (!window.WEBGL_MIGRATION_PHASE && window.USE_WEBGL) {
  console.warn('[Migration] Incomplete WebGL migration - falling back to Canvas 2D');
  window.USE_WEBGL = false;
}

// 阶段五之后：只做能力检测，无降级
if (!window.USE_WEBGL) {
  showUnsupportedNotice(); // 明确提示不支持，不做 2D 渲染
}
```

---

## 📝 附录

### A. 相关文档索引

- [`docs/current/tech/17-seasonal-lighting.md`](../../current/tech/17-seasonal-lighting.md) - 动态季节光照系统
- [`frontend/AGENTS.md`](../../../frontend/AGENTS.md) - 前端模块架构
- [`docs/current/tech/29-impact-matrix.md`](../../current/tech/29-impact-matrix.md) - 跨模块影响关系
- ~~TA-08 遮挡边界实测与验收矩阵~~ - 2026-09-17 任务删除并视为完成，其 §2 验收矩阵已并入本文 §8.5
- [`docs/plan/tech/07-terrain-art.md`](07-terrain-art.md) - 装饰层任务台账（TA-01~TA-18）与 §11 验收清单

### B. 参考资源

- [WebGL 2 Spec](https://www.khronos.org/registry/webgl/specs/latest/2.0/)
- [MDN WebGL Tutorial](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Tutorial)
- [Three.js Internal Optimizations](https://threejs.org/docs/#examples/webgl-renderer) (借鉴思路，不使用库)

### C. 术语表

| 术语 | 定义 |
|------|------|
| **Instancing** | 单次 draw call 绘制多个相同 mesh |
| **Batching** | 将相似几何体合并为单个渲染单元 |
| **VAO** | Vertex Array Object，顶点属性配置容器 |
| **FBO** | Framebuffer Object，离屏渲染缓冲区 |

---

**文档结束**

---

> **修订记录**:
> - v1.0 (2026-09-17): 初始版本，细化阶段一、二实施方案
> - **v2.0 (2026-09-17)**: 架构决策落定——**全量 WebGL、不再使用 Canvas 2D**。新增 §8 阶段三~五正式方案（装饰层 / 实体层 / Canvas 退役）；§2.2 删除「向后兼容 Canvas 2D 降级」；§4.3 修正深度队列定位；§9 风险矩阵与回退策略按「无 2D 降级」口径重写；取消 TA-08 策略 A/B/C。
> - **v2.1 (2026-09-17)**: TA-08 任务**删除并视为完成**（重定向后仅剩测量工作、无功能开发任务，经用户确认）；其 §2 遮挡验收矩阵并入本文 **§8.5**，全文引用改指 §8.5；Canvas 2D 基线证据包不再采集。
