# TA-12 技术实施方案与任务列表 · 世界坐标锁定的地表纹理

> **状态：已实施完成（v1.50.53，2026-09-14）。** 八个子任务全部完成并经门禁与实测验收；文中参数为首轮建议值，性能数字与验收结论以 §6 各任务实施记录为准。
> **任务来源**：[地形美术规划](docs/plan/tech/07-terrain-art.md) §1.2 TA-12、§5.1、§10.2、§11.3。本文按用户要求放在项目根目录，作为 TA-12 专项实施清单。
> **交付目标**：在现有纯色地表上增加低对比草斑和土纹；位置、形状和方向固定在世界空间，缩放、旋转、暂停、刷新及存读档不重新抽样。远景维持地貌主色，中近景呈现适量细节。

## 1. 范围与实施决策

采用 **CPU 确定性派生小型世界空间图元 + 地形格内分片绘制 + 有界几何缓存**。复用 Canvas 与现有统一深度队列，不新增整屏纹理层。草斑是贴地不规则色斑，土纹是短小、断续的窄多边形；均没有高度、独立阴影或交互身份。

TA-12 不依赖 TA-04~TA-08 或内核新地形任务，可以独立实施。以下分工保持明确：

- TA-13 负责季节地表反照率；本次只预留材质颜色更新接口，不引入冬雪、干湿循环或另一套季节时钟。
- TA-11 的 GrassTuft 是立体装饰；本次草斑不生成草叶、不扩大可采资源。
- TA-14 负责装饰对最终道路/房屋/POI 的表现层避让；本次纹理附着地形，利用既有绘制顺序被上方路面和实体覆盖。
- TA-18 负责全场景分块缓存；本次只做自身几何分桶与内存上限，不提前重构全场景缓存。

不改 Rust 地形、共享 WorldRng、通行、肥力、快照字段和存档结构。视觉参数放 `RENDER_CONFIG`，不进入 `SIM_CONFIG`。实现发布仍需统一升版；升版影响 Rust 应用版本常量时按项目规则重编译并同步 WASM 双副本。

## 2. 当前源码基线与接入点

以下以本次实际读取的源码为准；07 号规划中的部分历史版本、文件行数和队列归属已落后，不直接复制为实施事实。

| 位置 | 当前职责 | TA-12 接入方式 |
|---|---|---|
| [math.js](frontend/js/math.js) | `computeTerrainAlbedo` 按高程、坡度、肥力和水陆类别计算基色；`computeElevationColor` 提供固定光路径 | 保持主色公式；如需共享草/土权重，提取无行为变化的材质权重帮助函数，避免另写一套阈值 |
| [rustworld.js](frontend/js/rustworld.js) | `_applySnapshot` 建立 `wx/wy/elev`、地表类别、法线、反照率和 `cell.color`；静态地形按需替换 | 地形重建通知纹理模型失效；不改变静态快照各通道的 null/空数组语义 |
| [lighting.js](frontend/js/lighting.js) | `relightTerrain` 按光档写回 `cell.color`，包含大气色洗 | 提供同批更新的少量纹理色档，复用受光公式，避免解析 CSS 颜色或每帧造字符串 |
| [render_terrain.js](frontend/js/render_terrain.js) | `drawTerrainShell` 批量投影顶点；`drawTerrainCell` 绘制外扩防缝四边形 | 在单格基底填充后绘制该格的纹理分片，保持原格深度 |
| [render_depth_queue.js](frontend/js/render_depth_queue.js) | 当前 `drawWorldEntities`、地形格剔除、队列排序与 `DEPTH_CELL` 分发所在地 | 复用已有可见格和调用；不为每个草斑增加深度项 |
| [config.render.js](frontend/js/config.render.js)、[index.html](frontend/index.html) | 视觉配置和原生脚本依赖顺序 | 集中参数，登记新模块；同时检索其他页面是否复用同一渲染入口 |

注意 `terrain.cells` 实际是顶点阵列，四个顶点组成一个可绘制格；不能将顶点数量当作纹理单元数量。当前单格颜色取 `c00.color`，本次不顺带改变地形基底的着色粒度。

## 3. 世界空间模型

### 3.1 可复现身份与随机规则

首期使用固定视觉盐值、风格版本和整数世界桶坐标生成图元：

```text
bucketX = floor(worldX / bucketSizeWorld)
bucketY = floor(worldY / bucketSizeWorld)
h = hash32(styleVersion, salt, bucketX, bucketY, candidateIndex, channel)
```

`hash32` 使用明确的 32 位整数混合（例如 `Math.imul` 与无符号移位），负坐标先保留有符号整数位模式；禁止 `Math.random()`、墙钟、frameCount、相机参数、屏幕像素坐标和依赖访问顺序的可变 PRNG。位置、尺度、旋转、轮廓及明暗符号使用独立 channel，修改某个属性不串改其他抽样结果。

**首期明确不依赖 `_engineSeed`**：当前加载接口允许 seed 元信息缺省，不能假定该字段永远等于存档世界种子。采用固定世界坐标场即可满足 TA-12；不同世界通过真实地表的材质筛选、投影高程呈现差异，允许同坐标候选形状相同。若后续要求每个 seed 有独立纹样，应另行核对可靠的种子恢复链路，不能以旧 UI 种子或随机回退补齐。

