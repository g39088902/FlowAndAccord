// === WebGL 真实世界地形与沙盘渲染器 (Phase 2 地形层迁移) ===
// 职责：将 sim.terrain.cells 网格与沙盘四周侧壁完整渲染到 WebGL 画布上
// 开启三维深度测试，确保地貌实体厚重、无自交穿透、无半透明重叠。

class TerrainWebGLRenderer {
  constructor(webglContext, shaderManager) {
    this.gl = webglContext.GL;
    this.manager = shaderManager || new ShaderManager(this.gl);
    this.program = null;
    this.vao = null;
    this.vboPos = null;
    this.vboColor = null;
    this.vertexCount = 0;
    this.lastGridRev = '';
    this.lastColorRev = '';
    this.isReadyFlag = false;
  }

  async init() {
    const vsSource = `#version 300 es
      precision highp float;
      in vec3 a_position;
      in vec3 a_color;
      uniform mat4 u_matrix;
      out vec3 v_color;
      out vec3 v_world;
      void main() {
        gl_Position = u_matrix * vec4(a_position, 1.0);
        v_color = a_color;
        v_world = a_position; // 世界坐标供阴影图采样（WebGLShadowPass）
      }
    `;

    const fsSource = `#version 300 es
      precision mediump float;
      in vec3 v_color;
      in vec3 v_world;
      uniform sampler2D u_shadowMap;
      uniform mat4 u_lightMat;
      uniform float u_shadowOn;
      uniform float u_shadowStrength;
      out vec4 outColor;
      void main() {
        float lit = 1.0;
        if (u_shadowOn > 0.5) {
          // 世界 → 光向 NDC → 深度图 UV/深度（仿射，w=1）
          vec3 p = (u_lightMat * vec4(v_world, 1.0)).xyz * 0.5 + 0.5;
          if (p.x > 0.001 && p.x < 0.999 && p.y > 0.001 && p.y < 0.999 && p.z < 1.0) {
            // 中心 + 4 tap PCF（1 texel），深度偏移防自遮挡哨兵
            float sh = 0.0;
            sh += texture(u_shadowMap, p.xy).r;
            sh += texture(u_shadowMap, p.xy + vec2(1.0 / 2048.0, 0.0)).r;
            sh += texture(u_shadowMap, p.xy - vec2(1.0 / 2048.0, 0.0)).r;
            sh += texture(u_shadowMap, p.xy + vec2(0.0, 1.0 / 2048.0)).r;
            sh += texture(u_shadowMap, p.xy - vec2(0.0, 1.0 / 2048.0)).r;
            sh /= 5.0;
            float inShadow = (p.z - 0.0012 > sh) ? 1.0 : 0.0;
            lit = 1.0 - u_shadowStrength * inShadow;
          }
        }
        outColor = vec4(v_color * lit, 1.0);
      }
    `;

    try {
      this.program = await this.manager.loadProgram(vsSource, fsSource);
      this.vao = this.gl.createVertexArray();
      this.vboPos = this.gl.createBuffer();
      this.vboColor = this.gl.createBuffer();
      this.isReadyFlag = true;
      console.log('[WebGL] TerrainWebGLRenderer initialized successfully');
      return true;
    } catch (e) {
      console.error('[WebGL] TerrainWebGLRenderer init failed:', e);
      this.isReadyFlag = false;
      return false;
    }
  }

  isReady() {
    return this.isReadyFlag && !!this.program;
  }

