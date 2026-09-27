// === WebGPU 降水粒子 compute + render 层 ===================================
// 粒子池、运动、斥力和蒸发全部在 GPU storage buffer / compute shader 中执行。
// Rust/WASM 通过快照提供地形与降雨倍率；CPU 不再逐粒子推进。
class RainWebGPURenderer {
  constructor(canvas) {
    this.canvas = canvas; this.device = null; this.context = null; this.format = null;
    this.computePipeline = null; this.spawnPipeline = null; this.renderPipeline = null;
    this.computeBindGroup = null; this.renderBindGroup = null; this.paramsBuffer = null;
    this.cameraBuffer = null; this.particlesBuffer = null; this.heightsBuffer = null; this.stateBuffer = null;
    this.ready = false; this.failed = false; this.lastTime = 0; this.frame = 0;
    this.terrainRef = null; this.terrainSize = 0; this.worldGeneration = 0;
    this.maxParticles = 320; this.heightCapacity = 256 * 256;
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
      this.paramsBuffer = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.cameraBuffer = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.particlesBuffer = this.device.createBuffer({ size: this.maxParticles * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.heightsBuffer = this.device.createBuffer({ size: this.heightCapacity * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.stateBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const makePipeline = async (descriptor, label) => {
        this.device.pushErrorScope('validation');
        const pipeline = this.device.createComputePipeline(descriptor);
        const error = await this.device.popErrorScope();
        if (error) throw new Error(`${label}: ${error.message}`);
        return pipeline;
      };
      const checked = async (fn, label) => {
        this.device.pushErrorScope('validation');
        const value = fn();
        const error = await this.device.popErrorScope();
        if (error) throw new Error(`${label}: ${error.message}`);
        return value;
      };
      this.spawnPipeline = await makePipeline({ layout: 'auto', compute: { module: shader, entryPoint: 'spawnMain' } }, 'spawn pipeline');
      this.computePipeline = await makePipeline({ layout: 'auto', compute: { module: shader, entryPoint: 'updateMain' } }, 'update pipeline');
      this.renderPipeline = await checked(() => this.device.createRenderPipeline({
        layout: 'auto', vertex: { module: shader, entryPoint: 'renderVertex' },
        fragment: { module: shader, entryPoint: 'renderFragment', targets: [{ format: this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
        primitive: { topology: 'triangle-list' },
      }), 'render pipeline');
      this.computeBindGroup = await checked(() => this.device.createBindGroup({ layout: this.computePipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } }, { binding: 1, resource: { buffer: this.particlesBuffer } },
        { binding: 2, resource: { buffer: this.heightsBuffer } },
      ] }), 'update bind group');
      this.spawnBindGroup = await checked(() => this.device.createBindGroup({ layout: this.spawnPipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } }, { binding: 1, resource: { buffer: this.particlesBuffer } },
        { binding: 2, resource: { buffer: this.heightsBuffer } }, { binding: 3, resource: { buffer: this.stateBuffer } },
      ] }), 'spawn bind group');
      this.renderBindGroup = await checked(() => this.device.createBindGroup({ layout: this.renderPipeline.getBindGroupLayout(1), entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } }, { binding: 1, resource: { buffer: this.particlesBuffer } },
      ] }), 'render bind group');
      this.ready = true;
      console.info('[WebGPU][rain] initialized; Rust WGSL bytes:', shaderSource.length);
      return true;
    } catch (err) { this.failed = true; console.warn('[WebGPU] 降水 compute 初始化失败：', err); return false; }
  }
  _uploadTerrain(sim) {
    const t=sim&&sim.terrain; if(!t||!t.cells||!t.gridSize||!t.worldSize)return false;
    if(this.terrainRef===t.cells&&this.terrainSize===t.gridSize)return true;
    const n=t.gridSize*t.gridSize; if(n>this.heightCapacity)return false; const h=new Float32Array(n);for(let i=0;i<n;i++)h[i]=Number(t.cells[i].elev)||0;
    this.device.queue.writeBuffer(this.heightsBuffer,0,h);this.terrainRef=t.cells;this.terrainSize=t.gridSize;this.worldGeneration++;this.device.queue.writeBuffer(this.particlesBuffer,0,new Uint8Array(this.maxParticles*64));
    const state=new ArrayBuffer(16);new DataView(state).setUint32(4,(Number(sim._engineSeed)||Date.now())>>>0,true);this.device.queue.writeBuffer(this.stateBuffer,0,new Uint8Array(state));return true;
  }
  resize(){if(!this.canvas||!this.context)return;const dpr=Math.min(window.devicePixelRatio||1,1.25);const w=Math.max(1,Math.floor(window.innerWidth*dpr)),h=Math.max(1,Math.floor(window.innerHeight*dpr));if(this.canvas.width===w&&this.canvas.height===h)return;this.canvas.width=w;this.canvas.height=h;this.context.configure({device:this.device,format:this.format,alphaMode:'premultiplied'});}
  render(sim,camera,width,height,now){if(!this.ready||!sim||!camera||!this._uploadTerrain(sim))return;this.resize();const stamp=now||performance.now();const dt=this.lastTime?Math.min(0.05,Math.max(0,(stamp-this.lastTime)/1000)):0;this.lastTime=stamp;const p=new ArrayBuffer(32),pd=new DataView(p);const rainfall=Number(sim.rainfallMultiplier);pd.setFloat32(0,dt,true);pd.setFloat32(4,Number.isFinite(rainfall)?rainfall:1.0,true);pd.setFloat32(8,sim.terrain.worldSize,true);pd.setUint32(12,sim.terrain.gridSize,true);pd.setUint32(16,sim.terrain.gridSize,true);pd.setUint32(20,this.frame++,true);this.device.queue.writeBuffer(this.paramsBuffer,0,new Uint8Array(p));const c=new Float32Array([width,height,camera.panX,camera.panY,camera.rotX,camera.rotZ,camera.zoom,0]);this.device.queue.writeBuffer(this.cameraBuffer,0,c);const e=this.device.createCommandEncoder();let pass=e.beginComputePass();pass.setPipeline(this.spawnPipeline);pass.setBindGroup(0,this.spawnBindGroup);pass.dispatchWorkgroups(1);pass.setPipeline(this.computePipeline);pass.setBindGroup(0,this.computeBindGroup);pass.dispatchWorkgroups(Math.ceil(this.maxParticles/64));pass.end();const rp=e.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});rp.setPipeline(this.renderPipeline);rp.setBindGroup(1,this.renderBindGroup);rp.draw(6,this.maxParticles);rp.end();this.device.queue.submit([e.finish()]);if(this.frame===3)console.info('[WebGPU][rain] first frames submitted ' + JSON.stringify({dt,rainfall,grid:sim.terrain.gridSize,world:sim.terrain.worldSize,viewport:[width,height]}));}
}
window.RainWebGPURenderer=RainWebGPURenderer;
