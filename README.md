# Bun Deps Lens

A Bun-only VS Code extension that annotates `package.json` with inline,
colour-coded dependency status, powered entirely by the `bun` CLI already on
your `PATH` — no bundled network client.

- 🟢 **Green** — on the latest published version.
- 🟠 **Amber** — outdated, with a faint `current → latest` hint after the line.
- 🔴 **Red** — a vulnerability at or above your configured severity threshold
  (`bun audit`), regardless of how out of date it is.

Hover any dependency for a tooltip with the version transition and advisory
details.

## Requirements

- [Bun](https://bun.com) `>= 1.2.0` on `PATH` (`bun audit --json` and the
  `bun outdated` table are used under the hood).
- The extension stays dormant unless the workspace looks like a Bun project
  (`bun.lock`, `bun.lockb`, or `bunfig.toml`).

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `bunDepsLens.enable` | `true` | Master toggle |
| `bunDepsLens.refreshIntervalMinutes` | `15` | Background re-check cadence (0 disables) |
| `bunDepsLens.severityThreshold` | `"high"` | Minimum audit severity that colours a dep red |
| `bunDepsLens.showInlineVersions` | `true` | Toggle the faint `current → latest` text |
| `bunDepsLens.respectMinimumReleaseAge` | `true` | Reserved for `minimumReleaseAge` support (v1.1) |

Run **Bun Deps Lens: Refresh** from the command palette to re-analyse on demand.

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

The extension never talks to a registry directly. On open/save (debounced) it
runs `bun outdated` and `bun audit --json` in the package directory, parses
their output, and renders decorations:

- `bun outdated` has no `--json` flag as of Bun 1.3.x, so its pipe-delimited
  table (`Package | Current | Update | Latest`, with `(dev)` markers) is
  parsed directly.
- `bun audit --json` returns advisories keyed by package name; presence means
  the installed version is vulnerable.

## Roadmap

- **v1.1** — `bunfig.toml` `minimumReleaseAge` cooldown awareness + tooltips,
  gutter dots.
- **v1.2** — monorepo / workspace support and `catalog:` resolution.
- **v2** — quick-fix version bumps and a status-bar summary.

## License

MIT
