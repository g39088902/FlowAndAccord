# 📜 版本演进记录 (Changelog)

> **模块索引**：[← 返回 01-current.md 全景索引](../current.md)
> 本文件为里程碑级变更记录，按版本号倒序排列。最新版本：**v1.42.1**。

| **v1.42.1** | 落地 M2 里程碑「道路自然衰减优化：稀疏活跃边集合与衰减优化」（攻克第一大算力瓶颈，确定性全通）：① **稀疏活跃磨损边集合（Sparse Active Wear Set）**：`LaneGraph3D` 内部维护确定性有序集合 `active_wear_edges: BTreeSet<EdgeIndex>`，仅在车道有族人通行踩踏（`wear > 0.0`）时纳入扫描，从根源上消除了每拍无条件全图遍历数百条未踩踏荒野边的无谓开销；② **衰减清零安全退出**：`tick_wear_decay` 仅遍历该活跃子集，当车道踩踏值衰减至 `< 1e-5` 时自动置为 `0.0` 并移出集合，存读档按 `lane.wear > 0.0` 零成本即时重建，新旧存档双向完全兼容；③ **极致性能收益**：Phase 4（道路自然衰减）耗时从 **3.07 µs/tick 暴降至 0.40 µs/tick（单项耗时压降 87%）**，仿真总时间占比由 30.7% 压缩至 4.4%，彻底退出第一算力瓶颈行列；④ **确定性矩阵全通**：`test-determinism.js` 6/6 套件（多随机种子一致、多步长批次等价、子阶段步进等价、快照无副作用、多点倒流存读档严格一致、多人口规模数值稳定）及 `test-wasm.js` 全部逐字节一致通过 | sim_core / graph / agent / docs |

| **v1.42.0** | 落地 M1 里程碑「Worker 快照节流与步进循环解耦」（纯前端优化，内核零改动，确定性零风险）：① **快照下发 60Hz 严格节流**：`sim_worker.js` 引入 `lastSnapshotTime` 时间戳，`simulationStep` 中快照生成严格锚定 16.6ms 前端真实刷新周期，窗口未到前 Worker 专职推进 `world_tick_steps`、跳过 `pullSnapshot` 的 JSON 序列化与主线程通信，彻底消除高倍速（64x~1024x）下每秒上百次快照造成的算力空耗与视口跳帧；② **高倍速检查点写入现实时间守卫**：`recordHistoryCheckpoint` 在原有 30 tick 间隔守卫外叠加 150ms 现实时间守卫（`lastCheckpointRealTime`），避免 1024x 倍速下单秒 30+ 次 `world_save` 导出 400KB 字符串引发的 GC 停顿，首档（genesis）检查点不受现实时间守卫限制，确保时光倒流首档必然保存；③ **命令式快照路径保持原样**：STEP（手动单步）/CONFIG/REWIND/RESET/LOAD/INIT 分支的 `pullSnapshot + postMessage` 不套用节流窗口，`forceTerrain` 立即下发绕过 16.6ms 窗口，保留 ACK 流控语义；④ **重置联动**：INIT/RESET/LOAD 重置 `lastCheckpointTick` 处同步重置 `lastCheckpointRealTime` | frontend / docs |

| **v1.41.0** | 落地性能 Profiling 基准分析套件与增强型确定性矩阵验证套件：① **内核 8 大子阶段解耦与零导入子阶段步进探针**：重构 `crates/sim_core/src/spatial/world_tick.rs`，将原有按序 `tick` 过程纯净萃取为 8 个子阶段阶段方法（四季与POI再生、代谢与繁衍、POI交互装载卸货、房屋折旧与冬季供暖、道路杂草衰减、动力位移踩踏拓路、马斯洛错峰决策与物理规则结算、家庭/宗族/王国账本、墓碑清理），保持单核连续内联极致执行；`crates/sim_wasm` 导出 `world_tick_subphase(phase_idx, dt)`，无任何外部时钟导入依赖，确保 100% 保持 raw wasm 架构与浏览器 Worker 安全零导入契约；② **全景基准测试工具（`tools/profile-benchmark.js`）**：支持单 Tick 与多 Tick 宏观吞吐量（实测单核 50,000+ TPS，单步约 15~18µs，单秒推进 ~1000 游戏小时）、P50/P90/P95/P99 延迟分位数、8 大子系统耗时占比 ASCII 条形图分析（明确 Phase 4 道路衰减 30% 与 Phase 6 决策寻路 28% 为核心算力大头）、快照序列化耗时分析（实测 Rust 序列化 ~1.3ms + JS 反序列化 ~1.6ms，单次快照总代价等价于 ~160~200 个模拟 Tick 计算，为后续二进制零拷贝提供坚实数据支撑）、规模扩展性（20/50/100 人口）与批次步长（1~1024 步）压测，并支持基准 JSON 导出与 `--compare` 自动化加速比对照；③ **增强型确定性矩阵测试套件（`tools/test-determinism.js`）**：落地六大不变量定理验证：多随机种子独立重放一致性（5组种子逐字节比对）、步长分批推进独立性（1 步 vs 10 步 vs 100 步 vs 600 步批次状态绝对一致）、子阶段步进等价性（`tick` 与循环 `subphase` 100% 等价）、快照生成无副作用性（高频提取快照对后续物理与 RNG 序列零污染）、多时间切片存读档连续性（多检查点倒流重放 100% 逐字节吻合）、多初始人口规模数值鲁棒性（10/20/50 人口无 NaN、无越界且绝对确定）；④ **对齐道路磨损衰减前后端配置**：修复 `roadWearDecayRate` (0.005) 与 `roadWearStepInc` (0.1) 细微漂移，`tools/config-check.js` 恢复全绿；⑤ **全景操作指南文档沉淀**：新建 `docs/15-profiling-and-benchmarking-guide.md`，规范化 AI Agent 性能优化 SOP（先存基准 → 代码优化 → 确定性门禁 → 加速比对照），更新 `AGENTS.md` 与 `01-current.md` 索引表 | sim_core / sim_wasm / tools / docs / config |

