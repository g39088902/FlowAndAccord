use crate::spatial::agent::AgentId;
use crate::spatial::poi::{PoiType, VacantHouseEntry};
use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// ★ v1.10.0 空置房屋事件驱动追踪（取代原父系代际继承与绝嗣废墟机制）
    ///
    /// 每拍扫描：若房屋仍有户主（owner_id=Some）但户主已亡故，则：
    /// 1. 收集受益人：户主所有在世子女（father_id=户主，不分性别不分是否同住）+ 目前的妻子（house.spouse_id，若在世）；
    /// 2. 受益人按 agent.id 升序去重（确定性约束）；
    /// 3. 房屋标记为无主空置（owner_id=None, spouse_id=None）；
    /// 4. 在所属营地的 vacant_houses 列表追加登记条目；
    /// 5. 播报事件。
    ///
    /// 房屋坍塌时由 tick_house_depreciation_and_collapse 从营地空置列表移除。
    /// 仅登记，房屋转让/继承逻辑留待后续迭代。
    pub(crate) fn tick_vacant_house_tracking(&mut self) {
        // 收集本拍需要转为空置的房屋索引（避免迭代中可变借用冲突）
        let mut to_vacate: Vec<usize> = Vec::new();
        for (idx, house) in self.houses.iter().enumerate() {
            let Some(owner_id) = house.owner_id else { continue };
            let owner_alive = self.agents.iter().any(|a| a.id == owner_id && a.is_alive);
            if !owner_alive {
                to_vacate.push(idx);
            }
        }
        if to_vacate.is_empty() {
            return;
        }
        for &h_idx in &to_vacate {
            let (house_id, owner_id, spouse_id, camp_id) = {
                let h = &self.houses[h_idx];
                (h.id, h.owner_id, h.spouse_id, h.camp_id)
            };
            let Some(oid) = owner_id else { continue };

            // 收集受益人
            let mut beneficiaries: Vec<AgentId> = Vec::new();
            // 目前的妻子（房屋登记的配偶，若在世）
            if let Some(wid) = spouse_id {
                if self.agents.iter().any(|a| a.id == wid && a.is_alive) {
                    beneficiaries.push(wid);
                }
            }
            // 户主所有在世子女（father_id == 户主，不分性别）
            for a in &self.agents {
                if a.is_alive && a.father_id == Some(oid) {
                    beneficiaries.push(a.id);
                }
            }
            // 去重 + 按 agent.id 升序（确定性）
            beneficiaries.sort_unstable();
            beneficiaries.dedup();

            // 标记房屋为无主空置并初始化营地中介拍卖状态
            self.houses[h_idx].owner_id = None;
            self.houses[h_idx].spouse_id = None;
            let current_dur = self.houses[h_idx].durability;
            self.houses[h_idx].auction_state = Some(crate::spatial::house::HouseAuctionState {
                start_durability: current_dur,
                benchmark_bid: 0.0,
                current_highest_bid: 0.0,
                current_highest_bidder: None,
            });

            // 登记到所属营地空置列表
            if let Some(camp) = self.pois.iter_mut().find(|p| p.poi_type == PoiType::Camp && p.id == camp_id) {
                camp.vacant_houses.push(VacantHouseEntry {
                    house_id,
                    beneficiary_ids: beneficiaries.clone(),
                });
            }

            self.last_event = Some(format!(
                "🏚️ 户主 #{} 故去，#{} 号房屋成为无主空置房，登记受益人 {} 名（子女+配偶）！",
                oid, house_id, beneficiaries.len()
            ));
        }
    }
}
