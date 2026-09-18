// === WebGL 阴影图层（★ v1.50.84，"WebGL 自带影子"替代自绘阴影贴片）===
// 职责：① 从世界空间**代理几何**（树/灌木冠球 + 树干/枝/茎棱柱 + 石体棱柱，含资源景观
//   子图元）沿当前世界光向渲染一张深度图（shadow map）；② 输出光向矩阵与深度纹理给
//   terrain-renderer.js —— GL 地形片元采样深度图判断「是否处于装饰投影中」，在阴影内按
//   u_shadowStrength 变暗。装饰本体（accent-renderer.js 屏幕空间通道）不接收阴影。
//
// 为什么是阴影图：用户决策（v1.50.84）——WebGL 有原生投影能力后，不再自绘/迁移 Canvas
//   手绘阴影贴片（render_shadows 三段影 / 石群接触影 / 草丛接触影 / v1.50.83 Boulder 落底影
//   在 GL 模式下一律省略），装饰落底阴影统一由真实几何投影承担，且随季节光向自然旋转、
//   随地形起伏自然贴坡（世界坐标逐像素判定，无贴片悬空）。
//
// 代理几何与画面装饰**同一模型来源**（AccentModel 骨架 + accent.scale/rotation + leanShear
// + 地形坡度），但形状为保守近似（冠 = 椭球、干/枝/茎 = 4 棱柱、石 = 棱柱）：阴影图只关心
// 「光路上有没有遮挡」，不参与画面配色，故不违反「几何单一同源」红线（画面笔迹仍全部来自
// Canvas 绘制函数 sink 分发）。
//
// 接收面：仅 GL 地形（terrain-renderer 采样）；2D 覆盖层实体（族人/道路等）与装饰自身
// 不接收——过渡期已知边界，阶段四实体层迁移后统一解决。
// 确定性红线：纯表现层，不消耗 WorldRng、不写模拟状态、不进快照；SimLighting 缺席或
//   光向退化时本帧禁用阴影（地形外观不变）。
//
// ★ v1.50.91 代理集合与画面绘制集合同谓词（修复「有影子无树」）：① 基础装饰跳过
//   LandscapeMask.accentHidden（被车道/房屋/POI 保护区遮蔽或被可见景观去重的个体不再投影
//   ——绘制端 render_depth_queue.js 同谓词跳过，此前阴影端漏查留下幻影）；② 景观子图元
//   加查 LandscapeModel.childActive（库存低于阈值的 detail 小灌木画面端不画，投影同步省略）；
//   ③ 冠簇椭球跟随季相叶量：accentClusterVisibility(leaf, shed, 0.09) < 0.06 的簇不投影、
//   幸存簇半径 ×v（与 drawAccentTree/drawAccentBush 同判据）——冬季落叶树不再投满冠影。
//
// 缓存：代理顶点按签名重建。签名 = 未遮蔽基础装饰数 + 景观组版本/「未遮蔽且达库存门槛」
//   子图元数 + 落叶基准曲线叶量 8 档量化（档位只在春秋过渡带跨越，夏/冬平台零重建）；
//   季相档位驱动的重建限频 250ms（高倍速下叶量档位高频跨越，防止逐帧重建代理顶点）；
//   rustworld.js::_invalidateWorldStaticCaches 在 READY/LOAD/REWIND/RESET 时调用 resetCache()。
// 零 GC：重建走一次性临时数组（世界生命周期级，非每帧）；每帧仅 uniform/矩阵计算。

// 光向退化保护：|L| 过小或仰角过低（L.z < 0.2，对应 < ~11.5°）时本帧禁用阴影。

// 季相签名基准个体：落叶乔木曲线（kind/id 稳定，仅用于签名的叶量档位采样）
const _SEASON_CANON = { kind: 'Tree', id: 0 };

