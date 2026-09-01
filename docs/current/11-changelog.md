# 📜 版本演进记录 (Changelog)

> **模块索引**：[← 返回 CURRENT.md 全景索引](../CURRENT.md)
> 本文件为里程碑级变更记录，按版本号正序排列。最新版本：**v1.0.1**。
> 实现细节与验证数据已精简，如需追溯请查阅 git 历史。

---

## 核心机制变更

| 版本 | 核心变更 | 影响模块 |
| :--- | :--- | :--- |
| **v0.9.24** | 随身金币遗产继承：族人故去后 `carried_gold` 平分给在世子一代子女，无子女则清零 | agent / ecology |
| **v0.9.34** | 房屋系统与世界环境模块化解耦：`housing_system` 拆为 5 个单一职责子模块，四季回归 `world.rs` | housing_system / world |
| **v0.9.35** | 简化四季参数模型：废除 `season_quarter_length`，单季长度由 `year_length × 0.25` 派生 | config / world |
| **v0.9.37** | 婚姻系统与建房事件解耦：移除升级竣工即时迎娶钩子，成婚统一由 `marriage.rs` 每 tick 扫描匹配 | housing_system/marriage |
| **v0.9.39** | 混沌系统测试策略落地：不再持久化保存单元测试脚本，长期确定性验证由 `test-wasm.js` 承担 | 工程规范 |
| **v0.9.42** | 开局人口 12→20（10男10女），百家姓库 60→150 | ecology / agent / frontend |
| **v0.9.43** | 建房/升级/修缮全流程回归 Agent 自主决策：废除系统发房扫描器，新增 `FoundHome` 需求 | decisions / housing_system |
| **v0.9.44** | 决策概率全部收敛为确定性执行（无掷骰），立宅选址参数全部入 `SimConfig` | decisions / config |
| **v0.9.45** | 决策模块子目录化拆分：`evaluator.rs` 拆为 7 个子模块（needs/routing/evaluate/harvest/seeking/scheduler/mod） | decisions |
| **v0.9.47** | 超高倍速支持（256x/512x/1024x），建房最小间距 14→28m | frontend / config |
| **v0.9.48** | 立宅优先复用空置路网节点：候选宅址 20m 半径内若存在空置节点则直接复用，防止代际更替后节点膨胀 | housing_system/settlement / graph |
| **v0.9.49** | 调试模式监视器：Tick/FPS/内核耗时/快照耗时/CPU/内存/WASM 内存九项指标，200ms 刷新 | frontend |
| **v0.9.50** | 道路衰减速率翻倍（线性模型阶段参数调整，后于 v0.9.66 改为比例模型） | graph / config |
| **v0.9.51** | 步行速度受力量禀赋加成（后于 v0.9.65 重构为力量直接乘率） | agent / config |
| **v0.9.52** | 视图显隐改造：新增隐藏部落民/隐藏路网开关，移除 POI 指示环开关（改为恒显） | frontend |
| **v0.9.53** | 死亡数区分自然死亡（寿终正寝）与非自然死亡（饿死/渴死），顶栏分列统计 | agent / snapshot / frontend |
| **v0.9.56** | 无头模式顶栏常驻更新 + 每秒 Tick 监视 + 空格键全局暂停（不受控件焦点残留影响）+ 族谱拖拽修复 | frontend |
| **v0.9.57 ~ v0.9.62** | 族谱系统迭代：全量血脉单图 → 力导向布局 → 纯力学布局 → 出生时序纵向重力 → 无惯性收敛 → 直系血脉裁剪（仅焦点祖先+后代链）→ 焦点暗红卡片配色（最终于 v0.9.64 被时间轴布局取代） | frontend/dag |
| **v0.9.63** | 全量消除 magic number：161 个超参收口 `config.js`，新增 `config-check.js` 前后端一致性校验与 `config-reference.md` 自动生成速查表 | config / frontend / tools |
| **v0.9.64** | 族谱时间轴布局重构：彻底废除力导向，Y 严格线性映射出生 tick + X 冲突横向扩展 + 视口虚拟化 LOD + 时间刻度尺，拆分为 `dag-layout/view/standalone/dag` 四模块 | frontend/dag |
| **v0.9.65** | 行走速度重构：所有 agent 共用默认速度 + 力量直接乘率（无 clamp），速度不再受体力影响，清理 7 个废弃超参，`SimConfig` 161→154 | agent / config |
| **v0.9.66** | 道路衰减改比例模型（`wear × (1 - rate×dt)`），清理越野惩罚死机制，前端道路 tooltip 全部去硬编码读 `SIM_CONFIG` | graph / frontend / config |
| **v0.9.68 ~ v0.9.70** | CI/CD 自动部署流水线：GitHub Actions 编译 WASM → `test-wasm.js` 门禁 → 腾讯云 COS 增量上传，含 `.wasm` MIME 覆写、Secrets 格式预检与 DNS 预解析 | .github / docs |
| **v0.9.71** | 3 级木石庄舍图标去重：🏛️→🏯，与营地县级行政区图标区分 | frontend / housing_system |
| **v0.9.72** | **账本与婚姻登记系统 M1 奠基**：新增 `ledger/` 模块（Ledger 双环形流水 / Group 团体基类 / MarriageRegistry 婚姻登记簿 / HouseholdRegistry 家户体系），胎儿预分配 AgentId，与物理仓库完全分离 | ledger（新模块） |
| **v0.9.73** | 账本前端 UI 展示：快照扩展 `HouseholdSnapshot`/`MarriageSnapshot`/`LedgerBalanceSnapshot`，顶栏存续家户/婚姻统计 + Inspector 家户归属与婚姻登记卡片 + 家户与账本大盘可折叠面板 | snapshot / frontend |
| **v0.9.74** | 家户与账本大盘面板可点击性修复：补齐 `pointer-events:auto`，CSS 重写对齐全局均值大盘/图例窗口风格 | frontend |
| **v1.0.0** | **里程碑：账本与家户/婚姻系统 M1 完成**，版本策略升级（M 里程碑递增次版本号，Bug 修复/文档更新递增修订号） | 全项目 |
| **v1.0.1** | 全量文档重构精简：修复版本号/POI 数量/字段数等失同步，压缩 changelog（58KB→里程碑级）与规划文档，新增账本模块文档，统一文档分层放置策略 | docs |

---

## 文档与工程规范维护

以下版本为纯文档/工具链维护，不涉及功能代码变更，合并记录：

| 版本 | 内容 |
| :--- | :--- |
| **v0.9.38** | 文档偏差修复：修正 AGENTS.md / CURRENT.md / BUILD_GUIDE.md 等与现状不符的描述 |
| **v0.9.46** | 嵌套 AGENTS.md：为 sim_core / sim_wasm / decisions / housing_system 四个目录新增局部操作指南 |
| **v0.9.54** | CURRENT.md 按功能模块拆分：根索引 + `docs/current/` 分模块文档两级结构 |
| **v0.9.55** | 文档目录整合：非 AGENTS.md 文档全部移入 `docs/` 目录，引用路径全量修正 |
| **v0.9.67** | 浏览器自动化使用指南落库：`docs/browser-guide.md`，playwright-cli 4 引擎实测通过 |
| **v0.9.75** | 前端服务器端口占用说明：AGENTS.md 补充 3000 端口已占用时无需重复启动 server.js |
