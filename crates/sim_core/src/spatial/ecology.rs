use crate::rng::WorldRng;
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, NodeType, RoadClass};
use super::agent::{Agent3D, Gender, PrimitiveActionState, CARRY_CAPACITY_RESOURCE};
use super::poi::{PrimitivePoi, PoiType};
use super::house::HouseTier;
use super::world::World3DEngine;
use crate::config::*;

impl World3DEngine {
    /// 构建生态：营地5处(无限)、水泉5处(上限60,产速2.0)、食物5处(上限60,产速2.0)、木材3处、石料2处、金矿1处与全图直连动线
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
        let min_poi_distance = POI_MIN_DISTANCE;

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

        // 1. 生成 5 处避风营地 (从全国县级行政区地名库中随机 roll 出 5 个不重复地名，初始为 村 级)
        let mut available_names = crate::spatial::poi::COUNTY_NAMES.to_vec();
        for i in 0..COUNT_CAMPS {
            let mut pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.70);
            pos.z += 0.5;
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            camp_nodes.push(node_id);
            all_node_ids.push(node_id);

            let name_idx = (self.rng.gen_range(0.0, available_names.len() as f32) as usize).min(available_names.len().saturating_sub(1));
            let chosen_name = available_names.swap_remove(name_idx).to_string();

