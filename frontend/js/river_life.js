// === 水系微观生态纯表现层 (RiverLife) ===
// 提供成群游鱼与动态太阳波光粼粼
// （★ v1.50.4 移除水底卵石层：深色扁圆石透水面观感呈"一堆深蓝色圆圈"，见 01-changelog.md）
// 依赖全局: window.SimLighting (可选)

(function (window) {
  'use strict';

  // 预分配静态对象与缓冲区 (零每帧 GC)
  const MAX_FISH = 24;

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
     * 初始化水系生态几何（鱼群编队）
     * 仅在地图重置或创世时调用一次
     */
    init: function (features, seed) {
      if (!features || !features.length) {
        _fishList.length = 0;
        _centerPoints = null;
        _initialized = false;
        return;
      }

      const riverFeat = features.find(f => f.kind === 'River');
      // 只要求左右岸各有 ≥2 个顶点（halfLen ≥ 2），不绑定具体剖分密度
      if (!riverFeat || !riverFeat.vertices || riverFeat.vertices.length < 4) {
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
        _centerPoints.push({ x: cx, y: cy, z: cz, hw: Math.max(4, hw), dirX: 0, dirY: 1, idx: i });
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

      // 生成游鱼 (4 组鱼群，共 22 条鱼)
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
     * 注：走墙钟而非仿真时钟——模拟暂停时鱼群与水面波光同样继续流动，
     * 属写意微缩沙盘的环境生命感设计决策（与 render_terrain 水面动画行为一致；
     * v1.50.3 起水面微波虚线已移除，仅剩波光层）
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
     * Pass 1.8: 绘制游鱼群（批量入口，保留兼容；★ v1.50.11 起深度队列逐条调用 drawFishSingle）
     */
    drawFish: function (ctx, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
      if (!_initialized || !_fishList.length) return;
      for (let i = 0; i < _fishList.length; i++) {
        this.drawFishSingle(ctx, _fishList[i], cx, cy, cosZ, sinZ, cosX, sinX, scale);
      }
    },

    /**
     * ★ v1.50.11 游鱼清单访问器：统一深度队列逐条取鱼并按鱼体世界坐标 (x,y,z) 计算深度入队，
     * 使近处山体/地形格能正确遮挡远处水下的游鱼（旧批量整层先画会透山可见）。
     */
    fishList: function () {
      return _initialized ? _fishList : null;
    },

    /**
     * ★ v1.50.11 河道中心线采样点访问器：波光逐段入队用（配合 drawGlintAt）。
     */
    centerPoints: function () {
      return _initialized ? _centerPoints : null;
    },

    /**
     * ★ v1.50.11 单条游鱼绘制（由统一深度队列调度）。
     */
    drawFishSingle: function (ctx, f, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
      {
        // 3D 投影
        const rx = f.x * cosZ - f.y * sinZ;
        const ry = f.x * sinZ + f.y * cosZ;
        const y2 = ry * cosX - f.z * sinX;
        const px = cx + rx * scale;
        const py = cy + y2 * scale;

        // 视口粗剔除（含鱼身长度余量）
        if (px < -32 || px > w + 32 || py < -32 || py > h + 32) return;

        // 屏幕空间旋转角度 (世界朝向经相机 rotZ 变换)
        const screenRot = f.angle + camera.rotZ;
        const len = Math.max(3.6, f.bodyLength * scale * 0.95);
        const wid = len * 0.35;
        const tailWag = Math.sin(f.wigglePhase) * (len * 0.32);

        ctx.save();
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

        ctx.restore();
      }
    },

    /**
     * Pass 2.8: 迎光面太阳波光粼粼 (Sun Caustics Glint) 批量入口（保留兼容；
     * ★ v1.50.11 起深度队列按中心线采样点逐段调用 drawGlintAt）
     * 在水面填充之后绘制，联动已有季节光照方位
     */
    drawSunGlint: function (ctx, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
      if (!_initialized || !_centerPoints || !_centerPoints.length) return;
      for (let i = 4; i < _centerPoints.length - 6; i += 7) {
        this.drawGlintAt(ctx, _centerPoints[i], cx, cy, cosZ, sinZ, cosX, sinX, scale);
      }
    },

    /**
     * ★ v1.50.11 单段波光绘制（由统一深度队列调度，cp = centerPoints 采样点）。
     * 含 A2 迎光相位调制与细碎闪烁节奏；不闪烁时静默跳过。
     */
    drawGlintAt: function (ctx, cp, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
      if (!_initialized || !_centerPoints || !_centerPoints.length) return;
      const L = window.SimLighting;
      if (!L || !L.enabled()) return;

      const sunDir = L.sunScreenDir();
      const now = performance.now() * 0.001;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.0, 1.4 * scale);

      // A2 迎光相位调制：河道切线与太阳屏幕方向的夹角决定波光强度，
      // 取 |dot| 让两个走向的碎浪面都参与反光，背光河段自然减弱
      const dot = Math.abs(cp.dirX * sunDir.x + cp.dirY * sunDir.y);
      const sparkle = Math.sin(now * 3.5 + cp.i * 1.7);
      if (sparkle >= 0.25) { // 细碎闪烁节奏
        const facing = Math.max(0.15, Math.min(1, dot));
        ctx.strokeStyle = `rgba(255, 252, 220, ${(0.16 + 0.40 * facing).toFixed(3)})`;
        const waveLen = (8 + Math.sin(cp.i + now) * 4) * scale;
        const offset = Math.sin(now * 2.0 + cp.i) * cp.hw * 0.35;

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
