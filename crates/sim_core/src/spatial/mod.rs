pub mod vec3;
pub mod curve;
pub mod graph;
pub mod agent;
pub mod world;

pub use vec3::Vec3;
pub use curve::Curve3D;
pub use graph::{LaneGraph3D, LaneNode3D, LaneEdge3D, NodeType, RoadClass, NodeId, LaneId};
pub use agent::{Agent3D, AgentState, AgentType, AgentId};
pub use world::{World3DEngine, WorldSnapshot3D, NodeSnapshot, LaneSnapshot, AgentSnapshot};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_3d_curve_and_tangent() {
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let p3 = Vec3::new(100.0, 0.0, 20.0);
        let curve = Curve3D::new_straight(p0, p3);

        assert!(curve.length > 100.0);
        let mid_pt = curve.evaluate_pos(0.5);
        assert!((mid_pt.x - 50.0).abs() < 0.1);
        assert!((mid_pt.z - 10.0).abs() < 0.1);

        let tangent = curve.evaluate_tangent(0.5);
        assert!(tangent.x > 0.0);
        assert!(tangent.z > 0.0);
    }

    #[test]
    fn test_hidden_lane_and_stealth_routing() {
        let mut network = LaneGraph3D::new();
        let n1 = network.add_node(Vec3::new(0.0, 0.0, 0.0), NodeType::GroundIntersection);
        let n2 = network.add_node(Vec3::new(100.0, 0.0, 0.0), NodeType::GroundIntersection);

        let _l_pub = network.add_lane(n1, n2, None, RoadClass::AsphaltUrban).unwrap();
        let l_secret = network.add_lane_with_options(n1, n2, None, RoadClass::SmugglerTrail, true, 0.9).unwrap();

        let secret_path = network.find_path_3d_with_preference(n1, n2, true).unwrap();
        assert_eq!(secret_path, vec![l_secret]);
    }

    #[test]
    fn test_world_engine_simulation() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_geo_aware_city(35);
        assert!(!world.network.node_map.is_empty());

        for _ in 0..10 {
            world.spawn_random_agent(15.0);
        }
        for _ in 0..5 {
            world.spawn_typed_agent(18.0, AgentType::CovertOperative);
        }

        for _ in 0..200 {
            world.tick(0.05);
        }

        let snapshot = world.generate_snapshot();
        assert!(snapshot.tick == 200);
        assert_eq!(snapshot.terrain_cells.len(), 60 * 60);
        assert!(!snapshot.lanes.is_empty());
        assert!(!snapshot.agents.is_empty());
    }
}
