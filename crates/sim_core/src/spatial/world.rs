use crate::rng::WorldRng;
use crate::config::{SimConfig, LEDGER_JOURNAL_CAPACITY};
use std::collections::HashMap;
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, NodeId};
use super::agent::{Agent3D, AgentId};
use super::poi::{PrimitivePoi, PoiType};
use super::house::House;
use super::ledger::{ClanRegistry, HouseholdId, HouseholdRegistry, Ledger, MarriageRegistry, RegionRegistry};
use super::snapshot::{RecentDeathSnapshot, Season};
use crate::geo::terrain::TerrainMap;

/// 3D 空间世界与原始生态生存繁衍仿真管理器
///
/// 本文件仅保留结构体定义、构造函数与通用工具方法。
/// 业务逻辑按职责拆分到同目录子文件：
/// - `world_tick.rs`：tick 管线调度（§4.3 固定顺序）+ 胎儿对账 + 金币继承
/// - `world_snapshot.rs`：`generate_snapshot()` 快照生成
/// - `world_config.rs`：配置注入与反序列化
/// - `world_season.rs`：四季温度计算
pub struct World3DEngine {
    pub terrain: TerrainMap,
    pub network: LaneGraph3D,
    pub pois: Vec<PrimitivePoi>,
    pub houses: Vec<House>,
    pub agents: Vec<Agent3D>,
    pub next_agent_id: AgentId,
    pub next_house_id: u32,
    pub total_births: u32,
    pub total_deaths: u32,
    /// 自然死亡计数 (寿终正寝 / 寿命耗尽)
    pub total_deaths_natural: u32,
    /// 非自然死亡计数 (饥荒饿死 / 脱水渴死等外部原因)
    pub total_deaths_unnatural: u32,
    pub total_miscarriages: u32,
    pub season_timer: f32,
    pub current_season: Season,
    pub temperature: f32,
    pub rng: WorldRng,
    pub water_regen_multiplier: f32,
    pub berry_regen_multiplier: f32,
    pub wood_regen_multiplier: f32,
    pub stone_regen_multiplier: f32,
    pub gold_regen_multiplier: f32,
    pub tick_counter: u64,
    pub last_event: Option<String>,
    /// ★ v1.8.7 死亡/流产墓碑（滑动窗口，随快照输出；前端据此补记档案库死因/胎儿入档）
    pub recent_deaths: Vec<RecentDeathSnapshot>,
    pub config: SimConfig,
    /// AgentId → agents Vec 下标的快速查找索引；Vec 结构变更后需调用 rebuild_agent_index() 刷新
    pub agent_index: HashMap<AgentId, usize>,
    /// ★ 婚姻登记簿（只记两性关系与历史；家庭账本不在婚姻下）
    pub marriage_registry: MarriageRegistry,
    /// ★ 家户登记簿（**家庭跟着男人走**：以男性户主为锚的家庭单元与账本）
    pub household_registry: HouseholdRegistry,

    /// ★ M2 公仓兜底账本（绝嗣家户资产归集，预留 M4 Region 对接）
    pub public_granary: Ledger,
    /// ★ M3 宗族登记簿（按姓氏聚合的宗族团体与账本）
    pub clan_registry: ClanRegistry,
    /// ★ M3 族内互助冷却记录（每家户上次接受互助的 tick）
    pub mutual_aid_cooldown: std::collections::BTreeMap<HouseholdId, u64>,
    /// ★ M4 地区与王国登记簿（按营地聚合的地区团体、国王、公仓与继承顺位）
    pub region_registry: RegionRegistry,
    /// ★ M4 夺位远征目标记录（agent_id → 目标 camp_id）
    pub expedition_targets: std::collections::BTreeMap<u32, u32>,
    /// ★ M4 救济冷却记录（每家户上次接受救济的 tick）
    pub relief_cooldown: std::collections::BTreeMap<HouseholdId, u64>,
}

impl World3DEngine {
    pub fn new(grid_res: usize, world_size: f32) -> Self {
        Self::new_seeded(grid_res, world_size, 42)
    }

