# 人际好感度：技术实现方案与任务序列

> 状态：实施规划，未实施、未排期。2026-09-15 对照 INTERNAL_MARKET 新版复核并调整。
> 产品规则唯一入口：[05 人际好感度](docs/plan/design/05-affinity-system.md)。本文按用户要求导出到仓库根目录，是本专项技术方案与任务顺序的权威入口；不另建一份重复技术稿。
> 范围：本次只修订文档；下文代码、参数、接口均为待实施建议。任务顺序不是交付日期。

## 1. 审查结论与修复记录

| 原稿问题 | 产品影响 | 已修订决定 |
|---|---|---|
| -7～+7 写成 16 档 | 编码、文案和验收数量不一致 | 15 档，0 为中性，不声称「没见过」 |
| 每次成交 +1，无明确频控 | 拆单与高频交易很快刷到生死之交 | 普通往来共享 24 游戏小时冷却，最多提升至 +3 |
| 初次建条目叠加血亲／配偶高分 | 遗忘重建可洗掉负面态度，亲属预占容量 | 首期取消结构偏置；成婚事实仅双方 +2 |
| 同 POI 就增益，落拍／拒助就减分 | 把空间共存当合作，把正常竞争当伤害 | 未证明贡献／责任的来源默认禁用 |
| -4 拒绝所有协作，+6 才能救助 | 放大贫困、封闭关系圈，可能阻断救命 | 保留生存时效、权限、家庭保护优先；无通用敌意拒单 |
| 溢出写前驱逐与新对象参与比较表述矛盾 | 不同实现会得到不同关系表 | 临时加入候选后按唯一元组驱逐，原子提交 |
| last_changed 表示「多久没来往」 | 饱和或未计分互动被误解为长期失联 | 仅显示最近分数实际变化 |
| 亡者冻结占位、-7 只能赎罪回转 | 代际运行容量僵死，特例难闭合 | 活跃表清亡者，历史另属族谱；所有分数可被后续事件修复 |
| P0 接未实现市场与行窃，依赖激素 | 数据层被无关大系统阻塞 | P0 用现有成婚事实，P1 用现有求偶破平 |
| 行为关闭要求新旧快照逐字节相同 | 新字段使验收无法成立 | 同版本完整确定性；跨版本比较旧行为投影 |
| 市场按 ID 后再信任、挂单预存信任布尔 | 唯一 ID 后偏好永远不生效，未知对手无法判双方信任 | 匹配时读取双方关系，价格→时间→关系→订单 ID |
| const 默认值、快照赋值位置过时 | 与现有配置和四处同步约定冲突 | 前端默认值唯一源，赋值位于 world_snapshot.rs |

本轮保留了原稿的有向标量、有限容量、无衰减和事件驱动。平衡数值尚无运行实验背书；未实现事件均明确后置，不把未来机制写入现状文档。

## 2. 当前代码基线与实现边界

| 已核验位置 | 当前事实 | 拟接入方式 |
|---|---|---|
| [agent.rs](crates/sim_core/src/spatial/agent.rs) | `Agent3D` 直接派生 Serialize/Deserialize | 新增私有态度组件，构造为空 |
| [scheduler.rs](crates/sim_core/src/spatial/decisions/scheduler.rs) | `execute_pending_courtships` 成功登记后转籍并更新配偶信息 | 全部成功后生成一次双向 MarriageRegistered 影响，利用登记返回的婚姻 ID |
| [evaluate.rs](crates/sim_core/src/spatial/decisions/evaluate.rs) | `best_courtship_target` 被分支、派发与途中重选共用 | P1 只改公共候选比较器，保持现有资格过滤 |
| [world_tick.rs](crates/sim_core/src/spatial/world_tick.rs) | 9 个 phase，决策早于账本和 cleanup；普通 tick 与 tick_subphase 共用 phase 方法 | 在 cleanup 内新增关系提交与死亡清理，不改变旧阶段顺序 |
| [world_save.rs](crates/sim_core/src/spatial/world_save.rs) | `WorldSave.agents` 存整个 Agent3D，并另存世界字段 | Agent 成员自动随档，新增世界暂存字段需明确不落盘条件 |
| [layout.rs](crates/sim_core/src/spatial/snapshot_bin/layout.rs) | FABS 为带目录的顺序流；结构变化须升级 FORMAT_VERSION | 追加独立关系 section，按非空条目编码 |
| [内部市场规划](docs/plan/tech/03-internal-market.md) | 真人撮合、订单簿仍是规划 | 不把现有外部榷场当作真人交易对象 |

