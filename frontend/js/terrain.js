// === 3D 地形高程采样 ===
    class PureTiltedTerrain {
      constructor(gridSize = 60, worldSize = 764) {
        this.gridSize = gridSize;
        this.worldSize = worldSize;
        this.cells = [];
        this.tiltAngle = 0;
        this.tiltMagnitude = 60;
        this.minZ = 0;
        this.maxZ = 0;
        this.generate();
      }
      generate() {
        this.cells = [];
        const half = this.worldSize / 2;

        this.tiltAngle = Math.random() * Math.PI * 2;
        this.tiltMagnitude = 56 + Math.random() * 8;
        const tiltCos = Math.cos(this.tiltAngle);
        const tiltSin = Math.sin(this.tiltAngle);

        const p1x = Math.random() * 50, p1y = Math.random() * 50;
        const p2x = Math.random() * 50, p2y = Math.random() * 50;

        const rawElevs = [];
        this.minZ = 999;
        this.maxZ = -999;

        for (let gy = 0; gy < this.gridSize; gy++) {
          for (let gx = 0; gx < this.gridSize; gx++) {
            const wx = (gx / (this.gridSize - 1)) * this.worldSize - half;
            const wy = (gy / (this.gridSize - 1)) * this.worldSize - half;

            const proj = (wx * tiltCos + wy * tiltSin) / half;
            const baseTilt = proj * (this.tiltMagnitude * 0.5);

            const waveLarge = Math.sin(wx * 0.006 + p1x) * Math.cos(wy * 0.006 + p1y) * 5.0;
            const waveMedium = (Math.cos(wx * 0.014 + p2x) + Math.sin(wy * 0.014 + p2y)) * 2.5;

            const elev = baseTilt + waveLarge + waveMedium;
            rawElevs.push(elev);
            if (elev < this.minZ) this.minZ = elev;
            if (elev > this.maxZ) this.maxZ = elev;
          }
        }

        const step = this.worldSize / (this.gridSize - 1);
        for (let gy = 0; gy < this.gridSize; gy++) {
          for (let gx = 0; gx < this.gridSize; gx++) {
            const idx = gy * this.gridSize + gx;
            const wx = (gx / (this.gridSize - 1)) * this.worldSize - half;
            const wy = (gy / (this.gridSize - 1)) * this.worldSize - half;
            const elev = rawElevs[idx];

            const dzdx = (gx > 0 && gx < this.gridSize - 1) ? (rawElevs[gy * this.gridSize + gx + 1] - rawElevs[gy * this.gridSize + gx - 1]) / (2 * step) : 0;
            const dzdy = (gy > 0 && gy < this.gridSize - 1) ? (rawElevs[(gy + 1) * this.gridSize + gx] - rawElevs[(gy - 1) * this.gridSize + gx]) / (2 * step) : 0;
            const slopeAngle = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;

            this.cells.push({ wx, wy, elev, slopeAngle, dzdx, dzdy });
          }
        }
      }
      sample(wx, wy) {
        const half = this.worldSize / 2;
        const nx = Math.max(0, Math.min(0.999, (wx + half) / this.worldSize));
        const ny = Math.max(0, Math.min(0.999, (wy + half) / this.worldSize));
        const gx = Math.floor(nx * this.gridSize);
        const gy = Math.floor(ny * this.gridSize);
        return this.cells[gy * this.gridSize + gx] || { elev: 0, slopeAngle: 0 };
      }
    }
