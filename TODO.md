# TODO

> **当前拆分对象**：[06 号地形方案 R.3 阶段一 · D-B1 装饰扩展与骨架](docs/plan/tech/06-terrain-templates.md)（D-B1 提交组，§5.1 定义交付内容与退出条件）。每项标注出处章节与验收方式；阶段门禁以 06 号 R.5 速查与 §5.8/§18 为准。
> **纪律**：一次提交只做一件事（§5.1 禁止合并大改）；含 Rust 改动的任务完成后重编译 WASM 并同步双副本；纯勾选/文档修订不升版。编号即建议实施顺序：D-B1-1～4（骨架线）与 D-B1-5～6（装饰线）相对独立可并行，D-B1-9 收口；D-B1-8 为美术侧任务、不阻塞代码线。
> **阶段一退出条件**（§5.1 D-B1 行）：旧 T1/T2 的高度、地表格、路网、POI **逐字节不变**；改变物理事实 = 否；`TERRAIN_GENERATOR_VERSION` 保持 4 不递增。

## 阶段一 · D-B1 装饰扩展与骨架

- [x] **D-B1-1 配置字段加回：子特征注入总开关 `terrainAccentSubFeatures`**
    - 内容：`config.rs` 三处同步（命名 const 默认值 / `SimConfig` 字段 / `Default` 映射）+ `frontend/js/config.js` + `examples/config.json` + `tools/config-check.js` 映射；唯一消费点 = D-B1-3 预留的流水线空钩子（§5.3 第 4–5、9 步门控）。禁止无消费点字段（`config-check.js` 第 5 条「空转参数」直接报错）；默认值实施时定，本阶段无注入实现、两种取值下世界输出等价。
    - 出处：06 号文首更正段（字段已于 v1.50.18 全量删除）、R.5 待加回清单、§5.3、§5.7 配置行；根 AGENTS.md §4.12。
    - 验收：`node tools/config-check.js` 通过。
    - 依赖：无（首个任务）。

- [x] **D-B1-2 内核子特征数据模型与稳定 ID**
    - 内容：新增 `TerrainSubFeatureKind` 八变体枚举（FootLake / RidgeWaterfall / ForestedSlope / RockyOutcrop / OxbowLake / RiverCliff / RiversideForest / GravelBeach）+ `TerrainSubFeature` 结构（`id:u32`、`kind`、`anchor:Vec3`、`bounds_min/max`、`feature_ids`、accent 区间）；`TerrainMap.sub_features` 容器字段加 `#[serde(default)]`（旧档加载默认空数组，`SAVE_FORMAT_VERSION` 不递增）；ID 唯一性断言、按 ID 升序存储（§5.2 ID 表与稳定 ID 规则）。
    - 出处：§5.2、§5.7 快照 JSON 行与存档行、§17.1。
    - 验收：`cargo test --lib`；存读档回归（旧档可载、新档含空字段）。
    - 依赖：无；与 D-B1-1 无耦合。

- [ ] **D-B1-3 子特征选择器落地 + 流水线空钩子接线**
    - 内容：实现 §5.3 的 `mix64` / `roll_10000` 私有纯函数（禁用 `DefaultHasher`、浮点哈希、系统时间）；每种 kind 固定盐值 + 首版命中概率表（§5.3 表，代码常量，不新增配置字段）；互斥裁决 = 结构型/视觉型各至多一个、类内按 kind 升序首个命中即停；在现有生成流程按 §5.3 步骤位预留第 4–5、9 步空钩子并由 `terrainAccentSubFeatures` 门控——本阶段为空操作、不写任何格子（完整阶段化流水线属阶段二，届时接管）。
    - 出处：§5.3（选择器、互斥裁决、空实现要求）、§18.5 前两条、§5.1「子特征选择器」交付项。
    - 验收：同种子 100% 复现；开关开/关均不改变既有 T1/T2 世界输出。
    - 依赖：D-B1-1（开关）、D-B1-2（kind 枚举）。

- [ ] **D-B1-4 子特征快照四处同步 + `FORMAT_VERSION` 2→3**（须一个提交内完成）
    - 内容：① `spatial/snapshot.rs` 定义 `TerrainSubFeatureSnapshot`；② `spatial/world_snapshot.rs::generate_snapshot()` 赋值（本阶段恒空数组；静态地形脏帧才发送）；③ FABS：`snapshot_bin/layout.rs` 新增 `SectionKind::TerrainSubFeatures = 22`、`encode.rs` 落记录布局（`id:u32,kind:u8,anchor,bounds_min,bounds_max,feature_count,feature_ids...,accent_start/end:opt_u32,align4`）、`dict.rs` 同步枚举表（§17.1 的 Cliff/Waterfall/WaterBody 特征表注册项可一并或随阶段三注入落地）、`FORMAT_VERSION` 2→3；④ 前端：`snapshot-bin.js` 解码 + `rustworld.js` 映射 `terrain.subFeatures`，在 READY/LOAD/REWIND/RESET 及 `STR_TAB.start_index==0` 时与 features/accents 一起清除。
    - 出处：§5.7 快照 JSON / FABS / 前端状态三行 + 末段（快照化理由：调试面板、诊断、跨世界缓存清理、种子事实源）；根 AGENTS.md §4.5 四处同步与 §4.5.1 缓存判据。
    - 验收：`node tools/test-snapshot-bin.js` 全场景通过。
    - 依赖：D-B1-2（模型）。

