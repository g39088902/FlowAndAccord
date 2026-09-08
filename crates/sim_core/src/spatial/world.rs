use super::agent::{Agent3D, AgentId};
use super::graph::{LaneGraph3D, NodeId};
use super::house::{House, HouseAuctionHistoryRecord, AUCTION_HISTORY_CAPACITY};
use super::ledger::{
    ClanRegistry, EmpireRegistry, HouseholdId, HouseholdRegistry, Ledger, MarriageRegistry,
    RegionRegistry,
};
use super::poi::{PoiType, PrimitivePoi};
use super::snapshot::{RecentDeathSnapshot, Season};
use super::vec3::Vec3;
use crate::config::SimConfig;
use crate::geo::terrain::TerrainMap;
use crate::rng::WorldRng;
use std::collections::{HashMap, VecDeque};

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
    /// 厄尔尼诺现象随机初始相位
    pub el_nino_phase: f32,
    /// 纪元候波（49年周期）随机初始相位
    pub climate_epoch_phase: f32,
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
    /// ★ M5 帝国登记簿（按营地聚合的帝国/联邦上层政体）
    pub empire_registry: EmpireRegistry,
    /// ★ M4 救济冷却记录（每家户上次接受救济的 tick）
    pub relief_cooldown: std::collections::BTreeMap<HouseholdId, u64>,
    /// 房屋拍卖累计场次统计（started / sold / flopped）。
    pub auction_started: u64,
    pub auction_sold: u64,
    pub auction_flopped: u64,
    /// ★ 房屋报价中心历史受理记录 (256 容量环形缓冲区，成交与流拍全留痕)
    pub auction_history: VecDeque<HouseAuctionHistoryRecord>,
    /// 上次国王内帑结算 tick；按 6000 tick（100 游戏小时）结算。
    pub last_royal_payout_tick: u64,
    /// 上次帝国公帑结算 tick；与国王内帑使用相同的 6000 tick 周期但独立记账。
    pub last_imperial_payout_tick: u64,
    /// 地形快照脏位标记：仅在初次生成、载入存档或显式请求时为 true 并导出 3600 个网格单元
    pub terrain_dirty: std::cell::Cell<bool>,
    /// 地区居民到达时序脏位标记：仅在新成员加入/变动时置为 true 并按需排序
    pub regions_arrival_dirty: bool,
    /// ★ M4 二进制快照：持久化字符串驻留表（自由文本跨帧稳定 id，前端永久缓存解码结果）
    ///
    /// 只服务快照输出，不参与内核演化、不消耗 `WorldRng`，故不影响确定性。
    /// 由于 `write_snapshot_binary(&self)` 需要 `&self`，这里用 `RefCell` 做内部可变性。
    pub strtab: std::cell::RefCell<super::snapshot_bin::StrTab>,
    /// ★ M4 二进制快照：上一次已下发的路网拓扑签名 `(node_count << 32) | lane_count`。
    /// 与当前签名不一致时才重发 `LANE_GEO`/`NODE`（建房会新增节点与车道）。
    /// 初值 `u64::MAX` 保证首帧必然下发。
    pub last_geom_sig: std::cell::Cell<u64>,
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
    pub fn new_seeded_with_config(
        grid_res: usize,
        world_size: f32,
        seed: u64,
        config: SimConfig,
    ) -> Self {
        let mut terrain = TerrainMap::new(grid_res, grid_res, world_size);
        terrain.generate_natural_landscape(seed);

        let journal_cap = if config.ledger_journal_capacity > 0 {
            config.ledger_journal_capacity
        } else {
            64
        };

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
            el_nino_phase: WorldRng::new(seed.wrapping_add(0x454c4e494e4f))
                .gen_range(0.0, std::f32::consts::TAU),
            climate_epoch_phase: WorldRng::new(seed.wrapping_add(0x434c494d45504f43))
                .gen_range(0.0, std::f32::consts::TAU),
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
            marriage_registry: MarriageRegistry::new(journal_cap),
            household_registry: HouseholdRegistry::new(journal_cap),
            public_granary: Ledger::new(journal_cap),
            clan_registry: ClanRegistry::new(journal_cap),
            mutual_aid_cooldown: std::collections::BTreeMap::new(),
            region_registry: RegionRegistry::new(journal_cap),
            empire_registry: EmpireRegistry::new(journal_cap),
            relief_cooldown: std::collections::BTreeMap::new(),
            auction_started: 0,
            auction_sold: 0,
            auction_flopped: 0,
            auction_history: VecDeque::with_capacity(AUCTION_HISTORY_CAPACITY),
            last_royal_payout_tick: 0,
            last_imperial_payout_tick: 0,
            terrain_dirty: std::cell::Cell::new(true),
            regions_arrival_dirty: true,
            strtab: std::cell::RefCell::new(super::snapshot_bin::StrTab::new()),
            last_geom_sig: std::cell::Cell::new(u64::MAX),
        }
    }

    /// 强制下一帧二进制快照重发**全部**静态几何（地形 + 路网拓扑）。
    ///
    /// 用于初始化、读档、重置，以及前端显式请求地形时（`world_require_terrain`）。
    /// 注意：JSON 通道不受本方法影响（它只看 `terrain_dirty`）。
    pub fn require_full_geometry(&self) {
        self.terrain_dirty.set(true);
        self.last_geom_sig.set(u64::MAX);
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
        let nearest_camp = self
            .pois
            .iter()
            .filter(|p| p.poi_type == PoiType::Camp)
            .min_by(|a, b| {
                a.pos
                    .distance_to(&pos)
                    .partial_cmp(&b.pos.distance_to(&pos))
                    .unwrap()
            });
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

    /// 追加一条房屋拍卖受理记录（成交或流拍，放入 256 容量环形缓冲区）
    pub fn push_auction_history(&mut self, record: HouseAuctionHistoryRecord) {
        while self.auction_history.len() >= AUCTION_HISTORY_CAPACITY {
            self.auction_history.pop_front();
        }
        self.auction_history.push_back(record);
    }
}
