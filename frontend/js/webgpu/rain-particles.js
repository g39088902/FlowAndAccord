// === WebGPU 降水粒子渲染层（纯渲染） =======================================
// 粒子物理已由 Rust 在 world_tick 中确定性推进，并经快照下发（sim.rainParticles）。
// 本层每帧只把粒子状态写入 storage buffer 并投影绘制；不再 dispatch 任何 compute，
// 因此水随 tick 走：暂停即冻结、倍速即加速、读档续演、跨设备一致。
class RainWebGPURenderer {
  constructor(canvas) {
    this.canvas = canvas; this.device = null; this.context = null; this.format = null;
    this.renderPipeline = null; this.renderBindGroup = null;
    this.cameraBuffer = null; this.particlesBuffer = null;
    this.ready = false; this.failed = false;
    this.maxParticles = 2048; this._scratch = null;
  }
  // 按需扩容粒子 storage buffer：内核 `rainParticleMax` 可在调试页调大，
  // 快照下发的粒子数随之增长；这里保证缓冲始终容得下当前帧全部粒子。
  _ensureCapacity(n) {
    if (n <= this.maxParticles) return;
    const cap = Math.max(n, this.maxParticles * 2);
    if (this.particlesBuffer) this.particlesBuffer.destroy();
    this.particlesBuffer = this.device.createBuffer({ size: cap * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.maxParticles = cap;
    this._scratch = new Float32Array(cap * 12);
    this.renderBindGroup = this.device.createBindGroup({ layout: this.renderPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.cameraBuffer } },
      { binding: 1, resource: { buffer: this.particlesBuffer } },
    ] });
  }
  async init(shaderSource) {
    if (!navigator.gpu || !this.canvas || !shaderSource) return false;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); if (!adapter) return false;
      this.device = await adapter.requestDevice(); this.context = this.canvas.getContext('webgpu');
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
      const checked = async (fn, label) => {
        this.device.pushErrorScope('validation');
        const value = fn();
        const error = await this.device.popErrorScope();
        if (error) throw new Error(`${label}: ${error.message}`);
        return value;
      };
      this.cameraBuffer = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      // 每个粒子 3 个 vec4（pos / prev / flags）= 48 字节，与 WGSL Particle 结构对齐。
      this.particlesBuffer = this.device.createBuffer({ size: this.maxParticles * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.renderPipeline = await checked(() => this.device.createRenderPipeline({
        layout: 'auto', vertex: { module: shader, entryPoint: 'renderVertex' },
        fragment: { module: shader, entryPoint: 'renderFragment', targets: [{ format: this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
        primitive: { topology: 'triangle-list' },
      }), 'render pipeline');
      this.renderBindGroup = await checked(() => this.device.createBindGroup({ layout: this.renderPipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.particlesBuffer } },
      ] }), 'render bind group');
      this._scratch = new Float32Array(this.maxParticles * 12);
      this.ready = true;
      console.info('[WebGPU][rain] initialized (render-only); Rust WGSL bytes:', shaderSource.length);
      return true;
    } catch (err) { this.failed = true; console.warn('[WebGPU] 降水渲染初始化失败：', err); return false; }
  }
  resize() {
    if (!this.canvas || !this.context) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const w = Math.max(1, Math.floor(window.innerWidth * dpr)), h = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w; this.canvas.height = h;
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
  }
  render(sim, camera, width, height) {
    if (!this.ready || !sim || !camera) return;
    this.resize();
    const list = Array.isArray(sim.rainParticles) ? sim.rainParticles : [];
    this._ensureCapacity(list.length);
    const n = Math.min(list.length, this.maxParticles);
    const arr = this._scratch;
    for (let i = 0; i < n; i++) {
      const p = list[i]; const o = i * 12;
      arr[o] = p.x; arr[o + 1] = p.y; arr[o + 2] = p.z; arr[o + 3] = 0;
      arr[o + 4] = p.prev_x; arr[o + 5] = p.prev_y; arr[o + 6] = p.prev_z; arr[o + 7] = 0;
      arr[o + 8] = p.age; arr[o + 9] = p.max_age; arr[o + 10] = 1; arr[o + 11] = p.falling ? 1 : 0;
    }
    if (n > 0) this.device.queue.writeBuffer(this.particlesBuffer, 0, arr, 0, n * 12);
    // 第 8 个分量 = 立方体半边长（世界单位），由 RENDER_CONFIG.rainCubeHalf 提供，
    // 与 rain.wgsl 的 Camera.cubeHalf 对齐；调试页改值即时生效。
    const cubeHalf = (window.RENDER_CONFIG && Number.isFinite(window.RENDER_CONFIG.rainCubeHalf))
      ? window.RENDER_CONFIG.rainCubeHalf : 6.0;
    const c = new Float32Array([width, height, camera.panX, camera.panY, camera.rotX, camera.rotZ, camera.zoom, cubeHalf]);
    this.device.queue.writeBuffer(this.cameraBuffer, 0, c);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
    if (n > 0) {
      pass.setPipeline(this.renderPipeline);
      pass.setBindGroup(0, this.renderBindGroup);
      pass.draw(36, n); // 每实例一个立方体：6 面 × 2 三角形 × 3 顶点
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
window.RainWebGPURenderer = RainWebGPURenderer;