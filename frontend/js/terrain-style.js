// === 景观风格样式表（★ TB-03-11，TB-03-IMPLEMENTATION-PLAN §8 D 工作包） ===
// 职责：profile → 可用 style 白名单 → 按世界 seed + 固定风格盐确定性选取基调，
//   以「逐 SurfaceKind 反照率乘色」注入 computeTerrainAlbedo（math.js）。
//
// 纯表现层边界（§8）：只改颜色/材质观感，不改 accents 数量/位置、模拟 RNG、
//   profile 名称与物理快照——样式开关前后物理 cells/POI/路网/库存逐字节相等。
//   首轮每个 TB-03 新模板只冻结一个可读基调；白名单扩充属后续迭代。
//
// 缓存与生命周期（§8）：风格 id 随世界激活；世界替换/读档/回溯时 rustworld.js
//   的 _invalidateWorldStaticCaches → SimLighting.markDirty 会使地表色缓存重建，
//   反照率乘色随之切换（风格不需要独立的 pattern 缓存键——TA-12 纹样哈希不含本层）。
// 加载顺序：config.render.js 之后、math.js/rustworld.js 之前（index.html 保证）；
//   本文件不在脚本加载时读取任何 Canvas / DOM 全局。
(function () {
  'use strict';

  // 固定风格盐（'TERRSTY1' 的 32 位截断）。一经落地永不更改——改盐值 = 换风格选型。
  const STYLE_SALT = 0x54455252 | 0;

  // 白名单：profile → 可用 style id 数组（首轮每模板一个冻结基调；旧模板不参与）。
  const STYLE_WHITELIST = {
    alluvial_fan_v1: ['warm_layered'],
    basin_oasis_v1: ['oasis_dry'],
    lakeside_basin_v1: ['lakeside_green'],
  };

  // 基调定义：逐 SurfaceKind 的反照率乘色（1.0 = 不改）。只列需要调色的键，
  // 其余地类恒为 1。物理性地表类别集合不变（不新增 SurfaceKind）。
  const STYLES = {
    // 冲积扇：暖色层岩——扇面土层偏暖、岩坡层理偏红褐，草色略干。
    warm_layered: {
      DryGround: [1.04, 0.99, 0.92],
      SoftGround: [1.05, 0.98, 0.90],
      RiverTerrace: [1.04, 0.99, 0.92],
      RockFace: [1.08, 1.00, 0.90],
    },
    // 盆地绿洲：干燥岸环——盆底生活带沙质暖调，盆壁岩面偏浅灰岩。
    oasis_dry: {
      DryGround: [1.05, 1.00, 0.90],
      SoftGround: [1.04, 0.99, 0.91],
      RiverTerrace: [1.05, 1.00, 0.90],
      RockFace: [1.02, 1.01, 0.98],
    },
    // 湖畔盆地：润泽绿岸——环岸草地偏冷绿，水床色压深托出湖面层次。
    lakeside_green: {
      DryGround: [0.97, 1.02, 0.97],
      SoftGround: [0.96, 1.02, 0.97],
      RiverTerrace: [0.97, 1.02, 0.97],
      ShallowWater: [0.92, 0.97, 1.05],
      DeepWater: [0.92, 0.97, 1.05],
      RiverBank: [0.95, 1.00, 1.00],
    },
  };

  let _active = null; // { id, tints }

  // 与内核 resolve_profile 同式的 random 判别（9 路候选池，TB-03-13 起）。
  // 仅用于风格选型；内核侧降级（flat_baseline）时本推断可能偏差——纯视觉，可接受。
  const RANDOM_CANDIDATES = [
    'mountain_pass_v1', 'river_valley_v1', 'grassland_plain_v1',
    'hillside_woodland_v1', 'river_valley_settlement_v1', 'plateau_settlement_v1',
    'alluvial_fan_v1', 'basin_oasis_v1', 'lakeside_basin_v1',
  ];
  // 内核常量 0x5052_4F46_494C_4531 拆半（JS 无 u64）：2^32 % 9 = 4，
  // value % 9 = (hi % 9) × 4 + (lo % 9)（模乘同余）。
  const SALT_HI = 0x50524F46 >>> 0;
  const SALT_LO = 0x494C4531 >>> 0;
  const POW32_MOD9 = 4;

  function resolveEffectiveProfile(profile, seed) {
    if (!profile || profile === 'random') {
      const s = (Number(seed) >>> 0);
      const hi = SALT_HI % 9;
      const lo = ((s >>> 0) ^ SALT_LO) >>> 0;
      const idx = (hi * POW32_MOD9 + (lo % 9)) % 9;
      return RANDOM_CANDIDATES[idx];
    }
    return profile;
  }

  // 世界就绪/换世界时激活：profile（SIM_CONFIG.terrainProfile）+ 世界 seed。
  function activate(profile, seed) {
    const eff = resolveEffectiveProfile(profile, Number(seed) >>> 0);
    const list = STYLE_WHITELIST[eff];
    if (!list || !list.length) { _active = null; return; }
    // 确定性选取：seed ^ 固定盐 → 桶索引（首轮每模板 1 个基调，恒取 0）。
    const h = (Math.imul((Number(seed) >>> 0) ^ STYLE_SALT, 2654435761) >>> 16) >>> 0;
    const id = list[h % list.length];
    _active = { id, tints: STYLES[id] || {} };
  }

  function deactivate() { _active = null; }

  // 反照率乘色查询（math.js::computeTerrainAlbedo 末尾消费；未激活/未列地类 = 不改）。
  function tintFor(surfaceKind) {
    return _active ? (_active.tints[surfaceKind] || null) : null;
  }

  function currentId() { return _active ? _active.id : null; }

  window.TerrainStyle = { activate, deactivate, tintFor, currentId };
})();
