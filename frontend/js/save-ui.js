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
  /// ★ v1.44.7：M5 新增帝国登记簿与帝国公帑结算状态（WorldSave 字段增删），格式升至 4，不兼容旧档
  /// v1.46.12：BranchId 收敛为 16 条，活动任务枚举不兼容旧档。
  const SAVE_FORMAT_VERSION = 7;
  /// 权威默认应用版本（与 sim_core::spatial::world_save::SAVE_APP_VERSION 保持一致）
  const DEFAULT_APP_VERSION = '1.60.1';

  const AUTO_SAVE_INTERVAL_MS = 30000;

  /**
   * ★ v1.44.2 版本字符串归一化（消除「版本相同却判定为旧档」的误判）
   * 内核 SAVE_APP_VERSION 与存档 app_version 恒为 `1.44.1`（无 `v` 前缀），
   * 而前端兜底串历史写法为 `v1.38.0`（带 `v`）。二者直接 `===` 比较必然不等，
   * 导致启动门禁先误报「旧档已废弃」、等引擎 READY 后又能把同一份旧档读进来。
   * 所有版本比较点必须先归一化：去首尾空白 + 去可选 `v`/`V` 前缀。
   */
  function normalizeVer(v) {
    return String(v == null ? '' : v).trim().replace(/^[vV]\s*/, '');
  }

  /**
   * ★ v1.50.80 存档兼容线（版本号前两段 major.minor）
   * 版本策略：末尾版本号（patch）只承载前端渲染 / 表现层优化等不触碰存档与数值逻辑的变更，
   * 内核 `SAVE_APP_VERSION` 亦只写兼容线（`1.50`）⇒ 末尾升版**不再废弃旧存档**。
   * 中间版本号（minor）变更（功能 / 数值逻辑 / 存档结构）才推进兼容线并自动废弃旧档。
   * 历史档案写的是三段串（如 `1.50.79`），取前两段与本兼容线同线 ⇒ 可继续加载。
   */
  function compatLine(v) {
    const t = normalizeVer(v);
    const p = t.split('.');
    return (p.length >= 2 && p[0] !== '' && p[1] !== '') ? `${p[0]}.${p[1]}` : t;
  }

  /** UI 展示用完整版本号（内核常量只有两段兼容线，优先取页面版本徽章的三段串） */
  function getDisplayVersion() {
    const tag = document.querySelector('.version-tag');
    if (tag && tag.textContent) {
      const m = tag.textContent.trim().match(/v?(\d+\.\d+\.\d+)/);
      if (m) return normalizeVer(m[1]);
    }
    return normalizeVer(DEFAULT_APP_VERSION);
  }

  function getCurrentAppVersion() {
    const s = getSim();
    if (s && typeof s.getAppVersion === 'function') {
      const v = normalizeVer(s.getAppVersion());
      if (v) return v;
    }
    const tag = document.querySelector('.version-tag');
    if (tag && tag.textContent) {
      const m = tag.textContent.trim().match(/v?(\d+\.\d+\.\d+)/);
      if (m) return normalizeVer(m[1]);
    }
    return normalizeVer(DEFAULT_APP_VERSION);
  }

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

  /**
   * ★ v1.50.8 存档门禁旁路开关：URL 携带 `?nogate=1`（或任意值的 nogate 参数）时
   * 跳过「先建立本地存档文件」弹窗直接进入模拟。供截图/演示/自动化预览等
   * 无需持久化存档的场景使用；注意该模式下自动保存没有文件句柄可写，仅内存演算，
   * 刷新页面世界即回到初始态。
   */
  function isSaveGateBypassed() {
    try {
      return new URLSearchParams(window.location.search).has('nogate');
    } catch (e) {
      return false;
    }
  }

  /** 与 RustWorld 的 seed 解析保持一致；地图预览不进入存档选择流程。 */
  function requestedStartupSeed() {
    const query = new URLSearchParams(window.location.search);
    if (query.has('mapOnly')) return null;
    const value = Number.parseInt(query.get('seed') || '', 10);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  async function hasReadableStartupSave() {
    const st = slotState.save1;
    if (!st || !st.handle) return false;
    try {
      await st.handle.getFile();
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 显式 seed 开局：旧槽位在用户选择前绝不能被自动读取或覆盖。 */
  async function bootstrapSeedChoice(seed) {
    const title = document.getElementById('startup-save-title');
    const createBtn = document.getElementById('startup-save-connect');
    const loadBtn = document.getElementById('startup-save-load');
    if (!createBtn || !loadBtn) return;
    if (title) title.textContent = '🧬 选择世界启动方式';
    setStartupGateMessage(`URL 指定种子 ${seed}。请选择用该种子建立新档，或读取已有存档；读取旧档将使用存档自身的种子。`);
    createBtn.textContent = '🆕 用此种子建立新档';
    loadBtn.style.display = (await hasReadableStartupSave()) ? 'inline-block' : 'none';
    if (loadBtn.style.display === 'none') {
      setStartupGateMessage(`URL 指定种子 ${seed}，当前没有可读取的本地存档文件。请创建一个新档后开始游戏。`);
    }
    if (!supportsFileAPI()) {
      createBtn.disabled = true;
      loadBtn.disabled = true;
      setStartupGateMessage('当前浏览器不兼容本地存档文件，请使用最新版 Chrome 或 Edge。', true);
      return;
    }

    createBtn.addEventListener('click', async () => {
      createBtn.disabled = true;
      loadBtn.disabled = true;
      try {
        // 不复用槽位 1：用户必须明确选择空文件，旧档及其 IDB 连接才不会被误覆盖。
        const handle = await window.showSaveFilePicker({
          suggestedName: `flowaccord-seed-${seed}.json`,
          types: [{ description: 'Flow & Accord 存档文件', accept: { 'application/json': ['.json'] } }],
        });
        const file = await handle.getFile();
        if (file.size !== 0) {
          setStartupGateMessage(`「${handle.name}」已有内容。请选择空文件建立新档，旧存档不会被覆盖。`, true);
          return;
        }
        if (!(await waitEngineReady(15000))) throw new Error('引擎尚未就绪');
        const previous = slotState.save1;
        slotState.save1 = { handle, fileName: handle.name, meta: null, lastSaved: 0, permError: false };
        const saved = await saveToSlot('save1');
        if (!saved) {
          if (previous) slotState.save1 = previous;
          else delete slotState.save1;
          setStartupGateMessage('新档写入失败，请重新选择空文件。', true);
          return;
        }
        await idbPut('save1', handle, handle.name);
        releaseStartupGate(`已用种子 ${seed} 建立新档，模拟开始`);
      } catch (e) {
        if (e.name !== 'AbortError') setStartupGateMessage(`建立新档失败：${e.message}`, true);
      } finally {
        createBtn.disabled = false;
        loadBtn.disabled = false;
      }
    });

    let chooseAnotherSave = false;
    loadBtn.addEventListener('click', async () => {
      createBtn.disabled = true;
      loadBtn.disabled = true;
      const previous = slotState.save1;
      try {
        let st = slotState.save1;
        if (chooseAnotherSave || !st || !st.handle) {
          const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'Flow & Accord 存档文件', accept: { 'application/json': ['.json'] } }],
          });
          st = { handle, fileName: handle.name, meta: null, lastSaved: 0, permError: false };
          slotState.save1 = st;
        }
        if (!(await requestHandlePermission(st.handle))) throw new Error('存档文件授权被拒绝');
        setStartupGateMessage('正在读取旧存档…');
        if (!(await autoLoadStartupSave('save1'))) {
          chooseAnotherSave = true;
          throw new Error('存档无法读取或版本不兼容');
        }
        await idbPut('save1', st.handle, st.fileName);
        releaseStartupGate('已读取旧存档，模拟继续');
      } catch (e) {
        if (previous) slotState.save1 = previous;
        else delete slotState.save1;
        if (e.name !== 'AbortError') setStartupGateMessage(`读取旧存档失败：${e.message}。可选择用 URL 种子建立新档。`, true);
      } finally {
        createBtn.disabled = false;
        loadBtn.disabled = false;
      }
    });
  }

  function setStartupGateMessage(message, error) {
    const el = document.getElementById('startup-save-message');
    if (el) { el.textContent = message; el.style.color = error ? '#f87171' : '#9fb3c8'; }
  }

  function showStartupDeleteBtn(show) {
    const el = document.getElementById('startup-save-delete');
    if (el) el.style.display = show ? 'inline-block' : 'none';
  }

  /**
   * ★ v1.50.81「删除旧存档」：清空文件内容 → 断开槽位与 IndexedDB 句柄
   * → 重建一个全新存档文件（走正常「建立存档文件」流程，用户可另选位置）。
   *
   * 删除语义：File System Access API 无 `remove()`，按官方推荐 `handle.remove()`（Chrome 110+）
   * 失败时回退「写空内容」；两者皆失败仍继续断开连接（句柄断开后旧档不再干扰启动）。
   */
  async function deleteStartupSave(slotId) {
    const st = slotState[slotId];
    if (!st || !st.handle) return { ok: false, msg: '没有已连接的存档文件' };
    let removed = false;
    try {
      if (typeof st.handle.remove === 'function') {
        await st.handle.remove();
        removed = true;
      }
    } catch (e) { /* 回退到写空 */ }
    if (!removed) {
      try {
        const w = await st.handle.createWritable();
        await w.write('');
        await w.close();
        removed = true;
      } catch (e) { /* 权限/占用：仍继续断开连接 */ }
    }
    await disconnectSlot(slotId);
    renderList();
    return {
      ok: true,
      msg: removed ? '旧存档已删除，请建立新的存档文件' : '旧存档无法删除但已断开连接，请建立新的存档文件',
    };
  }

  /**
   * ★ v1.50.81 判定存档是否**实质不可读**（读档必然失败）。
   *
   * 背景：兼容线（app_version 前两段）只覆盖「应用版本」这一个维度。存档还可能因
   * `format_version` 或 **`terrain_generator_version`**（地形生成器换版）被内核拒绝——
   * 后者在 `deserialize_save` 里是独立判据，旧世界无法续演，只能开新世界。
   * 前端此前只比兼容线，于是这类档案被判为「可兼容」→ 尝试读档 → 内核 -3 拒绝 →
   * 门禁停在「自动读取存档失败」，而唯一按钮仍写「建立存档文件」，玩家无法脱困。
   *
   * 返回 null = 可正常读档；否则返回原因描述串。
   */
  function getSaveIncompatReason(meta) {
    if (!meta) return null;
    if (meta.formatVersion !== SAVE_FORMAT_VERSION) {
      return `存档格式版本 v${meta.formatVersion}（当前支持 v${SAVE_FORMAT_VERSION}）`;
    }
    // 应用版本兼容线（前两段）：与内核 app_version_compat_line 同判据
    if (compatLine(meta.appVersion) !== compatLine(getCurrentAppVersion())) {
      return `存档兼容线 v${compatLine(meta.appVersion)}（当前 v${compatLine(getCurrentAppVersion())}）`;
    }
    // 地形生成器版本：内核 TERRAIN_GENERATOR_VERSION，经快照 generatorVersion 下发
    const gen = getSim() && getSim().terrain ? getSim().terrain.generatorVersion : 0;
    if (gen && meta.terrainGeneratorVersion && meta.terrainGeneratorVersion !== gen) {
      return `地形生成器版本 v${meta.terrainGeneratorVersion}（当前内核 v${gen}）`;
    }
    return null;
  }

  /** 读取存档文本失败/为空时的兜底原因（供门禁文案使用） */
  async function probeStartupSaveIssue(slotId) {
    const st = slotState[slotId];
    if (!st || !st.handle) return '尚未连接存档文件';
    try {
      const file = await st.handle.getFile();
      const text = await file.text();
      if (!text || !text.trim()) return '存档文件为空';
      let meta;
      try { meta = extractMeta(text); }
      catch (e) { return '存档文件不是合法 JSON'; }
      return getSaveIncompatReason(meta) || null;
    } catch (e) {
      return e && e.name === 'NotAllowedError' ? '存档文件授权被拒绝' : '存档文件读取失败';
    }
  }

  /** ★ v1.50.81 门禁「删除旧存档并新建」按钮：删档 → 重新走建立存档文件流程 */
  async function handleStartupDelete() {
    const btn = document.getElementById('startup-save-connect');
    const del = document.getElementById('startup-save-delete');
    if (del) del.disabled = true;
    if (btn) btn.disabled = true;
    setStartupGateMessage('正在删除旧存档…');
    const r = await deleteStartupSave('save1');
    if (del) { del.disabled = false; del.style.display = 'none'; }
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📁 建立新的存档文件';
    }
    setStartupGateMessage(`${r.msg}。点击下方按钮选择存档位置。`, !r.ok);
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
    const curVer = getCurrentAppVersion();
    if (!meta || meta.formatVersion !== SAVE_FORMAT_VERSION || compatLine(meta.appVersion) !== compatLine(curVer)) return false;
    // 引擎就绪前不可读档（world_load 依赖 wasm）；等待加载完成
    if (!(await waitEngineReady(15000))) return false;
    const s = getSim();
    if (!s || !s._ready) return false;
    const res = await s.loadWorld(text, meta);
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
    // ★ v1.50.8：?nogate=1 旁路——隐藏门禁弹窗并直接解除暂停，不连接任何存档文件
    if (isSaveGateBypassed()) {
      releaseStartupGate('已跳过存档门禁（?nogate=1）：无存档文件，仅内存演算');
      return;
    }
    const seed = requestedStartupSeed();
    if (seed !== null) {
      await bootstrapSeedChoice(seed);
      return;
    }
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
        // ★ v1.44.2：先等引擎 READY 再取版本号，避免用带 `v` 前缀的兜底串误判旧档
        await waitEngineReady(15000);
        await refreshSlotMeta('save1');
        const curVer = getCurrentAppVersion();
        // ★ v1.50.81：兼容判据加入「地形生成器版本」等内核独立门禁，
        //   否则旧地形档会被误判为可读取 → 自动读档必失败（-3）且门禁无出路。
        const isCompatible = st.meta
          && st.meta.formatVersion === SAVE_FORMAT_VERSION
          && compatLine(st.meta.appVersion) === compatLine(curVer)
          && !getSaveIncompatReason(st.meta);
        if (isCompatible) {
          setStartupGateMessage('正在自动读取存档…');
          const loaded = await autoLoadStartupSave('save1');
          if (loaded) {
            releaseStartupGate('已自动读取存档，模拟继续');
            return;
          }
        }
        // ★ v1.50.81：给出**具体不兼容原因**，并按需露出「删除旧存档」按钮——
        //   覆盖保存只能改写内容，删文件才能让「选择新存档文件」流程真正重新开始。
        const incompat = getSaveIncompatReason(st.meta) || await probeStartupSaveIssue('save1');
        if (st.isOutdated) {
          // ★ v1.37.1：检测到旧版本存档，自动废弃，引导覆盖保存新建世界
          setStartupGateMessage(`检测到旧版本存档「${st.fileName}」（存档版本 v${st.meta ? st.meta.appVersion : '未知'}，当前版本 v${getDisplayVersion()}），因中间版本号变更已自动废弃旧档。点击下方按钮覆盖写入新版本初始世界开始模拟。`, true);
          btn.textContent = '🆕 覆盖旧档并新建世界';
          showStartupDeleteBtn(true);
        } else if (incompat) {
          setStartupGateMessage(`存档「${st.fileName}」无法读取：${incompat}。该存档已无法续演，请删除后建立新存档（新世界将从新种子开局）。`, true);
          btn.textContent = '🆕 覆盖写入新存档';
          showStartupDeleteBtn(true);
        } else {
          // 存档为空/数据异常/读取失败：保留阻断，点击按钮可覆盖保存或重新连接
          setStartupGateMessage('自动读取存档失败，点击下方按钮可覆盖保存当前世界或重新连接存档文件。', true);
          showStartupDeleteBtn(true);
        }
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
        await waitEngineReady(15000);
        await refreshSlotMeta('save1');
        const curVerNow = getCurrentAppVersion();
        const isCompatibleNow = st2.meta && st2.meta.formatVersion === SAVE_FORMAT_VERSION && compatLine(st2.meta.appVersion) === compatLine(curVerNow) && !getSaveIncompatReason(st2.meta);
        if (isCompatibleNow) {
          setStartupGateMessage('正在自动读取存档…');
          const loaded = await autoLoadStartupSave('save1');
          if (loaded) {
            releaseStartupGate('已自动读取存档，模拟继续');
            return;
          }
          btn.disabled = false;
          const why = getSaveIncompatReason(st2.meta) || await probeStartupSaveIssue('save1');
          setStartupGateMessage(why ? `存档无法读取：${why}。请删除旧存档后建立新存档。` : '存档读取失败，请重试。', true);
          if (why) showStartupDeleteBtn(true);
          return;
        }
        // 文件为空或版本不兼容（含旧版本被自动废弃）：覆盖保存当前世界（相当于新建当前版本存档）
        setStartupGateMessage('正在覆盖写入新版本初始世界…');
        const s = getSim();
        const saved = s && s._ready ? await saveToSlot('save1') : false;
        if (saved) {
          releaseStartupGate('已废弃旧档并建立新版本存档，模拟开始');
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

    // ★ v1.50.81：删除旧存档按钮（仅在探测到实质不兼容 / 读取失败时露出）
    const delBtn = document.getElementById('startup-save-delete');
    if (delBtn) delBtn.addEventListener('click', handleStartupDelete, { once: false });
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
      // ★ v1.50.81：地形生成器版本是内核独立门禁（`deserialize_save` 第三条判据），
      //   与 app_version 兼容线无关；缺该字段的旧档按 0 处理（不据此拒绝，交由内核裁决）。
      terrainGeneratorVersion: obj.terrain_generator_version || 0,
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
      const curVer = getCurrentAppVersion();
      st.meta = meta;
      st.permError = false;
      st.lastSaved = file.lastModified;
      st.isOutdated = (meta.formatVersion !== SAVE_FORMAT_VERSION || compatLine(meta.appVersion) !== compatLine(curVer));
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        // 权限未持久化：保留槽位与 IndexedDB 记录，等待用户手势内重授
        st.permError = true;
      } else {
        st.meta = null;
        st.isOutdated = false;
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
    const json = await s.saveWorld();
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
    st.isOutdated = false;
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
    const curVer = getCurrentAppVersion();
    if (meta.formatVersion !== SAVE_FORMAT_VERSION) {
      setStatus(`存档格式版本 v${meta.formatVersion}，当前支持 v${SAVE_FORMAT_VERSION}`, 'err');
      return;
    }
    if (compatLine(meta.appVersion) !== compatLine(curVer)) {
      setStatus(`存档兼容线 (v${compatLine(meta.appVersion)}) 与当前兼容线 (v${compatLine(curVer)}) 不一致，已自动废弃无法读取（中间版本号变更）。请覆盖保存当前版本世界。`, 'err');
      return;
    }
    await applySave(text, meta, `${SLOTS.find(s => s.id === slotId).name}（${st.fileName}）`);
  }

  /** 断开槽位的文件连接（显式操作：删除内存状态与 IndexedDB 句柄记录） */
  async function disconnectSlot(slotId) {
    delete slotState[slotId];
    await idbDelete(slotId);
    renderList();
    setStatus(`已断开${SLOTS.find(s => s.id === slotId).name}的文件连接`, 'ok');
  }

  async function applySave(json, meta, label) {
    const s = getSim();
    if (!s || !s._ready) { setStatus('引擎尚未就绪，请稍候重试', 'err'); return; }
    const res = await s.loadWorld(json, meta);
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
      let badgeHtml;
      if (!st) {
        badgeHtml = autoBadge || `<span class="save-slot-badge muted">未连接</span>`;
      } else if (st.permError) {
        badgeHtml = '<span class="save-slot-badge" style="color:#fbbf24; border-color:rgba(251,191,36,.4);">🔐 待授权</span>';
      } else if (st.isOutdated) {
        badgeHtml = `<span class="save-slot-badge" style="color:#f87171; background:rgba(239,68,68,0.12); border-color:rgba(239,68,68,0.4);">⚠️ 已废弃 (v${st.meta ? st.meta.appVersion : '—'})</span>`;
      } else {
        badgeHtml = `<span class="save-slot-badge">v${st.meta ? st.meta.appVersion : '—'}</span>`;
      }
      head.innerHTML = `<span class="save-slot-name">${slot.icon} ${slot.name}</span>` + badgeHtml;
      card.appendChild(head);

      const info = document.createElement('div');
      info.className = 'save-slot-meta';
      const curVer = getCurrentAppVersion();
      if (st && st.meta && !st.isOutdated) {
        info.innerHTML =
          `<span title="存档文件">📄 <b class="mono-num">${st.fileName}</b></span>` +
          `<span title="模拟 Tick">⏱️ <b class="mono-num">${st.meta.tick}</b></span>` +
          `<span title="存活人口">👤 <b class="mono-num">${st.meta.population}</b> 人</span>` +
          `<span title="存续家户">🏠 <b class="mono-num">${st.meta.households}</b> 户</span>`;
      } else if (st && st.isOutdated) {
        info.innerHTML = `<span title="存档文件">📄 <b class="mono-num">${st.fileName}</b></span>` +
          `<div class="save-slot-desc" style="color:#fca5a5; margin-top:4px; line-height:1.5;">⚠️ 存档兼容线 (v${st.meta ? compatLine(st.meta.appVersion) : '—'}) 与当前兼容线 (v${compatLine(curVer)}) 不一致，已自动废弃。请点击下方「覆盖保存」重写为当前版本。</div>`;
      } else if (st) {
        info.innerHTML = `<span title="存档文件">📄 <b class="mono-num">${st.fileName}</b></span>` +
          `<span class="save-slot-desc">文件为空或数据异常，点击下方「保存」写入当前世界</span>`;
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
          if (act === 'load' && (!st.meta || st.isOutdated)) {
            btn.disabled = true;
            btn.title = st.isOutdated ? '旧版本存档已自动废弃，无法读取' : '无有效存档数据';
          }
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
    const gate = document.getElementById('startup-save-gate');
    if (gate && gate.style.display !== 'none') return;
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
        const curVer = getCurrentAppVersion();
        if (meta.formatVersion !== SAVE_FORMAT_VERSION) throw new Error(`存档格式版本 v${meta.formatVersion}，当前支持 v${SAVE_FORMAT_VERSION}`);
        if (compatLine(meta.appVersion) !== compatLine(curVer)) throw new Error(`存档兼容线 v${compatLine(meta.appVersion)} 与当前兼容线 v${compatLine(curVer)} 不一致，旧版本存档已自动废弃（中间版本号变更）`);
        await applySave(text, meta, `导入文件（${file.name}）`);
      } catch (err) { setStatus('导入失败：' + err.message, 'err'); }
      fileInput.value = '';
    });
    const btnExport = document.getElementById('btn-export-save');
    if (btnExport) btnExport.addEventListener('click', async () => {
      const s = getSim();
      if (!s || !s._ready) { setStatus('引擎尚未就绪，请稍候重试', 'err'); return; }
      const json = await s.saveWorld();
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
      // ★ v1.50.81 对外暴露诊断与脱困能力：供控制台/自动化排查「存档读不了」场景
      //   （incompatReason 返回具体不兼容原因，null = 可正常读档）
      incompatReason: (meta) => getSaveIncompatReason(meta),
      extractMeta: extractMeta,
      deleteSave: (slotId) => deleteStartupSave(slotId || 'save1'),
      showStartupDelete: showStartupDeleteBtn,
      slotMeta: (slotId) => (slotState[slotId || 'save1'] || {}).meta || null,
    };

    // 监听重置完成事件：必须等 Worker 应用新世界快照后再自动保存，避免旧世界竞态写回。
    window.addEventListener('ecology-reset-complete', async () => {
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
