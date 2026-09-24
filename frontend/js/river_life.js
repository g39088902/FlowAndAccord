// === 水系微观生态纯表现层 (RiverLife) ===
// 提供成群游鱼（★ 全量 WebGL：图元经 sink 分发进 WebGLAccentLayer；GL 未就绪帧跳过绘制，
// 无 Canvas 兜底）
// （★ v1.50.4 移除水底卵石层：深色扁圆石透水面观感呈"一堆深蓝色圆圈"，见 01-changelog.md；
//   ★ v1.50.86 移除迎光面太阳波光：用户决策删除水面闪光特效）
// 依赖全局: window.SimLighting (可选)、camera、w/h（视口剔除，render_canvas 共享）

(function (window) {
  'use strict';

  // 预分配静态对象与缓冲区 (零每帧 GC)
  const MAX_FISH = 24;

  // 游鱼数据
  const _fishList = [];
  // ★ 鱼群配色单一数值源：GL sink 数值通道从这里派生（rgba 串出口仅供调试）
  // （四群：锦鲤赤金 / 金鲤明黄 / 青黑溪斑 / 白练银鱼；[体R,G,B,A, 鳍R,G,B,A]）
  const FISH_PALETTES = [
    { bodyN: [235, 115, 55, 0.88], finN: [255, 165, 105, 0.75] },   // 锦鲤赤金
    { bodyN: [220, 180, 50, 0.88], finN: [255, 215, 110, 0.75] },   // 金鲤明黄
    { bodyN: [45, 65, 78, 0.88],   finN: [95, 125, 145, 0.75] },    // 青黑溪斑
    { bodyN: [238, 245, 250, 0.92], finN: [210, 230, 245, 0.75] },  // 白练银鱼
  ].map(function (p) {
    return {
      body: 'rgba(' + p.bodyN[0] + ', ' + p.bodyN[1] + ', ' + p.bodyN[2] + ', ' + p.bodyN[3] + ')',
      fin: 'rgba(' + p.finN[0] + ', ' + p.finN[1] + ', ' + p.finN[2] + ', ' + p.finN[3] + ')',
      bodyN: [p.bodyN[0] / 255, p.bodyN[1] / 255, p.bodyN[2] / 255, p.bodyN[3]],
      finN: [p.finN[0] / 255, p.finN[1] / 255, p.finN[2] / 255, p.finN[3]],
    };
  });

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
     * 注：走墙钟而非仿真时钟——模拟暂停时鱼群继续流动，
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
     * ★ v1.50.11 单条游鱼绘制（由统一深度队列调度）。
     * ★ 全量 WebGL：四笔图元（水底影子 / 鱼身 / 背光高线 / 尾鳍）按同一画序同配色
     *   经 sink 分发给 WebGLAccentLayer（鱼身在底层 GL 画布，2D 半透明水面随后盖绘
     *   ⇒ 透水观感不变）；GL 未就绪帧整条跳过，无 Canvas 兜底。
     */
    drawFishSingle: function (ctx, f, cx, cy, cosZ, sinZ, cosX, sinX, scale) {
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

      // ★ 全量 WebGL：GL 未就绪帧整条跳过（硬门槛架构下无 Canvas 兜底）；四笔图元按
      //   同一画序同配色分发给 WebGLAccentLayer（几何/配色单一同源，GL 侧零重复公式）。
      const sink = (window.WebGLAccentLayer && window.WebGLAccentLayer.sinkOn) ? window.WebGLAccentLayer : null;
      if (sink === null) return;
      sink.beginAccent(f.x, f.y, f.z);
      this._dispatchFishSingle(sink, px, py, screenRot, len, wid, tailWag, f, scale);
      return;
    },

    // ★ v1.50.86 sink 分发（drawFishSingle 消费）：把 Canvas translate(px,py)+rotate(screenRot)
    //   局部系的四笔笔迹变换到屏幕坐标后，按同一画序送 GL。局部→屏幕 = 平移 + 旋转
    //   （Canvas 无缩放变换，线宽直接用屏幕像素值）。
    //   鱼身 = ribbonQuad：腹线（鱼头→尾基 A）为左曲线、背线反向参数化（鱼头→尾基 B）
    //   为右曲线——两端点鱼头重合（横截面退化为点，与 Canvas closePath 语义一致）、
    //   尾基横截面 A→B 恰为 Canvas 的 lineTo 直边（ribbonQuad 末段轮廓旗标覆盖）。
    //   尾鳍 = 四边形 dart（凹箭头形），quad 的 p0→p2 对角线恰在填充域内（对角剖分精确）。
    _dispatchFishSingle: function (sink, px, py, screenRot, len, wid, tailWag, f, scale) {
      const c = Math.cos(screenRot), s = Math.sin(screenRot);
      // 局部→屏幕变换（模块级刮擦函数，见文件尾）
      const T = _fishT;
      T.set(px, py, c, s);
      const bn = f.palette.bodyN, fnN = f.palette.finN;

      // 1. 鱼身影子 (水底微弱投影)：局部中心 (-0.1L, 0.4W)，半径 (0.45L, 0.3W)
      const sc = T.x(-len * 0.1, wid * 0.4), si = T.y(-len * 0.1, wid * 0.4);
      sink.ellipseRotRGBA(sc, si, len * 0.45, wid * 0.3, screenRot,
        15 / 255, 30 / 255, 42 / 255, 0.28);

      // 2. 鱼身主体 (流线型梭形)：ribbonQuad(腹线 H→A, 背线反向 H→B)
      sink.ribbonQuad(
        T.x(len * 0.55, 0), T.y(len * 0.55, 0),
        T.x(len * 0.1, wid * 0.55), T.y(len * 0.1, wid * 0.55),
        T.x(-len * 0.45, tailWag * 0.4), T.y(-len * 0.45, tailWag * 0.4),
        T.x(len * 0.55, 0), T.y(len * 0.55, 0),
        T.x(len * 0.1, -wid * 0.55), T.y(len * 0.1, -wid * 0.55),
        T.x(-len * 0.55, tailWag), T.y(-len * 0.55, tailWag),
        bn[0], bn[1], bn[2], bn[3]);

      // 3. 鱼背部高光线：二次曲线展平 8 段 + 平头描边（Canvas 默认 lineCap='butt'）
      const hlX = _fishHLx, hlY = _fishHLy;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, mt = 1 - t;
        const lx = mt * mt * (len * 0.35) + 2 * mt * t * 0 + t * t * (-len * 0.30);
        const ly = mt * mt * 0 + 2 * mt * t * (-wid * 0.18) + t * t * (tailWag * 0.3);
        hlX[i] = T.x(lx, ly); hlY[i] = T.y(lx, ly);
      }
      sink.polyStroke(hlX, hlY, 9, false, Math.max(0.6, 0.8 * scale),
        1, 1, 1, 0.55, false);

      // 4. 灵动半透明摆尾 (两瓣尾鳍，凹箭头形)：A → P2 → P3(凹谷) → P4
      sink.quad(
        T.x(-len * 0.45, tailWag * 0.4), T.y(-len * 0.45, tailWag * 0.4),
        T.x(-len * 0.90, tailWag - wid * 0.45), T.y(-len * 0.90, tailWag - wid * 0.45),
        T.x(-len * 0.72, tailWag), T.y(-len * 0.72, tailWag),
        T.x(-len * 0.90, tailWag + wid * 0.45), T.y(-len * 0.90, tailWag + wid * 0.45),
        fnN[0], fnN[1], fnN[2], fnN[3]);
    }
  };

  // 鱼绘制局部→屏幕变换刮擦（零每帧分配）与背光高线点列刮擦
  const _fishHLx = new Float64Array(9), _fishHLy = new Float64Array(9);
  const _fishT = {
    px: 0, py: 0, c: 1, s: 0,
    set: function (px, py, c, s) { this.px = px; this.py = py; this.c = c; this.s = s; },
    x: function (lx, ly) { return this.px + lx * this.c - ly * this.s; },
    y: function (lx, ly) { return this.py + lx * this.s + ly * this.c; },
  };

  window.RiverLife = RiverLife;
})(window);
