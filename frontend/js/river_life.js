// === 水系微观生态纯表现层 (RiverLife) ===
// 提供水底鹅卵石、成群游鱼与动态太阳波光粼粼
// 依赖全局: window.SimLighting (可选)

(function (window) {
  'use strict';

  // 预分配静态对象与缓冲区 (零每帧 GC)
  const MAX_ROCKS = 120;
  const MAX_FISH = 24;

  // 卵石数据: [x, y, z, rx, ry, colIdx, specAngle] 扁平数组
  const _rockData = new Float32Array(MAX_ROCKS * 7);
  let _rockCount = 0;

  // 卵石质感色盘 (微缩沙盘深色水底卵石色系)
  const ROCK_COLORS = [
    { fill: 'rgba(38, 52, 60, 0.88)', highlight: 'rgba(72, 96, 108, 0.45)' },
    { fill: 'rgba(46, 62, 68, 0.88)', highlight: 'rgba(84, 112, 120, 0.45)' },
    { fill: 'rgba(56, 50, 42, 0.88)', highlight: 'rgba(96, 86, 72, 0.45)' },
    { fill: 'rgba(32, 45, 54, 0.88)', highlight: 'rgba(64, 85, 100, 0.45)' },
    { fill: 'rgba(48, 56, 48, 0.88)', highlight: 'rgba(88, 102, 88, 0.45)' },
  ];

  // 游鱼数据
  const _fishList = [];
  const FISH_PALETTES = [
    { body: 'rgba(235, 115, 55, 0.88)', fin: 'rgba(255, 165, 105, 0.75)' },  // 锦鲤赤金
    { body: 'rgba(220, 180, 50, 0.88)', fin: 'rgba(255, 215, 110, 0.75)' },  // 金鲤明黄
    { body: 'rgba(45, 65, 78, 0.88)',   fin: 'rgba(95, 125, 145, 0.75)' },   // 青黑溪斑
    { body: 'rgba(238, 245, 250, 0.92)', fin: 'rgba(210, 230, 245, 0.75)' },  // 白练银鱼
  ];

  // 河道中心线参考采样缓存 (用于游鱼巡航插值)
  let _centerPoints = null; // [{x, y, z, halfWidth, dirX, dirY}]
  let _initialized = false;

  // 伪随机数发生器 (Mulberry32)
  function makePrng(seed) {
    let s = (seed ^ 0x9e3779b9) >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const RiverLife = {
    /**
     * 初始化水系生态几何（水底卵石分布 + 鱼群编队）
     * 仅在地图重置或创世时调用一次
     */
    init: function (features, seed) {
      if (!features || !features.length) {
        _rockCount = 0;
        _fishList.length = 0;
        _centerPoints = null;
        _initialized = false;
        return;
      }

      const riverFeat = features.find(f => f.kind === 'River');
      // 只要求左右岸各有 ≥2 个顶点（halfLen ≥ 2），不绑定具体剖分密度
      if (!riverFeat || !riverFeat.vertices || riverFeat.vertices.length < 4) {
        _rockCount = 0;
        _fishList.length = 0;
        _centerPoints = null;
        _initialized = false;
        return;
      }

      const v = riverFeat.vertices;
      const halfLen = Math.floor(v.length / 2);
      _centerPoints = [];

      for (let i = 0; i < halfLen; i++) {
        const j = v.length - 1 - i;
        const left = v[i];
        const right = v[j];
        const cx = (left.x + right.x) * 0.5;
        const cy = (left.y + right.y) * 0.5;
        const cz = (left.z + right.z) * 0.5;
        const hw = Math.hypot(right.x - left.x, right.y - left.y) * 0.5;
        _centerPoints.push({ x: cx, y: cy, z: cz, hw: Math.max(4, hw), dirX: 0, dirY: 1 });
      }

      // 计算切线方向
      for (let i = 0; i < halfLen; i++) {
        const prev = _centerPoints[Math.max(0, i - 1)];
        const next = _centerPoints[Math.min(halfLen - 1, i + 1)];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        _centerPoints[i].dirX = dx / len;
        _centerPoints[i].dirY = dy / len;
      }

      const rng = makePrng((seed || 12345) ^ 0x52495645);

      // 1. 生成水底卵石 (80~100 颗大小与材质不同的扁圆石块)
      _rockCount = Math.min(MAX_ROCKS, 85);
      for (let i = 0; i < _rockCount; i++) {
        // 沿河道纵向分布 (避开最极端的出图端口)
        const tIdx = 2 + Math.floor(rng() * (halfLen - 5));
        const cp = _centerPoints[tIdx];
        // 沿横向水底微偏，避免跑出水体
        const sideOffset = (rng() * 2 - 1) * cp.hw * 0.72;
        const normX = -cp.dirY;
        const normY = cp.dirX;
        const rx = cp.x + normX * sideOffset;
        const ry = cp.y + normY * sideOffset;
        const rz = cp.z - 1.2; // 水底深凹标高

        const radiusX = 2.4 + rng() * 3.6; // 半径 2.4m ~ 6.0m
        const radiusY = radiusX * (0.65 + rng() * 0.35); // 扁圆长宽比
        const colIdx = Math.floor(rng() * ROCK_COLORS.length);
        const specAngle = rng() * Math.PI * 2;

        const base = i * 7;
        _rockData[base + 0] = rx;
        _rockData[base + 1] = ry;
        _rockData[base + 2] = rz;
        _rockData[base + 3] = radiusX;
        _rockData[base + 4] = radiusY;
        _rockData[base + 5] = colIdx;
        _rockData[base + 6] = specAngle;
      }

      // 2. 生成游鱼 (4 组鱼群，共 22 条鱼)
      _fishList.length = 0;
      const shoalCount = 4;
      for (let s = 0; s < shoalCount; s++) {
        const shoalT = rng(); // 鱼群在河道的基准进度 0..1
        const shoalSide = (rng() * 2 - 1) * 0.55;
        const shoalSpeed = 0.012 + rng() * 0.016; // 巡游基速
        const shoalDirection = rng() > 0.4 ? 1 : -1; // 大多数顺流，部分逆流
        const palette = FISH_PALETTES[s % FISH_PALETTES.length];
        const countInShoal = 5 + Math.floor(rng() * 3); // 每群 5~7 条

        for (let k = 0; k < countInShoal; k++) {
          _fishList.push({
            shoalId: s,
            t: (shoalT + (rng() - 0.5) * 0.06 + 1.0) % 1.0,
            side: shoalSide + (rng() - 0.5) * 0.22,
            speed: shoalSpeed * (0.85 + rng() * 0.30) * shoalDirection,
            wigglePhase: rng() * Math.PI * 2,
            wiggleSpeed: 8 + rng() * 6,
            bodyLength: 2.4 + rng() * 1.5, // 鱼身长度 2.4m ~ 3.9m (微缩沙盘适中醒目)
            palette: palette,
            // 实时坐标缓存
            x: 0, y: 0, z: 0, angle: 0
          });
        }
      }

      _initialized = true;
    },

    /**
     * 更新游鱼运动状态（纯数学无堆分配）
     * 注：走墙钟而非仿真时钟——模拟暂停时鱼群与水面虚线/波光同样继续流动，
     * 属写意微缩沙盘的环境生命感设计决策（与 render_terrain 水面动画行为一致）
     */
    update: function (timeMs) {
      if (!_initialized || !_centerPoints || !_centerPoints.length) return;
      const dt = 0.016; // 平滑固定步进
      const halfLen = _centerPoints.length;

      for (let i = 0; i < _fishList.length; i++) {
        const fish = _fishList[i];
        fish.t = (fish.t + fish.speed * dt + 1.0) % 1.0;
        fish.wigglePhase += fish.wiggleSpeed * dt;

        // 在中心线上插值
        const fIdx = fish.t * (halfLen - 1);
        const idx0 = Math.floor(fIdx);
        const idx1 = Math.min(halfLen - 1, idx0 + 1);
        const frac = fIdx - idx0;

        const cp0 = _centerPoints[idx0];
        const cp1 = _centerPoints[idx1];

        const cx = cp0.x + (cp1.x - cp0.x) * frac;
        const cy = cp0.y + (cp1.y - cp0.y) * frac;
        const cz = cp0.z + (cp1.z - cp0.z) * frac;
        const hw = cp0.hw + (cp1.hw - cp0.hw) * frac;

        // 细微正弦游弋扰动
        const wiggleOffset = Math.sin(fish.wigglePhase * 0.5) * 0.18 * hw;
        const totalSide = (fish.side * hw * 0.65) + wiggleOffset;

        const dirX = cp0.dirX + (cp1.dirX - cp0.dirX) * frac;
        const dirY = cp0.dirY + (cp1.dirY - cp0.dirY) * frac;
        const normX = -dirY;
        const normY = dirX;

        fish.x = cx + normX * totalSide;
        fish.y = cy + normY * totalSide;
        fish.z = cz - 0.7; // 游在水中层 (略低于水面)

        // 朝向角
        const forwardX = dirX * (fish.speed >= 0 ? 1 : -1);
        const forwardY = dirY * (fish.speed >= 0 ? 1 : -1);
        fish.angle = Math.atan2(forwardY, forwardX);
      }
    },

    /**
     * Pass 1.5: 绘制水底卵石（在水面填充之前绘制，盖上水面后自然呈现水底景深）
     */
    drawRiverbed: function (ctx, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
      if (!_initialized || !_rockCount) return;

      // A3 高光斑朝向跟随季节光源（关闭动态光照时退回旧固定光西北 41° 的等效方向）；
      // specAngle 保留为逐石微抖动，避免石堆高光整齐划一
      const L = window.SimLighting;
      let sunX = -0.55, sunY = -0.83;
      if (L && L.enabled()) {
        const sd = L.sunScreenDir();
        sunX = sd.x; sunY = sd.y;
      }
      const sunAng = Math.atan2(sunY, sunX);

      ctx.save();
      for (let i = 0; i < _rockCount; i++) {
        const base = i * 7;
        const wx = _rockData[base + 0];
        const wy = _rockData[base + 1];
        const wz = _rockData[base + 2];
        const radX = _rockData[base + 3] * scale;
        const radY = _rockData[base + 4] * scale;
        const col = ROCK_COLORS[_rockData[base + 5]];
        const specAngle = _rockData[base + 6];

        // 3D 投影
        const rx = wx * cosZ - wy * sinZ;
        const ry = wx * sinZ + wy * cosZ;
        const y2 = ry * cosX - wz * sinX;
        const px = cx + rx * scale;
        const py = cy + y2 * scale;

        // 视口粗剔除（含卵石半径与高光斑余量）
        if (px < -64 || px > w + 64 || py < -64 || py > h + 64) continue;

        // 扁圆水底卵石主体
        ctx.fillStyle = col.fill;
        ctx.beginPath();
        ctx.ellipse(px, py, Math.max(1.8, radX), Math.max(1.2, radY), camera.rotZ * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // 受光微反光斑点（偏向光源一侧 + 逐石抖动）
        const jitAng = sunAng + (specAngle - Math.PI) * 0.18;
        const spotX = px + Math.cos(jitAng) * radX * 0.35;
        const spotY = py + Math.sin(jitAng) * radY * 0.35;
        ctx.fillStyle = col.highlight;
        ctx.beginPath();
        ctx.ellipse(spotX, spotY, Math.max(1.0, radX * 0.42), Math.max(0.7, radY * 0.35), 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },

    /**
     * Pass 1.8: 绘制游鱼群（在水面填充之前绘制）
     */
    drawFish: function (ctx, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
      if (!_initialized || !_fishList.length) return;

      ctx.save();
      for (let i = 0; i < _fishList.length; i++) {
        const f = _fishList[i];
        // 3D 投影
        const rx = f.x * cosZ - f.y * sinZ;
        const ry = f.x * sinZ + f.y * cosZ;
        const y2 = ry * cosX - f.z * sinX;
        const px = cx + rx * scale;
        const py = cy + y2 * scale;

        // 视口粗剔除（含鱼身长度余量）
        if (px < -32 || px > w + 32 || py < -32 || py > h + 32) continue;

        // 屏幕空间旋转角度 (世界朝向经相机 rotZ 变换)
        const screenRot = f.angle + camera.rotZ;
        const len = Math.max(3.6, f.bodyLength * scale * 0.95);
        const wid = len * 0.35;
        const tailWag = Math.sin(f.wigglePhase) * (len * 0.32);

        ctx.translate(px, py);
        ctx.rotate(screenRot);

        // 1. 鱼身影子 (水底微弱投影)
        ctx.fillStyle = 'rgba(15, 30, 42, 0.28)';
        ctx.beginPath();
        ctx.ellipse(-len * 0.1, wid * 0.4, len * 0.45, wid * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();

        // 2. 鱼身主体 (流线型梭形)
        ctx.fillStyle = f.palette.body;
        ctx.beginPath();
        ctx.moveTo(len * 0.55, 0); // 鱼头
        ctx.quadraticCurveTo(len * 0.1, wid * 0.55, -len * 0.45, tailWag * 0.4); // 腹部
        ctx.lineTo(-len * 0.55, tailWag); // 鱼尾基底
        ctx.quadraticCurveTo(len * 0.1, -wid * 0.55, len * 0.55, 0); // 背部
        ctx.closePath();
        ctx.fill();

        // 3. 鱼背部高光线 (呈现水面透光下的鱼背流线反光)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = Math.max(0.6, 0.8 * scale);
        ctx.beginPath();
        ctx.moveTo(len * 0.35, 0);
        ctx.quadraticCurveTo(0, -wid * 0.18, -len * 0.30, tailWag * 0.3);
        ctx.stroke();

        // 4. 灵动半透明摆尾 (两瓣尾鳍)
        ctx.fillStyle = f.palette.fin;
        ctx.beginPath();
        ctx.moveTo(-len * 0.45, tailWag * 0.4);
        ctx.lineTo(-len * 0.90, tailWag - wid * 0.45);
        ctx.lineTo(-len * 0.72, tailWag);
        ctx.lineTo(-len * 0.90, tailWag + wid * 0.45);
        ctx.closePath();
        ctx.fill();

        ctx.rotate(-screenRot);
        ctx.translate(-px, -py);
      }
      ctx.restore();
    },

    /**
     * Pass 2.8: 迎光面太阳波光粼粼 (Sun Caustics Glint)
     * 在水面填充之后绘制，联动已有季节光照方位
     */
    drawSunGlint: function (ctx, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
      if (!_initialized || !_centerPoints || !_centerPoints.length) return;
      const L = window.SimLighting;
      if (!L || !L.enabled()) return;

      const sunDir = L.sunScreenDir();
      const halfLen = _centerPoints.length;
      const now = performance.now() * 0.001;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255, 252, 220, 0.55)'; // 暖金细碎波光
      ctx.lineWidth = Math.max(1.0, 1.4 * scale);

      // 每隔 6~8 个节点选取受光小波段
      for (let i = 4; i < halfLen - 6; i += 7) {
        const cp = _centerPoints[i];
        // A2 迎光相位调制：河道切线与太阳屏幕方向的夹角决定波光强度，
        // 取 |dot| 让两个走向的碎浪面都参与反光，背光河段自然减弱
        const dot = Math.abs(cp.dirX * sunDir.x + cp.dirY * sunDir.y);
        const sparkle = Math.sin(now * 3.5 + i * 1.7);
        if (sparkle < 0.25) continue; // 细碎闪烁节奏

        const facing = Math.max(0.15, Math.min(1, dot));
        ctx.strokeStyle = `rgba(255, 252, 220, ${(0.16 + 0.40 * facing).toFixed(3)})`;
        const waveLen = (8 + Math.sin(i + now) * 4) * scale;
        const offset = Math.sin(now * 2.0 + i) * cp.hw * 0.35;

        const wx = cp.x - cp.dirY * offset;
        const wy = cp.y + cp.dirX * offset;
        const rx = wx * cosZ - wy * sinZ;
        const ry = wx * sinZ + wy * cosZ;
        const y2 = ry * cosX - cp.z * sinX;
        const px = cx + rx * scale;
        const py = cy + y2 * scale;

        ctx.beginPath();
        ctx.moveTo(px - cp.dirX * waveLen * 0.5, py - cp.dirY * waveLen * 0.5);
        ctx.lineTo(px + cp.dirX * waveLen * 0.5, py + cp.dirY * waveLen * 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  window.RiverLife = RiverLife;
})(window);
