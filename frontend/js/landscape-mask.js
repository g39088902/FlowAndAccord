// === 景观遮罩与动态几何更新层（★ S4-03，STAGE-04-TODO §3.3）===
// 最终世界几何（道路 / 房屋 / POI）到达后的**表现层确定性后处理**：把资源景观子图元与
// 基础装饰（accent 三件套）中落入「保护区」的可见实例隐藏，源数组（sim.terrain.accents /
// LandscapeModel 组）保持不变——避让只隐藏表现，关闭景观（landscapeEnabled=false）即恢复
// 基础装饰原画面（遮罩随之休眠，hidesX 恒 false）。
//
// 契约（STAGE-04-TODO §3.1/§3.3）：
// - **全部几何量为世界单位**，不涉及显示像素；世界 → 屏幕换算只在绘制端经 camera.zoom
//   一次（遮罩查询与世界空间命中，不需要像素转换）。
// - 保护区三类：① 车道 = 实际车道曲线全段采样胶囊带（**不能只比较端点**；采样弦差须小于
//   留白余量，细分上限走配置；异常段退化为端点包围区保守保护）；② 房屋 = 保守圆（前端无
//   入口映射，按房屋周边整体保护，不猜门朝向）；③ POI = 操作区（底座/标记半径取大 + 余量；
//   连接路段已由车道胶囊覆盖，含取水走廊）。装饰范围不反推物理占地。
// - 空间索引：世界平面网格分桶（bin 边长走配置）；查询先取足迹相交的桶，再做精确
//   圆-圆 / 圆-线段距离检测——**严禁**每帧执行 accents × 全道路 × 全房屋扫描。
// - 动态失效：字段签名检测（建房/拆房/升级 = houses 签名；道路增删 = geom_version + 条数，
//   磨损 wear 不改几何不触发；营地升级 = POI 签名含 level）。变化只增删**脏桶**中的
//   zone（车道按 geom_version 变化时逐条 diff），零全量每帧重算；库存变动不触发遮罩重建。
// - 去重：资源群与基础树草相交时按固定「来源优先级（景观 > 基础装饰）」保留，与集合遍历
//   顺序无关；被保护区隐藏的景观子图元不参与去重（不隐藏本已该隐藏的装饰两次）。
// - 失败处理（STAGE-04-TODO §4.3）：索引构建异常 → 清空索引进入「无景观」降级
//   （childHidden 恒 true、accentHidden 恒 false），**不使用旧世界索引**；
//   无法可靠裁剪的子图元整体隐藏（首版不做子图元内裁剪）。
// - 纯表现层：不写模拟状态、不入快照/FABS/存档；参数只读 RENDER_CONFIG，禁 applyConfig()。
// - 生命周期：READY / LOAD_RESULT / REWIND_RESULT / RESET_DONE 时由 rustworld.js
//   _invalidateWorldStaticCaches() 调用 resetCache()（换世界零残留）。
//
// 对外 API：sync(sim)（每帧幂等调用）/ childHidden(child) / accentHidden(accent) /
//   resetCache() / stats()（验收观测）。内部先调 LandscapeModel.sync(sim) 再重建占据网格，
//   保证深度队列 accent 段（先于景观段执行）拿到的是本帧最新景观几何。
// 依赖：window.RENDER_CONFIG、window.LandscapeModel（landscape-model.js，须先加载）。
window.LandscapeMask = window.LandscapeMask || (function () {
  // ── 配置读取（缺省回退与 config.render.js 集中值逐位一致）──
  function cfgNum(v, fb) { return Number.isFinite(v) ? v : fb; }
  function cfgBool(v, fb) { return typeof v === 'boolean' ? v : fb; }
  function maskEnabled() {
    const RC = window.RENDER_CONFIG || {};
    return cfgBool(RC.landscapeEnabled, true) && cfgBool(RC.landscapeMaskEnabled, true);
  }
  function binSize() { return Math.max(16, cfgNum((window.RENDER_CONFIG || {}).landscapeMaskBinSize, 96)); }
  function laneRadius() { return Math.max(2, cfgNum((window.RENDER_CONFIG || {}).landscapeMaskLaneRadius, 9)); }
  function laneSamples() { return Math.max(8, Math.round(cfgNum((window.RENDER_CONFIG || {}).landscapeMaskLaneSamples, 36))); }
  function houseRadius() { return Math.max(4, cfgNum((window.RENDER_CONFIG || {}).landscapeMaskHouseRadius, 18)); }
  function poiExtra() { return Math.max(0, cfgNum((window.RENDER_CONFIG || {}).landscapeMaskPoiExtraRadius, 4)); }
  function margin() { return Math.max(0, cfgNum((window.RENDER_CONFIG || {}).landscapeMaskMargin, 2)); }

  // ── 状态 ──
  let _geomRev = 1;            // 保护区修订号（任一 zone 增删改即 +1；查询缓存键组成部分）
  let _failed = false;         // 索引异常降级：无景观模式（不使用旧世界索引）
  let _dormant = false;        // 遮罩休眠（景观开关或遮罩开关关闭）：全部按原样绘制
  let _lanesSig = null;        // 车道全局签名（geom_version + 条数）
  let _housesSig = null;       // 房屋集合签名
  let _poisSig = null;         // POI 集合签名
  const _buckets = new Map();  // binKey → Zone[]（保护区）
  const _laneZones = new Map();  // laneId → zone
  const _houseZones = new Map(); // houseId → zone
  const _poiZones = new Map();   // poiId → zone
  const _occBuckets = new Map(); // binKey → child[]（可见景观子图元占据，供装饰去重）
  let _occBuiltKey = '';       // 占据网格已构建标记（模型版本 + '@' + geomRev）
  const _dirty = { lane: 0, house: 0, poi: 0 }; // 累计脏更新计数（验收观测）

  // bin 键：世界坐标有界（±worldSize/2），bin 坐标偏移进正数域后合并
  function binKey(bx, by) { return ((bx + 512) << 10) | (by + 512); }

  function registerBbox(minx, miny, maxx, maxy, obj, buckets) {
    const bs = binSize();
    const bx0 = Math.floor(minx / bs), bx1 = Math.floor(maxx / bs);
    const by0 = Math.floor(miny / bs), by1 = Math.floor(maxy / bs);
    obj.binKeys = [];
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let by = by0; by <= by1; by++) {
        const k = binKey(bx, by);
        let arr = buckets.get(k);
        if (!arr) { arr = []; buckets.set(k, arr); }
        arr.push(obj);
        obj.binKeys.push(k);
      }
    }
  }

  function removeZone(z) {
    for (let i = 0; i < z.binKeys.length; i++) {
      const arr = _buckets.get(z.binKeys[i]);
      if (!arr) continue;
      const idx = arr.indexOf(z);
      if (idx >= 0) arr.splice(idx, 1);
      if (!arr.length) _buckets.delete(z.binKeys[i]);
    }
  }

  // ── zone 构造 ──
  // 车道胶囊带：先 8 点粗估弧长，再按弧长细分（目标弦距 ≤ 12，clamp 到细分上限）——
  // 强弯段弦差须小于留白余量 margin；出现非有限采样点（异常几何）→ 退化为端点中点
  // 保守包围圆（半径 = 半弦长 + 胶囊半径），宁可多留白不可漏保护。
  function buildLaneZone(id, curve) {
    const r = laneRadius() + margin();
    const p0 = curve.p0, p3 = curve.p3;
    const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    let estLen = chord;
    try {
      let prev = curve.evalPos(0);
      estLen = 0;
      for (let i = 1; i <= 8; i++) {
        const pt = curve.evalPos(i / 8);
        estLen += Math.hypot(pt.x - prev.x, pt.y - prev.y);
        prev = pt;
      }
    } catch (e) { estLen = chord; } // 粗估失败按弦长走，正式采样仍会捕获异常段
    const segs = Math.max(8, Math.min(laneSamples(), Math.ceil(estLen / 10)));
    const pts = [];
    let bad = false;
    for (let i = 0; i <= segs; i++) {
      const pt = curve.evalPos(i / segs);
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) { bad = true; break; }
      pts.push(pt.x, pt.y);
    }
    if (bad || pts.length < 4) {
      return { kind: 'lane', id: id, cx: (p0.x + p3.x) / 2, cy: (p0.y + p3.y) / 2,
        r: r + chord / 2, binKeys: [], _sig: null };
    }
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < minx) minx = pts[i]; if (pts[i] > maxx) maxx = pts[i];
      if (pts[i + 1] < miny) miny = pts[i + 1]; if (pts[i + 1] > maxy) maxy = pts[i + 1];
    }
    return { kind: 'lane', id: id, pts: pts, r: r,
      minx: minx - r, miny: miny - r, maxx: maxx + r, maxy: maxy + r, binKeys: [], _sig: null };
  }

  function circleZone(kind, id, cx, cy, r) {
    return { kind: kind, id: id, cx: cx, cy: cy, r: r, binKeys: [], _sig: null };
  }

  // POI 操作区半径 = max(底座半径, 图标世界尺寸 ~12) + 额外余量（营地底座随 level 增长）。
  // 底座/图标键复用深度队列 poiBase* 同源配置；**poiMarkerFootprintR 是深度辅助半径
  // （足迹感知深度用），大于视觉占地，严禁直接用作保护区半径**——否则资源环内圈
  // （rMin 22~24 < 26）会被整环误杀。
  function poiRadius(poi) {
    const RC = window.RENDER_CONFIG || {};
    const iconWorldR = 12;
    let baseR;
    if (poi.type === 'Camp') {
      baseR = cfgNum(RC.poiBaseCampR, 16) + (poi.level || 0) * cfgNum(RC.poiBaseCampRPerLevel, 3);
    } else {
      baseR = cfgNum(RC.poiBaseResourceR, 12);
    }
    return Math.max(baseR, iconWorldR) + poiExtra() + margin();
  }

  // ── 命中查询：先取足迹相交桶，再精确圆-圆 / 圆-线段距离 ──
  function distPtSeg2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const qx = ax + dx * t - px, qy = ay + dy * t - py;
    return qx * qx + qy * qy;
  }

  function hitZones(x, y, r) {
    const bs = binSize();
    const bx0 = Math.floor((x - r) / bs), bx1 = Math.floor((x + r) / bs);
    const by0 = Math.floor((y - r) / bs), by1 = Math.floor((y + r) / bs);
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let by = by0; by <= by1; by++) {
        const arr = _buckets.get(binKey(bx, by));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const z = arr[i];
          if (z.cx !== undefined) {
            const dx = x - z.cx, dy = y - z.cy, rr = z.r + r;
            if (dx * dx + dy * dy < rr * rr) return true;
          } else {
            const pts = z.pts, lim = z.r + r;
            for (let s = 0; s < pts.length - 2; s += 2) {
              if (distPtSeg2(x, y, pts[s], pts[s + 1], pts[s + 2], pts[s + 3]) < lim * lim) return true;
            }
          }
        }
      }
    }
    return false;
  }

  // ── 同步：车道（geom_version + 条数变化才逐条 diff）──
  function laneSigOf(lane) {
    const p0 = lane.curve.p0, p1 = lane.curve.p1, p2 = lane.curve.p2, p3 = lane.curve.p3;
    return lane.id + ':' + p0.x + ',' + p0.y + '|' + p1.x + ',' + p1.y + '|' +
      p2.x + ',' + p2.y + '|' + p3.x + ',' + p3.y;
  }
  function syncLanes(sim) {
    const lanes = (sim.network && sim.network.lanes) || new Map();
    const gv = sim._geomVersion != null ? sim._geomVersion : 'n';
    const sig = gv + '#' + lanes.size;
    if (sig === _lanesSig) return;
    _lanesSig = sig;
    let changed = false;
    const seen = new Set();
    for (const lane of lanes.values()) {
      if (!lane || !lane.curve) continue;
      seen.add(lane.id);
      const s = laneSigOf(lane);
      const z = _laneZones.get(lane.id);
      if (z && z._sig === s) continue; // 未变：桶原样保留（脏桶粒度 = 单条车道）
      if (z) { removeZone(z); _laneZones.delete(lane.id); }
      const nz = buildLaneZone(lane.id, lane.curve);
      nz._sig = s;
      if (nz.cx !== undefined) registerBbox(nz.cx - nz.r, nz.cy - nz.r, nz.cx + nz.r, nz.cy + nz.r, nz, _buckets);
      else registerBbox(nz.minx, nz.miny, nz.maxx, nz.maxy, nz, _buckets);
      _laneZones.set(lane.id, nz);
      _dirty.lane++;
      changed = true;
    }
    for (const [id, z] of _laneZones) {
      if (!seen.has(id)) { removeZone(z); _laneZones.delete(id); _dirty.lane++; changed = true; }
    }
    if (changed) _geomRev++;
  }

  // ── 同步：房屋（集合签名变化才逐栋 diff；建造中房屋同圆保护，进度不入签名防抖动）──
  function houseSigOf(h) {
    return h.id + ':' + h.pos.x + ':' + h.pos.y + ':' + h.pos.z + ':' + (h.tier || 0);
  }
  function syncHouses(sim) {
    const houses = sim.houses || [];
    let sig = '';
    for (let i = 0; i < houses.length; i++) sig += houseSigOf(houses[i]) + ';';
    if (sig === _housesSig) return;
    _housesSig = sig;
    let changed = false;
    const seen = new Set();
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      if (!h || !h.pos || !Number.isFinite(h.pos.x) || !Number.isFinite(h.pos.y)) continue;
      seen.add(h.id);
      const s = houseSigOf(h);
      const z = _houseZones.get(h.id);
      if (z && z._sig === s) continue;
      if (z) { removeZone(z); _houseZones.delete(h.id); }
      const nz = circleZone('house', h.id, h.pos.x, h.pos.y, houseRadius() + margin());
      nz._sig = s;
      registerBbox(nz.cx - nz.r, nz.cy - nz.r, nz.cx + nz.r, nz.cy + nz.r, nz, _buckets);
      _houseZones.set(h.id, nz);
      _dirty.house++;
      changed = true;
    }
    for (const [id, z] of _houseZones) {
      if (!seen.has(id)) { removeZone(z); _houseZones.delete(id); _dirty.house++; changed = true; }
    }
    if (changed) _geomRev++;
  }

  // ── 同步：POI（操作区；签名含 Camp level——升级扩圈走脏桶）──
  function poiSigOf(p) {
    return p.id + ':' + p.type + ':' + p.pos.x + ':' + p.pos.y + ':' + (p.level || 0);
  }
  function syncPois(sim) {
    const pois = sim.pois || [];
    let sig = '';
    for (let i = 0; i < pois.length; i++) sig += poiSigOf(pois[i]) + ';';
    if (sig === _poisSig) return;
    _poisSig = sig;
    let changed = false;
    const seen = new Set();
    for (let i = 0; i < pois.length; i++) {
      const p = pois[i];
      if (!p || !p.pos || !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) continue;
      seen.add(p.id);
      const s = poiSigOf(p);
      const z = _poiZones.get(p.id);
      if (z && z._sig === s) continue;
      if (z) { removeZone(z); _poiZones.delete(p.id); }
      const nz = circleZone('poi', p.id, p.pos.x, p.pos.y, poiRadius(p));
      nz._sig = s;
      registerBbox(nz.cx - nz.r, nz.cy - nz.r, nz.cx + nz.r, nz.cy + nz.r, nz, _buckets);
      _poiZones.set(p.id, nz);
      _dirty.poi++;
      changed = true;
    }
    for (const [id, z] of _poiZones) {
      if (!seen.has(id)) { removeZone(z); _poiZones.delete(id); _dirty.poi++; changed = true; }
    }
    if (changed) _geomRev++;
  }

  // ── 占据网格重建：可见景观子图元入桶 + 逐子图元预判保护区命中（child._masked）──
  // 触发条件 = 模型版本或保护区修订号变化（建房等不重建模型也会刷新 _masked）。
  // ★ S4-04：可采细节子图元（stockRole 'detail'）只做 _masked 预判、**不入占据桶**——
  //   其显隐随库存 q 逐帧变化而 geomRev 不变，入桶会让基础装饰被「不可见细节」误去重；
  //   细节均为小 footprint 且基础装饰不围绕 POI 生成（S4-01 实测），不参与去重可接受。
  function rebuildOcc() {
    _occBuckets.clear();
    const LM = window.LandscapeModel;
    const groups = LM ? LM.groups() : [];
    for (let gi = 0; gi < groups.length; gi++) {
      const children = groups[gi].children;
      for (let ci = 0; ci < children.length; ci++) {
        const child = children[ci];
        child._masked = hitZones(child.x, child.y, child.footprint); // 完整足迹判定（§3.3 第 4 条）
        if (!child._masked && child.stockRole !== 'detail') {
          registerBbox(child.x - child.footprint, child.y - child.footprint,
            child.x + child.footprint, child.y + child.footprint, child, _occBuckets);
        }
      }
    }
  }

  // ── 对外：每帧同步（幂等；静态事实不变零重建）──
  function sync(sim) {
    if (!sim) return;
    if (!maskEnabled()) { _dormant = true; return; } // 关态休眠：不清理不重建，恢复原画面
    _dormant = false;
    try {
      syncLanes(sim);
      syncHouses(sim);
      syncPois(sim);
      window.LandscapeModel.sync(sim); // 幂等；先于深度队列 accent 段刷新组几何
      const key = (window.LandscapeModel.version ? window.LandscapeModel.version() : 0) + '@' + _geomRev;
      if (key !== _occBuiltKey) { rebuildOcc(); _occBuiltKey = key; }
      _failed = false;
    } catch (e) {
      hardReset();
      _failed = true; // 索引异常降级：无景观（不使用旧世界索引）
      if (sim.debugMode) console.warn('[landscape-mask] 索引构建异常，降级为无景观:', e && e.message);
    }
  }

  // ── 对外：景观子图元是否被遮蔽（占据网格重建时已预判；未构建时现场判定兜底）──
  function childHidden(child) {
    if (_dormant || !child) return false;
    if (_failed) return true;
    const LM = window.LandscapeModel;
    const key = (LM && LM.version ? LM.version() : 0) + '@' + _geomRev;
    if (key === _occBuiltKey && child._masked !== undefined) return child._masked;
    return hitZones(child.x, child.y, child.footprint);
  }

  // ── 对外：基础装饰是否被遮蔽（保护区命中 ∨ 与可见景观子图元重叠去重）──
  // 结果按 (修订号 + 占据键) 缓存在 accent._lm（纯表现缓存；accents 为静态实例，
  // 世界切换经 resetCache 递增修订号自动失效）——每帧每装饰零重复距离计算。
  const _accentFootByKind = { Tree: 10.5, Bush: 8, RockCluster: 10, Boulder: 7, GrassTuft: 7 };
  function accentHidden(accent) {
    if (_dormant || !accent) return false;
    if (_failed) return false; // 降级：装饰全保留（景观已整体隐藏）
    const tag = _geomRev + '/' + _occBuiltKey;
    let c = accent._lm;
    if (!c || c.tag !== tag) {
      const r = (_accentFootByKind[accent.kind] || 8) * (accent.scale || 1);
      let hidden = hitZones(accent.x, accent.y, r);
      if (!hidden) hidden = occHit(accent.x, accent.y, r);
      accent._lm = { tag: tag, h: hidden ? 1 : 0 };
      c = accent._lm;
    }
    return !!c.h;
  }

  function occHit(x, y, r) {
    const bs = binSize();
    const bx0 = Math.floor((x - r) / bs), bx1 = Math.floor((x + r) / bs);
    const by0 = Math.floor((y - r) / bs), by1 = Math.floor((y + r) / bs);
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let by = by0; by <= by1; by++) {
        const arr = _occBuckets.get(binKey(bx, by));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const ch = arr[i];
          const dx = x - ch.x, dy = y - ch.y, rr = ch.footprint + r;
          if (dx * dx + dy * dy < rr * rr) return true;
        }
      }
    }
    return false;
  }

  function hardReset() {
    _buckets.clear();
    _laneZones.clear();
    _houseZones.clear();
    _poiZones.clear();
    _occBuckets.clear();
    _occBuiltKey = '';
    _lanesSig = _housesSig = _poisSig = null;
    _geomRev++;
  }

  function resetCache() {
    hardReset();
    _failed = false;
    _dormant = false;
  }

  function stats() {
    let occ = 0, masked = 0;
    const LM = window.LandscapeModel;
    const groups = LM ? LM.groups() : [];
    for (let gi = 0; gi < groups.length; gi++) {
      const children = groups[gi].children;
      for (let ci = 0; ci < children.length; ci++) {
        occ++;
        if (children[ci]._masked) masked++;
      }
    }
    return {
      lanes: _laneZones.size, houses: _houseZones.size, pois: _poiZones.size,
      buckets: _buckets.size, occChildren: occ, maskedChildren: masked,
      geomRev: _geomRev, failed: _failed, dormant: _dormant, dirty: { ..._dirty },
    };
  }

  return {
    sync: sync,
    childHidden: childHidden,
    accentHidden: accentHidden,
    resetCache: resetCache,
    stats: stats,
    // 临时验收断言专用（不进入任何持久化测试；§4.10）
    hitZones: hitZones,
  };
})();
