//! survival_diagnosis.rs · STAGE2-6 生存连通与往返成本诊断（★ 独立只读）。
//!
//! 06 号 §5.3 第 11 步 / §5.8「生存诊断」：按**实际配置**枚举初始营地与必需资源
//! （水 / 粮）及市场，逐营地检查路网可达性，并计算坡度/软地折算后的往返成本。
//! 水源 / 浆果往返受代谢成本门槛约束；市场只要求路网可达，不限制往返时间，
//! 即使作为水 / 粮补给的替代 POI 也不受该时间门槛限制。
//! 本模块只读世界（`&self`），不修改任何状态、不触发拒绝或重试——是否据诊断
//! 拒绝并重试由 STAGE2-5 有界回退环决定。
//!
//! 成本口径（与生产寻路 `compute_path_3d_with_preference` 一致的折算）：
//! - 单程时间 = Σ_车道 `curve.length × terrain_time_cost / (speed_limit × level)`
//!   + 上坡惩罚 `Δz × road_astar_grade_penalty_coef`（`level` 取创世态磨损 0 的
//!   `road_level_factor`，即 `road_level_factor_base.clamp(min, max)`）；
//!   `terrain_time_cost` 已含软地（`terrain_soft_ground_cost`）与浅滩
//!   （`terrain_shallow_water_cost`）折算，上坡惩罚即坡度折算；
//! - 预算全部由现有配置推导，**不新增超参**：族人 resource POI / 家宅两端都能
//!   自饮自食满仓再出发（「无家宅者只在现场自饮自食」），现场采收与到家卸货
//!   发生在安全点、不构成途中代谢风险——因此约束是**每一程**都不得耗尽自身
//!   容量，即 `允许往返 = 2 × capacity / 代谢速率`；粮食代谢按名义消化效率
//!   1.0（`digestion_efficiency=100` 的初始族人）；市场互市只记录往返成本，
//!   不设时限门槛。
//!
//! 失败码：`SpawnDisconnected`（营地或资源类无合法路网路径）、
//! `SurvivalCostExceeded`（水 / 粮往返成本超预算）。阈值随默认配置矩阵校准
//! （记录见 06 号 §18.1 / 14 号文 §8.2），不凭地貌名推断安全。
//!
//! ⚠️ 诊断依赖已注入的非零配置（前端 config.js 是默认值真相源）；退化零值
//! 配置下车道限速为 0，所有营地都会如实报 `SpawnDisconnected`。

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

use petgraph::visit::EdgeRef;

use super::graph::{LaneEdge3D, NodeId};
use super::poi::PoiType;
use super::world::World3DEngine;
use crate::config::SimConfig;

/// 名义消化效率（初始族人 `digestion_efficiency = 100` → 折算比 1.0）。
const NOMINAL_DIGESTION_RATIO: f32 = 1.0;

/// 生存诊断失败码。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SurvivalDiagnosticCode {
    /// 营地本身未接入路网，或某必需资源类（水/粮/市场）无任何可达 POI。
    SpawnDisconnected,
    /// 可达但水源 / 浆果往返成本超过代谢预算。
    SurvivalCostExceeded,
}

impl SurvivalDiagnosticCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SpawnDisconnected => "SpawnDisconnected",
            Self::SurvivalCostExceeded => "SurvivalCostExceeded",
        }
    }
}

/// 单个资源类的最优可达链路报告。
#[derive(Debug, Clone)]
pub struct ResourceLinkReport {
    /// 选中的最优资源 POI（按单程路网时间最小）。
    pub poi_id: u32,
    /// 往返成本（仿真秒，含软地/浅滩/坡度折算）。
    pub round_trip_cost_s: f32,
    /// 允许往返预算；选中的 POI 为市场时不设时间门槛，因此为 `None`。
    pub budget_s: Option<f32>,
}

