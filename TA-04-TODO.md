# TA-04 TODO · 世界光向动态受光

> **任务定义**：[07-terrain-art.md](docs/plan/tech/07-terrain-art.md) §1.2 任务表 TA-04（原代号 P0，详见 §6.5）——**世界光向动态受光：枝干/叶簇/Boulder/RockCluster 法线点积，移除固定屏幕亮斑，阴影随树高与叶量变化**。本文件把该任务拆为可执行任务序列，编号即建议实施顺序；每项标注出处章节与验收方式。
> **状态**：TA-04-1 ✅ 已实现（2026-09-13，`lighting.js` 新增 `sunScreenDirFull()` 并通过 `frontend-check.js` 与 16 项冒烟断言）；TA-04-2 ✅ 已实现（2026-09-13，法线点积管线接入 Tree/Bush/Boulder/RockCluster，tD 驱动移除，`SUN_SCREEN_EPS` 迁入 `RENDER_CONFIG.sunScreenEps`，13 组 Node vm 断言 + 门禁全过）；TA-04-3 ✅ 已实现（2026-09-13，v1.50.39——枝干圆柱侧面明暗接入世界光向管线，主干三色 + 枝条/茎逐段受光 + 移除固定左上树皮亮线，20 组 vm 断言 + 门禁全过，浏览器三光位实测亮带随动）；TA-04-4 ✅ 已实现（2026-09-13，v1.50.40——叶簇宽而弱亮部接入世界光向屏幕投影，移除固定屏幕白斑与旧渐变色板死代码，17 组 vm 断言 + 门禁全过）；TA-04-5 ✅ 已实现（2026-09-13，v1.50.45——Boulder/RockCluster 子石共用 `drawStoneBody` 立体受光几何，billboard 移除 + 带法线顶面/侧面统一世界光向，16 组 vm 断言 + 门禁全过）；TA-04-6 ✅ 已实现（2026-09-13，v1.50.46——树/灌木贴地投影迁出为地面图元独立入统一深度队列，实高驱动影长 + 叶量调制夏冠影/冬枝影，含 render_world.js→render_depth_queue.js 队列模块拆分前置，19 组 vm 断言 + 门禁全过）；TA-04-7 ✅ 已实现（2026-09-13，纯审计零代码变更——参数集中与缓存依赖/生命周期复核全过，52 组临时断言全绿后按 §4.10 删除，不动版本定义点、不重编译 WASM、不新增 changelog 版本条目）；TA-04-8 待实施。`render_accents.js` 头注受光基线已随 TA-04-2 更新为「法线点积管线接入」；叶簇渐变亮部与固定白斑移除（TA-04-4）、岩石 billboard 几何细化（TA-04-5 ✅）均已消费。TA-04-1 已随提交 `cd89213` 纳入 v1.50.32；TA-04-3 交付已按根 AGENTS.md 统一升版 v1.50.39（含 TA-04-2 升版补录）并重编译同步 WASM 双副本，TA-04-8 核对最终产物证据，纯验证/文档收口不额外升版。
> **难度**：中（单模块内有算法/设计含量，涉及照明、模型、绘制、深度队列及配置；需包含队列模块拆分成本，原 3~8 人日仅作初估）。
> **依赖**：TA-03 ✅ 已落地（v1.50.25 / v1.50.26 / v1.50.27 枝干骨架 + 椭球叶簇 + 两遍式树冠），受光管线可直接推进；TA-04-6 须先完成深度队列相关模块拆分，TA-04-7 与 D-B1-7 共用缓存生命周期契约，实施前核对其当前状态，避免重复拆缓存。
> **范围纪律**：纯前端视觉改动，不新增 FABS 字段、不消费共享模拟 RNG、不改变通行/资源/碰撞/建造事实；装饰仍走独立 `accent_rng`。**即使纯前端改动，统一升版仍会修改 Rust 应用版本常量，实施交付须重编译 WASM 并同步双副本**（07 号 §11.5）。新增可调参数随 TA-04-2～6 对应实现同步进入配置；TA-04-7 只作最终审计，不把参数集中推迟到收口。
> **验收总入口**：07 号 §11.4「受光」行 + §11.3 性能预算（p95 新增绘制增量 ≤ 3 ms，待测目标非现有成绩）；浏览器验收必须用 Chrome（存档依赖 File System Access API，07 号 §11.5）。

## 任务序列总览

