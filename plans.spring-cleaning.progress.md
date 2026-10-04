# Spring-cleaning delivery progress

## Approved slice

User approved `snapshot` and `parser` only. Keep registry TTL/deadline policy, scheduler redesign, hover fix and activation work out of this slice.

The approved plan's test seams are document parsing/cache (URI + version, ranges), installed snapshot loading/refresh/invalidation, and pure annotation/resolved-version computation (catalogs, optional dependencies and local workspace overrides). Use real temporary filesystem fixtures for the snapshot seam. Benchmark the actual core under Node; do not claim this is an Extension Development Host profile.

Implementation order: shared document cache; parser offset indexing; asynchronous installed snapshots and pure annotation computation; lifecycle integration; regression tests and final measurements.


## Red/green evidence

- `bun test test/document-locations.test.ts` first fails on missing shared-cache module, then passes for shared URI/version parsing and unsaved-version invalidation.
- `bash reports/spring-cleaning-20261003/benchmark.sh` plus a <=5 ms 1,000-entry parser median assertion fails at **30.687 ms** before offset indexing. It passes at **0.280 ms** immediately after the parser change and **0.211 ms** in final verification.
- `bun test test/installed-snapshot.test.ts` first fails on the missing snapshot module, then passes after asynchronous snapshot loading and pure range comparisons are introduced.
- Actual bundled extension lifecycle regression catches unrelated README closes evicting a warm package snapshot; filename-scoped eviction fixes it. A second regression catches a package language change bypassing close cleanup; filename-based rather than language-based cleanup fixes it.
- `bun test test/installed-snapshot.test.ts --test-name-pattern non-directory` catches an ENOTDIR regression in hoisted lookup; treating ENOTDIR like a missing local path preserves the original parent lookup.

## Original snapshot/parser verification, before Opus follow-up

- `bun install --frozen-lockfile`: pass, no dependency graph changes.
- `bun run typecheck`: pass.
- `bun run lint`: pass.
- `bun test`: **82 pass, 0 fail, 157 assertions**, ten files.
- `bun run test:extension`: pass. Bundled extension runs under Node with mocked editor/process adapters, real filesystem snapshot loading, and fake timers. Warm edits and provider requests have **zero synchronous filesystem calls** and one parse per document version. Covers split editors, independent 30-second local polling, new names, lock deletion, unrelated closes, language changes and disposal. This is not an actual VS Code UI test.
- `bash reports/spring-cleaning-20261003/benchmark.sh`: pass; every measured warm operation asserts zero synchronous filesystem calls. Results saved to reports/spring-cleaning-20261003/after.json. 1,000-entry parser median **0.211 ms**; parse plus annotation **0.921 ms**. Optional fallback annotation **1.814 ms**, with zero lockfile bytes read per warm edit.
- `bun run package`: pass; nine files, **95.52 KB**. ZIP assertions exclude fixtures, CI, reports, plans, sources, tests and node_modules.
- `bun audit --production`: pass, no runtime advisories. The previously documented full-audit dev-only braces advisory is unresolved upstream.
- `git diff --check`: pass.

Self-review followed all snapshot/parser call sites and verified API-floor compatibility. No independent reviewer or actual Extension Development Host CPU/UI profile was run. Only the approved two runtime tasks are complete; scheduler, runner/failure states, hover reproduction/fix and real profiling remain pending approval. No commit or release.


## Opus follow-up, approved

User requested each of the five findings fixed in turn, then a fresh review. Use failing regression -> smallest fix -> passing focused check per finding. Extend existing approved snapshot and editor-lifecycle seams; filesystem instrumentation is at the external I/O seam, not mocked internal code. Final verification and a new read-only Opus 5.5 context follow all five fixes.

### Finding 1

`bun run test:extension` goes red on settings-only installed snapshot eviction, then red on decoration clearing during lock invalidation. Removing config eviction and rendering cached registry data with empty/unknown local annotations makes both pass. `bun run typecheck` and `git diff --check` also pass. No local install state is invented during reload.

### Finding 2

Actual `catalog:` definition request fails with one `bun.lock` read. Path-only `findLockfile` lookup makes default and named catalog navigation, repeated requests and unsaved root definitions pass with zero lockfile content reads. Binary lock behavior is unchanged. `bun run test:extension`, typecheck and diff checks pass.

### Finding 3

Added memory-first `ensure` to own current-name coverage and load only unknown names. `refresh` remains a full manifest revalidation. Both prune names to the current document; in-flight results are pruned again before publication, and an empty document evicts its entry.

The missing API regression goes red, then green; the rename test goes red with `[foo,f,fo,bar]` instead of `[bar]`, then green; the bundled extension goes red with foo+bar reads, then green with exactly one bar read for both split editors. Controlled filesystem reads additionally prove force refresh during a partial load rereads known names, and overlapping full refreshes coalesce. Existing close/clear race tests still pass.

`bun test test/installed-snapshot.test.ts`: 17 tests, 50 assertions. `bun run test:extension`: passes, now also asserting zero asynchronous I/O on known-name warm edits. Typecheck, focused formatting and diff checks pass.

