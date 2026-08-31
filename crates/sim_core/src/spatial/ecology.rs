use crate::rng::WorldRng;
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, NodeType, RoadClass};
use super::agent::{Agent3D, Gender, PrimitiveActionState, COMMON_SURNAMES};
use super::poi::{PrimitivePoi, PoiType};
use super::house::HouseTier;
use super::world::World3DEngine;

impl World3DEngine {
    /// 构建生态：营地5处(无限)、水泉6处、食物6处、木材3处、石料2处、金矿1处与全图直连动线
    pub fn seed_primitive_ecology(&mut self, _agent_count: usize) {
        let half_size = self.terrain.world_size / 2.0;

        self.pois.clear();
        self.network = LaneGraph3D::new();
        self.agents.clear();
        self.total_births = 0;
        self.total_deaths = 0;
        self.total_deaths_natural = 0;
        self.total_deaths_unnatural = 0;
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
        let min_poi_distance = self.config.poi_min_distance;

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

        // 1. 生成避风营地
        let mut available_names = crate::spatial::poi::COUNTY_NAMES.to_vec();
        for i in 0..self.config.count_camps {
            let mut pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.70);
            pos.z += 0.5;
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            camp_nodes.push(node_id);
            all_node_ids.push(node_id);

            let name_idx = (self.rng.gen_range(0.0, available_names.len() as f32) as usize).min(available_names.len().saturating_sub(1));
            let chosen_name = available_names.swap_remove(name_idx).to_string();

            self.pois.push(PrimitivePoi::new_with_name((i + 1) as u32, PoiType::Camp, pos, chosen_name));
        }

        // 2. 生成清泉水源
        for i in 0..self.config.count_water_sources {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            water_nodes.push(node_id);
            all_node_ids.push(node_id);

            let mut poi = PrimitivePoi::new_with_name((i + 10) as u32, PoiType::WaterSource, pos, format!("低洼清泉 #{}", i + 1));
            poi.max_stock = self.config.stock_max_water;
            poi.current_stock = self.config.stock_max_water * 0.75;
            poi.regen_rate = self.config.regen_base_water;
            self.pois.push(poi);
        }

        // 3. 生成浆果灌木
        for i in 0..self.config.count_berry_bushes {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            food_nodes.push(node_id);
            all_node_ids.push(node_id);

            let mut poi = PrimitivePoi::new_with_name((i + 20) as u32, PoiType::BerryBush, pos, format!("缓坡浆果 #{}", i + 1));
            poi.max_stock = self.config.stock_max_berry;
            poi.current_stock = self.config.stock_max_berry * 0.75;
            poi.regen_rate = self.config.regen_base_berry;
            self.pois.push(poi);
        }

        // 4. 生成林木林地
        for i in 0..self.config.count_woods {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            wood_nodes.push(node_id);
            all_node_ids.push(node_id);

            let mut poi = PrimitivePoi::new_with_name((i + 30) as u32, PoiType::WoodForest, pos, format!("茂密林木 #{}", i + 1));
            poi.max_stock = self.config.stock_max_wood;
            poi.current_stock = self.config.stock_max_wood * 0.75;
            poi.regen_rate = self.config.regen_base_wood;
            self.pois.push(poi);
        }

        // 5. 生成石矿采石场
        for i in 0..self.config.count_stone_mines {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            stone_nodes.push(node_id);
            all_node_ids.push(node_id);

            let mut poi = PrimitivePoi::new_with_name((i + 40) as u32, PoiType::StoneQuarry, pos, format!("嶙峋采石场 #{}", i + 1));
            poi.max_stock = self.config.stock_max_stone;
            poi.current_stock = self.config.stock_max_stone * 0.75;
            poi.regen_rate = self.config.regen_base_stone;
            self.pois.push(poi);
        }

        // 6. 生成璀璨金矿
        for i in 0..self.config.count_gold_mines {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            gold_nodes.push(node_id);
            all_node_ids.push(node_id);

            let mut poi = PrimitivePoi::new_with_name((i + 50) as u32, PoiType::GoldMine, pos, "璀璨金矿 #1".to_string());
            poi.max_stock = self.config.stock_max_gold;
            poi.current_stock = self.config.stock_max_gold * 0.75;
            poi.regen_rate = self.config.regen_base_gold;
            self.pois.push(poi);
        }

        // 7. 地形过渡节点
        for _ in 0..17 {
            let x = self.rng.gen_range(-half_size * 0.85, half_size * 0.85);
            let y = self.rng.gen_range(-half_size * 0.85, half_size * 0.85);
            let elev = self.terrain.sample_elevation(x, y);
            let node_id = self.network.add_node(Vec3::new(x, y, elev), NodeType::GroundIntersection);
            all_node_ids.push(node_id);
        }

