//! creation_fallback.rs · STAGE2-5 世界初始化事务与有界降级集成（06 号 §5.8）。
//!
//! 由世界初始化入口 [`World3DEngine::new_seeded_with_config_bounded`] 包住完整
//! 生成链：每次创建**独立候选世界**（同 seed、冻结配置、全新局部状态），全部
//! 门禁（静态几何校验 → 路网读档校验 → STAGE2-6 生存诊断）通过后才发布。
//!
//! 降级阶梯（§5.8「物理失败降级」，每步必须产生不同的
//! `(effective_profile, disabled_mask, disable_spurs)`）：
//! 1. 禁用已接受的结构子特征（`disabled_mask`；阶段二注入器为空 ⇒ 无结构
//!    特征时跳过本步，不重复尝试相同世界）；
//! 2. 移除可选支脊（仅山口 profile 且开关仍开启时可用）；
//! 3. 使用已验收的显式简化基线 `flat_baseline`（STAGE2-7）。
//!
//! 隔离与复现契约：失败候选的 RNG、计数器、POI、路网与缓存随候选整体丢弃，
//! 不污染最终模拟 RNG；同策略同 seed 必然复现（候选构造是纯函数式重建）。
//! 预算：`terrainGenerationMaxRetries` = 首次尝试之外的最多重试次数
//! （0 = 只尝试一次），创建入口钳制至最多 8；0、预算耗尽、无新策略均明确
//! 结束并返回 [`WorldCreationDiagnostic`]。
//!
//! ⚠️ 局部拒绝（几何事务撤销单个子特征、不触发完整重试）属第 5 步几何事务
//! 域，随阶段三注入启用；本模块只处理世界级失败的完整重试。

use super::world::World3DEngine;
use crate::config::SimConfig;
use crate::geo::terrain::{
    TERRAIN_PROFILE_FLAT_BASELINE, TERRAIN_GENERATOR_VERSION, TERRAIN_PROFILE_MOUNTAIN_PASS,
};

/// 结构子特征掩码位（`1 << TerrainSubFeatureKind as u32`）。
/// 阶段二注入器为空，本掩码随阶段三注入启用后才有物理效果。
pub const STRUCTURAL_SUBFEATURE_MASK: u32 = (1 << 0) // FootLake
    | (1 << 1) // RidgeWaterfall
    | (1 << 4) // OxbowLake
    | (1 << 5); // RiverCliff

/// 单个降级策略候选键：`(effective_profile, disabled_mask, disable_spurs)`。
/// 相同键不重复尝试（§5.8 策略去重）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenesisStrategy {
    pub effective_profile: String,
    pub disabled_mask: u32,
    pub disable_spurs: bool,
}

impl GenesisStrategy {
    fn key(&self) -> (String, u32, bool) {
        (
            self.effective_profile.clone(),
            self.disabled_mask,
            self.disable_spurs,
        )
    }

    /// 将策略施加到候选配置（每次都从冻结的基础配置克隆后施加，不累积）。
    fn apply(&self, cfg: &mut SimConfig) {
        cfg.terrain_profile = self.effective_profile.clone();
        if self.disable_spurs {
            cfg.terrain_branch_ridge_enabled = false;
        }
    }

    /// 失败后的下一个策略（§5.8 阶梯）。`facts` 来自**失败候选**的实际状态；
    /// 无新策略时返回 `None`。
    fn next(&self, facts: &StrategyFacts) -> Option<GenesisStrategy> {
        // 1. 已注入结构子特征 → 禁用全部结构子特征（掩码内其余位不变）。
        if facts.has_structural_sub_features {
            return Some(GenesisStrategy {
                effective_profile: self.effective_profile.clone(),
                disabled_mask: self.disabled_mask | STRUCTURAL_SUBFEATURE_MASK,
                disable_spurs: self.disable_spurs,
            });
        }
        // 2. 支脊仍开启（山口 profile）→ 移除可选支脊。
        if facts.spurs_active {
            return Some(GenesisStrategy {
                effective_profile: self.effective_profile.clone(),
                disabled_mask: self.disabled_mask,
                disable_spurs: true,
            });
        }
        // 3. 尚非基线 → 使用显式简化基线（掩码归零：基线无子特征可禁用）。
        if !facts.is_baseline {
            return Some(GenesisStrategy {
                effective_profile: TERRAIN_PROFILE_FLAT_BASELINE.to_string(),
                disabled_mask: 0,
                disable_spurs: false,
            });
        }
        None
    }
}

