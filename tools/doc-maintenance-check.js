#!/usr/bin/env node
/* Flow & Accord · 文档维护体检器（零依赖、只读） */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'docs', 'doc-maintenance.json');
const DAY = 86400000;
function die(s) { console.error('doc-maintenance-check: ' + s); process.exit(2); }
function rel(p) { return path.relative(ROOT, p).split(path.sep).join('/'); }
function allFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  let out = [];
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    if (['.git','node_modules','target'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    out = out.concat(e.isDirectory() ? allFiles(p) : [p]);
  }
  return out;
}
const FILES = allFiles(ROOT);
function globRegex(pattern) {
  const s = pattern.split(path.sep).join('/'); let out = '^';
  for (let i=0;i<s.length;i++) {
    const c=s[i];
    if (c==='*') { if (s[i+1]==='*') { if (s[i+2]==='/') { out+='(?:.*/)?'; i+=2; } else { out+='.*'; i++; } } else out+='[^/]*'; }
    else if (c==='?') out+='[^/]';
    else out += /[.+^$(){}|[\]\\]/.test(c) ? '\\'+c : c;
  }
  return new RegExp(out+'$');
}
function expand(pattern) { const re=globRegex(pattern); return FILES.filter(p=>re.test(rel(p))); }
function mtime(p) { try { return fs.statSync(p).mtimeMs; } catch (_) { return 0; } }
function dateMs(s) { const t=Date.parse((s||'')+'T00:00:00Z'); return Number.isFinite(t)?t:0; }
function ageDays(t, now) { return t ? Math.max(0,(now-t)/DAY) : Infinity; }
let manifest;
try { manifest=JSON.parse(fs.readFileSync(MANIFEST,'utf8')); } catch(e) { die('无法读取清单: '+e.message); }
if (!Array.isArray(manifest.docs)) die('清单缺少 docs 数组');
const now=Date.now(), interval=Number(manifest.reviewIntervalDays||90), ignored=new Set(manifest.ignoreDocs||[]), registered=new Set(), results=[];
for (const item of manifest.docs) {
  const docPath=path.join(ROOT,item.path); registered.add(item.path);
  const patterns=Array.isArray(item.sources)?item.sources:[], sources=[], missing=[];
  for (const pat of patterns) { const hit=expand(pat); if (!hit.length) missing.push(pat); else sources.push(...hit); }
  const unique=[...new Set(sources)], newest=unique.reduce((n,p)=>Math.max(n,mtime(p)),0), docTime=mtime(docPath), review=dateMs(item.lastReviewed), status=[];
  if (!fs.existsSync(docPath)) status.push('MISSING_DOC');
  if (missing.length) status.push('MISSING_SOURCE');
  if (docTime && newest>docTime+1000) status.push('NEEDS_REVIEW');
  if (!review || ageDays(review,now)>Number(item.reviewIntervalDays||interval)) status.push('OVERDUE');
  if (!status.length) status.push('OK');
  results.push({id:item.id,path:item.path,owner:item.owner||'—',status,lastReviewed:item.lastReviewed||null,reviewAgeDays:review?Math.floor(ageDays(review,now)):null,sourceCount:unique.length,missingPatterns:missing,docMtime:docTime?new Date(docTime).toISOString():null,newestSourceMtime:newest?new Date(newest).toISOString():null});
}
for (const p of FILES.filter(p=>rel(p).startsWith('docs/current/')&&p.endsWith('.md'))) { const rp=rel(p); if(!registered.has(rp)&&!ignored.has(rp)) results.push({id:null,path:rp,owner:'—',status:['UNTRACKED_DOC'],lastReviewed:null,reviewAgeDays:null,sourceCount:0,missingPatterns:[]}); }
const counts={}; for(const r of results) for(const s of r.status) counts[s]=(counts[s]||0)+1;
const payload={schemaVersion:manifest.schemaVersion||1,checkedAt:new Date(now).toISOString(),reviewIntervalDays:interval,counts,results};
if (process.argv.includes('--json')) console.log(JSON.stringify(payload,null,2));
else { console.log('=== Flow & Accord · 文档维护体检 ==='); console.log(`复核周期: ${interval} 天 · 检查文档: ${results.length} 篇 · 时间: ${payload.checkedAt}`); for(const r of results) { const ok=r.status.includes('OK'); console.log(`${ok?'✓':'⚠'} ${r.status.join(', ').padEnd(30)} ${r.path} [${r.owner}]`); if(r.status.includes('NEEDS_REVIEW')) console.log(`    源码最新: ${r.newestSourceMtime} > 文档: ${r.docMtime}`); if(r.status.includes('OVERDUE')) console.log(`    最近复核: ${r.lastReviewed||'未填写'} (${r.reviewAgeDays==null?'未知':r.reviewAgeDays+'天前'})`); if(r.missingPatterns.length) console.log(`    未匹配来源: ${r.missingPatterns.join(', ')}`); } console.log('\n汇总: '+Object.entries(counts).map(([k,v])=>`${k}=${v}`).join(' · ')); }
if (process.argv.includes('--strict') && results.some(r=>r.status.some(s=>s!=='OK'))) process.exitCode=1;
