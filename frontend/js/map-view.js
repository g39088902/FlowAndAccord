(() => {
  "use strict";

  const frame = document.getElementById("map-frame");
  const seedInput = document.getElementById("terrain-seed");
  const rerollButton = document.getElementById("btn-reroll");
  const useInGameLink = document.getElementById("btn-use-in-game");
  const typeNameEl = document.getElementById("terrain-type-name");
  const typeIdEl = document.getElementById("terrain-type-id");
  const typeTagEl = document.getElementById("terrain-type-tag");
  const maxSeed = Number.MAX_SAFE_INTEGER;

  // 地图模板名称对照（与 render_hud.js::MAP_TEMPLATE_LABELS 一致）
  const MAP_TEMPLATE_LABELS = {
    mountain_pass_v1: '⛰️ 山口',
    river_valley_v1: '🏞️ 河谷',
    grassland_plain_v1: '🌾 平地草原',
    hillside_woodland_v1: '🌲 半坡林地',
    plateau_v1: '🏕️ 台地',
    alluvial_fan_v1: '🏜️ 山前冲积扇',
    basin_oasis_v1: '⛰️ 盆地',
    volcanic_lake_v1: '🌋 火山湖',
    flat_baseline: '📐 诊断基线',
  };

  // 与 sim_core geo/terrain.rs::resolve_profile 完全一致的 8 路 random 候选池
  //（v1.50.68 砍需求：原 9 路中删除 river_valley_settlement_v1，
  //  plateau_settlement_v1 更名 plateau_v1）
  const RANDOM_CANDIDATES = [
    'mountain_pass_v1',
    'river_valley_v1',
    'grassland_plain_v1',
    'hillside_woodland_v1',
    'plateau_v1',
    'alluvial_fan_v1',
    'basin_oasis_v1',
    'volcanic_lake_v1',
  ];

  const PROFILE_SALT = 0x50524F46494C4531n;

  function resolveProfile(seed) {
    const cfgProfile = (typeof window.SIM_CONFIG !== 'undefined' && window.SIM_CONFIG.terrainProfile)
      ? window.SIM_CONFIG.terrainProfile
      : 'random';
    if (cfgProfile && cfgProfile !== 'random') {
      return cfgProfile;
    }
    const s = BigInt(Math.max(0, Number(seed) || 0));
    const idx = Number(((s ^ PROFILE_SALT) % 8n + 8n) % 8n);
    return RANDOM_CANDIDATES[idx] || RANDOM_CANDIDATES[0];
  }

  function updateTerrainDisplay(profile) {
    const label = MAP_TEMPLATE_LABELS[profile] || profile || '—';
    if (typeNameEl) typeNameEl.textContent = label;
    if (typeIdEl) typeIdEl.textContent = profile ? `(${profile})` : '';
    if (typeTagEl) {
      typeTagEl.textContent = label;
      typeTagEl.title = profile ? `当前地貌模板：${profile}` : '';
    }
  }

  function currentSeed() {
    const parsed = Number.parseInt(seedInput.value, 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.min(parsed, maxSeed) : 0;
  }

  function mapUrl(seed) {
    return `index.html?seed=${encodeURIComponent(String(seed))}&mapOnly=1&nogate=1`;
  }

  let pollTimer = null;
  function syncEngineProfile() {
    if (pollTimer) clearInterval(pollTimer);
    let attempts = 0;
    pollTimer = setInterval(() => {
      attempts++;
      try {
        const cw = frame.contentWindow;
        if (cw && cw.sim && cw.sim.terrain && cw.sim.terrain.profile) {
          updateTerrainDisplay(cw.sim.terrain.profile);
          clearInterval(pollTimer);
          pollTimer = null;
          return;
        }
      } catch (_) {
        clearInterval(pollTimer);
        pollTimer = null;
        return;
      }
      if (attempts > 60) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }, 50);
  }

  function renderMap() {
    const seed = currentSeed();
    seedInput.value = String(seed);
    const predicted = resolveProfile(seed);
    updateTerrainDisplay(predicted);
    frame.src = mapUrl(seed);
    useInGameLink.href = `index.html?seed=${encodeURIComponent(String(seed))}`;
    syncEngineProfile();
  }

  rerollButton.addEventListener("click", () => {
    seedInput.value = String(Math.floor(Math.random() * maxSeed));
    renderMap();
  });
  seedInput.addEventListener("change", renderMap);
  seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") renderMap();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "r" && event.target.tagName !== "INPUT") rerollButton.click();
  });

  renderMap();
})();
