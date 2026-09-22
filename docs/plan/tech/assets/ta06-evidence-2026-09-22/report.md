# TA-06 验收报告 · 植被轮廓与物种变体（WebGL 实况补做）

> **日期**：2026-09-22 ｜ **应用版本**：v1.52.0（HEAD `920cb57`）｜ **任务**：TA-06 ｜ **方案**：[07 号 §6.3/§11.4](../../07-terrain-art.md)
> **结论**：**◐ 部分通过**。TA-06-9（景观共用通道 + 生命周期断言）**通过**；TA-06-10（视觉·受光·四季矩阵 + 证据包）**主矩阵与专项全部取证通过，唯真实 Chrome 存档 LOAD 链路 NOT_RUN**（预览浏览器无 File System Access API，同 TA-05 缺口）；TA-06-11（性能 A/B）**经用户确认取消**（理由：当前已无性能问题，同 TA-07-10 口径）。TA-06-1（Chrome 截图基线）仍为缩减态，同原文记录。

---

## 1. 环境与取证方式

| 项 | 值 |
| :--- | :--- |
| 浏览器 | 内置预览浏览器（Chromium/Playwright CLI，`playwright-cli -s=<session>`），非 Chrome |
| 入口 | `http://localhost:3000/index.html?seed=<n>&nogate=1`（不碰存档文件，仅内存演算） |
| 渲染路径 | **默认 WebGL**（`RENDER_CONFIG.useWebgl = true`、`accentWebglEnabled = true`）；装饰几何仍由 `render_accents.js` / `render_bush.js` / `render_grass.js` 生成，经 `WebGLAccentLayer` sink 出 GPU（`accent-renderer.js` 只做三角化+AA+深度对齐，**不复制几何/受光公式**） |
| 视口 | 1280×720 CSS px，DPR 1（`ctx.setTransform` 承担 DPR ⇒ LOD 档位 DPR 无关） |
| 场景 A（主） | `?seed=8` → **`river_valley_v1`（T2）**，装饰 217（Tree 40 / Boulder 20 / Bush 25 / RockCluster 12 / GrassTuft 120） |
| 场景 B | `?seed=1` → **`mountain_pass_v1`（T1）**，装饰 217（换世界对照用） |
| 场景 C（高密） | `?seed=3` → **`grassland_plain_v1`**，装饰 **1025**（GrassTuft 960） |
| 断言场景 | `?seed=42` → `flat_baseline`，装饰 217（物种分布取样 2000 id × 2 kind） |

**现场覆写方式**：`sim.isPaused = true` 后覆写 `sim.currentSeason` / `sim.seasonProgress`（季节）、`camera.rotX/rotZ/zoom/panX/panY`（机位）、`SIM_LIGHTING.azimuthOffsetDeg` + `SimLighting.markDirty()`（光向）；机位用 `project3D()` 反算把目标世界坐标钉到屏幕定点（pan 为纯平移，一次即中）。**逐张回读校验**：矩阵 96 张每张都记录注入返回值与 `zoom / rotZ / rotX / pxPerM / season` 回读（见 `manifest.json` 的 `matrix_readback`）。

> ⚠️ **过程坑（已排除，非产品问题）**：① `playwright-cli eval` 的**源码长度上限约 700 字符**（3 KB 静默失败），故全部断言拆为 13 个分块（每块 <700 字符）并以 `--filename` 落盘；② PowerShell 5.1 读取**无 BOM 的 UTF-8 `.ps1`** 时按 GBK 解码，中文注释末尾的 `）` 会吞掉行尾换行、把下一行代码并入注释 ⇒ **本轮全部脚本改用 ASCII-only**，否则矩阵注入会整段静默失效（首轮 96 张即因该原因全部停留在默认机位而作废重拍）；③ GL 光照有 `lightRev` 闸，只改 `azimuthOffsetDeg` 不触发 uniform 重传，**必须同时调 `SimLighting.markDirty()`**。

---

## 2. 逐张像素指标（`metrics/matrix.json`）

