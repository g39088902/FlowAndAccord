//! 地形运行时查询门面。
//!
//! 游戏逻辑只需要查询已生成的地形事实，不应依赖 recipe 名称、生成算子或
//! 体素内部布局。VoxelBackend 接入后，`TerrainRuntime` 会继续保持同一组
//! 顶层查询，并在内部切换高度场或体素实现。

use super::biome::GeoCell;
use super::terrain::TerrainMap;

/// 静态地形的只读运行时视图。
#[derive(Debug, Clone, Copy)]
pub struct TerrainRuntime<'a> {
    terrain: &'a TerrainMap,
}

impl<'a> TerrainRuntime<'a> {
    pub fn new(terrain: &'a TerrainMap) -> Self {
        Self { terrain }
    }

    /// 读取世界坐标处的顶部高程。
    #[inline]
    pub fn sample_elevation(&self, wx: f32, wy: f32) -> f32 {
        self.terrain.sample_elevation(wx, wy)
    }

    /// 读取世界坐标处的顶部地表事实。
    #[inline]
    pub fn sample_cell(&self, wx: f32, wy: f32) -> &'a GeoCell {
        self.terrain.sample_cell(wx, wy)
    }

    /// 读取当前高度场兼容视图；未来可替换为 VoxelBackend 的顶部投影。
    #[inline]
    pub fn as_heightfield(&self) -> &'a TerrainMap {
        self.terrain
    }
}
