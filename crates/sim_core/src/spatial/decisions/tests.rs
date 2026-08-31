use super::super::vec3::Vec3;
use super::super::agent::PrimitiveActionState;
use super::super::poi::{PrimitivePoi, PoiType};
use super::super::house::{House, HouseTier};
use super::super::world::World3DEngine;
use super::super::{NodeType, RoadClass};

fn decide_now(world: &mut World3DEngine) {
    world.tick_counter = 29;
    world.tick_decisions();
}

#[test]
fn test_staggered_decision_offsets() {
    let mut world = World3DEngine::new(60, 764.0);
    world.seed_primitive_ecology(12);
    let camp_node = world.agents[0].home_camp_node;
    let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
    let water_pos = Vec3::new(camp_pos.x + 10.0, camp_pos.y, camp_pos.z);
    let water_node = world.network.add_node(water_pos, NodeType::GroundIntersection);
    let _ = world.network.add_lane(camp_node, water_node, None, RoadClass::DirtTrack);
    let _ = world.network.add_lane(water_node, camp_node, None, RoadClass::DirtTrack);
    world.pois.push(PrimitivePoi::new(999, PoiType::WaterSource, water_pos));

    for a in world.agents.iter_mut().take(2) {
        a.world_pos = camp_pos;
        a.state = PrimitiveActionState::RestingAtCamp;
        a.thirst = 5.0;
        a.hunger = 45.0;
        a.stamina = 100.0;
    }

    // tick=28: 仅 id=2 (agent[1]) 相位命中 ((28+2)%30==0)，id=1 (agent[0]) 不命中
    world.tick_counter = 28;
    world.tick_decisions();
    assert_eq!(world.agents[0].state, PrimitiveActionState::RestingAtCamp);
    assert_eq!(world.agents[1].state, PrimitiveActionState::SeekingWater);

    // tick=29: 轮到 id=1 (agent[0]) 决策 ((29+1)%30==0)
    world.tick_counter = 29;
    world.tick_decisions();
    assert_eq!(world.agents[0].state, PrimitiveActionState::SeekingWater);
}

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
    world.agents[0].thirst = 5.0;
    world.agents[0].hunger = 45.0;
    world.agents[0].stamina = 100.0;
    decide_now(&mut world);

    assert_eq!(world.agents[0].state, PrimitiveActionState::SeekingWater);
    assert_eq!(world.agents[0].target_poi_node, Some(water_node));
    assert_eq!(world.agents[0].current_need.as_deref(), Some("Physiological·QuenchThirst"));
}

/// 首次观察到处于中间带的 POI 时，触发器默认关闭，不会启动寻路。
#[test]
fn test_unobserved_midband_poi_is_not_seekable_until_it_recovers_to_30_percent() {
    let mut world = World3DEngine::new(60, 764.0);
    world.seed_primitive_ecology(12);
    let camp_node = world.agents[0].home_camp_node;
    let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;

    // 清空其他水源，只保留一个首次被观察到时处于 25% 中间带的水泉。
    world.pois.retain(|p| p.poi_type != PoiType::WaterSource);
    let water_pos = Vec3::new(camp_pos.x + 10.0, camp_pos.y, camp_pos.z);
    let water_node = world.network.add_node(water_pos, NodeType::GroundIntersection);
    let _ = world.network.add_lane(camp_node, water_node, None, RoadClass::DirtTrack);
    let mut low_water = PrimitivePoi::new(999, PoiType::WaterSource, water_pos);
    low_water.current_stock = 15.0; // 25%，无既有开放记忆时保持关闭。
    world.pois.push(low_water);

    world.agents[0].state = PrimitiveActionState::RestingAtCamp;
    world.agents[0].thirst = 5.0;
    world.agents[0].hunger = 45.0;
    world.agents[0].stamina = 100.0;
    decide_now(&mut world);

    assert_ne!(world.agents[0].state, PrimitiveActionState::SeekingWater);
    assert_eq!(world.agents[0].state, PrimitiveActionState::RestingAtCamp);
}

