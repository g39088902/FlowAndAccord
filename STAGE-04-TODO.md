# STAGE-04-TODO · 地图模板阶段四（D-C）技术实施方案与任务列表

> **来源与范围**：[06 地图模板规划](docs/plan/tech/06-terrain-templates.md) R.3「四 · D-C」与 §19：通用景观群、标注与视觉避让；特定地貌景观群逐项交付。
> **状态**：待实施。本文给出施工设计与验收任务，不代表功能已经落地；所有任务默认未完成。
> **源码复核基线**：2026-09-13，提交 `7e0f8b7`，页面应用版本 `v1.50.46`，生成器版本 5，存档结构版本 7。06 号文首的 v1.50.44 是其历史复核基线，不能代替开工时的实际源码。
> **放置说明**：按本次要求输出到项目根目录，沿用根目录专项阶段 TODO 的形式。总体排期仍由 06 号 R.3 维护；视觉机制由 [07 地形美术](docs/plan/tech/07-terrain-art.md)维护；本文维护阶段四的原子任务、施工顺序与验收记录。

## 1. 交付目标与依赖边界

阶段四让玩家从普通地图上辨认泉水、林地、果丛和矿区，并在聚落变密后继续看清道路、采收入口、选中目标和关键标签。采用**前端确定性派生景观 + 最终几何视觉遮罩 + 屏幕标签布局**，复用内核已经提供的世界事实。

| 交付项 | 本阶段做什么 | 与已有计划的关系 | 直接前置 |
|---|---|---|---|
| 通用泉水景观 | 围绕真实 Water POI 的岸石、低草、湿润地表点缀，保留取水入口 | TA-17 泉边样板 | D-B1 已交付的模型/快照/缓存基座 |
| 通用资源区景观 | Wood/Berry/Stone/Gold 四类稳定景观群，以少量可采细节表达库存 | TA-17 资源区样板 | 同上 |
| 视觉避让 | 对新景观及已有 accents 做道路、房屋、POI 操作区遮罩 | TA-14 | 最终世界几何适配器 |
| 标注避让 | 房屋、POI、状态提示的标签收集、优先级布局、拥挤省略/聚合 | TA-16 | 现有文字入口；可独立开工 |
| 特定地貌景观 | 湖岸、瀑布、峭壁等专属构图适配 | D-C 后续逐项交付 | 各自实际注入器、几何及快照契约通过 |

通用 D-C 不等待阶段二全部收口、R0 或全部 D-B2，也不要求 TA-09 大场景样板完成。泉边与林地先做本阶段局部样板，再推广至其余资源区。房屋院地属于 TA-17 的相邻工作，本轮仅做房屋占地与入口留白，完整院地另行排期；不以此阻塞通用 D-C。

不重复开发已交付的 RockCluster/GrassTuft、支脊、光照与阴影基础。阶段三的密林山坡等散布规则改变的是地貌关联装饰分布；本阶段资源景观围绕 POI 组织，两者通过遮罩去重衔接。

## 2. 现状与文件级接入点

以下是本次源码复核发现的可复用入口，实施前按任务再次检查局部 [frontend/AGENTS.md](frontend/AGENTS.md)。

| 文件 / 入口 | 当前事实 | 阶段四接入方式 |
|---|---|---|
| [rustworld.js](frontend/js/rustworld.js) `_applySnapshot()` | POI 已映射 id/type/pos/currentStock/maxStock；每帧可能重建对象；静态地形与装饰有独立缓存语义 | 使用稳定 ID 和字段签名更新派生层，不以对象引用判断变更 |
| [rustworld.js](frontend/js/rustworld.js) `_invalidateWorldStaticCaches()` | 世界生命周期清静态缓存；缺席 section 与显式空集合有不同语义 | 挂接新景观、遮罩、标签缓存的清理 |
| [accent-model.js](frontend/js/accent-model.js)、[accent-season.js](frontend/js/accent-season.js) | 局部模型与季相独立，支持树、灌木、石群、草丛等 | 复用几何及季相，景观实例使用独立命名空间 |
| [render_accents.js](frontend/js/render_accents.js)、[render_grass.js](frontend/js/render_grass.js)、[render_shadows.js](frontend/js/render_shadows.js) | 立体图元、草、贴地阴影已有独立入口 | 用适配后的视觉实例复用绘制，避免复制光照公式 |
| [render_depth_queue.js](frontend/js/render_depth_queue.js) `drawWorldEntities()` | 实际入队/排序/分发入口，已从 render_world.js 拆出 | 新增景观子图元的入队，维持统一深度及对象池 |
| [render_world.js](frontend/js/render_world.js) `drawPoiMarker()` / `drawHouse()` | POI 图标、房屋标签等仍在实体绘制内直接输出 | 实体保留原绘制；标签拆为候选收集与布局后绘制 |
| [render_canvas.js](frontend/js/render_canvas.js) | 调用世界深度队列，后续处理调试叠加和 UI | 安排布局时机和选中/悬浮提示覆盖层 |
| [config.render.js](frontend/js/config.render.js) | 已有独立 `RENDER_CONFIG`，不进入 `SIM_CONFIG` | 集中新增纯视觉预算、留白距离、标签间距与开关 |
| [index.html](frontend/index.html) | 原生脚本按依赖顺序加载 | 登记新增脚本，禁止隐式加载依赖 |

**数据缺口**：当前 POI 前端映射没有独立 `WaterAccessPoint` 或水池关联字段。不能在施工时直接调用想象中的 `poi.waterAccessPoint`。S4-01 必须核对 Water POI 坐标与内核实际交互入口的对应关系；首版围绕已映射 POI、相连路段和现有水面轮廓保守留白。不足以证明岸点/水面关系时只画陆侧低草与岸石，不画新泉池。若必须增加真实取水点字段，另拆跨层任务，执行快照四处同步，不用前端猜测代替内核事实。

## 3. 技术实施方案

### 3.1 数据所有权与整体流水线

新增三个职责单一的前端模块（**建议新文件名，不是现有 API**）：

- `frontend/js/landscape-model.js`：POI 景观配方、稳定视觉 ID、局部几何派生及模型缓存。
- `frontend/js/landscape-mask.js`：最终世界几何适配、空间索引、候选拒绝/子图元裁剪。
- `frontend/js/render_labels.js`：文字测量、屏幕空间布局、聚合、省略和标签命中信息。

资源群专属绘制若无法直接复用 accent 绘制，单独建 `render_landscapes.js`；不可把配方、索引或布局塞进深度队列。新增后更新脚本顺序、代码地图与前端局部指南；修改文件不得继续突破 800 行限制。

```text
成功接收世界快照
  → 按生命周期替换静态事实 / 按 ID 更新动态几何签名
  → 最终几何适配器：地形、道路、房屋、POI 操作区
  → 生成或复用资源群局部模型（与相机、库存无关）
  → 世界空间遮罩：过滤/裁剪景观与已有 accents 的可见部分
  → 投影、LOD、包围体剔除
  → 地面图元 / 立体子图元 / 阴影分别进入统一深度队列
  → 标签候选布局；普通标签按世界遮挡语义绘制
  → 选中/悬浮标签与引线在交互覆盖层绘制
```

`TerrainMap.cells`、路网、房屋、POI、库存和 Agent 状态只读。新实例存于渲染模块，不追加到 `sim.terrain.accents`，不新增 POI，不写 FABS，不保存到存档。装饰开关、画质、相机与标签布局不能调用 `applyConfig()` 改模拟配置。

### 3.2 稳定实例、采样与配方

建议内部数据形态：

```text
LandscapeGroup {
  key: "poi:<id>", recipe, recipeVersion, anchor,
  geometrySignature, children[], bounds
}
LandscapeChild {
  key: "poi:<id>/<role>/<slot>", modelKind, visualSeed,
  localTransform, footprint, bounds, stockRole
}
```

缓存键含世界生命周期 token；token 只隔离缓存，不参与视觉随机。视觉种子从已存在的世界 seed、对象 kind/id、配方固定盐值、role、slot 通过固定整数哈希派生；使用明确的无符号整数运算，不用 `Math.random()`、时间或共享 `WorldRng`。装饰与 POI ID 不混用：若复用 `AccentModel.get()`，须增加完整 key 通道或提供独立模型入口，禁止把字符串 key 强行截成可能碰撞的 accent ID。

候选按固定 role/slot 顺序生成，局部极坐标位置为 `r = sqrt(lerp(rMin², rMax², u))`、`theta = 2πv`，变换至世界坐标后逐点读取已有地表高程。距离、密度、尺度和上限集中在 `RENDER_CONFIG`，属于拟新增调参项。每个 slot 固定最多 K 个候选，K 是配置中的有限整数上限；拒绝后跳过该 slot，不把后续 slot 重新编号，不无限重抽，不因缺景观重生成世界。

| 配方 | 稳定骨架 | 动态可采细节 | 放置约束 |
|---|---|---|---|
| Water | 陆侧岸石、小片低草、湿润土色 | 保留原库存环/Inspector 数据 | 湿润土色是贴地色差；水面仅沿已有真实轮廓绘制，不凭 Water 名称扩张水域 |
| Wood | 少量主树 + 林缘灌木 + 林下暗部 | 局部可采枝叶/采伐细节 | 不随库存把整片森林删除；主树避开道路、房屋与交互口 |
| Berry | 不规则低灌木簇 | 果实数量或丰度 | 保留采收中心与可选图标 |
| Stone | 岩石露头 + 少量碎石 | 小范围可采面明暗 | 不能画成阻路峭壁，不修改坡度或碰撞 |
| Gold | 岩石骨架 + 局部矿脉 | 小面积矿脉丰度 | 禁止整片发光、地表扩矿或增加资源 |

