use std::collections::{BTreeSet, HashMap};
use petgraph::graph::{DiGraph, EdgeIndex, NodeIndex};
use petgraph::algo::astar;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use super::vec3::Vec3;
use super::curve::Curve3D;
use crate::config::*;

pub type NodeId = u32;
pub type LaneId = u32;

/// 车道初始耐久（结构内部固定尺度，非用户超参）
const LANE_HEALTH_DEFAULT: f32 = 100.0;
/// 车道最大通行容量（结构内部固定尺度，非用户超参）
const LANE_MAX_CAPACITY: u32 = 100;

/// 3D 节点类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeType {
    GroundIntersection, // 地面平交路口
    ElevatedOverpass,   // 高架桥立交
    TunnelPortal,       // 隧道口/天坑
    CulDeSac,           // 尽端路/掉头点
    SecretHideout,      // 隐秘黑市据点/走私换装点
}

impl NodeType {
    #[inline]
    pub const fn as_str(&self) -> &'static str {
        match self {
            NodeType::GroundIntersection => "GroundIntersection",
            NodeType::ElevatedOverpass => "ElevatedOverpass",
            NodeType::TunnelPortal => "TunnelPortal",
            NodeType::CulDeSac => "CulDeSac",
            NodeType::SecretHideout => "SecretHideout",
        }
    }
}

/// 道路等级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoadClass {
    DirtTrack,      // 泥泞小径
    Cobblestone,    // 碎石盘山道
    AsphaltUrban,   // 沥青主干道
    SkywayElevated, // 悬空高架快速路
    SmugglerTrail,  // 走私暗道/避税密道
}

impl RoadClass {
    #[inline]
    pub const fn as_str(&self) -> &'static str {
        match self {
            RoadClass::DirtTrack => "DirtTrack",
            RoadClass::Cobblestone => "Cobblestone",
            RoadClass::AsphaltUrban => "AsphaltUrban",
            RoadClass::SkywayElevated => "SkywayElevated",
            RoadClass::SmugglerTrail => "SmugglerTrail",
        }
    }
}

/// 3D 有向车道边 (包含隐秘属性)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneEdge3D {
    pub id: LaneId,
    pub from_node: NodeId,
    pub to_node: NodeId,
    pub curve: Curve3D,
    pub road_class: RoadClass,
    pub speed_limit: f32, // 限速 (m/s)
    pub max_capacity: u32,// 理论承载力
    pub health: f32,      // 耐久度 0.0 ~ 100.0
    pub wear: f32,        // 动态踩踏等级 (连续浮点数 0.0=荒野无路, 1.0=土径, 2.0=夯土道, 3.0=平整石道, 4.0=石板通衢, 5.0=极品大道)
    pub is_hidden: bool,  // 是否为隐藏道路/走私密道
    pub concealment: f32, // 隐秘度 0.0 (完全公开) ~ 1.0 (深度隐藏)
}

impl LaneEdge3D {
    /// 计算以 tier_step 为阶梯步进的量化等级桶（上限为 benefit_max）
    #[inline]
    pub fn wear_tier_bucket(wear: f32, tier_step: f32, benefit_max: f32) -> u32 {
        if tier_step <= 0.0 {
            return 0;
        }
        let effective_wear = wear.min(benefit_max);
        (effective_wear / tier_step).floor() as u32
    }
}

/// 3D 路网拓扑有向图管理器
#[derive(Debug, Clone)]
pub struct LaneGraph3D {
    pub graph: DiGraph<NodeData, LaneEdge3D>,
    pub node_map: HashMap<NodeId, NodeIndex>,
    pub edge_map: HashMap<LaneId, EdgeIndex>,
    pub next_node_id: NodeId,
    pub next_lane_id: LaneId,
    // ★ 静态端点对路径缓存：(from_node, to_node, prefer_hidden) -> Option<Vec<LaneId>>
    pub path_cache: std::cell::RefCell<HashMap<(NodeId, NodeId, bool), Option<Vec<LaneId>>>>,
    // ★ 全源静态拓扑最短路矩阵查表 (APSP Table, M3 优化)
    pub apsp_table: std::cell::RefCell<ApspTable>,
    // ★ 稀疏活跃磨损边集合 (wear > 0.0)，避免每拍遍历全图无路/荒野边 (M2 优化)
    pub active_wear_edges: BTreeSet<EdgeIndex>,
}