class WebGLShadowPass {
  constructor(webglContext, shaderManager) {
    this.gl = webglContext.GL;
    this.manager = shaderManager || new ShaderManager(this.gl);
    this.program = null;
    this.vao = null;
    this.vbo = null;
    this.fbo = null;
    this.depthTexture = null;
    this.size = 2048;                 // 阴影图分辨率（约 0.5m/texel @ 764m 世界）
    this.strength = 0.38;             // 阴影内地形变暗比例（RENDER_CONFIG.accentWebglShadowStrength）
    this.isReadyFlag = false;
    this._dirty = true;
    this._sigS = '';                // 结构签名（装饰/景观集合谓词指纹）
    this._sigT = 0;                 // 季相签名（落叶基准叶量 8 档量化）
    this._sigOut = { s: '', t: 0 }; // 签名复用出口（零每帧分配）
    this._seasonRebuiltAt = -1e9;   // 上次季相驱动重建时刻（限频用，performance.now() 域）
    this._proxyCount = 0;           // 代理顶点数
    this._active = false;             // 本帧是否成功产出阴影图
    this.lightMatrix = new Float32Array(16); // 世界 → 光向 NDC（列主序）
    this._L = { x: 0, y: 0, z: 0 };
    this._depthRange = 1;             // 光向深度范围（世界单位，偏移换算用）
  }

