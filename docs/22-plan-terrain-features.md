# 新地形特征、地理玩法与实施技术方案

> **状态**：T0 统一地表查询、T1 山口聚落、T2 两岸河谷水系与 D-A 地表装饰系统**均已落地**（T1/T2 于 v1.47.5，生成器版本 3；D-A 于 v1.49.1，v1.49.2/v1.49.3/v1.50.10 持续打磨）；T1/T2 **子特征注入**、D-B/D-C 高级装饰为**新增规划（v1.48.0）**；T4 动态水文、桥梁与土地演化**未实现、未排期**。
> **本文定位**：地形领域**唯一权威文档**——同时承载「地形种类与地理玩法」与「实施技术方案」两部分。2026-09-11 由原 `22-plan-terrain-features.md`（方向设计）与 `26-plan-terrain-implementation.md`（实施技术方案）合并而成，26 号已删除；合并时按当前代码事实校正了原 26 号中已过时的落地状态（D-A 装饰已落地、`render_terrain.js` 已拆分、配置已达 240 字段）。
> **整理日期**：2026-09-11（合并日）；方案优化基线 v1.48.0，现状基线 v1.50.16。
> **入口**：[文档导航](./README.md) · [长期路线图](./11-plan.md) · [地形美术与世界景观提升](./21-plan-terrain-art.md)。
> **依据**：[25-plan-system-integration.md](./25-plan-system-integration.md)、[21-plan-terrain-art.md](./21-plan-terrain-art.md)、[27-plan-seasonal-lighting.md](./27-plan-seasonal-lighting.md)、[28-plan-river-shoreline-refinement.md](./28-plan-river-shoreline-refinement.md)。
> **现状以** `docs/current/01-spatial-network.md`、`08-config-system.md`、`15-save-load.md`、`07-frontend-ui.md` 与 `11-changelog.md` 为准。

> **阅读指引**：第 1～4 节是**设计与玩法契约**（为什么这样设计、地图要有哪些地方、生成顺序与有效世界底线）；第 5～19 节是**实施技术方案**（数据模型、生成器、路网、快照存档、前端、配置、文件清单与验收门禁）。实施细节若与 `docs/current/` 冲突，以现状文档与源码为准。

## 1. 设计目标与责任边界

让地图拥有可以被记住的地方：一条把聚落分隔两岸的河、一处绕山必经的山口。地形同时改变画面轮廓、路线选择和聚落条件，帮助玩家理解“为什么人们住在这里、走这条路”。

内核地形以高程与坡度为基础，见 [biome.rs](../crates/sim_core/src/geo/biome.rs)；[terrain.rs](../crates/sim_core/src/geo/terrain.rs) 使用倾斜大势与平滑起伏。本文是在此基础上的扩展，不将已有坡地改名当作新功能。

本文是**地形种类、生成关系、通行、选址和水资源语义**的规划权威；[景观提升计划](./21-plan-terrain-art.md)负责材质、光照、素材、遮挡、缓存与视觉性能。土地适宜性由地形提供，农田产权、投资与产出仍由[农业规划](./17-plan-farmland-agriculture.md)负责。

### 1.1 核心原则

1. **Rust 地理事实唯一真相源**：前端只绘制内核提供的高程、地表类别、水域、岸带、连接设施与装饰位置，不用装饰反推碰撞或资源。
2. **先走廊后曲线**：先在栅格上找合法通行走廊，再拟合 `Curve3D`；不能用节点端点合法替代整条曲线合法。
3. **静态拓扑先行**：T1/T2 的地形、水位、浅滩和禁建区在创世时确定；运行中不改变道路拓扑，降低缓存和存档风险。
4. **水体几何与水资源池分离**：河湖可以有连续视觉轮廓，但可采水点引用共享资源池，不按岸点重复发库存。
5. **同一查询服务供房屋、农业、防务和路网消费**：不再让各模块分别判断坡度、占地、水域和接路。
6. **新增随机只使用地形局部 RNG**：地貌结构、子特征与装饰不污染现有世界 RNG；POI、始祖、出生等既有消费顺序保持不变。
7. **同版本同种子确定性优先于旧地图兼容**：生成器变更必须通过版本门禁拒绝旧存档，不能把旧路网与新地貌静默拼接。
8. **装饰不产生物理事实**：地表装饰（树木/岩石/灌木）是纯视觉层，不参与通行、资源、碰撞与建造判定。

## 2. 地形种类与地理玩法

> v1.48.0 方案优化：**取消独立 T3 profile 阶段**。原 T3 的湖泊/湿地/峡谷/瀑布重组为「T1/T2 子特征注入」+「地表装饰系统（Accents）」两大方向；湿地因视觉辨识度低而明确删除。下表「落地路径」列反映这一重组。

| 地形 | 视觉识别点 | 主要玩法价值 | 落地路径 |
|---|---|---|---|
| 丘陵 | 连续缓坡、局部露岩 | 建房地点与绕行距离的取舍 | ✅ T1 已落地 |
| 山脊与山口 | 有方向的山体、鞍部、裸岩坡面 | 形成交通走廊和资源距离差异 | ✅ T1 已落地 |
| 河流与浅滩 | 连续河道、两岸、可见的石砾浅滩 | 分隔聚落并形成跨岸通道 | ✅ T2 已落地 |
| 河滩与河阶 | 河边沙砾带、稍高的平缓阶地 | 安家位置与取水距离的取舍 | ✅ T2 已落地 |
| 湖泊与出水口 | 成片静水、岸线、唯一或少量出水通道 | 环湖聚落与绕湖交通 | ⏳ 子特征注入：T1「山脚湖」/ T2「牛轭湖」 |
| 湿地与泥泽 | 芦苇、浅水斑块、软泥地 | 通行代价与土地利用差异 | ❌ v1.48.0 删除（视觉辨识度过低） |
| 峡谷与断崖 | 深切谷地、陡壁、狭窄出口 | 少量强地标与路线瓶颈 | ⏳ 子特征注入：T2「河谷峭壁」 |
| 泉谷与瀑布 | 山脚泉眼、短溪、落差水景 | 将现有水源 POI 与山地联系起来 | 泉谷 ✅ T2 已落地；瀑布 ⏳ 子特征注入：T1「山涧飞瀑」 |

这里的山地是适配当前社区尺度地图的山脊、山麓与局部峰体，不把一整条大陆级山系压缩进村落大小的区域。每张图先选一个主地貌、最多两种辅助特征，避免八类地形全部堆在同一张图。

### 2.1 丘陵：适合首先落地

> v1.47.7 起不再将「台地/高台」纳入 T1——平顶高台在实机中观感生硬，已从 T1 设计与实现中移除；T1 只保留连绵丘陵（山脊/山口连续起伏）。台地如要回归，须作为第 3 节中的独立后续地图模板，经新的高度场、台缘占地与缓坡通行契约验证。

- **形态**：一到两组连绵丘陵，草地与裸岩沿坡度渐变。
- **规则**：缓坡可通行；房屋需满足完整占地的坡度、高差与道路接入条件，不能只检查中心点高度。
- **取舍**：丘陵缓坡提供可建空间，但可能离水源较远；坡脚近资源，却可能缺少可扩张用地。
- **最小实现**：高程形状、坡度/占地校验、贴地路网和材质分区。首期不附加高地防御或税收加成。
- **验收**：丘陵缓坡从远景可辨认，房屋底面无明显悬空；存在多处可选建房区，不能由生成器指定居民必住某处。

### 2.2 山脊与山口：形成自然路线

- **形态**：有明确走向的主脊，配少量支脊；在合理位置保留较低的鞍部作为山口。
- **规则**：超过配置阈值的坡段禁止通行，中等坡段按经过的坡形计入成本；山口是合法的缓坡通道，不是额外传送节点。
- **资源联系**：石矿、金矿可优先选择可达的岩石露头；并非每座山都必有矿，也不随山体面积增发资源额度。
- **最小实现**：一条山脊、至少一个可达山口、两侧资源与营地候选地。山口不自动征税或建立关隘。
- **验收**：两端等高但中途越过陡脊的曲线不能被误判为平路；高坡会挡路，山口确实被路径搜索识别。

### 2.3 河流与浅滩：首个地理玩法切片

- **形态**：一条主河道，少量弯曲、宽窄变化和连续岸线。首期不做分汊、改道或复杂支流。
- **规则**：普通水面禁止步行、建房；跨河只允许经内核认可的浅滩连接。浅滩有实际宽度、路程与通行成本，人物沿真实曲线过河。
- **取舍**：河两岸直线距离近，实际路程可能需要绕到浅滩，形成自然的往返与交易走廊。
- **最小实现**：固定水位、静态水域边界、固定浅滩、合法岸边取水点；不包含游泳、船舶、桥梁施工和涨水。
- **验收**：所有普通路段均不穿水；浅滩处人物与水面接触合理；关闭该连接的诊断场景会改变可达性，而不是仍从河中抄近路。

### 2.4 河滩与河阶：让岸边有空间层次

- **形态**：紧邻水体的低滩与较高阶地形成不同地表色和高度，避免河水直接贴着建筑。
- **规则**：首期低滩为固定建房排除带，河阶在坡度与占地校验通过后可建；这代表选址规则，不宣称已经有洪水灾害。
- **农业联系**：后续可提供天然土地适宜性，农业仍自行决定开垦成本与产量，不能因“冲积地”标签直接给家户发粮。
- **最小实现**：河道两侧派生岸带与建房掩码，显示“低滩不可建”原因。
- **验收**：阶地大小足够容纳真实房屋占地；河滩宽度与水面、通路一致，边缘不会被装饰遮住。

### 2.5 湖泊与出水口：产生环湖路径

> v1.48.0 起不再规划独立湖泊 profile，改为 T1/T2 子特征注入：T1 鞍部低地的「山脚湖」、T2 主河弯道切割的「牛轭湖」。两者均生成静态 `WaterBody` 特征（不可采水，不参与 HUD 水库存量统计）。

- **形态**：盆地中的有边界水面，岸线包含可接近的缓岸与少量岩岸；只做有出水口的湖。
- **规则**：湖面不可步行，合法岸点可取水；湖泊与其出水河段属于同一水系，多个岸点不能重复创建水量。
- **最小实现**：一个湖盆、明确湖面高程、一个出水口、一条绕湖陆路。
- **验收**：同一湖面的高程一致，岸线与地表交界合理；无湖底道路、湖中房屋或孤立必需资源。

### 2.6 湿地与泥泽：已删除

> ❌ **v1.48.0 明确删除**。湿地与河滩/河岸在视觉上区分度低，玩家难以感知，且功能与河滩软地重叠。原「可涉软地 + 不可通行水洼」的设计由 T2 `RiverBank`（岸带软地，`terrain_soft_ground_cost`）承载，不再单独规划湿地 profile 或特征。

### 2.7 峡谷与断崖：控制数量的强地标

> v1.48.0 起改为 T2「河谷峭壁」子特征注入：部分河段（1–2 段）两侧生成 `Cliff` 特征（高 6–12m），对应地表写入 `NO_BUILD` 并硬禁行（坡度 >45°）。

- **形态**：狭长谷地与陡峭谷壁，只占有限区域，保留从谷口或缓坡出入的路线。
- **规则**：陡壁不可跨越，沿谷路线按真实高程通行；采矿点必须有入口与可达落脚处。
- **最小实现**：当前高度场可表达的陡坡谷壁，不包含悬挑、洞穴、多层地下交通。
- **验收**：曲线平滑不会切进谷壁；远景仍能看见谷底路线，近景人物不会长期被山体完全遮挡。

### 2.8 泉谷与瀑布：连接已有水源与新地形

> 泉谷（`SpringValley`）已于 T2 落地（v1.47.5）；瀑布改为 T1「山涧飞瀑」子特征注入（主脊中段 3–5m 跌水 + 沟谷汇入）。

- **形态**：山脚低处的泉池接短溪；有合法落差时再加瀑布、浅潭和少量水雾。
- **规则**：水源与水系建立明确归属。取水发生在安全岸点或潭边，瀑布本体不可当步行路段。
- **最小实现**：先将现有水源 POI 适配到泉谷；瀑布只消费已有河段落差和流动状态，不在前端另造水流事实。
- **验收**：同一股水不在泉、溪、潭各复制一份储量或再生；水源断流时，不显示与内核状态矛盾的持续大流量。

## 3. 未来地图组合库

