// === Accent 草丛绘制层（D-B1-6 + TA-11-4，docs/plan/tech/07-terrain-art.md §6.3/§6.6）===
// ★ v1.50.39（TA-04-3 交付随带，§4.6 800 行上限）：GrassTuft 绘制自 render_accents.js
//   原样迁出（ GrassTuft 本期不在动态受光范围——§6.5「保留季相短草线，不新增立体法线」，
//   世界光向受光接入留给后续任务；TA-04-3 的枝干圆柱明暗仍归 render_accents.js）。
//
// 职责：GrassTuft 短草线 / 芦草变体的季相色派生与绘制。依赖全局（经典脚本顶层声明
// 即全局，加载顺序 render_accents.js → 本文件，均在渲染期可用）：
// - render_accents.js：_shadowOffset（贴地阴影零分配包装）/ _sortScratch（稳定性插入排序）/
//   _ptA~_ptD（投影刮擦点）——装饰族共享工具；
// - window.AccentModel（accent-model.js 骨架）/ window.RENDER_CONFIG（config.render.js）/
//   window.SimTreeTint（accent-season.js 季相样本）/ ctx、sim（render_world.js）。

// ★ TA-11-6 渲染热路径零 GC：草叶池（条目 { b, bx, by, tx, ty, h, d }），条目只在容量
// 不足时创建，字段每帧整体覆写；刮擦对象严禁跨绘制调用持有。
var _grassScratchPool = [];
function _grassScratch(i) {
  const p = _grassScratchPool;
  while (p.length <= i) p.push({ b: null, bx: 0, by: 0, tx: 0, ty: 0, h: 0, d: 0 });
  return p[i];
}

// ★ TA-11-4 草丛季相色派生（纯函数，只依赖 SimTreeTint 季节样本输出；07 号 §6.3/§6.6）：
// 春嫩绿萌发（budAmount 向芽色提亮）→ 夏深绿繁茂（叶色直出）→ 秋金黄枯赭（叶色直出 +
// 枯萎混合启动）→ 冬灰枯褐（枯萎深度 = brownness×(1−叶量)，隆冬收敛至 rgb(95,88,70)，
// 草叶不脱落）。芦草穗（plume）量随秋枯升起（brownness 0.35→0.8 渐升，flowerAmount
// 叠加为配置预留通道），秋季淡黄白高光 → 隆冬按 litterAmount 转干灰，残穗挺立不消失。
// 暂停/回溯/读档零抖动：颜色是季节样本的连续函数，无逐帧累积状态。
function grassSeasonColor(season) {
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const lc = season.leafColor;
  // 草色：季相连续叶色向草绿微偏（草比树叶更黄绿），浮点直出不做色档量化
  let r = lc[0] * 0.96 + 10;
  let g = lc[1] * 1.02 + 4;
  let b = lc[2] * 0.88;
  // 春季芽苞（§6.3）：budAmount 向嫩芽绿 (198,216,130) 提亮，隐现不抢眼
  const budK = clamp01(season.budAmount) * 0.35;
  r += (198 - r) * budK;
  g += (216 - g) * budK;
  b += (130 - b) * budK;
  // 秋冬枯萎（§6.6「冬季低矮枯草」）：枯萎深度 = brownness×(1−叶量)×1.35（增益保证
  // 隆冬叶量 ~0.03 时枯萎深度达 1，精确收敛枯褐色 rgb(95,88,70)；秋季仅尾部轻度混入）
  const witherK = clamp01(clamp01(season.brownness) * (1 - clamp01(season.leafDensity)) * 1.35);
  r += (95 - r) * witherK;
  g += (88 - g) * witherK;
  b += (70 - b) * witherK;
  // 芦花穗量：秋枯进程驱动（brownness 0.35 起显 → 0.8 全开），flowerAmount 叠加预留
  const plumeV = Math.max(season.flowerAmount || 0, clamp01((season.brownness - 0.35) / 0.45));
  // 穗色：秋季淡黄白高光 (240,233,200) → 隆冬干灰白 (190,182,158)，litterAmount 渐变
  const litterK = clamp01(season.litterAmount);
  return {
    r: r, g: g, b: b,
    plumeV: clamp01(plumeV),
    plumeR: 240 + (190 - 240) * litterK,
    plumeG: 233 + (182 - 233) * litterK,
    plumeB: 200 + (158 - 200) * litterK,
  };
}

