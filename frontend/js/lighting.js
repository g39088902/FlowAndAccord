// === 动态季节光照引擎（年周期光弧） ===
// 方案：docs/current/tech/17-seasonal-lighting.md
// 定位：纯表现层。不消耗 WorldRng、不写模拟状态、不进存档、不参与内核确定性承诺。
// 光相唯一来源：快照的 season / season_progress / season_timer / temperature（严禁自建计时器）。
// 加载顺序：config.lighting.js → math.js → 本文件 → rustworld.js → 渲染五件套。
// 依赖全局：window.SIM_LIGHTING（配置）/ computeTerrainAlbedo（math.js）/ camera（调用期）

window.SimLighting = (function () {
  'use strict';

  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const SEASON_INDEX = { Spring: 0, Summer: 1, Autumn: 2, Winter: 3 };
  const SEASON_KEY = ['spring', 'summer', 'autumn', 'winter'];
  const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  // 旧固定光（enabled=false 对照路径）的等效环境项：elev = asin(0.66) ≈ 41.3°
  const LEGACY_ELEV = Math.asin(0.66);

  const FALLBACK_CFG = {
    enabled: true,
    azimuthOffsetDeg: 45, elevMinDeg: 22, elevMaxDeg: 72, elevPhaseTurns: 0.25,
    ambientBase: 0.40, ambientElevGain: 0.18, wrap: 0.35, lightMin: 0.45, lightMax: 1.30,
    intensity: { spring: 1.00, summer: 1.08, autumn: 1.02, winter: 0.90 },
    tint: { spring: [1.00, 1.02, 0.99], summer: [1.06, 1.02, 0.90], autumn: [1.10, 0.99, 0.86], winter: [0.94, 0.99, 1.08] },
    tempTintPerDeg: 0.03,
    shadowLenMin: 0.35, shadowLenMax: 2.40, shadowOpacityBase: 0.18, shadowOpacityGain: 0.12,
    houseShadowHeight: 3.0, agentShadowHeight: 1.6, poiShadowHeight: 0.9, campShadowHeight: 1.2,
    lightStepsPerYear: 144, rateCapDegPerSec: 90,
    skyWash: 0.055, respectLightTheme: true,
    legacyDir: [-0.45, -0.60, 0.66],
  };

  function cfg() { return window.SIM_LIGHTING || FALLBACK_CFG; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function wrap01(v) { return v - Math.floor(v); }
  function shortestTurn(d) { d = wrap01(d); return d > 0.5 ? d - 1 : d; }

  // ── 状态（视觉相位 + 当前光向量/色温/阴影） ──
  const S = {
    phase: 0,          // 视觉年度相位 u_vis ∈ [0,1)
    target: 0,         // 快照目标相位
    stamp: -1,         // 已重着色的光档
    azDeg: 90, elevDeg: 45,
    lx: 0, ly: -1, lz: 0.7,
    ambient: 0.52, intensity: 1, tint: [1, 1, 1],
    shadowWx: 0, shadowWy: 1, shadowLen: 1, shadowAlpha: 0.26,
    dirty: true, snapNext: true,
    lastMs: 0, relightCount: 0, lastNow: 0,
  };

  // ── 面光照缓存（键含光档，光档变化即整体失效） ──
  let _faceCache = new Map();
  let _faceCacheStamp = null;
  let _hexCache = new Map();

  function hexToRgb(hex) {
    let v = _hexCache.get(hex);
    if (v !== undefined) return v;
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    _hexCache.set(hex, v);
    return v;
  }

  // ── 年度相位（唯一真相源 = 快照；缺字段时回退 seasonTimer / seasonYearLength） ──
  function phaseFromSnapshot(sim) {
    if (!sim) return 0;
    const idx = SEASON_INDEX[sim.currentSeason];
    const prog = (typeof sim.seasonProgress === 'number' && isFinite(sim.seasonProgress)) ? sim.seasonProgress : null;
    if (idx != null && prog != null) {
      // 内核分箱：season_idx = ((season_time + q/2) / q) % 4 ⇒ u = (idx - 0.5 + progress) / 4
      return wrap01((idx - 0.5 + prog) / 4);
    }
    const year = (window.SIM_CONFIG && window.SIM_CONFIG.seasonYearLength) || 240;
    const t = (typeof sim.seasonTimer === 'number' && isFinite(sim.seasonTimer)) ? sim.seasonTimer : 0;
    return wrap01(t / Math.max(1e-6, year));
  }

  // 四季键按“季分箱中心”u = 0 / 0.25 / 0.5 / 0.75 连续插值（不在季界跳变）
  function seasonBlend(u, table) {
    const k = Math.floor(u * 4);
    const t = u * 4 - k;
    const a = table[SEASON_KEY[((k % 4) + 4) % 4]];
    const b = table[SEASON_KEY[(((k + 1) % 4) + 4) % 4]];
    if (Array.isArray(a)) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    return a + (b - a) * t;
  }

  function faceK(nx, ny, nz, lx, ly, lz, ambient, wrap) {
    const dot = clamp(nx * lx + ny * ly + nz * lz, -1, 1);
    const wd = Math.max(0, (dot + wrap) / (1 + wrap));
    return ambient + (1 - ambient) * wd;
  }

  // ── 每帧推进光相（仅渲染路径调用；无头模式不调用，恢复渲染时按 §2.7 规则自动对齐） ──
  function update(now, sim) {
    const c = cfg();
    const dtReal = S.lastNow ? clamp((now - S.lastNow) / 1000, 0, 0.25) : 0;
    S.lastNow = now;

    if (!c.enabled) {
      // 对照路径：旧固定光，不参与相位/限速
      const L = c.legacyDir || FALLBACK_CFG.legacyDir;
      const azRad = Math.atan2(L[0], -L[1]);   // 罗盘方位（自北顺时针）
      S.lx = L[0]; S.ly = L[1]; S.lz = L[2];
      S.elevDeg = LEGACY_ELEV / DEG;
      S.azDeg = ((azRad / DEG) % 360 + 360) % 360;
      S.ambient = c.ambientBase + c.ambientElevGain * L[2];
      S.intensity = 1.0;
      S.tint = [1, 1, 1];
      applyShadowVector(c, LEGACY_ELEV, azRad);
      if (S.stamp !== -1 || S.dirty) { S.stamp = -1; relightTerrain(sim); }
      return;
    }

    S.target = phaseFromSnapshot(sim);
    if (S.snapNext) { S.phase = S.target; S.snapNext = false; }
    else {
      const du = shortestTurn(S.target - S.phase);
      if (Math.abs(du) > 0.5) S.phase = S.target;                 // 半年以上跳变直接对齐
      else {
        const maxStep = (c.rateCapDegPerSec / 360) * dtReal;      // 视觉限速（防高倍速频闪）
        S.phase = wrap01(S.phase + clamp(du, -maxStep, maxStep));
      }
    }

    const azRad = (S.phase * 360 + c.azimuthOffsetDeg) * DEG;
    const elevMid = (c.elevMinDeg + c.elevMaxDeg) * 0.5;
    const elevAmp = (c.elevMaxDeg - c.elevMinDeg) * 0.5;
    const elevRad = (elevMid + elevAmp * Math.sin(TAU * (S.phase - (c.elevPhaseTurns - 0.25)))) * DEG;

    const ce = Math.cos(elevRad), se = Math.sin(elevRad);
    // 世界轴向：+x = 东 / +y = 南 / -y = 北（见方案 §2.1）
    S.lx = ce * Math.sin(azRad);
    S.ly = -ce * Math.cos(azRad);
    S.lz = se;
    S.azDeg = ((azRad / DEG) % 360 + 360) % 360;
    S.elevDeg = elevRad / DEG;

    S.ambient = clamp(c.ambientBase + c.ambientElevGain * se, 0, 0.95);
    S.intensity = seasonBlend(S.phase, c.intensity);
    const tint = seasonBlend(S.phase, c.tint);
    if (typeof sim.temperature === 'number' && isFinite(sim.temperature)) {
      const baseMid = (window.SIM_CONFIG && window.SIM_CONFIG.tempBaseMid) || 14;
      const amp = (window.SIM_CONFIG && window.SIM_CONFIG.tempAmplitude) || 17;
      const dT = clamp((sim.temperature - baseMid) / Math.max(1e-6, amp), -1, 1);
      const s = c.tempTintPerDeg * dT;
      tint[0] *= (1 + s);
      tint[2] *= (1 - s);
    }
    S.tint = tint;

    applyShadowVector(c, elevRad, azRad);

    const stamp = Math.round(S.phase * c.lightStepsPerYear);
    if (S.dirty || stamp !== S.stamp) {
      S.stamp = stamp;
      relightTerrain(sim);
    }
  }

  function applyShadowVector(c, elevRad, azRad) {
    // 阴影方向 = -光源水平方向；长度 ∝ cot(高度角)
    S.shadowWx = -Math.sin(azRad);
    S.shadowWy = Math.cos(azRad);
    const cot = 1 / Math.max(0.05, Math.tan(elevRad));
    S.shadowLen = clamp(cot, c.shadowLenMin, c.shadowLenMax);
    S.shadowAlpha = clamp(c.shadowOpacityBase + c.shadowOpacityGain * (1 - Math.sin(elevRad)), 0.05, 0.6);
  }

  // ── ★ TA-12-4 共用地形受光步骤（无分配）：「输入反照率 → 最终 RGB」唯一公式入口 ──
  // relightTerrain（基底色）与 TerrainTexture 纹理色档共用：法线 wrap 漫反射 → AO×强度 →
  // 光档钳制 → tint 色温 → 大气色洗烘焙，保证纹理与基底同一光档、同一色洗顺序——
  // 纹理对「反照率小幅等比扰动」施光，严禁对最终已色洗颜色重复施光。
  // lp = lightParams() 每趟预取一次（避免逐格读 cfg/主题类名）；out[0..2] 为 0~255 整数，
  // 与 relightTerrain 写回的 cell.color 同源同值（关闭纹理时原基底颜色逐值一致的验收基准）。
  function lightParams() {
    const c = cfg();
    const tr = S.tint[0], tg = S.tint[1], tb = S.tint[2];
    const lightTheme = !!(c.respectLightTheme && document.body && document.body.classList.contains('theme-light'));
    const washA = c.enabled ? c.skyWash * (lightTheme ? 0.55 : 1) : 0;
    return {
      amb: S.ambient, inv: 1 - S.ambient, wrap: c.wrap, invWrap: 1 / (1 + c.wrap),
      lx: S.lx, ly: S.ly, lz: S.lz,
      kMin: c.lightMin, kMax: c.lightMax, inten: S.intensity,
      tr, tg, tb, washA,
      washR: Math.min(255, 140 * tr), washG: Math.min(255, 150 * tg), washB: Math.min(255, 172 * tb),
    };
  }
  function shadeAlbedoInto(lp, cx, cy, cz, ao, br, bg, bb, out) {
    let dot = cx * lp.lx + cy * lp.ly + cz * lp.lz;
    dot = dot < -1 ? -1 : (dot > 1 ? 1 : dot);
    let wd = (dot + lp.wrap) * lp.invWrap;
    wd = wd < 0 ? 0 : (wd > 1 ? 1 : wd);
    let k = (lp.amb + lp.inv * wd) * ao * lp.inten;
    k = k < lp.kMin ? lp.kMin : (k > lp.kMax ? lp.kMax : k);
    let r = br * k * lp.tr, g = bg * k * lp.tg, b = bb * k * lp.tb;
    r = r < 0 ? 0 : (r > 255 ? 255 : r | 0);
    g = g < 0 ? 0 : (g > 255 ? 255 : g | 0);
    b = b < 0 ? 0 : (b > 255 ? 255 : b | 0);
    if (lp.washA > 0) {
      r = Math.round(r + (lp.washR - r) * lp.washA);
      g = Math.round(g + (lp.washG - g) * lp.washA);
      b = Math.round(b + (lp.washB - b) * lp.washA);
    }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }

  // ── 地形整片重着色：预存法线/反照率/AO 后原地写回 cell.color ──
  function relightTerrain(sim) {
    const t0 = performance.now();
    const terr = sim && sim.terrain;
    const cells = terr && terr.cells;
    if (!cells || !cells.length) { S.lastMs = 0; S.dirty = false; return; }

    // ★ TA-12-4 受光参数（含主题色洗）每趟预取一次，逐格走共用步骤 shadeAlbedoInto
    const lp = lightParams();
    const palette = new Map(); // 每趟清空：趟内去重、趟间不累积
    const out = [0, 0, 0];     // 共用步骤复用输出（趟内单实例，零逐格分配）

    const nx = terr.nx, ny = terr.ny, nz = terr.nz, aoA = terr.ao;
    const ar = terr.albR, ag = terr.albG, ab = terr.albB;
    const hasPre = !!(nx && ny && nz && aoA && ar && ag && ab);

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell) continue;
      let cx, cy, cz, ao, br, bg, bb;
      if (hasPre) {
        cx = nx[i]; cy = ny[i]; cz = nz[i]; ao = aoA[i];
        br = ar[i]; bg = ag[i]; bb = ab[i];
      } else {
        // 回退路径（地形数组缺失时）：现场推导法线/反照率/AO，语义与 v1.47.11 一致
        const dzdx = cell.dzdx || 0, dzdy = cell.dzdy || 0;
        const len = Math.hypot(-dzdx, -dzdy, 1) || 1;
        cx = -dzdx / len; cy = -dzdy / len; cz = 1 / len;
        const slopeDeg = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
        ao = Math.max(0.70, 1 - (slopeDeg / 65) * 0.30);
        const alb = computeTerrainAlbedo(cell, terr.minZ, terr.maxZ);
        br = alb.r; bg = alb.g; bb = alb.b;
      }

      shadeAlbedoInto(lp, cx, cy, cz, ao, br, bg, bb, out);

      const key = (out[0] << 16) | (out[1] << 8) | out[2];
      let str = palette.get(key);
      if (str === undefined) {
        str = 'rgb(' + out[0] + ', ' + out[1] + ', ' + out[2] + ')';
        palette.set(key, str);
      }
      cell.color = str;
    }

    S.lastMs = performance.now() - t0;
    S.dirty = false;
    S.relightCount++;
    // ★ TA-12-4 更新通知：重着色批次完成后刷新纹理色档（只换颜色不换几何）。
    //   动态光/固定光兜底/明暗主题/光档变动全部经此批次流过，禁止遗留上一光档颜色；
    //   lp = 本趟参数快照，纹理色档与基底色保证同一光照输入。
    const TT = window.TerrainTexture;
    if (TT && typeof TT.refreshPalette === 'function') TT.refreshPalette(terr, shadeAlbedoInto, lp);
    // ★ v1.50.72：重着色批次完成后刷新地形离屏分块缓存
    if (window.TerrainChunkCache) window.TerrainChunkCache.invalidate();
  }

  // ── 立体实体面光照：相对旧固定光归一化，保证「换模型不换观感」 ──
  // 变暗 = 基色 × f；变亮 = 向白混合（避免浅色墙面直接饱和成纯白而丢细节）
  function shadeFace(baseHex, nx, ny, nz) {
    const c = cfg();
    const stamp = S.stamp;
    if (stamp !== _faceCacheStamp) { _faceCache.clear(); _faceCacheStamp = stamp; }
    const key = baseHex + '|' + nx + '|' + ny + '|' + nz;
    let v = _faceCache.get(key);
    if (v !== undefined) return v;

    const L = c.legacyDir || FALLBACK_CFG.legacyDir;
    const ambLegacy = c.ambientBase + c.ambientElevGain * L[2];
    const kLegacy = faceK(nx, ny, nz, L[0], L[1], L[2], ambLegacy, c.wrap);
    const kNow = faceK(nx, ny, nz, S.lx, S.ly, S.lz, S.ambient, c.wrap);
    const f = clamp(kNow / Math.max(1e-4, kLegacy), 0.55, 1.60);

    const rgb = hexToRgb(baseHex);
    let r, g, b;
    if (f <= 1) {
      r = rgb[0] * f; g = rgb[1] * f; b = rgb[2] * f;
    } else {
      const t = Math.min(1, (f - 1) / 0.6) * 0.45;   // 变亮上限 ≈ 45% 向白混合
      r = rgb[0] + (255 - rgb[0]) * t;
      g = rgb[1] + (255 - rgb[1]) * t;
      b = rgb[2] + (255 - rgb[2]) * t;
    }
    v = 'rgb(' + clamp(Math.round(r), 0, 255) + ', ' + clamp(Math.round(g), 0, 255) + ', ' + clamp(Math.round(b), 0, 255) + ')';
    _faceCache.set(key, v);
    return v;
  }

  // Accent 等纯表现层的材质受光入口。它直接消费当前世界光向、环境光、强度和色温，
  // 不复用 shadeFace 的旧光归一化逻辑，避免把房屋的历史兼容策略带进植被材质。
  // ★ TA-04-2 零分配变体 shadeRgbInto：结果写入调用方复用的 out（逐簇/逐面高频受光
  //   路径），公式与 shadeRgb 完全同源——法线归一化 → wrap 柔和漫反射 → ambient/intensity
  //   → tint 色温；法线须经模型变换（含剪切逆转置）转到世界空间后传入。
  function shadeRgbInto(rgb, nx, ny, nz, out) {
    const c = cfg();
    const len = Math.hypot(nx, ny, nz) || 1;
    const dot = clamp((nx / len) * S.lx + (ny / len) * S.ly + (nz / len) * S.lz, -1, 1);
    const diffuse = clamp((dot + c.wrap) / (1 + c.wrap), 0, 1);
    const k = clamp((S.ambient + (1 - S.ambient) * diffuse) * S.intensity, c.lightMin, c.lightMax);
    out[0] = clamp(Math.round(rgb[0] * k * S.tint[0]), 0, 255);
    out[1] = clamp(Math.round(rgb[1] * k * S.tint[1]), 0, 255);
    out[2] = clamp(Math.round(rgb[2] * k * S.tint[2]), 0, 255);
    return out;
  }

  function shadeRgb(rgb, nx, ny, nz) {
    return shadeRgbInto(rgb, nx, ny, nz, [0, 0, 0]);
  }

  // 相机参数来自 main.js 的全局词法绑定 `camera`（非 window 属性），仅在渲染期调用
  function camRef() {
    return (typeof camera !== 'undefined' && camera) ? camera : { rotZ: 0, rotX: 0.6, zoom: 1 };
  }

  // ── 阴影：世界空间方向 → 屏幕偏移（随相机旋转，修掉旧版屏幕固定偏移缺陷） ──
  function shadowOffset(height) {
    const dxw = S.shadowWx * S.shadowLen * height;
    const dyw = S.shadowWy * S.shadowLen * height;
    const cam = camRef();
    const cosZ = Math.cos(cam.rotZ || 0), sinZ = Math.sin(cam.rotZ || 0);
    const cosX = Math.cos(cam.rotX || 0);
    const zoom = cam.zoom || 1;
    return {
      dx: (dxw * cosZ - dyw * sinZ) * zoom,
      dy: (dxw * sinZ + dyw * cosZ) * cosX * zoom,
    };
  }

  // 光源在屏幕上的方向（单位向量），用于天空逆光光晕
  function sunScreenDir() {
    const cam = camRef();
    const cosZ = Math.cos(cam.rotZ || 0), sinZ = Math.sin(cam.rotZ || 0);
    const cosX = Math.cos(cam.rotX || 0);
    const wx = S.lx, wy = S.ly;
    const rx = wx * cosZ - wy * sinZ;
    const ry = (wx * sinZ + wy * cosZ) * cosX;
    const len = Math.hypot(rx, ry) || 1;
    return { x: rx / len, y: ry / len };
  }

  // ── 世界光向完整屏幕投影（TA-04-1，07-terrain-art.md §6.5 末段） ──
  // 立体树冠亮部 / 渐变光心的「屏幕光心」方向：与实体同一套相机变换把世界光向
  // （含 z 分量）完整投影到屏幕——screenX = Lx·cosZ − Ly·sinZ，
  // screenY = (Lx·sinZ + Ly·cosZ)·cosX − Lz·sinX。
  // sunScreenDir() 只投影水平分量（Lz 不参与、无回退），不能原样作为立体树冠
  // 亮部位置。光源接近视线方向时投影长度趋零，直接归一化会产生抖动/跳变——
  // 本函数在 len < eps 时把方向按 len/eps 平滑衰减回零（亮部回到冠心、偏移为 0），
  // 调用方无需分支：渐变光心 = (cx + x·r, cy + y·r)，r 为光心距冠心半径。
  // eps 迁入 RENDER_CONFIG.sunScreenEps（TA-04-2），缺省回退与原局部常量一致。
  function sunScreenEps() {
    const v = window.RENDER_CONFIG && window.RENDER_CONFIG.sunScreenEps;
    return (Number.isFinite(v) && v > 0) ? v : 0.02;
  }
  function sunScreenDirFullInto(out) {
    const cam = camRef();
    const eps = sunScreenEps();
    const cosZ = Math.cos(cam.rotZ || 0), sinZ = Math.sin(cam.rotZ || 0);
    const cosX = Math.cos(cam.rotX || 0), sinX = Math.sin(cam.rotX || 0);
    const sx = S.lx * cosZ - S.ly * sinZ;
    const sy = (S.lx * sinZ + S.ly * cosZ) * cosX - S.lz * sinX;
    const len = Math.hypot(sx, sy);
    if (len < eps) {
      if (len < 1e-9) { out.x = 0; out.y = 0; out.len = len; out.valid = false; return out; }
      const f = len / eps;
      out.x = (sx / len) * f; out.y = (sy / len) * f; out.len = len; out.valid = false;
      return out;
    }
    out.x = sx / len; out.y = sy / len; out.len = len; out.valid = true;
    return out;
  }
  function sunScreenDirFull() {
    return sunScreenDirFullInto({ x: 0, y: 0, len: 0, valid: false });
  }

  function compassName() {
    const idx = Math.round(S.azDeg / 45) % 8;
    return COMPASS[idx];
  }

  return {
    update,
    cfg,
    phase: () => S.phase,
    targetPhase: () => S.target,
    stamp: () => S.stamp,
    enabled: () => !!cfg().enabled,
    azimuthDeg: () => S.azDeg,
    elevationDeg: () => S.elevDeg,
    compass: compassName,
    intensity: () => S.intensity,
    ambient: () => S.ambient,
    tint: () => S.tint.slice(),
    lightDir: () => ({ x: S.lx, y: S.ly, z: S.lz }),
    // ★ TA-04-3 零分配变体：光向写入调用方复用对象（装饰绘制每实体读取，避免逐帧堆分配）
    lightDirInto: (out) => { out.x = S.lx; out.y = S.ly; out.z = S.lz; return out; },
    shadowLen: () => S.shadowLen,
    shadowAlpha: () => S.shadowAlpha,
    shadowOffset,
    // ★ TA-04-6 零分配变体：世界阴影方向（单位向量）+ 影长系数写入调用方复用对象
    //   （深度队列计算影梢世界落点消费；enabled=false 对照路径同样经 applyShadowVector 维护）
    shadowDirInto: (out) => { out.x = S.shadowWx; out.y = S.shadowWy; out.len = S.shadowLen; return out; },
    sunScreenDir,
    sunScreenDirFull,
    sunScreenDirFullInto, // ★ TA-04-4 零 GC 变体（装饰绘制每实体刷新屏幕光向刮擦）
    shadeFace,
    shadeRgb,
    shadeRgbInto,
    // ★ TA-12-4 共用地形受光步骤（TerrainTexture 纹理色档消费；relightTerrain 同源）
    lightParams,
    shadeAlbedoInto,
    lastMs: () => S.lastMs,
    relightCount: () => S.relightCount,
    // 时间跳变（读档 / 重置 / 时光倒流 / 无头恢复）后立即对齐，不做平滑
    resync: () => { S.snapNext = true; S.dirty = true; },
    markDirty: () => { S.dirty = true; },
    reset: () => { S.phase = 0; S.target = 0; S.stamp = -1; S.snapNext = true; S.dirty = true; S.lastNow = 0; _faceCache.clear(); _faceCacheStamp = null; },
  };
})();
