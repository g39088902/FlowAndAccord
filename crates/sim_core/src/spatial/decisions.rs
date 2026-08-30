use super::vec3::Vec3;
use super::graph::{LaneGraph3D, NodeId};
use super::agent::{Agent3D, Gender, PrimitiveActionState, CARRY_CAPACITY_RESOURCE};
use super::poi::{PrimitivePoi, PoiType};
use super::house::{House, HouseTier};
use super::world::World3DEngine;
use crate::rng::WorldRng;
// 马斯洛需求层次生存决策状态机: ①生理 > ②安全 > ③归属 > ④尊重 > ⑤自我实现
// 核心原则:
// 1. 体力 50% 以下寻求休息，一旦开始休息必须休养至体力 100% 充盈方可结束干别的事。
// 2. 仓库填满属于安全需求，比盖房子更优先满足。
// 3. 区分盖房淘金 (StockGold, 冷却 45s) 与娱乐淘金 (GoldWealth, 4级庄园后冷却 180s)。

/// 马斯洛需求层次 (低 → 高，低层绝对优先)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum MaslowLevel {
    Physiological,      // ① 生理需求 (最高优先级·生存底线)
    Safety,             // ② 安全需求 (仓库水粮木储备填满 / 房屋修缮)
    Belonging,          // ③ 归属与爱 (0级仓库升级成婚 / 家庭纽带)
    Esteem,             // ④ 尊重需求 (建材储备 / 盖房淘金[45s] / 房屋施工升级)
    SelfActualization,  // ⑤ 自我实现 (4级大庄园竣工后的娱乐淘金[180s])
}

/// 具体需求种类 (对应可执行的动作)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NeedKind {
    QuenchThirst,   // 生理: 口渴 → 赶往水泉痛饮并带水补给家宅
    SateHunger,     // 生理: 饥饿 → 赶往浆果丛觅食并带粮补给家宅
    Rest,           // 生理: 归巢休养生息 (一旦开始休息充盈至100%)
    ReturnHome,     // 安全/归宿: 现场采收或劳作完成，折返回归私宅或营地
    RepairHouse,    // 安全: 房屋耐久<50%产生修缮需求，修缮至100%
    StockWater,     // 安全: 家宅储水 (家庭生存储备，填满水库)
    StockFood,      // 安全: 家宅储粮 (家庭生存储备，填满粮仓)
    StockWood,      // 安全: 过冬木柴 / 私宅基础木料 (填满木仓)
    BuildHouse,     // 归属/尊重: 材料备齐后施工升级房屋
    StockStone,     // 尊重: 采石建材 (庄舍/庄园升级储备)
    StockGold,      // 尊重: 为3级庄舍升级大庄园备金 (冷却 45s)
    GoldWealth,     // 自我实现: 4级大庄园竣工后的娱乐性淘金 (冷却 180s)
    ForageSurplus,  // 生理: 体力充沛时的低概率富余觅食
}

/// 一条需求判定结论
#[derive(Debug, Clone, Copy)]
struct Need {
    level: MaslowLevel,
    kind: NeedKind,
    target_state: PrimitiveActionState,
}

/// 资源节点池 (供给类型 → 节点表)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NodePool {
    Water,
    Food,
    Wood,
    Stone,
    Gold,
}

impl NodePool {
    fn nodes(self, ctx: &DecisionContext) -> &[NodeId] {
        match self {
            NodePool::Water => &ctx.water_nodes,
            NodePool::Food => &ctx.food_nodes,
            NodePool::Wood => &ctx.wood_nodes,
            NodePool::Stone => &ctx.stone_nodes,
            NodePool::Gold => &ctx.gold_nodes,
        }
    }
}

/// 决策上下文: 一次性收集全图的资源节点池与营地坐标 (供全族人共享)
struct DecisionContext {
    water_nodes: Vec<NodeId>,
    food_nodes: Vec<NodeId>,
    wood_nodes: Vec<NodeId>,
    stone_nodes: Vec<NodeId>,
    gold_nodes: Vec<NodeId>,
    camp_positions: Vec<(NodeId, Vec3)>,
    gold_depleted: bool, // 全地图黄金储量低于 20%
}

/// 家宅物资与修缮缺口 (按房屋等级与耐久度计算)
struct HouseStockNeeds {
    need_repair: bool,
    wood_target: f32,
    need_water: bool,
    need_food: bool,
    need_wood: bool,
    need_stone: bool,
    need_gold: bool,
}

