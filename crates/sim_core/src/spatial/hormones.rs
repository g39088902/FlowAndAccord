//! hormones.rs · Agent 神经内分泌调制层状态机 (四轴十一激素系统 P0)
//!
//! 负责维护每名族人的四轴十一激素定长状态、基线合成、线性离散回归及结构化事件脉冲。
//! 严格遵守 AGENTS.md 契约：
//! - 纯确定性运算，不消耗 WorldRng；
//! - 只调制不指挥，P0 阶段不改变既有决策行为；
//! - 所有浮点数值均有限且钳制在配置域内。

use super::agent::Gender;
use crate::config::SimConfig;
use serde::{Deserialize, Serialize};

/// 四轴十一激素定长状态结构
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentHormones {
    // ── 奖赏-情绪轴 ────────────────────────────────────────────────────────
    /// 多巴胺 (DA)：动力与当下奖赏水平 [0.0, 100.0]
    pub dopamine: f32,
    /// DA 奖赏阈值：漂移表达适应/空虚，独立慢衰减 [1.0, 100.0]
    pub dopamine_threshold: f32,
    /// 血清素 (5-HT)：情绪基调与稳定度 [0.0, 100.0]
    pub serotonin: f32,
    /// 内啡肽 (EP)：劳动与跋涉镇痛 [0.0, 100.0]
    pub endorphin: f32,
    /// 催产素 (OT)：信任与人际联结 [0.0, 100.0]
    pub oxytocin: f32,

    // ── 应激轴 ────────────────────────────────────────────────────────────
    /// 皮质醇 (CORT)：头号急性与慢性压力荷尔蒙 [0.0, 100.0]
    pub cortisol: f32,
    /// 肾上腺素 (ADR)：战斗或逃跑急性爆发 [0.0, 100.0]
    pub adrenaline: f32,
    /// 去甲肾上腺素 (NE)：环境警觉与焦虑备货 [0.0, 100.0]
    pub norepinephrine: f32,

    // ── 生殖轴 ────────────────────────────────────────────────────────────
    /// 雄激素 (AND)：竞争胜者效应与求偶活力 [0.0, 100.0]
    pub androgen: f32,
    /// 雌激素 (EST)：女性生育节律与情绪敏感度 [0.0, 100.0]
    pub estrogen: f32,
    /// 孕激素 (PROG)：妊娠维持与孕期镇静 [0.0, 100.0]
    pub progesterone: f32,

    // ── 代谢轴 ────────────────────────────────────────────────────────────
    /// 甲状腺素 (THY)：基础代谢率总闸门 [0.0, 100.0]
    pub thyroxine: f32,

    // ── 慢性状态与计时器 ───────────────────────────────────────────────────
    /// 慢性压力累计器 (高 CORT 持续累加，低 CORT 缓慢消退) [0.0, 100.0]
    pub chronic_stress: f32,
    /// 余韵与崩解计时器 (tick 递减)：
    /// [0] = 内啡肽过劳崩解期
    /// [1] = 肾上腺素事后深度疲劳期
    /// [2] = 产后/流产情绪脆弱期
    pub crash_timers: [u32; 3],

    // ── 内部标记与边界跟踪 ─────────────────────────────────────────────────
    /// 是否已通过合理基线完成初始化（反序列化缺失容错标识，#[serde(default)] 时为 false）
    pub initialized: bool,
    /// 边界跟踪：上一拍随身行囊是否已满（水/粮/木/石任何一项满额）
    pub prev_bag_full: bool,
    /// 边界跟踪：上一拍体力是否已满
    pub prev_stamina_full: bool,
}

impl Default for AgentHormones {
    fn default() -> Self {
        Self {
            dopamine: 0.0,
            dopamine_threshold: 50.0,
            serotonin: 0.0,
            endorphin: 0.0,
            oxytocin: 0.0,
            cortisol: 0.0,
            adrenaline: 0.0,
            norepinephrine: 0.0,
            androgen: 0.0,
            estrogen: 0.0,
            progesterone: 0.0,
            thyroxine: 0.0,
            chronic_stress: 0.0,
            crash_timers: [0; 3],
            initialized: false,
            prev_bag_full: false,
            prev_stamina_full: false,
        }
    }
}

