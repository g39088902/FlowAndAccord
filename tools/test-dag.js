// =========================================================================
// 🧪 族谱直系血脉上下 5 代范围与布局确定性自动化测试套件 (Flow & Accord)
//   测试目标：
//     1. buildLineageDAG 上下 5 代严格截断（向上最多 5 代祖先，向下最多 5 代后代）
//     2. 排除第 6 代及更远亲属，包含第 1~5 代完整直系
//     3. 始祖/末代/孤立节点的边界鲁棒性
//     4. 亲子有向边的闭合性（无跨界悬空边）
//     5. 反向子女索引（流产/未挂入 children 的胎儿）在 5 代内的正确探查
//     6. FlowDagLayout 确定性与无 NaN 校验
//     7. FlowDagStandalone 独立页 HTML 导出一致性
// =========================================================================

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'frontend', 'js');

// 模拟浏览器环境
globalThis.window = globalThis;
function loadJs(file) {
  const code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  (0, eval)(code);
}

loadJs('dag-layout.js');
loadJs('dag-view.js');
loadJs('dag-standalone.js');
loadJs('dag.js');

console.log('=== Flow & Accord · 族谱上下 5 代逻辑与布局自动化测试 ===\n');

let passCount = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [${totalTests}] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [${totalTests}] ${name}`);
    console.error('     ' + err.stack.split('\n').slice(0, 4).join('\n     '));
  }
}

// 辅助构建测试用 sim 对象
function createMockSim(agentList) {
  const archive = new Map();
  for (const ag of agentList) {
    archive.set(ag.id, ag);
  }
  return {
    agents: [],
    agentArchive: archive,
    selectedAgentId: null,
    selectionType: 'agent',
    getAgent: (id) => archive.get(id) || null
  };
}

// -------------------------------------------------------------------------
// 测试 1：深度截断测试（13 代连续线性世系链）
// -------------------------------------------------------------------------
runTest('单传线性链测试：以第 7 代为焦点，验证只包含上 5 代与下 5 代，排除第 6 代亲缘', () => {
  // 生成 1 ~ 13 代：1 -> 2 -> 3 -> ... -> 13
  // 焦点为 7：
  //   上 5 代祖先：6, 5, 4, 3, 2（共 5 代，第 1 代是第 6 代祖先，不应包含）
  //   下 5 代后裔：8, 9, 10, 11, 12（共 5 代，第 13 代是第 6 代后裔，不应包含）
  const agents = [];
  for (let i = 1; i <= 13; i++) {
    agents.push({
      id: i,
      fatherId: i > 1 ? (i - 1) : null,
      motherId: null,
      children: i < 13 ? [i + 1] : [],
      generation: i,
      birthTick: i * 1000,
      isAlive: true,
      age: 20
    });
  }
  const sim = createMockSim(agents);
  const dag = window.FlowDag.buildLineageDAG(7, sim);

  // 应该收录：2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 (共 11 人)
  assert.strictEqual(dag.nodes.length, 11, `应恰好收录 11 个节点，实际收录 ${dag.nodes.length}`);

  const includedIds = new Set(dag.nodes.map(n => n.id));
  assert.ok(includedIds.has(7), '必须包含焦点 7');

  // 验证祖先：2, 3, 4, 5, 6 必须在，1 不在
  for (let i = 2; i <= 6; i++) {
    assert.ok(includedIds.has(i), `必须包含第 ${7 - i} 代祖先 #${i}`);
    const node = dag.nodeMap.get(i);
    assert.strictEqual(node.isAncestor, true, `#${i} 应被标记为祖先`);
    assert.strictEqual(node.isDescendant, false, `#${i} 不应标记为后裔`);
  }
  assert.ok(!includedIds.has(1), '第 6 代祖先 #1 严禁被收录');

  // 验证后裔：8, 9, 10, 11, 12 必须在，13 不在
  for (let i = 8; i <= 12; i++) {
    assert.ok(includedIds.has(i), `必须包含第 ${i - 7} 代后代 #${i}`);
    const node = dag.nodeMap.get(i);
    assert.strictEqual(node.isDescendant, true, `#${i} 应被标记为后裔`);
    assert.strictEqual(node.isAncestor, false, `#${i} 不应标记为祖先`);
  }
  assert.ok(!includedIds.has(13), '第 6 代后代 #13 严禁被收录');
});

