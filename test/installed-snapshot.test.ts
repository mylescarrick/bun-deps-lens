import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { computeAnnotations, computeResolvedVersions } from "../src/installed";
import {
  InstalledSnapshotCache,
  loadInstalledSnapshot,
} from "../src/installed-snapshot";
import { findDependencyLocations } from "../src/package-json";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "bun-deps-snapshot-"));
  roots.push(root);
  return root;
}

function install(cwd: string, name: string, version: string): void {
  const manifest = join(cwd, "node_modules", name, "package.json");
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, JSON.stringify({ name, version }));
}

function gate() {
  let release: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release: () => release(), wait };
}

function locations(range = "1.0.0") {
  return findDependencyLocations(
    JSON.stringify({ dependencies: { foo: range } })
  );
}

describe("InstalledSnapshotCache", () => {
  test("warm edits compare ranges against cached installation data", async () => {
    const root = project();
    install(root, "foo", "1.0.0");
    const cache = new InstalledSnapshotCache();
    await cache.refresh(root, locations());
    const snapshot = cache.get(root);
    if (snapshot === undefined) {
      throw new Error("expected installed snapshot");
    }
    rmSync(root, { recursive: true });
    expect(computeAnnotations(snapshot, locations()).pending.size).toBe(0);
    expect(
      computeAnnotations(snapshot, locations("2.0.0")).pending.get("foo")
    ).toEqual({ declared: "2.0.0", installed: "1.0.0" });
  });
});

test("ensuring a new name reads only its manifest and keeps known versions until revalidation", async () => {
  const root = project();
  install(root, "foo", "1.0.0");
  install(root, "bar", "2.0.0");
  const cache = new InstalledSnapshotCache();
  const reads = spyOn(fsPromises, "readFile");
  try {
    await cache.refresh(root, locations());
    expect(reads.mock.calls.map(([file]) => file)).toEqual([
      join(root, "node_modules", "foo", "package.json"),
    ]);
    reads.mockClear();
    install(root, "foo", "3.0.0");
    const deps = findDependencyLocations(
      '{"dependencies":{"foo":"1.0.0","bar":"2.0.0"}}'
    );
    const { snapshot, loading } = cache.ensure(root, deps);
    expect(snapshot?.installed.get("foo")).toBe("1.0.0");
    expect(snapshot?.installed.has("bar")).toBe(false);
    expect(loading).toBeDefined();
    const complete = await loading;
    expect(complete?.installed.get("foo")).toBe("1.0.0");
    expect(complete?.installed.get("bar")).toBe("2.0.0");
    expect(reads.mock.calls.map(([file]) => file)).toEqual([
      join(root, "node_modules", "bar", "package.json"),
    ]);
    reads.mockClear();
    expect(cache.ensure(root, deps).loading).toBeUndefined();
    expect(reads).not.toHaveBeenCalled();
    expect((await cache.refresh(root, deps))?.installed.get("foo")).toBe(
      "3.0.0"
    );
  } finally {
    reads.mockRestore();
  }
});

test("a rename sequence keeps only the latest names, including during an in-flight load", async () => {
  const root = project();
  install(root, "foo", "1.0.0");
  install(root, "bar", "2.0.0");
  const cache = new InstalledSnapshotCache();
  await cache.refresh(root, locations());
  const first = cache.ensure(
    root,
    findDependencyLocations('{"dependencies":{"f":"1.0.0"}}')
  ).loading;
  cache.ensure(
    root,
    findDependencyLocations('{"dependencies":{"fo":"1.0.0"}}')
  );
  const finalNames = findDependencyLocations(
    '{"dependencies":{"bar":"2.0.0"}}'
  );
  const last = cache.ensure(root, finalNames).loading;
  expect(last).toBe(first);
  expect([...((await last)?.installed.keys() ?? [])]).toEqual(["bar"]);
  const reads = spyOn(fsPromises, "readFile");
  try {
    await cache.refresh(root, finalNames);
    expect(reads.mock.calls.map(([file]) => file)).toEqual([
      join(root, "node_modules", "bar", "package.json"),
    ]);
    reads.mockClear();
    const empty = cache.ensure(root, []);
    expect(empty.snapshot?.installed.size).toBe(0);
    expect(empty.loading).toBeUndefined();
    expect(reads).not.toHaveBeenCalled();
  } finally {
    reads.mockRestore();
  }
});