/// 依据房屋等级与状态解析修缮与物资缺口:
/// 1. 耐久度低于 50.0% 产生修缮需求 (一旦开工修至 100%)；
/// 2. 把仓库填满属于安全需求: 水、粮、木基础储量低于 50% 产生生存补给欲望；
/// 3. 未达最高级大庄园前，持续储备升级所需建材 (1级备木至100%、2级备石木至100%、3级备金石木至100%)，备齐后立刻开工升级！
fn house_stock_needs(house: &House) -> HouseStockNeeds {
    let (need_water, need_food, need_wood, need_stone, need_gold) = match house.tier {
        // 0级仓库：需将水、粮全部填满至 10.0 方可升级为 1级茅草房 (有合理容差，达到 90% 即视为备齐)
        HouseTier::Tier0Warehouse => (
            house.pantry_water < (house.max_pantry_water * 0.90),
            house.pantry_food < (house.max_pantry_food * 0.90),
            false,
            false,
            false,
        ),
        // 1级茅草房：基础水粮安全线 50%，升级私宅需木材达到满仓
        HouseTier::Tier1ThatchedHut => (
            house.pantry_water < (house.max_pantry_water * 0.50),
            house.pantry_food < (house.max_pantry_food * 0.50),
            house.pantry_wood < (house.max_pantry_wood * 0.85),
            false,
            false,
        ),
        // 2级私宅：基础水粮安全线 50%，升级庄舍需木材与石料全部备齐
        HouseTier::Tier2LeanTo => (
            house.pantry_water < (house.max_pantry_water * 0.50),
            house.pantry_food < (house.max_pantry_food * 0.50),
            house.pantry_wood < (house.max_pantry_wood * 0.50),
            house.pantry_stone < (house.max_pantry_stone * 0.85),
            false,
        ),
        // 3级庄舍：基础水粮安全线 50%，升级庄园需木材、石料、黄金全部备齐
        HouseTier::Tier3Homestead => (
            house.pantry_water < (house.max_pantry_water * 0.50),
            house.pantry_food < (house.max_pantry_food * 0.50),
            house.pantry_wood < (house.max_pantry_wood * 0.50),
            house.pantry_stone < (house.max_pantry_stone * 0.85),
            house.pantry_gold < (house.max_pantry_gold * 0.85),
        ),
        // 4级大庄园：最高等级，无升级建材需求；水粮木储量低于 50% 产生补给欲望
        HouseTier::Tier4Manor => (
            house.pantry_water < (house.max_pantry_water * 0.50),
            house.pantry_food < (house.max_pantry_food * 0.50),
            house.pantry_wood < (house.max_pantry_wood * 0.50),
            false,
            false,
        ),
    };
    HouseStockNeeds {
        // 耐久度跌破 50% 产生修缮需求
        need_repair: house.durability < 50.0 && !house.is_ruin,
        wood_target: house.max_pantry_wood,
        need_water,
        need_food,
        need_wood,
        need_stone,
        need_gold,
    }
}

/// 执行中状态对应的"当前需求"标签 (层级·种类 标识符, 供前端可视化解析)
fn state_need_label_with_agent(state: PrimitiveActionState, agent: &Agent3D, houses: &[House]) -> Option<(&'static str, &'static str)> {
    Some(match state {
        PrimitiveActionState::SeekingWater | PrimitiveActionState::DrinkingAtWater => {
            if agent.thirst < 25.0 {
                ("Physiological", "QuenchThirst")
            } else {
                ("Safety", "StockWater")
            }
        }
        PrimitiveActionState::SeekingFood | PrimitiveActionState::ForagingFood => {
            if agent.hunger < 25.0 {
                ("Physiological", "SateHunger")
            } else {
                ("Safety", "StockFood")
            }
        }
        PrimitiveActionState::SeekingWood | PrimitiveActionState::GatheringWood => ("Safety", "StockWood"),
        PrimitiveActionState::SeekingStone | PrimitiveActionState::MiningStone => ("Esteem", "StockStone"),
        PrimitiveActionState::SeekingGold | PrimitiveActionState::MiningGold => {
            let is_building_stock = agent.home_house_id
                .and_then(|hid| houses.iter().find(|h| h.id == hid))
                .map(|h| h.tier == HouseTier::Tier3Homestead && h.pantry_gold < h.max_pantry_gold)
                .unwrap_or(false);
            if is_building_stock {
                ("Esteem", "StockGold")
            } else {
                ("SelfActualization", "GoldWealth")
            }
        }
        PrimitiveActionState::ReturningToCamp => {
            if agent.stamina < 50.0 {
                ("Physiological", "Rest")
            } else {
                ("Safety", "ReturnHome")
            }
        }
        PrimitiveActionState::RepairingHouse => ("Safety", "RepairHouse"),
        PrimitiveActionState::ConstructingHouse => {
            let is_tier0 = agent.home_house_id
                .and_then(|hid| houses.iter().find(|h| h.id == hid))
                .map(|h| h.tier == HouseTier::Tier0Warehouse)
                .unwrap_or(false);
            if is_tier0 {
                ("Belonging", "BuildHouse")
            } else {
                ("Esteem", "BuildHouse")
            }
        }
        PrimitiveActionState::OffRoadDetour => ("Safety", "Detour"),
        _ => return None,
    })
}

