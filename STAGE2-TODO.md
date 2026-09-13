# STAGE2 TODO · 地图模板生成组合基座与有界回退

> **当前拆分对象**：[06 号地形方案 R.3 阶段二 · 生成组合基座与有界回退（D-B2 公共前置）](docs/plan/tech/06-terrain-templates.md)（§5.1 提交组边界、§5.2 单一真相源与稳定 ID、§5.3 创世流水线、§5.8 有界回退与验收矩阵、§18.1/§18.2 遗留门禁）。
> **阶段定位**：D-B2 子特征注入与 P1 新模板的**公共基座工程**。本阶段负责把流水线解耦、水系带写入收敛、稳定 ID 与几何断言、阶梯重试降级以及生存诊断完整落地，为后续阶段提供安全可靠的生成架构。
> **基线与退出条件**（06 号 R.3、§5.1、§5.3 末段）：
> 1. **物理事实零改动**：基座自身不改世界；旧 T1/T2 的高程、坡度、地表类别、标志、肥力、水系、路网、POI 均**逐字节不变**（跨构建 120 组 0 差异）；
> 2. **版本号稳定**：`TERRAIN_GENERATOR_VERSION` 保持 **4** 不递增，`SAVE_FORMAT_VERSION` 保持 **7** 不动，FABS `FORMAT_VERSION` 保持 **3** 不动；
> 3. **遗留门禁销项**：补齐 R.1 遗留的 3 项门禁（§18.1 生存连通与成本诊断、§18.1 `flat_baseline` 行为等价、§18.2 有界重试）；
> 4. **配置字段加回**：连同消费点加回 `terrainGenerationMaxRetries`，通过 `config-check.js` 第 5 条零空转门禁。
>
> **纪律**：一次提交只做一件事（§5.1 禁止合并大改）；含 Rust 改动的任务完成后必须重编译 WASM 并同步双副本（`frontend/rust/` + `frontend/`）；纯勾选/文档修订不升版。

---

## 任务序列总览

| 编号 | 任务名称 | 核心涉及文件 | 改变物理事实 | 难度 | 依赖 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **STAGE2-1** | 配置字段加回：有界重试上限 `terrainGenerationMaxRetries` | `config.rs` / `config.js` / `config-check.js` | 否 | 低 | — |
| **STAGE2-2** | T2 陆地区域公式解耦与水系写入收敛（兼容性拆分核心） | `geo/hydrology.rs` / `geo/terrain.rs` | 否 | 中 | — |
| **STAGE2-3** | 创世流水线阶段化重构（0–11 步无歧义管线） | `geo/terrain.rs` / `geo/hydrology.rs` | 否 | 中 | STAGE2-2 |
| **STAGE2-4** | 静态地形几何校验与稳定 ID 断言落地（§5.2 / §5.3 第 7 步） | `geo/terrain.rs` / `geo/hydrology.rs` | 否 | 低 | STAGE2-3 |
| **STAGE2-5** | 有界失败降级与重试机制（§5.8 阶梯回退环） | `geo/terrain.rs` / `spatial/world.rs` | 否 | 中 | STAGE2-1、STAGE2-4 |
| **STAGE2-6** | 初始营地生存连通分量与往返成本诊断（补齐 §18.1 门禁） | `geo/query.rs` / `ecology/spawn.rs` / `spatial/world.rs` | 否 | 中 | STAGE2-3、STAGE2-5 |
| **STAGE2-7** | `flat_baseline` 行为等价基线支持（补齐 §18.1 门禁） | `geo/terrain.rs` / `config.rs` | 否 | 低 | STAGE2-3、STAGE2-5 |
| **STAGE2-8** | 阶段二代码收口：跨构建差分全等验证 + 遗留门禁销项 + 文档同步 | 全链路 / 验收脚本 / 文档 | 否 | 中 | STAGE2-1～7 |

---

## 任务明细

### STAGE2-1 配置字段加回：有界重试上限 `terrainGenerationMaxRetries`