test("a full refresh during an incremental read also revalidates known names", async () => {
  const root = project();
  install(root, "foo", "1.0.0");
  install(root, "bar", "2.0.0");
  const cache = new InstalledSnapshotCache();
  await cache.refresh(root, locations());
  const started = gate();
  const resume = gate();
  const { readFile } = fsPromises;
  let held = false;
  const reads = spyOn(fsPromises, "readFile").mockImplementation(
    new Proxy(readFile, {
      async apply(target, receiver, args) {
        if (
          String(args[0]) ===
            join(root, "node_modules", "bar", "package.json") &&
          !held
        ) {
          held = true;
          started.release();
          await resume.wait;
        }
        return Reflect.apply(target, receiver, args);
      },
    })
  );
  const deps = findDependencyLocations(
    '{"dependencies":{"foo":"1.0.0","bar":"2.0.0"}}'
  );
  const { loading } = cache.ensure(root, deps);
  try {
    await started.wait;
    install(root, "foo", "3.0.0");
    install(root, "bar", "4.0.0");
    const refresh = cache.refresh(root, deps);
    expect(loading).toBe(refresh);
    resume.release();
    const snapshot = await refresh;
    expect(snapshot?.installed.get("foo")).toBe("3.0.0");
    expect(snapshot?.installed.get("bar")).toBe("4.0.0");
    expect(
      reads.mock.calls.filter(([file]) => String(file).includes("/foo/")).length
    ).toBe(1);
    expect(
      reads.mock.calls.filter(([file]) => String(file).includes("/bar/")).length
    ).toBe(2);
  } finally {
    resume.release();
    await loading;
    reads.mockRestore();
  }
});

test("overlapping full refreshes share one manifest read", async () => {
  const root = project();
  install(root, "foo", "1.0.0");
  const cache = new InstalledSnapshotCache();
  const started = gate();
  const resume = gate();
  const { readFile } = fsPromises;
  const reads = spyOn(fsPromises, "readFile").mockImplementation(
    new Proxy(readFile, {
      async apply(target, receiver, args) {
        started.release();
        await resume.wait;
        return Reflect.apply(target, receiver, args);
      },
    })
  );
  const loading = cache.refresh(root, locations());
  try {
    await started.wait;
    const joined = cache.refresh(root, locations());
    expect(joined).toBe(loading);
    resume.release();
    expect((await joined)?.installed.get("foo")).toBe("1.0.0");
    expect(reads).toHaveBeenCalledTimes(1);
  } finally {
    resume.release();
    await loading;
    reads.mockRestore();
  }
});

test("revalidation notices an install without a lockfile rewrite", async () => {
  const root = project();
  install(root, "foo", "1.0.0");
  const cache = new InstalledSnapshotCache();
  await cache.refresh(root, locations());
  install(root, "foo", "2.0.0");
  const snapshot = await cache.refresh(root, locations("2.0.0"));
  if (snapshot === undefined) {
    throw new Error("expected refreshed snapshot");
  }
  expect(computeAnnotations(snapshot, locations("2.0.0")).pending.size).toBe(0);
  expect(computeResolvedVersions(snapshot, locations())).toEqual(
    new Map([["foo", ["2.0.0"]]])
  );
});

test("optional resolution is local, literal and invalidated on lockfile deletion", async () => {
  const root = project();
  writeFileSync(
    join(root, "bun.lock"),
    JSON.stringify({ packages: { foo: ["foo@1.0.0"] } })
  );
  const cache = new InstalledSnapshotCache();
  const snapshot = await cache.refresh(root, locations());
  if (snapshot === undefined) {
    throw new Error("expected snapshot");
  }
  expect(computeAnnotations(snapshot, locations()).pending.size).toBe(0);
  expect(
    computeAnnotations(snapshot, locations("^1.0.0")).pending.has("foo")
  ).toBe(true);
  rmSync(join(root, "bun.lock"));
  const refreshed = await cache.refresh(root, locations());
  if (refreshed === undefined) {
    throw new Error("expected refreshed snapshot");
  }
  expect(refreshed.lockfile).toBeUndefined();
  expect(computeAnnotations(refreshed, locations()).pending.has("foo")).toBe(
    true
  );
});

test("a replacement lockfile is noticed even if its mtime is restored", async () => {
  const root = project();
  const lockfile = join(root, "bun.lock");
  writeFileSync(lockfile, JSON.stringify({ packages: { foo: ["foo@1.0.0"] } }));
  const oldTime = statSync(lockfile).mtime;
  const first = await loadInstalledSnapshot(root, ["foo"]);
  writeFileSync(
    lockfile,
    JSON.stringify({ packages: { foo: ["foo@22.0.0"] } })
  );
  utimesSync(lockfile, oldTime, oldTime);
  const second = await loadInstalledSnapshot(root, ["foo"], first.lockfile);
  expect(second.lockfile?.index.resolvedVersions("foo")).toEqual(["22.0.0"]);
});