| 编号 | 任务 | 涉及文件 | 难度 | 依赖 |
| :--- | :--- | :--- | :--- | :--- |
| TA-04-1 ✅ | 照明读取与基础色受光帮助函数 + 世界光向完整屏幕投影 | `frontend/js/lighting.js` | 低 | — |
| TA-04-2 | 法线转换与点积管线：季节基础色 → 漫反射/环境光 → 光色温 | `render_accents.js` / `accent-model.js` / `config.render.js` / `lighting.js` | 中 | TA-04-1 |
| TA-04-3 ✅ | 枝干受光：少量侧面明暗表达圆柱体 | `render_accents.js` / `config.render.js` | 低 | TA-04-2 |
| TA-04-4 ✅ | 叶簇受光：低频分面/椭球体积，移除固定白色椭圆亮斑 | `render_accents.js` / `config.render.js` | 中 | TA-04-2 |
| TA-04-5 ✅ | Boulder / RockCluster 受光：带法线顶面与侧面，统一场景受光方向 | `render_accents.js` / `config.render.js` | 低 | TA-04-2 |
| TA-04-6 ✅ | 投影阴影随树高与叶量变化，地面图元单独排序 | `render_accents.js` / `render_world.js` 及拆分模块 / `config.render.js` | 中 | TA-04-2、队列模块拆分 |
| TA-04-7 ✅ | 视觉参数与缓存依赖/生命周期审计 | `config.render.js` / `accent-model.js` / `rustworld.js` | 低 | TA-04-3~6；与 D-B1-7 协调 |
| TA-04-8 | 收口：§11.4 受光验收 + 性能实测 + 门禁 + 升版与文档同步 | 全链路 | 中 | TA-04-3~7 |

## 任务明细

- [x] **TA-04-1 照明读取封装与基础色受光帮助函数（`lighting.js`）**
    - 内容：① 每帧统一读取 `SimLighting.lightDir()` / `ambient()` / `intensity()` / `tint()`（接口已暴露，§6.5）；② 在 `lighting.js` 增加面向**基础色**的独立受光帮助函数（合入柔和漫反射 + 环境光 + `intensity/tint` 光色温），保留房屋等既有调用行为——**不要在每种 accent 内复制光照公式**；③ 二维低画质路径：把世界光向**完整投影到屏幕**供渐变光心使用——`screenX = Lx*cosZ − Ly*sinZ`，`screenY = (Lx*sinZ + Ly*cosZ)*cosX − Lz*sinX`；现有 `sunScreenDir()` 只投影水平分量，不能原样作为立体树冠亮部位置；光源接近视线方向时投影趋零，应令亮部回到冠心，避免归一化抖动（§6.5 末两段）。
    - 现状核对：`shadeFace()` 是相对旧固定光的明暗校正且不直接合入 `intensity/tint`，**不能**当作新植被材质的完整照明函数；已有 `shadeRgb()` 经本项评估可直接复用（注释明示不复用 `shadeFace` 旧光逻辑，合入 intensity/tint）。
    - 出处：07 号 §6.5、§3.3「颜色计算/季节光照」行、§4.1 共用受光约定。
    - 验收：房屋/地形/族人等既有调用行为逐项不变；新帮助函数可直接以「季节基础色 + 世界空间单位法线」出漫反射颜色；相机仅参与几何与光向的屏幕投影，且不复制光照公式。
    - 依赖：无（首个任务）。
    - ✅ 落地记录（2026-09-13）：**受光帮助函数评估结论——`shadeRgb(rgb, nx, ny, nz)` 已满足设计**（基础色 × (环境光 + wrap 漫反射) × intensity × tint，输出 [0,255] 数组，v1.50.27 起已导出），无需改动；**新增 `sunScreenDirFull()`**（导出）：含 z 分量的完整世界光向屏幕投影，`len < SUN_SCREEN_EPS(0.02)` 时方向按 `len/EPS` 平滑衰减回零（亮部回冠心，避免归一化抖动与边界跳变，调用方无需分支），`valid` 标志仅供参考；既有 `sunScreenDir`/`shadeFace`/`shadeRgb` 及其消费者行为零改动。验证：`node --check` + `node tools/frontend-check.js`（35 JS 语法 + DOM ID 全绿）+ 16 项 Node 冒烟断言（公式分量、归一化、精确退化角回冠心、衰减连续性、旧固定光对照路径）全过。`SUN_SCREEN_EPS` 尚为局部常量，TA-04-2 接入消费时同步迁入 `config.render.js`，TA-04-7 复核。

