# Spring cleaning and performance plan

Date: 2026-10-03
Repository: mylescarrick/bun-deps-lens
Baseline: d1401a4, extension 0.4.0
Workflow: dev-workflow fallback. Dependency/package cleanup and the approved snapshot/parser slices are implemented. Remaining runtime changes await approval.

## Goal and boundaries

Keep the extension host responsive while editing package.json, avoid redundant registry processes, retain VS Code >=1.90.0 support, and address the reported hover duplication without losing navigation or update actions.

Runtime implementation approval: the user approved the disk-free edit path (`snapshot`) and shared parser (`parser`); both are implemented and verified. Other runtime tasks remain unapproved. No commit, release, GitHub comment, issue closure, or PR has been made. Do not raise the minimum VS Code version or implement a new UI without approval.

## Completed cleanup

- Biome 2.5.2 -> 2.5.15.
- Bun types 1.3.14 -> 1.4.2; replace floating `latest` with `^1.4.2`.
- Semver types 7.7.1 -> 7.8.0.
- vsce 3.9.2 -> 4.0.0. Its Node requirement is >=22; CI verification and publishing explicitly select Node 24.
- Ultracite 7.9.3 -> 7.12.2. Apply its new manifest-ordering rule to the root and two fixture manifests; no fixture dependency values changed.
- Regenerate bun.lock, refreshing compatible transitive packages and removing obsolete tooling dependencies.
- TypeScript 7.0.2 and runtime semver 7.8.5 were already current.
- Deliberately pin VS Code types to 1.90.0, down from the previously resolved 1.125.0. Latest is 1.140.0, but matching the advertised API floor prevents accidental use of newer APIs. Do not silently increase the extension engine floor just to update types.
- actions/setup-node v6 -> v7. Checkout v7, setup-bun v2 and Azure login v3 are already on the latest stable major.
- Exclude fixtures, CI configuration, publishing notes and assessment artifacts from the VSIX. Retain the linked production source map for diagnostics. The old `**/*.map` exclusion was already overridden by `!dist/**`.

## GitHub issue review

### #4: Instructions hint duplicated

https://github.com/mylescarrick/bun-deps-lens/issues/4

Open, no comments. The attached screenshot shows **two identical Bun Deps sections inside one hover**, not two inline annotations. VS Code's normal package metadata hover is a separate section and should remain.

Observed in code: `decoration()` in src/decorations.ts supplies the same MarkdownString as hoverMessage on both the value range and the zero-width annotation range. This is a concrete place to investigate, not a confirmed VS Code reproduction or root cause. `setDecorations` replaces the decoration list, so blindly checking whether annotation text has already been added is not an appropriate fix.

Acceptance: reproduce in the Extension Development Host with a trailing comma, hover near the value boundary and annotation, verify one Bun Deps section, and preserve the metadata hover, update link and catalog navigation. Test repeated rendering, no inline label, and split editors. If the repro cannot be obtained, do not claim the issue fixed.

Possible implementation after reproduction: give tooltip ownership to one surface or use one hover provider that returns one Bun Deps contribution for the dependency hit area. Choose the smallest option that preserves hover access from both surfaces; avoid introducing two providers for the same content.

The reporter also mentions coloured emoji. The current implementation colours version text and uses monochrome bullets with theme colours; README emoji are a legend rather than literal UI characters. Clarify that distinction and check light/dark/high-contrast themes.

### #2: Inline status

https://github.com/mylescarrick/bun-deps-lens/issues/2

Open, no comments. Requests inline results and faster UX, referencing Version Lens and npm-package-dropdown. Version 0.4.0 already has inline status decorations, quick fixes and clickable update hints. Recommend a response pointing to `bunDeps.showInlineVersions` and asking whether this meets the requested UX, rather than closing it without confirmation. Its latency concern remains relevant.

## Measured baseline

Artifacts:

- reports/spring-cleaning-20261003/benchmark.sh
- reports/spring-cleaning-20261003/baseline.json
- reports/spring-cleaning-20261003/repeat.json

Reproduce: `bash reports/spring-cleaning-20261003/benchmark.sh`.

The harness bundles the real parser/annotation code with Bun but executes it under **Node 24.18.0**, matching the extension-host runtime family, on macOS arm64. Synthetic manifests use unique dependency names. Installed cases use local manifests; the optional case has 100 absent exact-version dependencies and a 1,150,590-byte lockfile with 10,000 filler resolutions. Five warmups; 20 measured runs per installed case, 10 per optional case. fs hooks count calls and bytes read, without changing results. Setup is outside timing.

Two-run median ranges, milliseconds:

