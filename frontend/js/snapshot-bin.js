// === snapshot-bin.js · M4 FABS 二进制快照解码器 (v1.46.0) ===
// 将 sim_worker 转移来的 FABS 二进制帧（ArrayBuffer）解码为与 JSON 快照**逐字段同构**的 JS 对象，
// rustworld.js::_applySnapshot 无需任何下游改动即可直接消费。
//
// 帧格式契约见 crates/sim_core/src/spatial/snapshot_bin/layout.rs；
// 字段编码顺序见 crates/sim_core/src/spatial/snapshot_bin/encode.rs。
//
// ⚠️ 四处同步铁律：snapshot.rs → world_snapshot.rs → snapshot_bin/encode.rs → 本文件。
//    任何字段增删必须四处同步，否则前端读到 undefined。自动保障网 = tools/test-wasm.js 深比较断言。
//
// 解码产物与 JSON 快照的差异（rustworld 感知的 M4 增量接口）：
//   1. snap.geom_version (number) — 路网拓扑签名；(node_count << 32) | lane_count
//   2. snap.strtab_epoch   (number) — 字符串驻留表世代号（引擎重置时 +1，前端据此清缓存）
//   3. snap.lanes —— 仅当本帧携带 LANE_GEO 时为完整车道对象数组；否则为 null
//   4. snap.nodes —— 同上（null = 复用缓存）
//   5. snap.lane_wear  —— 恒为 Float32Array（与车道下标一一对应），rustworld 据此覆写缓存对象 wear
//   6. snap.terrain_cells —— 无地形帧为空数组 []（与 JSON 快照行为一致）