- [x] **TA-04-2 法线转换与点积管线：颜色管线重构**
    - 内容：按 07 号 §6.5 的几何/法线契约，将枝干面、叶簇面法线按实际模型变换转换到世界空间，再归一化并与光向求点积；覆盖倾干剪切与椭球非均匀缩放，不仅做局部旋转。颜色管线固定为「季节基础色 → 柔和漫反射与环境光 → 光源色温」。保留两遍式树冠剪影及与视角无关的体积/AO 分档，移除 `tD` 投影深度对漫反射亮暗的驱动；同一世界表面固定光照下的颜色不因相机旋转改变。接入 Tree/Bush/Boulder/RockCluster，法线几何缓存归 `accent-model.js`，每帧受光计算归绘制层；新增参数同步配置，迁移 `SUN_SCREEN_EPS`。
    - 出处：07 号 §6.5 首段、§6.2 渲染路线、§6.7 三件套职责（模型投影与受光归 `render_accents.js`，光源真相归 `lighting.js`）。
    - 验收：临时断言验证变换后法线与切向量正交且长度为 1；同一世界表面固定基础色/光向时，转相机不改变其漫反射颜色，屏幕亮部位置随投影变化；帧耗时增量见 TA-04-8。
    - 依赖：TA-04-1。
    - ✅ 落地记录（2026-09-13）：① **`lighting.js`**——新增导出 `shadeRgbInto()` 零分配变体（公式与 `shadeRgb` 完全同源：法线归一化 → wrap 柔和漫反射 → ambient/intensity → tint 色温，结果写入调用方复用的 out 数组，逐簇高频路径零 GC），`shadeRgb()` 改为其委托；`SUN_SCREEN_EPS` 局部常量迁入 `RENDER_CONFIG.sunScreenEps`（缺省回退 0.02），`sunScreenDirFull()` 运行时读取。② **`accent-model.js`**——新增法线几何缓存（归模型层）：`attachCrownNormals()` 在 Tree/Bush 骨架构建时为每簇写入**冠包络椭球外向梯度法线** `nx/ny/nz`（`(x/rx², y/ry², (z−zc)/rz²)` 归一化，包络半轴/质心取整副骨架簇分布，id 纯函数入缓存）；`shearNormal()` 导出——倾干剪切（`x += s·z`）的逆转置变换 `n' = (nx, ny, nz − s·nx)`，依赖 `accent.rotation` 不入模型缓存，绘制层每帧施加。③ **`render_accents.js`**——颜色管线重构固定为「季节基础色 → 漫反射+环境光（法线点积，唯一入口 `accentLitFill` → `shadeRgbInto`，本层零光照公式）→ intensity/tint 色温」：**Tree/Bush** Pass B 簇本体改经世界光向受光（Tree 簇法线先过 `shearNormal` 逆转置补偿），**移除 tD 投影深度驱动**（同帧删除 dLo/dHi/dSpan 与逐簇 `proj().d` 冗余计算），冠内体积/AO 只保留与视角无关的 tZ 档（`0.80+0.20·tZ`）；Pass A 剪影、簇间画家排序、细节分级零改动；近景白椭圆高光保留（屏幕固定位置，TA-04-4 改由世界光向投影驱动）。**Boulder/RockCluster** 石面两笔（深底/浅顶）经同一管线受光——顶面法线 `(0,0,1)`、侧面取个体稳定世界方向（`rot` 水平角 + 下倾 0.45），石面亮暗首次随光向/强度/色温变化；**屏幕 billboard 几何与随相机的法线细化归 TA-04-5**。**GrassTuft** 不接入（§6.5：保留季相短草线）；主干/枝干仍为旧色（TA-04-3 接入圆柱侧面明暗）。④ **`config.render.js`** 新增 `sunScreenEps`。⑤ 验证：临时 Node vm 断言 13 组全过（Tree/Bush 各 60 株冠法线单位长度 + 梯度平行 + 曲面数值切向正交〔Newton 投影回等值面，容差计入曲率残差 O(ε)〕、`shearNormal` 单位长度且 ⊥ 剪切后切向量与曲面连线、`shadeRgbInto ≡ shadeRgb`、固定法线/光向转相机不变色、非单位法线内部归一化、`sunScreenDirFull` 消费 `sunScreenEps`、五类 accent × 3 光照模式（动态夏/冬/旧固定光）× 2 相机角绘制冒烟零异常零 NaN 色串、光向变化 → 受光颜色变化），脚本按 §4.10 已删除；门禁 `frontend-check` 35 文件全绿、`config-check` 233/233、`bump-version --check` 12/12 零漂移。⑥ **升版与 changelog 暂缓**：本次交付时工作区存在在途未提交的 v1.50.33 交付（D-B1-7 等），为不混入在途工作，本任务不动 12 个版本定义点与 changelog（版本保持 v1.50.33 基线；纯前端改动无需重编译 WASM）；统一升版与 changelog 条目随下一次代码交付（TA-04-3~5）或 TA-04-8 收口补录。

