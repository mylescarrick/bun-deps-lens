import { satisfies, validRange } from "semver";
import type { LockfileIndex } from "./bun/lockfile";
import { catalogReferenceFromDeclaredRange } from "./catalog-link";
import type { InstalledSnapshot } from "./installed-snapshot";
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
  /** Number of workspaces consuming each catalog-backed dependency via
   * `catalog:`/`catalog:<name>`, keyed by package name. Only populated for
   * consumer-side entries, not the catalog definitions themselves. */
  catalogConsumerCounts: Map<string, number>;
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
  index?: LockfileIndex
): boolean {
  const range = declaredRange.trim();
  if (range.includes(":") || range === "" || validRange(range) === null) {
    return false;
  }
  if (installed === undefined) {
    // If the exact specifier is already resolved by bun (present in the
    // lockfile) but not on disk, the install has already been applied — the
    // package is most likely platform- or optionality-skipped. Don't nag.
    if (index?.hasResolvedSpecifier(name, range)) {
      return false;
    }
    return true;
  }
  return !satisfies(installed, range, { includePrerelease: true });
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
  snapshot: InstalledSnapshot,
  location: DepLocation
): string[] {
  const installed = snapshot.installed.get(location.name);
  if (installed !== undefined) {
    return [installed];
  }
  const topLevel = snapshot.lockfile?.index.topLevelResolvedVersion(
    location.name
  );
  if (topLevel !== undefined) {
    return [topLevel];
  }
  return [];
}

export function computeResolvedVersions(
  snapshot: InstalledSnapshot,
  locations: DepLocation[]
): ResolvedVersions {
  const loaded = snapshot.lockfile;
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
      resolvedDependencyVersions(snapshot, location)
    );
  }
  return versionsByName;
}

export function computeAnnotations(
  snapshot: InstalledSnapshot,
  locations: DepLocation[]
): Annotations {
  const loaded = snapshot.lockfile;
  const pending = new Map<string, Pending>();
  const conflicts = new Map<string, HoistConflict>();
  const unusedCatalogs = new Set<string>();
  const catalogConsumerCounts = new Map<string, number>();

  // Newly typed names remain unknown until their asynchronous reads complete.
  const knownLocations = locations.filter((location) =>
    snapshot.installed.has(location.name)
  );
  for (const location of knownLocations) {
    const installed = snapshot.installed.get(location.name);

    if (
      loaded !== undefined &&
      !isCatalogSection(location) &&
      catalogReferenceFromDeclaredRange(
        location.name,
        location.declaredRange
      ) !== undefined
    ) {
      catalogConsumerCounts.set(
        location.name,
        loaded.index.catalogConsumers(location.name).length
      );
    }

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
      isPending(location.name, location.declaredRange, installed, loaded?.index)
    ) {
      pending.set(location.name, {
        declared: location.declaredRange,
        installed,
      });
    }
  }

  return { catalogConsumerCounts, conflicts, pending, unusedCatalogs };
}
