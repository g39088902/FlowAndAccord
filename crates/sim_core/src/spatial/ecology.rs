use crate::rng::WorldRng;
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, NodeType, RoadClass};
use super::agent::{Agent3D, Gender, PrimitiveActionState};
use super::poi::{PrimitivePoi, PoiType};
use super::world::World3DEngine;

impl World3DEngine {
    /// 构建生态：营地6处(无限)、水泉6处(上限60,产速2.0)、食物6处(上限60,产速2.0)、木材4处、石料2处、金矿1处与全图直连动线
    pub fn seed_primitive_ecology(&mut self, _agent_count: usize) {
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

        // 4. 生成 4 处茂密林木 (上限 60.0 单位，产速 2.00 单位/秒，保持间距)
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

        // 8. 全图任意点直连路网 (近距离 100% 速度，远距离直连越野 50% 速度)
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

        // 9. 播撒初始 12 名原始小人 (6男6女成家配对，年龄在 0.0 ~ 240.0s 之间随机离散化)
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
                            let extracted = poi.extract(3.0 * dt);
                            agent.carried_gold += extracted;

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
            baby.hunger = 25.0;
            baby.thirst = 25.0;
            baby.stamina = 100.0;
            baby.mother_id = Some(mother_id);
            baby.father_id = father_id;
            baby.home_house_id = family_house_id;

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
}
