// === WebGL 装饰渲染层（★ v1.50.83 石体切片 → ★ v1.50.84 全装饰：石头 + 花草木）===
// 职责：Boulder / RockCluster / Tree / Bush / GrassTuft（含资源景观子图元、花朵/春芽图元）
//   的 GPU 绘制。几何与配色**单一同源**：render_accents.js / render_bush.js / render_grass.js
//   的绘制函数在 sinkOn 期间把与 Canvas 路径逐位相同的屏幕空间图元（多边形 / 双曲面条带 /
//   折线描边 / 椭圆）按同一画序分发给本层，本层只做三角化 + 解析式边缘抗锯齿 + 深度对齐 GL 地形。
//
// 画风不变红线（改本文件前必读）：
//   1. 顶点/颜色全部来自 Canvas 绘制函数的 sink 分发（受光公式单一入口 = lighting.js 经
//      render_accents.js::accentLitFill），本层**严禁**复制任何几何/光照公式；
//   2. 画序 = Canvas 画序，标准 alpha 混合 + 逐三角形解析 AA（重心坐标 × 每边像素距离，
//      1px 覆盖率渐变；三角剖分内部边不做 AA 防接缝透底）；
//   3. 描边 = miter 展开条带：相邻条带共享横截面边（内部旗标 0）⇒ 无接缝、无双重混色，
//      与 Canvas 单 path stroke 的覆盖语义一致；圆头 = 端点外侧半圆扇（与条带不重叠，
//      跨段重叠行为与 Canvas 逐段 stroke 一致）；
//   4. 深度只用于与 GL 地形正确遮挡（锚点世界深度 + 1 世界单位朝相机偏置防 z-fighting，
//      NDC z 系数与 projection-utils.js::getAxonometricMatrix 的 sz=-0.0005 逐位一致）；
//      **深度写入关闭** ⇒ 图元之间仍按收集序（画家算法）叠放，与 Canvas 一致；
//   5. 阴影归 WebGLShadowPass 阴影图（世界空间代理几何 → 光向深度 → GL 地形采样变暗），
//      本层**不再手绘任何阴影贴片**（v1.50.84 起：贴地投影/接触影在 GL 模式下全部省略）。
//
// 图层过渡限制（用户已确认暂不处理）：装饰绘制在底层 `#sim-canvas-gl` 上，位于 2D 覆盖层
//   之下——与 2D 实体的跨画布遮挡在阶段四实体层迁移后自然消除（31 号迁移方案 §8）。
//
// 零 GC 纪律（对齐 TA-11-6）：顶点写入模块级 Float32Array（容量不足倍增，稳态零分配）；
//   描边 miter 偏移与条带展平走预分配 Float64Array 刮擦；每帧仅 endFrame 一次 subarray 上传。
//
// 依赖全局: camera、MAP_Z_LIFT（render_depth_queue.js）、window.RENDER_CONFIG。
//   加载顺序：core/context.js → core/shader-manager.js → 本文件 → shadow-pass.js
//   （实例化在 render_canvas.js 的惰性块，与 TerrainWebGLRenderer 同源）。

// 与 projection-utils.js::getAxonometricMatrix 的 sz 常量逐位一致（世界深度 → NDC z）。
var _ACCENT_DEPTH_TO_NDC = -0.0005;
// 锚点深度朝相机偏置（世界单位）：抵消贴地图元与地形表面的深度贴脸，防 z-fighting。
var _ACCENT_DEPTH_BIAS = 1.0;
// 椭圆扇形剖分段数（凸多边形，解析 AA 只在 rim 边缘）。
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
// 折线描边圆头半圆扇段数。
var _CAP_N = 6;
// 石体剪影环点刮擦（profileStroke 暂存环点后复用 _mitP 刮擦计算偏移）。
var _STONE_RING_X = new Float64Array(16);
var _STONE_RING_Y = new Float64Array(16);

