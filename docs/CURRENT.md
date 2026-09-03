# 📋 Flow & Accord（流动公约）已实现功能全景清单

> **文档定位**：本文件为「已实现功能」的索引入口。详细内容按功能模块拆分至 [`docs/current/`](./current/) 目录，本文仅保留全局架构速览与模块导航。
> **版本**：v1.6.1（版本演进记录见 [docs/current/11-changelog.md](./current/11-changelog.md)）
> **超参配置**：全部可调超参（169 个）统一由 `frontend/js/config.js` 及拆分配置（`config.house-upgrade-cost.js` 升级成本矩阵 20 字段 / `config.decision-order.js` 决策顺序）驱动，字段/类型/默认值/中文说明见 [docs/config-reference.md](./config-reference.md)，前后端一致性由 `node tools/config-check.js` 校验。

---

## 🌟 核心系统架构一览

```
                       ┌──────────────────────────────┐
                       │     四季更替与热力学气温     │
                       │  (240s年轮 / -3~31℃ / 冬季供暖) │
                       └──────────────┬───────────────┘
                                      ▼
                       ┌──────────────────────────────┐
                       │   有限生态地标 (23处 POI)    │
                       │ (营地5/清泉6/浆果6/林木3/石矿2/金矿1)│
                       └──────────────┬───────────────┘
                                      ▼
                       ┌──────────────────────────────┐
                       │   部落民 AI 层次化动机引擎   │
                       │ (生理自救/建仓备货/淘金/成家) │
                       └──────────────┬───────────────┘
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  3D 拓扑路网导航 │   │  多级私产房屋进阶 │   │ 家族血脉与世系继承│
│ (A*寻路/踏路成道 │   │ (0级仓库→4级庄园 │   │ (结发夫妻/族谱   │
│  5阶恒宽色彩)    │   │  水粮木石金全要素)│   │  时间轴布局)     │
└──────────────────┘   └──────────────────┘   └──────────────────┘
                                      │
                                      ▼
                       ┌──────────────────────────────────────────────┐
                       │  📒 账本与社会经济制度系统 (M1~M4 已落地)    │
                       │ (家户/婚姻/宗族/王国 · 旁路记账/分家继承/     │
                       │  族税互助/公仓赋税救济/夺位远征)             │
                       └──────────────────────────────────────────────┘
```

---

## 📑 模块导航（详细内容见 `docs/current/`）

| # | 功能模块 | 文档路径 | 主要内容 |
| :--- | :--- | :--- | :--- |
| 1 | 🗺️ 3D 空间拓扑与路网涌现系统 (`spatial`) | [01-spatial-network.md](./current/01-spatial-network.md) | 连续 3D 地形、贝塞尔路网、A\* 寻路、踏路成道、5 阶恒宽色彩 |
| 2 | 🌲 全局有限生态与 POI 资源体系 (`poi`) | [02-ecology-poi.md](./current/02-ecology-poi.md) | 23 处有限生态地标、储量/再生、Agent 私有施密特触发器、营地下行政升级 |
| 3 | ❄️ 四季更替与热力学供暖系统 (`seasons`) | [03-seasons-climate.md](./current/03-seasons-climate.md) | 240s 四季年轮模型、冬季供暖消耗、低温受孕安全红线 |
| 4 | 🧬 部落民生理代谢、繁衍与寿命 (`agent`) | [04-agent-life.md](./current/04-agent-life.md) | 生理指标、年龄两性分化、婚姻改嫁繁衍、先天禀赋、尸体风化 |
| 5 | 🏡 多级私产房屋与建材升级体系 (`house`) | [05-house-system.md](./current/05-house-system.md) | 5 级建筑形态、自然折旧修缮、父系代际继承 |
| 6 | 🧠 马斯洛需求层次与行动状态机 (Motivation AI) | [06-motivation-ai.md](./current/06-motivation-ai.md) | 5 层需求、私有触发器、连续采收与平滑重路由、错峰决策节拍 |
| 7 | 🎨 交互式表现层与控制台 (`frontend`) | [07-frontend-ui.md](./current/07-frontend-ui.md) | Canvas 渲染管线、Inspector、族谱时间轴、账本大盘、调试监视器 |
| 7+ | 📐 UI 全景剖析与制度大盘实现指南 | [UI_SPEC_AND_LEDGER_DESIGN.md](./UI_SPEC_AND_LEDGER_DESIGN.md) | UI 页面全景解剖、M1-M4 制度大盘（家户/婚姻/宗族/王国）已实现说明、前端开发实施规范 |
| 8 | ⚙️ JavaScript 动态数值配置系统 (`config.js`) | [08-config-system.md](./current/08-config-system.md) | `window.SIM_CONFIG` 全量抽取、免编译热调优、config-check 校验 |
| 9 | 📂 核心代码目录与模块映射 | [09-code-map.md](./current/09-code-map.md) | `crates/` 与 `frontend/` 源码树结构 |
| 10 | 🚀 快速启动与体验 | [10-quickstart.md](./current/10-quickstart.md) | 浏览器 / Node 回归 / Rust 编译三种启动方式 |
| 12 | 📒 账本与社会经济制度系统 (`ledger`) | [12-ledger-system.md](./current/12-ledger-system.md) | 团体账本内核、婚姻登记簿、家户体系、宗族体系、地区王国政体、胎儿 Agent 身份 |
| 13 | 🔗 跨模块影响矩阵 | [13-impact-matrix.md](./current/13-impact-matrix.md) | 改 X 牵动哪些文件的速查表、tick 内部调用顺序、数据流向图、脚本加载顺序、改动前自检清单 |
| 14 | 🔒 核心不变量集中清单 | [14-invariants.md](./current/14-invariants.md) | 确定性/数据一致性/行为语义/构建部署/代码组织/前端 DOM 六大类硬约束，每条标注来源与违反后果，末尾附 10 秒快速自检清单 |
| 15 | 💾 读档 / 存档系统 | [15-save-load.md](./current/15-save-load.md) | `WorldSave` 全量状态契约、排除字段与重建方式、WASM 导出与错误码、三槽位 localStorage 与导入导出、确定性验证与易踩坑 |
| — | 📜 版本演进记录 (Changelog) | [11-changelog.md](./current/11-changelog.md) | v0.9.24 ~ v1.8.0 各版本核心机制改动 |

---

## 🛠️ 维护指引

- **改动某项机制后**：在对应模块文件（`docs/current/0X-*.md`）中更新功能描述；若构成新版本，必须在 [11-changelog.md](./current/11-changelog.md) 追加版本条目，并按 [AGENTS.md §4.9](../AGENTS.md) 自增版本号。
- **版本号四处同步**：① `frontend/index.html` 版本徽章 ② `AGENTS.md` §1 Mermaid 节点 ③ `AGENTS.md` §2 步骤四 ④ 本索引顶部「版本」与 Changelog 顶部。
- **新增功能模块**：在 `docs/current/` 下新建 `NN-*.md`（序号顺延），并在上方导航表登记。
