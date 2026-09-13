# TB-01 TODO · 多尺度噪声与支脊（打散规则感与重塑山系骨架）

> **任务定义**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §1.2 任务表 TB-01（原代号 M1，详见 §7.2）——**多尺度噪声与支脊：打散规则感、补主脊之外的支脊轮廓；确定性生成 + 版本门禁 + 全图连通校验**。本文件将该任务拆解为标准可执行任务序列（TB-01-1 ～ TB-01-8），编号即建议实施顺序；每项标注出处章节、算法规格、涉及文件与验收方式。
> **状态**：规划态；待实施。现状已具备 T0 基础高程采样、T1 山口聚落 `mountain_pass_v1`（主脊加陡修复，v1.50.17）、T2 两岸河谷与探针工具 `terrain_probe.rs`（生成器版本 `TERRAIN_GENERATOR_VERSION = 4`）。
> **难度**：高（涉及确定性地理内核、无三方依赖 2D 梯度噪声/fBm、主脊域扭曲、支脊几何生成与鞍部避让、坡度/地表属性重映射、连通性保护与存读档版本门禁）。
> **依赖**：无前置依赖，可独立在内核侧推进；完工后作为 TA-09（支脊山口与岩壁河谷场景样板）、TB-02（基座与台地内核 profile）与 TB-04（D-B 子特征注入器）的前置基础。
> **范围纪律**：内核纯物理地形生成改动，**严禁引入浮点非确定性**（禁用 `DefaultHasher`、系统时间与平台相关浮点库）；严格隔离随机数流，支脊生成走独立盐值流（`relief_rng`），不消费共享模拟 RNG；高频噪声必须加高度与区域调制掩码，严禁全图均匀加噪破坏平原生活区；改动改变了高程场与坡度输出，必须升级 `TERRAIN_GENERATOR_VERSION: 4 -> 5` 并重编译 WASM 双副本。遵循根 AGENTS.md §4.10 持久化测试禁令。
> **验收总入口**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §7.2、§11.2；[06-terrain-templates.md](docs/plan/tech/06-terrain-templates.md) §3.2、§9.3.1；探针指标基线（60 种子 `components == 1` 恒成立、可建格 $\ge 10500$）。

---

## 任务序列总览

| 编号 | 任务 | 涉及文件 | 难度 | 依赖 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TB-01-1** | 纯确定性 2D 梯度噪声与无状态分形 fBm 内核实现 | `crates/sim_core/src/geo/terrain.rs` | 中 | — | ✅ 已实施（v1.50.36：`terrain_noise` 模块，未接入高程采样，接入随 TB-01-2） |
| **TB-01-2** | 高程与区域调制掩码（Masking）及主脊域扭曲（Domain Warping） | `crates/sim_core/src/geo/terrain.rs` | 中 | TB-01-1 | ✅ 已实施（v1.50.37：fBm 接入高程场，掩码 0.25/0.90 + 鞍部保护带 0.15 + 域扭曲双分量峰值归一化 45m/λ420m+170m 两端收敛；初版 12m 蛇形不可见，已按反馈加强） |
| **TB-01-3** | T1 不对称支脊（Branch Ridges）几何模型与鞍部禁区避让 | `crates/sim_core/src/geo/terrain.rs` | 高 | TB-01-2 | ✅ 已实施（v1.50.38：1~2 条不对称支脊（40% 双支脊）+ 鞍部禁区 ≥1.5×saddle_width 线性映射避让 + 根部爬坡消交汇 NO_WALK（连通分量恒 1）+ 图内锚点收窄/朝图心倾斜防出图钳位） |
| **TB-01-4** | 四邻域差分坡度重算与地表属性重新映射 | `crates/sim_core/src/geo/terrain.rs` | 中 | TB-01-3 | ✅ 已实施（v1.50.39：现状核对逻辑完备自然接入，补 TB-01-4 契约注释；12 种子验证岩壁 100% 落主脊/支脊、真平原 ≤9.5°/零 NO_BUILD、走廊 <23.2°、肥力方向正确） |
| **TB-01-5** | 仿真配置集中化与 SimConfig 全链路接入 | `config.rs` / `config.js` / `examples/config.json` | 低 | TB-01-3 | ✅ 已实施（v1.50.40：5 个 `terrain_noise_*`/`terrain_branch_ridge_*` 字段四处同步 + 内核真实读取点；默认 6.0/300.0 噪声逐位零漂移，支脊长度/振幅比以抖动重参数化，临时验证实证 5 字段均驱动地形） |
| **TB-01-6** | 生成器版本门禁升级（VERSION 4 $\to$ 5）与存读档契约对接 | `terrain.rs` / `world_save.rs` / `save-ui.js` | 低 | TB-01-4 | ✅ 已实施（v1.50.41：`TERRAIN_GENERATOR_VERSION` 4→5 附版本历史注释；`deserialize_save` 既有门禁链比对常量零新代码自动拒绝 v4 地形档，前端 `applySave` 展示内核明确错误 + SAVE_APP_VERSION 每版作废引导；8 种子探针往返 8/8 成功、篡改档 8/8 明确拒绝） |
| **TB-01-7** | 探针工具诊断升级与 60 种子全图连通性矩阵校验 | `crates/sim_core/examples/terrain_probe.rs` | 中 | TB-01-4、TB-01-5 | ⏳ 待实施 |
| **TB-01-8** | 全链路确定性回归、WASM 双副本同步与文档状态闭环 | 全链路门禁 / `07-terrain-art.md` / `AGENTS.md` | 低 | TB-01-6、TB-01-7 | ⏳ 待实施 |

