# Bun Deps

A Bun-only VS Code extension that annotates `package.json` with inline,
colour-coded dependency status, powered entirely by the `bun` CLI already on
your `PATH` — no bundled network client.

The version string itself is coloured, and outdated/vulnerable dependencies get
a short inline status message after the line:

- 🟢 **Green** — on the latest published version (no inline message; the green
  value says it all).
- 🟠 **Amber** — outdated: `● current → latest`.
- 🔴 **Red** — a vulnerability at or above your configured severity threshold
  (`bun audit`), regardless of how out of date it is: `● <severity> vuln ·
  current → latest`.

Two extra behaviours:

- **Live updates** — annotations refresh as you edit `package.json`, not just on
  save.
- **Pending-install hint** — if you change a version range to something that
  isn't installed yet, the value turns amber with `● run bun i to apply`. It
  clears automatically once you run `bun i`.
- **Catalog-aware monorepo hints** — `workspaces.catalog` and named catalog
  entries are checked against `bun.lock` (not the hoisted `node_modules` copy),
  so unused catalog entries are shown as `○ unused catalog entry` instead of a
  false install nag. If a workspace pins a different version directly and that
  copy is hoisted to the root, the inline note names the workspace responsible,
  e.g. `⚠ hoisted 4.20251125.0 via packages/tools`.

Hover any dependency for a tooltip (headed **Bun Deps**, to distinguish it from
VS Code's built-in package.json hover) with the version transition and advisory
details.

## Install

Install **Bun Deps** from the VS Code Marketplace, or:

```sh
code --install-extension myles-carrick.bun-deps
```

## Requirements

- [Bun](https://bun.com) `>= 1.2.0` on `PATH` (`bun audit --json` and the
  `bun outdated` table are used under the hood).
- The extension stays dormant unless the workspace looks like a Bun project
  (`bun.lock`, `bun.lockb`, or `bunfig.toml`).

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `bunDeps.enable` | `true` | Master toggle |
| `bunDeps.refreshIntervalMinutes` | `15` | Background re-check cadence (0 disables) |
| `bunDeps.severityThreshold` | `"high"` | Minimum audit severity that colours a dep red |
| `bunDeps.showInlineVersions` | `true` | Toggle the inline status message after outdated/vulnerable deps |
| `bunDeps.respectMinimumReleaseAge` | `true` | Reserved for `minimumReleaseAge` support (v1.1) |

Run **Bun Deps: Refresh** from the command palette to re-analyse on demand.

## Development

```sh
bun install
bun run build        # bundle with `bun build` (CommonJS, vscode external)
bun test             # unit tests for parsers & status logic (bun:test)
bun run typecheck    # tsc --noEmit
bun run lint         # ultracite (Biome) check
```

### Testing in VS Code

1. Build the extension: `bun run build:dev` (or use the `npm: watch` task).
2. Run `bun run setup:fixtures` to install dependencies for the fixture
   projects under [`fixtures/`](./fixtures).
3. Press <kbd>F5</kbd> to launch the Extension Development Host.
4. In the new VS Code window, open a fixture folder
   (e.g. `File → Open Folder… → fixtures/monorepo-catalog`) and open its
   `package.json`.

The Debug panel also has ready-made launch entries for each fixture
(`Run Extension (monorepo-catalog fixture)`, etc.) so you can skip step 4.

## How it works

The extension never talks to a registry directly. It runs `bun outdated` and
`bun audit --json` in the package directory (debounced, cached), parses their
output, and renders decorations:

- `bun outdated` has no `--json` flag as of Bun 1.3.x, so its pipe-delimited
  table (`Package | Current | Update | Latest`, with `(dev)` markers) is
  parsed directly.
- `bun audit --json` returns advisories keyed by package name. Bun Deps filters
  those advisories against the resolved version for the decorated dependency so
  a safe direct/catalog entry is not coloured red just because another nested
  copy of the same package name is vulnerable.

The registry analysis runs on save, on a background interval, and via the
refresh command. Editing re-renders instantly from cached data — the
pending-install hint is computed locally, with no network call. Standard
package ranges are compared against the installed version in `node_modules`
(via `semver`); catalog declarations are resolved from an in-process,
mtime-cached `bun.lock` index so hoisted workspace copies do not create false
"run `bun i`" hints. A watcher on `bun.lock` triggers a fresh analysis once an
install completes.

## Roadmap

- **v1.1** — `bunfig.toml` `minimumReleaseAge` cooldown awareness + tooltips,
  gutter dots.
- **v1.2** — monorepo / workspace support: default and named catalogs
  (`workspaces.catalog` and `workspaces.catalogs`), workspace-column `bun
  outdated` parsing, and lockfile-aware pending-install hints for
  platform-skipped packages.
- **v2** — quick-fix version bumps and a status-bar summary.

## License

MIT
