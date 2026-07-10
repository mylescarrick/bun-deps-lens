import { describe, expect, test } from "bun:test";
import { parseOutdated } from "../src/bun/outdated";

// Compact table emitted by Bun 1.3.14 (separator rows between every entry).
const BUN_1_3_14 = `bun outdated v1.3.14 (0d9b296a)
|---------------------------------------|
| Package  | Current | Update  | Latest |
|----------|---------|---------|--------|
| lodash   | 4.17.20 | 4.17.20 | 4.18.1 |
|----------|---------|---------|--------|
| minimist | 1.2.5   | 1.2.5   | 1.2.8  |
|----------|---------|---------|--------|
| react    | 18.3.1  | 18.3.1  | 19.2.7 |
|---------------------------------------|`;

// Markdown-style table shown in the Bun docs, including (dev) markers.
const DOC_TABLE = `| Package                        | Current | Update    | Latest     |
| ------------------------------ | ------- | --------- | ---------- |
| @sinclair/typebox              | 0.34.15 | 0.34.16   | 0.34.16    |
| @types/bun (dev)               | 1.3.0   | 1.3.3     | 1.3.3      |
| eslint (dev)                   | 8.57.1  | 8.57.1    | 9.20.0     |`;

describe("parseOutdated", () => {
  test("parses the Bun 1.3.14 compact table", () => {
    const entries = parseOutdated(BUN_1_3_14);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      current: "4.17.20",
      dev: false,
      latest: "4.18.1",
      name: "lodash",
      update: "4.17.20",
    });
    expect(entries[2]?.name).toBe("react");
  });

  test("parses scoped names and (dev) markers", () => {
    const entries = parseOutdated(DOC_TABLE);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.name).toBe("@sinclair/typebox");
    expect(entries[0]?.dev).toBe(false);
    expect(entries[1]).toMatchObject({ dev: true, name: "@types/bun" });
    expect(entries[2]).toMatchObject({ dev: true, name: "eslint" });
  });

  test("ignores banner, header, and separator rows", () => {
    const names = parseOutdated(BUN_1_3_14).map((entry) => entry.name);
    expect(names).not.toContain("Package");
    expect(names.every((name) => !name.includes("-"))).toBe(true);
  });

  test("returns empty array when nothing is outdated", () => {
    expect(parseOutdated("bun outdated v1.3.14 (0d9b296a)\n")).toEqual([]);
  });
});