test("unchanged lockfile indexes are reused during manifest revalidation", async () => {
  const root = project();
  writeFileSync(join(root, "bun.lock"), JSON.stringify({ packages: {} }));
  const first = await loadInstalledSnapshot(root, ["foo"]);
  const second = await loadInstalledSnapshot(root, ["foo"], first.lockfile);
  expect(second.lockfile).toBe(first.lockfile);
});

test("workspace-local copies override hoisted versions without leaking across caches", async () => {
  const root = project();
  const child = join(root, "packages", "app");
  install(root, "foo", "1.0.0");
  install(child, "foo", "2.0.0");
  install(root, "bar", "3.0.0");
  const deps = findDependencyLocations(
    '{"dependencies":{"foo":"2.0.0","bar":"3.0.0"}}'
  );
  const cache = new InstalledSnapshotCache();
  const local = await cache.refresh(child, deps);
  const hoisted = await cache.refresh(root, deps);
  expect(local?.installed.get("foo")).toBe("2.0.0");
  expect(local?.installed.get("bar")).toBe("3.0.0");
  expect(hoisted?.installed.get("foo")).toBe("1.0.0");
});

test("binary lockfiles and missing manifests do not invent installed versions", async () => {
  const root = project();
  writeFileSync(join(root, "bun.lockb"), "foo@1.0.0");
  const snapshot = await loadInstalledSnapshot(root, ["foo"]);
  expect(snapshot.lockfile).toBeUndefined();
  expect(computeAnnotations(snapshot, locations()).pending.get("foo")).toEqual({
    declared: "1.0.0",
  });
});

test("malformed local manifests do not fall through to an unrelated hoisted version", async () => {
  const root = project();
  const child = join(root, "packages", "app");
  install(root, "foo", "1.0.0");
  install(child, "foo", "2.0.0");
  writeFileSync(join(child, "node_modules", "foo", "package.json"), "{");
  const snapshot = await loadInstalledSnapshot(child, ["foo"]);
  expect(snapshot.installed.get("foo")).toBeUndefined();
});

test("non-directory local lookup paths still permit a hoisted installed copy", async () => {
  const root = project();
  const child = join(root, "packages", "app");
  install(root, "foo", "1.0.0");
  mkdirSync(join(child, "node_modules"), { recursive: true });
  writeFileSync(join(child, "node_modules", "foo"), "not a package directory");
  const snapshot = await loadInstalledSnapshot(child, ["foo"]);
  expect(snapshot.installed.get("foo")).toBe("1.0.0");
});

test("a newly typed name remains unknown until its snapshot is loaded", async () => {
  const root = project();
  const snapshot = await loadInstalledSnapshot(root, []);
  expect(computeAnnotations(snapshot, locations()).pending.size).toBe(0);
});

test("names added while loading are included in the published snapshot", async () => {
  const root = project();
  install(root, "foo", "1.0.0");
  install(root, "bar", "2.0.0");
  const cache = new InstalledSnapshotCache();
  const first = cache.refresh(root, locations());
  const second = cache.refresh(
    root,
    findDependencyLocations('{"dependencies":{"bar":"2.0.0"}}')
  );
  const [one, two] = await Promise.all([first, second]);
  expect(one).toBe(two);
  expect(two?.installed.get("bar")).toBe("2.0.0");
  expect([...(two?.installed.keys() ?? [])]).toEqual(["bar"]);
});

test("closing a document invalidates its in-flight snapshot load", async () => {
  const root = project();
  const cache = new InstalledSnapshotCache();
  const loading = cache.refresh(root, locations());
  cache.delete(root);
  expect(await loading).toBeUndefined();
  expect(cache.get(root)).toBeUndefined();
});

test("invalidating an install cannot resurrect an old snapshot", async () => {
  const root = project();
  install(root, "foo", "1.0.0");
  const cache = new InstalledSnapshotCache();
  const loading = cache.refresh(root, locations());
  cache.clear();
  install(root, "foo", "2.0.0");
  const refreshed = cache.refresh(root, locations("2.0.0"));
  expect(await loading).toBeUndefined();
  expect((await refreshed)?.installed.get("foo")).toBe("2.0.0");
  expect(cache.get(root)?.installed.get("foo")).toBe("2.0.0");
});
