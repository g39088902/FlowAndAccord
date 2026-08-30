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

    function computeElevationColor(cell, minZ, maxZ) {
      const { elev, dzdx, dzdy } = cell;
      const range = Math.max(1, maxZ - minZ);
      const normZ = Math.max(0, Math.min(1, (elev - minZ) / range));
      const lightFactor = Math.max(0.70, Math.min(1.30, 1.0 + (-dzdx * 0.35 - dzdy * 0.35)));

      let r, g, b;
      if (normZ < 0.45) {
        const t = normZ / 0.45;
        r = Math.floor(16 + t * (40 - 16));
        g = Math.floor(150 + t * (180 - 150));
        b = Math.floor(100 + t * (70 - 100));
      } else if (normZ < 0.75) {
        const t = (normZ - 0.45) / 0.30;
        r = Math.floor(40 + t * (190 - 40));
        g = Math.floor(180 + t * (160 - 180));
        b = Math.floor(70 + t * (40 - 70));
      } else {
        const t = (normZ - 0.75) / 0.25;
        r = Math.floor(190 + t * (160 - 190));
        g = Math.floor(160 + t * (165 - 160));
        b = Math.floor(40 + t * (170 - 40));
      }

      return `rgba(${Math.floor(r * lightFactor)}, ${Math.floor(g * lightFactor)}, ${Math.floor(b * lightFactor)}, 0.55)`;
    }
