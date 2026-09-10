// === RustWorld: 由 Rust (wasm) 确定性引擎驱动的世界适配层 ===
    // 与 WorldSimulation 保持同构接口，render.js / main.js 无需改动。
    // AI (动机决策/加权A*寻路/IDM运动/家庭房屋生命周期) 全部运行在编译为 wasm 的 sim_core 中。
    class RustWorld {
      constructor() {
        // 前端展示与交互状态 (与原 JS 引擎同构)
        this._isPaused = false;
        this.headless = false; // 🧠 无头模式: 只推进模拟、跳过画布渲染
        this.debugMode = false; // 🐞 调试模式: 展示 Tick / CPU 耗时 / 内存占用
        this.tickMs = 0; // 内核步进耗时 (EMA 平滑, ms)
        this.snapMs = 0; // 快照解析耗时 (EMA 平滑, ms)
        this._speedMult = 2;
        this.showTerrain = true;
        this.showGrid = false;   // 📐 地形网格线显隐 (默认隐藏呈现纯净沙盘，按 'G' 键切换)
        this.showRoadHeatmap = false; // 🛣️ 道路等级热力图模式 (默认关闭呈现自然地貌土路，按 'R' 键切换)
        this.showLanes = true;   // 🛣️ 路网显隐 (false = 隐藏全部车道与悬浮提示)
        this.showAgents = true;  // 👤 部落民显隐 (false = 隐藏全部族人，且不再参与点击拾取)
        this.selectionType = 'agent';
        this.selectedAgentId = 1;
        this.selectedPoiId = null;
        this.selectedHouseId = null;
        this.totalRoyalPrivy = 0; // ★ v1.35.2 全局所有国王累计收到的内帑总额
        this.totalImperialPrivy = 0; // ★ M5 全局所有皇帝累计收到的帝国公帑总额

        // 世界视图对象 (由快照映射而来)
        this.agents = [];
        this.agentArchive = new Map(); // 族人全量生命周期档案库 (含已故先祖，保障断代/绝嗣穿梭不跳帧)
        this._consumedDeathIds = new Set(); // ★ v1.8.7 已消费的死亡/流产墓碑 id（防快照重复读档误处理）
        this.houses = [];
        this.pois = [];
        // ★ 账本与家户/婚姻登记簿 (v0.9.72 M1 账本系统)
        this.households = [];  // 家户列表（家庭跟着男人走：以男性户主为锚）
        this.marriages = [];   // 婚姻列表（一人终生多段婚姻全留痕）
        this.publicGranaryBalances = {};  // ★ M2: 公仓兜底账本余额
        this.clans = [];                   // ★ M3: 宗族登记簿
        this.regions = [];                 // ★ M4: 地区/王国登记簿
        this.empires = [];                 // ★ M5: 帝国/联邦上层登记簿
        this.expeditionTargets = new Map();// ★ M4: 远征目标反查表 agent_id -> camp_id
        this.auctionHistory = [];          // ★ 房屋报价中心历史受理记录 (256 环形缓冲区)
        this.terrain = { gridSize: 60, minZ: 0, maxZ: 1, cells: [] };
        this.network = { lanes: new Map(), nodes: new Map() };
        this.totalBirths = 0;
        this.totalDeaths = 0;
        this.totalDeathsNatural = 0;   // ☘️ 自然死亡 (寿终正寝 / 寿命耗尽)
        this.totalDeathsUnnatural = 0; // ⚡ 非自然死亡 (饥荒饿死 / 脱水渴死)
        this.totalMiscarriages = 0;
        this.totalHouseholds = 0; // ★ 历史累计创建家户总数（含已解散；households 快照仅存续活跃家户）
        this.currentSeason = 'Spring';
        this.temperature = 20.0;
        this.seasonTimer = 0.0;
        this.elNinoPhase = 0.0;
        this.climateEpochPhase = 0.0;
        this.tickCount = 0;
        this.tickRate = 0;
        this._lastSnapshotRealTime = performance.now();
        // ★ v1.22.6 生态大盘产速倍率（内核唯一真相源，随快照下发；读档后自动回填存档值）
        // 榷场粮食再生复用 berry 槽位（内核无独立粮食倍率），见 world_tick.rs
        // ★ 创世配置：config.poi-rates.js 已在本脚本前读取 localStorage。
        // 该值随 INIT/RESET 在 world_create 前发送给 Worker，并在第 0 帧快照前写入内核。
        this.regenMultipliers = this._poiRegenMultipliersFromStorage();

        // 引擎状态与 Web Worker 架构
        this._worker = null;
        this._ready = false;
        this._engineSeed = Date.now();
        this._terrainCached = false;
        this._lastEvent = null;
        this._trails = new Map();
        this._historyCheckpoints = [];
        this._lastCheckpointTick = -1;
        this._rewindMinTick = 0;
        this._rewindCheckpointCount = 0;
        this._rewindProgress = null;
        this.onRewindProgress = null;
        this._pendingRequests = new Map();
        this._reqSeq = 0;
        this._lastSaveJson = null;
        this._lastSaveError = '';
        // ★ M4 二进制快照：车道/节点几何缓存（geom_version 不变时复用对象，每帧只覆写 wear）
        this._laneCache = null;   // 车道视图对象数组（与 lane_wear 下标一一对应）
        this._geomVersion = null;
        this._appVersion = '1.49.0';
        this._wasmBytes = 0;
        this._setEngineStatus('正在加载生态演算引擎 (Worker)…', 'loading');

        // 启动专用 Web Worker (Phase 1 独立仿真线程)
        this._initWorker();
      }

      get isPaused() {
        return this._isPaused;
      }

      set isPaused(val) {
        this._isPaused = !!val;
        if (this._isPaused) {
          this.tickRate = 0;
        }
        if (this._worker) {
          this._worker.postMessage({ type: 'PAUSE', isPaused: this._isPaused });
        }
      }

      get speedMult() {
        return this._speedMult;
      }

      set speedMult(val) {
        this._speedMult = Math.max(1, parseInt(val, 10) || 1);
        if (this._worker) {
          this._worker.postMessage({ type: 'SPEED', speedMult: this._speedMult });
        }
      }

      _initWorker() {
        try {
          this._worker = new Worker('js/sim_worker.js');
          this._worker.onmessage = (e) => this._onWorkerMessage(e.data);
          this._worker.onerror = (err) => {
            console.error('[RustWorld] Web Worker 异常:', err);
            this._setEngineStatus('Worker 异常: ' + (err.message || '请检查控制台'), 'error');
          };

          const wasmUrl = new URL('rust/sim_wasm.wasm?v=' + Date.now(), window.location.href).href;
          const configObj = Object.assign({}, window.SIM_CONFIG);
          if (window.SIM_HOUSE_UPGRADE_COST) {
            Object.assign(configObj, window.SIM_HOUSE_UPGRADE_COST);
          }

          this._worker.postMessage({
            type: 'INIT',
            wasmUrl,
            seed: this._engineSeed,
            agentCount: 20,
            campCount: this._campCountFromConfig(),
            config: configObj,
            regenMultipliers: this._poiRegenMultipliersFromStorage(),
          });
        } catch (e) {
          this._setEngineStatus('无法创建 Web Worker (请确保通过 HTTP 服务访问): ' + e.message, 'error');
          console.error('[RustWorld] 初始化 Worker 失败:', e);
        }
      }

      _onWorkerMessage(msg) {
        if (!msg || typeof msg !== 'object') return;
        switch (msg.type) {
          case 'READY': {
            this._ready = true;
            this._engineSeed = msg.seed;
            this._appVersion = msg.appVersion || '1.49.0';
            this._wasmBytes = msg.wasmBytes || 0;
            this._applyRewindMeta(msg.rewind);
            this._setEngineStatus('', 'ready');
            // ★ M4：注入枚举名称表 + 清空解码器字符串缓存（引擎全新 → 缓存失效）
            // ★ M5-0 结论：帧间对象池化为**负收益**（快照对象短命，V8 新生代回收更快，池化反致晋升老生代），
            // 故 `setReuse()` 已退化为空操作，此处不再调用；引擎全新 → 必须清空驻留表缓存。
            if (window.SnapshotBin) {
              if (msg.enumTableJson) window.SnapshotBin.setEnumTables(msg.enumTableJson);
              window.SnapshotBin.resetCaches();
            }
            if (msg.snapshot) {
              // ★ 动态季节光照：全新引擎 → 光相立即对齐（不做平滑）
              if (window.SimLighting) window.SimLighting.resync();
              this._applySnapshot(msg.snapshot, true);
            }
            console.info(`[RustWorld Worker] sim_core wasm 引擎已在 Worker 中接管计算 (开局种子: ${this._engineSeed})`);
            if (this._isPaused) {
              this._worker.postMessage({ type: 'PAUSE', isPaused: true });
            }
            this._worker.postMessage({ type: 'ACK' });
            break;
          }
          case 'SNAPSHOT': {
            this._lastSnapshotRealTime = performance.now();
            this._wasmBytes = msg.wasmBytes || this._wasmBytes;
            if (this.debugMode && typeof msg.tickMs === 'number') {
              this.tickMs += (msg.tickMs - this.tickMs) * 0.15;
            }
            if (typeof msg.tickRate === 'number') {
              this.tickRate = msg.tickRate;
            }
            const t0 = performance.now();
            if (msg.snapshot) {
              this._applySnapshot(msg.snapshot, false);
            }
            this._applyRewindMeta(msg.rewind);
            const t1 = performance.now();
            if (this.debugMode) {
              this.snapMs += ((t1 - t0) - this.snapMs) * 0.15;
            }
            this._worker.postMessage({ type: 'ACK' });
            break;
          }
          case 'SAVE_RESULT': {
            if (msg.ok && msg.json) {
              this._lastSaveJson = msg.json;
            }
            this._lastSaveError = msg.error || '';
            const resolver = this._pendingRequests.get(msg.reqId);
            if (resolver) {
              this._pendingRequests.delete(msg.reqId);
              resolver(msg.ok ? msg.json : null);
            }
            break;
          }
          case 'LOAD_RESULT': {
            this._lastSaveError = msg.error || '';
            this._applyRewindMeta(msg.rewind);
            const resolver = this._pendingRequests.get(msg.reqId);
            if (resolver) {
              this._pendingRequests.delete(msg.reqId);
              resolver({ ok: msg.ok, error: msg.error });
            }
            if (msg.ok && msg.snapshot) {
              // ★ M4：读档后引擎重建 → 清空解码器字符串缓存与车道几何缓存
              if (window.SnapshotBin) window.SnapshotBin.resetCaches();
              // ★ 动态季节光照：读档时间可能倒退 → 光相立即对齐
              if (window.SimLighting) window.SimLighting.resync();
              this._applySnapshot(msg.snapshot, true);
            }
            break;
          }
          case 'REWIND_RESULT': {
            this._applyRewindMeta(msg.rewind);
            const resolver = this._pendingRequests.get(msg.reqId);
            if (resolver) {
              this._pendingRequests.delete(msg.reqId);
              resolver({ ok: msg.ok, error: msg.error, tick: msg.tick != null ? msg.tick : (msg.snapshot && msg.snapshot.tick !== undefined ? msg.snapshot.tick : undefined) });
            }
            if (msg.ok && msg.snapshot) {
              if (window.SnapshotBin) window.SnapshotBin.resetCaches();
              // ★ 动态季节光照：时光倒流时间倒退 → 光相立即对齐
              if (window.SimLighting) window.SimLighting.resync();
              this._applySnapshot(msg.snapshot, true);
            }
            // 回滚结果同样携带一帧完整快照；确认消费后解除 Worker 的背压，
            // 否则从暂停恢复时可能因遗留 ACK 状态而继续演算却不再刷新画面。
            this._worker.postMessage({ type: 'ACK' });
            break;
          }
          case 'REWIND_PROGRESS': {
            this._rewindProgress = { tick: msg.tick, targetTick: msg.targetTick };
            if (typeof this.onRewindProgress === 'function') this.onRewindProgress(this._rewindProgress);
            break;
          }
          case 'RESET_DONE': {
            this._applyRewindMeta(msg.rewind);
            if (msg.snapshot) {
              // ★ M4：重置后引擎全新 → 清空解码器字符串缓存
              if (window.SnapshotBin) window.SnapshotBin.resetCaches();
              // ★ 动态季节光照：重置 → 光相立即对齐
              if (window.SimLighting) window.SimLighting.resync();
              this._applySnapshot(msg.snapshot, true);
            }
            this._worker.postMessage({ type: 'ACK' });
            break;
          }
          case 'ERROR': {
            this._setEngineStatus(msg.error || 'Worker 运行时错误', 'error');
            console.error('[RustWorld Worker]', msg.error);
            break;
          }
        }
      }

      _setEngineStatus(message, state) {
        const el = document.getElementById('engine-status');
        if (!el) return;
        el.textContent = message;
        el.dataset.state = state;
        el.style.display = state === 'ready' ? 'none' : 'flex';
      }

      _applyRewindMeta(meta) {
        if (!meta || typeof meta !== 'object') return;
        if (Number.isFinite(meta.minTick)) this._rewindMinTick = meta.minTick;
        if (Number.isFinite(meta.checkpointCount)) this._rewindCheckpointCount = meta.checkpointCount;
      }

      // 从 window.SIM_CONFIG 读取营地数量（播种前传入 world_create，见 §4.7）
      _campCountFromConfig() {
        const n = window.SIM_CONFIG && window.SIM_CONFIG.countCamps;
        if (typeof n === 'number' && n > 0) return n;
        return 4; // 与 Rust config.rs COUNT_CAMPS 默认一致
      }

      _poiRegenMultipliersFromStorage() {
        if (window.FlowAccordPoiRates && typeof window.FlowAccordPoiRates.get === 'function') {
          return window.FlowAccordPoiRates.get();
        }
        return { water: 1.0, berry: 1.0, wood: 1.0, stone: 1.0, gold: 1.0 };
      }

      // 应用动态配置到 WASM 仿真引擎 (支持热更新，免重新编译)
      applyConfig(cfg) {
        if (!this._ready) return false;
        const configObj = Object.assign({}, cfg || window.SIM_CONFIG);
        if (!configObj) return false;
        // ★ M8 合并「升级材料成本矩阵」拆分配置（config.house-upgrade-cost.js，20 字段），
        // 该文件已由 index.html 在本脚本之前加载；合并后随主配置一并注入 WASM 内核。
        if (window.SIM_HOUSE_UPGRADE_COST) {
          Object.assign(configObj, window.SIM_HOUSE_UPGRADE_COST);
        }
        if (this._worker) {
          this._worker.postMessage({ type: 'CONFIG', config: configObj });
          return true;
        }
        return false;
      }

      // 清空当前选中 (agent / poi / house)，关闭 Inspector 面板
      deselect() {
        this.selectionType = null;
        this.selectedAgentId = null;
        this.selectedPoiId = null;
        this.selectedHouseId = null;
      }

      // 获取族人对象 (优先活跃列表，若已故脱离活跃列表则从先祖档案库中检索)
      getAgent(id) {
        if (id === null || id === undefined) return null;
        const numId = typeof id === 'string' ? parseInt(id, 10) : id;
        if (isNaN(numId)) return null;
        return this.agents.find(a => a.id === numId) || this.agentArchive.get(numId) || null;
      }

      // ★ 获取某 agent 所属的家户（家庭跟着男人走）
      getHouseholdOfAgent(agentId) {
        if (agentId === null || agentId === undefined) return null;
        const numId = typeof agentId === 'string' ? parseInt(agentId, 10) : agentId;
        return this.households.find(h => h.members.includes(numId)) || null;
      }

      // ★ 获取某人当前存续婚姻
      getActiveMarriageOf(agentId) {
        if (agentId === null || agentId === undefined) return null;
        const numId = typeof agentId === 'string' ? parseInt(agentId, 10) : agentId;
        return this.marriages.find(m => m.isActive && (m.husbandId === numId || m.wifeId === numId)) || null;
      }

      // ★ 获取某人的全部婚姻历史（含已封账段）
      getAllMarriagesOf(agentId) {
        if (agentId === null || agentId === undefined) return [];
        const numId = typeof agentId === 'string' ? parseInt(agentId, 10) : agentId;
        return this.marriages.filter(m => m.husbandId === numId || m.wifeId === numId);
      }

      // ============ 引擎驱动 (Web Worker 异步解耦) ============
      tick() {
        // 仿真由 Worker 独立线程按 speedMult 自主推进与节流投递，主线程 tick 保持零阻塞
      }

      // ============ 🐞 调试统计 ============
      getDebugStats() {
        const mem = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
        const isStalled = !this._isPaused && this._lastSnapshotRealTime && (performance.now() - this._lastSnapshotRealTime > 1500);
        return {
          tick: this.tickCount,
          tickRate: (this._isPaused || isStalled) ? 0 : (this.tickRate || 0),
          tickMs: this.tickMs,
          snapMs: this.snapMs,
          wasmBytes: this._wasmBytes,
          jsHeapUsed: mem ? mem.usedJSHeapSize : 0,
          jsHeapLimit: mem ? mem.jsHeapSizeLimit : 0,
          memSupported: !!mem,
        };
      }

      initEcology(agentCount) {
        this._engineSeed = Date.now();
        this._terrainCached = false;
        this._lastEvent = null;
        this._trails.clear();
        this.agentArchive.clear();
        this._consumedDeathIds.clear();
        this._historyCheckpoints = [];
        this._lastCheckpointTick = -1;
        this.deselect();
        if (this._worker) {
          const cfg = Object.assign({}, window.SIM_CONFIG);
          if (window.SIM_HOUSE_UPGRADE_COST) {
            Object.assign(cfg, window.SIM_HOUSE_UPGRADE_COST);
          }
          this._worker.postMessage({
            type: 'RESET',
            seed: this._engineSeed,
            agentCount: agentCount || 20,
            campCount: this._campCountFromConfig(),
            config: cfg,
            regenMultipliers: this._poiRegenMultipliersFromStorage(),
          });
        }
      }

      // ============ 💾 读档 / 存档 (v1.7.0 / v1.38.0 Worker 适配) ============

      /** 读取内核最近一次存档/读档错误文本（无错误返回空串） */
      readSaveError() {
        return this._lastSaveError || '';
      }

      /**
       * 获取内核应用版本号（与 SAVE_APP_VERSION 保持一致）
       * @returns {string}
       */
      getAppVersion() {
        return this._appVersion || '1.49.0';
      }

      /**
       * 导出当前世界全量存档 JSON（Promise 异步返回；若未就绪返回 Promise<null>）
       * @returns {Promise<string|null>}
       */
      saveWorld() {
        if (!this._ready || !this._worker) return Promise.resolve(this._lastSaveJson);
        const reqId = ++this._reqSeq;
        return new Promise((resolve) => {
          this._pendingRequests.set(reqId, resolve);
          this._worker.postMessage({ type: 'SAVE', reqId });
        });
      }

      /**
       * 载入存档 JSON 并覆盖当前世界
       *
       * 成功后清空前端全部派生缓存（轨迹、先祖档案、地形缓存、选中态）并强制重建地形快照。
       * 注意：存档自带 SimConfig，读档后**不**重新注入 window.SIM_CONFIG，
       * 以免前端热调参覆盖存档时的运行参数、破坏续演语义。
       *
       * @param {string} jsonStr 存档 JSON 文本
       * @param {{seed?:number}} [meta] 可选槽位元信息（用于同步引擎种子展示）
       * @returns {Promise<{ok:boolean, error?:string}>}
       */
      loadWorld(jsonStr, meta) {
        if (!this._ready || !this._worker) {
          return Promise.resolve({ ok: false, error: 'WASM 引擎尚未就绪' });
        }
        if (typeof jsonStr !== 'string' || jsonStr.length === 0) {
          return Promise.resolve({ ok: false, error: '存档内容为空' });
        }
        this._trails.clear();
        this.agentArchive.clear();
        this._consumedDeathIds.clear();
        this._lastEvent = null;
        this._terrainCached = false;
        this.deselect();
        if (meta && typeof meta.seed === 'number') this._engineSeed = meta.seed;

        const reqId = ++this._reqSeq;
        return new Promise((resolve) => {
          this._pendingRequests.set(reqId, (res) => {
            if (res.ok) {
              this._historyCheckpoints = [];
              this._lastCheckpointTick = -1;
            }
            resolve(res);
          });
          this._worker.postMessage({ type: 'LOAD', reqId, jsonStr, meta });
        });
      }

      // ============ ⏪ 时光倒流控制器支持 ============
      _recordHistoryCheckpoint() {
        // 历史检查点由 Worker 在步进时自主录制与管理，主线程免重复开销
      }

      rewindToTick(targetTick) {
        if (!this._ready || !this._worker) return Promise.resolve({ ok: false, error: 'WASM 引擎尚未就绪' });
        targetTick = Math.round(Number(targetTick));
        if (isNaN(targetTick) || targetTick < 0) return Promise.resolve({ ok: false, error: '目标 Tick 必须为非负整数' });
        const reqId = ++this._reqSeq;
        return new Promise((resolve) => {
          this._pendingRequests.set(reqId, (res) => {
            if (res.ok) {
              this.isPaused = true;
              const btnPause = document.getElementById('btn-pause');
              if (btnPause) btnPause.textContent = '▶️ 继续模拟 (空格)';
              this.logEvent(`⏪ 时光倒流：世界已成功回滚至 Tick ${targetTick}（第 ${(targetTick / 60).toFixed(1)} 游戏小时）`, 'camp');
            }
            resolve(res);
          });
          this._worker.postMessage({ type: 'REWIND', reqId, targetTick });
        });
      }

      getRewindInfo() {
        const currentTick = this.tickCount || 0;
        return {
          currentTick,
          minTick: Math.min(this._rewindMinTick || 0, currentTick),
          maxTick: currentTick,
          checkpointCount: this._rewindCheckpointCount || 0,
        };
      }

      _setRegenMultiplier(key, which, value) {
        const mult = Math.min(5.0, Math.max(0.0, Number(value) || 0.0));
        this.regenMultipliers[key] = mult;
        if (window.FlowAccordPoiRates && typeof window.FlowAccordPoiRates.save === 'function') {
          window.FlowAccordPoiRates.save(this.regenMultipliers);
        }
        if (this._worker) this._worker.postMessage({ type: 'SET_REGEN', which, mult });
      }
      setWaterRegenMultiplier(m) { this._setRegenMultiplier('water', 0, m); }
      setBerryRegenMultiplier(m) { this._setRegenMultiplier('berry', 1, m); }
      setWoodRegenMultiplier(m)  { this._setRegenMultiplier('wood', 2, m); }
      setStoneRegenMultiplier(m) { this._setRegenMultiplier('stone', 3, m); }
      setGoldRegenMultiplier(m)  { this._setRegenMultiplier('gold', 4, m); }

      logEvent(msg, type = '') {
        const list = document.getElementById('log-list');
        if (!list) return;
        const entry = document.createElement('div');
        entry.className = 'log-entry ' + type;
        entry.textContent = '[Tick ' + this.tickCount + '] ' + msg;
        list.appendChild(entry);
        while (list.children.length > 8) list.removeChild(list.firstChild);
      }

      // ============ 快照拉取与视图映射 ============
      _pullSnapshot(forceTerrain) {
        if (this._worker && forceTerrain) {
          this._worker.postMessage({ type: 'REQUIRE_TERRAIN' });
        }
      }

      _applySnapshot(snap, forceTerrain) {
        if (!snap) return;
        // ★ T1：快照通道已收敛为单一 FABS 二进制帧（worker 转移所有权）→ 解码为视图对象
        if (typeof ArrayBuffer !== 'undefined' && (snap instanceof ArrayBuffer || (ArrayBuffer.isView(snap) && snap.BYTES_PER_ELEMENT === 1))) {
          if (!window.SnapshotBin) return;
          const bytes = snap instanceof ArrayBuffer ? new Uint8Array(snap) : snap;
          snap = window.SnapshotBin.decode(bytes);
          if (!snap) return;
        }
        this.tickCount = snap.tick;
        this.totalBirths = snap.total_births;
        this.totalDeaths = snap.total_deaths;
        this.totalDeathsNatural = snap.total_deaths_natural || 0;
        this.totalDeathsUnnatural = snap.total_deaths_unnatural || 0;
        this.totalMiscarriages = snap.total_miscarriages;
        this.totalHouseholds = snap.total_households || (snap.households ? snap.households.length : 0);
        this.totalRoyalPrivy = snap.total_royal_privy || 0;
        this.totalImperialPrivy = snap.total_imperial_privy || 0;
        this.auctionStats = {
          started: snap.auction_started || 0,
          sold: snap.auction_sold || 0,
          flopped: snap.auction_flopped || 0,
        };
        this.auctionHistory = (snap.auction_history || []).map(r => ({
          houseId: r.house_id, tier: r.tier, campId: r.camp_id, tick: r.tick,
          buyerId: r.buyer_id, price: r.price, durability: r.durability,
          isFlop: !!r.is_flop, totalBidsCount: r.total_bids_count || 0, reason: r.reason || '',
        }));
        this.currentSeason = snap.season;
        this.temperature = snap.temperature;
        this.seasonTimer = snap.season_timer != null ? snap.season_timer : 0.0;
        // ★ 动态季节光照：季节内进度（FABS/JSON 均已下发，此前未映射）
        this.seasonProgress = (typeof snap.season_progress === 'number' && isFinite(snap.season_progress))
          ? snap.season_progress : null;
        this.elNinoPhase = snap.el_nino_phase != null ? snap.el_nino_phase : 0.0;
        this.climateEpochPhase = snap.climate_epoch_phase != null ? snap.climate_epoch_phase : 0.0;

        // ★ v1.22.6 生态大盘产速倍率（内核唯一真相源；缺省 1.0 兼容旧快照）
        // POI 卡片生效产速与生态大盘滑块位置均由本组数值驱动，保证两处数字一致
        this.regenMultipliers = {
          water: snap.water_regen_multiplier != null ? snap.water_regen_multiplier : 1.0,
          berry: snap.berry_regen_multiplier != null ? snap.berry_regen_multiplier : 1.0,
          wood: snap.wood_regen_multiplier != null ? snap.wood_regen_multiplier : 1.0,
          stone: snap.stone_regen_multiplier != null ? snap.stone_regen_multiplier : 1.0,
          gold: snap.gold_regen_multiplier != null ? snap.gold_regen_multiplier : 1.0,
        };

        // 事件日志: 仅记录新增事件
        if (snap.last_mutation_event && snap.last_mutation_event !== this._lastEvent) {
          this._lastEvent = snap.last_mutation_event;
          this.logEvent(snap.last_mutation_event, '');
        }

        // --- 地形 (仅首次/重开时重建，静态网格空数组时跳过) ---
        if ((!this._terrainCached || forceTerrain) && snap.terrain_cells && snap.terrain_cells.length > 0) {
          const w = snap.grid_w, h = snap.grid_h;
          const worldSize = snap.world_size || 764.0;
          const half = worldSize / 2;
          const cells = new Array(w * h);
          let minZ = Infinity, maxZ = -Infinity;
          for (let gy = 0; gy < h; gy++) {
            for (let gx = 0; gx < w; gx++) {
              const idx = gy * w + gx;
              const wx = (gx / (w - 1)) * worldSize - half;
              const wy = (gy / (h - 1)) * worldSize - half;
              const cellData = snap.terrain_cells[idx] || { elevation: 0, slope_angle: 0, surface_kind: 'DryGround', natural_fertility: 1, water_body_id: null, feature_flags: 0 };
              const e = cellData.elevation;
              const slopeAngle = cellData.slope_angle;
              if (e < minZ) minZ = e;
              if (e > maxZ) maxZ = e;
              cells[idx] = {
                wx, wy, elev: e, slopeAngle, dzdx: 0, dzdy: 0,
                surfaceKind: cellData.surface_kind || 'DryGround',
                naturalFertility: cellData.natural_fertility != null ? cellData.natural_fertility : 1,
                waterBodyId: cellData.water_body_id != null ? cellData.water_body_id : null,
                featureFlags: cellData.feature_flags || 0,
              };
            }
          }
          const step = worldSize / (w - 1);
          // ★ 动态季节光照（docs/27-plan-seasonal-lighting.md §4）：
          //   一次性预存单位法线 / 无光反照率 / 坡度 AO；光档变化时由 SimLighting.relightTerrain()
          //   只重算光因子并原地写回 cell.color，避免每次整片重建颜色与字符串。
          const cellCount = w * h;
          const nxArr = new Float32Array(cellCount), nyArr = new Float32Array(cellCount), nzArr = new Float32Array(cellCount);
          const aoArr = new Float32Array(cellCount);
          const albR = new Float32Array(cellCount), albG = new Float32Array(cellCount), albB = new Float32Array(cellCount);
          for (let gy = 0; gy < h; gy++) {
            for (let gx = 0; gx < w; gx++) {
              const idx = gy * w + gx;
              const eR = gx < w - 1 ? cells[gy * w + gx + 1].elev : cells[idx].elev;
              const eL = gx > 0 ? cells[gy * w + gx - 1].elev : cells[idx].elev;
              const eD = gy < h - 1 ? cells[(gy + 1) * w + gx].elev : cells[idx].elev;
              const eU = gy > 0 ? cells[(gy - 1) * w + gx].elev : cells[idx].elev;
              const cell = cells[idx];
              cell.dzdx = (eR - eL) / (2 * step);
              cell.dzdy = (eD - eU) / (2 * step);
              const invLen = 1 / (Math.hypot(-cell.dzdx, -cell.dzdy, 1.0) || 1.0);
              nxArr[idx] = -cell.dzdx * invLen;
              nyArr[idx] = -cell.dzdy * invLen;
              nzArr[idx] = invLen;
              aoArr[idx] = terrainAmbientOcclusion(cell.dzdx, cell.dzdy);
              const alb = computeTerrainAlbedo(cell, minZ, maxZ);
              albR[idx] = alb.r; albG[idx] = alb.g; albB[idx] = alb.b;
              cell.color = computeElevationColor(cell, minZ, maxZ);
            }
          }
          this.terrain = {
            gridSize: w,
            worldSize,
            minZ,
            maxZ,
            cells,
            nx: nxArr, ny: nyArr, nz: nzArr, ao: aoArr,
            albR, albG, albB,
            features: snap.terrain_features || [],
            generatorVersion: snap.terrain_generator_version || 0,
            profile: snap.terrain_profile || '',
          };
          this._terrainCached = true;
          // 地形重建后强制下一帧整片重着色（光相未变也要重写新数组对应的 cell.color）
          if (window.SimLighting) window.SimLighting.markDirty();
          if (window.RiverLife) window.RiverLife.init(this.terrain.features, this._engineSeed);
        }

        // --- POI ---
        const poiTypeMap = { Camp: 'Camp', WaterSource: 'Water', BerryBush: 'Berry', WoodForest: 'Wood', StoneQuarry: 'Stone', GoldMine: 'Gold', Market: 'Market' };
        this.pois = snap.pois.map(p => ({
          id: p.id,
          type: poiTypeMap[p.poi_type] || p.poi_type,
          pos: { x: p.x, y: p.y, z: p.z },
          currentStock: p.current_stock,
          maxStock: p.max_stock,
          regenRate: p.regen_rate,
          secondaryStock: p.secondary_stock || 0,
          secondaryMaxStock: p.secondary_max_stock || 0,
          secondaryRegenRate: p.secondary_regen_rate || 0,
          tertiaryStock: p.tertiary_stock || 0,
          tertiaryMaxStock: p.tertiary_max_stock || 0,
          tertiaryRegenRate: p.tertiary_regen_rate || 0,
          waterPrice: p.water_price || 0,
          foodPrice: p.food_price || 0,
          woodPrice: p.wood_price || 0,
          cumulativeSoldWater: p.cumulative_sold_water || 0,
          cumulativeSoldFood: p.cumulative_sold_food || 0,
          cumulativeSoldWood: p.cumulative_sold_wood || 0,
          cumulativeRevenue: p.cumulative_revenue || 0,
          name: p.name || (p.poi_type === 'Camp' ? '聚落 #' + p.id : (poiTypeMap[p.poi_type] || p.poi_type) + ' #' + p.id),
          campTitle: p.camp_title || p.name || ('聚落 #' + p.id),
          level: p.level || 0,
          boundHouses: p.bound_houses || 0,
          vacantHouses: (p.vacant_houses || []).map(vh => ({
            houseId: vh.house_id,
            beneficiaryIds: vh.beneficiary_ids || []
          })),
          // ★ v1.28.0 榷场交易流水（从新到旧，仅 Market 有内容）
          marketTrades: (p.market_trades || []).map(t => ({
            tick: t.tick,
            agentId: t.agent_id,
            householdId: (t.household_id === null || t.household_id === undefined) ? null : t.household_id,
            resource: t.resource || 'Water',
            amount: t.amount || 0,
            unitPrice: t.unit_price || 0,
            goldCost: t.gold_cost || 0
          }))
        }));

        // --- 房屋（M6 建筑化：不再携带任何资源存量；家庭物资展示读家户账本；v1.14.0 拍卖与档案） ---
        this.houses = snap.houses.map(h => {
        const view = {
          id: h.id,
          pos: { x: h.x, y: h.y, z: h.z },
          tier: h.tier,
          ownerId: h.owner_id,
          spouseId: h.spouse_id,
          campId: h.camp_id,
          isRepairing: h.is_repairing,
          durability: h.durability,
          age: h.age,
          constructionProgress: h.construction_progress,
          builderId: h.builder_id,
          lastUpgraderId: h.last_upgrader_id,
          auctionPhase: h.auction_phase || null,
          benchmarkBid: h.benchmark_bid || 0,
          highestBid: h.highest_bid || 0,
          bidsCount: h.bids_count || 0,
          lastDealPrice: h.last_deal_price != null ? h.last_deal_price : null,
          lastDealTick: h.last_deal_tick != null ? h.last_deal_tick : null,
          auctionStartDurability: h.auction_start_durability != null ? h.auction_start_durability : null,
          recentBids: (h.recent_bids || []).map(b => ({
            tick: b.tick,
            bidderId: b.bidder_id,
            amount: b.amount,
            phase: b.phase,
          })),
          recentDeals: (h.recent_deals || []).map(d => ({
            tick: d.tick,
            buyerId: d.buyer_id,
            price: d.price,
            durability: d.durability,
            reason: d.reason,
          })),
        };
        return view;
        });

        // --- 路网 (车道 + 节点) ---
        // ★ M4：车道/节点几何按 geom_version 缓存。
        //   · 快照携带完整几何（snap.lanes 为数组）：全量重建 Map + O(n) 反向车道查找；
        //   · 增量帧（snap.lanes === null，仅 LANE_WEAR）：复用缓存对象，只覆写 wear ——
        //     消灭每帧 812 个对象重建与 O(n²) 反查（812² ≈ 66 万次内层比较）。
        if (snap.lanes) { // 携带完整几何（数组）；JSON 通道恒为数组
          const lanes = new Map();
          const laneOrder = [];
          for (const l of snap.lanes) {
            const obj = {
              id: l.id,
              from: l.from,
              to: l.to,
              wear: l.wear,
              roadClass: l.road_class,
              speedLimit: l.speed_limit,
              isHidden: l.is_hidden,
              concealment: l.concealment,
              reverseId: null,
              curve: makeBezierCurve(l.p0, l.p1, l.p2, l.p3)
            };
            lanes.set(l.id, obj);
            laneOrder.push(obj);
          }
          // O(n) 反向车道查找（原 O(n²)：812² ≈ 66 万次/帧，M4 一并消除）
          const byKey = new Map();
          for (const obj of laneOrder) byKey.set(obj.from + '|' + obj.to, obj.id);
          for (const obj of laneOrder) {
            const rid = byKey.get(obj.to + '|' + obj.from);
            obj.reverseId = rid !== undefined && rid !== obj.id ? rid : null;
          }
          this.network.lanes = lanes;
          this._laneCache = laneOrder;
          this._geomVersion = snap.geom_version !== undefined ? snap.geom_version : null;
        } else if (this._laneCache && snap.lane_wear) {
          // 增量帧（二进制 lanes===null）：复用缓存对象，仅覆写 wear（原地修改，渲染侧零重建）
          const wear = snap.lane_wear;
          const cache = this._laneCache;
          const n = Math.min(cache.length, wear.length);
          for (let i = 0; i < n; i++) cache[i].wear = wear[i];
        }
        if (snap.nodes !== undefined && snap.nodes !== null) {
          const nodes = new Map();
          for (const n of snap.nodes) {
            nodes.set(n.id, { id: n.id, pos: { x: n.x, y: n.y, z: n.z }, nodeType: n.node_type });
          }
          this.network.nodes = nodes;
        }
        // 注：增量帧（nodes===null）时保留 this.network.nodes 缓存；首个增量帧前必有全量帧建立缓存。

        // --- Agent ---
        const prevAgents = new Map(this.agents.map(a => [a.id, a]));
        this.agents = snap.agents.map(a => {
          const pos = { x: a.x, y: a.y, z: a.z };
          const isMoving = a.is_alive && a.velocity > 0.01;
          const prev = prevAgents.get(a.id);
          let trail = prev ? prev.trail.slice() : [];
          if (isMoving) {
            const last = trail[trail.length - 1];
            if (!last) {
              trail.push(pos);
            } else {
              const d = Math.hypot(pos.x - last.x, pos.y - last.y);
              if (d > 0.8 && d < 18.0) {
                trail.push(pos);
                if (trail.length > 4) trail.shift();
              } else if (d >= 18.0) {
                trail = [pos];
              }
            }
          } else {
            if (trail.length > 0) trail.shift();
          }
          return {
            id: a.id,
            gender: a.gender === 'Female' ? 'female' : 'male',
            pos,
            age: a.age,
            birthTick: a.birth_tick || 0,  // 出生时刻 tick (始祖=0, 后代=分娩时 tick_counter)
            state: a.state,
            currentNeed: a.current_need, // 马斯洛需求层级·种类 (如 Physiological·QuenchThirst)
            isAlive: a.is_alive,
            velocity: a.velocity || 0,
            hunger: a.hunger,
            thirst: a.thirst,
            stamina: a.stamina,
            health: a.health,
            maxHealth: a.max_health,
            carriedWater: a.carried_water, carriedFood: a.carried_food, carriedWood: a.carried_wood,
            carriedStone: a.carried_stone, carriedGold: a.carried_gold,
            cumulativeMined: a.cumulative_mined || 0,
            cumulativeMinedWater: a.cumulative_mined_water || 0, cumulativeMinedFood: a.cumulative_mined_food || 0,
            cumulativeMinedWood: a.cumulative_mined_wood || 0, cumulativeMinedStone: a.cumulative_mined_stone || 0,
            cumulativeMinedGold: a.cumulative_mined_gold || 0,
            cumulativeRoyalPrivy: a.cumulative_royal_privy || 0,
            cumulativeImperialPrivy: a.cumulative_imperial_privy || 0,
            buildTimer: a.build_timer,
            isPregnant: a.is_pregnant,
            pregnancyProgress: a.pregnancy_progress,
            pregnancyChildId: a.pregnancy_child_id != null ? a.pregnancy_child_id : null,
            isFetus: a.is_fetus || false,
            miscarriageCooldown: a.miscarriage_cooldown,
            postpartumCooldown: a.postpartum_cooldown,
            miscarriageTimer: a.miscarriage_alert_timer,
            deathDecayTimer: a.death_decay_timer,
            deathCause: a.death_cause,
            isCovert: a.is_covert,
            stealthVisibility: a.stealth_visibility,
            homeHouseId: a.home_house_id,
            generation: a.generation || 1,
            spouseId: a.spouse_id,
            motherId: a.mother_id,
            fatherId: a.father_id,
            children: a.children_ids,
            intelligence: a.intelligence,
            strength: a.strength,
            digestionEfficiency: a.digestion_efficiency,
            libido: a.libido,
            sleepEfficiency: a.sleep_efficiency,
            lifeExpectancy: a.life_expectancy,
            surname: a.surname || '',
            prestige: a.prestige || 0,
            familyStockActive: a.family_stock_active || [false, false, false, false, false],
            marriageHistoryCount: a.marriage_history_count || 0,
            householdId: a.household_id != null ? a.household_id : null,
            householdRole: a.household_role || 'None',
            // ★ M4: 到达时刻与夺位远征标记
            arrivalTick: a.arrival_tick || 0,
            isOnExpedition: a.is_on_expedition || false,
            expeditionTargetCamp: a.expedition_target_camp ?? null,
            coronationPending: a.coronation_pending ?? null,
            courtshipTargetId: a.courtship_target_id ?? null,
            // ★ M19.4 活动任务透视快照
            activeTask: a.active_task ? {
              branch: a.active_task.branch,
              branchDesc: a.active_task.branch_desc,
              level: a.active_task.level,
              intentKind: a.active_task.intent_kind,
              completion: a.active_task.completion,
              strategyKind: a.active_task.strategy_kind,
              stage: a.active_task.stage,
              targetId: a.active_task.target_id,
              targetType: a.active_task.target_type,
              primitiveKind: a.active_task.primitive_kind,
              primitiveDetail: a.active_task.primitive_detail,
              itinerary: a.active_task.itinerary,
            } : null,
            active_task: a.active_task || null,
            trail
          };
        });

        // 持续同步全量族人档案库 (保留已故先祖快照)
        // ★ M1.7 腹中胎儿不入档案库：未出生即流产时不应残留为"存活"记录；出生后以新生儿身份入档
        for (const ag of this.agents) {
          if (ag.isFetus) continue;
          this.agentArchive.set(ag.id, ag);
        }

        // ★ v1.8.7 消费死亡/流产墓碑（recent_deaths）：
        //   · 高倍速单帧跨过衰减窗口时，强制把档案库滞留的"存活"副本补记为已故并写入死因（修复绝嗣废墟/卡片误判"健在"）；
        //   · 流产/随母亡故的腹中胎儿以"已故子嗣"身份入档（族谱可见，死因=流产/随母亡故）。
        const consumedDeaths = this._consumedDeathIds || (this._consumedDeathIds = new Set());
        for (const d of (snap.recent_deaths || [])) {
          if (consumedDeaths.has(d.id)) continue;
          consumedDeaths.add(d.id);
          let rec = this.agentArchive.get(d.id);
          if (!rec) rec = prevAgents.get(d.id);   // 胎儿（未入档）从上一帧活跃列表取，保留血缘字段
          if (rec) {
            rec = Object.assign({}, rec);         // 克隆，避免污染 prevAgents 引用
            rec.isAlive = false;
            rec.deathCause = d.cause;
            if (d.is_fetus) rec.isFetus = false;  // 流产胎儿以"已故子嗣"身份入档
            // 血缘优先以墓碑为准（高倍速下胎儿可能无上一帧快照，prevAgents 取不到）
            if (d.father_id !== undefined) rec.fatherId = d.father_id;
            if (d.mother_id !== undefined) rec.motherId = d.mother_id;
            this.agentArchive.set(d.id, rec);
          } else {
            // 兜底：墓碑字段建最小档案（血缘直接来自墓碑，不丢 parent 链接）
            // 已故入档统一以"已故子嗣"身份（isFetus=false），与 prevAgents 分支一致
            this.agentArchive.set(d.id, {
              id: d.id, isAlive: false, deathCause: d.cause,
              isFetus: false, age: 0, birthTick: 0,
              fatherId: d.father_id !== undefined ? d.father_id : null,
              motherId: d.mother_id !== undefined ? d.mother_id : null,
              surname: '', gender: 'female'
            });
          }
        }

        // ★ 家户登记簿快照映射（家庭跟着男人走）
        this.households = (snap.households || []).map(h => ({
          id: h.id,
          head: h.head,              // 户主（男性）
          members: h.members || [],   // 成员列表（含户主+妻子+未成年子女+腹中胎儿）
          balances: (h.balances || []).reduce((acc, b) => {
            acc[b.resource] = b.amount;
            return acc;
          }, {}),  // 账面余额：{ Water, Food, Wood, Stone, Gold }
          parentHousehold: h.parent_household,
          foundedTick: h.founded_tick,
          isDissolved: h.is_dissolved,
          recentEvents: h.recent_events || [],  // 最近团体事件（从新到旧）
          recentJournal: h.recent_journal || []  // ★ M2: 最近8笔资源流水（从新到旧）
        }));

        // ★ 婚姻登记簿快照映射（一人终生多段婚姻全留痕）
        this.marriages = (snap.marriages || []).map(m => ({
          id: m.id,
          husbandId: m.husband_id,
          wifeId: m.wife_id,
          startTick: m.start_tick,
          endTick: m.end_tick,
          endReason: m.end_reason,
          isActive: m.is_active
        }));

        // ★ M2: 公仓兜底账本余额（绝嗣清算资产充入处）
        this.publicGranaryBalances = (snap.public_granary_balances || []).reduce((acc, b) => {
          acc[b.resource] = b.amount;
          return acc;
        }, {});

        // ★ M3: 宗族登记簿快照映射（按姓氏聚合 · 族长顺位 · 族税族库）
        this.clans = (snap.clans || []).map(c => ({
          surname: c.surname,
          leaderId: c.leader_id != null ? c.leader_id : null,
          memberCount: c.member_count || 0,
          memberIds: c.member_ids || [],
          balances: (c.balances || []).reduce((acc, b) => {
            acc[b.resource] = b.amount;
            return acc;
          }, {}),
          recentJournal: c.recent_journal || [],
          recentEvents: c.recent_events || [],
          isExtinct: !!c.is_extinct
        }));

        // ★ M4: 地区/王国登记簿快照映射（初王/长子继承/公仓税/救济/夺位远征）
        this.regions = (snap.regions || []).map(r => ({
          campId: r.camp_id,
          campName: r.camp_name,
          kingId: r.king_id != null ? r.king_id : null,
          regime: r.regime,
          succession: r.succession,
          memberCount: r.member_count || 0,
          arrivalOrder: r.arrival_order || [],
          heirCandidates: r.heir_candidates || [],
          balances: (r.balances || []).reduce((acc, b) => { acc[b.resource] = b.amount; return acc; }, {}),
          recentJournal: r.recent_journal || [],
          recentEvents: r.recent_events || [],
          activeExpeditionAgents: r.active_expedition_agents || [],
          // ★ v1.12.0 历史国王改为对象数组（含在位起止 tick 与死因），兼容旧档数字数组
          historyKings: (r.history_kings || []).map(hk =>
            typeof hk === 'number'
              ? { agentId: hk, reignStartTick: 0, reignEndTick: 0, deathCause: null }
              : { agentId: hk.agent_id, reignStartTick: hk.reign_start_tick, reignEndTick: hk.reign_end_tick, deathCause: hk.death_cause || null }
          ),
          memberIds: r.member_ids || [],
          governedHouseholds: r.governed_households || [],
          currentReignStart: r.current_reign_start != null ? r.current_reign_start : null,
          cumulativeRoyalPrivy: r.cumulative_royal_privy || 0
        }));

        // ★ M5: 帝国登记簿（当前政体仅为 Empire，首长称谓预留为 Emperor/President）
        this.empires = (snap.empires || []).map(e => ({
          empireId: e.empire_id,
          regime: e.regime,
          headTitle: e.head_title,
          emperorId: e.emperor_id != null ? e.emperor_id : null,
          memberCampIds: e.member_camp_ids || [],
          memberCount: e.member_count || 0,
          kingCandidates: e.king_candidates || [],
          balances: (e.balances || []).reduce((acc, b) => { acc[b.resource] = b.amount; return acc; }, {}),
          recentJournal: e.recent_journal || [],
          recentEvents: e.recent_events || [],
          currentReignStart: e.current_reign_start != null ? e.current_reign_start : null,
          cumulativeImperialPrivy: e.cumulative_imperial_privy || 0
        }));

        // ★ M4: 远征目标反查表 agent_id -> camp_id（从 regions.activeExpeditionAgents 反查）
        this.expeditionTargets = new Map();
        for (const r of this.regions) {
          for (const aid of r.activeExpeditionAgents) {
            this.expeditionTargets.set(aid, r.campId);
          }
        }
      }
    }

    function makeBezierCurve(p0, p1, p2, p3) {
      return {
        p0, p1, p2, p3,
        evalPos(t) {
          t = Math.max(0, Math.min(1, t));
          const u = 1 - t;
          return {
            x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
            y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
            z: u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z
          };
        }
      };
    }
