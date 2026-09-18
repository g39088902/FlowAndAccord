// === WebGL 石体渲染层（石头绘制 Canvas 2D → WebGL 迁移 · 阶段三石体切片）===
// 职责：Boulder / RockCluster（含资源景观子石，render_landscapes.js 经 drawAccentBoulder /
//   drawAccentRockCluster 复用同一图元）的 GPU 绘制。几何与配色**单一同源**：
//   render_accents.js::drawStoneBody / drawAccentRockCluster 在 sinkOn 期间把与 Canvas
//   路径逐位相同的屏幕空间图元（侧面 quad / 顶面多边形 / 剪影描边 / 接触阴影椭圆）按
//   同一画序分发给本层，本层只做三角化 + 解析式边缘抗锯齿 + 深度对齐 GL 地形。
//
// 画风不变红线（改本文件前必读）：
//   1. 顶点/颜色全部来自同一份 drawStoneBody 数学（受光公式单一入口 = lighting.js 经
//      render_accents.js::accentLitFill，本层**严禁**复制任何几何/光照公式）；
//   2. 画序 = Canvas 画序（簇接触阴影 → 侧面片 → 顶面 → 剪影描边），标准 alpha 混合 +
//      逐三角形解析 AA（重心坐标 × 每边像素距离，1px 覆盖率渐变），边缘观感对齐
//      Canvas 2D fill/stroke 的抗锯齿；
//   3. 深度只用于与 GL 地形正确遮挡（石体锚点世界深度 + 1 世界单位朝相机偏置防
//      z-fighting，NDC z 系数与 projection-utils.js::getAxonometricMatrix 的 sz=-0.0005
//      逐位一致）；**深度写入关闭** ⇒ 石体之间仍按收集序（画家算法）叠放，与 Canvas 一致；
//   4. 唯一允许的观感新增：boulderGroundShadow()——Boulder 的 WebGL 地面投影阴影
//      （单石现状无任何阴影；视觉语言对齐 RockCluster 接触影，α/开关走 RENDER_CONFIG）。
//
// 图层过渡限制（用户已确认暂不处理）：石体绘制在底层 `#sim-canvas-gl` 上，位于 2D
//   覆盖层之下——与 2D 实体（族人/房屋/树木等）的跨画布遮挡关系在阶段四实体层迁移后
//   自然消除（31 号迁移方案 §8）。
//
// 零 GC 纪律（对齐 TA-11-6）：顶点写入模块级 Float32Array（容量不足倍增，稳态零分配）；
//   剪影 miter 展开走预分配 Float64Array 刮擦；每帧仅 endFrame 一次 subarray 视图上传。
//
// 依赖全局: camera、MAP_Z_LIFT（render_depth_queue.js）、lightShadowOffset（render_world.js）、
//   window.RENDER_CONFIG。加载顺序：core/context.js → core/shader-manager.js → 本文件
//   （实例化在 render_canvas.js 的惰性块，与 TerrainWebGLRenderer 同源）。

// 与 projection-utils.js::getAxonometricMatrix 的 sz 常量逐位一致（世界深度 → NDC z）。
var _STONE_DEPTH_TO_NDC = -0.0005;
// 石体锚点深度朝相机偏置（世界单位）：抵消石体底环与地形表面的深度贴脸，防 z-fighting。
var _STONE_DEPTH_BIAS = 1.0;
// 接触阴影/投影尾椭圆的扇形剖分段数（凸多边形，解析 AA 只在 rim 边缘）。
var _EL_N = 24;
var _EL_COS = new Float64Array(_EL_N + 1);
var _EL_SIN = new Float64Array(_EL_N + 1);
(function () {
  for (var i = 0; i <= _EL_N; i++) {
    var a = (i / _EL_N) * Math.PI * 2;
    _EL_COS[i] = Math.cos(a);
    _EL_SIN[i] = Math.sin(a);
  }
})();

class WebGLStoneRenderer {
  constructor(webglContext, shaderManager) {
    this.gl = webglContext.GL;
    this.manager = shaderManager || new ShaderManager(this.gl);
    this.program = null;
    this.vao = null;
    this.vbo = null;
    this.isReadyFlag = false;
    this._sinkOn = false;   // beginFrame..endFrame 之间为 true（drawStoneBody sink 分发开关）
    this._z = 0;            // 当前石体 NDC 深度（beginStone 刷新；quad/poly/ellipse 消费）
    this._fCount = 0;       // CPU 顶点缓冲已写浮点数（13 floats/vertex）
    this._cpu = new Float32Array(13 * 6 * 512); // 512 个 quad 起步容量，不足倍增
    // 剪影 miter 展开刮擦（sides ≤ 8，容量冗余）
    this._ringX = new Float64Array(16);
    this._ringY = new Float64Array(16);
    this._mitPX = new Float64Array(16);
    this._mitPY = new Float64Array(16);
    this._mitMX = new Float64Array(16);
    this._mitMY = new Float64Array(16);
    this._so = { x: 0, y: 0, alphaScale: 1 }; // 阴影偏移刮擦（lightShadowOffset out 参数消费）
  }

