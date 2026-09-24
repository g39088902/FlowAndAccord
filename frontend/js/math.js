// === 基础 3D 数学工具类 ===
    class Vec3 {
      constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
      distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
      static lerp(a, b, t) {
        return new Vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      }
    }

    class Curve3D {
      constructor(p0, p1, p2, p3) {
        this.p0 = p0; this.p1 = p1; this.p2 = p2; this.p3 = p3;
        this.length = this.calculateLength(16);
      }
      static straight(p0, p3) {
        return new Curve3D(p0, Vec3.lerp(p0, p3, 0.333), Vec3.lerp(p0, p3, 0.666), p3);
      }
      calculateLength(segs) {
        let len = 0, prev = this.evalPos(0);
        for (let i = 1; i <= segs; i++) {
          const curr = this.evalPos(i / segs);
          len += prev.distanceTo(curr);
          prev = curr;
        }
        return Math.max(len, 0.1);
      }
      evalPos(t) {
        t = Math.max(0, Math.min(1, t));
        const u = 1 - t, tt = t * t, uu = u * u;
        const uuu = uu * u, ttt = tt * t;
        return new Vec3(
          uuu * this.p0.x + 3 * uu * t * this.p1.x + 3 * u * tt * this.p2.x + ttt * this.p3.x,
          uuu * this.p0.y + 3 * uu * t * this.p1.y + 3 * u * tt * this.p2.y + ttt * this.p3.y,
          uuu * this.p0.z + 3 * uu * t * this.p1.z + 3 * u * tt * this.p2.z + ttt * this.p3.z
        );
      }
      evalTangent(t) {
        t = Math.max(0, Math.min(1, t));
        const u = 1 - t;
        const dx = 3 * u * u * (this.p1.x - this.p0.x) + 6 * u * t * (this.p2.x - this.p1.x) + 3 * t * t * (this.p3.x - this.p2.x);
        const dy = 3 * u * u * (this.p1.y - this.p0.y) + 6 * u * t * (this.p2.y - this.p1.y) + 3 * t * t * (this.p3.y - this.p2.y);
        const dz = 3 * u * u * (this.p1.z - this.p0.z) + 6 * u * t * (this.p2.z - this.p1.z) + 3 * t * t * (this.p3.z - this.p2.z);
        const mag = Math.hypot(dx, dy, dz) || 1e-6;
        return new Vec3(dx / mag, dy / mag, dz / mag);
      }
    }

    // 地形反照率（不含光）：水体色 / 高程插值 / 坡度平滑过渡。
    // ★ 动态季节光照（docs/current/tech/17-seasonal-lighting.md）把它与光照拆开：
    //   反照率只算一次并预存，光向变化时只重算光因子，避免每次整片重建颜色。
    function computeTerrainAlbedo(cell, minZ, maxZ) {
      const { elev, dzdx = 0, dzdy = 0, surfaceKind, naturalFertility = 1.0 } = cell;
      const range = Math.max(1, maxZ - minZ);
      const normZ = Math.max(0, Math.min(1, (elev - minZ) / range));

      // 连续坡度计算 (度数)
      const gradMag = Math.hypot(dzdx, dzdy);
      const slopeDeg = Math.atan(gradMag) * (180 / Math.PI);

      let r, g, b;

      // 水体与河岸底模处理（★ v1.50.7：水下格改用深褐色河床土色，告别深蓝——
      // 透过半透明水面呈现的是湿润泥土与卵石河床的暖棕基调，避免与水面碧蓝混成一片蓝黑）
      // （★ v1.50.8：整体调浅两档贴近岸边湿砂色——降低水格与相邻陆格的色阶反差，
      //   13m 网格锯齿在半透明水面下不再显形）
      if (surfaceKind === 'ShallowWater') {
        r = 142; g = 122; b = 96;
      } else if (surfaceKind === 'DeepWater') {
        r = 120; g = 100; b = 76;
      } else if (surfaceKind === 'RiverBank') {
        r = 148; g = 138; b = 114;
      } else {
        // 核心大地色系：连续平滑过渡，彻底消除因离散枚举阈值导致的生硬锯齿台阶
        const fert = Math.max(0, Math.min(1, naturalFertility));

        // 1. 基底草甸色 (随海拔在温润苔绿 -> 阳光灰绿 -> 高山暖草黄之间自然呼吸)
        let baseR, baseG, baseB;
        if (normZ < 0.50) {
          const t = normZ / 0.50;
          baseR = 108 + t * 24 - fert * 10;
          baseG = 138 + t * 18 + fert * 14;
          baseB = 88 + t * 14 - fert * 12;
        } else {
          const t = (normZ - 0.50) / 0.50;
          baseR = 132 + t * 24 - fert * 6;
          baseG = 156 - t * 8 + fert * 10;
          baseB = 102 + t * 12 - fert * 8;
        }

        // 2. 坡度风化与泥石过渡 (Smoothstep 消除生硬断崖)
        // 12° 以下为平坦草地，12°~28° 逐渐露出温暖土层，28°~45° 逐渐过渡为冷暖岩石
        if (slopeDeg < 12.0) {
          r = baseR; g = baseG; b = baseB;
        } else if (slopeDeg < 28.0) {
          const t = (slopeDeg - 12.0) / 16.0;
          const s = t * t * (3.0 - 2.0 * t); // smoothstep
          const soilR = 152 - fert * 8;
          const soilG = 138 - fert * 4;
          const soilB = 114 - fert * 6;
          r = baseR * (1 - s) + soilR * s;
          g = baseG * (1 - s) + soilG * s;
          b = baseB * (1 - s) + soilB * s;
        } else {
          const t = Math.min(1.0, (slopeDeg - 28.0) / 18.0);
          const s = t * t * (3.0 - 2.0 * t);
          const soilR = 152; const soilG = 138; const soilB = 114;
          const rockR = 130 + normZ * 15;
          const rockG = 126 + normZ * 14;
          const rockB = 118 + normZ * 16;
          r = soilR * (1 - s) + rockR * s;
          g = soilG * (1 - s) + rockG * s;
          b = soilB * (1 - s) + rockB * s;
        }
      }

      // ★ TB-03-11 景观风格乘色（纯表现层；未激活/旧模板/未列地类 = 不改）。
      //   只改颜色观感，不触及任何模拟状态；世界切换经 SimLighting.markDirty 重建反照率。
      const tint = window.TerrainStyle ? window.TerrainStyle.tintFor(surfaceKind) : null;
      if (tint) {
        r = Math.min(255, r * tint[0]);
        g = Math.min(255, g * tint[1]);
        b = Math.min(255, b * tint[2]);
      }

      return { r, g, b };
    }

    // 地形坡度环境光遮蔽 (AO)：陡峭山谷/深沟采光受限，平原开阔通透
    function terrainAmbientOcclusion(dzdx, dzdy) {
      const slopeDeg = Math.atan(Math.hypot(dzdx || 0, dzdy || 0)) * (180 / Math.PI);
      return Math.max(0.70, 1.0 - (slopeDeg / 65.0) * 0.30);
    }

    // ★ v1.50.74 数据层反照率平滑（地表贴图插值；与 computeTerrainAlbedo 同居基座层）：
    //   对反照率场做水平→垂直两趟半径 r 均值（盒式近似高斯），陆地格间硬边界变连续
    //   渐变；waterMask 非 0 的水格视为屏障——水格输出保持原值、陆格只平均陆格邻居，
    //   水陆边界不产生混色晕圈（RiverBank 算陆格，允许与干地互混柔化岸线）。
    //   就地写回传入数组（调用方在世界建缓存时一次性消费，平滑后场由 GL 地形渲染器消费）。
    //   复杂度 O(N·(2r+1))·2 趟 · 3 通道：N=65,536、r=2 时约 400 万次加法，~几 ms。
    function smoothAlbedoField(albR, albG, albB, w, h, waterMask, radius) {
      const n = w * h;
      const tmpR = new Float32Array(n), tmpG = new Float32Array(n), tmpB = new Float32Array(n);
      for (let pass = 0; pass < 2; pass++) {
        const horizontal = pass === 0;
        const srcR = horizontal ? albR : tmpR, srcG = horizontal ? albG : tmpG, srcB = horizontal ? albB : tmpB;
        const dstR = horizontal ? tmpR : albR, dstG = horizontal ? tmpG : albG, dstB = horizontal ? tmpB : albB;
        for (let y = 0; y < h; y++) {
          const rowBase = y * w;
          for (let x = 0; x < w; x++) {
            const idx = rowBase + x;
            if (waterMask[idx]) {
              dstR[idx] = srcR[idx]; dstG[idx] = srcG[idx]; dstB[idx] = srcB[idx];
              continue;
            }
            let sr = 0, sg = 0, sb = 0, cnt = 0;
            for (let d = -radius; d <= radius; d++) {
              let j;
              if (horizontal) {
                const nx = x + d;
                if (nx < 0 || nx >= w) continue;
                j = rowBase + nx;
              } else {
                const ny = y + d;
                if (ny < 0 || ny >= h) continue;
                j = ny * w + x;
              }
              if (waterMask[j]) continue; // 屏障：不计水格
              sr += srcR[j]; sg += srcG[j]; sb += srcB[j]; cnt++;
            }
            if (cnt === 0) {
              dstR[idx] = srcR[idx]; dstG[idx] = srcG[idx]; dstB[idx] = srcB[idx];
            } else {
              const inv = 1 / cnt;
              dstR[idx] = sr * inv; dstG[idx] = sg * inv; dstB[idx] = sb * inv;
            }
          }
        }
      }
    }

    // ★ 全量 WebGL：computeElevationColor（Canvas 地形格固定光兜底色）已随 Canvas 备用
    //   通道删除——地形受光由 webgl/layers/terrain/terrain-renderer.js 顶点 shader 直译。
    // 静态反照率与 AO 基座仍由 computeTerrainAlbedo / terrainAmbientOcclusion 提供。