        // 8. 全图路网连接
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
                } else if dist < 320.0 {
                    let _ = self.network.add_lane(id_a, id_b, None, RoadClass::DirtTrack);
                    let _ = self.network.add_lane(id_b, id_a, None, RoadClass::DirtTrack);
                }
            }
        }

        // 9. 播撒初始 20 名原始小人 (10男10女)
        let total_initial = 20;
        let female_count = total_initial / 2;
        for i in 0..total_initial {
            let home_camp = camp_nodes[i % camp_nodes.len()];
            let is_covert = i % 4 == 0;
            let agent_id = self.next_agent_id;
            self.next_agent_id += 1;
            let gender = if i < female_count { Gender::Female } else { Gender::Male };
            let initial_age = self.config.agent_adult_age;

            let mut agent = Agent3D::new_with_config(agent_id, home_camp, 8.5 + (i as f32 % 3.0), is_covert, initial_age, gender, &self.config);
            let camp_pos = self.network.graph[*self.network.node_map.get(&home_camp).unwrap()].pos;
            agent.world_pos = camp_pos;

            let hunger_jitter = self.rng.gen_range(-10.0, 10.0);
            let thirst_jitter = self.rng.gen_range(-10.0, 10.0);
            let stamina_jitter = self.rng.gen_range(-10.0, 10.0);
            agent.hunger = (25.0 + hunger_jitter).clamp(10.0, 45.0);
            agent.thirst = (25.0 + thirst_jitter).clamp(10.0, 45.0);
            agent.stamina = (90.0 + stamina_jitter).clamp(55.0, 100.0);

            let mean = self.config.trait_default_mean;
            let std_dev = self.config.trait_initial_std_dev;
            let roll_trait = |rng: &mut WorldRng| -> f32 { (mean + std_dev * rng.gen_normal()).clamp(10.0, 190.0) };
            agent.intelligence = roll_trait(&mut self.rng);
            agent.strength = roll_trait(&mut self.rng);
            agent.digestion_efficiency = roll_trait(&mut self.rng);
            agent.libido = roll_trait(&mut self.rng);
            agent.sleep_efficiency = roll_trait(&mut self.rng);
            agent.life_expectancy = roll_trait(&mut self.rng);
            agent.max_health = agent.life_expectancy;
            agent.health = (agent.life_expectancy - initial_age * self.config.agent_health_decay_per_sec).max(10.0);

            let surname_idx = self.rng.gen_range(0.0, COMMON_SURNAMES.len() as f32) as usize;
            let surname_idx = surname_idx.min(COMMON_SURNAMES.len() - 1);
            agent.surname = COMMON_SURNAMES[surname_idx].to_string();

            self.agents.push(agent);
        }

        self.last_event = Some("🏕️ 生态初始：20 位始祖族人（10男10女）成家配对，踏路筑室，社会演化开启！".to_string());
        // 初始化索引，使 agent_by_id 在本次 tick 后立即可用
        self.rebuild_agent_index();
    }

    /// 真实有限资源交互结算与分娩
    pub fn tick_poi_interactions(&mut self, dt: f32) {
        let mut newborn_mothers = Vec::new();
        let carry_cap = self.config.carry_capacity_resource;
        let rate_res = self.config.poi_interaction_rate_resource;
        let rate_gold = self.config.poi_interaction_rate_gold;
        let unload_res = self.config.poi_unload_rate_resource;
        let unload_gold = self.config.poi_unload_rate_gold;

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
                            let extracted = poi.extract(need.min(rate_res * dt));
                            agent.thirst = (agent.thirst + extracted).min(50.0);
                        }
                        if agent_hid.is_some() && agent.carried_water < carry_cap && poi.current_stock > 0.01 {
                            let load = (carry_cap - agent.carried_water).min(rate_res * dt);
                            let extracted = poi.extract(load);
                            agent.carried_water = (agent.carried_water + extracted).min(carry_cap);
                        }
                    }
                }
                PrimitiveActionState::ForagingFood => {
                    let agent_pos = agent.world_pos;
                    let agent_hid = agent.home_house_id;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::BerryBush && p.pos.distance_to(&agent_pos) < 22.0) {
                        let need = (50.0 - agent.hunger).max(0.0);
                        if need > 0.01 {
                            let extracted = poi.extract(need.min(rate_res * dt));
                            agent.hunger = (agent.hunger + extracted).min(50.0);
                        }
                        if agent_hid.is_some() && agent.carried_food < carry_cap && poi.current_stock > 0.01 {
                            let load = (carry_cap - agent.carried_food).min(rate_res * dt);
                            let extracted = poi.extract(load);
                            agent.carried_food = (agent.carried_food + extracted).min(carry_cap);
                        }
                    }
                }
                PrimitiveActionState::GatheringWood => {
                    let agent_pos = agent.world_pos;
                    let agent_hid = agent.home_house_id;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::WoodForest && p.pos.distance_to(&agent_pos) < 22.0) {
                        if agent_hid.is_some() && agent.carried_wood < carry_cap && poi.current_stock > 0.01 {
                            let load = (carry_cap - agent.carried_wood).min(rate_res * dt);
                            let extracted = poi.extract(load);
                            agent.carried_wood = (agent.carried_wood + extracted).min(carry_cap);
                        }
                    }
                }
                PrimitiveActionState::MiningStone => {
                    let agent_pos = agent.world_pos;
                    let agent_hid = agent.home_house_id;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::StoneQuarry && p.pos.distance_to(&agent_pos) < 22.0) {
                        if agent_hid.is_some() && agent.carried_stone < carry_cap && poi.current_stock > 0.01 {
                            let load = (carry_cap - agent.carried_stone).min(rate_res * dt);
                            let extracted = poi.extract(load);
                            agent.carried_stone = (agent.carried_stone + extracted).min(carry_cap);
                        }
                    }
                }
                PrimitiveActionState::MiningGold => {
                    let agent_pos = agent.world_pos;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::GoldMine && p.pos.distance_to(&agent_pos) < 22.0) {
                        if poi.current_stock > 0.01 {
                            let extracted = poi.extract(rate_gold * dt);
                            agent.carried_gold += extracted;
                        }
                    }
                }
                PrimitiveActionState::RestingAtCamp => {
                    if let Some(hid) = agent.home_house_id {
                        if let Some(house) = self.houses.iter_mut().find(|h| h.id == hid) {
                            let deposit_rate = unload_res * dt;
                            if agent.carried_water > 0.01 && house.pantry_water < house.max_pantry_water {
                                let d = agent.carried_water.min(house.max_pantry_water - house.pantry_water).min(deposit_rate);
                                house.pantry_water += d;
                                agent.carried_water -= d;
                            }
                            if agent.carried_food > 0.01 && house.pantry_food < house.max_pantry_food {
                                let d = agent.carried_food.min(house.max_pantry_food - house.pantry_food).min(deposit_rate);
                                house.pantry_food += d;
                                agent.carried_food -= d;
                            }
                            if agent.carried_wood > 0.01 && house.pantry_wood < house.max_pantry_wood {
                                let d = agent.carried_wood.min(house.max_pantry_wood - house.pantry_wood).min(deposit_rate);
                                house.pantry_wood += d;
                                agent.carried_wood -= d;
                            }
                            if agent.carried_stone > 0.01 && house.pantry_stone < house.max_pantry_stone {
                                let d = agent.carried_stone.min(house.max_pantry_stone - house.pantry_stone).min(deposit_rate);
                                house.pantry_stone += d;
                                agent.carried_stone -= d;
                            }
                            if house.tier != HouseTier::Tier0Warehouse {
                                if agent.thirst < 50.0 && house.pantry_water > 0.05 {
                                    let drink_amount = (50.0 - agent.thirst).min(house.pantry_water).min(3.0 * dt);
                                    house.pantry_water = (house.pantry_water - drink_amount).max(0.0);
                                    agent.thirst = (agent.thirst + drink_amount).min(50.0);
                                }
                                if agent.hunger < 50.0 && house.pantry_food > 0.05 {
                                    let eat_amount = (50.0 - agent.hunger).min(house.pantry_food).min(3.0 * dt);
                                    house.pantry_food = (house.pantry_food - eat_amount).max(0.0);
                                    agent.hunger = (agent.hunger + eat_amount).min(50.0);
                                }
                            }
                            if agent.carried_gold > 0.01 && house.pantry_gold < house.max_pantry_gold {
                                let deposit = agent.carried_gold.min(house.max_pantry_gold - house.pantry_gold).min(unload_gold * dt);
                                house.pantry_gold = (house.pantry_gold + deposit).min(house.max_pantry_gold);
                                agent.carried_gold = (agent.carried_gold - deposit).max(0.0);
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        // 出生结算委托给 birth.rs（内部使用 agent_index O(1) 查找，并增量更新索引）
        self.resolve_newborns(newborn_mothers);

        // 清理已彻底消逝的尸骸，之后全量重建索引（retain 会改变所有幸存者下标）
        self.agents.retain(|a| a.is_alive || a.death_decay_timer > 0.0);
        self.rebuild_agent_index();
    }
}

