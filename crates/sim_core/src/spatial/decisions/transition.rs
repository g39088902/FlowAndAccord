//! transition.rs · 统一活动任务生命周期转换器与状态同步
//! 负责任务安装、阶段推进、运动到达与生命周期事件，消除多处双重状态写入。

use crate::spatial::agent::{Agent3D, PrimitiveActionState};
use super::strategy::{ActiveTask, ExecutionStrategy, ResourceStage, ReturnStage, CommitStage, HomeStage};
use super::primitive::{ActionPrimitive, HoldKind};
use super::projection::compatible_legacy_state;

/// 安装新任务并同步兼容视图
pub fn install_task(agent: &mut Agent3D, task: ActiveTask) {
    let legacy_state = compatible_legacy_state(&task);
    agent.active_task = Some(task);
    agent.state = legacy_state;
}

/// 推进任务的内部阶段与原语，并同步兼容状态
pub fn advance_stage(agent: &mut Agent3D, update_fn: impl FnOnce(&mut ActiveTask)) {
    if let Some(task) = agent.active_task.as_mut() {
        update_fn(task);
        agent.state = compatible_legacy_state(task);
    }
}

/// 运动系统在 Phase 5 到达目标节点时触发：推进阶段至 OnSite / Unloading / Recovering / Working
pub fn on_navigation_arrived(agent: &mut Agent3D) {
    if let Some(task) = agent.active_task.as_mut() {
        match &mut task.strategy {
            ExecutionStrategy::WildHarvest { poi, stage, .. } => {
                match *stage {
                    ResourceStage::Outbound => {
                        *stage = ResourceStage::OnSite;
                        if let Some(pid) = *poi {
                            task.primitive = ActionPrimitive::Hold(HoldKind::ResourceSite(pid));
                        }
                    }
                    ResourceStage::Returning => {
                        *stage = ResourceStage::Unloading;
                        task.primitive = ActionPrimitive::Hold(HoldKind::Residence);
                    }
                    _ => {}
                }
            }
            ExecutionStrategy::MarketTrade { market, stage } => {
                match *stage {
                    ResourceStage::Outbound => {
                        *stage = ResourceStage::OnSite;
                        task.primitive = ActionPrimitive::Hold(HoldKind::ResourceSite(*market));
                    }
                    ResourceStage::Returning => {
                        *stage = ResourceStage::Unloading;
                        task.primitive = ActionPrimitive::Hold(HoldKind::Residence);
                    }
                    _ => {}
                }
            }
            ExecutionStrategy::ReturnToResidence { stage, .. } => {
                if *stage == ReturnStage::Travelling {
                    *stage = ReturnStage::Recovering;
                    task.primitive = ActionPrimitive::Hold(HoldKind::Residence);
                }
            }
            ExecutionStrategy::Courtship { stage, .. } => {
                if *stage == CommitStage::Travelling {
                    *stage = CommitStage::Ready;
                }
            }
            ExecutionStrategy::ClaimThrone { stage, .. } => {
                if *stage == CommitStage::Travelling {
                    *stage = CommitStage::Ready;
                }
            }
            ExecutionStrategy::Childcare { stage, .. } => {
                if *stage == CommitStage::Travelling {
                    *stage = CommitStage::Ready;
                }
            }
            ExecutionStrategy::FoundHome { stage, .. } => {
                if *stage == CommitStage::Travelling {
                    *stage = CommitStage::Ready;
                }
            }
            ExecutionStrategy::UpgradeHome { stage, .. } => {
                if *stage == HomeStage::Returning {
                    *stage = HomeStage::Working;
                    task.primitive = ActionPrimitive::Hold(HoldKind::Upgrade);
                }
            }
            ExecutionStrategy::RepairHome { stage, .. } => {
                if *stage == HomeStage::Returning {
                    *stage = HomeStage::Working;
                    task.primitive = ActionPrimitive::Hold(HoldKind::Repair);
                }
            }
        }
        agent.state = compatible_legacy_state(task);
    }
}

/// 车道失效或离路绕行
pub fn on_offroad_detour(agent: &mut Agent3D) {
    if let Some(task) = agent.active_task.as_mut() {
        task.primitive = ActionPrimitive::Hold(HoldKind::OffRoad);
    }
    agent.state = PrimitiveActionState::OffRoadDetour;
}

/// 任务完成退出：清空任务控制器，平滑置为静止 RestingAtCamp
pub fn finish_task(agent: &mut Agent3D) {
    agent.active_task = None;
    agent.clear_harvest_queue();
    agent.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
}

/// 任务由于资格失效被取消（置为静止态）
pub fn cancel_task(agent: &mut Agent3D) {
    agent.active_task = None;
    agent.clear_harvest_queue();
    agent.enter_stationary_state(PrimitiveActionState::RestingAtCamp);
}

/// 任务由于危机或更高优先级意图被抢占：清空旧任务控制器，保留物理车道、速度与随身行囊
pub fn preempt_task(agent: &mut Agent3D) {
    agent.active_task = None;
    agent.clear_harvest_queue();
}

/// 死亡事件：生命周期终态，强制清除任务并置 Dead
pub fn on_agent_death(agent: &mut Agent3D) {
    agent.active_task = None;
    agent.clear_harvest_queue();
    agent.state = PrimitiveActionState::Dead;
}
