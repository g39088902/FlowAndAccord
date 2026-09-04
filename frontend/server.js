import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

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
// decisionEvalLevels: 与顺序下标并行的层级覆盖，0=保留代码动态默认，1-5=强制马斯洛层级。
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
        && levels.every((v) => Number.isInteger(v) && v >= 0 && v <= 5);
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
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
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
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;

function startServer(port) {
  server.listen(port, () => {
    console.log(`🚀 Flow & Accord 3D Visualizer running at: http://localhost:${port}`);
  });
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    const nextPort = server.address() ? server.address().port + 1 : (parseInt(process.env.PORT, 10) || 3000) + 1;
    console.log(`⚠️ Port ${e.port || 3000} is in use, trying port ${nextPort}...`);
    setTimeout(() => startServer(nextPort), 200);
  } else {
    console.error('Server error:', e);
  }
});

startServer(DEFAULT_PORT);
