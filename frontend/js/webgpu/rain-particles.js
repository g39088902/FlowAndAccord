// === WebGPU 降水粒子层（compute 物理 + 渲染）=================================
// ★ v1.64.0：粒子物理（生成 / 下落 / 3D 下坡流动 / 邻域力 / 蒸发）已由 Rust 内核迁到
//   本层 WebGPU compute，以 3D 固定网格空间哈希推进，支持 2w+ 粒子同屏。
//   - 驱动跟随仿真 tick（render_canvas.js 推 dt，暂停即冻结、倍速即加速）；
//   - 粒子状态为纯表现层，不进快照 / 存档，无 CPU 回读；
//   - shader（compute + render 单模块）与物理常数由 Rust 导出（world_rain_gpu_shader_*、
//     world_rain_uniforms_*），渲染样式与迁移前逐位一致。
class RainWebGPURenderer {
  constructor(canvas) {
    this.canvas = canvas; this.device = null; this.context = null; this.format = null;
    this.ready = false; this.failed = false;

    this.paramsBuffer = null;   // RainParams uniform（160B）
    this.cameraBuffer = null;   // Camera uniform（32B）
    this.particlesBuffer = null; this.terrainBuffer = null;
    this.cellCounterBuffer = null; this.cellOffsetsBuffer = null;
    this.particleCellBuffer = null; this.sortedIdxBuffer = null; this.freeStackBuffer = null;
    this.simStateBuffer = null;

    this.computeBgl = null; this.renderBgl = null;
    this.computeBindGroup = null; this.renderBindGroup = null;
    this._pipes = null; this.renderPipeline = null;

    this._uniforms = null;              // Rust 下发的物理参数契约
    this._terrainRef = null; this._terrainData = null; this._terrainDirty = false;
    this._grid = { gx: 3, gy: 3, gz: 2, cells: 18, cellSizeX: 1, cellSizeY: 1, cellSizeZ: 1, minX: 0, minY: 0, minZ: 0 };

    this._maxParticles = 0; this._allocKey = '';
    this._dtAccum = 0; this._spawnCarry = 0; this._stepSeq = 0;
    this._seed = 0x51ed270b;
    // 调试读数：每 ~1s 回读一次 GPU 存活数（仅喂给调试 HUD，不参与任何计算）。
    this.aliveCount = -1;
    this._stagingBuffer = null; this._readbackPending = false; this._lastReadbackMs = 0;

    const simCfg = (typeof window !== 'undefined' && window.SIM_CONFIG) || {};
    this._fallbackMax = Math.max(1, simCfg.rainParticleMax | 0 || 2048);
    this._hardMax = 65536;
    const rc = (typeof window !== 'undefined' && window.RENDER_CONFIG) || {};
    this._maxSubsteps = Math.max(1, rc.rainMaxSubsteps | 0 || 8);
    this._dtClamp = Number.isFinite(rc.rainDtClamp) ? rc.rainDtClamp : 0.25;
    this._neighborCap = Math.max(1, rc.rainNeighborCap | 0 || 32);

    this._paramsScratch = new ArrayBuffer(160);
    this._paramsF32 = new Float32Array(this._paramsScratch);
    this._paramsU32 = new Uint32Array(this._paramsScratch);
    this._cameraScratch = new Float32Array(8);
  }

  // Rust 下发的降水参数契约（READY / CONFIG / LOAD 后各调用一次）。
  setUniforms(u) {
    if (!u || typeof u !== 'object') return;
    this._uniforms = u;
  }

