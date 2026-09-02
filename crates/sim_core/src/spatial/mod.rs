pub mod vec3;
pub mod curve;
pub mod graph;
pub mod poi;
pub mod house;
pub mod agent;
pub mod snapshot;
pub mod ecology;
pub mod birth;
pub mod decisions;
pub mod housing_system;
pub mod ledger;
pub mod bookkeeping;
pub mod world;
pub mod world_tick;
pub mod world_snapshot;
pub mod world_config;
pub mod world_season;
pub mod world_save;

pub use vec3::Vec3;
pub use curve::Curve3D;
pub use graph::{LaneGraph3D, LaneNode3D, NodeData, LaneEdge3D, NodeType, RoadClass, NodeId, LaneId};
pub use poi::{PrimitivePoi, PoiType, PoiId};
pub use house::{House, HouseTier, HouseSnapshot};
pub use agent::{Agent3D, PrimitiveActionState, AgentId, Gender};
pub use snapshot::{WorldSnapshot3D, Season, PoiSnapshot, NodeSnapshot, LaneSnapshot, AgentSnapshot, GeoCellSnapshot};
pub use ledger::{Group, GroupKind, Household, HouseholdRegistry, Ledger, LedgerRef, Marriage, MarriageRegistry, ResourceKind, TransferRecord};
pub use world::World3DEngine;
pub use world_save::{
    deserialize_save, serialize_save, WorldSave, SAVE_APP_VERSION, SAVE_FORMAT_VERSION,
};

