// === 世界坐标锁定的地表纹理 · 确定性纹样模型层（★ TA-12-2，TA-12-TODO §3/§5） ===
// 职责：固定整数哈希 → 世界桶候选 → 草斑/土纹世界空间图元几何 + 真实地表材质筛选 + 有界缓存与分批构建。
// 不负责：跨格裁剪与双线性贴地投影（TA-12-3 ::drawCell）、共用受光低对比色档（TA-12-4 ::refreshPalette）——
//   两处当前为接口占位，由后续任务在同一接口上落地。
//
// 确定性契约（TA-12-TODO §3.1，临时验证脚本验证后删除）：
//   · 图元身份由 hash32(styleVersion, bucketX, bucketY, kind, candidateIndex, channel) 唯一确定；
//   · 禁止 Math.random() / 墙钟 / frameCount / 相机参数 / 屏幕像素 / 访问顺序可变 PRNG 参与抽样；
//   · ★ 首期明确不依赖 _engineSeed：加载接口允许 seed 元信息缺省，不能假定该字段永远可恢复；
//     不同世界通过真实地表的材质筛选呈现差异，允许同坐标候选形状相同；
//   · 负坐标保留有符号整数位模式参与混合（Math.imul 按 int32 位模式运算）；
//   · 各属性独立 channel：修改某属性（如尺寸）不会串改其他属性（如位置）的抽样结果；
//   · 世界实例失效只管理缓存（invalidate），不进图元哈希——清缓存/回溯/刷新重建不换纹样。
//
// 纯表现层边界：不消耗 WorldRng、不写模拟状态、不进快照/存档；参数走 RENDER_CONFIG.terrainTexture，
//   不入 SIM_CONFIG（与 Rust SimConfig 互检冲突，同 config.render.js 先例）。
// 加载顺序：config.render.js 之后、rustworld.js 与渲染入口之前（index.html 保证）；
//   本文件不在脚本加载时读取任何 Canvas / DOM 全局。
(function () {
  'use strict';

  // 固定视觉盐值（'TEX1'）。风格整体换代走 styleVersion，不换盐。
  const SALT = 0x54455831 | 0;

  // ── 独立属性通道（§3.1）──
  const CH_POS_X = 1, CH_POS_Y = 2, CH_SIZE = 3, CH_ROT = 4, CH_SHAPE = 5,
    CH_SIGN = 6, CH_SIGN_MAG = 7, CH_SURV = 8, CH_FIELD = 9, CH_DIR = 10, CH_KEEP = 11;

  // ── 图元种类 ──
  const KIND_GRASS = 1, KIND_SOIL = 2;

  // 水系首期排除（§3.2：ShallowWater / DeepWater 不生成纹理，RiverBank 岸带同样排除，
  // 避免岸线和半透明水面下出现草斑）
  const WATER_KINDS = { ShallowWater: 1, DeepWater: 1, RiverBank: 1 };

  // 材质坡度带（度）：与 math.js::computeTerrainAlbedo 的 12°/28° 草→土→岩过渡同口径对齐；
  // 「提取无行为变化的共享材质权重帮助函数」归 TA-12-4，本层先以同值常量保持一致。
  const SLOPE_GRASS_FULL = 12.0;  // 12° 以下草坡：草斑全覆盖
  const SLOPE_GRASS_END = 26.0;   // 12°~26° 草斑平滑衰减（28° 起已入岩带，此前归零）
  const SLOPE_SOIL_BEGIN = 8.0;   // 8° 起土纹开始出现
  const SLOPE_SOIL_FULL = 20.0;   // 20° 达到土纹主覆盖带
  const SLOPE_ROCK_BEGIN = 26.0;  // 26°~40° 陡岩逐渐衰减至零
  const SLOPE_ROCK_END = 40.0;    // 40° 以上为纯岩面，两类纹理均归零

  // 桶键编码：支持 ±511 桶（世界 764 / 桶 12 ≈ ±32，余量充足）
  function bucketKey(bx, by) { return (bx + 512) * 1024 + (by + 512); }

  // ── 固定整数哈希（§3.1：明确的 32 位整数混合）──
  // 可变参数逐个以 int32 位模式混入（负坐标保留位模式），末尾 murmur 风格雪崩。
  function hash32() {
    let h = SALT >>> 0;
    for (let i = 0; i < arguments.length; i++) {
      h = (Math.imul(h, 0x9e3779b1) + (arguments[i] | 0)) >>> 0;
      h ^= h >>> 15;
      h = Math.imul(h, 0x85ebca6b) >>> 0;
      h ^= h >>> 13;
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }
  // 通道取样 → [0,1)。channel 独立 ⇒ 属性间抽样互不串扰。
  function hash01(styleVersion, bx, by, kind, slot, channel) {
    return hash32(styleVersion, bx, by, kind, slot, channel) / 4294967296;
  }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(e0, e1, x) {
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  }

  const nowMs = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  // ── 配置缺省回退（与 config.render.js::RENDER_CONFIG.terrainTexture 严格一致；
  //    删任一键行为不变。detailFadePx 等 LOD 绘制参数归 TA-12-3 随 drawCell 落地）──
  const DEFAULTS = {
    enabled: true,
    styleVersion: 1,
    bucketSizeWorld: 12,
    grassCandidates: 3,
    soilCandidates: 2,
    grassSizeRange: [2, 6],      // 草斑直径区间（世界单位）
    soilLengthRange: [1, 3],     // 土纹长度区间（世界单位）
    soilWidthRange: [0.2, 0.5],  // 土纹宽度区间（世界单位）
    contrast: 0.04,              // 明度扰动基准幅度（相对反照率等比例）
    contrastMax: 0.08,           // 明度扰动上限
    cacheMaxBytes: 8 * 1024 * 1024,
    buildBudgetMs: 2,
  };

  function num(v, dflt, lo, hi) {
    if (typeof v !== 'number' || !isFinite(v)) return dflt;
    return lo != null && v < lo ? lo : (hi != null && v > hi ? hi : v);
  }
  function range2(v, dflt) {
    if (!Array.isArray(v) || v.length !== 2) return dflt.slice();
    const a = num(v[0], dflt[0], 0), b = num(v[1], dflt[1], 0);
    return a <= b ? [a, b] : [b, a];
  }

  // 接受 terrainTexture 子对象或整个 RENDER_CONFIG；统一缺省与合法性校验（§5.3）。
  function resolveConfig(config) {
    let c = config;
    if (c && c.terrainTexture) c = c.terrainTexture;
    if (!c || typeof c !== 'object') c = {};
    const grassSizeRange = range2(c.grassSizeRange, DEFAULTS.grassSizeRange);
    const soilLengthRange = range2(c.soilLengthRange, DEFAULTS.soilLengthRange);
    const soilWidthRange = range2(c.soilWidthRange, DEFAULTS.soilWidthRange);
    return {
      enabled: c.enabled !== false,
      styleVersion: Math.max(1, Math.round(num(c.styleVersion, DEFAULTS.styleVersion, 1))),
      bucketSizeWorld: num(c.bucketSizeWorld, DEFAULTS.bucketSizeWorld, 1),
      grassCandidates: Math.max(0, Math.round(num(c.grassCandidates, DEFAULTS.grassCandidates, 0))),
      soilCandidates: Math.max(0, Math.round(num(c.soilCandidates, DEFAULTS.soilCandidates, 0))),
      grassSizeRange,
      soilLengthRange,
      soilWidthRange,
      contrast: num(c.contrast, DEFAULTS.contrast, 0),
      contrastMax: num(c.contrastMax, DEFAULTS.contrastMax, 0),
      cacheMaxBytes: Math.max(1, num(c.cacheMaxBytes, DEFAULTS.cacheMaxBytes, 1)),
      buildBudgetMs: Math.max(0, num(c.buildBudgetMs, DEFAULTS.buildBudgetMs, 0)),
      maxPrimHalf: Math.max(grassSizeRange[1], soilLengthRange[1]) * 0.5,
    };
  }

  // 配置修订签名：仅模型相关键（§5.3「配置热调在 prepare 阶段计算修订」）。
  function configRevision(cfg) {
    return [cfg.enabled ? 1 : 0, cfg.styleVersion, cfg.bucketSizeWorld, cfg.grassCandidates,
      cfg.soilCandidates, cfg.grassSizeRange.join(','), cfg.soilLengthRange.join(','),
      cfg.soilWidthRange.join(','), cfg.contrast, cfg.contrastMax, cfg.cacheMaxBytes].join('|');
  }

  // ── 地表查询与材质权重（§3.2：两类都以真实坡度与肥力的连续权重控制覆盖率）──
  // 就近顶点格索引查询（cells 为顶点阵列，四顶点组成一可绘制格——顶点数 ≠ 纹理单元数）。
  // 只读查询，不写共享 cell 对象。
  function cellIndexAt(terrain, wx, wy) {
    const w = terrain.gridSize | 0;
    const worldSize = terrain.worldSize || 764.0;
    let gx = Math.round((wx + worldSize * 0.5) / worldSize * (w - 1));
    let gy = Math.round((wy + worldSize * 0.5) / worldSize * (w - 1));
    if (gx < 0) gx = 0; else if (gx > w - 1) gx = w - 1;
    if (gy < 0) gy = 0; else if (gy > w - 1) gy = w - 1;
    return gy * w + gx;
  }
  function cellAt(terrain, wx, wy) {
    return terrain.cells[cellIndexAt(terrain, wx, wy)] || null;
  }

  function slopeDegOf(cell) {
    if (typeof cell.slopeAngle === 'number' && isFinite(cell.slopeAngle)) return cell.slopeAngle;
    // 兜底：无定稿坡度字段时按 dzdx/dzdy 重算（口径同 math.js）
    const g = Math.hypot(cell.dzdx || 0, cell.dzdy || 0);
    return Math.atan(g) * (180 / Math.PI);
  }

  // 材质覆盖率权重 [0,1]：水系恒 0；草斑走草坡带 + 肥力；土纹走土带 + 陡岩衰减 + 贫瘠加成。
  function materialWeight(kind, cell) {
    if (!cell || WATER_KINDS[cell.surfaceKind]) return 0;
    const s = slopeDegOf(cell);
    const fert = clamp01(cell.naturalFertility != null ? cell.naturalFertility : 1);
    if (kind === KIND_GRASS) {
      return (1 - smoothstep(SLOPE_GRASS_FULL, SLOPE_GRASS_END, s)) * (0.35 + 0.65 * fert);
    }
    const soilBand = 0.25 + 0.75 * smoothstep(SLOPE_SOIL_BEGIN, SLOPE_SOIL_FULL, s);
    const w = soilBand * (1 - smoothstep(SLOPE_ROCK_BEGIN, SLOPE_ROCK_END, s)) * (1.15 - 0.5 * fert);
    return clamp01(w);
  }

  // ── 图元几何生成（先出候选，再按材质筛选；§3.2）──

  // 草斑：4~6 顶点不规则扁平斑块，桶内抖动候选点；正负明度变化配对（sign ±1 各半）。
  // 形状细节槽位取 k*16 步长（角度/半径各 +2i），保证候选间槽位不重叠（独立抽样）。
  function pushGrass(m, cfg, bx, by, k, cx, cy) {
    const sv = cfg.styleVersion;
    const n = 4 + Math.floor(hash01(sv, bx, by, KIND_GRASS, k * 16, CH_SHAPE) * 2.999);
    const diameter = lerp(cfg.grassSizeRange[0], cfg.grassSizeRange[1], hash01(sv, bx, by, KIND_GRASS, k * 16 + 1, CH_SIZE));
    const r = diameter * 0.5;
    const vOff = m.vx.length;
    for (let i = 0; i < n; i++) {
      const ang = 2 * Math.PI * (i + 0.35 * hash01(sv, bx, by, KIND_GRASS, k * 16 + 2 + i * 2, CH_SHAPE)) / n;
      const rad = r * (0.55 + 0.45 * hash01(sv, bx, by, KIND_GRASS, k * 16 + 3 + i * 2, CH_SHAPE));
      m.vx.push(cx + Math.cos(ang) * rad);
      m.vy.push(cy + Math.sin(ang) * rad);
    }
    const sign = hash01(sv, bx, by, KIND_GRASS, k, CH_SIGN) < 0.5 ? -1 : 1;
    const mag = lerp(cfg.contrast, cfg.contrastMax, hash01(sv, bx, by, KIND_GRASS, k, CH_SIGN_MAG));
    pushPrim(m, KIND_GRASS, sign, mag, cx, cy, vOff, n);
  }

  // 土纹：短窄多边形；方向 = 桶群弱方向趋势（低频区域共享）+ 个体抖动，两端宽窄不一。
  // 尺寸槽位取 k*8 步长（长度/宽度/两端半宽），候选间槽位不重叠。
  function pushSoil(m, cfg, bx, by, k, cx, cy) {
    const sv = cfg.styleVersion;
    const len = lerp(cfg.soilLengthRange[0], cfg.soilLengthRange[1], hash01(sv, bx, by, KIND_SOIL, k * 8 + 1, CH_SIZE));
    const wid = lerp(cfg.soilWidthRange[0], cfg.soilWidthRange[1], hash01(sv, bx, by, KIND_SOIL, k * 8 + 2, CH_SIZE));
    const baseAng = 2 * Math.PI * hash01(sv, bx >> 2, by >> 2, KIND_SOIL, 0, CH_DIR);
    const ang = baseAng + (hash01(sv, bx, by, KIND_SOIL, k, CH_ROT) - 0.5) * 1.2;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const px = -dy, py = dx;
    const hx = len * 0.5;
    const w0 = wid * (0.6 + 0.8 * hash01(sv, bx, by, KIND_SOIL, k * 8 + 3, CH_SIZE)) * 0.5;
    const w1 = wid * (0.6 + 0.8 * hash01(sv, bx, by, KIND_SOIL, k * 8 + 4, CH_SIZE)) * 0.5;
    const vOff = m.vx.length;
    m.vx.push(cx - dx * hx + px * w0, cx + dx * hx + px * w1, cx + dx * hx - px * w1, cx - dx * hx - px * w0);
    m.vy.push(cy - dy * hx + py * w0, cy + dy * hx + py * w1, cy + dy * hx - py * w1, cy - dy * hx - py * w0);
    const sign = hash01(sv, bx, by, KIND_SOIL, k, CH_SIGN) < 0.5 ? -1 : 1;
    const mag = lerp(cfg.contrast, cfg.contrastMax, hash01(sv, bx, by, KIND_SOIL, k, CH_SIGN_MAG));
    pushPrim(m, KIND_SOIL, sign, mag, cx, cy, vOff, 4);
  }

  function pushPrim(m, kind, sign, tone, cx, cy, vOff, vCount) {
    m.kinds.push(kind);
    m.signs.push(sign);
    m.tones.push(tone);
    m.cxs.push(cx);
    m.cys.push(cy);
    m.cellIdx.push(m.centerCell);
    m.vOffs.push(vOff);
    m.vCounts.push(vCount);
  }

  // ── 单桶构建（纯函数：只读自身桶坐标 + 地表材质，与遍历顺序/批次无关）──
  function buildBucket(m, terrain, cfg, bx, by) {
    const sv = cfg.styleVersion;
    const bs = cfg.bucketSizeWorld;
    // 稳定低频场调制密度（§3.2：避免等间距铺点）——4 桶粗粒度共享一个密度系数
    const field = 0.35 + 0.65 * hash01(sv, bx >> 2, by >> 2, 0, 0, CH_FIELD);
    const half = (terrain.worldSize || 764.0) * 0.5;
    const margin = cfg.maxPrimHalf + 0.5; // 中心离沙盘边界至少一个图元半径（§7 不越界）

    for (let k = 0; k < cfg.grassCandidates; k++) {
      const cx = (bx + 0.08 + 0.84 * hash01(sv, bx, by, KIND_GRASS, k, CH_POS_X)) * bs;
      const cy = (by + 0.08 + 0.84 * hash01(sv, bx, by, KIND_GRASS, k, CH_POS_Y)) * bs;
      if (cx < -half + margin || cx > half - margin || cy < -half + margin || cy > half - margin) continue;
      const idx = cellIndexAt(terrain, cx, cy);
      m.centerCell = idx;
      // 候选先生成，再按所在位置的地表材料筛选（连续权重 = 低频场 × 材质）
      const p = field * materialWeight(KIND_GRASS, terrain.cells[idx]);
      if (p <= 0 || hash01(sv, bx, by, KIND_GRASS, k, CH_SURV) >= p) continue;
      pushGrass(m, cfg, bx, by, k, cx, cy);
    }
    for (let k = 0; k < cfg.soilCandidates; k++) {
      const cx = (bx + 0.08 + 0.84 * hash01(sv, bx, by, KIND_SOIL, k, CH_POS_X)) * bs;
      const cy = (by + 0.08 + 0.84 * hash01(sv, bx, by, KIND_SOIL, k, CH_POS_Y)) * bs;
      if (cx < -half + margin || cx > half - margin || cy < -half + margin || cy > half - margin) continue;
      const idx = cellIndexAt(terrain, cx, cy);
      m.centerCell = idx;
      const p = field * materialWeight(KIND_SOIL, terrain.cells[idx]);
      if (p <= 0 || hash01(sv, bx, by, KIND_SOIL, k, CH_SURV) >= p) continue;
      pushSoil(m, cfg, bx, by, k, cx, cy);
    }
  }

  // ── API ──
  const api = {
    KIND_GRASS, KIND_SOIL,
    WATER_KINDS,
    DEFAULTS,

    // TA-12-3 接入：单格纹理分片绘制（基底之后、同 DEPTH_CELL）。当前为接口占位。
    drawCell(ctx, indices, projection, lod) { return false; },

    // TA-12-4 接入：受光/反照率变化时刷新有限纹理色档。当前为接口占位。
    refreshPalette(terrain, shadeFn) { return false; },

    // 释放世界相关几何与重建队列（§5.1）。reason 仅用于统计，不进图元哈希——
    // 清缓存 / 回溯 / 刷新后重建得到相同纹样。
    invalidate(reason) {
      this._model = null;
      this._stats.invalidations++;
      this._stats.lastInvalidationReason = String(reason || '');
    },

    // 对当前地形身份及配置修订生成/补齐模型（§5.1）。可重复调用：热路径幂等；
    // 返回是否已全部就绪（分批未完成时为 false，消费方只画就绪部分）。
    prepare(terrain, config) {
      const cfg = resolveConfig(config);
      if (!cfg.enabled || !terrain || !terrain.cells || !(terrain.gridSize > 0)) {
        if (this._model) this.invalidate('disabled-or-no-terrain');
        return false;
      }
      const rev = configRevision(cfg);
      const m = this._model;
      if (m && m.terrain === terrain && m.rev === rev) {
        this._advanceBuild();
        return m.cursor >= m.pending.length;
      }
      this._startModel(terrain, cfg, rev);
      this._advanceBuild();
      return this._model.cursor >= this._model.pending.length;
    },

    // 缓存字节 / 分片数量 / 构建耗时统计（§5.1：用于临时验收）。
    stats() {
      const m = this._model;
      const s = this._stats;
      if (!m) return {
        ready: false, prims: 0, vertices: 0, buckets: 0, pending: 0,
        bytes: 0, cacheMaxBytes: 0, overLimit: false,
        builds: s.builds, invalidations: s.invalidations,
        lastInvalidationReason: s.lastInvalidationReason,
        lastBuildMs: s.lastBuildMs,
      };
      return {
        ready: m.cursor >= m.pending.length,
        prims: m.kinds.length,
        vertices: m.vx.length,
        buckets: m.buckets.size,
        pending: (m.pending.length - m.cursor) / 2,
        bytes: m.bytes,
        cacheMaxBytes: m.cacheMaxBytes,
        overLimit: m.overLimit,
        builds: s.builds,
        invalidations: s.invalidations,
        lastInvalidationReason: s.lastInvalidationReason,
        lastBuildMs: s.lastBuildMs,
      };
    },

    // ── 内部状态 ──
    _model: null,
    _stats: { builds: 0, invalidations: 0, lastInvalidationReason: '', lastBuildMs: 0 },

    _startModel(terrain, cfg, rev) {
      const bs = cfg.bucketSizeWorld;
      const half = (terrain.worldSize || 764.0) * 0.5;
      // 覆盖世界的固定桶序（行主序）：分批与一次成型、任何遍历顺序都产出同一模型
      const pending = [];
      const b0x = Math.floor((-half - cfg.maxPrimHalf) / bs), b1x = Math.floor((half + cfg.maxPrimHalf) / bs);
      const b0y = Math.floor((-half - cfg.maxPrimHalf) / bs), b1y = Math.floor((half + cfg.maxPrimHalf) / bs);
      for (let by = b0y; by <= b1y; by++) {
        for (let bx = b0x; bx <= b1x; bx++) pending.push(bx, by);
      }
      // 质量上限（§5.2：超出 cacheMaxBytes 采用确定的质量上限）——
      // 先按候选数等比例降档（下限 1）；仍超限则按固定哈希抽稀桶（不规则缺块，非规则网格）。
      // 两条路径都由 (styleVersion, 桶坐标, 上限) 唯一确定，淘汰后重建得到相同图元。
      const estBytes = (pending.length / 2) * (cfg.grassCandidates + cfg.soilCandidates) * 6 * 8 * 2;
      let gCand = cfg.grassCandidates, sCand = cfg.soilCandidates, keepP = 1;
      if (estBytes > cfg.cacheMaxBytes) {
        const scale = cfg.cacheMaxBytes / estBytes;
        gCand = Math.max(1, Math.floor(cfg.grassCandidates * scale));
        sCand = Math.max(1, Math.floor(cfg.soilCandidates * scale));
        const est2 = (pending.length / 2) * (gCand + sCand) * 6 * 8 * 2;
        if (est2 > cfg.cacheMaxBytes) keepP = Math.max(1 / (pending.length / 2), cfg.cacheMaxBytes / est2);
      }
      this._model = {
        terrain, rev, cfg,
        pending,
        cursor: 0,
        buckets: new Map(),
        vx: [], vy: [],
        kinds: [], signs: [], tones: [], cxs: [], cys: [], cellIdx: [], vOffs: [], vCounts: [],
        bytes: 0, cacheMaxBytes: cfg.cacheMaxBytes, overLimit: false,
        gCand, sCand, keepP,
      };
    },

    _advanceBuild() {
      const m = this._model;
      if (!m || m.cursor >= m.pending.length) return;
      const t0 = nowMs();
      const budget = m.cfg.buildBudgetMs;
      const mc = Object.assign({}, m.cfg, { grassCandidates: m.gCand, soilCandidates: m.sCand });
      while (m.cursor < m.pending.length) {
        const bx = m.pending[m.cursor], by = m.pending[m.cursor + 1];
        m.cursor += 2;
        // 确定性桶抽稀（仅超低上限触发）：按桶坐标哈希保留，与构建顺序无关
        if (m.keepP < 1 && hash01(m.cfg.styleVersion, bx, by, 0, 2, CH_KEEP) >= m.keepP) continue;
        const mm = {
          vx: m.vx, vy: m.vy, kinds: m.kinds, signs: m.signs, tones: m.tones,
          cxs: m.cxs, cys: m.cys, cellIdx: m.cellIdx, vOffs: m.vOffs, vCounts: m.vCounts,
          centerCell: -1,
        };
        const before = m.kinds.length;
        buildBucket(mm, m.terrain, mc, bx, by);
        if (m.kinds.length > before) {
          m.buckets.set(bucketKey(bx, by), { bx, by, start: before, end: m.kinds.length });
        }
        if (m.cursor < m.pending.length && nowMs() - t0 > budget) break; // 每批至少一桶，超出预算即让路
      }
      this._stats.lastBuildMs = nowMs() - t0;
      if (m.cursor >= m.pending.length) this._finalize();
    },

    _finalize() {
      const m = this._model;
      m.vx = Float32Array.from(m.vx);
      m.vy = Float32Array.from(m.vy);
      m.kinds = Uint8Array.from(m.kinds);
      m.signs = Int8Array.from(m.signs);
      m.tones = Float32Array.from(m.tones);
      m.cxs = Float32Array.from(m.cxs);
      m.cys = Float32Array.from(m.cys);
      m.cellIdx = Int32Array.from(m.cellIdx);
      m.vOffs = Uint32Array.from(m.vOffs);
      m.vCounts = Uint8Array.from(m.vCounts);
      m.bytes = m.vx.byteLength + m.vy.byteLength + m.kinds.byteLength + m.signs.byteLength +
        m.tones.byteLength + m.cxs.byteLength + m.cys.byteLength + m.cellIdx.byteLength +
        m.vOffs.byteLength + m.vCounts.byteLength;
      m.overLimit = m.bytes > m.cacheMaxBytes;
      this._stats.builds++;
    },

    // ── 临时验收 / 调试内省（TA-12-TODO §6 第 2 项：临时脚本使用后删除；保留 stats 为正式验收口）──
    _debug: { hash32, hash01, smoothstep, materialWeight, cellAt, buildBucket, bucketKey, resolveConfig, configRevision },
  };

  window.TerrainTexture = api;
})();
