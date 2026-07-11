import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { satisfies, validRange } from "semver";
import type { DepLocation } from "./types";

export interface Pending {
  declared: string;
  installed?: string;
}

// True when the declared range is a real semver range that the installed
// version doesn't satisfy — i.e. the user changed the range (or added a dep)
// and hasn't run `bun i` yet. Non-semver specifiers (catalog:, workspace:,
// latest, git/file URLs) are ignored.
export function isPending(declaredRange: string, installed?: string): boolean {
  const range = declaredRange.trim();
  if (range.includes(":") || range === "" || validRange(range) === null) {
    return false;
  }
  if (installed === undefined) {
    return true;
  }
  return !satisfies(installed, range, { includePrerelease: true });
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
  const pending = new Map<string, Pending>();
  for (const location of locations) {
    const installed = readInstalledVersion(cwd, location.name);
    if (isPending(location.declaredRange, installed)) {
      pending.set(location.name, {
        declared: location.declaredRange,
        installed,
      });
    }
  }
  return pending;
}
