// ==========================================
// label-layout.js ★ S4-06 世界标签候选层与屏幕布局（STAGE-04-TODO §4.6）
// ==========================================
// 抽离世界画布文字入口 → 统一的「候选 → 字体测量 → 矩形 → 优先级 → 固定备选位置」布局层。
//
// 帧内三段式（挂载点 render_depth_queue.js::drawWorldEntities）：
//  ① beginFrame() 后收集阶段由 render_world.js::proposePoiLabels / proposeHouseLabels
//     与 render_agents.js::proposeAgentLabels 逐实体提交候选（锚点屏幕坐标 + 首选偏移 + 类别）；
//  ② list.sort() 之后、分发循环之前 resolve()：按 (优先级, 收集序) 稳定排序逐个安置——
//     · pinned（实体锚定标记：营地/资源图标、施工/流产/夺位角标）恒接受并占格（不省略不移位）；
//     · ordinary（可省略文字标签：营地名称/舍数、拍卖/修缮/房屋编号）依次尝试
//       [首选, 锚点镜像, 右, 左] 四个固定备选位——屏幕网格冲突检测 + UI 禁入矩形，
//       全部失败即省略（失败处理：普通标签无合法位置即省略，实体与信息面板访问保留）；
//  ③ 绘制阶段旧入口只消费 posOf(key) 的落位：普通标签仍在**实体深度**落笔，
//     地形遮挡行为保持不变（山后普通标签不透山）；布局关态（labelLayoutEnabled=false）
//     完整回退旧直接绘制路径。
//
// overlay（交互覆盖标签）单列通道 overlayPlace()：选中族人需求气泡在深度队列
// 之后强制安置绘制（不参与地形遮挡、不省略），尽量避开 UI 禁入矩形与已接受矩形，
// 全部失败则钳制回画布内的首选位。区分两类标签见 §4.6 第 3 条。
//
// 有界性：每标签候选 ≤4（固定备选位，非逐像素搜索）；每帧提案 ≤ labelMaxProposals
// （普通标签按收集序丢弃，pinned 天然受实体数约束）；网格单元 labelGridCellSize。
//
// 坐标口径：全部为 CSS px（= ctx 逻辑坐标；DPR 由 main.js::resizeCanvas 的
// setTransform(dpr) 承担，本层不感知 DPR）；缩放/旋转/平移由调用方逐帧重投影锚点，
// resize 由每帧传入的 w/h + UI 矩形重测（labelUiRefreshFrames 帧间隔或 resize 标记）适配。
window.LabelLayout = (function () {
  const RC = window.RENDER_CONFIG || {};

  // ---- 提案池（平行数组逐帧覆写，稳态零分配）----
  const MAXP = 512;
  const _pKey = new Float64Array(MAXP);   // 实体稳定键 = id * 16 + 槽位（poi 0..3 / house 4..6 / agent 7..9）
  const _pPri = new Float64Array(MAXP);   // 优先级：小者先安置
  const _pAx = new Float64Array(MAXP);    // 锚点屏幕坐标
  const _pAy = new Float64Array(MAXP);
  const _pDx = new Float64Array(MAXP);    // 首选偏移（基线位 = 锚点 + 偏移；随 zoom 缩放由调用方算好）
  const _pDy = new Float64Array(MAXP);
  const _pCat = new Uint8Array(MAXP);     // 0 = pinned / 1 = ordinary
  const _pText = new Array(MAXP);         // 字符串引用（不复制）
  const _pFont = new Array(MAXP);
  let _pN = 0;
  let _pDropped = 0;                      // 超出提案上限被丢弃的普通标签数

  // ---- 接受结果 ----
  const _plX = new Float64Array(MAXP);    // 已接受基线位
  const _plY = new Float64Array(MAXP);
  const _rX = new Float64Array(MAXP);     // 已接受矩形（含 pad）
  const _rY = new Float64Array(MAXP);
  const _rW = new Float64Array(MAXP);
  const _rH = new Float64Array(MAXP);
  const _placeMap = new Map();            // key → 提案下标（接受者才有）
  const _order = new Array(MAXP);
  let _statPinned = 0, _statAccepted = 0, _statOmitted = 0;

  // ---- 屏幕冲突网格（单元 → 矩形链表，Int32 头数组每帧重填）----
  let _gCols = 0, _gRows = 0, _gHead = null;
  const _gNext = new Int32Array(MAXP);    // 矩形下标 → 同单元下一矩形，-1 结束

  // ---- UI 禁入矩形（DOM 覆盖区，节流重测）----
  const UIMAX = 16;
  const _uiX = new Float64Array(UIMAX), _uiY = new Float64Array(UIMAX);
  const _uiW = new Float64Array(UIMAX), _uiH = new Float64Array(UIMAX);
  let _uiN = 0, _uiFrame = 0, _uiDirty = true;
  window.addEventListener('resize', function () { _uiDirty = true; });

  // ---- 字体测量缓存（font+text → 宽度；字体串含 px，缩放/字体变更自然换键）----
  const _mCache = new Map();
  const MEASURE_CAP = 2048;
  let _ctxRef = null;

  let _active = false;
  let _vw = 0, _vh = 0;

  function _cfg(name, dflt) {
    const v = RC[name];
    return v == null ? dflt : v;
  }

  function _measure(font, text) {
    const key = font + '\u0001' + text;
    let wv = _mCache.get(key);
    if (wv !== undefined) return wv;
    if (!_ctxRef) _ctxRef = document.getElementById('sim-canvas')
      ? document.getElementById('sim-canvas').getContext('2d') : null;
    if (!_ctxRef) return 0;
    _ctxRef.font = font;
    wv = _ctxRef.measureText(text).width;
    if (_mCache.size >= MEASURE_CAP) _mCache.clear();
    _mCache.set(key, wv);
    return wv;
  }

  // 字号解析（font 串 `… Npx …` → N；解析结果随键缓存省去重复正则）
  function _fontPx(font) {
    const i = font.indexOf('px');
    if (i < 0) return 12;
    let s = i - 1;
    while (s >= 0 && font.charCodeAt(s) >= 48 && font.charCodeAt(s) <= 57) s--;
    const v = parseFloat(font.slice(s + 1, i));
    return v > 0 ? v : 12;
  }

  // 矩形高度模型：emoji/符号独占文本用墨迹近似（0.72em 高、贴基线），
  // 文本用 0.85/0.35em 经典模型——emoji 字形墨迹远小于 asc+desc 全高，
  // 过大的图标框会系统性挤走按旧偏移贴图标排布的普通标签（S4-06 验收修正①）。
  const _reText = /[A-Za-z0-9\u00C0-\u02AF\u4E00-\u9FFF\u3040-\u30FF]/;
  function _boxPad() { return _cfg('labelRectPadPx', 2); }
  function _boxAscDesc(fp, text) {
    if (_reText.test(text)) return [fp * 0.85 + _boxPad(), fp * 0.35 + _boxPad()];
    return [fp * 0.72 + 1, fp * 0.10 + 1]; // emoji/图标墨迹框
  }

  function _refreshUiRects() {
    _uiN = 0;
    const ids = _cfg('labelUiRectIds', null);
    if (!ids) return;
    for (let i = 0; i < ids.length && _uiN < UIMAX; i++) {
      const el = document.getElementById(ids[i]);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue; // display:none / 折叠隐藏
      if (r.bottom <= 0 || r.top >= _vh || r.right <= 0 || r.left >= _vw) continue;
      _uiX[_uiN] = r.left; _uiY[_uiN] = r.top;
      _uiW[_uiN] = r.width; _uiH[_uiN] = r.height;
      _uiN++;
    }
  }

  function beginFrame(vw, vh) {
    _active = !!_cfg('labelLayoutEnabled', true);
    if (!_active) { _pN = 0; _placeMap.clear(); return; }
    _vw = vw; _vh = vh;
    _pN = 0; _pDropped = 0;
    _placeMap.clear();
    _statPinned = 0; _statAccepted = 0; _statOmitted = 0;

    const cell = _cfg('labelGridCellSize', 48);
    const cols = Math.max(1, Math.ceil(vw / cell) + 1);
    const rows = Math.max(1, Math.ceil(vh / cell) + 1);
    if (!_gHead || _gCols < cols || _gRows < rows) {
      _gCols = cols; _gRows = rows;
      _gHead = new Int32Array(cols * rows);
    }
    _gHead.fill(-1, 0, _gCols * _gRows);

    _uiFrame++;
    if (_uiDirty || _uiFrame % _cfg('labelUiRefreshFrames', 10) === 0) {
      _refreshUiRects();
      _uiDirty = false;
      _uiFrame = 0;
    }
  }

  // 收集阶段提交候选；pinned = 实体锚定标记（恒接受占格），否则为可省略普通标签。
  // 超出 labelMaxProposals 的普通标签按收集序丢弃（有界性）。
  function propose(key, pri, ax, ay, text, font, dx, dy, pinned) {
    if (!_active || _pN >= MAXP) return;
    if (!pinned && _pN >= _cfg('labelMaxProposals', 160)) { _pDropped++; return; }
    const i = _pN++;
    _pKey[i] = key; _pPri[i] = pri;
    _pAx[i] = ax; _pAy[i] = ay;
    _pDx[i] = dx; _pDy[i] = dy;
    _pCat[i] = pinned ? 0 : 1;
    _pText[i] = text; _pFont[i] = font;
  }

  function _rectOf(i, bx, by) {
    const tw = _measure(_pFont[i], _pText[i]);
    const ad = _boxAscDesc(_fontPx(_pFont[i]), _pText[i]);
    _rX[i] = bx - tw / 2 - 0; // 水平 pad 已含在测量对齐中；竖直方向由 asc/desc 携带
    _rY[i] = by - ad[0];
    _rW[i] = tw;
    _rH[i] = ad[0] + ad[1];
    return tw;
  }

  function _gridInsert(i) {
    const c = _cfg('labelGridCellSize', 48);
    const x0 = Math.max(0, (_rX[i] / c) | 0), x1 = Math.min(_gCols - 1, ((_rX[i] + _rW[i]) / c) | 0);
    const y0 = Math.max(0, (_rY[i] / c) | 0), y1 = Math.min(_gRows - 1, ((_rY[i] + _rH[i]) / c) | 0);
    for (let gy = y0; gy <= y1; gy++) {
      const rowOff = gy * _gCols;
      for (let gx = x0; gx <= x1; gx++) {
        const ci = rowOff + gx;
        _gNext[i] = _gHead[ci];
        _gHead[ci] = i;
      }
    }
  }

  // 候选矩形合法性：不完全出画布、不进 UI 禁入矩形、不与已接受矩形相交（网格加速）
  function _fits(i) {
    const x = _rX[i], y = _rY[i], wv = _rW[i], hv = _rH[i];
    if (x + wv <= 0 || x >= _vw || y + hv <= 0 || y >= _vh) return false;
    for (let u = 0; u < _uiN; u++) {
      if (x < _uiX[u] + _uiW[u] && x + wv > _uiX[u] &&
          y < _uiY[u] + _uiH[u] && y + hv > _uiY[u]) return false;
    }
    const c = _cfg('labelGridCellSize', 48);
    const x0 = Math.max(0, (x / c) | 0), x1 = Math.min(_gCols - 1, ((x + wv) / c) | 0);
    const y0 = Math.max(0, (y / c) | 0), y1 = Math.min(_gRows - 1, ((y + hv) / c) | 0);
    for (let gy = y0; gy <= y1; gy++) {
      const rowOff = gy * _gCols;
      for (let gx = x0; gx <= x1; gx++) {
        let r = _gHead[rowOff + gx];
        while (r >= 0) {
          if (x < _rX[r] + _rW[r] && x + wv > _rX[r] &&
              y < _rY[r] + _rH[r] && y + hv > _rY[r]) return false;
          r = _gNext[r];
        }
      }
    }
    return true;
  }

  function _accept(i, bx, by) {
    _rectOf(i, bx, by);
    _plX[i] = bx; _plY[i] = by;
    _placeMap.set(_pKey[i], i);
    _gridInsert(i);
  }

  function resolve() {
    if (!_active) return;
    const n = _pN;
    for (let i = 0; i < n; i++) _order[i] = i;
    // 稳定双键排序：优先级升序，其次收集序（Array.sort 自稳，固定输入下接受顺序确定）
    const pri = _pPri;
    _order.length = n;
    _order.sort(function (a, b) { return pri[a] - pri[b] || a - b; });

    const sidePad = _cfg('labelSidePadPx', 10);
    for (let oi = 0; oi < n; oi++) {
      const i = _order[oi];
      if (_pCat[i] === 0) { // pinned：恒接受于首选位（占格供普通标签避让）
        _accept(i, _pAx[i] + _pDx[i], _pAy[i] + _pDy[i]);
        _statPinned++; _statAccepted++;
        continue;
      }
      const ax = _pAx[i], ay = _pAy[i], dx = _pDx[i], dy = _pDy[i];
      // 固定备选位：首选 → 锚点镜像 → 首选同排右 → 首选同排左（每标签 ≤4 候选，候选数有界）。
      // 左右备选与首选同一基线行——锚点处常有 pinned 图标占格，贴锚点左右必然撞图标框
      // （S4-06 验收修正②）；同排横移等价于「首选位被占时向两侧让一步」。
      const bx0 = ax + dx, by0 = ay + dy;
      let ok = false;
      _rectOf(i, bx0, by0);
      if (_fits(i)) { _acceptAt(i, bx0, by0); ok = true; }
      if (!ok) {
        const bx1 = ax - dx, by1 = ay - dy;
        _rectOf(i, bx1, by1);
        if (_fits(i)) { _acceptAt(i, bx1, by1); ok = true; }
      }
      if (!ok) {
        const bx2 = ax + dx + _rW[i] / 2 + sidePad;
        _rectOf(i, bx2, by0);
        if (_fits(i)) { _acceptAt(i, bx2, by0); ok = true; }
      }
      if (!ok) {
        const bx3 = ax + dx - _rW[i] / 2 - sidePad;
        _rectOf(i, bx3, by0);
        if (_fits(i)) { _acceptAt(i, bx3, by0); ok = true; }
      }
      if (ok) _statAccepted++; else _statOmitted++;
    }
  }

  function _acceptAt(i, bx, by) {
    _plX[i] = bx; _plY[i] = by;
    _placeMap.set(_pKey[i], i);
    _gridInsert(i);
  }

  // 绘制阶段查询：key 已接受 → 写 out.x/out.y（文字基线位，textAlign center 语义）并返回 true；
  // 未接受（被省略/未被提案/布局关态）→ 返回 false，调用方跳过该文字（关态走旧直接绘制路径）。
  function posOf(key, out) {
    const i = _placeMap.get(key);
    if (i === undefined) return false;
    out.x = _plX[i]; out.y = _plY[i];
    return true;
  }

  // overlay 通道（交互覆盖标签）：强制安置、不省略。依次尝试首选/镜像/首选同排右/左，
  // 全部避开 UI 矩形与已接受矩形失败后钳制回画布内的首选位；矩形不占网格（避免与后续无交互）。
  function overlayPlace(key, ax, ay, text, font, prefDy, out) {
    if (!_active) return false;
    const ad = _boxAscDesc(_fontPx(font), text);
    const tw = _measure(font, text);
    const sidePad = _cfg('labelSidePadPx', 10);
    const by0 = ay + prefDy;
    const cl = [
      [ax, by0],
      [ax, ay - prefDy],
      [ax + tw / 2 + sidePad, by0],
      [ax - tw / 2 - sidePad, by0]
    ];
    let bx = 0, by = 0;
    for (let k = 0; k < 4; k++) {
      bx = Math.min(Math.max(cl[k][0], tw / 2 + 2), _vw - tw / 2 - 2);
      by = Math.min(Math.max(cl[k][1], ad[0]), _vh - ad[1]);
      if (bx === cl[k][0] && by === cl[k][1] && _overlayFits(bx, by, tw, ad[0], ad[1])) break;
    }
    out.x = bx; out.y = by;
    return true;
  }

  function _overlayFits(x, y, wv, asc, desc) {
    const rY = y - asc, rH = asc + desc;
    for (let u = 0; u < _uiN; u++) {
      if (x - wv / 2 < _uiX[u] + _uiW[u] && x + wv / 2 > _uiX[u] &&
          rY < _uiY[u] + _uiH[u] && rY + rH > _uiY[u]) return false;
    }
    const c = _cfg('labelGridCellSize', 48);
    const x0 = Math.max(0, ((x - wv / 2) / c) | 0), x1 = Math.min(_gCols - 1, ((x + wv / 2) / c) | 0);
    const y0 = Math.max(0, (rY / c) | 0), y1 = Math.min(_gRows - 1, ((rY + rH) / c) | 0);
    for (let gy = y0; gy <= y1; gy++) {
      const rowOff = gy * _gCols;
      for (let gx = x0; gx <= x1; gx++) {
        let r = _gHead[rowOff + gx];
        while (r >= 0) {
          if (x - wv / 2 < _rX[r] + _rW[r] && x + wv / 2 > _rX[r] &&
              rY < _rY[r] + _rH[r] && rY + rH > _rY[r]) return false;
          r = _gNext[r];
        }
      }
    }
    return true;
  }

  // 诊断/临时断言入口（开发与验收用；每帧调用会分配快照数组，热路径禁用）
  function stats() {
    return { proposed: _pN, accepted: _statAccepted, pinned: _statPinned,
             omitted: _statOmitted, dropped: _pDropped };
  }
  function debugRects() { // 已接受普通标签矩形快照（不含 pinned）
    const out = [];
    for (const [k, i] of _placeMap) {
      if (_pCat[i] !== 0) out.push({ key: k, x: _rX[i], y: _rY[i], w: _rW[i], h: _rH[i] });
    }
    return out;
  }
  function debugUiRects() {
    const out = [];
    for (let u = 0; u < _uiN; u++) out.push({ x: _uiX[u], y: _uiY[u], w: _uiW[u], h: _uiH[u] });
    return out;
  }
  function resetCache() { _mCache.clear(); _uiDirty = true; }

  return {
    beginFrame: beginFrame,
    propose: propose,
    resolve: resolve,
    posOf: posOf,
    overlayPlace: overlayPlace,
    active: function () { return _active; },
    stats: stats,
    debugRects: debugRects,
    debugUiRects: debugUiRects,
    resetCache: resetCache,
    // 键位规划（与绘制侧共用，写死避免漂移）：poi 槽 0..3、house 4..6、agent 7..9
    KEY_POI_ICON: 0, KEY_POI_NAME: 1, KEY_POI_COUNT: 2, KEY_RES_ICON: 3,
    KEY_HOUSE_AUCTION: 4, KEY_HOUSE_REPAIR: 5, KEY_HOUSE_NUM: 6,
    KEY_AGENT_BUILD: 7, KEY_AGENT_MISC: 8, KEY_AGENT_EXPED: 9
  };
})();
