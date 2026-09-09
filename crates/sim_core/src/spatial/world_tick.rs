use super::agent::{Agent3D, AgentId, Gender};
use super::graph::NodeId;
use super::poi::PoiType;
use super::snapshot::RecentDeathSnapshot;
use super::vec3::Vec3;
use super::world::World3DEngine;
use std::collections::{BTreeSet, HashMap};

/// 死亡/流产墓碑滑动窗口（tick）：覆盖前端最高倍速(1024x)单帧推进与任意渲染间隙
const RECENT_DEATH_RETAIN_TICKS: u64 = 4096;

/// Tick 管线调度
///
/// `tick()` 内部顺序是本项目核心不变量之一（根 AGENTS.md §4.3），
/// 调整顺序会破坏确定性或行为语义。各子步骤委托给对应模块：
/// - 步骤 0: `world_season.rs::tick_season`
/// - 步骤 2.3/2.5: 本文件 `tick_fetus_reconcile` / `settle_gold_inheritance`
/// - 步骤 3: `ecology/tick.rs::tick_poi_interactions`
/// - 步骤 4: `housing_system/mod.rs::tick_housing`
/// - 步骤 6 决策: `decisions/scheduler.rs::tick_decisions`
/// - 步骤 7: `bookkeeping.rs::tick_bookkeeping`
/// - 步骤 8/9: `ledger/clan.rs::tick_clan` / `ledger/region.rs::tick_region`
impl World3DEngine {
    /// 确定性仿真 Tick (按 AGENTS.md §4.3 严格顺次执行子阶段)
    pub fn tick(&mut self, dt: f32) {
        self.tick_counter += 1;
        self.tick_phase_season_and_poi_regen(dt);
        self.tick_phase_metabolism_and_child(dt);
        self.tick_phase_poi_interactions(dt);
        self.tick_phase_housing(dt);
        self.tick_phase_road_decay(dt);
        self.tick_phase_movement(dt);
        self.tick_phase_decisions();
        self.tick_phase_ledger(dt);
        self.tick_phase_cleanup();
    }

    /// 执行特定子阶段（用于性能基准分析 profile-benchmark，phase_idx 0~8）
    pub fn tick_subphase(&mut self, phase_idx: u32, dt: f32) {
        match phase_idx {
            0 => {
                self.tick_counter += 1;
                self.tick_phase_season_and_poi_regen(dt);
            }
            1 => self.tick_phase_metabolism_and_child(dt),
            2 => self.tick_phase_poi_interactions(dt),
            3 => self.tick_phase_housing(dt),
            4 => self.tick_phase_road_decay(dt),
            5 => self.tick_phase_movement(dt),
            6 => self.tick_phase_decisions(),
            7 => self.tick_phase_ledger(dt),
            8 => self.tick_phase_cleanup(),
            _ => {}
        }
    }

