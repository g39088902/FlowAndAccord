//! 地形创世入口。
//!
//! `TerrainGenerator` 负责把 seed、配置和创世覆盖编译成静态 `TerrainMap`。
//! 生成过程不读取 World3DEngine、Agent、房屋、路网或 tick 状态；游戏运行时
//! 只应通过 `TerrainRuntime` 查询生成结果。`TerrainMap::generate_*` 保留为
//! 旧调用点的兼容壳，新代码不得绕过本模块直接编排创世流程。

use super::procedural::{
    builtin, BackendKind, CompiledTerrain, TerrainCompileError, TerrainRecipe,
};
use super::terrain::{GenesisOverrides, TerrainMap};
use crate::config::SimConfig;

/// 确定性地形生成器。
pub struct TerrainGenerator;

impl TerrainGenerator {
    /// Resolve the legacy random profile partition without constructing the
    /// legacy map. UGC-03 uses this only to select the matching recipe.
    pub fn resolve_profile(seed: u64, profile: &str) -> String {
        super::terrain::resolve_profile(seed, profile)
    }

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

    /// 使用 Field Graph recipe 编译地形字段。旧 profile 入口保持不变，
    /// 因此迁移期间可以逐张地图比较新旧输出。
    pub fn compile_procedural(
        seed: u64,
        recipe: &TerrainRecipe,
        config: &SimConfig,
        backend: BackendKind,
    ) -> Result<CompiledTerrain, TerrainCompileError> {
        super::procedural::compile_terrain(seed, recipe, config, backend)
    }

    /// Compile one of the UGC-03 migrated static profiles into the legacy
    /// `TerrainMap` compatibility view. Unsupported profiles, and profiles
    /// whose Field Graph migration is not yet semantically equivalent, return
    /// `None` so callers can keep the old generator as an explicit reference
    /// path.
    pub fn compile_procedural_map(
        grid_res: usize,
        world_size: f32,
        seed: u64,
        config: &SimConfig,
    ) -> Option<Result<TerrainMap, TerrainCompileError>> {
        // The first UGC-03 fan/basin recipes only described generic radial
        // fields. They did not carry the directional geometry, anchors, exit
        // corridors, or config-driven parameters used by terrain/network
        // gates. Keep each map and its gate on the same specialized
        // implementation until those semantics are represented in the Field
        // Graph.
        if matches!(
            config.terrain_profile.as_str(),
            super::terrain::TERRAIN_PROFILE_ALLUVIAL_FAN
                | super::terrain::TERRAIN_PROFILE_BASIN_OASIS
        ) {
            return None;
        }
        let recipe = builtin(config.terrain_profile.as_str())?;
        Some(
            super::procedural::compile_terrain_with_dimensions(
                seed,
                &recipe,
                grid_res.max(2),
                grid_res.max(2),
                world_size,
                config,
                BackendKind::Heightfield,
            )
            .map(|compiled| super::adapters::terrain_map_from_compiled(&compiled, seed)),
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