  async init(shaderSource) {
    if (!navigator.gpu || !this.canvas || !shaderSource) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return false;
      this.device = await adapter.requestDevice();
      this.context = this.canvas.getContext('webgpu');
      this.device.addEventListener('uncapturederror', e => console.error('[WebGPU][rain] uncaptured error:', e.error?.message || e.error));
      this.device.lost.then(info => console.error('[WebGPU][rain] device lost:', info.message || info.reason));
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });

      const shader = this.device.createShaderModule({ code: shaderSource });
      if (typeof shader.getCompilationInfo === 'function') {
        const info = await shader.getCompilationInfo();
        const errors = (info.messages || []).filter(m => m.type === 'error');
        if (errors.length) throw new Error(errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
      }

      const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
      const checked = async (fn, label) => {
        this.device.pushErrorScope('validation');
        const value = fn();
        const error = await this.device.popErrorScope();
        if (error) throw new Error(`${label}: ${error.message}`);
        return value;
      };

      this.paramsBuffer = this.device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.cameraBuffer = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

      // 显式绑定：compute 用 0..8（1 uniform + 8 storage，默认 maxStorageBuffersPerShaderStage = 8），
      // render 用 9..11（只读视图，顶点阶段不允许 read_write 存储，故两套布局分别绑定同一批缓冲）。
      const ro = { visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } };
      const rw = { visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } };
      this.computeBgl = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, ...rw },  // particles
          { binding: 2, ...ro },  // terrain（只读，须与 WGSL var<storage, read> 一致）
          { binding: 3, ...rw },  // cellCounterBuf
          { binding: 4, ...rw },  // cellOffsets
          { binding: 5, ...rw },  // particleCell
          { binding: 6, ...rw },  // sortedIdx
          { binding: 7, ...rw },  // freeStack
          { binding: 8, ...rw },  // simState
        ],
      });
      this.renderBgl = this.device.createBindGroupLayout({
        entries: [
          { binding: 9, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
          { binding: 10, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          { binding: 11, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        ],
      });
      const computeLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.computeBgl] });
      const renderLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.renderBgl] });

      const mkPipe = (entryPoint) => this.device.createComputePipeline({
        layout: computeLayout,
        compute: { module: shader, entryPoint },
      });
      this._pipes = await checked(() => ({
        initState: mkPipe('initState'),
        spawn: mkPipe('spawn'),
        flowIntegrate: mkPipe('flowIntegrate'),
        evict: mkPipe('evict'),
        gridClear: mkPipe('gridClear'),
        gridCount: mkPipe('gridCount'),
        gridScan: mkPipe('gridScan'),
        gridScatter: mkPipe('gridScatter'),
      }), 'compute pipelines');

      this.renderPipeline = await checked(() => this.device.createRenderPipeline({
        layout: renderLayout,
        vertex: { module: shader, entryPoint: 'renderVertex' },
        fragment: {
          module: shader, entryPoint: 'renderFragment',
          targets: [{
            format: this.format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
      }), 'render pipeline');

      this.ready = true;
      console.info('[WebGPU][rain] initialized (compute + render); Rust WGSL bytes:', shaderSource.length);
      return true;
    } catch (err) {
      this.failed = true;
      console.warn('[WebGPU] 降水层初始化失败：', err);
      return false;
    }
  }

  resize() {
    if (!this.canvas || !this.context) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w; this.canvas.height = h;
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
  }

  // ── 地形上传（随世界重建触发；sim.terrain 对象引用变化即视为换地形）──
  _setTerrain(sim) {
    const t = sim && sim.terrain;
    if (!t || !t.cells || t.cells.length === 0) return;
    if (this._terrainRef === t) return;
    const gw = (t.gridW | 0) || (t.gridSize | 0);
    const gh = (t.gridH | 0) || (t.gridSize | 0);
    if (gw <= 0 || gh <= 0) return;
    const n = gw * gh;
    const data = new Float32Array(n);
    const cells = t.cells;
    for (let i = 0; i < n && i < cells.length; i++) {
      const c = cells[i];
      data[i] = c && Number.isFinite(c.elev) ? c.elev : 0;
    }
    this._terrainRef = t;
    this._terrainData = {
      worldSize: Number.isFinite(t.worldSize) && t.worldSize > 0 ? t.worldSize : 1,
      gridW: gw, gridH: gh,
      minZ: Number.isFinite(t.minZ) ? t.minZ : 0,
      maxZ: Number.isFinite(t.maxZ) ? t.maxZ : 0,
      data,
    };
    this._terrainDirty = true;
  }

  // 3D 固定网格：单元边长取交互终止界限 reachFar（无交互力时回退 8m），
  // 整体维度钳到 numCells ≤ 1024（前缀和单 workgroup/单线程即可完成）。
  _computeGrid(t) {
    const u = this._uniforms || {};
    let h = (u.force_valid === 1 && Number.isFinite(u.reach_far) && u.reach_far > 0.5) ? u.reach_far : 8;
    const zMin = (Number.isFinite(t.minZ) ? t.minZ : 0) - 8;
    const zMax = (Number.isFinite(t.maxZ) ? t.maxZ : 0) + (u.spawn_height_base || 0) + (u.spawn_height_rand || 0) + 8;
    const zSpan = Math.max(1, zMax - zMin);
    let gx = 3, gy = 3, gz = 2;
    for (let guard = 0; guard < 64; guard++) {
      gx = Math.min(10, Math.max(3, Math.floor(t.worldSize / h) + 1));
      gy = gx;
      gz = Math.min(10, Math.max(2, Math.floor(zSpan / h) + 1));
      if (gx * gy * gz <= 1024) break;
      h *= 1.3;
    }
    this._grid = {
      gx, gy, gz, cells: gx * gy * gz,
      cellSizeX: t.worldSize / gx,
      cellSizeY: t.worldSize / gy,
      cellSizeZ: zSpan / gz,
      minX: -t.worldSize / 2,
      minY: -t.worldSize / 2,
      minZ: zMin,
    };
  }

  _resolveMaxParticles() {
    const u = this._uniforms || {};
    let mp = u.max_particles | 0;
    if (!(mp > 0)) mp = this._fallbackMax;
    return Math.max(1, Math.min(this._hardMax, mp));
  }

  _allocateBuffers() {
    const dev = this.device;
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    for (const b of [this.particlesBuffer, this.terrainBuffer, this.cellCounterBuffer, this.cellOffsetsBuffer,
      this.particleCellBuffer, this.sortedIdxBuffer, this.freeStackBuffer, this.simStateBuffer]) {
      if (b) b.destroy();
    }
    const mp = this._maxParticles;
    const nc = this._grid.cells;
    const tl = this._terrainData.data.length;
    this.particlesBuffer = dev.createBuffer({ size: mp * 64, usage: S });
    this.terrainBuffer = dev.createBuffer({ size: Math.max(16, tl * 4), usage: S });
    // 前半段 = 单元计数，后半段 = 散布游标（= 各段起点）。
    this.cellCounterBuffer = dev.createBuffer({ size: Math.max(16, nc * 2 * 4), usage: S });
    this.cellOffsetsBuffer = dev.createBuffer({ size: Math.max(16, (nc + 1) * 4), usage: S });
    this.particleCellBuffer = dev.createBuffer({ size: mp * 4, usage: S });
    this.sortedIdxBuffer = dev.createBuffer({ size: mp * 4, usage: S });
    this.freeStackBuffer = dev.createBuffer({ size: mp * 4, usage: S });
    // SimState：alive(u32) + freeTop(i32) + drawArgs[4]（间接绘制参数从字节偏移 8 读取）；
    // COPY_SRC 供调试 HUD 每秒回读存活数。
    this.simStateBuffer = dev.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });

    this.computeBindGroup = dev.createBindGroup({
      layout: this.computeBgl,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this.particlesBuffer } },
        { binding: 2, resource: { buffer: this.terrainBuffer } },
        { binding: 3, resource: { buffer: this.cellCounterBuffer } },
        { binding: 4, resource: { buffer: this.cellOffsetsBuffer } },
        { binding: 5, resource: { buffer: this.particleCellBuffer } },
        { binding: 6, resource: { buffer: this.sortedIdxBuffer } },
        { binding: 7, resource: { buffer: this.freeStackBuffer } },
        { binding: 8, resource: { buffer: this.simStateBuffer } },
      ],
    });
    this.renderBindGroup = dev.createBindGroup({
      layout: this.renderBgl,
      entries: [
        { binding: 9, resource: { buffer: this.cameraBuffer } },
        { binding: 10, resource: { buffer: this.particlesBuffer } },
        { binding: 11, resource: { buffer: this.sortedIdxBuffer } },
      ],
    });
  }

  _writeParams(spawnCount, stepSeq) {
    const f = this._paramsF32, u = this._paramsU32, g = this._grid, t = this._terrainData;
    const uni = this._uniforms || {};
    f[0] = t.worldSize; f[1] = t.gridW; f[2] = t.gridH; f[3] = 1 / 60;
    f[4] = uni.gravity || 0; f[5] = uni.spawn_height_base || 0; f[6] = uni.spawn_height_rand || 0; f[7] = uni.spawn_speed || 0;
    f[8] = uni.max_age_base || 0; f[9] = uni.max_age_rand || 0; f[10] = uni.fall_damp || 0; f[11] = uni.land_clearance || 0;
    f[12] = uni.ground_rest_lift || 0; f[13] = uni.flow_rest_lift || 0; f[14] = uni.flow_accel || 0; f[15] = uni.flow_speed_max || 0;
    f[16] = uni.flow_damp || 0; f[17] = uni.gradient_min_step || 0; f[18] = uni.attract || 0; f[19] = uni.repel || 0;
    f[20] = uni.force_scale || 0; f[21] = uni.reach_far || 0; f[22] = g.minX; f[23] = g.minY;
    f[24] = g.minZ; f[25] = g.cellSizeX; f[26] = g.cellSizeY; f[27] = g.cellSizeZ;
    u[28] = g.gx; u[29] = g.gy; u[30] = g.gz; u[31] = this._maxParticles;
    u[32] = spawnCount >>> 0; u[33] = this._seed >>> 0; u[34] = stepSeq >>> 0; u[35] = uni.force_valid === 1 ? 1 : 0;
    u[36] = this._neighborCap; u[37] = g.cells; u[38] = 0; u[39] = 0;
    this.device.queue.writeBuffer(this.paramsBuffer, 0, this._paramsScratch);
  }

  _dispatchInit() {
    this._writeParams(0, 0);
    const enc = this.device.createCommandEncoder();
    const cp = enc.beginComputePass();
    cp.setPipeline(this._pipes.initState);
    cp.setBindGroup(0, this.computeBindGroup);
    cp.dispatchWorkgroups(Math.max(1, Math.ceil(this._maxParticles / 64)));
    cp.end();
    this.device.queue.submit([enc.finish()]);
  }

  // 世界切换 / 重置 / 倒流：清空粒子槽与累加器。
  reset() {
    this._dtAccum = 0; this._spawnCarry = 0; this._stepSeq = 0;
    this.aliveCount = -1;
    if (this.ready && this._pipes && this.computeBindGroup) this._dispatchInit();
  }

  // 每秒一次回读存活数（16 字节，仅诊断用；异步、不阻塞渲染、不回灌模拟）。
  _maybeReadbackAlive(now) {
    if (this._readbackPending || !this.simStateBuffer) return;
    if (now - this._lastReadbackMs < 1000) return;
    this._lastReadbackMs = now;
    if (!this._stagingBuffer) {
      this._stagingBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    }
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.simStateBuffer, 0, this._stagingBuffer, 0, 16);
    this.device.queue.submit([enc.finish()]);
    this._readbackPending = true;
    this._stagingBuffer.mapAsync(GPUMapMode.READ).then(() => {
      this.aliveCount = new DataView(this._stagingBuffer.getMappedRange()).getUint32(0, true);
      this._stagingBuffer.unmap();
      this._readbackPending = false;
    }).catch(() => { this._readbackPending = false; });
  }

  _ensureConfigured() {
    const t = this._terrainData;
    if (!t) return false;
    this._maxParticles = this._resolveMaxParticles();
    this._computeGrid(t);
    const key = this._maxParticles + ':' + this._grid.cells + ':' + t.data.length;
    if (this._allocKey !== key) {
      this._allocKey = key;
      this._allocateBuffers();
      this.device.queue.writeBuffer(this.terrainBuffer, 0, t.data);
      this._terrainDirty = false;
      this._dtAccum = 0; this._spawnCarry = 0; this._stepSeq = 0;
      this._dispatchInit();
    } else if (this._terrainDirty) {
      this.device.queue.writeBuffer(this.terrainBuffer, 0, t.data);
      this._terrainDirty = false;
    }
    return true;
  }

  // 按仿真 tick 推进的秒数推进降水（暂停 → dt=0 冻结）。
  step(dtSim, sim) {
    if (!this.ready || !sim || !this._pipes) return;
    this._setTerrain(sim);
    if (!this._ensureConfigured()) return;
    const dt = Math.max(0, Number(dtSim) || 0);
    const rc = (typeof window !== 'undefined' && window.RENDER_CONFIG) || {};
    const maxSubsteps = Math.max(1, rc.rainMaxSubsteps | 0 || this._maxSubsteps);
    const dtClamp = Number.isFinite(rc.rainDtClamp) && rc.rainDtClamp > 0 ? rc.rainDtClamp : this._dtClamp;
    this._neighborCap = Math.max(1, rc.rainNeighborCap | 0 || this._neighborCap);
    this._dtAccum = Math.min(this._dtAccum + dt, dtClamp);
    const sub = 1 / 60;
    let n = Math.floor(this._dtAccum / sub);
    if (n > maxSubsteps) n = maxSubsteps;
    if (n <= 0) return;
    this._dtAccum -= n * sub;
    for (let s = 0; s < n; s++) this._encodeSubstep(sim);
  }

  _encodeSubstep(sim) {
    const uni = this._uniforms || {};
    const rainfall = Number.isFinite(sim.rainfallMultiplier)
      ? Math.min(5, Math.max(0, sim.rainfallMultiplier)) : 1;
    const rate = (uni.spawn_rate_per_s || 0) * rainfall;
    this._spawnCarry += (1 / 60) * rate;
    let count = Math.floor(this._spawnCarry);
    if (!(count > 0)) count = 0;
    this._spawnCarry -= count;
    this._stepSeq = (this._stepSeq + 1) >>> 0;
    this._writeParams(count, this._stepSeq);

    const mp = this._maxParticles;
    const nc = this._grid.cells;
    const enc = this.device.createCommandEncoder();
    const cp = enc.beginComputePass();
    cp.setBindGroup(0, this.computeBindGroup);
    if (count > 0) {
      cp.setPipeline(this._pipes.spawn);
      cp.dispatchWorkgroups(Math.max(1, Math.ceil(count / 64)));
    }
    cp.setPipeline(this._pipes.flowIntegrate); cp.dispatchWorkgroups(Math.max(1, Math.ceil(mp / 64)));
    cp.setPipeline(this._pipes.evict); cp.dispatchWorkgroups(Math.max(1, Math.ceil(mp / 64)));
    cp.setPipeline(this._pipes.gridClear); cp.dispatchWorkgroups(Math.max(1, Math.ceil(nc / 256)));
    cp.setPipeline(this._pipes.gridCount); cp.dispatchWorkgroups(Math.max(1, Math.ceil(mp / 64)));
    cp.setPipeline(this._pipes.gridScan); cp.dispatchWorkgroups(1);
    cp.setPipeline(this._pipes.gridScatter); cp.dispatchWorkgroups(Math.max(1, Math.ceil(mp / 64)));
    cp.end();
    this.device.queue.submit([enc.finish()]);
  }

  render(camera, width, height) {
    if (!this.ready || !camera || !this.simStateBuffer) return;
    this.resize();
    const rc = (typeof window !== 'undefined' && window.RENDER_CONFIG) || {};
    const cubeHalf = Number.isFinite(rc.rainCubeHalf) ? rc.rainCubeHalf : 6.0;
    this._cameraScratch[0] = width; this._cameraScratch[1] = height;
    this._cameraScratch[2] = camera.panX; this._cameraScratch[3] = camera.panY;
    this._cameraScratch[4] = camera.rotX; this._cameraScratch[5] = camera.rotZ;
    this._cameraScratch[6] = camera.zoom; this._cameraScratch[7] = cubeHalf;
    this.device.queue.writeBuffer(this.cameraBuffer, 0, this._cameraScratch);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    // drawArgs[1] = 存活数（gridScan 写出），死亡粒子天然不在 sortedIdx 列表内。
    // SimState 布局：alive(0) / freeTop(4) / drawArgs(8) → 间接绘制参数从偏移 8 读取。
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.drawIndirect(this.simStateBuffer, 8);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this._maybeReadbackAlive(performance.now());
  }
}
window.RainWebGPURenderer = RainWebGPURenderer;