/// 失败候选的策略事实（决定阶梯走向）。
struct StrategyFacts {
    /// 候选已注入结构子特征（阶段二注入器为空 ⇒ 恒 false）。
    has_structural_sub_features: bool,
    /// 候选生成时支脊仍开启（山口 profile 且开关开启）。
    spurs_active: bool,
    /// 候选已是 `flat_baseline`（阶梯尽头）。
    is_baseline: bool,
}

/// 单次尝试记录（§5.8 诊断记录字段：attempt/disabled_mask/disable_spurs/
/// failure_code；effective_profile 取候选实际解析后的 profile）。
#[derive(Debug, Clone)]
pub struct AttemptRecord {
    /// 0 起的尝试序号（含最终成功那次）。
    pub attempt: usize,
    pub effective_profile: String,
    pub disabled_mask: u32,
    pub disable_spurs: bool,
    /// `None` = 该次通过全部门禁并发布。
    pub failure_code: Option<String>,
}

/// 创世诊断记录（§5.8：seed/requested/effective/generator_version/attempt/
/// disabled_mask/disable_spurs/failure_code + 首次失败与最终结果）。
/// 附着于发布成功的 [`World3DEngine::creation_diagnostic`]；全部尝试耗尽时
/// 作为有界构造器的 Err 载荷返回（不附着任何世界）。
#[derive(Debug, Clone)]
pub struct WorldCreationDiagnostic {
    pub seed: u64,
    pub requested_profile: String,
    pub effective_profile: String,
    pub generator_version: u32,
    /// true = 经降级后发布（不冒充原模板成功，前端事件流展示降级原因）。
    pub degraded: bool,
    /// 全部失败尝试 + 最终结果（`failure_code: None`）。
    pub attempts: Vec<AttemptRecord>,
    /// `first_try` / `degraded` / `budget_exhausted` / `no_new_strategy` /
    /// `legacy_fallback`。
    pub end_reason: String,
}

impl WorldCreationDiagnostic {
    /// 人类可读摘要（错误通道与事件流共用）。
    pub fn summary(&self) -> String {
        let head = format!(
            "seed {} 请求 profile \"{}\"，实际 \"{}\"（生成器 v{}，{} 次尝试，{}）",
            self.seed,
            self.requested_profile,
            self.effective_profile,
            self.generator_version,
            self.attempts.len(),
            self.end_reason
        );
        let first_failure = self
            .attempts
            .iter()
            .find_map(|a| a.failure_code.as_ref().map(|c| (a.attempt, c)));
        let tail = if self.degraded {
            first_failure
                .map(|(i, c)| format!("；首次失败：尝试 #{} {}", i, c))
                .unwrap_or_default()
        } else {
            String::new()
        };
        format!("{}{}", head, tail)
    }
}

