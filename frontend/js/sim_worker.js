// === Flow & Accord · 仿真内核专用 Web Worker (sim_worker.js) ===
// 专职在独立 CPU 核心运行 Rust WASM 确定性内核步进与状态快照生成。
// 主线程专职负责 60FPS Canvas 渲染与 DOM 事件，通过消息与本 Worker 通信。

'use strict';

let _wasm = null;
let _memory = null;
let _ready = false;
let _engineSeed = 0;
let _textDecoder = new TextDecoder();
let _textEncoder = new TextEncoder();

let isPaused = true;
let speedMult = 2;
let ackReceived = true;
let forceTerrain = true;
let timerId = null;
let tickMs = 0;
let currentTick = 0;
let rewindInProgress = false;

// 时光倒流历史检查点
let historyCheckpoints = [];
let lastCheckpointTick = -1;
// 会改变内核状态的前端命令必须带 tick 留痕，才能从早于命令的检查点精确重演。
let historyCommands = [];
// 快照下发节流：距上次快照生成的现实时间戳（30Hz 锚定，与前端 30 FPS 渲染帧率对齐，见 M1）
let lastSnapshotTime = 0;
// 检查点写入节流：距上次 world_save 的现实时间戳（150ms 守卫，见 M1）
let lastCheckpointRealTime = 0;

// ★ M4 (v1.45.0) 二进制快照（FABS）状态
let binSupported = true;  // INIT 后探测；解码/拉取异常时回退 JSON 并置 false
let warnedBinFallback = false; // 回退仅告警一次
let enumTableJson = '';   // 枚举名称表 JSON（随 READY 下发主线程，供 SnapshotBin.setEnumTables）
const _headerTickDv = new DataView(new ArrayBuffer(40)); // 读取 FABS 帧头 tick 用

function readLastError() {
  if (!_ready || typeof _wasm.world_last_error_len !== 'function') return '';
  const len = _wasm.world_last_error_len();
  if (!len) return '';
  const ptr = _wasm.world_last_error_ptr();
  return _textDecoder.decode(new Uint8Array(_memory.buffer, ptr, len));
}

function getAppVersion() {
  if (_ready && typeof _wasm.world_app_version_ptr === 'function') {
    const ptr = _wasm.world_app_version_ptr();
    const len = _wasm.world_app_version_len();
    if (len > 0) {
      return _textDecoder.decode(new Uint8Array(_memory.buffer, ptr, len));
    }
  }
  // ★ v1.44.2：兜底串必须与内核 SAVE_APP_VERSION 同格式（无 `v` 前缀），
  // 否则 save-ui 的版本门禁会把「同版本存档」误判为旧档（详见 save-ui.js::normalizeVer）
  return '1.46.4';
}

function applyConfigInternal(configObj) {
  if (!configObj || !_wasm) return false;
  try {
    const jsonStr = JSON.stringify(configObj);
    const encoded = _textEncoder.encode(jsonStr);
    if (typeof _wasm.world_config_buf_ptr === 'function' && typeof _wasm.world_apply_config_buf === 'function') {
      const ptr = _wasm.world_config_buf_ptr(encoded.length);
      new Uint8Array(_memory.buffer, ptr, encoded.length).set(encoded);
      const res = _wasm.world_apply_config_buf(encoded.length);
      return res === 0;
    }
  } catch (e) {
    console.error('[sim_worker] 应用配置失败:', e);
  }
  return false;
}

// 必须在首个快照/首个 tick 前调用。主线程已在 world_create 前从 localStorage
// 读取这组值，因此「种子 + 产速配置」共同构成一次可复现的创世输入。
function applyInitialRegenMultipliers(multipliers) {
  if (!multipliers || typeof _wasm.world_set_regen_multiplier !== 'function') return;
  const defs = [['water', 0], ['berry', 1], ['wood', 2], ['stone', 3], ['gold', 4]];
  for (const [key, which] of defs) {
    const value = Number(multipliers[key]);
    if (Number.isFinite(value) && value >= 0 && value <= 5) {
      _wasm.world_set_regen_multiplier(which, value);
    }
  }
}

