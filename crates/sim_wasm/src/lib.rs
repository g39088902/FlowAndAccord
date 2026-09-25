//! sim_wasm — 将 sim_core 编译为 wasm32-unknown-unknown 的零依赖桥接模块
//!
//! 前端通过 `WebAssembly.instantiate` 加载本模块，调用导出函数推进确定性仿真，
//! 并从 wasm 线性内存读取 FABS 二进制快照（不依赖 wasm-bindgen）。
//! 所有导出均为 extern "C"，AOT 可解析；world_create 的 seed 参数保证可复现。

use sim_core::config::SimConfig;
use sim_core::geo::{TerrainStaticKey, VoxelBackend};
use sim_core::geo::procedural::ChunkCoord;
use sim_core::spatial::{deserialize_save, serialize_save, World3DEngine};

static mut WORLD: Option<World3DEngine> = None;
static mut ACTIVE_CONFIG: Option<SimConfig> = None;
/// ★ M4 二进制快照缓冲（FABS 帧，由 world_snapshot_bin_ptr 写入 / world_snapshot_bin_len 读取）
static mut SNAPSHOT_BIN_BUF: Vec<u8> = Vec::new();
/// ★ M4 枚举名称表 JSON 缓冲（由 world_enum_table_ptr/len 读取，前端启动时取一次）
static mut ENUM_TABLE_BUF: Vec<u8> = Vec::new();
static mut CONFIG_BUF: Vec<u8> = Vec::new();
/// 存档 JSON 缓冲（world_save_ptr 写入 / world_load 读取）
static mut SAVE_BUF: Vec<u8> = Vec::new();
/// 最近一次存档/读档失败原因（UTF-8 文本，供前端提示，成功时清空）
static mut ERROR_BUF: Vec<u8> = Vec::new();
/// UGC-05 static terrain identity JSON buffer.
static mut TERRAIN_KEY_BUF: Vec<u8> = Vec::new();
/// UGC-05 explicitly requested voxel chunk packet.
static mut TERRAIN_CHUNK_BUF: Vec<u8> = Vec::new();
/// Lazily built voxel backend. It is invalidated whenever WORLD is replaced.
static mut TERRAIN_VOXEL_BACKEND: Option<VoxelBackend> = None;
static mut TERRAIN_VOXEL_SCALE: f32 = 0.0;

/// 记录最近一次错误文本（成功路径调用 clear_error）
fn set_error(msg: &str) {
    unsafe {
        ERROR_BUF = msg.as_bytes().to_vec();
    }
}

fn clear_error() {
    unsafe {
        ERROR_BUF.clear();
    }
}

fn clear_terrain_backend_cache() {
    unsafe {
        TERRAIN_KEY_BUF.clear();
        TERRAIN_CHUNK_BUF.clear();
        TERRAIN_VOXEL_BACKEND = None;
        TERRAIN_VOXEL_SCALE = 0.0;
    }
}

fn ensure_terrain_backend(voxel_scale: f32) -> Result<(), String> {
    unsafe {
        if TERRAIN_VOXEL_BACKEND.is_some()
            && TERRAIN_VOXEL_SCALE.to_bits() == voxel_scale.to_bits()
        {
            return Ok(());
        }
        let terrain = WORLD
            .as_ref()
            .map(|world| world.terrain.clone())
            .ok_or_else(|| "世界尚未初始化，无法读取地形 chunk".to_string())?;
        let deltas = WORLD
            .as_ref()
            .map(|world| world.terrain_chunk_deltas.clone())
            .unwrap_or_default();
        let mut backend = VoxelBackend::from_terrain_map_lazy(&terrain, voxel_scale)
            .map_err(|error| format!("地形 voxel 后端构建失败：{:?}", error))?;
        for delta in &deltas {
            backend
                .apply_delta(delta)
                .map_err(|error| format!("地形 chunk delta 校验失败：{:?}", error))?;
        }
        TERRAIN_VOXEL_BACKEND = Some(backend);
        TERRAIN_VOXEL_SCALE = voxel_scale;
        Ok(())
    }
}

