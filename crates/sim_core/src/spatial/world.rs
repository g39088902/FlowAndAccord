use crate::rng::WorldRng;
use crate::config::{SimConfig, LEDGER_JOURNAL_CAPACITY};
use std::collections::{BTreeSet, HashMap};
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, NodeId};
use super::agent::{Agent3D, AgentId, Gender};
use super::poi::{PrimitivePoi, PoiType};
use super::house::{House, HouseSnapshot};
use super::ledger::{ClanRegistry, HouseholdId, HouseholdRegistry, Ledger, MarriageRegistry, RegionRegistry};
use super::ledger::journal::ResourceKind;
use super::snapshot::{
    AgentSnapshot, ClanSnapshot, GeoCellSnapshot, HouseholdSnapshot, LaneSnapshot, LedgerBalanceSnapshot, RegionSnapshot,
    MarriageSnapshot, NodeSnapshot, PoiSnapshot, Season, TransferRecordSnapshot, WorldSnapshot3D,
};
use crate::geo::terrain::TerrainMap;

/// 3D 空间世界与原始生态生存繁衍仿真管理器
pub struct World3DEngine {
    pub terrain: TerrainMap,
    pub network: LaneGraph3D,
    pub pois: Vec<PrimitivePoi>,
    pub houses: Vec<House>,
    pub agents: Vec<Agent3D>,
    pub next_agent_id: AgentId,
    pub next_house_id: u32,
    pub total_births: u32,
    pub total_deaths: u32,
    /// 自然死亡计数 (寿终正寝 / 寿命耗尽)
    pub total_deaths_natural: u32,
    /// 非自然死亡计数 (饥荒饿死 / 脱水渴死等外部原因)
    pub total_deaths_unnatural: u32,
    pub total_miscarriages: u32,
    pub season_timer: f32,
    pub current_season: Season,
    pub temperature: f32,
    pub rng: WorldRng,
    pub water_regen_multiplier: f32,
    pub berry_regen_multiplier: f32,
    pub wood_regen_multiplier: f32,
    pub stone_regen_multiplier: f32,
    pub gold_regen_multiplier: f32,
    pub tick_counter: u64,
    pub last_event: Option<String>,
    pub config: SimConfig,
    /// AgentId → agents Vec 下标的快速查找索引；Vec 结构变更后需调用 rebuild_agent_index() 刷新
    pub agent_index: HashMap<AgentId, usize>,
    /// ★ 婚姻登记簿（只记两性关系与历史；家庭账本不在婚姻下）
    pub marriage_registry: MarriageRegistry,
    /// ★ 家户登记簿（**家庭跟着男人走**：以男性户主为锚的家庭单元与账本）
    pub household_registry: HouseholdRegistry,

    /// ★ M2 公仓兜底账本（绝嗣家户资产归集，预留 M4 Region 对接）
    pub public_granary: Ledger,
    /// ★ M3 宗族登记簿（按姓氏聚合的宗族团体与账本）
    pub clan_registry: ClanRegistry,
    /// ★ M3 族内互助冷却记录（每家户上次接受互助的 tick）
    pub mutual_aid_cooldown: std::collections::BTreeMap<HouseholdId, u64>,
    /// ★ M4 地区与王国登记簿（按营地聚合的地区团体、国王、公仓与继承顺位）
    pub region_registry: RegionRegistry,
    /// ★ M4 夺位远征目标记录（agent_id → 目标 camp_id）
    pub expedition_targets: std::collections::BTreeMap<u32, u32>,
    /// ★ M4 救济冷却记录（每家户上次接受救济的 tick）
    pub relief_cooldown: std::collections::BTreeMap<HouseholdId, u64>,
}

impl World3DEngine {
    pub fn new(grid_res: usize, world_size: f32) -> Self {
        Self::new_seeded(grid_res, world_size, 42)
    }

    /// 指定种子的确定性世界构建 (wasm 桥接与 SL 复现使用)
    pub fn new_seeded(grid_res: usize, world_size: f32, seed: u64) -> Self {
        Self::new_seeded_with_config(grid_res, world_size, seed, SimConfig::default())
    }

