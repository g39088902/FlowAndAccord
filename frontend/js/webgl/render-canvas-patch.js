/**
 * WebGL Integration Patch for render_canvas.js (Phase 1-2)
 * 
 * 此文件提供 render_canvas.js::render(now) 函数的 WebGL 集成补丁。
 * 使用方法：将此路径替换到 render_canvas.js 的相关位置，或手动合并以下代码。
 * 
 * 依赖文件已在 index.html 中按顺序加载:
 *   1. webgl/core/context.js
 *   2. webgl/core/shader-manager.js  
 *   3. webgl/utils/projection-utils.js
 *   4. webgl/fallback-handler.js
 *   5. webgl/layers/terrain/test-grid.js
 */

// ==========================================
// ★ Phase 1-2: WebGL 混合渲染主循环补丁
// ==========================================

// 在文件顶部添加变量声明 (如尚未存在):
if (typeof webglTestRenderer === 'undefined') {
  window.webglTestRenderer = null;
}

/**
 * WebGL 测试渲染器初始化（懒加载）
 */
async function initWebglTestRenderer() {
  if (!window.USE_WEBGL || window.USE_WEBGL === false) {
    console.log('[WebGL] Disabled by config');
    return null;
  }
  
  if (!window.webglContext?.isReady()) {
    console.warn('[WebGL] Context not ready');
    return null;
  }
  
  if (webglTestRenderer) {
    return webglTestRenderer; // Already initialized
  }
  
  const canvas = document.querySelector('#main-canvas');
  
  // 初始化 Shader Manager
  if (!window.webglManager) {
    window.webglManager = new ShaderManager(window.webglContext.GL);
  }
  
  // 创建测试渲染器
  webglTestRenderer = new TestGridRenderer(window.webglContext, window.webglManager);
  
  try {
    await webglTestRenderer.init();
    console.log('[WebGL] Phase 1 PoC renderer initialized');
    window.WEBGL_MIGRATION_PHASE = 'phase1-complete';
    return webglTestRenderer;
  } catch (e) {
    console.error('[WebGL] Initialization failed:', e);
    window.USE_WEBGL = false;
    return null;
  }
}

/**
 * WebGL 渲染调用（替代 Canvas 2D 的 ctx.clearRect 及后续绘制）
 * 返回 true 表示使用 WebGL 渲染（应跳过 Canvas 2D）
 */
async function maybeRenderWebgl(w, h, sim) {
  const shouldUseWebgl = window.fallbackManager?.shouldUseWebgl();
  
  if (!shouldUseWebgl) {
    return false;
  }
  
  // 首次调用时初始化
  if (!webglTestRenderer) {
    const rendered = await initWebglTestRenderer();
    if (!rendered) {
      return false;
    }
  }
  
  if (!webglTestRenderer || !window.webglContext) {
    return false;
  }
  
  // WebGL 渲染上下文
  const gl = window.webglContext.GL;
  gl.viewport(0, 0, w, h);
  gl.clearColor(0.4, 0.6, 0.8, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  
  // 计算投影矩阵 (正交投影简化版)
  const aspect = w / h;
  const fov = 1.0;
  const near = 0.1;
  const far = 200.0;
  const projMatrix = ProjectionUtils.perspective(fov, aspect, near, far);
  
  // View matrix (从 camera 对象提取简化视图)
  const camPos = { x: 0, y: 0, z: 50 };
  const viewMatrix = ProjectionUtils.lookAt(camPos);
  
  // 渲染测试网格
  webglTestRenderer.render(projMatrix, viewMatrix);
  
  // 记录性能统计
  dbgRenderMs = 0;
  dbgTerrainRenderedCells = 0;
  
  return true; // WebGL 已处理本帧渲染
}

// ==========================================
// 使用方式说明
// ==========================================
/*
在 render_canvas.js::render(now) 函数中：

1. 在 "w = window.innerWidth; h = window.innerHeight;" 之后插入:

```javascript
  // ★ Phase 1: 尝试 WebGL 渲染
  (async () => {
    const webglHandled = await maybeRenderWebgl(w, h, sim);
    if (webglHandled) {
      return; // WebGL 已处理本帧，跳过 Canvas 2D
    }
  })();
```

2. 将原有的 `ctx.clearRect(0, 0, w, h);` 行**保留**,Canvas 2D 逻辑会正常执行
   - 当 WebGL 未就绪时，会自动回退到 Canvas 2D
   - 当用户访问 `?webgl=0` 时，也会回退到 Canvas 2D

3. **验证日志**:
   - Chrome DevTools Console 应输出:
     ```
     [WebGL] Initialized: 2.0 on ...
     [Fallback] Mode set to auto
     [WebGL] Phase 1 PoC renderer initialized
     ```
   - 浏览器应显示绿色→棕色渐变网格
   - 鼠标控制视角旋转/缩放有效

*/

// ==========================================
// Main.js 初始化补丁
// ==========================================
/*
在 main.js::initialize() 函数中添加:

```javascript
// ★ Phase 1-2: 初始化 WebGL 上下文
window.USE_WEBGL = window.RENDER_CONFIG?.useWebgl !== false;

if (window.USE_WEBGL) {
  const canvas = document.querySelector('#main-canvas');
  window.webglContext = new WebGLContext(canvas);
  
  if (!window.webglContext.isReady()) {
    console.warn('[WebGL] Hardware acceleration not available');
    window.USE_WEBGL = false;
  } else {
    window.fallbackManager = new RenderFallbackManager();
    console.log('[WebGL] Fallback manager initialized');
  }
}
```
*/