| **v1.40.3** | A* 寻路纳入道路速度加成（0.25 级离散阶梯步进）与跨阶失效机制：① **A* 寻路感知踏路成道速度加成**：重构 `graph.rs::compute_path_3d_with_preference`，将原本仅乘以死常数（`road_level_factor_base` 0.50）的边有效速度改用量化踩踏等级计算（`effective_wear = bucket * 0.25`，速度乘子 0.50x~2.20x），使寻路算法真正能够感知踩踏提速，优先选择已踏宽成型的通衢主干道，彻底恢复 Stigmergy 踏路成道宏观涌现；② **0.25 级阶梯量化与缓存稳定性**：引入 `road_wear_tier_step`（默认 0.25 级，前后端 204 个超参对齐），道路踩踏值在同一个 0.25 区间内微小波动时保持相同阶梯，既避免每步 0.1 踩踏导致频繁清空缓存，又精准反映道路等级升级；③ **跨阶安全失效生命周期**：在 `agent.rs` 踩踏拓路与 `graph.rs` 自然衰减中增加跨桶（跃迁 0.25 门槛）比对，仅在跨阶时触发 `clear_path_cache()`，满阶主干道（wear >= 5.0）不再发生跨阶，实现 100% 缓存命中；④ **全链路门禁通过**：WASM 双副本编译同步，同种子逐字节确定性与长程稳定回归通过，配置检查与文档维护体检全绿 | sim_core / graph / agent / config / frontend / docs |

| **v1.40.2** | 道路耐久度余额溢出缓冲机制（最多允许累加至 10.0，>5.0 封顶无额外速度增益）：① **踩踏耐久上限扩容至 10.0**：`ROAD_MAX_WEAR` 与前端 `roadMaxWear` 提升为 `10.0`，族人高频通行道路的耐久度余额可向上溢出累加至最高 10.0，使高频繁忙干线具备更深厚的抗闲置衰减缓冲储备；② **移速加成 5.0 严格封顶**：新增配置 `road_benefit_max_wear: 5.0`（`roadBenefitMaxWear`），移动动力学中行人的道路速度系数计算严格基于 `effective_wear = lane.wear.min(road_benefit_max_wear)`，确保踩踏值超过 5.0 时不提供额外移速增益；③ **视口悬停提示与溢出展示**：Canvas 悬停提示中耐久度进度条适配 10.0 上限并在超过 5.0 时展示高亮渐变与 `(溢出 +X.XX)` 缓冲标签，移速加成注明 `满额无额外增益`；④ **WASM 与门禁闭环**：完成 WASM 编译双副本同步，203 个超参 100% 对齐校验通过，测试全绿 | frontend / sim_core / config / docs |

| **v1.40.1** | 道路演化数值平衡精细调优：① **道路自然衰减率降至 0.5%/h**：将 Rust 内核常量 `ROAD_WEAR_DECAY_RATE` 与前端 `roadWearDecayRate` 默认超参从 0.0067（0.67%/h）下调至 0.005（0.50%/h），减缓偏僻小径和主干道的闲置磨损荒废速率；② **单次通行踩踏增益提升至 0.1**：将 Rust 内核常量 `ROAD_WEAR_STEP_INC` 与前端 `roadWearStepInc` 默认超参由 0.08 提升至 0.1（0.10/次），进一步强化族人踏路成道（Stigmergy）正反馈响应灵敏度；③ **渲染与文档三处同步**：Canvas 视口路网悬停提示 fallback 对齐为 `+0.1/次` 与 `0.50%/h`，完成 WASM release 编译与双副本同步，参数速查表与机制文档一致性全数通过 | frontend / sim_core / config / docs |

| **v1.40.0** | 落地 TODO.md 三大愿景（时光倒流 UI 修复与精简、马斯洛引擎入口迁移至右上角、路网单次行走踩踏增益提至 0.08）：① **时光倒流系统 UI 错乱修复**：精准定位并修复 `frontend/style.css` 历史遗留的闭合大括号缺失 Bug（第 3122 行 `.save-slot-badge.local-connected`），恢复浏览器 CSS 解析器对后续 `.rewind-modal-overlay`、`.rewind-modal-card`、明亮主题及辖区模态等关键样式的正常解析；时光倒流控制器恢复屏幕正中拟态弹窗浮层与居中布局，彻底根除漂移至左上角塌陷与被遮挡问题；② **顶栏与控制台按钮结构精简迁移**：移除顶栏右上角的冗余倒流按钮（仅保留左下角控制台 `⏪ 时光倒流` 按钮）；将马斯洛决策引擎入口（`#btn-decision-viz`）迁移至顶栏右上角存档卡片区域（`.save-bar-card`），控制台按钮精简为 4 个（暂停、重演生态、时光倒流、无头模式）并呈现对称 2×2 网格布局；③ **路网踩踏增益提升至 0.08**：将 Rust 内核 `ROAD_WEAR_STEP_INC` 常量、前端 `roadWearStepInc` 默认超参、Canvas 视口悬停提示 fallback 以及文档规范由 0.05 提升至 0.08，强化部落民单次通行对道路等级演化的正反馈涌现能力，完成 WASM 编译与双副本同步 | frontend / sim_core / config / docs |

