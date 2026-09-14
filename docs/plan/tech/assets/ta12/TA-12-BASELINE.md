# TA-12 基线记录与样板清单（TA-12-1 交付）

> **状态：已完成。** 2026-09-14 按 [TA-12-TODO.md](TA-12-TODO.md) §6 TA-12-1 执行。
> 全部数据为实机实测；样板存档通过 **正式 Chrome File System Access 启动门禁** 建立（未使用 `?nogate=1` 旁路）。
> 本文件只记录"无纹理"状态的基线；TA-12-2 起的纹理实现 A/B 对比均以本文件为参照。

---

## 1. 样板清单（samples/TA-12/）

| 文件 | 内容 | 校验指纹 |
|---|---|---|
| `t1-mountain-pass-seed43-tick59056.json` | **T1 山口样板存档** | seed `43` · `terrain_profile: mountain_pass_v1` · generator v8 · `format_version: 7` · `app_version: 1.50.50` · tick `59056` · 22 名族人 |
| `t1-mountain-pass-seed43-tick59056.png` | T1 无纹理基线截图（默认镜头，暂停态） | 春季 19.0°C，光位 东南·62°，22 人 / 9 户 / 9 宅 |
| `t2-river-valley-seed42-tick24334.json` | **T2 河谷样板存档** | seed `42` · `terrain_profile: river_valley_v1` · generator v8 · `format_version: 7` · `app_version: 1.50.50` · tick `24334` · 20 名族人 |
| `t2-river-valley-seed42-tick24334.png` | T2 无纹理基线截图（默认镜头，暂停态） | 入冬（冬季初）0.3~0.7°C，光位 北·24°，20 人 / 10 户 / 10 宅 |
| `kernel-baseline-t1-seed43.json` | T1 内核吞吐基线（profile-benchmark 导出） | seed 43 → `mountain_pass_v1`（random 按 seed 判别） |
| `kernel-baseline-t2-seed42.json` | T2 内核吞吐基线（profile-benchmark 导出） | seed 42 → `river_valley_v1` |

**建档方式**：独立 user-data-dir 的系统 Chrome 152 实例访问 `http://localhost:3003/?seed=43` → 启动门禁「建立存档文件」→ `showSaveFilePicker` 写入 `C:\Users\Lima\Documents\flowaccord-save1.json`（门禁默认文档目录）→ T1 世界运行至目标 tick 后经存档槽 1 覆盖保存（`window.saveUI.saveSlot('save1')`，与存档面板「💾 覆盖保存」同一写盘路径）→ 复制落盘为样板。T2 同流程，经门禁授权读取上次存档 → 「应用种子并重置」seed=42（confirm 确认）→ 重建世界。
**seed 与地貌的确定性关系**：`resolve_profile`（terrain.rs §5.3）按 `(seed ^ 0x5052_4F46_494C_4531) % 2` 判别，**奇数 seed → T1 山口，偶数 seed → T2 河谷**；存档内核校验重建地形与 `terrain_profile` 一致（world_save.rs），读档不依赖当前 `config.js` 的 `terrainProfile` 设置。

## 2. 环境记录

| 项 | 值 |
|---|---|
| 应用版本 | **v1.50.50**（徽章 `v1.50.50·c3`，分支 c3，本地端口 3003 = 3004 基准 + c3 偏移 3） |
| WASM | `frontend/rust/sim_wasm.wasm` 双副本在位，16,646,144 字节 |
| 设备 | AMD Ryzen 7 7840U（Radeon 780M 核显）· 30.7 GB RAM · Windows 10.0.22635 x64 · 显示经 Parsec 虚拟显示适配器 |
| 浏览器 | **Chrome 152.0.7977.83**（系统 Chrome，独立 user-data-dir `%TEMP%\ta12-profile`，页面缩放 100%） |
| 模拟配置 | 仓库默认 `frontend/js/config.js`（未改动；`terrainProfile: 'random'`，产速全 1.0x，23 处 POI） |
| 倍速 | 「最大模拟演化倍速」**2x**（新 profile 默认值）；实测演化倍速 2.1x（**125 tick/s**） |
| 动态光 | ☀️ 动态季节光照 **开启**（默认勾选；`azimuthOffsetDeg` 默认 90，未热调）；采样期间光档随季节自然轮转 |
| 相机 | **默认镜头零操作**：`rotX 1.05 / rotZ 0.60 / zoom 1.15 / pan(0, 30)`（`frontend/js/main.js:11-16`；camera 未暴露到 window，以"未操作"为准） |
| 窗口/DPR（T1 采样时） | viewport **2048×1018** CSS px · `devicePixelRatio` **1.25**（系统 125%，命中前端 `min(dpr, 1.25)` 钳制）· Canvas 后备缓冲 **2560×1272** |
| 窗口/DPR（T2 采样+截图时） | viewport **1284×1018** CSS px · dpr 1.25 · Canvas **1605×1272**（窗口在 T1 之后被外部（Parsec 会话）改动了尺寸；两次采样窗口口径不同，**TA-12-7 A/B 对比必须固定同一窗口尺寸**） |