> 以下均为**未排期的未来地图模板**，不是现有 profile，也不承诺按表中次序实现。**v1.48.0 起「T3 独立 profile 阶段」已取消**——表中标注 T3 的行现统一理解为「通过子特征注入或新 profile 实现，未排期」。每张图仍只选择一个主地貌，并限制为至多两种辅助特征；同一模板先完成最小静态切片及连通性、生存、资源守恒和确定性门禁，再增加动态水文、航运、洞穴或灾害等扩展内容。

| 地图模板 | 地形构成 | 玩家会观察到什么 | 建议阶段 / 前置 |
|---|---|---|---|
| 山口聚落 | 丘陵、主脊、山口、山脚泉源 | 道路绕过陡坡，在山口汇聚；山两侧采集距离不同 | ✅ T1 已落地 |
| 两岸河谷 | 主河、浅滩、河滩/河阶、少量丘陵 | 两岸聚落经浅滩往返，近在眼前的资源需要绕行 | ✅ T2 已落地 |
| 湖畔盆地 | 湖泊、出水口、湿地、外缘山坡 | 房屋沿干燥缓岸分布，道路绕开水面和泥泽 | 未排期；复用 T1 山脚湖 / T2 牛轭湖子特征与排水、可建区契约（原 T3，已并入子特征注入方向） |
| 台地聚落 | 边缘陡坡的平缓台面、坡脚水源、少量缓坡入口 | 高处开阔用地与下行取水/采集成本之间的取舍；入口自然汇聚 | 未排期；与已删除的 T1 平顶压平方案无关，须先验证台缘完整占地、缓坡入口和高度场表现 |
| 河口三角洲 | 主河分汊、潮湿冲积低地、支汊间干地脊与可达岸点 | 丰富近水土地、绕开支汊的路径网络与不同支流间的聚落竞争 | T4；需要分汊水系、共享资源池与动态水位/淹水边界，不在 T2 静态主河范围内 |
| 海湾聚落 | 受陆地环抱的海湾、缓岸、岩岬与内陆淡水来源 | 沿避风岸发展的聚落、绕湾陆路与岸线空间取舍 | T4；海水不可直接作为淡水资源，航运另立项，先完成海陆边界和淡水语义 |
| 盆地绿洲 | 封闭或半封闭盆地、汇水低地、外缘山坡与中心水源 | 聚落围绕低地水源分布，外缘资源与中心生活区形成明确距离梯度 | 未排期；复用湖畔盆地的排水、可建区与生存诊断契约 |
| 峡湾聚落 | 深窄海湾、两侧陡坡、谷口与少量缓岸 | 水域造成强分隔，有限岸带与谷口成为陆路关键节点 | T4；需要海水边界、陡坡走廊和安全岸线，航运不作为首批前提 |
| 河谷聚落 | 上游河道、谷底冲积带、两侧连续山坡和浅滩/桥位预留 | 水、耕地、道路都沿谷底集中，跨谷与上坡扩张形成权衡 | T2 后扩展；以两岸河谷为基础，逐步加入更连续的谷地骨架 |
| 半岛聚落 | 三面临水的陆地、狭窄陆桥、内陆高地或淡水点 | 陆桥成为进出瓶颈，岸线资源与有限扩张腹地形成选择 | T4；先确认海水、淡水、陆桥连通及极端阻断时的生存诊断 |
| 海岛聚落 | 被海水完整包围的陆块、岛内淡水与有限资源区 | 隔离环境下的资源闭环与有限土地；与外界交换必须有独立机制 | T4 以后；在航运、外部补给和孤岛生存模型完成前不启用为常规开局 |
| 沙漠绿洲 | 干旱裸地、局部泉池/地下水出口、绿洲植被与远距资源点 | 水源极度集中，聚落、路径和储备策略围绕绿洲展开 | 未排期；需先加入干旱地表/蒸散表现，但不以视觉沙漠标签直接改变水库存 |
| 山前冲积扇 | 山口出口、扇形缓坡、分散浅沟与较高扇缘 | 山地资源流向平原的过渡地带；扇面选址、洪沟禁建带与水源距离取舍 | 未排期；首期只做静态扇形地表与禁建/通行规则，洪水冲刷留至 T4 |
| 喀斯特地貌 | 石灰岩丘峰、洼地、落水洞/泉眼与可建台地 | 地表路径绕开岩丘，水源集中在泉眼或洼地；形成辨识度高的局部地标 | T4；洞穴、多层地下河和地下交通不进入首批，必须先定义地表水去向与安全禁入边界 |

这些组合只约束初始环境。聚落兴衰、道路流量和家庭选择由模拟涌现，不预设某一岸必富、某个山口必成王都；水体模板也不自动赋予航运、渔业或无限淡水。

## 4. 生成顺序与有效世界保障

生成流程如下。**T0/T1/T2/D-A 部分已实现**，标注 ✅ 的步骤为当前真实链路；`terrain_generation_max_retries` 相关的有界重试与生存诊断仍未消费。

```text
种子 + 生成器版本 + 配置                    ✅
  → 主地貌骨架与高程（T0 基础 + T1 主脊/山口）✅
  → 排水方向、河道/湖盆、水位与出口（T2）    ✅
  → 通行表面、岸带与可建区域                ✅
  → 营地与必要资源候选、浅滩与山口连接      ◐（浅滩/路网已通；POI 生存距离校验未消费查询服务）
  → 合法导航走廊与贴地曲线路网              ✅
  → 连通性、占地、资源距离校验              ◐（连通性/占地已通；生存诊断上限未接）
  → 固定世界事实与快照 → 地表装饰与美术     ✅
```

首期采用受约束的地貌模板与确定性参数变化，不要求先建立完整侵蚀或流体模拟。河道必须沿可解释的下游方向连接到地图出口或湖泊；需要整形时在世界初始化完成前统一修改地表，不能只将水线画上山坡。湖面按单一水位求岸线，瀑布处明确落差。

**有效世界至少满足**：初始居民落在干燥可达区域；每个初始营地能到达所需水粮；全局关键资源和市场在预期陆路连通分量内；每个营地有配置规定的可建面积和扩张余量；必要资源路径成本不超过经生存诊断校准的上限。连通不等于能活下来，必须测往返时间与饥渴/体力消耗。

候选搜索、同成本排序、重试次数和修复顺序必须固定。失败时只在初始化阶段按固定次序调整浅滩、缓坡或候选 POI，超过有界重试次数则使用通过校验的简化模板并记录原因；禁止无限重抽种子，禁止运行中移动居民来修复地形。

## 5. 方案结论与落地状态总览

采用“静态地貌生成 + 内核地表查询 + 合法走廊生成 + 共享水资源池 + FABS 增量快照”的路线，不引入完整侵蚀模拟、流体模拟、桥梁施工或 GPU 渲染器作为前置条件。

第一条可实施主线如下（v1.48.0 优化后，★ 标注当前实际落地进度）：

```text
T0 地表查询与完整曲线校验                      ✅
  -> T1 山口聚落（丘陵/山脊/山口连续起伏；v1.47.7 起无台地）  ✅
       + D-A 装饰系统基础（Tree/Boulder/Bush）   ✅ v1.49.1
       + D-B 装饰系统扩展（RockCluster/GrassTuft + 季节色调）  ⏳
  -> T2 静态主河/两处浅滩/河滩河阶/泉谷          ✅
  -> T1 子特征注入（山脚湖 / 山涧飞瀑 / 密林山坡 / 裸岩露头）  ⏳
  -> T2 子特征注入（牛轭湖 / 河谷峭壁 / 河岸林带 / 碎石浅滩）  ⏳
  -> D-C 高级装饰（泉水景观群 / 资源区景观）      ⏳
  -> T4 动态水文、桥梁、土地演化                 ⏳
```

> **子特征注入**：通过 seed 哈希按概率决定是否在 T1/T2 骨架上注入额外地貌特征（如湖泊/瀑布/峭壁）。注入不改变基础 profile 命名，仅在同一模板内增加视觉与地形复杂度，避免无限新增独立 profile。
> **装饰系统（D 系列）**：独立于骨架生成的纯视觉要素层，用独立 `accent_rng` 生成树木/岩石/灌木等点缀物。装饰不参与通行/资源/碰撞计算，挂进 `drawWorldEntities()` 统一深度队列渲染。

### 5.1 落地状态总览

| 阶段 | 状态 | 落地要点 | 剩余工作 |
| :--- | :--- | :--- | :--- |
| T0 地表查询与完整曲线校验 | ✅ 主体已落地 | `GeoCell` 扩展 `SurfaceKind`/肥力/水体关联/标志；`geo/query.rs` 提供 `sample_cell`/`validate_footprint`/稳定失败码；房屋实体化消费完整占地；`TerrainMap::validate_curve` 走廊校验原语；`geo/corridor.rs` 浅滩与陆路寻路 | 生态落位（`ecology/spawn.rs`）部分生存硬约束优化；`terrainGenerationMaxRetries` 已声明未消费 |
| T1 山口聚落（丘陵/山脊/山口连续起伏） | ✅ 已落地（v1.47.1/v1.47.2；v1.47.7 移除台地） | `mountain_pass_v1` profile；局部 `relief_rng` 派生主脊/山口连续起伏；存档版本门禁；前端按地表类别渲染。v1.47.7：删除台地压平与 `Ridge`/`Saddle`/`Terrace` 特征及前端轮廓绘制 | 山口地貌参数已部分配置化；支脊未实现；子特征注入待规划 |
| T2 静态主河/浅滩/河阶/泉谷 | ✅ 已落地 | `river_valley_v1` profile + 生成器版本 3（v1.47.7 起，与 T1 共用全局版本）；主河生成（`geo/hydrology.rs`），单调河床下凹与水面静态；低滩（`NO_BUILD`）与河阶（`RiverTerrace`）；两处静态浅滩走廊（`ShallowFord`，跨水授权）；共享水池 `WaterPool` 聚合取水与稳定扣减；地形感知路网（`spatial/terrain_network.rs`）与 `LaneTerrainProfile` 边权通行代价折算；占地校验拒绝浅水（`WaterCovered`）；存档格式升级为 7；10 个 T2 配置参数；前端河道/岸线/浅滩特征渲染与 HUD 水量去重；支持 T1/T2 模板按种子哈希随机轮换（`terrainProfile: 'random'`） | 子特征注入待规划 |
| D-A 装饰系统基础（Tree/Boulder/Bush） | ✅ 已落地（v1.49.1；v1.49.2/v1.49.3/v1.50.10 打磨） | `geo/accents.rs`（`AccentKind` 5 变体、`TerrainAccent`、`generate_accents()`、`ACCENT_RNG_SALT`）；`TerrainMap.accents` 字段 + 随 `terrain_state` 入档；FABS `SectionKind::TerrainAccents = 21`；前端 `render_terrain.js::drawAccentEntity()`（Tree 四瓣层叠树冠 / Boulder 多边形岩体 / Bush 三瓣灌丛，含叶片斑驳纹理与季节 tint）；3 个配置字段（`terrainAccentDensity`/`terrainAccentSubFeatures`/`terrainTreeSeasonTint`） | RockCluster/GrassTuft 仅枚举定义未生成；装饰缓存标志仍与地形共用 |
| D-B 装饰系统扩展 | ⏳ 未实施 | — | RockCluster/GrassTuft 生成；季节色调细化 |
| T1 子特征注入 | ⏳ 未实施 | — | 山脚湖（T1 鞍部静水）；山涧飞瀑（主脊跌水）；密林山坡（装饰树群）；裸岩露头（陡坡岩石） |
| T2 子特征注入 | ⏳ 未实施 | — | 牛轭湖（回水湾）；河谷峭壁（河段两侧 Cliff）；河岸林带（沿河装饰树列）；碎石浅滩（河滩石砾） |
| T4 动态水文、桥梁、土地演化 | ⏳ 未实施 | — | — |

**实现偏差（方案设计 vs 实际落地）速查**：存档格式版本递增至 7（§12.3）；配置落地 19 字段（§14，全系统配置总数 240）；`TerrainFailure` 实现 8/10 变体（§6.5，`WaterCovered` 已产生）；`validate_curve` 落在 `geo/corridor.rs` 与 `terrain.rs`（§9.1）；路网感知生成落地于 `spatial/terrain_network.rs`（§9）；房屋选址改造实际落在 `housing_system/settlement.rs`（§11.1）；前端地形缓存仍为单一 `_terrainCached`（§13.4）；FABS 新增 `TerrainFeatures=18` 承载水系全部特征、`TerrainAccents=21` 承载装饰（§12.2）。