// -------------------------------------------------------------------------
// 测试 2：多分支子孙树深度截断（二叉后代树）
// -------------------------------------------------------------------------
runTest('多分枝后裔树测试：验证 5 代以内分支全收录，第 6 代分支全排除', () => {
  // 焦点 ID 1 (第 0 层)
  // 层 1: 2, 3 (各 2 子)
  // 层 2: 4, 5, 6, 7
  // 层 3: 8~15
  // 层 4: 16~31
  // 层 5: 32~63 (深度 = 5 代后裔)
  // 层 6: 64~127 (深度 = 6 代后裔，不应包含)
  const agents = [];
  for (let id = 1; id <= 127; id++) {
    const leftChild = id * 2;
    const rightChild = id * 2 + 1;
    const children = [];
    if (leftChild <= 127) children.push(leftChild);
    if (rightChild <= 127) children.push(rightChild);

    agents.push({
      id: id,
      fatherId: id > 1 ? Math.floor(id / 2) : null,
      motherId: null,
      children: children,
      generation: Math.floor(Math.log2(id)) + 1,
      birthTick: id * 500,
      isAlive: true
    });
  }

  const sim = createMockSim(agents);
  const dag = window.FlowDag.buildLineageDAG(1, sim);

  // 层 0 (1人) + 层 1 (2人) + 层 2 (4人) + 层 3 (8人) + 层 4 (16人) + 层 5 (32人) = 63人
  assert.strictEqual(dag.nodes.length, 63, `后代二叉树 5 代总人数应为 63，实际为 ${dag.nodes.length}`);

  const includedIds = new Set(dag.nodes.map(n => n.id));
  assert.ok(includedIds.has(63), '第 5 代后裔 #63 必须在内');
  assert.ok(!includedIds.has(64), '第 6 代后裔 #64 严禁在内');
  assert.ok(!includedIds.has(127), '第 6 代后裔 #127 严禁在内');
});

// -------------------------------------------------------------------------
// 测试 3：双亲祖先网络深度截断（二叉祖先树）
// -------------------------------------------------------------------------
runTest('双亲祖先网络测试：验证父系/母系 5 代内祖先均可探查，第 6 代均被排除', () => {
  // 焦点 ID 1000
  // 构筑层级深度：depth 0 (1000) ~ depth 6 (老祖先)
  const archive = new Map();

  function buildAncestors(childId, depth) {
    if (depth >= 6) return;
    const fId = childId * 10 + 1;
    const mId = childId * 10 + 2;

    const child = archive.get(childId) || {
      id: childId,
      fatherId: null,
      motherId: null,
      children: [],
      generation: 10 - depth,
      birthTick: (10 - depth) * 1000,
      isAlive: true
    };
    child.fatherId = fId;
    child.motherId = mId;
    archive.set(childId, child);

    archive.set(fId, {
      id: fId,
      fatherId: null,
      motherId: null,
      children: [childId],
      gender: 'male',
      generation: 9 - depth,
      birthTick: (9 - depth) * 1000,
      isAlive: false
    });
    archive.set(mId, {
      id: mId,
      fatherId: null,
      motherId: null,
      children: [childId],
      gender: 'female',
      generation: 9 - depth,
      birthTick: (9 - depth) * 1000,
      isAlive: false
    });

    buildAncestors(fId, depth + 1);
    buildAncestors(mId, depth + 1);
  }

  archive.set(1000, {
    id: 1000,
    fatherId: null,
    motherId: null,
    children: [],
    generation: 10,
    birthTick: 10000,
    isAlive: true
  });

  buildAncestors(1000, 0);

  const sim = {
    agents: [],
    agentArchive: archive,
    selectedAgentId: 1000,
    selectionType: 'agent',
    getAgent: (id) => archive.get(id) || null
  };

  const dag = window.FlowDag.buildLineageDAG(1000, sim);
  // 深度 0: 1 人
  // 深度 1: 2 人 (501, 502)
  // 深度 2: 4 人
  // 深度 3: 8 人
  // 深度 4: 16 人
  // 深度 5: 32 人
  // 总节点数 = 1 + 2 + 4 + 8 + 16 + 32 = 63 人
  assert.strictEqual(dag.nodes.length, 63, `5 代全双亲祖先树应为 63 人，实际 ${dag.nodes.length}`);

  // 深度 6 的祖先节点数量为 64，均不应出现在 dag.nodeMap 中
  for (const [id, node] of archive) {
    if (dag.nodeMap.has(id)) {
      assert.ok(dag.nodeMap.get(id).generation >= 5, `入选祖先辈分不应低于第 5 代 (原generation >= 5)`);
    }
  }
});

