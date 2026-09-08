//! Flow & Accord: 确定性微观动线、立体地理与生态生存演化核心模拟库 (sim_core)

pub mod config;
pub mod geo;
pub mod rng;
pub mod spatial;

pub use spatial::{
    Agent3D, AgentId, Curve3D, Gender, House, HouseSnapshot, HouseTier, LaneEdge3D, LaneGraph3D,
    LaneNode3D, NodeType, PoiId, PoiType, PrimitiveActionState, PrimitivePoi, RoadClass, Season,
    Vec3, World3DEngine, WorldSnapshot3D,
};

pub use geo::{GeoCell, TerrainMap};

pub use rng::WorldRng;