- [x] **D-B1-5 RockCluster / GrassTuft 内核生成**
    - 内容：`geo/accents.rs` 的 `generate_accents()` 按固定顺序追加两段：Tree → Boulder → Bush → RockCluster → GrassTuft；新增随机数只允许 `accent_rng` 消费（保持消费顺序确定性）；候选地表按 §5.5 表执行——RockCluster：`RiverBank`/`RiverTerrace` 或坡度 ≥ 8° 干地；GrassTuft：`DryGround`/`SoftGround`/`RiverTerrace` 且坡度 < 24°，避开深水/浅水/`NO_WALK`。
    - 出处：§5.5、§17.1 `geo/accents.rs` 待办行、§2.3 D-A 行遗留（仅枚举未生成）。
    - 验收：装饰不进禁区门禁（§18.4）保持通过；同步更新所有「同种子 accent 数组逐字节一致」基线（§5.5 明确要求）。
    - 依赖：无硬依赖；建议在 D-B1-9 基线比对前完成。

- [ ] **D-B1-6 RockCluster / GrassTuft 前端绘制**
    - 内容：`render_accents.js` / `accent-model.js` 新增两分支——RockCluster 由 anchor 前端派生 2–5 个子石（`accent.id` 驱动偏移/尺度，不为子石建实体、不改碰撞/路面）；GrassTuft 3–6 根短草线、颜色由前端按当前季节派生（同 Tree 逻辑，不读存档 `tint`，见 14 号 §7.4）；统一深度队列绘制，不恢复整层落笔。
    - 出处：§5.5、§5.7 Canvas 行。
    - 验收：未知 kind 直接跳过 + 开发模式计数报警，不得错画成 `Bush`（§5.5 末段）；`node tools/frontend-check.js` 通过。
    - 依赖：D-B1-5（内核先有数据）。

- [ ] **D-B1-7 装饰缓存拆分 + §18.4 收口**
    - 内容：拆分前端单一 `_terrainCached`，使装饰缓存（含新的 `subFeatures` 数据通道）独立于地形缓存；保证换世界/读档/重置后装饰缓存无旧数据残留。
    - 出处：§18.4 第 4 条（当前唯一 ⏳ 项）、§5.7 前端状态行。
    - 验收：§18.4 该项由 ⏳ 转 ✅（独立验证用例）。
    - 依赖：D-B1-4（subFeatures 通道就位后拆分才有意义）、D-B1-6。

- [ ] **D-B1-8 场景样板：支脊山口 + 岩壁河谷（美术侧）**
    - 内容：两种固定场景的构图与美术打样，把地表色彩、岩层、成组植被、道路可读性、植被受光纳入同一画面（07 号任务 TA-09，旧编号 §9-1，详见 07 号 §4.4/§7）。注意 07 号侧前置 TB-01 / TA-08，可按 07 号波次排期推进，不阻塞 D-B1 代码线。
    - 出处：06 号 R.3 阶段一（原 §5.9 第 1 条）、07-terrain-art.md §1.2 TA-09。
    - 验收：构图样板评审通过；**纯视觉样板不冒充物理验收**（§5.8/§18 门禁独立于本项）。
    - 依赖：07 号美术波次（TB-01、TA-08）。

- [ ] **D-B1-9 阶段一收口：退出条件验证 + 全量门禁 + 文档升版**
    - 内容：① 用改动前构建与新构建对同种子输出逐字节比对，确认旧 T1/T2 高程/地表格/路网/POI 不变（`node tools/test-wasm.js` + `node tools/test-determinism.js`；`TERRAIN_GENERATOR_VERSION` 保持 4，`SAVE_FORMAT_VERSION` 不动）；② 全量门禁按 R.5 清单执行（test-wasm / test-determinism / test-snapshot-bin / config-check / frontend-check / cross-doc-check）；③ 更新 06 号 §2.3 状态行（D-A 遗留清零、D-B 行更新）与 [01-changelog.md](docs/current/01-changelog.md)，涉及现状事实时同步 14 号文档；④ `node tools/bump-version.js --patch` 升版并重编译 WASM 同步双副本（§4.9）。
    - 出处：§5.1 D-B1 退出条件、§18.4/§18.5、R.5、根 AGENTS.md §4.0/§4.1/§4.9。
    - 验收：退出条件逐条复核通过后，阶段一标记完成，进入阶段二（生成组合基座）。
    - 依赖：D-B1-1～7 全部完成（D-B1-8 可后置）。

## 未拆分阶段

阶段二～八与阶段九a~九d（生成组合基座、首批子特征、D-C、P1 四模板〔含湖畔盆地〕、阶段七插队模板〔河谷聚落/平地草原/半坡林地〕、复杂水系/R0、远期批次〔静态扩展/沙漠绿洲/T4 动态水文/海岛〕）暂未拆分，排期与依赖见 06 号 R.3 阶段计划表（2026-09-13 起 16 张模板全部排期）；完成阶段一后按同一粒度逐批拆入本文件。
