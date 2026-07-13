# Fixtures

Small, real Bun projects used for manual end-to-end testing of the extension.

## Setup

Install dependencies for every fixture:

```sh
bun run setup:fixtures
```

Or install each one manually:

```sh
cd fixtures/monorepo-catalog && bun install
cd ../simple-single && bun install
```

## Scenarios

### `monorepo-catalog/`

A root `package.json` with a `workspaces.catalog`, a named `workspaces.catalogs`,
and a workspace under `packages/app`.

Intended to exercise:

- catalog entry decoration (`workspaces.catalog` and `workspaces.catalogs`)
- `catalog:` references in `devDependencies`
- the extra `Workspace` column emitted by `bun outdated` in workspace projects
- outdated version detection in both root and workspace `package.json` (pinned old versions of `ts-morph`, `lodash`, etc.)
- platform-skipped pending-install logic (`@esbuild/linux-arm64` on macOS)

### `simple-single/`

A plain single-package repo with no workspaces.

Intended to exercise basic outdated detection on the simplest possible layout.

## Editing fixtures

Bun resolves the workspace graph from `bun.lock`. If you edit a fixture
`package.json` (add a dependency, change a catalog reference, etc.), run:

```sh
bun run setup:fixtures
```

until the lockfile reflects your change. The extension reads the lockfile
through `bun outdated`, so stale lockfiles will look like stale data.

## Maintenance

The installed versions are intentionally old so `bun outdated` always has
something to report. The "latest" values come from the registry at runtime, so
there is no need to bump them unless you want to target a newer range.