/// 单名族人的马斯洛需求决策器 (持有全部只读上下文，逐人驱动状态机)
struct Decisioner<'a> {
    ctx: &'a DecisionContext,
    network: &'a LaneGraph3D,
    houses: &'a [House],
    pois: &'a [PrimitivePoi],
    rng: &'a mut WorldRng,
}

impl<'a> Decisioner<'a> {
    // ---------- 通用工具 ----------

    fn node_pos(&self, node: NodeId) -> Vec3 {
        self.network.graph[*self.network.node_map.get(&node).unwrap()].pos
    }

    /// 节点池中距 pos 最近的节点 (完全就近原则)
    fn nearest_of(&self, pool: NodePool, pos: Vec3) -> Option<NodeId> {
        pool.nodes(self.ctx).iter().copied().min_by(|&a, &b| {
            self.node_pos(a).distance_to(&pos)
                .partial_cmp(&self.node_pos(b).distance_to(&pos))
                .unwrap()
        })
    }

    /// 出发节点: 距当前位置最近的节点 (无路网时退回营地节点)
    fn start_node(&self, agent: &Agent3D) -> NodeId {
        self.network.graph.node_weights()
            .min_by(|a, b| a.pos.distance_to(&agent.world_pos).partial_cmp(&b.pos.distance_to(&agent.world_pos)).unwrap())
            .map(|n| n.id)
            .unwrap_or(agent.home_camp_node)
    }

    /// 归属目标: 有私宅回宅门节点, 无宅回最近营地
    fn home_target(&self, agent: &Agent3D) -> NodeId {
        if agent.home_house_id.is_some() {
            agent.home_camp_node
        } else {
            self.ctx.camp_positions.iter()
                .min_by(|(_, a), (_, b)| a.distance_to(&agent.world_pos).partial_cmp(&b.distance_to(&agent.world_pos)).unwrap())
                .map(|(nid, _)| *nid)
                .unwrap_or(agent.home_camp_node)
        }
    }

    /// 派发寻路并切换行动状态 (成功出发返回 true)
    fn dispatch(&self, agent: &mut Agent3D, start: NodeId, target: NodeId, state: PrimitiveActionState) -> bool {
        if let Some(path) = self.network.find_path_3d_with_preference(start, target, agent.is_covert) {
            if !path.is_empty() {
                agent.state = state;
                agent.target_poi_node = Some(target);
                agent.route = path;
                agent.route_index = 0;
                agent.current_lane_id = Some(agent.route[0]);
                agent.distance_along_curve = 0.0;
                return true;
            }
        }
        false
    }

    /// 金字塔降级兜底: 从当前所在实际位置最近节点折返回归属地 (杜绝瞬移)
    fn return_home(&self, agent: &mut Agent3D) {
        let curr_node = self.start_node(agent);
        let target_home = self.home_target(agent);
        if curr_node == target_home {
            agent.state = PrimitiveActionState::RestingAtCamp;
            agent.current_velocity = 0.0;
            agent.current_lane_id = None;
            agent.home_camp_node = target_home;
            return;
        }
        if self.dispatch(agent, curr_node, target_home, PrimitiveActionState::ReturningToCamp) {
            agent.home_camp_node = target_home;
        } else {
            agent.state = PrimitiveActionState::ReturningToCamp;
            agent.home_camp_node = target_home;
        }
    }

    /// 现场作业 (22m内): 附近是否已彻底开采殆尽 (储量 ≤ 0.05 即采到 0%)
    fn source_empty(&self, poi_type: PoiType, pos: Vec3) -> bool {
        self.pois.iter()
            .find(|p| p.poi_type == poi_type && p.pos.distance_to(&pos) < 22.0)
            .map(|p| p.current_stock <= 0.05)
            .unwrap_or(true)
    }

    // ---------- 状态机主入口 ----------

    fn decide(&mut self, agent: &mut Agent3D) {
        if agent.state == PrimitiveActionState::RestingAtCamp {
            // 休息点 = 决策点: 由马斯洛金字塔自底向上评估当前最紧迫需求
            self.decide_resting(agent);
            return;
        }
        if agent.current_need.is_none()
            || agent.state == PrimitiveActionState::ReturningToCamp
            || agent.state == PrimitiveActionState::ConstructingHouse
            || agent.state == PrimitiveActionState::RepairingHouse
        {
            agent.current_need = state_need_label_with_agent(agent.state, agent, self.houses).map(|(l, k)| format!("{}·{}", l, k));
        }
        match agent.state {
            PrimitiveActionState::DrinkingAtWater => self.decide_drinking(agent),
            PrimitiveActionState::ForagingFood => self.decide_foraging(agent),
            PrimitiveActionState::GatheringWood => self.decide_harvest(agent, PoiType::WoodForest, self.wood_fully_stocked(agent)),
            PrimitiveActionState::MiningStone => self.decide_harvest(agent, PoiType::StoneQuarry, self.stone_fully_stocked(agent)),
            PrimitiveActionState::MiningGold => self.decide_mining_gold(agent),
            PrimitiveActionState::SeekingWood => self.decide_seeking_material(agent, NodePool::Wood),
            PrimitiveActionState::SeekingStone => self.decide_seeking_material(agent, NodePool::Stone),
            PrimitiveActionState::SeekingGold => self.decide_seeking_material(agent, NodePool::Gold),
            PrimitiveActionState::SeekingWater => self.decide_seeking_survival(agent, NodePool::Water),
            PrimitiveActionState::SeekingFood => self.decide_seeking_survival(agent, NodePool::Food),
            _ => {}
        }
    }

