import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

// ── git 分支感知：分支名 → 版本徽章后缀 + 端口偏移（多分支并行开发互不占口）──
// 端口 = 3000 + 分支名最后一个字符的数字（c2→3002、c3→3003）；
// 末位非数字（master/test/mac）或非 git 环境偏移为 0（3000）。PORT 环境变量优先。
function detectGitBranch() {
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref: refs\/heads\/(.+)$/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

const GIT_BRANCH = detectGitBranch();
const BRANCH_PORT_OFFSET = GIT_BRANCH && /\d/.test(GIT_BRANCH.slice(-1)) ? Number(GIT_BRANCH.slice(-1)) : 0;
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000 + BRANCH_PORT_OFFSET;
// master 不带后缀（与 CI 部署产物一致），其余分支徽章显示为 v1.50.44·分支名。
// 仅注入展示层，磁盘文件与 SAVE_APP_VERSION 恒为纯数字基线（存档门禁不受影响）。
const BRANCH_TAG = GIT_BRANCH && GIT_BRANCH !== 'master' ? `·${GIT_BRANCH}` : '';


const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

// ── 决策顺序持久化：决策引擎视图拖动后落盘 config.decision-order.js ──
const DECISION_ORDER_FILE = path.join(__dirname, 'js', 'config.decision-order.js');
const VALID_BRANCH_ID = /^b(?:[1-9]|1[0-8])$/;
const MAX_BODY_BYTES = 16 * 1024;

function renderDecisionOrderFile(order, levels) {
  return `// ==========================================================================
// Flow & Accord · 决策分支评估顺序持久化配置 (config.decision-order.js)
// ==========================================================================
// 本文件由 server.js 的 POST /save-decision-order 端点原子重写（决策引擎视图拖动落盘），
// 是 evaluate_needs 18 条判定分支评估顺序的「唯一真相源」（Rust 内核无策展优先级）。
// decisionEvalOrder: 18 个分支 ID（b1~b18），数组顺序即评估优先级（越靠前越优先）。
// decisionEvalLevels: 与顺序下标并行的层级覆盖，0=⓪瞬间行为 / 1-5=①..⑤马斯洛层级 / 6=保留代码动态默认。
// ==========================================================================
window.SIM_DECISION_ORDER = {
  decisionEvalOrder: [${order.map(s => `"${s}"`).join(', ')}],
  decisionEvalLevels: [${levels.join(', ')}],
};
`;
}

function handleSaveDecisionOrder(req, res) {
  let body = '';
  let tooLarge = false;
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      tooLarge = true;
      req.destroy();
    }
  });
  req.on('end', () => {
    if (tooLarge) return;
    try {
      const payload = JSON.parse(body);
      const order = payload.decisionEvalOrder;
      const levels = payload.decisionEvalLevels;
      const orderOk = Array.isArray(order) && order.length === 18
        && new Set(order).size === 18 && order.every((s) => VALID_BRANCH_ID.test(s));
      const levelsOk = Array.isArray(levels) && levels.length === 18
        && levels.every((v) => Number.isInteger(v) && v >= 0 && v <= 6);
      if (!orderOk || !levelsOk) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid decisionEvalOrder/decisionEvalLevels' }));
        return;
      }
      // 原子写：先写临时文件再 rename，防半截文件（忽略客户端任何路径，仅写固定文件）
      const tmpFile = DECISION_ORDER_FILE + '.tmp';
      fs.writeFileSync(tmpFile, renderDecisionOrderFile(order, levels), 'utf8');
      fs.renameSync(tmpFile, DECISION_ORDER_FILE);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save-decision-order') {
    handleSaveDecisionOrder(req, res);
    return;
  }
  const pathname = req.url.split('?')[0];
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
      }
    } else {
      let body = content;
      // 仅对 index.html 注入分支后缀（Buffer → string 一次性替换，其余静态资源零开销）
      if (extname === '.html' && BRANCH_TAG && path.basename(filePath) === 'index.html') {
        body = content.toString('utf8').replace(
          /(<span class="version-tag"[^>]*>v\d+\.\d+\.\d+)(<\/span>)/,
          `$1${BRANCH_TAG}$2`
        );
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(body, 'utf-8');
    }
  });
});

function startServer(port) {
  server.listen(port, () => {
    console.log(`🚀 Flow & Accord 3D Visualizer running at: http://localhost:${port}`);
    if (GIT_BRANCH) {
      console.log(`🌿 git 分支: ${GIT_BRANCH} → 端口偏移 +${BRANCH_PORT_OFFSET}${BRANCH_TAG ? `，版本徽章后缀 "${BRANCH_TAG}"` : '，徽章无后缀（master）'}`);
    }
  });
}

const MAX_PORT_RETRY = 5;
let portRetries = 0;

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    portRetries++;
    if (portRetries >= MAX_PORT_RETRY) {
      console.error(`❌ 端口 ${e.port || DEFAULT_PORT} 持续被占用——同分支服务大概率已在运行，无需再启动新实例，退出。`);
      process.exit(1);
    }
    // 只在分支自己的端口上重试，不做 +1 递增（递增会窜进其他分支的端口段）
    console.log(`⚠️ Port ${e.port || DEFAULT_PORT} is in use, retrying (${portRetries}/${MAX_PORT_RETRY})...`);
    setTimeout(() => startServer(DEFAULT_PORT), 500);
  } else {
    console.error('Server error:', e);
  }
});

startServer(DEFAULT_PORT);
