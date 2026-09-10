(() => {
  "use strict";

  const canvas = document.getElementById("map-canvas");
  const ctx = canvas.getContext("2d");
  const select = document.getElementById("terrain-template");
  const seedInput = document.getElementById("terrain-seed");
  const rerollButton = document.getElementById("btn-reroll");
  const useInGameLink = document.getElementById("btn-use-in-game");
  const titleEl = document.getElementById("map-title");
  const descriptionEl = document.getElementById("map-description");
  const tagsEl = document.getElementById("map-tags");

  let view = { x: 0, y: 0, scale: 1 };
  let dragging = null;
  let width = 0;
  let height = 0;

  const templates = {
    "river-valley": {
      title: "两岸河谷", description: "一条主河切开谷底，浅滩与缓坡将两岸重新连成可读的地理整体。", tags: ["静态主河", "河阶", "浅滩", "T2"], draw: drawRiverValley,
    },
    plateau: {
      title: "台地聚落", description: "平缓台面被台缘和坡脚水源定义；开阔建设空间与下行成本彼此拉扯。", tags: ["台缘", "缓坡入口", "坡脚水源", "T3+"], draw: drawPlateau,
    },
    delta: {
      title: "河口三角洲", description: "分汊水道在冲积低地上展开，干地脊与湿润岸带组织出密集但受约束的陆地。", tags: ["分汊", "冲积低地", "湿地", "T4"], draw: drawDelta,
    },
    bay: {
      title: "海湾聚落", description: "陆地围出安静海湾，岩岬、缓岸与内陆淡水共同决定可居住的海陆边界。", tags: ["海陆边界", "缓岸", "岩岬", "T4"], draw: drawBay,
    },
    basin: {
      title: "盆地绿洲", description: "外缘山坡环抱汇水低地，有限水源把植被与可居住空间凝聚在盆地中央。", tags: ["汇水低地", "中心水源", "山坡", "T3"], draw: drawBasin,
    },
    fjord: {
      title: "峡湾聚落", description: "深窄水体刺入山地，有限的缓岸与谷口让陆地走廊格外重要。", tags: ["深窄水体", "陡坡", "谷口", "T4"], draw: drawFjord,
    },
    peninsula: {
      title: "半岛聚落", description: "三面水体包围陆地，狭窄陆桥把外部连通与内部开阔地清晰分开。", tags: ["陆桥", "海岸", "淡水点", "T4"], draw: drawPeninsula,
    },
    island: {
      title: "海岛聚落", description: "孤立陆块的淡水、植被与岸线共同构成一个紧凑而自足的世界轮廓。", tags: ["岛内淡水", "有限土地", "岸线", "T4+"], draw: drawIsland,
    },
    "desert-oasis": {
      title: "沙漠绿洲", description: "干旱裸地将视线推向唯一的泉池与绿洲植被，水源成为整个构图的中心。", tags: ["干旱地表", "泉池", "绿洲", "T3"], draw: drawDesertOasis,
    },
    "alluvial-fan": {
      title: "山前冲积扇", description: "山口出口向平原铺开扇形缓坡，浅沟与扇缘将用地划分为细密层次。", tags: ["扇形缓坡", "浅沟", "扇缘", "T3"], draw: drawAlluvialFan,
    },
    karst: {
      title: "喀斯特地貌", description: "岩丘、洼地与泉眼在石灰岩地表交错，形成清晰而克制的地表水去向。", tags: ["岩丘", "洼地", "泉眼", "T4"], draw: drawKarst,
    },
  };

  function seedFromInput() { return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number.parseInt(seedInput.value, 10) || 0)); }
  function hash(seed, value) { let n = (seed ^ Math.imul(value + 0x9e3779b9, 0x85ebca6b)) >>> 0; n ^= n >>> 16; n = Math.imul(n, 0x7feb352d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }
  function noise(seed, x, y) { return hash(seed, Math.imul(x, 92821) ^ Math.imul(y, 68917)); }
  function transformPoint(x, y) { return { x: (x - .5) * width * view.scale + width / 2 + view.x, y: (y - .5) * height * view.scale + height / 2 + view.y }; }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth; height = window.innerHeight;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); draw();
  }

  function draw() {
    const seed = seedFromInput();
    const template = templates[select.value];
    titleEl.textContent = template.title; descriptionEl.textContent = template.description;
    tagsEl.innerHTML = template.tags.map((tag) => `<span>${tag}</span>`).join("");
    if (useInGameLink) useInGameLink.href = `index.html?seed=${encodeURIComponent(String(seed))}`;
    ctx.clearRect(0, 0, width, height);
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#dceae7"); sky.addColorStop(1, "#c8ddd5");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
    ctx.save();
    const p = transformPoint(.5, .5); ctx.translate(p.x, p.y); ctx.scale(view.scale, view.scale); ctx.translate(-width / 2, -height / 2);
    template.draw(seed);
    addPaperGrain(seed);
    ctx.restore();
  }

  function polygon(points, fill, stroke = null, lineWidth = 1) {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height)); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
  }
  function ellipse(x, y, rx, ry, fill, stroke = null) { ctx.beginPath(); ctx.ellipse(x * width, y * height, rx * width, ry * height, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); } }
  function path(points, color, lineWidth, alpha = 1) { ctx.save(); ctx.globalAlpha = alpha; ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height)); ctx.strokeStyle = color; ctx.lineWidth = lineWidth * Math.min(width, height); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(); ctx.restore(); }
  function land(fill = "#9eb875") { ctx.fillStyle = fill; ctx.fillRect(0, 0, width, height); }
  function hills(seed, amount = 36, palette = ["#7e9d68", "#91ad6d", "#b0bf79"], x0 = .05, x1 = .95, y0 = .1, y1 = .9) {
    for (let i = 0; i < amount; i++) { const x = x0 + hash(seed, i * 7 + 4) * (x1 - x0); const y = y0 + hash(seed, i * 11 + 5) * (y1 - y0); ellipse(x, y, .025 + hash(seed, i * 13) * .06, .012 + hash(seed, i * 17) * .03, palette[i % palette.length]); }
  }
  function trees(seed, amount, x0 = .05, x1 = .95, y0 = .1, y1 = .9) {
    for (let i = 0; i < amount; i++) { const x = x0 + hash(seed, 300 + i * 3) * (x1 - x0); const y = y0 + hash(seed, 700 + i * 5) * (y1 - y0); const r = .004 + hash(seed, 900 + i) * .009; ellipse(x, y, r, r * .72, i % 3 ? "#4c805a" : "#5f925e"); }
  }
  function waterPath(points, widthFactor = .04, color = "#5f9fba") { path(points, color, widthFactor, 1); path(points, "rgba(223,246,244,.55)", widthFactor * .12, 1); }
  function addPaperGrain(seed) { ctx.save(); ctx.globalAlpha = .08; for (let i = 0; i < 400; i++) { const x = hash(seed, i + 8000) * width; const y = hash(seed, i + 9000) * height; ctx.fillStyle = i % 2 ? "#1a3a31" : "#f7f4dd"; ctx.fillRect(x, y, 1, 1); } ctx.restore(); }

  function drawRiverValley(seed) { land("#a9bd79"); hills(seed, 48); waterPath([[.08,.16],[.2,.26],[.32,.37],[.43,.48],[.58,.56],[.75,.65],[.94,.78]], .075); waterPath([[.43,.48],[.53,.45],[.65,.39]], .018, "#77b2c5"); trees(seed, 80, .08, .9, .12, .85); }
  function drawPlateau(seed) { land("#a8bb77"); polygon([[.12,.19],[.72,.12],[.88,.3],[.78,.55],[.68,.68],[.22,.66],[.08,.48]], "#b9c87d", "#738b61", 2); polygon([[.12,.19],[.72,.12],[.77,.19],[.2,.29]], "#cad487"); path([[.14,.49],[.26,.55],[.47,.58],[.68,.62],[.82,.74]], "#7e8f65", .01); waterPath([[.84,.75],[.75,.77],[.65,.81]], .025); hills(seed, 22, ["#7d9564", "#93a86b"], .05,.96,.7,.96); trees(seed, 50,.18,.75,.2,.62); }
  function drawDelta(seed) { land("#b8c57d"); const base = [[.08,.08],[.22,.21],[.4,.37],[.51,.54],[.56,.71],[.65,.9]]; waterPath(base,.055); for (let i=0;i<5;i++) { const pivot = .45 + i*.045; waterPath([[.51,pivot],[.68,.54+i*.08],[.86,.5+i*.09],[.98,.49+i*.1]], .02 + (i%2)*.006, "#6ca8bd"); } for(let i=0;i<28;i++) ellipse(.52+hash(seed,i)*.42,.36+hash(seed,100+i)*.55,.012,.007,"#8fa46d"); trees(seed,70,.35,.88,.45,.9); }
  function drawBay(seed) { ctx.fillStyle="#5b9fba"; ctx.fillRect(0,0,width,height); polygon([[0,0],[.48,0],[.39,.14],[.31,.24],[.32,.42],[.45,.53],[.55,.73],[.51,1],[0,1]],"#aabc79"); polygon([[1,0],[.68,0],[.67,.2],[.74,.36],[.68,.57],[.77,.78],[.69,1],[1,1]],"#a7b978"); hills(seed,35,["#779166","#90a96c"],.03,.37,.08,.92); hills(seed+7,27,["#779166","#90a96c"],.7,.96,.1,.9); path([[.12,.24],[.25,.33],[.31,.43],[.39,.53],[.5,.62]],"#d6ca8d",.008,.8); trees(seed,50,.05,.32,.1,.9); }
  function drawBasin(seed) { land("#b1bd77"); for(let i=0;i<9;i++){ ctx.beginPath(); ctx.ellipse(width*.5,height*.5,width*(.43-i*.038),height*(.38-i*.034),0,0,Math.PI*2); ctx.strokeStyle=i%2?"#90a369":"#84955f";ctx.lineWidth=4;ctx.stroke(); } ellipse(.5,.52,.1,.075,"#6eabc0"); ellipse(.5,.52,.055,.038,"#b0d06f"); trees(seed,85,.39,.61,.42,.62); hills(seed,35,["#758e63","#8ca568"],.03,.97,.05,.95); }
  function drawFjord(seed) { land("#8fae71"); hills(seed,65,["#6e895f","#7e9b65","#97ad6b"]); waterPath([[.52,1.02],[.48,.83],[.54,.68],[.43,.51],[.51,.35],[.46,.16],[.5,-.05]],.13,"#568eab"); waterPath([[.49,.67],[.72,.62],[.92,.68]],.033,"#568eab"); trees(seed,55,.06,.93,.08,.92); }
  function drawPeninsula(seed) { ctx.fillStyle="#5d9fba";ctx.fillRect(0,0,width,height); polygon([[.15,.1],[.64,.12],[.83,.29],[.77,.51],[.92,.78],[.68,.91],[.36,.86],[.25,.68],[.1,.58]],"#acbd78"); polygon([[0,.4],[.19,.44],[.25,.68],[.1,.58],[0,.61]],"#8cae72"); hills(seed,35,["#7e9762","#95ad6c"],.18,.86,.15,.86); ellipse(.53,.46,.035,.025,"#6daac0"); trees(seed,72,.22,.8,.18,.83); }
  function drawIsland(seed) { ctx.fillStyle="#5e9fba";ctx.fillRect(0,0,width,height); polygon([[.28,.18],[.56,.11],[.76,.29],[.81,.54],[.68,.77],[.41,.84],[.19,.65],[.15,.39]],"#aabd78","#e0e6c2",2); hills(seed,42,["#748e60","#8da669"],.22,.75,.2,.78); ellipse(.51,.48,.05,.034,"#72adc0"); trees(seed,90,.24,.74,.2,.8); }
  function drawDesertOasis(seed) { land("#dcc68a"); for(let i=0;i<45;i++) path([[hash(seed,i)*1.1-.05,hash(seed,200+i)*1.1-.05],[hash(seed,400+i)*1.1-.05,hash(seed,600+i)*1.1-.05]],"rgba(177,139,74,.22)",.001); ellipse(.54,.5,.105,.065,"#6da9bd"); ellipse(.54,.5,.16,.105,"#88a966"); trees(seed,140,.42,.65,.4,.61); hills(seed,30,["#c2a963","#d4bc73"],.05,.94,.05,.94); }
  function drawAlluvialFan(seed) { land("#b8bd79"); polygon([[0,.03],[.3,.04],[.43,.38],[.89,.83],[.8,1],[0,1]],"#7f9864"); for(let i=0;i<12;i++) waterPath([[.31,.1+i*.015],[.43,.38],[.58+i*.035,.72],[.65+i*.02,.98]],.008,"#85b4bd"); path([[.26,.06],[.38,.3],[.52,.57],[.78,.9]],"#d2c28a",.013,.8); hills(seed,28,["#91a76b","#a9b775"],.38,.95,.48,.95); trees(seed,55,.42,.88,.42,.9); }
  function drawKarst(seed) { land("#a7bb78"); for(let i=0;i<47;i++){const x=.08+hash(seed,20+i)*.84,y=.1+hash(seed,220+i)*.78;ellipse(x,y,.015+hash(seed,420+i)*.024,.02+hash(seed,620+i)*.04,i%3?"#788e62":"#657d5b"); if(i%5===0) ellipse(x+.01,y+.015,.012,.009,"#6c9eb0");} trees(seed,75,.07,.94,.1,.9); ellipse(.52,.53,.055,.038,"#6facc0"); }

  select.addEventListener("change", draw);
  seedInput.addEventListener("change", draw);
  rerollButton.addEventListener("click", () => { seedInput.value = String(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)); draw(); });
  window.addEventListener("resize", resize);
  canvas.addEventListener("pointerdown", (event) => { dragging = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener("pointermove", (event) => { if (!dragging) return; view.x = dragging.vx + event.clientX - dragging.x; view.y = dragging.vy + event.clientY - dragging.y; draw(); });
  canvas.addEventListener("pointerup", () => { dragging = null; });
  canvas.addEventListener("wheel", (event) => { event.preventDefault(); const next = Math.max(.6, Math.min(2.6, view.scale * (event.deltaY > 0 ? .9 : 1.1))); view.scale = next; draw(); }, { passive: false });
  window.addEventListener("keydown", (event) => { if (event.key.toLowerCase() === "r" && event.target.tagName !== "INPUT") rerollButton.click(); });
  resize();
})();
