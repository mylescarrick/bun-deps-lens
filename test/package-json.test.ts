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

const PKG_WITH_CATALOG = `{
  "name": "root",
  "workspaces": {
    "packages": ["packages/*"],
    "catalog": {
      "typescript": "^5.5.0",
      "eslint": "^9.0.0"
    },
    "catalogs": {
      "build": {
        "webpack": "5.88.2"
      }
    }
  },
  "devDependencies": {
    "typescript": "catalog:"
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

  test("finds catalog entries under workspaces.catalog", () => {
    const locations = findDependencyLocations(PKG_WITH_CATALOG);
    const names = locations.map((loc) => loc.name);
    expect(names).toContain("typescript");
    expect(names).toContain("eslint");
    const catalogEslint = locations.find(
      (loc) => loc.name === "eslint" && loc.section === "workspaces.catalog"
    );
    expect(catalogEslint?.declaredRange).toBe("^9.0.0");
  });

  test("finds entries in named catalogs under workspaces.catalogs", () => {
    const locations = findDependencyLocations(PKG_WITH_CATALOG);
    const webpack = locations.find(
      (loc) => loc.name === "webpack" && loc.section === "workspaces.catalogs"
    );
    expect(webpack).toBeDefined();
    expect(webpack?.declaredRange).toBe("5.88.2");
  });
});
