import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { satisfies, validRange } from "semver";
import type { DepLocation } from "./types";

const LOCKFILE_NAMES = ["bun.lock", "bun.lockb"] as const;

export interface Pending {
  declared: string;
  installed?: string;
}

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
  if (lockfile === null) {
    return false;
  }
  if (lockfile.endsWith(".lockb")) {
    // Binary lockfiles can't be cheaply inspected here; fall back to the
    // installed check and let bun outdated/audit surface real misses.
    return false;
  }
  try {
    const text = readFileSync(lockfile, "utf8");
    // Text-format bun.lock headers look like "# <name>@<version>" and package
    // entries look like "<name>": ["<name>@<version>", ...]. Searching for the
    // package@spec literal tells us bun has resolved this dependency.
    return text.includes(`${name}@${spec}`);
  } catch {
    return false;
  }
}

function findLockfile(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    for (const name of LOCKFILE_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
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

export function computePending(
  cwd: string,
  locations: DepLocation[]
): Map<string, Pending> {
  const lockfileRoot = findLockfileRoot(cwd);
  const pending = new Map<string, Pending>();
  for (const location of locations) {
    const installed = readInstalledVersion(cwd, location.name);
    if (
      isPending(location.name, location.declaredRange, installed, lockfileRoot)
    ) {
      pending.set(location.name, {
        declared: location.declaredRange,
        installed,
      });
    }
  }
  return pending;
}

function findLockfileRoot(startDir: string): string | undefined {
  const lockfile = findLockfile(startDir);
  if (lockfile === null) {
    return;
  }
  return dirname(lockfile);
}