/// 合成后的个体动态基线
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HormoneBaselines {
    pub dopamine: f32,
    pub dopamine_threshold: f32,
    pub serotonin: f32,
    pub endorphin: f32,
    pub oxytocin: f32,
    pub cortisol: f32,
    pub adrenaline: f32,
    pub norepinephrine: f32,
    pub androgen: f32,
    pub estrogen: f32,
    pub progesterone: f32,
    pub thyroxine: f32,
}

impl AgentHormones {
    /// 按性别、年龄及孕程确定性合成个体激素基线
    pub fn synthesize_baselines(
        gender: Gender,
        age: f32,
        is_pregnant: bool,
        config: &SimConfig,
    ) -> HormoneBaselines {
        // 雄激素：成年男性入调制域；随老龄缓慢下滑；女性与幼童保持低水平恒定
        let androgen = match gender {
            Gender::Male if age >= config.agent_adult_age => {
                let decline = ((age - config.agent_adult_age) / 60.0).clamp(0.0, 1.0);
                config.hormone_and_male_baseline
                    - decline
                        * (config.hormone_and_male_baseline
                            - config.hormone_and_female_baseline)
                        * 0.5
            }
            _ => config.hormone_and_female_baseline,
        };

        // 雌激素：育龄期女性入调制域；更年期后衰退；男性与幼童保持低水平恒定
        let estrogen = match gender {
            Gender::Female
                if age >= config.agent_adult_age
                    && age <= config.hormone_est_menopause_age =>
            {
                config.hormone_est_female_baseline
            }
            Gender::Female if age > config.hormone_est_menopause_age => {
                let decline = ((age - config.hormone_est_menopause_age) / 20.0).clamp(0.0, 1.0);
                config.hormone_est_female_baseline
                    - decline
                        * (config.hormone_est_female_baseline
                            - config.hormone_est_other_baseline)
            }
            _ => config.hormone_est_other_baseline,
        };

        // 孕激素：孕期大幅抬升；非孕/男性保持低水平恒定
        let progesterone = if is_pregnant && gender == Gender::Female {
            config.hormone_prog_pregnant_baseline
        } else {
            config.hormone_prog_non_pregnant_baseline
        };

        HormoneBaselines {
            dopamine: config.hormone_da_baseline,
            dopamine_threshold: config.hormone_da_threshold_baseline,
            serotonin: config.hormone_5ht_baseline,
            endorphin: config.hormone_ep_baseline,
            oxytocin: config.hormone_ot_baseline,
            cortisol: config.hormone_cort_baseline,
            adrenaline: config.hormone_adr_baseline,
            norepinephrine: config.hormone_ne_baseline,
            androgen,
            estrogen,
            progesterone,
            thyroxine: config.hormone_thy_baseline,
        }
    }

    /// 使用配置构建初始化的激素状态
    pub fn new_with_config(
        gender: Gender,
        age: f32,
        is_pregnant: bool,
        config: &SimConfig,
    ) -> Self {
        let b = Self::synthesize_baselines(gender, age, is_pregnant, config);
        Self {
            dopamine: b.dopamine,
            dopamine_threshold: b.dopamine_threshold,
            serotonin: b.serotonin,
            endorphin: b.endorphin,
            oxytocin: b.oxytocin,
            cortisol: b.cortisol,
            adrenaline: b.adrenaline,
            norepinephrine: b.norepinephrine,
            androgen: b.androgen,
            estrogen: b.estrogen,
            progesterone: b.progesterone,
            thyroxine: b.thyroxine,
            chronic_stress: 0.0,
            crash_timers: [0; 3],
            initialized: true,
            prev_bag_full: false,
            prev_stamina_full: false,
        }
    }

    /// 若未初始化（如读取缺失字段的旧存档），则基于当前身体状态合成基线初始化
    pub fn initialize_with_config(
        &mut self,
        gender: Gender,
        age: f32,
        is_pregnant: bool,
        config: &SimConfig,
    ) {
        if !self.initialized {
            *self = Self::new_with_config(gender, age, is_pregnant, config);
        }
    }