| Case | Parse | Local annotations |
|---|---:|---:|
| 50 installed dependencies | 0.079–0.083 | 0.935–1.044 |
| 500 installed dependencies | 5.939–6.082 | 55.616–71.426 |
| 1,000 installed dependencies | 30.771–54.886 | 102.555–353.716 |
| 100 absent optional dependencies, 1.15 MB lock | not separately measured | 43.997–157.207 |

Timings vary substantially with filesystem/cache and system load. They are **not** full-extension activation or UI profiles and do not predict all users' latency. Operation counts are stable and the strongest signal:

- 1,000 installed dependencies: 1,001 existence checks, 1,000 synchronous manifest reads and one stat **on every render**.
- 100 missing optional dependencies: 901 existence checks, 100 full lockfile reads, **115,059,000 bytes read per render**, even after the lockfile index is warm.
- Parser `toOffset()` rescans the text prefix twice for every dependency, giving quadratic growth for dense manifests.

One root-project subprocess sample before updates: bun --version 8.2 ms; bun outdated 943.0 ms; bun audit 382.9 ms. Actual outdated/audit calls run in parallel, not sequentially. Initial analysis also waits the fixed **600 ms** debounce, so the outdated branch alone implies roughly 1.55 seconds before results, excluding local computation. Network timings are a single sample, not an SLO.

Production JavaScript is **50,788 bytes**. Bundle size is not the main typing bottleneck. Packaging cleanup reduces the VSIX from **142.76 KB to 91.91 KB**, approximately **36% smaller**, with nine files instead of seventeen. This improves download/install payload, not synchronous edit-path blocking.

## Priority recommendations

### P1: Make typing a memory-only operation (implemented)

Files: src/installed.ts, src/bun/lockfile.ts, src/extension.ts.

Use a shared installed/lockfile snapshot per project instead of rereading package manifests on each edit. Resolve manifests asynchronously during snapshot refresh. Reuse the lockfile index for the platform-skipped/optional fallback instead of `isResolved()` rereading the complete lockfile for each missing dependency.

Keep range comparisons and annotation computation pure over the snapshot. Preserve existing optional/platform-skipped behavior; do not replace the literal lookup with a broader semver check without specifying and testing the resulting semantics. Distinguish catalog versions and workspace-local overrides.

Invalidate on relevant install/lockfile changes, lockfile deletion, explicit Refresh, and bounded staleness. Lockfile-only invalidation misses node_modules changes without a lockfile rewrite, so use scoped manifest events or an async revalidation policy too. Cache misses must show pending/unknown data safely, not invent a green success state. Evict closed/removed-project caches.

Acceptance: zero synchronous disk calls on warm edits; optional lockfile bytes per warm edit drop from 115,059,000 to zero. Re-run current catalog/hoisting/optional tests and add invalidation, missing-package and deletion tests.

### P1: Linearise and share document parsing (implemented)

Files: src/package-json.ts and its callers.

Build line-start offsets once per parse, then locate positions by binary search or a monotonic cursor. Cache locations by document URI **and version**, shared by decoration, inlay, quick-fix and catalog providers. Retain tolerant behavior during incomplete edits, UTF-16 columns and accurate quoted ranges.

Acceptance: existing parser tests plus CRLF, Unicode, unsaved edits and large-manifest range assertions. Aim for <=5 ms warmed median at 1,000 dependencies on this benchmark machine; treat this as an investigation target, not a hardware-independent CI timeout. Check scaling and deterministic operation counts as well as timing.

### P2: Coalesce analysis and render cached results first

Files: src/extension.ts, src/analyzer.ts, src/bun/runner.ts.

- Render cached results immediately when switching to an already-analysed document; defer stale registry refresh.
- Cache/deduplicate the Bun version probe, including a short negative retry policy so installing Bun during the session recovers.
- Maintain one in-flight job per analysis key and coalesce save, watcher and refresh events. Debouncing queued starts does not prevent overlapping jobs already running.
- Deduplicate audit by lockfile root. Retain cwd-sensitive outdated/installed resolution until cross-workspace result identity is modelled: outdated output has workspace rows, while current statuses collapse by package name. Blindly sharing final statuses across a monorepo can colour or update the wrong version.
- Reject stale completions using document/project generations; closing a document, disabling the extension or changing configuration must not repopulate stale cache entries.
- Render to every visible editor for the document. Current document-keyed render timers retain only the last split editor callback.
- Notify inlay hints when cached analysis changes. The provider currently lacks onDidChangeInlayHints; also ensure enable/disable gates providers consistently.
- Scope lockfile events to affected projects instead of refreshing every visible package.json in unrelated roots.

Proposed registry cache TTL: **5 minutes**, with explicit Refresh and relevant install events bypassing it. Keep the existing configurable **15-minute** background cadence; TTL limits redundant switches/saves and is a separate policy. Confirm the 5-minute freshness trade-off before implementation.

