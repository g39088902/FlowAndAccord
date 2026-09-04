# 14. 🔒 核心不变量集中清单 (Invariants)

> **模块索引**：[← 返回 current.md 全景索引](../current.md)
>
> 本清单将散落在根 `AGENTS.md` §4 各小节中的硬约束集中提炼，按类别组织。
> **agent 启动时读这一页即可掌握"哪些东西绝对不能动"**，比在 21KB 的 AGENTS.md 里逐节找高效。
> 每条不变量标注来源章节，便于追溯完整上下文。

---

## 一、确定性约束 (Determinism)

> 同一种子、同一输入必须产生逐字节一致的输出。这是混沌系统可复现的基石。

| # | 不变量 | 来源 | 违反后果 |
|---|---|---|---|
| D1 | **`WorldRng` 全局共享，按 agents 顺序依次消费** | §4.3 / spatial/AGENTS.md §4.3 | 同种子逐字节一致性校验失败 |
| D2 | **遍历 agents 时按 Vec 顺序（id 升序），不可用 HashMap 迭代** | spatial/AGENTS.md §4.3 | RNG 消费顺序乱序，确定性破坏 |
| D3 | **POI 初始化播撒按固定类型顺序（营地→泉→果→木→石→金）** | spatial/AGENTS.md §4.3 | 播撒位置随机数偏移 |
| D4 | **新增任何 RNG 消费点会改变后续所有随机数** | §4.3 | 必须重新校准同种子基准 |
| D5 | **严禁修改 `config.simulationDt`**（1/30 秒） | §4.3 | 数值积分发散，所有时间相关参数失效 |
| D6 | **倍速通过 `world_tick_steps(N, dt)` 同帧多步实现** | §4.3 | 改 dt 等价于破坏 D5 |
| D7 | **`test-wasm.js` 同种子逐字节一致性是唯一长期保留的自动化验证** | §4.10 | 无其他测试可替代确定性校验 |

---

## 二、数据一致性约束 (Data Consistency)

> 多源数据必须保持同步，单一真相源不可有副本。

| # | 不变量 | 来源 | 违反后果 |
|---|---|---|---|
| C1 | **家户账本是家庭储备唯一真相源**（M6 起已删除房屋仓库 `House.pantry_*`） | §4.8 | 吃喝/烧柴从错误来源扣减，库存与账本不一致 |
| C2 | **快照三处同步**：新增 agent/house/poi 字段时必须同步修改 ① `snapshot.rs`（定义）② `world_snapshot.rs::generate_snapshot()`（赋值）③ `rustworld.js::_applySnapshot()`（前端映射） | §4.5 / spatial/AGENTS.md §3.3 | 前端读到 `undefined` 或展示旧值 |
| C3 | **WASM 双副本同步**：改 Rust 后 `sim_wasm.wasm` 必须复制到 `frontend/rust/`（主路径）+ `frontend/`（备用） | §4.1 | 浏览器仍加载旧逻辑，行为与代码不符 |
| C4 | **不要用 wasm 字节数判断是否更新**，以 `node tools/test-wasm.js` 实际输出为准 | §4.1 | 字节数相同但内容已变的假阴性 |
| C5 | **`agent_index: HashMap<AgentId, usize>` 在 agents Vec 结构变更后必须调用 `rebuild_agent_index()` 刷新** | spatial/AGENTS.md §4.1 | `agent_by_id()` 返回错误下标或 panic |
| C6 | **新增超参须在 `config.rs` 三处同步**：命名 `const`（默认值唯一真相源）+ `SimConfig` 字段 + `Default` 映射 | §4.12 | 前后端配置失同步，config-check 报错 |
| C7 | **`decisionEvalOrder` / `decisionEvalLevels` 是「Rust 无顺序」字段**：Rust 默认为空 Vec，权威值只存在于前端 `config.decision-order.js` | §4.12 / §4.14 | 在 Rust 侧写死策展优先级即破坏内核无序设计 |
| C8 | **`agentArchive` 全量档案库**保存所有出生过的族人（含已故），新增 agent 字段时须确认 `_applySnapshot` 归档逻辑 | frontend/AGENTS.md §5.4 | 族谱/回溯展示缺失新字段 |

---

## 三、行为语义约束 (Behavioral Semantics)

> 模拟行为的时序、相位和自主性不可随意改变，否则涌现逻辑会崩溃。

### 3.1 Tick 内部顺序（§4.3，勿打乱）

```
0. tick_season(dt)                    四季更迭与温度演化
1. POI 自然恢复                        按类型应用产速倍率
2. 代谢与繁衍 (胎儿跳过)               agent.tick_metabolism
   2.3 tick_fetus_reconcile()          受孕建胎儿/流产移除/位置跟随
   2.5 settle_gold_inheritance()        死者金币平分给在世子一代
3. tick_poi_interactions(dt)           POI 实际提取、装载、卸货入账、分娩
4. tick_housing(dt)                     房屋折旧、冬季供暖、空置房登记
5. network.tick_wear_decay(dt)         道路自然衰减
6. 运动 (胎儿跳过)                      agent.tick_movement
   tick_decisions()                     错峰决策 ((tick + id) % 30 == 0)
7. tick_bookkeeping()                   M2 继承清算 + 分家抽资
8. tick_clan(dt)                        M3 族长顺位 → 族税 → 族内互助
9. tick_region(dt)                      M4 初王顺位 → 长子继承 → 公仓税 → 救济
```