    /// 指定种子和自定义配置的确定性世界构建
    pub fn new_seeded_with_config(grid_res: usize, world_size: f32, seed: u64, config: SimConfig) -> Self {
        let mut terrain = TerrainMap::new(grid_res, grid_res, world_size);
        terrain.generate_natural_landscape(seed);

        Self {
            terrain,
            network: LaneGraph3D::new(),
            pois: Vec::new(),
            houses: Vec::new(),
            agents: Vec::new(),
            next_agent_id: 1,
            next_house_id: 1,
            total_births: 0,
            total_deaths: 0,
            total_deaths_natural: 0,
            total_deaths_unnatural: 0,
            total_miscarriages: 0,
            season_timer: 0.0,
            current_season: Season::Spring,
            temperature: 20.0,
            rng: WorldRng::new(seed),
            water_regen_multiplier: 1.0,
            berry_regen_multiplier: 1.0,
            wood_regen_multiplier: 1.0,
            stone_regen_multiplier: 1.0,
            gold_regen_multiplier: 1.0,
            tick_counter: 0,
            last_event: None,
            config,
            agent_index: HashMap::new(),
            marriage_registry: MarriageRegistry::new(LEDGER_JOURNAL_CAPACITY),
            household_registry: HouseholdRegistry::new(LEDGER_JOURNAL_CAPACITY),
            public_granary: Ledger::new(LEDGER_JOURNAL_CAPACITY),
            clan_registry: ClanRegistry::new(LEDGER_JOURNAL_CAPACITY),
            mutual_aid_cooldown: std::collections::BTreeMap::new(),
            region_registry: RegionRegistry::new(LEDGER_JOURNAL_CAPACITY),
            expedition_targets: std::collections::BTreeMap::new(),
            relief_cooldown: std::collections::BTreeMap::new(),
        }
    }

    /// 当前世界 tick 数（只读访问器：tick_counter 为私有字段，供 ledger / housing_system 钩子取时刻）
    pub fn current_tick(&self) -> u64 {
        self.tick_counter
    }

    /// 从 JSON 字符串解析并应用动态仿真配置
    pub fn apply_config_json(&mut self, json_str: &str) -> Result<(), String> {
        let cfg: SimConfig = serde_json::from_str(json_str).map_err(|e| e.to_string())?;
        self.apply_config(cfg);
        Ok(())
    }

    /// 应用动态仿真配置
    pub fn apply_config(&mut self, config: SimConfig) {
        self.config = config;
        // 同步刷新所有现有 POI 的产速基准
        for poi in &mut self.pois {
            let base_regen = match poi.poi_type {
                PoiType::WaterSource => self.config.regen_base_water,
                PoiType::BerryBush => self.config.regen_base_berry,
                PoiType::WoodForest => self.config.regen_base_wood,
                PoiType::StoneQuarry => self.config.regen_base_stone,
                PoiType::GoldMine => self.config.regen_base_gold,
                _ => poi.regen_rate,
            };
            poi.regen_rate = base_regen;
        }
    }

    /// 设置某类 POI 的自然再生倍率 (0=水泉, 1=浆果, 2=林木, 3=石矿, 4=金矿)
    pub fn set_regen_multiplier(&mut self, which: u8, mult: f32) {
        let mult = mult.max(0.0);
        match which {
            0 => self.water_regen_multiplier = mult,
            1 => self.berry_regen_multiplier = mult,
            2 => self.wood_regen_multiplier = mult,
            3 => self.stone_regen_multiplier = mult,
            4 => self.gold_regen_multiplier = mult,
            _ => {}
        }
    }

    pub fn find_nearest_node(&self, pos: Vec3) -> Option<NodeId> {
        let mut best_id = None;
        let mut min_dist = f32::MAX;
        for node in self.network.graph.node_weights() {
            let d = node.pos.distance_to(&pos);
            if d < min_dist {
                min_dist = d;
                best_id = Some(node.id);
            }
        }
        best_id
    }

    pub fn find_nearest_camp_node(&self, pos: Vec3) -> NodeId {
        let nearest_camp = self.pois.iter()
            .filter(|p| p.poi_type == PoiType::Camp)
            .min_by(|a, b| a.pos.distance_to(&pos).partial_cmp(&b.pos.distance_to(&pos)).unwrap());
        if let Some(camp) = nearest_camp {
            self.find_nearest_node(camp.pos).unwrap_or(1)
        } else {
            self.find_nearest_node(pos).unwrap_or(1)
        }
    }