丰度 `q = clamp(currentStock / maxStock, 0, 1)`，缺失、非有限值或 `maxStock <= 0` 时按无有效丰度处理，保留基础标记。使用稳定 slot 阈值映射少量细节的连续强度，骨架与候选位置不受 q 影响。库存插值只能影响画面，不回写数值；首版优先使用当前快照的无历史派生，保证相同快照重建一致。

### 3.3 最终几何遮罩：先留出操作空间，再补景观

当前基础 accents 在道路、POI 和房屋产生之前生成，因而不能仅修改 `generate_accents()` 就声称避让已经完成。本阶段在表现层、最终世界几何到达后做确定性后处理，原始 accents 数组保持不变。

1. **收集保护区**：道路使用实际车道曲线的全段采样形成胶囊带，不能只比较端点；房屋使用实际显示/占地轮廓及入口连接区；POI 使用操作中心、图标识别区及连接路段；已知岸点补独立取水走廊。不得用装饰范围反推物理占地。
2. **适配缺失几何**：S4-01 先确认前端可取得的房屋轮廓、道路采样和入口。只有包围体时用保守包围区；入口未知时保护房屋周边而非猜门朝向。保守区域造成景观偏少可以接受，不能以此改房屋或路网。
3. **空间索引**：保护区以世界平面网格分桶；查询候选足迹相交的桶，再做精确圆/多边形/线段距离检测。道路采样误差需小于留白余量并有细分上限，异常段以包围区保守保护。避免每帧执行 accents × 全道路 × 全房屋扫描。
4. **应用遮罩**：新景观先拒绝越界、水面不适配、坡面落地不可靠的候选；对已有 accents 与新景观均检查完整足迹。树干/大石足迹碰保护区则隐藏该视觉实例；灌木、草和碎石按子图元拒绝；贴地碎片按保护轮廓裁剪。阴影随被隐藏的实体/子图元同步处理。
5. **屏幕可读性补充**：树冠可从屏幕上挡住更远目标，世界平面留白不能保证标签可见。选中目标用轮廓和提示标签补偿，必要时仅降低相交前景装饰的可见度；这是一条独立表现规则，不变更拾取优先级或地图通行。
6. **重叠景观去重**：资源群和基础树草相交时按固定 `(来源优先级, groupKey, slot)` 保留，不能依赖集合遍历顺序；避让只隐藏表现，关闭景观可恢复基础装饰。

动态建房、拆房、房屋升级、道路增删及影响保护范围的几何变化都必须更新遮罩。缓存按几何字段签名/修订号失效；库存变动不触发遮罩重建。首版可在每次快照后线性比较实体签名并只重建脏桶，不依赖当前尚不存在的内核 revision 字段。

### 3.4 投影、遮挡与渲染预算

所有子图元以世界坐标落地；水平偏移后重新采样高程，不把整片资源群压在 POI 单点高度上。跨陡坡的贴地片拆小或拒绝，禁止整张贴片悬浮穿山。

立体树石按各自深度入队，不能把整片森林按中心点当作一张精灵；贴地暗部和阴影使用现有地面深度约定，不能把整群最后叠在道路、人物上方。沿用 `SimLighting` 与季相入口，模型不缓存最终光照颜色。

LOD 以投影尺寸和可见范围决定保留的细节：远景保留资源识别锚点及少量骨架，中景保留主树石，近景展开果实/矿脉。优先复用已有阈值，新阈值放配置；降级只减少视觉负载。每组候选数、每帧可见子图元数、模型缓存条目和缓存内存估算均设硬上限，具体默认值由 S4-02 样板与 S4-08 测量冻结。

### 3.5 标签布局与交互契约

先盘点 `render_world.js`、`render_agents.js` 以及其他 `fillText`/气泡入口；本轮覆盖房屋编号、拍卖/修缮提示、POI 名称/标记说明和与其冲突的状态标签。Canvas 普通文本收集成候选，禁止在实体内与标签层重复绘制。

候选包含 owner kind/id、世界锚点、屏幕矩形、文本/图标、优先级、固定备选偏移及动作目标。矩形统一采用 CSS 像素，处理 devicePixelRatio、字体加载、画布 resize；`measureText` 按字体与内容缓存。

**固定优先级**：选中 → 悬浮 → 拍卖/修缮等关键提示 → POI/营地名称 → 普通房屋编号及一般状态。相同优先级按 owner kind/id、标签 role 排序。采用屏幕网格占位：尝试原位及上/右/左/下等固定候选位置，与已接受矩形和 UI 禁入矩形冲突则尝试下一位置。候选数有界，不使用随机松弛布局。

- 普通标签无位置时省略；低缩放下同类型普通标签可按屏幕桶聚合为数量徽标。隐藏信息仍能通过实体悬浮、选中或原面板访问，不删除信息数据。
- 选中与悬浮两类不可省略。固定位置不足时使用画布可用边缘的分行提示区和引线，两者分别占位；长文本换行，窗口极小时使用可滚动提示区，保持完整内容可达。
- 普通标签延续世界遮挡，不能整体末绘而透山。可先完成屏幕布局，再在所属实体深度处绘制，限制位移范围；选中/悬浮提示是明确的交互覆盖层例外。
- 实体拾取继续使用原有对象与排序，景观子图元没有拾取实体身份。新增标签命中仅映射回 owner；聚合徽标打开只读成员列表或定位列表，不替换底层实体排序。标签未命中时回落原拾取路径。
- 微小镜头移动采用固定屏幕桶和有限滞回减少抖动；前一位置只作视觉偏好，不改变优先级，世界切换时清除。验收同时覆盖冷启动布局确定性和连续交互稳定性，不宣称不同相机历史必然逐像素一致。
- 若提示区或成员列表使用 DOM，内容一致时跳过 `innerHTML` 重建；验证按下/抬起跨刷新仍触发同一动作，遵守根 AGENTS.md §4.15。

### 3.6 缓存、失败隔离与版本处理

| 变化 | 必须更新 | 应复用 |
|---|---|---|
| READY / 成功 LOAD / REWIND / RESET 世界替换 | 所有新缓存、屏幕布局、命中表、空间索引 | 无跨世界实例缓存 |
| 静态全量数组明确为空 | 清对应景观/遮罩依赖；重建结果可以为空 | 不得保留旧集合 |
| 普通增量帧静态 section 缺席 | 按动态签名更新 | 静态事实与基础模型 |
| LOAD 失败、世界未替换 | 错误提示 | 当前世界全部有效缓存 |
| POI 库存变更 | 丰度样式与标签文本 | 局部模型、遮罩 |
| 房屋/道路几何变化 | 受影响桶、景观可见性 | 无关桶与模型 |
| 相机/画布/DPR/字体变化 | 投影、标签布局与文字测量（按需） | 世界空间骨架 |
| 季节、光照变化 | 材质、颜色、投影阴影 | 稳定局部几何 |

字符串驻留表仍以 `STR_TAB.start_index == 0` 判断重置，新缓存生命周期不得替代它。缓存淘汰后重算应恢复相同模型；世界 token 不作为存档字段。

某配方无候选、数据不足或超预算时，局部降为基础 POI 图标与库存/Inspector 信息；标签布局失败只省略普通标签。异常不得阻断模拟、改变 seed、修改道路或搬动居民。

本方案默认只变前端派生表现，不递增生成器版本、不改 FABS/存档结构版本、不新增 profile 或 random 候选。实际代码阶段仍按根规则执行应用 patch 升版；升版器修改 `SAVE_APP_VERSION` 后必须编译 WASM 并同步双副本，旧档按既有应用版本门禁处理。若后续必须增加快照字段，独立评审 `snapshot.rs → world_snapshot.rs → snapshot_bin/encode.rs → snapshot-bin.js + rustworld.js` 及枚举字典、存档影响，不能在视觉提交中顺手扩协议。

## 4. 原子任务列表与实施顺序

所有建议新接口和配置在对应任务完成后才成为实际契约。每项独立提交、独立验收；只在有证据时勾选。

| 状态 | ID | 交付物 | 直接前置 | 对应计划 |
|---|---|---|---|---|
| [x] | S4-01 | 数据适配清单与冻结基准（2026-09-13，记录见 §6） | D-B1 | 阶段四开工 |
| [x] | S4-02 | 稳定景观模型与配方基础（2026-09-13，记录见 §7） | S4-01 | TA-17 基础 |
| [x] | S4-03 | 最终几何索引、避让与动态失效（2026-09-13，记录见 §8） | S4-01、S4-02 | TA-14 |
| [ ] | S4-04 | 泉边与林地局部样板 | S4-02、S4-03 | TA-17 样板 |
| [ ] | S4-05 | 果丛、石矿、金矿配方推广 | S4-04 | TA-17 通用资源区 |
| [ ] | S4-06 | 标签候选层与基础布局 | S4-01 | TA-16 基础 |
| [ ] | S4-07 | 聚合、选中/悬浮兜底与交互回归 | S4-06、S4-04 | TA-16 收口 |
| [ ] | S4-08 | 生命周期、模拟隔离、视觉与性能总验收 | S4-03～S4-05、S4-07 | 通用 D-C 收口 |
| [ ] | S4-X1 | 山脚湖岸景观 | S4-08 + FootLake 注入器验收 | 后续条件任务 |
| [ ] | S4-X2 | 山涧瀑布景观 | S4-08 + RidgeWaterfall 注入器及供水/尺度契约 | 后续条件任务 |
| [ ] | S4-X3 | 河谷峭壁景观 | S4-08 + RiverCliff 注入器验收 | 后续条件任务 |
| [ ] | S4-X4 | 牛轭湖岸景观 | S4-08 + R0-4、OxbowLake 注入器验收 | 后续条件任务 |

