import { describe, expect, test } from "bun:test";
import {
  findCatalogDefinition,
  findCatalogReference,
} from "../src/catalog-link";
import { findDependencyLocations } from "../src/package-json";

const ROOT_PKG = `{
  "name": "root",
  "workspaces": {
    "packages": ["packages/*"],
    "catalog": {
      "eslint": "^9.0.0"
    },
    "catalogs": {
      "build": {
        "webpack": "5.88.2"
      }
    }
  }
}`;

const CONSUMER_PKG = `{
  "name": "app",
  "dependencies": {
    "eslint": "catalog:",
    "webpack": "catalog:build",
    "react": "^18.2.0"
  }
}`;

describe("findCatalogReference", () => {
  test("finds a default catalog reference at the given position", () => {
    const locations = findDependencyLocations(CONSUMER_PKG);
    const eslint = locations.find((loc) => loc.name === "eslint");
    if (eslint === undefined) {
      throw new Error("expected eslint location");
    }
    const reference = findCatalogReference(locations, {
      character: eslint.valueStartCol + 1,
      line: eslint.valueStartLine,
    });
    expect(reference).toEqual({ catalogName: undefined, name: "eslint" });
  });

  test("finds a named catalog reference at the given position", () => {
    const locations = findDependencyLocations(CONSUMER_PKG);
    const webpack = locations.find((loc) => loc.name === "webpack");
    if (webpack === undefined) {
      throw new Error("expected webpack location");
    }
    const reference = findCatalogReference(locations, {
      character: webpack.valueStartCol + 1,
      line: webpack.valueStartLine,
    });
    expect(reference).toEqual({ catalogName: "build", name: "webpack" });
  });

  test("returns undefined for a plain semver reference", () => {
    const locations = findDependencyLocations(CONSUMER_PKG);
    const react = locations.find((loc) => loc.name === "react");
    if (react === undefined) {
      throw new Error("expected react location");
    }
    const reference = findCatalogReference(locations, {
      character: react.valueStartCol + 1,
      line: react.valueStartLine,
    });
    expect(reference).toBeUndefined();
  });
});

describe("findCatalogDefinition", () => {
  test("resolves a default catalog entry", () => {
    const rootLocations = findDependencyLocations(ROOT_PKG);
    const definition = findCatalogDefinition(rootLocations, {
      catalogName: undefined,
      name: "eslint",
    });
    expect(definition?.section).toBe("workspaces.catalog");
    expect(definition?.declaredRange).toBe("^9.0.0");
  });

  test("resolves a named catalog entry", () => {
    const rootLocations = findDependencyLocations(ROOT_PKG);
    const definition = findCatalogDefinition(rootLocations, {
      catalogName: "build",
      name: "webpack",
    });
    expect(definition?.section).toBe("workspaces.catalogs");
    expect(definition?.declaredRange).toBe("5.88.2");
  });

  test("returns undefined when the catalog entry does not exist", () => {
    const rootLocations = findDependencyLocations(ROOT_PKG);
    const definition = findCatalogDefinition(rootLocations, {
      catalogName: undefined,
      name: "missing",
    });
    expect(definition).toBeUndefined();
  });
});