## 6. 目标数据模型

### 6.1 地表单元

✅ 已落地（v1.47.1）。`GeoCell` 已扩展为“可查询的静态地表事实”，与下列建议字段一致：

```rust
pub struct GeoCell {
    pub elevation: f32,
    pub slope_angle_deg: f32,
    pub surface_kind: SurfaceKind,
    pub natural_fertility: f32,
    pub water_body_id: Option<u32>,
    pub feature_flags: u16,
}
```

`SurfaceKind` 采用闭集枚举，T0/T1/T2 只启用以下变体（T1 只实际生成 `DryGround`/`SoftGround`/`RockFace`）：

```text
DryGround       普通干地
SoftGround      湿软地，允许通行但增加成本
ShallowWater    浅水，只有被浅滩连接覆盖的走廊可跨越
DeepWater       深水，硬禁行且禁建
RiverBank       河岸/岸带，允许岸边交互，不代表可涉水
RiverTerrace    河阶，可在占地和坡度满足时建房
RockFace        陡壁/裸岩面，超过通行坡度时硬禁行
```

说明：

- `natural_fertility` 只描述自然土地条件，不能直接写入家户粮食或农业资产 `fertility`。
- `water_body_id` 只表示几何归属；可采水资源通过独立的 `WaterPool` 关联，不能把每个单元当成一份库存。T2 `river_valley_v1` 将深水单元关联至 `Some(1)`，其他地表为 `None`。
- `feature_flags` 只放稳定、可组合的查询事实。已定义 `NO_BUILD`/`NO_WALK`/`SHORE_ACCESS`/`CROSSING_CANDIDATE` 四个标志；T2 中深水写入 `NO_BUILD|NO_WALK`，河岸写入 `NO_BUILD|SHORE_ACCESS`，浅滩写入 `NO_BUILD|CROSSING_CANDIDATE`。

### 6.2 地貌特征

✅ T1/T2 已落地（v1.47.5），定义于 `geo/terrain.rs`；特征使用按 ID 排序的 `Vec`，避免 HashMap 迭代顺序进入确定性路径：

```rust
pub struct TerrainFeature {
    pub id: u32,
    pub kind: TerrainFeatureKind,
    pub vertices: Vec<Vec3>,
    pub elevation: f32,
    pub width: f32,
    pub flags: u16,
}
```

`TerrainFeatureKind` 规划与落地情况（v1.47.7：`Ridge`/`Saddle`/`Terrace` 三特征已删除，不生成也不绘制；v1.48.0：删除 `Wetland` 湿地）：

```text
River          河道中心线和水面边界  ✅ v1.47.5 (T2)
RiverBank      岸带轮廓              ✅ v1.47.5 (T2)
ShallowFord    静态浅滩连接          ✅ v1.47.5 (T2)
SpringValley   泉谷                  ✅ v1.47.5 (T2)
Cliff          峡谷壁/断崖            ⏳ D-B (T2 子特征注入)
WaterBody      湖泊水面              ⏳ D-B (T1/T2 子特征注入)
Waterfall      瀑布跌水              ⏳ D-B (T1 子特征注入)
~~Wetland~~     ~~湿地斑块~~          ❌ v1.48.0 删除（视觉辨识度过低）
```

特征的职责是表达几何和查询来源，不承担库存、税收、生产或 Agent 行为。`vertices` 采用世界坐标，前端按投影绘制；浅滩由 `TerrainConnection` 表达授权通道（两端端点、走廊宽度与节点），配合 `corridor::segment_valid` 授权跨水。

### 6.3 水体与共享资源池

✅ 已落地（v1.47.5）。实现于 `geo/hydrology.rs` 与 `spatial/terrain_network.rs`：

```rust
pub struct WaterBody {
    pub id: u32,
    pub level: f32,
    pub flow_direction: Vec3,
    pub resource_pool_id: u32,
    pub vertices: Vec<Vec3>,
}

pub struct WaterPool {
    pub id: u32,
    pub current_stock: f32,
    pub max_stock: f32,
    pub regen_rate: f32,
    pub source_poi_ids: Vec<u32>,
}

pub struct WaterAccessPoint {
    pub id: u32,
    pub water_body_id: u32,
    pub resource_pool_id: u32,
    pub pos: Vec3,
    pub nearest_node_id: Option<u32>,
    pub interaction_radius: f32,
}
```

落地细节：

- T2 保留现有 `PoiType::WaterSource`，但将同一河流两岸的多个岸点（`WaterAccessPoint`）的储量读取和扣减委托给同一个 `WaterPool`（池 ID 1）。
- 既有 Agent 装载、回家卸货、家户账本和施密特触发器保持原有语义；在 `spatial/ecology/harvest.rs` 中，多名 Agent 采水先收集需求并按 `agent.id` 升序稳定排序，再串行扣减共享水池，保证不同执行批次下的绝对确定性。
- 自然再生在 `spatial/ecology/tick.rs` 中按池统一执行，每个水源 POI 的动态储量通过 `sync_water_pois()` 与所属水池实时同步。
- 水面存在但 `current_stock == 0` 时，前端仍绘制水面，HUD 大盘按池 ID 去重统计（`render_hud.js`），避免同一水池被多点统计导致总量虚高。
- T2 水位保持静态几何事实（`terrainRiverWaterLevel = 0.0`），枯水/丰水动态涨落预留给 T4。

### 6.4 地表装饰（Accents）

✅ 已落地（v1.49.1）。装饰层是独立于地貌特征（`TerrainFeature`）之外的纯视觉要素集合。与特征层的分工：

| 维度 | TerrainFeature | Accent（装饰） |
| :--- | :--- | :--- |
| **语义** | 影响通行、可建、取水决策 | 纯视觉，无物理影响 |
| **来源** | 地形骨架生成器 | 独立 `accent_rng` 加盐 |
| **持久化** | FABS Section 18 | FABS Section 21 |
| **数量** | 个位数 | 数十个（可配置密度） |
| **分布** | 固定骨架位置 | 按地表类别/坡度/肥力散布 |

```rust
pub struct TerrainAccent {
    pub id: u32,
    pub kind: AccentKind,       // Tree | Bush | Boulder | RockCluster | GrassTuft
    pub pos: Vec3,
    pub scale: f32,            // 0.7 ~ 1.4 视觉变体
    pub rotation_rad: f32,     // 0 ~ 2π
    pub tint: u8,              // 0=默认, 1=偏黄(秋季), 2=偏红(深秋)
}

pub enum AccentKind {
    Tree        = 0,   // 四瓣层叠树冠 + 锥形树干（季节变色）
    Bush        = 1,   // 三瓣扁压圆簇灌木
    Boulder     = 2,   // 不规则多边形岩石
    RockCluster = 3,   // 2-5 块碎石聚集（D-B）
    GrassTuft   = 4,   // 草丛斑点（D-B）
}
```

装饰散布规则（当前实现，`geo/accents.rs`）：

- **禁区**：道路占地、房屋占地、`WaterAccessPoint` 交互半径内、`DeepWater`/`ShallowWater` 上、`NO_WALK` 格（唯一例外见下）。
- **偏好**：Tree 接受平地（含 0 坡）至 32° 坡度——DryGround/SoftGround 按肥力加权、RiverBank 0.85 / RiverTerrace 按 `fertility×0.5+0.5` 高概率（河流两岸有树）；Boulder 偏好多坡度（>18° 直认、>10° 60% 概率）与裸露 `RockFace`（★ v1.50.10：`Boulder + RockFace` 组合放行 `NO_WALK` 禁区过滤，岩壁巨石是目标地表而非禁区）；Bush 偏好林缘过渡带 + RiverBank 0.6 / RiverTerrace 0.5 喜湿灌丛。
- **数量**：基础密度 `terrainAccentDensity: 1.0`，Tree 基数 40、Boulder 20、Bush 25（乘密度倍率取整），各有界重试 3× 目标数；RockCluster/GrassTuft 仅枚举定义，D-B 再实现。
- **确定性**：`accent_rng = WorldRng::new(seed ^ ACCENT_RNG_SALT)`，盐值 `0x4143_4345_4E54_3031`（"ACCNT01"），独立于 `relief_rng`/`hydro_rng`，不污染全局 RNG。
- **持久化**：`TerrainMap.accents: Vec<TerrainAccent>`（`#[serde(default)]`）随 `terrain_state` 一并入档，读档后逐字节恢复。

### 6.5 地表查询结果

◐ 已落地主体（v1.47.1），实现于 `geo/query.rs`：

```rust
pub struct FootprintQuery {
    pub center: Vec3,
    pub half_extents: (f32, f32),   // 方案原拟 Vec2，实现为元组
    pub rotation_rad: f32,
    pub use_kind: LandUseKind,
}

pub struct TerrainQueryResult {
    pub valid: bool,
    pub failure: TerrainFailure,
    pub min_elevation: f32,
    pub max_elevation: f32,
    pub max_slope_deg: f32,
    pub surface_mask: u16,
    pub walk_cost: f32,
}
```

已提供：

- ✅ `sample_cell(wx, wy)`：返回地表类别、高程、坡度和水体关联。
- ✅ `validate_footprint(query, max_slope_deg)`：对完整占地覆盖的栅格单元求高差、最大坡度、水域覆盖、禁建标记和地表成本；触及浅水时拒绝并返回 `WaterCovered`。
- ✅ `surface_walk_cost(kind)` 与 `explain_failure(failure)`：稳定步行成本与诊断文案。
- ✅ `TerrainMap::validate_curve(curve, corridor_width, max_walk_slope)` 与 `geo/corridor.rs`：完整曲线与走廊校验原语，浅滩授权走廊豁免 `ShallowWater`。

未提供（后续补充）：

- ⏳ `nearest_valid_node(pos, use_kind)`：只返回在合法地表上的路网节点（当前路网由 `spatial/terrain_network.rs` 统一拓扑连接）。

`TerrainFailure` 使用闭集错误码，实现了 8 个变体：

```text
OutOfBounds          ✅ 产生
WaterCovered         ✅ 产生（占地触碰浅水时拒绝建房）
DeepWater            ✅ 产生
CliffTooSteep        ✅ 产生
SurfaceForbidden     ✅ 产生
FootprintTooUneven   ✅ 产生
NoRoadAccess         ◐ 已定义，暂不产生（房屋占用另由 settlement 检查，未并入）
Occupied             ⏳ 未实现
NoValidCrossing      ⏳ 未实现（T2 走廊校验由 corridor::segment_valid/validate_curve 承载）
```

房屋、农田、哨塔和路卡向查询服务传入各自 `LandUseKind`。当前房屋消费 `LandUseKind::House`；`Farm`/`Defense` 待后续农业与防务接入。

## 7. 确定性地貌生成

### 7.1 RNG 分域与 Profile 模板选择

✅ 已落地 `relief_rng`、`hydro_rng` 与 `accent_rng`。`TERRAIN_GENERATOR_VERSION = 3`（v1.47.7 删除 T1 台地压平后递增）：

```text
terrain_seed = seed
relief_rng   = WorldRng::new(seed ^ 0x5245_4C49_4546_5431)   // "RELIEFT1" 盐值 (T1)
hydro_rng    = WorldRng::new(seed ^ 0x4859_4452_4F54_3032)   // "HYDRT02" 盐值 (T2)
accent_rng   = WorldRng::new(seed ^ 0x4143_4345_4E54_3031)   // "ACCNT01" 盐值 (D-A)
```

> 三个 RNG 流严格隔离：`relief_rng` 只消费于 T1 主脊/山口参数；`hydro_rng` 只消费于 T2 主河/浅滩几何；`accent_rng` 只消费于散布装饰的位置/旋转变体。任一子流的重排或新增消费都不影响其他子流和世界主 RNG 顺序。

★ **T1/T2 随机轮换机制**：

- 前端与内核配置中 `terrainProfile` 默认为 `'random'`（亦支持显式锁定 `'mountain_pass_v1'` 或 `'river_valley_v1'`）。
- 当配置为 `'random'` 时，内核在生成前依据世界种子执行确定性哈希：
  `(seed ^ 0x5052_4F46_494C_4531) % 2 == 0` → 实例化为 `mountain_pass_v1`（T1 山口聚落）；
  否则 → 实例化为 `river_valley_v1`（T2 两岸河谷）。
