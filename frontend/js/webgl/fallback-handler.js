// === WebGL Fallback Handler ===
// 职责：Canvas 2D ↔ WebGL 无缝切换管理

class RenderFallbackManager {
  constructor() {
    this.enabled = !!window.USE_WEBGL;
    this.currentMode = 'auto'; // 'webgl' | 'canvas2d' | 'auto'
    this.webglSupported = false;
    
    this.detectSupport();
  }
  
  detectSupport() {
    if (!this.enabled) {
      console.log('[Fallback] WebGL disabled by config');
      return;
    }
    
    if (window.webglContext?.isReady()) {
      this.webglSupported = true;
      console.log('[Fallback] WebGL supported');
      return;
    }
    
    const canvas = document.querySelector('#sim-canvas');
    if (!canvas) {
      console.warn('[Fallback] Canvas not found');
      return;
    }
    
    try {
      if (window.webglContext) {
        this.webglSupported = window.webglContext.isReady();
      } else {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        this.webglSupported = !!gl;
      }
      if (this.webglSupported) {
        console.log('[Fallback] WebGL supported');
      } else {
        console.warn('[Fallback] WebGL not available');
      }
    } catch (e) {
      console.error('[Fallback] Detection failed:', e);
    }
  }
  
  setMode(mode) {
    if (['webgl', 'canvas2d', 'auto'].includes(mode)) {
      this.currentMode = mode;
      console.log(`[Fallback] Mode set to ${mode}`);
    }
  }
  
  shouldUseWebgl() {
    if (this.currentMode === 'canvas2d') return false;
    if (this.currentMode === 'webgl') return true;
    // auto: 根据支持情况判断
    return this.enabled && this.webglSupported && !!window.webglContext?.isReady();
  }
  
  renderFrame(now, sim) {
    if (this.shouldUseWebgl()) {
      return this.renderWebgl(now, sim);
    } else {
      return this.renderCanvas2D(now, sim);
    }
  }
  
  renderWebgl(now, sim) {
    // WebGL 渲染将在具体 renderer 中实现
    console.warn('[Fallback] WebGL renderer not initialized yet');
    return false;
  }
  
  renderCanvas2D(now, sim) {
    // 调用现有的 Canvas 2D 渲染
    // 注意：render_canvas.js 已经有主循环，这里只是标记
    // 实际逻辑在 render_canvas.js::render() 中
    return true;
  }
}

window.fallbackManager = new RenderFallbackManager();