// -------------------------------------------------------------------------
// 测试 4：边界情况（始祖代、末代、孤儿、不存在的 ID）
// -------------------------------------------------------------------------
runTest('边界容错测试：始祖/末代/孤儿/默认焦点回退平滑无报错', () => {
  const agents = [
    { id: 1, fatherId: null, motherId: null, children: [], birthTick: 0, isAlive: true },
    { id: 2, fatherId: 1, motherId: null, children: [], birthTick: 1000, isAlive: true }
  ];
  agents[0].children = [2];
  const sim = createMockSim(agents);

  // 1. 始祖作为焦点
  const dag1 = window.FlowDag.buildLineageDAG(1, sim);
  assert.strictEqual(dag1.nodes.length, 2);
  assert.strictEqual(dag1.nodeMap.get(1).isAncestor, false);
  assert.strictEqual(dag1.nodeMap.get(2).isDescendant, true);

  // 2. 末代作为焦点
  const dag2 = window.FlowDag.buildLineageDAG(2, sim);
  assert.strictEqual(dag2.nodes.length, 2);
  assert.strictEqual(dag2.nodeMap.get(1).isAncestor, true);
  assert.strictEqual(dag2.nodeMap.get(2).isDescendant, false);

  // 3. 焦点不存在时自动回退为存活且编号最小者
  const dag3 = window.FlowDag.buildLineageDAG(999, sim);
  assert.strictEqual(dag3.focusId, 1, '无效 focusId 应平滑回退');

  // 4. 完全空世界
  const emptySim = createMockSim([]);
  const dagEmpty = window.FlowDag.buildLineageDAG(1, emptySim);
  assert.strictEqual(dagEmpty.nodes.length, 0, '空世界应返回 0 节点');
  assert.strictEqual(dagEmpty.edges.length, 0, '空世界应返回 0 边');
});

// -------------------------------------------------------------------------
// 测试 5：有向边与连通性完整性校验
// -------------------------------------------------------------------------
runTest('有向边闭合性测试：严禁出现跨越 5 代边界指向外部节点的悬空边', () => {
  // 构建 7 代线性
  const agents = [];
  for (let i = 1; i <= 7; i++) {
    agents.push({
      id: i,
      fatherId: i > 1 ? (i - 1) : null,
      motherId: null,
      children: i < 7 ? [i + 1] : [],
      generation: i,
      birthTick: i * 1000,
      isAlive: true
    });
  }
  const sim = createMockSim(agents);
  // 焦点为 1，收录 1, 2, 3, 4, 5, 6 (1 + 下5代)
  const dag = window.FlowDag.buildLineageDAG(1, sim);
  const nodeIds = new Set(dag.nodes.map(n => n.id));

  assert.strictEqual(dag.edges.length, 5, '6 个节点应该产生 5 条亲子边');
  for (const e of dag.edges) {
    assert.ok(nodeIds.has(e.parent.id), `边起点 #${e.parent.id} 必须在节点集合中`);
    assert.ok(nodeIds.has(e.child.id), `边终点 #${e.child.id} 必须在节点集合中`);
  }
});

