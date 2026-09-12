// === Accent 模型层（TA-01，docs/plan/tech/07-terrain-art.md §6.7）===
// 稳定形态派生 + 个体模型缓存：由 accent.id 派生的确定性个体差异（vSeed、叶簇散点、
// 包围体预估）只按 id 计算一次并缓存，渲染层（render_accents.js）每帧只读模型。
// 后续 TA-03（枝干骨架/叶簇次序）、TA-07（局部几何与包围体缓存）在本文件扩展。
//
// 契约（frontend/AGENTS.md §5.11 / 07-terrain-art.md §10.2）：
// - 纯表现层：不消耗 WorldRng、不写模拟状态、不入快照、不参与内核确定性承诺。
// - 模型值是 accent.id 的**纯函数**——缓存与否、何时失效都不改变像素结果，
//   但缓存生命周期仍遵守世界事件契约：READY / LOAD_RESULT / REWIND_RESULT / RESET_DONE
//   时由 rustworld.js 调用 AccentModel.resetCache()，换世界不残留旧模型。
// - 缓存设条目上限（见 _CACHE_MAX），超限整体清空重建，不做 LRU（§10.2 内存上限纪律）。
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

  // Tree 树冠叶簇散点（10 枚，v1.49.3 引入；通道 i+1 / i+31 / i+67 与历史实现逐位一致）。
  // 全部以「单位空间」存储，绘制时乘 crownR / squash 还原，保证缩放无关。
  function treeDapples(id) {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const t1 = _accentHash(id, i + 1);
      const t2 = _accentHash(id, i + 31);
      const t3 = _accentHash(id, i + 67);
      out.push({
        ang: t1 * Math.PI * 2,        // 分布角
        radK: 0.16 + t2 * 0.60,       // 分布半径系数（× crownR；主冠椭圆内，中上偏密）
        shift: (i - 5) * 0.4,         // 屏幕空间水平去整列偏移（i 固定，可预计算）
        drK: 0.09 + t3 * 0.12,        // 叶点半径系数（× crownR）
        lite: (i & 1) === 1,          // 暗/亮叶点交替（false = 暗）
      });
    }
    return out;
  }

  // Bush 枝叶散点（7 枚；通道 i+101 / i+131 / i+167 与历史实现逐位一致）
  function bushDapples(id) {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const t1 = _accentHash(id, i + 101);
      const t2 = _accentHash(id, i + 131);
      const t3 = _accentHash(id, i + 167);
      out.push({
        ang: t1 * Math.PI * 2,
        radK: 0.15 + t2 * 0.55,       // × r
        drK: 0.10 + t3 * 0.12,        // × r
        lite: (i & 1) === 1,
      });
    }
    return out;
  }

  // 锚点上方最大延伸（世界单位，未乘 zoom）——TA-07 包围体剔除的预留字段。
  // 仅作信息登记，当前视口剔除仍走 render_accents.js 的既有余量公式。
  function extentOf(kind, vSeed) {
    if (kind === 'Tree') return (6.5 + vSeed * 2.5) + 8.5 * 1.3; // trunkH + 冠顶余量
    if (kind === 'Bush') return 7;
    if (kind === 'Boulder') return 7;
    return 8;
  }

  // 取（或建）单个 accent 的稳定模型。key 含 kind：同 id 异 kind 不串型。
  function get(accent) {
    const id = (accent && accent.id) || 0;
    const kind = (accent && accent.kind) || '';
    const key = kind + '#' + id;
    let m = _cache.get(key);
    if (m !== undefined) return m;
    const vSeed = vSeedOf(id);
    m = {
      id: id,
      kind: kind,
      vSeed: vSeed,
      treeDapples: kind === 'Tree' ? treeDapples(id) : null,
      bushDapples: kind === 'Bush' ? bushDapples(id) : null,
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
