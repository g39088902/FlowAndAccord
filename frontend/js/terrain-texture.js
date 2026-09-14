// === 世界坐标锁定的地表纹理 · 确定性纹样模型层（★ TA-12-2/3/4，TA-12-TODO §3/§4/§5） ===
// 职责：固定整数哈希 → 世界桶候选 → 草斑/土纹世界空间图元几何 + 真实地表材质筛选 + 有界缓存与分批构建；
//   ★ TA-12-3：构建期跨格预裁剪（图元 → 各触及格世界矩形分片 + 目标格材料过滤 + 分片 (u,v) 贴面坐标）
//   与 drawCell 逐格双线性贴面投影绘制（四角凸组合，恒在本格四边形内，随 drawTerrainCell 深度队列落笔）。
//   ★ TA-12-4：refreshPalette 由 lighting.js::relightTerrain 重着色批次末尾调用（注入共用受光步骤
//   shadeAlbedoInto 与本趟 lightParams 快照）；drawCell 色档 = 反照率小幅等比扰动后走与基底同一受光
//   管线（法线/AO/光向/色温/大气色洗同序），按格惰性预存 8 档（sign×lvl）去重缓存，不对已色洗色重复施光。
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
    detailFadePx: [2, 5],        // LOD 特征尺度淡入区间（CSS px，§4.2：2~5px smoothstep）
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
    const detailFadePx = range2(c.detailFadePx, DEFAULTS.detailFadePx);
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
      detailFadePx,
      maxPrimHalf: Math.max(grassSizeRange[1], soilLengthRange[1]) * 0.5,
    };
  }

  // 配置修订签名：仅模型相关键（§5.3「配置热调在 prepare 阶段计算修订」）。
  // detailFadePx 只作用于 LOD 淡入透明度，不改变几何身份 → 故意不入签名（不触发重建）。
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
    pushPrim(m, KIND_GRASS, sign, mag, cx, cy, vOff, n, diameter);
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
    pushPrim(m, KIND_SOIL, sign, mag, cx, cy, vOff, 4, len);
  }

  function pushPrim(m, kind, sign, tone, cx, cy, vOff, vCount, size) {
    m.kinds.push(kind);
    m.signs.push(sign);
    m.tones.push(tone);
    m.cxs.push(cx);
    m.cys.push(cy);
    m.cellIdx.push(m.centerCell);
    m.vOffs.push(vOff);
    m.vCounts.push(vCount);
    m.sizes.push(size); // 特征尺寸（世界单位；草斑=直径 / 土纹=长度），TA-12-3 LOD 淡入消费
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

  // ── TA-12-3 跨格预裁剪（§3.3：仅模型构建期裁剪，跨格只产生分片不再抽样）──
  // Sutherland–Hodgman 逐半平面裁剪：输入为凸多边形（草斑 ≤6 顶点 / 土纹 4 顶点），
  // 单趟输出 ≤ n+2，四趟 ≤ n+8 ≤ 14 → scratch 容量 16 足够。模块级复用，零构建期分配。
  let _cAX = new Float64Array(16), _cAY = new Float64Array(16);
  let _cBX = new Float64Array(16), _cBY = new Float64Array(16);

  // 把 _cA/_cB 中 n 个顶点裁到半平面（axis 0=x/1=y；isMin=true 即 value ≥ bound），
  // 结果写入 _cB 并交换 A/B。返回新顶点数；0 = 多边形完全在半平面外。
  function _clipPlane(n, axis, bound, isMin) {
    let m = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const cx = _cAX[i], cy = _cAY[i];
      const nx = _cAX[j], ny = _cAY[j];
      const cv = axis === 0 ? cx : cy;
      const nv = axis === 0 ? nx : ny;
      const cin = isMin ? cv >= bound : cv <= bound;
      const nin = isMin ? nv >= bound : nv <= bound;
      if (cin) { _cBX[m] = cx; _cBY[m] = cy; m++; }
      if (cin !== nin) {
        const t = (bound - cv) / (nv - cv);
        _cBX[m] = cx + (nx - cx) * t;
        _cBY[m] = cy + (ny - cy) * t;
        m++;
      }
    }
    const tx = _cAX; _cAX = _cBX; _cBX = tx;
    const ty = _cAY; _cAY = _cBY; _cBY = ty;
    return m;
  }

  // 裁剪到世界矩形 [rx0,rx1]×[ry0,ry1]；结果在 _cAX/_cAY，返回顶点数（<3 = 无有效分片）。
  function clipToRect(n, rx0, ry0, rx1, ry1) {
    let m = n;
    if ((m = _clipPlane(m, 0, rx0, true)) < 3) return 0;
    if ((m = _clipPlane(m, 0, rx1, false)) < 3) return 0;
    if ((m = _clipPlane(m, 1, ry0, true)) < 3) return 0;
    if ((m = _clipPlane(m, 1, ry1, false)) < 3) return 0;
    return m;
  }

  // drawCell 逐分片屏幕坐标 scratch（容量同裁剪上限 16；热路径零分配）
  const _fx = new Float64Array(16), _fy = new Float64Array(16);

  // 把模型中 [firstPrim, kinds.length) 的新图元预裁剪到各触及格，登记分片（u,v 相对本格 0~1）。
  // 归属规则（§3.3）：图元只由中心桶生成一次（跨桶不重复），分片按「触及格」登记；
  //   共享边的交点用相同世界边界坐标算出 → 相邻分片边界顶点 (u=1)/(u=0) 世界坐标一致；
  //   目标格材料过滤：水系或该类材质权重为 0（陡岩）的格不产生分片（§3.2 跨格片段检查）。
  //   约定格 (gx,gy) 的世界矩形 = [-half+gx·step, +step] × 同 y；u 沿 +x / v 沿 +y，
  //   与 drawTerrainCell 的 i00(左上)→i10(右上)→i11(右下)→i01(左下) 四角一一对应。
  function buildFragments(m, firstPrim) {
    const terrain = m.terrain;
    const gSize = terrain.gridSize;
    const half = (terrain.worldSize || 764.0) * 0.5;
    const step = (half * 2) / (gSize - 1);
    const kinds = m.kinds, vOffs = m.vOffs, vCounts = m.vCounts;
    const vx = m.vx, vy = m.vy;
    const maxGx = gSize - 2;
    for (let p = firstPrim; p < kinds.length; p++) {
      const kind = kinds[p];
      const off = vOffs[p], cnt = vCounts[p];
      // 图元 AABB → 触及格范围（图元半径 ≥ 边界余量，格范围必在沙盘内，钳位兜底）
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < cnt; i++) {
        const x = vx[off + i], y = vy[off + i];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      let gx0 = Math.floor((minX + half) / step), gx1 = Math.floor((maxX + half) / step);
      let gy0 = Math.floor((minY + half) / step), gy1 = Math.floor((maxY + half) / step);
      if (gx0 < 0) gx0 = 0; if (gx1 > maxGx) gx1 = maxGx;
      if (gy0 < 0) gy0 = 0; if (gy1 > maxGx) gy1 = maxGx;
      for (let gy = gy0; gy <= gy1; gy++) {
        const ry0 = -half + gy * step, ry1 = ry0 + step;
        for (let gx = gx0; gx <= gx1; gx++) {
          // 目标格材料过滤（含水系）：权重 0 的格保留纯基底
          if (materialWeight(kind, terrain.cells[gy * gSize + gx]) <= 0) continue;
          const rx0 = -half + gx * step, rx1 = rx0 + step;
          for (let i = 0; i < cnt; i++) { _cAX[i] = vx[off + i]; _cAY[i] = vy[off + i]; }
          const fn = clipToRect(cnt, rx0, ry0, rx1, ry1);
          if (fn < 3) continue; // 退化分片（无面积/线状）跳过，保留基底
          const ci = gy * gSize + gx;
          let rec = m.cellFrags.get(ci);
          if (rec === undefined) { rec = { us: [], vs: [], meta: [] }; m.cellFrags.set(ci, rec); }
          rec.meta.push(p, rec.us.length, fn);
          for (let i = 0; i < fn; i++) {
            rec.us.push(clamp01((_cAX[i] - rx0) / step));
            rec.vs.push(clamp01((_cAY[i] - ry0) / step));
          }
        }
      }
    }
  }

  // ── API ──
  const api = {
    KIND_GRASS, KIND_SOIL,
    WATER_KINDS,
    DEFAULTS,

    // ── TA-12-3 接入：单格纹理分片绘制（由 render_terrain.js::drawTerrainCell 在基底
    // 之后调用，与基底同属 DEPTH_CELL；不新增队列项、不抬 Z、不调用 projectLifted）。
    // 只消费预裁剪分片与色档，不抽样、不改模拟。投影 = 四角屏幕坐标的双线性凸组合：
    //   P(u,v) = (1-u)(1-v)P00 + u(1-v)P10 + uvP11 + (1-u)vP01
    // 权重非负且和为 1 → 分片恒在本格四边形凸包内，调用方视口剔除已覆盖（§3.3.4）。
    // 参数（零分配约定）：i00 = 本格左上顶点索引；p00..p01 = 四角投影坐标（CSS px）；
    //   lod = 世界→CSS 像素尺度（camera.zoom，DPR 不参与）。
    // 返回本格实际绘制的分片数（未就绪 / 无分片 / 全 LOD 剔除为 0）。
    drawCell(ctx, i00, p00x, p00y, p10x, p10y, p11x, p11y, p01x, p01y, lod) {
      const m = this._model;
      if (!m || m.cursor < m.pending.length || m.cellFrags) return 0; // 未就绪/未拍平只画基底
      const rec = m.fragsByCell.get(i00);
      if (rec === undefined) return 0;
      // 色档 epoch（★ TA-12-4）：refreshPalette 由 relightTerrain 重着色批次显式通知清缓存；
      // terrain + relightCount 判据兜底（通知缺失时也不遗留上一光档颜色）
      const SL = window.SimLighting;
      const rel = SL ? SL.relightCount() : -1;
      if (this._shadeEpochT !== m.terrain || this._shadeEpochR !== rel) {
        this._shadeCache.clear();
        this._shadeEpochT = m.terrain;
        this._shadeEpochR = rel;
        this._lp = null; // 光参数按新光档现取
      }
      if (!m.terrain.cells || !m.terrain.cells[i00]) return 0;
      const cfg = m.cfg;
      const f0 = cfg.detailFadePx[0], f1 = cfg.detailFadePx[1];
      const fragPrim = m.fragPrim, fragVOff = m.fragVOff, fragVCount = m.fragVCount;
      const fragU = m.fragU, fragV = m.fragV, sizes = m.sizes, signs = m.signs, tones = m.tones;
      const off = rec.off, cnt = rec.cnt;
      let drawn = 0, alphaUsed = false;
      for (let f = 0; f < cnt; f++) {
        const fi = off + f, p = fragPrim[fi];
        // LOD（§4.2）：特征尺度 = 图元特征尺寸 × 世界→CSS 像素尺度；detailFadePx 间 smoothstep
        const pxSize = sizes[p] * lod;
        let a;
        if (f1 <= f0) a = pxSize >= f0 ? 1 : 0;
        else if (pxSize >= f1) a = 1;
        else if (pxSize <= f0) continue;
        else a = smoothstep(f0, f1, pxSize);
        const shade = this._shadeFor(i00, signs[p], tones[p]);
        if (shade === null) continue;
        const n = fragVCount[fi], vo = fragVOff[fi];
        // 先算坐标并做非法投影守卫（§3.3：NaN/退化 → 跳过分片保留基底，不得产生 NaN）
        let acc = 0;
        for (let i = 0; i < n; i++) {
          const u = fragU[vo + i], v = fragV[vo + i];
          const w10 = u * (1 - v), w11 = u * v;
          const w00 = (1 - u) * (1 - v), w01 = (1 - u) * v;
          const sx = w00 * p00x + w10 * p10x + w11 * p11x + w01 * p01x;
          const sy = w00 * p00y + w10 * p10y + w11 * p11y + w01 * p01y;
          _fx[i] = sx; _fy[i] = sy;
          acc += sx + sy;
        }
        if (!isFinite(acc)) continue;
        ctx.beginPath();
        ctx.moveTo(_fx[0], _fy[0]);
        for (let i = 1; i < n; i++) ctx.lineTo(_fx[i], _fy[i]);
        ctx.closePath();
        ctx.fillStyle = shade;
        if (a < 1) { ctx.globalAlpha = a; alphaUsed = true; }
        ctx.fill();
        drawn++;
      }
      if (alphaUsed) ctx.globalAlpha = 1; // §4.1：LOD globalAlpha 用毕必须恢复 Canvas 状态
      this._stats.drawCells++;
      this._stats.drawFrags += drawn;
      return drawn;
    },

    // ★ TA-12-4：受光/反照率变化时刷新有限纹理色档。由 lighting.js::relightTerrain 重着色
    // 批次末尾调用：shadeFn = 共用受光步骤 shadeAlbedoInto、lp = 本趟 lightParams() 快照——
    // 动态光/固定光兜底/明暗主题/光档变动全部经此批次流过，禁止遗留上一光档颜色。
    // 色档按格惰性预存（drawCell 首笔落格时生成 sign×lvl 8 档去重缓存），此处只失效与注入。
    refreshPalette(terrain, shadeFn, lp) {
      this._shadeCache.clear();
      this._shadeEpochT = terrain || null;
      this._shadeEpochR = -2; // 与 relightCount 判据解耦：显式通知后由 drawCell 重新对齐
      this._shadeFn = typeof shadeFn === 'function' ? shadeFn : null;
      this._lp = lp || null;
      return true;
    },

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
        frags: 0, drawCells: s.drawCells, drawFrags: s.drawFrags,
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
        frags: m.fragPrim ? m.fragPrim.length : 0,
        drawCells: s.drawCells,
        drawFrags: s.drawFrags,
        builds: s.builds,
        invalidations: s.invalidations,
        lastInvalidationReason: s.lastInvalidationReason,
        lastBuildMs: s.lastBuildMs,
      };
    },

    // ── 内部状态 ──
    _model: null,
    _stats: { builds: 0, invalidations: 0, lastInvalidationReason: '', lastBuildMs: 0, drawCells: 0, drawFrags: 0 },
    // ★ TA-12-4 受光色档缓存（按格惰性预存去重；refreshPalette 显式失效 + terrain/relightCount 兜底）
    _shadeCache: new Map(),
    _shadeEpochT: null,
    _shadeEpochR: -1,
    _shadeFn: null, // relightTerrain 批次注入的共用受光步骤（lighting.js::shadeAlbedoInto）
    _lp: null,      // 注入的本趟光照参数快照（null = drawCell 时经 SimLighting.lightParams 现取）
    _out3: [0, 0, 0],

    // ★ TA-12-4 受光色档：反照率小幅等比扰动（±eff，tone 量化 4 档，档差 ≤1% 明度不可辨）
    // 后走 lighting.js 共用受光步骤（法线/AO/光向/色温/大气色洗同序），与基底同一光照输入，
    // 不对已色洗最终色重复施光。按格惰性预存去重（key = ci×8 + sign×4 + lvl，热路径只读缓存）；
    // 预存数组缺失走 relightTerrain 同口径回退；无受光入口返回 null → 该分片跳过保留基底。
    _shadeFor(ci, sign, tone) {
      const m = this._model;
      if (!m) return null;
      const cfg = m.cfg;
      const cMin = cfg.contrast, span = cfg.contrastMax - cfg.contrast;
      let lvl = span > 0 ? ((tone - cMin) / span * 4) | 0 : 0;
      if (lvl < 0) lvl = 0; else if (lvl > 3) lvl = 3;
      const key = ci * 8 + (sign > 0 ? 4 : 0) + lvl;
      let s = this._shadeCache.get(key);
      if (s !== undefined) return s;
      const t = m.terrain;
      const cell = t.cells && t.cells[ci];
      if (!cell) return null;
      const eff = cMin + (lvl + 0.5) * span * 0.25;
      const mul = sign > 0 ? 1 + eff : 1 - eff;
      let cx, cy, cz, ao, br, bg, bb;
      if (t.albR && t.albG && t.albB && t.nx && t.ny && t.nz && t.ao) {
        br = t.albR[ci] * mul; bg = t.albG[ci] * mul; bb = t.albB[ci] * mul;
        cx = t.nx[ci]; cy = t.ny[ci]; cz = t.nz[ci]; ao = t.ao[ci];
      } else {
        // 回退路径（预存数组缺失）：法线/AO/反照率口径同 relightTerrain 回退分支
        const alb = computeTerrainAlbedo(cell, t.minZ, t.maxZ);
        br = alb.r * mul; bg = alb.g * mul; bb = alb.b * mul;
        const dzdx = cell.dzdx || 0, dzdy = cell.dzdy || 0;
        const len = Math.hypot(-dzdx, -dzdy, 1) || 1;
        cx = -dzdx / len; cy = -dzdy / len; cz = 1 / len;
        const slopeDeg = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
        ao = Math.max(0.70, 1 - (slopeDeg / 65) * 0.30);
      }
      const SL = window.SimLighting;
      const fn = this._shadeFn || (SL && SL.shadeAlbedoInto);
      if (!fn) return null;
      const lp = this._lp || (SL && SL.lightParams && SL.lightParams());
      if (!lp) return null;
      fn(lp, cx, cy, cz, ao, br, bg, bb, this._out3);
      s = 'rgb(' + this._out3[0] + ', ' + this._out3[1] + ', ' + this._out3[2] + ')';
      this._shadeCache.set(key, s);
      return s;
    },

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
        kinds: [], signs: [], tones: [], cxs: [], cys: [], cellIdx: [], vOffs: [], vCounts: [], sizes: [],
        // TA-12-3 分片构建期容器（finalize 拍平后置 null）：格顶点索引 → {us, vs, meta[primIdx, uvOff, vCount]*}
        cellFrags: new Map(),
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
          cxs: m.cxs, cys: m.cys, cellIdx: m.cellIdx, vOffs: m.vOffs, vCounts: m.vCounts, sizes: m.sizes,
          centerCell: -1,
        };
        const before = m.kinds.length;
        buildBucket(mm, m.terrain, mc, bx, by);
        if (m.kinds.length > before) {
          m.buckets.set(bucketKey(bx, by), { bx, by, start: before, end: m.kinds.length });
          buildFragments(m, before); // ★ TA-12-3：新图元即时预裁剪到触及格（构建期，非逐帧）
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
      m.sizes = Float32Array.from(m.sizes);
      // ── TA-12-3：分片拍平（构建期 Map → 紧凑 typed arrays + 格范围表，§5.2）──
      // Map 迭代序 = 分片登记序 = 固定桶行主序 × 图元序 × 格序 → 拍平结果与分批/遍历顺序无关。
      const fragPrim = [], fragVOff = [], fragVCount = [], fragU = [], fragV = [];
      const fragsByCell = new Map();
      for (const [ci, rec] of m.cellFrags) {
        const meta = rec.meta, us = rec.us, vs = rec.vs;
        const off = fragPrim.length;
        for (let f = 0; f < meta.length; f += 3) {
          fragPrim.push(meta[f]);
          fragVOff.push(fragU.length);
          const n = meta[f + 2];
          fragVCount.push(n);
          const vo = meta[f + 1];
          for (let i = 0; i < n; i++) { fragU.push(us[vo + i]); fragV.push(vs[vo + i]); }
        }
        fragsByCell.set(ci, { off, cnt: meta.length / 3 });
      }
      m.fragPrim = Int32Array.from(fragPrim);
      m.fragVOff = Uint32Array.from(fragVOff);
      m.fragVCount = Uint8Array.from(fragVCount);
      m.fragU = Float32Array.from(fragU);
      m.fragV = Float32Array.from(fragV);
      m.fragsByCell = fragsByCell;
      m.cellFrags = null; // 释放构建期结构
      m.bytes = m.vx.byteLength + m.vy.byteLength + m.kinds.byteLength + m.signs.byteLength +
        m.tones.byteLength + m.cxs.byteLength + m.cys.byteLength + m.cellIdx.byteLength +
        m.vOffs.byteLength + m.vCounts.byteLength + m.sizes.byteLength +
        m.fragPrim.byteLength + m.fragVOff.byteLength + m.fragVCount.byteLength +
        m.fragU.byteLength + m.fragV.byteLength;
      m.overLimit = m.bytes > m.cacheMaxBytes;
      this._stats.builds++;
    },

    // ── 临时验收 / 调试内省（TA-12-TODO §6 第 2 项：临时脚本使用后删除；保留 stats 为正式验收口）──
    _debug: { hash32, hash01, smoothstep, materialWeight, cellAt, buildBucket, bucketKey, resolveConfig, configRevision, clipToRect, buildFragments },
  };

  window.TerrainTexture = api;
})();
