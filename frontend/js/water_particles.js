// === 水体粒子渲染层（GPU 求解器粒子 = 水面唯一来源）===
// 定位变更（★ v1.62.0）：本文件**不再自带求解器**。★ 2026-09-26 起水面运动学由前端
// WebGPU 的 3D PBF 求解器 `frontend/js/water_gpu.js`（`window.WaterGPU`）负责，
// 每帧把存活粒子写成 `rustWorldSim.fluidParticles`（扁平 [x,y,z,…] Float32Array，
// 三维真实位置）+ `fluidParticleIds`（槽位号）+ 粒径。
//
// 本层只做三件事：
//   ① 把求解器粒子映射为绘制视图（逐粒子视觉抖动由**槽位号**哈希派生，稳定不闪）；
//   ② 复用 v1.61.4 的观感常量与落笔路径（压扁菱形、同源配色、每 5 粒一位亮点）；
//   ③ 向统一深度队列暴露与旧接口同名的 `particles()` / `drawParticle()`。
//
// 不变量（违反即出 bug）：
//   ① 不写模拟状态、不消耗 WorldRng、不进存档——粒子位置只读自求解器输出；
//   ② 稳态零堆分配：粒子对象数组按需扩展后原地复用，`update` 只写数值字段；
//   ③ 观感常量与 v1.61.4 逐位一致（配色 / 透明度 / 亮点抽样 / 抖动区间）；
//   ④ sink 硬门槛：GL 图元层未就绪的帧整帧跳过（Canvas 备用通道已删除）。

