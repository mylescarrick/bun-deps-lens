import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeAnnotations, isPending } from "../src/installed";
import type { DepLocation } from "../src/types";

describe("isPending", () => {
  test("pending when installed doesn't satisfy the changed range", () => {
    expect(isPending("typescript", "^7.0.2", "5.9.3")).toBe(true);
  });

  test("not pending when installed satisfies the range", () => {
    expect(isPending("typescript", "^7.0.2", "7.0.2")).toBe(false);
    expect(isPending("typescript", "^7.0.2", "7.1.0")).toBe(false);
    expect(isPending("typescript", "^5.9.0", "5.9.3")).toBe(false);
    expect(isPending("typescript", "5.9.3", "5.9.3")).toBe(false);
  });

  test("pending when declared but nothing is installed", () => {
    expect(isPending("typescript", "^7.0.2", undefined)).toBe(true);
  });

  test("not pending when package is resolved in the lockfile but not on disk", () => {
    const root = mkdtempSync(join(tmpdir(), "bun-deps-installed-"));
    writeFileSync(join(root, "bun.lock"), "# @esbuild/linux-arm64@0.28.1\n");
    expect(isPending("@esbuild/linux-arm64", "0.28.1", undefined, root)).toBe(
      false
    );
  });

  test("fixture lockfile marks platform-skipped @esbuild/linux-arm64 as not pending", () => {
    const root = join(import.meta.dir, "../fixtures/monorepo-catalog");
    expect(isPending("@esbuild/linux-arm64", "0.20.2", undefined, root)).toBe(
      false
    );
  });

  test("ignores non-semver specifiers", () => {
    expect(isPending("@biomejs/biome", "catalog:", "1.0.0")).toBe(false);
    expect(isPending("a", "workspace:*", undefined)).toBe(false);
    expect(isPending("a", "latest", "1.0.0")).toBe(false);
    expect(isPending("a", "*", "1.0.0")).toBe(false);
    expect(isPending("a", "npm:react@18", "1.0.0")).toBe(false);
  });
});

function catalogLocation(name: string, declaredRange: string): DepLocation {
  return {
    declaredRange,
    name,
    section: "workspaces.catalog",
    valueEndCol: 0,
    valueEndLine: 0,
    valueStartCol: 0,
    valueStartLine: 0,
  };
}

function installPackage(root: string, name: string, version: string): void {
  const dir = join(root, "node_modules", ...name.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version }));
}

describe("computeAnnotations catalog entries", () => {
  test("resolved catalog with a hoisted mismatch reports a conflict, not pending", () => {
    const root = mkdtempSync(join(tmpdir(), "bun-deps-catalog-"));
    writeFileSync(
      join(root, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        packages: {
          "@cloudflare/workers-types": [
            "@cloudflare/workers-types@4.20251125.0",
          ],
          "archive/@cloudflare/workers-types": [
            "@cloudflare/workers-types@4.20260617.1",
          ],
        },
        workspaces: {
          "": {
            devDependencies: { "@cloudflare/workers-types": "catalog:" },
          },
          "packages/tools": {
            devDependencies: {
              "@cloudflare/workers-types": "4.20251125.0",
            },
          },
        },
      })
    );
    installPackage(root, "@cloudflare/workers-types", "4.20251125.0");

    const { pending, conflicts, unusedCatalogs } = computeAnnotations(root, [
      catalogLocation("@cloudflare/workers-types", "4.20260617.1"),
    ]);

    expect(pending.has("@cloudflare/workers-types")).toBe(false);
    expect(unusedCatalogs.has("@cloudflare/workers-types")).toBe(false);
    expect(conflicts.get("@cloudflare/workers-types")).toEqual({
      dependents: [{ spec: "4.20251125.0", workspace: "packages/tools" }],
      hoisted: "4.20251125.0",
    });
  });

  test("unused catalog entry is marked unused without pending or conflict", () => {
    const root = mkdtempSync(join(tmpdir(), "bun-deps-catalog-"));
    writeFileSync(
      join(root, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        packages: {},
        workspaces: { "": { devDependencies: { turbo: "^2.9.14" } } },
      })
    );

    const { pending, conflicts, unusedCatalogs } = computeAnnotations(root, [
      catalogLocation("@hono/swagger-ui", "^0.5.3"),
    ]);

    expect(pending.size).toBe(0);
    expect(conflicts.size).toBe(0);
    expect(unusedCatalogs.has("@hono/swagger-ui")).toBe(true);
  });

  test("consumed catalog with no satisfying resolution is pending", () => {
    const root = mkdtempSync(join(tmpdir(), "bun-deps-catalog-"));
    writeFileSync(
      join(root, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        packages: { foo: ["foo@1.5.0"] },
        workspaces: { "": { dependencies: { foo: "catalog:" } } },
      })
    );

    const { pending, conflicts, unusedCatalogs } = computeAnnotations(root, [
      catalogLocation("foo", "^2.0.0"),
    ]);

    expect(pending.get("foo")).toEqual({ declared: "^2.0.0" });
    expect(conflicts.size).toBe(0);
    expect(unusedCatalogs.size).toBe(0);
  });

  test("cleanly resolved catalog produces no annotations", () => {
    const root = mkdtempSync(join(tmpdir(), "bun-deps-catalog-"));
    writeFileSync(
      join(root, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        packages: { bar: ["bar@1.2.0"] },
        workspaces: { "": { dependencies: { bar: "catalog:" } } },
      })
    );
    installPackage(root, "bar", "1.2.0");

    const { pending, conflicts, unusedCatalogs } = computeAnnotations(root, [
      catalogLocation("bar", "^1.0.0"),
    ]);

    expect(pending.size).toBe(0);
    expect(conflicts.size).toBe(0);
    expect(unusedCatalogs.size).toBe(0);
  });
});
