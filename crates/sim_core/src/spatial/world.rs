use crate::rng::WorldRng;
use crate::config::SimConfig;
use std::collections::HashMap;
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, NodeId};
use super::agent::{Agent3D, AgentId};
use super::poi::{PrimitivePoi, PoiType};
use super::house::{House, HouseSnapshot};
use super::snapshot::{
    AgentSnapshot, GeoCellSnapshot, LaneSnapshot, NodeSnapshot, PoiSnapshot, Season,
    WorldSnapshot3D,
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
        }
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

        // 2. 代谢与繁衍
        for agent in &mut self.agents {
            let fertility_active = agent.home_house_id
                .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                .map(|h| h.is_fertility_active(&self.config))
                .unwrap_or(false);
            if let Some(event) = agent.tick_metabolism(dt, fertility_active, &self.config) {
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

        // 2.5 金币遗产继承结算 (死者金币平分给在世子一代子女)
        self.settle_gold_inheritance();

        // 3. POI 实际提取、分娩与死亡尸骸消逝
        self.tick_poi_interactions(dt);

        // 4. 房屋折旧、消耗与代际继承
        self.tick_housing(dt);

        // 5. 道路自然杂草丛生与退化衰减
        self.network.tick_wear_decay(dt, &self.config);

        // 6. 动力学运动与踩踏拓路
        for agent in &mut self.agents {
            agent.tick_movement(dt, &mut self.network, &self.config);
        }

        // 错峰决策
        self.tick_decisions();
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
                pantry_food: h.pantry_food,
                max_pantry_food: h.max_pantry_food,
                pantry_water: h.pantry_water,
                max_pantry_water: h.max_pantry_water,
                pantry_wood: h.pantry_wood,
                max_pantry_wood: h.max_pantry_wood,
                pantry_stone: h.pantry_stone,
                max_pantry_stone: h.max_pantry_stone,
                age: h.age,
                generation: h.generation,
                is_ruin: h.is_ruin,
                construction_progress: h.construction_progress,
                is_fertility_active: h.is_fertility_active(&self.config),
                is_pantry_full: h.is_pantry_full(&self.config),
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
                miscarriage_cooldown: agent.miscarriage_cooldown_timer,
                is_offroad: agent.is_traveling_offroad,
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
                prestige: agent.children_ids.len() as u32,
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