impl World3DEngine {
    /// 有界构造器（★ STAGE2-5 生产入口）：包住完整生成链，按 §5.8 阶梯降级。
    ///
    /// `prepare` 在每个候选上执行「门禁前的世界定制」——生产调用方在此完成
    /// camp_count 覆盖与 `seed_primitive_ecology`（§5.3 第 10 步生态播撒与
    /// 路网构建）；门禁链随后运行。候选失败时连同其 RNG/POI/路网/缓存整体
    /// 丢弃，下一候选从冻结配置重建（同策略同 seed 必然复现）。
    ///
    /// 返回 `Ok(世界)`（全部门禁通过，`creation_diagnostic` 记录全过程）；
    /// 预算耗尽或无新策略时返回 `Err(诊断)`——失败候选全部丢弃，不发布半成品。
    pub fn new_seeded_with_config_bounded(
        grid_res: usize,
        world_size: f32,
        seed: u64,
        config: SimConfig,
        prepare: &mut dyn FnMut(&mut World3DEngine),
    ) -> Result<World3DEngine, WorldCreationDiagnostic> {
        let mut config = config;
        // ★ STAGE2-1：重试预算钳制（0 = 只尝试一次；防失控上限 8）。
        config.terrain_generation_max_retries = config.terrain_generation_max_retries.min(8);
        let budget = config.terrain_generation_max_retries;
        let requested_profile = if config.terrain_profile.is_empty() {
            crate::geo::terrain::TERRAIN_PROFILE_RANDOM.to_string()
        } else {
            config.terrain_profile.clone()
        };

        let make_diag = |effective: &str,
                         attempts: Vec<AttemptRecord>,
                         degraded: bool,
                         end_reason: &str| {
            WorldCreationDiagnostic {
                seed,
                requested_profile: requested_profile.clone(),
                effective_profile: effective.to_string(),
                generator_version: TERRAIN_GENERATOR_VERSION,
                degraded,
                attempts,
                end_reason: end_reason.to_string(),
            }
        };

        let mut strategy = GenesisStrategy {
            effective_profile: requested_profile.clone(),
            disabled_mask: 0,
            disable_spurs: false,
        };
        let mut tried_keys = vec![strategy.key()];
        let mut attempts: Vec<AttemptRecord> = Vec::new();

        loop {
            // 候选隔离：每次从冻结配置克隆 + 策略施加，全新世界状态。
            let mut cand_cfg = config.clone();
            strategy.apply(&mut cand_cfg);
            let mut candidate = Self::build_candidate(
                grid_res,
                world_size,
                seed,
                cand_cfg,
                &crate::geo::terrain::GenesisOverrides {
                    disabled_subfeature_mask: strategy.disabled_mask,
                },
            );
            let effective_before_prepare = candidate.terrain.profile.clone();
            prepare(&mut candidate);
            let effective = candidate.terrain.profile.clone();
            debug_assert_eq!(effective, effective_before_prepare);
            let failure = candidate.run_creation_gates();
            let is_success = failure.is_ok();
            attempts.push(AttemptRecord {
                attempt: attempts.len(),
                effective_profile: effective.clone(),
                disabled_mask: strategy.disabled_mask,
                disable_spurs: strategy.disable_spurs,
                failure_code: failure.err(),
            });

            if is_success {
                let degraded = attempts.len() > 1;
                let mut world = candidate;
                let diag = make_diag(&effective, attempts.clone(), degraded, if degraded { "degraded" } else { "first_try" });
                world.creation_diagnostic = Some(diag);
                if degraded {
                    // 成功降级不冒充原模板成功：事件流明确记录 requested → effective。
                    let first_failure = world
                        .creation_diagnostic
                        .as_ref()
                        .and_then(|d| d.attempts.iter().find_map(|a| a.failure_code.as_ref().map(|c| (a.attempt, c.clone()))));
                    world.last_event = Some(format!(
                        "⚠️ 地形生成降级：请求 {} → 实际 {}（{} 次尝试{}）",
                        requested_profile,
                        effective,
                        attempts.len(),
                        first_failure
                            .map(|(i, c)| format!("，首次失败：尝试 #{} {}", i, c))
                            .unwrap_or_default()
                    ));
                }
                return Ok(world);
            }

            // 预算耗尽（首次之外最多 budget 次）。
            if attempts.len() as u32 >= 1 + budget {
                return Err(make_diag(
                    &effective,
                    attempts.clone(),
                    true,
                    "budget_exhausted",
                ));
            }

            // 按失败候选事实选择下一个尚未尝试的策略。
            let facts = StrategyFacts {
                has_structural_sub_features: !candidate.terrain.sub_features.is_empty(),
                spurs_active: effective == TERRAIN_PROFILE_MOUNTAIN_PASS
                    && candidate.config.terrain_branch_ridge_enabled,
                is_baseline: effective == TERRAIN_PROFILE_FLAT_BASELINE,
            };
            match strategy.next(&facts) {
                Some(next) if !tried_keys.contains(&next.key()) => {
                    tried_keys.push(next.key());
                    strategy = next;
                }
                // 键去重兜底（阶梯本身保证不产生重复键；防御性收口）。
                Some(_) => {
                    return Err(make_diag(&effective, attempts.clone(), true, "no_new_strategy_duplicate"))
                }
                None => return Err(make_diag(&effective, attempts.clone(), true, "no_new_strategy")),
            }
        }
    }

    /// 创世门禁链（§5.3 第 7 步局部几何 → 第 10 步路网 → 第 11 步生存诊断）。
    /// 失败码带稳定前缀（Geometry / RoadNetwork / Survival），供诊断记录与
    /// 将来的降级策略细化消费。
    ///
    /// ⚠️ 路网与生存门禁只在**已播撒生态**的候选上运行（生产路径恒如此）；
    /// 旧兼容入口（`new_seeded_with_config`）产出的纯地形候选没有 POI/路网，
    /// 此时仅做几何门禁——与 v1.50.48 之前的构造行为兼容。
    fn run_creation_gates(&self) -> Result<(), String> {
        self.terrain
            .validate_static_terrain_geometry()
            .map_err(|e| format!("Geometry:{}", e))?;
        if self.pois.is_empty() {
            return Ok(());
        }
        self.validate_terrain_world()
            .map_err(|e| format!("RoadNetwork:{}", e))?;
        let report = self.diagnose_survival();
        if !report.ok {
            let code = report
                .worst_code
                .map(|c| c.as_str())
                .unwrap_or("SurvivalFailed");
            return Err(format!("Survival:{}", code));
        }
        Ok(())
    }
}