/// 全源静态拓扑最短路矩阵查表 (APSP Table, M3 优化)
#[derive(Debug, Clone, Default)]
pub struct ApspTable {
    /// 静态拓扑端点对路径矩阵：(start, goal, prefer_hidden) -> Option<Vec<LaneId>>
    pub routes: HashMap<(NodeId, NodeId, bool), Option<Vec<LaneId>>>,
    pub is_initialized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeData {
    pub id: NodeId,
    pub pos: Vec3,
    pub node_type: NodeType,
}

pub type LaneNode3D = NodeData;

impl LaneGraph3D {
    pub fn new() -> Self {
        Self {
            graph: DiGraph::new(),
            node_map: HashMap::new(),
            edge_map: HashMap::new(),
            next_node_id: 1,
            next_lane_id: 1,
            path_cache: std::cell::RefCell::new(HashMap::new()),
            apsp_table: std::cell::RefCell::new(ApspTable::default()),
            active_wear_edges: BTreeSet::new(),
        }
    }

    /// 清空端点对路径缓存（拓扑变更或配置刷新时调用）
    pub fn clear_path_cache(&self) {
        self.path_cache.borrow_mut().clear();
        self.apsp_table.borrow_mut().is_initialized = false;
    }

    /// 局部失效：仅使经过指定车道集合的端点对缓存失效 (M3 优化)
    pub fn invalidate_paths_containing_lanes(&self, lanes: &BTreeSet<LaneId>) {
        if lanes.is_empty() {
            return;
        }
        let mut cache = self.path_cache.borrow_mut();
        cache.retain(|_, opt_path| {
            if let Some(path) = opt_path {
                !path.iter().any(|lane_id| lanes.contains(lane_id))
            } else {
                false
            }
        });
    }

    /// 局部失效：仅使经过指定车道的端点对缓存失效 (M3 优化)
    pub fn invalidate_paths_containing_lane(&self, lane_id: LaneId) {
        let mut cache = self.path_cache.borrow_mut();
        cache.retain(|_, opt_path| {
            if let Some(path) = opt_path {
                !path.contains(&lane_id)
            } else {
                false
            }
        });
    }

    /// 当车道因踩踏提速跨阶时局部失效：仅失效可能受该车道提速影响的端点对路径 (M3 优化)
    pub fn invalidate_paths_for_trampled_lanes(&self, lanes: &BTreeSet<LaneId>) {
        if lanes.is_empty() {
            return;
        }
        let mut lane_endpoints = Vec::new();
        for &lane_id in lanes {
            if let Some(&edge_idx) = self.edge_map.get(&lane_id) {
                let edge = &self.graph[edge_idx];
                if let (Some(&u_idx), Some(&v_idx)) = (self.node_map.get(&edge.from_node), self.node_map.get(&edge.to_node)) {
                    let from_pos = self.graph[u_idx].pos;
                    let to_pos = self.graph[v_idx].pos;
                    lane_endpoints.push((from_pos, to_pos));
                }
            }
        }

        let mut cache = self.path_cache.borrow_mut();
        cache.retain(|&(start, goal, _), opt_path| {
            if let Some(path) = opt_path {
                // 若该路径本身就包含跃迁车道，保留它（已走最优路，其耗时只会更短）
                if path.iter().any(|lid| lanes.contains(lid)) {
                    return true;
                }
                let (Some(&s_idx), Some(&g_idx)) = (self.node_map.get(&start), self.node_map.get(&goal)) else {
                    return false;
                };
                let p_s = self.graph[s_idx].pos;
                let p_g = self.graph[g_idx].pos;
                let direct_dist = p_s.distance_to(&p_g);

                // 三角不等式几何剪枝：检查是否有任何跃迁车道可能使当前路径获益
                for (p_u, p_v) in &lane_endpoints {
                    let detour_1 = p_s.distance_to(p_u) + p_v.distance_to(&p_g);
                    let detour_2 = p_s.distance_to(p_v) + p_u.distance_to(&p_g);
                    let min_detour = detour_1.min(detour_2);
                    if min_detour < direct_dist * 1.5 {
                        return false; // 处于几何影响范围内，失效并重寻
                    }
                }
                true // 几何距离过远，绝无可能被该车道改善，保留
            } else {
                false
            }
        });
    }

