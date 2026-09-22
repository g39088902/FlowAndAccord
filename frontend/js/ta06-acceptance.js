// === 植被观察台（TA-06 验收通过后转为长期调试工具）===
// 定位：纯表现层**调试工具**，服务植被（三乔木轮廓 + 三灌木变体）观察与调试。
//   不写模拟状态、不入存档、不消耗 WorldRng、不改变任何默认画面。
// 激活方式（二选一）：
//   1) 左下角「生态时钟与倍速控制台」→ 点击「🌿 植被观察台」按钮；
//   2) URL 携带 ?ta06=1（兼容旧验收链接，自动打开面板）。
// 零开销保证：未打开时本文件仅注册一个 toggle 函数，零 DOM、零帧循环、零定时器。
// 能力：
//   1) 季节锁定（春/夏/秋/冬季中，自动=随模拟）——渲染层覆盖 sim 季相字段的读取，
//      植被季相（SimTreeTint）与动态光照（SimLighting）、地形烘焙同时锁定；
//   2) 光向方位 0/90/180/270 热调 + 动态光开关（受光分离调试）；
//   3) 相机方位 / 俯角 / 缩放三档快捷位（四方位 × 两俯角 × 三景别）；
//   4) 6 变体样板植株一键飞往（seed 42 身份表，换世界后自动重选未遮罩株）；
//   5) 物种标注层：每株 Tree/Bush 头顶 DOM 标签（阔/疏/锥/灌/花/青 + id），
//      物种由 AccentModel.speciesOf(kind,id) 稳定派生，与画面同一来源。
// 依赖（index.html 末尾加载，均已就绪）：window.sim、全局词法 camera/w/h、
//   AccentModel、SimLighting、SIM_LIGHTING。
(function () {
  'use strict';
  const params = new URLSearchParams(window.location.search);

  let panel = null;
  let labelLayer = null;
  let inited = false;

  function init() {
    if (inited) return;
    inited = true;

    // ── seed 42 样板身份表（探针：world_create(0,764,42,20,4)；Tree40/Bush25，
    //    broad14/sparse12/conifer14、multiStem12/flowering8/lowEvergreen5，6 变体齐全）──
    // ★ 代表株均通过前端 S4-03 景观/保护区遮罩复核（LandscapeMask.accentHidden=false）：
    //    原点附近为 POI/营地保护区，离原点最近的株（如 #65/#70 花灌木）虽在装饰数组中但
    //    被遮罩不渲染，不能作为视觉样板——下表为各变体「未遮罩且距原点最近」株，坐标
    //    仅作后备，飞往时以 sim.terrain.accents 实时值为准（换世界/LOAD 后自动重选）。
    const REPS = [
      { kind: 'Tree', sil: 'broad',       tag: '阔', name: '阔冠落叶', id: 3,  x: -4.3,   y: -126.2, z: -3.0 },
      { kind: 'Tree', sil: 'sparse',      tag: '疏', name: '疏冠落叶', id: 22, x: 106.6,  y: -122.6, z: -4.7 },
      { kind: 'Tree', sil: 'conifer',     tag: '锥', name: '锥形常绿', id: 8,  x: 25.1,   y: 218.2,  z: 5.0 },
      { kind: 'Bush', sil: 'multiStem',   tag: '灌', name: '落叶多茎', id: 67, x: -98.5,  y: 102.9,  z: 4.1 },
      { kind: 'Bush', sil: 'flowering',   tag: '花', name: '花灌木',   id: 72, x: -14.4,  y: -164.5, z: -3.8 },
      { kind: 'Bush', sil: 'flowering',   tag: '花', name: '花灌木②',  id: 80, x: 163.0,  y: 87.9,   z: -0.4 },
      { kind: 'Bush', sil: 'lowEvergreen',tag: '青', name: '低矮常绿', id: 74, x: -17.0,  y: 82.2,   z: 2.3 },
    ];
    const TAG_COLOR = {
      broad: '#9ccc65', sparse: '#d4e157', conifer: '#26a69a',
      multiStem: '#ffb74d', flowering: '#f48fb1', lowEvergreen: '#4db6ac',
    };
    const SEASON_KEYS = ['Spring', 'Summer', 'Autumn', 'Winter'];
    const SEASON_CN = { Spring: '春', Summer: '夏', Autumn: '秋', Winter: '冬', auto: '自动' };

    const cam = () => (typeof camera !== 'undefined' ? camera : null);
    const sim = () => window.sim;
    const SL = () => window.SimLighting;
    const AM = () => window.AccentModel;

    // ── DOM：面板 ────────────────────────────────────────────────────────────
    const css = `
      .ta06-panel{position:fixed;left:8px;top:52px;z-index:2000;width:248px;max-height:calc(100vh - 64px);overflow-y:auto;
        background:rgba(15,23,42,.92);color:#e2e8f0;font:12px/1.45 -apple-system,'PingFang SC',sans-serif;
        border:1px solid #334155;border-radius:8px;padding:8px 9px;box-shadow:0 4px 18px rgba(0,0,0,.45);}
      .ta06-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:5px 0;}
      .ta06-cap{width:100%;color:#94a3b8;font-size:10px;font-weight:700;letter-spacing:.5px;}
      .ta06-btn{background:#1e293b;color:#cbd5e1;border:1px solid #475569;border-radius:5px;padding:2px 7px;cursor:pointer;font-size:11px;}
      .ta06-btn:hover{background:#334155;color:#fff;}
      .ta06-btn.on{background:#0f766e;border-color:#2dd4bf;color:#ecfeff;font-weight:700;}
      .ta06-btn.rep{padding:2px 6px;}
      .ta06-head{display:flex;justify-content:space-between;align-items:center;font-weight:700;color:#5eead4;font-size:12px;margin-bottom:4px;}
      .ta06-min{cursor:pointer;padding:0 6px;border:1px solid #475569;border-radius:5px;background:#1e293b;color:#cbd5e1;}
      .ta06-read{margin-top:6px;padding-top:6px;border-top:1px dashed #334155;color:#7dd3fc;font-size:10.5px;line-height:1.6;word-break:break-all;white-space:pre-line;}
      .ta06-label{position:absolute;white-space:nowrap;pointer-events:none;font-size:10px;font-weight:700;line-height:1;
        padding:1px 4px;border-radius:7px;background:rgba(8,15,30,.72);border:1px solid;transform:translate(-50%,-100%);}
      .ta06-chk{display:flex;align-items:center;gap:4px;cursor:pointer;color:#cbd5e1;font-size:11px;}
      .ta06-collapsed{display:none;}`;
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    panel = document.createElement('div');
    panel.className = 'ta06-panel';
    panel.innerHTML =
      '<div class="ta06-head"><span>🌿 植被观察台</span><span class="ta06-min" id="ta06-min">−</span></div>' +
      '<div class="ta06-body" id="ta06-body">' +
        '<div class="ta06-row"><span class="ta06-cap">季节锁定（季中 u=0/.25/.5/.75）</span></div>' +
        '<div class="ta06-row" id="ta06-season">' +
          ['auto', 'Spring', 'Summer', 'Autumn', 'Winter'].map((k, i) =>
            '<button class="ta06-btn' + (k === 'auto' ? ' on' : '') + '" data-season="' + k + '">' +
            (k === 'auto' ? '自动' : SEASON_CN[k]) + '</button>').join('') + '</div>' +
        '<div class="ta06-row"><span class="ta06-cap">世界光向方位角（需动态光开）</span></div>' +
        '<div class="ta06-row" id="ta06-azim">' +
          [0, 90, 180, 270].map(a => '<button class="ta06-btn" data-az="' + a + '">' + a + '°</button>').join('') +
          '<label class="ta06-chk" style="margin-left:6px;"><input type="checkbox" id="ta06-dynlight">动态光</label></div>' +
        '<div class="ta06-row"><span class="ta06-cap">相机方位 rotZ / 俯角 rotX</span></div>' +
        '<div class="ta06-row" id="ta06-rotz">' +
          [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']].map(([a, t]) =>
            '<button class="ta06-btn" data-rotz="' + a + '">' + t + '</button>').join('') +
          '<span style="margin-left:8px;"></span>' +
          [[0.72, '缓'], [1.05, '标'], [1.30, '陡']].map(([a, t]) =>
            '<button class="ta06-btn" data-rotx="' + a + '">' + t + '</button>').join('') + '</div>' +
        '<div class="ta06-row"><span class="ta06-cap">缩放档位（LOD：远/中/近/特写）</span></div>' +
        '<div class="ta06-row" id="ta06-zoom">' +
          [[0.6, '远 0.6'], [1.6, '中 1.6'], [3.0, '近 3'], [6.0, '特写 6']].map(([z, t]) =>
            '<button class="ta06-btn" data-zoom="' + z + '">' + t + '</button>').join('') + '</div>' +
        '<div class="ta06-row"><span class="ta06-cap">6 变体样板（点击飞往，自动近景档）</span></div>' +
        '<div class="ta06-row" id="ta06-reps">' +
          REPS.map((r, i) => '<button class="ta06-btn rep" data-rep="' + i + '" style="color:' + TAG_COLOR[r.sil] + ';">' +
            r.tag + '#' + r.id + '</button>').join('') + '</div>' +
        '<div class="ta06-row"><label class="ta06-chk"><input type="checkbox" id="ta06-labels" checked>物种标注（阔/疏/锥 · 灌/花/青）</label></div>' +
        '<div class="ta06-read" id="ta06-read">读数初始化中…</div>' +
      '</div>';
    document.body.appendChild(panel);
    document.getElementById('ta06-min').addEventListener('click', () => {
      document.getElementById('ta06-body').classList.toggle('ta06-collapsed');
      document.getElementById('ta06-min').textContent =
        document.getElementById('ta06-body').classList.contains('ta06-collapsed') ? '+' : '−';
    });

    // ── 季节锁定：accessor 覆盖主线程 sim 的季相字段读取（渲染层专用，不回传 Worker）──
    let seasonHooked = false;
    let lockSeason = null; // null = 自动；否则 { season, progress }
    function applySeasonHook() {
      const s = sim();
      if (!s || seasonHooked) return;
      // 缓存当前真实值（快照后续写入也始终更新缓存）；锁定时 getter 返回 lockSeason
      s.__ta06_currentSeason = s.currentSeason;
      s.__ta06_seasonProgress = s.seasonProgress;
      const accessor = key => ({
        configurable: true, enumerable: true,
        get() { return lockSeason ? lockSeason[key] : s['__ta06_' + key]; },
        set(v) { s['__ta06_' + key] = v; },
      });
      Object.defineProperty(s, 'currentSeason', accessor('currentSeason'));
      Object.defineProperty(s, 'seasonProgress', accessor('seasonProgress'));
      seasonHooked = true;
    }
    function setSeason(key) {
      const s = sim();
      if (!s) return;
      if (key === 'auto') {
        lockSeason = null;
        if (seasonHooked) {
          // 恢复为普通数据属性，值取最近一次快照写入的缓存，下一帧 Worker 快照即刷成真实值
          try {
            delete s.currentSeason; delete s.seasonProgress;
            Object.defineProperty(s, 'currentSeason', { configurable: true, enumerable: true, writable: true, value: s.__ta06_currentSeason });
            Object.defineProperty(s, 'seasonProgress', { configurable: true, enumerable: true, writable: true, value: s.__ta06_seasonProgress });
          } catch (_) {}
          seasonHooked = false;
        }
      } else {
        if (!seasonHooked) applySeasonHook();
        lockSeason = { currentSeason: key, seasonProgress: 0.5 };
      }
      const L = SL();
      if (L) { L.resync(); L.markDirty(); }
      document.querySelectorAll('#ta06-season .ta06-btn').forEach(b =>
        b.classList.toggle('on', b.dataset.season === key));
    }
    panel.querySelectorAll('#ta06-season .ta06-btn').forEach(b =>
      b.addEventListener('click', () => setSeason(b.dataset.season)));

    // ── 光向 ──
    function setAzimuth(deg) {
      const cfg = window.SIM_LIGHTING;
      if (!cfg) return;
      cfg.enabled = true;
      cfg.azimuthOffsetDeg = deg;
      const native = document.getElementById('chk-dynamic-light');
      if (native) native.checked = true;
      const L = SL();
      if (L) { L.resync(); L.markDirty(); }
      document.getElementById('ta06-dynlight').checked = true;
    }
    panel.querySelectorAll('#ta06-azim .ta06-btn').forEach(b =>
      b.addEventListener('click', () => setAzimuth(Number(b.dataset.az))));
    const dynChk = document.getElementById('ta06-dynlight');
    dynChk.checked = !!(window.SIM_LIGHTING && window.SIM_LIGHTING.enabled);
    dynChk.addEventListener('change', e => {
      if (window.SIM_LIGHTING) window.SIM_LIGHTING.enabled = e.target.checked;
      const native = document.getElementById('chk-dynamic-light');
      if (native) native.checked = e.target.checked;
      const L = SL();
      if (L) { L.resync(); L.markDirty(); }
    });

    // ── 相机 ──
    function flyTo(x, y, z, zoom) {
      const c = cam(); if (!c) return;
      if (zoom) c.zoom = zoom;
      const cosZ = Math.cos(c.rotZ), sinZ = Math.sin(c.rotZ);
      const cosX = Math.cos(c.rotX), sinX = Math.sin(c.rotX);
      const rx = x * cosZ - y * sinZ;
      const ry = x * sinZ + y * cosZ;
      c.panX = -rx * c.zoom;
      c.panY = -(ry * cosX - z * sinX) * c.zoom;
    }
    panel.querySelectorAll('#ta06-rotz .ta06-btn[data-rotz]').forEach(b =>
      b.addEventListener('click', () => { const c = cam(); if (c) c.rotZ = Number(b.dataset.rotz) * Math.PI / 180; }));
    panel.querySelectorAll('#ta06-rotx .ta06-btn[data-rotx]').forEach(b =>
      b.addEventListener('click', () => { const c = cam(); if (c) c.rotX = Number(b.dataset.rotx); }));
    panel.querySelectorAll('#ta06-zoom .ta06-btn').forEach(b =>
      b.addEventListener('click', () => { const c = cam(); if (c) c.zoom = Number(b.dataset.zoom); }));
    // ── 样板株解析：实时取装饰对象；身份表植株被遮罩/不存在（换世界、LOAD）时，
    //    自动改飞同变体最近的未遮罩株（与深度队列入队口径一致：accentHidden 不渲染）──
    function isHidden(a) {
      try { const LM = window.LandscapeMask; return LM && LM.accentHidden ? !!LM.accentHidden(a) : false; }
      catch (e) { return false; }
    }
    function findAccent(kind, id) {
      const s = sim(); const arr = s && s.terrain && s.terrain.accents;
      return arr ? arr.find(a => a.kind === kind && a.id === id) : null;
    }
    function findVisibleRep(r) {
      const a = findAccent(r.kind, r.id);
      if (a && !isHidden(a)) return a;
      const s = sim(); const arr = (s && s.terrain && s.terrain.accents) || [];
      const AM0 = AM();
      let best = null, bd = Infinity;
      for (const x of arr) {
        if (x.kind !== r.kind) continue;
        const sp = AM0 ? AM0.speciesOf(x.kind, x.id) : null;
        if (!sp || sp.silhouette !== r.sil || isHidden(x)) continue;
        const d = Math.hypot(x.x, x.y);
        if (d < bd) { bd = d; best = x; }
      }
      return best;
    }
    let flyMsg = '';
    panel.querySelectorAll('#ta06-reps .ta06-btn').forEach(b =>
      b.addEventListener('click', () => {
        const r = REPS[Number(b.dataset.rep)];
        const a = findVisibleRep(r);
        if (!a) { flyMsg = '未找到可见的 ' + r.name + '（可能被景观遮罩且无替代）'; return; }
        const m = AM() ? AM().get(a) : null;
        const lift = m && m.bounds && Number.isFinite(m.bounds.zMax) ? m.bounds.zMax * 0.45
          : (a.kind === 'Tree' ? 4 : 1.8);
        flyTo(a.x, a.y, (a.z || 0) + lift, 3.0);
        flyMsg = '已飞往 ' + r.tag + '#' + a.id + (a.id !== r.id ? '（身份表#' + r.id + '被遮罩，自动替代）' : '');
      }));

    // ── 物种标注层 ──
    labelLayer = document.createElement('div');
    labelLayer.id = 'ta06-label-layer';
    labelLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1999;overflow:hidden;';
    document.body.appendChild(labelLayer);
    let labelsOn = true;
    let labelAccentsRef = null;
    let labelEls = [];
    document.getElementById('ta06-labels').addEventListener('change', e => {
      labelsOn = e.target.checked;
      labelLayer.style.display = labelsOn ? 'block' : 'none';
    });

    function rebuildLabels(accents) {
      labelLayer.innerHTML = '';
      labelEls = [];
      for (const a of accents) {
        if (a.kind !== 'Tree' && a.kind !== 'Bush') continue;
        // 与深度队列入队口径一致：被 S4-03 景观/保护区遮罩的装饰不渲染，标签同步隐藏
        if (isHidden(a)) continue;
        const sp = AM() ? AM().speciesOf(a.kind, a.id) : null;
        const sil = sp ? sp.silhouette : (a.kind === 'Tree' ? 'broad' : 'multiStem');
        const rep = REPS.find(r => r.id === a.id && r.kind === a.kind);
        const el = document.createElement('div');
        el.className = 'ta06-label';
        const tag = a.kind === 'Tree'
          ? { broad: '阔', sparse: '疏', conifer: '锥' }[sil]
          : { multiStem: '灌', flowering: '花', lowEvergreen: '青' }[sil];
        el.textContent = tag + '#' + a.id + (rep ? '★' : '');
        el.style.color = TAG_COLOR[sil];
        el.style.borderColor = TAG_COLOR[sil];
        labelLayer.appendChild(el);
        labelEls.push({ el, a, model: AM() ? AM().get(a) : null });
      }
      labelAccentsRef = accents;
    }

    function frame() {
      requestAnimationFrame(frame);
      if (!panel || panel.style.display === 'none') return;
      const s = sim(), c = cam();
      if (!s || !c) return;
      const terrain = s.terrain;
      const accents = terrain && terrain.accents;
      if (labelsOn && accents && accents !== labelAccentsRef && AM()) rebuildLabels(accents);
      const W = (typeof w !== 'undefined' ? w : window.innerWidth);
      const H = (typeof h !== 'undefined' ? h : window.innerHeight);
      const cosZ = Math.cos(c.rotZ), sinZ = Math.sin(c.rotZ);
      const cosX = Math.cos(c.rotX), sinX = Math.sin(c.rotX);
      for (const { el, a, model } of labelEls) {
        const lift = model && model.bounds && Number.isFinite(model.bounds.zMax) ? model.bounds.zMax + 0.6
          : (a.kind === 'Tree' ? 7 : 3);
        const rx = a.x * cosZ - a.y * sinZ;
        const ry = a.x * sinZ + a.y * cosZ;
        const sx = W / 2 + c.panX + rx * c.zoom;
        const sy = H / 2 + c.panY + (ry * cosX - ((a.z || 0) + lift) * sinX) * c.zoom;
        // 远景过密时淡出；视口外隐藏
        const inView = sx > -30 && sx < W + 30 && sy > -30 && sy < H + 30;
        el.style.display = inView ? 'block' : 'none';
        el.style.opacity = c.zoom < 0.8 ? String(Math.max(0.15, (c.zoom - 0.4) / 0.4)) : '1';
        el.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) translate(-50%,-100%)';
      }
    }
    requestAnimationFrame(frame);

    // ── 读数行（4Hz）──
    const readEl = document.getElementById('ta06-read');
    setInterval(() => {
      if (!panel || panel.style.display === 'none') return;
      const s = sim(), c = cam(), L = SL();
      if (!s || !c) { readEl.textContent = '等待世界载入…'; return; }
      const season = lockSeason ? lockSeason.currentSeason : s.currentSeason;
      const prog = lockSeason ? lockSeason.seasonProgress : s.seasonProgress;
      let u = '';
      if (window.SimTreeTint) u = window.SimTreeTint.yearPhase(s).toFixed(3);
      const az = L ? L.azimuthDeg().toFixed(0) + '°/仰' + L.elevationDeg().toFixed(0) + '°' : '—';
      const inScene = labelEls.filter(l => l.el.style.display === 'block').length;
      readEl.textContent =
        (flyMsg ? '🎯 ' + flyMsg + '\n' : '') +
        '季节 ' + (SEASON_CN[season] || season) + ' ' + ((prog * 100).toFixed(0)) + '%  u=' + u +
        ' ｜ zoom ' + c.zoom.toFixed(2) +
        ' ｜ rotZ ' + ((c.rotZ * 180 / Math.PI) % 360).toFixed(0) + '°' +
        ' ｜ 光向 ' + az +
        ' ｜ 视口内植被 ' + inScene + '/' + labelEls.length;
    }, 250);

    console.log('%c[植被观察台] 已打开。季节/光向/机位/标注见左上角面板；' +
      '控制台可用 window.sim / AccentModel.speciesOf(kind,id)。', 'color:#2dd4bf');
  }

  // ── 公开 toggle（左下角控制台按钮与 ?ta06=1 共用）──
  window.__vegPanelToggle = function () {
    if (!inited) { init(); return true; } // 首次默认显示
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';
    if (labelLayer) labelLayer.style.display = visible ? 'none' : 'block';
    return !visible;
  };

  // 左下角控制台入口按钮
  const entryBtn = document.getElementById('btn-veg-observer');
  if (entryBtn) entryBtn.addEventListener('click', () => window.__vegPanelToggle());

  // ?ta06=1 兼容旧验收链接：自动打开
  if (params.has('ta06')) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => window.__vegPanelToggle());
    } else {
      window.__vegPanelToggle();
    }
  }
})();
