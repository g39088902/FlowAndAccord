//! world_save.rs · 世界全量状态存档契约（读档/存档系统）
//!
//! 设计原则（改本文件前必读）：
//! 1. **可重建字段一律不入库**：
//!    - `terrain` 完全由 `seed` 确定性生成 → 只存 seed，读档时重建（省 3600 栅格体积）
//!    - `agent_index` 是 AgentId → Vec 下标的派生索引 → 读档后 `rebuild_agent_index()` 重建
//! 2. **强确定性**：RNG 内部状态、每名 agent 的施密特触发器与私有冷却、全部账本流水与
//!    登记簿、路网磨损、发号器、计数器、季节温度全部入档。读档后继续 tick 与
//!    「从不中断连续跑到同一 tick」逐字节一致（`tools/test-wasm.js` 校验）。
//! 3. **版本不兼容明确报错**：格式版本或应用版本不符时返回 Err，绝不静默降级加载。
//! 4. 集合一律 BTreeMap / Vec 保序，反序列化忠实还原遍历顺序（确定性红线）。

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

use super::agent::{Agent3D, AgentId};
use super::graph::LaneGraph3D;
use super::house::{House, HouseAuctionHistoryRecord};
use super::ledger::{
    ClanRegistry, EmpireRegistry, HouseholdId, HouseholdRegistry, Ledger, MarriageRegistry,
    RegionRegistry,
};
use super::poi::PrimitivePoi;
use super::snapshot::Season;
use super::world::World3DEngine;
use crate::config::SimConfig;
use crate::geo::terrain::{TerrainMap, TERRAIN_GENERATOR_VERSION, TERRAIN_PROFILE_MOUNTAIN_PASS};
use crate::rng::WorldRng;

/// 存档格式版本（结构字段增删时自增；与旧版本不兼容时拒绝加载）
/// v1.12.0: history_kings 从 Vec<AgentId> 改为 Vec<HistoryKing>（含在位时长与死因），不兼容旧档
/// v1.44.7: 新增帝国登记簿与帝国公帑结算状态，不兼容旧档
/// v1.46.12：BranchId 收敛为 16 条（b11→b8，b15→采购策略），不兼容旧活动任务枚举。
pub const SAVE_FORMAT_VERSION: u32 = 7;
/// 存档应用版本（加载门禁 ★ v1.37.1 起：版本变更自动废弃旧档）
///
/// ★★ v1.50.80 版本策略（三段的语义分工，与 `docs/current/tech/06-snapshot-and-save.md` §2.4 同源）：
///   版本号 `major.minor.patch` = `1.50.80`，本常量只存**兼容线** `major.minor` 两段：
///   - `patch`（末尾）：前端渲染 / 表现层优化等**不改存档与数值逻辑**的变更 —— 本常量不动，
///     于是无需重编译 WASM，旧存档继续可加载；
///   - `minor`（中间）：功能变化 / 数值逻辑变化 / 存档结构不兼容 —— 本常量随之推进
///     （由 `tools/bump-version.js --minor` 同步），旧存档自动废弃，**必须**重编译 WASM；
///   - `major`（首位）：仅人工变更。
///   兼容判定经 `app_version_compat_line` 取前两段比对 ⇒ **历史三段串档案（如 `1.50.79`）
///   与本常量 `1.50` 同线**，不必因末尾升版而重开世界。
pub const SAVE_APP_VERSION: &str = "1.60";

/// 取应用版本字符串的**兼容线**（前两段，去可选 `v`/`V` 前缀与空白）。
///
/// `1.50.79` / `v1.50.79` / `1.50` → `"1.50"`；不足两段或非法串按原样返回（保守：判定为不等）。
pub fn app_version_compat_line(v: &str) -> String {
    let t = v.trim().trim_start_matches(|c| c == 'v' || c == 'V');
    let mut it = t.split('.');
    match (it.next(), it.next()) {
        (Some(a), Some(b)) if !a.is_empty() && !b.is_empty() => format!("{}.{}", a, b),
        _ => t.to_string(),
    }
}


fn default_terrain_generator_version() -> u32 {
    TERRAIN_GENERATOR_VERSION
}

fn default_terrain_profile() -> String {
    TERRAIN_PROFILE_MOUNTAIN_PASS.to_string()
}