    /// 确定性仿真 Tick
    pub fn tick(&mut self, dt: f32) {
        self.tick_counter += 1;

        // 0. 四季更迭与宏观环境温度演化 (正弦周期拟合)
        self.tick_season(dt);

        // 1. POI 自然恢复 (按类型应用前端可调的产速倍率)
        for poi in &mut self.pois {
            let base_regen = match poi.poi_type {
                PoiType::WaterSource => self.config.regen_base_water,
                PoiType::BerryBush => self.config.regen_base_berry,
                PoiType::WoodForest => self.config.regen_base_wood,
                PoiType::StoneQuarry => self.config.regen_base_stone,
                PoiType::GoldMine => self.config.regen_base_gold,
                _ => 1.0,
            };
            poi.regen_rate = base_regen;
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

        // 2. 代谢与繁衍（受孕瞬间需为胎儿占号，故将发号器取出循环外，循环结束回写）
        // ★ 胎儿跳过代谢：不增长年龄、不衰减需求、不触发死亡判定（无需求消耗）
        let mut next_agent_id = self.next_agent_id;
        for agent in &mut self.agents {
            if agent.is_fetus {
                continue;
            }
            // ★ M6 去房屋化生育：不再计算房屋/仓储 fertility_active 门禁，受孕条件见 agent.rs
            if let Some(event) = agent.tick_metabolism(dt, &self.config, &mut next_agent_id) {
                if !agent.is_alive {
                    self.total_deaths += 1;
                    if agent.death_is_natural {
                        self.total_deaths_natural += 1;
                    } else {
                        self.total_deaths_unnatural += 1;
                    }
                }
                if event.contains("流产") {
                    self.total_miscarriages += 1;
                }
                self.last_event = Some(event);
            }
        }
        self.next_agent_id = next_agent_id; // 回写发号器（受孕占号后递增）

        // ★ 2.3 受孕即建胎儿 agent（流产/母亡则移除，并同步胎儿位置跟随母亲）
        self.tick_fetus_reconcile();

        // 2.5 金币遗产继承结算 (死者金币平分给在世子一代子女)
        self.settle_gold_inheritance();

        // 3. POI 实际提取、分娩与死亡尸骸消逝
        self.tick_poi_interactions(dt);

        // 4. 房屋折旧、消耗与代际继承
        self.tick_housing(dt);

        // 5. 道路自然杂草丛生与退化衰减
        self.network.tick_wear_decay(dt, &self.config);

        // 6. 动力学运动与踩踏拓路（★ 胎儿无地图实体，跳过运动）
        for agent in &mut self.agents {
            if agent.is_fetus {
                continue;
            }
            agent.tick_movement(dt, &mut self.network, &self.config);
        }

        // 错峰决策
        self.tick_decisions();

        // 7. M2 家庭生命周期结算（继承清算 + 分家抽资；卸货/吃喝/烧柴已由生态/维护层真实收付账本）
        self.tick_bookkeeping();

        // 8. M3 宗族系统（族长顺位 → 族税征收 → 族内互助）
        self.tick_clan(dt);

        // 9. M4 地区与王国系统（初王顺位 → 长子继承 → 公仓税 → 救济）
        self.tick_region(dt);
    }

    /// 导出快照
    pub fn generate_snapshot(&self) -> WorldSnapshot3D {
        let mut terrain_cells = Vec::with_capacity(self.terrain.cells.len());
        for cell in &self.terrain.cells {
            terrain_cells.push(GeoCellSnapshot {
                elevation: cell.elevation,
                slope_angle: cell.slope_angle_deg,
            });
        }

        let mut pois = Vec::new();
        for p in &self.pois {
            pois.push(PoiSnapshot {
                id: p.id,
                poi_type: format!("{:?}", p.poi_type),
                x: p.pos.x,
                y: p.pos.y,
                z: p.pos.z,
                current_stock: p.current_stock,
                max_stock: p.max_stock,
                regen_rate: p.regen_rate,
                name: p.name.clone(),
                camp_title: p.camp_title(),
                level: p.level,
                bound_houses: p.bound_houses_count,
            });
        }

        let mut houses = Vec::new();
        for h in &self.houses {
            houses.push(HouseSnapshot {
                id: h.id,
                owner_id: h.owner_id,
                spouse_id: h.spouse_id,
                camp_id: h.camp_id,
                x: h.pos.x,
                y: h.pos.y,
                z: h.pos.z,
                tier: format!("{:?}", h.tier),
                durability: h.durability,
                age: h.age,
                generation: h.generation,
                is_ruin: h.is_ruin,
                construction_progress: h.construction_progress,
                is_repairing: h.is_repairing,
            });
        }

        let mut nodes = Vec::new();
        for node_idx in self.network.graph.node_indices() {
            let node = &self.network.graph[node_idx];
            nodes.push(NodeSnapshot {
                id: node.id,
                x: node.pos.x,
                y: node.pos.y,
                z: node.pos.z,
                node_type: format!("{:?}", node.node_type),
            });
        }

        let mut lanes = Vec::new();
        for edge_idx in self.network.graph.edge_indices() {
            let lane = &self.network.graph[edge_idx];
            lanes.push(LaneSnapshot {
                id: lane.id,
                from: lane.from_node,
                to: lane.to_node,
                p0: lane.curve.p0,
                p1: lane.curve.p1,
                p2: lane.curve.p2,
                p3: lane.curve.p3,
                road_class: format!("{:?}", lane.road_class),
                speed_limit: lane.speed_limit,
                wear: lane.wear,
                is_hidden: lane.is_hidden,
                concealment: lane.concealment,
            });
        }

        let mut agents = Vec::new();
        for agent in &self.agents {
            agents.push(AgentSnapshot {
                id: agent.id,
                gender: format!("{:?}", agent.gender),
                x: agent.world_pos.x,
                y: agent.world_pos.y,
                z: agent.world_pos.z,
                age: agent.age,
                birth_tick: agent.birth_tick,
                heading_rad: agent.forward_heading_rad,
                pitch_rad: agent.pitch_rad,
                velocity: agent.current_velocity,
                carried_water: agent.carried_water,
                carried_food: agent.carried_food,
                carried_wood: agent.carried_wood,
                carried_stone: agent.carried_stone,
                carried_gold: agent.carried_gold,
                build_timer: agent.build_timer,
                miscarriage_alert_timer: agent.miscarriage_alert_timer,
                state: format!("{:?}", agent.state),
                is_alive: agent.is_alive,
                hunger: agent.hunger,
                thirst: agent.thirst,
                stamina: agent.stamina,
                health: agent.health,
                max_health: agent.max_health,
                is_pregnant: agent.is_pregnant,
                pregnancy_progress: agent.pregnancy_progress,
                pregnancy_child_id: agent.pregnancy_child_id,
                is_fetus: agent.is_fetus,
                miscarriage_cooldown: agent.miscarriage_cooldown_timer,
                miscarriage_alert: agent.miscarriage_alert_timer > 0.0,
                death_decay_timer: agent.death_decay_timer,
                death_cause: agent.death_cause.clone(),
                current_need: agent.current_need.clone(),
                is_covert: agent.is_covert,
                stealth_visibility: agent.stealth_visibility,
                home_house_id: agent.home_house_id,
                generation: agent.generation,
                spouse_id: agent.spouse_id,
                mother_id: agent.mother_id,
                father_id: agent.father_id,
                children_ids: agent.children_ids.clone(),
                intelligence: agent.intelligence,
                strength: agent.strength,
                digestion_efficiency: agent.digestion_efficiency,
                libido: agent.libido,
                sleep_efficiency: agent.sleep_efficiency,
                life_expectancy: agent.life_expectancy,
                surname: agent.surname.clone(),
                // ★ M6 威望改为 Agent 持久综合分值（透传存储值，不再由子嗣数派生）
                prestige: agent.prestige,
                // ★ M2 婚姻与家户归属
                marriage_history_count: self.marriage_registry.by_agent.get(&agent.id).map(|v| v.len() as u32).unwrap_or(0),
                household_id: self.household_registry.household_of(agent.id),
                household_role: {
                    if let Some(hid) = self.household_registry.household_of(agent.id) {
                        if let Some(hh) = self.household_registry.get(hid) {
                            if hh.head == agent.id {
                                "Head".to_string()
                            } else if agent.spouse_id == Some(hh.head) {
                                "Spouse".to_string()
                            } else {
                                "Child".to_string()
                            }
                        } else {
                            "None".to_string()
                        }
                    } else {
                        "None".to_string()
                    }
                },
                // ★ M4 到达时刻与夺位远征状态
                arrival_tick: agent.arrival_tick,
                is_on_expedition: matches!(agent.state, crate::spatial::agent::PrimitiveActionState::SeekingThrone),
            });
        }

        // ★ 家户登记簿快照（家庭跟着男人走）
        let resource_kinds = [ResourceKind::Water, ResourceKind::Food, ResourceKind::Wood, ResourceKind::Stone, ResourceKind::Gold];
        let mut households = Vec::new();
        for (_hid, hh) in &self.household_registry.households {
            let balances: Vec<LedgerBalanceSnapshot> = resource_kinds.iter().map(|&rk| {
                LedgerBalanceSnapshot {
                    resource: format!("{:?}", rk),
                    amount: hh.group.ledger.balance(rk),
                }
            }).collect();
            // 取最近8条团体事件（从新到旧；直接访问 VecDeque 字段以获得 DoubleEndedIterator）
            let recent_events: Vec<String> = hh.group.ledger.events
                .iter()
                .rev()
                .take(8)
                .map(|e| e.note.clone())
                .collect();
            // 取最近8笔资源流水（从新到旧）
            let recent_journal: Vec<TransferRecordSnapshot> = hh.group.ledger.journal
                .iter()
                .rev()
                .take(8)
                .map(|r| TransferRecordSnapshot {
                    tick: r.tick,
                    resource: format!("{:?}", r.resource),
                    amount: r.amount,
                    from: format!("{:?}", r.from),
                    to: format!("{:?}", r.to),
                    reason: format!("{:?}", r.reason),
                })
                .collect();
            households.push(HouseholdSnapshot {
                id: hh.id,
                head: hh.head,
                members: hh.group.members.iter().copied().collect(),
                balances,
                parent_household: hh.parent_household,
                founded_tick: hh.founded_tick,
                is_dissolved: hh.is_dissolved,
                recent_events,
                recent_journal,
            });
        }

        // ★ 婚姻登记簿快照
        let mut marriages = Vec::new();
        for (_mid, m) in &self.marriage_registry.marriages {
            marriages.push(MarriageSnapshot {
                id: m.id,
                husband_id: m.husband_id,
                wife_id: m.wife_id,
                start_tick: m.start_tick,
                end_tick: m.end_tick,
                end_reason: m.end_reason.map(|r| format!("{:?}", r)),
                is_active: m.is_active(),
            });
        }

        // ★ M3 宗族登记簿快照
        let mut clans = Vec::new();
        for (surname, clan) in &self.clan_registry.clans {
            let balances: Vec<LedgerBalanceSnapshot> = resource_kinds.iter().map(|&rk| {
                LedgerBalanceSnapshot {
                    resource: format!("{:?}", rk),
                    amount: clan.ledger.balance(rk),
                }
            }).collect();
            let recent_events: Vec<String> = clan.ledger.events
                .iter()
                .rev()
                .take(8)
                .map(|e| e.note.clone())
                .collect();
            let recent_journal: Vec<TransferRecordSnapshot> = clan.ledger.journal
                .iter()
                .rev()
                .take(8)
                .map(|r| TransferRecordSnapshot {
                    tick: r.tick,
                    resource: format!("{:?}", r.resource),
                    amount: r.amount,
                    from: format!("{:?}", r.from),
                    to: format!("{:?}", r.to),
                    reason: format!("{:?}", r.reason),
                })
                .collect();
            clans.push(ClanSnapshot {
                surname: surname.clone(),
                leader_id: clan.leader,
                member_count: clan.members.len() as u32,
                member_ids: clan.members.iter().copied().collect(),
                balances,
                recent_journal,
                recent_events,
            });
        }

        // ★ M4 地区与王国快照
        let mut regions = Vec::new();
        for (camp_id, region) in &self.region_registry.regions {
            let camp_name = self.pois.iter()
                .find(|p| p.poi_type == crate::spatial::poi::PoiType::Camp && p.id == *camp_id)
                .map(|p| p.camp_title())
                .unwrap_or_else(|| format!("营地#{}", camp_id));

            let balances: Vec<LedgerBalanceSnapshot> = resource_kinds.iter().map(|&rk| {
                LedgerBalanceSnapshot {
                    resource: format!("{:?}", rk),
                    amount: region.group.ledger.balance(rk),
                }
            }).collect();
            let recent_events: Vec<String> = region.group.ledger.events
                .iter()
                .rev()
                .take(8)
                .map(|e| e.note.clone())
                .collect();
            let recent_journal: Vec<TransferRecordSnapshot> = region.group.ledger.journal
                .iter()
                .rev()
                .take(8)
                .map(|r| TransferRecordSnapshot {
                    tick: r.tick,
                    resource: format!("{:?}", r.resource),
                    amount: r.amount,
                    from: format!("{:?}", r.from),
                    to: format!("{:?}", r.to),
                    reason: format!("{:?}", r.reason),
                })
                .collect();

            // 到达时序前10
            let arrival_order: Vec<u32> = region.arrival_order.iter().take(10).copied().collect();

            // 顺位前3继承人（长子继承制：国王的儿子→孙子→arrival_order下一男性）
            let mut heir_candidates: Vec<u32> = Vec::new();
            if let Some(king_id) = region.group.leader {
                // 儿子
                let mut sons: Vec<(u32, f32)> = Vec::new();
                for a in &self.agents {
                    if a.is_alive && a.gender == crate::spatial::agent::Gender::Male && a.father_id == Some(king_id) {
                        sons.push((a.id, a.age));
                    }
                }
                sons.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap().then(a.0.cmp(&b.0)));
                for (sid, _) in sons.iter().take(3) {
                    heir_candidates.push(*sid);
                }
                // 若儿子不足3个，补孙子
                if heir_candidates.len() < 3 {
                    let son_ids: std::collections::BTreeSet<u32> = sons.iter().map(|(id, _)| *id).collect();
                    let mut grandsons: Vec<(u32, f32)> = Vec::new();
                    for a in &self.agents {
                        if a.is_alive && a.gender == crate::spatial::agent::Gender::Male {
                            if let Some(fid) = a.father_id {
                                if son_ids.contains(&fid) {
                                    grandsons.push((a.id, a.age));
                                }
                            }
                        }
                    }
                    grandsons.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap().then(a.0.cmp(&b.0)));
                    for (gid, _) in grandsons.iter() {
                        if heir_candidates.len() >= 3 { break; }
                        heir_candidates.push(*gid);
                    }
                }
            }

            // 正在冲向该营地夺位的族人
            let active_expedition_agents: Vec<u32> = self.expedition_targets.iter()
                .filter(|(_, &cid)| cid == *camp_id)
                .map(|(&aid, _)| aid)
                .collect();

            regions.push(RegionSnapshot {
                camp_id: *camp_id,
                camp_name,
                king_id: region.group.leader,
                regime: format!("{:?}", region.regime),
                succession: format!("{:?}", region.succession),
                member_count: region.group.members.len() as u32,
                arrival_order,
                heir_candidates,
                balances,
                recent_journal,
                recent_events,
                active_expedition_agents,
            });
        }

