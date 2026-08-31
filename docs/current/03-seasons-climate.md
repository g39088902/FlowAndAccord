# 3. ❄️ 四季更替与热力学供暖系统 (`seasons`)

> **模块索引**：[← 返回 CURRENT.md 全景索引](../CURRENT.md) · 主要源码：`crates/sim_core/src/spatial/world.rs`（`tick_season`）、`housing_system/maintenance.rs`

---

- **240 秒四季年轮模型**：
  - 一年按 240 秒（4分钟）为一个完整周期：春（$0\sim60\text{s}$）、夏（$60\sim120\text{s}$）、秋（$120\sim180\text{s}$）、冬（$180\sim240\text{s}$）。
  - 全球气温呈正弦平滑震荡（$-3^\circ\text{C} \sim 31^\circ\text{C}$）。
- **冬季与严寒供暖消耗**：
  - 当处于冬季或环境气温 $< 5^\circ\text{C}$ 时，所有非 0 级有主房屋每秒消耗 $0.12$ 单位木材用于壁炉供暖。
- **低温受孕安全红线**：
  - 房屋木材储量 $< 10.0$ 单位时无法保障严寒取暖，自动禁用受孕功能，倒逼族人必须在春夏秋三季主动伐木储备过冬木料。