| **v1.39.1** | 前端与内核剩余时间单位统一为“小时”（/h）与数值逻辑守卫：① **道路衰减 UI 单位修复**：将路网悬停提示条中的自然衰减速率单位由 `/s`、`%/s` 修正为 `/h`、`%/h`；② **检视器与时基全景校准**：修正 Inspector 中市场 POI 产速（`+X.X/h`）、生态地标基准产速描述（`/h`）、休息回体速率（`+8.0%/h`）、淘金冷却（`45小时` / `180小时`）、房屋耐久与代谢进度条悬停提示（`每小时变化`）、孕期进度显示（`Xh / 200h`）、时光倒流回滚提示（`第 X.X 游戏小时`）以及大盘悬停节流（`60 ticks` = 1 游戏小时）；③ **内核事件消息时间单位修复**：将 `agent.rs` 中流产休养冷却与妊娠期播报文本中的“秒”修正为“小时”；④ **仿真数值逻辑全面审计确认**：系统级审计证明连续一阶欧拉数值积分（$dt=1/60$）、路网跨段拓路踩踏增量（按跨越车道触发而非按 tick）、离散交易结算步长、马斯洛错峰决策节拍（60 tick = 1 游戏小时）与长周期制度节拍在时基升级后物理时长与演化规律完全自洽稳定 | sim_core / frontend / docs |

| **v1.39.0** | 引擎时基深度修复、升级 60 Tick/s 与时间单位全面更名为“小时”（现实 1 秒 = 游戏 1 小时）：① **彻底修复 Worker 与 Rust 内核时基脱节 Bug**：修复 v1.38.0 引入 Web Worker 后心跳为 16ms（~60Hz）但传递给内核的物理步长硬编码为 `1/30` 导致 1x 倍速偷跑为实际 2 倍速的缺陷；② **物理精度升级为 60 Tick/s**：Rust 内核与前端配置同步调整 `simulationDt = 1.0 / 60.0`、`ticksPerSecond = 60`、`agentDecisionIntervalTicks = 60`，部落民错峰均摊在 60 相位上决策，物理步进与 A* 寻路更细腻平滑；③ **游戏内时间单位“秒”全面更名为“小时”**：在 1x 基础倍速下严格对齐 **现实 1 秒 = 游戏 1 小时（60 ticks）**；族人年龄、妊娠期、代谢率、POI 产速（单位/小时）等浮点数值在现实时间进程中保持完全不变；④ **Tick 周期常数按 ×2 比例放大**：宗族纳贡（3600 tick = 60h）、宗族互助冷却（1800 tick = 30h）、公仓税征收（4800 tick = 80h）、救济冷却（2400 tick = 40h）、国王内帑（6000 tick = 100h）、拍卖竞价冷却（180 tick = 3h）等基于 tick 计数的逻辑全部等比翻倍，确保游戏内物理时长绝对稳定；⑤ **前端 UI 与格式化工具全面适配**：重构 `formatDuration` / `fmtDur` 支持分/小时/天多阶分档；更新控制台标题为 `60 Tick/s (1秒=1小时)`；更新 POI 产速（`单位/小时`）、滑块文案（`/h`）、全局大盘（`小时` / `m/h`）、时光倒流模态框、族谱年龄显示（`h`）等全部关联文案；⑥ **测试门禁与文档全景更新**：`test-wasm.js`、`diagnose.js`、`config-check.js`、`frontend-check.js` 全绿，同步更新不变量清单与局部指南 | sim_core / sim_wasm / frontend / tools / docs |

| **v1.37.5** | 路网端点对静态 A* 路径缓存：① **静态拓扑权重 A* 路径规划**：A* 启发式寻路基于静态道路基础限速与坡度惩罚（`effective_speed = edge.speed_limit * road_level_factor_base`）计算最短路径，确保两点间路径为纯几何拓扑函数，杜绝微量动态 `wear` 浮动对路径规划的扰动，保证同种子长程演化与跨存档读档逐字节绝对确定性；② **端点对路径透明缓存**：`LaneGraph3D` 引入单线程内部可变缓存 `path_cache: RefCell<HashMap<(NodeId, NodeId, bool), Option<Vec<LaneId>>>>`，`find_path_3d_with_preference` 优先 O(1) 查表复用已知路径，未命中时搜索并回填，不可达点缓存 `None`，自环路径（起点即终点）O(0) 瞬时返回，A* 搜索开销下降 90%+；③ **安全失效与生命周期闭环**：新房屋立宅建路（`add_lane_with_options`）及动态配置变更（`apply_config`）时即时清空缓存，读档与重置时以空缓存干净初始化，零存档侵入性；④ **踏路成道物理层完全保留**：族人在道路上的实际行走速度依然由动态踩踏等级（`wear`）加成，道路阶数提升与视觉拓宽完全不受影响 | sim_core / graph / docs |

