// === WebGL 真实世界地形与沙盘渲染器 (Phase 2 地形层迁移) ===
// 职责：将 sim.terrain.cells 网格与沙盘四周侧壁完整渲染到 WebGL 画布上
// 开启三维深度测试，确保地貌实体厚重、无自交穿透、无半透明重叠。
// ★ v1.50.90 光照进 shader（方案 C）：顶点 shader 直译 lighting.js::shadeAlbedoInto 唯一公式
//   （逐顶点受光 → 插值 v_color，与 CPU 逐格烘焙→角点插值语义逐位同构）；法线/AO/反照率来自
//   rustworld.js 世界建缓存预存数组（terr.nx/ny/nz/ao/albR/G/B，世界静态）→ vboShade 一次上传，
//   光档变化只剩 uniform 更新（lightRev 闸）——退役 cell.color→parseColor→vboColor 烘焙链。
// ★ v1.50.95 阴影接收面收口：装饰阴影图只作用于地表（a_side=0）；沙盘侧壁（a_side=1）跳过采样
//   ——侧壁自地表垂直下探至 skirtElev，沿光向深度恒大于任何装饰代理，斜投影会把贴地影的图案
//   拉花到崖面（「影子投到地图边缘垂直墙」鬼影）。

class TerrainWebGLRenderer {
  constructor(webglContext, shaderManager) {
    this.gl = webglContext.GL;
    this.manager = shaderManager || new ShaderManager(this.gl);
    this.program = null;
    this.vao = null;
    this.vboPos = null;
    this.vboShade = null;       // ★ v1.50.90 法线/AO/反照率/侧壁旗标（8 float/顶点，世界静态）
    this.vertexCount = 0;
    this.lastGridRev = '';
    this.lastMaterialRev = '';
    this.attrib = {};           // attribute location 缓存（init 一次）
    this.u = {};                // uniform location 缓存（init 一次）
    this._lastLightRev = -1;    // 光照 uniform 上传闸（-1 = 首帧必传）
    this.isReadyFlag = false;
  }