依赖顺序：`01 → 02 → 03 → 04 → 05`；标签线为 `01 → 06 → 07`，07 还需 04 提供真实拥挤样板；两线汇入 08。这里表示开发依赖，不要求使用并行智能体。

### 4.1 S4-01 · 冻结接口与基准 ✅（2026-09-13，验收记录见 §6）

- [x] 读取前端指南、06 号 R.3/§19、07 号 §5.3/§6.6/§8，记录实际开工提交、应用/生成器版本、WASM SHA256、完整模拟配置和渲染配置摘要。
- [x] 输出 POI 类型映射、库存、地表高程、车道全曲线、房屋轮廓/入口、真实岸点可用性的生产者—消费者清单；缺字段明确首版降级或独立跨层任务。
- [x] 固定 T1/T2 各 12 个种子及三个样板场景（泉边、林地、密集聚落），记录场景实际 seed/tick/视图/相机/存档摘要；场景名称不能代替 seed。
- [x] 盘点文字、悬浮、实体拾取和缓存事件入口；保存改前截图及性能原始值。

**失败处理**：无法证明水面关联时采用陆侧素材；无法复现样板时补记录后再开工，不以规划中的字段充当已有接口。
**验收证据**：适配表、冻结清单、基线截图与原始性能记录；无运行时代码变更。

### 4.2 S4-02 · 景观模型与渲染接入 ✅（2026-09-13，验收记录见 §7）

- [x] 建立独立视觉 key、固定哈希、配方/slot/候选上限，模型只由静态输入派生。（`landscape-model.js`：uint32 固定哈希 × 五类配方表 × 极坐标盘采样 × 双线性高程）
- [x] 建立模型缓存与配置边界，避免 accent/POI 同 ID 撞缓存；接入生命周期清理。（`AccentModel.getByKey` 完整 key 通道 `'L#'` 命名空间；`resetCache()` 挂 `_invalidateWorldStaticCaches()` 四处）
- [x] 复用树石草、光照与季相，将各子图元及阴影分别接入深度队列；配置关态保留原画面路径。（`render_landscapes.js` + `DEPTH_LANDSCAPE(13)/DEPTH_LANDSCAPE_SHADOW(14)`；关态零入队零同步）
- [x] 登记新增文件、加载依赖和实际配置消费点。（index.html 脚本序、31 号代码地图、frontend/AGENTS.md、config.render.js 7 键真实消费）

**失败处理**：单组派生失败回退基础标记；未知模型类型跳过该子图元，不影响其他组。
**验收证据**：相同输入冷建/清缓存重建模型逐项一致；不同对象 ID 不串模型；相机与库存变化不改变候选坐标；开关不写模拟事实。

### 4.3 S4-03 · 遮罩与动态几何更新 ✅（2026-09-13，验收记录见 §8）

- [x] 构建道路全曲线、房屋、POI 和已知取水入口保护区；明确世界单位与显示像素转换。（`landscape-mask.js`：车道曲线全段采样胶囊带（8 点粗估弧长 → 目标弦距 ≤10 细分、上限 36；异常段退化端点包围圆）+ 房屋保守圆 18 + POI 操作区（poiBase*/poiMarkerFootprintR 同源键取大 + 余量）；**全部几何量为世界单位**，屏幕换算只在绘制端 camera.zoom 一次；取水走廊由连接车道胶囊覆盖）
- [x] 实现空间分桶、足迹窄相检测、有界采样和异常几何保守保护。（世界网格分桶 96 + 足迹相交桶取查 + 圆-圆/圆-线段精确测距；零每帧全量扫描）
- [x] 对新景观和已有 accents 的可见子图元应用遮罩，同步处理阴影与去重；保留源数组。（深度队列装饰段前遮罩同步；装饰命中 ∨ 可见景观重叠 → 整体隐藏且投影随同不入队；子图元判定读占据网格预判零距离计算；来源优先级：可见景观 > 基础装饰；源数组只隐藏不移除）
- [x] 通过字段签名检测建房/拆房/升级/道路变化，更新脏桶，消除全量每帧重算。（房屋/POI 集合签名逐实体 diff；车道按 geom_version+条数变化才逐条 per-lane 签名 diff——wear 不触发、空跳零重建；geomRev 驱动占据网格与 accent._lm 判定缓存，稳态零重复测距）

**失败处理**：无法可靠裁剪的子图元隐藏；索引异常降为无景观，不使用旧世界索引。
**验收证据**：弯路中段、房角、采收中心、岸边入口、动态建拆房样板；临时断言统计受保护区内违例 0，物理字段差分 0。

### 4.4 S4-04 · 泉边与林地样板 ✅（2026-09-13，验收记录见 §9）

- [x] 实现 Water/Wood 配方，验证地表高程贴合、坡面拆分、真实水面边界与交互留白。（Water 增 `wet` 湿润土贴地片（role 级半径带 30..42）；Wood 增 `shade` 林下暗部贴地片；贴地片落点格心+四缘坡度 > `landscapeGroundMaxSlopeDeg`(16°) 整片拒绝（§3.4 跨陡坡首版不拆分）；水面候选沿用四邻拒绝；交互留白由 S4-03 遮罩自动覆盖——wet 半径带起点 30 保证不被 POI 操作区误杀）
- [x] 验证林地骨架在库存 0/中间值/满值时稳定，仅可采细节变化。（Wood 新增 `foliage` 可采细节 ×3（`stockRole:'detail'`，qThreshold 构建期由 `landscapeDetailQFloor/QCeil` 区间线性映射）；临时断言 q 0/50/100 全几何逐位一致、`version()` 不变、detail 激活数 0→m→3 单调；浏览器 q 三态截图页内差分 3273px；detail 子图元不入遮罩占据网格——q 逐帧变化不触发重建也不误藏基础装饰）
- [x] 输出同一存档、相机和缩放的前后对照，覆盖普通/道路/资源视图及四季。（`evidence/S4-04/screenshots/` 19 张：seed34 泉边 zoom4/zoom8/zoom6 道路/zoom1.6 概览 + 四季（渲染读取层覆盖 `sim.currentSeason`，暂停态截图用）；seed31 林地 zoom3 ON/OFF + q 三态；季节恒 Spring 除非文件名注明）
- [x] 记录初次建模、暖缓存绘制及旋转期间的负载，冻结首版配方数目和尺度。（§9.3 性能首测：冷建 sync 0.7~1.2ms、首帧含个体模型冷建 18.9~50.1ms；景观链增量林地静 p95 2.7ms 达标、旋转/泉边 3.2~4.0ms 略超参考值——已按 §4.4 失败处理做零 GC 优化（贴地片填充样式预建常量），余差归 S4-08 正式设备复测；配方冻结见 §9.4）

**失败处理**：水体关系不明只展示陆侧点缀；预算超限先减枝叶细节与覆盖范围，再复测。
**验收证据**：至少近景泉边、近景林地两套可复现场景；取水/采木入口可选，资源数据与原 Inspector 一致。

### 4.5 S4-05 · 其余通用资源配方 ✅（2026-09-14，验收记录见 §10）

- [x] 分别交付 Berry、Stone、Gold 配方；复用采样、遮罩、库存丰度和绘制公共入口。（配方 v3（RECIPE_VERSION 2→3）：Berry +`fruit` 果实点簇 ×2（tone 'berry'）、Stone +`quarry` 可采面明暗 ×1、Gold +`vein` 矿脉斑点 ×2——三者均为 `stockRole:'detail'` 的 GroundPatch，完整复用 S4-04 的极坐标采样/坡度拒绝/遮罩脏桶/`childActive` 机制与 `drawLandscapeGroundPatch` 绘制入口；点簇几何构建期预计算 `child.dots`（10 点归一化偏移，r=sqrt 盘分布），q 只驱动**绘制期**可见点数 `round(n×q)` 与 quarry 的 globalAlpha——连续强度单调，绝不参与几何重抽；gold 哑光矿脉斑**严禁发光**）
- [x] 验证果实、矿脉细节的单调丰度关系与缺失值处理，禁止库存影响几何重抽。（临时断言 23 组：0/半/满全子图元几何逐位一致且 `version()` 不变；detail 激活数 0 ≤ 半 ≤ 满、0 时全隐；可见点数随 q 单调不减；q 缺失/maxStock≤0/NaN → detail 全隐骨架保留；浏览器 Berry/Stone/Gold 满与零态页内像素差分 5963/5163/8251px）
- [x] 验证邻接资源区与基础 accents 的去重，资源中心始终可辨认。（邻接组 Berry#23 ↔ Water#13 相距 51.8m 共享车道走廊 → 两 Group 子图元分别 4/9、4/8 被遮蔽（遮罩机制正常）；detail 子图元不入占据桶不误藏基础装饰（S4-04 语义沿用）；fruit 内缘距 POI 中心 25 > 操作区半径 18——采收中心与图标恒无遮挡）