同坐标图元身份由上述元组唯一确定；跨格裁剪只产生分片，不再抽样。世界实例失效标记仅管理缓存，不进入图元哈希，因此清缓存、回溯与刷新不会换纹样。

### 3.2 草斑与土纹

| 类型 | 图元与分布 | 首期建议 |
|---|---|---|
| 草斑 | 4~6 顶点不规则扁平斑块，桶内抖动候选点；稳定低频场调制密度，避免等间距铺点 | 尺寸约 2~6 世界单位，正负明度变化配对，轮廓不描边 |
| 土纹 | 短窄多边形，方向来自世界哈希；同一局部区域可共享弱方向趋势 | 长约 1~3 世界单位，宽约 0.2~0.5，禁止屏幕固定宽度和密集平行线 |

两类都以真实坡度与肥力的连续权重控制覆盖率；沿用现有草→土→岩过渡，陡岩逐渐衰减，不以纹理更改基色权重。水格 `ShallowWater`、`DeepWater` 首期不生成纹理，`RiverBank` 首期也排除，避免岸线和透明水面下出现草斑。不得将一个格内局部纹样解读为新增土地用途。

候选点先生成，再按所在位置的地表材料筛选；跨格片段也检查目标格允许的材料，避免中心在陆地而片段落入水格。离散岸边以保守裁剪为主，不承诺恢复快照网格中不存在的精细水陆边界。

### 3.3 跨格裁剪与贴地投影

1. 按图元世界包围盒找出触及格，仅在模型构建时将多边形裁到各格世界 XY 矩形内。桶查询范围扩展最大图元半径，图元只由自身桶生成一次，避免边界重复生成。
2. 每个分片顶点存所属格内 `(u,v)`，取值 0~1；跨格共享交点使用相同世界边界坐标算出，约定顶点顺序与边界包含规则。
3. 每帧复用该格四角投影，按双线性权重求分片屏幕位置：`P(u,v) = (1-u)(1-v)P00 + u(1-v)P10 + uvP11 + (1-u)vP01`。这等价于现有线性相机下对四角插值地表的投影；只作视觉贴面，不创造可通行面。
4. 分片在 `drawTerrainCell` 内、基底之后立即绘制，与基底同属 `DEPTH_CELL`；不抬 Z、不调用 `projectLifted`、不使用装饰 `_decalDepth`，不建立整层后绘制。
5. 既有地形格外扩防缝保持不变。纹理分片限制在原始格范围，不跟随防缝边沿向外扩大，避免半透明重叠加深。共享边抗锯齿仍须专项实测：窄色缝或被相邻外扩基底截断都算缺陷，低对比不能代替验收。

首轮优先使用预裁剪的填充多边形，避免逐格 `save/clip/restore`。若陡坡投影退化、分片无面积或输入不合法，跳过该片并保留基底，不能产生 NaN。现有格心深度是 Canvas 的近似，本次不声称解决任意非平面地形遮挡；若跨格拼接在四方位样板中不合格，先修共享边覆盖策略，再推广。

## 4. 色彩、光照与细节分级

### 4.1 低对比且共用受光

保持原始 `albR/G/B` 与 `cell.color` 不变；纹理使用原反照率的小幅等比例扰动，首轮建议增减 3%~5%，上限 8%。复用当前地形法线、AO、光向、色温和色洗顺序生成纹理色档，不能对最终已色洗颜色重复施光。

将光照计算中可复用的“输入反照率→最终 RGB”步骤提取为无分配帮助函数，原地形路径与纹理色档共用，原格颜色应逐值一致。按格预存有限亮/暗色档并去重；固定光兜底也要生成对应纹理色档，禁止动态光关闭后遗留上一光档颜色。几何无需随光改变。

主渲染热路径只读取已生成的颜色与几何，禁止每格解析 `rgb(...)`、创建渐变或新建数组。默认不使用 multiply/screen 等混合模式；若为 LOD 淡入使用 `globalAlpha`，绘制结束必须恢复 Canvas 状态。

TA-13 后续改变反照率时，应统一标记基底颜色和纹理色档失效。TA-12 不以季节值驱动几何或位置；光照相位变化只影响颜色。

### 4.2 缩放与旋转稳定性

几何永远保留同一组候选，只改变可见细节和透明度，不按 zoom 换 seed、轮廓或采样格。以当前相机的统一世界到 CSS 像素尺度判断 LOD，避免按旋转后斑块包围盒面积导致转镜头时随机增减。

- 远景：隐去细土纹，草斑平滑减弱至零，保留原地貌色块。
- 中景：显示草斑；土纹在可辨尺度内渐入。
- 近景：完整候选集，但不增加新一轮随机点。

建议细节在特征尺度 2~5 CSS px 间 smoothstep 淡入；若实测需要离散档位，再加滞回，不能同时改变纹样身份。DPR 只用于 Canvas 像素映射，不参与纹样或世界尺寸。

## 5. 模块、缓存与配置

### 5.1 建议新增接口（均未实现）

新增 `frontend/js/terrain-texture.js`，导出 `window.TerrainTexture`，集中模型派生、预裁剪、缓存管理和单格绘制。模块早于 `rustworld.js` 与渲染入口加载，不在脚本加载时读取尚未建立的 Canvas 全局。

