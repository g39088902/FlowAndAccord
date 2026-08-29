use crate::rng::WorldRng;
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
