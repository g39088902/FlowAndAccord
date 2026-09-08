use super::super::vec3::Vec3;
use super::super::graph::NodeId;
use super::super::agent::{Agent3D, PrimitiveActionState};
use super::super::poi::PoiType;
use super::needs::*;
use super::evaluate::Decisioner;

use super::strategy::{ActiveTask, ExecutionStrategy, ResourceStage, ReturnStage, ResidenceTarget};
use super::primitive::{ActionPrimitive, ArrivalKind, HoldKind};
use super::intent::{AgentIntent, IntentKind, CompletionPolicy};
use super::branches::BranchId;
use super::projection::compatible_legacy_state;
use super::transition;

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

    /// 评估节点周边连接道路的通行质量（踏路加成系数，加权平均）
    pub fn estimate_path_quality(&self, node: NodeId) -> f32 {
        let Some(&idx) = self.network.node_map.get(&node) else { return 1.0; };
        let mut total_factor = 0.0;
        let mut count = 0;
        for edge in self.network.graph.edges(idx) {
            let w = edge.weight();
            let bucket = super::super::graph::LaneEdge3D::wear_tier_bucket(
                w.wear,
                self.config.road_wear_tier_step,
                self.config.road_benefit_max_wear,
            );
            let quantized_wear = bucket as f32 * self.config.road_wear_tier_step;
            let factor = (self.config.road_level_factor_base + self.config.road_level_factor_wear_coef * quantized_wear)
                .clamp(self.config.road_level_factor_min, self.config.road_level_factor_max);
            total_factor += factor;
            count += 1;
        }
        if count > 0 {
            total_factor / count as f32
        } else {
            self.config.road_level_factor_base
        }
    }

    /// 核验族人是否为家户户主
    #[inline]
    pub fn is_household_head(&self, a: &Agent3D) -> bool {
        self.households.household_of(a.id)
            .and_then(|hid| self.households.get(hid))
            .map(|hh| hh.group.leader == Some(a.id))
            .unwrap_or(false)
    }

    pub fn nearest_of(&self, agent: &Agent3D, pool: NodePool, pos: Vec3) -> Option<NodeId> {
        let nodes = self.available_nodes(agent, pool);
        if agent.intelligence >= self.config.trait_high_threshold && nodes.len() > 1 {
            // ★ M19.4c 智力驱动选点：高智力族人避开减速严重的荒野泥泞路，优先选择沿线道路踩踏成熟、通行高效的 POI
            nodes.into_iter().min_by(|&a, &b| {
                let da = self.node_pos(a).distance_to(&pos);
                let db = self.node_pos(b).distance_to(&pos);
                let qa = self.estimate_path_quality(a).max(0.1);
                let qb = self.estimate_path_quality(b).max(0.1);
                (da / qa).partial_cmp(&(db / qb)).unwrap_or(std::cmp::Ordering::Equal)
            })
        } else {
            nodes.into_iter().min_by(|&a, &b| {
                self.node_pos(a).distance_to(&pos)
                    .partial_cmp(&self.node_pos(b).distance_to(&pos))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        }
    }

    pub fn start_node(&self, agent: &Agent3D) -> NodeId {
        self.network.graph.node_weights()
            .min_by(|a, b| a.pos.distance_to(&agent.world_pos).partial_cmp(&b.pos.distance_to(&agent.world_pos)).unwrap())
            .map(|n| n.id)
            .unwrap_or(agent.home_camp_node)
    }

    pub fn home_target(&self, agent: &Agent3D) -> NodeId {
        if let Some(house_id) = agent.home_house_id {
            if let Some(h) = self.houses.iter().find(|h| h.id == house_id) {
                return h.door_node_id;
            }
            agent.home_camp_node
        } else {
            self.ctx.camp_positions.iter()
                .min_by(|(_, a), (_, b)| a.distance_to(&agent.world_pos).partial_cmp(&b.distance_to(&agent.world_pos)).unwrap())
                .map(|(nid, _)| *nid)
                .unwrap_or(agent.home_camp_node)
        }
    }

    pub fn dispatch(&self, agent: &mut Agent3D, start: NodeId, target: NodeId, state: PrimitiveActionState) -> bool {
        if let Some(path) = self.network.find_path_3d_with_preference(start, target, agent.is_covert, self.config) {
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
                    } else if let Some(remaining) = self.network.find_path_3d_with_preference(from_node, target_node, agent.is_covert, self.config) {
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

    /// 平滑寻路与转向：若小人正在车道上移动，优先原地掉头反向平滑往回走；否则从最近节点派发新路线
    pub fn route_or_turn_around(&self, agent: &mut Agent3D, target_node: NodeId, state: PrimitiveActionState) -> bool {
        if self.turn_around_and_route_to(agent, target_node, state) {
            true
        } else {
            let curr = self.start_node(agent);
            self.dispatch(agent, curr, target_node, state)
        }
    }

    pub fn return_home(&self, agent: &mut Agent3D) {
        let target_home = self.home_target(agent);
        // 若小人正在途中移动，优先原地掉头沿原车道反向往回走，绝不瞬移
        if self.turn_around_and_route_to(agent, target_home, PrimitiveActionState::ReturningToCamp) {
            agent.home_camp_node = target_home;
            self.sync_return_home_task(agent, target_home, false);
            return;
        }

        let curr_node = self.start_node(agent);
        if curr_node == target_home {
            agent.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
            agent.home_camp_node = target_home;
            self.sync_return_home_task(agent, target_home, true);
            return;
        }
        self.dispatch(agent, curr_node, target_home, PrimitiveActionState::ReturningToCamp);
        agent.home_camp_node = target_home;
        self.sync_return_home_task(agent, target_home, false);
    }

    fn sync_return_home_task(&self, agent: &mut Agent3D, target_home: NodeId, at_home: bool) {
        if let Some(task) = agent.active_task.as_mut() {
            match &mut task.strategy {
                ExecutionStrategy::WildHarvest { stage, .. } => {
                    if at_home {
                        *stage = ResourceStage::Unloading;
                        task.primitive = ActionPrimitive::Hold(HoldKind::Residence);
                    } else {
                        *stage = ResourceStage::Returning;
                        task.primitive = ActionPrimitive::Navigate {
                            target: target_home,
                            arrival: ArrivalKind::Residence,
                        };
                    }
                    agent.state = compatible_legacy_state(task);
                    return;
                }
                ExecutionStrategy::MarketTrade { stage, .. } => {
                    if at_home {
                        *stage = ResourceStage::Unloading;
                        task.primitive = ActionPrimitive::Hold(HoldKind::Residence);
                    } else {
                        *stage = ResourceStage::Returning;
                        task.primitive = ActionPrimitive::Navigate {
                            target: target_home,
                            arrival: ArrivalKind::Residence,
                        };
                    }
                    agent.state = compatible_legacy_state(task);
                    return;
                }
                _ => {}
            }
        }
        if at_home {
            agent.active_task = None;
            agent.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
        } else {
            let destination = if let Some(hid) = agent.home_house_id {
                ResidenceTarget::House(hid)
            } else {
                ResidenceTarget::Camp(target_home)
            };
            let task = ActiveTask {
                intent: AgentIntent {
                    source_branch: BranchId::B3Rest,
                    level: MaslowLevel::Physiological,
                    kind: IntentKind::RestAndRecover,
                    completion: CompletionPolicy::RecoveryFinished,
                },
                strategy: ExecutionStrategy::ReturnToResidence {
                    destination,
                    stage: ReturnStage::Travelling,
                },
                primitive: ActionPrimitive::Navigate {
                    target: target_home,
                    arrival: ArrivalKind::Residence,
                },
            };
            transition::install_task(agent, task);
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
                PoiType::Camp | PoiType::Market => return false,
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
            PoiType::Camp | PoiType::Market => return false,
        })
    }
}