---

## 任务明细

### TB-01-1 · 纯确定性 2D 梯度噪声与无状态分形 fBm 内核实现

- **目标**：在 `crates/sim_core/src/geo/terrain.rs` 中实现零外部依赖、跨平台位级确定性的轻量 2D 梯度噪声（Gradient Noise）与分形布朗运动（fBm）求值函数，替代原先仅有 2 组平滑正弦波谐波的机械地形。
- **内容**：
  1. **确定性无状态整数梯度哈希**：
     - 利用既有 `mix64` 算子，输入格网整数坐标 `(ix, iy)` 与特征盐值（如 `SALT_TERRAIN_NOISE = 0x5445_5252_4E53_3031`）；
     - 映射至 8 个离散单位方向梯度向量（$(\pm 1, 0), (0, \pm 1), (\pm \frac{\sqrt{2}}{2}, \pm \frac{\sqrt{2}}{2})$），彻底避免三角函数运行时开销与跨平台浮点漂移。
  2. **五次平滑样条插值（Quintic Hermite Interpolator）**：
     - 采用 $s(t) = 6t^5 - 15t^4 + 10t^3$（二阶导数连续），消除网格边界处的一阶导数不连续，确保计算坡度时不会产生十字网格接缝。
  3. **3 倍频分形布朗运动（fBm, Fractal Brownian Motion）**：
     - $\text{fbm}(x, y) = \sum_{i=0}^{\text{octaves}-1} A_i \cdot \text{noise2d}(x \cdot F_i, y \cdot F_i)$；
     - **Octave 0（宏观次级丘陵）**：波长 $\lambda_0 \approx 280\text{m}\sim 360\text{m}$，基准振幅 $A_0 \approx 6.0\text{m}\sim 8.0\text{m}$；
     - **Octave 1（中观坡面褶皱）**：波长 $\lambda_1 \approx 90\text{m}\sim 130\text{m}$，基准振幅 $A_1 \approx 2.5\text{m}\sim 3.5\text{m}$；
     - **Octave 2（微观地表细部）**：波长 $\lambda_2 \approx 30\text{m}\sim 45\text{m}$，基准振幅 $A_2 \approx 0.8\text{m}\sim 1.2\text{m}$。
