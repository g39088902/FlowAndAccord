# 文档导航

文档按 **当前 / 计划** 划分，每一层再按 **产品设计 / 技术方案** 划分；**每个目录内文档按顺序从
`01` 起连续编号**（各目录各自成序，编号本身不含层级语义）。`tech/` 内按
**总体 → 上层（社会与经济）→ 中层（个体与行为）→ 下层（世界与物理）→ 表现层 → 工程层 → 附录** 分层排列。

文档内标题编号约定：H1 为 `# NN. 标题`（NN = 文件名前缀）；每个分部（`# 附篇 · …` / `# 第N部分 · …`）
内 `##` 从 1 起连续编号，`###` / `####` 依次编 `N.M` / `N.M.K`。`## 状态机` 是门禁要求的固定前置章节，
不参与编号；字母型章节号（如 Commit 检查单 A–G）属作者有意编号，保持原样。

> **编号例外（有意为之，勿"顺手修"）**——下列两篇存在编号空档或不编号章节，是成对历史编号的刻意保留，
> 改动它们会破坏与另一篇的对应关系。发现"看起来漏编号"时请先回来看这条：
> - [`current/tech/14-terrain-and-network.md`](./current/tech/14-terrain-and-network.md)：`## 模块定位` /
>   `## 核心机制` 及其下 `###` 不编号，且 `# 第二部分` 自 `## 7.` 起跳（1–6 空档）——因为它承接
>   [`plan/tech/06-terrain-templates.md`](./plan/tech/06-terrain-templates.md) 移出的 7–16 节。
> - [`plan/tech/06-terrain-templates.md`](./plan/tech/06-terrain-templates.md)：含 `## 0.` 编号；
>   §17–21 与 14 号的 §7–16 成对保留历史编号，06 中引用 §7–§16 时指 14 号对应章节（约定见其文首）。

| 我想… | 去这里 |
| :--- | :--- |
| 看玩法与规则（玩家视角） | [`current/design/`](./current/design/) |
| 改代码、查状态机与契约 | [`current/tech/`](./current/tech/) |
| 讨论未来玩法方向 | [`plan/design/`](./plan/design/) |
| 讨论未来技术实现 | [`plan/tech/`](./plan/tech/) |
| 追溯历史设计决策 | [`archive/`](./archive/) |

- **[现状总索引](./current/README.md)** —— 当前代码中真实存在的行为，含完整模块导航表。
- **[计划总索引](./plan/README.md)** —— 在办设计与未落地方案，含依赖关系图。
- **[版本演进记录](./current/01-changelog.md)** —— v0.9.24 起各版本核心机制改动。
- **[超参数速查表](./current/tech/05-config-reference.md)** —— 由 `tools/config-check.js` 自动生成。

> 改代码请先读根 [`AGENTS.md`](../AGENTS.md)，最小任务入口是
> [`current/tech/30-workflow.md`](./current/tech/30-workflow.md)。
>
> **关于状态机图**：`current/tech/` 与 `plan/tech/` 下每篇技术方案都含
> `stateDiagram-v2` 状态机图。仅两篇例外——`05-config-reference.md` 由
> `tools/config-check.js` 自动生成（勿手改），`31-code-map.md` 是源码树附录。

---

## 归档准则

完成的里程碑计划、已被现状文档取代的设计方案，以及不再是实施依据的旧版本方案，
移入 [`archive/`](./archive/) 保留追溯，不应作为开发入口。
当前行为一律以 `current/`、源码及 `AGENTS.md` 为准。