- 创世完成后，`terrain.profile` 记录具体实例化模板名，存档 `WorldSave` 记录真实模板名，完全保持同种子 100% 逐字节确定性与读档一致性，同时确保普通玩家开局/重置时两套地貌按 ~50% 概率自然轮换。

要求：

- 盐值在代码中固定并写入生成器版本说明；不使用系统时间、浮点 Hash 或 HashMap 遍历作为随机输入。
- T1 不消费 `hydro_rng`；T2 只在自身子流中消费，不扰动 Agent、POI 和出生的全局 RNG 序列。
- 前端装饰使用 `terrain_feature_id + material_version + season` 的稳定整数哈希，不消费模拟 RNG。

### 7.2 T0 基础生成器

✅ 主体已落地（v1.47.1），保留 `TerrainMap` 的网格尺寸、世界尺寸和高程采样入口，生成步骤已抽取到 `generate_with_profile`：

1. ✅ 生成基础倾斜和低频起伏，保持当前 seed 的确定性（倾斜/幅度/四相位仍从主 RNG 消费，顺序未变）。
2. ✅ 计算完整网格高程和内部坡度；边界单元采用单侧差分而不是固定为 0，避免边缘通行误判。
3. ✅ 生成初始 `SurfaceKind::DryGround`。
4. ✅ 按坡度阈值写入 `SurfaceKind` 候选：≥34° `RockFace`、≥20° `SoftGround`、其余 `DryGround`；同时写入 `NO_BUILD`（≥18°）与 `NO_WALK`（硬禁行地表）标志。最终禁行由配置和查询服务确定，不直接把所有高坡标成不可通行。
5. ✅ 生成 `natural_fertility` 的静态遮罩（`(0.92 - slope/70 - 归一化高程*0.18).clamp(0.1, 1.0)`）。T0 只透传和可视化，不接入农业产量。
6. ⏳ 对每个初始营地、关键资源和市场执行合法地表与生存距离校验——未实施（`ecology/spawn.rs` 未消费查询服务，`terrainGenerationMaxRetries` 因此尚未被使用）。

`sample_elevation` 已新增 `sample_cell`/`grid_index` 采样入口；仍为最近邻（未改双线性插值）。若后续改变采样方式，必须同时复核 POI、房屋、路网和 Agent 的接地位置。

### 7.3 T1 山口聚落模板

✅ 已落地（v1.47.1/v1.47.2；v1.47.7 起**不再包含台地/高台**），使用可配置的定向地貌骨架（`profile = "mountain_pass_v1"`），不做无限随机重抽：

```text
主脊：一条沿方向 theta 的长条高程增量
支脊：最多两条低幅度分支            ⏳ 当前版本未实现支脊
山口：主脊上的一个低鞍部窗口
台地：❌ 已删除（v1.47.7 起不再生成平顶高台）
```

实现步骤（落地情况）：

1. ✅ 从 `relief_rng` 固定生成 `theta`（±0.18 rad）、主脊偏移（±0.08×world_size）、宽度（0.16~0.23×world_size）、幅度（24~34m）、山口位置（±0.12×world_size）与宽度（0.10~0.15×world_size）。
2. ✅ 用到主脊中心线的有符号距离生成高斯型高程增量；主脊两侧平滑过渡，禁止在格点边界产生尖峰。
3. ✅ 在山口窗口压低主脊（`elev += ridge - ridge * 0.90 * saddle`），生成连续的低坡通道；山口是普通地表走廊，不新增传送节点。
4. ❌ 台地平顶压平算法（Tableland Flattening）——v1.47.7 已整体删除，不再削平任何平台。
5. ✅ 重新计算坡度、地表类别和可建掩码。
6. ❌ `Ridge`/`Saddle`/`Terrace` 特征折线生成——v1.47.7 已整体删除（T1 profile 不再输出任何地貌特征）。
7. ⏳ 先生成/筛选合法 POI 与营地候选，再通过 T0 路网走廊生成器接入节点——未实施（待 `spawn.rs`/走廊生成器接入）。

T1 的首轮验收只要求"路线会绕山、山口可通过"，不增加高地防御、资源加成或行政税收。

### 7.4 T1 子特征注入器（v1.48.0 新增规划）

T1 骨架生成完成后，通过 `relief_rng` 派生子特征注入判定：

```text
子特征池（T1 山口聚落）：
  ├─ foot_lake       [30%]  山脚湖 — 鞍部低地积水形成静态湖面（WaterBody 特征），
  │                         周边生成 SpringValley 汇入；不影响路网拓扑
  ├─ ridge_waterfall [25%]  山涧飞瀑 — 主脊中段出现 3-5m 跌水（Waterfall 特征），
  │                         汇入沟谷 SpringValley；视觉层有跌水折线
  ├─ forested_slope  [40%]  密林山坡 — 背风面（主脊阴坡）额外生成 15-25 个 Accent:Tree
  │                         装饰（集中分布，非 POI）
  └─ rocky_outcrop  [35%]  裸岩露头 — 主脊陡坡处（slope >28°）生成 8-15 个 Accent:Boulder
                             装饰（仅视觉，不改变地表类别）
```

注入规则：

- 每个子特征独立哈希判定：`(seed ^ subFeatureSalt) % 100 < probability`
- 注入不修改 T1 profile 命名（仍为 `mountain_pass_v1`）
- 多个子特征可同时注入（概率独立）
- 注入不移动已有 POI、营地、路网节点位置

### 7.5 T2 主河与浅滩模板

✅ 已落地（v1.47.5）。实现于 `geo/hydrology.rs::generate_river`：

T2 包含“一条蜿蜒主河 + 两处静态浅滩通道 + 两岸河阶 + 泉谷”。

生成流程：

1. ✅ 从 `hydro_rng` 生成主河中心线平移相位，以正弦波结合世界尺寸生成单调中心线（`center(y)`）与变宽河道带（`half_width(y)`）。
2. ✅ 河床高程统一凹陷（`level - 1.4`），地表标记为 `DeepWater`，写入 `NO_BUILD|NO_WALK`，关联 `water_body_id = Some(1)`。
3. ✅ 河道外缘向外生成宽度为 `bank` 的 `RiverBank`（标记 `NO_BUILD|SHORE_ACCESS`），再向外生成宽度为 `terrace` 的 `RiverTerrace`（天然高肥力 0.95，平缓河阶地表）。
4. ✅ 在南侧（`-size*0.24`）与北侧（`size*0.24`）生成两处 `TerrainConnection` 浅滩跨水走廊，河床局部抬高为浅水（`ShallowWater`），写入 `NO_BUILD|CROSSING_CANDIDATE`，并生成 `ShallowFord` 地貌特征折线。
5. ✅ 生成水面双侧轮廓与河岸轮廓（`River` 与 `RiverBank` 特征）。
6. ✅ 在河流两岸交替布置水源取水点（`WaterAccessPoint`），统一绑定至共享水池 `WaterPool #1`。
7. ✅ 生成从河岸高地汇入主河的浅沟特征 `SpringValley`（不产生独立水库存）。
8. ✅ 调用 `recompute_slopes()` 重算受河道开凿影响的坡度与地表属性。

浅滩具有明确的：

```text
crossing_id: 1, 2
两岸接入端点 (start / end) 与路网节点 (node_a / node_b)
实际直线/曲线几何
通道宽度: config.terrain_crossing_width (26.0m)
浅滩地表通行代价: config.terrain_shallow_water_cost (2.0)
仅授权横向穿越，禁止借道浅滩沿河纵向涉水
```

T2 不实现桥梁、游泳、船舶、水位涨落和洪水事件。

### 7.6 T2 子特征注入器（v1.48.0 新增规划）

T2 主河生成完成后，通过 `hydro_rng` 派生子特征注入判定：

```text
子特征池（T2 两岸河谷）：
  ├─ oxbow_lake      [20%]  牛轭湖 — 主河弯道切割形成的静水湾（WaterBody 特征），
  │                         通过窄口与主河连通；视觉层有岸带轮廓闭合
  ├─ river_cliff     [25%]  河谷峭壁 — 部分河段（1-2 段）两侧生成 Cliff 特征（高 6-12m），
  │                         对应地表写入 NO_BUILD | 硬禁行（坡度 >45°）
  ├─ riverside_forest [50%] 河岸林带 — 河阶上方沿河分布条形装饰 Tree 群（20-30 个），
  │                         非密集（树间距 >15m），不遮挡河岸取水视线
  └─ gravel_beach    [40%]  碎石浅滩 — 河滩区段散布 Accent:RockCluster（8-15 个）
```

注入规则同 T1：独立哈希判定、不修改 profile 命名、不移动已有 POI/路网。

### 7.7 装饰生成器（Accents Generator）

✅ 已落地（v1.49.1）。实现于 `geo/accents.rs::generate_accents()`：

```text
输入：TerrainMap（含地表网格、坡度、肥力、道路/房屋/POI 占地）+ config.terrainAccentDensity
输出：Vec<TerrainAccent>（排序按 ID）

步骤：
1. 初始化 accent_rng = WorldRng::new(seed ^ 0x4143_4345_4E54_3031)
2. 按密度配置生成目标数量：targetCount = round(baseCount * density)
3. 逐个生成：
   a. accent_rng 生成候选 (wx, wy)
   b. 查询对应栅格的 surface_kind / slope / fertility
   c. 检查禁区（道路/房屋/POI 占地半径、DeepWater/ShallowWater、NO_WALK）
   d. 按偏好加权选择 AccentKind
   e. 生成 scale (0.7~1.4) 和 rotation (0~2π)
   f. 命中则写入；未命中则继续（最多 3x targetCount 次重试防死循环）
4. 分配稳定 ID（0, 1, 2, ...）
5. 输出按 ID 排序
```

**地表情报支持**：Accent 生成读取地表事实——禁区掩码（道路/房屋/POI 占地）、地表类别 + 坡度 + 肥力（复用 `geo/query.rs::sample_cell()`）。

## 8. 现状与改造边界

### 8.1 当前实现可直接复用的部分

- ✅ `TerrainMap` 已拥有固定网格、高程、坡度和种子，并通过局部 `WorldRng` 生成自然地形；支持 `profile` 与生成器版本。
- ✅ `World3DEngine::terrain_dirty` 已支持静态地形只在初始化、读档或显式请求时下发。
- ✅ `LaneGraph3D` 已有节点、双向车道、三次贝塞尔曲线、A*、APSP、路径缓存和路网几何增量签名。
- ✅ `Curve3D` 已提供 3D 位置、切线和弧长计算，可作为贴地路线的几何载体。
- ✅ 房屋、POI、Agent 坐标均使用 `Vec3`，前端已有统一 `project3D` 投影。
- ✅ FABS 已将地形、路网几何与动态磨损拆成不同 section，适合把静态地貌事实作为一次性增量帧发送；地表字段与地貌特征已并入 FABS，装饰另起 Section 21。
- ✅ 存档按 seed 重建地形，并增加生成器版本与 profile 门禁。

### 8.2 当前实现不能直接承载的部分

- ✅ `GeoCell` 已扩展地表类别、肥力、水体关联与禁建/禁行标志（v1.47.1）；且 `ShallowWater`/`DeepWater`/`RiverBank`/`RiverTerrace` 枚举在 T2 `river_valley_v1` 中已正式激活落地。
- ✅ `sample_cell`/`validate_footprint`/`validate_curve` 已提供，`spatial/terrain_network.rs` 已全面消费地表与走廊合法性；房屋、浅滩道路均做严格占地与走廊检查。
- ✅ `terrain_network.rs` 引入地形感知路网，通过 `corridor::route` A* 走廊与浅滩连接跨河，消除了直线车道穿深水的问题。
- ✅ `LaneEdge3D` 增加 `LaneTerrainProfile`，A* 边权与 Agent 移动速度按地形成本折算，软地/河岸/浅滩产生真实通行减速。
- ✅ 水源 POI 聚合接入 `WaterPool`，多个岸点共享水池库存与自然再生（T2）。
- ✅ 快照与 FABS 格式版本 2 支持河流折线、岸带、浅滩连接等特征下发。
- ✅ `render_terrain.js` 的 `drawFeatureItem` 绘制水系特征（`River`/`RiverBank`/`ShallowFord`/`SpringValley`）；v1.47.7 起 `Ridge`/`Saddle`/`Terrace` 三类轮廓绘制已随特征删除。

T0 基础契约、T1 山地、T2 水系骨干与 D-A 装饰层已全链路打通。剩余工作分解为：

