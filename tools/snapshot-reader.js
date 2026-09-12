#!/usr/bin/env node
/*
 * Flow & Accord · 通用快照读取器 (tools/snapshot-reader.js)
 * ============================================================================
 * 用途：为 `tools/` 下所有需要读取世界快照的工具提供**单一取值入口**。
 *
 *   · 走 ★ M4 FABS 二进制通道（`world_snapshot_bin_ptr/len` + 前端
 *     `frontend/js/snapshot-bin.js` 解码器）。
 *
 * 快照只有这一条通道（原 JSON 调试通道已于 v1.50.33 随 JSON 快照一并移除）：
 * 生产链路与工具链共用同一解码器，杜绝字段漂移风险，
 * 工具侧单帧开销保持在 FABS 的百微秒级。
 *
 * 用法：
 *   const { createSnapshotReader } = require('./snapshot-reader.js');
 *   const reader = createSnapshotReader(ex);       // ex = wasm instance.exports
 *   const snap  = reader.getSnapshot();            // 对象（默认全量帧）
 *   const str   = reader.getSnapshotString();      // 稳定序列化串（用于逐字节确定性比对）
 *
 * ⚠️ 两个语义约定
 *   1. `getSnapshotString()` 恒在取帧前调用 `world_require_terrain()`，强制输出
 *      **自包含全量帧**（地形 + 路网几何）。FABS 是增量格式，若不做这一步，
 *      同一世界在不同「取快照历史」下会得到不同字符串（lanes 可能为 null），
 *      会让 test-determinism 的 Suite 4 产生假阳性分叉。
 *   2. 帧间对象池化**恒为关闭**（v1.46.0 起 `setReuse()` 退化为空操作）：
 *      tools 常跨帧持有快照对象（如 diagnose.js 把 snap 存进 sampleSnapshots），
 *      池化会让它们全部指向同一实例并被静默改写；且 V8 实测池化收益为负。
 *      浏览器与 tools 从此共用同一条「每帧全新对象」的解码路径。
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DEC_PATH = path.join(ROOT, 'frontend', 'js', 'snapshot-bin.js');

/**
 * 在独立 vm 沙箱中装载前端二进制解码器。
 * 每个 wasm 实例必须持有**独立**解码器：字符串驻留表 id 是 per-world 的，共享会串味。
 */
function createDecoder() {
  const src = fs.readFileSync(DEC_PATH, 'utf8');
  const sandbox = { TextDecoder, TextEncoder, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox); // IIFE 以 window=this 全局挂 SnapshotBin
  const SnapshotBin = sandbox.SnapshotBin;
  if (!SnapshotBin) throw new Error('snapshot-bin.js 未暴露 SnapshotBin');
  return SnapshotBin;
}

/**
 * 为一个 wasm 实例创建快照读取器。
 * @param {object} ex      wasm instance.exports
 * @param {object} [opts]  { reuse?: boolean, decoder?: object }
 */
function createSnapshotReader(ex, opts) {
  opts = opts || {};
  const decoder = opts.decoder || createDecoder();
  const td = new TextDecoder();

  const hasBinary = typeof ex.world_snapshot_bin_ptr === 'function'
    && typeof ex.world_snapshot_bin_len === 'function';
  if (!hasBinary) {
    throw new Error('wasm 未提供二进制快照导出（缺少 world_snapshot_bin_ptr/len，请重新编译 WASM）');
  }

  // 枚举名称表注入解码器（缺失时解码出的枚举为 ''，不影响数值字段）
  if (typeof ex.world_enum_table_ptr === 'function') {
    const p = ex.world_enum_table_ptr();
    const l = ex.world_enum_table_len();
    if (l > 0) decoder.setEnumTables(td.decode(new Uint8Array(ex.memory.buffer, p, l)));
  }
  decoder.setReuse(!!opts.reuse);

  /** 读取一帧快照对象。opts.full=false 时允许增量帧（更快，但 lanes/nodes 可能为 null） */
  function getSnapshot(o) {
    const full = !o || o.full !== false;
    if (full && typeof ex.world_require_terrain === 'function') ex.world_require_terrain();
    const p = ex.world_snapshot_bin_ptr();
    const l = ex.world_snapshot_bin_len();
    if (!l) throw new Error('二进制快照为空');
    return decoder.decode(new Uint8Array(ex.memory.buffer, p, l).slice());
  }

  /** 自包含全量帧的稳定序列化串（同世界同 tick ⇒ 同串，与取快照历史无关） */
  function getSnapshotString() {
    return JSON.stringify(getSnapshot(true));
  }

  /** 引擎重建 / 读档后必须调用：清空解码器侧字符串驻留表缓存 */
  function resetCaches() {
    decoder.resetCaches();
  }

  return {
    hasBinary,
    channel: 'fabs',
    getSnapshot,
    getSnapshotString,
    resetCaches,
    decoder,
  };
}

module.exports = { createSnapshotReader, createDecoder, ROOT };
