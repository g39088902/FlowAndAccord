use super::agent::{Agent3D, AgentId, Gender};
use super::graph::NodeId;
use super::world::World3DEngine;

/// 用于在出生结算中暂存父/母方的遗传数据，避免重复搜索
struct ParentSnapshot {
    pregnancy_father_id: Option<AgentId>,
    /// ★ 受孕时预分配的胎儿 ID（分娩复用）
    pregnancy_child_id: Option<AgentId>,
    spouse_id: Option<AgentId>,
    home_house_id: Option<u32>,
    generation: u32,
    intelligence: f32,
    strength: f32,
    digestion_efficiency: f32,
    libido: f32,
    sleep_efficiency: f32,
    life_expectancy: f32,
    surname: String,
}

impl ParentSnapshot {
    fn from_agent(a: &Agent3D) -> Self {
        Self {
            pregnancy_father_id: a.pregnancy_father_id,
            pregnancy_child_id: a.pregnancy_child_id,
            spouse_id: a.spouse_id,
            home_house_id: a.home_house_id,
            generation: a.generation,
            intelligence: a.intelligence,
            strength: a.strength,
            digestion_efficiency: a.digestion_efficiency,
            libido: a.libido,
            sleep_efficiency: a.sleep_efficiency,
            life_expectancy: a.life_expectancy,
            surname: a.surname.clone(),
        }
    }
}