#[test]
fn test_poi_seekability_is_private_to_each_agent() {
    let mut world = World3DEngine::new(60, 764.0);
    world.seed_primitive_ecology(12);
    let (water_id, water_max_stock) = world.pois.iter()
        .find(|poi| poi.poi_type == PoiType::WaterSource)
        .map(|poi| (poi.id, poi.max_stock))
        .unwrap();

    // Agent #1 曾在资源充足时观察过它，因此 25% 中间带仍判为可用。
    world.agents[0].observe_poi_stock(water_id, 45.0, water_max_stock);
    world.agents[0].observe_poi_stock(water_id, 15.0, water_max_stock);

    // Agent #2 首次看到的就是 25%，没有“已开放”记忆，判为不可用。
    world.agents[1].observe_poi_stock(water_id, 15.0, water_max_stock);

    assert!(world.agents[0].poi_is_seekable(water_id));
    assert!(!world.agents[1].poi_is_seekable(water_id));
}

/// 中途发现目标 POI 余额小于 10% 时，直接放弃寻路并原地掉头沿原路折返，不发生瞬移
#[test]
fn test_abandon_seeking_when_target_poi_below_10_percent() {
    let mut world = World3DEngine::new(60, 764.0);
    world.seed_primitive_ecology(12);
    let camp_node = world.agents[0].home_camp_node;
    let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;

    // 清空其他林木，只保留一个目标林地
    world.pois.retain(|p| p.poi_type != PoiType::WoodForest);
    let wood_pos = Vec3::new(camp_pos.x + 20.0, camp_pos.y, camp_pos.z);
    let wood_node = world.network.add_node(wood_pos, NodeType::GroundIntersection);
    let lane_go = world.network.add_lane(camp_node, wood_node, None, RoadClass::DirtTrack).unwrap();
    let lane_back = world.network.add_lane(wood_node, camp_node, None, RoadClass::DirtTrack).unwrap();
    let mut wood_poi = PrimitivePoi::new(888, PoiType::WoodForest, wood_pos);
    wood_poi.current_stock = 5.0; // 5.0 / 60.0 = 8.3% (< 10%)
    world.pois.push(wood_poi);

    // 设置 agent 正在赶往该林地，位于前往车道前半程 8.0m 处 (全长20.0m)
    world.agents[0].state = PrimitiveActionState::SeekingWood;
    world.agents[0].target_poi_node = Some(wood_node);
    world.agents[0].current_lane_id = Some(lane_go);
    world.agents[0].distance_along_curve = 8.0;
    world.agents[0].world_pos = Vec3::new(camp_pos.x + 8.0, camp_pos.y, camp_pos.z);
    world.agents[0].thirst = 50.0;
    world.agents[0].hunger = 50.0;
    world.agents[0].stamina = 100.0;
    decide_now(&mut world);

    // 中途发现目标点余额跌破 10%，直接放弃并切换为 ReturningToCamp
    assert_eq!(world.agents[0].state, PrimitiveActionState::ReturningToCamp);
    // 掉头切换为反向车道，且进度从 20.0 - 8.0 = 12.0m 开始，坐标无瞬移
    assert_eq!(world.agents[0].current_lane_id, Some(lane_back));
    assert!((world.agents[0].distance_along_curve - 12.0).abs() < 0.1);
}

#[test]
fn test_warehouse_stocking_precedes_building_house() {
    let mut world = World3DEngine::new(60, 764.0);
    world.seed_primitive_ecology(12);
    let camp_node = world.agents[0].home_camp_node;
    let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
    let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier1ThatchedHut, 1);
    house.pantry_water = 2.0;
    house.pantry_food = 2.0;
    house.pantry_wood = house.max_pantry_wood;
    world.houses.push(house);

    world.agents[0].home_house_id = Some(1);
    world.agents[0].home_camp_node = camp_node;
    world.agents[0].state = PrimitiveActionState::RestingAtCamp;
    world.agents[0].thirst = 50.0;
    world.agents[0].hunger = 50.0;
    world.agents[0].stamina = 100.0;
    decide_now(&mut world);

    assert!(world.agents[0].state == PrimitiveActionState::SeekingWater || world.agents[0].state == PrimitiveActionState::SeekingFood);
}