实施前按变更目录再读根与局部 AGENTS.md，尤其 sim_core、spatial、decisions、sim_wasm、frontend。新模块单文件不超过 800 行。

## 3. 数据模型、接口与配置

### 3.1 单一真相源

建议新增 `spatial/affinity.rs`，初期不拆复杂目录。在 `Agent3D` 挂一个 `AffinityState`，不再建世界级持久态度副本。

```rust
// 规划类型；沿用现有 AgentId、serde 和 tick 类型。
pub struct AffinityState {
    links: Vec<AffinityLink>,          // peer_id 升序，至多有效容量
    routine_cooldowns: Vec<Cooldown>, // peer_id 升序，至多 36
}
pub struct AffinityLink {
    peer_id: AgentId,
    value: i8,                       // 非零，-7..=7
    last_changed_tick: u64,
}
pub struct Cooldown {
    peer_id: AgentId,
    eligible_tick: u64,              // 到此 tick 才可再次获得普通往来分
}
```

冷却与 links 分开：关系归零／驱逐不解除冷却。P0 尚无普通往来来源，冷却表保持空；P2 接入真实消费者时才添加冷却配置及实现，避免空转参数。可以在 P2 才增加该字段并随相应格式变更交付。

建议接口：`value_for(peer)`（二分只读）；`apply(event, config, tick)`（唯一修改入口）；`remove_dead(live_ids)`；`validate_for_load(...)`。禁止外部直接改 value。用 i16 中间量计算加法和绝对值，最终钳位为 i8；不先在 i8 上累加造成溢出。无 HashMap 遍历语义、无 RNG、无浮点评分。

### 3.2 配置接入

| 阶段 | Rust / 前端建议字段 | 默认／有效范围 | 消费位置 |
|---|---|---|---|
| P0 | `affinity_capacity` / `affinityCapacity` | 36；整数 1～36 | 更新、驱逐、配置缩容 |
| P0 | `affinity_marriage_delta` / `affinityMarriageDelta` | 2；整数 1～3 | 成婚事件适配器 |
| P1 | `affinity_behavior_enabled` / `affinityBehaviorEnabled` | false | 求偶比较器及后续市场消费者 |
| P2 | `affinity_routine_interval_hours` / `affinityRoutineIntervalHours` | 24；正数 | 冷却转 tick，`ceil(hours / simulationDt)` |
| P2 | `affinity_routine_positive_ceiling` / `affinityRoutinePositiveCeiling` | 3；整数 1～3 | 普通往来增量上限 |

±7 和 36 的硬上界属于数据契约；可调超参只经 SimConfig 读取。每个新配置必须同步 `config.rs` 字段及注释、`frontend/js/config.js` 默认值、`examples/config.json`、`tools/config-check.js` 影响映射和真实消费点。Rust 保持 derive(Default)，不增加 const 默认配置。新增其他事件时，其增量与贡献阈值也同样配置化；不要提前加入未使用参数。

非法容量、非整数或非有限冷却时间、溢出的 tick 换算必须拒绝注入并报告原因，不接受零值关闭半个系统。冷却的截止 tick 以事件发生时的配置计算并保存；之后调参只影响新的计分，避免热更新重置既有冷却。不修改 simulationDt。有效容量缩小时立即按同一驱逐规则裁剪；增大不恢复被忘关系。存档装载与配置热注入顺序需覆盖此规则。

