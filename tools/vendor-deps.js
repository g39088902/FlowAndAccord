// Dependency-graph BFS vendor resolver: 从根依赖出发，用 crates.io API 自动发现并下载全部依赖
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = process.argv[2] || process.cwd();
const VENDOR = path.join(ROOT, '.vendor');
const UA = { 'User-Agent': 'rust-vendor-bootstrap/0.1 (node)' };

// 根依赖 (sim_core / sim_wasm 的 Cargo.toml)
const ROOTS = [
  ['petgraph', '^0.6'],
  ['serde', '^1.0'],
  ['serde_json', '^1.0'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url, retries) {
  retries = retries || 0;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: UA }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location));
      }
      if (res.statusCode === 429 || res.statusCode === 403 || res.statusCode === 503) {
        res.resume();
        console.log('rate-limited ' + res.statusCode + ' for ' + url + ' (retry ' + retries + ')');
        return setTimeout(() => resolve(get(url, retries + 1)), 4000 + retries * 3000);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(30000, () => {
      console.log('timeout for ' + url + ' (retry ' + retries + ')');
      req.destroy();
      if (retries < 3) setTimeout(() => resolve(get(url, retries + 1)), 2000);
      else reject(new Error('timeout ' + url));
    });
    req.on('error', (e) => {
      if (retries < 3) { console.log('error ' + e.message + ' for ' + url + ' (retry ' + retries + ')'); setTimeout(() => resolve(get(url, retries + 1)), 2000); }
      else reject(e);
    });
  });
}

// 限流友好: 串行 API 调用之间加小间隔
const apiQueue = [];
let apiBusy = false;
async function apiGet(url) {
  if (!apiBusy) { apiBusy = true; return apiGetInner(url); }
  return new Promise((resolve, reject) => apiQueue.push({ url, resolve, reject }));
}
async function apiGetInner(url) {
  try {
    const res = await get(url);
    return res;
  } finally {
    await sleep(1200); // 限流缓冲
    const next = apiQueue.shift();
    if (next) apiGetInner(next.url).then(next.resolve).catch(next.reject);
    else apiBusy = false;
  }
}

function cmpVers(a, b) {
  const pa = a.split('.').map(n => parseInt(n, 10));
  const pb = b.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function parseReq(req) {
  req = (req || '*').trim();
  if (req === '*' || req === '') return null; // any
  let op = '^';
  let rest = req;
  if (req[0] === '^' || req[0] === '=' || req[0] === '~' || req[0] === '>') {
    op = req[0];
    rest = req.slice(1).trim();
    if (op === '>' && rest[0] === '=') { op = '>='; rest = rest.slice(1).trim(); }
  }
  const parts = rest.split('.').map(n => parseInt(n, 10));
  return { op, parts };
}

function matches(req, vers) {
  const spec = parseReq(req);
  if (!spec) return true;
  const vp = vers.split('.').map(n => parseInt(n, 10));
  const at = (arr, i) => (i < arr.length ? arr[i] : 0);
  const minParts = spec.parts;
  switch (spec.op) {
    case '=': return cmpVers(vers, minParts.join('.')) === 0;
    case '>=': return cmpVers(vers, minParts.join('.')) >= 0;
    case '~': {
      if (vp[0] !== at(minParts, 0)) return false;
      if (minParts.length >= 2 && vp[1] !== at(minParts, 1)) return false;
      return cmpVers(vers, minParts.join('.')) >= 0;
    }
    default: { // ^
      if (minParts[0] > 0) {
        if (vp[0] !== minParts[0]) return false;
        return cmpVers(vers, minParts.join('.')) >= 0;
      } else {
        // ^0.Y: >= 0.Y, < 0.(Y+1)
        if (vp[0] !== 0) return false;
        if (minParts.length >= 2) {
          if (vp[1] !== minParts[1]) return false;
          return cmpVers(vers, minParts.join('.')) >= 0;
        }
        return true;
      }
    }
  }
}

async function pickVersion(name, req) {
  const buf = await apiGet('https://crates.io/api/v1/crates/' + name);
  const j = JSON.parse(buf.toString('utf8'));
  const maxStable = j.crate && j.crate.max_stable_version;
  if (maxStable && matches(req, maxStable)) return maxStable;
  let best = null;
  for (const v of j.versions || []) {
    if (v.yanked) continue;
    if (matches(req, v.num) && (!best || cmpVers(v.num, best) > 0)) best = v.num;
  }
  return best;
}

async function getDeps(name, vers) {
  const buf = await apiGet('https://crates.io/api/v1/crates/' + name + '/' + vers + '/dependencies');
  const j = JSON.parse(buf.toString('utf8'));
  return (j.dependencies || []).filter(d => d.kind === 'normal');
}

async function vendorCrate(name, vers) {
  const dir = path.join(VENDOR, name + '-' + vers);
  const crateFile = path.join(VENDOR, name + '-' + vers + '.crate');
  if (!fs.existsSync(crateFile)) {
    const url = 'https://static.crates.io/crates/' + name + '/' + name + '-' + vers + '.crate';
    console.log('downloading', name + '-' + vers);
    fs.writeFileSync(crateFile, await get(url));
  }
  const cksum = crypto.createHash('sha256').update(fs.readFileSync(crateFile)).digest('hex');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    execSync('tar -xzf "' + crateFile + '" -C "' + dir + '" --strip-components=1', { stdio: 'inherit' });
  }
  fs.writeFileSync(path.join(dir, '.cargo-checksum.json'),
    JSON.stringify({ files: {}, package: cksum }, null, 2));
  console.log('vendored', name + '-' + vers, cksum.slice(0, 12));
}

(async () => {
  fs.mkdirSync(VENDOR, { recursive: true });
  const chosen = new Map(); // name -> Set(version)
  const queue = ROOTS.map(([n, r]) => ({ name: n, req: r }));
  while (queue.length > 0) {
    const { name, req } = queue.shift();
    if (!chosen.has(name)) chosen.set(name, new Set());
    const vers = await pickVersion(name, req);
    if (!vers) throw new Error('no version for ' + name + ' req ' + req);
    if (chosen.get(name).has(vers)) continue;
    chosen.get(name).add(vers);
    const deps = await getDeps(name, vers);
    for (const d of deps) {
      queue.push({ name: d.crate_id, req: d.req });
    }
  }
  // vendor everything
  for (const [name, versSet] of chosen) {
    for (const vers of versSet) {
      await vendorCrate(name, vers);
    }
  }
  console.log('VENDOR_DONE');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