    /// 预计算全源静态拓扑最短路矩阵 (APSP Table, M3 优化)
    pub fn init_static_apsp(&self, config: &SimConfig) {
        let mut table = self.apsp_table.borrow_mut();
        table.routes.clear();
        let nodes: Vec<NodeId> = self.node_map.keys().copied().collect();
        for &start in &nodes {
            for &goal in &nodes {
                if start != goal {
                    for &prefer_hidden in &[false, true] {
                        let path = self.compute_path_3d_with_preference(start, goal, prefer_hidden, config);
                        table.routes.insert((start, goal, prefer_hidden), path);
                    }
                }
            }
        }
        table.is_initialized = true;
    }

    pub fn add_node(&mut self, pos: Vec3, node_type: NodeType) -> NodeId {
        let id = self.next_node_id;
        self.next_node_id += 1;
        let idx = self.graph.add_node(NodeData { id, pos, node_type });
        self.node_map.insert(id, idx);
        id
    }

    pub fn add_lane(
        &mut self,
        from: NodeId,
        to: NodeId,
        curve: Option<Curve3D>,
        road_class: RoadClass,
        config: &SimConfig,
    ) -> Result<LaneId, &'static str> {
        self.add_lane_with_options(from, to, curve, road_class, false, 0.0, config)
    }

    pub fn add_lane_with_options(
        &mut self,
        from: NodeId,
        to: NodeId,
        curve: Option<Curve3D>,
        road_class: RoadClass,
        is_hidden: bool,
        concealment: f32,
        config: &SimConfig,
    ) -> Result<LaneId, &'static str> {
        let from_idx = *self.node_map.get(&from).ok_or("起始节点不存在")?;
        let to_idx = *self.node_map.get(&to).ok_or("目标节点不存在")?;

        let p0 = self.graph[from_idx].pos;
        let p3 = self.graph[to_idx].pos;
        let final_curve = curve.unwrap_or_else(|| Curve3D::new_straight(p0, p3));

        let lane_id = self.next_lane_id;
        self.next_lane_id += 1;

        let speed_limit = match road_class {
            RoadClass::DirtTrack => config.road_speed_dirt_track,
            RoadClass::Cobblestone => config.road_speed_cobblestone,
            RoadClass::AsphaltUrban => config.road_speed_asphalt_urban,
            RoadClass::SkywayElevated => config.road_speed_skyway_elevated,
            RoadClass::SmugglerTrail => config.road_speed_smuggler_trail,
        };

        let edge_data = LaneEdge3D {
            id: lane_id,
            from_node: from,
            to_node: to,
            curve: final_curve,
            road_class,
            speed_limit,
            max_capacity: LANE_MAX_CAPACITY,
            health: LANE_HEALTH_DEFAULT,
            wear: 0.0, // 初始地图完全无路 (wear = 0.0)
            is_hidden: is_hidden || road_class == RoadClass::SmugglerTrail,
            concealment: if is_hidden { concealment.max(0.7) } else { concealment },
        };