#[test]
fn test_building_gold_mining_cooldown_45s() {
    let mut world = World3DEngine::new(60, 764.0);
    world.seed_primitive_ecology(12);
    let camp_node = world.agents[0].home_camp_node;
    let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
    let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier3Homestead, 1);
    house.pantry_water = house.max_pantry_water;
    house.pantry_food = house.max_pantry_food;
    house.pantry_wood = house.max_pantry_wood;
    house.pantry_stone = house.max_pantry_stone;
    house.pantry_gold = 0.0;
    world.houses.push(house);

    world.agents[0].home_house_id = Some(1);
    world.agents[0].home_camp_node = camp_node;
    world.agents[0].state = PrimitiveActionState::RestingAtCamp;
    world.agents[0].thirst = 50.0;
    world.agents[0].hunger = 50.0;
    world.agents[0].stamina = 100.0;
    world.agents[0].gold_mining_cooldown = 0.0;
    decide_now(&mut world);

    assert_eq!(world.agents[0].state, PrimitiveActionState::SeekingGold);
    assert_eq!(world.agents[0].gold_mining_cooldown, 45.0);
}

#[test]
fn test_recreational_gold_mining_cooldown_180s() {
    let mut world = World3DEngine::new(60, 764.0);
    world.seed_primitive_ecology(12);
    let camp_node = world.agents[0].home_camp_node;
    let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
    let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier4Manor, 1);
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
        decide_now(&mut world);
        if world.agents[0].state == PrimitiveActionState::SeekingGold {
            gold_dispatched = true;
            break;
        }
    }
    assert!(gold_dispatched);
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
    decide_now(&mut world);
    assert_eq!(world.agents[0].state, PrimitiveActionState::MiningGold);

    world.agents[0].stamina = 49.0;
    decide_now(&mut world);
    assert_eq!(world.agents[0].state, PrimitiveActionState::ReturningToCamp);
}

#[test]
fn test_resting_must_reach_100_percent_stamina() {
    let mut world = World3DEngine::new(60, 764.0);
    world.seed_primitive_ecology(12);
    let camp_node = world.agents[0].home_camp_node;
    let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;
    let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier1ThatchedHut, 1);
    house.pantry_water = 2.0;
    house.pantry_food = 2.0;
    world.houses.push(house);

    world.agents[0].home_house_id = Some(1);
    world.agents[0].home_camp_node = camp_node;
    world.agents[0].state = PrimitiveActionState::RestingAtCamp;
    world.agents[0].thirst = 50.0;
    world.agents[0].hunger = 50.0;
    world.agents[0].stamina = 75.0;
    decide_now(&mut world);
    assert_eq!(world.agents[0].state, PrimitiveActionState::RestingAtCamp);
    assert_eq!(world.agents[0].current_need.as_deref(), Some("Physiological·Rest"));

    world.agents[0].stamina = 100.0;
    decide_now(&mut world);
    assert_ne!(world.agents[0].state, PrimitiveActionState::RestingAtCamp);
}

