//! auction.rs · 二手房屋市场与营地中介麦穗 37% 连续报价 (v1.26.0)
//!
//! v1.26.0 重构（依据 TODO.md 与 AGENTS.md §4.11 自主决策原则）：
//! 1. 删除房屋估价机制（current_valuation / 建设成本折算 / 双轨估价 / D/S 供求比），
//!    估价不参与任何成交判定，纯展示字段彻底移除；
//! 2. 出价下沉到 agent 个体决策相位——`B17BidHouse` 分支写 `pending_bid_house_ids`，
//!    本文件只承担世界物理执行器 `execute_pending_bids` 与成交交割 `execute_house_deal`；
//! 3. 成交判定改为「新报价驱动」：只有新报价落下的那一刻才瞬时判定，不再回溯历史报价；
//! 4. 成交价款按份额制分账：王国公户（权重可配）与遗产受益人（在世配偶 + 在世子女各 1 份）共分，
//!    无人类受益人时王国独得（天然兜底，零特判）；
//! 5. 报价流水随拍卖会话（HouseAuctionState）生命周期存在，不跨场次。

use crate::config::SimConfig;
use crate::spatial::agent::{AgentId, Gender};
use crate::spatial::graph::NodeId;
use crate::spatial::house::{HouseAuctionState, HouseBidRecord, HouseDealRecord};
use crate::spatial::ledger::journal::{LedgerRef, ResourceKind, TransferReason, TransferRecord};
use crate::spatial::poi::{PoiType, VacantHouseEntry};
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// 计算某空置房屋当前拍卖阶段名称（口径与 world_snapshot.rs 保持一致）
    fn auction_phase_name(house_durability: f32, state: &HouseAuctionState, config: &SimConfig) -> String {
        let deadline = config.house_auction_deadline_durability;
        let obs_ratio = config.house_auction_observation_ratio;
        let obs_dur = if state.start_durability > deadline {
            state.start_durability - obs_ratio * (state.start_durability - deadline)
        } else {
            deadline
        };
        if house_durability > obs_dur {
            "观察期".to_string()
        } else if house_durability > deadline {
            "决策期".to_string()
        } else {
            "出清期".to_string()
        }
    }

    /// ★ v1.30.0 决策期标杆衰减：麦穗决策期无人击穿标杆时，标杆按
    /// `house_auction_benchmark_decay_rate`（金/模拟秒）线性下调，直至出价底价兜底。
    /// 解决「观察期高标杆 + 决策期全民钱袋空」双锁死导致的必然流拍：
    /// 标杆跌回购买力区间后，执行器现有的 `amount >= benchmark` 判定自然恢复成交。
    /// 仅决策期衰减（观察期仍在摸底树立标杆；出清期本就有新报价即成交），不耗 RNG、确定性。
    pub fn tick_auction_benchmark_decay(&mut self) {
        let rate = self.config.house_auction_benchmark_decay_rate;
        if rate <= 0.0 {
            return;
        }
        let dt = self.config.simulation_dt;
        let deadline = self.config.house_auction_deadline_durability;
        let obs_ratio = self.config.house_auction_observation_ratio;
        let floor = self.config.house_auction_min_bid_gold;
        for h in &mut self.houses {
            let Some(st) = h.auction_state.as_mut() else {
                continue;
            };
            let obs_dur = if st.start_durability > deadline {
                st.start_durability - obs_ratio * (st.start_durability - deadline)
            } else {
                deadline
            };
            // 仅决策期衰减：durability ∈ (deadline, obs_dur]
            if h.durability > obs_dur || h.durability <= deadline {
                continue;
            }
            st.benchmark_bid = (st.benchmark_bid - rate * dt).max(floor);
        }
    }

    /// ★ 改善型换房：把无房户或有房户主自主写下的竞买决心落地
    /// （决策器只下决心，本方法只做物理结算：校验 → 出价 → 判阶段 → 交割，不扫描指挥）
    /// ★ v1.31.0 一次决心对多套在售房倾囊出价：按 agent id / 房屋 id 双升序逐个落地，
    /// 首套成交即停（一人一房铁律），该 agent 对同 tick 其余房源出价作废。
    pub fn execute_pending_bids(&mut self) {
        let tick = self.tick_counter;

        // 收集本拍决心（按 agent id 升序；每 agent 一组升序房屋 ID，保证确定性）
        let mut pending: Vec<(AgentId, Vec<u32>)> = Vec::new();
        for agent in &self.agents {
            if !agent.pending_bid_house_ids.is_empty() {
                pending.push((agent.id, agent.pending_bid_house_ids.clone()));
            }
        }
        if pending.is_empty() {
            return;
        }
        pending.sort_by_key(|(aid, _)| *aid);

        for (bidder_id, house_ids) in pending {
            // 清空决心（本拍已消耗，无论资格是否通过）
            if let Some(a) = self.agent_by_id_mut(bidder_id) {
                a.pending_bid_house_ids.clear();
            }

            // 资格复核（agent 粒度一次）：在世 / 非胎儿 / 成年男性 / 冷却结束
            let eligible = self
                .agent_by_id(bidder_id)
                .map(|a| {
                    a.is_alive
                        && !a.is_fetus
                        && a.gender == Gender::Male
                        && a.age >= self.config.agent_adult_age
                        && a.last_bid_tick
                            .map(|t| tick >= t && tick - t >= self.config.house_auction_bid_cooldown_ticks)
                            .unwrap_or(true)
                })
                .unwrap_or(false);
            if !eligible {
                continue;
            }

            // 家户黄金（无出价上限，倾囊）
            let Some(hh_id) = self.household_registry.household_of(bidder_id) else {
                continue;
            };
            let hh_gold = self
                .household_registry
                .get(hh_id)
                .map(|hh| hh.group.ledger.balance(ResourceKind::Gold))
                .unwrap_or(0.0);
            if hh_gold < self.config.house_auction_min_bid_gold {
                continue;
            }
            let amount = hh_gold; // ★ v1.31.0 倾囊出价（金额 = 家户全部黄金）

            let mut did_bid = false;
            for house_id in house_ids {
                // 目标房屋仍在售且存在拍卖会话
                let Some(house_idx) = self
                    .houses
                    .iter()
                    .position(|h| h.id == house_id && h.owner_id.is_none())
                else {
                    continue;
                };
                if self.houses[house_idx].auction_state.is_none() {
                    continue;
                }

                // 写入本次拍卖会话报价流水（环形缓冲，超容量淘汰最旧）
                let durability = self.houses[house_idx].durability;
                let phase = {
                    let st = self.houses[house_idx].auction_state.as_ref().unwrap();
                    Self::auction_phase_name(durability, st, &self.config)
                };
                let capacity = self.config.house_auction_bid_history_capacity.max(1);
                if let Some(st) = &mut self.houses[house_idx].auction_state {
                    st.bids_history.push_back(HouseBidRecord {
                        tick,
                        bidder_id,
                        household_id: hh_id,
                        amount,
                        durability,
                        phase: phase.clone(),
                    });
                    if st.bids_history.len() > capacity {
                        st.bids_history.pop_front();
                    }
                    if amount > st.current_highest_bid {
                        st.current_highest_bid = amount;
                        st.current_highest_bidder = Some(bidder_id);
                    }
                }

                // 阶段判定（新报价驱动：仅在本拍有报价时才判定，不回溯历史）
                let deal_reason = if phase == "观察期" {
                    // 只抬标杆，不成交
                    if let Some(st) = &mut self.houses[house_idx].auction_state {
                        if amount > st.benchmark_bid {
                            st.benchmark_bid = amount;
                        }
                    }
                    None
                } else if phase == "决策期" {
                    let bench = self
                        .houses[house_idx]
                        .auction_state
                        .as_ref()
                        .map(|st| st.benchmark_bid)
                        .unwrap_or(0.0);
                    if amount >= bench {
                        Some("麦穗决策期击中更高报价".to_string())
                    } else {
                        None
                    }
                } else {
                    // 出清期：有新报价即成交
                    Some("10%修缮度时限新报价成交".to_string())
                };

                did_bid = true;
                if let Some(reason) = deal_reason {
                    self.execute_house_deal(house_idx, bidder_id, hh_id, amount, reason);
                    // ★ v1.31.0 一人一房铁律：成交一套即停
                    break;
                }
            }

            // 本拍至少落一笔报价 → 写出价冷却
            if did_bid {
                if let Some(a) = self.agent_by_id_mut(bidder_id) {
                    a.last_bid_tick = Some(tick);
                }
            }
        }
    }

    /// 成交交割：扣买方家户全额 → 份额制分账 → 过户 → 迁入/清残留 → 沉淀档案
    fn execute_house_deal(
        &mut self,
        house_idx: usize,
        buyer_id: AgentId,
        buyer_hh: u64,
        price: f32,
        reason: String,
    ) {
        let tick = self.tick_counter;
        let house_id = self.houses[house_idx].id;
        let replaced_house_id = self.agent_by_id(buyer_id).and_then(|a| a.home_house_id);
        let camp_id = self.houses[house_idx].camp_id;
        let durability = self.houses[house_idx].durability;
        let door_node = self.houses[house_idx].door_node_id;

        // 1. 买方家户扣全额黄金
        if let Some(hh) = self.household_registry.get_mut(buyer_hh) {
            hh.group.ledger.debit(ResourceKind::Gold, price);
        }

        // 2. 读取本次拍卖会话的报价条数（必须在置空 auction_state 之前）
        let total_bids = self.houses[house_idx]
            .auction_state
            .as_ref()
            .map(|st| st.bids_history.len())
            .unwrap_or(0);
        let voluntary_seller_hh = self.houses[house_idx]
            .auction_state.as_ref()
            .and_then(|st| st.voluntary_seller_household_id);

        // 3. 主动换房旧房的成交款归原家户；遗产房沿用王国公户+受益人分账。
        if let Some(seller_hh) = voluntary_seller_hh {
            if let Some(hh) = self.household_registry.get_mut(seller_hh) {
                hh.group.ledger.credit(ResourceKind::Gold, price);
                hh.group.ledger.push_transfer(TransferRecord {
                    tick, from: LedgerRef::Family(buyer_hh), to: LedgerRef::Family(seller_hh),
                    resource: ResourceKind::Gold, amount: price, reason: TransferReason::HousingPurchase,
                });
            }
        }

        // 4. 份额制分账（王国公户 + 遗产受益人）
        if voluntary_seller_hh.is_some() {
            // 主动出售已完成卖方入账，不再进入遗产受益人分账。
        } else {
        let beneficiary_ids = self
            .pois
            .iter()
            .find(|p| p.poi_type == PoiType::Camp && p.id == camp_id)
            .and_then(|p| p.vacant_houses.iter().find(|vh| vh.house_id == house_id))
            .map(|vh| vh.beneficiary_ids.clone())
            .unwrap_or_default();

        // 有效受益人 = 在世 + 非胎儿 + 有家户
        let mut valid_beneficiaries: Vec<(AgentId, u64)> = Vec::new();
        for &bid in &beneficiary_ids {
            let alive = self
                .agent_by_id(bid)
                .map(|a| a.is_alive && !a.is_fetus)
                .unwrap_or(false);
            if !alive {
                continue;
            }
            if let Some(hid) = self.household_registry.household_of(bid) {
                valid_beneficiaries.push((bid, hid));
            }
        }

        let crown_weight = self.config.house_auction_crown_share_weight.max(0.0);
        let total_units = crown_weight + valid_beneficiaries.len() as f32;
        let share = if total_units > 0.0 { price / total_units } else { 0.0 };
        // 失效受益人（已故/无家户）的份额并入王国公户，保证金额守恒
        let invalid_count = beneficiary_ids.len().saturating_sub(valid_beneficiaries.len()) as f32;
        let crown_share = crown_weight * share + invalid_count * share;

        // 王国公户份额入地区公仓
        if crown_share > 0.001 {
            if let Some(region) = self.region_registry.regions.get_mut(&camp_id) {
                region.group.ledger.credit(ResourceKind::Gold, crown_share);
                region.group.ledger.push_transfer(TransferRecord {
                    tick,
                    from: LedgerRef::Family(buyer_hh),
                    to: LedgerRef::Region(camp_id),
                    resource: ResourceKind::Gold,
                    amount: crown_share,
                    reason: TransferReason::TransferTax,
                });
            }
            if let Some(hh) = self.household_registry.get_mut(buyer_hh) {
                hh.group.ledger.push_transfer(TransferRecord {
                    tick,
                    from: LedgerRef::Family(buyer_hh),
                    to: LedgerRef::Region(camp_id),
                    resource: ResourceKind::Gold,
                    amount: crown_share,
                    reason: TransferReason::TransferTax,
                });
            }
        }

        // 受益人份额入各自家户
        for &(_, hid) in &valid_beneficiaries {
            if share <= 0.001 {
                break;
            }
            if let Some(hh) = self.household_registry.get_mut(hid) {
                hh.group.ledger.credit(ResourceKind::Gold, share);
                hh.group.ledger.push_transfer(TransferRecord {
                    tick,
                    from: LedgerRef::Family(buyer_hh),
                    to: LedgerRef::Family(hid),
                    resource: ResourceKind::Gold,
                    amount: share,
                    reason: TransferReason::EstateShare,
                });
            }
            if let Some(hh) = self.household_registry.get_mut(buyer_hh) {
                hh.group.ledger.push_transfer(TransferRecord {
                    tick,
                    from: LedgerRef::Family(buyer_hh),
                    to: LedgerRef::Family(hid),
                    resource: ResourceKind::Gold,
                    amount: share,
                    reason: TransferReason::EstateShare,
                });
            }
        }

        }

        // 5. 房屋所有权变更（会话随 auction_state=None 一并归档，报价流水不跨场次）
        let spouse_id = self
            .agents
            .iter()
            .find(|a| a.id == buyer_id)
            .and_then(|a| a.spouse_id);
        self.houses[house_idx].owner_id = Some(buyer_id);
        self.houses[house_idx].spouse_id = spouse_id;
        self.houses[house_idx].auction_state = None;

        // 5. 收集需要清出的旧住户（仍指向本房、且非买家家属）——先不可变遍历避免借用冲突
        let mut evictions: Vec<(AgentId, NodeId)> = Vec::new();
        for a in &self.agents {
            if a.home_house_id == Some(house_id)
                && a.id != buyer_id
                && Some(a.id) != spouse_id
                && a.father_id != Some(buyer_id)
            {
                let c_node = self.find_nearest_camp_node(a.world_pos);
                evictions.push((a.id, c_node));
            }
        }

        // 6. 买方与家属确权入住
        for a in &mut self.agents {
            if a.id == buyer_id || Some(a.id) == spouse_id || (a.is_alive && a.father_id == Some(buyer_id)) {
                a.home_house_id = Some(house_id);
                a.home_camp_node = door_node;
            }
        }
        // 清出旧住户（home_camp_node 回最近营地节点）
        for (aid, c_node) in evictions {
            if let Some(a) = self.agent_by_id_mut(aid) {
                a.home_house_id = None;
                a.home_camp_node = c_node;
            }
        }

        // 7. 从营地空置房屋列表移出
        for p in &mut self.pois {
            if p.poi_type == PoiType::Camp && p.id == camp_id {
                p.vacant_houses.retain(|vh| vh.house_id != house_id);
            }
        }

        // 改善型换房：目标房成交后，原房屋才转为空置并延迟挂牌。
        if let Some(old_id) = replaced_house_id {
            if old_id != house_id {
                if let Some(old_idx) = self.houses.iter().position(|h| h.id == old_id && h.owner_id == Some(buyer_id)) {
                    let old_durability = self.houses[old_idx].durability;
                    self.houses[old_idx].owner_id = None;
                    self.houses[old_idx].spouse_id = None;
                    self.houses[old_idx].auction_state = Some(HouseAuctionState {
                        start_durability: old_durability,
                        benchmark_bid: 0.0,
                        current_highest_bid: 0.0,
                        current_highest_bidder: None,
                        bids_history: std::collections::VecDeque::new(),
                        voluntary_seller_household_id: Some(buyer_hh),
                    });
                    self.auction_started = self.auction_started.saturating_add(1);
                    if let Some(camp) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::Camp && p.id == self.houses[old_idx].camp_id) {
                        camp.vacant_houses.push(VacantHouseEntry { house_id: old_id, beneficiary_ids: Vec::new() });
                    }
                }
            }
        }

        // 8. 永久沉淀成交档案到房屋档案
        let final_reason = reason;
        self.houses[house_idx].deal_history.push(HouseDealRecord {
            deal_tick: tick,
            buyer_id,
            household_id: buyer_hh,
            price,
            durability,
            camp_id,
            total_bids_count: total_bids,
            reason: final_reason.clone(),
        });
        self.auction_sold = self.auction_sold.saturating_add(1);

        // 9. 播报成交事件
        let camp_name = self
            .pois
            .iter()
            .find(|p| p.poi_type == PoiType::Camp && p.id == camp_id)
            .map(|p| p.camp_title())
            .unwrap_or_else(|| "营地".to_string());

        self.last_event = Some(format!(
            "🎉 营地【{}】中介促成房屋拍卖！族人 #{} ♂ 以 {:.2} 金拍得 #{} 号房屋（修缮度 {:.1}%，{}）！",
            camp_name, buyer_id, price, house_id, durability, final_reason
        ));
    }
}