### Finding 4

Lifecycle now declares bar 4.0.0 with 3.0.0 installed. It checks the immediate unknown state, waits for bar's own pending annotation on both split editors, then edits back to 3.0.0 and checks immediate clearance from the newly known snapshot. No arbitrary 50 ms sleep remains. Foo-specific invalidation checks cannot be satisfied accidentally by bar's pending state.

The real harness passes. A disposable copy under TMPDIR holds only bar's read forever: the updated test fails specifically with `new-name bar must become pending after its manifest load`, proving it cannot pass just because unknown names are skipped. The probe and its build/log artifacts are removed; no production mutation was needed. `git diff --check` passes.

### Finding 5

Closing a Git revision fails the retained-working-pending assertion before the fix, then passes after only file documents can evict installed snapshots. Since current names are now authoritative per filesystem package, virtual edit/save/activation scheduling and virtual-only polling must not replace those names. That second regression fails with 3 timers instead of 1, then passes after file-scheme event/poll ownership is enforced. URI-specific metadata cleanup on close and catalog definition provider registration are unchanged. Subsequent working edits still assert zero async filesystem calls. Focused format, lifecycle and typecheck pass.

Final benchmark now includes parser + cache ensure + annotation (`warmCachedEdit`) as well as the older pure parse/annotation comparison. Every measured warm operation asserts zero synchronous and asynchronous filesystem calls. This remains a Node core benchmark, not UI/extension-host profiling.

## Final verification for the five fixes

All source changes are complete. The first final lint check caught Python-expanded plan JSON formatting; formatting that metadata resolves it. The full rerun recorded in `reports/spring-cleaning-20261003/followup-verification.json` passes frozen install, typecheck, lint, **86 tests / 182 assertions**, bundled Node lifecycle, core benchmark, VSIX package/content checks, production audit and diff check. Nine-file VSIX is **99,006 bytes (96.69 KiB)** with linked map and no development artifacts.

Current Node/macOS arm64 benchmark: 1,000-entry parser median **0.300 ms**, warmed parse + cache ensure + annotations **1.809 ms**. All measured warm operations assert zero synchronous and asynchronous filesystem calls. See `reports/spring-cleaning-20261003/after-review-fixes.json`; these are core timings, not actual VS Code UI profiles.

All five fix tasks are completed. A fresh read-only Opus 5.5 workflow now has separate Standards and Spec contexts, with final source fingerprints and an explicit working-tree diff against d1401a4bc112a4c1a2be65a5025dda02cbaf3b6d, including untracked source/tests. Review remains pending. No commit, release, remote CI execution, issue mutation or publication. The existing dev-only braces advisory and deferred scheduler/runner/hover/real UI profiling remain unchanged.

## Fresh independent review completed

Workflow `b44dd0b7-bf3a-4272-93b5-a7ff8f54a1a3` completed both fresh read-only Opus 5.5 axes. Spec: **OK**, all five requested findings resolved, no new defects. Standards: **OK with notes**, six optional P2 maintainability suggestions, no blockers or hard standards violations. Source fingerprints match all 47 frozen inputs; no source edits followed final verification or review.

Reports and parent disposition: `reports/spring-cleaning-20261003/opus-5-5-fresh-{standards,spec}-review.md` and `opus-5-5-fresh-review-summary.md`. Carry-forward loader/render interface concerns and redundant async completion renders are optional/unprofiled, not automatically authorised follow-up refactors. The 200 ms debounce bounds attachment frequency, not total callbacks for a slow load. Full refresh coalescing can miss mid-read changes, corrected by enabled/visible dependency-bearing 30-second revalidation. Reviewers did not rerun commands or the disposable negative control. Real UI profiling and remote CI remain absent; dev-only braces advisory remains. No commit, release or issue mutation.

## Commit preparation, approved

User approved committing the verified changes. Split into toolchain/package hygiene, runtime/parser regression fixes, and portable delivery evidence. Reviewed runtime/source/fixture/CI fingerprints still match. Move redundant patch captures, launch briefs and raw logs to session artifacts rather than versioning scratch or machine-specific execution metadata. Preserve benchmark scripts/results, command-result summaries, source hashes and final review reports in the approved evidence location. No push or publication is authorised.

### Committed source slices

- `6027562`: toolchain, Node 24 CI and packaging hygiene. An isolated snapshot of the exact staged cleanup passes typecheck, lint, **65 tests / 121 assertions**, and build before commit.
- `3fc6136`: reviewed snapshot/parser implementation and regressions, README and lifecycle CI integration. All **47** reviewed source fingerprints still match; the existing full **86 tests / 182 assertions** verification and both independent reviews remain applicable. Staged files match the verified working tree; secret indicators and cached diff checks are clear.
- Portable plans, benchmark scripts/results, command-result summaries, source hashes and final review reports accompany the source slices in the following documentation commit. Scratch patches, launch briefs and raw logs are preserved only in session artifacts. No push, publication, issue change or additional runtime refactor.