| **v1.37.4** | 后端算法效率与快照性能深度优化：① **静态地形网格按需快照与瘦身（减少 70%+ JSON 开销）**：`World3DEngine` 引入 `terrain_dirty: Cell<bool>` 标记，除开局、读档及显式请求（`world_require_terrain`）外，常规 tick 快照不再每帧重复打包 3600 个静态地形高度点（`terrain_cells` 瘦身至空数组 `[]`，单帧快照体积从 ~180KB 降至 ~45KB），彻底消除前端 `JSON.parse` 周期性微卡顿；② **王国地区居民排序脏标记缓存**：`tick_region` 中消除每 tick 对全体辖区居民的全量 `BTreeMap` 收集与排序（$O(R \times N \log N)$），引入 `regions_arrival_dirty` 脏标记，仅在始祖播撒、新生儿降生或国王更迭等地区居民集合变更时才触发重排；③ **房屋修缮扫描复杂度降阶**：`tick_house_repair` 彻底重构，消除对全量房屋和全量族人的 $O(H \times N)$ 笛卡尔积嵌套比对，直接通过 `owner_id` 与 `spouse_id` 定位户主及配偶状态，并将流水记录移出修缮判定主循环，单次修缮结算降至 $O(H)$；④ **POI 最近路网节点空间缓存**：`PrimitivePoi` 增加 `nearest_node_id: Option<NodeId>` 缓存，生态初始化播撒时直接绑定，彻底根除 `build_decision_context` 每 tick 对全图节点的 $O(P \times V)$ 暴力距离扫描；⑤ **消逝尸骸索引条件式重建**：`tick_poi_interactions` 中仅在有尸骸彻底消散（`agents.len()` 变更）时才执行全量 `rebuild_agent_index()`，避免每 tick 盲目重建；⑥ **快照枚举格式化零堆分配**：为 `Gender`、`PrimitiveActionState`、`PoiType`、`HouseTier`、`NodeType`、`RoadClass` 等核心枚举实现 `as_str(&self) -> &'static str`，淘汰快照导出中的 `format!("{:?}", ...)` 动态堆字符串分配；⑦ **移动系统拓路判定延迟寻边**：将 `tick_movement` 中拓路反向边 `find_edge` 查找延迟至族人抵达弯道终点（`distance_along_curve >= lane.curve.length`）分支内，避免每 tick 行走途中无谓查图 | sim_core / sim_wasm / frontend / docs |

| **v1.37.3** | 女性继承机制重构（女性即使丧父或丧夫也不能成立家户，遗产装入背包，超出背包容量入公仓）：① **严守男性立户铁律**：修复 `bookkeeping.rs::tick_inheritance` 在清算已故家户时未校验继承人性别即调用 `household_registry.create` 的缺陷，彻底杜绝女性遗孀（丧夫）或未婚女儿（丧父）自立家户成为户主；② **女性继承份额装袋与超额入公仓**：女性继承人分得的各品类遗产份额优先装入个人随身背包（`carried_water/food/wood/stone` 受 `carry_capacity_resource` 限制，`carried_gold` 无限装入），容量受限品类超出背包容量的部分自动全额转入公仓（`public_granary`）并记录双方继承流水；③ **家户解散与归属清理**：家户清算解散时，女性成员从原家户安全注销（`remove_member`），`family.rs::dissolve` 同步清理所属索引，保证 `household_of` 仅反映有效存续家户；④ **胎儿继承资产保全与死父不立户**：`birth.rs` 新生儿替换胎儿实体时转移全部五类随身资产（不仅限黄金），且仅当生父在世时才尝试为生父建户补录 | sim_core / ledger / bookkeeping / birth / docs |

| **v1.37.2** | 营地检视面板国王跳转修复与国库（地区公仓）展示：① **营地卡片国王跳转 Agent 卡片修复**：修复 `render_inspector.js` 中 `insp-camp-king` 每帧无条件更新 `innerHTML` 导致 DOM 节点被高频销毁、浏览器无法触发 click 事件的 Bug，改为差异比对更新并规范接入 `EntityLink.agent` 语义化按钮，同时在模态框与检视卡片两处建立多重跳转兜底，点击国王均能即时平移镜头并切换打开族人档案；② **营地卡片增加国库储备信息展示**：在右侧 Inspector 营地卡片中新增「💰 王国国库 (地区公仓)」模块，以 5 列网格实时呈现清水（💧）、粮食（🍒）、木料（🌲）、石料（🪨）、黄金（🪙）的当前账面余额与总存量，并支持直接点击跳转打开辖区详情与公仓流水模态框 | frontend / docs |

| **v1.37.1** | 版本变更自动废弃旧存档机制：① **内核应用版本强制门禁**：更新 `world_save.rs` 的 `SAVE_APP_VERSION` 至 `1.37.1`，并在 `deserialize_save` 中硬性校验 `save.app_version == SAVE_APP_VERSION`，反序列化时严格拒绝旧版本存档并返回明确错误文本；② **WASM 应用版本导出**：导出 `world_app_version_ptr` 与 `world_app_version_len`，前端通过 `RustWorld.getAppVersion()` 动态获取内核权威版本号，保持前后端单一同源；③ **启动门禁自动废弃引导**：`bootstrapStartupGate` 检测到已连接的默认槽位存在旧版本存档时，拦截自动续演并提示旧档已废弃，将连接按钮切换为「🆕 废弃旧档并新建世界」，点击后覆盖写入当前版本世界并开始模拟；④ **存档列表卡片废弃标识与读取禁用**：槽位卡片醒目展示 `⚠️ 已废弃 (v旧版本)` 徽章，并在说明中提示不兼容原因，禁用「📂 读取」按钮（保留「覆盖保存」与「断开」）；本地手动导入时亦同步拦截非当前版本文件；⑤ **回归测试守卫**：在 `tools/test-wasm.js` Test 4 中追加 `app_version` 篡改拦截测试，保证格式版本与应用版本不符时均能可靠拒绝且不破坏当前运行世界 | sim_core / world_save / sim_wasm / frontend / docs / tools |