    /// 指定种子的确定性世界构建 (wasm 桥接与 SL 复现使用)
    pub fn new_seeded(grid_res: usize, world_size: f32, seed: u64) -> Self {
        Self::new_seeded_with_config(grid_res, world_size, seed, SimConfig::default())
    }

    /// 指定种子和自定义配置的确定性世界构建
    pub fn new_seeded_with_config(grid_res: usize, world_size: f32, seed: u64, config: SimConfig) -> Self {
        let mut terrain = TerrainMap::new(grid_res, grid_res, world_size);
        terrain.generate_natural_landscape(seed);

        Self {
            terrain,
            network: LaneGraph3D::new(),
            pois: Vec::new(),
            houses: Vec::new(),
            agents: Vec::new(),
            next_agent_id: 1,
            next_house_id: 1,
            total_births: 0,
            total_deaths: 0,
            total_deaths_natural: 0,
            total_deaths_unnatural: 0,
            total_miscarriages: 0,
            season_timer: 0.0,
            current_season: Season::Spring,
            temperature: 20.0,
            rng: WorldRng::new(seed),
            water_regen_multiplier: 1.0,
            berry_regen_multiplier: 1.0,
            wood_regen_multiplier: 1.0,
            stone_regen_multiplier: 1.0,
            gold_regen_multiplier: 1.0,
            tick_counter: 0,
            last_event: None,
            recent_deaths: Vec::new(),
            config,
            agent_index: HashMap::new(),
            marriage_registry: MarriageRegistry::new(LEDGER_JOURNAL_CAPACITY),
            household_registry: HouseholdRegistry::new(LEDGER_JOURNAL_CAPACITY),
            public_granary: Ledger::new(LEDGER_JOURNAL_CAPACITY),
            clan_registry: ClanRegistry::new(LEDGER_JOURNAL_CAPACITY),
            mutual_aid_cooldown: std::collections::BTreeMap::new(),
            region_registry: RegionRegistry::new(LEDGER_JOURNAL_CAPACITY),
            expedition_targets: std::collections::BTreeMap::new(),
            relief_cooldown: std::collections::BTreeMap::new(),
        }
    }

    /// 当前世界 tick 数（只读访问器：tick_counter 为私有字段，供 ledger / housing_system 钩子取时刻）
    pub fn current_tick(&self) -> u64 {
        self.tick_counter
    }

    pub fn find_nearest_node(&self, pos: Vec3) -> Option<NodeId> {
        let mut best_id = None;
        let mut min_dist = f32::MAX;
        for node in self.network.graph.node_weights() {
            let d = node.pos.distance_to(&pos);
            if d < min_dist {
                min_dist = d;
                best_id = Some(node.id);
            }
        }
        best_id
    }

    pub fn find_nearest_camp_node(&self, pos: Vec3) -> NodeId {
        let nearest_camp = self.pois.iter()
            .filter(|p| p.poi_type == PoiType::Camp)
            .min_by(|a, b| a.pos.distance_to(&pos).partial_cmp(&b.pos.distance_to(&pos)).unwrap());
        if let Some(camp) = nearest_camp {
            self.find_nearest_node(camp.pos).unwrap_or(1)
        } else {
            self.find_nearest_node(pos).unwrap_or(1)
        }
    }

    /// 全量重建 agent_index。在 agents Vec 结构发生变化（push 新 agent 或 retain 后）必须调用。
    pub fn rebuild_agent_index(&mut self) {
        self.agent_index.clear();
        for (i, agent) in self.agents.iter().enumerate() {
            self.agent_index.insert(agent.id, i);
        }
    }

    /// 按 AgentId O(1) 不可变查找
    pub fn agent_by_id(&self, id: AgentId) -> Option<&Agent3D> {
        let idx = *self.agent_index.get(&id)?;
        self.agents.get(idx)
    }

    /// 按 AgentId O(1) 可变查找
    pub fn agent_by_id_mut(&mut self, id: AgentId) -> Option<&mut Agent3D> {
        let idx = *self.agent_index.get(&id)?;
        self.agents.get_mut(idx)
    }
}