function saveWorldInternal() {
  if (!_ready || typeof _wasm.world_save_ptr !== 'function') return null;
  const ptr = _wasm.world_save_ptr();
  const len = _wasm.world_save_len();
  if (!len) return null;
  return _textDecoder.decode(new Uint8Array(_memory.buffer, ptr, len));
}

function loadWorldInternal(jsonStr) {
  if (!_ready || typeof _wasm.world_load !== 'function') {
    return { ok: false, error: 'WASM 引擎尚未就绪' };
  }
  if (typeof jsonStr !== 'string' || jsonStr.length === 0) {
    return { ok: false, error: '存档内容为空' };
  }
  let encoded;
  try {
    encoded = _textEncoder.encode(jsonStr);
  } catch (e) {
    return { ok: false, error: '存档编码失败: ' + e.message };
  }
  const ptr = _wasm.world_save_buf_ptr(encoded.length);
  new Uint8Array(_memory.buffer, ptr, encoded.length).set(encoded);
  const res = _wasm.world_load(encoded.length);
  if (res !== 0) {
    const detail = readLastError();
    const codeMsg = { '-1': '存档长度越界', '-2': '存档不是合法 UTF-8 文本', '-3': '存档解析或校验失败' }[String(res)] || ('未知错误 ' + res);
    return { ok: false, error: detail ? codeMsg + '：' + detail : codeMsg };
  }
  return { ok: true };
}

function recordHistoryCheckpoint(tick) {
  if (!_ready) return;
  if (tick - lastCheckpointTick < 30 && lastCheckpointTick >= 0) return;
  // 现实时间守卫（M1）：高倍速下至少流逝 150ms 才导出一次 world_save，避免高频 GC 停顿。
  // 首次检查点（lastCheckpointTick < 0，即 genesis）不受限，确保时光倒流首档必然保存。
  if (lastCheckpointTick >= 0 && performance.now() - lastCheckpointRealTime < 150) return;
  const json = saveWorldInternal();
  if (!json) return;
  if (historyCheckpoints.length > 0 && historyCheckpoints[historyCheckpoints.length - 1].tick === tick) return;
  historyCheckpoints.push({ tick, json, commandCursor: historyCommands.length });
  lastCheckpointTick = tick;
  lastCheckpointRealTime = performance.now();

  // 内存与性能保护：最多保留 160 个历史检查点（~6MB），首档保留，近程密集，较早历史稀疏
  if (historyCheckpoints.length > 160) {
    const genesis = historyCheckpoints[0];
    const recent = historyCheckpoints.slice(-60);
    const middle = historyCheckpoints.slice(1, -60).filter((_, idx) => idx % 6 === 0);
    historyCheckpoints = [genesis, ...middle, ...recent];
  }
}