// GrassTuft：3–6 根短草线（D-B1-6，06 号 §5.5）；★ TA-11-4 芦草变体与季相深化。
// 颜色由前端按当前季节派生（同 Tree：SimTreeTint 连续季相，不读存档 tint，14 号 §7.4），
// 季相公式单一来源 = grassSeasonColor（本文件上方，07 号 §6.3/§6.6）；
// 草叶不脱落——冬季以「低矮 + 枯色」表达（hK 隆冬收缩系数，config.render.js TA-11-3），
// 隆冬枯草与芦秆仍在场，严禁整丛消失或纯透明。
// 芦草（模型层 skeleton.isReed）：挺拔株形 + 顶端穗状芦花——穗量/穗色由 grassSeasonColor
// 给出，穗几何沿叶曲线末端方向延伸（屏幕空间，画家排序与所在草叶一致）。
function drawAccentGrassTuft(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX) {
  const sk = model.skeleton;
  const rot = accent.rotation || 0;
  const cR = Math.cos(rot), sR = Math.sin(rot);
  // 隆冬低矮萎缩保底高度系数（config.render.js，TA-11-3）：hK = ratio + (1-ratio)×叶量
  const RC = window.RENDER_CONFIG || {};
  // ★ S7-03 高密草甸 LOD：草叶屏幕长度不足阈值的远景草丛整丛省略——平地草原全图 ~480 丛
  // （通用图 60 丛），全图缩放时逐叶描边成本不可控；屏幕上不足 ~1.4px 的草丛只是一枚色点，
  // 整丛省略不可辨。★ TA-07：判据统一走 AccentLOD 特征尺度口径（株高基准 × accent.scale ×
  // zoom，CSS px），阈值键 accentGrassTuftLODMinPx 归属 accentLOD 键组（数值不变）。
  const AL = window.AccentLOD;
  if (AL && AL.featurePx('GrassTuft', model, scaled) < AL.cfg().grassTuftMin) return;
  const winterK = Number.isFinite(RC.accentGrassTuftWinterHeightRatio)
    ? RC.accentGrassTuftWinterHeightRatio : 0.62;
  const hK = winterK + (1 - winterK) * season.leafDensity;
  // ★ v1.50.84 WebGL 装饰层：GL 模式登记本丛深度，草叶/穗经 sink 分发（与 Canvas 单一同源）
  var sink = (window.WebGLAccentLayer && window.WebGLAccentLayer.sinkOn) ? window.WebGLAccentLayer : null;
  if (sink !== null) sink.beginAccent(accent.x, accent.y, accent.z);

  // 局部三维 → 屏幕（★ TA-11-6 写入复用点对象，零分配）
  function projTo(dx, dy, dz, out) {
    const rx = dx * cosZ - dy * sinZ;
    const ry = dx * sinZ + dy * cosZ;
    out.x = sx + rx * scaled;
    out.y = sy + (ry * cosX - dz * sinX) * scaled;
    out.d = ry * sinX + dz * cosX;
  }

  // 草色 + 芦花穗量/穗色：季相派生单一入口 grassSeasonColor（TA-11-4，见本文件上方）
  const sc = grassSeasonColor(season);
  // ★ TA-07 芦花穗省略阈值（accentLODPlumeMinPx；走 AccentLOD 单一读取入口）
  const plumeMinPx = AL ? AL.cfg().plumeMin : 2;

  // 贴地接触投影（弱于灌木）——★ v1.50.84：GL 模式不再手绘，落底阴影由阴影图承担
  if (sink === null) {
    const so = (typeof _shadowOffset === 'function') ? _shadowOffset(0.8, 1.6, 1.2 * (accent.scale || 1)) : { x: 2, y: 1.5, alphaScale: 1 };
    ctx.fillStyle = 'rgba(20, 15, 10, ' + (0.13 * (so.alphaScale || 1)).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(sx + so.x * 0.45, sy + so.y * 0.35, 3.2 * scaled, 1.4 * scaled, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 草叶收集 + 深度画家排序（叶尖投影深度，远 → 近；★ TA-11-6 草叶池 + 稳定性插入排序，零分配）
  let nItems = 0;
  for (let i = 0; i < sk.blades.length; i++) {
    const b = sk.blades[i];
    const it = _grassScratch(nItems++);
    it.b = b;
    it.bx = b.bx * cR - b.by * sR;
    it.by = b.bx * sR + b.by * cR;
    it.tx = b.tx * cR - b.ty * sR;
    it.ty = b.tx * sR + b.ty * cR;
    it.h = b.h * hK;
    projTo(it.tx, it.ty, it.h, _ptA);
    it.d = _ptA.d;
  }
  _sortScratch(_grassScratchPool, nItems, 'd');

  ctx.lineCap = 'round';
  for (let i = 0; i < nItems; i++) {
    const it = _grassScratchPool[i];
    const p0 = _ptB;
    const p1 = _ptC;
    const c = _ptD;
    projTo(it.bx, it.by, 0, p0);
    projTo(it.tx, it.ty, it.h, p1);
    // 控制点：半高、外倾 25% —— 叶先立后弯不僵硬
    projTo(it.bx + (it.tx - it.bx) * 0.25, it.by + (it.ty - it.by) * 0.25, it.h * 0.5, c);
    const k = 0.86 + 0.28 * it.b.lite; // 个体色差（同 Tree/Bush lite 通道语义）
    const nr = Math.round(Math.max(0, Math.min(255, sc.r * k)));
    const ng = Math.round(Math.max(0, Math.min(255, sc.g * k)));
    const nb = Math.round(Math.max(0, Math.min(255, sc.b * k)));
    // 芦秆略细挺（0.52 vs 0.62），与普通短草区分茎秆质感
    const lwBlade = Math.max(0.5, (it.b.plume > 0 ? 0.52 : 0.62) * scaled);
    if (sink !== null) {
      // 草叶：开折线描边 + 圆头（同 Canvas lineCap='round' 逐叶 stroke 语义）
      // ★ v1.50.89 图元级视深：草叶按近端 3D 视深（叶尖/叶基取大）测试地形，
      //   俯视时外倾叶尖不再被锚点下前方更近地面裁掉（同叶芦花穗复用同一深度）
      sink.setViewDepth(Math.max(p0.d, p1.d));
      const np = _flattenQuad(0, p0.x, p0.y, c.x, c.y, p1.x, p1.y);
      sink.polyStroke(_flatX, _flatY, np, false, lwBlade, nr / 255, ng / 255, nb / 255, 1, true);
    } else {
      ctx.strokeStyle = 'rgb(' + nr + ',' + ng + ',' + nb + ')';
      ctx.lineWidth = lwBlade;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(c.x, c.y, p1.x, p1.y);
      ctx.stroke();
    }
    // ★ TA-11-4 穗状芦花：沿叶曲线末端方向的三笔花序线段（主穗顺叶弯挺出 + 两侧短穗）。
    //   穗量 plumeV 秋枯升起、隆冬存留（干灰色），几何随隆冬 hK 收缩；
    //   远景穗屏长 < 2px 不可辨直接省略；画家排序与所在草叶一致（叶压穗/穗压叶自然）。
    if (it.b.plume > 0 && sc.plumeV > 0.02) {
      const pl = it.b.plume * hK * scaled;
      // ★ TA-07：硬编码 2px 收编为 RENDER_CONFIG.accentLODPlumeMinPx（缺省 2.0，行为不变）
      if (pl >= plumeMinPx) {
        const dx0 = p1.x - c.x, dy0 = p1.y - c.y;
        const dl = Math.hypot(dx0, dy0) || 1;
        const pa = Math.atan2(dy0 / dl, dx0 / dl);
        const pr = Math.round(Math.max(0, Math.min(255, sc.plumeR)));
        const pg = Math.round(Math.max(0, Math.min(255, sc.plumeG)));
        const pb = Math.round(Math.max(0, Math.min(255, sc.plumeB)));
        const plumeA = 0.8 * sc.plumeV;
        const lwPlume = Math.max(0.5, 0.9 * scaled);
        if (sink !== null) {
          // 三笔穗线（主穗顺叶弯挺出 + 两侧短穗）：Canvas 单 path 三段，段间互不重叠，
          // GL 逐段发开折线（圆头、同一半透明色）与 Canvas compositing 一致
          _flatX[0] = p1.x; _flatY[0] = p1.y;
          _flatX[1] = p1.x + Math.cos(pa) * pl; _flatY[1] = p1.y + Math.sin(pa) * pl;
          sink.polyStroke(_flatX, _flatY, 2, false, lwPlume, pr / 255, pg / 255, pb / 255, plumeA, true);
          _flatX[1] = p1.x + Math.cos(pa + 0.45) * pl * 0.6; _flatY[1] = p1.y + Math.sin(pa + 0.45) * pl * 0.6;
          sink.polyStroke(_flatX, _flatY, 2, false, lwPlume, pr / 255, pg / 255, pb / 255, plumeA, true);
          _flatX[1] = p1.x + Math.cos(pa - 0.5) * pl * 0.5; _flatY[1] = p1.y + Math.sin(pa - 0.5) * pl * 0.5;
          sink.polyStroke(_flatX, _flatY, 2, false, lwPlume, pr / 255, pg / 255, pb / 255, plumeA, true);
        } else {
          ctx.strokeStyle = 'rgba(' + pr + ',' + pg + ',' + pb + ',' + plumeA.toFixed(3) + ')';
          ctx.lineWidth = lwPlume;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p1.x + Math.cos(pa) * pl, p1.y + Math.sin(pa) * pl);
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p1.x + Math.cos(pa + 0.45) * pl * 0.6, p1.y + Math.sin(pa + 0.45) * pl * 0.6);
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p1.x + Math.cos(pa - 0.5) * pl * 0.5, p1.y + Math.sin(pa - 0.5) * pl * 0.5);
          ctx.stroke();
        }
      }
    }
  }
  ctx.lineCap = 'butt';
}
