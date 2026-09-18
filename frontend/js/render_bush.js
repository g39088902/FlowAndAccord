// === 灌木绘制层（★ TA-06-5 自 render_accents.js 原位迁出；★ TA-06-7 变体与花朵图元）===
// 先拆后加（render_grass.js v1.50.39 先例）：render_accents.js 接入三乔木轮廓与锥形常绿后
// 逼近 800 行红线，drawAccentBush 连同花朵图元迁出本文件。加载顺序（index.html 已注册）：
//   accent-model.js → render_accents.js → 【本文件】 → render_grass.js → render_shadows.js
//   → render_landscapes.js
// 约束：本文件复用 render_accents.js 的模块级共享刮擦与受光/明暗工具（经典脚本全局作用域，
// **必须晚于**它加载）；render_landscapes.js 分派 drawAccentBush，**必须晚于**本文件加载。
//
// ★ TA-06 三灌木变体（07 号 §6.3）：multiStem 落叶多茎 / flowering 花灌木 / lowEvergreen
//   低矮常绿——骨架参数（stemMin/Max、heightBase/Var、outKMin/Max、簇参数、扁压 squash）
//   全部由 accent-model.js::bushSkeleton 按 config.render.js::accentBushVariants 派生。
//   绘制层只按骨架落笔：茎序与簇丛画序**对所有变体一致**（两遍式树冠），变体差异全部来自
//   模型几何（lowEvergreen 矮而扁压铺展、flowering 略收外倾），绘制层不按变体改画法。
//
// ★ TA-06-7 花朵图元（§3.4；flowerAmount 首次真实消费）：花位与花色在**模型构建期**由
//   _accentHash(id, 810+i×3…) 固定生成（skeleton.flowers[]），花量只决定可见点数
//   round(K×flowerAmount) 与 alpha，**绝不参与位置重抽**（对齐 S4-04「库存不参与几何」纪律）。
//   低饱和三色板（config.render.js::accentFlowerPalette）、**禁发光 / 禁径向渐变光晕 / 禁高饱和**
//   （07 号 §4.1：明亮颜色留给选中对象与紧急事件）；受光直接以宿主簇法线走 accentLitFill
//   单一入口（不复制光照公式、不新增固定屏幕亮斑）；细节分级 = **中景及以上**（detailMid 门槛）
//   且花点屏幕半径 ≥ accentFlowerMinPx，远景整组省略。零 GC：花点投影复用 _ptD、逐点即画即弃
//   （无收集/排序，故无需专用池）；花量与季相同源（accentFlowerCycle），冬夏自然归零。
//
// 依赖全局: ctx, camera, w, h（render_world.js/main.js）、accentLitFill / cylinderShade /
//   accentClusterVisibility / barkBandCfg / crownLitCfg / window.AccentLOD（★ TA-07 判档入口）/
//   _ptA~_ptD / _crownScratch / _crownScratchPool / _sortScratch / _ld / _sunScr
//   （render_accents.js 共享，禁在本文件复制）、window.AccentModel、window.SimTreeTint、window.RENDER_CONFIG。

