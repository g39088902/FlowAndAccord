# TA-05-1 · 基线清单与结论报告

> 任务定义：TA05-technical-plan.md §4「固化工作区、版本、配置、WASM 与运行设备；核对已有受光路径；建立修改前性能基线」。
> 退出条件：「基线清单完整；记录既有高密拖动超标，未将其豁免」。
> 记录日期：2026-09-14 · 操作者：CatPaw · 工作区 HEAD `027af1d`（详见 [manifest.json](./manifest.json)）。

## 一、基线清单核对表

| # | 清单项（方案 §3.3） | 状态 | 证据 |
| :--- | :--- | :--- | :--- |
| 1 | 源码提交及未提交补丁 | ✅ PASS | HEAD `027af1d`；未提交补丁仅 4 个文档/台账文件，diff SHA256 `e6081e26…0116d`（manifest §git） |
| 2 | 应用/生成器/存档版本 | ✅ PASS | v1.50.52；`TERRAIN_GENERATOR_VERSION=8`（terrain.rs:733，7→8 于 b7f63a5/v1.50.49）；`SAVE_FORMAT_VERSION=7`；FABS `FORMAT_VERSION=3` |
| 3 | 两份 WASM SHA256 | ✅ PASS | 双副本 SHA256 一致 `de98896c…b75f`（md5 `6ae5209e…7932c`） |
| 4 | 完整模拟/渲染/光照配置 | ✅ PASS | 以文件 SHA256 固化：config.js / config.render.js / config.lighting.js / config.house-upgrade-cost.js / config.decision-order.js / examples/config.json（manifest §config_files_sha256） |
| 5 | seed、实际 profile、tick、存档 | ◐ 部分 | seed 42、tick 4,178,620（高密负载点）、装饰 157 已记录；**同版本存档文件未建档**（预览浏览器无 File System Access API；NOT_RUN → TA-05-2/TA-05-5 在 Chrome 中补） |
| 6 | 三个对象身份 | ⬜ NOT_RUN | 属 TA-05-2（筛选落叶 Tree/Bush/Boulder），本任务不含 |
| 7 | 设备/OS/Chrome 版本 | ✅ PASS | macOS 26.3.1、Apple M2 16GB、Chrome 152.0.7977.83（已装未用，见 #9） |
| 8 | GPU/刷新率/DPR/视口 | ✅ PASS | Metal 4、2×60Hz；实测会话 DPR=2、CSS 1160×814、canvas 1450×1017（manifest §browser_session_baseline） |
| 9 | 浏览器环境声明 | ✅ PASS | 本轮基线在 **CatPaw 预览浏览器（Chromium 148，`?nogate=1` 受控性能会话）**采集。按已更新口径（根 AGENTS.md §4 铁律 / 27 号 §7）：沙箱禁止外启浏览器时内置预览浏览器 + `?nogate=1` 为合法性能验证环境，本基线作为 A 端同环境基线有效；Chrome 152 环境复测降为可选对齐项（若两端同环境则差分结论不受影响） |
| 10 | 人口/房屋/可见装饰数量、倍速、相机、季相、光向 | ✅ PASS | 见 [baseline-ta051.json](./metrics/baseline-ta051.json) 各 case.load；倍速 2x（≈125tps）；季相/进度逐 case 记录 |

## 二、既有受光路径核对（全部核对通过，未发现需 TA-05 修复的缺陷）

| 契约点 | 证据（file:line） | 结论 |
| :--- | :--- | :--- |
| 光相唯一来源 = 原始快照（非平滑光相、非墙钟） | lighting.js:68-79 `phaseFromSnapshot`（currentSeason+seasonProgress，缺字段回退 seasonTimer）；叶量读取同源 accent-season.js | ✅ |
| 渲染第一步推进光相 | render_canvas.js:179 `SimLighting.update(now, sim)` | ✅ |
| 材质受光单一公式入口（法线归一化→wrap 漫反射→ambient/intensity→tint） | lighting.js:285-295 `shadeRgbInto`（TA-04-2 零分配变体）；render_accents.js:79-90 唯一消费入口、本层不复制公式 | ✅ |
| 世界光向完整屏幕投影 + 近视线退化平滑回冠心 | lighting.js:341-364 `sunScreenEps`/`sunScreenDirFullInto`；render_accents.js:228-231 每实体刮擦、:476 叶簇亮部 | ✅ |
| 地面阴影：世界空间光向投影、随相机旋转、独立入队 | lighting.js:164-171/306-318；render_shadows.js:34-44 `drawAccentShadowGround`/`drawAccentShadowFor` | ✅ |
| 地形重着色走光档量化（lightStepsPerYear=144），原地写回 cell.color | lighting.js:157-161（stamp 判定）、174-247 `relightTerrain` | ✅ |
| 四生命周期消息 resync（READY/LOAD_RESULT/REWIND_RESULT/RESET_DONE） | rustworld.js:177/234/251/272 | ✅ |
| 动态光关闭退回旧固定光对照路径（legacyDir 西北 41°） | lighting.js:103-116 | ✅ |
| 色温（季节 tint × 温度偏移）与季节强度 | lighting.js:143-153 | ✅ |

