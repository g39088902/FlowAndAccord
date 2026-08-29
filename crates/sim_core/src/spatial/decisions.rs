use super::vec3::Vec3;
use super::graph::NodeId;
use super::agent::{Gender, PrimitiveActionState};
use super::poi::PoiType;
use super::house::HouseTier;
use super::world::World3DEngine;

impl World3DEngine {
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
}