  async init() {
    const vsSource = `#version 300 es
      precision highp float;
      in vec2 a_pos;    // 屏幕坐标（CSS px，y 向下）
      in float a_z;     // NDC 深度（与世界深度线性，对齐 GL 地形）
      in vec4 a_col;    // RGBA（0..1，与 Canvas fillStyle 同源数值）
      in vec3 a_ef;     // 每边像素距离系数：d_i = bary_i × ef_i（ef_i = 2|A|/|edge_i|）
      in vec3 a_bnd;    // 每边边界旗标（1 = 多边形轮廓边做 AA；0 = 三角剖分内部边不 AA）
      uniform vec2 u_half;
      out vec4 v_col;
      out vec3 v_ef;
      out vec3 v_bnd;
      out vec3 v_bary;
      void main() {
        vec2 ndc = vec2(a_pos.x / u_half.x - 1.0, 1.0 - a_pos.y / u_half.y);
        gl_Position = vec4(ndc, a_z, 1.0);
        v_col = a_col;
        v_ef = a_ef;
        v_bnd = a_bnd;
        // 每个三角形 3 个顶点连续存放：按 gl_VertexID 还原重心坐标基
        int k = gl_VertexID - 3 * (gl_VertexID / 3);
        v_bary = (k == 0) ? vec3(1.0, 0.0, 0.0)
               : (k == 1) ? vec3(0.0, 1.0, 0.0)
               : vec3(0.0, 0.0, 1.0);
      }
    `;
    const fsSource = `#version 300 es
      precision mediump float;
      in vec4 v_col;
      in vec3 v_ef;
      in vec3 v_bnd;
      in vec3 v_bary;
      out vec4 outColor;
      void main() {
        // d_i = 到第 i 条边所在直线的像素距离（三角形容器内恒为正，与绕向无关）
        vec3 d = v_bary * v_ef;
        // 1px 覆盖率渐变对齐 Canvas 2D fill/stroke 抗锯齿；内部边全保留防接缝透明
        vec3 cov = clamp(d + 0.5, 0.0, 1.0);
        cov = mix(vec3(1.0), cov, v_bnd);
        float a = min(cov.x, min(cov.y, cov.z));
        if (a <= 0.003) discard;
        outColor = vec4(v_col.rgb, v_col.a * a);
      }
    `;
    try {
      this.program = await this.manager.loadProgram(vsSource, fsSource);
      const gl = this.gl;
      this.vao = gl.createVertexArray();
      this.vbo = gl.createBuffer();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      const S = 52; // 13 floats × 4 bytes
      const aPos = gl.getAttribLocation(this.program, 'a_pos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, S, 0);
      const aZ = gl.getAttribLocation(this.program, 'a_z');
      gl.enableVertexAttribArray(aZ);
      gl.vertexAttribPointer(aZ, 1, gl.FLOAT, false, S, 8);
      const aCol = gl.getAttribLocation(this.program, 'a_col');
      gl.enableVertexAttribArray(aCol);
      gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, S, 12);
      const aEf = gl.getAttribLocation(this.program, 'a_ef');
      gl.enableVertexAttribArray(aEf);
      gl.vertexAttribPointer(aEf, 3, gl.FLOAT, false, S, 28);
      const aBnd = gl.getAttribLocation(this.program, 'a_bnd');
      gl.enableVertexAttribArray(aBnd);
      gl.vertexAttribPointer(aBnd, 3, gl.FLOAT, false, S, 40);
      gl.bindVertexArray(null);
      this.isReadyFlag = true;
      console.log('[WebGL] WebGLStoneRenderer initialized successfully');
      return true;
    } catch (e) {
      console.error('[WebGL] WebGLStoneRenderer init failed:', e);
      this.isReadyFlag = false;
      return false;
    }
  }

  isReady() {
    return this.isReadyFlag && !!this.program;
  }

  // ── 帧编排（render_canvas.js 调用）────────────────────────────────────────
  // beginFrame：深度队列收集前置位 sink；endFrame：收集后整批提交 GPU（同一 GL 帧、
  // 不清屏，深度对齐本帧 GL 地形）。GL 地形未渲染的帧不进入 sink，石体走 Canvas 现状路径。
  beginFrame() {
    if (!this.isReady()) return;
    this._sinkOn = true;
    this._fCount = 0;
  }

  get sinkOn() {
    return this._sinkOn && this.isReady();
  }