| **v1.37.0** | 榷场互市 UI 现代化重构与经营数据统计：① **三品类行情卡片与价格全景展示**：彻底重构榷场在检视面板（Inspector）中的呈现形态，以紧凑规范的 3 列行情卡片独立直观展示清水（💧）、粮食（🍒）、木料（🌲）的实时动态牌价、库存余量进度条与产速倍率，解决此前多品类价格挤占标题徽章导致被省略号截断（`...`）的问题；② **增加累计出售总量与收款总额统计**：在 Rust 内核 `PrimitivePoi` 与 `PoiSnapshot` 中新增按品类细分的历史累计出售量（`cumulative_sold_water` / `food` / `wood`）及累计回收黄金总额（`cumulative_revenue`）并随档持久化，前端以「互市经营总览」双胶囊卡片醒目呈现累计出售总量（带品类细分）与收款总额；③ **优化标题栏与明暗双主题适配**：榷场标题状态精简为「🏪 边境榷市」，并为新增的经营卡片与行情牌价网格完备适配亮色主题（`body.theme-light`） | sim_core / poi / snapshot / frontend / docs |

| **v1.36.2** | 榷场交易结算步长调整为 5 单位：将 `market_settlement_step`（Rust）与 `marketSettlementStep`（JS）默认值从 2.0 提升至 5.0 单位，现场濒危自救（自饮/自食）与多品类装袋购入（水/粮/木）均以 5.0 单位进行离散结算，提升商贸物资单趟采买效率与吞吐能力，降低高频多次离散微量结算的流水开销 | sim_core / ecology / config / frontend / docs |

| **v1.36.1** | 修复前端点击拾取与 Inspector 面板失效 Bug 并确立前端静态自动化门禁：① **语法错误修复**：修复 `render_inspector.js` 中因多余大括号导致的 `SyntaxError: Unexpected token 'else'`，恢复脚本完整加载与 Canvas 点击事件监听器注册，使 POI/房屋/族人重新可正常被点击选中与检视；② **修复拍卖大盘画布双击**：`auction-ui.js` 中修正旧 canvas ID 引用（`world-canvas` → `sim-canvas`）；③ **建立前端自动化门禁制度**：新增零依赖门禁工具 `tools/frontend-check.js`，实现全部 23 个前端 JS 脚本语法严格校验（`node --check`）与 `document.getElementById` DOM 引用完整性比对，并纳入 `AGENTS.md` 核心测试步骤与 `19-commit-checklist.md`，防止类似前端静默崩溃再次发生 | frontend / tools / docs |

| **v1.36.0** | 榷场互市增加木料物资供应与马斯洛引擎断流买木头：① **榷场木料第三库存与动态幂律定价**：POI 实体扩充 `tertiary_stock`、`tertiary_max_stock` (400.0)、`tertiary_regen_rate` (2.0)，引入 `market_price_base_wood` (0.15) 满额基准定价与 `market_unit_price_with_base` 动态定价，支持自然再生与提取结算；② **家户需求采购守卫与木料装袋入包**：榷场交易结算增加木料买入装袋与流水留痕（`MarketTradeRecord { resource: "Wood" }`，前端展示 🌲），引入家户真实需求守卫（仅在对应资源活跃需求或断供时采购），防止买木材时误买多余水粮导致背包塞满返航；③ **马斯洛引擎伐木全链路断流直达榷场**：在 B15 需求评估、伐木途中（`decide_seeking_material`）与现场采收断流（`decide_harvest`）三处全面支持全图林木 POI 枯竭断流时，具备家财与体力的户主平滑原地掉头直达榷场采购木料；④ **快照三处同步与前端可视化升级**：`PoiSnapshot` 同步木料储量、上限、产速与实时木价；Canvas 视口绘制水（蓝）/粮（红）/木（棕）同心三指示环；Inspector 侧边栏展示水/粮/木三单价、木料库存条与产速倍率 | sim_core / decisions / ecology / poi / snapshot / frontend / config / docs |

| **v1.35.2** | 完善宗族绝嗣财产平分制度与调试模式国王内帑总额展示：① **宗族绝嗣财产平分制度**：重构宗族绝嗣清算机制，严格以「未标记绝嗣且当前拥有在世男性成员」判定存在的存续宗族，杜绝将同批灭绝/无存活成员的宗族误判为受赠方导致财产沉睡；五类资源（水/粮/木/石/金）全额平分并留存双向 `Legacy` 流水与承继大事记，无存续宗族时全额并入公仓；前端宗族大盘流水与抽屉支持并高亮展示绝嗣承继记录；② **国王收到的内帑总额制度统计与调试展示**：内核在 Agent（一生累计）、Region（王国累计）与 World（全局累计）三层建立内帑拨付的确定性持久化统计（`cumulative_royal_privy` / `total_royal_privy`），通过快照同步至前端；在开启「🐞 调试模式」时，左下角调试监视器浮窗（#debug-hud）、小人 Inspector 面板与营地 Inspector 均展示国王收到的内帑总额 | sim_core / ledger / snapshot / frontend / docs |

