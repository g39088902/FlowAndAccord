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
- [地形美术与世界景观提升（短期 S1/S2/S2.1/P2 已落地，中期待办）](./21-plan-terrain-art.md)：诊断项落地对照、短中长期方案、剩余素材与季节工作、验收预算。
- [新地形特征与地理玩法（方向设计，未排期）](./22-plan-terrain-features.md)：八类基础地形与 14 种未来地图模板（含台地、河口三角洲、海湾、盆地、峡湾、河谷、半岛、海岛、沙漠绿洲、山前冲积扇、喀斯特），以及生成、通行、取水和选址契约。
- [新增地形实施技术方案（实施方案，未实现）](./26-plan-terrain-implementation.md)：将 T0～T2 收敛为地表查询、合法走廊、水系资源池、快照、存档与 Canvas 的分阶段技术契约。
- [动态季节光照（设计方案，未排期）](./27-plan-seasonal-lighting.md)：年周期光弧（一年一圈、四季四象限）、地形重着色、立体面光照与世界空间阴影，零内核改动。
- [水系河岸平滑化与写意微缩沙盘水体改造（设计方案，未排期）](./28-plan-river-shoreline-refinement.md)：消除 13 米级网格阶梯锯齿、连续矢量水体与平滑湿砂漫滩覆盖、岸线表面张力微沫高光，零网格细分与零 GC。
- [农田与农业税](./17-plan-farmland-agriculture.md)：真实劳动与搬运、卸货时产出税、产出税与库存税并存。
- [狩猎、流寇与防御](./18-plan-conflict-hunting-defense.md)：共用物资/身体模型，防务设施接入统一土地与通行规则。
- [人物日常生活细化（方向设计，未排期）](./20-plan-everyday-life.md)：八个生活深化方向、首期“一家人的一天”与分阶段建议。
- [人物记忆与经验传承（实施方案，未排期）](./23-plan-memory-system.md)：首批 10 种记忆、事实编码与遗忘、决策接入、代际传承及确定性验证。
- [内部市场（设计方案，未排期）](./24-plan-internal-market.md)：木石金换水粮救急、余水余粮反向交易、黄金本位 AMM、内外比价与真实搬运结算。
- [人际依赖与敌对关系 × 生产机制（方向分析，未排期）](./29-plan-social-relations-production.md)：除婚育外的关系×生产缺口诊断、依赖方向（换工帮工/生产资料共享/赡养继承）、敌对方向（公地悲剧/水权/宗族世仇/偷窃黑化）与五条生产传导管道、落地优先级。

- [在办方案融合设计](./25-plan-system-integration.md)：已确定、尚未实现的跨专项契约，统一家庭储备与预约、L2 选策、食物/用品/身体状态、土地通行和事实观察；实施顺序表示依赖，不新增排期。

## 归档准则

完成的里程碑计划、已被现状文档取代的设计方案，以及不再是实施依据的旧版本方案，保留在 [`archive/README.md`](./archive/README.md) 供追溯，不应作为开发入口。当前行为以 `docs/current/`、源码及 `AGENTS.md` 为准。