每张截图计算：`meanRGB`、`greenRatio`（`g>r+8 && g>b+8`）、`brownRatio`（`r>g>=b && r-b>25`，裸枝/土色代理）、`brightRatio`、**最亮 10% 像素质心**（`brightCentroidNorm`，归一化屏幕坐标）。四维聚合：

| 维度 | greenRatio | brownRatio | meanRGB | 最亮质心 (x,y) |
| :--- | ---: | ---: | :--- | :--- |
| Spring | 0.4843 | 0.0562 | (78,102,73) | (0.487,0.442) |
| Summer | 0.4748 | 0.0680 | (91,114,75) | (0.489,0.450) |
| **Autumn** | 0.4137 | **0.1017**（峰值） | (85,100,67) | (0.504,0.473) |
| **Winter** | 0.4793 | **0.0168**（最低） | **(60,81,66)**（最暗） | (0.499,0.434) |
| az0（相机 0°） | 0.5006 | 0.0606 | (81,103,72) | **(0.401,0.546)** |
| az90 | 0.4484 | 0.0670 | (78,99,71) | **(0.346,0.375)** |
| az180 | 0.4501 | 0.0550 | (77,97,69) | **(0.610,0.301)** |
| az270 | 0.4531 | 0.0602 | (77,98,70) | **(0.622,0.577)** |
| zoom 1.0（远景档） | 0.2877 | 0.0249 | (58,71,57) | (0.500,0.432) |
| zoom 2.5（中景档） | 0.5341 | 0.0512 | (83,104,70) | (0.506,0.459) |
| zoom 6.0（近景档） | 0.5673 | 0.1059 | (95,122,84) | (0.478,0.458) |

**读法与边界（如实说明）**：`greenRatio` **不是落叶程度的干净代理**——地形基底本身是绿色（草地/苔绿），故冬季仍达 0.479；季节可辨性由三组独立证据共同支撑：① 上表 **meanRGB 夏 → 冬显著转暗**（R −34%、G −29%）与 **秋褐峰值 / 冬褐谷值**；② 每张 96 视图的逐张指标（`matrix.json`）；③ **数值层叶量扫掠**（§3：落叶树/灌木冬季 0.03 / 0.04，夏季 1.0；常绿全年 ≥0.94）与 `visual/variants/` 的同株春夏/冬近景对照。**zoom 维度**的 greenRatio/brownRatio 单调上升（0.288→0.567 / 0.025→0.106）与「远景整片地被、近景露枝干与土面」的分档语义一致。

---

## 3. 页内数值断言（`metrics/fixture-assertions.json`）

`?seed=42&nogate=1`，2000 样本 × 2 kind + 真实世界 217 装饰 + 景观通道全量。**10 项判定全部 PASS**：