| **v1.35.1** | 榷场交易流水 UI 格式精简：检视面板（Inspector）中榷场交易流水各记录项资源品种由「🍒粮食 / 💧清水」精简为仅保留对应 Emoji（🍒 / 💧），省略冗余的文字描述，压缩单行宽度并提升信息密度 | frontend / docs |

| **v1.35.0** | 野外常规采收单趟多品类采集优化：① **马斯洛分支行囊余量自包含自检**：在备水/备粮/备木/备石/备金分支（`b5/b6/b7/b9/b10/b13`）中注入行囊余量（`carried < capacity`）自检，行囊装满时分支自然返回 None，杜绝背包已满重复派发，使马斯洛评估自适应向后穿透；② **现场采收多资源连环调度**：新增 `try_continue_harvesting` 调度机制，在资源点采收完成（行囊装满、家宅该品类已补足或该源断流）后，若族人拥有私宅且体力充沛（≥ 50%），按当前玩家编排的决策优先级自动检索家宅短缺的其他品类并平滑派发前往，直到所有短缺补齐或体力不足才满载返家；③ **统一濒死自救互链**：将原饮水/觅食现场硬编码的濒危饥渴自救全面纳入连环调度状态机，实现野外采收与生理自救的高效自洽闭环 | decisions / ecology / docs |

| **v1.34.1** | Agent 详细档案与族谱弹窗 UI 全面现代化重构：① **标题栏去冗余与防断字**：消除标题文本中代数与性别的嵌套冗余（`${clanPrefix}部落民 #${id} 详细档案与族谱`），解决宽度狭窄导致的单字断行掉字；② **核心 Hero 卡片重构与信息解耦**：彻底剥离小人姓名后硬编码拼接的代数与性别括号字符，将姓名、性别微徽章（蓝/粉）、世代金徽章分离，杜绝换行断截与悬浮错位；③ **结构化生命体征仪表盘**：将单行干瘪的年龄/健康/饱食/体力灰字纯文本升级为 4 格规整的等宽高亮数据小胶囊（带低健康/低饱食/低体力自适应警戒色）；④ **独立当前决策意图卡片**：将右侧悬浮孤立的马斯洛需求 Badge 收纳至带标题与背光的行动意图模块；⑤ **弹窗尺寸与呼吸感提升**：弹窗宽度由 480px 扩展至 620px（自适应 94vw / 88vh），六大先天禀赋卡片增加微发光边框与动态条形槽，关系网网格强化层次质感，并完善浅色主题适配 | frontend / docs |

| **v1.34.0** | 落地 TODO.md 六大核心愿景：① **家户账本面板展开自动全量刷新**：修复账本面板（#ledger-panel）从折叠展开或初次开启时因 hover 冻结逻辑导致界面空白需手动切标签的 Bug，改为展开即强制刷新并对悬浮刷新节流；② **7 年厄尔尼诺气候震荡**：在 1 年周期四季气温正弦波上叠加 7 年周期 ±3℃ 厄尔尼诺/拉尼娜正弦震荡（带确定性伪随机初始相位），丰富长程气候演变；③ **房屋供暖与气温完全挂钩**：冬季烧柴消耗条件解耦季节名，统一改为气温 < 8℃（`house_winter_cold_temp: 8.0`），非冬季寒流亦自动触发烧柴供暖；④ **清理废弃图例代码**：彻底移除已废弃的 `#ecology-legend` 关联 DOM、CSS 与 JS 控制逻辑；⑤ **精简榷场（Market）检视文案**：清理水粮储备栏及描述中重复冗余的「上限」展示文本；⑥ **行情中心保留流拍历程**：在世界层引入容量为 256 的拍卖历史环形缓冲（`auction_history`），在风化坍塌流拍处沉淀流拍记录并在前端行情中心以醒目深色卡片区分呈现 | sim_core / housing_system / ecology / frontend / config / docs |

| **v1.33.1** | 修复配置热更新下 POI 储量上限失效 Bug：① **内核热更新同步刷新储量上限**：`World3DEngine::apply_config` 补充各类 POI 的 `max_stock`（水/浆果/林木/石矿/金矿）以及榷场的 `secondary_max_stock` 与 `secondary_regen_rate` 动态同步，并对超额储量自动钳制，使前端 `SIM_CONFIG`（如 `stockMaxWater`）热注入与重开生态均能即时生效；② **基准配置同步**：`config.rs` 中 `STOCK_MAX_WATER` 与 `STOCK_MAX_BERRY` 默认值同步对齐为 `400.0`，全量门禁检查全绿 | sim_core / world_config / config / docs |

