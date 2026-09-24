//! 地形创世入口。
//!
//! `TerrainGenerator` 负责把 seed、配置和创世覆盖编译成静态 `TerrainMap`。
//! 生成过程不读取 World3DEngine、Agent、房屋、路网或 tick 状态；游戏运行时
//! 只应通过 `TerrainRuntime` 查询生成结果。`TerrainMap::generate_*` 保留为
//! 旧调用点的兼容壳，新代码不得绕过本模块直接编排创世流程。

use super::terrain::{GenesisOverrides, TerrainMap};
use crate::config::SimConfig;

/// 确定性地形生成器。
pub struct TerrainGenerator;

impl TerrainGenerator {
    /// 使用默认创世覆盖生成一张静态地形。
    pub fn compile(grid_res: usize, world_size: f32, seed: u64, config: &SimConfig) -> TerrainMap {
        Self::compile_with_overrides(
            grid_res,
            world_size,
            seed,
            config,
            &GenesisOverrides::default(),
        )
    }

    /// 使用显式创世覆盖生成一张静态地形。
    ///
    /// 覆盖只允许影响创世候选，不得读取或修改运行时世界状态。
    pub fn compile_with_overrides(
        grid_res: usize,
        world_size: f32,
        seed: u64,
        config: &SimConfig,
        overrides: &GenesisOverrides,
    ) -> TerrainMap {
        let mut terrain = TerrainMap::new(grid_res, grid_res, world_size);
        terrain.generate_with_config_overrides(seed, config, overrides);
        terrain
    }
}