    /// 子阶段 0: 四季更迭与 POI 自然恢复
    pub fn tick_phase_season_and_poi_regen(&mut self, dt: f32) {
        // 0. 四季更迭与宏观环境温度演化 (正弦周期拟合)
        self.tick_season(dt);

        // 1. POI 自然恢复 (按类型应用前端可调的产速倍率)
        for poi in &mut self.pois {
            if poi.poi_type == PoiType::Market {
                poi.regen_rate = self.config.market_regen_base_water;
                poi.secondary_regen_rate = self.config.market_regen_base_food;
                poi.tertiary_regen_rate = self.config.market_regen_base_wood;
                let mult_water = self.water_regen_multiplier;
                let mult_food = self.berry_regen_multiplier;
                let mult_wood = self.wood_regen_multiplier;
                if poi.regen_rate > 0.0 && poi.current_stock.is_finite() {
                    poi.current_stock =
                        (poi.current_stock + poi.regen_rate * dt * mult_water).min(poi.max_stock);
                }
                if poi.secondary_regen_rate > 0.0 && poi.secondary_max_stock > 0.0 {
                    poi.secondary_stock = (poi.secondary_stock
                        + poi.secondary_regen_rate * dt * mult_food)
                        .min(poi.secondary_max_stock);
                }
                if poi.tertiary_regen_rate > 0.0 && poi.tertiary_max_stock > 0.0 {
                    poi.tertiary_stock = (poi.tertiary_stock
                        + poi.tertiary_regen_rate * dt * mult_wood)
                        .min(poi.tertiary_max_stock);
                }
            } else {
                let base_regen = match poi.poi_type {
                    PoiType::WaterSource => self.config.regen_base_water,
                    PoiType::BerryBush => self.config.regen_base_berry,
                    PoiType::WoodForest => self.config.regen_base_wood,
                    PoiType::StoneQuarry => self.config.regen_base_stone,
                    PoiType::GoldMine => self.config.regen_base_gold,
                    _ => 1.0,
                };
                let temp_factor = if poi.poi_type == PoiType::BerryBush {
                    let decline = self.config.berry_frost_decline_temp;
                    let zero = self.config.berry_frost_zero_temp;
                    if self.temperature <= zero {
                        0.0
                    } else if self.temperature >= decline {
                        1.0
                    } else {
                        let span = (decline - zero).max(0.001);
                        let t = ((self.temperature - zero) / span).clamp(0.0, 1.0);
                        3.0 * t * t - 2.0 * t * t * t
                    }
                } else {
                    1.0
                };
                poi.regen_rate = base_regen * temp_factor;
                let mult = match poi.poi_type {
                    PoiType::WaterSource => self.water_regen_multiplier,
                    PoiType::BerryBush => self.berry_regen_multiplier,
                    PoiType::WoodForest => self.wood_regen_multiplier,
                    PoiType::StoneQuarry => self.stone_regen_multiplier,
                    PoiType::GoldMine => self.gold_regen_multiplier,
                    _ => 1.0,
                };
                poi.tick_regenerate(dt * mult);
            }
        }
    }

    /// 子阶段 1: 生理代谢、养育受孕、胎儿位置跟随与金币遗产继承
    pub fn tick_phase_metabolism_and_child(&mut self, dt: f32) {
        // 2. 代谢与繁衍（受孕瞬间需为胎儿占号，故将发号器取出循环外，循环结束回写）
        let mut next_agent_id = self.next_agent_id;
        for agent in &mut self.agents {
            if agent.is_fetus {
                continue;
            }
            if let Some(event) = agent.tick_metabolism(dt, &self.config, &mut next_agent_id) {
                if !agent.is_alive {
                    self.total_deaths += 1;
                    if agent.death_is_natural {
                        self.total_deaths_natural += 1;
                    } else {
                        self.total_deaths_unnatural += 1;
                    }
                    self.recent_deaths.push(RecentDeathSnapshot {
                        id: agent.id,
                        cause: agent
                            .death_cause
                            .clone()
                            .unwrap_or_else(|| "未知死因".to_string()),
                        is_natural: agent.death_is_natural,
                        is_fetus: false,
                        father_id: agent.father_id,
                        mother_id: agent.mother_id,
                        tick: self.tick_counter,
                    });
                }
                if event.contains("流产") {
                    self.total_miscarriages += 1;
                }
                self.last_event = Some(event);
            }
        }
        self.next_agent_id = next_agent_id;

        // 生育改为马斯洛“养育小孩”行动：仅处理男性自主下达且妻子仍满足原受孕条件的意图
        self.execute_pending_childcare();

        // 2.3 受孕即建胎儿 agent（流产/母亡则移除，并同步胎儿位置跟随母亲）
        self.tick_fetus_reconcile();

        // 2.5 金币遗产继承结算 (死者金币平分给在世子一代子女)
        self.settle_gold_inheritance();
    }

    /// 子阶段 2: POI 实际采收提取、分娩与死亡尸骸消逝
    pub fn tick_phase_poi_interactions(&mut self, dt: f32) {
        self.tick_poi_interactions(dt);
    }

    /// 子阶段 3: 房屋折旧、冬季供暖与代际继承
    pub fn tick_phase_housing(&mut self, dt: f32) {
        self.tick_housing(dt);
    }

    /// 子阶段 4: 道路自然杂草丛生与退化衰减
    pub fn tick_phase_road_decay(&mut self, dt: f32) {
        self.network.tick_wear_decay(dt, &self.config);
    }

    /// 子阶段 5: 动力学运动与踩踏拓路
    pub fn tick_phase_movement(&mut self, dt: f32) {
        for agent in &mut self.agents {
            if agent.is_fetus {
                continue;
            }
            agent.tick_movement(dt, &mut self.network, &self.config);
        }
    }

