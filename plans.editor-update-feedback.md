# Editor update feedback

Status: completed. Automated checks passed; the user accepted real VS Code testing and authorised CI deployment.

## Goal

Fix the four editor defects reported during real VS Code fixture testing: duplicate Bun Deps hover sections, update inlay hints arriving only after another editor event, update commands leaving manifests unsaved, and pending-install copy omitting the required save step.

## Diagnosis evidence

A disposable Node adapter harness runs the actual bundled extension against a temporary manifest and installed package. Registry output is pinned to foo 1.0.0 -> 2.0.0. Each case runs in a fresh Node process with one extension activation. It does not read or modify repository fixtures.

The same command ran twice. Four assertions fail deterministically:

- hover: two identical Bun Deps tooltip contributions overlap at the annotation/value boundary; expected one.
- inlay: registry completion creates an available update target but emits no inlay refresh notification.
- autosave: the command updates the editor buffer to 2.0.0, while the on-disk manifest stays at 1.0.0.
- dirty: the pending annotation says "run bun i to apply" without indicating that the edited manifest must first be saved.

The command edits through workspace.applyEdit without saving. The inlay provider has no onDidChangeInlayHints event. Decorations publish the same tooltip on both the value range and the separate annotation. These direct API omissions explain the deterministic failures; extra runtime logging is unnecessary. Actual VS Code hover layout and timing still require a human retest after fixes.

## Approved scope and acceptance checks

1. **hover-ownership:** publish one Bun Deps hover contribution per dependency while preserving access from both the version and the inline annotation, including trailing commas. Keep existing colours, annotation placement, command links, catalogs, pending/conflict/unused copy and theme behaviour.
2. **inlay-refresh:** notify VS Code when asynchronous status data changes, so hints appear without typing, moving the cursor or reopening the document. Dispose event resources. Retain the memory-only warm edit path and no registry scans on unsaved typing.
3. **update-save:** have the shared hover/inlay update command save the target manifest after a successful edit. Do not run bun install automatically. Handle failed edits and failed saves honestly. Approved dirty-document policy: auto-save only when the buffer is clean or its complete content matches known extension-owned edits. Never save unrelated pre-existing or interleaved edits. Serialize related updates and verify full-buffer ownership before saving. Quick fixes use the same command for consistent behaviour.
4. **pending-save-copy:** unsaved pending changes say "Save package.json, then run bun i to apply"; saved pending changes retain install-only wording. Refresh local copy on save without waiting for a registry result. Document-wide isDirty is a conservative signal, not proof that a particular dependency was the unsaved edit.
5. **verification:** promote the disposable reproductions into durable regressions at the actual interaction seams; prove red -> green. Run typecheck, lint, unit tests, Node lifecycle and production build. Ask for real Development Host retest; do not claim mocked tests validate VS Code UI.

## Preservation and exclusions

- Preserve the user's five modified fixture manifests/lockfiles and installed fixture dependencies. No reset is needed for diagnosis. Restore only explicitly requested paths later, with editor buffers coordinated so they cannot overwrite the reset.
- No scheduler redesign, registry TTL work, subprocess deadline/failure-state redesign, activation changes, fixture-matrix expansion or publishing work.
- Keep VS Code 1.90 compatibility and zero-I/O known-name warm edits.
- No delegation, commit, push, issue mutation, release or publication is authorised by this proposal.

## Approved interaction seams

Tests exercise VS Code-facing decorations/hover ranges, inlay provider events, registered update commands and quick fixes, buffer/disk content, and save/edit events. No private method tests. The user approved clean/extension-owned autosave with save-first guidance for other dirty buffers. Existing screenshots provide the visual prototype; a real Development Host retest remains required.

## Verification

Automated checks pass: 86 unit tests / 182 assertions, original zero-I/O lifecycle, 18 feedback scenarios, typecheck, lint, development/production builds, package checks and production audit. Three disposable negative controls prove the ownership/concurrency guards are regression-sensitive. All five user fixture files are unchanged. See `reports/editor-update-feedback/verification.md` for exact checks and the remaining human UI retest.

VS Code document.save uses normal user-configured save participants; the pre-save ownership check is not an atomic lock against edits made during an already-running save. No independent review or delivery action has run for this slice.

## Release approval

The user confirmed the Development Host behaviour looks good and requested CI deployment plus fixture rollback. The five tested manifests/lockfiles were restored to HEAD. Release preparation targets 0.4.1, with a pull request verification gate before tagging the merged main commit. Commit, push and CI publication are now authorised. Historical no-delivery statements above describe the implementation phase.
