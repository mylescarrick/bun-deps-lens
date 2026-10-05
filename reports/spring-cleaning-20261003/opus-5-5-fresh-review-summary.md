# Fresh Opus 5.5 review disposition

Both fresh read-only reviewers completed successfully. Spec: OK, all five requested fixes resolved, no new correctness defects. Standards: OK with notes, no blockers or hard documented-standard violations, six optional P2 maintainability suggestions.

## Standards

1. Duplicate empty/disabled document guards, particularly in renderEditor after renderDocument already handles them.
2. Repeated filesystem directory keys and file-scheme guards. A shared directory/ownership helper is optional.
3. Ambiguous names refreshAll/reloadingAll and entryFor. Clearer requested/in-flight and syncEntry names are optional.
4. Repeated name-pruning filter in immediate and asynchronous publication paths. A shared helper is optional.
5. refreshInstalled combines loading and rendering. This is a carry-forward interface concern. Its early local-state render and the later registry-result render serve different phases, so do not simply remove the early render as cosmetic duplication.
6. Duplicated held-read test adapters and several lifecycle probe globals. Consolidation is optional; reviewer labels current cost low.

These are judgement calls, not hard standards violations or correctness blockers. No optional source refactor was applied after this review.

## Spec

Findings 1–5 all resolved: cached registry colors survive local reload/settings changes; catalog navigation reads only lockfile paths; missing-name loading is incremental and prunes current names with safe full-refresh/eviction behavior; new-name testing proves completed classification; virtual buffers cannot evict or replace filesystem snapshots.

Residuals: coalesced full refreshes can miss a filesystem change made mid-read, corrected by the next 30-second local revalidation while enabled and dependency-bearing package.json is visible. Multiple renders during a pending load can attach redundant completion callbacks; the 200 ms debounce limits attachment frequency, not the total number over an arbitrarily slow load. These remain unprofiled, not newly identified correctness blockers.

## Evidence and limits

All 47 source/fixture/CI/configuration fingerprints match the frozen review inputs. Parent verification remains 86 tests / 182 assertions, lifecycle, types, lint, Node core benchmark, packaging/content, production audit and diff check. Neither reviewer independently reran commands; the disposable negative control was recorded, not rerun by reviewers. Real VS Code UI/extension-host profiling and remote CI remain outstanding. The existing high-severity dev-only braces advisory remains; production audit is clean.

Raw reports are preserved unchanged, including their occasionally approximate line references. Parent verified behavior against current source anchors; for example the empty-snapshot annotation fallback is src/extension.ts:310, not the Spec report's :279–280.

Workflow: b44dd0b7-bf3a-4272-93b5-a7ff8f54a1a3
Standards child: 4a38695e-5ff2-4639-8823-b0e4e2833f61
Spec child: 523d13fb-59fa-4f00-b938-e927bf6034ab
No commit, release, publication or issue mutation.
