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

// 时光倒流历史检查点
let historyCheckpoints = [];
let lastCheckpointTick = -1;
// 快照下发节流：距上次快照生成的现实时间戳（30Hz 锚定，与前端 30 FPS 渲染帧率对齐，见 M1）
let lastSnapshotTime = 0;
// 检查点写入节流：距上次 world_save 的现实时间戳（150ms 守卫，见 M1）
let lastCheckpointRealTime = 0;

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
  return '1.44.3';
}

function applyConfigInternal(configObj) {
  if (!_ready || !configObj) return false;
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
  historyCheckpoints.push({ tick, json });
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

function rewindToTickInternal(targetTick) {
  targetTick = Math.round(Number(targetTick));
  if (isNaN(targetTick) || targetTick < 0) return { ok: false, error: '目标 Tick 必须为非负整数' };
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
  if (delta > 0) {
    _wasm.world_tick_steps(delta, 1.0 / 60.0);
  }
  const snap = pullSnapshot(true);
  return { ok: true, snapshot: snap };
}

function pullSnapshot(requireTerrain) {
  if (requireTerrain && typeof _wasm.world_require_terrain === 'function') {
    _wasm.world_require_terrain();
  }
  const ptr = _wasm.world_snapshot_ptr();
  const len = _wasm.world_snapshot_len();
  if (!len) return null;
  const bytes = new Uint8Array(_memory.buffer, ptr, len);
  try {
    const snap = JSON.parse(_textDecoder.decode(bytes));
    currentTick = snap.tick;
    return snap;
  } catch (e) {
    console.error('[sim_worker] 快照解析失败', e);
    return null;
  }
}

// 步进循环 (~60Hz 触发，1x 倍速下 1 秒现实时间 = 60 Tick = 1 游戏小时)
function simulationStep() {
  if (isPaused || !_ready) return;
  const steps = Math.max(1, speedMult | 0);
  const dt = 1.0 / 60.0;
  const t0 = performance.now();
  _wasm.world_tick_steps(steps, dt);
  const t1 = performance.now();
  tickMs = t1 - t0;

  // 快照下发 30Hz 节流（M1，v1.44.3 起由 60Hz 下调至与前端 30 FPS 渲染帧率对齐）：距上次快照至少 33.3ms 才生成快照，
  // 窗口未到前专职推进 world_tick_steps，跳过 JSON 序列化与通信开销。
  // forceTerrain 立即下发（绕过窗口），保证地形网格必需场景不被延误。
  const now = performance.now();
  const throttlePass = forceTerrain || (now - lastSnapshotTime >= 33.3);
  if (throttlePass && (ackReceived || forceTerrain)) {
    ackReceived = false;
    lastSnapshotTime = now;
    const snap = pullSnapshot(forceTerrain);
    forceTerrain = false;
    if (snap) {
      recordHistoryCheckpoint(snap.tick);
      self.postMessage({
        type: 'SNAPSHOT',
        snapshot: snap,
        tickMs,
        wasmBytes: (_memory && _memory.buffer) ? _memory.buffer.byteLength : 0,
      });
    }
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
        _wasm.world_create(60, 764.0, _engineSeed, msg.agentCount || 20, msg.campCount || 4);
        _ready = true;
        if (msg.config) {
          applyConfigInternal(msg.config);
        }
        historyCheckpoints = [];
        lastCheckpointTick = -1;
        lastCheckpointRealTime = 0;
        const initialSnap = pullSnapshot(true);
        if (initialSnap) {
          recordHistoryCheckpoint(initialSnap.tick);
        }
        startLoop();
        self.postMessage({
          type: 'READY',
          seed: _engineSeed,
          appVersion: getAppVersion(),
          snapshot: initialSnap,
          wasmBytes: (_memory && _memory.buffer) ? _memory.buffer.byteLength : 0,
        });
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
        const snap = pullSnapshot(false);
        if (snap) {
          recordHistoryCheckpoint(snap.tick);
          self.postMessage({
            type: 'SNAPSHOT',
            snapshot: snap,
            tickMs: 0,
            wasmBytes: (_memory && _memory.buffer) ? _memory.buffer.byteLength : 0,
          });
        }
      }
      break;
    }

    case 'CONFIG': {
      if (_ready && msg.config) {
        const ok = applyConfigInternal(msg.config);
        if (ok) {
          const snap = pullSnapshot(false);
          if (snap) {
            self.postMessage({
              type: 'SNAPSHOT',
              snapshot: snap,
              tickMs: 0,
              wasmBytes: (_memory && _memory.buffer) ? _memory.buffer.byteLength : 0,
            });
          }
        }
      }
      break;
    }

    case 'SET_REGEN': {
      if (_ready && typeof _wasm.world_set_regen_multiplier === 'function') {
        _wasm.world_set_regen_multiplier(msg.which, msg.mult);
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
        _wasm.world_create(60, 764.0, _engineSeed, msg.agentCount || 20, msg.campCount || 4);
        if (msg.config) {
          applyConfigInternal(msg.config);
        }
        historyCheckpoints = [];
        lastCheckpointTick = -1;
        lastCheckpointRealTime = 0;
        const snap = pullSnapshot(true);
        if (snap) {
          recordHistoryCheckpoint(snap.tick);
        }
        self.postMessage({
          type: 'RESET_DONE',
          seed: _engineSeed,
          snapshot: snap,
          wasmBytes: (_memory && _memory.buffer) ? _memory.buffer.byteLength : 0,
        });
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
      let snap = null;
      if (res.ok) {
        historyCheckpoints = [];
        lastCheckpointTick = -1;
        lastCheckpointRealTime = 0;
        snap = pullSnapshot(true);
        if (snap) {
          recordHistoryCheckpoint(snap.tick);
        }
      }
      self.postMessage({
        type: 'LOAD_RESULT',
        reqId: msg.reqId,
        ok: res.ok,
        error: res.error || '',
        snapshot: snap,
      });
      break;
    }

    case 'REWIND': {
      const res = rewindToTickInternal(msg.targetTick);
      self.postMessage({
        type: 'REWIND_RESULT',
        reqId: msg.reqId,
        ok: res.ok,
        error: res.error || '',
        snapshot: res.snapshot || null,
      });
      break;
    }
  }
};
