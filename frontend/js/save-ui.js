// === 读档 / 存档系统 (v1.7.0) ===
// 三槽位（自动槽 / 手动槽 1 / 手动槽 2）持久化于 localStorage，支持 JSON 文件导入导出。
// 存档正文为内核导出的全量世界状态 JSON（含 RNG 内部状态），读档后可确定性续演。
// 槽位元信息统一放在索引键里，避免正文被重复写入、浪费 localStorage 配额。

(function () {
  'use strict';

  const STORAGE_NS = 'flowaccord.save.v1';
  const INDEX_KEY = STORAGE_NS + '.__index';
  /// 必须与 sim_core::spatial::world_save::SAVE_FORMAT_VERSION 保持一致
  const SAVE_FORMAT_VERSION = 2;
  const AUTO_SAVE_INTERVAL_MS = 60000;

  const SLOTS = [
    { id: 'auto', icon: '🤖', name: '自动槽', desc: '每 60 秒自动覆盖保存' },
    { id: 'slot1', icon: '📁', name: '手动槽 1', desc: '手动覆盖保存' },
    { id: 'slot2', icon: '📁', name: '手动槽 2', desc: '手动覆盖保存' },
  ];

  let activeTab = 'save';
  let lastAutoTick = -1;
  let els = {};

  const getSim = () => window.rustWorldSim || null;

  function slotKey(id) { return STORAGE_NS + '.' + id; }

  function loadIndex() {
    try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || {}; }
    catch (e) { return {}; }
  }

  function saveIndex(index) {
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)); return true; }
    catch (e) { return false; }
  }

  function readSlotData(id) {
    try { return localStorage.getItem(slotKey(id)); }
    catch (e) { return null; }
  }

  // ── 元信息提取（存档正文较大，仅在保存/导入时解析一次）──
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

  // ── 槽位操作 ──

  function doSave(slotId) {
    const s = getSim();
    if (!s || !s._ready) { setStatus('引擎尚未就绪，请稍候重试', 'err'); return; }
    const json = s.saveWorld();
    if (!json) {
      const detail = s.readSaveError ? s.readSaveError() : '';
      setStatus('存档失败：' + (detail || '未知错误'), 'err');
      return;
    }
    let meta;
    try { meta = extractMeta(json); }
    catch (e) { setStatus('存档数据异常，已中止保存', 'err'); return; }
    meta.savedAt = Date.now();
    meta.bytes = new Blob([json]).size;

    try {
      localStorage.setItem(slotKey(slotId), json);
    } catch (e) {
      setStatus('保存失败：浏览器本地存储已满，请先删除旧存档或导出备份', 'err');
      return;
    }
    const index = loadIndex();
    index[slotId] = meta;
    saveIndex(index);
    lastAutoTick = meta.tick;
    renderList();
    setStatus(`已保存到「${slotName(slotId)}」· Tick ${meta.tick} · ${fmtBytes(meta.bytes)}`, 'ok');
    simLog(`💾 存档已写入${slotName(slotId)}（Tick ${meta.tick}，${fmtBytes(meta.bytes)}）`);
  }

  function doLoad(slotId) {
    const json = readSlotData(slotId);
    if (!json) { setStatus('该槽位为空，无法读取', 'err'); return; }
    applySave(json, loadIndex()[slotId] || null, `${slotName(slotId)}`);
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

  function doDelete(slotId) {
    const index = loadIndex();
    if (!index[slotId]) { setStatus('该槽位为空', 'err'); return; }
    if (!window.confirm(`确定删除「${slotName(slotId)}」的存档？该操作不可恢复。`)) return;
    try { localStorage.removeItem(slotKey(slotId)); } catch (e) { /* 忽略：索引已删除即可 */ }
    delete index[slotId];
    saveIndex(index);
    renderList();
    setStatus(`已删除「${slotName(slotId)}」`, 'ok');
  }

  function doExport(slotId) {
    const json = readSlotData(slotId);
    if (!json) { setStatus('该槽位为空，无法导出', 'err'); return; }
    const meta = (loadIndex()[slotId]) || {};
    const stamp = new Date(meta.savedAt || Date.now());
    const p = (v) => String(v).padStart(2, '0');
    const fname = `flowaccord-save-${slotId}-t${meta.tick || 0}-${stamp.getFullYear()}${p(stamp.getMonth() + 1)}${p(stamp.getDate())}-${p(stamp.getHours())}${p(stamp.getMinutes())}.json`;
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`已导出 ${fname}`, 'ok');
    } catch (e) {
      setStatus('导出失败：' + e.message, 'err');
    }
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let meta;
      try { meta = extractMeta(String(reader.result)); }
      catch (e) { setStatus('导入失败：文件不是合法的存档 JSON', 'err'); return; }
      if (meta.formatVersion !== SAVE_FORMAT_VERSION) {
        setStatus(`导入失败：存档格式版本 v${meta.formatVersion}，当前支持 v${SAVE_FORMAT_VERSION}`, 'err');
        return;
      }
      applySave(String(reader.result), meta, `导入文件（${file.name}）`);
    };
    reader.onerror = () => setStatus('导入失败：文件读取错误', 'err');
    reader.readAsText(file);
  }

  // ── 面板渲染 ──

  function slotName(id) {
    const s = SLOTS.find(x => x.id === id);
    return s ? s.name : id;
  }

  function renderList() {
    if (!els.list) return;
    const index = loadIndex();
    els.list.innerHTML = '';
    for (const slot of SLOTS) {
      const meta = index[slot.id] || null;
      const card = document.createElement('div');
      card.className = 'save-slot-card' + (meta ? '' : ' empty');

      const head = document.createElement('div');
      head.className = 'save-slot-head';
      head.innerHTML = `<span class="save-slot-name">${slot.icon} ${slot.name}</span>` +
        (meta ? `<span class="save-slot-badge">v${meta.appVersion || '—'}</span>` : `<span class="save-slot-badge muted">空存档</span>`);
      card.appendChild(head);

      const info = document.createElement('div');
      info.className = 'save-slot-meta';
      if (meta) {
        info.innerHTML =
          `<span title="模拟 Tick">⏱️ <b class="mono-num">${meta.tick}</b></span>` +
          `<span title="存活人口">👤 <b class="mono-num">${meta.population}</b> 人</span>` +
          `<span title="存续家户">🏠 <b class="mono-num">${meta.households}</b> 户</span>` +
          `<span title="存档体积">💾 <b class="mono-num">${fmtBytes(meta.bytes)}</b></span>`;
      } else {
        info.innerHTML = `<span class="save-slot-desc">${slot.desc}</span>`;
      }
      card.appendChild(info);

      const time = document.createElement('div');
      time.className = 'save-slot-time';
      time.textContent = meta ? `🕒 ${fmtTime(meta.savedAt)} · 种子 ${meta.seed}` : '尚未保存任何进度';
      card.appendChild(time);

      const actions = document.createElement('div');
      actions.className = 'save-slot-actions';
      const buttons = activeTab === 'save'
        ? [['save', '💾 覆盖保存', 'primary'], ['export', '📤 导出', ''], ['delete', '🗑️ 删除', 'danger']]
        : [['load', '📂 读取', 'primary'], ['export', '📤 导出', ''], ['delete', '🗑️ 删除', 'danger']];
      for (const [act, label, kind] of buttons) {
        const btn = document.createElement('button');
        btn.className = 'save-slot-btn' + (kind ? ' ' + kind : '');
        btn.dataset.slot = slot.id;
        btn.dataset.act = act;
        if (!meta && (act === 'load' || act === 'export' || act === 'delete')) btn.disabled = true;
        btn.textContent = label;
        actions.appendChild(btn);
      }
      card.appendChild(actions);
      els.list.appendChild(card);
    }

    if (els.hint) {
      let used = 0;
      for (const slot of SLOTS) {
        const d = readSlotData(slot.id);
        if (d) used += d.length;
      }
      els.hint.textContent = `本地已占用约 ${fmtBytes(used * 2)}（UTF-16 计）· 存档含完整世界状态，可跨设备导入`;
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

  // ── 自动保存 ──
  function tickAutoSave() {
    const s = getSim();
    if (!s || !s._ready) return;
    if (typeof s.tickCount === 'number' && s.tickCount === lastAutoTick) return; // 状态未推进，跳过
    const json = s.saveWorld();
    if (!json) return;
    let meta;
    try { meta = extractMeta(json); } catch (e) { return; }
    meta.savedAt = Date.now();
    meta.bytes = new Blob([json]).size;
    try { localStorage.setItem(slotKey('auto'), json); }
    catch (e) { return; }
    const index = loadIndex();
    index.auto = meta;
    saveIndex(index);
    lastAutoTick = meta.tick;
    if (isOpen()) renderList();
  }

  // ── 初始化 ──
  function init() {
    els.backdrop = document.getElementById('save-modal-backdrop');
    els.list = document.getElementById('save-slot-list');
    els.status = document.getElementById('save-status');
    els.hint = document.getElementById('save-storage-hint');
    els.fileInput = document.getElementById('save-file-input');
    if (!els.backdrop) return;

    const btnOpenSave = document.getElementById('btn-open-save-panel');
    const btnOpenLoad = document.getElementById('btn-open-load-panel');
    const btnClose = document.getElementById('save-modal-close');
    const btnImport = document.getElementById('btn-import-save');

    if (btnOpenSave) btnOpenSave.addEventListener('click', () => openPanel('save'));
    if (btnOpenLoad) btnOpenLoad.addEventListener('click', () => openPanel('load'));
    if (btnClose) btnClose.addEventListener('click', closePanel);
    if (els.backdrop) {
      els.backdrop.addEventListener('mousedown', (e) => { if (e.target === els.backdrop) closePanel(); });
    }
    if (btnImport && els.fileInput) {
      btnImport.addEventListener('click', () => els.fileInput.click());
      els.fileInput.addEventListener('change', () => {
        const file = els.fileInput.files && els.fileInput.files[0];
        handleImportFile(file);
        els.fileInput.value = '';
      });
    }

    for (const btn of document.querySelectorAll('.save-tab-btn')) {
      btn.addEventListener('click', () => openPanel(btn.dataset.tab));
    }

    if (els.list) {
      els.list.addEventListener('click', (e) => {
        const btn = e.target.closest('.save-slot-btn');
        if (!btn || btn.disabled) return;
        const slotId = btn.dataset.slot;
        switch (btn.dataset.act) {
          case 'save': doSave(slotId); break;
          case 'load': doLoad(slotId); break;
          case 'delete': doDelete(slotId); break;
          case 'export': doExport(slotId); break;
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

    setInterval(tickAutoSave, AUTO_SAVE_INTERVAL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
