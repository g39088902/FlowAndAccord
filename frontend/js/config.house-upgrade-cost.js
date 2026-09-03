// ==========================================================================
// Flow & Accord · 房屋升级材料成本矩阵配置 (config.house-upgrade-cost.js)
// ==========================================================================
// ★ M8：房屋升级「一次性材料成本」的唯一真相源（同时也是 b8/b11 升级就绪门槛）。
// 共 20 个字段（4 级 × 5 资源），因字段较多独立成文件，避免主配置 config.js 臃肿。
//
// 语义：houseUpgradeCostTierN{Kind} = 房屋【升到 N 级】时，该品类一次性扣除的数量。
//   · 升到 1 级（0→1）：水 50、粮 50
//   · 升到 2 级（1→2）：木 75、粮 75、水 75
//   · 升到 3 级（2→3）：石 100、木 100、粮 100、水 100
//   · 升到 4 级（3→4）：金 125、石 125、木 125、粮 125、水 125
//   该级不消耗的品类填 0.0 —— 扣账时自动跳过（`amt > 0.001` 守卫），
//   就绪判定对 0 恒成立（`balance >= amt - 1e-3`），不会阻塞升级。
//
// 加载顺序（index.html）：config.js → config.decision-order.js → 本文件 → … → rustworld.js
//   必须早于 rustworld.js 的首次 applyConfig；由 rustworld.js 用 Object.assign 合并进 SIM_CONFIG。
// 工具链：tools/config-check.js 与 tools/test-wasm.js 均已纳入本文件参与字段校验与注入。
// ==========================================================================
window.SIM_HOUSE_UPGRADE_COST = {
  // —— 升到 1 级（0→1）：水 50、粮 50（木/石/金不消耗）——
  houseUpgradeCostTier1Water: 50.0,  // 升到 1 级：水
  houseUpgradeCostTier1Food: 50.0,   // 升到 1 级：粮
  houseUpgradeCostTier1Wood: 0.0,    // 升到 1 级：木（不消耗）
  houseUpgradeCostTier1Stone: 0.0,   // 升到 1 级：石（不消耗）
  houseUpgradeCostTier1Gold: 0.0,    // 升到 1 级：金（不消耗）
  // —— 升到 2 级（1→2）：木 75、粮 75、水 75（石/金不消耗）——
  houseUpgradeCostTier2Water: 75.0,  // 升到 2 级：水
  houseUpgradeCostTier2Food: 75.0,   // 升到 2 级：粮
  houseUpgradeCostTier2Wood: 75.0,   // 升到 2 级：木
  houseUpgradeCostTier2Stone: 0.0,   // 升到 2 级：石（不消耗）
  houseUpgradeCostTier2Gold: 0.0,    // 升到 2 级：金（不消耗）
  // —— 升到 3 级（2→3）：石 100、木 100、粮 100、水 100（金不消耗）——
  houseUpgradeCostTier3Water: 100.0, // 升到 3 级：水
  houseUpgradeCostTier3Food: 100.0,  // 升到 3 级：粮
  houseUpgradeCostTier3Wood: 100.0,  // 升到 3 级：木
  houseUpgradeCostTier3Stone: 100.0, // 升到 3 级：石
  houseUpgradeCostTier3Gold: 0.0,    // 升到 3 级：金（不消耗）
  // —— 升到 4 级（3→4）：金 125、石 125、木 125、粮 125、水 125（全品类）——
  houseUpgradeCostTier4Water: 125.0, // 升到 4 级：水
  houseUpgradeCostTier4Food: 125.0,  // 升到 4 级：粮
  houseUpgradeCostTier4Wood: 125.0,  // 升到 4 级：木
  houseUpgradeCostTier4Stone: 125.0, // 升到 4 级：石
  houseUpgradeCostTier4Gold: 125.0,  // 升到 4 级：金
};