- **现状核对**：当前 `terrain.rs` 行 400~402 仅有 `wave_large`（$5.0\sin$）与 `wave_medium`（$2.5\cos$），无法呈现真实的丘陵褶皱。
- **出处**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §7.2、§3.1「大片绿、黄、灰渐变，像一块倾斜色板，坡地辨识弱」。
- **验收**：
  - 单独运行梯度哈希在 Windows/Linux/WASM 下同入参输出 100% 逐位一致；
  - 14400 格点全图单次 fBm 采样耗时 $< 0.8\text{ms}$。
- **依赖**：无。

---

### TB-01-2 · 高程与区域调制掩码（Masking）及主脊域扭曲（Domain Warping）

- **目标**：为多尺度噪声引入高度与区域衰减掩码，避免全图均匀加噪破坏平原生活区；同时对 T1 主脊中线施加低频域扭曲，打散直线感。
- **内容**：
  1. **空间与高程调制掩码（Modulation Masking）**：
     - 严格遵守 07 号文 §4.4「每图一个主地标、少量次地标，聚落与主路保留开阔空间，避免通过均匀加噪声和堆装饰制造丰富度」；
     - **高度调制**：归一化基础高程 $h_{\text{norm}}$ 越高（山体区域），噪声权重越大（$\text{weight} \approx 0.8\sim 1.0$）；低海拔平原区域噪声权重平滑衰减至 $0.20\sim 0.30$；
     - **鞍部山口保护带**：在鞍部走廊区域（$\vert \text{along} - \text{saddle\_along} \vert < \text{saddle\_width}$），高频噪声振幅强制衰减至 $\le 0.15$，确保通道平缓无坑洼。
  2. **主脊域扭曲（Domain Warping 蛇形蜿蜒）**：
     - 原直线坐标：$\text{across} = -wx \cdot \sin\theta + wy \cdot \cos\theta - \text{ridge\_offset}$；
     - 引入低频扰动：$\text{across}_{\text{warped}} = \text{across} + \text{warp}(\text{along}, \text{seed}_{\text{warp}})$；
     - ~~$\text{warp\_amp} \approx 10.0\text{m}\sim 15.0\text{m}$~~（**实施修订 v1.50.37**：初版单分量 12m 实测横移仅 ~2.5m，蛇形不可见，按用户反馈加强为双分量——主弯 λ≈420m + 次摆 λ≈170m，并以峰值归一化把各种子横移峰值锁定到 45m（> 0.7× 脊半宽），形状随种子、量级恒定）；
     - 在主脊两端自然收敛（包络 $1-(\text{along}/0.75\cdot\text{world})^2$），主脊呈明显蛇形曲线，告别直线标尺感。
- **现状核对**：`across` 当前严格为线性投影，主脊没有任何侧向弯曲。
- **出处**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §4.4「尺度层次」、§7.2。
- **验收**：主脊脊线具备**肉眼明确可辨**的蛇形弯曲度（横移峰值 ≈45m），两端不出界；平原区地表高度起伏平顺，不产生微型凹坑。
- **依赖**：TB-01-1。

---

### TB-01-3 · T1 不对称支脊（Branch Ridges）几何模型与鞍部禁区避让

