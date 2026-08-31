# 8. ⚙️ JavaScript 动态数值配置系统 (`config.js`)

> **模块索引**：[← 返回 CURRENT.md 全景索引](../CURRENT.md) · 主要源码：`frontend/js/config.js`、`frontend/js/rustworld.js`

---

- **全量超参数抽取 (`frontend/js/config.js`)**：
  - 将 Rust 内核中的 50+ 个核心数值超参数（包含：决策节拍、生理代谢与衰减、基因遗传均值与突变方差、POI 储量与基准产速、马斯洛饥渴阈值与淘金冷却、房屋各阶升级材料比例与建造工期、四季年轮周期与气温波幅、道路自然衰减速率等）全量抽取至 `window.SIM_CONFIG`。
- **免重新编译热调优机制**：
  - 前端 `rustworld.js` 在加载 WASM 及重置模拟时，通过 `world_set_config` / `world_apply_config_buf` 将 `window.SIM_CONFIG` 动态序列化注入 Rust WASM 内存；
  - 开发者与数值策划只需直接编辑 `frontend/js/config.js` 并刷新网页（`Cmd + R` / `Ctrl + F5`），即可即时生效，**彻底摆脱了改数值必须重编 WASM 的繁琐流程**。