    // ---------- ① 休息决策: 马斯洛金字塔自底向上评估与满足 ----------

    fn decide_resting(&mut self, agent: &mut Agent3D) {
        let need = self.evaluate_resting_need(agent);
        agent.current_need = need.map(|n| format!("{:?}·{:?}", n.level, n.kind));
        if let Some(need) = need {
            self.fulfill_resting_need(agent, need);
        }
    }

    /// 金字塔扫描: 返回当前最紧迫且可满足的需求 (低层需求绝对优先于高层任务)
    fn evaluate_resting_need(&mut self, agent: &Agent3D) -> Option<Need> {
        // ① 生理需求 (最高优先级·生存底线): 口渴优先于饥饿
        let thirst_urgency = if agent.is_pregnant { 24.5 } else { 20.0 };
        let hunger_urgency = if agent.is_pregnant { 24.5 } else { 20.0 };
        if agent.thirst < thirst_urgency && !self.ctx.water_nodes.is_empty() {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::QuenchThirst, target_state: PrimitiveActionState::SeekingWater });
        }
        if agent.hunger < hunger_urgency && !self.ctx.food_nodes.is_empty() {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::SateHunger, target_state: PrimitiveActionState::SeekingFood });
        }

        // ① 生理需求【核心规则：一旦开始休息，必须休养至体力 100% 方可结束休息开展其他工作】
        if agent.stamina < 100.0 {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::Rest, target_state: PrimitiveActionState::RestingAtCamp });
        }

        // ② 安全需求 / ③ 归属需求 / ④ 尊重需求 / ⑤ 自我实现需求
        // 当体力 >= 50% 且拥有私宅 (或配偶私宅) 时:
        if let Some(house) = agent.home_house_id.and_then(|hid| self.houses.iter().find(|h| h.id == hid && !h.is_ruin)) {
            let is_house_member = house.owner_id == agent.id || house.spouse_id == Some(agent.id);
            let needs = house_stock_needs(house);

            // ② 安全需求: 房屋耐久度跌破 50% 时产生修缮需求，优先修缮至 100%
            if needs.need_repair && is_house_member {
                return Some(Need { level: MaslowLevel::Safety, kind: NeedKind::RepairHouse, target_state: PrimitiveActionState::RepairingHouse });
            }

            // ② 安全需求【核心规则2：把仓库填满属于安全需求，比盖房子更优先满足！】
            // 家庭基础生存物资补给 (水、粮、过冬木柴) 必须在盖房子与建材筹备之前优先满足！
            let female_bias = if agent.gender == Gender::Female { 0.70 } else { 0.45 };
            let family_level = if agent.spouse_id.is_some() || !agent.children_ids.is_empty() {
                MaslowLevel::Belonging
            } else {
                MaslowLevel::Safety
            };

            // 补充水粮到仓库
            if needs.need_water && !self.ctx.water_nodes.is_empty() && self.rng.gen_bool(female_bias) {
                return Some(Need { level: family_level, kind: NeedKind::StockWater, target_state: PrimitiveActionState::SeekingWater });
            }
            if needs.need_food && !self.ctx.food_nodes.is_empty() && self.rng.gen_bool(female_bias) {
                return Some(Need { level: family_level, kind: NeedKind::StockFood, target_state: PrimitiveActionState::SeekingFood });
            }
            // 补充过冬木柴 / 私宅基础木料到仓库
            if needs.need_wood && !self.ctx.wood_nodes.is_empty() {
                return Some(Need { level: family_level, kind: NeedKind::StockWood, target_state: PrimitiveActionState::SeekingWood });
            }

            // ③ 归属 / ④ 尊重: 0级仓库升茅草房 (需水粮各满10)
            if house.tier == HouseTier::Tier0Warehouse && house.is_pantry_full() && is_house_member {
                return Some(Need { level: MaslowLevel::Belonging, kind: NeedKind::BuildHouse, target_state: PrimitiveActionState::ConstructingHouse });
            }

            // ④ 尊重需求: 采石建材储备 (2级升3级庄舍、3级升4级庄园建材)
            if needs.need_stone && !self.ctx.stone_nodes.is_empty() {
                return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::StockStone, target_state: PrimitiveActionState::SeekingStone });
            }

            // ④ 尊重需求【核心规则3：为了盖房子淘金 StockGold，专属冷却 45 秒】
            // 仅当拥有 3级木石庄舍且金库缺金时出发采金，用于晋升 4级氏族大庄园
            if needs.need_gold && !self.ctx.gold_nodes.is_empty() && !self.ctx.gold_depleted && agent.gold_mining_cooldown <= 0.0 {
                return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::StockGold, target_state: PrimitiveActionState::SeekingGold });
            }

            // ④ 尊重需求: 1~3级房屋材料备齐后的施工升级 (在基础水粮木石备齐后进行)
            if house.is_pantry_full() && house.tier != HouseTier::Tier4Manor && is_house_member {
                return Some(Need { level: MaslowLevel::Esteem, kind: NeedKind::BuildHouse, target_state: PrimitiveActionState::ConstructingHouse });
            }

            // 【核心规则2：房子没修好（未升到最高等级 4级大庄园 Tier4Manor），绝对不会进行娱乐性淘金！】
            if house.tier != HouseTier::Tier4Manor
                || needs.need_repair
                || needs.need_wood
                || needs.need_stone
                || needs.need_gold
                || needs.need_water
                || needs.need_food
                || house.is_pantry_full()
            {
                return None;
            }
        } else {
            // 无私产房屋者，绝对不能去娱乐性淘金
            return None;
        }

        // ① 生理需求的低概率补充: 满足度低于50%(<25.0)且体力充沛时的富余觅食
        if agent.hunger < 25.0 && !self.ctx.food_nodes.is_empty() && self.rng.gen_bool(0.04) {
            return Some(Need { level: MaslowLevel::Physiological, kind: NeedKind::ForageSurplus, target_state: PrimitiveActionState::SeekingFood });
        }

        // ⑤ 自我实现【核心规则3：娱乐性淘金 GoldWealth，专属冷却 180 秒】:
        // 仅当 4级大庄园已竣工、温饱无虞、无建材与修缮缺口、体力充沛(>=50%)且 180s 冷却已过时，才自发娱乐性淘金！
        if !self.ctx.gold_nodes.is_empty() && !self.ctx.gold_depleted && agent.gold_mining_cooldown <= 0.0 && self.rng.gen_bool(0.40) {
            return Some(Need { level: MaslowLevel::SelfActualization, kind: NeedKind::GoldWealth, target_state: PrimitiveActionState::SeekingGold });
        }
        None
    }

    /// 将需求映射为就近资源节点并派出路线 (完全就近原则)
    fn fulfill_resting_need(&mut self, agent: &mut Agent3D, need: Need) {
        if need.kind == NeedKind::Rest {
            return;
        }
        if need.kind == NeedKind::RepairHouse {
            agent.state = PrimitiveActionState::RepairingHouse;
            return;
        }
        if need.kind == NeedKind::BuildHouse {
            agent.state = PrimitiveActionState::ConstructingHouse;
            agent.build_timer = 0.0;
            return;
        }
        // 盖房淘金冷却 45s，娱乐淘金冷却 180s
        if need.kind == NeedKind::StockGold {
            agent.gold_mining_cooldown = 45.0;
        } else if need.kind == NeedKind::GoldWealth {
            agent.gold_mining_cooldown = 180.0;
        }

        let start = self.start_node(agent);
        let target = match need.kind {
            NeedKind::QuenchThirst | NeedKind::StockWater => self.nearest_of(NodePool::Water, agent.world_pos),
            NeedKind::SateHunger | NeedKind::StockFood => self.nearest_of(NodePool::Food, agent.world_pos),
            NeedKind::StockWood => self.nearest_of(NodePool::Wood, agent.world_pos),
            NeedKind::StockStone => self.nearest_of(NodePool::Stone, agent.world_pos),
            NeedKind::StockGold | NeedKind::GoldWealth => self.nearest_of(NodePool::Gold, agent.world_pos),
            NeedKind::ForageSurplus => {
                let len = self.ctx.food_nodes.len();
                if len == 0 { return; }
                Some(self.ctx.food_nodes[self.rng.gen_range_usize(0, len)])
            }
            NeedKind::Rest | NeedKind::ReturnHome | NeedKind::RepairHouse | NeedKind::BuildHouse => None,
        };
        if let Some(target) = target {
            self.dispatch(agent, start, target, need.target_state);
        }
    }

    // ---------- 执行中状态: 完成 / 金字塔降级回退 ----------

    /// 喝水完成: 自身解渴(≥49.9)且家宅水库已满(或水源枯竭)，或随身行囊装水满载(50.0)必须返家卸货 → 若仍饥饿转觅食, 否则归巢休息
    fn decide_drinking(&mut self, agent: &mut Agent3D) {
        let can_stock = agent.home_house_id.is_some();
        let house_water_full = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_water >= (h.max_pantry_water * 0.98))
            .unwrap_or(true);
        let self_satisfied = agent.thirst >= 49.9;
        // 随身行囊装水满载 (50.0) 后必须返回家宅卸货入库
        let carry_full = can_stock && agent.carried_water >= CARRY_CAPACITY_RESOURCE;
        let finished = (self_satisfied && (!can_stock || house_water_full)) || carry_full || self.source_empty(PoiType::WaterSource, agent.world_pos);

        if finished {
            if agent.hunger < 25.0 && !self.ctx.food_nodes.is_empty() {
                let target = self.ctx.food_nodes[self.rng.gen_range_usize(0, self.ctx.food_nodes.len())];
                let curr_node = self.start_node(agent);
                agent.current_need = Some("Physiological·SateHunger".to_string());
                self.dispatch(agent, curr_node, target, PrimitiveActionState::SeekingFood);
            } else {
                agent.current_need = Some(if agent.stamina < 50.0 { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
                self.return_home(agent);
            }
        }
    }

    /// 觅食完成: 自身吃饱(≥49.9)且家宅粮仓已满(或浆果枯竭)，或随身行囊装粮满载(50.0)必须返家卸货 → 若仍口渴转饮水, 否则归巢休息
    fn decide_foraging(&mut self, agent: &mut Agent3D) {
        let can_stock = agent.home_house_id.is_some();
        let house_food_full = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_food >= (h.max_pantry_food * 0.98))
            .unwrap_or(true);
        let self_satisfied = agent.hunger >= 49.9;
        // 随身行囊装粮满载 (50.0) 后必须返回家宅卸货入库
        let carry_full = can_stock && agent.carried_food >= CARRY_CAPACITY_RESOURCE;
        let finished = (self_satisfied && (!can_stock || house_food_full)) || carry_full || self.source_empty(PoiType::BerryBush, agent.world_pos);

        if finished {
            if agent.thirst < 25.0 && !self.ctx.water_nodes.is_empty() {
                let target = self.ctx.water_nodes[self.rng.gen_range_usize(0, self.ctx.water_nodes.len())];
                let curr_node = self.start_node(agent);
                agent.current_need = Some("Physiological·QuenchThirst".to_string());
                self.dispatch(agent, curr_node, target, PrimitiveActionState::SeekingWater);
            } else {
                agent.current_need = Some(if agent.stamina < 50.0 { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
                self.return_home(agent);
            }
        }
    }

    /// 采收完成: 采石伐木等非生理需求必须严格让位于生理需求 (资源枯竭 / 家宅已满 / 行囊装满 / 生理告急[饥渴<25 或 体力<50]) → 归巢卸货
    fn decide_harvest(&mut self, agent: &mut Agent3D, poi_type: PoiType, fully_stocked: bool) {
        // 随身行囊装满对应资源 (每类 50.0) 后必须返回家宅卸货入库
        let carry_full = match poi_type {
            PoiType::WoodForest => agent.carried_wood >= CARRY_CAPACITY_RESOURCE,
            PoiType::StoneQuarry => agent.carried_stone >= CARRY_CAPACITY_RESOURCE,
            _ => false,
        };
        if self.source_empty(poi_type, agent.world_pos) || fully_stocked || carry_full || agent.hunger < 25.0 || agent.thirst < 25.0 || agent.stamina < 50.0 {
            agent.current_need = Some(if agent.stamina < 50.0 { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
            self.return_home(agent);
        }
    }

    /// 淘金持续作业: 随身收集金币 (黄金容量无限，20.0 仅为单趟运量阈值)，或金库补足或生理告急时优先送回房子
    fn decide_mining_gold(&mut self, agent: &mut Agent3D) {
        let is_building_stock = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.tier == HouseTier::Tier3Homestead && h.pantry_gold < h.max_pantry_gold)
            .unwrap_or(false);
        let gold_load_full = agent.carried_gold >= 20.0;
        let house_gold_full = agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_gold >= (h.max_pantry_gold * 0.98))
            .unwrap_or(false);

        if gold_load_full
            || (is_building_stock && house_gold_full)
            || self.source_empty(PoiType::GoldMine, agent.world_pos)
            || agent.hunger < 25.0
            || agent.thirst < 25.0
            || agent.stamina < 50.0
        {
            agent.gold_mining_cooldown = if is_building_stock { 45.0 } else { 180.0 };
            agent.current_need = Some(if agent.stamina < 50.0 { "Physiological·Rest" } else { "Safety·ReturnHome" }.to_string());
            self.return_home(agent);
        }
    }

    /// 建材途中转向
    fn decide_seeking_material(&mut self, agent: &mut Agent3D, pool: NodePool) {
        let gold_interrupted = pool == NodePool::Gold && self.ctx.gold_depleted;
        if pool.nodes(self.ctx).is_empty() || gold_interrupted || agent.hunger < 25.0 || agent.thirst < 25.0 || agent.stamina < 50.0 {
            if pool == NodePool::Gold {
                let is_building_stock = agent.home_house_id
                    .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
                    .map(|h| h.tier == HouseTier::Tier3Homestead && h.pantry_gold < h.max_pantry_gold)
                    .unwrap_or(false);
                agent.gold_mining_cooldown = if is_building_stock { 45.0 } else { 180.0 };
            }
            let curr_node = self.start_node(agent);
            if agent.thirst < 25.0 && !self.ctx.water_nodes.is_empty() {
                let target = self.ctx.water_nodes[0];
                self.dispatch(agent, curr_node, target, PrimitiveActionState::SeekingWater);
            } else if agent.hunger < 25.0 && !self.ctx.food_nodes.is_empty() {
                let target = self.ctx.food_nodes[0];
                self.dispatch(agent, curr_node, target, PrimitiveActionState::SeekingFood);
            } else {
                self.return_home(agent);
            }
        }
    }

    /// 生存资源途中
    fn decide_seeking_survival(&mut self, agent: &mut Agent3D, pool: NodePool) {
        if pool.nodes(self.ctx).is_empty() {
            self.return_home(agent);
        }
    }

    // ---------- 家宅储量判定 ----------

    fn wood_fully_stocked(&self, agent: &Agent3D) -> bool {
        agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_wood >= (h.max_pantry_wood * 0.98))
            .unwrap_or(true)
    }

    fn stone_fully_stocked(&self, agent: &Agent3D) -> bool {
        agent.home_house_id
            .and_then(|hid| self.houses.iter().find(|h| h.id == hid))
            .map(|h| h.pantry_stone >= (h.max_pantry_stone * 0.98))
            .unwrap_or(true)
    }
}