/// 存档契约：世界全量可持久化状态
///
/// 字段与 `World3DEngine` 一一对应，仅排除 `terrain`（按 seed 重建）与
/// `agent_index`（派生索引）。新增引擎字段时**必须**同步此处，否则读档丢状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldSave {
    // ── 存档元信息 ──
    /// 存档格式版本（加载门禁）
    pub format_version: u32,
    /// 写入存档时的应用版本（仅提示）
    pub app_version: String,

    // ── 世界重建参数 ──
    /// 世界随机种子（地形与初始生态的确定性来源）
    pub seed: u64,
    /// 地形栅格分辨率（如 60）
    pub grid_res: usize,
    /// 世界物理跨度（米，如 764.0）
    pub world_size: f32,
    /// 地形生成器版本；与 profile 一起防止旧路网和新地貌静默拼接。
    #[serde(default = "default_terrain_generator_version")]
    pub terrain_generator_version: u32,
    /// 地形 profile，例如 mountain_pass_v1。
    #[serde(default = "default_terrain_profile")]
    pub terrain_profile: String,
    pub terrain_state: TerrainMap,
    pub water_pools: Vec<crate::geo::hydrology::WaterPool>,

    // ── 基础实体 ──
    pub network: LaneGraph3D,
    pub pois: Vec<PrimitivePoi>,
    pub houses: Vec<House>,
    pub agents: Vec<Agent3D>,

    // ── 发号器 ──
    pub next_agent_id: AgentId,
    pub next_house_id: u32,

    // ── 统计计数器 ──
    pub total_births: u32,
    pub total_deaths: u32,
    pub total_deaths_natural: u32,
    pub total_deaths_unnatural: u32,
    pub total_miscarriages: u32,

    // ── 四季与环境 ──
    pub season_timer: f32,
    pub current_season: Season,
    pub temperature: f32,
    #[serde(default)]
    pub el_nino_phase: f32,
    #[serde(default)]
    pub climate_epoch_phase: f32,

    // ── 全局 RNG 内部状态（确定性核心）──
    pub rng: WorldRng,

    // ── 生态再生倍率 ──
    pub water_regen_multiplier: f32,
    pub berry_regen_multiplier: f32,
    pub wood_regen_multiplier: f32,
    pub stone_regen_multiplier: f32,
    pub gold_regen_multiplier: f32,

    // ── 世界时钟与最近事件 ──
    pub tick_counter: u64,
    pub last_event: Option<String>,

    // ── 运行期配置（读档沿用存档时的配置，避免热注入改动破坏续演语义）──
    pub config: SimConfig,

    // ── 社会制度登记簿与账本 ──
    pub marriage_registry: MarriageRegistry,
    pub household_registry: HouseholdRegistry,
    pub public_granary: Ledger,
    pub clan_registry: ClanRegistry,
    pub region_registry: RegionRegistry,
    #[serde(default)]
    pub empire_registry: EmpireRegistry,

    // ── 团体冷却表（保序 BTreeMap）──
    pub mutual_aid_cooldown: BTreeMap<HouseholdId, u64>,
    pub relief_cooldown: BTreeMap<HouseholdId, u64>,
    #[serde(default)]
    pub auction_started: u64,
    #[serde(default)]
    pub auction_sold: u64,
    #[serde(default)]
    pub auction_flopped: u64,
    #[serde(default)]
    pub auction_history: VecDeque<HouseAuctionHistoryRecord>,
    #[serde(default)]
    pub last_royal_payout_tick: u64,
    #[serde(default)]
    pub last_imperial_payout_tick: u64,
}