**失败处理**：某配方失败只关闭该配方；不阻塞已通过的泉水/林地样板。
**验收证据**：每类至少一组 seed/tick 固定截图，0/半满/满库存临时夹具，界面库存及物理状态不变。

### 4.6 S4-06 · 标签基础布局

- [ ] 抽离本轮文字入口，建立候选/字体测量/矩形/优先级/固定备选位置接口。
- [ ] 实现屏幕网格冲突检测、UI 禁入矩形、普通标签省略，保证算法候选数有界。
- [ ] 区分普通世界标签与交互覆盖标签，保留普通标记的地形遮挡行为。
- [ ] 适配 Canvas DPR、缩放、旋转、resize 与字体变更，移除旧入口的重复文字。

**失败处理**：普通标签无合法位置即省略，保留实体与信息面板访问。
**验收证据**：固定输入下接受顺序稳定、普通已接受矩形互不相交；山后普通标签不透山，原实体命中顺序不变。

### 4.7 S4-07 · 聚合与交互兜底

- [ ] 实现同类普通标签聚合、成员信息入口和从标签到 owner 的动作映射。
- [ ] 实现选中/悬浮双目标强制保留、引线、边缘分行兜底；标签不得落在 Inspector 等覆盖区后面。
- [ ] 验证悬浮切换、点击、拖拽、Inspector 关闭、镜头跟随及高频刷新；需要 DOM 的区域增加内容快照缓存。
- [ ] 增加有限布局滞回，验证缓慢平移时不高频左右跳位，选择优先级不被旧布局锁死。

**失败处理**：聚合无足够位置可省略普通徽标；选中/悬浮转兜底提示区，不能静默丢失。
**验收证据**：密集聚落、画布边缘、小窗口、选中与悬浮不同对象、按下/抬起跨帧场景；全部动作指向正确 owner。

### 4.8 S4-08 · 通用阶段收口

- [ ] 执行第 5 节完整矩阵，记录首帧与暖缓存性能、物理差分和生命周期结果。
- [ ] 清理临时断言/夹具/测试脚本，保留可复现证据摘要；不提交持久化单元测试。
- [ ] 更新现状地形与前端机制文档、受影响局部 AGENTS、代码地图与实际代码版本 changelog；规划中只勾选真实完成项。
- [ ] 将 06 号 §19 的通用 D-C 状态与 07 号 TA-14/16/17 的对应子项同步；房屋院地和特定地貌仍分别登记。

**失败处理**：确定性/交互失败先修复；性能超预算优化并复测，不移动冻结基准消除差异。
**验收证据**：任务、产物版本、配置、场景、命令、原始数值、截图链接齐全。通用 D-C 收口不等于所有专项景观已交付。

### 4.9 S4-X1～X4 · 条件景观任务模板

每个任务独立记录注入器版本与有效世界验收证据，依次完成：

- [ ] 核对真实 feature/subFeature 关联、闭合轮廓/折线、高程、水体及资源池语义；仅选择器命中不算前置完成。
- [ ] 为该地貌定义配方、保护区和尺度；未关联采水 POI 的湖面不生成取水入口或储量标签。
- [ ] 复用通用模型、遮罩与缓存；瀑布先证明 source—basin/供水关联，峭壁只强化已有地貌轮廓。
- [ ] 通过专项近/远景、季相、遮挡、换世界、性能与物理不变验收，再单独勾选。

缺少前置时维持待办，不注册空配方冒充交付，不为了景观在阶段四补做湖泊/瀑布/峭壁注入器。

## 5. 验收矩阵与发布门禁

### 5.1 冻结场景与量化标准

物理差分固定种子建议沿用 `1,2,3,7,42,100,123,456,789,1024,2026,65535`，显式 T1/T2 各跑一组；开工若已有其他正式支持的 profile，另补覆盖，不改变 random 候选。视觉样板种子由 S4-01 实际筛选记录，禁止把“泉边场景”当作固定种子。

| 维度 | 覆盖范围 | 通过条件 |
|---|---|---|
| 模拟隔离 | 基准/候选构建，同配置、seed，创世与相同推进 tick；景观/标签开关两态 | 高程、地表、水系、POI、路网、房屋、Agent、库存及账本事实差分 0；跨构建忽略应用版本封装，不忽略物理字段 |
| 稳定派生 | 冷建、缓存清空、库存改变、相机改变、同 seed 再创世 | 静态模型、slot、坐标和 key 相同；库存只变动态细节 |
| 避让 | 弯路、房角、窄岸、相邻 POI、建拆房和升级 | 保护区内禁入视觉足迹违例 0；源 accents 与模拟对象未修改 |
| 生命周期 | READY/成功与失败 LOAD/REWIND/RESET；同 profile 同 ID 换世界；非空→空 | 旧景观/遮罩/标签命中残留 0；缺席静态 section 不误清 |
| 标签 | 密集聚落、边缘、小窗口、DPR 变化、选中/悬浮双目标 | 普通接受矩形冲突 0；双目标完整可达；动作 owner 正确；普通标签不透山 |
| 可观察场景 | Water/Wood/Berry/Stone/Gold；普通/道路/资源视图；近中远景、四季、旋转 | 类型可辨、入口可见可选、无假水域/假资源/悬浮贴片 |
| 性能 | 同设备、浏览器、视口/DPR、seed/tick、相机和配置，关闭/开启对照 | 新增地表/装饰整条绘制链 p95 增量 ≤ 3ms；参考桌面主线程渲染与 UI p95 ≤ 16ms |

性能计时包括模型更新、遮罩、投影、标签测量/布局、入队、排序、绘制与相关 UI；同时单列景观增量和标签增量，不能只测 `drawAccentEntity()`。建议每场景预热 300 帧、采样 1800 帧、重复三轮，保留两端 p50/p95/p99 与差值；这是本方案的采样流程，实际设备信息和结果由验收填写。

重置/读档首帧及缓存重建单独报告 p95，不混入暖缓存分布；记录缓存条目/估算内存、可见图元数、保护区候选检测数，并证明连续换世界不会累积增长。超标先减低优先级标签、微细节和可见图元，再优化脏区重建；预算调整遵循 07 号 §11.3，不直接改大数字判通过。

### 5.2 代码阶段适用命令

每个代码提交按 [开发工作流](docs/current/tech/30-workflow.md)选择门禁。应用升版导致 `SAVE_APP_VERSION` 改动时，需先完成编译与双副本同步，再验证最终产物：

```bash
node tools/bump-version.js --patch
cargo test --lib
cargo build -p sim_wasm --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/sim_wasm.wasm frontend/rust/sim_wasm.wasm
cp target/wasm32-unknown-unknown/release/sim_wasm.wasm frontend/sim_wasm.wasm
node tools/test-wasm.js
node tools/test-determinism.js
node tools/config-check.js
node tools/frontend-check.js
node tools/doc-maintenance-check.js
node tools/cross-doc-check.js
node tools/doc-link-check.js
node tools/code-map-check.js
node tools/bump-version.js --check
git diff --check
```

若修改快照另跑 `node tools/snapshot-check.js`，发布前追加文档维护 `--strict`。通用门禁不能替代跨构建物理差分、标签点击与视觉/性能验收。

浏览器验证优先 Chrome，先建立真实本地存档并确认能推进模拟；使用已有 3004 服务，勿重复启动。跨应用版本的前后对照不能直接加载被门禁拒绝的旧档：在各自构建加载各自兼容存档或用同 seed/config 推进到同 tick，记录摘要；同构建视觉开关对照使用同一存档。

### 5.3 证据记录模板与完成定义

每项完成时追加：

```text
任务 ID / 状态 / 日期：
基准提交 / 候选提交 / 应用版本：
WASM 双副本 SHA256 / 模拟配置 SHA256 / 渲染配置摘要：
profile / seed / tick / 存档摘要 / 相机 / 视图 / 季相：
设备 / Chrome 版本 / 视口 / DPR：
执行门禁、退出码及日志位置：
物理差分 / 模型确定性 / 避让违例 / 标签与命中检查：
基准与候选 p50/p95/p99 / 首帧与缓存重建 / 缓存规模：
截图与原始记录路径：
失败项、降级与后续任务：
```

**通用阶段四完成**：S4-01～S4-08 全部通过；五类资源景观、动态避让和标签交互均有证据；性能达标；模拟不变；文档同步。S4-X1～X4 按各自前置逐项退出，保持未完成状态不会伪装成通用阶段阻塞。

本文本身是纯规划交付，不执行以上实施命令、不升版、不追加代码版本 changelog；本次只执行文档检查。

## 6. 验收记录 · S4-01 数据适配清单与冻结基准（2026-09-13）

> 无运行时代码变更；所有证据存于 `evidence/S4-01/`（配置快照 / 种子筛选原始数据 / 冻结存档 / 基线截图 / 性能原始值）。临时筛选脚本已按根 AGENTS.md §4.10 用后删除。

