# TA-05 · P0 植被样板闭环 · 验收报告

> 记录日期：2026-09-14 · 操作者：CatPaw · 工作区 HEAD `1ef2660`（=TA-05-1 证据包提交，**未改任何渲染/内核代码**，本包为纯验收取证）
> 验证环境：CatPaw 内置预览浏览器（Chromium 148，`?nogate=1` 受控会话）+ macOS 26.3 / Apple M2；按 2026-09-14 用户确认口径（根 AGENTS.md §4 铁律）用于视觉/季相/生命周期/性能等**非存档链路**验证。**LOAD 文件存档链路 NOT_RUN**（预览浏览器无 File System Access API），须 Chrome 补测。
> 会话基线：CSS 视口 1218×851、DPR 2（画布 1522×1063，dpr 封顶 1.25）；种子 42；v1.50.52；WASM 双副本 SHA256 `de98896c…b75f`（TA-05-1 manifest 固化）。
> ★ 本轮环境事实（对后续复测有用）：预览面板隐藏时 rAF 节流至 ~7fps 且 CDP `Page.captureScreenshot` 高频超时；本包全部截图经「设相机 → `render(now+9999)` 过帧门控强制同步重绘 → canvas.toDataURL 分块取回」管线采集，均对应强制重绘后的真实生产帧。
> ★ 2026-09-14 收口清理：本包已从仓库根目录迁入 `docs/plan/tech/assets/ta05-evidence-2026-09-14/`，并按「只保留可复现与复测所需」原则删减——原始 150 张截图（夹具 134 + 真实世界 16）中保留 19 张关键样张（基准/四季中心/交界/受光/主矩阵两端/真实场景/REWIND 代表帧），空 saves/ 与其余 131 张样张已删除；**全量原始文件见 git 历史 `5c9a661`**（TA05-evidence-2026-09-14-027af1d/）。方法论与遗留事项见 [09 植被样板验证](../../09-vegetation-verification.md)。

## 一、三对象身份（TA-05-2）

| 角色 | kind/id | 原始坐标 (x,y,z) | scale/rotation/tint | 模型 evergreen |
| :--- | :--- | :--- | :--- | :--- |
| 落叶乔木（主样板） | Tree / **0** | (-19.48, 6.73, 1.87) | 1.1894 / 0.4375 / 0 | false |
| 落叶灌木（主样板） | Bush / **77** | (-56.98, 9.94, 3.16) | 1.1525 / 1.7574 / 0 | false |
| 岩石（主样板） | Boulder / **44** | (-14.60, 15.10, 1.70) | 1.3929 / 0.4038 / 0 | —（Boulder 无季相） |
| 常绿保护对照 | Tree / 36 | (31.30, -71.00, 1.60) | 1.1318 / 1.6331 / 0 | **true** |
| 坡地/高地补充 | Tree / 12 | (-366.5, 226.2, 14.34) | 1.242 | false |

完整身份表（含模型细节阈值 accentDetailMidPx=7 / accentDetailNearPx=15、accentEvergreenChance=0.24）见 [visual/fixture/identities.json](visual/fixture/identities.json)。模型无显式风格版本常量（accent-model.js，2026-09-14 核对）。

**真实场景基准截图**（原始坐标、生产入口、无夹具）：`visual/world/real-tree0_…`、`real-bush77_…`、`real-boulder44_…`、`real-tree36-evergreen_…`。

**受控视觉夹具**：以同 id/kind/scale/rotation/tint 克隆（仅改 x/y/z，z=落点真实地表 elev），追加进 `sim.terrain.accents` 走**生产绘制管线**（`drawAccentEntity`/统一深度队列/贴地投影），无任何专用美术代码；选点由脚本扫描（距自然装饰≥24u、POI≥62u、房屋≥50u、非水、四连位间距 46u、整体最靠近世界中心），落点与变换记录于 identities.json。夹具仅在会话内存在，每次取证后移除并核对 accents 恢复 157。基准图：`visual/fixture/fixture-baseline_spring_z4.6_{marked,clean}.jpg`（marked 版红圈=T0/B77/S44/E36 锚点）。

> ★ 取证过程中确认的前端事实（非缺陷）：S4-03 景观遮罩会把落入 POI 保护区/景观重叠区的 accent 整体隐藏（`LandscapeMask.accentHidden`，render_depth_queue.js:387）——夹具选址必须以该判据复核，否则克隆体被静默隐藏；相机 `panX/panY` 为**屏幕空间偏移**（居中对象须按 rotZ/rotX 旋转矩阵换算，同 render_canvas.js:166 跟随逻辑）；`render()` 的 FRAME_INTERVAL 门控 + `sim.headless` 分支会跳过绘制（无头长程设计行为）。