/// 单个营地的生存诊断报告。
#[derive(Debug, Clone)]
pub struct CampSurvivalReport {
    pub camp_poi_id: u32,
    pub camp_node: u32,
    pub water: Option<ResourceLinkReport>,
    pub food: Option<ResourceLinkReport>,
    pub market: Option<ResourceLinkReport>,
    /// 未通过项：`(失败码, 资源类, 详情)`。
    pub failures: Vec<(SurvivalDiagnosticCode, &'static str, String)>,
}

/// 全图生存诊断报告（只读结果，不携带世界状态）。
#[derive(Debug, Clone)]
pub struct SurvivalReport {
    pub camps: Vec<CampSurvivalReport>,
    /// 所有营地全部通过。
    pub ok: bool,
    /// 最严重失败码（SpawnDisconnected 优先于 SurvivalCostExceeded）。
    pub worst_code: Option<SurvivalDiagnosticCode>,
}

/// 必需资源类定义：候选 POI 类型 + 预算来源。
struct ResourceClass {
    name: &'static str,
    types: &'static [PoiType],
}

const CLASS_WATER: ResourceClass = ResourceClass {
    name: "water",
    types: &[PoiType::WaterSource, PoiType::Market],
};
const CLASS_FOOD: ResourceClass = ResourceClass {
    name: "food",
    types: &[PoiType::BerryBush, PoiType::Market],
};
const CLASS_MARKET: ResourceClass = ResourceClass {
    name: "market",
    types: &[PoiType::Market],
};

impl World3DEngine {
    /// STAGE2-6 生存诊断主入口。独立调用、只读、不改变世界；
    /// STAGE2-5 有界回退环据 `report.ok` / `worst_code` 决定拒绝与重试。
    pub fn diagnose_survival(&self) -> SurvivalReport {
        let cfg = &self.config;
        // 往返预算（仿真秒）= 2 × 单程代谢预算（两端满仓出发，见模块注释）。
        let water_budget = 2.0 * cfg.agent_thirst_capacity / cfg.agent_base_metabolism_decay.max(1e-6);
        let food_budget = 2.0 * cfg.agent_hunger_capacity
            / (cfg.agent_base_metabolism_decay.max(1e-6) / NOMINAL_DIGESTION_RATIO);
        let classes = [
            (CLASS_WATER, Some(water_budget)),
            (CLASS_FOOD, Some(food_budget)),
            (CLASS_MARKET, None),
        ];

        let mut camps = Vec::new();
        for poi in self.pois.iter().filter(|p| p.poi_type == PoiType::Camp) {
            let mut report = CampSurvivalReport {
                camp_poi_id: poi.id,
                camp_node: poi.nearest_node_id.unwrap_or(u32::MAX),
                water: None,
                food: None,
                market: None,
                failures: Vec::new(),
            };
            let Some(camp_node) = poi.nearest_node_id else {
                report.failures.push((
                    SurvivalDiagnosticCode::SpawnDisconnected,
                    "camp",
                    "营地未接入路网（nearest_node_id 缺失）".to_string(),
                ));
                camps.push(report);
                continue;
            };
            // 每营地一次单源 Dijkstra（微秒整型权重，确定性无浮点并列问题）。
            let dist = self.lane_time_micros_from(camp_node);
            for (class, budget_s) in &classes {
                // 候选 = 该类 POI 中已接入路网者；最优 = 单程时间最小。
                let mut best: Option<(u64, u32)> = None;
                for cand in self
                    .pois
                    .iter()
                    .filter(|p| class.types.contains(&p.poi_type) && p.id != poi.id)
                {
                    let Some(node) = cand.nearest_node_id else {
                        continue;
                    };
                    // ⚠️ NodeId 与 petgraph NodeIndex 是两套编号（NodeId 从 1 起、
                    // NodeIndex 从 0 起），必须经 node_map 映射，严禁直接混用。
                    let Some(&cidx) = self.network.node_map.get(&node) else {
                        continue;
                    };
                    let Some(&d) = dist.get(&cidx.index()) else {
                        continue;
                    };
                    if best.map_or(true, |(bd, _)| d < bd) {
                        best = Some((d, cand.id));
                    }
                }
                let Some((micros, poi_id)) = best else {
                    report.failures.push((
                        SurvivalDiagnosticCode::SpawnDisconnected,
                        class.name,
                        "该资源类无可达 POI".to_string(),
                    ));
                    continue;
                };
                let round_trip = micros as f32 / 1e6 * 2.0;
                let selected_is_market = self
                    .pois
                    .iter()
                    .any(|candidate| candidate.id == poi_id && candidate.poi_type == PoiType::Market);
                let selected_budget_s = if selected_is_market {
                    None
                } else {
                    *budget_s
                };
                let link = ResourceLinkReport {
                    poi_id,
                    round_trip_cost_s: round_trip,
                    budget_s: selected_budget_s,
                };
                if let Some(allow_s) = selected_budget_s {
                    if round_trip > allow_s {
                        report.failures.push((
                            SurvivalDiagnosticCode::SurvivalCostExceeded,
                            class.name,
                            format!(
                                "往返 {:.1}s 超预算 {:.1}s（最优 POI #{}）",
                                round_trip, allow_s, poi_id
                            ),
                        ));
                    }
                }
                match class.name {
                    "water" => report.water = Some(link),
                    "food" => report.food = Some(link),
                    _ => report.market = Some(link),
                }
            }
            camps.push(report);
        }

        let worst_code = camps
            .iter()
            .flat_map(|c| &c.failures)
            .map(|(code, _, _)| *code)
            .min_by_key(|c| match c {
                SurvivalDiagnosticCode::SpawnDisconnected => 0,
                SurvivalDiagnosticCode::SurvivalCostExceeded => 1,
            });
        SurvivalReport {
            ok: camps.iter().all(|c| c.failures.is_empty()),
            worst_code,
            camps,
        }
    }

