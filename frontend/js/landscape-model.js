// === 资源景观模型层（★ S4-02，STAGE-04-TODO §3.2 / 06 号文「四 · D-C」）===
// 围绕资源 POI（Water/Wood/Berry/Stone/Gold）的**前端确定性派生景观**：稳定视觉 key、
// 固定整数哈希、配方/slot/候选上限、组级模型缓存与生命周期清理。
// 与基础装饰（accent 三件套）的关系：本层只生成「景观组 → 子图元」的稳定几何事实，
// 绘制复用 render_accents.js / render_grass.js 既有图元与光照季相（render_landscapes.js），
// 遮挡避让归 S4-03（landscape-mask），本层不做道路/房屋避让。
//
// 契约（STAGE-04-TODO §3.1/§3.2/§3.6）：
// - 纯表现层：不消耗 WorldRng、不写模拟状态、不入快照/FABS/存档；装饰开关与相机
//   不经 applyConfig()，全部参数只读 RENDER_CONFIG（config.render.js）。
// - 模型只由**静态输入**派生：世界 seed、POI 类型/坐标、地形网格、配方固定盐值、role/slot。
//   库存丰度 q 只写组上的动态字段（供细节绘制消费），**绝不**参与候选坐标/骨架重抽；
//   相机、缩放、DPR、季相、光照一概不是模型输入。
// - 视觉种子 = 固定 uint32 哈希（世界 seed × 类型盐 × poi.id × 配方盐 × role × slot），
//   明确无符号整数运算；禁 Math.random() / 墙钟 / 共享 WorldRng。
// - 装饰与 POI ID 命名空间不混用：子图元模型经 AccentModel.getByKey（完整 key 通道，
//   'L#' 前缀）解析，禁止截断成 accent.id。
// - 每 slot 固定最多 K 个候选（K 为配置有限整数）；候选被拒（越界/水面）即跳过该 slot，
//   **不重编号后续 slot、不重抽**；单组派生失败回退基础 POI 标记（本层返回空组）。
// - 缓存生命周期：READY / LOAD_RESULT / REWIND_RESULT / RESET_DONE 时由 rustworld.js
//   _invalidateWorldStaticCaches() 调用 resetCache()（与 AccentModel 同一消息生命周期）；
//   世界 token 只隔离缓存不参与视觉随机；换世界不残留旧组。
//
// 数据形态（STAGE-04-TODO §3.2 建议内部形态）：
//   LandscapeGroup  { key:'poi:<id>', recipe, recipeVersion, anchor, geometrySignature,
//                     children[], bounds, q, qValid }
//   LandscapeChild  { key:'poi:<id>/<role>/<slot>', modelKind, visualSeed,
//                     dx, dy, x, y, z, rot, scale, footprint, bounds, stockRole }
//
// 依赖：window.RENDER_CONFIG（config.render.js，本文件可晚于其加载）、sim.terrain /
//   sim.pois（由调用方传入）；AccentModel.getByKey 在渲染期由 render_landscapes.js 消费，
//   本层不解析个体模型（保持纯几何）。
window.LandscapeModel = window.LandscapeModel || (function () {
  // —— 配方版本：调配方/参数即整体重建组缓存（缓存键组成部分）——
  const RECIPE_VERSION = 1;

  // —— 固定 uint32 哈希（MurmurHash3 风格 finalizer，明确无符号整数运算）——
  function hash32() {
    let h = 0x811C9DC5;
    for (let i = 0; i < arguments.length; i++) {
      h = Math.imul(h ^ (arguments[i] | 0), 16777619);
      h = ((h << 13) | (h >>> 19)) >>> 0;
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  // 通道浮点 [0,1)：种子 + 通道号 → 稳定均匀浮点（语义同 accent-model::_accentHash）
  function chan(seed, ch) {
    return hash32(seed, ch | 0) / 4294967296;
  }
  // role 字符串 → 固定整数盐（字符码折叠，跨会话稳定）
  function roleSalt(role) {
    let s = 2166136261;
    for (let i = 0; i < role.length; i++) {
      s = Math.imul(s ^ role.charCodeAt(i), 16777619) >>> 0;
    }
    return s;
  }

  // —— POI 类型盐（§6.6 注 3：前端 poiTypeMap 归一化层；固定值非枚举位）——
  const TYPE_SALT = { Water: 0x57415445, Wood: 0x574F4F44, Berry: 0x42455252, Stone: 0x53544F4E, Gold: 0x474F4C44 };
  // 配方固定盐值（与 role/slot/类型盐共同进入种子哈希；调配方结构时手动换盐）
  const RECIPE_SALT = 0x4C4E4453; // 'LNDS'

  // —— 内置配方回退表（缺省回退与 config.render.js 集中值逐位一致）——
  // roles 顺序即候选生成顺序（固定 role/slot 序）；slots = 每 slot 群内候选上限 K。
  function defaultRecipes() {
    return {
      Water: { rMin: 24, rMax: 46, roles: [
        { role: 'stone', modelKind: 'RockCluster', slots: 2, scaleMin: 0.55, scaleMax: 0.85, footprint: 10 },
        { role: 'grass', modelKind: 'GrassTuft', slots: 4, scaleMin: 0.8, scaleMax: 1.2, footprint: 6 },
      ] },
      Wood: { rMin: 30, rMax: 60, roles: [
        { role: 'tree', modelKind: 'Tree', slots: 3, scaleMin: 0.9, scaleMax: 1.35, footprint: 10.5 },
        { role: 'bush', modelKind: 'Bush', slots: 3, scaleMin: 0.7, scaleMax: 1.1, footprint: 8 },
        { role: 'grass', modelKind: 'GrassTuft', slots: 3, scaleMin: 0.8, scaleMax: 1.2, footprint: 6 },
      ] },
      Berry: { rMin: 22, rMax: 44, roles: [
        { role: 'bush', modelKind: 'Bush', slots: 5, scaleMin: 0.7, scaleMax: 1.1, footprint: 8 },
        { role: 'grass', modelKind: 'GrassTuft', slots: 2, scaleMin: 0.8, scaleMax: 1.2, footprint: 6 },
      ] },
      Stone: { rMin: 22, rMax: 42, roles: [
        { role: 'rock', modelKind: 'RockCluster', slots: 2, scaleMin: 1.0, scaleMax: 1.5, footprint: 12 },
        { role: 'grass', modelKind: 'GrassTuft', slots: 2, scaleMin: 0.8, scaleMax: 1.2, footprint: 6 },
      ] },
      Gold: { rMin: 22, rMax: 42, roles: [
        { role: 'rock', modelKind: 'RockCluster', slots: 2, scaleMin: 1.0, scaleMax: 1.5, footprint: 12 },
        { role: 'grass', modelKind: 'GrassTuft', slots: 2, scaleMin: 0.8, scaleMax: 1.2, footprint: 6 },
      ] },
    };
  }

  function cfgNum(v, fallback) {
    return Number.isFinite(v) ? v : fallback;
  }
  function recipes() {
    const rc = window.RENDER_CONFIG || {};
    return rc.landscapeRecipes || defaultRecipes();
  }
  function styleVersion() {
    const v = window.RENDER_CONFIG && window.RENDER_CONFIG.landscapeStyleVersion;
    return Number.isFinite(v) ? v : 1;
  }
  function cacheMax() {
    const v = window.RENDER_CONFIG && window.RENDER_CONFIG.landscapeCacheMaxGroups;
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 256;
  }

  // —— 子图元种类包围余量（世界单位；与 AccentModel.extentOf 同源口径的本地镜像，
  //    仅供组 bounds 登记，不参与绘制）——
  const EXTENT_BY_KIND = { Tree: 18, Bush: 8, Boulder: 7, RockCluster: 10, GrassTuft: 7 };

  // ── 地形只读工具（静态输入；索引换算同 render_depth_queue.js::_ownCellCenterDepth 口径）──
  let _terr = null; // sync 时暂存当前地形引用（本层只在 sync 内消费）
  function terrainReady(terrain) {
    return !!(terrain && terrain.cells && terrain.cells.length >= terrain.gridSize * terrain.gridSize);
  }
  function worldHalf(cells) {
    const half = cells[cells.length - 1].wx; // 顶点阵末列 wx = +worldSize/2
    return half > 0 ? half : null;
  }
  // 双线性插值地表高程；出界返回 null（候选按「越界拒绝」处理，§3.3 第 4 条口径）
  function sampleElevation(x, y) {
    const t = _terr;
    if (!t) return null;
    const gSize = t.gridSize, cells = t.cells;
    const half = worldHalf(cells);
    if (half == null || Math.abs(x) > half || Math.abs(y) > half) return null;
    const fx = ((x + half) / (2 * half)) * (gSize - 1);
    const fy = ((y + half) / (2 * half)) * (gSize - 1);
    const gx = Math.max(0, Math.min(gSize - 2, Math.floor(fx)));
    const gy = Math.max(0, Math.min(gSize - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - gx));
    const ty = Math.max(0, Math.min(1, fy - gy));
    const i00 = gy * gSize + gx;
    const e00 = cells[i00].elev, e10 = cells[i00 + 1].elev;
    const e01 = cells[i00 + gSize].elev, e11 = cells[i00 + gSize + 1].elev;
    return (e00 * (1 - tx) + e10 * tx) * (1 - ty) + (e01 * (1 - tx) + e11 * tx) * ty;
  }
  // 候选落点是否为水面（四角顶点任一为 ShallowWater/DeepWater 即拒；RiverBank 为岸带陆地放行）。
  // Water 配方放置约束（§3.2 表：湿润表达是贴地色差，首版不画新泉池、不凭名称扩张水域）。
  const WATER_KINDS = { ShallowWater: 1, DeepWater: 1 };
  function isWaterSurface(x, y) {
    const t = _terr;
    if (!t) return true; // 地形不可用 → 保守拒绝
    const gSize = t.gridSize, cells = t.cells;
    const half = worldHalf(cells);
    if (half == null) return true;
    const gx = Math.max(0, Math.min(gSize - 1, Math.round(((x + half) / (2 * half)) * (gSize - 1))));
    const gy = Math.max(0, Math.min(gSize - 1, Math.round(((y + half) / (2 * half)) * (gSize - 1))));
    const idx = gy * gSize + gx;
    return !!(WATER_KINDS[cells[idx].surfaceKind] ||
      (gx > 0 && WATER_KINDS[cells[idx - 1].surfaceKind]) ||
      (gx < gSize - 1 && WATER_KINDS[cells[idx + 1].surfaceKind]) ||
      (gy > 0 && WATER_KINDS[cells[idx - gSize].surfaceKind]) ||
      (gy < gSize - 1 && WATER_KINDS[cells[idx + gSize].surfaceKind]));
  }

  // ── 组缓存（世界 token 只隔离缓存不参与视觉随机；换世界走 resetCache）──
  const _groups = [];       // 当前世界组列表（poi 顺序，稳定）
  const _groupByKey = new Map();
  let _staticSig = null;    // 静态事实签名（POI id/type/pos + 地形网格标识 + 配方版本）

  function resetCache() {
    _groups.length = 0;
    _groupByKey.clear();
    _staticSig = null;
    _terr = null;
  }

  // 静态签名：POI 集合（id/type/x/y/z）+ 地形规模 + 配方/风格版本。
  // 库存、季节、相机一概不入签名（§3.2：骨架与候选位置不受 q 影响）。
  function staticSignature(sim) {
    const pois = sim.pois || [];
    let sig = 'v' + styleVersion() + '#r' + RECIPE_VERSION + '#t' +
      (terrainReady(sim.terrain) ? sim.terrain.gridSize + 'x' + sim.terrain.cells.length : 'none');
    for (let i = 0; i < pois.length; i++) {
      const p = pois[i];
      sig += '|' + p.id + ':' + p.type + ':' + p.pos.x + ':' + p.pos.y + ':' + p.pos.z;
    }
    return sig;
  }

  // 单组构建：遍历 roles × slots（固定顺序），逐 slot 至多 1 个候选。
  // 失败处理（STAGE-04-TODO §4.2）：地形不可用/未知类型 → 返回 null（回退基础标记）；
  // 单个候选越界/水面 → 跳过该 slot 不重编号；未知 modelKind → 跳过该子图元。
  function buildGroup(poi, worldSeed) {
    const recipe = recipes()[poi.type];
    if (!recipe || !TYPE_SALT[poi.type]) return null; // Camp/Market 及未知类型不生成景观
    const typeSalt = TYPE_SALT[poi.type];
    const children = [];
    let bounds = 0;
    for (let ri = 0; ri < recipe.roles.length; ri++) {
      const roleDef = recipe.roles[ri];
      const slots = Math.max(0, Math.round(cfgNum(roleDef.slots, 0)));
      const rSalt = roleSalt(roleDef.role);
      const rMin = cfgNum(recipe.rMin, 24), rMax = cfgNum(recipe.rMax, 46);
      const modelKind = roleDef.modelKind;
      for (let slot = 0; slot < slots; slot++) {
        const seed = hash32(worldSeed, typeSalt, poi.id, RECIPE_SALT, rSalt, slot);
        // 极坐标均匀盘采样（§3.2：r = sqrt(lerp(rMin², rMax², u))、theta = 2πv）
        const u = chan(seed, 10), v = chan(seed, 11);
        const r = Math.sqrt(rMin * rMin + (rMax * rMax - rMin * rMin) * u);
        const theta = v * Math.PI * 2;
        const dx = Math.cos(theta) * r;
        const dy = Math.sin(theta) * r;
        const x = poi.pos.x + dx, y = poi.pos.y + dy;
        if (!EXTENT_BY_KIND[modelKind]) continue; // 未知模型类型：跳过该子图元
        if (poi.type === 'Water' && isWaterSurface(x, y)) continue; // 水面候选拒绝（跳过不重编号）
        const z = sampleElevation(x, y);
        if (z == null) continue; // 越界/地形缺失：跳过
        const scale = cfgNum(roleDef.scaleMin, 0.7) +
          (cfgNum(roleDef.scaleMax, 1.2) - cfgNum(roleDef.scaleMin, 0.7)) * chan(seed, 12);
        const footprint = cfgNum(roleDef.footprint, 8);
        const child = {
          key: 'poi:' + poi.id + '/' + roleDef.role + '/' + slot,
          modelKind: modelKind,
          visualSeed: seed,
          dx: dx, dy: dy,          // 局部极坐标变换后的水平偏移（组锚点坐标系）
          x: x, y: y, z: z,        // 世界坐标（高程逐点读取静态地形）
          rot: chan(seed, 13) * Math.PI * 2,
          scale: scale,
          footprint: footprint,
          bounds: footprint + EXTENT_BY_KIND[modelKind] * scale,
          stockRole: 'skeleton',   // S4-02 基础骨架不受丰度影响；可采细节角色归 S4-04/05
        };
        if (child.bounds > bounds) bounds = child.bounds;
        children.push(child);
      }
    }
    return {
      key: 'poi:' + poi.id,
      recipe: poi.type,
      recipeVersion: RECIPE_VERSION,
      anchor: { x: poi.pos.x, y: poi.pos.y, z: poi.pos.z },
      geometrySignature: 'w' + worldSeed + '#v' + styleVersion() + '#r' + RECIPE_VERSION + '#poi' + poi.id + ':' + poi.type,
      children: children,
      bounds: bounds,
      q: null,       // 动态丰度（sync 每帧刷新，不参与几何）
      qValid: false,
    };
  }

  // 丰度 q = clamp(currentStock / maxStock, 0, 1)；缺失/非有限/maxStock<=0 → 无有效丰度
  // （§3.2：保留基础标记；只影响画面动态细节，不回写数值、不影响几何）。
  function updateAbundance(group, poi) {
    const cur = poi.currentStock, max = poi.maxStock;
    if (Number.isFinite(cur) && Number.isFinite(max) && max > 0) {
      group.q = Math.max(0, Math.min(1, cur / max));
      group.qValid = true;
    } else {
      group.q = null;
      group.qValid = false;
    }
  }

  // ── 世界同步：静态签名变化才重建几何；库存只刷新动态丰度字段 ──
  // 相同快照重复调用一致；每帧调用成本 O(pois)（23 处 POI 字符串拼接 + 组查找）。
  function sync(sim) {
    if (!sim) return;
    const sig = staticSignature(sim);
    if (sig !== _staticSig) {
      resetCache();
      _staticSig = sig;
      _terr = terrainReady(sim.terrain) ? sim.terrain : null;
      // 地形不可用 → 不生成任何组（单组派生失败回退基础标记，待静态帧到达后重建）
      if (!_terr) return;
      const worldSeed = Number.isFinite(sim._engineSeed) ? (sim._engineSeed | 0) : 0;
      const pois = sim.pois || [];
      for (let i = 0; i < pois.length; i++) {
        const poi = pois[i];
        const group = buildGroup(poi, worldSeed);
        if (!group) continue;
        updateAbundance(group, poi);
        if (_groupByKey.size >= cacheMax()) { _groupByKey.clear(); _groups.length = 0; } // 超限整体清空，不 LRU
        _groupByKey.set(group.key, group);
        _groups.push(group);
      }
      return;
    }
    // 签名命中：只刷新动态丰度（几何零重建——库存变化不改变候选坐标的验收口径）。
    // 无条件刷新：不依赖 sim 实例同一性（签名相同即同一静态世界）。
    const pois = sim.pois || [];
    for (let i = 0; i < pois.length; i++) {
      const g = _groupByKey.get('poi:' + pois[i].id);
      if (g) updateAbundance(g, pois[i]);
    }
  }

  function groups() {
    return _groups;
  }
  function groupOf(poiId) {
    return _groupByKey.get('poi:' + poiId) || null;
  }

  return {
    sync: sync,
    groups: groups,
    groupOf: groupOf,
    resetCache: resetCache,
    // 暴露给临时验收断言与 render_landscapes 的只读帮助函数（不进入任何持久化测试）
    hash32: hash32,
    sampleElevation: sampleElevation,
    isWaterSurface: isWaterSurface,
  };
})();
