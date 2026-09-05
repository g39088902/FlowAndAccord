// === 读档 / 存档系统 (v1.12.0) ===
// 三文件槽位（save1.json / save2.json / save3.json）直写用户磁盘，
// FileSystemFileHandle 经 IndexedDB 持久化，页面刷新后自动恢复连接。
// ★ v1.28.1 权限重授加固：句柄权限未持久化时不再自动断开/删除记录——启动门禁先
// 静默重授（授权已持久化时立即成功），失败则提供「授权并读取上次存档」按钮（点击=
// 用户手势内 requestPermission）；保存/读取遇 NotAllowedError 亦就地重授后重试。
// 存档正文为内核导出的全量世界状态 JSON（含 RNG 内部状态），读档后可确定性续演。
// 自动保存每 30 秒写入槽位 1。仅支持 Chrome / Edge（File System Access API）。
// v1.12.0: 彻底删除 localStorage 存档体系，仅保留文件直写。

(function () {
  'use strict';

  /// 必须与 sim_core::spatial::world_save::SAVE_FORMAT_VERSION 保持一致
  const SAVE_FORMAT_VERSION = 3;
  const AUTO_SAVE_INTERVAL_MS = 30000;

  const SLOTS = [
    { id: 'save1', icon: '📁', name: '存档槽 1', desc: '自动保存默认写入此槽', suggestedName: 'flowaccord-save1.json', isAuto: true },
    { id: 'save2', icon: '📁', name: '存档槽 2', desc: '手动覆盖保存', suggestedName: 'flowaccord-save2.json', isAuto: false },
    { id: 'save3', icon: '📁', name: '存档槽 3', desc: '手动覆盖保存', suggestedName: 'flowaccord-save3.json', isAuto: false },
  ];

  // ── 运行时状态 ──
  let activeTab = 'save';
  let lastAutoTick = -1;
  let els = {};
  // 每槽位的文件句柄与元信息（句柄来自 IndexedDB 恢复或用户新选择）
  const slotState = {}; // { save1: { handle, fileName, meta, lastSaved }, ... }

  const getSim = () => window.rustWorldSim || null;

  // ══════════════════════════════════════════════════════════════
  // IndexedDB：持久化 FileSystemFileHandle（刷新后自动恢复连接）
  // ══════════════════════════════════════════════════════════════
  const IDB_NAME = 'flowaccord-save-handles';
  const IDB_STORE = 'handles';
  let idb = null;
  let idbReady = false;

  function openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'slotId' });
        }
      };
      req.onsuccess = () => { idb = req.result; idbReady = true; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  function idbPut(slotId, handle, fileName) {
    return new Promise((resolve, reject) => {
      if (!idbReady) { resolve(); return; }
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ slotId, handle, fileName, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbGet(slotId) {
    return new Promise((resolve, reject) => {
      if (!idbReady) { resolve(null); return; }
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(slotId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  function idbDelete(slotId) {
    return new Promise((resolve, reject) => {
      if (!idbReady) { resolve(); return; }
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(slotId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 浏览器兼容性
  // ══════════════════════════════════════════════════════════════
  function supportsFileAPI() {
    return typeof window.showSaveFilePicker === 'function' &&
           typeof window.showOpenFilePicker === 'function';
  }

  /** 查询/请求句柄读写权限；用户手势上下文可弹授权，静默调用仅在授权已持久化时成功 */
  async function requestHandlePermission(handle) {
    try {
      if (typeof handle.queryPermission !== 'function') return true;
      let state = await handle.queryPermission({ mode: 'readwrite' });
      if (state === 'granted') return true;
      if (typeof handle.requestPermission === 'function') {
        state = await handle.requestPermission({ mode: 'readwrite' });
      }
      return state === 'granted';
    } catch (e) {
      return false; // 非手势上下文请求 prompt 态权限会被浏览器拒绝
    }
  }

  function releaseStartupGate(message) {
    const gate = document.getElementById('startup-save-gate');
    if (gate) gate.style.display = 'none';
    const s = getSim();
    if (s) s.isPaused = false;
    if (message) setStatus(message, 'ok');
  }

  function setStartupGateMessage(message, error) {
    const el = document.getElementById('startup-save-message');
    if (el) { el.textContent = message; el.style.color = error ? '#f87171' : '#9fb3c8'; }
  }

  // ══════════════════════════════════════════════════════════════
  // ★ v1.28.0 启动自动读档：打开游戏时若已连接默认存档文件
  // （自动槽 1 = 浏览器记住的默认目录 + 默认文件名 flowaccord-save1.json，
  //   句柄由 IndexedDB 恢复，无需用户手势），直接读取其内容续演，
  //   而不是开新世界等自动保存覆盖旧档。
  // ══════════════════════════════════════════════════════════════

  /** 等待 WASM 引擎就绪（轮询 _ready），超时返回 false */
  function waitEngineReady(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const s = getSim();
        if (s && s._ready) { clearInterval(timer); resolve(true); return; }
        if (Date.now() - start > timeoutMs) { clearInterval(timer); resolve(false); }
      }, 50);
    });
  }

  /** 启动时自动读取指定槽位的存档并续演；成功返回 true（不弹读档面板） */
  async function autoLoadStartupSave(slotId) {
    const st = slotState[slotId];
    if (!st || !st.handle) return false;
    let file;
    try {
      file = await st.handle.getFile();
    } catch (e) {
      return false; // 权限问题由调用方 requestHandlePermission 先行处理，此处不再断开
    }
    let text;
    try { text = await file.text(); }
    catch (e) { return false; }
    let meta;
    try { meta = extractMeta(text); }
    catch (e) { return false; }
    if (!meta || meta.formatVersion !== SAVE_FORMAT_VERSION) return false;
    // 引擎就绪前不可读档（world_load 依赖 wasm）；等待加载完成
    if (!(await waitEngineReady(15000))) return false;
    const s = getSim();
    if (!s || !s._ready) return false;
    const res = s.loadWorld(text, meta);
    if (!res.ok) {
      console.warn('[save-ui] 启动自动读档失败:', res.error);
      return false;
    }
    // 启动续演：由 releaseStartupGate 解除暂停，此处同步顶栏暂停按钮文案（运行态）
    const btnPause = document.getElementById('btn-pause');
    if (btnPause) btnPause.textContent = '⏸️ 暂停模拟 (空格)';
    lastAutoTick = meta.tick || 0;
    simLog(`📂 启动时已自动读取存档（Tick ${meta.tick || 0}），模拟继续`);
    return true;
  }

  async function bootstrapStartupGate() {
    const gate = document.getElementById('startup-save-gate');
    const btn = document.getElementById('startup-save-connect');
    if (!gate || !btn) return;
    if (!supportsFileAPI()) {
      btn.disabled = true;
      setStartupGateMessage('当前浏览器不兼容本地存档文件，请使用最新版 Chrome 或 Edge。', true);
      return;
    }
    const st = slotState.save1;
    if (st && st.handle) {
      // ★ v1.28.1：句柄已从 IndexedDB 恢复 → 先尝试静默重授（授权已持久化时立即成功），
      // 成功后自动读取默认存档续演；权限未持久化则提供「授权并读取」按钮（点击 = 用户手势）。
      const granted = await requestHandlePermission(st.handle);
      if (granted) {
        await refreshSlotMeta('save1');
        if (st.meta && st.meta.formatVersion === SAVE_FORMAT_VERSION) {
          setStartupGateMessage('正在自动读取存档…');
          const loaded = await autoLoadStartupSave('save1');
          if (loaded) {
            releaseStartupGate('已自动读取存档，模拟继续');
            return;
          }
        }
        // 存档为空/版本不兼容/读取失败：保留阻断，点击按钮可覆盖保存或重新连接
        setStartupGateMessage('自动读取存档失败，点击下方按钮可覆盖保存当前世界或重新连接存档文件。', true);
      } else {
        setStartupGateMessage(`已找到上次的存档文件「${st.fileName}」，点击下方按钮授权读取后继续。`, false);
        btn.textContent = '🔓 授权并读取上次存档';
      }
    }
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const st2 = slotState.save1;
      if (st2 && st2.handle) {
        // 已有关联文件：手势内重授 → 优先自动读档；文件无效则覆盖保存当前世界
        const granted = await requestHandlePermission(st2.handle);
        if (!granted) {
          btn.disabled = false;
          setStartupGateMessage('授权被拒绝，无法访问该存档文件。', true);
          return;
        }
        await refreshSlotMeta('save1');
        if (st2.meta && st2.meta.formatVersion === SAVE_FORMAT_VERSION) {
          setStartupGateMessage('正在自动读取存档…');
          const loaded = await autoLoadStartupSave('save1');
          if (loaded) {
            releaseStartupGate('已自动读取存档，模拟继续');
            return;
          }
          btn.disabled = false;
          setStartupGateMessage('存档读取失败，请重试。', true);
          return;
        }
        // 文件为空或版本不兼容：覆盖保存当前世界（相当于新建存档）
        const s = getSim();
        const saved = s && s._ready ? await saveToSlot('save1') : false;
        if (saved) {
          releaseStartupGate('已建立存档文件，模拟开始');
        } else {
          btn.disabled = false;
          setStartupGateMessage('存档文件尚未成功写入，游戏仍被暂停。请重试。', true);
        }
        return;
      }
      // 无已关联文件（首次使用）：建立/连接新存档文件
      setStartupGateMessage('正在申请创建存档文件…');
      await connectSlot('save1');
      const connected = slotState.save1 && slotState.save1.handle;
      if (connected) {
        const s = getSim();
        const saved = s && s._ready ? await saveToSlot('save1') : false;
        if (saved && slotState.save1.meta && slotState.save1.meta.formatVersion === SAVE_FORMAT_VERSION) {
          releaseStartupGate('已建立存档文件，模拟开始');
        } else {
          btn.disabled = false;
          setStartupGateMessage('存档文件尚未成功写入，游戏仍被暂停。请重试。', true);
        }
      } else {
        btn.disabled = false;
        setStartupGateMessage('未建立存档文件，游戏仍被暂停。请重试。', true);
      }
    }, { once: false });
  }

  // ══════════════════════════════════════════════════════════════
  // 元信息提取
  // ══════════════════════════════════════════════════════════════
  function extractMeta(jsonStr) {
    const obj = JSON.parse(jsonStr);
    const agents = Array.isArray(obj.agents) ? obj.agents : [];
    const households = Array.isArray(obj.households) ? obj.households : [];
    return {
      formatVersion: obj.format_version,
      appVersion: obj.app_version || '—',
      seed: obj.seed,
      tick: obj.tick_counter || 0,
      population: agents.filter(a => a.is_alive && !a.is_fetus).length,
      households: households.length,
    };
  }

  function fmtBytes(n) {
    if (!n) return '0 KB';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function setStatus(msg, kind) {
    if (!els.status) return;
    els.status.textContent = msg || '';
    els.status.className = 'save-status' + (kind ? ' ' + kind : '');
  }

  function simLog(msg) {
    const s = getSim();
    if (s && typeof s.logEvent === 'function') s.logEvent(msg, 'camp');
  }

  // ══════════════════════════════════════════════════════════════
  // 槽位操作
  // ══════════════════════════════════════════════════════════════

  /** 为指定槽位弹出文件选择器，连接/创建一个本地存档文件 */
  async function connectSlot(slotId) {
    if (!supportsFileAPI()) {
      setStatus('当前浏览器不支持本地文件直写，请使用 Chrome 或 Edge', 'err');
      return;
    }
    const slot = SLOTS.find(s => s.id === slotId);
    if (!slot) return;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: slot.suggestedName,
        types: [{
          description: 'Flow & Accord 存档文件',
          accept: { 'application/json': ['.json'] },
        }],
      });
      slotState[slotId] = { handle, fileName: handle.name, meta: null, lastSaved: 0, permError: false };
      await requestHandlePermission(handle);
      await idbPut(slotId, handle, handle.name);
      // 尝试读取已有文件的元信息
      await refreshSlotMeta(slotId);
      renderList();
      setStatus(`已连接「${handle.name}」到${slot.name}`, 'ok');
    } catch (e) {
      if (e.name !== 'AbortError') {
        setStatus('连接文件失败：' + e.message, 'err');
      }
    }
  }

  /** 从文件重新读取元信息（用于刷新后恢复显示） */
  async function refreshSlotMeta(slotId) {
    const st = slotState[slotId];
    if (!st || !st.handle) return;
    try {
      const file = await st.handle.getFile();
      const text = await file.text();
      const meta = extractMeta(text);
      if (meta.formatVersion === SAVE_FORMAT_VERSION) {
        st.meta = meta;
        st.permError = false;
        st.lastSaved = file.lastModified;
      } else {
        st.meta = null; // 版本不兼容，不显示
      }
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        // 权限未持久化：保留槽位与 IndexedDB 记录，等待用户手势内重授
        st.permError = true;
      }
    }
  }

  /** 将当前世界存档写入指定槽位的文件 */
  async function saveToSlot(slotId) {
    const st = slotState[slotId];
    if (!st || !st.handle) {
      // 未连接，先让用户选择文件
      await connectSlot(slotId);
      // 用户可能取消
      if (!slotState[slotId] || !slotState[slotId].handle) return false;
    }
    const s = getSim();
    if (!s || !s._ready) { setStatus('引擎尚未就绪，请稍候重试', 'err'); return false; }
    const json = s.saveWorld();
    if (!json) {
      const detail = s.readSaveError ? s.readSaveError() : '';
      setStatus('存档失败：' + (detail || '未知错误'), 'err');
      return false;
    }
    let meta;
    try { meta = extractMeta(json); }
    catch (e) { setStatus('存档数据异常，已中止保存', 'err'); return false; }

    let wrote = false;
    try {
      const writable = await st.handle.createWritable();
      await writable.write(json);
      await writable.close();
      wrote = true;
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        // 权限失效：在用户手势内重授后重试一次，不再自动断开
        if (await requestHandlePermission(st.handle)) {
          try {
            const writable = await st.handle.createWritable();
            await writable.write(json);
            await writable.close();
            wrote = true;
          } catch (e2) {
            setStatus('写入文件失败：' + e2.message, 'err');
            return false;
          }
        } else {
          setStatus('文件写入权限被拒绝，请重新连接该槽位', 'err');
          return false;
        }
      } else {
        setStatus('写入文件失败：' + e.message, 'err');
        return false;
      }
    }
    if (!wrote) return false;

    meta.savedAt = Date.now();
    meta.bytes = new Blob([json]).size;
    st.meta = meta;
    st.lastSaved = meta.savedAt;
    lastAutoTick = meta.tick;
    renderList();
    const slot = SLOTS.find(s => s.id === slotId);
    setStatus(`已保存到${slot.name}「${st.fileName}」· Tick ${meta.tick} · ${fmtBytes(meta.bytes)}`, 'ok');
    simLog(`💾 存档已写入${slot.name}（Tick ${meta.tick}，${fmtBytes(meta.bytes)}）`);
    return true;
  }

  /** 从指定槽位的文件读取存档 */
  async function loadFromSlot(slotId) {
    const st = slotState[slotId];
    if (!st || !st.handle) {
      setStatus('该槽位尚未连接文件，请先点击「连接文件」', 'err');
      return;
    }
    let file;
    try {
      file = await st.handle.getFile();
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        // 权限失效：在用户手势内重授后重试一次，不再自动断开
        if (await requestHandlePermission(st.handle)) {
          try { file = await st.handle.getFile(); }
          catch (e2) { setStatus('读取文件失败：' + e2.message, 'err'); return; }
        } else {
          setStatus('文件读取权限被拒绝，请重新连接该槽位', 'err');
          return;
        }
      } else {
        setStatus('读取文件失败：' + e.message, 'err');
        return;
      }
    }
    const text = await file.text();
    let meta;
    try { meta = extractMeta(text); }
    catch (e) { setStatus('文件不是合法的存档 JSON', 'err'); return; }
    if (meta.formatVersion !== SAVE_FORMAT_VERSION) {
      setStatus(`存档格式版本 v${meta.formatVersion}，当前支持 v${SAVE_FORMAT_VERSION}`, 'err');
      return;
    }
    applySave(text, meta, `${SLOTS.find(s => s.id === slotId).name}（${st.fileName}）`);
  }

  /** 断开槽位的文件连接（显式操作：删除内存状态与 IndexedDB 句柄记录） */
  async function disconnectSlot(slotId) {
    delete slotState[slotId];
    await idbDelete(slotId);
    renderList();
    setStatus(`已断开${SLOTS.find(s => s.id === slotId).name}的文件连接`, 'ok');
  }

  function applySave(json, meta, label) {
    const s = getSim();
    if (!s || !s._ready) { setStatus('引擎尚未就绪，请稍候重试', 'err'); return; }
    const res = s.loadWorld(json, meta);
    if (!res.ok) {
      setStatus('读档失败：' + (res.error || '未知错误'), 'err');
      return;
    }
    // 读档后暂停，便于核对世界状态（同步顶栏暂停按钮文案）
    s.isPaused = true;
    const btnPause = document.getElementById('btn-pause');
    if (btnPause) btnPause.textContent = '▶️ 继续模拟 (空格)';
    closePanel();
    const tick = (meta && meta.tick) || 0;
    simLog(`📂 已从${label}读档（Tick ${tick}），模拟已暂停`);
  }

  // ══════════════════════════════════════════════════════════════
  // 面板渲染
  // ══════════════════════════════════════════════════════════════

  function renderList() {
    if (!els.list) return;
    els.list.innerHTML = '';

    // 浏览器不兼容提示
    if (!supportsFileAPI()) {
      const warn = document.createElement('div');
      warn.className = 'save-slot-card';
      warn.style.cssText = 'border-color:rgba(239,68,68,0.4); background:rgba(239,68,68,0.06);';
      warn.innerHTML = `<div style="font-size:13px; font-weight:600; color:#ef4444;">🚫 浏览器不兼容</div>
        <div style="font-size:11px; color:#94a3b8; margin-top:4px; line-height:1.6;">
          存档系统需要 File System Access API 支持直写本地文件。<br>
          请使用 <b>Chrome</b> 或 <b>Edge</b> 浏览器打开本页面。
        </div>`;
      els.list.appendChild(warn);
      if (els.hint) els.hint.textContent = '';
      return;
    }

    for (const slot of SLOTS) {
      const st = slotState[slot.id] || null;
      const card = document.createElement('div');
      card.className = 'save-slot-card' + (st ? '' : ' empty');

      const head = document.createElement('div');
      head.className = 'save-slot-head';
      const autoBadge = slot.isAuto ? '<span class="save-slot-badge" style="color:#60a5fa; background:rgba(59,130,246,0.12); border-color:rgba(59,130,246,0.3);">🤖 自动保存</span>' : '';
      head.innerHTML = `<span class="save-slot-name">${slot.icon} ${slot.name}</span>` +
        (st ? (st.permError
          ? '<span class="save-slot-badge" style="color:#fbbf24; border-color:rgba(251,191,36,.4);">🔐 待授权</span>'
          : `<span class="save-slot-badge">v${st.meta ? st.meta.appVersion : '—'}</span>`)
          : autoBadge || `<span class="save-slot-badge muted">未连接</span>`);
      card.appendChild(head);

      const info = document.createElement('div');
      info.className = 'save-slot-meta';
      if (st && st.meta) {
        info.innerHTML =
          `<span title="存档文件">📄 <b class="mono-num">${st.fileName}</b></span>` +
          `<span title="模拟 Tick">⏱️ <b class="mono-num">${st.meta.tick}</b></span>` +
          `<span title="存活人口">👤 <b class="mono-num">${st.meta.population}</b> 人</span>` +
          `<span title="存续家户">🏠 <b class="mono-num">${st.meta.households}</b> 户</span>`;
      } else if (st) {
        info.innerHTML = `<span title="存档文件">📄 <b class="mono-num">${st.fileName}</b></span>` +
          `<span class="save-slot-desc">文件为空或版本不兼容，点击下方「保存」写入当前世界</span>`;
      } else {
        info.innerHTML = `<span class="save-slot-desc">${slot.desc}</span>`;
      }
      card.appendChild(info);

      const time = document.createElement('div');
      time.className = 'save-slot-time';
      if (st && st.lastSaved) {
        time.textContent = `🕒 最后写入: ${fmtTime(st.lastSaved)}`;
      } else if (st) {
        time.textContent = st.permError ? '🔐 权限待授权，点击操作按钮时自动请求' : '已连接，等待首次写入';
      } else {
        time.textContent = '点击「连接文件」选择一个 .json 存档文件';
      }
      card.appendChild(time);

      const actions = document.createElement('div');
      actions.className = 'save-slot-actions';
      if (st) {
        const btns = activeTab === 'save'
          ? [['save', '💾 覆盖保存', 'primary'], ['load', '📂 读取', ''], ['disconnect', '🔌 断开', 'danger']]
          : [['load', '📂 读取', 'primary'], ['save', '💾 覆盖保存', ''], ['disconnect', '🔌 断开', 'danger']];
        for (const [act, label, kind] of btns) {
          const btn = document.createElement('button');
          btn.className = 'save-slot-btn' + (kind ? ' ' + kind : '');
          btn.dataset.slot = slot.id;
          btn.dataset.act = act;
          if (act === 'load' && (!st.meta)) btn.disabled = true;
          btn.textContent = label;
          actions.appendChild(btn);
        }
      } else {
        const btn = document.createElement('button');
        btn.className = 'save-slot-btn primary';
        btn.dataset.slot = slot.id;
        btn.dataset.act = 'connect';
        btn.textContent = '🔗 连接存档文件';
        actions.appendChild(btn);
      }
      card.appendChild(actions);
      els.list.appendChild(card);
    }

    if (els.hint) {
      const connected = SLOTS.filter(s => slotState[s.id]).length;
      els.hint.textContent = connected > 0
        ? `💻 文件直写模式 · 已连接 ${connected}/3 槽位 · 自动保存每 30 秒写入「存档槽 1」· 刷新后自动恢复连接（权限失效时点击操作自动重授）`
        : '💻 文件直写模式 · 存档直写您电脑上的 .json 文件，不受浏览器存储配额限制 · 请先连接槽位';
    }
  }

  function openPanel(tab) {
    activeTab = tab || 'save';
    for (const btn of document.querySelectorAll('.save-tab-btn')) {
      btn.classList.toggle('active', btn.dataset.tab === activeTab);
    }
    setStatus('');
    renderList();
    if (els.backdrop) els.backdrop.style.display = 'flex';
  }

  function closePanel() {
    if (els.backdrop) els.backdrop.style.display = 'none';
  }

  function isOpen() {
    return !!els.backdrop && els.backdrop.style.display !== 'none';
  }

  // ══════════════════════════════════════════════════════════════
  // 自动保存（每 60 秒写入槽位 1）
  // ══════════════════════════════════════════════════════════════
  function tickAutoSave() {
    const s = getSim();
    if (!s || !s._ready) return;
    if (typeof s.tickCount === 'number' && s.tickCount === lastAutoTick) return;

    const st = slotState['save1'];
    if (!st || !st.handle || st.permError) return; // 槽位1未连接或权限待授权，跳过自动保存
    saveToSlot('save1'); // 异步执行，不阻塞主循环
  }

  // ══════════════════════════════════════════════════════════════
  // 初始化
  // ══════════════════════════════════════════════════════════════
  async function init() {
    els.backdrop = document.getElementById('save-modal-backdrop');
    els.list = document.getElementById('save-slot-list');
    els.status = document.getElementById('save-status');
    els.hint = document.getElementById('save-storage-hint');
    if (!els.backdrop) return;

    // 保留无 File System Access API 浏览器的导入/导出降级路径
    const btnImport = document.getElementById('btn-import-save');
    const fileInput = document.getElementById('save-file-input');
    if (btnImport && fileInput) btnImport.addEventListener('click', () => fileInput.click());
    if (fileInput) fileInput.addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const meta = extractMeta(text);
        if (meta.formatVersion !== SAVE_FORMAT_VERSION) throw new Error(`存档格式版本 v${meta.formatVersion}，当前支持 v${SAVE_FORMAT_VERSION}`);
        applySave(text, meta, `导入文件（${file.name}）`);
      } catch (err) { setStatus('导入失败：' + err.message, 'err'); }
      fileInput.value = '';
    });
    const btnExport = document.getElementById('btn-export-save');
    if (btnExport) btnExport.addEventListener('click', () => {
      const s = getSim();
      if (!s || !s._ready) { setStatus('引擎尚未就绪，请稍候重试', 'err'); return; }
      const json = s.saveWorld();
      if (!json) { setStatus('导出失败：' + (s.readSaveError ? s.readSaveError() : '未知错误'), 'err'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], {type:'application/json'}));
      a.download = `flowaccord-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setStatus('已下载当前世界存档备份', 'ok');
    });

    const btnOpenSave = document.getElementById('btn-open-save-panel');
    const btnOpenLoad = document.getElementById('btn-open-load-panel');
    const btnClose = document.getElementById('save-modal-close');

    if (btnOpenSave) btnOpenSave.addEventListener('click', () => openPanel('save'));
    if (btnOpenLoad) btnOpenLoad.addEventListener('click', () => openPanel('load'));
    if (btnClose) btnClose.addEventListener('click', closePanel);
    if (els.backdrop) {
      els.backdrop.addEventListener('mousedown', (e) => { if (e.target === els.backdrop) closePanel(); });
    }

    for (const btn of document.querySelectorAll('.save-tab-btn')) {
      btn.addEventListener('click', () => openPanel(btn.dataset.tab));
    }

    if (els.list) {
      els.list.addEventListener('click', async (e) => {
        const btn = e.target.closest('.save-slot-btn');
        if (!btn || btn.disabled) return;
        const slotId = btn.dataset.slot;
        switch (btn.dataset.act) {
          case 'connect': await connectSlot(slotId); break;
          case 'save': await saveToSlot(slotId); break;
          case 'load': await loadFromSlot(slotId); break;
          case 'disconnect': await disconnectSlot(slotId); break;
        }
      });
    }

    // Esc 关闭：捕获阶段拦截，避免同时触发 Inspector 的关闭逻辑
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) {
        closePanel();
        e.stopPropagation();
      }
    }, true);

    // 从 IndexedDB 恢复所有槽位的文件句柄
    if (supportsFileAPI()) {
      try {
        await openIDB();
        for (const slot of SLOTS) {
          const rec = await idbGet(slot.id);
          if (rec && rec.handle) {
            slotState[slot.id] = { handle: rec.handle, fileName: rec.fileName, meta: null, lastSaved: 0, permError: false };
            await refreshSlotMeta(slot.id);
            if (isOpen()) renderList();
          }
        }
      } catch (e) {
        console.warn('IndexedDB 句柄恢复失败:', e);
      }
    }

    await bootstrapStartupGate();

    // 暴露全局 API 供生态重置开新档与外部系统联动
    window.saveUI = {
      saveSlot: saveToSlot,
      loadSlot: loadFromSlot,
      autoSave: () => saveToSlot('save1'),
      refresh: renderList,
    };

    // 监听生态重置事件，开启新档后自动更新存档
    window.addEventListener('ecology-reset', async () => {
      const st = slotState['save1'];
      if (st && st.handle && !st.permError) {
        await saveToSlot('save1');
      }
    });

    setInterval(tickAutoSave, AUTO_SAVE_INTERVAL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
