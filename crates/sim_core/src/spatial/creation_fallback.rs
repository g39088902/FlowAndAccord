//! creation_fallback.rs · 世界初始化事务（单候选发布，无门禁、无降级）。
//!
//! 由世界初始化入口 [`World3DEngine::new_seeded_with_config_bounded`] 包住完整
//! 生成链：按请求的 profile 构建**单个候选世界**（同 seed、冻结配置、全新局部
//! 状态），执行 `prepare` 钩子后直接发布。**不再运行任何创世门禁，也不存在
//! 降级阶梯**——任何模板（8 个可玩 profile + 2 个图鉴演示 profile）都按请求
//! 原样生成，不会因校验失败回退到 `flat_baseline` 或移除支脊。
//!
//! 历史：STAGE2-5（v1.50.49）曾在此实现有界降级环——每个候选依次过静态几何
//! → 路网 → 生存诊断门禁，失败按 §5.8 阶梯降级（禁结构子特征 → 移除支脊 →
//! `flat_baseline`），预算耗尽或无新策略返回错误；该机制已整体删除。文件名
//! 保留历史命名，避免牵动模块路由与文档索引；相关只读校验服务仍保留在各自
//! 位置、但**不再阻断创世**：
//! - `geo/validation.rs::validate_static_terrain_geometry`（几何事务预览/探针复用）；
//! - `spatial/terrain_network.rs::validate_terrain_world`（读档复核 + 探针 world 模式）；
//! - `spatial/survival_diagnosis.rs::diagnose_survival`（独立只读诊断，创世不再消费）。
//!
//! [`WorldCreationDiagnostic`] 仍附着于发布成功的世界（进程内诊断事实，不入
//! 存档）；由于不存在失败路径，`degraded` 恒为 false、`end_reason` 恒为
//! `first_try`、`attempts` 恒为单条成功记录。

use super::world::World3DEngine;
use crate::config::SimConfig;
use crate::geo::terrain::TERRAIN_GENERATOR_VERSION;

/// 单次尝试记录（§5.8 诊断字段兼容保留：恒 1 条，`failure_code` 恒 `None`）。
#[derive(Debug, Clone)]
pub struct AttemptRecord {
    /// 0 起的尝试序号（恒 0）。
    pub attempt: usize,
    pub effective_profile: String,
    pub disabled_mask: u32,
    pub disable_spurs: bool,
    /// `None` = 该次直接发布（无门禁可失败）。
    pub failure_code: Option<String>,
}

/// 创世诊断记录（seed/requested/effective/generator_version/degraded/
/// attempts/end_reason）。附着于发布成功的 [`World3DEngine::creation_diagnostic`]；
/// 进程内诊断事实，不入存档（存档经 `terrain.profile` 保持有效模板，读档
/// 重建后恒为 None）。
#[derive(Debug, Clone)]
pub struct WorldCreationDiagnostic {
    pub seed: u64,
    pub requested_profile: String,
    pub effective_profile: String,
    pub generator_version: u32,
    /// 恒 false（创世不再降级）。
    pub degraded: bool,
    /// 恒 1 条（`failure_code: None`）。
    pub attempts: Vec<AttemptRecord>,
    /// 恒 `first_try`（历史值 `degraded`/`budget_exhausted`/`no_new_strategy`/
    /// `legacy_fallback` 已随降级阶梯删除）。
    pub end_reason: String,
}

impl WorldCreationDiagnostic {
    /// 人类可读摘要（错误通道与事件流共用）。
    pub fn summary(&self) -> String {
        format!(
            "seed {} 请求 profile \"{}\"，实际 \"{}\"（生成器 v{}，{} 次尝试，{}）",
            self.seed,
            self.requested_profile,
            self.effective_profile,
            self.generator_version,
            self.attempts.len(),
            self.end_reason
        )
    }
}

impl World3DEngine {
    /// 创世入口（★ 生产入口，无门禁无降级）：构建**单个候选世界**（请求的
    /// profile，`disabled_subfeature_mask` 恒 0），执行 `prepare` 钩子后直接
    /// 发布。`prepare` 由生产调用方提供，在此完成 camp_count 覆盖与
    /// `seed_primitive_ecology`（§5.3 第 10 步生态播撒与路网构建）。
    ///
    /// 历史语义变更：STAGE2-5（v1.50.49）曾对每个候选运行
    /// 静态几何 → 路网 → 生存诊断门禁并按 §5.8 阶梯降级（v1.50.49–v1.60.4 间
    /// 先后放宽盆地出口与 field-compiled 模板门禁）；v1.XX 起全部删除，任何
    /// 校验结果都不再阻断或改写创世输出。
    pub fn new_seeded_with_config_bounded(
        grid_res: usize,
        world_size: f32,
        seed: u64,
        config: SimConfig,
        prepare: &mut dyn FnMut(&mut World3DEngine),
    ) -> World3DEngine {
        let requested_profile = if config.terrain_profile.is_empty() {
            crate::geo::terrain::TERRAIN_PROFILE_RANDOM.to_string()
        } else {
            config.terrain_profile.clone()
        };
        let mut world = Self::build_candidate(
            grid_res,
            world_size,
            seed,
            config,
            &crate::geo::terrain::GenesisOverrides::default(),
        );
        let effective_before_prepare = world.terrain.profile.clone();
        prepare(&mut world);
        let effective = world.terrain.profile.clone();
        debug_assert_eq!(effective, effective_before_prepare);
        world.creation_diagnostic = Some(WorldCreationDiagnostic {
            seed,
            requested_profile,
            effective_profile: effective,
            generator_version: TERRAIN_GENERATOR_VERSION,
            degraded: false,
            attempts: vec![AttemptRecord {
                attempt: 0,
                effective_profile: world.terrain.profile.clone(),
                disabled_mask: 0,
                disable_spurs: false,
                failure_code: None,
            }],
            end_reason: "first_try".to_string(),
        });
        world
    }
}
