pub mod needs;
pub mod branches;
pub mod evaluate;
pub mod routing;
pub mod harvest;
pub mod seeking;
pub mod scheduler;
pub mod market;

pub use needs::*;
pub use branches::*;
pub use evaluate::*;

// M19: 意图-策略-原语三层解耦架构，ActiveTask 统一生命周期转换器与兼容投影。
pub mod intent;
pub mod strategy;
pub mod primitive;
pub mod observation;
pub mod projection;
pub mod transition;
pub mod preemption;

