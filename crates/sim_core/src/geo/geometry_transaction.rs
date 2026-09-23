//! 第 5 步完整几何事务。整图隔离包含任意支撑域和差分 halo；不依赖锚点哨兵。
//! 未提交的候选离开作用域即丢弃，原始地形、计划和 scratch 从未被修改。
use super::biome::{SurfaceKind, TERRAIN_FLAG_NO_BUILD, TERRAIN_FLAG_NO_WALK};
use super::terrain::{
    GenesisScratch, PlannedSubFeature, TerrainMap, TerrainSubFeatureKind,
};

/// 第 5 步登记意图，第 5c/6 步通过同一实现物化。flags 只叠加，不能取消禁行。
#[derive(Clone)]
pub(super) struct SurfaceOverlay {
    pub cell_index: usize,
    pub surface_kind: SurfaceKind,
    pub water_body_id: Option<u32>,
    pub natural_fertility: f32,
    pub flags: u16,
}

pub(super) fn apply_surface_overlays(terrain: &mut TerrainMap, scratch: &GenesisScratch) {
    for overlay in &scratch.surface_overlays {
        let cell = &mut terrain.cells[overlay.cell_index];
        // 既有水系地表优先，不允许陆地意图抹掉主河/浅滩。
        let existing_water = matches!(cell.surface_kind, SurfaceKind::DeepWater
            | SurfaceKind::ShallowWater | SurfaceKind::RiverBank | SurfaceKind::RiverTerrace);
        let incoming_water = matches!(overlay.surface_kind, SurfaceKind::DeepWater
            | SurfaceKind::ShallowWater | SurfaceKind::RiverBank | SurfaceKind::RiverTerrace);
        if !existing_water || incoming_water {
            cell.surface_kind = overlay.surface_kind;
            cell.water_body_id = overlay.water_body_id;
            cell.natural_fertility = overlay.natural_fertility;
        }
        cell.feature_flags |= overlay.flags;
        if matches!(cell.surface_kind, SurfaceKind::DeepWater | SurfaceKind::ShallowWater) {
            cell.feature_flags |= TERRAIN_FLAG_NO_BUILD;
        }
        if cell.surface_kind.is_hard_blocked() {
            cell.feature_flags |= TERRAIN_FLAG_NO_WALK | TERRAIN_FLAG_NO_BUILD;
        }
    }
}

impl TerrainMap {
    /// apply 只修改候选高程/几何/意图；读取原高程使用不可变 baseline，避免遍历反馈。
    /// Ok(false) 表示未实施；Err 表示局部拒绝。两者均丢弃全部候选状态且不重抽。
    /// validate 读取定稿预览（包含整图 halo），不得读取候选中尚未定稿的 slope/flags。
    pub(super) fn geometry_transaction(
        &mut self,
        scratch: &mut GenesisScratch,
        plan: &mut PlannedSubFeature,
        apply: impl FnOnce(&TerrainMap, &mut TerrainMap, &mut GenesisScratch,
            &mut PlannedSubFeature) -> Result<bool, &'static str>,
        validate: impl FnOnce(&TerrainMap, &PlannedSubFeature) -> Result<(), &'static str>,
    ) -> Result<bool, &'static str> {
        // Clone 整个值而非手列字段：features/hydrology/中心线/ID 绑定与将来新增字段
        // 自动进入事务域；单次创世最多两个候选，未持有世界 RNG 或外部可变引用。
        let mut candidate = self.clone();
        let mut pending = scratch.clone();
        let mut planned = plan.clone();
        if !apply(self, &mut candidate, &mut pending, &mut planned)? {
            return Ok(false);
        }
        if candidate.grid_width != self.grid_width || candidate.grid_height != self.grid_height
            || candidate.cells.len() != self.cells.len()
            || candidate.world_size.to_bits() != self.world_size.to_bits()
            || candidate.seed != self.seed
            || candidate.profile != self.profile
            || candidate.generator_version != self.generator_version
            || candidate.tilt_angle_rad.to_bits() != self.tilt_angle_rad.to_bits()
            || candidate.tilt_magnitude.to_bits() != self.tilt_magnitude.to_bits()
        {
            return Err("SubFeatureGridChanged");
        }
        if planned.kind != plan.kind || planned.salt != plan.salt {
            return Err("SubFeatureIdentityChanged");
        }
        // 施加阶段不得偷写派生地表；正式写点仍只有第 6 步。
        for (before, after) in self.cells.iter().zip(&candidate.cells) {
            if !after.elevation.is_finite() {
                return Err("SubFeatureElevationInvalid");
            }
            if before.slope_angle_deg.to_bits() != after.slope_angle_deg.to_bits()
                || before.surface_kind != after.surface_kind
                || before.feature_flags != after.feature_flags
                || before.water_body_id != after.water_body_id
                || before.natural_fertility.to_bits() != after.natural_fertility.to_bits()
            {
                return Err("SubFeatureSurfaceWrittenEarly");
            }
        }
        if (!pending.soft_ring.is_empty() && pending.soft_ring.len() != candidate.cells.len())
            || pending.surface_overlays.iter().any(|o| o.cell_index >= candidate.cells.len()
                || !o.natural_fertility.is_finite() || !(0.0..=1.0).contains(&o.natural_fertility))
        {
            return Err("SubFeatureSurfaceIntentInvalid");
        }
        let mut preview = candidate.clone();
        preview.finalize_slope_and_surface(&pending);
        preview.validate_static_terrain_geometry()?;
        validate(&preview, &planned)?;
        planned.accepted = true;
        // 提交原始几何及意图，不提交 preview 的派生格。此处之后没有可失败操作。
        *self = candidate;
        *scratch = pending;
        *plan = planned;
        Ok(true)
    }

    pub(super) fn apply_subfeature_pipeline(
        &mut self, plan: &mut [PlannedSubFeature], scratch: &mut GenesisScratch,
    ) {
        let mut order: Vec<usize> = (0..plan.len()).collect();
        order.sort_by_key(|&i| plan[i].kind as u32);
        for i in order {
            match plan[i].kind {
                // ★ 阶段三 D-B2（06 号 §5.4.D）：RiverCliff 河谷峭壁注入器。
                //   几何施加 + 局部判定（硬禁行 70% 连续带 / 连通分量不增加 /
                //   取水点圆保护）在事务内完成；Err 局部拒绝整块回滚、不重抽。
                TerrainSubFeatureKind::RiverCliff => {
                    let _ = self.geometry_transaction(scratch, &mut plan[i],
                        super::hydrology::apply_river_cliff, |_, _| Ok(()));
                }
                // ★ 八b D-B2（06 号 §5.4.C）：OxbowLake 牛轭湖注入器。
                //   裁弯取直 + 月牙湖 + 上游回填，事务内完成；失败回滚判未注入。
                TerrainSubFeatureKind::OxbowLake => {
                    let _ = self.geometry_transaction(scratch, &mut plan[i],
                        super::hydrology::apply_oxbow_lake, |_, _| Ok(()));
                }
                // 其余 kind 仍为空注入：结构型（FootLake/RidgeWaterfall）
                // 待各自实施；视觉型无几何、走第 9 步装饰。Ok(false) 不把
                // “选中”误报为“接受”；disabled_mask 已在进入此管线前过滤。
                _ => {
                    let structural = plan[i].kind.is_structural();
                    let _ = self.geometry_transaction(scratch, &mut plan[i],
                        move |_, _, _, _| Ok(!structural), |_, _| Ok(()));
                }
            }
        }
    }
}