- **目标**：在 T1 `mountain_pass_v1` 中生成 1~2 条从主脊侧翼向外延伸的不对称支脊，塑造真实山系地貌，并建立严格的山口避让禁区。
- **内容**：
  1. **支脊数量与独立抽样**：
     - 使用 `relief_rng` 派生独立分支判定，禁止扰动全局模拟 RNG；
     - 生成 $1\sim 2$ 条支脊（第 1 条 100% 出现，第 2 条按 40% 概率生成）；
     - 两条支脊分别朝向主脊相反两侧（一侧 $\text{across} > 0$，另一侧 $\text{across} < 0$），形成不对称山势。
  2. **山口鞍部核心禁区（Saddle Forbidden Zone）**：
     - 支脊沿脊线锚点 $\text{along}_{\text{branch}}$ 必须满足硬约束：
       $$\vert \text{along}_{\text{branch}} - \text{saddle\_along} \vert \ge 1.5 \times \text{saddle\_width}$$
     - 绝对禁止支脊扎入鞍部山口，防止全图唯一天然交通通道被次级山脊阻断。
  3. **支脊几何形态与衰减包络**：
     - 支脊与主脊夹角 $\phi \approx 45^\circ\sim 70^\circ$；
     - 支脊延伸长度 $L_{\text{branch}} \approx 120\text{m}\sim 180\text{m}$；
     - 支脊高斯横截面宽度 $W_{\text{branch}} \approx 0.60\sim 0.75 \times \text{ridge\_width}$；
     - 支脊振幅 $A_{\text{branch}} \approx 0.40\sim 0.55 \times \text{ridge\_amplitude}$（次级高度，坡度多处于 $18^\circ\sim 28^\circ$，作为地形引导屏障但不过分陡峭）；
     - 沿支脊轴线方向施加三次平滑衰减包络：$(1 - \frac{d_\parallel}{L_b})^2$，在末梢自然融入丘陵缓坡。
