// === WebGPU 降水粒子层（compute 物理 + 渲染实例回读）=========================
// ★ v1.64.0：粒子物理（生成 / 下落 / 3D 下坡流动 / 邻域力 / 蒸发）已从 Rust 内核迁到
//   本层 WebGPU compute，以 3D 固定网格空间哈希推进。
//   - 驱动跟随仿真 tick（render_canvas.js 推 dt，暂停即冻结、倍速即加速）；
//   - 粒子状态为纯表现层，不进快照 / 存档；
//   - ★ v1.64.3：**渲染改由 WebGL 层承担**（webgl/layers/rain/rain-renderer.js）——粒子原先
//     绘制在本层独立的 `#sim-canvas-rain` 画布上，该画布无深度缓冲，GL 地形与装饰挡不住粒子。
//     现本层只做 compute，并把存活粒子实例（x,y,z,age,falling）异步回读给 GL 层，
//     与 GL 地形共享深度缓冲后地形逐像素正确遮挡、装饰按画家序覆盖。
//   - shader（compute + render 单模块）与物理常数仍由 Rust 导出（world_rain_gpu_shader_*、
//     world_rain_uniforms_*）；render 入口自渲染搬迁后不再使用（保留于同模块，不额外重编译）。
class RainWebGPURenderer {
  constructor(canvas) {
    this.canvas = canvas || null;
    this.device = null;
    this.ready = false; this.failed = false;

    this.paramsBuffer = null;   // RainParams uniform（176B）
    this.particlesBuffer = null; this.terrainBuffer = null;
    this.cellCounterBuffer = null; this.cellOffsetsBuffer = null;
    this.particleCellBuffer = null; this.sortedIdxBuffer = null; this.freeStackBuffer = null;
    this.simStateBuffer = null;

    this.computeBgl = null;
    this.computeBindGroup = null;
    this._pipes = null;

    this._uniforms = null;              // Rust 下发的物理参数契约
    this._terrainRef = null; this._terrainData = null; this._terrainDirty = false;
    this._grid = { gx: 3, gy: 3, gz: 2, cells: 18, cellSizeX: 1, cellSizeY: 1, cellSizeZ: 1, minX: 0, minY: 0, minZ: 0 };

    this._maxParticles = 0; this._allocKey = '';
    this._dtAccum = 0; this._spawnCarry = 0; this._stepSeq = 0;
    this._seed = 0x51ed270b;
    // 渲染实例回读：GL 层消费的存活粒子紧凑数组（6 float/粒子）+ 存活数（调试 HUD 亦读 aliveCount）。
    this.instances = new Float32Array(0);
    this.instancesView = null;
    this.instanceCount = 0;
    this.aliveCount = -1;
    this.evapMinFactor = 1;   // 蒸发速率下限（=_writeParams 推导；GL 调试着色定位红端）
    this._staging = null; this._stagingBytes = 0; this._stagingPending = false;

    const simCfg = (typeof window !== 'undefined' && window.SIM_CONFIG) || {};
    this._fallbackMax = Math.max(1, simCfg.rainParticleMax | 0 || 2048);
    this._hardMax = 65536;
    const rc = (typeof window !== 'undefined' && window.RENDER_CONFIG) || {};
    this._maxSubsteps = Math.max(1, rc.rainMaxSubsteps | 0 || 8);
    this._dtClamp = Number.isFinite(rc.rainDtClamp) ? rc.rainDtClamp : 0.25;
    this._neighborCap = Math.max(1, rc.rainNeighborCap | 0 || 32);

    this._paramsScratch = new ArrayBuffer(176);
    this._paramsF32 = new Float32Array(this._paramsScratch);
    this._paramsU32 = new Uint32Array(this._paramsScratch);
  }

  // Rust 下发的降水参数契约（READY / CONFIG / LOAD 后各调用一次）。
  setUniforms(u) {
    if (!u || typeof u !== 'object') return;
    this._uniforms = u;
  }

