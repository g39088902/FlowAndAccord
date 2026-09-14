# TODO

> **阶段二已收官（2026-09-13）**：[06 号地形方案 R.3 阶段二 · 生成组合基座与有界回退](docs/plan/tech/06-terrain-templates.md) 的 STAGE2-1～8 全部交付；专项任务文档 STAGE2-TODO.md 已随收官归档删除，分层验收证据（合法基线等价差分 + 拒绝/降级统计 + 三项遗留门禁销项）见 [14 号 §8.2](docs/current/tech/14-terrain-and-network.md)。后续阶段按 06 号 R.3/R.6 逐项拆分开工。
> **纪律**：一次提交只做一件事（§5.1 禁止合并大改）；含 Rust 改动的任务完成后重编译 WASM 并同步双副本；纯勾选/文档修订不升版。

## 阶段一 · D-B1 装饰扩展与骨架

- [x] **D-B1-1 配置字段加回：子特征注入总开关 `terrainAccentSubFeatures`**
    - 内容：`config.rs` 增加 `SimConfig` 字段及 doc 注释（沿用 `#[derive(Default)]`，不新增命名 const 或手写 `Default`）+ `frontend/js/config.js`（默认值唯一真相源，已设为 `true`）+ `crates/sim_core/examples/config.json` + `tools/config-check.js` 映射；本项同时接入 §5.3 第 4–5、9 步的空钩子门控作为真实消费点，D-B1-3 再实现选择器。禁止无消费点字段（`config-check.js` 第 5 条「空转参数」直接报错）；本阶段无注入实现、两种取值下世界输出等价。
    - 出处：06 号文首更正段（字段已于 v1.50.18 全量删除）、R.5 待加回清单、§5.3、§5.7 配置行；根 AGENTS.md §4.12。
    - 验收：`node tools/config-check.js` 通过。
    - 依赖：无（首个任务）。

- [x] **D-B1-2 内核子特征数据模型与稳定 ID**
    - 内容：新增 `TerrainSubFeatureKind` 八变体枚举（FootLake / RidgeWaterfall / ForestedSlope / RockyOutcrop / OxbowLake / RiverCliff / RiversideForest / GravelBeach）+ `TerrainSubFeature` 结构（`id:u32`、`kind`、`anchor:Vec3`、`bounds_min/max`、`feature_ids`、accent 区间）；`TerrainMap.sub_features` 容器字段加 `#[serde(default)]`（缺字段反序列化默认空数组，应用版本门禁不变，`SAVE_FORMAT_VERSION` 不递增）；ID 唯一性断言、按 ID 升序存储（§5.2 ID 表与稳定 ID 规则）。
    - 出处：§5.2、§5.7 快照 JSON 行与存档行、§17.1。
    - 验收：`cargo test --lib`；临时验证缺少 `sub_features` 字段的地形数据可反序列化为默认空数组、新档包含空字段、同应用版本存读档一致；跨应用版本旧档仍按既有 `SAVE_APP_VERSION` 门禁拒绝，不把字段兼容误写为旧版本存档可载。临时验证脚本不进入提交。
    - 依赖：无；与 D-B1-1 无耦合。

- [x] **D-B1-3 子特征选择器落地 + 流水线空钩子接线**
    - 内容：实现 §5.3 的 `mix64` / `roll_10000` 私有纯函数（禁用 `DefaultHasher`、浮点哈希、系统时间）；每种 kind 固定盐值 + 首版命中概率表（§5.3 表，代码常量，不新增配置字段）；互斥裁决 = 结构型/视觉型各至多一个、类内按 kind 升序首个命中即停；在现有生成流程按 §5.3 步骤位预留第 4–5、9 步空钩子并由 `terrainAccentSubFeatures` 门控——本阶段为空操作、不写任何格子（完整阶段化流水线属阶段二，届时接管）。
    - 出处：§5.3（选择器、互斥裁决、空实现要求）、§18.5 前两条、§5.1「子特征选择器」交付项。
    - 验收：同种子 100% 复现；开关开/关均不改变既有 T1/T2 世界输出。
    - 依赖：D-B1-1（开关）、D-B1-2（kind 枚举）。