  parseColor(colorStr) {
    if (!colorStr) return [0.4, 0.6, 0.3];
    if (colorStr.charCodeAt(0) === 35) { // '#'
      let hex = colorStr.slice(1);
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      const num = parseInt(hex, 16);
      return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
    }
    if (colorStr.startsWith('rgb')) {
      const match = colorStr.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        return [parseFloat(match[1]) / 255, parseFloat(match[2]) / 255, parseFloat(match[3]) / 255];
      }
    }
    return [0.4, 0.6, 0.3];
  }

  /**
   * 从 sim.terrain 构建或更新 GPU 网格缓冲（包含地表网格与四周垂直侧壁）
   */
  updateMesh(terrain) {
    if (!terrain || !terrain.cells || terrain.cells.length === 0) return;
    const gSize = terrain.gridSize;
    if (!gSize || gSize < 2) return;

    const N = gSize - 1;
    const cells = terrain.cells;
    const terrainQuads = N * N;
    const wallQuads = N * 4; // 四周边界侧壁段
    const totalQuads = terrainQuads + wallQuads;
    const totalVertices = totalQuads * 6;

    const minZ = terrain.minZ != null ? terrain.minZ : 0;
    const skirtElev = minZ - 16;

    // 检查几何结构是否需要更新
    const gridRev = `${gSize}_${cells.length}_${terrain.minZ}_${terrain.maxZ}`;
    const needsGeometryRebuild = (gridRev !== this.lastGridRev);

    // 检查颜色是否需要更新
    const firstCell = cells[0];
    const midCell = cells[Math.floor(cells.length / 2)];
    const colorRev = `${firstCell?.color}_${midCell?.color}`;
    const needsColorUpdate = needsGeometryRebuild || (colorRev !== this.lastColorRev);

    if (needsGeometryRebuild) {
      const posData = new Float32Array(totalVertices * 3);
      let pIdx = 0;

      // 1. 地表网格面片
      for (let gy = 0; gy < N; gy++) {
        const row0 = gy * gSize;
        const row1 = row0 + gSize;
        for (let gx = 0; gx < N; gx++) {
          const i00 = row0 + gx;
          const i10 = i00 + 1;
          const i11 = row1 + gx + 1;
          const i01 = row1 + gx;

          const c00 = cells[i00], c10 = cells[i10], c11 = cells[i11], c01 = cells[i01];

          // 三角形 1: c00, c10, c01
          posData[pIdx++] = c00.wx; posData[pIdx++] = c00.wy; posData[pIdx++] = c00.elev;
          posData[pIdx++] = c10.wx; posData[pIdx++] = c10.wy; posData[pIdx++] = c10.elev;
          posData[pIdx++] = c01.wx; posData[pIdx++] = c01.wy; posData[pIdx++] = c01.elev;

          // 三角形 2: c01, c10, c11
          posData[pIdx++] = c01.wx; posData[pIdx++] = c01.wy; posData[pIdx++] = c01.elev;
          posData[pIdx++] = c10.wx; posData[pIdx++] = c10.wy; posData[pIdx++] = c10.elev;
          posData[pIdx++] = c11.wx; posData[pIdx++] = c11.wy; posData[pIdx++] = c11.elev;
        }
      }

      // 2. 沙盘四周侧壁 (北、西、南、东)
      const wallDefs = [
        { first: 0, step: 1 },              // 北: y=0, x 从 0 到 N-1
        { first: 0, step: gSize },          // 西: x=0, y 从 0 到 N-1
        { first: N * gSize, step: 1 },      // 南: y=N, x 从 0 到 N-1
        { first: N, step: gSize }           // 东: x=N, y 从 0 到 N-1
      ];

      for (let wi = 0; wi < 4; wi++) {
        const wd = wallDefs[wi];
        for (let k = 0; k < N; k++) {
          const c0 = cells[wd.first + k * wd.step];
          const c1 = cells[wd.first + (k + 1) * wd.step];

          // 侧壁垂直 quad: (c0, c1, B1) 和 (c0, B1, B0)
          // B0/B1 为下垂到 skirtElev 的地底顶点
          // 三角形 1
          posData[pIdx++] = c0.wx; posData[pIdx++] = c0.wy; posData[pIdx++] = c0.elev;
          posData[pIdx++] = c1.wx; posData[pIdx++] = c1.wy; posData[pIdx++] = c1.elev;
          posData[pIdx++] = c1.wx; posData[pIdx++] = c1.wy; posData[pIdx++] = skirtElev;

          // 三角形 2
          posData[pIdx++] = c0.wx; posData[pIdx++] = c0.wy; posData[pIdx++] = c0.elev;
          posData[pIdx++] = c1.wx; posData[pIdx++] = c1.wy; posData[pIdx++] = skirtElev;
          posData[pIdx++] = c0.wx; posData[pIdx++] = c0.wy; posData[pIdx++] = skirtElev;
        }
      }

      this.gl.bindVertexArray(this.vao);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vboPos);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, posData, this.gl.DYNAMIC_DRAW);

      const aPosLoc = this.gl.getAttribLocation(this.program, 'a_position');
      this.gl.enableVertexAttribArray(aPosLoc);
      this.gl.vertexAttribPointer(aPosLoc, 3, this.gl.FLOAT, false, 0, 0);

      this.vertexCount = totalVertices;
      this.lastGridRev = gridRev;
    }

    if (needsColorUpdate) {
      const colorData = new Float32Array(totalVertices * 3);
      let cIdx = 0;

      // 1. 地表网格颜色
      for (let gy = 0; gy < N; gy++) {
        const row0 = gy * gSize;
        const row1 = row0 + gSize;
        for (let gx = 0; gx < N; gx++) {
          const i00 = row0 + gx;
          const i10 = i00 + 1;
          const i11 = row1 + gx + 1;
          const i01 = row1 + gx;

          const c00 = cells[i00];
          const col00 = this.parseColor(c00.color || '#4b7a42');
          const col10 = this.parseColor(cells[i10]?.color || c00.color);
          const col11 = this.parseColor(cells[i11]?.color || c00.color);
          const col01 = this.parseColor(cells[i01]?.color || c00.color);

          // 三角形 1
          colorData[cIdx++] = col00[0]; colorData[cIdx++] = col00[1]; colorData[cIdx++] = col00[2];
          colorData[cIdx++] = col10[0]; colorData[cIdx++] = col10[1]; colorData[cIdx++] = col10[2];
          colorData[cIdx++] = col01[0]; colorData[cIdx++] = col01[1]; colorData[cIdx++] = col01[2];

          // 三角形 2
          colorData[cIdx++] = col01[0]; colorData[cIdx++] = col01[1]; colorData[cIdx++] = col01[2];
          colorData[cIdx++] = col10[0]; colorData[cIdx++] = col10[1]; colorData[cIdx++] = col10[2];
          colorData[cIdx++] = col11[0]; colorData[cIdx++] = col11[1]; colorData[cIdx++] = col11[2];
        }
      }

      // 2. 沙盘四周侧壁颜色 (微暗深色泥土底座: #3a3229 ~ rgb(58, 50, 41))
      const wallColor = [0.28, 0.24, 0.20];
      const wallVertexCount = wallQuads * 6;
      for (let vi = 0; vi < wallVertexCount; vi++) {
        colorData[cIdx++] = wallColor[0];
        colorData[cIdx++] = wallColor[1];
        colorData[cIdx++] = wallColor[2];
      }

      this.gl.bindVertexArray(this.vao);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vboColor);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, colorData, this.gl.DYNAMIC_DRAW);

      const aColLoc = this.gl.getAttribLocation(this.program, 'a_color');
      this.gl.enableVertexAttribArray(aColLoc);
      this.gl.vertexAttribPointer(aColLoc, 3, this.gl.FLOAT, false, 0, 0);

      this.lastColorRev = colorRev;
    }
  }

  /**
   * 渲染地形与沙盘
   */
  render(camera, w, h, sim) {
    if (!this.isReady() || !sim?.terrain?.cells) return;

    this.updateMesh(sim.terrain);
    if (this.vertexCount === 0) return;

    const gl = this.gl;
    // 使用物理像素填充完整视口
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // 启用三维深度测试：近处遮挡远处，彻底杜绝穿透
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // 清屏深色自然天幕
    gl.clearColor(0.09, 0.12, 0.16, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // 计算精准对齐的斜二测变换矩阵
    const matrix = ProjectionUtils.getAxonometricMatrix(camera, w, h);
    const uMatrixLoc = this.manager.getUniformLocation(this.program, 'u_matrix');
    gl.uniformMatrix4fv(uMatrixLoc, false, matrix);

    // ★ v1.50.84 阴影图采样：装饰世界代理几何（WebGLShadowPass）沿光向深度 → 阴影内变暗。
    //   阴影层缺席/光向退化时 u_shadowOn=0，地形外观与 v1.50.83 逐位一致。
    const sp = window.WebGLShadowPass;
    if (sp && sp.isReady() && sp.hasShadow()) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sp.depthTexture);
      gl.uniform1i(this.manager.getUniformLocation(this.program, 'u_shadowMap'), 0);
      gl.uniformMatrix4fv(this.manager.getUniformLocation(this.program, 'u_lightMat'), false, sp.lightMatrix);
      gl.uniform1f(this.manager.getUniformLocation(this.program, 'u_shadowStrength'), sp.strength);
      gl.uniform1f(this.manager.getUniformLocation(this.program, 'u_shadowOn'), 1);
    } else {
      gl.uniform1f(this.manager.getUniformLocation(this.program, 'u_shadowOn'), 0);
    }

    // 渲染全部地表网格与侧壁
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
  }
}

window.TerrainWebGLRenderer = TerrainWebGLRenderer;