(function (window) {
  'use strict';

  // ── 观感常量（单点真相源；与 v1.61.4 前端同源）──
  const TONE_EVERY = 5;                 // 每 N 个粒子选一个亮点（写意波光）
  const ALPHA_FILL = 0.26;              // 水面粒子基准透明度
  const ALPHA_TONE = 0.34;              // 亮点粒子基准透明度
  const COVER_ALPHA_MIN = 0.30;         // 低降雨时透明度下限系数
  const WAVE_AMP = 0.16;                // 竖向起伏振幅（m，纯表现层）
  const WAVE_RATE = 2.1;                // 竖向起伏角速度（rad/s）
  const TAU = Math.PI * 2;
  // 与 v1.61.2 同源配色（rgba(46,145,198) / rgba(122,214,235)）——保持写意低饱和
  const FILL_R = 46 / 255, FILL_G = 145 / 255, FILL_B = 198 / 255;
  const TONE_R = 122 / 255, TONE_G = 214 / 255, TONE_B = 235 / 255;

  const _particles = [];        // 绘制视图（按内核下标一一对应）
  let _bodyView = { alphaK: 1 }; // 共享"水体"引用（兼容 drawParticle 的 p.body.alphaK）
  let _initialized = false;
  let _seed = 1;
  // 兜底粒径（正常帧恒由内核 Fluid section 下发；★ 基准间距 4.42m 与内核
  // `RENDER_SPACING_BASE` 同源——已与求解器目标间距解耦，故间距抬升不改显示大小）
  let _fillRadius = 4.42 * 1.30;
  let _toneRadius = 4.42 * 0.52;
  let _lastRevision = 0;
  let _srcRef = null;           // 上一次消费的粒子数组（换帧数组时重建视图）
  let _idsRef = null;           // 与之配套的槽位号数组（GPU 求解器下发；缺省回退渲染下标）

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  // 粒子槽位号 → [0,1) 稳定哈希（通道 salt 区分用途；保证同槽位永远同一抖动）。
  // ★ 2026-09-26 GPU 求解器按存活序压缩输出，改用**槽位号**（fluidParticleIds）而非渲染下标，
  //   避免压缩/补源造成的下标漂移让颗粒纹理跳变（无 ids 时回退下标）。
  function hash01(i, salt) {
    let h = (i * 0x9e3779b1 + salt * 0x85ebca6b + _seed * 0x27d4eb2f) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0;
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  // 视图条目：视觉属性按**槽位号**派生，仅在槽位号变化时重派生（稳态不再写）
  function ensureParticle(i, id) {
    let p = _particles[i];
    if (p && p.id === id) return p;
    const tone = (id % TONE_EVERY) === 0;
    const rot = hash01(id, 4) * TAU;
    p = {
      index: i,
      id: id,
      tone: tone,
      sizeK: 0.82 + 0.36 * hash01(id, 1),
      phase: hash01(id, 2) * TAU,
      phase2: hash01(id, 3) * TAU,
      rotC: Math.cos(rot),
      rotS: Math.sin(rot),
      aK: 0.78 + 0.22 * hash01(id, 5),
      flick: 1,
      body: _bodyView,
      active: true,
      x: 0, y: 0, z: 0, zBase: 0,
      rWorld: 0,
    };
    _particles[i] = p;
    return p;
  }

  const WaterParticles = {
    // 世界重建钩子（rustworld.js 在地形重建时调用）：只重置视觉状态与视图缓存。
    // 参数保持旧签名以兼容调用点；`features` / `seed` 现在只用于标记世界身份。
    // ★ v1.63.0：**不再以「静态水系特征非空」作为启用门槛**——水是开放循环，
    //   全图降雨会在没有任何水系特征的地形（山口 / 冲积扇 / 半坡）上造出水体，
    //   故本层恒启用，有无水完全由水求解器（`WaterGPU`）的粒子层决定（清空即无视图）。
    init: function (features, seed) {
      _particles.length = 0;
      _srcRef = null;
      _idsRef = null;
      _lastRevision = 0;
      _seed = (Number.isFinite(seed) && seed > 0) ? (seed >>> 0) : 1;
      // 世界身份参与抖动盐，换世界后颗粒纹理不残留（同种子仍逐位一致）
      _initialized = true;
      return _initialized;
    },

    isInitialized: function () { return _initialized; },

    // 每帧从 GPU 求解器读取粒子位置（三维真实坐标）。无求解、无积分——只做视图映射
    // 与轻微竖向起伏（墙钟只驱动"波光闪烁"这类纯表现层动画）。
    update: function (timeMs) {
      if (!_initialized) return;
      const sim = window.rustWorldSim;
      const src = sim ? sim.fluidParticles : null;
      if (!src || src.length < 3) {
        _particles.length = 0;
        _srcRef = null;
        return;
      }
      const count = (src.length / 3) | 0;
      if (src !== _srcRef) {
        _srcRef = src;
        _idsRef = (sim.fluidParticleIds && sim.fluidParticleIds.length === count) ? sim.fluidParticleIds : null;
        // 粒径只在长度不被整除时兜底（正常帧恒由求解器下发）
        if (Number.isFinite(sim.fluidFillRadius) && sim.fluidFillRadius > 0) {
          _fillRadius = sim.fluidFillRadius;
          _toneRadius = sim.fluidToneRadius > 0 ? sim.fluidToneRadius : sim.fluidFillRadius * 0.4;
        }
        _lastRevision = sim.fluidRevision || 0;
      }
      // 视图长度与粒子数对齐（视觉属性按槽位号派生，槽位号变化时才重派生）
      if (_particles.length > count) _particles.length = count;
      for (let i = 0; i < count; i++) {
        const p = ensureParticle(i, _idsRef ? _idsRef[i] : i);
        const o3 = i * 3;
        p.x = src[o3];
        p.y = src[o3 + 1];
        p.zBase = src[o3 + 2];         // ★ 三维真实高度（自由落体 / 堆叠 / 跌落后）
        p.rWorld = p.sizeK * (p.tone ? _toneRadius : _fillRadius);
      }
      // 降雨调制整体透明度（雨大水面更实，无雨更透；纯表现层）
      const rain = (sim && Number.isFinite(sim.rainfallIntensity))
        ? Math.max(0, Math.min(3, sim.rainfallIntensity)) : 1;
      _bodyView.alphaK = COVER_ALPHA_MIN + (1 - COVER_ALPHA_MIN) * clamp01(rain);
      // 波光闪烁（墙钟；暂停模拟时水面仍有生命感，与游鱼同属写意设计）
      const tSec = timeMs * 0.001;
      for (let i = 0; i < count; i++) {
        const p = _particles[i];
        p.flick = 0.72 + 0.28 * Math.sin(tSec * 2.6 + p.phase * 1.7);
        // 竖向弱起伏：写意水面颗粒，不参与任何物理（基准 z 每帧重取，不累加）
        p.z = p.zBase + Math.sin(tSec * WAVE_RATE + p.phase2) * WAVE_AMP * 0.5;
      }
      _lastRevision = (sim && sim.fluidRevision) || _lastRevision;
    },

    particles: function () { return _initialized ? _particles : null; },

    // 调试探针（浏览器验证 / 性能核对用；不做逐帧调用）
    stats: function () {
      return {
        bodies: 0,                 // 旧字段：水体分块已取消（内核统一求解）
        particles: _particles.length,
        active: _particles.length,
        steps: _lastRevision,
        fillRadius: _fillRadius,
        toneRadius: _toneRadius,
      };
    },

    // 逐条绘制（由统一深度队列按相机深度调度）。★ sink 硬门槛：GL 图元层未就绪的帧
    // 整帧跳过（Canvas 备用通道已删除）；粒子 = 压扁菱形（同 v1.61.2 粒子、游鱼影口径），
    // 逐粒子旋转 / 尺寸 / 透明度抖动打散规则栅格感（写意水面颗粒）。
    drawParticle: function (ctx, p, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
      if (!p || !p.active) return;
      const sink = (window.WebGLAccentLayer && window.WebGLAccentLayer.sinkOn)
        ? window.WebGLAccentLayer : null;
      if (!sink) return;
      const rx = p.x * cosZ - p.y * sinZ;
      const ry = p.x * sinZ + p.y * cosZ;
      const px = cx + rx * scale;
      const py = cy + (ry * cosX - p.z * sinX) * scale;
      const r = (p.rWorld || 2) * scale;
      if (r < 0.4) return;                   // 亚像素省略
      const a = (p.tone ? ALPHA_TONE : ALPHA_FILL) * p.body.alphaK * p.flick * p.aK;
      const rq = r * 0.45;
      const x1 = r * p.rotC, y1 = r * p.rotS;        // 长轴 (r,0) 旋转后
      const x2 = -rq * p.rotS, y2 = rq * p.rotC;     // 短轴 (0,rq) 旋转后
      sink.beginAccent(p.x, p.y, p.z);
      if (p.tone) {
        sink.quad(px - x1, py - y1, px + x2, py + y2, px + x1, py + y1, px - x2, py - y2,
          TONE_R, TONE_G, TONE_B, a);
      } else {
        sink.quad(px - x1, py - y1, px + x2, py + y2, px + x1, py + y1, px - x2, py - y2,
          FILL_R, FILL_G, FILL_B, a);
      }
    },
  };

  window.WaterParticles = WaterParticles;
})(window);
