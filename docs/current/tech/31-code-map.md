# 31. 📂 核心代码目录与模块映射

> **模块索引**：[← 返回 ../README.md 全景索引](../README.md)
> 本文件源码树与实际仓库 100% 对应（最后核验：v1.46.21，由 `tools/code-map-check.js` 自动校验）。

---

```text
FlowAndAccord/
├── crates/
│   ├── sim_core/                           # 纯 Rust 确定性模拟内核
│   │   ├── examples/                       # 示例程序与探针
│   │   │   ├── config.json                 # 示例配置（M19 / 地形探针共用）
│   │   │   ├── m19_probe.rs                # M19 行为探针示例
│   │   │   ├── terrain_probe.rs            # 地形通行力探针（实测主脊是否挡路，plan/tech/25 §9.3.1）
│   │   │   └── accent_water_probe.rs       # 水岸装饰探针示例
│   │   └── src/
│   │       ├── config.rs                   # ⚙️ SimConfig 结构体 (370 字段，纯净 derive(Default)，JS 唯一真相源)
│   │       ├── lib.rs                      # crate 入口与模块导出
│   │       ├── rng.rs                      # WorldRng 全局共享确定性随机数
│   │       ├── geo/                        # 🌍 地形与生物群系
│   │       │   ├── mod.rs                  # geo 模块入口
│   │       │   ├── terrain.rs              # 连续 3D 地形高程采样
│   │       │   ├── plateau.rs              # ★ TB-02 台地几何与过渡带 (PlateauGeometry)
│   │       │   ├── alluvial_fan.rs         # ★ TB-03 山前冲积扇几何与干浅沟 (FanGeometry)
│   │       │   ├── basin.rs                # ★ TB-03 盆地几何与环抱高山 (BasinGeometry)
│   │       │   ├── lakeside.rs             # ★ TB-03 湖畔盆地几何与环湖干岸 (LakeGeometry)
│   │       │   ├── static_water.rs         # ★ TB-03 静水共用规划：闭合扰动椭圆轮廓/cells 涂写/WaterBody 特征与岸点登记 (StaticWaterPlan)
│   │       │   ├── hydrology.rs            # 水系生成（含 River/RiverBank 特征闭合轮廓）
│   │       │   ├── accents.rs              # ★ v1.49.1 D-A 装饰散布（Tree/Bush/Boulder 5 类，salt RNG）
│   │       │   ├── query.rs                # 地表通行与建造查询
│   │       │   ├── biome.rs                # 生物群系定义
│   │       │   ├── validation.rs          # ★ STAGE2-4 静态几何只读校验（创世与读档共用门禁）
│   │       │   └── corridor.rs             # 廊道分析
│   │       └── spatial/                    # 🗺️ 空间模拟核心
│   │           ├── mod.rs                  # spatial 模块集成入口
│   │           ├── vec3.rs                 # 3D 向量数学库
│   │           ├── curve.rs                # 三次贝塞尔曲线定义与采样
│   │           ├── graph.rs                # LaneGraph3D 拓扑路网 + A* 寻路 + 踩踏衰减
│   │           ├── terrain_network.rs      # ★ v1.47.4 地形感知路网：合法陆位搜索/走廊 A* 提交/浅滩跨水接入/创世与读档全图校验/水池同步
│   │           ├── poi.rs                  # 23 处 POI 实体定义 (营地4/泉6/果6/木3/石2/金1/榷场互市1)
│   │           ├── house.rs                # 5 阶房屋模型、耐久度与户主绑定 (M6 起无仓储，家户账本为唯一真相源)
│   │           ├── agent.rs                # 部落民实体、生理代谢、随身行囊、运动与状态机
│   │           ├── hormones.rs             # ★ H-01~09 神经内分泌状态机、基线合成、线性回归、离散脉冲与意愿通道（H-08/09，默认关）
│   │           ├── ecology/                # 🌲 生态子模块 (7 文件)：播撒 + POI 采收装载 + 卸货入账 + 榷场结算
│   │           │   ├── mod.rs              # 生态子模块入口与拆分说明
│   │           │   ├── seed.rs             # 世界重置入口 + 播撒步骤编排 + 收尾 (索引/脏标记/APSP)
│   │           │   ├── spawn.rs            # POI 播撒/地形过渡节点/全图路网连接/始祖出生地兜底节点
│   │           │   ├── founder.rs          # 始祖生成 + 家户/宗族/地区/帝国制度登记
│   │           │   ├── tick.rs             # tick_poi_interactions 调度壳 (遍历/胎儿跳过/分娩委托/尸骸清理)
│   │           │   ├── harvest.rs          # 现场采收 (水/粮/木/石/金) 与榷场采购结算
│   │           │   └── home.rs             # 回家卸货入账 (Deposit) 与在家吃喝 (Consume)
│   │           ├── birth.rs                # 妊娠结算、分娩、新生儿属性遗传
│   │           ├── bookkeeping.rs          # ★ M2 家庭生命周期结算 (继承清算 + 分家抽资；M6 起日常收付改由生态/维护层真实记账)
│   │           ├── world.rs                # World3DEngine 结构体定义与生命周期
│   │           ├── world_config.rs         # 动态配置注入与 JSON 反序列化
│   │           ├── world_save.rs           # 确定性存读档序列化与反序列化
    │   │           ├── creation_fallback.rs    # ★ STAGE2-5 有界创世构造器（阶梯降级重试 + 策略去重 + 诊断）
    │   │           ├── survival_diagnosis.rs   # ★ STAGE2-6 生存诊断（水/粮可达预算校验，只读）
│   │           ├── world_season.rs         # 四季与宏观温度时变计算
│   │           ├── world_snapshot.rs       # generate_snapshot 快照数据组装
│   │           ├── world_tick.rs           # tick 管线调度（§4.3 固定顺序）+ 胎儿对账 + 金币继承
│   │           ├── snapshot.rs             # 快照结构体定义 (Agent/House/POI/Household/Marriage/Clan/Region/Ledger)
│   │           ├── snapshot_bin/           # ★ M4 FABS 二进制快照编码层（四处同步第 3 处，与 snapshot.rs 等价）
│   │           │   ├── mod.rs              # snapshot_bin 模块入口
│   │           │   ├── layout.rs           # 二进制帧布局与字段偏移
│   │           │   ├── encode.rs           # FABS 帧编码 (枚举码位/驻留表/字段顺序)
│   │           │   ├── strtab.rs           # 字符串驻留表 (StrTab, start_index==0 判全新表)
│   │           │   └── dict.rs             # 枚举名称表 (*_code() / *_table())
│   │           ├── decisions/              # 🧠 马斯洛决策子系统 (16 文件, M19 意图-策略-原语解耦)
│   │           │   ├── mod.rs              # 决策子模块入口与重新导出
│   │           │   ├── intent.rs           # M19 意图与完成条件类型 (AgentIntent / IntentKind / CompletionPolicy)
│   │           │   ├── strategy.rs         # M19 策略与阶段类型 (ActiveTask / ExecutionStrategy / ResourceStage / CommitStage)
│   │           │   ├── primitive.rs        # M19 动作原语描述类型 (ActionPrimitive / ArrivalKind / HoldKind)
│   │           │   ├── projection.rs       # M19.2 兼容视图纯投影 (compatible_legacy_state)
│   │           │   ├── transition.rs       # M19.2/M19.3 统一生命周期转换器 (install_task / advance_stage / on_navigation_arrived / finish_task)
│   │           │   ├── observation.rs      # 不可变执行观察与旧枚举无损视图 (observe_execution)
│   │           │   ├── branches.rs         # ★ 16 条活跃分支注册表（稳定 ID 保留 b11/b15 空位，自包含条件函数，Rust 侧无顺序；b8 高阶/b13 接 H-08/09 意愿等待）
│   │           │   ├── needs.rs            # NeedKind 需求定义、升级材料成本 (upgrade_material_cost)、家户缺口计算
│   │           │   ├── evaluate.rs         # Decisioner 结构体 + L1 持续仲裁 / 瞬发通道 + L2 策略派发 / 节拍推进
│   │           │   ├── routing.rs          # 导航/寻路/原地掉头/返家/POI 触发器可用性 / 归家任务同步
│   │           │   ├── harvest.rs          # 现场采收判定 + 行囊满额查询 + L1 连续采收候选仲裁 + 单趟多品类连续采收
│   │           │   ├── seeking.rs          # 途中熔断与平滑重路由 (★v1.27.0 try_route_to_market 断流直达榷场)
│   │           │   ├── market.rs           # 外部商贸决策子模块 (evaluate_market_trade / 途中可用性 / 现场交易完成返家)
│   │           │   ├── preemption.rs       # ★ M19.4b 分级任务抢占 (危机抢占/平滑中断/行囊保全)
│   │           │   └── scheduler.rs        # tick_decisions + execute_pending_coronations(★M4登基) + build_decision_context
│   │           ├── housing_system/         # 🏡 房屋全生命周期子系统 (7 文件)
│   │           │   ├── mod.rs              # 房屋系统 tick 管线入口
│   │           │   ├── auction.rs          # 营地麦穗 37% 拍卖机制与出价受理
│   │           │   ├── maintenance.rs      # 冬季供暖与耐久修缮结算
│   │           │   ├── construction.rs     # 升级瞬时竣工 (M6 起一次性扣账无工时) + 材料成本校验
│   │           │   ├── marriage.rs         # 自动成婚与丧偶改嫁匹配 (M6 起遍历家户户主)
│   │           │   ├── settlement.rs       # 立宅选址校验、路网接入、空置节点复用
│   │           │   └── inheritance.rs      # 空置房登记（户主亡故→无主→营地列表+受益人）
│   │           └── ledger/                  # 📒 账本与社会经济制度子系统 (8 文件, M1~M5)
│   │               ├── mod.rs              # ledger 模块入口与重新导出
│   │               ├── journal.rs          # 账本内核 (ResourceKind/Ledger/TransferRecord/TransferReason/LedgerRef)
│   │               ├── group.rs            # 团体基类 (leader + members + ledger, GroupKind: Family/Clan/Region)
│   │               ├── marriage.rs         # 婚姻登记簿 (终身多段婚姻全留痕、存续唯一性)
│   │               ├── family.rs           # 家户体系 (家庭跟着男人走、户主男性锚定、改嫁先移后加)
│   │               ├── clan.rs             # ★ M3 宗族系统 (ClanRegistry/族长顺位/族税/互助)
│   │               ├── region.rs           # ★ M4 地区与王国系统 (RegionRegistry/初王/继承/公仓税/救济)
│   │               └── empire.rs           # ★ M5 帝国与联邦系统 (EmpireRegistry/上层政体)
│   └── sim_wasm/                           # 🔌 WASM 零依赖 FFI 导出层
│       └── src/
│           └── lib.rs                      # 导出函数、静态缓冲区、错误码、指针约定、双副本同步
├── frontend/
│   ├── js/
│   │   ├── config.js                       # ⚙️ 主配置 (window.SIM_CONFIG, 370 字段)
│   │   ├── config.decision-order.js        # ★ 决策分支顺序唯一真相源（16 条活跃分支 + 层级覆盖，§4.12 文档化例外）
│   │   ├── config.house-upgrade-cost.js    # ★ M8 房屋升级材料成本矩阵 (20 字段 = 4级×5资源，Object.assign 合并进 SIM_CONFIG)
│   │   ├── config.lighting.js              # ★ v1.48.0 动态季节光照前端配置 (window.SIM_LIGHTING，纯表现层，不并入 SIM_CONFIG)
│   │   ├── config.poi-rates.js             # POI 产速本地偏好 (localStorage 倍率，world_create 前读取，可复现演化)
│   │   ├── config.render.js                # ★ v1.50.15 渲染参数外置 (window.RENDER_CONFIG：贴图抬升/足迹半径/装饰半径，纯表现层，不并入 SIM_CONFIG；★ TA-12 terrainTexture 配置组 12 键含 detailFadePx LOD 淡入区间)
│   │   ├── math.js                         # 3D 向量与投影变换 + 地形反照率/光照分解 (computeTerrainAlbedo)
│   │   ├── terrain-texture.js              # ★ TA-12 世界坐标锁定地表纹理模型层 (window.TerrainTexture：固定整数哈希/独立属性通道/世界桶候选/草斑土纹图元/材质筛选/有界缓存与分批构建；★ TA-12-3 clipToRect/buildFragments 跨格预裁剪 + drawCell 四角双线性贴面投影；★ TA-12-4 refreshPalette 共用受光色档；★ TA-12-5 invalidate 生命周期；★ TA-12-7 _lodFade live LOD 热调修复)
│   │   ├── terrain-style.js                # ★ TB-03-11 景观风格样式表 (window.TerrainStyle：profile→基调白名单/世界 seed 固定盐选型/逐 SurfaceKind 反照率乘色；纯表现层)
│   │   ├── lighting.js                     # ★ v1.48.0 年周期光弧引擎 (光相/视觉限速器/地形重着色/面光照/世界空间阴影；★ TA-12-4 lightParams/shadeAlbedoInto 共用受光步骤 + 批次末尾通知 TerrainTexture.refreshPalette)
│   │   ├── decision-viz-data.js            # 决策分支元数据 (BRANCH_MAP 条件文案/层级/图标 + FSM_STATE_ZH 中文映射)
│   │   ├── decision-viz-view.js            # 决策引擎覆层 DOM 渲染 (Branch 分支卡/分界线/检查器/拖动)
│   │   ├── decision-viz.js                 # 决策可视化窗口控制器与状态桥接
│   │   ├── auction-ui.js                   # 房屋麦穗拍卖交易所大盘与竞价面板
│   │   ├── ta06-acceptance.js             # ★ v1.52.1 TA-06 人工验收台 (仅 ?ta06=1 激活；季节/光向/相机/缩放快捷控制 + 7 株样板飞往 + 物种标注层 + 读数行；无参数零 DOM 零 rAF)
│   │   ├── entity-link.js                  # 跨面板族人/房屋/POI/团体实体下钻跳转交互
│   │   ├── sim_worker.js                   # ★ v1.38.0 仿真内核专用 Web Worker (后台独立线程加载 WASM、自主步进与快照背压推送)
│   │   ├── snapshot-bin.js                 # ★ M4 FABS 二进制帧解码器 (strCache 驻留表缓存, start_index==0 判全新表, 四处同步第 4 处)
│   │   ├── rustworld.js                    # ★ v1.38.0 主线程仿真代理层、快照映射、Worker 生命周期管理、agentArchive 全量档案库
│   │   ├── dag-layout.js                   # 族谱时间轴布局数学 (纯函数, 零 DOM)
│   │   ├── dag-view.js                     # 族谱虚拟化渲染 + LOD + pan/zoom + 刻度尺
│   │   ├── dag-standalone.js               # 族谱独立新标签页 HTML 模板
│   │   ├── dag.js                          # 族谱数据构建 + 模态编排 + Inspector
│   │   ├── main.js                         # 页面交互、控制台、事件绑定、相机控制
│   │   ├── map-view.js                     # ★ v1.50.0 地图图鉴独立页控制器 (只读嵌入正式渲染管线，无模拟/无存档)
│   │   ├── ledger-ui.js                    # ★ 社会与经济制度大盘 4 标签页 (家户/婚姻/宗族/王国)
│   │   ├── save-ui.js                      # ★ 读档/存档系统 UI (三槽位 localStorage + v1.11.0 本地文件直写 File System Access API)
│   │   ├── render_canvas.js                # Canvas 渲染主循环、帧率控制与共享状态 (★ v1.50.82 帧率上限可配置，默认 60 FPS，可解除门控)
│   │   ├── river_life.js                   # ★ v1.49.0 水系微观生态层 (成群游鱼，★ v1.50.86 Canvas + WebGL sink 双路并删除太阳波光，纯表现层，随种子确定性重建)
│   │   ├── accent-season.js                # ★ v1.50.23 TA-01 装饰季相层 (window.SimTreeTint 叶色唯一生产者，自 render_terrain.js 迁出；★ TA-06-2 删除 tint() 三档兼容接口，profile 由 model.profile 单一入口送入)
│   │   ├── accent-model.js                 # ★ v1.50.23 TA-01 装饰模型层 (window.AccentModel 个体形态缓存 + _accentHash，世界事件 resetCache；★ S4-02 getByKey 完整 key 通道；★ TA-06 物种派生 speciesOf（三乔木轮廓 broad/sparse/conifer + 三灌木变体 multiStem/flowering/lowEvergreen + 花灌木固定花位），骨架输出 crownR/trunkH/footprintR/crownSquash 为唯一几何真相源；★ TA-07-3 真值包围体 bounds{rH,zMin,zMax,yUp,rS} + 分级几何 farClusters/segTier/stoneMain，extent 由 bounds 派生)
│   │   ├── accent-lod.js                  # ★ TA-07-2 装饰细节分级 LOD 集中解析层 (window.AccentLOD：特征尺度 CSS px / 三档判档 + 阈值带滞回 tierOf·tierFor(_lodT) / kindBounds 一级保守常数 / aabbOf 解析式屏幕 AABB（yUp 石体贴地 + rS 球体不乘 cosX）/ shadowAabb 冠影+影梢并集 / leanShear 单一来源 / stats dev 计数器；六处消费点唯一口径入口)
│   │   ├── landscape-model.js              # ★ S4-02 资源景观模型层 (window.LandscapeModel：配方/slot/固定 uint32 哈希/极坐标候选/双线性高程/组缓存，静态输入派生，世界事件 resetCache；★ S4-03 version() 组几何版本号；stockRole detail/qThreshold + childActive（foliage 可采细节 q 显隐）；★ v1.50.87 GroundPatch 贴地色差片/坡度拒绝/点簇预计算整体删除，配方 v4)
│   │   ├── landscape-mask.js               # ★ S4-03 景观遮罩层 (window.LandscapeMask：道路胶囊带/房屋/POI 保护区 + 世界网格分桶 + 字段签名脏桶失效 + 装饰去重；源数组只隐藏不移除，世界事件 resetCache；★ S4-04 detail 子图元只预判 _masked 不入占据桶)
│   │   ├── terrain-mesh-merge.js           # 地形共面网格贪婪合并 (Greedy Quad Meshing：法线近似/高程共面/同材质合并为大四边形，大幅降低渲染面数与深度排序开销)
│   │   ├── render_terrain.js               # ★ v1.49.1 地形网格/水系特征 + 天空/大气氛围 (从 render_world.js 拆出；已移除 RiverBank 金砂漫滩线；★ v1.50.23 装饰绘制已迁出 render_accents.js；★ TA-12-3 drawTerrainCell 基底后调用 TerrainTexture.drawCell 同深度落笔)
│   │   ├── render_accents.js               # ★ v1.50.23 TA-01 装饰绘制层 (drawAccentEntity 分发 + Tree/Boulder/RockCluster；★ v1.50.39 TA-04-3 cylinderShade 枝干圆柱侧面明暗；★ TA-06-5 灌木绘制迁出 render_bush.js、★ TA-06-6 三乔木轮廓接入（冠幅/干高/扁压/倾干读模型）；★ TA-07 判档走 AccentLOD、segTier 分档枝条 / farClusters 远景簇子集 / 远景石体两笔简化 / 消费深度项 AABB 与锚点 ex·ey，由 render_world.js 深度队列调度)
│   │   ├── render_bush.js                  # ★ TA-06-5 灌木绘制层 (自 render_accents.js 迁出守 800 行上限：drawAccentBush 三变体 + ★ TA-06-7 花朵图元 flowerAmount 首次消费，低饱和三色板/簇法线受光/中近景限量，复用 accent 族共享刮擦工具；★ TA-07 判档走 AccentLOD + 远景簇子集 + 补簇级 x/y 剔除)
│   │   ├── render_grass.js                 # ★ v1.50.39 GrassTuft 草丛绘制 (自 render_accents.js 迁出守 800 行上限；grassSeasonColor 季相色 + 芦草穗，复用 accent 族共享刮擦工具；★ TA-07 整丛省略判据走 AccentLOD.featurePx，芦花穗阈值收编 accentLODPlumeMinPx)
│   │   ├── render_shadows.js               # ★ v1.50.46 TA-04-6 装饰贴地投影绘制层 (drawAccentShadowGround 树/灌木地面图元阴影：实高驱动影长 + 叶量调制夏冠影/冬枝影，复用 accent 族共享刮擦工具；★ S4-02 drawAccentShadowFor 模型参数化主体；★ TA-06-8 冠幅读模型 skel.crownR；★ TA-07 剔除改 AccentLOD.shadowAabb，签名加 it 消费深度项锚点)
│   │   ├── render_landscapes.js            # ★ S4-02 资源景观绘制接入层 (collectLandscapes 入队 + drawLandscapeChild/drawLandscapeShadowGround 分发；复用装饰图元/光照/季相，配置关态零开销回退；★ S4-03 被遮蔽子图元连同投影不入队；detail 子图元 childActive q 过滤；★ TA-07 入队与绘制共用 AccentLOD AABB，签名加 it；★ v1.50.87 GroundPatch 贴地色差片绘制删除)
│   │   ├── label-layout.js                # ★ S4-06 标签候选层与屏幕布局 (window.LabelLayout：提案池/字体测量缓存/固定备选位[首选/镜像/同排左右]/屏幕网格冲突检测/UI 禁入矩形/overlay 通道；pinned 恒接受占格 + ordinary 可省略；候选 ≤4 有界；关态回退旧直接绘制)
│   │   ├── render_depth_queue.js           # ★ v1.50.46 TA-04-6 世界统一深度队列层 (自 render_world.js 拆出单一职责：DEPTH_* 对象池 / _surfaceDepth·_decalDepth 足迹深度 / MAP_Z_LIFT·projectLifted / drawWorldEntities 收集与分发 + 树灌木阴影入队；★ S4-03 装饰段前遮罩同步 + 被遮蔽装饰及其投影跳过；★ S4-06 beginFrame/resolve 挂载 + proposePoi/House/AgentLabels；★ TA-07-6 装饰/阴影入队前两级剔除（kindBounds 粗剔 → 模型 bounds 精剔）+ 深度项新增 ex/ey 锚点与 AABB 复用 s1x~s2y 提案 + drawSelectedNeedBubbleOverlay 交互覆盖；★ TA-12-3 帧首 TerrainTexture.prepare 分批准备)
│   │   ├── render_world.js                 # 车道贝塞尔曲线、POI 底座/标记、私宅绘制（★ v1.50.46 深度队列已迁往 render_depth_queue.js；保留 lightShadowOffset/shadeHex 光照帮助函数）；★ S4-06 proposePoiLabels/proposeHouseLabels 提案 + 绘制消费 posOf（未安置即省略；LOD 阈值收进 config.render）
│   │   ├── render_agents.js                # 族人粒子、行囊搬运与夺位远征动态标牌（★ S4-06 需求气泡迁 overlay 层 drawSelectedNeedBubbleOverlay；施工/流产/夺位角标 pinned + posOf 消费）
│   │   ├── render_inspector.js             # 拾取光标、族人/房屋/地标检查器面板渲染
│   │   ├── render_hud.js                   # 顶部 HUD 数据栏、四季指针与系统控制状态
│   │   └── webgl/                          # ★ WebGL 硬件加速渲染管线
│   │       ├── fallback-handler.js         # WebGL 不可用/崩溃降级守卫
│   │       ├── render-canvas-patch.js      # Canvas 渲染主循环双管线分发补丁
│   │       ├── core/
│   │       │   ├── context.js              # WebGL2 上下文初始化与生命周期
│   │       │   └── shader-manager.js       # 着色器编译与程序链接管理
│   │       ├── layers/
│   │       │   ├── terrain/
│   │       │   │   ├── terrain-renderer.js # 真实地形网格与 Diorama 侧壁 WebGL 渲染器
│   │       │   │   └── test-grid.js        # 基础测试网格渲染器
│   │       │   └── accents/
│   │       │       ├── accent-renderer.js   # 装饰图元 WebGL 三角化 + 解析式边缘 AA + 深度对齐（sink 图元）
│   │       │       └── shadow-pass.js      # WebGL 装饰阴影 Pass（冠簇竖直压扁代理）
│   │       └── utils/
│   │           └── projection-utils.js     # 轴测投影矩阵与投影换算工具
│   ├── rust/
│   │   └── sim_wasm.wasm                   # WASM 编译产物主副本 (rustworld.js 实际 fetch 路径)
│   ├── sim_wasm.wasm                       # WASM 编译产物根目录备用副本
│   ├── server.js                           # 静态文件开发服务器 (内置 .wasm MIME + POST /save-decision-order, 默认 3004 端口)
│   ├── index.html                          # 完整单页可视化仿真系统 (14 script 按序加载)
│   ├── map.html                            # ★ v1.50.0 地图图鉴独立页 (加载 index.html?mapOnly=1&nogate=1 只读画布，无存档门禁)
│   ├── map.css                             # ★ v1.50.0 地图图鉴页样式 (map-only 模式，仅保留画布)
│   └── style.css                           # 全局样式
# frontend/public/ = 对象存储借用测试页目录（elder.html 等），非本项目产物，code-map 扫描已屏蔽
├── tools/
│   ├── baseline-default-800k.json          # 默认配置 80 万 tick 性能基准数据
│   ├── baseline-m19-observation.json       # ★ M19.0 冻结观察基线 (gen-m19-baseline.js 产出，差分回归真值)
│   ├── baseline-maxyield-800k.json         # B2 满载 80 万 tick 基准数据 (profile-benchmark --json 产物)
│   ├── baseline-maxyield-800k-m5.json      # B2 满载 800k tick 复测入库 (v1.46.0 T1 门禁产物)
│   ├── bump-version.js                     # 版本号统一升版器 (真相源对齐与 8+ 处定义点同步)
│   ├── code-map-check.js                   # ★ 代码地图一致性校验 (实际文件 vs ./31-code-map.md 登记 + 描述漂移检测)
│   ├── config-check.js                     # 前后端配置一致性校验 (含 config.house-upgrade-cost.js) + ./05-config-reference.md 自动生成
│   ├── clean-target.js                     # ★ v1.50.82 target/ 清理器 (默认预览不删除；--yes 执行；--all 清 dev-wasm 缓存；release 受白名单保护)
│   ├── cross-doc-check.js                  # ★ 跨文档事实指纹一致性检查 (同指纹多文档值不同即冲突，配置值另与权威比对)
│   ├── dag-shot.js                         # 族谱多档位无头截图验证 (Node 加载 FlowDag + Chrome headless)
│   ├── diagnose.js                         # 确定性无头内核诊断与 Bug 嗅探工具 (指定 seed/tick 极速排障)
│   ├── doc-link-check.js                   # ★ Markdown 相对链接可达性门禁 (2026-09-12 新增)
│   ├── doc-maintenance-check.js            # 文档维护体检器 (新鲜度、复核周期与维护清单扫描)
│   ├── frontend-check.js                   # 前端静态一致性与 JS 语法校验门禁 (含 getElementById DOM ID 存在性检查)
│   ├── gen-dag-testdata.js                 # 族谱布局参数拟合测试数据生成 (驱动 sim_wasm 跑满 50 万 tick)
│   ├── gen-m19-baseline.js                 # ★ M19.0 冻结基线生成 (长程演化导出观察基线 JSON)
│   ├── gold_mining_analysis.js             # 淘金与货币经济行为专项分析脚本
│   ├── profile-benchmark.js                # 性能 Profiling 基准测试与微秒级子阶段剖析器
│   ├── rust-download.js                    # Rust 工具链下载器 (Node OpenSSL TLS 绕过系统证书异常)
│   ├── snapshot-check.js                   # ★ 快照同步静态校验 (snapshot.rs定义 vs world_snapshot.rs赋值 vs rustworld.js映射)
│   ├── snapshot-reader.js                  # ★ T1(v1.46.0) FABS 统一快照读取器：tools/ 全部工具唯一取值入口（快照仅此一条通道）
│   ├── test-dag.js                         # 族谱上下 5 代范围截断与布局确定性自动化测试套件
│   ├── test-determinism.js                 # 增强型确定性矩阵测试套件 (6 大数学不变量定理验证)
│   ├── test-itinerary.js                   # ★ M19.4d 多品类预排采收行程验证 (链路/TSP 排序/多站推进/长程确定性)
│   ├── test-m19-differential.js            # ★ M19 差分回归 (3600 tick 存档与快照哈希逐字节一致性)
│   ├── test-personalization.js             # ★ M19.4c 禀赋与家资个性化选策验证
│   ├── test-preemption.js                  # ★ M19.4b 分级任务抢占验证 (危机抢占/平滑中断/行囊保全)
│   ├── test-wasm.js                        # WASM 回归测试 (确定性/防越界/防 NaN/长程稳定)
│   └── vendor-deps.js                      # 依赖图 BFS vendor 解析器 (crates.io API 发现并下载全部依赖到 .vendor/)
├── .github/
│   └── workflows/
│       └── deploy.yml                      # CI/CD 自动部署 (GitHub Actions → 腾讯云 COS)
├── AGENTS.md                                # 📖 智能体操作指南 (唯一保留在根目录的文档)
├── TODO.md                                  # 待办事项清单
└── docs/                                    # 📚 全部项目文档（当前/计划 → 产品设计/技术方案 → 目录内顺序编号）
    ├── README.md                              # 文档总导航
    ├── doc-maintenance.json                   # 文档维护清单契约配置
    ├── current/                               # 现状：代码中真实存在的行为
    │   ├── README.md                          # 现状总索引（含完整模块导航表）
    │   ├── 01-changelog.md                    # 版本演进记录
    │   ├── design/                            # 产品设计（玩家视角：看到什么、规则是什么）
    │   │   ├── 01-product-overview.md           # 定位、核心循环、八大看点、首局瞬间
    │   │   ├── 02-world-rules.md                # 地图模板、地形、聚落行政升级、道路涌现、四季
    │   │   ├── 03-life-and-society.md           # 马斯洛六层、生命周期、房屋五级、社会结构
    │   │   ├── 04-economy.md                    # 有限生态、真实搬运、家户账本、榷场定价
    │   │   ├── 05-observation-ux.md             # 窗口模型、观察工具、操作与信息层级
    │   │   ├── 06-agent-behavior-design.md      # AI 行为设计：自治边界、严优先级马斯洛、闭环
    │   │   ├── 07-terrain-implementation.md     # 地图模板玩法规则（玩家视角）
    │   │   └── 08-housing-system.md             # 房屋玩法规则（玩家视角）
    │   └── tech/                              # 技术方案（实现视角，目录内从 01 起顺序编号）
    │       ├── 01-engine-architecture.md        # 总体：三层解耦、tick 顺序、数据流
    │       ├── 02-core-systems-fsm.md           # 三大核心系统状态机全景
    │       ├── 03-determinism.md                # 确定性原理、RNG 分域、门禁矩阵
    │       ├── 04-config-system.md              # SIM_CONFIG 免编译热调优
    │       ├── 05-config-reference.md           # 参数速查表（config-check 自动生成，勿手改）
    │       ├── 06-snapshot-and-save.md          # FABS 快照与存档全量契约
    │       ├── 07-ledger-and-polity.md          # 上层：账本、家户、宗族、王国、帝国
    │       ├── 08-ecology-and-poi.md            # 上层：23 处有限生态、采收与卸货
    │       ├── 09-market-pricing.md             # 上层：榷场互市与幂律定价
    │       ├── 10-agent-life-cycle.md           # 中层：生理代谢、繁衍、禀赋、死亡
    │       ├── 11-decision-engine.md            # 中层：马斯洛六层与 16 条分支（附技术选型理由）
    │       ├── 12-m19-architecture.md           # 中层：意图-策略-原语三层解耦规格
    │       ├── 13-housing-system.md             # 中层：五级房屋、折旧、空置房拍卖
    │       ├── 14-terrain-and-network.md        # 下层：地表单元、水系、路网与通行
    │       ├── 15-seasons-climate.md            # 下层：四季年轮与冬季供暖
    │       ├── 16-frontend-overview.md          # 表现层：渲染管线与深度队列铁律
    │       ├── 17-seasonal-lighting.md          # 表现层：年周期光弧与地形重着色
    │       ├── 18-water-rendering.md            # 表现层：矢量河面、漫滩与水体生态
    │       ├── 19-ui-implementation.md          # 表现层：页面全景 + 窗口结构与跳转
    │       ├── 20-society-ledger-ui.md          # 表现层：制度大盘四标签页
    │       ├── 21-frontend-dev-guide.md         # 表现层：前端开发实施指南
    │       ├── 22-build-and-run.md              # 工程：工具链、WASM 双副本、快速启动
    │       ├── 23-tools-guide.md                # 工程：tools/ 全工具速查
    │       ├── 24-diagnostics.md                # 工程：无头诊断 SOP
    │       ├── 25-benchmarking.md               # 工程：性能基准与确定性矩阵
    │       ├── 26-cicd.md                       # 工程：GitHub Actions → 腾讯云 COS
    │       ├── 27-browser-automation.md         # 工程：浏览器自动化与截图
    │       ├── 28-invariants.md                 # 工程：六类硬约束集中清单
    │       ├── 29-impact-matrix.md              # 工程：改 X 牵动哪些文件 + tick 顺序
    │       ├── 30-workflow.md                   # 工程：Agent 入口 + 提交检查单 + 文档维护
    │       └── 31-code-map.md                   # 附录：本文件
    └── plan/                                 # 计划：在办设计与未落地方案
    │   ├── README.md                          # 计划总索引（含依赖顺序图）
    │   ├── design/                            # 产品设计（玩法方向）
    │   │   ├── 01-roadmap.md                    # 长期路线图 M10~M18
    │   │   ├── 02-everyday-life.md              # 人物日常生活细化
    │   │   ├── 03-social-relations.md           # 人际依赖与敌对 × 生产
    │   │   ├── 04-hormone-system.md             # 四轴十一激素调制层
    │   │   ├── 05-affinity-system.md            # 人际好感度系统
    │   │   ├── 07-hunting-defense.md            # 狩猎、流寇与武力公约（玩法方向）
    │   │   └── 06-competitor-analysis.md        # 竞品与同类项目分析
    │   └── tech/                              # 技术方案（未落地实现）
    │       ├── 01-integration-contracts.md      # 跨专项共享契约权威
    │       ├── 02-memory-system.md              # 人物记忆与经验传承
    │       ├── 03-internal-market.md            # 售货员撮合与有限订单簿
    │       ├── 04-farmland-agriculture.md       # 农田与农业税
    │       ├── 05-hunting-defense.md            # 狩猎、流寇与武力公约
    │       ├── 06-terrain-templates.md          # 地图模板库与 D-B 子特征蓝图
    │       ├── 07-terrain-art.md                # 地形美术与世界景观
    │       ├── 08-performance.md                # 仅保留未完成的性能优化
    │       ├── 09-vegetation-verification.md    # 植被样板验证方案与遗留事项（TA-05，自根目录临时方案收口精简）
    │       ├── 10-basin-mountain-encirclement.md # ★ TB-04 盆地群峰环抱与峡谷出水口地貌规划
    │       ├── 31-canvas-to-webgl-migration.md  # WebGL 渲染管线迁移总体路线规划
    │       └── assets/                          # 专项归档（实施/验收/验证记录）
    │           ├── ta09/slope-verification.txt    # TA-09 RiverCliff 局部试算验证记录
    │           └── ta06-evidence-2026-09-22/      # TA-06 物种变体专项证据包（2026-09-22，默认 WebGL 路径补做验收）
    │               ├── manifest.json                # 证据清单
    │               ├── report.md                  # 验收报告（96 视图矩阵 / 受光 / 生命周期 / 景观通道 / 高密）
    │               ├── metrics/matrix.json          # 96 视图 + 6 变体逐张像素指标与四维聚合
    │               └── metrics/fixture-assertions.json  # 页内数值断言原始结果（物种分布 / 包围体 / 花位 / 景观 / 缓存）
    │                                               # （visual/ 下截图为 640×360 缩图，按既有惯例不逐张登记）
```

## 1. 目录级 AGENTS.md
复杂代码目录内维护局部 AGENTS.md，改对应目录代码前先读：
- `crates/sim_core/AGENTS.md`
- `crates/sim_wasm/AGENTS.md`
- `crates/sim_core/src/spatial/AGENTS.md`
- `crates/sim_core/src/spatial/decisions/AGENTS.md`
- `crates/sim_core/src/spatial/housing_system/AGENTS.md`
- `crates/sim_core/src/spatial/ledger/AGENTS.md`
- `frontend/AGENTS.md`

## 2. 自动校验
本文件由 `node tools/code-map-check.js` 校验，捕获：文档缺失 / 文档过时 / 描述关键词漂移 / 嵌套 AGENTS.md 缺失。CI 可纳入此校验。

## 3. M19.1 类型与只读观察入口

`decisions/intent.rs` 定义意图并转换已知来源的 Need；`strategy.rs` / `primitive.rs` 定义计划词汇；`observation.rs` 为 Agent 提供借用式执行事实与旧状态无损视图。旧 evaluate/routing/scheduler 继续执行，不存在第二个调度器。API 与存储边界见 [./12-m19-architecture.md](./12-m19-architecture.md)。

