// === Accent 模型层（TA-01 + TA-03，docs/plan/tech/07-terrain-art.md §6.4/§6.7）===
// 稳定形态派生 + 个体模型缓存：由 accent.id 派生的确定性个体差异（vSeed、枝干骨架、
// 叶簇位置与脱落次序、包围体预估）只按 id 计算一次并缓存，渲染层（render_accents.js）
// 每帧只读模型。
//
// ★ TA-03 局部三维骨架（v1.50.25）：Tree = 锥形主干 + 主枝/二级枝 + 挂在枝端的椭球叶簇；
//   Bush = 基生多细茎 + 茎端/茎中段叶簇（不缩小乔木模型冒充灌木）。叶簇带稳定脱落次序
//   `shed`（0 先落 → 1 后落）与个体色差通道 `lite`——季节叶量下降时按次序收缩并隐藏叶簇，
//   春季按萌芽曲线恢复**同一批稳定位置**；暂停、读档、回溯后不重新随机抽样。
//   后续 TA-07（包围体剔除 / 局部几何缓存分级）在本文件扩展。
//
// ★ D-B1-6（06 号文 §5.5）：RockCluster = 内核只下发一个 anchor，2–5 颗子石的偏移/尺度/
//   形状全部由 accent.id 哈希派生（纯函数，读档/回溯逐位一致），**不为子石建实体、
//   不改碰撞/路面**；GrassTuft = 3–6 根短草线骨架，颜色由绘制层按当前季节派生
//   （同 Tree：SimTreeTint，不读存档 tint，见 14 号 §7.4）。
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

  // 稳定哈希常绿变体（TA-06 物种自动分配落地前的过渡接口；配置预留键，v1.50.25 起消费）。
  // 常绿 profile 叶量全年 ≥94%，叶簇永不脱落——冬季雪线场景里保留常绿骨架层次。
  function evergreenOf(id) {
    const cfg = window.RENDER_CONFIG || {};
    const chance = Number.isFinite(cfg.accentEvergreenChance) ? cfg.accentEvergreenChance : 0;
    return chance > 0 && _accentHash(id, 400) < chance;
  }

  function styleVersion() {
    const v = window.RENDER_CONFIG && window.RENDER_CONFIG.accentModelStyleVersion;
    return Number.isFinite(v) ? v : 1;
  }

  // ── Tree：锥形主干 + 主枝/二级枝 + 叶簇（§6.4：每树 12~24 簇，枝条全年保留）──
  // segments：枝干线段（局部三维端点 + 相对干宽系数 wK）；clusters：叶簇
  // （局部三维附着点 + 世界单位半径 r + 稳定脱落次序 shed + 色差通道 lite）。
  function treeSkeleton(id, vSeed) {
    const N = clusterCount('Tree');
    const trunkH = 6.5 + vSeed * 2.5;      // 与 v1.49.3 干高公式逐位一致
    const crownR = 8.5;                    // 冠包络基准半径（同旧四瓣树冠）
    const P = 5 + Math.floor(_accentHash(id, 210) * 2); // 主枝 5~6
    const segments = [];
    const tips = [];                       // 叶簇附着点（主枝端 → 二级枝端 → 冠顶 → 枝上补位）
    for (let i = 0; i < P; i++) {
      const h1 = _accentHash(id, 220 + i);
      const h2 = _accentHash(id, 240 + i);
      const h3 = _accentHash(id, 260 + i);
      const h4 = _accentHash(id, 284 + i);
      const ang = (i / P) * Math.PI * 2 + (h1 - 0.5) * 1.1; // 方位角（均匀布点 + 抖动）
      const hFrac = 0.55 + h2 * 0.32;                        // 着生高度（干上部）
      const elev = 0.5 + h3 * 0.55;                          // 仰角 ~29°..60°
      const blen = crownR * (0.46 + h4 * 0.20);              // 枝长
      const oz = trunkH * hFrac;
      const ce = Math.cos(elev);
      const tx = Math.cos(ang) * ce * blen;
      const ty = Math.sin(ang) * ce * blen;
      const tz = oz + Math.sin(elev) * blen;
      segments.push({ x1: 0, y1: 0, z1: oz, x2: tx, y2: ty, z2: tz, wK: 0.42 });
      tips.push({ x: tx, y: ty, z: tz });
      // 二级枝：沿主枝 55%~85% 处分叉，仰角更平，长为主枝一半
      const t = 0.55 + _accentHash(id, 300 + i) * 0.30;
      const sang = ang + (i & 1 ? 1 : -1) * (0.55 + _accentHash(id, 320 + i) * 0.5);
      const selev = Math.max(0.15, elev - 0.35 - _accentHash(id, 340 + i) * 0.2);
      const slen = blen * 0.5;
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
    // ★ v1.50.26 悬空叶簇修复：补位簇一律挂在真实枝条上。
    // 旧版冠顶/补位簇用抽象球面包络定位（z 最高 trunkH+0.95×crownR），而枝端最高只到
    // trunkH×hFrac+sin(elev)×blen，矮干树两者差可达 2~7 单位——满冠时被邻簇掩盖，
    // 秋冬叶量下降后幸存的高位补位簇即悬空于裸枝之外（实测 id=22 簇距最近枝 7.16）。
    // 冠顶簇：贴最高枝端内侧偏上，读作树冠顶点；补位簇：锚定主枝线段 55%~95% 参数位。
    let topTip = tips[0];
    for (let i = 1; i < tips.length; i++) {
      if (tips[i].z > topTip.z) topTip = tips[i];
    }
    tips.push({ x: topTip.x * 0.8, y: topTip.y * 0.8, z: topTip.z + 0.8 });
    while (tips.length < N) {
      const hA = _accentHash(id, 360 + tips.length);
      const hB = _accentHash(id, 380 + tips.length);
      const seg = segments[(Math.floor(hA * P) % P) * 2]; // 锚定主枝线段
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
        r: 2.1 + _accentHash(id, 460 + i) * 1.2,
        shed: _accentHash(id, 480 + i), // 稳定脱落次序：值小先落（§6.4）
        lite: _accentHash(id, 500 + i), // 个体色差通道（秋色簇间黄红先后，§6.3）
      });
    }
    const branchTips = [];
    for (let i = 0; i < segments.length; i += 2) {
      branchTips.push({ x: segments[i].x2, y: segments[i].y2, z: segments[i].z2 });
    }
    return { trunkH: trunkH, crownR: crownR, segments: segments, branchTips: branchTips, clusters: clusters };
  }

  // ── Bush：基生多细茎（§6.4：灌木由根部发出多根细茎，不缩小乔木冒充）+ 叶簇 ──
  function bushSkeleton(id, vSeed) {
    const N = clusterCount('Bush');
    const S = 4 + Math.floor(_accentHash(id, 310) * 3); // 茎 4~6
    const segments = [];
    const tips = [];
    for (let i = 0; i < S; i++) {
      const h1 = _accentHash(id, 212 + i);
      const h2 = _accentHash(id, 214 + i);
      const h3 = _accentHash(id, 216 + i);
      const ang = (i / S) * Math.PI * 2 + (h1 - 0.5) * 1.3; // 方位角
      const hgt = 3.4 + h2 * 1.6;      // 茎高（世界单位，整体 ≈ 旧灌木体量）
      const outK = 0.38 + h3 * 0.30;   // 顶端水平外倾比例
      const tx = Math.cos(ang) * hgt * outK;
      const ty = Math.sin(ang) * hgt * outK;
      segments.push({ x1: 0, y1: 0, z1: 0, x2: tx, y2: ty, z2: hgt, wK: 1 });
      tips.push({ x: tx, y: ty, z: hgt });
    }
    // 茎中段补位簇（45%~75% 高度）
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
        r: 1.5 + _accentHash(id, 460 + i) * 0.9,
        shed: _accentHash(id, 480 + i),
        lite: _accentHash(id, 500 + i),
      });
    }
    return { trunkH: 4.2, crownR: 6.5, segments: segments, branchTips: [], clusters: clusters };
  }

  // ── RockCluster（D-B1-6，06 号 §5.5）：anchor 前端派生 2–5 颗子石 ──
  // stones：{ x, y } 世界单位水平偏移（未乘 accent.scale/zoom，rotation 由绘制层施加）、
  // { r } 子石半径、{ shape[6] } 逐顶点半径变化系数（沿用 Boulder 七边形变径画法）、
  // { rot } 自转角、{ lite } 岩面明暗色差通道。首颗为主石（居中、最大），其余碎石散布。
  function rockClusterSkeleton(id, vSeed) {
    const n = 2 + Math.floor(_accentHash(id, 600) * 4); // 2~5 颗（§5.5）
    const spread = 3.2 + vSeed * 1.2;                    // 簇散布半径（世界单位）
    const stones = [];
    for (let i = 0; i < n; i++) {
      const h1 = _accentHash(id, 610 + i * 5);
      const h2 = _accentHash(id, 611 + i * 5);
      const h3 = _accentHash(id, 612 + i * 5);
      const h4 = _accentHash(id, 613 + i * 5);
      const ang = h1 * Math.PI * 2;
      const dist = i === 0 ? (h2 - 0.5) * 1.2 : spread * (0.35 + h2 * 0.60); // 主石近中
      const shape = [];
      for (let k = 0; k < 6; k++) {
        shape.push(0.82 + _accentHash(id, 630 + i * 6 + k) * 0.38); // 逐顶点变径（不重复 Boulder 固定纹理）
      }
      stones.push({
        x: Math.cos(ang) * dist,
        y: Math.sin(ang) * dist,
        r: i === 0 ? 2.4 + h3 * 1.0 : 1.1 + h3 * 1.3, // 主石最大，其余碎石
        rot: h4 * Math.PI * 2,
        lite: _accentHash(id, 614 + i * 5),
        shape: shape,
      });
    }
    return { spread: spread, stones: stones };
  }

  // ── GrassTuft（D-B1-6，06 号 §5.5）：3–6 根短草线 ──
  // 每根草叶：根部偏移 (bx,by) + 叶尖水平外倾 (tx,ty) + 叶高 h（世界单位，低于灌木）。
  // 颜色由绘制层按当前季节派生（同 Tree：SimTreeTint，不读存档 tint）；
  // lite 为个体色差通道。草叶形态是 id 纯函数，暂停/读档/回溯逐位重建。
  function grassTuftSkeleton(id, vSeed) {
    const n = 3 + Math.floor(_accentHash(id, 700) * 4); // 3~6 根（§5.5）
    const blades = [];
    for (let i = 0; i < n; i++) {
      const h1 = _accentHash(id, 710 + i * 5);
      const h2 = _accentHash(id, 711 + i * 5);
      const h3 = _accentHash(id, 712 + i * 5);
      const h4 = _accentHash(id, 713 + i * 5);
      const ang = (i / n) * Math.PI * 2 + (h1 - 0.5) * 1.6; // 方位均匀 + 抖动
      const base = 0.8 + h4 * 0.9;       // 根部离锚点距离（簇底不完全重叠）
      const bx = Math.cos(ang) * base;
      const by = Math.sin(ang) * base;
      const h = 2.4 + h2 * 1.6;          // 叶高 2.4~4.0（短草线）
      const leanK = 0.30 + h3 * 0.45;    // 叶尖外倾比例
      blades.push({
        bx: bx, by: by,
        tx: bx + Math.cos(ang) * h * leanK,
        ty: by + Math.sin(ang) * h * leanK,
        h: h,
        lite: _accentHash(id, 714 + i * 5),
      });
    }
    return { blades: blades };
  }

  // 锚点上方最大延伸（世界单位，未乘 zoom）——TA-07 包围体剔除的预留字段。
  // 仅作信息登记，当前视口剔除仍走 render_accents.js 的既有余量公式。
  function extentOf(kind, vSeed) {
    if (kind === 'Tree') return (6.5 + vSeed * 2.5) + 8.5 * 1.3; // trunkH + 冠顶余量
    if (kind === 'Bush') return 8;
    if (kind === 'Boulder') return 7;
    if (kind === 'RockCluster') return 10; // 主石半径×1.2 变径上限 + 散布
    if (kind === 'GrassTuft') return 5;    // 短草叶高上限
    return 8;
  }

  // 取（或建）单个 accent 的稳定模型。key 含风格版本与 kind：调风格整体重建、同 id 异 kind 不串型。
  function get(accent) {
    const id = (accent && accent.id) || 0;
    const kind = (accent && accent.kind) || '';
    const key = 'v' + styleVersion() + '#' + kind + '#' + id;
    let m = _cache.get(key);
    if (m !== undefined) return m;
    const vSeed = vSeedOf(id);
    m = {
      id: id,
      kind: kind,
      vSeed: vSeed,
      evergreen: kind === 'Tree' || kind === 'Bush' ? evergreenOf(id) : false,
      skeleton: kind === 'Tree' ? treeSkeleton(id, vSeed)
        : kind === 'Bush' ? bushSkeleton(id, vSeed)
        : kind === 'RockCluster' ? rockClusterSkeleton(id, vSeed)
        : kind === 'GrassTuft' ? grassTuftSkeleton(id, vSeed)
        : null,
      extent: extentOf(kind, vSeed),
    };
    if (_cache.size >= _CACHE_MAX) _cache.clear();
    _cache.set(key, m);
    return m;
  }

  // 世界事件失效入口：READY / LOAD_RESULT / REWIND_RESULT / RESET_DONE 时由 rustworld.js 调用
  function resetCache() {
    _cache.clear();
  }

  return {
    get: get,
    resetCache: resetCache,
    hash: _accentHash, // 对外别名（避免消费方绕过本文件直接依赖全局函数名）
  };
})();
