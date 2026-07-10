import { describe, expect, test } from "bun:test";
import { findDependencyLocations } from "../src/package-json";

const PKG = `{
  "name": "demo",
  "dependencies": {
    "react": "^18.2.0",
    "@types/node": "20.0.0"
  },
  "devDependencies": {
    "typescript": "5.5.0"
  }
}`;

describe("findDependencyLocations", () => {
  test("finds deps across dependency sections", () => {
    const locations = findDependencyLocations(PKG);
    const names = locations.map((loc) => loc.name);
    expect(names).toEqual(["react", "@types/node", "typescript"]);
  });

  test("records section and declared range", () => {
    const locations = findDependencyLocations(PKG);
    const ts = locations.find((loc) => loc.name === "typescript");
    expect(ts?.section).toBe("devDependencies");
    expect(ts?.declaredRange).toBe("5.5.0");
  });

  test("value range points at the quoted version string", () => {
    const lines = PKG.split("\n");
    const react = findDependencyLocations(PKG).find(
      (loc) => loc.name === "react"
    );
    if (react === undefined) {
      throw new Error("expected react location");
    }
    const slice = lines[react.valueStartLine]?.slice(
      react.valueStartCol,
      react.valueEndCol
    );
    expect(slice).toBe('"^18.2.0"');
  });

  test("returns nothing when there are no dependency sections", () => {
    expect(findDependencyLocations('{"name":"x"}')).toEqual([]);
  });
});