/// 地形栅格分辨率兜底值（每边格数）。仅当配置既未注入、调用方又传 0 时生效，
/// 保证 `SimConfig::default()`（`terrain_grid_res = 0`）场景下也能建出合法世界。
/// ★ v1.50.70：随前端 `terrainGridRes` 默认值 160 → 256 同步（两处必须保持一致，
/// 否则未注入配置的工具会静默生成旧分辨率世界，造成两套确定性基线漂移）。
const TERRAIN_GRID_RES_FALLBACK: usize = 256;

/// 解析实际生效的地形栅格分辨率：调用方传非 0 值则显式覆盖（仅供测试参数化），
/// 否则回落到 `SimConfig::terrain_grid_res`，使配置成为全项目分辨率的单一真相源。
fn resolve_grid_res(grid_res: u32, config: &SimConfig) -> usize {
    if grid_res > 0 {
        grid_res as usize
    } else if config.terrain_grid_res > 0 {
        config.terrain_grid_res
    } else {
        TERRAIN_GRID_RES_FALLBACK
    }
}

/// 创建世界并注入初始生态 (grid_res=0 表示按配置 terrain_grid_res，world_size=764, seed 可复现，agent_count=20)
/// 优先使用前端通过 world_apply_config_buf 注入的持久配置 ACTIVE_CONFIG。
/// camp_count: 若显式传入 > 0 则覆盖配置中的 count_camps。
///
/// ★ STAGE2-5：走有界降级构造器（几何/路网/生存门禁 + §5.8 阶梯降级），
/// 初始化彻底失败时返回 1（原因见 `world_last_error_ptr/len`）且**不替换**
/// 既有世界；成功返回 0。
#[no_mangle]
pub extern "C" fn world_create(
    grid_res: u32,
    world_size: f32,
    seed: f64,
    agent_count: u32,
    camp_count: u32,
) -> i32 {
    unsafe {
        let config = ACTIVE_CONFIG.as_ref().cloned().unwrap_or_default();
        let result = World3DEngine::new_seeded_with_config_bounded(
            resolve_grid_res(grid_res, &config),
            world_size,
            seed as u64,
            config,
            &mut |w: &mut World3DEngine| {
                if camp_count > 0 {
                    w.config.count_camps = camp_count as usize;
                }
                w.seed_primitive_ecology(agent_count as usize);
            },
        );
        match result {
            Ok(w) => {
                WORLD = Some(w);
                clear_terrain_backend_cache();
                clear_error();
                0
            }
            Err(diag) => {
                set_error(&diag.summary());
                1
            }
        }
    }
}

