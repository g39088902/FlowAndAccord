use std::collections::HashMap;
use petgraph::graph::{DiGraph, EdgeIndex, NodeIndex};
use petgraph::algo::astar;
use serde::{Deserialize, Serialize};

use super::vec3::Vec3;
use super::curve::Curve3D;

pub type NodeId = u32;
pub type LaneId = u32;

/// 3D 节点类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeType {
    GroundIntersection, // 地面平交路口
    ElevatedOverpass,   // 高架桥立交
    TunnelPortal,       // 隧道口/天坑
    CulDeSac,           // 尽端路/掉头点
    SecretHideout,      // 隐秘黑市据点/走私换装点
}

/// 道路等级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoadClass {
    DirtTrack,      // 泥泞小径 (限速 6m/s)
    Cobblestone,    // 碎石盘山道 (限速 10m/s)
    AsphaltUrban,   // 沥青主干道 (限速 15m/s)
    SkywayElevated, // 悬空高架快速路 (限速 24m/s)
    SmugglerTrail,  // 走私暗道/避税密道 (限速 8m/s，隐秘性极高)
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
    pub is_hidden: bool,  // 是否为隐藏道路/走私密道
    pub concealment: f32, // 隐秘度 0.0 (完全公开) ~ 1.0 (深度隐藏)
}

/// 3D 路网拓扑有向图管理器
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneGraph3D {
    pub graph: DiGraph<LaneNode3D, LaneEdge3D>,
    pub node_map: HashMap<NodeId, NodeIndex>,
    pub edge_map: HashMap<LaneId, EdgeIndex>,
    pub next_node_id: NodeId,
    pub next_lane_id: LaneId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneNode3D {
    pub id: NodeId,
    pub pos: Vec3,
    pub node_type: NodeType,
}

impl LaneGraph3D {
    pub fn new() -> Self {
        Self {
            graph: DiGraph::new(),
            node_map: HashMap::new(),
            edge_map: HashMap::new(),
            next_node_id: 1,
            next_lane_id: 1,
        }
    }

    /// 动态添加 3D 节点
    pub fn add_node(&mut self, pos: Vec3, node_type: NodeType) -> NodeId {
        let id = self.next_node_id;
        self.next_node_id += 1;
        let node_data = LaneNode3D { id, pos, node_type };
        let idx = self.graph.add_node(node_data);
        self.node_map.insert(id, idx);
        id
    }

    /// 动态添加 3D 车道 (支持普通道路与隐藏密道)
    pub fn add_lane(
        &mut self,
        from: NodeId,
        to: NodeId,
        curve: Option<Curve3D>,
        road_class: RoadClass,
    ) -> Result<LaneId, &'static str> {
        self.add_lane_with_options(from, to, curve, road_class, false, 0.0)
    }

    /// 动态添加带有隐秘属性的车道
    pub fn add_lane_with_options(
        &mut self,
        from: NodeId,
        to: NodeId,
        curve: Option<Curve3D>,
        road_class: RoadClass,
        is_hidden: bool,
        concealment: f32,
    ) -> Result<LaneId, &'static str> {
        let from_idx = *self.node_map.get(&from).ok_or("From node not found")?;
        let to_idx = *self.node_map.get(&to).ok_or("To node not found")?;

        let p0 = self.graph[from_idx].pos;
        let p3 = self.graph[to_idx].pos;
        let final_curve = curve.unwrap_or_else(|| Curve3D::new_straight(p0, p3));

        let lane_id = self.next_lane_id;
        self.next_lane_id += 1;

        let speed_limit = match road_class {
            RoadClass::DirtTrack => 36.0,
            RoadClass::Cobblestone => 44.0,
            RoadClass::AsphaltUrban => 60.0,
            RoadClass::SkywayElevated => 96.0,
            RoadClass::SmugglerTrail => 40.0,
        };

        let edge_data = LaneEdge3D {
            id: lane_id,
            from_node: from,
            to_node: to,
            curve: final_curve,
            road_class,
            speed_limit,
            max_capacity: 100,
            health: 100.0,
            is_hidden: is_hidden || road_class == RoadClass::SmugglerTrail,
            concealment: if is_hidden { concealment.max(0.7) } else { concealment },
        };

        let edge_idx = self.graph.add_edge(from_idx, to_idx, edge_data);
        self.edge_map.insert(lane_id, edge_idx);
        Ok(lane_id)
    }

    /// 动态删除车道
    pub fn remove_lane(&mut self, lane_id: LaneId) -> Option<LaneEdge3D> {
        if let Some(edge_idx) = self.edge_map.remove(&lane_id) {
            let edge_data = self.graph.remove_edge(edge_idx);
            self.rebuild_edge_map();
            edge_data
        } else {
            None
        }
    }

    fn rebuild_edge_map(&mut self) {
        self.edge_map.clear();
        for edge_idx in self.graph.edge_indices() {
            let edge = &self.graph[edge_idx];
            self.edge_map.insert(edge.id, edge_idx);
        }
    }

    /// 3D A* 寻路 (支持隐秘偏好：走私者优先走隐藏暗道，平民避开高隐秘暗道)
    pub fn find_path_3d(&self, start_node: NodeId, goal_node: NodeId) -> Option<Vec<LaneId>> {
        self.find_path_3d_with_preference(start_node, goal_node, false)
    }

    /// 考虑走私潜行偏好的 3D 寻路
    pub fn find_path_3d_with_preference(
        &self,
        start_node: NodeId,
        goal_node: NodeId,
        prefer_hidden: bool,
    ) -> Option<Vec<LaneId>> {
        let start_idx = *self.node_map.get(&start_node)?;
        let goal_idx = *self.node_map.get(&goal_node)?;
        let goal_pos = self.graph[goal_idx].pos;

        let path = astar(
            &self.graph,
            start_idx,
            |finish| finish == goal_idx,
            |edge_ref| {
                let edge = edge_ref.weight();
                let delta_z = edge.curve.p3.z - edge.curve.p0.z;
                let grade_penalty = if delta_z > 0.0 { delta_z * 1.5 } else { 0.0 };

                // 潜行特工偏好走隐藏暗道 (大幅降低暗道代价值)；普通市民避开暗道
                let hidden_modifier = if prefer_hidden {
                    if edge.is_hidden { 0.4 } else { 1.2 }
                } else {
                    if edge.is_hidden { 2.5 } else { 1.0 }
                };

                ((edge.curve.length / edge.speed_limit) + grade_penalty) * hidden_modifier
            },
            |node_idx| {
                let pos = self.graph[node_idx].pos;
                pos.distance_to(&goal_pos) / 25.0
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