**关键时序不变量**：
- **卸货入账在决策之前**（步骤 3 → 决策）：决策读到的是卸货后的家户账本余额
- **道路衰减在运动之前**（步骤 5 → 6）：运动踩踏的是衰减后的路网
- **决策在运动之后**：决策基于本 tick 运动后的位置和状态
- **bookkeeping/clan/region 在决策之后**：制度结算使用决策后的最终状态

### 3.2 决策与行为约束

| # | 不变量 | 来源 | 违反后果 |
|---|---|---|---|
| B1 | **决策错峰相位**：每个 agent 仅在 `(tick_counter + agent.id) % 30 == 0` 的相位上决策，全员相位均摊错开 | §4.3 | 全员同拍决策导致性能尖峰和行为同步化 |
| B2 | **建房/升级/修缮均为 Agent 自主决策**，严禁系统扫描指挥（`tick_warehouse_founding` / `check_start_house_upgrades` 等旧扫描器已删除，勿复活） | §4.11 | 破坏"系统只当物理规则执行者"的设计原则 |
| B3 | **掉头必须平滑回走**（中途重路由时在当前车道反向平滑回走），严禁闪现瞬移 | §4.2 | 坐标不连续，渲染跳变 |
| B4 | **Agent 私有 POI 施密特触发器**：开启 ≥ 0.30 / 关闭 < 0.10 / 中间带保持前态，每名 Agent 维护私有锁存 | §4.2 | 相同 POI 被不同 Agent 判为不同可用性是预期行为 |
| B5 | **连续采收**：现场采收时若目标触发器已关闭但行囊未满且家宅仍需，自动前往下一处自身触发器已开放的同类 POI | §4.2 | 提前返家导致效率低下 |
| B6 | **无家宅者不装载行囊**，只在现场就地自饮自食 | §4.4 | 无家者装货后无处卸货 |
| B7 | **胎儿跳过**：代谢（步骤 2）、运动（步骤 6）、决策均跳过 `is_fetus` 的 agent；胎儿参与家户成员计数、继承清算、宗族成员 | spatial/AGENTS.md §4.2 | 胎儿有地图实体会导致渲染和交互异常 |
| B8 | **分娩时原位复用胎儿 ID** 替换为新生儿，不新建 ID | spatial/AGENTS.md §4.2 | ID 段位混乱，族谱断代 |
| B9 | **去采货 = 施密特触发器（M7 起）**：有房即可采，与房屋等级彻底脱钩；家户账本余额 < 100 触发，补到 ≥ 200 才停 | §4.8 | 旧逻辑按房屋等级决定采收权限已废弃 |
| B10 | **升级成本 = 4×5 固定矩阵（M8 起）**：`needs::upgrade_material_cost` 单一真相源，0→1 不再是"无材料恒就绪"，需水≥50 且粮≥50 | §4.8 | 升级就绪判定与扣账不一致 |
| B11 | **生育去房屋化**：受孕不再依赖房屋等级或仓储备货，成年已婚女性身体指标达标且**流产冷却（200s）与产后休养冷却（200s）均结束**即可受孕，无房也可生育 | §4.8 | 旧 0 级禁孕/木材支持门槛已删除 |
| B12 | **淘金纪律**：4 级大庄园竣工前绝不娱乐淘金（`GoldWealth` 冷却 180s）；盖房备料淘金 `StockGold` 冷却 45s | §4.8 | 行为优先级混乱 |
| B13 | **镜头跟随**：选中小人后 `isCameraFollow` 开启，关闭 Inspector（✕ 或 Esc）时必须同时关闭跟随 | §4.8 | 镜头持续跟随已取消选中的族人 |
| B14 | **外部市场隔离与单向流失（v1.13.0，v1.27.0 扩展）**：榷场互市不进入 `NodePool`，不设公地施密特触发器，由 B15 专用派发；★ v1.27.0 起水/粮采集断流时家户户主（账本黄金 ≥ `market_min_family_gold` 且体力达标）可由 `try_route_to_market` 直接改道榷场——仍是**家户账本远程结算付费**，不改变市场支付与黄金单向扣入 `LedgerRef::Void` 的通缩闭环；到达后先濒危自救再装袋购入 | 16-market-pricing.md | 族人蹭吃蹭喝破坏公地平衡或黄金通缩机制失效 |
| B15 | **决策分支数组定长联动（18分支）**：内核 `BranchId::ALL`、`resolve_order`、`seen` 与前端 `DEFAULT_ORDER`、`VALID_BRANCH_ID` 严格定长联动 | §4.14 / 16-market-pricing.md | 决策分支越界、反序列化 panic 或写盘校验失败 |