    /// 离散线性回归与慢性压力演化 (在代谢阶段末尾执行)
    /// level += alpha * (baseline - level), alpha = clamp(decay_rate * dt, 0, 1)
    pub fn tick_regression(
        &mut self,
        dt: f32,
        config: &SimConfig,
        gender: Gender,
        age: f32,
        is_pregnant: bool,
    ) {
        let b = Self::synthesize_baselines(gender, age, is_pregnant, config);

        #[inline]
        fn regress(level: &mut f32, baseline: f32, decay_rate: f32, dt: f32) {
            let alpha = (decay_rate * dt).clamp(0.0, 1.0);
            *level = (*level + alpha * (baseline - *level)).clamp(0.0, 100.0);
        }

        regress(&mut self.dopamine, b.dopamine, config.hormone_da_decay, dt);
        regress(
            &mut self.serotonin,
            b.serotonin,
            config.hormone_5ht_decay,
            dt,
        );
        regress(&mut self.endorphin, b.endorphin, config.hormone_ep_decay, dt);
        regress(&mut self.oxytocin, b.oxytocin, config.hormone_ot_decay, dt);
        regress(&mut self.cortisol, b.cortisol, config.hormone_cort_decay, dt);
        regress(
            &mut self.adrenaline,
            b.adrenaline,
            config.hormone_adr_decay,
            dt,
        );
        regress(
            &mut self.norepinephrine,
            b.norepinephrine,
            config.hormone_ne_decay,
            dt,
        );
        regress(&mut self.androgen, b.androgen, config.hormone_and_decay, dt);
        regress(&mut self.estrogen, b.estrogen, config.hormone_est_decay, dt);
        regress(
            &mut self.progesterone,
            b.progesterone,
            config.hormone_prog_decay,
            dt,
        );
        regress(
            &mut self.thyroxine,
            b.thyroxine,
            config.hormone_thy_decay,
            dt,
        );

        // DA 奖赏阈值慢速回归基线，必须保持正值
        let alpha_th = (config.hormone_da_threshold_decay * dt).clamp(0.0, 1.0);
        self.dopamine_threshold = (self.dopamine_threshold
            + alpha_th * (b.dopamine_threshold - self.dopamine_threshold))
            .clamp(1.0, 100.0);

        // 慢性压力累计
        if self.cortisol > 60.0 {
            self.chronic_stress =
                (self.chronic_stress + (self.cortisol - 60.0) * 0.1 * dt).min(100.0);
        } else if self.cortisol < 40.0 {
            self.chronic_stress = (self.chronic_stress - 0.5 * dt).max(0.0);
        }

        // 余韵计时器每拍递减
        for timer in &mut self.crash_timers {
            *timer = timer.saturating_sub(1);
        }
    }

    #[inline]
    fn add_pulse(val: &mut f32, pulse: f32) {
        *val = (*val + pulse).clamp(0.0, 100.0);
    }

    /// 升级房屋
    pub fn on_upgrade(&mut self, config: &SimConfig) {
        Self::add_pulse(&mut self.dopamine, config.hormone_pulse_upgrade_da);
        let drift = config.hormone_pulse_upgrade_da * config.hormone_da_threshold_drift_ratio;
        self.dopamine_threshold = (self.dopamine_threshold + drift).clamp(1.0, 100.0);
    }

    /// 成婚
    pub fn on_marriage(&mut self, config: &SimConfig) {
        Self::add_pulse(&mut self.dopamine, config.hormone_pulse_marriage_da);
        Self::add_pulse(&mut self.oxytocin, config.hormone_pulse_marriage_ot);
        Self::add_pulse(&mut self.serotonin, config.hormone_pulse_marriage_5ht);
    }

    /// 受孕成功 (女方)
    pub fn on_conception(&mut self, config: &SimConfig) {
        Self::add_pulse(&mut self.progesterone, config.hormone_pulse_conception_prog);
    }

    /// 流产 (女方)
    pub fn on_miscarriage(&mut self, config: &SimConfig) {
        Self::add_pulse(&mut self.cortisol, config.hormone_pulse_miscarriage_cort);
        self.progesterone = config.hormone_prog_non_pregnant_baseline;
        // 产后/流产脆弱窗口 (以 tick 计)
        self.crash_timers[2] = (config.agent_miscarriage_cooldown * 60.0) as u32;
    }