    /// 子阶段 6: 错峰马斯洛决策与物理规则结算
    pub fn tick_phase_decisions(&mut self) {
        self.tick_decisions();
    }

    /// 子阶段 7: M2 家庭清算分家、M3 宗族互助与 M4 地区王国公仓税救济
    pub fn tick_phase_ledger(&mut self, dt: f32) {
        self.tick_bookkeeping();
        self.tick_clan(dt);
        self.tick_region(dt);
        self.tick_empire(dt);
    }

    /// 子阶段 8: 墓碑滑动窗口清理
    pub fn tick_phase_cleanup(&mut self) {
        self.recent_deaths
            .retain(|d| self.tick_counter.saturating_sub(d.tick) < RECENT_DEATH_RETAIN_TICKS);
    }

    /// 执行男性 RaiseChild 意图；条件不满足时直接清除意图，不进入妊娠。
    fn execute_pending_childcare(&mut self) {
        let mut pairs = Vec::new();
        for a in &self.agents {
            if a.raise_child_pending {
                if let Some(wife_id) = a.spouse_id {
                    pairs.push((a.id, wife_id));
                }
            }
        }
        let mut next_id = self.next_agent_id;
        for (male_id, wife_id) in pairs {
            let Some(mi) = self.agents.iter().position(|a| a.id == male_id) else {
                continue;
            };
            let Some(wi) = self.agents.iter().position(|a| a.id == wife_id) else {
                self.agents[mi].raise_child_pending = false;
                crate::spatial::decisions::transition::cancel_task(&mut self.agents[mi]);
                continue;
            };
            let eligible = {
                let m = &self.agents[mi];
                let w = &self.agents[wi];
                m.is_alive
                    && m.gender == Gender::Male
                    && !m.is_fetus
                    && m.age >= self.config.agent_adult_age
                    && m.spouse_id == Some(wife_id)
                    && w.is_alive
                    && w.gender == Gender::Female
                    && !w.is_fetus
                    && w.age >= self.config.agent_adult_age
                    && !w.is_pregnant
                    && w.miscarriage_cooldown_timer <= 0.0
                    && w.postpartum_cooldown_timer <= 0.0
                    && w.hunger >= self.config.agent_conception_hunger_min
                    && w.thirst >= self.config.agent_conception_thirst_min
                    && w.stamina >= self.config.agent_conception_stamina_min
            };
            // 养育动作必须在夫妻回到户主住宅后才落地；未到家则保留意图，等待下一拍。
            let at_home = self
                .houses
                .iter()
                .find(|h| h.owner_id == Some(male_id))
                .map(|h| {
                    let door = self.network.graph
                        [*self.network.node_map.get(&h.door_node_id).unwrap()]
                    .pos;
                    self.agents[mi].world_pos.distance_to(&door)
                        <= self.config.poi_interaction_radius
                        && self.agents[wi].world_pos.distance_to(&door)
                            <= self.config.poi_interaction_radius
                        && self.agents[mi].current_lane_id.is_none()
                        && self.agents[wi].current_lane_id.is_none()
                })
                .unwrap_or(false);
            if !eligible {
                self.agents[mi].raise_child_pending = false;
                crate::spatial::decisions::transition::cancel_task(&mut self.agents[mi]);
                continue;
            }
            if !at_home {
                continue;
            }
            self.agents[mi].raise_child_pending = false;
            crate::spatial::decisions::transition::finish_task(&mut self.agents[mi]);
            self.agents[wi].is_pregnant = true;
            self.agents[wi].pregnancy_father_id = Some(male_id);
            self.agents[wi].pregnancy_child_id = Some(next_id);
            self.agents[wi].pregnancy_progress = 0.0;
            next_id += 1;
            self.last_event = Some(format!(
                "🤰 女性部落民 #{} 在丈夫 #{} 的养育行动下成功受孕！",
                wife_id, male_id
            ));
        }
        self.next_agent_id = next_id;
    }