1. **装饰系统扩展**（D-B/D-C）：纯视觉点缀的类型扩充与季节色调，不改变地貌语义；
2. **子特征注入**（T1/T2）：通过概率注入增加地图多样性，不新增独立 profile；
3. **动态地理**（T4）：枯丰水期、洪水、桥梁等，仍为长期规划。

> ❌ **明确删除**：独立湿地 profile（visual ambiguity：与河滩/河岸视觉区分度低，玩家难以感知）。

## 9. 路网与运动

现有路径搜索基于图，单纯增加水深字段不会自动避水。新世界路网生成与新增住宅接入都必须经过同一通行校验：先找合法走廊，再拟合曲线；拟合后检查完整曲线穿过的栅格和地形边界，不能只看端点或依赖稀疏定步长采样。

### 9.1 合法走廊生成与地形感知路网

✅ 已落地（v1.47.4/v1.47.5）。实现于 `geo/corridor.rs` 与 `spatial/terrain_network.rs`：

```text
节点候选
  -> 网格 A* 走廊搜索 (corridor::route)         ✅ 已落地
  -> 记录地表成本、最大坡度、浅滩跨水连接       ✅ 已落地
  -> 使用固定控制点拟合 Curve3D                 ✅ 已落地
  -> 对完整曲线按走廊宽度栅格化 (validate_curve) ✅ 已落地
  -> 通过后写入 LaneEdge3D (地形通行摘要)        ✅ 已落地
```

落地细节：

- **走廊搜索与校验**（`geo/corridor.rs`）：
  - `segment_valid(t, a, b, width, slope, crossing)` 检查线段覆盖的网格单元，硬禁行 `DeepWater`、`RockFace`、越界与无授权水域；有 `crossing_id` 时允许横向穿越 `ShallowWater`。
  - `validate_curve(t, curve, width, slope, crossing)` 递归自适应二分贝塞尔曲线，对每一段进行走廊宽度栅格化覆盖校验。
  - `route(t, a, b, cfg)` 基于网格的确定性 A* 寻路，在避开深水与陡坡的同时，沿软地和河岸搜索最优通行走廊，并执行视线贪心合并（Raycast Shortcutting）。
- **地形感知路网生成**（`spatial/terrain_network.rs`）：
  - `prepare_terrain_layout`：将 POI 与路网节点移动到合法陆地位置，水源 POI 绑定河岸取水点，非水 POI 避开深水与水系。
  - `connect_terrain_world`：优先为浅滩连接（`TerrainConnection`）在两岸建立交叉节点并授权跨水车道；其余地表节点通过 `corridor::route` 连接为稳定的近邻骨架与连通分量补边。
  - `validate_terrain_world`：创世与读档时校验全图车道均符合地表通行规则，且全体 POI 均在连通图内。

### 9.2 LaneEdge3D 扩展与地形通行代价

✅ 已落地。定义于 `spatial/graph.rs`：

```rust
pub struct LaneTerrainProfile {
    pub max_slope_deg: f32,
    pub terrain_time_cost: f32,
    pub surface_mask: u16,
    pub crossing_id: Option<u32>,
}
```

落地细节：

- 每个车道在生成时采样整条曲线覆盖单元，求得最大坡度，并将软地/河岸的 `terrain_soft_ground_cost`（默认 1.25）及浅滩跨水的 `terrain_shallow_water_cost`（默认 2.0）写入 `terrain_time_cost`。
- **A* 寻路边权折算**（`graph.rs::effective_speed`）：
  `effective_speed = edge.speed_limit * road_level_factor / edge.terrain_profile.terrain_time_cost.max(1.0);`
- **Agent 移动速度折算**（`agent.rs`）：
  `target_speed = self.max_desired_speed * road_level_factor * (self.strength / 100.0) / lane.terrain_profile.terrain_time_cost.max(1.0);`
- 行人穿过浅滩或泥泞岸带时具有逼真的减速表现，路网 A* 会自然偏好干地与平坦走廊。
- 路网与地形随 `WorldSave` 完整持久化，读档后 100% 恢复。

### 9.3 契约要点与在途边界

- 干地、软地、浅滩采用各自的通行成本；深水、陡壁先做硬禁行，不能被道路等级加速抵消。
- 需要分段时增加合法中间节点，保持位置连续；路径长度、运动高程与前端绘制采用一致几何。
- 地形进入基础成本后复核 A* 启发式下界、坡度成本、APSP 查表和现有缓存失效假设。短期保持静态地形，减少运行中拓扑变更。
- 后续桥梁启闭、水位变化，以及[路卡](./18-plan-conflict-hunting-defense.md)新建/关闭/破坏，都需要独立的通行版本与缓存失效；不能借 FABS 字符串 epoch 实现。路卡须等待在途安全处置和任务恢复验证，不因属于战斗系统就绕过 T4 的动态通行依赖。
- T1/T2 本身不改变静态拓扑，因此只需防止非法初始曲线。未来出现路卡或水位变化时：
  1. 物理层检测当前车道不可通行，报告 `RouteInvalidated` 并把 Agent 放在最近合法位置。
  2. 清除当前车道和速度时必须使用 `enter_stationary_state()` 或既有路线恢复入口。
  3. 决策器在正常决策相位重新评估去向；系统不得扫描全体 Agent 强制改派任务。
  4. 不用 FABS 字符串 epoch 作为通行缓存失效版本。

## 10. 取水与生态预算

建议区分“水体几何”“可采水资源池”“岸边交互点”。水面可见范围不等于处处可采，多个岸点可引用同一资源池。

✅ 已落地（v1.47.5）。实现于 `spatial/poi.rs`、`spatial/ecology/harvest.rs`、`spatial/ecology/tick.rs`：

```rust
pub struct PrimitivePoi {
    // 既有字段保持不变
    pub water_pool_id: Option<u32>,
    pub access_point_id: Option<u32>,
}
```

采收与再生流程：

```text
Agent 到达河岸取水点 (WaterAccessPoint)
  -> harvest.rs: 收集同一 tick 全体 Agent 取水请求
  -> 按 agent.id 升序稳定排序 (保证确定性)
  -> 依次从共享 WaterPool 扣减实际出水量
  -> 装入 Agent 随身行囊
  -> 返回并卸入家户账本
```

契约要点：

- 首期新增河流只重新组织既有水源额度：明确把哪些原水源分配给河段/泉谷，配置控制全图可采水总容量与总再生；不在保留全部原水源的同时给每段河再增发一份水。
- 在 `spatial/poi.rs` 中，`PrimitivePoi` 增加 `water_pool_id` 与 `access_point_id`；在 `spatial/ecology/tick.rs` 中，`self.water_pools` 按池统一进行自然再生，之后调用 `sync_water_pois()` 同步各取水 POI 的储量展示。
- 同一资源池的岸点共享库存事实；采收入行囊、回宅卸货和家户账本规则保持原契约。Agent 私有 POI 施密特触发器应读取对应资源池比例，切换岸点不能绕过 `decision_poi_seek_min_stock_ratio`、`decision_poi_abandon_stock_ratio` 和断流后的市场兜底。
- 首期静态水位与可采水储量分开：库存环表示当前可采额度，不表示整条河的体积。未来增加枯水/水量模拟时再建立二者关系，不让每次取水立即把整条河的岸线抽动。
- 水面存在但 `current_stock == 0` 时，前端仍绘制水面，HUD 大盘按池 ID 去重统计。

## 11. 房屋、农业、设施与 POI 接入

### 11.1 房屋完整占地

✅ 已落地（v1.47.1），实现于 `housing_system/settlement.rs`（方案清单原列 `founding.rs`，实际改动位置不同）：

```text
候选中心点
  -> FootprintQuery（房屋尺寸、朝向、LandUseKind::House）
  -> 高差/坡度/地表/水域/河滩/占用校验
  -> 门前接入节点候选
  -> 门前曲线完整合法性校验
  -> 稳定排序后由 Agent 自主选中
```

落地细节：

- `is_house_site_valid` 先执行 `validate_footprint`（`terrain_footprint_half_extent` = 7.0m、`terrain_max_build_slope` = 16°、`LandUseKind::House`），触碰浅水、深水或陡坡直接判非法并返回稳定失败码。
- 候选生成循环对每个候选点先做占地校验，非法点跳过；占用/碰撞仍由原有 `houses_clear` 等规则判定。
- 失败不生成实体；没有合法地块时由决策器按正常分支重试，不由地形系统瞬移居民或强制选址。
- 门前曲线完整合法性校验（走廊接入后）当前尚未覆盖——房屋只保证占地合法，门前道路仍走既有节点复用逻辑。

### 11.2 农田与静态防务设施

⏳ 未实施。方案：

- 农田、哨塔和路卡统一消费 `validate_footprint`，各自只定义占地、坡度、接路和水域允许规则。
- 天然 `natural_fertility` 与农业可投资 `fertility` 分开；农业接入前先校准公式，避免地形优势和资产肥力重复计算。
- T0 只提供公共查询和诊断；不因地形单元标记为高肥力而直接产生粮食。
- 静态哨塔可以在 T1 消费山口/高地查询，但不自动获得防御、税收或视野加成，除非 [18 专项](./18-plan-conflict-hunting-defense.md)明确接入。
- 路卡和桥梁属于动态通行后续，不得在 T2 视觉层提前生成可用设施。

