//! 外部市场（榷场互市）商贸决策子模块 (market.rs)
//!
//! 负责 B15MarketTrade 需求分支评估、赴市场寻路中的可用性守卫，
//! 以及在市场现场交易完成后的返航调度。保持 branches.rs 与 evaluate.rs 精简。

use super::super::agent::{Agent3D, Gender, PrimitiveActionState};
use super::super::graph::NodeId;
use super::super::ledger::journal::ResourceKind;
use super::evaluate::Decisioner;
use super::needs::*;

impl<'a> Decisioner<'a> {
    /// B15 榷场互市自包含需求判定：
    /// 仅限成年男性户主；生理层兜底档；家户水或粮枯竭且对应野外资源断流时触发。
    pub fn evaluate_market_trade(&self, a: &Agent3D) -> Option<Need> {
        let cfg = self.config;

        // 1. 守卫一：必须为在世成年男性
        if !a.is_alive || a.gender != Gender::Male || a.age < cfg.agent_adult_age {
            return None;
        }

        // 2. 守卫二：必须为家户户主（家庭跟着男人走）
        let Some(hh_id) = self.households.household_of(a.id) else { return None; };
        let Some(hh) = self.households.get(hh_id) else { return None; };
        if hh.group.leader != Some(a.id) {
            return None;
        }

        // 3. 守卫三：自身体力达到起步门槛（防止半路力竭倒毙）
        if a.stamina < cfg.market_min_dispatch_stamina {
            return None;
        }

        // 4. 守卫四：家户金库具备起步支付能力（防止 0.01 金频繁跨图寻路）
        let hh_gold = hh.group.ledger.balance(ResourceKind::Gold);
        if hh_gold < cfg.market_min_family_gold {
            return None;
        }

        // 5. 守卫五：存在急迫需求（OR 逻辑：水或粮短缺且对应野外点对该 Agent 全关）
        let dearth_th = cfg.market_emergency_family_stock_threshold;
        let hh_water = hh.group.ledger.balance(ResourceKind::Water);
        let hh_food = hh.group.ledger.balance(ResourceKind::Food);

        let water_emergency = hh_water < dearth_th && !self.has_available_node(a, NodePool::Water);
        let food_emergency = hh_food < dearth_th && !self.has_available_node(a, NodePool::Food);

        if !water_emergency && !food_emergency {
            return None;
        }

        // 6. 守卫六：全图必须已播撒市场节点
        if self.ctx.market_nodes.is_empty() {
            return None;
        }

        Some(Need {
            level: MaslowLevel::Physiological,
            kind: NeedKind::MarketTrade,
            target_state: PrimitiveActionState::SeekingMarket,
        })
    }

    /// 寻找离 Agent 最近的外部市场路网节点
    pub fn nearest_market_node(&self, agent: &Agent3D) -> Option<NodeId> {
        self.ctx.market_nodes.iter()
            .min_by(|a, b| {
                let pa = self.network.graph[*self.network.node_map.get(&a.node).unwrap()].pos;
                let pb = self.network.graph[*self.network.node_map.get(&b.node).unwrap()].pos;
                pa.distance_to(&agent.world_pos).partial_cmp(&pb.distance_to(&agent.world_pos)).unwrap()
            })
            .map(|rn| rn.node)
    }

    /// 赶往市场途中的决策检查（若体力过低或家户资金耗尽则折返回家）
    pub fn decide_seeking_market(&mut self, agent: &mut Agent3D) {
        let Some(hh_id) = self.households.household_of(agent.id) else {
            agent.current_need = Some("Safety·ReturnHome".to_string());
            self.return_home(agent);
            return;
        };
        let hh_gold = self.households.get(hh_id).map(|hh| hh.group.ledger.balance(ResourceKind::Gold)).unwrap_or(0.0);

        if agent.stamina < self.config.decision_work_stamina_threshold || hh_gold < 0.05 {
            agent.current_need = Some(if agent.stamina < self.config.decision_work_stamina_threshold {
                "Physiological·Rest"
            } else {
                "Safety·ReturnHome"
            }.to_string());
            self.return_home(agent);
        }
    }

    /// 现场交易阶段的周期决策（若行囊装满、资金见底或已解渴饱腹，启程返航）
    pub fn decide_buying_market(&mut self, agent: &mut Agent3D) {
        let carry_cap = self.config.carry_capacity_resource;
        let Some(hh_id) = self.households.household_of(agent.id) else {
            agent.current_need = Some("Safety·ReturnHome".to_string());
            self.return_home(agent);
            return;
        };
        let hh_gold = self.households.get(hh_id).map(|hh| hh.group.ledger.balance(ResourceKind::Gold)).unwrap_or(0.0);

        let bag_full = agent.carried_water >= carry_cap - 0.1 || agent.carried_food >= carry_cap - 0.1;
        let gold_exhausted = hh_gold < 0.05;
        let vitals_critical = agent.stamina < self.config.decision_work_stamina_threshold;

        if bag_full || gold_exhausted || vitals_critical {
            agent.current_need = Some(if vitals_critical {
                "Physiological·Rest"
            } else {
                "Safety·ReturnHome"
            }.to_string());
            self.return_home(agent);
        }
    }
}