  // beginStone：登记石体世界锚点 → NDC 深度（含 MAP_Z_LIFT 抬升与朝相机偏置）。
  // Boulder 在 drawAccentBoulder 调用；RockCluster 在簇首调用（整簇同深，画家序不变）。
  beginStone(wx, wy, wz) {
    const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
    const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
    const ry = wx * sinZ + wy * cosZ;
    const depth = ry * sinX + ((wz || 0) + MAP_Z_LIFT) * cosX;
    this._z = _STONE_DEPTH_TO_NDC * (depth + _STONE_DEPTH_BIAS);
  }

  // endFrame：整批提交。混合 + 深度测试开、深度写入关（石体间保持画家序；
  // 对 GL 地形读深度实现「山前可见 / 山后正确被遮」）。
  endFrame(w, h) {
    this._sinkOn = false;
    if (!this.isReady()) return;
    const n = this._fCount;
    if (n === 0) return;
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this._cpu.subarray(0, n), gl.STREAM_DRAW);
    const uh = this.manager.getUniformLocation(this.program, 'u_half');
    gl.uniform2f(uh, w * 0.5, h * 0.5);
    gl.drawArrays(gl.TRIANGLES, 0, n / 13);
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  // ── sink 图元接收（render_accents.js 分发；签名与 Canvas 画序逐位对应）──────

  // 侧面片：Canvas path [b0,b1,t1,t0] 一次 fill → 对角剖分 2 三角形（对角线内部边不 AA）
  quad(x0, y0, x1, y1, x2, y2, x3, y3, r, g, b, a) {
    this._tri(x0, y0, x1, y1, x2, y2, r, g, b, a, 1, 0, 1);
    this._tri(x0, y0, x2, y2, x3, y3, r, g, b, a, 1, 1, 0);
  }

