// === Accent 模型层（TA-01 + TA-03，docs/plan/tech/07-terrain-art.md §6.4/§6.7）===
// 稳定形态派生 + 个体模型缓存：由 accent.id 派生的确定性个体差异（vSeed、枝干骨架、
// 叶簇位置与脱落次序、包围体预估）只按 id 计算一次并缓存，渲染层（render_accents.js）
// 每帧只读模型。
//
// ★ TA-03 局部三维骨架（v1.50.25）：Tree = 锥形主干 + 主枝/二级枝 + 挂在枝端的椭球叶簇；
//   Bush = 基生多细茎 + 茎端/茎中段叶簇（不缩小乔木模型冒充灌木）。叶簇带稳定脱落次序
//   `shed`（0 先落 → 1 后落）与个体色差通道 `lite`——季节叶量下降时按次序收缩并隐藏叶簇，
//   春季按萌芽曲线恢复**同一批稳定位置**；暂停、读档、回溯后不重新随机抽样。
//   ★ TA-07-3 在本文件扩展：**真值包围体** bounds{rH,zMin,zMax,yUp}（由骨架几何求值，取代
//   extentOf 的 kind 级硬编码常数）+ **分级几何索引** farClusters（远景簇子集，半径降序前 K）/
//   segTier（0 主枝 / 1 二级枝）/ stoneMain；三者均为 (kind,id) 纯函数，随现有缓存键入缓存。
//
// ★ D-B1-6（06 号文 §5.5）：RockCluster = 内核只下发一个 anchor，2–5 颗子石的偏移/尺度/
//   形状全部由 accent.id 哈希派生（纯函数，读档/回溯逐位一致），**不为子石建实体、
//   不改碰撞/路面**；GrassTuft = 3–6 根短草线骨架，颜色由绘制层按当前季节派生
//   （同 Tree：SimTreeTint，不读存档 tint，见 14 号 §7.4）。
//
// ★ TA-04-2（v1.50.33）世界光向受光的法线几何：叶簇冠包络外向法线（attachCrownNormals，
//   椭球梯度归一化，id 纯函数入骨架缓存）+ 倾干剪切逆转置变换 shearNormal（依赖
//   accent.rotation，由绘制层每帧施加）；受光公式单一来源仍归 lighting.js。
//
// ★ TA-11-4 GrassTuft 芦草变体（07 号 §6.6）：稳定哈希 `accentGrassTuftReedChance` 派生
//   isReed——株高 4.2~6.0m、叶尖更收敛、顶端穗状芦花 plume 长度（几何 id 纯函数）；
//   穗量/季相颜色由绘制层按 SimTreeTint 季节样本驱动，模型层不读季节。
//
// ★ TA-06（07 号 §6.3）植被物种变体：由 accent.id 稳定哈希派生 6 个物种——三乔木轮廓
//   （broad 阔冠落叶 / sparse 疏冠落叶 / conifer 锥形常绿轮生层）+ 三灌木变体（multiStem
//   落叶多茎 / flowering 花灌木 / lowEvergreen 低矮常绿）+ 花灌木固定花位花色。物种派生
//   是 (kind, id) 的**纯函数**（哈希全新 800 段，997/998 保留给季相 jitter）：不读季节、
//   相机、光向、accent.tint/scale、地表类别与世界 seed；同一 id 在 accent 通道与 'L#'
//   景观通道得到同一物种。零持久化：不新增快照字段/FABS section/模拟参数；非 Tree/Bush
//   返回 undefined（GrassTuft/Boulder/RockCluster 零影响）。骨架输出 crownR / trunkH /
//   footprintR / crownSquash 作为冠幅·实高·深度足迹·扁压的**唯一几何真相源**（绘制层/
//   阴影层/深度队列统一读模型，§3.8）。
//
// 契约（frontend/AGENTS.md §5.11 / 07-terrain-art.md §10.2）：
// - 纯表现层：不消耗 WorldRng、不写模拟状态、不入快照、不参与内核确定性承诺。
// - 模型值是 accent.id 的**纯函数**——缓存与否、何时失效都不改变像素结果，
//   但缓存生命周期仍遵守世界事件契约：READY / LOAD_RESULT / REWIND_RESULT / RESET_DONE
//   时由 rustworld.js 调用 AccentModel.resetCache()，换世界不残留旧模型。
// - 缓存键含素材/风格版本（RENDER_CONFIG.accentModelStyleVersion，§10.2 装饰缓存键契约），
//   调风格即整体重建；设条目上限（_CACHE_MAX），超限整体清空，不做 LRU。
// - 坐标约定：局部三维坐标以根部锚点为原点，x/y 水平、z 向上，**世界单位**（未乘
//   accent.scale / camera.zoom）；倾干剪切（随 accent.rotation）由绘制层施加，不入模型。
// - 加载顺序：本文件须早于 render_accents.js（index.html 已按序注册）。

