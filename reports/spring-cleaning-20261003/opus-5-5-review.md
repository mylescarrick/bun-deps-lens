No blockers: the approved snapshot and parser work is correct and stays in scope. I found three new P2 issues and one test that can pass without checking what it claims to.

# Review: spring-cleaning snapshot + parser slices (working tree vs `d1401a4`)

## Actionable findings (all new in this diff, none blocking)

**1 → P2: Lockfile, config and workspace-folder invalidation blanks every decoration, including cached registry colours, until the async reload finishes.**
- **Where:** `src/extension.ts:178-186`, `:106-110` and `:284-287`.
- **Proof:** `invalidateInstalled()` clears every snapshot, then calls `scheduleRender`. 200 ms later `renderEditor` finds no snapshot and calls `decorator.clear(editor)`, which empties all four buckets (`decorations.ts:81-85`). So every `bun install` (one or more lockfile writes) blanks all visible package.json editors. The gap is 200 ms plus the cold load, which ranged from 24 to 252 ms in the recorded samples. Any edit during the reload blanks again.
- **Config changes:** any `bunDeps.*` setting change also calls `installedSnapshots.clear()` (`:108`), though no setting affects installed data.
- **Baseline:** rendering was synchronous, so decorations never disappeared.
- **Smallest fix:** when the snapshot is missing, render with an empty snapshot instead of clearing: `computeAnnotations(snapshot ?? { installed: new Map() }, locations)`. Registry colours stay, local hints stay unknown, and nothing turns green that shouldn't. Also drop the `clear()` at `:108`.
- **Test needed:** in `test/extension-lifecycle.sh`, right after `events.lockDelete(); flush(200)`, assert the `charts.green`/amber buckets are not empty. The current `waitFor(pending)` goes through the blank state and can't catch this.

**2 → P2: Catalog navigation now reads and fully re-parses the lockfile on every definition request.**
- **Where:** `src/catalog-definition-provider.ts:35`.
- **Proof:** `loadLockfileIndex(dirname(sourceFsPath))` is called with no `previous`, and the global mtime cache was deleted (`bun/lockfile.ts` diff). VS Code calls definition providers on Cmd/Ctrl-hover as well as F12, and `revealCatalogDefinition` uses the same path. Each request on a `catalog:` value now runs `JSON.parse(stripTrailingCommas(...))` over the whole lockfile (1.15 MB in the benchmark) just to get `.root`. Baseline paid one `statSync` per call.
- **Fix:** look up only the lockfile path: `const lock = await findLockfile(dir); if (lock === null || lock.endsWith(".lockb")) return; root = dirname(lock)`. This keeps the old `.lockb` behaviour.
- **Test gap:** the lifecycle test calls `provideDefinition` at `Position(2, 14)`, which is not a catalog reference. This path is never exercised.

**3 → P2: Adding a name reloads every manifest, and names are never pruned.**
- **Where:** `src/installed-snapshot.ts:92` and `:108-126`.
- **Proof:** `entry.names` only grows. Renaming a key one character at a time (`react` → `preact`) adds every intermediate name. Each missing name sends `renderEditor` (`extension.ts:278-283`) into `refresh`, and `load()` re-reads all names, not just the new one. In a 1,000-dependency manifest, one new name costs 1,000+ async reads, plus a parent-directory walk for each missing name.
- **Ongoing cost:** junk names are re-read on every save and every 30 s revalidation until close or invalidation.
- **Impact:** typing never blocks, so the zero-sync claim holds. But it is unnecessary repeated work against the optimisation goal.
- **Fix:** have `refresh` replace `entry.names` with the current document's names (one package.json per directory). When a snapshot already exists, load only the missing names and merge into a new Map. The full reload stays on Refresh, save and the 30 s revalidation.
- **Test needed:** a unit test that a rename sequence leaves `names` equal to the final set, and that a single new name triggers only one manifest read (count with a `readFile` spy).

**4 → P2, test vacuity: "a new already-installed name is not falsely marked pending" passes even if the load never runs.**
- **Where:** `test/extension-lifecycle.sh`, the `bar` block.
- **Proof:** unknown names are filtered out (`installed.ts:197`), so `bar` shows as not-pending whether or not its manifest was read. The test waits only 50 ms and never confirms `bar` became known.
- **Fix:** declare `bar: '4.0.0'` with `3.0.0` installed, then `waitFor(pending)`. That proves the async load happened and then reclassified the dependency.

**5 → P2, minor: closing a `git:`-scheme package.json (diff view) evicts the working copy's snapshot.**
- **Where:** `src/extension.ts:87-98`.
- **Proof:** the eviction key is `dirname(doc.uri.fsPath)`, and git URIs share the real file's path. The next edit triggers finding 1's blank and a full reload.
- **Fix:** evict only for `doc.uri.scheme === "file"`.