impl World3DEngine {
    /// 结算所有待产母亲：生成新生儿、继承遗传特征、注册亲子关系，并维护 agent_index。
    ///
    /// 调用方（ecology.rs）负责在收集 newborn_mothers 列表后调用本方法；
    /// 本方法内部在每次 push 后进行增量索引更新，调用方无需再次 rebuild。
    pub fn resolve_newborns(&mut self, newborn_mothers: Vec<(AgentId, NodeId)>) {
        for (mother_id, camp_node) in newborn_mothers {
            // ── 1. 一次性 clone 母亲快照（O(1) 查找） ──────────────────────────
            let mother_snap = match self.agent_by_id(mother_id) {
                Some(m) => ParentSnapshot::from_agent(m),
                None => continue, // 母亲意外缺失，跳过
            };

            let father_id: Option<AgentId> =
                mother_snap.pregnancy_father_id.or(mother_snap.spouse_id);

            // ── 2. 一次性 clone 父亲快照（O(1) 查找，可能无父） ─────────────────
            let father_snap: Option<ParentSnapshot> =
                father_id.and_then(|fid| self.agent_by_id(fid).map(ParentSnapshot::from_agent));

            // ── 3. 确定出生节点 ────────────────────────────────────────────────
            let family_house_id = mother_snap.home_house_id.or_else(|| {
                father_snap.as_ref().and_then(|f| f.home_house_id)
            });
            let birth_node = if let Some(hid) = family_house_id {
                self.houses
                    .iter()
                    .find(|h| h.id == hid)
                    .map(|h| h.door_node_id)
                    .unwrap_or(camp_node)
            } else {
                camp_node
            };

            // ── 4. 基础属性（★ 复用受孕时预分配的 ID：分家/继承需稳定胎儿身份） ──
            let baby_id = mother_snap.pregnancy_child_id.unwrap_or_else(|| {
                let id = self.next_agent_id;
                self.next_agent_id += 1;
                id
            });
            self.total_births += 1;

            let baby_gender = if self.rng.gen_bool(0.5) {
                Gender::Female
            } else {
                Gender::Male
            };
            let gender_str = if baby_gender == Gender::Female {
                "女婴 ♀"
            } else {
                "男婴 ♂"
            };

            let mut baby = Agent3D::new_with_config(
                baby_id, birth_node, self.config.agent_spawn_base_speed, false, 0.0, baby_gender, &self.config,
            );
            // 记录婴儿出生时刻 (当前世界 tick 数), 供前端族谱按出生时序施加纵向重力
            baby.birth_tick = self.tick_counter;
            // ★ M4 新生儿到达时刻=出生时 tick_counter
            baby.arrival_tick = self.tick_counter;
            let camp_pos = self.network.graph[*self.network.node_map.get(&birth_node).unwrap()].pos;
            baby.world_pos = camp_pos;
            baby.hunger = self.config.agent_newborn_hunger;
            baby.thirst = self.config.agent_newborn_thirst;
            baby.stamina = self.config.agent_newborn_stamina;
            baby.mother_id = Some(mother_id);
            baby.father_id = father_id;

            // ── 5. 世代与遗传特征继承（含随机变异） ───────────────────────────
            let m_gen = mother_snap.generation;
            let f_gen = father_snap.as_ref().map(|f| f.generation).unwrap_or(1);
            baby.generation = m_gen.max(f_gen) + 1;

            let delta = self.config.trait_mutation_delta;
            let fs = father_snap.as_ref().unwrap_or(&mother_snap);
            let rng = &mut self.rng;
            let mut inherit = |mv: f32, fv: f32| -> f32 {
                ((mv + fv) * 0.5 + rng.gen_range(-delta, delta)).clamp(10.0, 190.0)
            };
            baby.intelligence         = inherit(mother_snap.intelligence,         fs.intelligence);
            baby.strength             = inherit(mother_snap.strength,             fs.strength);
            baby.digestion_efficiency = inherit(mother_snap.digestion_efficiency, fs.digestion_efficiency);
            baby.libido               = inherit(mother_snap.libido,               fs.libido);
            baby.sleep_efficiency     = inherit(mother_snap.sleep_efficiency,     fs.sleep_efficiency);
            baby.life_expectancy      = inherit(mother_snap.life_expectancy,      fs.life_expectancy);
            baby.health = baby.life_expectancy;
            baby.max_health = baby.life_expectancy;

            // ── 6. 姓氏继承（优先随父姓） ─────────────────────────────────────
            let baby_surname = father_snap
                .as_ref()
                .map(|f| f.surname.clone())
                .unwrap_or_else(|| mother_snap.surname.clone());
            baby.surname = baby_surname.clone();

            // ── 7. 注册亲子关系（O(1) 可变查找）
            // ★ M1.7 胎儿已在受孕时加入父母 children_ids，此处仅在缺失时补录，避免重复
            if let Some(mother) = self.agent_by_id_mut(mother_id) {
                if !mother.children_ids.contains(&baby_id) {
                    mother.children_ids.push(baby_id);
                }
                // ★ M6 威望·子嗣因子：平安诞下活产儿，母亲威望 +1（子女日后死亡不回减）
                mother.prestige = mother.prestige.saturating_add(1);
                mother.pregnancy_father_id = None;
                mother.pregnancy_child_id = None; // 胎儿 ID 已由新生儿实体继承
            }
            if let Some(fid) = father_id {
                if let Some(father) = self.agent_by_id_mut(fid) {
                    if !father.children_ids.contains(&baby_id) {
                        father.children_ids.push(baby_id);
                    }
                    // ★ M6 威望·子嗣因子：父亲威望 +1
                    father.prestige = father.prestige.saturating_add(1);
                }
            }

            // ★ v1.9.0 提前缓存新生儿性别（baby 在步骤 8 被 move，入族需在 move 后读取）
            let baby_gender = baby.gender;

            // ── 8. 新生儿实体落位：受孕时已建胎儿 agent → 原位替换为新生儿；否则新建 ──
            if let Some(fetus_idx) = self.agent_index.get(&baby_id).copied() {
                // ★ M1.7 胎儿可能已通过金币继承携带随身黄金（father/mother 亡故清算），
                // 出生时原位替换会丢弃胎儿实体字段，须先转移随身黄金给新生儿。
                baby.carried_gold += self.agents[fetus_idx].carried_gold;
                // 胎儿 agent 已在 agents 中（受孕即建）：用完整初始化的新生儿实体原位替换。
                // 原位替换不改变其他 agent 下标，agent_index 条目（id→idx）保持有效。
                self.agents[fetus_idx] = baby;
            } else {
                let new_idx = self.agents.len();
                self.agents.push(baby);
                self.agent_index.insert(baby_id, new_idx);
            }

            // ── 8.5 M2 新生儿入父亲家户（家庭跟着男人走：未成年子女归父亲家户）──
            if let Some(fid) = father_id {
                let tick = self.tick_counter;
                // 父亲若无家户则先为父亲立户（罕见边界：父亲未婚但有子）
                if self.household_registry.household_of(fid).is_none() {
                    self.household_registry.create(fid, None, tick);
                }
                if let Some(father_hid) = self.household_registry.household_of(fid) {
                    self.household_registry.add_member(father_hid, baby_id, tick);
                }
                // ★ M3 新生儿随父姓入宗族（v1.9.0 传性别：父姓宗族已存在，故不受纯女性不立宗门禁影响）
                self.clan_registry.add_member(&baby_surname, baby_id, tick, baby_gender);
                // ★ M4 新生儿入父亲所在地区
                if let Some(father_camp) = self.region_registry.region_of(fid) {
                    self.region_registry.add_member(father_camp, baby_id, tick, self.tick_counter);
                }
            }

            // ── 9. 记录出生事件 ───────────────────────────────────────────────
            let parents_str = if let Some(fid) = father_id {
                format!("母亲 #{} 与 父亲 #{}", mother_id, fid)
            } else {
                format!("母亲 #{}", mother_id)
            };
            // 注意：baby.generation 已在上方赋值，此处安全读取
            let baby_gen = m_gen.max(f_gen) + 1;
            self.last_event = Some(format!(
                "🍼 {} 顺利产下一名健康的{} (【{}】氏 Agent #{}，第{}代，幼年0s，入驻家庭私宅，需成长{:.0}s)！",
                parents_str, gender_str, baby_surname, baby_id, baby_gen,
                self.config.agent_adult_age
            ));
        }
    }
}