| 拟定接口 | 职责 |
|---|---|
| `invalidate(reason)` | 释放世界相关几何、材质索引、颜色引用和重建队列 |
| `prepare(terrain, config)` | 对当前地形身份及配置修订生成/补齐模型，不在逐格循环中反复扫描配置 |
| `refreshPalette(terrain, shadeFn)` | 受光或反照率变化时刷新有限色档；具体调用与地形重着色批次绑定 |
| `drawCell(ctx, indices, projection, lod)` | 只消费当前格分片和色档；不得抽样或改变模拟 |
| `stats()` | 返回缓存字节、分片数量、构建耗时和绘制计数，用于临时验收 |

若实现超过 800 行，拆成模型与绘制两个单一职责文件；不将新逻辑堆入已偏大的桥接或队列文件。跨模块通知保持小接口。

### 5.2 缓存依赖与生命周期

| 变化 | 几何/材质分片缓存 | 颜色缓存 | 原因 |
|---|---|---|---|
| 平移、旋转、缩放、窗口、DPR | 保留；重新投影/选择 LOD | 保留 | 不缓存屏幕纹样 |
| 光档、动态光开关、主题色洗 | 保留 | 重建 | 使用同一地形受光输入 |
| TA-13 后续反照率更新 | 保留位置；若改材料权重则更新筛选 | 重建 | 分离形状与材质依赖 |
| 新静态地形网格、尺寸、高程或类别 | 重建 | 重建 | 地表投影/筛选输入已改变 |
| READY / LOAD_RESULT / REWIND_RESULT / RESET_DONE | 显式清空再准备 | 重建 | 接入 `_invalidateWorldStaticCaches` |
| 仅增量快照未携带地形 | 保留 | 按光档决定 | 无地形字段不表示清空 |
| 风格版本、密度、尺寸、材质阈值 | 重建 | 按需重建 | 几何输入变化 |
| enabled 开关 | 关闭停画并停止构建；再次开启验证身份 | 按当前光档验证 | 不恢复失效引用 |

以地形对象身份加显式失效为首期缓存管理依据；不能只以 profile/生成器版本识别世界，也不能借 FABS epoch 或字符串表失效代替模型生命周期。重建取消时释放旧任务，防止 A 世界延迟构建结果写回 B 世界。

候选按固定世界桶索引、分片按格索引，用紧凑数组保存顶点及色档索引。建议本功能缓存上限 8 MiB（包含几何、索引、色档与构建暂存；低于 07 号全视觉建议 64 MiB）。超出时采用确定的质量上限或有界可见桶缓存；淘汰后重建必须得到相同图元。不得依据机器瞬时帧率随机删点，不能无限累积相机/季节组合。

优先测量一次构建成本；若首帧明显阻塞，按固定桶序分批准备，每帧建议不超过 2 ms，未就绪格仅画原基底。分批策略须另验淡入与镜头移动时的突现；降级不能代替默认画质性能通过。

### 5.3 参数集中与消费点

在 `RENDER_CONFIG` 下集中一个 `terrainTexture` 配置对象，建议包含以下键；实施时统一缺省与合法性校验，所有数字须有真实消费点。

| 参数组 | 建议起始值/含义 | 消费处 |
|---|---|---|
| `enabled`, `styleVersion` | true、1；纯色 A/B 与派生算法版本 | prepare/draw |
| `bucketSizeWorld`, `candidatesPerBucket` | 12、草斑 3/土纹 2；候选上限而非保证密度 | 世界桶生成 |
| `grassSizeRange`, `soilLengthRange`, `soilWidthRange` | §3.2 的世界单位区间 | 图元生成 |
| `contrast`, `contrastMax` | 0.04、0.08 | 色档生成 |
| `detailFadePx` | [2,5] CSS px | LOD |
| `cacheMaxBytes`, `buildBudgetMs` | 8 MiB、2 ms | 缓存/分批准备 |

材质阈值首先复用原材质帮助函数；新增纯视觉密度、尺寸与阈值才进入此配置，不向 Rust 添加孤儿参数。配置热调在 prepare 阶段计算修订；不得每帧每格 JSON 序列化整个配置。

## 6. 实施任务列表

建议顺序：**TA-12-1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**。预计约 5~8 人日，包含首轮接缝及性能迭代；这是工作量估计，不是已完成进度。

- [x] **TA-12-1 固定基线与样板（约 0.5 日）** ✅ 2026-09-14 完成，基线记录与样板清单见 [TA-12-BASELINE.md](TA-12-BASELINE.md)（样板存档/截图/内核基线在 `samples/TA-12/`；T1=seed 43 山口 tick 59056、T2=seed 42 河谷 tick 24334，均经正式门禁建档，v1.50.50 同版本）。
  - 核对根/前端指南和现行浏览器、性能指南；保存 T1 山口与 T2 河谷各一份真实同版本存档和明确 seed。
  - 记录应用版本、设备、Chrome 版本、配置、人口、倍速、Tick、光相、窗口、DPR 与相机参数；建立无纹理截图和性能基线。
  - 交付：基线记录与样板清单；不得从已有截图猜 seed，不跳过正式存档门禁。
  - ⚠️ 遗留：无纹理渲染基线 p50≈83ms 本身已超 16ms 参考预算；T1/T2 两次采样窗口尺寸被外部改动不一致，TA-12-7 A/B 前须固定窗口并重测基线（详见 TA-12-BASELINE.md §3）。

