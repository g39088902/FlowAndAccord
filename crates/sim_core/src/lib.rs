//! Flow & Accord: 确定性微观动线、立体地理与政治演化核心模拟库 (sim_core)

pub mod spatial;
pub mod geo;

pub use spatial::{
    Vec3, Curve3D, LaneGraph3D, LaneNode3D, LaneEdge3D, NodeType, RoadClass,
    Agent3D, AgentState, AgentType, World3DEngine, WorldSnapshot3D,
};

pub use geo::{
    GeoCell, TerrainMap,
};
