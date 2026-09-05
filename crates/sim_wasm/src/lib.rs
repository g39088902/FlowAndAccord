//! sim_wasm — 将 sim_core 编译为 wasm32-unknown-unknown 的零依赖桥接模块
//!
//! 前端通过 `WebAssembly.instantiate` 加载本模块，调用导出函数推进确定性仿真，
//! 并从 wasm 线性内存读取 JSON 快照（不依赖 wasm-bindgen）。
//! 所有导出均为 extern "C"，AOT 可解析；world_create 的 seed 参数保证可复现。

use sim_core::spatial::{deserialize_save, serialize_save, World3DEngine};

static mut WORLD: Option<World3DEngine> = None;
static mut SNAPSHOT_BUF: Vec<u8> = Vec::new();
static mut CONFIG_BUF: Vec<u8> = Vec::new();
/// 存档 JSON 缓冲（world_save_ptr 写入 / world_load 读取）
static mut SAVE_BUF: Vec<u8> = Vec::new();
/// 最近一次存档/读档失败原因（UTF-8 文本，供前端提示，成功时清空）
static mut ERROR_BUF: Vec<u8> = Vec::new();

/// 记录最近一次错误文本（成功路径调用 clear_error）
fn set_error(msg: &str) {
    unsafe { ERROR_BUF = msg.as_bytes().to_vec(); }
}

fn clear_error() {
    unsafe { ERROR_BUF.clear(); }
}

/// 创建世界并注入初始生态 (grid_res=60, world_size=764, seed 可复现，agent_count=20)
/// camp_count: 营地数量，须在播种生态前注入（否则 countCamps 前端配置无法生效，见 §4.7）
#[no_mangle]
pub extern "C" fn world_create(grid_res: u32, world_size: f32, seed: f64, agent_count: u32, camp_count: u32) -> i32 {
    unsafe {
        let mut w = World3DEngine::new_seeded(grid_res as usize, world_size, seed as u64);
        if camp_count > 0 {
            w.config.count_camps = camp_count as usize;
        }
        w.seed_primitive_ecology(agent_count as usize);
        WORLD = Some(w);
    }
    0
}

/// 准备写入 Config JSON 的内部缓冲区，返回起始指针
#[no_mangle]
pub extern "C" fn world_config_buf_ptr(len: u32) -> u32 {
    unsafe {
        CONFIG_BUF.resize(len as usize, 0);
        CONFIG_BUF.as_mut_ptr() as u32
    }
}

/// 解析并应用 Config 内部缓冲区中的 JSON 数据 (返回 0 表示成功)
#[no_mangle]
pub extern "C" fn world_apply_config_buf(len: u32) -> i32 {
    unsafe {
        if let Some(w) = WORLD.as_mut() {
            let len = len as usize;
            if len > CONFIG_BUF.len() {
                return -1;
            }
            if let Ok(json_str) = std::str::from_utf8(&CONFIG_BUF[..len]) {
                if w.apply_config_json(json_str).is_ok() {
                    return 0;
                }
                return -2;
            }
            return -3;
        }
        -4
    }
}

/// 直接从线性内存指针和长度应用 Config JSON
#[no_mangle]
pub extern "C" fn world_set_config(ptr: u32, len: u32) -> i32 {
    unsafe {
        if let Some(w) = WORLD.as_mut() {
            let slice = std::slice::from_raw_parts(ptr as *const u8, len as usize);
            if let Ok(json_str) = std::str::from_utf8(slice) {
                if w.apply_config_json(json_str).is_ok() {
                    return 0;
                }
                return -2;
            }
            return -3;
        }
        -4
    }
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

/// 设置某类 POI 再生倍率 (0=水 1=果 2=木 3=石 4=金)
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

// ═══════════════════════════════════════════════════════════════
// 读档 / 存档导出（v1.7.0）
//
// 沿用现有「线性内存 JSON 缓冲区」约定：
//   导出：world_save_ptr() → 取指针，world_save_len() → 取长度，从 memory.buffer 读字节
//   导入：world_save_buf_ptr(len) → 取可写指针，JS 写入字节，world_load(len) → 应用
// 失败原因通过 world_last_error_ptr/len 读取（成功时长度为 0）。
// ═══════════════════════════════════════════════════════════════

/// 将当前世界全量状态序列化为存档 JSON 写入内部缓冲，返回缓冲起始指针。
/// 失败时缓冲清空（world_save_len() 返回 0），原因见 world_last_error_*。
#[no_mangle]
pub extern "C" fn world_save_ptr() -> u32 {
    unsafe {
        SAVE_BUF = match WORLD.as_ref() {
            Some(w) => match serialize_save(w) {
                Ok(json) => {
                    clear_error();
                    json.into_bytes()
                }
                Err(e) => {
                    set_error(&e);
                    Vec::new()
                }
            },
            None => {
                set_error("世界尚未初始化，无法存档");
                Vec::new()
            }
        };
        SAVE_BUF.as_ptr() as u32
    }
}

/// 返回存档 JSON 字节长度（0 表示上一次存档失败）
#[no_mangle]
pub extern "C" fn world_save_len() -> u32 {
    unsafe { SAVE_BUF.len() as u32 }
}

/// 准备写入存档 JSON 的内部缓冲区，返回起始指针
#[no_mangle]
pub extern "C" fn world_save_buf_ptr(len: u32) -> u32 {
    unsafe {
        SAVE_BUF.resize(len as usize, 0);
        SAVE_BUF.as_mut_ptr() as u32
    }
}

/// 解析并加载内部缓冲区中的存档 JSON（覆盖当前世界）
///
/// 返回值：0 成功 / -1 长度越界 / -2 UTF-8 解码失败 / -3 解析或校验失败（含版本不兼容）
#[no_mangle]
pub extern "C" fn world_load(len: u32) -> i32 {
    unsafe {
        let len = len as usize;
        if len > SAVE_BUF.len() {
            set_error("存档长度越界");
            return -1;
        }
        let json_str = match std::str::from_utf8(&SAVE_BUF[..len]) {
            Ok(s) => s,
            Err(_) => {
                set_error("存档不是合法 UTF-8 文本");
                return -2;
            }
        };
        match deserialize_save(json_str) {
            Ok(world) => {
                WORLD = Some(world);
                clear_error();
                0
            }
            Err(e) => {
                set_error(&e);
                -3
            }
        }
    }
}

/// 返回最近一次存档/读档错误文本指针（长度为 0 表示无错误）
#[no_mangle]
pub extern "C" fn world_last_error_ptr() -> u32 {
    unsafe { ERROR_BUF.as_ptr() as u32 }
}

/// 返回最近一次存档/读档错误文本字节长度
#[no_mangle]
pub extern "C" fn world_last_error_len() -> u32 {
    unsafe { ERROR_BUF.len() as u32 }
}
