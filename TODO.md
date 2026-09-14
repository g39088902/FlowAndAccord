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
- **TB-02 台地聚落内核（TB-02-01～10）**：台地聚落模板 `plateau_settlement_v1`，v1.50.54 交付收口。原 `TB-02-IMPLEMENTATION-PLAN.md` 已随收官归档清理，详见 [14 号 §8.2](docs/current/tech/14-terrain-and-network.md#82-阶段二分层验收与归档证据v15049)。
- **TA-12-2 地表纹样表现层**：`terrain-texture.js` 坡度分带与 fBm 纹理采样，v1.50.54 交付收口。详见 [01-changelog.md](docs/current/01-changelog.md)。

---

## 1. 🎨 表现层与视觉样板任务

- [ ] **D-B1-8 场景样板：支脊山口 + 岩壁河谷（美术侧）**
    - **代码前置（v1.50.51）**：统一第 5c 步局部坡度试算与第 6 步全图定稿判据，移除全图定稿的高程复制；现状机制见 [14 号 §8.1](docs/current/tech/14-terrain-and-network.md#81-静态几何校验与生存成本诊断v15047--stage2-46)。此项不等于 RiverCliff 几何注入或实机验收完成。
    - **进展（2026-09-14）**：双场景视觉目标草案已交付，用户已明确“接受构图方向”；图稿、提示词、前置源码核对与后续实机证据矩阵归档至 [07 号 §4.4.1](docs/plan/tech/07-terrain-art.md#441-ta-09-构图评审与实机交付记录)。TA-08 与阶段三 RiverCliff 尚未完成，真实种子/存档及两场景实机验收待交付，保留未勾选；TODO.md 尚不满足清空条件。
    - 内容：两种固定场景的构图与美术打样，把地表色彩、岩层、成组植被、道路可读性、植被受光纳入同一画面（07 号任务 TA-09，旧编号 §9-1，详见 07 号 §4.4/§7）。先评审标为视觉目标的构图草案，再交付真实种子实机样板；注意前置 TB-01 / TA-08 及 06 号阶段三 RiverCliff，可按 07 号波次排期推进，不阻塞 D-B1 代码线。
    - 出处：06 号 R.3 阶段一（原 §5.9 第 1 条）、07-terrain-art.md §1.2 TA-09。
    - 验收：构图草案评审 + 两场景实机验收均通过，记录种子/存档、版本、配置、窗口/DPR 及四季/旋转/俯角/景别、遮挡/接地/性能证据（07 号 §4.4/§11）；草案通过不得提前勾选。**纯视觉样板不冒充物理验收**（§5.8/§18 门禁独立于本项）。
    - 依赖：07 号美术波次（TB-01、TA-08）及 06 号阶段三 RiverCliff；构图草案可先行，实机验收须等三项完成。

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
    - 聚焦树木与植被群落在 Canvas 视口下的高质量层次打样。

- [ ] **TA-06 植被轮廓与物种变体（三乔木 + 三灌木）**
    - 详见 [TA-06 实施方案](TA-06-TODO.md) 与 [07 号文 §6.3/§11.4](docs/plan/tech/07-terrain-art.md)；TA-06 现状 ◐ v1.50.64（实现与静态/数值验证已落地：物种派生 + 三乔木轮廓 + 三灌木变体 + 花朵图元 + 冠幅单一来源联动；**待补**：Chrome 视觉·受光·四季矩阵验收与证据包、性能 A/B、景观共用通道抽查、LOAD 链路——建议与 TA-05 LOAD 补测合并为同一次 Chrome 存档会话）。
    - 由 `accent.id` 稳定哈希派生 6 物种，零新增持久化字段/FABS section/模拟参数。

- [ ] **TA-10 台地聚落表现层打样**
    - 详见 [07 号文 §8](docs/plan/tech/07-terrain-art.md)
    - 对接 TB-02 台地聚落内核，实现台地边缘陡壁断崖质感、坡顶平台聚落景观与双入口缓坡路面表达。

---

## 2. 🌍 地图与物理内核后续阶段

- [ ] **阶段三 · 结构型子特征注入（D-B3）**
    - 目标：将 FootLake（山脚湖）、RidgeWaterfall（山涧瀑布）、RiverCliff（河谷峭壁）、OxbowLake（牛轭湖）等物理子特征以几何事务方式注入地图流水线（第 4～5 步）。
    - 约束与门禁：按 [06 号 §5.4.D](docs/plan/tech/06-terrain-templates.md) 执行岩壁离散尺度探针准入，候选参数不得当作已验证默认值；注入失败必须经由阶段二的有界回退环安全降级。
    - 联动：注入器落地后，同步解锁阶段四专属景观（S4-X1～X4）。

- [ ] **阶段八 · 复杂地貌模板**
    - 规划模板：湖畔盆地（`lake_basin_v1`）、冲积扇（`alluvial_fan_v1`）等。
    - 规格详见 [06 号文 R.3 / §4.4+](docs/plan/tech/06-terrain-templates.md)。

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