/// 途中发现目标 POI 余额小于 10% 时，若全图存在其他未枯竭 POI，平滑掉头并重定向至就近可用 POI
#[test]
fn test_reroute_to_next_poi_when_target_depleted() {
    let mut world = World3DEngine::new(60, 764.0);
    world.seed_primitive_ecology(12);
    let camp_node = world.agents[0].home_camp_node;
    let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;

    // 清空其他林木，只保留两个林地: wood1 (即将枯竭) 和 wood2 (储量充沛)
    world.pois.retain(|p| p.poi_type != PoiType::WoodForest);
    let wood_pos1 = Vec3::new(camp_pos.x + 20.0, camp_pos.y, camp_pos.z);
    let wood_node1 = world.network.add_node(wood_pos1, NodeType::GroundIntersection);
    let lane_go1 = world.network.add_lane(camp_node, wood_node1, None, RoadClass::DirtTrack).unwrap();
    let _lane_back1 = world.network.add_lane(wood_node1, camp_node, None, RoadClass::DirtTrack).unwrap();
    let mut wood_poi1 = PrimitivePoi::new(881, PoiType::WoodForest, wood_pos1);
    wood_poi1.current_stock = 5.0; // 5.0 / 60.0 = 8.3% (< 10%)
    world.pois.push(wood_poi1);

    let wood_pos2 = Vec3::new(camp_pos.x - 30.0, camp_pos.y, camp_pos.z);
    let wood_node2 = world.network.add_node(wood_pos2, NodeType::GroundIntersection);
    let _ = world.network.add_lane(camp_node, wood_node2, None, RoadClass::DirtTrack);
    let _ = world.network.add_lane(wood_node2, camp_node, None, RoadClass::DirtTrack);
    let mut wood_poi2 = PrimitivePoi::new(882, PoiType::WoodForest, wood_pos2);
    wood_poi2.current_stock = 50.0; // 充沛 (> 30%)
    world.pois.push(wood_poi2);

    // 设置 agent 正在赶往 wood1，途中位于 lane_go1 8.0m 处
    world.agents[0].state = PrimitiveActionState::SeekingWood;
    world.agents[0].target_poi_node = Some(wood_node1);
    world.agents[0].current_lane_id = Some(lane_go1);
    world.agents[0].distance_along_curve = 8.0;
    world.agents[0].world_pos = Vec3::new(camp_pos.x + 8.0, camp_pos.y, camp_pos.z);
    world.agents[0].thirst = 50.0;
    world.agents[0].hunger = 50.0;
    world.agents[0].stamina = 100.0;
    decide_now(&mut world);

    // 发现目标点1跌破10%，但备用点2充沛，成功重路由至 wood_node2 继续 SeekingWood
    assert_eq!(world.agents[0].state, PrimitiveActionState::SeekingWood);
    assert_eq!(world.agents[0].target_poi_node, Some(wood_node2));
}

/// 采收现场资源枯竭但随身背包未满且家宅仍需时，小人继续寻找下一个同类 POI 而不直接送货回家
#[test]
fn test_continue_seeking_next_poi_when_harvest_source_empty_and_not_full() {
    let mut world = World3DEngine::new(60, 764.0);
    world.seed_primitive_ecology(12);
    let camp_node = world.agents[0].home_camp_node;
    let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;

    // 清空其他林木，保留两个林地: wood1 (空) 和 wood2 (充沛)
    world.pois.retain(|p| p.poi_type != PoiType::WoodForest);
    let wood_pos1 = Vec3::new(camp_pos.x + 10.0, camp_pos.y, camp_pos.z);
    let wood_node1 = world.network.add_node(wood_pos1, NodeType::GroundIntersection);
    let _ = world.network.add_lane(camp_node, wood_node1, None, RoadClass::DirtTrack);
    let _ = world.network.add_lane(wood_node1, camp_node, None, RoadClass::DirtTrack);
    let mut wood_poi1 = PrimitivePoi::new(881, PoiType::WoodForest, wood_pos1);
    wood_poi1.current_stock = 0.0; // 枯竭
    world.pois.push(wood_poi1);

    let wood_pos2 = Vec3::new(camp_pos.x - 20.0, camp_pos.y, camp_pos.z);
    let wood_node2 = world.network.add_node(wood_pos2, NodeType::GroundIntersection);
    let _ = world.network.add_lane(camp_node, wood_node2, None, RoadClass::DirtTrack);
    let _ = world.network.add_lane(wood_node2, camp_node, None, RoadClass::DirtTrack);
    let _ = world.network.add_lane(wood_node1, wood_node2, None, RoadClass::DirtTrack);
    let _ = world.network.add_lane(wood_node2, wood_node1, None, RoadClass::DirtTrack);
    let mut wood_poi2 = PrimitivePoi::new(882, PoiType::WoodForest, wood_pos2);
    wood_poi2.current_stock = 50.0;
    world.pois.push(wood_poi2);

    // 家宅需要木材
    let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier1ThatchedHut, 1);
    house.pantry_wood = 0.0;
    house.pantry_water = house.max_pantry_water;
    house.pantry_food = house.max_pantry_food;
    world.houses.push(house);

    world.agents[0].home_house_id = Some(1);
    world.agents[0].home_camp_node = camp_node;
    world.agents[0].world_pos = wood_pos1;
    world.agents[0].state = PrimitiveActionState::GatheringWood;
    world.agents[0].target_poi_node = Some(wood_node1);
    world.agents[0].carried_wood = 15.0; // 未满 (上限 50.0)
    world.agents[0].thirst = 50.0;
    world.agents[0].hunger = 50.0;
    world.agents[0].stamina = 100.0;
    decide_now(&mut world);

    // 采伐点1已空且背包未满，自动前往 wood_node2 采伐
    assert_eq!(world.agents[0].state, PrimitiveActionState::SeekingWood);
    assert_eq!(world.agents[0].target_poi_node, Some(wood_node2));
}