impl World3DEngine {
    /// 导出当前世界为存档契约（不含可重建字段）
    pub fn to_save(&self) -> WorldSave {
        WorldSave {
            format_version: SAVE_FORMAT_VERSION,
            app_version: SAVE_APP_VERSION.to_string(),
            seed: self.terrain.seed,
            grid_res: self.terrain.grid_width,
            world_size: self.terrain.world_size,
            terrain_generator_version: self.terrain.generator_version,
            terrain_profile: self.terrain.profile.clone(),
            terrain_state: self.terrain.clone(),
            water_pools: self.water_pools.clone(),
            network: self.network.clone(),
            pois: self.pois.clone(),
            houses: self.houses.clone(),
            agents: self.agents.clone(),
            next_agent_id: self.next_agent_id,
            next_house_id: self.next_house_id,
            total_births: self.total_births,
            total_deaths: self.total_deaths,
            total_deaths_natural: self.total_deaths_natural,
            total_deaths_unnatural: self.total_deaths_unnatural,
            total_miscarriages: self.total_miscarriages,
            season_timer: self.season_timer,
            current_season: self.current_season,
            temperature: self.temperature,
            el_nino_phase: self.el_nino_phase,
            climate_epoch_phase: self.climate_epoch_phase,
            rng: self.rng,
            water_regen_multiplier: self.water_regen_multiplier,
            berry_regen_multiplier: self.berry_regen_multiplier,
            wood_regen_multiplier: self.wood_regen_multiplier,
            stone_regen_multiplier: self.stone_regen_multiplier,
            gold_regen_multiplier: self.gold_regen_multiplier,
            tick_counter: self.tick_counter,
            last_event: self.last_event.clone(),
            config: self.config.clone(),
            marriage_registry: self.marriage_registry.clone(),
            household_registry: self.household_registry.clone(),
            public_granary: self.public_granary.clone(),
            clan_registry: self.clan_registry.clone(),
            region_registry: self.region_registry.clone(),
            empire_registry: self.empire_registry.clone(),
            mutual_aid_cooldown: self.mutual_aid_cooldown.clone(),
            relief_cooldown: self.relief_cooldown.clone(),
            auction_started: self.auction_started,
            auction_sold: self.auction_sold,
            auction_flopped: self.auction_flopped,
            auction_history: self.auction_history.clone(),
            last_royal_payout_tick: self.last_royal_payout_tick,
            last_imperial_payout_tick: self.last_imperial_payout_tick,
        }
    }
}

/// 将当前世界序列化为存档 JSON 字符串
pub fn serialize_save(world: &World3DEngine) -> Result<String, String> {
    serde_json::to_string(&world.to_save()).map_err(|e| format!("存档序列化失败: {}", e))
}