impl World3DEngine {
    /// 生存决策调度: 马斯洛需求层次驱动 (世界 tick 每 15 步全族人评估一次)
    pub fn tick_decisions(&mut self) {
        let ctx = self.build_decision_context();
        let mut decisioner = Decisioner {
            ctx: &ctx,
            network: &self.network,
            houses: &self.houses,
            pois: &self.pois,
            rng: &mut self.rng,
        };
        for agent in &mut self.agents {
            if agent.is_alive {
                decisioner.decide(agent);
            }
        }
    }

    /// 收集全图有储量(>0.5)且全局储量充盈的资源节点池与营地坐标
    fn build_decision_context(&self) -> DecisionContext {
        let mut water_nodes = Vec::new();
        let mut food_nodes = Vec::new();
        let mut wood_nodes = Vec::new();
        let mut stone_nodes = Vec::new();
        let mut gold_nodes = Vec::new();
        let mut camp_positions = Vec::new();

        let mut total_gold_cur = 0.0f32;
        let mut total_gold_max = 0.0f32;
        for poi in &self.pois {
            if poi.poi_type == PoiType::GoldMine {
                total_gold_cur += poi.current_stock;
                total_gold_max += poi.max_stock;
            }
        }
        let gold_depleted = total_gold_max > 0.0 && (total_gold_cur / total_gold_max) < 0.20;

        for poi in &self.pois {
            if poi.current_stock < (poi.max_stock * 0.20) { continue; }
            let Some(node) = self.find_nearest_node(poi.pos) else { continue };
            match poi.poi_type {
                PoiType::WaterSource => water_nodes.push(node),
                PoiType::BerryBush => food_nodes.push(node),
                PoiType::WoodForest => wood_nodes.push(node),
                PoiType::StoneQuarry => stone_nodes.push(node),
                PoiType::GoldMine => { if !gold_depleted { gold_nodes.push(node); } }
                PoiType::Camp => camp_positions.push((node, poi.pos)),
            }
        }

        DecisionContext {
            water_nodes,
            food_nodes,
            wood_nodes,
            stone_nodes,
            gold_nodes,
            camp_positions,
            gold_depleted,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spatial::poi::PrimitivePoi;
    use crate::spatial::{NodeType, RoadClass};

    #[test]
    fn test_thirst_need_drives_seeking_water() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);
        let camp_node = world.agents[0].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
        let water_pos = Vec3::new(camp_pos.x + 10.0, camp_pos.y, camp_pos.z);
        let water_node = world.network.add_node(water_pos, NodeType::GroundIntersection);
        let _ = world.network.add_lane(camp_node, water_node, None, RoadClass::DirtTrack);
        let _ = world.network.add_lane(water_node, camp_node, None, RoadClass::DirtTrack);
        world.pois.push(PrimitivePoi::new(999, PoiType::WaterSource, water_pos));

        world.agents[0].state = PrimitiveActionState::RestingAtCamp;
        world.agents[0].thirst = 5.0;  // 严重口渴
        world.agents[0].hunger = 45.0;
        world.agents[0].stamina = 100.0;
        world.tick_decisions();

        assert_eq!(world.agents[0].state, PrimitiveActionState::SeekingWater);
        assert_eq!(world.agents[0].target_poi_node, Some(water_node));
        assert_eq!(world.agents[0].current_need.as_deref(), Some("Physiological·QuenchThirst"));
    }

