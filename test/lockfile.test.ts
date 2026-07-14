import { describe, expect, test } from "bun:test";
import { parseLockfile } from "../src/bun/lockfile";

const LOCKFILE = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "devDependencies": {
        "@cloudflare/workers-types": "catalog:",
        "turbo": "^2.9.14",
      },
    },
    "packages/tools": {
      "devDependencies": {
        "@cloudflare/workers-types": "4.20251125.0",
      },
    },
    "apps/web": {
      "dependencies": {
        "react": "catalog:",
      },
    },
  },
  "catalog": {
    "@cloudflare/workers-types": "4.20260617.1",
  },
  "packages": {
    "@cloudflare/workers-types": ["@cloudflare/workers-types@4.20251125.0", "", {}, "sha512-aaa=="],
    "archive/@cloudflare/workers-types": ["@cloudflare/workers-types@4.20260617.1", "", {}, "sha512-bbb=="],
    "fixture-app": ["fixture-app@workspace:apps/web"],
  }
}`;

describe("parseLockfile", () => {
  const index = parseLockfile(LOCKFILE);

  test("collects every resolved version for a scoped package", () => {
    expect(
      index
        .resolvedVersions("@cloudflare/workers-types")
        .sort((a, b) => a.localeCompare(b))
    ).toEqual(["4.20251125.0", "4.20260617.1"]);
  });

  test("tracks the top-level package version separately from nested copies", () => {
    expect(index.topLevelResolvedVersion("@cloudflare/workers-types")).toBe(
      "4.20251125.0"
    );
  });

  test("lists workspaces that consume a package via catalog:", () => {
    expect(index.catalogConsumers("@cloudflare/workers-types")).toEqual([""]);
    expect(index.catalogConsumers("react")).toEqual(["apps/web"]);
    expect(index.catalogConsumers("turbo")).toEqual([]);
  });

  test("lists workspaces that pin a concrete version directly", () => {
    expect(index.directDependents("@cloudflare/workers-types")).toEqual([
      { spec: "4.20251125.0", workspace: "packages/tools" },
    ]);
    expect(index.directDependents("turbo")).toEqual([
      { spec: "^2.9.14", workspace: "" },
    ]);
  });

  test("ignores workspace: descriptors as resolved versions", () => {
    expect(index.resolvedVersions("fixture-app")).toEqual([]);
  });

  test("returns an empty index for unparseable input", () => {
    const empty = parseLockfile("# not json @foo@1.0.0");
    expect(empty.resolvedVersions("foo")).toEqual([]);
    expect(empty.topLevelResolvedVersion("foo")).toBeUndefined();
    expect(empty.catalogConsumers("foo")).toEqual([]);
  });
});