## Claims checked and confirmed

**→ Zero synchronous filesystem I/O on warm edits: holds.** The only fs imports left are `node:fs/promises` (`installed-snapshot.ts:1`, `bun/lockfile.ts:1`). Render reads only `dependencyLocations` and `installedSnapshots.get`.

**→ Catalog, hoisted and optional semantics are preserved.**
- The literal `name@spec` fallback now lives on the cached text, and `emptyIndex(text)` keeps it working when the lockfile fails to parse.
- `.lockb` still yields no index.
- ENOENT/ENOTDIR walk up to parent directories; malformed or EACCES manifests stop at `undefined`, exactly as before.
- Snapshots are per directory, so workspace-local copies shadow hoisted ones.

**→ No stale snapshot resurrection.** `load()` checks entry identity (`installed-snapshot.ts:120-122`). `.finally` cannot race with `refresh()` because callers await the post-`finally` promise. The unit tests cover close and clear during an in-flight load.

**→ Closing during analysis can't repopulate the cache.** `doc.isClosed` is checked after both `refreshInstalled` and `analyze` (`extension.ts:327-342`).

**→ Parser change is equivalent and correct.** Binary search over line starts matches the old `toOffset` exactly, including an index immediately after `\n`. The CRLF/emoji test (cols 10/17) and the 1,000-entry range test are arithmetically correct.

**→ 30 s revalidation matches the spec.** It is gated on `enable` and on a visible dependency-bearing package.json, makes no registry calls, and does not depend on `refreshIntervalMinutes`. The lifecycle test asserts the 30,000 ms interval with registry refresh at 0.

**→ Split editors are handled.** `renderDocument` iterates every visible editor for the document, so the per-URI debounce no longer drops one side.

**→ API floor and packaging are fine.** `engines.vscode` stays `^1.90.0` with `@types/vscode` pinned to `1.90.0`, and no newer APIs are used. `.vscodeignore` exclusions look right.

**→ Performance claims are honestly scoped.** The README and plan call them core, not UI, benchmarks. One caveat: the "warm parse+annotation 0.921 ms" figure excludes `getText`, `decorator.render` (MarkdownString building per dependency) and output logging. Those may now dominate a real render.

## Standards and maintainability (judgement calls, not rule violations)

**→ Feature Envy / Duplicated Code: the "does the snapshot cover these names?" rule is written three times.** It appears at `installed-snapshot.ts:124`, `extension.ts:278-281` and `installed.ts:197-199`. A single `InstalledSnapshotCache.ensure(cwd, locations)` returning the current snapshot and kicking off a refresh when incomplete would hold the rule in one place. This would also make finding 3 easier to fix.

**→ Primitive Obsession: `dirname(doc.uri.fsPath)` is the cache key in four places.** They are `extension.ts:94, 209, 277, 317`. A `packageDir(doc)` helper would make finding 5's scheme guard a one-line change.

**→ Divergent Change: `refreshInstalled` both loads and renders.** As a result, `runAnalysis` renders twice (`:213`, then `:361`). Returning the snapshot and letting callers render would remove the hidden side effect.

**→ Not flagged:** the duplicated teardown in `deactivate()` and the subscription disposable copies the existing `refreshTimer` pattern, so repo convention wins. The four parser call-site rewires were required by the approved scope.

## Pre-existing or deferred (not caused by this diff)

**→ Deferred scheduler work, not regressions:**
- A lockfile change that lands during a running `analyze` still commits statuses built from the older snapshot.
- Save, Refresh and invalidation each trigger a full snapshot reload, with no deduplication.

**→ Pre-existing:** non-file-scheme package.json documents (e.g. `git:`) are analysed and decorated.

**→ Deferred by scope:** hover duplication (#4), failure states and command deadlines.

**→ Documented, not a bug:** each package-directory snapshot holds its own copy of the shared root lockfile text and index. A monorepo with several visible package.json files parses the same lockfile once per directory.

## Skipped verification
- I ran no commands; my tools are read-only. The supervisor's reported results (82 tests, lifecycle test, benchmark, package, audit) are unverified by me.
- I did not inspect `bun.lock`, the fixture manifest reorders, or whether `actions/setup-node@v7` exists, beyond the diff itself.
- There has been no real VS Code UI or extension-host CPU profiling.

## Residual risks
- The decoration blank on install (finding 1) only shows up in a real editor.
- Repeated full reloads on large monorepos and remote filesystems have not been measured.
- The definition-hover parse cost (finding 2) is uncovered by any test.

**Review verdict: OK with notes.** No blockers. Findings 1–3 are new P2s, worth fixing before release. Finding 4 is a test gap.