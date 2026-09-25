//! 地形创世入口。
//!
//! `TerrainGenerator` 负责把 seed、配置和创世覆盖编译成静态 voxel 源及其
//! `TerrainMap` 语义投影。
//! 生成过程不读取 World3DEngine、Agent、房屋、路网或 tick 状态；游戏运行时
//! 只应通过 `TerrainRuntime` 查询生成结果。`TerrainMap::generate_*` 保留为
//! 历史兼容壳，新代码不得绕过本模块直接编排创世流程。

use super::backend::VoxelBackend;
use super::procedural::{
    builtin, flat_baseline_v1, BackendKind, CompiledTerrain, TerrainCompileError, TerrainRecipe,
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

    /// Compile one registered profile into the compatibility map projection.
    /// The projection is fed by a voxel-targeted field compile; the legacy
    /// terrain generator is no longer a production fallback.
    pub fn compile_procedural_map(
        grid_res: usize,
        world_size: f32,
        seed: u64,
        config: &SimConfig,
    ) -> Option<Result<TerrainMap, TerrainCompileError>> {
        let recipe = recipe_for_profile(config.terrain_profile.as_str())?;
        Some(
            super::procedural::compile_terrain_with_dimensions(
                seed,
                &recipe,
                grid_res.max(2),
                grid_res.max(2),
                world_size,
                config,
                BackendKind::Voxel,
            )
            .map(|compiled| {
                let mut map = super::adapters::terrain_map_from_compiled(&compiled, seed);
                map.accents =
                    super::accents::generate_accents(&map, config.terrain_accent_density, seed);
                map
            }),
        )
    }

    /// Compile a profile once and return both the compatibility projection and
    /// the lazy voxel source built from the same `CompiledTerrain`. Keeping the
    /// pair together prevents the world runtime and the chunk API from quietly
    /// rebuilding different terrain representations.
    pub fn compile_voxel_world(
        grid_res: usize,
        world_size: f32,
        seed: u64,
        config: &SimConfig,
    ) -> Option<Result<(TerrainMap, VoxelBackend), TerrainCompileError>> {
        let recipe = recipe_for_profile(config.terrain_profile.as_str())?;
        Some(
            super::procedural::compile_terrain_with_dimensions(
                seed,
                &recipe,
                grid_res.max(2),
                grid_res.max(2),
                world_size,
                config,
                BackendKind::Voxel,
            )
            .and_then(|compiled| {
                let mut map = super::adapters::terrain_map_from_compiled(&compiled, seed);
                map.accents = super::accents::generate_accents(
                    &map,
                    config.terrain_accent_density,
                    seed,
                );
                let backend = VoxelBackend::from_compiled_lazy(&compiled, 4.0)
                    .map_err(|error| TerrainCompileError::Semantic(format!("voxel backend: {error:?}")))?;
                Ok((map, backend))
            }),
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
        let mut voxel_config = config.clone();
        if voxel_config.terrain_profile.is_empty()
            || voxel_config.terrain_profile == super::terrain::TERRAIN_PROFILE_RANDOM
        {
            voxel_config.terrain_profile = Self::resolve_profile(seed, &voxel_config.terrain_profile);
        }
        if recipe_for_profile(voxel_config.terrain_profile.as_str()).is_none() {
            voxel_config.terrain_profile = super::terrain::TERRAIN_PROFILE_FLAT_BASELINE.to_string();
        }
        // Overrides currently affect only legacy structural subfeature planning.
        // Field recipes do not inject those compatibility-only structures, so
        // the same compiled voxel result is valid for every bounded attempt.
        let _ = overrides;
        match Self::compile_voxel_world(grid_res, world_size, seed, &voxel_config) {
            Some(Ok((map, _backend))) => map,
            Some(Err(_)) | None => {
                voxel_config.terrain_profile = super::terrain::TERRAIN_PROFILE_FLAT_BASELINE.to_string();
                Self::compile_voxel_world(grid_res, world_size, seed, &voxel_config)
                    .and_then(Result::ok)
                    .map(|(map, _backend)| map)
                    .expect("flat_baseline voxel recipe must compile")
            }
        }
    }
}

fn recipe_for_profile(profile: &str) -> Option<TerrainRecipe> {
    if profile == super::terrain::TERRAIN_PROFILE_FLAT_BASELINE {
        Some(flat_baseline_v1())
    } else {
        builtin(profile)
    }
}
