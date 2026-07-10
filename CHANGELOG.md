# Changelog

## [0.1.0] - Unreleased

Initial release (v1 MVP).

- Colour-coded status on each `package.json` dependency: green (latest), amber
  (outdated), red (vulnerability at or above the configured severity).
- Faint `current → latest` inline hint on outdated dependencies.
- Hover tooltips with the version transition and `bun audit` advisory details.
- Powered entirely by the local `bun` CLI (`bun outdated` + `bun audit --json`).
- Activates only in Bun projects (`bun.lock`, `bun.lockb`, or `bunfig.toml`).
- Settings for enable, refresh cadence, severity threshold, and inline text.
- **Bun Deps Lens: Refresh** command.