- **现状核对**：`docs/current/tech/14-terrain-and-network.md` 行 382 明确标明「支脊：最多两条低幅度分支 ⏳ 当前版本未实现支脊」。
- **出处**：[06-terrain-templates.md](docs/plan/tech/06-terrain-templates.md) §3.2、§5.4.D、R.3 阶段三（D-B2）；[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §7.2。
- **验收**：
  - 支脊清晰可见且呈现不对称延伸；
  - 鞍部通道保持通透，全图通行连通分量恒为 1。
- **依赖**：TB-01-2。

---

### TB-01-4 · 四邻域差分坡度重算与地表属性重新映射

- **目标**：在叠加多尺度噪声与支脊后的复合高程场上，精确重算坡度并映射地表材质类别、建造掩码、硬禁行与自然肥力。
- **内容**：
  1. **空间差分坡度计算**：
     - 沿用 4 邻域中心差分法计算梯度矢量 $(dx, dy)$，由 $\text{slope} = \text{atan}(\sqrt{dx^2 + dy^2}) \cdot \frac{180}{\pi}$ 导出坡度角；
     - 边界采用单侧差分，杜绝贴边通行误判。
  2. **地表类别与掩码分类**（严格遵循既有物理阈值）：
     - $\text{slope} \ge 34^\circ \implies \text{SurfaceKind::RockFace}$，并标记 `TERRAIN_FLAG_NO_WALK`（硬禁行峭壁）；
     - $20^\circ \le \text{slope} < 34^\circ \implies \text{SurfaceKind::SoftGround}$（坡地软土）；
     - $\text{slope} < 20^\circ \implies \text{SurfaceKind::DryGround}$（平缓干地）；
     - $\text{slope} \ge 18^\circ \implies$ 写入 `TERRAIN_FLAG_NO_BUILD`（建造排除坡度）。
  3. **自然肥力平滑衰减**：
     - $\text{fertility} = (0.92 - \frac{\text{slope}}{70.0} - \text{norm\_elev} \times 0.18).\text{clamp}(0.1, 1.0)$，保持与既有生态渲染管道完全兼容。
- **现状核对**：既有坡度计算与地表标志位逻辑完备，新高程场生成后自然接入即可。
- **出处**：[14-terrain-and-network.md](docs/current/tech/14-terrain-and-network.md) §9.2 步骤 4~5。
- **验收**：
  - 陡峭岩壁自然分布在主脊与支脊高耸险峻处，坡脚与平原自然过渡为干地与草甸；
  - 平原建房区坡度均稳定在 $\le 16^\circ$。
- **依赖**：TB-01-3。

---

### TB-01-5 · 仿真配置集中化与 SimConfig 全链路接入

- **目标**：将多尺度噪声与支脊的核心超参数集中至 `SimConfig`，遵循全链路联动规范，禁止散落硬编码字面量。
- **内容**：
  1. **新增配置项定义**：
     - `terrain_noise_amplitude: f32`（噪声基础振幅，默认 `6.0`m）；
     - `terrain_noise_scale_base: f32`（噪声宏观基础波长，默认 `300.0`m）；
     - `terrain_branch_ridge_enabled: bool`（支脊生成开关，默认 `true`）；
     - `terrain_branch_ridge_amplitude_ratio: f32`（支脊与主脊振幅比，默认 `0.48`）；
     - `terrain_branch_ridge_length: f32`（支脊基础延伸长度，默认 `150.0`m）；
  2. **三处点位严格同步**：
     - ① `crates/sim_core/src/config.rs`：添加结构体字段及 doc 注释；
     - ② `frontend/js/config.js`：添加 camelCase 键及默认值；
     - ③ `examples/config.json`：同步配置样例。
  3. **门禁校验通过**：运行 `node tools/config-check.js` 确保 0 漂移、0 空转。
- **现状核对**：`SimConfig` 当前已有 `terrainPassRidgeWidth` 与 `terrainPassRidgeAmplitude`。
- **出处**：根 AGENTS.md §4.0「配置联动」、§10.4。
- **验收**：`node tools/config-check.js` 通过，在前端调参后重置世界即可动态改变山系起伏与支脊形态。
- **依赖**：TB-01-3。

---

### TB-01-6 · 生成器版本门禁升级（VERSION 4 $\to$ 5）与存读档契约对接

- **目标**：高程生成算法实质性变更，按版本契约递增生成器版本号，保障旧存档安全拒绝，杜绝“旧路网叠加新地貌”的幽灵穿模。
- **内容**：
  1. **生成器版本自增**：
     - 在 `crates/sim_core/src/geo/terrain.rs` 中：
       ```rust
       pub const TERRAIN_GENERATOR_VERSION: u32 = 5; // 4 -> 5: TB-01 多尺度噪声与支脊系统
       ```
  2. **存档门禁核验**：
     - `crates/sim_core/src/spatial/world_save.rs` 在反序列化加载存档时，读取 `TerrainMap.generator_version`；
     - 版本不匹配（$\ne 5$）时严格返回明确错误，触发前端 `save-ui.js` 优雅废弃引导弹窗。
- **出处**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §10.3「版本门禁与存档契约」、根 AGENTS.md §4.9。
- **验收**：旧版本导出的存档在加载时被正确拒绝，且错误提示明确可读；新存档保存与加载 100% 成功。
- **依赖**：TB-01-4。

---

### TB-01-7 · 探针工具诊断升级与 60 种子全图连通性矩阵校验

- **目标**：利用内核探针工具 `crates/sim_core/examples/terrain_probe.rs`，对 60 个随机种子做全矩阵暴力扫描，验证通行力、可建面积与连通分量指标。
- **内容**：
  1. **升级 `terrain_probe.rs`**：
     - 增加支脊统计项：检测是否检出支脊、支脊峰值坡度、支脊处绕行比等；
  2. **执行 60 种子压力测试**：
     - `cargo run --release -p sim_core --example terrain_probe -- 60`
  3. **指标验收达标线**：
     - `components == 1`：60 个种子**全部 100% 连通分量为 1**（绝对无任何封闭死区或孤岛）；
     - `detour_max` / `detour_p95`：最大绕行比稳定在 $2.0 \sim 4.8$ 之间（证明主脊依然有效挡路、山口依然是核心通道，支脊形成次级自然绕行）；
     - `buildable`：可建平整地块（$\text{slope} \le 16^\circ$ 且非 `NO_BUILD`）保持在 $\ge 10500 / 14400$（占全图 $\ge 73\%$）；
     - `hard_blocked_cells`：硬禁行岩壁（$\ge 34^\circ$）主要分布于主峰与支脊侧崖，全图占比适度（$2\%\sim 5\%$）。
- **现状核对**：`terrain_probe.rs` 已具备连通性 BFS、A* 测地距离计算与可建面积统计能力。
- **出处**：[06-terrain-templates.md](docs/plan/tech/06-terrain-templates.md) §9.3.1；[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §11.1、§11.2。
- **验收**：60 种子探针诊断输出全绿，0 报错，无任何单一种子连通分量 $> 1$。
- **依赖**：TB-01-4、TB-01-5。

---

### TB-01-8 · 全链路确定性回归、WASM 双副本同步与文档状态闭环

- **目标**：执行全套自动化回归门禁，重新编译 WASM 并同步双副本，更新规划与现状文档，完成代码交付闭环。
- **内容**：
  1. **编译 WASM 并双副本复制**：
     - `cargo build -p sim_wasm --target wasm32-unknown-unknown --release`
     - 复制到 `frontend/rust/sim_wasm.wasm` 与 `frontend/sim_wasm.wasm`。
  2. **自动化门禁执行**：
     - `cargo test --lib`
     - `node tools/test-wasm.js`
     - `node tools/test-determinism.js`
     - `node tools/snapshot-check.js`
     - `node tools/config-check.js`
     - `node tools/frontend-check.js`
     - `node tools/doc-maintenance-check.js`
  3. **文档与版本状态闭环**：
     - 更新 `docs/plan/tech/07-terrain-art.md` §1.2 TB-01 状态与 §7.2；
     - 更新 `crates/sim_core/src/geo/AGENTS.md` 文件清单与易踩坑；
     - 记录更新日志至 `docs/current/01-changelog.md`。
- **出处**：根 AGENTS.md §2、§4.0.1。
- **验收**：全套门禁全绿，控制台无 Warning，版本号按规范对齐。
- **依赖**：TB-01-6、TB-01-7。

---

## 核心算法设计与数学规格

### 1. 无状态 2D 梯度噪声与 fBm 规格

```rust
// 确定性伪代码结构
fn hash2d(ix: i32, iy: i32, seed: u64, salt: u64) -> (f32, f32) {
    let mixed = mix64((ix as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ (iy as u64).wrapping_mul(0xC6A4_A793_5BD1_E995)
        ^ seed ^ salt);
    // 映射至 8 个离散单位向量
    GRADIENTS_8[(mixed & 7) as usize]
}

fn gradient_noise_2d(x: f32, y: f32, seed: u64, salt: u64) -> f32 {
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;
    // 五次平滑样条：6t^5 - 15t^4 + 10t^3
    let sx = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
    let sy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);
    
    let g00 = dot(hash2d(x0, y0, seed, salt), fx, fy);
    let g10 = dot(hash2d(x0 + 1, y0, seed, salt), fx - 1.0, fy);
    let g01 = dot(hash2d(x0, y0 + 1, seed, salt), fx, fy - 1.0);
    let g11 = dot(hash2d(x0 + 1, y0 + 1, seed, salt), fx - 1.0, fy - 1.0);
    
    lerp(lerp(g00, g10, sx), lerp(g01, g11, sx), sy)
}
```

### 2. 不对称支脊（Branch Ridge）衰减数学公式

对于一条支脊，设其主脊侧锚点为 $(x_0, y_0)$，支脊延伸方向单位矢量为 $\vec{u} = (\cos\alpha, \sin\alpha)$，法向量为 $\vec{v} = (-\sin\alpha, \cos\alpha)$：
对于地表任意点 $(x, y)$，相对于支脊起点的相对位移为 $\vec{\Delta} = (x - x_0, y - y_0)$：
- 沿脊轴投影距离：$d_\parallel = \vec{\Delta} \cdot \vec{u}$
- 垂直脊轴距离：$d_\perp = \vec{\Delta} \cdot \vec{v}$

高程增量公式：
$$H_{\text{branch}}(x, y) = A_{\text{branch}} \cdot \exp\left(-\left(\frac{d_\perp}{W_{\text{branch}}}\right)^2\right) \cdot \text{Envelope}(d_\parallel)$$
其中衰减包络线满足：
$$\text{Envelope}(d_\parallel) = \begin{cases} 
\left(1 - \frac{d_\parallel}{L_{\text{branch}}}\right)^2 & \text{若 } 0 \le d_\parallel \le L_{\text{branch}} \\
\exp\left(-\left(\frac{d_\parallel}{0.2 \cdot W_{\text{branch}}}\right)^2\right) & \text{若 } d_\parallel < 0 \text{（后背平滑收尾）} \\
0 & \text{若 } d_\parallel > L_{\text{branch}} 
\end{cases}$$

---

## 易踩坑与安全保障清单

1. 🔴 **RNG 消费隔离**：绝不能直接在共享的 `WorldRng`（用于初始族人、POI 散布）中直接抽随机数，否则即使同一个世界种子，加了支脊后所有人物出生位置和属性也会全部漂移。支脊生成必须消费局部 `relief_rng` 或使用确定性整数哈希。
2. 🔴 **山口鞍部死区保护**：支脊的锚点必须与鞍部山口保持 $\ge 1.5 \times \text{saddle\_width}$ 的缓冲距离，否则随机生成的支脊如果刚好跨在山口上，会导致全图被山脉完全切断，造成族人不可达死亡。
3. 🟠 **全图均匀噪声陷阱**：严禁把高频噪声无脑加在全图。如果平原建房区加了 $\pm 2\text{m}$ 的高频噪声，局部网格坡度将频繁突破 $18^\circ$，导致平原上大面积出现 `NO_BUILD` 红格子，房屋营建系统将无法落位。高频噪声必须配合高度掩码在低平地带衰减到几乎为 0。
4. 🟠 **WASM 浮点与平台确定性**：噪声算法禁止使用标准库的 `f32::sin` 快速近似或非标准扩展，禁止使用任何依赖操作系统或内存地址的哈希器（如 `DefaultHasher`），必须保证在 x86_64、ARM64 和 wasm32 架构下生成的网格高度逐位一致。
5. 🟡 **版本自增与双副本**：改动内核后必须递增 `TERRAIN_GENERATOR_VERSION`，并必须同时将生成的 `sim_wasm.wasm` 拷贝到 `frontend/rust/` 和 `frontend/` 两个位置。

---

## 验收测试矩阵与命令清单

### 1. 编译与自动化测试

```powershell
# 1. 编译并验证
cargo test --lib
cargo build -p sim_wasm --target wasm32-unknown-unknown --release

# 2. 双副本同步
Copy-Item "target\wasm32-unknown-unknown\release\sim_wasm.wasm" -Destination "frontend\rust\sim_wasm.wasm" -Force
Copy-Item "target\wasm32-unknown-unknown\release\sim_wasm.wasm" -Destination "frontend\sim_wasm.wasm" -Force

# 3. 确定性与门禁测试
node tools/test-wasm.js
node tools/test-determinism.js
node tools/snapshot-check.js
node tools/config-check.js
node tools/frontend-check.js
node tools/doc-maintenance-check.js
```

### 2. 探针通行力诊断（60 种子压测）

```powershell
cargo run --release -p sim_core --example terrain_probe -- 60
```
**合格断言**：
- `components`: 60 个种子恒为 `1`；
- `detour_max`: 处于 `2.0 ~ 4.8` 之间；
- `buildable`: 均值 $\ge 10800$，最小值 $\ge 10200$。

### 3. Chrome 视口视觉交互验收

1. 启动本地服务：`node frontend/server.js` 并使用 Chrome 访问 `http://localhost:3000`；
2. 视角缩放至远景（`Zoom 0.4`）：观察主脊具有蛇形弯曲，侧向延伸出不对称支脊，山脉骨架清晰；
3. 视角推进至中景（`Zoom 1.0`）：坡面呈现自然分形褶皱，非单调平滑色板，山崖处自然露出岩石色（$\ge 34^\circ$）；
4. 视角推进至近景（`Zoom 2.0`）：平原区与居民区平整无麻点，房屋紧密落座无悬空，族人正常经由山口往返。