### 6.1 冻结基线信息

| 项 | 值 |
|---|---|
| 实际开工提交 | `a6623a6`（分支 `c4`，Merge master into test；本文 §头部记录的复核基线 `7e0f8b7` 之后 master 并入了 S7-04 半坡林地 v1.50.46） |
| 应用版本 / 生成器版本 | `1.50.46` / **6**（★ 偏差记录：本文头部写「生成器版本 5」是 7e0f8b7 基线的历史值，实际开工 HEAD 的 `TERRAIN_GENERATOR_VERSION`（crates/sim_core/src/geo/terrain.rs:708）已为 6，本阶段开工以 6 为准；存档结构版本 7 不变） |
| WASM 双副本 SHA256 | `frontend/rust/sim_wasm.wasm` = `frontend/sim_wasm.wasm` = `75de958cc677d3affe6a56da4c54ba39e40653312c26b2097f3e456f23f3f732` |
| 模拟配置 | `SIM_CONFIG` 239 字段（config.js + decision-order + house-upgrade-cost 合并后），SHA256 `94b8446650b42cd1c3ac99fc2755e528db74139e635181b0d76d575e5ddbfbfa`，全文 → `evidence/S4-01/sim-config-frozen.json` |
| 渲染配置 | `RENDER_CONFIG` 59 键，SHA256 `4bd29400b09bf3f54724cfcbc65801288a602bf23154d6a839f8fa649c70a04e`，全文 → `evidence/S4-01/render-config-frozen.json` |
| 快照 | FABS FORMAT_VERSION=3，section 清单与增量缺席语义见 §6.2 第 7 行 |

### 6.2 生产者—消费者适配清单（S4-02/S4-03 按此施工）

| # | 数据 | 生产者（唯一来源） | 前端可获得性 | 缺口 → 首版策略 |
|---|---|---|---|---|
| 1 | POI 类型/坐标/库存 | POI section（u8 码位 → `dict.rs::poiType` 表 → 前端 `poiTypeMap`），`rustworld.js:712-752` | `window.sim.pois`，字段 `id/type/pos{x,y,z}/currentStock/maxStock/regenRate/…`；**每帧全量重建对象**，须按 id+字段签名判断变更（§2 要求） | POI 无半径/朝向/占地字段 → 操作区半径沿用 `RENDER_CONFIG.poiBase*`/`poiMarkerFootprintR`，新半径进配置 |
| 2 | 地表高程 | TERRAIN section：`GeoCell{elevation, slope_angle, surface_kind, natural_fertility, water_body_id, feature_flags}` + GLOBAL `grid_w/grid_h/world_size`（120×120 / 764） | `sim.terrain.cells` 行主序（`idx=gy*w+gx`，世界坐标换算 `rustworld.js:637-641`）；**无点查询导出** | S4-02 自行双线性插值（索引换算参考 `render_depth_queue.js:96-107`）；跨陡坡贴地片按 §3.4 拆小/拒绝 |
| 3 | 真实水面/岸点 | ① `featureFlags` **SHORE_ACCESS=1<<2**（hydrology.rs 给河岸格打标，已随快照下发、前端零消费）；② River 特征「左岸 N 点顺去+右岸 N 点逆回」闭合真水面轮廓（TERRAIN_FEATURES section，render_terrain.js::drawRiverBand 消费）；③ `surface_kind` ShallowWater/DeepWater/RiverBank | 前端从未消费 SHORE_ACCESS；River vertices 可直接用 | **`waterAccessPoint` 字段不存在**（全仓 grep 仅 POI 命名「河岸取水点 #id」）→ 按 §2 数据缺口降级：首版只画陆侧低草与岸石、不画新泉池；岸线留白以 SHORE_ACCESS 掩码 + River 轮廓距离为准 |
| 4 | 车道全曲线 | LANE_GEO section `LaneSnapshot{p0..p3 三次贝塞尔带 z}`，`geom_version` 缓存（`rustworld.js:794-833`） | `sim.network.lanes` 每条 `lane.curve.evalPos(t)`（`makeBezierCurve`，rustworld.js:1083）可任意密度采样 | 车道无宽度字段（渲染线宽由 wear 阈值映射）→ S4-03 胶囊半径走 RENDER_CONFIG |
| 5 | 房屋轮廓/入口 | HOUSE section 仅 `pos/tier/…`；前端 `drawHouse` 用 tier→hw/hh **硬编码视觉几何**（render_world.js:163-164），门洞是正面装饰 | 只有锚点 + tier | 无占地/入口朝向字段 → 首版按 tier→hw/hh 保守包围区 + 房屋周边留白（§3.3 第 2 条「入口未知不猜朝向」）；如需真实字段另拆跨层任务（快照四处同步） |
| 6 | 基础 accents（去重源） | TERRAIN_ACCENTS section `{id, kind∈Tree/Bush/Boulder/RockCluster/GrassTuft, x,y,z, scale, rotation, tint}` | `sim.terrain.accents`（静态三通道缓存语义） | 实测基础装饰**不围绕 POI 生成**（80 种子筛选：全图 Tree 恒 40、Wood POI 60m 内树数 0）→ 资源景观与基础装饰重叠有限，去重仍按 §3.3 第 6 条 `(来源优先级, groupKey, slot)` |
| 7 | 生命周期/缺席语义 | READY / LOAD_RESULT(成功) / REWIND_RESULT(成功) / RESET_DONE 四消息 → `_invalidateWorldStaticCaches()`（rustworld.js:306-310：`_terrainCached=false` + `AccentModel.resetCache()`）；**无 DOM 事件** | 新缓存只能挂这四处或拦消息语义 | 静态 section「缺席=null 保留旧值 / 数组（可空）=显式替换」须 `Array.isArray` 判定；`terrain_cells` 无地形帧为 `[]`；`STR_TAB.start_index==0` 只管驻留表 |
| 8 | seed/版本 | `sim._engineSeed`（READY 回传覆盖）、`sim.terrain.generatorVersion/profile`、`sim.getAppVersion()` | 可直接读 | — |

### 6.3 文字 / 悬浮 / 拾取 / 缓存入口盘点（S4-06/S4-07 按此抽离）

- **世界画布文字共 10 处**（S4-06 抽离范围）：`drawPoiMarker` 营地图标(:93)/营地名称(:98)/舍数(:102)/资源图标(:120)；`drawHouse` 拍卖(:245)/修缮(:250)/编号(:256)；`drawAgent` 施工(:45)/流产(:74)/选中需求气泡(:143-159)/夺位(:185)。`render_hud.js` 气候预测图画在独立 canvas，不参与世界遮挡、不在本轮范围。LOD 阈值现为三处硬编码（POI 名称 z>0.50 / 库存环 z≥0.70 / 房屋编号 z>1.05），S4-06 收进 RENDER_CONFIG。
- **悬浮**：仅道路 `updateLaneHover`（render_world.js:302，12 段采样 + `#road-hover-tooltip` 每帧 innerHTML 重建，无内部可点元素）；实体无悬浮预览路径。
- **拾取**：`render_inspector.js:1411` click 监听（拖拽 >8px 排除）——屏幕坐标欧氏命中 agent≤25px / house≤24px / poi≤26px，收集序硬编码 agent→house→poi、agent 内部按距离排序、±16px `clickCycle` 轮转；拾取用 `project3D`（无 MAP_Z_LIFT），与渲染锚点（`projectLifted`）存在细微不一致——S4-07 标签命中映射须与原拾取对齐并回落。
- **深度队列**：`render_depth_queue.js::drawWorldEntities()`（DEPTH_* 0..12，`_depthPool` 对象池，depth 升序稳定排序，分发循环 :422-439 结束点即 S4-06 标签层的天然挂载位）。

### 6.4 冻结种子与样板场景

**物理差分种子**（沿用 §5.1，后续任务执行时 T1 `mountain_pass_v1` / T2 `river_valley_v1` 各跑一组）：`1,2,3,7,42,100,123,456,789,1024,2026,65535`。

**三样板场景**（无头筛选 0..79 共 80 种子，原始数据 `evidence/S4-01/seed-screening-raw.json`；浏览器实测复核 POI 布局与无头一致）：

| 场景 | seed | profile | tick | 相机（rotX 1.05 / rotZ 0.6 恒定） | 世界摘要 | 证据 |
|---|---|---|---|---|---|---|
| 泉边 | 34 | river_valley_v1 | 0（创世暂停） | zoom 4.0，中心 = Water#11 (26.13, -162.35, z2.39) | 20 人 0 房；该水点 45m 内岸带 36 格，近旁特征 River×1 + SpringValley×1 + ShallowFord×2 | `screenshots/baseline-spring-seed34-tick0-zoom4.png` |
| 林地 | 33 | mountain_pass_v1 | 0（创世暂停） | zoom 3.0，中心 = Wood#30 (40.97, 236.29, z4.89) | 20 人 0 房；Wood#30 45m 内 100% 可落位（无 NO_BUILD/NO_WALK/陡坡格） | `screenshots/baseline-woodland-seed33-tick0-zoom3.png` |
| 密集聚落 | 65 | mountain_pass_v1 | 存档冻结 160000（截图时 161900） | zoom 1.6，中心 = 房屋质心 (87.6, -76.5) | 12 房 50 人；质心 200m 内 8 房；仙居村已升村 | 存档 `saves/s4-settlement-seed65-t160000.json`（SHA256 `46a3d3d89d339858619a31339e101e7122cdf38ddb1e1ef262b19cad49d7e6eb`，2714686 字符）+ `screenshots/baseline-settlement-seed65-t160314-zoom1.6.png` |