## 3. 无纹理性能基线

### 3.1 主线程渲染（rAF 帧间隔采样，固定镜头，无交互，60 秒）

| 样板 | 采样窗口 | 帧数 | p50 | p95 | p99 | 均值 | tickRate | JS 堆 |
|---|---|---|---|---|---|---|---|---|
| T1 山口（tick 44754→55740，22 人） | 2048×1018 @1.25 | 733 | **83.40 ms** | **100.10 ms** | 100.30 ms | 81.90 ms | 124.8/s | 25.9 MB |
| T2 河谷（tick 23062 附近，20 人） | 1284×1018 @1.25 | 697 | **83.40 ms** | **100.20 ms** | 100.30 ms | 86.06 ms | 125.0/s | 21.6 MB |

> ⚠️ **基线本身已超出 §7 的"主线程渲染+UI p95 ≤16 ms"参考预算**（帧间隔 p50 即 ~83 ms ≈ 12 FPS，此窗口尺寸下渲染为瓶颈）。按 TA-12-TODO §7 规则：后续实测须**同时报告基线超标与纹理增量**，不得声称总预算已通过。
> 采样口径：`requestAnimationFrame` 相邻帧间隔（含渲染+UI+合成等待）；`sim.getDebugStats()` 并行读取。`tickMs/snapMs` 未启用调试模式，为 0。

### 3.2 内核吞吐（tools/profile-benchmark.js，3000 tick，默认配置）

| 样板 | seed | ticks/s | µs/tick | p95(µs) | 主导阶段 |
|---|---|---|---|---|---|
| T1 山口 | 43 | **47,477** | 21.06 | 18.22 | 马斯洛决策寻路 84.4% |
| T2 河谷 | 42 | **21,674** | 46.14 | 20.32 | 决策寻路主导（河谷过河成本更高） |

### 3.3 环境竞争声明（如实记录）

基线采集期间，**用户日常 Chrome 实例（另一 Chrome 进程）同机运行着一个 ~1000 tick/s 的高倍速世界**，与基线实例存在 CPU 竞争；上述渲染帧间隔是该真实环境下的口径。TA-12-7 正式性能闭环建议：关闭无关高负载实例、固定窗口尺寸后**重测本基线**再做开关纹理 A/B。

## 4. 复现步骤（后续 A/B 用）

1. `node frontend/server.js`（分支 c3 → http://localhost:3003 ）。
2. 独立 profile Chrome：`chrome.exe --user-data-dir=%TEMP%\ta12-profile --remote-debugging-port=9222 --window-size=<固定值> "http://localhost:3003/?seed=43"`。
3. 门禁「授权并读取上次存档」→ 自动恢复 T1 存档（Tick 59056）；或删 `%TEMP%\ta12-profile` 重新走建档流程。
4. 页面缩放 100%，动态光默认开，倍速 2x，默认镜头零操作。
5. T2 读档：存档面板「📂 读档」导入 `t2-river-valley-seed42-tick24334.json`（或重新应用 seed 42 重置至相近 tick）。
6. 性能采样：控制台 60s rAF 采样 + `sim.getDebugStats()`；内核：`node tools/profile-benchmark.js --ticks 3000 --seed 43 --json <out>`（seed 42 同理，`random` profile 自动判别 T1/T2）。

## 5. 遗留与注意事项

- `C:\Users\Lima\Documents\flowaccord-save1.json` 是门禁槽 1 的活动存档文件（自动保存周期写入），当前内容 = T2 样板世界；两份样板已快照在 `samples/TA-12/`，**请勿把 Documents 下的活动文件当作样板本身**。
- 用户原有 Chrome 实例中运行中的旧世界（非本任务产物）未被触碰；本任务全部操作在独立 profile 实例内完成。
- TA-12-1 不涉及代码变更：纯文档 + 样例数据，按根 AGENTS.md §4.0.1 文档变更例外处理（不升版、不重编译 WASM）。
