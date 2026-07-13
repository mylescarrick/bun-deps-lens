import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPending } from "../src/installed";

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
