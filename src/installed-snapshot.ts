import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type LoadedLockfile, loadLockfileIndex } from "./bun/lockfile";
import type { DepLocation } from "./types";

const MANIFEST_BATCH_SIZE = 32;

export interface InstalledSnapshot {
  installed: Map<string, string | undefined>;
  lockfile?: LoadedLockfile;
}

async function readInstalledVersion(
  cwd: string,
  name: string
): Promise<string | undefined> {
  let dir = cwd;
  for (;;) {
    try {
      const manifest = join(
        dir,
        "node_modules",
        ...name.split("/"),
        "package.json"
      );
      // biome-ignore lint/performance/noAwaitInLoops: a nearer workspace copy must shadow parent copies
      const { version } = JSON.parse(await readFile(manifest, "utf8"));
      return typeof version === "string" ? version : undefined;
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
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

export async function loadInstalledSnapshot(
  cwd: string,
  names: Iterable<string>,
  previousLockfile?: LoadedLockfile
): Promise<InstalledSnapshot> {
  const lockfile = await loadLockfileIndex(cwd, previousLockfile);
  const uniqueNames = [...new Set(names)];
  const installed = new Map<string, string | undefined>();
  // Bound simultaneous reads so a large manifest cannot exhaust file handles.
  for (
    let offset = 0;
    offset < uniqueNames.length;
    offset += MANIFEST_BATCH_SIZE
  ) {
    // biome-ignore lint/performance/noAwaitInLoops: batches bound file handles rather than launching all reads
    await Promise.all(
      uniqueNames
        .slice(offset, offset + MANIFEST_BATCH_SIZE)
        .map(async (name) => {
          installed.set(name, await readInstalledVersion(cwd, name));
        })
    );
  }
  return { installed, lockfile };
}

interface Entry {
  loading?: Promise<InstalledSnapshot | undefined>;
  names: Set<string>;
  refreshAll: boolean;
  reloadingAll: boolean;
  snapshot?: InstalledSnapshot;
}

interface EnsuredSnapshot {
  loading?: Promise<InstalledSnapshot | undefined>;
  snapshot?: InstalledSnapshot;
}

export class InstalledSnapshotCache {
  private readonly entries = new Map<string, Entry>();

  get(cwd: string): InstalledSnapshot | undefined {
    return this.entries.get(cwd)?.snapshot;
  }

  // Warm renders stay memory-only; unknown names load in the background.
  ensure(cwd: string, locations: DepLocation[]): EnsuredSnapshot {
    const entry = this.entryFor(cwd, locations);
    return {
      loading: this.complete(entry) ? undefined : this.start(cwd, entry),
      snapshot: entry.snapshot,
    };
  }

  // Saves, Refresh and periodic revalidation must also reread known names.
  refresh(
    cwd: string,
    locations: DepLocation[]
  ): Promise<InstalledSnapshot | undefined> {
    const entry = this.entryFor(cwd, locations);
    if (!entry.reloadingAll) {
      entry.refreshAll = true;
    }
    return this.start(cwd, entry);
  }

  delete(cwd: string): void {
    this.entries.delete(cwd);
  }

  clear(): void {
    this.entries.clear();
  }

  private entryFor(cwd: string, locations: DepLocation[]): Entry {
    let entry = this.entries.get(cwd);
    if (entry === undefined) {
      entry = { names: new Set(), refreshAll: false, reloadingAll: false };
      this.entries.set(cwd, entry);
    }
    entry.names = new Set(locations.map((location) => location.name));
    const { snapshot } = entry;
    if (
      snapshot !== undefined &&
      [...snapshot.installed.keys()].some((name) => !entry.names.has(name))
    ) {
      entry.snapshot = {
        ...snapshot,
        installed: new Map(
          [...snapshot.installed].filter(([name]) => entry.names.has(name))
        ),
      };
    }
    return entry;
  }

  private complete(entry: Entry): boolean {
    const installed = entry.snapshot?.installed;
    return (
      installed !== undefined &&
      [...entry.names].every((name) => installed.has(name))
    );
  }

  private start(
    cwd: string,
    entry: Entry
  ): Promise<InstalledSnapshot | undefined> {
    entry.loading ??= this.load(cwd, entry).finally(() => {
      entry.loading = undefined;
      entry.reloadingAll = false;
    });
    return entry.loading;
  }

  private async load(
    cwd: string,
    entry: Entry
  ): Promise<InstalledSnapshot | undefined> {
    for (;;) {
      const previous = entry.snapshot;
      const reloadAll = entry.refreshAll || previous === undefined;
      entry.refreshAll = false;
      entry.reloadingAll = reloadAll;
      const names = [...entry.names].filter(
        (name) => reloadAll || !previous?.installed.has(name)
      );
      // biome-ignore lint/performance/noAwaitInLoops: cover new names or a full refresh requested during an incremental read
      const loaded = await loadInstalledSnapshot(
        cwd,
        names,
        previous?.lockfile
      );
      // Eviction must also invalidate work that was already in flight.
      if (this.entries.get(cwd) !== entry) {
        return;
      }
      entry.snapshot = {
        installed: new Map(
          [
            ...(reloadAll ? [] : (previous?.installed ?? [])),
            ...loaded.installed,
          ].filter(([name]) => entry.names.has(name))
        ),
        lockfile: loaded.lockfile,
      };
      if (!entry.refreshAll && this.complete(entry)) {
        return entry.snapshot;
      }
    }
  }
}