        let edge_idx = self.graph.add_edge(from_idx, to_idx, edge_data);
        self.edge_map.insert(lane_id, edge_idx);
        if self.graph[edge_idx].wear > 0.0 {
            self.active_wear_edges.insert(edge_idx);
        }
        self.clear_path_cache();
        Ok(lane_id)
    }

    /// 道路自然杂草丛生与退化衰减（仅扫描稀疏活跃磨损边，跨阶跌落时仅对经过该边的端点对路径进行局部失效）
    pub fn tick_wear_decay(&mut self, dt: f32, config: &SimConfig) {
        if self.active_wear_edges.is_empty() {
            return;
        }
        let mut changed_lanes = BTreeSet::new();
        let tier_step = config.road_wear_tier_step;
        let benefit_max = config.road_benefit_max_wear;
        let decay_mult = (1.0 - config.road_wear_decay_rate * dt).max(0.0);

        let mut to_remove = Vec::new();
        for &edge_idx in &self.active_wear_edges {
            let edge = &mut self.graph[edge_idx];
            let old_bucket = LaneEdge3D::wear_tier_bucket(edge.wear, tier_step, benefit_max);
            let decayed = edge.wear * decay_mult;
            let new_wear = if decayed < 1e-5 {
                to_remove.push(edge_idx);
                0.0
            } else {
                decayed
            };
            edge.wear = new_wear;
            let new_bucket = LaneEdge3D::wear_tier_bucket(new_wear, tier_step, benefit_max);
            if old_bucket != new_bucket {
                changed_lanes.insert(edge.id);
            }
        }

        for edge_idx in to_remove {
            self.active_wear_edges.remove(&edge_idx);
        }

        if !changed_lanes.is_empty() {
            self.invalidate_paths_containing_lanes(&changed_lanes);
        }
    }

    /// 3D 拓扑加权 A* 寻路
    pub fn find_path_3d(&self, start: NodeId, goal: NodeId, config: &SimConfig) -> Option<Vec<LaneId>> {
        self.find_path_3d_with_preference(start, goal, false, config)
    }

    /// 支持潜行特工偏好的 3D 拓扑加权 A* 寻路（带局部失效端点对缓存与 APSP 静态查表）
    pub fn find_path_3d_with_preference(&self, start: NodeId, goal: NodeId, prefer_hidden: bool, config: &SimConfig) -> Option<Vec<LaneId>> {
        if start == goal {
            return Some(Vec::new());
        }

        let key = (start, goal, prefer_hidden);
        if let Some(cached) = self.path_cache.borrow().get(&key) {
            return cached.clone();
        }

        // M3 优化：若全图无任何磨损踩踏边（纯静态拓扑），优先尝试从 APSP 表直接获取
        if self.active_wear_edges.is_empty() {
            let apsp = self.apsp_table.borrow();
            if apsp.is_initialized {
                if let Some(path) = apsp.routes.get(&key) {
                    let path_clone = path.clone();
                    let mut cache = self.path_cache.borrow_mut();
                    if cache.len() >= 4096 {
                        cache.clear();
                    }
                    cache.insert(key, path_clone.clone());
                    return path_clone;
                }
            }
        }

        let path = self.compute_path_3d_with_preference(start, goal, prefer_hidden, config);
        // 限制缓存容量上限，防止极端情况下无界增长（正常规模 < 1000 对）
        let mut cache = self.path_cache.borrow_mut();
        if cache.len() >= 4096 {
            cache.clear();
        }
        cache.insert(key, path.clone());
        path
    }

    /// 内层加权 A* 拓扑路径搜索（基于离散阶梯限速与坡度，保证确定性与缓存稳定性）
    fn compute_path_3d_with_preference(&self, start: NodeId, goal: NodeId, prefer_hidden: bool, config: &SimConfig) -> Option<Vec<LaneId>> {
        let start_idx = *self.node_map.get(&start)?;
        let goal_idx = *self.node_map.get(&goal)?;
        let goal_pos = self.graph[goal_idx].pos;

        let path = astar(
            &self.graph,
            start_idx,
            |finish| finish == goal_idx,
            |edge_ref| {
                let edge = edge_ref.weight();
                let delta_z = (edge.curve.p3.z - edge.curve.p0.z).max(0.0);
                let grade_penalty = if delta_z > 0.0 { delta_z * config.road_astar_grade_penalty_coef } else { 0.0 };

                // 阶梯量化有效速度：以 road_wear_tier_step (0.25) 为离散阶梯步进，
                // 兼顾踏路成道（Stigmergy）动态涌现与端点对路径缓存（path_cache）高命中率
                let bucket = LaneEdge3D::wear_tier_bucket(edge.wear, config.road_wear_tier_step, config.road_benefit_max_wear);
                let quantized_wear = bucket as f32 * config.road_wear_tier_step;
                let road_level_factor = (config.road_level_factor_base + config.road_level_factor_wear_coef * quantized_wear)
                    .clamp(config.road_level_factor_min, config.road_level_factor_max);
                let effective_speed = edge.speed_limit * road_level_factor;

                let hidden_modifier = if prefer_hidden {
                    if edge.is_hidden { config.road_hidden_prefer_modifier } else { config.road_visible_prefer_modifier }
                } else {
                    if edge.is_hidden { config.road_hidden_avoid_modifier } else { config.road_visible_avoid_modifier }
                };

                ((edge.curve.length / effective_speed) + grade_penalty) * hidden_modifier
            },
            |node_idx| {
                let pos = self.graph[node_idx].pos;
                pos.distance_to(&goal_pos) / config.road_astar_heuristic_divisor
            },
        )?;

        let mut lane_route = Vec::new();
        for window in path.1.windows(2) {
            let u = window[0];
            let v = window[1];
            if let Some(edge_idx) = self.graph.find_edge(u, v) {
                lane_route.push(self.graph[edge_idx].id);
            }
        }
        Some(lane_route)
    }
}

