//! region.rs · M4 地区与王国系统：地区团体、初王顺位、夺位远征、长子继承、公仓税与救济
//!
//! 隶属「账本与仓库重构」计划 M4。核心原则：
//! - **按营地聚合**：每营地（camp_id 1-5）一册 Region 团体，领导者=国王；
//!   始祖播撒时加入最近营地的 Region，新生儿随父加入父亲所在 Region。
//! - **初王顺位**：初王 = arrival_order 中最早到达的在世男性（arrival_tick 升序 →
//!   并列 agent_id 升序）；无在世男性则王位空悬（leader=None），账本冻结。
//! - **夺位远征**：男性非国王 agent 在存在无主营地时，放下一切冲向最近无主营地登基；
//!   走现有寻路+运动系统，坐标连续不闪现；施工进度冻结不回滚。
//! - **长子继承制**：国王死亡 → 在世最年长儿子 → 孙子 → arrival_order 下一男性 → 空悬。
//! - **公仓税**：每 ledger_tax_interval_ticks 全局统一征收，存续家户按账面余额 × rate
//!   向地区公仓缴纳（只记账不扣物理库存）；只有有国王的地区才征税。
//! - **救济**：公仓充足时对极贫家户（水+粮 < threshold）拨付 Relief，每家户冷却内最多一次。
//! - **确定性**：不消耗 WorldRng；BTreeMap/BTreeSet 保序；排序并列取 id 小者；全局统一征税时点。
//! - **新旧分离**：不 import house.rs 仓储字段；税/救济只记账本余额。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::spatial::agent::{AgentId, Gender};
use crate::spatial::ledger::family::HouseholdId;
use crate::spatial::ledger::group::{Group, GroupKind};
use crate::spatial::ledger::journal::{LedgerRef, ResourceKind, TransferReason, TransferRecord};
use crate::spatial::world::World3DEngine;

/// 五类资源的固定顺序（保证遍历确定性）
const RESOURCE_ORDER: [ResourceKind; 5] = [
    ResourceKind::Water,
    ResourceKind::Food,
    ResourceKind::Wood,
    ResourceKind::Stone,
    ResourceKind::Gold,
];

// ══════════════════════════════════════════════════════════════
// 政体与继承制枚举
// ══════════════════════════════════════════════════════════════

/// 地区政体（M4 仅落地 Kingdom，未来可扩展 Republic/Theocracy 等）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Regime {
    Kingdom, // 👑 王国（世袭君主制）
}

/// 继承制度（M4 仅落地 Primogeniture，未来可扩展 Elective/Tanistry 等）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Succession {
    Primogeniture, // 👑 长子继承制（直系男性后代优先，绝嗣则 arrival_order 顺位）
}

// ══════════════════════════════════════════════════════════════
// Region：单个地区团体（按营地聚合，领导者=国王）
// ══════════════════════════════════════════════════════════════

/// 地区团体：一营地一册，国王=leader，公仓=group.ledger，独有政体与继承制
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Region {
    /// 营地 ID（1-5，与 POI camp_id 对应）
    pub camp_id: u32,
    /// 团体基类（leader=国王, members=地区居民, ledger=公仓）
    pub group: Group,
    /// 政体（Kingdom）
    pub regime: Regime,
    /// 继承制（Primogeniture）
    pub succession: Succession,
    /// 到达时序：按 (arrival_tick, agent_id) 升序排序的 agent_id 列表
    /// 初王顺位与绝嗣继承均依赖此序
    pub arrival_order: Vec<AgentId>,
    /// ★ v1.9.0 历史国王（已离任/驾崩的所有前任国王，不含现任），前端营地卡片展示
    pub history_kings: Vec<AgentId>,
}

impl Region {
    /// 创建空地区（leader=None，账本冻结等待初王）
    pub fn new(camp_id: u32, journal_capacity: usize) -> Self {
        Self {
            camp_id,
            group: Group::new(GroupKind::Region(camp_id), None, journal_capacity),
            regime: Regime::Kingdom,
            succession: Succession::Primogeniture,
            arrival_order: Vec::new(),
            history_kings: Vec::new(),
        }
    }

