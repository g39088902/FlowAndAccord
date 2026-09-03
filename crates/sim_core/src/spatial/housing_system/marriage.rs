use crate::spatial::agent::Gender;
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

    /// 自动成婚与单身/丧偶女性改嫁机制
    /// ★ M6 去房屋化：不再以房屋为锚（原要求私宅>=1级、非废墟、无配偶）。改为遍历存续家户的
    /// 男性户主（成年单身）就近配对；无房家户亦可成婚。女方随夫入家户；男方若有房则同步登记住所。
    /// 确定性：家户按 hid 升序遍历、同距取先遇者（agents Vec 序）。
    pub(crate) fn tick_marriage_and_remarriage(&mut self) {
        let heads: Vec<(u64, u32)> = self.household_registry.households.iter()
            .filter(|(_, hh)| !hh.is_dissolved)
            .map(|(hid, hh)| (*hid, hh.head))
            .collect();

        for (hid, owner_id) in heads {
            // 户主当前资格（每轮按最新状态过滤，避免同 tick 一妻多配）
            let owner_eligible = self.agent_by_id(owner_id).map(|a| {
                a.is_alive && a.gender == Gender::Male && a.age >= self.config.agent_adult_age && a.spouse_id.is_none()
            }).unwrap_or(false);
            if !owner_eligible {
                continue;
            }
            let Some(owner_pos) = self.agent_by_id(owner_id).map(|a| a.world_pos) else { continue; };

            let candidate_female_id = self.agents.iter()
                .filter(|a| a.is_alive && a.gender == Gender::Female && a.age >= self.config.agent_adult_age && a.spouse_id.is_none() && !a.is_pregnant)
                .min_by(|a, b| {
                    let dist_a = a.world_pos.distance_to(&owner_pos);
                    let dist_b = b.world_pos.distance_to(&owner_pos);
                    dist_a.partial_cmp(&dist_b).unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|a| a.id);

            if let Some(female_id) = candidate_female_id {
                // ★ 先登记婚姻（登记簿单点校验存续唯一性；失败则不结婚）
                let tick = self.tick_counter;
                let Some(_marriage_id) = self.marriage_registry.register(owner_id, female_id, tick) else {
                    continue;
                };
                // ★ 女方转入夫家家户（家庭跟着男人走：家庭账本与成员归属均在户主家户下）
                self.household_registry.transfer_member(female_id, hid, tick);
                if let Some(husband) = self.agents.iter_mut().find(|a| a.id == owner_id) {
                    husband.spouse_id = Some(female_id);
                }
                let is_remarriage = if let Some(wife) = self.agents.iter_mut().find(|a| a.id == female_id) {
                    wife.spouse_id = Some(owner_id);
                    // 男方有房则夫妇同住并登记房屋配偶；无房则随家户（婚后由 FoundHome 立宅）
                    if let Some(house) = self.houses.iter_mut().find(|h| h.owner_id == Some(owner_id)) {
                        wife.home_house_id = Some(house.id);
                        wife.home_camp_node = house.door_node_id;
                        house.spouse_id = Some(female_id);
                    }
                    !wife.children_ids.is_empty()
                } else {
                    false
                };
                if is_remarriage {
                    self.last_event = Some(format!("💍 族人改嫁成家: 女性 #{} ♀ 改嫁家户户主 #{} ♂（入家户 #{}）！", female_id, owner_id, hid));
                } else {
                    self.last_event = Some(format!("💍 族人喜结连理: 单身女性 #{} ♀ 与家户户主 #{} ♂ 结为夫妻（入家户 #{}）！", female_id, owner_id, hid));
                }
            }
        }
    }
}
