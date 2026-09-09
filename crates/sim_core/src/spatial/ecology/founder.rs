//! founder.rs · 始祖 Agent 生成与制度登记。
//!
//! 播撒初始族人（默认 20 名：10 男 10 女）并为其建立家户 / 宗族 / 地区 / 帝国归属。
//!
//! ⚠️ 属性掷点顺序即 RNG 消费顺序（性别不掷、饥渴体力抖动 → 六项禀赋 → 姓氏），
//! 详见 `crates/sim_core/AGENTS.md` §5.2。

use super::super::agent::{Agent3D, Gender, COMMON_SURNAMES};
use super::super::vec3::Vec3;
use super::super::world::World3DEngine;
use super::spawn::SeedLayout;
use crate::rng::WorldRng;

impl World3DEngine {
    /// 9. 播撒初始原始小人（`config.agentSpawnCount`，默认 20 名 = 10 男 10 女）
    pub(super) fn spawn_founders(&mut self, layout: &SeedLayout) {
        // ★ v1.9.0 出生地 = 随机的普通道路节点（不能是 POI；营地/水/粮/木/石/金节点均为 POI 节点）
        // ★ v1.21.1 始祖出生地去营地化：过滤出距离所有营地 POI 均大于安全距离的普通道路节点候选集
        let total_initial = self.config.agent_spawn_count;
        let female_count = total_initial / 2;

        // 营地 POI 坐标（避让基准：严禁始祖出生在营地建筑/交互范围内）
        let camp_positions: Vec<Vec3> = self
            .pois
            .iter()
            .filter(|p| p.poi_type == crate::spatial::poi::PoiType::Camp)
            .map(|p| p.pos)
            .collect();
        // 安全出生距离 = max(交互半径, 最小 POI 间距一半)，确保与营地保持避让
        let spawn_safe_dist = self
            .config
            .poi_interaction_radius
            .max(self.config.poi_min_distance * 0.5);
        // 候选集：距离任何营地均 ≥ 安全距离的普通道路节点
        let valid_spawn_nodes: Vec<u32> = layout
            .road_nodes
            .iter()
            .copied()
            .filter(|&nid| {
                let pos = self.network.graph[*self.network.node_map.get(&nid).unwrap()].pos;
                camp_positions
                    .iter()
                    .all(|c| pos.distance_to(c) >= spawn_safe_dist)
            })
            .collect();
        // 极端回退：无远离营地的普通道路节点 → 预生成一个远离所有营地的野外交叉节点（并接入路网）
        let fallback_spawn_node: Option<u32> = if valid_spawn_nodes.is_empty() {
            Some(self.make_far_spawn_node(&camp_positions, spawn_safe_dist))
        } else {
            None
        };

        for i in 0..total_initial {
            // 出生地优先从远离营地的候选集中确定性选取（每名始祖仍消耗 1 次 RNG，保持下游随机序列）；
            // 无候选集时回退到远离营地的野外交叉节点——严禁任何始祖直接出生于营地节点或营地建筑范围内。
            let spawn_node = if !valid_spawn_nodes.is_empty() {
                valid_spawn_nodes[self.rng.gen_range_usize(0, valid_spawn_nodes.len())]
            } else {
                fallback_spawn_node.expect("valid_spawn_nodes 为空时 fallback_spawn_node 必已生成")
            };
            let spawn_pos =
                self.network.graph[*self.network.node_map.get(&spawn_node).unwrap()].pos;
            // home_camp = 离出生地最近的营地（保证 home_camp_node 与地区归属一致）
            let home_camp = layout
                .camp_nodes
                .iter()
                .min_by(|a, b| {
                    let pa = self.network.graph[*self.network.node_map.get(a).unwrap()].pos;
                    let pb = self.network.graph[*self.network.node_map.get(b).unwrap()].pos;
                    pa.distance_to(&spawn_pos)
                        .partial_cmp(&pb.distance_to(&spawn_pos))
                        .unwrap()
                })
                .copied()
                .unwrap_or(layout.camp_nodes[0]);
            let is_covert = i % self.config.agent_covert_every_n == 0;
            let agent_id = self.next_agent_id;
            self.next_agent_id += 1;
            let gender = if i < female_count {
                Gender::Female
            } else {
                Gender::Male
            };
            let initial_age = self.config.agent_adult_age;

            let mut agent = Agent3D::new_with_config(
                agent_id,
                home_camp,
                self.config.agent_spawn_base_speed,
                is_covert,
                initial_age,
                gender,
                &self.config,
            );
            // 始祖在初始化阶段 (tick_counter=0) 出生, 显式置 0 以便族谱按出生时序排序
            agent.birth_tick = 0;
            // ★ M4 始祖到达时刻=0（同时播撒，arrival_order 按 id 升序打破并列）
            agent.arrival_tick = 0;
            agent.world_pos = spawn_pos;

            let hunger_jitter = self.rng.gen_range(
                -self.config.agent_spawn_jitter,
                self.config.agent_spawn_jitter,
            );
            let thirst_jitter = self.rng.gen_range(
                -self.config.agent_spawn_jitter,
                self.config.agent_spawn_jitter,
            );
            let stamina_jitter = self.rng.gen_range(
                -self.config.agent_spawn_jitter,
                self.config.agent_spawn_jitter,
            );
            agent.hunger = (self.config.agent_spawn_hunger_base + hunger_jitter).clamp(
                self.config.agent_spawn_hunger_clamp_min,
                self.config.agent_spawn_hunger_clamp_max,
            );
            agent.thirst = (self.config.agent_spawn_hunger_base + thirst_jitter).clamp(
                self.config.agent_spawn_hunger_clamp_min,
                self.config.agent_spawn_hunger_clamp_max,
            );
            // 始祖播撒时携带满额水粮，避免出生即因补给缺口触发采集。
            agent.carried_water = self.config.carry_capacity_resource;
            agent.carried_food = self.config.carry_capacity_resource;
            agent.stamina = (self.config.agent_spawn_stamina_base + stamina_jitter).clamp(
                self.config.agent_spawn_stamina_clamp_min,
                self.config.agent_spawn_stamina_clamp_max,
            );

            let mean = self.config.trait_default_mean;
            let std_dev = self.config.trait_initial_std_dev;
            let roll_trait = |rng: &mut WorldRng| -> f32 {
                (mean + std_dev * rng.gen_normal()).clamp(
                    self.config.trait_inherit_clamp_min,
                    self.config.trait_inherit_clamp_max,
                )
            };
            agent.intelligence = roll_trait(&mut self.rng);
            agent.strength = roll_trait(&mut self.rng);
            agent.digestion_efficiency = roll_trait(&mut self.rng);
            agent.libido = roll_trait(&mut self.rng);
            agent.sleep_efficiency = roll_trait(&mut self.rng);
            agent.life_expectancy = roll_trait(&mut self.rng);
            agent.max_health = agent.life_expectancy;
            agent.health = (agent.life_expectancy
                - initial_age * self.config.agent_health_decay_per_sec)
                .max(10.0);

            let surname_idx = self.rng.gen_range(0.0, COMMON_SURNAMES.len() as f32) as usize;
            let surname_idx = surname_idx.min(COMMON_SURNAMES.len() - 1);
            agent.surname = COMMON_SURNAMES[surname_idx].to_string();

            self.agents.push(agent);
        }
    }

