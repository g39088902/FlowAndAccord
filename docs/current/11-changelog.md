# 📜 版本演进记录 (Changelog)

> **模块索引**：[← 返回 current.md 全景索引](../current.md)
> 本文件为里程碑级变更记录，按版本号倒序排列。最新版本：**v1.26.9**。

| 版本 | 核心变更 | 影响模块 |
| :--- | :--- | :--- |
| **v1.26.9** | POI 私有施密特触发器开启阈值 `decisionPoiSeekMinStockRatio` 由 0.30 提升至 0.50（库存 ≥ 50% 才触发去采集，关闭阈值 0.10 不变），同步 Rust 默认值与前端动态配置 | config / decisions / docs |
| **v1.26.8** | 全部 POI（清泉/浆果/林木/石矿/金矿及榷场互市水粮双库存）储量上限翻倍：stock_max_* / market_stock_max_* 由 100 提升至 200，同步 Rust 默认值与前端动态配置 | config / ecology / frontend / docs |
| **v1.26.4** | 营地房屋上限调整为 25 栋，行政级别门槛调整为 5 / 10 / 15 / 20 栋，并同步 Rust 默认值与前端动态配置 | config / poi / housing_system |
| **v1.26.5** | 生育改由尊重需求“养育小孩”行动触发：仅满足原受孕条件的已婚成年男性进入分支，取消女性自动受孕 | decisions / agent / world_tick |
| **v1.26.3** | 营地选中态新增营地至辖区房屋的特殊连线；营地详情卡片按空置与已有人居住分组展示全部房屋 | frontend / housing_system |
| **v1.26.3-win** | 调试模式累计开采量按水/粮/木/石/金五个品种拆分展示，保留合计字段并透传快照 | agent / ecology / snapshot / frontend |
| **v1.26.2-win** | 调试模式新增 Agent 累计开采资源量统计，口径为从资源点装载入随身行囊的总量 | agent / ecology / snapshot / frontend |
| **v1.26.2** | 营地行政级别升级的房屋数量门槛集中为 `SimConfig` 超参数，并同步注入前端 `config.js` 与配置校验 | config / poi / housing_system |
| **v1.26.1** | 优化 `AGENTS.md` 表述并拆分提交前检查单至 `docs/current/19-commit-checklist.md`，根指南保留入口、触发条件和最低提交门槛 | docs / engineering |
| **v1.26.0** | 房屋拍卖系统重构：① 出价下沉到 agent 个体决策相位——新增 `B17BidHouse` 分支，无房成年男性每次只对随机一套在售房屋出价，出价后进入 300 tick 全局冷却，根治同一 tick 单人多次成交；② 成交判定改为「新报价驱动」，删除出清期历史报价回溯；③ 删除纯展示的估价机制（`current_valuation` / 建设成本折算 / 双轨估价 / D/S 供求比），前端四处估价展示改为最高出价/标杆价；④ 报价流水绑定拍卖会话并加环形上限（不跨场次）；⑤ 取消出价上限改为倾囊竞价；⑥ 成交价款份额制分账——王国公户作为受益人之一（权重可配）+ 在世配偶/子女各 1 份，无人类受益人时王国独得（天然兜底），新增 `EstateShare` / `TransferTax` 流水；⑦ 修复旧住户残留（挂牌即清空居住者）与前端买家池年龄阈值 | housing_system / decisions / ledger / config / frontend / docs |
| **v1.25.7** | 在 `AGENTS.md` 增加集中式 commit 前检查单：所有提交基础检查、Rust/WASM、前端、配置、诊断和最终 diff 审阅按改动类型分级执行 | docs / engineering |
| **v1.25.6** | 在 `AGENTS.md` 增加 commit 前检查单入口，要求提交前运行文档维护体检，并区分日常检查与发布前 `--strict` 门禁 | docs / engineering |
| **v1.25.5** | 新增文档维护发现机制：维护清单登记责任人与源码范围，自动体检文档新鲜度、复核周期、缺失来源与未登记文档，并提供 JSON/CI 严格模式 | docs / tools |
| **v1.25.4** | 新增前端窗口结构与跳转关系参考文档：梳理主世界布局、常驻面板、模态窗口、独立族谱页及跨窗口导航契约 | docs / frontend |
| **v1.25.3** | 为行动状态机、生命周期与孕育、房屋全生命周期三大核心机制补绘 mermaid `stateDiagram-v2` 状态图（纯文档） | docs |
| **v1.25.2** | 拍卖大盘文案产品化："窥视实时竞拍"统一改为中性的"查看实时竞价与麦穗博弈大盘" | frontend / docs |
| **v1.25.1** | 前端产品化修复：统一 POI 数量文案、重演生态增加不可逆确认、WASM 加载状态可见、存档降级路径补齐、窄屏布局与可访问性优化 | frontend / docs |
| **v1.25.0** | 删除 `is_moving` 白名单，移动改由 `current_lane_id` 唯一驱动；新增 `enter_stationary_state()` 作为非移动态切换唯一入口，杜绝残留移动 | agent / decisions / ledger / housing / docs |
| **v1.24.0** | 修复求偶卡死：`SeekingCourtship` 未列入移动白名单导致男性定格在家；加固路径走完重补路判定 | agent / decisions / docs |
| **v1.23.0** | 房屋估价改按榷市实时价：0 级保底 5.0→0.1 金，木/石/金单价暂记 0（榷市未承载），建设成本仅水/粮按实时市价折算 | config / auction / docs |
| **v1.22.5** | 生育节奏再提速：妊娠期/流产冷却/产后冷却统一 450→200 秒；妊娠进度条改读配置实时显示 | config / frontend / docs |
| **v1.22.4** | 拍卖大盘无在售房空态修复：禁止拿世界第一栋房占位显示，改为空态占位文案 | frontend |
| **v1.22.3** | 拍卖大盘交互修复：高频 innerHTML 重建导致点击无反应，引入内容快照缓存（与 ledger-ui 同款） | frontend / docs |
| **v1.22.2** | 夺位远征层级回归生理层（第一层生存需求）：王位=资源分配权=生存，保留"夺位远征"显示文案 | frontend / decisions / docs |
| **v1.22.1** | 夺位远征重分类为自我实现层 + Inspector 正确显示"夺位远征"（修复 reason 降级为"吃饭喝水"） | frontend / decisions / docs |
| **v1.22.0** | 初王必须物理抵达营地才登基（杜绝 tick0 秒封）；封王即终止远征修复一人双王；始祖沿路网 Edge 行走确认；出生兜底加固 | ledger / decisions / ecology / docs |
| **v1.21.1** | 始祖出生地去营地化（避让营地 POI 安全距离）；账本大盘悬停防闪烁（内容快照缓存）；角色卡片点击穿梭修复（全局 `focusOnAgent`） | ecology / frontend / docs |
| **v1.21.0** | 确定性无头诊断体系落地：`tools/diagnose.js` CLI（毫秒级极速推进 + 异常嗅探引擎）；`AgentSnapshot` 新增 `family_stock_active` 透传；排障文档 SOP | tools / snapshot / docs |
| **v1.20.0** | 生育节奏提速：妊娠期与产后冷却 900→450 秒，流产冷却维持 450s | config / docs |
| **v1.19.0** | 求偶成婚优先级提升：b16 从第 11 位提升至第 8 位（置于备料分支之前），修复单身男性长期无法求偶导致人口灭绝 | config / docs |
| **v1.18.0** | 国王与宗族长老享有 +3 威望（荣誉政治身份落地），兼任双重身份叠加为 +6；前端威望徽章与来源提示 | config / ledger / frontend / docs |
| **v1.17.0** | 分家双亲权重调整（父在世权重1+母在世权重1）；户主遗产配偶纳入平分继承范围；随身金币继承同步纳入妻子 | bookkeeping / ledger / frontend / docs |
| **v1.16.0** | 婚姻系统马斯洛引擎驱动：废除自动成婚摊派，新增 B16 求偶决策分支（男性主动发起，检索魅力最高单身女性），全程 Agent 自主行为 | decisions / marriage / agent / docs |
| **v1.15.1** | docs 根目录文档命名统一：8 个全大写文档改为小写连字符风格，全仓库交叉引用同步更新（纯文档） | docs |
| **v1.15.0** | 房屋拍卖交易所 UI 窗口：在售房屋呼吸标牌、麦穗 37% 博弈时间轴、意向买家池、实时竞价流水、全渠道便捷入口 | frontend / docs |
| **v1.14.0** | 二手房屋市场与麦穗 37% 拍卖系统：双轨估价（有闲置土地=建设成本上限 / 无闲置=供求比溢价）、观察期树标杆+决策期成交+出清期强制、报价/成交档案持久化 | house / auction / config / docs |
| **v1.13.0** | 外部市场（榷场互市 #60）与幂律动态价格系统：双库存（水/粮）、$P=P_0×(S_{max}/S)^k$ 定价、B15 榷场商贸决策分支、现场自救+连续装袋购入 | poi / decisions / ledger / config / docs |
| **v1.12.0** | 营地辖区详情模态框（继承人/历史国王含在位时长死因/管辖家庭/空置房/公仓账本）；存档体系文件槽位化（3 固定槽位 + IndexedDB 持久化句柄） | ledger / snapshot / frontend / docs |
| **v1.11.0** | 本地文件存档（File System Access API）：存档直写用户磁盘突破浏览器配额，自动保存智能切换，兼容性降级 | frontend / docs |
| **v1.10.0** | 营地房屋上限（30栋）+ 删除绝嗣废弃状态与加速风化 + 删除房屋继承逻辑改为空置房屋登记（事件驱动）+ `owner_id` 改 Option | config / house / poi / decisions / docs |
| **v1.9.1** | 宗族与女性彻底解耦：宗族回归纯父系男性团体，女性一律拒绝入族；移除"在世女性统计" | ledger / snapshot / docs |
| **v1.9.0** | 夺位远征决策引擎化（B14 分支，删除旧远征系统）；无房国王盖房约束；始祖出生地普通道路节点；王国情报（历史国王）；宗族绝嗣标记+族产平分；UI 十项改造 | decisions / ledger / agent / docs |
| **v1.8.7** | 内核死亡/流产墓碑（`recent_deaths`）+ 前端档案库死因补记与流产胎儿入族谱，修复高倍速下死亡族人档案滞留"健在" | world / snapshot / frontend / docs |
| **v1.8.6** | 房屋新增「修建/升级者」历史确权字段（`builder_id`/`last_upgrader_id`，不随继承改变）；存档格式 v1→v2 | house / frontend / docs |
| **v1.8.5** | 移除建筑卡片冗余状态标签（与耐久度条重复的"建筑磨损折旧"分支） | frontend |
| **v1.8.4** | 修复产后冷却提示文案：前缀随冷却类型动态切换（产后休养🤱 / 流产调养🥀） | frontend |
| **v1.8.3** | 产后休养冷却（分娩后 900s 禁孕），与流产冷却 450s 独立设置 | agent / config / frontend / docs |
| **v1.8.2** | 修复控制台面板样式溢出（固定高度→自适应）；重演生态按钮文案精简 | frontend |
| **v1.8.1** | 修复 v1.7.1 render 拆分回归：`w/h` 块级作用域导致地形无法渲染，提升为文件全局共享状态 | frontend |
| **v1.8.0** | M9 读档/存档系统：世界全量状态 JSON 持久化（`WorldRng`/`LaneGraph3D`/POI 序列化补齐），WASM 6 个导出，前端三槽位存档 UI | world / rng / graph / poi / wasm / frontend / docs |
| **v1.7.1** | 代码体量治理：world.rs 881→5 文件拆分、render.js 2128→5 文件拆分；配置字段→影响模块映射；核心不变量集中清单（14-invariants.md） | world / render / config / docs |
| **v1.6.1** | 工程校验工具链：`code-map-check.js`（文件树与代码地图交叉对比）+ `snapshot-check.js`（快照字段三处一致性校验） | tools / docs |
| **v1.6.0** | M8 房屋升级材料成本矩阵化：每级固定数值矩阵（1级水粮各50 / 2级木粮水各75 / 3级石木粮水各100 / 4级金石木粮水各125），20 个新超参拆分为独立配置文件 | needs / construction / config / frontend / docs |
| **v1.5.1** | Agent 启动加速文档体系：跨模块影响矩阵（13-impact-matrix.md）+ spatial/AGENTS.md + frontend/AGENTS.md 三份嵌套操作指南 | docs |
| **v1.5.0** | M7 家庭库存施密特触发器：去采货与房屋等级彻底脱钩，余额<100 触发去采、补到≥200 才停（滞回带）；升级就绪改按材料成本 | decisions / housing / agent / config / docs |
| **v1.4.0** | M6 房屋去仓储化：家户账本=家庭物资唯一真相源（取消仓储容量上限）；婚姻/生育去房屋化（无房可婚可育）；房屋升级瞬时化（删施工工时）；威望（prestige）落地 | house / ecology / marriage / agent / decisions / config / docs |
| **v1.3.7** | 决策引擎视图交互修复（拖卡位移累加/分界线条色不刷新）+ 左右栏 UI 重设计 + 行动状态中文语义 | frontend / docs |
| **v1.3.6** | 决策顺序可编排：内核 13 条硬编码抽为分支注册表，Rust 层完全无顺序，前端拖动热注入 + 落盘持久化，策展序唯一真相源为 `config.decision-order.js` | decisions / config / frontend / docs |
| **v1.3.5** | 受孕即建胎儿 Agent 身份（M1.7）：胎儿加入父母家户天然计入继承，无需求消耗/无地图实体/跳过决策，分娩原位复用胎儿 ID | agent / world / birth / bookkeeping / docs |
| **v1.3.4** | 分家权重修复：丧父分家时亡父不占权重（W=n），与继承清算语义一致 | bookkeeping / ledger / docs |
| **v1.3.3** | `FoundHome` 需求层级提升：由归属层改为生理层最后一档（解渴→觅食→体力休养之后），无家成年男性必然触发 | decisions / docs |
| **v1.3.2** | 文档全量同步对齐 v1.3.0 代码状态：账本模块文档重写为 M1~M4 已实现态、规划文档状态更新、嵌套 AGENTS.md 补全（纯文档） | docs |
| **v1.3.1** | 新增面向玩家的营销型 README.md（纯文档） | docs |
| **v1.3.0** | M4 地区与王国内核：Region 团体（每营地一册）、初王顺位（到达时序）、夺位远征（SeekingThrone）、长子继承制、公仓税与救济 | ledger / agent / decisions / config / docs |
| **v1.2.0** | M3 宗族内核：按姓氏自动聚合、族长顺位、族税（每1800tick 5%）、族内互助（极贫家户拨付） | ledger / world / config / docs |
| **v1.1.0** | M2 账本内核：旁路记账（Deposit/Consume/Heating）、分家抽资、父亲死亡继承、出生入家户钩子 | ledger / world / bookkeeping / docs |
| **v1.0.2** | UI 全景剖析与新功能设计规范文档（纯文档） | docs |
| **v1.0.1** | 全量文档重构精简：修复版本号/POI数量/字段数失同步，压缩 changelog 与规划文档（纯文档） | docs |
| **v1.0.0** | 里程碑：账本与家户/婚姻系统 M1 完成，版本策略升级（M 里程碑递增次版本号） | 全项目 |
| **v0.9.75** | AGENTS.md 补充 3000 端口已占用时无需重复启动 server.js（纯文档） | docs |
| **v0.9.74** | 家户与账本大盘面板可点击性修复（`pointer-events:auto`） | frontend |
| **v0.9.73** | 账本前端 UI 展示：家户/婚姻/账本余额快照，顶栏统计 + Inspector 卡片 + 可折叠面板 | snapshot / frontend |
| **v0.9.72** | 账本与婚姻登记系统 M1 奠基：`ledger/` 模块（Ledger 双环形流水 / Group 团体基类 / MarriageRegistry / HouseholdRegistry），胎儿预分配 AgentId | ledger（新模块） |
| **v0.9.71** | 3 级木石庄舍图标去重（🏛️→🏯） | frontend |
| **v0.9.68~70** | CI/CD 自动部署流水线：GitHub Actions 编译 WASM → test-wasm.js 门禁 → 腾讯云 COS 增量上传 | .github / docs |
| **v0.9.67** | 浏览器自动化使用指南落库（纯文档） | docs |
| **v0.9.66** | 道路衰减改比例模型（`wear × (1 - rate×dt)`），清理越野惩罚死机制 | graph / frontend / config |
| **v0.9.65** | 行走速度重构：默认速度 + 力量直接乘率（无 clamp），速度不再受体力影响，清理 7 个废弃超参 | agent / config |
| **v0.9.64** | 族谱时间轴布局重构：废除力导向，Y 严格线性映射出生 tick + X 冲突横向扩展 + 视口虚拟化 LOD | frontend/dag |
| **v0.9.63** | 全量消除 magic number：161 个超参收口 `config.js`，新增 `config-check.js` 前后端一致性校验 | config / frontend / tools |
| **v0.9.57~62** | 族谱系统迭代：全量血脉单图 → 力导向 → 纯力学 → 出生时序纵向重力 → 无惯性收敛 → 直系血脉裁剪（最终于 v0.9.64 被时间轴取代） | frontend/dag |
| **v0.9.56** | 无头模式顶栏常驻更新 + 每秒 Tick 监视 + 空格键全局暂停 + 族谱拖拽修复 | frontend |
| **v0.9.55** | 文档目录整合：非 AGENTS.md 文档全部移入 `docs/`（纯文档） | docs |
| **v0.9.54** | current.md 按功能模块拆分：根索引 + `docs/current/` 分模块文档两级结构（纯文档） | docs |
| **v0.9.53** | 死亡数区分自然死亡（寿终正寝）与非自然死亡（饿死/渴死），顶栏分列统计 | agent / snapshot / frontend |
| **v0.9.52** | 视图显隐改造：新增隐藏部落民/隐藏路网开关，POI 指示环改为恒显 | frontend |
| **v0.9.51** | 步行速度受力量禀赋加成（后于 v0.9.65 重构为力量直接乘率） | agent / config |
| **v0.9.50** | 道路衰减速率翻倍（线性模型阶段参数调整，后于 v0.9.66 改为比例模型） | graph / config |
| **v0.9.49** | 调试模式监视器：Tick/FPS/内核耗时/快照耗时/CPU/内存/WASM 内存九项指标 | frontend |
| **v0.9.48** | 立宅优先复用空置路网节点：候选宅址 20m 半径内若存在空置节点则直接复用 | housing / graph |
| **v0.9.47** | 超高倍速支持（256x/512x/1024x），建房最小间距 14→28m | frontend / config |
| **v0.9.46** | 嵌套 AGENTS.md：为 sim_core / sim_wasm / decisions / housing_system 四个目录新增局部操作指南（纯文档） | docs |
| **v0.9.45** | 决策模块子目录化拆分：`evaluator.rs` 拆为 7 个子模块 | decisions |
| **v0.9.44** | 决策概率全部收敛为确定性执行（无掷骰），立宅选址参数全部入 `SimConfig` | decisions / config |
| **v0.9.43** | 建房/升级/修缮全流程回归 Agent 自主决策：废除系统发房扫描器，新增 `FoundHome` 需求 | decisions / housing |
| **v0.9.42** | 开局人口 12→20（10男10女），百家姓库 60→150 | ecology / agent / frontend |
| **v0.9.39** | 混沌系统测试策略落地：不再持久化单元测试，长期确定性验证由 `test-wasm.js` 承担 | 工程规范 |
| **v0.9.38** | 文档偏差修复：修正 AGENTS.md / current.md / build-guide.md 等与现状不符的描述（纯文档） | docs |
| **v0.9.37** | 婚姻系统与建房事件解耦：移除升级竣工即时迎娶钩子，成婚统一由 `marriage.rs` 扫描匹配 | housing / marriage |
| **v0.9.35** | 简化四季参数模型：废除 `season_quarter_length`，单季长度由 `year_length × 0.25` 派生 | config / world |
| **v0.9.34** | 房屋系统与世界环境模块化解耦：`housing_system` 拆为 5 个单一职责子模块，四季回归 `world.rs` | housing / world |
| **v0.9.24** | 随身金币遗产继承：族人故去后 `carried_gold` 平分给在世子一代子女，无子女则清零 | agent / ecology |
| **v1.26.6** | 改善型换房竞买：有房户主可按等级差竞买更高等级房屋，资源差×市场价成本报价，麦穗决策期 `≥` 标杆成交，成交后旧房自动挂牌 | decisions / housing / ledger / wasm / docs |
| **v1.26.7** | 重规划拍卖与统计界面：历史页隐藏在售房源、买家池补充低等级家户核对、移除冗余图例/随身均值/贫富倍差、家户页增加资源均值、榷场展示交易流水、决策分界线支持动态末端位置 | frontend |
