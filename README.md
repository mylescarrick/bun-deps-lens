# Bun Deps

A Bun-focused VS Code extension for managing package dependencies - even in 
workspaces/monorepos (with catalog deps). Bun Deps annotates `package.json`
with inline, colour-coded dependency status — and lets you act on it without 
leaving the file — powered entirely by the `bun` CLI already on your `PATH`. 
No bundled network client. Respects your `bunfig.toml` `minimumReleaseAge`.

## Status at a glance

The version string itself is coloured, and outdated/vulnerable dependencies get
a short inline status message after the line:

- 🟢 **Green** — on the latest published version (no inline message; the green
  value says it all).
- 🟠 **Amber** — outdated: `● current → latest`.
- 🔴 **Red** — a vulnerability at or above your configured severity threshold
  (`bun audit`), regardless of how out of date it is: `● <severity> vuln ·
  current → latest`.

The annotation sits after the trailing comma (if there is one), so it reads as
a note on the whole line rather than crowding the value: `"linkedom":
"^0.18.12", 0.18.12 → 0.18.13,`. Hover either the coloured value or the
annotation for a tooltip (headed **Bun Deps**, to distinguish it from VS
Code's built-in package.json hover) with the version transition and advisory
details.

## Update in place

Since 0.4.0, outdated dependencies aren't just labelled — they're one action away from fixed, in three equivalent ways:

- **Quick fix** — put the cursor on the line and press <kbd>⌘.</kbd> /
  <kbd>Ctrl+.</kbd> for "Update `<name>` to `<version>`".
- **Hover link** — click "⬆ Update to `<version>`" inside the tooltip.
- **Inlay hint** — click the small "↑ update" that appears after the
  annotation.

All three apply the identical edit: the declared range is rewritten to the
latest published version, keeping whatever qualifier you wrote (`^`, `~`, `=`,
or none) — `^0.18.12` becomes `^0.18.13`. Compound or partial ranges
(`^1 || ^2`, `>=1.2.3`, `^1.2`) and non-semver specifiers (`catalog:`,
`workspace:`, git/file URLs, `*`, `latest`) are left alone rather than guessed
at. Updates auto-save a clean manifest, or a dirty buffer containing only known
Bun Deps edits. Pre-existing unsaved edits, or other edits made during the update,
are left unsaved with explicit save-first guidance. Related updates are applied
in order, and stale actions cannot overwrite a different dependency.

Nothing runs `bun i` for you. Save any remaining edits, then install to clear the
pending-install hint.

## Monorepo catalogs

- **Go to catalog definition** — <kbd>⌘-click</kbd> (or <kbd>Ctrl-click</kbd>,
  or F12) the word `catalog` in a consumer entry (`"react": "catalog:"`,
  `"esbuild": "catalog:build"`) to jump straight to its declaration in the
  root `package.json`, even from a nested workspace package. Works with both
  the default catalog and named catalogs (`workspaces.catalogs.<name>`).
- **Catalog-aware update guidance** — catalog-backed lines don't get an
  update-in-place action, since bumping them would change the version for
  every workspace that consumes them. Instead the tooltip reports how many
  workspaces are affected and links straight to the catalog definition, e.g.
  *"Cmd+click/Ctrl+click 'catalog' to upgrade (affects 4 workspaces)"*.
- **Catalog-aware hints** — `workspaces.catalog` and named catalog entries are
  checked against `bun.lock` (not the hoisted `node_modules` copy), so unused
  catalog entries are shown as `○ unused catalog entry` instead of a false
  install nag. If a workspace pins a different version directly and that copy
  is hoisted to the root, the inline note names the workspace responsible,
  e.g. `⚠ hoisted 4.20251125.0 via packages/tools`.

## Other behaviours

- **Live updates** — annotations refresh as you edit `package.json`, not just on
  save.
- **Pending-install hint** — if you change a version range to something that
  isn't installed yet, the value turns amber with `● run bun i to apply`.
  Unsaved changes say `● save package.json, then run bun i to apply` instead.
  Saving clears the save-first wording locally; installing clears the pending hint.

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
bun test             # unit tests for parsers, snapshots & status logic
bun run test:extension # Node lifecycle and editor-feedback checks with adapters
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
refresh command. Editing re-renders from cached data with no network call or
synchronous filesystem access. Dependency locations are parsed once per document
version and shared by decorations, quick fixes, inlay hints and catalog navigation.

Installed manifests and the nearest `bun.lock` index are loaded asynchronously
into a snapshot per package directory, preserving workspace-local overrides.
Standard package ranges are compared against those installed versions via `semver`;
catalog declarations use the lockfile index so hoisted copies do not create false
"run `bun i`" hints. Platform-skipped dependencies reuse the cached lockfile text
instead of rereading it for each dependency. Newly typed package names stay
unclassified until their asynchronous install check completes.

Snapshots refresh on analysis and explicit Refresh, on lockfile creation/change/
deletion, and asynchronously every **30 seconds** while a dependency-bearing
`package.json` is visible. This local revalidation detects installs that do not
rewrite the lockfile and still runs when registry background refresh is set to 0.
It does not make registry requests. Unchanged lockfile indexes are reused, and
closing documents or removing workspaces releases their cached data.

## Roadmap

- We've shipped pretty much all I can think of - feel free to post any issues.
- **v1** — when it's been stable for a couple of months I'll tag it `1.0`.
- **v2** — a status-bar summary, and bulk "update all outdated" across a
  `package.json`.

## License

MIT