    /// 始祖制度登记：男性建家户 → 男性入宗族 → 全员入地区 → 营地按配置分组为帝国。
    pub(super) fn register_founder_institutions(&mut self) {
        // ★ 为每位始祖男性建家户（家庭跟着男人走；女性成婚后转入夫家，故暂不入户）
        for agent in self
            .agents
            .iter()
            .filter(|a| a.is_alive && a.gender == Gender::Male)
        {
            self.household_registry.create(agent.id, None, 0);
        }

        // ★ M3 始祖入族（v1.9.1 宗族与女性无关）：仅男性始祖入族（按姓氏自动建宗）
        for agent in self
            .agents
            .iter()
            .filter(|a| a.is_alive && a.gender == Gender::Male)
        {
            self.clan_registry
                .add_member(&agent.surname, agent.id, 0, agent.gender);
        }

        // ★ M4 始祖入地区：按最近营地 POI 归属（agent 已放置在营地节点位置）
        for agent in self.agents.iter().filter(|a| a.is_alive) {
            if let Some(camp) = self
                .pois
                .iter()
                .filter(|p| p.poi_type == crate::spatial::poi::PoiType::Camp)
                .min_by(|a, b| {
                    a.pos
                        .distance_to(&agent.world_pos)
                        .partial_cmp(&b.pos.distance_to(&agent.world_pos))
                        .unwrap()
                })
            {
                self.region_registry.add_member(camp.id, agent.id, 0, 0);
            }
        }

        let camp_ids: Vec<u32> = self
            .pois
            .iter()
            .filter(|p| p.poi_type == crate::spatial::poi::PoiType::Camp)
            .map(|p| p.id)
            .collect();
        self.empire_registry
            .ensure_structure(&camp_ids, self.config.count_empires);
    }
}
