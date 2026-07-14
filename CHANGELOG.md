# Changelog

## [0.3.1]

- Fix false vulnerability annotations when `bun audit` reports a package name
  but the decorated dependency resolves to a safe version (for example,
  `ws@8.21.0` with vulnerable transitive `ws@8.19.0` copies elsewhere in the
  lockfile).

## [0.3.0]

- Identify unused catalog entries directly in `package.json` with a subdued
  `○ unused catalog entry` annotation and tooltip.

## [0.2.1]

- Fix false pending-install hints for catalog entries by resolving catalog
  declarations against `bun.lock` instead of the hoisted `node_modules` copy.
- Surface catalog hoist conflicts when a workspace pins a different version
  directly, including the workspace and pinned spec to make the fix actionable.
- Treat unused catalog entries as already applied for now, so stale catalog
  declarations no longer say "run `bun i`" when no workspace consumes them.

## [0.2.0]

- Add monorepo catalog support: decorate entries under `workspaces.catalog`
  and `workspaces.catalogs` (named catalogs), and resolve `catalog:` versions
  in standard dependency sections.
- Parse the extra `Workspace` column emitted by `bun outdated` in workspace
  projects, so version comparisons (e.g. `27.0.2` → `28.0.0`) work in monorepos.
- Avoid false "run `bun i` to apply" hints when a declared package is resolved
  in the lockfile but intentionally not installed on disk (platform-specific
  optional packages such as `@esbuild/linux-arm64` on macOS).
- Emit debug and progress messages to the **Bun Deps** output channel.

## [0.1.4]

- Fix a stale `bun.lock` (pinned `@biomejs/biome` version) that broke the
  frozen-lockfile install in CI. (0.1.3 was never published.)
- Documentation: refresh the README (and Marketplace listing) for the coloured
  version text, live re-render, pending-install hint, and install instructions.

## [0.1.2]

- Re-render annotations live as you edit `package.json` (no save required),
  instead of only on save.
- Detect a pending install: when an edited version range isn't satisfied by
  what's in `node_modules`, show "Run `bun i` to apply your change." The hint
  clears automatically once the lockfile updates after install.
- Watch `bun.lock` so annotations refresh after `bun i` completes.

## [0.1.1]

- Renamed the extension from **Bun Deps Lens** (`myles-carrick.bun-deps-lens`)
  to **Bun Deps** (`myles-carrick.bun-deps`). Settings and the command moved
  from the `bunDepsLens.*` namespace to `bunDeps.*`.
- Colour the dependency version text itself (theme-aware green/amber/red)
  instead of a faint background, so status is legible at a glance.
- Always show an inline status message on outdated/vulnerable dependencies
  (`● current → latest`, or `● <severity> vuln · current → latest`); green
  stays silent.
- Brand the hover with a "Bun Deps" heading so it's distinguishable from
  VS Code's built-in package.json hover.

## [0.1.0]

Initial release (v1 MVP).

- Colour-coded status on each `package.json` dependency: green (latest), amber
  (outdated), red (vulnerability at or above the configured severity).
- Faint `current → latest` inline hint on outdated dependencies.
- Hover tooltips with the version transition and `bun audit` advisory details.
- Powered entirely by the local `bun` CLI (`bun outdated` + `bun audit --json`).
- Activates only in Bun projects (`bun.lock`, `bun.lockb`, or `bunfig.toml`).
- Settings for enable, refresh cadence, severity threshold, and inline text.
- **Bun Deps: Refresh** command.