- [x] **D-B1-4 子特征快照四处同步 + `FORMAT_VERSION` 2→3**（须一个提交内完成）
    - 内容：① `spatial/snapshot.rs` 定义 `TerrainSubFeatureSnapshot`；② `spatial/world_snapshot.rs::generate_snapshot()` 赋值（本阶段恒空数组；静态地形脏帧才发送）；③ FABS：`snapshot_bin/layout.rs` 新增 `SectionKind::TerrainSubFeatures = 22`、`encode.rs` 落记录布局（`id:u32,kind:u8,anchor,bounds_min,bounds_max,feature_count,feature_ids...,accent_start/end:opt_u32,align4`）、`dict.rs` 同步枚举表（§17.1 的 Cliff/Waterfall/WaterBody 特征表注册项可一并或随阶段三注入落地）、`FORMAT_VERSION` 2→3；④ 前端：`snapshot-bin.js` 解码 + `rustworld.js` 映射 `terrain.subFeatures`，在 READY/LOAD/REWIND/RESET 时与 features/accents 一起替换；`STR_TAB.start_index==0` 保持字符串驻留表的既有清理语义，独立装饰缓存更新由 D-B1-7 完成。
    - 出处：§5.7 快照 JSON / FABS / 前端状态三行 + 末段（快照化理由：调试面板、诊断、跨世界缓存清理、种子事实源）；根 AGENTS.md §4.5 四处同步与 §4.5.1 缓存判据。
    - 验收：`node tools/test-snapshot-bin.js` 全场景通过。
    - 依赖：D-B1-2（模型）。

- [x] **D-B1-5 RockCluster / GrassTuft 内核生成**
    - 内容：`geo/accents.rs` 的 `generate_accents()` 按固定顺序追加两段：Tree → Boulder → Bush → RockCluster → GrassTuft；新增随机数只允许 `accent_rng` 消费（保持消费顺序确定性）；候选地表按 §5.5 表执行——RockCluster：`RiverBank`/`RiverTerrace` 或坡度 ≥ 8° 干地；GrassTuft：`DryGround`/`SoftGround`/`RiverTerrace` 且坡度 < 24°，避开深水/浅水/`NO_WALK`。
    - 出处：§5.5、§17.1 `geo/accents.rs` 待办行、§2.3 D-A 行遗留（仅枚举未生成）。
    - 验收：装饰不进禁区门禁（§18.4）保持通过；同步更新所有「同种子 accent 数组逐字节一致」基线（§5.5 明确要求）。
    - 依赖：无硬依赖；建议在 D-B1-9 基线比对前完成。

- [x] **D-B1-6 RockCluster / GrassTuft 前端绘制**
    - 内容：`render_accents.js` / `accent-model.js` 新增两分支——RockCluster 由 anchor 前端派生 2–5 个子石（`accent.id` 驱动偏移/尺度，不为子石建实体、不改碰撞/路面）；GrassTuft 3–6 根短草线、颜色由前端按当前季节派生（同 Tree 逻辑，不读存档 `tint`，见 14 号 §7.4）；统一深度队列绘制，不恢复整层落笔。
    - 出处：§5.5、§5.7 Canvas 行。
    - 验收：未知 kind 直接跳过 + 开发模式计数报警，不得错画成 `Bush`（§5.5 末段）；`node tools/frontend-check.js` 通过。
    - 依赖：D-B1-5（内核先有数据）。

