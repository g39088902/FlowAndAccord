# 🧭 竞品与同类项目分析

> 分析基线：Flow & Accord v1.45.4 现状；GitHub 检索日期：2026-09-07。
> 本文比较的是公开仓库和 README 中已经声明、可验证的能力；“完成度”不等同于 stars 数量，也不把路线图功能当作已实现功能。

## 1. 分析对象与比较维度

Flow & Accord 的核心定位是：**确定性 Rust/WASM 仿真内核 + 浏览器观察器 + 逐个体自主决策 + 有限生态资源 + 真实搬运与建造 + 家户/宗族/王国制度演化**。

因此，竞品不只按“是不是文明游戏”判断，而按以下六个维度比较：

1. 个体 Agent：是否有逐个体生命、需求、关系和行动，而非只有人口总量；
2. 生态与资源：是否存在有限资源、再生、季节/气候、生产或物流约束；
3. 社会制度：是否有家庭、继承、宗族、组织、治理、战争或文化；
4. 确定性与可观测性：种子复现、Replay、分支、快照、时间加速和 Inspector；
5. 产品完成度：能否直接运行、是否有持久化、测试、CI、可视化和文档；
6. 工程规模：核心代码量、测试覆盖和模块化程度。

## 2. 结论摘要

- **最接近整体方向**： [AEON: Living Worlds](https://github.com/Linutesto/aeon-living-worlds)。它把确定性世界、气候、资源、城市、公民、宗教、派系、迁徙、战争和 3D 浏览器观察器放在了一起，但仍明确标注为实验原型。
- **最接近“只写物理规则、让文明涌现”**： [Genesis Engine](https://github.com/Micka420-collab/genesis-engine)。它在物理、遗传、语言和多代生态方面更激进，但更像研究实验室而非完成品游戏。
- **最接近逐个体生存与物流玩法**： [Dwarf Land](https://github.com/sliday/dwarf-land)。自主矮人、背运、饥饿、道路、郊区、家庭、制造和交易都很接近；代价是依赖分层 LLM 调用与 Cloudflare 服务。
- **最强的确定性观察器与实验工具**： [Civilization Simulator / genesis](https://github.com/tan-zhuo/genesis)。它有 Replay、平行宇宙、规则编辑器、Monte Carlo 和 10,000 年快进，但采用宏观人口模型，并非逐个体 Agent。
- **工程规模最大**： [Agent World](https://github.com/sendwealth/agent-world)。Rust 引擎、Python Agent Runtime、Dashboard、治理、联邦和实验工具远大于本项目；但它是 LLM 多智能体平台，不是零玩家浏览器游戏。

综合判断：目前没有发现一款在上述六个维度上全面超过 Flow & Accord 的开源作品。现有项目通常选择一个方向做到更深：宏观文明、生态遗传、LLM 社会、3D 展示或工程平台。

## 3. 重点项目对比

| 项目 | 已实现且可核对的能力 | 相对 Flow & Accord 的优势 | 主要差距 / 风险 | 公开成熟度信号 |
| :--- | :--- | :--- | :--- | :--- |
| [AEON: Living Worlds](https://github.com/Linutesto/aeon-living-worlds) | 确定性 Tier-0；地形、气候、资源、物种、城市、公民、宗教、派系、迁徙、战争、经济；Three.js/WebGL 仪表盘；存档与测试 | 3D 表现、文明/宗教/派系广度、可扩展公民数量 | Python 后端；AI/社会层仍是 prototype；作者明确声明不是完成品游戏 | 78 stars；README 列出 8 次提交；PolyForm Noncommercial |
| [Genesis Engine](https://github.com/Micka420-collab/genesis-engine) | 物理层、气候、生物、256 维 DNA、代谢、选择、季节、23 代、多代人口、语言、发明、建造、SIR、Earth Console、保存/加载/GIS | 物理真实性、遗传与语言涌现、可证伪实验取向 | AGPL；运行门槛较高；文明游戏体验和 UI 产品化程度不明确 | 157 个测试；1 star；项目状态仍有长期实验阶段 |
| [Dwarf Land](https://github.com/sliday/dwarf-land) | 最多 300 个自主矮人；Dijkstra/A* 路网；道路升级与修复；背运、饥饿、死亡、家庭、生育、郊区、城市、制造、交易 | 资源物流、道路生命周期、家庭居住行为、测试/CI 工程 | 4-tier LLM 决策；Cloudflare Workers/D1；部分功能明确标为 TODO 或未实现 | 453 tests / 26 files；141 次提交；5 stars |
| [Civilization Simulator / genesis](https://github.com/tan-zhuo/genesis) | 纯前端；确定性 Replay；分支宇宙；2–20 文明；规则编辑器；城市、科技、贸易、外交、战争、信仰、废墟；Monte Carlo 与参数扫描 | 观察器完成度、历史分析、实验编排、分享 URL、宏观运行速度 | 明确不做逐个体模拟；人口是宏观模型；与 Flow & Accord 的 Agent 生活细节不可直接互换 | 26 次提交；0 stars；有 Vitest、lint、build 和 10,000 年性能测试 |
| [Agent World](https://github.com/sendwealth/agent-world) | Rust 世界引擎、Python Agent Runtime、Next.js Dashboard；经济、组织、文化、选举、外交、联邦、迁徙、快照、实验、SDK | 工程规模、治理制度、API、观测、研究工具、测试数量 | LLM/服务化依赖；Docker 部署；不是纯本地零玩家游戏 | Rust 约 81k 行、Python 39k 行、Dashboard 21k 行；1,165 个 Rust 测试；783 次提交 |
| [Oikoumene](https://github.com/GeoLambdaAI/oikoumene) | 地球尺度文明；Maslow 风格需求；气候、资源、定居点、贸易、冲突、特征演化；可复现 RNG；NumPy/JEPA 后端 | 地理尺度、宏观气候和科学模型、文明史跨度 | v0.3.1 研究原型；真实数据管线尚未完全接入运行时；逐个体生活层较薄 | 6 stars；25 次提交；大量 Python 测试 |
| [life-simulation](https://github.com/dominikvytisk/life-simulation) | 基因组、表型、循环脑、记忆、捕食、腐肉、信息素、繁殖、物种形成、通信、WebGPU、IndexedDB、实验面板 | 生物个体认知、遗传、记忆、通信和实验观测更深 | 没有房屋、家户、市场、宗族、王国和文明制度 | 10 stars；确定性与 fork 复现测试；浏览器可运行 |
| [Pixeldarium](https://github.com/Akotz89/Pixeldarium) | 行星级生成；12 个时代；生态到文明再到太空；WebGL2；结构化数组；持久化；无依赖、无构建 | 行星尺度、视觉管线、远期文明时间跨度 | 主要是聚合层；逐个体 Agent 与制度细节弱；项目仍早期 | 约 19,484 行；2 个测试文件；0 stars |
| [Causafera](https://github.com/Sir-Starch/Causafera) | Rust 确定性因果引擎、持久世界、主体性 Agent、语言、制度、历史、Observer、集成测试 | 因果溯源、可复现事件和运行时契约设计 | 作者明确声明 pre-alpha、不是完成品或可玩游戏 | 335 次提交；2 stars；AGPL + CC-BY-SA |

## 4. 分项目分析

### 4.1 AEON: Living Worlds

AEON 的架构与本项目最相似：确定性模拟层负责世界事实，上层公民、社会、学习系统和可选 LLM 负责解释或施加受约束的影响。README 明确列出地形、气候、资源、物种、文明、城市、战争、经济、宗教、派系、迁徙和 3D WebGL 仪表盘。

它对 Flow & Accord 最有参考价值的不是某个单一机制，而是**分层缩放**：只有观察焦点附近的公民完全实例化，其余人口以较低细节表示。这对未来扩大 Flow & Accord 的 Agent 数量很有启发。

需要注意的是，AEON 自己明确称为 experimental prototype，AI/社会系统成熟度不均，存档格式和行为平衡仍在变化。因此它是“方向上更宽”，不是“产品上已经完成”。

### 4.2 Genesis Engine

Genesis Engine 的核心口号是“ZERO PRE-SCRIPT”：只硬编码物理规律，语言、工具、文明、货币和崩溃必须由 Agent 涌现。它覆盖热力、重力、水文、侵蚀、气候、生物、DNA、认知、贸易、建造、政体和语言，并提供 Earth Console、保存/加载、GIS 导出和可证伪性账本。

它比 Flow & Accord 更强的地方是生态与物理模型的纵深；Flow & Accord 更强的地方则是**具体的生活闭环和制度可视化**：家户账本、真实背包、空置房拍卖、宗族税、王国继承、榷场救济和可拖动的需求分支顺序。

### 4.3 Dwarf Land

Dwarf Land 是最值得研究“Agent 如何把资源带回家”的项目之一。它有地形速度、A* 道路、道路升级与修复、资源背运、食物分享、饥饿死亡、家庭、生育、郊区迁居和城市升级，且运行在浏览器 Worker 中。

其 453 个测试和 CI 组织方式也很有借鉴价值。不过它的高层决策依赖 Gemini、Claude、GPT 等分层模型，并通过 Cloudflare Workers/D1 提供服务；这与 Flow & Accord 的**无 LLM、种子相同即逐字节复现**原则不同。

### 4.4 Civilization Simulator / genesis

这个项目是“文明观察器”方向的强参考：纯前端、确定性规则、Replay、平行宇宙、URL 分享、参数扫描、Monte Carlo、事件叙事、信仰和神迹干预都做得很完整。

它的关键取舍是：人口、迁徙和文明采用宏观模型，不模拟每个人的饥渴、背包、移动和家庭生活。因此它不能直接替代 Flow & Accord，但可以作为未来“**实验室模式**”的 UI/交互参考，例如批量种子对比、参数敏感性和历史分支比较。

### 4.5 Agent World

Agent World 更像一个可扩展的社会仿真平台：经济、组织、文化、选举、外交、联邦、迁徙、DSL 规则、快照、SDK、实验报告和观察者 API 都有独立模块。其公开统计为约 141k 行代码和 1,165 个 Rust 测试，工程化程度远高于一般个人项目。

但它的目标不是“打开网页看一群人自己生活”，而是“让外部 Agent 接入一个可观测世界”。如果 Flow & Accord 未来进入 M10–M13，Agent World 值得重点借鉴的是 API、实验、快照、权限和可观测性，而不是直接照搬其 LLM 决策架构。

### 4.6 Oikoumene

Oikoumene 与 Flow & Accord 有一个有趣的交集：它同样把 Maslow 风格需求用于 Agent 目标选择，并把气候、资源、定居点、贸易、冲突和特征演化放进同一个循环。

它更偏“人类历史/地球系统模型”，而 Flow & Accord 更偏“有限地图上的逐个体生活史”。前者适合参考宏观反馈（气候—人口—资源—冲突），后者适合参考可解释的微观行动和产权制度。

### 4.7 life-simulation

life-simulation 不应被视为文明竞品，但它是生物 Agent 方向的优秀参考。其 README 已列出完整基因组、循环脑、记忆、内部预测、规划、声学通信、物种形成、实验消融和可观测性。

对于 Flow & Accord，最可迁移的思路是：把“智力、力量、魅力、消化效率、睡眠效率、寿命”等先天禀赋继续扩展为可测量、可遗传、可做跨种子实验的指标，而不是直接引入黑箱神经网络。

## 5. Flow & Accord 的竞争位置

### 已有明显差异化

- 不依赖 LLM，行为由确定性需求分支和物理规则产生；
- Agent 是真实的个体，而不是只在统计层面出现的人口；
- 资源会进入背包、沿路径运输、回家卸货并进入家户账本；
- 房屋是有产权、有耐久、有继承和二手拍卖的实体；
- 家户、宗族、王国和帝国形成一条连续的制度链；
- 路网由 Agent 的实际移动踩踏出来，并参与寻路和速度反馈；
- 浏览器端有 Inspector、族谱、账本、拍卖、决策编排和 Tick 回滚等观察工具。

### 相对薄弱的方向

- 生态目前主要是资源 POI，不是完整的动物/捕食/食物网；
- 个体认知主要是可解释规则，还没有 AEON 或 life-simulation 那样的记忆、学习和语言层；
- 文明规模目前偏小，尚未达到 Agent World 或 AEON 的千级/万级扩展；
- 农业、生产链、技术扩散、文化和跨地区贸易仍有较大扩展空间；
- GitHub 外部知名度和社区贡献明显低于已有 stars 的项目。

## 6. 可借鉴的研发方向

| 优先级 | 借鉴对象 | 建议吸收内容 | 不建议直接复制 |
| :--- | :--- | :--- | :--- |
| P0 | tan-zhuo/genesis | Monte Carlo、参数扫描、平行宇宙、实验报告、历史分支 UI | 宏观人口替代逐个体 Agent |
| P0 | AEON | Tier-0/社会层分离、LOD 公民、3D 观察器、Chronicle | 依赖 GPU/LLM 才能运行的核心路径 |
| P1 | Dwarf Land | 物流、道路修复、郊区、家庭迁居、测试组织 | LLM 决策作为唯一行为来源 |
| P1 | Agent World | API、快照、实验、治理和可观测性 | 服务化部署和复杂权限作为当前前端前置条件 |
| P1 | Genesis Engine | 气候—资源—人口反馈、遗传实验、可证伪性账本 | 过早引入高成本真实地球数据 |
| P2 | life-simulation | 记忆、通信、认知指标、跨种子消融实验 | 黑箱网络替代现有可解释需求引擎 |

## 7. 后续跟踪清单

建议每季度复查一次以下项目：

1. AEON 是否从 prototype 进入稳定的社会/公民模拟；
2. Genesis Engine 是否完成 10k 年长程运行与更完整的文明层；
3. Dwarf Land 是否解决已知 TODO、宗教接口和 LLM 成本问题；
4. tan-zhuo/genesis 是否增加逐个体 Agent 或继续保持宏观定位；
5. Agent World 是否开放更轻量的本地运行方式；
6. Flow & Accord 自身在 M10（专利经济）、M11（混合政体）和 M12（LLM 认知总线）完成后，重新进行一次能力矩阵比较。

## 8. 来源与说明

本文引用的项目链接均为公开 GitHub 仓库。stars、提交次数和 README 状态属于检索时的页面快照，只用于辅助判断项目活跃度，不代表代码质量或真实可玩性。对于所有项目，正式采用前仍应实际 clone、安装、运行示例、阅读测试和核对许可证。