- [x] **TA-04-3 枝干受光：侧面明暗表达圆柱体**
    - 内容：枝干用**少量侧面明暗**表达圆柱体（迎光面亮、背光面暗，不以相机正面定义迎光面），随光向变化；不引入逐段贴图或过量多边形。与 TA-04-2 的管线共用同一受光帮助函数。
    - 出处：07 号 §6.5 第 2 段、§6.1 动机行「树皮亮线固定在屏幕左上」。
    - 验收：枝干存在可辨认的受光方向，旋转镜头/光向后明暗随动。
    - 依赖：TA-04-2。
    - ✅ 落地记录（2026-09-13，v1.50.39）：① **主干三色圆柱**（`drawAccentTree`）——新增 `cylinderShade()` 几何帮助函数（模块级刮擦 `_cylLit/_cylDark/_cylFront/_cylScr`，零分配）：迎光/背光法线 = 光向在垂直轴向平面内的分量（模型空间求分量 → `shearNormalInto` 剪切逆转置转世界；模型存直立骨架故模型轴 = (0,0,1)，剪切仅绘制层施加——临时断言曾捕获把已剪切轴当模型轴传入的双剪切缺陷并修正）、朝屏法线 = 视向垂直轴向分量（可见面平均朝向）、屏幕迎光方向 = 模型分量走方向剪切 + 相机投影（退化 ok=false 跳过明暗带）；体色/迎光带/背光带全部经 `accentLitFill` 单一入口（新增可选 alpha 第 8 参出 rgba），带位由世界光向屏幕投影驱动并 clip 进干轮廓防溢出，远景干宽 < `accentBarkBandMinWidthPx`(2px) 省略；**移除 v1.49.3 遗留「固定屏幕左上」树皮亮线** `rgba(158,124,92,0.5)`（§6.1 动机行收口）。② **枝条/灌木茎**（`drawAccentTree`/`drawAccentBush`）——逐段按朝屏法线受光（基色 96,70,48 / 104,78,54），段宽可辨时沿迎光侧补一条细高光（少量侧面明暗，不逐段贴图；远景段宽 < 2px 省略）。③ **配置**（`config.render.js` 5 键）`accentBarkBandOffset` 0.38 / `accentBarkBandWidthK` 0.50 / `accentBarkBandLitAlpha` 0.55 / `accentBarkBandDarkAlpha` 0.40 / `accentBarkBandMinWidthPx` 2.0；`lighting.js` 新增零分配 `lightDirInto(out)`（`drawAccentEntity` 每实体刷新 `_ld`，刮擦对象模块级复用，延续 TA-11-6 纪律）。④ **验证**：临时 vm 断言 20 组全过（法线 ⊥ 世界轴且单位长、背光=迎光反向、受光法线转相机不变而屏幕方向随相机、光向转 90° 迎光随动、光向∥轴向退化无 NaN、Tree/Bush × 3 相机角 × 2 光向冒烟零异常零 NaN、旧亮线移除、转相机/改光向受光色集合改变），按 §4.10 已删除；门禁 `frontend-check` / `config-check` 233/233 / `doc-link-check` / `cross-doc-check` / `bump-version --check` 全绿。⑤ **浏览器实测**（3002 端口 + `?nogate=1`）：临时调高带不透明度（`RENDER_CONFIG` 运行时热调，验证后刷新恢复）后，同一镜头三光位（西·52°/西北·27°/东北·29°）树干特写亮带随光向转动——西光左亮带清晰、背光侧转暗、东北光亮侧转右；旋转镜头的明暗随动由「屏幕方向 = 世界光向经相机投影」构造保证并经 vm 断言覆盖。⑥ 升版 v1.50.39（12 定义点零漂移）+ 重编译同步 WASM 双副本 + changelog 条目（含 TA-04-2 升版补录）。⑦ **§4.6 拆分随带**：本任务 +129 行使 render_accents.js 达 920 行超 800 上限，GrassTuft 绘制（`grassSeasonColor` + `drawAccentGrassTuft` + 草叶池，159 行）原样迁出为 `render_grass.js`（GrassTuft 本期不在受光范围，零行为漂移；index.html 加载顺序、两份 AGENTS、31 号代码地图同步；拆分后 777 + 159 行，五脚本 vm 冒烟 GrassTuft/Tree 绘制零 NaN）。