## 4. 事件时序与更新算法

### 4.1 唯一结算与 tick 可见性

建议在 World3DEngine 新增**仅 tick 内** `pending_affinity_events`。每个结算器按既有稳定顺序追加，不更动 agents 遍历或旧 RNG 消费。事件含 `phase_order, source_kind, fact_id, receiver, peer, delta, routine`；阶段内另给稳定递增的本地顺序号。事实 ID 使用领域已有 ID，组合 source_kind 避免婚姻、成交等 ID 撞号。

cleanup 中先按 `(phase_order, local_sequence, receiver, peer, source_kind)` 提交；同一 `(source_kind, fact_id, receiver, peer)` 重复只消费一次。之后按本拍存活集合移除死亡引用并清空亡者表，最后走原 cleanup。已死亡／胎儿／自指对象不产生新态度。所有决策读到本 tick 开始时的态度；本 tick 事件对**下一 tick 起的决策**生效，不改变错峰决策节拍。新批次仍要逐 tick 提交，不能把 `world_tick_steps(N)` 的事件合并到最后一次。

一次结算同时生成两个方向时，按 receiver ID 排序提交；单向更新不隐式写另一张表。暂存队列必须在 `tick_phase_cleanup` 内排空，确保普通 tick 与 `tick_subphase` 路径一致。

去重有两层：本 tick 队列防重复适配；跨 tick 由领域事务完成标记保证。成婚仅在 `register` 返回成功 ID 且转籍与配偶更新完成后发事件，不能扫描历史婚姻反复发。P2 每笔订单／求助 episode 要有持久化的「已发完成事实」标记或等价终态；重复投递不应靠一个无限增长的全局 seen 集合解决。

暂存队列不作为长期历史。对外存档只能在完整 tick 边界执行；若现有诊断接口允许停在子阶段并请求保存，应拒绝非边界保存并明确错误，不能漏队列保存。若将来必须支持半 tick 存档，则需同时持久化 phase、队列、顺序号和消费位置后另行设计，不能只 serde(skip) 后默认安全。

### 4.2 apply 顺序

1. 验证事实和对象。读取旧值（缺省 0），绝不在查询时初始化亲属偏置。
2. 普通往来先移除已到期冷却；未到期则不计分。冷却表满且没有当前对象位置时拒绝计分，保留真实交易结果。
3. 普通事件增量为 `min(1, max(0, routine_ceiling - old))`；重大事件取领域配置增量；用较宽整数相加后钳位。
4. 通过普通计分资格的事实写截止时间，即使当时分值已到普通上限或新关系将被驱逐，也消耗该次窗口；防止饱和后发生伤害再立即重用交易补分。
5. 新旧值相同则不改最近变化时间。结果为 0 删 link；否则 upsert 并更新时间。
6. 将新对象与旧表一起按产品驱逐键比较，超限删一个，再按 peer_id 恢复存储顺序。冷却不随之删除。
7. 仅对真实保留的分值变化返回观察结果；新对象立即被驱逐不播报「建立好友」。被动驱逐／死亡移除不伪装成负面人际事件。

普通事件共享每方向每对象的窗口，不按资源、中介或订单拆开。冷却复杂度 O(36)，链接更新 O(36)。提交 E 条事件为 O(E log E + E×36)，状态 O(N×36)；仅存在死亡集合时扫描关系 O(N×36)，不引入全人口两两关系扫描。

## 5. 存档、FABS 与 UI

### 5.1 存档

新增 Agent 字段随 `WorldSave.agents` 序列化，构造／出生／胎儿转出生／world_create 路径必须都初始化正确。P0 空冷却不回填旧婚姻；不从 genealogy 重建关系。世界暂存字段需同步引擎构造和 load 初始化。

此方案选择发布时拒绝缺少必要状态的旧结构档，不做自动回填迁移：在实施提交中将当时 `SAVE_FORMAT_VERSION` 加一并同步 save-ui.js；应用版本走 bump-version 工具。P2 若再新增冷却字段，同样按实际不兼容变更处理，不在本文预占版本号。

