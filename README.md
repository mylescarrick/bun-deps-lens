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

Press <kbd>F5</kbd> to launch the Extension Development Host, then open a
`package.json` in a Bun project.

## How it works

The extension never talks to a registry directly. It runs `bun outdated` and
`bun audit --json` in the package directory (debounced, cached), parses their
output, and renders decorations:

- `bun outdated` has no `--json` flag as of Bun 1.3.x, so its pipe-delimited
  table (`Package | Current | Update | Latest`, with `(dev)` markers) is
  parsed directly.
- `bun audit --json` returns advisories keyed by package name; presence means
  the installed version is vulnerable.

The registry analysis runs on save, on a background interval, and via the
refresh command. Editing re-renders instantly from cached data — the
pending-install hint is computed locally by comparing the edited range against
the version in `node_modules` (via `semver`), with no network call. A watcher
on `bun.lock` triggers a fresh analysis once an install completes.

## Roadmap

- **v1.1** — `bunfig.toml` `minimumReleaseAge` cooldown awareness + tooltips,
  gutter dots.
- **v1.2** — monorepo / workspace support and `catalog:` resolution.
- **v2** — quick-fix version bumps and a status-bar summary.

## License

MIT
