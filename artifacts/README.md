# artifacts/ · 一次性审计与调研产物

本目录存放**一次性的审计报告 / 调研记录 / 数据快照**，不是项目的权威文档。

| 约定 | 说明 |
| :--- | :--- |
| **与 `docs/` 的分工** | `docs/` 描述**当前机制与规划**（长期维护、受门禁保护）；`artifacts/` 只记录**某一次审计的过程与结论**，是时点快照，不保证持续更新 |
| **门禁覆盖** | `cross-doc-check`（事实指纹）与 `doc-maintenance-check`（新鲜度体检）**不覆盖**本目录；但 `tools/doc-link-check.js` 会扫描**全仓** `.md`（仅排除 `docs/archive/`），因此**本目录的相对链接仍需保持有效**，指向已删除报告会导致该门禁失败 |
| **生命周期** | 审计项**全部整改完毕后**，按下列优先级处置：① 其中沉淀出的长期约定/结论**迁写进 `docs/` 或根 `AGENTS.md`**；② 迁写完成后**删除本目录的报告**（避免留下无人维护、与现状脱节的"半真相源"）；③ 需要留档追溯的，在文件顶部标注「✅ 已整改完毕（版本 + 日期）」后保留 |
| **命名** | `<主题>-<YYYY-MM-DD>.md`（如 `dead-code-audit-2026-09-11.md`） |

## 现有产物

| 文件 | 日期 | 状态 |
| :--- | :--- | :--- |
| [`dead-code-audit-2026-09-11.md`](./dead-code-audit-2026-09-11.md) | 2026-09-11 | ✅ **已整改完毕**（v1.50.18，门禁 12/12 通过）——死代码 / 空转配置 / 死函数清理，并新增 `config-check` 第 5 条「空转参数」门禁。保留作历史追溯 |

> **2026-09-12 的技术债审计报告已按上述约定删除**：其沉淀出的长期内容已分别迁入
> [`../docs/current/tech/14-terrain-and-network.md`](../docs/current/tech/14-terrain-and-network.md) §16（已删字段警示与门禁说明）、
> [`../docs/current/tech/06-snapshot-and-save.md`](../docs/current/tech/06-snapshot-and-save.md)（含附篇《时光倒流》）、
> [`../docs/README.md`](../docs/README.md)（编号例外声明）、[`../frontend/AGENTS.md`](../frontend/AGENTS.md) §5.11（季节叶色契约），
> 变更记录见 [`../docs/current/01-changelog.md`](../docs/current/01-changelog.md) 的 **v1.50.21** 条目。