共用地块查询回答高差、坡度、地表类别、水域覆盖、岸带约束、占用与合法路网接入。房屋检查完整占地及门前连接；农田、哨塔、路卡按各自用地规则消费同一数据，不各建独立占地或碰撞判据。同拍争用地块按稳定顺序提交。农业与静态防务设施以 T0 为前置，不要求等待全部新地图，详见[融合设计 §6](./25-plan-system-integration.md#6-土地设施与通行)。

地形只筛选候选点和提供成本。建房、迁移、采集及未来公共工程均须走既有自主决策或明确的玩家制度操作，不由地形系统强制安排居民。

### 11.3 水源 POI 接入

✅ 已落地（v1.47.5），详见 §10。

## 12. 快照、存档与版本门禁

### 12.1 JSON 同构快照

✅ 已落地。`WorldSnapshot3D` 已增加 `terrain_features`、`terrain_accents`、`terrain_generator_version`、`terrain_profile`，`GeoCellSnapshot` 已扩展地表字段：

```rust
pub struct WorldSnapshot3D {
    pub terrain_cells: Vec<GeoCellSnapshot>,
    pub terrain_features: Vec<TerrainFeatureSnapshot>,   // ✅
    pub terrain_accents: Vec<TerrainAccentSnapshot>,     // ✅ v1.49.1
    pub terrain_generator_version: u32,                  // ✅
    pub terrain_profile: String,                         // ✅
    // 既有字段保持不变
}

pub struct GeoCellSnapshot {
    pub elevation: f32,
    pub slope_angle: f32,
    pub surface_kind: String,
    pub natural_fertility: f32,
    pub water_body_id: Option<u32>,
    pub feature_flags: u16,
}
```

快照原则：

- 地形静态数据只在 `terrain_dirty` 为 true 时发出；普通 tick 帧发送空数组并复用前端缓存。✅ 已实现（`terrain_features`/`terrain_accents` 仅脏帧输出，其余帧为空 Vec）。
- `terrain_content_version` 由内核根据生成器版本、地图参数和内容摘要生成，前端只用于缓存键，不参与模拟 RNG。◐ 当前用 `terrain_generator_version + terrain_profile` 表达版本事实，`terrain_content_version` 未单独引入。
- 水池库存是动态事实，应随 POI/水资源快照发送；水体轮廓、岸点和特征几何是静态事实。
- 所有 `Vec` 按稳定 ID、固定种类顺序输出；不能依赖 HashMap 顺序。✅ 特征按生成顺序输出（T2 水系：ShallowFord=10/11、RiverBank=20/21、SpringValley=30）；装饰按 ID 升序。
- 快照按稳定 ID 排序；新增字段遵守根指南的结构、真值赋值、FABS 编码/解码、前端映射同步契约。

### 12.2 FABS 二进制帧

✅ 已落地。FABS 地形记录布局已扩展，格式版本 `FORMAT_VERSION = 2`：

1. ✅ `snapshot.rs` 增加字段。
2. ✅ `world_snapshot.rs` 完成 JSON 赋值。
3. ✅ `snapshot_bin/encode.rs` 增加 `surface_kind` 码、`natural_fertility`、`water_body_id`、`feature_flags`（TERRAIN section 单格布局：elevation f32 + slope f32 + surface_kind u8 + fertility f32 + water_body_id opt_u32 + feature_flags u16 + align4，约 8B→24B/格）。
4. ✅ `frontend/js/snapshot-bin.js` 按完全相同顺序解码（`FORMAT_VERSION = 2`，新增 `align4` 帮助函数）。
5. ✅ `tools/test-snapshot-bin.js` 深比较 JSON 与二进制结果。
6. ✅ `snapshot_bin/layout.rs::FORMAT_VERSION` 递增到 2，前端校验不匹配即拒绝旧帧；不要声称旧解码器可以安全解析新地形记录。

已落地 section：

```text
SectionKind::TerrainFeatures = 18   ✅ v1.47.1
    (id u32 + kind u8 + flags u16 + elevation f32 + width f32 + vertex_count u16
     + 变长顶点 Vec3 + align4)

SectionKind::TerrainAccents = 21    ✅ v1.49.1
    (id u32 + kind u8 + x f32 + y f32 + elevation f32 + scale f32
     + rotation f32 + tint u8 + align4，约 24B/个)
```

section 记录使用变长顶点列表，未知 section 仍可按 `byte_len` 跳过。装饰数据为静态事实，每次脏帧（创世/读档/重置/回溯）全量下发，与 `TerrainFeatures` section 同频。

前端映射：

- ✅ `rustworld.js::_applySnapshot()` 已把静态快照映射到 `this.terrain.cells`（含 `surfaceKind`/`naturalFertility`/`waterBodyId`/`featureFlags`）与 `this.terrain.features`/`accents`/`generatorVersion`/`profile`。
- ✅ `SnapshotBin.resetCaches()` 在 READY、LOAD_RESULT、REWIND_RESULT、RESET_DONE 时继续执行；跨世界缓存失效仍以 `STR_TAB.start_index == 0` 为准，不能改用 epoch。
- ⏳ `this._terrainCached` 仍是单一标志（§13.4）：当前在 T1/T2/D-A 范围内够用，引入 D-B 装饰扩充并独立控制缓存大小时应拆分为 `terrainGridCached`/`terrainFeatureCached`/`terrainAccentCached`。

### 12.3 生成器版本与读档规则

✅ 已落地。`WorldSave` 包含：

```rust
pub terrain_generator_version: u32,     // 当前为 3（v1.47.7 删除 T1 台地压平后递增）
pub terrain_profile: String,            // "mountain_pass_v1" | "river_valley_v1"
```

`terrain_profile` 用于记录已实例化的具体地貌模板（创世时若配置为 `"random"`，内核会按种子哈希实例化为具体名称入档）。当前严格校验：仅 `mountain_pass_v1` 与 `river_valley_v1` 被接受。

读档规则：

- ✅ `SAVE_FORMAT_VERSION = 7`，`WorldSave` 增加 `terrain_state: TerrainMap` 与 `water_pools: Vec<WaterPool>`，地形事实（含 `accents` 装饰数组）、水系与共享水池直接从存档完整恢复，不依赖重新生成。
- ✅ `deserialize_save()` 严格校验 `save.terrain_generator_version == 3` 与 `save.terrain_profile`，不匹配直接返回明确错误。
- ✅ 校验存档内地形单元数必须等于 `grid_width * grid_height`，否则拒绝加载。
- ✅ `World3DEngine::to_save()` 将当前实际运行的 `terrain_state` 与 `water_pools` 完整入档；存读档测试（`test-wasm.js` Test 3 与 `test-determinism.js` Suite 5）通过，续演完全逐字节吻合。
- 当前存档按种子重建地形，但 T1/T2 上线后已明确生成器版本与应用版本门禁；若仍拒绝旧应用存档，清楚说明，不声称兼容旧地形。未来允许改变河道、水位或桥梁时，应保存变化状态或确定性事件，并在读档、回放、分支时重建一致结果。

## 13. 前端景观实现

### 13.1 渲染职责拆分

✅ 已拆分（v1.48.0 起）。`render_terrain.js` 从 `render_world.js` 独立：

```text
render_terrain.js       天空背景、地形壳层/单格填充/网格线、地貌特征、装饰实体   ✅ 已拆
render_features.js      河流、岸线、浅滩、泉谷等水系特征                      ❌ 未建（并入 render_terrain.js::drawFeatureItem）
render_world.js         统一深度队列调度、POI、房屋、道路、贴地图元            ✅
render_agents.js        族人绘制                                        ✅
```

> 现状：`drawTerrainFeatures()` 已按单实体入口 `drawFeatureItem()` 重构并落在 `render_terrain.js`；`render_features.js` 未单独创建，特征绘制与地形壳层同文件。`render_world.js` 现约 770 行，逼近 800 行上限，新增景观素材前应先评估进一步拆分。

### 13.2 绘制顺序

当前实际顺序（v1.50.11 起为统一相机深度队列）：

```text
1. 背景底色（环境氛围天空/地平线）           drawSkyBackdrop()
2. 地形壳层（沙盘基底 + 边界侧壁）           drawTerrainShell()
3. ★ 世界统一深度队列 drawWorldEntities()  按 depth = ry·sinX + z·cosX 升序（远 → 近）
   ├─ 地形格（drawTerrainCell，深度 = 四角 world 坐标均值）
   ├─ 水系特征（drawFeatureItem：River 水面 / ShallowFord / 游鱼 / 太阳波光）
   ├─ 道路分段（lineDashOffset 按累计弧长保持虚线相位连续）
   ├─ 营地辖区连线、POI 底座（−0.01 ε 垫在自己标记下）
   ├─ POI 标记 / 私产宅舍 / 部落民（立体实体）
   └─ ★ 装饰实体（WORLD_ENTITY_ACCENT：Bush / Boulder / Tree，v1.50.2 起并入）
4. 调试网格线（普通视图隐藏，G 键切换）      drawTerrainGrid()
5. 登基礼花等收尾
```

> **Tree 绘制位置（★ v1.50.2 已修订，历史设计见下）**：原设计把 Tree 当作「仅 2D 精灵、不参与 `drawWorldEntities()` 深度队列（避免与房屋/族人交互）」，装饰整层在道路之前按 `pos.ry` 排序绘制。该设计在实地观感上暴露两个缺陷：① 装饰层内部按「种类分组 → 数组原序」落笔，远树会压住近树；② 乔木永远被后画的道路与族人覆盖，近景大树被远处小人「穿透」。**v1.50.2 起装饰整体并入 `drawWorldEntities()` 统一深度队列**（`WORLD_ENTITY_ACCENT`），与 POI 标记 / 房屋 / 族人同队列按 `ry·sinX + z·cosX` 升序绘制，近处乔木可正确遮挡远景道路、POI 底座与族人，也仍会被更近的实体正确遮挡。

### 13.3 已落地绘制规格

- **River**：水蓝色透明光泽宽带（`rgba(56, 133, 190, 0.72)`），宽度自适应视口缩放；
- **RiverBank**：河岸沙洲轮廓带（`rgba(185, 151, 91, 0.42)`）；
- **ShallowFord**：浅滩跨水步道虚线（`rgba(218, 197, 133, 0.95)`，双向虚线）；
- **SpringValley**：浅沟细带；
- ~~**Ridge/Saddle/Terrace**~~（v1.47.7 已删除，不再绘制山脊线/山口圆/台地轮廓）。
- **Tree**（✅ D-A）：四瓣层叠树冠（径向渐变绿 + 冠顶受光高光）+ 锥形微弯树干，含叶片斑驳纹理（10 枚由 `accent.id` 派生的暗/亮叶簇小点）；秋季 tint=1 变黄绿，tint=2 变红褐；个体差异由 `accent.id` 派生确定性 `vSeed`（干高/冠形/色相 ±7 微调）；
- **Boulder**（✅ D-A）：不规则多边形岩石（灰岩基色 + 受光面高光），尺寸 2-5m；
- **Bush**（✅ D-A）：三瓣扁压圆簇灌木 + 微投影，高度 < 1m。

规则：

- 普通视图隐藏网格线；道路等级颜色只在分析视图展示。
- 水面颜色、岸石为静态视觉派生，不改变内核通行或库存。
- HUD 大盘水源储量按 `waterPoolId` 去重汇总，避免多个河岸取水点重复累加导致总量虚高。
- 浅滩人物沿内核实际路线移动，过水时根据 `terrain_shallow_water_cost` 自然减速。
- 装饰物为静态视觉元素，不与库存/季节直接绑定（仅按 `terrainTreeSeasonTint` 做全局季节色调变化）。
- 贴地图元（道路/底座/水面/足迹线）保持贴合地表；立体实体与装饰锚点经 `MAP_Z_LIFT` 略抬于地表（v1.50.12），避免坡面「陷进」地面。
- 渲染参数（`mapZLift`/`agentFootprintR`/`accentFootprintR` 等）外置在 `frontend/js/config.render.js`（`window.RENDER_CONFIG`），与 `SIM_CONFIG` 分离（v1.50.15）。

### 13.4 命中与标注

⏳ 未实施。方案：

- 地形特征命中检测使用与绘制一致的世界坐标折线和宽度，不用只检测装饰精灵。
- 普通水面不可点击为可采点；只有 `WaterAccessPoint` 的有效岸边区域可进入 POI Inspector。
- 标签层沿用现有选中、悬浮、异常、普通四级优先级；河流名称、浅滩状态和断流状态不能遮住当前 Agent/房屋。

## 14. 配置设计

✅ 已落地 19 个仿真字段（分区 7「地形生成、地表查询与山口 profile」，全系统配置字段总计 240）：

```text
✅ terrainProfile             "random"            地貌模板："random"（种子轮换）| "mountain_pass_v1" | "river_valley_v1"
✅ terrainRidgeAmplitude      28.0                山脊/河谷起伏幅度 (m)
✅ terrainRidgeWidth          125.0               山脊/河谷影响宽度 (m)
✅ terrainRiverWidthMin       28.0                主河最小宽度 (m)
✅ terrainRiverWidthMax       42.0                主河最大宽度 (m)
✅ terrainRiverWaterLevel     0.0                 主河水面基准高度 (m)
✅ terrainRiverBankWidth      18.0                河岸缓冲区宽度 (m)
✅ terrainRiverTerraceWidth   65.0                河阶台地宽度 (m)
✅ terrainCrossingWidth       26.0                浅滩跨水走廊宽度 (m)
✅ terrainSoftGroundCost      1.25                软地/河岸通行时间代价乘子
✅ terrainShallowWaterCost    2.0                 浅滩跨水通行时间代价乘子
✅ terrainMaxWalkSlope        30.0                道路/走廊最大通行坡度 (度)
✅ terrainMaxBuildSlope       16.0                房屋完整占地最大坡度 (度)
✅ terrainFootprintHalfExtent 7.0                 房屋基础占地半尺寸 (m)
✅ terrainRoadCorridorWidth   5.0                 道路合法走廊宽度 (m)
✅ terrainGenerationMaxRetries 8                  地形布局有界重试上限
✅ terrainAccentDensity       1.0                 装饰密度倍率（0.0=无装饰, 0.5=稀疏, 1.0=默认, 2.0=茂密）
✅ terrainAccentSubFeatures   true                是否启用子特征注入（山脚湖/瀑布/峭壁等；D-B 预留，当前仅声明）
✅ terrainTreeSeasonTint      true                装饰树木是否按季节变色
```

实现约束：

- ✅ 每个字段同时出现在 Rust `SimConfig`、默认映射、前端 `config.js`，并由 `config-check.js` 严格契约校验（全系统配置字段总计 240）。
- ✅ `terrainProfile` 影响地形创世与存档门禁；当设为 `"random"` 时，内核通过 `(seed ^ 0x5052_4F46_494C_4531) % 2` 确定性分支到 `mountain_pass_v1` 或 `river_valley_v1`。
- ✅ 新增配置不改变现有 `simulationDt`、Agent 决策相位、全局 RNG 消费顺序和 tick 顺序。
- ◐ `terrainAccentSubFeatures` 已声明并前后端对齐，但子特征注入器尚未实现（D-B）；`terrainGenerationMaxRetries` 已声明未被消费。

## 15. 文件级实施清单

> 落地列：✅ = 已改；◐ = 部分/原语已提供；⏳ = 未实施。

### 15.1 T0

| 文件 | 修改内容 | 落地 |
|---|---|---|
| `crates/sim_core/src/geo/biome.rs` | 扩展 `GeoCell`、新增 `SurfaceKind` 和稳定失败码/标志定义 | ✅ 已改（7 变体 + 4 标志 + `Default`） |
| `crates/sim_core/src/geo/terrain.rs` | 抽取生成步骤、完善边界坡度、增加地表采样与生成器版本 | ✅ 已改（`generate_with_profile`、`sample_cell`/`grid_index`、`validate_curve`、`TERRAIN_GENERATOR_VERSION=3`） |
| `crates/sim_core/src/geo/query.rs` | 新增地表、占地、曲线和接路查询 | ◐ 已建（`sample_cell`/`validate_footprint`/`surface_walk_cost`/`explain_failure`；曲线校验在 `terrain.rs`；无 `nearest_valid_node`） |
| `crates/sim_core/src/geo/corridor.rs` | 新增完整曲线走廊检查和静态路线拟合 | ✅ 已建（`segment_valid`/`validate_curve`/`route`） |
| `crates/sim_core/src/geo/mod.rs` | 导出新模块和类型 | ✅ 已改 |
| `crates/sim_core/src/spatial/graph.rs` | 增加地形通行摘要、边权和缓存失效入口 | ✅ 已改（`LaneTerrainProfile`） |
| `crates/sim_core/src/spatial/ecology/spawn.rs` | POI/营地候选改用合法地表和有效节点 | ⏳ 未改 |
| `crates/sim_core/src/spatial/housing_system/founding.rs` | 中心点校验改为完整占地和门前接路 | ◐ 实际落在 `housing_system/settlement.rs`（`is_house_site_valid` + 候选过滤） |
| `crates/sim_core/src/config.rs` | 增加仿真地形参数 | ✅ 已改（分区 7） |
| `frontend/js/config.js` | 增加与 Rust 对齐的字段 | ✅ 已改 |
| `tools/config-check.js` | 增加地形字段影响模块映射 | ✅ 已改 |

### 15.2 T1

| 文件 | 修改内容 | 落地 |
|---|---|---|
| `crates/sim_core/src/geo/terrain.rs` 或新 `relief.rs` | 丘陵、主脊、支脊、山口模板 | ✅ 实现在 `terrain.rs`（`relief_rng` + 高斯脊型，未建 `relief.rs`；支脊未实现；v1.47.7 删除台地压平） |
| `crates/sim_core/src/geo/feature.rs` | `TerrainFeature` 与稳定特征生成 | ◐ 实际并入 `terrain.rs`（`TerrainFeature`/`TerrainFeatureKind`/`build_t1_features`，未建 `feature.rs`） |
| `crates/sim_core/src/spatial/ecology/seed.rs` | 生成顺序：地貌校验后再播撒 POI、节点和始祖 | ⏳ 未改 |
| `crates/sim_core/src/spatial/world_save.rs` | 生成器版本/profile 门禁 | ✅ 已改（deserialize 门禁 + `serde(default)`） |
| `crates/sim_core/src/spatial/snapshot.rs` | 地表字段和地貌特征快照定义 | ✅ 已改（`GeoCellSnapshot` 扩展 + `TerrainFeatureSnapshot` + 版本/profile） |
| `crates/sim_core/src/spatial/world_snapshot.rs` | JSON 快照赋值 | ✅ 已改（特征仅脏帧输出） |
| `crates/sim_core/src/spatial/snapshot_bin/layout.rs` | FABS 版本和新增 section | ✅ `FORMAT_VERSION` 1→2、`TerrainFeatures=18` |
| `crates/sim_core/src/spatial/snapshot_bin/encode.rs` | 地表字段与特征编码 | ✅ 已改（TERRAIN 扩展 + TerrainFeatures section + 全局版本/profile） |
| `crates/sim_core/src/spatial/snapshot_bin/dict.rs` | 枚举名表 | ✅ 已改（`surfaceKind`/`terrainFeatureKind` 表注入 `enum_table_json`） |
| `frontend/js/snapshot-bin.js` | 同构解码 | ✅ 已改（`FORMAT_VERSION=2`、`K.TERRAIN_FEATURES=18`、`align4`、变长特征解码） |
| `frontend/js/rustworld.js` | 静态地形/特征缓存映射 | ✅ 已改（`features`/`accents`/`generatorVersion`/`profile`；仍单一 `_terrainCached`） |
| `frontend/js/render_terrain.js` | 地形、材质和遮挡绘制 | ✅ 已拆（`drawTerrainShell`/`drawTerrainCell`/`drawTerrainGrid`/`drawFeatureItem`；v1.47.7 删除 Ridge/Saddle/Terrace 分支） |
| `frontend/js/render_canvas.js` | 保持调度并增加必要缓存失效调用 | ✅ 已改（收敛为 天空 → 地形壳层 → 统一深度队列 → 调试网格线 → 礼花） |

### 15.3 T2

| 文件 | 修改内容 | 落地 |
|---|---|---|
| `crates/sim_core/src/geo/hydrology.rs` | 主河、水体、河阶、岸带、浅滩和水池生成 | ✅ 已建（`generate_river`、`WaterPool`、`Hydrology`） |
| `crates/sim_core/src/geo/corridor.rs` | 浅滩走廊校验与跨水授权寻路 | ✅ 已建（`segment_valid`、`validate_curve`、`route`） |
| `crates/sim_core/src/spatial/terrain_network.rs` | 地形感知路网生成、边权折算与浅滩跨河 | ✅ 已建（`prepare_terrain_layout`、`connect_terrain_world`、`validate_terrain_world`） |
| `crates/sim_core/src/spatial/graph.rs` | `LaneEdge3D` 增加 `LaneTerrainProfile` 通行摘要与 A* 边权折算 | ✅ 已改 |
| `crates/sim_core/src/spatial/agent.rs` | 移动速度按 `lane.terrain_profile.terrain_time_cost` 折算 | ✅ 已改 |
| `crates/sim_core/src/spatial/poi.rs` | 水源 POI 关联 `WaterPool`/岸点，保持既有采收 API | ✅ 已改（`water_pool_id`、`access_point_id`） |
| `crates/sim_core/src/spatial/ecology/harvest.rs` | 共享水池扣减与按 `agent.id` 升序稳定结算 | ✅ 已改 |
| `crates/sim_core/src/spatial/ecology/tick.rs` | 共享水池统一自然再生与 POI 储量同步 | ✅ 已改 |
| `crates/sim_core/src/spatial/world_save.rs` | `SAVE_FORMAT_VERSION = 7`，`terrain_state` 与 `water_pools` 入档与门禁 | ✅ 已改 |
| `crates/sim_core/src/config.rs` | 增加 10 个 T2 参数 | ✅ 已改 |
| `frontend/js/config.js` | 增加 10 个 T2 参数，`terrainProfile` 默认为 `'random'` | ✅ 已改 |
| `crates/sim_core/src/spatial/snapshot_bin/dict.rs` | 特征枚举注册 River, RiverBank, ShallowFord, SpringValley | ✅ 已改 |
| `frontend/js/render_terrain.js` | 河道、岸线、浅滩和泉谷特征渲染 | ✅ 已改（`drawFeatureItem`） |
| `frontend/js/render_hud.js` | 水源储量按水池去重聚合显示 | ✅ 已改 |
| `tools/config-check.js` | 增加 10 个 T2 字段映射与 240 参数一致性校验 | ✅ 已改 |

### 15.4 D-A 装饰系统基础

| 文件 | 修改内容 | 落地 |
|---|---|---|
| `crates/sim_core/src/geo/accents.rs` | 新增 `TerrainAccent`/`AccentKind` 数据结构 + 装饰生成器 | ✅ 已建（5 变体枚举、`ACCENT_RNG_SALT`、`generate_accents()`、基础数量 40/25/20、有界重试 3×） |
| `crates/sim_core/src/geo/terrain.rs` | `TerrainMap` 增加 `accents` 字段并在生成末尾调用 `generate_accents()` | ✅ 已改（`#[serde(default)] pub accents: Vec<TerrainAccent>`） |
| `crates/sim_core/src/geo/hydrology.rs` | 水系生成完成后调用装饰生成 | ✅ 已改 |
| `crates/sim_core/src/spatial/world_save.rs` | `terrain_state` 携带装饰（随 `TerrainMap` 序列化） | ✅ 已改 |
| `crates/sim_core/src/spatial/snapshot.rs` | 新增 `TerrainAccentSnapshot` + `terrain_accents` 字段 | ✅ 已改 |
| `crates/sim_core/src/spatial/world_snapshot.rs` | JSON 赋值（脏帧输出） | ✅ 已改 |
| `crates/sim_core/src/spatial/snapshot_bin/layout.rs` | 新增 `TerrainAccents=21` | ✅ 已改 |
| `crates/sim_core/src/spatial/snapshot_bin/encode.rs` | 装饰数据编码（约 24B/个） | ✅ 已改 |
| `crates/sim_core/src/spatial/snapshot_bin/dict.rs` | 注册 `accentKind` 枚举表 | ✅ 已改 |
| `crates/sim_core/src/config.rs` | 增加 3 个 D 系列参数 | ✅ 已改（总数 240） |
| `frontend/js/config.js` | 增加 3 个 D 系列参数 | ✅ 已改 |
| `frontend/js/snapshot-bin.js` | FABS Section 21 解码 | ✅ 已改 |
| `frontend/js/rustworld.js` | `_applySnapshot` 新增 `terrain.accents` 映射 | ✅ 已改 |
| `frontend/js/render_terrain.js` | 承载 `drawTerrainShell` + `drawAccentEntity` | ✅ 已建（`drawAccentTree`/`drawAccentBoulder`/`drawAccentBush`） |
| `frontend/js/render_world.js` | 装饰并入统一深度队列 | ✅ 已改（v1.50.2 `WORLD_ENTITY_ACCENT`） |
| `tools/config-check.js` | 增加 3 个 D 系列字段映射 | ✅ 已改 |
| `tools/test-snapshot-bin.js` | 新增装饰数据深比较（JSON vs 二进制） | ✅ 已改 |

> 原方案拟新建 `frontend/js/render_features.js` 承载独立特征绘制，实际未创建——特征绘制与地形壳层同驻 `render_terrain.js`。

### 15.5 D-B 装饰扩展 + 子特征注入

| 文件 | 修改内容 | 落地 |
|---|---|---|
| `crates/sim_core/src/geo/accents.rs` | 扩展 RockCluster/GrassTuft 类型生成 | ⏳ 未改（枚举已定义，生成未实现） |
| `crates/sim_core/src/geo/terrain.rs` | T1 子特征注入器（relief_rng 驱动） | ⏳ 未改 |
| `crates/sim_core/src/geo/hydrology.rs` | T2 子特征注入器（hydro_rng 驱动） | ⏳ 未改 |
| `crates/sim_core/src/spatial/snapshot_bin/dict.rs` | 注册 Cliff/Waterfall/WaterBody 特征表 | ⏳ 未改 |
| `frontend/js/render_terrain.js` | Cliff/Waterfall/WaterBody 特征绘制、Tree 季节色调细化 | ⏳ 未改 |
| `tools/config-check.js` | 子特征相关配置映射 | ⏳ 未改 |

## 16. 分阶段验收门禁

### 16.1 T0 门禁

- ✅ 同种子、同配置生成的地形网格、地表类别、查询结果和合法候选逐字节一致——已由 `test-wasm.js` 与 `test-determinism.js` 6/6 覆盖。
- ✅ 房屋占地跨越水域、陡坡、边界或已有占用时均返回稳定失败码，不生成实体——房屋占地已接入；其中“跨越水域”在浅水时返回 `WaterCovered`，深水返回 `DeepWater`，`Occupied` 由 `houses_clear` 判定。
- ✅ 路线曲线任一段穿过禁行单元时创建失败；仅端点合法不能通过——`validate_curve` 与 `segment_valid` 严格检查整条贝塞尔曲线与走廊宽度覆盖。
- ⏳ 初始营地、关键资源和市场位于预期陆路连通分量，往返成本不超过生存诊断上限——未实施（`spawn.rs` 基础生成）。
- ⏳ 现有无新地貌基线在关闭地形 profile 后保持行为等价——暂无 `flat_baseline` profile 开关（`generate_natural_landscape` 保留为兼容壳，默认仍走模板）。

### 16.2 T1 门禁

- ✅ 固定山口种子：主脊可从远景辨认，陡坡会挡路，山口存在合法连续路线——连续起伏地貌与路网感知生成已打通（v1.47.7 起不再有台地/特征轮廓绘制）。
- ❌ 台地房屋候选与平顶压平——v1.47.7 已整体删除，T1 不再生成台地。
- ✅ 两端欧氏距离相近但越过主脊的路线成本高于经过山口的路线；A* 考虑地形成本。
- ⏳ 生成失败时在有界重试后使用通过校验的简化 profile，并记录失败原因——`terrainGenerationMaxRetries` 未消费。
- ✅ T1 FABS 二进制与 JSON 深比较通过，读档/重置/回溯无旧特征或字符串串味——`test-snapshot-bin.js` 通过。

### 16.3 T2 门禁

✅ 全部通过（v1.47.5）：

- ✅ 河道有明确走向与单调下凹河床；普通陆路不穿深水，人物只能经两处浅滩跨河（`validate_terrain_world` 创世校验全通）。
- ✅ 浅滩具有明确地表通行代价（`terrain_shallow_water_cost`），过水真实减速，严禁借道浅滩沿河纵向涉水。
- ✅ 两岸岸点引用同一 `WaterPool`；多人采水按 `agent.id` 升序稳定串行扣减，家户账本与水池守恒，存读档多检查点逐字节吻合。
- ✅ 河阶平缓且肥力丰富（0.95），可容纳真实房屋占地；浅水占地严格返回 `WaterCovered` 拒绝建房。
- ✅ 水面、岸线、浅滩、人物和道路投影一致；HUD 水源储量按水池去重聚合，无虚高。
- ✅ T1/T2 随机轮换：当 `terrainProfile: 'random'` 时，基于种子哈希以 ~50% 概率自然分配至 T1 或 T2，且保持 100% 确定性。

### 16.4 D-A 装饰系统门禁

- ✅ 同种子、同配置生成的 `terrain.accents` 数组逐字节一致（id / kind / pos / scale / rotation / tint）——由 `test-determinism.js` 与 `test-wasm.js` 覆盖。
- ✅ 装饰物不进入道路/房屋/POI 占地禁区（生成时过滤 `NO_WALK`/深水/浅水，`Boulder+RockFace` 为受控例外）。
- ✅ 装饰密度与配置 `terrainAccentDensity` 呈线性关系（density=0 时无装饰；density=2 时数量约 2x 默认）。
- ✅ 装饰并入统一深度队列后按相机深度正确遮挡（v1.50.2），不再「远树压近树」或「近树被远人穿透」。
- ✅ FABS Section 21 编码/解码与 JSON 深比较通过（`test-snapshot-bin.js`）。
- ⏳ 换世界/读档/重置后装饰缓存无旧数据残留——当前依赖单一 `_terrainCached`，拆分后需独立验证。

### 16.5 D-B 子特征注入门禁

- ⏳ T1 子特征注入：当 `terrainAccentSubFeatures=true` 时，foot_lake/ridge_waterfall/forested_slope/rocky_outcrop 按 seed 哈希概率独立判定，同种子 100% 复现。
- ⏳ T2 子特征注入：oxbow_lake/river_cliff/riverside_forest/gravel_beach 同上。
- ⏳ 子特征注入不移动已有 POI/营地/路网节点位置（生成后校验：POI world_pos 与无注入时一致）。
- ⏳ Cliff 子特征对应地表写入 `NO_BUILD` 并硬禁行（`slope >45°`）；占地校验返回 `CliffTooSteep`。
- ⏳ foot_lake / oxbow_lake 生成 `WaterBody` 特征（静态水面），HUD 不重复统计其储量（非可采水点）。

### 16.6 通用确定性与性能门禁

每阶段至少覆盖：

```text
固定种子：山口聚落、两岸河谷、失败重试种子
多种子矩阵：不同 seed、不同 agentCount、不同 campCount
分批步进：1x 与批量 world_tick_steps
存读档：保存后继续推进与连续运行到同 tick 对比
回溯：回滚后重新推进，地形/路网/装饰无残留
换世界：RESET 后检查 FABS 字符串和特征缓存
```

实现门禁按改动类型执行：

- Rust/配置：`cargo test --lib`、WASM 编译、双副本同步、`node tools/test-wasm.js`、`node tools/config-check.js`。
- 快照：`node tools/test-snapshot-bin.js`，并核对 `snapshot.rs`、`world_snapshot.rs`、`encode.rs`、`snapshot-bin.js`、`rustworld.js`。
- 前端：`node tools/frontend-check.js`。
- 确定性矩阵：`node tools/test-determinism.js`（6 套件全通）。
- 跨文档：`node tools/cross-doc-check.js`（冲突 0、漂移 0）。

### 16.7 验收维度与风险控制

每阶段保留同种子、配置、Tick 的诊断记录，使用现有门禁与临时断言，不提交新的持久化单元测试。

| 验收维度 | 必须覆盖的场景 |
|---|---|
| 几何 | 河道出口、同湖水位、山口缓坡、完整曲线过水/穿壁、窄河与栅格边界 |
| 连通与生存 | 每个初始营地到水粮的成本；到关键资源/市场的合法路径；携物往返能否完成 |
| 扩张 | 房屋占地跨水、门前路径跨河、无有效地块时正常放弃/重试，不能瞬移绕过障碍 |
| 资源 | 多岸点同时采水不重复扣减或增发；私有触发器与断流兜底一致；背包和账本守恒 |
| 确定性 | 同种子逐字节一致、不同分批步进一致、存读档与回放一致、换世界无缓存残留 |
| 表现 | 浅滩与普通河面容易区分；山后选中对象可识别；水面/岸线/人物高程一致 |
| 性能 | 初始化耗时与重试次数有界，曲线校验不放入每帧；沿用景观计划渲染预算并新增内核基线 |

至少覆盖山口、两岸河谷各自的固定种子，以及多种子矩阵。为极端失败种子记录失败原因及模板回退，避免只展示精选好看的地图。

**重点风险及处理**：窄水体漏检用完整走廊/栅格穿越校验；山地导致饥渴死亡用资源路径成本与长程生存诊断；新水面造成无限水用共享资源池；高度场无法表达悬挑则限制地貌范围；动态洪水切断路线则延后至 T4，先完成运动与恢复规则；装饰影响观感但不参与判定，任何「装饰暗示可通行/可建造」都是缺陷。

## 17. 分阶段落地与景观计划对接

| 阶段 | 实施内容 | 前置条件 | 对接景观计划 | 现状 |
|---|---|---|---|---|
| T0：统一地表查询 | 占地/通行查询、完整曲线合法性、生成校验与固定诊断场景 | 读取相关局部指南，建立旧场景基线 | S1～S3 可先行；只消费旧地形 | ✅ 已落地 |
| T1：山口聚落 | 丘陵、山脊和山口连续起伏，适配选址与路网 | T0 通过 | 中期 M1 生成，M2/M3 表现 | ✅ 已落地（v1.47.1/v1.47.2） |
| T2：两岸河谷 | 静态主河、浅滩、河滩/河阶、泉谷与共享取水语义 | T1 稳定；水系、资源和快照契约就绪 | 中期 M4 完整垂直切片 | ✅ 已落地（v1.47.5） |
| D-A：装饰系统基础 | Tree/Boulder/Bush 三种装饰类型、FABS Section 21、季节色调开关 | T2 通过 | 中期 M2 素材与遮挡 | ✅ 已落地（v1.49.1） |
| D-B：装饰扩展 + 子特征注入 | RockCluster/GrassTuft、T1/T2 子特征注入（山脚湖/瀑布/峭壁/牛轭湖等） | D-A 通过 | 中期 M2/M3 | ⏳ 未实施 |
| D-C：高级装饰 | 泉水景观群、资源区景观群、标注避让 | D-B 通过 | 中期 M3 | ⏳ 未实施 |
| ~~T3：更多组合~~ | ~~湖泊、湿地、峡谷、瀑布；逐个验证~~ | — | — | ❌ v1.48.0 取消独立阶段，重组为 D-B 子特征注入 + 装饰系统；湿地明确删除 |
| T4：动态地理 | 枯丰水期、洪水、桥梁工程、土地演化；航运单独立项 | 动态状态存档、道路失效及决策恢复先完成 | 长期 L1/L2 | ⏳ 未实施 |

第一张有水的新地图采用“一条主河 + 两处静态浅滩 + 两岸可建河阶 + 少量丘陵”（T2 已落地），两处浅滩用于比较绕行距离并减少单通道风险。数量是原型建议，进入实现后配置化。初始营地数量继续服从现有配置，不限定为两座。

T2 不以完整水文系统、桥梁建造或 GPU 渲染器为前置条件；固定水位也必须保证几何、导航、资源与画面一致。景观原计划的工时估算不包含 T0～T4 的新增内核工作，完成 T0 原型后单独估算。

## 18. 实施顺序与退出标准

按以下提交边界推进，每个边界都可独立回滚。✅ = 已落地，⏳ = 待实施：

1. ✅ **T0-A：数据模型和查询**。只增加 `GeoCell` 字段、查询服务和固定诊断，不改变默认地图外观——已落地（v1.47.1）。
2. ✅ **T0-B：生成校验和房屋接入**。完整占地、完整曲线、浅滩走廊校验通过——已落地（v1.47.1/v1.47.5）。
3. ✅ **T1-A：山口地貌**。固定 profile、山脊/山口连续起伏生成、路网成本和存档版本门禁——已落地（v1.47.1/v1.47.2）。
4. ✅ **T1-B：山地景观**。材质与地表渲染通过——已落地（v1.47.2）；v1.47.7 删除台地平顶压平与 Ridge/Saddle/Terrace 特征/绘制。
5. ✅ **T2-A：静态水系几何**。河道、河阶、岸带、浅滩和水系特征折线生成——已落地（v1.47.5）。
6. ✅ **T2-B：共享水池与两岸玩法**。采水稳定排序聚合、浅滩跨河走廊、地形成本折算、断流与 HUD 统计——已落地（v1.47.5）。
7. ✅ **T2-C：完整垂直切片**。两岸河谷的内核、WASM、存档（FORMAT 7）、前端、T1/T2 随机轮换和 6 套件确定性矩阵全部通过——已落地（v1.47.5）。
8. ✅ **D-A：装饰系统基础**。Tree/Boulder/Bush 三种装饰类型，FABS Section 21，前后端确定性通过——已落地（v1.49.1，v1.49.2/v1.49.3/v1.50.10 打磨）。
9. ⏳ **D-B：装饰扩展 + 子特征注入**。RockCluster/GrassTuft、季节色调、T1/T2 子特征注入。
10. ⏳ **D-C：高级装饰**。泉水景观群、资源区景观群、标注避让。

**T1/T2 退出标准**：同版本同种子可复现；同一静态世界的地理、路网、资源、选址和画面事实一致；失败有界且可解释；旧 profile 不会被新生成器静默加载；普通观察能在短时间内辨认主要地貌、聚落、主路和水源区。T0、T1、T2 已全面达到退出标准。

**D 系列退出标准**：装饰地形视觉丰富度显著提升（不再只有空地）；装饰不影响既有通行/库存/选址逻辑；性能增量 p95 ≤ 3ms。D-A 已达标；D-B/D-C 待验证。

## 19. 明确不做的事项

本方案不包含：

- 完整侵蚀、流体、地下水、洪水和枯丰水期模拟；
- 游泳、船舶、桥梁建造、动态路卡和运行中地形改造；
- 由山地自动产生防御、税收、矿产或行政优势；
- 由河滩/高肥力标签直接发放粮食；
- 前端自行生成碰撞、水体库存、资源产量或可通行路线；
- 在系统 tick 中扫描居民并强制改写决策状态；
- 为了画面效果提前添加尚未通过内核契约的横穿道路大河、深湖或悬崖；
- 以 GPU/3D 引擎升级替代 T0 的查询、存档、确定性和路网基础工作；
- ❌ **独立湿地（Wetland）profile / 特征**——视觉辨识度低、与河滩/河岸功能重叠，v1.48.0 起明确删除，不规划；
- ❌ **独立 T3 profile 阶段**——v1.48.0 起取消，原内容重组为 D-B 子特征注入与装饰系统。

### 19.1 文档范围说明

本次合并**不修改运行时行为、应用版本或存档格式**。实施时按根 [AGENTS.md](../AGENTS.md) 执行升版、WASM 双副本、配置、快照与确定性门禁，并将已交付内容同步至现状文档（`docs/current/01-spatial-network.md`、`08-config-system.md`、`15-save-load.md`、`07-frontend-ui.md`、`13-impact-matrix.md` 等）及 `docs/current/11-changelog.md`。