Acceptance: fake-clock/fake-runner tests assert one subprocess pair for overlapping same-key events, bounded concurrency across roots, no stale cache commit, immediate cached rendering, split-editor updates and working recovery after Bun becomes available.

### P2: Bound process work and represent failure honestly

Files: src/bun/runner.ts, src/analyzer.ts, src/status.ts.

Add cancellation and a configurable or documented command deadline. Proposed default: **30 seconds**, pending agreement for slow/offline registries. Abort owned processes on close/deactivation/superseded work; ensure timeout/disposal of the version probe too.

Current non-zero or unparseable output can become empty result sets, then green statuses saying 'On the latest published version.' This is a correctness risk, not just a performance issue. Keep valid audit findings on expected non-zero vulnerability exits, but distinguish command failure, missing/unknown data and genuine clean results. Preserve previously successful results with a stale marker if refresh fails; do not report a new clean scan.

Acceptance: fake processes exercise timeout, abort, ENOENT, malformed output, offline registry, valid audit exit 1 and successful empty output. No failed scan may be presented as fresh/latest/security-clean.

### P3: Fix #4 at the verified UI seam

First reproduce the exact screenshot symptom, then implement one tooltip owner/contribution and a regression at the correct seam. Preserve both hover entry points if possible, trusted-command allowlists, catalog navigation and metadata hover. Do not add a blanket deduplication check to status strings.

### P3: Profile real extension-host activation and rendering

Use VS Code's Running Extensions view and extension-host CPU profile with a normal repository and a large monorepo. Measure cold activation, warm document switch, typing after install, split editors, repeated lockfile writes and offline registry. Remote/WSL filesystems need their own profile.

Instrument analysis phases with elapsed timings behind a debug option rather than logging every render unconditionally. After P1, consider reducing the fixed **200 ms** edit debounce toward 50–100 ms only if profiles show consistently cheap renders; lowering it before removing synchronous I/O increases blocking frequency.

Consider activating on package.json opening with a lightweight Bun-project gate to avoid work before a relevant editor exists, while preserving nested monorepo and explicit-command activation. Changing workspaceContains glob behavior needs coverage; activation-search cost was not measured here.

## Security and tooling caveats

After updates, `bun audit --production` reports no vulnerabilities for the one runtime dependency. Full audit still reports **one high-severity braces advisory** through ultracite -> fast-glob -> micromatch -> braces 3.0.3 (GHSA-vfj7-8cjw-p6xm). The registry's latest braces is still 3.0.3, so there is no patched version to update to. This is development tooling, not part of the runtime bundle. Track upstream, restrict processing of untrusted glob input, or reassess the lint wrapper; do not claim the complete dependency graph is vulnerability-free or add an unverified override.

Bun initially reported TypeScript peer warnings during updates against the old installed tree. A separate clean frozen-lockfile install succeeded without those warnings, and vsce reported 4.0.0 there. The current graph no longer contains the old @typescript-eslint packages. No dependency lifecycle scripts were manually trusted.

Additional documentation check: respectMinimumReleaseAge is declared but unused by extension code; README calls it reserved yet also claims minimum-release-age support. Verify Bun CLI behavior and correct that guarantee rather than implying the setting is implemented.

## Task order and acceptance

1. **cleanup**: dependency/CI/package changes; frozen install, typecheck, lint, 65 tests, production audit, VSIX content check and diff review.
2. **snapshot**: memory-only warm edits with correct install invalidation and existing catalog/optional semantics. Depends on cleanup approval.
3. **parser**: near-linear shared document parsing and accurate ranges. Depends on cleanup approval; can precede or follow snapshot.
4. **scheduler**: deduplication, stale-result guards, immediate cached rendering, split editors and provider notifications. Depends on snapshot and parser.
5. **runner**: bounded/cancellable subprocesses and honest unknown/failure status. Depends on scheduler.
6. **hover**: verified reproduction and nonduplicated tooltip. Depends on cleanup approval and availability of a correct UI regression seam.
7. **profile**: real extension-host before/after evidence and any activation/debounce decisions. Depends on snapshot, parser, scheduler and runner.

Open decisions before runtime implementation: 5-minute cache freshness policy; 30-second command timeout; reproducible #4 environment; whether to include activation changes in this pass. A prototype is optional: use a fake runner/snapshot experiment only if it settles a design uncertainty faster than integration tests.