// ═══════════════════════════════════════════════════════════════
// 路网持久化（存档系统专用）
//
// `LaneGraph3D` 内部持有 petgraph 有向图与两张 HashMap 索引，不宜直接派生 serde。
// 这里只持久化「按插入顺序排列的节点/车道扁平列表 + 两个发号器」，
// 反序列化时按同序重建：可得到完全一致的 NodeIndex/EdgeIndex 与邻接表顺序。
// ★ 正确性前提：路网从不删除节点/车道（见 housing_system/AGENTS.md §4.2），
//   因此重建后的邻接表边序与原图逐条一致，A* 寻路结果保持确定性。
// ═══════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize)]
struct LaneGraphSaveData {
    nodes: Vec<NodeData>,
    lanes: Vec<LaneEdge3D>,
    next_node_id: NodeId,
    next_lane_id: LaneId,
}

impl LaneGraph3D {
    /// 导出扁平可序列化快照（节点/车道均按插入顺序）
    fn to_save_data(&self) -> LaneGraphSaveData {
        LaneGraphSaveData {
            nodes: self.graph.node_weights().cloned().collect(),
            lanes: self.graph.edge_weights().cloned().collect(),
            next_node_id: self.next_node_id,
            next_lane_id: self.next_lane_id,
        }
    }

    /// 由扁平数据重建路网（graph / node_map / edge_map 一并复原）
    fn from_save_data(data: LaneGraphSaveData) -> Self {
        let mut net = LaneGraph3D::new();
        for node in data.nodes {
            let id = node.id;
            let idx = net.graph.add_node(node);
            net.node_map.insert(id, idx);
        }
        for lane in data.lanes {
            let (lane_id, from, to) = (lane.id, lane.from_node, lane.to_node);
            let has_wear = lane.wear > 0.0;
            if let (Some(from_idx), Some(to_idx)) = (net.node_map.get(&from), net.node_map.get(&to)) {
                let from_idx = *from_idx;
                let to_idx = *to_idx;
                let edge_idx = net.graph.add_edge(from_idx, to_idx, lane);
                net.edge_map.insert(lane_id, edge_idx);
                if has_wear {
                    net.active_wear_edges.insert(edge_idx);
                }
            }
        }
        net.next_node_id = data.next_node_id;
        net.next_lane_id = data.next_lane_id;
        net
    }
}

impl Serialize for LaneGraph3D {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_save_data().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for LaneGraph3D {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        LaneGraphSaveData::deserialize(deserializer).map(LaneGraph3D::from_save_data)
    }
}