| **v1.33.0** | 落地 TODO.md 四大核心需求：① **时光倒流控制器**：强确定性回滚 Tick（Checkpoint + Replay），支持输入任意指定目标 Tick 毫秒级回溯历史世界，配滑块与快捷选项卡并自动暂停；② **榷场固定以 2 个单位作为结算步长**：引入 `market_settlement_step: 2.0` 配置，弃用原本每 tick 微量浮点扣除（`rate_res * dt`），自救自饮/自食与装袋购水/购粮均以 2.0 离散步长结算，单笔流水额度整洁统一；③ **开新档自动更新存档 & 30秒自动保存**：自动保存周期由 60 秒调整为 30 秒，重演生态开启新世界时立即触发槽位 1 自动写盘；④ **UI 增加明亮主题**：增加高对比度、柔和通透的浅色主题（`body.theme-light`），顶栏提供一键切换并本地持久化偏好 | sim_core / ecology / config / frontend / docs |

| **v1.32.0** | 修复「孤儿营地」永无国王缺陷：夺位远征判定 `eligible_leaderless_camp` 由遍历已存在的 Region 实体改为遍历完整营地 POI 列表，无 Region 实体（有房无王）的营地一并视为空缺王位；`decide_seeking_throne` 途中校验与 `execute_pending_coronations` 登基校验同步将「无 region」从「非空缺」修正为「空缺」（`unwrap_or(false)` → `unwrap_or(true)`），使房屋辖区（House.camp_id）与地区成员登记簿（RegionRegistry）脱节产生的孤儿营地能被 B14SeekThrone 识别并自然产生国王（种子 1788611184736 扶风营地无王问题） | sim_core / decisions / docs |

| **v1.31.0** | 竞拍出价从「选一套最优在售房」改为「对所有更高等级在售房一次性倾囊出价」：无房者（视为 0 级）对全部在售空置房（含 0 级仓库）出价、有房者对全部 `tier > 自宅` 在售房出价；agent 决心字段 `pending_bid_house_id` 单目标改为 `pending_bid_house_ids` 升序集合，删除按升级资源差折算的 `pending_bid_price`/`house_upgrade_cost_price`，出价金额统一倾囊（家户全部黄金）；执行器按 agent id / 房屋 id 双升序逐个落地、首套成交即停（一人一房铁律），该 agent 同 tick 其余房源出价作废 | sim_core / decisions / housing_system / docs |

| **v1.30.1** | 拍卖面板 UI 优化：① 意向买家池准入过滤——剔除家户黄金为 0（无出价能力）与自有房屋等级 ≥ 选中在售房屋等级（无换房动机）的 agent，比较基准由「全图在售房最高等级」改为「当前选中房屋等级」，两处调用方（买家池列表与 hero 卡统计）口径统一，顺带消除 per-agent 循环内重复计算全图在售房最高等级的 O(A×H) 热路径浪费；② 拍卖模态宽度 980px → 1240px，下方「意向买家池/连续报价」双列改为等宽 | frontend |

| **v1.30.0** | 拍卖市场双解锁死修复（种子 1788606954658 / tick 363704 诊断沉淀）：① `best_bid_candidate` 能力匹配——买家优先竞拍「家户黄金 ≥ 折算价」的买得起的最高等级房（等级降序、ID 升序不变），全部买不起才退回尽力报价，消除高等级挂牌房对全体买家的单点虹吸（此前 4 级庄园挂牌后 3 级庄舍连续 350+ 秒零报价）；② 麦穗决策期标杆衰减——新增超参 `houseAuctionBenchmarkDecayRate`(0.02 金/模拟秒)，决策期无人击穿标杆时标杆线性下调至出价底价（观察期不衰减、出清期本就即报价即成交），解决「观察期高标杆 + 决策期全民钱袋空」双锁死必然流拍。回归：流拍率 52%(16/31) → 10%(3/29) | sim_core / decisions / housing_system / config / frontend / docs |

| **v1.29.1** | 修复立宅（FoundHome）建设用地分配：候选宅址落地位置由「离候选点最近的路网节点」改为候选点本身，避免 agent 被派发到别人家门节点后实体化 `is_house_site_valid` 校验失败、房子盖不起来；实体化到达判定改为「走完派发路线即抵达」，去掉与候选点范围不匹配的距离阈值；B12FoundHome 增加「已选定宅址则不重掷」守卫，防止途中目标漂移 | sim_core / decisions / housing |

| **v1.29.0** | 新增「⓪ 瞬间行为」马斯洛层级（优先级高于生理需求）：条件满足即刻执行（只写决心、不移动、不消耗资源）并在同一 tick 内继续遍历后续分支。b17 竞拍购房整体归入瞬间层并放宽进入条件（无房或存在更高等级在售房均可参与），b16 求偶近距 / b18 育儿在宅拆分瞬发变体。层级覆盖编码迁移：0=瞬间行为，1-5 不变，6=原「保留代码动态默认」；决策引擎 UI 扩为 6 分区、localStorage 配置自动 v1→v2 迁移 | sim_core / decisions / frontend / tools |

| **v1.28.11** | 修复房屋生成到营地中心的问题：候选与实体化阶段均避让营地占用半径，同时保留营地周边建房能力 | sim_core / decisions / housing |

| **v1.28.10** | 修复临界口渴/饥饿状态被普通疲劳熔断强制送回家的问题；明确马斯洛引擎为唯一任务分派入口，系统仅结算 Agent 已提交的物理意图 | sim_core / decisions |

| **v1.28.9** | 统一房屋选址校验：候选阶段与实体化阶段均避让非营地 POI 的交互范围，修复房屋生成到资源点/榷场上的问题 | sim_core / decisions / housing |