- [x] **STAGE2-1 配置字段加回与消费点预留**
    - **内容**：
      1. `crates/sim_core/src/config.rs`：在 `SimConfig` 中增加 `pub terrain_generation_max_retries: u32` 字段及完整 doc 注释（沿用 `#[derive(Default)]`，不新增 const 默认值，不手写 `Default` 实现）；
      2. `frontend/js/config.js`：添加配置默认值（唯一真相源，设为 `3`）；
      3. `crates/sim_core/examples/config.json`：同步添加该字段；
      4. `tools/config-check.js`：在 `IMPACT_OVERRIDES` 中增加该字段到影响面的映射（字段总数由 233 增至 234）；
      5. **消费点防空转**：接入真实消费点（在 `geo/terrain.rs` 创世回退上限或 `world.rs` 初始化处真实读取），确保满足 `tools/config-check.js` 第 5 条「空转参数」门禁（零消费点即构建失败）。
    - **出处**：06 号文首更正段、R.5 待加回清单、§5.8 有界回退、§18.2 T1 遗留门禁 ⏳ 项；根 [AGENTS.md](AGENTS.md) §4.0 / §4.12。
    - **验收**：`node tools/config-check.js` 通过（字段数 234=234，第 5 条空转检查通过）。
    - **依赖**：无（首个配置任务）。

---

### STAGE2-2 T2 陆地区域公式解耦与水系写入收敛（兼容性拆分核心）

- [ ] **STAGE2-2 T2 陆地区域公式提取与水系影响带收敛**
    - **内容**：
      1. **现状痛点**：当前 `geo/hydrology.rs::generate_river` 对整张 `120×120` 网格遍历，无条件覆写全部网格的 `elevation`、`surface_kind`、`water_body_id`、`feature_flags` 与 `natural_fertility`，将前置步骤的基础地貌全部冲刷，导致统一地表派生无法在局部生效。
      2. **公式解耦（陆地生成）**：
         - 将旧 T2 河阶外低丘（`outside >= bank + terrace`）的高程公式 `level + 2.0 + u*2.0 + ((outside - bank - terrace).max(0.0)/size * cfg.terrain_ridge_amplitude.max(1.0)) * (0.8 + 0.2*(p.y/90.0).sin())`、地表类别 `DryGround`、肥力 `0.75` 与标志 `0`，提取为 `river_valley_v1` profile 的陆地区域基础生成步骤（整合入流水线第 2 步 `generate_base_relief`）；
      3. **水系写入收敛（水系带局部覆盖）**：
         - `generate_river`（流水线第 3 步 `apply_profile_static_hydrology`）改写为**仅作用于水系影响带**（即横向距离 `d < half_width + bank + terrace` 的局部网格），只覆盖河面、浅滩、河岸与河阶；外侧陆地严格保持陆地生成结果；
      4. **施工硬门禁（§5.3 兼容性拆分）**：
         - 必须严格保持原算式、浮点运算顺序、边界判据、RNG 消费序列以及最终网格高程/坡度/地表/flags 结果 100% 逐比特一致！
         - 严禁仅缩小循环范围而留下原先被覆盖的 T0 地貌；统一派生也不得顺带更改旧 T2 的陆地分类。
    - **出处**：06 号 §5.3 阶段二兼容性拆分（施工硬门禁）、§1.3 第 4 条、`crates/sim_core/src/geo/AGENTS.md`。
    - **验收**：临时对拍脚本比对显式 `river_valley_v1` 下 60 个固定种子（seed 0–59）改造前后的高程数组、地表数组、肥力数组与 flags 数组，达成 100% 逐位全等（脚本用后按 §4.10 删除）。
    - **依赖**：无（可与 STAGE2-1 并行）。

---

### STAGE2-3 创世流水线阶段化重构（0–11 步无歧义管线）