    /// 更替国王并记录历史国王（历史 = 所有离任/驾崩的前任国王；现任不入档）
    pub fn set_king(&mut self, agent: AgentId, tick: u64, note: &str) -> bool {
        if !self.group.members.contains(&agent) {
            return false;
        }
        if let Some(prev) = self.group.leader {
            if prev != agent && !self.history_kings.contains(&prev) {
                self.history_kings.push(prev);
            }
        }
        self.group.set_leader(agent, tick, note)
    }

    /// 插入 agent 到 arrival_order 的正确位置（按 (arrival_tick, agent_id) 升序）
    /// 调用方需先从 world 读取 agent.arrival_tick
    pub fn insert_arrival(&mut self, agent: AgentId, arrival_tick: u64) {
        if self.arrival_order.contains(&agent) {
            return;
        }
        // 找到第一个 (tick, id) > (arrival_tick, agent) 的位置插入
        let _pos = self.arrival_order.iter().position(|&_a| {
            // 比较逻辑：需要 world 中的 arrival_tick，但这里只按 id 辅助
            // 实际排序由调用方在 add_member 时完成
            false
        }).unwrap_or(self.arrival_order.len());
        // 简化：直接 push，由 RegionRegistry::add_member 统一排序
        let _ = _pos;
        self.arrival_order.push(agent);
    }
}

// ══════════════════════════════════════════════════════════════
// RegionRegistry：按 camp_id 索引的地区团体登记簿
// ══════════════════════════════════════════════════════════════

/// 地区登记簿：按 camp_id 聚合的团体（国王=最早到达在世男性）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionRegistry {
    /// 全部地区（按 camp_id 升序保序遍历）
    pub regions: BTreeMap<u32, Region>,
    /// 每人当前所属 camp_id（唯一归属索引）
    pub by_agent: BTreeMap<AgentId, u32>,
    journal_capacity: usize,
}

impl RegionRegistry {
    pub fn new(journal_capacity: usize) -> Self {
        Self {
            regions: BTreeMap::new(),
            by_agent: BTreeMap::new(),
            journal_capacity: journal_capacity.max(1),
        }
    }

    /// 清空登记簿（世界重置/重播种子时与 agents 清空同步）
    pub fn clear(&mut self) {
        self.regions.clear();
        self.by_agent.clear();
    }

    /// 确保地区存在（不存在则创建空地区，leader=None）
    pub fn ensure_region(&mut self, camp_id: u32) {
        if !self.regions.contains_key(&camp_id) {
            let region = Region::new(camp_id, self.journal_capacity);
            self.regions.insert(camp_id, region);
        }
    }

    /// 按 camp_id 读取地区
    pub fn get(&self, camp_id: u32) -> Option<&Region> {
        self.regions.get(&camp_id)
    }

    /// 按 camp_id 可写读取地区
    pub fn get_mut(&mut self, camp_id: u32) -> Option<&mut Region> {
        self.regions.get_mut(&camp_id)
    }

    /// 某人当前所属 camp_id
    pub fn region_of(&self, agent: AgentId) -> Option<u32> {
        self.by_agent.get(&agent).copied()
    }

    /// 获取某人所在地区的引用
    pub fn get_region_of_agent(&self, agent: AgentId) -> Option<&Region> {
        let camp_id = *self.by_agent.get(&agent)?;
        self.regions.get(&camp_id)
    }

    /// 全部地区迭代（按 camp_id 升序）
    pub fn all_regions(&self) -> impl Iterator<Item = (&u32, &Region)> {
        self.regions.iter()
    }