    /// 结算已故族人的金币遗产：某人死后随身金币平分给在世妻子（如有）与在世子一代
    pub fn settle_gold_inheritance(&mut self) {
        loop {
            let deceased_info = self
                .agents
                .iter_mut()
                .find(|a| !a.is_alive && a.carried_gold > 0.0001)
                .map(|a| {
                    let gold = a.carried_gold;
                    a.carried_gold = 0.0;
                    (a.id, gold)
                });

            match deceased_info {
                Some((deceased_id, gold)) => {
                    let mut heirs: Vec<AgentId> = Vec::new();

                    // 1. 妻子（若在世）
                    if let Some(mids) = self.marriage_registry.by_agent.get(&deceased_id) {
                        if let Some(&mid) = mids.last() {
                            if let Some(m) = self.marriage_registry.get(mid) {
                                if m.husband_id == deceased_id {
                                    let wife_alive = self
                                        .agent_index
                                        .get(&m.wife_id)
                                        .and_then(|idx| self.agents.get(*idx))
                                        .map(|a| a.is_alive)
                                        .unwrap_or(false);
                                    if wife_alive {
                                        heirs.push(m.wife_id);
                                    }
                                }
                            }
                        }
                    }

                    // 2. 在世子女
                    for a in &self.agents {
                        if a.is_alive
                            && (a.father_id == Some(deceased_id)
                                || a.mother_id == Some(deceased_id))
                        {
                            if !heirs.contains(&a.id) {
                                heirs.push(a.id);
                            }
                        }
                    }

                    if !heirs.is_empty() {
                        let count = heirs.len();
                        let share = gold / (count as f32);
                        for hid in &heirs {
                            if let Some(heir) = self.agents.iter_mut().find(|a| a.id == *hid) {
                                heir.carried_gold += share;
                            }
                        }
                        self.last_event = Some(format!(
                            "💰 遗产继承: 逝者 Agent #{} 遗留 {:.1} 黄金，由在世的 {} 位继承人平分 (每人继承 {:.1} 黄金)！",
                            deceased_id, gold, count, share
                        ));
                    }
                }
                None => break,
            }
        }
    }