聚落复现流程：创世 seed 65 → 推进 160000 ticks → `loadWorld(存档 JSON)`（存档自含配置；浏览器侧临时复制存档到 `frontend/` 供 fetch，用后删除）。两创世场景复现：URL `?seed=<n>`（**不能用 seed 0**，见 §6.6）+ 门禁态天然暂停。

### 6.5 改前性能原始值（method + p50/p95/p99）

方法：包装全局 `render` 绑定计 `performance.now()` 差值（含地形格/深度队列排序/实体绘制全链）；预热 300 帧后采样 900 帧；模拟运行中；场景相机同 §6.4。设备：Chromium 146（ZCode IAB，macOS arm64）、视口 1280×720 CSS、DPR 1。全文 → `evidence/S4-01/perf-baseline.json`。

| 场景 | tick 区间 | render p50 | render p95 | render p99 | render max | 帧间隔 p50/p95 |
|---|---|---|---|---|---|---|
| 泉边 seed34 | 582→3118 | 4.1ms | 5.8ms | 6.7ms | 10.8ms | 16.7 / 16.8ms |
| 林地 seed33 | 564→4154 | 4.5ms | 6.3ms | 7.3ms | 9.3ms | 16.7 / 16.8ms |
| 密集聚落 seed65 | 161900→164790 | 11.2ms | 15.6ms | 17.3ms | 19.4ms | 16.7 / 17.2ms |

注：实测帧间隔 p50≈16.7ms，当前主循环实际以 60FPS 运行（`render_canvas.js` TARGET_FPS=30 的节流在该路径未生效），基线如实记录；S4-02+ 的性能对照须用同方法、同场景、同相机复测（§5.1），增量口径以本表为基准。

### 6.6 本次新发现的坑（后续任务必须遵守）

1. **种子 0 在浏览器不可用**：`sim_worker.js` INIT/RESET 处理器 `_engineSeed = msg.seed || Date.now()`——0 为假值被吞，`?seed=0`、`initEcology(20, 0)`、RESET 消息三种入口均实际生成随机种子（前端 `sim._engineSeed` 仍显示 0，具有欺骗性）。样板场景与测试夹具禁用 seed 0；若需修此缺陷另立内核外任务，不在视觉阶段顺手改。
2. **`world_save_ptr()` 必须先于 `world_save_len()` 调用**（对齐 `tools/test-wasm.js::saveToString`）：反序会拿到旧长度导致存档 JSON 截断（本次实测踩坑并重导）；tick 0 时反序甚至得到 0 字节。
3. **POI 类型字符串是全名**：快照解码后为 `WaterSource/WoodForest/BerryBush/StoneQuarry/GoldMine/Market/Camp`，前端 `poiTypeMap` 才归一为 `Water/Wood/…`；写派生层配方表时须明确用哪一层。
4. **UI 遮挡自动化截图**：门禁浮层用样式表 `#startup-save-gate{display:none !important}` 压制（!important 规则压过 save-ui 定时器写的内联样式，一次注入永久生效）；左右面板/顶栏/事件流分别隐藏 `.top-bar/.global-resource-panel/.right-panel-stack/.control-panel/.event-log`。

### 6.7 执行门禁

S4-01 无运行时代码变更（仅本文件 + `evidence/S4-01/` 证据），按工作流 §G 只执行文档检查：`doc-maintenance-check` / `cross-doc-check` / `doc-link-check` / `bump-version.js --check`（结果见提交时记录；纯文档不升版）。

## 7. 验收记录 · S4-02 稳定景观模型与配方基础（2026-09-13）

> 按 §5.3 模板记录。临时 Node 验收断言（26 组）已按根 AGENTS.md §4.10 用后删除，不持久化。

```text
任务 ID / 状态 / 日期：S4-02 / ✅ 完成 / 2026-09-13
基准提交 / 候选提交 / 应用版本：基准 56eac2e（分支 c2）/ 候选 = 本次提交 / 1.50.47（升版器 12 定义点同步）
WASM 双副本 SHA256：frontend/rust/ = frontend/ = bac0e1a80db9fc5d57e319aa4d3e6e62626c621c4a0d38523a99fcaf49600c31（升版 SAVE_APP_VERSION 后重编译，双副本同值）
模拟配置 SHA256 / 渲染配置摘要：SIM_CONFIG 239 字段未变（S4-01 冻结基线 94b84466… 仍有效）；RENDER_CONFIG 59 → 64 顶层键（新增 landscapeEnabled/StyleVersion/CacheMaxGroups/FrameChildBudget + landscapeRecipes 五类配方表，7 键段）
profile / seed / tick / 存档摘要 / 相机 / 视图 / 季相：临时 Node 夹具（6×6 地形 + 5 类资源 POI + Camp/Market 反例；seed 34/777）——本任务为模型层基础验收，浏览器视觉样板归 S4-04（泉边/林地）与 S4-05，性能对照按 §6.5 方法从 S4-04 起执行
设备 / Chrome 版本 / 视口 / DPR：Node v24.20.0（无头逻辑验收）；浏览器验证未在本任务范围
执行门禁、退出码及日志位置：cargo test --lib 0 失败；cargo build wasm release 通过；test-wasm ALL_TESTS_DONE；test-determinism 6/6 全通；config-check 239/239 + 空转参数门禁通过；frontend-check 全过；doc-link-check 682 链接 0 失效；cross-doc-check 0 冲突 0 漂移；code-map-check 退出码 0（仅余 3 个与本次无关的既有 docs 未登记警告）；doc-maintenance-check 退出码 0；bump-version --check 12 定义点零漂移；git diff --check 干净
物理差分 / 模型确定性 / 避让违例 / 标签与命中检查：物理差分 0（零内核逻辑变更，仅 SAVE_APP_VERSION 常量）；模型确定性 26/26（冷建=签名命中=清缓存重建逐项一致、全子图元 visualSeed 两两不重、getByKey 与 accent 键空间隔离、库存变化几何零重建仅 q 刷新、相机变化候选坐标不变、不同世界 seed 种子隔离）；避让违例不适用（S4-03 遮罩任务）；标签不适用（S4-06/07）
基准与候选 p50/p95/p99 / 首帧与缓存重建 / 缓存规模：本任务未做浏览器性能对照（无基准可比较的绘制链变更量级，归 S4-04 首次实测）；缓存规模上限已配置（组 ≤256、每帧子图元 ≤420、AccentModel 共享池 ≤2048）
截图与原始记录路径：无（视觉前后对照自 S4-04 起）；临时断言输出随验收会话留存、脚本已删
失败项、降级与后续任务：验收中发现并修复 1 项——sync 签名命中路径原先依赖 sim 实例同一性才刷新丰度，已改为无条件刷新（签名相同即同一静态世界）；无遗留失败。后续：S4-03 道路/房屋/POI 操作区遮罩（本阶段候选生成尚无几何避让，道路/房旁出现景观子图元属既定中间态）；S4-04 Water/Wood 配方样板与视觉验收（含库存丰度动态细节、坡面拆分）；S4-05 Berry/Stone/Gold 推广。
```

**S4-02 交付边界说明**：本任务交付的是 §3.2 数据形态与派生流水线（稳定 key → 固定哈希 → 配方 slot 候选 → 高程落地 → 组缓存 → 深度队列/阴影/关态回退），五类配方的视觉参数（密度/尺度/半径带）为首版可用值，将在 S4-04/S4-05 样板验收时按 §4.4「冻结首版配方数目和尺度」调整；`stockRole` 恒为 `'skeleton'`，可采细节角色（果实/矿脉/可采面）由后续任务引入。

## 8. 验收记录 · S4-03 遮罩与动态几何更新（2026-09-13）

> 按 §5.3 模板记录。临时 Node 验收断言（两轮 50 + 24 组）已按根 AGENTS.md §4.10 用后删除，不持久化。