        let season_str = match self.current_season {
            Season::Spring => "Spring",
            Season::Summer => "Summer",
            Season::Autumn => "Autumn",
            Season::Winter => "Winter",
        };
        let quarter_length = self.config.season_quarter_length();
        let season_progress = ((self.season_timer + quarter_length * 0.5) % quarter_length) / quarter_length;

        WorldSnapshot3D {
            tick: self.tick_counter,
            terrain_cells,
            grid_w: self.terrain.grid_width,
            grid_h: self.terrain.grid_height,
            world_size: self.terrain.world_size,
            tilt_angle_rad: self.terrain.tilt_angle_rad,
            tilt_magnitude: self.terrain.tilt_magnitude,
            pois,
            houses,
            nodes,
            lanes,
            agents,
            households,
            marriages,
            clans,
            regions,
            public_granary_balances: resource_kinds.iter().map(|&rk| {
                LedgerBalanceSnapshot {
                    resource: format!("{:?}", rk),
                    amount: self.public_granary.balance(rk),
                }
            }).collect(),
            total_births: self.total_births,
            total_deaths: self.total_deaths,
            total_deaths_natural: self.total_deaths_natural,
            total_deaths_unnatural: self.total_deaths_unnatural,
            total_miscarriages: self.total_miscarriages,
            season: season_str.to_string(),
            temperature: self.temperature,
            season_progress,
            last_mutation_event: self.last_event.clone(),
        }
    }

    /// 四季更迭与宏观环境温度演化 (正弦周期拟合)
    pub fn tick_season(&mut self, dt: f32) {
        self.season_timer += dt;
        let year_length = self.config.season_year_length;
        let quarter_length = self.config.season_quarter_length();
        let season_time = self.season_timer % year_length;
        let season_idx = (((season_time + quarter_length * 0.5) / quarter_length) as usize) % 4;
        let prev_season = self.current_season;
        self.current_season = match season_idx {
            0 => Season::Spring,
            1 => Season::Summer,
            2 => Season::Autumn,
            _ => Season::Winter,
        };

        if self.current_season != prev_season {
            let (icon, name) = match self.current_season {
                Season::Spring => ("🌸", "春季 (大地回春，气候温和)"),
                Season::Summer => ("☀️", "夏季 (炎炎夏日，草木茂盛)"),
                Season::Autumn => ("🍂", "秋季 (秋风送爽，抓紧备柴过冬)"),
                Season::Winter => ("❄️", "冬季 (严寒降临，房屋消耗木头取暖)"),
            };
            self.last_event = Some(format!("{} 季节轮转: 步入 {}！", icon, name));
        }

        let angle = (season_time / year_length) * std::f32::consts::TAU;
        self.temperature = self.config.temp_base_mid + self.config.temp_amplitude * angle.sin();
    }

    /// 结算已故族人的金币遗产：某人死后随身金币平分给所有在世的子一代子女
    pub fn settle_gold_inheritance(&mut self) {
        loop {
            let deceased_info = self.agents.iter_mut()
                .find(|a| !a.is_alive && a.carried_gold > 0.0001)
                .map(|a| {
                    let gold = a.carried_gold;
                    a.carried_gold = 0.0;
                    (a.id, gold)
                });

            match deceased_info {
                Some((deceased_id, gold)) => {
                    let living_children_ids: Vec<AgentId> = self.agents.iter()
                        .filter(|a| a.is_alive && (a.father_id == Some(deceased_id) || a.mother_id == Some(deceased_id)))
                        .map(|a| a.id)
                        .collect();

                    if !living_children_ids.is_empty() {
                        let count = living_children_ids.len();
                        let share = gold / (count as f32);
                        for cid in &living_children_ids {
                            if let Some(child) = self.agents.iter_mut().find(|a| a.id == *cid) {
                                child.carried_gold += share;
                            }
                        }
                        self.last_event = Some(format!(
                            "💰 遗产继承: 逝者 Agent #{} 遗留 {:.1} 黄金，由在世的 {} 位子女平分 (每人继承 {:.1} 黄金)！",
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
            let mut infos: Vec<(AgentId, AgentId, Option<AgentId>, String, NodeId, Vec3)> = Vec::new();
            for cid in &to_create {
                if let Some(mother) = self
                    .agents
                    .iter()
                    .find(|a| a.is_alive && (a.is_pregnant || a.ready_to_birth) && a.pregnancy_child_id == Some(*cid))
                {
                    let father_id = mother.pregnancy_father_id;
                    let surname = father_id
                        .and_then(|fid| self.agents.iter().find(|a| a.id == fid))
                        .map(|f| f.surname.clone())
                        .unwrap_or_else(|| mother.surname.clone());
                    infos.push((*cid, mother.id, father_id, surname, mother.home_camp_node, mother.world_pos));
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

    /// 全量重建 agent_index。在 agents Vec 结构发生变化（push 新 agent 或 retain 后）必须调用。
    pub fn rebuild_agent_index(&mut self) {
        self.agent_index.clear();
        for (i, agent) in self.agents.iter().enumerate() {
            self.agent_index.insert(agent.id, i);
        }
    }

    /// 按 AgentId O(1) 不可变查找
    pub fn agent_by_id(&self, id: AgentId) -> Option<&Agent3D> {
        let idx = *self.agent_index.get(&id)?;
        self.agents.get(idx)
    }

    /// 按 AgentId O(1) 可变查找
    pub fn agent_by_id_mut(&mut self, id: AgentId) -> Option<&mut Agent3D> {
        let idx = *self.agent_index.get(&id)?;
        self.agents.get_mut(idx)
    }
}