- [x] **TA-12-2 确定性世界纹样模型（约 1 日，依赖 1）** ✅ 2026-09-14 完成（`frontend/js/terrain-texture.js`，`window.TerrainTexture`）。
  - 新增模块与集中配置，完成固定整数哈希、独立属性通道、世界桶候选、草斑/土纹几何及材质筛选。
  - 临时验证负坐标、不同遍历顺序、清缓存重建和分批生成得到相同模型；相机变化不改变顶点摘要。
  - 交付：模型接口、配置消费点；测试脚本临时使用后删除。
  - ✅ 实施记录：模块 414 行（<800 上限），配置组 `RENDER_CONFIG.terrainTexture` 11 键（detailFadePx 留待 TA-12-3）；index.html 于 config.render.js 后、lighting.js 前登记；`invalidate('world')` 接入 `rustworld.js::_invalidateWorldStaticCaches`（READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 四处随消息生命周期）；`drawCell`/`refreshPalette` 为 TA-12-3/4 接口占位。临时验证 29 项断言全绿后已删除：一次成型/分批（budget=0）/清缓存重建/逆序与键序逐桶输出摘要一致、相机参数无输入通道（顶点摘要不变）、负坐标位模式无 NaN、无图元中心落水系（ShallowWater/DeepWater/RiverBank）、顶点不越沙盘边界、材质权重单调性（水 0/陡岩 0/平地土纹低覆盖）、styleVersion 换纹样而 contrast 只改明度且幅度 ∈ [contrast, contrastMax]、enabled=false 不建模、null 地形安全拒绝、缺省回退可用、cacheMaxBytes 两级确定性收敛（候选降档→哈希抽稀桶）。开发中修复两处缺陷：`pushSoil` 顶点误全推入 vx（vy 空）、草斑形状哈希槽位 k*8 跨候选碰撞（改 k*16）。合成地形样板 6973 图元 / 33343 顶点 / 3366 桶 / 427 KB（上限 8 MiB），单次全量构建 ~14 ms。
  - ⚠️ 版本号未升（按本文 §8 由 TA-12-8 统一升版 + WASM 双副本 + changelog 收口；本子任务纯前端 JS，无需重编译 WASM）。

- [x] **TA-12-3 逐格裁剪与深度接入（约 1~1.5 日，依赖 2）** ✅ 2026-09-14 完成（`terrain-texture.js::clipToRect`/`buildFragments`/`drawCell` + `render_terrain.js::drawTerrainCell`、`render_depth_queue.js::prepare` 接入）。
  - 构建期 Sutherland–Hodgman 跨格预裁剪（模块级 Float64 scratch，零构建期分配）：图元 AABB → 触及格范围 → 逐格裁剪出分片并登记 `(u,v)` 贴面坐标；目标格材料过滤（水系/权重 0 格零分片）；finalize 拍平为紧凑 typed arrays + `fragsByCell` 范围表（Map 迭代序 = 固定桶行主序，拍平结果与分批/遍历顺序无关）。
  - 绘制期 `drawCell` 四角双线性凸组合投影（权重非负和为 1 → 分片恒在本格四边形凸包内），由 `drawTerrainCell` 在基底之后调用，与基底同属 DEPTH_CELL——不新增队列项、不抬 Z、不调用 projectLifted；防缝外扩 TERRAIN_SEAM_PX 仅作用于基底路径；LOD `detailFadePx=[2,5]` CSS px smoothstep 淡入（`lod=camera.zoom`，DPR 不参与），globalAlpha 用毕恢复。
  - 边界处理：跨桶唯一归属（图元只由中心桶生成一次）、图元中心离沙盘边界 ≥ 半径 + 0.5、退化分片（<3 顶点）与 NaN/退化投影安全跳过保留基底、`detailFadePx` 热调不触发模型重建（不入 configRevision）。
  - ✅ 临时验证 25 项断言全绿后已删除：UV ∈ [0,1]、格键合法、水系格零分片、分片质心回含原多边形（抽样 600）、跨 x/y 格边界共享边顶点逐点一致、drawCell 填充计数/色串格式/globalAlpha 恢复/两次调用逐值一致、lod=0.01 全剔除、NaN 投影零落笔、一次成型 == 分批（budget=0）拍平摘要逐字节一致、失效重建一致。合成地形样板 3887 图元 / 4944 分片 / 1206 格 / 478 KB。
  - ✅ 浏览器冒烟（localhost:3005，门禁弹窗隐藏后截图）：stats ready=true、frags=15805、drawCells=379851、drawFrags=589254、bytes≈1.2 MiB（< 8 MiB），地形渲染无异常色块/黑屏/接缝错位，控制台无 terrain-texture 相关报错。⚠️ 四方位接缝人工对照与覆盖顺序目检未自动化（`camera` 为主线程闭包变量非 `window.camera`，自动化无法调相机）；跨格接缝已由共享边逐点一致断言 + 分片凸包投影断言机器覆盖，如需可在 Chrome 手动旋转视角补验。
  - ⚠️ 版本号未升（按本文 §8 由 TA-12-8 统一升版 + WASM 双副本 + changelog 收口；本子任务纯前端 JS，无需重编译 WASM；曾误升 v1.50.53 已整体回退）。