    /// 加入地区成员（幂等：已是成员返回 false）。自动确保地区存在。
    /// arrival_tick 用于排序 arrival_order。
    pub fn add_member(&mut self, camp_id: u32, agent: AgentId, tick: u64, _arrival_tick: u64) -> bool {
        self.ensure_region(camp_id);
        let region = self.regions.get_mut(&camp_id).expect("region just ensured");
        if !region.group.add_member(agent, tick) {
            return false;
        }
        // 插入 arrival_order 并按 (arrival_tick, agent_id) 排序
        // 由于 arrival_tick 存储在 agent 上，这里用外部传入值排序
        region.arrival_order.push(agent);
        // 排序：需要按 arrival_tick，但我们只有 agent_id 和传入的 arrival_tick
        // 简化方案：在每次 add_member 后，由调用方触发 reorder_arrival
        // 但为了自包含，这里记录一个临时映射
        self.by_agent.insert(agent, camp_id);
        true
    }

    /// 移除地区成员（国王不可被直接移除，返回 false；不存在返回 false）
    pub fn remove_member(&mut self, agent: AgentId, tick: u64) -> bool {
        let Some(camp_id) = self.by_agent.remove(&agent) else {
            return false;
        };
        let removed = self
            .regions
            .get_mut(&camp_id)
            .is_some_and(|r| {
                r.arrival_order.retain(|&a| a != agent);
                r.group.remove_member(agent, tick)
            });
        if !removed {
            // 团体侧拒绝移除（如试图移除国王）：恢复归属索引
            self.by_agent.insert(agent, camp_id);
        }
        removed
    }

    /// 根据 arrival_ticks 映射重排指定地区的 arrival_order
    /// 调用方需先从 world 收集 arrival_ticks（避免借用冲突）
    pub fn reorder_arrival(&mut self, camp_id: u32, arrival_ticks: &std::collections::BTreeMap<AgentId, u64>) {
        let Some(region) = self.regions.get_mut(&camp_id) else { return };
        region.arrival_order.sort_by(|&a, &b| {
            let ta = arrival_ticks.get(&a).copied().unwrap_or(u64::MAX);
            let tb = arrival_ticks.get(&b).copied().unwrap_or(u64::MAX);
            ta.cmp(&tb).then(a.cmp(&b))
        });
    }
}

// ══════════════════════════════════════════════════════════════
// impl World3DEngine：地区与王国系统 tick 逻辑
// ══════════════════════════════════════════════════════════════

impl World3DEngine {
    /// M4 地区与王国系统总入口：初王顺位 → 国王死亡继承 → 公仓税 → 救济
    /// 在 tick() 尾段（tick_clan 之后）调用。
    pub fn tick_region(&mut self, _dt: f32) {
        let tick = self.tick_counter;
        // 先收集所有 agent 的 arrival_tick（避免借用冲突），再重排所有地区的 arrival_order
        let arrival_ticks: std::collections::BTreeMap<AgentId, u64> = self.agents.iter()
            .map(|a| (a.id, a.arrival_tick))
            .collect();
        let camp_ids: Vec<u32> = self.region_registry.regions.keys().copied().collect();
        for camp_id in camp_ids {
            self.region_registry.reorder_arrival(camp_id, &arrival_ticks);
        }
        self.update_kings(tick);
        self.handle_king_deaths(tick);
        self.tick_region_tax(tick);
        self.tick_region_relief(tick);
    }

    // ══════════════════════════════════════════════════════════
    // 初王顺位：arrival_order 中最早到达的在世男性
    // ══════════════════════════════════════════════════════════

