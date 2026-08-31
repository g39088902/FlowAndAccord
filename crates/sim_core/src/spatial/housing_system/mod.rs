pub mod maintenance;
pub mod construction;
pub mod marriage;
pub mod settlement;
pub mod inheritance;


use crate::spatial::world::World3DEngine;

impl World3DEngine {
    /// 部落定居与自发筑屋演化总管线 (冬季取暖、多级营建扩容、私产确权与代际继承、自动婚姻)
    pub fn tick_housing(&mut self, dt: f32) {
        // 0. 冬季私宅柴火供暖消耗
        self.tick_winter_heating(dt);

        // 1. 房屋自然风化与折旧，0耐久度彻底坍塌消亡
        self.tick_house_depreciation_and_collapse(dt);

        // 2. 死亡族人伴侣解除婚姻
        self.tick_bereavement_unmarry();

        // 3. 房屋劳作修缮机制 (耐久度跌破 50% 安排修缮, 一旦开工修满至 100%)
        self.tick_house_repair(dt);

        // 4. 施工与多级房屋升级推进、5. 升级竣工与扩容储量
        self.tick_house_construction(dt);

        // 5.5 自动成婚与单身女性改嫁机制
        self.tick_marriage_and_remarriage();

        // 6. 房屋升级/自立门户的启动均由 agent 自主决策触发（BuildHouse / FoundHome 需求），系统不再扫描指挥

        // 7. 父系房产代际确权继承机制与绝嗣废墟演化
        self.tick_patrilineal_inheritance();

        // 8.5 金币遗产继承机制 (死者金币平分给在世子一代子女)
        self.settle_gold_inheritance();

        // 9. 统计各营地绑定的有效房屋数量并执行行政区阶梯升级
        self.tick_camp_administrative_upgrades();
    }
}
