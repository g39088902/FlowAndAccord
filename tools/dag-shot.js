// =========================================================================
// 📷 族谱无头截图验证工具 (Flow & Accord · 开发期工具)
//  在 Node 中 eval 加载 frontend/js/dag-* 四个模块到 globalThis，
//  调用生产路径 FlowDag.generateStandaloneDagHtml 生成完整 HTML 字符串，
//  注入固定视角脚本后落盘成静态页面，再用系统 Chrome headless 多档位截图。
//
//  用法: node tools/dag-shot.js [--foci=2,311] [--modes=fit,focus,detail,top,bottom]
//                               [--size=1600x1000] [--out=/tmp/dag-lab/shots]
//  数据: 需先运行 node tools/gen-dag-testdata.js --ticks=500000 --out=/tmp/dag-lab
// =========================================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const os = require('os');

function arg(name, def) {
  const hit = process.argv.slice(2).find(a => a.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : def;
}
const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'frontend', 'js');
const DATA_DIR = arg('data', '/tmp/dag-lab');
const OUT_DIR = arg('out', path.join(DATA_DIR, 'shots'));
// 焦点必须是数字 id：buildLineageDAG 用 lookup.has(id) 判定，字符串键会命中不了而回退到默认焦点
const FOCI = arg('foci', '2,311').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
const MODES = arg('modes', 'fit,focus,detail,top,bottom').split(',').map(s => s.trim()).filter(Boolean);
const SIZE = arg('size', '1600x1000');
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

if (!fs.existsSync(path.join(DATA_DIR, 'archive.json'))) {
  throw new Error('未找到测试数据 ' + DATA_DIR + '/archive.json，请先运行 tools/gen-dag-testdata.js');
}
if (!fs.existsSync(CHROME)) throw new Error('未找到 Chrome: ' + CHROME);
fs.mkdirSync(OUT_DIR, { recursive: true });
const PAGE_DIR = path.join(DATA_DIR, 'shot-pages');
fs.mkdirSync(PAGE_DIR, { recursive: true });

// ---------------------------------------------------------------- 加载生产脚本到 globalThis
// dag.js / dag-standalone.js 用 (function(w){})(w) 闭包取 window；
// Node 没有 window，把 globalThis 暴露成 window 即可让 IIFE 正常工作。
globalThis.window = globalThis;
function loadJs(file) {
  const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  (0, eval)(src);
}
loadJs('dag-layout.js');
loadJs('dag-view.js');
loadJs('dag-standalone.js');
loadJs('dag.js');

// ---------------------------------------------------------------- 真实测试数据
const archiveList = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'archive.json'), 'utf8'));
const archiveMap = new Map(archiveList.map(a => [a.id, a]));
function fakeSim(focusId) {
  return {
    agents: [],
    agentArchive: archiveMap,
    selectedAgentId: focusId,
    selectionType: 'agent',
    getAgent: () => null
  };
}

// ---------------------------------------------------------------- 视角脚本 (独立 <script>，位于 standalone </body> 之后)
// 与 dag.js/standalone 内产生严格同源：__dag 由 standalone 自己的 bootstrap 设置。
function buildViewJs(mode, scaleArg) {
  return [
    '<script>',
    '(function(){',
    '  var d = window.__dag.dag, v = window.__dag.view;',
    '  var ws = document.getElementById("workspace");',
    '  var cw = ws.clientWidth, ch = ws.clientHeight;',
    '  function setView(s, gx, gy){ v.setTransform(s, (cw + 74) / 2 - gx * s, ch / 2 - gy * s); v.refresh(); }',
      '  var f = d.nodes.filter(function(n){ return n.id === d.focusId; })[0] || d.nodes[0];',
    (mode === 'fit'      ? '  v.fitAll(); v.refresh();' :
     mode === 'focus'    ? '  setView(' + (scaleArg || 0.8) + ', f.x + 92, f.y + 40);' :
     mode === 'detail'   ? '  setView(' + (scaleArg || 1.0) + ', f.x + 92, f.y + 40);' :
     mode === 'top'      ? '  setView(' + (scaleArg || 0.8) + ', d.width / 2, 180);' :
     mode === 'bottom'   ? '  setView(' + (scaleArg || 0.8) + ', d.width / 2, d.height - 220);' :
                           '  v.fitAll(); v.refresh();'),
    '})();',
    '</' + 'script>'
  ].join('\n');
}

// ---------------------------------------------------------------- 生成静态截图页面
for (const focus of FOCI) {
  const sim = fakeSim(focus);
  const html = globalThis.FlowDag.generateStandaloneDagHtml(focus, sim);
  // 注入 __dag.focusId 已知值供 viewJs 使用：focusId 来自 ser.focusId
  const baseId = path.join(PAGE_DIR, 'f' + focus);
  fs.mkdirSync(baseId, { recursive: true });
  for (const mode of MODES) {
    const viewJs = buildViewJs(mode, null);
    // viewJs 是独立 <script>，插在 </body> 之后作兄弟节点 → 不会被原 script 误截断
    const out = html.replace('</body>', '</body>' + viewJs);
    fs.writeFileSync(path.join(baseId, mode + '.html'), out);
  }
}

// ---------------------------------------------------------------- Chrome headless 截图
function shootChrome(outFile, url, profileDir) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--force-device-scale-factor=1', '--window-size=' + SIZE,
        '--user-data-dir=' + profileDir,
        '--virtual-time-budget=8000',
        '--screenshot=' + outFile, url
      ], { detached: true, stdio: 'ignore' });
    } catch (e) { resolve(false); return; }
    const t0 = Date.now();
    let lastSize = -1, stableCount = 0;
    const iv = setInterval(() => {
      let size = 0;
      try { size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0; } catch (_) {}
      if (size > 1000 && size === lastSize) {
        if (++stableCount >= 3) { clearInterval(iv); finish(size > 1000); }
      } else { stableCount = 0; lastSize = size; }
      if (Date.now() - t0 > 45000) { clearInterval(iv); finish(size > 1000); }
    }, 200);
    function finish(ok) {
      try { if (proc && proc.pid) process.kill(-proc.pid, 'SIGKILL'); } catch (_) {}
      resolve(ok);
    }
  });
}

// ---------------------------------------------------------------- 静态服务
const MIME = { '.html': 'text/html; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(PAGE_DIR, url);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dag-chrome-'));
  let okCount = 0, total = 0;
  for (const focus of FOCI) {
    for (const mode of MODES) {
      total++;
      const out = path.join(OUT_DIR, 'f' + focus + '-' + mode + '.png');
      try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch (_) {}
      const url = base + '/f' + focus + '/' + mode + '.html';
      const ok = await shootChrome(out, url, profileDir);
      if (ok) okCount++;
      const kb = ok ? (Math.round(fs.statSync(out).size / 1024) + 'KB') : 'FAILED';
      console.log('  ' + (ok ? '✅' : '❌') + ' focus#' + focus + ' · ' + mode + ' → ' + path.basename(out) + ' (' + kb + ')');
    }
  }
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
  server.close();
  console.log('\n  📷 ' + okCount + '/' + total + ' 张截图 → ' + OUT_DIR);
})();