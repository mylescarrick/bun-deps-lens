import { describe, expect, test } from "bun:test";
import { bumpRange } from "../src/bump";

describe("bumpRange", () => {
  test("preserves a caret qualifier", () => {
    expect(bumpRange("^0.18.12", "0.18.13")).toBe("^0.18.13");
  });

  test("preserves a tilde qualifier", () => {
    expect(bumpRange("~1.2.3", "2.0.0")).toBe("~2.0.0");
  });

  test("rewrites an exact pin", () => {
    expect(bumpRange("1.2.3", "1.2.4")).toBe("1.2.4");
  });

  test("preserves an explicit equals qualifier", () => {
    expect(bumpRange("=1.2.3", "1.2.4")).toBe("=1.2.4");
  });

  test("carries prerelease and build metadata across", () => {
    expect(bumpRange("^1.2.3-beta.1", "1.2.3-beta.2")).toBe("^1.2.3-beta.2");
  });

  test("no edit when the declared version already is latest", () => {
    expect(bumpRange("^1.2.3", "1.2.3")).toBeUndefined();
  });

  test("raises the floor even when the range already admits latest", () => {
    // ^0.18.12 already permits 0.18.13, but the declared range should still
    // name the version actually in use.
    expect(bumpRange("^1.2.3", "1.9.0")).toBe("^1.9.0");
  });

  test("bumps a caret range when latest is outside it", () => {
    expect(bumpRange("^1.2.3", "2.0.0")).toBe("^2.0.0");
  });

  test("refuses catalog and workspace specifiers", () => {
    expect(bumpRange("catalog:", "1.2.4")).toBeUndefined();
    expect(bumpRange("catalog:build", "1.2.4")).toBeUndefined();
    expect(bumpRange("workspace:*", "1.2.4")).toBeUndefined();
  });

  test("refuses wildcards and dist-tags", () => {
    expect(bumpRange("*", "1.2.4")).toBeUndefined();
    expect(bumpRange("latest", "1.2.4")).toBeUndefined();
  });

  test("refuses compound and comparator ranges", () => {
    expect(bumpRange("^1 || ^2", "3.0.0")).toBeUndefined();
    expect(bumpRange(">=1.2.3", "2.0.0")).toBeUndefined();
    expect(bumpRange("1.2.3 - 2.0.0", "3.0.0")).toBeUndefined();
  });

  test("refuses partial versions", () => {
    expect(bumpRange("^1.2", "1.3.0")).toBeUndefined();
  });

  test("refuses git and file specifiers", () => {
    expect(bumpRange("github:foo/bar", "1.2.4")).toBeUndefined();
    expect(bumpRange("file:../local", "1.2.4")).toBeUndefined();
  });

  test("refuses a non-semver latest", () => {
    expect(bumpRange("^1.2.3", "not-a-version")).toBeUndefined();
  });
});
