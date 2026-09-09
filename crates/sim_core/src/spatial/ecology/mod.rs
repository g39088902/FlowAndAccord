//! 生态层：世界初始化播撒与 POI 物理交互结算。
//!
//! 原 `ecology.rs` 单文件 1107 行已超根 AGENTS.md §4.6 的 800 行规范，
//! 按职责拆为单一职责子模块（**纯代码搬运，行为与 RNG 消费顺序完全不变**）：
//!
//! | 文件 | 职责 |
//! | :--- | :--- |
//! | `seed.rs` | 世界重置 + 播撒步骤编排 + 收尾（事件文案/索引/脏标记/APSP） |
//! | `spawn.rs` | POI 播撒、地形过渡节点、全图路网连接、始祖出生地兜底节点 |
//! | `founder.rs` | 始祖 Agent 生成 + 家户/宗族/地区/帝国制度登记 |
//! | `tick.rs` | `tick_poi_interactions` 调度壳（遍历/胎儿跳过/分娩委托/尸骸清理） |
//! | `harvest.rs` | 现场采收（水/粮/木/石/金）与榷场采购结算 |
//! | `home.rs` | 回家卸货入账与在家吃喝 |
//!
//! 行为契约见 `spatial/AGENTS.md` §3.1（agent ↔ ecology 装载/卸货契约）与 §二（tick 顺序）。

mod founder;
mod harvest;
mod home;
mod seed;
mod spawn;
mod tick;
