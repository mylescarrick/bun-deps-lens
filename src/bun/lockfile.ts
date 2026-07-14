import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const LOCKFILE_NAMES = ["bun.lock", "bun.lockb"] as const;

const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

export interface DirectDependent {
  spec: string;
  workspace: string;
}

export interface LockfileIndex {
  catalogConsumers: (name: string) => string[];
  directDependents: (name: string) => DirectDependent[];
  resolvedVersions: (name: string) => string[];
}

interface RawWorkspace {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface RawLockfile {
  packages?: Record<string, unknown[]>;
  workspaces?: Record<string, RawWorkspace>;
}

export function findLockfile(startDir: string): string | null {
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

// bun.lock is JSON with trailing commas (no comments in the lockfileVersion 1
// format). Drop the trailing commas — while respecting string literals — so
// JSON.parse accepts it.
interface ScanState {
  escaped: boolean;
  inString: boolean;
}

function stripTrailingCommas(text: string): string {
  const chars: string[] = [];
  const state: ScanState = { escaped: false, inString: false };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (state.inString) {
      chars.push(ch);
      advanceString(state, ch);
      continue;
    }
    if (ch === '"') {
      state.inString = true;
    } else if (ch === "," && isTrailingComma(text, i)) {
      continue;
    }
    chars.push(ch);
  }
  return chars.join("");
}

function advanceString(state: ScanState, ch: string): void {
  if (state.escaped) {
    state.escaped = false;
  } else if (ch === "\\") {
    state.escaped = true;
  } else if (ch === '"') {
    state.inString = false;
  }
}

function isTrailingComma(text: string, commaIndex: number): boolean {
  let j = commaIndex + 1;
  while (j < text.length && isWhitespace(text[j] as string)) {
    j += 1;
  }
  return text[j] === "}" || text[j] === "]";
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
}

// A package descriptor is "<name>@<version>" where <name> may itself start with
// "@" (scoped). The version is everything after the last "@".
function descriptorName(descriptor: string): string | undefined {
  const at = descriptor.lastIndexOf("@");
  return at <= 0 ? undefined : descriptor.slice(0, at);
}

function descriptorVersion(descriptor: string): string | undefined {
  const at = descriptor.lastIndexOf("@");
  if (at <= 0) {
    return;
  }
  const version = descriptor.slice(at + 1);
  // Skip workspace:/link:/file:/npm: descriptors — not real resolved versions.
  return version.includes(":") ? undefined : version;
}

function addTo(
  map: Map<string, Set<string>>,
  key: string,
  value: string
): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

function indexPackages(
  raw: RawLockfile,
  resolved: Map<string, Set<string>>
): void {
  for (const entry of Object.values(raw.packages ?? {})) {
    const descriptor = Array.isArray(entry) ? entry[0] : undefined;
    if (typeof descriptor !== "string") {
      continue;
    }
    const name = descriptorName(descriptor);
    const version = descriptorVersion(descriptor);
    if (name !== undefined && version !== undefined) {
      addTo(resolved, name, version);
    }
  }
}

function indexWorkspaceDeps(
  workspace: string,
  deps: Record<string, string>,
  consumers: Map<string, Set<string>>,
  directs: Map<string, DirectDependent[]>
): void {
  for (const [name, spec] of Object.entries(deps)) {
    if (spec.startsWith("catalog:")) {
      addTo(consumers, name, workspace);
    } else if (!spec.includes(":")) {
      const list = directs.get(name) ?? [];
      list.push({ spec, workspace });
      directs.set(name, list);
    }
  }
}

function indexWorkspaces(
  raw: RawLockfile,
  consumers: Map<string, Set<string>>,
  directs: Map<string, DirectDependent[]>
): void {
  for (const [workspace, ws] of Object.entries(raw.workspaces ?? {})) {
    for (const section of DEP_SECTIONS) {
      const deps = ws[section];
      if (deps !== undefined) {
        indexWorkspaceDeps(workspace, deps, consumers, directs);
      }
    }
  }
}

export function parseLockfile(text: string): LockfileIndex {
  let raw: RawLockfile;
  try {
    raw = JSON.parse(stripTrailingCommas(text)) as RawLockfile;
  } catch {
    return emptyIndex();
  }

  const resolved = new Map<string, Set<string>>();
  const consumers = new Map<string, Set<string>>();
  const directs = new Map<string, DirectDependent[]>();

  indexPackages(raw, resolved);
  indexWorkspaces(raw, consumers, directs);

  return {
    catalogConsumers: (name) => [...(consumers.get(name) ?? [])],
    directDependents: (name) => directs.get(name) ?? [],
    resolvedVersions: (name) => [...(resolved.get(name) ?? [])],
  };
}

function emptyIndex(): LockfileIndex {
  return {
    catalogConsumers: () => [],
    directDependents: () => [],
    resolvedVersions: () => [],
  };
}

interface LoadedLockfile {
  index: LockfileIndex;
  root: string;
}

interface CacheEntry extends LoadedLockfile {
  mtimeMs: number;
}

const cache = new Map<string, CacheEntry>();

// Parses the nearest text-format bun.lock, cached by mtime so it only re-parses
// after an install rewrites the lockfile.
export function loadLockfileIndex(
  startDir: string
): LoadedLockfile | undefined {
  const lockfile = findLockfile(startDir);
  if (lockfile === null || lockfile.endsWith(".lockb")) {
    return;
  }
  let mtimeMs: number;
  try {
    ({ mtimeMs } = statSync(lockfile));
  } catch {
    return;
  }
  const cached = cache.get(lockfile);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) {
    const { index: cachedIndex, root: cachedRoot } = cached;
    return { index: cachedIndex, root: cachedRoot };
  }
  let index: LockfileIndex;
  try {
    index = parseLockfile(readFileSync(lockfile, "utf8"));
  } catch {
    return;
  }
  const root = dirname(lockfile);
  cache.set(lockfile, { index, mtimeMs, root });
  return { index, root };
}