- [ ] **STAGE2-3 规范化创世流水线重构与内部接口解耦**
    - **内容**：
      1. 在 `crates/sim_core/src/geo/terrain.rs` 与 `hydrology.rs` 中将 `generate_with_config` 重构为 §5.3 定义的私有阶段管线：
         - `0. resolve_profile(seed, profile)`：解析 profile，不消费任何 WorldRng；
         - `1. reset_static_terrain_state()`：清空 features、accents、sub_features、hydrology；
         - `2. generate_base_relief(seed, profile)`：生成基础起伏（山口起伏 / 河谷低丘），严格保持现有主 RNG 与 `relief_rng` 消费顺序；
         - `3. apply_profile_static_hydrology(seed, profile, config)`：T2 主河水系覆盖（经 STAGE2-2 收敛），P1 水系预留；
         - `4. plan_subfeatures(seed, profile, enabled)`：调用 D-B1-3 已落地的纯哈希选择器；
         - `5. 按 kind 升序处理子特征（阶段二搭建几何管线框架）`：
           - 5a. `snapshot_bbox(f)`：局部 AABB 内原高程快照复制；
           - 5b. `apply_subfeature_geometry(f)`：几何施加桩（只改高程与水面，不写 slope/flags）；
           - 5c. `recompute_slopes_scratch(f)`：AABB 局部临时坡度试算；
           - 5d. `accept_or_rollback(f)`：几何类接受判定桩，失败时按快照整块回滚；
           （阶段二此步保持空注入，但数据管线、快照结构与回滚接口完整就位）；
         - `6. recompute_slopes(); derive_surface_and_flags(profile)`：全图唯一定稿坡度与派生/合并 flags 的位置（水面/河岸/河阶保留其优先 surface_kind，陆地格根据坡度合并 `NO_WALK`/`NO_BUILD`）；
         - `7. validate_static_terrain_geometry()`：静态几何校验（调用 STAGE2-4）；
         - `8. generate_base_accents(seed, density)`：既有 `accent_rng` 装饰生成，消费顺序不变；
         - `9. append_subfeature_accents(seed, plan, terrain, density)`：专属装饰追加接口；
         - `10. ecology 布局与路网连接`：仅读取定稿地表；
         - `11. validate_terrain_world + 生存成本诊断`：输出诊断结果供有界重试消费。
      2. **约束**：第 5 步只改高程与几何，第 6 步是全图唯一写 `slope_angle_deg` 与派生 flags 的位置；临时坡度计算仅限局部 Scratch 内存。
    - **出处**：06 号 §5.3 无歧义创世流水线、§5.2.1 事实层分工。
    - **验收**：现有 T1 与 T2 世界生成结果逐字节不变；临时断言验证步骤 0–11 调用时序严格执行。
    - **依赖**：STAGE2-2。

---

### STAGE2-4 静态地形几何校验与稳定 ID 断言落地（§5.2 / §5.3 第 7 步）

- [ ] **STAGE2-4 静态地形几何校验与稳定 ID 断言**
    - **内容**：
      1. 在 `crates/sim_core/src/geo/terrain.rs` 实现 `validate_static_terrain_geometry(&self) -> Result<(), &'static str>`：
         - **特征 ID 升序与唯一性断言**：断言 `self.features` 集合按 `id` 严格升序排列，且所有 ID 唯一无碰撞（§5.2）；
         - **T2 核心水系 ID 范围保护**：River=1、ShallowFord=10/11、RiverBank=20/21、SpringValley=30 绝不重排；
         - **水体顶点双副本一致性断言**：断言 `self.hydrology.water_bodies` 中每个水体的 `vertices` 与 `self.features` 对应 `WaterBody` 特征的 `vertices` 逐字节严格相等（§5.2.1 明确要求的副本一致性校验，杜绝几何漂移）；
         - **浅滩端点合法性**：浅滩走廊两端端点落在非深水陆侧，且授权走廊覆盖范围内格点正确标注 `CROSSING_CANDIDATE`；
         - **边界安全与禁行/禁建一致性**：水体不溢出地图边界；`RockFace` 格点必须包含 `NO_WALK` 与 `NO_BUILD` 标志。
      2. 将该校验接入流水线第 7 步，校验失败时直接返回明确错误码进入 STAGE2-5 重试环。
    - **出处**：06 号 §5.2 单一真相源与稳定 ID 表、§5.2.1 事实层分工与顶点副本断言、§5.3 第 7 步。
    - **验收**：现有 T1/T2 显式种子 0–59 全部通过校验；临时单测注入 ID 重复或顶点不一致样本能准确拦截报错。
    - **依赖**：STAGE2-3。

---

### STAGE2-5 有界失败降级与重试机制（§5.8 阶梯回退环）