- [x] **D-B1-7 装饰缓存拆分 + §18.4 收口**
    - 内容：拆分前端单一 `_terrainCached`，使装饰缓存（含新的 `subFeatures` 数据通道）独立于地形缓存；落实 06 号 §18.4 的静态数据更新契约，区分“本帧未发送”与“明确空集合”，同时处理 `AccentModel` 模型缓存。`STR_TAB.start_index==0` 继续仅按既有契约重置字符串驻留表，不以其替代完整的世界生命周期处理。
    - 落地（v1.50.33）：① `snapshot.rs`/`world_snapshot.rs` 三通道改 `Option<Vec<_>>`——`None`（JSON 序列化为 `null`）= 未发送，`Some(vec)` = 明确静态帧（可为空集合），JSON 调试通道与 FABS 同语义；② `snapshot-bin.js` section 缺席时输出 `null`（对齐 lanes/nodes 约定，`FORMAT_VERSION` 保持 3）；③ `rustworld.js` 拆分——静态三通道与网格缓存独立裁决（`Array.isArray` 判明确帧，禁止用数组长度猜测），新增 `_invalidateWorldStaticCaches()` 在 READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 四处随消息生命周期失效静态数据与 `AccentModel` 模型缓存。
    - 验收：临时独立用例 22 断言全通（普通增量帧保留装饰〔含真实 FABS 增量帧与 JSON `null` 语义〕、同 profile/生成器版本 + 复用 accent ID 换世界、非空→空集合〔含 subFeatures 非空夹具、缓存命中帧与重建帧两路〕、READY/LOAD/REWIND/RESET 后数据与模型缓存一致、LOAD 失败不清缓存）；脚本按 §4.10 已于提交前删除。门禁：cargo test --lib、test-wasm ALL_TESTS_DONE、test-determinism、test-snapshot-bin 4 场景 ALL_BIN_JSON_EQUAL、config-check 233/233、frontend-check 35 文件全绿；升版重编译 WASM 双副本。
    - 出处：§18.4 第 6 条（已由 ⏳ 转 ✅）及其静态数据更新契约（已标实施）、§5.7 前端状态行。
    - 依赖：D-B1-4（subFeatures 通道就位后拆分才有意义）、D-B1-6。

