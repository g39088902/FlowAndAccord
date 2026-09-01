# 📋 Flow & Accord（流动公约）已实现功能全景清单

> **文档定位**：本文件为**「已实现功能」的索引入口**。详细内容已按功能模块拆分至 [`docs/current/`](./current/) 目录下的独立文件，本文仅保留全局架构速览与模块导航，避免单文件过长。
> **更新时间**：2026-08-31
> **当前状态**：确定性生态模拟内核（Rust `sim_core`）与交互式可视化前端（Canvas 2D/3D）双端对齐就绪，支持完整的生态、四季、繁衍、采矿、多级房屋与世系传承大闭环。
> **版本**：v0.9.72（版本演进记录见 [docs/current/11-changelog.md](./current/11-changelog.md)）
> **超参配置**：全部可调超参（161 个）统一由 `frontend/js/config.js` 驱动，字段/类型/默认值/中文说明见 [docs/config-reference.md](./config-reference.md)，前后端一致性由 `node tools/config-check.js` 校验（改参后必跑）。

---

## 🌟 核心系统架构一览

```
                       ┌──────────────────────────────┐
                       │     四季更替与热力学气温     │
                       │ (240s年轮 / -3~31℃ / 冬季供暖)│
                       └──────────────┬───────────────┘
                                      │
                                      ▼
                       ┌──────────────────────────────┐
                       │   有限生态地标 (23处 POI)    │
                       │ (营地/清泉/浆果/林木/石矿/金矿)│
                       └──────────────┬───────────────┘
                                      │
                                      ▼
                       ┌──────────────────────────────┐
                       │   部落民 AI 层次化动机引擎   │
                       │ (生理自救/建仓备货/淘金/成家) │
                       └──────────────┬───────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  3D 拓扑路网导航 │         │  多级私产房屋进阶 │         │ 家族血脉与世系继承│
│ (A*寻路 / 踏路成道│         │ (0级仓库->4级庄园/│         │ (结发夫妻/120s育儿/│
│  5阶专属恒宽色彩) │         │  水粮木石金全要素)│         │  代际无房顺位继承)│
└──────────────────┘         └──────────────────┘         └──────────────────┘
```

---

## 📑 模块导航（详细内容见 `docs/current/`）

| # | 功能模块 | 文档路径 | 主要内容 |
| :--- | :--- | :--- | :--- |
| 1 | 🗺️ 3D 空间拓扑与路网涌现系统 (`spatial`) | [01-spatial-network.md](./current/01-spatial-network.md) | 连续 3D 地形、贝塞尔路网、A\* 寻路、踏路成道、5 阶恒宽色彩渲染、道路悬浮卡片 |
| 2 | 🌲 全局有限生态与 POI 资源体系 (`poi`) | [02-ecology-poi.md](./current/02-ecology-poi.md) | 21 处有限生态地标、储量/再生、Agent 私有施密特触发器、营地下行政升级 |
| 3 | ❄️ 四季更替与热力学供暖系统 (`seasons`) | [03-seasons-climate.md](./current/03-seasons-climate.md) | 240s 四季年轮模型、冬季供暖消耗、低温受孕安全红线 |
| 4 | 🧬 部落民生理代谢、繁衍与寿命 (`agent`) | [04-agent-life.md](./current/04-agent-life.md) | 生理指标、年龄两性分化、婚姻改嫁繁衍、先天禀赋、尸体风化 |
| 5 | 🏡 多级私产房屋与建材升级体系 (`house`) | [05-house-system.md](./current/05-house-system.md) | 5 级建筑形态、自然折旧修缮、父系代际继承 |
| 6 | 🧠 马斯洛需求层次与行动状态机 (Motivation AI) | [06-motivation-ai.md](./current/06-motivation-ai.md) | 5 层需求、私有触发器、连续采收与平滑重路由、错峰决策节拍 |
| 7 | 🎨 交互式表现层与控制台 (`frontend`) | [07-frontend-ui.md](./current/07-frontend-ui.md) | Canvas 渲染管线、Inspector、图例窗口、全景控制台、轻量引擎优化 |
| 8 | ⚙️ JavaScript 动态数值配置系统 (`config.js`) | [08-config-system.md](./current/08-config-system.md) | `window.SIM_CONFIG` 全量抽取与免编译热调优 |
| 9 | 📂 核心代码目录与模块映射 | [09-code-map.md](./current/09-code-map.md) | `crates/` 与 `frontend/` 源码树结构 |
| 10 | 🚀 快速启动与体验 | [10-quickstart.md](./current/10-quickstart.md) | 浏览器 / Node 回归 / Rust 测试三种启动方式 |
| — | 📜 版本演进记录 (Changelog) | [11-changelog.md](./current/11-changelog.md) | v0.9.24 ~ v0.9.54 各版本核心机制改动 |

---

## 🛠️ 维护指引

- **改动某项机制后**：在对应的模块文件（`docs/current/0X-*.md`）中更新功能描述；若改动构成新版本，**必须在 [docs/current/11-changelog.md](./current/11-changelog.md) 中追加版本条目**，并按 [AGENTS.md §4.9 版本号规范](../AGENTS.md) 自增版本号。
- **版本号四处同步**：① `frontend/index.html` 版本徽章 ② `AGENTS.md` §1 Mermaid 节点 ③ `AGENTS.md` §2 步骤四 ④ 本索引顶部「版本」与 [Changelog](./current/11-changelog.md)（当前 v0.9.72）。
- **新增功能模块**：在 `docs/current/` 下新建 `NN-*.md`（序号顺延），并在上方导航表登记。
