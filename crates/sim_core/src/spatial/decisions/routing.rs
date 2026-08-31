use super::super::vec3::Vec3;
use super::super::graph::NodeId;
use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::poi::PoiType;
use super::needs::*;
use super::evaluate::Decisioner;

/// 路由/导航层：寻路、原地掉头、返家与 POI 私有触发器可用性查询。
///
/// 本模块只提供"怎么走"的机制，不产生任何需求判定；所有方法只读上下文，
/// 供 evaluate / harvest / seeking 三个决策模块复用。
impl<'a> Decisioner<'a> {
    pub fn node_pos(&self, node: NodeId) -> Vec3 {
        self.network.graph[*self.network.node_map.get(&node).unwrap()].pos
    }

    pub fn available_nodes(&self, agent: &Agent3D, pool: NodePool) -> Vec<NodeId> {
        pool.nodes(self.ctx).iter()
            .filter(|target| agent.poi_is_seekable(target.poi_id))
            .map(|target| target.node)
            .collect()
    }

    pub fn has_available_node(&self, agent: &Agent3D, pool: NodePool) -> bool {
        pool.nodes(self.ctx).iter().any(|target| agent.poi_is_seekable(target.poi_id))
    }

    pub fn nearest_of(&self, agent: &Agent3D, pool: NodePool, pos: Vec3) -> Option<NodeId> {
        self.available_nodes(agent, pool).into_iter().min_by(|&a, &b| {
            self.node_pos(a).distance_to(&pos)
                .partial_cmp(&self.node_pos(b).distance_to(&pos))
                .unwrap()
        })
    }

    pub fn start_node(&self, agent: &Agent3D) -> NodeId {
        self.network.graph.node_weights()
            .min_by(|a, b| a.pos.distance_to(&agent.world_pos).partial_cmp(&b.pos.distance_to(&agent.world_pos)).unwrap())
            .map(|n| n.id)
            .unwrap_or(agent.home_camp_node)
    }

    pub fn home_target(&self, agent: &Agent3D) -> NodeId {
        if agent.home_house_id.is_some() {
            agent.home_camp_node
        } else {
            self.ctx.camp_positions.iter()
                .min_by(|(_, a), (_, b)| a.distance_to(&agent.world_pos).partial_cmp(&b.distance_to(&agent.world_pos)).unwrap())
                .map(|(nid, _)| *nid)
                .unwrap_or(agent.home_camp_node)
        }
    }

    pub fn dispatch(&self, agent: &mut Agent3D, start: NodeId, target: NodeId, state: PrimitiveActionState) -> bool {
        if let Some(path) = self.network.find_path_3d_with_preference(start, target, agent.is_covert) {
            if !path.is_empty() {
                agent.state = state;
                agent.target_poi_node = Some(target);
                agent.route = path;
                agent.route_index = 0;
                agent.current_lane_id = Some(agent.route[0]);
                agent.distance_along_curve = 0.0;
                return true;
            }
        }
        false
    }

    /// 当小人中途放弃或重定向时，原地掉头沿当前车道反向往回走，保持坐标平滑无瞬移闪现
    pub fn turn_around_and_route_to(&self, agent: &mut Agent3D, target_node: NodeId, state: PrimitiveActionState) -> bool {
        if let Some(lane_id) = agent.current_lane_id {
            if let Some(&edge_idx) = self.network.edge_map.get(&lane_id) {
                let from_node = self.network.graph[edge_idx].from_node;
                let to_node = self.network.graph[edge_idx].to_node;
                let curr_dist = agent.distance_along_curve;

                let from_idx = self.network.node_map[&from_node];
                let to_idx = self.network.node_map[&to_node];
                if let Some(rev_edge_idx) = self.network.graph.find_edge(to_idx, from_idx) {
                    let rev_lane = &self.network.graph[rev_edge_idx];
                    let rev_lane_id = rev_lane.id;
                    let rev_len = rev_lane.curve.length;

                    let route = if from_node == target_node {
                        vec![rev_lane_id]
                    } else if let Some(remaining) = self.network.find_path_3d_with_preference(from_node, target_node, agent.is_covert) {
                        let mut r = Vec::with_capacity(1 + remaining.len());
                        r.push(rev_lane_id);
                        r.extend(remaining);
                        r
                    } else {
                        vec![rev_lane_id]
                    };

                    agent.state = state;
                    agent.target_poi_node = Some(target_node);
                    agent.route = route;
                    agent.route_index = 0;
                    agent.current_lane_id = Some(rev_lane_id);
                    agent.distance_along_curve = (rev_len - curr_dist).clamp(0.0, rev_len);
                    return true;
                }
            }
        }
        false
    }

    pub fn return_home(&self, agent: &mut Agent3D) {
        let target_home = self.home_target(agent);
        // 若小人正在途中移动，优先原地掉头沿原车道反向往回走，绝不瞬移
        if self.turn_around_and_route_to(agent, target_home, PrimitiveActionState::ReturningToCamp) {
            agent.home_camp_node = target_home;
            return;
        }

        let curr_node = self.start_node(agent);
        if curr_node == target_home {
            agent.state = PrimitiveActionState::RestingAtCamp;
            agent.current_velocity = 0.0;
            agent.current_lane_id = None;
            agent.home_camp_node = target_home;
            return;
        }
        if self.dispatch(agent, curr_node, target_home, PrimitiveActionState::ReturningToCamp) {
            agent.home_camp_node = target_home;
        } else {
            agent.state = PrimitiveActionState::ReturningToCamp;
            agent.home_camp_node = target_home;
        }
    }

    /// 查询本 Agent 对当前目标 POI 的私有施密特触发器结论。
    pub fn is_target_poi_unavailable(&self, agent: &Agent3D, poi_type: PoiType) -> bool {
        if let Some(target_node) = agent.target_poi_node {
            let pool = match poi_type {
                PoiType::WaterSource => NodePool::Water,
                PoiType::BerryBush => NodePool::Food,
                PoiType::WoodForest => NodePool::Wood,
                PoiType::StoneQuarry => NodePool::Stone,
                PoiType::GoldMine => NodePool::Gold,
                PoiType::Camp => return false,
            };
            if let Some(target) = pool.nodes(self.ctx).iter().find(|target| target.node == target_node) {
                return !agent.poi_is_seekable(target.poi_id);
            }
        }
        !self.has_available_node(agent, match poi_type {
            PoiType::WaterSource => NodePool::Water,
            PoiType::BerryBush => NodePool::Food,
            PoiType::WoodForest => NodePool::Wood,
            PoiType::StoneQuarry => NodePool::Stone,
            PoiType::GoldMine => NodePool::Gold,
            PoiType::Camp => return false,
        })
    }
}
