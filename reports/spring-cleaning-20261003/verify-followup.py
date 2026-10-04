from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import zipfile

root = Path('reports/spring-cleaning-20261003')
checks = [
    ('frozen-install', 'bun install --frozen-lockfile'),
    ('typecheck', 'bun run typecheck'),
    ('lint', 'bun run lint'),
    ('unit-tests', 'bun test'),
    ('extension-lifecycle', 'bun run test:extension'),
    ('node-benchmark', 'bash reports/spring-cleaning-20261003/benchmark.sh > reports/spring-cleaning-20261003/after-review-fixes.json'),
    ('package', 'bun run package'),
    ('production-audit', 'bun audit --production'),
    ('diff-check', 'git diff --check'),
]
results = {
    'startedAt': datetime.now(timezone.utc).isoformat(),
    'scope': 'After all five approved Opus fixes; executed by parent, not independent reviewers',
    'checks': [],
}
for key, command in checks:
    result = subprocess.run(command, shell=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log = root / f'followup-{key}.log'
    log.write_text(result.stdout)
    results['checks'].append({'id': key, 'command': command, 'exitCode': result.returncode, 'log': str(log)})
    (root / 'followup-verification.json').write_text(json.dumps(results, indent=2) + '\n')
    print(f'{key}: {"PASS" if result.returncode == 0 else "FAIL"}', flush=True)
    if key in ('unit-tests', 'package', 'production-audit') or result.returncode:
        print('\n'.join(result.stdout.splitlines()[-12:]), flush=True)
    if result.returncode:
        sys.exit(result.returncode)

benchmark = json.loads((root / 'after-review-fixes.json').read_text())
large = next(r for r in benchmark['results'] if r['case'] == 'installed-1000')
assert large['parse']['medianMs'] <= 5, '1000-entry parser exceeds approved warmed median goal'
for case in benchmark['results']:
    for key in ('parse', 'annotations', 'warmEdit', 'warmCachedEdit'):
        if key in case:
            assert case[key]['callsPerRun']['syncCalls'] == 0 and case[key]['callsPerRun']['asyncCalls'] == 0
print('Node benchmark:', json.dumps({'parser1000MedianMs': large['parse']['medianMs'], 'warmCachedEdit1000MedianMs': large['warmCachedEdit']['medianMs']}))

vsix = Path('bun-deps-0.4.0.vsix')
with zipfile.ZipFile(vsix) as archive:
    names = archive.namelist()
    assert len(names) == 9, names
    for expected in ('extension/dist/extension.js', 'extension/dist/extension.js.map', 'extension/media/icon.png'):
        assert expected in names, expected
    for name in names:
        assert not any(name.startswith('extension/' + prefix) for prefix in ('fixtures/', '.github/', 'reports/', 'plans.', 'src/', 'test/', 'node_modules/')), name
    assert b'sourceMappingURL=extension.js.map' in archive.read('extension/dist/extension.js')
print('VSIX content check: PASS, 9 files,', vsix.stat().st_size, 'bytes')
results['checks'].append({'id': 'package-content', 'exitCode': 0, 'files': 9, 'bytes': vsix.stat().st_size, 'archive': str(vsix), 'linkedSourceMap': True, 'developmentArtifactsExcluded': True})
results['finishedAt'] = datetime.now(timezone.utc).isoformat()
results['benchmark'] = {'path': str(root / 'after-review-fixes.json'), 'parser1000MedianMs': large['parse']['medianMs'], 'warmCachedEdit1000MedianMs': large['warmCachedEdit']['medianMs'], 'zeroSyncAndAsyncIO': True}
(root / 'followup-verification.json').write_text(json.dumps(results, indent=2) + '\n')
