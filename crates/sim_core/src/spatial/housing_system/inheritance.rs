use crate::spatial::agent::Gender;
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// 父系代际房产确权继承机制与绝嗣废墟演化
    pub(crate) fn tick_patrilineal_inheritance(&mut self) {
        for h_idx in 0..self.houses.len() {
            let (house_id, owner_id, door_node, is_ruin) = {
                let h = &self.houses[h_idx];
                (h.id, h.owner_id, h.door_node_id, h.is_ruin)
            };
            let owner_alive = self.agents.iter().any(|a| a.id == owner_id && a.is_alive);
            if !owner_alive && !is_ruin {
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
    }
}