- [ ] **D-B1-8 场景样板：支脊山口 + 岩壁河谷（美术侧）**
    - **代码前置（v1.50.51）**：统一第 5c 步局部坡度试算与第 6 步全图定稿判据，移除全图定稿的高程复制；现状机制见 [14 号 §8.1](docs/current/tech/14-terrain-and-network.md#81-静态几何校验与生存成本诊断v15047--stage2-46)。此项不等于 RiverCliff 几何注入或实机验收完成。
    - **进展（2026-09-14）**：双场景视觉目标草案已交付，用户已明确“接受构图方向”；图稿、提示词、前置源码核对与后续实机证据矩阵归档至 [07 号 §4.4.1](docs/plan/tech/07-terrain-art.md#441-ta-09-构图评审与实机交付记录)。TA-08 与阶段三 RiverCliff 尚未完成，真实种子/存档及两场景实机验收待交付，保留未勾选；TODO.md 尚不满足清空条件。
    - 内容：两种固定场景的构图与美术打样，把地表色彩、岩层、成组植被、道路可读性、植被受光纳入同一画面（07 号任务 TA-09，旧编号 §9-1，详见 07 号 §4.4/§7）。先评审标为视觉目标的构图草案，再交付真实种子实机样板；注意前置 TB-01 / TA-08 及 06 号阶段三 RiverCliff，可按 07 号波次排期推进，不阻塞 D-B1 代码线。
    - 出处：06 号 R.3 阶段一（原 §5.9 第 1 条）、07-terrain-art.md §1.2 TA-09。
    - 验收：构图草案评审 + 两场景实机验收均通过，记录种子/存档、版本、配置、窗口/DPR 及四季/旋转/俯角/景别、遮挡/接地/性能证据（07 号 §4.4/§11）；草案通过不得提前勾选。**纯视觉样板不冒充物理验收**（§5.8/§18 门禁独立于本项）。
    - 依赖：07 号美术波次（TB-01、TA-08）及 06 号阶段三 RiverCliff；构图草案可先行，实机验收须等三项完成。

- [x] **D-B1-9 阶段一代码收口：退出条件验证 + 门禁证据 + 文档同步**
    - 跨构建验收：以阶段一之前的提交 `5f09236` 为基准，记录最终候选提交及两个 WASM 的 SHA256；按 06 号 §5.1 的 D-B1 跨构建比较契约执行临时差分验证。`test-wasm.js` / `test-determinism.js` 仅验证各自构建的回归与确定性，不能替代新旧构建比较。`TERRAIN_GENERATOR_VERSION` 保持 4，`SAVE_FORMAT_VERSION` 不动。
    - 门禁与产物：汇总 D-B1-1～7 最终候选产物的 R.5 门禁证据（cargo test/build、WASM 双副本、test-wasm / test-determinism / config-check / frontend-check / cross-doc-check）；证据必须对应最终产物。若收口发现代码问题，修复后先按 §4.9 升版、重编译并同步双副本，再对最终产物运行适用门禁；不得用升版前结果替代最终验证。
    - 文档同步：复核 06 号 R.1/§2.3/§18 的状态（缓存实际通过后才清零 D-A 遗留，D-B 注入仍待后续阶段）、07 号装饰实现状态及 TA-09 待交付状态；涉及现状事实时同步 14 号及受影响局部 AGENTS.md。有代码/契约改动时追加 [01-changelog.md](docs/current/01-changelog.md) 版本条目。
    - 纯验证/文档收口：已有最终产物验收证据且未改代码或契约时，不额外升版、不重编译、不新增 changelog 版本条目、不重复运行代码测试；缺少的阶段验收证据仍须补齐。文档提交执行 `git status --short`、`git diff --check`、`doc-maintenance-check`、`doc-link-check`、`cross-doc-check`、`bump-version --check`（发布文档维护检查追加 `--strict`）。
    - 出处：§5.1 D-B1 退出条件、§18.4/§18.5、R.5、根 AGENTS.md §4.0/§4.1/§4.9。
    - 验收：退出条件逐条复核通过后，仅标记“阶段一代码交付完成”，可进入阶段二（生成组合基座）；D-B1-8 / TA-09 保持未完成并按 07 号波次后置，样板通过前不得把阶段一全部交付标为完成。
    - 依赖：D-B1-1～7 全部完成（D-B1-8 可后置）。
    - ✅ **验收结果（2026-09-13）：阶段一代码交付完成**——跨构建差分按 06 号 §5.1 契约全项执行：基准 `5f09236`（v1.50.28）vs 候选 `f21e573`（v1.50.35），2 profile × 12 固定种子 × `terrainAccentSubFeatures` 开关两态，高程+完整地表格、完整路网、完整 POI 规范化导出逐字节比较，三组配对各 24/24 全等；`TERRAIN_GENERATOR_VERSION` 两侧均 4、`SAVE_FORMAT_VERSION` 未动。R.5 七项门禁全绿（证据与 SHA256 记录见 06 号 §18.5 验收记录）。D-B1-8 / TA-09 保持未完成、按 07 号波次后置。

## 阶段二 · 生成组合基座与有界回退（D-B2 公共前置）✅ 已收官（2026-09-13）

> 分层验收按 06 号 R.6/§5.8 执行：纯重构保持包含 TB-01/S7-02 的合法世界逐字节不变（收口对拍：基准 `5527a9e` vs 候选 `c6a59f7`，T1/T2 × seed 0–59 × 支脊两态 4 组聚合指纹全等）；新增拒绝与降级独立提交评估版本。任务明细与验收证据已归档：changelog v1.50.39~49 条目 + [14 号 §8.2](docs/current/tech/14-terrain-and-network.md) 收口记录。

| 任务编号 | 任务名称 | 核心涉及文件 | 状态 | 依赖 |
| :--- | :--- | :--- | :---: | :--- |
| **STAGE2-1** | 配置字段加回：有界重试上限 `terrainGenerationMaxRetries` | `config.rs` / `config.js` / `config-check.js` | ✅ 已完成（v1.50.39） | — |
| **STAGE2-2** | T2 陆地区域公式解耦与水系写入收敛（兼容性拆分核心） | `geo/hydrology.rs` / `geo/terrain.rs` | ✅ 已完成（v1.50.40） | — |
| **STAGE2-3** | 创世流水线阶段化重构（0–11 步无歧义管线；完整几何事务域随阶段三注入启用） | `geo/terrain.rs` / `geo/hydrology.rs` | ◐ 框架交付（v1.50.45） | STAGE2-2 |
| **STAGE2-4** | 静态地形几何校验与稳定 ID 断言落地（§5.2 / §5.3 第 7 步） | `geo/validation.rs` / `geo/terrain.rs` | ✅ 已完成（v1.50.47） | STAGE2-3 |
| **STAGE2-5** | 有界失败降级与重试机制（§5.8 阶梯回退环） | `spatial/creation_fallback.rs` / `spatial/world.rs` | ✅ 已完成（v1.50.49） | STAGE2-1, STAGE2-4, STAGE2-6, STAGE2-7 |
| **STAGE2-6** | 初始营地生存连通分量与往返成本诊断（补齐 §18.1 门禁） | `spatial/survival_diagnosis.rs` | ✅ 已完成（v1.50.47） | STAGE2-3 |
| **STAGE2-7** | `flat_baseline` 显式诊断/降级基线（补齐 §18.1 门禁） | `geo/terrain.rs` / `spatial/world_save.rs` | ✅ 已完成（v1.50.48） | STAGE2-3 |
| **STAGE2-8** | 阶段二代码收口：跨构建差分全等验证 + 遗留门禁销项 + 文档同步 | 全链路 / 验收脚本 / 文档 | ✅ 已完成（v1.50.49 文档收口） | STAGE2-1～7 |

## 未拆分阶段

阶段七已拆入 [STAGE-07-TODO.md](STAGE-07-TODO.md)并**全部交付**（S7-01~S7-10，v1.50.39~52 收口；3 张新 profile 已入存读档白名单与 `random` 候选池）。阶段四通用部分（D-C 通用资源景观与标签避让聚合，S4-01~S4-08，v1.50.46~53）已**全部收口交付**（技术架构与机制详见 [16-frontend-overview.md](docs/current/tech/16-frontend-overview.md) §2.16～§2.18）；特定地貌专属景观群与院地任务见 [STAGE-04-SUBFEATURE-LANDSCAPES-TODO.md](STAGE-04-SUBFEATURE-LANDSCAPES-TODO.md)（随对应注入器逐项交付）。**TB-02 基座与台地内核（台地聚落模板 `plateau_settlement_v1`）已全部收口交付**（TB-02-01~10，v1.50.54；SDF 圆角矩形台面 + 陡壁过渡带 $B=0.6H$ + 双入口缓坡 $B=4.0H$ + 坡脚双泉溪与双接入路网 + 专属门禁 + 随机池准入，60/60 种子全通；专项施工文档 TB-02-IMPLEMENTATION-PLAN.md 已随收官归档清理，分层验收证据见 [14 号 §8.2](docs/current/tech/14-terrain-and-network.md) 与 changelog v1.50.54；表现层对接见 [07 号](docs/plan/tech/07-terrain-art.md) TA-10）。其余子特征、P1、R0 与远期静态模板按 [06 号 R.3](docs/plan/tech/06-terrain-templates.md)逐项解锁、开工时拆分；T4 动态扩展另立项。

开工约束：阶段二已收官，无剩余项；阶段三剩余物理项按 §5.4.D 岩壁离散尺度探针准入，候选参数不得当作已验证默认值。