    /// ★ 受孕即建胎儿 agent（M1.7）
    ///
    /// 每 tick 在代谢结算后、金币继承前调用，负责胎儿 agent 生命周期的对账：
    /// - 新建：本拍新受孕且胎儿 agent 尚未建立 → 创建 `is_fetus=true` 的胎儿实体，
    ///   登记父母、加入父母 `children_ids`、随父入家户（家庭跟着男人走）；
    /// - 移除：流产 / 母亲亡故导致 `pregnancy_child_id` 失效 → 移除胎儿 agent、
    ///   清理父母 `children_ids` 与家户成员（若胎儿已是家户户主则交由继承清算兜底）；
    /// - 同步：既有胎儿 `world_pos` 跟随母亲（前端相机可定位，但无地图实体、不渲染）。
    pub(crate) fn tick_fetus_reconcile(&mut self) {
        let tick = self.tick_counter;

        // ── READ：收集合法胎儿 id（M1.7：孕期或待产中已占号的胎儿，需为其创建/维持 agent 实体）──
        let mut valid: BTreeSet<AgentId> = BTreeSet::new();
        let mut mother_pos: HashMap<AgentId, Vec3> = HashMap::new();
        for a in &self.agents {
            if a.is_alive && (a.is_pregnant || a.ready_to_birth) {
                if let Some(cid) = a.pregnancy_child_id {
                    valid.insert(cid);
                    mother_pos.insert(cid, a.world_pos);
                }
            }
        }
        // 已失效胎儿（流产/母亡）需移除
        let mut to_remove: Vec<AgentId> = Vec::new();
        for a in &self.agents {
            if a.is_fetus && !valid.contains(&a.id) {
                to_remove.push(a.id);
            }
        }
        // 新受孕胎儿需创建
        let mut to_create: Vec<AgentId> = Vec::new();
        for cid in &valid {
            if !self.agent_index.contains_key(cid) {
                to_create.push(*cid);
            }
        }

        // ── WRITE：移除失效胎儿 ──
        if !to_remove.is_empty() {
            // ★ v1.8.7 胎儿墓碑：区分"流产"（母在）与"随母亡故"（母已死）；
            //   father_id/mother_id 随墓碑入档——高倍速下胎儿整个生命周期（受孕→流产）可能都在单帧内，
            //   前端上一帧快照取不到该胎儿，血缘必须由墓碑携带，否则族谱节点画不出来。
            for rid in &to_remove {
                let (cause, father_id, mother_id) = self
                    .agents
                    .iter()
                    .find(|a| a.id == *rid)
                    .map(|f| {
                        let cause = f
                            .mother_id
                            .and_then(|mid| self.agents.iter().find(|a| a.id == mid))
                            .map(|m| if m.is_alive { "流产" } else { "随母亡故" })
                            .unwrap_or("流产");
                        (cause, f.father_id, f.mother_id)
                    })
                    .unwrap_or(("流产", None, None));
                self.recent_deaths.push(RecentDeathSnapshot {
                    id: *rid,
                    cause: cause.to_string(),
                    is_natural: false,
                    is_fetus: true,
                    father_id,
                    mother_id,
                    tick,
                });
            }
            self.agents.retain(|a| !to_remove.contains(&a.id));
            for rid in &to_remove {
                // 清理父母 children_ids
                for a in &mut self.agents {
                    a.children_ids.retain(|&c| c != *rid);
                }
                // 若胎儿是某家户成员（非户主）则移除；户主胎儿交由继承清算兜底
                self.household_registry.remove_member(*rid, tick);
            }
            self.rebuild_agent_index();
        }

        // ── WRITE：创建新胎儿 ──
        if !to_create.is_empty() {
            // 先收集 (child_id, mother_id, father_id, surname, mother_camp, mother_pos)
            let mut infos: Vec<(AgentId, AgentId, Option<AgentId>, String, NodeId, Vec3)> =
                Vec::new();
            for cid in &to_create {
                if let Some(mother) = self.agents.iter().find(|a| {
                    a.is_alive
                        && (a.is_pregnant || a.ready_to_birth)
                        && a.pregnancy_child_id == Some(*cid)
                }) {
                    let father_id = mother.pregnancy_father_id;
                    let surname = father_id
                        .and_then(|fid| self.agents.iter().find(|a| a.id == fid))
                        .map(|f| f.surname.clone())
                        .unwrap_or_else(|| mother.surname.clone());
                    infos.push((
                        *cid,
                        mother.id,
                        father_id,
                        surname,
                        mother.home_camp_node,
                        mother.world_pos,
                    ));
                }
            }
            for (cid, mother_id, father_id, surname, camp_node, mpos) in infos {
                // 胎儿性别占位为 Female：不会被分家/婚姻/房产继承/王位继承当作男性处理
                let mut fetus = Agent3D::new_with_config(
                    cid,
                    camp_node,
                    self.config.agent_spawn_base_speed,
                    false,
                    0.0,
                    Gender::Female,
                    &self.config,
                );
                fetus.is_fetus = true;
                fetus.birth_tick = tick; // 受孕时刻 tick（前端族谱占位）
                fetus.arrival_tick = tick;
                fetus.mother_id = Some(mother_id);
                fetus.father_id = father_id;
                fetus.surname = surname;
                fetus.world_pos = mpos;
                // 加入父母 children_ids（继承按 children_ids 找在世子一代）
                if let Some(mother) = self.agent_by_id_mut(mother_id) {
                    if !mother.children_ids.contains(&cid) {
                        mother.children_ids.push(cid);
                    }
                }
                if let Some(fid) = father_id {
                    if let Some(father) = self.agent_by_id_mut(fid) {
                        if !father.children_ids.contains(&cid) {
                            father.children_ids.push(cid);
                        }
                    }
                }
                // 随父入家户（家庭跟着男人走：腹中胎儿计入父亲家户成员）
                if let Some(fid) = father_id {
                    if let Some(fid_hid) = self.household_registry.household_of(fid) {
                        self.household_registry.add_member(fid_hid, cid, tick);
                    }
                }
                self.agents.push(fetus);
            }
            self.rebuild_agent_index();
        }

        // ── WRITE：同步既有胎儿位置跟随母亲 ──
        if !valid.is_empty() {
            let mut updates: Vec<(AgentId, Vec3)> = Vec::new();
            for a in &self.agents {
                if a.is_fetus {
                    if let Some(pos) = mother_pos.get(&a.id) {
                        updates.push((a.id, *pos));
                    }
                }
            }
            for (cid, pos) in updates {
                if let Some(f) = self.agents.iter_mut().find(|a| a.id == cid) {
                    f.world_pos = pos;
                }
            }
        }
    }
}