/// 进食现场食物枯竭但自身仍未吃饱时，小人继续寻找下一个食物 POI 而不直接折返回家
#[test]
fn test_continue_seeking_next_food_when_foraging_source_empty_and_not_full() {
    let mut world = World3DEngine::new(60, 764.0);
    world.seed_primitive_ecology(12);
    let camp_node = world.agents[0].home_camp_node;
    let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;

    // 清空其他食物，保留两个浆果丛: berry1 (空) 和 berry2 (充沛)
    world.pois.retain(|p| p.poi_type != PoiType::BerryBush);
    let berry_pos1 = Vec3::new(camp_pos.x + 10.0, camp_pos.y, camp_pos.z);
    let berry_node1 = world.network.add_node(berry_pos1, NodeType::GroundIntersection);
    let _ = world.network.add_lane(camp_node, berry_node1, None, RoadClass::DirtTrack);
    let _ = world.network.add_lane(berry_node1, camp_node, None, RoadClass::DirtTrack);
    let mut berry_poi1 = PrimitivePoi::new(771, PoiType::BerryBush, berry_pos1);
    berry_poi1.current_stock = 0.0; // 枯竭
    world.pois.push(berry_poi1);

    let berry_pos2 = Vec3::new(camp_pos.x - 20.0, camp_pos.y, camp_pos.z);
    let berry_node2 = world.network.add_node(berry_pos2, NodeType::GroundIntersection);
    let _ = world.network.add_lane(camp_node, berry_node2, None, RoadClass::DirtTrack);
    let _ = world.network.add_lane(berry_node2, camp_node, None, RoadClass::DirtTrack);
    let _ = world.network.add_lane(berry_node1, berry_node2, None, RoadClass::DirtTrack);
    let _ = world.network.add_lane(berry_node2, berry_node1, None, RoadClass::DirtTrack);
    let mut berry_poi2 = PrimitivePoi::new(772, PoiType::BerryBush, berry_pos2);
    berry_poi2.current_stock = 50.0;
    world.pois.push(berry_poi2);

    world.agents[0].world_pos = berry_pos1;
    world.agents[0].state = PrimitiveActionState::ForagingFood;
    world.agents[0].target_poi_node = Some(berry_node1);
    world.agents[0].hunger = 20.0; // 还没吃饱 (< 49.9)
    world.agents[0].thirst = 50.0;
    world.agents[0].stamina = 100.0;
    decide_now(&mut world);

    // 浆果1已空且自己没吃饱，自动前往 berry_node2 继续寻找食物
    assert_eq!(world.agents[0].state, PrimitiveActionState::SeekingFood);
    assert_eq!(world.agents[0].target_poi_node, Some(berry_node2));
}
