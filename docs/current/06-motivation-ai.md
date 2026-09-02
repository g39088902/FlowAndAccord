# 6. 🧠 马斯洛需求层次与行动状态机 (Motivation AI)

> **模块索引**：[← 返回 CURRENT.md 全景索引](../CURRENT.md) · 主要源码：`crates/sim_core/src/spatial/decisions/`（7 子模块）· 深度拆解见 [`docs/AGENT_AI_ANALYSIS.md`](../AGENT_AI_ANALYSIS.md)

---

## 模块定位

部落民的层次化动机决策引擎，基于马斯洛需求层次驱动行为状态机。低层级需求绝对优先阻断高层任务，所有决策为确定性执行（无概率掷骰），决策节拍错峰均摊以保证帧率均匀。

## 核心机制

### 5 层需求层次

```
⑤ 自我实现 (大庄园备金/娱乐淘金)
④ 尊重需求 (建房施工/采石备料)
③ 归属与爱 (建仓成家/家庭供给)
② 安全需求 (房屋修缮/私宅水粮储备)
① 生理需求 (解渴/觅食/体力休养)
```

低层级需求未满足时绝对阻断高层任务，严禁越级。

> ⚔️ **★ M4 夺位远征（决策树最高优先级）**：在马斯洛评估**之前**先行处理——男性非国王且存在无主营地时，立即置 `SeekingThrone` 状态冲向最近无主营地登基（可中断施工/修缮，进度冻结不回滚），无需满足任何生理/安全前置；王位无主属社会结构级事件，压倒一切个人需求。

### 核心决策原则

**原则 1：体力 50% 以下才寻求休息**
- 体力 ≥ 50% 时全力响应外出采收、建房、修缮或高层任务。
- 仅当体力 < 50% 时，休养进入生理需求队列，引导归巢恢复至 100%。

**原则 2：低层级绝对优先**
- 仓库水/粮/过冬木柴低于 50% 时优先搬运填满，比盖房更优先。
- 房屋耐久 < 50% 时产生修缮欲望，开工后一路修缮至 100%。
- 区分盖房淘金（`StockGold`，冷却 45s）与娱乐淘金（`GoldWealth`，冷却 180s）；4 级大庄园竣工前绝不娱乐淘金。

**原则 3：私有施密特触发器 + 连续采收 + 断流重路由**
详见根 AGENTS.md §4.2。要点：
- 每个 Agent 维护 `poi_seekability` 私有锁存（开启 ≥30% / 关闭 <10%）。
- 采收现场未满时自动前往下一处自身触发器已开放的同类 POI 继续采收。
- 途中发现目标触发器关闭时，通过 `turn_around_and_route_to` 原地掉头平滑重路由，绝不瞬移。

**原则 4：执行中生理熔断**
- 外出任何高层任务途中，饥渴 < 25.0 或体力 < 50.0 时立即中断并降级折返。

### 错峰决策节拍
- 每个引擎 tick = 1/30 模拟秒，agent 每 30 tick（1.0 模拟秒）决策一次。
- 错峰相位：`(tick_counter + agent.id) % 30 == 0`，全员相位均摊错开。
- `world.tick()` 内部顺序：POI 再生 → 代谢/繁衍 → POI 交互(装卸) → 房屋系统 → 决策 → 道路衰减 → 运动。卸货发生在决策之前，决策看到的是卸货后的仓库状态。
- 详见根 AGENTS.md §4.3。

### decisions 子模块（7 个）
| 文件 | 职责 |
| :--- | :--- |
| `mod.rs` | 决策子模块入口与重新导出 |
| `needs.rs` | 需求定义（NeedKind）、节点池、家宅缺口计算 |
| `evaluate.rs` | Decisioner 结构体、decide/evaluate_needs/fulfill_resting_need |
| `routing.rs` | 导航/寻路/原地掉头/返家/POI 触发器可用性 |
| `harvest.rs` | 现场采收判定 + 仓储满额查询 |
| `seeking.rs` | 途中熔断与平滑重路由 |
| `scheduler.rs` | tick_decisions 调度（含 ★M4 夺位远征 tick_conquest_expedition）/ build_decision_context |

## 关键不变量
- 所有决策为确定性执行，无概率掷骰（v0.9.44 起全部收敛）。
- 决策节拍固定 30 tick，不得修改 `simulation_dt`（=1/30）。
- 共享 RNG 按 agents 顺序依次消费，新增任何随机消耗必须保持确定性。
- 中途掉头必须通过 `turn_around_and_route_to` 保持坐标连续性，严禁闪现瞬移。
- ★ M4 夺位远征优先于马斯洛评估，且不消耗 `WorldRng`；夺位者登基/放弃后恢复正常决策。

## 与其他模块接口
- `agent.rs`：读取生理指标与行囊状态，写入 agent.state（含 `SeekingThrone`）与路径。
- `ecology.rs`：采收与卸货的物理执行。
- `housing_system/`：FoundHome/BuildHouse/RepairHouse 的物理执行。
- `graph.rs`：A\* 寻路与路径规划。
- `ledger/region.rs`：夺位远征读写 `region_registry`（登基/迁籍）与 `expedition_targets`。
- `world.rs`：tick_decisions 调度，错峰相位控制。

## 调参入口
决策阈值、施密特触发器、淘金冷却、立宅门槛、体力作业门槛等见 [config-reference.md](../config-reference.md) 第 5 分区。