- [ ] **STAGE2-5 有界重试与阶梯降级状态机落地**
    - **内容**：
      1. 在创世入口（`spatial/world.rs` 或 `geo/terrain.rs`）实现 §5.8 规定的阶梯降级逻辑：
         - 步骤 1：尝试完整 profile + 已选子特征（初始 `disabled_mask = 0`）；
         - 步骤 2：执行静态几何校验 `validate_static_terrain_geometry`；
         - 步骤 3：执行生态落位、路网构建与世界合法性校验；
         - 步骤 4：执行 STAGE2-6 生存距离与成本诊断；
         - 步骤 5（降级阶梯）：若上述任一步骤失败：
           - 阶梯 A：按「结构型 -> 视觉型」逆序禁用一个子特征，重置世界并重试；
           - 阶梯 B：若仍失败，使用同 profile 的无子特征版本重试；
           - 阶梯 C：若仍失败，在 `config.terrain_generation_max_retries` 重试上限内尝试平坦基线（`flat_baseline`，STAGE2-7）；
           - 阶梯 D：若最终依然失败，返回携带 `seed`、`profile`、`generator_version`、`attempt`、`disabled_mask`、`failure_code` 的初始化错误。
      2. **确定性铁律**：重试只改变明确记录的 feature mask，**严禁更换 seed、严禁改变全局 RNG 消费序列、严禁在运行中搬迁 Agent 或修补地块**。
      3. **日志规范**：仅在重试或降级触发时输出结构化日志，正常每 tick 运行零噪音。
    - **出处**：06 号 §5.8 有界失败、诊断与验收矩阵、§18.2 T1 门禁 ⏳ 项。
    - **验收**：临时构造失败条件验证降级状态机阶梯流转正确；重试次数严格受 `terrain_generation_max_retries` 约束；重试期间 RNG 序列无污染。
    - **依赖**：STAGE2-1（重试上限配置）、STAGE2-4（静态几何校验）。

---

### STAGE2-6 初始营地生存连通分量与往返成本诊断（补齐 §18.1 门禁）

- [ ] **STAGE2-6 初始生存连通性与往返成本诊断**
    - **内容**：
      1. 在创世完成且路网生成完毕后（流水线第 11 步）实现生存成本与连通性诊断：
         - **生存连通分量校验**：全部 4 个初始营地、主要水资源 POI、浆果丛 POI 与榷场必须位于同一个陆路可行走连通分量内（无不可逾越的深水或陡坡硬禁行截断）；
         - **往返成本上限诊断**：计算每个初始营地到最近可用水源 POI 及集市的实际折算路径成本（结合 `LaneTerrainProfile` 坡度与软地慢行系数），断言往返耗时低于生存诊断上限（确保族人在开局基础代谢下不会因过远路程直接渴死/饿死）；
      2. 诊断不通过时返回明确失败码（如 `SpawnDisconnected`、`SurvivalCostExceeded`），向外冒泡给 STAGE2-5 有界回退环进行降级。
    - **出处**：06 号 R.1 遗留缺口、§18.1 T0 门禁第 4 条（⏳ → ✅）、§5.8、§1.3 末段。
    - **验收**：现有 T1 与 T2 的固定种子（seed 0–59）全部通过生存诊断；记录现有世界营地到水源的往返成本基线；人为阻断水源时能被精准捕获并触发重试。
    - **依赖**：STAGE2-3、STAGE2-5。

---

### STAGE2-7 `flat_baseline` 行为等价基线支持（补齐 §18.1 门禁）

- [ ] **STAGE2-7 `flat_baseline` 行为等价基线支持**
    - **内容**：
      1. 针对 §18.1 遗留门禁「现有无新地貌基线在关闭地形 profile 后保持行为等价」：
         - 在 profile 枚举/常量与流水线中正式支持 `flat_baseline` profile（纯 T0 基础倾斜 + 平缓起伏波动，无主脊、无主河）；
         - 确保 `flat_baseline` 可作为 STAGE2-5 阶梯回退中的终极简化保底 profile；
         - 验证在 `flat_baseline` 下地表生成、POI 播撒、路网连通性与确定性行为正常，全图可行走连通分量恒为 1。
      2. 该 profile 作为纯基线 profile，其生成算法与既有 T0 纯起伏逻辑严格等价。
    - **出处**：06 号 R.1 遗留缺口、§18.1 T0 门禁第 5 条（⏳ → ✅）。
    - **验收**：显式指定 `profile: 'flat_baseline'` 可成功创世，确定性矩阵测试全通，存读档无残留；关闭 profile 时系统平稳运行。
    - **依赖**：STAGE2-3、STAGE2-5。

---

### STAGE2-8 阶段二代码收口：跨构建差分全等验证 + 遗留门禁销项 + 文档同步

