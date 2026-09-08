# M19.4 独立增强总体设计与实施计划

## 概述
在完成 M19.0～M19.3 之后，部落民决策架构已成功实现 **L1 意图仲裁、L2 策略规划、L3 原语适配** 的三层解耦，并通过 `ActiveTask` 控制器与 `transition.rs` 实现了持续任务的单一真相源治理。

**M19.4（独立增强）** 标志着重构从“行为等价迁移期”正式进入“能力与表现增强期”。此阶段不再以“与旧版本逐字节严格等价”为约束，而是利用已解耦的架构，系统性落地以下四大增强：

1. **表现层透视**：Inspector 意图 / 策略 / 行动原语「三栏看板」与决策动机可解释性；
2. **仲裁层增强**：分级任务抢占机制（危机抢占与平滑中断）；
3. **策略层个性化**：基于六维先天禀赋与家户财富阶层的差异化选策；
4. **规划层增强**：多品类采收候选预排队列与行程优化。

---

## 四大增强设计详情

### 维度一：Inspector 意图 / 策略 / 行动 三栏透视 (M19.4a)
- **目标**：彻底解决“这个族人为什么在做这件事、下一步想去哪、用了什么手段”黑盒问题，将 M19 的三层解耦直接转化为直观的用户视觉体验。
- **三栏结构设计**：
  ```text
  ┌───────────────────────────────────────────────────────────────┐
  │ 🧠 决策与行动中枢 (Motivation & Execution Hub)                │
  ├────────────────┬────────────────────────┬─────────────────────┤
  │ 🎯 意图 (Intent)│ 🧭 策略 (Strategy)     │ ⚡ 原语 (Primitive) │
  ├────────────────┼────────────────────────┼─────────────────────┤
  │ 分支: b5 备水   │ 策略: 野外采收 (去程)   │ 动作: 沿路导航       │
  │ 层级: ② 安全需求 │ 目标: 清泉 #11          │ 车道: Lane #42      │
  │ 判据: 家储备满   │ 阶段: Outbound (在途)   │ 距离: 28.4m (速度1x)│
  └────────────────┴────────────────────────┴─────────────────────┘
  ```
- **瞬发事件高亮流**：当触发 ⓪ 瞬发行为（如 b17 麦穗拍卖出价、b16 宅门受孕、b18 就近求偶）时，在看板顶栏以微光 Pill 实时展示 `⚡ 瞬发结算: [出价 35.2金 @ 房屋 #14]`。
- **快照四处同步 (M4)**：
  1. `crates/sim_core/src/spatial/snapshot.rs`：`AgentSnapshot` 扩充 `active_task: Option<ActiveTaskSnapshot>`；
  2. `crates/sim_core/src/spatial/world_snapshot.rs`：序列化 `intent_kind`, `strategy_kind`, `primitive_kind`, `target_id`, `stage_name`；
  3. `crates/sim_core/src/spatial/snapshot_bin/encode.rs`：FABS 二进制编码，增加紧凑字节位；
  4. `frontend/js/snapshot-bin.js` + `rustworld.js`：前端同构解码与映射。
- **前端组件更新**：在 `frontend/js/render_inspector.js` 中新增三栏交互卡片，明暗双主题自适应。

---

### 维度二：分级任务抢占与中断机制 (M19.4b)
- **现状**：旧系统只有在渴度/饥饿度跌破 15（临界生理需求）时才通过硬编码分支熔断折返，其他任务一旦派发不可中断。
- **增强设计**：在 L1 仲裁器建立清晰的 **抢占策略矩阵 (Preemption Matrix)**：
  | 当前任务性质 | 允许被何种意图抢占 | 抢占处理动作 |
  |---|---|---|
  | 娱乐淘金 (`GoldWealth`) | 任何生理需求、安全储备、私宅修缮、登基远征 | 立即放弃，清空任务，就地改道新目标 |
  | 建材采收 (`StockStone`/`StockWood`) | 临界饥渴、冬季暴雪私宅断柴 (<10)、私宅耐久危机 (<20%) | 原地掉头回宅或就近自救，保留已采建材 |
  | 远征登基 (`SeekThrone`) | 临界饥渴濒死 | 撤销远征，掉头觅食 |
  | 升级施工 / 修缮 | 临界求生、王位空缺加冕 | 暂停施工，进度冻结不回滚 |
- **转换契约**：抢占触发时调用 `transition::cancel_task(agent)`，保留随身行囊，沿原车道连续掉头平滑切入新任务，严禁瞬移。

---

### 维度三：基于先天禀赋与家资的个性化选策 (M19.4c)
- **现状**：所有族人统一走同一种几何最近点探测，智商 130 与智商 70、家财万贯与身无分文的族人行为无差异。
- **增强设计**：
  1. **力量 (Strength) 驱动**：
     - 高力量族人（>110）：野外采收与采石伐木装载速率 +25%，倾向优先响应高强度的石矿开采（`b9`）与建房升级；
     - 低力量族人（<90）：倾向轻体力活动（浆果采摘、清泉汲水、留守修缮）。
  2. **智力 (Intelligence) 驱动**：
     - 高智力族人（>110）：市场价格感知敏感度更高。当野外 POI 储量偏低或距离较远时，更聪明地根据「路途耗时 vs 榷场现货牌价」权衡，优先选择榷场交易；
     - 寻路时避开磨损严重、减速显著的泥泞道路。
  3. **家庭财富 (Household Capital) 阶层分化**：
     - **豪绅家户**（金币 ≥ 200）：户主在面临家庭物资缺口时，80% 几率直接派遣自身赴榷场采购现货，不亲自挖矿伐木；
     - **平民家户**（金币 < 50）：严格走野外亲力亲为采掘，积累剩余价值。

---

