use super::vec3::Vec3;
use super::graph::{NodeId, NodeType, RoadClass};
use super::agent::{Gender, PrimitiveActionState};
use super::house::{House, HouseTier};
use super::poi::PoiType;
use super::snapshot::Season;
use super::world::World3DEngine;
use crate::config::*;

impl World3DEngine {
    /// 部落定居与自发筑屋演化 (四季更迭、冬季取暖、多级营建扩容、私产确权与代际继承、自动婚姻)
    pub fn tick_housing(&mut self, dt: f32) {
        

        // 0. 四季更迭与环境温度计算 (240秒一年，每季60秒；季节以夏至/冬至为中点：夏季围绕最热、冬季围绕最冷)
        self.season_timer += dt;
        let year_length = SEASON_YEAR_LENGTH;
        let quarter_length = SEASON_QUARTER_LENGTH;
        let season_time = self.season_timer % year_length;
        // 边界前移 30 秒 (90° 相位)：夏至(60s 最热31°C)为夏季中点、冬至(180s 最冷-3°C)为冬季中点
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
        self.temperature = TEMP_BASE_MID + TEMP_AMPLITUDE * angle.sin();

        // 冬季取暖消耗：低温或冬季时房屋消耗木材取暖
        if self.current_season == Season::Winter || self.temperature < HOUSE_WINTER_COLD_TEMP {
            let wood_burn_rate = HOUSE_WINTER_WOOD_BURN_RATE * dt;
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

        // 2. 死亡族人伴侣解除婚姻 (若死者为男性户主，遗孀解除房屋绑定并回归营地等待改嫁；若死者为女性，丈夫重归单身)
        let mut unmarry_list = Vec::new();
        for i in 0..self.agents.len() {
            if !self.agents[i].is_alive {
                if let Some(sp_id) = self.agents[i].spouse_id {
                    let deceased_gender = self.agents[i].gender;
                    self.agents[i].spouse_id = None;
                    unmarry_list.push((sp_id, deceased_gender));
                }
            }
        }
        for (sp_id, deceased_gender) in unmarry_list {
            let partner_pos = self.agents.iter().find(|a| a.id == sp_id).map(|a| a.world_pos);
            if let Some(pos) = partner_pos {
                let c_node = self.find_nearest_camp_node(pos);
                if let Some(partner) = self.agents.iter_mut().find(|a| a.id == sp_id) {
                    partner.spouse_id = None;
                    if deceased_gender == Gender::Male {
                        partner.home_house_id = None;
                        partner.home_camp_node = c_node;
                    }
                }
            }
        }

        // 3. 房屋劳作修缮机制 (耐久度跌破 80% 才安排修缮, 一旦开工则一路修满至 100%)
        for house in &mut self.houses {
            house.is_repairing = false;
            if !house.is_ruin && house.durability < 100.0 {
                let owner_id = house.owner_id;
                let spouse_id = house.spouse_id;
                for agent in &mut self.agents {
                    if agent.is_alive && (agent.id == owner_id || spouse_id == Some(agent.id)) {
                        // 耐久度跌破 50% 时在家的族人（休养至体力100%）产生修缮欲望开工; 一旦开工则一路修满至 100%
                        if agent.state == PrimitiveActionState::RestingAtCamp
                            && agent.stamina >= 100.0
                            && house.durability < 50.0
                        {
                            agent.state = PrimitiveActionState::RepairingHouse;
                            agent.current_need = Some("Safety·RepairHouse".to_string());
                        }
                        if agent.state == PrimitiveActionState::RepairingHouse {
                            house.is_repairing = true;
                            house.repair(8.0 * dt);
                            if house.durability >= 100.0 {
                                agent.state = PrimitiveActionState::RestingAtCamp;
                                agent.current_need = Some("Physiological·Rest".to_string());
                                self.last_event = Some(format!("🔧 部落民 #{} 劳作修缮了 #{} 号房屋，耐久度已恢复至 100%！", agent.id, house.id));
                            }
                        }
                    }
                }
            } else {
                for agent in &mut self.agents {
                    if agent.state == PrimitiveActionState::RepairingHouse && agent.home_house_id == Some(house.id) {
                        agent.state = PrimitiveActionState::RestingAtCamp;
                        agent.current_need = Some("Physiological·Rest".to_string());
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
                    agent.current_need = Some("Physiological·Rest".to_string());
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
                        // 0级升级为1级茅草房：自动迎娶单身且未受孕女性并激活生育
                        let single_female_id = self.agents.iter()
                            .find(|a| a.is_alive && a.gender == Gender::Female && a.age >= AGENT_ADULT_AGE && a.spouse_id.is_none() && !a.is_pregnant)
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

        // 5.5 自动成婚与单身女性改嫁机制 (成年男性户主若丧偶/单身，且拥有 1 级以上私宅，可迎娶营地中的成年单身且未受孕女性)
        for h_idx in 0..self.houses.len() {
            let (can_marry, house_id, owner_id, owner_pos, door_node) = {
                let h = &self.houses[h_idx];
                (!h.is_ruin && h.tier != HouseTier::Tier0Warehouse && h.spouse_id.is_none(), h.id, h.owner_id, h.pos, h.door_node_id)
            };
            if can_marry {
                let owner_eligible = self.agents.iter().any(|a| {
                    a.id == owner_id && a.is_alive && a.gender == Gender::Male && a.age >= AGENT_ADULT_AGE && a.spouse_id.is_none()
                });

                if owner_eligible {
                    let candidate_female_id = self.agents.iter()
                        .filter(|a| a.is_alive && a.gender == Gender::Female && a.age >= AGENT_ADULT_AGE && a.spouse_id.is_none() && !a.is_pregnant)
                        .min_by(|a, b| {
                            let dist_a = a.world_pos.distance_to(&owner_pos);
                            let dist_b = b.world_pos.distance_to(&owner_pos);
                            dist_a.partial_cmp(&dist_b).unwrap_or(std::cmp::Ordering::Equal)
                        })
                        .map(|a| a.id);

                    if let Some(female_id) = candidate_female_id {
                        if let Some(husband) = self.agents.iter_mut().find(|a| a.id == owner_id) {
                            husband.spouse_id = Some(female_id);
                        }
                        let is_remarriage = if let Some(wife) = self.agents.iter_mut().find(|a| a.id == female_id) {
                            wife.spouse_id = Some(owner_id);
                            wife.home_house_id = Some(house_id);
                            wife.home_camp_node = door_node;
                            !wife.children_ids.is_empty()
                        } else {
                            false
                        };
                        self.houses[h_idx].spouse_id = Some(female_id);
                        if is_remarriage {
                            self.last_event = Some(format!("💍 族人改嫁成家: 女性 #{} ♀ 迁出营地入驻 #{} 号私宅，改嫁户主 #{} ♂！", female_id, house_id, owner_id));
                        } else {
                            self.last_event = Some(format!("💍 族人喜结连理: 单身女性 #{} ♀ 入驻 #{} 号私宅，与户主 #{} ♂ 结为夫妻！", female_id, house_id, owner_id));
                        }
                    }
                }
            }
        }

        // 6. 检查房屋是否已备齐升级材料，若备齐且有成年男性主人在家休息（体力恢复满100%），自动启动升级
        for house in &mut self.houses {
            if house.is_pantry_full() && house.tier != HouseTier::Tier4Manor {
                if let Some(owner) = self.agents.iter_mut().find(|a| a.id == house.owner_id && a.is_alive && a.gender == Gender::Male && a.age >= AGENT_ADULT_AGE && a.state == PrimitiveActionState::RestingAtCamp && a.stamina >= 100.0) {
                    owner.state = PrimitiveActionState::ConstructingHouse;
                    owner.build_timer = 0.0;
                    owner.current_need = Some(if house.tier == HouseTier::Tier0Warehouse {
                        "Belonging·BuildHouse".to_string()
                    } else {
                        "Esteem·BuildHouse".to_string()
                    });
                }
            }
        }

        // 7. 自发选址设立 0级仓库 (男性 ♂ 年满 1800s 成年饱暖即可立项，无需前期劳力，默认 5 水 5 粮 5 木)
        if self.tick_counter % 15 == 0 {
            for i in 0..self.agents.len() {
                let agent = &self.agents[i];
                let is_already_owner = self.houses.iter().any(|h| h.owner_id == agent.id && !h.is_ruin);
                if !agent.is_alive || agent.gender != Gender::Male || is_already_owner || agent.state != PrimitiveActionState::RestingAtCamp {
                    continue;
                }

                // 仓库设立门槛：男性 ♂、年满成年、饱暖(≥18.0单位)、体力已休养至 100%
                if agent.age >= AGENT_ADULT_AGE && agent.hunger >= 18.0 && agent.thirst >= 18.0 && agent.stamina >= 100.0 {
                    let agent_id = agent.id;
                    let agent_pos = agent.world_pos;

                    // 空间选址：在当前营地附近 16m~45m 平坦区设立 0级仓库 (多轮采样确保成功选址)
                    for _ in 0..12 {
                        let angle = self.rng.gen_range(0.0, std::f32::consts::TAU);
                        let dist = self.rng.gen_range(16.0, 42.0);
                        let cand_x = agent_pos.x + angle.cos() * dist;
                        let cand_y = agent_pos.y + angle.sin() * dist;
                        let cand_z = self.terrain.sample_elevation(cand_x, cand_y);

                        // 确保不与其他房屋重叠 (间距 ≥ 14m)
                        let cand_pos = Vec3::new(cand_x, cand_y, cand_z);
                        let is_valid = self.houses.iter().all(|h| h.pos.distance_to(&cand_pos) >= 14.0);

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

                            // 寻找最近的管辖营地
                            let nearest_camp = self.pois.iter()
                                .filter(|p| p.poi_type == PoiType::Camp)
                                .min_by(|a, b| a.pos.distance_to(&cand_pos).partial_cmp(&b.pos.distance_to(&cand_pos)).unwrap());
                            let camp_id = nearest_camp.map(|p| p.id).unwrap_or(1);
                            let camp_name = nearest_camp.map(|p| p.camp_title()).unwrap_or_else(|| "营地".to_string());

                            // 生成 0级仓库 (需自主运满10水10粮升级1级茅草房)
                            let house = House::new(house_id, agent_id, cand_pos, door_node, HouseTier::Tier0Warehouse, camp_id);
                            self.houses.push(house);

                            let agent_mut = &mut self.agents[i];
                            agent_mut.home_house_id = Some(house_id);
                            agent_mut.home_camp_node = door_node;
                            agent_mut.world_pos = cand_pos;
                            self.last_event = Some(format!("📦 部落民 #{} ♂ 于【{}】管辖区选址建立了第 #{} 号 0级仓库，开始搬运备货！", agent_id, camp_name, house_id));
                            break;
                        }
                    }
                }
            }
        }

        // 8. 代际继承机制 (男人故去后房屋转给其无房男性后代，只有男性可拥有私产；女性及未继承子嗣归入营地)
        for h_idx in 0..self.houses.len() {
            let (house_id, owner_id, door_node, is_ruin) = {
                let h = &self.houses[h_idx];
                (h.id, h.owner_id, h.door_node_id, h.is_ruin)
            };
            let owner_alive = self.agents.iter().any(|a| a.id == owner_id && a.is_alive);
            if !owner_alive && !is_ruin {
                // 1) 遗孀及所有女性成员（女儿）解除该房屋归属，搬回营地生活或等待改嫁
                let mut female_indices = Vec::new();
                for (i, agent) in self.agents.iter().enumerate() {
                    if agent.is_alive && agent.home_house_id == Some(house_id) && agent.gender == Gender::Female {
                        female_indices.push(i);
                    }
                }
                for idx in female_indices {
                    let pos = self.agents[idx].world_pos;
                    let c_node = self.find_nearest_camp_node(pos);
                    self.agents[idx].home_house_id = None;
                    self.agents[idx].home_camp_node = c_node;
                }

                // 2) 寻找原男户主在世且自身无房的男性直系后代 (未成年亦可接受遗产继承，多名按年长优先)
                let other_owner_ids: Vec<u32> = self.houses.iter()
                    .filter(|h| h.id != house_id && !h.is_ruin)
                    .map(|h| h.owner_id)
                    .collect();

                let candidate_heir_id = self.agents.iter()
                    .filter(|a| a.is_alive && a.gender == Gender::Male && a.father_id == Some(owner_id) && !other_owner_ids.contains(&a.id))
                    .max_by(|a, b| a.age.partial_cmp(&b.age).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|a| (a.id, a.age, a.spouse_id));

                if let Some((hid, heir_age, heir_spouse)) = candidate_heir_id {
                    self.houses[h_idx].owner_id = hid;
                    self.houses[h_idx].generation += 1;
                    self.houses[h_idx].spouse_id = heir_spouse;

                    if let Some(heir) = self.agents.iter_mut().find(|a| a.id == hid) {
                        heir.home_house_id = Some(house_id);
                        heir.home_camp_node = door_node;
                    }

                    // 其余未继承该房的在室男性子嗣解除该房屋绑定，前往营地生活
                    let mut other_son_indices = Vec::new();
                    for (i, agent) in self.agents.iter().enumerate() {
                        if agent.is_alive && agent.id != hid && agent.home_house_id == Some(house_id) {
                            other_son_indices.push(i);
                        }
                    }
                    for idx in other_son_indices {
                        let pos = self.agents[idx].world_pos;
                        let c_node = self.find_nearest_camp_node(pos);
                        self.agents[idx].home_house_id = None;
                        self.agents[idx].home_camp_node = c_node;
                    }

                    let gen = self.houses[h_idx].generation;
                    self.last_event = Some(format!("📜 父系代际继承: #{} 号宅舍由无房男性后代 Agent #{} ♂ 继承确权 (第{}代·年龄{:.0}s)！", house_id, hid, gen, heir_age));
                } else {
                    // 无无房男性后代可继承，宅舍沦为无主废墟，所有残留房客均迁出至营地
                    self.houses[h_idx].is_ruin = true;
                    self.houses[h_idx].spouse_id = None;

                    let mut remaining_indices = Vec::new();
                    for (i, agent) in self.agents.iter().enumerate() {
                        if agent.is_alive && agent.home_house_id == Some(house_id) {
                            remaining_indices.push(i);
                        }
                    }
                    for idx in remaining_indices {
                        let pos = self.agents[idx].world_pos;
                        let c_node = self.find_nearest_camp_node(pos);
                        self.agents[idx].home_house_id = None;
                        self.agents[idx].home_camp_node = c_node;
                    }
                    self.last_event = Some(format!("🏚️ 氏族绝嗣: #{} 号宅舍因户主故去且无男性后代继承，沦为无主废墟！", house_id));
                }
            }
        }

        // 9. 统计各营地绑定的有效房屋数量并执行行政区阶梯升级 (以6, 12, 18, 24间房为界限)
        for poi in &mut self.pois {
            if poi.poi_type == PoiType::Camp {
                let count = self.houses.iter().filter(|h| h.camp_id == poi.id && !h.is_ruin).count() as u32;
                if let Some(msg) = poi.update_camp_level(count) {
                    self.last_event = Some(msg);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spatial::world::World3DEngine;

    /// 修缮应一次性修满至 100% 耐久, 而非停在 85%
    #[test]
    fn test_repair_restores_durability_to_full() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);

        // 构造一栋满仓的 4 级大庄园 (无储备/升级需求, 户主会专注修缮)
        let owner_idx = 0;
        let owner_id = world.agents[owner_idx].id;
        let camp_node = world.agents[owner_idx].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;

        let mut house = House::new(1, owner_id, camp_pos, camp_node, HouseTier::Tier4Manor, 1);
        house.durability = 45.0;
        house.pantry_water = house.max_pantry_water;
        house.pantry_food = house.max_pantry_food;
        house.pantry_wood = house.max_pantry_wood;
        house.pantry_stone = house.max_pantry_stone;
        house.pantry_gold = house.max_pantry_gold;
        world.next_house_id = 2; // 预留 1 号房 id, 避免自发建屋撞号
        world.houses.push(house);

        {
            let a = &mut world.agents[owner_idx];
            a.home_house_id = Some(1);
            a.home_camp_node = camp_node;
            a.state = PrimitiveActionState::RestingAtCamp;
            a.hunger = 50.0;
            a.thirst = 50.0;
            a.stamina = 100.0;
        }

        // 步进 10 秒 (300 步 @ 1/30s): 耐久 55% (<80%) 触发修缮, 应一路修到 100%
        let mut max_dur = 0.0f32;
        for _ in 0..300 {
            world.tick(1.0 / 30.0);
            let d = world.houses.iter().find(|h| h.id == 1).unwrap().durability;
            if d > max_dur {
                max_dur = d;
            }
        }

        let repaired = world.houses.iter().find(|h| h.id == 1).unwrap();
        assert!(
            max_dur >= 99.99,
            "修缮应一次性修满至 100% 耐久, 实际峰值 {}%",
            max_dur
        );
        assert!(
            repaired.durability >= 80.0 && repaired.durability <= 100.0,
            "修缮完成后不应立即再次安排修缮, 实际 {}%",
            repaired.durability
        );
    }

    /// 耐久度高于 80% 时不应安排修缮 (避免 99% 就开始修)
    #[test]
    fn test_no_repair_until_below_50() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);

        let owner_idx = 0;
        let owner_id = world.agents[owner_idx].id;
        let camp_node = world.agents[owner_idx].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;

        let mut house = House::new(1, owner_id, camp_pos, camp_node, HouseTier::Tier4Manor, 1);
        house.durability = 75.0; // 高于 50%
        house.pantry_water = house.max_pantry_water;
        house.pantry_food = house.max_pantry_food;
        house.pantry_wood = house.max_pantry_wood;
        house.pantry_stone = house.max_pantry_stone;
        house.pantry_gold = house.max_pantry_gold;
        world.next_house_id = 2;
        world.houses.push(house);

        {
            let a = &mut world.agents[owner_idx];
            a.home_house_id = Some(1);
            a.home_camp_node = camp_node;
            a.state = PrimitiveActionState::RestingAtCamp;
            a.hunger = 50.0;
            a.thirst = 50.0;
            a.stamina = 100.0;
        }

        // 步进 200 步 (~6.7s): 耐久 75% 只会自然折旧, 不应触发修缮
        for _ in 0..200 {
            world.tick(1.0 / 30.0);
        }

        let h = world.houses.iter().find(|h| h.id == 1).unwrap();
        assert!(
            h.durability < 76.0 && h.durability > 73.0,
            "耐久度高于 50% 时不应被修缮, 实际 {}%",
            h.durability
        );
        assert!(!h.is_repairing, "耐久度高于 50% 时不应处于修缮状态");
    }

    /// 测试营地随着绑定房屋数量增加 (6, 12, 18, 24) 升级行政级别 (营地->村->乡->镇->县)
    #[test]
    fn test_camp_upgrade_tiers_by_house_count() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);

        let camp_id = 1;
        let camp_pos = world.pois.iter().find(|p| p.id == camp_id).unwrap().pos;
        let camp_node = world.agents[0].home_camp_node;

        // 构造 24 名活着的男性户主
        world.agents.clear();
        for i in 1..=24 {
            let mut a = crate::spatial::agent::Agent3D::new(i, camp_node, 10.0, false, 150.0, Gender::Male);
            a.home_house_id = Some(i);
            world.agents.push(a);
        }

        // 初始 0 间房 -> 等级 0 (营地)
        world.tick_housing(1.0 / 30.0);
        let camp = world.pois.iter().find(|p| p.id == camp_id).unwrap();
        assert_eq!(camp.level, 0);
        assert!(camp.camp_title().ends_with("营地"));

        // 绑定 6 间房 -> 等级 1 (村)
        for i in 1..=6 {
            world.houses.push(House::new(i, i as u32, camp_pos, camp_node, HouseTier::Tier1ThatchedHut, camp_id));
        }
        world.tick_housing(1.0 / 30.0);
        let camp = world.pois.iter().find(|p| p.id == camp_id).unwrap();
        assert_eq!(camp.level, 1);
        assert!(camp.camp_title().ends_with('村'));

        // 增加至 12 间房 -> 等级 2 (乡)
        for i in 7..=12 {
            world.houses.push(House::new(i, i as u32, camp_pos, camp_node, HouseTier::Tier1ThatchedHut, camp_id));
        }
        world.tick_housing(1.0 / 30.0);
        let camp = world.pois.iter().find(|p| p.id == camp_id).unwrap();
        assert_eq!(camp.level, 2);
        assert!(camp.camp_title().ends_with('乡'));

        // 增加至 18 间房 -> 等级 3 (镇)
        for i in 13..=18 {
            world.houses.push(House::new(i, i as u32, camp_pos, camp_node, HouseTier::Tier1ThatchedHut, camp_id));
        }
        world.tick_housing(1.0 / 30.0);
        let camp = world.pois.iter().find(|p| p.id == camp_id).unwrap();
        assert_eq!(camp.level, 3);
        assert!(camp.camp_title().ends_with('镇'));

        // 增加至 24 间房 -> 等级 4 (县)
        for i in 19..=24 {
            world.houses.push(House::new(i, i as u32, camp_pos, camp_node, HouseTier::Tier1ThatchedHut, camp_id));
        }
        world.tick_housing(1.0 / 30.0);
        let camp = world.pois.iter().find(|p| p.id == camp_id).unwrap();
        assert_eq!(camp.level, 4);
        assert!(camp.camp_title().ends_with('县'));
    }

    /// 测试男性户主死后: 未成年男性后代继承房屋，遗孀和女儿搬出至营地
    #[test]
    fn test_male_inheritance_by_minor_son_and_female_eviction() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);

        let father_id = 100;
        let mother_id = 101;
        let son_minor_id = 102;
        let daughter_id = 103;
        let camp_node = world.agents[0].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;

        let mut house = House::new(1, father_id, camp_pos, camp_node, HouseTier::Tier2LeanTo, 1);
        house.spouse_id = Some(mother_id);
        world.houses.push(house);

        // 构造家庭成员
        let mut father = crate::spatial::agent::Agent3D::new(father_id, camp_node, 10.0, false, 2000.0, Gender::Male);
        father.home_house_id = Some(1);
        father.spouse_id = Some(mother_id);

        let mut mother = crate::spatial::agent::Agent3D::new(mother_id, camp_node, 10.0, false, 1900.0, Gender::Female);
        mother.home_house_id = Some(1);
        mother.spouse_id = Some(father_id);

        // 未成年男婴 (30s，未满1800s)
        let mut son = crate::spatial::agent::Agent3D::new(son_minor_id, camp_node, 10.0, false, 30.0, Gender::Male);
        son.father_id = Some(father_id);
        son.mother_id = Some(mother_id);
        son.home_house_id = Some(1);

        // 女儿 (60s)
        let mut daughter = crate::spatial::agent::Agent3D::new(daughter_id, camp_node, 10.0, false, 60.0, Gender::Female);
        daughter.father_id = Some(father_id);
        daughter.mother_id = Some(mother_id);
        daughter.home_house_id = Some(1);

        world.agents = vec![father, mother, son, daughter];

        // 父亲死亡
        world.agents[0].is_alive = false;

        // 步进 housing
        world.tick_housing(1.0 / 30.0);

        // 验证: 房屋转给未成年儿子
        let h = world.houses.iter().find(|h| h.id == 1).unwrap();
        assert_eq!(h.owner_id, son_minor_id, "未成年儿子应继承房屋确权");
        assert!(!h.is_ruin, "有男性后代时不应成为废墟");

        // 验证: 儿子持有房屋所有权
        let s = world.agents.iter().find(|a| a.id == son_minor_id).unwrap();
        assert_eq!(s.home_house_id, Some(1));

        // 验证: 遗孀和女儿失去房屋所有权/居住，回归营地
        let m = world.agents.iter().find(|a| a.id == mother_id).unwrap();
        assert_eq!(m.home_house_id, None, "遗孀应解除房屋并搬出");
        assert_eq!(m.spouse_id, None, "遗孀重归单身待改嫁");

        let d = world.agents.iter().find(|a| a.id == daughter_id).unwrap();
        assert_eq!(d.home_house_id, None, "女儿应解除房屋并搬至营地");
    }

