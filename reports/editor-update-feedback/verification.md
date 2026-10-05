# Editor update feedback verification

## Result

The approved fixes are implemented and pass automated checks. Actual VS Code hover aggregation, inlay timing and save UI still require a Development Host retest. No independent review, commit, push or publication has run for this slice.

## Checks

- `bun install --frozen-lockfile`: pass, no dependency changes.
- `bun run typecheck`: pass against VS Code 1.90 declarations.
- `bun run lint`: pass.
- `bun test`: 86 tests, 182 assertions, all pass.
- `bun run test:extension`: original zero-synchronous-and-asynchronous-I/O lifecycle checks plus 18 editor-feedback scenarios pass.
- `bun run build:dev` and `bun run build`: pass.
- `bun run package`: pass, 9 files / 100,819 bytes. Bundle and linked source map included; fixtures, tests, plans and reports excluded.
- `bun audit --production`: no vulnerabilities, one production package checked. Development advisories were not reassessed here.
- `git diff --check`: pass.
- All five user-modified fixture manifests/lockfiles retained identical SHA-256 fingerprints throughout this work.

## Regression strength

Before fixes, deterministic tests fail for duplicate hover contributions, missing asynchronous inlay refresh, buffer-only updates and missing save-first wording. Subsequent tests also expose concurrent-update save failures, quick-fix inconsistency and stale links changing a different dependency.

After fixes, disposable mutations removing the dirty-buffer guard, interleaved-edit guard or update serialization each make their targeted regression fail. Mutation scratch files were deleted. No repository fixtures are used by these feedback tests.

The adapter suite exercises hover links, inlay commands, quick fixes, default catalog declaration updates, clean/dirty manifests, multiple related updates, same-line range shifts, stale dependency identity, failed edits, false/throwing saves, extension-owned retry after a failed save, and unrelated edits made before or during updates. These are Node tests at editor/process boundaries, not actual VS Code UI tests.

## Save boundary

Updates are serialized per URI and their dependency identity is re-resolved in the current document. Before requesting a save, the complete buffer must match the expected extension edit and must have started clean or matched previously recorded extension-owned contents. Untracked dirty contents are never assumed safe. False/throwing saves retain dirty state and explicit guidance. Related edits can retry a previously failed save when ownership is still provable.

Saving uses VS Code's normal document-save API, including user-configured save participants. The ownership check is immediately before that request; this does not provide an atomic exclusion lock against edits made while VS Code is already saving.

## Manual retest

1. Stop and restart the F5 session so the new bundle loads.
2. Open the monorepo root manifest. Existing TypeScript and named esbuild catalog declarations still offer update targets without resetting the user's earlier lodash/think experiments.
3. Hover both the version and annotation: one Bun Deps section each. Update hints should refresh as analysis completes without a subsequent edit.
4. Update a clean declaration: inspect the saved file before running `bun i`.
5. Make an unrelated unsaved edit, then update another dependency: the file stays dirty with save-first guidance. Save it and check that install-only wording appears without waiting for registry work.

## User acceptance and release handoff

The user reported that real VS Code testing looks good and requested CI deployment. This supersedes the pending manual-retest state above; it is user-reported acceptance, not automated UI evidence. The five modified fixture files were restored to HEAD at the user's request. Version 0.4.1 is the release target; CI verifies the PR and the release tag before publishing.
