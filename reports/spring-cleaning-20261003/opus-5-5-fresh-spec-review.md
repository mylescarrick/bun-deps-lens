The Spec/correctness review is complete: all five findings are resolved, I found no new defects, and the verdict is **OK**. I ran no commands, so the test results quoted are the parent's, not mine.

# Fresh Spec/correctness review: spring-cleaning follow-up (working tree vs `d1401a4`)

## Five named findings

**1 → Resolved.** `renderEditor` now passes `snapshot ?? { installed: new Map() }` into `computeAnnotations` (`src/extension.ts:279-280`) instead of clearing the editor. The `bunDeps` config handler only calls `refreshAllVisible()` (`:106-110`), so a settings change no longer evicts the installed cache. Unknown names are skipped (`installed.ts:196-199`), so no false pending or conflicts appear. `decorations.ts:221-223` emits nothing without a status, so the lifecycle check (`buckets…length > 0` after `lockDelete`) can only pass on cached registry colours.

**2 → Resolved.** The definition provider now looks up only the lockfile path with `findLockfile` and returns early for `.lockb` (`catalog-definition-provider.ts:34-38`). The lifecycle test makes real default, named and unsaved-root catalog requests and asserts `lockReads === 0`, plus `undefined` for a binary lock.

**3 → Resolved.**
- `entryFor` replaces the current names and prunes the snapshot (`installed-snapshot.ts:115-135`).
- `load` reads only missing names unless `refreshAll` is set, filters again before publishing, and loops while names are incomplete (`:157-191`).
- A full refresh during a partial load sets `refreshAll` and forces another pass. Overlapping full reloads coalesce through `reloadingAll`.
- Empty documents evict in `renderDocument` and `runAnalysis`.
- Tests cover all of this with a `readFile` spy: single-manifest reads, rename pruning, full refresh during a partial load (bar read twice, foo once), and coalescing.

**4 → Resolved.** The lifecycle test declares `bar: '4.0.0'` with 3.0.0 installed. It asserts bar is not pending right away, waits for `pendingOnLine(editor, 3)`, then edits back and checks the pending hint clears immediately. No 50 ms sleep remains. The negative control (only bar's read held, failing with the exact wait message) is recorded at `plans.spring-cleaning.progress.md:57`. That probe was disposable and I did not rerun it.

**5 → Resolved.**
- Close evicts the snapshot only for `scheme === "file"` (`extension.ts:94-96`).
- `isPackageJson` now requires the file scheme (`:153-160`), which gates edit, save, active-editor, Refresh, invalidation and the 30 s polling.
- URI-keyed cleanup (`:91-92`, `:97-100`) and definition-provider registration (`:48-51`) are unchanged.
- **Behaviour change:** Git/virtual `package.json` views are no longer decorated at all. This is within the approved wording, and Bun runs against `fsPath` anyway, so no supported behaviour is lost.

## Findings

No issues found.

## Earlier P2 notes

**→ Still apply (standards, not correctness):** `refreshInstalled` plus the final render still renders twice per analysis, and the benchmark caveat stands (it excludes `decorator.render`). The duplicated "does the snapshot cover these names?" rule is now held in one place, `complete()`.

**→ Unchanged and deferred, not regressions:** the race where `analyze` commits statuses from an older snapshot, failure states, hover, and profiling.

## Residual risks

**→ Coalesced full refresh can miss a mid-read change.** A save that coalesces onto an in-flight full reload can miss a `node_modules` change made during that read. This is spec-mandated and the 30 s revalidation corrects it.

**→ Redundant re-renders.** Each `renderDocument` during one load attaches its own `.then`, so N re-renders follow completion. This is bounded by the 200 ms debounce.

## Skipped verification

I did not run tests, lifecycle, benchmark or package checks myself. There is no real VS Code UI or extension-host profile, and no remote CI run.

Merge verdict: OK