    fn update_kings(&mut self, tick: u64) {
        // READ PHASE：收集每个地区的新国王候选
        let mut successions: Vec<(u32, Option<AgentId>)> = Vec::new();

        for (camp_id, region) in &self.region_registry.regions {
            let mut new_king: Option<AgentId> = None;

            // arrival_order 已按 (arrival_tick, agent_id) 升序，第一个在世男性即初王
            for &member_id in &region.arrival_order {
                let Some(agent) = self.agent_by_id(member_id) else { continue };
                if agent.is_alive && agent.gender == Gender::Male {
                    new_king = Some(member_id);
                    break;
                }
            }

            // 仅在国王实际变化时记录（避免每 tick 刷事件）
            if region.group.leader != new_king {
                successions.push((*camp_id, new_king));
            }
        }

        // WRITE PHASE：应用国王更替
        for (camp_id, new_king) in successions {
            let Some(region) = self.region_registry.regions.get_mut(&camp_id) else { continue };
            let camp_name = self.pois.iter()
                .find(|p| p.poi_type == crate::spatial::poi::PoiType::Camp && p.id == camp_id)
                .map(|p| p.camp_title())
                .unwrap_or_else(|| format!("营地#{}", camp_id));
            match new_king {
                Some(id) => {
                    if region.group.leader.is_none() {
                        // 初王登基
                        region.set_king(id, tick, &format!("初王登基：arrival_order 最早到达在世男性，【{}】开国", camp_name));
                        self.last_event = Some(format!("👑 胜者为王：部落民 #{} 率先抵达，登基为【{}】第一任国王！", id, camp_name));
                    } else {
                        region.set_king(id, tick, &format!("国王更替：【{}】", camp_name));
                    }
                }
                None => {
                    // 无在世男性：王位空悬，账本冻结
                    region.group.leader = None;
                    region.group.ledger.push_event(tick, format!("👑 【{}】无在世男性，王位空悬，公仓账本冻结", camp_name));
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // 国王死亡检测与长子继承
    // ══════════════════════════════════════════════════════════

    fn handle_king_deaths(&mut self, tick: u64) {
        // READ PHASE：收集死亡的国王
        let mut dead_kings: Vec<(u32, AgentId)> = Vec::new();
        for (camp_id, region) in &self.region_registry.regions {
            if let Some(king_id) = region.group.leader {
                if let Some(king) = self.agent_by_id(king_id) {
                    if !king.is_alive {
                        dead_kings.push((*camp_id, king_id));
                    }
                }
            }
        }

        if dead_kings.is_empty() {
            return;
        }

        // WRITE PHASE：对每个死亡国王执行长子继承
        for (camp_id, dead_king_id) in dead_kings {
            self.handle_king_death(camp_id, dead_king_id, tick);
        }
    }

    /// 单个国王死亡的继承逻辑：长子 → 长孙 → arrival_order 下一男性 → 空悬
    fn handle_king_death(&mut self, camp_id: u32, dead_king_id: AgentId, tick: u64) {
        let camp_name = self.pois.iter()
            .find(|p| p.poi_type == crate::spatial::poi::PoiType::Camp && p.id == camp_id)
            .map(|p| p.camp_title())
            .unwrap_or_else(|| format!("营地#{}", camp_id));

        // 1. 收集国王的所有在世儿子（father_id=king, gender=Male, is_alive）
        let mut sons: Vec<(AgentId, f32)> = Vec::new(); // (id, age)
        for agent in &self.agents {
            if agent.is_alive && agent.gender == Gender::Male && agent.father_id == Some(dead_king_id) {
                sons.push((agent.id, agent.age));
            }
        }

        // 2. 收集孙子（father_id in 儿子列表, gender=Male, is_alive）
        let son_ids: std::collections::BTreeSet<AgentId> = sons.iter().map(|(id, _)| *id).collect();
        let mut grandsons: Vec<(AgentId, f32)> = Vec::new();
        for agent in &self.agents {
            if agent.is_alive && agent.gender == Gender::Male && son_ids.contains(&agent.father_id.unwrap_or(0)) {
                // 注意：father_id 是 Option，unwrap_or(0) 不会匹配任何真实儿子（id 从1开始）
                if agent.father_id.is_some() && son_ids.contains(&agent.father_id.unwrap()) {
                    grandsons.push((agent.id, agent.age));
                }
            }
        }

        // 3. 确定继承人：在世最年长儿子 → 在世最年长孙子 → arrival_order 下一男性
        let heir: Option<AgentId> = if !sons.is_empty() {
            // 儿子：age 降序，并列 id 小者
            sons.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap().then(a.0.cmp(&b.0)));
            Some(sons[0].0)
        } else if !grandsons.is_empty() {
            // 孙子：age 降序，并列 id 小者
            grandsons.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap().then(a.0.cmp(&b.0)));
            Some(grandsons[0].0)
        } else {
            // 绝嗣：arrival_order 中下一个最先到达的在世男性（跳过已死国王）
            let region = self.region_registry.regions.get(&camp_id);
            if let Some(region) = region {
                region.arrival_order.iter()
                    .find(|&&id| {
                        id != dead_king_id
                            && self.agent_by_id(id).map(|a| a.is_alive && a.gender == Gender::Male).unwrap_or(false)
                    })
                    .copied()
            } else {
                None
            }
        };

        // WRITE：应用继承
        if let Some(region) = self.region_registry.regions.get_mut(&camp_id) {
            match heir {
                Some(heir_id) => {
                    region.set_king(heir_id, tick, &format!("长子继承：先王 #{} 驾崩，继承人 #{} 登基【{}】", dead_king_id, heir_id, camp_name));
                    self.last_event = Some(format!("👑 【{}】先王 #{} 驾崩，长子继承制下 #{} 登基为新国王！", camp_name, dead_king_id, heir_id));
                }
                None => {
                    region.group.leader = None;
                    region.group.ledger.push_event(tick, format!("👑 【{}】先王 #{} 驾崩且绝嗣，王位空悬，公仓账本冻结", camp_name, dead_king_id));
                    self.last_event = Some(format!("👑 【{}】先王 #{} 驾崩且绝嗣，王位空悬！", camp_name, dead_king_id));
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // 公仓税：全局统一时点征收，存续家户 → 地区公仓（Tax 流水）
    // ══════════════════════════════════════════════════════════

    fn tick_region_tax(&mut self, tick: u64) {
        let interval = self.config.ledger_tax_interval_ticks;
        if tick == 0 || tick % interval != 0 {
            return;
        }

        let rate = self.config.ledger_tax_rate;

        // READ PHASE：收集待征税家户（户主所属 camp_id + 各品类账面余额）
        struct TaxItem {
            hid: HouseholdId,
            camp_id: u32,
            amounts: Vec<(ResourceKind, f32)>,
        }
        let mut items: Vec<TaxItem> = Vec::new();

        for (hid, hh) in &self.household_registry.households {
            if hh.is_dissolved {
                continue;
            }
            // 取户主所属地区
            let Some(camp_id) = self.region_registry.region_of(hh.head) else {
                continue;
            };
            // 地区必须有国王方可征税（无主地区账本冻结）
            let region_has_king = self
                .region_registry
                .get(camp_id)
                .and_then(|r| r.group.leader)
                .is_some();
            if !region_has_king {
                continue;
            }

            // 每类资源独立计算税额 = 账面余额 × rate
            let amounts: Vec<(ResourceKind, f32)> = RESOURCE_ORDER
                .iter()
                .filter_map(|&rk| {
                    let bal = hh.group.ledger.balance(rk);
                    let amt = bal * rate;
                    if amt > 0.001 {
                        Some((rk, amt))
                    } else {
                        None
                    }
                })
                .collect();

            if !amounts.is_empty() {
                items.push(TaxItem { hid: *hid, camp_id, amounts });
            }
        }

        // WRITE PHASE：执行公仓税转移（家户 debit → 地区公仓 credit）
        for item in items {
            for (resource, amount) in item.amounts {
                let record = TransferRecord {
                    tick,
                    from: LedgerRef::Family(item.hid),
                    to: LedgerRef::Region(item.camp_id),
                    resource,
                    amount,
                    reason: TransferReason::Tax,
                };
                // Debit 家户账本
                if let Some(hh) = self.household_registry.get_mut(item.hid) {
                    hh.group.ledger.debit(resource, amount);
                    hh.group.ledger.push_transfer(record.clone());
                }
                // Credit 地区公仓账本
                if let Some(region) = self.region_registry.get_mut(item.camp_id) {
                    region.group.ledger.credit(resource, amount);
                    region.group.ledger.push_transfer(record);
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // 救济：地区公仓充足 → 极贫家户（Relief 流水）
    // ══════════════════════════════════════════════════════════

    fn tick_region_relief(&mut self, tick: u64) {
        let min_balance = self.config.ledger_relief_min_balance;
        let family_threshold = self.config.ledger_relief_family_threshold;
        let cooldown = self.config.ledger_relief_cooldown_ticks;

        // READ PHASE：收集待救济家户
        struct ReliefItem {
            hid: HouseholdId,
            camp_id: u32,
            amounts: Vec<(ResourceKind, f32)>,
        }
        let mut items: Vec<ReliefItem> = Vec::new();

        // 按 camp_id 遍历地区（BTreeMap 保序）
        for (camp_id, region) in &self.region_registry.regions {
            // 必须有国王才能签发救济（国王签字）
            let Some(_leader_id) = region.group.leader else {
                continue;
            };

            // 地区公仓总余额（5 类资源求和）
            let region_total: f32 = RESOURCE_ORDER
                .iter()
                .map(|&rk| region.group.ledger.balance(rk))
                .sum();
            if region_total <= min_balance {
                continue;
            }

            // 找出本地区的存续家户（户主属于本地区）
            let mut region_households: Vec<HouseholdId> = Vec::new();
            for (hid, hh) in &self.household_registry.households {
                if hh.is_dissolved {
                    continue;
                }
                if self.region_registry.region_of(hh.head) == Some(*camp_id) {
                    region_households.push(*hid);
                }
            }

            // 对每家户判定极贫 + 冷却
            for hid in region_households {
                // 冷却检查
                if let Some(&last_tick) = self.relief_cooldown.get(&hid) {
                    if tick - last_tick < cooldown {
                        continue;
                    }
                }

                let Some(hh) = self.household_registry.get(hid) else {
                    continue;
                };
                let water = hh.group.ledger.balance(ResourceKind::Water);
                let food = hh.group.ledger.balance(ResourceKind::Food);
                let total = water + food;
                if total >= family_threshold {
                    continue; // 非极贫
                }

                // 计算救济总额 = min(公仓余额 × 0.15, 缺口至 threshold 的 2倍)
                let gap = family_threshold - total;
                let relief_total = (region_total * 0.15).min(gap * 2.0);
                if relief_total <= 0.001 {
                    continue;
                }

                // 按水/粮缺口比例分配救济额（确定性）
                let water_need = (family_threshold - water).max(0.0);
                let food_need = (family_threshold - food).max(0.0);
                let need_sum = water_need + food_need;
                let (water_share, food_share) = if need_sum > 0.001 {
                    (relief_total * water_need / need_sum, relief_total * food_need / need_sum)
                } else {
                    (relief_total * 0.5, relief_total * 0.5)
                };

                // 实际拨付 = min(计划额, 公仓该品类可用余额)
                let mut amounts: Vec<(ResourceKind, f32)> = Vec::new();
                let region_water_avail = region.group.ledger.balance(ResourceKind::Water);
                let region_food_avail = region.group.ledger.balance(ResourceKind::Food);
                let water_actual = water_share.min(region_water_avail);
                let food_actual = food_share.min(region_food_avail);
                if water_actual > 0.001 {
                    amounts.push((ResourceKind::Water, water_actual));
                }
                if food_actual > 0.001 {
                    amounts.push((ResourceKind::Food, food_actual));
                }

                if !amounts.is_empty() {
                    items.push(ReliefItem { hid, camp_id: *camp_id, amounts });
                }
            }
        }

        // WRITE PHASE：执行救济转移（地区公仓 debit → 家户 credit）+ 更新冷却
        for item in items {
            for (resource, amount) in item.amounts {
                let record = TransferRecord {
                    tick,
                    from: LedgerRef::Region(item.camp_id),
                    to: LedgerRef::Family(item.hid),
                    resource,
                    amount,
                    reason: TransferReason::Relief,
                };
                // Debit 地区公仓账本
                if let Some(region) = self.region_registry.get_mut(item.camp_id) {
                    region.group.ledger.debit(resource, amount);
                    region.group.ledger.push_transfer(record.clone());
                }
                // Credit 家户账本
                if let Some(hh) = self.household_registry.get_mut(item.hid) {
                    hh.group.ledger.credit(resource, amount);
                    hh.group.ledger.push_transfer(record);
                }
            }
            // 更新冷却
            self.relief_cooldown.insert(item.hid, tick);
        }
    }
}