- [x] **TA-04-4 叶簇受光：低频分面/椭球近似体积，移除固定屏幕亮斑**
    - 内容：叶簇用**低频分面或椭球近似**表达体积；叶面以**宽而弱的亮部**为主，**移除固定白色椭圆**，避免塑料反光（§6.5 第 2 段）。同步核对 v1.50.27 近景簇高光「只给冠层上半部」的既有逻辑——该高光属屏幕固定位置，须改为由世界光向投影驱动（亮部回冠心规则见 TA-04-1）。
    - 出处：07 号 §6.5 第 2 段、§6.1「树皮亮线、冠部径向渐变和亮斑固定在屏幕左上」、任务表 TA-04 行「移除固定屏幕亮斑」。
    - 验收：默认视角与旋转视角均无固定于屏幕的白色高亮斑；亮部宽而柔和，位置随光向与相机变化。
    - 依赖：TA-04-2。
    - ✅ 落地记录（2026-09-13，v1.50.40）：① **「低频分面/椭球近似」体积表达已由 TA-04-2 承载**（每簇冠包络椭球外向梯度法线入模型缓存 + Pass B 簇本体经 `accentLitFill` 点积受光），本任务不重复实现；② **近景簇亮部重写**（Tree/Bush Pass B）——亮部中心由固定屏幕偏移（−0.28/−0.42rr、固定旋转 −0.4、`tZ > 0.30` 上半冠启发式）改为**沿屏幕光向偏移** `it.px + _sunScr.x·rr·offK`（`_sunScr` 经新零分配 `SimLighting.sunScreenDirFullInto` 每实体刷新；光近视线投影 len→0 平滑回簇心，落实 TA-04-1 退化规则）；强度衰减由受光管线承担——亮色 `(255,252,218)` 经 `accentLitFill` 按簇法线（Tree 过 `shearNormalInto` 剪切逆转置、Bush 无剪切即世界法线）点积着色，迎光亮/背光自然衰减，**取代「只给上半冠」tZ 启发式**；椭圆放大宽而弱（`0.55rr×0.42rr`、峰值 alpha 0.16，旧 `0.42rr×0.30rr`、0.20/0.18），远景簇半径 < `accentCrownLitMinPx`(2.2px) 省略；③ **配置**（`config.render.js` 5 键）`accentCrownLitOffset` 0.45 / `accentCrownLitRxK` 0.55 / `accentCrownLitRyK` 0.42 / `accentCrownLitAlpha` 0.16 / `accentCrownLitMinPx` 2.2，`crownLitCfg()` 同 `barkBandCfg` 姿态（缺省回退 + 零 GC 复用对象）；④ **死代码清除**——`accentLeafPalette` 旧叶簇渐变色板（hi/rim/dapDark/dapLite，v1.50.27 两遍式树冠重构后零引用）整函数移除，07 号 §6.1「冠部径向渐变和亮斑固定屏幕左上」动机行全部收口（树皮亮线归 TA-04-3、冠部渐变/白斑归本项）；⑤ **验证**：临时 vm 断言 17 组全过（`sunScreenDirFullInto ≡ sunScreenDirFull` 且零分配写回 out、亮部中心 = 簇心 + 屏幕光向×rr×offK 逐椭圆匹配、相机旋转 90° 后按新投影公式复验、退化光向亮部回簇心、迎光法线亮部色亮于背光、5 类 × 3 相机角 × 2 光向冒烟零 NaN、`offset/MinPx` 热调生效、光向反转颜色集合改变），按 §4.10 已删除；门禁 `frontend-check` 36 文件 / `config-check` 233/233 / `cargo test --lib` / `test-wasm` / `test-determinism` 6/6 全绿；⑥ 升版 v1.50.40（12 定义点零漂移）+ 重编译同步 WASM 双副本 + changelog 条目。