装载必须验证：peer 唯一、按序、非自身、分数非零且合法、条数合法、last_changed 不在未来、冷却时间合法且换算无溢出。禁止亡者／胎儿或不存在对象引用；非法档明确失败，不靠静默裁剪掩盖损坏。有效但过期的冷却可留到下一次事件清理，避免单纯读档改变快照；与热注入缩容区分处理。读档、重置与跨世界创建均不重播事件。

### 5.2 FABS

建议新增 `Affinity` section，取实施时未占用的 SectionKind，勿提前硬编码编号。每帧完整发送活跃非空态度表：

```text
section.count = 有非空表的受体数
每受体：receiver_id:u32, link_count:u8,
        link_count × (peer_id:u32, value:i8, last_changed_tick:u64)
小端顺序流，不加隐式结构体 padding。
```

一个满表约 5 + 36×13 = 473 字节，1000 个满表族人约 473 KB/帧（不含目录及其他快照）；10 FPS 时仅这一项约 4.73 MB/s，实施须测 Worker 复制、解码与主线程分配。首期采用易验证的全量协议，不提前加入增量缓存；若超过预算再独立设计按需详情接口并补齐 WASM 调用链。

四处同步外还要改 layout.rs 的 section 与格式版本，JS 格式版本一致，核对 `tools/snapshot-reader.js` 是否复用前端解码器及其实际映射。section 为空是明确清空；新格式下 section 缺失属于协议错误，不能沿用旧世界的表。条目按 receiver、peer ID 稳定编码；解码严格核对长度、计数和范围，防错位／越界。冷却只供内核，不发给 UI；当前规则可由配置说明展示。

等级名由数值在前端查表，不另传冗余枚举；如实现改为 Rust 字典供名，则同步 dict.rs 的 code/table。u64 tick 沿用现有解码精度契约，不把显示舍入的数字回写内核。STR_TAB 仍按 start_index==0 失效，不改 epoch 策略；新关系 section 不使用驻留名称，显示时从当前世界人物表取名字。

### 5.3 Inspector

复用人物面板新建「人际」分组，先按分值降序、peer ID 升序渲染；A→B 与反向分数分别标注，空表和对方已移除有明确文案。显示分数、标签、最近实际变化 tick 换算时间。关系归零后没有 link，但结构亲属标签仍可显示。

高频容器必须比较内容快照后再改 innerHTML。连续模拟时验证 chip 点击、死亡后的失效链接、关闭 Inspector 同步关闭跟随、跨世界重置不残留。初期不改族谱数据模型，不增加无限变化日志。

## 6. 行为消费者

### 6.1 P1 求偶

改 `best_courtship_target` 公共比较器：原资格过滤 → 魅力降序 → 开关开启时发起者对候选的好感降序 → 原距离升序 → ID 升序。确认现有浮点比较与无效距离处理保留，所有调用点共用此比较器。效果关闭时不额外读写态度，并严格走旧比较路径。

当前事件只有成婚，通常不会马上创造多个有差异的单身候选；因此 P1 的自然表现可能较少。用临时构造的合法关系状态验证比较器，不能为了制造演示而增加免费好感或取消资格。更丰富的自然关系差异依赖 P2/P3，不宣称 P1 已形成完整社交模拟。

### 6.2 P2 市场

先等内部市场规范的订单簿、委托人身份、真实履约与最小成交单位落地。**关键设计约束**：订单保留具体 principal AgentId，委托人死亡/分家等失效按市场事务处理，不把家户 ID 当人。

以买单依价格→时间→ID 的确定序扫描；对每一买单，在所有可交叉的卖单中按卖价升序、创建时间升序、min(A→B, B→A) 降序、卖单 ID 升序选取。无合格对手继续下一买单。

