// Rust toolchain downloader using Node's OpenSSL TLS (Windows schannel is broken on this machine)
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.argv[2] || process.cwd();
const CACHE = path.join(ROOT, '.rust-dist', 'cache');
const CHANNEL = 'https://static.rust-lang.org/dist/channel-rust-stable.toml';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 1000000) {
    console.log('cached', path.basename(file));
    return file;
  }
  console.log('downloading', path.basename(url));
  const buf = await get(url);
  fs.writeFileSync(file, buf);
  return file;
}

(async () => {
  fs.mkdirSync(CACHE, { recursive: true });
  const toml = (await get(CHANNEL)).toString('utf8');
  const wanted = [
    ['rustc', 'x86_64-pc-windows-msvc'],
    ['cargo', 'x86_64-pc-windows-msvc'],
    ['rust-std', 'x86_64-pc-windows-msvc'],
    ['rust-std', 'wasm32-unknown-unknown'],
  ];
  const results = [];
  for (const [pkg, target] of wanted) {
    const header = '[pkg.' + pkg + '.target.' + target + ']';
    const idx = toml.indexOf(header);
    if (idx < 0) throw new Error('section not found: ' + header);
    const next = toml.indexOf('\n[', idx + 10);
    const sec = toml.slice(idx, next >= 0 ? next : undefined);
    const urlM = sec.match(/^url\s*=\s*"([^"]+)"/m);
    const hashM = sec.match(/^hash\s*=\s*"([^"]+)"/m);
    if (!urlM) throw new Error('no url in ' + header);
    const url = urlM[1];
    const file = path.join(CACHE, path.basename(url));
    await download(url, file);
    if (hashM) {
      const want = hashM[1].replace(/^sha256:/, '');
      const got = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      if (got !== want) throw new Error('hash mismatch for ' + file);
      console.log('verified', path.basename(file));
    }
    results.push(file);
  }
  console.log('ALL_DONE');
  console.log(results.join('\n'));
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