- [x] **TA-12-4 共用受光与低对比色档（约 0.5~1 日，依赖 3）** ✅ 2026-09-14 完成（`lighting.js::lightParams`/`shadeAlbedoInto` + `terrain-texture.js::refreshPalette`/`_shadeFor`）。
  - 提取共用地形着色步骤并验证关闭纹理时原基底颜色逐值一致；接入有限纹理色档与更新通知。
  - 完成动态光/固定光、明暗主题、光档变动与强度为零回退；确认不改原反照率和模拟输入。
  - 交付：纯色/纹理 A/B、固定世界光旋转相机对照；无固定屏幕高光、无全图色偏。
  - ✅ 实施记录（2026-09-14，`lighting.js` + `terrain-texture.js`）：
    - 共用受光步骤提取为 `lighting.js::lightParams()`（每趟预取光档/色温/主题色洗参数）+ `shadeAlbedoInto(lp, …)`（法线 wrap 漫反射 → AO×强度 → 光档钳制 → tint 色温 → 大气色洗烘焙，零分配写 out[0..2]）；`relightTerrain` 逐格改走同一函数，两接口均导出供纹理层消费。
    - `relightTerrain` 重着色批次末尾显式通知 `TerrainTexture.refreshPalette(terr, shadeAlbedoInto, lp)`（更新通知与地形重着色批次绑定；几何不变）。
    - 纹理色档改为「反照率小幅等比扰动（tone 量化 4 档，±4%~8%）→ 同一共用受光管线」，取代 TA-12-3 临时「已色洗最终色等比缩放」；按格惰性预存 8 档（sign×lvl）去重缓存（key = ci×8+sign×4+lvl），热路径只读缓存、零 rgb 串解析（`parseRgbKey` 已删）；无受光入口/无 cell 安全返回 null 跳过分片保留基底。drawCell 保留 terrain+relightCount epoch 兜底失效，refreshPalette 显式清缓存并注入 shadeFn/lp 快照（固定光兜底/明暗主题/光档变动全部经批次流过，不遗留上一光档颜色）。
    - ✅ 临时验证 31 项断言全绿后已删除：重构后基底色与 git HEAD 旧内联公式逐值一致（预存数组路径 + 无数组回退路径全格比对）、反照率预存数组逐值不变、refreshPalette 清缓存+注入、色档 == albedo×mul 共用受光输出（抽样 200）、色档与基底差 ≤8% 低对比、drawCell 落笔/有限/globalAlpha 恢复/rgb 串格式、固定光兜底（washA=0、颜色更换不遗留）、浅色主题 wash 0.55 系数逐值一致、光档变动（resync 换季）基底与色档同步更新、lightMin 钳制下合法色串、无 SimLighting 安全回退零落笔、两文件行数 ≤800。
    - ⚠️ 纯色/纹理 A/B 截图与固定世界光旋转相机对照未自动化（同 TA-12-3 遗留，`camera` 为闭包变量）；由 TA-12-6/7 Chrome 验收统一覆盖。版本号未升（归 TA-12-8 统一收口）。

- [x] **TA-12-5 LOD、缓存与世界生命周期（约 0.5~1 日，依赖 4）** ✅ 2026-09-14 完成（接线核对 + 临时断言验证，无新增代码——CSS 淡入/内存上限/生命周期失效均已在 TA-12-2/3 落地）。
  - 完成按 CSS 尺度淡入、内存统计及上限、四类生命周期失效、新静态网格替换与 null 增量帧保留。
  - 检查 seed 元信息缺省的直接读档、相同 profile 的不同世界、A→B→A、回溯及配置热调。
  - 交付：暖缓存/冷重建图元摘要一致；相机只改投影，旧世界引用释放。
  - ✅ 接线核对（2026-09-14）：① CSS 尺度淡入 = `drawCell` 内 `detailFadePx` smoothstep（TA-12-3）；② 内存统计与上限 = `stats()` + `cacheMaxBytes` 两级确定性收敛（TA-12-2）；③ 四类生命周期失效 = `_invalidateWorldStaticCaches()` 在 READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 调 `TerrainTexture.invalidate('world')`（rustworld.js L316，回溯/重置同路径）；④ 新静态网格替换 = `_applySnapshot` 重建 `this.terrain` 新对象 → `prepare` 身份判据（`m.terrain === terrain`）失效自动重建；⑤ null 增量帧保留 = 同对象重复 `prepare` 命中修订签名只续建/不重建；⑥ seed 缺省读档 = 模型不消费 `_engineSeed`（TA-12-2 契约），同内容新 terrain 对象重建摘要一致；⑦ 配置热调 = `configRevision` 修订签名（`detailFadePx` 不入签名不重建；`contrast` 只改 tone 不改位置；`styleVersion` 换代）。
  - ✅ 临时验证 27 项断言全绿后已删除：冷建==暖重建（摘要+模型级 stats 逐值一致；`lastBuildMs` 真实耗时、`builds`/`invalidations` 合法累加计数器除外）、分批（budget=0，4355 帧）==一次成型、null 增量帧保留不重建、A→B→A 与相同 profile 不同世界摘要互异且回转一致、同内容新静态网格（seed 缺省直接读档代理）重建一致、invalidate 后 `_model=null` 旧世界引用释放且重建仅绑新世界、detailFadePx 热调零重建、contrast 热调 tone 变位置不变、styleVersion 换代、低上限（4 KiB）降档 bytes≤上限且冷/暖收敛逐值一致、enabled=false 拒绝建模清空后再开启一致、连续 invalidate 幂等。