- [ ] **STAGE2-8 阶段二验收收口与全套门禁复核**
    - **内容**：
      1. **跨构建物理等价差分（§5.3 施工硬门禁）**：
         - 基准提交：阶段一收口最终产物 `4373190`（v1.50.38）；
         - 测试矩阵：显式 `mountain_pass_v1` 与 `river_valley_v1` × seed 0–59（共 120 组），分别测试 `terrainAccentSubFeatures=false` 与 `true`；
         - 比较范围：高程、坡度、地表类别、feature_flags、肥力、水系、POI、路网节点与车道拓扑；
         - 判定标准：**逐字节 100% 全等（物理差异 0）**！`TERRAIN_GENERATOR_VERSION` 保持 4，`SAVE_FORMAT_VERSION` 保持 7。
      2. **三项遗留门禁销项核对**：
         - §18.1 生存连通分量与往返成本诊断（⏳ → ✅，由 STAGE2-6 交付）
         - §18.1 `flat_baseline` 行为等价（⏳ → ✅，由 STAGE2-7 交付）
         - §18.2 有界重试与简化 profile 回退（⏳ → ✅，由 STAGE2-5 交付）
         - 06 号 R.1 状态表中 T0 与 T1 的遗留缺口全部清零！
      3. **执行全套 R.5 通用门禁**：
         ```powershell
         cargo test --lib
         cargo build -p sim_wasm --target wasm32-unknown-unknown --release
         Copy-Item "target\wasm32-unknown-unknown\release\sim_wasm.wasm" -Destination "frontend\rust\sim_wasm.wasm" -Force
         Copy-Item "target\wasm32-unknown-unknown\release\sim_wasm.wasm" -Destination "frontend\sim_wasm.wasm" -Force
         node tools/test-wasm.js
         node tools/test-determinism.js
         node tools/config-check.js
         node tools/frontend-check.js
         node tools/cross-doc-check.js
         node tools/doc-link-check.js
         node tools/code-map-check.js
         node tools/doc-maintenance-check.js
         ```
      4. **文档同步**：
         - 更新 `docs/plan/tech/06-terrain-templates.md`：R.1 遗留缺口更新、R.3 阶段二状态更新、§2.3 状态表更新、§18.1/§18.2 门禁状态 ⏳ → ✅、§20 退出标准更新；
         - 更新 `docs/current/tech/14-terrain-and-network.md`：流水线现状与配置清单同步；
         - 更新 `TODO.md` 与根目录任务状态；
         - 若包含 Rust 代码变更，按根 AGENTS.md §4.9 升版并同步 WASM 双副本，追加 `docs/current/01-changelog.md` 版本条目。
    - **出处**：06 号 R.3、§5.1、§5.3 末段、§18.1、§18.2、§20。
    - **验收**：差分 120 组零差异，门禁全绿，阶段二代码交付正式完结，解锁阶段三。
    - **依赖**：STAGE2-1 ～ STAGE2-7 全部完成。

---

## 门禁与验收速查表

| 门禁项 | 运行命令 | 预期指标 | 对应任务 |
| :--- | :--- | :--- | :--- |
| **Rust 编译与测试** | `cargo test --lib` | 0 报错（无持久化单测，§4.10） | 全部 Rust 任务 |
| **WASM 构建与双副本** | `cargo build -p sim_wasm --release` + 复制 | 双副本 SHA256 完全一致 | 全部 Rust 任务 |
| **WASM 确定性与长程稳定** | `node tools/test-wasm.js` | `ALL_TESTS_DONE`（存读档/无NaN/无越界） | STAGE2-3, 5, 8 |
| **确定性矩阵测试** | `node tools/test-determinism.js` | 6/6 套件全通（多种子/分批独立性/存读档） | STAGE2-3, 5, 8 |
| **配置一致性与空转检查** | `node tools/config-check.js` | 字段数 234=234，第 5 条空转参数 0 命中 | STAGE2-1, 8 |
| **前端代码完整性** | `node tools/frontend-check.js` | 35 个 JS 脚本语法与 DOM ID 全绿 | STAGE2-1, 8 |
| **跨文档一致性** | `node tools/cross-doc-check.js` | 冲突 0 · 漂移 0 | STAGE2-8 |
| **文档链接可达性** | `node tools/doc-link-check.js` | 全部相对链接可达（0 失效） | STAGE2-8 |
| **跨构建物理等价差分** | 临时差分脚本（规范化导出） | 120 组种子 × 开关两态物理字段 100% 全等 | STAGE2-2, 8 |