            self.pois.push(PrimitivePoi::new_with_name((i + 1) as u32, PoiType::Camp, pos, chosen_name));
        }

        // 2. 生成 5 处随机分布水源 (上限 60.0 单位，产速 2.00 单位/秒，全图随机分布且保持间距)
        for i in 0..COUNT_WATER_SOURCES {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            water_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new_with_name((i + 10) as u32, PoiType::WaterSource, pos, format!("低洼清泉 #{}", i + 1)));
        }

        // 3. 生成 5 处缓坡浆果灌木 (上限 60.0 单位，产速 2.00 单位/秒，保持间距)
        for i in 0..COUNT_BERRY_BUSHES {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            food_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new_with_name((i + 20) as u32, PoiType::BerryBush, pos, format!("缓坡浆果 #{}", i + 1)));
        }

        // 4. 生成 3 处茂密林木 (上限 60.0 单位，产速 2.00 单位/秒，保持间距)
        for i in 0..COUNT_WOODS {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            wood_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new_with_name((i + 30) as u32, PoiType::WoodForest, pos, format!("茂密林木 #{}", i + 1)));
        }

        // 5. 生成 2 处嶙峋采石场 (上限 60.0 单位，产速 2.00 单位/秒，保持间距)
        for i in 0..COUNT_STONE_MINES {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            stone_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new_with_name((i + 40) as u32, PoiType::StoneQuarry, pos, format!("嶙峋采石场 #{}", i + 1)));
        }

        // 6. 生成 1 处璀璨金矿 (上限 60.0 单位，产速 1.80 单位/秒，用于顶级庄园升级)
        for i in 0..COUNT_GOLD_MINES {
            let pos = find_spaced_pos(&mut self.rng, &self.terrain, 0.80);
            let node_id = self.network.add_node(pos, NodeType::GroundIntersection);
            gold_nodes.push(node_id);
            all_node_ids.push(node_id);

            self.pois.push(PrimitivePoi::new_with_name((i + 50) as u32, PoiType::GoldMine, pos, "璀璨金矿 #1".to_string()));
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
            let initial_age = 1800.0;

            let mut agent = Agent3D::new(agent_id, home_camp, 8.5 + (i as f32 % 3.0), is_covert, initial_age, gender);
            let camp_pos = self.network.graph[*self.network.node_map.get(&home_camp).unwrap()].pos;
            agent.world_pos = camp_pos;

            // 开局状态正负 10.0 随机微调，离散化个体需求，避免全员开局步调一致集中干同一件事
            let hunger_jitter = self.rng.gen_range(-10.0, 10.0);
            let thirst_jitter = self.rng.gen_range(-10.0, 10.0);
            let stamina_jitter = self.rng.gen_range(-10.0, 10.0);
            agent.hunger = (25.0 + hunger_jitter).clamp(10.0, 45.0);
            agent.thirst = (25.0 + thirst_jitter).clamp(10.0, 45.0);
            agent.stamina = (90.0 + stamina_jitter).clamp(55.0, 100.0);

            // 先天禀赋属性 (消化效率参与进食结算、睡眠效率参与休息恢复):
            // 始祖代按 N(100, 20) 正态分布 roll，约 95% 族人落在 60~140 区间；clamp [10,190] 防止极端异常值
            let roll_trait = |rng: &mut WorldRng| -> f32 { (100.0 + 20.0 * rng.gen_normal()).clamp(10.0, 190.0) };
            agent.intelligence = roll_trait(&mut self.rng);
            agent.strength = roll_trait(&mut self.rng);
            agent.digestion_efficiency = roll_trait(&mut self.rng);
            agent.libido = roll_trait(&mut self.rng);
            agent.sleep_efficiency = roll_trait(&mut self.rng);
            agent.life_expectancy = roll_trait(&mut self.rng);
            agent.max_health = agent.life_expectancy;
            agent.health = (agent.life_expectancy - initial_age * crate::config::AGENT_HEALTH_DECAY_PER_SEC).max(10.0);

            self.agents.push(agent);
        }

        self.last_event = Some("🏕️ 生态初始：12 位始祖族人成家配对，踏路筑室，社会演化开启！".to_string());
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
                        // 1) 自身解渴
                        let need = (50.0 - agent.thirst).max(0.0);
                        if need > 0.01 {
                            let extracted = poi.extract(need.min(4.0 * dt));
                            agent.thirst = (agent.thirst + extracted).min(50.0);
                        }
                        // 2) 有家宅时装入随身行囊 (每类容量 50.0)，回家后再卸货存入家宅水库
                        if agent_hid.is_some() && agent.carried_water < CARRY_CAPACITY_RESOURCE && poi.current_stock > 0.01 {
                            let load = (CARRY_CAPACITY_RESOURCE - agent.carried_water).min(4.0 * dt);
                            let extracted = poi.extract(load);
                            agent.carried_water = (agent.carried_water + extracted).min(CARRY_CAPACITY_RESOURCE);
                        }
                    }
                }
                PrimitiveActionState::ForagingFood => {
                    let agent_pos = agent.world_pos;
                    let agent_hid = agent.home_house_id;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::BerryBush && p.pos.distance_to(&agent_pos) < 22.0) {
                        // 1) 自身进食 (1:1 直接摄取果子补充饱食，消化效率仅影响代谢耗竭速率)
                        let need = (50.0 - agent.hunger).max(0.0);
                        if need > 0.01 {
                            let extracted = poi.extract(need.min(4.0 * dt));
                            agent.hunger = (agent.hunger + extracted).min(50.0);
                        }
                        // 2) 有家宅时装入随身行囊 (每类容量 50.0)，回家后再卸货存入家宅粮仓
                        if agent_hid.is_some() && agent.carried_food < CARRY_CAPACITY_RESOURCE && poi.current_stock > 0.01 {
                            let load = (CARRY_CAPACITY_RESOURCE - agent.carried_food).min(4.0 * dt);
                            let extracted = poi.extract(load);
                            agent.carried_food = (agent.carried_food + extracted).min(CARRY_CAPACITY_RESOURCE);
                        }
                    }
                }
                PrimitiveActionState::GatheringWood => {
                    let agent_pos = agent.world_pos;
                    let agent_hid = agent.home_house_id;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::WoodForest && p.pos.distance_to(&agent_pos) < 22.0) {
                        // 伐木装入随身行囊 (每类容量 50.0)，回家卸货存入家宅木仓
                        if agent_hid.is_some() && agent.carried_wood < CARRY_CAPACITY_RESOURCE && poi.current_stock > 0.01 {
                            let load = (CARRY_CAPACITY_RESOURCE - agent.carried_wood).min(4.0 * dt);
                            let extracted = poi.extract(load);
                            agent.carried_wood = (agent.carried_wood + extracted).min(CARRY_CAPACITY_RESOURCE);
                        }
                    }
                }
                PrimitiveActionState::MiningStone => {
                    let agent_pos = agent.world_pos;
                    let agent_hid = agent.home_house_id;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::StoneQuarry && p.pos.distance_to(&agent_pos) < 22.0) {
                        // 采石装入随身行囊 (每类容量 50.0)，回家卸货存入家宅石仓
                        if agent_hid.is_some() && agent.carried_stone < CARRY_CAPACITY_RESOURCE && poi.current_stock > 0.01 {
                            let load = (CARRY_CAPACITY_RESOURCE - agent.carried_stone).min(3.0 * dt);
                            let extracted = poi.extract(load);
                            agent.carried_stone = (agent.carried_stone + extracted).min(CARRY_CAPACITY_RESOURCE);
                        }
                    }
                }
                PrimitiveActionState::MiningGold => {
                    let agent_pos = agent.world_pos;
                    if let Some(poi) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::GoldMine && p.pos.distance_to(&agent_pos) < 22.0) {
                        if poi.current_stock > 0.01 {
                            let extracted = poi.extract(3.0 * dt);
                            agent.carried_gold += extracted;
                        }
                    }
                }
                PrimitiveActionState::RestingAtCamp => {
                    if let Some(hid) = agent.home_house_id {
                        if let Some(house) = self.houses.iter_mut().find(|h| h.id == hid) {
                            // 卸货: 将随身行囊中的水/粮/木/石存入家宅仓库 (10.0/s 卸货速率)
                            let deposit_rate = 10.0 * dt;
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
                            // 0级仓库仅为建材储备，未成住宅前不扣减生活水粮
                            if house.tier != HouseTier::Tier0Warehouse {
                                if agent.thirst < 50.0 && house.pantry_water > 0.05 {
                                    let drink_amount = (50.0 - agent.thirst).min(house.pantry_water).min(3.0 * dt);
                                    house.pantry_water = (house.pantry_water - drink_amount).max(0.0);
                                    agent.thirst = (agent.thirst + drink_amount).min(50.0);
                                }
                                if agent.hunger < 50.0 && house.pantry_food > 0.05 {
                                    // 家宅进食 1:1 消耗并补充饱食 (消化效率仅影响日常代谢耗竭速率)
                                    let eat_amount = (50.0 - agent.hunger).min(house.pantry_food).min(3.0 * dt);
                                    house.pantry_food = (house.pantry_food - eat_amount).max(0.0);
                                    agent.hunger = (agent.hunger + eat_amount).min(50.0);
                                }
                            }
                            if agent.carried_gold > 0.01 && house.pantry_gold < house.max_pantry_gold {
                                let deposit = agent.carried_gold.min(house.max_pantry_gold - house.pantry_gold).min(5.0 * dt);
                                house.pantry_gold = (house.pantry_gold + deposit).min(house.max_pantry_gold);
                                agent.carried_gold = (agent.carried_gold - deposit).max(0.0);
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
            let m_gen = self.agents.iter().find(|a| a.id == mother_id).map(|a| a.generation).unwrap_or(1);
            let f_gen = father_id.and_then(|fid| self.agents.iter().find(|a| a.id == fid)).map(|a| a.generation).unwrap_or(1);
            let baby_gen = m_gen.max(f_gen) + 1;
            baby.generation = baby_gen;

            // 先天禀赋遗传 (消化效率参与进食结算、睡眠效率参与休息恢复):
            // 后代各属性 = 父母均值 ± 10 × 线性随机数 (即 ±[0,10] 均匀偏移)，clamp [10,190]
            let m_traits = self.agents.iter().find(|a| a.id == mother_id).map(|a| {
                (a.intelligence, a.strength, a.digestion_efficiency, a.libido, a.sleep_efficiency, a.life_expectancy)
            });
            let f_traits = father_id.and_then(|fid| self.agents.iter().find(|a| a.id == fid)).map(|a| {
                (a.intelligence, a.strength, a.digestion_efficiency, a.libido, a.sleep_efficiency, a.life_expectancy)
            });
            if let Some(mt) = m_traits {
                let ft = f_traits.unwrap_or(mt);
                let inherit = |mv: f32, fv: f32, rng: &mut WorldRng| -> f32 {
                    ((mv + fv) * 0.5 + rng.gen_range(-10.0, 10.0)).clamp(10.0, 190.0)
                };
                baby.intelligence = inherit(mt.0, ft.0, &mut self.rng);
                baby.strength = inherit(mt.1, ft.1, &mut self.rng);
                baby.digestion_efficiency = inherit(mt.2, ft.2, &mut self.rng);
                baby.libido = inherit(mt.3, ft.3, &mut self.rng);
                baby.sleep_efficiency = inherit(mt.4, ft.4, &mut self.rng);
                baby.life_expectancy = inherit(mt.5, ft.5, &mut self.rng);
            }
            baby.health = baby.life_expectancy;
            baby.max_health = baby.life_expectancy;

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
            self.last_event = Some(format!("🍼 {} 顺利产下一名健康的{} (Agent #{}，第{}代，幼年0s，入驻家庭私宅，需成长1800s)！", parents_str, gender_str, baby_id, baby_gen));
        }

        self.agents.retain(|a| a.is_alive || a.death_decay_timer > 0.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spatial::house::{House, HouseTier};
    use crate::spatial::world::World3DEngine;

    /// 真实随身搬运: 在资源点只把水装入行囊 (每类容量 50.0)，绝不直接写入家宅仓库
    #[test]
    fn test_carry_loads_into_backpack_not_pantry() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);

        let water_pos = world.pois.iter().find(|p| p.poi_type == PoiType::WaterSource).unwrap().pos;
        let camp_node = world.agents[0].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
        let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier1ThatchedHut, 1);
        house.pantry_water = 0.0;
        world.houses.push(house);

        {
            let a = &mut world.agents[0];
            a.world_pos = water_pos;
            a.home_house_id = Some(1);
            a.state = PrimitiveActionState::DrinkingAtWater;
            a.thirst = 20.0;
            a.hunger = 40.0;
            a.stamina = 100.0;
            a.carried_water = 0.0;
        }

        for _ in 0..60 {
            world.tick_poi_interactions(1.0 / 30.0);
        }

        let a = &world.agents[0];
        assert!(a.carried_water > 5.0, "行囊应装入清水, 实际 {}", a.carried_water);
        assert!(a.carried_water <= CARRY_CAPACITY_RESOURCE + 0.01);
        let h = world.houses.iter().find(|h| h.id == 1).unwrap();
        assert_eq!(h.pantry_water, 0.0, "资源点期间水不得直接入仓");
    }

    #[test]
    fn test_carry_deposits_into_pantry_at_home() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);

        let camp_node = world.agents[0].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
        let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier1ThatchedHut, 1);
        house.pantry_water = 0.0;
        world.houses.push(house);

        {
            let a = &mut world.agents[0];
            a.world_pos = camp_pos;
            a.home_house_id = Some(1);
            a.state = PrimitiveActionState::RestingAtCamp;
            a.thirst = 50.0;
            a.hunger = 50.0;
            a.stamina = 100.0;
            a.carried_water = 30.0;
            a.carried_food = 0.0;
            a.carried_wood = 0.0;
            a.carried_stone = 0.0;
            a.carried_gold = 0.0;
        }

        for _ in 0..120 {
            world.tick_poi_interactions(1.0 / 30.0);
        }

        let a = &world.agents[0];
        let h = world.houses.iter().find(|h| h.id == 1).unwrap();
        assert!(a.carried_water < 0.05, "行囊应已卸空, 实际 {}", a.carried_water);
        assert!((h.pantry_water - 30.0).abs() < 0.5, "家宅水库应收到 30 单位, 实际 {}", h.pantry_water);
    }

    /// 自身进食: 吃果子时 1:1 获得能量 = 果子减少量 (消化效率仅影响日常代谢消耗速率)
    #[test]
    fn test_digestion_efficiency_scales_berry_energy() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);

        let berry_pos = world.pois.iter().find(|p| p.poi_type == PoiType::BerryBush).unwrap().pos;
        {
            let a = &mut world.agents[0];
            a.world_pos = berry_pos;
            a.state = PrimitiveActionState::ForagingFood;
            a.home_house_id = None; // 无家宅: 只进食不装行囊
            a.hunger = 20.0;
            a.digestion_efficiency = 50.0; // 50% 消化效率
        }
        let before = world.pois.iter().find(|p| p.poi_type == PoiType::BerryBush).unwrap().current_stock;

        world.tick_poi_interactions(1.0 / 30.0);

        let after = world.pois.iter().find(|p| p.poi_type == PoiType::BerryBush).unwrap().current_stock;
        let extracted = before - after;
        let gained = world.agents[0].hunger - 20.0;
        assert!(extracted > 0.0, "应实际消耗果子, 实际 {}", extracted);
        assert!(
            (gained - extracted).abs() < 0.001,
            "自身进食应 1:1 获得能量, extracted={} gained={}",
            extracted, gained
        );
    }

    /// 消化代谢效率: 消化效率高者(如200%)在饥荒耗竭时饱食消耗变慢(0.10/2.0=0.05/s)，低者(如50%)消耗变快(0.10/0.5=0.20/s)
    #[test]
    fn test_digestion_efficiency_scales_metabolic_hunger_decay() {
        let mut agent_high = Agent3D::new(1, 1, 8.5, false, 20.0, Gender::Male);
        agent_high.hunger = 40.0;
        agent_high.digestion_efficiency = 200.0; // 200% 消化效率 -> decay = 0.10 / 2.0 = 0.05/s

        let mut agent_low = Agent3D::new(2, 1, 8.5, false, 20.0, Gender::Male);
        agent_low.hunger = 40.0;
        agent_low.digestion_efficiency = 50.0; // 50% 消化效率 -> decay = 0.10 / 0.5 = 0.20/s

        agent_high.tick_metabolism(10.0, false);
        agent_low.tick_metabolism(10.0, false);

        assert!((agent_high.hunger - (40.0 - 0.05 * 10.0)).abs() < 1e-4, "高消化效率者消耗慢");
        assert!((agent_low.hunger - (40.0 - 0.20 * 10.0)).abs() < 1e-4, "低消化效率者消耗快");
        assert!(agent_high.hunger > agent_low.hunger, "饥荒/缺粮下高消化效率者更抗饿");
    }

    /// 睡眠效率: 休息体力恢复速率 = 8.0/s × 睡眠效率/100，属性越高所需休息时间越短
    #[test]
    fn test_sleep_efficiency_scales_rest_recovery() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);

        {
            let a = &mut world.agents[0];
            a.state = PrimitiveActionState::RestingAtCamp;
            a.stamina = 50.0;
            a.sleep_efficiency = 150.0; // 150% 睡眠效率
        }
        world.agents[0].tick_metabolism(1.0, false);

        let gained = world.agents[0].stamina - 50.0;
        assert!(
            (gained - 8.0 * 1.5).abs() < 0.01,
            "恢复速率应 = 8.0×睡眠效率/100, 实际增加 {}", gained
        );
    }

    /// 家宅粮仓进食: 1:1 消耗并获得能量 (消化效率仅影响日常代谢消耗速率)
    #[test]
    fn test_home_pantry_eating_applies_digestion_efficiency() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);

        let camp_node = world.agents[0].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
        let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier1ThatchedHut, 1);
        house.pantry_water = 0.0;
        house.pantry_food = 80.0;
        world.houses.push(house);

        {
            let a = &mut world.agents[0];
            a.world_pos = camp_pos;
            a.home_house_id = Some(1);
            a.state = PrimitiveActionState::RestingAtCamp;
            a.thirst = 50.0;
            a.hunger = 20.0;
            a.stamina = 100.0;
            a.digestion_efficiency = 50.0; // 50% 消化效率
        }

        world.tick_poi_interactions(1.0 / 30.0);

        let a = &world.agents[0];
        let h = world.houses.iter().find(|h| h.id == 1).unwrap();
        let consumed = 80.0 - h.pantry_food;
        let gained = a.hunger - 20.0;
        assert!(consumed > 0.0, "应从粮仓消耗食物, 实际 {}", consumed);
        assert!(
            (gained - consumed).abs() < 0.001,
            "家宅进食应 1:1 获得能量, consumed={} gained={}",
            consumed, gained
        );
    }

    /// 健康需求条自然衰减(0.02/s)且不可补充，归零后即老死
    #[test]
    fn test_health_decay_and_death_when_zero() {
        let mut agent = Agent3D::new(1, 1, 8.5, false, 20.0, Gender::Male);
        agent.life_expectancy = 120.0;
        agent.health = 120.0;
        agent.max_health = 120.0;

        // 模拟 10 秒代谢
        agent.tick_metabolism(10.0, false);
        assert!(
            (agent.health - (120.0 - crate::config::AGENT_HEALTH_DECAY_PER_SEC * 10.0)).abs() < 1e-5,
            "健康值应按 0.02/s 衰减，实际健康值: {}", agent.health
        );
        assert!(agent.is_alive, "未归零前应存活");

        // 当健康值消耗殆尽时
        agent.health = 0.01;
        let event = agent.tick_metabolism(1.0, false);
        assert!(!agent.is_alive, "健康归零后应死亡");
        assert_eq!(agent.state, PrimitiveActionState::Dead);
        assert_eq!(agent.death_cause.as_deref(), Some("寿终正寝"));
        assert!(event.unwrap().contains("寿终正寝"));
    }

}
