import { describe, expect, test } from "bun:test";
import { isPending } from "../src/installed";

describe("isPending", () => {
  test("pending when installed doesn't satisfy the changed range", () => {
    expect(isPending("^7.0.2", "5.9.3")).toBe(true);
  });

  test("not pending when installed satisfies the range", () => {
    expect(isPending("^7.0.2", "7.0.2")).toBe(false);
    expect(isPending("^7.0.2", "7.1.0")).toBe(false);
    expect(isPending("^5.9.0", "5.9.3")).toBe(false);
    expect(isPending("5.9.3", "5.9.3")).toBe(false);
  });

  test("pending when declared but nothing is installed", () => {
    expect(isPending("^7.0.2", undefined)).toBe(true);
  });

  test("ignores non-semver specifiers", () => {
    expect(isPending("catalog:", "1.0.0")).toBe(false);
    expect(isPending("workspace:*", undefined)).toBe(false);
    expect(isPending("latest", "1.0.0")).toBe(false);
    expect(isPending("*", "1.0.0")).toBe(false);
    expect(isPending("npm:react@18", "1.0.0")).toBe(false);
  });
});
