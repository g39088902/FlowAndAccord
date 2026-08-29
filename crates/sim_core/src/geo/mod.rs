pub mod biome;
pub mod terrain;

pub use biome::{BiomeType, GeoCell};
pub use terrain::TerrainMap;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_terrain_generation_and_sampling() {
        let mut terrain = TerrainMap::new(32, 32, 400.0);
        terrain.generate_natural_landscape(42);

        assert_eq!(terrain.cells.len(), 32 * 32);

        // 采样山地中心高程应显著大于 0
        let (mountain_z, biome) = terrain.sample_elevation_and_biome(-80.0, 80.0);
        assert!(mountain_z > 5.0);

        // 验证溶洞入口存在
        assert!(!terrain.cave_entrances.is_empty());
    }
}
