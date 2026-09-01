use crate::spatial::agent::Gender;
use crate::spatial::house::HouseTier;
use crate::spatial::ledger::MarriageEndReason;
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// 死亡族人伴侣解除婚姻，并重置丧偶女性至就近营地
    pub(crate) fn tick_bereavement_unmarry(&mut self) {
        let mut unmarry_list = Vec::new();
        for i in 0..self.agents.len() {
            if !self.agents[i].is_alive {
                if let Some(sp_id) = self.agents[i].spouse_id {
                    let deceased_id = self.agents[i].id;
                    let deceased_gender = self.agents[i].gender;
                    self.agents[i].spouse_id = None;
                    unmarry_list.push((deceased_id, sp_id, deceased_gender));
                }
            }
        }
        for (deceased_id, sp_id, deceased_gender) in unmarry_list {
            // ★ 丧偶：婚姻登记簿封账归档（真实来源为登记簿，spouse_id 为缓存）
            let tick = self.current_tick();
            if let Some(mid) = self.marriage_registry.active_marriage_of(deceased_id) {
                self.marriage_registry.close(mid, MarriageEndReason::Bereaved, tick);
            }
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
    }

    /// 自动成婚与单身/丧偶女性改嫁机制 (需满足私宅>=1级、非孕期、成年单身)
    pub(crate) fn tick_marriage_and_remarriage(&mut self) {
        for h_idx in 0..self.houses.len() {
            let (can_marry, house_id, owner_id, owner_pos, door_node) = {
                let h = &self.houses[h_idx];
                (!h.is_ruin && h.tier != HouseTier::Tier0Warehouse && h.spouse_id.is_none(), h.id, h.owner_id, h.pos, h.door_node_id)
            };
            if can_marry {
                let owner_eligible = self.agents.iter().any(|a| {
                    a.id == owner_id && a.is_alive && a.gender == Gender::Male && a.age >= self.config.agent_adult_age && a.spouse_id.is_none()
                });

                if owner_eligible {
                    let candidate_female_id = self.agents.iter()
                        .filter(|a| a.is_alive && a.gender == Gender::Female && a.age >= self.config.agent_adult_age && a.spouse_id.is_none() && !a.is_pregnant)
                        .min_by(|a, b| {
                            let dist_a = a.world_pos.distance_to(&owner_pos);
                            let dist_b = b.world_pos.distance_to(&owner_pos);
                            dist_a.partial_cmp(&dist_b).unwrap_or(std::cmp::Ordering::Equal)
                        })
                        .map(|a| a.id);

                    if let Some(female_id) = candidate_female_id {
                        // ★ 先登记婚姻（登记簿单点校验存续唯一性；失败则不结婚，保证婚姻/家户/房屋三系统一致）
                        let tick = self.current_tick();
                        let Some(_marriage_id) = self.marriage_registry.register(owner_id, female_id, tick) else {
                            continue;
                        };
                        // ★ 女方转入夫家家户（家庭跟着男人走：家庭账本与成员归属均在户主家户下）
                        if let Some(hid) = self.household_registry.household_of(owner_id) {
                            self.household_registry.transfer_member(female_id, hid, tick);
                        }
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
    }
}