  // 顶面多边形：Canvas n 边形一次 fill → 质心扇形剖分（辐条内部边不 AA，rim 边 AA）
  polyRing(xs, ys, n, yOff, r, g, b, a) {
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += xs[i]; cy += ys[i] + yOff; }
    cx /= n; cy /= n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this._tri(cx, cy, xs[i], ys[i] + yOff, xs[j], ys[j] + yOff, r, g, b, a, 1, 0, 0);
    }
  }

  // 接触阴影椭圆（rgba 数值直传，零字符串分配）
  ellipseRGBA(cx, cy, rx, ry, r, g, b, a) {
    if (rx <= 0 || ry <= 0 || a <= 0) return;
    for (let i = 0; i < _EL_N; i++) {
      const x0 = cx + rx * _EL_COS[i], y0 = cy + ry * _EL_SIN[i];
      const x1 = cx + rx * _EL_COS[i + 1], y1 = cy + ry * _EL_SIN[i + 1];
      this._tri(cx, cy, x0, y0, x1, y1, r, g, b, a, 1, 0, 0);
    }
  }

  // 剪影描边：Canvas 闭环 stroke（miter join）→ 逐边 miter 展开条带。
  // 相邻条带共享横截面边（内部边不 AA）⇒ 无接缝、无双重混色；长边轮廓 AA 对齐 Canvas。
  // 与 Canvas miter join 语义一致（夹角过锐时限幅 4×half，Canvas 默认限制 10，视觉差异亚像素）。
  profileStroke(xs, ry, gy, n, yOff, width) {
    const half = width * 0.5;
    if (half < 0.02) return;
    const rX = this._ringX, rY = this._ringY;
    for (let i = 0; i < n; i++) {
      rX[i] = xs[i];
      rY[i] = ry[i] < 0 ? gy[i] + yOff : gy[i]; // 远侧取顶环 / 近侧取底环（与 Canvas 判据逐位一致）
    }
    const pX = this._mitPX, pY = this._mitPY, mX = this._mitMX, mY = this._mitMY;
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n, q = (i + 1) % n;
      let d0x = rX[i] - rX[p], d0y = rY[i] - rY[p];
      let d1x = rX[q] - rX[i], d1y = rY[q] - rY[i];
      let l0 = Math.hypot(d0x, d0y), l1 = Math.hypot(d1x, d1y);
      if (l0 < 1e-9) { d0x = d1x; d0y = d1y; l0 = l1; }
      if (l1 < 1e-9) { d1x = d0x; d1y = d0y; l1 = l0; }
      let n0x = -d0y / l0, n0y = d0x / l0;
      let n1x = -d1y / l1, n1y = d1x / l1;
      let mx = n0x + n1x, my = n0y + n1y;
      const ml = Math.hypot(mx, my);
      let dot;
      if (ml < 1e-9) { mx = n1x; my = n1y; dot = 1; }
      else { mx /= ml; my /= ml; dot = mx * n1x + my * n1y; }
      const s = half / Math.max(dot, 0.25);
      pX[i] = rX[i] + mx * s; pY[i] = rY[i] + my * s;
      mX[i] = rX[i] - mx * s; mY[i] = rY[i] - my * s;
    }
    // 剪影描边色 = Canvas 'rgba(40, 36, 30, 0.75)'（drawStoneBody 同源常量）
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this._tri(pX[i], pY[i], mX[i], mY[i], mX[j], mY[j], 40 / 255, 36 / 255, 30 / 255, 0.75, 1, 0, 0);
      this._tri(pX[i], pY[i], mX[j], mY[j], pX[j], pY[j], 40 / 255, 36 / 255, 30 / 255, 0.75, 0, 1, 0);
    }
  }

  // ── Boulder 地面投影阴影（★ 唯一允许的观感新增；Canvas 路径不受影响）────────
  // 单石现状无任何阴影，与树/灌木/石群的语言不齐；此处按 RockCluster 接触影同一视觉
  // 语言补：接地接触椭圆 + 沿世界光向拉长的柔和投影尾（lightShadowOffset 世界光向投影，
  // 随季节/相机旋转）。α 与开关走 RENDER_CONFIG.stoneWebglShadow*。
  boulderGroundShadow(sx, sy, scaled) {
    const RC = window.RENDER_CONFIG || {};
    if (RC.stoneWebglShadowEnabled === false) return;
    if (typeof lightShadowOffset === 'function') lightShadowOffset(0.6, 1.2, 0.4, this._so);
    else { this._so.x = 0.6 * camera.zoom; this._so.y = 1.2 * camera.zoom; this._so.alphaScale = 1; }
    const r = 6 * scaled; // 与 drawAccentBoulder 石体屏幕半径同源（6 × accent.scale × zoom）
    const aS = this._so.alphaScale;
    // 接触落底影（对齐 RockCluster 逐石接触椭圆比例 1.08/0.45，略放大补偿单石无簇影）
    this.ellipseRGBA(sx + this._so.x * 0.4, sy + this._so.y * 0.3, r * 1.12, r * 0.48,
      25 / 255, 20 / 255, 15 / 255, (RC.stoneWebglShadowAlpha != null ? RC.stoneWebglShadowAlpha : 0.10) * aS);
    // 沿世界光向的柔和投影尾（WebGL 新增语言，弱于接触影）
    this.ellipseRGBA(sx + this._so.x * 2.2, sy + this._so.y * 1.7, r * 0.82, r * 0.30,
      25 / 255, 20 / 255, 15 / 255, (RC.stoneWebglCastAlpha != null ? RC.stoneWebglCastAlpha : 0.055) * aS);
  }

  // ── 内部：顶点写入与三角化 ────────────────────────────────────────────────
  _v(x, y, r, g, b, a, ef0, ef1, ef2, b0, b1, b2) {
    let c = this._fCount;
    let buf = this._cpu;
    if (c + 13 > buf.length) {
      const nb = new Float32Array(buf.length * 2);
      nb.set(buf);
      this._cpu = buf = nb;
    }
    buf[c] = x; buf[c + 1] = y; buf[c + 2] = this._z;
    buf[c + 3] = r; buf[c + 4] = g; buf[c + 5] = b; buf[c + 6] = a;
    buf[c + 7] = ef0; buf[c + 8] = ef1; buf[c + 9] = ef2;
    buf[c + 10] = b0; buf[c + 11] = b1; buf[c + 12] = b2;
    this._fCount = c + 13;
  }

  // 三角形发射：b_i 为「顶点 i 对边」的边界旗标；ef_i = 2|A|/|edge_i|（像素距离系数）。
  // 重心插值 d_i = bary_i × ef_i 在仿射管线（w=1）下逐像素线性，内部恒正——绕向无关。
  _tri(x0, y0, x1, y1, x2, y2, r, g, b, a, b0, b1, b2) {
    const area2 = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    const a2 = Math.abs(area2);
    if (a2 < 1e-9) return; // 退化三角形跳过（Canvas 对零面积 path 无笔迹，语义一致）
    const l0 = Math.hypot(x2 - x1, y2 - y1);
    const l1 = Math.hypot(x2 - x0, y2 - y0);
    const l2 = Math.hypot(x1 - x0, y1 - y0);
    const ef0 = a2 / (l0 > 1e-6 ? l0 : 1e-6);
    const ef1 = a2 / (l1 > 1e-6 ? l1 : 1e-6);
    const ef2 = a2 / (l2 > 1e-6 ? l2 : 1e-6);
    this._v(x0, y0, r, g, b, a, ef0, ef1, ef2, b0, b1, b2);
    this._v(x1, y1, r, g, b, a, ef0, ef1, ef2, b0, b1, b2);
    this._v(x2, y2, r, g, b, a, ef0, ef1, ef2, b0, b1, b2);
  }
}

window.WebGLStoneRenderer = WebGLStoneRenderer;
