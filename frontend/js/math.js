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
    // ★ 动态季节光照（docs/27-plan-seasonal-lighting.md）把它与光照拆开：
    //   反照率只算一次并预存，光向变化时只重算光因子，避免每次整片重建颜色。
    function computeTerrainAlbedo(cell, minZ, maxZ) {
      const { elev, dzdx = 0, dzdy = 0, surfaceKind, naturalFertility = 1.0 } = cell;
      const range = Math.max(1, maxZ - minZ);
      const normZ = Math.max(0, Math.min(1, (elev - minZ) / range));

      // 连续坡度计算 (度数)
      const gradMag = Math.hypot(dzdx, dzdy);
      const slopeDeg = Math.atan(gradMag) * (180 / Math.PI);

      let r, g, b;

      // 特殊水体与河岸处理 (P1: 清澈碧蓝山泉与湿润细金沙滩，告别发黑枯水感)
      if (surfaceKind === 'ShallowWater') {
        r = 62; g = 152; b = 176;
      } else if (surfaceKind === 'DeepWater') {
        r = 36; g = 104; b = 138;
      } else if (surfaceKind === 'RiverBank') {
        r = 168; g = 152; b = 126;
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

      return { r, g, b };
    }

    // 地形坡度环境光遮蔽 (AO)：陡峭山谷/深沟采光受限，平原开阔通透
    function terrainAmbientOcclusion(dzdx, dzdy) {
      const slopeDeg = Math.atan(Math.hypot(dzdx || 0, dzdy || 0)) * (180 / Math.PI);
      return Math.max(0.70, 1.0 - (slopeDeg / 65.0) * 0.30);
    }

    // 静态光照组合入口（v1.47.11 行为，作为动态光照关闭时的对照路径与兜底）
    // 光源来自左上方俯视: L = normalize(-0.45, -0.60, 0.66)
    function computeElevationColor(cell, minZ, maxZ) {
      const { dzdx = 0, dzdy = 0 } = cell;
      const alb = computeTerrainAlbedo(cell, minZ, maxZ);

      // 单位法线: N = normalize(-dzdx, -dzdy, 1.0)
      const normLen = Math.hypot(-dzdx, -dzdy, 1.0) || 1.0;
      const dot = (0.45 * dzdx + 0.60 * dzdy + 0.66) / normLen;
      const diffuse = Math.max(0, dot);
      const ao = terrainAmbientOcclusion(dzdx, dzdy);
      const lightFactor = Math.max(0.52, Math.min(1.22, (0.54 + 0.46 * diffuse) * ao));

      const finalR = Math.min(255, Math.max(0, Math.floor(alb.r * lightFactor)));
      const finalG = Math.min(255, Math.max(0, Math.floor(alb.g * lightFactor)));
      const finalB = Math.min(255, Math.max(0, Math.floor(alb.b * lightFactor)));

      return `rgb(${finalR}, ${finalG}, ${finalB})`;
    }
