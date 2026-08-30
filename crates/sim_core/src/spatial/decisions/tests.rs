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

/// POI 余额小于 30% 时，不启动对该 POI 的寻路决策
#[test]
fn test_no_pathfinding_when_poi_below_30_percent() {
    let mut world = World3DEngine::new(60, 764.0);
    world.seed_primitive_ecology(12);
    let camp_node = world.agents[0].home_camp_node;
    let camp_pos = world.network.graph[*world.network.node_map.get(&camp_node).unwrap()].pos;

    // 清空其他水源，只保留一个储量 25% (< 30%) 的水泉
    world.pois.retain(|p| p.poi_type != PoiType::WaterSource);
    let water_pos = Vec3::new(camp_pos.x + 10.0, camp_pos.y, camp_pos.z);
    let water_node = world.network.add_node(water_pos, NodeType::GroundIntersection);
    let _ = world.network.add_lane(camp_node, water_node, None, RoadClass::DirtTrack);
    let mut low_water = PrimitivePoi::new(999, PoiType::WaterSource, water_pos);
    low_water.current_stock = 15.0; // 15.0 / 60.0 = 25% (< 30%)
    world.pois.push(low_water);

    world.agents[0].state = PrimitiveActionState::RestingAtCamp;
    world.agents[0].thirst = 5.0;
    world.agents[0].hunger = 45.0;
    world.agents[0].stamina = 100.0;
    decide_now(&mut world);

    assert_ne!(world.agents[0].state, PrimitiveActionState::SeekingWater);
    assert_eq!(world.agents[0].state, PrimitiveActionState::RestingAtCamp);
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
    let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier1ThatchedHut);
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
    let mut house = House::new(1, world.agents[0].id, camp_pos, camp_node, HouseTier::Tier3Homestead);
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
    decide_now(&mut world);
    assert_eq!(world.agents[0].state, PrimitiveActionState::RestingAtCamp);
    assert_eq!(world.agents[0].current_need.as_deref(), Some("Physiological·Rest"));

    world.agents[0].stamina = 100.0;
    decide_now(&mut world);
    assert_ne!(world.agents[0].state, PrimitiveActionState::RestingAtCamp);
}