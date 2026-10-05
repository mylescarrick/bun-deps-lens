# Release 0.4.1 preparation

The user accepted the real VS Code Development Host test and authorised CI deployment plus fixture rollback.

- Restored the five tested fixture manifests/lockfiles to HEAD. No fixture diff remains. Ignored fixture node_modules still contain test installations and are excluded from Git and VSIX; reinstall against the restored lockfiles when reusing fixtures.
- Marketplace's latest version is 0.4.0; release tag v0.4.1 is unused.
- origin/main matches the spring-cleaning baseline; no integration changes were needed before committing.
- GitHub release environment exists, has AZURE_CLIENT_ID and AZURE_TENANT_ID secret names, and the previous v0.4.0 workflow authenticated and published successfully. Secret values were not inspected.
- Exact 0.4.1 preparation checks: frozen install, typecheck, lint, 86 unit tests / 182 assertions, original zero-I/O lifecycle plus 18 editor-feedback scenarios, shell syntax, package/content checks, production audit, and diff whitespace checks all pass.
- VSIX: 9 files / 101,180 bytes. Version 0.4.1, VS Code floor 1.90.0, runtime and linked source map included, development files excluded.

Next: push the branch and verify its PR in CI; merge only the verified head; tag that merged main commit and push only refs/tags/v0.4.1. The tag workflow verifies again before publishing. This document records pre-publication readiness, not a claim that CI or publishing has completed.

No new independent review ran for the editor-feedback slice. Earlier spring-cleaning runtime changes have the recorded independent Opus reviews; editor feedback has parent inspection, automated regressions and user-reported real-editor acceptance.