class WebGLAccentRenderer {
  constructor(webglContext, shaderManager) {
    this.gl = webglContext.GL;
    this.manager = shaderManager || new ShaderManager(this.gl);
    this.program = null;
    this.vao = null;
    this.vbo = null;
    this.isReadyFlag = false;
    this._sinkOn = false;   // beginFrame..endFrame 之间为 true（绘制函数 sink 分发开关）
    this._z = 0;            // 当前图元 NDC 深度（beginAccent 刷新）
    this._fCount = 0;       // CPU 顶点缓冲已写浮点数（13 floats/vertex）
    this._cpu = new Float32Array(13 * 6 * 1024); // 1024 quad 起步容量，不足倍增
    // 描边 miter 偏移刮擦（n ≤ 32：树干轮廓 18 / 曲线展平 ≤ 17）
    this._mitPX = new Float64Array(32);
    this._mitPY = new Float64Array(32);
    this._mitMX = new Float64Array(32);
    this._mitMY = new Float64Array(32);
    // ribbonQuad 双曲线展平刮擦
    this._rbLx = new Float64Array(17); this._rbLy = new Float64Array(17);
    this._rbRx = new Float64Array(17); this._rbRy = new Float64Array(17);
  }

  async init() {
    const vsSource = `#version 300 es
      precision highp float;
      in vec2 a_pos;    // 屏幕坐标（CSS px，y 向下）
      in float a_z;     // NDC 深度（与世界深度线性，对齐 GL 地形）
      in vec4 a_col;    // RGBA（0..1，与 Canvas fillStyle 同源数值）
      in vec3 a_ef;     // 每边像素距离系数：d_i = bary_i × ef_i（ef_i = 2|A|/|edge_i|）
      in vec3 a_bnd;    // 每边边界旗标（1 = 轮廓边做 AA；0 = 三角剖分内部边不 AA）
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
        vec3 d = v_bary * v_ef;
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
      console.log('[WebGL] WebGLAccentRenderer initialized successfully');
      return true;
    } catch (e) {
      console.error('[WebGL] WebGLAccentRenderer init failed:', e);
      this.isReadyFlag = false;
      return false;
    }
  }

  isReady() {
    return this.isReadyFlag && !!this.program;
  }

  // ── 帧编排（render_canvas.js 调用）────────────────────────────────────────
  // beginFrame：深度队列收集前置位 sink；endFrame：收集后整批提交 GPU（同一 GL 帧、
  // 不清屏，深度对齐本帧 GL 地形）。GL 地形未渲染的帧不进入 sink，装饰走 Canvas 现状路径。
  beginFrame() {
    if (!this.isReady()) return;
    this._sinkOn = true;
    this._fCount = 0;
  }

  get sinkOn() {
    return this._sinkOn && this.isReady();
  }

  // beginAccent：登记装饰世界锚点 → NDC 深度（含 MAP_Z_LIFT 抬升与朝相机偏置）。
  // 各绘制函数（drawAccentTree/Bush/GrassTuft/Boulder/RockCluster）在 sink 分发前调用。
  beginAccent(wx, wy, wz) {
    const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
    const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
    const ry = wx * sinZ + wy * cosZ;
    const depth = ry * sinX + ((wz || 0) + MAP_Z_LIFT) * cosX;
    this._z = _ACCENT_DEPTH_TO_NDC * (depth + _ACCENT_DEPTH_BIAS);
  }

  // endFrame：整批提交。混合 + 深度测试开、深度写入关（图元间保持画家序；
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

  // ── sink 图元接收（绘制函数分发；签名与 Canvas 画序逐位对应）────────────────

  // 四边形面片（石体侧面等）：Canvas path [p0,p1,p2,p3] 一次 fill → 对角剖分（对角线内部边不 AA）
  quad(x0, y0, x1, y1, x2, y2, x3, y3, r, g, b, a) {
    this._tri(x0, y0, x1, y1, x2, y2, r, g, b, a, 1, 0, 1);
    this._tri(x0, y0, x2, y2, x3, y3, r, g, b, a, 1, 1, 0);
  }

  // 凸多边形填充（质心扇形；辐条内部边不 AA，rim 边 AA）——石体顶面等
  polyRing(xs, ys, n, yOff, r, g, b, a) {
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += xs[i]; cy += ys[i] + yOff; }
    cx /= n; cy /= n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this._tri(cx, cy, xs[i], ys[i] + yOff, xs[j], ys[j] + yOff, r, g, b, a, 1, 0, 0);
    }
  }

  // 椭圆填充（rgba 数值直传，零字符串分配）——叶簇 / 花点 / 春芽 / 石影等
  ellipseRGBA(cx, cy, rx, ry, r, g, b, a) {
    if (rx <= 0 || ry <= 0 || a <= 0) return;
    for (let i = 0; i < _EL_N; i++) {
      const x0 = cx + rx * _EL_COS[i], y0 = cy + ry * _EL_SIN[i];
      const x1 = cx + rx * _EL_COS[i + 1], y1 = cy + ry * _EL_SIN[i + 1];
      this._tri(cx, cy, x0, y0, x1, y1, r, g, b, a, 1, 0, 0);
    }
  }

  // 旋转椭圆填充（cx,cy = 屏幕中心；rot = 屏幕弧度，语义对齐 Canvas
  // translate→rotate→ellipse(0..2π) 后的等效屏幕椭圆）——鱼身影子等。
  ellipseRotRGBA(cx, cy, rx, ry, rot, r, g, b, a) {
    if (rx <= 0 || ry <= 0 || a <= 0) return;
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < _EL_N; i++) {
      const u0 = rx * _EL_COS[i], v0 = ry * _EL_SIN[i];
      const u1 = rx * _EL_COS[i + 1], v1 = ry * _EL_SIN[i + 1];
      this._tri(cx, cy,
        cx + u0 * c - v0 * s, cy + u0 * s + v0 * c,
        cx + u1 * c - v1 * s, cy + u1 * s + v1 * c,
        r, g, b, a, 1, 0, 0);
    }
  }

  // 折线描边（miter join；closed=闭环无端帽；roundCap=端点外侧半圆，Canvas lineCap='round' 语义）。
  // 调用方传 Canvas 同一笔迹的点列（曲线需先展平）；横截面边内部旗标 ⇒ 与 Canvas 单 path
  // stroke 覆盖语义一致（无接缝、无双重混色）。
  polyStroke(xs, ys, n, closed, width, r, g, b, a, roundCap) {
    const half = width * 0.5;
    if (half < 0.02 || n < 2 || n > 32) return;
    const pX = this._mitPX, pY = this._mitPY, mX = this._mitMX, mY = this._mitMY;
    for (let i = 0; i < n; i++) {
      const ip = closed ? (i + n - 1) % n : Math.max(0, i - 1);
      const iq = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      let dxp = xs[i] - xs[ip], dyp = ys[i] - ys[ip];
      let dxq = xs[iq] - xs[i], dyq = ys[iq] - ys[i];
      let lp = Math.hypot(dxp, dyp), lq = Math.hypot(dxq, dyq);
      if (lp < 1e-9) { dxp = dxq; dyp = dyq; lp = lq; }
      if (lq < 1e-9) { dxq = dxp; dyq = dyp; lq = lp; }
      const npx = -dyp / lp, npy = dxp / lp;
      const nqx = -dyq / lq, nqy = dxq / lq;
      let mx = npx + nqx, my = npy + nqy;
      const ml = Math.hypot(mx, my);
      let dot;
      if (ml < 1e-9) { mx = nqx; my = nqy; dot = 1; }
      else { mx /= ml; my /= ml; dot = mx * nqx + my * nqy; }
      const s = half / Math.max(dot, 0.25);
      pX[i] = xs[i] + mx * s; pY[i] = ys[i] + my * s;
      mX[i] = xs[i] - mx * s; mY[i] = ys[i] - my * s;
    }
    const segN = closed ? n : n - 1;
    for (let i = 0; i < segN; i++) {
      const j = (i + 1) % n;
      this._tri(pX[i], pY[i], mX[i], mY[i], mX[j], mY[j], r, g, b, a, 1, 0, 0);
      this._tri(pX[i], pY[i], mX[j], mY[j], pX[j], pY[j], r, g, b, a, 0, 1, 0);
    }
    if (!closed && roundCap) {
      // 端点外侧半圆（从横截面一端扫到另一端，经过背向折线方向的外侧，与条带无重叠）
      const th0 = Math.atan2(ys[1] - ys[0], xs[1] - xs[0]) + Math.PI;      // 起端外向
      const th1 = Math.atan2(ys[n - 1] - ys[n - 2], xs[n - 1] - xs[n - 2]); // 末端外向
      this._capFan(xs[0], ys[0], th0, half, r, g, b, a);
      this._capFan(xs[n - 1], ys[n - 1], th1, half, r, g, b, a);
    }
  }

  // 石体剪影描边（drawStoneBody 消费）：闭环 miter 展开条带；远侧取顶环 / 近侧取底环
  // （ry 符号判据与 Canvas 逐位一致）；相邻条带共享横截面边（内部边不 AA）⇒ 无接缝、
  // 无双重混色；描边色 = Canvas 'rgba(40, 36, 30, 0.75)' 同源常量。
  profileStroke(xs, ry, gy, n, yOff, width) {
    const half = width * 0.5;
    if (half < 0.02) return;
    const ringX = _STONE_RING_X, ringY = _STONE_RING_Y;
    for (let i = 0; i < n; i++) {
      ringX[i] = xs[i];
      ringY[i] = ry[i] < 0 ? gy[i] + yOff : gy[i];
    }
    const pX = this._mitPX, pY = this._mitPY, mX = this._mitMX, mY = this._mitMY;
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n, q = (i + 1) % n;
      let d0x = ringX[i] - ringX[p], d0y = ringY[i] - ringY[p];
      let d1x = ringX[q] - ringX[i], d1y = ringY[q] - ringY[i];
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
      pX[i] = ringX[i] + mx * s; pY[i] = ringY[i] + my * s;
      mX[i] = ringX[i] - mx * s; mY[i] = ringY[i] - my * s;
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this._tri(pX[i], pY[i], mX[i], mY[i], mX[j], mY[j], 40 / 255, 36 / 255, 30 / 255, 0.75, 1, 0, 0);
      this._tri(pX[i], pY[i], mX[j], mY[j], pX[j], pY[j], 40 / 255, 36 / 255, 30 / 255, 0.75, 0, 1, 0);
    }
  }

  // 圆头端帽半圆扇（中心 cx,cy，外向角 thOut ± π/2）
  _capFan(cx, cy, thOut, half, r, g, b, a) {
    const a0 = thOut - Math.PI / 2, step = Math.PI / _CAP_N;
    for (let k = 0; k < _CAP_N; k++) {
      const t0 = a0 + k * step, t1 = t0 + step;
      this._tri(cx, cy,
        cx + Math.cos(t0) * half, cy + Math.sin(t0) * half,
        cx + Math.cos(t1) * half, cy + Math.sin(t1) * half,
        r, g, b, a, 1, 0, 0);
    }
  }

  // 树干主体：左右两条二次贝塞尔边之间的条带填充（对 Canvas moveTo/quad/line/quad/close
  // 一次 fill 的精确三角化——不假设凸性，逐 quad 剖分；端部横截面 = 顶边/底边）。
  ribbonQuad(lx0, ly0, lcx, lcy, lx1, ly1,
             rx0, ry0, rcx, rcy, rx1, ry1, r, g, b, a) {
    const N = 8;
    this._flatQuad(this._rbLx, this._rbLy, lx0, ly0, lcx, lcy, lx1, ly1, N);
    this._flatQuad(this._rbRx, this._rbRy, rx0, ry0, rcx, rcy, rx1, ry1, N);
    const Lx = this._rbLx, Ly = this._rbLy, Rx = this._rbRx, Ry = this._rbRy;
    for (let i = 0; i < N; i++) {
      const j = i + 1;
      // tri(Li, Lj, Rj)：对边 Lj→Rj 仅末段为顶边（轮廓），其余为内部横截面
      this._tri(Lx[i], Ly[i], Lx[j], Ly[j], Rx[j], Ry[j], r, g, b, a, i === N - 1 ? 1 : 0, 0, 1);
      // tri(Li, Rj, Ri)：对边 Li→Ri 仅首段为底边（轮廓），对边 Ri→Rj 为右曲线（轮廓）
      this._tri(Lx[i], Ly[i], Rx[j], Ry[j], Rx[i], Ry[i], r, g, b, a, 1, i === 0 ? 1 : 0, 0);
    }
  }

  _flatQuad(outX, outY, x0, y0, cx, cy, x1, y1, n) {
    for (let i = 0; i <= n; i++) {
      const t = i / n, mt = 1 - t;
      outX[i] = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
      outY[i] = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    }
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

window.WebGLAccentRenderer = WebGLAccentRenderer;