// Bush：基生多茎灌木（§6.4：不缩小乔木冒充灌木）——三变体共用画序，形态差异全在骨架。
// ★ TA-11-6 零 GC：投影走 projTo 复用点（茎 a=_ptB / b=_ptC / 控制点=_ptD / 簇=_ptA），
// 叶簇收集走 _crownScratchPool 冠簇池 + 稳定性插入排序。
function drawAccentBush(accent, sx, sy, scaled, season, model, cosZ, sinZ, cosX, sinX) {
  const sk = model.skeleton;
  const r = (sk.crownR || 6.5) * scaled;   // ★ TA-06-8：冠幅读模型（单一几何真相源，修正历史漂移）
  const squash = sk.crownSquash || 0.72;   // ★ TA-06：簇扁压系数（lowEvergreen 更扁、贴地铺展）
  const leaf = season.leafDensity;
  const brown = season.brownness;
  // ★ TA-07 三档判档（AccentLOD 唯一入口；featurePx = 模型冠幅 × accent.scale × zoom，
  //   阈值 7/15 带滞回）。灌木细茎 segTier 恒 0 ⇒ 中景与近景枝量一致，只有簇子集与亮部分档。
  const AL = window.AccentLOD;
  const tier = AL.tierFor(accent, 'Bush', model, scaled);
  const detailMid = tier >= AL.MID;   // 中景：茎 + 叶簇（★ TA-06-7 花朵图元的细节门槛）
  const detailNear = tier >= AL.NEAR;
  // ★ v1.50.84 WebGL 装饰层：GL 模式登记本丛深度，图元经 sink 分发（与 Canvas 单一同源）
  var sink = (window.WebGLAccentLayer && window.WebGLAccentLayer.sinkOn) ? window.WebGLAccentLayer : null;
  if (sink !== null) sink.beginAccent(accent.x, accent.y, accent.z);

  // 贴地微投影已随 TA-04-6 迁往 render_shadows.js::drawAccentShadowGround（同 Tree）

  // 局部三维 → 屏幕（灌木无倾干；★ TA-11-6 写入复用点，零分配）
  function projTo(dx, dy, dz, out) {
    const rx = dx * cosZ - dy * sinZ;
    const ry = dx * sinZ + dy * cosZ;
    out.x = sx + rx * scaled;
    out.y = sy + (ry * cosX - dz * sinX) * scaled;
    out.d = ry * sinX + dz * cosX;
  }

  // 细茎（全年保留；冬季枯枝为主）
  // ★ TA-04-3：茎走与 Tree 枝条同一受光管线（灌木无倾干，剪切 = 0）——基色按「朝屏法线」
  //   受光，茎宽可辨时沿迎光侧补细高光；转相机/光向明暗随动。
  if (detailMid) {
    const bb = barkBandCfg();
    const wvx = sinZ * sinX, wvy = cosZ * sinX, wvz = cosX; // 世界视向（灌木无剪切，模型=世界）
    ctx.lineCap = 'round';
    for (let i = 0; i < sk.segments.length; i++) {
      const seg = sk.segments[i];
      const a = _ptB, b = _ptC, c = _ptD;
      projTo(seg.x1, seg.y1, seg.z1, a);
      projTo(seg.x2, seg.y2, seg.z2, b);
      // 控制点取 40% 高度处、水平位置取 55% 外倾 —— 茎先直立后外弯
      projTo(seg.x2 * 0.55, seg.y2 * 0.55, seg.z2 * 0.40, c);
      const lwSeg = Math.max(0.5, 0.9 * scaled);
      const segLen = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1, seg.z2 - seg.z1) || 1;
      cylinderShade((seg.x2 - seg.x1) / segLen, (seg.y2 - seg.y1) / segLen, (seg.z2 - seg.z1) / segLen, 0,
        _ld.x, _ld.y, _ld.z, wvx, wvy, wvz, cosZ, sinZ, cosX, sinX);
      const stemFill = accentLitFill(104, 78, 54, _cylFront.x, _cylFront.y, _cylFront.z, 1);
      if (sink !== null) {
        // 茎：开折线描边 + 圆头（同 Canvas lineCap='round' 逐茎 stroke 语义）
        const np = _flattenQuad(0, a.x, a.y, c.x, c.y, b.x, b.y);
        sink.polyStroke(_flatX, _flatY, np, false, lwSeg, _litFinal[0], _litFinal[1], _litFinal[2], 1, true);
      } else {
        ctx.strokeStyle = stemFill;
        ctx.lineWidth = lwSeg;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
        ctx.stroke();
      }
      // 迎光侧细高光（茎宽可辨且屏幕迎光方向非退化才画）
      if (lwSeg >= bb.minPx && _cylScr.ok) {
        const o = lwSeg * bb.offK;
        const hiFill = accentLitFill(104, 78, 54, _cylLit.x, _cylLit.y, _cylLit.z, 1, bb.litA);
        if (sink !== null) {
          const np = _flattenQuad(0,
            a.x + _cylScr.x * o, a.y + _cylScr.y * o,
            c.x + _cylScr.x * o, c.y + _cylScr.y * o,
            b.x + _cylScr.x * o, b.y + _cylScr.y * o);
          sink.polyStroke(_flatX, _flatY, np, false, lwSeg * bb.wK, _litFinal[0], _litFinal[1], _litFinal[2], bb.litA, true);
        } else {
          ctx.strokeStyle = hiFill;
          ctx.lineWidth = lwSeg * bb.wK;
          ctx.beginPath();
          ctx.moveTo(a.x + _cylScr.x * o, a.y + _cylScr.y * o);
          ctx.quadraticCurveTo(c.x + _cylScr.x * o, c.y + _cylScr.y * o,
            b.x + _cylScr.x * o, b.y + _cylScr.y * o);
          ctx.stroke();
        }
      }
    }
    ctx.lineCap = 'butt';
  }

  // 叶簇：同 Tree 的脱落/色差/排序规则；扁压 squash 由变体决定（lowEvergreen 铺展贴地）
  // ★ v1.50.27 与 Tree 同步改两遍式剪影 + 体积明暗；★ TA-11-6 零 GC 冠簇池收集。
  const lw = Math.max(0.4, 0.45 * scaled);
  const fade = 0.09;
  const jitterAmp = 6 + 26 * brown;
  // ★ TA-07 远景档取模型预生成的簇子集（同 Tree 口径；Bush 簇数 8~9，子集通常即全簇）
  const farIdx = (tier === AL.FAR) ? model.farClusters : null;
  const clN = farIdx ? farIdx.length : sk.clusters.length;
  let nItems = 0;
  for (let k = 0; k < clN; k++) {
    const c = farIdx ? sk.clusters[farIdx[k]] : sk.clusters[k];
    const v = accentClusterVisibility(leaf, c.shed, fade);
    if (v < 0.06) continue;
    const p = _ptA;
    projTo(c.x, c.y, c.z, p);
    // ★ TA-07 补簇级视口剔除（旧实现灌木侧无剔除；x/y 双向判据与 Tree 同口径）
    if (p.y < -40 || p.y > h + 40 || p.x < -40 || p.x > w + 40) continue;
    const rr = c.r * scaled * v;
    if (rr < 0.5) continue;
    const it = _crownScratch(nItems++);
    it.c = c; it.px = p.x; it.py = p.y; it.pd = p.d; it.rr = rr; it.v = v;
  }
  _sortScratch(_crownScratchPool, nItems, 'pd');

  // 冠内体积/AO 分档基准（同 Tree：整副骨架求范围，秋季幸存簇明暗不随可见集跳变；
  // ★ TA-04-2 起投影深度 tD 不参与明暗，只留与视角无关的 tZ 档）
  let zLo = Infinity, zHi = -Infinity;
  for (let i = 0; i < sk.clusters.length; i++) {
    const c = sk.clusters[i];
    if (c.z < zLo) zLo = c.z;
    if (c.z > zHi) zHi = c.z;
  }
  const zSpan = Math.max(0.001, zHi - zLo);

  // Pass A：统一冠影色剪影（重叠即并集）
  // ★ GL 路径：逐簇发不透明椭圆——并集观感与单 path 填充一致（不透明叠涂无接缝）
  const paR = Math.min(255, Math.round(season.leafColor[0] * 0.50 + 4));
  const paG = Math.min(255, Math.round(season.leafColor[1] * 0.58 + 8));
  const paB = Math.min(255, Math.round(season.leafColor[2] * 0.62 + 14));
  if (sink !== null) {
    const ar = paR / 255, ag = paG / 255, ab = paB / 255;
    for (let i = 0; i < nItems; i++) {
      const it = _crownScratchPool[i];
      const sw = lw + it.rr * 0.16;
      sink.ellipseRGBA(it.px, it.py, it.rr + sw, it.rr * squash + sw, ar, ag, ab, 1);
    }
  } else {
    ctx.fillStyle = 'rgb(' + paR + ',' + paG + ',' + paB + ')';
    ctx.beginPath();
    for (let i = 0; i < nItems; i++) {
      const it = _crownScratchPool[i];
      const sw = lw + it.rr * 0.16;
      ctx.moveTo(it.px + it.rr + sw, it.py);
      ctx.ellipse(it.px, it.py, it.rr + sw, it.rr * squash + sw, 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // Pass B：簇本体 + 冠内体积/AO 分档 × 世界光向受光（★ TA-04-2，同 Tree 管线；灌木无倾干）
  const cc = crownLitCfg();
  for (let i = 0; i < nItems; i++) {
    const it = _crownScratchPool[i];
    const c = it.c;
    const j = (c.lite - 0.5) * 2 * jitterAmp;
    const tZ = (c.z - zLo) / zSpan;
    const kZ = 0.80 + 0.20 * tZ;
    const clusterFill = accentLitFill(season.leafColor[0] + j, season.leafColor[1] + j, season.leafColor[2] + j, c.nx, c.ny, c.nz, kZ);
    if (sink !== null) {
      sink.ellipseRGBA(it.px, it.py, it.rr, it.rr * squash, _litFinal[0], _litFinal[1], _litFinal[2], 1);
    } else {
      ctx.fillStyle = clusterFill;
      ctx.beginPath();
      ctx.ellipse(it.px, it.py, it.rr, it.rr * squash, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 近景簇亮部：★ TA-04-4 世界光向投影驱动（同 Tree；灌木无倾干，簇法线即世界法线）
    if (detailNear && it.rr > cc.minPx) {
      const hiCol = accentLitFill(255, 252, 218, c.nx, c.ny, c.nz, 1, cc.alpha * it.v);
      if (sink !== null) {
        sink.ellipseRGBA(it.px + _sunScr.x * it.rr * cc.offK, it.py + _sunScr.y * it.rr * cc.offK,
          it.rr * cc.rxK, it.rr * cc.ryK, _litFinal[0], _litFinal[1], _litFinal[2], cc.alpha * it.v);
      } else {
        ctx.fillStyle = hiCol;
        ctx.beginPath();
        ctx.ellipse(it.px + _sunScr.x * it.rr * cc.offK, it.py + _sunScr.y * it.rr * cc.offK,
          it.rr * cc.rxK, it.rr * cc.ryK, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ★ TA-06-7 花朵图元（花灌木专属）：花位/花色来自模型（构建期固定），此处只做投影与落笔。
  if (sk.flowers) drawBushFlowers(scaled, season, model, detailMid, projTo);
}

// 花灌木花朵点簇（§3.4）：细节分级 = **中景及以上**（detailMid，远景整组省略）；可见点数 =
// round(K × flowerAmount)（K = 模型花位数，≤ accentFlowerDotsMax）；花色低饱和三色板逐点稳定选定；
// 颜色走宿主簇法线 accentLitFill 单一入口（低饱和、不发光）；与宿主簇同步显隐（宿主簇冬季脱落时
// 花点亦不残留，冬夏 flowerAmount 归零 → 零花点）。
function drawBushFlowers(scaled, season, model, detailMid, projTo) {
  if (!detailMid) return; // 远景整组省略（§3.4 细节分级：仅中景及以上落笔）
  var sink = (window.WebGLAccentLayer && window.WebGLAccentLayer.sinkOn) ? window.WebGLAccentLayer : null;
  const RC = window.RENDER_CONFIG || {};
  const rK = Number.isFinite(RC.accentFlowerDotRadiusK) ? RC.accentFlowerDotRadiusK : 0.30;
  const minPx = Number.isFinite(RC.accentFlowerMinPx) ? RC.accentFlowerMinPx : 1.2;
  const pal = RC.accentFlowerPalette;
  const fl = model.skeleton.flowers;
  const amount = season.flowerAmount;
  if (!(amount > 0.02)) return; // 冬夏无花（花历归零即零花点，无残留）
  const sk = model.skeleton;
  const nVis = Math.min(fl.length, Math.round(fl.length * amount));
  const alpha = 0.55 + 0.40 * amount;
  for (let i = 0; i < nVis; i++) {
    const f = fl[i];
    const c = sk.clusters[f.ci];
    if (!c) continue;
    const v = accentClusterVisibility(season.leafDensity, c.shed, 0.09); // 花随宿主簇显隐
    const dr = c.r * scaled * v * rK;   // 花点半径 = 宿主簇屏幕半径 × K
    if (dr < minPx) continue;           // 远景亚像素：该点省略（远景观感只留簇丛）
    const p = _ptD;
    projTo(f.x, f.y, f.z, p);
    const col = (pal && pal[f.hue]) || _flowerPaletteFallback[f.hue] || _flowerPaletteFallback[0];
    const flCol = accentLitFill(col[0], col[1], col[2], c.nx, c.ny, c.nz, 1, alpha * v);
    if (sink !== null) {
      sink.ellipseRGBA(p.x, p.y, dr, dr * 0.92, _litFinal[0], _litFinal[1], _litFinal[2], alpha * v);
    } else {
      ctx.fillStyle = flCol;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, dr, dr * 0.92, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
// 缺省花板回退（config.render.js::accentFlowerPalette 缺席时；白 / 淡粉 / 淡黄）
var _flowerPaletteFallback = [[246, 242, 232], [226, 190, 186], [238, 224, 168]];