在真实履约后，对买卖委托人生成两个方向的普通往来事实；同一订单部分成交只在其首次合格真实履约产生一次关系事实，持久化发出标记；后续不同订单仍受共享冷却。不给匿名外部榷场、售货员、家户全员同时记分。不做价格折扣或敌意拒单。

### 6.3 P3 领域扩展准入

每个新事件先给出：参与人、责任证据、成功结算点、唯一事实 ID、贡献阈值、普通／重大分类、失败与取消语义、跨读档去重状态。没有这些条件就保持禁用。激素接入须采用确定整数舍入，调制后仍经过事件上限和统一钳位；世仇和暴力另审，不从本模块扫描派任务。

## 7. 实施任务序列

所有任务当前均为 **待实施**。规模为相对复杂度，不是工时承诺。任务必须在前置验收通过后开始；后置领域未完成时不以空实现代替完成。

| ID | 阶段／规模 | 前置 | 具体交付与影响文件 | 完成标准 |
|---|---|---|---|---|
| AF-01 | P0／小 | 无 | 阅读对应局部指南；记录 git 基线、成婚唯一结算路径、save 边界和 tick_subphase 行为；保存同种子旧行为投影用于临时对照 | 确认所有写入／快照／构造入口与可运行工具链，基线问题单列 |
| AF-02 | P0／中 | AF-01 | 新 affinity.rs；Agent 私有表、构造初始化；capacity 和 marriage delta 配置四处同步 | 空表、方向、钳位、零删除、候选自驱逐、同 tick ID 破平与缩容临时验证通过 |
| AF-03 | P0／中 | AF-02 | world 暂存事件；scheduler 成婚成功挂点；world_tick cleanup 提交／清亡者；复用普通及 subphase 路径 | 成功一次 +2/+2，失败零次；同 tick 事件次序固定；死亡无悬挂，无新增 RNG 消耗 |
| AF-04 | P0／中 | AF-03 | WorldSave 往返、load 验证、暂存边界检查；save-ui 格式门禁 | 存读档续跑一致；不重放婚姻；非法记录报错；半 tick 存档不漏事件 |
| AF-05 | P0／中 | AF-04 | snapshot.rs、world_snapshot.rs、encode.rs、layout.rs、snapshot-bin.js、rustworld.js、工具 reader | 空／满表、正负 i8、清空／跨世界、损坏长度临时验证；格式门禁与四处同步通过 |
| AF-06 | P0／中 | AF-05 | Inspector 与样式、稳定缓存和方向文案；必要的已有日志接入 | Chrome 连续模拟可点开对象；中性、单向、死亡、重置展示正确；完成吞吐与帧成本测量 |
| AF-07 | P0 出口／中 | AF-06 | 旧行为投影对照、确定性及存读档矩阵、文档与发布产物 | 行为无变化；规定门禁全绿；仅此时可称 P0 完成 |
| AF-08 | P1／小 | AF-07 | behavior 开关四处配置；best_courtship_target 公共破平 | 同魅力候选偏好生效；开关关／全零回旧序；魅力、资格、需求层级不变 |
| AF-09 | P1 出口／中 | AF-08 | 多种子、至少三代对照报告；检查出生、死亡、成婚与关系分布 | 记录样本及限制，无新增繁衍硬门槛；重复确定性及受影响门禁 |
| AF-10 | P2／中 | AF-09 + **IM-03 + IM-04** | 普通冷却字段及配置；订单事实去重；存档及失效清理 | 拆单、跨资源、零删除、驱逐、保存恢复不绕冷却；满冷却只拒计分；普通上限 +3 |
| AF-11 | P2／中 | AF-10 + **IM-03 + IM-04 + IM-05** | 委托人方向查询、双方较小值匹配破平、取消旧信任 bool | 同价同时间平局改变交易对象；未改价佣；饥渴自救时效与资产守恒通过 |
| AF-12 | P2/P3／逐项 | AF-10 + 对应领域 | 按准入模板分别接帮助、借还、见证、伤害，独立交付 | 成功／失败／取消／重复／责任不明场景分别验收；无无证惩罚 |
| AF-13 | P3／中 | AF-11、已交付 AF-12 切片 | 长程关系流动、冷却满额率与饱和率报告；决定是否另提衰减／激素方案 | 保留灭绝样本，给出参数调整理由；未通过则不扩大敌对行为范围 |