    #[test]
    fn test_warehouse_stocking_precedes_building_house() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);
        let camp_node = world.agents[0].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
        let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier1ThatchedHut);
        house.pantry_water = 2.0; // 水库未满 (安全需求)
        house.pantry_food = 2.0;  // 粮仓未满 (安全需求)
        house.pantry_wood = house.max_pantry_wood;
        world.houses.push(house);

        world.agents[0].home_house_id = Some(1);
        world.agents[0].home_camp_node = camp_node;
        world.agents[0].state = PrimitiveActionState::RestingAtCamp;
        world.agents[0].thirst = 50.0;
        world.agents[0].hunger = 50.0;
        world.agents[0].stamina = 100.0;
        world.tick_decisions();

        // 仓库未填满时，优先出发运水/运粮补齐仓库（安全需求），绝不直接施工建房
        assert!(world.agents[0].state == PrimitiveActionState::SeekingWater || world.agents[0].state == PrimitiveActionState::SeekingFood);
    }

    #[test]
    fn test_building_gold_mining_cooldown_45s() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);
        let camp_node = world.agents[0].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
        let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier3Homestead);
        house.pantry_water = house.max_pantry_water;
        house.pantry_food = house.max_pantry_food;
        house.pantry_wood = house.max_pantry_wood;
        house.pantry_stone = house.max_pantry_stone;
        house.pantry_gold = 0.0; // 3级庄舍升级大庄园缺金
        world.houses.push(house);

        world.agents[0].home_house_id = Some(1);
        world.agents[0].home_camp_node = camp_node;
        world.agents[0].state = PrimitiveActionState::RestingAtCamp;
        world.agents[0].thirst = 50.0;
        world.agents[0].hunger = 50.0;
        world.agents[0].stamina = 100.0;
        world.agents[0].gold_mining_cooldown = 0.0;
        world.tick_decisions();

        assert_eq!(world.agents[0].state, PrimitiveActionState::SeekingGold);
        assert_eq!(world.agents[0].gold_mining_cooldown, 45.0);
    }

    #[test]
    fn test_recreational_gold_mining_cooldown_180s() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);
        let camp_node = world.agents[0].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
        let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier4Manor);
        house.durability = 100.0;
        house.pantry_water = house.max_pantry_water;
        house.pantry_food = house.max_pantry_food;
        house.pantry_wood = house.max_pantry_wood;
        world.houses.push(house);

        world.agents[0].home_house_id = Some(1);
        world.agents[0].home_camp_node = camp_node;
        world.agents[0].thirst = 50.0;
        world.agents[0].hunger = 50.0;
        world.agents[0].stamina = 100.0;

        let mut gold_dispatched = false;
        for _ in 0..30 {
            world.agents[0].state = PrimitiveActionState::RestingAtCamp;
            world.agents[0].gold_mining_cooldown = 0.0;
            world.tick_decisions();
            if world.agents[0].state == PrimitiveActionState::SeekingGold {
                gold_dispatched = true;
                break;
            }
        }
        assert!(gold_dispatched, "4级大庄园竣工且物资充足后，触发娱乐淘金");
        assert_eq!(world.agents[0].gold_mining_cooldown, 180.0);
    }

    #[test]
    fn test_mining_gold_interrupted_when_stamina_below_50() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);
        let gold_pos = world.pois.iter().find(|p| p.poi_type == PoiType::GoldMine).unwrap().pos;
        world.agents[0].world_pos = gold_pos;
        world.agents[0].state = PrimitiveActionState::MiningGold;
        world.agents[0].thirst = 50.0;
        world.agents[0].hunger = 50.0;
        world.agents[0].stamina = 100.0;
        world.tick_decisions();
        assert_eq!(world.agents[0].state, PrimitiveActionState::MiningGold);

        world.agents[0].stamina = 49.0;
        world.tick_decisions();
        assert_eq!(world.agents[0].state, PrimitiveActionState::ReturningToCamp);
    }

    #[test]
    fn test_resting_must_reach_100_percent_stamina() {
        let mut world = World3DEngine::new(60, 764.0);
        world.seed_primitive_ecology(12);
        let camp_node = world.agents[0].home_camp_node;
        let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
        let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier1ThatchedHut);
        house.pantry_water = 2.0;
        house.pantry_food = 2.0;
        world.houses.push(house);

        world.agents[0].home_house_id = Some(1);
        world.agents[0].home_camp_node = camp_node;
        world.agents[0].state = PrimitiveActionState::RestingAtCamp;
        world.agents[0].thirst = 50.0;
        world.agents[0].hunger = 50.0;
        world.agents[0].stamina = 75.0;
        world.tick_decisions();
        assert_eq!(world.agents[0].state, PrimitiveActionState::RestingAtCamp);
        assert_eq!(world.agents[0].current_need.as_deref(), Some("Physiological·Rest"));

        world.agents[0].stamina = 100.0;
        world.tick_decisions();
        assert_ne!(world.agents[0].state, PrimitiveActionState::RestingAtCamp);
    }
}