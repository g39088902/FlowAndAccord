// ==========================================
// label-layout.js ★ S4-06 / S4-07 世界标签候选层、聚合与屏幕交互布局
// ==========================================
// 抽离世界画布文字入口 → 统一的「候选 → 字体测量 → 矩形 → 优先级 → 固定备选位置」布局层。
//
// 帧内流水线（挂载点 render_depth_queue.js::drawWorldEntities）：
//  ① beginFrame() 重置提案池/网格/UI 矩形/聚合结果/兜底槽位；
//  ② 收集阶段由 proposePoiLabels / proposeHouseLabels / proposeAgentLabels 提交候选；
//  ③ resolve()：
//     · 优先级分级：pinned(0) → 选中(1) → 悬浮(2) → 关键提示(3) → POI名称(4) → 舍数(5) → 普通编号(6)；
//     · 聚合：低缩放/拥挤时同类普通房屋标签按屏幕半径聚合为数量徽标（如 🏠 3）；
//     · 放置：依次尝试 [首选, 锚点镜像, 右, 左] 四备选位；
//     · 滞回：上帧选定位在微小镜头移动时受裕量保护，消除临界高频跳位抖动；
//     · 兜底：选中与悬浮目标不可省略；世界空间无法合法安置时分流至边缘提示区并计算引线；
//  ④ 绘制阶段：
//     · 普通标签在所属实体深度落笔（posOf，保留地形遮挡）；
//     · 交互覆盖层绘制聚合徽标、选中气泡、边缘兜底引线并以 DOM 快照缓存同步提示区。
//  ⑤ 拾取阶段：hitTest(x, y) 优先命中聚合徽标（展开成员列表）与单体标签（映射回 owner），
//     未命中时回退原实体拾取路径。
//
// 有界性与零内核交互：纯前端表现层，无 Math.random/RNG，单文件严控 800 行以内。
window.LabelLayout = (function () {
  const RC = window.RENDER_CONFIG || {};

  // ---- 提案池（平行数组逐帧覆写，稳态零分配）----
  const MAXP = 512;
  const _pKey = new Float64Array(MAXP);   // 实体稳定键 = id * 16 + 槽位
  const _pPri = new Float64Array(MAXP);   // 优先级：小者先安置
  const _pAx = new Float64Array(MAXP);    // 锚点屏幕坐标
  const _pAy = new Float64Array(MAXP);
  const _pDx = new Float64Array(MAXP);    // 首选偏移
  const _pDy = new Float64Array(MAXP);
  const _pCat = new Uint8Array(MAXP);     // 0 = pinned / 1 = ordinary
  const _pText = new Array(MAXP);         // 字符串引用
  const _pFont = new Array(MAXP);
  let _pN = 0;
  let _pDropped = 0;                      // 超出提案上限被丢弃的普通标签数

  // ---- 接受结果 ----
  const _plX = new Float64Array(MAXP);    // 已接受基线位
  const _plY = new Float64Array(MAXP);
  const _rX = new Float64Array(MAXP * 2); // 已接受矩形（含 pad，后半段供聚合徽标）
  const _rY = new Float64Array(MAXP * 2);
  const _rW = new Float64Array(MAXP * 2);
  const _rH = new Float64Array(MAXP * 2);
  const _placeMap = new Map();            // key → 提案下标
  const _order = new Array(MAXP);
  let _statPinned = 0, _statAccepted = 0, _statOmitted = 0;

  // ---- 屏幕冲突网格（单元 → 矩形链表）----
  let _gCols = 0, _gRows = 0, _gHead = null;
  const _gNext = new Int32Array(MAXP * 2); // 矩形下标 → 同单元下一矩形，-1 结束

  // ---- UI 禁入矩形（DOM 覆盖区，节流重测）----
  const UIMAX = 16;
  const _uiX = new Float64Array(UIMAX), _uiY = new Float64Array(UIMAX);
  const _uiW = new Float64Array(UIMAX), _uiH = new Float64Array(UIMAX);
  let _uiN = 0, _uiFrame = 0, _uiDirty = true;
  window.addEventListener('resize', function () { _uiDirty = true; });

  // ---- ★ S4-07 有限布局滞回（上帧选定槽位缓存）----
  const _prevSlotMap = new Map(); // key → chosenSlot (0..3)

  // ---- ★ S4-07 聚合徽标与兜底数据结构 ----
  const _clusters = [];           // { id, bx, by, rx, ry, rw, rh, text, font, members: [ownerId, ...], ax, ay }
  const _clusteredKeys = new Set();
  const _dockItems = [];          // { type: 'selected'|'hovered', ownerType, ownerId, title, detail, ax, ay, dockX, dockY, dockW, dockH }
  let _lastDockHtml = '';
  let _lastClusterHtml = '';
  let _activePopupCluster = null;

  // ---- 字体测量缓存 ----
  const _mCache = new Map();
  const MEASURE_CAP = 2048;
  let _ctxRef = null;

  let _active = false;
  let _vw = 0, _vh = 0;

  function _cfg(name, dflt) {
    const v = (window.RENDER_CONFIG || {})[name];
    return v == null ? dflt : v;
  }

  function _ownerTypeOf(key) {
    const slot = ((key % 16) + 16) % 16;
    if (slot <= 3) return 'poi';
    if (slot <= 6) return 'house';
    return 'agent';
  }
  function _ownerIdOf(key) { return Math.floor(key / 16); }

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

  function isPointInUi(x, y) {
    for (let u = 0; u < _uiN; u++) {
      if (x >= _uiX[u] && x <= _uiX[u] + _uiW[u] && y >= _uiY[u] && y <= _uiY[u] + _uiH[u]) return true;
    }
    return false;
  }

  function beginFrame(vw, vh) {
    _active = !!_cfg('labelLayoutEnabled', true);
    if (!_active) {
      _pN = 0; _placeMap.clear(); _clusters.length = 0; _dockItems.length = 0;
      return;
    }
    _vw = vw; _vh = vh;
    _pN = 0; _pDropped = 0;
    _placeMap.clear();
    _clusters.length = 0;
    _clusteredKeys.clear();
    _dockItems.length = 0;
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
    _rX[i] = bx - tw / 2;
    _rY[i] = by - ad[0];
    _rW[i] = tw;
    _rH[i] = ad[0] + ad[1];
    return tw;
  }

  function _gridInsert(i) {
    _gridInsertRect(i, _rX[i], _rY[i], _rW[i], _rH[i]);
  }

  function _gridInsertRect(idx, rx, ry, rw, rh) {
    const c = _cfg('labelGridCellSize', 48);
    const x0 = Math.max(0, (rx / c) | 0), x1 = Math.min(_gCols - 1, ((rx + rw) / c) | 0);
    const y0 = Math.max(0, (ry / c) | 0), y1 = Math.min(_gRows - 1, ((ry + rh) / c) | 0);
    for (let gy = y0; gy <= y1; gy++) {
      const rowOff = gy * _gCols;
      for (let gx = x0; gx <= x1; gx++) {
        const ci = rowOff + gx;
        _gNext[idx] = _gHead[ci];
        _gHead[ci] = idx;
      }
    }
  }

  function _fits(i) {
    return _rectFits(_rX[i], _rY[i], _rW[i], _rH[i]);
  }

  function _fitsWithPad(i, pad) {
    return _rectFits(_rX[i] - pad, _rY[i] - pad, _rW[i] + pad * 2, _rH[i] + pad * 2);
  }

  function _rectFits(x, y, wv, hv) {
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

  function _acceptAt(i, bx, by) {
    _plX[i] = bx; _plY[i] = by;
    _placeMap.set(_pKey[i], i);
    _gridInsert(i);
  }

  // ════════════ ★ S4-07 聚合计算 ════════════
  function _buildClusters() {
    if (!_cfg('labelClusterEnabled', true)) return;
    const sim = window.sim;
    const cam = window.camera;
    const z = cam ? cam.zoom : 1.0;
    const maxZoom = _cfg('labelClusterMaxZoom', 0.95);
    const radius = _cfg('labelClusterRadiusPx', 36);

    const selType = sim ? sim.selectionType : null;
    const selId = sim ? (selType === 'house' ? sim.selectedHouseId : null) : null;
    const hov = sim ? sim.hoveredEntity : null;
    const hovId = (hov && hov.type === 'house') ? hov.id : null;

    // 收集所有可聚合的普通房屋编号标签
    const houseProps = [];
    for (let i = 0; i < _pN; i++) {
      if (_pCat[i] === 0) continue; // pinned 不聚合
      const key = _pKey[i];
      const slot = ((key % 16) + 16) % 16;
      if (slot !== 6) continue; // 仅普通房屋编号 KEY_HOUSE_NUM 聚合
      const hid = _ownerIdOf(key);
      if (hid === selId || hid === hovId) continue; // 选中/悬浮目标保持单体，不被吸收
      houseProps.push(i);
    }
    if (houseProps.length < 2) return;

    const assigned = new Uint8Array(_pN);
    for (let idx = 0; idx < houseProps.length; idx++) {
      const i = houseProps[idx];
      if (assigned[i]) continue;
      const group = [i];
      const ax = _pAx[i], ay = _pAy[i];
      for (let jdx = idx + 1; jdx < houseProps.length; jdx++) {
        const j = houseProps[jdx];
        if (assigned[j]) continue;
        const d = Math.hypot(_pAx[j] - ax, _pAy[j] - ay);
        if (d <= radius || (z <= maxZoom && d <= radius * 1.5)) {
          group.push(j);
        }
      }
      if (group.length >= 2) {
        for (let g = 0; g < group.length; g++) assigned[group[g]] = 1;
        _tryPlaceCluster(group);
      }
    }
  }

  function _tryPlaceCluster(group) {
    let sumX = 0, sumY = 0;
    const members = [];
    for (let g = 0; g < group.length; g++) {
      const i = group[g];
      sumX += _pAx[i]; sumY += _pAy[i];
      members.push(_ownerIdOf(_pKey[i]));
    }
    const avgX = sumX / group.length;
    const avgY = sumY / group.length;
    const text = `🏠 ${group.length}舍`;
    const font = 'bold 9px sans-serif';
    const tw = _measure(font, text);
    const rw = tw + 8, rh = 14;

    // 尝试在质心附近的四个备选位放置聚合徽标
    const candidates = [
      [avgX, avgY - 12],
      [avgX, avgY + 12],
      [avgX + rw / 2 + 4, avgY],
      [avgX - rw / 2 - 4, avgY]
    ];
    let placed = false, clBx = 0, clBy = 0, clRx = 0, clRy = 0;
    for (let c = 0; c < candidates.length; c++) {
      const bx = candidates[c][0], by = candidates[c][1];
      const rx = bx - rw / 2, ry = by - rh / 2;
      if (_rectFits(rx, ry, rw, rh)) {
        placed = true;
        clBx = bx; clBy = by; clRx = rx; clRy = ry;
        break;
      }
    }

    if (placed) {
      const clId = MAXP + _clusters.length;
      _rX[clId] = clRx; _rY[clId] = clRy; _rW[clId] = rw; _rH[clId] = rh;
      _gridInsertRect(clId, clRx, clRy, rw, rh);
      _clusters.push({
        id: _clusters.length,
        bx: clBx, by: clBy, rx: clRx, ry: clRy, rw: rw, rh: rh,
        text: text, font: font, members: members,
        ax: avgX, ay: avgY
      });
      for (let g = 0; g < group.length; g++) {
        _clusteredKeys.add(_pKey[group[g]]);
      }
    }
  }

  // ════════════ 核心安置 resolve ════════════
  function resolve() {
    if (!_active) return;

    // 1. 尝试聚合同类普通标签
    _buildClusters();

    const n = _pN;
    for (let i = 0; i < n; i++) _order[i] = i;

    // 2. 稳定排序：动态调整优先级（选中=1, 悬浮=2, 其余按原pri）
    const sim = window.sim;
    const selType = sim ? sim.selectionType : null;
    const selId = sim ? (selType === 'agent' ? sim.selectedAgentId : (selType === 'house' ? sim.selectedHouseId : sim.selectedPoiId)) : null;
    const hov = sim ? sim.hoveredEntity : null;

    const dynamicPri = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (_pCat[i] === 0) { dynamicPri[i] = 0; continue; }
      const key = _pKey[i];
      const oType = _ownerTypeOf(key);
      const oId = _ownerIdOf(key);
      if (selType && oType === selType && oId === selId) {
        dynamicPri[i] = 1;
      } else if (hov && oType === hov.type && oId === hov.id) {
        dynamicPri[i] = 2;
      } else {
        dynamicPri[i] = _pPri[i] + 2;
      }
    }

    _order.length = n;
    _order.sort(function (a, b) {
      return dynamicPri[a] - dynamicPri[b] || _pKey[a] - _pKey[b] || a - b;
    });

    // 3. 逐个安置普通候选位（带有限滞回保护）
    const sidePad = _cfg('labelSidePadPx', 10);
    const hMargin = _cfg('labelHysteresisPx', 4);

    for (let oi = 0; oi < n; oi++) {
      const i = _order[oi];
      const key = _pKey[i];

      // 被聚合吸收的普通标签静默跳过单体放置
      if (_clusteredKeys.has(key)) continue;

      if (_pCat[i] === 0) {
        _accept(i, _pAx[i] + _pDx[i], _pAy[i] + _pDy[i]);
        _statPinned++; _statAccepted++;
        continue;
      }

      const ax = _pAx[i], ay = _pAy[i], dx = _pDx[i], dy = _pDy[i];
      const prevSlot = _prevSlotMap.get(key);

      const candX = [ax + dx, ax - dx, ax + dx + _rW[i] / 2 + sidePad, ax + dx - _rW[i] / 2 - sidePad];
      const candY = [ay + dy, ay - dy, ay + dy, ay + dy];

      let chosen = -1;

      // 滞回策略：若上帧选定备选位（1..3），先看首选位(0)是否有充裕空间（带hMargin）；
      // 若首选位仍拥挤但 prevSlot 依然合法，保持 prevSlot 避免微移动跳位
      if (prevSlot !== undefined && prevSlot > 0 && prevSlot < 4) {
        _rectOf(i, candX[0], candY[0]);
        if (_fitsWithPad(i, hMargin)) {
          chosen = 0;
        } else {
          _rectOf(i, candX[prevSlot], candY[prevSlot]);
          if (_fits(i)) chosen = prevSlot;
        }
      }

      if (chosen < 0) {
        for (let s = 0; s < 4; s++) {
          _rectOf(i, candX[s], candY[s]);
          if (_fits(i)) { chosen = s; break; }
        }
      }

      if (chosen >= 0) {
        _acceptAt(i, candX[chosen], candY[chosen]);
        _prevSlotMap.set(key, chosen);
        _statAccepted++;
      } else {
        _prevSlotMap.delete(key);
        _statOmitted++;
      }
    }

    // 4. 选中与悬浮双目标兜底判定（画布可用边缘分行提示区）
    _evaluateDualTargetDock(selType, selId, hov);
  }

  // ════════════ ★ S4-07 选中/悬浮双目标边缘兜底 ════════════
  const _TIER_SHORT = { Tier0Warehouse: '仓', Tier1ThatchedHut: '茅', Tier2LeanTo: '宅', Tier3Homestead: '庄', Tier4Fortress: '堡' };
  const _TIER_NAME = { Tier0Warehouse: '仓', Tier1ThatchedHut: '茅草屋', Tier2LeanTo: '简易偏屋', Tier3Homestead: '独立庄园', Tier4Fortress: '氏族坞堡' };

  function _evaluateDualTargetDock(selType, selId, hov) {
    if (!selType && !hov) return;
    _addDockItem('selected', selType, selId);
    if (hov && !(hov.type === selType && hov.id === selId)) {
      _addDockItem('hovered', hov.type, hov.id);
    }
  }

  function _addDockItem(dockType, oType, oId) {
    if (!oType || oId == null) return;
    const info = _resolveTargetInfo(oType, oId);
    if (!info || _isTargetInWorldVisible(oType, oId, info.p2D)) return;
    _dockItems.push({
      type: dockType, ownerType: oType, ownerId: oId,
      title: info.title, detail: info.detail,
      ax: info.p2D.x, ay: info.p2D.y,
      dockX: 250, dockY: 62 + _dockItems.length * 32, dockW: 280, dockH: 26
    });
  }

  function _isTargetInWorldVisible(type, id, p2D) {
    if (p2D.x < 30 || p2D.x > _vw - 30 || p2D.y < 30 || p2D.y > _vh - 30) return false;
    for (let u = 0; u < _uiN; u++) {
      if (p2D.x >= _uiX[u] && p2D.x <= _uiX[u] + _uiW[u] && p2D.y >= _uiY[u] && p2D.y <= _uiY[u] + _uiH[u]) return false;
    }
    const kb = id * 16;
    if (type === 'house') return _placeMap.has(kb + 6) || _placeMap.has(kb + 4) || _placeMap.has(kb + 5);
    if (type === 'poi') return _placeMap.has(kb + 1) || _placeMap.has(kb + 0);
    return type === 'agent';
  }

  function _resolveTargetInfo(type, id) {
    const sim = window.sim;
    if (!sim) return null;
    let title = '', detail = '', pos = null;
    if (type === 'house') {
      const h = (sim.houses || []).find(x => x.id === id);
      if (!h) return null;
      pos = h.pos;
      const t = _TIER_SHORT[h.tier] || '宅';
      title = `🏡 房屋 #${h.id} (${t})`;
      detail = h.auctionPhase ? `🔨 拍卖 · ${h.highestBid || 0}G` : `耐久 ${Math.round(h.durability)}% · 户主: ${h.ownerId != null ? '#' + h.ownerId : '无'}`;
    } else if (type === 'agent') {
      const a = (typeof sim.getAgent === 'function') ? sim.getAgent(id) : (sim.agents || []).find(x => x.id === id);
      if (!a) return null;
      pos = a.pos;
      title = `👤 族人 #${a.id} (${a.gender === 'male' ? '男' : '女'})`;
      const need = (typeof window.parseMaslowNeed === 'function') ? window.parseMaslowNeed(a.currentNeed, a) : null;
      detail = need ? `${need.icon} ${need.name} · ${a.state || '活动'}` : (a.state || '健康存活');
    } else if (type === 'poi') {
      const p = (sim.pois || []).find(x => x.id === id);
      if (!p) return null;
      pos = p.pos;
      title = p.type === 'Camp' ? `🏕️ ${p.campTitle || p.name || '营地'}` : `📍 ${p.name || p.type}`;
      detail = p.type === 'Camp' ? `${p.boundHouses || 0}舍 · 等级 ${p.level || 0}` : `储量 ${(p.currentStock || 0).toFixed(0)}/${(p.maxStock || 0).toFixed(0)}`;
    }
    if (!pos) return null;
    const p2D = (typeof window.projectLifted === 'function') ? window.projectLifted(pos) : (typeof window.project3D === 'function' ? window.project3D(pos) : { x: 0, y: 0 });
    return { title, detail, p2D };
  }

  // ════════════ 绘制阶段查询 posOf 与 overlayPlace ════════════
  function posOf(key, out) {
    const i = _placeMap.get(key);
    if (i === undefined) return false;
    out.x = _plX[i]; out.y = _plY[i];
    return true;
  }

  function overlayPlace(key, ax, ay, text, font, prefDy, out) {
    if (!_active) return false;
    const ad = _boxAscDesc(_fontPx(font), text);
    const tw = _measure(font, text);
    const sidePad = _cfg('labelSidePadPx', 10);
    const by0 = ay + prefDy;
    const cl = [
      [ax, by0], [ax, ay - prefDy],
      [ax + tw / 2 + sidePad, by0], [ax - tw / 2 - sidePad, by0]
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
      if (x - wv / 2 < _uiX[u] + _uiW[u] && x + wv / 2 > _uiX[u] && rY < _uiY[u] + _uiH[u] && rY + rH > _uiY[u]) return false;
    }
    const c = _cfg('labelGridCellSize', 48);
    const x0 = Math.max(0, ((x - wv / 2) / c) | 0), x1 = Math.min(_gCols - 1, ((x + wv / 2) / c) | 0);
    const y0 = Math.max(0, (rY / c) | 0), y1 = Math.min(_gRows - 1, ((rY + rH) / c) | 0);
    for (let gy = y0; gy <= y1; gy++) {
      const rowOff = gy * _gCols;
      for (let gx = x0; gx <= x1; gx++) {
        let r = _gHead[rowOff + gx];
        while (r >= 0) {
          if (x - wv / 2 < _rX[r] + _rW[r] && x + wv / 2 > _rX[r] && rY < _rY[r] + _rH[r] && rY + rH > _rY[r]) return false;
          r = _gNext[r];
        }
      }
    }
    return true;
  }

  // ════════════ ★ S4-07 Canvas 覆盖层绘制（聚合徽标 + 边缘引线）════════════
  function drawClusters(ctx) {
    if (!_active || _clusters.length === 0) return;
    ctx.save();
    for (let c = 0; c < _clusters.length; c++) {
      const cl = _clusters[c];
      ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.roundRect(cl.rx, cl.ry, cl.rw, cl.rh, 4);
      ctx.fill();
      ctx.stroke();

      ctx.font = cl.font;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(cl.text, cl.bx, cl.by + 3);
    }
    ctx.restore();
  }

  function drawLeaderLines(ctx) {
    if (!_active || _dockItems.length === 0 || !_cfg('labelLeaderLineEnabled', true)) return;
    const dockEl = document.getElementById('label-fallback-dock');
    const childEls = dockEl ? dockEl.querySelectorAll('.label-fallback-item') : null;
    ctx.save();
    for (let i = 0; i < _dockItems.length; i++) {
      const item = _dockItems[i];
      const ax = Math.min(Math.max(item.ax, 16), _vw - 16);
      const ay = Math.min(Math.max(item.ay, 16), _vh - 16);
      let startX = item.dockX + item.dockW;
      let startY = item.dockY + item.dockH * 0.5;
      if (childEls && childEls[i]) {
        const cr = childEls[i].getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) {
          startX = cr.right;
          startY = cr.top + cr.height * 0.5;
        }
      }
      const isSel = item.type === 'selected';

      ctx.strokeStyle = isSel ? 'rgba(245, 158, 11, 0.75)' : 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(ax, ay);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = isSel ? '#fbbf24' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(ax, ay, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ════════════ ★ S4-07 DOM 快照缓存同步与交互 ════════════
  function syncFallbackDockDOM() {
    const dockEl = document.getElementById('label-fallback-dock');
    if (!dockEl) return;
    if (!_active || _dockItems.length === 0) {
      if (dockEl.style.display !== 'none') dockEl.style.display = 'none';
      return;
    }
    let html = '';
    for (let i = 0; i < _dockItems.length; i++) {
      const it = _dockItems[i], isSel = it.type === 'selected';
      html += `<div class="label-fallback-item" data-type="${it.ownerType}" data-id="${it.ownerId}">` +
        `<span class="label-fallback-tag ${isSel ? 'tag-selected' : 'tag-hovered'}">[${isSel ? '选' : '悬'}]</span>` +
        `<span class="label-fallback-title">${it.title}</span>` +
        `<span class="label-fallback-detail">${it.detail}</span>` +
        `</div>`;
    }
    if (_lastDockHtml !== html) {
      dockEl.innerHTML = html;
      _lastDockHtml = html;
      dockEl.querySelectorAll('.label-fallback-item').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          _selectEntity(el.getAttribute('data-type'), parseInt(el.getAttribute('data-id'), 10));
        });
      });
    }
    if (dockEl.style.display !== 'flex') dockEl.style.display = 'flex';
  }

  function _selectEntity(type, id) {
    const sim = window.sim;
    if (!sim) return;
    sim.selectionType = type;
    if (type === 'agent') sim.selectedAgentId = id;
    else if (type === 'house') sim.selectedHouseId = id;
    else if (type === 'poi') sim.selectedPoiId = id;
    if (typeof window.updateInspector === 'function') window.updateInspector();
  }

  // ════════════ ★ S4-07 拾取查询 hitTest ════════════
  function hitTest(x, y) {
    if (!_active) return null;
    for (let c = 0; c < _clusters.length; c++) {
      const cl = _clusters[c];
      if (x >= cl.rx && x <= cl.rx + cl.rw && y >= cl.ry && y <= cl.ry + cl.rh) {
        return { isCluster: true, cluster: cl, members: cl.members, x: cl.bx, y: cl.by };
      }
    }
    for (const [key, i] of _placeMap) {
      if (x >= _rX[i] && x <= _rX[i] + _rW[i] && y >= _rY[i] && y <= _rY[i] + _rH[i]) {
        return { isCluster: false, key: key, ownerType: _ownerTypeOf(key), ownerId: _ownerIdOf(key), text: _pText[i] };
      }
    }
    return null;
  }

  // ════════════ ★ S4-07 聚合成员弹窗 ════════════
  function openClusterPopup(clHit) {
    const popup = document.getElementById('label-cluster-popup');
    if (!popup || !clHit) return;
    _activePopupCluster = clHit;
    const sim = window.sim, members = clHit.members || [];
    let listHtml = '';
    for (let i = 0; i < members.length; i++) {
      const hid = members[i];
      const h = sim && sim.houses ? sim.houses.find(x => x.id === hid) : null;
      const t = h ? (_TIER_NAME[h.tier] || '宅舍') : '宅舍';
      const owner = (h && h.ownerId != null) ? `户主 #${h.ownerId}` : '空置';
      listHtml += `<div class="label-cluster-item" data-house-id="${hid}"><span>🏠 #${hid} (${t})</span><span style="color:#94a3b8;font-size:10px;">${owner}</span></div>`;
    }
    const html = `<div class="label-cluster-header"><span>🏘️ 聚合房屋 (${members.length}舍)</span><button class="label-cluster-close" id="btn-close-cluster-popup">✕</button></div><div class="label-cluster-list">${listHtml}</div>`;
    if (_lastClusterHtml !== html) {
      popup.innerHTML = html;
      _lastClusterHtml = html;
      const closeBtn = document.getElementById('btn-close-cluster-popup');
      if (closeBtn) closeBtn.addEventListener('click', closeClusterPopup);
      popup.querySelectorAll('.label-cluster-item').forEach(function (el) {
        el.addEventListener('click', function () {
          _selectEntity('house', parseInt(el.getAttribute('data-house-id'), 10));
          closeClusterPopup();
        });
      });
    }
    const popW = 180, popH = Math.min(220, members.length * 28 + 36);
    popup.style.left = Math.min(Math.max(clHit.x - popW / 2, 10), _vw - popW - 10) + 'px';
    popup.style.top = Math.min(Math.max(clHit.y + 12, 10), _vh - popH - 10) + 'px';
    popup.style.display = 'block';
  }

  function closeClusterPopup() {
    const popup = document.getElementById('label-cluster-popup');
    if (popup) popup.style.display = 'none';
    _activePopupCluster = null;
  }

  // ════════════ 缓存重置与诊断 ════════════
  function resetCache() {
    _mCache.clear();
    _prevSlotMap.clear();
    _lastDockHtml = '';
    _lastClusterHtml = '';
    closeClusterPopup();
    _uiDirty = true;
  }

  function stats() {
    return {
      proposed: _pN, accepted: _statAccepted, pinned: _statPinned,
      omitted: _statOmitted, dropped: _pDropped,
      clusters: _clusters.length, dockItems: _dockItems.length
    };
  }
  function debugRects() {
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
  function debugClusters() { return _clusters.slice(); }
  function debugDockItems() { return _dockItems.slice(); }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') closeClusterPopup();
    });
    document.addEventListener('mousedown', function (e) {
      const popup = document.getElementById('label-cluster-popup');
      if (popup && popup.style.display !== 'none' && !popup.contains(e.target)) closeClusterPopup();
    });
  }

  return {
    beginFrame: beginFrame, propose: propose, resolve: resolve, posOf: posOf, overlayPlace: overlayPlace,
    drawClusters: drawClusters, drawLeaderLines: drawLeaderLines, syncFallbackDockDOM: syncFallbackDockDOM,
    hitTest: hitTest, openClusterPopup: openClusterPopup, closeClusterPopup: closeClusterPopup,
    isPointInUi: isPointInUi, active: function () { return _active; },
    stats: stats, debugRects: debugRects, debugUiRects: debugUiRects,
    debugClusters: debugClusters, debugDockItems: debugDockItems, resetCache: resetCache,
    KEY_POI_ICON: 0, KEY_POI_NAME: 1, KEY_POI_COUNT: 2, KEY_RES_ICON: 3,
    KEY_HOUSE_AUCTION: 4, KEY_HOUSE_REPAIR: 5, KEY_HOUSE_NUM: 6,
    KEY_AGENT_BUILD: 7, KEY_AGENT_MISC: 8, KEY_AGENT_EXPED: 9
  };
})();