Verification commands: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun test`, `bun run package`, `bun audit --production`, `git diff --check`, and `bash reports/spring-cleaning-20261003/benchmark.sh`.

Final cleanup verification on 2026-10-03: frozen install, typecheck, lint, all 65 tests (121 assertions), package build, production audit and diff checks pass. ZIP-content assertions confirm the runtime bundle, linked source map and icon are present while development artifacts are excluded. Separate clean frozen install succeeds and its vsce CLI reports 4.0.0. Full audit retains the single dev-only braces advisory described above. Remote CI and Marketplace publishing have not been run.

The companion plans.spring-cleaning.json tracks the same task identities and evidence. Cleanup is complete. The approved `snapshot` and `parser` tasks are complete. Other runtime tasks remain unapproved.


## Approved slice results

Final evidence: reports/spring-cleaning-20261003/after.json and plans.spring-cleaning.progress.md.

- 1,000-entry parser median: **30.687 ms before -> 0.211 ms after**, measured on the same Node/macOS machine. End-to-end core parsing plus local annotation computation on a warm installed snapshot: **0.921 ms median**. Neither number includes VS Code decoration transport/UI, the unchanged 200 ms debounce or registry latency.
- Optional fallback: **115,059,000 lockfile bytes and 100 synchronous reads per edit -> zero**. Warm annotation median is **1.814 ms**, versus 43.997–157.207 ms in the two original runs. Literal optional-resolution semantics are preserved; fallback matching still scans cached text in memory, not a broadened semver check.
- New names load asynchronously and are unclassified until known. Manifest reads run in batches of at most 32 per snapshot load. Snapshots are keyed by package directory so workspace-local copies remain distinct. Each snapshot owns its lockfile index; unchanged indexes are reused and no global lockfile cache survives closed projects.
- Local revalidation runs every **30 seconds** only for visible dependency-bearing package.json buffers while enabled. It detects installs without lock rewrites even if registry background refresh is disabled. Explicit analysis/Refresh reloads snapshots; lockfile create/change/delete and workspace-folder events invalidate them. Close/disposal invalidates in-flight loads. Registry cadence, registry TTL, command deadlines and Bun process deduplication were not changed.
- Split editors and the four parser consumers share URI/version locations. Unrelated buffer closes do not evict a package snapshot, and changing the package buffer language before closing still cleans up cached data and queued callbacks.
- Cold snapshots still perform asynchronous I/O and parse changed lockfiles on the extension host. The final cold-load samples varied from 24.128 to 252.403 ms across installed cases; these are one-off measurements with filesystem/JIT variability, not proof of improved startup. Measure real VS Code cold activation and remote filesystems before changing further timing policies.

Fresh final checks: frozen install, typecheck, lint, **82 tests / 157 assertions**, Node extension lifecycle integration, Node performance harness with synchronous-I/O assertions, production audit, package contents and diff checks. The runtime bundle is now about **53 KB** and the nine-file VSIX is **95.52 KB**; the earlier 91.91 KB figure records dependency/package cleanup before runtime implementation. No commit or release has been created. Full audit's dev-only braces advisory remains; real VS Code UI/CPU profiling and the hover/failure-state work are still pending.


## Approved Opus follow-up

The user approved fixing findings 1–5 in sequence, then requesting a fresh Claude Opus 5.5 review. Scope is the five findings in reports/spring-cleaning-20261003/opus-5-5-review.md, not the previously deferred registry scheduler, command deadlines, failure states, hover duplication or real VS Code profiling.

1. `review-fix-1`: keep registry decorations during local invalidation and stop settings-only snapshot eviction. Regression at the bundled extension lifecycle seam.
2. `review-fix-2`: resolve catalog root from lockfile path only. Real catalog definition requests, unsaved root definitions, binary locks and filesystem read counting at the Node editor-adapter seam.
3. `review-fix-3`: distinguish incremental ensure from full refresh; prune names and preserve full-refresh/eviction/concurrency semantics. Real snapshots plus filesystem read counters and controlled I/O at the approved snapshot seam.
4. `review-fix-4`: prove newly typed names become classified asynchronously, rather than passing merely because unknown names are skipped. Observe a name-specific pending state and its clearance in the lifecycle harness.
5. `review-fix-5`: prevent virtual-buffer close from evicting working snapshots. URI-scheme ownership regression at the lifecycle seam.

The existing approved document/snapshot/editor test seams cover these regressions. No commit, release or issue mutation is authorised. Fresh final verification precedes one read-only Opus 5.5 review workflow with separate fresh Standards and Spec contexts; source remains frozen during review.

Filesystem ownership note: pruning names makes each directory's working package document authoritative. Git revisions share fsPath, so finding 5 also gates snapshot-triggering editor events and local polling to file documents, rather than letting a virtual revision replace the working set. URI-specific document metadata is still cleaned for any package buffer on close; catalog provider registration is unchanged.
