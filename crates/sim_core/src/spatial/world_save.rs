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
use std::collections::{BTreeMap, BTreeSet};

use crate::config::SimConfig;
use crate::geo::terrain::TerrainMap;
use crate::rng::WorldRng;
use super::agent::{Agent3D, AgentId};
use super::graph::LaneGraph3D;
use super::house::House;
use super::ledger::{ClanRegistry, HouseholdId, HouseholdRegistry, Ledger, MarriageRegistry, RegionRegistry};
use super::poi::PrimitivePoi;
use super::snapshot::Season;
use super::world::World3DEngine;

/// 存档格式版本（结构字段增删时自增；与旧版本不兼容时拒绝加载）
pub const SAVE_FORMAT_VERSION: u32 = 2;
/// 写入存档时附带的应用版本（仅供前端提示与人工排查，不作为加载门禁）
pub const SAVE_APP_VERSION: &str = "1.7.0";

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

    // ── 团体冷却表（保序 BTreeMap）──
    pub mutual_aid_cooldown: BTreeMap<HouseholdId, u64>,
    pub expedition_targets: BTreeMap<u32, u32>,
    pub relief_cooldown: BTreeMap<HouseholdId, u64>,
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
            mutual_aid_cooldown: self.mutual_aid_cooldown.clone(),
            expedition_targets: self.expedition_targets.clone(),
            relief_cooldown: self.relief_cooldown.clone(),
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
    let save: WorldSave =
        serde_json::from_str(json).map_err(|e| format!("存档解析失败: {}", e))?;

    if save.format_version != SAVE_FORMAT_VERSION {
        return Err(format!(
            "存档格式版本不兼容：存档为 v{}，当前内核仅支持 v{}（请导出新版本存档）",
            save.format_version, SAVE_FORMAT_VERSION
        ));
    }
    if save.grid_res == 0 || !save.world_size.is_finite() || save.world_size <= 0.0 {
        return Err("存档世界参数非法（grid_res 为 0 或 world_size 非正）".to_string());
    }

    // agent id 唯一性校验：重复 id 会让 agent_index 重建出错，宁可拒绝加载
    let mut seen: BTreeSet<AgentId> = BTreeSet::new();
    for agent in &save.agents {
        if !seen.insert(agent.id) {
            return Err(format!("存档数据损坏：agent #{} 重复出现", agent.id));
        }
    }

    // 地形按种子确定性重建（不消耗世界 RNG）
    let mut terrain = TerrainMap::new(save.grid_res, save.grid_res, save.world_size);
    terrain.generate_natural_landscape(save.seed);

    let mut world = World3DEngine {
        terrain,
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
        expedition_targets: save.expedition_targets,
        relief_cooldown: save.relief_cooldown,
    };

    // 派生索引必须重建，否则 agent_by_id() 返回错误下标或 panic
    world.rebuild_agent_index();
    Ok(world)
}