```text
任务 ID / 状态 / 日期：S4-03 / ✅ 完成 / 2026-09-13
基准提交 / 候选提交 / 应用版本：基准 541fb9c（分支 c2）/ 候选 = 本次提交 / 1.50.48（升版器 12 定义点同步）
WASM 双副本 SHA256：frontend/rust/ = frontend/ = 2e4a0eb87b2fe918f727f5b0ffebfc386bd4a448daab6613d42b6c0e50884673（升版 SAVE_APP_VERSION 后重编译，双副本同值）
模拟配置 SHA256 / 渲染配置摘要：SIM_CONFIG 239 字段未变（S4-01 冻结基线 94b84466… 仍有效）；RENDER_CONFIG 64 → 71 顶层键（新增 landscapeMaskEnabled/BinSize/LaneRadius/LaneSamples/HouseRadius/PoiExtraRadius/Margin 7 键，全为世界单位）
profile / seed / tick / 存档摘要 / 相机 / 视图 / 季相：临时 Node 夹具（61×61 地形 + 水面补丁 + Wood/Water/Berry POI + 强弯车道 t=0.5 恰穿 Wood 环带 + 取水直路 + 安全点房屋；seed 42）；浏览器冒烟 = Chromium IAB @ localhost:3002 新世界（启动存档门禁暂停态），镜头手动渲染对准资源区
设备 / Chrome 版本 / 视口 / DPR：Node v24.20.0（无头逻辑验收）+ Chromium IAB（visual 冒烟）；性能对照按 §6.5 方法从 S4-04 起执行
执行门禁、退出码及日志位置：cargo test --lib 0 失败；cargo build wasm release 通过 + 双副本同步；test-wasm ALL_TESTS_DONE；test-determinism 6/6 全通；config-check 239/239 + 空转参数门禁通过；frontend-check 全过（38 script）；doc-link-check 0 失效；cross-doc-check 0 冲突 0 漂移；code-map-check 退出码 0（仅余 3 个与本次无关的既有 docs 未登记警告）；doc-maintenance-check OK=17；bump-version --check 12 定义点零漂移；git diff --check 干净
物理差分 / 模型确定性 / 避让违例 / 标签与命中检查：物理字段差分 0（sync + 全量查询前后 sim 串化逐位一致，跳过 _ 表现缓存；零内核逻辑变更）；确定性 = 独立沙盒同输入子图元 key 与遮蔽判定逐项一致、40 探测点命中逐位一致；避让违例 = 全保护区真几何期望值逐点对拍（~3450 探测点 × 双足迹）违例 0 / 保护区外无误伤 0，弯路中段/房缘 25 隐藏 33 可见/采收中心 22 隐藏 30 可见/取水走廊全部命中；标签不适用（S4-06/07）
基准与候选 p50/p95/p99 / 首帧与缓存重建 / 缓存规模：本任务未做浏览器性能对照（遮罩为查表判定，稳态每帧每实体零重复测距；归 S4-04 首次实测）；缓存规模 = 保护区 zone 有界（浏览器实测 238 车道 + 23 POI + 房屋动态）、占据网格 ≤ 景观子图元总数
截图与原始记录路径：浏览器冒烟为会话内画布导出目检（无树上路/图标无遮挡/图元无异常），未持久化；临时断言输出随验收会话留存、脚本已删
失败项、降级与后续任务：验收中发现并修正 2 项——① 车道采样密度：28 上限下强弯段（曲率半径 ~128）弦差超容忍，改为 8 点粗估弧长 + 目标弦距 ≤10 + 上限 36 后违例清零；② POI 操作区半径：首版误用深度辅助半径 poiMarkerFootprintR(20) 致资源环内圈整环误杀（可见子图元占比跌至 ~33%），改为 max(底座半径, 图标世界尺寸 12) + 余量后恢复 73%，并在文档登记「poiMarkerFootprintR 严禁用作保护半径」；无遗留失败。浏览器冒烟：238 车道区 + 23 POI 区实建、117 子图元遮蔽 65、157 基础装饰遮蔽 63、关景观全恢复（休眠 0 遮蔽）重开精确还原，零渲染异常。后续：S4-04 Water/Wood 样板视觉验收与性能首测（§6.5 方法）；S4-05 Berry/Stone/Gold 推广；树冠遮挡标签的屏幕可读性补偿归 S4-06/S4-07。
```

**S4-03 交付边界说明**：本任务交付的是 §3.3 遮罩语义（保护区收集 → 网格分桶 → 脏桶失效 → 隐藏与去重），**不做子图元内部裁剪**（无法可靠裁剪的实例按整体隐藏处理，符合 §4.3 失败处理条款）；遮罩半径/密度为首版保守值，S4-04/S4-05 样板验收时可经 RENDER_CONFIG 微调；车道保护不区分 wear 可见性（低磨损路当前不可见但会随通行变清晰，前瞻保护符合「道路增删必须更新遮罩」语义）。

## 9. 验收记录 · S4-04 泉边与林地样板（2026-09-13）

> 按 §5.3 模板记录。临时 Node 验收断言（29 组）已按根 AGENTS.md §4.10 用后删除，不持久化。

### 9.1 验收记录正文

```text
任务 ID / 状态 / 日期：S4-04 / ✅ 完成 / 2026-09-13
基准提交 / 候选提交 / 应用版本：基准 515e6d1（分支 c2）/ 候选 = 本次提交 / 1.50.49（升版器 12 定义点同步）
WASM 双副本 SHA256：frontend/rust/ = frontend/ = b501d638060db149a07cc93bdfd58965b014c10bfaa8237b441b32c5385f3877（升版 SAVE_APP_VERSION 后重编译，双副本同值）
模拟配置 SHA256 / 渲染配置摘要：SIM_CONFIG 239 字段未变（S4-01 冻结基线 94b84466… 仍有效）；RENDER_CONFIG 71 → 75 顶层键（新增 landscapeDetailQFloor(0.2)/QCeil(0.85)/landscapeGroundMaxSlopeDeg(16)/landscapeGroundWinterAlphaRatio(0.6) 4 键；landscapeRecipes 配方表 v2——Water +wet、Wood +shade +foliage）
profile / seed / tick / 存档摘要 / 相机 / 视图 / 季相：泉边 = seed 34 / river_valley_v1 / tick 0（创世暂停，沿用 §6.4 冻结场景），相机 rotX 1.05 / rotZ 0.6 / zoom 4，中心 Water#11 (26.13, -162.35)；林地 = seed 31 / mountain_pass_v1 / tick 0，zoom 3，中心 Wood#30 (43.46, 118.56)（★ 场景偏差：§6.4 冻结的 seed33/Wood#30 实测被多条车道穿林，主树/贴地片/细节全部落入保护区（遮罩行为符合 §3.3 规范，最近车道距离 1.8~15.2），经 12 种子 Wood 组可见度筛选改用 seed31/Wood#30（9/14 可见、四类角色齐全），S4-01 冻结表不改动、以本条为准）；四季 = 渲染读取层覆盖 sim.currentSeason/seasonProgress（暂停态截图专用，不落存档）
设备 / Chrome 版本 / 视口 / DPR：Chromium IAB（ZCode 内嵌，win32）视口 1280×720 CSS / DPR 1；★ 设备偏差：整帧渲染 p50 ~16ms，比 §6.5 参考设备（macOS IAB，4.1~4.5ms）慢 ~3×，绝对值不作达标判据，以同设备开/关差分与景观链独立增量为口径
执行门禁、退出码及日志位置：cargo test --lib 0 失败；cargo build wasm release 通过 + 双副本同步；test-wasm ALL_TESTS_DONE；test-determinism 6/6 全通；config-check 239/239 + 空转参数门禁通过；frontend-check 全过；doc-link-check / cross-doc-check / code-map-check / doc-maintenance-check / bump-version --check 12 定义点零漂移；git diff --check 干净
物理差分 / 模型确定性 / 避让违例 / 标签与命中检查：物理字段差分 0（sync + childActive + childHidden 前后 sim 串化逐位一致，跳过 _ 表现缓存；零内核逻辑变更）；模型确定性 29/29（高程贴合=全部子图元 z 与独立双线性实现 1e-9 内全等、坡面拒绝=贴地片格心+四缘全 ≤16°、水面边界=Water 组全子图元陆侧、清缓存重建与独立沙盒逐项一致、缺省回退表与 config.render.js 逐位一致、物理差分 0）；避让违例 = wet 贴地片取水走廊遮蔽与逐点真几何期望全等、POI 操作区遮蔽对 detail 照常生效；标签不适用（S4-06/07）
基准与候选 p50/p95/p99 / 首帧与缓存重建 / 缓存规模：见 §9.3（本表不重复）；缓存规模 = seed34 实测 18 组 / 133 子图元（wet 10、shade 6、detail 9），遮罩 180 车道区 + 23 POI 区、72/133 子图元遮蔽；seed31 林地组 14 子图元
截图与原始记录路径：evidence/S4-04/screenshots/ 19 张（泉边 zoom4 ON/OFF + 四季、zoom8 湿土 ON/OFF/冬季、zoom6 道路 ON/OFF、zoom1.6 概览 ON/OFF；林地 zoom3 ON/OFF、zoom8 q 三态）；库存款 q 操作经渲染配置阈值（表现层），未改动任何模拟事实
失败项、降级与后续任务：验收中发现并修正 2 项——① 湿润土片首版 α 0.20/0.16 在草地底色上可辨度不足，上调至 0.28/0.22 后近景清晰；② 贴地片绘制每帧 rgba 字符串拼接违反零 GC 先例，改为 tone×季节预建常量后旋转 p95 3.3→3.2。无遗留失败。遗留观察：景观链增量旋转/高密场景 p95 3.2~4.0ms 略超 §5.1 参考值 3ms（见 §9.3 归因），S4-08 按 §5.1 完整口径在参考设备复测，若确认超限先减 Wood foliage slots(3→2) 与 shade 覆盖半径再复测。后续：S4-05 Berry/Stone/Gold 配方推广（复用 detail/GroundPatch 机制）；S4-06 标签层。
```

### 9.2 遮罩层 detail 子图元语义（S4-03 模块的行为补充）

`stockRole:'detail'` 子图元在 landscape-mask.js 的占据网格重建中**只做 `_masked` 预判、不入占据桶**：其显隐随库存 q 逐帧变化而 geomRev 不变，若入桶会让基础装饰被「当前不可见的细节」误去重（关闭景观后去重残留）；细节均为小 footprint 且基础装饰不围绕 POI 生成（§6.2 第 6 行实测），不参与去重的代价可接受。`childHidden` 对 detail 照常生效（POI 操作区/车道走廊内的细节同样隐藏）。

