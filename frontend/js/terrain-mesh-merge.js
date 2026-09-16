// === 地形共面网格贪婪合并 (Greedy Quad Meshing) ===
// 单一职责：将法线方向近似、高程共面且材质相同的相邻 1x1 地形网格，沿轴对齐矩形贪婪合并为更大四边形
// 输入：sim.terrain (gridSize, cells, nx, ny, nz) + RENDER_CONFIG.terrainMeshMerge 配置
// 输出：{ quads: [...], totalOriginal, totalMerged, ratio }
(function () {
  'use strict';

  let _cachedMesh = null;
  let _lastTerrainRef = null;
  let _lastConfigRev = null;

  function _getEffectiveConfig(config) {
    const globalCfg = (typeof window !== 'undefined' && window.RENDER_CONFIG && window.RENDER_CONFIG.terrainMeshMerge);
    return Object.assign({
      enabled: true,
      maxSpan: 8,
      normalAngleDeg: 2.0,
      planeElevTol: 0.5,
      sameSurfaceKind: true,
    }, globalCfg, config);
  }

  function _configRevision(cfg) {
    if (!cfg || cfg.enabled === false) return 'disabled';
    return `${cfg.enabled}:${cfg.maxSpan}:${cfg.normalAngleDeg}:${cfg.planeElevTol}:${cfg.sameSurfaceKind}`;
  }

  function buildMergedMesh(terrain, config) {
    if (!terrain || !terrain.cells || !(terrain.gridSize > 1)) {
      return null;
    }

    const cfg = _getEffectiveConfig(config);

    const gSize = terrain.gridSize | 0;
    const N = gSize - 1;
    const totalOriginal = N * N;
    const cells = terrain.cells;
    const nxArr = terrain.nx, nyArr = terrain.ny, nzArr = terrain.nz;

    // 若未启用合并，快速生成 1x1 网格描述，保证下游接口契约统一
    if (!cfg.enabled || cfg.maxSpan <= 1) {
      const fallbackQuads = new Array(totalOriginal);
      let qi = 0;
      for (let gy = 0; gy < N; gy++) {
        const row0 = gy * gSize, row1 = row0 + gSize;
        for (let gx = 0; gx < N; gx++) {
          const i00 = row0 + gx, i10 = i00 + 1, i11 = row1 + gx + 1, i01 = row1 + gx;
          const c00 = cells[i00], c10 = cells[i10], c11 = cells[i11], c01 = cells[i01];
          fallbackQuads[qi++] = {
            gx, gy, w: 1, h: 1,
            i00, i10, i11, i01,
            cx: (c00.wx + c10.wx + c11.wx + c01.wx) * 0.25,
            cy: (c00.wy + c10.wy + c11.wy + c01.wy) * 0.25,
            cz: (c00.elev + c10.elev + c11.elev + c01.elev) * 0.25,
          };
        }
      }
      return { quads: fallbackQuads, totalOriginal, totalMerged: totalOriginal, ratio: '0.0' };
    }

    const maxSpan = Math.max(1, Math.min(32, cfg.maxSpan | 0));
    const minCos = Math.cos((cfg.normalAngleDeg != null ? cfg.normalAngleDeg : 2.0) * Math.PI / 180.0);
    const planeTol = Math.max(0.01, cfg.planeElevTol || 0.5);
    const checkKind = !!cfg.sameSurfaceKind;

    // 访问标记位图 (Uint8Array 紧凑高效，0 = 未合并，1 = 已合并)
    const visited = new Uint8Array(totalOriginal);
    const quads = [];

    // 获取单元法线辅助函数
    const getNormal = (idx, cell) => {
      if (nxArr) return { x: nxArr[idx], y: nyArr[idx], z: nzArr[idx] };
      return { x: cell.nx || 0, y: cell.ny || 0, z: cell.nz || 1 };
    };

    for (let gy = 0; gy < N; gy++) {
      const rowOffset = gy * N;
      for (let gx = 0; gx < N; gx++) {
        const vIdx = rowOffset + gx;
        if (visited[vIdx]) continue;

        const baseCellIdx = gy * gSize + gx;
        const baseCell = cells[baseCellIdx];
        const baseKind = baseCell.surfaceKind;
        // ★ v1.50.76 河床水格禁合并（修「河面特定角度出现水平条纹」）：
        //   河面是半透明两遍填充（净 α≈0.715），河床格与河面段同队列排序，设计前提
        //   「格心深度 < 覆盖它的河面段深度（段四角取最大）」依赖深度函数线性 + 格心
        //   在段 xy 范围内。合并成最大 8×8 大 quad 后深度取 quad 中心——中心可能比
        //   覆盖其远半幅的河面段更近，大河床 quad 后画即用不透明河床色盖掉已画水面
        //   → 规则水平深色条带（角度相关）。水域格占比小，保持 1×1 零风险。
        const baseIsWater = baseKind === 'DeepWater' || baseKind === 'ShallowWater';
        const baseWater = (baseCell.waterDepth || 0) > 0;
        const baseNorm = getNormal(baseCellIdx, baseCell);

        // 阶段 1：沿 X 轴向右探测可扩展宽度 W（★ v1.50.76 水格跳过扩展，恒 1×1）
        let maxW = 1;
        const limitW = (!baseIsWater) ? Math.min(N - gx, maxSpan) : 1;
        for (let w = 1; w < limitW; w++) {
          const colX = gx + w;
          const neighborVIdx = rowOffset + colX;
          if (visited[neighborVIdx]) break;

          const nCellIdx = gy * gSize + colX;
          const nCell = cells[nCellIdx];
          if (checkKind && nCell.surfaceKind !== baseKind) break;
          if (((nCell.waterDepth || 0) > 0) !== baseWater) break;

          const nNorm = getNormal(nCellIdx, nCell);
          const dot = baseNorm.x * nNorm.x + baseNorm.y * nNorm.y + baseNorm.z * nNorm.z;
          if (dot < minCos) break;

          maxW = w + 1;
        }

        // 阶段 2：沿 Y 轴向下探测可扩展高度 H（★ v1.50.76 水格跳过扩展）
        let maxH = 1;
        const limitH = (!baseIsWater) ? Math.min(N - gy, maxSpan) : 1;
        for (let h = 1; h < limitH; h++) {
          const rowY = gy + h;
          const nextRowOffset = rowY * N;
          let rowOk = true;

          // 候选行中的所有 maxW 列都必须与基准共面且未访问
          for (let col = 0; col < maxW; col++) {
            const colX = gx + col;
            const neighborVIdx = nextRowOffset + colX;
            if (visited[neighborVIdx]) { rowOk = false; break; }

            const nCellIdx = rowY * gSize + colX;
            const nCell = cells[nCellIdx];
            if (checkKind && nCell.surfaceKind !== baseKind) { rowOk = false; break; }
            if (((nCell.waterDepth || 0) > 0) !== baseWater) { rowOk = false; break; }

            const nNorm = getNormal(nCellIdx, nCell);
            const dot = baseNorm.x * nNorm.x + baseNorm.y * nNorm.y + baseNorm.z * nNorm.z;
            if (dot < minCos) { rowOk = false; break; }
          }
          if (!rowOk) break;

          // 阶段 3：双线性平面共面性校验 (检查矩形内部顶点与四角拟合平面的高程差)
          const curW = maxW, curH = h + 1;
          const c00z = cells[gy * gSize + gx].elev;
          const c10z = cells[gy * gSize + (gx + curW)].elev;
          const c11z = cells[(gy + curH) * gSize + (gx + curW)].elev;
          const c01z = cells[(gy + curH) * gSize + gx].elev;

          let planarOk = true;
          // 采样待扩充行中的内部顶点
          for (let col = 0; col <= curW; col++) {
            const zAct = cells[(gy + curH) * gSize + (gx + col)].elev;
            const s = col / curW, t = 1.0;
            const zExp = (1 - s) * (1 - t) * c00z + s * (1 - t) * c10z + s * t * c11z + (1 - s) * t * c01z;
            if (Math.abs(zAct - zExp) > planeTol) {
              planarOk = false;
              break;
            }
          }
          if (!planarOk) break;

          maxH = curH;
        }

        // 阶段 4：标记该矩形内所有单元已访问
        for (let r = 0; r < maxH; r++) {
          const rowStart = (gy + r) * N + gx;
          for (let c = 0; c < maxW; c++) {
            visited[rowStart + c] = 1;
          }
        }

        // 阶段 5：生成合并后大四边形描述项
        const i00 = gy * gSize + gx;
        const i10 = gy * gSize + (gx + maxW);
        const i11 = (gy + maxH) * gSize + (gx + maxW);
        const i01 = (gy + maxH) * gSize + gx;

        const c00 = cells[i00], c10 = cells[i10], c11 = cells[i11], c01 = cells[i01];
        quads.push({
          gx, gy, w: maxW, h: maxH,
          i00, i10, i11, i01,
          cx: (c00.wx + c10.wx + c11.wx + c01.wx) * 0.25,
          cy: (c00.wy + c10.wy + c11.wy + c01.wy) * 0.25,
          cz: (c00.elev + c10.elev + c11.elev + c01.elev) * 0.25,
        });
      }
    }

    const totalMerged = quads.length;
    const ratio = totalOriginal > 0 ? ((1.0 - totalMerged / totalOriginal) * 100.0).toFixed(1) : '0.0';

    return {
      quads,
      totalOriginal,
      totalMerged,
      ratio,
    };
  }

  window.TerrainMeshMerge = {
    build(terrain, config) {
      const effCfg = _getEffectiveConfig(config);
      const cfgRev = _configRevision(effCfg);
      if (_cachedMesh && _lastTerrainRef === terrain && _lastConfigRev === cfgRev) {
        return _cachedMesh;
      }
      _cachedMesh = buildMergedMesh(terrain, effCfg);
      _lastTerrainRef = terrain;
      _lastConfigRev = cfgRev;
      return _cachedMesh;
    },
    invalidate() {
      _cachedMesh = null;
      _lastTerrainRef = null;
      _lastConfigRev = null;
    },
  };
})();