## 二、四季与边界（TA-05-3）

视觉证据：`visual/fixture/season-*.jpg`（16 张：四季中心、初春/晚春/初秋/深秋、四个季节交界的 1−ε 与 ε 两侧）。

| 观察项 | 判定 | 证据 |
| :--- | :--- | :--- |
| 春芽/夏冠/秋色/冬枝 | **PASS**：同株 T0 四态可辨——春芽量 0.64、夏满冠、秋金黄（brownness 0.69）、冬枝（B77 保持基生多茎丛状，非缩小乔木） | season-*.jpg + 数值采样 |
| 冬季落叶树叶量 | **PASS**：T0/B77 `leafDensity` = 0.03~0.04（规格 0~0.05）；常绿 E36 = 0.94 保持轮廓 | metrics/season-sampling.json |
| 连续性（边界无跳变） | **PASS**：每季 0.999 vs 次季 0.001 输出逐项差 ≤0.01（如 Spring .999 ld 1.0/bud .0115 → Summer .001 ld 1.0/bud .0105）；无 NaN/越界 | season-sampling.json |
| 先变色后减叶 | **PASS**：Autumn .85 brownness 0.95 时 ld 仍 0.35~0.49，落叶晚于变色；冬季 ld≈0.03 且枝条保留（叶簇挂真实枝条，TA-03 契约） | 数值 + season-b-autumn-winter-a 图 |
| 岩石不随植被季相变色 | **PASS**：S44 四季形状/材质恒定（明暗随真实光相变化属允许项） | season-*.jpg 对照 |
| 常绿保护 | **PASS**：E36 冬季 ld 0.94、深绿轮廓不变 | season-winter-center 图 |
| 年度相位回环 | **PASS**：`yearPhase` 回环发生在春季中部（Spring .15→0.9125 / .85→0.0875），两侧均已采样，光相插值无跳变；季分箱边界（Winter.999→Spring.001）与年度相位回环**分别覆盖** | season-sampling.json（yp 字段） |

个体哈希季相偏移已按「同对象跨季对照」口径消除（所有对照均为同 id）。

## 三、旋转、缩放与受光（TA-05-4）

**主矩阵 96 视图**：`visual/fixture/matrix-{Spring,Summer,Autumn,Winter}-rz{0,90,180,270}-rx{low=0.45,high=1.25}-z{06=0.6,15=1.5,35=3.5}.jpg`。三对象同框布局（四连位 span 138u），一套 96 图共同评分；每张响应内记录实际 `zoom/rotZ/rotX/panX/panY/season/progress`（/tmp 日志 + capture 返回值）。细节分档覆盖：zoom 0.6→冠 6px（far，<7px 阈值）、1.5→15px（mid/near 边界）、3.5→35px（near）✓ 覆盖 `accentDetailLevels()` 三档。

判定（96/96 逐张目视抽查 + 关键位全读）：无锚点悬空/入土、无树冠裁断、无簇间跳层（far/mid/near 往返经 rot-sweep 与 z 三档交叉覆盖）、阴影方向与光向一致。

**受光变量分离**（`lightsep-az{000,090,180,270}_Spring_z3.0.jpg`）：固定季相与相机，热调 `SIM_LIGHTING.azimuthOffsetDeg`；az0 vs az180 地面投影方向整体翻转、枝干明暗带/岩面亮面随动，`lightDir`/`sunScreenDir` 数值随拍记录 ✓。**固定世界光转相机**由 96 矩阵的 rotZ/rx 维度承担（光相固定时 4 方位亮部不黏屏幕左上）✓。**光投影退化**：`lightdeg-az{030,060}` 光向接近视线方向，簇亮部平滑回归冠心，无归一化抖动 ✓。

**视口边缘**：`edge-{left,right,top,bottom}_Summer_z3.0.jpg`——对象逐步移入/移出四边，粗剔除余量无边缘弹跳 ✓。**整圈连续旋转**：`rot-sweep-{0,45,…,315}_Summer_z2.5.jpg` 8 步 ✓。

**上下文误覆盖检查**：夹具落点邻接柏乡/邵武营地（房屋、道路、POI 底座在画面内），选中标签/门牌与树冠无互相遮断（复杂树屋人穿插拆分仍归 TA-08）。

## 四、生命周期与缓存（TA-05-5）

逐项结论见 [metrics/lifecycle.json](metrics/lifecycle.json)：