  async init(shaderSource) {
    if (!navigator.gpu || !shaderSource) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return false;
      this.device = await adapter.requestDevice();
      this.device.addEventListener('uncapturederror', e => console.error('[WebGPU][rain] uncaptured error:', e.error?.message || e.error));
      this.device.lost.then(info => console.error('[WebGPU][rain] device lost:', info.message || info.reason));

      const shader = this.device.createShaderModule({ code: shaderSource });
      if (typeof shader.getCompilationInfo === 'function') {
        const info = await shader.getCompilationInfo();
        const errors = (info.messages || []).filter(m => m.type === 'error');
        if (errors.length) throw new Error(errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
      }

      const checked = async (fn, label) => {
        this.device.pushErrorScope('validation');
        const value = fn();
        const error = await this.device.popErrorScope();
        if (error) throw new Error(`${label}: ${error.message}`);
        return value;
      };

      this.paramsBuffer = this.device.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

      // compute 绑定 0..8（1 uniform + 8 storage，默认 maxStorageBuffersPerShaderStage = 8）；
      // 模块内的 render 绑定 9..11 已无消费方（渲染迁至 GL），不建对应布局。
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
      const computeLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.computeBgl] });

      const mkPipe = (entryPoint) => this.device.createComputePipeline({
        layout: computeLayout,
        compute: { module: shader, entryPoint },
      });
      this._pipes = await checked(() => ({
        initState: mkPipe('initState'),
        spawn: mkPipe('spawn'),
        flowIntegrate: mkPipe('flowIntegrate'),
        evapGain: mkPipe('evapGain'),
        evict: mkPipe('evict'),
        gridClear: mkPipe('gridClear'),
        gridCount: mkPipe('gridCount'),
        gridScan: mkPipe('gridScan'),
        gridScatter: mkPipe('gridScatter'),
      }), 'compute pipelines');

      this.ready = true;
      console.info('[WebGPU][rain] initialized (compute only); Rust WGSL bytes:', shaderSource.length);
      return true;
    } catch (err) {
      this.failed = true;
      console.warn('[WebGPU] 降水层初始化失败：', err);
      return false;
    }
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
    this.particlesBuffer = dev.createBuffer({ size: mp * 64, usage: S | GPUBufferUsage.COPY_SRC });
    this.terrainBuffer = dev.createBuffer({ size: Math.max(16, tl * 4), usage: S });
    // 前半段 = 单元计数，后半段 = 散布游标（= 各段起点）。
    this.cellCounterBuffer = dev.createBuffer({ size: Math.max(16, nc * 2 * 4), usage: S });
    this.cellOffsetsBuffer = dev.createBuffer({ size: Math.max(16, (nc + 1) * 4), usage: S });
    this.particleCellBuffer = dev.createBuffer({ size: mp * 4, usage: S });
    this.sortedIdxBuffer = dev.createBuffer({ size: mp * 4, usage: S });
    this.freeStackBuffer = dev.createBuffer({ size: mp * 4, usage: S });
    // SimState：alive(u32) + freeTop(i32) + drawArgs[4]（内核写入的存活计数，渲染已迁 GL，
    // 该段保留为内核契约，不再用于间接绘制）。
    this.simStateBuffer = dev.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

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
  }

  _writeParams(spawnCount, stepSeq) {
    const f = this._paramsF32, u = this._paramsU32, g = this._grid, t = this._terrainData;
    const uni = this._uniforms || {};
    const rc = (typeof window !== 'undefined' && window.RENDER_CONFIG) || {};
    // ★ v1.64.9 重力大小：RENDER_CONFIG.rainGravity 覆盖内核契约值（缺失时回落 uni.gravity）。
    const gravity = Number.isFinite(rc.rainGravity) ? rc.rainGravity : (uni.gravity || 0);
    f[0] = t.worldSize; f[1] = t.gridW; f[2] = t.gridH; f[3] = 1 / 60;
    f[4] = gravity; f[5] = uni.spawn_height_base || 0; f[6] = uni.spawn_height_rand || 0; f[7] = uni.spawn_speed || 0;
    f[8] = uni.max_age_base || 0; f[9] = uni.max_age_rand || 0; f[10] = uni.fall_damp || 0; f[11] = uni.land_clearance || 0;
    f[12] = uni.ground_rest_lift || 0; f[13] = uni.flow_rest_lift || 0; f[14] = uni.flow_accel || 0; f[15] = uni.flow_speed_max || 0;
    f[16] = uni.flow_damp || 0; f[17] = uni.gradient_min_step || 0; f[18] = uni.attract || 0; f[19] = uni.repel || 0;
    f[20] = uni.force_scale || 0; f[21] = uni.reach_far || 0; f[22] = g.minX; f[23] = g.minY;
    f[24] = g.minZ; f[25] = g.cellSizeX; f[26] = g.cellSizeY; f[27] = g.cellSizeZ;
    u[28] = g.gx; u[29] = g.gy; u[30] = g.gz; u[31] = this._maxParticles;
    u[32] = spawnCount >>> 0; u[33] = this._seed >>> 0; u[34] = stepSeq >>> 0; u[35] = uni.force_valid === 1 ? 1 : 0;
    u[36] = this._neighborCap; u[37] = g.cells; u[38] = 0; u[39] = 0;
    // ★ v1.64.4 蒸发邻域增益：逐子步从 RENDER_CONFIG 读取（浮窗改值即热生效）。
    //   速率 = max(evapMinFactor, 1 − evapSlowPerNeighbor × min(邻居数, evapGainCap))。
    const evapRadius = Number.isFinite(rc.rainEvapNeighborRadius) ? Math.max(0, rc.rainEvapNeighborRadius) : 0;
    const evapSlow = Number.isFinite(rc.rainEvapSlowPerNeighbor) ? Math.max(0, rc.rainEvapSlowPerNeighbor) : 0;
    const evapCap = Number.isFinite(rc.rainEvapGainCap) ? Math.max(1, Math.round(rc.rainEvapGainCap)) : 1;
    f[40] = evapRadius;
    f[41] = evapSlow;
    f[42] = evapCap;
    // 速率下限（= 邻居数封顶时的蒸发速度）唯一推导点：既下发内核，也供 GL 调试着色定位红端。
    this.evapMinFactor = Math.min(1, Math.max(0.05, 1 - evapSlow * evapCap));
    f[43] = this.evapMinFactor;
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

  // 世界切换 / 重置 / 倒流：清空粒子槽与累加器（渲染实例同步失效，待下帧回读刷新）。
  reset() {
    this._dtAccum = 0; this._spawnCarry = 0; this._stepSeq = 0;
    this.aliveCount = -1;
    this.instanceCount = 0;
    this.instancesView = null;
    if (this.ready && this._pipes && this.computeBindGroup) this._dispatchInit();
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
    // B2 蒸发邻域统计（复用本子步 B 之前的网格，口径同邻域力），写 misc.z 供 C 缩放蒸发速度。
    cp.setPipeline(this._pipes.evapGain); cp.dispatchWorkgroups(Math.max(1, Math.ceil(mp / 64)));
    cp.setPipeline(this._pipes.evict); cp.dispatchWorkgroups(Math.max(1, Math.ceil(mp / 64)));
    cp.setPipeline(this._pipes.gridClear); cp.dispatchWorkgroups(Math.max(1, Math.ceil(nc / 256)));
    cp.setPipeline(this._pipes.gridCount); cp.dispatchWorkgroups(Math.max(1, Math.ceil(mp / 64)));
    cp.setPipeline(this._pipes.gridScan); cp.dispatchWorkgroups(1);
    cp.setPipeline(this._pipes.gridScatter); cp.dispatchWorkgroups(Math.max(1, Math.ceil(mp / 64)));
    cp.end();
    this.device.queue.submit([enc.finish()]);
  }

  // ── 渲染实例回读（每帧一次，供 GL 渲染层消费）─────────────────────────────
  // 回读整个粒子缓冲（Particle 16 float：pos.xyz@0..2、age=pos.w@3、misc.x=alive@12、
  // misc.y=falling@13、misc.z=邻域粒数@14、misc.w=蒸发速率@15），CPU 侧筛出存活粒子写成
  // 紧凑实例数组（6 float/粒子：x, y, z, age, falling, rate）。
  // 单缓冲 + 在途闸：一次 mapAsync 未完成前不发起下一次，数据最多滞后 1~2 帧。
  _ensureStaging() {
    const bytes = Math.max(16, this._maxParticles * 64);
    if (this._staging && this._stagingBytes === bytes) return true;
    if (this._stagingPending) return false;   // 在途回读结束前不换缓冲（避免销毁已 map 的缓冲）
    if (this._staging) { this._staging.destroy(); this._staging = null; }
    this._staging = this.device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this._stagingBytes = bytes;
    this.instances = new Float32Array(this._maxParticles * 6);
    this.instancesView = null;
    this.instanceCount = 0; this.aliveCount = -1;
    return true;
  }

  pullInstances() {
    if (!this.ready || !this.particlesBuffer) return;
    if (!this._ensureStaging()) return;
    if (this._stagingPending) return;
    const buf = this._staging;
    const bytes = this._stagingBytes;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.particlesBuffer, 0, buf, 0, bytes);
    this.device.queue.submit([enc.finish()]);
    this._stagingPending = true;
    buf.mapAsync(GPUMapMode.READ).then(() => {
      const src = new Float32Array(buf.getMappedRange(0, bytes));
      const dst = this.instances;
      const mp = this._maxParticles;
      let n = 0;
      for (let i = 0; i < mp; i++) {
        const o = i * 16;
        if (src[o + 12] <= 0.5) continue;      // misc.x = alive
        const d = n * 6;
        dst[d] = src[o]; dst[d + 1] = src[o + 1]; dst[d + 2] = src[o + 2];
        dst[d + 3] = src[o + 3];               // age = pos.w（寿命淡出）
        dst[d + 4] = src[o + 13];              // misc.y = falling
        dst[d + 5] = src[o + 15];              // misc.w = 蒸发速率（调试着色消费）
        n++;
      }
      this.instanceCount = n;
      this.aliveCount = n;
      this.instancesView = dst.subarray(0, n * 6);
      buf.unmap();
      this._stagingPending = false;
    }).catch(() => { this._stagingPending = false; });
  }
}
window.RainWebGPURenderer = RainWebGPURenderer;