- [x] **TA-04-5 Boulder / RockCluster 受光：带法线的顶面与侧面**
    - 内容：`drawAccentBoulder` 与 `drawAccentRockCluster` 的子石同步改为带法线的顶面与侧面，亮暗由同一世界光向决定，不固定规定顶面总比侧面亮；共用受光帮助函数及岩石基础色，保持子石只为视觉几何。GrassTuft 本期保留季相短草线，不新增立体法线或投影模型，不将其计入已完成动态受光的范围。
    - 现状核对：`drawAccentBoulder(sx, sy, scaled, rot, cosZ, sinZ)` 目前无受光参数、无法线分面；RockCluster 已实现，但仍使用固定深底/浅顶色。（✅ 该核对为 TA-04-2 前快照：TA-04-2 已将两笔石面接入 `accentLitFill` 管线，TA-04-5 补齐 billboard 移除与随相机法线细化。）
    - 出处：07 号 §6.5 第 2 段、§11.4「受光」行（枝干/树冠/**灌木/岩面**亮部和地面投影协调）。
    - 验收：Boulder 与 RockCluster 子石亮暗方向均与同场景树/灌木一致，随光向与相机协调变化。
    - 依赖：TA-04-2。
    - ✅ 落地记录（2026-09-13，v1.50.45）：① **`render_accents.js` 新增共用石体受光几何 `drawStoneBody`**（Boulder 与 RockCluster 子石同一入口）——棱柱轮廓随相机投影：底环 z=0 落地、顶环抬 `accentStoneHeightK×r`（`config.render.js` 新键，缺省 0.30），世界方位角顶点经相机 rotZ/cosX 投影（**billboard 移除**，轮廓与侧面片随相机旋转，与树/灌木同一套投影约定）；侧面逐面片法线 = 面片中点世界水平方向（直立壁 nz=0，取代旧「下倾 0.45」假法线），顶面法线 (0,0,1)，亮暗全部经 `accentLitFill` 世界光向点积——低角度阳光下面向光源的侧面可亮过顶面（亮暗次序随光向反转）；画序 = 侧面片 → 顶面（覆盖远侧片）→ 剪影描边（远侧取顶环 / 近侧取底环按 ry 符号判别）；底边贴落地点 = v1.50.13「精灵底边贴锚点」契约的几何化重述（cy = gy − max(rv·sinB)·cosX）；**移除旧 Boulder「+0.18r 固定右下偏移假侧面」与 RockCluster「0.72 固定屏幕纵压 billboard」**；零 GC（Float64Array 刮擦，sides ≤ 7）。② `drawAccentBoulder` 收敛为 `drawStoneBody` 单石包装（七边形变径公式逐位一致、lite=0.5 零偏移）；`drawAccentRockCluster` 石体循环改调 `drawStoneBody`，`stoneBase` 移除（lite 色差内联，岩石基础色两处共用同一常量路径）。③ 验证：临时 vm 断言 16 组全过（顶点屏幕方位 = 世界方位 + rotZ、迎光面片 0.859 > 背光 0.526、低角度侧面 0.885 > 顶面 0.763 / 高角度反转、固定光向转相机颜色逐位一致而位置随动、36 组相机×光照冒烟零 NaN、最低子石剪影底边精确贴落点、Tree/Bush/GrassTuft 回归、heightK 热调生效），按 §4.10 已删除；门禁 `cargo test --lib` / WASM 重编译双副本 / `test-wasm` / `test-determinism` 6/6 / `config-check` 239/239 / `frontend-check` / `doc-link-check` / `cross-doc-check` / `bump-version --check` 全绿。④ 升版 v1.50.45（12 定义点零漂移；基线已是 v1.50.44 合流版）+ 重编译同步 WASM 双副本 + changelog 条目。render_accents.js 拆分后 779 行（< 800 上限）。

- [x] **TA-04-6 投影阴影随树高与叶量变化 + 地面图元排序**
    - 内容：树与灌木投影继续复用 `shadowOffset(height)` 的世界光向与影长，按模型实际世界高度（模型高度 × accent.scale，不含 camera.zoom）及叶量改变覆盖与强度；夏季冠影完整，冬季以稀疏枝影和弱接地影为主。阴影作为地面图元独立加入统一深度队列，绘制逻辑归装饰层、入队和分发归队列层；删除实体绘制内对应旧阴影以免重复绘制，不新增整层阴影覆盖。样板可用簇影近似，无需逐叶阴影贴图。
    - 模块前置：`render_world.js` 当前 905 行，扩展前先将深度队列相关职责拆为单一职责模块，保持绘制行为；同步脚本加载顺序、局部 AGENTS.md 和代码地图，拆分后相关文件均应符合 800 行上限。该拆分归本项前置，不遗漏在文件范围之外。
    - 现状核对：树影已有 `shadowK = 0.55 + 0.45 * leaf` 叶量缩放，也已通过 `lightShadowOffset` 使用世界光向；问题是传入固定高度 2.0，并对屏幕偏移 x/y 分别乘 0.7/0.4，灌木也有类似近似。需改为真实高度驱动并消除屏幕轴向缩放造成的方向偏差。
    - 排序与落点：由世界落点及阴影覆盖范围计算接收地表高程、足迹深度和剔除范围，不沿用树根/树冠深度；坡地样板验证贴地，不让远处阴影压住近处实体。大范围阴影若单项排序失败，拆为有限地面子项，不承诺逐像素投影正确。
    - 出处：07 号 §6.5 末段、§4.1「地形、房屋体块、族人投影与植被共用同一受光约定」、§11.4「受光」行。
    - 验收：夏影较完整、冬影稀疏减弱；高树比矮树影长、改变 zoom 不重复缩放；光向/相机变化时影偏移正确；平地与坡地均贴地，阴影不会被错误盖掉或压住前景实体，不参与拾取且不遮挡选中信息（§11.2 最小遮挡样板口径）。
    - 依赖：TA-04-2；本项先完成队列模块拆分。
    - ✅ 落地记录（2026-09-13，v1.50.46）：① **模块前置完成**——`render_world.js` 909 行超限，深度队列职责（DEPTH_* 常量 + 对象池 + `_surfaceDepth`/`_decalDepth` + `MAP_Z_LIFT`/`projectLifted` + `RC` + `drawWorldEntities` 收集/分发 + `collectCampHouseLinks`）整体迁出为 **`render_depth_queue.js`**（458 行），render_world.js 瘦身至 507 行（保留 POI/房屋/道路绘制与 `lightShadowOffset`/`shadeHex`），纯代码搬移零行为变更；index.html 加载顺序、frontend/AGENTS.md、31 号代码地图、16 号前端概览同步。② **新增 `render_shadows.js`**（96 行，装饰层）——`drawAccentShadowGround` 三段影（接地弱影 + 稀疏枝影 α∝1−leaf + 冠影随叶量 0.30+0.70×leaf 收缩淡出，夏完整/冬稀疏）；影长 = `trunkH × accent.scale` 实高经世界光向 `shadowOffset` 驱动（zoom 只乘一次），屏幕偏移沿影向量整体落位 + 椭圆按影向旋转，**移除旧 0.7/0.4 轴向缩放**（现状核对两项缺陷收口）；远景 `accentShadowMinPx`(2.5px) 省略。③ **队列层**——新增 `DEPTH_ACCENT_SHADOW=12`：入队深度 = 世界落点（基点 + 影梢）`_decalDepth` 足迹深度取大，影梢 = 锚点 + 世界阴影方向（`SimLighting` 新增零分配 `shadowDirInto`）× 影长 × 实高，不沿用树根/树冠深度；分发调 `drawAccentShadowGround`；`drawAccentTree`/`drawAccentBush` 实体内旧阴影块删除；阴影半透明不参与拾取、不遮挡选中信息。④ **config.render.js 新增 4 键**（accentShadowAlpha 0.17 / GroundAlpha 0.12 / BranchAlpha 0.10 / MinPx 2.5）。⑤ 验证：临时 vm 断言 19 组全过（影向量逐轴精确、zoom 翻倍偏移翻倍、scale×2 偏移×2、夏 2 笔/冬 4 笔且冬冠影 α 显著弱、枝影沿影向、队列仅 Tree/Bush 入项且分发正确、影深度 decal 抬升、冒烟零 NaN、旧阴影源级删除、四文件 ≤ 800 行），按 §4.10 已删除；门禁 `cargo test --lib` / WASM 重编译双副本 / `test-wasm` / `test-determinism` 6/6 / `config-check` 239/239 / `frontend-check` 37 文件 / doc 三检 / `bump-version --check` 全绿。⑥ 升版 v1.50.46（12 定义点零漂移）+ 重编译同步 WASM 双副本 + changelog 条目。

- [x] **TA-04-7 视觉参数与模型缓存依赖审计**
    - 内容：复核 TA-04-2～6 新增可调参数已随实现进入 `config.render.js`；沿用 `config.lighting.js` 的共用光源参数，不另建光照公式或重复配置。纯视觉参数不进入 SIM_CONFIG/WASM/SimConfig 校验链路。
    - 缓存：按 07 号 §10.2 区分局部几何与每帧受光。局部几何缓存键覆盖实际几何输入（kind/id/风格版本及影响几何的参数或等价失效机制），几何结构或生成参数改变时递增 `accentModelStyleVersion` 或显式失效；仅改每帧光色不要求重建骨架。世界生命周期统一清理，世界数据参与几何派生时还需覆盖世界内容身份。季节/光向/相机不参与的纯几何无需将这些值塞入键，不缓存组合精灵，保留内存上限。
    - 分工：D-B1-7 负责静态数据通道的“未发送/空集合”语义与总体缓存拆分；本项负责受光新增缓存的依赖和接入验证。READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 清理模型缓存；`STR_TAB.start_index==0` 仅清理字符串驻留表，不替代模型生命周期。若 D-B1-7 未落地，可使用既有生命周期完成受光接入，不重复实施其拆分。
    - 出处：07 号 §10.2、§10.4、§6.7；06 号 §18.4 缓存更新契约。
    - 验收：实现文件无新增散落的可调参数；改变光向/季节不重建无关骨架；改变几何参数会失效；换世界/读档/REWIND/RESET 后结果等于冷缓存重建，同 ID 不串入旧世界数据；不要求同输入纯函数生成不同形态。
    - 依赖：TA-04-3～6；实施前核对 D-B1-7 状态。
    - ✅ 落地记录（2026-09-13，纯审计**零代码变更**）：**D-B1-7 状态核对**——已完整落地（v1.50.33，TODO.md 勾选 + 06 号 §18.4 契约标实施），`_invalidateWorldStaticCaches()`（rustworld.js:306）在 READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE 四事件调用 `AccentModel.resetCache()`，与 `SnapshotBin.resetCaches()`（STR_TAB 字符串驻留表）互不替代——TA-04-7 无需新建任何生命周期接入点。① **参数线**：TA-04-2～6 新增 16 键（`sunScreenEps` 1 / `accentBarkBand*` 5 / `accentCrownLit*` 5 / `accentStoneHeightK` 1 / `accentShadow*` 4）全部集中在 `config.render.js`，消费侧（`lighting.js` / `render_accents.js` 的 `barkBandCfg`/`crownLitCfg`/`rockHeightK` / `render_shadows.js::accentShadowCfg`）缺省回退与集中值逐键一致；零键进入 `config.js`（SIM_CONFIG/WASM/SimConfig 校验链路隔离）；`config.render.js` 不含任何光源参数（光位/强度/色温唯一来源 `config.lighting.js`，无重复定义）。② **缓存线**：模型缓存键 `'v'+styleVersion+'#'+kind+'#'+id`（§10.2 契约）——冠法线缓存（`attachCrownNormals`）寄居 Tree/Bush 骨架缓存随建随失效，法线单位长度；TA-04 新增 21 个受光/LOD 非几何参数（含全部 16 键）变更后模型返回**同一缓存对象**、骨架逐位一致（光向/季节/相机不入键，不重建无关骨架，无组合精灵缓存）；几何生成参数（簇数/子石数/株高等）按**等价失效机制**不单独入键、递增 `accentModelStyleVersion` 即整体重建且新参数生效；`resetCache()` 后重建 ≡ 冷缓存逐位一致、同 id 异 kind 不串型（kind 入键）、换世界后无旧世界残留（模型为 accent.id 纯函数）；内存上限 `_CACHE_MAX=2048` + 超限整体清空在位。③ **验证**：临时 Node vm 断言 52 组全过（vm 沙箱装载真实 config.render.js + accent-model.js 做缓存行为断言 10 组；16 键引用 + 回退一致 + SIM_CONFIG 隔离 + 光源参数唯一来源 20 组；缓存键卫生 + 四事件生命周期接入静态断言 8 组；另 14 组骨架/法线行为断言），脚本按 §4.10 已删除；门禁 `frontend-check` / `config-check` 239/239 / `bump-version --check` / `doc-link-check` / `cross-doc-check` / `doc-maintenance-check` 全绿。④ **交付口径**：零代码变更（仅本文档与 07 号 §10.4 行数事实刷新），按 §4.0.1 纯文档变更不升版、不重编译 WASM、不新增 changelog 版本条目；TA-04-8 收口时复用本记录。

- [ ] **TA-04-8 收口：受光验收 + 性能实测 + 最终产物门禁 + 文档同步**
    - 受光验收：按 07 号 §11.4，在 Chrome 中固定种子、配置、存档、窗口/DPR、设备与视觉时刻，覆盖四季 × 四方位 × 远中近 × 低高俯角，包含 Tree/Bush/Boulder/RockCluster、平地与坡地阴影。固定季相改变光向使用临时视觉夹具，不改生产模拟字段；另走真实快照推进、暂停、LOAD/REWIND/RESET、高倍速与动态光开关开→关→开的端到端流程。关闭动态光使用既有固定世界光，亮暗与投影仍协调。
    - 性能基线：使用 `cd89213`（TA-04-1 已交付、实体受光尚未接入）为本轮基准，记录最终候选提交、前端及 WASM 产物指纹、完整配置、设备/Chrome 版本、分辨率/DPR、人口与装饰数量、倍速。跨版本存档按应用版本门禁处理，两端以相同 seed/config/tick 分别建立本版本存档，不强行加载旧版本档。
    - 性能测量：按 07 号 §11.3，在初始与高密度负载下分别测固定镜头和连续拖动/跟随镜头，预热后各采样至少 60 秒。报告两端原始 p95 与差值（同一计时边界包含阴影入队、排序及绘制），同时记录总渲染/UI 耗时、仿真吞吐、视觉缓存内存、读档/重置及相机变动首帧和重建 p95。不得减少模拟 tick 掩盖开销。
    - 预算：新增绘制 p95 增量 ≤ 3 ms；参考桌面主线程渲染/UI p95 ≤ 16 ms；吞吐下降不超过约 5%（重复确认噪声）；新增视觉缓存按 64 MiB 初始预算控制。重建延迟单独与基线比较，明显回退须处理。超标先优化并复测；仅记录超标不能标完成。确需调整预算时，先形成具体测量与取舍并取得用户明确接受，再同步 07 号预算及本项，保留原始结果。
    - 交付顺序：每次代码交付按根 AGENTS.md 先统一升版、重编译并同步 WASM 双副本，再对最终产物执行 `cargo test --lib`、`frontend-check.js`、`test-wasm.js`、`config-check.js` 及适用确定性门禁。执行文档维护/链接/跨文档检查及 `bump-version.js --check`，不可用升版前测试替代最终产物证据。纯验证/文档收口复用匹配最终产物的已有证据，缺证据才补验，不额外升版、构建或新增 changelog 版本条目。
    - 文档同步：实际通过后更新 07 号 §1.2/§6.5 状态、现状 17 号受光接口与相关模块文档、`frontend/AGENTS.md`、受拆分影响的代码地图/加载顺序、roadmap §8.1 专项 21；代码交付在 `docs/current/01-changelog.md` 记录对应版本。TA-05 样板闭环仍独立跟踪，不因本项通过自动勾选。临时夹具、断言和测量脚本不进入提交。
    - 出处：07 号 §11.3～§11.5；根 AGENTS.md §4.0/§4.1/§4.9/§4.10。
    - 验收：视觉、生命周期、性能预算与最终产物门禁全部通过后才标完成；预算变更按上条明确接受后的版本验收。
    - 依赖：TA-04-3～7。

## 验收口径速查（07 号 §11.4「受光」行）

| 验收项目 | 通过标准 |
|---|---|
| 受光 | 固定季相改变光向时，枝干/树冠/灌木/岩面亮部和地面投影协调；固定世界光向转相机，亮部不黏在屏幕左上 |
| 性能 | 按 TA-04-8 完整矩阵与预算验收；超标仅记录不能视作完成 |
| 生命周期 | 暂停/读档/回溯可重建；换世界缓存结果等于冷重建、不串旧数据；动态光开关往返正常；高倍速不频闪 |