    /// 单源 Dijkstra：创世态路网（磨损 0）上从 `start` 出发到各节点的车道通行
    /// 时间，微秒整型权重。不可达节点不出现在结果中。车道限速 ≤ 0 视为不可通行。
    fn lane_time_micros_from(&self, start: NodeId) -> HashMap<usize, u64> {
        let mut dist: HashMap<usize, u64> = HashMap::new();
        let Some(&start_idx) = self.network.node_map.get(&start) else {
            return dist;
        };
        let cfg = &self.config;
        // 创世态磨损为 0 → level = base（与生产寻路同一公式的 wear=0 特例）。
        let level = cfg
            .road_level_factor_base
            .clamp(cfg.road_level_factor_min, cfg.road_level_factor_max)
            .max(1e-6);
        let mut heap: BinaryHeap<Reverse<(u64, usize)>> = BinaryHeap::new();
        dist.insert(start_idx.index(), 0);
        heap.push(Reverse((0u64, start_idx.index())));
        while let Some(Reverse((d, ui))) = heap.pop() {
            if dist.get(&ui).copied() != Some(d) {
                continue; // 过期堆项
            }
            for e in self.network.graph.edges(petgraph::graph::NodeIndex::new(ui)) {
                let w = lane_time_micros(e.weight(), level, cfg);
                if w == u64::MAX {
                    continue;
                }
                let vi = e.target().index();
                let nd = d.saturating_add(w);
                if nd < dist.get(&vi).copied().unwrap_or(u64::MAX) {
                    dist.insert(vi, nd);
                    heap.push(Reverse((nd, vi)));
                }
            }
        }
        dist
    }
}

/// 单条有向车道的通行时间（微秒）。口径与生产寻路一致：
/// `length × terrain_time_cost / (speed_limit × level) + 上坡 Δz × grade_coef`。
fn lane_time_micros(e: &LaneEdge3D, level: f32, cfg: &SimConfig) -> u64 {
    let tc = e.terrain_profile.terrain_time_cost.max(1.0);
    let speed = e.speed_limit * level / tc;
    if !speed.is_finite() || speed <= 0.0 {
        return u64::MAX;
    }
    let mut t = (e.curve.length.max(0.0) as f64) / (speed as f64);
    let dz = (e.curve.p3.z - e.curve.p0.z) as f64;
    if dz > 0.0 {
        t += dz * cfg.road_astar_grade_penalty_coef as f64;
    }
    if !t.is_finite() {
        return u64::MAX;
    }
    (t * 1e6).ceil() as u64
}
