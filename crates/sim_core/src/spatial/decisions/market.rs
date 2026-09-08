//! 外部市场（榷场互市）商贸决策子模块 (market.rs)
//!
//! 市场是水、粮、木资源意图的一种执行策略，不再是独立需求分支。
//! 本模块负责策略可行性、采集/采购选择与市场现场退出判定。

use super::super::agent::{Agent3D, Gender};
use super::super::graph::NodeId;
use super::super::ledger::journal::ResourceKind;
use super::evaluate::Decisioner;
use super::needs::*;

impl<'a> Decisioner<'a> {
    /// 当前资源意图是否至少有一种可行策略（野外采集或市场采购）。
    pub fn can_procure_resource(&self, a: &Agent3D, pool: NodePool) -> bool {
        self.has_available_node(a, pool) || self.can_buy_resource(a, pool)
    }

    /// 市场采购的基础可行性；只适用于水、粮、木。
    pub fn can_buy_resource(&self, a: &Agent3D, pool: NodePool) -> bool {
        let cfg = self.config;
        if !matches!(pool, NodePool::Water | NodePool::Food | NodePool::Wood)
            || self.ctx.market_nodes.is_empty()
            || !a.is_alive
            || a.gender != Gender::Male
            || a.age < cfg.agent_adult_age
            || a.stamina
                < cfg
                    .market_min_dispatch_stamina
                    .max(cfg.decision_work_stamina_threshold)
        {
            return false;
        }
        self.households
            .household_of(a.id)
            .and_then(|hid| self.households.get(hid))
            .map(|hh| {
                hh.group.leader == Some(a.id)
                    && hh.group.ledger.balance(ResourceKind::Gold) >= cfg.market_min_family_gold
            })
            .unwrap_or(false)
    }

    /// L2 选策：野外断流必选市场；富裕或高智力户主可比较成本后主动采购。
    pub fn should_buy_resource(&self, a: &Agent3D, pool: NodePool) -> bool {
        if !self.can_buy_resource(a, pool) {
            return false;
        }
        if !self.has_available_node(a, pool) {
            return true;
        }
        let Some(hh_id) = self.households.household_of(a.id) else {
            return false;
        };
        let Some(hh) = self.households.get(hh_id) else {
            return false;
        };
        let gold = hh.group.ledger.balance(ResourceKind::Gold);
        let wealthy = gold >= self.config.market_wealthy_family_gold
            && gentry_labor_exemption_check(
                a.id,
                self.tick,
                self.config.agent_decision_interval_ticks,
            );
        if wealthy {
            return true;
        }
        if a.intelligence < self.config.trait_high_threshold
            || gold < self.config.market_poor_family_gold
        {
            return false;
        }
        let Some(market) = self.nearest_market_node(a) else {
            return false;
        };
        let Some(wild) = self.nearest_of(a, pool, a.world_pos) else {
            return true;
        };
        let market_dist = self.node_pos(market).distance_to(&a.world_pos);
        let wild_dist = self.node_pos(wild).distance_to(&a.world_pos);
        market_dist < wild_dist || wild_dist > 70.0
    }

    /// 寻找离 Agent 最近的外部市场路网节点
    pub fn nearest_market_node(&self, agent: &Agent3D) -> Option<NodeId> {
        self.ctx
            .market_nodes
            .iter()
            .min_by(|a, b| {
                let pa = self.network.graph[*self.network.node_map.get(&a.node).unwrap()].pos;
                let pb = self.network.graph[*self.network.node_map.get(&b.node).unwrap()].pos;
                pa.distance_to(&agent.world_pos)
                    .partial_cmp(&pb.distance_to(&agent.world_pos))
                    .unwrap()
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
        let hh_gold = self
            .households
            .get(hh_id)
            .map(|hh| hh.group.ledger.balance(ResourceKind::Gold))
            .unwrap_or(0.0);

        if agent.stamina < self.config.decision_work_stamina_threshold || hh_gold < 0.05 {
            agent.current_need = Some(
                if agent.stamina < self.config.decision_work_stamina_threshold {
                    "Physiological·Rest"
                } else {
                    "Safety·ReturnHome"
                }
                .to_string(),
            );
            self.return_home(agent);
        }
    }

    /// 现场交易阶段的周期决策（若行囊无法再完成一笔结算、资金见底或体力不足，启程返航）
    pub fn decide_buying_market(&mut self, agent: &mut Agent3D) {
        let carry_cap = self.config.carry_capacity_resource;
        let Some(hh_id) = self.households.household_of(agent.id) else {
            agent.current_need = Some("Safety·ReturnHome".to_string());
            self.return_home(agent);
            return;
        };
        let hh_gold = self
            .households
            .get(hh_id)
            .map(|hh| hh.group.ledger.balance(ResourceKind::Gold))
            .unwrap_or(0.0);

        // Market settlement moves only whole `market_settlement_step` units. Keep
        // this exit guard aligned with ecology's `space >= step` trade gate: an
        // agent that cannot fit another settlement must return home instead of
        // remaining at the market with no executable trade.
        let settlement_step = self.config.market_settlement_step;
        let bag_cannot_accept_settlement = carry_cap - agent.carried_water < settlement_step
            || carry_cap - agent.carried_food < settlement_step
            || carry_cap - agent.carried_wood < settlement_step;
        let gold_exhausted = hh_gold < 0.05;
        let vitals_critical = agent.stamina < self.config.decision_work_stamina_threshold;

        if bag_cannot_accept_settlement || gold_exhausted || vitals_critical {
            agent.current_need = Some(
                if vitals_critical {
                    "Physiological·Rest"
                } else {
                    "Safety·ReturnHome"
                }
                .to_string(),
            );
            self.return_home(agent);
        }
    }
}
