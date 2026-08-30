// === RustWorld: 由 Rust (wasm) 确定性引擎驱动的世界适配层 ===
    // 与 WorldSimulation 保持同构接口，render.js / main.js 无需改动。
    // AI (动机决策/加权A*寻路/IDM运动/家庭房屋生命周期) 全部运行在编译为 wasm 的 sim_core 中。
    class RustWorld {
      constructor() {
        // 前端展示与交互状态 (与原 JS 引擎同构)
        this.isPaused = false;
        this.headless = false; // 🧠 无头模式: 只推进模拟、跳过画布渲染
        this.speedMult = 2;
        this.showTerrain = true;
        this.showLanes = true;
        this.showPoiStock = true;
        this.selectionType = 'agent';
        this.selectedAgentId = 1;
        this.selectedPoiId = null;
        this.selectedHouseId = null;

        // 世界视图对象 (由快照映射而来)
        this.agents = [];
        this.agentArchive = new Map(); // 族人全量生命周期档案库 (含已故先祖，保障断代/绝嗣穿梭不跳帧)
        this.houses = [];
        this.pois = [];
        this.terrain = { gridSize: 60, minZ: 0, maxZ: 1, cells: [] };
        this.network = { lanes: new Map(), nodes: new Map() };
        this.totalBirths = 0;
        this.totalDeaths = 0;
        this.totalMiscarriages = 0;
        this.currentSeason = 'Spring';
        this.temperature = 20.0;
        this.tickCount = 0;

        // 引擎状态 (以页面打开时间 Date.now() 作为随机种子)
        this._wasm = null;
        this._memory = null;
        this._ready = false;
        this._engineSeed = Date.now();
        this._terrainCached = false;
        this._lastEvent = null;
        this._trails = new Map();

        // 异步加载 Rust 引擎 (wasm)
        this._loadWasm();
      }

      async _loadWasm() {
        try {
          const resp = await fetch('rust/sim_wasm.wasm');
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const bytes = await resp.arrayBuffer();
          const result = await WebAssembly.instantiate(bytes, {});
          this._wasm = result.instance.exports;
          this._memory = this._wasm.memory;
          this._wasm.world_create(60, 764.0, this._engineSeed, 12);
          this._ready = true;
          this._pullSnapshot(true);
          if (this._lastEvent) this.logEvent(this._lastEvent, 'camp');
          console.info(`[RustWorld] sim_core wasm 引擎已接管 AI 决策/寻路/运动 (开局种子: ${this._engineSeed})`);
        } catch (e) {
          console.error('[RustWorld] 无法加载 Rust 引擎 (请通过 HTTP 服务访问):', e);
        }
      }

      // 清空当前选中 (agent / poi / house)，关闭 Inspector 面板
      deselect() {
        this.selectionType = null;
        this.selectedAgentId = null;
        this.selectedPoiId = null;
        this.selectedHouseId = null;
      }

      // 获取族人对象 (优先活跃列表，若已故脱离活跃列表则从先祖档案库中检索)
      getAgent(id) {
        if (id === null || id === undefined) return null;
        const numId = typeof id === 'string' ? parseInt(id, 10) : id;
        if (isNaN(numId)) return null;
        return this.agents.find(a => a.id === numId) || this.agentArchive.get(numId) || null;
      }

      // ============ 引擎驱动 ============
      tick() {
        if (!this._ready || this.isPaused) return;
        const dt = 1.0 / 30.0;
        this._wasm.world_tick_steps(Math.max(1, this.speedMult | 0), dt);
        this._pullSnapshot(false);
      }

      initEcology(agentCount) {
        this._engineSeed = Date.now();
        this._terrainCached = false;
        this._lastEvent = null;
        this._trails.clear();
        this.agentArchive.clear();
        if (this._ready) {
          this._wasm.world_create(60, 764.0, this._engineSeed, agentCount || 12);
          this._pullSnapshot(true);
          if (this._lastEvent) this.logEvent(this._lastEvent, 'camp');
        }
      }

      setWaterRegenMultiplier(m) { if (this._ready) this._wasm.world_set_regen_multiplier(0, m); }
      setBerryRegenMultiplier(m) { if (this._ready) this._wasm.world_set_regen_multiplier(1, m); }
      setWoodRegenMultiplier(m)  { if (this._ready) this._wasm.world_set_regen_multiplier(2, m); }
      setStoneRegenMultiplier(m) { if (this._ready) this._wasm.world_set_regen_multiplier(3, m); }
      setGoldRegenMultiplier(m)  { if (this._ready) this._wasm.world_set_regen_multiplier(4, m); }

      logEvent(msg, type = '') {
        const list = document.getElementById('log-list');
        if (!list) return;
        const entry = document.createElement('div');
        entry.className = 'log-entry ' + type;
        entry.textContent = '[Tick ' + this.tickCount + '] ' + msg;
        list.appendChild(entry);
        while (list.children.length > 8) list.removeChild(list.firstChild);
      }

      // ============ 快照拉取与视图映射 ============
      _pullSnapshot(forceTerrain) {
        const ptr = this._wasm.world_snapshot_ptr();
        const len = this._wasm.world_snapshot_len();
        if (!len) return;
        const bytes = new Uint8Array(this._memory.buffer, ptr, len);
        let snap;
        try {
          snap = JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
          console.error('[RustWorld] 快照解析失败', e);
          return;
        }
        this.tickCount = snap.tick;
        this._applySnapshot(snap, forceTerrain);
      }

      _applySnapshot(snap, forceTerrain) {
        this.totalBirths = snap.total_births;
        this.totalDeaths = snap.total_deaths;
        this.totalMiscarriages = snap.total_miscarriages;
        this.currentSeason = snap.season;
        this.temperature = snap.temperature;

        // 事件日志: 仅记录新增事件
        if (snap.last_mutation_event && snap.last_mutation_event !== this._lastEvent) {
          this._lastEvent = snap.last_mutation_event;
          this.logEvent(snap.last_mutation_event, '');
        }

        // --- 地形 (仅首次/重开时重建) ---
        if (!this._terrainCached || forceTerrain) {
          const w = snap.grid_w, h = snap.grid_h;
          const worldSize = snap.world_size || 764.0;
          const half = worldSize / 2;
          const cells = new Array(w * h);
          let minZ = Infinity, maxZ = -Infinity;
          for (let gy = 0; gy < h; gy++) {
            for (let gx = 0; gx < w; gx++) {
              const idx = gy * w + gx;
              const wx = (gx / (w - 1)) * worldSize - half;
              const wy = (gy / (h - 1)) * worldSize - half;
              const cellData = snap.terrain_cells[idx] || { elevation: 0, slope_angle: 0 };
              const e = cellData.elevation;
              const slopeAngle = cellData.slope_angle;
              if (e < minZ) minZ = e;
              if (e > maxZ) maxZ = e;
              cells[idx] = { wx, wy, elev: e, slopeAngle, dzdx: 0, dzdy: 0 };
            }
          }
          const step = worldSize / (w - 1);
          for (let gy = 0; gy < h; gy++) {
            for (let gx = 0; gx < w; gx++) {
              const idx = gy * w + gx;
              const eR = gx < w - 1 ? cells[gy * w + gx + 1].elev : cells[idx].elev;
              const eL = gx > 0 ? cells[gy * w + gx - 1].elev : cells[idx].elev;
              const eD = gy < h - 1 ? cells[(gy + 1) * w + gx].elev : cells[idx].elev;
              const eU = gy > 0 ? cells[(gy - 1) * w + gx].elev : cells[idx].elev;
              cells[idx].dzdx = (eR - eL) / (2 * step);
              cells[idx].dzdy = (eD - eU) / (2 * step);
              cells[idx].color = computeElevationColor(cells[idx], minZ, maxZ);
            }
          }
          this.terrain = { gridSize: w, worldSize, minZ, maxZ, cells };
          this._terrainCached = true;
        }

        // --- POI ---
        const poiTypeMap = { Camp: 'Camp', WaterSource: 'Water', BerryBush: 'Berry', WoodForest: 'Wood', StoneQuarry: 'Stone', GoldMine: 'Gold' };
        this.pois = snap.pois.map(p => ({
          id: p.id,
          type: poiTypeMap[p.poi_type] || p.poi_type,
          pos: { x: p.x, y: p.y, z: p.z },
          currentStock: p.current_stock,
          maxStock: p.max_stock,
          regenRate: p.regen_rate,
          name: p.name || (p.poi_type === 'Camp' ? '聚落 #' + p.id : (poiTypeMap[p.poi_type] || p.poi_type) + ' #' + p.id),
          campTitle: p.camp_title || p.name || ('聚落 #' + p.id),
          level: p.level || 0,
          boundHouses: p.bound_houses || 0
        }));

        // --- 房屋 ---
        this.houses = snap.houses.map(h => {
          const view = {
            id: h.id,
            pos: { x: h.x, y: h.y, z: h.z },
            tier: h.tier,
            ownerId: h.owner_id,
            spouseId: h.spouse_id,
            campId: h.camp_id,
            isRuin: h.is_ruin,
            isRepairing: h.is_repairing,
            durability: h.durability,
            pantryWater: h.pantry_water, maxPantryWater: h.max_pantry_water,
            pantryFood: h.pantry_food, maxPantryFood: h.max_pantry_food,
            pantryWood: h.pantry_wood, maxPantryWood: h.max_pantry_wood,
            pantryStone: h.pantry_stone, maxPantryStone: h.max_pantry_stone,
            pantryGold: h.pantry_gold || 0.0, maxPantryGold: h.max_pantry_gold || 0.0,
            age: h.age,
            generation: h.generation,
            constructionProgress: h.construction_progress,
            isFertilityActive: () => h.is_fertility_active,
            isPantryFull: () => h.is_pantry_full
          };
          return view;
        });

        // --- 路网 (车道 + 节点) ---
        const lanes = new Map();
        for (const l of snap.lanes) {
          lanes.set(l.id, {
            id: l.id,
            from: l.from,
            to: l.to,
            wear: l.wear,
            roadClass: l.road_class,
            speedLimit: l.speed_limit,
            isHidden: l.is_hidden,
            concealment: l.concealment,
            reverseId: null,
            curve: makeBezierCurve(l.p0, l.p1, l.p2, l.p3)
          });
        }
        for (const l of lanes.values()) {
          for (const r of lanes.values()) {
            if (r.from === l.to && r.to === l.from) { l.reverseId = r.id; break; }
          }
        }
        this.network.lanes = lanes;
        const nodes = new Map();
        for (const n of snap.nodes) {
          nodes.set(n.id, { id: n.id, pos: { x: n.x, y: n.y, z: n.z }, nodeType: n.node_type });
        }
        this.network.nodes = nodes;

        // --- Agent ---
        const prevAgents = new Map(this.agents.map(a => [a.id, a]));
        this.agents = snap.agents.map(a => {
          const pos = { x: a.x, y: a.y, z: a.z };
          const isMoving = a.is_alive && a.velocity > 0.01;
          const prev = prevAgents.get(a.id);
          let trail = prev ? prev.trail.slice() : [];
          if (isMoving) {
            const last = trail[trail.length - 1];
            if (!last) {
              trail.push(pos);
            } else {
              const d = Math.hypot(pos.x - last.x, pos.y - last.y);
              if (d > 0.8 && d < 18.0) {
                trail.push(pos);
                if (trail.length > 4) trail.shift();
              } else if (d >= 18.0) {
                trail = [pos];
              }
            }
          } else {
            if (trail.length > 0) trail.shift();
          }
          return {
            id: a.id,
            gender: a.gender === 'Female' ? 'female' : 'male',
            pos,
            age: a.age,
            state: a.state,
            currentNeed: a.current_need, // 马斯洛需求层级·种类 (如 Physiological·QuenchThirst)
            isAlive: a.is_alive,
            velocity: a.velocity || 0,
            hunger: a.hunger,
            thirst: a.thirst,
            stamina: a.stamina,
            health: a.health,
            maxHealth: a.max_health,
            carriedWater: a.carried_water,
            carriedFood: a.carried_food,
            carriedWood: a.carried_wood,
            carriedStone: a.carried_stone,
            carriedGold: a.carried_gold,
            buildTimer: a.build_timer,
            isPregnant: a.is_pregnant,
            pregnancyProgress: a.pregnancy_progress,
            miscarriageCooldown: a.miscarriage_cooldown,
            miscarriageTimer: a.miscarriage_alert_timer,
            isOffroad: a.is_offroad,
            deathDecayTimer: a.death_decay_timer,
            deathCause: a.death_cause,
            isCovert: a.is_covert,
            stealthVisibility: a.stealth_visibility,
            homeHouseId: a.home_house_id,
            generation: a.generation || 1,
            spouseId: a.spouse_id,
            motherId: a.mother_id,
            fatherId: a.father_id,
            children: a.children_ids,
            intelligence: a.intelligence,
            strength: a.strength,
            digestionEfficiency: a.digestion_efficiency,
            libido: a.libido,
            sleepEfficiency: a.sleep_efficiency,
            lifeExpectancy: a.life_expectancy,
            surname: a.surname || '',
            prestige: a.prestige || 0,
            trail
          };
        });

        // 持续同步全量族人档案库 (保留已故先祖快照)
        for (const ag of this.agents) {
          this.agentArchive.set(ag.id, ag);
        }
      }
    }

    function makeBezierCurve(p0, p1, p2, p3) {
      return {
        p0, p1, p2, p3,
        evalPos(t) {
          t = Math.max(0, Math.min(1, t));
          const u = 1 - t;
          return {
            x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
            y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
            z: u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z
          };
        }
      };
    }