    /// 分娩 (母亲)
    pub fn on_birth_mother(&mut self, config: &SimConfig) {
        Self::add_pulse(&mut self.oxytocin, config.hormone_pulse_birth_mother_ot);
        Self::add_pulse(&mut self.dopamine, config.hormone_pulse_birth_mother_da);
        self.progesterone = config.hormone_prog_non_pregnant_baseline;
        // 产后情绪脆弱窗口
        self.crash_timers[2] = (config.agent_postpartum_cooldown * 60.0) as u32;
    }

    /// 分娩 (父亲)
    pub fn on_birth_father(&mut self, config: &SimConfig) {
        Self::add_pulse(&mut self.oxytocin, config.hormone_pulse_birth_father_ot);
        Self::add_pulse(&mut self.dopamine, config.hormone_pulse_birth_father_da);
    }

    /// 登基为王
    pub fn on_coronation(&mut self, config: &SimConfig) {
        Self::add_pulse(&mut self.dopamine, config.hormone_pulse_coronation_da);
        Self::add_pulse(&mut self.androgen, config.hormone_pulse_coronation_and);
        Self::add_pulse(&mut self.serotonin, config.hormone_pulse_coronation_5ht);
    }

    /// 行囊装满（跨界单次脉冲）
    pub fn on_bag_full(&mut self, config: &SimConfig) {
        Self::add_pulse(&mut self.dopamine, config.hormone_pulse_bag_full_da);
    }

    /// 现场自食/饮水
    pub fn on_meal(&mut self, config: &SimConfig) {
        Self::add_pulse(&mut self.dopamine, config.hormone_pulse_meal_da);
    }

    /// 回家卸货入账
    pub fn on_unload(&mut self, config: &SimConfig) {
        Self::add_pulse(&mut self.dopamine, config.hormone_pulse_unload_da);
    }

    /// 满体力跨界单次脉冲
    pub fn on_full_stamina(&mut self, config: &SimConfig) {
        Self::add_pulse(
            &mut self.serotonin,
            config.hormone_pulse_full_stamina_5ht,
        );
        Self::add_pulse(&mut self.dopamine, config.hormone_pulse_full_stamina_da);
    }

    /// 丧偶
    pub fn on_bereavement_spouse(&mut self, config: &SimConfig) {
        Self::add_pulse(
            &mut self.cortisol,
            config.hormone_pulse_bereavement_spouse_cort,
        );
        self.oxytocin = (self.oxytocin - config.hormone_pulse_bereavement_spouse_ot_crash).max(0.0);
        self.serotonin = (self.serotonin - config.hormone_pulse_bereavement_spouse_5ht_crash).max(0.0);
    }

    /// 丧子
    pub fn on_bereavement_child(&mut self, config: &SimConfig) {
        Self::add_pulse(
            &mut self.cortisol,
            config.hormone_pulse_bereavement_child_cort,
        );
        self.oxytocin = (self.oxytocin - config.hormone_pulse_bereavement_child_ot_crash).max(0.0);
        self.serotonin = (self.serotonin - config.hormone_pulse_bereavement_child_5ht_crash).max(0.0);
    }

    /// 持续性生理与社会输入累加 (每 tick 积分)
    pub fn accumulate_continuous(
        &mut self,
        dt: f32,
        config: &SimConfig,
        hunger: f32,
        thirst: f32,
        cohabiting: bool,
    ) {
        // 饱食良好：血清素提升
        if hunger >= 40.0 && thirst >= 40.0 {
            Self::add_pulse(&mut self.serotonin, config.hormone_rate_well_fed_5ht * dt);
        }
        // 资源短缺 / 饥渴警戒：皮质醇急性累加
        if hunger <= config.decision_critical_hunger
            || thirst <= config.decision_critical_thirst
        {
            Self::add_pulse(&mut self.cortisol, config.hormone_rate_deprivation_cort * dt);
        }
        // 临界自救危机：肾上腺素累加
        if hunger <= config.agent_miscarriage_threshold
            || thirst <= config.agent_miscarriage_threshold
        {
            Self::add_pulse(&mut self.adrenaline, config.hormone_rate_critical_adr * dt);
        }
        // 在宅夫妻共处：催产素与血清素累加
        if cohabiting {
            Self::add_pulse(&mut self.oxytocin, config.hormone_rate_cohabitation_ot * dt);
            Self::add_pulse(&mut self.serotonin, config.hormone_rate_cohabitation_5ht * dt);
        }
    }
}