/// 由存档 JSON 字符串还原世界（校验版本 → 重建地形 → 重建 agent 索引）
///
/// 返回 Err 时**绝不**部分替换世界状态，调用方应保持原世界继续运行。
pub fn deserialize_save(json: &str) -> Result<World3DEngine, String> {
    let save: WorldSave = serde_json::from_str(json).map_err(|e| format!("存档解析失败: {}", e))?;

    if save.format_version != SAVE_FORMAT_VERSION {
        return Err(format!(
            "存档格式版本不兼容：存档为 v{}，当前内核仅支持 v{}（请导出新版本存档）",
            save.format_version, SAVE_FORMAT_VERSION
        ));
    }
    // ★ v1.50.80：改按「兼容线」比对（前两段），末尾版本号差异不再判为不兼容 ——
    //   旧存档写的是历史三段串（如 `1.50.79`），兼容线同为 `1.50` ⇒ 可继续加载。
    if app_version_compat_line(&save.app_version) != app_version_compat_line(SAVE_APP_VERSION) {
        return Err(format!(
            "存档应用版本不兼容：存档为 v{}，当前内核兼容线 v{}（中间版本号变更已自动废弃旧档）",
            save.app_version, SAVE_APP_VERSION
        ));
    }
    if save.grid_res == 0 || !save.world_size.is_finite() || save.world_size <= 0.0 {
        return Err("存档世界参数非法（grid_res 为 0 或 world_size 非正）".to_string());
    }
    if save.terrain_generator_version != TERRAIN_GENERATOR_VERSION {
        return Err(format!(
            "地形生成器版本不兼容：存档为 v{}，当前内核为 v{}",
            save.terrain_generator_version, TERRAIN_GENERATOR_VERSION
        ));
    }
    // ★ STAGE2-7：flat_baseline 为显式诊断/降级基线，支持保存/加载与续演
    //  （STAGE2-5 有界回退环的降级产物必须可复演）。
    // ★ S7-10：阶段七新 profile 全链路验收收口后正式入列白名单
    //  （grassland_plain_v1 / hillside_woodland_v1；原 river_valley_settlement_v1
    //  已随 v1.50.68 砍需求删除，plateau 更名为 plateau_v1）。
    if save.terrain_profile != TERRAIN_PROFILE_MOUNTAIN_PASS
        && save.terrain_profile != crate::geo::terrain::TERRAIN_PROFILE_RIVER_VALLEY
        && save.terrain_profile != crate::geo::terrain::TERRAIN_PROFILE_FLAT_BASELINE
        && save.terrain_profile != crate::geo::terrain::TERRAIN_PROFILE_GRASSLAND_PLAIN
        && save.terrain_profile != crate::geo::terrain::TERRAIN_PROFILE_HILLSIDE_WOODLAND
        && save.terrain_profile != crate::geo::terrain::TERRAIN_PROFILE_PLATEAU
        // ★ TB-03：静水/干沟三新模板入列白名单（同次交付 §7.4 快照/存档同步清单）
        && save.terrain_profile != crate::geo::terrain::TERRAIN_PROFILE_ALLUVIAL_FAN
        && save.terrain_profile != crate::geo::terrain::TERRAIN_PROFILE_BASIN_OASIS
        && save.terrain_profile != crate::geo::terrain::TERRAIN_PROFILE_VOLCANIC_LAKE
    {
        return Err(format!("地形 profile 不受支持：{}", save.terrain_profile));
    }

    // agent id 唯一性校验：重复 id 会让 agent_index 重建出错，宁可拒绝加载
    let mut seen: BTreeSet<AgentId> = BTreeSet::new();
    for agent in &save.agents {
        if !seen.insert(agent.id) {
            return Err(format!("存档数据损坏：agent #{} 重复出现", agent.id));
        }
    }

    // 地形按种子确定性重建（不消耗世界 RNG）
    let terrain = save.terrain_state;
    if terrain.profile != save.terrain_profile || terrain.generator_version != save.terrain_generator_version || terrain.cells.len()!=terrain.grid_width*terrain.grid_height { return Err("存档地形不一致".into()); }
    // §5.2 稳定 ID 契约：加载时校验 sub_features 升序且唯一（D-B1-2）
    terrain.validate_sub_features_sorted_unique()?;

    let mut world = World3DEngine {
        terrain,
        water_pools: save.water_pools,
        network: save.network,
        pois: save.pois,
        houses: save.houses,
        agents: save.agents,
        next_agent_id: save.next_agent_id,
        next_house_id: save.next_house_id,
        total_births: save.total_births,
        total_deaths: save.total_deaths,
        total_deaths_natural: save.total_deaths_natural,
        total_deaths_unnatural: save.total_deaths_unnatural,
        total_miscarriages: save.total_miscarriages,
        season_timer: save.season_timer,
        current_season: save.current_season,
        temperature: save.temperature,
        el_nino_phase: save.el_nino_phase,
        climate_epoch_phase: save.climate_epoch_phase,
        rng: save.rng,
        water_regen_multiplier: save.water_regen_multiplier,
        berry_regen_multiplier: save.berry_regen_multiplier,
        wood_regen_multiplier: save.wood_regen_multiplier,
        stone_regen_multiplier: save.stone_regen_multiplier,
        gold_regen_multiplier: save.gold_regen_multiplier,
        tick_counter: save.tick_counter,
        last_event: save.last_event,
        // ★ v1.8.7 死亡/流产墓碑为瞬态字段，不入存档；读档后从空累积
        recent_deaths: Vec::new(),
        config: save.config,
        agent_index: std::collections::HashMap::new(),
        marriage_registry: save.marriage_registry,
        household_registry: save.household_registry,
        public_granary: save.public_granary,
        clan_registry: save.clan_registry,
        mutual_aid_cooldown: save.mutual_aid_cooldown,
        region_registry: save.region_registry,
        empire_registry: save.empire_registry,
        relief_cooldown: save.relief_cooldown,
        auction_started: save.auction_started,
        auction_sold: save.auction_sold,
        auction_flopped: save.auction_flopped,
        auction_history: save.auction_history,
        last_royal_payout_tick: save.last_royal_payout_tick,
        last_imperial_payout_tick: save.last_imperial_payout_tick,
        terrain_dirty: std::cell::Cell::new(true),
        regions_arrival_dirty: true,
        strtab: std::cell::RefCell::new(super::snapshot_bin::StrTab::new()),
        last_geom_sig: std::cell::Cell::new(u64::MAX),
        creation_diagnostic: None,
    };

    // 派生索引必须重建，否则 agent_by_id() 返回错误下标或 panic
    world.rebuild_agent_index();
    if world.household_registry.active_households.is_empty()
        && !world.household_registry.households.is_empty()
    {
        world.household_registry.rebuild_active_households();
    }
    // ★ H-02 缺字段容错：若载入的旧存档缺少激素数据，依据身体属性补齐初始基线
    for agent in &mut world.agents {
        agent.hormones.initialize_with_config(
            agent.gender,
            agent.age,
            agent.is_pregnant,
            &world.config,
        );
    }
    world.validate_terrain_world()?;
    Ok(world)
}