| 场景 | 结论 | 要点 |
| :--- | :--- | :--- |
| 真实四季推进 | PASS | 16x 推进 tick 978→100842→174594（~1000tps），季节随真实快照轮转；`lc-real-advance-a/b` |
| 暂停/继续 | PASS | 暂停 4s 前后 accent 坐标逐位一致、季节冻结 |
| REWIND | PASS | `rewindToTick(174594)` 精确回到目标 tick，accents 逐位一致；`lc-rewind` |
| RESET 同种子 | PASS | seed 42 冷重建 accents n=157 与身份表一致 |
| RESET 换种子 | PASS | seed 43 世界与 42 逐项不同，新世界身份生效；`lc-reset43` |
| 高倍速 1024x | PASS | 20s 采样无频闪/错误缓存，tps≈由 tick 差记录 |
| 交互/共享模型 | PASS | `focusOnAgent` 选中 + Inspector、关闭后跟随停止（follow=false）；资源景观/岩簇共用模型无回退（全图截图持续含 RockCluster/景观） |
| 动态光 开→关→开 | PASS | `lc-light-dyn-{on,off,reon}`：关=回退固定光（西北 41°），开=恢复动态 |
| **LOAD 文件存档** | **NOT_RUN** | 预览浏览器无 File System Access API；REWIND/RESET 同路径缓存重建证据 + `test-determinism.js` 存读档套件为补充证据，**不等于真实 LOAD 已通过**，须 Chrome 补测 |

## 五、性能（TA-05-6）

**前提**：本轮未修改任何渲染代码（A=B=HEAD `1ef2660`）。按方案 §7.1「若仅交付验收材料、未改渲染代码，不伪造『新增耗时为零』的成绩」——本节报告**现状绝对耗时与重复测量波动**，不给差分结论。口径与 TA-05-1 完全一致（rAF 包装=整帧回调、`drawWorldEntities` 包装=统一队列含阴影入队/排序/绘制、12s 预热+60s 采样、nearest-rank p95、仅统计实际绘制帧），3 轮 × P1~P4。


（数据回填：[metrics/perf-ta056.json](metrics/perf-ta056.json) · 高密档 = tick 6,958,488 / 68 人 / 29 房 / 157 装饰，rewind 对齐）

