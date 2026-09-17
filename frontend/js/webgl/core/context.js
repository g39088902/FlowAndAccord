// === WebGL 上下文管理 ===
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
        depth: true,
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
      const dbgExt = this.gl.getExtension('WEBGL_debug_renderer_info');
      if (dbgExt) {
        this.vendor = this.gl.getParameter(dbgExt.UNMASKED_VENDOR_WEBGL) || 'unknown';
        this.renderer = this.gl.getParameter(dbgExt.UNMASKED_RENDERER_WEBGL) || 'unknown';
      } else {
        this.vendor = this.gl.getParameter(this.gl.VENDOR) || 'unknown';
        this.renderer = this.gl.getParameter(this.gl.RENDERER) || 'unknown';
      }
      
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