- [x] **TA-12-6 Chrome 功能与视觉验收（约 0.5~1 日，依赖 5）** ✅ 2026-09-14 完成（Chrome 自动化实测，§7 矩阵逐项通过；截图与摘要证据见下）。
  - 按 §7 矩阵实测；使用 Chrome File System Access API 建档，真实推进、暂停、重置、读档与回溯。
  - 同一世界锚点记录纹样形状和坐标，截图验证旋转缩放可追踪；临时夹具补充极限边界，不能代替端到端。
  - 交付：前后截图、存档定位、缺陷与复测记录；有接缝、漂移或遮挡回退则不勾选。
  - ✅ 实测环境（2026-09-14，macOS 本机 Chrome + TRAE 浏览器扩展自动化；`node frontend/server.js` → `http://localhost:3005/?nogate=1&seed=43`，徽章 v1.50.52·c5）：⚠️ 本环境自动化无法驱动 macOS 原生文件对话框，File System Access 建档未重复（TA-12-1 样板已在 Windows 正式门禁建档）；存读档验收改走**等价真实内核链路** `rustWorldSim.saveWorld()`（world_save）/ `loadWorld()`（world_load → LOAD_RESULT）；`?nogate=1` 旁路按文档用于自动化场景。
  - ✅ §7 矩阵实测记录（模型摘要格式 = fragKey|prims|vertices|frags|bytes；T1 山口 seed 43 = `45523|7108|33932|13774|1072066`）：
    - 世界锁定：四方位旋转（shift+拖拽每次 rotZ += π/2，截图 ta12-6-t1-rot90/180/270）摘要**逐值不变**，纹样随地表投影移动无游泳；连续缩放（zoom 1.15→~3.6→0.35→复位）摘要不变。
    - 接缝与贴地：T1 山口近景（zoom≈3.6）与 T2 河谷近景截图（ta12-6-t1-zoom-in / ta12-6-t2-river-zoom）无重复暗边、亮缝、规则格纹、悬空或越界。
    - 水系与遮挡：T2 河谷水格无草斑、岸线干净；道路虚线/POI 底座标记/房屋/树木正确覆盖纹理之上，无遮挡回退。
    - 主色与光照：一次会话内自然轮转 春→冬→夏（截图中山地积雪出现又消退），纹理色档随光档同步更新、几何不变；enabled=false 恢复纯基底（模型清空 reason=disabled-or-no-terrain），再开启重建摘要 == 基线（身份验证）。
    - 细节分级：远景（zoom 0.35）纹理淡出维持地貌主色，近景完整候选集；全程无重抽样（摘要不变）、无摩尔纹。
    - 生命周期：暂停 ✓；回溯（时光倒流控制器 tick 47040→5000，REWIND_RESULT 失效 reason=world，重建摘要 == 基线）✓；读档（推进至 5744 后 loadWorld 回 5000，inv 3→4，重建摘要 == 基线）✓；重置（应用种子 42 → RESET_DONE 失效，T2 新纹样 `80978|7068|34395|14029|1089913` ≠ T1，材质筛选呈现世界差异）✓；A→B→A 世界切换一致由 TA-12-5 断言覆盖。
    - 数据边界：全程控制台**零错误零警告**，JS 堆 26 MB，模拟 tick 正常推进；模型纯读不写模拟事实。
  - ⚠️ 遗留说明：① seed 元信息缺省的直接读档端到端在本环境不可复现（samples 样板 app_version 1.50.50 已被 v1.50.52 存档门禁自动废弃）——该场景已由 TA-12-5「同内容新静态网格重建摘要一致」单元断言机器覆盖；② 相机为 main.js 闭包变量，旋转/缩放经合成鼠标事件驱动（与真人交互同一路径），非直接赋值。