### 9.3 性能首测（§6.5 方法 · 景观链独立增量口径）

方法：临时包装 `collectLandscapes` / `drawLandscapeChild` / `drawLandscapeShadowGround` 计 `performance.now()` 差值（= §5.1 要求单列的「景观增量」整条链：同步 + 遮蔽判定 + q 过滤 + 视口剔除 + 入队深度采样 + 全部子图元与贴地片绘制 + 阴影）；合成时间戳 +34ms/帧绕过 render 节流、期间 stub rAF；预热 60 帧后采样 240 帧；模拟暂停（启动存档门禁态，§6.5 基线为运行态，口径差异如实记录）。整帧开/关对照在该 IAB 上被合成器 ~16ms 量化噪声淹没（关态甚至测得反超），故以链级增量为达标口径。

| 场景 | 状态 | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| 林地 seed31 zoom3 | 静态 | 1.5ms | 2.7ms | 3.7ms | 8.5ms |
| 林地 seed31 zoom3 | 旋转 rotZ+0.008/帧 | 1.9ms | 3.2ms | 6.7ms | 7.0ms |
| 泉边 seed34 zoom4 | 静态 | 2.0ms | 3.3ms | 6.8ms | 12.6ms |
| 泉边 seed34 zoom4 | 旋转 | 1.7ms | 4.0ms | 5.6ms | 8.4ms |

- 冷建模（组重建 sync 单独计时）：0.7ms（seed31）/ 1.2ms（seed34）；首帧含个体模型冷建（AccentModel `L#` 通道全冷）：18.9~50.1ms 单发；暖缓存整帧：~16-24ms（慢设备绝对值，仅记录）。
- 达标评估：静态 p95 2.7ms ≤ 3ms 参考值达标；旋转/高密 3.2~4.0ms 略超——该设备整帧比 §6.5 参考设备慢 ~3×（16ms vs 4.1ms 同场景同法），且本机测量含包装开销与计时尾部；不调大预算数字、不移动冻结基线，S4-08 以 §5.1 完整矩阵（参考桌面设备、模拟运行态、开/关对照）复测为准；若确认超限按 §4.4 失败处理先减 Wood foliage slots(3→2) 与 shade 覆盖半径。

### 9.4 首版配方冻结（数量与尺度）

| 配方 | role | modelKind | slots | 尺度/半径 | 备注 |
|---|---|---|---|---|---|
| Water | stone / grass / **wet** | RockCluster / GrassTuft / **GroundPatch** | 2 / 4 / 2 | 0.55-0.85 / 0.8-1.2 / 半径 6-9 | wet 半径带 30-42（role 级覆盖，避开 POI 操作区误杀）；tone=wet α 0.28/0.22 |
| Wood | tree / bush / grass / **shade** / **foliage** | Tree / Bush / GrassTuft / **GroundPatch** / Bush(detail) | 3 / 3 / 3 / 2 / 3 | 0.9-1.35 / 0.7-1.1 / 0.8-1.2 / 半径 8-12 / 0.45-0.7 | shade tone=shade α 0.15/0.13；foliage qThreshold = 0.2+0.65×(slot+0.5)/3 |
| Berry/Stone/Gold | （S4-02 骨架不变） | — | — | — | detail/贴地片推广归 S4-05 |

活体计数（浏览器实测）：seed34 全图 18 组 133 子图元（Water/组 8 = 石 2+草 4+wet 2，wet/1 常被水面/坡度拒绝）；seed31 Wood#30 组 14 子图元、9 可见（遮罩 5）。

### 9.5 复现流程

泉边：URL `?seed=34`（不能用 seed 0，§6.6 注 1）→ 注入 §6.6 注 4 UI 隐藏样式 → `aim(1.05, 0.6, 4.0, 26.13, -162.35, 2)`（世界点居中：`panX = 640 - w/2 - (x·cosZ - y·sinZ)·zoom`，`panY = 360 - h/2 - ((x·sinZ + y·cosZ)·cosX - z·sinX)·zoom`）→ 门禁暂停态手动 `render(performance.now())` + `sim-canvas.toDataURL()`。林地：`?seed=31` + `aim(1.05, 0.6, 3.0, 43.46, 118.56, 0)`。库存三态：改 `RENDER_CONFIG.landscapeDetailQFloor/QCeil` 后须 `LandscapeModel.resetCache()`（qThreshold 为构建期常量），q 实况 = 150/200 = 0.75。

## 10. 验收记录 · S4-05 果丛、石矿、金矿配方推广（2026-09-14）

> 按 §5.3 模板记录。临时 Node 验收断言（23 组）已按根 AGENTS.md §4.10 用后删除，不持久化。

```text
任务 ID / 状态 / 日期：S4-05 / ✅ 完成 / 2026-09-14
基准提交 / 候选提交 / 应用版本：基准 9650325（分支 c2，已并入 master S7-05~07）/ 候选 = 本次提交 / 1.50.51（升版器 12 定义点同步）
WASM 双副本 SHA256：frontend/rust/ = frontend/ = 087bcad05b79dc36…（升版 SAVE_APP_VERSION 后重编译，双副本同值）
模拟配置 SHA256 / 渲染配置摘要：SIM_CONFIG 239 字段未变（S4-01 冻结基线仍有效）；RENDER_CONFIG 顶层键数不变（75；仅 landscapeRecipes 配方表 v2→v3：Berry +fruit、Stone +quarry、Gold +vein，键内结构与回退表逐位一致）
profile / seed / tick / 存档摘要 / 相机 / 视图 / 季相：seed 34 / river_valley_v1（含 S7-05~07 地形变更的合并后内核）/ tick 0（创世暂停）/ 相机 rotX 1.05 / rotZ 0.6 / zoom 8，中心分别为 Berry#23 (76.8, -51.5)、Stone#41 (-299.8, 89.4)、Gold#50 (284.0, -92.5)（Stone#40 全组被车道区遮蔽 0/5 可见，改用 #41；§6.4 冻结表 POI 坐标在合并后内核未漂移）
设备 / Chrome 版本 / 视口 / DPR：Chromium IAB（win32）视口 1280×720 / DPR 1；库存款三态经页内 currentStock 临时夹具（§4.5 验收明确允许；暂停态截图用、截后恢复、不落存档，界面库存环与派生层同源同步）
执行门禁、退出码及日志位置：cargo test --lib 0 失败；cargo build wasm release 通过 + 双副本同步；test-wasm ALL_TESTS_DONE；test-determinism 6/6；config-check 239/239；frontend-check 全过；doc-link-check / cross-doc-check 0 冲突 / doc-maintenance-check / bump-version --check 12 点零漂移；git diff --check 干净
物理差分 / 模型确定性 / 避让违例 / 标签与命中检查：物理字段差分 0（sync + childActive 前后 sim 串化逐位一致）；模型确定性 23/23（0/半/满全子图元几何逐位一致且 version() 不变——库存不参与几何重抽；detail 激活数 0 ≤ 半 ≤ 满、0 时全隐；可见点数 round(n×q) 随 q 单调不减；点偏移 ∈ ±0.85r、两两 fruit/vein 点簇互不重；role 半径带 26..36 / 26..34 生效；q 缺失 / maxStock≤0 / NaN → detail 全隐骨架保留；坡面拒绝照常；清缓存重建 / 独立沙盒 / 缺省回退表三者逐项一致）；避让 = 邻接组 Berry#23 ↔ Water#13（51.8m 共享走廊）分别 4/9、4/8 遮蔽、fruit 内缘距中心 25 > 操作区 18 中心恒可辨；标签不适用（S4-06/07）
基准与候选 p50/p95/p99 / 首帧与缓存重建 / 缓存规模：本任务为 detail 贴地片推广（机制与 S4-04 同链路，点簇绘制为单 path 批量 arc，增量远低于 S4-04 已测链增量，不重复整链实测；S4-08 总验收统一复测）；缓存规模 = seed34 Berry 9 子图元（bush5+grass2+fruit2）/ Stone 5 / Gold 6，组上限与帧预算沿用既有配置
截图与原始记录路径：evidence/S4-05/screenshots/ 9 张（berry/stone/gold × q 满/半/零，seed34 zoom8 固定相机）；页内满 vs 零像素差分 berry 5963 / stone 5163 / gold 8251 px
失败项、降级与后续任务：验收中发现夹具陡坡区按设计拒绝 1 枚 vein 候选（跳过不重编号，非缺陷）；无遗留失败。后续：S4-06 标签候选层（依赖 S4-01 文字入口盘点）；S4-08 收口时对五类配方做统一性能与视觉总验收
```

**S4-05 交付边界说明**：果实/矿脉以**点簇贴地片**表达（构建期静态几何 + 绘制期连续强度），不新增拾取实体、不改 Inspector 数据；Berry 保留采收中心原图标与储量环，Stone 可采面为灰斑明暗（不修改坡度/碰撞），Gold 哑光矿脉斑禁整片发光/扩矿——全部符合 §3.2 放置约束。三配方任一失败可经 landscapeRecipes 单独关 role，不阻塞泉边/林地样板。
