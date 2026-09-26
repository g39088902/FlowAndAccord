// === 降水驱动水体粒子表现层 ===
// 水面不再由固定多边形填充：静态 WaterBody/River 只作为粒子初始边界和流向采样源，
// 粒子的位置、速度、覆盖率和水位由当前水体动态状态驱动。该层只负责表现，不修改
// Rust 模拟状态，也不消费 WorldRng。

(function (window) {
  'use strict';

  const MAX_RIVER_PARTICLES = 360;
  const MAX_BODY_PARTICLES = 180;
  const MAX_TOTAL_PARTICLES = 1800;
  const FIXED_DT = 1 / 60;
  const _particles = [];
  const _bodies = [];
  const _bodyById = new Map();
  let _initialized = false;
  let _lastTime = 0;

  function makePrng(seed) {
    let s = (seed ^ 0x6d2b79f5) >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pointInPolygon(vertices, x, y) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const a = vertices[i], b = vertices[j];
      const crosses = ((a.y > y) !== (b.y > y)) &&
        (x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-6) + a.x);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function polygonBounds(vertices) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let cx = 0, cy = 0;
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      cx += v.x; cy += v.y;
    }
    const n = Math.max(1, vertices.length);
    return { minX, maxX, minY, maxY, cx: cx / n, cy: cy / n };
  }

  function samplePolygon(body, rng) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const x = body.bounds.minX + rng() * (body.bounds.maxX - body.bounds.minX);
      const y = body.bounds.minY + rng() * (body.bounds.maxY - body.bounds.minY);
      if (pointInPolygon(body.vertices, x, y)) return { x, y };
    }
    return { x: body.bounds.cx, y: body.bounds.cy };
  }

  function riverSample(body, t, lateral, coverage, out) {
    const half = body.half;
    const f = Math.max(0, Math.min(half - 1, t * (half - 1)));
    const i0 = Math.floor(f), i1 = Math.min(half - 1, i0 + 1);
    const frac = f - i0;
    const left0 = body.vertices[i0], left1 = body.vertices[i1];
    const right0 = body.vertices[body.vertices.length - 1 - i0];
    const right1 = body.vertices[body.vertices.length - 1 - i1];
    const lx = left0.x + (left1.x - left0.x) * frac;
    const ly = left0.y + (left1.y - left0.y) * frac;
    const rx = right0.x + (right1.x - right0.x) * frac;
    const ry = right0.y + (right1.y - right0.y) * frac;
    const centerX = (lx + rx) * 0.5;
    const centerY = (ly + ry) * 0.5;
    const nextT = Math.min(1, t + 1 / Math.max(2, half - 1));
    const nf = nextT * (half - 1), ni = Math.min(half - 1, Math.floor(nf));
    const nextLeft = body.vertices[ni], nextRight = body.vertices[body.vertices.length - 1 - ni];
    let tx = (nextLeft.x + nextRight.x) * 0.5 - centerX;
    let ty = (nextLeft.y + nextRight.y) * 0.5 - centerY;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    const width = Math.hypot(rx - lx, ry - ly) * 0.5 * Math.sqrt(coverage);
    const normalX = -ty, normalY = tx;
    out.x = centerX + normalX * lateral * width;
    out.y = centerY + normalY * lateral * width;
    out.z = ((left0.z || body.feature.elevation || 0) + (right0.z || body.feature.elevation || 0)) * 0.5;
    out.dirX = tx; out.dirY = ty;
  }

  const WaterParticles = {
    init: function (features, seed) {
      _particles.length = 0;
      _bodies.length = 0;
      _bodyById.clear();
      _initialized = false;
      if (!features || !features.length) return;
      const rng = makePrng((seed || 0) ^ 0x57415452);
      for (let fi = 0; fi < features.length; fi++) {
        const feature = features[fi];
        if ((feature.kind !== 'River' && feature.kind !== 'WaterBody') ||
            !feature.vertices || feature.vertices.length < 4) continue;
        if (_particles.length >= MAX_TOTAL_PARTICLES) break;
        const bounds = polygonBounds(feature.vertices);
        const body = {
          id: feature.id,
          feature,
          kind: feature.kind,
          vertices: feature.vertices,
          bounds,
          half: feature.kind === 'River' ? feature.vertices.length >> 1 : 0,
          count: feature.kind === 'River' ? MAX_RIVER_PARTICLES : MAX_BODY_PARTICLES,
        };
        _bodies.push(body);
        _bodyById.set(body.id, body);
        const count = Math.min(body.count, MAX_TOTAL_PARTICLES - _particles.length);
        for (let i = 0; i < count; i++) {
          const p = {
            bodyId: body.id,
            ordinal: i,
            pathT: rng(),
            lateral: rng() * 1.8 - 0.9,
            localX: 0,
            localY: 0,
            vx: (rng() * 2 - 1) * 5,
            vy: (rng() * 2 - 1) * 5,
            phase: rng() * Math.PI * 2,
            size: 0.7 + rng() * 1.25,
            tone: i % 7 === 0,
            x: bounds.cx, y: bounds.cy, z: feature.elevation || 0,
            dirX: 0, dirY: 1, active: true,
          };
          if (body.kind === 'WaterBody') {
            const sample = samplePolygon(body, rng);
            p.localX = sample.x - bounds.cx;
            p.localY = sample.y - bounds.cy;
          }
          _particles.push(p);
        }
      }
      _initialized = _particles.length > 0;
    },

    isInitialized: function () { return _initialized; },

    update: function (timeMs) {
      if (!_initialized) return;
      if (!_lastTime) _lastTime = timeMs;
      _lastTime = timeMs;
      for (let bi = 0; bi < _bodies.length; bi++) {
        const body = _bodies[bi];
        const state = (window.rustWorldSim && window.rustWorldSim.waterBodyDynamics)
          ? window.rustWorldSim.waterBodyDynamics.get(body.id) : null;
        const coverage = state ? Math.max(0, Math.min(1, state.coverage)) : 1;
        const flow = state ? Math.max(0, Math.min(1, state.flowStrength)) : 0.35;
        const activeCount = Math.floor(body.count * Math.min(1, 0.08 + coverage * 0.92));
        for (let pi = 0; pi < _particles.length; pi++) {
          const p = _particles[pi];
          if (p.bodyId !== body.id) continue;
          p.active = coverage > 0.005 && p.ordinal < activeCount;
          if (!p.active) continue;
          p.phase += FIXED_DT * (1.5 + flow * 4.0);
          if (body.kind === 'River') {
            p.pathT = (p.pathT + FIXED_DT * (0.018 + flow * 0.075) + 1) % 1;
            riverSample(body, p.pathT, p.lateral + Math.sin(p.phase) * 0.04, coverage, p);
          } else {
            const scale = Math.sqrt(coverage);
            p.localX += p.vx * FIXED_DT * (0.35 + flow);
            p.localY += p.vy * FIXED_DT * (0.35 + flow);
            let wx = body.bounds.cx + p.localX * scale;
            let wy = body.bounds.cy + p.localY * scale;
            if (!pointInPolygon(body.vertices, wx, wy)) {
              p.vx = -p.vx; p.vy = -p.vy;
              p.localX *= 0.92; p.localY *= 0.92;
              wx = body.bounds.cx + p.localX * scale;
              wy = body.bounds.cy + p.localY * scale;
            }
            p.x = wx; p.y = wy;
            p.z = (state && Number.isFinite(state.level)) ? state.level : (body.feature.elevation || 0);
            p.dirX = p.vx; p.dirY = p.vy;
          }
          if (body.kind === 'River') {
            p.z = (state && Number.isFinite(state.level)) ? state.level : p.z;
          }
        }
      }
    },

    particles: function () { return _initialized ? _particles : null; },

    drawParticle: function (ctx, p, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
      if (!p || !p.active) return;
      const rx = p.x * cosZ - p.y * sinZ;
      const ry = p.x * sinZ + p.y * cosZ;
      const y2 = ry * cosX - (p.z || 0) * sinX;
      const px = cx + rx * scale, py = cy + y2 * scale;
      const radius = Math.max(1.0, p.size * scale * (p.tone ? 1.15 : 0.82));
      const alpha = p.tone ? 0.46 : 0.22;
      const sink = (window.WebGLAccentLayer && window.WebGLAccentLayer.sinkOn)
        ? window.WebGLAccentLayer : null;
      if (sink) {
        sink.beginAccent(p.x, p.y, p.z);
        const r = p.tone ? 0.48 : 0.18;
        const g = p.tone ? 0.84 : 0.57;
        const b = p.tone ? 0.92 : 0.78;
        sink.quad(px - radius, py, px, py - radius * 0.45,
          px + radius, py, px, py + radius * 0.45, r, g, b, alpha);
        return;
      }
      ctx.fillStyle = p.tone ? 'rgba(122, 214, 235, 0.46)' : 'rgba(46, 145, 198, 0.22)';
      ctx.beginPath();
      ctx.ellipse(px, py, radius, radius * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    },
  };

  window.WaterParticles = WaterParticles;
})(window);
