use super::vec3::Vec3;
use super::graph::{NodeId, NodeType, RoadClass};
use super::agent::{Gender, PrimitiveActionState};
use super::house::{House, HouseTier};
use super::snapshot::Season;
use super::world::World3DEngine;

impl World3DEngine {
    /// 部落定居与自发筑屋演化 (四季更迭、冬季取暖、多级营建扩容、私产确权与代际继承、自动婚姻)
    pub fn tick_housing(&mut self, dt: f32) {
        

        // 0. 四季更迭与环境温度计算 (240秒一年，每季60秒；季节以夏至/冬至为中点：夏季围绕最热、冬季围绕最冷)
        self.season_timer += dt;
        let year_length = 240.0;
        let season_time = self.season_timer % year_length;
        // 边界前移 30 秒 (90° 相位)：夏至(60s 最热31°C)为夏季中点、冬至(180s 最冷-3°C)为冬季中点
        let season_idx = (((season_time + 30.0) / 60.0) as usize) % 4;
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
}