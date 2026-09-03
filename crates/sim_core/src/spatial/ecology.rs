use crate::rng::WorldRng;
use super::vec3::Vec3;
use super::graph::{LaneGraph3D, NodeType, RoadClass};
use super::agent::{Agent3D, Gender, PrimitiveActionState, COMMON_SURNAMES};
use super::poi::{PrimitivePoi, PoiType};
use super::ledger::journal::{LedgerRef, ResourceKind, TransferReason, TransferRecord};
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
        self.relief_cooldown.clear();
        // ★ v1.8.7 死亡/流产墓碑同步清空（世界重置不留旧死亡记录）
        self.recent_deaths.clear();

        let mut camp_nodes = Vec::new();
        let mut water_nodes = Vec::new();
        let mut food_nodes = Vec::new();
        let mut wood_nodes = Vec::new();
        let mut stone_nodes = Vec::new();
        let mut gold_nodes = Vec::new();
        let mut all_node_ids = Vec::new();
        // ★ v1.9.0 普通道路节点（非 POI 的地形过渡节点，作为开局小人生成位）
        let mut road_nodes = Vec::new();

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
            road_nodes.push(node_id);
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
        // ★ v1.9.0 出生地 = 随机的普通道路节点（不能是 POI；营地/水/粮/木/石/金节点均为 POI 节点）
        let total_initial = self.config.agent_spawn_count;
        let female_count = total_initial / 2;
        for i in 0..total_initial {
            // 出生地为随机普通道路节点（RNG 确定性顺序：每名始祖消耗 1 次；无道路节点时回退营地节点）
            let spawn_node = if road_nodes.is_empty() {
                camp_nodes[i % camp_nodes.len()]
            } else {
                road_nodes[self.rng.gen_range_usize(0, road_nodes.len())]
            };
            let spawn_pos = self.network.graph[*self.network.node_map.get(&spawn_node).unwrap()].pos;
            // home_camp = 离出生地最近的营地（保证 home_camp_node 与地区归属一致）
            let home_camp = camp_nodes.iter()
                .min_by(|a, b| {
                    let pa = self.network.graph[*self.network.node_map.get(a).unwrap()].pos;
                    let pb = self.network.graph[*self.network.node_map.get(b).unwrap()].pos;
                    pa.distance_to(&spawn_pos).partial_cmp(&pb.distance_to(&spawn_pos)).unwrap()
                })
                .copied()
                .unwrap_or(camp_nodes[0]);
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
            agent.world_pos = spawn_pos;

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

        // ★ M3 始祖入族（v1.9.1 宗族与女性无关）：仅男性始祖入族（按姓氏自动建宗）
        for agent in self.agents.iter().filter(|a| a.is_alive && a.gender == Gender::Male) {
            self.clan_registry.add_member(&agent.surname, agent.id, 0, agent.gender);
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
            // ★ 胎儿跳过 POI 交互：无地图实体、无携带装卸/进食饮水
            if agent.is_fetus {
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
                    // ★ M6 终态：家户账本 = 家庭物资唯一真相源。
                    // 行囊按速率卸入「家户账本」（Deposit: Personal → Family）；
                    // 吃喝从家户账本真实扣减（Consume: Family → Void）。
                    // 房屋 pantry 已删除：无容量上限、无房屋等级/0 级门槛，凡有家户即享家庭储备。
                    if let Some(hh_hid) = self.household_registry.household_of(agent.id) {
                        let tick = self.tick_counter;
                        let deposit_rate = unload_res * dt;
                        // —— 卸货入账：水 ——
                        if agent.carried_water > 0.01 {
                            let d = agent.carried_water.min(deposit_rate);
                            agent.carried_water -= d;
                            if d > 0.001 {
                                if let Some(hh) = self.household_registry.get_mut(hh_hid) {
                                    hh.group.ledger.credit(ResourceKind::Water, d);
                                    hh.group.ledger.push_transfer(TransferRecord { tick, from: LedgerRef::Personal(agent.id), to: LedgerRef::Family(hh_hid), resource: ResourceKind::Water, amount: d, reason: TransferReason::Deposit });
                                }
                            }
                        }
                        // —— 卸货入账：粮 ——
                        if agent.carried_food > 0.01 {
                            let d = agent.carried_food.min(deposit_rate);
                            agent.carried_food -= d;
                            if d > 0.001 {
                                if let Some(hh) = self.household_registry.get_mut(hh_hid) {
                                    hh.group.ledger.credit(ResourceKind::Food, d);
                                    hh.group.ledger.push_transfer(TransferRecord { tick, from: LedgerRef::Personal(agent.id), to: LedgerRef::Family(hh_hid), resource: ResourceKind::Food, amount: d, reason: TransferReason::Deposit });
                                }
                            }
                        }
                        // —— 卸货入账：木 ——
                        if agent.carried_wood > 0.01 {
                            let d = agent.carried_wood.min(deposit_rate);
                            agent.carried_wood -= d;
                            if d > 0.001 {
                                if let Some(hh) = self.household_registry.get_mut(hh_hid) {
                                    hh.group.ledger.credit(ResourceKind::Wood, d);
                                    hh.group.ledger.push_transfer(TransferRecord { tick, from: LedgerRef::Personal(agent.id), to: LedgerRef::Family(hh_hid), resource: ResourceKind::Wood, amount: d, reason: TransferReason::Deposit });
                                }
                            }
                        }
                        // —— 卸货入账：石 ——
                        if agent.carried_stone > 0.01 {
                            let d = agent.carried_stone.min(deposit_rate);
                            agent.carried_stone -= d;
                            if d > 0.001 {
                                if let Some(hh) = self.household_registry.get_mut(hh_hid) {
                                    hh.group.ledger.credit(ResourceKind::Stone, d);
                                    hh.group.ledger.push_transfer(TransferRecord { tick, from: LedgerRef::Personal(agent.id), to: LedgerRef::Family(hh_hid), resource: ResourceKind::Stone, amount: d, reason: TransferReason::Deposit });
                                }
                            }
                        }
                        // —— 卸货入账：金 ——
                        if agent.carried_gold > 0.01 {
                            let deposit = agent.carried_gold.min(unload_gold * dt);
                            agent.carried_gold = (agent.carried_gold - deposit).max(0.0);
                            if deposit > 0.001 {
                                if let Some(hh) = self.household_registry.get_mut(hh_hid) {
                                    hh.group.ledger.credit(ResourceKind::Gold, deposit);
                                    hh.group.ledger.push_transfer(TransferRecord { tick, from: LedgerRef::Personal(agent.id), to: LedgerRef::Family(hh_hid), resource: ResourceKind::Gold, amount: deposit, reason: TransferReason::Deposit });
                                }
                            }
                        }
                        // —— 吃喝：从家户账本真实扣减 ——
                        let ledger_water = self.household_registry.get(hh_hid).map(|hh| hh.group.ledger.balance(ResourceKind::Water)).unwrap_or(0.0);
                        if agent.thirst < self.config.agent_thirst_capacity && ledger_water > 0.05 {
                            let drink_amount = (self.config.agent_thirst_capacity - agent.thirst).min(ledger_water).min(self.config.camp_home_consume_rate * dt);
                            agent.thirst = (agent.thirst + drink_amount).min(self.config.agent_thirst_capacity);
                            if drink_amount > 0.001 {
                                if let Some(hh) = self.household_registry.get_mut(hh_hid) {
                                    hh.group.ledger.record_consumption(LedgerRef::Family(hh_hid), ResourceKind::Water, drink_amount, TransferReason::Consume, tick);
                                }
                            }
                        }
                        let ledger_food = self.household_registry.get(hh_hid).map(|hh| hh.group.ledger.balance(ResourceKind::Food)).unwrap_or(0.0);
                        if agent.hunger < self.config.agent_hunger_capacity && ledger_food > 0.05 {
                            let eat_amount = (self.config.agent_hunger_capacity - agent.hunger).min(ledger_food).min(self.config.camp_home_consume_rate * dt);
                            agent.hunger = (agent.hunger + eat_amount).min(self.config.agent_hunger_capacity);
                            if eat_amount > 0.001 {
                                if let Some(hh) = self.household_registry.get_mut(hh_hid) {
                                    hh.group.ledger.record_consumption(LedgerRef::Family(hh_hid), ResourceKind::Food, eat_amount, TransferReason::Consume, tick);
                                }
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

