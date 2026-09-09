//! seed.rs · 世界重置与生态播撒的步骤编排。
//!
//! `seed_primitive_ecology()` 是**世界重置唯一入口**（详见 `spatial/AGENTS.md` §4.5），
//! 本文件只做「清空 → 按固定顺序调用播撒步骤 → 收尾」，具体落位逻辑在 `spawn.rs`、
//! 始祖生成在 `founder.rs`。
//!
//! ⚠️ 步骤顺序即 RNG 消费顺序与路网构建顺序，**不得重排**。

use super::super::graph::LaneGraph3D;
use super::super::world::World3DEngine;
use super::spawn::SeedLayout;

impl World3DEngine {
    /// 构建生态：营地5处(无限)、水泉6处、食物6处、木材3处、石料2处、金矿1处与全图直连动线
    pub fn seed_primitive_ecology(&mut self, _agent_count: usize) {
        self.reset_world_state();

        let mut layout = SeedLayout::default();

        // 1~6.5 POI 播撒：固定类型顺序（营地→泉→果→木→石→金→榷场互市），RNG 消费顺序不可变
        self.spawn_camp_pois(&mut layout);
        self.spawn_water_pois(&mut layout);
        self.spawn_berry_pois(&mut layout);
        self.spawn_wood_pois(&mut layout);
        self.spawn_stone_pois(&mut layout);
        self.spawn_gold_pois(&mut layout);
        self.spawn_market_pois(&mut layout);
        // 7. 地形过渡节点
        self.spawn_terrain_transition_nodes(&mut layout);
        // 8. 全图路网连接
        self.prepare_terrain_layout();
        self.connect_terrain_world(&layout.all_node_ids);
        // 9. 播撒初始 20 名原始小人 (10男10女)
        self.spawn_founders(&layout);
        // 始祖制度登记：家户 / 宗族 / 地区 / 帝国
        self.register_founder_institutions();

        self.finalize_seed();
    }

    /// 世界重置：清空**所有**与 agents 相关的状态。
    ///
    /// 遗漏任何一项会导致重置后残留旧状态（如"重置后族人仍显示旧家户"），
    /// 清单见 `spatial/AGENTS.md` §4.5。
    fn reset_world_state(&mut self) {
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
        // ★ M5 帝国登记簿同步清空；营地生成后按配置确定性分组
        self.empire_registry.clear();
        self.last_royal_payout_tick = 0;
        self.last_imperial_payout_tick = 0;
        self.relief_cooldown.clear();
        // ★ v1.8.7 死亡/流产墓碑同步清空（世界重置不留旧死亡记录）
        self.recent_deaths.clear();
    }

    /// 播撒收尾：事件文案、agent 索引重建、脏标记与全源静态最短路矩阵预计算。
    fn finalize_seed(&mut self) {
        self.last_event = Some(
            "🏕️ 生态初始：20 位始祖族人（10男10女）成家配对，踏路筑室，社会演化开启！".to_string(),
        );
        // 初始化索引，使 agent_by_id 在本次 tick 后立即可用
        self.rebuild_agent_index();
        self.regions_arrival_dirty = true;
        self.terrain_dirty.set(true);
        // ★ M3 预计算全源静态拓扑最短路矩阵
        self.network.init_static_apsp(&self.config);
    }
}
