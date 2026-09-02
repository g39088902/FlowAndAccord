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
        // ★ 世界重置：婚姻/家户/宗族登记簿与 agents 清空同步（账本重构 M1.7/M3）
        self.marriage_registry.clear();
        self.household_registry.clear();
        self.clan_registry.clear();
        self.mutual_aid_cooldown.clear();
        // ★ M4 地区登记簿同步清空
        self.region_registry.clear();
        self.expedition_targets.clear();
        self.relief_cooldown.clear();
        // ★ M2 旁路记账缓存同步清空
        self.prev_carried.clear();

        let mut camp_nodes = Vec::new();
        let mut water_nodes = Vec::new();
        let mut food_nodes = Vec::new();
        let mut wood_nodes = Vec::new();
        let mut stone_nodes = Vec::new();
        let mut gold_nodes = Vec::new();
        let mut all_node_ids = Vec::new();

        let mut poi_positions: Vec<Vec3> = Vec::new();
        let min_poi_distance = self.config.poi_min_distance;
        let poi_spawn_fallback_ratio = self.config.poi_spawn_fallback_ratio;

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
                if poi_positions.iter().all(|p| p.distance_to(&cand) >= min_poi_distance * poi_spawn_fallback_ratio) {
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
            let mut pos = find_spaced_pos(&mut self.rng, &self.terrain, self.config.poi_spawn_radius_camp);
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
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, self.config.poi_spawn_radius_resource);
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
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, self.config.poi_spawn_radius_resource);
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
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, self.config.poi_spawn_radius_resource);
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
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, self.config.poi_spawn_radius_resource);
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
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, self.config.poi_spawn_radius_resource);
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
        for _ in 0..self.config.count_terrain_transition_nodes {
            let x = self.rng.gen_range(-half_size * self.config.poi_spawn_spread_ratio, half_size * self.config.poi_spawn_spread_ratio);
            let y = self.rng.gen_range(-half_size * self.config.poi_spawn_spread_ratio, half_size * self.config.poi_spawn_spread_ratio);
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

                if dist < self.config.road_connect_near_dist {
                    let delta_z = (pos_a.z - pos_b.z).abs();
                    let road_class = if delta_z > self.config.road_grade_pave_threshold { RoadClass::Cobblestone } else { RoadClass::DirtTrack };
                    let _ = self.network.add_lane(id_a, id_b, None, road_class, &self.config);
                    let _ = self.network.add_lane(id_b, id_a, None, road_class, &self.config);
                } else if dist < self.config.road_connect_far_dist {
                    let _ = self.network.add_lane(id_a, id_b, None, RoadClass::DirtTrack, &self.config);
                    let _ = self.network.add_lane(id_b, id_a, None, RoadClass::DirtTrack, &self.config);
                }
            }
        }

        // 9. 播撒初始 20 名原始小人 (10男10女)
        let total_initial = self.config.agent_spawn_count;
        let female_count = total_initial / 2;
        for i in 0..total_initial {
            let home_camp = camp_nodes[i % camp_nodes.len()];
            let is_covert = i % self.config.agent_covert_every_n == 0;
            let agent_id = self.next_agent_id;
            self.next_agent_id += 1;
            let gender = if i < female_count { Gender::Female } else { Gender::Male };
            let initial_age = self.config.agent_adult_age;

            let mut agent = Agent3D::new_with_config(agent_id, home_camp, self.config.agent_spawn_base_speed, is_covert, initial_age, gender, &self.config);
            // 始祖在初始化阶段 (tick_counter=0) 出生, 显式置 0 以便族谱按出生时序排序
            agent.birth_tick = 0;
            // ★ M4 始祖到达时刻=0（同时播撒，arrival_order 按 id 升序打破并列）
            agent.arrival_tick = 0;
            let camp_pos = self.network.graph[*self.network.node_map.get(&home_camp).unwrap()].pos;
            agent.world_pos = camp_pos;

            let hunger_jitter = self.rng.gen_range(-self.config.agent_spawn_jitter, self.config.agent_spawn_jitter);
            let thirst_jitter = self.rng.gen_range(-self.config.agent_spawn_jitter, self.config.agent_spawn_jitter);
            let stamina_jitter = self.rng.gen_range(-self.config.agent_spawn_jitter, self.config.agent_spawn_jitter);
            agent.hunger = (self.config.agent_spawn_hunger_base + hunger_jitter).clamp(self.config.agent_spawn_hunger_clamp_min, self.config.agent_spawn_hunger_clamp_max);
            agent.thirst = (self.config.agent_spawn_hunger_base + thirst_jitter).clamp(self.config.agent_spawn_hunger_clamp_min, self.config.agent_spawn_hunger_clamp_max);
            agent.stamina = (self.config.agent_spawn_stamina_base + stamina_jitter).clamp(self.config.agent_spawn_stamina_clamp_min, self.config.agent_spawn_stamina_clamp_max);

            let mean = self.config.trait_default_mean;
            let std_dev = self.config.trait_initial_std_dev;
            let roll_trait = |rng: &mut WorldRng| -> f32 { (mean + std_dev * rng.gen_normal()).clamp(self.config.trait_inherit_clamp_min, self.config.trait_inherit_clamp_max) };
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

        // ★ 为每位始祖男性建家户（家庭跟着男人走；女性成婚后转入夫家，故暂不入户）
        for agent in self.agents.iter().filter(|a| a.is_alive && a.gender == Gender::Male) {
            self.household_registry.create(agent.id, None, 0);
        }

        // ★ M3 始祖入族：按姓氏自动聚合（不区分性别，同姓即同族）
        for agent in self.agents.iter().filter(|a| a.is_alive) {
            self.clan_registry.add_member(&agent.surname, agent.id, 0);
        }

        // ★ M4 始祖入地区：按最近营地 POI 归属（agent 已放置在营地节点位置）
        for agent in self.agents.iter().filter(|a| a.is_alive) {
            if let Some(camp) = self.pois.iter()
                .filter(|p| p.poi_type == crate::spatial::poi::PoiType::Camp)
                .min_by(|a, b| a.pos.distance_to(&agent.world_pos).partial_cmp(&b.pos.distance_to(&agent.world_pos)).unwrap())
            {
                self.region_registry.add_member(camp.id, agent.id, 0, 0);
            }
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
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::WaterSource && p.pos.distance_to(&agent_pos) < self.config.poi_interaction_radius) {
                        let need = (self.config.agent_thirst_capacity - agent.thirst).max(0.0);
                        if need > 0.01 {
                            let extracted = poi.extract(need.min(rate_res * dt));
                            agent.thirst = (agent.thirst + extracted).min(self.config.agent_thirst_capacity);
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
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::BerryBush && p.pos.distance_to(&agent_pos) < self.config.poi_interaction_radius) {
                        let need = (self.config.agent_hunger_capacity - agent.hunger).max(0.0);
                        if need > 0.01 {
                            let extracted = poi.extract(need.min(rate_res * dt));
                            agent.hunger = (agent.hunger + extracted).min(self.config.agent_hunger_capacity);
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
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::WoodForest && p.pos.distance_to(&agent_pos) < self.config.poi_interaction_radius) {
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
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::StoneQuarry && p.pos.distance_to(&agent_pos) < self.config.poi_interaction_radius) {
                        if agent_hid.is_some() && agent.carried_stone < carry_cap && poi.current_stock > 0.01 {
                            let load = (carry_cap - agent.carried_stone).min(rate_res * dt);
                            let extracted = poi.extract(load);
                            agent.carried_stone = (agent.carried_stone + extracted).min(carry_cap);
                        }
                    }
                }
                PrimitiveActionState::MiningGold => {
                    let agent_pos = agent.world_pos;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::GoldMine && p.pos.distance_to(&agent_pos) < self.config.poi_interaction_radius) {
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
                                if agent.thirst < self.config.agent_thirst_capacity && house.pantry_water > 0.05 {
                                    let drink_amount = (self.config.agent_thirst_capacity - agent.thirst).min(house.pantry_water).min(self.config.camp_home_consume_rate * dt);
                                    house.pantry_water = (house.pantry_water - drink_amount).max(0.0);
                                    agent.thirst = (agent.thirst + drink_amount).min(self.config.agent_thirst_capacity);
                                }
                                if agent.hunger < self.config.agent_hunger_capacity && house.pantry_food > 0.05 {
                                    let eat_amount = (self.config.agent_hunger_capacity - agent.hunger).min(house.pantry_food).min(self.config.camp_home_consume_rate * dt);
                                    house.pantry_food = (house.pantry_food - eat_amount).max(0.0);
                                    agent.hunger = (agent.hunger + eat_amount).min(self.config.agent_hunger_capacity);
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