// ★ v1.49.3：Accent 个体确定性哈希（用于叶片纹理散点等纯视觉细节，不参与模拟）。
// 全局函数声明：accent-season.js（SimTreeTint 相位抖动）与渲染层共用。
function _accentHash(id, i) {
  let h = (((id | 0) * 374761393 + (i | 0) * 668265263) >>> 0);
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

window.AccentModel = window.AccentModel || (function () {
  // 缓存上限：基线世界约 85 装饰（树 40/石 20/灌木 25 × 密度），留足余量；
  // 超限视为异常世界状态，整体清空按需重建（§10.2：设上限，不无限缓存）。
  const _CACHE_MAX = 2048;
  const _cache = new Map();

  // 个体确定性种子（v1.49.2 起）：干高 / 冠形 / 色相微调的唯一来源
  function vSeedOf(id) {
    return (((id || 0) * 2654435761) >>> 0) % 997 / 997;
  }

  // —— TA-03 骨架参数读取（config.render.js；缺省回退与原值一致）——
  function clusterCount(kind) {
    const cfg = window.RENDER_CONFIG || {};
    const v = kind === 'Bush' ? cfg.accentLeafClustersBush : cfg.accentLeafClustersTree;
    if (Number.isFinite(v)) return Math.max(4, Math.round(v));
    return kind === 'Bush' ? 8 : 16;
  }

  // —— TA-11-3 RockCluster / GrassTuft 骨架参数读取（config.render.js；缺省回退与原值一致）——
  function cfgNum(v, fallback) {
    return Number.isFinite(v) ? v : fallback;
  }

  // ── ★ TA-06 物种派生（07 号 §6.3；TA-06-2）──
  // 物种登记表：silhouette/variant 键与 config.render.js 权重表、参数表键严格一致；
  // profile 映射到 accent-season.js 的四条季相曲线（floweringBush 首次真实消费）。
  var _TREE_SPECIES = {
    broad: { silhouette: 'broad', profile: 'deciduousTree' },
    sparse: { silhouette: 'sparse', profile: 'deciduousTree' },
    conifer: { silhouette: 'conifer', profile: 'evergreen' },
  };
  var _BUSH_SPECIES = {
    multiStem: { silhouette: 'multiStem', profile: 'deciduousBush' },
    flowering: { silhouette: 'flowering', profile: 'floweringBush' },
    lowEvergreen: { silhouette: 'lowEvergreen', profile: 'evergreen' },
  };
  // 权重表缺省回退（与 config.render.js 建议值一致；非法/缺省配置不致命）
  var _TREE_WEIGHTS_FALLBACK = { broad: 0.42, sparse: 0.34, conifer: 0.24 };
  var _BUSH_WEIGHTS_FALLBACK = { multiStem: 0.56, flowering: 0.24, lowEvergreen: 0.20 };

  // 单一 u 值按**累积权重表**查表分配（权重先归一化）——不用 u<chance 多次独立抽样，
  // 避免变体间比例相互干扰（§3.1）。非法/缺省回退 fallbackKey。
  function _weightedPick(u, table, fallbackKey) {
    let total = 0;
    for (const k in table) {
      const w = table[k];
      if (Number.isFinite(w) && w > 0) total += w;
    }
    if (!(total > 0)) return fallbackKey;
    let acc = 0, last = fallbackKey;
    for (const k in table) {
      const w = table[k];
      if (!(Number.isFinite(w) && w > 0)) continue;
      acc += w / total;
      if (u < acc) return k;
      last = k;
    }
    return last;
  }

  // 物种派生唯一入口：(kind, id) 的纯函数 → { silhouette, profile }；非 Tree/Bush 返回
  // undefined（非植被种类零影响，§4.7）。哈希走全新 800 段：800 乔木 / 802 灌木 /
  // 810+i×3 花位花色 / 841+ 锥形轮生层（997/998 保留给季相 jitter，400 随旧过渡接口删除释放、不复用）。
  // ★ 扩展预留：未来「按地表类别/坡度/景观配方偏置物种」须在本函数内新增显式参数并 bump
  //   accentModelStyleVersion，**禁止**在绘制层临时按环境改写物种（会破坏读档/回溯一致性）。
  function speciesOf(kind, id) {
    const w = (window.RENDER_CONFIG || {}).accentSpeciesWeights || {};
    if (kind === 'Tree') {
      const key = _weightedPick(_accentHash(id, 800), w.tree || _TREE_WEIGHTS_FALLBACK, 'broad');
      return _TREE_SPECIES[key] || _TREE_SPECIES.broad;
    }
    if (kind === 'Bush') {
      const key = _weightedPick(_accentHash(id, 802), w.bush || _BUSH_WEIGHTS_FALLBACK, 'multiStem');
      return _BUSH_SPECIES[key] || _BUSH_SPECIES.multiStem;
    }
    return undefined;
  }

  // 远景簇子集上限（config.render.js::accentLODFarMaxClusters；**几何输入**，调值须同步
  // bump accentModelStyleVersion，否则旧缓存不重建）
  function farMaxClusters() {
    const v = window.RENDER_CONFIG && window.RENDER_CONFIG.accentLODFarMaxClusters;
    return (typeof v === 'number' && isFinite(v) && v >= 1) ? Math.round(v) : 8;
  }

  function styleVersion() {
    const v = window.RENDER_CONFIG && window.RENDER_CONFIG.accentModelStyleVersion;
    return Number.isFinite(v) ? v : 1;
  }

  // ── TA-04-2 冠包络外向法线（世界光向受光的法线几何缓存，归模型层；07 号 §6.5/§6.7）──
  // 叶簇受光法线 = 「冠包络椭球」在簇位置的外向梯度 (x/rx², y/ry², (z−zc)/rz²) 归一化
  // （rx/ry/rz/zc 取整副骨架簇分布的包络半轴与质心；梯度垂直于过该簇的等值面切平面，
  // 满足「变换后法线 ⊥ 切向量且长度为 1」）。id 纯函数，入骨架缓存。
  // 倾干剪切（x += s·z）的法线补偿依赖 accent.rotation，由绘制层每帧经 shearNormal 施加。
  function attachCrownNormals(clusters) {
    const n = clusters.length;
    if (!n) return;
    let zc = 0;
    for (let i = 0; i < n; i++) zc += clusters[i].z;
    zc /= n;
    let rx = 1e-3, ry = 1e-3, rz = 1e-3;
    for (let i = 0; i < n; i++) {
      const c = clusters[i];
      const ax = Math.abs(c.x), ay = Math.abs(c.y), az = Math.abs(c.z - zc);
      if (ax > rx) rx = ax;
      if (ay > ry) ry = ay;
      if (az > rz) rz = az;
    }
    for (let i = 0; i < n; i++) {
      const c = clusters[i];
      const gx = c.x / (rx * rx), gy = c.y / (ry * ry), gz = (c.z - zc) / (rz * rz);
      const len = Math.hypot(gx, gy, gz) || 1;
      c.nx = gx / len; c.ny = gy / len; c.nz = gz / len;
    }
  }

  // ── ★ TA-07-3 真值包围体（07 号 §6.7 / TA-07-TODO §3.4）：由**骨架几何**求值，取代
  //    extentOf 的 kind 级硬编码常数（旧 Tree 8.5×1.3 / Bush 8 / Boulder 7 / RockCluster 10 /
  //    GrassTuft 7 全部作废）。局部包围体（**世界单位**，未乘 accent.scale / camera.zoom）：
  //   rH   水平最大 reach：簇/枝/石/草叶顶点的 max hypot(x,y) + 该点自身半径
  //   zMax 竖直上界（含簇球半径 / 石体高 / 芦花穗长）；zMin 竖直下界（簇球下沉时取负）
  //   yUp  屏幕竖直**额外**上界（世界单位 × cosX × scaled）：石体底环按 v1.50.13「底边贴
  //        落地点」契约整体落在锚点上方（非以锚点为心的对称圆盘），不显式登记会让远景
  //        石体顶部被剔除（漏画 = 可见缺陷）。
  //   rS   「球体半径」上界（世界单位 × scaled，**不乘 cosX**）：叶簇/子石是屏幕空间球，
  //        竖直方向按全半径外扩（水平已由 rH 计入），漏掉它会让低俯角（cosX→0）下冠顶
  //        被误剔；芦花穗沿任意屏幕方向延伸，同样计入本项。
  // 倾干剪切（wx = dx + s·dz，s = leanShear）的水平补偿 |s|·zMax 由 accent-lod.js 在求屏幕
  // AABB 时施加——s 依赖 accent.rotation，**不入模型缓存**。
  // 恒为保守上界（宁多画不漏画）：簇球按完整半径计入水平与竖直两侧，草叶穗长按任意方向计。
  function boundsOf(kind, sk) {
    var b = { rH: 8, zMin: 0, zMax: 8, yUp: 0, rS: 0 };
    if (!sk) {
      // Boulder：无骨架（绘制层直接给 6×scaled 石半径 + 固定七边形变径）
      var rb = boulderRadius() * 1.20;             // 变径上限 1.20（_BOULDER_SHAPE 最大值）
      b.rH = rb; b.zMax = boulderRadius() * stoneHeightK(); b.zMin = 0; b.yUp = rb; b.rS = 0;
      return b;
    }
    var rH = 0, zMax = 0, zMin = 0, rS = 0;
    var i, c, h;
    if (sk.clusters) {
      for (i = 0; i < sk.clusters.length; i++) {
        c = sk.clusters[i];
        h = Math.sqrt(c.x * c.x + c.y * c.y) + c.r;
        if (h > rH) rH = h;
        if (c.r > rS) rS = c.r;
        if (c.z + c.r > zMax) zMax = c.z + c.r;
        if (c.z - c.r < zMin) zMin = c.z - c.r;
      }
    }
    if (sk.segments) {
      for (i = 0; i < sk.segments.length; i++) {
        var s1 = sk.segments[i];
        var ha = Math.sqrt(s1.x1 * s1.x1 + s1.y1 * s1.y1);
        var hb = Math.sqrt(s1.x2 * s1.x2 + s1.y2 * s1.y2);
        if (ha > rH) rH = ha;
        if (hb > rH) rH = hb;
        if (s1.z1 > zMax) zMax = s1.z1;
        if (s1.z2 > zMax) zMax = s1.z2;
        if (s1.z1 < zMin) zMin = s1.z1;
        if (s1.z2 < zMin) zMin = s1.z2;
      }
    }
    if (sk.stones) { // RockCluster：子石散布 + 逐石外接（含 1.22 变径上限）
      for (i = 0; i < sk.stones.length; i++) {
        var st = sk.stones[i];
        h = Math.sqrt(st.x * st.x + st.y * st.y) + st.r * 1.22;
        if (h > rH) rH = h;
        if (st.r * 1.22 * stoneHeightK() > zMax) zMax = st.r * 1.22 * stoneHeightK();
        if (st.r * 1.22 > rS) rS = st.r * 1.22;      // 子石顶面/侧面为屏幕空间球体
      }
      if (sk.spread * 1.05 > rH) rH = sk.spread * 1.05; // 簇群整片接触阴影椭圆（rx = spread×1.05）
      b.yUp = rH;                                       // 子石底环同样贴落地点
    }
    if (sk.blades) { // GrassTuft：叶身 + 穗状芦花（穗沿任意屏幕方向延伸，水平竖直各计一次）
      var maxPlume = 0;
      for (i = 0; i < sk.blades.length; i++) {
        var bl = sk.blades[i];
        h = Math.sqrt(bl.tx * bl.tx + bl.ty * bl.ty);
        if (Math.sqrt(bl.bx * bl.bx + bl.by * bl.by) > h) h = Math.sqrt(bl.bx * bl.bx + bl.by * bl.by);
        if (bl.plume > maxPlume) maxPlume = bl.plume;
        if (h + bl.plume > rH) rH = h + bl.plume;
        if (bl.h + bl.plume > zMax) zMax = bl.h + bl.plume;
      }
      if (2.6 > rH) rH = 2.6; // 贴地接触投影椭圆（rx = 2.6×scaled，render_grass.js:99）
      if (maxPlume > rS) rS = maxPlume;             // 穗沿任意屏幕方向延伸（不计 cosX）
    }
    if (sk.trunkH) {
      var trunkHalfW = (sk.crownR || 8.5) * 0.17; // 主干锥形底半宽（render_accents.js bw 口径）
      if (trunkHalfW > rH) rH = trunkHalfW;
      if (sk.trunkH > zMax) zMax = sk.trunkH;
    }
    b.rH = rH; b.zMin = zMin; b.zMax = zMax; b.rS = rS;
    return b;
  }
  function stoneHeightK() {
    var v = window.RENDER_CONFIG && window.RENDER_CONFIG.accentStoneHeightK;
    return typeof v === 'number' && isFinite(v) ? v : 0.3;
  }
  function boulderRadius() { return 6; } // drawAccentBoulder 入参石半径（世界单位）

  // ── ★ TA-07-3 分级几何索引（§3.6；全部为 (kind, id) 纯函数，随现有缓存键入缓存）──
  // farClusters：远景簇子集——按簇半径降序取前 K（同径按数组序稳定 tie-break），再按原
  //   索引升序回排（保持既有画家次序），Uint8Array 存储免每帧排序/筛选。
  // segTier：逐段 tier（0 主枝 / 1 二级枝；Bush 与 conifer 恒 0）——中景只遍历 tier 0，
  //   免每帧按 wK 判别（旧实现把主枝 0.42 与二级枝 0.24 混在同一数组，中景实际全画）。
  function farClusterIndices(clusters, maxN) {
    var n = clusters.length;
    if (!n) return new Uint8Array(0);
    var k = Math.min(n, Math.max(1, maxN | 0));
    var ord = [];
    for (var i = 0; i < n; i++) ord.push(i);
    // 稳定插入排序（按 r 降序；等径保持原序）
    for (var a = 1; a < n; a++) {
      var key = ord[a], kr = clusters[key].r;
      var j = a - 1;
      while (j >= 0 && clusters[ord[j]].r < kr) { ord[j + 1] = ord[j]; j--; }
      ord[j + 1] = key;
    }
    var out = new Uint8Array(k);
    for (var m = 0; m < k; m++) out[m] = ord[m];
    // 回排为原索引升序（保持既有画家次序；n ≤ 24，插入排序零闭包分配）
    for (var b2 = 1; b2 < k; b2++) {
      var kk = out[b2];
      var jj = b2 - 1;
      while (jj >= 0 && out[jj] > kk) { out[jj + 1] = out[jj]; jj--; }
      out[jj + 1] = kk;
    }
    return out;
  }
  function segTierOf(segments, mainSegIdx) {
    var n = segments ? segments.length : 0;
    var t = new Uint8Array(n); // 缺省 0 = 主枝
    if (!mainSegIdx) return t;  // conifer 轮生枝 / Bush 细茎：全部视为主枝
    for (var i = 0; i < n; i++) t[i] = 1;
    for (var m = 0; m < mainSegIdx.length; m++) {
      var idx = mainSegIdx[m];
      if (idx >= 0 && idx < n) t[idx] = 0;
    }
    return t;
  }

  // 倾干剪切（局部点变换 x += s·z）下的法线变换 = 变换矩阵的逆转置：n' = (nx, ny, nz − s·nx)。
  // 依赖 accent.rotation（不入模型缓存），绘制层每帧调用；shadeRgbInto 内部会再归一化，
  // 此处归一化只为独立调用方给出单位法线。
  function shearNormal(nx, ny, nz, s) {
    const wz = nz - s * nx;
    const len = Math.hypot(nx, ny, wz) || 1;
    return { x: nx / len, y: ny / len, z: wz / len };
  }

  // ★ TA-11-6 零 GC 变体：同 shearNormal 公式，结果写入调用方复用的 out 对象（热路径消费）。
  function shearNormalInto(nx, ny, nz, s, out) {
    const wz = nz - s * nx;
    const len = Math.hypot(nx, ny, wz) || 1;
    out.x = nx / len;
    out.y = ny / len;
    out.z = wz / len;
    return out;
  }

  // ── Tree：★ TA-06 三轮廓骨架（§3.2）：broad 阔冠落叶 / sparse 疏冠落叶 / conifer 锥形常绿 ──
  // 结构沿 TA-03：锥形主干 + 主枝/二级枝 + 挂在真实枝条上的椭球叶簇（v1.50.26 悬空簇纪律）；
  // 参数由 config.render.js::accentTreeSilhouettes 按轮廓提供（物种由 speciesOf 派生）。
  // segments：枝干线段（局部三维端点 + 相对干宽系数 wK）；clusters：叶簇
  // （局部三维附着点 + 世界单位半径 r + 稳定脱落次序 shed + 色差通道 lite）。
  // 模型输出 crownR / trunkH / footprintR / crownSquash / leanShearK 为该轮廓真值（§3.8）。
  function _treeSilParams(silhouette) {
    const t = (window.RENDER_CONFIG || {}).accentTreeSilhouettes || {};
    const p = t[silhouette] || t.broad || {};
    return {
      trunkHBase: cfgNum(p.trunkHBase, 5.6),
      trunkHVar: cfgNum(p.trunkHVar, 1.6),
      crownR: cfgNum(p.crownR, 10.5),
      branchMin: Math.max(1, Math.round(cfgNum(p.branchMin, 6))),
      branchMax: Math.max(1, Math.round(cfgNum(p.branchMax, 7))),
      subBranchPer: Math.max(0, Math.round(cfgNum(p.subBranchPer, 1))),
      subLenK: cfgNum(p.subLenK, 0.5),
      subDroop: cfgNum(p.subDroop, 0.35),
      clusterFactor: cfgNum(p.clusterFactor, 1.15),
      clusterRBase: cfgNum(p.clusterRBase, 2.3),
      clusterRVar: cfgNum(p.clusterRVar, 1.3),
      elevMin: cfgNum(p.elevMin, 0.30),
      elevMax: cfgNum(p.elevMax, 0.75),
      crownSquash: cfgNum(p.crownSquash, 0.78),
      footprintR: cfgNum(p.footprintR, 13),
      leanShearK: cfgNum(p.leanShearK, 1.0),
      whorlLayersMin: Math.max(2, Math.round(cfgNum(p.whorlLayersMin, 4))),
      whorlLayersMax: Math.max(2, Math.round(cfgNum(p.whorlLayersMax, 6))),
      whorlBranchesMin: Math.max(2, Math.round(cfgNum(p.whorlBranchesMin, 3))),
      whorlBranchesMax: Math.max(2, Math.round(cfgNum(p.whorlBranchesMax, 5))),
    };
  }

  function _treeSilResult(sp, trunkH, segments, mainSegOnly, clusters) {
    const branchTips = [];
    for (let i = 0; i < segments.length; i++) {
      if (!mainSegOnly || mainSegOnly.indexOf(i) >= 0) {
        branchTips.push({ x: segments[i].x2, y: segments[i].y2, z: segments[i].z2 });
      }
    }
    attachCrownNormals(clusters);
    return {
      silhouette: sp._name,
      trunkH: trunkH, crownR: sp.crownR,
      crownSquash: sp.crownSquash, footprintR: sp.footprintR, leanShearK: sp.leanShearK,
      segments: segments, branchTips: branchTips, clusters: clusters,
      // ★ TA-07-3 分级几何：逐段 tier（0 主枝 / 1 二级枝）——中景只遍历 tier 0（§3.2）
      segTier: segTierOf(segments, mainSegOnly),
    };
  }

  // broad / sparse：主干锥形 + 主枝 + 二级枝 + 挂枝叶簇（TA-03 同构，参数按轮廓）。
  // sparse 二级枝更长更上扬（subLenK 0.62 / subDroop 0.18），冠内自然出空隙。
  function _broadSparseSkeleton(id, vSeed, sp) {
    const N = Math.max(6, Math.round(clusterCount('Tree') * sp.clusterFactor));
    const trunkH = sp.trunkHBase + vSeed * sp.trunkHVar;
    const crownR = sp.crownR;
    const P = sp.branchMin + Math.floor(_accentHash(id, 210) * (sp.branchMax - sp.branchMin + 1));
    const segments = [];
    const mainSegIdx = [];                 // 主枝线段索引（补位簇锚定 + 春芽定位）
    const tips = [];                       // 叶簇附着点（主枝端 → 二级枝端 → 冠顶 → 枝上补位）
    for (let i = 0; i < P; i++) {
      const h1 = _accentHash(id, 220 + i);
      const h2 = _accentHash(id, 240 + i);
      const h3 = _accentHash(id, 260 + i);
      const h4 = _accentHash(id, 284 + i);
      const ang = (i / P) * Math.PI * 2 + (h1 - 0.5) * 1.1; // 方位角（均匀布点 + 抖动）
      const hFrac = 0.55 + h2 * 0.32;                        // 着生高度（干上部）
      const elev = sp.elevMin + h3 * (sp.elevMax - sp.elevMin); // 仰角带按轮廓
      const blen = crownR * (0.46 + h4 * 0.20);              // 枝长
      const oz = trunkH * hFrac;
      const ce = Math.cos(elev);
      const tx = Math.cos(ang) * ce * blen;
      const ty = Math.sin(ang) * ce * blen;
      const tz = oz + Math.sin(elev) * blen;
      mainSegIdx.push(segments.length);
      segments.push({ x1: 0, y1: 0, z1: oz, x2: tx, y2: ty, z2: tz, wK: 0.42 });
      tips.push({ x: tx, y: ty, z: tz });
      // 二级枝：subBranchPer 条（broad 1 / sparse 2），槽位 k 保持通道块连续不交叉
      for (let s = 0; s < sp.subBranchPer; s++) {
        const k = i * sp.subBranchPer + s;
        const t = 0.55 + _accentHash(id, 300 + k) * 0.30;
        const sang = ang + (k & 1 ? 1 : -1) * (0.55 + _accentHash(id, 320 + k) * 0.5);
        const selev = Math.max(0.15, elev - sp.subDroop - _accentHash(id, 340 + k) * 0.2);
        const slen = blen * sp.subLenK;
        const bx = tx * t, by = ty * t, bz = oz + (tz - oz) * t;
        segments.push({
          x1: bx, y1: by, z1: bz,
          x2: bx + Math.cos(sang) * Math.cos(selev) * slen,
          y2: by + Math.sin(sang) * Math.cos(selev) * slen,
          z2: bz + Math.sin(selev) * slen,
          wK: 0.24,
        });
        tips.push({
          x: segments[segments.length - 1].x2,
          y: segments[segments.length - 1].y2,
          z: segments[segments.length - 1].z2,
        });
      }
    }
    // ★ v1.50.26 悬空叶簇修复（TA-06 沿用）：补位簇一律挂在真实枝条上——
    // 冠顶簇贴最高枝端内侧偏上；补位簇锚定主枝线段 55%~95% 参数位。禁抽象球面包络定位。
    let topTip = tips[0];
    for (let i = 1; i < tips.length; i++) {
      if (tips[i].z > topTip.z) topTip = tips[i];
    }
    tips.push({ x: topTip.x * 0.8, y: topTip.y * 0.8, z: topTip.z + 0.8 });
    while (tips.length < N) {
      const hA = _accentHash(id, 360 + tips.length);
      const hB = _accentHash(id, 380 + tips.length);
      const seg = segments[mainSegIdx[Math.floor(hA * P) % P]]; // 锚定主枝线段
      const t = 0.55 + hB * 0.40;
      tips.push({
        x: seg.x2 * t + (hA - 0.5) * 0.9,
        y: seg.y2 * t + (hB - 0.5) * 0.9,
        z: seg.z1 + (seg.z2 - seg.z1) * t + (hA - 0.5) * 0.7,
      });
    }
    if (tips.length > N) tips.length = N; // 配置缩簇时先裁包络补位（数组序即优先级）
    const clusters = [];
    for (let i = 0; i < tips.length; i++) {
      const t = tips[i];
      const h1 = _accentHash(id, 420 + i);
      const h2 = _accentHash(id, 440 + i);
      clusters.push({
        x: t.x + (h1 - 0.5) * 1.6,
        y: t.y + (h2 - 0.5) * 1.6,
        z: Math.max(1.2, t.z + (h1 - 0.5) * 1.2 + 0.4),
        r: sp.clusterRBase + _accentHash(id, 460 + i) * sp.clusterRVar,
        shed: _accentHash(id, 480 + i), // 稳定脱落次序：值小先落（§6.4）
        lite: _accentHash(id, 500 + i), // 个体色差通道（秋色簇间黄红先后，§6.3）
      });
    }
    return _treeSilResult(sp, trunkH, segments, mainSegIdx, clusters);
  }

  // conifer 锥形常绿（§3.2）：轮生 4~6 层 × 每层 3~5 短枝，层半径自下而上线性收缩至顶梢；
  // 全部叶簇锚定轮生短枝端（禁抽象球面包络）。evergreen profile 叶量 ≥0.94 + fade 0.09 下
  // accentClusterVisibility 恒 ≥0.27 ≥0.06 显示阈（无掉簇特例分支——禁在可见度函数加 kind 判断，
  // 若实测掉簇优先调曲线）。倾干幅度按轮廓收敛（leanShearK 0.45，针叶树读感挺直）。
  // 哈希通道（全新 800 段）：841 层数 / 842+l 层高 / 851+l 每层枝数 / 860+l×5+b 枝方位 / 890+l×5+b 枝长。
  function _coniferSkeleton(id, vSeed, sp) {
    const N = Math.max(8, Math.round(clusterCount('Tree') * sp.clusterFactor)); // ≈21（簇小而扁）
    const trunkH = sp.trunkHBase + vSeed * sp.trunkHVar;
    const L = sp.whorlLayersMin + Math.floor(_accentHash(id, 841) * (sp.whorlLayersMax - sp.whorlLayersMin + 1));
    const perLayerCap = Math.max(2, Math.floor((N - 1) / L)); // 顶梢簇占 1 名额；簇数不超 N
    const segments = [];
    const tips = [];
    for (let l = 0; l < L; l++) {
      const hZ = _accentHash(id, 842 + l);
      const B = Math.min(perLayerCap,
        sp.whorlBranchesMin + Math.floor(_accentHash(id, 851 + l) * (sp.whorlBranchesMax - sp.whorlBranchesMin + 1)));
      const oz = trunkH * Math.min(0.92, 0.30 + (l / Math.max(1, L - 1)) * 0.60 + (hZ - 0.5) * 0.06);
      const layerR = sp.crownR * (1 - 0.70 * (l / Math.max(1, L - 1))); // 底层最宽 → 顶梢 30%
      for (let b = 0; b < B; b++) {
        const hA = _accentHash(id, 860 + l * 5 + b);
        const hB = _accentHash(id, 890 + l * 5 + b);
        const ang = (b / B) * Math.PI * 2 + (hA - 0.5) * 0.5;
        const elev = sp.elevMin + hB * (sp.elevMax - sp.elevMin); // 近水平略上扬（轮生枝读感）
        const blen = layerR * (0.88 + hA * 0.18);
        const tx = Math.cos(ang) * Math.cos(elev) * blen;
        const ty = Math.sin(ang) * Math.cos(elev) * blen;
        const tz = oz + Math.sin(elev) * blen;
        segments.push({ x1: 0, y1: 0, z1: oz, x2: tx, y2: ty, z2: tz, wK: 0.34 });
        tips.push({ x: tx, y: ty, z: tz });
      }
    }
    // 顶梢簇（干顶，塔形收尖）；簇序自下而上，簇数恒 ≤ N
    tips.push({ x: 0, y: 0, z: trunkH + 0.4 });
    const clusters = [];
    for (let i = 0; i < tips.length; i++) {
      const t = tips[i];
      const h1 = _accentHash(id, 420 + i);
      const h2 = _accentHash(id, 440 + i);
      clusters.push({
        x: t.x + (h1 - 0.5) * 0.8,
        y: t.y + (h2 - 0.5) * 0.8,
        z: Math.max(1.2, t.z + (h1 - 0.5) * 0.6 + 0.2),
        r: sp.clusterRBase + _accentHash(id, 460 + i) * sp.clusterRVar,
        shed: _accentHash(id, 480 + i),
        lite: _accentHash(id, 500 + i),
      });
    }
    return _treeSilResult(sp, trunkH, segments, null, clusters);
  }

  function treeSkeleton(id, vSeed, silhouette) {
    const sp = _treeSilParams(silhouette);
    sp._name = silhouette || 'broad';
    if (sp._name === 'conifer') return _coniferSkeleton(id, vSeed, sp);
    return _broadSparseSkeleton(id, vSeed, sp);
  }

  // ── Bush：★ TA-06 三变体（§3.3）：multiStem 落叶多茎 / flowering 花灌木 / lowEvergreen 低矮常绿 ──
  // 基生多细茎（§6.4：灌木由根部发出多根细茎，不缩小乔木冒充；07 号 §6.4 红线）+ 叶簇。
  // 三变体共用同一结构，只改茎数/茎高/外倾/簇参数/扁压（crownSquash 驱动绘制层簇压缩）。
  // crownR 由模型统一输出（multiStem = 5.5 + 1.2×vSeed，与旧绘制口径一致——修正历史漂移，§3.8）；
  // trunkH = heightBase + heightVar×0.5（multiStem 复现旧值 4.2，驱动贴地影长）。
  function _bushVariantParams(variant) {
    const t = (window.RENDER_CONFIG || {}).accentBushVariants || {};
    const p = t[variant] || t.multiStem || {};
    return {
      stemMin: Math.max(2, Math.round(cfgNum(p.stemMin, 4))),
      stemMax: Math.max(2, Math.round(cfgNum(p.stemMax, 6))),
      heightBase: cfgNum(p.heightBase, 3.4),
      heightVar: cfgNum(p.heightVar, 1.6),
      outKMin: cfgNum(p.outKMin, 0.38),
      outKMax: cfgNum(p.outKMax, 0.68),
      clusterFactor: cfgNum(p.clusterFactor, 1.0),
      clusterRBase: cfgNum(p.clusterRBase, 1.5),
      clusterRVar: cfgNum(p.clusterRVar, 0.9),
      crownRBase: cfgNum(p.crownRBase, 5.5),
      crownRVar: cfgNum(p.crownRVar, 1.2),
      crownSquash: cfgNum(p.crownSquash, 0.72),
      footprintR: cfgNum(p.footprintR, 8),
    };
  }

  // ★ TA-06-7 花位（§3.4）：构建期固定点——在**可见簇外围**预生成（宿主簇序 + 方位角 +
  // 外围距离 + 花色板槽位全部由 _accentHash(id, 810+i×3…) 派生）。花色低饱和三色板逐点选定。
  // 花量（flowerAmount）只在绘制层决定可见点数与 alpha，**绝不参与花位重抽**
  // （对齐 S4-04「库存不参与几何」的同一纪律）；花朵属几何 → 入骨架缓存，花量属季相 → 不入。
  function _bushFlowers(id, clusters) {
    const cfg = window.RENDER_CONFIG || {};
    const maxDots = Math.max(1, Math.round(cfgNum(cfg.accentFlowerDotsMax, 9)));
    const nCl = clusters.length;
    if (!nCl) return null;
    const flowers = [];
    for (let i = 0; i < maxDots; i++) {
      const c = clusters[i % nCl];
      const hA = _accentHash(id, 810 + i * 3);      // 方位角
      const hB = _accentHash(id, 811 + i * 3);      // 外围距离（0.85~1.30 × 宿主簇半径）
      const hC = _accentHash(id, 812 + i * 3);      // 花色板槽位（0/1/2）
      const a = hA * Math.PI * 2;
      const d = c.r * (0.85 + hB * 0.45);
      flowers.push({
        x: c.x + Math.cos(a) * d,
        y: c.y + Math.sin(a) * d,
        z: Math.max(0.5, c.z + (hB - 0.5) * c.r * 0.6),
        ci: i % nCl,                                 // 宿主簇（随宿主簇显隐/法线受光）
        hue: Math.floor(hC * 3) % 3,
      });
    }
    return flowers;
  }

  function bushSkeleton(id, vSeed, variant) {
    const vp = _bushVariantParams(variant);
    const N = Math.max(4, Math.round(clusterCount('Bush') * vp.clusterFactor));
    const S = vp.stemMin + Math.floor(_accentHash(id, 310) * (vp.stemMax - vp.stemMin + 1));
    const segments = [];
    const tips = [];
    for (let i = 0; i < S; i++) {
      const h1 = _accentHash(id, 212 + i);
      const h2 = _accentHash(id, 214 + i);
      const h3 = _accentHash(id, 216 + i);
      const ang = (i / S) * Math.PI * 2 + (h1 - 0.5) * 1.3; // 方位角
      const hgt = vp.heightBase + h2 * vp.heightVar;        // 茎高（世界单位，变体区间）
      const outK = vp.outKMin + h3 * (vp.outKMax - vp.outKMin); // 顶端水平外倾比例
      const tx = Math.cos(ang) * hgt * outK;
      const ty = Math.sin(ang) * hgt * outK;
      segments.push({ x1: 0, y1: 0, z1: 0, x2: tx, y2: ty, z2: hgt, wK: 1 });
      tips.push({ x: tx, y: ty, z: hgt });
    }
    // 茎中段补位簇（45%~75% 高度，锚定真实茎段）
    let k = 0;
    while (tips.length < N) {
      const st = segments[k % S];
      const t = 0.45 + _accentHash(id, 390 + k) * 0.30;
      tips.push({ x: st.x2 * t, y: st.y2 * t, z: st.z2 * t });
      k++;
    }
    if (tips.length > N) tips.length = N;
    const clusters = [];
    for (let i = 0; i < tips.length; i++) {
      const t = tips[i];
      const h1 = _accentHash(id, 420 + i);
      const h2 = _accentHash(id, 440 + i);
      clusters.push({
        x: t.x + (h1 - 0.5) * 1.0,
        y: t.y + (h2 - 0.5) * 1.0,
        z: Math.max(0.8, t.z + (h1 - 0.5) * 0.8 + 0.3),
        r: vp.clusterRBase + _accentHash(id, 460 + i) * vp.clusterRVar,
        shed: _accentHash(id, 480 + i),
        lite: _accentHash(id, 500 + i),
      });
    }
    attachCrownNormals(clusters);
    return {
      silhouette: variant || 'multiStem',
      trunkH: vp.heightBase + vp.heightVar * 0.5, // multiStem 复现旧 4.2（贴地影长驱动）
      crownR: vp.crownRBase + vSeed * vp.crownRVar, // 唯一几何真相源（修正与绘制口径的历史漂移）
      crownSquash: vp.crownSquash, footprintR: vp.footprintR, leanShearK: 1.0,
      segments: segments, branchTips: [], clusters: clusters,
      // ★ TA-07-3：灌木细茎全部视为主枝（恒 0），中景与近景画法一致
      segTier: segTierOf(segments, null),
      // 花灌木专属：构建期固定花位（其余变体恒 null，绘制层零花点）
      flowers: (variant === 'flowering') ? _bushFlowers(id, clusters) : null,
    };
  }

  // ── RockCluster（D-B1-6，06 号 §5.5）：anchor 前端派生 2–5 颗子石 ──
  // 数量/散布/半径参数走 config.render.js（TA-11-3），缺省回退与原硬编码逐位一致。
  // stones：{ x, y } 世界单位水平偏移（未乘 accent.scale/zoom，rotation 由绘制层施加）、
  // { r } 子石半径、{ shape[sides] } 逐顶点半径变化系数（0.78~1.22，尖角与平钝面对比）、
  // { sides } 多边形边数（★ TA-11-5：主石 6~7 / 辅石 5~6，_accentHash 派生，非对称棱角）、
  // { rot } 自转角、{ lite } 岩面明暗色差通道。首颗为主石（居中、最大），其余碎石散布。
  function rockClusterSkeleton(id, vSeed) {
    const cfg = window.RENDER_CONFIG || {};
    const minStones = cfgNum(cfg.accentRockClusterMinStones, 2);
    const maxStones = cfgNum(cfg.accentRockClusterMaxStones, 5);
    const n = minStones + Math.floor(_accentHash(id, 600) * Math.max(1, maxStones - minStones + 1)); // 2~5 颗（§5.5）
    const spread = cfgNum(cfg.accentRockClusterSpreadBase, 3.2) + vSeed * cfgNum(cfg.accentRockClusterSpreadVar, 1.2); // 簇散布半径（世界单位）
    const mainRBase = cfgNum(cfg.accentRockClusterMainRadiusBase, 2.4);
    const mainRVar = cfgNum(cfg.accentRockClusterMainRadiusVar, 1.0);
    const debrisRBase = cfgNum(cfg.accentRockClusterDebrisRadiusBase, 1.1);
    const debrisRVar = cfgNum(cfg.accentRockClusterDebrisRadiusVar, 1.3);
    const stones = [];
    for (let i = 0; i < n; i++) {
      const h1 = _accentHash(id, 610 + i * 5);
      const h2 = _accentHash(id, 611 + i * 5);
      const h3 = _accentHash(id, 612 + i * 5);
      const h4 = _accentHash(id, 613 + i * 5);
      const ang = h1 * Math.PI * 2;
      const dist = i === 0 ? (h2 - 0.5) * 1.2 : spread * (0.35 + h2 * 0.60); // 主石近中
      // ★ TA-11-5 棱角扰动：主石 6~7 边 / 辅石 5~6 边（哈希通道 660+i×8，避开 630 形状块），
      //   逐顶点变径 0.78~1.22 产生自然尖角与平钝面（不重复 Boulder 固定纹理）
      const sides = (i === 0 ? 6 : 5) + Math.floor(_accentHash(id, 660 + i * 8) * 2);
      const shape = [];
      for (let k = 0; k < sides; k++) {
        shape.push(0.78 + _accentHash(id, 630 + i * 8 + k) * 0.44); // 逐顶点变径
      }
      stones.push({
        x: Math.cos(ang) * dist,
        y: Math.sin(ang) * dist,
        r: i === 0 ? mainRBase + h3 * mainRVar : debrisRBase + h3 * debrisRVar, // 主石最大，其余碎石
        rot: h4 * Math.PI * 2,
        lite: _accentHash(id, 614 + i * 5),
        shape: shape,
        sides: sides,
      });
    }
    return { spread: spread, stones: stones };
  }

  // ── GrassTuft（D-B1-6，06 号 §5.5）：3–6 根短草线；★ TA-11-4 水岸芦草变体 ──
  // 每根草叶：根部偏移 (bx,by) + 叶尖水平外倾 (tx,ty) + 叶高 h（世界单位，低于灌木）。
  // 叶数/株高/根部聚拢参数走 config.render.js（TA-11-3），缺省回退与原硬编码逐位一致。
  // ★ TA-11-4（07 号 §6.6「水岸可派生芦草外观」）：稳定哈希 `_accentHash(id,720) <
  // accentGrassTuftReedChance` 派生芦草变体——茎秆挺拔更高（4.2~6.0m）、叶尖外倾更收敛
  // （株形直立即芦苇荡读感）、每叶顶端带穗状芦花 plume 长度（世界单位；穗量/颜色由绘制层
  // 按季节驱动，几何不随季节变化）。变体标志与全部几何是 id 纯函数，暂停/读档/回溯逐位重建。
  // 颜色由绘制层按当前季节派生（同 Tree：SimTreeTint，不读存档 tint）；lite 为个体色差通道。
  function grassTuftSkeleton(id, vSeed) {
    const cfg = window.RENDER_CONFIG || {};
    const minBlades = cfgNum(cfg.accentGrassTuftMinBlades, 3);
    const maxBlades = cfgNum(cfg.accentGrassTuftMaxBlades, 6);
    const n = minBlades + Math.floor(_accentHash(id, 700) * Math.max(1, maxBlades - minBlades + 1)); // 3~6 根（§5.5）
    const hBase = cfgNum(cfg.accentGrassTuftHeightBase, 2.4);
    const hVar = cfgNum(cfg.accentGrassTuftHeightVar, 1.6);
    const baseSpread = cfgNum(cfg.accentGrassTuftBaseSpread, 0.8);
    const baseSpreadVar = cfgNum(cfg.accentGrassTuftBaseSpreadVar, 0.9);
    const isReed = _accentHash(id, 720) < cfgNum(cfg.accentGrassTuftReedChance, 0.35); // 芦草变体（TA-11-4）
    const reedHBase = cfgNum(cfg.accentGrassTuftReedHeightBase, 4.2);
    const reedHVar = cfgNum(cfg.accentGrassTuftReedHeightVar, 1.8);
    const plumeLenBase = cfgNum(cfg.accentGrassTuftPlumeLenBase, 0.9);
    const plumeLenVar = cfgNum(cfg.accentGrassTuftPlumeLenVar, 0.6);
    const blades = [];
    for (let i = 0; i < n; i++) {
      const h1 = _accentHash(id, 710 + i * 5);
      const h2 = _accentHash(id, 711 + i * 5);
      const h3 = _accentHash(id, 712 + i * 5);
      const h4 = _accentHash(id, 713 + i * 5);
      const ang = (i / n) * Math.PI * 2 + (h1 - 0.5) * 1.6; // 方位均匀 + 抖动
      const base = baseSpread + h4 * baseSpreadVar; // 根部离锚点距离（簇底不完全重叠）
      const bx = Math.cos(ang) * base;
      const by = Math.sin(ang) * base;
      // 芦草：挺拔更高（4.2~6.0m）+ 叶尖外倾更收敛；普通短草维持 2.4~4.0m 原公式
      const h = isReed ? reedHBase + h2 * reedHVar : hBase + h2 * hVar;
      const leanK = isReed ? 0.14 + h3 * 0.20 : 0.30 + h3 * 0.45; // 叶尖外倾比例
      blades.push({
        bx: bx, by: by,
        tx: bx + Math.cos(ang) * h * leanK,
        ty: by + Math.sin(ang) * h * leanK,
        h: h,
        lite: _accentHash(id, 714 + i * 5),
        // 穗状芦花长度（世界单位；非芦草恒 0）。哈希通道 716+i*5 与叶身 710+i*5 独立
        plume: isReed ? plumeLenBase + _accentHash(id, 716 + i * 5) * plumeLenVar : 0,
      });
    }
    return { blades: blades, isReed: isReed };
  }

  // 锚点上方最大延伸（世界单位，未乘 zoom）——★ TA-07-3 起由**真值包围体**单一来源派生
  // （旧 kind 级硬编码常数 Boulder 7 / RockCluster 10 / GrassTuft 7 全部作废，与 TA-06-3
  //  「Tree/Bush 由骨架几何求值」同源，消除两处各算一套的漂移）。
  function extentOf(kind, vSeed, sk, bounds) {
    if (bounds) return bounds.zMax * 1.06 + 0.5; // 冠缘余量（沿用 TA-06-3 口径）
    if (kind === 'Boulder') return 7;            // 无骨架种类：bounds 已覆盖，此处仅兜底
    return 8;
  }

  // 取（或建）单个 accent 的稳定模型。key 含风格版本与 kind：调风格整体重建、同 id 异 kind 不串型。
  function get(accent) {
    const id = (accent && accent.id) || 0;
    const kind = (accent && accent.kind) || '';
    return getByKey(kind, id, 'v' + styleVersion() + '#' + kind + '#' + id);
  }

  // ★ S4-02 完整 key 通道（06 号文 §3.2「若复用 AccentModel.get()，须增加完整 key 通道」）：
  // 景观子图元（landscape-model.js）等非 accent 来源的模型，由调用方提供**自带命名空间前缀
  // 的完整缓存 key**（如 'L#v1#Tree#<hash>'）+ 稳定整数种子，与本文件 accent 缓存共用同一
  // 缓存池与 resetCache 生命周期，但 key 命名空间隔离——**禁止**把字符串 key 截成可能与
  // accent.id 碰撞的整数再走 get()。模型内容仍是 (kind, seed) 的纯函数。
  function getByKey(kind, seed, fullKey) {
    let m = _cache.get(fullKey);
    if (m !== undefined) return m;
    const id = seed || 0;
    const vSeed = vSeedOf(id);
    // ★ TA-06-2 物种派生：(kind, id) 纯函数；非 Tree/Bush 返回 undefined（零影响）。
    // profile 为季相单一入口（render_accents / render_shadows / render_landscapes 直接消费）。
    const species = speciesOf(kind, id);
    const sk = kind === 'Tree' ? treeSkeleton(id, vSeed, species ? species.silhouette : 'broad')
      : kind === 'Bush' ? bushSkeleton(id, vSeed, species ? species.silhouette : 'multiStem')
      : kind === 'RockCluster' ? rockClusterSkeleton(id, vSeed)
      : kind === 'GrassTuft' ? grassTuftSkeleton(id, vSeed)
      : null;
    // ★ TA-07-3 真值包围体 + 分级几何索引（§3.6）：全部为 (kind, id) 纯函数，随本条目缓存；
    //   只增字段，不改 _CACHE_MAX / 生命周期 / 缓存键构造（07 号 §10.2 契约不变）。
    var bounds = boundsOf(kind, sk);
    m = {
      id: id,
      kind: kind || '',
      vSeed: vSeed,
      species: species,                                  // { silhouette, profile } / undefined
      profile: species ? species.profile : undefined,    // ★ TA-06-2 profile 单一入口
      skeleton: sk,
      bounds: bounds,                                    // ★ TA-07-3 { rH, zMin, zMax, yUp } 真值
      // 远景簇子集（半径降序前 accentLODFarMaxClusters；几何输入 → 调值须 bump 风格版本）
      farClusters: sk && sk.clusters ? farClusterIndices(sk.clusters, farMaxClusters()) : null,
      segTier: (sk && sk.segTier) || null,               // 逐段 tier（0 主枝 / 1 二级枝）
      stoneMain: 0,                                      // RockCluster 主石索引（恒 0，显式登记）
      extent: extentOf(kind, vSeed, sk, bounds),
    };
    if (_cache.size >= _CACHE_MAX) _cache.clear();
    _cache.set(fullKey, m);
    return m;
  }

  // 世界事件失效入口：READY / LOAD_RESULT / REWIND_RESULT / RESET_DONE 时由 rustworld.js 调用
  function resetCache() {
    _cache.clear();
  }

  return {
    get: get,
    getByKey: getByKey, // ★ S4-02 完整 key 通道（景观等非 accent 来源模型，key 命名空间隔离）
    resetCache: resetCache,
    shearNormal: shearNormal, // TA-04-2 倾干剪切法线变换（逆转置）——返回新对象，兼容外部调用
    shearNormalInto: shearNormalInto, // ★ TA-11-6 零 GC 变体（写入调用方复用 out），热路径消费
    speciesOf: speciesOf, // ★ TA-06-2 物种派生（(kind,id) 纯函数 → { silhouette, profile }）
    hash: _accentHash, // 对外别名（避免消费方绕过本文件直接依赖全局函数名）
  };
})();