| **v1.28.8** | 未婚无房女性在无其他需求时自动沿路网返回所属营地休息，避免停留在道路节点 | sim_core / decisions |

| **v1.28.7** | 完成 TODO：无实体住宅的 Agent 不得将随身物资卸入家户；立宅仅在沿路网抵达系统分配的最近节点后实体化，避免建房瞬移或隔空入账 | sim_core / frontend |

| **v1.28.6** | 修复送货回家时决策节拍提前重新派出的问题：新增统一卸货完成判定，行囊（含黄金）清空前保持卸货状态，避免半卸货再次出门 | sim_core / decisions |

| **v1.28.5** | 立宅/升级/生育均须先抵达目标位置或户主住宅；始祖饱食与水分基线提升至45并携带满额水粮；非黄金行囊单类容量提升至100，前端改为分项数值展示 | sim_core / frontend |

| 版本 | 核心变更 | 影响模块 |
| :--- | :--- | :--- |
| **v1.28.4** | 修复营地数量 `countCamps` 不生效：`world_create` 新增 `camp_count` 参数在播种生态前注入（原 `apply_config` 仅更新 config 与 POI 产速、不重建 POI，导致营地恒为 Rust 默认 5 个）；营地数量默认值 5 → 4，POI 总数 24 → 23，同步三处文档与 ID 段位描述 | sim_wasm / sim_core / frontend / tools / docs |
| **v1.28.3** | 统一 Agent/房屋实体跳转组件；修复营地国王与拍卖买家定位；买家池展示当前房屋等级并精简文案；账本概览移除最富家户（全局族人均值大盘保留）；求偶增加家户金币严格大于 5 门槛 | frontend / sim_core |
| **v1.28.2** | 马斯洛决策引擎 UI 精简与术语统一：决策行动统一命名「Branch 分支」，分支卡展示 ID + 中文名（如 `b1·解渴`）；删除「评估入口」「状态机」固定锚点卡片与「层级图例」「数据来源」左栏面板及层级过滤交互（分界线卡片与层级着色保留） | frontend / docs |
| **v1.28.0** | ① 养育后代重新挂钩住宅等级：`B18RaiseChild` 分支内新增「男方（户主）名下须有 ≥1 级私宅」守卫（0 级仓库/无房不生育），同步决策卡片与房屋 Inspector 文案；② 榷场交易流水修复：`PrimitivePoi` 新增交易流水环形缓冲（容量复用 `ledgerJournalCapacity=64`），在自救与装袋四笔成交处逐笔留痕（时间/采购人/家户/品类/数量/单价/黄金支出），随存档持久化，快照三处同步并修复前端面板「过滤 `MarketTrade` 而内核序列化为 `Market`」导致恒为空的问题 | decisions / poi / ecology / snapshot / frontend / docs |
| **v1.28.1** | 启动自动读档权限加固：句柄经 IndexedDB 恢复后若浏览器未持久化文件权限，不再自动断开/删除记录（此前会自毁记录，导致刷新后永远回到连接页）；启动先静默重授、失败提供「授权并读取上次存档」按钮（用户手势内 requestPermission），保存/读取遇 NotAllowedError 亦就地重授重试，仅显式断开才删记录 | frontend / docs |
| **v1.28.0** | 启动自动读档：打开游戏时若已连接默认存档文件（自动槽 1 = 默认目录 + 默认文件名 `flowaccord-save1.json`，句柄经 IndexedDB 恢复）直接读取其内容续演，不再开新世界等自动保存覆盖旧档；读取失败（权限失效/损坏/版本不兼容）保持阻断并回退手动连接 | frontend / docs |
| **v1.27.0** | 浏览器端决策顺序持久化、启动存档文件门禁、拍卖流拍统计与高倍速房源切换稳定性、采集断流直达榷场、最富家户定位、国王每100秒内帑划转 | frontend / sim-core / wasm / ledger / docs |
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
| **v0.9.54** | 01-current.md 按功能模块拆分：根索引 + `docs/current/` 分模块文档两级结构（纯文档） | docs |
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
| **v0.9.38** | 文档偏差修复：修正 AGENTS.md / 01-current.md / 02-build-guide.md 等与现状不符的描述（纯文档） | docs |
| **v0.9.37** | 婚姻系统与建房事件解耦：移除升级竣工即时迎娶钩子，成婚统一由 `marriage.rs` 扫描匹配 | housing / marriage |
| **v0.9.35** | 简化四季参数模型：废除 `season_quarter_length`，单季长度由 `year_length × 0.25` 派生 | config / world |
| **v0.9.34** | 房屋系统与世界环境模块化解耦：`housing_system` 拆为 5 个单一职责子模块，四季回归 `world.rs` | housing / world |
| **v0.9.24** | 随身金币遗产继承：族人故去后 `carried_gold` 平分给在世子一代子女，无子女则清零 | agent / ecology |
| **v1.26.6** | 改善型换房竞买：有房户主可按等级差竞买更高等级房屋，资源差×市场价成本报价，麦穗决策期 `≥` 标杆成交，成交后旧房自动挂牌 | decisions / housing / ledger / wasm / docs |
| **v1.26.7** | 重规划拍卖与统计界面：历史页隐藏在售房源、买家池补充低等级家户核对、移除冗余图例/随身均值/贫富倍差、家户页增加资源均值、榷场展示交易流水、决策分界线支持动态末端位置 | frontend |