| # | 断言 | 实测 |
| :--- | :--- | :--- |
| 1 | 物种分布落在权重 ±3% | 乔木 broad 0.4135 / sparse 0.3360 / conifer 0.2505（权重 0.42/0.34/0.24，最大偏差 **0.006**）；灌木 multiStem 0.5555 / flowering 0.2350 / lowEvergreen 0.2095（权重 0.56/0.24/0.20） |
| 2 | 非植被零影响 | `speciesOf('GrassTuft'/'Boulder'/'RockCluster', …)` 全部 `undefined` |
| 3 | `multiStem` 与旧基准逐值一致 | 40 个**不同 id** 全过：`trunkH 4.2` / `crownR = 5.5+1.2×vSeed` / 茎数 4~6 / `crownSquash 0.72` / `footprintR 8` / `flowers === null`，`bad = []` |
| 4 | 真值包围体 ≤ 一级粗剔常数 | 300 id × 5 kind **零越界**：Tree rH ≤11.825 / zMax ≤17.269（常数 13.5 / 18）；Bush 5.652 / 8.028（6.5 / 8.5）；Boulder 7.20 / 1.80（7.2 / 1.8，逐值相等）；RockCluster 6.913 / 1.244（11 / 3）；GrassTuft 4.851 / 7.457（5.5 / 7.5） |
| 5 | 花位与花色板 | 300 个灌木 id 中 77 个 flowering（25.7%）；`maxDots = 9 = accentFlowerDotsMax`；三色槽位 250/218/225（板 0.30/0.26/0.27）；**非花灌木 223 个全部 `flowers === null`** |
| 6 | **景观共用通道物种一致** | 18 组景观 / **57 个 Tree+Bush 子图元**，`L#` 通道派生物种与 accent 通道同 seed **逐对一致（失配 0）**；子图元 `footprint` 恒为配方常量 8（**与物种无关** ⇒ 保护区判定口径不变）；Wood 12 / Berry 7 / Water 4 子图元 |
| 7 | 暖缓存 == 冷重建 | 8 个 id 的骨架签名（长度+crownR+trunkH+silhouette+profile）`resetCache()` 前后**完全一致** |
| 8 | 四季叶量 | 落叶树 Spring 0.42 / Summer 1.00 / Autumn 0.934 / **Winter 0.03**；常绿树 0.96/1.00/0.98/**0.94**；落叶灌木冬 **0.04**；常绿灌木冬 0.94 |
| 9 | 花历 | floweringBush Spring **0.855**、夏/秋/冬 **0**；落叶灌木/落叶树/常绿全年 **0** |
| 10 | 三档真实覆盖 | zoom 0.6 → far 60 / mid 5 / near 0；zoom 1 → 35/30/0；zoom 1.6 → 3/48/14；zoom 2.5 → 0/23/42；zoom 4 与 8 → 0/0/65（全图 130 个 Tree+Bush 个体，near 数量单调不减） |

---

## 4. 视觉矩阵与专项（`visual/`）

### 4.1 主矩阵 96 视图 + 8 张拼图
四季 × 四方位（`rotZ` 0/90/180/270）× 两俯角（`rotX` 1.05 / 0.55）× 三缩放（`zoom` 1.0 / 2.5 / 6.0），目标点为**装饰最密处**（`__TGT`，seed 8 上为 (-84.6, -296.4)）。原始 96 张存于工作区（未入库）；入库为 **8 张拼图**（`visual/sheets/sheet_t{1,2}_{Spring,Summer,Autumn,Winter}.png`，每张 3×4 = 12 格：4 方位 × 3 缩放）+ **6 张代表帧原图**（`visual/matrix/`，春/冬 × 远景/近景、夏低俯角、秋反向方位）。

### 4.2 6 变体近景 12 张（核心证据）
`visual/variants/T2_<variant>_<Spring|Winter>.png`，zoom 8（近景档）、同机位同目标：阔冠 `broad` / 疏冠 `sparse` / 锥形常绿 `conifer` / 落叶多茎 `multiStem` / 花灌木 `flowering` / 低矮常绿 `lowEvergreen`。冬季 6 张用于核对**裸枝铁律**（枝条全年保留、冬季叶量 0~5%、无整团半透明冠云）与常绿轮廓不变。

### 4.3 受光分离（`visual/lighting/`，8 张）
- **A · 固定世界光向转相机**（4 张 `fixedlight_rotZ000/090/180/270.png`）：四张回读 `lightDir` **完全相同**（(0.682, 0, 0.731)），仅相机 `rotZ` 变化；最亮质心从 (0.190,0.675) → (0.295,0.165) → (0.813,0.258) → (0.722,0.811) **大幅移动** ⇒ **亮部不黏屏幕固定位置**（不黏左上）。
- **B · 固定季相变光向**（4 张 `az0/90/180/270.png`）：`SIM_LIGHTING.azimuthOffsetDeg` 置 0/90/180/270 + `markDirty()` 后，回读 `SimLighting.azimuthDeg()` = 31.9 / 121.9 / 211.9 / 301.9（每档 +90°）、`lightDir` 同步旋转；**四张截图 md5 全不相同**（84BFE2C8AA4F / 9D76EC3C35E4 / CB514D8DD064 / 8652873010BC）⇒ GL 侧确实重绘。最亮质心 (0.340,0.396) → (0.259,0.354) → (0.770,0.710) → (0.812,0.752)。

### 4.4 生命周期（`visual/lifecycle/`，3 张）
`after_resume_pause_resetcache.png`（恢复推进 → 暂停 → `AccentModel/LandscapeModel/LandscapeMask.resetCache()` 后画面正常）、`world_seed1.png`（`mountain_pass_v1` 217）、`world_seed8.png`（`river_valley_v1` 217）——构成 **A(seed8) → B(seed1) → A(seed8)** 换世界链路，无旧世界残留、无异型串色。高倍速/REWIND/RESET 的逐帧像素一致性本轮未取（属 §5 限制项）。

### 4.5 高密世界（`visual/density/`，2 张）
`grassland_plain_v1` 1025 装饰（GrassTuft 960）：`density_zoom1.png`（远景：草甸成片、greenRatio 0.2945）、`density_zoom4.png`（近景：草叶与穗可辨、greenRatio 0.9500）——远景不糊成一片、近景不缺细节。

---

## 5. 未做项与已知偏差（如实记录，不勾选为已通过）

1. **真实 Chrome 存档 LOAD 链路 NOT_RUN**：预览浏览器无 File System Access API。这是 TA-06-10 与 TA-05 的共同缺口，**建议合并为同一次 Chrome 存档会话补测**（07 号 §0.2）。
2. **性能 A/B（TA-06-11）已取消**（2026-09-22，用户确认）：理由「当前已无性能问题」，与 TA-07-10 同口径。
3. **TA-06-1 Chrome 截图基线**仍为缩减态（仅源码级核对），未建立无变体基线截图——本轮矩阵**不能**作为「变体 vs 无变体」的 A/B 基线，只能作为形态/季节/受光的现状证据。
4. **★ 阴影代理与实体几何的非完全同源（已知偏差，用户决定不改代码）**：`webgl/layers/accents/shadow-pass.js` 的冠簇椭球竖直压扁取**常数 0.85**，而实体画面读模型 `sk.crownSquash`（multiStem/flowering 0.72、conifer 0.62、lowEvergreen 0.55）；`sk.footprintR` 的唯一消费点是 `DEPTH_ACCENT_SHADOW` 深度项，而 GL 路径下 `render_shadows.js` 首行早退（贴地影改由阴影图承担）⇒ 该值对 GL 画面零影响。**判定**：阴影图是「保守代理近似」（2048² 纯深度 + PCF 模糊），0.85 偏大反而保证不漏影；作为设计取舍记录，本轮不动代码（TA-06-8 的「阴影冠幅与实体一致」在 WebGL 侧由 `shadow-pass.js` 读 `sk.crownR`/`sk.trunkH` 满足，仅扁压系数非同源）。
5. **TA-07 相关的 LOD 细节未测**（缩放扫掠零闪烁、漏画逐个体比对）：TA-07 已取消视为完成（实现保留），其验收不再作为独立任务执行；本轮仅覆盖 TA-06 范围内的三档真实覆盖（§3-10）。
6. **DPR 无关性**未做 DPR 1.25 实测（本轮 DPR 固定 1，取 `ctx.setTransform` 承担 DPR 的设计结论）。

---

## 6. 归档清单

- `manifest.json`：42 个入库文件的路径 / 说明 / sha256(16) / 字节数（含矩阵逐张相机回读记录）
- `metrics/matrix.json`：96 视图 + 12 变体 + 16 专项截图的逐张指标 + 四维聚合
- `metrics/fixture-assertions.json`：10 项断言的判定与原始结果
- `visual/{variants,matrix,sheets,lighting,lifecycle,landscape,density}/`：截图（变体近景为原分辨率；其余为 50% 缩图；原始 96 张 1280×720 与全部脚本保留在工作区 `…\WorkBuddy\…\ta06\`，未入库）
