#!/usr/bin/env bash
# Measure the pure runtime core under Node, not Bun's faster filesystem APIs.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
build=$(mktemp -d "${TMPDIR:-/tmp}/bun-deps-bench.XXXXXX")
trap 'rm -rf "$build"' EXIT
cat > "$build/entry.ts" <<EOF
export { findDependencyLocations } from "$repo/src/package-json.ts";
export { computeAnnotations } from "$repo/src/installed.ts";
export { InstalledSnapshotCache, loadInstalledSnapshot } from "$repo/src/installed-snapshot.ts";
EOF
bun build "$build/entry.ts" --target node --format cjs --outfile "$build/core.cjs" >/dev/null
cat > "$build/bench.cjs" <<'JS'
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-deps-fixture-'));
let count = {syncCalls:0,asyncCalls:0,exists:0,read:0,stat:0,lockBytes:0};
const fsPromises = require('node:fs/promises');
for (const method of Object.keys(fsPromises).filter(x => typeof fsPromises[x] === 'function')) {
  const original = fsPromises[method];
  fsPromises[method] = function(...args) { count.asyncCalls++; return original.apply(this,args); };
}
for (const method of Object.keys(fs).filter(x => x.endsWith('Sync') && typeof fs[x] === 'function')) {
  const key = {existsSync:'exists',readFileSync:'read',statSync:'stat'}[method];
  const original = fs[method];
  fs[method] = function(...args) {
    count.syncCalls++;
    if (key) count[key]++;
    const result = original.apply(this,args);
    if (method === 'readFileSync' && String(args[0]).endsWith('bun.lock')) count.lockBytes += Buffer.byteLength(result);
    return result;
  };
}
const {findDependencyLocations,computeAnnotations,loadInstalledSnapshot,InstalledSnapshotCache} = require(process.argv[2]);
function measure(fn, n=20) {
  for(let i=0;i<5;i++)fn();
  const times=[];
  count={syncCalls:0,asyncCalls:0,exists:0,read:0,stat:0,lockBytes:0};
  for(let i=0;i<n;i++){const t=performance.now();fn();times.push(performance.now()-t)}
  if (count.syncCalls !== 0 || count.asyncCalls !== 0) throw new Error(`Warm operation performs ${count.syncCalls} synchronous and ${count.asyncCalls} asynchronous filesystem calls`);
  times.sort((a,b)=>a-b);
  const calls=Object.fromEntries(Object.entries(count).map(([k,v])=>[k,v/n]));
  return {medianMs:+times[Math.floor(n/2)].toFixed(3),p95Ms:+times[Math.ceil(n*.95)-1].toFixed(3),callsPerRun:calls};
}
const results=[];
(async () => {
try {
  for(const n of [50,500,1000]) {
    const cwd=path.join(root,`installed-${n}`); fs.mkdirSync(cwd,{recursive:true});
    const dependencies=Object.fromEntries(Array.from({length:n},(_,i)=>[`dep-${i}`,'1.0.0']));
    const text=JSON.stringify({dependencies},null,2);
    for(const name of Object.keys(dependencies)) {
      const dir=path.join(cwd,'node_modules',name);fs.mkdirSync(dir,{recursive:true});
      fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,version:'1.0.0'}));
    }
    fs.writeFileSync(path.join(cwd,'bun.lock'),JSON.stringify({packages:{},workspaces:{}}));
    const locations=findDependencyLocations(text);
    const start=performance.now();
    const cache=new InstalledSnapshotCache();
    const snapshot=await cache.refresh(cwd,locations);
    const snapshotLoadMs=+(performance.now()-start).toFixed(3);
    if (!snapshot) throw new Error('Expected installed snapshot');
    const warmCachedEdit=measure(()=>{
      const parsed=findDependencyLocations(text);
      const {snapshot:current,loading}=cache.ensure(cwd,parsed);
      if (loading || !current) throw new Error('Known-name warm edit starts a disk refresh');
      return computeAnnotations(current,parsed);
    });
    results.push({snapshotLoadMs,case:`installed-${n}`,textBytes:Buffer.byteLength(text),parse:measure(()=>findDependencyLocations(text)),annotations:measure(()=>computeAnnotations(snapshot,locations)),warmEdit:measure(()=>computeAnnotations(snapshot,findDependencyLocations(text))),warmCachedEdit});
  }
  const cwd=path.join(root,'platform-skipped');fs.mkdirSync(cwd);
  const dependencies=Object.fromEntries(Array.from({length:100},(_,i)=>[`skip-${i}`,'1.0.0']));
  const packages=Object.fromEntries(Array.from({length:10000},(_,i)=>[`filler-${i}`,[`filler-${i}@1.0.0`, '',{},'x'.repeat(70)]]));
  for(const name of Object.keys(dependencies))packages[name]=[`${name}@1.0.0`];
  const lock=JSON.stringify({packages,workspaces:{}});fs.writeFileSync(path.join(cwd,'bun.lock'),lock);
  const locations=findDependencyLocations(JSON.stringify({optionalDependencies:dependencies},null,2));
  const start=performance.now();
  const snapshot=await loadInstalledSnapshot(cwd,Object.keys(dependencies));
  const snapshotLoadMs=+(performance.now()-start).toFixed(3);
  results.push({snapshotLoadMs,case:'100-missing-optionals-1MB-lock',lockBytes:Buffer.byteLength(lock),annotations:measure(()=>computeAnnotations(snapshot,locations),10)});
  console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,results},null,2));
} finally {fs.rmSync(root,{recursive:true,force:true})}
})().catch(error => {console.error(error);process.exitCode=1});
JS
node "$build/bench.cjs" "$build/core.cjs"
