//! Flow & Accord: 确定性微观动线、立体地理与生态生存演化核心模拟库 (sim_core)

pub mod rng;
pub mod spatial;
pub mod geo;

pub use spatial::{
    Vec3, Curve3D, LaneGraph3D, LaneNode3D, LaneEdge3D, NodeType, RoadClass,
    PrimitivePoi, PoiType, PoiId,
    Agent3D, PrimitiveActionState, AgentId, Gender,
    House, HouseTier, HouseSnapshot,
    World3DEngine, WorldSnapshot3D, Season,
};

pub use geo::{
    GeoCell, TerrainMap,
};

pub use rng::WorldRng;
