use sim_core::config::SimConfig;
use sim_core::spatial::decisions::intent::*;
use sim_core::spatial::decisions::observation::*;
use sim_core::spatial::decisions::primitive::*;
use sim_core::spatial::decisions::strategy::*;
use sim_core::spatial::decisions::*;
use sim_core::spatial::house::HouseAuctionState;
use sim_core::*;
use std::mem::{align_of, size_of};
use std::sync::atomic::{AtomicUsize, Ordering};
struct Counting;
static ALLOCS: AtomicUsize = AtomicUsize::new(0);
unsafe impl std::alloc::GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: std::alloc::Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        std::alloc::System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: std::alloc::Layout) {
        std::alloc::System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: std::alloc::Layout, n: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::Relaxed);
        std::alloc::System.realloc(p, l, n)
    }
}
#[global_allocator]
static ALLOC: Counting = Counting;
#[no_mangle]
pub extern "C" fn m19_layout(i: u32) -> usize {
    match i {
        0 => size_of::<Agent3D>(),
        1 => align_of::<Agent3D>(),
        2 => size_of::<AgentIntent>(),
        3 => align_of::<AgentIntent>(),
        4 => size_of::<ExecutionStrategy>(),
        5 => align_of::<ExecutionStrategy>(),
        6 => size_of::<ActionPrimitive>(),
        7 => align_of::<ActionPrimitive>(),
        8 => size_of::<ActiveTask>(),
        9 => align_of::<ActiveTask>(),
        10 => size_of::<Option<ActiveTask>>(),
        11 => align_of::<Option<ActiveTask>>(),
        12 => size_of::<ExecutionObservation>(),
        13 => align_of::<ExecutionObservation>(),
        _ => 0,
    }
}
#[no_mangle]
pub extern "C" fn m19_probe() -> u32 {
    use PrimitiveActionState as S;
    let states = [
        S::RestingAtCamp,
        S::SeekingWater,
        S::SeekingFood,
        S::DrinkingAtWater,
        S::ForagingFood,
        S::SeekingWood,
        S::GatheringWood,
        S::SeekingStone,
        S::MiningStone,
        S::SeekingGold,
        S::MiningGold,
        S::ReturningToCamp,
        S::ConstructingHouse,
        S::RepairingHouse,
        S::OffRoadDetour,
        S::SeekingThrone,
        S::SeekingMarket,
        S::BuyingAtMarket,
        S::SeekingCourtship,
        S::RaiseChild,
        S::Dead,
    ];
    let cfg: SimConfig = serde_json::from_str(include_str!("config.json")).unwrap();
    let mut a = Agent3D::new_with_config(1, 1, 1., false, 50., Gender::Male, &cfg);
    let mut checks = 0;
    a.pending_bid_house_ids = (1..101).collect();
    a.courtship_pending = Some(22);
    a.coronation_pending = Some(4);
    a.raise_child_pending = true;
    a.pending_house_pos = Some(Vec3::new(5., 6., 7.));
    a.route = vec![1, 2, 3];
    a.route_index = 3;
    a.current_need = Some("Instantaneous·BidHouse".into());
    for state in states {
        for lane in [None, Some(2)] {
            for lifecycle in 0..3 {
                a.state = state;
                a.current_lane_id = lane;
                a.is_alive = lifecycle != 2;
                a.is_fetus = lifecycle == 1;
                let before = serde_json::to_string(&a).unwrap();
                let n = ALLOCS.load(Ordering::Relaxed);
                let ob = std::hint::black_box(a.observe_execution());
                assert_eq!(ob.activity.legacy_state(), state);
                assert_eq!(ob.motion.lane, lane);
                assert_eq!(ob.motion.route_index, 3);
                assert_eq!(ob.motion.route.as_ptr(), a.route.as_ptr());
                assert_eq!(
                    ob.pending.auction_houses.as_ptr(),
                    a.pending_bid_house_ids.as_ptr()
                );
                assert_eq!(ob.pending.auction_houses.len(), 100);
                assert_eq!(ob.pending.courtship, Some(22));
                assert!(ob.pending.childcare);
                assert_eq!(ob.pending.coronation, Some(4));
                assert_eq!(
                    ob.lifecycle,
                    match lifecycle {
                        0 => LifecycleObservation::Alive,
                        1 => LifecycleObservation::Fetus,
                        _ => LifecycleObservation::Dead,
                    }
                );
                assert_eq!(ALLOCS.load(Ordering::Relaxed), n);
                assert_eq!(before, serde_json::to_string(&a).unwrap());
                checks += 1;
            }
        }
    }
    for branch in BranchId::ALL {
        for near in [false, true] {
            let mut w = World3DEngine::new_seeded_with_config(60, 764., 42, cfg.clone());
            w.seed_primitive_ecology(20);
            let mut a = w
                .agents
                .iter()
                .find(|a| a.gender == Gender::Male)
                .unwrap()
                .clone();
            a.age = w.config.agent_adult_age + 1.;
            a.is_alive = true;
            a.is_fetus = false;
            a.spouse_id = None;
            a.hunger = 50.;
            a.thirst = 50.;
            a.stamina = 100.;
            a.carried_water = 0.;
            a.carried_food = 0.;
            a.carried_wood = 0.;
            a.carried_stone = 0.;
            a.carried_gold = 0.;
            a.family_stock_active = [true; 5];
            a.gold_mining_cooldown = 0.;
            a.last_bid_tick = None;
            a.pending_bid_house_ids.clear();
            a.courtship_pending = None;
            a.raise_child_pending = false;
            a.pending_house_pos = None;
            a.current_lane_id = None;
            let node = a.home_camp_node;
            let pos = w.network.graph[w.network.node_map[&node]].pos;
            a.world_pos = pos;
            let mut house = House::new_with_config(
                9999,
                a.id,
                pos,
                node,
                HouseTier::Tier0Warehouse,
                1,
                &w.config,
            );
            a.home_house_id = Some(house.id);
            let hid = w.household_registry.household_of(a.id).unwrap();
            for rk in FAMILY_STOCK_ORDER {
                w.household_registry
                    .get_mut(hid)
                    .unwrap()
                    .group
                    .ledger
                    .credit(rk, 10000.);
            }
            w.region_registry.regions.clear();
            match branch {
                BranchId::B1QuenchThirst => a.thirst = 0.,
                BranchId::B2SateHunger => a.hunger = 0.,
                BranchId::B3Rest => a.stamina = 0.,
                BranchId::B4RepairHouse => house.durability = 0.,
                BranchId::B8ImproveHome => {
                    house.tier = if near {
                        HouseTier::Tier0Warehouse
                    } else {
                        HouseTier::Tier3Homestead
                    }
                }
                BranchId::B12FoundHome => a.home_house_id = None,
                BranchId::B13GoldWealth => {
                    house.tier = HouseTier::Tier4Manor;
                    house.durability = 100.;
                    a.family_stock_active = [false; 5];
                }
                BranchId::B18RaiseChild => {
                    house.tier = HouseTier::Tier1ThatchedHut;
                    a.spouse_id = Some(8888);
                }
                _ => {}
            }
            w.houses = vec![house];
            let mut sale =
                House::new_with_config(9998, a.id, pos, node, HouseTier::Tier4Manor, 1, &w.config);
            sale.owner_id = None;
            sale.auction_state = Some(HouseAuctionState {
                start_durability: 100.,
                benchmark_bid: 1.,
                current_highest_bid: 0.,
                current_highest_bidder: None,
                bids_history: Default::default(),
                voluntary_seller_household_id: None,
            });
            w.houses.push(sale);
            let mut ctx = w.build_decision_context();
            for poi in &w.pois {
                a.observe_poi_stock_with_config(poi.id, poi.max_stock, poi.max_stock, &w.config);
            }
            let target = if near {
                pos
            } else {
                Vec3::new(pos.x + 100., pos.y, pos.z)
            };
            ctx.eligible_females = vec![EligibleFemale {
                id: 8888,
                pos: target,
                libido: 100.,
                nearest_node: node,
            }];
            ctx.conception_ready_wives = vec![ReadyWife {
                id: 8888,
                pos: target,
                stationary: true,
            }];
            let order = BranchId::ALL;
            let rng_before = serde_json::to_string(&w.rng).unwrap();
            let d = Decisioner {
                ctx: &ctx,
                network: &w.network,
                houses: &w.houses,
                households: &w.household_registry,
                regions: &w.region_registry,
                rng: &mut w.rng,
                config: &w.config,
                branch_order: &order,
                tick: 1000,
            };
            let need = branch
                .evaluate(&d, &a)
                .unwrap_or_else(|| panic!("branch {:?} near {} not hit", branch, near));
            let tier = a
                .home_house_id
                .and_then(|id| w.houses.iter().find(|h| h.id == id))
                .map(|h| h.tier);
            for level in [need.level, MaslowLevel::Physiological, MaslowLevel::Esteem] {
                let n = Need { level, ..need };
                let allocs = ALLOCS.load(Ordering::Relaxed);
                let observed = n.observe_intent(branch, tier).unwrap();
                assert_eq!(ALLOCS.load(Ordering::Relaxed), allocs);
                match observed {
                    IntentObservation::Sustained(i) => {
                        assert_eq!(i.source_branch, branch);
                        assert_eq!(i.level, level);
                        assert_ne!(branch, BranchId::B17BidHouse);
                    }
                    IntentObservation::Submission {
                        source_branch,
                        level: lv,
                        ..
                    } => {
                        assert_eq!(source_branch, branch);
                        assert_eq!(lv, level);
                        assert!(branch.is_instant());
                    }
                }
                checks += 1;
            }
            drop(d);
            assert_eq!(rng_before, serde_json::to_string(&w.rng).unwrap());
        }
    }
    let n = Need {
        level: MaslowLevel::Physiological,
        kind: NeedKind::BuildHouse,
        target_state: S::ConstructingHouse,
    };
    assert_eq!(
        n.observe_intent(BranchId::B8ImproveHome, None),
        Err(IntentObservationError::MissingHomeTier)
    );
    assert_eq!(
        n.observe_intent(BranchId::B8ImproveHome, Some(HouseTier::Tier4Manor)),
        Err(IntentObservationError::InvalidUpgradeTier)
    );
    assert_eq!(
        n.observe_intent(BranchId::B1QuenchThirst, None),
        Err(IntentObservationError::BranchKindMismatch)
    );
    let n = Need {
        level: MaslowLevel::Instantaneous,
        kind: NeedKind::Rest,
        target_state: S::RestingAtCamp,
    };
    assert_eq!(
        n.observe_intent(BranchId::B3Rest, None),
        Err(IntentObservationError::NonInstantBranch)
    );
    checks + 4
}
fn main() {
    let n = m19_probe();
    println!(
        "{}",
        serde_json::json!({"checks":n,"layout":(0..14).map(|i| m19_layout(i)).collect::<Vec<_>>()})
    );
}