核对结论：方案 §2 表格所述入口与源码事实一致；「季相反照率 → 世界法线受光 → 光源色温」管线完整，TA-05-2 起可直接沿用，无需先修受光路径。

## 三、修改前性能基线（A 端，pilot 一轮）

数据与口径：[metrics/baseline-ta051.json](./metrics/baseline-ta051.json)（nearest-rank p95；仅统计实际绘制帧，门控空转帧已剔除；预热 ≥12s，每场景采样 ≥50s）。

| 场景 | 绘制帧 p50 / p95 / p99 (ms) | 统一队列 p95 (ms) | 吞吐 |
| :--- | :--- | :--- | :--- |
| P1 初始·固定 | 14.4 / **17.0** / 20.2 | 16.4 | ≈125 tps |
| P2 初始·连续旋转 | 14.8 / **19.3** / 24.6 | 18.6 | 125 tps |
| P3 高密·固定（68 人/35 房 @tick 4.18M） | 15.7 / **19.4** / 27.6 | 18.7 | 120 tps |
| P4 高密·连续旋转（70 人/36 房） | 15.5 / **18.9** / 23.0 | 18.3 | 120 tps |

要点：统一队列占绘制帧成本 ≈95%（v1.50.11 统一深度队列架构预期）；本环境渲染受 `FRAME_INTERVAL` 门控上限 ≈30fps，帧预算口径为 33.3ms；高密档 p95 增量 +2.4ms（固定）/−0.4ms（旋转）在波动内——**但这不能推导出拖动超标已消失**（见下）。

### 既有高密拖动超标（继承登记，不豁免）

07 号 §11.3 TA-04-8 首轮实测（2026-09-13，Chrome 152 headed、1600×900、远程虚显+软件光栅）：**高密·拖动 p95 33.3→39.1~49.9ms（+5.8~+14.8ms）超标**，前三场景达标（≤3ms 增量）；超标主体归因非 TA-04 范畴（`drawTerrainCell` +38%、`drawAccentEntity` 单次 +120% 含 TA-11 石簇/芦草强化），TA-04 自身范畴 ≈+3~5ms/帧（最差近景预算边缘）。处置（按场景口径修订预算 / 对 TB-01、TA-11 追加优化 / 其他）**仍待用户取得测量取舍后回填预算行**；超标先优化复测，不得仅记录结论即标完成，亦不得作为 TA-05 的默认豁免。本轮预览环境未复现该形态（程序化旋转 ≠ 手动拖动、档位不同、GPU 环境不同），差分结论以 TA-05-6 正式 A/B 为准。

## 四、NOT_RUN / 后移清单（均不算通过）

- ~~Chrome 152 正式环境基线复测~~ → 已降为可选对齐项：按新口径（用户 2026-09-14 确认）沙箱内内置预览浏览器 + `?nogate=1` 是合法性能验证环境，A/B 同环境即有效；如后续 TA-05-6 在 Chrome 环境执行，两端同在新环境重测即可；
- 同版本真实存档建档/读档对齐负载 → TA-05-2 / TA-05-5（Chrome File System Access API）；
- TA-04-8「高密·拖动最差视角」在本机环境的复现与归因复测 → TA-05-6 P4（正式手动拖动轨迹）；
- 每场景 3 轮交替、60s/轮 + 无插桩开销对照 + 堆快照/缓存内存 + 生命周期首帧 p95 → TA-05-6；
- 三对象样板身份表与基准截图 → TA-05-2。

## 五、结论

TA-05-1 退出条件「基线清单完整；记录既有高密拖动超标，未将其豁免」**已满足**：工作区身份、版本、WASM 双哈希、配置、设备信息固化于 manifest.json；受光路径逐点核对通过；四场景 pilot 基线落盘；TA-04-8 超标继承登记并明确不豁免。TA-05 可进入 TA-05-2（筛选三对象并建立受控样板）。
