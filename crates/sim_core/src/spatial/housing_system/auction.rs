//! auction.rs · 二手房屋市场、营地中介拍卖与麦穗 37% 原则最优停止决策 (v1.14.0)
//!
//! 依据 TODO.md 规范实现：
//! 1. 依托外部市场价格系统（榷市水/粮实时市价；木/石/金榷市暂未承载记 0 单价）计算房屋建设成本等效黄金，0 级仓库享 house_base_foundation_cost_gold 保底；
//! 2. 有闲置土地时按建设成本等效黄金估价，买方按 min(建设成本, 家庭全部黄金) 开价；
//! 3. 无闲置土地时按供求关系估价，买方倾尽家庭全部黄金开价；
//! 4. 营地充当虚拟中介，按麦穗理论 37% 原则（前 37% 观察期只看不卖树立最高标杆，
//!    后 63% 决策期遇到更高报价立即成交，10% 修缮度时限只要有报价选最高强制成交）；
//! 5. 报价历史与成交记录持久沉淀在房屋档案中。

use crate::config::SimConfig;
use crate::spatial::agent::{AgentId, Gender};
use crate::spatial::decisions::needs::upgrade_material_cost;
use crate::spatial::house::{HouseAuctionState, HouseBidRecord, HouseDealRecord, HouseTier};
use crate::spatial::ledger::journal::{LedgerRef, ResourceKind, TransferReason};
use crate::spatial::poi::{market_unit_price, PoiType};
use crate::spatial::world::World3DEngine;

/// 计算某房屋等级累计所需消耗的基础建材总量（从 0 级累加至 tier）
pub fn calculate_house_cumulative_materials(
    tier: HouseTier,
    config: &SimConfig,
) -> [(ResourceKind, f32); 5] {
    let mut water = 0.0;
    let mut food = 0.0;
    let mut wood = 0.0;
    let mut stone = 0.0;
    let mut gold = 0.0;

    let tiers: &[HouseTier] = match tier {
        HouseTier::Tier0Warehouse => &[],
        HouseTier::Tier1ThatchedHut => &[HouseTier::Tier0Warehouse],
        HouseTier::Tier2LeanTo => &[HouseTier::Tier0Warehouse, HouseTier::Tier1ThatchedHut],
        HouseTier::Tier3Homestead => &[
            HouseTier::Tier0Warehouse,
            HouseTier::Tier1ThatchedHut,
            HouseTier::Tier2LeanTo,
        ],
        HouseTier::Tier4Manor => &[
            HouseTier::Tier0Warehouse,
            HouseTier::Tier1ThatchedHut,
            HouseTier::Tier2LeanTo,
            HouseTier::Tier3Homestead,
        ],
    };

    for &t in tiers {
        for (rk, amt) in upgrade_material_cost(t, config) {
            match rk {
                ResourceKind::Water => water += amt,
                ResourceKind::Food => food += amt,
                ResourceKind::Wood => wood += amt,
                ResourceKind::Stone => stone += amt,
                ResourceKind::Gold => gold += amt,
            }
        }
    }

    [
        (ResourceKind::Water, water),
        (ResourceKind::Food, food),
        (ResourceKind::Wood, wood),
        (ResourceKind::Stone, stone),
        (ResourceKind::Gold, gold),
    ]
}

/// 计算某等级房屋建设成本折算等效黄金数量
pub fn calculate_house_construction_cost(
    tier: HouseTier,
    market_water_price: f32,
    market_food_price: f32,
    config: &SimConfig,
) -> f32 {
    let materials = calculate_house_cumulative_materials(tier, config);
    let mut total_gold = 0.0;
    for (rk, qty) in materials {
        if qty <= 0.001 {
            continue;
        }
        // 材料单价全部按当时榷市（榷场互市）原料价计算：水/粮取现时市价；木/石/金榷市暂未承载，暂时记 0 单价
        let unit_price = match rk {
            ResourceKind::Water => market_water_price,
            ResourceKind::Food => market_food_price,
            ResourceKind::Wood => 0.0,
            ResourceKind::Stone => 0.0,
            ResourceKind::Gold => 0.0,
        };
        total_gold += qty * unit_price;
    }
    total_gold.max(config.house_base_foundation_cost_gold)
}