### 维度四：多品类采收候选预排队列 (M19.4d)
- **现状**：族人单次出门只以单一 POI 为初始目标，只有在采完后才现场临时碰运气尝试继续采收。
- **增强设计**：
  - 当户主/族人拥有私宅且私宅同时存在多种物资短缺（例如同时缺水和粮食）时，L2 策略规划器在出发时生成定长（最大 3 站）的 **行程预排队列 (Harvest Itinerary)**；
  - 路径规划根据 TSP / 凸包贪心排序，先去顺路 POI A，再前往 POI B，最后统一满载归宅；
  - 队列保持动态可失效性：若途经站点被关闭或行囊提前装满，平滑截断后续计划并直接返家。

---

## 阶段实施路线图

```text
M19.4a 表现层与可解释性 (Inspector 三栏看板) ✅ 已完成 (v1.46.9)
  ├── 1. Rust AgentSnapshot / FABS 二进制快照增加 ActiveTask 结构透传
  ├── 2. snapshot-bin.js 与 rustworld.js 解码同步
  ├── 3. render_inspector.js 呈现 意图/策略/行动 三栏自适应卡片与瞬发待结 Pill
  └── 4. 门禁与端到端视觉校验通过
       │
       ▼
M19.4b 仲裁增强 (分级任务抢占机制) ✅ 已完成 (v1.46.9)
  ├── 1. L1 抢占策略矩阵实现 (Preemption Matrix: 生理/断柴/危房抢占)
  ├── 2. transition::preempt_task 沿原车道连续掉头平滑重路由与行囊保全
  └── 3. test-preemption.js 五大场景验证全通 (5/5 PASS)
       │
       ▼
M19.4c 策略增强 (禀赋与财富个性化) ✅ 已完成 (v1.46.9)
  ├── 1. 力量对重体力采收装载速率调节 (+25% / -15%) 与低力量家政修缮偏好
  ├── 2. 智力理性商贸（高智力族人权衡路途耗时与市场现货牌价）与通衢高磨损车道偏好
  ├── 3. 家户财富阶层分化（豪绅 80% 几率赴市现货采买免于体力劳作；平民自力更生）
  └── 4. test-personalization.js 五大场景验证全通 (5/5 PASS)
       │
       ▼
M19.4d 规划增强 (多品类预排采收路径优化) ✅ 已完成 (v1.46.10)
  ├── 1. Agent3D 增加 `harvest_queue: [Option<BranchId>; 4]` 定长字段（零堆分配、#[serde(default)]）
  ├── 2. harvest.rs 实现 `plan_harvest_itinerary` 最近邻贪心链路优化器 (TSP Heuristic)
  ├── 3. harvest.rs 连续采收入口改造：优先消费预排候选队列，失效自动重排，兜底 branch_order
  ├── 4. 任务抢占、回宅卸货、体力耗尽时规范取消与重置队列
  ├── 5. 快照四处同步：ActiveTaskSnapshot 增加 itinerary 预排可视化透传并在 Inspector 展示
  └── 6. 编写 tools/test-itinerary.js 验证矩阵全通 (5/5 PASS)
```

> **★ M19.4d 验收结论（v1.46.10）**：`tools/test-itinerary.js` 5/5 全通——
> ① 多品类行程预排生成 `💧备水 → 🌲备木 → 🍒备粮`；② TSP 最近邻排序（Water 10 出发优先取更近的浆果 b6）；
> ③ 水满现场转站（预排队列消费 → `SeekingFood`/b6）；④ 体力告警（15%）清空队列并 `ReturningToCamp` 安全折返；
> ⑤ Seed 101/202/303 六百 tick 长程重放哈希逐字节一致、零 NaN、零越界。
>
> **排查要点（易踩坑）**：验证「行囊已装满」时必须使用 `SIM_CONFIG.carryCapacityResource`（当前 **100.0**）
> 而非臆断的 50.0——否则 `carry_full=false` 且 `house_water_full=false` 时 `finished` 判据不成立，
> 族人会在水源原地持续饮水，**永远走不到** `try_continue_harvesting`，表现为「预排队列不生效」的假故障。

---

## M19.4d 详细技术规划

### 1. 核心状态与契约设计
- `crates/sim_core/src/spatial/agent.rs`:
  - `Agent3D` 增加 `pub harvest_queue: [Option<BranchId>; 4]`
  - 实现 `pop_harvest_queue(&mut self) -> Option<BranchId>`（先进先出、定长平移）
- `crates/sim_core/src/spatial/decisions/harvest.rs`:
  - 实现 `plan_harvest_itinerary(&self, agent: &Agent3D) -> [Option<BranchId>; 4]`：
    - 检索当前家户所有缺料品类（水、粮、木、石、金）
    - 定位各品类最近可用有效 POI
    - 基于当前位置贪心最近邻排序，生成总路程最短的 1~4 站多品类采收链路
  - `try_continue_harvesting` 升级：
    - 优先消费 `harvest_queue` 下一站
    - 逐站经 `arbitrate_continuous_harvest_candidate` 重验资格
    - 候选失效（如断流或已被家人采满）时平滑跳过并尝试下一站
    - 队列耗尽时回退至 `self.branch_order` 兜底
- 快照与可观测性（四处同步）：
  - `ActiveTaskSnapshot` 增加 `pub itinerary: String`
  - `snapshot.rs`、`snapshot_bin/encode.rs`、`snapshot-bin.js`、`rustworld.js` 同步
  - `render_inspector.js` 与 `index.html` 呈现 `🗺️ 预排行程: 💧备水 → 🍒备粮 → 🌲备木`
- 验证套件：
  - 创建 `tools/test-itinerary.js`，验证预排链路生成、就近排序、候选失效跳过、长程确定性。