| 阶段 | 场景 | 绘制帧数(60s) | p50 | **p95** | p99 | mean | max (ms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| initial | P1·初始·固定 | 1726 | 12.4 | **14.8** | 17.0 | 12.63 | 33.1 |
| initial | P2·初始·连续旋转 | 1706 | 12.8 | **14.8** | 16.5 | 12.93 | 25.8 |
| initial | P1·初始·固定 | 1703 | 12.8 | **16.7** | 19.9 | 13.22 | 25.0 |
| initial | P2·初始·连续旋转 | 1707 | 12.8 | **15.2** | 17.5 | 13.00 | 26.8 |
| initial | P1·初始·固定 | 1717 | 12.8 | **14.6** | 16.1 | 12.91 | 18.1 |
| initial | P2·初始·连续旋转 | 1706 | 12.6 | **14.9** | 16.9 | 12.80 | 28.2 |
| highdensity | P3·高密·固定 | 1728 | 13.5 | **16.0** | 17.8 | 13.67 | 21.9 |
| highdensity | P4·高密·连续旋转 | 1719 | 14.0 | **17.6** | 22.9 | 14.36 | 34.9 |
| highdensity | P3·高密·固定 | 1724 | 14.5 | **19.1** | 26.0 | 15.01 | 44.8 |
| highdensity | P4·高密·连续旋转 | 1736 | 13.7 | **16.9** | 20.7 | 14.14 | 110.8 |
| highdensity | P3·高密·固定 | 1789 | 15.0 | **23.9** | 31.6 | 16.11 | 47.7 |
| highdensity | P4·高密·连续旋转 | 1782 | 15.7 | **27.9** | 33.9 | 17.45 | 60.6 |

**口径限制（必读）**：① 本轮采样期间预览面板处于隐藏态，rAF 被节流，产帧由 Web Worker 定时器（≈29fps）驱动 `render()` 强制重绘完成——**统一队列/绘制帧成本统计有效**，但 rAF 间隔/FPS 与 TA-05-1（面板可见、30fps 门控）不同口径，不可直接对照；② 仿真吞吐（tick/s）在该环境下不可靠（tick 推进被节流通道背压限制，实测 ≈0~1tps，与真实仿真速率无关），**本环境不产出吞吐结论**，吞吐以 07 号 §11.3 TA-04-8 的 Chrome 环境记录为准；③ P3/P4 第 2/3 轮在 rewind 对齐后进行，模拟倍速沿用 1024x（localStorage 持久化），世界高倍率演化造成快照应用与缓存扰动，p95 方差显著（P3 16.0→23.9、P4 17.6→27.9）——绝对值波动上限已如实记录，不下严格差分结论。

**结论**：P1/P2（初始世界）统一队列 p95 = 14.6~16.7ms，处于 16ms 参考预算边缘、与 TA-05-1 pilot（14.4~19.3ms）同量级；P3/P4（高密世界）p95 = 16.0~27.9ms，方差大且受 1024x 演化扰动。**本轮未改渲染代码，无 A/B 差分可报**；既有 TA-04-8 高密·拖动超标处置仍待用户对 07 号 §11.3 预算行取舍（修订口径 / 对 TB-01、TA-11 追加优化 / 其他）。**性能门禁在本环境只能记录「现状归档 + 波动区间」，不构成通过或不通过判定**——如需严格判定，须在 Chrome 可见面板环境按 §11.3 口径复测。


**既有高密拖动超标（继承登记，不豁免）**：TA-04-8 首轮（Chrome 152、远程虚显+软件光栅）高密·拖动 p95 +5.8~+14.8ms 超标、主体归因非 TA-04 范畴，处置仍待用户取得测量取舍后回填 07 号 §11.3 预算行。本轮预览环境（Apple M2 / Metal）绝对值环境不同，不构成对该超标的豁免或复现证明。

## 六、缺陷清单与处置

| # | 现象 | 归属 | 处置 |
| :--- | :--- | :--- | :--- |
| 1 | 预览面板隐藏时 rAF 节流 + CDP 截图超时（环境层，非产品代码） | 取证工具链 | 以强制重绘 + canvas 分块导出绕过；不影响生产玩家路径 |
| 2 | S4-03 遮罩静默隐藏保护区 accent（既有设计行为） | 既有机制（07 号 §4.6/S4-03） | 记录为夹具选址判据；无代码改动 |
| 3 | 无产品代码缺陷被本轮验收发现 | — | 无需修复复验；门禁全绿见 §七 |

## 七、门禁与收口

- 本包为纯验收取证（零代码改动）：不升版、不重编译 WASM（双副本 SHA256 未变）。
- 门禁输出摘要（2026-09-14）：`doc-maintenance-check` OK=18 / NEEDS_REVIEW=22（存量基线，与本次无关）；`cross-doc-check` 冲突 0 · 漂移 0；`doc-link-check` 734 条链接全可达；`bump-version.js --check` 全部定义点一致零漂移。07 号 §1.2/§11.4 已回填 ◐ 状态与验收记录；27 号 §7.4 补充本轮取证管线经验。
- NOT_RUN 汇总：①LOAD 文件存档链路（Chrome 补测）；②同版本真实存档文件与 SHA256（依赖 ①）；③Chrome 152 正式环境绝对值对齐（可选）。
- 结论：**视觉主矩阵、季相、受光、生命周期（除 LOAD）全部通过**；性能以现状绝对耗时归档。TA-05 完成状态待 LOAD 补测与 07 号 §11.3 高密·拖动预算处置（用户取舍）后由权威文档收口。

## 八、证据索引

```text
manifest.json                  # TA-05-1 环境固化（复用）
visual/fixture/identities.json # 三对象身份表 + 夹具方法
visual/fixture/                # 关键样张 17 张：基准 marked/clean、四季中心 ×4、
                               # 春↔夏与冬↔春边界 1−ε/ε ×4、受光 az000/az180 + 退化、
                               # 主矩阵两端、rot-sweep-0、edge-bottom
visual/world/                  # real-tree0 真实基准 + lc-rewind 生命周期代表帧
metrics/season-sampling.json   # 季相数值采样（26 点 × 4 对象）
metrics/lifecycle.json         # 生命周期逐项结论
metrics/perf-ta056.json        # 性能 3 轮 × P1~P4 原始样本与统计
metrics/baseline-ta051.json    # TA-05-1 pilot 基线（复用对照）

# 以下原始全量截图已于 2026-09-14 收口清理时删除（共 131 张：夹具 117 + 真实世界 14，另删空 saves/），
# 验证结论与逐项判定见本报告正文，全量文件见 git 历史 5c9a661：
#   matrix-*（其余 94 张）、season-*（其余 8 张）、lightsep-az{090,270}、
#   lightdeg-az060、edge-{left,right,top}、rot-sweep-{45..315}、
#   fixture-baseline z3.2/z4.2、visual/world/real-* 其余 5 张与 lc-* 其余 9 张
```
