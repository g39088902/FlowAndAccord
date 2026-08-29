use crate::rng::WorldRng;
use serde::{Deserialize, Serialize};

use super::vec3::Vec3;
use super::graph::{LaneGraph3D, LaneId, NodeId, NodeType, RoadClass};
use super::agent::{Agent3D, AgentId, Gender, PrimitiveActionState};
use super::poi::{PrimitivePoi, PoiId, PoiType};
use super::house::{House, HouseSnapshot, HouseTier};
use crate::geo::terrain::TerrainMap;

/// 四季系统 (240秒完整年轮，每季60秒)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Season {
    Spring, // 🌸 春季 (温和 15°C ~ 25°C)
    Summer, // ☀️ 夏季 (炎热 25°C ~ 35°C)
    Autumn, // 🍂 秋季 (凉爽 10°C ~ 18°C)
    Winter, // ❄️ 冬季 (严寒 -10°C ~ 2°C，房屋消耗木头取暖)
}

/// 外部渲染只读快照数据结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldSnapshot3D {
    pub tick: u64,
    pub terrain_cells: Vec<GeoCellSnapshot>,
    pub grid_w: usize,
    pub grid_h: usize,
    pub world_size: f32,
    pub tilt_angle_rad: f32,
    pub tilt_magnitude: f32,
    pub pois: Vec<PoiSnapshot>,
    pub houses: Vec<HouseSnapshot>,
    pub nodes: Vec<NodeSnapshot>,
    pub lanes: Vec<LaneSnapshot>,
    pub agents: Vec<AgentSnapshot>,
    pub total_births: u32,
    pub total_deaths: u32,
    pub total_miscarriages: u32,
    pub season: String,
    pub temperature: f32,
    pub season_progress: f32,
    pub last_mutation_event: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoCellSnapshot {
    pub elevation: f32,
    pub slope_angle: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoiSnapshot {
    pub id: PoiId,
    pub poi_type: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub current_stock: f32,
    pub max_stock: f32,
    pub regen_rate: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeSnapshot {
    pub id: NodeId,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub node_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneSnapshot {
    pub id: LaneId,
    pub from: NodeId,
    pub to: NodeId,
    pub p0: Vec3,
    pub p1: Vec3,
    pub p2: Vec3,
    pub p3: Vec3,
    pub road_class: String,
    pub speed_limit: f32,
    pub wear: f32, // 踩踏等级连续浮点数 (0.0 ~ 5.0)
    pub is_hidden: bool,
    pub concealment: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSnapshot {
    pub id: AgentId,
    pub gender: String, // "Female" / "Male"
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub age: f32, // 年龄 (秒)
    pub heading_rad: f32,
    pub pitch_rad: f32,
    pub velocity: f32,
    pub carried_gold: f32,
    pub build_timer: f32,
    pub miscarriage_alert_timer: f32,
    pub state: String,
    pub is_alive: bool,
    pub hunger: f32, // 0.0 ~ 25.0 单位
    pub thirst: f32, // 0.0 ~ 25.0 单位
    pub stamina: f32,
    pub is_pregnant: bool,
    pub pregnancy_progress: f32,
    pub miscarriage_cooldown: f32,
    pub is_offroad: bool,
    pub miscarriage_alert: bool,
    pub death_decay_timer: f32,
    pub death_cause: Option<String>,
    pub is_covert: bool,
    pub stealth_visibility: f32,
    pub home_house_id: Option<u32>,
    pub spouse_id: Option<AgentId>,
    pub mother_id: Option<AgentId>,
    pub father_id: Option<AgentId>,
    pub children_ids: Vec<AgentId>,
}

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
}

impl World3DEngine {
    pub fn new(grid_res: usize, world_size: f32) -> Self {
        Self::new_seeded(grid_res, world_size, 42)
    }

    /// 指定种子的确定性世界构建 (wasm 桥接与 SL 复现使用)
    pub fn new_seeded(grid_res: usize, world_size: f32, seed: u64) -> Self {
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

    /// 构建生态：营地6处(无限)、水泉6处(上限40,产速1.0)、食物6处(上限40,产速1.0) 与全图直连动线
    pub fn seed_primitive_ecology(&mut self, agent_count: usize) {
        
        let half_size = self.terrain.world_size / 2.0;

        self.pois.clear();
        self.network = LaneGraph3D::new();
        self.agents.clear();
        self.total_births = 0;
        self.total_deaths = 0;
        self.total_miscarriages = 0;
        self.next_agent_id = 1;

        let mut camp_nodes = Vec::new();
        let mut water_nodes = Vec::new();
        let mut food_nodes = Vec::new();
        let mut wood_nodes = Vec::new();
        let mut stone_nodes = Vec::new();
        let mut gold_nodes = Vec::new();
        let mut all_node_ids = Vec::new();

        let mut poi_positions: Vec<Vec3> = Vec::new();
        let min_poi_distance = 68.0f32;

        let mut find_spaced_pos = |rng: &mut WorldRng, terrain: &crate::geo::TerrainMap, radius_ratio: f32| -> Vec3 {
            for _ in 0..100 {
                let x = rng.gen_range(-half_size * radius_ratio, half_size * radius_ratio);
                let y = rng.gen_range(-half_size * radius_ratio, half_size * radius_ratio);
                let elev = terrain.sample_elevation(x, y);
                let cand = Vec3::new(x, y, elev);
                if poi_positions.iter().all(|p| p.distance_to(&cand) >= min_poi_distance) {
                    poi_positions.push(cand);
                    return cand;
                }
            }
            // Fallback with looser distance if tight
            for _ in 0..50 {
                let x = rng.gen_range(-half_size * radius_ratio, half_size * radius_ratio);
                let y = rng.gen_range(-half_size * radius_ratio, half_size * radius_ratio);
                let elev = terrain.sample_elevation(x, y);
                let cand = Vec3::new(x, y, elev);
                if poi_positions.iter().all(|p| p.distance_to(&cand) >= min_poi_distance * 0.6) {
                    poi_positions.push(cand);
                    return cand;
                }
            }
            let x = rng.gen_range(-half_size * radius_ratio, half_size * radius_ratio);
            let y = rng.gen_range(-half_size * radius_ratio, half_size * radius_ratio);
            let cand = Vec3::new(x, y, terrain.sample_elevation(x, y));
            poi_positions.push(cand);
            cand
        };

        // 1. 生成 6 处避风营地 (无限储量，保持间距)
        for i in 0..6 {
            let mut pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.70);
            pos.z += 0.5;
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            camp_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new((i + 1) as u32, PoiType::Camp, pos));
        }

        // 2. 生成 6 处随机分布水源 (上限 60.0 单位，产速 2.00 单位/秒，全图随机分布且保持间距)
        for i in 0..6 {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            water_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new((i + 10) as u32, PoiType::WaterSource, pos));
        }

        // 3. 生成 6 处缓坡浆果灌木 (上限 60.0 单位，产速 2.00 单位/秒，保持间距)
        for i in 0..6 {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            food_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new((i + 20) as u32, PoiType::BerryBush, pos));
        }

        // 4. 生成 4 处茂密林木 (缩减为4个，上限 60.0 单位，产速 2.00 单位/秒，保持间距)
        for i in 0..4 {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            wood_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new((i + 30) as u32, PoiType::WoodForest, pos));
        }

        // 5. 生成 2 处嶙峋采石场 (上限 60.0 单位，产速 2.00 单位/秒，保持间距)
        for i in 0..2 {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            stone_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new((i + 40) as u32, PoiType::StoneQuarry, pos));
        }

        // 6. 生成 1 处璀璨金矿 (上限 60.0 单位，产速 1.80 单位/秒，用于顶级庄园升级)
        for i in 0..1 {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            gold_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new((i + 50) as u32, PoiType::GoldMine, pos));
        }

        // 7. 地形过渡节点
        for _ in 0..17 {
            let x = self.rng.gen_range(-half_size * 0.85, half_size * 0.85);
            let y = self.rng.gen_range(-half_size * 0.85, half_size * 0.85);
            let elev = self.terrain.sample_elevation(x, y);
            let node_id = self.network.add_node(Vec3::new(x, y, elev), NodeType::GroundIntersection);
            all_node_ids.push(node_id);
        }

        // 5. 全图任意点直连路网 (近距离 100% 速度，远距离直连越野 50% 速度)
        for i in 0..all_node_ids.len() {
            for j in (i + 1)..all_node_ids.len() {
                let id_a = all_node_ids[i];
                let id_b = all_node_ids[j];
                let pos_a = self.network.graph[*self.network.node_map.get(&id_a).unwrap()].pos;
                let pos_b = self.network.graph[*self.network.node_map.get(&id_b).unwrap()].pos;
                let dist = pos_a.distance_to(&pos_b);

                if dist < 175.0 {
                    let delta_z = (pos_a.z - pos_b.z).abs();
                    let road_class = if delta_z > 8.0 { RoadClass::Cobblestone } else { RoadClass::DirtTrack };
                    let _ = self.network.add_lane(id_a, id_b, None, road_class);
                    let _ = self.network.add_lane(id_b, id_a, None, road_class);
                } else if dist < 360.0 {
                    let _ = self.network.add_lane_with_options(id_a, id_b, None, RoadClass::DirtTrack, true, 0.9);
                    let _ = self.network.add_lane_with_options(id_b, id_a, None, RoadClass::DirtTrack, true, 0.9);
                }
            }
        }

        // 6. 注入初始部落民 (固定 6 男 6 女共 12 人，年龄在 0~240s 随机，容量 25.0 单位，初始 50%=12.5)
        let total_initial = 12;
        for i in 0..total_initial {
            let home_camp = camp_nodes[i % camp_nodes.len()];
            let is_covert = i % 4 == 0;
            let agent_id = self.next_agent_id;
            self.next_agent_id += 1;
            let gender = if i < 6 { Gender::Female } else { Gender::Male };
            let initial_age = self.rng.gen_range(0.0, 240.0);

            let mut agent = Agent3D::new(agent_id, home_camp, 8.5 + (i as f32 % 3.0), is_covert, initial_age, gender);
            let camp_pos = self.network.graph[*self.network.node_map.get(&home_camp).unwrap()].pos;
            agent.world_pos = camp_pos;
            self.agents.push(agent);
        }

        self.last_event = Some("🏕️ 规格就绪: 固定6男6女开局(年龄0~240s随机)，初始全图无路(踩踏拓路升级/闲置衰减)，男女分工！".to_string());
    }

    /// 真实有限资源交互结算与分娩
    pub fn tick_poi_interactions(&mut self, dt: f32) {
        let mut newborn_mothers = Vec::new();

        for agent in &mut self.agents {
            if !agent.is_alive {
                continue;
            }

            if agent.ready_to_birth {
                agent.ready_to_birth = false;
                newborn_mothers.push((agent.id, agent.home_camp_node));
            }

            match agent.state {
                PrimitiveActionState::DrinkingAtWater => {
                    let agent_pos = agent.world_pos;
                    let agent_hid = agent.home_house_id;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::WaterSource && p.pos.distance_to(&agent_pos) < 22.0) {
                        let need = (50.0 - agent.thirst).max(0.0);
                        if need > 0.01 {
                            let extracted = poi.extract(need.min(4.0 * dt));
                            agent.thirst = (agent.thirst + extracted).min(50.0);
                        }
                        if let Some(hid) = agent_hid {
                            if let Some(house) = self.houses.iter_mut().find(|h| h.id == hid) {
                                if house.pantry_water < house.max_pantry_water && poi.current_stock > 0.01 {
                                    let h_need = house.max_pantry_water - house.pantry_water;
                                    let h_extracted = poi.extract(h_need.min(4.0 * dt));
                                    house.pantry_water = (house.pantry_water + h_extracted).min(house.max_pantry_water);
                                }
                            }
                        }
                    }
                }
                PrimitiveActionState::ForagingFood => {
                    let agent_pos = agent.world_pos;
                    let agent_hid = agent.home_house_id;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::BerryBush && p.pos.distance_to(&agent_pos) < 22.0) {
                        let need = (50.0 - agent.hunger).max(0.0);
                        if need > 0.01 {
                            let extracted = poi.extract(need.min(4.0 * dt));
                            agent.hunger = (agent.hunger + extracted).min(50.0);
                        }
                        if let Some(hid) = agent_hid {
                            if let Some(house) = self.houses.iter_mut().find(|h| h.id == hid) {
                                if house.pantry_food < house.max_pantry_food && poi.current_stock > 0.01 {
                                    let h_need = house.max_pantry_food - house.pantry_food;
                                    let h_extracted = poi.extract(h_need.min(4.0 * dt));
                                    house.pantry_food = (house.pantry_food + h_extracted).min(house.max_pantry_food);
                                }
                            }
                        }
                    }
                }
                PrimitiveActionState::GatheringWood => {
                    let agent_pos = agent.world_pos;
                    let agent_hid = agent.home_house_id;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::WoodForest && p.pos.distance_to(&agent_pos) < 22.0) {
                        if let Some(hid) = agent_hid {
                            if let Some(house) = self.houses.iter_mut().find(|h| h.id == hid) {
                                if house.pantry_wood < house.max_pantry_wood && poi.current_stock > 0.01 {
                                    let h_need = house.max_pantry_wood - house.pantry_wood;
                                    let h_extracted = poi.extract(h_need.min(4.0 * dt));
                                    house.pantry_wood = (house.pantry_wood + h_extracted).min(house.max_pantry_wood);
                                }
                            }
                        }
                    }
                }
                PrimitiveActionState::MiningStone => {
                    let agent_pos = agent.world_pos;
                    let agent_hid = agent.home_house_id;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::StoneQuarry && p.pos.distance_to(&agent_pos) < 22.0) {
                        if let Some(hid) = agent_hid {
                            if let Some(house) = self.houses.iter_mut().find(|h| h.id == hid) {
                                if house.pantry_stone < house.max_pantry_stone && poi.current_stock > 0.01 {
                                    let h_need = house.max_pantry_stone - house.pantry_stone;
                                    let h_extracted = poi.extract(h_need.min(3.0 * dt));
                                    house.pantry_stone = (house.pantry_stone + h_extracted).min(house.max_pantry_stone);
                                }
                            }
                        }
                    }
                }
                PrimitiveActionState::MiningGold => {
                    let agent_pos = agent.world_pos;
                    let agent_hid = agent.home_house_id;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::GoldMine && p.pos.distance_to(&agent_pos) < 22.0) {
                        if poi.current_stock > 0.01 {
                            // 小人随身携带无限黄金
                            let extracted = poi.extract(3.0 * dt);
                            agent.carried_gold += extracted;

                            // 若家宅需要黄金升级，同时将黄金存入家宅金库
                            if let Some(hid) = agent_hid {
                                if let Some(house) = self.houses.iter_mut().find(|h| h.id == hid) {
                                    if house.pantry_gold < house.max_pantry_gold {
                                        let deposit = extracted.min(house.max_pantry_gold - house.pantry_gold);
                                        house.pantry_gold = (house.pantry_gold + deposit).min(house.max_pantry_gold);
                                    }
                                }
                            }
                        }
                    }
                }
                PrimitiveActionState::RestingAtCamp => {
                    // 当外部短缺或在私宅休息时，优先消耗房屋独立储备以维持饱暖
                    if let Some(hid) = agent.home_house_id {
                        if let Some(house) = self.houses.iter_mut().find(|h| h.id == hid) {
                            if agent.thirst < 35.0 && house.pantry_water > 0.05 {
                                let drink_amount = (50.0 - agent.thirst).min(house.pantry_water).min(3.0 * dt);
                                house.pantry_water = (house.pantry_water - drink_amount).max(0.0);
                                agent.thirst = (agent.thirst + drink_amount).min(50.0);
                            }
                            if agent.hunger < 35.0 && house.pantry_food > 0.05 {
                                let eat_amount = (50.0 - agent.hunger).min(house.pantry_food).min(3.0 * dt);
                                house.pantry_food = (house.pantry_food - eat_amount).max(0.0);
                                agent.hunger = (agent.hunger + eat_amount).min(50.0);
                            }
                            if agent.carried_gold > 0.01 && house.pantry_gold < house.max_pantry_gold {
                                let deposit = agent.carried_gold.min(house.max_pantry_gold - house.pantry_gold).min(5.0 * dt);
                                house.pantry_gold = (house.pantry_gold + deposit).min(house.max_pantry_gold);
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        // 分娩诞生新生儿 (年龄 0.0s，初始水粮 50% = 25.0 单位，男女各 50% 机率)！
        for (mother_id, camp_node) in newborn_mothers {
            let baby_id = self.next_agent_id;
            self.next_agent_id += 1;
            self.total_births += 1;
            let baby_gender = if self.rng.gen_bool(0.5) { Gender::Female } else { Gender::Male };
            let gender_str = if baby_gender == Gender::Female { "女婴 ♀" } else { "男婴 ♂" };
            let father_id = self.agents.iter().find(|a| a.id == mother_id).and_then(|m| m.spouse_id);

            // 确定家庭房屋归属 (优先继承母亲/父亲的私宅，未成年或未盖房的小孩共享家宅资源)
            let mother_house_id = self.agents.iter().find(|a| a.id == mother_id).and_then(|m| m.home_house_id);
            let father_house_id = father_id.and_then(|fid| self.agents.iter().find(|a| a.id == fid).and_then(|f| f.home_house_id));
            let family_house_id = mother_house_id.or(father_house_id);

            let birth_node = if let Some(hid) = family_house_id {
                self.houses.iter().find(|h| h.id == hid).map(|h| h.door_node_id).unwrap_or(camp_node)
            } else {
                camp_node
            };

            let mut baby = Agent3D::new(baby_id, birth_node, 8.5, false, 0.0, baby_gender);
            let camp_pos = self.network.graph[*self.network.node_map.get(&birth_node).unwrap()].pos;
            baby.world_pos = camp_pos;
            baby.hunger = 25.0; // 50% of 50.0
            baby.thirst = 25.0; // 50% of 50.0
            baby.stamina = 100.0;
            baby.mother_id = Some(mother_id);
            baby.father_id = father_id;
            baby.home_house_id = family_house_id; // 未盖房小孩与父母共享私宅

            // 建立双亲与子女的亲缘血脉
            if let Some(mother) = self.agents.iter_mut().find(|a| a.id == mother_id) {
                mother.children_ids.push(baby_id);
            }
            if let Some(fid) = father_id {
                if let Some(father) = self.agents.iter_mut().find(|a| a.id == fid) {
                    father.children_ids.push(baby_id);
                }
            }

            self.agents.push(baby);
            let parents_str = if let Some(fid) = father_id {
                format!("母亲 #{} 与 父亲 #{}", mother_id, fid)
            } else {
                format!("母亲 #{}", mother_id)
            };
            self.last_event = Some(format!("🍼 {} 顺利产下一名健康的{} (Agent #{}，幼年0s，入驻家庭私宅，需成长120s)！", parents_str, gender_str, baby_id));
        }

        self.agents.retain(|a| a.is_alive || a.death_decay_timer > 0.0);
    }

    /// 生存决策调度 (模式 A: 完全就近归宿与就近觅食寻水/伐木采石)
    pub fn tick_decisions(&mut self) {
        

        let water_nodes: Vec<NodeId> = self.pois.iter().filter(|p| p.poi_type == PoiType::WaterSource && p.current_stock > 0.5)
            .filter_map(|p| self.find_nearest_node(p.pos)).collect();
        let food_nodes: Vec<NodeId> = self.pois.iter().filter(|p| p.poi_type == PoiType::BerryBush && p.current_stock > 0.5)
            .filter_map(|p| self.find_nearest_node(p.pos)).collect();
        let wood_nodes: Vec<NodeId> = self.pois.iter().filter(|p| p.poi_type == PoiType::WoodForest && p.current_stock > 0.5)
            .filter_map(|p| self.find_nearest_node(p.pos)).collect();
        let stone_nodes: Vec<NodeId> = self.pois.iter().filter(|p| p.poi_type == PoiType::StoneQuarry && p.current_stock > 0.5)
            .filter_map(|p| self.find_nearest_node(p.pos)).collect();
        let gold_nodes: Vec<NodeId> = self.pois.iter().filter(|p| p.poi_type == PoiType::GoldMine && p.current_stock > 0.5)
            .filter_map(|p| self.find_nearest_node(p.pos)).collect();

        let camp_node_positions: Vec<(NodeId, Vec3)> = self.pois.iter()
            .filter(|p| p.poi_type == PoiType::Camp)
            .filter_map(|p| {
                let pos = p.pos;
                let mut best_id = None;
                let mut min_dist = f32::MAX;
                for node in self.network.graph.node_weights() {
                    let d = node.pos.distance_to(&pos);
                    if d < min_dist {
                        min_dist = d;
                        best_id = Some(node.id);
                    }
                }
                best_id.map(|nid| (nid, pos))
            })
            .collect();
        let find_nearest_camp = |pos: Vec3| -> Option<NodeId> {
            camp_node_positions.iter()
                .min_by(|(_, a), (_, b)| a.distance_to(&pos).partial_cmp(&b.distance_to(&pos)).unwrap())
                .map(|(nid, _)| *nid)
        };
        let find_start_node = |pos: Vec3, default_node: NodeId| -> NodeId {
            self.network.graph.node_weights()
                .min_by(|a, b| a.pos.distance_to(&pos).partial_cmp(&b.pos.distance_to(&pos)).unwrap())
                .map(|n| n.id)
                .unwrap_or(default_node)
        };

        for agent in &mut self.agents {
            if !agent.is_alive {
                continue;
            }

            match agent.state {
                PrimitiveActionState::RestingAtCamp => {
                    let thirst_urgency = if agent.is_pregnant { 27.5 } else { 20.0 }; // (满值 50.0)
                    let hunger_urgency = if agent.is_pregnant { 30.0 } else { 24.0 };  // (满值 50.0)
                    let start_node = find_start_node(agent.world_pos, agent.home_camp_node);

                    if agent.thirst < thirst_urgency && !water_nodes.is_empty() {
                        let mut sorted_water = water_nodes.clone();
                        sorted_water.sort_by(|&a, &b| {
                            let pos_a = self.network.graph[*self.network.node_map.get(&a).unwrap()].pos;
                            let pos_b = self.network.graph[*self.network.node_map.get(&b).unwrap()].pos;
                            pos_a.distance_to(&agent.world_pos).partial_cmp(&pos_b.distance_to(&agent.world_pos)).unwrap()
                        });
                        let target = sorted_water[0];
                        if let Some(path) = self.network.find_path_3d_with_preference(start_node, target, agent.is_covert) {
                            if !path.is_empty() {
                                agent.state = PrimitiveActionState::SeekingWater;
                                agent.target_poi_node = Some(target);
                                agent.route = path.clone();
                                agent.route_index = 0;
                                agent.current_lane_id = Some(path[0]);
                                agent.distance_along_curve = 0.0;
                            }
                        }
                    } else if agent.hunger < hunger_urgency && !food_nodes.is_empty() {
                        let mut sorted_food = food_nodes.clone();
                        sorted_food.sort_by(|&a, &b| {
                            let pos_a = self.network.graph[*self.network.node_map.get(&a).unwrap()].pos;
                            let pos_b = self.network.graph[*self.network.node_map.get(&b).unwrap()].pos;
                            pos_a.distance_to(&agent.world_pos).partial_cmp(&pos_b.distance_to(&agent.world_pos)).unwrap()
                        });
                        let target = sorted_food[0];
                        if let Some(path) = self.network.find_path_3d_with_preference(start_node, target, agent.is_covert) {
                            if !path.is_empty() {
                                agent.state = PrimitiveActionState::SeekingFood;
                                agent.target_poi_node = Some(target);
                                agent.route = path.clone();
                                agent.route_index = 0;
                                agent.current_lane_id = Some(path[0]);
                                agent.distance_along_curve = 0.0;
                            }
                        }
                    } else if agent.stamina >= 60.0 && agent.home_house_id.is_some() {
                        // 备货与持续扩产升级动机：根据房屋当前等级精准识别真正急需的物资
                        let house_info = agent.home_house_id.and_then(|hid| self.houses.iter().find(|h| h.id == hid && !h.is_ruin))
                            .map(|h| {
                                let (target_wood, need_stone, need_gold) = match h.tier {
                                    HouseTier::Tier0Warehouse => (0.0, false, false), // 0级仓库只缺水和粮，不需要木材
                                    HouseTier::Tier1ThatchedHut => (h.max_pantry_wood, false, false), // 1级茅草房升级私宅需要木材满20
                                    HouseTier::Tier2LeanTo => (16.0, h.pantry_stone < h.max_pantry_stone, false), // 2级私宅木材保底16过冬，核心需要采石满40升级庄舍
                                    HouseTier::Tier3Homestead => (20.0, h.pantry_stone < h.max_pantry_stone, h.pantry_gold < h.max_pantry_gold), // 3级庄舍木材保底20，核心采石80与淘金40
                                    HouseTier::Tier4Manor => (25.0, false, false), // 4级大庄园木材保底25用于冬季取暖
                                };
                                let need_water = h.pantry_water < h.max_pantry_water;
                                let need_food = h.pantry_food < h.max_pantry_food;
                                let need_wood = h.pantry_wood < target_wood;
                                (h.tier, need_water, need_food, need_wood, need_stone, need_gold)
                            });

                        if let Some((tier, need_water, need_food, need_wood, need_stone, need_gold)) = house_info {
                            let is_female = agent.gender == Gender::Female;
                            // 女性优先负责运水和采摘浆果；男性兼顾建材 (木石金)
                            if (need_water || (is_female && need_water)) && !water_nodes.is_empty() && self.rng.gen_bool(if is_female { 0.60 } else { 0.35 }) {
                                let mut sorted_water = water_nodes.clone();
                                sorted_water.sort_by(|&a, &b| {
                                    let pos_a = self.network.graph[*self.network.node_map.get(&a).unwrap()].pos;
                                    let pos_b = self.network.graph[*self.network.node_map.get(&b).unwrap()].pos;
                                    pos_a.distance_to(&agent.world_pos).partial_cmp(&pos_b.distance_to(&agent.world_pos)).unwrap()
                                });
                                let target = sorted_water[0];
                                if let Some(path) = self.network.find_path_3d_with_preference(start_node, target, agent.is_covert) {
                                    if !path.is_empty() {
                                        agent.state = PrimitiveActionState::SeekingWater;
                                        agent.target_poi_node = Some(target);
                                        agent.route = path.clone();
                                        agent.route_index = 0;
                                        agent.current_lane_id = Some(path[0]);
                                        agent.distance_along_curve = 0.0;
                                    }
                                }
                            } else if (need_food || (is_female && need_food)) && !food_nodes.is_empty() && self.rng.gen_bool(if is_female { 0.60 } else { 0.35 }) {
                                let mut sorted_food = food_nodes.clone();
                                sorted_food.sort_by(|&a, &b| {
                                    let pos_a = self.network.graph[*self.network.node_map.get(&a).unwrap()].pos;
                                    let pos_b = self.network.graph[*self.network.node_map.get(&b).unwrap()].pos;
                                    pos_a.distance_to(&agent.world_pos).partial_cmp(&pos_b.distance_to(&agent.world_pos)).unwrap()
                                });
                                let target = sorted_food[0];
                                if let Some(path) = self.network.find_path_3d_with_preference(start_node, target, agent.is_covert) {
                                    if !path.is_empty() {
                                        agent.state = PrimitiveActionState::SeekingFood;
                                        agent.target_poi_node = Some(target);
                                        agent.route = path.clone();
                                        agent.route_index = 0;
                                        agent.current_lane_id = Some(path[0]);
                                        agent.distance_along_curve = 0.0;
                                    }
                                }
                            } else if need_wood && !wood_nodes.is_empty() && self.rng.gen_bool(0.40) {
                                let mut sorted_wood = wood_nodes.clone();
                                sorted_wood.sort_by(|&a, &b| {
                                    let pos_a = self.network.graph[*self.network.node_map.get(&a).unwrap()].pos;
                                    let pos_b = self.network.graph[*self.network.node_map.get(&b).unwrap()].pos;
                                    pos_a.distance_to(&agent.world_pos).partial_cmp(&pos_b.distance_to(&agent.world_pos)).unwrap()
                                });
                                let target = sorted_wood[0];
                                if let Some(path) = self.network.find_path_3d_with_preference(start_node, target, agent.is_covert) {
                                    if !path.is_empty() {
                                        agent.state = PrimitiveActionState::SeekingWood;
                                        agent.target_poi_node = Some(target);
                                        agent.route = path.clone();
                                        agent.route_index = 0;
                                        agent.current_lane_id = Some(path[0]);
                                        agent.distance_along_curve = 0.0;
                                    }
                                }
                            } else if need_stone && !stone_nodes.is_empty() && self.rng.gen_bool(0.45) {
                                let mut sorted_stone = stone_nodes.clone();
                                sorted_stone.sort_by(|&a, &b| {
                                    let pos_a = self.network.graph[*self.network.node_map.get(&a).unwrap()].pos;
                                    let pos_b = self.network.graph[*self.network.node_map.get(&b).unwrap()].pos;
                                    pos_a.distance_to(&agent.world_pos).partial_cmp(&pos_b.distance_to(&agent.world_pos)).unwrap()
                                });
                                let target = sorted_stone[0];
                                if let Some(path) = self.network.find_path_3d_with_preference(start_node, target, agent.is_covert) {
                                    if !path.is_empty() {
                                        agent.state = PrimitiveActionState::SeekingStone;
                                        agent.target_poi_node = Some(target);
                                        agent.route = path.clone();
                                        agent.route_index = 0;
                                        agent.current_lane_id = Some(path[0]);
                                        agent.distance_along_curve = 0.0;
                                    }
                                }
                            } else if need_gold && !gold_nodes.is_empty() && self.rng.gen_bool(0.45) {
                                let mut sorted_gold = gold_nodes.clone();
                                sorted_gold.sort_by(|&a, &b| {
                                    let pos_a = self.network.graph[*self.network.node_map.get(&a).unwrap()].pos;
                                    let pos_b = self.network.graph[*self.network.node_map.get(&b).unwrap()].pos;
                                    pos_a.distance_to(&agent.world_pos).partial_cmp(&pos_b.distance_to(&agent.world_pos)).unwrap()
                                });
                                let target = sorted_gold[0];
                                if let Some(path) = self.network.find_path_3d_with_preference(start_node, target, agent.is_covert) {
                                    if !path.is_empty() {
                                        agent.state = PrimitiveActionState::SeekingGold;
                                        agent.target_poi_node = Some(target);
                                        agent.route = path.clone();
                                        agent.route_index = 0;
                                        agent.current_lane_id = Some(path[0]);
                                        agent.distance_along_curve = 0.0;
                                    }
                                }
                            }
                        }
                    } else if agent.stamina >= 95.0 && agent.hunger < 35.0 && !food_nodes.is_empty() && self.rng.gen_bool(0.04) {
                        let target = food_nodes[self.rng.gen_range_usize(0, food_nodes.len())];
                        if let Some(path) = self.network.find_path_3d_with_preference(start_node, target, agent.is_covert) {
                            if !path.is_empty() {
                                agent.state = PrimitiveActionState::SeekingFood;
                                agent.target_poi_node = Some(target);
                                agent.route = path.clone();
                                agent.route_index = 0;
                                agent.current_lane_id = Some(path[0]);
                                agent.distance_along_curve = 0.0;
                            }
                        }
                    }
                }
                PrimitiveActionState::DrinkingAtWater => {
                    let poi = self.pois.iter().find(|p| p.poi_type == PoiType::WaterSource && p.pos.distance_to(&agent.world_pos) < 22.0);
                    let is_empty = poi.map(|p| p.current_stock <= 0.05).unwrap_or(true);

                    if agent.thirst >= 48.0 || is_empty {
                        let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                        if agent.hunger < 25.0 && !food_nodes.is_empty() {
                            let target = food_nodes[self.rng.gen_range_usize(0, food_nodes.len())];
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.state = PrimitiveActionState::SeekingFood;
                                    agent.target_poi_node = Some(target);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        } else {
                            let target_home = if agent.home_house_id.is_some() {
                                agent.home_camp_node
                            } else {
                                find_nearest_camp(agent.world_pos).unwrap_or(agent.home_camp_node)
                            };
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target_home, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.home_camp_node = target_home;
                                    agent.state = PrimitiveActionState::ReturningToCamp;
                                    agent.target_poi_node = Some(target_home);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        }
                    }
                }
                PrimitiveActionState::ForagingFood => {
                    let poi = self.pois.iter().find(|p| p.poi_type == PoiType::BerryBush && p.pos.distance_to(&agent.world_pos) < 22.0);
                    let is_empty = poi.map(|p| p.current_stock <= 0.05).unwrap_or(true);

                    if agent.hunger >= 48.0 || is_empty {
                        let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                        if agent.thirst < 25.0 && !water_nodes.is_empty() {
                            let target = water_nodes[self.rng.gen_range_usize(0, water_nodes.len())];
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.state = PrimitiveActionState::SeekingWater;
                                    agent.target_poi_node = Some(target);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        } else {
                            let target_home = if agent.home_house_id.is_some() {
                                agent.home_camp_node
                            } else {
                                find_nearest_camp(agent.world_pos).unwrap_or(agent.home_camp_node)
                            };
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target_home, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.home_camp_node = target_home;
                                    agent.state = PrimitiveActionState::ReturningToCamp;
                                    agent.target_poi_node = Some(target_home);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        }
                    }
                }
                PrimitiveActionState::GatheringWood => {
                    let poi = self.pois.iter().find(|p| p.poi_type == PoiType::WoodForest && p.pos.distance_to(&agent.world_pos) < 22.0);
                    let is_empty = poi.map(|p| p.current_stock <= 0.05).unwrap_or(true);
                    let is_house_wood_full = agent.home_house_id.and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                        .map(|h| {
                            let target_wood = match h.tier {
                                HouseTier::Tier0Warehouse => 0.0,
                                HouseTier::Tier1ThatchedHut => h.max_pantry_wood,
                                HouseTier::Tier2LeanTo => 16.0,
                                HouseTier::Tier3Homestead => 20.0,
                                HouseTier::Tier4Manor => 25.0,
                            };
                            h.pantry_wood >= target_wood
                        }).unwrap_or(true);

                    if is_empty || is_house_wood_full || agent.hunger < 20.0 || agent.thirst < 20.0 {
                        let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                        let target_home = if agent.home_house_id.is_some() {
                            agent.home_camp_node
                        } else {
                            find_nearest_camp(agent.world_pos).unwrap_or(agent.home_camp_node)
                        };
                        if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target_home, agent.is_covert) {
                            if !path.is_empty() {
                                agent.home_camp_node = target_home;
                                agent.state = PrimitiveActionState::ReturningToCamp;
                                agent.target_poi_node = Some(target_home);
                                agent.route = path.clone();
                                agent.route_index = 0;
                                agent.current_lane_id = Some(path[0]);
                                agent.distance_along_curve = 0.0;
                            }
                        }
                    }
                }
                PrimitiveActionState::MiningStone => {
                    let poi = self.pois.iter().find(|p| p.poi_type == PoiType::StoneQuarry && p.pos.distance_to(&agent.world_pos) < 22.0);
                    let is_empty = poi.map(|p| p.current_stock <= 0.05).unwrap_or(true);
                    let is_house_stone_full = agent.home_house_id.and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                        .map(|h| h.pantry_stone >= h.max_pantry_stone).unwrap_or(true);

                    if is_empty || is_house_stone_full || agent.hunger < 20.0 || agent.thirst < 20.0 {
                        let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                        let target_home = if agent.home_house_id.is_some() {
                            agent.home_camp_node
                        } else {
                            find_nearest_camp(agent.world_pos).unwrap_or(agent.home_camp_node)
                        };
                        if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target_home, agent.is_covert) {
                            if !path.is_empty() {
                                agent.home_camp_node = target_home;
                                agent.state = PrimitiveActionState::ReturningToCamp;
                                agent.target_poi_node = Some(target_home);
                                agent.route = path.clone();
                                agent.route_index = 0;
                                agent.current_lane_id = Some(path[0]);
                                agent.distance_along_curve = 0.0;
                            }
                        }
                    }
                }
                PrimitiveActionState::MiningGold => {
                    let poi = self.pois.iter().find(|p| p.poi_type == PoiType::GoldMine && p.pos.distance_to(&agent.world_pos) < 22.0);
                    let is_empty = poi.map(|p| p.current_stock <= 0.05).unwrap_or(true);
                    let is_house_gold_full = agent.home_house_id.and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                        .map(|h| h.pantry_gold >= h.max_pantry_gold).unwrap_or(true);

                    if is_empty || is_house_gold_full || agent.hunger < 20.0 || agent.thirst < 20.0 {
                        let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                        let target_home = if agent.home_house_id.is_some() {
                            agent.home_camp_node
                        } else {
                            find_nearest_camp(agent.world_pos).unwrap_or(agent.home_camp_node)
                        };
                        if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target_home, agent.is_covert) {
                            if !path.is_empty() {
                                agent.home_camp_node = target_home;
                                agent.state = PrimitiveActionState::ReturningToCamp;
                                agent.target_poi_node = Some(target_home);
                                agent.route = path.clone();
                                agent.route_index = 0;
                                agent.current_lane_id = Some(path[0]);
                                agent.distance_along_curve = 0.0;
                            }
                        }
                    }
                }
                PrimitiveActionState::SeekingWood => {
                    if wood_nodes.is_empty() || agent.hunger < 20.0 || agent.thirst < 20.0 {
                        let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                        if agent.thirst < 20.0 && !water_nodes.is_empty() {
                            let target = water_nodes[0];
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.state = PrimitiveActionState::SeekingWater;
                                    agent.target_poi_node = Some(target);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        } else if agent.hunger < 20.0 && !food_nodes.is_empty() {
                            let target = food_nodes[0];
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.state = PrimitiveActionState::SeekingFood;
                                    agent.target_poi_node = Some(target);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        } else {
                            let target_home = if agent.home_house_id.is_some() {
                                agent.home_camp_node
                            } else {
                                find_nearest_camp(agent.world_pos).unwrap_or(agent.home_camp_node)
                            };
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target_home, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.home_camp_node = target_home;
                                    agent.state = PrimitiveActionState::ReturningToCamp;
                                    agent.target_poi_node = Some(target_home);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        }
                    }
                }
                PrimitiveActionState::SeekingStone => {
                    if stone_nodes.is_empty() || agent.hunger < 20.0 || agent.thirst < 20.0 {
                        let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                        if agent.thirst < 20.0 && !water_nodes.is_empty() {
                            let target = water_nodes[0];
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.state = PrimitiveActionState::SeekingWater;
                                    agent.target_poi_node = Some(target);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        } else if agent.hunger < 20.0 && !food_nodes.is_empty() {
                            let target = food_nodes[0];
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.state = PrimitiveActionState::SeekingFood;
                                    agent.target_poi_node = Some(target);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        } else {
                            let target_home = if agent.home_house_id.is_some() {
                                agent.home_camp_node
                            } else {
                                find_nearest_camp(agent.world_pos).unwrap_or(agent.home_camp_node)
                            };
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target_home, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.home_camp_node = target_home;
                                    agent.state = PrimitiveActionState::ReturningToCamp;
                                    agent.target_poi_node = Some(target_home);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        }
                    }
                }
                PrimitiveActionState::SeekingGold => {
                    if gold_nodes.is_empty() || agent.hunger < 20.0 || agent.thirst < 20.0 {
                        let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                        if agent.thirst < 20.0 && !water_nodes.is_empty() {
                            let target = water_nodes[0];
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.state = PrimitiveActionState::SeekingWater;
                                    agent.target_poi_node = Some(target);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        } else if agent.hunger < 20.0 && !food_nodes.is_empty() {
                            let target = food_nodes[0];
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.state = PrimitiveActionState::SeekingFood;
                                    agent.target_poi_node = Some(target);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        } else {
                            let target_home = if agent.home_house_id.is_some() {
                                agent.home_camp_node
                            } else {
                                find_nearest_camp(agent.world_pos).unwrap_or(agent.home_camp_node)
                            };
                            if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target_home, agent.is_covert) {
                                if !path.is_empty() {
                                    agent.home_camp_node = target_home;
                                    agent.state = PrimitiveActionState::ReturningToCamp;
                                    agent.target_poi_node = Some(target_home);
                                    agent.route = path.clone();
                                    agent.route_index = 0;
                                    agent.current_lane_id = Some(path[0]);
                                    agent.distance_along_curve = 0.0;
                                }
                            }
                        }
                    }
                }
                PrimitiveActionState::SeekingWater => {
                    // 若外部水源全部枯竭，或家宅有水储备，紧急折返回家
                    if water_nodes.is_empty() {
                        let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                        let target_home = if agent.home_house_id.is_some() {
                            agent.home_camp_node
                        } else {
                            find_nearest_camp(agent.world_pos).unwrap_or(agent.home_camp_node)
                        };
                        if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target_home, agent.is_covert) {
                            if !path.is_empty() {
                                agent.home_camp_node = target_home;
                                agent.state = PrimitiveActionState::ReturningToCamp;
                                agent.target_poi_node = Some(target_home);
                                agent.route = path.clone();
                                agent.route_index = 0;
                                agent.current_lane_id = Some(path[0]);
                                agent.distance_along_curve = 0.0;
                            }
                        }
                    }
                }
                PrimitiveActionState::SeekingFood => {
                    // 若外部浆果全部枯竭，或家宅有粮食储备，紧急折返回家
                    if food_nodes.is_empty() {
                        let curr_node = agent.target_poi_node.unwrap_or(agent.home_camp_node);
                        let target_home = if agent.home_house_id.is_some() {
                            agent.home_camp_node
                        } else {
                            find_nearest_camp(agent.world_pos).unwrap_or(agent.home_camp_node)
                        };
                        if let Some(path) = self.network.find_path_3d_with_preference(curr_node, target_home, agent.is_covert) {
                            if !path.is_empty() {
                                agent.home_camp_node = target_home;
                                agent.state = PrimitiveActionState::ReturningToCamp;
                                agent.target_poi_node = Some(target_home);
                                agent.route = path.clone();
                                agent.route_index = 0;
                                agent.current_lane_id = Some(path[0]);
                                agent.distance_along_curve = 0.0;
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn find_nearest_camp_node(&self, pos: Vec3) -> Option<NodeId> {
        let mut best_id = None;
        let mut min_dist = f32::MAX;
        for p in self.pois.iter().filter(|p| p.poi_type == PoiType::Camp) {
            let d = p.pos.distance_to(&pos);
            if d < min_dist {
                min_dist = d;
                best_id = self.find_nearest_node(p.pos);
            }
        }
        best_id
    }

    fn find_nearest_node(&self, pos: Vec3) -> Option<NodeId> {
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

    /// 确定性仿真 Tick
    pub fn tick(&mut self, dt: f32) {
        self.tick_counter += 1;

        // 1. POI 自然恢复 (按类型应用前端可调的产速倍率)
        for poi in &mut self.pois {
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
            if let Some(event) = agent.tick_metabolism(dt) {
                if !agent.is_alive {
                    self.total_deaths += 1;
                }
                if event.contains("流产") {
                    self.total_miscarriages += 1;
                }
                self.last_event = Some(event);
            }
        }

        // 3. POI 实际提取、分娩与死亡尸骸消逝
        self.tick_poi_interactions(dt);

        // 4. 自发筑屋建造、私产确权、折旧与代际继承
        self.tick_housing(dt);

        if self.tick_counter % 15 == 0 {
            self.tick_decisions();
        }

        // 5. 道路自然杂草丛生与退化衰减
        self.network.tick_wear_decay(dt);

        // 6. 动力学运动与踩踏拓路
        for agent in &mut self.agents {
            agent.tick_movement(dt, &mut self.network);
        }
    }

    /// 部落定居与自发筑屋演化 (四季更迭、冬季取暖、多级营建扩容、私产确权与代际继承、自动婚姻)
    pub fn tick_housing(&mut self, dt: f32) {
        

        // 0. 四季更迭与环境温度计算 (240秒一年，每季60秒)
        self.season_timer += dt;
        let year_length = 240.0;
        let season_time = self.season_timer % year_length;
        let season_idx = (season_time / 60.0) as usize;
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
        self.temperature = 14.0 + 17.0 * angle.sin();

        // 冬季取暖消耗：低温或冬季时房屋消耗木材取暖
        if self.current_season == Season::Winter || self.temperature < 5.0 {
            let wood_burn_rate = 0.12 * dt;
            for house in &mut self.houses {
                if !house.is_ruin && house.tier != HouseTier::Tier0Warehouse {
                    house.pantry_wood = (house.pantry_wood - wood_burn_rate).max(0.0);
                }
            }
        }

        // 1. 房屋自然风化与折旧，0耐久度彻底坍塌消亡
        let mut collapsed_house_ids = Vec::new();
        for house in &mut self.houses {
            house.tick_depreciation(dt);
            if house.durability <= 0.0 {
                collapsed_house_ids.push(house.id);
            }
        }

        if !collapsed_house_ids.is_empty() {
            let updates: Vec<(usize, NodeId)> = self.agents.iter().enumerate()
                .filter_map(|(i, agent)| {
                    if let Some(hid) = agent.home_house_id {
                        if collapsed_house_ids.contains(&hid) {
                            let c_node = self.find_nearest_node(agent.world_pos)?;
                            return Some((i, c_node));
                        }
                    }
                    None
                })
                .collect();

            for (i, c_node) in updates {
                self.agents[i].home_house_id = None;
                self.agents[i].home_camp_node = c_node;
            }
            for hid in &collapsed_house_ids {
                self.last_event = Some(format!("🏚️ 房屋 #{} 因自然风化耐久耗尽归零，彻底坍塌消逝！", hid));
            }
            self.houses.retain(|h| h.durability > 0.0);
        }

        // 2. 死亡族人伴侣解除婚姻 (重归单身/丧偶)
        for i in 0..self.agents.len() {
            if !self.agents[i].is_alive {
                if let Some(sp_id) = self.agents[i].spouse_id {
                    self.agents[i].spouse_id = None;
                    if let Some(partner) = self.agents.iter_mut().find(|a| a.id == sp_id) {
                        partner.spouse_id = None;
                    }
                }
            }
        }

        // 3. 房屋劳作修缮机制 (耐久度<85%时，族人消耗体力进行修缮)
        for house in &mut self.houses {
            house.is_repairing = false;
            if house.durability < 85.0 && !house.is_ruin {
                let owner_id = house.owner_id;
                let spouse_id = house.spouse_id;
                for agent in &mut self.agents {
                    if agent.is_alive && (agent.id == owner_id || spouse_id == Some(agent.id)) {
                        if agent.state == PrimitiveActionState::RestingAtCamp && agent.stamina >= 35.0 {
                            agent.state = PrimitiveActionState::RepairingHouse;
                        }
                        if agent.state == PrimitiveActionState::RepairingHouse {
                            house.is_repairing = true;
                            house.repair(8.0 * dt);
                            if house.durability >= 100.0 {
                                agent.state = PrimitiveActionState::RestingAtCamp;
                                self.last_event = Some(format!("🔧 部落民 #{} 劳作修缮了 #{} 号房屋，耐久度已恢复至 100%！", agent.id, house.id));
                            }
                        }
                    }
                }
            } else {
                for agent in &mut self.agents {
                    if agent.state == PrimitiveActionState::RepairingHouse && agent.home_house_id == Some(house.id) {
                        agent.state = PrimitiveActionState::RestingAtCamp;
                    }
                }
            }
        }

        // 4. 施工与多级房屋升级推进 (填满后投入劳力升级，奖励是储备空间增加)
        let mut upgraded_houses = Vec::new();
        for agent in &mut self.agents {
            if !agent.is_alive {
                continue;
            }

            if agent.state == PrimitiveActionState::ConstructingHouse {
                agent.build_timer += dt;
                let required_time = 30.0;
                if agent.build_timer >= required_time {
                    agent.build_timer = 0.0;
                    agent.state = PrimitiveActionState::RestingAtCamp;
                    if let Some(hid) = agent.home_house_id {
                        upgraded_houses.push((agent.id, hid));
                    }
                }
            }
        }

        // 5. 升级竣工、扩容储量与激活生育/成婚
        for (owner_id, house_id) in upgraded_houses {
            if let Some(house) = self.houses.iter_mut().find(|h| h.id == house_id) {
                let prev_tier = house.tier;
                let success = house.upgrade_to_next_tier();
                if success {
                    let door_node = house.door_node_id;

                    if prev_tier == HouseTier::Tier0Warehouse {
                        // 0级升级为1级茅草房：自动迎娶单身女性并激活生育
                        let single_female_id = self.agents.iter()
                            .find(|a| a.is_alive && a.gender == Gender::Female && a.age >= 120.0 && a.spouse_id.is_none())
                            .map(|a| a.id);

                        if let Some(female_id) = single_female_id {
                            if let Some(husband) = self.agents.iter_mut().find(|a| a.id == owner_id) {
                                husband.spouse_id = Some(female_id);
                            }
                            if let Some(wife) = self.agents.iter_mut().find(|a| a.id == female_id) {
                                wife.spouse_id = Some(owner_id);
                                wife.home_house_id = Some(house_id);
                                wife.home_camp_node = door_node;
                            }
                            house.spouse_id = Some(female_id);
                            self.last_event = Some(format!("🎉 0级仓库满水粮并升级为 1级茅草房！迎娶女性 #{} ♀ 结为夫妻，激活生育，升级私宅需木材20单位！", female_id));
                        } else {
                            self.last_event = Some(format!("🎉 0级仓库升级为 1级茅草房！正式激活生育功能，仓储扩容至 20 单位，升级私宅需木材！"));
                        }
                    } else if prev_tier == HouseTier::Tier1ThatchedHut {
                        self.last_event = Some(format!("🏡 1级茅草房消耗木材完成升级！第 #{} 号房屋晋升为 2级私宅，水粮木石扩容至 40 单位！升级庄舍需储备石头！", house_id));
                    } else if prev_tier == HouseTier::Tier2LeanTo {
                        self.last_event = Some(format!("🏛️ 2级私宅消耗石料完成升级！第 #{} 号房屋晋升为 3级木石庄舍，仓储扩容至 80 单位！", house_id));
                    } else {
                        self.last_event = Some(format!("🏰 终极大庄园竣工！第 #{} 号房屋晋升为 4级氏族大庄园，仓储扩容至 150 单位！", house_id));
                    }
                }
            }
        }

        // 6. 检查房屋是否已备齐升级材料，若备齐且有主人在家休息，自动启动升级
        for house in &mut self.houses {
            if house.is_pantry_full() && house.tier != HouseTier::Tier4Manor {
                if let Some(owner) = self.agents.iter_mut().find(|a| a.id == house.owner_id && a.is_alive && a.state == PrimitiveActionState::RestingAtCamp) {
                    owner.state = PrimitiveActionState::ConstructingHouse;
                    owner.build_timer = 0.0;
                }
            }
        }

        // 7. 自发选址设立 0级仓库 (男性 ♂ 年满 120s 成年饱暖即可立项，无需前期劳力，默认 5 水 5 粮 5 木)
        if self.tick_counter % 30 == 0 {
            for i in 0..self.agents.len() {
                let agent = &self.agents[i];
                let is_already_owner = self.houses.iter().any(|h| h.owner_id == agent.id);
                if !agent.is_alive || agent.gender != Gender::Male || is_already_owner || agent.state != PrimitiveActionState::RestingAtCamp {
                    continue;
                }

                // 仓库设立门槛：男性 ♂、年满 120s 成年、饱暖富足(≥18.0单位)、体力≥75%
                if agent.age >= 120.0 && agent.hunger >= 18.0 && agent.thirst >= 18.0 && agent.stamina >= 75.0 && self.rng.gen_bool(0.15) {
                    let agent_id = agent.id;
                    let agent_pos = agent.world_pos;

                    // 空间选址：在当前营地附近 15m~45m 平坦区设立 0级仓库
                    let angle = self.rng.gen_range(0.0, std::f32::consts::TAU);
                    let dist = self.rng.gen_range(16.0, 42.0);
                    let cand_x = agent_pos.x + angle.cos() * dist;
                    let cand_y = agent_pos.y + angle.sin() * dist;
                    let cand_z = self.terrain.sample_elevation(cand_x, cand_y);

                    // 确保不与其他房屋重叠 (间距 ≥ 14m)
                    let cand_pos = Vec3::new(cand_x, cand_y, cand_z);
                    let mut is_valid = true;
                    for h in &self.houses {
                        if h.pos.distance_to(&cand_pos) < 14.0 {
                            is_valid = false;
                            break;
                        }
                    }

                    if is_valid {
                        let house_id = self.next_house_id;
                        self.next_house_id += 1;

                        // 先找出全图已有的最近节点（按距离排序）
                        let mut sorted_nearby_nodes: Vec<(NodeId, f32)> = self.network.graph.node_weights()
                            .map(|n| (n.id, n.pos.distance_to(&cand_pos)))
                            .collect();
                        sorted_nearby_nodes.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());

                        // 门前生成道路节点并与最近的 3 个路网节点双向连通
                        let door_node = self.network.add_node(cand_pos, NodeType::GroundIntersection);
                        for &(near_id, _) in sorted_nearby_nodes.iter().take(3) {
                            let _ = self.network.add_lane_with_options(door_node, near_id, None, RoadClass::DirtTrack, false, 1.0);
                            let _ = self.network.add_lane_with_options(near_id, door_node, None, RoadClass::DirtTrack, false, 1.0);
                        }

                        // 生成 0级仓库 (默认 5 水 5 粮 5 木，无需劳动力投入)
                        let house = House::new(house_id, agent_id, cand_pos, door_node, HouseTier::Tier0Warehouse);
                        self.houses.push(house);

                        let agent_mut = &mut self.agents[i];
                        agent_mut.home_house_id = Some(house_id);
                        agent_mut.home_camp_node = door_node;
                        agent_mut.world_pos = cand_pos;
                        self.last_event = Some(format!("📦 部落民 #{} ♂ 选址建立了第 #{} 号 0级仓库 (初始自带5水5粮5木)，开始搬运备货！", agent_id, house_id));
                        break;
                    }
                }
            }
        }

        // 8. 代际继承与无房族人转让处理
        for house in &mut self.houses {
            let owner_alive = self.agents.iter().any(|a| a.id == house.owner_id && a.is_alive);
            if !owner_alive && !house.is_ruin {
                let former_owner_id = house.owner_id;
                // 第一顺位：寻找原户主在世且无房的直系后代
                let descendant_heir = self.agents.iter_mut()
                    .filter(|a| a.is_alive && a.home_house_id.is_none() && (a.mother_id == Some(former_owner_id) || a.father_id == Some(former_owner_id)))
                    .max_by(|a, b| a.age.partial_cmp(&b.age).unwrap_or(std::cmp::Ordering::Equal));

                if let Some(heir) = descendant_heir {
                    house.owner_id = heir.id;
                    house.generation += 1;
                    heir.home_house_id = Some(house.id);
                    heir.home_camp_node = house.door_node_id;
                    self.last_event = Some(format!("📜 直系血脉继承: #{} 号宅舍由后代族人 Agent #{} 继承确权 (第{}代)！", house.id, heir.id, house.generation));
                } else {
                    // 第二顺位：若无后代或后代均已有房，转让给任意在世无房族人
                    let fallback_heir = self.agents.iter_mut()
                        .filter(|a| a.is_alive && a.home_house_id.is_none())
                        .max_by(|a, b| a.age.partial_cmp(&b.age).unwrap_or(std::cmp::Ordering::Equal));

                    if let Some(heir) = fallback_heir {
                        house.owner_id = heir.id;
                        house.generation += 1;
                        heir.home_house_id = Some(house.id);
                        heir.home_camp_node = house.door_node_id;
                        self.last_event = Some(format!("🤝 氏族互助转让: #{} 号宅舍原户主无无房后代，转让给无房族人 Agent #{} (第{}任)！", house.id, heir.id, house.generation));
                    } else {
                        // 全族均已有房或无人能接管，沦为废墟
                        house.is_ruin = true;
                        self.last_event = Some(format!("🏚️ 悲鸣: #{} 号宅舍因户主故去且全族均已有房，成为无主废墟！", house.id));
                    }
                }
            }
        }
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
            });
        }

        let mut houses = Vec::new();
        for h in &self.houses {
            houses.push(HouseSnapshot {
                id: h.id,
                owner_id: h.owner_id,
                spouse_id: h.spouse_id,
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
                is_fertility_active: h.is_fertility_active(),
                is_pantry_full: h.is_pantry_full(),
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
                carried_gold: agent.carried_gold,
                build_timer: agent.build_timer,
                miscarriage_alert_timer: agent.miscarriage_alert_timer,
                state: format!("{:?}", agent.state),
                is_alive: agent.is_alive,
                hunger: agent.hunger,
                thirst: agent.thirst,
                stamina: agent.stamina,
                is_pregnant: agent.is_pregnant,
                pregnancy_progress: agent.pregnancy_progress,
                miscarriage_cooldown: agent.miscarriage_cooldown_timer,
                is_offroad: agent.is_traveling_offroad,
                miscarriage_alert: agent.miscarriage_alert_timer > 0.0,
                death_decay_timer: agent.death_decay_timer,
                death_cause: agent.death_cause.clone(),
                is_covert: agent.is_covert,
                stealth_visibility: agent.stealth_visibility,
                home_house_id: agent.home_house_id,
                spouse_id: agent.spouse_id,
                mother_id: agent.mother_id,
                father_id: agent.father_id,
                children_ids: agent.children_ids.clone(),
            });
        }

        let season_str = match self.current_season {
            Season::Spring => "Spring",
            Season::Summer => "Summer",
            Season::Autumn => "Autumn",
            Season::Winter => "Winter",
        };
        let season_progress = (self.season_timer % 60.0) / 60.0;

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
            total_miscarriages: self.total_miscarriages,
            season: season_str.to_string(),
            temperature: self.temperature,
            season_progress,
            last_mutation_event: self.last_event.clone(),
        }
    }
}