(function (global) {
  'use strict';

  var MAGIC0 = 0x46; // 'F'
  var FORMAT_VERSION = 1;
  var NONE_U32 = 0xffffffff;
  var NONE_F32_NAN = NaN;

  // Header 偏移（与 layout.rs 一致）
  var OFF_VERSION = 4;
  var OFF_FLAGS = 6;
  var OFF_TICK = 12;
  var OFF_GEOM_SIG = 20;
  var OFF_STRTAB_EPOCH = 28;
  var OFF_SEC_COUNT = 32;
  var HEADER_LEN = 40;
  var DIR_ENTRY_LEN = 16;

  // SectionKind（与 layout.rs 一致）
  var K = {
    GLOBAL: 1, AGENT: 2, POI: 3, HOUSE: 4, LANE_GEO: 5, LANE_WEAR: 6, NODE: 7, TERRAIN: 8,
    HOUSEHOLD: 9, MARRIAGE: 10, CLAN: 11, REGION: 12, EMPIRE: 13, GRANARY: 14, DEATH: 15,
    AUCTION_HIST: 16, STR_TAB: 17,
  };

  var _dec = new TextDecoder('utf-8'); // 全局仅用于字符串驻留表批量解码
  var _EN = null;               // 枚举名称表 { state:[...], ... }
  var _strCache = [];    // strid -> string（NONE_U32 不缓存）
  var _strEpoch = -1;           // 当前已同步的驻留表世代号

  // ────────────────────────────────────────────────
  // 字符串驻留表解码
  // ────────────────────────────────────────────────
  function clearStrings() {
    _strCache.length = 0;
    _strEpoch = -1;
  }

  // 全量解码 STR_TAB 增量区（一次性 UTF-8 解码 + 长度切分，比逐条 TextDecoder 快数倍）
  function feedStrTab(bytes, startOff, count) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var off = startOff;
    for (var i = 0; i < count; i++) {
      var len = dv.getUint32(off, true);
      off += 4;
      var id = _strCache.length;
      var s = _dec.decode(bytes.subarray(off, off + len));
      off += len;
      _strCache[id] = s;
    }
    return off;
  }

  // id -> string；NONE_U32 -> null
  function strOf(id) {
    if (id === NONE_U32 || id === undefined) return null;
    var s = _strCache[id];
    return s === undefined ? '' : s;
  }

  // ────────────────────────────────────────────────
  // 枚举查表
  // ────────────────────────────────────────────────
  function en(key, code) {
    if (!_EN) return '';
    var arr = _EN[key];
    return arr ? (arr[code] !== undefined ? arr[code] : '') : '';
  }

  // 热路径的普通 f32 保持直读；仅确实可能携带哨兵 Infinity 的库存字段按 serde_json 语义归一为 null。
  function finiteOrNull(v) {
    return (v === v && v !== Infinity && v !== -Infinity) ? v : null;
  }

  // ────────────────────────────────────────────────
  // 主解码入口
  // ────────────────────────────────────────────────
  // uint8: Uint8Array（worker 转移的二进制帧）
  // 返回值：与 JSON 快照同构的普通对象；magic/版本不符返回 null（上层回退 JSON）
  function decode(uint8) {
    if (!uint8 || !uint8.length) return null;
    if (uint8[0] !== MAGIC0 || uint8[1] !== 0x41 || uint8[2] !== 0x42 || uint8[3] !== 0x53) return null;
    var dv = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    if (dv.getUint16(OFF_VERSION, true) !== FORMAT_VERSION) return null;

    var flags = dv.getUint16(OFF_FLAGS, true);
    var tick = Number(dv.getBigUint64(OFF_TICK, true));
    var geomSig = Number(dv.getBigUint64(OFF_GEOM_SIG, true));
    var epoch = dv.getUint32(OFF_STRTAB_EPOCH, true);
    var secCount = dv.getUint16(OFF_SEC_COUNT, true);

    // 世代号变化 → 引擎重置过驻留表 → 清空本地字符串缓存
    if (_strEpoch !== epoch) {
      _strCache.length = 0;
      _strEpoch = epoch;
    }

    // Section 目录
    var dir = {};
    var dOff = HEADER_LEN;
    for (var i = 0; i < secCount; i++) {
      var kind = dv.getUint16(dOff, true);
      var o = dv.getUint32(dOff + 4, true);
      var c = dv.getUint32(dOff + 8, true);
      var bl = dv.getUint32(dOff + 12, true);
      dir[kind] = { o: o, c: c, bl: bl };
      dOff += DIR_ENTRY_LEN;
    }

    // 字符串驻留表必须先喂（记录中的 strid 依赖它）
    if (dir[K.STR_TAB]) {
      var st = dir[K.STR_TAB];
      var sr = readerAt(uint8, st.o, st.bl);
      var startIndex = sr.u32();
      var cnt = sr.u32();
      // ★ T1 跨世界缓存失效（v1.46.0）：`start_index === 0` 意味着「这是一张全新的
      //   驻留表」——新世界首帧、读档重建、容量超限 reset() 后首帧都必然为 0。
      //   此刻必须丢弃上一个世界的全部驻留结果，否则 strid→字符串整体串味
      //   （epoch 恒为 0，无法作为换世界的判据；实测曾让地名显示成上个世界的「穆/朱」，
      //    并导致 test-wasm 存读档确定性失败）。
      //   `startIndex !== _strCache.length` 是附带的失步兜底：增量与本地表对不上时
      //   宁可清空重来，也绝不把错位 id 映射成错误文本。
      if (startIndex === 0 || startIndex !== _strCache.length) _strCache.length = 0;
      feedStrTab(uint8, sr.off, cnt);
    }

    // M5-0 结论：帧间对象池化**已被实测否决**，本解码器恒产出全新对象。
    // ① 收益为负——V8 对短命对象的新生代（scavenge）回收比就地覆写更廉价，实测池化反而更慢；
    // ② 风险为正——池化会让上一帧的对象在下一次 decode 时被就地改写，任何跨帧持有快照
    //    引用的消费者（tools/ 的 sampleSnapshots、前端选中态等）都会读到「静默变异」的数据。
    // 故这里每帧都构造全新容器，`setReuse()` 仅为兼容旧调用点而保留的空操作。
    var snap = {
      tick: tick, geom_version: geomSig, strtab_epoch: epoch,
      terrain_cells: [], grid_w: 0, grid_h: 0, world_size: 0, tilt_angle_rad: 0, tilt_magnitude: 0,
      pois: [], houses: [], nodes: [], lanes: [], agents: [], households: [], marriages: [], clans: [],
      regions: [], empires: [], public_granary_balances: [],
      total_births: 0, total_deaths: 0, total_deaths_natural: 0, total_deaths_unnatural: 0,
      total_miscarriages: 0, total_households: 0, auction_started: 0, auction_sold: 0, auction_flopped: 0,
      total_royal_privy: 0, total_imperial_privy: 0, auction_history: [], season: 'Spring', temperature: 0,
      season_progress: 0, last_mutation_event: null, recent_deaths: [], water_regen_multiplier: 1,
      berry_regen_multiplier: 1, wood_regen_multiplier: 1, stone_regen_multiplier: 1, gold_regen_multiplier: 1,
      lane_wear: null,
    };
    snap.tick = tick;
    snap.geom_version = geomSig;
    snap.strtab_epoch = epoch;

    var sec = dir[K.GLOBAL];
    if (sec) {
      var gr = readerAt(uint8, sec.o, sec.bl);
      snap.grid_w = gr.u32();
      snap.grid_h = gr.u32();
      snap.world_size = gr.f32();
      snap.tilt_angle_rad = gr.f32();
      snap.tilt_magnitude = gr.f32();
      snap.season = en('season', gr.u8());
      snap.temperature = gr.f32();
      snap.season_progress = gr.f32();
      snap.total_births = gr.u32();
      snap.total_deaths = gr.u32();
      snap.total_deaths_natural = gr.u32();
      snap.total_deaths_unnatural = gr.u32();
      snap.total_miscarriages = gr.u32();
      snap.total_households = gr.u64();
      snap.auction_started = gr.u64();
      snap.auction_sold = gr.u64();
      snap.auction_flopped = gr.u64();
      snap.total_royal_privy = gr.f32();
      snap.total_imperial_privy = gr.f32();
      snap.water_regen_multiplier = gr.f32();
      snap.berry_regen_multiplier = gr.f32();
      snap.wood_regen_multiplier = gr.f32();
      snap.stone_regen_multiplier = gr.f32();
      snap.gold_regen_multiplier = gr.f32();
      snap.last_mutation_event = strOf(gr.u32());
    }

    if (dir[K.AGENT]) {
      var ar = readerAt(uint8, dir[K.AGENT].o, dir[K.AGENT].bl);
      for (var ai = 0; ai < dir[K.AGENT].c; ai++) {
        var a = {
          id: ar.u32(),
          gender: en('gender', ar.u8()),
          x: ar.f32(), y: ar.f32(), z: ar.f32(),
          age: ar.f32(),
          birth_tick: ar.u64(),
          heading_rad: ar.f32(),
          pitch_rad: ar.f32(),
          velocity: ar.f32(),
          carried_water: ar.f32(),
          carried_food: ar.f32(),
          carried_wood: ar.f32(),
          carried_stone: ar.f32(),
          carried_gold: ar.f32(),
          cumulative_mined: ar.f32(),
          cumulative_mined_water: ar.f32(),
          cumulative_mined_food: ar.f32(),
          cumulative_mined_wood: ar.f32(),
          cumulative_mined_stone: ar.f32(),
          cumulative_mined_gold: ar.f32(),
          cumulative_royal_privy: ar.f32(),
          cumulative_imperial_privy: ar.f32(),
          build_timer: ar.f32(),
          miscarriage_alert_timer: ar.f32(),
          state: en('state', ar.u8()),
          is_alive: ar.u8() === 1,
          hunger: ar.f32(),
          thirst: ar.f32(),
          stamina: ar.f32(),
          health: ar.f32(),
          max_health: ar.f32(),
          is_pregnant: ar.u8() === 1,
          pregnancy_progress: ar.f32(),
          pregnancy_child_id: ar.optU32(),
          is_fetus: ar.u8() === 1,
          miscarriage_cooldown: ar.f32(),
          postpartum_cooldown: ar.f32(),
          miscarriage_alert: ar.u8() === 1,
          death_decay_timer: ar.f32(),
          death_cause: strOf(ar.u32()),
          current_need: strOf(ar.u32()),
          is_covert: ar.u8() === 1,
          stealth_visibility: ar.f32(),
          home_house_id: ar.optU32(),
          generation: ar.u32(),
          spouse_id: ar.optU32(),
          mother_id: ar.optU32(),
          father_id: ar.optU32(),
          children_ids: ar.listU32(),
          intelligence: ar.f32(),
          strength: ar.f32(),
          digestion_efficiency: ar.f32(),
          libido: ar.f32(),
          sleep_efficiency: ar.f32(),
          life_expectancy: ar.f32(),
          surname: strOf(ar.u32()),
          prestige: ar.u32(),
          marriage_history_count: ar.u32(),
          household_id: ar.optU64(),
          household_role: en('householdRole', ar.u8()),
          arrival_tick: ar.u64(),
          is_on_expedition: ar.u8() === 1,
          expedition_target_camp: ar.optU32(),
          coronation_pending: ar.optU32(),
          courtship_target_id: ar.optU32(),
          family_stock_active: [ar.u8() === 1, ar.u8() === 1, ar.u8() === 1, ar.u8() === 1, ar.u8() === 1],
        };
        snap.agents.push(a);
      }
    }

    if (dir[K.POI]) {
      var pr = readerAt(uint8, dir[K.POI].o, dir[K.POI].bl);
      for (var pi = 0; pi < dir[K.POI].c; pi++) {
        var p = {
          id: pr.u32(),
          poi_type: en('poiType', pr.u8()),
          x: pr.f32(), y: pr.f32(), z: pr.f32(),
          current_stock: finiteOrNull(pr.f32()),
          max_stock: finiteOrNull(pr.f32()),
          regen_rate: pr.f32(),
          secondary_stock: pr.f32(),
          secondary_max_stock: pr.f32(),
          secondary_regen_rate: pr.f32(),
          tertiary_stock: pr.f32(),
          tertiary_max_stock: pr.f32(),
          tertiary_regen_rate: pr.f32(),
          water_price: pr.f32(),
          food_price: pr.f32(),
          wood_price: pr.f32(),
          cumulative_sold_water: pr.f32(),
          cumulative_sold_food: pr.f32(),
          cumulative_sold_wood: pr.f32(),
          cumulative_revenue: pr.f32(),
          name: strOf(pr.u32()),
          camp_title: strOf(pr.u32()),
          level: pr.u8(),
          bound_houses: pr.u32(),
        };
        // 空置房屋列表
        var vc = pr.u16();
        p.vacant_houses = [];
        for (var vi = 0; vi < vc; vi++) {
          var house_id = pr.u32();
          p.vacant_houses.push({ house_id: house_id, beneficiary_ids: pr.listU32() });
        }
        // 榷场交易流水
        var tc = pr.u16();
        p.market_trades = [];
        for (var ti = 0; ti < tc; ti++) {
          p.market_trades.push({
            tick: pr.u64(),
            agent_id: pr.u32(),
            household_id: pr.optU64(),
            resource: strOf(pr.u32()),
            amount: pr.f32(),
            unit_price: pr.f32(),
            gold_cost: pr.f32(),
          });
        }
        snap.pois.push(p);
      }
    }

    if (dir[K.HOUSE]) {
      var hr = readerAt(uint8, dir[K.HOUSE].o, dir[K.HOUSE].bl);
      for (var hi = 0; hi < dir[K.HOUSE].c; hi++) {
        var h = {
          id: hr.u32(),
          owner_id: hr.optU32(),
          spouse_id: hr.optU32(),
          camp_id: hr.u32(),
          x: hr.f32(), y: hr.f32(), z: hr.f32(),
          tier: en('houseTier', hr.u8()),
          durability: hr.f32(),
          age: hr.f32(),
          construction_progress: hr.f32(),
          is_repairing: hr.u8() === 1,
          builder_id: hr.u32(),
          last_upgrader_id: hr.optU32(),
          auction_phase: strOf(hr.u32()),
          benchmark_bid: hr.f32(),
          highest_bid: hr.f32(),
          bids_count: hr.u32(),
          last_deal_price: hr.optF32(),
          last_deal_tick: hr.optU64(),
          auction_start_durability: hr.optF32(),
        };
        var bcid = hr.u16();
        h.recent_bids = [];
        for (var bi = 0; bi < bcid; bi++) {
          h.recent_bids.push({
            tick: hr.u64(),
            bidder_id: hr.u32(),
            amount: hr.f32(),
            phase: strOf(hr.u32()),
          });
        }
        var dcid = hr.u16();
        h.recent_deals = [];
        for (var di = 0; di < dcid; di++) {
          h.recent_deals.push({
            tick: hr.u64(),
            buyer_id: hr.u32(),
            price: hr.f32(),
            durability: hr.f32(),
            reason: strOf(hr.u32()),
          });
        }
        snap.houses.push(h);
      }
    }

    // ---- 车道：LANE_Wear 恒在；LANE_GEO 仅增量帧携带 ----
    if (dir[K.LANE_WEAR]) {
      var lw = dir[K.LANE_WEAR];
      // LANE_WEAR 是 4 字节对齐的连续 f32 → 零拷贝 Float32Array 视图
      snap.lane_wear = new Float32Array(uint8.buffer, uint8.byteOffset + lw.o, lw.c);
    }
    if (dir[K.LANE_GEO]) {
      var lgr = readerAt(uint8, dir[K.LANE_GEO].o, dir[K.LANE_GEO].bl);
      snap.lanes = [];
      for (var li = 0; li < dir[K.LANE_GEO].c; li++) {
        var v3 = function () { return { x: lgr.f32(), y: lgr.f32(), z: lgr.f32() }; };
        snap.lanes.push({
          id: lgr.u32(),
          from: lgr.u32(),
          to: lgr.u32(),
          p0: v3(), p1: v3(), p2: v3(), p3: v3(),
          road_class: en('roadClass', lgr.u8()),
          speed_limit: lgr.f32(),
          is_hidden: lgr.u8() === 1,
          concealment: lgr.f32(),
          wear: 0, // 占位；下面按 index 从 LANE_WEAR 补齐
        });
      }
      // LANE_WEAR 与 LANE_GEO 同序（均来自 edge_indices），按 index 补 wear
      if (snap.lane_wear && snap.lane_wear.length === snap.lanes.length) {
        for (var lwi = 0; lwi < snap.lanes.length; lwi++) snap.lanes[lwi].wear = snap.lane_wear[lwi];
      }
    } else {
      snap.lanes = null; // 无几何 → rustworld 复用缓存
    }

    if (dir[K.NODE]) {
      var nr = readerAt(uint8, dir[K.NODE].o, dir[K.NODE].bl);
      snap.nodes = [];
      for (var ni = 0; ni < dir[K.NODE].c; ni++) {
        snap.nodes.push({
          id: nr.u32(),
          x: nr.f32(), y: nr.f32(), z: nr.f32(),
          node_type: en('nodeType', nr.u8()),
        });
      }
    } else {
      snap.nodes = null; // 无拓扑 → rustworld 复用缓存
    }

    if (dir[K.TERRAIN]) {
      var tr = readerAt(uint8, dir[K.TERRAIN].o, dir[K.TERRAIN].bl);
      var cells = new Array(dir[K.TERRAIN].c);
      for (var ci = 0; ci < dir[K.TERRAIN].c; ci++) {
        cells[ci] = { elevation: tr.f32(), slope_angle: tr.f32() };
      }
      snap.terrain_cells = cells;
    }

    if (dir[K.HOUSEHOLD]) {
      var hr2 = readerAt(uint8, dir[K.HOUSEHOLD].o, dir[K.HOUSEHOLD].bl);
      for (var hhi = 0; hhi < dir[K.HOUSEHOLD].c; hhi++) {
        var hh = {
          id: hr2.u64(),
          head: hr2.u32(),
          members: hr2.listU32(),
          balances: readBalances(hr2),
          parent_household: hr2.optU64(),
          founded_tick: hr2.u64(),
          is_dissolved: hr2.u8() === 1,
          recent_events: readEvents(hr2),
          recent_journal: readJournal(hr2),
        };
        snap.households.push(hh);
      }
    }

    if (dir[K.MARRIAGE]) {
      var mr = readerAt(uint8, dir[K.MARRIAGE].o, dir[K.MARRIAGE].bl);
      for (var mi = 0; mi < dir[K.MARRIAGE].c; mi++) {
        snap.marriages.push({
          id: mr.u64(),
          husband_id: mr.u32(),
          wife_id: mr.u32(),
          start_tick: mr.u64(),
          end_tick: mr.optU64(),
          end_reason: strOf(mr.u32()),
          is_active: mr.u8() === 1,
        });
      }
    }

    if (dir[K.CLAN]) {
      var cr = readerAt(uint8, dir[K.CLAN].o, dir[K.CLAN].bl);
      for (var cli = 0; cli < dir[K.CLAN].c; cli++) {
        var cl = {
          surname: strOf(cr.u32()),
          leader_id: cr.optU32(),
          member_count: cr.u32(),
        };
        cl.member_ids = cr.listU32();
        cl.balances = readBalances(cr);
        cl.recent_journal = readJournal(cr);
        cl.recent_events = readEvents(cr);
        cl.is_extinct = cr.u8() === 1;
        snap.clans.push(cl);
      }
    }

    if (dir[K.REGION]) {
      var rr = readerAt(uint8, dir[K.REGION].o, dir[K.REGION].bl);
      for (var rgi = 0; rgi < dir[K.REGION].c; rgi++) {
        var rg = {
          camp_id: rr.u32(),
          camp_name: strOf(rr.u32()),
          king_id: rr.optU32(),
          regime: strOf(rr.u32()),
          succession: strOf(rr.u32()),
          member_count: rr.u32(),
          arrival_order: rr.listU32(),
          heir_candidates: rr.listU32(),
          balances: readBalances(rr),
          recent_journal: readJournal(rr),
          recent_events: readEvents(rr),
          active_expedition_agents: rr.listU32(),
        };
        var hkc = rr.u16();
        rg.history_kings = [];
        for (var hki = 0; hki < hkc; hki++) {
          rg.history_kings.push({
            agent_id: rr.u32(),
            reign_start_tick: rr.u64(),
            reign_end_tick: rr.u64(),
            death_cause: strOf(rr.u32()),
          });
        }
        rr.u32(); // member_id count（与 list 冗余）
        rg.member_ids = rr.listU32();
        rg.governed_households = rr.listU64();
        rg.current_reign_start = rr.optU64();
        rg.cumulative_royal_privy = rr.f32();
        snap.regions.push(rg);
      }
    }

    if (dir[K.EMPIRE]) {
      var er2 = readerAt(uint8, dir[K.EMPIRE].o, dir[K.EMPIRE].bl);
      for (var ei = 0; ei < dir[K.EMPIRE].c; ei++) {
        var em = {
          empire_id: er2.u32(),
          regime: strOf(er2.u32()),
          head_title: strOf(er2.u32()),
          emperor_id: er2.optU32(),
          member_camp_ids: er2.listU32(),
          member_count: er2.u32(),
          king_candidates: er2.listU32(),
          balances: readBalances(er2),
          recent_journal: readJournal(er2),
          recent_events: readEvents(er2),
          current_reign_start: er2.optU64(),
          cumulative_imperial_privy: er2.f32(),
        };
        snap.empires.push(em);
      }
    }

    if (dir[K.GRANARY]) {
      var gr2 = readerAt(uint8, dir[K.GRANARY].o, dir[K.GRANARY].bl);
      snap.public_granary_balances = readBalances(gr2);
    }

    if (dir[K.DEATH]) {
      var dr = readerAt(uint8, dir[K.DEATH].o, dir[K.DEATH].bl);
      for (var dxi = 0; dxi < dir[K.DEATH].c; dxi++) {
        snap.recent_deaths.push({
          id: dr.u32(),
          cause: strOf(dr.u32()),
          is_natural: dr.u8() === 1,
          is_fetus: dr.u8() === 1,
          father_id: dr.optU32(),
          mother_id: dr.optU32(),
          tick: dr.u64(),
        });
      }
    }

    if (dir[K.AUCTION_HIST]) {
      var ahr = readerAt(uint8, dir[K.AUCTION_HIST].o, dir[K.AUCTION_HIST].bl);
      for (var ahi = 0; ahi < dir[K.AUCTION_HIST].c; ahi++) {
        snap.auction_history.push({
          tick: ahr.u64(),
          house_id: ahr.u32(),
          tier: strOf(ahr.u32()),
          camp_id: ahr.u32(),
          durability: ahr.f32(),
          is_flop: ahr.u8() === 1,
          buyer_id: ahr.optU32(),
          price: ahr.f32(),
          total_bids_count: ahr.u32(),
          reason: strOf(ahr.u32()),
        });
      }
    }

    return snap;
  }

  // ────────────────────────────────────────────────
  // 子结构解码助手（返回与 JSON 快照同构的形状）
  // ────────────────────────────────────────────────
  function readBalances(r) {
    var out = [];
    for (var i = 0; i < 5; i++) {
      out.push({ resource: en('resourceKind', i), amount: r.f32() });
    }
    return out;
  }

  function readEvents(r) {
    var n = r.u16();
    var out = [];
    for (var i = 0; i < n; i++) out.push(strOf(r.u32()));
    return out;
  }

  function readJournal(r) {
    var n = r.u16();
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({
        tick: r.u64(),
        resource: en('resourceKind', r.u8()),
        amount: r.f32(),
        from: strOf(r.u32()),
        to: strOf(r.u32()),
        reason: en('transferReason', r.u8()),
      });
    }
    return out;
  }

  // ────────────────────────────────────────────────
  // 顺序流读取器（DataView 小端）
  // ────────────────────────────────────────────────
  function readerAt(bytes, offset, byteLen) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var off = offset;
    var end = offset + byteLen;
    return {
      // 当前偏移（STRING 表增量需读取绝对位置）
      get off() { return off; },
      u8: function () { if (off >= end) return 0; return dv.getUint8(off++); },
      u16: function () { var v = dv.getUint16(off, true); off += 2; return v; },
      u32: function () { var v = dv.getUint32(off, true); off += 4; return v; },
      u64: function () { var lo = dv.getUint32(off, true), hi = dv.getUint32(off + 4, true); off += 8; return lo + hi * 4294967296; },
      // 普通 f32 按 serde_json 语义读取：非有限值（±Infinity/NaN）→ null（与 JSON 通道逐字段一致）
      f32: function () { var v = dv.getFloat32(off, true); off += 4; return v; },
      optU32: function () { var v = dv.getUint32(off, true); off += 4; return v === NONE_U32 ? null : v; },
      optU64: function () { var lo = dv.getUint32(off, true), hi = dv.getUint32(off + 4, true); off += 8; return (lo === NONE_U32 && hi === NONE_U32) ? null : lo + hi * 4294967296; },
      optF32: function () { var v = dv.getFloat32(off, true); off += 4; return v !== v ? null : v; },
      listU32: function () { var n = dv.getUint16(off, true); off += 2; var a = new Array(n); for (var i = 0; i < n; i++) { a[i] = dv.getUint32(off, true); off += 4; } return a; },
      listU64: function () { var n = dv.getUint16(off, true); off += 2; var a = new Array(n); for (var i = 0; i < n; i++) { a[i] = dv.getUint32(off, true) + dv.getUint32(off + 4, true) * 4294967296; off += 8; } return a; },
    };
  }

  var SnapshotBin = {
    FORMAT_VERSION: FORMAT_VERSION,
    // 注入枚举名称表（worker INIT 时随 READY 下发；失败或缺省时解码出的枚举为 ''，可被 JSON 回退覆盖）
    setEnumTables: function (jsonStr) {
      try {
        _EN = JSON.parse(jsonStr);
      } catch (e) {
        _EN = null;
      }
    },
    decode: decode,
    // M5-0：保留调用契约的空操作。帧间对象池化已实测否决（理由见 decode() 内注释），
    // 本解码器恒产出全新对象，浏览器与 tools/ 从此走同一条高性能解码路径。
    setReuse: function () { /* no-op：恒为「不复用」 */ },
    resetCaches: function () {
      clearStrings();
    },
    // 供 rustworld 快速读取车道 wear（调试/无 geo 场景可能用到）
    _strOf: strOf,
  };

  global.SnapshotBin = SnapshotBin;
})(typeof window !== 'undefined' ? window : this);