  async init() {
    // 顶点 shader：shadeAlbedoInto（lighting.js L192-210）直译。侧壁（a_side=1）保持
    // 固定平色 u_wallColor（现状语义）；地表按预存法线/AO/反照率受光。
    // ★ v1.50.95：额外透传 v_side 给片元——片元阴影项对侧壁短路（见 fsSource 注释）。
    const vsSource = `#version 300 es
      precision highp float;
      in vec3 a_position;   // 世界坐标（含侧壁垂底顶点）
      in vec3 a_normal;     // 单位法线（预存 terr.nx/ny/nz；侧壁朝外）
      in float a_ao;        // 坡度 AO
      in vec3 a_albedo;     // 无光反照率 0-255（侧壁占位 0）
      in float a_side;      // 1=侧壁 / 0=地表
      uniform mat4 u_matrix;
      uniform vec3 u_lightDir;     // 世界光向（SimLighting S.lx/ly/lz）
      uniform vec4 u_lightParams;  // (amb, inv=1-amb, kMin, kMax)
      uniform vec4 u_lightMisc;    // (wrap, invWrap, inten, washA)
      uniform vec3 u_lightTint;    // (tr, tg, tb)
      uniform vec3 u_lightWash;    // (washR, washG, washB) JS 侧已 /255
      uniform vec3 u_wallColor;
      out vec3 v_color;
      out vec3 v_world;
      out float v_side;     // ★ v1.50.95 侧壁旗标透传（片元阴影项对侧壁短路）
      void main() {
        gl_Position = u_matrix * vec4(a_position, 1.0);
        v_world = a_position; // 世界坐标供阴影图采样（WebGLShadowPass）
        v_side = a_side;
        if (a_side > 0.5) {
          v_color = u_wallColor; // 侧壁固定平色（现状语义；★ v1.50.95 起不再乘阴影因子）
        } else {
          // shadeAlbedoInto 直译：wrap 漫反射 → (amb+inv·wd)·ao·inten → 钳制 → tint → 色洗
          vec3 n = normalize(a_normal);
          float dotNL = clamp(dot(n, u_lightDir), -1.0, 1.0);
          float wd = clamp((dotNL + u_lightMisc.x) * u_lightMisc.y, 0.0, 1.0);
          float k = clamp((u_lightParams.x + u_lightParams.y * wd) * a_ao * u_lightMisc.z,
                          u_lightParams.z, u_lightParams.w);
          vec3 lit = clamp(a_albedo * (1.0 / 255.0) * k * u_lightTint, 0.0, 1.0);
          v_color = mix(lit, u_lightWash, u_lightMisc.w);
        }
      }
    `;

    // 片元 shader：v_color × 阴影图 PCF（★ v1.50.95 起仅地表采样，侧壁跳过）。
    // 纹样层（TerrainTexture 对应物）预留 v_texCoord，31 号 §6.2 阶段四落地。
    const fsSource = `#version 300 es
      precision mediump float;
      in vec3 v_color;
      in vec3 v_world;
      in float v_side;
      uniform sampler2D u_shadowMap;
      uniform mat4 u_lightMat;
      uniform float u_shadowOn;
      uniform float u_shadowStrength;
      out vec4 outColor;
      void main() {
        float lit = 1.0;
        // ★ v1.50.95 侧壁（v_side=1）短路：阴影图只含装饰代理（树/灌木/石），且侧壁顶点自地表
        //   垂直下探至 skirtElev——沿光向的深度恒大于任何代理，「落影图案」被斜投影拉花到整个
        //   崖面（贴地影随崖壁垂直拉伸的错位鬼影）。侧壁为固定平色边界面（u_wallColor，现状语义
        //   本就不接收装饰影），故跳过阴影采样，恢复 v1.50.84 之前的观感。
        if (u_shadowOn > 0.5 && v_side < 0.5) {
          // 世界 → 光向 NDC → 深度图 UV/深度（仿射，w=1）
          vec3 p = (u_lightMat * vec4(v_world, 1.0)).xyz * 0.5 + 0.5;
          if (p.x > 0.001 && p.x < 0.999 && p.y > 0.001 && p.y < 0.999 && p.z < 1.0) {
            // 阴影图仅包含地表实体（树/灌木/岩石/地标子图元），无地形自交，bias 精细化至 0.0003（约 0.49m）以完备投射岩石
            float bias = 0.0003;
            float inShadow = 0.0;
            inShadow += (p.z - bias > texture(u_shadowMap, p.xy).r) ? 1.0 : 0.0;
            inShadow += (p.z - bias > texture(u_shadowMap, p.xy + vec2(1.0 / 2048.0, 0.0)).r) ? 1.0 : 0.0;
            inShadow += (p.z - bias > texture(u_shadowMap, p.xy - vec2(1.0 / 2048.0, 0.0)).r) ? 1.0 : 0.0;
            inShadow += (p.z - bias > texture(u_shadowMap, p.xy + vec2(0.0, 1.0 / 2048.0)).r) ? 1.0 : 0.0;
            inShadow += (p.z - bias > texture(u_shadowMap, p.xy - vec2(0.0, 1.0 / 2048.0)).r) ? 1.0 : 0.0;
            inShadow /= 5.0;
            lit = 1.0 - u_shadowStrength * inShadow;
          }
        }
        outColor = vec4(v_color * lit, 1.0);
      }
    `;

    try {
      this.program = await this.manager.loadProgram(vsSource, fsSource);
      const gl = this.gl;
      this.vao = gl.createVertexArray();
      this.vboPos = gl.createBuffer();
      this.vboShade = gl.createBuffer();
      // attribute / uniform location 一次缓存
      for (const name of ['a_position', 'a_normal', 'a_ao', 'a_albedo', 'a_side']) {
        this.attrib[name] = gl.getAttribLocation(this.program, name);
      }
      for (const name of ['u_matrix', 'u_lightDir', 'u_lightParams', 'u_lightMisc',
        'u_lightTint', 'u_lightWash', 'u_wallColor',
        'u_shadowMap', 'u_lightMat', 'u_shadowOn', 'u_shadowStrength']) {
        this.u[name] = gl.getUniformLocation(this.program, name);
      }
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

    // 检查几何结构是否需要更新（★ v1.50.90 追加 materialRev：反照率指纹，防换世界同尺寸时
    //   shade VBO 不重建的 rewind 边角——反照率为世界静态，仅建缓存时变化）
    const gridRev = `${gSize}_${cells.length}_${terrain.minZ}_${terrain.maxZ}_${terrain.dynamicWaterRevision || 0}`;
    const albR = terrain.albR;
    const materialRev = albR ? `${albR[0]}_${albR[cells.length >> 1]}` : 'none';
    const needsGeometryRebuild = (gridRev !== this.lastGridRev) || (materialRev !== this.lastMaterialRev);

    if (needsGeometryRebuild) {
      const posData = new Float32Array(totalVertices * 3);
      const shadeData = new Float32Array(totalVertices * 8); // ★ v1.50.90 法线/AO/反照率/侧壁旗标
      let pIdx = 0;
      let sIdx = 0;

      // 预存数组（rustworld.js 世界建缓存一次性写入；缺失时回退现场推导，语义对齐
      // lighting.js::relightTerrain 回退分支 L236-243）
      const nx = terrain.nx, ny = terrain.ny, nz = terrain.nz, aoA = terrain.ao;
      const ag = terrain.albG, ab = terrain.albB;
      const hasPre = !!(nx && ny && nz && aoA && albR && ag && ab);

      // 角点受光材料写入：[nx, ny, nz, ao, albR, albG, albB, side]
      const writeShade = (i, side) => {
        const cell = cells[i];
        // ★ v1.61.4 水格 = 河床湿润度（非水色）：coverage 只在「湿河床（反照率）」与
        //   「干河床（dry 砂色）」之间过渡；水面本身完全由粒子层绘制，地表不拟合平面水。
        const coverage = cell && cell.waterBodyId != null && Number.isFinite(cell.dynamicWaterCoverage)
          ? Math.max(0, Math.min(1, cell.dynamicWaterCoverage)) : 1;
        const dryR = 148, dryG = 138, dryB = 114;
        if (hasPre) {
          shadeData[sIdx++] = nx[i]; shadeData[sIdx++] = ny[i]; shadeData[sIdx++] = nz[i];
          shadeData[sIdx++] = aoA[i];
          shadeData[sIdx++] = dryR + (albR[i] - dryR) * coverage;
          shadeData[sIdx++] = dryG + (ag[i] - dryG) * coverage;
          shadeData[sIdx++] = dryB + (ab[i] - dryB) * coverage;
        } else {
          const dzdx = (cell && cell.dzdx) || 0, dzdy = (cell && cell.dzdy) || 0;
          const len = Math.hypot(-dzdx, -dzdy, 1) || 1;
          const slopeDeg = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
          const alb = computeTerrainAlbedo(cell, terrain.minZ, terrain.maxZ);
          shadeData[sIdx++] = -dzdx / len; shadeData[sIdx++] = -dzdy / len; shadeData[sIdx++] = 1 / len;
          shadeData[sIdx++] = Math.max(0.70, 1 - (slopeDeg / 65) * 0.30);
          shadeData[sIdx++] = dryR + (alb.r - dryR) * coverage;
          shadeData[sIdx++] = dryG + (alb.g - dryG) * coverage;
          shadeData[sIdx++] = dryB + (alb.b - dryB) * coverage;
        }
        shadeData[sIdx++] = side;
      };

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
          writeShade(i00, 0); writeShade(i10, 0); writeShade(i01, 0);

          // 三角形 2: c01, c10, c11
          posData[pIdx++] = c01.wx; posData[pIdx++] = c01.wy; posData[pIdx++] = c01.elev;
          posData[pIdx++] = c10.wx; posData[pIdx++] = c10.wy; posData[pIdx++] = c10.elev;
          posData[pIdx++] = c11.wx; posData[pIdx++] = c11.wy; posData[pIdx++] = c11.elev;
          writeShade(i01, 0); writeShade(i10, 0); writeShade(i11, 0);
        }
      }

      // 2. 沙盘四周侧壁 (北、西、南、东)
      //    ★ v1.50.90：侧壁 shade = 朝外法线 + ao=1 + 反照率占位 0 + side=1
      //    （片元受光走顶点 shader 的 u_wallColor 固定平色分支，法线为未来侧壁受光预留）
      const wallDefs = [
        { first: 0, step: 1, nx: 0, ny: -1 },              // 北: y=0, x 从 0 到 N-1
        { first: 0, step: gSize, nx: -1, ny: 0 },          // 西: x=0, y 从 0 到 N-1
        { first: N * gSize, step: 1, nx: 0, ny: 1 },       // 南: y=N, x 从 0 到 N-1
        { first: N, step: gSize, nx: 1, ny: 0 }            // 东: x=N, y 从 0 到 N-1
      ];

      const writeWallShade = (wd) => {
        shadeData[sIdx++] = wd.nx; shadeData[sIdx++] = wd.ny; shadeData[sIdx++] = 0;
        shadeData[sIdx++] = 1;                              // ao（分支不消费）
        shadeData[sIdx++] = 0; shadeData[sIdx++] = 0; shadeData[sIdx++] = 0; // albedo 占位
        shadeData[sIdx++] = 1;                              // side = 侧壁
      };

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
          writeWallShade(wd); writeWallShade(wd); writeWallShade(wd);

          // 三角形 2
          posData[pIdx++] = c0.wx; posData[pIdx++] = c0.wy; posData[pIdx++] = c0.elev;
          posData[pIdx++] = c1.wx; posData[pIdx++] = c1.wy; posData[pIdx++] = skirtElev;
          posData[pIdx++] = c0.wx; posData[pIdx++] = c0.wy; posData[pIdx++] = skirtElev;
          writeWallShade(wd); writeWallShade(wd); writeWallShade(wd);
        }
      }

      this.gl.bindVertexArray(this.vao);

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vboPos);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, posData, this.gl.DYNAMIC_DRAW);
      this.gl.enableVertexAttribArray(this.attrib.a_position);
      this.gl.vertexAttribPointer(this.attrib.a_position, 3, this.gl.FLOAT, false, 0, 0);

      // ★ v1.50.90 shade VBO（世界静态，仅此处一次上传）：8 float/顶点 stride 32
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vboShade);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, shadeData, this.gl.DYNAMIC_DRAW);
      this.gl.enableVertexAttribArray(this.attrib.a_normal);
      this.gl.vertexAttribPointer(this.attrib.a_normal, 3, this.gl.FLOAT, false, 32, 0);
      this.gl.enableVertexAttribArray(this.attrib.a_ao);
      this.gl.vertexAttribPointer(this.attrib.a_ao, 1, this.gl.FLOAT, false, 32, 12);
      this.gl.enableVertexAttribArray(this.attrib.a_albedo);
      this.gl.vertexAttribPointer(this.attrib.a_albedo, 3, this.gl.FLOAT, false, 32, 16);
      this.gl.enableVertexAttribArray(this.attrib.a_side);
      this.gl.vertexAttribPointer(this.attrib.a_side, 1, this.gl.FLOAT, false, 32, 28);

      this.vertexCount = totalVertices;
      this.lastGridRev = gridRev;
      this.lastMaterialRev = materialRev;
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
    gl.uniformMatrix4fv(this.u.u_matrix, false, matrix);

    // ★ v1.50.90 光照 uniform：仅 lightRev 变化时上传（applyRelight 触发点计数 ≈ 光档变化频率，
    //   128x 下 ~数十次/秒，每次 5 个 uniform ≈ 60 字节——取代旧 4.55MB 颜色 VBO 重建链）。
    //   SimLighting 缺席时走 legacyDir 兜底（与 FALLBACK_CFG.legacyDir 同源）。
    const SL = window.SimLighting;
    const lrev = SL ? SL.lightRev() : -1;
    if (lrev !== this._lastLightRev) {
      const lp = SL ? SL.lightParams()
        : { amb: 0.52, inv: 0.48, wrap: 0.35, invWrap: 1 / 1.35, kMin: 0.45, kMax: 1.30,
            inten: 1, tr: 1, tg: 1, tb: 1, washA: 0, washR: 140, washG: 150, washB: 172,
            lx: -0.45, ly: -0.60, lz: 0.66 };
      // 注意：光向按 lightParams() 原值直传（动态光下恒为单位向量；legacy 对照路径
      //   legacyDir 非严格单位，CPU shadeAlbedoInto 同样直用原值——归一化会破坏逐位同构）。
      gl.uniform3f(this.u.u_lightDir, lp.lx, lp.ly, lp.lz);
      gl.uniform4f(this.u.u_lightParams, lp.amb, lp.inv, lp.kMin, lp.kMax);
      gl.uniform4f(this.u.u_lightMisc, lp.wrap, lp.invWrap, lp.inten, lp.washA);
      gl.uniform3f(this.u.u_lightTint, lp.tr, lp.tg, lp.tb);
      gl.uniform3f(this.u.u_lightWash, lp.washR / 255, lp.washG / 255, lp.washB / 255);
      gl.uniform3f(this.u.u_wallColor, 0.28, 0.24, 0.20);
      this._lastLightRev = lrev;
    }

    // ★ v1.50.84 阴影图采样：装饰世界代理几何（WebGLShadowPass）沿光向深度 → 阴影内变暗。
    //   阴影层缺席/光向退化时 u_shadowOn=0，地形外观与 v1.50.83 逐位一致。
    //   ★ v1.50.95 接收面收口：仅地表（v_side=0）——侧壁为固定平色边界面，不参与装饰阴影。
    const sp = window.WebGLShadowPass;
    if (sp && sp.isReady() && sp.hasShadow()) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sp.depthTexture);
      gl.uniform1i(this.u.u_shadowMap, 0);
      gl.uniformMatrix4fv(this.u.u_lightMat, false, sp.lightMatrix);
      gl.uniform1f(this.u.u_shadowStrength, sp.strength);
      gl.uniform1f(this.u.u_shadowOn, 1);
    } else {
      gl.uniform1f(this.u.u_shadowOn, 0);
    }

    // 渲染全部地表网格与侧壁
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
  }
}

window.TerrainWebGLRenderer = TerrainWebGLRenderer;
