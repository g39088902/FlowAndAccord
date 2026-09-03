// === RustWorld: 由 Rust (wasm) 确定性引擎驱动的世界适配层 ===
    // 与 WorldSimulation 保持同构接口，render.js / main.js 无需改动。
    // AI (动机决策/加权A*寻路/IDM运动/家庭房屋生命周期) 全部运行在编译为 wasm 的 sim_core 中。
    class RustWorld {
      constructor() {
        // 前端展示与交互状态 (与原 JS 引擎同构)
        this.isPaused = false;
        this.headless = false; // 🧠 无头模式: 只推进模拟、跳过画布渲染
        this.debugMode = false; // 🐞 调试模式: 展示 Tick / CPU 耗时 / 内存占用
        this.tickMs = 0; // 内核步进耗时 (EMA 平滑, ms)
        this.snapMs = 0; // 快照解析耗时 (EMA 平滑, ms)
        this.speedMult = 2;
        this.showTerrain = true;
        this.showLanes = true;   // 🛣️ 路网显隐 (false = 隐藏全部车道与悬浮提示)
        this.showAgents = true;  // 👤 部落民显隐 (false = 隐藏全部族人，且不再参与点击拾取)
        this.selectionType = 'agent';
        this.selectedAgentId = 1;
        this.selectedPoiId = null;
        this.selectedHouseId = null;

        // 世界视图对象 (由快照映射而来)
        this.agents = [];
        this.agentArchive = new Map(); // 族人全量生命周期档案库 (含已故先祖，保障断代/绝嗣穿梭不跳帧)
        this._consumedDeathIds = new Set(); // ★ v1.8.7 已消费的死亡/流产墓碑 id（防快照重复读档误处理）
        this.houses = [];
        this.pois = [];
        // ★ 账本与家户/婚姻登记簿 (v0.9.72 M1 账本系统)
        this.households = [];  // 家户列表（家庭跟着男人走：以男性户主为锚）
        this.marriages = [];   // 婚姻列表（一人终生多段婚姻全留痕）
        this.publicGranaryBalances = {};  // ★ M2: 公仓兜底账本余额
        this.clans = [];                   // ★ M3: 宗族登记簿
        this.regions = [];                 // ★ M4: 地区/王国登记簿
        this.expeditionTargets = new Map();// ★ M4: 远征目标反查表 agent_id -> camp_id
        this.terrain = { gridSize: 60, minZ: 0, maxZ: 1, cells: [] };
        this.network = { lanes: new Map(), nodes: new Map() };
        this.totalBirths = 0;
        this.totalDeaths = 0;
        this.totalDeathsNatural = 0;   // ☘️ 自然死亡 (寿终正寝 / 寿命耗尽)
        this.totalDeathsUnnatural = 0; // ⚡ 非自然死亡 (饥荒饿死 / 脱水渴死)
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
          this._wasm.world_create(60, 764.0, this._engineSeed, 20);
          this._ready = true;
          if (window.SIM_CONFIG) {
            this.applyConfig(window.SIM_CONFIG);
          }
          this._pullSnapshot(true);
          if (this._lastEvent) this.logEvent(this._lastEvent, 'camp');
          console.info(`[RustWorld] sim_core wasm 引擎已接管 AI 决策/寻路/运动 (开局种子: ${this._engineSeed})`);
        } catch (e) {
          console.error('[RustWorld] 无法加载 Rust 引擎 (请通过 HTTP 服务访问):', e);
        }
      }

      // 应用动态配置到 WASM 仿真引擎 (支持热更新，免重新编译)
      applyConfig(cfg) {
        if (!this._ready) return false;
        const configObj = Object.assign({}, cfg || window.SIM_CONFIG);
        if (!configObj) return false;
        // ★ M8 合并「升级材料成本矩阵」拆分配置（config.house-upgrade-cost.js，20 字段），
        // 该文件已由 index.html 在本脚本之前加载；合并后随主配置一并注入 WASM 内核。
        if (window.SIM_HOUSE_UPGRADE_COST) {
          Object.assign(configObj, window.SIM_HOUSE_UPGRADE_COST);
        }
        try {
          const jsonStr = JSON.stringify(configObj);
          const encoded = new TextEncoder().encode(jsonStr);
          if (typeof this._wasm.world_config_buf_ptr === 'function' && typeof this._wasm.world_apply_config_buf === 'function') {
            const ptr = this._wasm.world_config_buf_ptr(encoded.length);
            new Uint8Array(this._memory.buffer, ptr, encoded.length).set(encoded);
            const res = this._wasm.world_apply_config_buf(encoded.length);
            if (res === 0) {
              console.info('[RustWorld] 已成功同步并应用 JS 动态配置至 WASM 内核');
              return true;
            } else {
              console.warn('[RustWorld] 应用 JS 动态配置失败，状态码:', res);
              return false;
            }
          }
        } catch (e) {
          console.error('[RustWorld] 序列化/发送配置至 WASM 失败:', e);
        }
        return false;
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

      // ★ 获取某 agent 所属的家户（家庭跟着男人走）
      getHouseholdOfAgent(agentId) {
        if (agentId === null || agentId === undefined) return null;
        const numId = typeof agentId === 'string' ? parseInt(agentId, 10) : agentId;
        return this.households.find(h => h.members.includes(numId)) || null;
      }

      // ★ 获取某人当前存续婚姻
      getActiveMarriageOf(agentId) {
        if (agentId === null || agentId === undefined) return null;
        const numId = typeof agentId === 'string' ? parseInt(agentId, 10) : agentId;
        return this.marriages.find(m => m.isActive && (m.husbandId === numId || m.wifeId === numId)) || null;
      }

      // ★ 获取某人的全部婚姻历史（含已封账段）
      getAllMarriagesOf(agentId) {
        if (agentId === null || agentId === undefined) return [];
        const numId = typeof agentId === 'string' ? parseInt(agentId, 10) : agentId;
        return this.marriages.filter(m => m.husbandId === numId || m.wifeId === numId);
      }

      // ============ 引擎驱动 ============
      tick() {
        if (!this._ready || this.isPaused) return;
        const dt = 1.0 / 30.0;
        const t0 = performance.now();
        this._wasm.world_tick_steps(Math.max(1, this.speedMult | 0), dt);
        const t1 = performance.now();
        this._pullSnapshot(false);
        const t2 = performance.now();
        // 指数移动平均平滑，避免 HUD 数值抖动 (仅在调试模式下采样)
        if (this.debugMode) {
          this.tickMs += ((t1 - t0) - this.tickMs) * 0.15;
          this.snapMs += ((t2 - t1) - this.snapMs) * 0.15;
        }
      }

      // ============ 🐞 调试统计 ============
      getDebugStats() {
        const wasmBytes = (this._memory && this._memory.buffer) ? this._memory.buffer.byteLength : 0;
        const mem = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
        return {
          tick: this.tickCount,
          tickMs: this.tickMs,
          snapMs: this.snapMs,
          wasmBytes,
          jsHeapUsed: mem ? mem.usedJSHeapSize : 0,
          jsHeapLimit: mem ? mem.jsHeapSizeLimit : 0,
          memSupported: !!mem,
        };
      }

      initEcology(agentCount) {
        this._engineSeed = Date.now();
        this._terrainCached = false;
        this._lastEvent = null;
        this._trails.clear();
        this.agentArchive.clear();
        this._consumedDeathIds.clear();
        if (this._ready) {
          this._wasm.world_create(60, 764.0, this._engineSeed, agentCount || 20);
          if (window.SIM_CONFIG) {
            this.applyConfig(window.SIM_CONFIG);
          }
          this._pullSnapshot(true);
          if (this._lastEvent) this.logEvent(this._lastEvent, 'camp');
        }
      }

      // ============ 💾 读档 / 存档 (v1.7.0) ============
      // 存档：world_save_ptr/len 由内核导出全量世界状态 JSON（含 RNG 内部状态，强确定性）
      // 读档：world_save_buf_ptr(len) 取可写缓冲 → 写入字节 → world_load(len) 覆盖内核世界
      // 失败原因统一从 world_last_error_ptr/len 读取

      /** 读取内核最近一次存档/读档错误文本（无错误返回空串） */
      readSaveError() {
        if (!this._ready || typeof this._wasm.world_last_error_len !== 'function') return '';
        const len = this._wasm.world_last_error_len();
        if (!len) return '';
        const ptr = this._wasm.world_last_error_ptr();
        return new TextDecoder().decode(new Uint8Array(this._memory.buffer, ptr, len));
      }

      /**
       * 导出当前世界全量存档 JSON（失败返回 null，原因见 readSaveError()）
       * @returns {string|null}
       */
      saveWorld() {
        if (!this._ready || typeof this._wasm.world_save_ptr !== 'function') return null;
        const ptr = this._wasm.world_save_ptr();
        const len = this._wasm.world_save_len();
        if (!len) return null;
        return new TextDecoder().decode(new Uint8Array(this._memory.buffer, ptr, len));
      }

      /**
       * 载入存档 JSON 并覆盖当前世界
       *
       * 成功后清空前端全部派生缓存（轨迹、先祖档案、地形缓存、选中态）并强制重建地形快照。
       * 注意：存档自带 SimConfig，读档后**不**重新注入 window.SIM_CONFIG，
       * 以免前端热调参覆盖存档时的运行参数、破坏续演语义。
       *
       * @param {string} jsonStr 存档 JSON 文本
       * @param {{seed?:number}} [meta] 可选槽位元信息（用于同步引擎种子展示）
       * @returns {{ok:boolean, error?:string}}
       */
      loadWorld(jsonStr, meta) {
        if (!this._ready || typeof this._wasm.world_load !== 'function') {
          return { ok: false, error: 'WASM 引擎尚未就绪' };
        }
        if (typeof jsonStr !== 'string' || jsonStr.length === 0) {
          return { ok: false, error: '存档内容为空' };
        }
        let encoded;
        try {
          encoded = new TextEncoder().encode(jsonStr);
        } catch (e) {
          return { ok: false, error: '存档编码失败: ' + e.message };
        }
        const ptr = this._wasm.world_save_buf_ptr(encoded.length);
        new Uint8Array(this._memory.buffer, ptr, encoded.length).set(encoded);
        const res = this._wasm.world_load(encoded.length);
        if (res !== 0) {
          const detail = this.readSaveError();
          const codeMsg = { '-1': '存档长度越界', '-2': '存档不是合法 UTF-8 文本', '-3': '存档解析或校验失败' }[String(res)] || ('未知错误 ' + res);
          return { ok: false, error: detail ? codeMsg + '：' + detail : codeMsg };
        }
        // 内核世界已被替换，清空前端全部派生缓存并以 forceTerrain 重建
        this._trails.clear();
        this.agentArchive.clear();
        this._consumedDeathIds.clear();
        this._lastEvent = null;
        this._terrainCached = false;
        this.deselect();
        if (meta && typeof meta.seed === 'number') this._engineSeed = meta.seed;
        this._pullSnapshot(true);
        return { ok: true };
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
        this.totalDeathsNatural = snap.total_deaths_natural || 0;
        this.totalDeathsUnnatural = snap.total_deaths_unnatural || 0;
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
          boundHouses: p.bound_houses || 0,
          vacantHouses: (p.vacant_houses || []).map(vh => ({
            houseId: vh.house_id,
            beneficiaryIds: vh.beneficiary_ids || []
          }))
        }));

        // --- 房屋（M6 建筑化：不再携带任何资源存量；家庭物资展示读家户账本） ---
        this.houses = snap.houses.map(h => {
        const view = {
          id: h.id,
          pos: { x: h.x, y: h.y, z: h.z },
          tier: h.tier,
          ownerId: h.owner_id,
          spouseId: h.spouse_id,
          campId: h.camp_id,
          isRepairing: h.is_repairing,
          durability: h.durability,
          age: h.age,
          constructionProgress: h.construction_progress,
          builderId: h.builder_id,
          lastUpgraderId: h.last_upgrader_id,
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
            birthTick: a.birth_tick || 0,  // 出生时刻 tick (始祖=0, 后代=分娩时 tick_counter)
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
            pregnancyChildId: a.pregnancy_child_id != null ? a.pregnancy_child_id : null,
            isFetus: a.is_fetus || false,
            miscarriageCooldown: a.miscarriage_cooldown,
            postpartumCooldown: a.postpartum_cooldown,
            miscarriageTimer: a.miscarriage_alert_timer,
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
            // ★ M2 账本扩展字段
            marriageHistoryCount: a.marriage_history_count || 0,
            householdId: a.household_id != null ? a.household_id : null,
            householdRole: a.household_role || 'None',
            // ★ M4: 到达时刻与夺位远征标记
            arrivalTick: a.arrival_tick || 0,
            isOnExpedition: a.is_on_expedition || false,
            expeditionTargetCamp: a.expedition_target_camp ?? null,
            coronationPending: a.coronation_pending ?? null,
            trail
          };
        });

        // 持续同步全量族人档案库 (保留已故先祖快照)
        // ★ M1.7 腹中胎儿不入档案库：未出生即流产时不应残留为"存活"记录；出生后以新生儿身份入档
        for (const ag of this.agents) {
          if (ag.isFetus) continue;
          this.agentArchive.set(ag.id, ag);
        }

        // ★ v1.8.7 消费死亡/流产墓碑（recent_deaths）：
        //   · 高倍速单帧跨过衰减窗口时，强制把档案库滞留的"存活"副本补记为已故并写入死因（修复绝嗣废墟/卡片误判"健在"）；
        //   · 流产/随母亡故的腹中胎儿以"已故子嗣"身份入档（族谱可见，死因=流产/随母亡故）。
        const consumedDeaths = this._consumedDeathIds || (this._consumedDeathIds = new Set());
        for (const d of (snap.recent_deaths || [])) {
          if (consumedDeaths.has(d.id)) continue;
          consumedDeaths.add(d.id);
          let rec = this.agentArchive.get(d.id);
          if (!rec) rec = prevAgents.get(d.id);   // 胎儿（未入档）从上一帧活跃列表取，保留血缘字段
          if (rec) {
            rec = Object.assign({}, rec);         // 克隆，避免污染 prevAgents 引用
            rec.isAlive = false;
            rec.deathCause = d.cause;
            if (d.is_fetus) rec.isFetus = false;  // 流产胎儿以"已故子嗣"身份入档
            // 血缘优先以墓碑为准（高倍速下胎儿可能无上一帧快照，prevAgents 取不到）
            if (d.father_id !== undefined) rec.fatherId = d.father_id;
            if (d.mother_id !== undefined) rec.motherId = d.mother_id;
            this.agentArchive.set(d.id, rec);
          } else {
            // 兜底：墓碑字段建最小档案（血缘直接来自墓碑，不丢 parent 链接）
            // 已故入档统一以"已故子嗣"身份（isFetus=false），与 prevAgents 分支一致
            this.agentArchive.set(d.id, {
              id: d.id, isAlive: false, deathCause: d.cause,
              isFetus: false, age: 0, birthTick: 0,
              fatherId: d.father_id !== undefined ? d.father_id : null,
              motherId: d.mother_id !== undefined ? d.mother_id : null,
              surname: '', gender: 'female'
            });
          }
        }

        // ★ 家户登记簿快照映射（家庭跟着男人走）
        this.households = (snap.households || []).map(h => ({
          id: h.id,
          head: h.head,              // 户主（男性）
          members: h.members || [],   // 成员列表（含户主+妻子+未成年子女+腹中胎儿）
          balances: (h.balances || []).reduce((acc, b) => {
            acc[b.resource] = b.amount;
            return acc;
          }, {}),  // 账面余额：{ Water, Food, Wood, Stone, Gold }
          parentHousehold: h.parent_household,
          foundedTick: h.founded_tick,
          isDissolved: h.is_dissolved,
          recentEvents: h.recent_events || [],  // 最近团体事件（从新到旧）
          recentJournal: h.recent_journal || []  // ★ M2: 最近8笔资源流水（从新到旧）
        }));

        // ★ 婚姻登记簿快照映射（一人终生多段婚姻全留痕）
        this.marriages = (snap.marriages || []).map(m => ({
          id: m.id,
          husbandId: m.husband_id,
          wifeId: m.wife_id,
          startTick: m.start_tick,
          endTick: m.end_tick,
          endReason: m.end_reason,
          isActive: m.is_active
        }));

        // ★ M2: 公仓兜底账本余额（绝嗣清算资产充入处）
        this.publicGranaryBalances = (snap.public_granary_balances || []).reduce((acc, b) => {
          acc[b.resource] = b.amount;
          return acc;
        }, {});

        // ★ M3: 宗族登记簿快照映射（按姓氏聚合 · 族长顺位 · 族税族库）
        this.clans = (snap.clans || []).map(c => ({
          surname: c.surname,
          leaderId: c.leader_id != null ? c.leader_id : null,
          memberCount: c.member_count || 0,
          memberIds: c.member_ids || [],
          balances: (c.balances || []).reduce((acc, b) => {
            acc[b.resource] = b.amount;
            return acc;
          }, {}),
          recentJournal: c.recent_journal || [],
          recentEvents: c.recent_events || [],
          isExtinct: !!c.is_extinct
        }));

        // ★ M4: 地区/王国登记簿快照映射（初王/长子继承/公仓税/救济/夺位远征）
        this.regions = (snap.regions || []).map(r => ({
          campId: r.camp_id,
          campName: r.camp_name,
          kingId: r.king_id != null ? r.king_id : null,
          regime: r.regime,
          succession: r.succession,
          memberCount: r.member_count || 0,
          arrivalOrder: r.arrival_order || [],
          heirCandidates: r.heir_candidates || [],
          balances: (r.balances || []).reduce((acc, b) => { acc[b.resource] = b.amount; return acc; }, {}),
          recentJournal: r.recent_journal || [],
          recentEvents: r.recent_events || [],
          activeExpeditionAgents: r.active_expedition_agents || [],
          // ★ v1.12.0 历史国王改为对象数组（含在位起止 tick 与死因），兼容旧档数字数组
          historyKings: (r.history_kings || []).map(hk =>
            typeof hk === 'number'
              ? { agentId: hk, reignStartTick: 0, reignEndTick: 0, deathCause: null }
              : { agentId: hk.agent_id, reignStartTick: hk.reign_start_tick, reignEndTick: hk.reign_end_tick, deathCause: hk.death_cause || null }
          ),
          memberIds: r.member_ids || [],
          governedHouseholds: r.governed_households || [],
          currentReignStart: r.current_reign_start != null ? r.current_reign_start : null
        }));

        // ★ M4: 远征目标反查表 agent_id -> camp_id（从 regions.activeExpeditionAgents 反查）
        this.expeditionTargets = new Map();
        for (const r of this.regions) {
          for (const aid of r.activeExpeditionAgents) {
            this.expeditionTargets.set(aid, r.campId);
          }
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
