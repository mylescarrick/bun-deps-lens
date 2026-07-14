import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { satisfies, validRange } from "semver";
import {
  findLockfile,
  type LockfileIndex,
  loadLockfileIndex,
} from "./bun/lockfile";
import type { DepLocation, HoistConflict } from "./types";

const CATALOG_SECTIONS = new Set<string>([
  "workspaces.catalog",
  "workspaces.catalogs",
]);

export interface Pending {
  declared: string;
  installed?: string;
}

export interface Annotations {
  conflicts: Map<string, HoistConflict>;
  pending: Map<string, Pending>;
  unusedCatalogs: Set<string>;
}

export type ResolvedVersions = Map<string, string[]>;

// True when the declared range is a real semver range that the installed
// version doesn't satisfy — i.e. the user changed the range (or added a dep)
// and hasn't run `bun i` yet. Non-semver specifiers (catalog:, workspace:,
// latest, git/file URLs) are ignored.
export function isPending(
  name: string,
  declaredRange: string,
  installed?: string,
  lockfileRoot?: string
): boolean {
  const range = declaredRange.trim();
  if (range.includes(":") || range === "" || validRange(range) === null) {
    return false;
  }
  if (installed === undefined) {
    // If the exact specifier is already resolved by bun (present in the
    // lockfile) but not on disk, the install has already been applied — the
    // package is most likely platform- or optionality-skipped. Don't nag.
    if (lockfileRoot !== undefined && isResolved(lockfileRoot, name, range)) {
      return false;
    }
    return true;
  }
  return !satisfies(installed, range, { includePrerelease: true });
}

function isResolved(lockfileRoot: string, name: string, spec: string): boolean {
  const lockfile = findLockfile(lockfileRoot);
  if (lockfile === null || lockfile.endsWith(".lockb")) {
    // Binary lockfiles can't be cheaply inspected here; fall back to the
    // installed check and let bun outdated/audit surface real misses.
    return false;
  }
  try {
    const text = readFileSync(lockfile, "utf8");
    // Package entries carry the descriptor "<name>@<version>"; finding the
    // package@spec literal tells us bun has resolved this dependency.
    return text.includes(`${name}@${spec}`);
  } catch {
    return false;
  }
}

// Walks up from `cwd` looking for node_modules/<name>/package.json so it works
// in both single-package repos and hoisted workspaces.
export function readInstalledVersion(
  cwd: string,
  name: string
): string | undefined {
  let dir = cwd;
  for (;;) {
    const manifest = join(
      dir,
      "node_modules",
      ...name.split("/"),
      "package.json"
    );
    if (existsSync(manifest)) {
      try {
        const { version } = JSON.parse(readFileSync(manifest, "utf8"));
        return typeof version === "string" ? version : undefined;
      } catch {
        return;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return;
    }
    dir = parent;
  }
}

type CatalogState =
  | { conflict?: HoistConflict; kind: "applied" }
  | { kind: "pending" }
  | { kind: "unused" };

// Catalog entries are declarations, not direct dependencies of the package
// they sit in, so the hoisted node_modules copy is the wrong signal. Classify
// them against the lockfile's actual resolution instead.
function classifyCatalogEntry(
  name: string,
  declaredRange: string,
  index: LockfileIndex,
  installed?: string
): CatalogState {
  const range = declaredRange.trim();
  if (range === "" || range.includes(":") || validRange(range) === null) {
    return { kind: "applied" };
  }
  // No workspace references this catalog entry — it installs nothing, so it's
  // neither pending nor a problem, just unused.
  if (index.catalogConsumers(name).length === 0) {
    return { kind: "unused" };
  }
  const satisfied = index
    .resolvedVersions(name)
    .some((version) => satisfies(version, range, { includePrerelease: true }));
  if (!satisfied) {
    return { kind: "pending" };
  }
  // Catalog is resolved. If the hoisted root copy is a different version, some
  // workspace pins it directly and that copy shadows the catalog at the root.
  if (
    installed !== undefined &&
    !satisfies(installed, range, { includePrerelease: true })
  ) {
    const dependents = index
      .directDependents(name)
      .filter((dependent) => versionMatches(installed, dependent.spec));
    return { conflict: { dependents, hoisted: installed }, kind: "applied" };
  }
  return { kind: "applied" };
}

function versionMatches(version: string, spec: string): boolean {
  if (version === spec) {
    return true;
  }
  return (
    validRange(spec) !== null &&
    satisfies(version, spec, { includePrerelease: true })
  );
}

function mergeVersion(
  versionsByName: ResolvedVersions,
  name: string,
  versions: string[]
): void {
  if (versions.length === 0) {
    return;
  }
  const existing = versionsByName.get(name) ?? [];
  versionsByName.set(name, [...new Set([...existing, ...versions])]);
}

function isCatalogSection(location: DepLocation): boolean {
  return CATALOG_SECTIONS.has(location.section);
}

function resolvedCatalogVersions(
  location: DepLocation,
  index: LockfileIndex
): string[] {
  const range = location.declaredRange.trim();
  const topLevel = index.topLevelResolvedVersion(location.name);
  if (topLevel !== undefined && versionMatches(topLevel, range)) {
    return [topLevel];
  }
  if (range === "" || range.includes(":") || validRange(range) === null) {
    return topLevel === undefined ? [] : [topLevel];
  }
  return index
    .resolvedVersions(location.name)
    .filter((version) =>
      satisfies(version, range, { includePrerelease: true })
    );
}

function resolvedDependencyVersions(
  cwd: string,
  location: DepLocation,
  index?: LockfileIndex
): string[] {
  const installed = readInstalledVersion(cwd, location.name);
  if (installed !== undefined) {
    return [installed];
  }
  const topLevel = index?.topLevelResolvedVersion(location.name);
  if (topLevel !== undefined) {
    return [topLevel];
  }
  return [];
}

export function computeResolvedVersions(
  cwd: string,
  locations: DepLocation[]
): ResolvedVersions {
  const loaded = loadLockfileIndex(cwd);
  const versionsByName: ResolvedVersions = new Map();
  for (const location of locations) {
    if (isCatalogSection(location)) {
      if (loaded !== undefined) {
        mergeVersion(
          versionsByName,
          location.name,
          resolvedCatalogVersions(location, loaded.index)
        );
      }
      continue;
    }
    mergeVersion(
      versionsByName,
      location.name,
      resolvedDependencyVersions(cwd, location, loaded?.index)
    );
  }
  return versionsByName;
}

export function computeAnnotations(
  cwd: string,
  locations: DepLocation[]
): Annotations {
  const loaded = loadLockfileIndex(cwd);
  const pending = new Map<string, Pending>();
  const conflicts = new Map<string, HoistConflict>();
  const unusedCatalogs = new Set<string>();

  for (const location of locations) {
    const installed = readInstalledVersion(cwd, location.name);

    if (isCatalogSection(location)) {
      if (loaded === undefined) {
        continue;
      }
      const state = classifyCatalogEntry(
        location.name,
        location.declaredRange,
        loaded.index,
        installed
      );
      if (state.kind === "pending") {
        pending.set(location.name, {
          declared: location.declaredRange,
          installed,
        });
      } else if (state.kind === "unused") {
        unusedCatalogs.add(location.name);
      } else if (state.conflict !== undefined) {
        conflicts.set(location.name, state.conflict);
      }
      continue;
    }

    if (
      isPending(location.name, location.declaredRange, installed, loaded?.root)
    ) {
      pending.set(location.name, {
        declared: location.declaredRange,
        installed,
      });
    }
  }

  return { conflicts, pending, unusedCatalogs };
}