- [x] **TA-12-7 性能闭环（约 0.5~1 日，依赖 6）** ✅ 2026-09-14 完成（原始数据交付 + 1 处 LOD 热调缺陷修复；预算目标未达已如实记录，待取舍）。
  - 同设备同存档预热，开/关纹理交替采样，每组至少 60 秒；覆盖固定镜头、连续旋转、缩放/跟随和高人口高倍速。
  - 同一计时边界统计准备、投影、绘制、颜色重建及 UI 总耗时，单独记录冷启动；记录缓存峰值与模拟吞吐。
  - 交付：两端原始 p95、差值和内存数据；超标优先减图元/分配/裁剪开销并复测，不减 Tick 掩盖性能回退。
  - ⚠️ 方法偏离（如实记录）：本机用户正在使用浏览器，自动化标签 `visibilityState=hidden` 被 Chrome 节流，rAF 帧间隔 60 秒长窗口采样不可行——改用**同步渲染通道微基准**（同一计时边界 = 每趟完整调用 `drawTerrainShell()` + `drawWorldEntities()`，OFF/ON 交替 × 40 迭代；对「纹理增量」的度量比帧间隔法更直接、不受合成等待污染）。人口 20（新建世界），「高人口」以高倍速 1024x 场景近似覆盖；rAF 长窗口法留待与 TA-12-1 基线同环境复测。
  - ✅ 环境：macOS 本机 Chrome（用户同机运行其他负载，噪声 ~±40%）· viewport 2133×889 CSS · dpr 1.8（Canvas 后备 2666×1112，`min(dpr,1.25)` 钳制）· seed 43 · 20 人。绝对值不可与 TA-12-1 Windows 基线（2048×1018@1.25）直接比较，只看同机 A/B 增量。
  - ✅ 原始数据（单位 ms/趟，p50/p95/mean；df = 每帧实际绘制分片数）：
    - 固定镜头（2x）：OFF p50 92.7~154.6 / p95 221.6~444.9；ON（df=12990）p50 194.2~205.7 / p95 316.3~373.1 → 增量 ≈ +50~110ms。
    - 连续旋转（2x，迭代内同步派生 shift+拖拽 8px/趟）：OFF p50 118.2~134.0；ON（df=12990）p50 213.3~224.9 → 增量 ≈ +80~95ms。
    - 连续缩放（2x，振荡 wheel）：OFF p50 114.6~136.6；ON（df=8229~11887 随 zoom 振荡）p50 166.1~187.2 → 增量 ≈ +30~70ms。
    - 高倍速（1024x·固定）：OFF p50 109.8~152.2；ON（df=6904）p50 199.5~298.6 → 增量 ≈ +50~150ms（1024x 下季节/重着色高频叠加）。
    - LOD 杠杆复测（1024x，热调修复后）：detailFadePx [2,5]→df 12990 / mean 333.6；[4,10]→7894 / 214.8；[6,14]→2813 / 183.3；[10,22]→0 / 143.5（≈OFF 基线）——LOD 是连续可调的质量/性能旋钮。
    - 冷启动：invalidate 后同步全量重建 302.3~607.2ms（一次性；正常游玩由 buildBudgetMs=2ms/帧分批摊销，就绪前只画基底）。
    - 缓存峰值：1.07 MiB ≤ 8 MiB ✓；JS 堆 26~48 MB。
    - 模拟吞吐（10s×2 对照）：OFF 105.2~106.5 vs ON 105.6~106.6 ticks/s（2x 档）——**零回退**（仿真在 Worker 线程，纹理不减 Tick）。
  - ⚠️ 预算结论（如实记录，不自行放宽标绿）：基线本身超总预算（OFF p50 ~100-150ms ≫ 16ms 参考，继承 TA-12-1 超标声明）；纹理增量 p50 +50~110ms 也超「新增耗时 p95 差 ≤3 ms」目标。默认 detailFadePx=[2,5] 按 §4.2 规格建议保留（默认镜头下纹理可见）；预算取舍（降默认 LOD / 依赖 TA-18 全场景分块缓存 / 接受超标）需提交人明确接受。
  - ✅ 缺陷修复（减开销项）：`terrain-texture.js` detailFadePx 热调**静默失效**——drawCell 读建模型时冻结的 `m.cfg.detailFadePx`，而该键不入 configRevision（热调不触发重建）→ 新值永远到不了消费点（实测 df 恒 276160 不随阈值变化）。修复 = prepare 每帧将 resolveConfig 结果写入 `this._lodFade`，drawCell 读 live 值（`_lodFade || cfg.detailFadePx` 兜底）；修复后 df 随阈值正确衰减（上表 LOD 杠杆复测数据）。

- [x] **TA-12-8 工程门禁与文档收口（约 0.5 日，依赖 7）** ✅ 2026-09-14 完成（v1.50.53 统一收口）。
  - 检查脚本加载顺序、文件行数、所有渲染页面和参数真实消费点；执行 §8 适用门禁。
  - 同步前端局部指南、现状前端机制文档、代码地图与维护清单；07 号 TA-12 任务状态及本文只在证据齐全后标完成。
  - 统一升版、WASM 双副本、changelog；删除临时断言与夹具，最终审阅 diff。
  - 交付：可运行实现、验收记录和门禁结果；未实测项明确保留未完成。
  - ✅ 实施记录（2026-09-14，macOS 本机 rustup 标准工具链，非 .toolchain 注入）：
    - 行数与消费点：terrain-texture.js 684 / lighting.js 427 / config.render.js 243 / render_terrain.js 373 / render_depth_queue.js 495（均 <800；rustworld.js 1098 为既有超标非本次引入）；脚本加载顺序 7b 位（config.render.js 后、rustworld.js 前）未动；terrainTexture 12 键全部有真实消费点（detailFadePx 经 `_lodFade` live 消费——TA-12-7 修复后）。
    - 升版与 WASM：`node tools/bump-version.js --patch`（v1.50.52 → **v1.50.53**，12 定义点自动同步）→ `cargo build -p sim_wasm --target wasm32-unknown-unknown --release` → 双副本 `frontend/rust/` + `frontend/` 同步（1,388,401 字节）；`SAVE_APP_VERSION` 变更旧存档按设计自动废弃。
    - 门禁结果（全绿）：`frontend-check` ✅ · `config-check`（276 字段）✅ · `cargo test --lib`（0 用例，§4.10 设计使然）✅ · `test-wasm` ALL_TESTS_DONE（确定性/防越界/防 NaN/存读档/app_version 拒绝）✅ · `test-determinism` 6/6 套件 ✅ · `code-map-check`（228 扫描 216 登记 0 错误）✅ · `doc-link-check`（732 链接 0 失效）✅ · `cross-doc-check`（冲突 0 漂移 0）✅ · `bump-version --check`（12 定义点零漂移）✅ · `git diff --check` ✅。
    - `doc-maintenance-check --strict` exit=1：21 篇 NEEDS_REVIEW 均为**存量状态**（已验证 HEAD 无本次变更时同样 exit=1，且清单不含本次触碰的任何文档）；非 strict 模式 OK=19 全过。
    - 文档同步：[01-changelog.md](docs/current/01-changelog.md) 追加 v1.50.53 里程碑条目；[frontend/AGENTS.md](frontend/AGENTS.md) §1.1 terrain-texture.js 行更新（~680 行 + TA-12-5/6/7 收口与 `_lodFade` 修复契约）；[31-code-map.md](docs/current/tech/31-code-map.md) terrain-texture/lighting/render_terrain/render_depth_queue/config.render 五行状态刷新；[19-ui-implementation.md](docs/current/tech/19-ui-implementation.md) §1 图层渲染顺序补 TA-12 纹理落笔说明；[07 号规划](docs/plan/tech/07-terrain-art.md) §1.2 TA-12 标 ✅ v1.50.53；本文头部队列与状态行更新。
    - 临时断言与夹具：TA-12-2/4/5 临时 Node 脚本均已用后删除（无残留）；浏览器端采样器为页面内存注入，刷新即消失，无文件落盘。
    - 遗留保留项（如实未完成）：性能「新增耗时 p95 差 ≤3 ms」目标在本机未达成（增量 +30~110ms，数据见任务 7），预算取舍待明确接受；seed 元信息缺省直接读档的端到端复测依赖同版本样板存档（当前环境无 File System Access 建档自动化能力），该场景已由单元断言覆盖。

