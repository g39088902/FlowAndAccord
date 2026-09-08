# 文档导航

`docs/` 只保留正在使用的入口、操作指南与在办规划；已完成、被实现替代或仅供追溯的设计稿移入 [`archive/`](./archive/)。

## 从这里开始

- [当前实现总览](./01-current.md)：功能入口与 `docs/current/` 模块导航。
- [Agent 快速入口](./current/00-agent-start.md)：按改动类型选择约束和门禁。
- [长期路线图](./11-plan.md)：产品方向；[TODO](../TODO.md) 是近期待办的唯一入口。

## 日常开发与运维

| 场景 | 文档 |
| :--- | :--- |
| 构建、WASM 与本地运行 | [02-build-guide.md](./02-build-guide.md) |
| 浏览器渲染与自动化 | [03-browser-guide.md](./03-browser-guide.md) |
| 部署与 CI/CD | [04-cicd-guide.md](./04-cicd-guide.md) |
| 无头诊断与复现 | [05-headless-diagnostics-guide.md](./05-headless-diagnostics-guide.md) |
| 配置字段与默认值 | [06-config-reference.md](./06-config-reference.md)（自动生成） |
| 决策机制背景 | [07-agent-ai-analysis.md](./07-agent-ai-analysis.md) |
| 性能基准与确定性 | [15-profiling-and-benchmarking-guide.md](./15-profiling-and-benchmarking-guide.md) |

## 在办设计

- [性能优化](./16-plan-performance-optimization.md)
- [农田与农业税](./17-plan-farmland-agriculture.md)

## 归档准则

完成的里程碑计划、已被现状文档取代的设计方案，以及不再是实施依据的旧版本方案，保留在 [`archive/README.md`](./archive/README.md) 供追溯，不应作为开发入口。当前行为以 `docs/current/`、源码及 `AGENTS.md` 为准。
