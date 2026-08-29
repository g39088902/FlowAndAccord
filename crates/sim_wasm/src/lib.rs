//! sim_wasm — 将 sim_core 编译为 wasm32-unknown-unknown 的零依赖桥接模块
//!
//! 前端通过 `WebAssembly.instantiate` 加载本模块，调用导出函数推进确定性仿真，
//! 并从 wasm 线性内存读取 JSON 快照（不依赖 wasm-bindgen）。
//! 所有导出均为 extern "C"，AOT 可解析；world_create 的 seed 参数保证可复现。

use sim_core::spatial::World3DEngine;

static mut WORLD: Option<World3DEngine> = None;
static mut SNAPSHOT_BUF: Vec<u8> = Vec::new();

/// 创建世界并注入初始生态 (grid_res=60, world_size=764, seed 可复现，agent_count=12)
#[no_mangle]
pub extern "C" fn world_create(grid_res: u32, world_size: f32, seed: f64, agent_count: u32) -> i32 {
    unsafe {
        let mut w = World3DEngine::new_seeded(grid_res as usize, world_size, seed as u64);
        w.seed_primitive_ecology(agent_count as usize);
        WORLD = Some(w);
    }
    0
}

/// 推进一个确定性仿真步 (dt 秒)
#[no_mangle]
pub extern "C" fn world_tick(dt: f32) {
    unsafe {
        if let Some(w) = WORLD.as_mut() {
            w.tick(dt);
        }
    }
}

/// 推进 N 个仿真步 (对应前端 speedMult)
#[no_mangle]
pub extern "C" fn world_tick_steps(steps: u32, dt: f32) {
    for _ in 0..steps {
        world_tick(dt);
    }
}

/// 设置某类 POI 再生倍率 (0=水 1=果 2=木 3=石)
#[no_mangle]
pub extern "C" fn world_set_regen_multiplier(which: i32, mult: f32) {
    unsafe {
        if let Some(w) = WORLD.as_mut() {
            w.set_regen_multiplier(which as u8, mult);
        }
    }
}

/// 序列化当前世界快照到内部缓冲，返回缓冲起始指针 (配合 world_snapshot_len 读取)
#[no_mangle]
pub extern "C" fn world_snapshot_ptr() -> u32 {
    unsafe {
        if let Some(w) = WORLD.as_ref() {
            let snap = w.generate_snapshot();
            if let Ok(json) = serde_json::to_string(&snap) {
                SNAPSHOT_BUF = json.into_bytes();
            }
        }
        SNAPSHOT_BUF.as_ptr() as u32
    }
}

/// 返回快照 JSON 字节长度
#[no_mangle]
pub extern "C" fn world_snapshot_len() -> u32 {
    unsafe { SNAPSHOT_BUF.len() as u32 }
}
