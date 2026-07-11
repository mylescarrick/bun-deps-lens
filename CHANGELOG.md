# Changelog

## [0.1.3]

- Documentation only: refresh the README (and Marketplace listing) for the
  coloured version text, live re-render, pending-install hint, and install
  instructions.

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
