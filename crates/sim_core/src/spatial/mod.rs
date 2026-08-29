pub mod vec3;
pub mod curve;
pub mod graph;
pub mod poi;
pub mod agent;
pub mod world;

pub use vec3::Vec3;
pub use curve::Curve3D;
pub use graph::{LaneGraph3D, LaneNode3D, LaneEdge3D, NodeType, RoadClass, NodeId, LaneId};
pub use poi::{PrimitivePoi, PoiType, PoiId};
pub use agent::{Agent3D, PrimitiveActionState, AgentId};
pub use world::{World3DEngine, WorldSnapshot3D, PoiSnapshot, NodeSnapshot, LaneSnapshot, AgentSnapshot};

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
    }

    #[test]
    fn test_finite_poi_and_reproduction_cycle() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(20);

        assert_eq!(world.pois.len(), 10);
        assert_eq!(world.agents.len(), 20);

        // 运行 250 ticks
        for _ in 0..250 {
            world.tick(0.05);
        }

        let snapshot = world.generate_snapshot();
        assert!(!snapshot.pois.is_empty());
        assert!(!snapshot.agents.is_empty());
    }
}
