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
}
