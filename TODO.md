# TODO · 项目开发待办事项

> **定位**：记录 Flow & Accord 当前进行中与未来规划中的核心开发任务。已完成的任务与阶段性成果及时归档至各权威技术文档与 [01-changelog.md](docs/current/01-changelog.md)，保持本文档精简、聚焦未来。
> **开发纪律**：一次提交只做一件事（禁止合并大改）；含 Rust 改动的任务完成后重编译 WASM 并同步双副本；纯文档/计划修订不升版。

---

## 0. 📦 已收官阶段与归档索引

为了保持待办清单聚焦未来代码开发，以下已 100% 交付收口的阶段性任务已自本文档清理归档，详细验收证据与技术规格请查阅对应权威文档：

- **阶段一代码线（D-B1-1～7, D-B1-9）**：装饰扩展与子特征快照基础设施，v1.50.29～35 交付收口。详见 [06 号文 §18.5](docs/plan/tech/06-terrain-templates.md#185-d-b1-子特征注入骨架验收标准与检查单)。
- **阶段二（STAGE2-1～8）**：生成组合基座与有界回退环，v1.50.39～49 交付收口。详见 [14 号 §8.2](docs/current/tech/14-terrain-and-network.md#82-阶段二分层验收与归档证据v15049)。
- **阶段四通用部分（S4-01～08）**：通用 POI 景观群与几何遮罩避让、标签聚合，v1.50.46～53 交付收口。详见 [16 号 §2.16～§2.18](docs/current/tech/16-frontend-overview.md#216-资源地貌与景观群表现层landscape-model--render_landscapes-v15046-d-c)。
- **阶段七（S7-01～10）**：独立地图模板（平地草原、半坡林地、河谷聚落），v1.50.39～52 交付收口。原 `STAGE-07-TODO.md` 已随收官归档清理，详见 [06 号 §4.1～§4.3](docs/plan/tech/06-terrain-templates.md#41-平地草原grassland_plain_v1设计登记2026-09-11排期2026-09-13阶段七插队位)。
- **TB-02 台地内核（TB-02-01～10）**：台地模板（原 `plateau_settlement_v1`，v1.50.68 更名 `plateau_v1`，显示名"台地聚落"→"台地"），v1.50.54 交付收口。原 `TB-02-IMPLEMENTATION-PLAN.md` 已随收官归档清理，详见 [14 号 §8.2](docs/current/tech/14-terrain-and-network.md#82-阶段二分层验收与归档证据v15049)。
- **TA-12-2 地表纹样表现层**：`terrain-texture.js` 坡度分带与 fBm 纹理采样，v1.50.54 交付收口。详见 [01-changelog.md](docs/current/01-changelog.md)。
- **WebGL 渲染迁移阶段一/二**：双 Canvas 架构上线（v1.50.77）——地形（含沙盘侧壁）由 `frontend/js/webgl/` 绘制在底层 `sim-canvas-gl`，实体/装饰仍在 Canvas 2D 覆盖层 `sim-canvas`；v1.50.80~82 帧率解限。★ 2026-09-17 架构决策已升级为**全量 WebGL、不再使用 Canvas 2D**，双 Canvas 属过渡形态；阶段三~五转为既定路线，详见 [31 号迁移方案 §8](docs/plan/tech/31-canvas-to-webgl-migration.md)，实现现状见 `frontend/AGENTS.md`。

---

## 1. 🎨 表现层与视觉样板任务

- [ ] **D-B1-8 场景样板：支脊山口 + 岩壁河谷（美术侧）**
    - **代码前置（v1.50.51）**：统一第 5c 步局部坡度试算与第 6 步全图定稿判据，移除全图定稿的高程复制；现状机制见 [14 号 §8.1](docs/current/tech/14-terrain-and-network.md#81-静态几何校验与生存成本诊断v15047--stage2-46)。此项不等于 RiverCliff 几何注入或实机验收完成。
    - **进展（2026-09-14）**：双场景视觉目标草案已交付，用户已明确“接受构图方向”；图稿、提示词、前置源码核对与后续实机证据矩阵归档至 [07 号 §4.4.1](docs/plan/tech/07-terrain-art.md#441-ta-09-构图评审与实机交付记录)。阶段三 RiverCliff 尚未完成（TA-08 已删除视为完成），真实种子/存档及两场景实机验收待交付，保留未勾选；TODO.md 尚不满足清空条件。
    - 内容：两种固定场景的构图与美术打样，把地表色彩、岩层、成组植被、道路可读性、植被受光纳入同一画面（07 号任务 TA-09，旧编号 §9-1，详见 07 号 §4.4/§7）。先评审标为视觉目标的构图草案，再交付真实种子实机样板；注意前置 TB-01 及 06 号阶段三 RiverCliff（TA-08 已删除视为完成），可按 07 号波次排期推进，不阻塞 D-B1 代码线。
    - 出处：06 号 R.3 阶段一（原 §5.9 第 1 条）、07-terrain-art.md §1.2 TA-09。
    - 验收：构图草案评审 + 两场景实机验收均通过，记录种子/存档、版本、配置、窗口/DPR 及四季/旋转/俯角/景别、遮挡/接地/性能证据（07 号 §4.4/§11）；草案通过不得提前勾选。**纯视觉样板不冒充物理验收**（§5.8/§18 门禁独立于本项）。★ 遮挡项判据以 [31 号 §8.5 验收矩阵](docs/plan/tech/31-canvas-to-webgl-migration.md) 为准（原 TA-08 §2 并入，任务已删除视为完成）；若排在 TC-03 迁移之后，直接按 WebGL 管线口径验收。
    - 依赖：07 号美术波次（TB-01）及 06 号阶段三 RiverCliff（TA-08 已删除视为完成）；构图草案可先行，实机验收须等两项完成。

- [ ] **特定地貌专属景观群与房屋院地（S4-X1～X4 & TA-17-COURTYARD）**
    - 详见专项待办清单：[STAGE-04-SUBFEATURE-LANDSCAPES-TODO.md](STAGE-04-SUBFEATURE-LANDSCAPES-TODO.md)
    - 包含：
      - `S4-X1` 山脚湖岸专属景观（依赖阶段三 FootLake 几何注入器）
      - `S4-X2` 山涧瀑布专属景观（依赖阶段三 RidgeWaterfall 注入器）
      - `S4-X3` 河谷峭壁专属景观（依赖阶段三 RiverCliff 注入器）
      - `S4-X4` 牛轭湖岸专属景观（依赖阶段三 OxbowLake 注入器）
      - `TA-17-COURTYARD` 聚落房屋院地与门前通道留白（依赖门洞矢量确认）

- [ ] **TA-05 P0 植被打样技术方案**
    - 详见 [09 号验证方案](docs/plan/tech/09-vegetation-verification.md)（由根目录临时方案 `TA05-technical-plan.md` 收口精简而来）与 [07 号文 §11.4](docs/plan/tech/07-terrain-art.md) 验收记录；TA-05 现状 ◐（LOAD 存档链路待 Chrome 补测）。
    - 聚焦树木与植被群落在实体覆盖层视口下的高质量层次打样（地形底座已迁 WebGL 层，见 §0 归档索引）。★ 覆盖层属过渡形态（2026-09-17 决策：全量 WebGL），验收口径以几何/季相/受光数值一致性为主，不依赖覆盖层实现细节，以便迁移后复用同一批证据。

- [x] **TA-06 植被轮廓与物种变体（三乔木 + 三灌木）**
    - 详见 [TA-06 实施方案](TA-06-TODO.md) 与 [07 号文 §6.3/§11.4](docs/plan/tech/07-terrain-art.md)；TA-06 现状 ✔ 验收通过（2026-09-22，v1.52.3）：实现层 v1.50.64 落地（物种派生 + 三乔木轮廓 + 三灌木变体 + 花朵图元 + 冠幅单一来源联动）；WebGL 实况 96 视图矩阵验收与证据包（`docs/plan/tech/assets/ta06-evidence-2026-09-22/`，景观共用通道物种一致 57 对零失配、暖冷缓存一致、三档真实覆盖、四季与花历数值矩阵全过）；长期调试工具植被观察台 `ta06-acceptance.js`（调试监视器内入口）+ seed42 七株身份表 + 用户逐项走查 §9 清单通过。**性能 A/B 按「已无性能问题」取消**（同 TA-07-10 口径）；**Chrome 真实存档 LOAD 链路仍 NOT_RUN**（须 Chrome/Edge File System Access API，可与 TA-05 LOAD 补测合并）。
    - 由 `accent.id` 稳定哈希派生 6 物种，零新增持久化字段/FABS section/模拟参数。

- [x] **TA-07 装饰细节分级 LOD + 投影包围体剔除（✔ 已取消视为完成 2026-09-22）**
    - 取消理由：本任务的原生驱动力是性能，而**当前已无性能问题**；仅剩 TA-07-9（Chrome 视觉验收）与 TA-07-10（六场景性能 A/B）两项证据补采，经用户确认随任务取消不再追补。
    - **实现保留、不回退**：TA-07-1~8 + TA-07-11 已于 v1.50.65 落地，且在今天默认的 **WebGL 路径下照常生效**（`accent-lod.js` 判档与入队两级剔除全在 CPU 侧，与渲染后端解耦）——四条防回退红线仍见 [frontend/AGENTS.md](frontend/AGENTS.md)；下游 TA-18 的前置改为「TA-07 的实现」。原方案文档 [TA-07-TODO.md](TA-07-TODO.md) 保留作历史记录（同 TA-08 先例）。

- [ ] **TC-03 全量 WebGL 迁移（★ 2026-09-17 定为既定路线）**
    - 详见 [31 号迁移方案 §8 阶段三~五](docs/plan/tech/31-canvas-to-webgl-migration.md)：阶段三装饰层 → 阶段四实体层 → 阶段五 Canvas 2D 退役（删除 `#sim-canvas` 2D 覆盖层与 `fallback-handler.js` 的 2D 回退分支）。
    - 前置：现行性能数据（07 号 §11.3）；遮挡由 GPU 深度缓冲解决，原 TA-08 三策略已取消，TA-08 任务已删除视为完成（验收矩阵并入 [31 号 §8.5](docs/plan/tech/31-canvas-to-webgl-migration.md)）。
    - 约束：几何/筛选逻辑（`accent-model.js` / `accent-lod.js` / `accent-season.js` / `landscape-model.js` / `landscape-mask.js`）保持与渲染后端解耦，迁移整体复用；不得改变 `WorldRng` 消费顺序、几何派生规则与快照契约。

- [x] **TA-08 遮挡实测与验收矩阵（✔ 已删除视为完成 2026-09-17）**
    - 原任务文档 `TA-08-blocking-measurement.md` 已从仓库根目录删除：重定向后仅剩「测量脚本 + 证据包」工作，**无任何功能开发任务**，经用户确认删除并视为完成。
    - 原「模型内排序 / 实体拆子项 / 屏幕空间兜底」三策略随全量 WebGL 决策取消；§2 遮挡验收矩阵并入 [31 号迁移方案 §8.5](docs/plan/tech/31-canvas-to-webgl-migration.md)，遮挡技术解由 TC-03 GPU 深度缓冲承担，Canvas 2D 基线证据包不再采集。

- [ ] **TA-10 台地表现层打样**
    - 详见 [07 号文 §8](docs/plan/tech/07-terrain-art.md)
    - 对接 TB-02 台地内核（plateau_v1），实现台地边缘陡壁断崖质感、坡顶平台景观与双入口缓坡路面表达。

---

## 2. 🌍 地图与物理内核后续阶段

- [ ] **阶段三 · 结构型子特征注入（D-B3）**
    - 目标：将 FootLake（山脚湖）、RidgeWaterfall（山涧瀑布）、RiverCliff（河谷峭壁）、OxbowLake（牛轭湖）等物理子特征以几何事务方式注入地图流水线（第 4～5 步）。
    - 约束与门禁：按 [06 号 §5.4.D](docs/plan/tech/06-terrain-templates.md) 执行岩壁离散尺度探针准入，候选参数不得当作已验证默认值；注入失败必须经由阶段二的有界回退环安全降级。
    - 联动：注入器落地后，同步解锁阶段四专属景观（S4-X1～X4）。

- [ ] **阶段八 · 复杂地貌模板**
    - 规划模板：湖畔盆地（`lake_basin_v1`）、冲积扇（`alluvial_fan_v1`）等。
    - 规格详见 [06 号文 R.3 / §4.4+](docs/plan/tech/06-terrain-templates.md)。

- [ ] **TB-04 盆地群峰环抱与峡谷出水口地貌重构 (Basin Mountain Encirclement & Gorge Outlet)**
    - 详见专项技术方案：[10-basin-mountain-encirclement.md](docs/plan/tech/10-basin-mountain-encirclement.md) 与 [06 号文 §5.6](docs/plan/tech/06-terrain-templates.md)。
    - 目标：彻底解决盆地模板（`basin_oasis_v1`）“四周被一块平地环绕”的非自然几何缺陷，重构为由崇山峻岭与起伏峰脊闭合环抱、向内倾斜山嘴支脊与冲沟雕琢、单一穿山峡谷出水口与开阔盆底冲积平原构成的自然山间盆地。
    - 核心实现：闭合环形主山脊线 $R_{\text{ridge}}(\theta)$ 与起伏天际线 $Z_{\text{crest}}(\theta)$；内外双坡解耦（内坡绝壁自然派生 `RockFace` + `NO_WALK`，外坡延伸至图缘连绵峰峦，沙盘侧壁切面呈现锯齿山体）；深切峡谷出水口与盆底蜿蜒河流；60 种子探针 100% 单连通分量（`components == 1` 无死区）与 $\ge 11,500$ 可建格。

- [ ] **远期动态扩展（T4）**
    - 地图动态边界扩展与无限演化支持，待远期独立立项。

---

## 3. 🧠 族人社会/生理/经济子系统规划

根目录下维护的未落地核心子系统技术与任务规划，开发新特性时按需开工：

- [ ] **激素与情绪生理系统（Hormone System）**
    - 详见专项清单：[hormone-TODO.md](hormone-TODO.md)
    - 任务覆盖 H-01～H-20，构建多巴胺、内啡肽、皮质醇等激素网络，驱动情绪与深层行为涌现。

- [ ] **亲密度与社交网络（Affinity System）**
    - 详见设计方案：[AFFINITY_IMPLEMENTATION_PLAN.md](AFFINITY_IMPLEMENTATION_PLAN.md)
    - 实现族人个体间的好感度记忆、家庭与血缘演化、动态社交圈层。

- [ ] **内部市场与商品经济（Internal Market System）**
    - 详见设计方案：[INTERNAL_MARKET_IMPLEMENTATION_PLAN.md](INTERNAL_MARKET_IMPLEMENTATION_PLAN.md)
    - 构建族人间物物交换、私产确权、家庭间供需平衡与内部定价机制。