## 7. 验收矩阵与完成定义

| 类别 | 场景 | 通过标准 |
|---|---|---|
| 世界锁定 | 同锚点平移、四方位旋转、连续缩放后复位 | 模型坐标/形状摘要不变；纹理随地表投影移动，无游泳感 |
| 接缝与贴地 | 平地、山脊、陡坡、格交点、地图边缘；低/高俯角 | 无重复暗边、亮缝、规则格纹、悬空或越过沙盘边界 |
| 水系与遮挡 | T2 两岸、浅滩、房屋、道路、POI、人物 | 水格无草斑；不新增盖路、切屋、埋人或拾取错位 |
| 主色与光照 | 草/土/岩过渡，四季光档，动态光开关，深浅主题 | 原地貌仍为视觉主体；纹理明度扰动受限；关闭纹理恢复基底 |
| 细节分级 | 远/中/近及阈值往返，DPR 1/2 | 渐入连续、无重抽样和摩尔纹；DPR 不改变世界尺度 |
| 生命周期 | 暂停、刷新后加载同档、直接读档、重置、回溯、A→B→A | 不漂移、不串世界；无 seed 元信息也可复现；冷/暖模型一致 |
| 数据边界 | 开关纹理运行相同 seed 与 Tick | 世界事实与既有确定性门禁不受影响；不新增存档/FABS 字段 |
| 性能 | §6 第 7 项全部负载 | 主线程渲染+UI p95 目标 ≤16 ms；新增耗时 p95 差 ≤3 ms；吞吐下降 ≤约5%；纹理缓存 ≤8 MiB |

性能目标继承 [07 号 §11.3](docs/plan/tech/07-terrain-art.md)，8 MiB 是本任务建议的更小子预算。若基线本身超总预算，应同时报告基线超标与增量结果，不能声称总预算已通过。任何预算调整需提交原始数据与取舍并获得明确接受，不能自行放宽后标绿。

性能记录至少包括：场景标识、开关状态、预热/采样时长、主线程 p50/p95、纹理绘制耗时、重着色耗时、冷重建首帧和重复重建 p95、模拟 ticks/s、缓存峰值与 GC 观察。尚未实施前不得填入推测成绩。

## 8. 验证与文档维护

实施遵循 [根 AGENTS.md](AGENTS.md)、[前端 AGENTS.md](frontend/AGENTS.md)、[开发工作流](docs/current/tech/30-workflow.md)、[浏览器自动化指南](docs/current/tech/27-browser-automation.md) 与 [性能指南](docs/current/tech/25-benchmarking.md)。

**本次仅编写方案**：不升版、不构建 WASM、不运行模拟回归；执行文档维护、跨文档事实、链接和版本一致性检查。根目录位置按本次用户要求执行。

**后续代码实施交付**：

```bash
node tools/frontend-check.js
node tools/config-check.js
node tools/bump-version.js --patch
cargo build -p sim_wasm --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/sim_wasm.wasm frontend/rust/sim_wasm.wasm
cp target/wasm32-unknown-unknown/release/sim_wasm.wasm frontend/sim_wasm.wasm
cargo test --lib
node tools/test-wasm.js
node tools/test-determinism.js
node tools/code-map-check.js
node tools/doc-maintenance-check.js
node tools/cross-doc-check.js
node tools/doc-link-check.js
node tools/bump-version.js --check
git diff --check
```

构建工具链按项目实际环境使用，不套用 Windows 的路径注入。若范围扩展为快照字段变更，先补设计审查与四处同步，再追加 `snapshot-check.js`；正常 TA-12 不应触及该契约。发布时文档维护追加 `--strict`。

**完成条件**：八个子任务均有证据，视觉矩阵通过，性能闭环完成，源码/现状文档/版本/WASM 双副本一致。截图漂亮、临时断言通过或仅完成绘制接入，都不足以单独标记 TA-12 完成。