// ⚠️ 必须是 async：函数内部用 `await` 分块让出事件循环。若去掉 async，`await` 会退化成
// 语法错误，整个 Worker 脚本无法解析（仿真完全起不来）—— tools/frontend-check.js 会拦截。
async function rewindToTickInternal(targetTick, reqId) {
  targetTick = Math.round(Number(targetTick));
  if (isNaN(targetTick) || targetTick < 0) return { ok: false, error: '目标 Tick 必须为非负整数' };
  if (targetTick > currentTick) return { ok: false, error: `目标 Tick 不得超过当前 Tick ${currentTick}` };
  let bestCp = null;
  for (let i = historyCheckpoints.length - 1; i >= 0; i--) {
    if (historyCheckpoints[i].tick <= targetTick) {
      bestCp = historyCheckpoints[i];
      break;
    }
  }
  if (!bestCp) return { ok: false, error: '未找到合适的历史检查点' };
  const loadRes = loadWorldInternal(bestCp.json);
  if (!loadRes.ok) return loadRes;
  const delta = targetTick - bestCp.tick;
  currentTick = bestCp.tick;
  let commandCursor = bestCp.commandCursor || 0;
  const applyHistoricalCommands = () => {
    while (commandCursor < historyCommands.length && historyCommands[commandCursor].tick <= currentTick) {
      const command = historyCommands[commandCursor++];
      if (command.type === 'CONFIG') applyConfigInternal(command.config);
      if (command.type === 'SET_REGEN' && typeof _wasm.world_set_regen_multiplier === 'function') {
        _wasm.world_set_regen_multiplier(command.which, command.mult);
      }
    }
  };
  applyHistoricalCommands();
  // 分块重演：避免长距离回放期间 Worker 长时间不让出事件循环。
  // Worker 已在 REWIND 消息入口暂停，因此中途不会被正常计时循环插入 tick。
  const chunkSize = 5000;
  let replayed = 0;
  while (replayed < delta) {
    const nextCommand = historyCommands[commandCursor];
    const untilNextCommand = nextCommand ? Math.max(1, nextCommand.tick - currentTick) : Infinity;
    const n = Math.min(chunkSize, delta - replayed, untilNextCommand);
    _wasm.world_tick_steps(n, 1.0 / 60.0);
    replayed += n;
    currentTick = bestCp.tick + replayed;
    applyHistoricalCommands();
    if (replayed < delta) {
      self.postMessage({ type: 'REWIND_PROGRESS', reqId, tick: currentTick, targetTick });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  const res = pullSnapshot(true);
  if (!res || !res.bin) return { ok: true, snapshot: null };
  // 回滚后当前时间线成为唯一有效分支，丢弃原时间线中目标 tick 之后的检查点。
  historyCheckpoints = historyCheckpoints.filter(cp => cp.tick <= targetTick);
  historyCommands = historyCommands.filter(command => command.tick <= targetTick);
  const targetJson = saveWorldInternal();
  if (targetJson && (!historyCheckpoints.length || historyCheckpoints[historyCheckpoints.length - 1].tick !== targetTick)) {
    historyCheckpoints.push({ tick: targetTick, json: targetJson, commandCursor: historyCommands.length });
  }
  lastCheckpointTick = targetTick;
  lastCheckpointRealTime = performance.now();
  return {
    ok: true,
    snapshot: res.bin,
    snapshotBuf: res.bin, // REWIND_RESULT 转移用
    minTick: historyCheckpoints.length ? historyCheckpoints[0].tick : targetTick,
    checkpointCount: historyCheckpoints.length,
  };
}

function rewindMeta() {
  return {
    minTick: historyCheckpoints.length ? historyCheckpoints[0].tick : currentTick,
    maxTick: currentTick,
    checkpointCount: historyCheckpoints.length,
  };
}

// ★ M5-0.4 快照频率自适应：节流间隔按当前人口（从 FABS 帧 section 目录读出 AGENT 记录数）分级。
// 固定 30Hz 在 442 人满载档下要吃掉 13.8% 算力且随人口线性恶化；降频后大人口场景直接省 33~50%。
const SNAP_THROTTLE_TIERS = [
  { maxPop: 200, intervalMs: 33.3, label: '30Hz' },
  { maxPop: 320, intervalMs: 40.0, label: '25Hz' },
  { maxPop: 450, intervalMs: 50.0, label: '20Hz' },
  { maxPop: Infinity, intervalMs: 66.7, label: '15Hz' },
];
let snapshotIntervalMs = 33.3;
let snapshotHzLabel = '30Hz';
let lastAgentCount = 0;

function applyThrottleTier(pop) {
  lastAgentCount = pop;
  for (let i = 0; i < SNAP_THROTTLE_TIERS.length; i++) {
    const t = SNAP_THROTTLE_TIERS[i];
    if (pop <= t.maxPop) {
      snapshotIntervalMs = t.intervalMs;
      snapshotHzLabel = t.label;
      return;
    }
  }
}

// 从 FABS 帧头/目录读取 tick 与 AGENT 记录数（帧格式见 snapshot_bin/layout.rs）
// Header: 0 magic · 4 version · 6 flags · 8 frame_len · 12 tick(u64) · 32 section_count(u16)
// DirEntry: 0 kind(u16) · 4 offset(u32) · 8 count(u32) · 12 byte_len(u32)
function readFrameMeta(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // u64 用双 u32 合成，避免 BigInt 分配（与 snapshot-bin.js 一致）
  currentTick = dv.getUint32(12, true) + dv.getUint32(16, true) * 4294967296;
  if (bytes.length < 40) return -1;
  const secCount = dv.getUint16(32, true);
  for (let i = 0; i < secCount; i++) {
    const off = 40 + i * 16;
    if (off + 16 > bytes.length) break;
    if (dv.getUint16(off, true) === 2) return dv.getUint32(off + 8, true); // AGENT
  }
  return -1;
}

// 从 wasm 内存拷贝出二进制帧（Uint8Array，拥有独立 ArrayBuffer 可转移），并读取帧头元信息
function pullSnapshotBin(requireTerrain) {
  if (requireTerrain && typeof _wasm.world_require_terrain === 'function') {
    _wasm.world_require_terrain(); // M4：同时复位路网几何增量（见 lib.rs）
  }
  const ptr = _wasm.world_snapshot_bin_ptr();
  const len = _wasm.world_snapshot_bin_len();
  if (!len) return null;
  const bytes = new Uint8Array(_memory.buffer, ptr, len).slice();
  const pop = readFrameMeta(bytes);
  if (pop >= 0) applyThrottleTier(pop);
  return bytes;
}

// 统一快照拉取（★ T1：单一 FABS 二进制通道，JSON 通道已移除）
// 返回值：{ bin: Uint8Array } 或 null
function pullSnapshot(requireTerrain) {
  if (!_ready || !binSupported) return null;
  try {
    const bin = pullSnapshotBin(requireTerrain);
    return bin ? { bin: bin } : null;
  } catch (e) {
    if (!warnedBinFallback) {
      warnedBinFallback = true;
      console.error('[sim_worker] 二进制快照拉取失败:', e);
    }
    return null;
  }
}

// 拉取快照并 postMessage 给主线程（二进制帧转移 ArrayBuffer，零结构化克隆）
// 返回是否成功产出并投递
function pullAndPost(type, extra, requireTerrain) {
  const res = pullSnapshot(requireTerrain);
  if (!res || !res.bin) return false;
    recordHistoryCheckpoint(currentTick);
  const msg = Object.assign({
    type: type,
    snapshot: res.bin,
    tick: currentTick,
    rewind: rewindMeta(),
    wasmBytes: (_memory && _memory.buffer) ? _memory.buffer.byteLength : 0,
  }, extra || {});
  self.postMessage(msg, [res.bin.buffer]);
  return true;
}

// 步进循环 (~60Hz 触发，1x 倍速下 1 秒现实时间 = 60 Tick = 1 游戏小时)
function simulationStep() {
  if (isPaused || !_ready) return;
  const steps = Math.max(1, speedMult | 0);
  const dt = 1.0 / 60.0;
  const t0 = performance.now();
  _wasm.world_tick_steps(steps, dt);
  currentTick += steps;
  const t1 = performance.now();
  tickMs = t1 - t0;

  // 快照下发节流（M1）：默认 30Hz 与前端渲染帧率对齐；★ M5-0.4 起按人口自适应降频
  // （间隔由 applyThrottleTier 依据 FABS 帧内 AGENT 记录数设定）。
  // 窗口未到前专职推进 world_tick_steps，跳过编码与通信开销。
  // forceTerrain 立即下发（绕过窗口），保证地形网格必需场景不被延误。
  const now = performance.now();
  const throttlePass = forceTerrain || (now - lastSnapshotTime >= snapshotIntervalMs);
  if (throttlePass && (ackReceived || forceTerrain)) {
    ackReceived = false;
    lastSnapshotTime = now;
    pullAndPost('SNAPSHOT', { tickMs }, forceTerrain);
    forceTerrain = false;
  }
}

function startLoop() {
  if (timerId !== null) return;
  timerId = setInterval(simulationStep, 16);
}

function stopLoop() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

// 监听主线程指令
self.onmessage = async function(e) {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;

  // 分块重演会主动让出 Worker 事件循环；期间不得插入调参、步进或第二个回滚请求，
  // 否则同一段时间线会混入外部命令，失去精确重演语义。
  if (rewindInProgress) {
    if (msg.type === 'REWIND') {
      self.postMessage({ type: 'REWIND_RESULT', reqId: msg.reqId, ok: false, error: '已有时光倒流正在重演，请等待完成', tick: currentTick, rewind: rewindMeta() });
    }
    return;
  }

  switch (msg.type) {
    case 'INIT': {
      try {
        _engineSeed = msg.seed || Date.now();
        const resp = await fetch(msg.wasmUrl, { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const bytes = await resp.arrayBuffer();
        const result = await WebAssembly.instantiate(bytes, {});
        _wasm = result.instance.exports;
        _memory = _wasm.memory;
        // ★ M4：探测二进制快照与枚举名称表（旧 wasm 无导出则自动回退 JSON）
        binSupported = typeof _wasm.world_snapshot_bin_ptr === 'function'
          && typeof _wasm.world_snapshot_bin_len === 'function';
        enumTableJson = '';
        if (binSupported && typeof _wasm.world_enum_table_ptr === 'function') {
          const etp = _wasm.world_enum_table_ptr();
          const etl = _wasm.world_enum_table_len();
          if (etl > 0) {
            enumTableJson = _textDecoder.decode(new Uint8Array(_memory.buffer, etp, etl));
          }
        }
        if (msg.config) {
          applyConfigInternal(msg.config);
        }
        _wasm.world_create(60, 764.0, _engineSeed, msg.agentCount || 20, msg.campCount || 4);
        applyInitialRegenMultipliers(msg.regenMultipliers);
        _ready = true;
        historyCheckpoints = [];
        historyCommands = [];
        lastCheckpointTick = -1;
        lastCheckpointRealTime = 0;
        const initialRes = pullSnapshot(true);
        const initialSnap = initialRes ? (initialRes.bin || initialRes.snap) : null;
        if (initialSnap) {
          recordHistoryCheckpoint(currentTick);
        }
        startLoop();
        const initMsg = {
          type: 'READY',
          seed: _engineSeed,
          appVersion: getAppVersion(),
          enumTableJson,
          snapshot: initialSnap,
          wasmBytes: (_memory && _memory.buffer) ? _memory.buffer.byteLength : 0,
          rewind: rewindMeta(),
        };
        if (initialRes && initialRes.bin) {
          self.postMessage(initMsg, [initialRes.bin.buffer]);
        } else {
          self.postMessage(initMsg);
        }
      } catch (err) {
        self.postMessage({
          type: 'ERROR',
          error: 'Worker 加载 WASM 失败: ' + err.message,
        });
      }
      break;
    }

    case 'PAUSE': {
      isPaused = !!msg.isPaused;
      break;
    }

    case 'SPEED': {
      speedMult = Math.max(1, parseInt(msg.speedMult, 10) || 1);
      break;
    }

    case 'STEP': {
      if (_ready) {
        const count = Math.max(1, parseInt(msg.count, 10) || 1);
        _wasm.world_tick_steps(count, 1.0 / 60.0);
        currentTick += count;
        pullAndPost('SNAPSHOT', { tickMs: 0 }, false);
      }
      break;
    }

    case 'CONFIG': {
      if (_ready && msg.config) {
        const ok = applyConfigInternal(msg.config);
        if (ok) {
          historyCommands.push({ tick: currentTick, type: 'CONFIG', config: msg.config });
          pullAndPost('SNAPSHOT', { tickMs: 0 }, false);
        }
      }
      break;
    }

    case 'SET_REGEN': {
      if (_ready && typeof _wasm.world_set_regen_multiplier === 'function') {
        _wasm.world_set_regen_multiplier(msg.which, msg.mult);
        historyCommands.push({ tick: currentTick, type: 'SET_REGEN', which: msg.which, mult: msg.mult });
      }
      break;
    }

    case 'REQUIRE_TERRAIN': {
      forceTerrain = true;
      break;
    }

    case 'ACK': {
      ackReceived = true;
      break;
    }

    case 'RESET': {
      if (_ready) {
        _engineSeed = msg.seed || Date.now();
        if (msg.config) {
          applyConfigInternal(msg.config);
        }
        _wasm.world_create(60, 764.0, _engineSeed, msg.agentCount || 20, msg.campCount || 4);
        applyInitialRegenMultipliers(msg.regenMultipliers);
        historyCheckpoints = [];
        historyCommands = [];
        lastCheckpointTick = -1;
        lastCheckpointRealTime = 0;
        const res2 = pullSnapshot(true);
        if (res2 && res2.bin) {
          recordHistoryCheckpoint(currentTick);
        }
        const resetMsg = {
          type: 'RESET_DONE',
          seed: _engineSeed,
          snapshot: res2 ? res2.bin : null,
          wasmBytes: (_memory && _memory.buffer) ? _memory.buffer.byteLength : 0,
          rewind: rewindMeta(),
        };
        if (res2 && res2.bin) {
          self.postMessage(resetMsg, [res2.bin.buffer]);
        } else {
          self.postMessage(resetMsg);
        }
      }
      break;
    }

    case 'SAVE': {
      const json = saveWorldInternal();
      self.postMessage({
        type: 'SAVE_RESULT',
        reqId: msg.reqId,
        ok: !!json,
        json: json || '',
        error: json ? '' : readLastError(),
      });
      break;
    }

    case 'LOAD': {
      const res = loadWorldInternal(msg.jsonStr);
      let loadSnap = null;
      let loadRes = null;
      if (res.ok) {
        historyCheckpoints = [];
        historyCommands = [];
        lastCheckpointTick = -1;
        lastCheckpointRealTime = 0;
        loadRes = pullSnapshot(true);
        if (loadRes && (loadRes.bin || loadRes.snap)) {
          recordHistoryCheckpoint(currentTick);
        }
        loadSnap = loadRes ? (loadRes.bin || loadRes.snap) : null;
      }
      const loadMsg = {
        type: 'LOAD_RESULT',
        reqId: msg.reqId,
        ok: res.ok,
        error: res.error || '',
        snapshot: loadSnap,
        rewind: rewindMeta(),
      };
      if (loadRes && loadRes.bin) {
        self.postMessage(loadMsg, [loadRes.bin.buffer]);
      } else {
        self.postMessage(loadMsg);
      }
      break;
    }

    case 'REWIND': {
      // 先在 Worker 内冻结正常计时，整个加载+重演期间不会混入额外 tick。
      isPaused = true;
      rewindInProgress = true;
      const res = await rewindToTickInternal(msg.targetTick, msg.reqId);
      rewindInProgress = false;
      const rwMsg = {
        type: 'REWIND_RESULT',
        reqId: msg.reqId,
        ok: res.ok,
        error: res.error || '',
        snapshot: res.snapshot || null,
        tick: currentTick, // ★ M4 二进制帧主线程无法直接读 snapshot.tick，由 Worker 附带
        rewind: rewindMeta(),
      };
      if (res.snapshotBuf) {
        self.postMessage(rwMsg, [res.snapshotBuf.buffer]);
      } else {
        self.postMessage(rwMsg);
      }
      break;
    }
  }
};