---

## 四、构建部署约束 (Build & Deploy)

| # | 不变量 | 来源 | 违反后果 |
|---|---|---|---|
| P1 | **CI 使用标准 rustup**，严禁在 workflow 中设置 `CARGO_HOME` 指向 `.cargo-home` 或把 `.toolchain/` 加入 PATH（它们是 Windows 便携缓存，与 ubuntu-latest 不兼容） | §4.13 | CI 编译失败 |
| P2 | **wasm MIME 必须 `application/wasm`**，workflow 上传后对双副本强制覆写 Header | §4.13 | 浏览器以 `application/octet-stream` 加载，wasm 实例化失败 |
| P3 | **门禁不过不部署**：`test-wasm.js` 失败时 `coscmd` 上传步骤不执行 | §4.13 | 破损版本上线 |
| P4 | **前端是纯静态文件**，改完刷新即生效，切勿用外部 vite/webpack 替代内置 `server.js` | §4.1 | 构建工具链引入不必要的复杂度 |
| P5 | **3000 端口已被占用时无需再启动新实例**，直接访问即可；重复启动会触发端口递增逻辑的已知问题导致卡死 | §2 步骤三 | 开发服务器卡死 |
| P6 | **每次重编译 WASM 后按 `Ctrl + F5` 强制刷新清缓存** | §2 步骤四 | 浏览器加载旧 wasm |

---

## 五、代码组织约束 (Code Organization)

| # | 不变量 | 来源 | 违反后果 |
|---|---|---|---|
| O1 | **单文件严控在 800 行以内**，功能膨胀时及时子目录模块化拆分 | §4.6 | 可维护性下降，agent 定位困难 |
| O2 | **不持久化保存任何单元测试脚本**（`#[cfg(test)]` / `tests.rs` 一律不进入提交）；临时验证通过后删除 | §4.10 | 固定断言锁死演化多样性，与混沌系统定位冲突 |
| O3 | **同一事实只在一个权威位置出现**，其余用交叉引用，禁止多处复制粘贴导致漂移 | AGENTS.md §5 | 文档与代码不一致 |
| O4 | **新增模块时**先建 `docs/current/0X-*.md` + 对应目录 `AGENTS.md`，再在根 AGENTS.md §0 加索引，最后在 `11-changelog.md` 追加条目 | AGENTS.md §5 | 文档缺失，后续 agent 无指南可依 |
| O5 | **改机制时同步更新**对应中层文档的机制描述 + changelog 条目；根 AGENTS.md 仅在跨模块硬约束变化时更新 | AGENTS.md §5 | 文档滞后于代码 |
| O6 | **版本号自增**：每次 AI 修改代码必须同步更新 ① `index.html` 版本徽章 ② 根 AGENTS.md §1/§2 版本号 ③ changelog 条目 | §4.9 | 版本混乱，无法追踪变更 |

---

## 六、前端 DOM 与加载约束

| # | 不变量 | 来源 | 违反后果 |
|---|---|---|---|
| F1 | **脚本加载顺序勿打乱**：config 三件套 → 决策三件套 → rustworld.js → 族谱四件套 → main.js → ledger-ui.js → render 五件套 | frontend/AGENTS.md §二 | 配置注入不完整、全局对象未定义 |
| F2 | **决策三件套必须在 rustworld.js 之前加载**——rustworld 构造时读取已合并决策顺序的 `SIM_CONFIG` | frontend/AGENTS.md §二 | wasm 注入不含决策顺序的不完整配置 |
| F3 | **DOM ID 共享契约**：`agent-inspector-*` / `house-inspector-*` / `poi-inspector-*` / `tab-*-content` / `dv-*` / `dag-*` / `debug-*` / `version-tag` 被多文件共享，改 ID 必须全量搜索替换 | frontend/AGENTS.md §四 | 面板元素找不到，渲染空白 |
| F4 | **render.js 已拆分为 5 个文件**（v1.7.0）：`render_canvas.js`（共享状态+主循环）→ `render_hud.js`（HUD/大盘）→ `render_world.js`（地形/路网/POI/房屋）→ `render_agents.js`（族人/特效）→ `render_inspector.js`（面板/拾取） | 本文档 | 新增渲染功能时放入对应子文件，勿回退到单文件 |

---

## 快速自检清单

改代码前 10 秒扫完：

```
□ 确定性：新增 RNG 消费？改 simulationDt？遍历顺序变了？
□ 数据一致：新快照字段三处同步？wasm 双副本？agent_index 刷新？
□ 行为语义：tick 顺序打乱？决策相位改了？系统扫描指挥复活了？
□ 构建部署：CI 用了便携工具链？wasm MIME 对吗？门禁过了吗？
□ 代码组织：单文件超 800 行？临时测试没删？版本号自增了？
□ 前端：脚本顺序对吗？DOM ID 全量替换了吗？
```