依赖主链：AF-01 → AF-02 → AF-03 → AF-04 → AF-05 → AF-06 → AF-07 → AF-08 → AF-09；
市场接口分支：IM-03 → IM-04 → IM-05 → AF-10/AF-11；
AF-12 每个事件还必须等其领域独立就绪 + IM-XX（对应事件触发器落地）。
记忆、激素不在 P0/P1 前置链上，但与 IM-12 好感度适配存在串行依赖：AF-12 中"真实成交事实"的计时口径须与 IM-12 的冷却周期对齐。

每个含代码的实际提交均按根 AGENTS.md 升版、构建 WASM 并双副本同步，不等到阶段出口才补；同时更新对应 current 技术／产品文档、代码地图、局部指南和版本 changelog。本次规划修订不执行升版。

## 8. 验证与发布门禁

临时断言用完删除，不新增提交进仓库的测试脚本。长期回归复用项目现有工具。下列是**未来实施时**的检查，不代表本次已执行模拟。

| 类别 | 必须覆盖 |
|---|---|
| 更新边界 | -7/+7、归零、自指、胎儿、亡者、容量 1/36、候选自身被驱逐、相同 tick 破平、正负事件反序 |
| 幂等与时序 | 成婚成功／失败、同事实重复、事件不同批次、tick_subphase 与普通 tick 一致、当 tick 决策不读尚未提交增量 |
| 冷却 | 截止前一 tick／截止 tick、同对象多品类、36 个未过期对象后的第 37 个、驱逐／归零／读档不解除、饱和事件消耗窗口 |
| 存档／快照 | 续跑一致、非法范围与重复 ID、旧格式拒绝、空 section 清空、重置跨世界、格式不一致报错、快照读取无副作用 |
| 行为开关 | 同代码开关关恢复旧选择；新旧基线只比较位置、状态、需求、路由、账本、出生／死亡／婚姻等旧字段与 RNG 状态，排除新关系字段及版本元数据 |
| 市场交互隔离 | AF-11 效果关闭时市场仍按原价佣/时间破平运行；开关开启时仅同价同时间平局改变对手，不旁路价格时序优先 |
| 部分成交一致性 | 一单多档部分成交仅首档生成一次关系事实；剩余档位不重复发事件；冷却表写入正确（即使分值未变） |
| 继承待领取场景 | 委托人死亡后，受益人在遗产清算前无法发起新的市场关系事实；已完成但未领取的交易仍保留权益索引 |
| 长程 | 至少沿现有多种子矩阵、至少三代；记录人口、出生／死亡、成婚、关系分布、饱和率、新关系拒入和冷却满额拒计，不断言某对人必成好友 |
| 性能 | 同种子同 tick、同机器、相同快照频率，比较空表／满表的 tick 耗时、WASM 内存、帧大小、Worker/主线程处理；P0 建议以 tick 中位数增幅≤5%为初始目标，失败需分析而非直接放宽 |

按影响范围执行：`cargo build -p sim_wasm --target wasm32-unknown-unknown --release`、WASM 双副本同步、`node tools/test-wasm.js`、`node tools/test-determinism.js`、`node tools/config-check.js`、`node tools/snapshot-check.js`、`node tools/frontend-check.js`；行为变更追加 `node tools/diagnose.js --check all`。浏览器使用 Chrome 建立真实本地存档后验证推进链路。

文档门禁：`node tools/doc-maintenance-check.js`、`node tools/cross-doc-check.js`、`node tools/doc-link-check.js`、`node tools/code-map-check.js`、`node tools/bump-version.js --check` 及 `git diff --check`。新 current 文档须登记维护清单；纯规划改动不伪造已实现 changelog。