  async init() {
    const vsSource = `#version 300 es
      precision highp float;
      in vec3 a_pos;
      uniform mat4 u_lightMat;
      void main() {
        gl_Position = u_lightMat * vec4(a_pos, 1.0);
      }
    `;
    const fsSource = `#version 300 es
      precision mediump float;
      out vec4 outColor;
      void main() { outColor = vec4(1.0); }
    `;
    try {
      const gl = this.gl;
      this.program = await this.manager.loadProgram(vsSource, fsSource);
      // 深度纹理 + 纯深度附件（无颜色附件 + drawBuffers NONE）。
      // ⚠️ 不挂 1×1 哑色附件：ANGLE/D3D11 对「2048 深度 + 1×1 颜色」混合附件报
      // FRAMEBUFFER_UNSUPPORTED（实测），纯深度附件全平台可行（drawBuffers NONE 合法）。
      this.depthTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.size, this.size, 0,
        gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTexture, 0);
      gl.drawBuffers([gl.NONE]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('shadow framebuffer incomplete ' + gl.checkFramebufferStatus(gl.FRAMEBUFFER));
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.vao = gl.createVertexArray();
      this.vbo = gl.createBuffer();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      const aPos = gl.getAttribLocation(this.program, 'a_pos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.isReadyFlag = true;
      console.log('[WebGL] WebGLShadowPass initialized successfully');
      return true;
    } catch (e) {
      console.error('[WebGL] WebGLShadowPass init failed:', (e && (e.message || String(e))) || e);
      this.isReadyFlag = false;
      return false;
    }
  }

  isReady() {
    return this.isReadyFlag && !!this.program;
  }

  hasShadow() {
    return this._active && this._proxyCount > 0;
  }

  // 世界生命周期失效（rustworld.js::_invalidateWorldStaticCaches 调用）
  resetCache() {
    this._dirty = true;
  }

  // 每帧：光照有效时更新阴影图（先于 terrain-renderer.render 消费）
  render(sim) {
    this._active = false;
    if (!this.isReady() || !sim || !sim.terrain || !sim.terrain.cells || !sim.terrain.cells.length) return;
    const L = this._L;
    const SL = window.SimLighting;
    if (SL && SL.lightDirInto) SL.lightDirInto(L);
    else { L.x = 0.45; L.y = 0.63; L.z = 0.64; } // SimLighting 缺席兜底（西北高位光）
    const ll = Math.hypot(L.x, L.y, L.z);
    if (!(ll > 0.5) || !(L.z > 0.2)) return; // 光向退化/仰角过低：本帧禁用
    L.x /= ll; L.y /= ll; L.z /= ll;

    // 签名判定：结构变化（建房/修路/库存跨越阈值/世界生命周期）立即重建；
    // 仅季相档位变化时限频 250ms（高倍速下叶量档位高频跨越，防逐帧重建代理顶点）。
    const sig = this._signature(sim, this._sigOut);
    let rebuild = this._dirty || sig.s !== this._sigS;
    if (!rebuild && sig.t !== this._sigT) {
      const now = performance.now();
      if (now - this._seasonRebuiltAt >= 250) rebuild = true;
    }
    if (rebuild) {
      this._rebuild(sim);
      this._sigS = sig.s;
      this._sigT = sig.t;
      this._dirty = false;
      this._seasonRebuiltAt = performance.now();
    }
    if (this._proxyCount === 0) return;

    this._computeLightMatrix(sim, L);

    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.size, this.size);
    gl.clearColor(1, 1, 1, 1);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.manager.getUniformLocation(this.program, 'u_lightMat'), false, this.lightMatrix);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.colorMask(false, false, false, false);
    gl.drawArrays(gl.TRIANGLES, 0, this._proxyCount);
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._active = true;
  }

  // ── 代理几何 ──────────────────────────────────────────────────────────────
  // 签名（与 _rebuild 同谓词的代理集合指纹，写入 out 复用对象，零每帧分配）：
  //   s（结构）= 未遮蔽基础装饰数（accentHidden 过滤；遮蔽判定有 accent._lm 缓存）
  //     ×31 + 景观组版本 + 「未遮蔽且达库存门槛（childActive）」子图元数；
  //   t（季相）= 落叶乔木基准曲线叶量 8 档量化——档位只在春秋过渡带跨越，
  //     夏/冬平台零重建；个体 jitter（±0.025 年）与画面端的微差对阴影不可辨。
  _signature(sim, out) {
    const accents = sim.terrain.accents;
    const MK = window.LandscapeMask;
    let s = 0;
    if (accents) {
      for (let i = 0; i < accents.length; i++) {
        if (!(MK && MK.accentHidden(accents[i]))) s = (s + 1) | 0;
      }
    }
    const LM = window.LandscapeModel;
    if (LM && window.RENDER_CONFIG && window.RENDER_CONFIG.landscapeEnabled !== false) {
      LM.sync(sim);
      s = (s * 31 + LM.version()) | 0;
      const gs = LM.groups();
      for (let i = 0; i < gs.length; i++) {
        const ch = gs[i].children;
        for (let c = 0; c < ch.length; c++) {
          if (!MK.childHidden(ch[c]) && LM.childActive(gs[i], ch[c])) s = (s + 1) | 0;
        }
      }
    }
    out.s = s;
    const ST = window.SimTreeTint;
    out.t = (ST && sim) ? Math.round(ST.sample(_SEASON_CANON, sim).leafDensity * 8) | 0 : 0;
    return out;
  }

  _rebuild(sim) {
    const verts = [];
    const t = sim.terrain;
    const accents = t.accents;
    const MK = window.LandscapeMask;
    if (accents) {
      // ★ v1.50.91 与绘制集合同谓词：被保护区遮蔽/被可见景观去重的装饰不画也不投影
      for (let i = 0; i < accents.length; i++) {
        if (MK && MK.accentHidden(accents[i])) continue;
        this._addAccent(verts, sim, accents[i]);
      }
    }
    // 资源景观子图元（Tree/Bush/RockCluster；遮蔽子图元不投影）
    const LM = window.LandscapeModel;
    if (LM && window.RENDER_CONFIG && window.RENDER_CONFIG.landscapeEnabled !== false) {
      LM.sync(sim);
      const gs = LM.groups();
      for (let gi = 0; gi < gs.length; gi++) {
        const ch = gs[gi].children;
        for (let ci = 0; ci < ch.length; ci++) {
          const child = ch[ci];
          if (MK && MK.childHidden(child)) continue;
          // ★ v1.50.91 库存门槛同谓词：detail 小灌木 q < qThreshold 时画面端不画，投影同步省略
          if (!LM.childActive(gs[gi], child)) continue;
          const kind = child.modelKind;
          if (kind !== 'Tree' && kind !== 'Bush' && kind !== 'RockCluster') continue;
          const model = landscapeChildModel(child); // render_landscapes.js 全局（'L#' 键单一来源）
          // kind 入 shim：SimTreeTint.sample 的 jitter 通道与 kind 回退需要（与绘制端 shim 同构）
          const shim = { kind: kind, rotation: child.rot || 0, id: child.visualSeed };
          if (kind === 'RockCluster') this._addStones(verts, sim, child.x, child.y, child.z, child.rot || 0, child.scale, model);
          else this._addTreeLike(verts, sim, child.x, child.y, child.z, child.scale, model, kind, shim);
        }
      }
    }
    this._proxyCount = verts.length / 3;
    if (this._proxyCount > 0) {
      const gl = this.gl;
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
    }
  }

  _addAccent(verts, sim, accent) {
    const kind = accent.kind;
    const model = window.AccentModel.get(accent);
    if (!model || !model.skeleton) return;
    if (kind === 'Tree' || kind === 'Bush') {
      this._addTreeLike(verts, sim, accent.x, accent.y, accent.z, accent.scale, model, kind, accent);
    } else if (kind === 'Boulder') {
      this._addStones(verts, sim, accent.x, accent.y, accent.z, accent.rotation || 0, accent.scale, model,
        window._BOULDER_SHAPE, 7, 6 * accent.scale);
    } else if (kind === 'RockCluster') {
      this._addStones(verts, sim, accent.x, accent.y, accent.z, accent.rotation || 0, accent.scale, model);
    }
    // GrassTuft：草叶过细，投影不可辨，不建代理
  }

  // 树/灌木代理：冠簇椭球 + 干/枝/茎 4 棱柱（模型坐标 × scale = 世界偏移，倾干剪切同绘制层）
  _addTreeLike(verts, sim, ax, ay, az, scale, model, kind, rotSrc) {
    const sk = model.skeleton;
    if (!sk) return;
    const s = scale;
    const lean = (kind === 'Tree' && window.AccentLOD) ? window.AccentLOD.leanShear(rotSrc, model) : 0;
    const crownR = sk.crownR || (kind === 'Tree' ? 8.5 : 6.5);
    // 干（Tree）/茎（Bush）棱柱
    if (kind === 'Tree') {
      const th = sk.trunkH * s;
      this._prism(verts, ax, ay, az, ax + lean * th, ay, az + th, Math.max(0.08, 0.17 * crownR * s));
      if (sk.segments) {
        for (let i = 0; i < sk.segments.length; i++) {
          const seg = sk.segments[i];
          const x1 = ax + (seg.x1 + lean * seg.z1) * s, y1 = ay + seg.y1 * s, z1 = az + seg.z1 * s;
          const x2 = ax + (seg.x2 + lean * seg.z2) * s, y2 = ay + seg.y2 * s, z2 = az + seg.z2 * s;
          this._prism(verts, x1, y1, z1, x2, y2, z2, Math.max(0.04, 0.17 * crownR * s * (seg.wK || 0.5) * 0.5));
        }
      }
    } else if (sk.segments) {
      for (let i = 0; i < sk.segments.length; i++) {
        const seg = sk.segments[i];
        this._prism(verts,
          ax + seg.x1 * s, ay + seg.y1 * s, az + seg.z1 * s,
          ax + seg.x2 * s, ay + seg.y2 * s, az + seg.z2 * s,
          Math.max(0.03, 0.09 * s));
      }
    }
    // 冠簇椭球（z 向略扁，对应画面 crownSquash 的竖直压扁读感）
    // ★ v1.50.91 跟随季相叶量：与 drawAccentTree/drawAccentBush 同判据——
    //   accentClusterVisibility(leaf, shed, 0.09) < 0.06 的簇不投影，幸存簇半径 ×v
    //   （落叶树冬季只剩枝干投影，不再投满冠影）；SimTreeTint/可见度函数缺席时回退全冠。
    if (sk.clusters) {
      const visFn = window.accentClusterVisibility;
      const ST = window.SimTreeTint;
      const leaf = (ST && sim) ? ST.sample(rotSrc, sim, model.profile).leafDensity : 1;
      for (let i = 0; i < sk.clusters.length; i++) {
        const c = sk.clusters[i];
        let v = 1;
        if (leaf < 1 && visFn) {
          v = visFn(leaf, c.shed, 0.09);
          if (v < 0.06) continue;
        }
        this._ellipsoid(verts,
          ax + (c.x + lean * c.z) * s, ay + c.y * s, az + c.z * s,
          Math.max(0.15, c.r * s * v), 0.85);
      }
    }
  }

  // 石体代理：Boulder（七边形定径）或 RockCluster 子石；底环沿地形坡度（与 drawStoneBody 同构）
  _addStones(verts, sim, ax, ay, az, rot, scale, model, shape, sides, rW) {
    const sl = this._slopeAt(sim, ax, ay);
    const k = (window.RENDER_CONFIG && window.RENDER_CONFIG.accentStoneHeightK) || 0.3;
    if (shape) {
      this._stonePrism(verts, ax, ay, az, rot, sides, shape, rW, rW * k, sl.dzdx, sl.dzdy);
      return;
    }
    const sk = model && model.skeleton;
    if (!sk || !sk.stones) return;
    const s = scale;
    const cR = Math.cos(rot), sR = Math.sin(rot);
    for (let i = 0; i < sk.stones.length; i++) {
      const st = sk.stones[i];
      const sx = ax + (st.x * cR - st.y * sR) * s;
      const sy = ay + (st.x * sR + st.y * cR) * s;
      this._stonePrism(verts, sx, sy, az, st.rot, st.sides, st.shape, st.r * s, st.r * s * k, sl.dzdx, sl.dzdy);
    }
  }

  _stonePrism(verts, cx, cy, cz, rot, sides, shape, rW, hW, dzdx, dzdy) {
    if (!(rW > 0.05) || !(hW > 0.02)) return;
    const bx = [], by = [], bz = [];
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      const rv = rW * shape[i];
      const dx = rv * Math.cos(a), dy = rv * Math.sin(a);
      bx.push(cx + dx); by.push(cy + dy); bz.push(cz + dx * dzdx + dy * dzdy);
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const tzi = bz[i] + hW, tzj = bz[j] + hW;
      // 侧面 quad（双面渲染，绕向无关）
      verts.push(bx[i], by[i], bz[i], bx[j], by[j], bz[j], bx[j], by[j], tzj);
      verts.push(bx[i], by[i], bz[i], bx[j], by[j], tzj, bx[i], by[i], tzi);
    }
    // 顶面扇形
    let tx = 0, ty = 0, tz = 0;
    for (let i = 0; i < sides; i++) { tx += bx[i]; ty += by[i]; tz += bz[i] + hW; }
    tx /= sides; ty /= sides; tz /= sides;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      verts.push(tx, ty, tz, bx[i], by[i], bz[i] + hW, bx[j], by[j], bz[j] + hW);
    }
  }

  // 4 棱柱（干/枝/茎）：细长几何的保守遮挡代理（双面渲染，无端盖——底贴地、顶被冠球覆盖）
  _prism(verts, x1, y1, z1, x2, y2, z2, r) {
    if (!(r > 0.02)) return;
    const axv = x2 - x1, ayv = y2 - y1, azv = z2 - z1;
    const al = Math.hypot(axv, ayv, azv);
    if (al < 1e-3) return;
    const nx = axv / al, ny = ayv / al, nz = azv / al;
    // u ⊥ n：取 z 轴叉积（近竖直轴时换 x 轴）
    let ux, uy, uz;
    if (Math.abs(nz) < 0.9) { ux = ny * 1 - nz * 0; uy = nz * 0 - nx * 1; uz = nx * 0 - ny * 0; }
    else { ux = 1; uy = 0; uz = 0; }
    let ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-6) { ux = 1; uy = 0; uz = 0; ul = 1; }
    ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    const dirs = [[ux, uy, uz], [vx, vy, vz], [-ux, -uy, -uz], [-vx, -vy, -vz]];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      const d = dirs[k], e = dirs[k2];
      verts.push(
        x1 + d[0] * r, y1 + d[1] * r, z1 + d[2] * r,
        x1 + e[0] * r, y1 + e[1] * r, z1 + e[2] * r,
        x2 + e[0] * r, y2 + e[1] * r, z2 + e[2] * r);
      verts.push(
        x1 + d[0] * r, y1 + d[1] * r, z1 + d[2] * r,
        x2 + e[0] * r, y2 + e[1] * r, z2 + e[2] * r,
        x2 + d[0] * r, y2 + d[1] * r, z2 + d[2] * r);
    }
  }

  // 椭球（冠簇）：8 经 × 4 纬，z 向按 squashK 压扁
  _ellipsoid(verts, cx, cy, cz, r, squashK) {
    const LAT = 4, LON = 8;
    const pt = (i, j, out) => {
      const th = (j / LAT) * Math.PI;         // 0..π（极角）
      const ph = (i / LON) * Math.PI * 2;     // 经度
      out[0] = cx + r * Math.sin(th) * Math.cos(ph);
      out[1] = cy + r * Math.sin(th) * Math.sin(ph);
      out[2] = cz + r * squashK * Math.cos(th);
    };
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], d = [0, 0, 0];
    for (let j = 0; j < LAT; j++) {
      for (let i = 0; i < LON; i++) {
        pt(i, j, a); pt(i + 1, j, b); pt(i + 1, j + 1, c); pt(i, j + 1, d);
        verts.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        verts.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
      }
    }
  }

  _slopeAt(sim, wx, wy) {
    const dzdx = { dzdx: 0, dzdy: 0 };
    const t = sim.terrain;
    if (!t || !t.cells || !t.cells.length) return dzdx;
    const gSize = t.gridSize;
    const half = t.cells[t.cells.length - 1].wx;
    if (!(half > 0) || !gSize) return dzdx;
    const gx = Math.max(0, Math.min(gSize - 1, Math.round(((wx + half) / (2 * half)) * (gSize - 1))));
    const gy = Math.max(0, Math.min(gSize - 1, Math.round(((wy + half) / (2 * half)) * (gSize - 1))));
    const cell = t.cells[gy * gSize + gx];
    if (cell) { dzdx.dzdx = cell.dzdx || 0; dzdx.dzdy = cell.dzdy || 0; }
    return dzdx;
  }

  // ── 光向正交矩阵（世界 → 光向 NDC；8 角紧致拟合）────────────────────────
  // 相机位于 center − L·800，视方向 f = +L（指向光），z 轴 = −f（OpenGL 惯例，向下看 −z）。
  // z_ndc = −(2/d)·z_v + (maxZv+minZv)/d ⇒ 最近场景点 z_ndc = −1（深度 0），
  // 接收面片元深度 > 投影物深度 ⇒ 处于阴影中。
  _computeLightMatrix(sim, L) {
    const t = sim.terrain;
    const half = Math.abs(t.cells[t.cells.length - 1].wx) || 380;
    const minZ = (t.minZ != null ? t.minZ : 0) - 12;
    const maxZ = (t.maxZ != null ? t.maxZ : 60) + 48; // 冠顶余量
    const m = half * 1.15 + 16;
    // 视基：s = f×up 归一，u = s×f
    let sx = L.y, sy = -L.x, sz = 0; // f × (0,0,1)
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-6) { sx = 1; sy = 0; sz = 0; sl = 1; }
    sx /= sl; sy /= sl; sz /= sl;
    const ux = sy * L.z - sz * L.y, uy = sz * L.x - sx * L.z, uz = sx * L.y - sy * L.x; // s × f
    const czW = (minZ + maxZ) * 0.5;
    const eyeX = -L.x * 800, eyeY = -L.y * 800, eyeZ = czW - L.z * 800; // 世界中心沿 −L 后撤
    // 8 角在视空间的紧致包围
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZv = 1e9, maxZv = -1e9;
    const zs = [minZ, maxZ];
    for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) for (let zi = 0; zi < 2; zi++) {
      const wx = xi ? m : -m, wy = yi ? m : -m, wz = zs[zi];
      const dx = wx - eyeX, dy = wy - eyeY, dz = wz - eyeZ;
      const xv = dx * sx + dy * sy + dz * sz;
      const yv = dx * ux + dy * uy + dz * uz;
      const zv = -(dx * L.x + dy * L.y + dz * L.z); // z_v = dot(c−eye, −L)
      if (xv < minX) minX = xv; if (xv > maxX) maxX = xv;
      if (yv < minY) minY = yv; if (yv > maxY) maxY = yv;
      if (zv < minZv) minZv = zv; if (zv > maxZv) maxZv = zv;
    }
    const w = Math.max(1e-3, maxX - minX), h = Math.max(1e-3, maxY - minY), d = Math.max(1e-3, maxZv - minZv);
    const cxv = (maxX + minX) * 0.5, cyv = (maxY + minY) * 0.5, czv = (maxZv + minZv) * 0.5;
    this._depthRange = d;
    const se = sx * eyeX + sy * eyeY + sz * eyeZ;
    const ue = ux * eyeX + uy * eyeY + uz * eyeZ;
    const le = L.x * eyeX + L.y * eyeY + L.z * eyeZ;
    const M = this.lightMatrix;
    // 列主序：x' = 2/w·(dot(c,s) − se − cxv)；y' 同理；z' = −2/d·z_v + 2czv/d
    M[0] = (2 / w) * sx; M[4] = (2 / h) * ux; M[8] = (2 / d) * L.x;
    M[12] = -(2 / w) * (se + cxv);
    M[1] = (2 / w) * sy; M[5] = (2 / h) * uy; M[9] = (2 / d) * L.y;
    M[13] = -(2 / h) * (ue + cyv);
    M[2] = (2 / w) * sz; M[6] = (2 / h) * uz; M[10] = -(2 / d) * L.z;
    M[14] = (2 / d) * (czv - le);
    M[3] = 0; M[7] = 0; M[11] = 0; M[15] = 1;
  }
}

// 注意：类名走全局词法绑定（render_canvas.js `new WebGLShadowPass(...)` 可达），
// **严禁** `window.WebGLShadowPass = 类`——该 window 属性专属「实例」（render_canvas 惰性创建；
// accentgl=0 时保持 undefined，若被类占用会让 rustworld/render_canvas 的存在性判断误判）。
