(() => {
  "use strict";

  const frame = document.getElementById("map-frame");
  const seedInput = document.getElementById("terrain-seed");
  const rerollButton = document.getElementById("btn-reroll");
  const useInGameLink = document.getElementById("btn-use-in-game");
  const maxSeed = Number.MAX_SAFE_INTEGER;

  function currentSeed() {
    const parsed = Number.parseInt(seedInput.value, 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.min(parsed, maxSeed) : 0;
  }

  function mapUrl(seed) {
    return `index.html?seed=${encodeURIComponent(String(seed))}&mapOnly=1&nogate=1`;
  }

  function renderMap() {
    const seed = currentSeed();
    seedInput.value = String(seed);
    frame.src = mapUrl(seed);
    useInGameLink.href = `index.html?seed=${encodeURIComponent(String(seed))}`;
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
