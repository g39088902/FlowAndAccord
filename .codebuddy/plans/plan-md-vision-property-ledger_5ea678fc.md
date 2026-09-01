---
name: plan-md-vision-property-ledger
overview: 在 docs/PLAN.md 中新增"多级产权账本经济"愿景章节：个人私产 / 家产（户主管理）/ 族产（宗族长老管理）/ 公仓（地区官员管理）/ 公司资产（老板管理）五级资产负债体系，阐述其经济可解释性、势力对垒与合作的政体映射，为后续经济账本化重构提供愿景锚点（不涉及任何代码改动）。
todos:
  - id: read-plan-structure
    content: 重读 docs/PLAN.md 目录树与 §3 架构章节，确定新愿景子节插入位置与编号
    status: completed
  - id: write-ledger-vision-section
    content: 撰写五级产权账本愿景子节：账本层级表、势力对垒与合作、政体映射、理论框架与 Mermaid 图
    status: completed
    dependencies:
      - read-plan-structure
  - id: sync-architecture-diagram
    content: 更新 §3.1 分层架构 Mermaid 中 EconomySubsystem 块与目录树，衔接 PersonalWallet/PublicTreasury 既有概念
    status: completed
    dependencies:
      - write-ledger-vision-section
  - id: update-milestone-deps
    content: 在 §4 排期 W13-W14 动态专利经济处补充账本体系前置依赖说明并核对目录编号
    status: completed
    dependencies:
      - write-ledger-vision-section
  - id: review-consistency
    content: 通读修订后 PLAN.md，校验与已立项技术方案及 AGENTS.md 文档地图的表述一致性
    status: completed
    dependencies:
      - sync-architecture-diagram
      - update-milestone-deps
---

## 需求总结

本次任务为**纯文档工作，不执行任何代码开发**：将已确认的“多级经济账本”思想沉淀为 PLAN.md 的正式愿景章节，更新项目长期规划书，使其与已立项的“仓库与房屋解耦”技术方案形成“愿景 → 落地”的呼应关系。

## 愿景核心（需写入 PLAN.md 的内容）

### 五级产权账本体系（资产负债表的社会结构化）

- **个人私产**：居民本人持有（PersonalWallet），随身影囊为雏形；下台/迁徙不被没收，是“私产不可侵犯 vs 征税征用”张力的根基；
- **家产（家庭账本）**：由**户主**管理，承载家庭储粮水、供暖消耗、建房升级的显式支付；
- **族产（宗族账本）**：由**宗族长老会**管理，族人按比例缴纳族税，族内互助、联姻结盟、族际竞争的经济载体；
- **公仓（地区公库）**：由**地区官员**管理，对辖内收成抽税入仓，灾年救济再分配；张力在“救济仁政 vs 加税汲取 vs 官员贪腐”；
- **公司资产（企业账本，预留扩展位）**：由**老板**管理，引入雇佣劳动、复式记账与有限责任，承载劳资博弈、垄断与反垄断。

### 三大愿景支柱

1. **资产负债表即社会结构快照**：资产不再锁死于建筑，而归属于有管理者的账本主体；每笔资源流动（纳税、救济、工资、分红、彩礼、租金）都是主体间显式交易，可审计、可追溯；
2. **经济可解释性**：显式支付替代隐形门槛——开工扣款、竣工付清、收支流水；任何建筑的升起与坍塌都能在账本上找到因果链；
3. **势力对垒与合作**：五级账本主体即玩家与 AI 势力的经济载体——结盟形态（族产联姻、公仓采购、公司入股）、对抗形态（挤兑、囤积、制裁、国有化）、组织演化（家族→宗族→公司）。

### 政体映射

五级账本与现有六维政治资本向度对应：个人→个体自由，家产/族产→宗法 Dynasty，公仓→民意 Civic 与国家能力（财税汲取），公司→资本 Capital；账本管理者群体即“多重胜选联盟”的经济底盘。

## 交付物

更新 `docs/PLAN.md`：新增账本经济愿景子节（含 Mermaid 架构图、五级产权对照表、理论框架引用——科斯产权理论、韦伯家产制、凡勃伦企业论、复式记账财政史）、同步 §3.1 分层架构图中 EconomySubsystem 块、更新目录树、在 §4 排期 W13-W14 动态专利经济处标注账本体系为前置依赖。