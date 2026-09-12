# 文档导航

文档按 **当前 / 计划** 划分，每一层再按 **产品设计 / 技术方案** 划分；技术方案按
**总体 → 上层（社会与经济）→ 中层（个体与行为）→ 下层（世界与物理）→ 表现层 → 工程层** 分级编号。

| 我想… | 去这里 |
| :--- | :--- |
| 看玩法与规则（玩家视角） | [`current/design/`](./current/design/) |
| 改代码、查状态机与契约 | [`current/tech/`](./current/tech/) |
| 讨论未来玩法方向 | [`plan/design/`](./plan/design/) |
| 讨论未来技术实现 | [`plan/tech/`](./plan/tech/) |
| 追溯历史设计决策 | [`archive/`](./archive/) |

- **[现状总索引](./current/README.md)** —— 当前代码中真实存在的行为，含完整模块导航表。
- **[计划总索引](./plan/README.md)** —— 在办设计与未落地方案，含依赖关系图。
- **[版本演进记录](./current/11-changelog.md)** —— v0.9.24 起各版本核心机制改动。
- **[超参数速查表](./current/tech/14-config-reference.md)** —— 由 `tools/config-check.js` 自动生成。

> 改代码请先读根 [`AGENTS.md`](../AGENTS.md)，最小任务入口是
> [`current/tech/68-workflow.md`](./current/tech/68-workflow.md)。
>
> **关于状态机图**：`current/tech/` 与 `plan/tech/` 下每篇技术方案都含
> `stateDiagram-v2` 状态机图。仅两篇例外——`14-config-reference.md` 由
> `tools/config-check.js` 自动生成（勿手改），`90-code-map.md` 是源码树附录。

---

## 归档准则

完成的里程碑计划、已被现状文档取代的设计方案，以及不再是实施依据的旧版本方案，
移入 [`archive/`](./archive/) 保留追溯，不应作为开发入口。
当前行为一律以 `current/`、源码及 `AGENTS.md` 为准。