// -------------------------------------------------------------------------
// 测试 6：反查子女索引（流产/未挂入 children 的胎儿）在 5 代内的支持
// -------------------------------------------------------------------------
runTest('反查子女索引测试：流产或清理后的子代能被反查并遵守 5 代限制', () => {
  const agents = [];
  for (let i = 1; i <= 8; i++) {
    agents.push({
      id: i,
      fatherId: i > 1 ? (i - 1) : null,
      motherId: null,
      children: [], // children 故意置空
      generation: i,
      birthTick: i * 1000,
      isAlive: i !== 3,
      deathCause: i === 3 ? '流产' : null
    });
  }
  const sim = createMockSim(agents);
  const dag = window.FlowDag.buildLineageDAG(1, sim);

  const includedIds = new Set(dag.nodes.map(n => n.id));
  assert.ok(includedIds.has(3), '死因为流产的 #3 必须被反查发现');
  assert.ok(includedIds.has(6), '第 5 代后裔 #6 必须被收录');
  assert.ok(!includedIds.has(7), '第 6 代后裔 #7 必须被截断排除');
});

// -------------------------------------------------------------------------
// 测试 7：FlowDagLayout 确定性与无 NaN 校验
// -------------------------------------------------------------------------
runTest('布局确定性与坐标有效性测试：验证无 NaN/Infinity，且多次运算逐像素确定', () => {
  const agents = [];
  for (let i = 1; i <= 10; i++) {
    agents.push({
      id: i,
      fatherId: i > 1 ? Math.floor(i / 2) : null,
      motherId: null,
      children: [],
      generation: Math.floor(Math.log2(i)) + 1,
      birthTick: i * 14400,
      isAlive: true,
      age: 30
    });
  }
  for (let i = 1; i <= 10; i++) {
    const p = agents[i - 1].fatherId;
    if (p) agents[p - 1].children.push(i);
  }

  const sim = createMockSim(agents);
  const dag1 = window.FlowDag.buildLineageDAG(1, sim);

  assert.ok(Number.isFinite(dag1.width) && dag1.width > 0, 'width 必须是有限正数');
  assert.ok(Number.isFinite(dag1.height) && dag1.height > 0, 'height 必须是有限正数');

  for (const n of dag1.nodes) {
    assert.ok(Number.isFinite(n.x), `节点 #${n.id} x 坐标不能为 NaN/Infinity`);
    assert.ok(Number.isFinite(n.y), `节点 #${n.id} y 坐标不能为 NaN/Infinity`);
  }

  // 二次布局对比
  const dag2 = window.FlowDag.buildLineageDAG(1, sim);
  assert.strictEqual(dag1.nodes.length, dag2.nodes.length);
  for (let i = 0; i < dag1.nodes.length; i++) {
    const n1 = dag1.nodes[i];
    const n2 = dag2.nodes[i];
    assert.strictEqual(n1.id, n2.id);
    assert.strictEqual(n1.x, n2.x, `节点 #${n1.id} x 坐标两次计算必须完全一致`);
    assert.strictEqual(n1.y, n2.y, `节点 #${n1.id} y 坐标两次计算必须完全一致`);
    assert.strictEqual(n1.col, n2.col, `节点 #${n1.id} col 两次计算必须完全一致`);
  }
});

// -------------------------------------------------------------------------
// 测试 8：FlowDagStandalone 独立页 HTML 导出
// -------------------------------------------------------------------------
runTest('独立页 HTML 生成测试：验证内嵌数据与 buildLineageDAG 严格一致', () => {
  const agents = [
    { id: 1, fatherId: null, motherId: null, children: [2], birthTick: 0, isAlive: true },
    { id: 2, fatherId: 1, motherId: null, children: [], birthTick: 14400, isAlive: true }
  ];
  const sim = createMockSim(agents);
  const html = window.FlowDagStandalone.generateStandaloneDagHtml(1, sim);

  assert.ok(typeof html === 'string' && html.length > 500, 'HTML 应为非空长文本');
  assert.ok(html.includes('Flow & Accord · 直系血脉时间轴族谱'), '应包含正确标题');
  assert.ok(html.includes('"focusId":1'), '应序列化 focusId');
  assert.ok(html.includes('"nodes":['), '应包含 nodes 数组');
});

console.log(`\n========================================`);
console.log(`测试完成：${passCount} / ${totalTests} 全部通过！`);
console.log(`========================================\n`);

if (passCount !== totalTests) {
  process.exit(1);
}