/// 创建仅含地貌的只读世界：复用正式游戏相同的确定性地形生成链路，但不播撒
/// POI、Agent、房屋或路网。供地图图鉴调用，不能用于推进或存档。
#[no_mangle]
pub extern "C" fn world_create_map(grid_res: u32, world_size: f32, seed: f64) -> i32 {
    unsafe {
        let config = ACTIVE_CONFIG.as_ref().cloned().unwrap_or_default();
        WORLD = Some(World3DEngine::new_seeded_with_config(
            resolve_grid_res(grid_res, &config),
            world_size,
            seed as u64,
            config,
        ));
        clear_terrain_backend_cache();
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
/// 无论世界是否已创建，均持久保存至 ACTIVE_CONFIG，确保后续 world_create 始终复用最新配置。
#[no_mangle]
pub extern "C" fn world_apply_config_buf(len: u32) -> i32 {
    unsafe {
        let len = len as usize;
        if len > CONFIG_BUF.len() {
            return -1;
        }
        let json_str = match std::str::from_utf8(&CONFIG_BUF[..len]) {
            Ok(s) => s,
            Err(_) => return -3,
        };

        match serde_json::from_str::<SimConfig>(json_str) {
            Ok(cfg) => {
                if let Some(w) = WORLD.as_mut() {
                    let _ = w.apply_config(cfg.clone());
                }
                ACTIVE_CONFIG = Some(cfg);
                0
            }
            Err(_) => -2,
        }
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

/// 执行特定子阶段（用于性能基准分析 profile-benchmark，phase_idx 0~8）
#[no_mangle]
pub extern "C" fn world_tick_subphase(phase_idx: u32, dt: f32) {
    unsafe {
        if let Some(w) = WORLD.as_mut() {
            w.tick_subphase(phase_idx, dt);
        }
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

// ═══════════════════════════════════════════════════════════════
// ★ M4 快照零拷贝扁平二进制缓冲（FABS 帧，v1.45.0）
//
// 快照只有这一条通道（原 JSON 通道已于 v1.50.35 彻底移除）：输出一个**只读**
// 的自描述二进制帧，前端 `sim_worker.js::pullSnapshotBin` 直接读取。
// 全程只读内核状态，不消耗 WorldRng。
// 实现见 crates/sim_core/src/spatial/snapshot_bin/。
// ═══════════════════════════════════════════════════════════════

/// 编码当前世界 FABS 二进制帧到内部缓冲，返回起始指针（配合 world_snapshot_bin_len 读取）。
/// 帧内含有 LANE_GEO/NODE/TERRAIN 的**增量判定**：仅在地形脏位或路网拓扑签名变化时输出。
#[no_mangle]
pub extern "C" fn world_snapshot_bin_ptr() -> u32 {
    unsafe {
        if let Some(w) = WORLD.as_ref() {
            w.write_snapshot_binary(&mut SNAPSHOT_BIN_BUF);
        }
        SNAPSHOT_BIN_BUF.as_ptr() as u32
    }
}

/// 返回二进制快照帧字节长度
#[no_mangle]
pub extern "C" fn world_snapshot_bin_len() -> u32 {
    unsafe { SNAPSHOT_BIN_BUF.len() as u32 }
}

/// 返回枚举名称表 JSON 起始指针（懒生成并缓存；前端 INIT 时取一次，杜绝前后端枚举漂移）
#[no_mangle]
pub extern "C" fn world_enum_table_ptr() -> u32 {
    unsafe {
        if ENUM_TABLE_BUF.is_empty() {
            ENUM_TABLE_BUF = sim_core::spatial::snapshot_bin::enum_table_json().into_bytes();
        }
        ENUM_TABLE_BUF.as_ptr() as u32
    }
}

/// 返回枚举名称表 JSON 字节长度
#[no_mangle]
pub extern "C" fn world_enum_table_len() -> u32 {
    unsafe { ENUM_TABLE_BUF.len() as u32 }
}

/// 强制下一帧快照输出完整地形网格 (例如初始化或前端重新加载时调用)
///
/// ★ M4：同时重置路网几何增量缓存（`require_full_geometry`），保证二进制通道
/// 在下帧重发 LANE_GEO/NODE——前端 REQUIRE_TERRAIN 的语义就是"把全部静态几何重发一遍"。
#[no_mangle]
pub extern "C" fn world_require_terrain() {
    unsafe {
        if let Some(w) = WORLD.as_ref() {
            w.require_full_geometry();
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// UGC-05 静态地形键与 voxel chunk 请求
//
// 这些接口只在调用方明确请求时执行；不进入 tick，也不写入 FABS 帧。
// `world_terrain_chunk_request` 的结果是拥有独立线性内存的 FAVX 数据包，
// 前端可以直接转移给 Worker/渲染缓存。
// ═══════════════════════════════════════════════════════════════

/// 将当前静态地形键编码为 JSON，返回起始指针。
#[no_mangle]
pub extern "C" fn world_terrain_key_ptr() -> u32 {
    unsafe {
        TERRAIN_KEY_BUF = match WORLD.as_ref() {
            Some(world) => {
                clear_error();
                serde_json::to_vec(&TerrainStaticKey::from_terrain_map(&world.terrain))
                    .unwrap_or_default()
            }
            None => {
                set_error("世界尚未初始化，无法读取静态地形键");
                Vec::new()
            }
        };
        TERRAIN_KEY_BUF.as_ptr() as u32
    }
}

/// 返回静态地形键 JSON 长度。
#[no_mangle]
pub extern "C" fn world_terrain_key_len() -> u32 {
    unsafe { TERRAIN_KEY_BUF.len() as u32 }
}

/// Design-document spelling kept as a thin alias for non-World consumers.
#[no_mangle]
pub extern "C" fn terrain_static_key_ptr() -> u32 {
    world_terrain_key_ptr()
}

#[no_mangle]
pub extern "C" fn terrain_static_key_len() -> u32 {
    world_terrain_key_len()
}

/// 请求一个静态 voxel chunk。坐标是非负 chunk 坐标，scale 为米/体素。
/// 返回值：0 成功，-1 未初始化，-2 参数非法，-3 后端构建失败，-4 chunk 不存在。
#[no_mangle]
pub extern "C" fn world_terrain_chunk_request(
    chunk_x: i32,
    chunk_y: i32,
    chunk_z: i32,
    voxel_scale: f32,
) -> i32 {
    unsafe {
        TERRAIN_CHUNK_BUF.clear();
        if WORLD.is_none() {
            set_error("世界尚未初始化，无法读取地形 chunk");
            return -1;
        }
        if chunk_x < 0
            || chunk_y < 0
            || chunk_z < 0
            || !voxel_scale.is_finite()
            || voxel_scale <= 0.0
        {
            set_error("地形 chunk 请求参数非法");
            return -2;
        }
        if let Err(error) = ensure_terrain_backend(voxel_scale) {
            set_error(&error);
            return -3;
        }
        let coord = ChunkCoord {
            x: chunk_x,
            y: chunk_y,
            z: chunk_z,
        };
        let result = TERRAIN_VOXEL_BACKEND
            .as_mut()
            .ok_or_else(|| "地形 voxel 后端未就绪".to_string())
            .and_then(|backend| {
                backend
                    .encode_chunk(coord, &mut TERRAIN_CHUNK_BUF)
                    .map_err(|error| format!("地形 chunk 不存在：{:?}", error))
            });
        match result {
            Ok(()) => {
                clear_error();
                0
            }
            Err(error) => {
                TERRAIN_CHUNK_BUF.clear();
                set_error(&error);
                -4
            }
        }
    }
}

/// 返回最近一次成功 chunk 请求的数据包指针。
#[no_mangle]
pub extern "C" fn world_terrain_chunk_ptr() -> u32 {
    unsafe { TERRAIN_CHUNK_BUF.as_ptr() as u32 }
}

/// 返回最近一次成功 chunk 请求的数据包长度。
#[no_mangle]
pub extern "C" fn world_terrain_chunk_len() -> u32 {
    unsafe { TERRAIN_CHUNK_BUF.len() as u32 }
}

/// Design-document spelling: request a chunk by integer LOD. LOD 0 uses the
/// default 4 m voxel scale and each subsequent level doubles that scale.
#[no_mangle]
pub extern "C" fn terrain_chunk_request(
    chunk_x: i32,
    chunk_y: i32,
    chunk_z: i32,
    lod: u32,
) -> i32 {
    if lod > 8 {
        set_error("地形 chunk LOD 超出范围");
        return -2;
    }
    let voxel_scale = 4.0 * (1u32 << lod) as f32;
    world_terrain_chunk_request(chunk_x, chunk_y, chunk_z, voxel_scale)
}

#[no_mangle]
pub extern "C" fn terrain_chunk_read() -> u32 {
    world_terrain_chunk_ptr()
}

#[no_mangle]
pub extern "C" fn terrain_chunk_read_len() -> u32 {
    world_terrain_chunk_len()
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
                clear_terrain_backend_cache();
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

/// 返回内核应用版本号字符串指针
#[no_mangle]
pub extern "C" fn world_app_version_ptr() -> u32 {
    sim_core::spatial::SAVE_APP_VERSION.as_ptr() as u32
}

/// 返回内核应用版本号字符串长度
#[no_mangle]
pub extern "C" fn world_app_version_len() -> u32 {
    sim_core::spatial::SAVE_APP_VERSION.len() as u32
}