impl World3DEngine {
    /// 提取全图外部市场清水与粮食的当前实时市价（无市场则回退基准价）
    pub(crate) fn market_resource_prices(&self) -> (f32, f32) {
        let market = self.pois.iter().find(|p| p.poi_type == PoiType::Market);
        match market {
            Some(m) => {
                let wp = market_unit_price(m.current_stock, m.max_stock, &self.config);
                let fp = market_unit_price(m.secondary_stock, m.secondary_max_stock, &self.config);
                (wp, fp)
            }
            None => (self.config.market_price_base, self.config.market_price_base),
        }
    }

    /// 二手房屋市场与营地中介拍卖主管线 Tick
    pub(crate) fn tick_housing_auctions(&mut self, _dt: f32) {
        let (market_water_price, market_food_price) = self.market_resource_prices();
        let max_houses_per_camp = self.config.camp_max_houses as usize;

        // 1. 先为全图所有房屋更新实时估价（有主房屋和无主房屋均维护估价展示）
        let camp_house_counts: std::collections::HashMap<u32, usize> = {
            let mut counts = std::collections::HashMap::new();
            for h in &self.houses {
                *counts.entry(h.camp_id).or_insert(0) += 1;
            }
            counts
        };

        // 统计当前有效无房男性户主买方数量
        let homeless_buyer_ids: Vec<AgentId> = self
            .agents
            .iter()
            .filter(|a| {
                a.is_alive
                    && !a.is_fetus
                    && a.gender == Gender::Male
                    && a.age >= self.config.agent_adult_age
                    && a.home_house_id.is_none()
            })
            .map(|a| a.id)
            .collect();

        let total_vacant_houses = self.houses.iter().filter(|h| h.owner_id.is_none()).count();

        for house in &mut self.houses {
            let const_cost = calculate_house_construction_cost(
                house.tier,
                market_water_price,
                market_food_price,
                &self.config,
            );
            let camp_count = camp_house_counts.get(&house.camp_id).copied().unwrap_or(0);
            let has_idle_land = camp_count < max_houses_per_camp;

            let valuation = if has_idle_land {
                const_cost
            } else {
                let supply = total_vacant_houses.max(1) as f32;
                let demand = homeless_buyer_ids.len().max(1) as f32;
                const_cost * (demand / supply)
            };
            house.current_valuation = valuation;
        }

        // 2. 仅在开价评估周期到来时推进竞价与成交判定（错峰节拍）
        if self.tick_counter % self.config.house_market_bidding_interval_ticks != 0 {
            return;
        }

        // 3. 收集当前无主空置房索引
        let vacant_indices: Vec<usize> = self
            .houses
            .iter()
            .enumerate()
            .filter(|(_, h)| h.owner_id.is_none())
            .map(|(i, _)| i)
            .collect();

        if vacant_indices.is_empty() {
            return;
        }

        // 4. 对每一栋空置房执行麦穗 37% 评估与拍卖逻辑
        for &h_idx in &vacant_indices {
            let _house_id = self.houses[h_idx].id;
            let camp_id = self.houses[h_idx].camp_id;
            let durability = self.houses[h_idx].durability;
            let valuation = self.houses[h_idx].current_valuation;
            let tier = self.houses[h_idx].tier;
            let const_cost = calculate_house_construction_cost(
                tier,
                market_water_price,
                market_food_price,
                &self.config,
            );
            let camp_count = camp_house_counts.get(&camp_id).copied().unwrap_or(0);
            let has_idle_land = camp_count < max_houses_per_camp;

            // 初始化或获取拍卖现场状态
            let (start_dur, benchmark_bid) = match &self.houses[h_idx].auction_state {
                Some(st) => (st.start_durability, st.benchmark_bid),
                None => {
                    let st = HouseAuctionState {
                        start_durability: durability,
                        benchmark_bid: 0.0,
                        current_highest_bid: 0.0,
                        current_highest_bidder: None,
                    };
                    self.houses[h_idx].auction_state = Some(st);
                    (durability, 0.0)
                }
            };

            let deadline = self.config.house_auction_deadline_durability;
            let obs_ratio = self.config.house_auction_observation_ratio;
            let obs_dur_threshold = if start_dur > deadline {
                start_dur - obs_ratio * (start_dur - deadline)
            } else {
                deadline
            };

            // 划分当前拍卖阶段
            let phase_name = if durability > obs_dur_threshold {
                "观察期"
            } else if durability > deadline {
                "决策期"
            } else {
                "出清期"
            };

            // 轮询全体潜在无房买方生成本轮开价
            let mut round_bids: Vec<(AgentId, u64, f32)> = Vec::new();
            for &bidder_id in &homeless_buyer_ids {
                // 检查该买方当前家户黄金余额
                let Some(hh_id) = self.household_registry.household_of(bidder_id) else {
                    continue;
                };
                let Some(hh) = self.household_registry.get(hh_id) else {
                    continue;
                };
                let hh_gold = hh.group.ledger.balance(ResourceKind::Gold);
                if hh_gold < 0.01 {
                    continue;
                }

                let bid_amount = if has_idle_land {
                    const_cost.min(hh_gold)
                } else {
                    hh_gold
                };

                if bid_amount >= 0.01 {
                    round_bids.push((bidder_id, hh_id, bid_amount));
                }
            }

            // 保持确定性：出价高者优先，同价取 AgentId 小者
            round_bids.sort_by(|a, b| {
                b.2.partial_cmp(&a.2)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.0.cmp(&b.0))
            });

            // 将本轮报价存入房屋历史档案
            let tick = self.tick_counter;
            for &(bidder_id, hh_id, amount) in &round_bids {
                self.houses[h_idx].bids_history.push(HouseBidRecord {
                    tick,
                    bidder_id,
                    household_id: hh_id,
                    amount,
                    durability,
                    valuation,
                    phase: phase_name.to_string(),
                });
            }

            let top_round_bid = round_bids.first().copied();

            // 更新最高出价记录
            if let Some((bidder_id, _, amount)) = top_round_bid {
                if let Some(st) = &mut self.houses[h_idx].auction_state {
                    if amount > st.current_highest_bid {
                        st.current_highest_bid = amount;
                        st.current_highest_bidder = Some(bidder_id);
                    }
                }
            }

            // 执行虚拟卖方（营地中介）麦穗 37% 决策逻辑
            let mut deal_to_execute: Option<(AgentId, u64, f32, String)> = None;

            if phase_name == "观察期" {
                // 阶段一：37% 观察期（只摸底不卖，建立最高出价标杆）
                if let Some((_, _, amount)) = top_round_bid {
                    if let Some(st) = &mut self.houses[h_idx].auction_state {
                        if amount > st.benchmark_bid {
                            st.benchmark_bid = amount;
                        }
                    }
                }
            } else if phase_name == "决策期" {
                // 阶段二：决策期（若出现 bid > benchmark_bid，立即成交）
                if let Some((bidder_id, hh_id, amount)) = top_round_bid {
                    if amount > benchmark_bid && amount > 0.01 {
                        deal_to_execute = Some((
                            bidder_id,
                            hh_id,
                            amount,
                            "麦穗决策期击中更高报价".to_string(),
                        ));
                    }
                }
            } else {
                // 阶段三：最晚出售时限（修缮度 <= 10.0%），只要有出价就必须选最高出价成交
                // 检索该房屋历史所有出价记录中当前依然有效（依然在世、无房且付得起）的最高出价者
                let mut best_historical_bid: Option<(AgentId, u64, f32)> = None;

                for bid_rec in self.houses[h_idx].bids_history.iter().rev() {
                    let b_id = bid_rec.bidder_id;
                    let b_alive_homeless = self.agents.iter().any(|a| {
                        a.id == b_id && a.is_alive && !a.is_fetus && a.home_house_id.is_none()
                    });
                    if !b_alive_homeless {
                        continue;
                    }
                    let Some(hh_id) = self.household_registry.household_of(b_id) else {
                        continue;
                    };
                    let Some(hh) = self.household_registry.get(hh_id) else {
                        continue;
                    };
                    let hh_gold = hh.group.ledger.balance(ResourceKind::Gold);
                    let payable = bid_rec.amount.min(hh_gold);
                    if payable < 0.01 {
                        continue;
                    }

                    let is_better = match best_historical_bid {
                        None => true,
                        Some((_, _, best_amt)) => payable > best_amt,
                    };
                    if is_better {
                        best_historical_bid = Some((b_id, hh_id, payable));
                    }
                }

                if let Some((b_id, hh_id, amount)) = best_historical_bid {
                    deal_to_execute = Some((
                        b_id,
                        hh_id,
                        amount,
                        "10%修缮度最后时限最高价强制成交".to_string(),
                    ));
                }
            }

            // 执行成交交割与所有权确权
            if let Some((buyer_id, buyer_hh, price, reason)) = deal_to_execute {
                self.execute_house_deal(h_idx, buyer_id, buyer_hh, price, reason);
            }
        }
    }

    /// 执行房屋拍卖成交交割
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
        let camp_id = self.houses[house_idx].camp_id;
        let durability = self.houses[house_idx].durability;
        let valuation = self.houses[house_idx].current_valuation;
        let door_node = self.houses[house_idx].door_node_id;

        // 1. 账本扣款与资金划转：买方家庭支付黄金 -> 营地所属地区公仓
        if let Some(hh) = self.household_registry.get_mut(buyer_hh) {
            hh.group.ledger.debit(ResourceKind::Gold, price);
            hh.group.ledger.push_transfer(crate::spatial::ledger::journal::TransferRecord {
                tick,
                from: LedgerRef::Family(buyer_hh),
                to: LedgerRef::Region(camp_id),
                resource: ResourceKind::Gold,
                amount: price,
                reason: TransferReason::HousingPurchase,
            });
        }
        if let Some(region) = self.region_registry.regions.get_mut(&camp_id) {
            region.group.ledger.credit(ResourceKind::Gold, price);
            region.group.ledger.push_transfer(crate::spatial::ledger::journal::TransferRecord {
                tick,
                from: LedgerRef::Family(buyer_hh),
                to: LedgerRef::Region(camp_id),
                resource: ResourceKind::Gold,
                amount: price,
                reason: TransferReason::HousingPurchase,
            });
        }

        // 2. 房屋所有权变更
        let spouse_id = self
            .agents
            .iter()
            .find(|a| a.id == buyer_id)
            .and_then(|a| a.spouse_id);

        self.houses[house_idx].owner_id = Some(buyer_id);
        self.houses[house_idx].spouse_id = spouse_id;
        self.houses[house_idx].auction_state = None;

        // 3. 买方与家属确权入住
        for a in &mut self.agents {
            if a.id == buyer_id {
                a.home_house_id = Some(house_id);
                a.home_camp_node = door_node;
            } else if Some(a.id) == spouse_id {
                a.home_house_id = Some(house_id);
                a.home_camp_node = door_node;
            } else if a.is_alive && a.father_id == Some(buyer_id) {
                // 随父入宅
                a.home_house_id = Some(house_id);
                a.home_camp_node = door_node;
            }
        }

        // 4. 从营地空置房屋列表中移出
        for p in &mut self.pois {
            if p.poi_type == PoiType::Camp && p.id == camp_id {
                p.vacant_houses.retain(|vh| vh.house_id != house_id);
            }
        }

        // 5. 永久沉淀成交记录到房屋档案
        let total_bids = self.houses[house_idx].bids_history.len();
        self.houses[house_idx].deal_history.push(HouseDealRecord {
            deal_tick: tick,
            buyer_id,
            household_id: buyer_hh,
            price,
            durability,
            valuation,
            camp_id,
            total_bids_count: total_bids,
            reason: reason.clone(),
        });

        // 6. 播报成交事件
        let camp_name = self
            .pois
            .iter()
            .find(|p| p.poi_type == PoiType::Camp && p.id == camp_id)
            .map(|p| p.camp_title())
            .unwrap_or_else(|| "营地".to_string());

        self.last_event = Some(format!(
            "🎉 营地【{}】中介促成房屋拍卖！族人 #{} ♂ 以 {:.2} 金拍得 #{} 号房屋（修缮度 {:.1}%，{}）！",
            camp_name, buyer_id, price, house_id, durability, reason
        ));
    }
}