    /// 测试无男性后代时房屋变废墟，且营地中的单身/丧偶女性可改嫁其他单身男性户主
    #[test]
    fn test_remarriage_of_widow_in_camp() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);

        let dead_father_id = 100;
        let widow_id = 101;
        let bachelor_id = 102;
        let camp_node = world.agents[0].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;

        // 1 号房原属于 dead_father
        let mut house1 = House::new(1, dead_father_id, camp_pos, camp_node, HouseTier::Tier2LeanTo, 1);
        house1.spouse_id = Some(widow_id);
        world.houses.push(house1);

        // 2 号房属于单身汉 bachelor (已是 2 级房屋)
        let house2 = House::new(2, bachelor_id, camp_pos, camp_node, HouseTier::Tier2LeanTo, 1);
        world.houses.push(house2);

        let mut dead_father = crate::spatial::agent::Agent3D::new(dead_father_id, camp_node, 10.0, false, 2000.0, Gender::Male);
        dead_father.home_house_id = Some(1);
        dead_father.spouse_id = Some(widow_id);
        dead_father.is_alive = false; // 已故

        let mut widow = crate::spatial::agent::Agent3D::new(widow_id, camp_node, 10.0, false, 1900.0, Gender::Female);
        widow.home_house_id = Some(1);
        widow.spouse_id = Some(dead_father_id);
        widow.children_ids.push(999); // 曾育有子女标记

        let mut bachelor = crate::spatial::agent::Agent3D::new(bachelor_id, camp_node, 10.0, false, 1950.0, Gender::Male);
        bachelor.home_house_id = Some(2);
        bachelor.spouse_id = None;

        world.agents = vec![dead_father, widow, bachelor];

        // 步进 housing: 1 号房应因无男性后代沦为废墟，遗孀回归营地并自动改嫁给 bachelor
        world.tick_housing(1.0 / 30.0);

        let h1 = world.houses.iter().find(|h| h.id == 1).unwrap();
        assert!(h1.is_ruin, "无男嗣继承应沦为废墟");

        let h2 = world.houses.iter().find(|h| h.id == 2).unwrap();
        assert_eq!(h2.spouse_id, Some(widow_id), "2号私宅应迎娶改嫁女性");

        let w = world.agents.iter().find(|a| a.id == widow_id).unwrap();
        assert_eq!(w.home_house_id, Some(2), "改嫁女性入驻新家庭房屋");
        assert_eq!(w.spouse_id, Some(bachelor_id), "改嫁与新户主结为夫妻");
    }

    /// 测试怀孕女性丧偶后在妊娠期内绝不改嫁，生完小孩后方可改嫁，且新生儿继承真实生父 ID
    #[test]
    fn test_pregnant_woman_does_not_remarry_until_childbirth() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);

        let dead_father_id = 100;
        let pregnant_widow_id = 101;
        let bachelor_id = 102;
        let camp_node = world.agents[0].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;

        // 1 号房原属于 dead_father
        let mut house1 = House::new(1, dead_father_id, camp_pos, camp_node, HouseTier::Tier2LeanTo, 1);
        house1.spouse_id = Some(pregnant_widow_id);
        world.houses.push(house1);

        // 2 号房属于单身汉 bachelor
        let house2 = House::new(2, bachelor_id, camp_pos, camp_node, HouseTier::Tier2LeanTo, 1);
        world.houses.push(house2);

        let mut dead_father = crate::spatial::agent::Agent3D::new(dead_father_id, camp_node, 10.0, false, 2000.0, Gender::Male);
        dead_father.home_house_id = Some(1);
        dead_father.spouse_id = Some(pregnant_widow_id);
        dead_father.is_alive = false; // 已故

        let mut pregnant_widow = crate::spatial::agent::Agent3D::new(pregnant_widow_id, camp_node, 10.0, false, 1900.0, Gender::Female);
        pregnant_widow.home_house_id = Some(1);
        pregnant_widow.spouse_id = Some(dead_father_id);
        pregnant_widow.is_pregnant = true;
        pregnant_widow.pregnancy_father_id = Some(dead_father_id); // 怀有 dead_father 的孩子
        pregnant_widow.pregnancy_progress = 0.5;

        let mut bachelor = crate::spatial::agent::Agent3D::new(bachelor_id, camp_node, 10.0, false, 1950.0, Gender::Male);
        bachelor.home_house_id = Some(2);
        bachelor.spouse_id = None;

        world.agents = vec![dead_father, pregnant_widow, bachelor];

        // 1) 步进 housing: 1 号房因户主故去沦为废墟，遗孀回归营地；但因为正在怀孕，绝不能改嫁给 bachelor！
        world.tick_housing(1.0 / 30.0);

        let h2 = world.houses.iter().find(|h| h.id == 2).unwrap();
        assert_eq!(h2.spouse_id, None, "怀孕女性不可改嫁，2号房仍保持无女主人");

        let w = world.agents.iter().find(|a| a.id == pregnant_widow_id).unwrap();
        assert_eq!(w.spouse_id, None, "原丈夫去世，婚姻解绑");
        assert_eq!(w.is_pregnant, true, "保持妊娠状态");
        assert_eq!(w.pregnancy_father_id, Some(dead_father_id), "生父记录得以完整保留");

        // 2) 模拟分娩：孕期结束，触发分娩
        let mut newborn_mothers = Vec::new();
        if let Some(m) = world.agents.iter_mut().find(|a| a.id == pregnant_widow_id) {
            m.is_pregnant = false;
            m.ready_to_birth = true;
            newborn_mothers.push((pregnant_widow_id, camp_node));
        }

        // 分娩诞生新生儿 (ecology.rs 内部结算逻辑)
        let baby_id = world.next_agent_id;
        world.next_agent_id += 1;
        let father_id = world.agents.iter().find(|a| a.id == pregnant_widow_id).and_then(|m| m.pregnancy_father_id.or(m.spouse_id));
        assert_eq!(father_id, Some(dead_father_id), "新生儿应准确随已故生父姓氏/ID");

        let mut baby = crate::spatial::agent::Agent3D::new(baby_id, camp_node, 8.5, false, 0.0, Gender::Male);
        baby.mother_id = Some(pregnant_widow_id);
        baby.father_id = father_id;
        world.agents.push(baby);

        if let Some(m) = world.agents.iter_mut().find(|a| a.id == pregnant_widow_id) {
            m.children_ids.push(baby_id);
            m.pregnancy_father_id = None;
        }

        // 3) 分娩完成后，再次步进 housing：此时母亲已非怀孕状态（!is_pregnant），正式激活改嫁给 bachelor
        world.tick_housing(1.0 / 30.0);

        let h2_after = world.houses.iter().find(|h| h.id == 2).unwrap();
        assert_eq!(h2_after.spouse_id, Some(pregnant_widow_id), "分娩完成后方可正式改嫁入驻2号房");

        let w_after = world.agents.iter().find(|a| a.id == pregnant_widow_id).unwrap();
        assert_eq!(w_after.spouse_id, Some(bachelor_id), "改嫁后与新户主结为夫妻");
    }
}


